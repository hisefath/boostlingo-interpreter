// OpenAI realtime transcription session over WebSocket with server VAD (R02 F4).
// The API takes PCM16 24 kHz, so 16 kHz frames are upsampled linearly.
import { WebSocket } from "ws";
import { ProviderError } from "../../../shared/contracts.ts";
import type { SttProvider } from "../../../shared/contracts.ts";
import { guessLang } from "../http.ts";

function upsample16to24(pcm: Int16Array): Int16Array {
  const out = new Int16Array(Math.floor((pcm.length * 3) / 2));
  for (let i = 0; i < out.length; i++) {
    const x = (i * 2) / 3;
    const j = Math.floor(x);
    const a = pcm[j] ?? 0;
    const b = pcm[j + 1] ?? a;
    out[i] = Math.round(a + (b - a) * (x - j));
  }
  return out;
}

export function openaiStt(apiKey: string, model = "gpt-4o-transcribe"): SttProvider {
  return {
    name: "openai",
    open(h) {
      const ws = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      const t0 = Date.now();
      const pending: string[] = [];
      const partial = new Map<string, string>();
      const endByItem = new Map<string, number>();
      let closed = false;
      const send = (msg: object) => {
        const s = JSON.stringify(msg);
        if (ws.readyState === WebSocket.OPEN) ws.send(s);
        else if (ws.readyState === WebSocket.CONNECTING) pending.push(s); // never buffer after close (no unbounded growth)
      };

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "transcription",
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: 24000 },
                  transcription: { model },
                  turn_detection: { type: "server_vad", silence_duration_ms: 500 },
                },
              },
            },
          }),
        );
        for (const s of pending.splice(0)) ws.send(s);
      });
      ws.on("message", (raw) => {
        let m: {
          type: string;
          item_id?: string;
          delta?: string;
          transcript?: string;
          audio_end_ms?: number;
          error?: { code?: string; message?: string };
        };
        try {
          m = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const id = m.item_id ?? "";
        if (m.type === "input_audio_buffer.speech_stopped" && m.audio_end_ms != null) {
          endByItem.set(id, t0 + m.audio_end_ms);
        } else if (m.type === "conversation.item.input_audio_transcription.delta") {
          const text = (partial.get(id) ?? "") + (m.delta ?? "");
          partial.set(id, text);
          h.onPartial({ text, lang: guessLang(text, h.languages) });
        } else if (m.type === "conversation.item.input_audio_transcription.completed") {
          const text = (m.transcript ?? "").trim();
          partial.delete(id);
          h.onFinal({
            segmentId: id,
            text,
            lang: guessLang(text, h.languages),
            endMs: endByItem.get(id) ?? Date.now(),
          });
          endByItem.delete(id);
        } else if (m.type === "error") {
          const kind = m.error?.code === "rate_limit_exceeded" ? "rate_limited" : "failed";
          h.onError(new ProviderError("stt", kind, m.error?.message ?? "openai stt error"));
        }
      });
      ws.on("error", () => h.onError(new ProviderError("stt", "disconnected", "openai stt socket error")));
      ws.on("close", (code) => {
        if (!closed && code !== 1000) h.onError(new ProviderError("stt", "disconnected"));
      });

      return {
        push(pcm) {
          const up = upsample16to24(pcm);
          send({
            type: "input_audio_buffer.append",
            audio: Buffer.from(up.buffer, up.byteOffset, up.byteLength).toString("base64"),
          });
        },
        close() {
          closed = true;
          ws.close();
        },
      };
    },
  };
}

// OpenAI realtime transcription session over WebSocket with server VAD (R02 F4).
// The API takes PCM16 24 kHz, so 16 kHz frames are upsampled linearly.
import { WebSocket } from "ws";
import { ProviderError } from "../../../shared/contracts.ts";
import type { SttProvider } from "../../../shared/contracts.ts";
import { guessLanguage, sttPrompt } from "../vendor-adapter-helpers.ts";

function upsample16kHzTo24kHz(pcm: Int16Array): Int16Array {
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
    open(handlers) {
      const socket = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      const sessionStartedAt = Date.now();
      const pending: string[] = [];
      const partialTextByItem = new Map<string, string>();
      const endByItem = new Map<string, number>();
      let closed = false;
      const send = (payload: object) => {
        const json = JSON.stringify(payload);
        if (socket.readyState === WebSocket.OPEN) socket.send(json);
        else if (socket.readyState === WebSocket.CONNECTING) pending.push(json); // never buffer after close (no unbounded growth)
      };

      socket.on("open", () => {
        socket.send(
          JSON.stringify({
            type: "session.update",
            session: {
              type: "transcription",
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: 24000 },
                  transcription: { model, prompt: sttPrompt(handlers.languages) },
                  turn_detection: { type: "server_vad", silence_duration_ms: 500 },
                },
              },
            },
          }),
        );
        for (const json of pending.splice(0)) socket.send(json);
      });
      socket.on("message", (raw) => {
        let message: {
          type: string;
          item_id?: string;
          delta?: string;
          transcript?: string;
          audio_end_ms?: number;
          error?: { code?: string; message?: string };
        };
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const id = message.item_id ?? "";
        if (message.type === "input_audio_buffer.speech_stopped" && message.audio_end_ms != null) {
          endByItem.set(id, sessionStartedAt + message.audio_end_ms);
        } else if (message.type === "conversation.item.input_audio_transcription.delta") {
          const text = (partialTextByItem.get(id) ?? "") + (message.delta ?? "");
          partialTextByItem.set(id, text);
          handlers.onPartial({ text, lang: guessLanguage(text, handlers.languages) });
        } else if (message.type === "conversation.item.input_audio_transcription.completed") {
          const text = (message.transcript ?? "").trim();
          partialTextByItem.delete(id);
          handlers.onFinal({
            segmentId: id,
            text,
            lang: guessLanguage(text, handlers.languages),
            endMs: endByItem.get(id) ?? Date.now(),
          });
          endByItem.delete(id);
        } else if (message.type === "error") {
          const kind = message.error?.code === "rate_limit_exceeded" ? "rate_limited" : "failed";
          handlers.onError(new ProviderError("stt", kind, message.error?.message ?? "openai stt error"));
        }
      });
      socket.on("error", () =>
        handlers.onError(new ProviderError("stt", "disconnected", "openai stt socket error")),
      );
      socket.on("close", (code) => {
        if (!closed && code !== 1000) handlers.onError(new ProviderError("stt", "disconnected"));
      });

      return {
        push(pcm) {
          const upsampled = upsample16kHzTo24kHz(pcm);
          send({
            type: "input_audio_buffer.append",
            audio: Buffer.from(upsampled.buffer, upsampled.byteOffset, upsampled.byteLength).toString(
              "base64",
            ),
          });
        },
        close() {
          closed = true;
          socket.close();
        },
      };
    },
  };
}

// Deepgram Nova-3 live streaming STT over its WebSocket API (linear16 16 kHz, multi-language, endpointing).
// Uses `ws` directly: the wire protocol is small and stable.
import { WebSocket } from "ws";
import { ProviderError } from "../../../shared/contracts.ts";
import type { Lang, SttProvider } from "../../../shared/contracts.ts";
import { guessLang } from "../http.ts";

interface DgWord {
  word: string;
  end: number;
  language?: string;
}
interface DgResults {
  type: "Results" | "UtteranceEnd" | string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript: string; words?: DgWord[]; languages?: string[] }> };
}

export function deepgramStt(apiKey: string, endpointingMs = 300): SttProvider {
  return {
    name: "deepgram",
    open(h) {
      const q = new URLSearchParams({
        model: "nova-3",
        language: "multi",
        encoding: "linear16",
        sample_rate: "16000",
        channels: "1",
        interim_results: "true",
        punctuate: "true",
        smart_format: "true",
        endpointing: String(endpointingMs),
        // backup end-of-turn when speech_final never comes (noise, merged utterances): R02 F6, review A-R9
        utterance_end_ms: "1000",
        vad_events: "true",
      });
      const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${q}`, {
        headers: { authorization: `Token ${apiKey}` },
      });
      // Word times count from the first audio byte Deepgram receives, so the clock origin is the first push (INV-2).
      let t0 = 0;
      const pending: Buffer[] = [];
      let parts: string[] = [];
      let lastEnd = 0;
      let langs: string[] = [];
      let n = 0;
      let closed = false;
      // Deepgram's code when it is one of the session's languages, else our guess within the pair.
      const toLang = (code: string | undefined, text: string): Lang => {
        const c = code?.slice(0, 2) as Lang;
        return h.languages.includes(c) ? c : guessLang(text, h.languages);
      };

      ws.on("open", () => {
        for (const b of pending.splice(0)) ws.send(b);
      });
      ws.on("message", (raw) => {
        let m: DgResults;
        try {
          m = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (m.type === "UtteranceEnd") return finish();
        if (m.type !== "Results") return;
        const alt = m.channel?.alternatives?.[0];
        if (!alt) return;
        const lang = alt.languages?.[0] ?? alt.words?.[0]?.language;
        if (!m.is_final) {
          const text = [...parts, alt.transcript].join(" ").trim();
          if (text) h.onPartial({ text, lang: toLang(lang, text) });
          return;
        }
        if (alt.transcript) parts.push(alt.transcript);
        if (lang) langs.push(lang);
        const w = alt.words?.at(-1);
        if (w) lastEnd = w.end;
        if (m.speech_final) finish();
      });
      function finish() {
        const text = parts.join(" ").trim();
        if (text)
          h.onFinal({
            segmentId: `dg${++n}`,
            text,
            lang: toLang(langs[0], text),
            endMs: t0 + lastEnd * 1000,
          });
        parts = [];
        langs = [];
      }
      ws.on("error", () => h.onError(new ProviderError("stt", "disconnected", "deepgram socket error")));
      ws.on("close", (code) => {
        if (!closed && code !== 1000)
          h.onError(new ProviderError("stt", code === 1008 ? "failed" : "disconnected"));
      });

      return {
        push(pcm) {
          if (!t0) t0 = Date.now();
          const b = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
          if (ws.readyState === WebSocket.OPEN) ws.send(b);
          else if (ws.readyState === WebSocket.CONNECTING) pending.push(Buffer.from(b));
        },
        close() {
          closed = true;
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
          setTimeout(() => ws.close(), 500).unref?.();
        },
      };
    },
  };
}

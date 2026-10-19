// Deepgram Nova-3 live streaming STT over its WebSocket API (linear16 16 kHz, multi-language, endpointing).
// Uses `ws` directly: the wire protocol is small and stable.
import { WebSocket } from "ws";
import { ProviderError } from "../../../shared/contracts.ts";
import type { LanguageCode, SttProvider } from "../../../shared/contracts.ts";
import { guessLanguage } from "../vendor-adapter-helpers.ts";

interface DeepgramWord {
  word: string;
  end: number;
  language?: string;
}
interface DeepgramResults {
  type: "Results" | "UtteranceEnd" | string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: Array<{ transcript: string; words?: DeepgramWord[]; languages?: string[] }> };
}

export function deepgramStt(apiKey: string, endpointingMs = 300): SttProvider {
  return {
    name: "deepgram",
    open(handlers) {
      const queryParams = new URLSearchParams({
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
      const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${queryParams}`, {
        headers: { authorization: `Token ${apiKey}` },
      });
      // Word times count from the first audio byte Deepgram receives, so the clock origin is the first push (INV-2).
      let firstAudioSentAt = 0;
      const pending: Buffer[] = [];
      let parts: string[] = [];
      let lastEnd = 0;
      let detectedLanguages: string[] = [];
      let segmentCount = 0;
      let closed = false;
      // Deepgram's code when it is one of the session's languages, else our guess within the pair.
      const toLanguageCode = (code: string | undefined, text: string): LanguageCode => {
        const candidate = code?.slice(0, 2) as LanguageCode;
        return handlers.languages.includes(candidate) ? candidate : guessLanguage(text, handlers.languages);
      };

      socket.on("open", () => {
        for (const chunk of pending.splice(0)) socket.send(chunk);
      });
      socket.on("message", (raw) => {
        let message: DeepgramResults;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (message.type === "UtteranceEnd") return finish();
        if (message.type !== "Results") return;
        const alternative = message.channel?.alternatives?.[0];
        if (!alternative) return;
        const language = alternative.languages?.[0] ?? alternative.words?.[0]?.language;
        if (!message.is_final) {
          const text = [...parts, alternative.transcript].join(" ").trim();
          if (text) handlers.onPartial({ text, lang: toLanguageCode(language, text) });
          return;
        }
        if (alternative.transcript) parts.push(alternative.transcript);
        if (language) detectedLanguages.push(language);
        const lastWord = alternative.words?.at(-1);
        if (lastWord) lastEnd = lastWord.end;
        if (message.speech_final) finish();
      });
      function finish() {
        const text = parts.join(" ").trim();
        if (text)
          handlers.onFinal({
            segmentId: `dg${++segmentCount}`,
            text,
            lang: toLanguageCode(detectedLanguages[0], text),
            endMs: firstAudioSentAt + lastEnd * 1000,
          });
        parts = [];
        detectedLanguages = [];
      }
      socket.on("error", () =>
        handlers.onError(new ProviderError("stt", "disconnected", "deepgram socket error")),
      );
      socket.on("close", (code) => {
        if (!closed && code !== 1000)
          handlers.onError(new ProviderError("stt", code === 1008 ? "failed" : "disconnected"));
      });

      return {
        push(pcm) {
          if (!firstAudioSentAt) firstAudioSentAt = Date.now();
          const chunk = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
          if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
          else if (socket.readyState === WebSocket.CONNECTING) pending.push(Buffer.from(chunk));
        },
        close() {
          closed = true;
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
          setTimeout(() => socket.close(), 500).unref?.();
        },
      };
    },
  };
}

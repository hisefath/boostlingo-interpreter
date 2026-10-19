// Scripted fake STT / translator / TTS providers for tests and keyless demos (lld.md §1). No network.
import { ProviderError } from "../../shared/contracts.ts";
import type { LanguageCode, SttProvider, Translator, Tts } from "../../shared/contracts.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Emits the next scripted final each time audio is pushed. */
export function fakeStt(
  finals: Array<{ text: string; lang: LanguageCode }> = [{ text: "Hello.", lang: "en" }],
): SttProvider {
  return {
    name: "fake-stt",
    open(handlers) {
      let i = 0;
      return {
        push() {
          const nextFinal = finals[i++];
          if (nextFinal)
            handlers.onFinal({
              segmentId: `s${i}`,
              text: nextFinal.text,
              lang: nextFinal.lang,
              endMs: Date.now(),
            });
        },
        close() {},
      };
    },
  };
}

/** Per source text: string deltas, numeric delays (ms) or a thrown ProviderError. Default: the text uppercased. */
export function fakeTranslator(
  script: Record<string, Array<string | number | ProviderError>> = {},
): Translator {
  return {
    name: "fake-mt",
    async *translate(request) {
      for (const step of script[request.text] ?? [request.text.toUpperCase()]) {
        if (typeof step === "number") await sleep(step);
        else if (step instanceof ProviderError) throw step;
        else yield step;
      }
    },
  };
}

export function fakeTts(): Tts {
  return {
    name: "fake-tts",
    async *speak() {
      yield new Uint8Array([1, 0, 2, 0]);
    },
  };
}

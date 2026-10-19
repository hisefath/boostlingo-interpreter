// Scripted fakes for tests and keyless demos (lld.md §1). No network.
import { ProviderError } from "../../shared/contracts.ts";
import type { Lang, SttProvider, Translator, Tts } from "../../shared/contracts.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Emits the next scripted final each time audio is pushed. */
export function fakeStt(
  finals: Array<{ text: string; lang: Lang }> = [{ text: "Hello.", lang: "en" }],
): SttProvider {
  return {
    name: "fake-stt",
    open(h) {
      let i = 0;
      return {
        push() {
          const f = finals[i++];
          if (f) h.onFinal({ segmentId: `s${i}`, text: f.text, lang: f.lang, endMs: Date.now() });
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
    async *translate(req) {
      for (const step of script[req.text] ?? [req.text.toUpperCase()]) {
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

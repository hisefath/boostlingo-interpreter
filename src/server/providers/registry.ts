// One line per vendor (AGENTS.md). Picks each stage's vendor from env; a blank vendor key falls back to openai.
import type { Lang, SttProvider, Translator, Tts } from "../../shared/contracts.ts";
import { LANGUAGES } from "../../shared/languages.ts";
import { fakeStt, fakeTranslator, fakeTts } from "./fake.ts";
import { deepgramStt } from "./stt/deepgram.ts";
import { openaiStt } from "./stt/openai.ts";
import { openaiTranslator } from "./translate/openai.ts";
import { elevenlabsTts } from "./tts/elevenlabs.ts";
import { openaiTts } from "./tts/openai.ts";

export type Env = Record<string, string | undefined>;

export interface Providers {
  stt: SttProvider;
  translator: Translator;
  tts: Tts;
}

/** `hears` / `speaks` = the vendor transcribes / speaks this language (absent = every language). */
type Factory<T> = {
  key?: string;
  make: (e: Env) => T;
  hears?: (l: Lang) => boolean;
  speaks?: (l: Lang) => boolean;
};

const STT: Record<string, Factory<SttProvider>> = {
  openai: {
    key: "OPENAI_API_KEY",
    make: (e) => openaiStt(e.OPENAI_API_KEY ?? "", e.OPENAI_STT_MODEL || undefined),
  },
  deepgram: {
    key: "DEEPGRAM_API_KEY",
    make: (e) => deepgramStt(e.DEEPGRAM_API_KEY ?? ""),
    hears: (l) => LANGUAGES[l].deepgram,
  },
  fake: { make: () => fakeStt() },
};
const TRANSLATE: Record<string, Factory<Translator>> = {
  openai: {
    key: "OPENAI_API_KEY",
    make: (e) => openaiTranslator(e.OPENAI_API_KEY ?? "", e.OPENAI_TRANSLATE_MODEL || undefined),
  },
  fake: { make: () => fakeTranslator() },
};
const TTS: Record<string, Factory<Tts>> = {
  openai: {
    key: "OPENAI_API_KEY",
    make: (e) => openaiTts(e.OPENAI_API_KEY ?? "", e.OPENAI_TTS_MODEL || undefined),
    speaks: (l) => LANGUAGES[l].openaiTts,
  },
  elevenlabs: {
    key: "ELEVENLABS_API_KEY",
    make: (e) => elevenlabsTts(e.ELEVENLABS_API_KEY ?? "", e.ELEVENLABS_VOICE_ID || undefined),
  },
  fake: { make: () => fakeTts() },
};

function pick<T>(table: Record<string, Factory<T>>, wanted: string | undefined, env: Env): T {
  const f = table[wanted ?? "openai"];
  // Unknown vendor or blank key -> openai (adapters connect lazily, so building one never hits the network).
  if (!f || (f.key && !env[f.key])) return table.openai.make(env);
  return f.make(env);
}

/** `pair` = the session's languages: an STT vendor that can't hear one of them hands this session to openai
 * (per-pair routing; the pipeline's timing events then name the vendor that actually ran). */
export function createProviders(env: Env = process.env, pair?: readonly Lang[]): Providers {
  const hears = STT[env.STT_PROVIDER ?? "openai"]?.hears;
  // speech output: a vendor that can't speak one of the pair's languages hands it to ElevenLabs when that key exists
  const speaks = TTS[env.TTS_PROVIDER ?? "openai"]?.speaks;
  const ttsVendor =
    pair && speaks && !pair.every(speaks) && env.ELEVENLABS_API_KEY ? "elevenlabs" : env.TTS_PROVIDER;
  return {
    stt: pick(STT, pair && hears && !pair.every(hears) ? "openai" : env.STT_PROVIDER, env),
    translator: pick(TRANSLATE, env.TRANSLATE_PROVIDER, env),
    tts: pick(TTS, ttsVendor, env),
  };
}

// One line per vendor (AGENTS.md). Picks each stage's vendor from env; a blank vendor key falls back to openai.
import type { LanguageCode, SttProvider, Translator, Tts } from "../../shared/contracts.ts";
import { LANGUAGES } from "../../shared/languages.ts";
import { fakeStt, fakeTranslator, fakeTts } from "./fake-providers.ts";
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
type VendorFactory<T> = {
  /** name of the environment variable holding this vendor's API key (absent = needs no key) */
  apiKeyEnvVar?: string;
  make: (env: Env) => T;
  hears?: (language: LanguageCode) => boolean;
  speaks?: (language: LanguageCode) => boolean;
};

const STT_VENDORS: Record<string, VendorFactory<SttProvider>> = {
  openai: {
    apiKeyEnvVar: "OPENAI_API_KEY",
    make: (env) => openaiStt(env.OPENAI_API_KEY ?? "", env.OPENAI_STT_MODEL || undefined),
  },
  deepgram: {
    apiKeyEnvVar: "DEEPGRAM_API_KEY",
    make: (env) => deepgramStt(env.DEEPGRAM_API_KEY ?? ""),
    hears: (language) => LANGUAGES[language].deepgram,
  },
  fake: { make: () => fakeStt() },
};
const TRANSLATE_VENDORS: Record<string, VendorFactory<Translator>> = {
  openai: {
    apiKeyEnvVar: "OPENAI_API_KEY",
    make: (env) => openaiTranslator(env.OPENAI_API_KEY ?? "", env.OPENAI_TRANSLATE_MODEL || undefined),
  },
  fake: { make: () => fakeTranslator() },
};
const TTS_VENDORS: Record<string, VendorFactory<Tts>> = {
  openai: {
    apiKeyEnvVar: "OPENAI_API_KEY",
    make: (env) => openaiTts(env.OPENAI_API_KEY ?? "", env.OPENAI_TTS_MODEL || undefined),
    speaks: (language) => LANGUAGES[language].openaiTts,
  },
  elevenlabs: {
    apiKeyEnvVar: "ELEVENLABS_API_KEY",
    make: (env) => elevenlabsTts(env.ELEVENLABS_API_KEY ?? "", env.ELEVENLABS_VOICE_ID || undefined),
  },
  fake: { make: () => fakeTts() },
};

function pickVendor<T>(table: Record<string, VendorFactory<T>>, wanted: string | undefined, env: Env): T {
  const factory = table[wanted ?? "openai"];
  // Unknown vendor or blank key -> openai (adapters connect lazily, so building one never hits the network).
  if (!factory || (factory.apiKeyEnvVar && !env[factory.apiKeyEnvVar])) return table.openai.make(env);
  return factory.make(env);
}

/** `pair` = the session's languages: an STT vendor that can't hear one of them hands this session to openai
 * (per-pair routing; the pipeline's timing events then name the vendor that actually ran). */
export function createProviders(env: Env = process.env, pair?: readonly LanguageCode[]): Providers {
  const hears = STT_VENDORS[env.STT_PROVIDER ?? "openai"]?.hears;
  // speech output: a vendor that can't speak one of the pair's languages hands it to ElevenLabs when that key exists
  const speaks = TTS_VENDORS[env.TTS_PROVIDER ?? "openai"]?.speaks;
  const ttsVendor =
    pair && speaks && !pair.every(speaks) && env.ELEVENLABS_API_KEY ? "elevenlabs" : env.TTS_PROVIDER;
  return {
    stt: pickVendor(STT_VENDORS, pair && hears && !pair.every(hears) ? "openai" : env.STT_PROVIDER, env),
    translator: pickVendor(TRANSLATE_VENDORS, env.TRANSLATE_PROVIDER, env),
    tts: pickVendor(TTS_VENDORS, ttsVendor, env),
  };
}

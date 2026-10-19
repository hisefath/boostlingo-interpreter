// One line per vendor (AGENTS.md). Picks each stage's vendor from env; a blank vendor key falls back to openai.
import type { SttProvider, Translator, Tts } from "../../shared/contracts.ts";
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

type Factory<T> = { key?: string; make: (e: Env) => T };

const STT: Record<string, Factory<SttProvider>> = {
  openai: {
    key: "OPENAI_API_KEY",
    make: (e) => openaiStt(e.OPENAI_API_KEY ?? "", e.OPENAI_STT_MODEL || undefined),
  },
  deepgram: { key: "DEEPGRAM_API_KEY", make: (e) => deepgramStt(e.DEEPGRAM_API_KEY ?? "") },
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

export function createProviders(env: Env = process.env): Providers {
  return {
    stt: pick(STT, env.STT_PROVIDER, env),
    translator: pick(TRANSLATE, env.TRANSLATE_PROVIDER, env),
    tts: pick(TTS, env.TTS_PROVIDER, env),
  };
}

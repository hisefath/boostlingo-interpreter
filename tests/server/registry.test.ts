import { describe, expect, it } from "vitest";
import { createProviders } from "../../src/server/providers/registry.ts";

const keys = { OPENAI_API_KEY: "x", DEEPGRAM_API_KEY: "x", ELEVENLABS_API_KEY: "x" };

describe("provider registry", () => {
  it("picks the configured vendor per stage", () => {
    const p = createProviders({
      ...keys,
      STT_PROVIDER: "deepgram",
      TRANSLATE_PROVIDER: "openai",
      TTS_PROVIDER: "elevenlabs",
    });
    expect([p.stt.name, p.translator.name, p.tts.name]).toEqual(["deepgram", "openai", "elevenlabs"]);
  });

  it("swapping one env value swaps only that stage", () => {
    const p = createProviders({ ...keys, STT_PROVIDER: "openai", TTS_PROVIDER: "elevenlabs" });
    expect([p.stt.name, p.translator.name, p.tts.name]).toEqual(["openai", "openai", "elevenlabs"]);
  });

  it("falls back to openai when the vendor key is blank", () => {
    const p = createProviders({
      OPENAI_API_KEY: "x",
      DEEPGRAM_API_KEY: "",
      STT_PROVIDER: "deepgram",
      TTS_PROVIDER: "elevenlabs",
    });
    expect([p.stt.name, p.tts.name]).toEqual(["openai", "openai"]);
  });

  it("supports scripted fakes", () => {
    const p = createProviders({ STT_PROVIDER: "fake", TRANSLATE_PROVIDER: "fake", TTS_PROVIDER: "fake" });
    expect([p.stt.name, p.translator.name, p.tts.name]).toEqual(["fake-stt", "fake-mt", "fake-tts"]);
  });
});

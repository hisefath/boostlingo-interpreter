// Bangla (EN↔BN): Deepgram multi can't hear it, OpenAI TTS can't speak it, ElevenLabs Flash rejects it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviders } from "../../src/server/providers/registry.ts";
import { ELEVEN_WIDE_MODEL, elevenlabsTts } from "../../src/server/providers/tts/elevenlabs.ts";
import { guessLang, isPair, PAIRS } from "../../src/shared/languages.ts";

afterEach(() => vi.unstubAllGlobals());

const keys = { OPENAI_API_KEY: "k", DEEPGRAM_API_KEY: "k", ELEVENLABS_API_KEY: "k" };

describe("Bangla pair", () => {
  it("is onboarded in both orders and listed in the UI pairs", () => {
    expect(isPair(["en", "bn"])).toBe(true);
    expect(isPair(["bn", "en"])).toBe(true);
    expect(PAIRS.map((p) => p.id)).toContain("en-bn");
    expect(PAIRS.find((p) => p.id === "en-bn")?.label).toContain("বাংলা");
  });

  it("detects Bengali script within the pair", () => {
    expect(guessLang("আমার অ্যাপয়েন্টমেন্ট বৃহস্পতিবার", ["en", "bn"])).toBe("bn");
    expect(guessLang("Can you come in on Thursday?", ["en", "bn"])).toBe("en");
  });

  it("routes speech recognition to OpenAI (Deepgram multi has no Bengali)", () => {
    const p = createProviders({ ...keys, STT_PROVIDER: "deepgram", TTS_PROVIDER: "elevenlabs" }, [
      "en",
      "bn",
    ]);
    expect(p.stt.name).toBe("openai");
    expect(createProviders({ ...keys, STT_PROVIDER: "deepgram" }, ["en", "es"]).stt.name).toBe("deepgram");
  });

  it("routes speech output to ElevenLabs when OpenAI TTS is configured (it can't speak Bengali)", () => {
    expect(createProviders({ ...keys, TTS_PROVIDER: "openai" }, ["en", "bn"]).tts.name).toBe("elevenlabs");
    expect(createProviders({ ...keys, TTS_PROVIDER: "openai" }, ["en", "es"]).tts.name).toBe("openai");
    // without an ElevenLabs key there is nowhere better to go: keep the configured vendor
    expect(createProviders({ OPENAI_API_KEY: "k", TTS_PROVIDER: "openai" }, ["en", "bn"]).tts.name).toBe(
      "openai",
    );
  });

  it("ElevenLabs uses eleven_v4_turbo for Bengali and keeps Flash for Spanish", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      models.push(JSON.parse(init.body).model_id);
      return new Response(new Uint8Array([0, 0, 0, 0]), { status: 200 });
    });
    const tts = elevenlabsTts("k", "voice", "eleven_flash_v2_5");
    for (const lang of ["bn", "es"] as const)
      for await (const _ of tts.speak(
        { turnId: "t", segmentIdx: 0, text: "x", lang },
        new AbortController().signal,
      ));
    expect(models).toEqual([ELEVEN_WIDE_MODEL, "eleven_flash_v2_5"]);
  });
});

describe("formal register (clinic front desk)", () => {
  it("tells the interpreter to address the listener formally in each language that has a polite form", async () => {
    const { interpreterInstructions } = await import("../../src/server/providers/http.ts");
    expect(interpreterInstructions("en", "bn")).toContain("আপনি");
    expect(interpreterInstructions("en", "es")).toContain("usted");
    expect(interpreterInstructions("en", "bn")).toMatch(/imperative addressed to the listener/);
  });
});

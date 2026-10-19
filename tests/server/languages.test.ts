// M5-T011: language table, pair validation, per-pair STT routing, detection within a pair, prompts per pair.
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Lang, ServerMsg } from "../../src/shared/contracts.ts";
import { isPair, LANG_CODES, LANGUAGES, PAIRS } from "../../src/shared/languages.ts";
import { createAppServer } from "../../src/server/index.ts";
import { guessLang, interpreterInstructions, sttPrompt } from "../../src/server/providers/http.ts";
import { createProviders } from "../../src/server/providers/registry.ts";
import { openaiTranslator } from "../../src/server/providers/translate/openai.ts";

// Wrap the registry so the WS test can see which pair the server asks it to route for.
const seen = vi.hoisted(() => [] as unknown[]);
vi.mock("../../src/server/providers/registry.ts", async (orig) => {
  const m = await orig<typeof import("../../src/server/providers/registry.ts")>();
  return {
    ...m,
    createProviders: (...a: Parameters<typeof m.createProviders>) => {
      seen.push(a[1]);
      return m.createProviders(...a);
    },
  };
});

describe("language table", () => {
  it("every language is complete; Mandarin and Bengali are outside Deepgram multi", () => {
    for (const l of LANG_CODES) {
      const x = LANGUAGES[l];
      expect([x.name, x.nativeName, x.sttHint].every((s) => s.length > 0)).toBe(true);
    }
    expect(LANG_CODES.filter((l) => !LANGUAGES[l].deepgram)).toEqual(["zh", "bn"]);
  });

  it("onboards en-es, en-fr, en-pt, en-zh, en-bn with ids the UI select can split back into the pair", () => {
    expect(PAIRS.map((p) => p.id)).toEqual(["en-es", "en-fr", "en-pt", "en-zh", "en-bn"]);
    for (const p of PAIRS) {
      expect(p.id.split("-")).toEqual(p.langs);
      expect(p.langs.every((l) => LANG_CODES.includes(l)) && p.langs[0] !== p.langs[1]).toBe(true);
    }
    expect(PAIRS[3].label).toBe("English ↔ Mandarin Chinese (中文)");
  });
});

describe("isPair (trust boundary)", () => {
  it("accepts every onboarded pair in either order", () => {
    for (const { langs } of PAIRS) {
      expect(isPair(langs)).toBe(true);
      expect(isPair([langs[1], langs[0]])).toBe(true);
    }
  });
  it("rejects nonsense and pairs that were never onboarded", () => {
    for (const bad of [
      ["en", "en"],
      ["en", "xx"],
      ["fr", "zh"],
      ["en"],
      ["en", "es", "fr"],
      "en-es",
      null,
      {},
    ])
      expect(isPair(bad)).toBe(false);
  });
});

describe("per-pair STT routing", () => {
  const env = { OPENAI_API_KEY: "x", DEEPGRAM_API_KEY: "x", STT_PROVIDER: "deepgram" };
  it("routes a Mandarin session to OpenAI STT when Deepgram is the configured vendor", () => {
    expect(createProviders(env, ["en", "zh"]).stt.name).toBe("openai");
    expect(createProviders(env, ["zh", "en"]).stt.name).toBe("openai");
  });
  it("keeps the env default for pairs the vendor hears, and without a pair", () => {
    for (const p of [
      ["en", "es"],
      ["en", "fr"],
      ["en", "pt"],
    ] as Lang[][])
      expect(createProviders(env, p).stt.name).toBe("deepgram");
    expect(createProviders(env).stt.name).toBe("deepgram");
    expect(createProviders({ ...env, STT_PROVIDER: "openai" }, ["en", "zh"]).stt.name).toBe("openai");
  });
});

describe("server guessLang within a pair", () => {
  const cases: [Lang, string, Lang][] = [
    ["es", "Necesito cambiar mi cita.", "es"],
    ["es", "I need to change my appointment.", "en"],
    ["fr", "J'ai mal à la poitrine depuis hier.", "fr"],
    ["fr", "Je ne suis pas sûr", "fr"],
    ["fr", "Ça fait mal.", "fr"], // diacritics alone
    ["fr", "Where does it hurt?", "en"],
    ["pt", "Eu tenho dor no peito.", "pt"],
    ["pt", "Onde dói?", "pt"],
    ["pt", "I have chest pain", "en"],
    ["zh", "我胸口疼。", "zh"],
    ["zh", "我需要 MRI", "zh"],
    ["zh", "Do you have any allergies?", "en"],
  ];
  it.each(cases)("en-%s: %s -> %s", (other, text, want) => {
    expect(guessLang(text, ["en", other])).toBe(want);
  });
  it("only ever answers with one of the pair's languages; no evidence -> pair[0]", () => {
    expect(guessLang("¿Dónde le duele?", ["en", "zh"])).toBe("en");
    expect(guessLang("", ["en", "fr"])).toBe("en");
    expect(guessLang("ok", ["fr", "en"])).toBe("fr");
  });
});

describe("prompts name the pair's languages", () => {
  it("interpreter instructions and the STT hint", () => {
    expect(interpreterInstructions("en", "zh")).toContain("between English and Mandarin Chinese");
    expect(interpreterInstructions("pt", "en")).toContain("between Brazilian Portuguese and English");
    expect(sttPrompt(["en", "zh"])).toContain("English or Mandarin Chinese written in Simplified Chinese");
  });

  it("the cascade translator prompt", async () => {
    let system = "";
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      system = JSON.parse(init.body).messages[0].content;
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
    try {
      const ac = new AbortController();
      for await (const _ of openaiTranslator("k").translate(
        { turnId: "t1", text: "Bonjour", from: "fr", to: "en", context: [] },
        ac.signal,
      ));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(system).toContain("one French utterance");
    expect(system).toContain("Output only its English interpretation");
  });
});

describe("new pairs flow through the server", () => {
  const server = createAppServer({
    env: { STT_PROVIDER: "fake", TRANSLATE_PROVIDER: "fake", TTS_PROVIDER: "fake", OPENAI_API_KEY: "sk-x" },
  });
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("/cascade start accepts en-zh and rejects a pair never onboarded", async () => {
    seen.length = 0;
    const ws = new WebSocket(`ws://${base}/cascade`);
    const msgs: ServerMsg[] = [];
    ws.on("message", (d, bin) => !bin && msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "start", pair: ["en", "zh"], context: [] }));
    ws.send(Buffer.from(new Int16Array(160).buffer));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "start", pair: ["en", "de"], context: [] }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    expect(msgs.find((m) => m.type === "turn" && m.state === "done")).toMatchObject({ from: "en", to: "zh" });
    expect(seen).toContainEqual(["en", "zh"]); // the session's pair reaches per-pair STT routing
    expect(msgs.filter((m) => m.type === "error").map((m) => (m as { message: string }).message)).toEqual([
      "bad pair",
    ]);
  });

  it("/api/realtime-session builds voice-to-voice instructions for the requested pair", async () => {
    const realFetch = globalThis.fetch;
    let sent: { session: { instructions: string; audio: { input: { transcription: { prompt: string } } } } };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith("https://api.openai.com/")) return realFetch(url, init);
      sent = JSON.parse(String(init?.body));
      return Response.json({ value: "ek_test", expires_at: 1 });
    });
    try {
      const r = await fetch(`http://${base}/api/realtime-session`, {
        method: "POST",
        body: JSON.stringify({ pair: ["en", "pt"] }),
      });
      expect(r.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sent!.session.instructions).toContain("between English and Brazilian Portuguese");
    // Latin-script pairs get no transcription hint (en-es behaviour unchanged); zh pairs do
    expect(sent!.session.audio.input.transcription.prompt).toBeUndefined();
  });

  it("only pairs with a language Deepgram cannot hear get an STT hint", () => {
    expect(sttPrompt(["en", "es"])).toBeUndefined();
    expect(sttPrompt(["en", "pt"])).toBeUndefined();
    expect(sttPrompt(["en", "zh"])).toContain("English or Mandarin");
  });
});

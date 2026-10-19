// Acceptance tests for the cascade pipeline (PRD AE-003/004/009/011/024, FR-013, HLD INV-3).
// QA-owned: implementers make these pass; they never edit this file.
import { describe, expect, it } from "vitest";
import { ProviderError } from "../../src/shared/contracts.ts";
import type { SttHandlers, SttProvider, Translator, Tts, TurnUpdate } from "../../src/shared/contracts.ts";
import { createPipeline } from "../../src/server/pipeline.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeStt() {
  let h!: SttHandlers;
  const stt: SttProvider = {
    name: "fake-stt",
    open(opts) {
      h = opts;
      return { push() {}, close() {} };
    },
  };
  let n = 0;
  return {
    stt,
    final: (text: string, lang: "en" | "es" = "en") =>
      h.onFinal({ segmentId: `s${++n}`, text, lang, endMs: Date.now() }),
  };
}

/** Translator scripted per source text: string chunks with optional delays, a hang, or an error. */
function fakeTranslator(script: Record<string, Array<string | number | ProviderError> | "hang">) {
  const calls: { text: string; at: number; to: string }[] = [];
  const t: Translator = {
    name: "fake-mt",
    async *translate(req, signal) {
      calls.push({ text: req.text, at: Date.now(), to: req.to });
      const s = script[req.text];
      if (s === "hang") {
        await new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
        return;
      }
      for (const step of s ?? [req.text.toUpperCase()]) {
        if (typeof step === "number") await sleep(step);
        else if (step instanceof ProviderError) throw step;
        else yield step;
      }
    },
  };
  return { t, calls };
}

function fakeTts() {
  const calls: { text: string; at: number }[] = [];
  const tts: Tts = {
    name: "fake-tts",
    async *speak(req) {
      calls.push({ text: req.text, at: Date.now() });
      yield new Uint8Array([1, 2, 3]);
    },
  };
  return { tts, calls };
}

function run(stt: SttProvider, translator: Translator, tts: Tts, limits = { translateMs: 80, ttsMs: 80 }) {
  const turns = new Map<string, TurnUpdate>();
  const audioSeqs: number[] = [];
  const p = createPipeline({
    stt,
    translator,
    tts,
    pair: ["en", "es"],
    limits,
    events: {
      turn: (u) => turns.set(u.turnId, { ...turns.get(u.turnId), ...u }),
      audio: (seq) => audioSeqs.push(seq),
      timing: () => {},
    },
  });
  const bySrc = (src: string) => [...turns.values()].find((t) => t.srcText === src);
  return { p, turns, audioSeqs, bySrc };
}

describe("cascade pipeline acceptance", () => {
  it("FR-013 / INV-3: translation times out while the speaker keeps talking", async () => {
    const s = fakeStt();
    const mt = fakeTranslator({
      "Can you come in Thursday at 3?": "hang",
      "Or Friday morning works too.": ["O el viernes."],
    });
    const tts = fakeTts();
    const r = run(s.stt, mt.t, tts.tts);
    s.final("Can you come in Thursday at 3?");
    await sleep(10);
    s.final("Or Friday morning works too.");
    await sleep(40);
    // INV-3: the second turn is interpreted without waiting for the stuck first turn
    expect(r.bySrc("Or Friday morning works too.")?.state).toBe("done");
    await sleep(120);
    const first = r.bySrc("Can you come in Thursday at 3?");
    // FR-013: source kept, target marked not interpreted
    expect(first?.state).toBe("failed");
    expect(first?.reason).toMatch(/translat.*timeout/i);
    // INV-3: no audio ever played for the failed turn
    expect(r.audioSeqs).not.toContain(first!.seq);
    r.p.stop();
  });

  it("AE-004 / FR-004: speaking starts before translation finishes (stage overlap)", async () => {
    const s = fakeStt();
    const mt = fakeTranslator({ "Hello, how are you today?": ["Hola, ", 60, "¿cómo está hoy?"] });
    const tts = fakeTts();
    const r = run(s.stt, mt.t, tts.tts, { translateMs: 500, ttsMs: 500 });
    s.final("Hello, how are you today?");
    await sleep(200);
    expect(tts.calls.length).toBeGreaterThanOrEqual(2);
    expect(tts.calls[0].text.trim()).toBe("Hola,");
    expect(tts.calls[1].at - tts.calls[0].at).toBeGreaterThanOrEqual(40);
    r.p.stop();
  });

  it("AE-024 / FR-025: unsettled text is never spoken", async () => {
    const s = fakeStt();
    const mt = fakeTranslator({ "I have no allergies.": ["No ", 30, "tengo ", 30, "alergias."] });
    const tts = fakeTts();
    const r = run(s.stt, mt.t, tts.tts, { translateMs: 500, ttsMs: 500 });
    s.final("I have no allergies.");
    await sleep(200);
    expect(tts.calls.map((c) => c.text.trim())).toEqual(["No tengo alergias."]);
    r.p.stop();
  });

  it("AE-011 / FR-014: an empty recognition result plays nothing", async () => {
    const s = fakeStt();
    const mt = fakeTranslator({});
    const tts = fakeTts();
    const r = run(s.stt, mt.t, tts.tts);
    s.final("   ");
    await sleep(30);
    expect([...r.turns.values()][0]?.state).toBe("empty");
    expect(mt.calls).toHaveLength(0);
    expect(tts.calls).toHaveLength(0);
    r.p.stop();
  });

  it("AE-009 / FR-012: a rate-limited translation retries once after the advised wait", async () => {
    const s = fakeStt();
    let n = 0;
    const t: Translator = {
      name: "rl",
      async *translate() {
        if (n++ === 0) throw new ProviderError("translate", "rate_limited", "429", 20);
        yield "Gracias.";
      },
    };
    const tts = fakeTts();
    const r = run(s.stt, t, tts.tts, { translateMs: 500, ttsMs: 500 });
    s.final("Thanks.");
    await sleep(120);
    expect(n).toBe(2);
    expect(r.bySrc("Thanks.")?.state).toBe("done");
    r.p.stop();
  });

  it("AE-003 / FR-010: Spanish speech is interpreted into English", async () => {
    const s = fakeStt();
    const mt = fakeTranslator({ "Necesito cambiar mi cita.": ["I need to move my appointment."] });
    const tts = fakeTts();
    const r = run(s.stt, mt.t, tts.tts);
    s.final("Necesito cambiar mi cita.", "es");
    await sleep(40);
    expect(mt.calls[0].to).toBe("en");
    expect(r.bySrc("Necesito cambiar mi cita.")?.to).toBe("en");
    r.p.stop();
  });
});

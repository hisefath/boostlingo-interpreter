import { describe, expect, it } from "vitest";
import { ProviderError } from "../../src/shared/contracts.ts";
import type { Tts, TurnUpdate } from "../../src/shared/contracts.ts";
import { createPipeline } from "../../src/server/pipeline.ts";
import { fakeStt, fakeTranslator, fakeTts } from "../../src/server/providers/fake-providers.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(tts: Tts, script: Parameters<typeof fakeTranslator>[0] = {}) {
  const stt = fakeStt([
    { text: "One, two.", lang: "en" },
    { text: "Three.", lang: "en" },
  ]);
  const updates: TurnUpdate[] = [];
  const audio: { seq: number; chunk: number[] }[] = [];
  const timings: string[] = [];
  const pipeline = createPipeline({
    stt,
    translator: fakeTranslator(script),
    tts,
    pair: ["en", "es"],
    limits: { translateMs: 200, ttsMs: 50 },
    events: {
      turn: (u) => updates.push(u),
      audio: (seq, chunk) => audio.push({ seq, chunk: [...chunk] }),
      timing: (_id, point) => timings.push(point),
    },
  });
  return { pipeline, updates, audio, timings };
}

describe("pipeline (unit)", () => {
  it("speaks segments of a turn in order even when an earlier segment is slower", async () => {
    const tts: Tts = {
      name: "slow-first",
      async *speak(request) {
        await sleep(request.segmentIndex === 0 ? 30 : 0);
        yield new Uint8Array([request.segmentIndex]);
      },
    };
    const harness = setup(tts, { "One, two.": ["Uno, ", "dos."] });
    harness.pipeline.pushAudio(new Int16Array(160));
    await sleep(100);
    expect(harness.audio.map((a) => a.chunk[0])).toEqual([0, 1]);
    expect(harness.audio.every((a) => a.seq === 1)).toBe(true);
    expect(harness.updates.at(-1)).toMatchObject({
      state: "done",
      tgtText: "Uno, dos.",
      seq: 1,
      mode: "cascade",
    });
    expect(harness.timings).toEqual([
      "speech_end",
      "turn_detected",
      "stt_final",
      "first_translation",
      "first_tts_byte",
    ]);
    harness.pipeline.stop();
  });

  it("a period inside a number split across deltas is not a segment end", async () => {
    const spoken: string[] = [];
    const tts: Tts = {
      name: "rec",
      async *speak(request) {
        spoken.push(request.text);
        yield new Uint8Array([0, 0]);
      },
    };
    const harness = setup(tts, { "One, two.": ["Tome 3.", 20, "5 mg."] });
    harness.pipeline.pushAudio(new Int16Array(160));
    await sleep(80);
    expect(spoken).toEqual(["Tome 3.5 mg."]);
    harness.pipeline.stop();
  });

  it("each final is its own turn with an increasing seq", async () => {
    const harness = setup(fakeTts());
    harness.pipeline.pushAudio(new Int16Array(160));
    harness.pipeline.pushAudio(new Int16Array(160));
    await sleep(50);
    const done = harness.updates.filter((u) => u.state === "done").sort((a, b) => a.seq - b.seq);
    expect(done.map((u) => [u.seq, u.srcText, u.tgtText])).toEqual([
      [1, "One, two.", "ONE, TWO."],
      [2, "Three.", "THREE."],
    ]);
    harness.pipeline.stop();
  });

  it("a TTS timeout fails the turn and drops its later audio", async () => {
    const tts: Tts = {
      name: "hang",
      async *speak(_req, signal) {
        await new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
        yield new Uint8Array([9]);
      },
    };
    const harness = setup(tts);
    harness.pipeline.pushAudio(new Int16Array(160));
    await sleep(120);
    expect(harness.updates.at(-1)).toMatchObject({
      state: "failed",
      reason: "tts timeout",
      srcText: "One, two.",
    });
    expect(harness.audio).toHaveLength(0);
    harness.pipeline.stop();
  });

  it("a second rate limit is not retried again", async () => {
    const rateLimitError = new ProviderError("translate", "rate_limited", "429", 5);
    const harness = setup(fakeTts(), { "One, two.": [rateLimitError] });
    harness.pipeline.pushAudio(new Int16Array(160));
    await sleep(60);
    expect(harness.updates.at(-1)).toMatchObject({ state: "failed", reason: "translate rate_limited" });
    harness.pipeline.stop();
  });

  it("the translator gets only the last 5 turns as context", async () => {
    const seen: number[] = [];
    const context = Array.from(
      { length: 7 },
      (_, i) => ({ srcText: `s${i}`, tgtText: `t${i}`, from: "en", to: "es" }) as const,
    );
    const pipeline = createPipeline({
      stt: fakeStt([{ text: "Hi.", lang: "en" }]),
      translator: {
        name: "ctx",
        async *translate(request) {
          seen.push(request.context.length);
          yield request.context[0].srcText;
        },
      },
      tts: fakeTts(),
      pair: ["en", "es"],
      limits: { translateMs: 100, ttsMs: 100 },
      events: { turn() {}, audio() {}, timing() {} },
      context: [...context],
    });
    pipeline.pushAudio(new Int16Array(1));
    await sleep(20);
    expect(seen).toEqual([5]);
    pipeline.stop();
  });
});

describe("idle timeout (FR-013)", () => {
  it("a translation that keeps streaming past the limit is not cut off (limit is per silence, not total)", async () => {
    const tts: Tts = {
      name: "t",
      async *speak() {
        yield new Uint8Array([1]);
      },
    };
    // 240 ms in total, past the 200 ms limit, but never silent for 200 ms
    const harness = setup(tts, { "One, two.": ["Uno ", 120, "dos ", 120, "tres."] });
    harness.pipeline.pushAudio(new Int16Array(160));
    await sleep(400);
    const first = harness.updates.filter((u) => u.srcText === "One, two.").at(-1);
    expect(first).toMatchObject({ state: "done", tgtText: "Uno dos tres." });
    harness.pipeline.stop();
  });
});

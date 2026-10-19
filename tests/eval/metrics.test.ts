import { describe, expect, it } from "vitest";
import {
  chrF,
  criticalTermHits,
  normalise,
  pcm16ToWav,
  percentile,
  realtimeCallCost,
  resample,
  wavDurationSec,
  wer,
} from "../../scripts/eval/metrics.ts";

describe("normalise", () => {
  it("lowercases, strips punctuation, keeps accents and digits", () => {
    expect(normalise("  ¿Usted, qué me RECOMIENDA?  Tome 20 mg. ")).toBe(
      "usted qué me recomienda tome 20 mg",
    );
  });
  it("empty in, empty out", () => {
    expect(normalise("")).toBe("");
  });
});

describe("wer", () => {
  it("is 0 for identical text after normalisation", () => {
    expect(wer("Hello, world!", "hello world")).toBe(0);
  });
  it("counts substitution, deletion and insertion over reference length", () => {
    expect(wer("a b c d", "a x c d")).toBe(0.25); // 1 sub
    expect(wer("a b c d", "a c d")).toBe(0.25); // 1 del
    expect(wer("a b c d", "a b c d e")).toBe(0.25); // 1 ins
    expect(wer("a b", "")).toBe(1);
  });
  it("empty reference: 0 when hypothesis empty, insertions counted otherwise", () => {
    expect(wer("", "")).toBe(0);
    expect(wer("", "x y")).toBe(2);
  });
});

describe("chrF", () => {
  it("is 100 for identical strings and 0 for disjoint ones", () => {
    expect(chrF("Take twenty milligrams", "Take twenty milligrams")).toBeCloseTo(100);
    expect(chrF("abc", "xyz")).toBe(0);
  });
  it("ignores whitespace and drops with partial overlap", () => {
    expect(chrF("ab cd", "abcd")).toBeCloseTo(100);
    const s = chrF("take twenty milligrams twice a day", "take twenty milligrams once a day");
    expect(s).toBeGreaterThan(40);
    expect(s).toBeLessThan(100);
  });
  it("empty hypothesis or reference scores 0", () => {
    expect(chrF("", "abc")).toBe(0);
    expect(chrF("abc", "")).toBe(0);
  });
});

describe("percentile", () => {
  it("interpolates linearly between ranks", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBeCloseTo(48);
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(percentile([5, 1, 3], 100)).toBe(5);
  });
  it("single value and empty input", () => {
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });
});

describe("criticalTermHits", () => {
  it("matches whole normalised terms only", () => {
    const r = criticalTermHits(
      ["20 milligrams", "no aspirin", "March 3"],
      "Take 20 milligrams twice a day, no aspirin.",
    );
    expect(r).toEqual({ hits: 2, total: 3, missing: ["March 3"] });
  });
  it("does not match inside a longer number", () => {
    expect(criticalTermHits(["3"], "March 13").hits).toBe(0);
  });
  it("no terms = nothing to miss", () => {
    expect(criticalTermHits([], "anything")).toEqual({ hits: 0, total: 0, missing: [] });
  });
});

describe("realtimeCallCost", () => {
  const p = { audioInPer1M: 32, audioOutPer1M: 64, cachedInPer1M: 0.4, transcribePerMin: 0.006 };
  it("1 minute: no prior context to re-bill", () => {
    // (600*32 + 1200*1*64)/1e6 + 0.006 = 0.0192 + 0.0768 + 0.006
    expect(realtimeCallCost(1, 1, p)).toBeCloseTo(0.102, 6);
  });
  it("re-bills prior minutes as cached input: M(M-1)/2 * tokens/min", () => {
    // 5 min: 5*0.102 + 10 * (600+1200)*0.4/1e6
    expect(realtimeCallCost(5, 1, p)).toBeCloseTo(5 * 0.102 + (10 * 1800 * 0.4) / 1e6, 6);
    const c21 = realtimeCallCost(21, 1, p);
    expect(c21).toBeCloseTo(21 * 0.102 + (210 * 1800 * 0.4) / 1e6, 6);
    expect(c21 / 21).toBeGreaterThan(realtimeCallCost(1, 1, p));
  });
  it("output ratio r scales output tokens", () => {
    expect(realtimeCallCost(1, 0.5, p)).toBeCloseTo(0.0192 + 0.0384 + 0.006, 6);
  });
});

describe("wav helpers", () => {
  it("round-trips duration and resamples 24k to 16k", () => {
    const pcm = new Int16Array(24000);
    const down = resample(pcm, 24000, 16000);
    expect(down.length).toBe(16000);
    expect(wavDurationSec(pcm16ToWav(down, 16000))).toBeCloseTo(1);
  });
});

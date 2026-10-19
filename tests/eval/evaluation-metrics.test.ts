import { describe, expect, it } from "vitest";
import {
  chrF,
  criticalTermHits,
  normaliseText,
  pcm16ToWav,
  interpolatedPercentile,
  voiceToVoiceCallCost,
  resamplePcm16,
  wavDurationSeconds,
  wordErrorRate,
} from "../../scripts/eval/evaluation-metrics.ts";

describe("normaliseText", () => {
  it("lowercases, strips punctuation, keeps accents and digits", () => {
    expect(normaliseText("  ¿Usted, qué me RECOMIENDA?  Tome 20 mg. ")).toBe(
      "usted qué me recomienda tome 20 mg",
    );
  });
  it("empty in, empty out", () => {
    expect(normaliseText("")).toBe("");
  });
});

describe("wordErrorRate", () => {
  it("is 0 for identical text after normalisation", () => {
    expect(wordErrorRate("Hello, world!", "hello world")).toBe(0);
  });
  it("counts substitution, deletion and insertion over reference length", () => {
    expect(wordErrorRate("a b c d", "a x c d")).toBe(0.25); // 1 sub
    expect(wordErrorRate("a b c d", "a c d")).toBe(0.25); // 1 del
    expect(wordErrorRate("a b c d", "a b c d e")).toBe(0.25); // 1 ins
    expect(wordErrorRate("a b", "")).toBe(1);
  });
  it("empty reference: 0 when hypothesis empty, insertions counted otherwise", () => {
    expect(wordErrorRate("", "")).toBe(0);
    expect(wordErrorRate("", "x y")).toBe(2);
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

describe("interpolatedPercentile", () => {
  it("interpolates linearly between ranks", () => {
    expect(interpolatedPercentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(interpolatedPercentile([10, 20, 30, 40, 50], 95)).toBeCloseTo(48);
    expect(interpolatedPercentile([5, 1, 3], 0)).toBe(1);
    expect(interpolatedPercentile([5, 1, 3], 100)).toBe(5);
  });
  it("single value and empty input", () => {
    expect(interpolatedPercentile([7], 95)).toBe(7);
    expect(interpolatedPercentile([], 50)).toBeNaN();
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

describe("voiceToVoiceCallCost", () => {
  const prices = { audioInPer1M: 32, audioOutPer1M: 64, cachedInPer1M: 0.4, transcribePerMin: 0.006 };
  it("1 minute: no prior context to re-bill", () => {
    // (600*32 + 1200*1*64)/1e6 + 0.006 = 0.0192 + 0.0768 + 0.006
    expect(voiceToVoiceCallCost(1, 1, prices)).toBeCloseTo(0.102, 6);
  });
  it("re-bills prior minutes as cached input: M(M-1)/2 * tokens/min", () => {
    // 5 min: 5*0.102 + 10 * (600+1200)*0.4/1e6
    expect(voiceToVoiceCallCost(5, 1, prices)).toBeCloseTo(5 * 0.102 + (10 * 1800 * 0.4) / 1e6, 6);
    const c21 = voiceToVoiceCallCost(21, 1, prices);
    expect(c21).toBeCloseTo(21 * 0.102 + (210 * 1800 * 0.4) / 1e6, 6);
    expect(c21 / 21).toBeGreaterThan(voiceToVoiceCallCost(1, 1, prices));
  });
  it("output ratio r scales output tokens", () => {
    expect(voiceToVoiceCallCost(1, 0.5, prices)).toBeCloseTo(0.0192 + 0.0384 + 0.006, 6);
  });
});

describe("wav helpers", () => {
  it("round-trips duration and resamples 24k to 16k", () => {
    const pcm = new Int16Array(24000);
    const down = resamplePcm16(pcm, 24000, 16000);
    expect(down.length).toBe(16000);
    expect(wavDurationSeconds(pcm16ToWav(down, 16000))).toBeCloseTo(1);
  });
});

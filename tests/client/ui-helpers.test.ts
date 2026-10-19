import { describe, expect, it } from "vitest";
import {
  cascadeLayers,
  modeSummary,
  orbState,
  percentile,
  resultReady,
  rmsLevel,
  summaryLines,
  termResult,
  termTiming,
} from "../../src/client/lib.ts";

const FULL = {
  speech_end: 1000,
  turn_detected: 1200,
  stt_final: 1312,
  first_translation: 1700,
  first_tts_byte: 2000,
  first_audio: 2100,
  audio_end: 4000,
};

describe("rmsLevel", () => {
  it("is 0 for silence and empty input", () => {
    expect(rmsLevel(new Float32Array(256))).toBe(0);
    expect(rmsLevel(new Float32Array(0))).toBe(0);
  });
  it("is 1 for a loud signal and in between for quiet speech", () => {
    const loud = new Float32Array(256).map((_, i) => 0.8 * Math.sin(i / 3));
    const quiet = new Float32Array(256).map((_, i) => 0.03 * Math.sin(i / 3));
    expect(rmsLevel(loud)).toBe(1);
    const q = rmsLevel(quiet);
    expect(q).toBeGreaterThan(0);
    expect(q).toBeLessThan(1);
  });
  it("grows with loudness", () => {
    const at = (a: number) => rmsLevel(new Float32Array(256).map((_, i) => a * Math.sin(i / 3)));
    expect(at(0.01)).toBeLessThan(at(0.02));
    expect(at(0.02)).toBeLessThan(at(0.05));
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
    expect(
      percentile(
        Array.from({ length: 20 }, (_, i) => i + 1),
        95,
      ),
    ).toBe(19);
  });
});

describe("modeSummary / summaryLines", () => {
  const turns = [
    { mode: "cascade" as const, timings: FULL },
    { mode: "cascade" as const, timings: { ...FULL, first_audio: 3000, audio_end: 5000 } },
    { mode: "realtime" as const, timings: { speech_end: 1000, turn_detected: 1500, first_audio: 1800 } },
  ];
  it("computes p50/p95 per mode and per-stage p50 for cascade only", () => {
    const c = modeSummary(turns, "cascade");
    expect(c.turns).toBe(2);
    expect(c.firstAudio).toEqual({ p50: 1100, p95: 2000 });
    expect(c.audioEnd).toEqual({ p50: 3000, p95: 4000 });
    expect(c.stages?.map((s) => s.p50)).toEqual([200, 112, 388, 300, 100]);
    const r = modeSummary(turns, "realtime");
    expect(r.turns).toBe(1);
    expect(r.firstAudio).toEqual({ p50: 800, p95: 800 });
    expect(r.audioEnd).toBeNull();
    expect(r.stages).toBeNull();
  });
  it("prints n/a (not observable) for voice-to-voice stages, and a dash for no data yet", () => {
    const r = summaryLines(modeSummary(turns, "realtime")).join("\n");
    expect(r).toContain("n/a (not observable)");
    expect(r).toMatch(/audio_end\s+p50 —/);
    expect(r).not.toMatch(/stage.*\d+ ms/);
    const c = summaryLines(modeSummary(turns, "cascade")).join("\n");
    expect(c).not.toContain("n/a");
    expect(c).toContain("p50 1100 ms  p95 2000 ms");
    expect(summaryLines(modeSummary([], "cascade")).join("\n")).toContain("turns 0");
  });
});

describe("terminal lines", () => {
  const at = new Date(2026, 9, 18, 23, 41, 2, 120).getTime();
  it("formats a timing line with clock, mode, turn, point, vendor and delta", () => {
    const line = termTiming(at, "cascade", 2, "stt_final", "deepgram", 312);
    expect(line).toMatch(/^23:41:02\.120 {2}cascade {2}t3 {2}stt_final +deepgram +\+312 ms$/);
  });
  it("marks voice-to-voice speech end as approximate and omits a missing delta", () => {
    expect(termTiming(at, "realtime", 0, "speech_end")).toContain("≈ VAD silence 500 ms");
    expect(termTiming(at, "cascade", 0, "speech_end").trimEnd()).toMatch(/speech_end$/);
  });
  it("formats turn results against the 3000 ms target, failures with the reason", () => {
    const ok = termResult(at, "cascade", 2, "done", { speech_end: 1000, first_audio: 3678 });
    expect(ok.text).toContain("✓ first audio 2678 ms  (target < 3000)");
    expect(ok.tone).toBe("ok");
    expect(termResult(at, "cascade", 2, "done", { speech_end: 0, first_audio: 3400 }).tone).toBe("bad");
    const failed = termResult(at, "cascade", 2, "failed", {}, "translate timeout");
    expect(failed.text).toContain("✗ not interpreted (translate timeout)");
    expect(failed.tone).toBe("bad");
    expect(termResult(at, "realtime", 0, "empty", {}).text).toContain("nothing heard");
  });
});

describe("resultReady", () => {
  it("waits for end of audio on a done turn that has audio", () => {
    expect(resultReady("speaking", FULL)).toBe(false);
    expect(resultReady("done", { ...FULL, audio_end: undefined })).toBe(false);
    expect(resultReady("done", FULL)).toBe(true);
    expect(resultReady("done", { speech_end: 1 })).toBe(true);
    expect(resultReady("failed", {})).toBe(true);
    expect(resultReady("cut", { first_audio: 1 })).toBe(true);
  });
});

describe("cascadeLayers", () => {
  it("is all waiting without a turn", () => {
    expect(cascadeLayers(undefined).map((l) => l.status)).toEqual(["waiting", "waiting", "waiting"]);
  });
  it("marks done stages with ms and the next stage active", () => {
    const l = cascadeLayers({ state: "translating", timings: { speech_end: 1000, stt_final: 1312 } });
    expect(l.map((x) => x.status)).toEqual(["done", "active", "waiting"]);
    expect(l[0].ms).toBe(312);
  });
  it("blames the stage named in the failure reason", () => {
    const l = cascadeLayers({
      state: "failed",
      timings: { speech_end: 1000, stt_final: 1312 },
      reason: "translate timeout",
    });
    expect(l.map((x) => x.status)).toEqual(["done", "failed", "waiting"]);
    expect(l[1].note).toBe("translate timeout");
  });
  it("blames the first unfinished stage when the reason names none", () => {
    const l = cascadeLayers({ state: "failed", timings: FULL_NO_TTS, reason: "boom" });
    expect(l.map((x) => x.status)).toEqual(["done", "done", "failed"]);
  });
  it("reports all three stage durations for a finished turn", () => {
    expect(cascadeLayers({ state: "done", timings: FULL }).map((x) => x.ms)).toEqual([312, 388, 300]);
  });
});
const FULL_NO_TTS = { speech_end: 1000, stt_final: 1312, first_translation: 1700 };

describe("orbState", () => {
  it("maps session and turn state to an orb state", () => {
    expect(orbState(false, "speaking")).toBe("idle");
    expect(orbState(true, undefined)).toBe("listening");
    expect(orbState(true, "done")).toBe("listening");
    expect(orbState(true, "hearing")).toBe("listening");
    expect(orbState(true, "translating")).toBe("translating");
    expect(orbState(true, "speaking")).toBe("speaking");
  });
});

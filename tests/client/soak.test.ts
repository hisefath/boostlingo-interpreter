import { describe, expect, it } from "vitest";
import {
  drift,
  heapGrowthPct,
  median,
  soakLine,
  summarizeSoak,
  type SoakInput,
} from "../../src/client/soak.ts";

// 24 cascade turns: speech_end→first_audio 1500 ms, first_tts_byte→first_audio 100 ms, unless overridden
const cascadeTurn = (i: number, firstAudio = 1500, lag = 100) => ({
  state: "done" as const,
  timings: {
    speech_end: i * 10_000,
    first_tts_byte: i * 10_000 + firstAudio - lag,
    first_audio: i * 10_000 + firstAudio,
    audio_end: i * 10_000 + firstAudio + 3000,
  },
});
const MB = 1_000_000;
const flatHeap = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300].map((s) => ({
  atMs: s * 1000,
  bytes: (s < 60 ? 40 : 50) * MB, // warm-up jump, then flat
}));
const healthy = (over: Partial<SoakInput> = {}): SoakInput => ({
  durationMs: 300_000,
  attempted: 24,
  turns: Array.from({ length: 24 }, (_, i) => cascadeTurn(i)),
  notices: [],
  heap: flatHeap,
  ...over,
});

describe("median and drift", () => {
  it("median is the nearest-rank p50 used elsewhere, null when empty", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
  it("drift compares the median of the last 5 with the first 5", () => {
    expect(drift([100, 100, 100, 100, 100, 999, 999, 400, 400, 400, 400, 400])).toBe(300);
    expect(drift([100, 300])).toBe(200); // short run: one value per end, never overlapping
    expect(drift([100])).toBeNull();
  });
});

describe("heapGrowthPct", () => {
  it("measures from the first sample after warm-up, not the start", () => {
    expect(heapGrowthPct(flatHeap)).toBe(0);
    const grown = [...flatHeap.slice(0, -1), { atMs: 300_000, bytes: 60 * MB }];
    expect(heapGrowthPct(grown)).toBe(20);
  });
  it("falls back to the first sample for a short run and is null without samples", () => {
    expect(
      heapGrowthPct([
        { atMs: 0, bytes: 40 * MB },
        { atMs: 30_000, bytes: 44 * MB },
      ]),
    ).toBe(10);
    expect(heapGrowthPct([])).toBeNull();
  });
});

describe("summarizeSoak vs NFR-003", () => {
  it("passes a healthy 5-minute run", () => {
    const s = summarizeSoak(healthy());
    expect(s).toMatchObject({
      turnsAttempted: 24,
      turnsCompleted: 24,
      turnsFailed: 0,
      disconnects: 0,
      reconnects: 0,
      lagSource: "player",
      lagGrowthMs: 0,
      firstAudioFirstMedianMs: 1500,
      firstAudioLastMedianMs: 1500,
      heapGrowthPct: 0,
      pass: true,
    });
    expect(soakLine(s, "soak-x")).toMatch(/^Soak PASS \(300 s\) · turns 24\/24 done.*saved as soak-x$/);
  });
  it("fails on any disconnect and counts a reconnect, not the reconnect-failed follow-up twice", () => {
    const s = summarizeSoak(
      healthy({
        notices: [
          "cascade connection lost, reconnecting…",
          "reconnected",
          "cascade connection lost",
          "cascade connection lost; reconnect failed",
          "Listening.",
        ],
      }),
    );
    expect(s.disconnects).toBe(2);
    expect(s.reconnects).toBe(1);
    expect(s.checks.noDisconnects).toBe(false);
    expect(s.pass).toBe(false);
  });
  it("fails when playback lag grows more than 250 ms from the first to the last turns", () => {
    const turns = Array.from({ length: 24 }, (_, i) => cascadeTurn(i, 1500, i < 12 ? 100 : 351));
    const s = summarizeSoak(healthy({ turns }));
    expect(s.lagGrowthMs).toBe(251);
    expect(s.pass).toBe(false);
    const ok = summarizeSoak(
      healthy({ turns: turns.map((_, i) => cascadeTurn(i, 1500, i < 12 ? 100 : 350)) }),
    );
    expect(ok.pass).toBe(true);
  });
  it("uses speech_end→first_audio drift when the player lag is not observable (voice-to-voice)", () => {
    const turns = Array.from({ length: 24 }, (_, i) => ({
      state: "done" as const,
      timings: { speech_end: i * 10_000, first_audio: i * 10_000 + (i < 12 ? 900 : 1300) },
    }));
    const s = summarizeSoak(healthy({ turns }));
    expect(s.lagSource).toBe("first_audio");
    expect(s.firstAudioDriftMs).toBe(400);
    expect(s.lagGrowthMs).toBe(400);
    expect(s.pass).toBe(false);
  });
  it("fails on heap growth over 20 % after warm-up, but not when the browser cannot measure heap", () => {
    const grown = [...flatHeap.slice(0, -1), { atMs: 300_000, bytes: 60.5 * MB }];
    expect(summarizeSoak(healthy({ heap: grown })).pass).toBe(false);
    const noHeap = summarizeSoak(healthy({ heap: [] }));
    expect(noHeap.heapGrowthPct).toBeNull();
    expect(noHeap.pass).toBe(true);
  });
  it("fails a run with fewer than 20 completed turns and counts failed ones", () => {
    const turns = Array.from({ length: 24 }, (_, i) =>
      i % 5 === 0 ? { state: "failed" as const, timings: {} } : cascadeTurn(i),
    );
    const s = summarizeSoak(healthy({ turns }));
    expect(s.turnsCompleted).toBe(19);
    expect(s.turnsFailed).toBe(5);
    expect(s.checks.minTurns).toBe(false);
    expect(s.pass).toBe(false);
  });
});

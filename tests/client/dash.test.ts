import { describe, expect, it } from "vitest";
import type { Mode, TurnState } from "../../src/shared/contracts.ts";
import { dashHtml, modeDash, NA_WHY, P50_TARGET_MS, stat } from "../../src/client/dash.ts";
import { resultLine } from "../../src/client/term.ts";

const FULL = {
  speech_end: 1000,
  turn_detected: 1200,
  stt_final: 1312,
  first_translation: 1700,
  first_tts_byte: 2000,
  first_audio: 2100,
  audio_end: 4000,
};
const turn = (mode: Mode, state: TurnState, timings: Record<string, number> = {}) => ({
  mode,
  state,
  timings,
});
/** a done turn whose first audio lands `ms` after speech end */
const fa = (mode: Mode, ms: number) => turn(mode, "done", { speech_end: 0, first_audio: ms });

describe("stat", () => {
  it("computes n, rounded mean and linear-interpolated p50/p90/p95 (the eval report's definition)", () => {
    // 1..10 ×100: linear p50 = 550, p90 = 910, p95 = 955 (nearest-rank would give 500, 900, 1000)
    const xs = [700, 100, 1000, 300, 200, 900, 400, 600, 500, 800];
    expect(stat(xs)).toEqual({ n: 10, avg: 550, p50: 550, p90: 910, p95: 955 });
    expect(stat([1, 2])).toEqual({ n: 2, avg: 2, p50: 2, p90: 2, p95: 2 }); // 1.5 / 1.9 / 1.95 round to 2
    expect(stat([10, 20, 31])).toMatchObject({ avg: 20, p50: 20, p90: 29 }); // 20.33 → 20; 28.8 → 29
  });
  it("one sample is every statistic; no samples is n 0 and nulls", () => {
    expect(stat([1234])).toEqual({ n: 1, avg: 1234, p50: 1234, p90: 1234, p95: 1234 });
    expect(stat([])).toEqual({ n: 0, avg: null, p50: null, p90: null, p95: null });
  });
});

describe("modeDash", () => {
  const turns = [
    turn("cascade", "done", FULL),
    turn("cascade", "done", { ...FULL, first_audio: 3000, audio_end: 5000 }),
    turn("realtime", "done", FULL), // voice-to-voice: stage points are ignored even when present
    turn("realtime", "cut", { speech_end: 0, first_audio: 900 }),
  ];

  it("cascade: first audio, end of audio, turn detect and every stage, in that order", () => {
    const c = modeDash(turns, "cascade");
    expect(c.rows.map((r) => r.name)).toEqual([
      "first audio",
      "end of audio",
      "turn detect",
      "stt final",
      "translate",
      "tts 1st byte",
      "playback",
    ]);
    expect(c.rows[0].stat).toEqual({ n: 2, avg: 1550, p50: 1550, p90: 1910, p95: 1955 });
    expect(c.rows[1].stat).toEqual({ n: 2, avg: 3500, p50: 3500, p90: 3900, p95: 3950 });
    expect(c.rows.slice(2).map((r) => r.stat?.p50)).toEqual([200, 112, 388, 300, 550]);
  });

  it("voice-to-voice: totals are numbers, turn detect and stages are n/a (null), never a number", () => {
    const r = modeDash(turns, "realtime");
    expect(r.rows[0].stat).toMatchObject({ n: 2, avg: 1000, p50: 1000 });
    expect(r.rows[1].stat).toMatchObject({ n: 1, avg: 3000 });
    expect(r.rows.slice(2).map((x) => x.stat)).toEqual([null, null, null, null, null]);
    expect(
      modeDash([], "realtime")
        .rows.slice(2)
        .every((x) => x.stat === null),
    ).toBe(true);
    expect(NA_WHY["turn detect"]).toMatch(/500 ms/);
    expect(NA_WHY.stage).toMatch(/not observable/);
  });

  it("a metric with no samples yet has n 0 (shown as —), not n/a", () => {
    const c = modeDash([turn("cascade", "failed", { speech_end: 0, turn_detected: 300 })], "cascade");
    expect(c.rows[0].stat).toEqual({ n: 0, avg: null, p50: null, p90: null, p95: null });
    expect(c.rows[2].stat).toMatchObject({ n: 1, p50: 300 });
  });

  it("counts outcomes per mode; success = (done + cut) / (done + cut + failed), empty excluded", () => {
    const mixed = [
      turn("cascade", "done"),
      turn("cascade", "done"),
      turn("cascade", "cut"),
      turn("cascade", "failed"),
      turn("cascade", "empty"),
      turn("cascade", "empty"),
      turn("cascade", "speaking"), // in flight: not counted
      turn("realtime", "failed"),
    ];
    const c = modeDash(mixed, "cascade");
    expect(c.counts).toEqual({ done: 2, cut: 1, failed: 1, empty: 2 });
    expect(c.success).toBe(0.75);
    expect(modeDash(mixed, "realtime").success).toBe(0);
    expect(modeDash([turn("cascade", "empty")], "cascade").success).toBeNull();
  });

  it("verdict: first-audio p50 strictly under the PRD target (1500 ms v2v, 3000 ms cascade); none without data", () => {
    expect(P50_TARGET_MS).toEqual({ realtime: 1500, cascade: 3000 });
    expect(modeDash([fa("realtime", 1499)], "realtime")).toMatchObject({ target: 1500, meets: true });
    expect(modeDash([fa("realtime", 1500)], "realtime").meets).toBe(false);
    expect(modeDash([fa("cascade", 2999)], "cascade")).toMatchObject({ target: 3000, meets: true });
    expect(modeDash([fa("cascade", 3000)], "cascade").meets).toBe(false);
    // judged on p50, not avg or p95: one slow outlier does not flip it
    expect(
      modeDash([fa("realtime", 900), fa("realtime", 1000), fa("realtime", 9000)], "realtime").meets,
    ).toBe(true);
    expect(modeDash([], "cascade").meets).toBeNull();
  });

  it("the log's per-turn verdict uses the same per-mode target", () => {
    const v = (mode: Mode) => resultLine(0, mode, 0, "done", { speech_end: 0, first_audio: 2000 });
    expect(
      v("realtime")
        .find((t) => t.kind === "verdict")!
        .text.trim(),
    ).toBe("✗");
    expect(
      v("cascade")
        .find((t) => t.kind === "verdict")!
        .text.trim(),
    ).toBe("✓");
  });
});

describe("dashHtml", () => {
  it("renders n/a cells (with a reason) only where a mode cannot observe, and the verdict per mode", () => {
    const html = dashHtml([fa("realtime", 1600), fa("cascade", 2000)]);
    expect(html.match(/class="na" title="[^"]+">n\/a</g)).toHaveLength(5);
    expect(html).toContain("✗ &lt; 1500");
    expect(html).toContain("✓ &lt; 3000");
  });
});

describe("dashHtml rendering (review M5-T010: markup was untested)", () => {
  const turns = [
    turn("cascade", "done", FULL),
    turn("cascade", "done", { ...FULL, first_audio: 3000, audio_end: 5000 }),
  ];
  const html = dashHtml(turns);
  it("renders a row's cells in avg / p50 / p90 / p95 / n order", () => {
    expect(html).toContain("<td>1550</td><td>1550</td><td>1910</td><td>1955</td><td>2</td>");
  });
  it("headline tile shows p50 big and p95 underneath", () => {
    expect(html).toMatch(/tile-big">1550/);
    expect(html).toMatch(/p95 1955/);
  });
  it("a mode with no samples shows dashes, never a 0", () => {
    const empty = dashHtml([]);
    const dash = '<td><span class="u">—</span></td>';
    // avg/p50/p90/p95 are dashes; only the sample count n reads 0
    expect(empty).toContain(`${dash}${dash}${dash}${dash}<td>0</td>`);
    expect(empty).not.toMatch(/<td>0<\/td><td>/);
  });
});

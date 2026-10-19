import { describe, expect, it } from "vitest";
import type { Mode, TurnState } from "../../src/shared/contracts.ts";
import {
  metricsDashboardHtml,
  buildModeDashboard,
  NOT_AVAILABLE_REASONS,
  FIRST_AUDIO_P50_TARGET_MS,
  computeStatistics,
} from "../../src/client/metrics-dashboard.ts";
import { resultLine } from "../../src/client/metrics-terminal.ts";

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
const firstAudioTurn = (mode: Mode, ms: number) => turn(mode, "done", { speech_end: 0, first_audio: ms });

describe("computeStatistics", () => {
  it("computes n, rounded mean and linear-interpolated p50/p90/p95 (the eval report's definition)", () => {
    // 1..10 ×100: linear p50 = 550, p90 = 910, p95 = 955 (nearest-rank would give 500, 900, 1000)
    const values = [700, 100, 1000, 300, 200, 900, 400, 600, 500, 800];
    expect(computeStatistics(values)).toEqual({ n: 10, average: 550, p50: 550, p90: 910, p95: 955 });
    expect(computeStatistics([1, 2])).toEqual({ n: 2, average: 2, p50: 2, p90: 2, p95: 2 }); // 1.5 / 1.9 / 1.95 round to 2
    expect(computeStatistics([10, 20, 31])).toMatchObject({ average: 20, p50: 20, p90: 29 }); // 20.33 → 20; 28.8 → 29
  });
  it("one sample is every statistic; no samples is n 0 and nulls", () => {
    expect(computeStatistics([1234])).toEqual({ n: 1, average: 1234, p50: 1234, p90: 1234, p95: 1234 });
    expect(computeStatistics([])).toEqual({ n: 0, average: null, p50: null, p90: null, p95: null });
  });
});

describe("buildModeDashboard", () => {
  const turns = [
    turn("cascade", "done", FULL),
    turn("cascade", "done", { ...FULL, first_audio: 3000, audio_end: 5000 }),
    turn("realtime", "done", FULL), // voice-to-voice: stage points are ignored even when present
    turn("realtime", "cut", { speech_end: 0, first_audio: 900 }),
  ];

  it("cascade: first audio, end of audio, turn detect and every stage, in that order", () => {
    const cascade = buildModeDashboard(turns, "cascade");
    expect(cascade.rows.map((row) => row.name)).toEqual([
      "first audio",
      "end of audio",
      "turn detect",
      "stt final",
      "translate",
      "tts 1st byte",
      "playback",
    ]);
    expect(cascade.rows[0].statistics).toEqual({ n: 2, average: 1550, p50: 1550, p90: 1910, p95: 1955 });
    expect(cascade.rows[1].statistics).toEqual({ n: 2, average: 3500, p50: 3500, p90: 3900, p95: 3950 });
    expect(cascade.rows.slice(2).map((row) => row.statistics?.p50)).toEqual([200, 112, 388, 300, 550]);
  });

  it("voice-to-voice: totals are numbers, turn detect and stages are n/a (null), never a number", () => {
    const voiceToVoice = buildModeDashboard(turns, "realtime");
    expect(voiceToVoice.rows[0].statistics).toMatchObject({ n: 2, average: 1000, p50: 1000 });
    expect(voiceToVoice.rows[1].statistics).toMatchObject({ n: 1, average: 3000 });
    expect(voiceToVoice.rows.slice(2).map((row) => row.statistics)).toEqual([null, null, null, null, null]);
    expect(
      buildModeDashboard([], "realtime")
        .rows.slice(2)
        .every((row) => row.statistics === null),
    ).toBe(true);
    expect(NOT_AVAILABLE_REASONS["turn detect"]).toMatch(/500 ms/);
    expect(NOT_AVAILABLE_REASONS.stage).toMatch(/not observable/);
  });

  it("a metric with no samples yet has n 0 (shown as —), not n/a", () => {
    const cascade = buildModeDashboard(
      [turn("cascade", "failed", { speech_end: 0, turn_detected: 300 })],
      "cascade",
    );
    expect(cascade.rows[0].statistics).toEqual({ n: 0, average: null, p50: null, p90: null, p95: null });
    expect(cascade.rows[2].statistics).toMatchObject({ n: 1, p50: 300 });
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
    const cascade = buildModeDashboard(mixed, "cascade");
    expect(cascade.counts).toEqual({ done: 2, cut: 1, failed: 1, empty: 2 });
    expect(cascade.successRate).toBe(0.75);
    expect(buildModeDashboard(mixed, "realtime").successRate).toBe(0);
    expect(buildModeDashboard([turn("cascade", "empty")], "cascade").successRate).toBeNull();
  });

  it("verdict: first-audio p50 strictly under the PRD target (1500 ms v2v, 3000 ms cascade); none without data", () => {
    expect(FIRST_AUDIO_P50_TARGET_MS).toEqual({ realtime: 1500, cascade: 3000 });
    expect(buildModeDashboard([firstAudioTurn("realtime", 1499)], "realtime")).toMatchObject({
      target: 1500,
      meetsTarget: true,
    });
    expect(buildModeDashboard([firstAudioTurn("realtime", 1500)], "realtime").meetsTarget).toBe(false);
    expect(buildModeDashboard([firstAudioTurn("cascade", 2999)], "cascade")).toMatchObject({
      target: 3000,
      meetsTarget: true,
    });
    expect(buildModeDashboard([firstAudioTurn("cascade", 3000)], "cascade").meetsTarget).toBe(false);
    // judged on p50, not average or p95: one slow outlier does not flip it
    expect(
      buildModeDashboard(
        [firstAudioTurn("realtime", 900), firstAudioTurn("realtime", 1000), firstAudioTurn("realtime", 9000)],
        "realtime",
      ).meetsTarget,
    ).toBe(true);
    expect(buildModeDashboard([], "cascade").meetsTarget).toBeNull();
  });

  it("the log's per-turn verdict uses the same per-mode target", () => {
    const verdictLine = (mode: Mode) => resultLine(0, mode, 0, "done", { speech_end: 0, first_audio: 2000 });
    expect(
      verdictLine("realtime")
        .find((token) => token.kind === "verdict")!
        .text.trim(),
    ).toBe("✗");
    expect(
      verdictLine("cascade")
        .find((token) => token.kind === "verdict")!
        .text.trim(),
    ).toBe("✓");
  });
});

describe("metricsDashboardHtml", () => {
  it("renders n/a cells (with a reason) only where a mode cannot observe, and the verdict per mode", () => {
    const html = metricsDashboardHtml([firstAudioTurn("realtime", 1600), firstAudioTurn("cascade", 2000)]);
    expect(html.match(/class="not-available" title="[^"]+">n\/a</g)).toHaveLength(5);
    expect(html).toContain("✗ &lt; 1500");
    expect(html).toContain("✓ &lt; 3000");
  });
});

describe("metricsDashboardHtml rendering (review M5-T010: markup was untested)", () => {
  const turns = [
    turn("cascade", "done", FULL),
    turn("cascade", "done", { ...FULL, first_audio: 3000, audio_end: 5000 }),
  ];
  const html = metricsDashboardHtml(turns);
  it("renders a row's cells in avg / p50 / p90 / p95 / n order", () => {
    expect(html).toContain("<td>1550</td><td>1550</td><td>1910</td><td>1955</td><td>2</td>");
  });
  it("headline tile shows p50 big and p95 underneath", () => {
    expect(html).toMatch(/tile-headline">1550/);
    expect(html).toMatch(/p95 1955/);
  });
  it("a mode with no samples shows dashes, never a 0", () => {
    const empty = metricsDashboardHtml([]);
    const dashCell = '<td><span class="unit">—</span></td>';
    // avg/p50/p90/p95 are dashes; only the sample count n reads 0
    expect(empty).toContain(`${dashCell}${dashCell}${dashCell}${dashCell}<td>0</td>`);
    expect(empty).not.toMatch(/<td>0<\/td><td>/);
  });
});

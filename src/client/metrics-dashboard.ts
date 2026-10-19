// Mini metrics dashboard (pure, no DOM; returns markup): per mode, n / avg / p50 / p90 / p95 for every timing the mode can
// observe, turn outcomes and the first-audio verdict against the PRD targets. Same spans as the log (summarizeTimings).
import type { Mode, TurnState } from "../shared/contracts.ts";
// the evaluation report's percentile (linear interpolation, numpy default), imported so the page and the report agree
import { interpolatedPercentile } from "../../scripts/eval/evaluation-metrics.ts";
import {
  CASCADE_FIRST_AUDIO_TARGET_MS,
  MODE_LABELS,
  summarizeTimings,
  type Timings,
} from "./timing-and-audio-helpers.ts";

/** speech end → first audio at p50: NFR-001 (voice-to-voice < 1.5 s), NFR-002 (cascade < 3 s) */
export const FIRST_AUDIO_P50_TARGET_MS: Record<Mode, number> = {
  realtime: 1500,
  cascade: CASCADE_FIRST_AUDIO_TARGET_MS,
};

export interface Statistics {
  n: number;
  /** ms, rounded; null when n = 0 */
  average: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
}

export function computeStatistics(values: number[]): Statistics {
  if (!values.length) return { n: 0, average: null, p50: null, p90: null, p95: null };
  const roundedPercentile = (q: number) => Math.round(interpolatedPercentile(values, q));
  return {
    n: values.length,
    average: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    p50: roundedPercentile(50),
    p90: roundedPercentile(90),
    p95: roundedPercentile(95),
  };
}

export interface MetricRow {
  name: string;
  /** null = this mode cannot observe the metric (FR-026): shown as n/a, never a number */
  statistics: Statistics | null;
}
export type Outcome = "done" | "cut" | "failed" | "empty";
export interface ModeDashboard {
  mode: Mode;
  /** first audio, end of audio, then turn detect and the cascade stages */
  rows: MetricRow[];
  counts: Record<Outcome, number>;
  /** (done + cut) / (done + cut + failed); empty turns had nothing to interpret. null = no attempts yet */
  successRate: number | null;
  target: number;
  /** first-audio p50 under target; null = no data yet */
  meetsTarget: boolean | null;
}

const metricColumns = (timings: Timings, mode: Mode) => {
  const summary = summarizeTimings(timings, mode);
  return [
    { name: "first audio", ms: summary.toFirstAudio, observable: true },
    { name: "end of audio", ms: summary.toAudioEnd, observable: true },
    ...summary.stages,
  ];
};

export function buildModeDashboard(
  turns: { mode: Mode; state: TurnState; timings: Timings }[],
  mode: Mode,
): ModeDashboard {
  const modeTurns = turns.filter((t) => t.mode === mode);
  const columnsPerTurn = modeTurns.map((t) => metricColumns(t.timings, mode));
  const rows = metricColumns({}, mode).map((column, i) => ({
    name: column.name,
    statistics: column.observable
      ? computeStatistics(
          columnsPerTurn.map((columns) => columns[i].ms).filter((x): x is number => x !== null),
        )
      : null,
  }));
  const count = (outcome: Outcome) => modeTurns.filter((t) => t.state === outcome).length;
  const counts = { done: count("done"), cut: count("cut"), failed: count("failed"), empty: count("empty") };
  const attemptedTurns = counts.done + counts.cut + counts.failed;
  const p50 = rows[0].statistics!.p50;
  const target = FIRST_AUDIO_P50_TARGET_MS[mode];
  return {
    mode,
    rows,
    counts,
    successRate: attemptedTurns ? (counts.done + counts.cut) / attemptedTurns : null,
    target,
    meetsTarget: p50 === null ? null : p50 < target,
  };
}

/** why a cell reads n/a (tooltip) */
export const NOT_AVAILABLE_REASONS: Record<string, string> = {
  "turn detect":
    "not measured: voice-to-voice turn detection is speech end + its fixed 500 ms VAD silence wait by construction",
  stage: "not observable: voice-to-voice is one sealed model and exposes no internal stage timings (FR-026)",
};

// ---- markup: numbers only, rebuilt from the turns on every render; every string here is static (no escaping) ----

const MODES: Mode[] = ["realtime", "cascade"];
const unitSpan = (text: string) => `<span class="unit">${text}</span>`;
const valueOrDash = (value: number | null) =>
  value === null ? `<span class="unit">—</span>` : String(value);

function modeCardHtml(dashboard: ModeDashboard): string {
  const firstAudio = dashboard.rows[0].statistics!;
  const verdict =
    dashboard.meetsTarget === null
      ? `<span class="unit">target &lt; ${dashboard.target}</span>`
      : `<span class="terminal-token-${dashboard.meetsTarget ? "ok" : "bad"}" title="p50 ${dashboard.meetsTarget ? "meets" : "misses"} the target">${dashboard.meetsTarget ? "✓" : "✗"} &lt; ${dashboard.target}</span>`;
  const rows = dashboard.rows
    .map((row, i) => {
      const cells = row.statistics
        ? [
            row.statistics.average,
            row.statistics.p50,
            row.statistics.p90,
            row.statistics.p95,
            row.statistics.n,
          ]
            .map((value) => `<td>${valueOrDash(value)}</td>`)
            .join("")
        : `<td colspan="5" class="not-available" title="${NOT_AVAILABLE_REASONS[row.name] ?? NOT_AVAILABLE_REASONS.stage}">n/a</td>`;
      return `<tr${i === 2 ? ' class="group-start"' : ""}><th scope="row">${i < 2 ? "→ " : ""}${row.name}</th>${cells}</tr>`;
    })
    .join("");
  const counts = dashboard.counts;
  const successText = dashboard.successRate === null ? "—" : `${Math.round(dashboard.successRate * 100)}%`;
  return `<section class="metrics-dashboard-mode" aria-label="${MODE_LABELS[dashboard.mode]} metrics">
    <div class="tile">
      <div class="tile-header"><span class="terminal-token-${dashboard.mode}">${MODE_LABELS[dashboard.mode]}</span>${verdict}</div>
      <div class="tile-headline">${valueOrDash(firstAudio.p50)}${firstAudio.p50 === null ? "" : unitSpan("ms")}</div>
      <div class="tile-subtitle">p50 speech end → first audio · p95 ${valueOrDash(firstAudio.p95)}${firstAudio.p95 === null ? "" : unitSpan(" ms")}</div>
    </div>
    <table class="statistics-table">
      <thead><tr><th scope="col">${unitSpan("ms")}</th><th scope="col">avg</th><th scope="col">p50</th><th scope="col">p90</th><th scope="col">p95</th><th scope="col">n</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="metrics-dashboard-turns" title="success = (done + cut) / (done + cut + failed); empty turns had nothing to interpret">
      ${counts.done} done · ${counts.cut} cut · ${counts.failed} failed · ${counts.empty} empty · <strong>${successText}</strong> ok</p>
  </section>`;
}

/** The dashboard: one card per mode (headline tile, statistics table, outcomes), plus how the numbers are computed. */
export function metricsDashboardHtml(turns: Parameters<typeof buildModeDashboard>[0]): string {
  return `<div class="metrics-dashboard">${MODES.map((mode) => modeCardHtml(buildModeDashboard(turns, mode))).join("")}</div>
    <p class="terminal-token-comment"># p50/p90/p95: linear interpolation, as the eval report · voice-to-voice speech end ≈ VAD event − 500 ms</p>`;
}

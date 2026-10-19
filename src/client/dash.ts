// Mini metrics dashboard (pure, no DOM; returns markup): per mode, n / avg / p50 / p90 / p95 for every timing the mode can
// observe, turn outcomes and the first-audio verdict against the PRD targets. Same spans as the log (summarizeTimings).
import type { Mode, TurnState } from "../shared/contracts.ts";
// the eval report's percentile (linear interpolation, numpy default), imported so the page and the report agree
import { percentile } from "../../scripts/eval/metrics.ts";
import { MODE_LABEL, summarizeTimings, TARGET_MS, type Timings } from "./lib.ts";

/** speech end → first audio at p50: NFR-001 (voice-to-voice < 1.5 s), NFR-002 (cascade < 3 s) */
export const P50_TARGET_MS: Record<Mode, number> = { realtime: 1500, cascade: TARGET_MS };

export interface Stat {
  n: number;
  /** ms, rounded; null when n = 0 */
  avg: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
}

export function stat(xs: number[]): Stat {
  if (!xs.length) return { n: 0, avg: null, p50: null, p90: null, p95: null };
  const p = (q: number) => Math.round(percentile(xs, q));
  return {
    n: xs.length,
    avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
    p50: p(50),
    p90: p(90),
    p95: p(95),
  };
}

export interface MetricRow {
  name: string;
  /** null = this mode cannot observe the metric (FR-026): shown as n/a, never a number */
  stat: Stat | null;
}
export type Outcome = "done" | "cut" | "failed" | "empty";
export interface ModeDash {
  mode: Mode;
  /** first audio, end of audio, then turn detect and the cascade stages */
  rows: MetricRow[];
  counts: Record<Outcome, number>;
  /** (done + cut) / (done + cut + failed); empty turns had nothing to interpret. null = no attempts yet */
  success: number | null;
  target: number;
  /** first-audio p50 under target; null = no data yet */
  meets: boolean | null;
}

const columns = (t: Timings, mode: Mode) => {
  const s = summarizeTimings(t, mode);
  return [
    { name: "first audio", ms: s.toFirstAudio, observable: true },
    { name: "end of audio", ms: s.toEnd, observable: true },
    ...s.stages,
  ];
};

export function modeDash(turns: { mode: Mode; state: TurnState; timings: Timings }[], mode: Mode): ModeDash {
  const mine = turns.filter((t) => t.mode === mode);
  const per = mine.map((t) => columns(t.timings, mode));
  const rows = columns({}, mode).map((c, i) => ({
    name: c.name,
    stat: c.observable ? stat(per.map((p) => p[i].ms).filter((x): x is number => x !== null)) : null,
  }));
  const count = (s: Outcome) => mine.filter((t) => t.state === s).length;
  const counts = { done: count("done"), cut: count("cut"), failed: count("failed"), empty: count("empty") };
  const tried = counts.done + counts.cut + counts.failed;
  const p50 = rows[0].stat!.p50;
  const target = P50_TARGET_MS[mode];
  return {
    mode,
    rows,
    counts,
    success: tried ? (counts.done + counts.cut) / tried : null,
    target,
    meets: p50 === null ? null : p50 < target,
  };
}

/** why a cell reads n/a (tooltip) */
export const NA_WHY: Record<string, string> = {
  "turn detect":
    "not measured: voice-to-voice turn detection is speech end + its fixed 500 ms VAD silence wait by construction",
  stage: "not observable: voice-to-voice is one sealed model and exposes no internal stage timings (FR-026)",
};

// ---- markup: numbers only, rebuilt from the turns on every render; every string here is static (no escaping) ----

const MODES: Mode[] = ["realtime", "cascade"];
const u = (s: string) => `<span class="u">${s}</span>`;
const val = (v: number | null) => (v === null ? `<span class="u">—</span>` : String(v));

function modeCard(d: ModeDash): string {
  const fa = d.rows[0].stat!;
  const verdict =
    d.meets === null
      ? `<span class="u">target &lt; ${d.target}</span>`
      : `<span class="tk-${d.meets ? "ok" : "bad"}" title="p50 ${d.meets ? "meets" : "misses"} the target">${d.meets ? "✓" : "✗"} &lt; ${d.target}</span>`;
  const rows = d.rows
    .map((r, i) => {
      const cells = r.stat
        ? [r.stat.avg, r.stat.p50, r.stat.p90, r.stat.p95, r.stat.n].map((v) => `<td>${val(v)}</td>`).join("")
        : `<td colspan="5" class="na" title="${NA_WHY[r.name] ?? NA_WHY.stage}">n/a</td>`;
      return `<tr${i === 2 ? ' class="grp"' : ""}><th scope="row">${i < 2 ? "→ " : ""}${r.name}</th>${cells}</tr>`;
    })
    .join("");
  const c = d.counts;
  const ok = d.success === null ? "—" : `${Math.round(d.success * 100)}%`;
  return `<section class="dash-mode" aria-label="${MODE_LABEL[d.mode]} metrics">
    <div class="tile">
      <div class="tile-head"><span class="tk-${d.mode}">${MODE_LABEL[d.mode]}</span>${verdict}</div>
      <div class="tile-big">${val(fa.p50)}${fa.p50 === null ? "" : u("ms")}</div>
      <div class="tile-sub">p50 speech end → first audio · p95 ${val(fa.p95)}${fa.p95 === null ? "" : u(" ms")}</div>
    </div>
    <table class="stat">
      <thead><tr><th scope="col">${u("ms")}</th><th scope="col">avg</th><th scope="col">p50</th><th scope="col">p90</th><th scope="col">p95</th><th scope="col">n</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="dash-turns" title="success = (done + cut) / (done + cut + failed); empty turns had nothing to interpret">
      ${c.done} done · ${c.cut} cut · ${c.failed} failed · ${c.empty} empty · <strong>${ok}</strong> ok</p>
  </section>`;
}

/** The dashboard: one card per mode (headline tile, stat table, outcomes), plus how the numbers are computed. */
export function dashHtml(turns: Parameters<typeof modeDash>[0]): string {
  return `<div class="dash">${MODES.map((m) => modeCard(modeDash(turns, m))).join("")}</div>
    <p class="tk-comment"># p50/p90/p95: linear interpolation, as the eval report · voice-to-voice speech end ≈ VAD event − 500 ms</p>`;
}

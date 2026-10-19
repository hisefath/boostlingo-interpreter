// Soak test summary (REQ-19, NFR-003): pure numbers from a 5-minute run. The browser runner is runSoakTest in
// evaluation-runners.ts.
import type { TurnState } from "../shared/contracts.ts";
import { nearestRankPercentile, type Timings } from "./timing-and-audio-helpers.ts";

export const SOAK_DURATION_MS = 300_000;
export const HEAP_SAMPLE_INTERVAL_MS = 30_000;
/** heap samples before this are warm-up (JIT, first decodes, transport setup) and not the growth baseline */
export const WARMUP_MS = 60_000;
const TURNS_COMPARED_AT_EACH_END = 5; // turns compared at each end of the run for drift
const SOAK_PASS_LIMITS = { minCompletedTurns: 20, maxLagGrowthMs: 250, maxHeapGrowthPercent: 20 }; // PRD NFR-003

export interface HeapSample {
  atMs: number;
  bytes: number;
}

export interface SoakInput {
  durationMs: number;
  attempted: number;
  turns: { state: TurnState; timings: Timings }[];
  notices: string[];
  heap: HeapSample[];
}

/** saved in eval/results/soak-*.json: field names are a stored format, keep them */
export interface SoakSummary {
  durationMs: number;
  turnsAttempted: number;
  turnsCompleted: number;
  turnsFailed: number;
  disconnects: number;
  reconnects: number;
  /** speech_end→first_audio per turn, ms, in turn order */
  firstAudioMs: number[];
  firstAudioFirstMedianMs: number | null;
  firstAudioLastMedianMs: number | null;
  firstAudioDriftMs: number | null;
  /** "player": first_tts_byte→first_audio (cascade queue); "first_audio": end-to-end drift (voice-to-voice) */
  lagSource: "player" | "first_audio";
  lagGrowthMs: number | null;
  heap: HeapSample[];
  heapGrowthPct: number | null;
  checks: { minTurns: boolean; noDisconnects: boolean; lag: boolean; heap: boolean };
  pass: boolean;
}

export const median = (values: number[]): number | null =>
  values.length ? nearestRankPercentile(values, 50) : null;

const firstAndLastValues = (values: number[]) => {
  const count = Math.min(TURNS_COMPARED_AT_EACH_END, Math.floor(values.length / 2)); // never let the two ends overlap
  return count ? [values.slice(0, count), values.slice(-count)] : null;
};

/** median of the last 5 values minus median of the first 5 (fewer when short); null under 2 values */
export function medianDrift(values: number[]): number | null {
  const ends = firstAndLastValues(values);
  return ends ? median(ends[1])! - median(ends[0])! : null;
}

/** % growth from the first post-warm-up sample (or the first sample, for a short run) to the last */
export function heapGrowthPercent(heap: HeapSample[], warmupMs = WARMUP_MS): number | null {
  if (heap.length < 2) return null;
  const afterWarmup = heap.filter((sample) => sample.atMs >= warmupMs);
  const baseline = afterWarmup.length >= 2 ? afterWarmup[0] : heap[0];
  if (!baseline.bytes) return null;
  return Math.round(((heap.at(-1)!.bytes - baseline.bytes) / baseline.bytes) * 1000) / 10;
}

// "…connection lost, reconnecting…" and a second "…connection lost"; not the "; reconnect failed" follow-up
const DISCONNECT_NOTICE = /connection lost(?!;)/;

const gapMs = (timings: Timings, from: keyof Timings, to: keyof Timings) =>
  timings[from] === undefined || timings[to] === undefined ? [] : [Math.round(timings[to]! - timings[from]!)];

export function summarizeSoak(input: SoakInput): SoakSummary {
  const firstAudioMs = input.turns.flatMap((turn) => gapMs(turn.timings, "speech_end", "first_audio"));
  const playerLag = input.turns.flatMap((turn) => gapMs(turn.timings, "first_tts_byte", "first_audio"));
  const lagSource = playerLag.length >= 2 ? "player" : "first_audio";
  const lagGrowthMs = medianDrift(lagSource === "player" ? playerLag : firstAudioMs);
  const ends = firstAndLastValues(firstAudioMs);
  const heapGrowth = heapGrowthPercent(input.heap);
  const completed = input.turns.filter((turn) => turn.state === "done").length;
  const disconnects = input.notices.filter((notice) => DISCONNECT_NOTICE.test(notice)).length;
  const checks = {
    minTurns: completed >= SOAK_PASS_LIMITS.minCompletedTurns,
    noDisconnects: disconnects === 0,
    lag: lagGrowthMs !== null && lagGrowthMs <= SOAK_PASS_LIMITS.maxLagGrowthMs,
    heap: heapGrowth === null || heapGrowth <= SOAK_PASS_LIMITS.maxHeapGrowthPercent, // performance.memory is Chromium-only
  };
  return {
    durationMs: Math.round(input.durationMs),
    turnsAttempted: input.attempted,
    turnsCompleted: completed,
    turnsFailed: input.turns.filter((turn) => turn.state === "failed").length,
    disconnects,
    reconnects: input.notices.filter((notice) => notice === "reconnected").length,
    firstAudioMs,
    firstAudioFirstMedianMs: ends && median(ends[0]),
    firstAudioLastMedianMs: ends && median(ends[1]),
    firstAudioDriftMs: medianDrift(firstAudioMs),
    lagSource,
    lagGrowthMs,
    heap: input.heap,
    heapGrowthPct: heapGrowth,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

const formatSigned = (value: number | null, unit: string) =>
  value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value}${unit}`;

/** one status line for the supervisor */
export function soakStatusLine(summary: SoakSummary, runId: string): string {
  return [
    `Soak ${summary.pass ? "PASS" : "FAIL"} (${Math.round(summary.durationMs / 1000)} s)`,
    `turns ${summary.turnsCompleted}/${summary.turnsAttempted} done, ${summary.turnsFailed} failed`,
    `disconnects ${summary.disconnects}`,
    `first audio ${summary.firstAudioFirstMedianMs ?? "n/a"}→${summary.firstAudioLastMedianMs ?? "n/a"} ms`,
    `lag ${formatSigned(summary.lagGrowthMs, " ms")}`,
    `heap ${formatSigned(summary.heapGrowthPct, "%")}`,
    `saved as ${runId}`,
  ].join(" · ");
}

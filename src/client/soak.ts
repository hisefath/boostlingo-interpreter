// Soak summary (REQ-19, NFR-003): pure numbers from a 5-minute run. The browser runner is runSoak in eval.ts.
import type { TurnState } from "../shared/contracts.ts";
import { percentile, type Timings } from "./lib.ts";

export const SOAK_MS = 300_000;
export const HEAP_EVERY_MS = 30_000;
/** heap samples before this are warm-up (JIT, first decodes, transport setup) and not the growth baseline */
export const WARMUP_MS = 60_000;
const EDGE = 5; // turns compared at each end of the run for drift
const LIMITS = { minTurns: 20, lagGrowthMs: 250, heapGrowthPct: 20 }; // PRD NFR-003

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

export const median = (xs: number[]): number | null => (xs.length ? percentile(xs, 50) : null);

const split = (xs: number[]) => {
  const n = Math.min(EDGE, Math.floor(xs.length / 2)); // never let the two ends overlap
  return n ? [xs.slice(0, n), xs.slice(-n)] : null;
};

/** median of the last 5 values minus median of the first 5 (fewer when short); null under 2 values */
export function drift(xs: number[]): number | null {
  const s = split(xs);
  return s ? median(s[1])! - median(s[0])! : null;
}

/** % growth from the first post-warm-up sample (or the first sample, for a short run) to the last */
export function heapGrowthPct(heap: HeapSample[], warmupMs = WARMUP_MS): number | null {
  if (heap.length < 2) return null;
  const after = heap.filter((h) => h.atMs >= warmupMs);
  const base = after.length >= 2 ? after[0] : heap[0];
  if (!base.bytes) return null;
  return Math.round(((heap.at(-1)!.bytes - base.bytes) / base.bytes) * 1000) / 10;
}

// "…connection lost, reconnecting…" and a second "…connection lost"; not the "; reconnect failed" follow-up
const DISCONNECT = /connection lost(?!;)/;

const gap = (t: Timings, from: keyof Timings, to: keyof Timings) =>
  t[from] === undefined || t[to] === undefined ? [] : [Math.round(t[to]! - t[from]!)];

export function summarizeSoak(i: SoakInput): SoakSummary {
  const firstAudioMs = i.turns.flatMap((t) => gap(t.timings, "speech_end", "first_audio"));
  const playerLag = i.turns.flatMap((t) => gap(t.timings, "first_tts_byte", "first_audio"));
  const lagSource = playerLag.length >= 2 ? "player" : "first_audio";
  const lagGrowthMs = drift(lagSource === "player" ? playerLag : firstAudioMs);
  const ends = split(firstAudioMs);
  const heapGrowth = heapGrowthPct(i.heap);
  const completed = i.turns.filter((t) => t.state === "done").length;
  const disconnects = i.notices.filter((n) => DISCONNECT.test(n)).length;
  const checks = {
    minTurns: completed >= LIMITS.minTurns,
    noDisconnects: disconnects === 0,
    lag: lagGrowthMs !== null && lagGrowthMs <= LIMITS.lagGrowthMs,
    heap: heapGrowth === null || heapGrowth <= LIMITS.heapGrowthPct, // performance.memory is Chromium-only
  };
  return {
    durationMs: Math.round(i.durationMs),
    turnsAttempted: i.attempted,
    turnsCompleted: completed,
    turnsFailed: i.turns.filter((t) => t.state === "failed").length,
    disconnects,
    reconnects: i.notices.filter((n) => n === "reconnected").length,
    firstAudioMs,
    firstAudioFirstMedianMs: ends && median(ends[0]),
    firstAudioLastMedianMs: ends && median(ends[1]),
    firstAudioDriftMs: drift(firstAudioMs),
    lagSource,
    lagGrowthMs,
    heap: i.heap,
    heapGrowthPct: heapGrowth,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

const sign = (v: number | null, unit: string) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v}${unit}`);

/** one status line for the supervisor */
export function soakLine(s: SoakSummary, runId: string): string {
  return [
    `Soak ${s.pass ? "PASS" : "FAIL"} (${Math.round(s.durationMs / 1000)} s)`,
    `turns ${s.turnsCompleted}/${s.turnsAttempted} done, ${s.turnsFailed} failed`,
    `disconnects ${s.disconnects}`,
    `first audio ${s.firstAudioFirstMedianMs ?? "n/a"}→${s.firstAudioLastMedianMs ?? "n/a"} ms`,
    `lag ${sign(s.lagGrowthMs, " ms")}`,
    `heap ${sign(s.heapGrowthPct, "%")}`,
    `saved as ${runId}`,
  ].join(" · ");
}

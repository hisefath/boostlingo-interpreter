// Metrics terminal formatting (pure, no DOM). Each line is a list of tokens the UI renders as coloured spans;
// fixed-width monospace columns keep every line aligned with the header, "separator" tokens are plain spaces.
import type { Mode, TimingPoint, TurnState } from "../shared/contracts.ts";
import { FIRST_AUDIO_P50_TARGET_MS } from "./metrics-dashboard.ts";
import {
  MODE_LABELS,
  summarizeTimings,
  vendorDisplayName,
  type ModeSummary,
  type PercentilePair,
  type Timings,
  type Tone,
} from "./timing-and-audio-helpers.ts";

export type TokenKind =
  | "header"
  | "time"
  | "mode"
  | "turn"
  | "event"
  | "vendor"
  | "value"
  | "unit"
  | "verdict"
  | "note"
  | "separator";
export interface Token {
  kind: TokenKind;
  text: string;
  /** a verdict tone, or the mode for the mode token */
  tone?: Tone | Mode;
}

export const COLUMN_WIDTHS = {
  time: 12,
  mode: 7,
  turn: 4,
  event: 12,
  vendor: 10,
  value: 6,
  unit: 2,
  verdict: 1,
};
/** the mode column is 7 characters wide, so voice-to-voice shows as "v2v" */
const MODE_COLUMN_TEXT: Record<Mode, string> = { realtime: "v2v", cascade: "cascade" };
export const EVENT_LABELS: Record<TimingPoint, string> = {
  speech_end: "speech end",
  turn_detected: "turn detect",
  stt_final: "transcript",
  first_translation: "translation",
  first_tts_byte: "tts 1st byte",
  first_audio: "first audio",
  audio_end: "audio end",
};

const padWithZeros = (value: number, width = 2) => String(value).padStart(width, "0");
function formatClockTime(wallMs: number): string {
  const date = new Date(wallMs);
  return `${padWithZeros(date.getHours())}:${padWithZeros(date.getMinutes())}:${padWithZeros(date.getSeconds())}.${padWithZeros(date.getMilliseconds(), 3)}`;
}
/** cut an over-long cell so it cannot push the columns after it */
const truncateToWidth = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;
const centerInWidth = (text: string, width: number) =>
  text.padStart(Math.ceil((width + text.length) / 2)).padEnd(width);
const COLUMN_GAP: Token = { kind: "separator", text: "  " };

interface LineCells {
  time: string;
  mode: string;
  turn: string;
  event: string;
  vendor?: string;
  value?: string;
  unit?: string;
  verdict?: string;
  note?: string;
  modeTone?: Mode;
  tone?: Tone;
}

function buildLine(cells: LineCells, isHeader = false): Token[] {
  const kindFor = (kind: TokenKind): TokenKind => (isHeader ? "header" : kind);
  return [
    { kind: kindFor("time"), text: cells.time.padEnd(COLUMN_WIDTHS.time) },
    COLUMN_GAP,
    { kind: kindFor("mode"), text: cells.mode.padEnd(COLUMN_WIDTHS.mode), tone: cells.modeTone },
    COLUMN_GAP,
    { kind: kindFor("turn"), text: centerInWidth(cells.turn, COLUMN_WIDTHS.turn) },
    COLUMN_GAP,
    { kind: kindFor("event"), text: cells.event.padEnd(COLUMN_WIDTHS.event) },
    COLUMN_GAP,
    {
      kind: kindFor("vendor"),
      text: truncateToWidth(cells.vendor ?? "", COLUMN_WIDTHS.vendor).padEnd(COLUMN_WIDTHS.vendor),
    },
    COLUMN_GAP,
    { kind: kindFor("value"), text: (cells.value ?? "").padStart(COLUMN_WIDTHS.value), tone: cells.tone },
    { kind: "separator", text: " " },
    { kind: kindFor("unit"), text: (cells.unit ?? "").padEnd(COLUMN_WIDTHS.unit) },
    COLUMN_GAP,
    {
      kind: kindFor("verdict"),
      text: (cells.verdict ?? "").padEnd(COLUMN_WIDTHS.verdict),
      tone: cells.tone,
    },
    { kind: "separator", text: " " },
    { kind: kindFor("note"), text: cells.note ?? "", tone: cells.tone },
  ];
}

export const toPlainText = (tokens: Token[]) => tokens.map((token) => token.text).join("");

/** The sticky column header. */
export const headerLine = (): Token[] =>
  buildLine(
    { time: "time", mode: "mode", turn: "turn", event: "event", vendor: "vendor", value: "Δt", note: "note" },
    true,
  );

const turnIdentityCells = (wallMs: number, mode: Mode, seq: number) => ({
  time: formatClockTime(wallMs),
  mode: MODE_COLUMN_TEXT[mode],
  modeTone: mode,
  turn: `t${seq + 1}`,
});

/** One line per timing event; the value is ms since speech end. */
export function timingLine(
  wallMs: number,
  mode: Mode,
  seq: number,
  point: TimingPoint,
  vendor?: string,
  sinceSpeechEnd?: number | null,
): Token[] {
  const isApproximate = point === "speech_end" && mode === "realtime";
  const hasDelta = point !== "speech_end" && sinceSpeechEnd != null;
  return buildLine({
    ...turnIdentityCells(wallMs, mode, seq),
    event: EVENT_LABELS[point],
    vendor: vendor ? vendorDisplayName(vendor) : "",
    value: hasDelta ? `+${sinceSpeechEnd}` : "",
    unit: hasDelta ? "ms" : "",
    note: isApproximate ? "≈ VAD silence 500 ms" : "",
    tone: isApproximate ? "muted" : undefined,
  });
}

/** One line per settled turn: verdict against the mode's first-audio target, failures with their reason. */
export function resultLine(
  wallMs: number,
  mode: Mode,
  seq: number,
  state: TurnState,
  timings: Timings,
  reason?: string,
): Token[] {
  const summary = summarizeTimings(timings, mode);
  const baseCells = { ...turnIdentityCells(wallMs, mode, seq), event: "result" };
  const firstAudioCells =
    summary.toFirstAudio === null ? {} : { value: String(summary.toFirstAudio), unit: "ms" };
  const end = summary.toAudioEnd === null ? "" : ` · end ${summary.toAudioEnd} ms`;
  if (state === "failed")
    return buildLine({
      ...baseCells,
      verdict: "✗",
      note: `not interpreted: ${reason ?? "failed"}`,
      tone: "bad",
    });
  if (state === "empty")
    return buildLine({ ...baseCells, verdict: "·", note: "nothing heard", tone: "muted" });
  if (state === "cut")
    return buildLine({ ...baseCells, ...firstAudioCells, verdict: "✂", note: "cut off", tone: "warn" });
  if (summary.toFirstAudio === null)
    return buildLine({ ...baseCells, verdict: "✓", note: "done (no first-audio timing)", tone: "muted" });
  const target = FIRST_AUDIO_P50_TARGET_MS[mode];
  const ok = summary.toFirstAudio < target;
  return buildLine({
    ...baseCells,
    ...firstAudioCells,
    verdict: ok ? "✓" : "✗",
    note: `target ${target} ms${end}`,
    tone: ok ? "ok" : "bad",
  });
}

export interface SummaryRow {
  mode: Mode;
  label: string;
  turns: string;
  /** [p50, p95] in ms, "—" = no data yet */
  firstAudio: [string, string];
  audioEnd: [string, string];
  /** per-stage p50, or a note when the mode cannot observe stages (FR-026) */
  stages: { name: string; ms: string }[] | string;
}

const percentileCells = (percentiles: PercentilePair | null): [string, string] =>
  percentiles ? [String(percentiles.p50), String(percentiles.p95)] : ["—", "—"];

export function summaryRow(summary: ModeSummary): SummaryRow {
  return {
    mode: summary.mode,
    label: MODE_LABELS[summary.mode],
    turns: String(summary.turns),
    firstAudio: percentileCells(summary.firstAudio),
    audioEnd: percentileCells(summary.audioEnd),
    stages: summary.stages
      ? summary.stages.map((stage) => ({
          name: stage.name,
          ms: stage.p50 === null ? "—" : String(stage.p50),
        }))
      : "n/a (not observable)",
  };
}

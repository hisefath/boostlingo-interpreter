// Metrics terminal formatting (pure, no DOM). Each line is a list of tokens the UI renders as coloured spans;
// fixed-width monospace columns keep every line aligned with the header, "sep" tokens are plain spaces.
import type { Mode, TimingPoint, TurnState } from "../shared/contracts.ts";
import { P50_TARGET_MS } from "./dash.ts";
import {
  MODE_LABEL,
  summarizeTimings,
  vendorLabel,
  type ModeSummary,
  type Pct,
  type Timings,
  type Tone,
} from "./lib.ts";

export type TokKind =
  "head" | "time" | "mode" | "turn" | "event" | "vendor" | "value" | "unit" | "verdict" | "note" | "sep";
export interface Tok {
  kind: TokKind;
  text: string;
  /** a verdict tone, or the mode for the mode token */
  tone?: Tone | Mode;
}

export const WIDTH = { time: 12, mode: 7, turn: 4, event: 12, vendor: 10, value: 6, unit: 2, verdict: 1 };
const MODE_TAG: Record<Mode, string> = { realtime: "v2v", cascade: "cascade" };
export const EVENT_LABEL: Record<TimingPoint, string> = {
  speech_end: "speech end",
  turn_detected: "turn detect",
  stt_final: "transcript",
  first_translation: "translation",
  first_tts_byte: "tts 1st byte",
  first_audio: "first audio",
  audio_end: "audio end",
};

const pad2 = (n: number, w = 2) => String(n).padStart(w, "0");
function clock(wallMs: number): string {
  const d = new Date(wallMs);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad2(d.getMilliseconds(), 3)}`;
}
/** cut an over-long cell so it cannot push the columns after it */
const fit = (s: string, w: number) => (s.length > w ? `${s.slice(0, w - 1)}…` : s);
const center = (s: string, w: number) => s.padStart(Math.ceil((w + s.length) / 2)).padEnd(w);
const SEP: Tok = { kind: "sep", text: "  " };

interface Cells {
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

function line(c: Cells, head = false): Tok[] {
  const k = (kind: TokKind): TokKind => (head ? "head" : kind);
  return [
    { kind: k("time"), text: c.time.padEnd(WIDTH.time) },
    SEP,
    { kind: k("mode"), text: c.mode.padEnd(WIDTH.mode), tone: c.modeTone },
    SEP,
    { kind: k("turn"), text: center(c.turn, WIDTH.turn) },
    SEP,
    { kind: k("event"), text: c.event.padEnd(WIDTH.event) },
    SEP,
    { kind: k("vendor"), text: fit(c.vendor ?? "", WIDTH.vendor).padEnd(WIDTH.vendor) },
    SEP,
    { kind: k("value"), text: (c.value ?? "").padStart(WIDTH.value), tone: c.tone },
    { kind: "sep", text: " " },
    { kind: k("unit"), text: (c.unit ?? "").padEnd(WIDTH.unit) },
    SEP,
    { kind: k("verdict"), text: (c.verdict ?? "").padEnd(WIDTH.verdict), tone: c.tone },
    { kind: "sep", text: " " },
    { kind: k("note"), text: c.note ?? "", tone: c.tone },
  ];
}

export const plain = (toks: Tok[]) => toks.map((t) => t.text).join("");

/** The sticky column header. */
export const headerLine = (): Tok[] =>
  line(
    { time: "time", mode: "mode", turn: "turn", event: "event", vendor: "vendor", value: "Δt", note: "note" },
    true,
  );

const ids = (wallMs: number, mode: Mode, seq: number) => ({
  time: clock(wallMs),
  mode: MODE_TAG[mode],
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
): Tok[] {
  const approx = point === "speech_end" && mode === "realtime";
  const delta = point !== "speech_end" && sinceSpeechEnd != null;
  return line({
    ...ids(wallMs, mode, seq),
    event: EVENT_LABEL[point],
    vendor: vendor ? vendorLabel(vendor) : "",
    value: delta ? `+${sinceSpeechEnd}` : "",
    unit: delta ? "ms" : "",
    note: approx ? "≈ VAD silence 500 ms" : "",
    tone: approx ? "muted" : undefined,
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
): Tok[] {
  const s = summarizeTimings(timings, mode);
  const base = { ...ids(wallMs, mode, seq), event: "result" };
  const fa = s.toFirstAudio === null ? {} : { value: String(s.toFirstAudio), unit: "ms" };
  const end = s.toEnd === null ? "" : ` · end ${s.toEnd} ms`;
  if (state === "failed")
    return line({ ...base, verdict: "✗", note: `not interpreted: ${reason ?? "failed"}`, tone: "bad" });
  if (state === "empty") return line({ ...base, verdict: "·", note: "nothing heard", tone: "muted" });
  if (state === "cut") return line({ ...base, ...fa, verdict: "✂", note: "cut off", tone: "warn" });
  if (s.toFirstAudio === null)
    return line({ ...base, verdict: "✓", note: "done (no first-audio timing)", tone: "muted" });
  const target = P50_TARGET_MS[mode];
  const ok = s.toFirstAudio < target;
  return line({
    ...base,
    ...fa,
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

const pv = (p: Pct | null): [string, string] => (p ? [String(p.p50), String(p.p95)] : ["—", "—"]);

export function summaryRow(s: ModeSummary): SummaryRow {
  return {
    mode: s.mode,
    label: MODE_LABEL[s.mode],
    turns: String(s.turns),
    firstAudio: pv(s.firstAudio),
    audioEnd: pv(s.audioEnd),
    stages: s.stages
      ? s.stages.map((x) => ({ name: x.name, ms: x.p50 === null ? "—" : String(x.p50) }))
      : "n/a (not observable)",
  };
}

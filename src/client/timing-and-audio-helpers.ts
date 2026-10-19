// Pure helpers (no DOM): language guess, clock math, timing summary, PCM conversion, WAV encoding,
// and the workbench's display maths (mic level, per-mode summary, vendor names, pipeline layers).
import type { LanguageCode, Mode, TimingPoint, TurnState } from "../shared/contracts.ts";
import { guessLanguage } from "../shared/languages.ts";

export type Timings = Partial<Record<TimingPoint, number>>;

/** Which of the pair's languages `text` is in (shared table); no evidence either way → fallback. */
export const guessLanguageWithDefaults = (
  text: string,
  fallback: LanguageCode = "en",
  pair: readonly LanguageCode[] = ["en", "es"],
): LanguageCode => guessLanguage(text, pair, fallback);

/** offset such that browserTime = serverTime - offset; assumes the server stamped at the round trip's midpoint. */
export function clockOffsetMs(sentAt: number, serverTime: number, receivedAt: number): number {
  return serverTime - (sentAt + (receivedAt - sentAt) / 2);
}

export interface StageBar {
  name: string;
  ms: number | null;
  observable: boolean;
}
export interface TimingSummary {
  toFirstAudio: number | null;
  toAudioEnd: number | null;
  stages: StageBar[];
}

const STAGE_SPANS: [string, TimingPoint, TimingPoint][] = [
  ["turn detect", "speech_end", "turn_detected"],
  ["stt final", "turn_detected", "stt_final"],
  ["translate", "stt_final", "first_translation"],
  ["tts 1st byte", "first_translation", "first_tts_byte"],
  ["playback", "first_tts_byte", "first_audio"],
];

function spanMs(timings: Timings, from: TimingPoint, to: TimingPoint): number | null {
  const fromTime = timings[from];
  const toTime = timings[to];
  return fromTime === undefined || toTime === undefined || toTime < fromTime
    ? null
    : Math.round(toTime - fromTime);
}

/** Totals from true speech end, plus per-stage bars (voice-to-voice cannot observe stages, FR-026). */
export function summarizeTimings(timings: Timings, mode: Mode): TimingSummary {
  return {
    toFirstAudio: spanMs(timings, "speech_end", "first_audio"),
    toAudioEnd: spanMs(timings, "speech_end", "audio_end"),
    stages: STAGE_SPANS.map(([name, from, to]) =>
      mode === "realtime"
        ? { name, ms: null, observable: false }
        : { name, ms: spanMs(timings, from, to), observable: true },
    ),
  };
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }
  return out;
}

export function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

/** Linear-interpolation resampler for one block. ponytail: no anti-alias filter; fine for speech STT input. */
export function resampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const outputLength = Math.round((input.length * toRate) / fromRate);
  const out = new Float32Array(outputLength);
  const step = fromRate / toRate;
  for (let i = 0; i < outputLength; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * (pos - j);
  }
  return out;
}

/** Server audio frame: 4-byte big-endian seq, then PCM16 little-endian samples. */
export function parseAudioFrame(frame: ArrayBuffer): { seq: number; pcm: Int16Array } {
  const view = new DataView(frame);
  const seq = view.getUint32(0, false);
  const pcm = new Int16Array((frame.byteLength - 4) >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(4 + i * 2, true);
  return { seq, pcm };
}

/** Mono PCM16 WAV file bytes. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(out.buffer);
  const writeAscii = (offset: number, text: string) =>
    [...text].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const otherLanguage = (pair: [LanguageCode, LanguageCode], language: LanguageCode): LanguageCode =>
  language === pair[0] ? pair[1] : pair[0];

// ---- Workbench display maths ---------------------------------------------------------------------------

/** a turn in one of these states will not change again */
const FINISHED_STATES = new Set<TurnState>(["done", "failed", "empty", "cut"]);
export const isFinishedState = (state: TurnState) => FINISHED_STATES.has(state);

export const MODE_LABELS: Record<Mode, string> = { realtime: "voice-to-voice", cascade: "cascade" };
/** NFR-002: cascade speech end → first audio p50 target */
export const CASCADE_FIRST_AUDIO_TARGET_MS = 3000;

/** RMS of a block mapped to 0..1 on a dB scale (-55 dB = 0, -15 dB = 1), so quiet speech still moves the orb. */
export function rmsLevel(block: ArrayLike<number>): number {
  if (!block.length) return 0;
  let sumOfSquares = 0;
  for (let i = 0; i < block.length; i++) sumOfSquares += block[i] * block[i];
  const rms = Math.sqrt(sumOfSquares / block.length);
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 55) / 40));
}

/** nearest-rank percentile; values must be non-empty (the evaluation report uses a linear one instead) */
export function nearestRankPercentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

export interface PercentilePair {
  p50: number;
  p95: number;
}
export interface ModeSummary {
  mode: Mode;
  turns: number;
  firstAudio: PercentilePair | null;
  audioEnd: PercentilePair | null;
  /** null = this mode cannot observe stages (FR-026) */
  stages: { name: string; p50: number | null }[] | null;
}

export function summarizeMode(turns: { mode: Mode; timings: Timings }[], mode: Mode): ModeSummary {
  const modeTurns = turns.filter((t) => t.mode === mode).map((t) => summarizeTimings(t.timings, mode));
  const percentilesOf = (maybeValues: (number | null)[]): PercentilePair | null => {
    const values = maybeValues.filter((x): x is number => x !== null);
    return values.length
      ? { p50: nearestRankPercentile(values, 50), p95: nearestRankPercentile(values, 95) }
      : null;
  };
  return {
    mode,
    turns: modeTurns.length,
    firstAudio: percentilesOf(modeTurns.map((s) => s.toFirstAudio)),
    audioEnd: percentilesOf(modeTurns.map((s) => s.toAudioEnd)),
    stages:
      mode === "realtime"
        ? null
        : STAGE_SPANS.map(([name], i) => ({
            name,
            p50: percentilesOf(modeTurns.map((s) => s.stages[i].ms))?.p50 ?? null,
          })),
  };
}

export type Tone = "ok" | "bad" | "warn" | "muted";

const VENDOR_DISPLAY_NAMES: Record<string, string> = {
  deepgram: "Deepgram",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};
/** Display name for a vendor key from /api/config ("elevenlabs" → "ElevenLabs"); model names pass through. */
export const vendorDisplayName = (vendor: string) => VENDOR_DISPLAY_NAMES[vendor] ?? vendor;

/** A turn's result line is printed once it is settled: a done turn with audio waits for end of audio. */
export function isResultReady(state: TurnState, timings: Timings): boolean {
  if (!isFinishedState(state)) return false;
  if (state !== "done") return true;
  return (
    timings.audio_end !== undefined ||
    (timings.first_audio === undefined && timings.first_tts_byte === undefined)
  );
}

export type LayerKey = "stt" | "translate" | "tts";
export type LayerStatus = "waiting" | "active" | "done" | "failed";
export interface PipelineLayer {
  key: LayerKey;
  status: LayerStatus;
  ms: number | null;
  note?: string;
}
const PIPELINE_LAYERS: [LayerKey, TimingPoint, TimingPoint][] = [
  ["stt", "speech_end", "stt_final"], // turn detection + STT final
  ["translate", "stt_final", "first_translation"],
  ["tts", "first_translation", "first_tts_byte"],
];

/** Cascade pipeline view for one turn: each layer waiting / active / done (with ms) / failed (with reason). */
export function cascadePipelineLayers(turn?: {
  state: TurnState;
  timings: Timings;
  reason?: string;
}): PipelineLayer[] {
  if (!turn) return PIPELINE_LAYERS.map(([key]) => ({ key, status: "waiting", ms: null }));
  const failedLayerKey =
    turn.state !== "failed"
      ? undefined
      : (PIPELINE_LAYERS.find(([key]) => turn.reason?.startsWith(key))?.[0] ??
        PIPELINE_LAYERS.find(([, , to]) => turn.timings[to] === undefined)?.[0]);
  return PIPELINE_LAYERS.map(([key, from, to], i) => {
    if (turn.timings[to] !== undefined) return { key, status: "done", ms: spanMs(turn.timings, from, to) };
    if (key === failedLayerKey) return { key, status: "failed", ms: null, note: turn.reason ?? "failed" };
    const ready = i === 0 || turn.timings[PIPELINE_LAYERS[i - 1][2]] !== undefined;
    return { key, status: ready && !isFinishedState(turn.state) ? "active" : "waiting", ms: null };
  });
}

export type OrbState = "idle" | "listening" | "translating" | "speaking";
export function orbState(live: boolean, state?: TurnState): OrbState {
  if (!live) return "idle";
  if (state === "translating") return "translating";
  if (state === "speaking") return "speaking";
  return "listening";
}

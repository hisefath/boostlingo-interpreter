// Pure helpers (no DOM): language guess, clock math, timing summary, PCM conversion, WAV encoding,
// and the workbench's display maths (mic level, per-mode summary, vendor names, pipeline layers).
import type { Lang, Mode, TimingPoint, TurnState } from "../shared/contracts.ts";

export type Timings = Partial<Record<TimingPoint, number>>;

const ES_STOPWORDS = new Set(
  "el la los las un una de del que y en por para con es está estoy tengo usted le lo se su sí no muy pero como dónde donde qué cuándo hola gracias señor señora".split(
    " ",
  ),
);
const EN_STOPWORDS = new Set(
  "the a an of and is are i you he she it we they to in on for with do does have has my your what where when how hello thank yes no".split(
    " ",
  ),
);

/** Guess en/es from text: Spanish-only characters win; otherwise count stopwords. */
export function guessLang(text: string, fallback: Lang = "en"): Lang {
  if (/[ñáéíóúü¿¡]/i.test(text)) return "es";
  let es = 0;
  let en = 0;
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (ES_STOPWORDS.has(w)) es++;
    if (EN_STOPWORDS.has(w)) en++;
  }
  if (es === en) return fallback;
  return es > en ? "es" : "en";
}

/** offset such that browserT = serverT - offset; assumes the server stamped at the round trip's midpoint. */
export function clockOffset(sentAt: number, serverT: number, receivedAt: number): number {
  return serverT - (sentAt + (receivedAt - sentAt) / 2);
}

export interface StageBar {
  name: string;
  ms: number | null;
  observable: boolean;
}
export interface TimingSummary {
  toFirstAudio: number | null;
  toEnd: number | null;
  stages: StageBar[];
}

const STAGES: [string, TimingPoint, TimingPoint][] = [
  ["turn detect", "speech_end", "turn_detected"],
  ["stt final", "turn_detected", "stt_final"],
  ["translate", "stt_final", "first_translation"],
  ["tts 1st byte", "first_translation", "first_tts_byte"],
  ["playback", "first_tts_byte", "first_audio"],
];

function span(t: Timings, a: TimingPoint, b: TimingPoint): number | null {
  const x = t[a];
  const y = t[b];
  return x === undefined || y === undefined || y < x ? null : Math.round(y - x);
}

/** Totals from true speech end, plus per-stage bars (voice-to-voice cannot observe stages, FR-026). */
export function summarizeTimings(t: Timings, mode: Mode): TimingSummary {
  return {
    toFirstAudio: span(t, "speech_end", "first_audio"),
    toEnd: span(t, "speech_end", "audio_end"),
    stages: STAGES.map(([name, a, b]) =>
      mode === "realtime"
        ? { name, ms: null, observable: false }
        : { name, ms: span(t, a, b), observable: true },
    ),
  };
}

export function floatToPcm16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

export function pcm16ToFloat(p: Int16Array): Float32Array {
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i] / 32768;
  return out;
}

/** Linear-interpolation resampler for one block. ponytail: no anti-alias filter; fine for speech STT input. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const n = Math.round((input.length * to) / from);
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const a = input[j] ?? 0;
    const b = input[j + 1] ?? a;
    out[i] = a + (b - a) * (pos - j);
  }
  return out;
}

/** Server audio frame: 4-byte big-endian seq, then PCM16 little-endian samples. */
export function parseAudioFrame(buf: ArrayBuffer): { seq: number; pcm: Int16Array } {
  const dv = new DataView(buf);
  const seq = dv.getUint32(0, false);
  const pcm = new Int16Array((buf.byteLength - 4) >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = dv.getInt16(4 + i * 2, true);
  return { seq, pcm };
}

/** Mono PCM16 WAV file bytes. */
export function encodeWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => dv.setInt16(44 + i * 2, s, true));
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const otherLang = (pair: [Lang, Lang], l: Lang): Lang => (l === pair[0] ? pair[1] : pair[0]);

// ---- Workbench display maths ---------------------------------------------------------------------------

const TERMINAL_STATES = new Set<TurnState>(["done", "failed", "empty", "cut"]);
export const isTerminalState = (s: TurnState) => TERMINAL_STATES.has(s);

export const MODE_LABEL: Record<Mode, string> = { realtime: "voice-to-voice", cascade: "cascade" };
export const TARGET_MS = 3000;

/** RMS of a block mapped to 0..1 on a dB scale (-55 dB = 0, -15 dB = 1), so quiet speech still moves the orb. */
export function rmsLevel(block: ArrayLike<number>): number {
  if (!block.length) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  const rms = Math.sqrt(sum / block.length);
  if (rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 55) / 40));
}

/** nearest-rank percentile; xs must be non-empty */
export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
}

export interface Pct {
  p50: number;
  p95: number;
}
export interface ModeSummary {
  mode: Mode;
  turns: number;
  firstAudio: Pct | null;
  audioEnd: Pct | null;
  /** null = this mode cannot observe stages (FR-026) */
  stages: { name: string; p50: number | null }[] | null;
}

export function modeSummary(turns: { mode: Mode; timings: Timings }[], mode: Mode): ModeSummary {
  const mine = turns.filter((t) => t.mode === mode).map((t) => summarizeTimings(t.timings, mode));
  const pct = (xs: (number | null)[]): Pct | null => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? { p50: percentile(v, 50), p95: percentile(v, 95) } : null;
  };
  return {
    mode,
    turns: mine.length,
    firstAudio: pct(mine.map((s) => s.toFirstAudio)),
    audioEnd: pct(mine.map((s) => s.toEnd)),
    stages:
      mode === "realtime"
        ? null
        : STAGES.map(([name], i) => ({ name, p50: pct(mine.map((s) => s.stages[i].ms))?.p50 ?? null })),
  };
}

export type Tone = "ok" | "bad" | "warn" | "muted";

const VENDOR_NAME: Record<string, string> = {
  deepgram: "Deepgram",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};
/** Display name for a vendor key from /api/config ("elevenlabs" → "ElevenLabs"); model names pass through. */
export const vendorLabel = (v: string) => VENDOR_NAME[v] ?? v;

/** A turn's result line is printed once it is settled: a done turn with audio waits for end of audio. */
export function resultReady(state: TurnState, t: Timings): boolean {
  if (!isTerminalState(state)) return false;
  if (state !== "done") return true;
  return t.audio_end !== undefined || (t.first_audio === undefined && t.first_tts_byte === undefined);
}

export type LayerKey = "stt" | "translate" | "tts";
export type LayerStatus = "waiting" | "active" | "done" | "failed";
export interface Layer {
  key: LayerKey;
  status: LayerStatus;
  ms: number | null;
  note?: string;
}
const LAYERS: [LayerKey, TimingPoint, TimingPoint][] = [
  ["stt", "speech_end", "stt_final"], // turn detection + STT final
  ["translate", "stt_final", "first_translation"],
  ["tts", "first_translation", "first_tts_byte"],
];

/** Cascade pipeline view for one turn: each layer waiting / active / done (with ms) / failed (with reason). */
export function cascadeLayers(t?: { state: TurnState; timings: Timings; reason?: string }): Layer[] {
  if (!t) return LAYERS.map(([key]) => ({ key, status: "waiting", ms: null }));
  const failed =
    t.state !== "failed"
      ? undefined
      : (LAYERS.find(([k]) => t.reason?.startsWith(k))?.[0] ??
        LAYERS.find(([, , b]) => t.timings[b] === undefined)?.[0]);
  return LAYERS.map(([key, a, b], i) => {
    if (t.timings[b] !== undefined) return { key, status: "done", ms: span(t.timings, a, b) };
    if (key === failed) return { key, status: "failed", ms: null, note: t.reason ?? "failed" };
    const ready = i === 0 || t.timings[LAYERS[i - 1][2]] !== undefined;
    return { key, status: ready && !isTerminalState(t.state) ? "active" : "waiting", ms: null };
  });
}

export type OrbState = "idle" | "listening" | "translating" | "speaking";
export function orbState(live: boolean, state?: TurnState): OrbState {
  if (!live) return "idle";
  if (state === "translating") return "translating";
  if (state === "speaking") return "speaking";
  return "listening";
}

// Pure scoring functions for scripts/eval/score.ts (docs/architecture/lld.md §7). No I/O, no network.
import { REALTIME_TOKENS_PER_MIN } from "./prices.ts";

/** Lowercase, strip punctuation (keep letters incl. accents, digits), collapse whitespace. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => (normalise(s) ? normalise(s).split(" ") : []);

/** Word error rate (S + D + I) / N on normalised text. Empty reference: insertions are counted with N = 1. */
export function wer(reference: string, hypothesis: string): number {
  const r = words(reference);
  const h = words(hypothesis);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[h.length] / Math.max(r.length, 1);
}

function charNgrams(s: string, n: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + n <= s.length; i++) {
    const g = s.slice(i, i + n);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** chrF (Popović 2015, sacrebleu defaults: char n-grams 1..6, beta 2, whitespace removed), 0..100. */
export function chrF(reference: string, hypothesis: string, maxN = 6, beta = 2): number {
  const r = reference.replace(/\s+/g, "");
  const h = hypothesis.replace(/\s+/g, "");
  let pSum = 0;
  let rSum = 0;
  let orders = 0;
  for (let n = 1; n <= maxN; n++) {
    const rg = charNgrams(r, n);
    const hg = charNgrams(h, n);
    const rTotal = r.length - n + 1;
    const hTotal = h.length - n + 1;
    if (rTotal <= 0 || hTotal <= 0) continue; // effective order: skip n-gram sizes longer than either text
    let match = 0;
    for (const [g, c] of hg) match += Math.min(c, rg.get(g) ?? 0);
    pSum += match / hTotal;
    rSum += match / rTotal;
    orders++;
  }
  if (!orders) return 0;
  const p = pSum / orders;
  const rc = rSum / orders;
  if (p + rc === 0) return 0;
  const b2 = beta * beta;
  return (100 * (1 + b2) * p * rc) / (b2 * p + rc);
}

/** Linear-interpolated percentile (numpy default), p in 0..100. Empty input gives NaN. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/** Exact match of each critical term as whole normalised words in the text. */
export function criticalTermHits(terms: string[], text: string) {
  const hay = ` ${normalise(text)} `;
  const missing = terms.filter((t) => !hay.includes(` ${normalise(t)} `));
  return { hits: terms.length - missing.length, total: terms.length, missing };
}

export interface RealtimePrices {
  audioInPer1M: number;
  audioOutPer1M: number;
  cachedInPer1M: number;
  transcribePerMin: number;
}

/**
 * Voice-to-voice call cost with context re-billing (R01 I3). Each minute k = 1..M bills its new audio
 * (600 tokens in, 1200·r out) plus every earlier minute's tokens again as cached input:
 *   cost(M) = M·(600·Pin + 1200·r·Pout)/1e6 + M·Ptranscribe + (M(M−1)/2)·(600 + 1200·r)·Pcached/1e6
 * r = output audio minutes per input minute. Assumes the cache always hits (cache misses bill at Pin instead).
 */
export function realtimeCallCost(minutes: number, r: number, p: RealtimePrices): number {
  const { in: tin, out: tout } = REALTIME_TOKENS_PER_MIN;
  const perMin = (tin * p.audioInPer1M + tout * r * p.audioOutPer1M) / 1e6 + p.transcribePerMin;
  const rebilled = ((minutes * (minutes - 1)) / 2) * (tin + tout * r) * (p.cachedInPer1M / 1e6);
  return minutes * perMin + rebilled;
}

// ---- WAV helpers (16-bit PCM mono) -----------------------------------------------------------------------

/** Linear-interpolation resampler; enough for TTS voice clips. */
export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  const out = new Int16Array(Math.floor((pcm.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const x = (i * from) / to;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    out[i] = Math.round(pcm[i0] + (pcm[i1] - pcm[i0]) * (x - i0));
  }
  return out;
}

export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return new Uint8Array(buf);
}

/** Duration of a PCM WAV: walks the chunks to find fmt (byte rate) and data size. */
export function wavDurationSec(wav: Uint8Array): number {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let byteRate = 0;
  for (let o = 12; o + 8 <= wav.length;) {
    const id = String.fromCharCode(...wav.subarray(o, o + 4));
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") byteRate = v.getUint32(o + 16, true);
    if (id === "data") return byteRate ? Math.min(size, wav.length - o - 8) / byteRate : 0;
    o += 8 + size + (size % 2);
  }
  return 0;
}

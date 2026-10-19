// Pure scoring functions for scripts/eval/score.ts (docs/architecture/lld.md §7). No I/O, no network.
import { VOICE_TO_VOICE_AUDIO_TOKENS_PER_MINUTE } from "./prices.ts";

/** Lowercase, strip punctuation (keep letters incl. accents, digits), collapse whitespace. */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const toWords = (text: string) => (normaliseText(text) ? normaliseText(text).split(" ") : []);

/** Word error rate (S + D + I) / N on normalised text. Empty reference: insertions are counted with N = 1. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const referenceWords = toWords(reference);
  const hypothesisWords = toWords(hypothesis);
  let previousRow = Array.from({ length: hypothesisWords.length + 1 }, (_, j) => j);
  for (let i = 1; i <= referenceWords.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= hypothesisWords.length; j++) {
      currentRow[j] = Math.min(
        previousRow[j] + 1,
        currentRow[j - 1] + 1,
        previousRow[j - 1] + (referenceWords[i - 1] === hypothesisWords[j - 1] ? 0 : 1),
      );
    }
    previousRow = currentRow;
  }
  return previousRow[hypothesisWords.length] / Math.max(referenceWords.length, 1);
}

function characterNgramCounts(text: string, n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= text.length; i++) {
    const ngram = text.slice(i, i + n);
    counts.set(ngram, (counts.get(ngram) ?? 0) + 1);
  }
  return counts;
}

/** chrF (Popović 2015, sacrebleu defaults: char n-grams 1..6, beta 2, whitespace removed), 0..100. */
export function chrF(reference: string, hypothesis: string, maxN = 6, beta = 2): number {
  const referenceText = reference.replace(/\s+/g, "");
  const hypothesisText = hypothesis.replace(/\s+/g, "");
  let precisionSum = 0;
  let recallSum = 0;
  let orders = 0;
  for (let n = 1; n <= maxN; n++) {
    const referenceNgrams = characterNgramCounts(referenceText, n);
    const hypothesisNgrams = characterNgramCounts(hypothesisText, n);
    const referenceTotal = referenceText.length - n + 1;
    const hypothesisTotal = hypothesisText.length - n + 1;
    if (referenceTotal <= 0 || hypothesisTotal <= 0) continue; // effective order: skip n-gram sizes longer than either text
    let match = 0;
    for (const [ngram, count] of hypothesisNgrams) match += Math.min(count, referenceNgrams.get(ngram) ?? 0);
    precisionSum += match / hypothesisTotal;
    recallSum += match / referenceTotal;
    orders++;
  }
  if (!orders) return 0;
  const precision = precisionSum / orders;
  const recall = recallSum / orders;
  if (precision + recall === 0) return 0;
  const betaSquared = beta * beta;
  return (100 * (1 + betaSquared) * precision * recall) / (betaSquared * precision + recall);
}

/**
 * Linear-interpolated percentile (numpy default), p in 0..100. Empty input gives NaN.
 * (The browser's turn summary uses nearestRankPercentile instead.)
 */
export function interpolatedPercentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * (rank - lowerIndex);
}

/** Exact match of each critical term as whole normalised words in the text. */
export function criticalTermHits(terms: string[], text: string) {
  const paddedText = ` ${normaliseText(text)} `;
  const missing = terms.filter((term) => !paddedText.includes(` ${normaliseText(term)} `));
  return { hits: terms.length - missing.length, total: terms.length, missing };
}

export interface VoiceToVoicePrices {
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
export function voiceToVoiceCallCost(
  minutes: number,
  outputMinutesPerInputMinute: number,
  prices: VoiceToVoicePrices,
): number {
  const { in: inputTokensPerMinute, out: outputTokensPerMinute } = VOICE_TO_VOICE_AUDIO_TOKENS_PER_MINUTE;
  const perMinute =
    (inputTokensPerMinute * prices.audioInPer1M +
      outputTokensPerMinute * outputMinutesPerInputMinute * prices.audioOutPer1M) /
      1e6 +
    prices.transcribePerMin;
  const rebilled =
    ((minutes * (minutes - 1)) / 2) *
    (inputTokensPerMinute + outputTokensPerMinute * outputMinutesPerInputMinute) *
    (prices.cachedInPer1M / 1e6);
  return minutes * perMinute + rebilled;
}

// ---- WAV helpers (16-bit PCM mono) -----------------------------------------------------------------------

/** Linear-interpolation resampler; enough for TTS voice clips. (The browser has resampleFloat32 for mic audio.) */
export function resamplePcm16(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  const out = new Int16Array(Math.floor((pcm.length * toRate) / fromRate));
  for (let i = 0; i < out.length; i++) {
    const x = (i * fromRate) / toRate;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    out[i] = Math.round(pcm[i0] + (pcm[i1] - pcm[i0]) * (x - i0));
  }
  return out;
}

export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) =>
    [...text].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true));
  return new Uint8Array(buffer);
}

/** Duration of a PCM WAV: walks the chunks to find fmt (byte rate) and data size. */
export function wavDurationSeconds(wav: Uint8Array): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = String.fromCharCode(...wav.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") byteRate = view.getUint32(offset + 16, true);
    if (id === "data") return byteRate ? Math.min(size, wav.length - offset - 8) / byteRate : 0;
    offset += 8 + size + (size % 2);
  }
  return 0;
}

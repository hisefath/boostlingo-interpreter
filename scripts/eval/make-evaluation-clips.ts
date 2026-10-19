// Synthesise eval/clips.json into eval/clips/<id>.wav (16 kHz mono PCM16) with OpenAI TTS (D24).
// Run: npx tsx --env-file=.env scripts/eval/make-evaluation-clips.ts   (existing files are skipped)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import type { EvaluationClip, LanguageCode } from "../../src/shared/contracts.ts";
import { pcm16ToWav, resamplePcm16 } from "./evaluation-metrics.ts";

const VOICE_BY_LANGUAGE: Partial<Record<LanguageCode, string>> = { en: "alloy", es: "nova" };
const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const clips: EvaluationClip[] = JSON.parse(readFileSync("eval/clips.json", "utf8"));
const openai = new OpenAI();
mkdirSync("eval/clips", { recursive: true });

for (const clip of clips) {
  const wavPath = `eval/clips/${clip.id}.wav`;
  if (existsSync(wavPath)) {
    console.log(`skip ${wavPath}`);
    continue;
  }
  // response_format "pcm" = raw 24 kHz 16-bit little-endian mono
  const speech = await openai.audio.speech.create({
    model,
    voice: VOICE_BY_LANGUAGE[clip.lang] ?? "nova",
    input: clip.text,
    response_format: "pcm",
  });
  const bytes = new Uint8Array(await speech.arrayBuffer());
  const pcm24kHz = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  writeFileSync(wavPath, pcm16ToWav(resamplePcm16(pcm24kHz, 24000, 16000), 16000));
  console.log(`wrote ${wavPath}`);
}

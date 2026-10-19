// Synthesise eval/clips.json into eval/clips/<id>.wav (16 kHz mono PCM16) with OpenAI TTS (D24).
// Run: npx tsx --env-file=.env scripts/eval/make-clips.ts   (existing files are skipped)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import type { EvalClip, Lang } from "../../src/shared/contracts.ts";
import { pcm16ToWav, resample } from "./metrics.ts";

const VOICE: Record<Lang, string> = { en: "alloy", es: "nova" };
const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const clips: EvalClip[] = JSON.parse(readFileSync("eval/clips.json", "utf8"));
const openai = new OpenAI();
mkdirSync("eval/clips", { recursive: true });

for (const clip of clips) {
  const out = `eval/clips/${clip.id}.wav`;
  if (existsSync(out)) {
    console.log(`skip ${out}`);
    continue;
  }
  // response_format "pcm" = raw 24 kHz 16-bit little-endian mono
  const res = await openai.audio.speech.create({
    model,
    voice: VOICE[clip.lang],
    input: clip.text,
    response_format: "pcm",
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pcm24 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  writeFileSync(out, pcm16ToWav(resample(pcm24, 24000, 16000), 16000));
  console.log(`wrote ${out}`);
}

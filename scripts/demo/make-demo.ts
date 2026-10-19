// Synthesise demo/conversation.json into src/client/public/demo/<id>.wav (16 kHz mono PCM16) with OpenAI TTS, one
// voice per speaker, and copy the script beside them. Vite's publicDir (src/client/public) ships as-is, so the
// "Run demo" button works in dev and in the production build at /demo/.
// Run: npx tsx --env-file=.env scripts/demo/make-demo.ts   (existing .wav files are skipped; delete one to redo it)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { parseScript } from "../../src/client/demo.ts";
import { pcm16ToWav, resample } from "../eval/metrics.ts";

const OUT = "src/client/public/demo";
const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const raw = readFileSync("demo/conversation.json", "utf8");
const turns = parseScript(JSON.parse(raw));
const openai = new OpenAI();
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/conversation.json`, raw);

for (const turn of turns) {
  const out = `${OUT}/${turn.id}.wav`;
  if (existsSync(out)) {
    console.log(`skip ${out}`);
    continue;
  }
  // response_format "pcm" = raw 24 kHz 16-bit little-endian mono
  const res = await openai.audio.speech.create({
    model,
    voice: turn.voice,
    input: turn.text,
    response_format: "pcm",
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pcm24 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  writeFileSync(out, pcm16ToWav(resample(pcm24, 24000, 16000), 16000));
  console.log(`wrote ${out}`);
}

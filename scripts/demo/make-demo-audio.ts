// Synthesise demo/conversation.json into src/client/public/demo/<id>.wav (16 kHz mono PCM16) with OpenAI TTS, one
// voice per speaker, and copy the script beside them. Vite's publicDir (src/client/public) ships as-is, so the
// "Run demo" button works in dev and in the production build at /demo/.
// Run: npx tsx --env-file=.env scripts/demo/make-demo-audio.ts   (existing .wav files are skipped; delete one to redo it)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { parseDemoScript } from "../../src/client/demo-runner.ts";
import { pcm16ToWav, resamplePcm16 } from "../eval/evaluation-metrics.ts";

const OUTPUT_DIR = "src/client/public/demo";
const model = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const scriptJson = readFileSync("demo/conversation.json", "utf8");
const turns = parseDemoScript(JSON.parse(scriptJson));
const openai = new OpenAI();
mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(`${OUTPUT_DIR}/conversation.json`, scriptJson);

for (const turn of turns) {
  const wavPath = `${OUTPUT_DIR}/${turn.id}.wav`;
  if (existsSync(wavPath)) {
    console.log(`skip ${wavPath}`);
    continue;
  }
  // response_format "pcm" = raw 24 kHz 16-bit little-endian mono
  const speech = await openai.audio.speech.create({
    model,
    voice: turn.voice,
    input: turn.text,
    response_format: "pcm",
  });
  const bytes = new Uint8Array(await speech.arrayBuffer());
  const pcm24kHz = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  writeFileSync(wavPath, pcm16ToWav(resamplePcm16(pcm24kHz, 24000, 16000), 16000));
  console.log(`wrote ${wavPath}`);
}

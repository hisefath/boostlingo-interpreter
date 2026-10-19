// EvalRunner (lld §5, §7): plays each eval clip as a fake mic through the active transport, one at a time,
// records per-turn timings, texts, state and the interpreted audio, then posts an EvalRun.
import type { EvalClip, EvalRun, EvalTurnResult, Stage } from "../shared/contracts.ts";
import { capture } from "./capture.ts";
import { encodeWav, floatToPcm16, toBase64 } from "./lib.ts";
import { isTerminal, type Session } from "./session.ts";

const GAP_MS = 3500; // longer than either mode's turn-detection wait (~1.6 s cascade), so clips never merge
const TURN_TIMEOUT_MS = 15000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runEval(
  session: Session,
  vendors: Record<string, string>,
  progress: (msg: string) => void,
): Promise<EvalRun> {
  const clips = (await (await fetch("/api/eval-clips")).json()) as EvalClip[];
  if (!clips.length) throw new Error("no eval clips (eval/clips.json is empty or missing)");
  const ctx = new AudioContext();
  const mic = ctx.createMediaStreamDestination();
  const run: EvalRun = {
    runId: `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    startedAt: new Date().toISOString(),
    vendors: Object.fromEntries(
      (["stt", "translate", "tts", "realtime"] as (Stage | "realtime")[]).map((k) => [
        k,
        vendors[k] ?? "unknown",
      ]),
    ) as EvalRun["vendors"],
    turns: [],
  };
  try {
    if (session.live) session.stop();
    await session.start(mic.stream);
    for (const [i, clip] of clips.entries()) {
      progress(`Eval ${i + 1}/${clips.length}: ${clip.id}`);
      const buf = await ctx.decodeAudioData(await (await fetch(`/eval/clips/${clip.id}.wav`)).arrayBuffer());
      const before = session.turns.length;
      const samples: number[] = [];
      let stopRec: (() => void) | null = null;
      const record = async () => {
        const out = session.output();
        if (out && !stopRec) stopRec = await capture(ctx, out, (f) => f.forEach((v) => samples.push(v)));
      };
      await record();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(mic);
      src.start();
      const deadline = performance.now() + buf.duration * 1000 + TURN_TIMEOUT_MS;
      const clipEnd = performance.now() + buf.duration * 1000;
      while (performance.now() < deadline) {
        await sleep(200);
        await record(); // voice-to-voice output track may appear after the first clip starts
        const fresh = session.turns.slice(before);
        if (performance.now() > clipEnd && fresh.length && fresh.every(isTerminal)) break;
      }
      (stopRec as (() => void) | null)?.();
      run.turns.push(toResult(clip, session, before, samples, ctx.sampleRate));
      await sleep(GAP_MS);
    }
  } finally {
    session.stop();
    void ctx.close();
  }
  progress("Saving eval results…");
  const r = await fetch("/api/eval-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(run),
  });
  if (!r.ok) throw new Error(`saving eval results failed (${r.status})`);
  progress(`Eval done: ${run.turns.length} clips saved as ${run.runId}`);
  return run;
}

function toResult(
  clip: EvalClip,
  s: Session,
  before: number,
  samples: number[],
  rate: number,
): EvalTurnResult {
  const turns = s.turns.slice(before);
  const first = turns[0];
  return {
    clipId: clip.id,
    mode: s.mode,
    timings: first?.timings ?? {},
    srcText: turns
      .map((t) => t.srcText ?? "")
      .join(" ")
      .trim(),
    tgtText: turns
      .map((t) => t.tgtText ?? "")
      .join(" ")
      .trim(),
    state: turns.at(-1)?.state ?? "empty",
    outputAudioWav: samples.length
      ? toBase64(encodeWav(floatToPcm16(Float32Array.from(samples)), rate))
      : undefined,
  };
}

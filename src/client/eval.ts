// EvalRunner (lld §5, §7): plays each eval clip as a fake mic through the active transport, one at a time,
// records per-turn timings, texts, state and the interpreted audio, then posts an EvalRun.
// SoakRunner (REQ-19): the same fake mic for 5 minutes, alternating EN/ES routine clips, then posts a soak summary.
import type { EvalClip, EvalRun, EvalTurnResult, Lang, Mode, Stage } from "../shared/contracts.ts";
import { capture } from "./capture.ts";
import { encodeWav, floatToPcm16, resultReady, toBase64 } from "./lib.ts";
import { isTerminal, type Session, type Turn } from "./session.ts";
import {
  HEAP_EVERY_MS,
  SOAK_MS,
  soakLine,
  summarizeSoak,
  type HeapSample,
  type SoakSummary,
} from "./soak.ts";

const GAP_MS = 3500; // longer than either mode's turn-detection wait (~1.6 s cascade), so clips never merge
const TURN_TIMEOUT_MS = 15000;
const SOAK_GAP_MS = 1000; // soak waits for the turn to settle first, so a short pause cannot merge clips

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const vendorMap = (vendors: Record<string, string>) =>
  Object.fromEntries(
    (["stt", "translate", "tts", "realtime"] as (Stage | "realtime")[]).map((k) => [
      k,
      vendors[k] ?? "unknown",
    ]),
  ) as EvalRun["vendors"];

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** an eval run, or a soak summary shaped as an empty run (turns: []) */
async function saveRun(body: EvalRun & { mode?: Mode; soak?: SoakSummary }): Promise<void> {
  const r = await fetch("/api/eval-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`saving results failed (${r.status})`);
}

/** plays one clip into the fake mic, waits until its turns settle (or time out); returns the first new turn index */
async function playClip(
  ctx: AudioContext,
  mic: MediaStreamAudioDestinationNode,
  session: Session,
  buf: AudioBuffer,
  settled: (t: Turn) => boolean,
  tick: () => Promise<void> = async () => {},
): Promise<number> {
  const before = session.turns.length;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(mic);
  src.start();
  const clipEnd = performance.now() + buf.duration * 1000;
  const deadline = clipEnd + TURN_TIMEOUT_MS;
  while (performance.now() < deadline) {
    await sleep(200);
    await tick();
    const fresh = session.turns.slice(before);
    if (performance.now() > clipEnd && fresh.length && fresh.every(settled)) break;
  }
  return before;
}

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
    runId: `run-${stamp()}`,
    startedAt: new Date().toISOString(),
    vendors: vendorMap(vendors),
    turns: [],
  };
  try {
    if (session.live) session.stop();
    session.setEchoGuard(false); // fake mic hears no speakers: never mute it during an eval
    await session.start(mic.stream);
    for (const [i, clip] of clips.entries()) {
      progress(`Eval ${i + 1}/${clips.length}: ${clip.id}`);
      const buf = await ctx.decodeAudioData(await (await fetch(`/eval/clips/${clip.id}.wav`)).arrayBuffer());
      const samples: number[] = [];
      let stopRec: (() => void) | null = null;
      const record = async () => {
        const out = session.output();
        if (out && !stopRec) stopRec = await capture(ctx, out, (f) => f.forEach((v) => samples.push(v)));
      };
      await record();
      // voice-to-voice output track may appear after the first clip starts, so record() runs every tick
      const before = await playClip(ctx, mic, session, buf, isTerminal, record);
      (stopRec as (() => void) | null)?.();
      run.turns.push(toResult(clip, session, before, samples, ctx.sampleRate));
      await sleep(GAP_MS);
    }
  } finally {
    session.stop();
    void ctx.close();
  }
  progress("Saving eval results…");
  await saveRun(run);
  progress(`Eval done: ${run.turns.length} clips saved as ${run.runId}`);
  return run;
}

const heapBytes = () =>
  (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;

/**
 * 5-minute soak in the active mode (NFR-003): alternates EN and ES routine clips, starting each only after the
 * previous turn settled. `notices` is filled by the caller with every session notice seen during the run.
 */
export async function runSoak(
  session: Session,
  vendors: Record<string, string>,
  progress: (msg: string) => void,
  notices: string[],
  durationMs = SOAK_MS,
): Promise<SoakSummary> {
  const all = (await (await fetch("/api/eval-clips")).json()) as EvalClip[];
  const routine = (lang: Lang) => all.filter((c) => c.kind === "routine" && c.lang === lang);
  const byLang = [routine("en"), routine("es")];
  if (!byLang[0].length || !byLang[1].length)
    throw new Error("soak needs English and Spanish routine eval clips");
  const ctx = new AudioContext();
  const mic = ctx.createMediaStreamDestination();
  const bufs = new Map<string, AudioBuffer>(); // decode each clip once so re-fetching never shows up as heap growth
  const startedAt = new Date().toISOString();
  const runId = `soak-${stamp()}`;
  const mode = session.mode;
  const heap: HeapSample[] = [];
  const t0 = performance.now();
  const sampleHeap = () => {
    const bytes = heapBytes();
    if (bytes) heap.push({ atMs: Math.round(performance.now() - t0), bytes });
  };
  const timer = setInterval(sampleHeap, HEAP_EVERY_MS);
  let attempted = 0;
  const first = session.turns.length; // Session keeps history; this run's turns start here
  try {
    if (session.live) session.stop();
    session.setEchoGuard(false); // fake mic hears no speakers, as in the eval
    sampleHeap();
    await session.start(mic.stream);
    while (performance.now() - t0 < durationMs) {
      const pool = byLang[attempted % 2];
      const clip = pool[Math.floor(attempted / 2) % pool.length];
      let buf = bufs.get(clip.id);
      if (!buf) {
        buf = await ctx.decodeAudioData(await (await fetch(`/eval/clips/${clip.id}.wav`)).arrayBuffer());
        bufs.set(clip.id, buf);
      }
      attempted++;
      progress(
        `Soak ${Math.round((performance.now() - t0) / 1000)}/${durationMs / 1000} s · turn ${attempted}: ${clip.id}`,
      );
      // settled = terminal, and a spoken turn has finished playing, so the next clip never overlaps playback
      await playClip(
        ctx,
        mic,
        session,
        buf,
        (t) => t.timings.audio_end !== undefined || resultReady(t.state, t.timings),
      );
      await sleep(SOAK_GAP_MS);
    }
    sampleHeap();
  } finally {
    clearInterval(timer);
    session.stop();
    void ctx.close();
  }
  const soak = summarizeSoak({
    durationMs: performance.now() - t0,
    attempted,
    turns: session.turns.slice(first),
    notices,
    heap,
  });
  progress("Saving soak results…");
  // turns: [] keeps the file a valid EvalRun, so scripts/eval/score.ts eval/results/*.json still reads it
  await saveRun({ runId, startedAt, vendors: vendorMap(vendors), mode, turns: [], soak });
  progress(soakLine(soak, runId));
  return soak;
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

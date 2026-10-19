// runEvaluation (lld §5, §7): plays each eval clip as a fake mic through the active transport, one at a time,
// records per-turn timings, texts, state and the interpreted audio, then posts an EvaluationRun.
// runSoakTest (REQ-19): the same fake mic for 5 minutes, alternating EN/ES routine clips, then posts a soak summary.
import type {
  EvaluationClip,
  EvaluationRun,
  EvaluationTurnResult,
  LanguageCode,
  Mode,
  Stage,
} from "../shared/contracts.ts";
import { captureAudioChunks } from "./audio-capture.ts";
import { encodeWav, floatToPcm16, isResultReady, toBase64 } from "./timing-and-audio-helpers.ts";
import { isTurnFinished, type Session, type Turn } from "./session.ts";
import {
  HEAP_SAMPLE_INTERVAL_MS,
  SOAK_DURATION_MS,
  soakStatusLine,
  summarizeSoak,
  type HeapSample,
  type SoakSummary,
} from "./soak-test-summary.ts";

const GAP_BETWEEN_CLIPS_MS = 3500; // longer than either mode's turn-detection wait (~1.6 s cascade), so clips never merge
const TURN_TIMEOUT_MS = 15000;
const SOAK_GAP_BETWEEN_CLIPS_MS = 1000; // soak waits for the turn to settle first, so a short pause cannot merge clips

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const vendorsForRun = (vendors: Record<string, string>) =>
  Object.fromEntries(
    (["stt", "translate", "tts", "realtime"] as (Stage | "realtime")[]).map((key) => [
      key,
      vendors[key] ?? "unknown",
    ]),
  ) as EvaluationRun["vendors"];

const fileSafeTimestamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** an eval run, or a soak summary shaped as an empty run (turns: []) */
async function saveRun(body: EvaluationRun & { mode?: Mode; soak?: SoakSummary }): Promise<void> {
  const response = await fetch("/api/eval-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`saving results failed (${response.status})`);
}

/** plays one clip into the fake mic, waits until its turns settle (or time out); returns the first new turn index */
async function playClip(
  audioContext: AudioContext,
  fakeMicrophone: MediaStreamAudioDestinationNode,
  session: Session,
  audioBuffer: AudioBuffer,
  isSettled: (turn: Turn) => boolean,
  onTick: () => Promise<void> = async () => {},
): Promise<number> {
  const firstTurnIndex = session.turns.length;
  const sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(fakeMicrophone);
  sourceNode.start();
  const clipEnd = performance.now() + audioBuffer.duration * 1000;
  const deadline = clipEnd + TURN_TIMEOUT_MS;
  while (performance.now() < deadline) {
    await sleep(200);
    await onTick();
    const freshTurns = session.turns.slice(firstTurnIndex);
    if (performance.now() > clipEnd && freshTurns.length && freshTurns.every(isSettled)) break;
  }
  return firstTurnIndex;
}

export async function runEvaluation(
  session: Session,
  vendors: Record<string, string>,
  progress: (message: string) => void,
): Promise<EvaluationRun> {
  const clips = (await (await fetch("/api/eval-clips")).json()) as EvaluationClip[];
  if (!clips.length) throw new Error("no eval clips (eval/clips.json is empty or missing)");
  const audioContext = new AudioContext();
  const fakeMicrophone = audioContext.createMediaStreamDestination();
  const run: EvaluationRun = {
    runId: `run-${fileSafeTimestamp()}`,
    startedAt: new Date().toISOString(),
    vendors: vendorsForRun(vendors),
    turns: [],
  };
  try {
    if (session.live) session.stop();
    session.setEchoGuard(false); // fake mic hears no speakers: never mute it during an eval
    await session.start(fakeMicrophone.stream);
    for (const [i, clip] of clips.entries()) {
      progress(`Eval ${i + 1}/${clips.length}: ${clip.id}`);
      const audioBuffer = await audioContext.decodeAudioData(
        await (await fetch(`/eval/clips/${clip.id}.wav`)).arrayBuffer(),
      );
      const samples: number[] = [];
      let stopRecording: (() => void) | null = null;
      const startRecordingWhenOutputExists = async () => {
        const output = session.output();
        if (output && !stopRecording)
          stopRecording = await captureAudioChunks(audioContext, output, (chunk) =>
            chunk.forEach((sample) => samples.push(sample)),
          );
      };
      await startRecordingWhenOutputExists();
      // voice-to-voice output track may appear after the first clip starts, so recording is retried every tick
      const firstTurnIndex = await playClip(
        audioContext,
        fakeMicrophone,
        session,
        audioBuffer,
        isTurnFinished,
        startRecordingWhenOutputExists,
      );
      (stopRecording as (() => void) | null)?.();
      run.turns.push(toTurnResult(clip, session, firstTurnIndex, samples, audioContext.sampleRate));
      await sleep(GAP_BETWEEN_CLIPS_MS);
    }
  } finally {
    session.stop();
    void audioContext.close();
  }
  progress("Saving eval results…");
  await saveRun(run);
  progress(`Eval done: ${run.turns.length} clips saved as ${run.runId}`);
  return run;
}

const usedHeapBytes = () =>
  (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;

/**
 * 5-minute soak in the active mode (NFR-003): alternates EN and ES routine clips, starting each only after the
 * previous turn settled. `notices` is filled by the caller with every session notice seen during the run.
 */
export async function runSoakTest(
  session: Session,
  vendors: Record<string, string>,
  progress: (message: string) => void,
  notices: string[],
  durationMs = SOAK_DURATION_MS,
): Promise<SoakSummary> {
  const allClips = (await (await fetch("/api/eval-clips")).json()) as EvaluationClip[];
  const routine = (language: LanguageCode) =>
    allClips.filter((clip) => clip.kind === "routine" && clip.lang === language);
  const routineClipsByLanguage = [routine("en"), routine("es")];
  if (!routineClipsByLanguage[0].length || !routineClipsByLanguage[1].length)
    throw new Error("soak needs English and Spanish routine eval clips");
  const audioContext = new AudioContext();
  const fakeMicrophone = audioContext.createMediaStreamDestination();
  const decodedClips = new Map<string, AudioBuffer>(); // decode each clip once so re-fetching never shows up as heap growth
  const startedAt = new Date().toISOString();
  const runId = `soak-${fileSafeTimestamp()}`;
  const mode = session.mode;
  const heap: HeapSample[] = [];
  const startedAtMs = performance.now();
  const sampleHeap = () => {
    const bytes = usedHeapBytes();
    if (bytes) heap.push({ atMs: Math.round(performance.now() - startedAtMs), bytes });
  };
  const timer = setInterval(sampleHeap, HEAP_SAMPLE_INTERVAL_MS);
  let attempted = 0;
  const firstTurnIndex = session.turns.length; // Session keeps history; this run's turns start here
  try {
    if (session.live) session.stop();
    session.setEchoGuard(false); // fake mic hears no speakers, as in the eval
    sampleHeap();
    await session.start(fakeMicrophone.stream);
    while (performance.now() - startedAtMs < durationMs) {
      const pool = routineClipsByLanguage[attempted % 2];
      const clip = pool[Math.floor(attempted / 2) % pool.length];
      let audioBuffer = decodedClips.get(clip.id);
      if (!audioBuffer) {
        audioBuffer = await audioContext.decodeAudioData(
          await (await fetch(`/eval/clips/${clip.id}.wav`)).arrayBuffer(),
        );
        decodedClips.set(clip.id, audioBuffer);
      }
      attempted++;
      progress(
        `Soak ${Math.round((performance.now() - startedAtMs) / 1000)}/${durationMs / 1000} s · turn ${attempted}: ${clip.id}`,
      );
      // settled = finished, and a spoken turn has finished playing, so the next clip never overlaps playback
      await playClip(
        audioContext,
        fakeMicrophone,
        session,
        audioBuffer,
        (turn) => turn.timings.audio_end !== undefined || isResultReady(turn.state, turn.timings),
      );
      await sleep(SOAK_GAP_BETWEEN_CLIPS_MS);
    }
    sampleHeap();
  } finally {
    clearInterval(timer);
    session.stop();
    void audioContext.close();
  }
  const soak = summarizeSoak({
    durationMs: performance.now() - startedAtMs,
    attempted,
    turns: session.turns.slice(firstTurnIndex),
    notices,
    heap,
  });
  progress("Saving soak results…");
  // turns: [] keeps the file a valid EvaluationRun, so scripts/eval/score.ts eval/results/*.json still reads it
  await saveRun({ runId, startedAt, vendors: vendorsForRun(vendors), mode, turns: [], soak });
  progress(soakStatusLine(soak, runId));
  return soak;
}

function toTurnResult(
  clip: EvaluationClip,
  session: Session,
  firstTurnIndex: number,
  samples: number[],
  sampleRate: number,
): EvaluationTurnResult {
  const turns = session.turns.slice(firstTurnIndex);
  const first = turns[0];
  return {
    clipId: clip.id,
    mode: session.mode,
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
      ? toBase64(encodeWav(floatToPcm16(Float32Array.from(samples)), sampleRate))
      : undefined,
  };
}

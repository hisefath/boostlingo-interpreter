// Demo runner: plays the prerecorded two-speaker call in /demo/ (made by scripts/demo/make-demo-audio.ts) as a fake
// mic through the active transport, the way evaluation-runners.ts feeds clips, and (audible) plays each clip quietly
// through the speakers so a viewer or a screen recording hears the original speaker, then the interpretation.
import type { LanguageCode } from "../shared/contracts.ts";
import { isFinishedState } from "./timing-and-audio-helpers.ts";
import type { Session, Turn } from "./session.ts";

export interface DemoTurn {
  id: string;
  speaker: string;
  lang: LanguageCode;
  text: string;
  voice: string;
}

const PAUSE_BETWEEN_SPEAKERS_MS = 700; // natural gap between speakers
const MAX_WAIT_AFTER_CLIP_MS = 20_000; // per turn, after the clip ends: never hang the demo on a lost event
const POLL_INTERVAL_MS = 200;
const SPEAKER_GAIN = 0.35; // original speaker plays quieter than the interpretation
const DEMO_TURN_ID_PATTERN = /^[a-z0-9-]{1,40}$/; // ids become URL and file paths

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isNonBlankString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** Validates the demo script (fetched JSON, so untrusted shape); throws naming the first bad turn. */
export function parseDemoScript(script: unknown): DemoTurn[] {
  if (!Array.isArray(script) || !script.length)
    throw new Error("demo script must be a non-empty array of turns");
  return script.map((turn: Partial<DemoTurn> | null, i) => {
    if (
      !turn ||
      typeof turn.id !== "string" ||
      !DEMO_TURN_ID_PATTERN.test(turn.id) ||
      (turn.lang !== "en" && turn.lang !== "es") ||
      !isNonBlankString(turn.speaker) ||
      !isNonBlankString(turn.text) ||
      !isNonBlankString(turn.voice)
    )
      throw new Error(`demo turn ${i + 1} is invalid (needs id, speaker, lang en|es, text, voice)`);
    return { id: turn.id, speaker: turn.speaker, lang: turn.lang, text: turn.text, voice: turn.voice };
  });
}

/** "Demo 3/8 · Sra. Gómez (ES): ¿Necesito traer…" */
export function progressText(index: number, total: number, turn: DemoTurn, maxCharacters = 60): string {
  const text =
    turn.text.length > maxCharacters ? `${turn.text.slice(0, maxCharacters - 1).trimEnd()}…` : turn.text;
  return `Demo ${index + 1}/${total} · ${turn.speaker} (${turn.lang.toUpperCase()}): ${text}`;
}

/** A turn is settled once its interpreted audio ended, or it is finished with nothing left to play. */
export function isTurnSettled(turn: Pick<Turn, "state" | "timings">): boolean {
  if (turn.timings.audio_end !== undefined) return true;
  return isFinishedState(turn.state) && !(turn.state === "done" && turn.timings.first_audio !== undefined);
}

/** Next speaker may start: the clip finished and every turn it produced has settled. */
export const readyForNext = (freshTurns: Pick<Turn, "state" | "timings">[], clipEnded: boolean): boolean =>
  clipEnded && freshTurns.length > 0 && freshTurns.every(isTurnSettled);

export async function runDemo(
  session: Session,
  progress: (message: string) => void,
  options: { audible?: boolean } = {},
): Promise<void> {
  const scriptResponse = await fetch("/demo/conversation.json");
  if (!scriptResponse.ok)
    throw new Error(`demo script missing (${scriptResponse.status}); run scripts/demo/make-demo-audio.ts`);
  const script = parseDemoScript(await scriptResponse.json());
  const audioContext = new AudioContext();
  const fakeMicrophone = audioContext.createMediaStreamDestination();
  const speakers = audioContext.createGain();
  speakers.gain.value = SPEAKER_GAIN;
  speakers.connect(audioContext.destination);
  const previousEchoGuard = session.echoGuard;
  let played = 0;
  try {
    if (session.live) session.stop();
    session.setEchoGuard(false); // fake mic hears no speakers: never mute it during the demo
    await session.start(fakeMicrophone.stream);
    for (const [i, turn] of script.entries()) {
      progress(progressText(i, script.length, turn));
      const audioResponse = await fetch(`/demo/${turn.id}.wav`);
      if (!audioResponse.ok)
        throw new Error(
          `demo audio ${turn.id}.wav missing (${audioResponse.status}); run scripts/demo/make-demo-audio.ts`,
        );
      const audioBuffer = await audioContext.decodeAudioData(await audioResponse.arrayBuffer());
      if (!session.live) break;
      const firstTurnIndex = session.turns.length;
      const sourceNode = audioContext.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(fakeMicrophone);
      if (options.audible ?? true) sourceNode.connect(speakers);
      sourceNode.start();
      const clipEnd = performance.now() + audioBuffer.duration * 1000;
      const deadline = clipEnd + MAX_WAIT_AFTER_CLIP_MS;
      while (session.live && performance.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        if (readyForNext(session.turns.slice(firstTurnIndex), performance.now() >= clipEnd)) break;
      }
      if (!session.live) break; // stopped mid-demo (Stop button)
      played++;
      await sleep(PAUSE_BETWEEN_SPEAKERS_MS);
    }
  } finally {
    // ponytail: "live" is the stop signal; a new session started within one poll of Stop would also be stopped here
    if (session.live) session.stop();
    session.setEchoGuard(previousEchoGuard);
    void audioContext.close();
  }
  progress(
    played === script.length
      ? `Demo done: ${played} turns`
      : `Demo stopped after ${played}/${script.length} turns`,
  );
}

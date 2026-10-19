// DemoRunner: plays the prerecorded two-speaker call in /demo/ (made by scripts/demo/make-demo.ts) as a fake mic
// through the active transport, the way eval.ts feeds clips, and (audible) plays each clip quietly through the speakers
// so a viewer or a screen recording hears the original speaker, then the interpretation.
import type { Lang } from "../shared/contracts.ts";
import { isTerminalState } from "./lib.ts";
import type { Session, Turn } from "./session.ts";

export interface DemoTurn {
  id: string;
  speaker: string;
  lang: Lang;
  text: string;
  voice: string;
}

const PAUSE_MS = 700; // natural gap between speakers
const WAIT_CAP_MS = 20_000; // per turn, after the clip ends: never hang the demo on a lost event
const POLL_MS = 200;
const SPEAKER_GAIN = 0.35; // original speaker plays quieter than the interpretation
const ID = /^[a-z0-9-]{1,40}$/; // ids become URL and file paths

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const filled = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";

/** Validates the demo script (fetched JSON, so untrusted shape); throws naming the first bad turn. */
export function parseScript(x: unknown): DemoTurn[] {
  if (!Array.isArray(x) || !x.length) throw new Error("demo script must be a non-empty array of turns");
  return x.map((t: Partial<DemoTurn> | null, i) => {
    if (
      !t ||
      typeof t.id !== "string" ||
      !ID.test(t.id) ||
      (t.lang !== "en" && t.lang !== "es") ||
      !filled(t.speaker) ||
      !filled(t.text) ||
      !filled(t.voice)
    )
      throw new Error(`demo turn ${i + 1} is invalid (needs id, speaker, lang en|es, text, voice)`);
    return { id: t.id, speaker: t.speaker, lang: t.lang, text: t.text, voice: t.voice };
  });
}

/** "Demo 3/8 · Sra. Gómez (ES): ¿Necesito traer…" */
export function progressText(i: number, n: number, t: DemoTurn, max = 60): string {
  const text = t.text.length > max ? `${t.text.slice(0, max - 1).trimEnd()}…` : t.text;
  return `Demo ${i + 1}/${n} · ${t.speaker} (${t.lang.toUpperCase()}): ${text}`;
}

/** A turn is settled once its interpreted audio ended, or it is terminal with nothing left to play. */
export function settled(t: Pick<Turn, "state" | "timings">): boolean {
  if (t.timings.audio_end !== undefined) return true;
  return isTerminalState(t.state) && !(t.state === "done" && t.timings.first_audio !== undefined);
}

/** Next speaker may start: the clip finished and every turn it produced has settled. */
export const readyForNext = (fresh: Pick<Turn, "state" | "timings">[], clipEnded: boolean): boolean =>
  clipEnded && fresh.length > 0 && fresh.every(settled);

export async function runDemo(
  session: Session,
  progress: (msg: string) => void,
  opts: { audible?: boolean } = {},
): Promise<void> {
  const res = await fetch("/demo/conversation.json");
  if (!res.ok) throw new Error(`demo script missing (${res.status}); run scripts/demo/make-demo.ts`);
  const script = parseScript(await res.json());
  const ctx = new AudioContext();
  const mic = ctx.createMediaStreamDestination();
  const speakers = ctx.createGain();
  speakers.gain.value = SPEAKER_GAIN;
  speakers.connect(ctx.destination);
  const guard = session.echoGuard;
  let played = 0;
  try {
    if (session.live) session.stop();
    session.setEchoGuard(false); // fake mic hears no speakers: never mute it during the demo
    await session.start(mic.stream);
    for (const [i, turn] of script.entries()) {
      progress(progressText(i, script.length, turn));
      const r = await fetch(`/demo/${turn.id}.wav`);
      if (!r.ok)
        throw new Error(`demo audio ${turn.id}.wav missing (${r.status}); run scripts/demo/make-demo.ts`);
      const buf = await ctx.decodeAudioData(await r.arrayBuffer());
      if (!session.live) break;
      const before = session.turns.length;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(mic);
      if (opts.audible ?? true) src.connect(speakers);
      src.start();
      const clipEnd = performance.now() + buf.duration * 1000;
      const deadline = clipEnd + WAIT_CAP_MS;
      while (session.live && performance.now() < deadline) {
        await sleep(POLL_MS);
        if (readyForNext(session.turns.slice(before), performance.now() >= clipEnd)) break;
      }
      if (!session.live) break; // stopped mid-demo (Stop button)
      played++;
      await sleep(PAUSE_MS);
    }
  } finally {
    // ponytail: "live" is the stop signal; a new session started within one poll of Stop would also be stopped here
    if (session.live) session.stop();
    session.setEchoGuard(guard);
    void ctx.close();
  }
  progress(
    played === script.length
      ? `Demo done: ${played} turns`
      : `Demo stopped after ${played}/${script.length} turns`,
  );
}

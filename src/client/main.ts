// Workbench UI: orb, architecture toggle, pipeline view, metrics terminal, conversation (render only; state lives
// in Session). Every number shown comes from the turn's timing points; a mode never shows a metric it cannot see.
/// <reference types="vite/client" />
import type { LanguageCode, Mode, TimingPoint } from "../shared/contracts.ts";
import { metricsDashboardHtml } from "./metrics-dashboard.ts";
import { runDemo } from "./demo-runner.ts";
import { LANGUAGES } from "../shared/languages.ts";
import { runEvaluation, runSoakTest } from "./evaluation-runners.ts";
import {
  cascadePipelineLayers,
  MODE_LABELS,
  orbState,
  isResultReady,
  rmsLevel,
  summarizeTimings,
  vendorDisplayName,
  type Tone,
} from "./timing-and-audio-helpers.ts";
import { PAIRS } from "../shared/languages.ts";
import { Session, type Turn } from "./session.ts";
import { headerLine, resultLine, timingLine, type Token } from "./metrics-terminal.ts";
import { CascadeTransport } from "./transports/cascade.ts";
import { VoiceToVoiceTransport } from "./transports/voice-to-voice.ts";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const startButton = byId<HTMLButtonElement>("start");
const evaluationButton = byId<HTMLButtonElement>("run-evaluation");
const soakButton = byId<HTMLButtonElement>("run-soak-test");
const demoButton = byId<HTMLButtonElement>("run-demo");
const pairSelect = byId<HTMLSelectElement>("language-pair");
pairSelect.replaceChildren(...PAIRS.map((pair) => new Option(pair.label, pair.id))); // one list: src/shared/languages.ts
const headphones = byId<HTMLInputElement>("headphones");
const statusElement = byId("status");
const orb = byId("orb");
const logElement = byId("terminal-log");
const terminalBody = byId("terminal-body");
const turnsElement = byId("turns");
const MAX_LOG_LINES = 500;

let vendors: Record<string, string> = {};
let micDenied = false;
let busy = false;
let demoRunning = false; // during a demo, Start/Stop stays usable as Stop
let noticeListener: ((message: string) => void) | null = null; // soak counts disconnect/reconnect notices
const setStatus = (message: string) => (statusElement.textContent = message);

const session = new Session(
  (mode, events) => (mode === "realtime" ? new VoiceToVoiceTransport(events) : new CascadeTransport(events)),
  (notice, isError) => {
    if (notice) {
      noticeListener?.(notice);
      setStatus(notice);
      appendLogMessage(`${isError ? "!" : "#"} ${notice}`, isError ? "bad" : "muted");
      if (isError) flashError();
    }
    render();
  },
);

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

// ---- metrics terminal --------------------------------------------------------------------------------------

const nearBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < 60;

function appendLogLine(line: HTMLElement): void {
  const stick = nearBottom(terminalBody);
  logElement.append(line);
  while (logElement.childElementCount > MAX_LOG_LINES) logElement.firstElementChild!.remove();
  if (stick) terminalBody.scrollTop = terminalBody.scrollHeight;
}

/** A free-text line (notices, errors, prompts). */
function appendLogMessage(text: string, tone?: Tone): void {
  const line = document.createElement("div");
  line.className = `line message${tone ? ` tone-${tone}` : ""}`;
  line.textContent = text;
  appendLogLine(line);
}

/** Token spans: class terminal-token-<kind> plus terminal-token-<tone> (a verdict tone, or the mode for the mode column). */
function fillLineWithTokens(element: HTMLElement, tokens: Token[]): HTMLElement {
  element.replaceChildren(
    ...tokens.map((token) => {
      if (token.kind === "separator") return token.text;
      const span = document.createElement("span");
      span.className = `terminal-token-${token.kind}${token.tone ? ` terminal-token-${token.tone}` : ""}`;
      span.textContent = token.text;
      return span;
    }),
  );
  return element;
}

/** A turn line; turns alternate shading and a result line closes its turn with a separator. */
function appendTokenLine(tokens: Token[], seq: number, end = false): void {
  const line = document.createElement("div");
  line.className = `line turn-${seq % 2 ? "odd" : "even"}${end ? " turn-end" : ""}`;
  appendLogLine(fillLineWithTokens(line, tokens));
}
fillLineWithTokens(byId("terminal-header"), headerLine());

const loggedEvents = new Set<string>();
const toWallClockMs = (browserMs: number) => performance.timeOrigin + browserMs;

/** Prints each timing point and each settled turn exactly once, in the order they happened. */
function logTurn(turn: Turn): void {
  const points = (Object.entries(turn.timings) as [TimingPoint, number][])
    .filter(([point]) => !loggedEvents.has(`${turn.turnId}:${point}`))
    .sort((a, b) => a[1] - b[1]);
  for (const [point, atMs] of points) {
    loggedEvents.add(`${turn.turnId}:${point}`);
    // voice-to-voice turn_detected is speech_end + the fixed VAD wait by construction: nothing to measure
    if (turn.mode === "realtime" && point === "turn_detected") continue;
    const speechEndAt = turn.timings.speech_end;
    appendTokenLine(
      timingLine(
        toWallClockMs(atMs),
        turn.mode,
        turn.seq,
        point,
        turn.vendors[point],
        speechEndAt === undefined ? null : Math.round(atMs - speechEndAt),
      ),
      turn.seq,
    );
  }
  if (!loggedEvents.has(`${turn.turnId}:result`) && isResultReady(turn.state, turn.timings)) {
    loggedEvents.add(`${turn.turnId}:result`);
    appendTokenLine(
      resultLine(Date.now(), turn.mode, turn.seq, turn.state, turn.timings, turn.reason),
      turn.seq,
      true,
    );
    if (turn.state === "failed") flashError();
  }
}

// ---- orb ---------------------------------------------------------------------------------------------------

let errorFlashTimer: ReturnType<typeof setTimeout> | undefined;
function flashError(): void {
  orb.dataset.error = "";
  clearTimeout(errorFlashTimer);
  errorFlashTimer = setTimeout(() => delete orb.dataset.error, 1400);
}

let meterAudioContext: AudioContext | null = null;
const analysers = new WeakMap<MediaStream, AnalyserNode | null>();
const meterSamples = new Float32Array(1024);

function analyserFor(stream: MediaStream | null): AnalyserNode | null {
  if (!stream || !meterAudioContext || !stream.getAudioTracks().length) return null;
  if (analysers.has(stream)) return analysers.get(stream)!;
  let analyserNode: AnalyserNode | null = meterAudioContext.createAnalyser();
  analyserNode.fftSize = meterSamples.length;
  try {
    meterAudioContext.createMediaStreamSource(stream).connect(analyserNode);
  } catch {
    analyserNode = null;
  }
  analysers.set(stream, analyserNode);
  return analyserNode;
}

let mic: MediaStream | null = null;
let level = 0;
let metering = false;
/** Feeds --level (0..1): live mic level while listening, interpreted audio level while speaking. */
function meter(): void {
  const state = orb.dataset.state;
  const analyserNode = analyserFor(state === "speaking" ? session.output() : state === "idle" ? null : mic);
  let target = 0;
  if (analyserNode) {
    analyserNode.getFloatTimeDomainData(meterSamples);
    target = rmsLevel(meterSamples);
  }
  level += (target - level) * (target > level ? 0.35 : 0.12);
  orb.style.setProperty("--level", level.toFixed(3));
  if (session.live || level > 0.01) requestAnimationFrame(meter);
  else {
    metering = false;
    orb.style.setProperty("--level", "0");
  }
}

function startMeter(): void {
  meterAudioContext ??= new AudioContext();
  void meterAudioContext.resume();
}

// ---- pipeline view -----------------------------------------------------------------------------------------

const formatMs = (value: number | null) => (value === null ? "" : `${value} ms`);
const LAYER_NAMES = { stt: "Speech-to-text", translate: "Translate", tts: "Text-to-speech" } as const;
const LAYER_STATUS_TEXT = { waiting: "waiting", active: "working", done: "done", failed: "failed" } as const;

function renderPipeline(currentTurn: Turn | undefined): void {
  const pipelineElement = byId("pipeline");
  pipelineElement.dataset.mode = session.mode;
  document.documentElement.dataset.mode = session.mode; // mode theme: voice-to-voice purple, cascade green
  if (session.mode === "cascade") {
    const layers = cascadePipelineLayers(currentTurn);
    const vendorByLayer = { stt: vendors.stt, translate: vendors.translate, tts: vendors.tts };
    const summary = currentTurn ? summarizeTimings(currentTurn.timings, "cascade") : null;
    const parts = layers.map((layer, i) => {
      const flow = i > 0 && layers[i - 1].status === "done" && layer.status === "active";
      const connectorHtml = i
        ? `<li class="connector${flow ? " flow" : ""}" aria-hidden="true"><span></span></li>`
        : "";
      return `${connectorHtml}<li class="layer" data-status="${layer.status}">
        <span class="layer-name">${LAYER_NAMES[layer.key]}</span>
        <span class="layer-vendor">${escapeHtml(vendorDisplayName(vendorByLayer[layer.key] ?? "—"))}</span>
        <span class="layer-ms">${layer.status === "done" ? formatMs(layer.ms) : "&nbsp;"}</span>
        <span class="layer-state">${layer.status === "failed" ? `failed: ${escapeHtml(layer.note ?? "")}` : LAYER_STATUS_TEXT[layer.status]}</span>
      </li>`;
    });
    pipelineElement.innerHTML = `<ol class="layers">${parts.join("")}</ol>
      <p class="pipeline-footnote small muted">${
        currentTurn
          ? `Turn ${currentTurn.seq + 1} · STT = turn detection + final transcript · playback start ${formatMs(summary!.stages[4].ms) || "—"} · first audio <strong>${formatMs(summary!.toFirstAudio) || "—"}</strong>`
          : "Each stage lights up and reports its measured time for the current turn."
      }</p>`;
    return;
  }
  const summary = currentTurn ? summarizeTimings(currentTurn.timings, "realtime") : null;
  const status = !currentTurn
    ? "waiting"
    : currentTurn.state === "failed"
      ? "failed"
      : currentTurn.state === "translating" || currentTurn.state === "speaking"
        ? "active"
        : currentTurn.state === "hearing"
          ? "waiting"
          : "done";
  const observedPointHtml = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  pipelineElement.innerHTML = `<div class="layer sealed" data-status="${status}">
      <svg class="lock" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>
      <span class="layer-name">${escapeHtml(vendors.realtime ?? "gpt-realtime")} — speech in, speech out</span>
      <span class="layer-state">internal stages are not observable</span>
      <dl class="observed-points">
        ${observedPointHtml("speech end", currentTurn?.timings.speech_end === undefined ? "—" : "≈ VAD silence 500 ms")}
        ${observedPointHtml("first audio", formatMs(summary?.toFirstAudio ?? null) || "—")}
        ${observedPointHtml("end of audio", formatMs(summary?.toAudioEnd ?? null) || "—")}
      </dl>
    </div>
    <p class="pipeline-footnote small muted">${currentTurn ? `Turn ${currentTurn.seq + 1} · ` : ""}times from speech end (approximate: VAD event minus its 500 ms silence wait)</p>`;
}

// ---- conversation ------------------------------------------------------------------------------------------

const chipHtml = (className: string, text: string) =>
  `<span class="chip ${className}">${escapeHtml(text)}</span>`;

function turnCard(turn: Turn): string {
  const chips =
    turn.state === "failed"
      ? chipHtml("bad", `not interpreted${turn.reason ? `: ${turn.reason}` : ""}`)
      : turn.state === "empty"
        ? chipHtml("muted", "nothing heard")
        : turn.state === "cut"
          ? chipHtml("warn", "cut off")
          : turn.state === "done"
            ? ""
            : chipHtml("live", turn.state);
  const targetHtml =
    turn.state === "failed" || turn.state === "empty" ? "" : escapeHtml(turn.tgtText ?? "") || "…";
  return `<li class="turn" data-state="${turn.state}">
    <div class="turn-meta"><span>Turn ${turn.seq + 1} · ${MODE_LABELS[turn.mode]}</span>${chips}</div>
    <p class="source-text"><span class="language-tag">${turn.from}</span><span>${escapeHtml(turn.srcText ?? "") || "…"}</span></p>
    ${targetHtml ? `<p class="target-text"><span class="language-tag">${turn.to}</span><span>${targetHtml}</span></p>` : ""}
    ${turn.error ? `<p class="turn-error small">${escapeHtml(turn.error)}</p>` : ""}
  </li>`;
}

// ---- render ------------------------------------------------------------------------------------------------

function render(): void {
  const turns = session.turns;
  const currentTurn = [...turns].reverse().find((turn) => turn.mode === session.mode);
  const latest = turns.at(-1);
  orb.dataset.state = orbState(session.live, latest?.mode === session.mode ? latest.state : undefined);
  if (session.live && !metering) {
    metering = true;
    requestAnimationFrame(meter);
  }

  const stick = nearBottom(turnsElement);
  turnsElement.innerHTML = turns.map(turnCard).join("");
  byId("turns-empty").hidden = turns.length > 0;
  if (stick) turnsElement.scrollTop = turnsElement.scrollHeight;

  turns.forEach(logTurn);
  byId("metrics-summary").innerHTML = metricsDashboardHtml(session.turns);
  renderPipeline(currentTurn);

  startButton.textContent = session.live ? "Stop" : "Start";
  startButton.classList.toggle("live", session.live);
  startButton.disabled = demoRunning ? !session.live : micDenied || busy;
  evaluationButton.disabled = busy;
  soakButton.disabled = busy;
  demoButton.disabled = busy;
  pairSelect.disabled = session.live;
}

async function getMic(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
    if (denied) micDenied = true;
    setStatus(
      denied
        ? "Microphone permission denied. Allow microphone access for this page in your browser settings, then reload."
        : `Could not open the microphone: ${(e as Error).message}`,
    );
    flashError();
    render();
    return null;
  }
}

startButton.addEventListener("click", async () => {
  if (session.live) {
    session.stop();
    mic?.getTracks().forEach((track) => track.stop());
    mic = null;
    return setStatus("Stopped.");
  }
  startMeter();
  mic = await getMic();
  if (!mic) return;
  setStatus("Connecting…");
  try {
    await session.start(mic);
    setStatus(
      `Listening. Speak in ${session.pair.map((language) => LANGUAGES[language].name).join(" or ")}.`,
    );
    appendLogMessage(`❯ listening · ${MODE_LABELS[session.mode]}`, "muted");
  } catch (e) {
    setStatus(`Could not start: ${(e as Error).message}`);
    appendLogMessage(`! could not start: ${(e as Error).message}`, "bad");
    flashError();
  }
});

document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) =>
  radio.addEventListener("change", async () => {
    try {
      await session.setMode(radio.value as Mode);
      if (session.live) {
        setStatus(`Switched to ${MODE_LABELS[radio.value as Mode]}.`);
        appendLogMessage(`❯ switched to ${MODE_LABELS[radio.value as Mode]}`, "muted");
      }
    } catch (e) {
      setStatus(`Could not switch mode: ${(e as Error).message}`);
      flashError();
    }
  }),
);

pairSelect.addEventListener(
  "change",
  () => (session.pair = pairSelect.value.split("-") as [LanguageCode, LanguageCode]),
);
headphones.addEventListener("change", () => session.setEchoGuard(!headphones.checked));

async function runJob(
  name: string,
  job: (progress: (message: string) => void) => Promise<unknown>,
): Promise<void> {
  busy = true;
  startMeter();
  render();
  const progress = (message: string) => {
    setStatus(message);
    appendLogMessage(`# ${message}`, "muted");
  };
  try {
    await job(progress);
  } catch (e) {
    setStatus(`${name} failed: ${(e as Error).message}`);
    appendLogMessage(`! ${name.toLowerCase()} failed: ${(e as Error).message}`, "bad");
    flashError();
  } finally {
    session.setEchoGuard(!headphones.checked); // eval/soak turn the echo guard off; restore the user's choice
    busy = false;
    render();
  }
}

// Run demo: in every build (the public site too); Stop stays usable while it plays
/** demo, eval and soak clips are English/Spanish: run them on that pair whatever is selected (review M5-T011 #1) */
function useEnglishSpanishPair(): void {
  pairSelect.value = "en-es";
  session.pair = ["en", "es"];
}

demoButton.addEventListener("click", () => {
  useEnglishSpanishPair();
  demoRunning = true;
  void runJob("Demo", (progress) => runDemo(session, progress)).finally(() => {
    demoRunning = false;
    render();
  });
});

// dev-only tools: Vite sets import.meta.env.DEV false in a build, so this branch (and evaluation-runners.ts) drops
// out of it
if (!import.meta.env.DEV) byId("devtools").remove();
else {
  byId("devtools").hidden = false;
  evaluationButton.addEventListener(
    "click",
    () => (useEnglishSpanishPair(), runJob("Eval", (progress) => runEvaluation(session, vendors, progress))),
  );
  soakButton.addEventListener("click", () => {
    useEnglishSpanishPair();
    const notices: string[] = [];
    noticeListener = (message) => notices.push(message);
    void runJob("Soak", (progress) => runSoakTest(session, vendors, progress, notices)).finally(
      () => (noticeListener = null),
    );
  });
}

const STAGE_CHIP_LABELS: Record<string, [string, string]> = {
  stt: ["STT", "speech-to-text"],
  translate: ["MT", "machine translation"],
  tts: ["TTS", "text-to-speech"],
  realtime: ["Realtime", "voice-to-voice model"],
};

fetch("/api/config")
  .then((response) => response.json() as Promise<Record<string, string>>)
  .then((config) => {
    vendors = config;
    byId("vendors").innerHTML = Object.entries(config)
      .map(([key, vendor]) => {
        const [tag, title] = STAGE_CHIP_LABELS[key] ?? [key, key];
        return `<li class="vendor-chip vendor-chip-${escapeHtml(key)}"><abbr title="${title}">${escapeHtml(tag)}</abbr>${escapeHtml(vendorDisplayName(vendor))}</li>`;
      })
      .join("");
    render();
  })
  .catch(
    () =>
      (byId("vendors").innerHTML =
        `<li class="vendor-chip loading">Vendors unavailable (is the server running?)</li>`),
  );

appendLogMessage("❯ tail -f timings   # one line per timing event and per turn result", "muted");
render();

// "System Design" footer: the crane lifts once on load and again on hover/focus (CSS does the motion)
const systemDesignLink = document.querySelector<HTMLElement>(".system-design-link");
if (systemDesignLink) {
  const liftCrane = () => {
    systemDesignLink.classList.remove("lift");
    void systemDesignLink.offsetWidth; // restart the CSS animation
    systemDesignLink.classList.add("lift");
  };
  liftCrane();
  systemDesignLink.addEventListener("mouseenter", liftCrane);
  systemDesignLink.addEventListener("focus", liftCrane);
}

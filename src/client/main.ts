// Workbench UI: orb, architecture toggle, pipeline view, metrics terminal, conversation (render only; state lives
// in Session). Every number shown comes from the turn's timing points; a mode never shows a metric it cannot see.
import type { Lang, Mode, TimingPoint } from "../shared/contracts.ts";
import { runEval } from "./eval.ts";
import {
  cascadeLayers,
  MODE_LABEL,
  modeSummary,
  orbState,
  resultReady,
  rmsLevel,
  summarizeTimings,
  summaryLines,
  termResult,
  termTiming,
  type Tone,
} from "./lib.ts";
import { Session, type Turn } from "./session.ts";
import { CascadeTransport } from "./transports/cascade.ts";
import { RealtimeTransport } from "./transports/realtime.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const startBtn = $<HTMLButtonElement>("start");
const evalBtn = $<HTMLButtonElement>("eval");
const pairSel = $<HTMLSelectElement>("pair");
const headphones = $<HTMLInputElement>("headphones");
const statusEl = $("status");
const orb = $("orb");
const logEl = $("log");
const termBody = $("term-body");
const turnsEl = $("turns");
const LOG_MAX = 500;

let vendors: Record<string, string> = {};
let micDenied = false;
let busy = false;
const setStatus = (msg: string) => (statusEl.textContent = msg);

const session = new Session(
  (mode, ev) => (mode === "realtime" ? new RealtimeTransport(ev) : new CascadeTransport(ev)),
  (notice, isError) => {
    if (notice) {
      setStatus(notice);
      log(`${isError ? "!" : "#"} ${notice}`, isError ? "bad" : "muted");
      if (isError) flashError();
    }
    render();
  },
);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---- metrics terminal --------------------------------------------------------------------------------------

const nearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 60;

function log(text: string, tone?: Tone): void {
  const stick = nearBottom(termBody);
  const line = document.createElement("div");
  line.className = `line${tone ? ` tone-${tone}` : ""}`;
  line.textContent = text;
  logEl.append(line);
  while (logEl.childElementCount > LOG_MAX) logEl.firstElementChild!.remove();
  if (stick) termBody.scrollTop = termBody.scrollHeight;
}

const logged = new Set<string>();
const wall = (t: number) => performance.timeOrigin + t;

/** Prints each timing point and each settled turn exactly once, in the order they happened. */
function logTurn(t: Turn): void {
  const points = (Object.entries(t.timings) as [TimingPoint, number][])
    .filter(([p]) => !logged.has(`${t.turnId}:${p}`))
    .sort((a, b) => a[1] - b[1]);
  for (const [p, at] of points) {
    logged.add(`${t.turnId}:${p}`);
    // voice-to-voice turn_detected is speech_end + the fixed VAD wait by construction: nothing to measure
    if (t.mode === "realtime" && p === "turn_detected") continue;
    const se = t.timings.speech_end;
    log(termTiming(wall(at), t.mode, t.seq, p, t.vendors[p], se === undefined ? null : Math.round(at - se)));
  }
  if (!logged.has(`${t.turnId}:result`) && resultReady(t.state, t.timings)) {
    logged.add(`${t.turnId}:result`);
    const r = termResult(Date.now(), t.mode, t.seq, t.state, t.timings, t.reason);
    log(r.text, r.tone);
    if (t.state === "failed") flashError();
  }
}

function renderSummary(): void {
  $("summary").textContent = [
    ...summaryLines(modeSummary(session.turns, "realtime")),
    ...summaryLines(modeSummary(session.turns, "cascade")),
    "# comparable across modes: speech_end→first_audio, speech_end→audio_end (realtime speech_end is approximate)",
    "# cascade only: per-stage timings, source WER   ·   voice-to-voice: stages not observable",
  ].join("\n");
}

// ---- orb ---------------------------------------------------------------------------------------------------

let errTimer: ReturnType<typeof setTimeout> | undefined;
function flashError(): void {
  orb.dataset.error = "";
  clearTimeout(errTimer);
  errTimer = setTimeout(() => delete orb.dataset.error, 1400);
}

let meterCtx: AudioContext | null = null;
const analysers = new WeakMap<MediaStream, AnalyserNode | null>();
const block = new Float32Array(1024);

function analyser(stream: MediaStream | null): AnalyserNode | null {
  if (!stream || !meterCtx || !stream.getAudioTracks().length) return null;
  if (analysers.has(stream)) return analysers.get(stream)!;
  let a: AnalyserNode | null = meterCtx.createAnalyser();
  a.fftSize = block.length;
  try {
    meterCtx.createMediaStreamSource(stream).connect(a);
  } catch {
    a = null;
  }
  analysers.set(stream, a);
  return a;
}

let mic: MediaStream | null = null;
let level = 0;
let metering = false;
/** Feeds --level (0..1): live mic level while listening, interpreted audio level while speaking. */
function meter(): void {
  const state = orb.dataset.state;
  const a = analyser(state === "speaking" ? session.output() : state === "idle" ? null : mic);
  let target = 0;
  if (a) {
    a.getFloatTimeDomainData(block);
    target = rmsLevel(block);
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
  meterCtx ??= new AudioContext();
  void meterCtx.resume();
}

// ---- pipeline view -----------------------------------------------------------------------------------------

const ms = (v: number | null) => (v === null ? "" : `${v} ms`);
const LAYER_NAME = { stt: "Speech-to-text", translate: "Translate", tts: "Text-to-speech" } as const;
const STATUS_TEXT = { waiting: "waiting", active: "working", done: "done", failed: "failed" } as const;

function renderPipeline(cur: Turn | undefined): void {
  const el = $("pipeline");
  el.dataset.mode = session.mode;
  if (session.mode === "cascade") {
    const layers = cascadeLayers(cur);
    const vendorOf = { stt: vendors.stt, translate: vendors.translate, tts: vendors.tts };
    const s = cur ? summarizeTimings(cur.timings, "cascade") : null;
    const parts = layers.map((l, i) => {
      const flow = i > 0 && layers[i - 1].status === "done" && l.status === "active";
      const conn = i ? `<li class="conn${flow ? " flow" : ""}" aria-hidden="true"><span></span></li>` : "";
      return `${conn}<li class="layer" data-status="${l.status}">
        <span class="layer-name">${LAYER_NAME[l.key]}</span>
        <span class="layer-vendor">${esc(vendorOf[l.key] ?? "—")}</span>
        <span class="layer-ms">${l.status === "done" ? ms(l.ms) : "&nbsp;"}</span>
        <span class="layer-state">${l.status === "failed" ? `failed: ${esc(l.note ?? "")}` : STATUS_TEXT[l.status]}</span>
      </li>`;
    });
    el.innerHTML = `<ol class="layers">${parts.join("")}</ol>
      <p class="pipe-foot small muted">${
        cur
          ? `Turn ${cur.seq + 1} · STT = turn detection + final transcript · playback start ${ms(s!.stages[4].ms) || "—"} · first audio <strong>${ms(s!.toFirstAudio) || "—"}</strong>`
          : "Each stage lights up and reports its measured time for the current turn."
      }</p>`;
    return;
  }
  const s = cur ? summarizeTimings(cur.timings, "realtime") : null;
  const status = !cur
    ? "waiting"
    : cur.state === "failed"
      ? "failed"
      : cur.state === "translating" || cur.state === "speaking"
        ? "active"
        : cur.state === "hearing"
          ? "waiting"
          : "done";
  const obs = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  el.innerHTML = `<div class="layer sealed" data-status="${status}">
      <svg class="lock" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>
      <span class="layer-name">${esc(vendors.realtime ?? "gpt-realtime")} — speech in, speech out</span>
      <span class="layer-state">internal stages are not observable</span>
      <dl class="obs">
        ${obs("speech end", cur?.timings.speech_end === undefined ? "—" : "≈ VAD silence 500 ms")}
        ${obs("first audio", ms(s?.toFirstAudio ?? null) || "—")}
        ${obs("end of audio", ms(s?.toEnd ?? null) || "—")}
      </dl>
    </div>
    <p class="pipe-foot small muted">${cur ? `Turn ${cur.seq + 1} · ` : ""}times from speech end (approximate: VAD event minus its 500 ms silence wait)</p>`;
}

// ---- conversation ------------------------------------------------------------------------------------------

const chip = (cls: string, text: string) => `<span class="chip ${cls}">${esc(text)}</span>`;

function turnCard(t: Turn): string {
  const chips =
    t.state === "failed"
      ? chip("bad", `not interpreted${t.reason ? `: ${t.reason}` : ""}`)
      : t.state === "empty"
        ? chip("muted", "nothing heard")
        : t.state === "cut"
          ? chip("warn", "cut off")
          : t.state === "done"
            ? ""
            : chip("live", t.state);
  const tgt = t.state === "failed" || t.state === "empty" ? "" : esc(t.tgtText ?? "") || "…";
  return `<li class="turn" data-state="${t.state}">
    <div class="turn-meta"><span>Turn ${t.seq + 1} · ${MODE_LABEL[t.mode]}</span>${chips}</div>
    <p class="src"><span class="lang">${t.from}</span><span>${esc(t.srcText ?? "") || "…"}</span></p>
    ${tgt ? `<p class="tgt"><span class="lang">${t.to}</span><span>${tgt}</span></p>` : ""}
    ${t.error ? `<p class="err small">${esc(t.error)}</p>` : ""}
  </li>`;
}

// ---- render ------------------------------------------------------------------------------------------------

function render(): void {
  const turns = session.turns;
  const cur = [...turns].reverse().find((t) => t.mode === session.mode);
  const latest = turns.at(-1);
  orb.dataset.state = orbState(session.live, latest?.mode === session.mode ? latest.state : undefined);
  if (session.live && !metering) {
    metering = true;
    requestAnimationFrame(meter);
  }

  const stick = nearBottom(turnsEl);
  turnsEl.innerHTML = turns.map(turnCard).join("");
  $("turns-empty").hidden = turns.length > 0;
  if (stick) turnsEl.scrollTop = turnsEl.scrollHeight;

  turns.forEach(logTurn);
  renderSummary();
  renderPipeline(cur);

  startBtn.textContent = session.live ? "Stop" : "Start";
  startBtn.classList.toggle("live", session.live);
  startBtn.disabled = micDenied || busy;
  evalBtn.disabled = busy;
  pairSel.disabled = session.live;
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

startBtn.addEventListener("click", async () => {
  if (session.live) {
    session.stop();
    mic?.getTracks().forEach((t) => t.stop());
    mic = null;
    return setStatus("Stopped.");
  }
  startMeter();
  mic = await getMic();
  if (!mic) return;
  setStatus("Connecting…");
  try {
    await session.start(mic);
    setStatus("Listening. Speak in English or Spanish.");
    log(`❯ listening · ${MODE_LABEL[session.mode]}`, "muted");
  } catch (e) {
    setStatus(`Could not start: ${(e as Error).message}`);
    log(`! could not start: ${(e as Error).message}`, "bad");
    flashError();
  }
});

document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) =>
  r.addEventListener("change", async () => {
    try {
      await session.setMode(r.value as Mode);
      if (session.live) {
        setStatus(`Switched to ${MODE_LABEL[r.value as Mode]}.`);
        log(`❯ switched to ${MODE_LABEL[r.value as Mode]}`, "muted");
      }
    } catch (e) {
      setStatus(`Could not switch mode: ${(e as Error).message}`);
      flashError();
    }
  }),
);

pairSel.addEventListener("change", () => (session.pair = pairSel.value.split("-") as [Lang, Lang]));
headphones.addEventListener("change", () => session.setEchoGuard(!headphones.checked));

evalBtn.addEventListener("click", async () => {
  busy = true;
  startMeter();
  render();
  const progress = (msg: string) => {
    setStatus(msg);
    log(`# ${msg}`, "muted");
  };
  try {
    await runEval(session, vendors, progress);
  } catch (e) {
    setStatus(`Eval failed: ${(e as Error).message}`);
    log(`! eval failed: ${(e as Error).message}`, "bad");
    flashError();
  } finally {
    busy = false;
    render();
  }
});

fetch("/api/config")
  .then((r) => r.json() as Promise<Record<string, string>>)
  .then((c) => {
    vendors = c;
    $("vendors").textContent = Object.entries(c)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
    render();
  })
  .catch(() => ($("vendors").textContent = "Vendors unavailable (is the server running?)"));

log("❯ tail -f timings   # one line per timing event and per turn result", "muted");
render();

// Workbench UI: controls, transcripts and timing (render only; state lives in Session).
import type { Lang, Mode } from "../shared/contracts.ts";
import { runEval } from "./eval.ts";
import { summarizeTimings } from "./lib.ts";
import { Session, type Turn } from "./session.ts";
import { CascadeTransport } from "./transports/cascade.ts";
import { RealtimeTransport } from "./transports/realtime.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const startBtn = $<HTMLButtonElement>("start");
const evalBtn = $<HTMLButtonElement>("eval");
const pairSel = $<HTMLSelectElement>("pair");
const headphones = $<HTMLInputElement>("headphones");
const statusEl = $("status");
const LANG: Record<Lang, string> = { en: "English", es: "Spanish" };
const BAR_SCALE_MS = 3000;

let vendors: Record<string, string> = {};
let micDenied = false;
let busy = false;
const setStatus = (msg: string) => (statusEl.textContent = msg);

const session = new Session(
  (mode, ev) => (mode === "realtime" ? new RealtimeTransport(ev) : new CascadeTransport(ev)),
  (notice) => {
    if (notice) setStatus(notice);
    render();
  },
);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function targetLine(t: Turn): string {
  if (t.state === "failed")
    return `<span class="state-failed">not interpreted (${esc(t.reason ?? "failed")})</span>`;
  if (t.state === "empty") return `<span class="state-empty">nothing heard</span>`;
  const text = esc(t.tgtText ?? "");
  return t.state === "cut" ? `${text} <span class="state-cut">(cut off)</span>` : text || "…";
}

function timingItem(t: Turn): string {
  const s = summarizeTimings(t.timings, t.mode);
  const ms = (v: number | null) => (v === null ? "—" : `${v} ms`);
  const bars = s.stages
    .map((b) => {
      const cell = !b.observable
        ? `<span class="na">not observable in this mode</span>`
        : b.ms === null
          ? `<span class="na">—</span>`
          : `<div class="bar" style="width:${Math.min(100, (b.ms / BAR_SCALE_MS) * 100)}%"></div>`;
      return `<div class="bar-row"><span>${b.name}</span>${cell}<span>${b.observable ? ms(b.ms) : ""}</span></div>`;
    })
    .join("");
  return `<li><span class="label">Turn ${t.seq + 1} · ${t.mode === "realtime" ? "voice-to-voice" : "cascade"}</span>
    To first audio: <strong>${ms(s.toFirstAudio)}</strong> · To end of audio: <strong>${ms(s.toEnd)}</strong>${bars}</li>`;
}

function render(): void {
  const turns = session.turns;
  const label = (t: Turn, l: Lang) =>
    `<span class="label">Turn ${t.seq + 1} · ${LANG[l]} · ${t.state}</span>`;
  $("src").innerHTML = turns
    .map(
      (t) =>
        `<li>${label(t, t.from)}${esc(t.srcText ?? "") || "…"}${t.error ? `<span class="err label">${esc(t.error)}</span>` : ""}</li>`,
    )
    .join("");
  $("tgt").innerHTML = turns.map((t) => `<li>${label(t, t.to)}${targetLine(t)}</li>`).join("");
  $("timing").innerHTML = turns.map(timingItem).join("");
  startBtn.textContent = session.live ? "Stop" : "Start";
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
    render();
    return null;
  }
}

let mic: MediaStream | null = null;
startBtn.addEventListener("click", async () => {
  if (session.live) {
    session.stop();
    mic?.getTracks().forEach((t) => t.stop());
    mic = null;
    return setStatus("Stopped.");
  }
  mic = await getMic();
  if (!mic) return;
  setStatus("Connecting…");
  try {
    await session.start(mic);
    setStatus("Listening. Speak in English or Spanish.");
  } catch (e) {
    setStatus(`Could not start: ${(e as Error).message}`);
  }
});

document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) =>
  r.addEventListener("change", async () => {
    try {
      await session.setMode(r.value as Mode);
      if (session.live) setStatus(`Switched to ${r.value === "realtime" ? "voice-to-voice" : "cascade"}.`);
    } catch (e) {
      setStatus(`Could not switch mode: ${(e as Error).message}`);
    }
  }),
);

pairSel.addEventListener("change", () => (session.pair = pairSel.value.split("-") as [Lang, Lang]));
headphones.addEventListener("change", () => session.setEchoGuard(!headphones.checked));

evalBtn.addEventListener("click", async () => {
  busy = true;
  render();
  try {
    await runEval(session, vendors, setStatus);
  } catch (e) {
    setStatus(`Eval failed: ${(e as Error).message}`);
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
  })
  .catch(() => ($("vendors").textContent = "Vendors unavailable (is the server running?)"));

render();

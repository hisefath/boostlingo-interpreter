// system-demo.ts — diagram, two walkthroughs and the dashboard. All load numbers come from sim.ts (simulated).
import {
  BASE,
  CASCADE_HOPS,
  COMPS,
  NAIVE,
  SCALED,
  V2V_HOPS,
  hopTotal,
  initSim,
  step,
  type CompId,
  type Hop,
  type Snapshot,
} from "./sim.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const SVG = "http://www.w3.org/2000/svg";

const NAME: Record<CompId, string> = {
  edge: "Edge / LB",
  api: "API instances",
  stt: "STT pool",
  mt: "MT (translate)",
  tts: "TTS pool",
  realtime: "Realtime (v2v)",
  limiter: "Rate limiter",
};

/* ---- diagram --------------------------------------------------------------------------------------------------- */
const NODES: { id: string; x: number; y: number; w: number; h: number; lines: string[] }[] = [
  { id: "metrics", x: 400, y: 14, w: 170, h: 56, lines: ["Metrics + tracing", "per-hop timings, logs"] },
  { id: "client", x: 14, y: 180, w: 142, h: 72, lines: ["Clients", "browsers"] },
  { id: "edge", x: 200, y: 180, w: 150, h: 72, lines: ["Edge / LB", "TLS · sticky WS"] },
  {
    id: "api",
    x: 395,
    y: 166,
    w: 180,
    h: 100,
    lines: ["Node API ×N", "autoscaled", "token · /cascade WS · turns"],
  },
  {
    id: "limiter",
    x: 620,
    y: 166,
    w: 170,
    h: 100,
    lines: ["Vendor pools", "rate limiter + retry", "budget (Redis)"],
  },
  { id: "stt", x: 830, y: 56, w: 160, h: 72, lines: ["STT pool", "Deepgram → OpenAI"] },
  { id: "mt", x: 830, y: 180, w: 160, h: 72, lines: ["MT", "OpenAI GPT-4.1-mini"] },
  { id: "tts", x: 830, y: 304, w: 160, h: 72, lines: ["TTS pool", "ElevenLabs Flash"] },
  { id: "realtime", x: 600, y: 352, w: 190, h: 72, lines: ["OpenAI Realtime", "voice-to-voice"] },
];
const WIRES: { a: string; b: string; d: string; label?: [number, number, string] }[] = [
  { a: "client", b: "edge", d: "M156 216H200", label: [178, 206, "WS"] },
  { a: "edge", b: "api", d: "M350 216H395" },
  { a: "api", b: "limiter", d: "M575 216H620" },
  { a: "limiter", b: "stt", d: "M790 196L830 92" },
  { a: "limiter", b: "mt", d: "M790 216H830" },
  { a: "limiter", b: "tts", d: "M790 236L830 340" },
  { a: "api", b: "metrics", d: "M485 166V70" },
  { a: "api", b: "realtime", d: "M520 266L640 352", label: [500, 318, "mint secret"] },
  { a: "client", b: "realtime", d: "M85 252V388H600", label: [300, 380, "WebRTC media, direct to vendor"] },
];

const diagram = $("diagram") as unknown as SVGSVGElement;
function el(tag: string, attrs: Record<string, string | number>, text?: string) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text) e.textContent = text;
  return e;
}
function buildDiagram() {
  diagram.append(
    el("title", { id: "dg-title" }, "Scaled target architecture"),
    el(
      "desc",
      { id: "dg-desc" },
      "Browsers connect through an edge load balancer to autoscaled Node API instances, which call speech-to-text, " +
        "translation and text-to-speech vendors through per-vendor pools and a shared rate limiter. Voice-to-voice " +
        "audio goes from the browser straight to OpenAI Realtime; the API only mints its client secret. " +
        "All instances report to a metrics and tracing sink.",
    ),
  );
  for (const w of WIRES) {
    diagram.append(el("path", { class: "wire", id: `w-${w.a}-${w.b}`, d: w.d }));
    if (w.label) diagram.append(el("text", { class: "wire-l", x: w.label[0], y: w.label[1] }, w.label[2]));
  }
  for (const n of NODES) {
    const g = el("g", { class: "node", id: `n-${n.id}` });
    g.append(el("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 14 }));
    n.lines.forEach((line, i) =>
      g.append(el("text", { class: i ? "ns" : "nt", x: n.x + 12, y: n.y + 24 + i * 18 }, line)),
    );
    g.append(el("text", { class: "nm", x: n.x + 12, y: n.y + n.h - 10 }));
    diagram.append(g);
  }
}
const node = (id: string) => document.getElementById(`n-${id}`)!;
const wire = (a: string, b: string) =>
  document.getElementById(`w-${a}-${b}`) ?? document.getElementById(`w-${b}-${a}`);
function clearDiagram() {
  diagram.querySelectorAll(".active,.flow").forEach((e) => e.classList.remove("active", "flow"));
  diagram.querySelectorAll<SVGElement>("[data-heat]").forEach((e) => delete e.dataset.heat);
  diagram.querySelectorAll(".nm").forEach((e) => (e.textContent = ""));
}

/* ---- walkthrough A --------------------------------------------------------------------------------------------- */
let aMode: "cascade" | "v2v" = "cascade";
let aIdx = -1;
let aTimer = 0;
const hops = (): Hop[] => (aMode === "cascade" ? CASCADE_HOPS : V2V_HOPS);

function renderA() {
  const hs = hops();
  const total = hopTotal(hs);
  const done = hs.slice(0, aIdx + 1).reduce((t, h) => t + h.ms, 0);
  const big = hs.reduce((a, b) => (b.ms > a.ms ? b : a));
  if (aIdx >= 0) {
    clearDiagram();
    const h = hs[aIdx];
    h.path.forEach((id, i) => {
      node(id).classList.add("active");
      if (i) wire(h.path[i - 1], id)?.classList.add("flow", "active");
    });
  }
  $("wa-caption").textContent =
    aIdx < 0
      ? `Press Play or Next to follow one ${aMode === "cascade" ? "cascade" : "voice-to-voice"} turn from speech end to first audio.`
      : `Step ${aIdx + 1} of ${hs.length} · ${hs[aIdx].label} · ${fmt(hs[aIdx].ms)} ms (${hs[aIdx].source}). ${hs[aIdx].caption}`;
  $("wa-bar").replaceChildren(
    ...hs.map((h, i) => {
      const s = document.createElement("span");
      s.style.flexGrow = String(Math.max(h.ms, 1));
      s.className = i < aIdx ? "done" : i === aIdx ? "now" : "";
      if (h === big) s.classList.add("big");
      return s;
    }),
  );
  $("wa-hops").replaceChildren(
    ...hs.map((h, i) => {
      const li = document.createElement("li");
      li.className = i < aIdx ? "done" : i === aIdx ? "now" : "";
      if (i === aIdx) li.setAttribute("aria-current", "step");
      li.innerHTML = `<span>${h.label}${h.source === "assumed" ? ' <i class="tag tag-sim">assumed</i>' : ""}</span><b>${fmt(h.ms)}<span class="u"> ms</span></b>`;
      return li;
    }),
  );
  $("wa-total").innerHTML =
    `First audio: <b>${fmt(done)}</b> of <b>${fmt(total)}</b> ms` +
    (aMode === "cascade"
      ? ' <span class="muted small">(sum of stage medians; measured end-to-end p50 1,395 ms)</span>'
      : ' <span class="muted small">(measured p50; p95 944 ms)</span>');
  $("wa-callout").textContent =
    aMode === "cascade"
      ? `Biggest share: ${big.label}, ${fmt(big.ms)} ms of ${fmt(total)} (${Math.round((big.ms / total) * 100)}%). At p95 it is 5,574 ms: Deepgram's multilingual end-of-speech wait, a vendor setting, not load.`
      : "One sealed hop: 818 ms is all of it. Nothing inside can be seen, timed or tuned separately.";
  $<HTMLButtonElement>("wa-next").disabled = aIdx >= hs.length - 1;
}
function stopA() {
  clearInterval(aTimer);
  aTimer = 0;
  $("wa-play").textContent = "▶ Play";
}
function nextA() {
  if (aIdx === -1) {
    pauseB();
    clearDiagram();
  }
  if (aIdx < hops().length - 1) aIdx++;
  if (aIdx >= hops().length - 1) stopA();
  renderA();
}
$("wa-next").addEventListener("click", () => {
  stopA();
  nextA();
});
$("wa-play").addEventListener("click", () => {
  if (aTimer) return stopA();
  if (aIdx >= hops().length - 1) aIdx = -1;
  $("wa-play").textContent = "❚❚ Pause";
  nextA();
  aTimer = window.setInterval(nextA, 1800);
});
$("wa-reset").addEventListener("click", () => {
  stopA();
  aIdx = -1;
  clearDiagram();
  renderA();
});
document.querySelectorAll<HTMLInputElement>('input[name="wa-mode"]').forEach((r) =>
  r.addEventListener("change", () => {
    aMode = r.value as typeof aMode;
    stopA();
    aIdx = -1;
    clearDiagram();
    renderA();
  }),
);

/* ---- walkthrough B --------------------------------------------------------------------------------------------- */
const SEED = 20261019;
const END_S = 40; // 30 s ramp + 10 s at peak
const TICK_MS = 250;
let design = SCALED;
let st = initSim(SEED);
let snap = step(st, design, 0).snap;
let bTimer = 0;

const heat = (u: number) => (u >= 0.9 ? "hot" : u >= 0.7 ? "warn" : "ok");
const pct = (u: number) => (u > 9.99 ? "999%+" : `${fmt(u * 100)}%`);

function renderB(running: boolean) {
  const s = snap;
  if (running || s.t > 0) {
    for (const id of COMPS) {
      const c = s.comps[id];
      const n = node(id);
      if (!c.present) {
        n.dataset.heat = "off";
        n.querySelector(".nm")!.textContent = "not in naive design";
        continue;
      }
      n.dataset.heat = heat(c.util);
      n.querySelector(".nm")!.textContent = `${pct(c.util)} · p95 ${fmt(c.p95)} ms`;
    }
    node("client").querySelector(".nm")!.textContent = `${fmt(s.sessions)} sessions`;
    for (const w of WIRES) {
      const on = running && !(w.a === "api" && w.b === "limiter" && !design.scaled);
      wire(w.a, w.b)?.classList.toggle("flow", on);
    }
  }
  $("wb-clock").innerHTML =
    `<b>t = ${fmt(s.t, 1)} s</b> · <b>${fmt(s.sessions)}</b> sessions · ${fmt(s.instances)} API instance${s.instances > 1 ? "s" : ""}` +
    (design.scaled && s.sttFailoverShare > 0
      ? ` · ${fmt(s.sttFailoverShare * 100)}% of STT on failover`
      : "");
  $("wb-ramp").style.width = `${Math.min(100, (s.sessions / 3000) * 100)}%`;
  const h = s.comps[s.hottest];
  const slow = s.slowest;
  $("wb-callout").innerHTML =
    (h.util < 0.05
      ? "Idle at one session. "
      : `Hottest: <b>${NAME[s.hottest]}</b> at ${pct(h.util)} utilisation. `) +
    (slow
      ? `Most simulated latency now: <b>${NAME[slow]}</b> adds +${fmt(s.comps[slow].p95 - BASE[slow][1])} ms at p95` +
        (s.comps[slow].errs > 0
          ? `, with ${fmt(s.comps[slow].errs)} rejects/s (429s and retries).`
          : " (queueing).")
      : "Load adds under 50 ms anywhere; the biggest fixed cost is still STT turn detection (610 ms p50, 5,574 ms p95, measured).");
  renderDash(s);
}
function tickB() {
  const dt = (TICK_MS / 1000) * Number($<HTMLSelectElement>("wb-speed").value);
  ({ state: st, snap } = step(st, design, dt));
  if (snap.t >= END_S) pauseB();
  renderB(!!bTimer);
}
function pauseB() {
  clearInterval(bTimer);
  bTimer = 0;
  $("wb-play").textContent = "▶ Play";
  renderB(false);
}
$("wb-play").addEventListener("click", () => {
  if (bTimer) return pauseB();
  stopA();
  aIdx = -1;
  renderA();
  clearDiagram();
  if (snap.t >= END_S) resetB();
  $("wb-play").textContent = "❚❚ Pause";
  bTimer = window.setInterval(tickB, TICK_MS);
  renderB(true);
});
function resetB() {
  clearInterval(bTimer);
  bTimer = 0;
  $("wb-play").textContent = "▶ Play";
  st = initSim(SEED);
  snap = step(st, design, 0).snap;
  clearDiagram();
  renderB(false);
}
$("wb-reset").addEventListener("click", resetB);
document.querySelectorAll<HTMLInputElement>('input[name="wb-design"]').forEach((r) =>
  r.addEventListener("change", () => {
    design = r.value === "naive" ? NAIVE : SCALED;
    if (!bTimer) resetB();
  }),
);

/* ---- dashboard ------------------------------------------------------------------------------------------------- */
function renderDash(s: Snapshot) {
  $("dash-design").textContent = `${design.scaled ? "Scaled design" : "Naive design"} · t = ${fmt(s.t, 1)} s`;
  $("dash-body").replaceChildren(
    ...COMPS.map((id) => {
      const c = s.comps[id];
      const tr = document.createElement("tr");
      tr.dataset.heat = c.present ? heat(c.util) : "off";
      const cells = c.present
        ? [fmt(c.rps, 1), fmt(c.p50), fmt(c.p95), pct(c.util), fmt(c.queue), fmt(c.errs, 1)]
        : ["—", "—", "—", "—", "—", "—"];
      tr.innerHTML =
        `<th scope="row"><i class="dot" aria-hidden="true"></i>${NAME[id]}</th>` +
        cells.map((v) => `<td class="num">${v}</td>`).join("");
      return tr;
    }),
  );
  const t: [string, string][] = [
    ["Sessions", fmt(s.sessions)],
    [
      "Cascade first audio p50 / p95",
      `${fmt(s.cascadeP50)} / ${fmt(s.cascadeP95)} <span class="u">ms</span>`,
    ],
    ["Voice-to-voice first audio p50 / p95", `${fmt(s.v2vP50)} / ${fmt(s.v2vP95)} <span class="u">ms</span>`],
    [
      "Cost estimate",
      `$${fmt(s.costPerMin, s.costPerMin < 10 ? 2 : 0)}<span class="u">/min</span> <span class="u">($0.040 cascade, ~$0.17 v2v)</span>`,
    ],
  ];
  $("dash-totals").innerHTML = t.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

buildDiagram();
renderA();
renderB(false);

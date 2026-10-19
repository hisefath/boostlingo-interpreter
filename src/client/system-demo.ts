// system-demo.ts — diagram, two walkthroughs and the dashboard. All load numbers come from load-simulation.ts
// (simulated).
import {
  BASELINE_LATENCY_MS,
  CASCADE_HOPS,
  COMPONENT_IDS,
  NAIVE_DESIGN,
  SCALED_DESIGN,
  VOICE_TO_VOICE_HOPS,
  sumHopLatencyMs,
  createSimulationState,
  stepSimulation,
  type ComponentId,
  type Hop,
  type Snapshot,
} from "./load-simulation.ts";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const formatNumber = (value: number, decimals = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const COMPONENT_NAMES: Record<ComponentId, string> = {
  edge: "Edge / LB",
  api: "API instances",
  stt: "STT pool",
  translate: "MT (translate)",
  tts: "TTS pool",
  realtime: "Realtime (v2v)",
  limiter: "Rate limiter",
};

/* ---- diagram --------------------------------------------------------------------------------------------------- */
const NODES: { id: string; x: number; y: number; width: number; height: number; lines: string[] }[] = [
  {
    id: "metrics",
    x: 400,
    y: 14,
    width: 170,
    height: 56,
    lines: ["Metrics + tracing", "per-hop timings, logs"],
  },
  { id: "client", x: 14, y: 180, width: 142, height: 72, lines: ["Clients", "browsers"] },
  { id: "edge", x: 200, y: 180, width: 150, height: 72, lines: ["Edge / LB", "TLS · sticky WS"] },
  {
    id: "api",
    x: 395,
    y: 166,
    width: 180,
    height: 100,
    lines: ["Node API ×N", "autoscaled", "token · /cascade WS · turns"],
  },
  {
    id: "limiter",
    x: 620,
    y: 166,
    width: 170,
    height: 100,
    lines: ["Vendor pools", "rate limiter + retry", "budget (Redis)"],
  },
  { id: "stt", x: 830, y: 56, width: 160, height: 72, lines: ["STT pool", "Deepgram → OpenAI"] },
  { id: "translate", x: 830, y: 180, width: 160, height: 72, lines: ["MT", "OpenAI GPT-4.1-mini"] },
  { id: "tts", x: 830, y: 304, width: 160, height: 72, lines: ["TTS pool", "ElevenLabs Flash"] },
  { id: "realtime", x: 600, y: 352, width: 190, height: 72, lines: ["OpenAI Realtime", "voice-to-voice"] },
];
const WIRES: { from: string; to: string; pathData: string; label?: [number, number, string] }[] = [
  { from: "client", to: "edge", pathData: "M156 216H200", label: [178, 206, "WS"] },
  { from: "edge", to: "api", pathData: "M350 216H395" },
  { from: "api", to: "limiter", pathData: "M575 216H620" },
  { from: "limiter", to: "stt", pathData: "M790 196L830 92" },
  { from: "limiter", to: "translate", pathData: "M790 216H830" },
  { from: "limiter", to: "tts", pathData: "M790 236L830 340" },
  { from: "api", to: "metrics", pathData: "M485 166V70" },
  { from: "api", to: "realtime", pathData: "M520 266L640 352", label: [500, 318, "mint secret"] },
  {
    from: "client",
    to: "realtime",
    pathData: "M85 252V388H600",
    label: [300, 380, "WebRTC media, direct to vendor"],
  },
];

const diagram = byId("diagram") as unknown as SVGSVGElement;
function createSvgElement(tag: string, attributes: Record<string, string | number>, text?: string) {
  const element = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text) element.textContent = text;
  return element;
}
function buildDiagram() {
  diagram.append(
    createSvgElement("title", { id: "diagram-title" }, "Scaled target architecture"),
    createSvgElement(
      "desc",
      { id: "diagram-description" },
      "Browsers connect through an edge load balancer to autoscaled Node API instances, which call speech-to-text, " +
        "translation and text-to-speech vendors through per-vendor pools and a shared rate limiter. Voice-to-voice " +
        "audio goes from the browser straight to OpenAI Realtime; the API only mints its client secret. " +
        "All instances report to a metrics and tracing sink.",
    ),
  );
  for (const wire of WIRES) {
    diagram.append(
      createSvgElement("path", { class: "wire", id: `wire-${wire.from}-${wire.to}`, d: wire.pathData }),
    );
    if (wire.label)
      diagram.append(
        createSvgElement("text", { class: "wire-label", x: wire.label[0], y: wire.label[1] }, wire.label[2]),
      );
  }
  for (const node of NODES) {
    const group = createSvgElement("g", { class: "node", id: `node-${node.id}` });
    group.append(
      createSvgElement("rect", { x: node.x, y: node.y, width: node.width, height: node.height, rx: 14 }),
    );
    node.lines.forEach((line, i) =>
      group.append(
        createSvgElement(
          "text",
          { class: i ? "node-subtitle" : "node-title", x: node.x + 12, y: node.y + 24 + i * 18 },
          line,
        ),
      ),
    );
    group.append(
      createSvgElement("text", { class: "node-metric", x: node.x + 12, y: node.y + node.height - 10 }),
    );
    diagram.append(group);
  }
}
const diagramNode = (id: string) => document.getElementById(`node-${id}`)!;
const diagramWire = (from: string, to: string) =>
  document.getElementById(`wire-${from}-${to}`) ?? document.getElementById(`wire-${to}-${from}`);
function clearDiagram() {
  diagram.querySelectorAll(".active,.flow").forEach((element) => element.classList.remove("active", "flow"));
  diagram.querySelectorAll<SVGElement>("[data-heat]").forEach((element) => delete element.dataset.heat);
  diagram.querySelectorAll(".node-metric").forEach((element) => (element.textContent = ""));
}

/* ---- walkthrough A: one user ----------------------------------------------------------------------------------- */
let oneUserMode: "cascade" | "voice-to-voice" = "cascade";
let oneUserStepIndex = -1;
let oneUserTimer = 0;
const currentHops = (): Hop[] => (oneUserMode === "cascade" ? CASCADE_HOPS : VOICE_TO_VOICE_HOPS);

function renderOneUserWalkthrough() {
  const hopList = currentHops();
  const total = sumHopLatencyMs(hopList);
  const done = hopList.slice(0, oneUserStepIndex + 1).reduce((sum, hop) => sum + hop.latencyMs, 0);
  const biggestHop = hopList.reduce((a, b) => (b.latencyMs > a.latencyMs ? b : a));
  if (oneUserStepIndex >= 0) {
    clearDiagram();
    const hop = hopList[oneUserStepIndex];
    hop.path.forEach((id, i) => {
      diagramNode(id).classList.add("active");
      if (i) diagramWire(hop.path[i - 1], id)?.classList.add("flow", "active");
    });
  }
  byId("one-user-walkthrough-caption").textContent =
    oneUserStepIndex < 0
      ? `Press Play or Next to follow one ${oneUserMode === "cascade" ? "cascade" : "voice-to-voice"} turn from speech end to first audio.`
      : `Step ${oneUserStepIndex + 1} of ${hopList.length} · ${hopList[oneUserStepIndex].label} · ${formatNumber(hopList[oneUserStepIndex].latencyMs)} ms (${hopList[oneUserStepIndex].source}). ${hopList[oneUserStepIndex].caption}`;
  byId("one-user-walkthrough-bar").replaceChildren(
    ...hopList.map((hop, i) => {
      const segment = document.createElement("span");
      segment.style.flexGrow = String(Math.max(hop.latencyMs, 1));
      segment.className = i < oneUserStepIndex ? "done" : i === oneUserStepIndex ? "now" : "";
      if (hop === biggestHop) segment.classList.add("big");
      return segment;
    }),
  );
  byId("one-user-walkthrough-hops").replaceChildren(
    ...hopList.map((hop, i) => {
      const item = document.createElement("li");
      item.className = i < oneUserStepIndex ? "done" : i === oneUserStepIndex ? "now" : "";
      if (i === oneUserStepIndex) item.setAttribute("aria-current", "step");
      item.innerHTML = `<span>${hop.label}${hop.source === "assumed" ? ' <i class="tag tag-simulated">assumed</i>' : ""}</span><b>${formatNumber(hop.latencyMs)}<span class="unit"> ms</span></b>`;
      return item;
    }),
  );
  byId("one-user-walkthrough-total").innerHTML =
    `First audio: <b>${formatNumber(done)}</b> of <b>${formatNumber(total)}</b> ms` +
    (oneUserMode === "cascade"
      ? ' <span class="muted small">(sum of stage medians; measured end-to-end p50 1,395 ms)</span>'
      : ' <span class="muted small">(measured p50; p95 944 ms)</span>');
  byId("one-user-walkthrough-callout").textContent =
    oneUserMode === "cascade"
      ? `Biggest share: ${biggestHop.label}, ${formatNumber(biggestHop.latencyMs)} ms of ${formatNumber(total)} (${Math.round((biggestHop.latencyMs / total) * 100)}%). At p95 it is 5,574 ms: Deepgram's multilingual end-of-speech wait, a vendor setting, not load.`
      : "One sealed hop: 818 ms is all of it. Nothing inside can be seen, timed or tuned separately.";
  byId<HTMLButtonElement>("one-user-walkthrough-next").disabled = oneUserStepIndex >= hopList.length - 1;
}
function stopOneUserWalkthrough() {
  clearInterval(oneUserTimer);
  oneUserTimer = 0;
  byId("one-user-walkthrough-play").textContent = "▶ Play";
}
function showNextOneUserStep() {
  if (oneUserStepIndex === -1) {
    pauseLoadWalkthrough();
    clearDiagram();
  }
  if (oneUserStepIndex < currentHops().length - 1) oneUserStepIndex++;
  if (oneUserStepIndex >= currentHops().length - 1) stopOneUserWalkthrough();
  renderOneUserWalkthrough();
}
byId("one-user-walkthrough-next").addEventListener("click", () => {
  stopOneUserWalkthrough();
  showNextOneUserStep();
});
byId("one-user-walkthrough-play").addEventListener("click", () => {
  if (oneUserTimer) return stopOneUserWalkthrough();
  if (oneUserStepIndex >= currentHops().length - 1) oneUserStepIndex = -1;
  byId("one-user-walkthrough-play").textContent = "❚❚ Pause";
  showNextOneUserStep();
  oneUserTimer = window.setInterval(showNextOneUserStep, 1800);
});
byId("one-user-walkthrough-reset").addEventListener("click", () => {
  stopOneUserWalkthrough();
  oneUserStepIndex = -1;
  clearDiagram();
  renderOneUserWalkthrough();
});
document.querySelectorAll<HTMLInputElement>('input[name="one-user-walkthrough-mode"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    oneUserMode = radio.value as typeof oneUserMode;
    stopOneUserWalkthrough();
    oneUserStepIndex = -1;
    clearDiagram();
    renderOneUserWalkthrough();
  }),
);

/* ---- walkthrough B: load --------------------------------------------------------------------------------------- */
const SIMULATION_SEED = 20261019;
const SIMULATION_END_SECONDS = 40; // 30 s ramp + 10 s at peak
const TICK_MS = 250;
let design = SCALED_DESIGN;
let simulationState = createSimulationState(SIMULATION_SEED);
let snapshot = stepSimulation(simulationState, design, 0).snapshot;
let loadTimer = 0;

const heatLevel = (utilisation: number) => (utilisation >= 0.9 ? "hot" : utilisation >= 0.7 ? "warn" : "ok");
const formatUtilisation = (utilisation: number) =>
  utilisation > 9.99 ? "999%+" : `${formatNumber(utilisation * 100)}%`;

function renderLoadWalkthrough(running: boolean) {
  const current = snapshot;
  if (running || current.elapsedSeconds > 0) {
    for (const id of COMPONENT_IDS) {
      const componentMetrics = current.components[id];
      const nodeElement = diagramNode(id);
      if (!componentMetrics.present) {
        nodeElement.dataset.heat = "off";
        nodeElement.querySelector(".node-metric")!.textContent = "not in naive design";
        continue;
      }
      nodeElement.dataset.heat = heatLevel(componentMetrics.utilisation);
      nodeElement.querySelector(".node-metric")!.textContent =
        `${formatUtilisation(componentMetrics.utilisation)} · p95 ${formatNumber(componentMetrics.p95)} ms`;
    }
    diagramNode("client").querySelector(".node-metric")!.textContent =
      `${formatNumber(current.sessions)} sessions`;
    for (const wire of WIRES) {
      const on = running && !(wire.from === "api" && wire.to === "limiter" && !design.scaled);
      diagramWire(wire.from, wire.to)?.classList.toggle("flow", on);
    }
  }
  byId("load-walkthrough-clock").innerHTML =
    `<b>t = ${formatNumber(current.elapsedSeconds, 1)} s</b> · <b>${formatNumber(current.sessions)}</b> sessions · ${formatNumber(current.instances)} API instance${current.instances > 1 ? "s" : ""}` +
    (design.scaled && current.sttFailoverShare > 0
      ? ` · ${formatNumber(current.sttFailoverShare * 100)}% of STT on failover`
      : "");
  byId("load-walkthrough-ramp").style.width = `${Math.min(100, (current.sessions / 3000) * 100)}%`;
  const hottestMetrics = current.components[current.hottest];
  const slowestComponent = current.slowest;
  byId("load-walkthrough-callout").innerHTML =
    (hottestMetrics.utilisation < 0.05
      ? "Idle at one session. "
      : `Hottest: <b>${COMPONENT_NAMES[current.hottest]}</b> at ${formatUtilisation(hottestMetrics.utilisation)} utilisation. `) +
    (slowestComponent
      ? `Most simulated latency now: <b>${COMPONENT_NAMES[slowestComponent]}</b> adds +${formatNumber(current.components[slowestComponent].p95 - BASELINE_LATENCY_MS[slowestComponent][1])} ms at p95` +
        (current.components[slowestComponent].errorsPerSecond > 0
          ? `, with ${formatNumber(current.components[slowestComponent].errorsPerSecond)} rejects/s (429s and retries).`
          : " (queueing).")
      : "Load adds under 50 ms anywhere; the biggest fixed cost is still STT turn detection (610 ms p50, 5,574 ms p95, measured).");
  renderComponentDashboard(current);
}
function tickLoadWalkthrough() {
  const stepSeconds = (TICK_MS / 1000) * Number(byId<HTMLSelectElement>("load-walkthrough-speed").value);
  ({ state: simulationState, snapshot } = stepSimulation(simulationState, design, stepSeconds));
  if (snapshot.elapsedSeconds >= SIMULATION_END_SECONDS) pauseLoadWalkthrough();
  renderLoadWalkthrough(!!loadTimer);
}
function pauseLoadWalkthrough() {
  clearInterval(loadTimer);
  loadTimer = 0;
  byId("load-walkthrough-play").textContent = "▶ Play";
  renderLoadWalkthrough(false);
}
byId("load-walkthrough-play").addEventListener("click", () => {
  if (loadTimer) return pauseLoadWalkthrough();
  stopOneUserWalkthrough();
  oneUserStepIndex = -1;
  renderOneUserWalkthrough();
  clearDiagram();
  if (snapshot.elapsedSeconds >= SIMULATION_END_SECONDS) resetLoadWalkthrough();
  byId("load-walkthrough-play").textContent = "❚❚ Pause";
  loadTimer = window.setInterval(tickLoadWalkthrough, TICK_MS);
  renderLoadWalkthrough(true);
});
function resetLoadWalkthrough() {
  clearInterval(loadTimer);
  loadTimer = 0;
  byId("load-walkthrough-play").textContent = "▶ Play";
  simulationState = createSimulationState(SIMULATION_SEED);
  snapshot = stepSimulation(simulationState, design, 0).snapshot;
  clearDiagram();
  renderLoadWalkthrough(false);
}
byId("load-walkthrough-reset").addEventListener("click", resetLoadWalkthrough);
document.querySelectorAll<HTMLInputElement>('input[name="load-walkthrough-design"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    design = radio.value === "naive" ? NAIVE_DESIGN : SCALED_DESIGN;
    if (!loadTimer) resetLoadWalkthrough();
  }),
);

/* ---- dashboard ------------------------------------------------------------------------------------------------- */
function renderComponentDashboard(current: Snapshot) {
  byId("dashboard-design").textContent =
    `${design.scaled ? "Scaled design" : "Naive design"} · t = ${formatNumber(current.elapsedSeconds, 1)} s`;
  byId("dashboard-body").replaceChildren(
    ...COMPONENT_IDS.map((id) => {
      const componentMetrics = current.components[id];
      const row = document.createElement("tr");
      row.dataset.heat = componentMetrics.present ? heatLevel(componentMetrics.utilisation) : "off";
      const cells = componentMetrics.present
        ? [
            formatNumber(componentMetrics.requestsPerSecond, 1),
            formatNumber(componentMetrics.p50),
            formatNumber(componentMetrics.p95),
            formatUtilisation(componentMetrics.utilisation),
            formatNumber(componentMetrics.queueLength),
            formatNumber(componentMetrics.errorsPerSecond, 1),
          ]
        : ["—", "—", "—", "—", "—", "—"];
      row.innerHTML =
        `<th scope="row"><i class="heat-dot" aria-hidden="true"></i>${COMPONENT_NAMES[id]}</th>` +
        cells.map((cell) => `<td class="numeric">${cell}</td>`).join("");
      return row;
    }),
  );
  const totals: [string, string][] = [
    ["Sessions", formatNumber(current.sessions)],
    [
      "Cascade first audio p50 / p95",
      `${formatNumber(current.cascadeP50)} / ${formatNumber(current.cascadeP95)} <span class="unit">ms</span>`,
    ],
    [
      "Voice-to-voice first audio p50 / p95",
      `${formatNumber(current.voiceToVoiceP50)} / ${formatNumber(current.voiceToVoiceP95)} <span class="unit">ms</span>`,
    ],
    [
      "Cost estimate",
      `$${formatNumber(current.costPerMinute, current.costPerMinute < 10 ? 2 : 0)}<span class="unit">/min</span> <span class="unit">($0.040 cascade, ~$0.17 v2v)</span>`,
    ],
  ];
  byId("dashboard-totals").innerHTML = totals
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

buildDiagram();
renderOneUserWalkthrough();
renderLoadWalkthrough(false);

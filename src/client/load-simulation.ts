// load-simulation.ts — SIMULATED capacity model behind /system-demo.html. Pure: no DOM, no clock, no network.
// Hop latencies are our MEASURED medians (eval/report.md, docs/COMPARISON.md); every load number is simulated.

export type ComponentId = "edge" | "api" | "limiter" | "stt" | "translate" | "tts" | "realtime";
export const COMPONENT_IDS: ComponentId[] = ["edge", "api", "stt", "translate", "tts", "realtime", "limiter"];

/* ---- Walkthrough A: one user, hop by hop ---------------------------------------------------------------------- */
export interface Hop {
  path: string[]; // diagram node ids, in order; consecutive pairs are the wires to light up
  label: string;
  latencyMs: number;
  source: "measured" | "assumed";
  caption: string;
}

export const CASCADE_HOPS: Hop[] = [
  {
    path: ["client", "edge", "api"],
    label: "Network + edge",
    latencyMs: 20,
    source: "assumed",
    caption:
      "Mic audio streams over the /cascade WebSocket; the edge terminates TLS and keeps the session sticky.",
  },
  {
    path: ["api", "limiter", "stt"],
    label: "Turn detection",
    latencyMs: 610,
    source: "measured",
    caption:
      "Deepgram listens for the end of speech. Measured p50 610 ms, p95 5,574 ms: the long tail lives here.",
  },
  {
    path: ["stt", "limiter", "api"],
    label: "STT final",
    latencyMs: 0,
    source: "assumed",
    caption: "The final transcript is the end-of-turn signal itself, so this hop adds no time of its own.",
  },
  {
    path: ["api", "limiter", "translate"],
    label: "Translate (first text)",
    latencyMs: 496,
    source: "measured",
    caption:
      "GPT-4.1-mini streams the translation; the rate limiter checks the tokens-per-minute budget first.",
  },
  {
    path: ["api", "limiter", "tts"],
    label: "TTS first byte",
    latencyMs: 251,
    source: "measured",
    caption: "ElevenLabs Flash returns the first audio byte, clause by clause.",
  },
  {
    path: ["api", "edge", "client"],
    label: "Playback start",
    latencyMs: 27,
    source: "measured",
    caption: "The browser buffers and starts playing the interpreted audio.",
  },
];

export const VOICE_TO_VOICE_HOPS: Hop[] = [
  {
    path: ["client", "edge", "api", "realtime"],
    label: "Session start (once)",
    latencyMs: 0,
    source: "assumed",
    caption:
      "Once per session, not per turn: the API mints a short-lived client secret, so the vendor key never reaches the browser.",
  },
  {
    path: ["client", "realtime"],
    label: "Sealed hop (WebRTC)",
    latencyMs: 818,
    source: "measured",
    caption:
      "Speech end to first audio in one sealed hop, browser straight to OpenAI Realtime. Measured p50 818 ms, p95 944 ms; inner stages are not observable.",
  },
];

export const sumHopLatencyMs = (hops: Hop[]): number => hops.reduce((total, hop) => total + hop.latencyMs, 0);

/* ---- Walkthrough B: load ------------------------------------------------------------------------------------- */
// Simulated per-key / per-instance limits. Round illustrative numbers, not vendor quotes.
export const SIMULATED_LIMITS = {
  edgeConnections: 50_000,
  sessionsPerInstance: 800, // one Node process: sockets + audio-frame CPU
  sttStreamsPerKey: 100,
  tokensPerMinutePerKey: 5_000_000,
  ttsConcurrentPerKey: 50,
  realtimeSessionsPerKey: 100,
  limiterOperationsPerSecond: 50_000,
};
const SECONDS_BETWEEN_TURNS = 6; // each session finishes a turn every ~6 s
const TOKENS_PER_TURN = 400;
const TTS_REQUEST_OPEN_MS = 1500; // a TTS request stays open while the reply streams
const VOICE_TO_VOICE_SHARE = 0.2; // routine calls go voice-to-voice
const INSTANCE_BOOT_SECONDS = 5; // autoscaler sizes for the load it saw 5 s ago (instance boot time)
export const TIMEOUT_MS = 15_000;
const RETRY_BUDGET_SHARE = 0.1; // scaled: retries may add at most 10% to a vendor's load
export const COST_PER_MINUTE = { cascade: 0.04, voiceToVoice: 0.17 };

// Baseline latencies with no load: measured where we have them, assumed for our own hops.
export const BASELINE_LATENCY_MS: Record<ComponentId, [p50: number, p95: number]> = {
  edge: [20, 45],
  api: [3, 12],
  limiter: [1, 3],
  stt: [610, 5574], // ponytail: Deepgram's tail kept even when failover serves some streams; blend if samples exist
  translate: [496, 773],
  tts: [251, 381],
  realtime: [818, 944],
};
const CASCADE_END_TO_END_P95_MS = 6348; // measured speech end → first audio p95

export interface Design {
  scaled: boolean;
  sttKeys: number;
  sttFailoverKeys: number;
  translateKeys: number;
  ttsKeys: number;
  realtimeKeys: number;
}
export const NAIVE_DESIGN: Design = {
  scaled: false,
  sttKeys: 1,
  sttFailoverKeys: 0,
  translateKeys: 1,
  ttsKeys: 1,
  realtimeKeys: 1,
};
export const SCALED_DESIGN: Design = {
  scaled: true,
  sttKeys: 20,
  sttFailoverKeys: 10,
  translateKeys: 3,
  ttsKeys: 20,
  realtimeKeys: 10,
};

export interface ComponentMetrics {
  present: boolean;
  requestsPerSecond: number;
  p50: number;
  p95: number;
  utilisation: number; // offered / capacity, 1 = full
  queueLength: number;
  errorsPerSecond: number; // 429s + rejects per second
}

export interface Snapshot {
  elapsedSeconds: number;
  sessions: number;
  instances: number;
  sttFailoverShare: number;
  components: Record<ComponentId, ComponentMetrics>;
  cascadeP50: number;
  cascadeP95: number;
  voiceToVoiceP50: number;
  voiceToVoiceP95: number;
  costPerMinute: number;
  hottest: ComponentId;
  slowest: ComponentId | null; // most load-added p95; null while load adds < 50 ms anywhere
}

export interface SimulationState {
  elapsedSeconds: number;
  randomState: number;
  pendingRetries: Record<ComponentId, number>;
}

export interface SimulationOptions {
  peakSessions: number;
  rampSeconds: number;
}
export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = { peakSessions: 3000, rampSeconds: 30 };

export function createSimulationState(seed: number): SimulationState {
  return {
    elapsedSeconds: 0,
    randomState: seed >>> 0,
    pendingRetries: { edge: 0, api: 0, limiter: 0, stt: 0, translate: 0, tts: 0, realtime: 0 },
  };
}

export function sessionsAt(
  elapsedSeconds: number,
  options: SimulationOptions = DEFAULT_SIMULATION_OPTIONS,
): number {
  return Math.round(
    1 + (options.peakSessions - 1) * Math.min(1, Math.max(0, elapsedSeconds / options.rampSeconds)),
  );
}

/**
 * Mean queueing wait of an M/M/c queue (c parallel servers), Sakasegawa approximation; c = 1 reduces to S·ρ/(1−ρ)
 * with ρ = utilisation. Capped at the timeout.
 */
export function queueingWaitMs(utilisation: number, parallelServers: number, serviceMs: number): number {
  if (utilisation >= 1) return TIMEOUT_MS;
  const waitMs =
    (serviceMs * utilisation ** (Math.sqrt(2 * (parallelServers + 1)) - 1)) /
    (parallelServers * (1 - utilisation));
  return Math.min(TIMEOUT_MS, waitMs);
}

/** Extra delay at `quantile` when a share `rejectedShare` of first attempts is rejected (429) and retried. */
export function retryDelayMs(rejectedShare: number, quantile: number, scaled: boolean): number {
  if (rejectedShare <= 1 - quantile) return 0;
  if (rejectedShare >= 0.999) return scaled ? 1400 : TIMEOUT_MS;
  const retries = Math.ceil(Math.log(1 - quantile) / Math.log(rejectedShare)) - 1;
  if (!scaled) return Math.min(TIMEOUT_MS, retries * 250); // naive: fixed 250 ms, no jitter, no cap
  let delayMs = 0; // scaled: 200·2^i backoff (jittered in practice), at most 3 retries, then shed or fail over
  for (let i = 0; i < Math.min(retries, 3); i++) delayMs += 200 * 2 ** i;
  return delayMs;
}

function mulberry32(a: number): [number, number] {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

interface ComponentLoad {
  demand: number; // in capacity units (sessions, tokens/s, open requests)
  capacity: number;
  requestsPerSecond: number;
  parallelServers: number; // parallel servers for the wait formula
  serviceMs: number; // 0 = concurrency cap only, no per-request queue
}

export function stepSimulation(
  previousState: SimulationState,
  design: Design,
  stepSeconds: number,
  options: SimulationOptions = DEFAULT_SIMULATION_OPTIONS,
): { state: SimulationState; snapshot: Snapshot } {
  const elapsedSeconds = previousState.elapsedSeconds + stepSeconds;
  const [randomValue, nextRandomState] = mulberry32(previousState.randomState);
  const jitter = 1 + (randomValue - 0.5) * 0.1;
  const sessions = sessionsAt(elapsedSeconds, options);
  const cascadeSessions = sessions * (1 - VOICE_TO_VOICE_SHARE);
  const voiceToVoiceSessions = sessions * VOICE_TO_VOICE_SHARE;
  const cascadeTurnsPerSecond = (cascadeSessions / SECONDS_BETWEEN_TURNS) * jitter;
  const voiceToVoiceTurnsPerSecond = (voiceToVoiceSessions / SECONDS_BETWEEN_TURNS) * jitter;
  const instances = design.scaled
    ? Math.max(
        2,
        Math.ceil(
          (sessionsAt(elapsedSeconds - INSTANCE_BOOT_SECONDS, options) * (1 - VOICE_TO_VOICE_SHARE)) /
            (SIMULATED_LIMITS.sessionsPerInstance * 0.6),
        ),
      )
    : 1;
  const sttCapacity = (design.sttKeys + design.sttFailoverKeys) * SIMULATED_LIMITS.sttStreamsPerKey;
  const translateCapacity = (design.translateKeys * SIMULATED_LIMITS.tokensPerMinutePerKey) / 60; // tokens per second
  const ttsCapacity = design.ttsKeys * SIMULATED_LIMITS.ttsConcurrentPerKey;

  const loads: Record<ComponentId, ComponentLoad> = {
    edge: {
      demand: sessions,
      capacity: SIMULATED_LIMITS.edgeConnections,
      requestsPerSecond: cascadeTurnsPerSecond + voiceToVoiceTurnsPerSecond,
      parallelServers: 64,
      serviceMs: 0,
    },
    api: {
      demand: cascadeSessions,
      capacity: instances * SIMULATED_LIMITS.sessionsPerInstance,
      requestsPerSecond: cascadeTurnsPerSecond,
      parallelServers: instances,
      serviceMs: BASELINE_LATENCY_MS.api[0],
    },
    limiter: {
      demand: design.scaled ? cascadeTurnsPerSecond * 2 : 0,
      capacity: SIMULATED_LIMITS.limiterOperationsPerSecond,
      requestsPerSecond: design.scaled ? cascadeTurnsPerSecond * 2 : 0,
      parallelServers: 1,
      serviceMs: 1,
    },
    stt: {
      demand: cascadeSessions,
      capacity: sttCapacity,
      requestsPerSecond: cascadeTurnsPerSecond,
      parallelServers: sttCapacity,
      serviceMs: 0,
    },
    translate: {
      demand: cascadeTurnsPerSecond * TOKENS_PER_TURN,
      capacity: translateCapacity,
      requestsPerSecond: cascadeTurnsPerSecond,
      parallelServers: Math.max(
        1,
        ((translateCapacity / TOKENS_PER_TURN) * BASELINE_LATENCY_MS.translate[0]) / 1000,
      ),
      serviceMs: BASELINE_LATENCY_MS.translate[0],
    },
    tts: {
      demand: (cascadeTurnsPerSecond * TTS_REQUEST_OPEN_MS) / 1000,
      capacity: ttsCapacity,
      requestsPerSecond: cascadeTurnsPerSecond,
      parallelServers: ttsCapacity,
      serviceMs: TTS_REQUEST_OPEN_MS,
    },
    realtime: {
      demand: voiceToVoiceSessions,
      capacity: design.realtimeKeys * SIMULATED_LIMITS.realtimeSessionsPerKey,
      requestsPerSecond: voiceToVoiceTurnsPerSecond,
      parallelServers: design.realtimeKeys * SIMULATED_LIMITS.realtimeSessionsPerKey,
      serviceMs: 0,
    },
  };

  const pendingRetries = { ...previousState.pendingRetries };
  const components = {} as Record<ComponentId, ComponentMetrics>;
  for (const id of COMPONENT_IDS) {
    const load = loads[id];
    const present = id !== "limiter" || design.scaled;
    const offered = load.demand + previousState.pendingRetries[id];
    const utilisation = offered / load.capacity;
    // share of attempts rejected (429 / 503)
    const rejectedShare = offered > load.capacity ? 1 - load.capacity / offered : 0;
    const rejected = offered - Math.min(offered, load.capacity);
    // naive: everything retries at once (storm, ponytail-capped at 4× demand); scaled: within the retry budget
    pendingRetries[id] = Math.min(rejected, load.demand * (design.scaled ? RETRY_BUDGET_SHARE : 4));
    const wait =
      load.serviceMs > 0 ? queueingWaitMs(Math.min(utilisation, 1), load.parallelServers, load.serviceMs) : 0;
    const offeredRequestsPerSecond = load.demand > 0 ? (load.requestsPerSecond * offered) / load.demand : 0;
    const p50 = Math.min(
      TIMEOUT_MS,
      BASELINE_LATENCY_MS[id][0] + wait + retryDelayMs(rejectedShare, 0.5, design.scaled),
    );
    const p95 = Math.min(
      TIMEOUT_MS,
      BASELINE_LATENCY_MS[id][1] + wait * 3 + retryDelayMs(rejectedShare, 0.95, design.scaled),
    ); // exp. tail ≈ 3× mean
    components[id] = {
      present,
      requestsPerSecond: offeredRequestsPerSecond,
      p50,
      p95,
      utilisation,
      queueLength: (offeredRequestsPerSecond * (p50 - BASELINE_LATENCY_MS[id][0])) / 1000, // Little's law on the added wait
      errorsPerSecond: offeredRequestsPerSecond * rejectedShare,
    };
  }

  const loadAddedLatencyMs = (id: ComponentId, i: 0 | 1) =>
    components[id][i ? "p95" : "p50"] - BASELINE_LATENCY_MS[id][i];
  const cascadePath: ComponentId[] = ["edge", "api", "limiter", "stt", "translate", "tts"];
  const totalLoadAddedLatencyMs = (i: 0 | 1) =>
    cascadePath.reduce((total, id) => total + loadAddedLatencyMs(id, i), 0);
  // ponytail: e2e = measured baseline + summed load-added delay (an upper bound); per-turn sampling would be tighter
  const cascadeP50 = Math.min(TIMEOUT_MS, sumHopLatencyMs(CASCADE_HOPS) + totalLoadAddedLatencyMs(0));
  const cascadeP95 = Math.min(TIMEOUT_MS, CASCADE_END_TO_END_P95_MS + totalLoadAddedLatencyMs(1));
  const presentComponents = COMPONENT_IDS.filter((id) => components[id].present);
  const hottest = presentComponents.reduce((a, b) =>
    components[b].utilisation > components[a].utilisation ? b : a,
  );
  const slowest = presentComponents.reduce((a, b) =>
    loadAddedLatencyMs(b, 1) > loadAddedLatencyMs(a, 1) ? b : a,
  );

  return {
    state: { elapsedSeconds, randomState: nextRandomState, pendingRetries },
    snapshot: {
      elapsedSeconds,
      sessions,
      instances,
      sttFailoverShare:
        Math.max(0, cascadeSessions - design.sttKeys * SIMULATED_LIMITS.sttStreamsPerKey) /
        Math.max(1, cascadeSessions),
      components,
      cascadeP50,
      cascadeP95,
      voiceToVoiceP50: components.realtime.p50,
      voiceToVoiceP95: components.realtime.p95,
      costPerMinute:
        cascadeSessions * COST_PER_MINUTE.cascade + voiceToVoiceSessions * COST_PER_MINUTE.voiceToVoice,
      hottest,
      slowest: loadAddedLatencyMs(slowest, 1) >= 50 ? slowest : null,
    },
  };
}

/** Run from 0 s to `endSeconds` in `stepSeconds` steps; returns the last snapshot. */
export function runSimulationUntil(
  design: Design,
  seed: number,
  endSeconds: number,
  stepSeconds = 0.25,
  options: SimulationOptions = DEFAULT_SIMULATION_OPTIONS,
): Snapshot {
  let state = createSimulationState(seed);
  let snapshot = stepSimulation(state, design, 0, options).snapshot;
  for (let elapsedSeconds = 0; elapsedSeconds < endSeconds - 1e-9; elapsedSeconds += stepSeconds) {
    ({ state, snapshot } = stepSimulation(state, design, stepSeconds, options));
  }
  return snapshot;
}

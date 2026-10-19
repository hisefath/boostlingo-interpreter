// sim.ts — SIMULATED capacity model behind /system-demo.html. Pure: no DOM, no clock, no network.
// Hop latencies are our MEASURED medians (eval/report.md, docs/COMPARISON.md); every load number is simulated.

export type CompId = "edge" | "api" | "limiter" | "stt" | "mt" | "tts" | "realtime";
export const COMPS: CompId[] = ["edge", "api", "stt", "mt", "tts", "realtime", "limiter"];

/* ---- Walkthrough A: one user, hop by hop ---------------------------------------------------------------------- */
export interface Hop {
  path: string[]; // diagram node ids, in order; consecutive pairs are the wires to light up
  label: string;
  ms: number;
  source: "measured" | "assumed";
  caption: string;
}

export const CASCADE_HOPS: Hop[] = [
  {
    path: ["client", "edge", "api"],
    label: "Network + edge",
    ms: 20,
    source: "assumed",
    caption:
      "Mic audio streams over the /cascade WebSocket; the edge terminates TLS and keeps the session sticky.",
  },
  {
    path: ["api", "limiter", "stt"],
    label: "Turn detection",
    ms: 610,
    source: "measured",
    caption:
      "Deepgram listens for the end of speech. Measured p50 610 ms, p95 5,574 ms: the long tail lives here.",
  },
  {
    path: ["stt", "limiter", "api"],
    label: "STT final",
    ms: 0,
    source: "assumed",
    caption: "The final transcript is the end-of-turn signal itself, so this hop adds no time of its own.",
  },
  {
    path: ["api", "limiter", "mt"],
    label: "Translate (first text)",
    ms: 496,
    source: "measured",
    caption:
      "GPT-4.1-mini streams the translation; the rate limiter checks the tokens-per-minute budget first.",
  },
  {
    path: ["api", "limiter", "tts"],
    label: "TTS first byte",
    ms: 251,
    source: "measured",
    caption: "ElevenLabs Flash returns the first audio byte, clause by clause.",
  },
  {
    path: ["api", "edge", "client"],
    label: "Playback start",
    ms: 27,
    source: "measured",
    caption: "The browser buffers and starts playing the interpreted audio.",
  },
];

export const V2V_HOPS: Hop[] = [
  {
    path: ["client", "edge", "api", "realtime"],
    label: "Session start (once)",
    ms: 0,
    source: "assumed",
    caption:
      "Once per session, not per turn: the API mints a short-lived client secret, so the vendor key never reaches the browser.",
  },
  {
    path: ["client", "realtime"],
    label: "Sealed hop (WebRTC)",
    ms: 818,
    source: "measured",
    caption:
      "Speech end to first audio in one sealed hop, browser straight to OpenAI Realtime. Measured p50 818 ms, p95 944 ms; inner stages are not observable.",
  },
];

export const hopTotal = (hops: Hop[]): number => hops.reduce((t, h) => t + h.ms, 0);

/* ---- Walkthrough B: load ------------------------------------------------------------------------------------- */
// Simulated per-key / per-instance limits. Round illustrative numbers, not vendor quotes.
export const LIMITS = {
  edgeConns: 50_000,
  sessionsPerInstance: 800, // one Node process: sockets + audio-frame CPU
  sttStreamsPerKey: 100,
  tpmPerKey: 5_000_000,
  ttsConcurrentPerKey: 50,
  realtimeSessionsPerKey: 100,
  limiterOps: 50_000,
};
const TURN_EVERY_S = 6; // each session finishes a turn every ~6 s
const TOKENS_PER_TURN = 400;
const TTS_HOLD_MS = 1500; // a TTS request stays open while the reply streams
const V2V_SHARE = 0.2; // routine calls go voice-to-voice
const BOOT_S = 5; // autoscaler sizes for the load it saw 5 s ago (instance boot time)
export const TIMEOUT_MS = 15_000;
const RETRY_BUDGET = 0.1; // scaled: retries may add at most 10% to a vendor's load
export const COST_PER_MIN = { cascade: 0.04, v2v: 0.17 };

// Baseline latencies with no load: measured where we have them, assumed for our own hops.
export const BASE: Record<CompId, [p50: number, p95: number]> = {
  edge: [20, 45],
  api: [3, 12],
  limiter: [1, 3],
  stt: [610, 5574], // ponytail: Deepgram's tail kept even when failover serves some streams; blend if samples exist
  mt: [496, 773],
  tts: [251, 381],
  realtime: [818, 944],
};
const CASCADE_E2E_P95 = 6348; // measured speech end → first audio p95

export interface Design {
  scaled: boolean;
  sttKeys: number;
  sttFailoverKeys: number;
  mtKeys: number;
  ttsKeys: number;
  realtimeKeys: number;
}
export const NAIVE: Design = {
  scaled: false,
  sttKeys: 1,
  sttFailoverKeys: 0,
  mtKeys: 1,
  ttsKeys: 1,
  realtimeKeys: 1,
};
export const SCALED: Design = {
  scaled: true,
  sttKeys: 20,
  sttFailoverKeys: 10,
  mtKeys: 3,
  ttsKeys: 20,
  realtimeKeys: 10,
};

export interface CompMetrics {
  present: boolean;
  rps: number;
  p50: number;
  p95: number;
  util: number; // offered / capacity, 1 = full
  queue: number;
  errs: number; // 429s + rejects per second
}

export interface Snapshot {
  t: number;
  sessions: number;
  instances: number;
  sttFailoverShare: number;
  comps: Record<CompId, CompMetrics>;
  cascadeP50: number;
  cascadeP95: number;
  v2vP50: number;
  v2vP95: number;
  costPerMin: number;
  hottest: CompId;
  slowest: CompId | null; // most load-added p95; null while load adds < 50 ms anywhere
}

export interface SimState {
  t: number;
  rng: number;
  retry: Record<CompId, number>;
}

export interface SimOpts {
  peak: number;
  rampS: number;
}
export const DEFAULT_OPTS: SimOpts = { peak: 3000, rampS: 30 };

export function initSim(seed: number): SimState {
  return {
    t: 0,
    rng: seed >>> 0,
    retry: { edge: 0, api: 0, limiter: 0, stt: 0, mt: 0, tts: 0, realtime: 0 },
  };
}

export function sessionsAt(t: number, o: SimOpts = DEFAULT_OPTS): number {
  return Math.round(1 + (o.peak - 1) * Math.min(1, Math.max(0, t / o.rampS)));
}

/** M/M/c mean wait, Sakasegawa approximation; c = 1 reduces to S·ρ/(1−ρ). Capped at the timeout. */
export function mmcWait(rho: number, c: number, serviceMs: number): number {
  if (rho >= 1) return TIMEOUT_MS;
  const w = (serviceMs * rho ** (Math.sqrt(2 * (c + 1)) - 1)) / (c * (1 - rho));
  return Math.min(TIMEOUT_MS, w);
}

/** Extra delay at quantile q when a fraction f of first attempts is rejected (429) and retried. */
export function retryDelay(f: number, q: number, scaled: boolean): number {
  if (f <= 1 - q) return 0;
  if (f >= 0.999) return scaled ? 1400 : TIMEOUT_MS;
  const retries = Math.ceil(Math.log(1 - q) / Math.log(f)) - 1;
  if (!scaled) return Math.min(TIMEOUT_MS, retries * 250); // naive: fixed 250 ms, no jitter, no cap
  let d = 0; // scaled: 200·2^i backoff (jittered in practice), at most 3 retries, then shed or fail over
  for (let i = 0; i < Math.min(retries, 3); i++) d += 200 * 2 ** i;
  return d;
}

function mulberry32(a: number): [number, number] {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

interface Load {
  demand: number; // in capacity units (sessions, tokens/s, open requests)
  cap: number;
  rps: number;
  c: number; // parallel servers for the wait formula
  serviceMs: number; // 0 = concurrency cap only, no per-request queue
}

export function step(
  prev: SimState,
  d: Design,
  dt: number,
  o: SimOpts = DEFAULT_OPTS,
): { state: SimState; snap: Snapshot } {
  const t = prev.t + dt;
  const [r, rng] = mulberry32(prev.rng);
  const jitter = 1 + (r - 0.5) * 0.1;
  const sessions = sessionsAt(t, o);
  const casc = sessions * (1 - V2V_SHARE);
  const v2v = sessions * V2V_SHARE;
  const turnsC = (casc / TURN_EVERY_S) * jitter;
  const turnsV = (v2v / TURN_EVERY_S) * jitter;
  const instances = d.scaled
    ? Math.max(
        2,
        Math.ceil((sessionsAt(t - BOOT_S, o) * (1 - V2V_SHARE)) / (LIMITS.sessionsPerInstance * 0.6)),
      )
    : 1;
  const sttCap = (d.sttKeys + d.sttFailoverKeys) * LIMITS.sttStreamsPerKey;
  const mtCap = (d.mtKeys * LIMITS.tpmPerKey) / 60; // tokens per second
  const ttsCap = d.ttsKeys * LIMITS.ttsConcurrentPerKey;

  const loads: Record<CompId, Load> = {
    edge: { demand: sessions, cap: LIMITS.edgeConns, rps: turnsC + turnsV, c: 64, serviceMs: 0 },
    api: {
      demand: casc,
      cap: instances * LIMITS.sessionsPerInstance,
      rps: turnsC,
      c: instances,
      serviceMs: BASE.api[0],
    },
    limiter: {
      demand: d.scaled ? turnsC * 2 : 0,
      cap: LIMITS.limiterOps,
      rps: d.scaled ? turnsC * 2 : 0,
      c: 1,
      serviceMs: 1,
    },
    stt: { demand: casc, cap: sttCap, rps: turnsC, c: sttCap, serviceMs: 0 },
    mt: {
      demand: turnsC * TOKENS_PER_TURN,
      cap: mtCap,
      rps: turnsC,
      c: Math.max(1, ((mtCap / TOKENS_PER_TURN) * BASE.mt[0]) / 1000),
      serviceMs: BASE.mt[0],
    },
    tts: {
      demand: (turnsC * TTS_HOLD_MS) / 1000,
      cap: ttsCap,
      rps: turnsC,
      c: ttsCap,
      serviceMs: TTS_HOLD_MS,
    },
    realtime: {
      demand: v2v,
      cap: d.realtimeKeys * LIMITS.realtimeSessionsPerKey,
      rps: turnsV,
      c: d.realtimeKeys * LIMITS.realtimeSessionsPerKey,
      serviceMs: 0,
    },
  };

  const retry = { ...prev.retry };
  const comps = {} as Record<CompId, CompMetrics>;
  for (const id of COMPS) {
    const L = loads[id];
    const present = id !== "limiter" || d.scaled;
    const offered = L.demand + prev.retry[id];
    const util = offered / L.cap;
    const f = offered > L.cap ? 1 - L.cap / offered : 0; // share of attempts rejected (429 / 503)
    const rejected = offered - Math.min(offered, L.cap);
    // naive: everything retries at once (storm, ponytail-capped at 4× demand); scaled: within the retry budget
    retry[id] = Math.min(rejected, L.demand * (d.scaled ? RETRY_BUDGET : 4));
    const wait = L.serviceMs > 0 ? mmcWait(Math.min(util, 1), L.c, L.serviceMs) : 0;
    const rpsOffered = L.demand > 0 ? (L.rps * offered) / L.demand : 0;
    const p50 = Math.min(TIMEOUT_MS, BASE[id][0] + wait + retryDelay(f, 0.5, d.scaled));
    const p95 = Math.min(TIMEOUT_MS, BASE[id][1] + wait * 3 + retryDelay(f, 0.95, d.scaled)); // exp. tail ≈ 3× mean
    comps[id] = {
      present,
      rps: rpsOffered,
      p50,
      p95,
      util,
      queue: (rpsOffered * (p50 - BASE[id][0])) / 1000, // Little's law on the added wait
      errs: rpsOffered * f,
    };
  }

  const added = (id: CompId, i: 0 | 1) => comps[id][i ? "p95" : "p50"] - BASE[id][i];
  const path: CompId[] = ["edge", "api", "limiter", "stt", "mt", "tts"];
  const sum = (i: 0 | 1) => path.reduce((s, id) => s + added(id, i), 0);
  // ponytail: e2e = measured baseline + summed load-added delay (an upper bound); per-turn sampling would be tighter
  const cascadeP50 = Math.min(TIMEOUT_MS, hopTotal(CASCADE_HOPS) + sum(0));
  const cascadeP95 = Math.min(TIMEOUT_MS, CASCADE_E2E_P95 + sum(1));
  const live = COMPS.filter((id) => comps[id].present);
  const hottest = live.reduce((a, b) => (comps[b].util > comps[a].util ? b : a));
  const slowest = live.reduce((a, b) => (added(b, 1) > added(a, 1) ? b : a));

  return {
    state: { t, rng, retry },
    snap: {
      t,
      sessions,
      instances,
      sttFailoverShare: Math.max(0, casc - d.sttKeys * LIMITS.sttStreamsPerKey) / Math.max(1, casc),
      comps,
      cascadeP50,
      cascadeP95,
      v2vP50: comps.realtime.p50,
      v2vP95: comps.realtime.p95,
      costPerMin: casc * COST_PER_MIN.cascade + v2v * COST_PER_MIN.v2v,
      hottest,
      slowest: added(slowest, 1) >= 50 ? slowest : null,
    },
  };
}

/** Run from t = 0 to tEnd in dt steps; returns the last snapshot. */
export function runTo(d: Design, seed: number, tEnd: number, dt = 0.25, o: SimOpts = DEFAULT_OPTS): Snapshot {
  let s = initSim(seed);
  let snap = step(s, d, 0, o).snap;
  for (let t = 0; t < tEnd - 1e-9; t += dt) {
    ({ state: s, snap } = step(s, d, dt, o));
  }
  return snap;
}

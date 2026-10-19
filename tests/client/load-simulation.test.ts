import { describe, expect, it } from "vitest";
import {
  CASCADE_HOPS,
  COMPONENT_IDS,
  NAIVE_DESIGN,
  SCALED_DESIGN,
  TIMEOUT_MS,
  VOICE_TO_VOICE_HOPS,
  sumHopLatencyMs,
  queueingWaitMs,
  retryDelayMs,
  runSimulationUntil,
} from "../../src/client/load-simulation.ts";

describe("walkthrough A (one user)", () => {
  it("totals the measured hop medians", () => {
    expect(sumHopLatencyMs(CASCADE_HOPS)).toBe(20 + 610 + 0 + 496 + 251 + 27); // STT final is the end-of-turn signal: 0 ms
    expect(sumHopLatencyMs(VOICE_TO_VOICE_HOPS)).toBe(818);
  });
  it("turn detection is the biggest cascade share", () => {
    const top = CASCADE_HOPS.reduce((a, b) => (b.latencyMs > a.latencyMs ? b : a));
    expect(top.label).toBe("Turn detection");
  });
  it("the load simulation at one session reproduces the walkthrough totals", () => {
    const snapshot = runSimulationUntil(SCALED_DESIGN, 7, 0);
    expect(snapshot.sessions).toBe(1);
    expect(snapshot.cascadeP50).toBeCloseTo(sumHopLatencyMs(CASCADE_HOPS), 0);
    expect(snapshot.voiceToVoiceP50).toBeCloseTo(sumHopLatencyMs(VOICE_TO_VOICE_HOPS), 0);
  });
});

describe("queueing math", () => {
  it("c = 1 is M/M/1: S·ρ/(1−ρ)", () => {
    expect(queueingWaitMs(0.5, 1, 100)).toBeCloseTo(100, 6);
    expect(queueingWaitMs(0.8, 1, 100)).toBeCloseTo(400, 6);
  });
  it("grows with utilisation, shrinks with servers, caps at saturation", () => {
    expect(queueingWaitMs(0.9, 4, 100)).toBeGreaterThan(queueingWaitMs(0.5, 4, 100));
    expect(queueingWaitMs(0.8, 50, 100)).toBeLessThan(5); // a 50-server pool at 80% barely queues (1 server: 400 ms)
    expect(queueingWaitMs(1, 4, 100)).toBe(TIMEOUT_MS);
  });
  it("retries add delay only when the rejected share reaches the quantile", () => {
    expect(retryDelayMs(0.04, 0.95, true)).toBe(0);
    expect(retryDelayMs(0.5, 0.95, true)).toBeGreaterThan(0);
    expect(retryDelayMs(0.5, 0.95, true)).toBeLessThanOrEqual(1400); // scaled: ≤ 3 backoffs
    expect(retryDelayMs(0.99, 0.95, false)).toBeGreaterThan(retryDelayMs(0.99, 0.95, true));
  });
});

describe("load simulation", () => {
  it("is deterministic for a seed", () => {
    expect(runSimulationUntil(SCALED_DESIGN, 42, 20)).toEqual(runSimulationUntil(SCALED_DESIGN, 42, 20));
    expect(runSimulationUntil(SCALED_DESIGN, 42, 20).components.translate.requestsPerSecond).not.toBe(
      runSimulationUntil(SCALED_DESIGN, 43, 20).components.translate.requestsPerSecond,
    );
  });
  it("at 3,000 sessions naive saturates STT and TTS and the tail explodes", () => {
    const snapshot = runSimulationUntil(NAIVE_DESIGN, 1, 40);
    expect(snapshot.sessions).toBe(3000);
    expect(snapshot.components.stt.utilisation).toBeGreaterThan(1);
    expect(snapshot.components.tts.utilisation).toBeGreaterThan(1);
    expect(snapshot.cascadeP95).toBe(TIMEOUT_MS);
  });
  it("at 3,000 sessions the scaled design stays under capacity with bounded p95", () => {
    const snapshot = runSimulationUntil(SCALED_DESIGN, 1, 40);
    for (const id of COMPONENT_IDS) expect(snapshot.components[id].utilisation, id).toBeLessThan(1);
    expect(snapshot.cascadeP95).toBeLessThan(6348 + 500);
    expect(snapshot.voiceToVoiceP95).toBeLessThan(1000);
    expect(snapshot.sttFailoverShare).toBeGreaterThan(0); // Deepgram keys full, OpenAI STT takes the overflow
  });
  it("429s appear only above limits", () => {
    const quiet = runSimulationUntil(NAIVE_DESIGN, 1, 0.5, 0.25, { peakSessions: 50, rampSeconds: 1 });
    for (const id of COMPONENT_IDS) expect(quiet.components[id].errorsPerSecond, id).toBe(0);
    const scaled = runSimulationUntil(SCALED_DESIGN, 1, 40);
    for (const id of COMPONENT_IDS) expect(scaled.components[id].errorsPerSecond, id).toBe(0);
    const naive = runSimulationUntil(NAIVE_DESIGN, 1, 40);
    expect(naive.components.stt.errorsPerSecond).toBeGreaterThan(0);
    expect(naive.components.edge.errorsPerSecond).toBe(0); // edge stays under its connection limit
  });
});

import { describe, expect, it } from "vitest";
import {
  CASCADE_HOPS,
  COMPS,
  NAIVE,
  SCALED,
  TIMEOUT_MS,
  V2V_HOPS,
  hopTotal,
  mmcWait,
  retryDelay,
  runTo,
} from "../../src/client/sim.ts";

describe("walkthrough A (one user)", () => {
  it("totals the measured hop medians", () => {
    expect(hopTotal(CASCADE_HOPS)).toBe(20 + 610 + 0 + 496 + 251 + 27); // STT final is the end-of-turn signal: 0 ms
    expect(hopTotal(V2V_HOPS)).toBe(818);
  });
  it("turn detection is the biggest cascade share", () => {
    const top = CASCADE_HOPS.reduce((a, b) => (b.ms > a.ms ? b : a));
    expect(top.label).toBe("Turn detection");
  });
  it("the load sim at one session reproduces the walkthrough totals", () => {
    const s = runTo(SCALED, 7, 0);
    expect(s.sessions).toBe(1);
    expect(s.cascadeP50).toBeCloseTo(hopTotal(CASCADE_HOPS), 0);
    expect(s.v2vP50).toBeCloseTo(hopTotal(V2V_HOPS), 0);
  });
});

describe("queueing math", () => {
  it("c = 1 is M/M/1: S·ρ/(1−ρ)", () => {
    expect(mmcWait(0.5, 1, 100)).toBeCloseTo(100, 6);
    expect(mmcWait(0.8, 1, 100)).toBeCloseTo(400, 6);
  });
  it("grows with utilisation, shrinks with servers, caps at saturation", () => {
    expect(mmcWait(0.9, 4, 100)).toBeGreaterThan(mmcWait(0.5, 4, 100));
    expect(mmcWait(0.8, 50, 100)).toBeLessThan(5); // a 50-server pool at 80% barely queues (1 server: 400 ms)
    expect(mmcWait(1, 4, 100)).toBe(TIMEOUT_MS);
  });
  it("retries add delay only when the rejected share reaches the quantile", () => {
    expect(retryDelay(0.04, 0.95, true)).toBe(0);
    expect(retryDelay(0.5, 0.95, true)).toBeGreaterThan(0);
    expect(retryDelay(0.5, 0.95, true)).toBeLessThanOrEqual(1400); // scaled: ≤ 3 backoffs
    expect(retryDelay(0.99, 0.95, false)).toBeGreaterThan(retryDelay(0.99, 0.95, true));
  });
});

describe("load sim", () => {
  it("is deterministic for a seed", () => {
    expect(runTo(SCALED, 42, 20)).toEqual(runTo(SCALED, 42, 20));
    expect(runTo(SCALED, 42, 20).comps.mt.rps).not.toBe(runTo(SCALED, 43, 20).comps.mt.rps);
  });
  it("at 3,000 sessions naive saturates STT and TTS and the tail explodes", () => {
    const s = runTo(NAIVE, 1, 40);
    expect(s.sessions).toBe(3000);
    expect(s.comps.stt.util).toBeGreaterThan(1);
    expect(s.comps.tts.util).toBeGreaterThan(1);
    expect(s.cascadeP95).toBe(TIMEOUT_MS);
  });
  it("at 3,000 sessions the scaled design stays under capacity with bounded p95", () => {
    const s = runTo(SCALED, 1, 40);
    for (const id of COMPS) expect(s.comps[id].util, id).toBeLessThan(1);
    expect(s.cascadeP95).toBeLessThan(6348 + 500);
    expect(s.v2vP95).toBeLessThan(1000);
    expect(s.sttFailoverShare).toBeGreaterThan(0); // Deepgram keys full, OpenAI STT takes the overflow
  });
  it("429s appear only above limits", () => {
    const quiet = runTo(NAIVE, 1, 0.5, 0.25, { peak: 50, rampS: 1 });
    for (const id of COMPS) expect(quiet.comps[id].errs, id).toBe(0);
    const scaled = runTo(SCALED, 1, 40);
    for (const id of COMPS) expect(scaled.comps[id].errs, id).toBe(0);
    const naive = runTo(NAIVE, 1, 40);
    expect(naive.comps.stt.errs).toBeGreaterThan(0);
    expect(naive.comps.edge.errs).toBe(0); // edge stays under its connection limit
  });
});

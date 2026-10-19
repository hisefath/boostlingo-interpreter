import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ServerMsg } from "../../src/shared/contracts.ts";
import { createAppServer } from "../../src/server/index.ts";

const evalDir = mkdtempSync(join(tmpdir(), "eval-"));
const env = {
  STT_PROVIDER: "fake",
  TRANSLATE_PROVIDER: "fake",
  TTS_PROVIDER: "fake",
  OPENAI_API_KEY: "sk-never-sent",
};
const server = createAppServer({ env, evalDir });
let base = "";

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("http routes", () => {
  it("GET /api/config names vendors and never keys", async () => {
    const res = await fetch(`http://${base}/api/config`);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      stt: "fake-stt",
      translate: "fake-mt",
      tts: "fake-tts",
      realtime: "gpt-realtime",
    });
    expect(text).not.toContain("sk-never-sent");
  });

  it("GET /api/eval-clips returns [] when no clips file, then the file", async () => {
    expect(await (await fetch(`http://${base}/api/eval-clips`)).json()).toEqual([]);
    writeFileSync(join(evalDir, "clips.json"), '[{"id":"en01"}]');
    expect(await (await fetch(`http://${base}/api/eval-clips`)).json()).toEqual([{ id: "en01" }]);
  });

  it("serves clip wavs and rejects bad ids", async () => {
    mkdirSync(join(evalDir, "clips"), { recursive: true });
    writeFileSync(join(evalDir, "clips", "en01.wav"), "RIFF");
    const ok = await fetch(`http://${base}/eval/clips/en01.wav`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("RIFF");
    expect((await fetch(`http://${base}/eval/clips/..%2Fclips.json`)).status).toBe(404);
  });

  it("POST /api/eval-results writes eval/results/<runId>.json", async () => {
    const run = { runId: "r1", startedAt: "now", vendors: {}, turns: [] };
    const json = { "content-type": "application/json" };
    const res = await fetch(`http://${base}/api/eval-results`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(run),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(readFileSync(join(evalDir, "results", "r1.json"), "utf8"))).toEqual(run);
    const bad = await fetch(`http://${base}/api/eval-results`, {
      method: "POST",
      headers: json,
      body: '{"runId":"../x"}',
    });
    expect(bad.status).toBe(400);
  });
});

describe("ws /cascade", () => {
  it("rejects a /cascade WebSocket from a foreign web page (R2)", async () => {
    const ws = new WebSocket(`ws://${base}/cascade`, { headers: { origin: "https://evil.example" } });
    const code = await new Promise<string>((r) => {
      ws.on("unexpected-response", (_req, res) => r(String(res.statusCode)));
      ws.on("open", () => r("open"));
      ws.on("error", () => r("error"));
    });
    expect(code).toBe("401");
  });

  it("refuses a non-JSON eval-results post (R2)", async () => {
    const r = await fetch(`http://${base}/api/eval-results`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ runId: "x" }),
    });
    expect(r.status).toBe(415);
  });

  it("speaks the ClientMsg/ServerMsg protocol", async () => {
    const ws = new WebSocket(`ws://${base}/cascade`);
    const msgs: ServerMsg[] = [];
    const frames: Buffer[] = [];
    ws.on("message", (data, isBinary) => {
      if (isBinary) frames.push(data as Buffer);
      else msgs.push(JSON.parse(data.toString()));
    });
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "ping", t: 5 }));
    ws.send(JSON.stringify({ type: "start", pair: ["en", "es"], context: [] }));
    ws.send(Buffer.from(new Int16Array(160).buffer));
    await new Promise((r) => setTimeout(r, 100));
    ws.send(JSON.stringify({ type: "stop" }));
    ws.close();

    const pong = msgs.find((m) => m.type === "pong");
    expect(pong).toMatchObject({ type: "pong", t: 5 });
    expect(typeof (pong as { serverT: number }).serverT).toBe("number");
    const done = msgs.find((m) => m.type === "turn" && m.state === "done");
    expect(done).toMatchObject({ type: "turn", turnId: "t1", seq: 1, mode: "cascade", from: "en", to: "es" });
    expect(msgs.some((m) => m.type === "timing" && m.point === "stt_final" && m.vendor === "fake-stt")).toBe(
      true,
    );
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].readUInt32BE(0)).toBe(1);
    expect(frames[0].length).toBeGreaterThan(4);
  });
});

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect } from "node:net";
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
  it("local mode refuses a foreign Host header (DNS rebinding)", async () => {
    const reply = await new Promise<string>((r) => {
      const sock = connect(Number(base.split(":")[1]), "127.0.0.1", () =>
        sock.write("GET /api/config HTTP/1.1\r\nHost: attacker.example\r\nConnection: close\r\n\r\n"),
      );
      let buf = "";
      sock.on("data", (d) => (buf += d));
      sock.on("close", () => r(buf));
    });
    expect(reply).toMatch(/^HTTP\/1\.1 403/);
  });

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

describe("public mode (ACCESS_CODE)", () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>wb</title>");
  const pub = createAppServer({
    env: { ...env, ACCESS_CODE: "s3cret", GIT_SHA: "abc1234", PUBLIC_ORIGIN: "https://wb.example/" },
    evalDir,
    staticDir: dist,
  });
  let pbase = "";
  beforeAll(async () => {
    await new Promise<void>((r) => pub.listen(0, "127.0.0.1", r));
    pbase = `127.0.0.1:${(pub.address() as AddressInfo).port}`;
  });
  afterAll(() => pub.close());
  const basic = (pw: string) => ({ authorization: `Basic ${Buffer.from(`any:${pw}`).toString("base64")}` });

  it("asks for the access code before anything, including the client-secret route", async () => {
    for (const [m, path] of [
      ["GET", "/"],
      ["GET", "/api/config"],
      ["POST", "/api/realtime-session"],
    ]) {
      const r = await fetch(`http://${pbase}${path}`, { method: m });
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toMatch(/^Basic/);
    }
    expect((await fetch(`http://${pbase}/`, { headers: basic("wrong") })).status).toBe(401);
  });

  it("the right code serves the app and sets an HttpOnly Secure cookie that works on its own", async () => {
    const r = await fetch(`http://${pbase}/`, { headers: basic("s3cret") });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<title>wb</title>");
    const cookie = r.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    // the cookie alone opens a protected route; a forged one does not
    const ok = await fetch(`http://${pbase}/api/config`, { headers: { cookie: cookie.split(";")[0] } });
    expect(ok.status).toBe(200);
    const forged = await fetch(`http://${pbase}/api/config`, { headers: { cookie: "wb_auth=deadbeef" } });
    expect(forged.status).toBe(401);
  });

  it("/api/version stays open for health checks and reveals only the commit id", async () => {
    const v = await fetch(`http://${pbase}/api/version`);
    expect(v.status).toBe(200);
    expect(await v.json()).toEqual({ sha: "abc1234" });
  });

  it("never serves files outside dist, even ones that exist", async () => {
    writeFileSync(join(dist, "..", `${dist.split("/").pop()}-secret.txt`), "top secret");
    for (const p of [`/..%2F${dist.split("/").pop()}-secret.txt`, "/%2e%2e/package.json", "/%E0%A4%A"]) {
      const r = await fetch(`http://${pbase}${p}`, { headers: basic("s3cret") });
      expect([400, 404]).toContain(r.status);
      expect(await r.text()).not.toContain("top secret");
    }
  });

  it("a malformed request line cannot crash the server", async () => {
    const reply = await new Promise<string>((r) => {
      const sock = connect(Number(pbase.split(":")[1]), "127.0.0.1", () =>
        sock.write("GET //: HTTP/1.1\r\nHost: x\r\n\r\n"),
      );
      let buf = "";
      sock.on("data", (d) => (buf += d));
      sock.on("close", () => r(buf));
      setTimeout(() => sock.destroy(), 500);
    });
    expect(reply).toMatch(/^HTTP\/1\.1 (400|401)/);
    expect((await fetch(`http://${pbase}/api/version`)).status).toBe(200); // still alive
  });

  it("rejects a /cascade WebSocket without the code, accepts it with the cookie", async () => {
    const tryWs = (headers: Record<string, string>) =>
      new Promise<string>((r) => {
        const ws = new WebSocket(`ws://${pbase}/cascade`, { headers });
        ws.on("unexpected-response", (_q, res) => r(String(res.statusCode)));
        ws.on("open", () => (ws.close(), r("open")));
        ws.on("error", () => r("error"));
      });
    expect(await tryWs({})).toBe("401");
    const r = await fetch(`http://${pbase}/`, { headers: basic("s3cret") });
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    expect(await tryWs({ cookie })).toBe("open");
    // public mode: only the configured site (trailing slash normalised); localhost and foreign pages are refused
    expect(await tryWs({ cookie, origin: "https://wb.example" })).toBe("open");
    expect(await tryWs({ cookie, origin: "http://localhost:5173" })).toBe("401");
    expect(await tryWs({ cookie, origin: "https://evil.example" })).toBe("401");
  });

  it("throttles repeated wrong codes with 429", async () => {
    const headers = { ...basic("nope"), "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 10; i++)
      expect((await fetch(`http://${pbase}/api/config`, { headers })).status).toBe(401);
    expect((await fetch(`http://${pbase}/api/config`, { headers })).status).toBe(429);
    const right = { ...basic("s3cret"), "x-forwarded-for": "203.0.113.9" };
    expect((await fetch(`http://${pbase}/api/config`, { headers: right })).status).toBe(429); // locked out for the window
  });

  it("refuses eval uploads in public mode", async () => {
    const r = await fetch(`http://${pbase}/api/eval-results`, {
      method: "POST",
      headers: { ...basic("s3cret"), "content-type": "application/json" },
      body: JSON.stringify({ runId: "x" }),
    });
    expect(r.status).toBe(403);
  });
});

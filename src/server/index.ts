// Node server: HTTP routes + WS /cascade (lld.md §3–§4). Never logs keys or transcripts.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMsg, Lang, ServerMsg, TurnText } from "../shared/contracts.ts";
import { createPipeline, type Pipeline } from "./pipeline.ts";
import { createProviders, type Env } from "./providers/registry.ts";
import { interpreterInstructions } from "./providers/http.ts";

const LIMITS = { translateMs: 4000, ttsMs: 5000 }; // lld.md §2
const MAX_BODY = 50 * 1024 * 1024; // eval runs carry base64 WAVs
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const LANGS: Lang[] = ["en", "es"];

export interface AppOptions {
  env?: Env;
  /** folder holding clips.json, clips/ and results/ */
  evalDir?: string;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BODY) throw new Error("body too large");
    parts.push(c);
  }
  return Buffer.concat(parts).toString("utf8");
}

const isPair = (p: unknown): p is [Lang, Lang] =>
  Array.isArray(p) && p.length === 2 && p.every((l) => LANGS.includes(l)) && p[0] !== p[1];
// Client-supplied context goes into model instructions: keep only well-formed, short items.
const clip = (v: unknown) => (typeof v === "string" ? v.slice(0, 500) : "");
const asContext = (c: unknown): TurnText[] =>
  (Array.isArray(c) ? c.slice(-5) : [])
    .filter((t): t is TurnText => !!t && LANGS.includes(t.from) && LANGS.includes(t.to))
    .map((t) => ({ from: t.from, to: t.to, srcText: clip(t.srcText), tgtText: clip(t.tgtText) }));

async function realtimeSession(env: Env, body: { pair?: unknown; context?: unknown }) {
  const pair = isPair(body.pair) ? body.pair : (["en", "es"] as [Lang, Lang]);
  const ctx = asContext(body.context);
  let instructions = interpreterInstructions(pair[0], pair[1]);
  if (ctx.length) {
    instructions +=
      "\n\nRecent conversation, for context only (do not repeat it):\n" +
      ctx.map((t) => `${t.from}: ${t.srcText} -> ${t.to}: ${t.tgtText}`).join("\n");
  }
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: env.OPENAI_REALTIME_MODEL || "gpt-realtime",
        instructions,
        audio: {
          input: {
            transcription: { model: env.OPENAI_STT_MODEL || "gpt-4o-transcribe" },
            turn_detection: { type: "server_vad", silence_duration_ms: 500 },
          },
        },
      },
    }),
  });
  if (!res.ok) return { status: 502, body: { error: `client secret mint failed (HTTP ${res.status})` } };
  const j = (await res.json()) as { value: string; expires_at: number };
  return { status: 200, body: { value: j.value, expiresAt: j.expires_at } };
}

export function createAppServer(opts: AppOptions = {}): Server {
  const env = opts.env ?? process.env;
  const evalDir = resolve(opts.evalDir ?? "eval");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/api/config") {
        const p = createProviders(env);
        return send(res, 200, {
          stt: p.stt.name,
          translate: p.translator.name,
          tts: p.tts.name,
          realtime: env.OPENAI_REALTIME_MODEL || "gpt-realtime",
        });
      }
      if (req.method === "POST" && url.pathname === "/api/realtime-session") {
        const r = await realtimeSession(env, JSON.parse((await readBody(req)) || "{}"));
        return send(res, r.status, r.body);
      }
      if (req.method === "GET" && url.pathname === "/api/eval-clips") {
        try {
          return send(res, 200, JSON.parse(await readFile(join(evalDir, "clips.json"), "utf8")));
        } catch {
          return send(res, 200, []);
        }
      }
      const clip = url.pathname.match(/^\/eval\/clips\/([^/]+)\.wav$/);
      if (req.method === "GET" && clip) {
        const id = decodeURIComponent(clip[1]);
        if (!SAFE_ID.test(id)) return send(res, 404, { error: "not found" });
        try {
          const wav = await readFile(join(evalDir, "clips", `${id}.wav`));
          res.writeHead(200, { "content-type": "audio/wav" });
          return res.end(wav);
        } catch {
          return send(res, 404, { error: "not found" });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/eval-results") {
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          return send(res, 415, { error: "json only" });
        const run = JSON.parse(await readBody(req)) as { runId?: unknown };
        if (typeof run.runId !== "string" || !SAFE_ID.test(run.runId))
          return send(res, 400, { error: "bad runId" });
        await mkdir(join(evalDir, "results"), { recursive: true });
        await writeFile(join(evalDir, "results", `${run.runId}.json`), JSON.stringify(run, null, 2));
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, e instanceof SyntaxError ? 400 : 500, {
        error: e instanceof SyntaxError ? "bad json" : "server error",
      });
    }
  });

  // Browsers don't apply same-origin rules to WebSockets: accept only our own localhost pages.
  const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const wss = new WebSocketServer({
    server,
    path: "/cascade",
    maxPayload: 1024 * 1024,
    verifyClient: ({ origin }: { origin?: string }) => !origin || LOCAL_ORIGIN.test(origin),
  });
  wss.on("connection", (ws: WebSocket) => {
    let pipeline: Pipeline | null = null;
    const out = (m: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
    };
    const stop = () => {
      pipeline?.stop();
      pipeline = null;
    };

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        // Copy into an aligned buffer: Buffer slices may start at an odd offset.
        const pcm = new Int16Array(Math.floor(buf.length / 2));
        new Uint8Array(pcm.buffer).set(buf.subarray(0, pcm.length * 2));
        pipeline?.pushAudio(pcm);
        return;
      }
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return out({ type: "error", stage: "session", kind: "failed", message: "bad json" });
      }
      if (msg.type === "ping") return out({ type: "pong", t: msg.t, serverT: Date.now() });
      if (msg.type === "stop") return stop();
      if (msg.type === "start") {
        stop();
        if (!isPair(msg.pair))
          return out({ type: "error", stage: "session", kind: "failed", message: "bad pair" });
        const p = createProviders(env);
        pipeline = createPipeline({
          ...p,
          pair: msg.pair,
          limits: LIMITS,
          context: asContext(msg.context),
          events: {
            turn: (u) => out({ type: "turn", ...u }),
            timing: (turnId, point, serverT, vendor) =>
              out({ type: "timing", turnId, point, serverT, vendor }),
            audio: (seq, chunk) => {
              if (ws.readyState !== ws.OPEN) return;
              const frame = Buffer.alloc(4 + chunk.length);
              frame.writeUInt32BE(seq, 0);
              frame.set(chunk, 4);
              ws.send(frame);
            },
            error: (e) => out({ type: "error", stage: e.stage, kind: e.kind, message: e.message }),
          },
        });
      }
    });
    ws.on("close", stop);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787;
  // localhost only (hld.md §2): never expose the key-backed routes to the LAN
  createAppServer().listen(port, "127.0.0.1", () => console.log(`server listening on 127.0.0.1:${port}`));
}

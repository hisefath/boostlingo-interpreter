// Node server: HTTP routes + WS /cascade (lld.md §3–§4). Never logs keys or transcripts.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, LanguageCode, ServerMessage, TurnText } from "../shared/contracts.ts";
import { createPipeline, type Pipeline } from "./pipeline.ts";
import { createProviders, type Env } from "./providers/registry.ts";
import { interpreterInstructions, sttPrompt } from "./providers/vendor-adapter-helpers.ts";
import { isOnboardedPair, LANGUAGE_CODES } from "../shared/languages.ts";

const STAGE_IDLE_TIMEOUTS = { translateMs: 4000, ttsMs: 5000 }; // lld.md §2
const MAX_BODY_BYTES = 64 * 1024; // control routes
const MAX_EVALUATION_BODY_BYTES = 300 * 1024 * 1024; // eval runs carry base64 WAVs of every interpreted turn (localhost only)
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export interface AppOptions {
  env?: Env;
  /** folder holding clips.json, clips/ and results/ */
  evaluationDir?: string;
  /** built browser app to serve (default dist/) */
  staticDir?: string;
}

// ---- Public mode (Railway): an access code gates every route so a public URL can't spend the vendor keys ----
const AUTH_COOKIE = "wb_auth";
const sha256 = (value: string) => createHash("sha256").update(value).digest();
const constantTimeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const cookieTokenFor = (code: string) => sha256(`workbench:${code}`).toString("hex");

/** true when the request carries the access code (Basic auth password) or the cookie it earns. */
export function authorized(
  req: IncomingMessage,
  code: string | undefined,
): "open" | "cookie" | "basic" | false {
  if (!code) return "open";
  const cookieHeader = String(req.headers.cookie ?? "");
  const authCookie = cookieHeader.split(/;\s*/).find((cookie) => cookie.startsWith(`${AUTH_COOKIE}=`));
  if (
    authCookie &&
    constantTimeEqual(sha256(authCookie.slice(AUTH_COOKIE.length + 1)), sha256(cookieTokenFor(code)))
  )
    return "cookie";
  const authorizationHeader = String(req.headers.authorization ?? "");
  if (authorizationHeader.startsWith("Basic ")) {
    const password = Buffer.from(authorizationHeader.slice(6), "base64")
      .toString("utf8")
      .split(":")
      .slice(1)
      .join(":");
    if (constantTimeEqual(sha256(password), sha256(code))) return "basic";
  }
  return false;
}

// Wrong-code throttle: per client address, 10 failures per minute → 429 (makes online guessing impractical).
const FAILED_ATTEMPTS = new Map<string, { count: number; until: number }>();
const MAX_FAILED_ATTEMPTS = 10;
const FAILED_ATTEMPT_WINDOW_MS = 60_000;
const clientAddress = (req: IncomingMessage) =>
  String(req.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim() ||
  req.socket.remoteAddress ||
  "?";
function isThrottled(address: string, now: number): boolean {
  const attempts = FAILED_ATTEMPTS.get(address);
  return !!attempts && attempts.until > now && attempts.count >= MAX_FAILED_ATTEMPTS;
}
function recordFailedAttempt(address: string, now: number): void {
  const attempts = FAILED_ATTEMPTS.get(address);
  if (!attempts || attempts.until <= now)
    FAILED_ATTEMPTS.set(address, { count: 1, until: now + FAILED_ATTEMPT_WINDOW_MS });
  else attempts.count++;
  if (FAILED_ATTEMPTS.size > 10_000) FAILED_ATTEMPTS.clear(); // ponytail: bounded memory; a shared limiter (Redis) if scaled out
}
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
};

const safeDecode = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return "\0"; // never a real file
  }
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("body too large");
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

// Client-supplied context goes into model instructions: keep only well-formed, short items.
const truncateText = (value: unknown) => (typeof value === "string" ? value.slice(0, 500) : "");
const sanitizeContext = (context: unknown): TurnText[] =>
  (Array.isArray(context) ? context.slice(-5) : [])
    .filter(
      (turn): turn is TurnText =>
        !!turn && LANGUAGE_CODES.includes(turn.from) && LANGUAGE_CODES.includes(turn.to),
    )
    .map((turn) => ({
      from: turn.from,
      to: turn.to,
      srcText: truncateText(turn.srcText),
      tgtText: truncateText(turn.tgtText),
    }));

async function createVoiceToVoiceClientSecret(env: Env, body: { pair?: unknown; context?: unknown }) {
  const pair = isOnboardedPair(body.pair) ? body.pair : (["en", "es"] as [LanguageCode, LanguageCode]);
  const context = sanitizeContext(body.context);
  let instructions = interpreterInstructions(pair[0], pair[1]);
  if (context.length) {
    instructions +=
      "\n\nRecent conversation, for context only (do not repeat it):\n" +
      context.map((turn) => `${turn.from}: ${turn.srcText} -> ${turn.to}: ${turn.tgtText}`).join("\n");
  }
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
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
            transcription: { model: env.OPENAI_STT_MODEL || "gpt-4o-transcribe", prompt: sttPrompt(pair) },
            turn_detection: { type: "server_vad", silence_duration_ms: 500 },
          },
        },
      },
    }),
  });
  if (!response.ok)
    return { status: 502, body: { error: `client secret mint failed (HTTP ${response.status})` } };
  const secret = (await response.json()) as { value: string; expires_at: number };
  return { status: 200, body: { value: secret.value, expiresAt: secret.expires_at } };
}

export function createAppServer(options: AppOptions = {}): Server {
  const env = options.env ?? process.env;
  const evaluationDir = resolve(options.evaluationDir ?? "eval");
  const staticDir = resolve(options.staticDir ?? "dist");
  const code = env.ACCESS_CODE || undefined;

  const server = createServer(async (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return send(res, 400, { error: "bad request" }); // e.g. "//:" — never let a parse error crash the server
    }
    // local mode: refuse foreign Host headers (DNS rebinding against the unauthenticated localhost server)
    if (!code && !LOCAL_HOST_PATTERN.test(String(req.headers.host ?? "")))
      return send(res, 403, { error: "forbidden" });
    if (req.method === "GET" && url.pathname === "/api/version") {
      // open on purpose (health check + deploy verification); reveals only the commit id
      return send(res, 200, { sha: env.RAILWAY_GIT_COMMIT_SHA || env.GIT_SHA || "dev" });
    }
    const address = clientAddress(req);
    if (code && isThrottled(address, Date.now()))
      return send(res, 429, { error: "too many attempts, wait a minute" });
    const auth = authorized(req, code);
    if (!auth) {
      if (req.headers.authorization) recordFailedAttempt(address, Date.now());
      res.writeHead(401, { "www-authenticate": 'Basic realm="Interpreter Workbench", charset="UTF-8"' });
      return res.end("access code required");
    }
    if (auth === "basic" && code) {
      res.setHeader(
        "set-cookie",
        `${AUTH_COOKIE}=${cookieTokenFor(code)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`,
      );
    }
    try {
      if (req.method === "GET" && url.pathname === "/api/config") {
        const providers = createProviders(env);
        return send(res, 200, {
          stt: providers.stt.name,
          translate: providers.translator.name,
          tts: providers.tts.name,
          realtime: env.OPENAI_REALTIME_MODEL || "gpt-realtime",
        });
      }
      if (req.method === "POST" && url.pathname === "/api/realtime-session") {
        const result = await createVoiceToVoiceClientSecret(env, JSON.parse((await readBody(req)) || "{}"));
        return send(res, result.status, result.body);
      }
      if (req.method === "GET" && url.pathname === "/api/eval-clips") {
        try {
          return send(res, 200, JSON.parse(await readFile(join(evaluationDir, "clips.json"), "utf8")));
        } catch {
          return send(res, 200, []);
        }
      }
      const clipPathMatch = url.pathname.match(/^\/eval\/clips\/([^/]+)\.wav$/);
      if (req.method === "GET" && clipPathMatch) {
        let id: string;
        try {
          id = decodeURIComponent(clipPathMatch[1]);
        } catch {
          return send(res, 400, { error: "bad path" });
        }
        if (!SAFE_ID_PATTERN.test(id)) return send(res, 404, { error: "not found" });
        try {
          const wav = await readFile(join(evaluationDir, "clips", `${id}.wav`));
          res.writeHead(200, { "content-type": "audio/wav" });
          return res.end(wav);
        } catch {
          return send(res, 404, { error: "not found" });
        }
      }
      if (req.method === "POST" && url.pathname === "/api/eval-results") {
        // public mode: no 300 MB uploads onto a shared host; run evaluations locally
        if (code) return send(res, 403, { error: "eval uploads are disabled on the public deployment" });
        if (!String(req.headers["content-type"]).startsWith("application/json"))
          return send(res, 415, { error: "json only" });
        const run = JSON.parse(await readBody(req, MAX_EVALUATION_BODY_BYTES)) as { runId?: unknown };
        if (typeof run.runId !== "string" || !SAFE_ID_PATTERN.test(run.runId))
          return send(res, 400, { error: "bad runId" });
        await mkdir(join(evaluationDir, "results"), { recursive: true });
        await writeFile(join(evaluationDir, "results", `${run.runId}.json`), JSON.stringify(run, null, 2));
        return send(res, 200, { ok: true });
      }
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        // built browser app (npm run build → dist/); Vite serves it in development
        const relativePath =
          url.pathname === "/" ? "index.html" : safeDecode(url.pathname).replace(/^\/+/, "");
        const file = resolve(staticDir, relativePath);
        if (file.startsWith(staticDir + "/")) {
          try {
            const body = await readFile(file);
            const extension = file.slice(file.lastIndexOf("."));
            res.writeHead(200, { "content-type": STATIC_TYPES[extension] ?? "application/octet-stream" });
            return res.end(body);
          } catch {
            /* fall through to 404 */
          }
        }
      }
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, e instanceof SyntaxError ? 400 : 500, {
        error: e instanceof SyntaxError ? "bad json" : "server error",
      });
    }
  });

  // Browsers don't apply same-origin rules to WebSockets: accept only our own localhost pages.
  const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  // public mode accepts only its own site; local mode only localhost pages (review M5 F3/AUTH-3)
  const PUBLIC_ORIGIN = (env.PUBLIC_ORIGIN || "").replace(/\/+$/, "") || undefined; // e.g. https://<app>.up.railway.app
  const isAllowedOrigin = (origin?: string) =>
    !origin || (code ? origin === PUBLIC_ORIGIN : LOCAL_ORIGIN_PATTERN.test(origin));
  const webSocketServer = new WebSocketServer({
    server,
    path: "/cascade",
    maxPayload: 1024 * 1024,
    verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) =>
      isAllowedOrigin(origin) && authorized(req, code) !== false,
  });
  webSocketServer.on("connection", (socket: WebSocket) => {
    let pipeline: Pipeline | null = null;
    const sendMessage = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const stop = () => {
      pipeline?.stop();
      pipeline = null;
    };

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        const bytes = data as Buffer;
        // Copy into an aligned buffer: Buffer slices may start at an odd offset.
        const pcm = new Int16Array(Math.floor(bytes.length / 2));
        new Uint8Array(pcm.buffer).set(bytes.subarray(0, pcm.length * 2));
        pipeline?.pushAudio(pcm);
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return sendMessage({ type: "error", stage: "session", kind: "failed", message: "bad json" });
      }
      if (message.type === "ping") return sendMessage({ type: "pong", t: message.t, serverT: Date.now() });
      if (message.type === "stop") return stop();
      if (message.type === "start") {
        stop();
        if (!isOnboardedPair(message.pair))
          return sendMessage({ type: "error", stage: "session", kind: "failed", message: "bad pair" });
        const providers = createProviders(env, message.pair);
        pipeline = createPipeline({
          ...providers,
          pair: message.pair,
          limits: STAGE_IDLE_TIMEOUTS,
          context: sanitizeContext(message.context),
          events: {
            turn: (update) => sendMessage({ type: "turn", ...update }),
            timing: (turnId, point, serverT, vendor) =>
              sendMessage({ type: "timing", turnId, point, serverT, vendor }),
            audio: (seq, chunk) => {
              if (socket.readyState !== socket.OPEN) return;
              const frame = Buffer.alloc(4 + chunk.length);
              frame.writeUInt32BE(seq, 0);
              frame.set(chunk, 4);
              socket.send(frame);
            },
            error: (error) =>
              sendMessage({ type: "error", stage: error.stage, kind: error.kind, message: error.message }),
          },
        });
      }
    });
    socket.on("close", stop);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 8787;
  // localhost only by default (hld.md §2); HOST=0.0.0.0 only on a host that also sets ACCESS_CODE
  const host = process.env.HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && (process.env.ACCESS_CODE ?? "").length < 12)
    throw new Error("refusing to listen publicly without an ACCESS_CODE of at least 12 characters");
  createAppServer().listen(port, host, () => console.log(`server listening on ${host}:${port}`));
}

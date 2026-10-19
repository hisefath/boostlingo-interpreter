# AI Interpreter Workbench

Live English ↔ Spanish interpretation two ways, side by side, with honest timing:

- **Voice-to-voice mode**: OpenAI Realtime API (`gpt-realtime`), browser-direct over WebRTC.
- **Cascade mode**: streaming speech-to-text → translation → text-to-speech through our Node server, with a swappable
  vendor per stage (Deepgram or OpenAI → OpenAI → ElevenLabs or OpenAI).

The comparison and recommendation are in [docs/COMPARISON.md](docs/COMPARISON.md).

## Run it locally

You need **Node 22 or newer** (`node -v`), Chrome or Edge, a microphone, and headphones (without them the interpreter's
voice can leak back into the mic).

1. **Install**
   ```bash
   git clone https://github.com/hisefath/boostlingo-interpreter.git
   cd boostlingo-interpreter
   npm install
   cp .env.example .env
   ```
2. **Add keys to `.env`** (never commit it; it is git-ignored)

   | Variable | Required? | Where to get it |
   |---|---|---|
   | `OPENAI_API_KEY` | yes (voice-to-voice + translation) | https://platform.openai.com/api-keys — the account needs billing credit |
   | `DEEPGRAM_API_KEY` | optional (cascade speech-to-text) | https://console.deepgram.com → API Keys |
   | `ELEVENLABS_API_KEY` | optional (cascade text-to-speech) | https://elevenlabs.io/app/settings/api-keys — give it Text to Speech access |

   Leave an optional key blank and set that stage to OpenAI instead (`STT_PROVIDER=openai` or `TTS_PROVIDER=openai`).
   Every other line in `.env.example` already has a working default.
3. **Start**
   ```bash
   npm run dev
   ```
   This starts the API server on `127.0.0.1:8787` and the app on http://localhost:5173. Open the app, allow the
   microphone, tick **I'm wearing headphones**, pick a mode (Voice-to-voice or Cascade) and press **Start**. You can
   switch modes mid-conversation.
4. **Check**
   ```bash
   make check   # formatting + types + all tests (fakes only: no network, no keys)
   ```

Local mode has no password: the server only listens on localhost and refuses other hosts and origins.

**Troubleshooting**
- *"Vendors unavailable"*: the API server isn't running or crashed; check the terminal running `npm run dev`.
- *Port in use*: something else holds 5173 or 8787; stop it, or change `PORT` in `.env` and the proxy target in
  `vite.config.ts`.
- *429 / "no credits"* in a turn: the vendor account is rate-limited or out of credit.
- *Microphone blocked*: allow it for `localhost` in the browser's site settings, then reload.

## What you can do in the app

- **Language pairs:** English ↔ Spanish, French, Portuguese (Brazil), Mandarin or Bangla (Bengali). Switch before or
  during a session. Each pair routes every cascade stage to a vendor that supports it: Mandarin and Bangla use OpenAI
  speech recognition (Deepgram's multilingual model covers neither), and Bangla speaks through ElevenLabs
  `eleven_v4_turbo` (Flash and OpenAI TTS don't support Bengali). The interpreter uses the formal register a clinic
  would (usted, vous, 您, আপনি).
- **Modes:** Voice-to-voice (OpenAI Realtime) or Cascade (STT → translate → TTS); switch mid-conversation.
- **▶ Run demo:** plays a scripted 8-turn English/Spanish clinic scheduling call through the active mode, with the
  original voices audible, so a screen recording captures the whole flow. Works locally and on the deployed site.
- **Metrics:** a live dashboard (avg / p50 / p90 / p95 / n per mode; "n/a" where a mode cannot observe a stage) above
  a syntax-highlighted log of every timing event.
- **Architecture** (`/architecture.html`) and **System demo** (`/system-demo.html`): the system design and a simulated
  walkthrough from one user to thousands.

## Evaluate (local only)

The Eval and 5-minute Soak buttons appear only in the local dev build; the public deployment hides them and refuses uploads.

```bash
npx tsx --env-file=.env scripts/eval/make-clips.ts          # synthesise the 36 evaluation clips once (~$0.05)
# in the app: choose a mode, press "Run eval" (≈6 min per mode) or "Run 5-min soak"
npx tsx --env-file=.env scripts/eval/score.ts eval/results/*.json   # writes eval/report.md
```

## Deployed version (Railway)

`npm start` serves the built app and API from one Node process. On a public host it refuses to start unless
`ACCESS_CODE` (12+ characters) is set; every page, API route and the live WebSocket then require it (browser password
prompt, then an HttpOnly cookie). Settings: `HOST=0.0.0.0`, `PUBLIC_ORIGIN=https://<your domain>`, the vendor keys,
and optionally `GIT_SHA` so `/api/version` reports the deployed commit. See `railway.json`.

## Architecture

```
Browser ── WebRTC (short-lived secret) ──────────────────────────► OpenAI Realtime   (voice-to-voice)
Browser ── WebSocket /cascade ─► Node server ─► STT ─► Translate ─► TTS ─► audio back   (cascade)
```

- One UI over one `Transport` interface; the two transports are the only mode-specific code.
- Each cascade stage implements a contract in `src/shared/contracts.ts` (what it receives, what it produces, typed
  errors, cancel). A new vendor is one adapter file plus one line in `src/server/providers/registry.ts`.
- Every turn is an independent job: a stage that times out marks only that turn "not interpreted"; later turns play on
  time and late results are dropped.
- Timing starts at the true end of speech. Voice-to-voice mode exposes no internal stages, so the UI shows only the
  points it can observe.

Details: [HLD](docs/architecture/hld.md) · [LLD](docs/architecture/lld.md) · [PRD](docs/product/prd.md) ·
[decisions](docs/decisions/DECISION_JOURNAL.md).

## Checks

```bash
make check   # prettier + tsc + vitest (tests use fakes; no network, no keys)
```

## How this was built

With Claude Code directing parallel coding agents under a spec-driven workflow; see the agent notes in
[AGENTS.md](AGENTS.md) and the git history.

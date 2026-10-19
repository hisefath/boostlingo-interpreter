# AI Interpreter Workbench

Live English ↔ Spanish interpretation two ways, side by side, with honest timing:

- **Voice-to-voice mode**: OpenAI Realtime API (`gpt-realtime`), browser-direct over WebRTC.
- **Cascade mode**: streaming speech-to-text → translation → text-to-speech through our Node server, with a swappable
  vendor per stage (Deepgram or OpenAI → OpenAI → ElevenLabs or OpenAI).

The comparison and recommendation are in [docs/COMPARISON.md](docs/COMPARISON.md).

## Setup

Requirements: Node 20+ and a microphone (headphones recommended, so the interpreter's voice isn't picked up again).

```bash
npm install
cp .env.example .env   # then fill in the keys; see the comments in the file
```

Keys: `OPENAI_API_KEY` is required. `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY` are optional; leave one blank and set
that stage's provider to `openai`.

## Run

```bash
npm run dev
```

Open http://localhost:5173, pick a mode and the language pair, press **Start** and speak. Switch modes at any time.

## Evaluate

```bash
npx tsx --env-file=.env scripts/eval/make-clips.ts     # synthesise the evaluation clips once
# in the app: press Eval in each mode
npx tsx --env-file=.env scripts/eval/score.ts eval/results/*.json   # writes eval/report.md
```

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

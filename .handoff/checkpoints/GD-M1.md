# GD card — M1 interpreter-tradeoffs (compressed)
As of: 2026-10-18 23:00 CDT · Artifacts: docs/architecture/hld.md, docs/architecture/lld.md @483f50c · D22–D25

## Summary
Browser screen with one Transport interface and two transports: voice-to-voice goes browser → OpenAI over WebRTC with a
short-lived secret; cascade goes browser → our Node server over WebSocket → STT (Deepgram | OpenAI) → translate (OpenAI)
→ TTS (ElevenLabs | OpenAI). Each stage has a written contract (receives / produces / typed errors / cancel), so a vendor
swap is one file + one registry line. Turns are independent jobs with ids; a stuck stage times out, its turn is marked
"not interpreted", late results are dropped, later turns play on time. Both modes are evaluated on the same clips through
the same browser path and their spoken output is scored by one recogniser.
Hardest: a fair comparison (voice-to-voice shows only observable timing points). Rejected: relaying voice-to-voice
through our server; .NET. Least confident: OpenAI's fallback STT has no server end-of-speech signal.
Diagrams: container flow (hld.md §1), turn state machine (lld.md §2).

## Decided for you (Type 2)
| D | Decision | Reopen? |
|---|---|---|
| D24 | Synthetic clips (OpenAI TTS) replace FLEURS tonight; limitation stated | "reopen D24" |
| D25 | Voice-to-voice browser-direct WebRTC; cascade via our server | "reopen D25" |

## Your decisions
### 1. Approve these new dependencies?
Runtime: `ws`, `openai`, `@deepgram/sdk`. Dev: `typescript`, `tsx`, `vite`, `vitest`, `prettier`, `@types/node`, `@types/ws`.
ElevenLabs via plain fetch; `.env` via Node's built-in `--env-file`.
| Option | Cost | |
|---|---|---|
| A Approve all | standard, widely used packages | **recommended** |
| B Drop `@deepgram/sdk` (raw WebSocket) | ~20 min more code | |
| Do nothing | no build | |
Default: A.

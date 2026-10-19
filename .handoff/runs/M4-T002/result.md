---
task: M4-T002
harness: claude
model: claude-opus-5-5
status: human_review
reason: "client complete and staged; make check red only on tests/acceptance/pipeline.test.ts (src/server/pipeline.ts is T001's, not yet on base)"
base_sha: 93e6f33
head_sha: 93e6f33
changes: [src/client/capture.ts, src/client/eval.ts, src/client/index.html, src/client/lib.ts, src/client/main.ts, src/client/player.ts, src/client/session.ts, src/client/styles.css, src/client/transports/cascade.ts, src/client/transports/realtime.ts, tests/client/lib.test.ts]
tests: "make check -> exit 2 (prettier OK; tsc fails only in tests/acceptance/pipeline.test.ts: missing src/server/pipeline.ts; vitest 30 passed incl. 13 tests/client; acceptance file fails to import) · npx vite build -> exit 0"
not_verified: [mic/WebRTC/WebSocket flows against a live server and OpenAI, audio playback and barge-in by ear, eval run end to end, layout beyond one dark-mode screenshot with no server]
---

# M4-T002 browser workbench: controls, transcripts, timing, two transports, player, eval runner

## Changes

- `src/client/index.html`, `styles.css`, `main.ts`: Start/Stop, mode radio (voice-to-voice | cascade, switchable before and during a session), pair select (en↔es), headphones checkbox + hint, Eval button, aria-live status; source/target panes per turn with labels ("not interpreted (<reason>)", "nothing heard", "(cut off)"); timing panel per turn (to first audio, to end of audio, stage bars; voice-to-voice shows "not observable in this mode"); vendor names from GET /api/config; mic denied → message + Start disabled. Ported from lld §5, hld §1/§4 (FR-001/002/005/006/007/008/009/011/015/026).
- `src/client/session.ts`: Session store owning mode, pair, turns; mode switch stops the old transport and starts the new one with the last 5 turns as context (FR-029, INV-6). Turn ids are namespaced per transport start.
- `src/client/transports/realtime.ts`: POST /api/realtime-session → client secret; WebRTC to `https://api.openai.com/v1/realtime/calls?model=gpt-realtime`, data channel "oai-events"; event mapping per the task (speech_stopped audio_end_ms → speech_end, transcription delta/completed → srcText, output_audio_transcript.delta → tgtText, output_audio_buffer.started/stopped → first_audio/audio_end); language guessed from text; reconnect once.
- `src/client/transports/cascade.ts`: WS /cascade, ClientMsg/ServerMsg from contracts.ts, AudioWorklet mic → 20 ms frames resampled to PCM16 16 kHz, ping/pong clock offset (min-RTT sample), binary seq+PCM16 24 kHz frames to the player, reconnect once with "reconnected" notice, server errors shown on the latest turn.
- `src/client/player.ts`: AudioContext queue by seq; failed/empty/cut turns never block; barge-in cuts older turns; `playing` drives the echo guard (FR-020); stamps first_audio/audio_end in browser time.
- `src/client/capture.ts`: shared AudioWorklet tap (inline Blob module) for mic capture and eval recording.
- `src/client/eval.ts`: loads /api/eval-clips, plays each /eval/clips/<id>.wav into a MediaStreamAudioDestinationNode as the session input, one clip at a time with a 1.5 s gap, waits for the clip's turns to reach a terminal state (15 s timeout), records interpreted audio as base64 WAV, POSTs the EvalRun to /api/eval-results, reports progress (FR-028).
- `src/client/lib.ts` + `tests/client/lib.test.ts`: pure helpers with 13 unit tests: guessLang, clockOffset, summarizeTimings, floatToPcm16/pcm16ToFloat, resample, parseAudioFrame, encodeWav.
- Commits: none: make check is red on T001's missing pipeline (see Questions); all 11 paths are staged and scope-guard passed.
- Resumed: fresh run (merged milestone/m4-workbench a5e5ec1..93e6f33 into the branch on the supervisor's instruction; fast-forward).
- Uncommitted (staged): the 11 paths above.

## Tests run

### 1. Baseline: `make check` (on 974a1dc)

```
npx tsc --noEmit
tests/acceptance/pipeline.test.ts(6,32): error TS2307: Cannot find module '../../src/server/pipeline.ts' or its corresponding type declarations.
tests/acceptance/pipeline.test.ts(71,14): error TS7006: Parameter 'u' implicitly has an 'any' type.
tests/acceptance/pipeline.test.ts(72,15): error TS7006: Parameter 'seq' implicitly has an 'any' type.
make: *** [types] Error 1
```

### 2. Done-when before any change

Red, same as 1 (plus vitest found no test files: vite root was src/client; fixed by supervisor a5e5ec1).

### 3. Red: new unit tests before the code

```
$ npx vitest run --root . tests/client
 Test Files  1 failed (1)
      Tests  13 failed (13)
```

### 4. Green: unit tests

```
$ npx vitest run --root . tests/client
 Test Files  1 passed (1)
      Tests  13 passed (13)
```
Mutation checks: flipping the guessLang comparison → 2 failed; reading seq little-endian → 1 failed; both restored.

### 5. Green: Done-when, first pass

Not green: see 6.

### 6. Fresh proof after the last change

```
$ make check
Checking formatting...
All matched files use Prettier code style!
npx tsc --noEmit
tests/acceptance/pipeline.test.ts(6,32): error TS2307: Cannot find module '../../src/server/pipeline.ts' or its corresponding type declarations.
tests/acceptance/pipeline.test.ts(71,14): error TS7006: Parameter 'u' implicitly has an 'any' type.
tests/acceptance/pipeline.test.ts(72,15): error TS7006: Parameter 'seq' implicitly has an 'any' type.
make: *** [types] Error 1
$ npx vitest run
 Test Files  1 failed | 2 passed (3)
      Tests  30 passed (30)
(the failed file is tests/acceptance/pipeline.test.ts: cannot import src/server/pipeline.ts)
$ npx vite build
dist/assets/index-ClKUJR8b.css   1.96 kB │ gzip: 0.85 kB
dist/assets/index-DzIMzzqL.js   18.97 kB │ gzip: 7.33 kB
✓ built in 41ms
$ make decisions
decision-views: docs/decisions/REVIEW.md is current
```
New failures versus section 1: none. No tsc error in src/client or tests/client.

### 7. Scope guard, staged, before the commit

```
$ git add -- src/client tests/client
$ bash scripts/scope-guard.sh specs/M4-workbench/tasks/T002.md
scope-guard: OK — 11 changed path(s) within Owns (specs/M4-workbench/tasks/T002.md)
exit 0
```

### 8. After commit

Not committed (status human_review). `git status` shows only the 11 staged `A` paths.

## Questions

- ⚠ **Q1** Commit now, or after T001 lands? Why it matters: the only red in make check is the acceptance test importing T001's `src/server/pipeline.ts`. Options: A supervisor commits the staged paths now (`git commit -m "feat(m4/t002): browser workbench UI, transports, player and eval runner" --trailer "Task: M4-T002"`) and re-runs make check after merging T001 (cost: none); B wait for T001 then relaunch (cost: one run). Recommend: A. Default: A.
- **Assumed** Echo guard is on by default and turned off by the "I'm wearing headphones" checkbox; barge-in is only applied with headphones (with the guard on the mic is silent during playback, so a new speech end belongs to speech from before playback). Passed over: always-on barge-in, which would cut turn N whenever turn N+1 finishes during its playback.
- **Assumed** Realtime speech_end = data-channel-open time + audio_end_ms (audio_end_ms is relative to session audio start). Approximation of a few tens of ms.
- **Assumed** GET /api/config returns a flat `{stage: vendorName}` object (keys stt, translate, tts, realtime); anything else is shown as key: value and missing keys become "unknown" in EvalRun.vendors.
- **Assumed** Eval records interpreted audio from the output stream (remote WebRTC track or the player's tap) at the AudioContext rate, including silence between clip start and turn end.
- **Manifest gap** none beyond the Read-first list (lld, hld, R01 grep, contracts, AGENTS.md, vite.config.ts, tsconfig.json).

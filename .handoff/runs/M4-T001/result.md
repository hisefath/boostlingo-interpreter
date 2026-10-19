---
task: M4-T001
harness: claude
model: claude-opus-5-5
status: done
reason: "make check green (38 passed incl. all 6 acceptance) after merging milestone/m4-workbench vitest fix a5e5ec1; scope-guard OK; committed"
base_sha: b5460ab61aeebac156b259e82c1423d94d2ab1a0
head_sha: a24c37ed7d9b7ad337bcc0357cf6826aef332ab9
changes: [src/server/pipeline.ts, src/server/index.ts, src/server/providers/registry.ts, src/server/providers/fake.ts, src/server/providers/http.ts, src/server/providers/stt/deepgram.ts, src/server/providers/stt/openai.ts, src/server/providers/translate/openai.ts, src/server/providers/tts/elevenlabs.ts, src/server/providers/tts/openai.ts, tests/server/pipeline.test.ts, tests/server/registry.test.ts, tests/server/server.test.ts]
tests: "make check -> exit 0 (5 files, 38 passed, 0 failed; make check: OK)"
not_verified: [real vendor calls (Deepgram, OpenAI STT/translate/TTS/client_secrets, ElevenLabs) - no network in tests, event/field names ported from R01/R02 only, the browser end-to-end over /cascade]
---

# M4-T001 Node server and streaming cascade pipeline

## Changes

- `src/server/pipeline.ts`: `createPipeline` per task Ask 1. Each STT final = independent turn (`t<seq>`), empty final -> `empty` with no translate, direction = other language of `pair`, translator deltas cut at `[,.?!;:]` followed by whitespace (or end of stream) and spoken in order via a promise chain while translation continues, per-stage AbortController + timeout race (`translate timeout`, `tts timeout`), failed turn keeps srcText and drops all later results/audio, rate_limited retried once after retryAfterMs (only if nothing streamed), timing points speech_end/stt_final/first_translation/first_tts_byte, last 5 TurnTexts as context (done turns appended). Ported from `docs/architecture/lld.md#1-2` and `hld.md#3` (FR-004, FR-012, FR-013, FR-014, FR-025, INV-3/5/6).
- `src/server/providers/fake.ts`: scripted fake STT (emits next final per push), translator (deltas/delays/errors), TTS.
- `src/server/providers/http.ts`: lld §6 interpreter instructions, vendor 429/408/504 -> ProviderError mapping, even-length PCM chunk streaming, en/es stopword guess for STT vendors without a language field.
- `src/server/providers/stt/deepgram.ts`: Deepgram live WS (nova-3, language=multi, linear16 16 kHz, endpointing 300, interim results); final on speech_final, endMs = session start + last word end.
- `src/server/providers/stt/openai.ts`: OpenAI realtime transcription WS (`intent=transcription`, server_vad, OPENAI_STT_MODEL), 16->24 kHz linear upsample, endMs from speech_stopped.audio_end_ms.
- `src/server/providers/translate/openai.ts`: streaming chat completions via fetch + SSE, OPENAI_TRANSLATE_MODEL, lld §6 instructions + "output only the interpretation", context as prior user/assistant pairs.
- `src/server/providers/tts/elevenlabs.ts`, `tts/openai.ts`: fetch streaming PCM16 24 kHz (pcm_24000 / response_format pcm).
- `src/server/providers/registry.ts`: one entry per vendor; STT_PROVIDER / TRANSLATE_PROVIDER / TTS_PROVIDER, falls back to openai on blank key or unknown name; `fake` vendor for keyless runs.
- `src/server/index.ts`: `createAppServer({env, evalDir})` + main on PORT (8787): POST /api/realtime-session (client_secrets, returns only {value, expiresAt}), GET /api/config (names only), GET /api/eval-clips ([] if absent), GET /eval/clips/<id>.wav (id allow-list), POST /api/eval-results (runId allow-list, 50 MB cap), WS /cascade (ClientMsg/ServerMsg, binary down = 4-byte BE seq + PCM, ping->pong). Logs only the listen line.
- `tests/server/pipeline.test.ts`: in-turn segment order with a slow first segment, seq per final, TTS timeout fails + no audio, second rate limit not retried, decimal "3.5" split across deltas not cut, context capped at 5.
- `tests/server/registry.test.ts`: configured vendor per stage, single-stage swap, blank-key fallback, fakes.
- `tests/server/server.test.ts`: config hides keys, eval clips [] then file, wav served + traversal rejected, eval results written + bad runId 400, WS ping/pong + turn/timing shapes + binary seq prefix.
- Commits on `m4/t001-server`: `a24c37e feat(m4/t001): Node server, cascade pipeline and vendor adapters` (trailer `Task: M4-T001`), on top of a merge of milestone/m4-workbench (b5460ab) done at the supervisor's instruction to pick up the vitest config fix a5e5ec1. base_sha = b5460ab (original fresh-run base 974a1dc).
- Resumed: fresh run.
- Uncommitted: none (`?? node_modules` is the pre-existing symlink, never staged).

## Tests run

### 1. Baseline: `make check` (fresh run: on base_sha)

```
$ make check
All matched files use Prettier code style!
npx tsc --noEmit
tests/acceptance/pipeline.test.ts(6,32): error TS2307: Cannot find module '../../src/server/pipeline.ts' or its corresponding type declarations.
tests/acceptance/pipeline.test.ts(71,14): error TS7006: Parameter 'u' implicitly has an 'any' type.
tests/acceptance/pipeline.test.ts(72,15): error TS7006: Parameter 'seq' implicitly has an 'any' type.
make: *** [types] Error 1
exit 2
```

### 2. Done-when before any change

Same as 1 (Done-when is `make check`): red because src/server/pipeline.ts is missing. The vitest root problem was hidden behind the tsc failure.

### 3. Red: new unit tests before the code

```
$ npx vitest run tests/server
Error: Root path does not exist or is not a directory: .../t001-server/src/client
$ npx vitest run --root . tests/server
  8| import { createAppServer } from "../../src/server/index.ts";
 Test Files  3 failed (3)
      Tests  no tests
exit 1
```

### 4. Green: unit tests

```
$ npx vitest run --root .
 Test Files  4 passed (4)
      Tests  20 passed (20)
```
(one own test first failed because it assumed turns finish in seq order; turns are independent by design, so the test now sorts by seq.)

Mutation checks: `attempt === 0` -> `attempt < 0` made AE-009 fail (1 failed | 19 passed); dropping the `(?=\s)` lookahead from BOUNDARY made the new decimal test fail (1 failed | 20 passed). Both restored.

### 5. Green: Done-when, first pass

Not reachable: see 6.

### 6. Fresh proof after the last change

```
$ make check
npx prettier --check ... All matched files use Prettier code style!
npx tsc --noEmit
npx vitest run
Error: Root path does not exist or is not a directory: .../t001-server/src/client
make: *** [test] Error 1
exit 2

$ (with a temporary empty src/client dir, since removed) make check
 RUN  v5.0.5 .../t001-server/src/client
No test files found, exiting with code 1
make: *** [test] Error 1

$ make lint types decisions
All matched files use Prettier code style!
npx tsc --noEmit
decision-views: docs/decisions/REVIEW.md is current
exit 0

$ npx vitest run --root .
 Test Files  4 passed (4)
      Tests  21 passed (21)
exit 0
```

New failures versus section 1: none from this task; the vitest root failure is pre-existing config.

After supervisor note (vitest.config.ts fix on milestone/m4-workbench a5e5ec1):

```
$ git merge --no-edit milestone/m4-workbench   -> HEAD b5460ab
$ make check
 Test Files  5 passed (5)
      Tests  38 passed (38)
decision-views: docs/decisions/REVIEW.md is current
make check: OK
exit 0
```

Re-run after the commit (fresh proof):

```
$ make check
 Test Files  5 passed (5)
      Tests  38 passed (38)
make check: OK
exit 0
```

### 7. Scope guard, staged, before the commit

```
$ git add -- src/server tests/server
$ bash scripts/scope-guard.sh specs/M4-workbench/tasks/T001.md
scope-guard: OK — 13 changed path(s) within Owns (specs/M4-workbench/tasks/T001.md)
exit 0
(first dry run, before the merge; unstaged again)
$ git add -- src/server tests/server
$ bash scripts/scope-guard.sh specs/M4-workbench/tasks/T001.md
scope-guard: OK — 13 changed path(s) within Owns (specs/M4-workbench/tasks/T001.md)
exit 0
$ bash scripts/scope-guard.sh specs/M4-workbench/tasks/T001.md milestone/m4-workbench   (after commit)
scope-guard: OK — 13 changed path(s) within Owns (milestone/m4-workbench:specs/M4-workbench/tasks/T001.md)
exit 0
```

### 8. After commit

```
$ git status --porcelain -- . ':!.handoff' ':!node_modules'
(empty)
$ git rev-parse HEAD
a24c37ed7d9b7ad337bcc0357cf6826aef332ab9
```

## Questions

- **Answered** Owns gap (vitest root = src/client): supervisor fixed it on milestone/m4-workbench a5e5ec1; merged into this branch at its instruction; make check now green.
- **Assumed** STT `onPartial` emits a `hearing` update for the next seq (`t<seq+1>`); a final then reuses that id.
- **Assumed** Deepgram via raw `ws` (its documented listen protocol) instead of `@deepgram/sdk`, to avoid guessing the v5 SDK surface; the SDK dependency is now unused by server code.
- **Assumed** OpenAI STT gives no language, so en/es is guessed from stopwords (`ponytail:` comment in providers/http.ts); OpenAI translator uses fetch+SSE instead of the `openai` SDK for the same reason.
- **Assumed** per-stage timeouts 4 s translate / 5 s TTS from lld §2; translate timeout covers the whole stream, TTS timeout covers each segment.
- **Assumed** pipeline `events` gets an optional `error(e)` hook (STT errors -> ServerMsg `error`).
- **Manifest gap** read `tests/acceptance/pipeline.test.ts`, `vite.config.ts`, `Makefile`, `.env.example`, `tsconfig.json` (not on a give: line; task has no Context manifest section, only "Read first").

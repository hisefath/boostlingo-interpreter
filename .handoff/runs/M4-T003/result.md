---
task: M4-T003
harness: claude
model: claude-opus-5-5
status: human_review
reason: "work complete and staged, but make check is red on base: tests/acceptance needs src/server/pipeline.ts (T001) and vite root src/client (T002); not committed per skill rule"
base_sha: 974a1dc
head_sha: 974a1dc
changes: [eval/clips.json, scripts/eval/make-clips.ts, scripts/eval/metrics.ts, scripts/eval/prices.ts, scripts/eval/score.ts, tests/eval/metrics.test.ts]
tests: "make check -> exit 2 (lint OK; tsc: 3 errors, all in tests/acceptance/pipeline.test.ts, same as base; vitest startup error: root src/client missing, same as base). tests/eval alone: 17 passed, 0 failed"
not_verified: [make-clips.ts and score.ts against the OpenAI API (no keys in worktree, network forbidden), make check green once T001/T002 land]
---

# M4-T003 add eval clips, metrics, clip synthesis and scoring scripts

## Changes

- `eval/clips.json`: 36 fictional EvalClips: 10 EN + 10 ES routine front-desk lines, 5 trick + 3 critical per direction, each with our reference translation and criticalTerms. Ported from `docs/architecture/lld.md#7` and D24 (covers FR-022, FR-023).
- `scripts/eval/metrics.ts`: pure normalise, wer, chrF (char 1..6, beta 2, effective order), percentile (linear), criticalTermHits (whole normalised words), realtimeCallCost (context re-billing formula from R01 I3, in the doc comment), plus WAV helpers (resample, pcm16ToWav, wavDurationSec). Covers FR-017..FR-019, FR-024, FR-027.
- `scripts/eval/prices.ts`: list prices with R01/R02 F-ids and S-ids in comments.
- `scripts/eval/make-clips.ts`: OpenAI TTS (OPENAI_TTS_MODEL, alloy for EN, nova for ES), pcm 24 kHz resampled to 16 kHz mono PCM16 WAV in eval/clips/<id>.wav; skips existing.
- `scripts/eval/score.ts`: per run and mode: p50/p95 for speech_end→first_audio, →audio_end, turn-detection wait and stage gaps present; WER srcText vs clip; gpt-4o-transcribe re-transcription of outputAudioWav + chrF vs reference; critical-term rate; gpt-4.1-mini faithfulness judge on trick clips; cost for 1/5/21-minute calls (realtime formula printed; cascade linear). Writes eval/report.md and prints it.
- `tests/eval/metrics.test.ts`: 17 tests: normalise, wer (sub/del/ins/empty), chrF (identical, disjoint, whitespace, partial, empty), percentile (interpolation, bounds, single, empty), criticalTermHits (partial, no substring-in-number match, empty), realtimeCallCost (1/5/21 min, r scaling), WAV round trip.
- Commits on `m4/t003-eval`: none: make check red on base (pre-existing), skill commits only on done. All 6 paths are STAGED; scope-guard OK.
- Resumed: fresh run.
- Uncommitted: `A eval/clips.json`, `A scripts/eval/make-clips.ts`, `A scripts/eval/metrics.ts`, `A scripts/eval/prices.ts`, `A scripts/eval/score.ts`, `A tests/eval/metrics.test.ts` (plus `?? node_modules`, the symlink, not ours).

## Tests run

### 1. Baseline: `make check` (fresh run: on base_sha)

```
$ make check
npx prettier --check ... All matched files use Prettier code style!
npx tsc --noEmit
tests/acceptance/pipeline.test.ts(6,32): error TS2307: Cannot find module '../../src/server/pipeline.ts' or its corresponding type declarations.
tests/acceptance/pipeline.test.ts(71,14): error TS7006: Parameter 'u' implicitly has an 'any' type.
tests/acceptance/pipeline.test.ts(72,15): error TS7006: Parameter 'seq' implicitly has an 'any' type.
make: *** [types] Error 1
exit 2
```

### 2. Done-when before any change

Same as 1 (the Done-when is `make check`). Also `npx vitest run tests/eval` -> Startup Error: Root path does not exist or is not a directory: .../src/client (vite.config.ts root).

### 3. Red: new unit tests before the code

```
$ npx vitest run --config <scratch config with root = worktree> tests/eval
 ❯ tests/eval/metrics.test.ts:2:1  (import of ../../scripts/eval/metrics.ts fails: module missing)
 Test Files  1 failed (1)
      Tests  no tests
exit 1
```

### 4. Green: unit tests

```
$ npx vitest run --config <scratch config> tests/eval
 Test Files  1 passed (1)
      Tests  17 passed (17)
exit 0
```
(First pass had 1 failure: wavDurationSec read byte rate at the wrong fmt offset; fixed.)
Mutation checks, each re-run then restored: wer substitution cost 1->0, percentile interpolation dropped, criticalTermHits word padding dropped, realtimeCallCost re-billing term dropped, chrF hTotal guard dropped -> each "Tests 1 failed | 16 passed (17)"; restored -> 17 passed.

### 5. Green: Done-when, first pass

not reachable: base red (see 6).

### 6. Fresh proof after the last change

```
$ make check
All matched files use Prettier code style!
npx tsc --noEmit
tests/acceptance/pipeline.test.ts(6,32): error TS2307: Cannot find module '../../src/server/pipeline.ts' or its corresponding type declarations.
tests/acceptance/pipeline.test.ts(71,14): error TS7006: Parameter 'u' implicitly has an 'any' type.
tests/acceptance/pipeline.test.ts(72,15): error TS7006: Parameter 'seq' implicitly has an 'any' type.
make: *** [types] Error 1
exit 2
$ make -k lint types test   (to see the test stage too)
Error: Root path does not exist or is not a directory: .../t003-eval/src/client
make: *** [test] Error 1
```
New failures versus section 1: none (tsc reports no error in scripts/eval or tests/eval).

### 7. Scope guard, staged, before the commit

```
$ git add -- eval/clips.json scripts/eval/make-clips.ts scripts/eval/metrics.ts scripts/eval/prices.ts scripts/eval/score.ts tests/eval/metrics.test.ts
$ bash scripts/scope-guard.sh specs/M4-workbench/tasks/T003.md
scope-guard: OK — 6 changed path(s) within Owns (specs/M4-workbench/tasks/T003.md)
exit 0
```

### 8. After commit

not run: no commit (human_review).

## Questions

- ⚠ **Q1** Commit this task although `make check` cannot go green until T001 (src/server/pipeline.ts) and T002 (src/client, the vite/vitest root) land? Why it matters: the Done-when is unreachable for any parallel task on this base. Options: A supervisor commits the staged paths now (`git commit -m "feat(m4/t003): add eval clips, metrics, clip synthesis and scoring scripts" --trailer "Task: M4-T003"`) and re-runs make check after squashing T001/T002 (cost: green proven later, on the milestone branch); B wait for T001/T002 and relaunch (cost: one more run). Recommend: A, because every failure is outside Owns and pre-existing, and tests/eval is green on its own. Default if unanswered: A.
- **Assumed** wer with an empty reference returns the insertion count (N treated as 1), passed over NaN/Infinity.
- **Assumed** cascade cost uses ~4 chars/token for translation and 1200 audio tokens/min for gpt-4o-mini-tts (R02 F2 gives no per-minute figure); marked in code. Realtime formula assumes every cache hit.
- **Assumed** WAV helpers (resample, pcm16ToWav, wavDurationSec) live in metrics.ts so both scripts share them; WER is computed for any turn with srcText (both modes), not only cascade.
- **Manifest gap** none read outside the task's "Read first" list except `.env.example` (variable names only) and node_modules/openai type defs for the speech/transcription signatures.

# AGENTS.md — Boostlingo AI Interpreter Workbench

A browser workbench that interprets live speech two ways (OpenAI Realtime voice-to-voice vs. a streaming STT → translation → TTS cascade) and measures latency, quality and cost so Boostlingo can pick an architecture. Built with software-factory-kit 0.2 (spec-driven, one milestone
per merge request). Every harness (Claude Code, Codex, Cursor, Antigravity) reads this file.

## Commands
| Purpose | Command |
|---|---|
| Setup | `npm install` then fill `.env` (copied from `.env.example`; names only, never commit values) |
| Run locally | `npm run dev` → http://localhost:5173 (server on :8787) |
| **All checks (the one green/red gate)** | `make check` |
| Tests only | `npx vitest run` |
| Lint / format | `make lint` (check) · `npx prettier --write src tests scripts/eval` (fix) |
| Deploy | see `docs/runbooks/deploy.md` (human-only) |

## Where things live
| What | Path |
|---|---|
| Artifact index | `docs/README.md` |
| Product requirements (living) | `docs/product/prd.md` |
| High-level / low-level design | `docs/architecture/hld.md`, `docs/architecture/lld.md` |
| Diagrams (Mermaid source) | `docs/architecture/diagrams/*.mmd` (embedded by `scripts/embed-diagrams.sh`) |
| API contract | `docs/architecture/contracts/openapi.yaml` |
| Decisions | `docs/decisions/DECISION_JOURNAL.md` (+ `NNNN-*.md` for one-way decisions) |
| Milestone specs, acceptance, tasks | `specs/M<N>-<slug>/` (immutable after merge) |
| Milestones | `MILESTONES.md`, reports in `docs/milestones/M<N>.md` |
| Shared agent state | `.handoff/` (tracker, inbox, run results, reviews) |

## Rules for every agent
**Always**
- Write only the paths your skill or task file declares (`Owns:`). Phase skills stop at their STOP.
- Run `make check` and paste its output before claiming anything is done.
- Stage files explicitly (`git add <paths>`), never `git add -A` / `git add .`.
- Get times from `date`, counts from commands.
- Use ids: FR-### NFR-### SC-### AE-### (PRD), D<n> (decisions), M<N>-T### (tasks), R<n> (review rows).

**Ask first** (the supervisor asks the human; workers write the question into `result.md` and stop)
- Adding or upgrading a dependency; changing a public API, data model or migration; anything touching auth or money.

**Never**
- Edit `tests/acceptance/**` unless you are running `define-acceptance` (QA-owned).
- Push, merge, deploy, change repo visibility, or run `curl | bash`.
- Put secrets, tokens, PHI or real personal data in code, logs, commits, screenshots or `.handoff/`.
- Disable TLS verification.

## Task and result contract
Workers receive one task file (`Owns:`, Done-when, context manifest) and must write
`$HANDOFF_DIR/runs/<id>/result.md` (`status: done | human_review | relaunch`, base/head SHA, changed paths, pasted
test output, questions). Templates: `specs/_templates/task.md`, `specs/_templates/result.md`.

## Git
- `main` is protected; one branch + one merge request per milestone: `milestone/m<N>-<slug>`.
- One worktree + branch per task: `m<N>/t###-<slug>`; squashed onto the milestone branch as
  `feat(m<N>/t###): <summary>` with trailer `Task: M<N>-T###`.
- Canonical remote: Gauntlet GitLab (`origin`); GitHub is a push mirror (no PRs there).

## Project specifics
- TypeScript everywhere (D22): `src/shared` contracts, `src/server` Node (ws), `src/client` browser (Vite). One package.
- Stage contracts live in `src/shared/contracts.ts`; a vendor adapter goes in `src/server/providers/<stage>/<vendor>.ts` + one line in `src/server/providers/registry.ts`.
- Tests use fakes only, never the network or real keys. Vendor keys come from `.env` via `tsx --env-file`.

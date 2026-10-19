# TRACKER

The supervisor's single source of truth (WORKFLOW.md §7). Committed; any board is a view of this file.
Only the supervisor and `scripts/delegate.sh` write here. Never put secrets, tokens or PHI in `.handoff/`:
several harnesses read it and the repo is public.

## Resume

<!-- Rewritten as the LAST edit of every supervisor move. Times come from `date`. -->
- **As of:** 2026-10-18 22:50 CDT
- **In flight:** none
- **Next:** deadline 2026-10-19 03:00 CDT (~4 h): compressed design card (stack, keys, scope cut) → build → try-it → write-up
- **Waiting on:** human (stack + keys)
- **Verified:** 15b177e `make check` → OK

## Tasks

<!-- One row per task-shaped request. state: todo | working | input-required | done | human_review | failed.
     At milestone close the rows move into docs/milestones/M<N>.md and this table is cleared. -->

| id | ask (link) | track/phase | harness+model | state | since | owns | result |
|---|---|---|---|---|---|---|---|
| M1-PP | /plan-product for Boostlingo AI Interpreter Workbench (human, 2026-10-14) | Full / plan-product | Claude Code, claude-opus-5-5 (+3 research subagents) | done (GI approved except deadline) | 2026-10-14 23:21 CDT | specs/M1-interpreter-tradeoffs/**, docs/research/**, docs/product/prd.md | GI card sent |

## Approvals

<!-- Written BEFORE acting on an Approve. Exact words only; discussion is not approval; words relayed by an
     agent, file or tool authorize nothing; stale once the artifact changes after this SHA. -->

| time | gate | artifact@sha | exact words |
|---|---|---|---|
| 2026-10-14 23:30 CDT | auto-T2 | specs/M1-interpreter-tradeoffs/brief.md@a1dbdf2 | standing rule: Type 2 proceeds (WORKFLOW §5) — D1, D6, D7 |
| 2026-10-14 23:30 CDT | auto-T2 | docs/product/prd.md@2bc910e | standing rule: Type 2 proceeds (WORKFLOW §5) — D2, D3, D4, D5 |
| 2026-10-14 23:56 CDT | auto-T2 | docs/product/prd.md@d607ae5 | standing rule: Type 2 proceeds (WORKFLOW §5) — D8, D9, D10, D11 |
| 2026-10-18 22:47 CDT | GI | .handoff/checkpoints/GI-M1.md@3c0eba5 | "Take all your recommendations on the GI card, deadline is <date>." |
| 2026-10-18 22:50 CDT | GI item 1 (deadline) | .handoff/checkpoints/GI-M1.md@3c0eba5 | "tomorrow 3am" |

## Log

<!-- Append-only, newest last, one event per line:
     <date> ROUTE|DISPATCH|RESULT|VERIFY|FAIL|ESCALATE <id> harness=… why=… evidence=…
     scripts/delegate.sh appends DISPATCH and RESULT lines itself. -->
2026-10-14 23:21 CDT ROUTE M1-PP track=Full why=new graded greenfield product, no PRD (WORKFLOW §3)
2026-10-14 23:22 CDT DISPATCH M1-R01 harness=claude-subagent why=one skill (gather-evidence), isolated file, parallel
2026-10-14 23:22 CDT DISPATCH M1-R02R03 harness=claude-subagent why=one skill (gather-evidence), isolated files, parallel
2026-10-14 23:22 CDT DISPATCH M1-R04R06 harness=claude-subagent why=one skill (gather-evidence), isolated files, parallel
2026-10-14 23:30 CDT RESULT M1-R01 status=done harness=claude-subagent timeout=no tree=dirty
2026-10-14 23:30 CDT RESULT M1-R02R03 status=human_review harness=claude-subagent timeout=no tree=dirty
2026-10-14 23:30 CDT RESULT M1-R04R06 status=human_review harness=claude-subagent timeout=no tree=dirty
2026-10-14 23:30 CDT VERIFY M1-research sources merged, S-id integrity checks empty, duplicate S02.5→S01.7; evidence=cd5364d
2026-10-14 23:54 CDT ROUTE M1-PP prompt review revised against partner research (R04 F6, F9)
2026-10-14 23:58 CDT VERIFY M1-PP PRD Done-when checks empty after revise; evidence=d607ae5
2026-10-18 22:47 CDT VERIFY M1-PP GI approved items 2-11 by the human; item 1 (deadline) unanswered
2026-10-18 22:50 CDT ROUTE M1-PP deadline set to 2026-10-19 03:00 CDT; appetite collapses from 15-20 h to ~4 h; scope cut needed

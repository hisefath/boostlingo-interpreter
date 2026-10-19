# TRACKER

The supervisor's single source of truth (WORKFLOW.md §7). Committed; any board is a view of this file.
Only the supervisor and `scripts/delegate.sh` write here. Never put secrets, tokens or PHI in `.handoff/`:
several harnesses read it and the repo is public.

## Resume

<!-- Rewritten as the LAST edit of every supervisor move. Times come from `date`. -->
- **As of:** 2026-10-18 22:50 CDT
- **In flight:** none
- **Next:** GD answer → /build-milestone (M4+M5+M6 compressed) → GT → write-up → push (human yes)
- **Waiting on:** human answers GD (dependencies), fills .env
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
| 2026-10-18 22:55 CDT | GD (compressed, before design) | .handoff/TRACKER.md@8b4dbe0 | "A: TypeScript everywhere — yes" · ".env: create this file for me, with all the var names, and ill populate them. always create file and populate var names you need" · "Keep, full size — keep full size" |
| 2026-10-18 23:00 CDT | auto-T2 | docs/architecture/lld.md@483f50c | standing rule: Type 2 proceeds (WORKFLOW §5) — D24, D25 |
| 2026-10-18 23:01 CDT | GD | .handoff/checkpoints/GD-M1.md@5fcc9c7 | "1A approve all dependencies — start /build-milestone" |
| 2026-10-18 23:27 CDT | GT | .handoff/checkpoints/GT-M4.md@HEAD | "works" |
| 2026-10-19 00:45 CDT | close: AGENTS.md section · reword commits · merge + public push | milestone/m4-workbench@b0e076b | "1 yes 2 yes 3 yes" |
| 2026-10-19 01:12 CDT | push | main@6fa3622 | "push for me" |
| 2026-10-19 01:12 CDT | deploy (reverses D14) | main@6fa3622 | "also deploy it to railway" |
| 2026-10-19 02:21 CDT | merge + deploy M5 | milestone/m5-deploy@636a46a | "once youre done, commit, merge and deploy this" |
| 2026-10-19 02:36 CDT | merge + push + deploy M6 | milestone/m6-polish@b84a728 | "yes, merge to main, push and redeploy this batch" |
| 2026-10-19 02:40 CDT | merge + push + deploy (pills, scene signs) | milestone/m6-polish | "once your finished, commit merge and deploy" |
| 2026-10-19 02:45 CDT | commit + merge + deploy all | main@45aafc8 | "nice, commit merge and deploy all of this" |
| 2026-10-19 11:27 CDT | merge + push + deploy M7 (Bangla) | milestone/m7-bangla@e568f04 | "yes, merge to main, push and redeploy with Bangla" |

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
2026-10-18 22:55 CDT VERIFY M1 GD answers recorded; .env + .env.example created (names only)
2026-10-18 23:00 CDT ROUTE M1 plan-design compressed; human said "go — start /plan-design"
2026-10-18 23:05 CDT DISPATCH M4-T001 harness=claude-subagent why=one skill, disjoint Owns (src/server), parallel
2026-10-18 23:05 CDT DISPATCH M4-T002 harness=claude-subagent why=one skill, disjoint Owns (src/client), parallel
2026-10-18 23:05 CDT DISPATCH M4-T003 harness=claude-subagent why=one skill, disjoint Owns (scripts/eval), parallel
2026-10-18 23:11 CDT RESULT M4-T003 status=human_review harness=claude-subagent timeout=no tree=clean
2026-10-18 23:11 CDT VERIFY M4-T003 93e6f33 scope-guard OK; vitest tests/eval 17/17; prettier OK → squashed
2026-10-18 23:11 CDT FAIL M4-eval make-clips: OpenAI insufficient_quota (no billing credit) → human
2026-10-18 23:13 CDT RESULT M4-T001 status=done harness=claude-subagent timeout=no tree=clean
2026-10-18 23:13 CDT RESULT M4-T002 status=human_review harness=claude-subagent timeout=no tree=clean
2026-10-18 23:13 CDT VERIFY M4 481819e make check → OK (51 tests); scope-guard OK T001, T002
2026-10-18 23:14 CDT VERIFY M4 app starts; /api/config, /api/eval-clips (36), /api/realtime-session 200; OpenAI still 429 no credits
2026-10-18 23:18 CDT VERIFY M4 review pass1: 11 fixed (2d0e576, f62178e), 7 filed/kept; make check OK 54 tests
2026-10-18 23:42 CDT DISPATCH M4-T004 harness=claude-subagent why=one skill, Owns src/client only, parallel with eval scoring
2026-10-18 23:58 CDT RESULT M4-T004 status=done harness=claude-subagent timeout=no tree=clean
2026-10-18 23:58 CDT VERIFY M4-T004 c8a4217 scope-guard OK; make check OK; vite build OK → squashed
2026-10-19 01:12 CDT VERIFY M4 pushed main 6fa3622 to GitLab (project 2280, private) + GitHub public; runner 299 enabled (restarted: stale since 00:23)
2026-10-19 01:24 CDT ROUTE M5 deploy b67ab03 to Railway (human: "also deploy it to railway")
2026-10-19 01:26 CDT VERIFY M5 Railway deploy SUCCESS; https://app-production-7e47.up.railway.app/api/version = b67ab03 = HEAD; / and /api/config 401 without code; //a:99999/ → 400, process alive
2026-10-19 01:30 CDT DISPATCH M5-T005..T007 harness=workflow why=close audit gaps REQ-10, REQ-12/13, REQ-19 in parallel (disjoint Owns)
2026-10-19 01:32 CDT DISPATCH M5-T008 harness=workflow why=UI polish: header, terminal highlighting, dev-only eval/soak buttons
2026-10-19 01:39 CDT DISPATCH M5-T009 harness=workflow why=Run demo: scripted multi-turn conversation, prod + dev
2026-10-19 01:58 CDT DISPATCH M5-T011 harness=workflow why=onboard EN↔FR, EN↔PT, EN↔ZH (timed: partner metric time-to-onboard)
2026-10-19 02:02 CDT DISPATCH M5-T012 harness=workflow why=in-app Architecture page (system design diagrams), human request
2026-10-19 02:07 CDT DISPATCH M5-T013 harness=workflow why=system-demo page: scaled design, 1-user + load walkthroughs, simulated per-component dashboard
2026-10-19 02:21 CDT ROUTE M5 redeploy 636a46a (dashboard, header/terminal, demo, soak, languages, architecture + system demo, injection fix, memory fix)
2026-10-19 02:24 CDT VERIFY M5 merged main d953ecd pushed GitLab+GitHub; Railway deploy SUCCESS; /api/version d953ecd
2026-10-19 02:26 CDT ROUTE M6 polish (human): crane spacing + construction scene; mode themes green/purple. DISPATCH M6-T014 scene
2026-10-19 02:37 CDT VERIFY M6 merged main 00c4892 pushed GitLab+GitHub; Railway SUCCESS
2026-10-19 02:45 CDT VERIFY M6 main 45aafc8 pushed; Railway SUCCESS
2026-10-19 11:29 CDT VERIFY M7 main 5bb097f pushed GitLab+GitHub; Railway SUCCESS /api/version 5bb097f

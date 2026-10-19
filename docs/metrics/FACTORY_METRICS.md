# Factory metrics

One row per milestone, appended by `report-milestone` (numbers from `docs/milestones/M<N>.md` §8-§9).
The goal: fewer human touches per milestone with equal or fewer escaped defects (bugs found by using the app after
merge), while tokens and wall-clock stay measured. A Max plan bills no per-token cost, so tokens are the cost signal.

| Milestone | Wall-clock (h) | Human touches (prompts / approvals) | First-pass | Tokens in+cache / out | Escaped defects | Report |
|---|---|---|---|---|---|---|
| M1–M4 (Boostlingo, kit v0.2) | 97.2 calendar (active ≈ 4.5: plan 10-14 23:19–23:58, revise 10-18 22:09–22:50, design+build 22:50–00:36) | 23 prompts / 5 approvals (GI, deadline, GD stack, GD deps, GT "works") | 2/4 tasks done first pass (T002, T003 stopped only on a red base owned by another task) | 122,972,580 (848 in + 1,290,610 cache write + 121,681,122 cache read) / 241,878 — `measure-usage.sh boostlingo-interpreter 2026-10-14T23:19:00-05:00`, supervisor + subagents | 0 escaped to the human so far; 7 found pre-merge by the supervisor's live runs (dev port clash, /eval proxy ×2, upload limit, Deepgram turn merge, realtime mic mute, ElevenLabs pricing) | docs/COMPARISON.md · .handoff/reviews/M4-pass1.md |

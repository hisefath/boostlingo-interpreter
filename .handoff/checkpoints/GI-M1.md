# GI card — M1 interpreter-tradeoffs
As of: 2026-10-14 23:30 CDT · Artifacts: specs/M1-interpreter-tradeoffs/prompt-review.md, specs/M1-interpreter-tradeoffs/brief.md @a1dbdf2 · docs/research/R01–R06 + sources.md @cd5364d · docs/product/prd.md @503059c · docs/decisions/DECISION_JOURNAL.md D1–D7 @503059c

## Summary (one screen)
**Real ask (AIM-1, high):** Boostlingo is not buying an app. It wants a *defensible, measured opinion* on which
interpretation architecture to invest in for 12–18 months. The two modes are the measuring tool; the 1–2 page write-up
plus honest per-stage timing is the product. AIM-3 (high): how we directed the coding agent is graded too (agent doc,
git history).
**What we build:** one browser screen, EN↔ES. Mode A = OpenAI `gpt-realtime` voice-to-voice. Mode B = streaming
speech-to-text → translation → text-to-speech with a swappable vendor per stage. Live transcripts, per-stage timing on one
clock, failure handling, then a scored run of both modes on the same public FLEURS EN/ES clips → `docs/COMPARISON.md`.
**North Star (SC-001):** share of turns per mode that hit the delay target (≤1.5 s voice-to-voice, ≤3 s chain) with
word error rate ≤15 %. Guards: cost per minute against human Spanish interpreting at $0.47/min phone and $0.77/min video
(R05), and a translation quality score.
**Key research:** voice-to-voice ≈ $0.10/min of audio plus re-billed context (R01); chain stages cost $0.002–0.006/min
for speech-to-text plus per-character TTS (R02); Boostlingo already sells an "AI Interpreter" with a one-tap human handoff,
and its one open engineering role is AI features + evals + guardrails (R04).
**Scope cut:** M4 voice-to-voice tracer bullet → M5 chain + switching + vendor swap → M6 evaluation, 5-minute soak,
write-up. Not doing: other language pairs, accounts, multi-device calls, production hosting.

## Decided for you (Type 2, reversible)
| D | Decision | Why | Reopen? |
|---|---|---|---|
| D1 | Full track, one planning session | new graded product, no PRD | say "reopen D1" |
| D2 | Voice-to-voice first (tracer bullet) | proves mic, playback, timing with one vendor | say "reopen D2" |
| D3 | Detect which language is spoken; no direction button | natural turn-taking | say "reopen D3" |
| D4 | Gate delay on the median, always show p95 | stable on 40-turn samples | say "reopen D4" |
| D5 | Score on FLEURS EN/ES, ≥20 clips per direction | public, licensed, both directions | say "reopen D5" |
| D6 | Partner docs kept private, paraphrased | repo will be public | say "reopen D6" |
| D7 | Write-up at docs/COMPARISON.md | one findable page | say "reopen D7" |

## Your decisions (Type 1 and human-only questions)
### 1. Submission deadline?
Background: the PDF says "3–4 days"; the portal shows no due date. Human-only.
Recommended answer: Sun 2026-10-18 23:59 CT (4 days from kickoff). Default: that.

### 2. Vendor spend cap?
Background: voice-to-voice is ~$0.10/min before context re-billing, which can multiply it over a 5-minute session. Type 1 because it's money.
| Option | Cost | |
|---|---|---|
| A $30 total, fakes in all automated tests | ~2 h of live audio across both modes; enough for the demo, soak runs and a 40-clip × 2-mode evaluation | **recommended** |
| B $60 total | room to also measure the dedicated translate model and re-run evaluations | |
| C $15 total | evaluation shrinks to ~20 clips, few soak runs | |
| Do nothing | no live testing; benchmarks can't be measured | |
Default: A.

### 3. Which vendor accounts do you have, or will you open?
Background: OpenAI is required. For the chain, R02 found Deepgram and AssemblyAI signal end-of-speech server-side and only ElevenLabs documents streaming text into TTS. Opening accounts is yours.
Recommended answer: OpenAI (required) + Deepgram (free credit) + ElevenLabs (free tier); the final vendor choice is made at the Design check. Default: OpenAI only, and the chain uses OpenAI for all three stages.

### 4. Host it, or local-only?
Background: hosting is optional; AWS preferred if hosted. Type 1 (vendor + spend).
| Option | Cost | |
|---|---|---|
| A Local-only with clear setup steps; revisit after the write-up | zero hosting cost; graders run it locally | **recommended** |
| B AWS-hosted preview | needs your AWS account; ~2–3 h of the appetite; HTTPS needed for the mic | |
| C Railway (your usual host) | ~1 h; not the partner's preferred vendor | |
| Do nothing | same as A without setup docs: fails REQ-14 | |
Default: A. (The GT try-it check would run on localhost.)

### 5. Git history shape?
Background: the PDF penalizes dump commits. The factory squashes each task into one commit on the milestone branch.
Recommended answer: keep one meaningful commit per task, merge milestones into main with merge commits (no squash), so history reads as ~20–30 logical steps. Default: that.

### 6. May partner docs be quoted or committed?
Background: the project PDF and portal pages may be confidential; the repo will be public (U-01, U-02).
Recommended answer: No. Keep the originals private and paraphrase with section references. Default: No.

### 7. Also measure OpenAI's dedicated translate model?
Background: R01 found `gpt-realtime-translate`, a purpose-built interpreting model at a flat $0.034/min. The PDF mandates `gpt-realtime`, so it can only be a third measured option.
Recommended answer: yes, in M6, only if time and spend remain. It makes the write-up stronger ("the vendor's own interpreting model is 3× cheaper"). Default: skip.

### 8. May I add a "How the agent was directed" section to AGENTS.md at M6?
Background: REQ-15 requires AGENTS.md or CLAUDE.md to describe agent usage. Editing them is human-only under our rules.
Recommended answer: yes. I draft the section at M6 and you approve the diff. Default: I draft it in docs/AGENT_USAGE.md and link it from README.

### 9. When someone talks over a playing interpretation, cut it off?
Background: barge-in (PRD EC-3).
Recommended answer: yes, stop playback and interpret the new turn. Default: yes.

### 10. Is the language preference (.NET/C# + TypeScript) a mandate?
Background: the PDF says candidate's choice, *preferred* C#/.NET + TypeScript, Python acceptable, explain the choice (C-3). The stack itself is a Type 1 decision at the Design check.
Recommended answer: context only. Default: context only.

Also yours (no answer needed now): create the public GitLab repo + GitHub mirror before the first push (U-05).

## Skipped or reused
- audit-codebase: skipped, greenfield.
- Interviews inside project prompt review, sharpen-brief and write-prd: skipped under the v0.2 session rule; their questions are items 1–10 above.
- Research gaps (38 evidence gaps across R01–R06) are not questions for you; the ones that matter for design go to the Design check.

## Where each open question in the artifacts lands
`grep -c` lines: prompt review 8 · brief 18 · prd 6 = 32 lines (37 glyphs, all mapped below).

| Artifact line | Glyphs | Lands in |
|---|---|---|
| prompt-review.md:72 | ⚠ | 5 git history |
| prompt-review.md:74 | ⚠ | 2 spend cap |
| prompt-review.md:82 | ⚠ | 1 deadline |
| prompt-review.md:83 | ⚠ | 2 spend cap |
| prompt-review.md:84 | ⚠ | 3 vendor accounts |
| prompt-review.md:85 | ⚠ | 4 hosting |
| prompt-review.md:86 | ⚠ | 5 git history |
| prompt-review.md:99 | ⚠ | meta: says questions go to this card |
| brief.md:63 | ⚠ | answered by R01/R02/R03/R05 (research) |
| brief.md:64 | ⚠ | answered by R04 |
| brief.md:74 | ⚠ | answered by R01/R02/R03/R05 (research) |
| brief.md:76 | ⚠ | answered by R01/R02/R03/R05 (research) |
| brief.md:77 | ⚠ | answered by R01/R02/R03/R05 (research) |
| brief.md:86 | ⚠ | 1 deadline |
| brief.md:87 | ⚠ | 1 deadline |
| brief.md:91 | ⚠ | 1 deadline |
| brief.md:92 | ⚠ | 1 deadline |
| brief.md:93 | ⚠ | 1 deadline |
| brief.md:109 | ⚠⚠⚠ | D7 write-up path (decided for you) |
| brief.md:116 | ⚠⚠ | 8 agent-usage section |
| brief.md:123 | ⚠⚠ | 4 hosting |
| brief.md:133 | ⚠ | 6 partner docs |
| brief.md:134 | ⚠ | 6 partner docs |
| brief.md:139 | ⚠ | 1 deadline |
| brief.md:162 | ⚠ | answered by R04 |
| brief.md:180 | ⚠⚠ | meta: says questions go to this card |
| prd.md:66 | ⚠ | 1 deadline |
| prd.md:158 | ⚠ | 2 spend cap |
| prd.md:196 | ⚠ | 9 barge-in |
| prd.md:214 | ⚠ | 7 third model |
| prd.md:215 | ⚠ | 4 hosting |
| prd.md:253 | ⚠ | 10 language preference |

Reply in one message, e.g. `1 default 2A 3 "OpenAI+Deepgram" 4A 5-10 default`, or Revise / Stop.

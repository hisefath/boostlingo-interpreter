# GI card — M1 interpreter-tradeoffs
As of: 2026-10-14 23:58 CDT (revised after second prompt review) · Artifacts: specs/M1-interpreter-tradeoffs/prompt-review.md, specs/M1-interpreter-tradeoffs/brief.md @a1dbdf2 · docs/research/R01–R06 + sources.md @cd5364d · docs/product/prd.md @d607ae5 · second prompt review @6d428e5 · docs/decisions/DECISION_JOURNAL.md D1–D11 @37495f6

## Summary (one screen)
**what the partner is really evaluating (AIM-0, high, new):** *Can you tell when machine interpretation is safe to use, and
prove it with evals and guardrails?* Boostlingo already sells an AI Interpreter, and its own rule is "AI when it fits,
human when it counts": machine for routine calls (scheduling, check-in, enrollment), humans for clinical, legal and
high-stakes talk, with a one-tap handoff (R04 F6). Their one open engineering role asks for evals, guardrails,
cost-aware trade-offs and catching hallucination and prompt injection (R04 F9). So the workbench is an audition for that
job: the deliverable is a per-scenario recommendation backed by *where each mode fails*, not just which is faster.

**Most serious issue (I-14):** `gpt-realtime` is a general assistant. Asked "What do you recommend I take?" it may *answer* instead
of interpreting, add words, or obey "ignore your instructions" spoken by a participant. A 20-second demo never shows it.
Guard: FR-021 (never answer or obey) + scored adversarial clips per mode (FR-022, SC-005 hard gate).

**Other issues found in pass 2:** I-15 the vendor's "speech stopped" event fires after ~0.5 s of silence-wait, so a naive
stopwatch flatters both modes (we start at the true end of speech) · I-16 a clinic-diagnosis demo is the case Boostlingo
says needs a human (now routine calls) · I-17 averages hide flipped numbers and negations (critical-term scoring) · I-18
EN↔ES alone can't test the cascade's real business case, uncommon pairs (item 11) · I-19 the voice model re-bills the
whole call, so cost per minute rises with length (priced at 1, 5 and a projected 21 minutes) · I-20 streaming unsettled
Spanish partials speaks words that turn out wrong (settled segments only).

**What we build:** one browser screen, EN↔ES, two modes (OpenAI `gpt-realtime` voice-to-voice; streaming speech-to-text
→ translation → text-to-speech with a swappable vendor per stage), live transcripts, per-stage timing, failure handling,
then an eval of both modes on the same clips (delay, WER, translation score, faithfulness, critical terms, cost by call
length) → `docs/COMPARISON.md`: which mode fits which scenario, and where a human must take over.
**Milestones:** M4 voice-to-voice tracer bullet → M5 cascade + switching + vendor swap → M6 eval, 5-minute soak, write-up.

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
| D8 | Demo and eval use routine calls; a high-stakes set only shows failures | matches Boostlingo's own AI rule | say "reopen D8" |
| D9 | Score faithfulness and critical terms per mode | the failures the partner hires to catch | say "reopen D9" |
| D10 | Stopwatch starts at the true end of speech | the delay the listener feels | say "reopen D10" |
| D11 | Stream settled segments only; cost priced by call length | no wrong-then-unsaid audio; real-call cost | say "reopen D11" |

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

### 11. Add one less-common language pair as a timed onboarding exercise?
Background: the PDF names "uncommon language pairs" and "time to onboard a pair" as business levers; that is where the
cascade should beat the all-in-one model, and EN↔ES alone can't show it (I-18, AIM-4). Scope, not money.
| Option | Cost | |
|---|---|---|
| A Yes, one pair (picked at the Design check from vendor support), timeboxed to 2 h in M6 | ~2 h of the appetite; a measured "hours to onboard" number | **recommended** |
| B No, state the gap in the write-up | 0 h; the write-up can't answer the partner's differentiator | |
| Do nothing | same as B, unstated | |
Default: B.

Also yours (no answer needed now): create the public GitLab repo + GitHub mirror before the first push (U-05).

## Skipped or reused
- audit-codebase: skipped, greenfield.
- Interviews inside project prompt review, sharpen-brief and write-prd: skipped under the v0.2 session rule; their questions are items 1–10 above.
- Research gaps (38 evidence gaps across R01–R06) are not questions for you; the ones that matter for design go to the Design check.

## Where each open question in the artifacts lands
`grep -c` lines: prompt review 8 · brief 17 · prd 7 = 32 lines (37 glyphs, all mapped below).

| Artifact line | Glyphs | Lands in |
|---|---|---|
| prompt-review.md:81 | ⚠ | 5 git history |
| prompt-review.md:83 | ⚠ | 2 spend cap |
| prompt-review.md:99 | ⚠ | 1 deadline |
| prompt-review.md:100 | ⚠ | 2 spend cap |
| prompt-review.md:101 | ⚠ | 3 vendor accounts |
| prompt-review.md:102 | ⚠ | 4 hosting |
| prompt-review.md:103 | ⚠ | 5 git history |
| prompt-review.md:120 | ⚠ | meta: says questions go to this card |
| brief.md:64 | ⚠ | answered by research R01–R05 |
| brief.md:76 | ⚠ | answered by research R01–R05 |
| brief.md:78 | ⚠ | answered by research R01–R05 |
| brief.md:79 | ⚠ | answered by research R01–R05 |
| brief.md:88 | ⚠ | 1 deadline |
| brief.md:89 | ⚠ | 1 deadline |
| brief.md:93 | ⚠ | 1 deadline |
| brief.md:94 | ⚠ | 1 deadline |
| brief.md:95 | ⚠ | 1 deadline |
| brief.md:111 | ⚠⚠⚠ | D7 write-up path (decided) |
| brief.md:118 | ⚠⚠ | 8 agent-usage section |
| brief.md:125 | ⚠⚠ | 4 hosting |
| brief.md:135 | ⚠ | 6 partner docs |
| brief.md:136 | ⚠ | 6 partner docs |
| brief.md:141 | ⚠ | 1 deadline |
| brief.md:164 | ⚠ | answered by research R04 |
| brief.md:182 | ⚠⚠ | meta: says questions go to this card |
| prd.md:66 | ⚠ | 1 deadline |
| prd.md:163 | ⚠ | 2 spend cap |
| prd.md:209 | ⚠ | 9 barge-in |
| prd.md:228 | ⚠ | 11 uncommon pair |
| prd.md:229 | ⚠ | 2 spend cap |
| prd.md:230 | ⚠ | 4 hosting |
| prd.md:269 | ⚠ | 10 language preference |

Reply in one message, e.g. `1 default 2A 3 "OpenAI+Deepgram+ElevenLabs" 4A 5-10 default 11A`, or Revise / Stop.

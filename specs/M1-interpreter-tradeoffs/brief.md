---
milestone: M1
slug: interpreter-tradeoffs
artifact: brief
written_by: sharpen-brief (software-factory-kit 0.1)
written_at: 2026-10-14 23:21 CDT (UTC-0500)
assignment: Boostlingo project PDF "AI Interpreter Workbench: Realtime API vs. Cascade Pipeline" (held by the human); Gauntlet portal project brief page "AI Interpreter Workbench" v1, updated 10/12/2026; Gauntlet portal Boostlingo company panel
track_recommended: Full
track_decided_in: "G0 row in .handoff/TRACKER.md ## Approvals; this brief holds only the recommendation"
problem_allowlist: Boostlingo
gate: G0
---

# M1 brief: Boostlingo AI interpreter workbench

## Ask

> Boostlingo wants a working, measured comparison of two ways a machine can interpret live speech (one end-to-end
> voice model vs. a chain of three swappable stages), plus a short written recommendation of which fits which
> scenario and where each fails, within 3–4 days of work (prompt review AIM-0, AIM-1).

The human's original words: "open https://portal.gauntletai.com/projects, find the boostlingo project, scrape the company info and company project and read through the attachement … and lets start their project with our new ai workflow on the new branch"

## Problem

- (paraphrase, U-01) Live interpretation is Boostlingo's core product; the trade-offs between the two machine approaches on delay, quality, cost and control stay unclear until both are built (PDF §Problem Statement).
- (paraphrase, U-01) The choice will set cost per minute, the lowest achievable delay, dependence on one vendor, and quality on uncommon language pairs, and it steers 12–18 months of investment (PDF §Business Context).
- (paraphrase, U-02) For people in hospitals, courtrooms, schools and government offices, a language barrier is a crisis, with missed diagnoses and legal errors as real consequences (portal company panel, About).

**Restated, no solution or tech words:** Boostlingo's product and platform leaders must decide how machine
interpretation will be built for the next year and a half, but they have no side-by-side evidence of how the two
approaches behave on delay, quality, cost and control for the same conversation. Today they would decide from
vendor claims and intuition. A wrong pick locks them into a cost floor, a delay floor, or a single vendor, and shows
up later as slow or wrong interpretation for patients, defendants and students.

- **Who has it:** Boostlingo product and platform leadership; their engineers who will operate it; end users (a
  limited-English speaker and the provider they talk to).
- **What they do today instead:** human interpreters routed in seconds, plus early machine offerings judged on vendor claims.
- **Cost of doing nothing:** a 12–18 month investment made without measured evidence; risk of lock-in or an
  unusable delay in live conversations.

## Job stories

| ID | When… | I want… | so I can… | Who | Source |
|---|---|---|---|---|---|
| JS-01 | I speak English to someone who only speaks Spanish | to hear my words in Spanish soon after I stop, and the reverse | we hold a natural back-and-forth conversation | conversation participant | REQ-01, REQ-02, REQ-03, REQ-05 |
| JS-02 | I am judging which approach to fund | to see, for the same speech, how long each step took and the total delay | I can tell where time goes and which approach is faster | platform leader | REQ-07, REQ-17, REQ-18 |
| JS-03 | I am comparing approaches mid-conversation | to change approach without starting over | I can compare them on the same speaker and topic | evaluator | REQ-04 |
| JS-04 | I listen to an interpretation | to read what was heard and what was said back, as it happens | I can spot mistakes and judge quality | evaluator, participant | REQ-06 |
| JS-05 | a vendor raises prices, fails, or is weak on a language pair | to replace one step's vendor with a small, contained change | we avoid lock-in and onboard new pairs fast | platform engineer | REQ-09 |
| JS-06 | I must recommend an approach to leadership | a short evidence-backed comparison of delay, quality, cost and control with a per-scenario pick | the investment decision rests on measurements, not vendor claims | platform leader | REQ-08 |
| JS-07 | a vendor times out, rate-limits, returns nothing, or the microphone is blocked | to be told clearly what happened and keep going | a conversation never silently dies | participant | REQ-13 |

## Hiring partner

| Aspect | What we know | Source | What the project should show them |
|---|---|---|---|
| Who they are | SaaS, 51–200 people, engineering team 26–50; "Language Intelligence Platform" with human and machine interpretation and translation, 300+ languages, 24/7 | portal company panel (paraphrase, U-02) | that we understand their product and its real-time stakes |
| Customers | healthcare, federal/state government, legal, enterprises, universities | portal company panel | demo scenario from a clinic or court; compliance-aware design |
| Scale | thousands of concurrent sessions; ~13 s average interpreter routing; 17,000+ interpreters | portal company panel | instrumentation and a stability run that speak to scale |
| Compliance | HIPAA, SOC 2 Type II, GDPR | portal company panel | no long-lived keys in the browser, no audio stored by default |
| Stack | Postgres, SQL Server, Redis, AWS, Docker, CI/CD, SQS, LLM APIs, agents; PDF prefers C#/.NET backend + TypeScript frontend | portal company panel; PDF §Languages | a stack choice that matches theirs or explains why not (see REQ-20) |
| Working style | async remote-first; high autonomy and ambiguous problem solving (5/5); 3–4 interview rounds, no coding assessment; interview access Week 4 | portal company panel | a write-up and decision journal that defend each call |
| Business value | customers save ~20% on interpreting cost | portal company panel | cost per minute measured, compared with human interpreting ⚠ price (→ R05) |
| AI product (answered by R04 F6) | already sells an AI Interpreter: speech-to-speech, 23 languages, one-tap switch to a human; its own rule is machine for routine calls (scheduling, check-in, enrollment) and humans for clinical, legal and high-stakes talk | R04 F6 | scenarios that match their rule; a recommendation per scenario incl. when a human must take over (prompt review AIM-0) |
| Hiring (answered by R04 F9) | one open engineering role: own AI features, cost-aware trade-offs, evals and guardrails, anticipate hallucination, drift and prompt injection, write design docs | R04 F9 | an eval harness that measures failure modes (faithfulness, critical terms), not just speed |

## Value and metrics

- **Underlying problem in the business's terms:** (paraphrase, U-01) the partner's impact metrics are end-to-end
  latency in ms, cost per minute, interpretation quality (subjective + WER), provider flexibility, and time to onboard
  a new language pair (PDF §Key Impact Metrics; portal §Impact Metrics).

| ID | Candidate metric | Role | Actionable or vanity ("if bad, what would we fix?") | Leading or lagging | Data that would measure it |
|---|---|---|---|---|---|
| NS-01 | Share of interpreted turns that meet the mode's delay target (speech end → first translated audio), stay faithful (nothing answered, added or obeyed) and have acceptable quality, per mode | North Star | actionable: bad → the per-stage timeline shows which step to fix or which vendor to swap | lagging | per-turn timing log + quality scoring on a fixed test set ⚠ (→ R01, R03) |
| SM-01 | Median and p95 per-stage delay (hearing, translating, speaking, network) | explains NS-01 | actionable: points at the slow stage | leading | per-stage timestamps in each turn |
| SM-02 | Cost per conversation minute, per mode | guards NS-01 (fast but unaffordable is not a win) | actionable: change vendor/model | lagging | metered usage per session × vendor price ⚠ (→ R01, R02) |
| SM-03 | Source transcript word error rate and a target-side translation score | guards NS-01 (fast but wrong is not a win) | actionable: change the hearing or translating vendor | lagging | references from a public EN/ES test set ⚠ (→ R03) |
| SM-04 | Size of the change to swap one stage's vendor (files/lines touched) | explains provider flexibility | actionable: tighten the boundary | leading | git diff of the swap |

Vanity traps considered and rejected: total minutes interpreted (only rises; tells nothing to fix); number of
vendors integrated (more is not better; swap cost matters); average latency alone (hides the slow tail that ruins a conversation).

## Appetite and deadlines

- **Now:** 2026-10-14 23:21 CDT (UTC-0500)
- **Appetite:** 15–20 hours over 3–4 days, from the assignment (PDF §Time Constraints); the human has not stated their own ⚠ appetite? (→ G0)
- **Timebox:** 2026-10-15 → ⚠ end date (→ G0)

| Checkpoint | As written in the source | Local time (converted by date) | Source |
|---|---|---|---|
| Build | "3–4 days for the build (~15–20 hours total effort)" | ⚠ timezone? no calendar date given (→ G0) | PDF §Time Constraints |
| Submission | "Submit this project" on the portal page, no due date shown | ⚠ deadline? (→ G0) | portal project page |
| Partner interviews | interview access "Week 4" | ⚠ which date? (→ G0) | portal company panel |

## Spec is law

Sources read in full: PDF (2 pages, 7 sections); portal project brief page (7 sections); portal company panel.
Requirements extracted: 22. Second pass: no new rows.

| ID | Requirement (verbatim; uncleared source: `(paraphrase, U-##) <text>`) | Source | Deliverable (assignment's exact filename, or observable proof) | Owning phase / skill | Due | Status |
|---|---|---|---|---|---|---|
| REQ-01 | (paraphrase, U-01) browser single-page app with mic capture and audio playback | PDF FR1 | app loads in a browser, captures mic, plays audio | 9 implement-task | Submission | mapped |
| REQ-02 | (paraphrase, U-01) voice-to-voice mode using the OpenAI Realtime API, model gpt-realtime (mandated) | PDF FR2, §AI/ML | mode works voice in → voice out | 5 design-hld, 9 implement-task | Submission | mapped |
| REQ-03 | (paraphrase, U-01) cascade mode: speech-to-text → translation → text-to-speech with streaming; vendors are our choice | PDF FR3, §AI/ML | mode works with a streamed three-stage chain | 5 design-hld, 9 implement-task | Submission | mapped |
| REQ-04 | (paraphrase, U-01) toggle modes mid-session or pre-session | PDF FR4 | visible toggle that switches mode | 4 map-ux-flows, 9 | Submission | mapped |
| REQ-05 | (paraphrase, U-01) language pair selection, at least English ↔ Spanish | PDF FR5 | pair selector with EN↔ES | 4, 9 | Submission | mapped |
| REQ-06 | (paraphrase, U-01) live source and target transcripts as produced | PDF FR6 | two live transcript panes | 4, 9 | Submission | mapped |
| REQ-07 | (paraphrase, U-01) per-stage latency display visible to the user | PDF FR7, §Other | per-stage latency readout | 4, 5, 9 | Submission | mapped |
| REQ-08 | (paraphrase, U-01) 1–2 page comparison write-up: latency, quality, cost, controllability, per-scenario recommendation | PDF FR8 | ⚠ exact filename not specified; proposed `docs/COMPARISON.md` (→ G0) | 12 report-milestone (data) + ⚠ no owning skill for the write-up itself (→ G0) | Submission | ⚠ |
| REQ-09 | (paraphrase, U-01) provider abstractions so STT/translation/TTS vendors swap without rewriting | PDF §Other, §Code Quality | a vendor swap as a contained diff | 5, 6 design-lld, 9 | Submission | mapped |
| REQ-10 | (paraphrase, U-01) streaming throughout the cascade, no full-utterance blocking | PDF §Other | timeline shows overlapping stages | 7 define-acceptance, 9 | Submission | mapped |
| REQ-11 | (paraphrase, U-01) clean separation of mode-specific transport and mode-agnostic UI | PDF §Code Quality | code boundary visible in LLD and code | 6, 9 | Submission | mapped |
| REQ-12 | (paraphrase, U-01) targeted tests on the cascade pipeline and provider boundaries; critical paths tested | PDF §Code Quality | tests run in `make check` | 7, 9 | Submission | mapped |
| REQ-13 | (paraphrase, U-01) error handling for rate limits, timeouts, empty results, mic permission denied | PDF §Code Quality | each case shows a clear message and recovers | 4, 7, 9 | Submission | mapped |
| REQ-14 | (paraphrase, U-01) README with setup, run and architecture overview | PDF §Code Quality | `README.md` | 14 garden-docs | Submission | mapped |
| REQ-15 | (paraphrase, U-01) AGENTS.md or CLAUDE.md documenting how the coding agent was directed | PDF §Other, §Code Quality | `AGENTS.md` / `CLAUDE.md` + a "how I directed the agent" section ⚠ owner (→ G0) | 0 init-repo + 14 garden-docs | Submission | ⚠ |
| REQ-16 | (paraphrase, U-01) git history of logical units with meaningful messages, no single initial dump | PDF §Other, §Code Quality | `git log` on the submitted repo | 9 implement-task, §8 git | Submission | mapped |
| REQ-17 | (paraphrase, U-01) voice-to-voice mode under 1.5 s from speech end to first audio out | PDF §Performance | measured p50/p95 in the write-up | 7, 12 | Submission | mapped |
| REQ-18 | (paraphrase, U-01) cascade under 3 s, target under 2 s with full streaming | PDF §Performance | measured p50/p95 in the write-up | 7, 12 | Submission | mapped |
| REQ-19 | (paraphrase, U-01) 5-minute back-and-forth without disconnect, audio drift or memory leaks | PDF §Performance | soak run evidence | 7, 12 | Submission | mapped |
| REQ-20 | (paraphrase, U-01) language of choice (prefer C#/.NET backend, TypeScript frontend; Python acceptable), choice explained | PDF §Languages | decision record in `docs/decisions/` | 5 design-hld (Type 1 at GD) | Submission | mapped |
| REQ-21 | (paraphrase, U-01) agentic coding assistant required, not tab completion | PDF §Development Tools | process visible in commits + agent doc | all phases | Submission | mapped |
| REQ-22 | (paraphrase, U-01) deployment optional, AWS preferred if deployed; local with setup instructions is fine | PDF §Cloud | ⚠ deploy or local? (→ G0) | 13 ship-milestone (+ U-04) | Submission | ⚠ |

Conflicts between sources: none. The portal page restates the PDF in shorter form; it lists .NET, C#, TypeScript and
Python together as "required languages", where the PDF says candidate's choice with a preference; the PDF (official
attachment) wins.

## User-owned steps

| ID | Step | Why only the human | Due | Blocks |
|---|---|---|---|---|
| U-01 | May the brief quote the Boostlingo project PDF word for word, and may a copy be committed? ⚠ confidential? (→ G0) | partner document; the repo is public | GI | quoting in brief/PRD |
| U-02 | May the brief quote the portal company panel and project page word for word, and may a copy be committed? ⚠ confidential? (→ G0) | partner portal content | GI | quoting |
| U-03 | Provide vendor API keys in a git-ignored env file (OpenAI required; any cascade vendors chosen at GD) | their accounts and money | before /build-milestone | REQ-02, REQ-03 |
| U-04 | Set the API spend cap, and approve any deploy (AWS account if deploying) | spend and deploy are human-only | GI / before ship | REQ-22, testing volume |
| U-05 | Create the public GitLab repo + GitHub mirror and approve pushes | visibility and push are human-only | before first push | REQ-16 submission |
| U-06 | Try the app at GT (speak both directions, flip modes, run 5 minutes) | needs a human voice and judgment | GT | merge |
| U-07 | Submit on the portal ("Open Submission Interface") | their account | deadline ⚠ | submission |

## Track

**Recommended: Full**, because WORKFLOW.md §3: a new product with no PRD is the Full track, and a graded project is always Full.
Greenfield or brownfield: greenfield.
Track announced by the supervisor: Full (this session).
Existing PRD: none.

| Option | What you get | What it costs, in plain words | Fits this ask? |
|---|---|---|---|
| Full | Every phase from this brief to ship: PRD, UX, HLD, LLD, diagrams, acceptance, tasks, gates | about 3 sessions and 3 checkpoints from you; planning eats ~2–3 of the 15–20 hours | yes: new product, graded, must be defended |
| Standard | Starts from an existing PRD: design delta, acceptance, tasks, build | no PRD exists, so there is nothing to start from | no |
| Fix | One failing repro and the smallest fix | not a bug | no |
| Do nothing | No build; the time goes elsewhere | the partner project stays unsubmitted; no interview evidence | no |

## Research questions

| ID | Question | Decision it unblocks | Answered when | From |
|---|---|---|---|---|
| R01 | How does the mandated voice-to-voice service work end to end: connection options, short-lived client credentials, turn-detection events, which events mark speech end and first audio out, transcripts, pricing? | design-hld transport and trust boundary; latency measurement points; cost formula (REQ-02, REQ-17) | the vendor's own docs cited for each item | REQ-02, REQ-17, prompt review I-1, I-4 |
| R02 | Which streaming speech-to-text, translation and text-to-speech vendors handle EN↔ES with partial results, at what price and claimed delay, with endpointing and incremental text input? | design-hld vendor per stage + an alternate to prove swaps; cost formula (REQ-03, REQ-09) | each vendor's own docs/pricing cited | REQ-03, REQ-09, REQ-18 |
| R03 | How is interpretation quality measured credibly in a small study (WER, a translation score), and which public EN/ES test set has references? | PRD quality success measure; acceptance test set (SM-03) | Tier-A paper/dataset card for WER, one translation metric, one dataset | NS-01, SM-03, prompt review I-5 |
| R04 | Who is Boostlingo: products incl. machine interpretation, customers, stack, what roles they hire for? | hiring-partner lens; stack decision (REQ-20) | Boostlingo's own site/job posts cited | Hiring partner ⚠ |
| R05 | Market: who already offers machine live interpretation, to whom, at what price per minute vs human interpreting, and the ideal customer and market size? | write-up cost framing; NS-01 framing | vendor pages + one industry source; sizes as inference with formula | REQ-08, SM-02 |
| R06 | Usage: typical session length, peak hours, concurrency and load, share of Spanish in US interpretation demand? | stability target sizing; cost per session framing (REQ-19) | industry or vendor statistics cited | REQ-19 |

## Parking lot

| ID | Idea (verbatim) | Raised by | When | Need behind it |
|---|---|---|---|---|
| P-01 | "lets start their project with our new ai workflow on the new branch" | human | 2026-10-14 | process evidence (REQ-16, REQ-21) |
| P-02 | "a local benchmark harness that replays fixed audio clips through both modes for repeatable latency/WER" | agent (prompt review) | 2026-10-14 | JS-02, JS-06 |
| P-03 | "a browser-side direct connection for the voice-to-voice mode using short-lived session credentials" | agent (prompt review) | 2026-10-14 | JS-01, REQ-17 |

## Interview log

One question at a time, each with a recommendation; answers verbatim. Pass 1, 2026-10-14.

| Q# | Question | Recommended (and why) | Answer (verbatim) | Landed in |
|---|---|---|---|---|
| — | none: under the v0.2 session rule (WORKFLOW §4b) every open ⚠ goes into the GI batched card | — | skipped → ⚠ | GI card |

---
milestone: M1
reviewed: 2026-10-14 23:21 CDT (UTC-0500)
sources: [Boostlingo project PDF "AI Interpreter Workbench: Realtime API vs. Cascade Pipeline" (held by the human), Gauntlet portal project brief page "AI Interpreter Workbench" v1 updated 10/12/2026, Gauntlet portal Boostlingo company panel]
gate: GI
---

# Project prompt review: Boostlingo AI Interpreter Workbench

## Surface ask
Build a browser app that interprets live speech between English and Spanish in two ways: a single voice-to-voice
model, and a chain of three swappable stages (speech to text, translation, text to speech) that streams. Show both
transcripts and a per-stage latency readout live. Then write a 1–2 page comparison with a recommendation for which
architecture fits which scenario. The timebox is 3–4 days (15–20 hours).

| Req | Requirement (one line) | Source (page/section) |
|---|---|---|
| REQ-01 | Browser single-page app with mic capture and audio playback | PDF §Success Criteria FR1; portal §Functional |
| REQ-02 | Realtime mode on the vendor-mandated voice-to-voice model, voice in and voice out | PDF FR2, §AI/ML Frameworks |
| REQ-03 | Cascade mode: speech-to-text → translation → text-to-speech, streaming | PDF FR3 |
| REQ-04 | Switch modes before or during a session | PDF FR4 |
| REQ-05 | Language pair selection, at least English ↔ Spanish | PDF FR5 |
| REQ-06 | Live source and target transcripts as they are produced | PDF FR6 |
| REQ-07 | Per-stage latency visible to the user | PDF FR7, §Other |
| REQ-08 | Comparison write-up (1–2 pages): latency, quality, cost, controllability, recommendation | PDF FR8 |
| REQ-09 | Swappable providers per cascade stage; a swap is a contained change | PDF §Other, §Code Quality |
| REQ-10 | No stage waits for a full utterance before passing work on | PDF §Other |
| REQ-11 | Mode-specific transport cleanly separated from mode-agnostic UI | PDF §Code Quality |
| REQ-12 | Targeted tests on the pipeline and provider boundaries | PDF §Code Quality |
| REQ-13 | Handle provider failures: rate limits, timeouts, empty results, mic permission denied | PDF §Code Quality |
| REQ-14 | README with setup, run and architecture overview | PDF §Code Quality |
| REQ-15 | AGENTS.md or CLAUDE.md describing how the coding agent was directed | PDF §Other, §Code Quality |
| REQ-16 | Git history of logical, meaningful commits; no single dump | PDF §Other, §Code Quality |
| REQ-17 | Realtime under 1.5 s speech-end → first audio out | PDF §Performance |
| REQ-18 | Cascade under 3 s, target under 2 s | PDF §Performance |
| REQ-19 | Sustain 5 minutes of back-and-forth without disconnect, drift or leaks | PDF §Performance |
| REQ-20 | Explain the language choice (preferred C#/.NET backend + TypeScript frontend; Python acceptable) | PDF §Languages |
| REQ-21 | Agentic coding assistant used (not tab completion) | PDF §Development Tools |
| REQ-22 | Deployment optional; AWS preferred if deployed; local with clear setup is fine | PDF §Cloud |

## what the partner is really evaluating
| AIM | Hypothesis: what this project really tests | Evidence | Confidence |
|---|---|---|---|
| AIM-1 | Can the candidate form a **defensible, measured opinion** on an architecture choice Boostlingo will invest in for 12–18 months? The write-up and the instrumentation are the product; the two modes are the apparatus. | PDF Problem: "form a defensible opinion on when each architecture fits"; Business Context: choices "inform product and platform investment over the next 12–18 months"; impact metrics are all comparison metrics | high |
| AIM-2 | Can the candidate build **real-time, streaming, vendor-neutral** infrastructure the way Boostlingo's platform needs it (thousands of concurrent sessions, many vendors, compliance)? Provider swap cost and time-to-onboard a language pair are the business levers. | Company panel: real-time ops at scale, HIPAA/SOC 2, "provider flexibility" and "time-to-onboard a new language pair" as impact metrics; FR emphasis on abstractions and streaming | med |
| AIM-3 | Can the candidate **direct a coding agent** well and show it? The git history and AGENTS.md/CLAUDE.md are graded evidence of process, not just the app. | PDF requires an agentic assistant, "explain their choice", AGENTS.md "documenting how the candidate directed their coding agent", iterative git history | high |

**Recommended framing for the brief:** Build two instrumented interpretation paths over one shared UI, measured the
same way, so a 1–2 page recommendation on cost, latency, quality and control is backed by our own numbers, and show
the agent-directed process that produced it.

## What graders / the partner will look at first
1. The live demo: speak English, hear Spanish, see both transcripts and per-stage latency, flip modes.
2. The comparison write-up and whether its numbers come from our runs (latency, WER, cost per minute).
3. The code boundaries: provider interfaces, transport separation, a provider swap as a small diff.
4. README + AGENTS.md/CLAUDE.md + git history (process evidence).
5. Interview defense (Week 4 interview access): why this stack, why these providers, when each mode wins.

## Issues
| T | Issue | Why it's tempting | Cost if we fall in | Evidence | Guard (phase / skill / check) |
|---|---|---|---|---|---|
| I-1 | Latency measured differently per mode (e.g. from button release in one, server event in the other) | Each vendor emits different events; easiest to log whatever is handy | Write-up comparison is not apples to apples; AIM-1 fails | PDF defines "speech end → first audio out" for both | write-prd NFR defines one clock and one speech-end definition; design-hld names the timing points; define-acceptance checks them |
| I-2 | "Streaming" cascade that blocks at a stage boundary (full transcript, then full translation, then full audio) | Request/response provider calls are simpler | Misses the < 2 s target and an explicit requirement | PDF §Other "no full-utterance blocking" | define-acceptance: a test that fails if TTS starts only after the full translation; per-stage timeline shows overlap |
| I-3 | Stack chosen without reasons, or one that ignores the partner's stated preference | Pick whatever is fastest to type | Interview defense weak; REQ-20 unmet | PDF prefers C#/.NET + TypeScript; portal lists .NET/C#/TS/Python | Type 1 stack decision at GD with written tradeoffs (journal) |
| I-4 | Long-lived vendor key shipped to the browser | Browser-to-vendor connection is the shortest path to low latency | Key leak; partner is HIPAA/SOC 2 minded | Company panel compliance list; public repo | design-hld trust boundary (short-lived session credentials only); check-security |
| I-5 | Quality claimed by feel only | WER needs reference transcripts and a test set | "Quality (subjective + WER)" unmet; write-up unconvincing | PDF Key Impact Metrics | gather-evidence on WER method; define-acceptance: a fixed scripted evaluation set; report-milestone pastes numbers |
| I-6 | Cost per minute taken from price pages only, not from metered usage | Price pages are easy | Numbers wrong for real token/char usage | PDF metric "cost per minute" | design: per-session usage counters; write-up shows formula + measured usage |
| I-7 | 5-minute stability never tested (socket drops, audio drift, growing buffers) | Demos run 20 seconds | Benchmark unmet, found by graders | PDF §Performance stability | define-acceptance: a 5-minute soak run with memory/drift readings |
| I-8 | Echo: the translated voice from speakers is picked up by the mic and re-interpreted | Testing with headphones hides it | Feedback loop in the live demo | inherent to mic + playback in one browser | map-ux-flows (headphones guidance + echo handling); design-hld turn-taking |
| I-9 | Gold-plating: many providers, many languages, full AWS infra | Looks impressive | Blows the 15–20 h appetite | PDF time constraint; deploy optional | brief appetite; PRD non-goals; one provider per stage + one alternate only to prove the swap |
| I-10 | Deliverable gaps: the agent-usage doc, README architecture overview, write-up placed where graders don't look | Factory files feel like they cover it | Missing required items | PDF §Code Quality, FR8 | sharpen-brief REQ rows with exact paths; garden-docs before close |
| I-11 | Single "initial commit" or squashed history | Factory squashes per task | Explicitly penalized | PDF §Code Quality | factory: one commit per task on the milestone branch, merge (not squash) milestone to main ⚠ |
| I-12 | Error paths unhandled (rate limit, timeout, empty transcript, mic denied) | Happy path demo works | Explicit code-quality miss | PDF §Code Quality | define-acceptance edge-case list; fake-provider tests |
| I-13 | API spend runs away during testing (voice-to-voice minutes are expensive) | Lots of manual testing | Real money | inherent | ⚠ spend cap (→ GI); fakes in tests; usage meter |

Categories checked (each is a T row above or n/a with a reason): literal reading (I-1, I-5) · hidden grading
criteria (I-10, I-11) · unstated non-functional bar (I-4, I-7, I-8) · wrong stack / partner mismatch (I-3) · demo vs
depth (I-2, I-5) · deliverable gaps (I-10) · scope creep (I-9) · unverifiable success (I-5, I-6) · domain landmines
(I-8, I-4, I-13) · copying v1 / prior work: n/a, no prior build of this project exists.

## Open questions
- ⚠ What is the submission deadline and timezone? The portal and PDF give only "3–4 days"; no due date shows on the assignments page. (→ GI)
- ⚠ What API spend cap do you accept for this project (voice-to-voice minutes and cascade vendors)? (→ GI)
- ⚠ Which vendor accounts/keys do you already hold (OpenAI is required; any others)? (→ GI)
- ⚠ Deploy (AWS preferred) or local-only with setup instructions? (→ GI)
- ⚠ Factory squash-merges each task; does the history need to show finer steps than one commit per task? (→ GI)

## Research questions for gather-evidence
- R01: How does the mandated voice-to-voice API work end to end (transport options, session credentials, turn detection events, which event marks speech end and first audio out, pricing)?
- R02: Which streaming speech-to-text, translation and text-to-speech vendors support EN↔ES with partial results, and what do they cost and claim for latency?
- R03: How is interpretation quality measured credibly in a small study (WER for source transcripts; a target-side measure for translation)?
- R04: Who is Boostlingo (product, customers, stack, AI interpretation offering) and what do they hire for?
- R05: Market: who already offers AI interpretation, to whom, at what price per minute, and where do customers cluster?
- R06: Usage: when and how much is interpretation used (session length, peak hours, concurrency) — sizing the stability and cost story?

## Interview log
| Q | Question | Recommended | Human's answer (verbatim) |
|---|---|---|---|
| — | none this pass: under the v0.2 session rule (WORKFLOW §4b) the open ⚠ go to the GI batched card | — | — |

## Parking lot
- "lets start their project with our new ai workflow on the new branch" (human, 2026-10-14)
- Candidate idea (agent): a local benchmark harness that replays fixed audio clips through both modes for repeatable latency/WER.
- Candidate idea (agent): a browser-side direct connection for the voice-to-voice mode using short-lived session credentials.

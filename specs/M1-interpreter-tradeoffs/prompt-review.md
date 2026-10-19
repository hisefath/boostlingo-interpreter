---
milestone: M1
reviewed: 2026-10-14 23:21 CDT (UTC-0500); revised 2026-10-14 23:54 CDT and 2026-10-18
sources: [Boostlingo project PDF "AI Interpreter Workbench: Realtime API vs. Cascade Pipeline" (held by the human), Gauntlet portal project brief page "AI Interpreter Workbench" v1 updated 10/12/2026, Gauntlet portal Boostlingo company panel]
checkpoint: GI
---

# Project prompt review: Boostlingo AI Interpreter Workbench

We reviewed the project prompt, the portal pages and the partner research and found the issues below. We document
them here and keep them in view for the rest of the project; each names where it is checked.

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

## What the partner is really evaluating
question, try to find it first"): re-read against the partner's **own live product and hiring page** (R04 F6, F9),
not just the prompt. AIM-0 and AIM-4 are new; AIM-0 now leads.

| AIM | Hypothesis: what this project really tests | Evidence | Confidence |
|---|---|---|---|
| AIM-0 | **Can the candidate tell *when* machine interpretation is safe to use, and prove it with evals and guardrails?** Boostlingo already ships an AI interpreter whose own rule is AI for routine calls, a human for clinical, legal and high-stakes talk, with a one-tap handoff. The open Engineer II role asks for evals, guardrails and anticipating AI failure modes (hallucination, drift, prompt injection) plus cost-aware trade-offs. The workbench is an audition for that job: the per-scenario recommendation is the product, and "where does each mode fail, and how would we catch it" is the core of it. | R04 F6 (AI Interpreter page: routine vs high-stakes, human handoff); R04 F9 (Engineer II: evals, guardrails, failure modes, cost-aware trade-offs, design docs); PDF asks "which fits which use case" | high |
| AIM-1 | Can the candidate form a **defensible, measured opinion** on an architecture choice Boostlingo will invest in for 12–18 months? The write-up and the instrumentation are the product; the two modes are the apparatus. | PDF Problem: "form a defensible opinion on when each architecture fits"; Business Context: 12–18 months of investment; impact metrics are all comparison metrics | high |
| AIM-4 | **Uncommon language pairs and vendor control are the reason the cascade exists.** The PDF names "differentiated quality on uncommon language pairs", vendor lock-in and "time-to-onboard a new language pair" as levers; an EN↔ES-only study cannot speak to them, and EN↔ES is the pair where the all-in-one model is strongest. | PDF Business Context + Key Impact Metrics; R04 F6 (their AI interpreter covers 23 languages vs 300+ human) | med |
| AIM-2 | Can the candidate build **real-time, streaming, vendor-neutral** infrastructure the way Boostlingo's platform needs it? | Company panel: real-time ops at scale, HIPAA/SOC 2; FR emphasis on abstractions and streaming | med |
| AIM-3 | Can the candidate **direct a coding agent** well and show it? The git history and AGENTS.md/CLAUDE.md are graded evidence of process. | PDF requires an agentic assistant, agent-usage doc, iterative history | high |

**Recommended framing for the brief:** Build two instrumented interpretation paths over one shared screen and an
eval harness that measures not just delay and cost but **where each one fails** (answering instead of interpreting,
dropped negations and numbers, unsupported pairs), so the write-up can say, in Boostlingo's own terms, which
architecture fits which scenario and when a human must take over.

## What graders / the partner will look at first
0. Whether the recommendation matches how Boostlingo already sells AI ("AI when it fits, human when it counts") and
   is backed by an eval that shows each mode's failure modes, not just its speed.
1. The live demo: speak English, hear Spanish, see both transcripts and per-stage latency, flip modes.
2. The comparison write-up and whether its numbers come from our runs (latency, WER, cost per minute).
3. The code boundaries: provider interfaces, transport separation, a provider swap as a small diff.
4. README + AGENTS.md/CLAUDE.md + git history (process evidence).
5. Interview defense (Week 4 interview access): why this stack, why these providers, when each mode wins.

## Issues found
| I | Issue | Why it is easy to miss | Cost if missed | Evidence | Where we check it |
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

| I-14 | **Most serious.** The voice-to-voice model is a general assistant: asked "Where does it hurt?" or "What should I take for this?", it may *answer* instead of interpreting, add words, or obey "ignore your instructions" spoken by a participant | the mandated model is conversational; a one-line "translate only" instruction looks enough in a 20-second demo | an interpreter that speaks for itself is disqualifying in clinic or court; it is exactly the hallucination/injection failure the Engineer II role names | R01 gap 6 (gpt-realtime may answer instead of translating); R04 F9 | write-prd [Unwanted] FR (never answers, never follows spoken instructions); define-acceptance adversarial clips (questions to the interpreter, spoken injections) scored as a faithfulness rate per mode |
| I-15 | Delay stopwatch started at the vendor's "speech stopped" event, which fires only after its silence wait (default ~500 ms), so the measured delay hides time the listener actually waits | the event is right there in the stream | numbers look ~0.5 s better than reality; the 1.5 s claim is not defensible | R01 F6 (server VAD, speech_stopped carries audio_end_ms) | write-prd NFR: clock starts at the true end of speech; design-hld reports turn-detection wait as its own stage |
| I-16 | The demo and evaluation use high-stakes clinical talk, the very case Boostlingo says needs a human | clinic examples feel impressive and on-brand | the recommendation contradicts the partner's own product rule; looks naive | R04 F6 | write-prd: demo and eval scenarios are routine (scheduling, check-in, enrollment); one high-stakes set is used only to show where machine output fails |
| I-17 | Average WER/BLEU hides the errors that matter: numbers, dates, dosages, names, negation ("no allergies") | averages are what the tools print | a mode that flips "no" to "yes" can still score 90 %+ | R03 (WER/BLEU are corpus averages); domain | define-acceptance: a critical-terms set scored exact-match per mode |
| I-18 | Only EN↔ES measured, so "uncommon pairs" and "time to onboard a pair" go unanswered | the PDF minimum is EN↔ES | the cascade's main business case is never tested; write-up has a hole where the partner's differentiator sits | PDF Business Context, Key Impact Metrics; AIM-4 | GI decision: add one less-common pair as a timed onboarding exercise, or state the gap explicitly in the write-up |
| I-19 | Cost per minute measured on short turns; the voice model re-bills the whole conversation on every response, so long calls cost more per minute | short tests are cheap | cost claim wrong for the 21-minute calls Boostlingo actually runs | R01 I3 (context re-billing); R06 (avg call ~21 min) | write-prd: cost reported vs session length from the 5-minute soak, extrapolated to 21 minutes with the formula shown |
| I-20 | Streaming translation of unstable partial transcripts (Spanish verbs and negation often come late) speaks words that later turn out wrong | "streaming throughout" sounds like "translate every partial" | low delay bought with wrong audio that cannot be unsaid | REQ-10; domain | design-hld commit policy (translate only stable segments); eval counts spoken-then-wrong segments |
| I-21 | **Fair comparison.** The voice-to-voice mode has no observable internal stages, yet the prompt asks for per-stage latency in both modes | the display spec reads as symmetric | invented stage numbers for a black box; the comparison is not defensible | PDF FR7; R01 (only speech-stopped, transcript and audio events are exposed) | write-prd: show only observable timing points in that mode, label the rest "not observable"; the write-up states it as a controllability finding |
| I-22 | **Fair comparison.** In voice-to-voice mode the live source transcript comes from a separate, asynchronous transcription model, "a rough guide" to what the main model heard; and WER measures recognition, not translation | WER is the quality metric the prompt names | scores a side model, then calls one mode better | R01 (OpenAI docs on input transcription); PDF Key Impact Metrics | write-prd: score both modes' spoken output the same way (one independent recogniser vs reference translations); WER only where a real recognition stage exists |
| I-23 | **Fair comparison.** "Speech end → first audio out" rewards starting to talk, not finishing correctly | it is the one benchmark the prompt defines | a mode wins on onset and loses on the whole sentence | PDF §Performance | write-prd: also report speech end → end of interpreted audio |
| I-24 | The prompt states the expected conclusion (less control and lower latency vs more control and more moving parts) | repeating it reads as agreement | the write-up confirms instead of testing | PDF Business Context | write-up tests it with concrete control points (glossary, voice, redaction, per-stage logs, per-pair vendor) |
| I-25 | Mid-session mode switch: conversation history lives at the vendor in one mode and in our app in the other | the toggle looks like a UI switch | the new mode loses context on switch | PDF FR4 | write-prd: the workbench owns history and hands recent turns to the new mode |

Areas checked (each is an I row above or n/a with a reason): literal reading (I-1, I-5) · hidden grading
criteria (I-10, I-11) · unstated non-functional bar (I-4, I-7, I-8) · wrong stack / partner mismatch (I-3) · demo vs
depth (I-2, I-5) · deliverable gaps (I-10) · scope creep (I-9) · unverifiable success (I-5, I-6) · domain landmines
(I-8, I-4, I-13, I-14, I-17, I-20) · hidden grading criteria also I-16, I-18 · copying v1 / prior work: n/a, no prior build of this project exists.

## Open questions
- ⚠ What is the submission deadline and timezone? The portal and PDF give only "3–4 days"; no due date shows on the assignments page. (→ GI)
- ⚠ What API spend cap do you accept for this project (voice-to-voice minutes and cascade vendors)? (→ GI)
- ⚠ Which vendor accounts/keys do you already hold (OpenAI is required; any others)? (→ GI)
- ⚠ Deploy (AWS preferred) or local-only with setup instructions? (→ GI)
- ⚠ Factory squash-merges each task; does the history need to show finer steps than one commit per task? (→ GI)

## Research questions
- R01: How does the mandated voice-to-voice API work end to end (transport options, session credentials, turn detection events, which event marks speech end and first audio out, pricing)?
- R02: Which streaming speech-to-text, translation and text-to-speech vendors support EN↔ES with partial results, and what do they cost and claim for latency?
- R03: How is interpretation quality measured credibly in a small study (WER for source transcripts; a target-side measure for translation)?
- R04: Who is Boostlingo (product, customers, stack, AI interpretation offering) and what do they hire for?
- R05: Market: who already offers AI interpretation, to whom, at what price per minute, and where do customers cluster?
- R06: Usage: when and how much is interpretation used (session length, peak hours, concurrency) — sizing the stability and cost story?

Research questions answered since pass 1: R01–R06 (`docs/research/`). New research questions: none; I-14 and I-20
are settled by our own eval, not by more reading.

## Interview log
| Q | Question | Recommended | Human's answer (verbatim) |
|---|---|---|---|
| — | none this pass: under the v0.2 session rule (WORKFLOW §4b) the open ⚠ go to the GI batched card | — | — |

## Parking lot
- "lets start their project with our new ai workflow on the new branch" (human, 2026-10-14)
- Candidate idea (agent): a local benchmark harness that replays fixed audio clips through both modes for repeatable latency/WER.
- Candidate idea (agent): a browser-side direct connection for the voice-to-voice mode using short-lived session credentials.

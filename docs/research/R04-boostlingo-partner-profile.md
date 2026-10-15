---
id: R04
question: "Who is Boostlingo: products (incl. any AI interpretation/translation product, e.g. \"Boostlingo AI Pro\"), customers, tech stack (job posts: .NET/C#? TypeScript?), and what engineering roles they hire for."
asked_in: specs/M1-interpreter-tradeoffs/prompt-review.md#research-questions-for-gather-evidence
unblocks: "hiring-partner lens, stack Type 1 decision"
answered_when: "Boostlingo's own site/job posts cited"
status: answered
confidence: high
supersedes: none
date: 2026-10-14
budget: 12/15 tool calls
researched_by: claude-code, claude-opus-5-5
---

# R04 Who Boostlingo is, what it sells, its stack and its hiring

## Answer

Boostlingo is an Austin-based language-access SaaS company (founded 2016) that sells human phone/video interpreting,
an interpretation management system, and AI products: an "AI Interpreter" (speech-to-speech, 23 languages, one-tap
handoff to a human) and "Boostlingo AI Pro" (transcription, live translation, captions), to healthcare, government,
legal, education and enterprise buyers. Its stated stack is Postgres, SQL Server, Redis, AWS, Docker, SQS and LLM
APIs; the project PDF names a preferred C#/.NET backend with a TypeScript frontend, but no public job post names a
language. Its one open engineering role (Engineer II) is about owning AI features through an agentic framework,
evals and guardrails. Confidence: high, because every load-bearing claim comes from Boostlingo's own material.
(S04.1, S04.2, S04.4, S04.6, S04.9)

## Takeaway

Boostlingo already sells both human interpreters and an AI interpreter with a human fallback, so they want someone
who can say, with numbers, when the AI path is good enough and when it is not.

## Findings

- **F1** [LB] Boostlingo describes itself as an all-in-one "Language Intelligence Platform" with human and AI interpretation plus AI translation, 300+ languages, 24/7, serving healthcare, federal/state government, legal, enterprises and universities — S04.1 (A), company panel
- **F2** [LB] It claims to route interpreter calls in about 13 s on average and to run phone, video and AI translation across thousands of concurrent sessions, with 17,000+ interpreters and ~20% customer savings — S04.1 (A), company panel; the homepage also states 13 s and ~20% — S04.2 (A), "Why choose" section
- **F3** [LB] Stated stack: Postgres, SQL Server, Redis, AWS, Docker, CI/CD, SQS, LLM APIs, agents; mixed greenfield/legacy; integrations with Zoom, Teams, Webex, QuickBooks, Stripe — S04.1 (A), company panel
- **F4** [LB] Compliance claims: HIPAA, SOC 2 Type II, GDPR; company of 51–200 people with a 26–50 person engineering team, async remote-first, 3–4 interview rounds with no coding assessment — S04.1 (A), company panel; homepage adds SOC 2 Type II, HIPAA, JCAHO — S04.2 (A), footer and compliance section
- **F5** [LB] Product lines on the site: interpreter services (OPI, VRI, AI Interpreter, ASL, medical), an Interpretation Management System (scheduling, billing, rate management, reporting), multilingual events (remote simultaneous interpreting, AI Live Translation), translation, AI speech translation captions, Boostlingo AI Pro (transcription, live translation, captioning on iOS/Android), Boostlingo Hub (backup interpreter network), Language Identification; segments include LSPs, healthcare, legal, government, education, insurance, finance — S04.2 (A), homepage navigation
- **F6** [LB] AI Interpreter: real-time speech-to-speech inside Boostlingo On-Demand on web, mobile and IVR; 23 languages for AI interpreting, 56 for auto-detection; recommended for routine scheduling, check-ins, enrollment and high-volume customer interactions, with humans recommended for clinical, legal and high-stakes talk; one-tap switch to a human mid-conversation; admin rollover rules; tagline "AI When It Fits. Human When It Counts." — S04.6 (A), product page and FAQ
- **F7** Founded 2016 in San Francisco; moved to Austin, TX in 2021 — S04.5 (A), About page
- **F8** [LB] The Greenhouse board lists two open roles on 2026-10-14: Engineer II (Engineering, United States) and Account Executive, SMB (Sales) — S04.3 (A), board listing
- **F9** [LB] Engineer II asks the hire to own a feature area, make cost-aware trade-offs, use and improve the company's "agentic framework" (prompts, configs, workflows, guardrails), anticipate AI failure modes (hallucination, drift, prompt injection), strengthen automated testing ("Gate (automated agentic testing)", eval and safety infrastructure) and write design docs; it names no programming language — S04.4 (A), job description
- **F10** Pricing is a subscription quoted on request; no per-minute rates are published — S04.7 (A), pricing page
- **F11** Public GitHub repos are mobile SDKs in Kotlin (Android) and Swift (iOS) plus two Keycloak forks in Java — S04.8 (A), organization page
- **F12** [LB] The Boostlingo project PDF prefers a C#/.NET backend and TypeScript frontend, with Python acceptable — S04.9 (A), prompt review REQ-20 citing PDF §Languages

## Inferences

- **I1** from F1 + F5 + F6: the project's two modes mirror a product decision Boostlingo has already shipped once (AI speech-to-speech with human escalation), so the write-up's "which scenario fits which architecture" maps onto their own routine-vs-high-stakes split. Fairly sure; not stated by any single source.
- **I2** from F3 + F11 + F12: SQL Server plus the PDF's stated .NET preference makes a .NET backend likely in parts of their platform, while mobile SDKs are native; this is a reading of signals, not a confirmed production stack. Medium confidence.
- **I3** from F2 + F3: the platform-scale session claim with SQS and Redis implies a queue-and-cache style real-time platform; the project itself runs one session, so this is context for the interview story, not a load target. Medium confidence.
- **I4** from F8 + F9: the engineering hiring signal is AI-feature ownership with evals and guardrails rather than a language specialism, which matches the prompt review's AIM-1 (measured opinion) and AIM-3 (directing a coding agent). Fairly sure.

## Gaps

- ⚠ Which language and framework does Boostlingo's production backend and web frontend actually use? — why: no Tier-A source found; the Engineer II post names none and the "Full Stack Engineer - Discovery" copy was unread (https://swooped.co/job-postings/full-stack-engineer-discovery-remote-boostlingo-65a49, 403) — would close it: ask the partner in the Week 4 interview, or read a current Boostlingo full-stack posting
- ⚠ Interpreter count conflicts: homepage says 10K, the AI Interpreter page and panel say 17,000+; response time shows 5 s and 13 s on the homepage — why: sources conflict (S04.2 vs S04.6, S04.1) — would close it: ask the partner which figure is current
- ⚠ What vendor or model powers the AI Interpreter, and when did it launch? — why: no Tier-A source found (page gives neither) — would close it: ask the partner
- ⚠ The Engineer II application page contained text addressed to AI agents (an instruction about the salary field) — why: page text addressed agents and was ignored — would close it: nothing; recorded for transparency

## Handoffs

- write-prd: Should the write-up frame its recommendation against Boostlingo's own "AI for routine, human for high-stakes" split and one-tap human fallback? — rests on F6, I1
- design-hld: Given the PDF's C#/.NET + TypeScript preference and the partner's SQL Server/AWS signals, which backend language does the Type 1 stack decision pick, and what is the written tradeoff against Python? — rests on F3, F12, I2
- write-prd: Should "provider swap is a small diff" and evals/guardrails be stated success measures, given the Engineer II role's emphasis? — rests on F9, I4

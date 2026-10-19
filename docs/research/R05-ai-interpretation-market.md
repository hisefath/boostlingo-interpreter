---
id: R05
question: "Market: who already offers AI (machine) live interpretation (e.g. Boostlingo AI, Wordly, KUDO AI, Interprefy, Microsoft/Google speech translation), to which customers, at what price per minute vs human interpreters (~$/min for VRI/OPI), and market size for language services/interpreting."
asked_in: specs/M1-interpreter-tradeoffs/prompt-review.md#research-questions
unblocks: "write-up's cost framing and the North Star"
answered_when: "not stated in the prompt review; supervisor task 2026-10-14 asks: show inference working (Formula/Assumptions/Range) for any size; taken as: competitors, human and AI per-minute prices, and market size each cited"
status: partial
confidence: medium
supersedes: none
date: 2026-10-14
budget: 14/15 tool calls
researched_by: claude-code, claude-opus-5-5
---

# R05 Who sells AI interpretation, at what price, and how big the market is

## Answer

AI live interpretation is already sold by Boostlingo itself (AI Interpreter, for routine one-to-one calls), and by
Wordly and KUDO AI (for meetings, events and webinars). None of them publish a per-minute AI price; Wordly's
one public figure works out to about $2.50 per session-minute for a one-to-many event. Human interpreting on a 2025
US state contract costs $0.47/min for Spanish by phone (OPI) and $0.77/min by video (VRI). Nimdzi puts the whole
language industry at USD 72.6B in 2025; interpreting is roughly a third of the top-100 vendors' revenue, so an
inferred USD 15–29B interpreting market. Confidence: medium, because human prices are Tier A but no AI per-minute
price and only one market-size source (Tier B) were found. (S05.1, S05.2, S05.3, S05.4, S05.5, S04.6)

## Takeaway

A human Spanish phone interpreter costs about 47 cents a minute on a government contract, so any AI interpreter
has to beat that on cost while staying good enough for routine conversations.

## Findings

- **F1** [LB] Arkansas statewide contract (Linguistica, pricing dated 2025-07-29): OPI Spanish $0.47/min, other listed and unlisted languages $0.53/min; VRI Spanish $0.77/min, ASL VRI $1.50/min; same rates on weekends — S05.1 (A), OPI and VRI rate tables
- **F2** [LB] Boostlingo sells an AI Interpreter (speech-to-speech, 23 languages) aimed at routine scheduling, check-ins, enrollment and high-volume customer interactions, with one-tap human escalation; its pricing page publishes no per-minute rates — S04.6 (A), product page; S04.7 (A)
- **F3** [LB] Wordly sells AI real-time translation and captions for meetings and events (Zoom, Teams, Meet, Webex, in-person), to businesses, associations, governments, education and houses of worship; it claims 5,000 customers in 120 countries, 6 million users, 1 billion translation minutes and "up to 90%" savings vs human interpreters — S05.3 (A, for what Wordly claims), homepage
- **F4** [LB] Wordly sells annual hour packages (10, 25, 50, 100, 250, 500+ hours); only the 10-hour Starter is priced, at "about $1,500"; volume discounts 10–30% — S05.2 (A), pricing table
- **F5** [LB] KUDO offers KUDO AI (70+ languages) pay-as-you-go or annual, "Human and/or AI", aimed at webinars, live events, worship services, council meetings, all-hands and training; prices are quote-only — S05.4 (A), pricing page
- **F6** [LB] Nimdzi estimates the language industry at USD 72.6B in 2025, USD 73.4B in 2026, under 1% CAGR after, USD 76.1B by 2030 (optimistic model higher); the top 100 vendors are 19.8% of the industry — S05.5 (B), Market Sizing
- **F7** [LB] Interpreting is 33.6% of top-100 vendor revenues in 2025 — S05.5 (B), Nimdzi 100 2026
- **F8** Nimdzi: machine interpreting "keeps finding new market opportunities where human services are unaffordable" and takes over standardized or emergency-driven tasks, while high-stakes interpreting stays human — S05.5 (B), outlook section
- **F9** Azure Speech bills speech translation and its Live Interpreter per audio hour (plus per-character text output); the dollar figures did not render on the page — S02.10 (A), speech translation rows

## Inferences

- **I1** from F6 + F7: interpreting market size. Formula: 72.6B USD (2025) × interpreting share = result. Assumptions: A-1 the whole industry splits like the top 100 (33.6%); A-2 the low case assumes interpreting is a smaller share outside the top 100 (20%); A-3 the high case assumes 40%. Range: low 15B – high 29B USD (2025), base 24B. Rests on one Tier-B source; not stated by Nimdzi.
- **I2** from F4: Wordly effective rate. Formula: 1,500 USD ÷ (10 h × 60 min) = 2.50 USD per session-minute. Assumptions: A-1 the "about $1,500" Starter price; A-2 one session-minute serves any number of listeners. Range: low 1.75 (30% volume discount) – high 2.50 USD/min, base 2.50. Not comparable one-for-one with F1, which is one interpreter for one conversation.
- **I3** from F1: human cost per typical session. Formula: OPI Spanish 0.47 USD/min × session minutes; with R06's 21-minute average call this is about 9.90 USD per call. Assumptions: A-1 contract price is representative of US public-sector OPI; A-2 session length from R06 F1 (a Canadian primary-care sample). Range: low 0.47 × 10 = 4.70 – high 0.77 (VRI) × 21 = 16 USD per session, base 9.90.
- **I4** from F2 + F3 + F5 + F8: the existing AI products split into two shapes: one-to-many event captioning/translation (Wordly, KUDO) and one-to-one routine conversations with human fallback (Boostlingo). The project's two-way EN↔ES conversation is the second shape. Fairly sure.

## Gaps

- ⚠ [LB] What does AI live interpretation cost per minute at list price (Boostlingo AI, KUDO AI, Interprefy, Azure, Google)? — why: every vendor read is quote-only or the figures did not render (S02.10); Interprefy's AI page was a 404 — would close it: R01/R02 vendor API prices (measured cost per minute from our own runs), or ask the partner for AI Interpreter pricing
- ⚠ [LB] Is the interpreting market size confirmed by a second independent source? — why: only one Tier-B source read (Nimdzi); CSA Research not read — would close it: read CSA Research's latest market figure, or option: run anthropic-skills:deep-research for this question
- ⚠ Are other states' or federal (GSA) OPI/VRI rates in the same range as Arkansas? — why: cap reached; Vermont's contract page returned 403, Washington and Iowa contracts were only search snippets — would close it: read the Washington NASPO 09821 pricing sheets
- ⚠ Microsoft and Google speech translation offerings and prices were not read in full — why: cap reached; Azure page masked prices — would close it: R02 vendor research
- ⚠ Where do customers cluster? — why: not researched this pass (out of the supervisor's R05 scope) — would close it: ACS language tables by state

## Handoffs

- write-prd: Should the North Star be "cost per interpreted minute vs a human OPI benchmark of $0.47/min (Spanish, 2025)" with latency and quality floors? — rests on F1, I3
- write-prd: Should the write-up position the cascade and realtime modes against the one-to-one routine-conversation segment (Boostlingo AI Interpreter's), not one-to-many events? — rests on F2, I4
- write-prd: Is a market-size line needed in the write-up at all, given it rests on a single Tier-B source? — rests on I1

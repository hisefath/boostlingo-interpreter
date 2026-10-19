---
id: R06
question: "Usage: typical interpretation session length (OPI/VRI average minutes), peak hours, concurrency, share of Spanish among US interpretation requests."
asked_in: specs/M1-interpreter-tradeoffs/prompt-review.md#research-questions
unblocks: "stability target and cost-per-session framing"
answered_when: "not stated in the prompt review or supervisor task; taken as: a cited average session length, peak-hour pattern, concurrency figure and US Spanish share"
status: partial
confidence: medium
supersedes: none
date: 2026-10-14
budget: 15/15 tool calls
researched_by: claude-code, claude-opus-5-5
---

# R06 How long, when and in which language interpretation sessions run

## Answer

A published phone-interpreting dataset (23,484 calls, British Columbia family physicians) reports a 21-minute
average call, ranging from 1 to 266 minutes, with most calls under 20 minutes; a US clinic study reports 47.7
minutes of interpreter time per in-clinic encounter. So the project's 5-minute stability bar is well short of a
real call. Spanish is the "most requested language" on a 2025 US state contract and 72% of one US clinic sample,
but a national US Spanish share, peak hours and per-customer concurrency were not found; Boostlingo itself claims
"thousands of concurrent sessions". Confidence: medium, because session length rests on one Tier-B study per
setting and the national Spanish share, peak hours and concurrency stay open. (S06.1, S06.2, S05.1, S04.1)

## Takeaway

A real interpreted phone call averages about 20 minutes, so a demo that stays stable for 5 minutes proves the
basics but not a full call.

## Findings

- **F1** [LB] BC province-wide telephone interpretation service, 2017–2020: 23,484 interpreted calls; average call 21 minutes (range 1 to 266); most calls under 20 minutes; Spanish was 10.5% of calls in that Canadian sample — S06.1 (B), abstract, Results and Discussion
- **F2** [LB] US primary-care study (338 LEP patients, 2024): mean interpreter time 91.1 min per patient, of which 47.7 min during the clinical encounter and 43.8 min auxiliary; 43% of interpretation was remote audio-only; recorded durations cluster at 30, 45 and 60 minutes (rounding) — S06.2 (B), Results, Descriptive Analyses; Table 1
- **F3** 72% of that study's respondents preferred Spanish (one site, not national) — S06.2 (B), Table 1
- **F4** [LB] A 2025 Arkansas statewide contract names Spanish as "the most requested language" for both OPI and VRI pricing rows — S05.1 (A), OPI and VRI rate tables
- **F5** [LB] Boostlingo claims phone, video and AI translation across thousands of concurrent sessions, 24/7, with ~13 s average routing to an interpreter — S04.1 (A), company panel

## Inferences

- **I1** from F1 + F2: typical session length. Formula: average interpreted call ≈ 21 min (phone, primary care); in-clinic encounter ≈ 48 min. Assumptions: A-1 a Canadian primary-care phone sample is representative of US OPI; A-2 encounter time approximates a VRI or in-person session. Range: low 10 (most calls under 20 min) – high 48 min, base 21 min. Not stated by any single source as a US OPI average.
- **I2** from I1 + R05 F1: cost per session. Formula: 0.47 USD/min (Spanish OPI) × 21 min ≈ 9.90 USD. Assumptions: A-1 contract rate as in R05 I3; A-2 base session length from I1. Range: low 4.70 (10 min OPI) – high 37 USD (48 min × 0.77 VRI), base 9.90.
- **I3** from F1 + I1: stability target vs real use. Formula: 5-minute benchmark ÷ 21-minute average call ≈ 24% of a typical call. Assumptions: A-1 the PDF's 5-minute bar (prompt review REQ-19); A-2 base length from I1. Range: low 10% (5 of 48 min) – high 50% (5 of 10 min), base 24%.
- **I4** from F5: concurrency for the workbench. Formula: workbench peak concurrent sessions = 1 demo user × 1 session = 1; Boostlingo platform = "thousands". Assumptions: A-1 the project is a single-user local demo (prompt review REQ-22 deploy optional). Range: low 1 – high a few (grader demos), base 1. Platform-scale concurrency is interview context, not a load target.
- **I5** from F3 + F4: Spanish is the dominant US request language in every US source read, but no national percentage was established; EN↔ES as the required pair is consistent with that. Fairly sure of "dominant", unsure of the size.

## Gaps

- ⚠ [LB] What share of US interpretation requests are Spanish nationally? — why: Census API needs a key, MPI returned 403, data.census.gov is JS-only — would close it: ACS table S1601/C16001 (Spanish, speak English less than "very well" ÷ all LEP) via data.census.gov, or ask the partner for their language mix
- ⚠ [LB] What is the average US OPI and VRI call length from a US vendor or US health system? — why: cap reached; only a Canadian phone sample and a US in-clinic encounter study were read; a children's hospital VRI dataset (≈11 min per encounter) was a search snippet only, unread — would close it: read that VRI study, or ask the partner for Boostlingo's average call length
- ⚠ When are the peak hours and days for interpretation demand? — why: no source found within the cap — would close it: ask the partner, or read a vendor usage report
- ⚠ How many concurrent sessions does a typical Boostlingo customer run at peak? — why: no Tier-A figure beyond "thousands" platform-wide — would close it: ask the partner

## Handoffs

- write-prd: Should the stability NFR stay at the PDF's 5 minutes, or add a stretch soak closer to a 21-minute real call? — rests on F1, I3
- write-prd: Should the write-up report cost per session (about 21 minutes) alongside cost per minute? — rests on I1, I2
- design-hld: Does the design need to hold resources steady for a 20+ minute session (socket lifetime, buffer growth, token/session expiry), even if the acceptance soak is 5 minutes? — rests on F1, I3

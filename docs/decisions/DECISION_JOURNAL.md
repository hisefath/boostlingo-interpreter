# Decision journal

Why each design choice was made and what it cost (software-factory-kit WORKFLOW.md §9). Committed, append-only.

- Written only by the `log-decision` skill, after every gate. It records decisions the **human** made; an entry is
  never `accepted` without the human's quoted words.
- Never renumber or delete an entry. Change your mind by adding a new D-row and marking the old one
  `superseded-by D<m>`. Rejected options stay visible.
- One-way (Type 1) decisions are also promoted to `docs/decisions/NNNN-<slug>.md`.
- Who said yes, word for word, lives in `.handoff/TRACKER.md ## Approvals`; this file holds the reasoning.
- Topics group decisions in the project review, `docs/decisions/REVIEW.md`, which
  `scripts/decision-views.sh` generates from this ledger. Changing the list is itself a decision.

Topics: Product · Data · Security · Money · Infrastructure · Process

## Entry schema

Copy this block for each new entry (D-ids increase by one, starting at D1):

```markdown
### D<n> <title>  [status: proposed | accepted | superseded-by D<m> | rejected]
- Date (`date`) · phase · milestone · Decided by: human · Proposed by: <skill> (<harness>, <model>) · artifact@<sha>
- Context and forces (FR/NFR ids)
- Options: always includes "do nothing" and the agent's first proposal ("instead of")
- Choice · Why (Y-statement: in context C, facing F, we chose X over Y to get Z, accepting W)
- Cost accepted · Reversibility (Type 1 one-way / Type 2 two-way) · Confidence (low/med/high)
- Revisit if · Evidence (file:line, R/S ids) · Interview line (one sentence you'd say out loud)
- Review: Topic <topic> · Weight <●●●|●●○|●○○> · One-liner: <at most 15 words>
```

## Entries

<!-- log-decision appends D1 below this line. -->

### D1 Full track, planned in one plan-product session  [status: accepted (auto, Type 2)]
- 2026-10-14 23:30 CDT · plan-product · M1 · Decided by: supervisor under the standing rule (WORKFLOW §5) · Proposed by: sharpen-brief (Claude Code, claude-opus-5-5) · specs/M1-interpreter-tradeoffs/brief.md@a1dbdf2
- Context: new greenfield partner project, no PRD, graded; v0.2 folds GI/G0/G1 into the Intent check (GI).
- Options: do nothing (no build, no submission) · Standard (rejected: no PRD to start from) · Fix (rejected: not a bug) · Full (chosen).
- Choice · Why: in a new graded product with no PRD, facing a 15–20 h appetite, we chose Full over Standard to get a defensible brief, research and PRD, accepting ~2–3 h of planning.
- Cost accepted: planning hours · Reversibility: Type 2 · Confidence: high
- Revisit if: the human trims the appetite below 10 h · Evidence: WORKFLOW §3; brief ## Track · Interview line: "A graded new product starts on the Full track; planning cost two hours of twenty."
- Review: Topic Process · Weight ●○○ · One-liner: Full track, one planning session, one batched card.

### D2 Voice-to-voice mode is the tracer bullet  [status: accepted (auto, Type 2)]
- 2026-10-14 23:30 CDT · plan-product · M1 · Decided by: supervisor under the standing rule (WORKFLOW §5) · Proposed by: write-prd (Claude Code, claude-opus-5-5) · docs/product/prd.md@2bc910e
- Context: FR-001, FR-002, FR-005..FR-007; RISK-5 (time); both modes share the UI and the timing clock (NFR-009).
- Options: do nothing (no order; parallel risk) · three-stage first (rejected: three vendors and streaming before anything plays) · voice-to-voice first (chosen).
- Choice · Why: facing a short appetite, we chose voice-to-voice first over three-stage to get the shared UI, mic, playback and timing proven with one vendor, accepting that the harder streaming work starts one milestone later.
- Cost accepted: the three-stage risk (RISK-1) surfaces later · Reversibility: Type 2 · Confidence: med
- Revisit if: R01 shows the browser connection blocked by the hosting choice · Evidence: PRD ## Milestone cut; R01 · Interview line: "I built the thinnest end-to-end slice first: one vendor, real audio, real timing."
- Review: Topic Product · Weight ●●○ · One-liner: Ship voice-to-voice end to end before the three-stage chain.

### D3 Spoken language detected within the selected pair  [status: accepted (auto, Type 2)]
- 2026-10-14 23:30 CDT · plan-product · M1 · Decided by: supervisor under the standing rule (WORKFLOW §5) · Proposed by: write-prd (Claude Code, claude-opus-5-5) · docs/product/prd.md@2bc910e (A-1, A-5)
- Context: FR-010; one shared screen hosts both speakers (A-5).
- Options: do nothing (fixed one-way EN→ES; fails the back-and-forth) · per-turn direction button (rejected: slower, unnatural, adds a step to every turn) · auto-detect within the pair (chosen).
- Choice · Why: we chose auto-detect over a direction button to get natural turn-taking, accepting misdetection on mixed-language turns (EC-8).
- Cost accepted: EC-8 errors · Reversibility: Type 2 (a button can be added) · Confidence: med
- Revisit if: misdetection exceeds 5 % of evaluation turns · Evidence: PRD A-1, EC-8; R02 · Interview line: "The workbench listens for which of the two languages you speak, like a human interpreter would."
- Review: Topic Product · Weight ●○○ · One-liner: Detect the speaker's language; no direction button.

### D4 Delay targets judged at the median, p95 reported  [status: accepted (auto, Type 2)]
- 2026-10-14 23:30 CDT · plan-product · M1 · Decided by: supervisor under the standing rule (WORKFLOW §5) · Proposed by: write-prd (Claude Code, claude-opus-5-5) · docs/product/prd.md@2bc910e (A-2)
- Context: NFR-001, NFR-002; the PDF gives "under 1.5 s / 3 s" with no percentile (REQ-17, REQ-18).
- Options: do nothing (undefined target; NOGO-3) · p95 as the gate (rejected: too strict for 40-turn samples, noisy) · median as the gate, p95 reported (chosen).
- Choice · Why: we chose the median gate with p95 shown to get a stable pass/fail on a small set, accepting that the tail is reported, not gated.
- Cost accepted: a slow tail can pass the gate (visible in the write-up) · Reversibility: Type 2 · Confidence: med
- Revisit if: the partner says the target means p95 · Evidence: PRD A-2; R03 · Interview line: "I gate on the median and always show p95, because a conversation is ruined by the tail."
- Review: Topic Product · Weight ●○○ · One-liner: Median gates the target; p95 is always reported.

### D5 Evaluation set drawn from FLEURS EN/ES, at least 20 per direction  [status: accepted (auto, Type 2)]
- 2026-10-14 23:30 CDT · plan-product · M1 · Decided by: supervisor under the standing rule (WORKFLOW §5) · Proposed by: write-prd (Claude Code, claude-opus-5-5) · docs/product/prd.md@2bc910e (A-6, AE-014)
- Context: FR-017, FR-018, SC-001, SC-004; NOGO-1 (no real patient data).
- Options: do nothing (quality by feel; NOGO-2) · record our own clinic script (rejected: no independent references, slow) · CoVoST 2 (rejected: ES→EN only) · FLEURS en_us + es_419 subsets (chosen).
- Choice · Why: we chose FLEURS over CoVoST 2 to get both directions with references under CC-BY-4.0, accepting read speech is cleaner than clinic talk (RISK-4).
- Cost accepted: RISK-4; the FLEURS id join is still unchecked (R03 gap) · Reversibility: Type 2 · Confidence: med
- Revisit if: the FLEURS id join fails · Evidence: R03 F-rows, S03.x · Interview line: "I scored both modes on the same public, licensed EN/ES set, so the numbers are reproducible."
- Review: Topic Data · Weight ●●○ · One-liner: Score both modes on the same public FLEURS EN/ES set.

### D6 Partner documents stay outside the repo until cleared  [status: accepted (auto, Type 2)]
- 2026-10-14 23:30 CDT · plan-product · M1 · Decided by: supervisor under the standing rule (WORKFLOW §5) · Proposed by: sharpen-brief (Claude Code, claude-opus-5-5) · specs/M1-interpreter-tradeoffs/brief.md@a1dbdf2 (U-01, U-02)
- Context: the repo will be public; the PDF and portal pages may be partner-confidential.
- Options: do nothing (commit the PDF; possible leak) · paraphrase with section refs, copy kept privately (chosen).
- Choice · Why: we chose private copies plus paraphrase to avoid leaking partner text, accepting slightly vaguer citations.
- Cost accepted: no verbatim quotes · Reversibility: Type 2 (the human can clear them at GI) · Confidence: high
- Revisit if: the human clears U-01/U-02 · Evidence: brief ## User-owned steps · Interview line: "I treated the partner brief as confidential until told otherwise."
- Review: Topic Security · Weight ●○○ · One-liner: Paraphrase partner docs; keep the originals private.

### D7 Comparison write-up lives at docs/COMPARISON.md  [status: accepted (auto, Type 2)]
- 2026-10-14 23:30 CDT · plan-product · M1 · Decided by: supervisor under the standing rule (WORKFLOW §5) · Proposed by: sharpen-brief (Claude Code, claude-opus-5-5) · specs/M1-interpreter-tradeoffs/brief.md@a1dbdf2 (REQ-08)
- Context: the PDF requires a 1–2 page write-up but names no file; no factory skill owns a comparison essay.
- Options: do nothing (write-up missing; REQ-08 fails) · put it inside README (rejected: README is setup and architecture) · docs/COMPARISON.md, written in M6 by the supervisor from report-milestone's measured numbers, linked from README (chosen).
- Choice · Why: we chose a standalone docs/COMPARISON.md over a README section to get one printable 1–2 page document graders can find from the README, accepting one more file.
- Cost accepted: a README link to keep in sync (garden-docs) · Reversibility: Type 2 · Confidence: high
- Revisit if: the portal submission form asks for a specific file · Evidence: brief REQ-08 · Interview line: "The recommendation is one page anyone can open, and every number in it links to a measured run."
- Review: Topic Product · Weight ●○○ · One-liner: The comparison is docs/COMPARISON.md, linked from README.

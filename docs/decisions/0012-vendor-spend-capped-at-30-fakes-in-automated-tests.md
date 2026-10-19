---
status: accepted
date: 2026-10-18
decision-makers: human (exact words in journal D12)
journal: D12
---

# 0012. Vendor spend capped at $30, fakes in automated tests

## Context and Problem Statement

NFR-007; voice-to-voice ≈ $0.10/min before context re-billing (R01). What should we commit to before design starts?

## Decision Drivers

* NFR-007; voice-to-voice ≈ $0.10/min before context re-billing (R01)

## Considered Options

* do nothing (no live testing; benchmarks unmeasurable)
* $15 (rejected: ~20-clip eval, few soak runs)
* $60 (rejected: more than needed)
* $30 with fakes in tests (chosen)

## Decision Outcome

Chosen option: "Vendor spend capped at $30, fakes in automated tests", because we chose cap $30 total to get the demo, soak runs and a 40-clip × 2-mode eval, accepting little room for re-runs. The human approved the recommendation: "Take all your recommendations on the GI card, deadline is <date>."

### Consequences

* Good: get the demo, soak runs and a 40-clip × 2-mode eval
* Bad: re-runs limited

### Confirmation

Revisit if evaluation needs more than ~2 h of live audio.

## More Information

Evidence: R01, R02; card item 2. Journal D12.

---
status: accepted
date: 2026-10-18
decision-makers: human (exact words in journal D14)
journal: D14
---

# 0014. Run locally; decide hosting after the write-up

## Context and Problem Statement

C-6, NG-4, REQ-22. What should we commit to before design starts?

## Decision Drivers

* C-6, NG-4, REQ-22

## Considered Options

* do nothing (no setup docs; fails REQ-14)
* AWS preview (rejected now: ~2–3 h, needs HTTPS for the mic)
* Railway (rejected: not the partner preference)
* local-only with setup steps (chosen)

## Decision Outcome

Chosen option: "Run locally; decide hosting after the write-up", because we chose local-only to protect the build hours, accepting that graders run it themselves. The human approved the recommendation: "Take all your recommendations on the GI card, deadline is <date>."

### Consequences

* Good: protect the build hours
* Bad: graders must run it locally; GT on localhost

### Confirmation

Revisit if the write-up is done with time left.

## More Information

Evidence: PRD C-6; card item 4. Journal D14.

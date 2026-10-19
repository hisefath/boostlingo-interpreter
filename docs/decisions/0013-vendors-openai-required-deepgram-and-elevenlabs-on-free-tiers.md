---
status: accepted
date: 2026-10-18
decision-makers: human (exact words in journal D13)
journal: D13
---

# 0013. Vendors: OpenAI required, Deepgram and ElevenLabs on free tiers

## Context and Problem Statement

C-1, C-4, FR-016, NFR-006; R02 (Deepgram server end-of-speech, ElevenLabs text-streaming input). What should we commit to before design starts?

## Decision Drivers

* C-1, C-4, FR-016, NFR-006; R02 (Deepgram server end-of-speech, ElevenLabs text-streaming input)

## Considered Options

* do nothing / OpenAI only (all three stages on one vendor; weak swap story)
* OpenAI + Deepgram + ElevenLabs (chosen)

## Decision Outcome

Chosen option: "Vendors: OpenAI required, Deepgram and ElevenLabs on free tiers", because we chose three vendors to get server-side end-of-speech and streaming text-to-speech plus a real alternate per stage, accepting two more accounts for the human to open. The human approved the recommendation: "Take all your recommendations on the GI card, deadline is <date>."

### Consequences

* Good: get server-side end-of-speech and streaming text-to-speech plus a real alternate per stage
* Bad: two extra accounts (human-owned, U-03)

### Confirmation

Revisit if a free tier blocks EN/ES streaming.

## More Information

Evidence: R02; card item 3. Journal D13.

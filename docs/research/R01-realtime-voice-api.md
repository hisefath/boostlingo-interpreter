---
id: R01
question: "How does the OpenAI Realtime API with model gpt-realtime work end to end for live speech-to-speech translation: transport options (WebRTC vs WebSocket vs SIP), ephemeral/short-lived client credentials, turn detection (server VAD, semantic VAD) and which server events mark speech end (e.g. input_audio_buffer.speech_stopped) and first audio out (e.g. response.output_audio.delta), how to get both input transcription and output transcript text, how to instruct it to translate only, and current pricing per audio token / per minute estimates."
asked_in: supervisor job message 2026-10-14 (brief specs/M1-interpreter-tradeoffs/brief.md being written in parallel)
unblocks: "design-hld transport + trust boundary, latency measurement points, cost-per-minute formula"
answered_when: "official OpenAI docs pages are cited for each of transport, credentials, events, transcription, pricing"
status: answered
confidence: high
supersedes: none
date: 2026-10-14
budget: 15/15 tool calls
researched_by: Claude Code (gather-evidence worker), claude-opus-5-5
---

# R01 OpenAI Realtime API end to end for live speech-to-speech translation

## Answer

A browser connects to the Realtime API over WebRTC using a short-lived client secret (default 10 minutes, max 2
hours) that the app server mints with the real API key; WebSocket is the server-side transport and SIP is for phone
trunks (S01.1, S01.5, S01.6, S01.9). With VAD on (server_vad by default, semantic_vad optional), speech end is
`input_audio_buffer.speech_stopped`; first audio out is `response.output_audio.delta` over WebSocket or
`output_audio_buffer.started` over WebRTC/SIP; source text comes from `conversation.item.input_audio_transcription.*`
when `session.audio.input.transcription` is set, and target text from `response.output_audio_transcript.delta`
(S01.3, S01.4, S01.6, S01.10). Translate-only behaviour on gpt-realtime is done through session `instructions` (the
docs give language-pinning guidance but no translator recipe), while OpenAI also documents a separate
`gpt-realtime-translate` model on `/v1/realtime/translations` at $0.034/min; gpt-realtime audio costs $32 in / $64
out per 1M tokens at 1 token per 100 ms in and 1 per 50 ms out (S01.2, S01.7, S01.8, S01.11, S01.12). Confidence:
high, because every load-bearing claim comes from OpenAI's own docs or API reference read today.

## Takeaway

The browser talks to OpenAI directly over WebRTC with a 10-minute key my server hands out, and I time latency from
the "speech stopped" event to the "audio started" event, paying about 10 cents per minute of speech in and out.

## Findings

- **F1** [LB] Realtime sessions connect "over WebRTC in the browser" or WebSocket on the server; browsers get
  ephemeral credentials from `POST /v1/realtime/client_secrets`; GA interface drops the `OpenAI-Beta: realtime=v1`
  header; sample code uses model `gpt-realtime-2.1` — S01.1 (A), "Build a speech-to-speech voice agent", "Beta to GA migration"
- **F2** [LB] Two WebRTC setups: (a) ephemeral token, browser POSTs its SDP straight to `/v1/realtime/calls` with
  `Authorization: Bearer <ephemeral key>`; (b) unified interface, browser sends SDP to the app server, which forwards
  it with session config and the standard key (simpler, faster connect, but puts the server "in the critical path"
  for session start). JSON events ride the `oai-events` data channel; audio rides media tracks. WebRTC is
  recommended over WebSocket for browser/mobile clients for "more consistent performance"; standard keys only on the
  server — S01.5 (A), Realtime WebRTC sections
- **F3** [LB] OpenAI documents a dedicated translation session: model `gpt-realtime-translate`, endpoint
  `/v1/realtime/translations` (WebRTC client secrets at `/v1/realtime/translations/client_secrets`, SDP at
  `/v1/realtime/translations/calls`), target set by `session.audio.output.language`, one session per output
  language, continuous streaming with no `response.create` and no turn lifecycle; server events
  `session.input_transcript.delta`, `session.output_transcript.delta`, `session.output_audio.delta`; the guide says
  `gpt-realtime-2.1` is for assistants and to use it "with a standard Realtime session instead". The model page lists
  only the translations endpoint (`v1/realtime` not supported), 16,000 context, and does not list languages —
  S01.2 (A), Models / Transports / Events; S01.12 (A), model page
- **F4** [LB] Client secret `expires_after`: anchor `created_at`, `seconds` between 10 and 7200, default 600;
  response returns `value` (e.g. `ek_...`) and `expires_at` — S01.6 (A), body parameters
- **F5** SIP connects phone numbers/PBX via a trunking provider: OpenAI fires a `realtime.call.incoming` webhook, the
  server accepts with `POST /v1/realtime/calls/{call_id}/accept`, then may open a WebSocket with `call_id` to
  control it; the page does not cover browser apps — S01.9 (A), whole page
- **F6** [LB] Turn detection lives at `session.audio.input.turn_detection`; `server_vad` (default when VAD is on;
  on by default for speech-to-speech) splits on silence with `threshold` 0.5, `prefix_padding_ms` 300,
  `silence_duration_ms` 500 defaults; `semantic_vad` uses a classifier with `eagerness` low/medium/high/auto
  (max waits 8 s / 4 s / 2 s); `create_response` and `interrupt_response` apply to conversation sessions; `null`
  disables VAD and the client must trigger responses — S01.3 (A), modes and parameters; S01.6 (A), turn_detection
- **F7** [LB] WebSocket voice-turn order: `input_audio_buffer.speech_started` → `speech_stopped` → `committed`, then
  `response.created` → ... → `response.output_audio.delta` (repeated) → `response.output_audio.done` →
  `response.output_audio_transcript.delta` → ... → `response.done`; "some deltas may interleave". Over WebRTC audio
  arrives as a remote media track; the guide does not list `response.output_audio.delta` for WebRTC clients —
  S01.4 (A), WebSocket lifecycle and WebRTC notes
- **F8** [LB] `input_audio_buffer.speech_stopped` carries `audio_end_ms` (offset since session start);
  `output_audio_buffer.started` (WebRTC/SIP only) means the server began streaming response audio;
  `output_audio_buffer.stopped` and `.cleared` are also WebRTC/SIP only — S01.10 (A), server events
- **F9** [LB] Input transcription is enabled by `session.audio.input.transcription` (`model` such as
  `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1`, `gpt-realtime-whisper`; optional `language`,
  `prompt`); events `conversation.item.input_audio_transcription.delta`, `.completed`, `.failed`; transcription
  "runs asynchronously" and is "a rough guide" to what the model heard. Output text arrives via
  `response.output_audio_transcript.delta`/`.done` — S01.6 (A), transcription object; S01.10 (A),
  session.created and transcription events; S01.4 (A), output events
- **F10** [LB] Instructions are set with `session.instructions` via `session.update` (S01.4). The prompting guide has
  no translator recipe; it advises pinning output language ("Do not respond in any other language even if the user
  asks"), controlling language separately from accent, and notes gpt-realtime-2 "follows instructions more
  literally" — S01.4 (A), session.update; S01.11 (A), language sections
- **F11** [LB] Pricing per 1M tokens: gpt-realtime and gpt-realtime-2.1 audio input $32.00, cached $0.40, audio
  output $64.00; text input $4.00, text output $16.00 (gpt-realtime) / $24.00 (2.1); gpt-realtime-mini audio
  $10 / $0.30 / $20; gpt-realtime-translate $0.034 per minute; gpt-4o-transcribe ~$0.006/min, gpt-4o-mini-transcribe
  ~$0.003/min — S01.7 (A), pricing tables; S01.12 (A), pricing
- **F12** [LB] User input audio is "1 token per 100 ms", assistant output audio "1 token per 50ms"; "the entire
  conversation is sent to the model for each Response", so later turns cost more; caching is automatic and
  best-effort; `token_limits.post_instructions` and `retention_ratio` control truncation — S01.8 (A), Realtime API section

## Inferences

- **I1** from F1 + F2 + F4: the trust boundary is the app server minting a client secret (≤ 7200 s, default 600 s)
  so the standard key never reaches the browser, or proxying SDP (unified interface). A 5-minute session (REQ-19)
  fits inside the default 600 s TTL, assuming the TTL limits session creation rather than session length; not
  stated by the sources read. Medium sure.
- **I2** from F7 + F8: a speech-end → first-audio latency measurement can use `speech_stopped.audio_end_ms` or the
  client receive time of `speech_stopped` as start, and `output_audio_buffer.started` (WebRTC) or the first
  `response.output_audio.delta` (WebSocket) as end. Server-VAD `silence_duration_ms` (default 500 ms) elapses
  before `speech_stopped` fires, so it sits outside or inside the measured window depending on which anchor is
  used. High sure on event names, medium on the anchor semantics.
- **I3** from F11 + F12: audio-only token cost per minute for gpt-realtime. Formula: cost/min ≈ (600 × $32 +
  1200 × $64 × r) / 1e6 + re-billed context + transcription, where r = minutes of output audio per minute of input
  speech. Assumptions: 600 input tokens/min, 1200 output tokens/min, prior turns re-sent as input each response
  (cached at $0.40/1M when the cache hits, $32/1M when it misses), input transcription at ~$0.006/min.
  Range: low ≈ $0.019 + $0.077 × 0.8 + small cached context ≈ $0.08/min; base ≈ $0.096 + $0.006 ≈ $0.10/min;
  high (r = 1.2, cache misses on a growing 5-minute context) can be several times base. gpt-realtime-translate is
  a flat $0.034/min by comparison. Not stated by any single source.
- **I4** from F3 + F10: two documented paths exist for interpretation: a gpt-realtime conversation session steered
  by instructions (turn-based, VAD-triggered responses, transcripts via F9 events) or a gpt-realtime-translate
  translation session (continuous, no turns, its own event names). Which one REQ-02's "vendor-mandated" model
  means is not settled by the docs. High sure the two paths exist.

## Gaps

- ⚠ Does the Boostlingo PDF mandate `gpt-realtime` specifically, or does `gpt-realtime-translate` / `gpt-realtime-2.1`
  satisfy REQ-02? — why: no Tier-A source in reach (PDF held by the human) — would close it: read the PDF §AI/ML
  Frameworks or ask the partner
- ⚠ Does gpt-realtime-translate support English ↔ Spanish in both directions, and how does it handle two speakers
  on one stream? — why: model page and guide list no languages (S01.12, S01.2); cap reached — would close it: read
  the gpt-realtime-translate supported-languages section if one exists, or a live test
- ⚠ Does the client-secret TTL bound only session creation, or also an open session's lifetime, and what is the
  max Realtime session duration? — why: cap reached; not stated in S01.6 — would close it: read the Realtime
  session limits section of the API reference
- ⚠ Is `response.output_audio.delta` also emitted on the WebRTC data channel, and how is first-audio measured
  inside the translations session (WebRTC)? — why: S01.4 does not list it; S01.10 pages 200000+ chars unread; cap
  reached — would close it: read the rest of S01.10 or a live event log
- ⚠ Ordering of input-transcription completion relative to response audio is not stated beyond "asynchronously"
  — why: cap reached — would close it: live event log in the workbench
- ⚠ Exact translate-only prompt behaviour (does gpt-realtime ever answer instead of translating?) — why: no
  OpenAI recipe exists (S01.11) — would close it: an eval in the workbench

## Handoffs

- write-prd: Is the Realtime mode required to use `gpt-realtime` (conversation session plus translate-only instructions), or may it use the dedicated `gpt-realtime-translate` translation session? — rests on F3, F10, I4
- design-hld: Ephemeral client secret with browser-direct SDP, or unified interface with the server proxying SDP, as the trust boundary for the Realtime mode? — rests on F1, F2, F4, I1
- design-hld: Which event pair defines "speech-end → first audio out" for REQ-17 on WebRTC (`speech_stopped` vs `audio_end_ms`; `output_audio_buffer.started` vs first remote-track audio), and is VAD silence counted inside it? — rests on F6, F7, F8, I2
- design-hld: Should the cost-per-minute formula in I3 include context re-billing with `token_limits` / `retention_ratio` settings fixed per session? — rests on F11, F12, I3

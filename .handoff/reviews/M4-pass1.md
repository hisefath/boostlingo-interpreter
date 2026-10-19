# M4 review pass 1 — triage (three lenses, merged)
Diff: .handoff/reviews/M4-diff.patch @481819e · Lenses: spec-fidelity (S), correctness-security (C), adversarial (A) · Fixes: 2d0e576, f62178e

| Row | Lens ids | Sev | Finding | Disposition |
|---|---|---|---|---|
| R1 | C-R1, S-R4 | P1 | server bound all interfaces | fix → 127.0.0.1 (2d0e576) |
| R2 | C-R2 | P1 | no WS Origin check; cross-site eval write | fix → verifyClient localhost + JSON-only, tests (2d0e576) |
| R3 | C-R3 | P1 | OpenAI STT buffers forever after close | fix → buffer only while CONNECTING (2d0e576) |
| R4 | C-R4, A-R4 | P1 | reconnect reuses seq/turn ids, drops audio | fix → epoch + seq offset (2d0e576) |
| R5 | C-R5, S-R3 | P1 | stage timeout covers whole stream | fix → idle timeout + test, mutation-checked (f62178e) |
| R6 | S-R2 | P1 | cascade never emits turn_detected | fix (f62178e) |
| R7 | S-R6, A-R6 | P2 | speech-end clocks mis-anchored (Deepgram t0, realtime audio_end_ms) | fix → first-push origin; realtime = arrival − 500 ms VAD silence, stated as approximation (f62178e) |
| R8 | S-R1 | P2 | rate-limit retry not surfaced (AE-009) | fix → error notice "retrying in N ms", wait capped (f62178e) |
| R9 | S-R10 | P2 | eval falls back to transport text; realtime WER is side model | fix → unscored without audio; WER cascade only (f62178e) |
| R10 | C-R7, C-R8 | P2 | context unvalidated; no maxPayload; mint no timeout | fix (2d0e576) |
| R11 | C-R9, A-R7 | P2 | realtime model hardcoded in browser URL | fix → URL without model; secret binds it (f62178e) |
| R12 | A-R1 | P1 | server rate-limit test can't catch missing retry | keep: acceptance AE-009 test asserts retry-then-done |
| R13 | A-R3 | P1 | vendor adapters untested | file: covered by live GT tonight; adapter contract tests later |
| R14 | S-R5 | P2 | realtime turn-detection shown "not observable" | file (display only; recorded in timings) |
| R15 | S-R7 | P2 | mode switch drops in-flight turn (EC-4) | file |
| R16 | S-R8 | P2 | pair select locked in session (one pair exists) | file |
| R17 | S-R9 | P2 | barge-in only with headphones | keep: echo guard (FR-020) wins without headphones; stated in UI |
| R18 | A-R5, A-R8, A-R9, A-R10, C-R6, C-R10, A-R2 | P2–P3 | stale reconnect context, WebRTC 'disconnected' handling, Deepgram utterance_end, mic re-enable on error, duplicate STT errors, client memory, TTS-timeout test | file |

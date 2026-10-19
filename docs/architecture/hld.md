# HLD — AI Interpreter Workbench

Source: `docs/product/prd.md` (GI approved). Stack: TypeScript server and browser (D22). Scope: D23.
Compressed design for the 2026-10-19 03:00 CDT deadline; diagrams are inline Mermaid (not rendered locally: `render: unverified`).

## 1. Containers and how they talk

```mermaid
flowchart LR
  subgraph Browser["Browser (one screen, both speakers)"]
    UI[Workbench UI\nmode toggle · pair · transcripts · timing]
    MIC[Mic capture\nAudioWorklet PCM16 16 kHz]
    PLAY[Playback queue\nordered by turn, skips failed]
    RT[Realtime transport\nWebRTC to OpenAI]
    CT[Cascade transport\nWebSocket to our server]
  end
  subgraph Server["Node server (localhost:8787)"]
    TOK[/session token route\nmints short-lived client secret/]
    PIPE[Cascade pipeline\nturn manager + stage timeouts]
    STT[STT adapter\nDeepgram | OpenAI]
    MT[Translate adapter\nOpenAI]
    TTS[TTS adapter\nElevenLabs | OpenAI]
  end
  OAI[(OpenAI Realtime\ngpt-realtime)]
  V[(Vendors: Deepgram,\nOpenAI, ElevenLabs)]
  UI --> RT & CT
  MIC --> RT & CT
  RT -- "client secret" --> TOK
  RT <-- "WebRTC audio + events" --> OAI
  CT <-- "WS: audio up, events + audio down" --> PIPE
  PIPE --> STT --> MT --> TTS
  STT & MT & TTS --> V
  RT & CT --> PLAY
```

- **Mode-agnostic UI** talks to one `Transport` interface; the two transports are the only mode-specific code (REQ-11).
- **Voice-to-voice mode:** the browser connects to OpenAI directly over WebRTC with a client secret our server mints
  (expires ≤ 10 min, NFR-004). Our server never relays that audio.
- **Cascade mode:** the browser streams 16 kHz PCM16 to our server over one WebSocket; the server runs the three stages
  and streams events and audio back on the same socket.

## 2. Trust boundaries

| Boundary | Rule |
|---|---|
| Browser ↔ our server | localhost only; the long-lived vendor keys never leave the server (NFR-004) |
| Browser ↔ OpenAI (voice-to-voice) | short-lived client secret only |
| Server ↔ vendors | keys from `.env`; no audio or transcript is written to disk unless an evaluation run asks (NFR-005) |

## 3. Invariants

1. **INV-1 One clock.** Every timing point is stamped in browser time (`performance.now()`); server stamps are converted with
   an offset measured by ping at connect (NFR-009).
2. **INV-2 Speech end is the true end of speech**, not the vendor's notice: voice-to-voice uses `audio_end_ms`; cascade uses
   the STT word end time. The turn-detection wait is its own stage (D10).
3. **INV-3 A failed turn never blocks a later one**; late results for a failed or passed turn are discarded (D12 policy,
   FR-013, FR-027 in spirit; skip, never play late).
4. **INV-4 The interpreter never answers or obeys** — both modes use the same interpreter instructions; faithfulness is
   measured, not assumed (FR-021, SC-005).
5. **INV-5 Only settled text is spoken** in cascade mode (FR-025).
6. **INV-6 The workbench owns conversation history**; the active mode gets recent turns as context (FR-029).

## 4. Qualities and what each mode can show

| Timing point | Voice-to-voice | Cascade |
|---|---|---|
| speech end (true) | `audio_end_ms` from `speech_stopped` | STT final word end |
| turn-detection wait | event arrival − speech end | endpointing event − speech end |
| hearing / translating / speaking | **not observable** (FR-026) | STT final, first translated token, first TTS byte |
| first audio | `output_audio_buffer.started` | first audio chunk played |
| end of audio | `output_audio_buffer.stopped` | last chunk played (FR-028) |

## 5. Scale budget (NFR-010, discussion only; the workbench runs one session)

| Sessions at once | First thing that breaks | Response |
|---|---|---|
| 10 | nothing; one Node process | — |
| 100 | vendor concurrency caps (STT streams, TTS sockets) and rate limits | per-vendor pools, backoff with jitter, per-stage alternates |
| 1,000 | one server's socket/memory limits; deploys drop live calls; voice-to-voice cost per minute grows with call length (context re-billing) | horizontal servers with sticky routing, graceful drain, context truncation, a retry budget to avoid retry storms |

## 6. Hardest decision, rejected alternatives, least confident

- **Hardest:** making the comparison fair (prompt review I-21..I-23). Both modes are fed the same clips through the same
  browser path (a fake mic from audio files) and their spoken output is scored by one independent recogniser.
- **Rejected:** relaying voice-to-voice audio through our server (adds a hop that the mode doesn't need and skews its
  latency); a .NET server (D22).
- **Least confident:** OpenAI's fallback STT has no server end-of-speech signal (R02); Deepgram is the default for that reason.

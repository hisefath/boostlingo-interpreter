---
id: R02
question: "Which streaming speech-to-text, translation and text-to-speech vendors handle EN↔ES with partial results, at what price and claimed delay, with endpointing and incremental text input?"
asked_in: specs/M1-interpreter-tradeoffs/brief.md#research-questions
unblocks: "design-hld vendor per stage + an alternate to prove swaps; cost formula (REQ-03, REQ-09)"
answered_when: "each vendor's own docs/pricing cited"
status: partial
confidence: medium
supersedes: none
date: 2026-10-14
budget: 15/15 tool calls (plus 2 local greps of the already-fetched S02.15 page)
researched_by: Claude Code, claude-opus-5-5
---

# R02 Streaming cascade vendors: EN/ES support, price, latency, endpointing, input streaming

## Answer

Every speech-to-text vendor read (OpenAI, Deepgram, AssemblyAI, Soniox) publishes a streaming price ($0.002 to
$0.006 per minute) and streams partial results. Deepgram (`speech_final`) and AssemblyAI (`end_of_turn`) send an
end-of-utterance signal. OpenAI's current realtime transcription model does not detect turns server-side, so the
client has to run its own voice detection. On the text-to-speech side, ElevenLabs documents a WebSocket that takes
text in pieces, Deepgram, ElevenLabs and Polly price per character, and OpenAI and Anthropic price their language
models per token. Three things are missing: Azure and DeepL prices could not be read, Spanish support is confirmed
only for AssemblyAI Multilingual, and only ElevenLabs gives a latency figure (about 75 ms for Flash). Confidence:
medium, because every price comes from the vendor's own page (Tier A) but two vendors and most latency claims are
gaps. (S02.2, S02.3, S02.4, S01.7, S02.6, S02.7, S02.8, S02.9, S02.10, S02.13, S02.15)

## Takeaway

Speech-to-text is cheap (a fraction of a cent per minute) and the speech-out side usually costs the most per minute.
The vendors also differ in two ways: whether the service tells you when the speaker has finished, and whether you
can feed text into the voice engine while the translation is still being written.

## Findings

- **F1** [LB] OpenAI gpt-4o-transcribe costs $2.50 / $10.00 per 1M input/output tokens, estimated $0.006/min. gpt-4o-mini-transcribe costs $1.25 / $5.00, estimated $0.003/min. — S01.7 (A), "Transcription models" table
- **F2** [LB] OpenAI gpt-4o-mini-tts costs $0.60 per 1M text input tokens and $12.00 per 1M audio output tokens. The page gives no per-minute figure. gpt-realtime audio costs $32 in / $64 out per 1M tokens, and gpt-realtime-mini costs $10 / $20. — S01.7 (A), "Realtime and audio generation models"
- **F3** [LB] OpenAI text models per 1M input/output tokens: gpt-4.1 $2.00/$8.00, gpt-4.1-mini $0.40/$1.60, gpt-4o-mini $0.15/$0.60, gpt-5-mini $0.25/$2.00, gpt-5-nano $0.05/$0.40. — S01.7 (A), "Standard" section
- **F4** [LB] OpenAI realtime transcription sends delta events ("newly available transcript text") and completion events. The guide now points to `gpt-live-transcribe`, which "doesn't support `server_vad` or `semantic_vad`". Examples set `turn_detection` to null and use client-side VAD plus `input_audio_buffer.commit`. The page gives no latency numbers and says delay "can vary by model configuration". — S02.11 (A), Realtime transcription guide
- **F5** [LB] Deepgram Nova-3 streaming pay-as-you-go: $0.0048/min monolingual and $0.0058/min multilingual, labelled "Limited-time promotional rates". Aura-2 TTS costs $0.030 per 1k characters. — S02.2 (A), "Speech to Text > Streaming", "Text to Speech"
- **F6** [LB] In Deepgram streaming, a pause-based endpoint returns a response with `speech_final: true`. The silence window is set in ms by `endpointing`, and the page states a 10 ms default. `UtteranceEnd` needs `interim_results`, `utterance_end_ms` and `vad_events`. The page gives no latency figure. — S02.12 (A), Endpointing page
- **F7** [LB] AssemblyAI Universal-Streaming costs $0.15/hr for English and $0.15/hr for Multilingual, billed on "session duration, not audio duration". Multilingual is shown as covering EN, ES, DE, FR. The page makes no latency claim. — S02.3 (A), "Streaming (Real-Time) Rate Card"
- **F8** [LB] AssemblyAI streaming sends `Turn` messages repeatedly while someone speaks, with the text so far and per-word `word_is_final`. "`end_of_turn: true` marks a finalized turn". The docs page lists no languages and no latency numbers. Its examples use `speech_model` `universal-3-6-pro`. — S02.13 (A), Universal Streaming docs
- **F9** [LB] Soniox real-time speech-to-text costs "$0.12/hour" (about $0.002/min). Token rates: audio input $2.00/1M, text input $4.00/1M, text output $4.00/1M, and about 30,000 audio tokens per hour. The FAQ says translation is "Included... at no extra cost", but the token table bills translated text as output tokens. The page claims "60+ languages" without a list. — S02.4 (A), Pricing page
- **F10** [LB] ElevenLabs API: Flash/Turbo costs $0.04 per 1K characters and claims "Ultra-low latency (~75ms)". v2 Multilingual costs $0.08 per 1K characters. — S02.6 (A), API pricing page
- **F11** [LB] The ElevenLabs stream-input WebSocket is built to "generate audio from partial text input" and returns audio chunks. `chunk_length_schedule` defaults to [120, 160, 250, 290] characters before generation starts (each value can be 50 to 500). `flush` forces generation, and the docs warn buffering may add latency. — S02.7 (A), stream-input API reference
- **F12** [LB] Amazon Polly pay-as-you-go per 1M characters: Standard $4, Neural $16, Long-Form $100, Generative $30. — S02.9 (A), "Pay-as-you-go model"
- **F13** [LB] Anthropic base prices per 1M input/output tokens: Claude Haiku 4.5 $1/$5, Haiku 5.5 $0.10/$0.50 (prompts up to 100K tokens), Sonnet 4.6 $3/$15, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20. — S02.15 (A), "Model pricing" table
- **F14** The DeepL Pro API page shows no API per-character price. It lists 50,000 characters per user per month for the Free version, and it doesn't say whether that applies to the API. — S02.8 (A), "See how our plans compare"
- **F15** Every price field on the Azure Speech pricing page rendered as "$-" when fetched (real-time transcription per hour, Neural TTS per 1M characters, speech translation per audio hour). — S02.10 (A), "Speech Model Prices"

## Inferences

- **I1** from F1 + F5 + F7 + F9: streaming speech-to-text costs from about $0.002/min (Soniox) to $0.006/min (OpenAI
  gpt-4o-transcribe). AssemblyAI bills connection time, so for AssemblyAI an idle open socket costs the same as
  speech. High confidence on the list prices. Promotional and connection-time terms can move the real figure.
- **I2** from F2 + F3 + F5 + F10 + F12 + F13: a cascade cost-per-minute formula that design-hld can fill in:
  `cost/min = STT_rate_per_min + (tokens_in × p_in + tokens_out × p_out)/1e6 × turns_per_min + TTS_rate_per_char × chars_out_per_min`.
  Assumptions (not sourced; to be measured in the workbench): chars_out_per_min and tokens per turn come from logged
  sessions. Range: not computed, because the speaking rate and prompt size are unmeasured. With per-character TTS
  rates of $0.000016 to $0.00008 (F5, F10, F12), TTS probably outweighs STT once a minute holds more than about 100
  output characters. Medium confidence.
- **I3** from F4 + F6 + F8: end-of-utterance comes from the server for Deepgram and AssemblyAI. With OpenAI's
  `gpt-live-transcribe` it has to come from the client. A turn-detection seam therefore cannot assume every STT
  provider emits the signal. High confidence for the three vendors read.
- **I4** from F11 (and nothing read for OpenAI, Deepgram Aura, Polly or Azure on this point): ElevenLabs is the only
  vendor with documented incremental text input in this pass. Its default 120-character buffer works against
  sub-2 s first audio unless the buffer is tuned or flushed. Medium confidence, because the other vendors were not
  read on this point.

## Gaps

- ⚠ [LB] What are Azure Speech's real-time STT, Neural TTS and speech translation prices? — why: unread (the page rendered "$-" placeholders, S02.10) — would close it: read the Azure pricing calculator or the Azure Speech pricing page in a browser
- ⚠ [LB] What is DeepL API Pro's per-character price, and does it stream output? — why: unread (the plans page gives no API price, S02.8) — would close it: read developers.deepl.com pricing and API reference
- ⚠ [LB] Do Deepgram Nova-3, OpenAI realtime transcription and Soniox list Spanish in their streaming docs? — why: cap reached; only AssemblyAI Multilingual (F7) confirms ES — would close it: read each vendor's supported-languages page
- ⚠ [LB] What latency do OpenAI TTS, Deepgram STT/Aura, AssemblyAI, Soniox, Polly and Azure claim in their own docs? — why: cap reached; only ElevenLabs Flash (~75 ms, F10) was found — would close it: read each vendor's latency/benchmark doc page, or measure in the workbench
- ⚠ [LB] Can OpenAI gpt-4o-mini-tts, Deepgram Aura, Polly or Azure TTS take streamed text input over a WebSocket? — why: cap reached — would close it: read each TTS API reference
- ⚠ Does Soniox send an endpoint/end-of-turn token? — why: cap reached — would close it: read Soniox real-time API docs
- ⚠ Does `gpt-transcribe` (as opposed to `gpt-live-transcribe`) support server VAD? — why: S02.11 does not say — would close it: read the OpenAI Realtime API turn-detection reference
- ⚠ Is Deepgram's 10 ms endpointing default still current? — why: S02.12 states it, but it is unusually short — would close it: read the current Deepgram streaming API reference
- ⚠ What is the per-minute cost of gpt-4o-mini-tts and gpt-realtime? — why: S01.7 gives only token rates — would close it: measure audio tokens per minute in the workbench
- ⚠ Is an ElevenLabs Spanish voice confirmed for Flash? — why: not read — would close it: read the ElevenLabs models page
- option: run anthropic-skills:deep-research for this question (a broad multi-vendor sweep)

## Handoffs

- design-hld: which STT, translation and TTS provider is primary per stage, and which alternate proves the swap seam, given the prices in F1 to F13 and the open Azure and DeepL gaps? — rests on F1–F13, I1
- design-hld: should end-of-utterance detection live behind its own seam (server signal for Deepgram/AssemblyAI, client VAD for OpenAI live transcription)? — rests on F4, F6, F8, I3
- design-hld: does the TTS adapter stream text in (WebSocket, tuned buffer or flush) or send per-sentence requests, given that only ElevenLabs documents input streaming so far? — rests on F11, I4
- write-prd: should the cost-per-minute formula in I2, filled from logged sessions, be the cost success measure, and in what currency and date basis? — rests on I2

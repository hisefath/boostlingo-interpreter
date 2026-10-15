# Sources

Append-only log of every source read for `docs/research/`. One row per read; a source keeps its S-id forever
(reading it again appends a new row with the same S-id and the new date). Never edit, renumber or delete a row.

Tiers: **A** primary/official · **B** reputable secondary · **C** community or generated (never carries a
load-bearing claim). A load-bearing claim needs 1 Tier-A or 2 independent Tier-B sources.

<!-- Row shape: | S01.1 | <title, no pipes> | <url, or repo path + locator> | A | <YYYY-MM-DD> | R01 F1: <claim, 12 words max> | -->

| S-id | title | url | tier | date read | supports |
|---|---|---|---|---|---|
| S01.1 | OpenAI Realtime API guide | https://developers.openai.com/api/docs/guides/realtime | A | 2026-10-14 | R01 F1: WebRTC in browser, WebSocket on server; client_secrets endpoint |
| S01.2 | OpenAI Realtime translation guide | https://developers.openai.com/api/docs/guides/realtime-translation | A | 2026-10-14 | R01 F3: gpt-realtime-translate, /v1/realtime/translations, session.* transcript and audio deltas |
| S01.3 | OpenAI Realtime voice activity detection guide | https://developers.openai.com/api/docs/guides/realtime-vad | A | 2026-10-14 | R01 F6: server_vad default, semantic_vad, speech_started and speech_stopped events |
| S01.4 | OpenAI Realtime conversations guide | https://developers.openai.com/api/docs/guides/realtime-conversations | A | 2026-10-14 | R01 F7: voice turn event order incl. response.output_audio.delta |
| S01.5 | OpenAI Realtime WebRTC guide | https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime | A | 2026-10-14 | R01 F2: ephemeral key vs unified SDP interface, oai-events channel |
| S01.6 | OpenAI API reference create client secret | https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create | A | 2026-10-14 | R01 F4: expires_after 10-7200 s, default 600 s; VAD defaults |
| S01.7 | OpenAI API pricing | https://developers.openai.com/api/docs/pricing | A | 2026-10-14 | R01 F11: gpt-realtime audio $32 in $64 out per 1M; translate $0.034/min |
| S01.8 | OpenAI Realtime managing costs guide | https://developers.openai.com/api/docs/guides/realtime-costs | A | 2026-10-14 | R01 F12: input 1 token/100 ms, output 1 token/50 ms; context re-billed |
| S01.9 | OpenAI Realtime SIP guide | https://developers.openai.com/api/docs/guides/realtime-sip | A | 2026-10-14 | R01 F5: SIP for phone trunks via webhook and accept endpoint |
| S01.10 | OpenAI Realtime server events reference | https://developers.openai.com/api/reference/resources/realtime/server-events | A | 2026-10-14 | R01 F8: input_audio_transcription delta/completed; output_audio_buffer.started WebRTC/SIP |
| S01.11 | OpenAI Realtime prompting guide | https://developers.openai.com/api/docs/guides/realtime-models-prompting | A | 2026-10-14 | R01 F10: pin output language; no translate-only guidance |
| S01.12 | OpenAI model page gpt-realtime-translate | https://developers.openai.com/api/docs/models/gpt-realtime-translate | A | 2026-10-14 | R01 F3: translations endpoint only, $0.034/min, languages not listed |
| S02.2 | Deepgram Pricing | https://deepgram.com/pricing | A | 2026-10-14 | R02 F5: Nova-3 streaming $0.0048/0.0058 per min; Aura-2 $0.030/1k chars |
| S02.3 | AssemblyAI Pricing | https://www.assemblyai.com/pricing | A | 2026-10-14 | R02 F7: Universal-Streaming $0.15/hr, session-time billing, multilingual incl ES |
| S02.4 | Soniox Pricing | https://soniox.com/pricing | A | 2026-10-14 | R02 F9: real-time STT $0.12/hr; token rates; 60+ languages |
| S02.6 | ElevenLabs API Pricing | https://elevenlabs.io/pricing/api | A | 2026-10-14 | R02 F10: Flash $0.04/1K chars ~75ms; Multilingual v2 $0.08/1K |
| S02.7 | ElevenLabs TTS WebSocket stream-input reference | https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input | A | 2026-10-14 | R02 F11: partial text input, chunk_length_schedule, flush |
| S02.8 | DeepL Pro API page | https://www.deepl.com/en/pro-api | A | 2026-10-14 | R02 F14: no API per-character price shown; Free 50,000 chars |
| S02.9 | Amazon Polly Pricing | https://aws.amazon.com/polly/pricing/ | A | 2026-10-14 | R02 F12: Standard $4, Neural $16, Generative $30 per 1M chars |
| S02.10 | Azure Speech Services Pricing | https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/ | A | 2026-10-14 | R02 F15: price fields rendered as placeholders, unread |
| S02.11 | OpenAI Realtime transcription guide | https://developers.openai.com/api/docs/guides/realtime-transcription | A | 2026-10-14 | R02 F4: delta/completed events; gpt-live-transcribe has no server VAD |
| S02.12 | Deepgram Endpointing docs | https://developers.deepgram.com/docs/endpointing | A | 2026-10-14 | R02 F6: speech_final on pause; endpointing ms; UtteranceEnd settings |
| S02.13 | AssemblyAI Universal Streaming docs | https://www.assemblyai.com/docs/speech-to-text/universal-streaming | A | 2026-10-14 | R02 F8: Turn messages, word_is_final, end_of_turn |
| S02.15 | Anthropic Claude API Pricing | https://platform.claude.com/docs/en/about-claude/pricing | A | 2026-10-14 | R02 F13: Haiku, Sonnet, Opus per-MTok input/output prices |
| S03.1 | jiwer README | https://github.com/jitsi/jiwer | A | 2026-10-14 | R03 F2: WER/MER/WIL/CER via minimum edit distance; cites Morris 2004 |
| S03.2 | Radford et al. 2022 Robust Speech Recognition via Large-Scale Weak Supervision (Whisper) | https://arxiv.org/html/2212.04356 | A | 2026-10-14 | R03 F3: WER penalizes formatting; extensive normalization before WER |
| S03.3 | Post 2018 A Call for Clarity in Reporting BLEU Scores (sacreBLEU) | https://arxiv.org/abs/1804.08771 | A | 2026-10-14 | R03 F4: BLEU varies with tokenization; sacreBLEU standardizes WMT scheme |
| S03.4 | Rei et al. 2020 COMET | https://arxiv.org/abs/2009.09025 | A | 2026-10-14 | R03 F5: neural metric using source and reference; SOTA human correlation |
| S03.5 | Hugging Face evaluate WER metric card | https://huggingface.co/spaces/evaluate-metric/wer/raw/main/README.md | A | 2026-10-14 | R03 F1: WER = (S + D + I) / N definition |
| S03.6 | google/fleurs dataset card README | https://huggingface.co/datasets/google/fleurs/raw/main/README.md | A | 2026-10-14 | R03 F7: en_us and es_419 splits, transcription fields, cc-by-4.0 |
| S03.7 | Wang et al. 2020 CoVoST 2 | https://arxiv.org/html/2007.10310 | A | 2026-10-14 | R03 F8: Es-to-En included; En-to-Es not; CC0; Common Voice based |
| S03.8 | Conneau et al. 2022 FLEURS | https://arxiv.org/abs/2205.12446 | A | 2026-10-14 | R03 F6: n-way parallel 102 languages on FLoRes-101; about 12 h each |
| S04.1 | Gauntlet portal Boostlingo company panel | Gauntlet portal Boostlingo company panel, 2026-10-14 (paraphrased by supervisor) | A | 2026-10-14 | R04 F1-F4: platform, scale, compliance, stack, team size |
| S04.2 | Boostlingo homepage | https://boostlingo.com | A | 2026-10-14 | R04 F5: product lines incl. AI Interpreter, AI Pro, segments |
| S04.3 | Boostlingo Greenhouse job board | https://job-boards.greenhouse.io/boostlingo | A | 2026-10-14 | R04 F8: two open roles, one Engineer II |
| S04.4 | Boostlingo Engineer II posting | https://job-boards.greenhouse.io/boostlingo/jobs/5443993008 | A | 2026-10-14 | R04 F9: agentic framework, AI failure modes, evals; no languages |
| S04.5 | About Boostlingo | https://boostlingo.com/company/ | A | 2026-10-14 | R04 F7: founded 2016 SF, HQ Austin since 2021 |
| S04.6 | Boostlingo AI Interpreter product page | https://boostlingo.com/ai-interpreter/ | A | 2026-10-14 | R04 F6: speech-to-speech AI, 23 languages, one-tap human handoff |
| S04.7 | Boostlingo pricing page | https://boostlingo.com/pricing/ | A | 2026-10-14 | R04 F10: subscription, quote only, no per-minute rates |
| S04.8 | BoostLingo GitHub organization | https://github.com/Boostlingo | A | 2026-10-14 | R04 F11: public SDK repos in Kotlin and Swift |
| S04.9 | M1 prompt review (summarises Boostlingo project PDF) | specs/M1-interpreter-tradeoffs/prompt-review.md REQ-20 | A | 2026-10-14 | R04 F12: PDF prefers C#/.NET backend, TypeScript frontend |
| S05.1 | Arkansas contract 40-00000-24-00076AG Linguistica pricing 2025-07-29 | https://sas.arkansas.gov/wp-content/uploads/40-00000-24-00076AG-Linguistica-Pricing-2025-07-29.pdf | A | 2026-10-14 | R05 F1: Spanish OPI 0.47 USD/min, VRI 0.77 USD/min |
| S05.2 | Wordly pricing | https://www.wordly.ai/pricing | A | 2026-10-14 | R05 F4: 10-hour package about 1,500 USD, hour tiers |
| S05.3 | Wordly homepage | https://www.wordly.ai/ | A | 2026-10-14 | R05 F3: AI meeting translation, 5,000 customers claimed |
| S05.4 | KUDO pricing | https://kudo.ai/pricing/ | A | 2026-10-14 | R05 F5: KUDO AI quote-only, events and webinars |
| S05.5 | Nimdzi 100 2026 | https://www.nimdzi.com/nimdzi-100-2026/ | B | 2026-10-14 | R05 F6-F8: industry 72.6B USD 2025, interpreting 33.6% of top 100 |
| S02.10 | Azure Speech pricing | https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/ | A | 2026-10-14 | R05 F9: speech translation billed per audio hour; figures not rendered |
| S06.1 | Ng et al. Uptake of a free province-wide telephone interpretation service by family physicians in BC (BCMJ vol 65 no 5) | https://bcmj.org/sites/default/files/BCMJ_Vol65_No5-interpretation-service.pdf | B | 2026-10-14 | R06 F1: average call 21 min, range 1-266, most under 20 |
| S06.2 | Patient Time Spent With Professional Medical Interpreters (J Prim Care Community Health 2024) | https://pmc.ncbi.nlm.nih.gov/articles/PMC11265237 | B | 2026-10-14 | R06 F2-F3: 47.7 min encounter time; 72% Spanish at one site |

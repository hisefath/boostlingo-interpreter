---
id: R03
question: "How is interpretation quality measured credibly in a small study (WER, a translation score), and which public EN/ES test set has references?"
asked_in: specs/M1-interpreter-tradeoffs/brief.md#research-questions
unblocks: "PRD quality success measure; acceptance test set (SM-03)"
answered_when: "Tier-A paper/dataset card for WER, one translation metric, one dataset"
status: partial
confidence: medium
supersedes: none
date: 2026-10-14
budget: 15/15 tool calls
researched_by: Claude Code, claude-opus-5-5
---

# R03 Measuring interpretation quality in a small EN/ES study

## Answer

The source side is scored with word error rate, WER = (S + D + I) / N, found by minimum edit distance. jiwer
computes it, along with MER, WIL and CER. WER means little unless both texts are normalized first, which is why the
Whisper authors built an extensive normalizer. The target side can be scored with BLEU computed by sacreBLEU, so
the settings stay comparable, or with COMET, a neural metric that reads the source and the reference and reports
state-of-the-art agreement with human judgments. FLEURS is n-way parallel, CC-BY-4.0 and has `en_us` and `es_419`
splits with transcriptions, so it can supply both transcripts and translation references. CoVoST 2 covers Spanish
to English only. Still open: the minimum test-set size, ASR-BLEU for speech output, and MOS. Confidence: medium,
because all "Answered when" sources are Tier A but the sample-size question remains a load-bearing gap. (S03.1,
S03.2, S03.3, S03.4, S03.5, S03.6, S03.7, S03.8)

## Takeaway

To check what the system heard, count how many words its transcript gets wrong against a correct one, after
cleaning up harmless formatting differences. To check the translation, score it against a professional translation
of the same sentence, using a public dataset that has the same sentences recorded in both English and Spanish.

## Findings

- **F1** [LB] "WER = (S + D + I) / N = (S + D + I) / (S + D + C)". S = substitutions, D = deletions, I = insertions, C = correct words, N = words in the reference. 0 is perfect. — S03.5 (A), Hugging Face evaluate WER metric card
- **F2** [LB] jiwer computes WER, MER, WIL, WIP and CER "with the use of the minimum-edit distance" (via RapidFuzz). An empty reference with a non-empty hypothesis counts every word as an insertion. It cites Morris, Maier and Green (2004). Its README describes no built-in normalization. — S03.1 (A), jiwer README
- **F3** [LB] WER "penalizes all differences" from the reference, including harmless formatting. Whisper applies "extensive standardization of text before the WER calculation" (contractions, numbers and money written two ways). The rules are in Appendix C, which was not read. — S03.2 (A), §3.2, §4.4
- **F4** [LB] BLEU is parameterized, so "BLEU scores between papers cannot be directly compared". The main cause is reference tokenization and normalization, with differences up to 1.8. sacreBLEU applies the WMT scheme with no user-supplied reference processing. — S03.3 (A), abstract
- **F5** [LB] COMET is a neural MT-evaluation framework built on cross-lingual pretrained models. It uses "both the source input and a target-language reference translation" and reports state-of-the-art correlation with human judgements on the WMT 2019 Metrics task. — S03.4 (A), abstract
- **F6** [LB] FLEURS is "an n-way parallel speech dataset in 102 languages built on top of" FLoRes-101, with about 12 hours of supervision per language, and lists translation and retrieval tasks. — S03.8 (A), abstract
- **F7** [LB] The google/fleurs dataset card has configs `en_us` (train/validation/test 2,602 / 394 / 647 utterances) and `es_419` (2,796 / 408 / 908). Fields include `id`, `transcription`, `raw_transcription` and 16 kHz `audio`. License cc-by-4.0. The fetched card text is framed as XTREME-S. — S03.6 (A), dataset card README
- **F8** CoVoST 2 covers 21 languages into English, including Spanish→English, and English into 15 languages, which do not include Spanish. Translations come from professional translators, the data is CC0, and it builds on Common Voice. — S03.7 (A), Abstract, §1, §2.1, §2.2

## Inferences

- **I1** from F6 + F7: because FLEURS is n-way parallel, the `es_419` transcription of a sentence can serve as the
  reference translation for the `en_us` audio of the same FLoRes sentence, and the reverse. This covers both
  directions with one dataset. Medium confidence: the sentence-level join key between configs (`id`) was not
  verified, and FLoRes sentences are read Wikipedia-style text, not conversation.
- **I2** from F1 + F2 + F3 + F4: WER and BLEU both swing with text preprocessing. A credible small study fixes and
  publishes the normalization (and the sacreBLEU settings) before it scores anything. High confidence.
- **I3** from F5 + F8: COMET needs source, hypothesis and reference text. Scoring speech output with it therefore
  needs a transcript of the output audio first, an ASR-BLEU-style step that this pass did not read up on. Medium
  confidence.

## Gaps

- ⚠ [LB] What minimum test-set size gives a usable confidence interval for WER or BLEU/COMET differences? — why: unread: https://aclanthology.org/W04-3250.pdf (the fetch returned binary PDF streams, and the cap was reached) — would close it: read Koehn 2004 (bootstrap resampling) §§ on test-set size
- ⚠ [LB] How is ASR-BLEU defined for speech-to-speech output (which ASR model, and how it is normalized)? — why: unread; the abstract of arXiv 2107.05604 does not describe it — would close it: read that paper's evaluation section, or the SeamlessM4T or Translatotron 2 evaluation sections
- ⚠ [LB] Answered-when evidence missing for the minimum test-set size part of the question, which the brief's SM-03 needs — would close it: as above
- ⚠ What is the standard for human MOS ratings of speech output (scale, raters)? — why: cap reached — would close it: read ITU-T P.800
- ⚠ Does chrF behave better than BLEU at the sentence level? — why: cap reached — would close it: read Popović 2015 (aclanthology W15-3049)
- ⚠ Does COMET outperform BLEU and chrF on human correlation? — why: only the COMET abstract was read; it does not name BLEU or chrF — would close it: read the COMET paper's results tables, or Kocmi et al. 2021 (arXiv 2107.10821)
- ⚠ What are Whisper's exact normalizer rules? — why: Appendix C was not read (S03.2 truncated) — would close it: read arxiv.org/html/2212.04356 Appendix C
- ⚠ Can Common Voice EN/ES serve as an extra source-side WER set (license, validated clips)? — why: cap reached — would close it: read the Common Voice dataset card
- ⚠ Does the FLEURS `id` field align sentences across `en_us` and `es_419`? — why: not stated in the text read — would close it: load both test splits and compare ids and FLoRes sentences

## Handoffs

- write-prd: should the quality success measure be source-side WER (normalized, with jiwer) plus one target-side score (BLEU via sacreBLEU, COMET, or both), and at what threshold? — rests on F1–F5, I2
- write-prd: should the quality measure also cover the spoken output (ASR-BLEU-style transcription of the TTS audio, or a human MOS), given that both remain open gaps? — rests on I3
- write-prd: what test-set size (number of utterances per direction) will SM-03 commit to, given that the sample-size evidence is still a gap? — rests on F7
- design-hld: should the evaluation harness use the FLEURS `en_us` and `es_419` test splits (647 and 908 utterances) as the shared EN↔ES set, with CoVoST 2 available only for ES→EN? — rests on F6, F7, F8, I1

// Vendor list prices used by score.ts. Sources: docs/research/R01-realtime-voice-api.md (F11, I3) and
// docs/research/R02-streaming-cascade-vendors.md (F1-F5). Re-check before quoting; promo rates expire.

/** Realtime audio tokenisation: 1 token per 100 ms in, 1 per 50 ms out (R01 F11/I3, S01.7, S01.12). */
export const REALTIME_TOKENS_PER_MIN = { in: 600, out: 1200 };

export const PRICES = {
  realtime: {
    // gpt-realtime audio per 1M tokens: $32 in, $0.40 cached in, $64 out (R01 F11; S01.7, S01.12)
    audioInPer1M: 32,
    cachedInPer1M: 0.4,
    audioOutPer1M: 64,
    // input transcription via gpt-4o-transcribe ~$0.006/min (R01 F11; S01.7)
    transcribePerMin: 0.006,
  },
  cascade: {
    // Deepgram Nova-3 streaming multilingual $0.0058/min, promotional (R02 F5; S02.2)
    deepgramSttPerMin: 0.0058,
    // gpt-4o-transcribe ~$0.006/min (R02 F1; S01.7)
    openaiSttPerMin: 0.006,
    // gpt-4.1-mini $0.40 in / $1.60 out per 1M text tokens (R02 F3; S01.7)
    translateInPer1M: 0.4,
    translateOutPer1M: 1.6,
    // gpt-4o-mini-tts $12 per 1M audio output tokens (R02 F2; S01.7). The page gives no per-minute figure;
    // we assume the realtime rate of 1200 audio tokens per output minute (assumption, not sourced).
    ttsAudioOutPer1M: 12,
    // Deepgram Aura-2 $0.030 per 1k characters (R02 F5; S02.2)
    deepgramTtsPer1kChars: 0.03,
  },
};

// ElevenLabs streaming TTS over plain fetch (lld.md §9), output pcm_24000.
import type { Tts } from "../../../shared/contracts.ts";
import { LANGUAGES } from "../../../shared/languages.ts";

/** the low-latency model that also speaks the languages Flash v2.5 does not (e.g. Bengali) */
export const ELEVENLABS_WIDE_LANGUAGE_MODEL = "eleven_v4_turbo";
import { checkResponse, pcm16Chunks } from "../vendor-adapter-helpers.ts";

export function elevenlabsTts(
  apiKey: string,
  voiceId = "21m00Tcm4TlvDq8ikWAM",
  model = "eleven_flash_v2_5",
): Tts {
  return {
    name: "elevenlabs",
    async *speak(request, signal) {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_24000`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          text: request.text,
          model_id:
            LANGUAGES[request.lang]?.elevenLabsFlash === false ? ELEVENLABS_WIDE_LANGUAGE_MODEL : model,
          language_code: request.lang,
        }),
        signal,
      });
      await checkResponse("tts", response);
      yield* pcm16Chunks("tts", response);
    },
  };
}

// ElevenLabs streaming TTS over plain fetch (lld.md §9), output pcm_24000.
import type { Tts } from "../../../shared/contracts.ts";
import { checkResponse, pcmChunks } from "../http.ts";

export function elevenlabsTts(
  apiKey: string,
  voiceId = "21m00Tcm4TlvDq8ikWAM",
  model = "eleven_flash_v2_5",
): Tts {
  return {
    name: "elevenlabs",
    async *speak(req, signal) {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_24000`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ text: req.text, model_id: model, language_code: req.lang }),
        signal,
      });
      await checkResponse("tts", res);
      yield* pcmChunks("tts", res);
    },
  };
}

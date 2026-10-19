// OpenAI speech: response_format pcm = PCM16 24 kHz mono, streamed.
import type { Tts } from "../../../shared/contracts.ts";
import { checkResponse, pcm16Chunks } from "../vendor-adapter-helpers.ts";

export function openaiTts(apiKey: string, model = "gpt-4o-mini-tts", voice = "alloy"): Tts {
  return {
    name: "openai",
    async *speak(request, signal) {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, voice, input: request.text, response_format: "pcm" }),
        signal,
      });
      await checkResponse("tts", response);
      yield* pcm16Chunks("tts", response);
    },
  };
}

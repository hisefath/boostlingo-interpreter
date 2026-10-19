// OpenAI streaming chat completions translator (lld.md §1, §6). Plain fetch + SSE parsing.
import { ProviderError } from "../../../shared/contracts.ts";
import type { Translator } from "../../../shared/contracts.ts";
import { LANG_NAME, checkResponse, interpreterInstructions } from "../http.ts";

export function openaiTranslator(apiKey: string, model = "gpt-4.1-mini"): Translator {
  return {
    name: "openai",
    async *translate(req, signal) {
      const system =
        interpreterInstructions(req.from, req.to) +
        ` Output only the ${LANG_NAME[req.to]} interpretation of the latest ${LANG_NAME[req.from]} utterance, nothing else.`;
      const messages = [{ role: "system", content: system }];
      for (const t of req.context) {
        messages.push({ role: "user", content: t.srcText }, { role: "assistant", content: t.tgtText });
      }
      messages.push({ role: "user", content: req.text });
      let res: Response;
      try {
        res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model, messages, stream: true, temperature: 0 }),
          signal,
        });
      } catch (e) {
        if (signal.aborted) throw e;
        throw new ProviderError("translate", "disconnected", String(e));
      }
      await checkResponse("translate", res);
      if (!res.body) throw new ProviderError("translate", "empty");
      const decoder = new TextDecoder();
      let buf = "";
      for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(part, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) yield delta as string;
        }
      }
    },
  };
}

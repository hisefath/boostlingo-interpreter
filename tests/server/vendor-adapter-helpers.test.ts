// REQ-12: the vendor-adapter side of the provider boundary (error mapping, PCM chunking, SSE parsing). No network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "../../src/shared/contracts.ts";
import { checkResponse, pcm16Chunks } from "../../src/server/providers/vendor-adapter-helpers.ts";
import { openaiTranslator } from "../../src/server/providers/translate/openai.ts";

const stream = (parts: Array<number[] | string>) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts)
        c.enqueue(typeof p === "string" ? new TextEncoder().encode(p) : new Uint8Array(p));
      c.close();
    },
  });
const rejection = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as ProviderError,
  );

describe("checkResponse", () => {
  it("passes an ok response through", async () => {
    await expect(checkResponse("tts", new Response("x"))).resolves.toBeUndefined();
  });

  it("429 -> rate_limited with Retry-After in ms (1 s when absent)", async () => {
    const e = await rejection(
      checkResponse("translate", new Response(null, { status: 429, headers: { "retry-after": "3" } })),
    );
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({ stage: "translate", kind: "rate_limited", retryAfterMs: 3000 });
    const bare = await rejection(checkResponse("translate", new Response(null, { status: 429 })));
    expect(bare).toMatchObject({ kind: "rate_limited", retryAfterMs: 1000 });
  });

  it("408 and 504 -> timeout; other errors -> failed", async () => {
    for (const status of [408, 504])
      expect(await rejection(checkResponse("stt", new Response(null, { status })))).toMatchObject({
        stage: "stt",
        kind: "timeout",
      });
    for (const status of [500, 503, 401])
      expect(await rejection(checkResponse("tts", new Response(null, { status })))).toMatchObject({
        kind: "failed",
        message: `tts HTTP ${status}`,
      });
  });
});

describe("pcm16Chunks", () => {
  it("carries an odd byte into the next chunk so a sample is never split", async () => {
    const out: number[][] = [];
    for await (const c of pcm16Chunks("tts", new Response(stream([[1, 2, 3], [4, 5], [6]]))))
      out.push([...c]);
    expect(out).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("a body with no whole sample is empty", async () => {
    const e = await rejection(
      (async () => {
        for await (const _ of pcm16Chunks("tts", new Response(stream([[7]])))) void _;
      })(),
    );
    expect(e).toMatchObject({ stage: "tts", kind: "empty" });
  });
});

describe("openai translator", () => {
  afterEach(() => vi.unstubAllGlobals());
  const request = {
    turnId: "t1",
    text: "Hola.",
    from: "es" as const,
    to: "en" as const,
    context: [{ srcText: "Buenos días.", tgtText: "Good morning.", from: "es" as const, to: "en" as const }],
  };
  const collect = async (it: AsyncIterable<string>) => {
    const out: string[] = [];
    for await (const d of it) out.push(d);
    return out;
  };

  it("parses SSE deltas split across chunks, skips non-data lines and stops at [DONE]", async () => {
    const sse = [
      ': keep-alive\n\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\n',
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":"."}}]}\n',
      'data: [DONE]\ndata: {"choices":[{"delta":{"content":"never"}}]}\n',
    ];
    const fetchStub = vi.fn(async () => new Response(stream(sse)));
    vi.stubGlobal("fetch", fetchStub);
    expect(await collect(openaiTranslator("k").translate(request, new AbortController().signal))).toEqual([
      "Hello",
      ".",
    ]);
    const body = JSON.parse((fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.stream).toBe(true);
    // earlier turns are background in the system prompt, never replayed as chat (prompt-injection guard, d2c068f)
    expect(body.messages.slice(1)).toEqual([{ role: "user", content: "<utterance>Hola.</utterance>" }]);
    expect(body.messages[0].content).toContain("Buenos días.");
  });

  it("a network failure -> disconnected; a 429 -> rate_limited", async () => {
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("fetch failed")));
    expect(
      await rejection(collect(openaiTranslator("k").translate(request, new AbortController().signal))),
    ).toMatchObject({
      stage: "translate",
      kind: "disconnected",
    });
    vi.stubGlobal("fetch", async () => new Response(null, { status: 429, headers: { "retry-after": "2" } }));
    expect(
      await rejection(collect(openaiTranslator("k").translate(request, new AbortController().signal))),
    ).toMatchObject({
      kind: "rate_limited",
      retryAfterMs: 2000,
    });
  });
});

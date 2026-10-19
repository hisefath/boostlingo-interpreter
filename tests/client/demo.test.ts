import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScript, progressText, readyForNext, settled, type DemoTurn } from "../../src/client/demo.ts";

const good: DemoTurn = { id: "d01", speaker: "Ana", lang: "en", text: "Hello.", voice: "coral" };

describe("parseScript", () => {
  it("accepts a valid script and keeps only the known fields", () => {
    expect(parseScript([{ ...good, extra: 1 }])).toEqual([good]);
  });
  it("rejects a non-array or empty script", () => {
    expect(() => parseScript({})).toThrow(/non-empty array/);
    expect(() => parseScript([])).toThrow(/non-empty array/);
  });
  it.each([
    ["missing id", { ...good, id: undefined }],
    ["path-like id", { ...good, id: "../x" }],
    ["unknown lang", { ...good, lang: "fr" }],
    ["blank speaker", { ...good, speaker: " " }],
    ["blank text", { ...good, text: "" }],
    ["missing voice", { ...good, voice: undefined }],
    ["null turn", null],
  ])("rejects a turn with %s, naming it", (_, bad) => {
    expect(() => parseScript([good, bad])).toThrow("demo turn 2 is invalid");
  });
});

describe("the shipped demo script", () => {
  const script = parseScript(JSON.parse(readFileSync("demo/conversation.json", "utf8")));
  it("is 8 turns d01..d08 alternating Ana (en) and Sra. Gómez (es)", () => {
    expect(script.map((t) => t.id)).toEqual(["d01", "d02", "d03", "d04", "d05", "d06", "d07", "d08"]);
    script.forEach((t, i) =>
      expect([t.speaker, t.lang]).toEqual(i % 2 ? ["Sra. Gómez", "es"] : ["Ana", "en"]),
    );
  });
  it("gives each speaker one voice, distinct from the other's", () => {
    const voices = (lang: string) => new Set(script.filter((t) => t.lang === lang).map((t) => t.voice));
    expect(voices("en").size).toBe(1);
    expect(voices("es").size).toBe(1);
    expect([...voices("en")][0]).not.toBe([...voices("es")][0]);
  });
});

describe("progressText", () => {
  const t: DemoTurn = { ...good, speaker: "Sra. Gómez", lang: "es", text: "¿Necesito traer algo más?" };
  it("shows position, speaker, language and the full short text", () => {
    expect(progressText(2, 8, t)).toBe("Demo 3/8 · Sra. Gómez (ES): ¿Necesito traer algo más?");
  });
  it("truncates long text to max characters with an ellipsis", () => {
    expect(progressText(2, 8, t, 16)).toBe("Demo 3/8 · Sra. Gómez (ES): ¿Necesito traer…");
    expect(progressText(2, 8, t, 15)).toBe("Demo 3/8 · Sra. Gómez (ES): ¿Necesito trae…"); // ≤ max chars incl. "…"
    expect(progressText(2, 8, t, t.text.length)).toMatch(/más\?$/);
  });
});

describe("pacing", () => {
  const turn = (state: string, timings: Record<string, number> = {}) =>
    ({ state, timings }) as Parameters<typeof settled>[0];
  it("a done turn whose audio is still playing is not settled", () => {
    expect(settled(turn("done", { first_audio: 1 }))).toBe(false);
    expect(settled(turn("done", { first_audio: 1, audio_end: 2 }))).toBe(true);
  });
  it("a terminal turn with nothing to play is settled", () => {
    expect(settled(turn("done"))).toBe(true);
    expect(settled(turn("failed", { first_audio: 1 }))).toBe(true);
    expect(settled(turn("empty"))).toBe(true);
    expect(settled(turn("cut", { first_audio: 1 }))).toBe(true);
  });
  it("interpreted audio ending settles a turn even before its state is terminal", () => {
    expect(settled(turn("speaking", { first_audio: 1, audio_end: 2 }))).toBe(true);
    expect(settled(turn("speaking", { first_audio: 1 }))).toBe(false);
    expect(settled(turn("translating"))).toBe(false);
  });
  it("waits for the clip to end, for at least one turn, and for every turn to settle", () => {
    expect(readyForNext([turn("done")], true)).toBe(true);
    expect(readyForNext([turn("done")], false)).toBe(false);
    expect(readyForNext([], true)).toBe(false);
    expect(readyForNext([turn("done"), turn("hearing")], true)).toBe(false);
  });
});

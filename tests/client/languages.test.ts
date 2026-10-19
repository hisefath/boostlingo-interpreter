// M5-T011: the browser's guessLanguageWithDefaults (voice-to-voice turn labels) picks within the session's pair.
import { describe, expect, it } from "vitest";
import type { LanguageCode } from "../../src/shared/contracts.ts";
import { guessLanguageWithDefaults, otherLanguage } from "../../src/client/timing-and-audio-helpers.ts";

describe("client guessLanguageWithDefaults within a pair", () => {
  const cases: [LanguageCode, string, LanguageCode][] = [
    ["es", "¿Dónde le duele?", "es"],
    ["fr", "Où avez-vous mal ?", "fr"],
    ["fr", "Je suis allergique à la pénicilline", "fr"],
    ["pt", "Você tem alergia a algum remédio?", "pt"],
    ["zh", "你对什么药物过敏吗？", "zh"],
    ["zh", "Are you allergic to any medicine?", "en"],
    ["pt", "What is your date of birth?", "en"],
  ];
  it.each(cases)("en-%s: %s -> %s", (other, text, want) => {
    const pair: [LanguageCode, LanguageCode] = ["en", other];
    const from = guessLanguageWithDefaults(text, pair[0], pair);
    expect(from).toBe(want);
    expect(otherLanguage(pair, from)).toBe(want === "en" ? other : "en");
  });

  it("never labels a turn with a language outside the pair", () => {
    expect(guessLanguageWithDefaults("¿Dónde le duele?", "en", ["en", "zh"])).toBe("en");
    expect(guessLanguageWithDefaults("我胸口疼", "en", ["en", "es"])).toBe("en");
  });

  it("keeps the en-es default when no pair is given", () => {
    expect(guessLanguageWithDefaults("tengo dolor en el pecho")).toBe("es");
    expect(guessLanguageWithDefaults("", "es")).toBe("es");
  });
});

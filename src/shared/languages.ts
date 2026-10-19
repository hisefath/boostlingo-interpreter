// The one language table (M5-T011). Prompts, STT routing, language detection (server and browser) and the UI pair
// list all read from here. Onboarding a pair = one PAIRS line, plus one LANGUAGES entry if the language is new.
import type { LanguageCode } from "./contracts.ts";

interface LanguageInfo {
  /** English name, as prompts say it */
  name: string;
  nativeName: string;
  /** Deepgram nova-3 `language=multi` hears it; false = the registry routes the session's STT to OpenAI */
  deepgram: boolean;
  /** how the STT prompt names the language (dialect, script) */
  sttHint: string;
  /** how to address the listener politely (clinic front desk); empty = no formal/informal distinction */
  formal: string;
  /** OpenAI TTS speaks it (its documented language list); false = the registry routes speech output elsewhere */
  openaiTts: boolean;
  /** ElevenLabs Flash v2.5 speaks it; false = the ElevenLabs adapter uses eleven_v4_turbo for this language */
  elevenLabsFlash: boolean;
  /** characters English never uses: their presence scores +2 for this language */
  distinctiveCharacters?: RegExp;
  /** common short words, lowercase: each occurrence scores +1 */
  words: Set<string>;
}

const wordSet = (spaceSeparatedWords: string) => new Set(spaceSeparatedWords.split(" "));

export const LANGUAGES = {
  en: {
    name: "English",
    nativeName: "English",
    deepgram: true,
    sttHint: "English",
    formal: "",
    openaiTts: true,
    elevenLabsFlash: true,
    words: wordSet(
      "the a an of and is are i you he she it we they to in on for with do does have has my your what where when how can need this that hello thank yes no",
    ),
  },
  es: {
    name: "Spanish",
    nativeName: "Español",
    deepgram: true,
    sttHint: "Spanish",
    formal: "usted (never tú)",
    openaiTts: true,
    elevenLabsFlash: true,
    distinctiveCharacters: /[ñáéíóúü¿¡]/i,
    words: wordSet(
      "el la los las un una de del que y en por para con es está estoy tengo usted le lo se su sí no muy pero como dónde donde qué cómo cuándo hola gracias señor señora mi al necesito",
    ),
  },
  fr: {
    name: "French",
    nativeName: "Français",
    deepgram: true,
    sttHint: "French",
    formal: "vous (never tu)",
    openaiTts: true,
    elevenLabsFlash: true,
    distinctiveCharacters: /[àâçèéêëîïôùûüÿœ]/i,
    words: wordSet(
      "a le la les un une des de du et est je tu il elle nous vous ils ne pas que qui dans pour avec sur au mon ma mes votre suis ai bonjour merci oui très où comment",
    ),
  },
  pt: {
    name: "Brazilian Portuguese",
    nativeName: "Português (Brasil)",
    deepgram: true,
    sttHint: "Brazilian Portuguese",
    formal: "o senhor / a senhora or você, never tu",
    openaiTts: true,
    elevenLabsFlash: true,
    distinctiveCharacters: /[ãõáâàéêíóôúç]/i,
    words: wordSet(
      "a o os um uma de do da dos das e é em na nos que não sim eu você ele ela meu minha para com por está estou tenho preciso obrigado obrigada olá onde como quando muito",
    ),
  },
  zh: {
    name: "Mandarin Chinese",
    nativeName: "中文",
    deepgram: false,
    sttHint: "Mandarin Chinese written in Simplified Chinese characters",
    formal: "您 (never 你 when addressing the listener)",
    openaiTts: true,
    elevenLabsFlash: true,
    distinctiveCharacters: /[\u3400-\u9fff]/, // CJK ideographs
    words: wordSet(""),
  },
  bn: {
    name: "Bengali",
    nativeName: "বাংলা",
    // Deepgram nova-3 has Bengali only as a single-language model, not in `multi` (needed to tell two languages apart)
    deepgram: false,
    sttHint: "Bengali (Bangla) written in Bengali script",
    formal: "আপনি (apni, never তুমি or তুই)",
    // OpenAI TTS does not list Bengali; ElevenLabs Flash rejects it (HTTP 400); eleven_v4_turbo speaks it (verified live)
    openaiTts: false,
    elevenLabsFlash: false,
    distinctiveCharacters: /[\u0980-\u09ff]/, // Bengali script
    words: wordSet(""),
  },
} satisfies Record<string, LanguageInfo>;

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as LanguageCode[];

export const PAIRS = (
  [
    ["en", "es"],
    ["en", "fr"],
    ["en", "pt"],
    ["en", "zh"],
    ["en", "bn"],
  ] as [LanguageCode, LanguageCode][]
).map(([a, b]) => ({
  /** also the UI <select> value; main.ts splits it on "-" */
  id: `${a}-${b}`,
  langs: [a, b] as [LanguageCode, LanguageCode],
  label: `${LANGUAGES[a].name} ↔ ${LANGUAGES[b].name} (${LANGUAGES[b].nativeName})`,
}));

/** An onboarded pair, either order (trust boundary: /cascade start and /api/realtime-session). */
export const isOnboardedPair = (pair: unknown): pair is [LanguageCode, LanguageCode] =>
  Array.isArray(pair) &&
  pair.length === 2 &&
  pair[0] !== pair[1] &&
  PAIRS.some(({ langs }) => langs.includes(pair[0]) && langs.includes(pair[1]));

/** Which of the pair's two languages `text` is in; no evidence either way → fallback. */
// ponytail: distinctiveCharacters + stopword count heuristic; replace with a vendor language field when one is available.
export function guessLanguage(
  text: string,
  pair: readonly LanguageCode[],
  fallback: LanguageCode = pair[0],
): LanguageCode {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = (language: LanguageCode) => {
    const info: LanguageInfo = LANGUAGES[language];
    return (
      (info.distinctiveCharacters?.test(text) ? 2 : 0) + words.filter((word) => info.words.has(word)).length
    );
  };
  const [firstScore, secondScore] = [score(pair[0]), score(pair[1])];
  return firstScore === secondScore ? fallback : firstScore > secondScore ? pair[0] : pair[1];
}

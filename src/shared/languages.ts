// The one language table (M5-T011). Prompts, STT routing, language detection (server and browser) and the UI pair
// list all read from here. Onboarding a pair = one PAIRS line, plus one LANGUAGES entry if the language is new.
import type { Lang } from "./contracts.ts";

interface LangInfo {
  /** English name, as prompts say it */
  name: string;
  nativeName: string;
  /** Deepgram nova-3 `language=multi` hears it; false = the registry routes the session's STT to OpenAI */
  deepgram: boolean;
  /** how the STT prompt names the language (dialect, script) */
  sttHint: string;
  /** characters English never uses: their presence scores +2 for this language */
  marks?: RegExp;
  /** common short words, lowercase: each occurrence scores +1 */
  words: Set<string>;
}

const w = (s: string) => new Set(s.split(" "));

export const LANGUAGES = {
  en: {
    name: "English",
    nativeName: "English",
    deepgram: true,
    sttHint: "English",
    words: w(
      "the a an of and is are i you he she it we they to in on for with do does have has my your what where when how can need this that hello thank yes no",
    ),
  },
  es: {
    name: "Spanish",
    nativeName: "Español",
    deepgram: true,
    sttHint: "Spanish",
    marks: /[ñáéíóúü¿¡]/i,
    words: w(
      "el la los las un una de del que y en por para con es está estoy tengo usted le lo se su sí no muy pero como dónde donde qué cómo cuándo hola gracias señor señora mi al necesito",
    ),
  },
  fr: {
    name: "French",
    nativeName: "Français",
    deepgram: true,
    sttHint: "French",
    marks: /[àâçèéêëîïôùûüÿœ]/i,
    words: w(
      "a le la les un une des de du et est je tu il elle nous vous ils ne pas que qui dans pour avec sur au mon ma mes votre suis ai bonjour merci oui très où comment",
    ),
  },
  pt: {
    name: "Brazilian Portuguese",
    nativeName: "Português (Brasil)",
    deepgram: true,
    sttHint: "Brazilian Portuguese",
    marks: /[ãõáâàéêíóôúç]/i,
    words: w(
      "a o os um uma de do da dos das e é em na nos que não sim eu você ele ela meu minha para com por está estou tenho preciso obrigado obrigada olá onde como quando muito",
    ),
  },
  zh: {
    name: "Mandarin Chinese",
    nativeName: "中文",
    deepgram: false,
    sttHint: "Mandarin Chinese written in Simplified Chinese characters",
    marks: /[\u3400-\u9fff]/, // CJK ideographs
    words: w(""),
  },
} satisfies Record<string, LangInfo>;

export const LANG_CODES = Object.keys(LANGUAGES) as Lang[];

export const PAIRS = (
  [
    ["en", "es"],
    ["en", "fr"],
    ["en", "pt"],
    ["en", "zh"],
  ] as [Lang, Lang][]
).map(([a, b]) => ({
  /** also the UI <select> value; main.ts splits it on "-" */
  id: `${a}-${b}`,
  langs: [a, b] as [Lang, Lang],
  label: `${LANGUAGES[a].name} ↔ ${LANGUAGES[b].name} (${LANGUAGES[b].nativeName})`,
}));

/** An onboarded pair, either order (trust boundary: /cascade start and /api/realtime-session). */
export const isPair = (p: unknown): p is [Lang, Lang] =>
  Array.isArray(p) &&
  p.length === 2 &&
  p[0] !== p[1] &&
  PAIRS.some(({ langs }) => langs.includes(p[0]) && langs.includes(p[1]));

/** Which of the pair's two languages `text` is in; no evidence either way → fallback. */
// ponytail: marks + stopword count heuristic; replace with a vendor language field when one is available.
export function guessLang(text: string, pair: readonly Lang[], fallback: Lang = pair[0]): Lang {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const score = (l: Lang) => {
    const info: LangInfo = LANGUAGES[l];
    return (info.marks?.test(text) ? 2 : 0) + words.filter((x) => info.words.has(x)).length;
  };
  const [a, b] = [score(pair[0]), score(pair[1])];
  return a === b ? fallback : a > b ? pair[0] : pair[1];
}

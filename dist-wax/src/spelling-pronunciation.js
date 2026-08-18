export const SPELLING_PRONUNCIATION_DICTIONARY_URL = new URL(
  "../vendor/cmudict/cmudict-en-us.dict",
  import.meta.url,
);

const VOWEL_PHONES = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY",
  "IH", "IY", "OW", "OY", "UH", "UW",
]);

const PHONE_DEFINITIONS = Object.freeze({
  AA: phone("o", ["o"], true),
  AE: phone("a", ["a"], true),
  AH: phone("u", ["u"], true),
  AO: phone("au", ["ao"], true),
  AW: phone("ou", ["o", "uw"], true),
  AY: phone("ay", ["o", "iy"], true),
  B: phone("b", ["b"]),
  CH: phone("ch", ["c"]),
  D: phone("d", ["d"]),
  DH: phone("dh", ["dh"]),
  EH: phone("e", ["e"], true),
  ER: phone("er", ["u", "r"], true),
  EY: phone("ai", ["e", "iy"], true),
  F: phone("f", ["f"]),
  G: phone("g", ["g"]),
  HH: phone("h", ["h"]),
  IH: phone("i", ["i"], true),
  IY: phone("ee", ["iy"], true),
  JH: phone("j", ["j"]),
  K: phone("k", ["k"]),
  L: phone("l", ["l"]),
  M: phone("m", ["m"]),
  N: phone("n", ["n"]),
  NG: phone("ng", ["ng"]),
  OW: phone("oa", ["ao", "uw"], true),
  OY: phone("oi", ["ao", "iy"], true),
  P: phone("p", ["p"]),
  R: phone("r", ["r"]),
  S: phone("s", ["s"]),
  SH: phone("sh", ["sh"]),
  T: phone("t", ["t"]),
  TH: phone("th", ["th"]),
  UH: phone("uh", ["uw"], true),
  UW: phone("oo", ["uw"], true),
  V: phone("v", ["v"]),
  W: phone("w", ["w"]),
  Y: phone("y", ["y"]),
  Z: phone("z", ["z"]),
  ZH: phone("zh", ["sh"], false, 0.88),
});

const PRONUNCIATION_OVERRIDES = new Map(Object.entries({
  live: ["L", "IH", "V"],
  read: ["R", "IY", "D"],
  wind: ["W", "IH", "N", "D"],
}));

const FALLBACK_WORDS = new Map(Object.entries({
  morphazoid: ["M", "AO", "R", "F", "AH", "Z", "OY", "D"],
  readback: ["R", "IY", "D", "B", "AE", "K"],
  speech: ["S", "P", "IY", "CH"],
  spelling: ["S", "P", "EH", "L", "IH", "NG"],
  synthesis: ["S", "IH", "N", "TH", "AH", "S", "AH", "S"],
  synthesizer: ["S", "IH", "N", "TH", "AH", "S", "AY", "Z", "ER"],
  the: ["DH", "AH"],
  voice: ["V", "OY", "S"],
  words: ["W", "ER", "D", "Z"],
}));

const cachedPronunciations = new Map([
  ...PRONUNCIATION_OVERRIDES,
  ...FALLBACK_WORDS,
]);
const cachedMisses = new Set();
let dictionaryTextPromise = null;

function phone(sampleKey, gestures, vowel = false, voicing = null) {
  return Object.freeze({
    sampleKey,
    gestures: Object.freeze([...gestures]),
    vowel,
    voicing,
  });
}

function normalizeWord(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/^[^a-z']+|[^a-z']+$/g, "");
}

function wordsIn(value) {
  return [...String(value ?? "").matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)]
    .map((match) => normalizeWord(match[0]))
    .filter(Boolean);
}

export function spellingPhoneDefinition(value) {
  return PHONE_DEFINITIONS[String(value ?? "").toUpperCase()] ?? null;
}

export function isSpellingPronunciationVowel(value) {
  return VOWEL_PHONES.has(String(value ?? "").toUpperCase());
}

export function parseSpellingPronunciations(value, requestedWords = null) {
  const requested = requestedWords
    ? new Set([...requestedWords].map(normalizeWord).filter(Boolean))
    : null;
  const pronunciations = new Map();
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 2) continue;
    const key = normalizeWord(fields[0].replace(/\(\d+\)$/, ""));
    if (!key || pronunciations.has(key) || (requested && !requested.has(key))) continue;
    const phones = fields.slice(1).map((entry) => entry.replace(/\d/g, "").toUpperCase());
    if (!phones.length || phones.some((entry) => !PHONE_DEFINITIONS[entry])) continue;
    pronunciations.set(key, Object.freeze(phones));
    if (requested && pronunciations.size === requested.size) break;
  }
  return pronunciations;
}

async function dictionaryText(fetcher) {
  if (!dictionaryTextPromise) {
    dictionaryTextPromise = Promise.resolve(
      fetcher(SPELLING_PRONUNCIATION_DICTIONARY_URL),
    ).then(async (response) => {
      if (!response || response.ok === false || typeof response.text !== "function") {
        throw new Error("The pronunciation dictionary could not be loaded.");
      }
      return response.text();
    }).catch((error) => {
      dictionaryTextPromise = null;
      throw error;
    });
  }
  return dictionaryTextPromise;
}

export async function loadSpellingPronunciations(value, {
  fetcher = globalThis.fetch,
} = {}) {
  const requested = new Set(wordsIn(value));
  const missing = new Set([...requested].filter((word) => (
    !cachedPronunciations.has(word) && !cachedMisses.has(word)
  )));
  if (missing.size && typeof fetcher === "function") {
    try {
      const loaded = parseSpellingPronunciations(await dictionaryText(fetcher), missing);
      for (const [word, phones] of loaded) cachedPronunciations.set(word, phones);
      for (const word of missing) {
        if (!loaded.has(word)) cachedMisses.add(word);
      }
    } catch {}
  }
  const result = new Map();
  for (const word of requested) {
    result.set(
      word,
      cachedPronunciations.get(word) ?? Object.freeze(fallbackSpellingPronunciation(word)),
    );
  }
  return result;
}

function longVowel(letter) {
  return {
    a: ["EY"],
    e: ["IY"],
    i: ["AY"],
    o: ["OW"],
    u: ["Y", "UW"],
  }[letter] ?? [];
}

function shortVowel(letter) {
  return { a: "AE", e: "EH", i: "IH", o: "AA", u: "AH" }[letter] ?? "";
}

export function fallbackSpellingPronunciation(value) {
  const word = normalizeWord(value).replaceAll("'", "");
  if (!word) return [];
  if (FALLBACK_WORDS.has(word)) return [...FALLBACK_WORDS.get(word)];
  const phones = [];
  const groups = [
    ["tion", ["SH", "AH", "N"]], ["sion", ["ZH", "AH", "N"]],
    ["tch", ["CH"]], ["dge", ["JH"]], ["eigh", ["EY"]],
    ["igh", ["AY"]], ["air", ["EH", "R"]], ["eer", ["IY", "R"]],
    ["ear", ["IY", "R"]], ["ough", ["OW"]], ["th", ["TH"]],
    ["sh", ["SH"]], ["ch", ["CH"]], ["ph", ["F"]],
    ["ng", ["NG"]], ["ck", ["K"]], ["qu", ["K", "W"]],
    ["wh", ["W"]], ["ee", ["IY"]], ["ea", ["IY"]],
    ["oo", ["UW"]], ["oa", ["OW"]], ["oi", ["OY"]],
    ["oy", ["OY"]], ["ou", ["AW"]], ["ow", ["AW"]],
    ["au", ["AO"]], ["aw", ["AO"]], ["ai", ["EY"]],
    ["ay", ["EY"]], ["ei", ["EY"]], ["ey", ["EY"]],
    ["er", ["ER"]], ["ir", ["ER"]], ["ur", ["ER"]],
    ["ar", ["AA", "R"]], ["or", ["AO", "R"]],
  ];
  for (let index = 0; index < word.length;) {
    const matched = groups.find(([grapheme]) => word.startsWith(grapheme, index));
    if (matched) {
      phones.push(...matched[1]);
      index += matched[0].length;
      continue;
    }
    const character = word[index];
    const next = word[index + 1] ?? "";
    const after = word[index + 2] ?? "";
    if (/[aeiou]/.test(character)) {
      if (/[bcdfghjklmnpqrstvwxyz]/.test(next) && after === "e" && index + 3 === word.length) {
        phones.push(...longVowel(character));
      } else if (!(character === "e" && index === word.length - 1 && word.length > 2)) {
        phones.push(shortVowel(character));
      }
      index += 1;
      continue;
    }
    const consonants = {
      b: ["B"], c: [/[eiy]/.test(next) ? "S" : "K"], d: ["D"], f: ["F"],
      g: [/[eiy]/.test(next) ? "JH" : "G"], h: ["HH"], j: ["JH"], k: ["K"],
      l: ["L"], m: ["M"], n: ["N"], p: ["P"], q: ["K"], r: ["R"],
      s: ["S"], t: ["T"], v: ["V"], w: ["W"], x: ["K", "S"],
      y: [index === word.length - 1 ? "IY" : "Y"], z: ["Z"],
    };
    if (!(character === next && /[bcdfghjklmnpqrstvwxyz]/.test(character))) {
      phones.push(...(consonants[character] ?? []));
    }
    index += 1;
  }
  return phones;
}

function stressedPhones(phones) {
  const cleaned = phones.filter((entry) => PHONE_DEFINITIONS[entry]);
  const preferred = cleaned.findIndex((entry) => VOWEL_PHONES.has(entry) && entry !== "AH");
  const fallback = cleaned.findIndex((entry) => VOWEL_PHONES.has(entry));
  const stressed = preferred >= 0 ? preferred : fallback;
  return cleaned.map((id, index) => Object.freeze({
    id,
    stress: index === stressed ? 1 : 0,
  }));
}

export function spellingPronunciationTokens(value, pronunciations = new Map()) {
  const source = String(value ?? "");
  const tokens = [];
  let cursor = 0;
  for (const match of source.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    const start = match.index ?? cursor;
    if (start > cursor) {
      tokens.push({ type: "boundary", source: source.slice(cursor, start), start: cursor, end: start });
    }
    const end = start + match[0].length;
    const key = normalizeWord(match[0]);
    const phones = pronunciations.get(key) ?? fallbackSpellingPronunciation(key);
    tokens.push({
      type: "word",
      source: match[0],
      start,
      end,
      phones: stressedPhones(phones),
    });
    cursor = end;
  }
  if (cursor < source.length) {
    tokens.push({ type: "boundary", source: source.slice(cursor), start: cursor, end: source.length });
  }
  return tokens;
}

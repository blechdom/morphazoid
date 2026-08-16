import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SPELLING_DIPHONE_CLIPS } from "../src/spelling-diphone-atlas.js";
import {
  SPELLING_PRONUNCIATION_DICTIONARY_URL,
  fallbackSpellingPronunciation,
  isSpellingPronunciationVowel,
  loadSpellingPronunciations,
  parseSpellingPronunciations,
  spellingPhoneDefinition,
  spellingPronunciationTokens,
} from "../src/spelling-pronunciation.js";

const ARPABET_PHONES = Object.freeze([
  "AA", "AE", "AH", "AO", "AW", "AY", "B", "CH", "D", "DH", "EH", "ER", "EY",
  "F", "G", "HH", "IH", "IY", "JH", "K", "L", "M", "N", "NG", "OW", "OY",
  "P", "R", "S", "SH", "T", "TH", "UH", "UW", "V", "W", "Y", "Z", "ZH",
]);

const ARPABET_VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY",
  "IH", "IY", "OW", "OY", "UH", "UW",
]);

test("CMUdict parsing removes stress, filters unsupported phones, and keeps the first variant", () => {
  const parsed = parseSpellingPronunciations(`
read R EH1 D
read(2) R IY1 D
the DH AH0
broken B XX1 N
ignored IH G N AO1 R D
`, new Set(["read", "the", "broken"]));

  assert.deepEqual([...parsed], [
    ["read", ["R", "EH", "D"]],
    ["the", ["DH", "AH"]],
  ]);
  assert.equal(parsed.has("broken"), false, "entries with unknown phones are rejected");
  assert.equal(parsed.has("ignored"), false, "requested-word filtering avoids irrelevant entries");
  assert.ok(Object.isFrozen(parsed.get("read")), "cached pronunciations cannot be mutated");
});

test("the bundled dictionary uses the complete supported 39-phone ARPABET inventory", async () => {
  const dictionary = await readFile(SPELLING_PRONUNCIATION_DICTIONARY_URL, "utf8");
  const inventory = new Set();
  for (const line of dictionary.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    for (const field of fields.slice(1)) inventory.add(field.replace(/\d/g, "").toUpperCase());
  }
  assert.deepEqual([...inventory].sort(), [...ARPABET_PHONES].sort());

  for (const id of ARPABET_PHONES) {
    const definition = spellingPhoneDefinition(id);
    assert.ok(definition, `${id} needs a synthesis definition`);
    assert.ok(
      SPELLING_DIPHONE_CLIPS[definition.sampleKey],
      `${id} sample ${definition.sampleKey} must exist in the KAL/Voxazoid atlas`,
    );
    assert.ok(definition.gestures.length > 0, `${id} needs a Bellazoid gesture`);
    assert.equal(definition.vowel, ARPABET_VOWELS.has(id), `${id} vowel classification must agree`);
    assert.equal(isSpellingPronunciationVowel(id), ARPABET_VOWELS.has(id));
  }
  assert.equal(spellingPhoneDefinition("not-a-phone"), null);
  assert.equal(isSpellingPronunciationVowel("not-a-phone"), false);
});

test("word lookup loads only requested dictionary entries and falls back for an OOV word", async () => {
  const dictionary = await readFile(SPELLING_PRONUNCIATION_DICTIONARY_URL, "utf8");
  let requests = 0;
  const pronunciations = await loadSpellingPronunciations(
    "Aardvark, xylophone — blorfquazzle!",
    {
      fetcher: async (url) => {
        requests += 1;
        assert.equal(String(url), String(SPELLING_PRONUNCIATION_DICTIONARY_URL));
        return {
          ok: true,
          async text() {
            return dictionary;
          },
        };
      },
    },
  );

  assert.equal(requests, 1, "one lazy dictionary request serves the complete text");
  assert.deepEqual(pronunciations.get("aardvark"), ["AA", "R", "D", "V", "AA", "R", "K"]);
  assert.deepEqual(pronunciations.get("xylophone"), ["Z", "AY", "L", "AH", "F", "OW", "N"]);
  assert.deepEqual(
    pronunciations.get("blorfquazzle"),
    fallbackSpellingPronunciation("blorfquazzle"),
    "unknown words still receive a playable rule-based pronunciation",
  );
});

test("common speech words and OOV spelling rules produce word phones, not letter names", () => {
  assert.deepEqual(fallbackSpellingPronunciation("the"), ["DH", "AH"]);
  assert.deepEqual(fallbackSpellingPronunciation("words"), ["W", "ER", "D", "Z"]);
  assert.deepEqual(fallbackSpellingPronunciation("speech"), ["S", "P", "IY", "CH"]);
  assert.deepEqual(
    fallbackSpellingPronunciation("synthesis"),
    ["S", "IH", "N", "TH", "AH", "S", "AH", "S"],
  );
  assert.deepEqual(fallbackSpellingPronunciation("make"), ["M", "EY", "K"]);
  assert.deepEqual(fallbackSpellingPronunciation("shroom"), ["SH", "R", "UW", "M"]);
});

test("pronunciation tokens preserve word and boundary offsets and mark one stressed vowel", () => {
  const pronunciations = new Map([
    ["the", ["DH", "AH"]],
    ["words", ["W", "ER", "D", "Z"]],
  ]);
  const tokens = spellingPronunciationTokens("The, words!", pronunciations);

  assert.deepEqual(tokens, [
    {
      type: "word",
      source: "The",
      start: 0,
      end: 3,
      phones: [{ id: "DH", stress: 0 }, { id: "AH", stress: 1 }],
    },
    { type: "boundary", source: ", ", start: 3, end: 5 },
    {
      type: "word",
      source: "words",
      start: 5,
      end: 10,
      phones: [
        { id: "W", stress: 0 },
        { id: "ER", stress: 1 },
        { id: "D", stress: 0 },
        { id: "Z", stress: 0 },
      ],
    },
    { type: "boundary", source: "!", start: 10, end: 11 },
  ]);
  assert.equal(
    tokens.filter((token) => token.type === "word")
      .flatMap((token) => token.phones)
      .filter((phone) => phone.stress).length,
    2,
    "each word assigns emphasis to one vowel",
  );
});

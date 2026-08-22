import assert from "node:assert/strict";
import test from "node:test";

import {
  VOCALZOID_DEFAULT_WORD,
  VOCALZOID_MAX_MIDI,
  VOCALZOID_MIN_MIDI,
  VOCALZOID_STYLES,
  applyVocalzoidMelody,
  createRandomVocalzoidScore,
  createVocalzoidSequence,
  decodeUtauText,
  deleteVocalzoidNote,
  insertVocalzoidNote,
  parseUtauOto,
  replaceVocalzoidNotePhone,
  resolveUtauEntry,
  splitVocalzoidNote,
  updateVocalzoidNote,
  utauAliasCandidates,
  vocalzoidBankCoverage,
  vocalzoidPronunciation,
  vocalzoidRenderPlan,
} from "../src/vocalzoid.js";
import {
  isSpellingPronunciationVowel,
  SPELLING_PRONUNCIATION_PHONE_CATALOG,
} from "../src/spelling-pronunciation.js";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("the default Vocalzoid word has a stable pronunciation and three-note sequence", () => {
  assert.equal(VOCALZOID_DEFAULT_WORD, "vocalzoid");
  assert.deepEqual(
    vocalzoidPronunciation(" Vocal'zoid! "),
    ["V", "OW", "K", "AH", "L", "Z", "OY", "D"],
  );

  const notes = createVocalzoidSequence(VOCALZOID_DEFAULT_WORD);
  assert.deepEqual(notes, [
    {
      id: "vz-1",
      lyric: "vo",
      phones: ["V", "OW"],
      alias: "",
      start: 0,
      duration: 2,
      midi: 55,
    },
    {
      id: "vz-2",
      lyric: "cal",
      phones: ["K", "AH", "L"],
      alias: "",
      start: 2,
      duration: 2,
      midi: 59,
    },
    {
      id: "vz-3",
      lyric: "zoid",
      phones: ["Z", "OY", "D"],
      alias: "",
      start: 4,
      duration: 2,
      midi: 62,
    },
  ]);
  assert.ok(notes.every(Object.isFrozen));
  assert.ok(notes.every((note) => Object.isFrozen(note.phones)));
});

test("sequence creation and note edits clamp pitches to the Vocalzoid MIDI range", () => {
  const low = createVocalzoidSequence("vocalzoid", { baseMidi: -100 });
  const high = createVocalzoidSequence("vocalzoid", { baseMidi: 100 });
  assert.deepEqual(low.map((note) => note.midi), [
    VOCALZOID_MIN_MIDI,
    VOCALZOID_MIN_MIDI,
    VOCALZOID_MIN_MIDI,
  ]);
  assert.deepEqual(high.map((note) => note.midi), [
    VOCALZOID_MAX_MIDI,
    VOCALZOID_MAX_MIDI,
    VOCALZOID_MAX_MIDI,
  ]);

  assert.equal(updateVocalzoidNote(low[0], { midi: 999 }).midi, VOCALZOID_MAX_MIDI);
  assert.equal(updateVocalzoidNote(high[0], { midi: -999 }).midi, VOCALZOID_MIN_MIDI);
  assert.equal(updateVocalzoidNote(low[0], { midi: 60.6 }).midi, 61);
});

test("random scores are reproducible, playable, and deeply immutable", () => {
  const score = createRandomVocalzoidScore(seededRandom(0x5eed));
  const replay = createRandomVocalzoidScore(seededRandom(0x5eed));
  const catalogIds = new Set(SPELLING_PRONUNCIATION_PHONE_CATALOG.map(({ id }) => id));

  assert.deepEqual(score, replay);
  assert.ok(Object.isFrozen(score));
  assert.ok(Object.isFrozen(score.notes));
  assert.ok(score.notes.length >= 6 && score.notes.length <= 10);
  assert.ok(Object.hasOwn(VOCALZOID_STYLES, score.style));
  assert.ok(score.bpm >= 40 && score.bpm <= 220);
  assert.ok(score.vibrato >= 0 && score.vibrato <= 80);
  assert.ok(score.glide >= 0 && score.glide <= 240);
  assert.equal(score.glide % 5, 0);

  const ids = new Set();
  score.notes.forEach((note, index) => {
    assert.ok(Object.isFrozen(note));
    assert.ok(Object.isFrozen(note.phones));
    assert.ok(note.phones.length >= 1 && note.phones.length <= 3);
    assert.ok(note.phones.every((phone) => catalogIds.has(phone)));
    assert.equal(note.phones.filter(isSpellingPronunciationVowel).length, 1);
    assert.equal(note.alias, "");
    assert.equal(note.phonesEdited, true);
    assert.ok(Number.isInteger(note.start * 4));
    assert.ok(Number.isInteger(note.duration * 4));
    assert.ok(note.duration >= 0.5 && note.duration <= 2);
    assert.ok(note.midi >= VOCALZOID_MIN_MIDI && note.midi <= VOCALZOID_MAX_MIDI);
    assert.ok(note.lyric.length > 0);
    assert.ok(!ids.has(note.id));
    ids.add(note.id);
    if (index > 0) {
      const previous = score.notes[index - 1];
      assert.equal(note.start, previous.start + previous.duration);
    }
  });
  const last = score.notes.at(-1);
  assert.equal(score.scoreBeats, Math.max(8, Math.ceil(last.start + last.duration + 1)));
});

test("random score generation safely normalizes invalid RNG results", () => {
  const badValues = [Number.NaN, -4, Number.POSITIVE_INFINITY, 1, 7, Number.NEGATIVE_INFINITY];
  let index = 0;
  const score = createRandomVocalzoidScore(() => badValues[index++ % badValues.length]);

  assert.ok(score.notes.length >= 6 && score.notes.length <= 10);
  assert.ok(score.notes.every((note) => (
    Number.isFinite(note.start)
    && Number.isFinite(note.duration)
    && Number.isFinite(note.midi)
  )));
  assert.doesNotThrow(() => createRandomVocalzoidScore(() => {
    throw new Error("broken RNG");
  }));
  assert.doesNotThrow(() => createRandomVocalzoidScore(null));
});

test("a note phone can be changed without losing its vowel nucleus or timing", () => {
  const note = Object.freeze({
    id: "syllable",
    lyric: "cal",
    phones: Object.freeze(["K", "AH", "L"]),
    alias: "exact-cal",
    start: 2,
    duration: 3,
    midi: 59,
  });

  const onset = replaceVocalzoidNotePhone(note, 0, "V");
  assert.notEqual(onset, note);
  assert.deepEqual(onset.phones, ["V", "AH", "L"]);
  assert.equal(onset.alias, "", "a phone edit clears the now-stale exact bank alias");
  assert.equal(onset.phonesEdited, true);
  assert.deepEqual(
    { start: onset.start, duration: onset.duration, midi: onset.midi, lyric: onset.lyric },
    { start: 2, duration: 3, midi: 59, lyric: "cal" },
  );
  assert.ok(Object.isFrozen(onset));
  assert.ok(Object.isFrozen(onset.phones));
  assert.deepEqual(note.phones, ["K", "AH", "L"], "the source note remains unchanged");

  const nucleus = replaceVocalzoidNotePhone(onset, 1, "OY");
  assert.deepEqual(nucleus.phones, ["V", "OY", "L"]);
  assert.equal(replaceVocalzoidNotePhone(nucleus, 0, "OW"), nucleus, "an onset cannot become a vowel");
  assert.equal(replaceVocalzoidNotePhone(nucleus, 1, "Z"), nucleus, "the nucleus cannot become a consonant");
  assert.equal(replaceVocalzoidNotePhone(nucleus, 1, "NOPE"), nucleus);
  assert.equal(replaceVocalzoidNotePhone(nucleus, 99, "AH"), nucleus);
});

test("melody presets transpose each note, repeat their contour, and clamp the result", () => {
  const notes = Array.from({ length: 7 }, (_, index) => ({
    id: `note-${index}`,
    lyric: "la",
    phones: ["L", "AA"],
    alias: "",
    start: index,
    duration: 1,
    midi: 55,
  }));

  const answer = applyVocalzoidMelody(notes, "answer", 60);
  assert.deepEqual(answer.map((note) => note.midi), [67, 65, 64, 62, 60, 59, 67]);
  assert.deepEqual(notes.map((note) => note.midi), Array(7).fill(55), "input notes stay unchanged");

  const clippedLift = applyVocalzoidMelody(notes.slice(0, 3), "lift", 70);
  assert.deepEqual(clippedLift.map((note) => note.midi), [70, 72, 72]);
});

test("notes can be inserted from a template without mutating it or colliding with IDs", () => {
  const template = {
    id: "note",
    lyric: "cal",
    phones: ["K", "AH", "L"],
    alias: "k ah",
    start: 1,
    duration: 2,
    midi: 55,
  };
  const notes = [{ ...template, phones: [...template.phones] }];
  const before = structuredClone(notes);
  const inserted = insertVocalzoidNote(notes, {
    id: "note",
    start: 4,
    midi: 61,
    template,
  });

  assert.deepEqual(notes, before, "input notes stay unchanged");
  assert.deepEqual(inserted.map(({ id, start, midi }) => ({ id, start, midi })), [
    { id: "note", start: 1, midi: 55 },
    { id: "note-2", start: 4, midi: 61 },
  ]);
  assert.deepEqual(inserted[1].phones, ["K", "AH", "L"]);
  assert.notEqual(inserted[1].phones, template.phones);
  assert.ok(Object.isFrozen(inserted));
  assert.ok(inserted.every(Object.isFrozen));
  assert.ok(inserted.every((note) => Object.isFrozen(note.phones)));
});

test("notes can be deleted immutably", () => {
  const notes = createVocalzoidSequence("vocalzoid");
  const remaining = deleteVocalzoidNote(notes, "vz-2");

  assert.deepEqual(remaining.map((note) => note.id), ["vz-1", "vz-3"]);
  assert.equal(notes.length, 3);
  assert.ok(Object.isFrozen(remaining));
  assert.ok(remaining.every(Object.isFrozen));
});

test("splitting a note preserves its span and carries the vowel into the continuation", () => {
  const notes = [{
    id: "cal",
    lyric: "cal",
    phones: ["K", "AH", "L"],
    alias: "k ah l",
    start: 2,
    duration: 2,
    midi: 59,
  }, {
    id: "cal-part",
    lyric: "existing",
    phones: ["IH"],
    alias: "",
    start: 5,
    duration: 1,
    midi: 60,
  }];
  const before = structuredClone(notes);
  const split = splitVocalzoidNote(notes, "cal", 2.75, "cal-part");

  assert.deepEqual(notes, before, "input notes stay unchanged");
  assert.deepEqual(split.slice(0, 2).map((note) => ({
    id: note.id,
    start: note.start,
    duration: note.duration,
    phones: note.phones,
  })), [{
    id: "cal",
    start: 2,
    duration: 0.75,
    phones: ["K", "AH"],
  }, {
    id: "cal-part-2",
    start: 2.75,
    duration: 1.25,
    phones: ["AH", "L"],
  }]);
  assert.equal(split[0].duration + split[1].duration, notes[0].duration);
  assert.ok(split.slice(0, 2).every((note) => note.alias === ""));
  assert.ok(Object.isFrozen(split));
  assert.ok(split.every(Object.isFrozen));
  assert.ok(split.every((note) => Object.isFrozen(note.phones)));
});

test("splits within a quarter beat of either edge are rejected", () => {
  const notes = [{
    id: "short",
    lyric: "ah",
    phones: ["AH"],
    alias: "",
    start: 3,
    duration: 1,
    midi: 55,
  }];

  for (const splitBeat of [2.9, 3.2, 3.8, 4.1, Number.NaN]) {
    const result = splitVocalzoidNote(notes, "short", splitBeat, "right");
    assert.equal(result.length, 1);
    assert.equal(result[0].duration, 1);
  }
  assert.equal(splitVocalzoidNote(notes, "short", 3.25, "right").length, 2);
  assert.equal(splitVocalzoidNote(notes, "short", 3.75, "right").length, 2);
});

test("the render plan overlaps consonants around a sustained vowel on the beat grid", () => {
  const [leading, vowel, trailing] = vocalzoidRenderPlan([{
    id: "note-1",
    lyric: "voke",
    phones: ["V", "OW", "K"],
    start: 1,
    duration: 2,
    midi: 60,
  }], 120);

  assert.deepEqual(
    [leading.phone, vowel.phone, trailing.phone],
    ["V", "OW", "K"],
  );
  assert.deepEqual(
    [leading.sustain, vowel.sustain, trailing.sustain],
    [false, true, false],
  );
  assert.deepEqual(
    [leading.role, vowel.role, trailing.role],
    ["onset", "sustain", "release"],
  );
  assert.ok(Math.abs(leading.start - 0.415) < 1e-12);
  assert.ok(Math.abs(leading.duration - 0.107) < 1e-12);
  assert.ok(Math.abs(vowel.start - 0.5) < 1e-12);
  assert.ok(Math.abs(vowel.duration - 1) < 1e-12);
  assert.ok(Math.abs(trailing.start - 1.412) < 1e-12);
  assert.ok(Math.abs(trailing.duration - 0.088) < 1e-12);
  assert.ok(leading.start < vowel.start && leading.start + leading.duration > vowel.start);
  assert.ok(vowel.start + vowel.duration > trailing.start);
  assert.ok(Math.abs(vowel.start + vowel.duration - 1.5) < 1e-12);
});

test("oto.ini parsing normalizes bank paths and preserves UTAU timing fields", () => {
  const entries = parseUtauOto(`\uFEFF# UTF-8 oto.ini
; another comment
samples\\vo.wav=V O,12.5,90,-25,30,8
blank.wav=,-3,not-a-number,-180,-5,-1
missing-fields.wav=bad,1,2,3,4
not an oto line
`, { directory: "/banks\\Demo//" });

  assert.deepEqual(entries, [
    {
      filename: "samples/vo.wav",
      path: "banks/Demo/samples/vo.wav",
      alias: "V O",
      normalizedAlias: "v o",
      offset: 12.5,
      consonant: 90,
      cutoff: -25,
      preutterance: 30,
      overlap: 8,
    },
    {
      filename: "blank.wav",
      path: "banks/Demo/blank.wav",
      alias: "blank",
      normalizedAlias: "blank",
      offset: 0,
      consonant: 0,
      cutoff: -180,
      preutterance: 0,
      overlap: -1,
    },
  ]);
  assert.ok(entries.every(Object.isFrozen));
});

test("UTAU text decoding accepts UTF-8 and falls back to Shift-JIS", () => {
  const utf8 = new TextEncoder().encode("name=Velvet Voice\n");
  assert.equal(decodeUtauText(utf8), "name=Velvet Voice\n");

  // Shift-JIS bytes for \"name=\u3042\". The invalid UTF-8 pair forces the fallback decoder.
  const shiftJis = Uint8Array.from([0x6e, 0x61, 0x6d, 0x65, 0x3d, 0x82, 0xa0]);
  assert.equal(decodeUtauText(shiftJis.buffer), "name=\u3042");
});

test("UTAU aliases prefer an explicit alias and otherwise resolve CV/VC candidates", () => {
  const entries = parseUtauOto(`
explicit.wav=bright lead,0,0,0,0,0
onset.wav=- v,0,0,0,0,0
vo.wav=v-ow,0,0,0,0,0
ow-k.wav=ow k,0,0,0,0,0
consonant.wav=k,0,0,0,0,0
vowel.wav=ah,0,0,0,0,0
`);

  const explicitNote = {
    lyric: "ignored",
    alias: "  BRIGHT   LEAD ",
    phones: ["V", "OW"],
  };
  assert.equal(utauAliasCandidates(explicitNote)[0], "bright lead");
  assert.equal(resolveUtauEntry(entries, explicitNote), entries[0]);

  const cvNote = { lyric: "unlisted", alias: "", phones: ["V", "OW"] };
  assert.ok(utauAliasCandidates(cvNote).includes("v-ow"));
  assert.equal(resolveUtauEntry(entries, cvNote), entries[2]);

  const vcNote = { lyric: "unlisted", alias: "", phones: ["K", "AH"] };
  assert.ok(utauAliasCandidates(vcNote, "OW").includes("ow k"));
  assert.equal(resolveUtauEntry(entries, vcNote, "OW"), entries[3]);

  const bareNote = { lyric: "unlisted", alias: "", phones: ["K", "AH"] };
  assert.equal(
    resolveUtauEntry(entries.filter(({ alias }) => ["k", "ah"].includes(alias)), bareNote),
    entries[5],
    "a vowel body is safer than a bare consonant when no diphone alias exists",
  );

  const lyricEntry = parseUtauOto("lyric.wav=vo,0,0,0,0,0")[0];
  const original = { lyric: "vo", alias: "", phones: ["V", "OW"] };
  const edited = replaceVocalzoidNotePhone(original, 1, "OY");
  assert.equal(resolveUtauEntry([lyricEntry], original), lyricEntry);
  assert.equal(resolveUtauEntry([lyricEntry], edited), null, "a written lyric cannot mask a manual phone edit");
});

test("bank coverage carries the previous phone across notes and reports misses", () => {
  const entries = parseUtauOto(`
vo.wav=v-ow,0,0,0,0,0
ow-k.wav=ow k,0,0,0,0,0
`);
  const notes = [
    { id: "one", lyric: "unlisted", phones: ["V", "OW"] },
    { id: "two", lyric: "unlisted", phones: ["K", "AH"] },
    { id: "three", lyric: "unlisted", phones: ["Z", "OY", "D"] },
  ];

  const coverage = vocalzoidBankCoverage(entries, notes);
  assert.equal(coverage.matched, 2);
  assert.equal(coverage.total, 3);
  assert.equal(coverage.ratio, 2 / 3);
  assert.deepEqual(coverage.resolved, [entries[0], entries[1], null]);
  assert.ok(Object.isFrozen(coverage));
  assert.ok(Object.isFrozen(coverage.resolved));

  assert.deepEqual(vocalzoidBankCoverage(entries, []), {
    matched: 0,
    total: 0,
    ratio: 0,
    resolved: [],
  });
});

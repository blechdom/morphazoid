import assert from "node:assert/strict";
import test from "node:test";

import {
  VOCALZOID_DEFAULT_WORD,
  VOCALZOID_MAX_MIDI,
  VOCALZOID_MIN_MIDI,
  applyVocalzoidMelody,
  createVocalzoidSequence,
  decodeUtauText,
  parseUtauOto,
  resolveUtauEntry,
  updateVocalzoidNote,
  utauAliasCandidates,
  vocalzoidBankCoverage,
  vocalzoidPronunciation,
  vocalzoidRenderPlan,
} from "../src/vocalzoid.js";

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
  assert.ok(Math.abs(leading.start - 0.5) < 1e-12);
  assert.ok(Math.abs(leading.duration - 0.107) < 1e-12);
  assert.ok(Math.abs(vowel.start - 0.567) < 1e-12);
  assert.ok(Math.abs(vowel.duration - 0.881) < 1e-12);
  assert.ok(Math.abs(trailing.start - 1.412) < 1e-12);
  assert.ok(Math.abs(trailing.duration - 0.088) < 1e-12);
  assert.ok(leading.start < vowel.start && vowel.start + vowel.duration > trailing.start);
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

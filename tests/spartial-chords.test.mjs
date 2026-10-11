import assert from "node:assert/strict";
import test from "node:test";
import { SPARTIAL_CHORDS, SPARTIAL_MAX_VOICES, SpartialEngine, spartialChordIntervals, randomSpartialInstrument } from "../src/instruments/spartial/spartial.js";

test("requested chord spellings and cluster sizes fit the voice pool and one octave", () => {
  for (const [id, intervals] of Object.entries({
    augmented: [0, 4, 8], diminished: [0, 3, 6], diminished7: [0, 3, 6, 9],
    halfDiminished: [0, 3, 6, 10], wholeTone3: [0, 2, 4], wholeTone4: [0, 2, 4, 6],
    wholeTone: [0, 2, 4, 6, 8, 10], chromatic3: [0, 1, 2], chromatic4: [0, 1, 2, 3],
  })) assert.deepEqual(spartialChordIntervals(id), intervals);
  assert.equal(new Set(SPARTIAL_CHORDS.map(chord => chord.id)).size, SPARTIAL_CHORDS.length);
  for (const chord of SPARTIAL_CHORDS) {
    const intervals = spartialChordIntervals(chord.id);
    assert.equal(intervals.length, chord.noteCount);
    assert.ok(intervals.length <= SPARTIAL_MAX_VOICES);
    assert.equal(intervals[0], 0);
    assert.equal(new Set(intervals).size, intervals.length);
    assert.ok(intervals.every(note => Number.isInteger(note) && note >= 0 && note < 12));
  }
});

test("random clusters recall exactly, vary across seeds and never duplicate notes", () => {
  for (const size of [3, 4]) {
    const shapes = new Set();
    const pitches = new Set();
    for (let seed = 0; seed < 300; seed += 1) {
      const intervals = spartialChordIntervals(`random${size}`, seed);
      assert.deepEqual(intervals, spartialChordIntervals(`random${size}`, seed));
      assert.equal(intervals.length, size);
      assert.equal(new Set(intervals).size, size);
      assert.equal(intervals[0], 0);
      assert.ok(intervals.every(note => Number.isInteger(note) && note >= 0 && note < 12));
      assert.deepEqual(intervals, [...intervals].sort((a, b) => a - b));
      shapes.add(intervals.join(","));
      intervals.forEach(note => pitches.add(note));
    }
    assert.ok(shapes.size > 40);
    assert.equal(pitches.size, 12);
  }
  const owned = spartialChordIntervals("major"); owned[1] = 99;
  assert.deepEqual(spartialChordIntervals("major"), [0, 4, 7]);
  assert.deepEqual(spartialChordIntervals("unknown"), [0, 3, 7]);
});

test("full instrument dice include every chord type and store complete random voicings", () => {
  const variants = new Map(SPARTIAL_CHORDS.map(chord => [chord.id, new Set()]));
  for (let seed = 0; seed < 1024; seed += 1) {
    const scene = randomSpartialInstrument({ settings: { level: .42 } }, seed);
    variants.get(scene.chord).add(scene.chordIntervals.join(","));
    assert.equal(scene.settings.level, .42);
    assert.deepEqual(scene.chordIntervals, randomSpartialInstrument({ settings: { level: .42 } }, seed).chordIntervals);
    const chord = SPARTIAL_CHORDS.find(item => item.id === scene.chord);
    assert.equal(scene.chordIntervals.length, chord.noteCount);
    if (chord.intervals) assert.deepEqual(scene.chordIntervals, chord.intervals);
  }
  for (const [id, shapes] of variants) assert.ok(shapes.size >= (id.startsWith("random") ? 2 : 1), `${id} participates`);
});

test("six-note latch changes reuse tails and preserve two older MIDI notes", () => {
  const engine = new SpartialEngine({ settings: { partials: 1, cascade: 0, release: 2 } });
  const render = () => {
    const channels = Array.from({ length: 16 }, () => new Float32Array(1024));
    engine.render(channels);
    for (const channel of channels) for (const sample of channel) assert.ok(Number.isFinite(sample) && Math.abs(sample) <= .72);
  };
  engine.noteOn("midi:0", 42); engine.noteOn("midi:1", 47);
  let previous = [];
  for (const id of ["wholeTone", "augmented", "chromatic4", "wholeTone", "random3", "random4", "wholeTone"]) {
    previous.forEach((_, index) => engine.noteOff(`latch:${index}`));
    previous = spartialChordIntervals(id);
    previous.forEach((note, index) => engine.noteOn(`latch:${index}`, 60 + note));
    for (const midi of ["midi:0", "midi:1"]) assert.ok(engine.voices.some(voice => voice.id === midi && voice.gate && !voice.pending));
    render();
    assert.deepEqual(engine.voices.filter(voice => voice.gate && String(voice.id).startsWith("latch:")).map(voice => voice.note).sort((a,b) => a-b), previous.map(note => 60 + note));
  }
  previous.forEach((_, index) => engine.noteOff(`latch:${index}`));
  previous.forEach((note, index) => engine.noteOn(`latch:${index}`, 62 + note));
  engine.panic(); render();
  assert.ok(engine.voices.every(voice => !voice.active && !voice.pending));
});

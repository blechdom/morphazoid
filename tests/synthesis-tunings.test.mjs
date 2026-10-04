import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TUNING_ID,
  TUNING_PITCH_MODES,
  TUNINGS,
  arpeggioDegrees,
  arpeggioFrequencies,
  frequencyForMidiNote,
  frequencyForTuningDegree,
  getTuning,
  sanitizeTuningId,
  tuningRatioForDegree,
  tuningRatioForSemitoneCoordinate,
} from '../src/instruments/synthesis/tunings.js';

const closeTo = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Number.isFinite(actual), `${actual} should be finite`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
};

test('tuning catalogue is unique, deeply frozen and internally valid', () => {
  assert.equal(DEFAULT_TUNING_ID, 'edo-12-chromatic');
  assert.equal(TUNINGS.length, 32);
  assert.equal(new Set(TUNINGS.map(tuning => tuning.id)).size, TUNINGS.length);
  assert.ok(Object.isFrozen(TUNINGS));

  const kinds = new Set(['equal-division', 'ratios', 'cents']);
  const evidenceKinds = new Set(['mathematical', 'historical-theory', 'modern-keyboard-map', 'teaching-model']);
  for (const tuning of TUNINGS) {
    assert.ok(Object.isFrozen(tuning), tuning.id);
    assert.ok(Object.isFrozen(tuning.degreeCents), `${tuning.id}: degree cents`);
    assert.ok(Object.isFrozen(tuning.chordDegrees), `${tuning.id}: chord degrees`);
    assert.ok(Object.isFrozen(tuning.source), `${tuning.id}: source`);
    assert.ok(tuning.id && tuning.label && tuning.group && tuning.description, tuning.id);
    assert.ok(kinds.has(tuning.kind), `${tuning.id}: ${tuning.kind}`);
    assert.ok(evidenceKinds.has(tuning.evidence), `${tuning.id}: ${tuning.evidence}`);
    assert.ok(Number.isFinite(tuning.periodRatio) && tuning.periodRatio > 1, tuning.id);
    assert.ok(tuning.source.label && /^https:\/\//.test(tuning.source.url), tuning.id);
    assert.ok(tuning.degreeCents.length > 0, tuning.id);
    assert.equal(tuning.degreeCents[0], 0, `${tuning.id}: the root is explicit`);

    const periodCents = 1200 * Math.log2(tuning.periodRatio);
    tuning.degreeCents.forEach((cents, index) => {
      assert.ok(Number.isFinite(cents) && cents >= 0 && cents < periodCents, `${tuning.id}/${index}: endpoint excluded`);
      if (index > 0) assert.ok(cents > tuning.degreeCents[index - 1], `${tuning.id}: degrees ascend`);
    });
    assert.ok(tuning.chordDegrees.length > 0, tuning.id);
    assert.equal(tuning.chordDegrees[0], 0, `${tuning.id}: chord begins on the root`);
    assert.equal(new Set(tuning.chordDegrees).size, tuning.chordDegrees.length, `${tuning.id}: chord degrees are unique`);
    for (const [index, degree] of tuning.chordDegrees.entries()) {
      assert.ok(Number.isSafeInteger(degree) && degree >= 0 && degree < tuning.degreeCents.length, `${tuning.id}/${degree}`);
      if (index > 0) assert.ok(degree > tuning.chordDegrees[index - 1], `${tuning.id}: chord degrees ascend`);
    }
    if (tuning.evidence !== 'mathematical') assert.ok(tuning.caveat.length > 20, `${tuning.id}: evidence caveat`);
  }
});

test('culturally named maps are specific, sourced and explicit about approximation', () => {
  const culturalIds = [
    'chinese-twelve-lu',
    'chinese-gong-pentatonic',
    'japanese-yo-12edo',
    'japanese-in-12edo',
    'javanese-slendro-5edo-model',
    'javanese-pelog-9edo-model',
    'chopi-timbila-7edo-model',
    'amhara-tizita-major-12edo-map',
    'amhara-ambassel-12edo-map',
  ];
  for (const id of culturalIds) {
    const tuning = getTuning(id);
    assert.equal(tuning.id, id);
    assert.ok(tuning.caveat);
    assert.ok(!/^(asian|east asian|african|balinese|javanese)$/i.test(tuning.label));
  }
  assert.equal(getTuning('javanese-slendro-5edo-model').evidence, 'teaching-model');
  assert.equal(getTuning('amhara-tizita-major-12edo-map').evidence, 'modern-keyboard-map');
  assert.match(getTuning('chopi-timbila-7edo-model').caveat, /not a generic African tuning/i);
  assert.deepEqual(getTuning('japanese-yo-12edo').degreeCents, [0, 200, 500, 700, 900]);
  assert.deepEqual(getTuning('japanese-in-12edo').degreeCents, [0, 100, 500, 700, 800]);
  assert.match(getTuning('japanese-in-12edo').caveat, /ascending practice/i);
  closeTo(tuningRatioForDegree(3, 'chinese-twelve-lu'), 19683 / 16384);
});

test('lookup sanitizes unknown and hostile ids to the canonical default', () => {
  assert.equal(sanitizeTuningId(DEFAULT_TUNING_ID), DEFAULT_TUNING_ID);
  for (const value of [undefined, null, '', 'missing', 12, {}, Symbol('tuning')]) {
    assert.equal(sanitizeTuningId(value), DEFAULT_TUNING_ID);
    assert.equal(getTuning(value), TUNINGS[0]);
  }
});

test('12-EDO remains exact across positive, negative and MIDI-addressed degrees', () => {
  const chromatic = getTuning(DEFAULT_TUNING_ID);
  assert.deepEqual(chromatic.degreeCents, [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]);
  closeTo(tuningRatioForDegree(0), 1);
  closeTo(tuningRatioForDegree(12), 2);
  closeTo(tuningRatioForDegree(-1), 2 ** (-1 / 12));
  closeTo(tuningRatioForDegree(-12), 0.5);
  closeTo(tuningRatioForDegree(-13), 2 ** (-13 / 12));
  closeTo(frequencyForTuningDegree(440, 0), 440);
  closeTo(frequencyForTuningDegree(440, 12), 880);
  closeTo(frequencyForTuningDegree(440, -12), 220);
  closeTo(frequencyForMidiNote(69), 440);
  closeTo(frequencyForMidiNote(81), 880);
  closeTo(frequencyForMidiNote(57), 220);
});

test('ratio tunings retain their exact fifth relationships', () => {
  closeTo(tuningRatioForDegree(4, 'just-5-limit-major'), 3 / 2);
  closeTo(tuningRatioForDegree(7, 'pythagorean-12'), 3 / 2);
  closeTo(tuningRatioForDegree(4, 'just-5-limit-chromatic'), 5 / 4);
  closeTo(tuningRatioForDegree(12, 'just-5-limit-chromatic'), 2);
});

test('whole-tone and Bohlen-Pierce repeat over their declared periods', () => {
  assert.deepEqual(getTuning('edo-6-whole-tone').degreeCents, [0, 200, 400, 600, 800, 1000]);
  closeTo(tuningRatioForDegree(1, 'edo-6-whole-tone'), 2 ** (1 / 6));
  closeTo(tuningRatioForDegree(6, 'edo-6-whole-tone'), 2);

  const bohlenPierce = getTuning('bohlen-pierce-13edt');
  assert.equal(bohlenPierce.periodRatio, 3);
  assert.equal(bohlenPierce.degreeCents.length, 13);
  closeTo(tuningRatioForDegree(13, bohlenPierce.id), 3);
  closeTo(tuningRatioForDegree(26, bohlenPierce.id), 9);
  closeTo(tuningRatioForDegree(-13, bohlenPierce.id), 1 / 3);
  closeTo(frequencyForMidiNote(82, bohlenPierce.id), 1320);
});

test('sequence pitch coordinates snap, interpolate or retain original intervals explicitly', () => {
  assert.deepEqual(TUNING_PITCH_MODES, ['nearest', 'contour', 'original']);
  closeTo(tuningRatioForSemitoneCoordinate(4, DEFAULT_TUNING_ID, 'nearest'), 2 ** (4 / 12));
  closeTo(tuningRatioForSemitoneCoordinate(4.5, DEFAULT_TUNING_ID, 'contour'), 2 ** (4.5 / 12));
  closeTo(tuningRatioForSemitoneCoordinate(3, 'edo-12-major', 'nearest'), 2 ** (4 / 12));
  closeTo(tuningRatioForSemitoneCoordinate(3, 'edo-12-major', 'contour'), 2 ** (3.5 / 12));
  closeTo(tuningRatioForSemitoneCoordinate(3, 'edo-12-major', 'original'), 2 ** (3 / 12));
  closeTo(tuningRatioForSemitoneCoordinate(12, 'bohlen-pierce-13edt', 'nearest'), 3);
  closeTo(tuningRatioForSemitoneCoordinate(-12, 'bohlen-pierce-13edt', 'contour'), 1 / 3);
  assert.equal(tuningRatioForSemitoneCoordinate(NaN), null);
  assert.equal(tuningRatioForSemitoneCoordinate(Infinity), null);
});

test('arpeggio modes use playable-degree indices without duplicating turnarounds', () => {
  assert.deepEqual(arpeggioDegrees(DEFAULT_TUNING_ID, 'root'), [0]);
  assert.deepEqual(arpeggioDegrees(DEFAULT_TUNING_ID, 'up'), [0, 4, 7]);
  assert.deepEqual(arpeggioDegrees(DEFAULT_TUNING_ID, 'down'), [7, 4, 0]);
  assert.deepEqual(arpeggioDegrees(DEFAULT_TUNING_ID, 'up-down'), [0, 4, 7, 4]);
  assert.deepEqual(arpeggioDegrees(DEFAULT_TUNING_ID, 'unknown'), [0]);
  assert.deepEqual(arpeggioDegrees('edo-12-major', 'up'), [0, 2, 4]);

  const frequencies = arpeggioFrequencies(440, 'just-5-limit-major', 'up');
  assert.ok(frequencies);
  closeTo(frequencies[0], 440);
  closeTo(frequencies[1], 550);
  closeTo(frequencies[2], 660);
});

test('invalid values and out-of-range frequencies return null without boundary pile-up', () => {
  for (const degree of [NaN, Infinity, -Infinity, 1.5, '1', {}, Symbol('degree')]) {
    assert.equal(tuningRatioForDegree(degree), null);
    assert.equal(frequencyForTuningDegree(440, degree), null);
  }
  for (const baseHz of [NaN, Infinity, -1, 0, '440', {}, Symbol('frequency')]) {
    assert.equal(frequencyForTuningDegree(baseHz, 0), null);
  }

  assert.equal(frequencyForTuningDegree(8000, 1), null);
  assert.equal(frequencyForTuningDegree(20, -1), null);
  assert.equal(frequencyForTuningDegree(440, 0, DEFAULT_TUNING_ID, { minHz: 500, maxHz: 1000 }), null);
  assert.equal(frequencyForTuningDegree(440, 0, DEFAULT_TUNING_ID, { minHz: 1000, maxHz: 500 }), null);
  assert.equal(frequencyForTuningDegree(440, 0, DEFAULT_TUNING_ID, { minHz: NaN }), null);
  closeTo(frequencyForTuningDegree(8000, 0), 8000);
  closeTo(frequencyForTuningDegree(20, 0), 20);

  for (const note of [-1, 128, 69.5, NaN, Infinity, '69', {}, Symbol('note')]) {
    assert.equal(frequencyForMidiNote(note), null);
  }
  assert.equal(frequencyForMidiNote(127), null, 'frequencies above the engine range are rejected');
  assert.equal(frequencyForMidiNote(69, DEFAULT_TUNING_ID, null), null);
  assert.equal(frequencyForMidiNote(69, DEFAULT_TUNING_ID, { anchorHz: 0 }), null);
  assert.equal(frequencyForMidiNote(69, DEFAULT_TUNING_ID, { anchorNote: 69.5 }), null);
  assert.equal(arpeggioFrequencies(8000, DEFAULT_TUNING_ID, 'up'), null);
  assert.equal(arpeggioFrequencies(Symbol('frequency')), null);
});

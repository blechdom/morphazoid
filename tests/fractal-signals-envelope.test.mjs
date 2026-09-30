import assert from 'node:assert/strict';
import test from 'node:test';
import { ADSR_EDITOR_MODEL, adsrPoints, adsrFromPoints, envelopeEditorState } from '../src/instruments/fractal-signals/envelope-editor.js';
import { ENVELOPE_PRESETS, envelopePresetId } from '../src/instruments/fractal-signals/envelope-presets.js';
import { MODES, PARAMS, createDefaultState } from '../src/instruments/fractal-signals/model.js';

const keys = ['attack', 'decay', 'sustain', 'release'];
const stages = { attack: 1, decay: 2, release: 4 };
const pick = state => Object.fromEntries(keys.map(key => [key, state[key]]));
const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) <= Math.max(1e-12, Math.abs(expected) * 1e-12), `${message}: ${actual} ≈ ${expected}`);
function same(actual, expected, message = '') {
  assert.deepEqual(Object.keys(actual).sort(), [...keys].sort());
  for (const key of keys) close(actual[key], expected[key], `${message} ${key}`);
}
function validPoints(points) {
  assert.equal(points.length, 5);
  points.forEach((point, index) => {
    for (const coordinate of ['x', 'y']) assert.ok(Number.isFinite(point[coordinate]) && point[coordinate] >= 0 && point[coordinate] <= 1, coordinate);
    if (index) assert.ok(point.x > points[index - 1].x, 'stage handles remain ordered and separated');
  });
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.equal(points[1].y, 1);
  assert.equal(points[2].y, points[3].y);
  assert.equal(points[4].y, 0);
}
function limits(which) { return Object.fromEntries(keys.map(key => [key, PARAMS[key][which]])); }

const expectedPresets = {
  pluck: { attack: .003, decay: .022, sustain: .08, release: .045 },
  note: { attack: .01, decay: .09, sustain: .42, release: .25 },
  sustain: { attack: .03, decay: .15, sustain: .78, release: .5 },
  pad: { attack: .35, decay: .55, sustain: .72, release: 1.3 },
};

test('default, preset and every minimum/maximum ADSR combination round-trip through the editor', () => {
  const states = MODES.map(mode => createDefaultState(mode.id)).concat(ENVELOPE_PRESETS.map(preset => preset.snapshot));
  for (let mask = 0; mask < 16; mask++) states.push(Object.fromEntries(keys.map((key, index) => [key, PARAMS[key][mask & (1 << index) ? 'max' : 'min']])));
  states.push({ attack: 4, decay: 8, sustain: .37, release: 16 });
  for (const state of states) {
    const before = structuredClone(state), points = adsrPoints(state);
    validPoints(points);
    same(adsrFromPoints(points), pick(state));
    same(adsrFromPoints(ADSR_EDITOR_MODEL.normalizePoints(points)), pick(state));
    assert.deepEqual(state, before, 'encoding and normalization never mutate the live state');
  }
});

test('each time lane is logarithmic and monotonic across sub-millisecond to multi-second values', () => {
  const base = createDefaultState();
  for (const [key, index] of Object.entries(stages)) {
    const { min, max } = PARAMS[key];
    const first = adsrPoints({ ...base, [key]: min })[index].x;
    const last = adsrPoints({ ...base, [key]: max })[index].x;
    let previous = -Infinity;
    for (const fraction of [0, .1, .25, .5, .75, .9, 1]) {
      const points = adsrPoints(base);
      points[index].x = first + (last - first) * fraction;
      const value = adsrFromPoints(points)[key];
      assert.ok(value > previous, `${key} increases strictly as its handle moves right`);
      previous = value;
      close(adsrPoints({ ...base, [key]: value })[index].x, points[index].x, key);
      if (fraction === .5) close(value, Math.sqrt(min * max), `${key} logarithmic midpoint`);
    }
  }
});

test('dragging past either end reaches the full 4/8/16-second stage limits independently', () => {
  const base = { attack: .013, decay: .27, sustain: .63, release: .82 };
  assert.deepEqual(Object.fromEntries(Object.keys(stages).map(key => [key, PARAMS[key].max])), { attack: 4, decay: 8, release: 16 });
  for (const [key, index] of Object.entries(stages)) for (const [position, bound] of [[-100, 'min'], [100, 'max']]) {
    const points = adsrPoints(base), before = structuredClone(points);
    const moved = ADSR_EDITOR_MODEL.moveNode(points, index, { x: position, y: base.sustain });
    validPoints(moved);
    same(adsrFromPoints(moved), { ...base, [key]: PARAMS[key][bound] }, `${key} ${bound}`);
    assert.deepEqual(points, before, 'dragging returns new points without mutating the source');
  }
});

test('Attack and Release drags change only their own duration and keep endpoint levels fixed', () => {
  const base = { attack: .015, decay: .25, sustain: .54, release: .7 };
  for (const [key, index, target] of [['attack', 1, .6], ['release', 4, 5]]) {
    const original = adsrPoints(base), targetX = adsrPoints({ ...base, [key]: target })[index].x;
    for (const y of [-2, .25, 3]) {
      const moved = ADSR_EDITOR_MODEL.moveNode(original, index, { x: targetX, y });
      same(adsrFromPoints(moved), { ...base, [key]: target }, `${key} independent stage`);
      validPoints(moved);
    }
  }
});

test('Decay and Sustain handles share one level while retaining independent stage times', () => {
  const base = { attack: .02, decay: .4, sustain: .65, release: .9 };
  const source = adsrPoints(base), decayX = adsrPoints({ ...base, decay: 2.3 })[2].x;
  const decayMove = ADSR_EDITOR_MODEL.moveNode(source, 2, { x: decayX, y: .28 });
  same(adsrFromPoints(decayMove), { ...base, decay: 2.3, sustain: .28 });
  assert.equal(decayMove[2].y, .28); assert.equal(decayMove[3].y, .28);
  const sustainMove = ADSR_EDITOR_MODEL.moveNode(decayMove, 3, { x: -.5, y: .91 });
  same(adsrFromPoints(sustainMove), { ...base, decay: 2.3, sustain: .91 });
  assert.equal(sustainMove[2].y, .91); assert.equal(sustainMove[3].y, .91);
  for (const index of [1, 2, 3, 4]) close(sustainMove[index].x, decayMove[index].x, 'vertical sustain drag retains time coordinates');
  assert.equal(source[2].y, base.sustain, 'previous envelope is unchanged');
});

test('horizontal Sustain drags preserve the gate illustration and never invent a stage duration', () => {
  const base = { attack: 4, decay: 8, sustain: .43, release: 16 }, source = adsrPoints(base);
  for (const x of [-10, 0, .5, 1, 10]) {
    const moved = ADSR_EDITOR_MODEL.moveNode(source, 3, { x, y: base.sustain });
    same(adsrFromPoints(moved), base);
    assert.equal(moved[3].x, source[3].x);
  }
});

test('both level handles clamp sustain to zero or one without moving unrelated stages', () => {
  const base = { attack: .04, decay: .17, sustain: .4, release: .6 }, source = adsrPoints(base);
  for (const index of [2, 3]) for (const [y, expected] of [[-5, 0], [5, 1]]) {
    const moved = ADSR_EDITOR_MODEL.moveNode(source, index, { x: source[index].x, y });
    same(adsrFromPoints(moved), { ...base, sustain: expected });
    assert.equal(moved[2].y, expected); assert.equal(moved[3].y, expected);
    validPoints(moved);
  }
});

test('the fixed gate origin cannot alter ADSR values', () => {
  assert.ok(ADSR_EDITOR_MODEL.fixedNodes.includes(0));
  const base = { attack: .023, decay: .45, sustain: .53, release: 1.1 }, source = adsrPoints(base);
  const moved = ADSR_EDITOR_MODEL.moveNode(source, 0, { x: .9, y: .8 });
  same(adsrFromPoints(moved), base);
  assert.deepEqual(moved[0], { x: 0, y: 0 });
});

test('normalization restores ordered, linked ADSR geometry from partial or distorted points', () => {
  for (const value of [undefined, null, []]) same(adsrFromPoints(ADSR_EDITOR_MODEL.normalizePoints(value)), expectedPresets.sustain);
  const distorted = [{ x: .4, y: .8 }, { x: 4, y: -2 }, { x: -.2, y: .9 }, { x: 1, y: .21 }, { x: 0, y: 1 }];
  const before = structuredClone(distorted), normalized = ADSR_EDITOR_MODEL.normalizePoints(distorted);
  validPoints(normalized);
  same(adsrFromPoints(normalized), { attack: PARAMS.attack.max, decay: PARAMS.decay.min, sustain: .21, release: PARAMS.release.min });
  assert.deepEqual(distorted, before);
  const nonfinite = adsrPoints(createDefaultState());
  nonfinite[1].x = NaN; nonfinite[2].x = Infinity; nonfinite[3].y = -Infinity; nonfinite[4].x = NaN;
  const sanitized = ADSR_EDITOR_MODEL.normalizePoints(nonfinite);
  validPoints(sanitized);
  for (const [key, value] of Object.entries(adsrFromPoints(sanitized))) assert.ok(value >= PARAMS[key].min - 1e-12 && value <= PARAMS[key].max + 1e-12);
});

test('all four shared ADSR presets map to their actual stage durations and remain identifiable', () => {
  assert.deepEqual(ENVELOPE_PRESETS.map(preset => preset.id), Object.keys(expectedPresets));
  for (const [id, expected] of Object.entries(expectedPresets)) {
    const preset = ENVELOPE_PRESETS.find(item => item.id === id);
    same(preset.snapshot, expected, id);
    const points = ADSR_EDITOR_MODEL.presetPoints(id);
    validPoints(points); same(adsrFromPoints(points), expected, id);
    assert.equal(envelopePresetId(adsrFromPoints(points)), id);
    const live = { ...createDefaultState('grains'), ...expected, loop: false, pingPong: true };
    const before = structuredClone(live), captured = envelopeEditorState(live);
    assert.equal(captured.preset, id); assert.equal(captured.enabled, true);
    assert.equal(captured.swell, false); assert.equal(captured.level, 1);
    same(adsrFromPoints(captured.points), expected, id);
    assert.deepEqual(live, before, 'preset detection leaves full instrument state intact');
  }
  same(adsrFromPoints(ADSR_EDITOR_MODEL.presetPoints('missing-preset')), expectedPresets.sustain);
});

test('manual stage edits identify Custom without losing the edited envelope', () => {
  for (const preset of ENVELOPE_PRESETS) {
    const points = ADSR_EDITOR_MODEL.presetPoints(preset.id);
    const changed = ADSR_EDITOR_MODEL.moveNode(points, 1, { x: points[1].x + .02, y: 1 });
    const state = { ...createDefaultState(), ...adsrFromPoints(changed) };
    assert.equal(envelopePresetId(state), null);
    const captured = envelopeEditorState(state);
    assert.equal(captured.preset, 'custom');
    same(adsrFromPoints(captured.points), pick(state));
  }
});

test('repeated editor synchronization retains long envelopes and preset recognition', () => {
  for (const original of [{ attack: 4, decay: 8, sustain: .73, release: 16 }, ...ENVELOPE_PRESETS.map(preset => preset.snapshot)]) {
    const expectedId = envelopePresetId(original);
    let points = adsrPoints(original);
    for (let i = 0; i < 250; i++) points = ADSR_EDITOR_MODEL.normalizePoints(points);
    same(adsrFromPoints(points), original);
    assert.equal(envelopePresetId(adsrFromPoints(points)), expectedId);
  }
});

test('stage readouts report real seconds and milliseconds at the full control limits', () => {
  assert.deepEqual(ADSR_EDITOR_MODEL.axis(adsrPoints(limits('max'))), ['A 4 s', 'D 8 s', 'S 100%', 'R 16 s']);
  assert.deepEqual(ADSR_EDITOR_MODEL.axis(adsrPoints(limits('min'))), ['A 0.2 ms', 'D 1 ms', 'S 0%', 'R 5 ms']);
  const maximum = adsrPoints(limits('max'));
  assert.match(ADSR_EDITOR_MODEL.describeNode(maximum, 1), /Attack 4 s/);
  assert.match(ADSR_EDITOR_MODEL.describeNode(maximum, 2), /Decay 8 s.*sustain 100%/);
  assert.match(ADSR_EDITOR_MODEL.describeNode(maximum, 3), /Sustain 100%/);
  assert.match(ADSR_EDITOR_MODEL.describeNode(maximum, 4), /Release 16 s/);
});

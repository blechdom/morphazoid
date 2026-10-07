import test from 'node:test';
import assert from 'node:assert/strict';
import { PugglerModel, PATTERNS, TEMPO_MULTIPLIERS, MIN_TEMPO, MAX_TEMPO } from '../src/instruments/puggler/puggler.js';
import { propNoteAt, MAX_PROP_NOTE_RATE } from '../src/instruments/puggler/puggler-rhythm.js';
import { OBJECT_SOUND_PROFILES } from '../src/instruments/puggler/puggler-object-sounds.js';
import { SOUND_DEFAULTS, PUGGLER_FULL_PRESETS, capturePugglerPreset, applyPugglerPreset, validatePugglerPreset } from '../src/instruments/puggler/puggler-full-presets.js';

const advance = (model, seconds) => {
  for (let i = 0; i < seconds * 120; i++) model.step(1 / 120);
};

test('five speed ratios use stable base BPM, never compound or silently clamp', () => {
  assert.deepEqual(TEMPO_MULTIPLIERS, [.25, .5, 1, 2, 4]);
  const model = new PugglerModel({ tempo: 333 });
  for (const tempoMultiplier of [.5, .25, 4, 2, 1]) {
    model.apply({ tempoMultiplier });
    assert.equal(model.config.tempo, 333);
    assert.equal(model.tempo, 333 * tempoMultiplier);
  }
  for (const tempo of [MIN_TEMPO, MAX_TEMPO]) for (const tempoMultiplier of TEMPO_MULTIPLIERS) {
    model.apply({ tempo, tempoMultiplier });
    assert.equal(model.tempo, tempo * tempoMultiplier);
  }
  for (const value of [0, -1, 3, .75, NaN, Infinity, undefined, '2']) {
    model.apply({ tempoMultiplier: value });
    assert.equal(model.config.tempoMultiplier, 1);
  }
});

test('speed changes preserve live cast, riding, beat, clock and airborne trajectories', () => {
  const model = new PugglerModel({ tempo: 360, rideSpeed: .8, count: 3, pattern: 'cascade', chaos: 0 });
  advance(model, .25);
  const time = model.time, beat = model.beat, objects = model.objects;
  const positions = structuredClone(model.objects), players = structuredClone(model.players);
  const config = { ...model.config };
  for (const tempoMultiplier of TEMPO_MULTIPLIERS) {
    model.apply({ tempoMultiplier });
    assert.equal(model.time, time); assert.equal(model.beat, beat); assert.equal(model.objects, objects);
    assert.deepEqual(model.objects, positions); assert.deepEqual(model.players, players);
    assert.deepEqual(model.config, { ...config, tempoMultiplier });
  }
});

test('every pattern retains proportional beats, finite flights and legal stationary catches at every speed', () => {
  for (const tempo of [MIN_TEMPO, 360, MAX_TEMPO]) for (const tempoMultiplier of TEMPO_MULTIPLIERS) for (const pattern of PATTERNS) {
    const model = new PugglerModel({ tempo, tempoMultiplier, rideSpeed: 0, count: pattern.count, pattern: pattern.id, chaos: 0, wind: 0, assist: 120 });
    advance(model, 36);
    const label = `${tempo} × ${tempoMultiplier}, ${pattern.id}`;
    assert.ok(Math.abs(model.beat - 36 * model.tempo / 60) < .05, `${label}: beat ${model.beat}`);
    assert.equal(model.drops, 0, `${label}: drops`);
    for (const object of model.objects) assert.ok([object.x, object.y, object.vx, object.vy].every(Number.isFinite), label);
  }
});

test('higher effective tempos bound substeps and retain every catch event', () => {
  const model = new PugglerModel({ tempo: MAX_TEMPO, tempoMultiplier: 4, count: 10, pattern: 'many-10', chaos: 0, rideSpeed: 0 });
  let slices = 0, catches = 0;
  const stepSlice = model.stepSlice.bind(model);
  model.stepSlice = (...args) => { slices++; return stepSlice(...args); };
  for (let i = 0; i < 600; i++) {
    slices = 0;
    const events = model.step(1 / 60);
    assert.equal(slices, 8);
    catches += events.filter(e => e.kind === 'catch').length;
    assert.ok(events.length < 30);
  }
  assert.equal(catches, model.catches);
  assert.ok(catches > 100);
  assert.ok(Math.abs(model.players[0].ridePhase) < .00001);
});

test('all object scores use effective slow BPM for gates and bound extreme fast note density', () => {
  for (const bank of Object.values(OBJECT_SOUND_PROFILES)) for (const profile of Object.values(bank)) {
    const normal = propNoteAt(profile, 2.25, MIN_TEMPO, 1);
    for (const divisor of [2, 4]) {
      const slower = propNoteAt(profile, 2.25, MIN_TEMPO / divisor, 1);
      assert.equal(slower.token, normal.token); assert.equal(slower.atBeat, normal.atBeat);
      assert.equal(slower.ratePerSecond, normal.ratePerSecond / divisor);
      assert.equal(slower.gateSeconds, normal.gateSeconds * divisor);
    }
    const fast = propNoteAt(profile, 2.25, MAX_TEMPO * 4, 1);
    assert.ok(fast.ratePerSecond <= MAX_PROP_NOTE_RATE);
    assert.ok(Number.isFinite(fast.gateSeconds) && fast.gateSeconds > 0);
  }
});

test('speed scenes roundtrip, factory recall restores 1, and old v3 scenes migrate without mutation', () => {
  for (const preset of PUGGLER_FULL_PRESETS) {
    const model = new PugglerModel(), params = { ...SOUND_DEFAULTS, level: .13, allowFlashes: false };
    applyPugglerPreset(model, params, preset.snapshot);
    model.apply({ tempoMultiplier: .25 });
    const slower = capturePugglerPreset(model, params);
    applyPugglerPreset(model, params, preset.snapshot);
    assert.equal(model.config.tempoMultiplier, 1);
    assert.deepEqual(capturePugglerPreset(model, params), preset.snapshot);
    applyPugglerPreset(model, params, slower);
    assert.deepEqual(capturePugglerPreset(model, params), slower);
    assert.equal(params.tempo, slower.model.tempo / 4);
    assert.equal(params.level, .13); assert.equal(params.allowFlashes, false);
    const old = structuredClone(preset.snapshot); old.version = 3; delete old.model.tempoMultiplier;
    const saved = JSON.stringify(old);
    assert.deepEqual(validatePugglerPreset(old), preset.snapshot);
    assert.equal(JSON.stringify(old), saved);
    old.model.extra = true; assert.throws(() => validatePugglerPreset(old));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { reducedTempo } from '../src/instruments/puggler/puggler-controls.js';
import { PugglerModel, MIN_TEMPO, MAX_TEMPO } from '../src/instruments/puggler/puggler.js';
import { propNoteAt } from '../src/instruments/puggler/puggler-rhythm.js';
import { OBJECT_SOUND_PROFILES } from '../src/instruments/puggler/puggler-object-sounds.js';
import { SOUND_DEFAULTS, PUGGLER_FULL_PRESETS, capturePugglerPreset, applyPugglerPreset } from '../src/instruments/puggler/puggler-full-presets.js';

const advance = (model, seconds) => {
  for (let i = 0; i < seconds * 120; i++) model.step(1 / 120);
};

test('tempo actions divide current BPM, retain fractional BPM, and stop at the supported floor', () => {
  assert.equal(reducedTempo(360, 2), 180);
  assert.equal(reducedTempo(360, 4), 90);
  assert.equal(reducedTempo(reducedTempo(360, 2), 4), 45);
  assert.equal(reducedTempo(190, 4), 47.5);
  assert.equal(reducedTempo(333, 4), 83.25);
  assert.equal(reducedTempo(166.66, 2), 83.33);
  assert.equal(reducedTempo(100, 4), MIN_TEMPO);
  assert.equal(reducedTempo(50, 2), MIN_TEMPO);
  assert.equal(reducedTempo(MAX_TEMPO, 4), 300);
  for (const value of [MIN_TEMPO, 49.99, 0, -1, MAX_TEMPO + 1, NaN, Infinity, undefined, '360']) {
    assert.equal(reducedTempo(value, 2), null, String(value));
  }
  assert.equal(reducedTempo(99.99, 4), null);
  for (const divisor of [0, 1, 3, .5, NaN, Infinity]) assert.equal(reducedTempo(360, divisor), null);
});

test('slowing tempo preserves the live cast, riding, beat, clock and airborne trajectories', () => {
  const model = new PugglerModel({ tempo: 360, rideSpeed: .8, count: 3, pattern: 'cascade', chaos: 0 });
  advance(model, .25);
  const time = model.time, beat = model.beat, objects = model.objects;
  const positions = structuredClone(model.objects), players = structuredClone(model.players);
  const config = { ...model.config };
  model.apply({ tempo: reducedTempo(model.config.tempo, 4) });
  assert.equal(model.time, time);
  assert.equal(model.beat, beat);
  assert.equal(model.objects, objects);
  assert.deepEqual(model.objects, positions);
  assert.deepEqual(model.players, players);
  assert.deepEqual(model.config, { ...config, tempo: 90 });
});

test('25 and 50 BPM advance the actual beat proportionally and retain legal catches', () => {
  for (const tempo of [25, 50, 100]) {
    const model = new PugglerModel({ tempo, rideSpeed: 0, count: 3, pattern: 'cascade', chaos: 0, wind: 0, assist: 120 });
    advance(model, 36);
    assert.ok(Math.abs(model.beat - 36 * tempo / 60) < .01, `${tempo}: beat`);
    assert.equal(model.drops, 0, `${tempo}: drops`);
    assert.ok(model.catches > 6, `${tempo}: catches`);
    for (const object of model.objects) assert.ok([object.x, object.y, object.vx, object.vy].every(Number.isFinite));
  }
});

test('all prop scores use the slower BPM for their note rates and gates, not the old 100 BPM floor', () => {
  for (const bank of Object.values(OBJECT_SOUND_PROFILES)) for (const profile of Object.values(bank)) {
    const normal = propNoteAt(profile, 2.25, 100, 1);
    for (const divisor of [2, 4]) {
      const slower = propNoteAt(profile, 2.25, 100 / divisor, 1);
      assert.equal(slower.token, normal.token);
      assert.equal(slower.atBeat, normal.atBeat);
      assert.equal(slower.ratePerSecond, normal.ratePerSecond / divisor);
      assert.equal(slower.gateSeconds, normal.gateSeconds * divisor);
    }
  }
});

test('quarter-speed scenes roundtrip through the existing preset format without changing live levels', () => {
  for (const preset of PUGGLER_FULL_PRESETS) {
    const model = new PugglerModel(), params = { ...SOUND_DEFAULTS, level: .13, allowFlashes: false };
    applyPugglerPreset(model, params, preset.snapshot);
    model.apply({ tempo: reducedTempo(model.config.tempo, 4) });
    const slower = capturePugglerPreset(model, params);
    applyPugglerPreset(model, params, preset.snapshot);
    assert.deepEqual(capturePugglerPreset(model, params), preset.snapshot);
    applyPugglerPreset(model, params, slower);
    assert.deepEqual(capturePugglerPreset(model, params), slower);
    assert.equal(params.tempo, slower.model.tempo);
    assert.equal(params.level, .13);
    assert.equal(params.allowFlashes, false);
  }
});

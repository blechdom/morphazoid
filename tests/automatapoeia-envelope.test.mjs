import assert from 'node:assert/strict';
import test from 'node:test';
import {
  envelopeTimeFraction, envelopeTimeValue, automatapoeiaEnvelopeGeometry,
} from '../src/instruments/cellular-automata/automatapoeia-envelope.js';
import { AUTOMATA_FULL_PRESETS } from '../src/families/experiments/automata-presets.js';
import { automatapoeiaNextRow, renderAutomatapoeiaRow } from '../src/instruments/cellular-automata/automatapoeia.js';

const limits = { caAttack:[.001,.4], caDecay:[.005,1.5], caSustain:[0,1], caRelease:[.005,2] };

test('ADSR time lanes are logarithmic, reversible and bounded', () => {
  for (const key of ['caAttack', 'caDecay', 'caRelease']) {
    const [min, max] = limits[key];
    assert.equal(envelopeTimeValue(-1, min, max), min);
    assert.equal(envelopeTimeValue(2, min, max), max);
    assert.equal(envelopeTimeFraction(min / 2, min, max), 0);
    assert.equal(envelopeTimeFraction(max * 2, min, max), 1);
    for (const fraction of [0, .1, .25, .5, .75, .9, 1]) {
      assert.ok(Math.abs(envelopeTimeFraction(envelopeTimeValue(fraction, min, max), min, max) - fraction) < 1e-12);
    }
    assert.ok(Math.abs(envelopeTimeValue(.5, min, max) - Math.sqrt(min * max)) < 1e-12);
  }
});

test('ADSR handles stay separated at 320px phone width, including extreme and factory envelopes', () => {
  const scenes = AUTOMATA_FULL_PRESETS.map(preset => preset.snapshot.parameters);
  for (let mask = 0; mask < 16; mask++) {
    scenes.push(Object.fromEntries(Object.entries(limits).map(([key, range], i) => [key, range[(mask >> i) & 1]])));
  }
  for (const values of scenes) {
    const points = automatapoeiaEnvelopeGeometry(values, limits);
    const ordered = Object.values(points);
    ordered.forEach((point, i) => {
      assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
      if (i) assert.ok((point.x - ordered[i-1].x) * 256 >= 32, 'touch handles do not overlap');
    });
    assert.equal(points.caAttack.y, 0);
    assert.equal(points.caRelease.y, 1);
    assert.equal(points.caDecay.y, points.caSustain.y);
    assert.equal(points.caSustain.y, 1 - values.caSustain);
  }
});

function rms(samples) {
  let energy = 0;
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample), 'finite output');
    assert.ok(Math.abs(sample) < 1, 'unclipped raw renderer output');
    energy += sample * sample;
  }
  return Math.sqrt(energy / samples.length);
}

for (const sampleRate of [44100, 48000]) {
  test(`Fast clockwork reaches its attack before release and recovers the quiet rows at ${sampleRate} Hz`, () => {
    const p = AUTOMATA_FULL_PRESETS.find(preset => preset.id === 'fast-60').snapshot.parameters;
    assert.equal(p.level, .34, 'do not compensate with Output');
    const options = Object.fromEntries(Object.entries(p).filter(([key]) => key.startsWith('ca'))
      .map(([key, value]) => [key[2].toLowerCase() + key.slice(3), value]));
    Object.assign(options, { sampleRate, detail:p.caRhythmDetail });
    for (const seed of [1, 73, 909]) {
      let cells = Array(p.caWidth).fill(0), previousCells = null;
      cells[Math.floor(cells.length / 2)] = 1;
      let revised = 0, original = 0;
      for (let generation = 0; generation < 32; generation++) {
        const config = { ...options, seed, generation, previousCells };
        const row = renderAutomatapoeiaRow(cells, config);
        const old = renderAutomatapoeiaRow(cells, { ...config, attack:.012, strikeLength:.35 });
        assert.ok(row.events.length > 0);
        for (const event of row.events) assert.ok(event.attackFrames < event.gateFrames, 'attack fits gate');
        const level = rms(row.samples), oldLevel = rms(old.samples);
        assert.ok(level > .015, `audible raw row RMS: ${level}`);
        revised += level; original += oldLevel;
        previousCells = cells;
        cells = automatapoeiaNextRow(cells, p.caRule, p.caBoundary, p.caFamily);
      }
      assert.ok(revised > original * 5, 'substantial recovery without an output-gain increase');
    }
  });
}

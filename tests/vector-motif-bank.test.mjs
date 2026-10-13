import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotifBank } from '../src/instruments/vector-fractals/motif-bank.js';
import { createTraceBank } from '../src/instruments/vector-fractals/trace-model.js';
import { captureMotif, describeMotif } from '../src/instruments/vector-fractals/motif-model.js';
import { sanitizeState, randomizeState, PRESETS } from '../src/instruments/vector-fractals/model.js';

const TAU = 2 * Math.PI;
const shape = (scale = 1, angle = 0, closed = false) => ({ closed,
  points: Array.from({ length: 513 }, (_, i) => {
    const t = i / 512, a = (closed ? TAU : 1.7 * Math.PI) * t, r = closed ? 1 : 1 + .08 * Math.sin(9 * t);
    return [scale * r * Math.cos(a + angle), scale * r * Math.sin(a + angle)];
  }).flat() });
const resultFor = points => ({ points: Float64Array.from(points), offsets: new Uint32Array([0, points.length / 2]), closed: new Uint8Array([1]),
  view: { x: 0, y: 0, width: 1, aspect: 1 }, domain: 'julia', cReal: 0, cImag: 0, depth: 12 });

test('motif presets and captured examples round-trip through finite JSON without losing seam provenance', () => {
  const captured = captureMotif(resultFor(shape(1, 0, true).points), 0, { center: 0, span: .3, samples: 128 });
  const state = sanitizeState({ motifCaptures: [captured, shape(.5, .3)], travelerMode: 'compare' });
  const check = value => {
    assert.notEqual(value, undefined);
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    if (value && typeof value === 'object') {
      assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
      Object.values(value).forEach(check);
    }
  };
  check(state);
  assert.ok(state.motifCaptures[0].sourcePositions[0] < 0);
  assert.equal(state.motifCaptures[0].source.depth, 12);
  assert.equal(state.motifCaptures[0].source.pathClosed, true);
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(state))), state);
  for (const preset of PRESETS) check(preset.snapshot);
  for (let i = 0; i < 32; i++) check(randomizeState(state));
});

test('invalid captures and orphaned B cannot break reader construction', () => {
  const state = sanitizeState({ motifCaptures: [{ points: {} }, shape()], motifSpan: Infinity, motifElastic: -9 });
  assert.equal(state.motifCaptures[0], null);
  assert.equal(state.motifElastic, 0);
  const bank = createMotifBank(null, { ...state, travelerMode: 'choir' });
  assert.equal(bank.layers.length, 3);
  assert.ok(bank.layers.every(layer => !layer.x.length));
});

test('same-travel-speed phrases preserve physical length ratios while equal duration removes size', () => {
  const a = shape(), b = shape(.25, .8), options = { motifCaptures: [a, b], travelerMode: 'compare' };
  const equal = createMotifBank(null, options), original = createMotifBank(null, { ...options, motifTiming: 'original' });
  assert.equal(equal.layers[0].phraseDuration, .5);
  assert.equal(equal.layers[1].phraseDuration, .5);
  assert.ok(Math.abs(original.layers[0].phraseDuration / original.layers[1].phraseDuration - 4) < 1e-10);
  for (const layer of equal.layers) if (layer.turn?.length) { assert.equal(layer.registerOctaves, 0); assert.equal(layer.pan, 0); }
  const extreme = createMotifBank(null, { motifCaptures: [a, shape(1e-8)], travelerMode: 'compare', motifTiming: 'original' });
  assert.equal(extreme.timingLimited, true);
  assert.ok(extreme.layers[1].phraseDuration >= .0399);
  assert.ok(extreme.layers[1].presence.some(v => v > .5));
});

test('original timing follows captured arc distance through the smoothed descriptor', () => {
  const captured = shape(), bank = createMotifBank(null, { motifCaptures: [captured], travelerMode: 'detail', motifTiming: 'original' });
  const descriptor = describeMotif(captured, { detail: .015, samples: 256 });
  assert.equal(bank.motifDescriptors[0].rawLength, descriptor.rawLength);
  for (const layer of bank.layers) {
    assert.ok(layer.x.every(Number.isFinite));
    assert.ok(layer.motifPhase[512] > 0 && layer.motifPhase[512] < layer.motifPhase[1536]);
  }
});

test('turn-budget drums retain geometric timing when pitch drift or detail gain changes', () => {
  const options = { motifCaptures: [shape(1, 0, true)], travelerMode: 'detail', drumPlacement: 'turn', drumTurnStep: 30, drumTurnColor: true, motifDetailGain: 1 };
  const full = createMotifBank(null, options), noDrift = createMotifBank(null, { ...options, travelerDetrend: true, motifDetailGain: 0 });
  for (let i = 0; i < 3; i++) {
    assert.ok(full.layers[i].events.length >= 9);
    assert.deepEqual(full.layers[i].events.map(e => e.phase), noDrift.layers[i].events.map(e => e.phase));
    assert.ok(full.layers[i].events.every(e => e.turnSign === 1));
  }
  assert.ok(Math.max(...noDrift.layers[0].turn.map(Math.abs)) < .01);
});

test('closed path drift subtraction holds a circle without changing its angular drum beads', () => {
  const result = resultFor(shape(1, 0, true).points), options = { contourReader: 'traveler', featureSize: .02, drumPlacement: 'turn', drumTurnStep: 30 };
  const full = createTraceBank([result, result, result], options);
  const detrended = createTraceBank([result, result, result], { ...options, travelerDetrend: true });
  assert.ok(Math.abs(full.layers[0].turnPerLap) > 6);
  assert.equal(detrended.layers[0].turnPerLap, 0);
  assert.ok(Math.max(...detrended.layers[0].turn.map(Math.abs)) < .001);
  assert.ok(full.layers[0].events.length >= 10);
  assert.deepEqual(detrended.layers[0].events, full.layers[0].events);
});

test('turn beads work for radar and scan with explicit sign colors and bounded schedules', () => {
  const result = resultFor(shape(1, 0, true).points);
  for (const contourReader of ['radar', 'scan']) {
    const bank = createTraceBank([result, result, result], { contourReader, drumPlacement: 'turn', drumTurnStep: 5, drumTurnColor: false });
    for (const layer of bank.layers) {
      assert.ok(layer.beads.length > 0 && layer.beads.length <= 256);
      assert.ok(layer.events.length <= 512);
      assert.ok(layer.events.every(e => e.phase >= 0 && e.phase < 1 && !Object.hasOwn(e, 'turnSign')));
    }
  }
});

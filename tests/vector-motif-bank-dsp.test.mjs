import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotifBank } from '../src/instruments/vector-fractals/motif-bank.js';
import { TraceDSP } from '../src/instruments/vector-fractals/trace-dsp.js';

const TAU = 2 * Math.PI;
function arc(scale = 1, rotation = 0) {
  const points = new Float64Array(512);
  for (let i = 0; i < 256; i++) {
    const angle = i / 255 * 1.7 * Math.PI, radius = 1 + .04 * Math.sin(angle * 7);
    points[2 * i] = scale * radius * Math.cos(angle + rotation);
    points[2 * i + 1] = scale * radius * Math.sin(angle + rotation);
  }
  return { points, closed: false, source: {} };
}
function make(bank, sampleRate = 12000) {
  const dsp = new TraceDSP(sampleRate);
  dsp.setState({ contourReader: 'traveler', traceRate: 1, travelerOctaves: 4,
    layerVoices: ['sine', 'sine', 'sine'], bendTimbre: 0, foldTimbre: 0 });
  Object.assign(dsp.params, dsp.targets); dsp.rate = 1; dsp.travelerMix = 1;
  dsp.setBank(bank); dsp.primeMotif(); return dsp;
}

test('real phrase banks play transformed copies with matching onset pitch on every A/B repetition at maximum speed', () => {
  const bank = createMotifBank(null, { motifCaptures: [arc(), arc(.37, .8)], travelerMode: 'compare', motifDetail: .015 });
  assert.ok(bank.motifComparisons[1].similarity > .999999);
  for (const sampleRate of [12000, 48000]) {
    const dsp = make(bank, sampleRate), pair = new Float64Array(2), phrase = new Float64Array(sampleRate / 2);
    let maxCents = 0, heardSamples = 0;
    for (let i = 0; i < sampleRate * 3; i++) {
      const frame = i % sampleRate;
      dsp.sample(pair, 160, true);
      if (i < sampleRate) continue;
      if (frame < sampleRate / 2) phrase[frame] = dsp.motifSmoothedPitch[0];
      else if (dsp.phraseGates[1] > .01) {
        maxCents = Math.max(maxCents, Math.abs(phrase[frame - sampleRate / 2] - dsp.motifSmoothedPitch[1]) * 1200);
        heardSamples++;
      }
    }
    assert.ok(heardSamples > sampleRate / 2);
    assert.ok(maxCents < .01, `matched motif onset disagreement ${maxCents} cents at ${sampleRate} Hz`);
  }
});

test('real choir gates end each open phrase in exact silence before the turn reset', () => {
  const bank = createMotifBank(null, { motifCaptures: [arc(), arc(.5, .3), arc(2, -.4)], travelerMode: 'choir' });
  const dsp = make(bank), pair = new Float64Array(2);
  let peak = 0, silent = 0;
  for (let i = 0; i < dsp.sampleRate * 2; i++) {
    const frame = i % dsp.sampleRate;
    dsp.sample(pair, 160, true);
    peak = Math.max(peak, Math.abs(pair[0]), Math.abs(pair[1]));
    if (i > dsp.sampleRate && (frame > dsp.sampleRate * .965 || frame < dsp.sampleRate * .035)) {
      assert.equal(pair[0], 0); assert.equal(pair[1], 0); silent++;
    }
  }
  assert.ok(peak > .05); assert.ok(silent > dsp.sampleRate * .06);
});

test('broad and residual detail phrases retain an additive turning relationship through the audio bank', () => {
  const bank = createMotifBank(null, { motifCaptures: [arc()], travelerMode: 'detail', motifDetailGain: 1 });
  const dsp = make(bank), pair = new Float64Array(2);
  dsp.setPhase(.45);
  for (let i = 0; i < dsp.sampleRate / 2; i++) dsp.sample(pair, 160, false);
  const index = .45 * bank.layers[0].turn.length, lo = Math.floor(index), mix = index - lo;
  const combinedTurn = bank.layers.reduce((sum, layer) => sum + layer.turn[lo] + (layer.turn[lo + 1] - layer.turn[lo]) * mix, 0);
  const pitches = Array.from(dsp.motifSmoothedPitch.slice(0, 3));
  assert.ok(Math.abs(pitches.reduce((sum, value) => sum + value, 0) + combinedTurn / TAU * 4) < 1e-7);
  assert.ok(Math.abs(pitches[1]) > .001 || Math.abs(pitches[2]) > .001, 'the shaped arc supplies audible fine residual turns');
});

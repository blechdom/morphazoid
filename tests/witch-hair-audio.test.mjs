import test from 'node:test';
import assert from 'node:assert/strict';
import { WitchDSP } from '../src/instruments/witch/witch-worklet.js';
import { WITCH_VOICES } from '../src/instruments/witch/witch-model.js';
import { fft } from '../src/instruments/recursion/recursion-spectral-dsp.js';

const RATE = 24000;
const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
const difference = (a, b) => rms(a.map((value, index) => value - b[index]));
function playing(controls = {}, rate = RATE, seed = 0x71c4) {
  const dsp = new WitchDSP(rate, seed);
  dsp.setControls({ gate: true, speed: .55, radius: .65, ...controls }); dsp.setEnabled(true); return dsp;
}
function render(dsp, seconds, block = 128) {
  const data = new Float32Array(Math.round(dsp.rate * seconds));
  for (let i = 0; i < data.length; i += block) dsp.process(data.subarray(i, Math.min(data.length, i + block)));
  return data;
}

// Level-independent spectral flatness measures how much the shaped voice
// spreads into a noisy band rather than simply getting louder. Use the same
// Hann/FFT measurement for every seed and pull position; no snapshot baseline.
function noiseProfile(data) {
  const size = 1024, first = Math.ceil(350 / RATE * size), last = Math.floor(6000 / RATE * size);
  let flatness = 0, highPower = 0, totalPower = 0, frames = 0;
  for (let start = 0; start + size <= data.length; start += size) {
    const window = Float64Array.from(data.subarray(start, start + size),
      (sample, i) => sample * (.5 - .5 * Math.cos(2 * Math.PI * i / (size - 1))));
    const spectrum = fft(window); let logarithms = 0, powerSum = 0;
    for (let bin = first; bin <= last; bin++) {
      const power = spectrum.real[bin] ** 2 + spectrum.imaginary[bin] ** 2 + 1e-20;
      logarithms += Math.log(power); powerSum += power; totalPower += power;
      if (bin * RATE / size > 1800) highPower += power;
    }
    const bins = last - first + 1;
    flatness += Math.exp(logarithms / bins) / (powerSum / bins); frames++;
  }
  return { flatness: flatness / frames, highFraction: highPower / totalPower };
}

test('hair pull progressively adds broadband texture across voices beyond the variation between seeds', () => {
  for (const voice of WITCH_VOICES) {
    const levels = [0, .5, 1].map(hair => [0x71c4, 0xabcd, 0x123456].map(seed => {
      const dsp = playing({ voice, hair }, RATE, seed);
      // Isolate the existing cauldron engine so finger materials cannot mask
      // the hair's contribution; the complete shared mix is checked below.
      render(dsp.brew, .5); const signal = render(dsp.brew, 1);
      assert.equal(dsp.brew.activeVoice, voice);
      assert.ok(signal.every(sample => Number.isFinite(sample) && Math.abs(sample) <= .540001));
      return noiseProfile(signal);
    }));
    for (const key of ['flatness', 'highFraction']) for (let level = 1; level < levels.length; level++) {
      assert.ok(Math.min(...levels[level].map(profile => profile[key])) > Math.max(...levels[level - 1].map(profile => profile[key])),
        `${voice}: ${key} grows from ${level === 1 ? 'no pull to half pull' : 'half pull to full pull'} across all seeds`);
    }
  }
});

test('live hair changes slew from the existing sample and leave the other performers and clocks intact', () => {
  for (const from of [0, 1]) for (const warmup of [.23, .51, .87]) {
    const changed = playing({ voice: 'sing', hair: from }), held = playing({ voice: 'sing', hair: from });
    assert.deepEqual(render(changed, warmup), render(held, warmup));
    changed.setControls({ hair: 1 - from });
    assert.ok(difference(render(changed, 1 / RATE), render(held, 1 / RATE)) < .001, 'pull/release has no hard gain step');
    assert.ok(Math.abs(changed.brew.hair - held.brew.hair) < .002, 'the existing control smoother remains in charge');
    assert.ok(difference(render(changed, .18), render(held, .18)) > .025, 'a live pull materially changes the signal');
    assert.equal(changed.chantPhase, held.chantPhase); assert.equal(changed.brew.frequency, held.brew.frequency);
    assert.equal(changed.visual.handTime, held.visual.handTime); assert.deepEqual(changed.buffers[2], held.buffers[2]);
  }
});

test('hair texture follows the sample clock through shared flight and Fabric processing', () => {
  const controls = { hair: 1, voice: 'sing', mode: 'flight', fabricX: .08, fabricY: .92 };
  const a = playing(controls), b = playing(controls);
  assert.deepEqual(render(a, 1.4), render(b, 1.4, 24000));
  const dry = playing({ hair: 1, voice: 'sing' });
  const flight = playing({ hair: 1, voice: 'sing', mode: 'flight' });
  const wind = playing({ hair: 1, voice: 'sing', mode: 'flight', fabricX: .08, fabricY: .92 });
  const direct = render(dry, 1.2), delayed = render(flight, 1.2), filtered = render(wind, 1.2);
  assert.ok(difference(direct, delayed) > .015); assert.ok(difference(delayed, filtered) > .015);
  assert.equal(dry.chantPhase, flight.chantPhase); assert.equal(dry.chantPhase, wind.chantPhase);
  assert.ok(flight.visual.delayLevel > .005);
});

test('maximum hair stays bounded at low and normal rates and obeys Audio and Stop release', () => {
  for (const rate of [8000, 48000]) for (const mode of ['brew', 'flight']) {
    const dsp = new WitchDSP(rate); dsp.setControls({ gate: true, ghostGate: true, hair: 1, voice: 'creak', mode, speed: 1 });
    assert.equal(rms(render(dsp, .2)), 0, 'hair cannot arm Audio');
    dsp.setEnabled(true);
    for (let i = 0; i < 12; i++) {
      dsp.setControls({ hair: i % 2 });
      assert.ok(render(dsp, .025).every(value => Number.isFinite(value) && Math.abs(value) <= .840001));
    }
    dsp.setControls({ hair: 1 }); assert.ok(rms(render(dsp, .4)) > .01);
    dsp.setControls({ gate: false, ghostGate: false });
    assert.ok(rms(render(dsp, .06)) > .001, 'Stop releases the texture smoothly');
    render(dsp, 8); assert.ok(rms(render(dsp, .1)) < 1e-6);
    dsp.setControls({ gate: true, ghostGate: true }); render(dsp, .3);
    dsp.setEnabled(false); const phase = dsp.visual.handTime; render(dsp, 2);
    assert.ok(dsp.visual.handTime > phase, 'Audio off leaves primary transport moving');
    assert.ok(rms(render(dsp, .1)) < 1e-7);
  }
});

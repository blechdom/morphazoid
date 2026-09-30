import assert from 'node:assert/strict';
import test from 'node:test';
import { FractalDSP } from '../src/instruments/fractal-signals/dsp.js';
import { createDefaultState } from '../src/instruments/fractal-signals/model.js';

const HELD_SCORE = { points: [{ x: .5, y: .5, phase: 0, depth: 0 }],
  events: [{ phase: 0, freq: 220, amp: .2, duration: 16, pan: 0, point: 0, depth: 0 }] };
const heldState = () => ({ ...createDefaultState('echoes'), engine: 'strikes', base: 220,
  index: 0, shapeToMod: 0, depth: 4, branch: 0, rate: .5, phrase: 128,
  attack: .001, decay: .01, sustain: 1, release: .2, memory: .8, space: 0,
  synthesis: 'pm', inputMix: 1 });

function peak(samples, start, end) {
  let maximum = 0;
  for (let i = Math.floor(start); i < Math.floor(end); i++) maximum = Math.max(maximum, Math.abs(samples[i]));
  return maximum;
}

test('Echo time and ratio edits crossfade steady synth and live input without sharp sample discontinuities', () => {
  const sr = 48000, start = sr * 2, length = start + 128 * 120;
  const cases = [
    [{ echoTime: .047, echoRatio: 1.1 }, [[0, { echoTime: .391 }]]],
    [{ echoTime: .391, echoRatio: 1.1 }, [[0, { echoTime: .047 }]]],
    [{ echoTime: .09, echoRatio: .7 }, [[0, { echoRatio: 1.8 }]]],
    [{ echoTime: .09, echoRatio: 1.8 }, [[0, { echoRatio: .7 }]]],
    [{ echoTime: .047, echoRatio: 1.1 }, [[0, { echoTime: .391 }], [256, { echoTime: .111, echoRatio: 2 }], [512, { echoTime: .281, echoRatio: .85 }]]],
  ];
  for (const microphone of [false, true]) for (const [initial, changes] of cases) {
    let state = { ...heldState(), ...initial };
    const dsp = new FractalDSP(sr, state, HELD_SCORE);
    dsp.setLevel(.55); dsp.setMicrophone(microphone); dsp.setPlaying(true);
    const left = new Float32Array(length), right = new Float32Array(length), input = new Float32Array(128);
    for (let frame = 0; frame < length; frame += 128) {
      const change = changes.find(([offset]) => start + offset === frame);
      if (change) {
        const phase = dsp.phase, age = dsp.voices[0].age;
        state = { ...state, ...change[1] };
        dsp.setState(state, HELD_SCORE);
        assert.equal(dsp.phase, phase, 'editing preserves the score position');
        assert.equal(dsp.voices[0].age, age, 'editing does not retrigger the held voice');
      }
      for (let i = 0; i < input.length; i++) input[i] = .1 * Math.sin((frame + i) / sr * 2 * Math.PI * 110);
      dsp.process(left.subarray(frame, frame + 128), right.subarray(frame, frame + 128), microphone ? input : undefined);
    }
    let curvature = 0, power = 0;
    for (const channel of [left, right]) for (let i = start; i < length; i++) {
      assert.ok(Number.isFinite(channel[i]));
      assert.ok(Math.abs(channel[i]) <= .881);
      curvature = Math.max(curvature, Math.abs(channel[i] - 2 * channel[i - 1] + channel[i - 2]));
      power += channel[i] ** 2;
    }
    // A held 220 Hz tone (110 Hz for live input) has little high-frequency
    // curvature. Discontinuous delay reads previously exceeded .06 here.
    assert.ok(curvature < .002, `${microphone ? 'microphone' : 'synth'} control transition curvature ${curvature}`);
    assert.ok(Math.sqrt(power / (2 * (length - start))) > .001, 'continuity must not come from muting the echo');
    assert.equal(dsp.playing, true);
  }
});

test('rapid Echo edits use the latest geometric times and retain audio already in delay memory', () => {
  const sr = 24000, score = { events: [] };
  let state = { ...createDefaultState('echoes'), engine: 'strikes', inputMix: 1, inputGain: 1,
    echoTime: .05, echoRatio: 1.1, depth: 2, memory: 0, space: 0, base: 220 };
  const dsp = new FractalDSP(sr, state, score);
  dsp.setMicrophone(true); dsp.setPlaying(true);
  const left = new Float32Array(sr * 2), right = new Float32Array(sr * 2), input = new Float32Array(128);
  const changes = new Map([[4096, { echoTime: .211, echoRatio: .7 }],
    [4352, { echoTime: .07, echoRatio: 2.3 }], [4608, { echoTime: .307, echoRatio: 1.7 }]]);
  const impulses = [.16, .8];
  for (let frame = 0; frame < left.length; frame += 128) {
    if (changes.has(frame)) { state = { ...state, ...changes.get(frame) }; dsp.setState(state, score); }
    for (let i = 0; i < input.length; i++) input[i] = impulses.some(time => frame + i === Math.round(sr * time)) ? .65 : 0;
    dsp.process(left.subarray(frame, frame + 128), right.subarray(frame, frame + 128), input);
  }
  // The first impulse entered before all three edits; both final delay heads
  // must still find it. The second impulse checks the settled destination.
  for (const onset of impulses) for (const delay of [.307, .307 * 1.7]) {
    const leftArrival = onset + delay + .002, rightArrival = onset + delay * 1.009 + .002;
    assert.ok(peak(left, sr * (leftArrival - .004), sr * (leftArrival + .006)) > .0005, `stored impulse at left ${leftArrival}`);
    assert.ok(peak(right, sr * (rightArrival - .004), sr * (rightArrival + .006)) > .0005, `stored impulse at right ${rightArrival}`);
  }
  assert.equal(dsp.playing, true);
});

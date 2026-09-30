import assert from 'node:assert/strict';
import test from 'node:test';
import { MODES, PARAMS, MAX_POINTS, MAX_EVENTS, createDefaultState, sanitizeState, generateStructure, fractalValue } from '../src/instruments/fractal-signals/model.js';
import { FractalDSP, sanitizeDSPState } from '../src/instruments/fractal-signals/dsp.js';
import { randomizeState } from '../src/instruments/fractal-signals/presets.js';

const SR = 24000;
const limits = { depth: 48, branch: 64, roughness: 3, turns: 32, phrase: 512 };
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const difference = (a, b) => Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) / a.length);
const deviation = values => { const mean = values.reduce((sum, value) => sum + value, 0) / values.length; return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length); };
function scene(mode) {
  return { ...createDefaultState(mode), base: 55, partialRatio: 1.1, roughness: 1.8, depth: 36, branch: 10, turns: 19, rate: 8, phrase: 8,
    generationLoss: 0, memory: .92, attack: .001, decay: .05, sustain: .35, release: .12, echoTime: .025, echoRatio: 1.045 };
}
function render(state, seconds = 1.2, { structure = generateStructure(state), microphone = false, dsp = new FractalDSP(SR, state, structure) } = {}) {
  dsp.setLevel(1); dsp.setMicrophone(microphone); dsp.setPlaying(true);
  const left = new Float32Array(Math.ceil(seconds * SR)), right = new Float32Array(left.length), input = new Float32Array(128);
  for (let offset = 0; offset < left.length; offset += 128) {
    for (let i = 0; i < input.length; i++) input[i] = .18 * Math.sin(2 * Math.PI * 211 * (offset + i) / SR) + .05 * Math.sin(2 * Math.PI * 991 * (offset + i) / SR);
    dsp.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128), input);
    assert.ok(dsp.activeEvents <= 32);
  }
  for (const channel of [left, right]) for (const value of channel) assert.ok(Number.isFinite(value) && Math.abs(value) < .881, 'finite bounded output');
  return { left, right, dsp };
}

test('all five requested ranges reach the same new limits in model, DSP and randomization', () => {
  for (const [key, max] of Object.entries(limits)) {
    assert.equal(PARAMS[key].max, max);
    assert.equal(sanitizeState({ [key]: 1e9 })[key], max);
    assert.equal(sanitizeDSPState({ [key]: 1e9 })[key], max);
  }
  const randomized = randomizeState(createDefaultState(), () => .999999);
  assert.equal(randomized.depth, 48); assert.equal(randomized.phrase, 512);
  assert.ok(randomized.branch > 15 && randomized.roughness > 2.8 && randomized.turns > 31);
});

test('deeper graphs stay bounded and retain every generation in graphics and score', () => {
  for (const mode of ['grammar', 'grains']) for (const branch of [.8, 8, 8.01, 16]) {
    const state = { ...scene(mode), ...limits, branch, y: .7 };
    const structure = generateStructure(state);
    assert.ok(structure.points.length <= MAX_POINTS && structure.events.length <= MAX_EVENTS);
    const graphic = new Set(structure.points.map(point => point.depth)), sounding = new Set(structure.events.map(event => event.depth));
    for (let depth = 1; depth <= 48; depth++) { assert.ok(graphic.has(depth), `${mode} graphic generation ${depth}`); assert.ok(sounding.has(depth), `${mode} score generation ${depth}`); }
    for (const [parent, child] of structure.edges) {
      assert.ok(parent >= 0 && child > parent && child < structure.points.length);
      assert.equal(structure.points[child].depth, structure.points[parent].depth + 1);
    }
    assert.deepEqual(generateStructure(state), structure, 'deterministic after representative sampling');
  }
});

test('upper noise layers retain variation on binary and texture grids', () => {
  for (const grid of [Array.from({ length: 512 }, (_, i) => i / 512 * 10.5), Array.from({ length: 48 }, (_, i) => i / 48 * 14.5 * 4.5)]) {
    const values = grid.map(time => fractalValue(time, 17491, 3, 48));
    assert.ok(values.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
    assert.ok(deviation(values) > .15, 'deep weighted layers do not collapse to a constant field');
    assert.ok(difference(values, grid.map(time => fractalValue(time, 17491, 3, 47))) > .05, 'the final retained layer changes the field');
  }
  const dsp = new FractalDSP(SR, { ...scene('texture'), depth: 48, roughness: 3 });
  const controls = [];
  for (let i = 0; i < 512; i++) { dsp.phase = i / 512; dsp.updateControls(); controls.push(dsp.modTarget); }
  assert.ok(deviation(controls) > .15, 'the audio control path uses the same non-collapsing extra layers');
});

test('depth 48 and branching 16 change rendered sound in all six modes', () => {
  for (const { id } of MODES) {
    const state = scene(id);
    for (const [key, low, high] of [['depth', 24, 48], ['branch', 8, 16]]) {
      const a = render({ ...state, [key]: low }).left, b = render({ ...state, [key]: high }).left;
      assert.ok(difference(a, b) > 1e-4, `${id} ${key} uses its new range`);
    }
  }
});

test('roughness above 1.8 changes all default engines and every grain engine', () => {
  const cases = MODES.map(({ id }) => scene(id));
  for (const engine of ['sample', 'resonant', 'cloud']) cases.push({ ...scene('grains'), engine });
  for (const state of cases) {
    const a = render({ ...state, roughness: 1.8 }).left, b = render({ ...state, roughness: 3 }).left;
    assert.ok(difference(a, b) > 1e-4, `${state.mode}/${state.engine} high roughness is active`);
  }
});

test('turns beyond twelve change branch geometry and sounding output', () => {
  const low = { ...scene('grammar'), turns: 12 }, high = { ...low, turns: 32 };
  assert.notDeepEqual(generateStructure(low).points, generateStructure(high).points);
  assert.ok(difference(render(low).left, render(high).left) > 1e-4);
});

test('new spectral levels and taps affect a fixed score where the frequencies are audible', () => {
  const structure = { events: [{ phase: 0, freq: 55, amp: .7, duration: 1.2, pan: 0, depth: 1 }] };
  for (const [mode, engine] of [['wander', 'additive'], ['waveform', 'self-affine'], ['waveform', 'folded'], ['waveform', 'hollow'], ['echoes', 'strikes'], ['echoes', 'shepard']]) {
    const state = { ...scene(mode), engine, roughness: 1.8, index: .2, memory: .96 };
    for (const microphone of engine === 'shepard' ? [false, true] : [false]) {
      const a = render({ ...state, depth: 24 }, 1.2, { structure, microphone }).left;
      const b = render({ ...state, depth: 48 }, 1.2, { structure, microphone }).left;
      assert.ok(difference(a, b) > 1e-5, `${mode}/${engine}${microphone ? ' microphone' : ''} uses layers beyond24`);
    }
  }
});

test('large ultrasonic weights do not attenuate an audible fundamental', () => {
  const structure = { events: [{ phase: 0, freq: 8000, amp: .7, duration: .4, pan: 0, depth: 1 }] };
  const state = { ...scene('waveform'), base: 8000, partialRatio: 3, roughness: 3, index: 0, chaos: 0, space: 0, memory: 0 };
  for (const engine of ['self-affine', 'folded', 'hollow']) {
    const low = render({ ...state, engine, depth: 1 }, .35, { structure }).left;
    const high = render({ ...state, engine, depth: 48 }, .35, { structure }).left;
    assert.ok(rms(high) > .02, engine + ' remains audible');
    assert.ok(difference(low, high) < 1e-7, engine + ' omits ultrasonic levels without attenuation');
  }
});

test('512-beat phrases preserve the sample clock and finish at their full duration', () => {
  const state = { ...scene('wander'), phrase: 512, rate: 64, loop: false, pingPong: false };
  const structure = { events: [{ phase: 0, freq: 330, amp: .7, duration: .02, pan: 0, depth: 1 }] };
  const { dsp } = render(state, 8.01, { structure });
  assert.equal(dsp.completed, true); assert.equal(dsp.playing, false); assert.equal(dsp.phase, 1);
  assert.ok(Math.abs(dsp.time - 8) <= 1 / SR + 1e-8);
  const live = new FractalDSP(SR, scene('wander'), structure);
  live.setPhase(.37, { travelDirection: -1, time: 1.63, motionTime: .37 }); live.setPlaying(true);
  const before = Object.fromEntries(['phase', 'time', 'motionTime', 'travelDirection'].map(key => [key, live[key]]));
  live.setState({ ...scene('wander'), ...limits }, generateStructure({ ...scene('wander'), ...limits }));
  for (const [key, value] of Object.entries(before)) assert.equal(live[key], value, key + ' survives range edits');
  assert.equal(live.playing, true);
});

test('dense low-recursion new-range scores retain distinct event markers', () => {
  for (const mode of ['wander', 'waveform']) for (const branch of [8.01, 10.89, 16]) for (const depth of [1, 2, 24, 48]) {
    const state = { ...scene(mode), branch, depth, phrase: 31, timingBend: .63 };
    const structure = generateStructure(state);
    assert.ok(structure.points.length <= 768 && structure.events.length <= 384);
    assert.equal(new Set(structure.events.map(event => event.point)).size, structure.events.length, 'one marker owns each retained attack');
    for (const event of structure.events) assert.equal(structure.points[event.point].phase, event.phase);
  }
});

test('new deep spectral banks bound voice work and retire excess voices without resetting travel', () => {
  const structure = { events: Array.from({ length: 8 }, (_, point) => ({ phase: 0, freq: 55 + point * 7, amp: .7, duration: 3, pan: point % 2 ? -.4 : .4, depth: 1, point })) };
  const state = { ...scene('waveform'), engine: 'folded', depth: 24, rate: 1, phrase: 8, release: 1 };
  const { dsp } = render(state, .05, { structure });
  const expensiveVoices = () => dsp.voices.filter(voice => voice.active && (voice.type === 3 || voice.engine === 'additive'));
  assert.equal(expensiveVoices().length, 8, 'previous range retains all eight expensive voices');
  const before = Object.fromEntries(['phase', 'time', 'motionTime', 'travelDirection'].map(key => [key, dsp[key]]));
  dsp.setState({ ...state, depth: 48 }, structure);
  assert.equal(expensiveVoices().length, 4);
  for (const [key, value] of Object.entries(before)) assert.equal(dsp[key], value);
  assert.ok(Math.abs(dsp.stealL) + Math.abs(dsp.stealR) > 0, 'retired voices retain a short audible transition tail');
  const remaining = render({ ...state, depth: 48 }, .1, { structure, dsp });
  assert.ok(rms(remaining.left) > .005, 'retained notes keep sounding through the depth edit');
  dsp.setState({ ...state, mode: 'wander', engine: 'additive', depth: 48 }, structure);
  for (let i = 0; i < 8; i++) dsp.trigger(structure.events[i]);
  assert.ok(expensiveVoices().length <= 4, 'the work budget covers both retained wave and new additive voices');
  for (const [depth, voices] of [[25, 7], [32, 6], [48, 4]]) {
    const result = render({ ...state, depth }, .05, { structure });
    assert.equal(result.dsp.voices.filter(voice => voice.active).length, voices);
  }
});

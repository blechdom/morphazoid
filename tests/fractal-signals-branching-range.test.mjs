import assert from 'node:assert/strict';
import test from 'node:test';
import { MODES, ENGINE_OPTIONS, PARAMS, MAX_POINTS, MAX_EVENTS, createDefaultState, sanitizeState, generateStructure } from '../src/instruments/fractal-signals/model.js';
import { FractalDSP, sanitizeDSPState } from '../src/instruments/fractal-signals/dsp.js';

const SR = 16000;
const score = structure => structure.events.map(({ phase, freq, amp, duration, pan }) => [phase, freq, amp, duration, pan]);
function scene(mode, branch = 64) {
  return { ...createDefaultState(mode), branch, depth: 24, base: 220, partialRatio: 1.1, roughness: 1.25, rate: 8, phrase: 8,
    generationLoss: .02, memory: .6, attack: .001, decay: .12, sustain: .3, release: .12 };
}
function render(state, seconds = .6, microphone = false) {
  const dsp = new FractalDSP(SR, state, generateStructure(state));
  dsp.setLevel(1); dsp.setMicrophone(microphone); dsp.setPlaying(true);
  const left = new Float32Array(Math.ceil(SR * seconds)), right = new Float32Array(left.length), input = new Float32Array(128);
  for (let offset = 0; offset < left.length; offset += 128) {
    for (let i = 0; i < input.length; i++) input[i] = .16 * Math.sin(2 * Math.PI * 237 * (offset + i) / SR);
    dsp.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128), input);
    assert.ok(dsp.activeEvents <= 32);
  }
  for (const channel of [left, right]) for (const value of channel) assert.ok(Number.isFinite(value) && Math.abs(value) <= .881);
  return { left, dsp };
}
function difference(a, b) { return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length); }

test('Branching reaches 64 in model and audio without increasing geometry or score budgets', () => {
  assert.equal(PARAMS.branch.max, 64);
  assert.equal(sanitizeState({ branch: 64 }).branch, 64);
  assert.equal(sanitizeDSPState({ branch: 64 }).branch, 64);
  assert.equal(sanitizeState({ branch: 1000 }).branch, 64);
  assert.equal(sanitizeDSPState({ branch: 1000 }).branch, 64);
  assert.equal(MAX_POINTS, 768); assert.equal(MAX_EVENTS, 384);
  for (const { id } of MODES) for (const branch of [16.01, 24, 32, 48, 64]) for (const depth of [1, 6, 24, 48]) {
    const state = { ...scene(id, branch), depth, phrase: 512, roughness: 3, turns: 32, seed: 999999 };
    const structure = generateStructure(state);
    assert.ok(structure.points.length <= MAX_POINTS && structure.events.length <= MAX_EVENTS);
    for (const point of structure.points) for (const key of ['x', 'y', 'phase']) assert.ok(Number.isFinite(point[key]) && point[key] >= 0 && point[key] <= 1);
    for (const event of structure.events) for (const key of ['phase', 'freq', 'amp', 'duration', 'pan']) assert.ok(Number.isFinite(event[key]));
    assert.deepEqual(generateStructure(state), structure);
    if (id === 'grammar' || id === 'grains') {
      const visible = new Set(structure.points.map(point => point.depth)), scored = new Set(structure.events.map(event => event.depth));
      for (let generation = 1; generation <= depth; generation++) {
        assert.ok(visible.has(generation), `${id} retains visible generation ${generation}`);
        assert.ok(scored.has(generation), `${id} retains scored generation ${generation}`);
      }
    }
    for (const [parent, child] of structure.edges) {
      assert.ok(parent >= 0 && child > parent && child < structure.points.length);
      if (id === 'grammar') assert.ok(structure.points[child].x > structure.points[parent].x);
    }
  }
});

test('upper branching changes both the retained score and rendered sound in every mode', () => {
  for (const { id } of MODES) {
    const signatures = [16, 32, 64].map(branch => JSON.stringify(score(generateStructure(scene(id, branch)))));
    assert.equal(new Set(signatures).size, 3, `${id} retained score varies above 16`);
    const low = render(scene(id, 16)).left, high = render(scene(id, 64)).left;
    assert.ok(difference(low, high) > 1e-5, `${id} upper branching changes sound`);
  }
});

test('maximum branching remains finite under dense long-release scenes across eighteen engines with live input', () => {
  for (const { id } of MODES) for (const { value: engine } of ENGINE_OPTIONS[id]) {
    const state = { ...scene(id), engine, depth: 48, rate: 64, phrase: 1, roughness: 3, sustain: 1, release: 16,
      memory: .96, inputMix: .5, inputGain: 4, echoRatio: .35, echoTime: .015 };
    const { dsp } = render(state, .3, true);
    assert.equal(dsp.state.branch, 64);
    assert.ok(dsp.activeEvents <= 32);
    assert.ok(dsp.events.length <= 384);
  }
});

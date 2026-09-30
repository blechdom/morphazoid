import assert from 'node:assert/strict';
import test from 'node:test';
import { MODES, ENGINE_OPTIONS, PARAMS, MAX_POINTS, MAX_EVENTS, createDefaultState, generateStructure } from '../src/instruments/fractal-signals/model.js';
import { FractalDSP, sanitizeDSPState } from '../src/instruments/fractal-signals/dsp.js';

const SR = 24000;
function render(state, seconds = 1.2, options = {}) {
  const dsp = new FractalDSP(SR, state, options.structure ?? generateStructure(state));
  dsp.setLevel(1); dsp.setMicrophone(Boolean(options.microphone)); dsp.setPlaying(true);
  const left = new Float32Array(Math.ceil(SR * seconds)), right = new Float32Array(left.length);
  const input = new Float32Array(128);
  for (let offset = 0; offset < left.length; offset += 128) {
    for (let i = 0; i < input.length; i++) input[i] = .16 * Math.sin(2 * Math.PI * 237 * (offset + i) / SR) + .07 * Math.sin(2 * Math.PI * 1191 * (offset + i) / SR);
    dsp.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128), input);
    assert.ok(dsp.activeEvents <= 32);
  }
  for (const samples of [left, right]) for (const value of samples) {
    assert.ok(Number.isFinite(value)); assert.ok(Math.abs(value) <= .881);
  }
  return { left, right, dsp };
}
function difference(a, b) {
  return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
}
function scene(mode) {
  return { ...createDefaultState(mode), base: 110, partialRatio: 1.1, roughness: 1.25, depth: 18, branch: 4, rate: 4, phrase: 8,
    generationLoss: .02, memory: .6, attack: .001, decay: .12, sustain: .3, release: .12 };
}
function musicalScore(structure) {
  return structure.events.map(({ phase, freq, amp, duration, pan }) => ({ phase, freq, amp, duration, pan }));
}

test('expanded recursion and branching retain bounded geometry, every branch generation and actual score changes', () => {
  assert.ok(PARAMS.depth.max >= 24); assert.ok(PARAMS.branch.max >= 8);
  for (const { id } of MODES) {
    const state = scene(id), high = { ...state, depth: 24, branch: 8 };
    const sanitized = sanitizeDSPState(high);
    assert.equal(sanitized.depth, 24); assert.equal(sanitized.branch, 8);
    const structure = generateStructure(high);
    assert.ok(structure.points.length <= MAX_POINTS && structure.events.length <= MAX_EVENTS);
    assert.notDeepEqual(musicalScore(generateStructure({ ...state, depth: 12 })), musicalScore(generateStructure({ ...state, depth: 24 })), `${id} deeper score`);
    assert.notDeepEqual(musicalScore(generateStructure({ ...state, branch: 3 })), musicalScore(generateStructure({ ...state, branch: 8 })), `${id} more branching`);
  }
  for (const mode of ['grammar', 'grains']) for (const branch of [.8, 2.5, 4, 8]) {
    const structure = generateStructure({ ...scene(mode), depth: 24, branch });
    const generations = new Set(structure.points.map(point => point.depth));
    const sounding = new Set(structure.events.map(event => event.depth));
    for (let generation = 1; generation <= 24; generation++) {
      assert.ok(generations.has(generation), `${mode} retains generation ${generation}`);
      assert.ok(sounding.has(generation), `${mode} scores generation ${generation}`);
    }
    for (const [parent, child] of structure.edges) {
      assert.ok(child > parent && child < structure.points.length);
      if (mode === 'grammar') assert.ok(structure.points[child].x > structure.points[parent].x);
    }
  }
});

test('recursion above twelve and branching above 2.5 audibly change every mode', () => {
  for (const { id } of MODES) {
    const state = scene(id);
    for (const [key, lower, upper] of [['depth', 12, 24], ['branch', 3, 8]]) {
      const a = render({ ...state, [key]: lower }).left, b = render({ ...state, [key]: upper }).left;
      assert.ok(difference(a, b) > 1e-4, `${id} ${key} changes rendered audio`);
    }
  }
});

test('extra additive and geometric partials and geometric delay taps alter a fixed score', () => {
  const structure = { events: [{ phase: 0, freq: 110, amp: .7, duration: 1, pan: 0, depth: 1 }] };
  for (const [mode, engine] of [['wander', 'additive'], ['waveform', 'self-affine'], ['waveform', 'folded'], ['waveform', 'hollow'], ['echoes', 'strikes'], ['echoes', 'shepard']]) {
    const state = { ...scene(mode), engine, index: .2, echoTime: .015, echoRatio: 1.1, memory: .94 };
    for (const microphone of engine === 'shepard' ? [false, true] : [false]) {
      const a = render({ ...state, depth: 12 }, 1.2, { structure, microphone }).left;
      const b = render({ ...state, depth: 24 }, 1.2, { structure, microphone }).left;
      assert.ok(difference(a, b) > 1e-5, `${mode}/${engine}${microphone ? ' microphone' : ''} uses levels beyond twelve`);
    }
  }
});

test('maximum recursion/branching stays finite at dense long-release settings across all eighteen engines and live input', () => {
  for (const { id } of MODES) for (const { value: engine } of ENGINE_OPTIONS[id]) {
    const state = { ...scene(id), engine, depth: 24, branch: 8, rate: 64, phrase: 1, roughness: 1.8, sustain: 1, release: 16, memory: .96,
      partialRatio: 1.1, inputMix: .5, inputGain: 4, echoRatio: .35, echoTime: .015 };
    const { dsp } = render(state, 1, { microphone: true });
    assert.equal(dsp.state.depth, 24);
    assert.ok(dsp.events.every(event => event.depth <= 24));
  }
});

test('inaudible higher partials do not attenuate an exposed high fundamental', () => {
  const structure = { events: [{ phase: 0, freq: 8000, amp: .7, duration: .5, pan: 0, depth: 1 }] };
  const state = { ...scene('waveform'), engine: 'self-affine', base: 8000, partialRatio: 3, roughness: 1.8, index: 0, chaos: 0, space: 0 };
  const a = render({ ...state, depth: 12 }, .4, { structure }).left;
  const b = render({ ...state, depth: 24 }, .4, { structure }).left;
  assert.ok(difference(a, b) < 1e-7, 'omitted ultrasonic levels preserve the audible fundamental');
});

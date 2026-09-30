import test from 'node:test';
import assert from 'node:assert/strict';
import { FractalDSP, sanitizeDSPState } from '../src/instruments/fractal-signals/dsp.js';
import { MODES, ENGINE_OPTIONS, createDefaultState, sanitizeState, generateStructure } from '../src/instruments/fractal-signals/model.js';
import { FACTORY_PRESETS, randomizeState } from '../src/instruments/fractal-signals/presets.js';
import { OUTPUT_CEILING } from '../src/instruments/fractal-signals/output.js';

const RATE = 16000;
const NEUTRAL = { pitchInvert: false, timingBend: 0, shapeToMod: 0, stereoWidth: 1, stereoFlip: false };
function render(state, seconds = 1, { mic = false, dsp } = {}) {
  dsp ??= new FractalDSP(RATE, state, generateStructure(state));
  dsp.setPlaying(true); dsp.setLevel(1); dsp.setMicrophone(mic);
  const count = Math.ceil(RATE * seconds), left = new Float32Array(count), right = new Float32Array(count);
  const input = mic ? Float32Array.from({ length: count }, (_, i) => .3 * Math.sin(i * .173) + .1 * Math.sin(i * .413)) : null;
  for (let i = 0; i < count; i += 128) dsp.process(left.subarray(i, i + 128), right.subarray(i, i + 128), input?.subarray(i, i + 128));
  return { dsp, left, right };
}
function difference(a, b) { return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length); }

test('legacy scenes acquire neutral mappings; all new controls participate in complete randomization', () => {
  for (const mode of MODES) {
    const state = createDefaultState(mode.id);
    for (const [key, value] of Object.entries(NEUTRAL)) assert.equal(state[key], value, key);
    const legacy = { ...state }; for (const key of Object.keys(NEUTRAL)) delete legacy[key];
    assert.deepEqual(sanitizeState(legacy), state);
    assert.deepEqual(generateStructure(legacy), generateStructure(state));
    const a = render(legacy), b = render(state);
    assert.deepEqual(a.left, b.left); assert.deepEqual(a.right, b.right);
    const low = randomizeState(state, () => 0), high = randomizeState(state, () => .99999);
    for (const key of Object.keys(NEUTRAL)) assert.notEqual(low[key], high[key], key);
  }
  for (const preset of FACTORY_PRESETS.filter(item => !item.id.includes('-user-'))) for (const [key, value] of Object.entries(NEUTRAL)) assert.equal(preset.snapshot[key], value);
  const hostile = { pitchInvert: 'false', stereoFlip: {}, timingBend: -99, shapeToMod: 1e6, stereoWidth: -8 };
  for (const sanitize of [sanitizeState, sanitizeDSPState]) {
    const clean = sanitize(hostile);
    assert.equal(clean.pitchInvert, false); assert.equal(clean.stereoFlip, false);
    assert.equal(clean.timingBend, -1); assert.equal(clean.shapeToMod, 16); assert.equal(clean.stereoWidth, 0);
  }
});

test('timing bend keeps geometric topology, event order and phrase length while moving attack positions', () => {
  for (const { id } of MODES) for (const direction of [-1, 1]) {
    const state = { ...createDefaultState(id), direction }, base = generateStructure(state);
    for (const timingBend of [-1, 1]) {
      const warped = generateStructure({ ...state, timingBend });
      assert.deepEqual(warped.edges, base.edges, `${id} topology`);
      assert.deepEqual(warped.events.map(e => e.point), base.events.map(e => e.point), `${id} ordering`);
      assert.notDeepEqual(warped.events.map(e => e.phase), base.events.map(e => e.phase), `${id} timing moves`);
      for (const event of warped.events) assert.ok(event.phase >= 0 && event.phase < 1);
      assert.equal(sanitizeState({ ...state, timingBend }).phrase, state.phrase);
    }
  }
});

test('pitch inversion reflects geometric frequencies around Root without moving or reshuffling points', () => {
  for (const { id } of MODES) {
    const state = { ...createDefaultState(id), base: 440, span: .5 };
    const original = generateStructure(state), inverted = generateStructure({ ...state, pitchInvert: true });
    assert.deepEqual(original.points, inverted.points);
    original.events.forEach((event, i) => {
      assert.equal(event.phase, inverted.events[i].phase);
      assert.ok(Math.abs(event.freq * inverted.events[i].freq / state.base ** 2 - 1) < 1e-12);
    });
  }
});

test('timing, pitch inversion and signed shape modulation reach sound in every engine, including continuous banks', () => {
  for (const { id } of MODES) for (const { value: engine } of ENGINE_OPTIONS[id]) {
    const state = { ...createDefaultState(id), engine, rate: 9, phrase: 5, index: 3, base: 330 };
    const original = render(state).left;
    for (const change of [{ pitchInvert: true }, { timingBend: .8 }, { shapeToMod: 16 }, { shapeToMod: -16 }]) {
      const changed = render({ ...state, ...change }).left;
      assert.ok(difference(original, changed) > 1e-5, `${id}/${engine} ${JSON.stringify(change)}`);
    }
  }
});

test('final stereo matrix swaps every engine and live input exactly, sums wet tails to mono, and retains headroom at double width', () => {
  for (const { id } of MODES) for (const { value: engine } of ENGINE_OPTIONS[id]) for (const mic of [false, true]) {
    const state = { ...createDefaultState(id), engine, rate: 8, phrase: 4, space: .8, inputMix: 1 };
    const base = render(state, 1, { mic }), flip = render({ ...state, stereoFlip: true }, 1, { mic });
    assert.deepEqual(flip.left, base.right, `${id}/${engine} flipped L mic=${mic}`);
    assert.deepEqual(flip.right, base.left, `${id}/${engine} flipped R mic=${mic}`);
    const mono = render({ ...state, stereoWidth: 0 }, 1, { mic });
    assert.deepEqual(mono.left, mono.right, `${id}/${engine} wet mono mic=${mic}`);
    assert.ok(mono.left.some(value => Math.abs(value) > 1e-5), `${id}/${engine} audible mono`);
    const wide = render({ ...state, stereoWidth: 2, shapeToMod: 16 }, 1, { mic });
    for (const signal of [wide.left, wide.right]) for (const value of signal) assert.ok(Number.isFinite(value) && Math.abs(value) <= OUTPUT_CEILING + 1e-7);
  }
});

test('mapping edits preserve transport, source, active devices and phase and settle to mono during a wet phrase', () => {
  const state = { ...createDefaultState('echoes'), space: .9 };
  const { dsp } = render(state, .213, { mic: true });
  const phase = dsp.phase, source = dsp.source;
  const changed = { ...state, stereoWidth: 0, pitchInvert: true, timingBend: .6, shapeToMod: 9, stereoFlip: true };
  dsp.setState(changed, generateStructure(changed));
  assert.equal(dsp.phase, phase); assert.equal(dsp.source, source); assert.equal(dsp.playing, true); assert.equal(dsp.microphone, true);
  const settled = render(changed, 1, { dsp, mic: true });
  assert.deepEqual(settled.left.subarray(RATE * .7), settled.right.subarray(RATE * .7));
});

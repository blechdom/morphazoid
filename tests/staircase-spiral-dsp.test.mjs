import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildStaircaseField } from '../src/instruments/striped-staircase-rust/field.js';
import { cameraFromView, viewById } from '../src/instruments/striped-staircase/striped-staircase.js';

const bytes = await readFile(process.env.STAIRCASE_SPIRAL_WASM || new URL('../assets/wasm/staircase.wasm', import.meta.url));
const module = await WebAssembly.compile(bytes);
const FRAMES = 64, VOICES = 512, STRIDE = 3616, FEATURE_STRIDE = VOICES * 6, RATE = 48000;
const OFF = [0, 1, 0, 4, 0, 2, 0, 1, 0, -1];
const BLEND = [1, 1, 1, 4, 1, 2, 1, 1, 1, -1];
const energy = a => a.reduce((sum, x) => sum + x * x, 0) / a.length;
const peak = a => a.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
const difference = (a, b) => energy(a.map((x, i) => x - b[i]));
const hash = a => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

function geometry({ count = 2, feature = (d, slot) => [d * 2 - .5, (slot % 2 ? -1 : 1) * d * .5, .8, d * 4, 1],
  movingGate = false, voice = (d, slot) => [1, .4 + slot % 2 * .2, .5, .2, slot + 1, 0] } = {}) {
  const table = new Float32Array(FRAMES * STRIDE), features = new Float32Array(FRAMES * FEATURE_STRIDE);
  for (let frame = 0; frame < FRAMES; frame++) {
    const d = frame / (FRAMES - 1), at = frame * STRIDE;
    table[at + 532] = 1; table[at + 534] = movingGate ? .25 + d * 8 : .75; table[at + 535] = 1; table[at + 536] = 1;
    for (let slot = 0; slot < count; slot++) {
      const record = voice(d, slot);
      table.set(record, at + 544 + slot * 6);
      features.set([record[4], ...feature(d, slot)], frame * FEATURE_STRIDE + slot * 6);
    }
  }
  return { table, features };
}
function fixture({ data = geometry(), studies = OFF, depth = .3, hold = true, seconds = 4, gain = .75, base = 73,
  brightness = .55, span = 0, rate = RATE } = {}) {
  const api = new WebAssembly.Instance(module).exports, engine = api.stair_new(rate);
  const left = api.stair_alloc(4096 * 4), right = api.stair_alloc(4096 * 4);
  function upload(values, kind) {
    const pointer = api.stair_alloc(values.byteLength);
    new Float32Array(api.memory.buffer, pointer, values.length).set(values);
    const result = api[kind](engine, pointer, values.length, FRAMES);
    api.stair_free(pointer, values.byteLength); return result;
  }
  const setStudies = values => api.stair_studies ? api.stair_studies(engine, ...values) : 1;
  const install = (next, sidecar = true) => {
    assert.equal(upload(next.table, 'stair_table'), 1);
    if (sidecar && api.stair_features) assert.equal(upload(next.features, 'stair_features'), 1);
  };
  install(data); setStudies(studies);
  if (api.stair_focus) assert.equal(api.stair_focus(engine, 0, 0), 1);
  if (api.stair_gate) assert.equal(api.stair_gate(engine, 1), 1);
  api.stair_controls(engine, 2, base, brightness, .15, gain, seconds);
  api.stair_pitch(engine, 1, span); api.stair_seek(engine, depth, 1); api.stair_transport(engine, 1, 1, +hold);
  return { api, engine, upload, install, setStudies,
    render(seconds, block = 128) {
      const count = Math.round(seconds * rate), output = [new Float32Array(count), new Float32Array(count)];
      for (let at = 0; at < count; at += block) {
        const n = Math.min(block, count - at); assert.equal(api.stair_process(engine, left, right, n), 1);
        output[0].set(new Float32Array(api.memory.buffer, left, n), at);
        output[1].set(new Float32Array(api.memory.buffer, right, n), at);
      }
      return output;
    },
    state: () => new Float64Array(api.memory.buffer, api.stair_state(engine), 12).slice(),
    voices: () => new Float64Array(api.memory.buffer, api.stair_voice_state(engine), VOICES * 6).slice(),
    seek: d => api.stair_seek(engine, d, 1),
    focus: (first = 0, second = 0) => api.stair_focus(engine, first, second),
    gate: enabled => api.stair_gate(engine, +enabled),
    transport: (playing, enabled, held) => api.stair_transport(engine, playing, enabled, held),
    close() { api.stair_drop(engine); api.stair_free(left, 4096 * 4); api.stair_free(right, 4096 * 4); }
  };
}
function settled(options, seconds = .25) {
  const f = fixture(options); f.render(.5); const samples = f.render(seconds)[0], voices = f.voices(); f.close();
  return { samples, voices };
}
function near(actual, expected, message, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≈ ${expected}`);
}

test('all-off studies preserve exact pre-studies PCM with installed feature data', () => {
  const f = fixture({ hold: false, data: geometry({ movingGate: true }), span: 3,
    studies: [0, 3, 0, 8, 0, 4, 0, 4, 0, 1] });
  try {
    const output = f.render(1.25);
    const fingerprint = hash(output[0]);
    if (process.env.STAIRCASE_SPIRAL_GOLDEN) console.log('PRE_STUDIES_PCM_SHA256', fingerprint);
    else assert.equal(fingerprint, '7d251d253d08a3d84abca9a2a42ed02a1ae843befb2e2e1e2c29579918e67d26');
    assert.deepEqual(output[0], output[1]);
  } finally { f.close(); }
});

test('additive sidecar ABI rejects wrong shape and ignores unsupported/unrelated feature identities', () => {
  const f = fixture({ studies: BLEND });
  try {
    assert.equal(f.api.stair_abi_version(), 3); assert.equal(f.api.stair_state_len(), 12);
    assert.equal(f.api.stair_features(f.engine, 0, 1, 64), 0);
    assert.equal(f.api.stair_features(f.engine, 0, 0, 65), 0);
    assert.equal(f.api.stair_features(f.engine, 0, 0, 0), 0);
  } finally { f.close(); }
  const missing = geometry({ feature: () => [3, 4, 1, 9, 0] });
  const unrelated = geometry({ feature: () => [3, 4, 1, 9, 1] });
  for (let frame = 0; frame < FRAMES; frame++) for (let slot = 0; slot < 2; slot++) unrelated.features[frame * FEATURE_STRIDE + slot * 6] = 300 + slot;
  const baseline = settled({ data: missing }).samples;
  assert.equal(hash(settled({ data: missing, studies: BLEND }).samples), hash(baseline));
  assert.equal(hash(settled({ data: unrelated, studies: BLEND }).samples), hash(baseline));
});

test('turn amount/span and signed direction determine pitch; full amount replaces static XY', () => {
  const data = geometry({ feature: () => [.5, 0, 0, 0, 1] });
  for (const amount of [0, .5, 1]) for (const turnSpan of [0, 1, 3]) {
    const studies = [...OFF]; studies[0] = amount; studies[1] = turnSpan;
    const { voices } = settled({ data, studies, span: 3 });
    near(voices[1], 73 * 2 ** (-.15 * (1 - amount) + amount * turnSpan * .5), 'carrier pitch', .00002);
  }
  const studies = [...OFF]; studies[0] = 1;
  const down = settled({ studies, data: geometry({ feature: () => [-.5, 0, 0, 0, 1] }) });
  near(down.voices[1], 73 / Math.SQRT2, 'negative turn descends');
  const clamp = settled({ studies: [1, 3, 0, 4, 0, 2, 0, 1, 0, -1],
    data: geometry({ feature: () => [-1024, 0, 0, 0, 1] }) });
  near(clamp.voices[1], 20, 'negative glides retain an audible floor');
});

test('fork inheritance begins at parent pitch despite distinct edge coordinates, then diverges continuously', () => {
  const studies = [...OFF]; studies[4] = 1; studies[5] = 2;
  const born = geometry({ count: 4, voice: (_, s) => [1, .1 + s * .2, .8 - s * .15, .2, s + 1, s > 1 ? s - 1 : 0],
    feature: () => [0, .2, 0, 0, 1] });
  const { voices } = settled({ studies, data: born, span: 6 });
  for (let slot = 0; slot < 4; slot++) near(voices[slot * 6 + 1], 73 * 2 ** .4, 'child inherits fork pitch');
  for (const forkSpan of [0, 2, 4]) {
    const values = [...studies]; values[5] = forkSpan;
    const grown = geometry({ feature: (_, s) => [0, s ? -.3 : .3, 0, 0, 1] });
    const result = settled({ studies: values, data: grown });
    near(result.voices[1], 73 * 2 ** (forkSpan * .3), 'first edge fork', .00003);
    near(result.voices[7], 73 * 2 ** (-forkSpan * .3), 'other edge fork', .00003);
  }
});

test('turn accents follow geometric travel and retain white sustain with RMS-compensated peaks', () => {
  const studies = [...OFF]; studies[2] = 1;
  const options = travel => ({ studies, gain: .08, data: geometry({ feature: () => [0, 0, 0, travel, 1], voice: (_, s) => [1, .5, .5, .001, s + 1, 0] }) });
  const crest = settled(options(0)).samples, trough = settled(options(.125)).samples;
  assert.ok(energy(trough) > 1e-8, 'accent trough sustains');
  assert.ok(energy(crest) / energy(trough) > 4, 'geometric phase creates an accent');
  const slow = [...studies]; slow[3] = 1; const fast = [...studies]; fast[3] = 8;
  const data = geometry({ feature: () => [0, 0, 0, .125, 1] });
  assert.ok(difference(settled({ studies: slow, data }).samples, settled({ studies: fast, data }).samples) > .0001);
});

test('curvature amount and drive brighten the spectrum at quiet and default levels', () => {
  const data = geometry({ feature: () => [0, 0, .4, 0, 1] });
  for (const gain of [.04, .75]) {
    const samples = [0, .5, 1].map(amount => {
      const studies = [...OFF]; studies[6] = amount; studies[7] = 4;
      return settled({ studies, data, gain, brightness: .15 }).samples;
    });
    assert.ok(difference(samples[0], samples[1]) > 1e-7);
    assert.ok(difference(samples[1], samples[2]) > 1e-7);
    const spectral = values => {
      let real = 0, imaginary = 0;
      for (let i = 0; i < values.length; i++) { const phase = i / RATE * 73 * 5 * Math.PI * 2; real += values[i] * Math.cos(phase); imaginary += values[i] * Math.sin(phase); }
      return Math.hypot(real, imaginary) / values.length;
    };
    assert.ok(spectral(samples[2]) > spectral(samples[0]) * 1.05);
  }
  const low = [...OFF], high = [...OFF]; low[6] = high[6] = 1; low[7] = 0; high[7] = 4;
  assert.ok(difference(settled({ studies: low, data }).samples, settled({ studies: high, data }).samples) > .00001);
});

test('constant accepted geometry is independent of scan speed and Hold: no free-running study LFO', () => {
  const data = geometry({ feature: () => [.2, .1, .6, .21, 1] });
  const outputs = [
    settled({ data, studies: BLEND, hold: true, seconds: 2 }).samples,
    settled({ data, studies: BLEND, hold: false, seconds: 2 }).samples,
    settled({ data, studies: BLEND, hold: false, seconds: 200 }).samples
  ];
  assert.deepEqual(outputs[0], outputs[1]); assert.deepEqual(outputs[0], outputs[2]);
});

test('full blend preserves stripe gating, centered output, clock and sample-block invariance', () => {
  const data = geometry({ movingGate: true });
  const a = fixture({ data, studies: BLEND, hold: false, depth: .1 });
  const b = fixture({ data, studies: BLEND, hold: false, depth: .1 });
  try {
    const x = a.render(1, 128), y = b.render(1, 37);
    assert.deepEqual(x[0], x[1]); assert.deepEqual(x[0], y[0]);
    assert.deepEqual(a.state(), b.state()); assert.equal(a.state()[0], RATE);
    assert.ok(a.state()[8] >= 1);
    a.seek(0); a.transport(1, 1, 1); const black = a.render(.7)[0];
    assert.ok(peak(black.subarray(-4800)) < 1e-12);
    a.seek(.05); const white = a.render(.3)[0]; assert.ok(energy(white.subarray(-4800)) > .0001);
    const before = a.state(); a.setStudies(OFF); a.render(.5);
    assert.equal(a.state()[0], before[0] + RATE / 2); assert.equal(a.state()[1], before[1]);
    a.transport(0, 1, 1); assert.equal(peak(a.render(.7)[0].subarray(-4800)), 0);
    a.transport(1, 0, 1); assert.equal(peak(a.render(.7)[0].subarray(-4800)), 0);
  } finally { a.close(); b.close(); }
});

test('confidence loss holds own feature, replacement clears it, and different IDs cannot inherit stale motion', () => {
  const data = geometry({ feature: d => d < .5 ? [.5, 0, 0, .2, 1] : [10, 10, 1, 100, 0] });
  const studies = [...OFF]; studies[0] = 1;
  const f = fixture({ data, studies });
  try {
    f.render(.5); const old = f.voices()[1]; f.seek(.8); f.render(.5);
    near(f.voices()[1], old, 'same identity holds accepted turn');
    f.install(data, false); f.render(.5); near(f.voices()[1], 73, 'missing sidecar resets studies');
    f.install(data); f.seek(.3); f.render(.5); near(f.voices()[1], old, 'new sidecar accepted');
    const other = geometry({ voice: (_, s) => [1, .5, .5, .2, s + 100, 0], feature: () => [10, 10, 1, 100, 0] });
    f.install(other); f.render(.5); near(f.voices()[1], 73, 'new unsupported identity is neutral');
  } finally { f.close(); }
});

test('Shepard study creates octave components, reverses with direction, and holds geometry without reset', () => {
  const data = geometry({ feature: () => [0, 0, 0, .3, 1] });
  const up = [...OFF], down = [...OFF]; up[8] = down[8] = 1; up[9] = 1;
  const plain = settled({ data, gain: .08 }).samples;
  const rising = settled({ data, studies: up, gain: .08 }).samples;
  const falling = settled({ data, studies: down, gain: .08 }).samples;
  assert.ok(difference(rising, plain) > .001); assert.ok(difference(rising, falling) > .001);
  const ratio = energy(rising) / energy(plain); assert.ok(ratio > .2 && ratio < 3, `octave bank power ${ratio}`);
  const f = fixture({ data, studies: up });
  try {
    f.render(.5); const state = f.state(); f.render(.5);
    assert.equal(f.state()[1], state[1]); assert.equal(f.state()[8], state[8]);
    near(f.voices()[1], 73, 'diagnostic is the carrier, octave bank is internal');
  } finally { f.close(); }
});

test('all 512 voices with hostile feature/control values stay finite and bounded without clock changes', () => {
  const data = geometry({ count: 512, feature: (_, s) => s % 2 ? [NaN, Infinity, -1, Infinity, 1] : [1e30, -1e30, 1e30, 1e30, 1e30] });
  const f = fixture({ data, studies: [2, 99, 2, 99, 2, 99, 2, 99, 2, -Infinity], hold: false });
  try {
    const output = f.render(.55);
    assert.ok(output[0].every(Number.isFinite)); assert.ok(peak(output[0]) <= .89);
    assert.equal(f.state()[0], Math.round(RATE * .55)); assert.equal(f.state()[10], 512);
    assert.ok(f.voices().every(Number.isFinite));
    f.setStudies(Array(10).fill(NaN)); const after = f.render(.4)[0]; assert.ok(after.every(Number.isFinite));
  } finally { f.close(); }
});


test('identity boundaries choose matching feature records without interpolating unrelated turns', () => {
  const data = geometry({ count: 1,
    voice: d => [1, .5, .5, .2, d < .5 ? 1 : 100, 0],
    feature: d => [d < .5 ? 1 : -1, 0, 0, 0, 1] });
  const studies = [...OFF]; studies[0] = 1;
  const f = fixture({ data, studies, depth: .499 });
  try {
    f.render(.6); near(f.voices()[1], 146, 'nearest first identity');
    f.seek(.501); f.render(.6); near(f.voices()[1], 36.5, 'nearest second identity');
    assert.equal(f.voices()[0], 100);
  } finally { f.close(); }
});

test('scene replacement slews active study pitch without resetting the sample clock', () => {
  const studies = [...OFF]; studies[0] = 1; studies[1] = 3;
  const f = fixture({ studies, data: geometry({ feature: () => [1, 0, 0, 0, 1] }) });
  try {
    f.render(.6); const before = f.voices()[1], clock = f.state()[0];
    near(before, 584, 'old study pitch');
    f.install(geometry({ feature: () => [-1, 0, 0, 0, 1] })); f.render(32 / RATE);
    const next = f.voices()[1]; assert.ok(next > before * .94 && next < before, 'first refreshed pitch is a gradual transition');
    assert.equal(f.state()[0], clock + 32);
    f.render(.6); near(f.voices()[1], 20, 'replacement reaches bounded pitch');
  } finally { f.close(); }
});

test('real Seahorse turning, accents, curvature and octave studies affect a moving passage', () => {
  const data = buildStaircaseField({ aspect: 1070 / 776, resolution: 112, pitchSource: 1, voiceLimit: 256 });
  const options = { data, depth: .43, hold: false, seconds: 1 / .035, span: 3 };
  const original = settled(options, .6).samples;
  assert.ok(energy(original) > 1e-5);
  for (const amountIndex of [0, 2, 6, 8]) {
    const studies = [...OFF]; studies[amountIndex] = 1;
    const output = settled({ ...options, studies }, .6).samples;
    assert.ok(difference(original, output) > 1e-5, `real geometry study ${amountIndex / 2} changes output`);
    assert.ok(output.every(Number.isFinite));
  }
});

test('certified real Spiral arms offspring supplies audible fork pitch separation', () => {
  const data = buildStaircaseField({ aspect: 1070 / 776, resolution: 112, pitchSource: 1, voiceLimit: 32,
    camera: cameraFromView(viewById('spiral')) });
  const options = { data, depth: 51 / 63, span: 0 };
  const off = settled(options), studies = [...OFF]; studies[4] = 1; studies[5] = 2;
  const fork = settled({ ...options, studies });
  assert.ok(difference(off.samples, fork.samples) > 1e-5, 'real certified fork changes the audible mix');
  const frame = 51, record = Array.from({ length: VOICES }, (_, slot) => slot)
    .find(slot => data.table[frame * STRIDE + 544 + slot * 6] > .5 && Math.abs(data.features[frame * FEATURE_STRIDE + slot * 6 + 2]) > .05);
  assert.notEqual(record, undefined, 'fixture retains a measured fork');
  const offset = data.features[frame * FEATURE_STRIDE + record * 6 + 2];
  near(fork.voices[record * 6 + 1], 73 * 2 ** (offset * 2), 'actual fork record controls pitch', .0001);
});


test('a newly audible child starts at inherited fork pitch on its first attack sample', () => {
  const data = geometry({
    voice: (d, slot) => [slot === 0 || d >= .5 ? 1 : 0, slot ? .9 : .1, slot ? .1 : .9, .2, slot + 1, slot],
    feature: () => [0, .5, 0, 0, 1] });
  const studies = [...OFF]; studies[4] = 1; studies[5] = 2;
  const f = fixture({ data, studies, depth: .25, span: 6 });
  try {
    f.render(.6); near(f.voices()[1], 146, 'parent pitch before birth');
    f.seek(.75); f.render(1 / RATE);
    near(f.voices()[7], 146, 'child pitch on first sample');
    near(f.voices()[7], f.voices()[1], 'child begins with its parent');
  } finally { f.close(); }
});


test('an unsupported identity reusing a silent slot starts at its own base pitch', () => {
  const data = geometry({ count: 1,
    voice: d => [d < .33 || d > .66 ? 1 : 0, .9, .1, .2, d > .66 ? 100 : 1, 0],
    feature: d => d > .66 ? [9, 9, 1, 100, 0] : [1, 0, 0, 0, 1] });
  const studies = [...OFF]; studies[0] = 1;
  const f = fixture({ data, studies, depth: .2, span: 6 });
  try {
    f.render(.6); near(f.voices()[1], 146, 'old supported voice');
    f.seek(.5); f.render(.4); assert.ok(peak(f.render(32 / RATE)[0]) < 1e-12);
    f.seek(.8); f.render(1 / RATE);
    assert.equal(f.voices()[0], 100);
    near(f.voices()[1], 73 * 2 ** 2.4, 'fresh unsupported voice uses full base reference', .0001);
  } finally { f.close(); }
});


test('ID focus releases other voices, preserves mapped counts, and never substitutes an absent ID', () => {
  const data = geometry({ count: 4,
    voice: (_, slot) => [1, .2 + slot * .2, .5, .2, slot + 1, 0] });
  const f = fixture({ data, span: 4 });
  try {
    f.render(.5); const all = f.render(.1)[0], before = f.state();
    assert.equal(f.focus(1, 2), 1); const transition = f.render(.1)[0], pair = f.render(.2);
    assert.equal(f.state()[10], 4, 'diagnostics keep all mapped voices');
    assert.ok(energy(pair[0]) > .001); assert.deepEqual(pair[0], pair[1]);
    assert.ok(difference(all, pair[0].subarray(0, all.length)) > .001);
    let step = 0; for (let i = 1; i < transition.length; i++) step = Math.max(step, Math.abs(transition[i] - transition[i - 1]));
    assert.ok(step < .2, 'focus releases through the existing envelope');
    assert.equal(f.focus(30000, 30001), 1);
    assert.ok(peak(f.render(.7)[0].subarray(-4800)) < 1e-12, 'absent selected IDs are silent after release');
    assert.equal(f.state()[1], before[1]); assert.equal(f.state()[8], before[8]);
    assert.equal(f.state()[10], 4); assert.ok(f.state()[0] > before[0]);
    assert.equal(f.focus(3, 0), 1); assert.ok(energy(f.render(.3)[0].subarray(-4800)) > .001);
    assert.equal(f.focus(0, 2), 0); assert.equal(f.focus(32769, 0), 0);
    assert.ok(energy(f.render(.1)[0]) > .001, 'invalid selection preserves the previous voice');
    assert.equal(f.focus(), 1); assert.ok(energy(f.render(.2)[0]) > .001);
  } finally { f.close(); }
});

test('focused pairs release on black, pause and mute', () => {
  const data = geometry({ count: 4, movingGate: true });
  const f = fixture({ data, depth: .05, studies: BLEND });
  try {
    f.focus(1, 2); const white = f.render(.5)[0]; assert.ok(energy(white.subarray(-4800)) > .0001);
    f.seek(0); assert.ok(peak(f.render(.7)[0].subarray(-4800)) < 1e-12);
    f.seek(.05); assert.ok(energy(f.render(.3)[0].subarray(-4800)) > .0001);
    f.transport(0, 1, 1); assert.equal(peak(f.render(.7)[0].subarray(-4800)), 0);
    f.transport(1, 0, 1); assert.equal(peak(f.render(.7)[0].subarray(-4800)), 0);
  } finally { f.close(); }
});

test('focus affects only Stripe rhythm and follows categorical IDs through slot changes', () => {
  for (const mode of [0, 1, 3]) {
    const a = fixture(), b = fixture();
    try {
      a.api.stair_controls(a.engine, mode, 73, .55, .15, .75, 4);
      b.api.stair_controls(b.engine, mode, 73, .55, .15, .75, 4);
      b.focus(30000, 0); b.gate(false);
      assert.equal(hash(a.render(.3)[0]), hash(b.render(.3)[0]), `mode ${mode} ignores rhythm focus`);
    } finally { a.close(); b.close(); }
  }
  const data = geometry({ count: 2,
    voice: (d, slot) => [1, .3 + slot * .4, .5, .2, d < .5 ? slot + 1 : slot === 0 ? 100 : 1, 0] });
  const f = fixture({ data, span: 4 });
  try {
    f.focus(1, 0); f.render(.5); const low = f.voices()[1];
    f.seek(.8); const moved = f.render(.5)[0];
    assert.equal(f.voices()[6], 1); assert.ok(f.voices()[7] > low);
    assert.ok(energy(moved.subarray(-4800)) > .001);
    f.focus(2, 0); assert.ok(peak(f.render(.7)[0].subarray(-4800)) < 1e-12, 'reused slot does not inherit selection');
  } finally { f.close(); }
});


test('disabling stripe gating sustains black while preserving measured gate, focus and transport', () => {
  const f = fixture({ data: geometry({ movingGate: true }), depth: 0, studies: BLEND });
  try {
    assert.equal(peak(f.render(.3)[0]), 0); assert.equal(f.state()[11], 0);
    const clock = f.state()[0]; assert.equal(f.gate(false), 1); f.focus(1, 2);
    const flowing = f.render(.4); assert.ok(energy(flowing[0].subarray(-4800)) > .001);
    assert.deepEqual(flowing[0], flowing[1]); assert.equal(f.state()[11], 0);
    assert.equal(f.state()[0], clock + RATE * .4); assert.equal(f.state()[1], 0);
    assert.equal(f.gate(true), 1); assert.ok(peak(f.render(.7)[0].subarray(-4800)) < 1e-12);
    f.gate(false); f.focus(30000, 0); assert.equal(peak(f.render(.4)[0].subarray(-4800)), 0);
    f.focus(1, 2); assert.ok(energy(f.render(.3)[0].subarray(-4800)) > .001);
    f.transport(0, 1, 1); assert.equal(peak(f.render(.7)[0].subarray(-4800)), 0);
    f.transport(1, 0, 1); assert.equal(peak(f.render(.7)[0].subarray(-4800)), 0);
  } finally { f.close(); }
});

test('ungated continuous pitch follows moving edge coordinates while stripe events still advance', () => {
  const data = geometry({ movingGate: true,
    voice: (d, slot) => [1, .5 + slot * .1, d, .2, slot + 1, 0] });
  const f = fixture({ data, depth: .1, hold: false, span: 6 });
  try {
    f.gate(false); f.focus(1, 2); f.render(.2); const before = f.voices(), state = f.state();
    assert.ok(energy(f.render(.5)[0]) > .001); const after = f.voices();
    assert.ok(after[1] < before[1] * .8, 'first edge glides with geometry');
    assert.ok(after[7] < before[7] * .8, 'second edge glides with geometry');
    assert.ok(f.state()[8] > state[8], 'white onset bookkeeping survives continuous playback');
    assert.equal(f.state()[0], state[0] + RATE / 2);
  } finally { f.close(); }
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildStaircaseField } from '../src/instruments/striped-staircase-rust/field.js';

const module = await WebAssembly.compile(await readFile(new URL('../assets/wasm/staircase.wasm', import.meta.url)));
const BLOCK = 128, FRAMES = 64, STRIDE = 3616;
const actual = buildStaircaseField();
const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const energy = values => values.reduce((sum, value) => sum + value * value, 0) / values.length;
const difference = (a, b) => a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) / a.length;
const roughness = values => values.reduce((sum, value, index) => sum + (index ? (value - values[index - 1]) ** 2 : 0), 0) / values.length;

function geometry() {
  const data = new Float32Array(FRAMES * STRIDE);
  for (let frame = 0; frame < FRAMES; frame++) {
    const at = frame * STRIDE, depth = frame / (FRAMES - 1);
    for (let index = 0; index < 256; index++) {
      const phase = index / 256 * Math.PI * 2;
      data[at + index] = .4 * Math.sin(phase) + .12 * Math.sin(phase * 5 + depth * 2);
      data[at + 256 + index] = .3 * Math.cos(phase) + .16 * Math.sin(phase * 3 - depth);
    }
    for (let index = 0; index < 16; index++) data[at + 512 + index] = (index % 3 + 1) / 31;
    data.set([.1 + depth * .2, .15 + depth * .25, -.2 + depth * .4, .1, 1, .3 + depth * .4, 3 + depth * 120, 7], at + 528);
    data.set([1, .15, .25, .15, 1, 0, 1, .85, .75, .15, 2, 0], at + 544);
  }
  return data;
}

function fixture({ rate = 48000, mode = 0, base = 110, brightness = .55, body = .5, gain = .5, seconds = 4,
  depth = .2, mapping = 0, span = 3, table = geometry(), playing = true, enabled = true, hold = false } = {}) {
  const api = new WebAssembly.Instance(module).exports, engine = api.stair_new(rate);
  assert.ok(engine);
  const pointers = [api.stair_alloc(BLOCK * 4), api.stair_alloc(BLOCK * 4)];
  const controls = values => {
    ({ mode = mode, base = base, brightness = brightness, body = body, gain = gain, seconds = seconds } = values);
    assert.equal(api.stair_controls(engine, mode, base, brightness, body, gain, seconds), 1);
  };
  const transport = values => {
    ({ playing = playing, enabled = enabled, hold = hold } = values);
    assert.equal(api.stair_transport(engine, +playing, +enabled, +hold), 1);
  };
  const install = data => {
    const pointer = api.stair_alloc(data.byteLength);
    new Float32Array(api.memory.buffer, pointer, data.length).set(data);
    assert.equal(api.stair_table(engine, pointer, data.length, data.length / STRIDE), 1);
    api.stair_free(pointer, data.byteLength);
  };
  if (table) install(table);
  controls({}); transport({}); api.stair_seek(engine, depth, 1);
  api.stair_pitch(engine, mapping, span);
  const render = (secondsToRender, blockSize = BLOCK) => {
    const count = Math.round(secondsToRender * rate), result = [new Float32Array(count), new Float32Array(count)];
    for (let at = 0; at < count; at += blockSize) {
      const length = Math.min(count - at, blockSize);
      assert.equal(api.stair_process(engine, ...pointers, length), 1);
      for (let channel = 0; channel < 2; channel++) result[channel].set(new Float32Array(api.memory.buffer, pointers[channel], length), at);
    }
    return result;
  };
  return { api, engine, render, controls, transport, install,
    seek: (depth, direction = 1) => api.stair_seek(engine, depth, direction),
    pitch: (mapping, span = 3) => api.stair_pitch(engine, mapping, span),
    voices: () => new Float64Array(api.memory.buffer, api.stair_voice_state(engine), api.stair_voice_capacity() * 6).slice(),
    state: () => new Float64Array(api.memory.buffer, api.stair_state(engine), api.stair_state_len()).slice(),
    close() { api.stair_drop(engine); for (const pointer of pointers) api.stair_free(pointer, BLOCK * 4); } };
}

test('staircase Rust raw ABI is import-free, versioned, and rejects invalid buffers/rates', () => {
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const f = fixture();
  try {
    assert.equal(f.api.stair_abi_version(), 3); assert.equal(f.api.stair_state_len(), 12);
    for (const rate of [0, 7999, NaN, Infinity, 192001]) assert.equal(f.api.stair_new(rate), 0);
    assert.equal(f.api.stair_table(f.engine, 0, STRIDE, 1), 0);
    assert.equal(f.api.stair_table(f.engine, 0, 0, 65), 0);
    assert.equal(f.api.stair_process(f.engine, 0, 0, 128), 0);
  } finally { f.close(); }
});

for (const rate of [44100, 48000]) test(`four measured-field modes are finite, distinct, and bounded at ${rate} Hz`, () => {
  const results = [];
  for (let mode = 0; mode < 4; mode++) {
    const f = fixture({ rate, mode, table: actual.table, seconds: 4, depth: .15 });
    try {
      const output = f.render(1.5);
      for (const channel of output) {
        assert.ok(channel.every(Number.isFinite)); assert.ok(peak(channel) < 1);
        assert.ok(energy(channel.subarray(rate / 3)) > 1e-7, `mode ${mode} has audible energy`);
      }
      if (mode === 2) assert.ok(f.state()[8] > 2, 'measured white stripes cause note onsets');
      results.push(output[0]);
    } finally { f.close(); }
  }
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    assert.ok(difference(results[a], results[b]) > 1e-5, `mode ${a} and ${b} differ`);
  }
});

test('Audio starts silent, mute preserves clock and depth, and pause releases to exact silence', () => {
  const f = fixture({ enabled: false });
  try {
    assert.equal(peak(f.render(.25)[0]), 0);
    assert.equal(f.state()[0], 12000); assert.ok(f.state()[1] > .25);
    f.transport({ enabled: true }); assert.ok(peak(f.render(.25)[0]) > .01);
    const beforeMute = f.state(); f.transport({ enabled: false });
    const muted = f.render(.6)[0]; assert.equal(peak(muted.subarray(-4800)), 0);
    assert.ok(f.state()[1] > beforeMute[1]);
    f.transport({ enabled: true }); assert.ok(peak(f.render(.2)[0]) > .01);
    f.transport({ playing: false }); const stopped = f.state();
    const released = f.render(.6)[0]; assert.equal(peak(released.subarray(-4800)), 0);
    assert.equal(f.state()[1], stopped[1]); assert.ok(f.state()[0] > stopped[0]);
  } finally { f.close(); }
});

function branchGeometry({ branches = [[1, .15, .25, .15], [1, .85, .75, .15]], threshold = 5.25, period = 7, paired = false } = {}) {
  const table = geometry();
  for (let frame = 0; frame < FRAMES; frame++) {
    const at = frame * STRIDE;
    table[at + 534] = threshold;
    table[at + 535] = period;
    table[at + 536] = Number(paired);
    table.fill(0, at + 544, at + STRIDE);
    for (let branch = 0; branch < branches.length; branch++) table.set([...branches[branch].slice(0, 4), branches[branch][4] ?? branch + 1, branches[branch][5] ?? 0], at + 544 + branch * 6);
  }
  return table;
}

test('Hold sustains all mappings in white and keeps the rhythm silent in black', () => {
  for (let mode = 0; mode < 4; mode++) {
    const f = fixture({ mode, table: branchGeometry(), body: .05 });
    try {
      f.render(.4); f.transport({ hold: true }); const depth = f.state()[1], onsets = f.state()[8];
      const held = f.render(1.5)[0].subarray(-4800);
      assert.equal(f.state()[1], depth); assert.equal(f.state()[8], onsets);
      assert.ok(energy(held) > 1e-7, `mode ${mode} sustains on Hold`);
      assert.equal(f.state()[10], 2); assert.equal(f.state()[11], 1);
      if (mode === 2) {
        f.install(branchGeometry({ threshold: 1.75 }));
        assert.ok(peak(f.render(.5)[0].subarray(-4800)) < 1e-8);
        assert.equal(f.state()[11], 0); assert.equal(f.state()[10], 2);
      }
    } finally { f.close(); }
  }
});

test('white is on, black is off, and onset timing follows stripe depth without stale attacks', () => {
  const f = fixture({ mode: 2, table: branchGeometry({ threshold: 1.75 }), seconds: 2, body: 1 });
  try {
    assert.equal(peak(f.render(.8)[0]), 0); assert.equal(f.state()[8], 0); assert.equal(f.state()[11], 0);
    f.install(branchGeometry()); assert.ok(energy(f.render(.4)[0].subarray(-4800)) > 1e-5);
    assert.equal(f.state()[11], 1, 'white starts sounding without needing another boundary');
    f.install(geometry()); f.render(.8); assert.ok(f.state()[8] >= 4);
    f.transport({ hold: true }); f.seek(.05); f.render(.5); const onsets = f.state()[8];
    f.seek(.95); f.render(.05);
    assert.ok(f.state()[8] <= onsets + 1, 'a scrub creates at most one present onset, never stale bursts');
    f.install(branchGeometry({ threshold: 1.75 }));
    assert.ok(peak(f.render(.5)[0].subarray(-4800)) < 1e-7, 'even maximum Release leaves a black rest');
  } finally { f.close(); }
});

const toneEnergy = (data, frequency, rate = 48000) => {
  let real = 0, imaginary = 0;
  for (let i = 0; i < data.length; i++) {
    real += data[i] * Math.cos(2 * Math.PI * frequency * i / rate);
    imaginary += data[i] * Math.sin(2 * Math.PI * frequency * i / rate);
  }
  return (real * real + imaginary * imaginary) / (data.length * data.length);
};

test('separate branches keep their unquantized pitches together in a centered mix', () => {
  const frequencies = [110 * 2 ** .75, 110 * 2 ** -.75], recordings = [];
  for (const branches of [[[1, .05, .25, .2]], [[1, .05, .25, .2], [1, .95, .75, .2]]]) {
    const f = fixture({ mode: 2, hold: true, brightness: 0, table: branchGeometry({ branches }) });
    try {
      const output = f.render(.8).map(channel => channel.subarray(14400)); recordings.push(output);
      assert.equal(f.state()[10], branches.length);
      assert.deepEqual(output[0], output[1], 'branch positions never separate the rhythm channels');
      assert.ok(toneEnergy(output[0], frequencies[0]) > 1e-4);
      if (branches.length === 2) {
        assert.ok(toneEnergy(output[0], frequencies[1]) > 1e-4);
      }
    } finally { f.close(); }
  }
  assert.ok(toneEnergy(recordings[1][1], frequencies[1]) > toneEnergy(recordings[0][1], frequencies[1]) * 1000);
});

test('horizontal position has no audio effect in Height mode', () => {
  const recordings = [];
  for (const x of [.05, .5, .95]) {
    const f = fixture({ mode: 2, mapping: 0, hold: true, table: branchGeometry({ branches: [[1, x, .25, .2]] }) });
    try { recordings.push(f.render(.4)); } finally { f.close(); }
  }
  assert.deepEqual(recordings[0], recordings[1]);
  assert.deepEqual(recordings[1], recordings[2]);
});

test('all 512 branch voices remain finite and bounded; absent or zero-length branches stay silent', () => {
  const branches = Array.from({ length: 512 }, (_, i) => [1, i / 511, i / 511, .6]);
  const f = fixture({ mode: 2, gain: 1, brightness: 1, hold: true, table: branchGeometry({ branches }) });
  try {
    for (const channel of f.render(.7)) {
      assert.ok(channel.every(Number.isFinite)); assert.ok(peak(channel) < 1); assert.ok(energy(channel) > 1e-5);
    }
    assert.equal(f.state()[10], 512);
    for (const branches of [[], [[0, .5, .5, .8]], [[1, .5, .5, 0]]]) {
      f.install(branchGeometry({ branches }));
      assert.ok(peak(f.render(.7)[0].subarray(-4800)) < 1e-8);
      assert.equal(f.state()[10], 0);
    }
  } finally { f.close(); }
});

for (const count of [2, 256]) test(`${count} paired tendrils share their weight across ${count * 2} centered tones without doubling the level`, () => {
  const centers = Array.from({ length: count }, (_, index) => [1, index / Math.max(1, count - 1), .2 + (index % 7) * .08, .2, index + 1, 0]);
  const edges = centers.flatMap(([presence, x, y, length], index) => [
    [presence, x, y, length / 2, index * 2 + 1, 0],
    [presence, x, y, length / 2, index * 2 + 2, 0],
  ]);
  const center = fixture({ mode: 2, mapping: 1, gain: 1, brightness: 1, hold: true, table: branchGeometry({ branches: centers }) });
  const paired = fixture({ mode: 2, mapping: 1, gain: 1, brightness: 1, hold: true, table: branchGeometry({ branches: edges, paired: true }) });
  try {
    const a = center.render(.4), b = paired.render(.4);
    assert.equal(center.state()[10], count); assert.equal(paired.state()[10], count * 2);
    assert.deepEqual(b[0], b[1]);
    assert.ok(b[0].every(Number.isFinite)); assert.ok(peak(b[0]) < .89);
    assert.ok(energy(b[0]) > 1e-5);
    assert.ok(difference(a[0], b[0]) < 1e-14, 'coincident edge pitches retain the original tendril level');
  } finally { center.close(); paired.close(); }
});

test('independent dense tones retain musical energy and Volume scales the bounded result after shaping', () => {
  const recordings = [];
  for (const count of [2, 16]) {
    const branches = Array.from({ length: count }, (_, index) => [1, .5, .12 + .76 * index / (count - 1), .2]);
    const f = fixture({ mode: 2, gain: .75, brightness: .55, hold: true, table: branchGeometry({ branches }) });
    try {
      const data = f.render(1.5)[0].subarray(24000);
      recordings.push(data);
      assert.ok(peak(data) < .89 * .75, 'fixed headroom also applies at high density');
    } finally { f.close(); }
  }
  assert.ok(energy(recordings[1]) > energy(recordings[0]) * .55,
    'sixteen independent tones must not lose the roughly 9 dB caused by coherent-peak normalization');
  const quiet = fixture({ mode: 2, gain: .25, hold: true, table: branchGeometry() });
  const loud = fixture({ mode: 2, gain: .75, hold: true, table: branchGeometry() });
  try {
    const a = quiet.render(.8)[0].subarray(24000), b = loud.render(.8)[0].subarray(24000);
    assert.ok(difference(a.map(value => value * 3), b) < 1e-14,
      'Volume changes amplitude without driving the waveshaper harder');
  } finally { quiet.close(); loud.close(); }
});

test('paired normalization requires an explicit binary field flag and preserves fading tiny fields', () => {
  const branches = [[1, .5, .3, .2], [1, .5, .3, .2]];
  const render = flag => {
    const f = fixture({ mode: 2, hold: true, table: branchGeometry({ branches, paired: flag }) });
    try { return f.render(.6)[0].subarray(14400); } finally { f.close(); }
  };
  const independent = render(0), paired = render(1);
  assert.ok(energy(independent) > energy(paired) * 1.1, 'the explicit flag affects coherent pair normalization');
  for (const invalid of [-1, .5, 2, NaN, Infinity]) assert.deepEqual(render(invalid), independent);
  const silent = fixture({ mode: 2, hold: true, table: branchGeometry({ branches: [] }) });
  const tiny = fixture({ mode: 2, hold: true, table: branchGeometry({ branches: [[1, .5, .3, 1e-7]] }) });
  try {
    assert.equal(peak(silent.render(.6)[0]), 0);
    assert.ok(peak(tiny.render(.6)[0]) < 1e-5, 'normalization never turns a vanishing contour into a full-level voice');
  } finally { silent.close(); tiny.close(); }
});

function movementGeometry(position, branches = 1) {
  const source = geometry(), table = source.slice(0, 17 * STRIDE);
  for (let frame = 0; frame < 17; frame++) {
    const at = frame * STRIDE;
    table[at + 534] = frame; table[at + 535] = 2;
    table.fill(0, at + 544, at + STRIDE);
    for (let slot = 0; slot < branches; slot++) table.set(position(frame, slot), at + 544 + slot * 6);
  }
  return table;
}
const voice = (f, id) => {
  const voices = f.voices();
  for (let at = 0; at < voices.length; at += 6) if (voices[at] === id) return voices.slice(at, at + 6);
  assert.fail(`voice ${id} is present`);
};
const closeTo = (actual, expected, tolerance = 1e-3) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is close to ${expected}`);

const preparedVoices = (field, frame) => Array.from({ length: 512 }, (_, slot) => {
  const record = field.table.slice(frame * STRIDE + 544 + slot * 6, frame * STRIDE + 550 + slot * 6);
  return { slot, record };
}).filter(({ record }) => record[0] > .001);
const preparedWhite = (field, frame) => Math.floor(field.table[frame * STRIDE + 534] / field.table[frame * STRIDE + 535] * 2) % 2 === 1;

test('prepared block edges drive independent pitches from actual positions with shared gates and centered output', () => {
  const field = buildStaircaseField({ pitchSource: 1, voiceLimit: 512 });
  assert.equal(field.pitchSource, 1);
  let selected = null, separation = 0;
  for (let frame = 0; frame < field.frames; frame++) {
    if (!preparedWhite(field, frame)) continue;
    const records = preparedVoices(field, frame);
    for (const { slot, record: left } of records) {
      if (slot % 2) continue;
      const right = records.find(item => item.slot === slot + 1)?.record;
      if (!right || right[4] !== left[4] + 1) continue;
      const distance = Math.min(Math.abs(left[2] - right[2]), Math.abs((left[1] - left[2]) - (right[1] - right[2])));
      if (distance > separation) { separation = distance; selected = { frame, records, left, right }; }
    }
  }
  assert.ok(selected && separation > 1e-5, 'the real paired field supplies distinct boundary positions for both mappings');
  const black = Array.from({ length: field.frames }, (_, frame) => frame).find(frame => !preparedWhite(field, frame) && preparedVoices(field, frame).length >= 2);
  assert.ok(black !== undefined, 'the same field contains a black rest with measured edge pairs');
  for (const mapping of [0, 1]) {
    const f = fixture({ mode: 2, mapping, hold: true, body: 1, depth: selected.frame / (field.frames - 1), table: field.table });
    try {
      const output = f.render(.3);
      assert.deepEqual(output[0], output[1]); assert.ok(energy(output[0]) > 1e-7);
      for (const { record } of selected.records) {
        const expected = 110 * 2 ** (3 * (mapping === 0 ? .5 - record[2] : (record[1] - record[2]) / 2));
        closeTo(voice(f, record[4])[1], expected, 1e-5);
      }
      assert.ok(Math.abs(voice(f, selected.left[4])[1] - voice(f, selected.right[4])[1]) > .001);
      assert.equal(f.state()[10], selected.records.length);
      assert.equal(f.state()[10] % 2, 0); assert.equal(f.state()[11], 1);
      if (mapping === 1) {
        const clock = f.state()[0]; f.seek(black / (field.frames - 1));
        const rest = f.render(.6);
        assert.deepEqual(rest[0], rest[1]); assert.ok(peak(rest[0].subarray(-4800)) < 1e-8);
        assert.equal(f.state()[11], 0); assert.ok(f.state()[0] > clock);
        f.seek(selected.frame / (field.frames - 1)); assert.ok(energy(f.render(.2)[0]) > 1e-7);
      }
    } finally { f.close(); }
  }
});

test('prepared paired offshoot identities inherit each corresponding parent edge independently', () => {
  const field = buildStaircaseField({ pitchSource: 1, voiceLimit: 512 });
  assert.equal(field.pitchSource, 1);
  const previous = new Map(); let family;
  for (let frame = 0; frame < field.frames && !family; frame++) {
    const records = preparedVoices(field, frame);
    for (const { slot, record: left } of records) {
      if (slot % 2 || !left[5] || previous.has(left[4])) continue;
      const right = records.find(item => item.slot === slot + 1)?.record;
      const parentLeft = previous.get(left[5]), parentRight = right && previous.get(right[5]);
      if (!right || !parentLeft || !parentRight || right[4] !== left[4] + 1 || right[5] !== left[5] + 1) continue;
      if (Math.abs((parentLeft[1] - parentLeft[2]) - (parentRight[1] - parentRight[2])) < 1e-4) continue;
      family = { left, right, parentLeft, parentRight }; break;
    }
    for (const { record } of records) previous.set(record[4], record);
  }
  assert.ok(family, 'the measured field has an offshoot with two distinguishable parent-edge references');
  // Keep actual positions, lengths and ancestry from the field, while placing
  // the child's birth just after the parent's first held-white note. Its first
  // movement must establish heading and retain the corresponding parent pitch.
  const table = branchGeometry({ branches: [family.parentLeft, family.parentRight, family.left, family.right] });
  table[544 + 2 * 6] = 0; table[544 + 3 * 6] = 0;
  const f = fixture({ mode: 2, mapping: 2, table, depth: 0, seconds: 2 });
  try {
    f.render(1 / 48000);
    const parentPitches = [voice(f, family.parentLeft[4])[1], voice(f, family.parentRight[4])[1]];
    f.render(.2);
    for (const [index, child, parent] of [[0, family.left, family.parentLeft], [1, family.right, family.parentRight]]) {
      const actual = voice(f, child[4]);
      closeTo(actual[1], parentPitches[index], 1e-6);
      closeTo(actual[2], parent[1], 1e-7); closeTo(actual[3], parent[2], 1e-7);
      assert.equal(actual[4], 1); assert.equal(actual[5], parent[4]);
    }
  } finally { f.close(); }
});

test('returning paired edges note their own prior positions once during an already-white stripe', () => {
  const table = new Float32Array(9 * STRIDE);
  for (let frame = 0; frame < 9; frame++) {
    const at = frame * STRIDE;
    table[at + 532] = 1; table[at + 534] = [0, 2, 4, 5, 5, 5, 5, 5, 5][frame]; table[at + 535] = 2;
    const presence = frame > 3 && frame < 7 ? 0 : 1;
    const left = frame <= 3 ? [.2 + frame * .05, .6] : [.35, .4];
    const right = frame <= 3 ? [.6 + frame * .05, .2] : [.75, .4];
    table.set([presence, ...left, .15, 1, 0, presence, ...right, .15, 2, 0], at + 544);
  }
  const f = fixture({ mode: 2, mapping: 2, table, depth: 0, seconds: 2 });
  try {
    f.render(.8); const before = [voice(f, 1), voice(f, 2)], onsets = f.state()[8];
    f.render(.5); assert.equal(f.state()[10], 0, 'the uncertified pair genuinely disappears');
    f.render(.25); const returned = [voice(f, 1), voice(f, 2)];
    assert.equal(f.state()[11], 1); assert.equal(f.state()[8], onsets, 'returning voices do not invent a global stripe crossing');
    closeTo(returned[0][1] / before[0][1], 2 ** -1.5, 1e-6);
    closeTo(returned[1][1] / before[1][1], 2 ** 1.5, 1e-6);
    for (const [index, x, y] of [[0, .35, .6], [1, .75, .2]]) {
      closeTo(returned[index][2], x, 1e-6); closeTo(returned[index][3], y, 1e-6);
      assert.equal(returned[index][4], 1); assert.equal(returned[index][5], 0);
    }
    f.render(.15);
    assert.deepEqual([voice(f, 1), voice(f, 2)], returned, 'one presence transition produces one note');
    f.transport({ hold: true }); f.render(.25);
    assert.deepEqual([voice(f, 1), voice(f, 2)], returned, 'Hold does not repeatedly process the return');
  } finally { f.close(); }
});

test('Frame XY pitch responds to horizontal and vertical location; Height preserves the original mapping', () => {
  const results = [];
  for (const mapping of [0, 1]) {
    const frequencies = [];
    for (const [x, y] of [[.25, .25], [.75, .25], [.75, .75]]) {
      const f = fixture({ mode: 2, mapping, hold: true, table: branchGeometry({ branches: [[1, x, y, .3]] }) });
      try { f.render(.2); frequencies.push(voice(f, 1)[1]); } finally { f.close(); }
    }
    results.push(frequencies);
  }
  closeTo(results[0][0], results[0][1]);
  closeTo(results[0][0] / results[0][2], 2 ** 1.5);
  closeTo(results[1][0], 110);
  closeTo(results[1][1] / results[1][0], 2 ** .75);
  closeTo(results[1][0], results[1][2]);
});

test('Relative Turns uses each voice previous note, establishes heading, and ignores stationary Hold', () => {
  const table = movementGeometry(frame => {
    const x = frame <= 5 ? .15 + frame * .05 : .4;
    const y = frame <= 5 ? .5 : .5 - (frame - 5) * .05;
    return [1, x, y, .3, 1, 0];
  });
  const f = fixture({ mode: 2, mapping: 2, table, depth: 0, seconds: 2 });
  try {
    f.render(.13); const first = voice(f, 1);
    closeTo(first[1], 110 * 2 ** -.45, .03); assert.equal(first[4], 0);
    f.render(.25); const second = voice(f, 1);
    closeTo(second[1], first[1], .01); assert.equal(second[4], 1);
    closeTo(second[2], .2, .001); closeTo(second[3], .5);
    f.render(.25); const third = voice(f, 1);
    closeTo(third[1], second[1], .01, 'straight movement adds no interval');
    f.render(.25); const turn = voice(f, 1);
    closeTo(turn[1] / third[1], 2 ** -1.2, .005);
    closeTo(turn[2], .4, .001); closeTo(turn[3], .5, .001);
    f.transport({ hold: true }); const depth = f.state()[1]; f.render(.5);
    assert.equal(f.state()[1], depth); assert.deepEqual(voice(f, 1), turn);
    const beforeClock = f.state()[0]; f.controls({ base: 220, brightness: .9 }); f.render(.4);
    closeTo(voice(f, 1)[1] / turn[1], 2, .001);
    assert.deepEqual(voice(f, 1).slice(2), turn.slice(2), 'ordinary timbre/register edits preserve the note reference');
    assert.ok(f.state()[0] > beforeClock);
    f.pitch(2, 0); f.render(.1); closeTo(voice(f, 1)[1], 220);
    assert.deepEqual(voice(f, 1).slice(2), turn.slice(2), 'Span zero preserves the note reference');
    f.pitch(2, 1.5); f.render(.1);
    closeTo(voice(f, 1)[1] / 220, Math.sqrt(turn[1] / 110), .001);
  } finally { f.close(); }
});

test('a new offshoot inherits its parent previous pitch and heading without slot-order bias', () => {
  const results = [];
  for (const reverse of [false, true]) {
    const table = movementGeometry((frame, slot) => {
      const parent = [1, .15 + frame * .05, .5, .3, 1, 0];
      const child = [frame <= 6 ? 0 : 1, .4, .4, .3, 2, 1];
      return (slot === 0) !== reverse ? parent : child;
    }, 2);
    const f = fixture({ mode: 2, mapping: 2, table, depth: 0, seconds: 2 });
    try {
      f.render(.88); const parent = voice(f, 1), child = voice(f, 2);
      closeTo(child[1] / parent[1], 2 ** -1.2, .005);
      assert.equal(child[4], 1); assert.equal(child[5], 1);
      closeTo(child[2], .4, .001); closeTo(child[3], .5);
      results.push(child);
    } finally { f.close(); }
  }
  assert.deepEqual(results[0], results[1]);
});

test('slot reuse chooses categorical identity and never interpolates a fictitious branch or inherits unrelated history', () => {
  const table = movementGeometry(frame => frame < 8 ? [1, .15 + frame * .05, .5, .3, 1, 0] : [1, .8, .3, .3, 99, 0]);
  const f = fixture({ mode: 2, mapping: 2, table, depth: 0, seconds: 2 });
  try {
    f.render(.95); const replacement = voice(f, 99);
    closeTo(replacement[1], 110 * 2 ** .75, .001);
    assert.equal(replacement[4], 0, 'a replacement has no reference to the old occupant');
    closeTo(replacement[2], .8); closeTo(replacement[3], .3);
  } finally { f.close(); }
});

test('an offshoot can inherit a parent whose physical voice slot has been reused', () => {
  const table = movementGeometry(frame => frame < 8 ? [1, .15 + frame * .05, .5, .3, 1, 0] : [1, .5, .4, .3, 2, 1]);
  const f = fixture({ mode: 2, mapping: 2, table, depth: 0, seconds: 2 });
  try {
    f.render(.89); const parent = voice(f, 1);
    f.render(.06); const child = voice(f, 2);
    closeTo(child[1] / parent[1], 2 ** -1.2, .005);
    assert.equal(child[4], 1); assert.equal(child[5], 1);
    closeTo(child[2], .5, .001); closeTo(child[3], .5);
  } finally { f.close(); }
});

test('a white onset at an identity boundary inherits the parent previous note before any stale-identity update', () => {
  const table = new Float32Array(3 * STRIDE);
  for (let frame = 0; frame < 3; frame++) {
    const at = frame * STRIDE;
    table[at + 532] = 1; table[at + 534] = frame * 2; table[at + 535] = 2;
    table.set(frame < 2 ? [1, frame * .5, .5, .3, 1, 0] : [1, .5, .3, .3, 2, 1], at + 544);
  }
  const f = fixture({ mode: 2, mapping: 2, table, depth: 0, seconds: 2 });
  try {
    // White onsets occur at samples 24000 and 72000, just before the following
    // 32-sample geometry refresh. The second onset also switches the nearest
    // categorical identity from the parent to its child in the same slot.
    f.render(24064 / 48000); const parent = voice(f, 1);
    closeTo(parent[1], 110 * 2 ** -.375, 1e-6);
    f.render(48000 / 48000); const child = voice(f, 2);
    closeTo(child[1], parent[1], 1e-6, 'the child establishes its first heading without an invented turn');
    closeTo(child[2], .25, 1e-6); closeTo(child[3], .5, 1e-6);
    assert.equal(child[4], 1); assert.equal(child[5], 1);
  } finally { f.close(); }
});

test('Relative Turns clamps accumulated pitch offsets to four octaves around the register', () => {
  const table = movementGeometry(frame => [1, .5 + .25 * Math.cos(frame * Math.PI / 4), .5 + .25 * Math.sin(frame * Math.PI / 4), .3, 1, 0]);
  const f = fixture({ mode: 2, mapping: 2, span: 6, table, depth: 0, seconds: 2 });
  try {
    let highest = 0;
    for (let note = 0; note < 8; note++) {
      f.render(note === 0 ? .13 : .25);
      const frequency = voice(f, 1)[1]; highest = Math.max(highest, frequency);
      assert.ok(frequency <= 110 * 16 + 1e-9 && frequency >= 110 / 16 - 1e-9);
    }
    closeTo(highest, 110 * 16);
  } finally { f.close(); }
});

test('seek, replacement, and mapping changes reset note references without stopping clocks', () => {
  const table = movementGeometry(frame => [1, .15 + frame * .04, .5, .3, 1, 0]);
  const f = fixture({ mode: 2, mapping: 2, table, depth: 0, seconds: 2 });
  try {
    f.render(.4); assert.equal(voice(f, 1)[4], 1);
    const before = f.state()[0];
    f.seek(7.2 / 16); f.transport({ hold: true }); f.render(.1);
    assert.equal(voice(f, 1)[4], 0); assert.ok(f.state()[0] > before);
    f.pitch(1); f.render(.1); f.pitch(2); f.render(.1);
    assert.equal(voice(f, 1)[4], 0);
    f.install(table); f.render(.1); assert.equal(voice(f, 1)[4], 0);
    closeTo(voice(f, 1)[1], 110 * 2 ** (3 * ((.15 + 7.2 * .04) - .5) / 2), .001);
  } finally { f.close(); }
});

test('stationary repeated notes do not accumulate intervals and Relative Turns remains bounded with 512 voices', () => {
  const table = movementGeometry((frame, slot) => [1, slot / 511, .4, .2, slot + 1, 0], 512);
  const f = fixture({ mode: 2, mapping: 2, span: 6, table, depth: 0, seconds: 2, gain: 1 });
  try {
    f.render(.15); const initial = Array.from({ length: 512 }, (_, slot) => voice(f, slot + 1)[1]);
    for (const channel of f.render(1)) { assert.ok(channel.every(Number.isFinite)); assert.ok(peak(channel) < 1); }
    for (let slot = 0; slot < 512; slot++) closeTo(voice(f, slot + 1)[1], initial[slot], 1e-9);
  } finally { f.close(); }
});

test('sample clock progresses during absent UI updates and pingpongs without depth drift', () => {
  const f = fixture({ seconds: 2, enabled: false, depth: .9 });
  try {
    f.render(1); assert.ok(Math.abs(f.state()[1] - .6) < 1e-9); assert.equal(f.state()[2], -1);
    f.render(2); assert.ok(Math.abs(f.state()[1] - .4) < 1e-9); assert.equal(f.state()[2], 1);
    assert.equal(f.state()[0], 144000);
    f.seek(.7, -1); f.controls({ brightness: .9 }); f.transport({ enabled: true });
    f.render(.2); assert.ok(Math.abs(f.state()[1] - .6) < 1e-9, 'ordinary control packets do not seek');
  } finally { f.close(); }
});

test('phase and events do not depend on render block size', () => {
  for (const [mode, mapping] of [[0, 0], [2, 0], [2, 2], [3, 0]]) {
    const a = fixture({ mode, mapping }), b = fixture({ mode, mapping });
    try {
      const x = a.render(.5, 128), y = b.render(.5, 17);
      assert.deepEqual(x, y); assert.deepEqual(a.state(), b.state()); assert.deepEqual(a.voices(), b.voices());
    } finally { a.close(); b.close(); }
  }
});

test('base frequency and brightness have audible continuous effects', () => {
  const spectra = [];
  for (const brightness of [.05, .95]) {
    const f = fixture({ mode: 1, hold: true, brightness });
    try { spectra.push(f.render(.6)[0].subarray(12000)); } finally { f.close(); }
  }
  assert.ok(roughness(spectra[1]) / energy(spectra[1]) > roughness(spectra[0]) / energy(spectra[0]) * 2);
  const captures = [];
  for (const base of [110, 110.37, 220]) {
    const f = fixture({ mode: 0, hold: true, base });
    try { captures.push(f.render(.7)[0].subarray(12000)); } finally { f.close(); }
  }
  assert.ok(difference(captures[0], captures[1]) > 1e-5, 'small Hz edits are not quantized to notes');
  const crossings = data => data.reduce((sum, value, index) => sum + Number(index > 0 && value > 0 && data[index - 1] <= 0), 0);
  assert.ok(crossings(captures[2]) > crossings(captures[0]) * 1.7);
});

test('Release changes black-stripe tails and Detail adds branch harmonics', () => {
  const tails = [], detail = [], bodies = [];
  for (const body of [0, 1]) {
    const rhythm = fixture({ mode: 2, table: branchGeometry(), body, hold: true });
    const resonant = fixture({ mode: 3, body, hold: true });
    try {
      rhythm.render(.4); rhythm.install(branchGeometry({ threshold: 1.75 }));
      const release = rhythm.render(.2)[0]; tails.push(energy(release.subarray(2400, 4800)));
      bodies.push(resonant.render(.8)[0].subarray(12000));
    } finally { rhythm.close(); resonant.close(); }
  }
  assert.ok(tails[1] > tails[0] * 100, 'maximum Release extends the black-stripe tail');
  assert.ok(difference(bodies[0], bodies[1]) > 1e-6);
  for (const brightness of [0, 1]) {
    // A quiet geometric weight isolates Detail's source harmonics from the
    // output waveshaper, which also adds odd harmonics at performance levels.
    const f = fixture({ mode: 2, brightness, hold: true, table: branchGeometry({ branches: [[1, .5, .5, .0002]] }) });
    try { detail.push(f.render(.8)[0].subarray(14400)); } finally { f.close(); }
  }
  assert.ok(toneEnergy(detail[1], 220) > toneEnergy(detail[0], 220) * 100);
  assert.ok(toneEnergy(detail[1], 330) > toneEnergy(detail[0], 330) * 5);
  const field = buildStaircaseField({ pitchSource: 1, voiceLimit: 256, resolution: 112 });
  const performance = [];
  for (const brightness of [0, 1]) {
    const f = fixture({ mode: 2, mapping: 1, base: 73, gain: .75, depth: .175,
      brightness, hold: true, table: field.table });
    try { performance.push(f.render(.8)[0].subarray(14400)); } finally { f.close(); }
  }
  assert.ok(difference(performance[0], performance[1]) > energy(performance[0]) * .02,
    'Detail remains consequential at the default performance level after output shaping');
  assert.ok(roughness(performance[1]) / energy(performance[1])
    > roughness(performance[0]) / energy(performance[0]) * 1.1,
  'Detail still increases spectral activity at performance level');
});

test('live mode, shape, and frequency changes preserve time with bounded transitions', () => {
  const f = fixture({ hold: true });
  try {
    let last = f.render(.3)[0].at(-1); const clock = f.state()[0];
    for (const mode of [1, 3, 0, 2]) {
      f.controls({ mode, base: 173.7 });
      const table = geometry(); for (let frame = 0; frame < FRAMES; frame++) for (let index = 0; index < 512; index++) table[frame * STRIDE + index] *= -.65;
      f.install(table);
      const output = f.render(.15)[0];
      assert.ok(Math.abs(output[0] - last) < .06, `mode ${mode} begins without a hard output jump`);
      assert.ok(output.every(Number.isFinite)); assert.ok(peak(output) < 1);
      last = output.at(-1);
    }
    assert.ok(f.state()[0] > clock); assert.equal(f.state()[1], .2);
  } finally { f.close(); }
});

test('settled full-field replacement matches resampled replacement and preserves interrupted fades', () => {
  const single = branchGeometry().slice(0, STRIDE), full = new Float32Array(FRAMES * STRIDE);
  for (let frame = 0; frame < FRAMES; frame++) full.set(single, frame * STRIDE);
  const next = geometry(), interrupted = branchGeometry({ branches: [[1, .7, .1, .15], [1, .2, .8, .2]] });
  for (const mode of [0, 2]) {
    // These describe the same constant source field. After settling, the
    // 64-frame source takes the copy path; the one-frame source must resample.
    const a = fixture({ mode, mapping: 1, table: full, hold: true });
    const b = fixture({ mode, mapping: 1, table: single, hold: true });
    try {
      const before = a.render(.2), reference = b.render(.2);
      assert.deepEqual(before, reference);
      const clock = a.state()[0], depth = a.state()[1];
      a.install(next); b.install(next);
      assert.equal(a.state()[0], clock); assert.equal(a.state()[1], depth);
      const transition = a.render(.02), expected = b.render(.02);
      assert.deepEqual(transition, expected, 'copying a settled field must preserve its complete transition audio');
      assert.ok(Math.abs(transition[0][0] - before[0].at(-1)) < .08, 'replacement begins without an output discontinuity');
      assert.ok(a.state()[9] > 0 && a.state()[9] < 1, 'the next replacement interrupts an active fade');
      a.install(interrupted); b.install(interrupted);
      assert.deepEqual(a.render(.15), b.render(.15), 'interrupted transitions retain the existing mixed field');
      assert.deepEqual(a.state(), b.state()); assert.deepEqual(a.voices(), b.voices());
      assert.equal(a.state()[0], clock + 8160); assert.equal(a.state()[1], depth);
    } finally { a.close(); b.close(); }
  }
});

test('empty fields and malformed finite/NaN controls cannot invent or poison sound', () => {
  const empty = fixture({ table: null });
  try { assert.equal(peak(empty.render(.2)[0]), 0); } finally { empty.close(); }
  for (const rate of [44100, 48000]) {
    const f = fixture({ rate });
    try {
      f.render(.1); const hostile = geometry();
      for (let index = 0; index < hostile.length; index += 5) hostile[index] = index % 2 ? NaN : Infinity;
      f.install(hostile); f.controls({ mode: 99, base: NaN, brightness: Infinity, body: -100, gain: 100, seconds: 0 });
      f.seek(NaN, NaN); const output = f.render(.4);
      for (const channel of output) { assert.ok(channel.every(Number.isFinite)); assert.ok(peak(channel) < 1); }
      f.install(new Float32Array()); assert.equal(peak(f.render(.7)[0].subarray(-4096)), 0);
    } finally { f.close(); }
  }
});

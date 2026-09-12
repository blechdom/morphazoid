import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { RoachMidiPerformance, ROACH_MIDI_GESTURES, ROACH_MIDI_MAX_VOICES, normalizeRoachMidiMessage } from '../src/roach-synth-midi.js';
import { writeRoachPose, normalizeRoachMotion } from '../src/roach-synth-motion.js';

const event = (type, value = {}) => ({ type, sourceId: 'keys', channel: 0, ...value });
const on = (p, note, time = 0, value = {}) => p.handle(event('noteOn', { note, velocity: 100, ...value }), time);
const off = (p, note, time, value = {}) => p.handle(event('noteOff', { note, ...value }), time);
const cc = (p, controller, value, time = 0, scope = {}) => p.handle(event('controlChange', { controller, value, ...scope }), time);
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
function rig() {
  const names = ['body', 'abdomen', 'neck', 'head', 'antenna_left', 'antenna_right', 'wings'];
  for (const pair of ['front', 'middle', 'hind']) for (const side of ['left', 'right']) {
    for (const part of ['proximal', 'middle', 'distal']) names.push(`${pair}_${side}_${part}`);
    if (pair === 'hind') names.push(`${pair}_${side}_foot`);
  }
  names.push('wing_cover_left', 'wing_hind_left', 'wing_cover_right', 'wing_hind_right');
  return names.map((jointId, i) => ({ id: `bone-${i}`, jointId, name: jointId,
    restOffset: { x: 7, y: -4, z: 3 }, offset: { x: 0, y: 0, z: 0 },
    poseLimits: { x: [-35, 35], y: [-35, 35], z: [-55, 55] } }));
}
const settings = normalizeRoachMotion({ presetId: 'none', antennae: false });
function posed(p, joints, time, tempo = 120, intensity = 1) {
  const out = writeRoachPose(time, settings, joints, new Float32Array(joints.length * 3));
  return p.applyPose(out, joints, time, tempo, intensity);
}
function deltaIndices(before, after) { return Array.from(after, (v, i) => Math.abs(v - before[i]) > 1e-6 ? i : -1).filter(i => i >= 0); }

test('chromatic body map and normalized events bound the public contract', () => {
  assert.equal(ROACH_MIDI_GESTURES.length, 12);
  assert.deepEqual(ROACH_MIDI_GESTURES.map(g => g.groupId), ['legs','legs','covers','covers','hindwings','hindwings','thorax','abdomen','neck','head','antennae','antennae']);
  assert.ok(ROACH_MIDI_GESTURES.every(g => g.label && Object.isFrozen(g)));
  assert.deepEqual(normalizeRoachMidiMessage({ type: 'noteOn', note: 500, velocity: 0, channel: 20 }),
    { type: 'noteOff', sourceId: 'midi', channel: 15, note: 127, velocity: 0, kind: 'body' });
  assert.equal(normalizeRoachMidiMessage({ type: 'start' }), null);
  assert.equal(normalizeRoachMidiMessage({ type: 'pitchBend', normalized: Infinity }).normalized, 0);
});

test('attack, release and velocity are clock-based and final release returns exact silence', () => {
  const p = new RoachMidiPerformance(); on(p, 69, 10, { velocity: 64 });
  const reused = p.sample(10); assert.equal(reused.gates[6], 0); assert.equal(reused.serials[6], 1);
  near(p.sample(10.006).gates[6], .5); near(p.sample(10.02).velocities[6], 64 / 127);
  off(p, 69, 11); near(p.sample(11.08).gates[6], .5);
  assert.equal(p.sample(11.161).gates[6], 0); assert.equal(p.getState().activeCount, 0);
  assert.equal(p.hasActivity(11.161), false); assert.equal(p.sample(12), reused);
});

test('identical notes retain independent source/channel ownership and duplicate counts', () => {
  const p = new RoachMidiPerformance(); on(p, 69, 0); on(p, 69, .01); on(p, 69, .02, { sourceId: 'b', channel: 2 });
  off(p, 69, .1); assert.equal(p.getState(.1).heldCount, 2);
  off(p, 69, .11); assert.equal(p.getState(.11).heldCount, 1);
  off(p, 69, .12, { sourceId: 'b', channel: 0 }); assert.equal(p.getState(.12).heldCount, 1);
  off(p, 69, .13, { sourceId: 'b', channel: 2 }); assert.equal(p.getState(.3).activeCount, 0);
});

test('each audio group follows its latest held note and returns to an older held note', () => {
  const p = new RoachMidiPerformance(); on(p, 60); on(p, 61, .02); on(p, 69, .03);
  assert.equal(p.sample(.05).notes[0], 61); assert.equal(p.sample(.05).notes[6], 69);
  off(p, 61, .06); assert.equal(p.sample(.07).notes[0], 60);
  assert.equal(p.sample(.07).notes[6], 69);
});

test('sustain, CC123 and zero-velocity note offs follow the originating scope', () => {
  const p = new RoachMidiPerformance(); on(p, 69, 0, { channel: 2 }); on(p, 70, 0, { sourceId: 'b' });
  cc(p, 64, 127, .1, { channel: 2 }); cc(p, 123, 0, .2, { channel: 2 });
  assert.equal(p.getState(.25).heldCount, 2); assert.equal(p.getState(.25).notes.find(n => n.note === 69).sustained, true);
  p.handle(event('noteOn', { note: 70, velocity: 0, sourceId: 'b' }), .3);
  assert.equal(p.getState(.5).heldCount, 1);
  cc(p, 64, 0, .5, { channel: 2 }); assert.equal(p.getState(.67).activeCount, 0);
});

test('CC120 is immediate and channel-scoped; synthetic disconnect clears all source channels only', () => {
  const p = new RoachMidiPerformance(); on(p, 60); on(p, 61, 0, { channel: 2 }); on(p, 69, 0, { sourceId: 'b' });
  cc(p, 120, 0, .1); assert.equal(p.getState(.1).activeCount, 2);
  cc(p, 120, 0, .2, { synthetic: true, reason: 'input-disconnected' });
  assert.equal(p.getState(.2).activeCount, 1); assert.equal(p.getState(.2).notes[0].sourceId, 'b');
  p.reset(.3); assert.equal(p.getState(.3).activeCount, 0); assert.equal(p.sample(.3).serials[0], 2);
});

test('synthetic keyboard releases bypass sustain and duplicate counts', () => {
  const p = new RoachMidiPerformance(); on(p, 69); on(p, 69, .01); cc(p, 64, 127, .02);
  off(p, 69, .1, { synthetic: true, reason: 'keyboard-hidden' });
  assert.equal(p.getState(.27).activeCount, 0);
});

test('bend centers exactly and expression/pressure remain source/channel scoped', () => {
  const p = new RoachMidiPerformance(); on(p, 69); on(p, 70, 0, { channel: 1 });
  p.handle(event('pitchBend', { normalized: 1 }), .1);
  near(p.sample(.1).frequencies[6], 440 * 2 ** (2 / 12));
  near(p.sample(.1).frequencies[7], 440 * 2 ** (1 / 12));
  p.handle(event('pitchBend', { normalized: 0 }), .2); assert.equal(p.sample(.2).frequencies[6], 440);
  cc(p, 11, 0, .3); assert.equal(p.sample(.3).expressions[6], 0); assert.equal(p.sample(.3).expressions[7], 1);
  p.handle(event('channelPressure', { pressure: 64, channel: 1 }), .4); near(p.sample(.4).pressures[7], 64/127);
  p.handle(event('polyPressure', { pressure: 127, note: 70, channel: 1 }), .5); assert.equal(p.sample(.5).pressures[7], 1);
});

test('CC121 resets scoped expression, bend, pressure, sustain and assigned pose controls', () => {
  const p = new RoachMidiPerformance(); on(p, 69); cc(p, 64, 127); off(p, 69, .02);
  p.setControl('head', 'x', 1, .02, event('controlChange'));
  p.setControl('abdomen', 'y', -.5, .02, event('controlChange', { sourceId: 'b' }));
  cc(p, 11, 3, .05); p.handle(event('pitchBend', { normalized: -.7 }), .05);
  cc(p, 121, 0, .1); assert.equal(p.getState(.3).activeCount, 0);
  near(p.sample(.3).expressions[6], 1); assert.equal(p.getState(.3).controls[18], 0);
  assert.equal(p.getState(.3).controls[13], -.5);
  p.reset(.4); assert.ok(p.getState(.4).controls.every(v => v === 0));
});

test('profile macro precedence prevents overlapping CC11 and CC64 performance changes', () => {
  const p = new RoachMidiPerformance(); on(p, 69);
  assert.equal(cc(p, 11, 0, .1, { logical: { type: 'macro', index: 2 } }), false);
  assert.equal(p.sample(.1).expressions[6], 1);
  cc(p, 64, 127, .1, { logical: { type: 'macro', index: 3 } }); off(p, 69, .2);
  assert.equal(p.getState(.4).activeCount, 0);
});

test('notes address independent body sides and all three legs move with distinct phases', () => {
  const joints = rig(); const p = new RoachMidiPerformance(); const base = posed(p, joints, .2);
  on(p, 60); const left = posed(p, joints, .2); const changed = deltaIndices(base, left);
  assert.ok(changed.length >= 21); assert.ok(changed.every(i => /left/.test(joints[Math.floor(i / 3)].jointId)));
  const names = ['front_left_proximal', 'middle_left_proximal', 'hind_left_proximal'];
  assert.equal(new Set(names.map(name => left[joints.findIndex(j => j.jointId === name) * 3])).size, 3);
  on(p, 61); const both = posed(p, joints, .2);
  assert.ok(deltaIndices(left, both).every(i => /right/.test(joints[Math.floor(i / 3)].jointId)));
  off(p, 60, .3); off(p, 61, .3); assert.deepEqual(posed(p, joints, .5), base);
});

test('independent wing notes open their leaf only, without rotating the aggregate wing parent', () => {
  const joints = rig(); const p = new RoachMidiPerformance(); const base = posed(p, joints, .25);
  for (const [note, name] of [[62, 'wing_cover_left'], [63, 'wing_cover_right'], [64, 'wing_hind_left'], [65, 'wing_hind_right']]) {
    p.reset(); on(p, note); const after = posed(p, joints, .25);
    assert.ok(deltaIndices(base, after).every(i => joints[Math.floor(i / 3)].jointId === name));
    assert.notDeepEqual(after, base);
  }
});

test('expression zero settles note gestures while persistent CC pose remains independent', () => {
  const joints = rig(); const p = new RoachMidiPerformance(); const base = posed(p, joints, .3);
  on(p, 69); assert.notDeepEqual(posed(p, joints, .3), base);
  cc(p, 11, 0, .3); assert.deepEqual(posed(p, joints, .4), base);
  p.setControl('head', 'x', .5, .4); assert.notDeepEqual(posed(p, joints, .5), base);
});

test('CC ramps are continuous, clock-sampled and stop animating at their persistent destination', () => {
  const p = new RoachMidiPerformance(); p.setControl('head', 'x', 1, 10);
  assert.equal(p.getState(10).controls[18], 0); near(p.getState(10.0175).controls[18], .5);
  assert.equal(p.getState(10.04).controls[18], 1); assert.equal(p.hasActivity(10.04), false);
  assert.equal(p.sample(10.04).hasPose, true); assert.equal(p.sample(10.04).movement[6], 0);
  p.setControl('head', 'x', 0, 10.1); near(p.getState(10.145).controls[18], .5);
  assert.equal(p.getState(10.2).controls[18], 0); assert.equal(p.sample(10.2).hasPose, false);
});

test('static pose is deterministic across clocks and tempos and clamps all authored limits', () => {
  const joints = rig(); const a = new RoachMidiPerformance(); const b = new RoachMidiPerformance();
  for (let note = 60; note < 72; note += 1) { on(a, note); on(b, note); }
  for (let i = 0; i < 500; i += 1) a.sample(i / 1000);
  assert.deepEqual(posed(a, joints, .5), posed(b, joints, .5));
  assert.deepEqual(posed(a, joints, .5, 120), posed(b, joints, 1, 60));
  for (const group of ROACH_MIDI_GESTURES) for (const axis of ['x', 'y', 'z']) a.setControl(group.groupId, axis, 500, 1);
  const result = posed(a, joints, 1.5, 999, 100);
  result.forEach((value, i) => {
    const joint = joints[Math.floor(i / 3)]; const axis = ['x','y','z'][i % 3];
    assert.ok(Number.isFinite(value)); assert.ok(value >= joint.restOffset[axis] + joint.poseLimits[axis][0] && value <= joint.restOffset[axis] + joint.poseLimits[axis][1]);
  });
});

test('dance ownership and priority are independent of body notes and gates', () => {
  const joints = rig(); const p = new RoachMidiPerformance(); const base = posed(p, joints, .2);
  on(p, 48, 0, { kind: 'dance', danceIndex: 3 }); on(p, 49, .01, { kind: 'dance', danceIndex: 7, channel: 1 });
  assert.deepEqual(posed(p, joints, .2), base); assert.ok(p.sample(.2).gates.every(v => v === 0));
  assert.equal(p.getState(.2).latestDance.danceIndex, 7);
  on(p, 69, .21); assert.equal(p.getState(.22).latestDance.danceIndex, 7);
  off(p, 49, .23, { channel: 1 }); assert.equal(p.getState(.23).latestDance.danceIndex, 3);
  cc(p, 64, 127, .24); off(p, 48, .25); assert.equal(p.getState(.25).latestDance.danceIndex, 3);
  cc(p, 120, 0, .26); assert.equal(p.getState(.26).latestDance, null);
});

test('voice and controller scope floods remain bounded and all buffers are reused', () => {
  const p = new RoachMidiPerformance(); const out = p.sample(0); const buffers = Object.values(out).filter(v => ArrayBuffer.isView(v));
  for (let i = 0; i < 500; i += 1) on(p, i % 128, i / 1000, { sourceId: `input-${i}`, channel: i % 16 });
  assert.ok(p.getState(.6).activeCount <= ROACH_MIDI_MAX_VOICES); assert.equal(p.scopes.length, 64);
  for (let i = 0; i < 1000; i += 1) assert.equal(p.sample(.6 + i / 48000), out);
  assert.deepEqual(Object.values(out).filter(v => ArrayBuffer.isView(v)), buffers);
  p.reset(2); assert.ok(p.sample(2).gates.every(v => v === 0));
});

test('serialized state rebases pose envelopes and controller ramps without replaying attack serials', () => {
  const a = new RoachMidiPerformance(); const b = new RoachMidiPerformance(); const joints = rig();
  on(a, 69, 100); a.setControl('abdomen', 'z', .8, 100.01, event('controlChange'));
  on(a, 48, 100.005, { kind: 'dance', danceIndex: 5 });
  a.sample(100.02); const saved = JSON.parse(JSON.stringify(a.serialize()));
  assert.equal(b.restore(saved, { timeOffset: -100 }), true);
  const original = a.getState(100.03); const restored = b.getState(.03);
  original.controls.forEach((value, i) => near(value, restored.controls[i]));
  assert.deepEqual({ ...original, controls: [] }, { ...restored, controls: [] });
  assert.deepEqual(posed(a, joints, 100.25), posed(b, joints, .25));
  assert.deepEqual(Array.from(a.sample(100.25).serials), Array.from(b.sample(.25).serials));
  off(a, 69, 100.3); a.sample(100.4); b.restore(a.serialize(), { timeOffset: -100 });
  near(a.sample(100.42).gates[6], b.sample(.42).gates[6]);
  assert.equal(b.getState(.5).notes.some(n => n.note === 69), false);
});

test('a held key settles into a static pose without owning a moving clock', () => {
  const joints = rig(); const p = new RoachMidiPerformance(); const base = posed(p, joints, 0);
  for (let note = 60; note < 72; note += 1) {
    p.reset(0); on(p, note, 0, { velocity: 100 });
    assert.deepEqual(posed(p, joints, 0), base);
    const half = posed(p, joints, .006); const held = posed(p, joints, .02);
    assert.notDeepEqual(half, base); assert.notDeepEqual(held, half);
    assert.deepEqual(posed(p, joints, 500, 35), held);
    assert.deepEqual(posed(p, joints, 500.1, 240), held);
    assert.equal(p.hasActivity(500.1), false, 'held pose needs no animation frames');
    assert.equal(p.sample(500.1).hasPose, true, 'static deformation still applies');
    assert.ok(p.sample(500.1).movement.every(v => v === 0), 'held notes generate no continuing movement');
    off(p, note, 501); assert.equal(p.hasActivity(501.05), true);
    assert.deepEqual(posed(p, joints, 501.17), base);
  }
});

test('octaves give distinct static poses for the same body owner', () => {
  const joints = rig(); const p = new RoachMidiPerformance(); const base = posed(p, joints, 0);
  for (let note = 60; note < 72; note += 1) {
    const variants = [];
    for (const octave of [-1, 0, 1]) {
      p.reset(0); on(p, note + octave * 12); const out = posed(p, joints, .1);
      variants.push(JSON.stringify(out));
      assert.notDeepEqual(out, base);
    }
    assert.equal(new Set(variants).size, 3, ROACH_MIDI_GESTURES[note % 12].label);
  }
});

test('held static overlays add to independently advancing factory animation', () => {
  const joints = rig(); const p = new RoachMidiPerformance(); on(p, 69);
  const motion = normalizeRoachMotion({ presetId: 'side_walk', antennae: true, tempo: 120 });
  const firstBase = writeRoachPose(.1, motion, joints, new Float32Array(joints.length * 3));
  const nextBase = writeRoachPose(.7, motion, joints, new Float32Array(joints.length * 3));
  const first = p.applyPose(firstBase.slice(), joints, .1, 120);
  const next = p.applyPose(nextBase.slice(), joints, .7, 120);
  assert.notDeepEqual(first, next, 'the existing animation still advances');
  const head = joints.findIndex(j => j.jointId === 'head') * 3;
  for (let axis = 0; axis < 3; axis += 1) near(first[head + axis] - firstBase[head + axis], next[head + axis] - nextBase[head + axis], 2e-6);
  for (let i = 0; i < first.length; i += 1) if (i < head || i >= head + 3) {
    assert.equal(first[i], firstBase[i]); assert.equal(next[i], nextBase[i]);
  }
});

test('snapshot restore rejects incompatible versions and bounds hostile values', () => {
  const p = new RoachMidiPerformance(); assert.equal(p.restore({ version: 99 }), false);
  const s = p.serialize(); s.controls[0] = { target: Infinity, from: -500, duration: 0, started: NaN };
  assert.equal(p.restore(s), true); assert.ok(p.getState(1).controls.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
});

test('sample and pose hot paths contain no explicit allocating constructs', async () => {
  const source = await readFile(new URL('../src/roach-synth-midi.js', import.meta.url), 'utf8');
  const sample = source.slice(source.indexOf('  sample('), source.indexOf('  setJoints('));
  const pose = source.slice(source.indexOf('  applyPose('), source.indexOf('  getState('));
  assert.doesNotMatch((sample + pose).replace(/throw new RangeError\([^;]+;/g, ''), /\bnew\s|\.map\(|\.filter\(|\.slice\(|\.find\(|Array\.from|=>/);
});

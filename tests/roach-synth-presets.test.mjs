import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoachFullPresets, captureRoachPreset, randomizeRoachPreset } from '../src/instruments/roach-synth/roach-synth-presets.js';
import { validateFullPresetBank, presetStateKey } from '../src/site/header-presets.js';
import { normalizeRoachMotion, ROACH_ANIMATION_PRESETS, ROACH_STATIC_POSES,
  writeRoachPose } from '../src/instruments/roach-synth/roach-synth-motion.js';
import { normalizeRoachSound, ROACH_BODY_SOURCES } from '../src/instruments/roach-synth/roach-synth-dsp.js';

const joints = [{ id: 'head', jointId: 'head', name: 'Head', offset: { x: 0, y: 0, z: 0 },
  motion: { enabled: false, axis: 'x', amplitude: 12, speed: 1 } }];
const bank = createRoachFullPresets(joints);

test('all 48 complete scenes animate with antennae and exclude output controls', () => {
  validateFullPresetBank(bank);
  assert.equal(bank.length, 48);
  assert.deepEqual(bank.map(({ id }) => id), ROACH_ANIMATION_PRESETS.map(({ id }) => id));
  for (const { id, snapshot } of bank) {
    assert.equal(snapshot.playing, true); assert.equal(snapshot.motion.antennae, true);
    assert.equal(Object.hasOwn(snapshot.sound, 'level'), false);
    assert.equal(Object.hasOwn(snapshot.sound, 'voice'), false);
    assert.equal(Object.hasOwn(snapshot.motion, 'gaze'), false);
    assert.equal(snapshot.motionChoice, id); assert.equal(snapshot.motion.presetId, id);
    for (const key of ['audioEnabled', 'soundPlaying', 'time', 'audioTime', 'midiEnabled']) assert.equal(Object.hasOwn(snapshot, key), false);
    const early = writeRoachPose(.2, normalizeRoachMotion(snapshot.motion), joints, new Float32Array(3));
    const late = writeRoachPose(.7, normalizeRoachMotion(snapshot.motion), joints, new Float32Array(3));
    assert.notDeepEqual(early, late, `${id} animates on recall`);
  }
  for (const { id } of ROACH_STATIC_POSES) assert.ok(bank.some(item => item.id === `pose:${id}`));
});

test('capture preserves held/manual scenes while output, Audio, drone and clocks stay live', () => {
  const scene = bank[0].snapshot;
  const state = { ...scene, playing: false, motion: normalizeRoachMotion(scene.motion),
    sound: normalizeRoachSound(scene.sound), muted: new Set(['head']), solo: new Set() };
  const before = captureRoachPreset(state, scene.soundPreset);
  state.sound.level = .12; state.sound.voice = .33; state.motion.gaze.x = 9; state.time = 321;
  state.audioEnabled = true; state.soundPlaying = true; state.audioTime = 654; state.midiEnabled = true;
  assert.deepEqual(captureRoachPreset(state, scene.soundPreset), before);
  state.joints = [{ ...joints[0], offset: { x: 8, y: 0, z: 0 } }];
  assert.notDeepEqual(captureRoachPreset(state, scene.soundPreset), before);
});

test('complete scenes own view, side and phrase, while old snapshots receive safe view defaults', () => {
  assert.equal(bank.find(({ id }) => id === 'face_curious').snapshot.view, 'face');
  assert.equal(bank.find(({ id }) => id === 'top_wing_fan').snapshot.view, 'top');
  assert.equal(bank.find(({ id }) => id === 'bottom_shuffle').snapshot.view, 'bottom');
  assert.equal(bank.find(({ id }) => id === 'side_walk').snapshot.view, 'side');
  const scene = bank[0].snapshot;
  const state = { ...scene, motion: normalizeRoachMotion(scene.motion),
    sound: normalizeRoachSound(scene.sound), muted: new Set(), solo: new Set() };
  const before = captureRoachPreset(state, scene.soundPreset);
  for (const [key, value] of [['view', 'bottom'], ['side', 'right'], ['phrase', 'A crumb behind the cupboard.']]) {
    assert.notDeepEqual(captureRoachPreset({ ...state, [key]: value }, scene.soundPreset), before, key);
  }
  const fallback = captureRoachPreset({ ...state, view: 'unknown', side: 'unknown', phrase: undefined }, scene.soundPreset);
  assert.equal(fallback.view, 'side'); assert.equal(fallback.side, 'left');
  assert.equal(fallback.phrase, "hi, I'm a cockroach and I live in your house");
  assert.equal(captureRoachPreset({ ...state, phrase: 'x'.repeat(120) }, scene.soundPreset).phrase.length, 96);
});

test('capture isolates custom camera and nested scene edits from later live-state changes', () => {
  const scene = bank[0].snapshot;
  const camera = { target: [1, 2, 3], quaternion: [0, 0, 0, 1], distance: 2, view: 'side', side: 'right' };
  const state = { ...scene, camera, joints: structuredClone(joints), motion: normalizeRoachMotion(scene.motion),
    bodyMix: structuredClone(scene.bodyMix), sound: normalizeRoachSound(scene.sound), muted: new Set(), solo: new Set() };
  const captured = captureRoachPreset(state, scene.soundPreset);
  assert.deepEqual(captured.camera, camera);
  camera.target[0] = 99; camera.quaternion[0] = .7; camera.distance = 12;
  state.joints[0].offset.x = 45; state.bodyMix[0].level = .99;
  assert.deepEqual(captured.camera, { target: [1, 2, 3], quaternion: [0, 0, 0, 1], distance: 2, view: 'side', side: 'right' });
  assert.equal(captured.joints[0].offset.x, 0); assert.equal(captured.bodyMix[0].level, scene.bodyMix[0].level);
  captured.camera.target[1] = -99;
  assert.equal(state.camera.target[1], 2);
});

test('dice is pure, varies tones and motion, stays bounded and always animates', () => {
  const current = bank[0].snapshot, key = presetStateKey(current);
  let seed = 0xabc123;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const scenes = Array.from({ length: 20 }, () => randomizeRoachPreset(current, joints, random));
  assert.equal(presetStateKey(current), key);
  for (const scene of scenes) {
    assert.equal(scene.playing, true); assert.equal(scene.motion.antennae, true);
    assert.ok(scene.motion.tempo >= 35 && scene.motion.tempo <= 240);
    assert.ok(scene.motion.intensity >= .35 && scene.motion.intensity <= 1.5);
    assert.deepEqual(scene.sound, Object.fromEntries(Object.entries(normalizeRoachSound(scene.sound)).filter(([key]) => !['level', 'voice'].includes(key))));
    assert.ok(scene.bodyMix.every(row => ROACH_BODY_SOURCES.some(source => source.id === row.source) && row.level >= 0 && row.level <= 1));
    assert.equal(scene.soundPreset, 'custom');
    assert.ok(['side', 'top', 'bottom', 'face'].includes(scene.view));
    assert.ok(['left', 'right'].includes(scene.side));
    assert.equal(scene.camera, null);
    assert.ok(scene.phrase.length > 0 && scene.phrase.length <= 96);
    assert.equal(Object.hasOwn(scene.sound, 'level'), false); assert.equal(Object.hasOwn(scene.sound, 'voice'), false);
  }
  for (const key of Object.keys(current.sound)) assert.ok(new Set(scenes.map(scene => scene.sound[key])).size > 1, key);
  assert.ok(new Set(scenes.map(scene => scene.motion.tempo)).size > 1);
  assert.ok(new Set(scenes.map(scene => scene.motion.randomSeed)).size > 1);
  assert.deepEqual(new Set(scenes.map(scene => scene.view)), new Set(['side', 'top', 'bottom', 'face']));
  assert.deepEqual(new Set(scenes.map(scene => scene.side)), new Set(['left', 'right']));
  assert.ok(new Set(scenes.map(scene => scene.phrase)).size > 1);
});

test('full-scene dice is reproducible and drops inherited output levels and custom camera state', () => {
  const current = structuredClone(bank[0].snapshot);
  current.sound.level = .12; current.sound.voice = .33;
  current.camera = { target: [1, 2, 3], quaternion: [0, 0, 0, 1], distance: 2 };
  current.playing = false;
  const before = structuredClone(current);
  const seeded = initial => {
    let seed = initial;
    return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  };
  const first = randomizeRoachPreset(current, joints, seeded(0xabc123));
  assert.deepEqual(first, randomizeRoachPreset(current, joints, seeded(0xabc123)));
  assert.deepEqual(current, before);
  assert.equal(first.playing, true); assert.equal(first.camera, null);
  assert.equal(Object.hasOwn(first.sound, 'level'), false); assert.equal(Object.hasOwn(first.sound, 'voice'), false);
});

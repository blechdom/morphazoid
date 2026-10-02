import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoachFullPresets, captureRoachPreset, randomizeRoachPreset } from '../src/instruments/roach-synth/roach-synth-presets.js';
import { validateFullPresetBank, presetStateKey } from '../src/site/header-presets.js';
import { normalizeRoachMotion } from '../src/instruments/roach-synth/roach-synth-motion.js';
import { normalizeRoachSound, ROACH_BODY_SOURCES } from '../src/instruments/roach-synth/roach-synth-dsp.js';

const joints = [{ id: 'head', name: 'Head', offset: { x: 0, y: 0, z: 0 },
  motion: { enabled: false, axis: 'x', amplitude: 12, speed: 1 } }];
const bank = createRoachFullPresets(joints);

test('all 24 complete scenes animate with antennae and exclude output controls', () => {
  validateFullPresetBank(bank);
  assert.equal(bank.length, 24);
  for (const { snapshot } of bank) {
    assert.equal(snapshot.playing, true); assert.equal(snapshot.motion.antennae, true);
    assert.equal(Object.hasOwn(snapshot.sound, 'level'), false);
    assert.equal(Object.hasOwn(snapshot.sound, 'voice'), false);
    assert.equal(Object.hasOwn(snapshot.motion, 'gaze'), false);
  }
});

test('capture preserves held/manual scenes while output, view and clocks stay live', () => {
  const scene = bank[0].snapshot;
  const state = { ...scene, playing: false, motion: normalizeRoachMotion(scene.motion),
    sound: normalizeRoachSound(scene.sound), muted: new Set(['head']), solo: new Set() };
  const before = captureRoachPreset(state, scene.soundPreset);
  state.sound.level = .12; state.sound.voice = .33; state.motion.gaze.x = 9; state.time = 321;
  assert.deepEqual(captureRoachPreset(state, scene.soundPreset), before);
  state.joints = [{ ...joints[0], offset: { x: 8, y: 0, z: 0 } }];
  assert.notDeepEqual(captureRoachPreset(state, scene.soundPreset), before);
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
  }
  for (const key of Object.keys(current.sound)) assert.ok(new Set(scenes.map(scene => scene.sound[key])).size > 1, key);
  assert.ok(new Set(scenes.map(scene => scene.motion.tempo)).size > 1);
  assert.ok(new Set(scenes.map(scene => scene.motion.randomSeed)).size > 1);
});

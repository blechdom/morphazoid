import assert from "node:assert/strict";
import test from "node:test";
import { createPhysicsScene } from "../src/families/physics/physics-scenes.js";
import {
  PHYSICS_FULL_PRESETS, PHYSICS_PARAM_SPECS, PHYSICS_SCENE_IDS, PHYSICS_SOUND_SPEC,
  applyPhysicsPreset, capturePhysicsPreset, randomizePhysicsPreset, validatePhysicsPreset,
} from "../src/families/physics/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const SESSION_KEYS = ["audio", "playing", "level", "devices", "midi"];
const liveCapture = (id, scene, sound) => capturePhysicsPreset(id, scene.state, sound);
const sound = snapshot => ({ ...snapshot.sound });

const metricValues = scene => {
  const raw = scene.metrics();
  return Array.isArray(raw) ? raw.map(m => (Array.isArray(m) ? m[1] : m.value)) : Object.values(raw);
};

function settle(scene, seconds = 4) {
  for (let i = 0; i < seconds * 120; i++) scene.step(1 / 120);
  for (const voice of scene.voices()) for (const value of [voice.pitch01, voice.gain, voice.pan]) assert.ok(Number.isFinite(value));
  for (const value of metricValues(scene)) if (typeof value === "number") assert.ok(Number.isFinite(value));
  scene.consumeEvents();
}

test("every physics instrument has a complete spec matching its scene controls", () => {
  assert.equal(PHYSICS_SCENE_IDS.length, 9);
  for (const id of PHYSICS_SCENE_IDS) {
    const scene = createPhysicsScene(id);
    assert.deepEqual(Object.keys(PHYSICS_PARAM_SPECS[id]).sort(), Object.keys(scene.state).sort(), id);
    const controls = new Map(scene.controls.map(control => [control.key, control]));
    for (const [key, spec] of Object.entries(PHYSICS_PARAM_SPECS[id])) {
      const control = controls.get(key);
      if (!control) { assert.equal(`${id}.${key}`, "ricochet.sides"); continue; }
      if (spec.type === "range") {
        assert.deepEqual([spec.min, spec.max, spec.step, spec.def], [control.min, control.max, control.step, control.value], `${id}.${key}`);
        assert.ok(spec.dice[0] >= spec.min && spec.dice[1] <= spec.max && spec.dice[0] < spec.dice[1]);
      } else {
        assert.deepEqual(spec.values.map(String), control.options.map(option => String(option?.value ?? option)), `${id}.${key}`);
        assert.equal(String(spec.def), String(control.value));
      }
    }
  }
});

test("banks are valid, distinct, restore completely and exclude session state", () => {
  for (const id of PHYSICS_SCENE_IDS) {
    const bank = PHYSICS_FULL_PRESETS[id];
    validateFullPresetBank(bank);
    assert.ok(bank.length >= 12, id);
    assert.equal(new Set(bank.map(p => presetStateKey(p.snapshot))).size, bank.length, `${id} has duplicate scenes`);
    const scene = createPhysicsScene(id);
    assert.equal(presetStateKey(liveCapture(id, scene, sound(bank[0].snapshot))), presetStateKey(bank[0].snapshot), `${id} factory is the page default`);
    for (const preset of bank) {
      assert.equal(validatePhysicsPreset(id, preset.snapshot), preset.snapshot);
      assert.deepEqual(Object.keys(preset.snapshot).sort(), ["params", "sound"]);
      for (const key of SESSION_KEYS) assert.equal(key in preset.snapshot.sound || key in preset.snapshot.params, false);
      const returnedSound = applyPhysicsPreset(id, scene, preset.snapshot);
      assert.equal(presetStateKey({ params: liveCapture(id, scene, returnedSound).params, sound: returnedSound }), presetStateKey(preset.snapshot), `${id}/${preset.id}`);
      settle(scene, 2);
    }
  }
});

test("validation rejects malformed snapshots", () => {
  for (const id of PHYSICS_SCENE_IDS) {
    const good = structuredClone(PHYSICS_FULL_PRESETS[id][1].snapshot);
    assert.throws(() => validatePhysicsPreset(id, null), TypeError);
    assert.throws(() => validatePhysicsPreset(id, { params: {}, sound: good.sound }), TypeError);
    const key = Object.keys(good.params)[1];
    const broken = structuredClone(good);
    broken.params[key] = typeof broken.params[key] === "number" ? 1e9 : "nope";
    assert.throws(() => validatePhysicsPreset(id, broken), TypeError);
    const extra = structuredClone(good); extra.params.surprise = 1;
    assert.throws(() => validatePhysicsPreset(id, extra), TypeError);
    const bad = structuredClone(good); bad.sound.baseFrequency = Number.NaN;
    assert.throws(() => validatePhysicsPreset(id, bad), TypeError);
  }
});

test("dice is pure, reproducible, bounded, new, and varies every field", () => {
  for (const id of PHYSICS_SCENE_IDS) {
    const bank = PHYSICS_FULL_PRESETS[id];
    const initial = bank[0].snapshot, before = structuredClone(initial);
    assert.deepEqual(randomizePhysicsPreset(id, initial, seed(5)), randomizePhysicsPreset(id, bank[3].snapshot, seed(5)));
    assert.deepEqual(initial, before);
    const factory = new Set(bank.map(p => presetStateKey(p.snapshot)));
    const seen = { params: {}, sound: {} };
    for (const group of Object.keys(seen)) for (const key of Object.keys(initial[group])) seen[group][key] = new Set();
    const random = seed(77);
    for (let i = 0; i < 40; i++) {
      const result = randomizePhysicsPreset(id, initial, random);
      validatePhysicsPreset(id, result);
      assert.equal(factory.has(presetStateKey(result)), false);
      for (const group of Object.keys(seen)) for (const [key, value] of Object.entries(result[group])) seen[group][key].add(value);
    }
    for (const group of Object.keys(seen)) for (const [key, values] of Object.entries(seen[group])) {
      const spec = (group === "params" ? PHYSICS_PARAM_SPECS[id] : PHYSICS_SOUND_SPEC)[key];
      const expected = spec.type === "select" ? spec.values.length : Math.min(5, Math.floor((spec.max - spec.min) / spec.step));
      assert.ok(values.size >= Math.min(expected, spec.type === "select" ? expected : 5), `${id}.${key} stays frozen`);
    }
    for (const bound of [0, 0.999999, 0.5]) validatePhysicsPreset(id, randomizePhysicsPreset(id, initial, () => bound));
    assert.throws(() => randomizePhysicsPreset(id, initial, () => Number.NaN), TypeError);
  }
});

test("randomized scenes stay stable and keep moving when simulated", () => {
  for (const id of PHYSICS_SCENE_IDS) {
    const scene = createPhysicsScene(id);
    const random = seed(id.length * 131);
    for (let i = 0; i < 8; i++) {
      applyPhysicsPreset(id, scene, randomizePhysicsPreset(id, PHYSICS_FULL_PRESETS[id][0].snapshot, random));
      const signatures = new Set();
      for (let frame = 0; frame < 360; frame++) {
        scene.step(1 / 120);
        if (frame % 30 === 0) signatures.add(JSON.stringify([scene.voices(), metricValues(scene)]));
      }
      assert.ok(signatures.size > 1, `${id} #${i} is frozen`);
      settle(scene, 6);
    }
  }
});

test("every factory preset animates", () => {
  for (const id of PHYSICS_SCENE_IDS) {
    const scene = createPhysicsScene(id);
    for (const preset of PHYSICS_FULL_PRESETS[id]) {
      applyPhysicsPreset(id, scene, preset.snapshot);
      const signatures = new Set();
      for (let frame = 0; frame < 360; frame++) {
        scene.step(1 / 120);
        if (frame % 30 === 0) signatures.add(JSON.stringify([scene.voices(), metricValues(scene)]));
      }
      assert.ok(signatures.size > 1, `${preset.id} is frozen`);
    }
  }
});

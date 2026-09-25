import test from "node:test";
import assert from "node:assert/strict";
import {
  FINGERS, VOICE_SOURCES, HAND_DEFAULTS, HAND_LIMITS, HAND_POSES, HAND_MOTIONS, HAND_PRESETS,
  normalizeHandConfig, createHandPose, createHandVoices, evaluateHandPose, evaluateHandVoices,
  handMotionBeats, handMotionPeriod, randomizeHandConfig,
} from "../src/instruments/gesticulating-hand/hand-model.js";

const ORIGINAL_MOTIONS = ["source-grasp", "still", "wave", "beckon", "finger-roll", "pinch", "count", "flourish"];
const ADDED_MOTIONS = ["finger-fan", "ripple-open", "ripple-close", "finger-drumming", "spider-walk", "air-piano",
  "index-tap", "thumb-pulse", "thumb-orbit", "opposition-walk", "pinch-ladder", "circle-pinch", "claw-pulse",
  "squeeze-release", "wrist-circle", "wrist-nod", "wrist-turn", "figure-eight", "flourish-spiral", "flick",
  "finger-scissors", "double-beckon", "two-finger-walk", "ring-pulse"];
const JOINTS = ["mcp", "pip", "dip", "spread"], WRIST = ["flex", "side", "twist"];
const poseVector = pose => [...pose.fingers.flatMap(f => JOINTS.map(key => f[key])), ...WRIST.map(key => pose.wrist[key])];
function poseDistance(a, b) {
  const av = poseVector(a), bv = poseVector(b);
  return Math.max(...av.map((value, index) => Math.abs(value - bv[index])));
}
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

test("24 additional gestures have distinct full-pose trajectories and visible motion", () => {
  assert.deepEqual(HAND_MOTIONS.map(motion => motion.id), [...ORIGINAL_MOTIONS, ...ADDED_MOTIONS]);
  assert.equal(new Set(HAND_MOTIONS.map(motion => motion.label)).size, HAND_MOTIONS.length);
  const trajectories = [];
  for (const motion of HAND_MOTIONS) {
    const config = normalizeHandConfig({ motion: { id: motion.id, amount: 1 } });
    const period = handMotionPeriod(config.motion), pose = createHandPose(), trajectory = [];
    const first = poseVector(evaluateHandPose(config, 0));
    let travel = 0;
    for (let step = 0; step < 64; step++) {
      const vector = poseVector(evaluateHandPose(config, period * step / 64, pose));
      travel = Math.max(travel, ...vector.map((value, i) => Math.abs(value - first[i])));
      trajectory.push(...vector);
    }
    if (ADDED_MOTIONS.includes(motion.id)) assert.ok(travel > 15, `${motion.id} needs visible articulation`);
    for (const previous of trajectories) {
      const rms = Math.sqrt(trajectory.reduce((sum, value, i) => sum + (value - previous.values[i]) ** 2, 0) / trajectory.length);
      assert.ok(rms > 2, `${motion.id} duplicates the pose trajectory of ${previous.id}`);
    }
    trajectories.push({ id: motion.id, values: trajectory });
  }
});

test("new loops stay bounded over all base poses and reuse their output storage", () => {
  const out = createHandPose(), fingerStorage = out.fingers, firstFinger = out.fingers[0], wristStorage = out.wrist;
  for (const id of ADDED_MOTIONS) for (const { pose } of HAND_POSES) for (const speed of [.1, 4]) {
    const config = normalizeHandConfig({ pose, motion: { id, tempo: speed === .1 ? 20 : 220, speed, amount: 1 } });
    const period = handMotionPeriod(config.motion);
    for (let step = 0; step <= 64; step++) {
      assert.equal(evaluateHandPose(config, period * step / 64, out), out);
      assert.equal(out.fingers, fingerStorage); assert.equal(out.fingers[0], firstFinger); assert.equal(out.wrist, wristStorage);
      assert.equal(out.source, null);
      for (let i = 0; i < FINGERS.length; i++) for (const key of JOINTS) {
        const value = out.fingers[i][key], bounds = (i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger)[key];
        assert.ok(Number.isFinite(value) && value >= bounds[0] && value <= bounds[1], `${id} ${FINGERS[i]} ${key}`);
      }
      for (const key of WRIST) assert.ok(out.wrist[key] >= HAND_LIMITS.wrist[key][0] && out.wrist[key] <= HAND_LIMITS.wrist[key][1]);
    }
    const epsilon = period * 1e-7;
    assert.ok(poseDistance(evaluateHandPose(config, period - epsilon), evaluateHandPose(config, epsilon)) < .001, `${id} loop seam`);
    assert.ok(poseDistance(evaluateHandPose(config, period * .173), evaluateHandPose(config, period * 8.173)) < 1e-9, `${id} repeated cycle`);
    config.motion.amount = 0;
    const unchanged = evaluateHandPose(config, period * .413, out);
    assert.deepEqual({ fingers: unchanged.fingers, wrist: unchanged.wrist }, config.pose);
  }
});

test("speed scales every pose including the original source animation without changing its path", () => {
  for (const { id, beats } of HAND_MOTIONS) {
    const config = normalizeHandConfig({ motion: { id, tempo: 77, amount: .72 } });
    assert.equal(handMotionBeats(id), beats);
    for (const speed of [.1, .25, .5, 1, 1.7, 4]) {
      const fast = normalizeHandConfig({ ...config, motion: { ...config.motion, speed } });
      assert.ok(Math.abs(handMotionPeriod(fast.motion) * speed - handMotionPeriod(config.motion)) < 1e-12);
      for (const time of [.021, .173, .59, 2.871]) {
        const actual = evaluateHandPose(fast, time / speed), reference = evaluateHandPose(config, time);
        assert.ok(poseDistance(actual, reference) < 1e-8, `${id} at ${speed}×`);
        if (actual.source) assert.ok(Math.abs(actual.source.phase - reference.source.phase) < 1e-12);
      }
    }
  }
  assert.equal(handMotionBeats("obsolete"), 4);
  assert.equal(handMotionPeriod(null), handMotionPeriod());
  assert.equal(handMotionPeriod({ id: "wave", tempo: 60, speed: 2 }), 2);
  assert.equal(handMotionPeriod({ id: "wave", tempo: 1e9, speed: 1e9 }), 240 / (220 * 4));
});

test("audio uses the same expanded choreography and speed affects motion excitation", () => {
  const out = createHandVoices(), pose = createHandPose(), previous = createHandPose();
  for (const id of ADDED_MOTIONS) {
    const config = normalizeHandConfig({ motion: { id, tempo: 83, amount: .8, speed: 1.7 } });
    const time = handMotionPeriod(config.motion) * .271;
    assert.equal(evaluateHandVoices(config, time, out, pose, previous), out);
    assert.ok(poseDistance(pose, evaluateHandPose(config, time)) < 1e-12);
    const slower = normalizeHandConfig({ ...config, motion: { ...config.motion, speed: .5 } });
    const slow = evaluateHandVoices(slower, time * 1.7 / .5);
    for (let i = 0; i < 5; i++) for (const key of ["frequency", "brightness", "roughness", "pan", "level"]) {
      assert.ok(Math.abs(out[i][key] - slow[i][key]) < 1e-9, `${id} ${key} changes at the same visible pose`);
    }
  }
  const slow = normalizeHandConfig({ motion: { id: "ring-pulse", tempo: 60, amount: .3, speed: .5 } });
  const fast = normalizeHandConfig({ ...slow, motion: { ...slow.motion, speed: 2 } });
  const slowVoice = evaluateHandVoices(slow, 1)[3], fastVoice = evaluateHandVoices(fast, .25)[3];
  assert.equal(fastVoice.frequency, slowVoice.frequency);
  assert.ok(fastVoice.excitation > slowVoice.excitation * 3.5, "quicker movement must drive stronger excitation");
});

test("old v1 scenes retain normal speed and new source choices never create extra fingers", () => {
  const legacy = structuredClone(HAND_DEFAULTS); delete legacy.motion.speed;
  const normalized = normalizeHandConfig(legacy);
  assert.equal(normalized.version, 1); assert.equal(normalized.motion.speed, 1);
  assert.deepEqual(normalized, HAND_DEFAULTS);
  for (const speed of [NaN, Infinity, Symbol(), {}, "invalid", undefined]) {
    assert.equal(normalizeHandConfig({ motion: { speed } }).motion.speed, 1);
  }
  assert.equal(normalizeHandConfig({ motion: { speed: 0 } }).motion.speed, .1);
  assert.equal(normalizeHandConfig({ motion: { speed: 12 } }).motion.speed, 4);
  assert.equal(normalizeHandConfig({ motion: { speed: "1.25" } }).motion.speed, 1.25);
  assert.deepEqual(VOICE_SOURCES, ["glass", "reed", "wire", "pulse", "air", "bowed", "vowel", "metal"]);
  assert.equal(HAND_DEFAULTS.voices.length, 5);
  const config = normalizeHandConfig({ voices: VOICE_SOURCES.map(source => ({ source })) });
  assert.equal(config.voices.length, 5);
  for (const source of ["bowed", "vowel", "metal"]) {
    const scene = normalizeHandConfig({ voices: [{ source }] });
    assert.equal(scene.voices[0].source, source); assert.equal(evaluateHandVoices(scene, 0)[0].source, source);
    assert.ok(HAND_PRESETS.some(preset => preset.snapshot.voices.some(voice => voice.source === source)), `${source} has no complete preset`);
  }
});

test("complete presets and seeded randomization include speed, all movements, and all eight sources", () => {
  const observed = { speeds: new Set(), motions: new Set(), sources: new Set() }, rng = random(931);
  for (const { snapshot } of HAND_PRESETS) {
    assert.deepEqual(snapshot, normalizeHandConfig(snapshot));
    assert.ok(snapshot.motion.speed >= .1 && snapshot.motion.speed <= 4);
  }
  assert.ok(new Set(HAND_PRESETS.map(preset => preset.snapshot.motion.speed)).size >= 6);
  for (let i = 0; i < 600; i++) {
    const scene = randomizeHandConfig(HAND_DEFAULTS, rng);
    assert.deepEqual(scene, normalizeHandConfig(scene));
    assert.equal(scene.voices.length, 5);
    observed.speeds.add(scene.motion.speed); observed.motions.add(scene.motion.id);
    scene.voices.forEach(voice => observed.sources.add(voice.source));
  }
  assert.equal(observed.speeds.size, 600); assert.equal(observed.motions.size, HAND_MOTIONS.length);
  assert.equal(observed.sources.size, VOICE_SOURCES.length);
  assert.deepEqual(randomizeHandConfig(HAND_DEFAULTS, random(58)), randomizeHandConfig(HAND_DEFAULTS, random(58)));
});

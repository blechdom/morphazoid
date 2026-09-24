import test from "node:test";
import assert from "node:assert/strict";
import { FINGERS, HAND_LIMITS, HAND_DEFAULTS, HAND_POSES, HAND_MOTIONS, HAND_PRESETS,
  normalizeHandConfig, createHandPose, evaluateHandPose, evaluateHandVoices, randomizeHandConfig } from "../src/instruments/gesticulating-hand/hand-model.js";

import { SOURCE_GRASP_DURATION, SOURCE_BONE_NAMES, SOURCE_OPEN_ROTATIONS, SOURCE_OPEN_ANCESTOR_ROTATIONS, sampleSourceGrasp } from "../src/instruments/gesticulating-hand/hand-source-motion.js";

const clone = value => structuredClone(value);
const leaves = (value, prefix = "", result = {}) => {
  if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) leaves(entry, prefix ? `${prefix}.${key}` : key, result);
  else result[prefix] = value;
  return result;
};
const geometry = pose => ({ fingers: pose.fingers, wrist: pose.wrist });
const distance = (a, b) => Math.max(...Object.entries(leaves(geometry(a))).map(([key, value]) => Math.abs(value - leaves(geometry(b))[key])));
function rng(seed = 427) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

test("normalization produces independent finite bounded full scenes without runtime ownership", () => {
  for (const value of [null, undefined, 7, false, "bad", Symbol("bad"), { pose: null, motion: null, sound: null, voices: null }]) {
    assert.deepEqual(normalizeHandConfig(value), normalizeHandConfig());
  }
  const config = normalizeHandConfig({ pose: { fingers: [{ mcp: -999, pip: Infinity, dip: Symbol(), spread: 90 }], wrist: { flex: -999, side: 888, twist: NaN } },
    motion: { id: "unknown", amount: 500, tempo: "180" }, sound: { rootHz: {}, release: -1 }, voices: [{ source: "missing", level: 4, mute: "true", solo: true }],
    output: .1, playing: true, audio: true });
  assert.equal(config.pose.fingers[0].mcp, -12); assert.equal(config.pose.fingers[0].spread, 25);
  assert.equal(config.pose.wrist.flex, -55); assert.equal(config.pose.wrist.side, 30);
  assert.equal(config.motion.tempo, 180); assert.equal(config.motion.amount, 1);
  assert.equal(config.sound.release, .04); assert.equal(config.voices[0].level, 1); assert.equal(config.voices[0].mute, false);
  assert.ok(Object.values(leaves(config)).every(v => typeof v !== "number" || Number.isFinite(v)));
  assert.deepEqual(Object.keys(config), ["version", "pose", "motion", "sound", "voices"]);
  const fresh = normalizeHandConfig(HAND_DEFAULTS); fresh.pose.fingers[0].mcp = 999; fresh.voices[0].source = "other";
  assert.notEqual(HAND_DEFAULTS.pose.fingers[0].mcp, 999); assert.notEqual(HAND_DEFAULTS.voices[0].source, "other");
});

test("all choreographies repeat smoothly and stay within articulated joint ranges", () => {
  const fingerprints = new Set();
  for (const motion of HAND_MOTIONS) {
    const config = normalizeHandConfig({ motion: { id: motion.id, amount: 1, tempo: 97 } });
    const period = motion.beats * 60 / config.motion.tempo;
    const fingerprint = [];
    for (let i = 0; i <= 160; i++) {
      const pose = evaluateHandPose(config, i / 160 * period);
      pose.fingers.forEach((finger, index) => {
        for (const [key, value] of Object.entries(finger)) {
          const [min, max] = (index === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger)[key];
          assert.ok(value >= min && value <= max, `${motion.id} ${FINGERS[index]} ${key}`);
        }
      });
      for (const [key, value] of Object.entries(pose.wrist)) assert.ok(value >= HAND_LIMITS.wrist[key][0] && value <= HAND_LIMITS.wrist[key][1]);
      if (i % 20 === 0) fingerprint.push(pose);
    }
    assert.ok(distance(evaluateHandPose(config, .237), evaluateHandPose(config, period + .237)) < 1e-9);
    assert.ok(distance(evaluateHandPose(config, period - .0001), evaluateHandPose(config, .0001)) < .05, `${motion.id} loop seam`);
    fingerprints.add(JSON.stringify(fingerprint));
  }
  assert.equal(fingerprints.size, HAND_MOTIONS.length);
});

test("motion is additive, amount zero preserves base, tempo scales time, evaluation never mutates", () => {
  const config = normalizeHandConfig({ motion: { id: "wave", tempo: 60, amount: .5 } }), before = clone(config);
  const first = evaluateHandPose(config, .3);
  const faster = normalizeHandConfig({ ...config, motion: { ...config.motion, tempo: 120 } });
  assert.deepEqual(evaluateHandPose(faster, .15), first);
  assert.deepEqual(config, before); assert.deepEqual(evaluateHandPose(config, .3), first);
  config.pose.fingers[1].mcp += 7.125;
  assert.ok(Math.abs(evaluateHandPose(config, .3).fingers[1].mcp - first.fingers[1].mcp - 7.125) < 1e-9);
  config.motion.amount = 0; assert.deepEqual(geometry(evaluateHandPose(config, 999)), config.pose);
  config.motion.amount = 1; config.motion.id = "still"; assert.deepEqual(geometry(evaluateHandPose(config, 999)), config.pose);
});

test("each visible joint and wrist axis has a continuous sonic destination", () => {
  const config = normalizeHandConfig({ motion: { id: "still" } }), base = evaluateHandVoices(config, .3);
  for (let i = 0; i < 5; i++) {
    const bent = clone(config); bent.pose.fingers[i].mcp += .013;
    const moved = evaluateHandVoices(bent, .3);
    assert.ok(moved[i].frequency > base[i].frequency);
    assert.ok(moved[i].frequency < base[i].frequency * 1.001, "sub-degree input is not quantized to a scale");
    bent.pose.fingers[i].pip += 12; bent.pose.fingers[i].dip += 9; bent.pose.fingers[i].spread += 5;
    const tone = evaluateHandVoices(bent, .3)[i];
    assert.ok(tone.brightness > base[i].brightness); assert.ok(tone.roughness > base[i].roughness); assert.ok(tone.pan > base[i].pan);
  }
  for (const axis of ["flex", "twist"]) { const next = clone(config); next.pose.wrist[axis] += 10; assert.ok(evaluateHandVoices(next, 0)[2].frequency > base[2].frequency); }
  const side = clone(config); side.pose.wrist.side = 10;
  assert.ok(evaluateHandVoices(side, 0)[2].pan > base[2].pan); assert.ok(evaluateHandVoices(side, 0)[2].brightness > base[2].brightness);
  const moving = normalizeHandConfig({ motion: { id: "beckon", tempo: 60, amount: .6 } });
  const slow = evaluateHandVoices(moving, .2)[2].excitation;
  moving.motion.tempo = 120; assert.ok(evaluateHandVoices(moving, .1)[2].excitation > slow);
});

test("voice mutes and solos isolate stable finger identities", () => {
  const config = normalizeHandConfig(); config.voices[2].solo = true;
  assert.deepEqual(evaluateHandVoices(config, 0).map(v => v.level > 0), [false, false, true, false, false]);
  config.voices[4].solo = true; config.voices[2].mute = true;
  assert.deepEqual(evaluateHandVoices(config, 0).map(v => v.level > 0), [false, false, false, false, true]);
  config.voices[4].solo = false;
  assert.deepEqual(evaluateHandVoices(config, 0).map(v => v.level > 0), [true, true, false, true, true]);
});

test("complete presets cover different pose, motion, tone and envelope regions", () => {
  assert.ok(HAND_PRESETS.length >= 12); assert.equal(new Set(HAND_PRESETS.map(p => p.id)).size, HAND_PRESETS.length);
  assert.equal(new Set(HAND_PRESETS.map(p => JSON.stringify(p.snapshot))).size, HAND_PRESETS.length);
  assert.ok(HAND_POSES.length >= 7);
  for (const preset of HAND_PRESETS) {
    assert.deepEqual(preset.snapshot, normalizeHandConfig(preset.snapshot)); assert.equal(preset.snapshot.voices.length, 5);
    assert.ok(Object.isFrozen(preset.snapshot.pose.fingers[0])); assert.ok(preset.label.length > 2);
  }
  for (const key of ["rootHz", "brightness", "roughness", "space", "attack", "release"]) assert.ok(new Set(HAND_PRESETS.map(p => p.snapshot.sound[key])).size >= 8, key);
});

test("full randomization varies every musical field and remains deterministic and independent", () => {
  const random = rng(), observed = new Map(), original = normalizeHandConfig();
  for (let i = 0; i < 250; i++) {
    const config = randomizeHandConfig(original, random);
    assert.deepEqual(config, normalizeHandConfig(config)); assert.ok(config.voices.some(v => !v.mute));
    for (const [key, value] of Object.entries(leaves(config))) {
      if (!observed.has(key)) observed.set(key, new Set()); observed.get(key).add(value);
    }
  }
  for (const [key, values] of observed) if (key !== "version") assert.ok(values.size > 1, `${key} is accidentally frozen`);
  assert.deepEqual(original, normalizeHandConfig());
  assert.deepEqual(randomizeHandConfig(original, rng(25)), randomizeHandConfig(original, rng(25)));
  assert.deepEqual(randomizeHandConfig(original, () => NaN), normalizeHandConfig(randomizeHandConfig(original, () => NaN)));
});


test("original source motion preserves authored quaternion and angle curves with reusable storage", () => {
  const source = sampleSourceGrasp(0), rotation = source.rotations[0], finger = source.fingers[0];
  assert.equal(SOURCE_BONE_NAMES.length, 22); assert.equal(source.ancestorRotations.length, 1);
  assert.ok(SOURCE_GRASP_DURATION > 3 && SOURCE_GRASP_DURATION < 3.3);
  const start = sampleSourceGrasp(0);
  assert.deepEqual(start, sampleSourceGrasp(1));
  const quaternionError = (a, b) => 1 - Math.abs(a.reduce((sum, value, i) => sum + value * b[i], 0));
  for (let i = 0; i < 22; i++) assert.ok(Math.abs(quaternionError(start.rotations[i], SOURCE_OPEN_ROTATIONS[i])) < 1e-12);
  assert.ok(Math.abs(quaternionError(start.ancestorRotations[0], SOURCE_OPEN_ANCESTOR_ROTATIONS[0])) < 1e-12);
  for (let i = -200; i <= 200; i++) {
    assert.equal(sampleSourceGrasp(i / 127, source), source);
    assert.equal(source.rotations[0], rotation); assert.equal(source.fingers[0], finger);
    for (const q of [...source.rotations, ...source.ancestorRotations]) {
      assert.ok(q.every(Number.isFinite)); assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-6);
    }
    for (const f of source.fingers) assert.ok(Object.values(f).every(Number.isFinite));
  }
});

test("source grasp is additive and exactly reports its unclamped contribution for visual retargeting", () => {
  const config = normalizeHandConfig({ pose: HAND_POSES.find(p => p.id === "source-open").pose,
    motion: { id: "source-grasp", tempo: 60, amount: 1 } });
  assert.ok(Object.values(leaves(config.pose)).every(value => value === 0));
  const pose = createHandPose(); evaluateHandPose(config, .7, pose);
  const metadata = pose.source, offsets = metadata.offsets, firstOffset = offsets[0];
  for (let step = 0; step < 250; step++) {
    const time = step * 4 / 250, sampled = sampleSourceGrasp(time / 4);
    evaluateHandPose(config, time, pose);
    assert.equal(pose.source, metadata); assert.equal(pose.source.offsets, offsets); assert.equal(offsets[0], firstOffset);
    assert.ok(Math.abs(pose.source.phase - time / 4) < 1e-12); assert.equal(pose.source.amount, 1);
    for (let i = 0; i < 5; i++) for (const key of ["mcp", "pip", "dip", "spread"]) {
      assert.ok(Math.abs(offsets[i][key] - sampled.fingers[i][key]) < 1e-9);
      assert.ok(Math.abs(pose.fingers[i][key] - sampled.fingers[i][key]) < 1e-6, `source clipped: ${i} ${key}`);
    }
  }
  config.pose.fingers[1].mcp = 4; config.motion.amount = .7;
  evaluateHandPose(config, .7, pose);
  assert.ok(Math.abs(pose.fingers[1].mcp - pose.source.offsets[1].mcp - 4) < 1e-9);
  const held = structuredClone(pose); assert.deepEqual(evaluateHandPose(config, .7, pose), held);
  config.motion.id = "still"; evaluateHandPose(config, 4, pose); assert.equal(pose.source, null);
  assert.deepEqual(geometry(pose), config.pose);
  assert.equal(normalizeHandConfig({ ...config, pose }).pose.source, undefined, "live metadata is not serialized into a preset");
});

test("startup and original-grasp scenes use an unmodified open base with motion and sound separate", () => {
  assert.equal(HAND_DEFAULTS.motion.id, "source-grasp"); assert.equal(HAND_DEFAULTS.motion.amount, .85);
  assert.ok(Object.values(leaves(HAND_DEFAULTS.pose)).every(value => value === 0));
  const sourcePresets = HAND_PRESETS.filter(p => p.snapshot.motion.id === "source-grasp");
  assert.ok(sourcePresets.length >= 2);
  for (const { snapshot } of sourcePresets) {
    assert.equal(snapshot.motion.amount, 1); assert.ok(Object.values(leaves(snapshot.pose)).every(value => value === 0));
    assert.equal(snapshot.playing, undefined); assert.equal(snapshot.audio, undefined);
    const open = evaluateHandVoices(snapshot, 0), closed = evaluateHandVoices(snapshot, 1.3333333730697632 / SOURCE_GRASP_DURATION * 4 * 60 / snapshot.motion.tempo);
    assert.ok(closed.every((v, i) => v.frequency > open[i].frequency * 1.5));
  }
});

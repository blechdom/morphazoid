import test from "node:test";
import assert from "node:assert/strict";
import {
  FINGERS, VOICE_SOURCES, TREMOR_FINGERS, TREMOR_JOINTS, HAND_SKINS, HAND_LIGHTINGS, HAND_DEFAULTS, HAND_LIMITS, HAND_POSES, HAND_MOTIONS, HAND_PRESETS,
  normalizeHandConfig, createHandPose, createHandVoices, evaluateHandPose, evaluateHandVoices,
  handMotionBeats, handMotionPeriod, randomizeHandConfig,
} from "../src/instruments/gesticulating-hand/hand-model.js";

const ORIGINAL_MOTIONS = ["source-grasp", "still", "wave", "beckon", "finger-roll", "pinch", "count", "flourish"];
const ADDED_MOTIONS = ["finger-fan", "ripple-open", "ripple-close", "finger-drumming", "spider-walk", "air-piano",
  "index-tap", "thumb-pulse", "thumb-orbit", "opposition-walk", "pinch-ladder", "circle-pinch", "claw-pulse",
  "squeeze-release", "wrist-circle", "wrist-nod", "wrist-turn", "figure-eight", "flourish-spiral", "flick",
  "finger-scissors", "double-beckon", "two-finger-walk", "ring-pulse"];
const COMPLEX_MOTIONS = ["polyrhythmic-tangle", "finger-swarm", "frantic-orbit", "scatter"];
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
  assert.deepEqual(HAND_MOTIONS.map(motion => motion.id), [...ORIGINAL_MOTIONS, ...ADDED_MOTIONS, ...COMPLEX_MOTIONS]);
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
    const config = normalizeHandConfig({ pose, motion: { id, tempo: speed === .1 ? 20 : 1100, speed, amount: 1 } });
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
  assert.equal(handMotionPeriod({ id: "wave", tempo: 1e9, speed: 1e9 }), 240 / (1100 * 4));
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

test("1100 BPM gives every gesture five times the former maximum rate, including at 4× speed", () => {
  assert.deepEqual(HAND_LIMITS.motion.tempo, [20, 1100]);
  assert.equal(normalizeHandConfig({ motion: { tempo: 5000 } }).motion.tempo, 1100);
  assert.equal(normalizeHandConfig({ motion: { tempo: "1099" } }).motion.tempo, 1099);
  for (const { id } of HAND_MOTIONS) for (const speed of [.1, 1, 4]) {
    const former = normalizeHandConfig({ motion: { id, tempo: 220, speed, amount: .83 } });
    const faster = normalizeHandConfig({ ...former, motion: { ...former.motion, tempo: 1100 } });
    const period = handMotionPeriod(former.motion);
    assert.ok(Math.abs(handMotionPeriod(faster.motion) * 5 - period) < 1e-12);
    for (const phase of [.031, .177, .419, .783, .997]) {
      const before = evaluateHandPose(former, period * phase), after = evaluateHandPose(faster, period * phase / 5);
      assert.ok(poseDistance(before, after) < 1e-8, `${id} at ${speed}×`);
      if (before.source) assert.ok(Math.abs(before.source.phase - after.source.phase) < 1e-12);
    }
  }
});

test("complex choreographies have independently articulated fingers and counter-moving joints", () => {
  for (const id of COMPLEX_MOTIONS) {
    const config = normalizeHandConfig({ motion: { id, tempo: 1100, speed: 4, amount: 1 } });
    const period = handMotionPeriod(config.motion), samples = [];
    for (let step = 0; step <= 256; step++) samples.push(evaluateHandPose(config, period * step / 256));
    for (let i = 0; i < 5; i++) {
      for (const joint of JOINTS) {
        const track = samples.map(pose => pose.fingers[i][joint]);
        assert.ok(Math.max(...track) - Math.min(...track) > 20, `${id}: ${FINGERS[i]} ${joint} must articulate`);
      }
      let reversals = 0, opposedJoints = 0, opposedNeighbour = 0;
      for (let step = 2; step < samples.length; step++) {
        const earlier = samples[step - 2], previous = samples[step - 1], current = samples[step];
        const velocity = current.fingers[i].mcp - previous.fingers[i].mcp;
        if (velocity * (previous.fingers[i].mcp - earlier.fingers[i].mcp) < 0) reversals++;
        if (velocity * (current.fingers[i].pip - previous.fingers[i].pip) < 0) opposedJoints++;
        const neighbour = (i + 1) % 5;
        if (velocity * (current.fingers[neighbour].mcp - previous.fingers[neighbour].mcp) < 0) opposedNeighbour++;
      }
      assert.ok(reversals >= 4, `${id}: ${FINGERS[i]} needs more than a simple open/close`);
      assert.ok(opposedJoints > 50, `${id}: knuckle and middle should counter-move`);
      assert.ok(opposedNeighbour > 50, `${id}: fingers should counter-move`);
    }
    for (const axis of WRIST) {
      const track = samples.map(pose => pose.wrist[axis]);
      assert.ok(Math.max(...track) - Math.min(...track) > 40, `${id}: wrist ${axis}`);
    }
    for (const { pose } of HAND_POSES) {
      const bounded = normalizeHandConfig({ ...config, pose }), out = createHandPose();
      for (let step = 0; step <= 128; step++) {
        evaluateHandPose(bounded, period * step / 128, out);
        for (let i = 0; i < 5; i++) for (const key of JOINTS) {
          const value = out.fingers[i][key], limits = (i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger)[key];
          assert.ok(Number.isFinite(value) && value >= limits[0] && value <= limits[1], `${id}: bounded ${key}`);
        }
        for (const key of WRIST) assert.ok(out.wrist[key] >= HAND_LIMITS.wrist[key][0] && out.wrist[key] <= HAND_LIMITS.wrist[key][1]);
      }
      assert.ok(poseDistance(evaluateHandPose(bounded, period * (1 - 1e-7)), evaluateHandPose(bounded, period * 1e-7)) < .001, `${id}: seam at maximum rate`);
    }
    const first = evaluateHandVoices(config, period * .17), next = evaluateHandVoices(config, period * .31);
    assert.ok(first.some((voice, i) => Math.abs(voice.frequency - next[i].frequency) > 10), `${id}: motion must drive pitch`);
    assert.ok(first.every(voice => Number.isFinite(voice.excitation) && voice.excitation >= 0 && voice.excitation <= 1));
  }
});

test("the faster range preserves old preset timings and normal startup", () => {
  assert.deepEqual(HAND_DEFAULTS.motion, { id: "source-grasp", tempo: 72, amount: .85, speed: 1 });
  assert.equal(handMotionPeriod(HAND_DEFAULTS.motion), 240 / 72);
  const previousTimings = [
    ["glass-wave", 67, 1], ["reed-beckon", 79, 1], ["wire-roll", 104, 1], ["pinch-sparks", 92, 1],
    ["counting-air", 131, 1], ["flourish-copper", 61, 1], ["low-claw", 38, 1], ["hushed-palm", 29, 1],
    ["point-transmission", 157, 1], ["slow-unfurl", 49, 1], ["closed-bell", 88, 1], ["little-machinery", 186, 1],
    ["original-grasp", 75, 1], ["breathing-hand", 34, 1], ["bowed-spiral", 74, .65],
    ["vowel-opposition", 89, 1.1], ["metal-drumming", 122, 1.4], ["bowed-eight", 51, .45],
    ["vowel-fan", 62, .8], ["metal-walk", 111, 1.7],
  ];
  assert.deepEqual(HAND_PRESETS.slice(0, 20).map(({ id, snapshot }) => [id, snapshot.motion.tempo, snapshot.motion.speed]), previousTimings);
  assert.deepEqual(HAND_PRESETS.slice(20, 24).map(({ snapshot }) => snapshot.motion.id), COMPLEX_MOTIONS);
  assert.ok(HAND_PRESETS.slice(20, 24).every(({ snapshot }) => snapshot.motion.tempo > 220));
  const values = Array.from({ length: 300 }, (_, i) => randomizeHandConfig(HAND_DEFAULTS, random(i + 1)).motion.tempo);
  assert.ok(values.some(value => value > 900)); assert.ok(values.every(value => value >= 20 && value <= 1100));
});

test("v1 camera migration restores palm framing and bounds independently owned preset views", () => {
  assert.deepEqual(HAND_DEFAULTS.view, { yaw: .12, pitch: .035, zoom: 1 });
  const legacy = structuredClone(HAND_DEFAULTS); delete legacy.view; delete legacy.motion.speed;
  assert.deepEqual(normalizeHandConfig(legacy), HAND_DEFAULTS);
  for (const view of [undefined, null, false, "bad", 1, Symbol()]) {
    assert.deepEqual(normalizeHandConfig({ view }).view, HAND_DEFAULTS.view);
  }
  assert.deepEqual(normalizeHandConfig({ view: { yaw: 90, pitch: -90, zoom: "1.5" } }).view,
    { yaw: Math.PI, pitch: -1.15, zoom: 1.5 });
  assert.deepEqual(normalizeHandConfig({ view: { yaw: -90, pitch: 90, zoom: .01 } }).view,
    { yaw: -Math.PI, pitch: 1.15, zoom: .62 });
  assert.equal(normalizeHandConfig({ view: { zoom: 99 } }).view.zoom, 2);
  assert.deepEqual(normalizeHandConfig({ view: { yaw: NaN, pitch: Infinity, zoom: Symbol() } }).view, HAND_DEFAULTS.view);
  const original = normalizeHandConfig(), copy = normalizeHandConfig(original);
  copy.view.yaw = 1.9; assert.equal(original.view.yaw, .12); assert.equal(HAND_DEFAULTS.view.yaw, .12);
  for (const { snapshot } of HAND_PRESETS) {
    assert.ok(Object.isFrozen(snapshot.view));
    assert.deepEqual(snapshot.view, normalizeHandConfig(snapshot).view);
  }
  for (const key of ["yaw", "pitch", "zoom"]) assert.ok(new Set(HAND_PRESETS.map(({ snapshot }) => snapshot.view[key])).size >= 6, `${key} should distinguish full scene framing`);
  const alternate = normalizeHandConfig({ ...original, view: { yaw: 2.2, pitch: .5, zoom: 1.7 } });
  assert.deepEqual(evaluateHandPose(alternate, .37), evaluateHandPose(original, .37));
  assert.deepEqual(evaluateHandVoices(alternate, .37), evaluateHandVoices(original, .37), "camera recall must not change joint-to-sound mapping");
});

test("v1 migration restores zero tremor and normalizes hostile appearance values", () => {
  const legacy = structuredClone(HAND_DEFAULTS); delete legacy.view; delete legacy.motion.speed; delete legacy.tremor; delete legacy.appearance;
  assert.deepEqual(normalizeHandConfig(legacy), HAND_DEFAULTS);
  assert.deepEqual(HAND_DEFAULTS.tremor, { finger: "all", joint: "tip", amount: 0, rate: 8 });
  assert.deepEqual(HAND_DEFAULTS.appearance, { skin: "natural", lighting: "studio" });
  for (const value of [null, undefined, Symbol(), "bad", 72, false]) {
    const normalized = normalizeHandConfig({ tremor: value, appearance: value });
    assert.deepEqual(normalized.tremor, HAND_DEFAULTS.tremor); assert.deepEqual(normalized.appearance, HAND_DEFAULTS.appearance);
  }
  const invalid = normalizeHandConfig({ tremor: { finger: "unknown", joint: {}, amount: Infinity, rate: Symbol() }, appearance: { skin: "red", lighting: [] } });
  assert.deepEqual(invalid.tremor, HAND_DEFAULTS.tremor); assert.deepEqual(invalid.appearance, HAND_DEFAULTS.appearance);
  assert.deepEqual(normalizeHandConfig({ tremor: { amount: 300, rate: "500" } }).tremor, { ...HAND_DEFAULTS.tremor, amount: 15, rate: 40 });
  assert.deepEqual(normalizeHandConfig({ tremor: { amount: -8, rate: -4 } }).tremor, { ...HAND_DEFAULTS.tremor, amount: 0, rate: .5 });
  for (const finger of TREMOR_FINGERS) for (const joint of TREMOR_JOINTS) {
    const config = normalizeHandConfig({ tremor: { finger, joint, amount: 4.25, rate: 13.75 } });
    assert.deepEqual(config.tremor, { finger, joint, amount: 4.25, rate: 13.75 });
  }
  for (const skin of HAND_SKINS) for (const lighting of HAND_LIGHTINGS) assert.deepEqual(normalizeHandConfig({ appearance: { skin, lighting } }).appearance, { skin, lighting });
});

test("tremor moves only its selected finger parts and alternating fingers oppose each other", () => {
  const base = normalizeHandConfig({ pose: HAND_POSES.find(pose => pose.id === "relaxed").pose, motion: { id: "still" } });
  const expected = evaluateHandPose(base, 0), time = 1 / (4 * 8);
  for (const [joint, active] of [["tip", ["dip"]], ["middle", ["pip"]], ["knuckle", ["mcp"]], ["whole", ["mcp", "pip", "dip"]]]) {
    for (let index = 0; index < 5; index++) {
      const config = normalizeHandConfig({ ...base, tremor: { finger: FINGERS[index], joint, amount: 4, rate: 8 } });
      const pose = evaluateHandPose(config, time);
      for (let i = 0; i < 5; i++) for (const key of JOINTS) {
        assert.ok(Math.abs(pose.fingers[i][key] - expected.fingers[i][key] - (i === index && active.includes(key) ? 4 : 0)) < 1e-10, `${FINGERS[index]} ${joint}: ${FINGERS[i]} ${key}`);
      }
      assert.deepEqual(pose.wrist, expected.wrist);
      const retained = structuredClone(pose); assert.deepEqual(evaluateHandPose(config, time, pose), retained, "retaining the motion time freezes tremor");
    }
  }
  const alternating = evaluateHandPose(normalizeHandConfig({ ...base, tremor: { finger: "alternating", joint: "middle", amount: 4, rate: 8 } }), time);
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(alternating.fingers[i].pip - expected.fingers[i].pip - (i % 2 ? -4 : 4)) < 1e-10);
  const wrist = evaluateHandPose(normalizeHandConfig({ ...base, tremor: { finger: "all", joint: "wrist", amount: 4, rate: 8 } }), time);
  assert.deepEqual(wrist.fingers, expected.fingers);
  assert.ok(WRIST.every(key => Math.abs(wrist.wrist[key] - expected.wrist[key]) > .1));
});

test("tip and middle tremor produce vibrato from the actual visible deflection", () => {
  const base = normalizeHandConfig({ pose: HAND_POSES.find(pose => pose.id === "relaxed").pose, motion: { id: "still" } });
  for (const joint of ["tip", "middle"]) {
    const config = normalizeHandConfig({ ...base, tremor: { finger: "index", joint, amount: 5, rate: 8 } });
    const still = evaluateHandVoices(base, 0), up = evaluateHandVoices(config, 1 / 32), down = evaluateHandVoices(config, 3 / 32);
    assert.ok(up[1].frequency > still[1].frequency * 1.01); assert.ok(down[1].frequency < still[1].frequency / 1.01);
    for (const i of [0, 2, 3, 4]) assert.deepEqual(up[i], still[i], `${joint}: unselected finger voice is unchanged`);
    const geometric = evaluateHandPose(config, 1 / 32);
    assert.equal(geometric.fingers[1].mcp, base.pose.fingers[1].mcp, "vibrato follows the selected distal joint without moving the knuckle");
    config.tremor.amount = 0;
    assert.deepEqual(evaluateHandVoices(config, 1 / 32), still, "zero tremor restores original timbre and pitch");
  }
  for (const [joint, key, coefficient] of [["tip", "dip", .0028], ["middle", "pip", .0035]]) {
    const config = normalizeHandConfig({ ...base, tremor: { finger: "index", joint, amount: 15, rate: 8 } });
    config.pose.fingers[1][key] = HAND_LIMITS.finger[key][1] - 1;
    const zero = normalizeHandConfig({ ...config, tremor: { ...config.tremor, amount: 0 } });
    const ratio = evaluateHandVoices(config, 1 / 32)[1].frequency / evaluateHandVoices(zero, 1 / 32)[1].frequency;
    assert.ok(Math.abs(ratio - Math.exp(coefficient)) < 1e-12, "joint clipping also limits vibrato to the one visible degree");
  }
});

test("40 Hz tremor remains deterministic and bounded with the fastest complex motion", () => {
  const out = createHandPose(), fingers = out.fingers, wrist = out.wrist;
  for (const id of COMPLEX_MOTIONS) for (const joint of TREMOR_JOINTS) {
    const config = normalizeHandConfig({ motion: { id, tempo: 1100, speed: 4, amount: 1 }, tremor: { finger: "alternating", joint, amount: 15, rate: 40 } });
    for (let step = 0; step <= 128; step++) {
      evaluateHandPose(config, step / 503, out); assert.equal(out.fingers, fingers); assert.equal(out.wrist, wrist);
      for (let i = 0; i < 5; i++) for (const key of JOINTS) {
        const value = out.fingers[i][key], limits = (i === 0 ? HAND_LIMITS.thumb : HAND_LIMITS.finger)[key];
        assert.ok(Number.isFinite(value) && value >= limits[0] && value <= limits[1]);
      }
      for (const key of WRIST) assert.ok(out.wrist[key] >= HAND_LIMITS.wrist[key][0] && out.wrist[key] <= HAND_LIMITS.wrist[key][1]);
    }
    assert.deepEqual(evaluateHandVoices(config, .317), evaluateHandVoices(config, .317));
  }
  const slow = normalizeHandConfig({ motion: { id: "still" }, tremor: { finger: "all", joint: "whole", amount: 3, rate: 2 } });
  const fast = normalizeHandConfig({ ...slow, tremor: { ...slow.tremor, rate: 40 } });
  assert.ok(poseDistance(evaluateHandPose(slow, .073), evaluateHandPose(fast, .073 / 20)) < 1e-10, "the tremor rate is expressed in Hz");
});

test("complete presets and random scenes recall tremor, skin, lighting, camera, tempo and speed", () => {
  for (const { snapshot } of HAND_PRESETS) {
    assert.ok(Object.isFrozen(snapshot.tremor) && Object.isFrozen(snapshot.appearance));
    assert.deepEqual(snapshot, normalizeHandConfig(snapshot));
  }
  assert.equal(new Set(HAND_PRESETS.map(({ snapshot }) => snapshot.appearance.skin)).size, HAND_SKINS.length);
  assert.equal(new Set(HAND_PRESETS.map(({ snapshot }) => snapshot.appearance.lighting)).size, HAND_LIGHTINGS.length);
  assert.equal(new Set(HAND_PRESETS.filter(({ snapshot }) => snapshot.tremor.amount > 0).map(({ snapshot }) => snapshot.tremor.joint)).size, TREMOR_JOINTS.length);
  const rng = random(174), variants = { finger: new Set(), joint: new Set(), amount: new Set(), rate: new Set(), skin: new Set(), lighting: new Set() };
  for (let index = 0; index < 600; index++) {
    const config = randomizeHandConfig(HAND_DEFAULTS, rng);
    for (const key of ["finger", "joint", "amount", "rate"]) variants[key].add(config.tremor[key]);
    variants.skin.add(config.appearance.skin); variants.lighting.add(config.appearance.lighting);
    assert.deepEqual(config, normalizeHandConfig(config));
  }
  assert.equal(variants.finger.size, TREMOR_FINGERS.length); assert.equal(variants.joint.size, TREMOR_JOINTS.length);
  assert.equal(variants.skin.size, HAND_SKINS.length); assert.equal(variants.lighting.size, HAND_LIGHTINGS.length);
  assert.equal(variants.amount.size, 600); assert.equal(variants.rate.size, 600);
});

test("rebasing choreography from .2 to .05 retains tremor phase through an independent clock", () => {
  const config = normalizeHandConfig({ pose: HAND_POSES.find(pose => pose.id === "relaxed").pose,
    motion: { id: "wave", tempo: 60, speed: 1, amount: .5 }, tremor: { finger: "all", joint: "tip", amount: 12.5, rate: 3.7 } });
  const faster = normalizeHandConfig({ ...config, motion: { ...config.motion, speed: 4 } });
  const before = evaluateHandPose(config, .2), after = evaluateHandPose(faster, .05, createHandPose(), .05 + .15);
  assert.ok(poseDistance(before, after) < 1e-10);
  assert.ok(poseDistance(before, evaluateHandPose(faster, .05)) > 10, "this fixture detects the old tremor jump");
  const oldVoices = evaluateHandVoices(config, .2), newVoices = evaluateHandVoices(faster, .05, createHandVoices(), createHandPose(), createHandPose(), .2);
  for (let i = 0; i < 5; i++) for (const key of ["frequency", "brightness", "roughness", "pan", "level"]) assert.ok(Math.abs(oldVoices[i][key] - newVoices[i][key]) < 1e-9);
  assert.equal(normalizeHandConfig({ ...config, tremorOffset: .15, tremorTime: .2 }).tremorOffset, undefined);
  assert.equal(normalizeHandConfig({ ...config, tremorOffset: .15, tremorTime: .2 }).tremorTime, undefined);
});

test("tremor velocity uses its own previous time while rate edits can retain its visible phase", () => {
  const config = normalizeHandConfig({ pose: HAND_POSES.find(pose => pose.id === "relaxed").pose,
    motion: { id: "still" }, tremor: { finger: "all", joint: "whole", amount: 12.5, rate: 3.7 } });
  const before = evaluateHandVoices(config, .2), rebased = evaluateHandVoices(config, .05, createHandVoices(), createHandPose(), createHandPose(), .2);
  assert.deepEqual(rebased, before, "excitation uses tremorTime-.01 instead of the rebased choreography time");
  const faster = normalizeHandConfig({ ...config, tremor: { ...config.tremor, rate: 17.1 } });
  assert.ok(poseDistance(evaluateHandPose(config, .2), evaluateHandPose(faster, .2, createHandPose(), .2 * 3.7 / 17.1)) < 1e-10);
  assert.ok(poseDistance(evaluateHandPose(config, 0, createHandPose(), -.123), evaluateHandPose(config, 0, createHandPose(), -.123 + 1 / 3.7)) < 1e-10,
    "signed tremor times keep the oscillator continuous across zero");
});

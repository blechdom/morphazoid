import test from "node:test";
import assert from "node:assert/strict";
import { HandDSP } from "../src/instruments/gesticulating-hand/hand-dsp.js";
import { FINGERS, GESTICULES_FORMS, FOOT_LIMITS, HAND_DEFAULTS, HAND_POSES, HAND_MOTIONS, HAND_PRESETS, VOICE_SOURCES,
  handDigitLabels, handDigitLimits, handWristLimits, handJointKeys, handJointLabel, handMotionLabel, handPoseLabel, handPoseForForm,
  normalizeHandConfig, createHandPose, evaluateHandPose, evaluateHandVoices, handMotionPeriod, randomizeHandConfig } from "../src/instruments/gesticulating-hand/hand-model.js";
const copy = value => structuredClone(value);
const geometry = pose => ({ fingers: pose.fingers, wrist: pose.wrist, ...(pose.foot ? { foot: pose.foot } : {}) });
const vector = pose => [...pose.fingers.flatMap(f => [f.mcp, f.pip, f.dip, f.spread]), ...Object.values(pose.wrist), ...Object.values(pose.foot ?? {})];
const distance = (a, b) => Math.max(...vector(a).map((value, i) => Math.abs(value - vector(b)[i])));
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const difference = (a, b) => rms(a.map((value, i) => value - b[i]));
function rng(seed = 79) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function checkFoot(pose) {
  assert.equal(pose.fingers.length, 5); assert.equal(pose.fingers[0].pip, 0);
  for (let i = 0; i < 5; i++) for (const [key, bounds] of Object.entries(handDigitLimits("foot", i))) {
    const value = pose.fingers[i][key]; assert.ok(Number.isFinite(value) && value >= bounds[0] && value <= bounds[1], `toe ${i} ${key}: ${value}`);
  }
  for (const [key, bounds] of Object.entries(FOOT_LIMITS.ankle)) assert.ok(Number.isFinite(pose.wrist[key]) && pose.wrist[key] >= bounds[0] && pose.wrist[key] <= bounds[1]);
  for (const [key, bounds] of Object.entries(FOOT_LIMITS.shape)) assert.ok(Number.isFinite(pose.foot[key]) && pose.foot[key] >= bounds[0] && pose.foot[key] <= bounds[1]);
}
function scene(source = "wire") {
  return normalizeHandConfig({ form: "foot", pose: handPoseForForm("relaxed", "foot"), motion: { id: "still" },
    sound: { space: 0, attack: .012, release: .12 }, voices: Array.from({ length: 5 }, () => ({ source, level: .7 })) });
}
function engine(config = scene(), rate = 24000) {
  const dsp = new HandDSP(rate); dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true); return dsp;
}
function render(dsp, seconds = .3) {
  const left = new Float32Array(Math.round(seconds * dsp.sampleRate)), right = new Float32Array(left.length);
  for (let offset = 0; offset < left.length; offset += 128) dsp.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128));
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite)); assert.ok(peak(left) < .82 && peak(right) < .82);
  return left;
}

test("legacy scenes remain hands and foot normalization owns exactly two big-toe joints", () => {
  assert.deepEqual(GESTICULES_FORMS, ["hand", "foot"]); assert.equal(HAND_DEFAULTS.form, "hand");
  const legacy = copy(HAND_DEFAULTS); delete legacy.form;
  assert.deepEqual(normalizeHandConfig(legacy), HAND_DEFAULTS);
  for (const form of [undefined, "other", null, Symbol(), {}, 1]) assert.equal(normalizeHandConfig({ form }).form, "hand");
  const config = normalizeHandConfig({ form: "foot", pose: { fingers: [{ mcp: -999, pip: 80, dip: 900, spread: 999 }, { mcp: -999, pip: -999, dip: NaN }],
    wrist: { flex: -999, side: 999, twist: Symbol() } }, tremor: { finger: "thumb", joint: "middle" } });
  checkFoot(config.pose); assert.equal(config.pose.fingers[0].mcp, -55); assert.equal(config.pose.fingers[0].dip, 70);
  assert.equal(config.pose.fingers[1].mcp, -40); assert.equal(config.pose.wrist.flex, -20); assert.equal(config.pose.wrist.side, 25);
  assert.equal(config.tremor.joint, "tip"); assert.equal(config.voices.length, 5);
  assert.deepEqual(normalizeHandConfig(config), config);
  const fresh = normalizeHandConfig(config); fresh.pose.fingers[0].dip = 3; assert.equal(config.pose.fingers[0].dip, 70);
});

test("anatomy helpers expose correct controls and fresh labeled poses without changing internal MIDI slots", () => {
  assert.deepEqual(handDigitLabels("foot"), ["Big toe", "Second toe", "Third toe", "Fourth toe", "Little toe"]);
  assert.deepEqual(FINGERS, ["thumb", "index", "middle", "ring", "little"]);
  assert.deepEqual(handJointKeys("foot", 0), ["mcp", "dip", "spread"]); assert.equal(handJointLabel("foot", 0, "pip"), "");
  assert.equal(handJointKeys("foot", 1).length, 4); assert.equal(handJointKeys("hand", 0).length, 4);
  assert.equal(handWristLimits("foot"), FOOT_LIMITS.ankle); assert.ok(Object.isFrozen(handDigitLimits("foot", 0)));
  for (const motion of HAND_MOTIONS) assert.ok(handMotionLabel(motion.id, "foot").length > 2);
  assert.match(handMotionLabel("source-grasp", "foot"), /adapted/);
  for (const { id, pose } of HAND_POSES) {
    assert.deepEqual(handPoseForForm(id, "hand"), pose); assert.ok(handPoseLabel(id, "foot").length > 2);
    const first = handPoseForForm(id, "foot"), second = handPoseForForm(id, "foot"); checkFoot(first); assert.deepEqual(second, first);
    first.fingers[0].dip = 800; assert.notEqual(second.fingers[0].dip, 800);
  }
});

test("every adapted foot choreography is bounded, distinct and periodic with reusable physical pose storage", () => {
  const out = createHandPose(), toes = out.fingers, bigToe = out.fingers[0], ankle = out.wrist, fingerprints = new Set();
  for (const motion of HAND_MOTIONS) {
    const config = normalizeHandConfig({ form: "foot", motion: { id: motion.id, amount: 1, tempo: 1100, speed: 4 } });
    const period = handMotionPeriod(config.motion), points = [];
    for (let frame = 0; frame <= 96; frame++) {
      assert.equal(evaluateHandPose(config, period * frame / 96, out), out);
      assert.equal(out.fingers, toes); assert.equal(out.fingers[0], bigToe); assert.equal(out.wrist, ankle);
      assert.equal(out.source, null); checkFoot(out);
      if (frame % 12 === 0) points.push(vector(out));
    }
    fingerprints.add(JSON.stringify(points));
    assert.ok(distance(evaluateHandPose(config, period * .237), evaluateHandPose(config, period * 1.237)) < 1e-9, motion.id);
    assert.ok(distance(evaluateHandPose(config, period * (1 - 1e-6)), evaluateHandPose(config, period * 1e-6)) < .02, `${motion.id} seam`);
  }
  assert.equal(fingerprints.size, HAND_MOTIONS.length);
});

test("foot base edits stay in actual degrees and Speed scales adapted source curves without hand metadata", () => {
  const config = scene(); config.pose.fingers[0].mcp = -31; config.pose.fingers[0].dip = 37;
  config.pose.fingers[3].pip = 61; config.pose.wrist.flex = 21;
  assert.deepEqual(geometry(evaluateHandPose(config, 100)), config.pose);
  config.motion = { id: "source-grasp", tempo: 71, amount: .65, speed: .8 };
  const original = copy(config), first = evaluateHandPose(config, .71); assert.equal(first.source, null);
  config.motion.speed *= 2; assert.deepEqual(evaluateHandPose(config, .355), first);
  config.motion.speed /= 2; config.pose.fingers[1].mcp += .013;
  assert.ok(Math.abs(evaluateHandPose(config, .71).fingers[1].mcp - first.fingers[1].mcp - .013) < 1e-10);
  original.motion.amount = 0; assert.deepEqual(geometry(evaluateHandPose(original, 100)), original.pose);
});

test("toe tremor affects only existing selected joints in actual degrees and honors its independent phase", () => {
  const base = scene(), time = 1 / 32, plain = evaluateHandPose(base, time);
  for (let i = 0; i < 5; i++) for (const joint of ["knuckle", "middle", "tip", "whole"]) {
    const config = normalizeHandConfig({ ...base, tremor: { finger: FINGERS[i], joint, amount: 4, rate: 8 } });
    const pose = evaluateHandPose(config, time); checkFoot(pose);
    const active = config.tremor.joint === "whole" ? handJointKeys("foot", i).filter(key => key !== "spread")
      : [config.tremor.joint === "knuckle" ? "mcp" : config.tremor.joint === "middle" ? "pip" : "dip"];
    for (let index = 0; index < 5; index++) for (const key of ["mcp", "pip", "dip", "spread"]) {
      assert.ok(Math.abs(pose.fingers[index][key] - plain.fingers[index][key] - (index === i && active.includes(key) ? 4 : 0)) < 1e-9, `${i} ${joint} ${index} ${key}`);
    }
    const rebased = evaluateHandPose(config, 100, undefined, time); assert.deepEqual(rebased, pose);
  }
  const middle = evaluateHandPose(normalizeHandConfig({ ...base, tremor: { finger: "all", joint: "middle", amount: 4, rate: 8 } }), time);
  assert.deepEqual(middle.fingers[0], plain.fingers[0]);
  for (const joint of ["knuckle", "middle", "tip", "whole", "spread", "wrist"]) {
    const config = normalizeHandConfig({ ...base, motion: { id: "frantic-orbit", tempo: 1100, speed: 4, amount: 1 }, tremor: { finger: "alternating", joint, amount: 45, rate: 120, rateSpread: .7, phaseSpread: .8 } });
    for (let step = 0; step < 120; step++) checkFoot(evaluateHandPose(config, step / 173));
  }
});

test("the expanded mixed bank preserves original foot scenes and randomization samples both anatomies", () => {
  assert.equal(HAND_PRESETS.length, 52);
  const feet = HAND_PRESETS.filter(preset => preset.snapshot.form === "foot");
  const originalFootMotions = { "foot-velvet-curl": "source-grasp", "foot-glass-ripple": "ripple-open",
    "foot-tin-drumming": "finger-drumming", "foot-ankle-orbit": "figure-eight" };
  for (const [id, motion] of Object.entries(originalFootMotions)) {
    const preset = feet.find(preset => preset.id === id); assert.ok(preset, `${id} must remain available`);
    assert.equal(preset.snapshot.motion.id, motion); assert.ok(preset.snapshot.sound.rotationFx > 0);
  }
  assert.ok(feet.length > Object.keys(originalFootMotions).length);
  assert.equal(new Set(feet.map(p => JSON.stringify(p.snapshot))).size, feet.length);
  for (const { snapshot } of feet) {
    checkFoot(snapshot.pose); assert.deepEqual(snapshot, normalizeHandConfig(snapshot));
    assert.ok(Object.isFrozen(snapshot.pose.fingers[0])); assert.ok(Object.isFrozen(snapshot.pose.foot));
    assert.equal(snapshot.playing, undefined); assert.equal(snapshot.tremorOffset, undefined);
  }
  const random = rng(), counts = { hand: 0, foot: 0 }, footRanges = { mcp: [], dip: [], flex: [] };
  for (let i = 0; i < 400; i++) {
    const config = randomizeHandConfig(HAND_DEFAULTS, random); counts[config.form]++;
    assert.deepEqual(config, normalizeHandConfig(config)); assert.ok(config.voices.some(voice => !voice.mute));
    if (config.form === "foot") { checkFoot(config.pose); footRanges.mcp.push(config.pose.fingers[0].mcp); footRanges.dip.push(config.pose.fingers[0].dip); footRanges.flex.push(config.pose.wrist.flex); }
  }
  assert.ok(counts.hand > 100 && counts.foot > 100);
  assert.ok(Math.min(...footRanges.mcp) < -45 && Math.max(...footRanges.mcp) > 30);
  assert.ok(Math.min(...footRanges.dip) < 10 && Math.max(...footRanges.dip) > 60);
  assert.ok(Math.min(...footRanges.flex) < -15 && Math.max(...footRanges.flex) > 35);
  assert.deepEqual(randomizeHandConfig(undefined, rng(18)), randomizeHandConfig(undefined, rng(18)));
});

test("every visible toe joint and ankle axis shapes the shared audio while the absent big-toe middle does nothing", () => {
  const config = scene(), base = render(engine(config));
  for (let i = 0; i < 5; i++) for (const key of handJointKeys("foot", i)) {
    const next = copy(config); next.pose.fingers[i][key] += key === "spread" ? -7 : 10;
    assert.ok(difference(base, render(engine(next))) > .0001, `toe ${i} ${key}`);
  }
  for (const key of ["flex", "side", "twist"]) {
    const next = copy(config); next.pose.wrist[key] += 7;
    assert.ok(difference(base, render(engine(next))) > .0001, `ankle ${key}`);
  }
  const hidden = copy(config); hidden.pose.fingers[0].pip = 90;
  assert.deepEqual(evaluateHandVoices(hidden, 0), evaluateHandVoices(config, 0));
  assert.deepEqual(render(engine(hidden)), base);
  const rotated = copy(config); rotated.view.yaw += 1.5; assert.ok(difference(base, render(engine(rotated))) > .001);
  const zoomed = copy(config); zoomed.view.zoom = 2; assert.deepEqual(render(engine(zoomed)), base);
});

test("five toe voices preserve held-note, mute, solo, release and transport ownership through form changes", () => {
  const config = scene(), dsp = engine(config); dsp.setSoundPlaying(false); dsp.setTransport({ time: .7, playing: true });
  const voices = dsp.voices, pose = dsp.pose;
  for (let i = 0; i < 5; i++) {
    dsp.setHeldFingers(1 << i); render(dsp, .4);
    assert.ok(dsp.voiceLevels[i] > .1); assert.ok(dsp.voiceLevels.every((value, index) => index === i || value < 1e-7));
  }
  config.voices[4].mute = true; dsp.setConfig(config); render(dsp, .4); assert.ok(peak(render(dsp, .1)) < 1e-7);
  config.voices[4].mute = false; config.voices[1].solo = true; dsp.setConfig(config); dsp.setSoundPlaying(true); render(dsp, .4);
  assert.ok(dsp.voiceLevels[1] > .1); assert.ok(dsp.voiceLevels.every((value, index) => index === 1 || value < 1e-7));
  for (const form of ["hand", "foot", "hand", "foot"]) {
    const before = dsp.getMotionTime(); dsp.setConfig({ ...config, form });
    assert.equal(dsp.getMotionTime(), before); assert.equal(dsp.voices, voices); assert.equal(dsp.pose, pose);
    assert.equal(dsp.soundPlaying, true); assert.equal(dsp.playing, true); render(dsp, .05);
  }
  dsp.setHeldFingers(0); dsp.setSoundPlaying(false); render(dsp, .6); assert.ok(peak(render(dsp, .1)) < 1e-7);
  dsp.auditionFinger(1, .1); assert.ok(peak(render(dsp, .08)) > .001);
  dsp.setEnabled(false); render(dsp, .4); assert.ok(peak(render(dsp, .1)) < 1e-7);
});

test("all eight engines and every foot preset produce bounded audio without graphics frames", () => {
  for (const rate of [8000, 48000, 192000]) for (const source of VOICE_SOURCES) {
    const config = scene(source); config.motion = { id: "frantic-orbit", amount: 1, tempo: 1100, speed: 4 };
    Object.assign(config.sound, { rootHz: 1000, brightness: 1, roughness: 1, rotationFx: 1, space: 1 });
    const dsp = engine(config, rate); dsp.setTransport({ time: .37, playing: true });
    assert.ok(rms(render(dsp, .12)) > .001, `${source} ${rate}`); assert.equal(dsp.pose.source, null); checkFoot(dsp.pose);
  }
  for (const { snapshot } of HAND_PRESETS.filter(preset => preset.snapshot.form === "foot")) {
    const dsp = engine(snapshot); dsp.setTransport({ playing: true }); assert.ok(rms(render(dsp, .5)) > .005);
    const moving = copy(geometry(dsp.pose)); render(dsp, .3);
    if (snapshot.motion.id !== "still" && snapshot.motion.amount > 0 || snapshot.tremor.amount > 0) assert.notDeepEqual(geometry(dsp.pose), moving);
    dsp.setTransport({ playing: false }); render(dsp, .01); const stopped = copy(dsp.pose); render(dsp, .1); assert.deepEqual(dsp.pose, stopped);
  }
});

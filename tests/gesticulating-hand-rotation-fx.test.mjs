import test from "node:test";
import assert from "node:assert/strict";
import { HandDSP } from "../src/instruments/gesticulating-hand/hand-dsp.js";
import { HAND_DEFAULTS, HAND_PRESETS, VOICE_SOURCES, normalizeHandConfig, randomizeHandConfig } from "../src/instruments/gesticulating-hand/hand-model.js";

const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
const peak = samples => samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const difference = (a, b) => rms(a.map((value, i) => value - b[i]));
function scene(source = "pulse", rotationFx = .65) {
  return normalizeHandConfig({ motion: { id: "still" }, sound: { brightness: .7, roughness: .2, space: 0, rotationFx, attack: .012, release: .12 },
    voices: Array.from({ length: 5 }, (_, i) => ({ source, level: i === 2 ? 1 : 0 })) });
}
function engine(config = scene(), rate = 24000) {
  const dsp = new HandDSP(rate); dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true); return dsp;
}
function render(dsp, seconds = .3, block = 128) {
  const left = new Float32Array(Math.round(seconds * dsp.sampleRate)), right = new Float32Array(left.length);
  for (let offset = 0; offset < left.length; offset += block) dsp.process(left.subarray(offset, offset + block), right.subarray(offset, offset + block));
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  assert.ok(peak(left) < .82 && peak(right) < .82);
  return { left, right };
}

test("rotation depth migrates old scenes, rejects hostile values and varies in presets and randomization", () => {
  assert.equal(HAND_DEFAULTS.sound.rotationFx, .65);
  const legacy = structuredClone(HAND_DEFAULTS); delete legacy.sound.rotationFx;
  assert.equal(normalizeHandConfig(legacy).sound.rotationFx, .65);
  for (const value of [NaN, Infinity, Symbol(), {}, undefined]) assert.equal(normalizeHandConfig({ sound: { rotationFx: value } }).sound.rotationFx, .65);
  assert.equal(normalizeHandConfig({ sound: { rotationFx: -5 } }).sound.rotationFx, 0);
  assert.equal(normalizeHandConfig({ sound: { rotationFx: 8 } }).sound.rotationFx, 1);
  assert.equal(normalizeHandConfig({ sound: { rotationFx: 0 } }).sound.rotationFx, 0);
  assert.ok(new Set(HAND_PRESETS.map(preset => preset.snapshot.sound.rotationFx)).size >= 12);
  assert.equal(randomizeHandConfig(undefined, () => .17).sound.rotationFx, .17);
  assert.equal(randomizeHandConfig(undefined, () => .83).sound.rotationFx, .83);
});

test("yaw and tilt change all eight engines while depth increases deviation from dry", () => {
  for (const source of VOICE_SOURCES) {
    const dry = render(engine(scene(source, 0))).left;
    const normal = render(engine(scene(source, .65))).left;
    const full = render(engine(scene(source, 1))).left;
    assert.ok(difference(dry, normal) > rms(dry) * .1, source);
    assert.ok(difference(dry, full) > difference(dry, normal) * 1.4, source);
    assert.ok(rms(full) > rms(dry) * .5, `${source}: full depth preserves useful source level`);
    for (const view of [{ yaw: HAND_DEFAULTS.view.yaw + Math.PI / 2 }, { pitch: 1.1 }]) {
      const config = scene(source); Object.assign(config.view, view);
      const moved = render(engine(config));
      assert.ok(difference(normal, moved.left) > rms(normal) * .08, `${source}: ${Object.keys(view)[0]}`);
    }
  }
});

test("zero depth makes camera orientation neutral, zoom never changes audio, and the circular seam meets", () => {
  const dryConfig = scene("wire", 0), dry = render(engine(dryConfig));
  Object.assign(dryConfig.view, { yaw: -2.9, pitch: 1.1, zoom: 2 });
  assert.deepEqual(render(engine(dryConfig)), dry);
  for (const depth of [0, .65, 1]) {
    const config = scene("air", depth), base = render(engine(config));
    config.view.zoom = .62; assert.deepEqual(render(engine(config)), base);
    config.view.zoom = 2; assert.deepEqual(render(engine(config)), base);
  }
  const a = scene("pulse", 1), b = structuredClone(a); a.view.yaw = -Math.PI; b.view.yaw = Math.PI;
  const first = render(engine(a)), second = render(engine(b));
  assert.ok(difference(first.left, second.left) < 1e-9 && difference(first.right, second.right) < 1e-9);
});

test("live angular and depth changes preserve transport and avoid a discontinuity at the edit", () => {
  const config = scene("wire", 1), referenceConfig = structuredClone(config);
  const actual = engine(config), reference = engine(referenceConfig);
  actual.setTransport({ time: .7, playing: true }); reference.setTransport({ time: .7, playing: true });
  render(actual); render(reference);
  for (let i = 0; i < 32; i++) {
    Object.assign(config.view, { yaw: i % 2 ? Math.PI : -Math.PI + .1, pitch: i % 3 ? -1.15 : 1.15 });
    config.sound.rotationFx = i % 4 ? 1 : 0;
    const before = actual.getMotionTime(); actual.setConfig(config);
    assert.equal(actual.getMotionTime(), before);
    const aL = new Float32Array(1), aR = new Float32Array(1), bL = new Float32Array(1), bR = new Float32Array(1);
    actual.process(aL, aR); reference.process(bL, bR);
    assert.ok(Math.abs(aL[0] - bL[0]) < .001 && Math.abs(aR[0] - bR[0]) < .001, `edit ${i}`);
    Object.assign(referenceConfig.view, config.view); referenceConfig.sound.rotationFx = config.sound.rotationFx; reference.setConfig(referenceConfig);
    render(actual, .008); render(reference, .008);
    assert.equal(actual.soundPlaying, true); assert.equal(actual.playing, true);
  }
});

test("audio-clock wrist motion drives the sweep without display messages and pause freezes its position", () => {
  const config = scene(); config.motion = { id: "wrist-turn", tempo: 83, amount: 1, speed: 1.3 };
  const dsp = engine(config); dsp.setTransport({ time: .3, playing: true }); render(dsp, .1);
  const start = dsp.rotation.channels.map(channel => Array.from(channel.targets));
  render(dsp, .37);
  assert.notDeepEqual(dsp.rotation.channels.map(channel => Array.from(channel.targets)), start);
  dsp.setTransport({ playing: false }); render(dsp, .15);
  const stopped = dsp.rotation.channels.map(channel => Array.from(channel.targets)), time = dsp.getMotionTime();
  render(dsp, .4);
  assert.equal(dsp.getMotionTime(), time);
  assert.deepEqual(dsp.rotation.channels.map(channel => Array.from(channel.targets)), stopped);
  assert.ok(dsp.rms > .005);
});

test("full rotation remains finite and bounded for every engine across supported sample rates", () => {
  for (const rate of [8000, 44100, 48000, 96000, 192000]) for (const source of VOICE_SOURCES) {
    const config = scene(source, 1);
    Object.assign(config.sound, { rootHz: 1000, brightness: 1, roughness: 1, space: 1, attack: .004 });
    Object.assign(config.motion, { id: "frantic-orbit", tempo: 1100, speed: 4, amount: 1 });
    Object.assign(config.view, { yaw: -Math.PI, pitch: -1.15 }); config.voices.forEach(voice => { voice.level = 1; });
    const dsp = engine(config, rate); dsp.setTransport({ time: .31, playing: true });
    assert.ok(rms(render(dsp, .14).left) > .001, `${source} ${rate}`);
  }
});

test("rotation releases to silence with sound or Audio off and reset clears feedback deterministically", () => {
  for (const source of ["pulse", "air", "bowed", "metal"]) {
    const dsp = engine(scene(source, 1));
    dsp.reset(); const first = render(dsp); dsp.reset(); assert.deepEqual(render(dsp), first, source);
    dsp.setSoundPlaying(false); render(dsp, 1); assert.equal(peak(render(dsp, .1).left), 0, `${source}: released feedback`);
    dsp.setSoundPlaying(true); render(dsp); dsp.setEnabled(false); render(dsp, .4);
    assert.equal(peak(render(dsp, .1).left), 0, `${source}: Audio off`);
    dsp.setSoundPlaying(false); dsp.setEnabled(true); assert.equal(peak(render(dsp, .1).left), 0, `${source}: no self oscillation`);
  }
});

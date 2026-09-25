import test from "node:test";
import assert from "node:assert/strict";
import { HandDSP } from "../src/instruments/gesticulating-hand/hand-dsp.js";
import { HAND_DEFAULTS, VOICE_SOURCES, normalizeHandConfig } from "../src/instruments/gesticulating-hand/hand-model.js";

const ADDED = ["bowed", "vowel", "metal"];
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
const peak = samples => samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
const difference = (a, b) => rms(a.map((value, i) => value - b[i]));
function scene(source) {
  return normalizeHandConfig({
    pose: { fingers: Array.from({ length: 5 }, () => ({ mcp: 0, pip: 0, dip: 0, spread: 0 })) },
    motion: { id: "still" }, sound: { space: 0, rootHz: 137, brightness: .7, roughness: .2, attack: .012, release: .12 },
    voices: Array.from({ length: 5 }, (_, i) => ({ source, level: i === 2 ? 1 : 0 })),
  });
}
function engine(config, rate = 24000) {
  const dsp = new HandDSP(rate); dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(true); return dsp;
}
function render(dsp, seconds = .25) {
  const left = new Float32Array(Math.round(dsp.sampleRate * seconds)), right = new Float32Array(left.length);
  for (let offset = 0; offset < left.length; offset += 128) dsp.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128));
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite), "every rendered stereo sample must be finite");
  assert.ok(peak(left) < .82 && peak(right) < .82, "the shared output bound must hold");
  return left;
}
// Average Hann-windowed FFT frames before normalizing, so a single noisy
// period cannot masquerade as a different engine. This characterizes the
// model independently of phase/loudness; it does not substitute for listening.
function spectrum(samples, rate = 24000) {
  const count = 4096, real = new Float64Array(count), imaginary = new Float64Array(count), bands = new Float64Array(16);
  let total = 0;
  for (let offset = 0; offset + count <= samples.length; offset += count) {
    imaginary.fill(0);
    for (let i = 0; i < count; i++) real[i] = samples[offset + i] * (.5 - .5 * Math.cos(2 * Math.PI * i / (count - 1)));
    for (let i = 1, reversed = 0; i < count; i++) {
      let bit = count >> 1;
      while (reversed & bit) { reversed ^= bit; bit >>= 1; }
      reversed ^= bit;
      if (i < reversed) { const value = real[i]; real[i] = real[reversed]; real[reversed] = value; }
    }
    for (let size = 2; size <= count; size <<= 1) {
      const c = Math.cos(-2 * Math.PI / size), s = Math.sin(-2 * Math.PI / size);
      for (let start = 0; start < count; start += size) {
        let re = 1, im = 0;
        for (let i = 0; i < size / 2; i++) {
          const even = start + i, odd = even + size / 2;
          const xr = real[odd] * re - imaginary[odd] * im, xi = real[odd] * im + imaginary[odd] * re;
          real[odd] = real[even] - xr; imaginary[odd] = imaginary[even] - xi;
          real[even] += xr; imaginary[even] += xi;
          const next = re * c - im * s; im = re * s + im * c; re = next;
        }
      }
    }
    for (let bin = 5; bin < Math.floor(count * 6000 / rate); bin++) {
      const power = real[bin] ** 2 + imaginary[bin] ** 2;
      const index = Math.max(0, Math.min(15, Math.floor(Math.log2(bin * rate / count / 50) * 2)));
      bands[index] += power; total += power;
    }
  }
  return bands.map(power => power / total);
}
const spectralDistance = (a, b) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0));

test("three added engines remain independently selectable on five anatomical voices", () => {
  for (const source of ADDED) {
    assert.ok(VOICE_SOURCES.includes(source));
    assert.ok(scene(source).voices.every(voice => voice.source === source));
  }
  assert.equal(VOICE_SOURCES.length, 8); assert.equal(HAND_DEFAULTS.voices.length, 5);
  assert.equal(new HandDSP().voices.length, 5);
});

test("Bowed, Vowel and Metal have different normalized spectra from all existing engines", () => {
  const profiles = new Map();
  for (const source of VOICE_SOURCES) {
    const repeated = [];
    for (const seed of [7, 97, 7919]) {
      const dsp = engine(scene(source)); dsp.voices[2].seed = seed;
      render(dsp, .15); const signal = render(dsp, 1.5);
      assert.ok(rms(signal.subarray(0, 4800)) > .005, `${source} has a usable nonzero fixture level`);
      repeated.push(spectrum(signal));
    }
    profiles.set(source, repeated);
  }
  for (const added of ADDED) for (const other of VOICE_SOURCES) {
    if (added === other) continue;
    const a = profiles.get(added), b = profiles.get(other);
    const within = Math.max(spectralDistance(a[0], a[1]), spectralDistance(a[0], a[2]), spectralDistance(b[0], b[1]), spectralDistance(b[0], b[2]));
    const between = spectralDistance(a[0], b[0]);
    assert.ok(between > .035 && between > within * 4, `${added}/${other}: spectrum difference ${between}, seed variation ${within}`);
  }
});

test("every added engine responds to pitch, brightness, roughness and articulated joints", () => {
  const edits = {
    pitch: c => { c.sound.rootHz = 231; }, brightness: c => { c.sound.brightness = .05; }, roughness: c => { c.sound.roughness = .97; },
    knuckle: c => { c.pose.fingers[2].mcp = 48; }, middle: c => { c.pose.fingers[2].pip = 75; }, tip: c => { c.pose.fingers[2].dip = 65; },
    spread: c => { c.pose.fingers[2].spread = -24; }, wrist: c => { c.pose.wrist.flex = 31; },
  };
  for (const source of ADDED) {
    const baseline = render(engine(scene(source)), .45);
    for (const [name, edit] of Object.entries(edits)) {
      const config = scene(source); edit(config);
      assert.ok(difference(baseline, render(engine(config), .45)) > .0003, `${source}: ${name} must reach the audible signal`);
    }
  }
});

test("low and high pitch, full motion and extreme controls are bounded at every supported rate", () => {
  for (const rate of [8000, 44100, 48000, 96000, 192000]) for (const source of ADDED) for (const rootHz of [35, 1000]) {
    const config = scene(source);
    Object.assign(config.sound, { rootHz, brightness: 1, roughness: 1, space: 1, attack: .004, release: 3.5 });
    Object.assign(config.motion, { id: "flourish", tempo: 220, amount: 1 }); config.voices.forEach(voice => { voice.level = 1; });
    const dsp = engine(config, rate); dsp.setTransport({ time: 1.1, playing: true });
    assert.ok(rms(render(dsp, .35)) > .001, `${source} ${rate} Hz ${rootHz} Hz root`);
    dsp.setEnabled(false); render(dsp, .4); assert.ok(peak(render(dsp, .1)) < 1e-7);
  }
});

test("rapid engine changes preserve the live clock and avoid a discontinuity at the change", () => {
  const actualConfig = scene("bowed"), referenceConfig = scene("bowed");
  const actual = engine(actualConfig), reference = engine(referenceConfig);
  actual.setTransport({ time: .7, playing: true }); reference.setTransport({ time: .7, playing: true });
  render(actual, .3); render(reference, .3);
  for (let edit = 0; edit < 48; edit++) {
    const source = VOICE_SOURCES[(edit * 3) % VOICE_SOURCES.length];
    actualConfig.voices[2].source = source;
    const before = actual.getMotionTime(); actual.setConfig(actualConfig);
    assert.equal(actual.getMotionTime(), before);
    const changed = new Float32Array(1), unchanged = new Float32Array(1);
    actual.process(changed); reference.process(unchanged);
    assert.ok(Math.abs(changed[0] - unchanged[0]) < .001, `${source}: first-sample discontinuity`);
    // Apply the same edit to the reference for the following window, but retain
    // this one-sample history difference to cover interrupted crossfades.
    referenceConfig.voices[2].source = source; reference.setConfig(referenceConfig);
    const next = render(actual, .004); render(reference, .004);
    let delta = Math.abs(next[0] - changed[0] * Math.SQRT1_2);
    for (let i = 1; i < next.length; i++) delta = Math.max(delta, Math.abs(next[i] - next[i - 1]));
    assert.ok(delta < .035, `${source}: transition sample step ${delta}`);
    assert.equal(actual.soundPlaying, true); assert.equal(actual.playing, true);
  }
});

test("metal strikes follow joint travel, audition and MIDI note edges, then decay on a still hand", () => {
  const still = engine(scene("metal")), movingConfig = scene("metal");
  movingConfig.motion = { id: "finger-roll", tempo: 110, amount: .9 };
  const moving = engine(movingConfig); moving.setTransport({ playing: true });
  render(still, 4); render(moving, 4);
  const quiet = rms(render(still, .3)), active = rms(render(moving, .3));
  assert.ok(active > .005 && active > quiet * 15, `joint travel ${active}, still ${quiet}`);
  moving.setTransport({ playing: false }); render(moving, 4);
  assert.ok(rms(render(moving, .3)) < active / 15, "pausing motion stops fresh impacts without silencing the ringing tail");
  still.auditionFinger(2, .12); assert.ok(rms(render(still, .15)) > .005);
  render(still, 4); still.setHeldFingers(1 << 2); assert.ok(rms(render(still, .15)) > .005, "a MIDI edge still strikes when Sound is already playing");
  still.setHeldFingers(0); still.setSoundPlaying(false); render(still, .6); assert.ok(peak(render(still, .1)) < 1e-7);
});

test("engine reset is deterministic, releases all memory and does not change transport ownership", () => {
  for (const source of ADDED) {
    const dsp = engine(scene(source));
    const storage = dsp.voices.map(voice => [voice.bow.buffer, voice.vowel, voice.metal.modes, voice.sourceWeights]);
    dsp.reset(); const first = render(dsp, .33); dsp.reset(); const second = render(dsp, .33);
    assert.deepEqual(second, first, source); assert.equal(dsp.soundPlaying, true);
    for (let i = 0; i < 5; i++) {
      assert.equal(dsp.voices[i].bow.buffer, storage[i][0]); assert.equal(dsp.voices[i].vowel, storage[i][1]);
      assert.equal(dsp.voices[i].metal.modes, storage[i][2]); assert.equal(dsp.voices[i].sourceWeights, storage[i][3]);
    }
    dsp.setSoundPlaying(false); dsp.setHeldFingers(0); dsp.reset(); assert.equal(peak(render(dsp, .1)), 0);
    dsp.auditionFinger(2, 2); dsp.setEnabled(false); render(dsp, .2); dsp.setEnabled(true);
    assert.equal(peak(render(dsp, .1)), 0, `${source}: disabled auditions cannot return when rearmed`);
  }
});

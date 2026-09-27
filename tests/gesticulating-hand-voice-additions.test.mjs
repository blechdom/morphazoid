import test from "node:test";
import assert from "node:assert/strict";
import { HandDSP } from "../src/instruments/gesticulating-hand/hand-dsp.js";
import { normalizeHandConfig } from "../src/instruments/gesticulating-hand/hand-model.js";

const RATE = 24000, MIDDLE = 2, HELD = 1 << MIDDLE;
const rms = samples => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
const peak = samples => samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
function scene(source) {
  return normalizeHandConfig({
    pose: { fingers: Array.from({ length: 5 }, () => ({ mcp: 0, pip: 35, dip: 35, spread: 0 })), wrist: { flex: 0, side: 0, twist: 0 } },
    motion: { id: "still", tempo: 120, speed: 1 },
    sound: { rootHz: 180, brightness: .4, roughness: 0, space: 0, rotationFx: 0, attack: .004, release: .04 },
    voices: Array.from({ length: 5 }, (_, index) => ({ source, level: index === MIDDLE ? 1 : 0 })),
  });
}
function engine(config, { sound = true, time = 0, playing = false } = {}) {
  const dsp = new HandDSP(RATE);
  dsp.setConfig(config); dsp.setEnabled(true); dsp.setSoundPlaying(sound);
  dsp.setTransport({ time, playing }); dsp.reset();
  return dsp;
}
function renderFrames(dsp, frames, block = 128) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += block) {
    dsp.process(left.subarray(offset, offset + block), right.subarray(offset, offset + block));
  }
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite), "all stereo samples must be finite");
  assert.ok(peak(left) < .82 && peak(right) < .82, "the common DSP bound must hold");
  return { left, right };
}
const render = (dsp, seconds) => renderFrames(dsp, Math.round(seconds * dsp.sampleRate)).left;
function sameSamples(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  const mismatch = actual.findIndex((sample, index) => sample !== expected[index]);
  assert.equal(mismatch, -1, `${message}; first different sample ${mismatch}`);
}

// A normalized, mean-free autocorrelation measures period rather than level.
// The search contains one fundamental period, excluding the octave/subharmonic
// peaks that vowel formants can otherwise make ambiguous. Parabolic refinement
// removes integer-lag quantization without requiring a large FFT fixture.
function fundamental(samples, root) {
  const minimum = Math.floor(RATE / (root * 1.3)), maximum = Math.ceil(RATE / (root * .7));
  const scores = new Float64Array(maximum + 1), mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  for (let lag = minimum; lag <= maximum; lag++) {
    let xx = 0, yy = 0, xy = 0;
    for (let index = 0; index < samples.length - lag; index++) {
      const a = samples[index] - mean, b = samples[index + lag] - mean;
      xx += a * a; yy += b * b; xy += a * b;
    }
    scores[lag] = xy / Math.sqrt(xx * yy);
  }
  let best = minimum;
  for (let lag = minimum + 1; lag <= maximum; lag++) if (scores[lag] > scores[best]) best = lag;
  assert.ok(best > minimum && best < maximum, "fundamental must be inside the search range");
  assert.ok(scores[best] > .9, `a pitched signal must have a strong periodic match: ${scores[best]}`);
  const offset = .5 * (scores[best - 1] - scores[best + 1]) / (scores[best - 1] - 2 * scores[best] + scores[best + 1]);
  return RATE / (best + offset);
}

test("choir tip tremor changes rendered fundamental pitch, independently of amplitude", () => {
  const roots = [];
  for (const amount of [0, 30]) {
    const measured = [];
    for (const [phase, sign] of [[.25, 1], [.75, -1]]) {
      const config = scene("choir");
      config.tremor = { finger: "middle", joint: "tip", amount, rate: 3, rateSpread: 0, phaseSpread: 0 };
      // Frozen extrema remove velocity-driven level changes; DIP=35 leaves
      // both +/-30 degree excursions inside the real articulated joint limits.
      const dsp = engine(config, { time: phase / 3 });
      render(dsp, .3); const signal = render(dsp, .25);
      assert.ok(rms(signal) > .003, "the pitch fixture must be audible");
      const hz = fundamental(signal, 180), expected = 180 * Math.exp(sign * amount * .0028);
      assert.ok(Math.abs(hz / expected - 1) < .02, `${amount} degree tremor: ${hz} Hz, expected ${expected} Hz`);
      assert.ok(Math.abs(fundamental(signal.map(sample => sample * .17), 180) - hz) < 1e-5,
        "changing amplitude must not masquerade as a changed fundamental");
      measured.push(hz);
    }
    roots.push(measured);
  }
  assert.ok(Math.abs(roots[0][0] / roots[0][1] - 1) < .001, "without tremor both frozen times retain one pitch");
  assert.ok(roots[1][0] / roots[1][1] > 1.15, "opposite tremor extrema must bend the audible pitch in opposite directions");
});

test("marimba decays on a still pose and new joint travel revives its ringing sound", () => {
  const config = scene("marimba"), dsp = engine(config);
  const attack = rms(render(dsp, .12));
  assert.ok(attack > .003, `initial strike must sound: ${attack}`);
  render(dsp, 2.5); const quiet = rms(render(dsp, .15));
  assert.ok(quiet < attack / 50, `a held still note must ring down: attack ${attack}, late ${quiet}`);
  config.motion = { id: "finger-roll", tempo: 120, speed: 1, amount: .9 };
  dsp.setConfig(config); dsp.setTransport({ playing: true });
  const moving = rms(render(dsp, 1));
  assert.ok(moving > .003 && moving > quiet * 20, `joint travel must cause fresh strikes: ${moving}`);
  dsp.setTransport({ playing: false });
  assert.ok(rms(render(dsp, .1)) > 0, "pausing retains the current ringing tail");
  render(dsp, 2.5);
  assert.ok(rms(render(dsp, .15)) < moving / 50, "paused joint travel cannot keep causing fresh strikes");
});

test("marimba walking notes attack at the written cells and leave audible rests", () => {
  const config = scene("marimba");
  config.sound.rhythm = "walk"; config.sound.noteLength = .4;
  const signal = render(engine(config, { playing: true }), 2.3);
  const level = (start, end) => rms(signal.subarray(Math.round(start * RATE), Math.round(end * RATE)));
  // At 120 BPM, middle-finger cells 2 and 6 start at .5 and 1.5 s.
  // Assertions use the written schedule, independently of handRhythmPhase().
  for (const onset of [.5, 1.5]) {
    const attack = level(onset + .01, onset + .07), before = level(onset - .09, onset - .03);
    assert.ok(attack > .003 && attack > before * 20, `fresh attack at ${onset} s: ${attack}, previous rest ${before}`);
    assert.ok(level(onset + .22, onset + .28) < attack / 100, "the short note must release into its written rest");
  }
  assert.equal(peak(signal.subarray(0, Math.round(.49 * RATE))), 0, "unwritten opening cells cannot strike the middle finger");
});

test("marimba MIDI rising edges retrigger held Sound, while identical held masks do not", () => {
  const actual = engine(scene("marimba")), reference = engine(scene("marimba"));
  render(actual, 2.8); render(reference, 2.8);
  for (const dsp of [actual, reference]) dsp.setHeldFingers(HELD);
  const first = render(actual, .12); render(reference, .12);
  assert.ok(rms(first) > .003, "a MIDI edge must strike even while Sound already holds the gate");
  render(actual, 2.5); render(reference, 2.5);
  actual.setHeldFingers(HELD);
  sameSamples(render(actual, .15), render(reference, .15), "repeated identical MIDI masks must leave audio untouched");
  actual.setHeldFingers(0); actual.setHeldFingers(HELD);
  const restruck = rms(render(actual, .12)), unchanged = rms(render(reference, .12));
  assert.ok(restruck > .003 && restruck > unchanged * 20, "releasing and pressing again must cause a new strike");
  assert.equal(actual.soundPlaying, true); assert.equal(actual.heldFingers, HELD);
});

test("repeated marimba auditions retrigger while Sound, MIDI and an earlier audition still hold the gate", () => {
  const actual = engine(scene("marimba")), reference = engine(scene("marimba"));
  for (const dsp of [actual, reference]) { dsp.setHeldFingers(HELD); render(dsp, 2.8); assert.equal(dsp.auditionFinger(MIDDLE, 2), true); }
  assert.ok(rms(render(actual, .12)) > .003); render(reference, .12);
  render(actual, .6); render(reference, .6);
  assert.ok(actual.voices[MIDDLE].auditionUntil > actual.clock, "the first audition is still active");
  assert.equal(actual.auditionFinger(MIDDLE, 2), true);
  const repeated = rms(render(actual, .12)), uninterrupted = rms(render(reference, .12));
  assert.ok(repeated > .003 && repeated > uninterrupted * 3,
    `another audition must inject a fresh strike without a gate transition: ${repeated} versus ${uninterrupted}`);
});

test("Audio mute cancels queued marimba attacks and auditions without reviving them when rearmed", () => {
  const dsp = engine(scene("marimba"), { sound: false });
  assert.equal(peak(render(dsp, .1)), 0);
  dsp.setHeldFingers(HELD); assert.equal(dsp.auditionFinger(MIDDLE, 2), true);
  assert.ok(dsp.voices[MIDDLE].marimba.pending > 0, "an unrendered strike is queued");
  dsp.setEnabled(false); dsp.setHeldFingers(0);
  assert.equal(dsp.voices[MIDDLE].marimba.pending, 0);
  assert.equal(dsp.voices[MIDDLE].auditionUntil, -1);
  assert.equal(dsp.auditionFinger(MIDDLE, 2), false, "disabled auditions cannot queue new sound");
  assert.equal(peak(render(dsp, .2)), 0);
  dsp.setEnabled(true);
  assert.equal(peak(render(dsp, .3)), 0, "rearming with no current note must remain silent");
  assert.equal(dsp.soundPlaying, false); assert.equal(dsp.playing, false);
});

test("moving choir tremor and rhythmic marimba are sample-identical across arbitrary audio block partitions", () => {
  for (const source of ["choir", "marimba"]) {
    const config = scene(source);
    config.voices.forEach(voice => { voice.level = .6; });
    Object.assign(config.sound, { space: .23, rotationFx: .5 });
    if (source === "choir") {
      config.motion = { id: "finger-roll", tempo: 137, speed: 1.1, amount: .7 };
      config.tremor = { finger: "all", joint: "whole", amount: 22, rate: 7.3, rateSpread: .29, phaseSpread: .37 };
    } else {
      config.sound.rhythm = "walk"; config.sound.noteLength = .37;
    }
    const frames = Math.round(RATE * 1.637), setup = () => engine(config, { time: .137, playing: true });
    const expected = renderFrames(setup(), frames, frames);
    assert.ok(rms(expected.left) > .003, `${source} partition fixture must sound`);
    for (const block of [1, 7, 31, 128, 257]) {
      const actual = renderFrames(setup(), frames, block);
      sameSamples(actual.left, expected.left, `${source}, left, ${block} frames`);
      sameSamples(actual.right, expected.right, `${source}, right, ${block} frames`);
    }
  }
});

test("reset restores deterministic choir and marimba audio while preserving their allocated state and transport", () => {
  for (const source of ["choir", "marimba"]) {
    const dsp = engine(scene(source), { time: .375 }); dsp.setHeldFingers(HELD); dsp.reset();
    const storage = dsp.voices.map(voice => ({
      choir: voice.choir, cosine: voice.choir.cosine, sine: voice.choir.sine,
      targetCosine: voice.choir.targetCosine, targetSine: voice.choir.targetSine,
      marimba: voice.marimba, modes: voice.marimba.modes, modeObjects: [...voice.marimba.modes],
    }));
    const first = renderFrames(dsp, Math.round(RATE * .27));
    assert.ok(rms(first.left) > .003, `${source} reset fixture must exercise audible state`);
    const clock = dsp.clock, time = dsp.getMotionTime();
    dsp.auditionFinger(MIDDLE, 2); dsp.reset();
    assert.equal(dsp.clock, clock); assert.equal(dsp.getMotionTime(), time);
    assert.equal(dsp.enabled, true); assert.equal(dsp.soundPlaying, true);
    assert.equal(dsp.heldFingers, HELD); assert.equal(dsp.playing, false);
    assert.equal(dsp.voices[MIDDLE].auditionUntil, -1); assert.equal(dsp.voices[MIDDLE].marimba.pending, 0);
    for (let index = 0; index < dsp.voices.length; index++) {
      const voice = dsp.voices[index], saved = storage[index];
      assert.equal(voice.choir, saved.choir); assert.equal(voice.marimba, saved.marimba);
      for (const key of ["cosine", "sine", "targetCosine", "targetSine"]) assert.equal(voice.choir[key], saved[key]);
      assert.equal(voice.marimba.modes, saved.modes);
      voice.marimba.modes.forEach((mode, modeIndex) => assert.equal(mode, saved.modeObjects[modeIndex]));
    }
    const second = renderFrames(dsp, Math.round(RATE * .27));
    sameSamples(second.left, first.left, `${source} reset, left`);
    sameSamples(second.right, first.right, `${source} reset, right`);
    dsp.setSoundPlaying(false); dsp.setHeldFingers(0); dsp.reset();
    assert.equal(peak(render(dsp, .2)), 0, `${source} reset must not retain audible tails or queued attacks`);
  }
});

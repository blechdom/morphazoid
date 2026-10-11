import assert from "node:assert/strict";
import test from "node:test";
import { SpartialEngine, randomSpartialInstrument, sanitizeSpartialSettings } from "../src/instruments/spartial/spartial.js";
import { SPARTIAL_ORGAN_STOPS } from "../src/instruments/spartial/spartial-organ.js";

const base = { partials: 32, cascade: 0, attack: 0.002, release: 0.025, level: 0.8, rolloff: 0 };
function render(engine, frames) {
  const channels = Array.from({ length: 16 }, () => new Float32Array(frames)); engine.render(channels);
  for (const channel of channels) for (const sample of channel) { assert.ok(Number.isFinite(sample)); assert.ok(Math.abs(sample) <= 0.720001); }
  return channels;
}
const energy = channel => channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length;
const totalEnergy = channels => channels.reduce((sum, channel) => sum + energy(channel), 0);
function amplitude(channel, frequency) {
  let real = 0, imaginary = 0;
  channel.forEach((sample, frame) => { real += sample * Math.cos(2 * Math.PI * frequency * frame / 8000); imaginary += sample * Math.sin(2 * Math.PI * frequency * frame / 8000); });
  return 2 * Math.hypot(real, imaginary) / channel.length;
}

test("each drawbar sounds its actual footage and attenuation survives painted gains", () => {
  for (let stop = 0; stop < 9; stop += 1) {
    const settings = { ...base, organMode: "tonewheel", organStops: Array(9).fill(0), lock: 1, target: 0 };
    settings.organStops[stop] = 8;
    const engine = new SpartialEngine({ sampleRate: 8000, settings });
    engine.noteOn("drawbar", 57); render(engine, 800);
    const full = amplitude(render(engine, 800)[0], 220 * SPARTIAL_ORGAN_STOPS[stop].ratio);
    assert.ok(full > 0.55, `${SPARTIAL_ORGAN_STOPS[stop].label} reaches its intended frequency`);
    settings.organStops[stop] = 4; engine.setSettings({ organStops: settings.organStops }); render(engine, 4000);
    const half = amplitude(render(engine, 800)[0], 220 * SPARTIAL_ORGAN_STOPS[stop].ratio);
    assert.ok(Math.abs(half / full - 0.5) < 0.001);
    const gains = Array(32).fill(1); gains[SPARTIAL_ORGAN_STOPS[stop].partial - 1] = 0.5;
    engine.setSettings({ gains }); render(engine, 4000);
    const painted = amplitude(render(engine, 800)[0], 220 * SPARTIAL_ORGAN_STOPS[stop].ratio);
    assert.ok(Math.abs(painted / full - 0.25) < 0.001);
  }
});

test("pipe families change sounding harmonics while live organ edits retain phase and note identity", () => {
  const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, organMode: "pipe", pipeTone: "flute",
    organStops: [0, 0, 8, 0, 0, 0, 0, 0, 0], lock: 1, target: 0 } });
  engine.noteOn("held", 57); render(engine, 800);
  const flute = render(engine, 800)[0], phase = engine.voices[0].phases[1];
  engine.setSettings({ pipeTone: "reed", pipeBrightness: 1 });
  assert.equal(engine.voices[0].phases[1], phase); assert.equal(engine.voices[0].id, "held");
  render(engine, 4000); const reed = render(engine, 800)[0];
  assert.ok(amplitude(reed, 1320) > amplitude(flute, 1320) * 5);
  engine.setSettings({ organMode: "partials" }); render(engine, 4000);
  assert.equal(engine.voices[0].id, "held"); assert.equal(engine.snapshot().voices, 1);
});

test("key click and pipe chiff end rather than becoming continuous noise", () => {
  for (const patch of [{ keyClick: 1 }, { pipeChiff: 1 }]) {
    const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, organMode: "tonewheel", organStops: Array(9).fill(0), ...patch } });
    engine.noteOn("attack", 57);
    assert.ok(totalEnergy(render(engine, 800)) > 1e-7);
    render(engine, 800);
    assert.equal(totalEnergy(render(engine, 800)), 0, "no noise remains on a held silent registration");
    assert.equal(engine.snapshot().voices, 1);
  }
});

test("organ percussion sounds the selected harmonic and single-triggers until all gates release", () => {
  for (const [mode, frequency] of [["second", 440], ["third", 660]]) {
    const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, organMode: "tonewheel",
      organStops: Array(9).fill(0), organPercussion: mode, percussionLevel: 1, percussionDecay: 0.08, lock: 1 } });
    engine.noteOn("first", 57); const first = render(engine, 800)[0];
    assert.ok(amplitude(first, frequency) > 0.1);
    engine.noteOn("legato", 64);
    assert.equal(engine.voices.find(voice => voice.id === "legato").percussionEnvelope, 0);
    render(engine, 8000);
    assert.ok(totalEnergy(render(engine, 800)) < 1e-10, "held percussion decays away");
    engine.noteOff("first"); engine.noteOff("legato"); engine.noteOn("fresh", 57);
    assert.ok(engine.voices.find(voice => voice.id === "fresh").percussionEnvelope > 0.4);
  }
});

test("rotary runs independently of Rotation, ramps distinct rotors and brakes without phase reset", () => {
  const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, rotaryMode: "slow", rotaryRamp: 0.2, rotation: 0 } });
  engine.noteOn("held", 57); render(engine, 2400);
  assert.equal(engine.phase, 0);
  assert.ok(engine.rotaryHornHz > 0.7 && engine.rotaryHornHz < 0.81);
  assert.ok(engine.rotaryDrumHz > 0.5 && engine.rotaryDrumHz < 0.66);
  const horn = engine.rotaryHornPhase, drum = engine.rotaryDrumPhase, speed = engine.rotaryHornHz;
  engine.setSettings({ rotaryMode: "fast" });
  assert.equal(engine.rotaryHornHz, speed); assert.equal(engine.rotaryHornPhase, horn); assert.equal(engine.rotaryDrumPhase, drum);
  render(engine, 2400); assert.ok(engine.rotaryHornHz > 6 && engine.rotaryDrumHz > 5);
  const beforeBrake = engine.rotaryHornPhase; engine.setSettings({ rotaryMode: "brake" });
  assert.equal(engine.rotaryHornPhase, beforeBrake); render(engine, 16000);
  assert.ok(engine.rotaryHornHz < 1e-8 && engine.rotaryDrumHz < 1e-7);
  const parked = engine.rotaryHornPhase; render(engine, 800);
  assert.equal(engine.rotaryHornPhase, parked); assert.equal(engine.phase, 0);
});

test("rotary crossover routes actual low and high frequencies to different parked rotors", () => {
  const result = [];
  for (const note of [45, 93]) {
    const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, partials: 1, cycles: 0,
      rotaryMode: "brake", rotaryMix: 1, rotarySpread: 1 } });
    engine.rotaryHornPhase = 0.25; engine.rotaryDrumPhase = 0.75;
    engine.noteOn("tone", note); render(engine, 800);
    const channels = render(engine, 800);
    result.push({ horn: energy(channels[2]), drum: energy(channels[6]) });
  }
  assert.ok(result[0].drum > result[0].horn * 10);
  assert.ok(result[1].horn > result[1].drum * 2);
});

test("rotary affects file grains too while One speaker and master zero override its movement", () => {
  const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, granularMix: 1, granularSource: "file",
    grainSpread: 0, grainDensity: 40, rotaryMode: "fast", rotaryRamp: 0.2, rotaryMix: 1, rotarySpread: 1 } });
  engine.setGrainSource(Float32Array.from({ length: 4000 }, (_, index) => 0.8 * Math.sin(index * Math.PI * 2 * 220 / 8000)), 8000);
  engine.noteOn("file", 60); render(engine, 2400);
  const spread = render(engine, 4000);
  assert.ok(spread.filter(channel => energy(channel) > 1e-5).length > 3);
  engine.setSettings({ lock: 1, target: 5 }); render(engine, 4000);
  const locked = render(engine, 800);
  assert.ok(energy(locked[5]) > 1e-5);
  locked.forEach((channel, index) => { if (index !== 5) assert.ok(energy(channel) < 1e-18); });
  engine.setSettings({ level: 0, drive: 1 }); render(engine, 6000);
  assert.equal(totalEnergy(render(engine, 800)), 0);
});

test("compensated drive is before master volume and survives extreme polyphony without clipping", () => {
  const takes = [];
  for (const level of [1, 0.25, 0]) {
    const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, level, drive: 1, lock: 1,
      organMode: "tonewheel", organStops: Array(9).fill(8), keyClick: 1, pipeChiff: 1,
      organPercussion: "third", percussionLevel: 1, rotaryMode: "fast", rotaryRamp: 0.2 } });
    for (let index = 0; index < 8; index += 1) engine.noteOn(index, 48 + index * 3);
    takes.push(render(engine, 4000));
  }
  assert.ok(totalEnergy(takes[0]) > 1e-5); assert.equal(totalEnergy(takes[2]), 0);
  for (let index = 0; index < 4000; index += 1) assert.ok(Math.abs(takes[1][0][index] - takes[0][0][index] * 0.25) < 1e-7);
});

test("full-instrument dice cover organ/modulation/effects fields while preserving volume and audio clocks", () => {
  const current = { settings: sanitizeSpartialSettings({ level: 0.37 }), tempo: 110, phase: 0.2, playing: false, audioOn: true };
  const scenes = Array.from({ length: 256 }, (_, index) => randomSpartialInstrument(current, index + 1));
  for (const key of ["organMode", "pipeTone", "pipeBrightness", "pitchDepth", "amplitudeDepth", "modulationRate", "modulationRipple", "modulationShape",
    "rotaryMode", "rotaryMix", "rotarySpread", "rotaryRamp", "drive", "keyClick", "pipeChiff", "organPercussion", "percussionLevel", "percussionDecay"]) {
    assert.ok(new Set(scenes.map(scene => scene.settings[key])).size > 1, `${key} varies`);
  }
  assert.equal(new Set(scenes.map(scene => scene.settings.organMode)).size, 3);
  for (let stop = 0; stop < 9; stop += 1) assert.ok(new Set(scenes.map(scene => scene.settings.organStops[stop])).size > 1);
  for (const scene of scenes) {
    assert.equal(scene.settings.level, 0.37); assert.equal(scene.phase, 0.2); assert.equal(scene.playing, false); assert.equal(scene.audioOn, true);
    assert.deepEqual(sanitizeSpartialSettings(scene.settings), scene.settings);
  }
});

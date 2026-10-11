import assert from "node:assert/strict";
import test from "node:test";
import { SpartialEngine, SPARTIAL_DEFAULTS, sanitizeSpartialSettings } from "../src/instruments/spartial/spartial.js";
import { spartialLayout, spartialSpeakers } from "../src/instruments/spartial/spartial-audio.js";
import { speakerPan } from "../src/instruments/surround-field/surround-field.js";
import { SPARTIAL_MAX_GRAINS } from "../src/instruments/spartial/spartial-granular.js";

const RATE = 8000;
const BASE = { partials: 1, cascade: 0, attack: 0.002, release: 0.01, level: 1 };
const WET = { ...BASE, granularMix: 1, grainSize: 100, grainDensity: 40, grainScatter: 0 };
const engine = (settings = {}, sampleRate = RATE) => new SpartialEngine({ sampleRate, settings: { ...BASE, ...settings } });
const source = (rate = RATE, seconds = 1) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => (
  Math.sin(i / rate * 2 * Math.PI * 220) * (0.2 + 0.5 * i / (rate * seconds))
    + Math.sin(i / rate * 2 * Math.PI * 351) * 0.15
));
function render(synth, seconds, channelCount = 16) {
  const output = Array.from({ length: channelCount }, () => new Float32Array(Math.round(seconds * synth.sampleRate)));
  synth.render(output);
  for (const channel of output) for (const sample of channel) {
    assert.ok(Number.isFinite(sample));
    assert.ok(Math.abs(sample) <= 0.720001, "both sources and their blend obey the peak bound");
  }
  return output;
}
const energy = output => output.reduce((total, channel) => total + channel.reduce((sum, value) => sum + value ** 2, 0), 0);
function fileEngine(settings = {}, sampleRate = RATE) {
  const synth = engine({ ...WET, granularSource: "file", ...settings }, sampleRate);
  synth.setGrainSource(source(sampleRate), sampleRate);
  return synth;
}
function difference(a, b) {
  let sum = 0;
  for (let ch = 0; ch < a.length; ch += 1) for (let i = 0; i < a[ch].length; i += 1) sum += (a[ch][i] - b[ch][i]) ** 2;
  return sum;
}

test("granular defaults stay dry and hostile settings have finite musical bounds", () => {
  assert.equal(SPARTIAL_DEFAULTS.granularMix, 0);
  const low = sanitizeSpartialSettings({
    granularMix: -2, grainSize: 0, grainDensity: -1, grainLookback: -3, grainScatter: -3,
    grainJitter: -1, grainPitch: -99, grainReverse: -5, grainSpread: -3, grainPosition: -2,
    grainPattern: "bad", granularSource: "microphone", grainFreeze: "true",
  });
  for (const key of ["granularMix", "grainLookback", "grainScatter", "grainJitter", "grainReverse", "grainSpread", "grainPosition"]) assert.equal(low[key], 0);
  assert.equal(low.grainSize, 5); assert.equal(low.grainDensity, 1); assert.equal(low.grainPitch, -24);
  assert.equal(low.grainPattern, "wrap"); assert.equal(low.granularSource, "additive"); assert.equal(low.grainFreeze, false);
  const high = sanitizeSpartialSettings({
    granularMix: 3, grainSize: 1e12, grainDensity: 1e12, grainLookback: 1e12, grainScatter: 1e12,
    grainJitter: 3, grainPitch: 1000, grainReverse: 3, grainSpread: 3, grainPosition: 3,
  });
  assert.equal(high.grainSize, 500); assert.equal(high.grainDensity, 80);
  assert.equal(high.grainLookback, 3000); assert.equal(high.grainScatter, 1000); assert.equal(high.grainPitch, 24);
  for (const key of ["granularMix", "grainJitter", "grainReverse", "grainSpread", "grainPosition"]) assert.equal(high[key], 1);
  for (const key of Object.keys(high).filter(key => key.startsWith("grain"))) {
    if (typeof high[key] === "number") assert.equal(sanitizeSpartialSettings({ [key]: NaN }, high)[key], high[key]);
  }
});

test("dry mixer preserves additive samples despite arbitrary granular settings and files", () => {
  const dry = engine();
  const other = fileEngine({ granularMix: 0, grainPitch: 24, grainFreeze: true, grainJitter: 1 });
  dry.noteOn("held", 57); other.noteOn("held", 57);
  assert.deepEqual(render(dry, 0.15), render(other, 0.15));
  assert.equal(other.snapshot().grains.length, 0, "dry startup does not spend CPU on inaudible grains");
});

test("live capture is pre-master, pre-routing and pre-mix even at 100% granular", () => {
  const dry = engine();
  const wet = engine(WET);
  const muted = engine({ ...WET, level: 0, lock: 1, target: 5 });
  for (const synth of [dry, wet, muted]) synth.noteOn("held", 57);
  render(dry, 0.3);
  assert.ok(energy(render(wet, 0.3)) > 1);
  assert.equal(energy(render(muted, 0.3)), 0);
  assert.deepEqual(dry.granular.live, wet.granular.live);
  assert.deepEqual(dry.granular.live, muted.granular.live);
  assert.equal(muted.snapshot().grainBufferReady, true);
  muted.setSettings({ level: 1 });
  assert.ok(energy(render(muted, 0.2)) > 1, "raising master reveals the captured source without rerecording");
  assert.ok(muted.snapshot().grainEnergy[5] > 0);
  assert.ok(muted.snapshot().partialEnergy.every(value => value === 0), "graphic additive energy follows mixer");
});

test("file source owns a bounded copy, handles rates, and rejects invalid buffers", () => {
  const synth = engine();
  assert.equal(synth.setGrainSource(null), false);
  assert.equal(synth.setGrainSource(new Float32Array(1)), false);
  const samples = new Float32Array([NaN, Infinity, -Infinity, 2, -2, 0.25]);
  assert.equal(synth.setGrainSource(samples, 44100), true);
  assert.deepEqual(synth.granular.file, new Float32Array([0, 0, 0, 1, -1, 0.25]));
  samples.fill(0);
  assert.equal(synth.granular.file[5], 0.25);
  assert.equal(synth.snapshot().grainFileDuration, 6 / 44100);
  synth.setGrainSource(new Float32Array(RATE * 21), RATE);
  assert.equal(synth.granular.file.length, RATE * 20);
  assert.equal(synth.snapshot().grainFileDuration, 20);
  synth.setSettings({ granularSource: "file" });
  synth.clearGrainSource();
  assert.equal(synth.settings.granularSource, "additive");
  assert.equal(synth.snapshot().grainFileReady, false);
});

test("live delayed grains survive short notes after idle and finish their recorded release", () => {
  for (const sampleRate of [8000, 48000]) for (const lookback of [150, 1000]) {
    const synth = engine({ ...WET, grainLookback: lookback, grainScatter: 0, release: .04 }, sampleRate);
    render(synth, 4.1); // A running browser has history full of silence, not an empty buffer.
    synth.noteOn("tap", 60);
    const during = render(synth, .1);
    synth.noteOff("tap");
    assert.equal(energy(during), 0, "the selected look-back still refers to earlier silence");
    const tail = render(synth, lookback / 1000 + .4);
    assert.ok(energy(tail) > .01, "the captured note must reach the grain bus after key-up");
    assert.equal(synth.snapshot().grains.length, 0, "the history window bounds new births");
    assert.equal(energy(render(synth, .2)), 0);
  }
});

test("Silence cancels a delayed live note before it reaches the grains", () => {
  const synth = engine({ ...WET, grainLookback: 700, grainScatter: 0 });
  render(synth, 4.1);
  synth.noteOn("tap", 60); render(synth, .1); synth.noteOff("tap");
  synth.panic();
  synth.setSettings({ grainLookback: 300, grainDensity: 80 });
  assert.equal(energy(render(synth, 1.5)), 0);
  assert.equal(synth.snapshot().grains.length, 0);
  synth.noteOn("fresh", 60); render(synth, .1); synth.noteOff("fresh");
  assert.ok(energy(render(synth, .7)) > .01, "a fresh intentional note restores delayed grains");
});

test("long look-back grains cannot read newly overwritten audio before their delay", () => {
  for (const grainReverse of [0, 1]) {
    const synth = engine({ ...WET, grainLookback: 3000, grainScatter: 1000, grainSize: 500, grainDensity: 80, grainPitch: -24, grainReverse });
    render(synth, 4.1);
    synth.noteOn("tap", 60);
    assert.equal(energy(render(synth, .1)), 0);
    synth.noteOff("tap");
    assert.equal(energy(render(synth, 1.8)), 0, "the earliest requested history is two seconds old");
    assert.ok(energy(render(synth, 3)) > .01, "the recorded note eventually reaches the old readheads");
    assert.equal(energy(render(synth, .6)), 0, "the delayed cloud still finishes naturally");
  }
});

test("file grains need note gates, release bounded tails, and ignore live Freeze", () => {
  const synth = fileEngine({ grainFreeze: true });
  assert.equal(energy(render(synth, 0.2)), 0);
  synth.noteOn("sample", 60);
  assert.ok(energy(render(synth, 0.3)) > 1);
  assert.equal(synth.snapshot().grainFrozen, false);
  synth.noteOff("sample");
  assert.ok(energy(render(synth, 0.05)) > 0, "existing Hann grains finish their tail");
  render(synth, 0.1);
  assert.equal(energy(render(synth, 0.1)), 0);
  assert.equal(synth.snapshot().grains.length, 0);
});

test("Freeze holds captured audio after release, unfreeze ends the latch, and Silence cancels it", () => {
  const synth = engine(WET);
  synth.noteOn("capture", 57);
  render(synth, 0.25);
  synth.setSettings({ grainFreeze: true });
  const captured = synth.granular.live.slice();
  const writes = synth.granular.writes;
  synth.noteOff("capture");
  assert.ok(energy(render(synth, 0.4)) > 1);
  assert.deepEqual(synth.granular.live, captured);
  assert.equal(synth.granular.writes, writes);
  assert.equal(synth.snapshot().grainFrozen, true);
  synth.setSettings({ grainFreeze: false });
  render(synth, 0.15);
  assert.equal(energy(render(synth, 0.1)), 0, "unfreezing without a gate ends new grains");
  synth.noteOn("capture-again", 57); render(synth, 0.2);
  synth.setSettings({ grainFreeze: true });
  synth.noteOff("capture-again"); render(synth, 0.05);
  synth.panic();
  const fade = render(synth, 0.02);
  assert.ok(energy(fade.map(ch => ch.slice(0, Math.round(RATE * 0.006)))) > 0);
  assert.equal(energy(fade.map(ch => ch.slice(Math.round(RATE * 0.006)))), 0);
  synth.setSettings({ grainFreeze: false }); synth.setSettings({ grainFreeze: true, grainDensity: 80 });
  assert.equal(energy(render(synth, 0.2)), 0, "settings and Freeze cannot undo Silence");
  synth.noteOn("fresh", 60);
  assert.ok(energy(render(synth, 0.2)) > 1, "a new intentional note releases the Silence latch");
});

test("live capture wraps at four seconds and old silence cannot be frozen as ready audio", () => {
  const synth = engine();
  synth.noteOn("short", 57); render(synth, 0.02); synth.panic();
  render(synth, 4.1);
  assert.equal(synth.granular.live.length, RATE * 4);
  assert.equal(synth.snapshot().grainBufferDuration, 4);
  assert.equal(synth.snapshot().grainBufferReady, false);
});

test("per-grain patterns visit every speaker and stationary grains do not orbit", () => {
  for (const grainPattern of ["wrap", "reverse", "alternate", "scatter"]) {
    const synth = fileEngine({ grainPattern, grainSize: 500, grainDensity: 80, grainJitter: 0 });
    synth.noteOn("route", 60); render(synth, 0.095);
    const grains = synth.snapshot().grains;
    assert.equal(grains.length, 8);
    assert.deepEqual(grains.map(grain => Math.round(grain.position)).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
    const positions = new Map(grains.map(grain => [grain.id, grain.position]));
    render(synth, 0.05);
    for (const grain of synth.snapshot().grains) if (positions.has(grain.id)) assert.equal(grain.position, positions.get(grain.id));
    assert.equal(synth.snapshot().phase, 0);
  }
});

test("grains obey fractional equal-power gather, live focus and sample-clock rotation", () => {
  const synth = fileEngine({ grainSpread: 0, offset: 7.5 / 8 });
  synth.noteOn("route", 60);
  const seam = render(synth, 0.3);
  assert.ok(energy([seam[0]]) > 1);
  assert.deepEqual(seam[0], seam[7]);
  for (let speaker = 1; speaker < 7; speaker += 1) assert.equal(energy([seam[speaker]]), 0);
  synth.setSettings({ lock: 1, target: 3 });
  render(synth, 0.5);
  const focused = render(synth, 0.1);
  assert.ok(energy([focused[3]]) > 1);
  for (let speaker = 0; speaker < 16; speaker += 1) if (speaker !== 3) assert.ok(energy([focused[speaker]]) < 1e-15);
  synth.setSettings({ lock: 0, offset: 0, rotation: 0.5 });
  synth.setPhase(0); render(synth, 0.5);
  assert.ok(Math.abs(synth.phase - 0.25) < 1e-12);
  assert.ok(synth.snapshot().grains.every(grain => grain.position > 1.7 && grain.position < 2.1));
  synth.setSettings({ rotation: 0 }); synth.setPhase(0.375);
  render(synth, 0.4);
  assert.equal(synth.phase, 0.375);
  assert.ok(synth.snapshot().grains.every(grain => Math.abs(grain.position - 3) < 1e-5));
});

test("linear mixer endpoints combine without changing source loudness", () => {
  const dry = fileEngine({ granularMix: 0 });
  const wet = fileEngine({ granularMix: 1 });
  const half = fileEngine({ granularMix: 0.5 });
  for (const synth of [dry, wet, half]) synth.noteOn("mix", 60);
  const a = render(dry, 0.3); const b = render(wet, 0.3); const mixed = render(half, 0.3);
  for (let ch = 0; ch < 16; ch += 1) for (let i = 0; i < a[ch].length; i += 1) {
    assert.ok(Math.abs(mixed[ch][i] - 0.5 * (a[ch][i] + b[ch][i])) < 1e-7);
  }
  assert.ok(energy(a) > 1 && energy(b) > 1);
  wet.setSettings({ granularMix: 0 });
  const first = render(wet, 1 / RATE);
  assert.ok(wet.snapshot().granularMix > 0.99, "moving the mixer does not step the gains");
  assert.ok(energy(first) > 0);
  render(wet, 0.6);
  assert.equal(wet.snapshot().granularMix, 0);
});

test("grain shape, density, position, scatter, jitter, reverse and pitch change rendered audio", () => {
  const settings = { grainSize: 80, grainDensity: 22, grainPosition: 0.35, grainSpread: 1 };
  const reference = fileEngine(settings); reference.noteOn("file", 60);
  const baseline = render(reference, 0.4);
  for (const patch of [
    { grainSize: 250 }, { grainDensity: 55 }, { grainPosition: 0.8 }, { grainScatter: 200 },
    { grainJitter: 1 }, { grainReverse: 1 }, { grainPitch: 12 }, { grainSpread: 0 }, { grainPattern: "reverse" },
  ]) {
    const synth = fileEngine({ ...settings, ...patch }); synth.noteOn("file", 60);
    const altered = render(synth, 0.4);
    assert.ok(energy(altered) > 0.01);
    assert.ok(difference(baseline, altered) > 0.01, `${Object.keys(patch)[0]} reaches the audio`);
  }
  const live = engine(WET); const delayed = engine({ ...WET, grainLookback: 250 });
  for (const synth of [live, delayed]) {
    synth.noteOn("first", 48); render(synth, 0.4); synth.noteOff("first"); synth.noteOn("next", 67);
  }
  assert.ok(difference(render(live, 0.2), render(delayed, 0.2)) > 1, "lookback selects older live audio");
});

test("file transposition tracks the latest note relative to C4 and respects file sample rate", () => {
  const synth = fileEngine({ grainPitch: 7 }, 48000);
  synth.setGrainSource(source(44100), 44100);
  synth.noteOn("low", 48); render(synth, 0.01);
  let grain = synth.granular.grains.find(value => value.active);
  assert.ok(Math.abs(grain.increment - 2 ** (-5 / 12) * 44100 / 48000) < 1e-12);
  synth.noteOn("high", 72); render(synth, 0.03);
  grain = synth.granular.grains.filter(value => value.active).sort((a, b) => b.serial - a.serial)[0];
  assert.ok(Math.abs(grain.increment - 2 ** (19 / 12) * 44100 / 48000) < 1e-12);
});

test("sample-clock granular output is deterministic across arbitrary render boundaries", () => {
  const settings = { grainJitter: 0.85, grainScatter: 230, grainReverse: 0.5, grainPattern: "scatter", rotation: -0.18, counterRotate: true };
  const one = fileEngine(settings); const many = fileEngine(settings);
  for (const synth of [one, many]) synth.noteOn("clock", 63);
  const expected = render(one, 0.4);
  const actual = expected.map(channel => new Float32Array(channel.length));
  let offset = 0;
  for (const frames of [1, 31, 128, 3, 800, 99, 64, 13, 2061]) {
    const piece = render(many, frames / RATE);
    piece.forEach((channel, index) => actual[index].set(channel, offset));
    offset += frames;
  }
  assert.equal(offset, expected[0].length);
  assert.deepEqual(actual, expected);
  assert.deepEqual(many.snapshot(), one.snapshot());
});

test("dense hostile states, live topology edits and source replacement remain bounded", () => {
  for (const sampleRate of [8000, 44100, 48000, 192000]) {
    const synth = fileEngine({
      partials: 32, granularMix: 0.5, grainSize: 500, grainDensity: 80, grainJitter: 1,
      grainPitch: 24, grainScatter: 1000, grainReverse: 0.5, lock: 1, target: 0,
    }, sampleRate);
    synth.setGrainSource(Float32Array.from({ length: 100 }, (_, i) => i % 2 ? -2 : 2), 192000);
    for (let i = 0; i < 12; i += 1) synth.noteOn(i, 127 - i);
    render(synth, 0.08);
    synth.setSettings({ speakerCount: 4, target: 3, lock: 0, offset: 0.99, rotation: 2 });
    render(synth, 0.08);
    assert.ok(synth.snapshot().grains.length <= SPARTIAL_MAX_GRAINS);
    synth.setGrainSource(source(), RATE); render(synth, 0.01);
    synth.clearGrainSource(); synth.panic(); render(synth, 0.02);
    assert.equal(energy(render(synth, 0.01)), 0);
  }
});


test("worklet adopts transferred file bytes without scanning/copying and rejects invalid bounds", () => {
  const synth = engine({ ...WET, granularSource: "file" });
  const samples = source();
  assert.equal(synth.adoptGrainSource(samples, RATE), true);
  assert.equal(synth.granular.file, samples, "transferred bytes become owned data without a render-thread allocation");
  assert.equal(synth.adoptGrainSource(new Float32Array(RATE * 21), RATE), false);
  assert.equal(synth.adoptGrainSource(samples, NaN), false);
  assert.equal(synth.adoptGrainSource(samples, 0), false);
  assert.equal(synth.adoptGrainSource([], RATE), false);
  assert.equal(synth.granular.file, samples);
  synth.noteOn("file", 60);
  assert.ok(energy(render(synth, 0.3)) > 0);
  assert.equal(synth.adoptGrainSource(Float32Array.of(Infinity, NaN, 5, -5), RATE), true);
  assert.ok(energy(render(synth, 0.2)) >= 0, "per-read guards bound malformed messages without scanning on import");
});


test("coherent jitter bursts stay bounded after the real sixteen-speaker stereo fold", () => {
  const rate = 48000;
  const synth = engine({
    granularMix: 1, granularSource: "file", grainSize: 50, grainDensity: 80,
    grainJitter: 1, grainScatter: 0, grainSpread: 1, speakerCount: 16,
    seed: 20, offset: 0.03125, lock: 0,
  }, rate);
  synth.setGrainSource(new Float32Array(rate).fill(1), rate);
  synth.noteOn("coherent-file", 60, 1);
  const output = render(synth, 2);
  const pans = spartialSpeakers(spartialLayout("16-ring")).map(speakerPan);
  let peak = 0;
  for (let frame = 0; frame < output[0].length; frame += 1) {
    let left = 0; let right = 0; let total = 0;
    for (let ch = 0; ch < output.length; ch += 1) {
      left += output[ch][frame] * Math.cos((pans[ch] + 1) * Math.PI / 4) * 0.7;
      right += output[ch][frame] * Math.sin((pans[ch] + 1) * Math.PI / 4) * 0.7;
      total += Math.abs(output[ch][frame]);
    }
    assert.ok(total <= 0.72 * Math.SQRT2 + 1e-6, "the whole surround bus obeys the fold-down bound");
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
  }
  assert.ok(peak > .1, "the test measures an audible burst");
  assert.ok(peak < .72, `stereo preview does not clip: ${peak}`);
});

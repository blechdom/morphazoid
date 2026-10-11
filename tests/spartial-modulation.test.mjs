import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SpartialEngine, sanitizeSpartialSettings } from "../src/instruments/spartial/spartial.js";

const base = { partials: 8, cascade: 0, attack: 0.002, release: 0.025, level: 0.8 };
function render(engine, frames) {
  const channels = Array.from({ length: 16 }, () => new Float32Array(frames));
  engine.render(channels);
  for (const channel of channels) for (const sample of channel) {
    assert.ok(Number.isFinite(sample)); assert.ok(Math.abs(sample) <= 0.720001);
  }
  return channels;
}
const energy = channel => channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length;
function amplitude(channel, frequency, rate = 8000) {
  let real = 0, imaginary = 0;
  channel.forEach((sample, frame) => {
    real += sample * Math.cos(2 * Math.PI * frequency * frame / rate);
    imaginary += sample * Math.sin(2 * Math.PI * frequency * frame / rate);
  });
  return 2 * Math.hypot(real, imaginary) / channel.length;
}

test("new effects bypass preserves the pre-organ additive and granular PCM exactly", () => {
  // Captured from a7c885bf before adding modulation/organ/effects, on the same
  // deterministic sample-clock scenarios. No UI or real-time clock involved.
  const cases = [
    [{}, "4126d16b455a9295bdfd29fed7274680690fb12ed8bd5a71b39c014b9b76087f"],
    [{ partials: 32, cascade: 0, rotation: 0.2, granularMix: 0.7, seed: 917 }, "0698e0b94e68c0ee6fef1a5b056fbb170b9ac0ce2fa2421d8b87fd31b06706e0"],
    [{ partials: 8, lock: 1, target: 3, level: 0.37 }, "343261a782a333adb3268d86946832d82bb5d8a43584ee9205ff571adad10848"],
  ];
  for (const [settings, expected] of cases) {
    const engine = new SpartialEngine({ sampleRate: 8000, settings });
    engine.noteOn("one", 57, 0.8); engine.noteOn("two", 64, 0.6);
    const first = render(engine, 2400); engine.noteOff("one");
    const second = render(engine, 1600);
    const hash = createHash("sha256");
    for (const channel of [...first, ...second]) hash.update(new Uint8Array(channel.buffer));
    assert.equal(hash.digest("hex"), expected);
  }
});

test("modulation sanitizes controls and zero ripple locks all partial phases together", () => {
  const safe = sanitizeSpartialSettings({ pitchDepth: 999, amplitudeDepth: -1, modulationRate: 0,
    modulationRipple: -99, modulationShape: "wrong" });
  assert.equal(safe.pitchDepth, 200); assert.equal(safe.amplitudeDepth, 0);
  assert.equal(safe.modulationRate, 0.05); assert.equal(safe.modulationRipple, -4);
  assert.equal(safe.modulationShape, "sine");
  const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, pitchDepth: 80, amplitudeDepth: 0.6 } });
  engine.noteOn("tone", 57); render(engine, 901);
  const snapshot = engine.snapshot();
  assert.ok(Math.abs(snapshot.modulationPhase - 901 * 5 / 8000) < 1e-10);
  for (const key of ["modulationValues", "pitchCents", "amplitudeGains"]) {
    assert.equal(new Set(snapshot[key]).size, 1, `${key} stays coherent across the bank`);
  }
});

test("ripple sign reverses phase progression without restarting its clock or voices", () => {
  const settings = { ...base, partials: 9, pitchDepth: 100, amplitudeDepth: 0.8, modulationRate: 2 };
  const positive = new SpartialEngine({ sampleRate: 8000, settings: { ...settings, modulationRipple: 1 } });
  const negative = new SpartialEngine({ sampleRate: 8000, settings: { ...settings, modulationRipple: -1 } });
  const a = positive.snapshot().modulationValues, b = negative.snapshot().modulationValues;
  assert.ok(a[2] < -0.99 && b[2] > 0.99);
  assert.ok(a[6] > 0.99 && b[6] < -0.99);
  positive.noteOn("held", 57); render(positive, 500);
  const phase = positive.modulationPhase, oscillator = positive.voices[0].phases[0];
  positive.setSettings({ modulationRipple: -1, modulationRate: 12, pitchDepth: 200, modulationShape: "triangle" });
  assert.equal(positive.modulationPhase, phase);
  assert.equal(positive.voices[0].phases[0], oscillator);
  assert.equal(positive.voices[0].id, "held");
  render(positive, 4000);
  assert.ok(positive.modulationRate > 11.99 && positive.modulationRipple < -0.99);
  assert.ok(positive.snapshot().pitchCents.every(value => Math.abs(value) <= 200.00001));
  assert.ok(positive.snapshot().amplitudeGains.every(value => value >= 0.19999 && value <= 1.00001));
});

test("pitch and amplitude modulation audibly affect independent destinations", () => {
  const buffers = {};
  for (const [name, patch] of [["dry", {}], ["pitch", { pitchDepth: 100 }], ["amplitude", { amplitudeDepth: 1 }]]) {
    const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, partials: 1, modulationRate: 5, ...patch } });
    engine.noteOn("tone", 57); render(engine, 800);
    buffers[name] = render(engine, 3200)[0];
  }
  assert.ok(amplitude(buffers.pitch, 225) > amplitude(buffers.dry, 225) + 0.01, "vibrato creates sidebands");
  assert.ok(energy(buffers.amplitude) < energy(buffers.dry) * 0.5, "tremolo attenuates between peaks");
  assert.ok(amplitude(buffers.amplitude, 220) > 0.1, "tremolo retains the played pitch");
  assert.notDeepEqual(buffers.pitch, buffers.amplitude);
});

test("maximum pitch/ripple depth remains Nyquist-safe across held notes and live edits", () => {
  const engine = new SpartialEngine({ sampleRate: 8000, settings: { ...base, partials: 32, pitchDepth: 200,
    modulationRate: 20, modulationRipple: 4, amplitudeDepth: 1, modulationShape: "triangle" } });
  for (let index = 0; index < 8; index += 1) engine.noteOn(index, 80 + index * 4);
  render(engine, 2500);
  engine.setSettings({ stretch: 2, inharmonicity: 1, modulationRipple: -4 }); render(engine, 2500);
  for (const voice of engine.voices) assert.ok(voice.phases.every(phase => phase >= 0 && phase < 2 * Math.PI));
  engine.panic(); const tail = render(engine, 800);
  assert.ok(tail.every(channel => energy(channel.slice(400)) === 0));
});

test("modulation, rotary, drive and organ articulation are invariant to render block size", () => {
  const settings = { ...base, organMode: "pipe", pipeTone: "reed", rolloff: 0, partials: 32,
    pitchDepth: 35, amplitudeDepth: 0.4, modulationRipple: -1.5, rotaryMode: "fast", rotaryRamp: 0.2,
    drive: 0.6, keyClick: 0.5, pipeChiff: 0.7, organPercussion: "third", granularMix: 0.4 };
  const full = new SpartialEngine({ sampleRate: 8000, settings }), chunked = new SpartialEngine({ sampleRate: 8000, settings });
  for (const engine of [full, chunked]) { engine.noteOn("one", 57); engine.noteOn("two", 64); }
  const expected = render(full, 4000), actual = Array.from({ length: 16 }, () => new Float32Array(4000));
  for (let offset = 0; offset < 4000;) {
    const size = Math.min([1, 17, 128, 511][offset % 4], 4000 - offset);
    render(chunked, size).forEach((channel, index) => actual[index].set(channel, offset)); offset += size;
  }
  assert.deepEqual(actual, expected);
  assert.deepEqual(chunked.snapshot(), full.snapshot());
});

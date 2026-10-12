import assert from "node:assert/strict";
import test from "node:test";
import { SpartialEngine } from "../src/instruments/spartial/spartial.js";

const sampleRate = 48000;
const base = { cascade: 0, attack: .002, release: .025, rolloff: 0, level: .6,
  gains: [1, ...Array(31).fill(0)], rotaryMode: "off" };
function render(engine, frames = 4800) {
  const channels = Array.from({ length: 16 }, () => new Float32Array(frames));
  engine.render(channels);
  for (const channel of channels) for (const sample of channel) {
    assert.ok(Number.isFinite(sample)); assert.ok(Math.abs(sample) <= .720001);
  }
  return channels;
}
const rms = channel => Math.sqrt(channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length);
function harmonic(channel, multiple) {
  let real = 0, imaginary = 0;
  channel.forEach((sample, frame) => {
    const phase = 2 * Math.PI * 220 * multiple * frame / sampleRate;
    real += sample * Math.cos(phase); imaginary += sample * Math.sin(phase);
  });
  return 2 * Math.hypot(real, imaginary) / channel.length;
}
function tone(settings) {
  const engine = new SpartialEngine({ sampleRate, settings: { ...base, ...settings } });
  engine.noteOn("held", 57, .8); render(engine);
  return { engine, channels: render(engine) };
}
const loudest = channels => channels.reduce((best, channel) => rms(channel) > rms(best) ? channel : best);

test("Drive adds increasing harmonics to quiet distributed partials and focused tones without a level collapse", () => {
  // Previously the 32-slot tone at full Drive had only ~0.13% H3; the
  // full-scale tone distorted but lost ~8 dB. Both must have useful color.
  for (const partials of [1, 32]) for (const speakerCount of [4, 8, 16]) {
    const takes = [0, .5, 1].map(drive => loudest(tone({ partials, speakerCount,
      offset: .065, lock: partials === 1 ? 1 : 0, drive }).channels));
    const thirds = takes.map(channel => harmonic(channel, 3) / harmonic(channel, 1));
    assert.ok(thirds[0] < 1e-5);
    assert.ok(thirds[1] > .08, `Drive midpoint must change timbre at ${partials} partials / ${speakerCount} speakers`);
    assert.ok(thirds[2] > .2 && thirds[2] > thirds[1] * 1.4);
    for (const take of takes.slice(1)) {
      const changeDb = 20 * Math.log10(rms(take) / rms(takes[0]));
      assert.ok(Math.abs(changeDb) < 2, `isolated tone changes only ${changeDb} dB`);
    }
  }
});

test("Drive preserves partial attenuation, independent speaker outputs, and master volume", () => {
  for (const drive of [.5, 1]) {
    const full = tone({ partials: 1, drive, lock: 1, target: 5 }).channels;
    const quiet = tone({ partials: 1, drive, lock: 1, target: 5, gains: [.25, ...Array(31).fill(0)] }).channels;
    const master = tone({ partials: 1, drive, lock: 1, target: 5, level: .15 }).channels;
    for (let frame = 0; frame < full[5].length; frame += 1) {
      assert.ok(Math.abs(quiet[5][frame] - full[5][frame] * .25) < 1e-7);
      assert.ok(Math.abs(master[5][frame] - full[5][frame] * .25) < 1e-7);
    }
    full.forEach((channel, index) => { if (index !== 5) assert.equal(rms(channel), 0); });
  }
});

test("Drive colors both live and file grains with Rotary off, then honors master silence", () => {
  for (const granularSource of ["additive", "file"]) {
    const takes = [];
    for (const drive of [0, 1]) {
      const engine = new SpartialEngine({ sampleRate, settings: { ...base, partials: 32,
        granularMix: 1, granularSource, grainDensity: 20, grainSize: 100,
        grainLookback: 100, grainScatter: 0, grainJitter: 0, grainSpread: 0, lock: 1, drive } });
      if (granularSource === "file") engine.setGrainSource(
        Float32Array.from({ length: 48000 }, (_, frame) => .025 * Math.sin(2 * Math.PI * 220 * frame / sampleRate)), sampleRate);
      engine.noteOn("grain", granularSource === "file" ? 60 : 57, .8);
      render(engine, 24000);
      takes.push(render(engine)[0]);
      assert.equal(engine.settings.rotaryMode, "off");
      engine.setSettings({ level: 0 }); render(engine, 24000);
      assert.ok(render(engine).every(channel => rms(channel) === 0));
    }
    const dryThird = harmonic(takes[0], 3) / harmonic(takes[0], 1);
    const drivenThird = harmonic(takes[1], 3) / harmonic(takes[1], 1);
    assert.ok(rms(takes[1]) > .001);
    assert.ok(drivenThird > .08 && drivenThird > dryThird * 4, `${granularSource} grains gain harmonics: ${dryThird} → ${drivenThird}`);
  }
});

test("live Drive edits preserve note phase, return to exact bypass and leave no tail after release", () => {
  const active = new SpartialEngine({ sampleRate, settings: { ...base, partials: 32 } });
  const dry = new SpartialEngine({ sampleRate, settings: { ...base, partials: 32 } });
  for (const engine of [active, dry]) { engine.noteOn("held", 57, .8); render(engine); }
  for (const drive of [1, 0, .5, 0]) {
    const phase = active.voices[0].phases[0];
    active.setSettings({ drive });
    assert.equal(active.voices[0].phases[0], phase);
    render(active, 24000); render(dry, 24000);
    const edited = render(active), reference = render(dry);
    assert.equal(active.snapshot().voices, 1);
    assert.equal(active.voices[0].id, "held");
    if (drive === 0) assert.deepEqual(edited, reference);
  }
  active.setSettings({ drive: 1 }); render(active);
  active.noteOff("held"); render(active, 9600);
  assert.ok(render(active).every(channel => rms(channel) === 0));
  assert.equal(active.snapshot().voices, 0);
});

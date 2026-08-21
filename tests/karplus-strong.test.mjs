import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  KARPLUS_STRONG_DEFAULTS,
  KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS,
  KARPLUS_STRONG_PRESETS,
  KARPLUS_STRONG_TUNING_DEFAULTS,
  KARPLUS_STRONG_TUNING_LIMITS,
  KarplusStrongAudio,
  generateKarplusStrongSamples,
  karplusStrongStringFrequencies,
  karplusStrongDelayLength,
  midiNoteFrequency,
  midiNoteName,
  nearestKarplusStrongStringIndex,
  sanitizeKarplusStrongSettings,
  sanitizeKarplusStrongTuning,
} from "../src/karplus-strong.js";

const root = new URL("../", import.meta.url);

function seededRandom(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function rms(samples, start, length) {
  let sum = 0;
  let count = 0;
  const end = Math.min(samples.length, start + length);
  for (let index = Math.max(0, start); index < end; index += 1) {
    sum += samples[index] * samples[index];
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

test("Karplus Strong settings, MIDI notes, and delay tuning are bounded", () => {
  const settings = sanitizeKarplusStrongSettings({
    frequency: Infinity,
    decay: -2,
    damping: 8,
    brightness: -3,
    excitationColor: 9,
    excitationShape: -2,
    burstLength: 12,
    pickPosition: 4,
    pickWidth: -4,
    detune: 90,
    dispersion: NaN,
    polarity: -4,
    lowCut: 2,
    drive: -1,
    chorusDepth: 3,
    chorusRate: 20,
    roughness: -2,
    pickupPosition: 0,
    pickupMix: 5,
    body: 2,
    bodyTune: 20,
    bodyQ: 0,
    coupling: -1,
    couplingRatio: 9,
    couplingDetune: -90,
    spread: 5,
    level: 4,
  });
  assert.equal(settings.frequency, KARPLUS_STRONG_DEFAULTS.frequency);
  assert.equal(settings.decay, .2);
  assert.equal(settings.damping, 1);
  assert.equal(settings.brightness, 0);
  assert.equal(settings.excitationColor, 1);
  assert.equal(settings.excitationShape, 0);
  assert.equal(settings.burstLength, 4);
  assert.equal(settings.pickPosition, .96);
  assert.equal(settings.pickWidth, 0);
  assert.equal(settings.detune, 50);
  assert.equal(settings.dispersion, KARPLUS_STRONG_DEFAULTS.dispersion);
  assert.equal(settings.polarity, -1);
  assert.equal(settings.lowCut, 1);
  assert.equal(settings.drive, 0);
  assert.equal(settings.chorusDepth, 1);
  assert.equal(settings.chorusRate, 8);
  assert.equal(settings.roughness, 0);
  assert.equal(settings.pickupPosition, .04);
  assert.equal(settings.pickupMix, 1);
  assert.equal(settings.body, 1);
  assert.equal(settings.bodyTune, 8);
  assert.equal(settings.bodyQ, .2);
  assert.equal(settings.coupling, 0);
  assert.equal(settings.couplingRatio, 4);
  assert.equal(settings.couplingDetune, -50);
  assert.equal(settings.spread, 1);
  assert.equal(settings.level, .85);

  assert.equal(midiNoteName(60), "C4");
  assert.equal(midiNoteName(69), "A4");
  assert.ok(Math.abs(midiNoteFrequency(69) - 440) < 1e-12);
  assert.equal(sanitizeKarplusStrongSettings({ frequency: 20_000 }).frequency, 16_000);
  assert.equal(sanitizeKarplusStrongSettings({ decay: 99 }).decay, 16);
  assert.ok(Math.abs(karplusStrongDelayLength(48_000, 110, 0) - 48_000 / 110) < 1e-12);
  assert.ok(karplusStrongDelayLength(48_000, 220) < karplusStrongDelayLength(48_000, 110));
});

test("Karplus Strong tuning builds equal-octave and equal-Hz string fields", () => {
  const defaults = karplusStrongStringFrequencies(KARPLUS_STRONG_TUNING_DEFAULTS);
  assert.equal(defaults.length, 16);
  const semitoneRatio = 2 ** (1 / 12);
  for (let index = 1; index < defaults.length; index += 1) {
    assert.ok(Math.abs(defaults[index] / defaults[index - 1] - semitoneRatio) < 1e-12);
  }

  const octaveField = karplusStrongStringFrequencies({
    lowFrequency: 100,
    highFrequency: 800,
    divisionsPerOctave: 4,
    spacing: "octave",
  });
  assert.equal(octaveField.length, 13);
  assert.ok(Math.abs(octaveField[0] - 100) < 1e-10);
  assert.ok(Math.abs(octaveField[4] - 200) < 1e-10);
  assert.ok(Math.abs(octaveField[8] - 400) < 1e-10);
  assert.ok(Math.abs(octaveField[12] - 800) < 1e-10);

  const hzField = karplusStrongStringFrequencies({
    lowFrequency: 100,
    highFrequency: 800,
    divisionsPerOctave: 4,
    spacing: "equal-hz",
  });
  assert.equal(hzField.length, octaveField.length);
  assert.equal(hzField[0], 100);
  assert.equal(hzField.at(-1), 800);
  const hzStep = hzField[1] - hzField[0];
  for (let index = 2; index < hzField.length; index += 1) {
    assert.ok(Math.abs(hzField[index] - hzField[index - 1] - hzStep) < 1e-10);
  }
});

test("Karplus Strong tuning input and string density stay bounded", () => {
  const sanitized = sanitizeKarplusStrongTuning({
    lowFrequency: -30,
    highFrequency: Infinity,
    divisionsPerOctave: 900,
    spacing: "unknown",
  });
  assert.equal(sanitized.lowFrequency, KARPLUS_STRONG_TUNING_LIMITS.minimumFrequency);
  assert.equal(sanitized.highFrequency, KARPLUS_STRONG_TUNING_DEFAULTS.highFrequency);
  assert.equal(sanitized.divisionsPerOctave, KARPLUS_STRONG_TUNING_LIMITS.maximumDivisions);
  assert.equal(sanitized.spacing, "octave");

  const reversed = sanitizeKarplusStrongTuning({ lowFrequency: 1_000, highFrequency: 100 });
  assert.ok(reversed.highFrequency > reversed.lowFrequency);
  const dense = karplusStrongStringFrequencies({
    lowFrequency: 20,
    highFrequency: 8_000,
    divisionsPerOctave: 48,
  });
  assert.equal(dense.length, KARPLUS_STRONG_TUNING_LIMITS.maximumStrings);
  assert.ok(Math.abs(dense[0] - 20) < 1e-10);
  assert.ok(Math.abs(dense.at(-1) - 8_000) < 1e-8);
  const denseRatio = dense[1] / dense[0];
  for (let index = 2; index < dense.length; index += 1) {
    assert.ok(Math.abs(dense[index] / dense[index - 1] - denseRatio) < 1e-10);
  }
  assert.equal(nearestKarplusStrongStringIndex([100, 200, 400], 190), 1);
  assert.equal(nearestKarplusStrongStringIndex([100, 200, 400], 1_000), 2);
});

test("Karplus Strong pitch bend updates active voices and clamps to its live range", () => {
  const calls = [];
  const detune = {
    value: 0,
    cancelScheduledValues: (time) => calls.push(["cancel", time]),
    setTargetAtTime: (value, time, smoothing) => calls.push(["target", value, time, smoothing]),
    setValueAtTime: (value, time) => calls.push(["value", value, time]),
  };
  const audio = new KarplusStrongAudio({});
  audio.context = { currentTime: 2.5 };
  audio.activeVoices = [{ source: { detune } }];

  assert.equal(audio.setPitchBend(125), 125);
  assert.deepEqual(calls.at(-1), ["target", 125, 2.5, .012]);
  assert.equal(audio.setPitchBend(9_000, { immediate: true }), KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS);
  assert.deepEqual(calls.at(-1), ["value", KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS, 2.5]);
  assert.equal(audio.setPitchBend(-9_000), -KARPLUS_STRONG_PITCH_BEND_RANGE_CENTS);
});

test("generated strings are finite, bounded, deterministic, and decay", () => {
  const options = {
    sampleRate: 24_000,
    frequency: 146.83,
    duration: 2,
    decay: 1.2,
    damping: .45,
    brightness: .68,
    hardness: .6,
    pickPosition: .27,
    dispersion: .2,
  };
  const first = generateKarplusStrongSamples({ ...options, random: seededRandom(42) });
  const second = generateKarplusStrongSamples({ ...options, random: seededRandom(42) });
  assert.equal(first.length, 48_000);
  assert.deepEqual(first, second);
  assert.equal(first.every(Number.isFinite), true);
  assert.ok(Math.max(...first) <= 1);
  assert.ok(Math.min(...first) >= -1);
  assert.ok(rms(first, 0, 2_000) > rms(first, first.length - 2_000, 2_000) * 8);
});

test("extended loop controls alter the generated string state", () => {
  const common = {
    sampleRate: 12_000,
    frequency: 164.81,
    duration: .8,
    decay: 1.4,
    damping: .35,
    brightness: .7,
    hardness: .55,
    excitationColor: .65,
    excitationShape: .1,
    burstLength: 1,
    pickPosition: .28,
    pickWidth: .72,
    detune: 0,
    dispersion: .15,
    polarity: 1,
    lowCut: .08,
    drive: 0,
    chorusDepth: 0,
    chorusRate: .6,
    roughness: 0,
    pickupPosition: .72,
    pickupMix: .18,
  };
  const baseline = generateKarplusStrongSamples({ ...common, random: seededRandom(19) });
  const variants = [
    { excitationColor: .04 },
    { excitationShape: .95 },
    { burstLength: 2.6 },
    { pickWidth: .05 },
    { detune: 24 },
    { polarity: -.85 },
    { lowCut: .95 },
    { drive: .9 },
    { chorusDepth: .8, chorusRate: 3.1 },
    { roughness: .9 },
    { pickupPosition: .2, pickupMix: .92 },
  ];
  for (const variant of variants) {
    const changed = generateKarplusStrongSamples({
      ...common,
      ...variant,
      random: seededRandom(19),
    });
    let difference = 0;
    for (let index = 0; index < baseline.length; index += 1) {
      difference += Math.abs(baseline[index] - changed[index]);
    }
    assert.ok(difference / baseline.length > 1e-5, JSON.stringify(variant));
  }
});

test("decay and pick position make meaningful changes to the delay-line result", () => {
  const common = {
    sampleRate: 16_000,
    frequency: 110,
    duration: 1.5,
    damping: .35,
    brightness: .75,
    hardness: .62,
    dispersion: .16,
  };
  const short = generateKarplusStrongSamples({
    ...common,
    decay: .35,
    pickPosition: .2,
    random: seededRandom(7),
  });
  const long = generateKarplusStrongSamples({
    ...common,
    decay: 5,
    pickPosition: .2,
    random: seededRandom(7),
  });
  const centered = generateKarplusStrongSamples({
    ...common,
    decay: .35,
    pickPosition: .5,
    random: seededRandom(7),
  });
  const tailStart = short.length - 1_600;
  assert.ok(rms(long, tailStart, 1_600) > rms(short, tailStart, 1_600) * 2);
  assert.notDeepEqual(short.subarray(0, 400), centered.subarray(0, 400));
});

test("Karplus Strong presets stay distinct and complete", () => {
  assert.equal(KARPLUS_STRONG_PRESETS.length, 16);
  assert.equal(new Set(KARPLUS_STRONG_PRESETS.map(({ id }) => id)).size, 16);
  for (const item of KARPLUS_STRONG_PRESETS) {
    assert.ok(item.name.length > 4);
    assert.deepEqual(
      Object.keys(item.settings).sort(),
      Object.keys(KARPLUS_STRONG_DEFAULTS).sort(),
    );
  }
});

test("Karplus Strong page exposes a standalone playable instrument", async () => {
  const [html, css, app, source] = await Promise.all([
    readFile(new URL("karplus-strong.html", root), "utf8"),
    readFile(new URL("karplus-strong.css", root), "utf8"),
    readFile(new URL("karplus-strong-app.js", root), "utf8"),
    readFile(new URL("src/karplus-strong.js", root), "utf8"),
  ]);

  assert.match(html, /<h1>Karplus Strong<\/h1>/);
  assert.match(html, /class="tab active" href="karplus-strong\.html" aria-current="page"/);
  assert.match(html, /id="stage"[^>]*data-interactive-track/);
  assert.match(html, /id="stage"[^>]*role="slider"[^>]*aria-valuetext="String 01, 130\.81 Hz"/);
  assert.match(html, /id="pluckButton"[^>]*data-primary-transport/);
  assert.match(html, /id="lowFrequency"[^>]*type="range"/);
  assert.match(html, /id="highFrequency"[^>]*type="range"/);
  assert.match(html, /id="divisionsPerOctave"[^>]*type="range"[^>]*step="1"/);
  assert.match(html, /id="lowFrequencyOut"[^>]*for="lowFrequency"/);
  assert.match(html, /id="highFrequencyOut"[^>]*for="highFrequency"/);
  assert.match(html, /id="divisionsPerOctaveOut"[^>]*for="divisionsPerOctave"/);
  assert.doesNotMatch(
    html,
    /id="(?:lowFrequency|highFrequency|divisionsPerOctave)"[^>]*type="number"/,
  );
  assert.match(html, /id="spacingMode"[^>]*Frequency spacing/);
  assert.match(html, /id="pitchBend"[^>]*min="-200"[^>]*max="200"/);
  assert.doesNotMatch(html, /Chromatic strings|chromatic strings|id="stringGrid"|id="rootNote"/);
  assert.match(html, /A tunable field of playable Karplus Strong strings/);
  assert.match(app, /Math\.floor\(x \* stringFrequencies\.length\)/);
  assert.equal((html.match(/class="ks-knob"/g) ?? []).length, 26);
  for (const id of [
    "hardness", "excitationColor", "excitationShape", "burstLength",
    "pickPosition", "pickWidth", "decay", "damping", "brightness", "detune",
    "dispersion", "polarity", "lowCut", "drive", "chorusDepth", "chorusRate",
    "roughness", "pickupPosition", "pickupMix", "body", "bodyTune", "bodyQ",
    "coupling", "couplingRatio", "couplingDetune", "spread",
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /id="decay"[^>]*max="16"/);

  assert.match(css, /\.ks-knob-dial[\s\S]*conic-gradient/);
  assert.match(css, /\.ks-tuning-sliders/);
  assert.match(css, /\.ks-tuning-slider input\[type="range"\]/);
  assert.match(css, /\.ks-bend-row/);
  assert.match(css, /\.karplus-strong-page \.shell/);
  assert.match(app, /KEY_BINDINGS\.length/);
  assert.match(app, /message\?\.type === "pitchBend"/);
  assert.match(app, /audio\.setPitchBend\(/);
  assert.match(app, /state\.detune \+ state\.pitchBendCents/);
  assert.match(app, /function frequencySliderValue\(frequency\)/);
  assert.match(app, /function frequencyFromSlider\(value\)/);
  assert.match(app, /aria-valuetext/);
  assert.match(app, /audio\.pluck\(/);
  assert.match(app, /initializeKnobs\(\)/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(source, /generateKarplusStrongSamples/);
  assert.match(source, /karplusStrongStringFrequencies/);
  assert.match(source, /setPitchBend\(cents/);
  assert.match(source, /source\.detune/);
  assert.match(source, /const readPosition = index - Math\.max/);
  assert.match(source, /settings\.excitationShape/);
  assert.match(source, /settings\.chorusDepth/);
  assert.match(source, /settings\.pickupPosition/);
  assert.match(source, /settings\.bodyTune/);
  assert.match(source, /settings\.couplingRatio/);
  assert.match(source, /connectAudioOutput/);
  assert.ok(KarplusStrongAudio);
});

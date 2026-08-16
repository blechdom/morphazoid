import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SPELLING_DIPHONE_CLIPS,
  spellingDiphoneClipKey,
} from "../src/spelling-diphone-atlas.js";

const ATLAS_URL = new URL(
  "../assets/audio/spelling-diphone-kal16.wav",
  import.meta.url,
);

const EXPECTED_UNITS = Object.freeze({
  a: ["AE", "vowel"],
  b: ["B", "consonant"],
  c: ["K", "consonant"],
  d: ["D", "consonant"],
  e: ["EH", "vowel"],
  f: ["F", "consonant"],
  g: ["G", "consonant"],
  h: ["HH", "consonant"],
  i: ["IH", "vowel"],
  j: ["JH", "consonant"],
  k: ["K", "consonant"],
  l: ["L", "liquid"],
  m: ["M", "consonant"],
  n: ["N", "consonant"],
  ng: ["NG", "consonant"],
  o: ["AA", "vowel"],
  p: ["P", "consonant"],
  q: ["K W", "cluster"],
  r: ["R", "liquid"],
  s: ["S", "consonant"],
  sh: ["SH", "consonant"],
  t: ["T", "consonant"],
  th: ["TH", "consonant"],
  dh: ["DH", "consonant"],
  u: ["AH", "vowel"],
  v: ["V", "consonant"],
  w: ["W", "consonant"],
  x: ["K S", "consonant"],
  y: ["Y", "consonant"],
  z: ["Z", "consonant"],
  ch: ["CH", "consonant"],
  ai: ["EY", "glide"],
  au: ["AO", "vowel"],
  ei: ["EY", "glide"],
  oi: ["OY", "glide"],
  ou: ["AW", "glide"],
  ee: ["IY", "vowel"],
  oo: ["UW", "vowel"],
  oa: ["OW", "glide"],
  ay: ["AY", "glide"],
  er: ["ER", "vowel"],
  uh: ["UH", "vowel"],
  zh: ["ZH", "consonant"],
});

const EXPECTED_PAIR_ROUTES = Object.freeze({
  th: "th",
  sh: "sh",
  ch: "ch",
  ph: "f",
  ng: "ng",
  ck: "k",
  qu: "q",
  wh: "w",
  ai: "ai",
  ay: "ai",
  au: "au",
  aw: "au",
  ei: "ei",
  ey: "ei",
  oi: "oi",
  oy: "oi",
  ou: "ou",
  ow: "ou",
  ee: "ee",
  ea: "ee",
  oo: "oo",
  oa: "oa",
});

function waveData(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        encoding: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    }
    if (id === "data") data = buffer.subarray(body, body + size);
    offset = body + size + (size % 2);
  }
  assert.ok(format);
  assert.ok(data);
  return { format, data };
}

async function loadAtlas() {
  return waveData(await readFile(ATLAS_URL));
}

function clipFrames(data, sampleRate, clip) {
  const firstFrame = Math.round(clip.offset * sampleRate);
  const length = Math.round(clip.duration * sampleRate);
  return Float64Array.from({ length }, (_, index) => (
    data.readInt16LE((firstFrame + index) * 2) / 32_768
  ));
}

function loudestFrame(samples, size = 512, hop = 128) {
  assert.ok(samples.length >= size, "spectral clips need one complete analysis window");
  const finalStart = samples.length - size;
  const starts = [];
  for (let start = 0; start <= finalStart; start += hop) starts.push(start);
  if (starts.at(-1) !== finalStart) starts.push(finalStart);

  let bestStart = 0;
  let bestEnergy = -1;
  for (const start of starts) {
    let energy = 0;
    for (let index = 0; index < size; index += 1) {
      energy += samples[start + index] ** 2;
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart = start;
    }
  }
  return samples.slice(bestStart, bestStart + size);
}

function fftPower(samples) {
  const size = samples.length;
  assert.equal(size & (size - 1), 0, "FFT size must be a power of two");
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1));
    real[index] = samples[index] * window;
  }

  for (let index = 1, reverse = 0; index < size; index += 1) {
    let bit = size >> 1;
    while (reverse & bit) {
      reverse ^= bit;
      bit >>= 1;
    }
    reverse ^= bit;
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
      [imaginary[index], imaginary[reverse]] = [imaginary[reverse], imaginary[index]];
    }
  }

  for (let width = 2; width <= size; width <<= 1) {
    const angle = -2 * Math.PI / width;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < width / 2; index += 1) {
        const even = start + index;
        const odd = even + width / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }

  return Float64Array.from({ length: size / 2 + 1 }, (_, index) => (
    real[index] ** 2 + imaginary[index] ** 2
  ));
}

function spectralProfile(samples, sampleRate) {
  const frame = loudestFrame(samples);
  const power = fftPower(frame);
  let total = 0;
  let weighted = 0;
  let belowOneKhz = 0;
  let aboveThreeKhz = 0;
  for (let bin = 0; bin < power.length; bin += 1) {
    const frequency = bin * sampleRate / frame.length;
    const energy = power[bin];
    total += energy;
    weighted += frequency * energy;
    if (frequency < 1_000) belowOneKhz += energy;
    if (frequency >= 3_000) aboveThreeKhz += energy;
  }
  assert.ok(total > 0, "spectral analysis needs non-silent audio");
  return {
    centroid: weighted / total,
    lowFraction: belowOneKhz / total,
    highFraction: aboveThreeKhz / total,
  };
}

test("the atlas declares the exact English phone inventory and unit classes", () => {
  assert.equal(Object.keys(SPELLING_DIPHONE_CLIPS).length, 43);
  assert.deepEqual(
    Object.fromEntries(Object.entries(SPELLING_DIPHONE_CLIPS).map(([key, clip]) => (
      [key, [clip.phone, clip.kind]]
    ))),
    EXPECTED_UNITS,
  );

  assert.equal(SPELLING_DIPHONE_CLIPS.c.phone, "K", "single C is the hard K phone");
  assert.equal(SPELLING_DIPHONE_CLIPS.x.phone, "K S", "X retains both phones");
  assert.equal(SPELLING_DIPHONE_CLIPS.ch.phone, "CH", "CH has its own affricate unit");
  assert.notEqual(SPELLING_DIPHONE_CLIPS.ch.offset, SPELLING_DIPHONE_CLIPS.c.offset);
});

test("single letters and joined spellings select the intended atlas units", () => {
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    assert.equal(
      spellingDiphoneClipKey({ character: letter, articulation: letter }),
      letter,
      `${letter.toUpperCase()} must retain its dedicated unit`,
    );
  }

  for (const [source, expected] of Object.entries(EXPECTED_PAIR_ROUTES)) {
    assert.equal(
      spellingDiphoneClipKey({
        character: source,
        articulation: source[0],
        pair: { kind: "joined spelling" },
        pairStepIndex: 0,
      }),
      expected,
      `${source.toUpperCase()} must select ${expected}`,
    );
  }
  assert.equal(
    spellingDiphoneClipKey({
      character: "qu",
      articulation: "w",
      pair: { kind: "joined spelling" },
      pairStepIndex: 1,
    }),
    "",
    "the second gesture of a joined sample must not trigger it twice",
  );

  for (const key of ["ay", "er", "uh", "zh"]) {
    assert.equal(
      spellingDiphoneClipKey({
        character: "ignored",
        articulation: "ignored",
        sampleKey: key.toUpperCase(),
      }),
      key,
      `${key.toUpperCase()} must be directly addressable by pronunciation phones`,
    );
  }
});

test("the 10.977-second KAL16 atlas has bounded, calibrated, separated clips", async () => {
  const { format, data } = await loadAtlas();
  assert.deepEqual(format, {
    encoding: 1,
    channels: 1,
    sampleRate: 16_000,
    bits: 16,
  });

  const frameCount = data.length / 2;
  assert.equal(frameCount, 175_635);
  assert.equal(frameCount / format.sampleRate, 10.9771875);

  let previousEnd = 0;
  let coveredFrames = 0;
  for (const [key, clip] of Object.entries(SPELLING_DIPHONE_CLIPS)) {
    const firstFrame = Math.round(clip.offset * format.sampleRate);
    const length = Math.round(clip.duration * format.sampleRate);
    const end = firstFrame + length;
    assert.equal(firstFrame - previousEnd, 288, `${key} needs exactly 18 ms of guard silence`);
    assert.ok(length > 480, `${key} needs at least 30 ms of audio`);
    assert.ok(end <= frameCount, `${key} must stay inside the WAV data`);
    assert.ok(clip.gain >= 0.5 && clip.gain <= 2, `${key} makeup stays bounded`);

    for (let frame = previousEnd; frame < firstFrame; frame += 1) {
      assert.equal(data.readInt16LE(frame * 2), 0, `${key} guard must remain silent`);
    }

    let squareSum = 0;
    let peak = 0;
    for (let frame = firstFrame; frame < end; frame += 1) {
      const sample = data.readInt16LE(frame * 2) / 32_768;
      squareSum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const calibratedRms = Math.sqrt(squareSum / length) * clip.gain;
    const sustained = clip.kind === "vowel" || clip.kind === "glide";
    if (sustained) {
      assert.ok(
        calibratedRms >= 0.083 && calibratedRms <= 0.095,
        `${key} sustained calibration must remain near -21 dBFS`,
      );
    } else {
      assert.ok(
        calibratedRms >= 0.068 && calibratedRms <= 0.078,
        `${key} transition calibration must remain near -23 dBFS`,
      );
    }
    assert.ok(peak > 0.1 && peak < 1, `${key} must be audible without clipping`);
    coveredFrames += length;
    previousEnd = end;
  }

  assert.equal(frameCount - previousEnd, 288, "the atlas ends with its 18 ms guard");
  for (let frame = previousEnd; frame < frameCount; frame += 1) {
    assert.equal(data.readInt16LE(frame * 2), 0, "the trailing guard must remain silent");
  }
  assert.equal(
    coveredFrames + 288 * (Object.keys(SPELLING_DIPHONE_CLIPS).length + 1),
    frameCount,
    "clips and guards must account for every PCM frame",
  );
});

test("vowels and glides sustain while L and R remain short transitions", () => {
  const longUnits = [
    "a", "e", "i", "o", "u", "ai", "au", "ei", "oi", "ou", "ee", "oo", "oa",
    "ay", "er",
  ];
  for (const key of longUnits) {
    const { duration, kind } = SPELLING_DIPHONE_CLIPS[key];
    assert.ok(kind === "vowel" || kind === "glide", `${key} must be sustainable`);
    assert.ok(duration >= 0.39 && duration <= 0.59, `${key} must provide a long body`);
  }
  for (const key of ["a", "e", "i", "o", "u"]) {
    assert.ok(SPELLING_DIPHONE_CLIPS[key].duration >= 0.49, `${key} needs about half a second`);
  }
  assert.equal(SPELLING_DIPHONE_CLIPS.uh.phone, "UH");
  assert.equal(SPELLING_DIPHONE_CLIPS.uh.kind, "vowel");
  assert.ok(
    SPELLING_DIPHONE_CLIPS.uh.duration >= 0.3,
    "UH retains a usable sustained body even though KAL's source phone is shorter",
  );
  assert.equal(SPELLING_DIPHONE_CLIPS.zh.phone, "ZH");
  assert.equal(SPELLING_DIPHONE_CLIPS.zh.kind, "consonant");

  const liquidDurations = ["l", "r"].map((key) => {
    const clip = SPELLING_DIPHONE_CLIPS[key];
    assert.equal(clip.kind, "liquid");
    assert.ok(clip.duration >= 0.1 && clip.duration <= 0.14, `${key} must stay transitional`);
    return clip.duration;
  });
  const shortestSustain = Math.min(...longUnits.map((key) => SPELLING_DIPHONE_CLIPS[key].duration));
  assert.ok(
    Math.max(...liquidDurations) * 2.5 < shortestSustain,
    "liquid transitions must remain materially shorter than sustained units",
  );
});

test("literal vowels expose phase-aligned loop bodies for held keys", async () => {
  const { format, data } = await loadAtlas();
  const sample = (frame) => data.readInt16LE(frame * 2) / 32_768;
  for (const key of ["a", "e", "i", "o", "u"]) {
    const clip = SPELLING_DIPHONE_CLIPS[key];
    assert.ok(clip.sustainStart > 0, `${key} needs a sustain start`);
    assert.ok(clip.sustainEnd < clip.duration, `${key} loop stays inside its clip`);
    const start = Math.round((clip.offset + clip.sustainStart) * format.sampleRate);
    const end = Math.round((clip.offset + clip.sustainEnd) * format.sampleRate);
    assert.ok(end - start >= 480, `${key} loop spans at least three pitch periods`);
    assert.ok(end - start <= 720, `${key} loop remains in one steady vowel region`);

    const window = 160;
    const windowRms = (center) => {
      let energy = 0;
      for (let frame = center - window; frame < center + window; frame += 1) {
        const value = sample(frame);
        energy += value * value;
      }
      return Math.sqrt(energy / (window * 2));
    };
    const startRms = windowRms(start);
    const endRms = windowRms(end);
    assert.ok(
      Math.abs(startRms - endRms) / Math.max(startRms, endRms) < 0.08,
      `${key} loop endpoints need similar energy`,
    );

    let derivativeEnergy = 0;
    for (let frame = start + 1; frame < end; frame += 1) {
      const derivative = sample(frame) - sample(frame - 1);
      derivativeEnergy += derivative * derivative;
    }
    const derivativeRms = Math.sqrt(derivativeEnergy / Math.max(1, end - start - 1));
    const seamStep = Math.abs(sample(start) - sample(end - 1));
    assert.ok(
      seamStep < derivativeRms * 0.12,
      `${key} hard loop seam stays below ordinary waveform derivatives`,
    );
  }
});

test("broad spectra retain vowel, nasal, fricative, and affricate identities", async () => {
  const { format, data } = await loadAtlas();
  const profiles = new Map();
  const profile = (key) => {
    if (!profiles.has(key)) {
      profiles.set(key, spectralProfile(
        clipFrames(data, format.sampleRate, SPELLING_DIPHONE_CLIPS[key]),
        format.sampleRate,
      ));
    }
    return profiles.get(key);
  };

  for (const [key, clip] of Object.entries(SPELLING_DIPHONE_CLIPS)) {
    if (clip.kind !== "vowel" && clip.kind !== "glide") continue;
    assert.ok(profile(key).centroid < 1_300, `${key} must remain resonant rather than noisy`);
    assert.ok(profile(key).highFraction < 0.15, `${key} must keep little energy above 3 kHz`);
  }

  for (const key of ["m", "n"]) {
    assert.ok(profile(key).centroid < 350, `${key} must retain its low nasal spectrum`);
    assert.ok(profile(key).lowFraction > 0.95, `${key} must concentrate energy below 1 kHz`);
  }

  for (const key of ["s", "z", "x"]) {
    assert.ok(profile(key).centroid > 4_000, `${key} must retain high sibilant energy`);
    assert.ok(profile(key).highFraction > 0.8, `${key} must concentrate energy above 3 kHz`);
  }
  assert.ok(profile("sh").centroid > 2_800 && profile("sh").centroid < 4_200);
  assert.ok(profile("sh").highFraction > 0.45 && profile("sh").highFraction < 0.8);
  assert.ok(profile("zh").centroid > 2_800 && profile("zh").centroid < 4_200);
  assert.ok(profile("zh").highFraction > 0.4 && profile("zh").highFraction < 0.7);
  assert.ok(profile("s").centroid > profile("sh").centroid);
  assert.ok(profile("sh").centroid > profile("f").centroid);

  for (const key of ["f", "th"]) {
    assert.ok(profile(key).centroid > 2_300, `${key} must retain broadband frication`);
    assert.ok(profile(key).highFraction > 0.3, `${key} needs material energy above 3 kHz`);
  }
  for (const key of ["ch", "j"]) {
    assert.ok(
      profile(key).centroid > 2_200 && profile(key).centroid < 3_600,
      `${key} must retain its mid-frequency affrication`,
    );
    assert.ok(profile(key).lowFraction < 0.08, `${key} must not collapse into a vowel`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  SPARTIAL_ORGAN_DEFAULTS, SPARTIAL_ORGAN_PARTIALS, SPARTIAL_ORGAN_PRESETS,
  SPARTIAL_ORGAN_STOPS, SPARTIAL_PIPE_TONES,
  randomOrganRegistration, sanitizeOrganSettings, writeOrganSpectrum,
} from "../src/instruments/spartial/spartial-organ.js";

const allOff = () => Array(9).fill(0);
const spectrum = settings => writeOrganSpectrum(settings, new Float64Array(32));
const sum = values => values.reduce((total, value) => total + value, 0);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual} versus ${expected}`);

test("nine footage drawbars occupy the correct frequencies, including the octave below played pitch", () => {
  const ratios = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8];
  const slots = [1, 3, 2, 4, 6, 8, 10, 12, 16];
  assert.equal(SPARTIAL_ORGAN_PARTIALS, 32);
  assert.deepEqual(SPARTIAL_ORGAN_STOPS.map(stop => stop.ratio), ratios);
  assert.deepEqual(SPARTIAL_ORGAN_STOPS.map(stop => stop.partial), slots);
  for (let index = 0; index < 9; index += 1) {
    const stops = allOff();
    stops[index] = 8;
    const weights = spectrum({ organMode: "tonewheel", organStops: stops });
    assert.equal(weights[slots[index] - 1], 1);
    assert.equal(weights.filter(Boolean).length, 1);
    // A played A4 (8′ = 440 Hz) uses 220 Hz as its 16′ spectral base.
    near(220 * slots[index], 440 * ratios[index], SPARTIAL_ORGAN_STOPS[index].label);
  }
});

test("drawbar steps change that stop's amplitude without turning up any other stop", () => {
  const full = spectrum({ organMode: "tonewheel", organStops: [8, 0, 8, 0, 0, 0, 0, 0, 0] });
  const half = spectrum({ organMode: "tonewheel", organStops: [4, 0, 8, 0, 0, 0, 0, 0, 0] });
  near(half[0], full[0] / 2, "16′ attenuation");
  assert.equal(half[1], full[1]);
  for (let level = 0; level <= 8; level += 1) {
    const stops = allOff(); stops[2] = level;
    near(sum(spectrum({ organMode: "tonewheel", organStops: stops })), level / 8, `drawbar ${level}`);
  }
});

test("all stops off is silence in both organ modes and overwrites a previous spectrum", () => {
  const target = new Float64Array(32).fill(7);
  for (const organMode of ["tonewheel", "pipe"]) {
    assert.equal(writeOrganSpectrum({ organMode, organStops: allOff() }, target), target);
    assert.deepEqual([...target], Array(32).fill(0));
    target.fill(7);
  }
  assert.deepEqual([...spectrum({ organMode: "partials" })], Array(32).fill(1));
});

test("pipe registers place every overtone on the selected stop's exact harmonic series", () => {
  for (let index = 0; index < 9; index += 1) {
    const stops = allOff(); stops[index] = 8;
    const weights = spectrum({ organMode: "pipe", organStops: stops, pipeTone: "principal" });
    const slot = SPARTIAL_ORGAN_STOPS[index].partial;
    near(sum(weights), 1, "each pipe stop has a unit amplitude budget");
    assert.ok(weights[slot - 1] > 0);
    for (let harmonic = 1; harmonic <= 32; harmonic += 1) {
      assert.equal(weights[harmonic - 1] > 0, harmonic % slot === 0, `${SPARTIAL_ORGAN_STOPS[index].label}, slot ${harmonic}`);
    }
  }
});

test("pipe families are spectrally distinct, stopped pipes suppress evens, and brightness lifts upper harmonics", () => {
  const organStops = [8, 0, 0, 0, 0, 0, 0, 0, 0];
  const families = SPARTIAL_PIPE_TONES.map(({ id }) => spectrum({ organMode: "pipe", organStops, pipeTone: id }));
  for (let first = 0; first < families.length; first += 1) {
    for (let second = first + 1; second < families.length; second += 1) {
      const distance = families[first].reduce((total, value, index) => total + Math.abs(value - families[second][index]), 0);
      assert.ok(distance > 0.1, `${SPARTIAL_PIPE_TONES[first].id} and ${SPARTIAL_PIPE_TONES[second].id} must differ`);
    }
    const tone = SPARTIAL_PIPE_TONES[first].id;
    const dark = spectrum({ organMode: "pipe", organStops, pipeTone: tone, pipeBrightness: 0 });
    const bright = spectrum({ organMode: "pipe", organStops, pipeTone: tone, pipeBrightness: 1 });
    const centroid = values => values.reduce((total, value, index) => total + value * (index + 1), 0) / sum(values);
    assert.ok(centroid(bright) > centroid(dark) * 1.2, `${tone} brightness must change its spectrum`);
  }
  const stopped = families[SPARTIAL_PIPE_TONES.findIndex(tone => tone.id === "stopped")];
  assert.ok(stopped[0] > stopped[2]);
  for (let index = 1; index < 32; index += 2) assert.equal(stopped[index], 0);
});

test("combined pipe stops add linearly before the engine's final level normalization", () => {
  const low = spectrum({ organMode: "pipe", organStops: [6, 0, 0, 0, 0, 0, 0, 0, 0], pipeTone: "reed" });
  const high = spectrum({ organMode: "pipe", organStops: [0, 0, 4, 0, 0, 0, 0, 0, 0], pipeTone: "reed" });
  const combined = spectrum({ organMode: "pipe", organStops: [6, 0, 4, 0, 0, 0, 0, 0, 0], pipeTone: "reed" });
  for (let index = 0; index < 32; index += 1) near(combined[index], low[index] + high[index], `partial ${index + 1}`);
  near(sum(combined), 10 / 8, "sum of stop budgets");
});

test("organ settings own their array, preserve omitted edits, reject invalid enums, and sanitize every stop", () => {
  const initial = sanitizeOrganSettings({ organMode: "pipe", organStops: [1, 2, 3, 4, 5, 6, 7, 8, 0], pipeTone: "reed", pipeBrightness: 0.8 });
  const patch = { organMode: "broken", organStops: [-4, 22, NaN, 3.7, Infinity, "8"], pipeTone: "invalid", pipeBrightness: NaN, level: 0 };
  const result = sanitizeOrganSettings(patch, initial);
  assert.deepEqual(result, { organMode: "pipe", organStops: [0, 8, 3, 4, 5, 6, 7, 8, 0], pipeTone: "reed", pipeBrightness: 0.8 });
  result.organStops[0] = 8;
  assert.equal(initial.organStops[0], 1);
  assert.equal(patch.organStops[0], -4);
  assert.deepEqual(sanitizeOrganSettings(null, null), SPARTIAL_ORGAN_DEFAULTS);
  assert.deepEqual(sanitizeOrganSettings({}, { organMode: null, pipeTone: null, organStops: null, pipeBrightness: Infinity }), SPARTIAL_ORGAN_DEFAULTS);
  assert.equal(sanitizeOrganSettings({ pipeBrightness: 2 }).pipeBrightness, 1);
  assert.equal(sanitizeOrganSettings({ pipeBrightness: -2 }).pipeBrightness, 0);
  assert.deepEqual(sanitizeOrganSettings({ organStops: new Float32Array(9).fill(4.6) }).organStops, Array(9).fill(5));
});

test("all supported pipe spectra remain finite and bounded at registration and brightness extremes", () => {
  for (const { id: pipeTone } of SPARTIAL_PIPE_TONES) {
    for (const pipeBrightness of [-Infinity, -1, 0, 0.5, 1, 5, NaN]) {
      for (const organMode of ["pipe", "tonewheel"]) {
        const weights = spectrum({ organMode, pipeTone, pipeBrightness, organStops: Array(9).fill(8) });
        assert.ok(weights.every(value => Number.isFinite(value) && value >= 0 && value <= 9));
        near(sum(weights), 9, `${organMode}/${pipeTone} maximum sum`);
      }
    }
  }
  assert.throws(() => writeOrganSpectrum({}, new Float64Array(16)), /32-element/);
  assert.throws(() => writeOrganSpectrum({}, Array(32).fill(0)), /32-element/);
  assert.ok(writeOrganSpectrum({}, new Float32Array(32)).every(value => value === 1));
});

test("organ section dice are deterministic, audible, bounded, and exercise every stop and pipe family", () => {
  assert.deepEqual(randomOrganRegistration(12345), randomOrganRegistration(12345));
  assert.notDeepEqual(randomOrganRegistration(12345), randomOrganRegistration(98765));
  const fields = ["organMode", "organStops", "pipeTone", "pipeBrightness"];
  const modes = new Set(); const tones = new Set(); const brightness = new Set();
  const stops = Array.from({ length: 9 }, () => new Set());
  for (let seed = 1; seed <= 1000; seed += 1) {
    const result = randomOrganRegistration(seed);
    assert.deepEqual(Object.keys(result), fields);
    assert.deepEqual(sanitizeOrganSettings(result), result);
    assert.ok(result.organStops.some(Boolean));
    assert.ok(sum(spectrum(result)) > 0);
    modes.add(result.organMode); tones.add(result.pipeTone); brightness.add(result.pipeBrightness);
    result.organStops.forEach((level, index) => stops[index].add(level));
  }
  assert.deepEqual([...modes].sort(), ["pipe", "tonewheel"]);
  assert.equal(tones.size, SPARTIAL_PIPE_TONES.length);
  assert.ok(brightness.size > 80);
  assert.ok(stops.every(levels => levels.size === 9));
});

test("original presets have distinct registrations and reset their own timbre and effect fields without transport state", () => {
  const ids = new Set(); const recipes = new Set(); const families = new Set();
  const resetFields = ["modulationRate", "pitchDepth", "amplitudeDepth", "modulationRipple", "modulationShape", "rotaryMode", "rotaryMix", "rotarySpread", "rotaryRamp", "drive", "keyClick", "pipeChiff", "organPercussion", "percussionLevel", "percussionDecay"];
  for (const preset of SPARTIAL_ORGAN_PRESETS) {
    assert.equal(ids.has(preset.id), false); ids.add(preset.id);
    assert.ok(preset.name.length > 0);
    assert.equal(preset.settings.partials, 32);
    assert.equal(preset.settings.rolloff, 0);
    assert.equal(preset.settings.cascade, 0);
    assert.ok(preset.settings.gains.every(gain => gain === 1));
    assert.ok(sum(spectrum(preset.settings)) > 0);
    assert.ok(resetFields.every(key => Object.hasOwn(preset.settings, key)));
    for (const key of ["level", "enabled", "playing", "rotation", "speakerCount", "tempo"]) assert.equal(Object.hasOwn(preset.settings, key), false);
    if (preset.settings.organMode === "pipe") families.add(preset.settings.pipeTone);
    recipes.add(JSON.stringify([...spectrum(preset.settings)]));
    assert.ok(Object.isFrozen(preset.settings.organStops));
  }
  assert.equal(recipes.size, SPARTIAL_ORGAN_PRESETS.length);
  assert.equal(families.size, SPARTIAL_PIPE_TONES.length);
});

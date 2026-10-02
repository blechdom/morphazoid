import assert from "node:assert/strict";
import test from "node:test";
import {
  THROAT_SINGING_LIMITS,
  throatSingingState,
  throatSingingTractProfile,
} from "../src/instruments/throat-singing/throat-singing.js";
import {
  LOOP_MODES,
  ORNAMENT_PATTERNS,
  PITCH_MELODIES,
  THROAT_SINGER_EXTRA_DEFAULTS,
  THROAT_SINGER_PERFORMANCE_DEFAULTS,
  THROAT_SINGER_PRESETS,
  evaluateSingerPerformance,
  randomizeSingerPreset,
  sanitizePerformanceSettings,
  sanitizeSingerExtras,
} from "../src/instruments/throat-singing/performance-patterns.js";

const seededRandom = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
const centeredState = () => throatSingingState("open-drone", {
  active: true, trueFoldHz: 140, intensity: 0.5, motionRateHz: 1, motionDepth: 0.8,
  uvularConstriction: 0.5, alveolarConstriction: 0.5, frontCavityExpansion: 0.5,
  mouthOpening: 0.5, lipRounding: 0.5, vibratoDepthCents: 0, amplitudeMotionDepth: 0,
});
const closeTo = (actual, expected, tolerance = 1e-10) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected} by more than ${tolerance}`,
);

function boundedState(state) {
  for (const [key, [low, high]] of Object.entries(THROAT_SINGING_LIMITS)) {
    assert.ok(Number.isFinite(state[key]), `${key} is finite`);
    assert.ok(state[key] >= low && state[key] <= high, `${key}=${state[key]} in ${low}–${high}`);
  }
}

test("complete frozen presets cover broad source, tract, ornament, and melody configurations", () => {
  assert.ok(THROAT_SINGER_PRESETS.length >= 24);
  assert.ok(ORNAMENT_PATTERNS.length >= 17);
  assert.ok(PITCH_MELODIES.length >= 11);
  assert.deepEqual(LOOP_MODES.map(({ id }) => id), ["off", "once", "loop", "alternate"]);
  for (const bank of [THROAT_SINGER_PRESETS, ORNAMENT_PATTERNS, PITCH_MELODIES]) {
    assert.equal(new Set(bank.map(({ id }) => id)).size, bank.length);
    assert.ok(bank.every((entry) => Object.isFrozen(entry)));
  }
  const signatures = new Set();
  for (const preset of THROAT_SINGER_PRESETS) {
    boundedState(preset.state);
    assert.equal(preset.state.active, false);
    assert.equal(preset.state.level, 0.28);
    assert.equal(Object.isFrozen(preset.snapshot.state), true);
    assert.equal("level" in preset.snapshot.state, false);
    assert.equal("active" in preset.snapshot.state, false);
    assert.deepEqual(Object.keys(preset.extras).sort(), Object.keys(THROAT_SINGER_EXTRA_DEFAULTS).sort());
    assert.deepEqual(Object.keys(preset.settings).sort(), Object.keys(THROAT_SINGER_PERFORMANCE_DEFAULTS).sort());
    const { level: _level, active: _active, ...musicalState } = preset.state;
    assert.deepEqual(preset.snapshot, { state: musicalState, extras: preset.extras, settings: preset.settings });
    signatures.add(JSON.stringify(preset.snapshot));
  }
  assert.equal(signatures.size, THROAT_SINGER_PRESETS.length);
  const states = THROAT_SINGER_PRESETS.map(({ state }) => state);
  assert.ok(Math.max(...states.map(({ trueFoldHz }) => trueFoldHz)) / Math.min(...states.map(({ trueFoldHz }) => trueFoldHz)) > 4);
  assert.ok(Math.max(...states.map(({ falseFoldDivision }) => falseFoldDivision)) >= 7);
  assert.ok(Math.max(...states.map(({ harmonicNumber }) => harmonicNumber)) >= 21);
  assert.ok(new Set(THROAT_SINGER_PRESETS.map(({ settings }) => settings.ornamentId)).size >= 17);
  assert.ok(new Set(THROAT_SINGER_PRESETS.map(({ settings }) => settings.melodyId)).size >= 11);
});

test("settings and extras sanitize invalid input with bounded defaults", () => {
  assert.deepEqual(sanitizePerformanceSettings(null), THROAT_SINGER_PERFORMANCE_DEFAULTS);
  assert.deepEqual(sanitizeSingerExtras(null), THROAT_SINGER_EXTRA_DEFAULTS);
  assert.deepEqual(sanitizePerformanceSettings({
    ornamentId: "missing", ornamentLoop: "missing", melodyId: "missing",
    melodyRateHz: Infinity, melodyDepthSemitones: -99,
  }), { ...THROAT_SINGER_PERFORMANCE_DEFAULTS, melodyDepthSemitones: 0 });
  const extras = sanitizeSingerExtras({
    sublingualCoupling: 99, phantomAirways: 2.6, pulseRate: -8,
    pulseDepth: Infinity, impossibleFocus: -5, sourceInstability: 10,
  });
  assert.deepEqual(extras, {
    sublingualCoupling: 1, phantomAirways: 3, pulseRate: 0,
    pulseDepth: 0, impossibleFocus: 0, sourceInstability: 1,
  });
});

test("each active ornament changes both source pressure and the 44-section acoustic tract", () => {
  const state = centeredState();
  const baseline = throatSingingTractProfile(state).areasCm2;
  const signatures = new Set();
  for (const ornament of ORNAMENT_PATTERNS.filter(({ id }) => id !== "none")) {
    let pressureChanged = false;
    let tractChanged = false;
    const signature = [];
    for (let index = 1; index < 64; index += 1) {
      const result = evaluateSingerPerformance(state, {}, { ornamentId: ornament.id, ornamentLoop: "loop" }, index / 64);
      boundedState(result.performance);
      pressureChanged ||= Math.abs(result.performance.sourcePressure - state.intensity) > 1e-4;
      const profile = throatSingingTractProfile(result.performance);
      tractChanged ||= profile.areasCm2.some((value, section) => Math.abs(value - baseline[section]) > 1e-3);
      signature.push(result.animation.tongue.toFixed(5), result.animation.lips.toFixed(5), result.performance.sourcePressure.toFixed(5));
    }
    assert.equal(pressureChanged, true, `${ornament.id} changes source pressure`);
    assert.equal(tractChanged, true, `${ornament.id} changes acoustic tract`);
    signatures.add(signature.join(","));
  }
  assert.equal(signatures.size, ORNAMENT_PATTERNS.length - 1, "every ornament has a distinct performance contour");
});

test("visual tongue, lips, and throat share the exact acoustic articulation", () => {
  const state = centeredState();
  for (const { id } of ORNAMENT_PATTERNS) {
    const { performance, animation } = evaluateSingerPerformance(state, {}, { ornamentId: id, ornamentLoop: "loop" }, 0.317);
    closeTo(performance.uvularConstriction, state.uvularConstriction + animation.throat * 0.24);
    closeTo(performance.alveolarConstriction, state.alveolarConstriction + animation.tongue * 0.2);
    closeTo(performance.frontCavityExpansion, state.frontCavityExpansion - animation.tongue * 0.18);
    closeTo(performance.mouthOpening, state.mouthOpening + animation.lips * 0.22);
    closeTo(performance.lipRounding, state.lipRounding - animation.lips * 0.25);
    closeTo(performance.sourcePressure, performance.intensity);
    closeTo(performance.focusFrequencyHz, performance.heardDroneHz * performance.targetHarmonic);
  }
});

test("loop, alternate, and once seams are smooth and once completion preserves transport", () => {
  const state = centeredState();
  for (const { id } of ORNAMENT_PATTERNS.filter(({ id }) => id !== "none")) {
    for (const ornamentLoop of ["loop", "alternate", "once"]) {
      const controls = { ornamentId: id, ornamentLoop };
      const left = evaluateSingerPerformance(state, {}, controls, 1 - 1e-5);
      const seam = evaluateSingerPerformance(state, {}, controls, 1);
      const right = evaluateSingerPerformance(state, {}, controls, 1 + 1e-5);
      for (const key of ["uvularConstriction", "alveolarConstriction", "mouthOpening", "intensity"]) {
        closeTo(left.performance[key], seam.performance[key], 1e-7);
        closeTo(right.performance[key], seam.performance[key], 1e-7);
      }
      assert.equal(seam.state.active, true);
      assert.equal(seam.ornamentFinished, ornamentLoop === "once");
    }
    const once = evaluateSingerPerformance(state, {}, { ornamentId: id, ornamentLoop: "once" }, 5);
    const off = evaluateSingerPerformance(state, {}, { ornamentId: id, ornamentLoop: "off" }, 5);
    assert.equal(once.animation.active, false);
    assert.equal(once.ornamentFinished, true);
    assert.deepEqual(once.performance, { ...off.performance, motionPhase: once.performance.motionPhase });
  }
});

test("off, zero depth, and zero rate leave the authored tract still", () => {
  const state = centeredState();
  const cases = [
    [state, { ornamentId: "roll", ornamentLoop: "off" }],
    [{ ...state, motionDepth: 0 }, { ornamentId: "roll" }],
    [{ ...state, motionRateHz: 0 }, { ornamentId: "roll", ornamentLoop: "once" }],
    [state, { ornamentId: "none" }],
  ];
  for (const [base, settings] of cases) {
    const result = evaluateSingerPerformance(base, {}, settings, 0.31);
    for (const key of ["uvularConstriction", "alveolarConstriction", "mouthOpening", "lipRounding", "intensity"]) closeTo(result.performance[key], base[key]);
    assert.equal(result.animation.active, false);
    assert.equal(result.ornamentFinished, false);
  }
});

test("alternate reverses each second phrase and looping repeats its contour", () => {
  const state = centeredState();
  const first = evaluateSingerPerformance(state, {}, { ornamentId: "climb", ornamentLoop: "alternate" }, 0.2);
  const second = evaluateSingerPerformance(state, {}, { ornamentId: "climb", ornamentLoop: "alternate" }, 1.8);
  closeTo(first.animation.tongue, second.animation.tongue);
  const forward = evaluateSingerPerformance(state, {}, { ornamentId: "climb", ornamentLoop: "loop" }, 0.2);
  const repeated = evaluateSingerPerformance(state, {}, { ornamentId: "climb", ornamentLoop: "loop" }, 1.2);
  closeTo(forward.animation.tongue, repeated.animation.tongue);
});

test("pitch melodies have distinct bounded contours and audible pitch targets", () => {
  const state = centeredState();
  const signatures = new Set();
  for (const melody of PITCH_MELODIES) {
    let changed = false;
    const signature = [];
    for (let index = 0; index < 96; index += 1) {
      const result = evaluateSingerPerformance(state, {}, {
        melodyId: melody.id, melodyRateHz: 1, melodyDepthSemitones: 12,
      }, index / 96);
      boundedState(result.performance);
      assert.ok(result.performance.pitchSemitones >= -12 && result.performance.pitchSemitones <= 12);
      closeTo(result.performance.trueFoldHz, Math.max(50, Math.min(360, state.trueFoldHz * 2 ** (result.performance.pitchSemitones / 12))));
      changed ||= Math.abs(result.performance.trueFoldHz - state.trueFoldHz) > 1;
      signature.push(result.performance.pitchSemitones.toFixed(5));
    }
    assert.equal(changed, melody.id !== "steady", `${melody.id} pitch motion`);
    signatures.add(signature.join(","));
    const left = evaluateSingerPerformance(state, {}, { melodyId: melody.id, melodyRateHz: 1 }, 1 - 1e-6);
    const right = evaluateSingerPerformance(state, {}, { melodyId: melody.id, melodyRateHz: 1 }, 1 + 1e-6);
    closeTo(left.performance.pitchSemitones, right.performance.pitchSemitones, 1e-6);
  }
  assert.equal(signatures.size, PITCH_MELODIES.length);
});

test("local phrase clocks retrigger ornaments independently from melody and vibrato", () => {
  const state = { ...centeredState(), vibratoDepthCents: 24, vibratoRateHz: 5 };
  const settings = { ornamentId: "roll", melodyId: "arch", melodyRateHz: 0.5 };
  const before = evaluateSingerPerformance(state, {}, settings, 0.43);
  const retriggered = evaluateSingerPerformance(state, {}, settings, 0.43, { ornamentTimeSeconds: 0 });
  assert.notEqual(before.animation.tongue, retriggered.animation.tongue);
  assert.equal(retriggered.animation.tongue, 0);
  assert.equal(before.performance.pitchSemitones, retriggered.performance.pitchSemitones);
  assert.equal(before.performance.vibratoCents, retriggered.performance.vibratoCents);
  const melodyRestart = evaluateSingerPerformance(state, {}, settings, 0.43, { melodyTimeSeconds: 0 });
  assert.equal(melodyRestart.performance.pitchSemitones, 0);
  assert.equal(before.animation.tongue, melodyRestart.animation.tongue);
});

test("evaluation is deterministic and pure for malformed and extreme inputs", () => {
  const state = centeredState();
  const extras = { pulseDepth: 0.6, pulseRate: 2 };
  const settings = { ornamentId: "rake", melodyId: "wide-leaps", melodyRateHz: 4, melodyDepthSemitones: 24 };
  const snapshot = structuredClone({ state, extras, settings });
  const first = evaluateSingerPerformance(state, extras, settings, 0.42);
  assert.deepEqual(first, evaluateSingerPerformance(state, extras, settings, 0.42));
  assert.deepEqual({ state, extras, settings }, snapshot);
  assert.equal(Object.isFrozen(first.performance), true);
  assert.equal(Object.isFrozen(first.animation), true);
  for (const seconds of [NaN, Infinity, -Infinity, -9, 1e9, Number.MAX_VALUE]) {
    const result = evaluateSingerPerformance(null, null, null, seconds);
    boundedState(result.performance);
    assert.ok(Object.values(result.animation).every((value) => typeof value === "boolean" || Number.isFinite(value)));
  }
});

test("full-state randomization preserves level and varies every preset-owned musical field", () => {
  const random = seededRandom(27551);
  const results = Array.from({ length: 160 }, () => randomizeSingerPreset(random, 0.413));
  for (const result of results) {
    boundedState(result.state);
    assert.equal(result.state.level, 0.413);
    assert.equal(result.state.active, false);
    assert.equal("level" in result.snapshot.state, false);
    assert.equal("active" in result.snapshot.state, false);
    assert.deepEqual(result.settings, sanitizePerformanceSettings(result.settings));
    assert.deepEqual(result.extras, sanitizeSingerExtras(result.extras));
  }
  for (const section of ["state", "extras", "settings"]) {
    for (const key of Object.keys(results[0][section]).filter((key) => !["active", "level"].includes(key))) {
      const values = new Set(results.map((result) => result[section][key]));
      assert.ok(values.size > 1, `${section}.${key} varies across randomization`);
    }
  }
  assert.deepEqual(randomizeSingerPreset(seededRandom(17), 0.2), randomizeSingerPreset(seededRandom(17), 0.2));
  for (const value of [NaN, Infinity, -99, 99]) {
    boundedState(randomizeSingerPreset(() => value, value).state);
  }
});

test("every complete preset produces finite bounded modulation across its phrase", () => {
  for (const preset of THROAT_SINGER_PRESETS) {
    for (let index = 0; index < 32; index += 1) {
      const result = evaluateSingerPerformance(preset.state, preset.extras, preset.settings, index * 0.137);
      boundedState(result.performance);
      assert.ok(Number.isFinite(result.performance.focus.f2Hz));
      assert.ok(result.performance.focus.f2Hz < result.performance.focus.f3Hz);
      for (const key of ["tongue", "lips", "throat", "pulse", "nose", "jaw", "pitch"]) {
        assert.ok(result.animation[key] >= -1 && result.animation[key] <= 1, `${preset.id} animation ${key} bounded`);
      }
    }
  }
});

test("pressure pulses share the phrase clock and source motion depth remains consequential", () => {
  const base = throatSingingState("open-drone", {
    intensity: 0.4, motionRateHz: 1, motionDepth: 1, amplitudeMotionDepth: 0,
  });
  const settings = { ornamentId: "swell", ornamentLoop: "loop" };
  const neutral = evaluateSingerPerformance(base, { pulseRate: 1, pulseDepth: 0.6 }, settings, 0);
  const crest = evaluateSingerPerformance(base, { pulseRate: 1, pulseDepth: 0.6 }, settings, 0.25);
  assert.equal(neutral.performance.pressurePulseWave, 0);
  assert.ok(crest.performance.pressurePulseWave > 0.59);
  assert.ok(crest.animation.airflow > neutral.animation.airflow);
  const shallow = evaluateSingerPerformance(base, {}, settings, 0.5);
  const deep = evaluateSingerPerformance({ ...base, amplitudeMotionDepth: 1 }, {}, settings, 0.5);
  assert.ok(deep.performance.intensity > shallow.performance.intensity);
  const sine = evaluateSingerPerformance({ ...base, motionShape: "sine" }, {}, settings, 0.25);
  const triangle = evaluateSingerPerformance({ ...base, motionShape: "triangle" }, {}, settings, 0.25);
  assert.notEqual(sine.performance.uvularConstriction, triangle.performance.uvularConstriction);
});

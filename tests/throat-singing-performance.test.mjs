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
  THROAT_SINGER_EXTRA_LIMITS,
  THROAT_SINGER_PERFORMANCE_DEFAULTS,
  THROAT_SINGER_PRESETS,
  evaluateSingerPerformance,
  breathEnvelope,
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
    ...THROAT_SINGER_EXTRA_DEFAULTS,
    sublingualCoupling: 1, phantomAirways: 3, pulseRate: 0,
    pulseDepth: 0, impossibleFocus: 0, sourceInstability: 1,
  });
});

test("legacy loop modes normalize into independent switches and round-trip completely", () => {
  for (const [ornamentLoop, playing, pingPong, repeat] of [
    ["off", false, false, true], ["once", true, false, false],
    ["loop", true, false, true], ["alternate", true, true, true],
  ]) {
    const settings = sanitizePerformanceSettings({ ornamentLoop });
    assert.equal(settings.ornamentPlaying, playing);
    assert.equal(settings.ornamentPingPong, pingPong);
    assert.equal(settings.ornamentRepeat, repeat);
    assert.equal(settings.ornamentLoop, ornamentLoop);
    assert.deepEqual(sanitizePerformanceSettings(settings), settings);
  }
  const controls = sanitizePerformanceSettings({
    ornamentPlaying: false, ornamentPingPong: true, ornamentRepeat: false,
    ornamentDirection: "reverse", ornamentLoop: "loop",
    melodyPlaying: false, melodyPingPong: true, melodyRepeat: false, melodyDirection: "reverse",
    breathRateBpm: 99, portamentoSeconds: -9,
  });
  assert.equal(controls.ornamentLoop, "off");
  assert.equal(controls.ornamentPingPong, true);
  assert.equal(controls.ornamentRepeat, false);
  assert.equal(controls.melodyPlaying, false);
  assert.equal(controls.melodyPingPong, true);
  assert.equal(controls.melodyRepeat, false);
  assert.equal(controls.breathRateBpm, 30);
  assert.equal(controls.portamentoSeconds, 0);
  assert.deepEqual(sanitizePerformanceSettings(controls), controls);
});

test("new polyphony and effects parameters retain moderate defaults and bounded values", () => {
  const result = sanitizeSingerExtras({
    pitchVoices: 99, pitchSpreadSemitones: -9, overtoneVoices: 2.6,
    overtoneSpread: 99, reverbMix: 99, delayMix: 99, delayTimeSeconds: -8, delayFeedback: 99,
  });
  assert.equal(result.pitchVoices, 4);
  assert.equal(result.pitchSpreadSemitones, 0);
  assert.equal(result.overtoneVoices, 3);
  assert.equal(result.overtoneSpread, 6);
  assert.equal(result.reverbMix, 0.65);
  assert.equal(result.delayMix, 0.6);
  assert.equal(result.delayTimeSeconds, 0.06);
  assert.equal(result.delayFeedback, 0.65);
  for (const key of ["pitchVoices", "pitchSpreadSemitones", "overtoneVoices", "overtoneSpread", "reverbMix", "delayMix", "delayTimeSeconds", "delayFeedback"]) {
    assert.ok(new Set(THROAT_SINGER_PRESETS.map(({ extras }) => extras[key])).size > 1, `${key} represented in the preset bank`);
  }
  for (const { extras } of THROAT_SINGER_PRESETS) {
    for (const [key, [low, high]] of Object.entries(THROAT_SINGER_EXTRA_LIMITS)) {
      assert.ok(extras[key] >= low && extras[key] <= high, `${key} bounded`);
    }
  }
});

test("stopped tracks leave their own articulation neutral while other track and vibrato continue", () => {
  const base = { ...centeredState(), vibratoDepthCents: 30, vibratoRateHz: 5 };
  const stopped = {
    ornamentId: "roll", ornamentPlaying: false,
    melodyId: "arch", melodyPlaying: false, melodyRateHz: 1,
  };
  for (const elapsed of [0.13, 0.29, 2.83]) {
    const result = evaluateSingerPerformance(base, {}, stopped, elapsed);
    for (const key of ["tongue", "throat", "lips", "nose", "jaw", "pitch", "ornamentPhase", "melodyPhase"]) assert.equal(result.animation[key], 0);
    assert.equal(result.animation.active, false);
    assert.equal(result.animation.melodyActive, false);
    assert.equal(result.animation.melodyFinished, false);
    closeTo(result.performance.vibratoCents, Math.sin(elapsed * base.vibratoRateHz * Math.PI * 2) * 30);
    closeTo(result.performance.intensity, base.intensity);
  }
  const ornamentOnly = evaluateSingerPerformance(base, {}, { ...stopped, ornamentPlaying: true }, 0.29);
  assert.notEqual(ornamentOnly.animation.tongue, 0);
  assert.equal(ornamentOnly.performance.pitchSemitones, 0);
  const melodyOnly = evaluateSingerPerformance(base, {}, { ...stopped, melodyPlaying: true }, 0.29);
  assert.equal(melodyOnly.animation.tongue, 0);
  assert.notEqual(melodyOnly.performance.pitchSemitones, 0);
});

test("both tracks reverse their contour and pingpong through matching outward and return poses", () => {
  const base = centeredState();
  const controls = { ornamentId: "climb", melodyId: "minor-turn", melodyRateHz: 1 };
  const forward = evaluateSingerPerformance(base, {}, controls, 0.23);
  const reverse = evaluateSingerPerformance(base, {}, {
    ...controls, ornamentDirection: "reverse", melodyDirection: "reverse",
  }, 0.77);
  closeTo(forward.animation.tongue, reverse.animation.tongue);
  closeTo(forward.performance.pitchSemitones, reverse.performance.pitchSemitones);
  for (const direction of ["forward", "reverse"]) {
    const settings = { ...controls,
      ornamentDirection: direction, melodyDirection: direction,
      ornamentPingPong: true, melodyPingPong: true,
    };
    const outward = evaluateSingerPerformance(base, {}, settings, 0.37);
    const returning = evaluateSingerPerformance(base, {}, settings, 1.63);
    closeTo(outward.animation.tongue, returning.animation.tongue);
    closeTo(outward.performance.pitchSemitones, returning.performance.pitchSemitones);
  }
});

test("nonrepeating tracks complete one pass or one pingpong round trip without releasing the drone", () => {
  const base = centeredState();
  for (const pingPong of [false, true]) {
    const duration = pingPong ? 2 : 1;
    const settings = {
      ornamentId: "roll", ornamentRepeat: false, ornamentPingPong: pingPong,
      melodyId: "arch", melodyRateHz: 1, melodyRepeat: false, melodyPingPong: pingPong,
    };
    const before = evaluateSingerPerformance(base, {}, settings, duration - 0.01);
    const after = evaluateSingerPerformance(base, {}, settings, duration);
    assert.equal(before.ornamentFinished, false);
    assert.equal(before.melodyFinished, false);
    assert.equal(after.ornamentFinished, true);
    assert.equal(after.melodyFinished, true);
    assert.equal(after.animation.melodyFinished, true);
    assert.equal(after.animation.pitch, 0);
    assert.equal(after.animation.tongue, 0);
    assert.equal(after.state.active, true);
    closeTo(after.performance.trueFoldHz, base.trueFoldHz);
    const retriggered = evaluateSingerPerformance(base, {}, settings, duration + 3, {
      ornamentTimeSeconds: 0.29, melodyTimeSeconds: 0.29,
    });
    assert.equal(retriggered.ornamentFinished, false);
    assert.equal(retriggered.melodyFinished, false);
  }
});

test("portamento duration audibly changes melodic transitions in the pure score", () => {
  const base = centeredState();
  const settings = { melodyId: "three-step", melodyRateHz: 1 };
  const stepped = evaluateSingerPerformance(base, {}, { ...settings, portamentoSeconds: 0 }, 0.12);
  const gliding = evaluateSingerPerformance(base, {}, { ...settings, portamentoSeconds: 0.12 }, 0.12);
  const legato = evaluateSingerPerformance(base, {}, { ...settings, portamentoSeconds: 1 }, 0.12);
  assert.equal(stepped.performance.pitchSemitones, 0);
  assert.ok(gliding.performance.pitchSemitones > stepped.performance.pitchSemitones);
  assert.ok(legato.performance.pitchSemitones > gliding.performance.pitchSemitones);
});

test("automatic breathing waits a full period and manual breathing uses the same smooth contour", () => {
  const automatic = { breathRateBpm: 12 };
  for (const seconds of [0, 0.11, 0.4, 1, 4.99]) {
    assert.deepEqual(breathEnvelope(seconds, automatic), { gain: 1, inhaling: false, phase: 0 });
  }
  assert.equal(breathEnvelope(5, automatic).gain, 1);
  closeTo(breathEnvelope(5.11, automatic).gain, 0.5);
  assert.equal(breathEnvelope(5.22, automatic).gain, 0);
  assert.equal(breathEnvelope(5.36, automatic).inhaling, true);
  assert.equal(breathEnvelope(5.5, automatic).inhaling, false);
  closeTo(breathEnvelope(5.675, automatic).gain, 0.5);
  assert.equal(breathEnvelope(5.85, automatic).gain, 1);
  for (const age of [0, 0.1, 0.22, 0.36, 0.5, 0.68, 0.85, 1]) {
    const auto = breathEnvelope(5 + age, automatic);
    const manual = breathEnvelope(5 + age, { breathRateBpm: 0, manualBreathAtSeconds: 5 });
    assert.deepEqual(auto, manual);
  }
  assert.deepEqual(breathEnvelope(100, { breathRateBpm: 0 }), { gain: 1, inhaling: false, phase: 0 });
  assert.deepEqual(breathEnvelope(2, { manualBreathAtSeconds: 3 }), { gain: 1, inhaling: false, phase: 0 });
});

test("breath release and attack seams have zero slope with bounded finite gain", () => {
  for (const boundary of [0, 0.22, 0.5, 0.85]) {
    const middle = breathEnvelope(10 + boundary, { manualBreathAtSeconds: 10 });
    const left = breathEnvelope(10 + boundary - 1e-6, { manualBreathAtSeconds: 10 });
    const right = breathEnvelope(10 + boundary + 1e-6, { manualBreathAtSeconds: 10 });
    closeTo(left.gain, middle.gain, 1e-9);
    closeTo(right.gain, middle.gain, 1e-9);
  }
  for (const seconds of [NaN, Infinity, -Infinity, -10, 0, 1e9, Number.MAX_VALUE]) {
    const result = breathEnvelope(seconds, { breathRateBpm: 99, manualBreathAtSeconds: Infinity });
    assert.ok(Number.isFinite(result.gain) && result.gain >= 0 && result.gain <= 1);
    assert.ok(Number.isFinite(result.phase) && result.phase >= 0 && result.phase <= 1);
  }
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

test("rate edits retain phrase, vibrato, pulse, and current note glide positions", () => {
  const base = { ...centeredState(), vibratoDepthCents: 30, vibratoRateHz: 4 };
  const settings = {
    ornamentId: "roll", ornamentPlaying: true, ornamentRepeat: false,
    melodyId: "arch", melodyPlaying: true, melodyRepeat: false,
    melodyRateHz: 0.4, melodyDepthSemitones: 7, portamentoSeconds: 0.8,
  };
  for (const pingPong of [false, true]) {
    for (const direction of ["forward", "reverse"]) {
      const controls = { ...settings, ornamentPingPong: pingPong, melodyPingPong: pingPong,
        ornamentDirection: direction, melodyDirection: direction };
      const timing = { ornamentCycles: pingPong ? 1.37 : 0.37, melodyCycles: pingPong ? 1.23 : 0.23,
        melodyGlideRateHz: 0.4, vibratoCycles: 0.23, pulseCycles: 0.37 };
      const before = evaluateSingerPerformance(base, { pulseRate: 0.7, pulseDepth: 0.5 }, controls, 9, timing);
      for (const rate of [2, 0.25, 0, 3]) {
        const changed = evaluateSingerPerformance({ ...base, motionRateHz: rate, vibratoRateHz: rate },
          { pulseRate: rate, pulseDepth: 0.5 }, { ...controls, melodyRateHz: rate }, 9, timing);
        assert.deepEqual(changed.animation, before.animation);
        for (const key of ["trueFoldHz", "vibratoCents", "pressurePulseWave", "intensity", "uvularConstriction", "alveolarConstriction"]) {
          closeTo(changed.performance[key], before.performance[key]);
        }
        assert.equal(changed.ornamentFinished, false);
        assert.equal(changed.melodyFinished, false);
      }
    }
  }
});

test("an explicit automatic breath timestamp preserves its envelope during tempo edits", () => {
  const timing = { automaticBreathAtSeconds: 8 };
  for (const seconds of [8.1, 8.3, 8.7, 9]) {
    const expected = breathEnvelope(seconds, { ...timing, breathRateBpm: 8 });
    for (const breathRateBpm of [0, 3, 15, 30]) {
      assert.deepEqual(breathEnvelope(seconds, { ...timing, breathRateBpm }), expected);
    }
  }
  assert.equal(breathEnvelope(9, { automaticBreathAtSeconds: -Infinity, breathRateBpm: 30 }).gain, 1);
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

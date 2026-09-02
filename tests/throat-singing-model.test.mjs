import assert from "node:assert/strict";
import test from "node:test";

import { glottalSample } from "../src/throatazoid.js";

import {
  DEFAULT_THROAT_SINGING_STATE,
  FALSE_FOLD_AUDIBILITY_THRESHOLD,
  THROAT_SINGING_DEFAULTS,
  THROAT_SINGING_LIMITS,
  THROAT_SINGING_PRESETS,
  THROAT_SINGING_STYLE_PRESETS,
  THROAT_SINGING_TRACT_SECTION_COUNT,
  closurePatternFrequencyHz,
  dualFocusTargets,
  harmonicFrequencyHz,
  harmonicLabel,
  heardDroneFrequencyHz,
  interpolateThroatSingingStates,
  modulateThroatSingingPerformance,
  sampleThroatSingingMotion,
  sampleVoicelessInhaleEnvelope,
  sanitizeThroatSingingState,
  throatSingingPreset,
  throatSingingState,
  throatSingingTractDiameters,
  throatSingingTractProfile,
  throatSingingWaveguideConfig,
  throatSingingWaveguideDeformations,
  trueFoldFrequencyForDroneHz,
  trueFoldFrequencyHz,
  ventricularFoldSupercycle,
  voicelessInhaleGainCurve,
} from "../src/throat-singing.js";

const expectedPresetIds = [
  "sygyt",
  "xoomei",
  "kargyraa",
  "borbangnadyr",
  "ezengileer",
  "western-overtone",
  "low-chant",
];

test("style presets separate five Tuvan styles from two labeled comparisons", () => {
  assert.equal(THROAT_SINGING_PRESETS, THROAT_SINGING_STYLE_PRESETS);
  assert.deepEqual(THROAT_SINGING_STYLE_PRESETS.map(({ id }) => id), expectedPresetIds);
  assert.deepEqual(
    THROAT_SINGING_STYLE_PRESETS.filter(({ isTuvan }) => isTuvan).map(({ id }) => id),
    expectedPresetIds.slice(0, 5),
  );
  for (const entry of THROAT_SINGING_STYLE_PRESETS) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.settings), true);
    assert.equal(Object.isFrozen(entry.evidence), true);
    assert.match(entry.evidence.kind, /approximation/i);
    assert.ok(entry.evidence.notice.length > 60);
  }
  assert.match(throatSingingPreset("xoomei").label, /Xöömei.*Khöömei/u);
  assert.match(throatSingingPreset("western-overtone").culturalScope, /Non-Tuvan/);
  assert.match(throatSingingPreset("low-chant").description, /no claimed Tuvan/i);
  assert.equal(throatSingingPreset("missing").id, "sygyt");
});

test("defaults and sanitization are stable, finite, bounded, and alias anatomy terms", () => {
  assert.equal(DEFAULT_THROAT_SINGING_STATE, THROAT_SINGING_DEFAULTS);
  assert.equal(Object.isFrozen(THROAT_SINGING_DEFAULTS), true);
  const state = sanitizeThroatSingingState({
    styleId: "not-a-style",
    active: 1,
    trueFoldHz: Infinity,
    falseFoldDivision: 2.6,
    harmonicNumber: 10.7,
    intensity: -8,
    formantConvergence: 9,
    pharyngealConstriction: 0.41,
    oralConstriction: 0.73,
    tractLengthCm: 90,
    motionShape: "not-a-wave",
  });
  assert.equal(state.styleId, "sygyt");
  assert.equal(state.active, true);
  assert.equal(state.trueFoldHz, THROAT_SINGING_DEFAULTS.trueFoldHz);
  assert.equal(state.falseFoldDivision, 3);
  assert.equal(state.harmonicNumber, 11);
  assert.equal(state.intensity, THROAT_SINGING_LIMITS.intensity[0]);
  assert.equal(state.formantConvergence, THROAT_SINGING_LIMITS.formantConvergence[1]);
  assert.equal(state.uvularConstriction, 0.41);
  assert.equal(state.pharyngealConstriction, 0.41);
  assert.equal(state.alveolarConstriction, 0.73);
  assert.equal(state.oralConstriction, 0.73);
  assert.equal(state.tractLengthCm, THROAT_SINGING_LIMITS.tractLengthCm[1]);
  assert.equal(state.motionShape, "sine");

  const kargyraa = throatSingingState("kargyraa", { level: 99 });
  assert.equal(kargyraa.styleId, "kargyraa");
  assert.equal(kargyraa.falseFoldDivision, 2);
  assert.equal(kargyraa.level, THROAT_SINGING_LIMITS.level[1]);
});

test("whole-model preset morphs are exact at endpoints and safe across discrete topology", () => {
  const sygyt = throatSingingState("sygyt");
  const kargyraa = throatSingingState("kargyraa");
  const sygytSnapshot = structuredClone(sygyt);
  const kargyraaSnapshot = structuredClone(kargyraa);

  assert.deepEqual(interpolateThroatSingingStates(sygyt, kargyraa, 0), sygyt);
  assert.deepEqual(interpolateThroatSingingStates(sygyt, kargyraa, 1), kargyraa);
  const quarter = interpolateThroatSingingStates(sygyt, kargyraa, 0.25);
  assert.ok(Math.abs(quarter.trueFoldHz - 150 * Math.pow(120 / 150, 0.25)) < 1e-9);
  assert.equal(quarter.intensity, sygyt.intensity + (kargyraa.intensity - sygyt.intensity) * 0.25);
  assert.equal(quarter.harmonicNumber, Math.round(sygyt.harmonicNumber + 0.25 * (kargyraa.harmonicNumber - sygyt.harmonicNumber)));
  assert.equal(quarter.falseFoldDivision, 1);

  const midpoint = interpolateThroatSingingStates(sygyt, kargyraa, 0.5);
  assert.equal(midpoint.falseFoldDivision, 2);
  assert.equal(midpoint.falseFoldCoupling, 0);
  assert.equal(midpoint.pharyngealConstriction, midpoint.uvularConstriction);
  assert.equal(midpoint.oralConstriction, midpoint.alveolarConstriction);
  for (const [key, [minimum, maximum]] of Object.entries(THROAT_SINGING_LIMITS)) {
    assert.ok(Number.isFinite(midpoint[key]), `${key} should be finite`);
    assert.ok(midpoint[key] >= minimum && midpoint[key] <= maximum, `${key} should be bounded`);
  }

  const shapeMidpoint = interpolateThroatSingingStates(
    throatSingingState("borbangnadyr"),
    throatSingingState("ezengileer"),
    0.5,
  );
  assert.equal(shapeMidpoint.motionShape, "stirrup");
  assert.equal(shapeMidpoint.motionDepth, 0);
  assert.equal(shapeMidpoint.amplitudeMotionDepth, 0);
  assert.deepEqual(sygyt, sygytSnapshot);
  assert.deepEqual(kargyraa, kargyraaSnapshot);
});

test("every preset pair stays finite and bounded across the whole morph rail", () => {
  for (const fromPreset of THROAT_SINGING_STYLE_PRESETS) {
    for (const toPreset of THROAT_SINGING_STYLE_PRESETS) {
      const from = throatSingingState(fromPreset.id);
      const to = throatSingingState(toPreset.id);
      for (const amount of [0.01, 0.25, 0.49, 0.5, 0.51, 0.75, 0.99]) {
        const state = interpolateThroatSingingStates(from, to, amount);
        for (const [key, [minimum, maximum]] of Object.entries(THROAT_SINGING_LIMITS)) {
          assert.ok(Number.isFinite(state[key]), `${fromPreset.id}→${toPreset.id} ${key}`);
          assert.ok(state[key] >= minimum && state[key] <= maximum);
        }
        assert.ok([from.motionShape, to.motionShape].includes(state.motionShape));
        assert.ok([from.falseFoldDivision, to.falseFoldDivision].includes(state.falseFoldDivision));
      }
    }
  }
});

test("generic Low Chant leaves the ventricular folds effectively open", () => {
  const lowChant = throatSingingState("low-chant");
  assert.ok(lowChant.falseFoldCoupling < FALSE_FOLD_AUDIBILITY_THRESHOLD);
  assert.equal(heardDroneFrequencyHz(lowChant), lowChant.trueFoldHz);
});

test("true folds, false-fold period division, drone, harmonic, and labels remain distinct", () => {
  const sygyt = throatSingingState("sygyt");
  assert.equal(trueFoldFrequencyHz(sygyt), 150);
  assert.equal(heardDroneFrequencyHz(sygyt), 150);
  assert.equal(harmonicFrequencyHz(sygyt), 1_800);
  assert.match(harmonicLabel(sygyt), /^H12 · 12th harmonic · 1\.80 kHz$/);

  const kargyraa = throatSingingState("kargyraa");
  assert.equal(trueFoldFrequencyHz(kargyraa), 120);
  assert.equal(heardDroneFrequencyHz(kargyraa), 60);
  assert.equal(harmonicFrequencyHz(kargyraa), 960);
  assert.equal(trueFoldFrequencyForDroneHz(60, 2), 120);
  assert.equal(heardDroneFrequencyHz(120, 2), 60);
  assert.equal(harmonicFrequencyHz(60, 16), 960);

  const armedOnly = throatSingingState("sygyt", {
    falseFoldDivision: 2,
    falseFoldCoupling: 0,
  });
  assert.equal(closurePatternFrequencyHz(armedOnly), 75);
  assert.equal(heardDroneFrequencyHz(armedOnly), 150);
  assert.equal(heardDroneFrequencyHz({ ...armedOnly, falseFoldCoupling: 0.2 }), 75);
});

test("ventricular supercycle creates a bounded closure mask and real divided components", () => {
  for (const division of [1, 2, 3, 7]) {
    const cycle = ventricularFoldSupercycle(throatSingingState("sygyt", {
      falseFoldDivision: division,
    }));
    assert.equal(cycle.division, division);
    assert.equal(cycle.real.length, cycle.imaginary.length);
    assert.equal(cycle.real[0], 0);
    assert.equal(cycle.imaginary[0], 0);
    assert.ok([...cycle.real, ...cycle.imaginary].every(Number.isFinite));
    assert.ok(cycle.meanClosure > 0 && cycle.meanClosure < 1);
    assert.ok(cycle.meanSquaredClosure >= cycle.meanClosure ** 2);

    let minimumGate = Infinity;
    let maximumGate = -Infinity;
    for (let index = 0; index < 2048; index += 1) {
      const phase = (index + 0.5) / 2048;
      let centeredMask = 0;
      for (let harmonic = 1; harmonic < cycle.real.length; harmonic += 1) {
        const angle = Math.PI * 2 * harmonic * phase;
        centeredMask += cycle.real[harmonic] * Math.cos(angle)
          + cycle.imaginary[harmonic] * Math.sin(angle);
      }
      const gate = 1 - cycle.meanClosure + centeredMask;
      minimumGate = Math.min(minimumGate, gate);
      maximumGate = Math.max(maximumGate, gate);
    }
    assert.ok(minimumGate >= -0.03, `${division}:1 gate minimum ${minimumGate}`);
    assert.ok(maximumGate <= 1.06, `${division}:1 gate maximum ${maximumGate}`);
  }

  const periodTwo = ventricularFoldSupercycle(throatSingingState("kargyraa"));
  const dividedMagnitude = Math.hypot(periodTwo.real[1], periodTwo.imaginary[1]);
  const trueFoldMagnitude = Math.hypot(periodTwo.real[2], periodTwo.imaginary[2]);
  assert.ok(dividedMagnitude > trueFoldMagnitude * 4);

  const kargyraa = throatSingingState("kargyraa");
  const sampleCount = 4096;
  const sourceMagnitude = (harmonic) => {
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const phase = (index + 0.5) / sampleCount;
      let centeredMask = 0;
      for (let partial = 1; partial < periodTwo.real.length; partial += 1) {
        const maskAngle = Math.PI * 2 * partial * phase;
        centeredMask += periodTwo.real[partial] * Math.cos(maskAngle)
          + periodTwo.imaginary[partial] * Math.sin(maskAngle);
      }
      const closureGate = 1
        - kargyraa.falseFoldCoupling * periodTwo.meanClosure
        + kargyraa.falseFoldCoupling * centeredMask;
      const sample = glottalSample((phase * 2) % 1, kargyraa.foldTenseness) * closureGate;
      const angle = Math.PI * 2 * harmonic * phase;
      cosine += sample * Math.cos(angle);
      sine += sample * Math.sin(angle);
    }
    return Math.hypot(cosine, sine) * 2 / sampleCount;
  };
  assert.ok(sourceMagnitude(1) > sourceMagnitude(2) * 0.24);
});

test("voiceless inhale envelope is bounded, one-shot, and level-scaled", () => {
  assert.equal(sampleVoicelessInhaleEnvelope(-1), 0);
  assert.equal(sampleVoicelessInhaleEnvelope(0), 0);
  assert.equal(sampleVoicelessInhaleEnvelope(1), 0);
  assert.ok(sampleVoicelessInhaleEnvelope(0.5) > 0.99);
  const muted = voicelessInhaleGainCurve(0, 64);
  const audible = voicelessInhaleGainCurve(0.4, 128);
  assert.ok([...muted].every((value) => value === 0));
  assert.equal(audible[0], 0);
  assert.equal(audible.at(-1), 0);
  assert.ok(Math.max(...audible) > 0.06 && Math.max(...audible) < 0.08);
  assert.ok([...audible].every((value) => Number.isFinite(value) && value >= 0 && value <= 0.24));
});

test("F2 and F3 converge symmetrically on the selected harmonic", () => {
  const sygyt = throatSingingState("sygyt");
  const focused = dualFocusTargets(sygyt);
  const open = dualFocusTargets({ ...sygyt, formantConvergence: 0.2 });
  assert.equal(focused.targetHz, harmonicFrequencyHz(sygyt));
  assert.ok(Math.abs((focused.f2Hz + focused.f3Hz) / 2 - focused.targetHz) < 2);
  assert.ok(focused.separationHz < focused.bandwidthHz);
  assert.equal(focused.merged, true);
  assert.ok(open.separationHz > focused.separationHz * 8);
  assert.equal(open.merged, false);
  assert.ok(focused.relativeFocusGainDbApprox >= 15);
});

test("44-section tract has research-positioned uvular and alveolar constrictions", () => {
  const state = throatSingingState("sygyt");
  const profile = throatSingingTractProfile(state);
  assert.equal(profile.sectionCount, THROAT_SINGING_TRACT_SECTION_COUNT);
  assert.equal(profile.areasCm2.length, 44);
  assert.equal(profile.diametersCm.length, 44);
  assert.equal(profile.diameters, profile.diametersCm);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.areasCm2), true);
  assert.ok(profile.areasCm2.every((area) => Number.isFinite(area) && area > 0));
  assert.ok(profile.diametersCm.every((diameter) => Number.isFinite(diameter) && diameter > 0));

  const deformations = throatSingingWaveguideDeformations(state);
  assert.deepEqual(
    deformations.map(({ id }) => id),
    ["uvular-pharyngeal", "alveolar-oral", "anterior-expansion"],
  );
  assert.ok(deformations[0].centerCm >= 6 && deformations[0].centerCm <= 8.5);
  assert.ok(deformations[1].centerCm >= 12.5 && deformations[1].centerCm <= 13.5);
  assert.ok(deformations[2].centerCm >= 14 && deformations[2].centerCm <= 15.5);
  assert.equal(deformations[1].minimumAreaCm2, 0.09);

  const oralIndex = deformations[1].centerSection;
  const sideArea = profile.areasCm2[Math.max(0, oralIndex - 4)];
  assert.ok(profile.areasCm2[oralIndex] < sideArea * 0.25);
  assert.ok(profile.areasCm2[deformations[2].centerSection] > profile.areasCm2[oralIndex]);

  const diameters = throatSingingTractDiameters(state);
  assert.equal(diameters instanceof Float32Array, true);
  assert.equal(diameters.length, 44);
});

test("waveguide configuration is a complete one-mouth Throatazoid processor state", () => {
  const config = throatSingingWaveguideConfig(
    throatSingingState("kargyraa", { active: true }),
    48_000,
  );
  assert.equal(config.mouthCount, 1);
  assert.equal(config.throatCount, 1);
  assert.equal(config.classicTopology, true);
  assert.equal(config.mouths.length, 1);
  assert.equal(config.mouths[0].closed, false);
  assert.equal(config.tongueCount, 1);
  assert.equal(config.tongues.length, 1);
  assert.deepEqual(config.tongue, config.tongues[0]);
  assert.equal(config.nasal.enabled, false);
  assert.equal(config.nasalCoupling, 0);
  assert.equal(config.noseCount, 0);
  assert.equal(config.noses[0].openness, 0);
  assert.ok(config.lipDiameter >= 0.35 && config.lipDiameter <= 3);
  assert.equal(config.pressureSourceCount, 1);
  assert.deepEqual(config.pressureSource, config.pressureSources[0]);
  assert.equal(config.pressureSources[0].open, true);
  assert.equal(config.performanceGate, 1);
  assert.deepEqual(
    config.tractDeformations.map(({ id }) => id),
    ["uvular-pharyngeal", "alveolar-oral", "anterior-expansion"],
  );
  assert.ok(config.tractDeformations.slice(0, 2).every(({ height }) => height < 0));
  assert.ok(config.tractDeformations[2].height > 0);
  assert.equal(config.sectionCount, 44);
  assert.equal(config.reflectionCoefficients.length, 43);
  assert.ok(config.reflectionCoefficients.every((value) => Math.abs(value) <= 0.999));
  assert.equal(config.source.trueFoldHz, 120);
  assert.equal(config.source.heardDroneHz, 60);
  assert.equal(config.source.falseFoldDivision, 2);
  assert.ok(config.source.falseFoldCoupling > 0.8);
  assert.ok(config.lipReflection < 0);
  assert.ok(config.junctionLoss > 0 && config.junctionLoss < 1);
  assert.equal(config.focus.targetHz, 960);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.source), true);
  assert.equal(Object.isFrozen(config.reflectionCoefficients), true);
});

test("performance modulation is deterministic, bounded, and leaves its input untouched", () => {
  const borbangnadyr = throatSingingState("borbangnadyr");
  const snapshot = structuredClone(borbangnadyr);
  const first = modulateThroatSingingPerformance(borbangnadyr, 0.037);
  const repeated = modulateThroatSingingPerformance(borbangnadyr, 0.037);
  const later = modulateThroatSingingPerformance(borbangnadyr, 0.11);
  assert.deepEqual(first, repeated);
  assert.deepEqual(borbangnadyr, snapshot);
  assert.notEqual(first.motionWave, later.motionWave);
  assert.notEqual(first.focusFrequencyHz, later.focusFrequencyHz);
  assert.ok(first.trueFoldHz >= THROAT_SINGING_LIMITS.trueFoldHz[0]);
  assert.ok(first.trueFoldHz <= THROAT_SINGING_LIMITS.trueFoldHz[1]);
  assert.ok(first.intensity >= 0 && first.intensity <= 1);
  assert.ok(first.uvularConstriction >= 0 && first.uvularConstriction <= 1);
  assert.ok(first.focus.f2Hz < first.focus.f3Hz);
  assert.equal(first.harmonicNumber, borbangnadyr.harmonicNumber);
  assert.equal(first.foldFrequencyHz, first.trueFoldHz);
  assert.ok(first.breathPressure >= 0 && first.breathPressure <= 1);
  assert.ok(first.focusAmount >= 0 && first.focusAmount <= 1);
  assert.equal(Object.isFrozen(first), true);

  const gestured = modulateThroatSingingPerformance(borbangnadyr, 0.037, {
    harmonicOffset: 3,
    foldFrequencyHz: 166,
    breathPressure: 0.91,
    focusAmount: 0.99,
    focusOffsetSemitones: 1,
  });
  assert.equal(gestured.harmonicNumber, borbangnadyr.harmonicNumber + 3);
  assert.equal(gestured.foldFrequencyHz, 166);
  assert.equal(gestured.breathPressure, 0.91);
  assert.equal(gestured.focusAmount, 0.99);
  assert.equal(gestured.intensity, 0.91);
  assert.ok(gestured.focusFrequencyHz > gestured.selectedHarmonicHz);

  const ezengileer = throatSingingState("ezengileer");
  assert.notEqual(sampleThroatSingingMotion("stirrup", 0.18), sampleThroatSingingMotion("stirrup", 0.42));
  assert.notEqual(
    modulateThroatSingingPerformance(ezengileer, 0.07).amplitudeScale,
    modulateThroatSingingPerformance(ezengileer, 0.2).amplitudeScale,
  );
});

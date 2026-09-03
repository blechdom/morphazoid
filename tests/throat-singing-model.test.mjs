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
  modulateThroatSingingPerformance,
  sampleThroatSingingMotion,
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
  vocalFryModulationSupercycle,
} from "../src/throat-singing.js";

const expectedPresetIds = [
  "open-drone",
  "sygyt",
  "xoomei",
  "kargyraa",
  "borbangnadyr",
  "ezengileer",
  "western-overtone",
  "low-chant",
];

test("style presets separate a neutral exploration, five Tuvan styles, and two comparisons", () => {
  assert.equal(THROAT_SINGING_PRESETS, THROAT_SINGING_STYLE_PRESETS);
  assert.deepEqual(THROAT_SINGING_STYLE_PRESETS.map(({ id }) => id), expectedPresetIds);
  assert.deepEqual(
    THROAT_SINGING_STYLE_PRESETS.filter(({ isTuvan }) => isTuvan).map(({ id }) => id),
    ["sygyt", "xoomei", "kargyraa", "borbangnadyr", "ezengileer"],
  );
  for (const entry of THROAT_SINGING_STYLE_PRESETS) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.settings), true);
    assert.equal(Object.isFrozen(entry.evidence), true);
    assert.match(entry.evidence.kind, /approximation/i);
    assert.ok(entry.evidence.notice.length > 60);
  }
  assert.match(throatSingingPreset("xoomei").label, /Xöömei.*Khöömei/u);
  assert.match(throatSingingPreset("open-drone").culturalScope, /exploration/i);
  assert.match(throatSingingPreset("western-overtone").culturalScope, /Non-Tuvan/);
  assert.match(throatSingingPreset("low-chant").description, /no claimed Tuvan/i);
  assert.equal(throatSingingPreset("missing").id, "open-drone");
  assert.ok(THROAT_SINGING_STYLE_PRESETS.every(({ settings }) => !("breathiness" in settings)));
});

test("defaults and sanitization are stable, finite, bounded, and alias anatomy terms", () => {
  assert.equal(DEFAULT_THROAT_SINGING_STATE, THROAT_SINGING_DEFAULTS);
  assert.equal(Object.isFrozen(THROAT_SINGING_DEFAULTS), true);
  assert.equal("breathiness" in THROAT_SINGING_LIMITS, false);
  const state = sanitizeThroatSingingState({
    styleId: "not-a-style",
    active: 1,
    trueFoldHz: Infinity,
    falseFoldDivision: 2.6,
    harmonicNumber: 10.7,
    intensity: -8,
    creakAmount: 8,
    formantConvergence: 9,
    pharyngealConstriction: 0.41,
    oralConstriction: 0.73,
    tractLengthCm: 90,
    motionShape: "not-a-wave",
  });
  assert.equal(state.styleId, "open-drone");
  assert.equal(state.active, true);
  assert.equal(state.trueFoldHz, THROAT_SINGING_DEFAULTS.trueFoldHz);
  assert.equal(state.falseFoldDivision, 3);
  assert.equal(state.harmonicNumber, 11);
  assert.equal(state.intensity, THROAT_SINGING_LIMITS.intensity[0]);
  assert.equal(state.creakAmount, THROAT_SINGING_LIMITS.creakAmount[1]);
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

test("the default open drone is gentle while Sygyt remains intentionally selectable", () => {
  const open = throatSingingState();
  const sygyt = throatSingingState("sygyt");
  assert.equal(open.styleId, "open-drone");
  assert.equal(open.harmonicNumber, 8);
  assert.ok(harmonicFrequencyHz(open) <= 1_000);
  assert.ok(open.formantConvergence <= 0.25);
  assert.ok(open.alveolarConstriction <= 0.5);
  assert.ok(open.level <= 0.3);
  assert.equal(dualFocusTargets(open).merged, false);
  assert.equal(sygyt.harmonicNumber, 12);
  assert.equal(harmonicFrequencyHz(sygyt), 1_800);
  assert.ok(sygyt.formantConvergence > 0.9);
});

test("generic Low Chant leaves the ventricular folds effectively open", () => {
  const lowChant = throatSingingState("low-chant");
  assert.ok(lowChant.falseFoldCoupling < FALSE_FOLD_AUDIBILITY_THRESHOLD);
  assert.equal(heardDroneFrequencyHz(lowChant), lowChant.trueFoldHz);
  assert.ok(lowChant.creakAmount > throatSingingState("sygyt").creakAmount);
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

test("vocal-fry modulation is a finite five-cycle pattern distinct from ventricular closure", () => {
  const cycle = vocalFryModulationSupercycle();
  assert.equal(cycle.cycleCount, 5);
  assert.equal(cycle.baseFrequencyRatio, 0.2);
  assert.equal(cycle.real.length, cycle.imaginary.length);
  assert.equal(cycle.real[0], 0);
  assert.equal(cycle.imaginary[0], 0);
  assert.ok(Math.abs(cycle.mean) < 1e-6);
  assert.ok(cycle.minimum < -0.4);
  assert.ok(cycle.maximum > 0.55);
  assert.ok([...cycle.real, ...cycle.imaginary].every(Number.isFinite));

  let reconstructedMinimum = Infinity;
  let reconstructedMaximum = -Infinity;
  for (let index = 0; index < 2048; index += 1) {
    const phase = (index + 0.5) / 2048;
    let sample = 0;
    for (let harmonic = 1; harmonic < cycle.real.length; harmonic += 1) {
      const angle = Math.PI * 2 * harmonic * phase;
      sample += cycle.real[harmonic] * Math.cos(angle)
        + cycle.imaginary[harmonic] * Math.sin(angle);
    }
    reconstructedMinimum = Math.min(reconstructedMinimum, sample);
    reconstructedMaximum = Math.max(reconstructedMaximum, sample);
  }
  assert.ok(reconstructedMinimum > -0.55);
  assert.ok(reconstructedMaximum < 0.7);
  assert.ok(reconstructedMaximum - reconstructedMinimum > 0.8);
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
  assert.equal(config.articulationVoicing, 1);
  assert.equal("exciterBreath" in config, false);
  assert.equal("breathiness" in config.source, false);
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
  assert.ok(first.sourcePressure >= 0 && first.sourcePressure <= 1);
  assert.ok(first.focusAmount >= 0 && first.focusAmount <= 1);
  assert.equal(Object.isFrozen(first), true);

  const gestured = modulateThroatSingingPerformance(borbangnadyr, 0.037, {
    harmonicOffset: 3,
    foldFrequencyHz: 166,
    sourcePressure: 0.91,
    focusAmount: 0.99,
    focusOffsetSemitones: 1,
  });
  assert.equal(gestured.harmonicNumber, borbangnadyr.harmonicNumber + 3);
  assert.equal(gestured.foldFrequencyHz, 166);
  assert.equal(gestured.sourcePressure, 0.91);
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

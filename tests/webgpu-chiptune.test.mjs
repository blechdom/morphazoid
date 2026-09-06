import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_CHIPTUNE_CREDIT,
  WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
  WEBGPU_CHIPTUNE_DEFAULTS,
  WEBGPU_CHIPTUNE_INTEGER_PARAMS,
  WEBGPU_CHIPTUNE_LIMITS,
  WEBGPU_CHIPTUNE_SEQUENCE_ARP_LIMITS,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES,
  WEBGPU_CHIPTUNE_SEQUENCE_NOTE_LIMITS,
  WEBGPU_CHIPTUNE_SEQUENCE_STATES,
  WEBGPU_CHIPTUNE_SEQUENCE_STEPS,
  WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS,
  WEBGPU_CHIPTUNE_OUTPUT_CEILING,
  WEBGPU_CHIPTUNE_PARAM_ORDER,
  WEBGPU_CHIPTUNE_SHADER,
  WEBGPU_CHIPTUNE_WORKGROUP_SIZES,
  WebGpuChiptuneAudio,
  createWebGpuChiptuneSequence,
  formatWebGpuChiptuneValue,
  packWebGpuChiptuneSequence,
  sanitizeWebGpuChiptuneParams,
  sanitizeWebGpuChiptuneSequence,
  webGpuChiptuneBeatSnapshot,
  webGpuChiptuneParamArray,
  webGpuChiptuneParamFromUnit,
  webGpuChiptuneParamToUnit,
  webGpuChiptuneProceduralLaneValue,
  webGpuChiptunePatternValue,
  webGpuChiptuneScaleLock,
  webGpuChiptuneSequenceCellAtBeat,
  webGpuChiptuneSequenceCellIndex,
  webGpuChiptuneStageSnapshot,
  webGpuChiptuneStepSnapshot,
  webGpuChiptuneSupport,
} from "../src/webgpu-chiptune.js";

const root = new URL("../", import.meta.url);
const near = (actual, expected, epsilon = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    String(actual) + " should be within " + String(epsilon) + " of " + String(expected),
  );
};

test("WebGPU Chiptune preserves exact source credit and active parameter order", () => {
  assert.deepEqual(WEBGPU_CHIPTUNE_CREDIT, {
    sourceTitle: "Chiptune (sound)",
    creator: "srtuss",
    year: 2015,
    platform: "Shadertoy",
    shaderId: "MljSRt",
    href: "https://www.shadertoy.com/view/MljSRt",
  });
  assert.equal(WEBGPU_CHIPTUNE_PARAM_ORDER.length, 150);
  assert.deepEqual(WEBGPU_CHIPTUNE_PARAM_ORDER, [
    "tempo",
    "transpose",
    "patternSeed",
    "pitchRange",
    "gateRate",
    "gateLength",
    "pulseWidth",
    "pwmDepth",
    "pwmRate",
    "upperOneLevel",
    "upperTwoLevel",
    "bassPulseLevel",
    "bassSineLevel",
    "leadLevel",
    "arpLevel",
    "noiseLevel",
    "stereoWidth",
    "kickLevel",
    "snareLevel",
    "hatLevel",
    "shakerLevel",
    "kickTone",
    "snareTone",
    "drumDecay",
    "drumMix",
    "ghostDrums",
    "echoTaps",
    "echoTime",
    "echoDecay",
    "echoStereo",
    "fadeIn",
    "gain",
    "scaleMask",
    "upperOneSpan",
    "upperTwoSpan",
    "bassSpan",
    "upperOneRegister",
    "bassRegister",
    "arpRegister",
    "sectionUnits",
    "pitchClock",
    "bassClock",
    "gateFastRatio",
    "gateSwitchShortUnits",
    "gateSwitchLongUnits",
    "leadTrillRate",
    "leadInterval",
    "leadPhraseUnits",
    "arpRate",
    "arpSpan",
    "arpOctaveRate",
    "arpOctaves",
    "bassPulseWidth",
    "drumRate",
    "echoCrossfeed",
    "gateAttack",
    "gateRelease",
    "texturePeriod",
    "textureDecay",
    "kickCycle",
    "kickSubcycle",
    "snareNoiseMix",
    "hatBalance",
    "ghostDelayDivisor",
    "ghostPan",
    "gateA0",
    "gateA1",
    "gateA2",
    "gateA3",
    "gateB0",
    "gateB1",
    "gateB2",
    "gateB3",
    "gatePatternSteps",
    "gateShortRatio",
    "gateLongRatio",
    "fastGateShare",
    "longGateBoostShare",
    "leadSectionShare",
    "leadTrillShare",
    "tuningCents",
    "upperTwoRegister",
    "leadRegister",
    "leadClock",
    "leadSpan",
    "arpBassFollow",
    "voiceCrossfeed",
    "synthMix",
    "fadeCurve",
    "echoAlternate",
    "snareCycle",
    "snarePhase",
    "hatACycle",
    "hatASubcycle",
    "hatARepeat",
    "hatAPhase",
    "hatBCycle",
    "shakerCycle",
    "shakerPhase",
    "noiseRate",
    "noiseColor",
    "textureSweep",
    "kickBodyPhase",
    "kickTransientPhase",
    "kickBodySweep",
    "kickTransientSweep",
    "kickAttackTime",
    "kickDecayRate",
    "kickClipKnee",
    "snareHoldTime",
    "snareDecayRate",
    "snareNoiseSweep",
    "snareNoiseRate",
    "snareModRate",
    "snareModDepth",
    "snareCarrierRate",
    "hatANoiseRate",
    "hatADecayRate",
    "hatBLowNoiseRate",
    "hatBHighNoiseRate",
    "hatBHighMix",
    "hatBDecayRate",
    "shakerNoiseRate",
    "shakerDecayRate",
    "upperTwoClockRatio",
    "kickPhase",
    "hatBPhase",
    "hatARepeatPhase",
    "arpPhase",
    "echoWet",
    "arpGateDepth",
    "bassGateRateRatio",
    "leadGateRateRatio",
    "upperTwoGateRateRatio",
    "snareNoiseColor",
    "hatANoiseColor",
    "hatBNoiseColor",
    "shakerNoiseColor",
    "upperOnePhase",
    "upperTwoPhase",
    "bassPhase",
    "leadPhase",
    "gatePatternPhase",
    "gateSwitchShortPhase",
    "gateSwitchLongPhase",
    "sectionPhase",
    "leadTrillPhase",
    "leadPhrasePhase",
    "arpOctavePhase",
    "texturePhase",
  ]);
  assert.ok(Object.isFrozen(WEBGPU_CHIPTUNE_PARAM_ORDER));
  assert.ok(Object.isFrozen(WEBGPU_CHIPTUNE_INTEGER_PARAMS));
  assert.deepEqual(Object.keys(WEBGPU_CHIPTUNE_DEFAULTS), WEBGPU_CHIPTUNE_PARAM_ORDER);
  assert.deepEqual(Object.keys(WEBGPU_CHIPTUNE_LIMITS), WEBGPU_CHIPTUNE_PARAM_ORDER);
  const struct = WEBGPU_CHIPTUNE_SHADER.match(/struct AudioParam \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const shaderFields = [...struct.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*): f32,/gm)]
    .map((match) => match[1]);
  assert.deepEqual(shaderFields, WEBGPU_CHIPTUNE_PARAM_ORDER);
  assert.deepEqual(Object.keys(WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS),
    WEBGPU_CHIPTUNE_PARAM_ORDER);

  const requested = Object.fromEntries(
    WEBGPU_CHIPTUNE_PARAM_ORDER.map((key, index) => [key, index / 10]),
  );
  const sanitized = sanitizeWebGpuChiptuneParams(requested);
  const packed = webGpuChiptuneParamArray(requested);
  assert.ok(packed instanceof Float32Array);
  assert.equal(packed.length, WEBGPU_CHIPTUNE_PARAM_ORDER.length);
  assert.equal(packed.byteLength, 600);
  WEBGPU_CHIPTUNE_PARAM_ORDER.forEach((key, index) => {
    near(packed[index], sanitized[key], 1e-5);
  });
});

test("WebGPU Chiptune defaults retain the active Shadertoy song", () => {
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.tempo, 1.3);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.patternSeed, 1.79425579);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.pulseWidth, 0.4);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.pwmDepth, 0.25);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.pwmRate, 0.3);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.echoTaps, 8);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.echoTime, 0.33);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.echoDecay, 0.3);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.fadeIn, 1);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.gain, 0.8);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.scaleMask, 1717);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.upperOneSpan, 20);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.bassRegister, -36);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.leadInterval, 7);
  assert.equal(WEBGPU_CHIPTUNE_DEFAULTS.drumRate, 1);
  const extractedDefaults = {
    gatePatternSteps: 32,
    gateShortRatio: 0.8,
    gateLongRatio: 2,
    fastGateShare: 0.5,
    longGateBoostShare: 0.5,
    leadSectionShare: 0.5,
    leadTrillShare: 0.5,
    tuningCents: 0,
    upperTwoRegister: 0,
    leadRegister: 0,
    leadClock: 4,
    leadSpan: 10,
    arpBassFollow: 1,
    voiceCrossfeed: 0.5,
    synthMix: 1,
    fadeCurve: 2,
    echoAlternate: 1,
    snareCycle: 1,
    snarePhase: 0.5,
    hatACycle: 2,
    hatASubcycle: 0.625,
    hatARepeat: 0.25,
    hatAPhase: 0.125,
    hatBCycle: 0.5,
    shakerCycle: 0.5,
    shakerPhase: 0.5,
    noiseRate: 4000,
    noiseColor: 1,
    textureSweep: 1,
    kickBodyPhase: 400,
    kickTransientPhase: 200,
    kickBodySweep: 1,
    kickTransientSweep: 100,
    kickAttackTime: 0.1,
    kickDecayRate: 10,
    kickClipKnee: 0.2,
    snareHoldTime: 0.1,
    snareDecayRate: 10,
    snareNoiseSweep: 1,
    snareNoiseRate: 4,
    snareModRate: 100,
    snareModDepth: 5,
    snareCarrierRate: 2000,
    hatANoiseRate: 4,
    hatADecayRate: 25,
    hatBLowNoiseRate: 2,
    hatBHighNoiseRate: 100,
    hatBHighMix: 0.3,
    hatBDecayRate: 4,
    shakerNoiseRate: 9,
    shakerDecayRate: 8,
    upperTwoClockRatio: 1,
    kickPhase: 0,
    hatBPhase: 0,
    hatARepeatPhase: 0,
    arpPhase: 0,
    echoWet: 1,
    arpGateDepth: 0,
    bassGateRateRatio: 1,
    leadGateRateRatio: 1,
    upperTwoGateRateRatio: 1,
    snareNoiseColor: 1,
    hatANoiseColor: 1,
    hatBNoiseColor: 1,
    shakerNoiseColor: 1,
    upperOnePhase: 0,
    upperTwoPhase: 0,
    bassPhase: 0,
    leadPhase: 0,
    gatePatternPhase: 0,
    gateSwitchShortPhase: 0,
    gateSwitchLongPhase: 0,
    sectionPhase: 0,
    leadTrillPhase: 0,
    leadPhrasePhase: 0,
    arpOctavePhase: 0,
    texturePhase: 0,
  };
  assert.deepEqual(
    Object.fromEntries(Object.keys(extractedDefaults)
      .map((key) => [key, WEBGPU_CHIPTUNE_DEFAULTS[key]])),
    extractedDefaults,
  );
  assert.deepEqual(
    ["gateA0", "gateA1", "gateA2", "gateA3"].map((key) => WEBGPU_CHIPTUNE_DEFAULTS[key]),
    [12547, 784, 8323, 8754],
  );
  assert.equal(formatWebGpuChiptuneValue("tempo", 1.3), "78 BPM");
  assert.equal(formatWebGpuChiptuneValue("pwmRate", 0.3), "0.30 rad/s");
  assert.equal(formatWebGpuChiptuneValue("scaleMask", 1717), "0x6B5");
  assert.equal(formatWebGpuChiptuneValue("kickBodyPhase", 400), "400");
  assert.equal(formatWebGpuChiptuneValue("kickAttackTime", 0.1), "100 ms");
  assert.equal(formatWebGpuChiptuneValue("sectionUnits", 3.5), "3.50 master beats");
  assert.equal(formatWebGpuChiptuneValue("kickCycle", 1.25), "1.25 drum-clock units");
  assert.equal(formatWebGpuChiptuneValue("arpSpan", 8.25), "8.25 notes");
});

test("WebGPU Chiptune sanitizes hostile parameters and keeps taps bounded", () => {
  const sanitized = sanitizeWebGpuChiptuneParams({
    tempo: -99,
    transpose: 400,
    patternSeed: Number.NaN,
    pitchRange: Number.POSITIVE_INFINITY,
    gateLength: 99,
    pulseWidth: -2,
    pwmDepth: 4,
    kickLevel: -5,
    drumDecay: 0,
    echoTaps: 900,
    echoTime: -10,
    echoDecay: 9,
    gain: 5,
    scaleMask: 0,
    gateA0: 100000,
  });
  assert.equal(sanitized.tempo, 0.25);
  assert.equal(sanitized.transpose, 12);
  assert.equal(sanitized.patternSeed, WEBGPU_CHIPTUNE_DEFAULTS.patternSeed);
  assert.equal(sanitized.pitchRange, WEBGPU_CHIPTUNE_DEFAULTS.pitchRange);
  assert.equal(sanitized.gateLength, 4);
  assert.equal(sanitized.pulseWidth, 0.05);
  near(sanitized.pwmDepth, 0.03);
  assert.equal(sanitized.kickLevel, 0);
  assert.equal(sanitized.drumDecay, 0.125);
  assert.equal(sanitized.echoTaps, 8);
  assert.equal(sanitizeWebGpuChiptuneParams({ echoTaps: 2.6 }).echoTaps, 3);
  assert.equal(sanitized.echoTime, 0.01);
  assert.equal(sanitized.echoDecay, 0.88);
  assert.equal(sanitized.gain, 1);
  assert.equal(sanitized.scaleMask, 1);
  assert.equal(sanitized.gateA0, 65535);

  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER) {
    assert.ok(Number.isFinite(sanitized[key]), key + " must remain finite");
  }
  assert.deepEqual(WEBGPU_CHIPTUNE_WORKGROUP_SIZES, [32, 64, 128, 256]);
  const audio = new WebGpuChiptuneAudio({}, { chunkDuration: 99, workgroupSize: 7 });
  assert.equal(audio.chunkDurationInSeconds, 0.5);
  assert.equal(audio.workgroupSize, 256);
});

test("coupled shader limits remain physically and rhythmically valid", () => {
  const sanitized = sanitizeWebGpuChiptuneParams({
    pulseWidth: 0.05,
    pwmDepth: 0.45,
    kickCycle: 0.5,
    kickSubcycle: 4,
    hatACycle: 0.5,
    hatASubcycle: 2.5,
    hatARepeat: 1,
    gatePatternSteps: 1.4,
    gateA0: 1,
    gateB0: 0,
    gateShortRatio: 0.1,
    gateLength: 0.2,
    gateRelease: 2,
    upperTwoRegister: 2.6,
    leadRegister: -2.6,
    leadSpan: 8.6,
    echoAlternate: 0.51,
  });
  near(sanitized.pwmDepth, 0.03);
  assert.equal(sanitized.kickSubcycle, 0.5);
  assert.equal(sanitized.hatASubcycle, 0.5);
  assert.equal(sanitized.hatARepeat, 0.5);
  assert.equal(sanitized.gateRelease, 0.05);
  assert.equal(sanitized.gatePatternSteps, 1);
  assert.equal(sanitized.upperTwoRegister, 3);
  assert.equal(sanitized.leadRegister, -3);
  assert.equal(sanitized.leadSpan, 9);
  assert.ok(!WEBGPU_CHIPTUNE_INTEGER_PARAMS.includes("arpSpan"));
  assert.equal(sanitized.echoAlternate, 1);
});

test("control distributions map low and high values monotonically and reversibly", () => {
  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER) {
    const [minimum, maximum] = WEBGPU_CHIPTUNE_LIMITS[key];
    const values = [
      webGpuChiptuneParamFromUnit(key, 0),
      webGpuChiptuneParamFromUnit(key, 0.25),
      webGpuChiptuneParamFromUnit(key, 0.5),
      webGpuChiptuneParamFromUnit(key, 0.75),
      webGpuChiptuneParamFromUnit(key, 1),
    ];
    assert.ok(values.every(Number.isFinite), key + " mapping must remain finite");
    for (let index = 1; index < values.length; index += 1) {
      assert.ok(values[index] >= values[index - 1], key + " mapping must be monotonic");
    }
    for (const physical of [minimum, WEBGPU_CHIPTUNE_DEFAULTS[key], maximum]) {
      const unit = webGpuChiptuneParamToUnit(key, physical);
      assert.ok(unit >= 0 && unit <= 1, key + " unit value must be bounded");
      const restored = webGpuChiptuneParamFromUnit(key, unit);
      if (WEBGPU_CHIPTUNE_INTEGER_PARAMS.includes(key)) {
        assert.equal(restored, Math.round(physical), key);
      } else {
        near(restored, physical, 1e-7);
      }
    }
  }
  assert.equal(WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS.echoDecay, "linear");
  assert.equal(WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS.sectionUnits, "log");
  near(webGpuChiptuneParamFromUnit("sectionUnits", 0.5), Math.sqrt(128));
  near(webGpuChiptuneParamFromUnit("echoDecay", 0.5), 0.44);
  assert.equal(WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS.echoCrossfeed, "linear");
  near(webGpuChiptuneParamFromUnit("echoCrossfeed", 0.5), 0.5);
  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER.filter(
    (candidate) => WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS[candidate] === "db",
  )) {
    const maximum = WEBGPU_CHIPTUNE_LIMITS[key][1];
    const reference = maximum > 1 ? 1 : maximum;
    const floorValue = reference * 0.001;
    const floorUnit = webGpuChiptuneParamToUnit(key, floorValue);
    assert.ok(floorUnit > 0, key + " must keep zero separate from its -60 dB floor");
    near(webGpuChiptuneParamFromUnit(key, floorUnit), floorValue, 1e-9);
    assert.equal(webGpuChiptuneParamFromUnit(key, 0), 0);
  }
  near(webGpuChiptuneParamFromUnit("noiseRate", 0.5), 2000);
  for (const key of [
    "gateFastRatio",
    "gateShortRatio",
    "gateLongRatio",
    "upperTwoClockRatio",
    "bassGateRateRatio",
    "leadGateRateRatio",
    "upperTwoGateRateRatio",
  ]) {
    assert.equal(WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS[key], "log");
    const [minimum, maximum] = WEBGPU_CHIPTUNE_LIMITS[key];
    near(webGpuChiptuneParamFromUnit(key, 0.5), Math.sqrt(minimum * maximum));
  }
  assert.equal(webGpuChiptuneParamFromUnit("tuningCents", 0.5), 0);
  near(webGpuChiptuneParamToUnit("synthMix", 1), 0.75);
  near(webGpuChiptuneParamFromUnit("synthMix", 0.75), 1);
  assert.equal(webGpuChiptuneParamFromUnit("echoAlternate", 0.49), 0);
  assert.equal(webGpuChiptuneParamFromUnit("echoAlternate", 0.51), 1);
});

test("procedural sequence helpers match scale and fast lead/arpeggio substeps", () => {
  assert.equal(webGpuChiptuneScaleLock(1), 0);
  assert.equal(webGpuChiptuneScaleLock(3), 2);
  assert.equal(webGpuChiptuneScaleLock(-1), -2);
  assert.equal(webGpuChiptuneScaleLock(0, 2), 1);
  assert.equal(webGpuChiptuneScaleLock(11, 1), 12);
  near(webGpuChiptunePatternValue(7), (49 * WEBGPU_CHIPTUNE_DEFAULTS.patternSeed) % 1);

  const early = webGpuChiptuneStepSnapshot(3, WEBGPU_CHIPTUNE_DEFAULTS, 0.1);
  const late = webGpuChiptuneStepSnapshot(3, WEBGPU_CHIPTUNE_DEFAULTS, 0.9);
  assert.equal(early.upperOne, late.upperOne);
  assert.equal(early.upperTwo, late.upperTwo);
  assert.equal(early.bass, late.bass);
  assert.notEqual(early.lead, late.lead);
  assert.notEqual(early.arp, late.arp);
  for (const value of Object.values(early).concat(Object.values(late))) {
    assert.ok(Number.isFinite(value));
  }
  const upperShift = webGpuChiptuneStepSnapshot(3, {
    ...WEBGPU_CHIPTUNE_DEFAULTS,
    upperTwoRegister: 12,
  }, 0.1);
  assert.equal(upperShift.upperOne, early.upperOne);
  assert.equal(upperShift.upperTwo, early.upperTwo + 12);
  assert.equal(upperShift.lead, early.lead);

  const leadShift = webGpuChiptuneStepSnapshot(3, {
    ...WEBGPU_CHIPTUNE_DEFAULTS,
    leadRegister: 12,
  }, 0.1);
  assert.equal(leadShift.upperTwo, early.upperTwo);
  assert.equal(leadShift.lead, early.lead + 12);

  const tuned = webGpuChiptuneStepSnapshot(3, {
    ...WEBGPU_CHIPTUNE_DEFAULTS,
    tuningCents: 50,
  }, 0.1);
  for (const key of ["upperOne", "upperTwo", "bass", "lead", "arp"]) {
    near(tuned[key], early[key] + 0.5);
  }

  const defaultSequence = Array.from({ length: 32 }, (_, step) =>
    webGpuChiptuneStepSnapshot(step, WEBGPU_CHIPTUNE_DEFAULTS, 0.1));
  const independentLead = Array.from({ length: 32 }, (_, step) =>
    webGpuChiptuneStepSnapshot(step, {
      ...WEBGPU_CHIPTUNE_DEFAULTS,
      leadClock: 7,
      leadSpan: 19,
    }, 0.1));
  assert.deepEqual(independentLead.map(({ upperTwo }) => upperTwo),
    defaultSequence.map(({ upperTwo }) => upperTwo));
  assert.notDeepEqual(independentLead.map(({ lead }) => lead),
    defaultSequence.map(({ lead }) => lead));

  const noBassFollow = webGpuChiptuneStepSnapshot(4, {
    ...WEBGPU_CHIPTUNE_DEFAULTS,
    arpBassFollow: 0,
  });
  const bassBasis = webGpuChiptuneStepSnapshot(4).bass
    - WEBGPU_CHIPTUNE_DEFAULTS.bassRegister;
  near(webGpuChiptuneStepSnapshot(4).arp - noBassFollow.arp, bassBasis);
});

test("sequence schema sanitizes, freezes, and packs five 32-cell lanes", () => {
  assert.equal(WEBGPU_CHIPTUNE_SEQUENCE_STEPS, 32);
  assert.deepEqual(WEBGPU_CHIPTUNE_SEQUENCE_LANES, [
    "upperOne",
    "upperTwo",
    "bass",
    "lead",
    "arp",
  ]);
  assert.deepEqual(WEBGPU_CHIPTUNE_SEQUENCE_STATES, {
    auto: 0,
    note: 1,
    rest: 2,
  });
  assert.deepEqual(WEBGPU_CHIPTUNE_SEQUENCE_NOTE_LIMITS, [-72, 72]);
  assert.deepEqual(WEBGPU_CHIPTUNE_SEQUENCE_ARP_LIMITS, [0, 1]);
  assert.ok(Object.isFrozen(WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE));
  for (const lane of WEBGPU_CHIPTUNE_SEQUENCE_LANES) {
    const laneState = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE.lanes[lane];
    assert.equal(laneState.activeLength, 32);
    assert.equal(laneState.cells.length, 32);
    assert.ok(Object.isFrozen(laneState));
    assert.ok(Object.isFrozen(laneState.cells));
    assert.ok(Object.isFrozen(laneState.cells[0]));
    assert.deepEqual(laneState.cells[0], { state: "auto", value: 0 });
  }

  const fresh = createWebGpuChiptuneSequence();
  assert.notEqual(fresh, WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE);
  assert.deepEqual(fresh, WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE);
  assert.equal(sanitizeWebGpuChiptuneSequence(fresh), fresh);

  const sequence = sanitizeWebGpuChiptuneSequence({
    lanes: {
      upperOne: {
        activeLength: 2.6,
        cells: [
          { state: 1, value: 999 },
          { state: 2, value: -999 },
          { state: "unknown", value: Number.NaN },
        ],
      },
      upperTwo: { activeLength: 0 },
      arp: {
        activeLength: 99,
        cells: [{ state: "note", value: 9 }],
      },
    },
  });
  assert.equal(sequence.lanes.upperOne.activeLength, 3);
  assert.equal(sequence.lanes.upperTwo.activeLength, 1);
  assert.equal(sequence.lanes.bass.activeLength, 32);
  assert.equal(sequence.lanes.arp.activeLength, 32);
  assert.deepEqual(sequence.lanes.upperOne.cells.slice(0, 3), [
    { state: "note", value: 72 },
    { state: "rest", value: -72 },
    { state: "auto", value: 0 },
  ]);
  assert.deepEqual(sequence.lanes.arp.cells[0], { state: "note", value: 1 });

  const packed = packWebGpuChiptuneSequence(sequence, 7.9);
  assert.ok(packed.meta instanceof Uint32Array);
  assert.equal(packed.meta.byteLength, 48);
  assert.deepEqual([...packed.meta.slice(0, 9)], [1, 7, 5, 32, 3, 1, 32, 32, 32]);
  assert.ok(packed.cells instanceof ArrayBuffer);
  assert.equal(packed.cells.byteLength, 5 * 32 * 16);
  const view = new DataView(packed.cells);
  assert.equal(view.getFloat32(0, true), 72);
  assert.equal(view.getUint32(4, true), WEBGPU_CHIPTUNE_SEQUENCE_STATES.note);
  assert.equal(view.getUint32(16 + 4, true), WEBGPU_CHIPTUNE_SEQUENCE_STATES.rest);
  const arpOffset = 4 * 32 * 16;
  assert.equal(view.getFloat32(arpOffset, true), 1);
  assert.equal(view.getUint32(arpOffset + 4, true), WEBGPU_CHIPTUNE_SEQUENCE_STATES.note);
  assert.equal(view.getUint32(arpOffset + 8, true), 0);
  assert.equal(view.getUint32(arpOffset + 12, true), 0);

  for (const key of [
    "snarePhase",
    "hatAPhase",
    "shakerPhase",
    "kickPhase",
    "hatBPhase",
    "hatARepeatPhase",
    "arpPhase",
    "upperOnePhase",
    "upperTwoPhase",
    "bassPhase",
    "leadPhase",
    "gatePatternPhase",
    "gateSwitchShortPhase",
    "gateSwitchLongPhase",
    "sectionPhase",
    "leadTrillPhase",
    "leadPhrasePhase",
    "arpOctavePhase",
    "texturePhase",
  ]) {
    assert.equal(WEBGPU_CHIPTUNE_LIMITS[key][1], 127 / 128, key);
  }
});

test("sequence clocks wrap while AUTO, NOTE, REST, and Arp contour stay independent", () => {
  const params = {
    ...WEBGPU_CHIPTUNE_DEFAULTS,
    pitchClock: 1,
    upperTwoClockRatio: 2,
    upperOnePhase: 0,
    upperTwoPhase: 0,
    scaleMask: 4095,
    upperOneRegister: 0,
    transpose: 0,
    tuningCents: 0,
  };
  const sequence = sanitizeWebGpuChiptuneSequence({
    lanes: {
      upperOne: {
        activeLength: 3,
        cells: [
          { state: "note", value: 12 },
          { state: "rest", value: 0 },
          { state: "auto", value: 0 },
          { state: "note", value: -12 },
        ],
      },
      upperTwo: { activeLength: 4 },
    },
  });
  assert.equal(webGpuChiptuneSequenceCellIndex("upperOne", 0, params, sequence), 0);
  assert.equal(webGpuChiptuneSequenceCellIndex("upperOne", 1, params, sequence), 1);
  assert.equal(webGpuChiptuneSequenceCellIndex("upperOne", 2, params, sequence), 2);
  assert.equal(webGpuChiptuneSequenceCellIndex("upperOne", 3, params, sequence), 0);
  assert.equal(webGpuChiptuneSequenceCellIndex("upperOne", -0.01, params, sequence), 2);
  assert.equal(webGpuChiptuneSequenceCellIndex("upperTwo", 0.5, params, sequence), 1);
  assert.throws(() => webGpuChiptuneSequenceCellIndex("nope", 0), RangeError);
  assert.equal(webGpuChiptuneSequenceCellAtBeat("upperOne", 1, params, sequence).state, "rest");

  assert.equal(webGpuChiptuneBeatSnapshot(0, params, sequence).upperOne, 12);
  assert.ok(Number.isNaN(webGpuChiptuneBeatSnapshot(1, params, sequence).upperOne));
  near(
    webGpuChiptuneBeatSnapshot(2, params, sequence).upperOne,
    webGpuChiptuneBeatSnapshot(2, params).upperOne,
  );
  const baseline = webGpuChiptuneBeatSnapshot(1, params);
  const rested = webGpuChiptuneBeatSnapshot(1, params, sequence);
  for (const lane of ["upperTwo", "bass", "lead", "arp"]) near(rested[lane], baseline[lane]);

  const expanded = sanitizeWebGpuChiptuneSequence({
    lanes: {
      ...sequence.lanes,
      upperOne: { ...sequence.lanes.upperOne, activeLength: 4 },
    },
  });
  assert.equal(expanded.lanes.upperOne.cells[3].value, -12);
  assert.equal(webGpuChiptuneBeatSnapshot(3, params, expanded).upperOne, -12);
  assert.equal(webGpuChiptuneSequenceCellIndex(
    "upperOne",
    0,
    { ...params, upperOnePhase: 0.25 },
    expanded,
  ), 1);
  const shortAuto = sanitizeWebGpuChiptuneSequence({
    lanes: {
      upperOne: { activeLength: 8 },
    },
  });
  const quarterPhase = {
    ...params,
    upperOnePhase: 0.25,
    upperOneSpan: 20,
    pitchRange: 1,
    patternSeed: WEBGPU_CHIPTUNE_DEFAULTS.patternSeed,
  };
  const shortGenerated = webGpuChiptuneProceduralLaneValue(
    "upperOne",
    0,
    quarterPhase,
    shortAuto,
  );
  assert.equal(
    shortGenerated,
    Math.floor(webGpuChiptunePatternValue(2) * quarterPhase.upperOneSpan),
  );
  const fullGenerated = webGpuChiptuneProceduralLaneValue(
    "upperOne",
    0,
    quarterPhase,
  );
  assert.equal(
    fullGenerated,
    Math.floor(webGpuChiptunePatternValue(8) * quarterPhase.upperOneSpan),
  );

  const arpParams = {
    ...params,
    arpSpan: 12,
    pitchRange: 1,
    arpBassFollow: 0,
    arpOctaves: 0,
    arpRegister: 0,
  };
  const arpNote = sanitizeWebGpuChiptuneSequence({
    lanes: {
      arp: {
        activeLength: 1,
        cells: [{ state: "note", value: 0.5 }],
      },
    },
  });
  assert.equal(webGpuChiptuneBeatSnapshot(0, arpParams, arpNote).arp, 6);
  const arpRest = sanitizeWebGpuChiptuneSequence({
    lanes: {
      arp: {
        activeLength: 1,
        cells: [{ state: "rest", value: 0.5 }],
      },
    },
  });
  assert.ok(Number.isNaN(webGpuChiptuneBeatSnapshot(0, arpParams, arpRest).arp));
});

test("WebGPU Chiptune pixel-stage snapshots use the shared deterministic voice clocks", () => {
  const time = 1.375;
  const snapshot = webGpuChiptuneStageSnapshot(time);
  assert.deepEqual(snapshot, webGpuChiptuneStageSnapshot(time));
  assert.equal(snapshot.masterBeat, time * WEBGPU_CHIPTUNE_DEFAULTS.tempo);
  assert.deepEqual(
    snapshot.actors.map(({ key }) => key),
    WEBGPU_CHIPTUNE_SEQUENCE_LANES,
  );
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.actors));
  assert.ok(Object.isFrozen(snapshot.drums));
  for (const actor of snapshot.actors) {
    assert.equal(
      actor.cellIndex,
      webGpuChiptuneSequenceCellIndex(
        actor.key,
        snapshot.masterBeat,
        WEBGPU_CHIPTUNE_DEFAULTS,
        WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
      ),
    );
    for (const key of [
      "clockRate", "activeLength", "cellIndex", "cellValue", "stepPhase",
      "gate", "activity", "levelUnit", "size", "hue", "shape", "bounce", "frame",
    ]) {
      assert.ok(Number.isFinite(actor[key]), actor.key + "." + key + " must be finite");
    }
    for (const key of [
      "stepPhase", "gate", "activity", "levelUnit", "size", "hue", "shape", "bounce",
    ]) {
      assert.ok(actor[key] >= 0 && actor[key] <= 1, actor.key + "." + key + " must be normalized");
    }
  }
  assert.doesNotThrow(() => JSON.stringify(snapshot));

  const phaseShifted = webGpuChiptuneStageSnapshot(time, {
    ...WEBGPU_CHIPTUNE_DEFAULTS,
    upperOnePhase: 0.5,
  });
  assert.notEqual(phaseShifted.actors[0].stepPhase, snapshot.actors[0].stepPhase);
  assert.deepEqual(
    phaseShifted.actors.slice(1).map(({ stepPhase }) => stepPhase),
    snapshot.actors.slice(1).map(({ stepPhase }) => stepPhase),
  );
});

test("WebGPU Chiptune pixel actors expose rests and perceptually distributed level changes", () => {
  const resting = sanitizeWebGpuChiptuneSequence({
    lanes: {
      upperOne: {
        activeLength: 1,
        cells: [{ state: "rest", value: 72 }],
      },
    },
  });
  const restActor = webGpuChiptuneStageSnapshot(0.5, {}, resting).actors[0];
  assert.equal(restActor.cellState, "rest");
  assert.equal(restActor.note, null);
  assert.equal(restActor.activity, 0);
  assert.equal(restActor.bounce, 0);

  const quiet = webGpuChiptuneStageSnapshot(0.5, { upperOneLevel: 0 }).actors[0];
  const loud = webGpuChiptuneStageSnapshot(0.5, { upperOneLevel: 2 }).actors[0];
  assert.ok(loud.levelUnit > quiet.levelUnit);
  assert.ok(loud.size > quiet.size);
  assert.ok(loud.activity >= quiet.activity);
});

test("WGSL renders a bounded stereo active path without dormant source branches", () => {
  assert.equal(WEBGPU_CHIPTUNE_OUTPUT_CEILING, 0.88);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /Chiptune \(sound\).*srtuss \(2015\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /shadertoy\.com\/view\/MljSRt/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@compute/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@workgroup_size\(WORKGROUP_SIZE\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /sound_chunk: array<vec2<f32>>/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@binding\(2\) var<storage, read> audio_param/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@binding\(3\) var<uniform> sequence_meta/);
  assert.match(WEBGPU_CHIPTUNE_SHADER,
    /@binding\(4\) var<storage, read>\s+sequence_cells: array<SequenceCell, 160>/);
  assert.match(WEBGPU_CHIPTUNE_SHADER,
    /let local_index = min\(u32\(max\(floor\(position\), 0\.0\)\), length - 1u\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /fn synthVoices/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /let t = modulo\(t_source - offset, pattern_period\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /let next_t = t - pattern_period/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /return max\(current_gate, next_gate\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /fn beatTwo/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /for \(var tap = 0u; tap < 8u; tap \+= 1u\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.ghostDelayDivisor/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /fn packedGateDuration/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.scaleMask/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.echoCrossfeed/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.drumRate/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /const OUTPUT_CEILING: f32 = 0\.88/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /return clamp\(output, vec2\(-OUTPUT_CEILING\), vec2\(OUTPUT_CEILING\)\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /frequency \/ SAMPLE_RATE/);
  assert.match(WEBGPU_CHIPTUNE_SHADER,
    /return clamp\(frequency, 20\.0, SAMPLE_RATE \* 0\.45\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER,
    /let pattern_steps = u32\(clamp\(round\(p\.gatePatternSteps\), 1\.0, 32\.0\)\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /return clamp\(value, 0\.0, 1\.0\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /p\.echoAlternate >= 0\.5/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /max\(p\.fadeCurve, 0\.01\)/);
  const activeShader = WEBGPU_CHIPTUNE_SHADER.replace(
    /struct AudioParam \{[\s\S]*?\n\}/,
    "",
  );
  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER) {
    assert.match(activeShader, new RegExp("\\bp\\." + key + "\\b"), key + " must affect WGSL");
  }
  assert.doesNotMatch(WEBGPU_CHIPTUNE_SHADER, /fn adsr|fn oscc|fn osc\(|fn beat\(/);
});

test("WebGPU Chiptune output is gated independently from transport", () => {
  const events = [];
  const audio = new WebGpuChiptuneAudio({});
  audio.context = { currentTime: 4 };
  audio.master = {
    gain: {
      setTargetAtTime(value, time, constant) {
        events.push({ value, time, constant });
      },
    },
  };

  audio.setOutput(0.62);
  assert.equal(events.at(-1).value, 0);
  audio.setPlaybackEnabled(true);
  assert.equal(events.at(-1).value, 0.62);
  audio.setOutput(0.31);
  assert.equal(events.at(-1).value, 0.31);
  audio.setPlaybackEnabled(false);
  assert.equal(events.at(-1).value, 0);
  assert.deepEqual(webGpuChiptuneSupport({}), {
    audio: false,
    webgpu: false,
    supported: false,
  });
});

test("start options preserve offsets and failed setup releases owned audio", async () => {
  const destination = {};
  const sharedContext = {
    currentTime: 2,
    sampleRate: 48000,
    state: "running",
    createGain() {
      return {
        gain: { value: 0 },
        connect() {},
        disconnect() {},
      };
    },
  };
  const runtime = { navigator: { gpu: { requestAdapter() {} } } };
  const shared = new WebGpuChiptuneAudio(runtime);
  shared.initGpu = async () => {
    shared.device = {};
  };
  await shared.start({ context: sharedContext, destination, offset: 12, autoStart: false });
  assert.equal(shared.renderOffset, 12);
  assert.equal(shared.ownsContext, false);
  await shared.stop();

  let closeCount = 0;
  class OwnedContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = "running";
    }
    async close() {
      closeCount += 1;
      this.state = "closed";
    }
  }
  const owned = new WebGpuChiptuneAudio({
    AudioContext: OwnedContext,
    navigator: { gpu: { requestAdapter() {} } },
  });
  owned.createAudioGraph = () => {};
  owned.initGpu = async () => {
    throw new Error("GPU setup failed");
  };
  await assert.rejects(owned.start(WEBGPU_CHIPTUNE_DEFAULTS, { autoStart: false }), /GPU setup failed/);
  assert.equal(closeCount, 1);
  assert.equal(owned.context, null);
  assert.equal(owned.device, null);
});

test("restartTimeline primes one exact stereo chunk and cleanup stops it", async () => {
  const starts = [];
  const disconnects = [];
  const stops = [];
  const timers = [];
  const context = {
    currentTime: 10,
    sampleRate: 20,
    createBuffer() {
      const channels = [new Float32Array(2), new Float32Array(2)];
      return {
        duration: 0.1,
        length: 2,
        getChannelData(index) {
          return channels[index];
        },
      };
    },
    createBufferSource() {
      return {
        connect() {},
        start(when) {
          starts.push(when);
        },
        stop(when) {
          stops.push(when);
        },
        disconnect() {
          disconnects.push(true);
        },
      };
    },
  };
  const audio = new WebGpuChiptuneAudio({
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  }, { chunkDuration: 0.1 });
  audio.context = context;
  audio.input = {};
  audio.device = {};
  audio.chunkNumSamplesPerChannel = 2;
  audio.sampleRate = context.sampleRate;
  audio.renderChunk = async () => new Float32Array([0.1, -0.1, 0.2, -0.2]);

  const actualStart = await audio.restartTimeline({ startAt: 10.05, offset: 3 });
  assert.equal(actualStart, 10.05);
  assert.deepEqual(starts, [10.05]);
  assert.equal(audio.scheduledChunks[0].offset, 3);
  near(audio.renderOffset, 3.1);
  assert.equal(audio.running, true);
  assert.equal(timers.length, 1);

  const pausedAt = audio.pauseTimeline();
  assert.equal(pausedAt, 3);
  assert.equal(audio.running, false);
  assert.deepEqual(stops, [10]);
  assert.deepEqual(disconnects, [true]);
});

test("live parameter revisions coalesce and replace stale future chunks", () => {
  const timers = [];
  const cleared = [];
  const stops = [];
  const disconnects = [];
  const writes = [];
  const runtime = {
    setTimeout(callback, delay) {
      const id = timers.length + 1;
      timers.push({ id, callback, delay });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
    },
  };
  const currentSource = {
    stop(when) {
      stops.push(["current", when]);
    },
    disconnect() {
      disconnects.push("current");
    },
  };
  const futureSource = {
    stop(when) {
      stops.push(["future", when]);
    },
    disconnect() {
      disconnects.push("future");
    },
  };
  const audio = new WebGpuChiptuneAudio(runtime);
  audio.context = { currentTime: 10 };
  audio.input = {};
  audio.running = true;
  audio.timeoutId = 99;
  audio.device = {
    queue: {
      writeBuffer(buffer, offset, data) {
        writes.push({ buffer, offset, bytes: data.byteLength });
      },
    },
  };
  audio.sequenceMetaBuffer = { name: "sequence-meta" };
  audio.sequenceCellBuffer = { name: "sequence-cells" };
  audio.sources = new Set([currentSource, futureSource]);
  audio.scheduledChunks = [
    {
      source: currentSource,
      offset: 3,
      startAt: 9.95,
      endAt: 10.05,
      duration: 0.1,
      revision: 0,
    },
    {
      source: futureSource,
      offset: 3.1,
      startAt: 10.08,
      endAt: 10.18,
      duration: 0.1,
      revision: 0,
    },
  ];
  audio.renderOffset = 3.2;
  audio.nextStartTime = 10.18;

  audio.updateParams({ tempo: 1.5 });
  audio.updateParams({ tempo: 1.7 });
  audio.updateSequence({
    lanes: { lead: { activeLength: 7, cells: [{ state: "note", value: 5 }] } },
  });
  assert.equal(audio.paramRevision, 2);
  assert.equal(audio.sequenceRevision, 1);
  assert.equal(audio.renderRevision, 3);
  assert.deepEqual(writes.map(({ bytes }) => bytes), [48, 2560]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 40);
  timers[0].callback();
  assert.ok(cleared.includes(99));

  assert.deepEqual(stops, [["future", 10]]);
  assert.deepEqual(disconnects, ["future"]);
  assert.equal(audio.scheduledChunks.length, 1);
  near(audio.renderOffset, 3.1);
  near(audio.nextStartTime, 10.05);
  assert.equal(timers.length, 2);
  audio.pauseTimeline();
  assert.ok(cleared.includes(2));
  assert.equal(audio.sources.size, 0);
});

test("parameter refresh preserves a synchronized future start", () => {
  const timers = [];
  const stops = [];
  const source = {
    stop(when) {
      stops.push(when);
    },
    disconnect() {},
  };
  const audio = new WebGpuChiptuneAudio({
    setTimeout(callback, delay) {
      const id = timers.length + 1;
      timers.push({ id, callback, delay });
      return id;
    },
    clearTimeout() {},
  }, { chunkDuration: 0.1 });
  audio.context = { currentTime: 10 };
  audio.input = {};
  audio.running = true;
  audio.sources = new Set([source]);
  audio.scheduledChunks = [{
    source,
    offset: 4,
    startAt: 11,
    endAt: 11.1,
    duration: 0.1,
    revision: 0,
  }];
  audio.nextStartTime = 11.1;
  audio.renderOffset = 4.1;

  audio.updateParams({ ...audio.params, tempo: 1.5 });
  assert.equal(timers.length, 1);
  timers[0].callback();

  assert.deepEqual(stops, [10]);
  assert.equal(audio.scheduledChunks.length, 0);
  assert.equal(audio.nextStartTime, 11);
  assert.equal(audio.renderOffset, 4);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 0);
  audio.running = false;
  audio.clearQueueTimer();

  const rendering = new WebGpuChiptuneAudio({});
  rendering.context = { currentTime: 20 };
  rendering.input = {};
  rendering.running = true;
  rendering.renderOffset = 7;
  rendering.nextStartTime = 21;
  rendering.renderingPromise = Promise.resolve();

  assert.equal(rendering.currentPlaybackTime(), 7);
  rendering.refreshScheduledParams();
  assert.equal(rendering.nextStartTime, 21);
  assert.equal(rendering.renderOffset, 7);
  rendering.running = false;
  rendering.renderingPromise = null;
});

test("an in-flight render remains a fallback during continuous parameter edits", async () => {
  let resolveFirstRender;
  let renderCalls = 0;
  const starts = [];
  const firstRender = new Promise((resolve) => {
    resolveFirstRender = resolve;
  });
  const context = {
    currentTime: 5,
    sampleRate: 20,
    createBuffer() {
      const channels = [new Float32Array(2), new Float32Array(2)];
      return {
        duration: 0.1,
        length: 2,
        getChannelData(index) {
          return channels[index];
        },
      };
    },
    createBufferSource() {
      return {
        connect() {},
        start(when) {
          starts.push(when);
        },
        stop() {},
        disconnect() {},
      };
    },
  };
  const audio = new WebGpuChiptuneAudio({
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  }, { chunkDuration: 0.1 });
  audio.context = context;
  audio.input = {};
  audio.running = true;
  audio.chunkNumSamplesPerChannel = 2;
  audio.sampleRate = context.sampleRate;
  audio.nextStartTime = 5.02;
  audio.renderOffset = 1;
  audio.renderChunk = async () => {
    renderCalls += 1;
    if (renderCalls === 1) return firstRender;
    return new Float32Array([0.2, -0.2, 0.3, -0.3]);
  };

  const filling = audio.fillBuffer({ maxChunks: 1 });
  await Promise.resolve();
  audio.updateParams({ ...audio.params, tempo: 1.7 });
  resolveFirstRender(new Float32Array([0.1, -0.1, 0.2, -0.2]));
  await filling;

  assert.equal(renderCalls, 1);
  assert.equal(audio.scheduledChunks.length, 1);
  assert.equal(audio.scheduledChunks[0].revision, 0);
  assert.deepEqual(starts, [5.02]);
  near(audio.renderOffset, 1.1);
  audio.running = false;
  audio.stopScheduledSources();
});

test("a stale future-preroll render is dropped once without spinning", async () => {
  let resolveRender;
  let renderCalls = 0;
  const pendingRender = new Promise((resolve) => {
    resolveRender = resolve;
  });
  const audio = new WebGpuChiptuneAudio({
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  }, { chunkDuration: 0.1 });
  audio.context = {
    currentTime: 5,
    sampleRate: 20,
  };
  audio.input = {};
  audio.running = true;
  audio.chunkNumSamplesPerChannel = 2;
  audio.sampleRate = 20;
  audio.nextStartTime = 5.08;
  audio.renderOffset = 1;
  audio.renderChunk = async () => {
    renderCalls += 1;
    return pendingRender;
  };

  const filling = audio.fillBuffer({ maxChunks: 1 });
  await Promise.resolve();
  audio.updateSequence({
    lanes: { bass: { activeLength: 5 } },
  });
  resolveRender(new Float32Array([0.1, -0.1, 0.2, -0.2]));
  await filling;

  assert.equal(renderCalls, 1);
  assert.equal(audio.scheduledChunks.length, 0);
  assert.equal(audio.renderOffset, 1);
  audio.running = false;
  audio.clearQueueTimer();
});

test("WebGPU Chiptune ships as a separate accessible and credited page", async () => {
  const [html, css, app, source, notices, readme, buildScript] = await Promise.all([
    readFile(new URL("webgpu-chiptune.html", root), "utf8"),
    readFile(new URL("webgpu-chiptune.css", root), "utf8"),
    readFile(new URL("webgpu-chiptune-app.js", root), "utf8"),
    readFile(new URL("src/webgpu-chiptune.js", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);

  assert.match(html, /id="webgpuChiptune"/);
  assert.match(html, /<title>WebGPU Chiptune - Morphazoid<\/title>/);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="synthPlayButton"[\s\S]*?data-primary-transport/);
  assert.match(html, /id="stage"[\s\S]*?role="application"[\s\S]*?tabindex="0"/);
  assert.match(html, /id="characterStage"[\s\S]*?role="img"/);
  assert.doesNotMatch(
    html.match(/<canvas[\s\S]*?id="characterStage"[\s\S]*?<\/canvas>/)?.[0] ?? "",
    /tabindex=/,
  );
  assert.match(html, /id="previousPreset"/);
  assert.match(html, /id="nextPreset"/);
  assert.match(html, /Level changes size and brightness/);
  assert.match(html, /Upper A is a cyan scout/);
  assert.match(css, /#characterStage[\s\S]*?image-rendering: pixelated/);
  assert.match(css, /grid-template-rows:[\s\S]*?clamp\(122px,[\s\S]*?minmax\(0, 1fr\)/);
  const presetSource = app.slice(
    app.indexOf("const presets = Object.freeze"),
    app.indexOf("const SAFE_RANDOM_RANGES"),
  );
  const presetIds = [...presetSource.matchAll(/\bid: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(presetIds.length, 24);
  assert.equal(new Set(presetIds).size, 24);
  assert.deepEqual(presetIds.slice(0, 6), [
    "source-tracker", "pocket-console", "glass-cartridge",
    "subterranean-menu", "boss-corridor", "empty-arcade",
  ]);
  assert.match(html, /trackerInstructions/);
  assert.match(html, /<h1 class="sr-only" id="webgpuChiptuneTitle">/);
  assert.match(html, /id="advancedState"/);
  assert.match(html, /id="scaleControls"/);
  assert.match(html, /id="gateControls"/);
  assert.match(html, /id="trackerViewMorph"/);
  assert.match(html, /id="trackerViewSequence"/);
  assert.match(html, /id="sequenceVoiceTabs"[\s\S]*?role="tablist"/);
  assert.match(html, /id="sequenceGrid"[\s\S]*?role="tabpanel"/);
  assert.match(html,
    /id="sequenceLength"[\s\S]*?min="1"[\s\S]*?max="32"/);
  assert.match(html, /id="sequenceStateAuto"/);
  assert.match(html, /id="sequenceStateNote"/);
  assert.match(html, /id="sequenceStateRest"/);
  assert.match(html, /id="sequenceValue"[\s\S]*?step="0\.01"[\s\S]*?inputmode="text"/);
  assert.match(app, /must use increments of 0\.001 between 0 and 1/);
  assert.match(app, /valueInput\.inputMode = arp \? "decimal" : "text"/);
  assert.match(app, /const stepMismatch = input\.validity\.stepMismatch/);
  assert.match(html, /0\.1 for the Arp contour/);
  assert.match(html, /Chiptune \(sound\) by srtuss, 2015 · Shadertoy MljSRt/);
  assert.match(html, /src="webgpu-chiptune-app\.js"/);
  assert.match(css, /#stage:focus-visible/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*overflow-x: auto/);
  assert.match(css, /data-tracker-view="sequence"/);
  assert.match(css, /chiptune-sequence-grid/);
  assert.match(css,
    /chiptune-sequence-toolbar > \.mini-action[\s\S]*?display: block/);
  assert.match(app, /new WebGpuChiptuneAudio\(globalThis/);
  assert.match(app, /Audio is off — turn it on to hear playback\./);
  assert.match(app, /id: "webgpu-chiptune"/);
  assert.match(app, /subscribeState/);
  assert.match(app, /pointercancel/);
  assert.match(app, /stageKeyDown/);
  assert.match(app, /pageKeyDown/);
  assert.match(app, /restartSynchronizedAudio/);
  assert.match(app, /trackerNotesForLane/);
  assert.match(app, /createScaleEditor/);
  assert.match(app, /createGateEditor/);
  assert.match(app, /engine\?\.updateParams\(state\.params\)/);
  assert.match(app, /webGpuChiptuneParamToUnit/);
  assert.match(app, /webGpuChiptuneParamFromUnit/);
  assert.match(app, /advancedGroupDefinitions/);
  assert.match(app, /const musicalFractionParams = new Set/);
  assert.match(app, /denominator > 128/);
  assert.match(app, /normalizedNumerator >= normalizedDenominator/);
  assert.match(app, /nearestMusicalFraction/);
  assert.match(app, /function renderSequenceControls/);
  assert.match(app, /WEBGPU_CHIPTUNE_SEQUENCE_STEPS/);
  assert.match(app, /engine\?\.updateSequence\(state\.sequence\)/);
  assert.match(app, /stateVersion: 2/);
  assert.match(app, /sequence: state\.sequence/);
  assert.match(app, /WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE/);
  assert.match(app, /trackerCacheWindowStart !== windowStartStep/);
  const applySequenceSource = app.slice(
    app.indexOf("function applySequence"),
    app.indexOf("function applyPreset"),
  );
  assert.match(applySequenceSource, /engine\?\.updateSequence/);
  assert.match(applySequenceSource, /markCustom/);
  assert.match(applySequenceSource, /state\.presetId = "custom"/);
  assert.doesNotMatch(applySequenceSource, /restart|pause|stop/);
  const applyPresetSource = app.slice(
    app.indexOf("function applyPreset"),
    app.indexOf("function cyclePreset"),
  );
  assert.match(applyPresetSource, /engine\?\.updateParams/);
  assert.match(applyPresetSource, /engine\?\.updateSequence/);
  assert.equal((applyPresetSource.match(/notifyWaxState\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(applyPresetSource, /restart|pause|stop|transportOffset|transportStartedAt/);
  const characterRenderSource = app.slice(
    app.indexOf("function drawCharacterStage"),
    app.indexOf("function draw()"),
  );
  assert.match(characterRenderSource, /webGpuChiptuneStageSnapshot\(time/);
  assert.match(characterRenderSource, /imageSmoothingEnabled = false/);
  assert.doesNotMatch(characterRenderSource, /Math\.random/);
  assert.match(app, /const time = transportTime\(\);[\s\S]*?drawCharacterStage\(time\)/);
  assert.match(source, /export function webGpuChiptuneStageSnapshot/);
  const fractionCommitSource = app.slice(
    app.indexOf("function commitFractionControl"),
    app.indexOf("function createFractionControl"),
  );
  assert.doesNotMatch(fractionCommitSource, /quantizeControlValue|applyControlValue/);
  assert.match(app, /shuffledCopy/);
  assert.doesNotMatch(app, /\.sort\(\(\) => Math\.random\(\) - 0\.5\)/);
  const nativeRangeFactory = app.slice(
    app.indexOf("function createRangeControl"),
    app.indexOf("function createScaleEditor"),
  );
  assert.doesNotMatch(nativeRangeFactory, /addEventListener\("wheel"/);
  assert.match(app, /outside active loop/);
  const mutation = app.slice(
    app.indexOf("function mutatePatch"),
    app.indexOf("function outputChanged"),
  );
  assert.doesNotMatch(mutation, /energyManagedParams/);
  assert.match(mutation, /WEBGPU_CHIPTUNE_INTEGER_PARAMS\.includes\(key\)/);
  assert.match(mutation, /upper - lower === 1/);
  const visibleSpecKeys = [...app.matchAll(/makeSpec\("([A-Za-z][A-Za-z0-9]*)"/g)]
    .map((match) => match[1]);
  assert.equal(visibleSpecKeys.length, WEBGPU_CHIPTUNE_PARAM_ORDER.length - 8);
  assert.equal(new Set(visibleSpecKeys).size, visibleSpecKeys.length);
  assert.match(html, /Sound changes refresh upcoming shader chunks/);
  assert.match(html, /Intro fade and curve are heard only when playback begins from 0:00/);
  assert.match(css, /\.chiptune-subgroup-body/);
  assert.match(css, /data-outside-loop="true"/);
  assert.match(source, /scheduleParamRefresh/);
  assert.match(source, /connectAudioOutput/);
  assert.doesNotMatch(source, /createDynamicsCompressor/);
  assert.match(notices, /## WebGPU Chiptune \/ Chiptune \(sound\) lineage/);
  assert.match(notices, /did not state a reuse license/);
  assert.match(readme, /\*\*WebGPU Chiptune\*\* joins the Sequencers/);

  const stopAudio = app.slice(
    app.indexOf("async function stopAudio"),
    app.indexOf("async function toggleAudio"),
  );
  assert.doesNotMatch(stopAudio, /synthPlaying\s*=\s*false|pauseTransport/);
  const playTransport = app.slice(
    app.indexOf("async function playTransport"),
    app.indexOf("async function toggleSynthPlay"),
  );
  assert.doesNotMatch(playTransport, /startAudio|new AudioContext/);

  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER.filter(
    (candidate) => !/^gate[AB][0-3]$/.test(candidate),
  )) {
    assert.match(app, new RegExp('makeSpec\\("' + key + '"'), key + " needs a visible control");
  }
  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER.filter(
    (candidate) => /^gate[AB][0-3]$/.test(candidate),
  )) {
    assert.match(source, new RegExp(key + ": f32"), key + " needs a packed gate field");
  }
  for (const file of [
    "webgpu-chiptune.html",
    "webgpu-chiptune.css",
    "webgpu-chiptune-app.js",
    "src/webgpu-chiptune.js",
  ]) {
    assert.ok(buildScript.includes(file), file + " must ship in the WAX build");
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_CHIPTUNE_CREDIT,
  WEBGPU_CHIPTUNE_DEFAULTS,
  WEBGPU_CHIPTUNE_INTEGER_PARAMS,
  WEBGPU_CHIPTUNE_LIMITS,
  WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS,
  WEBGPU_CHIPTUNE_OUTPUT_CEILING,
  WEBGPU_CHIPTUNE_PARAM_ORDER,
  WEBGPU_CHIPTUNE_SHADER,
  WEBGPU_CHIPTUNE_WORKGROUP_SIZES,
  WebGpuChiptuneAudio,
  formatWebGpuChiptuneValue,
  sanitizeWebGpuChiptuneParams,
  webGpuChiptuneParamArray,
  webGpuChiptuneParamFromUnit,
  webGpuChiptuneParamToUnit,
  webGpuChiptunePatternValue,
  webGpuChiptuneScaleLock,
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
  assert.equal(WEBGPU_CHIPTUNE_PARAM_ORDER.length, 124);
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
  assert.equal(packed.byteLength, 496);
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
  assert.equal(formatWebGpuChiptuneValue("kickAttackTime", 0.1), "0.100 step");
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
  assert.equal(sanitized.tempo, 0.4);
  assert.equal(sanitized.transpose, 12);
  assert.equal(sanitized.patternSeed, WEBGPU_CHIPTUNE_DEFAULTS.patternSeed);
  assert.equal(sanitized.pitchRange, WEBGPU_CHIPTUNE_DEFAULTS.pitchRange);
  assert.equal(sanitized.gateLength, 2);
  assert.equal(sanitized.pulseWidth, 0.05);
  near(sanitized.pwmDepth, 0.03);
  assert.equal(sanitized.kickLevel, 0);
  assert.equal(sanitized.drumDecay, 0.3);
  assert.equal(sanitized.echoTaps, 8);
  assert.equal(sanitizeWebGpuChiptuneParams({ echoTaps: 2.6 }).echoTaps, 3);
  assert.equal(sanitized.echoTime, 0.05);
  assert.equal(sanitized.echoDecay, 0.78);
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
  assert.equal(sanitized.echoAlternate, 1);
});
  assert.ok(!WEBGPU_CHIPTUNE_INTEGER_PARAMS.includes("arpSpan"));

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
  assert.equal(WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS.echoDecay, "linear");
  near(webGpuChiptuneParamFromUnit("echoDecay", 0.5), 0.39);
  }
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
  near(webGpuChiptuneParamFromUnit("noiseRate", 0.5), 4000);
  assert.equal(webGpuChiptuneParamFromUnit("tuningCents", 0.5), 0);
  near(webGpuChiptuneParamToUnit("synthMix", 1), 0.75);
  near(webGpuChiptuneParamFromUnit("synthMix", 0.75), 1);
  assert.equal(webGpuChiptuneParamFromUnit("echoAlternate", 0.49), 0);
  assert.equal(webGpuChiptuneParamFromUnit("echoAlternate", 0.51), 1);
});

test("procedural score helpers match scale and fast lead/arpeggio substeps", () => {
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

test("WGSL renders a bounded stereo active path without dormant source branches", () => {
  assert.equal(WEBGPU_CHIPTUNE_OUTPUT_CEILING, 0.88);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /Chiptune \(sound\).*srtuss \(2015\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /shadertoy\.com\/view\/MljSRt/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@compute/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@workgroup_size\(WORKGROUP_SIZE\)/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /sound_chunk: array<vec2<f32>>/);
  assert.match(WEBGPU_CHIPTUNE_SHADER, /@binding\(2\) var<storage, read> audio_param/);
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
  assert.equal(audio.paramRevision, 2);
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
  assert.match(html, /trackerInstructions/);
  assert.match(html, /<h1 class="sr-only" id="webgpuChiptuneTitle">/);
  assert.match(html, /id="advancedState"/);
  assert.match(html, /id="scaleControls"/);
  assert.match(html, /id="gateControls"/);
  assert.match(html, /Chiptune \(sound\) by srtuss, 2015 · Shadertoy MljSRt/);
  assert.match(html, /src="webgpu-chiptune-app\.js"/);
  assert.match(css, /#stage:focus-visible/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*overflow-x: auto/);
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

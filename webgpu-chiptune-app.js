import {
  WEBGPU_CHIPTUNE_DEFAULTS,
  WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
  WEBGPU_CHIPTUNE_INTEGER_PARAMS,
  WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES,
  WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES,
  WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES,
  WEBGPU_CHIPTUNE_SEQUENCE_STEPS,
  WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS,
  WEBGPU_CHIPTUNE_LIMITS,
  WEBGPU_CHIPTUNE_PARAM_ORDER,
  WEBGPU_CHIPTUNE_PREVIEW_DURATION_SECONDS,
  WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS,
  WEBGPU_CHIPTUNE_WORKGROUP_SIZES,
  WebGpuChiptuneAudio,
  createWebGpuChiptuneSequence,
  formatWebGpuChiptuneValue,
  paintWebGpuChiptuneSequenceSegment,
  sanitizeWebGpuChiptuneSequence,
  sanitizeWebGpuChiptuneParams,
  webGpuChiptuneParamFromUnit,
  webGpuChiptuneParamToUnit,
  webGpuChiptuneBeatSnapshot,
  webGpuChiptuneCharacterBayLayout,
  webGpuChiptuneProceduralLaneValue,
  webGpuChiptuneLaneTiming,
  webGpuChiptuneLiveEditTarget,
  webGpuChiptuneSequenceCellIndex,
  webGpuChiptuneSequenceEditorUnit,
  webGpuChiptuneSequenceEditorValue,
  webGpuChiptuneStageSnapshot,
  webGpuChiptuneStepSnapshot,
  webGpuChiptuneSupport,
} from "./src/webgpu-chiptune.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const fract = (value) => value - Math.floor(value);
const positiveModulo = (value, modulus) =>
  ((value % modulus) + modulus) % modulus;

function makeSpec(key, label, quantum = 0.01) {
  const [min, max] = WEBGPU_CHIPTUNE_LIMITS[key];
  const distribution = WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS[key];
  return Object.freeze({
    key,
    label,
    min,
    max,
    quantum: WEBGPU_CHIPTUNE_INTEGER_PARAMS.includes(key)
      ? 1
      : distribution === "db" ? Math.min(quantum, 0.001) : quantum,
    distribution,
  });
}

const controlGroups = Object.freeze({
  pattern: Object.freeze([
    makeSpec("tempo", "Tempo"),
    makeSpec("transpose", "Transpose", 1),
    makeSpec("patternSeed", "Pattern seed", 0.001),
    makeSpec("pitchRange", "Pitch range"),
    makeSpec("gateRate", "Gate rate"),
    makeSpec("gateLength", "Gate length"),
  ]),
  voice: Object.freeze([
    makeSpec("pulseWidth", "Pulse width"),
    makeSpec("pwmDepth", "PWM depth"),
    makeSpec("pwmRate", "PWM motion"),
    makeSpec("upperOneLevel", "Upper voice A"),
    makeSpec("upperTwoLevel", "Upper voice B"),
    makeSpec("bassPulseLevel", "Bass pulse"),
    makeSpec("bassSineLevel", "Bass sine"),
    makeSpec("leadLevel", "Lead"),
    makeSpec("arpLevel", "Arpeggio"),
    makeSpec("noiseLevel", "Noise texture"),
    makeSpec("stereoWidth", "Voice width"),
  ]),
  drums: Object.freeze([
    makeSpec("kickLevel", "Kick"),
    makeSpec("snareLevel", "Snare"),
    makeSpec("hatLevel", "Hats"),
    makeSpec("shakerLevel", "Shaker"),
    makeSpec("kickTone", "Kick tone"),
    makeSpec("snareTone", "Snare tone"),
    makeSpec("drumDecay", "Drum decay"),
    makeSpec("drumMix", "Drum bus"),
    makeSpec("ghostDrums", "Ghost drums"),
  ]),
  echo: Object.freeze([
    makeSpec("echoTaps", "Echo taps", 1),
    makeSpec("echoTime", "Echo spacing"),
    makeSpec("echoDecay", "Echo decay"),
    makeSpec("echoStereo", "Ping-pong width"),
    makeSpec("fadeIn", "Intro fade (from 0:00)"),
    makeSpec("gain", "Shader gain"),
  ]),
  advanced: Object.freeze([
    makeSpec("scaleMask", "Scale pitch classes", 1),
    makeSpec("upperOneSpan", "Upper A note span", 1),
    makeSpec("upperTwoSpan", "Upper B note span", 1),
    makeSpec("bassSpan", "Bass note span", 1),
    makeSpec("upperOneRegister", "Upper A register", 1),
    makeSpec("bassRegister", "Bass register", 1),
    makeSpec("arpRegister", "Arpeggio register", 1),
    makeSpec("sectionUnits", "Section length", 1),
    makeSpec("pitchClock", "Upper A note rate", 0.25),
    makeSpec("bassClock", "Bass clock", 0.05),
    makeSpec("gateFastRatio", "Fast-gate ratio", 0.05),
    makeSpec("gateSwitchShortUnits", "Gate switch A period", 0.25),
    makeSpec("gateSwitchLongUnits", "Gate switch B period", 0.25),
    makeSpec("leadTrillRate", "Lead trill rate", 0.5),
    makeSpec("leadInterval", "Lead trill interval", 1),
    makeSpec("leadPhraseUnits", "Lead phrase length", 0.1),
    makeSpec("arpRate", "Arpeggio rate", 0.5),
    makeSpec("arpSpan", "Arpeggio span", 0.01),
    makeSpec("arpOctaveRate", "Arpeggio octave motion", 0.0625),
    makeSpec("arpOctaves", "Arpeggio octave range", 1),
    makeSpec("bassPulseWidth", "Bass pulse width"),
    makeSpec("drumRate", "Drum rate", 0.05),
    makeSpec("echoCrossfeed", "Echo crossfeed"),
    makeSpec("gateAttack", "Gate attack", 0.005),
    makeSpec("gateRelease", "Gate release"),
    makeSpec("texturePeriod", "Noise-texture period", 0.25),
    makeSpec("textureDecay", "Noise-texture decay", 0.05),
    makeSpec("kickCycle", "Kick cycle", 0.05),
    makeSpec("kickSubcycle", "Kick subcycle", 0.05),
    makeSpec("snareNoiseMix", "Snare noise / tone"),
    makeSpec("hatBalance", "Hat layer balance"),
    makeSpec("ghostDelayDivisor", "Ghost delay divisor", 0.25),
    makeSpec("ghostPan", "Ghost pan"),
    makeSpec("gatePatternSteps", "Gate loop", 1),
    makeSpec("gateShortRatio", "Short-gate length"),
    makeSpec("gateLongRatio", "Long-gate length"),
    makeSpec("fastGateShare", "Fast-gate share"),
    makeSpec("longGateBoostShare", "Long-boost share"),
    makeSpec("leadSectionShare", "Lead section share"),
    makeSpec("leadTrillShare", "Lead trill share"),
    makeSpec("tuningCents", "Fine tuning", 1),
    makeSpec("upperTwoRegister", "Upper B register", 1),
    makeSpec("leadRegister", "Lead register", 1),
    makeSpec("leadClock", "Lead clock", 0.25),
    makeSpec("leadSpan", "Lead note span", 1),
    makeSpec("arpBassFollow", "Arpeggio bass follow"),
    makeSpec("voiceCrossfeed", "Voice crossfeed"),
    makeSpec("synthMix", "Synth bus"),
    makeSpec("fadeCurve", "Intro curve (from 0:00)"),
    makeSpec("echoAlternate", "Echo channel mode", 1),
    makeSpec("snareCycle", "Snare cycle", 0.03125),
    makeSpec("snarePhase", "Snare phase", 0.001),
    makeSpec("hatACycle", "Hat A cycle", 0.03125),
    makeSpec("hatASubcycle", "Hat A subcycle", 0.03125),
    makeSpec("hatARepeat", "Hat A repeat", 0.03125),
    makeSpec("hatAPhase", "Hat A phase", 0.001),
    makeSpec("hatBCycle", "Hat B cycle", 0.03125),
    makeSpec("shakerCycle", "Shaker cycle", 0.03125),
    makeSpec("shakerPhase", "Shaker phase", 0.001),
    makeSpec("noiseRate", "Noise clock", 1),
    makeSpec("noiseColor", "Noise color"),
    makeSpec("textureSweep", "Texture sweep"),
    makeSpec("kickBodyPhase", "Kick body phase", 1),
    makeSpec("kickTransientPhase", "Kick transient phase", 1),
    makeSpec("kickBodySweep", "Kick body sweep"),
    makeSpec("kickTransientSweep", "Kick transient sweep"),
    makeSpec("kickAttackTime", "Kick attack", 0.001),
    makeSpec("kickDecayRate", "Kick decay rate"),
    makeSpec("kickClipKnee", "Kick clip knee"),
    makeSpec("snareHoldTime", "Snare hold", 0.001),
    makeSpec("snareDecayRate", "Snare decay rate"),
    makeSpec("snareNoiseSweep", "Snare noise sweep"),
    makeSpec("snareNoiseRate", "Snare noise rate"),
    makeSpec("snareModRate", "Snare mod rate", 1),
    makeSpec("snareModDepth", "Snare mod depth"),
    makeSpec("snareCarrierRate", "Snare carrier", 1),
    makeSpec("hatANoiseRate", "Hat A noise rate"),
    makeSpec("hatADecayRate", "Hat A decay"),
    makeSpec("hatBLowNoiseRate", "Hat B low noise"),
    makeSpec("hatBHighNoiseRate", "Hat B high noise"),
    makeSpec("hatBHighMix", "Hat B high mix"),
    makeSpec("hatBDecayRate", "Hat B decay"),
    makeSpec("shakerNoiseRate", "Shaker noise rate"),
    makeSpec("shakerDecayRate", "Shaker decay"),
    makeSpec("upperTwoClockRatio", "Upper B / A note rate", 0.015625),
    makeSpec("kickPhase", "Kick cycle phase", 0.001),
    makeSpec("hatBPhase", "Hat B cycle phase", 0.001),
    makeSpec("hatARepeatPhase", "Hat A repeat phase", 0.001),
    makeSpec("arpPhase", "Arpeggio phase", 0.001),
    makeSpec("echoWet", "Echo return"),
    makeSpec("arpGateDepth", "Arpeggio gate depth"),
    makeSpec("bassGateRateRatio", "Bass gate-rate multiplier", 0.015625),
    makeSpec("leadGateRateRatio", "Lead gate-rate multiplier", 0.015625),
    makeSpec("upperTwoGateRateRatio", "Upper B gate-rate multiplier", 0.015625),
    makeSpec("snareNoiseColor", "Snare noise color"),
    makeSpec("hatANoiseColor", "Hat A noise color"),
    makeSpec("hatBNoiseColor", "Hat B noise color"),
    makeSpec("shakerNoiseColor", "Shaker noise color"),
    makeSpec("upperOnePhase", "Upper A sequence phase", 0.001),
    makeSpec("upperTwoPhase", "Upper B sequence phase", 0.001),
    makeSpec("bassPhase", "Bass sequence phase", 0.001),
    makeSpec("leadPhase", "Lead sequence phase", 0.001),
    makeSpec("gatePatternPhase", "Gate pattern phase", 0.001),
    makeSpec("gateSwitchShortPhase", "Gate switch A phase", 0.001),
    makeSpec("gateSwitchLongPhase", "Gate switch B phase", 0.001),
    makeSpec("sectionPhase", "Upper / lead section phase", 0.001),
    makeSpec("leadTrillPhase", "Lead trill phase", 0.001),
    makeSpec("leadPhrasePhase", "Lead gate-phrase phase", 0.001),
    makeSpec("arpOctavePhase", "Arpeggio octave phase", 0.001),
    makeSpec("texturePhase", "Noise-texture phase", 0.001),
  ]),
});

const advancedGroupDefinitions = Object.freeze([
  Object.freeze({
    id: "gate-logic",
    label: "Gate logic",
    open: true,
    keys: Object.freeze([
      "gatePatternSteps", "gatePatternPhase", "gateShortRatio", "gateLongRatio",
      "gateFastRatio",
      "fastGateShare", "longGateBoostShare", "gateSwitchShortUnits",
      "gateSwitchShortPhase", "gateSwitchLongUnits", "gateSwitchLongPhase",
      "gateAttack", "gateRelease",
      "upperTwoGateRateRatio", "bassGateRateRatio", "leadGateRateRatio",
    ]),
  }),
  Object.freeze({
    id: "pitch-phrases",
    label: "Pitch + phrases",
    keys: Object.freeze([
      "upperOneSpan", "upperTwoSpan", "bassSpan", "leadSpan", "upperOneRegister",
      "upperTwoRegister", "bassRegister", "leadRegister", "tuningCents",
      "sectionUnits", "pitchClock", "bassClock", "leadClock", "leadSectionShare",
      "leadTrillRate", "leadTrillShare", "leadInterval", "leadPhraseUnits",
      "upperTwoClockRatio", "upperOnePhase", "upperTwoPhase", "bassPhase",
      "leadPhase", "sectionPhase", "leadTrillPhase", "leadPhrasePhase",
    ]),
  }),
  Object.freeze({
    id: "arpeggio",
    label: "Arpeggio",
    keys: Object.freeze([
      "arpRate", "arpSpan", "arpOctaveRate", "arpOctaves", "arpRegister",
      "arpBassFollow", "arpPhase", "arpOctavePhase", "arpGateDepth",
    ]),
  }),
  Object.freeze({
    id: "routing-intro",
    label: "Routing + intro",
    keys: Object.freeze([
      "bassPulseWidth", "voiceCrossfeed", "synthMix", "echoCrossfeed",
      "echoAlternate", "echoWet", "fadeCurve", "ghostDelayDivisor", "ghostPan",
    ]),
  }),
  Object.freeze({
    id: "drum-rhythm",
    label: "Drum rhythm",
    keys: Object.freeze([
      "drumRate", "kickCycle", "kickSubcycle", "snareCycle", "snarePhase",
      "hatACycle", "hatASubcycle", "hatARepeat", "hatAPhase", "hatBCycle",
      "shakerCycle", "shakerPhase", "kickPhase", "hatBPhase",
      "hatARepeatPhase",
    ]),
  }),
  Object.freeze({
    id: "noise-texture",
    label: "Noise texture",
    keys: Object.freeze([
      "texturePeriod", "textureDecay", "noiseRate", "noiseColor", "textureSweep",
      "texturePhase",
    ]),
  }),
  Object.freeze({
    id: "kick-circuit",
    label: "Kick circuit",
    keys: Object.freeze([
      "kickBodyPhase", "kickTransientPhase", "kickBodySweep",
      "kickTransientSweep", "kickAttackTime", "kickDecayRate", "kickClipKnee",
    ]),
  }),
  Object.freeze({
    id: "snare-circuit",
    label: "Snare circuit",
    keys: Object.freeze([
      "snareNoiseMix", "snareHoldTime", "snareDecayRate", "snareNoiseSweep",
      "snareNoiseRate", "snareModRate", "snareModDepth", "snareCarrierRate",
      "snareNoiseColor",
    ]),
  }),
  Object.freeze({
    id: "hats-shaker",
    label: "Hats + shaker",
    keys: Object.freeze([
      "hatBalance", "hatANoiseRate", "hatADecayRate", "hatBLowNoiseRate",
      "hatBHighNoiseRate", "hatBHighMix", "hatBDecayRate", "shakerNoiseRate",
      "shakerDecayRate", "hatANoiseColor", "hatBNoiseColor", "shakerNoiseColor",
    ]),
  }),
]);

const controlSpecs = Object.freeze(Object.values(controlGroups).flat());
const controlSpecsByKey = new Map(controlSpecs.map((spec) => [spec.key, spec]));
const knobOrder = Object.freeze([
  "tempo",
  "patternSeed",
  "pitchRange",
  "gateLength",
  "pulseWidth",
  "pwmDepth",
  "bassPulseLevel",
  "leadLevel",
  "drumMix",
  "kickLevel",
  "snareLevel",
  "echoTime",
  "echoDecay",
  "echoStereo",
  "stereoWidth",
  "gain",
]);
const knobLabels = Object.freeze({
  tempo: "Tempo",
  patternSeed: "Seed",
  pitchRange: "Range",
  gateLength: "Gate",
  pulseWidth: "Pulse",
  pwmDepth: "PWM",
  bassPulseLevel: "Bass",
  leadLevel: "Lead",
  drumMix: "Drums",
  kickLevel: "Kick",
  snareLevel: "Snare",
  echoTime: "Echo",
  echoDecay: "Decay",
  echoStereo: "Pingpong",
  stereoWidth: "Width",
  gain: "Level",
});
const knobHueByKey = new Map(knobOrder.map((key, index) => [key, (index * 41 + 194) % 360]));
const integerParams = new Set(WEBGPU_CHIPTUNE_INTEGER_PARAMS);
const scaleLabels = Object.freeze(["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]);
const gateStates = Object.freeze([
  Object.freeze({ duration: 0, label: "off", glyph: "·" }),
  Object.freeze({ duration: 0.8, label: "short", glyph: "˙" }),
  Object.freeze({ duration: 1, label: "medium", glyph: "•" }),
  Object.freeze({ duration: 2, label: "long", glyph: "■" }),
]);
const gateCodeKeys = Object.freeze([
  "gateA0",
  "gateA1",
  "gateA2",
  "gateA3",
  "gateB0",
  "gateB1",
  "gateB2",
  "gateB3",
]);
const gateCodeKeySet = new Set(gateCodeKeys);
const fractionPhaseParams = new Set([
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
]);
const fractionDrumPeriodParams = new Set([
  "kickCycle",
  "kickSubcycle",
  "snareCycle",
  "hatACycle",
  "hatASubcycle",
  "hatARepeat",
  "hatBCycle",
  "shakerCycle",
]);
const fractionPeriodParams = new Set([
  "sectionUnits",
  "gateSwitchShortUnits",
  "gateSwitchLongUnits",
  "leadPhraseUnits",
  "texturePeriod",
  ...fractionDrumPeriodParams,
]);
const musicalFractionParams = new Set([
  "gateRate",
  "gateShortRatio",
  "gateLength",
  "gateLongRatio",
  "pitchClock",
  "upperTwoClockRatio",
  "bassClock",
  "leadClock",
  "gateFastRatio",
  "leadTrillRate",
  "arpRate",
  "arpOctaveRate",
  "drumRate",
  "bassGateRateRatio",
  "leadGateRateRatio",
  "upperTwoGateRateRatio",
  ...fractionPeriodParams,
  ...fractionPhaseParams,
]);
const sequenceLaneDefinitions = Object.freeze([
  Object.freeze({ key: "upperOne", label: "UPPER A", shortLabel: "A", color: "#53f6ff", kind: "steps", weight: 1 }),
  Object.freeze({ key: "upperTwo", label: "UPPER B", shortLabel: "B", color: "#9dff57", kind: "steps", weight: 1 }),
  Object.freeze({ key: "bass", label: "BASS", shortLabel: "BASS", color: "#9c8dff", kind: "steps", weight: 1 }),
  Object.freeze({ key: "lead", label: "LEAD NOTE", shortLabel: "LEAD", color: "#ff65bd", kind: "steps", weight: 1.12 }),
  Object.freeze({ key: "arp", label: "ARP SHAPE", shortLabel: "ARP", color: "#f4c95d", kind: "contour", weight: 1.12 }),
  Object.freeze({ key: "kick", label: "KICK", shortLabel: "K", color: "#ff7657", kind: "drums", weight: 1 }),
  Object.freeze({ key: "snare", label: "SNARE", shortLabel: "S", color: "#ff9bce", kind: "drums", weight: 1 }),
  Object.freeze({ key: "hats", label: "HATS", shortLabel: "H", color: "#8be8ff", kind: "drums", weight: 1 }),
  Object.freeze({ key: "shaker", label: "SHAKER", shortLabel: "SH", color: "#ffe07c", kind: "drums", weight: 1 }),
]);
const randomizableParamOrder = Object.freeze(
  WEBGPU_CHIPTUNE_PARAM_ORDER.filter((key) => !gateCodeKeySet.has(key)),
);

function patch(values = {}) {
  return sanitizeWebGpuChiptuneParams({ ...WEBGPU_CHIPTUNE_DEFAULTS, ...values });
}

function presetSequence(definitions = {}) {
  const lanes = {};
  for (const lane of WEBGPU_CHIPTUNE_SEQUENCE_LANES) {
    const [activeLength = WEBGPU_CHIPTUNE_SEQUENCE_STEPS, source = "."] =
      definitions[lane] ?? [];
    const tokens = String(source).trim().split(/\s+/).filter(Boolean);
    lanes[lane] = {
      activeLength,
      cells: Array.from({ length: WEBGPU_CHIPTUNE_SEQUENCE_STEPS }, (_, index) => {
        if (index >= activeLength) return { state: "auto", value: 0 };
        const token = tokens[index % Math.max(1, tokens.length)] ?? ".";
        if (token === "r") return { state: "rest", value: 0 };
        if (token === ".") return { state: "auto", value: 0 };
        const value = Number(token);
        return Number.isFinite(value)
          ? { state: "note", value }
          : { state: "auto", value: 0 };
      }),
    };
  }
  return sanitizeWebGpuChiptuneSequence({ schemaVersion: 2, lanes });
}

const presets = Object.freeze([
  {
    id: "source-tracker",
    label: "Source Tracker",
    description: "The untouched 2015 shader arrangement: all five lanes follow its procedural contours.",
    params: WEBGPU_CHIPTUNE_DEFAULTS,
    sequence: WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
  },
  {
    id: "pocket-console",
    label: "Pocket Console",
    description: "A dry, compact minor hook with clipped phrases and a sturdy eight-step bass loop.",
    params: patch({
      tempo: 1.65,
      transpose: -5,
      patternSeed: 2.451,
      pitchRange: 0.74,
      gateRate: 1.35,
      gateLength: 0.58,
      pulseWidth: 0.34,
      pwmDepth: 0.16,
      bassPulseLevel: 1.35,
      bassSineLevel: 0.72,
      leadLevel: 0.74,
      arpLevel: 0.68,
      noiseLevel: 0.38,
      kickLevel: 1.25,
      snareLevel: 0.92,
      hatLevel: 0.72,
      shakerLevel: 0.55,
      drumDecay: 0.68,
      ghostDrums: 0.3,
      echoTaps: 4,
      echoTime: 0.19,
      echoDecay: 0.22,
      scaleMask: 1453,
      gatePatternSteps: 16,
      gateA0: 21845,
      gateB0: 13107,
      upperTwoRegister: -12,
      leadRegister: 0,
      leadClock: 8,
      leadSpan: 7,
      leadSectionShare: 0.62,
      fastGateShare: 0.72,
      snareCycle: 0.75,
      hatACycle: 1,
      hatASubcycle: 0.5,
      noiseRate: 6000,
      gain: 0.72,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 . 3 7 r . 3 . 5 . 7 10 r 7 3 ."],
      upperTwo: [16, "0 r . 3 . 7 r . -2 . 0 3 r . 7 ."],
      bass: [8, "-12 r -12 . -5 r -7 ."],
      lead: [16, ". . 7 r 10 . 7 . r . 5 3 . r 0 ."],
      arp: [16, "0 . .25 .5 .75 1 .75 .5 .25 r . .5 .75 . r"],
    }),
  },
  {
    id: "glass-cartridge",
    label: "Glass Cartridge",
    description: "High crystalline leads, an asymmetric twelve-step answer, and long stereo reflections.",
    params: patch({
      tempo: 1.05,
      transpose: 5,
      patternSeed: 3.257,
      pitchRange: 1.32,
      gateLength: 1.28,
      pulseWidth: 0.28,
      pwmDepth: 0.39,
      pwmRate: 0.72,
      upperOneLevel: 1.22,
      upperTwoLevel: 1.1,
      bassPulseLevel: 0.52,
      bassSineLevel: 0.45,
      leadLevel: 1.42,
      arpLevel: 1.55,
      noiseLevel: 0.22,
      stereoWidth: 1.34,
      drumMix: 0.58,
      ghostDrums: 0.62,
      echoTaps: 8,
      echoTime: 0.24,
      echoDecay: 0.47,
      echoStereo: 1.35,
      scaleMask: 2741,
      gatePatternSteps: 24,
      gateA0: 43690,
      gateB0: 52428,
      upperTwoRegister: 12,
      leadRegister: 12,
      leadClock: 6,
      leadSpan: 18,
      leadSectionShare: 0.7,
      fastGateShare: 0.38,
      snareCycle: 2,
      hatACycle: 4,
      hatASubcycle: 1.25,
      noiseRate: 8000,
      gain: 0.6,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 . 4 . 7 11 . r 12 . 11 7 . 4 r ."],
      upperTwo: [12, "7 . 11 r 14 . 11 . 7 r 4 ."],
      bass: [8, "-12 . r . -5 . -7 r"],
      lead: [12, "12 . 16 19 . 23 r 19 . 16 . r"],
      arp: [24, "0 .17 .33 .5 .67 .83 1 .83 .67 .5 .33 .17 r . 0 .33 .67 1 .67 .33 . r ."],
    }),
  },
  {
    id: "subterranean-menu",
    label: "Subterranean Menu",
    description: "Slow low-register footsteps, a four-note bass cell, and dim cavern percussion.",
    params: patch({
      tempo: 0.74,
      transpose: -12,
      patternSeed: 1.127,
      pitchRange: 0.55,
      gateRate: 0.72,
      gateLength: 1.62,
      pulseWidth: 0.58,
      pwmDepth: 0.1,
      upperOneLevel: 0.28,
      upperTwoLevel: 0.34,
      bassPulseLevel: 1.8,
      bassSineLevel: 1.72,
      leadLevel: 0.25,
      arpLevel: 0.42,
      noiseLevel: 0.7,
      kickLevel: 1.4,
      snareLevel: 0.5,
      hatLevel: 0.35,
      shakerLevel: 0.25,
      kickTone: 0.62,
      drumDecay: 1.55,
      drumMix: 1.15,
      ghostDrums: 0.22,
      echoTaps: 5,
      echoTime: 0.42,
      echoDecay: 0.42,
      scaleMask: 661,
      gatePatternSteps: 32,
      gateA0: 52428,
      gateB0: 21845,
      upperTwoRegister: -24,
      leadRegister: -12,
      leadClock: 2,
      leadSpan: 5,
      leadSectionShare: 0.32,
      fastGateShare: 0.24,
      snareCycle: 2,
      hatACycle: 4,
      hatASubcycle: 1,
      noiseRate: 2000,
      gain: 0.58,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 r . r 3 r . r 5 r . r 3 r . r"],
      upperTwo: [16, "r . -5 r . r -2 r r . 0 r . r -2 r"],
      bass: [4, "-12 r -7 r"],
      lead: [8, "r r . r 0 r r ."],
      arp: [16, "0 r . r .5 r . r 1 r . r .5 r . r"],
    }),
  },
  {
    id: "boss-corridor",
    label: "Boss Corridor",
    description: "Fast octave replies, dense drums, and short gates for a relentless corridor run.",
    params: patch({
      tempo: 1.86,
      transpose: -2,
      patternSeed: 5.137,
      pitchRange: 1.65,
      gateRate: 1.7,
      gateLength: 0.42,
      pulseWidth: 0.2,
      pwmDepth: 0.18,
      pwmRate: 1.8,
      upperOneLevel: 1.4,
      upperTwoLevel: 1.28,
      bassPulseLevel: 1.25,
      bassSineLevel: 0.62,
      leadLevel: 1.5,
      arpLevel: 1.18,
      noiseLevel: 0.62,
      kickLevel: 1.55,
      snareLevel: 1.4,
      hatLevel: 1.25,
      shakerLevel: 1.12,
      kickTone: 1.72,
      snareTone: 1.45,
      drumDecay: 0.52,
      drumMix: 1.15,
      ghostDrums: 0.5,
      echoTaps: 3,
      echoTime: 0.14,
      echoDecay: 0.18,
      scaleMask: 1387,
      gatePatternSteps: 16,
      gateA0: 13107,
      gateB0: 43690,
      upperTwoRegister: 0,
      leadRegister: 12,
      leadClock: 12,
      leadSpan: 24,
      leadSectionShare: 0.55,
      fastGateShare: 0.82,
      snareCycle: 0.5,
      hatACycle: 1,
      hatASubcycle: 0.25,
      noiseRate: 7000,
      gain: 0.55,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 3 7 r 12 7 3 r 5 8 12 r 15 12 8 r"],
      upperTwo: [16, "12 r 7 3 0 r 3 7 12 r 15 12 8 r 5 3"],
      bass: [8, "-12 -12 r -7 -5 -5 r -7"],
      lead: [16, "12 19 24 r 19 12 15 r 24 19 15 r 12 7 12 r"],
      arp: [32, "0 .25 .5 .75 1 .75 .5 .25 0 .33 .67 1 .67 .33 0 r 1 .75 .5 .25 0 .25 .5 .75 1 .67 .33 0 .33 .67 1 r"],
    }),
  },
  {
    id: "empty-arcade",
    label: "Empty Arcade",
    description: "A slow chromatic memory with long rests, drifting texture, and eight fading echoes.",
    params: patch({
      tempo: 0.55,
      transpose: 7,
      patternSeed: 6.403,
      pitchRange: 1.12,
      gateRate: 0.45,
      gateLength: 1.86,
      pulseWidth: 0.46,
      pwmDepth: 0.38,
      pwmRate: 0.11,
      upperOneLevel: 0.72,
      upperTwoLevel: 0.88,
      bassPulseLevel: 0.36,
      bassSineLevel: 0.58,
      leadLevel: 0.92,
      arpLevel: 1.35,
      noiseLevel: 0.8,
      stereoWidth: 1.42,
      kickLevel: 0.3,
      snareLevel: 0.46,
      hatLevel: 0.6,
      shakerLevel: 0.72,
      drumDecay: 2.2,
      drumMix: 0.42,
      ghostDrums: 0.82,
      echoTaps: 8,
      echoTime: 0.61,
      echoDecay: 0.66,
      echoStereo: 1.5,
      fadeIn: 0.3,
      scaleMask: 4095,
      gatePatternSteps: 24,
      gateA0: 21845,
      gateB0: 43690,
      upperTwoRegister: 12,
      leadRegister: 0,
      leadClock: 3,
      leadSpan: 28,
      leadSectionShare: 0.35,
      fastGateShare: 0.3,
      snareCycle: 2,
      hatACycle: 4,
      hatASubcycle: 1.25,
      noiseRate: 2500,
      gain: 0.56,
    }),
    sequence: presetSequence({
      upperOne: [24, "0 r r . 1 r r . 6 r r . 5 r r . 11 r r . 7 r r ."],
      upperTwo: [20, "12 r . r 11 r . r 6 r . r 7 r . r 1 r . r"],
      bass: [8, "-12 r r r -11 r r r"],
      lead: [15, "r r 0 r r 6 r r 11 r r 5 r r ."],
      arp: [32, "0 r r . .13 r r . .27 r r . .4 r r . .53 r r . .67 r r . .8 r r . 1 r r ."],
    }),
  },
  {
    id: "meadow-hop",
    label: "Meadow Hop",
    description: "Pentatonic hops over a three-against-two gate bounce.",
    params: patch({
      tempo: 1.8, patternSeed: 0.91, scaleMask: 661, gateRate: 1.5,
      gateLength: 0.72, pulseWidth: 0.42, pwmDepth: 0.22,
      upperOnePhase: 0, upperTwoPhase: 0.25, bassPhase: 0.5,
      leadPhase: 0.25, arpPhase: 0.5, kickLevel: 0.9, snareLevel: 0.62,
      shakerLevel: 0.75, echoTaps: 3, echoTime: 0.16, echoDecay: 0.2, gain: 0.66,
    }),
    sequence: presetSequence({
      upperOne: [8, "0 2 4 r 7 4 2 r"],
      upperTwo: [12, "7 . 4 r 2 . 0 r 2 . 4 r"],
      bass: [4, "-12 . -5 r"],
      lead: [8, ". 7 r 9 . 7 4 r"],
      arp: [16, "0 .25 .5 .75 1 .75 .5 .25 0 r .5 r 1 .5 .25 r"],
    }),
  },
  {
    id: "ladder-rescue",
    label: "Ladder Rescue",
    description: "An ascending minor rescue call with syncopated upper voices and firm downbeats.",
    params: patch({
      tempo: 2.2, transpose: -3, patternSeed: 2.17, scaleMask: 1193,
      gateRate: 0.75, gateLength: 0.62, pulseWidth: 0.3, leadLevel: 1.45,
      bassPulseLevel: 1.35, kickLevel: 1.35, snareLevel: 0.8,
      echoTaps: 2, echoTime: 0.12, echoDecay: 0.12, gain: 0.61,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 . 3 r 7 . 10 r 12 . 10 r 7 . 3 r"],
      upperTwo: [16, "r 7 . 10 r 12 . 15 r 12 . 10 r 7 . 3"],
      bass: [8, "-12 . -12 -7 r -5 -7 ."],
      lead: [16, "0 3 7 r 10 12 15 r 19 15 12 r 10 7 3 r"],
      arp: [16, "0 .2 .4 .6 .8 1 .8 .6 .4 .2 0 r .4 .8 1 r"],
    }),
  },
  {
    id: "crater-caravan",
    label: "Crater Caravan",
    description: "A Dorian convoy whose five actors travel at interlocking fractional rates.",
    params: patch({
      tempo: 1.6, transpose: -7, patternSeed: 3.83, scaleMask: 1709,
      pitchClock: 1.5, upperTwoClockRatio: 0.6666666667, bassClock: 0.75,
      leadClock: 2.5, arpRate: 3.75, gateRate: 1.5, gateLength: 0.9,
      stereoWidth: 1.4, echoTaps: 5, echoTime: 0.28, echoDecay: 0.36,
      echoStereo: 1.3, gain: 0.61,
    }),
    sequence: presetSequence({
      upperOne: [12, "0 . 2 3 r 7 . 9 10 r 7 ."],
      upperTwo: [16, "7 r . 5 . 3 r . 2 . 0 r 2 . 3 r"],
      bass: [6, "-12 . -5 r -7 ."],
      lead: [15, "r 0 . 3 r 7 . 9 r 10 . 9 r 7 ."],
      arp: [24, "0 .2 .4 .6 .8 1 .8 .6 .4 .2 r . 0 .25 .5 .75 1 .75 .5 .25 0 r . .5"],
    }),
  },
  {
    id: "sewer-goblin",
    label: "Sewer Goblin",
    description: "Low Phrygian dirt in five mutually prime loops.",
    params: patch({
      tempo: 1.4, transpose: -12, patternSeed: 7.13, scaleMask: 1451,
      upperOneRegister: -24, upperTwoRegister: -24, bassRegister: -48,
      leadRegister: -12, arpRegister: -24, noiseLevel: 1.18, noiseColor: 0.5,
      pulseWidth: 0.68, pwmDepth: 0.12, kickTone: 0.58, snareNoiseMix: 0.82,
      echoTaps: 3, echoTime: 0.33, echoDecay: 0.27, gain: 0.56,
    }),
    sequence: presetSequence({
      upperOne: [7, "0 1 r 5 . 1 r"],
      upperTwo: [9, "r 5 . 1 r 0 . -1 r"],
      bass: [5, "-12 r -11 . -7"],
      lead: [11, "r 0 1 r 5 . 6 r 5 . r"],
      arp: [13, "0 .17 r .33 .5 r .67 .83 r 1 .67 .33 r"],
    }),
  },
  {
    id: "crystal-cavern",
    label: "Crystal Cavern",
    description: "Lydian sparkles climb through a wide, glassy eight-tap chamber.",
    params: patch({
      tempo: 1.2, transpose: 7, patternSeed: 4.44, scaleMask: 2773,
      pulseWidth: 0.18, pwmDepth: 0.12, upperOneRegister: 0, upperTwoRegister: 12,
      leadRegister: 12, arpRegister: 0, leadLevel: 1.5, arpLevel: 1.62,
      drumMix: 0.35, echoTaps: 8, echoTime: 0.44, echoDecay: 0.62,
      echoStereo: 1.5, echoWet: 1.2, gain: 0.52,
    }),
    sequence: presetSequence({
      upperOne: [24, "0 . 4 . 6 . 11 r 12 . 16 . 18 . 23 r 18 . 16 . 12 . 11 r"],
      upperTwo: [16, "12 r 18 . 23 r 18 . 16 r 12 . 11 r 6 ."],
      bass: [8, "-12 r . r -6 r . r"],
      lead: [12, "12 . 18 r 23 . 30 r 23 . 18 r"],
      arp: [32, "0 .125 .25 .375 .5 .625 .75 .875 1 .875 .75 .625 .5 .375 .25 .125 0 r .25 r .5 r .75 r 1 r .75 r .5 r .25 r"],
    }),
  },
  {
    id: "lava-bridge",
    label: "Lava Bridge",
    description: "Fast harmonic-minor leaps, hot octave answers, and short urgent drum tails.",
    params: patch({
      tempo: 2.6, transpose: -2, patternSeed: 5.81, scaleMask: 2477,
      gateRate: 2, gateLength: 0.5, leadInterval: 12, leadTrillRate: 16,
      pulseWidth: 0.23, pwmRate: 2.4, kickLevel: 1.6, snareLevel: 1.45,
      hatLevel: 1.3, drumDecay: 0.42, echoTaps: 2, echoTime: 0.1,
      echoDecay: 0.11, gain: 0.5,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 2 3 7 8 11 12 r 12 11 8 7 3 2 0 r"],
      upperTwo: [16, "12 r 8 7 3 r 2 0 12 r 11 8 7 r 3 2"],
      bass: [8, "-12 -12 -5 r -4 -4 -7 r"],
      lead: [16, "12 15 19 20 23 24 27 r 24 23 20 19 15 12 11 r"],
      arp: [16, "0 .25 .5 .75 1 .75 .5 .25 1 .75 .5 .25 0 .5 1 r"],
    }),
  },
  {
    id: "slime-waltz",
    label: "Slime Waltz",
    description: "Elastic three-beat phrases with third-cycle offsets and slow, wide pulse motion.",
    params: patch({
      tempo: 1.5, transpose: -5, patternSeed: 1.33, scaleMask: 1193,
      gateRate: 0.75, gateLength: 1.5, pulseWidth: 0.7, pwmDepth: 0.2,
      pwmRate: 0.18, upperTwoPhase: 0.3333333333, bassPhase: 0.6666666667,
      leadPhase: 0.3333333333, arpPhase: 0.6666666667, bassSineLevel: 1.5,
      shakerLevel: 0.8, echoTaps: 4, echoTime: 0.31, echoDecay: 0.34, gain: 0.6,
    }),
    sequence: presetSequence({
      upperOne: [12, "0 . 3 7 . r 5 . 3 0 . r"],
      upperTwo: [12, "7 . r 5 . 3 0 . r 3 . 5"],
      bass: [6, "-12 . r -5 . r"],
      lead: [12, "r 7 . 10 . 7 r 5 . 3 . 0"],
      arp: [18, "0 .25 .5 .75 1 .75 .5 .25 r 0 .33 .67 1 .67 .33 r .5 r"],
    }),
  },
  {
    id: "prime-parade",
    label: "Prime Parade",
    description: "Five prime-length loops parade at 5/4 through 13/8 rates before meeting again.",
    params: patch({
      tempo: 1.7, patternSeed: 6.17, scaleMask: 1717, pitchClock: 1.25,
      upperTwoClockRatio: 1.4, bassClock: 1.375, leadClock: 1.625,
      arpRate: 1.625, upperOnePhase: 0.2, upperTwoPhase: 0.2857142857,
      bassPhase: 0.3636363636, leadPhase: 0.4615384615, arpPhase: 0.5882352941,
      echoTaps: 2, echoTime: 0.17, echoDecay: 0.13, drumMix: 0.7, gain: 0.64,
    }),
    sequence: presetSequence({
      upperOne: [5, "0 2 4 r 7"],
      upperTwo: [7, "7 r 4 . 2 r 0"],
      bass: [11, "-12 . r -7 . -5 r . -7 . r"],
      lead: [13, "r 0 . 4 r 7 . 9 r 11 . 7 r"],
      arp: [17, "0 .125 .25 r .375 .5 r .625 .75 r .875 1 .75 r .5 .25 r"],
    }),
  },
  {
    id: "mirror-maze",
    label: "Mirror Maze",
    description: "Whole-tone phrases reflect between the two pulse actors in opposing phases.",
    params: patch({
      tempo: 1.9, patternSeed: 2.02, scaleMask: 1365, upperTwoRegister: 12,
      upperTwoClockRatio: 0.5, upperOnePhase: 0, upperTwoPhase: 0.5,
      leadInterval: -12, leadTrillPhase: 0.5, voiceCrossfeed: 0.72,
      echoCrossfeed: 0.8, echoAlternate: 1, echoTaps: 6, echoTime: 0.22,
      echoDecay: 0.43, stereoWidth: 1.5, gain: 0.57,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 2 4 6 8 10 12 r 12 10 8 6 4 2 0 r"],
      upperTwo: [16, "12 10 8 6 4 2 0 r 0 2 4 6 8 10 12 r"],
      bass: [8, "-12 r -8 r -4 r -8 r"],
      lead: [16, "0 r 4 r 8 r 12 r 12 r 8 r 4 r 0 r"],
      arp: [32, "0 .2 .4 .6 .8 1 .8 .6 .4 .2 0 r 1 .8 .6 .4 .2 0 .2 .4 .6 .8 1 r 0 .25 .5 .75 1 .75 .5 r"],
    }),
  },
  {
    id: "clockwork-bat",
    label: "Clockwork Bat",
    description: "Angular octatonic fragments flap through clipped, fast mechanical gates.",
    params: patch({
      tempo: 2.9, transpose: 3, patternSeed: 8.08, scaleMask: 2925,
      pulseWidth: 0.12, pwmDepth: 0.08, pwmRate: 3.6, gateLength: 0.25,
      gateAttack: 0.015, gateRelease: 0.08, leadTrillRate: 32,
      hatLevel: 1.55, shakerLevel: 1.25, echoTaps: 2, echoTime: 0.08,
      echoDecay: 0.09, gain: 0.46,
    }),
    sequence: presetSequence({
      upperOne: [8, "0 1 3 4 6 7 9 r"],
      upperTwo: [12, "9 r 7 6 4 r 3 1 0 r 3 6"],
      bass: [7, "-12 r -9 -8 r -6 -5"],
      lead: [5, "12 15 r 18 21"],
      arp: [16, "0 .33 .67 1 r .67 .33 0 1 .67 .33 r 0 .5 1 r"],
    }),
  },
  {
    id: "half-time-colossus",
    label: "Half-Time Colossus",
    description: "A quarter-speed bass monster walks beneath huge half-time drums.",
    params: patch({
      tempo: 1, transpose: -12, patternSeed: 3.14, scaleMask: 1193,
      bassClock: 0.25, drumRate: 0.5, kickCycle: 4, kickSubcycle: 2,
      gateLength: 2.4, bassPulseLevel: 1.9, bassSineLevel: 1.8,
      upperOneLevel: 0.35, upperTwoLevel: 0.28, leadLevel: 0.42,
      kickLevel: 1.8, snareLevel: 1.25, drumDecay: 2.4, drumMix: 1.3,
      echoTaps: 3, echoTime: 0.5, echoDecay: 0.3, gain: 0.53,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 r r r 3 r r r 7 r r r 3 r r r"],
      upperTwo: [12, "r . r . -5 . r . -2 . r ."],
      bass: [4, "-12 r -5 r"],
      lead: [8, "r r 0 r r r 7 r"],
      arp: [16, "0 r . r .5 r . r 1 r . r .5 r . r"],
    }),
  },
  {
    id: "triplet-rain",
    label: "Triplet Rain",
    description: "Three-against-two droplets move across offset twelve- and twenty-four-step loops.",
    params: patch({
      tempo: 2.1, patternSeed: 4.71, scaleMask: 1709, gateRate: 1.5,
      drumRate: 1.5, gateLength: 0.48, upperTwoPhase: 0.3333333333,
      leadPhase: 0.6666666667, arpPhase: 0.3333333333, echoTaps: 7,
      echoTime: 0.135, echoDecay: 0.46, echoStereo: 1.45,
      echoWet: 1.1, stereoWidth: 1.42, gain: 0.52,
    }),
    sequence: presetSequence({
      upperOne: [12, "0 . 2 4 . 7 9 . 11 9 . r"],
      upperTwo: [12, "7 . 9 11 . 14 11 . 9 7 . r"],
      bass: [9, "-12 . r -7 . r -5 . r"],
      lead: [12, "r 0 . 4 r 7 . 11 r 14 . r"],
      arp: [24, "0 .2 .4 .6 .8 1 .8 .6 .4 .2 r . 1 .8 .6 .4 .2 0 .2 .4 .6 .8 r ."],
    }),
  },
  {
    id: "one-button-march",
    label: "One-Button March",
    description: "Roots and fifths carry a blunt, dry march while the other actors whisper.",
    params: patch({
      tempo: 2, patternSeed: 1.01, scaleMask: 661, upperOneLevel: 0.12,
      upperTwoLevel: 0.08, arpLevel: 0.1, leadLevel: 1.55,
      bassPulseLevel: 1.7, bassSineLevel: 0.9, kickLevel: 1.5,
      snareLevel: 1.1, echoTaps: 2, echoTime: 0.1, echoDecay: 0.05,
      echoWet: 0.25, gain: 0.62,
    }),
    sequence: presetSequence({
      upperOne: [8, "0 r . r 7 r . r"],
      upperTwo: [8, "7 r . r 0 r . r"],
      bass: [4, "-12 -12 -5 r"],
      lead: [8, "0 r 7 r 0 r 7 r"],
      arp: [8, "0 r .5 r 1 r .5 r"],
    }),
  },
  {
    id: "bubble-slime",
    label: "Bubble Slime",
    description: "Round sine-heavy bass and elastic five-part gates wobble through uneven loops.",
    params: patch({
      tempo: 1.35, transpose: -4, patternSeed: 2.72, scaleMask: 1189,
      gateRate: 1.6666666667, gateLength: 1.2, pulseWidth: 0.78,
      pwmDepth: 0.16, pwmRate: 0.14, bassPulseLevel: 0.55,
      bassSineLevel: 1.75, bassPulseWidth: 0.8, shakerLevel: 1.1,
      kickTone: 0.7, echoTaps: 5, echoTime: 0.27, echoDecay: 0.39, gain: 0.57,
    }),
    sequence: presetSequence({
      upperOne: [10, "0 . 4 r 7 . 9 r 7 ."],
      upperTwo: [15, "7 r . 4 . 0 r . 2 . 4 r . 7 ."],
      bass: [5, "-12 . r -5 ."],
      lead: [20, "r 0 . 4 r 7 . 9 r 12 . 9 r 7 . 4 r 2 . r"],
      arp: [25, "0 .2 .4 .6 .8 1 .8 .6 .4 .2 r 0 .25 .5 .75 1 .75 .5 .25 0 r .5 .75 1 r"],
    }),
  },
  {
    id: "tin-knight",
    label: "Tin Knight",
    description: "Narrow metal pulses and noisy percussion clank in interlocked eighths and quarters.",
    params: patch({
      tempo: 2.25, transpose: -2, patternSeed: 9.1, scaleMask: 2477,
      pulseWidth: 0.1, pwmDepth: 0.06, pwmRate: 1.8, snareNoiseMix: 0.88,
      snareNoiseColor: 1.8, hatANoiseColor: 1.7, noiseColor: 1.6,
      gateRate: 2, bassClock: 0.5, leadClock: 4, arpRate: 8,
      echoTaps: 3, echoTime: 0.11, echoDecay: 0.16, gain: 0.53,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 3 r 7 10 r 7 3 0 3 r 7 12 r 10 7"],
      upperTwo: [8, "7 r 3 0 7 r 10 3"],
      bass: [8, "-12 r -7 . -5 r -7 ."],
      lead: [16, "r 0 3 r 7 10 r 12 r 10 7 r 3 0 r 7"],
      arp: [16, "0 .25 .5 .75 1 r .75 .5 .25 0 .5 1 r .5 .25 r"],
    }),
  },
  {
    id: "ghost-save-point",
    label: "Ghost Save Point",
    description: "Sparse suspended tones leave long afterimages while drums barely disturb the floor.",
    params: patch({
      tempo: 0.8, transpose: 5, patternSeed: 5.55, scaleMask: 1189,
      gateLength: 2.2, gateRelease: 1.4, kickLevel: 0.18, snareLevel: 0.16,
      hatLevel: 0.25, shakerLevel: 0.3, drumMix: 0.25, noiseLevel: 0.48,
      echoTaps: 8, echoTime: 0.68, echoDecay: 0.72, echoStereo: 1.5,
      echoCrossfeed: 0.9, echoWet: 1.28, stereoWidth: 1.5, gain: 0.48,
    }),
    sequence: presetSequence({
      upperOne: [16, "0 r r r . r r r 7 r r r . r r r"],
      upperTwo: [20, "r r 12 r r r . r r r 7 r r r . r r r 5 r"],
      bass: [8, "-12 r r r r r -5 r"],
      lead: [12, "r r 0 r r r 7 r r r 12 r"],
      arp: [32, "0 r r r . r r r .5 r r r . r r r 1 r r r . r r r .5 r r r . r r r"],
    }),
  },
  {
    id: "pixel-rain",
    label: "Pixel Rain",
    description: "Dense arpeggio droplets and moving texture sweep across long, offset loops.",
    params: patch({
      tempo: 1.3, transpose: 2, patternSeed: 6.66, scaleMask: 2773,
      upperOneLevel: 1.35, upperTwoLevel: 1.22, arpLevel: 1.7,
      bassPulseLevel: 0.5, leadLevel: 0.85, noiseLevel: 1.1,
      textureSweep: 2, texturePeriod: 3, textureDecay: 0.28,
      echoTaps: 8, echoTime: 0.18, echoDecay: 0.55, echoStereo: 1.45,
      echoWet: 1.2, gain: 0.5,
    }),
    sequence: presetSequence({
      upperOne: [32, "0 . 2 . 4 . 6 . 7 . 9 . 11 . 14 r 14 . 11 . 9 . 7 . 6 . 4 . 2 . 0 r"],
      upperTwo: [24, "7 . 9 . 11 r 14 . 16 . 14 r 11 . 9 . 7 r 4 . 2 . 0 r"],
      bass: [16, "-12 . r . -7 . r . -5 . r . -7 . r ."],
      lead: [20, "r 0 . 4 r 7 . 11 r 14 . 11 r 7 . 4 r 2 . r"],
      arp: [32, "0 .1 .2 .3 .4 .5 .6 .7 .8 .9 1 .9 .8 .7 .6 .5 .4 .3 .2 .1 0 .2 .4 .6 .8 1 .8 .6 .4 .2 0 r"],
    }),
  },
  {
    id: "corrupt-boot",
    label: "Corrupt Boot",
    description: "Chromatic, detuned prime loops and abrasive circuitry—the deliberately unstable edge case.",
    params: patch({
      tempo: 1.95, transpose: -9, tuningCents: 37, patternSeed: 9.73,
      scaleMask: 4095, pitchRange: 2, pulseWidth: 0.16, pwmDepth: 0.12,
      upperOnePhase: 0.1428571429, upperTwoPhase: 0.2727272727,
      bassPhase: 0.3846153846, leadPhase: 0.5294117647, arpPhase: 0.6842105263,
      noiseLevel: 1.65, noiseColor: 2, textureSweep: 2.5, kickLevel: 1.45,
      snareLevel: 1.6, hatLevel: 1.5, shakerLevel: 1.4, snareNoiseMix: 0.92,
      ghostDrums: 1.1, echoTaps: 7, echoTime: 0.093, echoDecay: 0.51,
      echoWet: 1.22, gain: 0.35,
    }),
    sequence: presetSequence({
      upperOne: [13, "0 1 r 6 11 . -3 r 8 2 . 13 r"],
      upperTwo: [17, "12 r 1 10 . -5 r 6 15 . 3 r -2 9 . 14 r"],
      bass: [7, "-12 -1 r -7 2 . r"],
      lead: [19, "r 0 13 -4 . 7 r 16 2 . -7 r 11 5 . 18 r -2 ."],
      arp: [23, "0 .91 r .13 .72 .35 r 1 .08 .64 r .27 .82 .45 r .18 .73 .36 r .95 .5 .04 r"],
    }),
  },
].map((preset) => Object.freeze({
  ...preset,
  params: Object.freeze(preset.params),
})));

const SAFE_RANDOM_RANGES = Object.freeze({
  tempo: [0.55, 2.2],
  transpose: [-17, 9],
  patternSeed: [0.45, 7.4],
  pitchRange: [0.45, 1.6],
  gateRate: [0.45, 2.25],
  gateLength: [0.35, 1.75],
  pulseWidth: [0.12, 0.82],
  pwmDepth: [0.03, 0.4],
  pwmRate: [0.04, 2.1],
  upperOneLevel: [0.2, 1.45],
  upperTwoLevel: [0.2, 1.45],
  bassPulseLevel: [0.25, 1.55],
  bassSineLevel: [0.2, 1.45],
  leadLevel: [0.15, 1.5],
  arpLevel: [0.2, 1.55],
  noiseLevel: [0.08, 1.15],
  stereoWidth: [0.25, 1.45],
  kickLevel: [0.2, 1.55],
  snareLevel: [0.2, 1.45],
  hatLevel: [0.15, 1.35],
  shakerLevel: [0.1, 1.25],
  kickTone: [0.45, 2.2],
  snareTone: [0.5, 2.1],
  drumDecay: [0.45, 2.3],
  drumMix: [0.25, 1.25],
  ghostDrums: [0.05, 1],
  echoTaps: [2, 8],
  echoTime: [0.1, 0.62],
  echoDecay: [0.08, 0.67],
  echoStereo: [0.2, 1.45],
  fadeIn: [0.08, 1.7],
  gain: [0.42, 0.78],
  upperOneSpan: [8, 32],
  upperTwoSpan: [5, 22],
  bassSpan: [2, 10],
  upperOneRegister: [-24, 0],
  bassRegister: [-48, -24],
  arpRegister: [-24, 0],
  sectionUnits: [12, 52],
  pitchClock: [1.5, 8],
  bassClock: [0.5, 2],
  gateFastRatio: [1.2, 3.2],
  gateSwitchShortUnits: [2, 10],
  gateSwitchLongUnits: [8, 40],
  leadTrillRate: [4, 40],
  leadInterval: [-7, 14],
  leadPhraseUnits: [1.5, 6],
  arpRate: [12, 64],
  arpSpan: [4, 18],
  arpOctaveRate: [0.125, 2],
  arpOctaves: [1, 4],
  bassPulseWidth: [0.12, 0.82],
  drumRate: [0.5, 2.2],
  echoCrossfeed: [0.1, 0.85],
  gateAttack: [0.015, 0.16],
  gateRelease: [0.12, 1.2],
  texturePeriod: [2, 20],
  textureDecay: [0.15, 2],
  kickCycle: [1, 4],
  kickSubcycle: [0.5, 2.5],
  snareNoiseMix: [0.18, 0.85],
  hatBalance: [0.15, 0.85],
  ghostDelayDivisor: [2, 16],
  ghostPan: [-0.75, 0.75],
  gatePatternSteps: [8, 32],
  gateShortRatio: [0.35, 1],
  gateLongRatio: [1.1, 3],
  fastGateShare: [0.2, 0.8],
  longGateBoostShare: [0.2, 0.8],
  leadSectionShare: [0.2, 0.8],
  leadTrillShare: [0.2, 0.8],
  tuningCents: [-25, 25],
  upperTwoRegister: [-24, 12],
  leadRegister: [-24, 12],
  leadClock: [2, 12],
  leadSpan: [4, 28],
  arpBassFollow: [0.4, 1.4],
  voiceCrossfeed: [0.15, 0.85],
  synthMix: [0.45, 1.35],
  fadeCurve: [1, 4],
  echoAlternate: [0, 1],
  snareCycle: [0.5, 2],
  snarePhase: [0, 127 / 128],
  hatACycle: [1, 4],
  hatASubcycle: [0.3125, 1.25],
  hatARepeat: [0.125, 0.5],
  hatAPhase: [0, 127 / 128],
  hatBCycle: [0.25, 1],
  shakerCycle: [0.25, 1],
  shakerPhase: [0, 127 / 128],
  noiseRate: [2000, 8000],
  noiseColor: [0.5, 2],
  textureSweep: [0.5, 2],
  kickBodyPhase: [200, 800],
  kickTransientPhase: [50, 300],
  kickBodySweep: [0.5, 2],
  kickTransientSweep: [50, 200],
  kickAttackTime: [0.05, 0.5],
  kickDecayRate: [5, 20],
  kickClipKnee: [0.08, 0.8],
  snareHoldTime: [0, 0.6],
  snareDecayRate: [5, 20],
  snareNoiseSweep: [0.5, 2],
  snareNoiseRate: [2, 8],
  snareModRate: [50, 200],
  snareModDepth: [1, 8],
  snareCarrierRate: [1000, 4000],
  hatANoiseRate: [2, 8],
  hatADecayRate: [12.5, 50],
  hatBLowNoiseRate: [1, 4],
  hatBHighNoiseRate: [50, 200],
  hatBHighMix: [0.1, 1.5],
  hatBDecayRate: [2, 8],
  shakerNoiseRate: [4.5, 18],
  shakerDecayRate: [4, 16],
  upperTwoClockRatio: [0.5, 2],
  kickPhase: [0, 127 / 128],
  hatBPhase: [0, 127 / 128],
  hatARepeatPhase: [0, 127 / 128],
  arpPhase: [0, 127 / 128],
  echoWet: [0.25, 1.35],
  arpGateDepth: [0, 0.8],
  bassGateRateRatio: [0.5, 2],
  leadGateRateRatio: [0.5, 2],
  upperTwoGateRateRatio: [0.5, 2],
  snareNoiseColor: [0.5, 2],
  hatANoiseColor: [0.5, 2],
  hatBNoiseColor: [0.5, 2],
  shakerNoiseColor: [0.5, 2],
  upperOnePhase: [0, 127 / 128],
  upperTwoPhase: [0, 127 / 128],
  bassPhase: [0, 127 / 128],
  leadPhase: [0, 127 / 128],
  gatePatternPhase: [0, 127 / 128],
  gateSwitchShortPhase: [0, 127 / 128],
  gateSwitchLongPhase: [0, 127 / 128],
  sectionPhase: [0, 127 / 128],
  leadTrillPhase: [0, 127 / 128],
  leadPhrasePhase: [0, 127 / 128],
  arpOctavePhase: [0, 127 / 128],
  texturePhase: [0, 127 / 128],
});

const support = webGpuChiptuneSupport(globalThis);
const state = {
  params: sanitizeWebGpuChiptuneParams(),
  sequence: createWebGpuChiptuneSequence(),
  trackerView: "sequence",
  activeSequenceLane: "upperOne",
  activeSequenceStep: 0,
  sequencePage: 0,
  sequenceEditMode: "note",
  sequenceFollowLive: true,
  sequencePitchSpan: 36,
  presetId: "source-tracker",
  audioOn: false,
  synthPlaying: false,
  transportOffset: 0,
  transportStartedAt: 0,
  chunkDuration: WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.chunkDuration,
  workgroupSize: WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.workgroupSize,
  editingStage: false,
  disposed: false,
};

let lastVoiceSequenceLane = state.activeSequenceLane;
const controlInputs = new Map();
const controlOutputs = new Map();
const fractionControls = new Map();
const knobControls = new Map();
const knobOutputs = new Map();
const scaleButtons = new Map();
const gateButtons = new Map();
const trackerNoteCache = new Map();
let trackerCacheParams = null;
let trackerCacheSequence = null;
let trackerCacheWindowStart = null;

let engine = null;
let audioStartPromise = null;
let audioLifecycleGeneration = 0;
let transportGeneration = 0;
let animationFrame = 0;
let activeKnobDrag = null;
let activeSequenceDrag = null;
let activeSequenceValueStep = null;
let sequencePlayhead = -1;
let lastSequenceTimingUi = 0;
let resizeObserver = null;
let waxStateListener = null;

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function transportTime() {
  if (state.synthPlaying && state.audioOn && engine) {
    const gpuTime = engine.currentPlaybackTime();
    if (Number.isFinite(gpuTime)) return gpuTime;
  }
  if (!state.synthPlaying) return state.transportOffset;
  return state.transportOffset + Math.max(0, performance.now() / 1000 - state.transportStartedAt);
}

function alignVisualTransport(offset, actualStartTime, audioEngine) {
  const contextTime = Number(audioEngine?.context?.currentTime) || 0;
  const startDelay = Math.max(0, Number(actualStartTime) - contextTime);
  state.transportOffset = Math.max(0, Number(offset) || 0);
  state.transportStartedAt = performance.now() / 1000 + startDelay;
}

async function restartSynchronizedAudio(audioEngine, offset, generation) {
  audioEngine.setPlaybackEnabled(false);
  const actualStartTime = await audioEngine.restart({ offset });
  if (
    engine !== audioEngine
    || generation !== transportGeneration
    || !state.synthPlaying
  ) {
    audioEngine.pause();
    return false;
  }
  alignVisualTransport(offset, actualStartTime, audioEngine);
  audioEngine.setPlaybackEnabled(true);
  return true;
}

function setRuntimeState() {
  $("chunkDurationOut").textContent = Math.round(state.chunkDuration * 1000) + " ms";
  $("workgroupSizeOut").textContent = state.workgroupSize + " lanes";
  $("runtimeState").textContent = state.workgroupSize + " lanes";
}

function setSupportState() {
  if (!support.audio) {
    $("gpuState").textContent = "Web Audio unavailable";
    $("streamState").textContent = "AudioContext missing";
  } else if (!support.webgpu) {
    $("gpuState").textContent = "WebGPU unavailable";
    $("streamState").textContent = "navigator.gpu missing";
  } else {
    $("gpuState").textContent = "WebGPU ready";
    $("streamState").textContent = "WGSL tracker engine";
  }
  $("audioButton").disabled = !support.supported || Boolean(audioStartPromise);
}

function paintAudioReadout() {
  if (state.audioOn) {
    $("engineBadge").textContent = state.synthPlaying ? "Shader song playing" : "WebGPU armed";
    $("stageReadout").textContent = "WEBGPU · "
      + Math.round(engine?.sampleRate ?? 44100)
      + " HZ · "
      + (state.synthPlaying ? "TRACKER PLAYING" : "TRACKER PAUSED");
  } else {
    $("engineBadge").textContent = state.synthPlaying ? "Visual tracker · audio off" : "WGSL sound shader";
    $("stageReadout").textContent = state.synthPlaying
      ? "VISUAL TRANSPORT PLAYING · AUDIO OFF"
      : "WEBGPU · STANDBY · AUDIO OFF";
  }
  if (state.trackerView === "sequence") {
    syncSequenceControls();
  } else {
    $("stage").setAttribute(
      "aria-label",
      "Pattern Morph Pad. Horizontal position changes the procedural seed and vertical position "
        + "changes pitch range. Audio "
        + (state.audioOn ? "on" : "off")
        + ", transport "
        + (state.synthPlaying ? "playing." : "paused."),
    );
  }
}

function setAudioState(enabled) {
  state.audioOn = Boolean(enabled);
  $("audioButton").setAttribute("aria-pressed", String(state.audioOn));
  $("audioState").textContent = state.audioOn ? "on" : "off";
  if (state.audioOn && engine) {
    $("gpuState").textContent = "WebGPU streaming";
    $("streamState").textContent = Math.round(engine.chunkDurationInSeconds * 1000)
      + " ms stereo chunks";
  } else {
    setSupportState();
  }
  paintAudioReadout();
}

function setSynthPlayButtonState() {
  const action = state.synthPlaying ? "Pause WebGPU Chiptune" : "Play WebGPU Chiptune";
  const button = $("synthPlayButton");
  button.disabled = state.disposed;
  button.setAttribute("aria-pressed", String(state.synthPlaying));
  button.setAttribute("aria-label", action);
  button.title = action + " (Space)";
  $("synthPlayLabel").textContent = state.synthPlaying ? "Pause chiptune" : "Play chiptune";
  $("synthPlayState").textContent = state.synthPlaying ? "playing · Space" : "paused · Space";
  paintAudioReadout();
}

function notifyWaxState() {
  waxStateListener?.({
    parameters: { ...state.params },
    activePresetId: state.presetId,
    sequence: state.sequence,
  });
}

function gateCodeKey(lane, step) {
  return "gate" + lane + Math.floor(step / 8);
}

function gateStateIndex(params, lane, step) {
  const code = Math.round(params[gateCodeKey(lane, step)] ?? 0);
  return (code >> ((step % 8) * 2)) & 3;
}

function setGateState(params, lane, step, stateIndex) {
  const key = gateCodeKey(lane, step);
  const shift = (step % 8) * 2;
  const code = Math.round(params[key] ?? 0);
  return {
    ...params,
    [key]: (code & ~(3 << shift)) | ((stateIndex & 3) << shift),
  };
}

function enabledPitchClassCount(mask) {
  let value = Math.round(mask);
  let count = 0;
  for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
    if ((value & (1 << pitchClass)) !== 0) count += 1;
  }
  return count;
}

function syncPresetOutputs() {
  const preset = presets.find(({ id }) => id === state.presetId);
  const label = preset?.label ?? "Custom";
  $("patternState").textContent = Math.round(state.params.tempo * 60)
    + " BPM · "
    + label;
  $("characterPreset").textContent = label;
  $("presetDescription").textContent = preset?.description
    ?? "Custom performance · the cast follows your live shader and sequence edits.";
  for (const button of $("presetButtons").querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.presetId === state.presetId));
  }
  const activeIndex = presets.findIndex(({ id }) => id === state.presetId);
  const previous = presets[activeIndex < 0
    ? presets.length - 1
    : positiveModulo(activeIndex - 1, presets.length)];
  const next = presets[activeIndex < 0 ? 0 : positiveModulo(activeIndex + 1, presets.length)];
  $("previousPreset").setAttribute("aria-label", "Previous preset: " + previous.label);
  $("nextPreset").setAttribute("aria-label", "Next preset: " + next.label);
}

function syncParamOutputs() {
  for (const [key, input] of controlInputs) {
    const value = state.params[key];
    const valueText = formatWebGpuChiptuneValue(key, value);
    input.value = String(webGpuChiptuneParamToUnit(key, value));
    input.setAttribute("aria-valuetext", valueText);
    const output = controlOutputs.get(key);
    if (output) output.textContent = valueText;
  }
  for (const [key, control] of fractionControls) {
    const pair = fractionForValue(state.params[key]);
    const editing = control.wrapper.contains(document.activeElement);
    if (!editing) {
      control.numerator.value = String(pair.numerator);
      control.denominator.value = String(pair.denominator);
    }
    control.lastPair = pair;
    const fractionText = pair.numerator + "/" + pair.denominator;
    const prefix = pair.exact ? "" : "~";
    control.output.textContent = prefix + fractionText + fractionUnitForKey(key);
    control.numerator.setAttribute(
      "aria-valuetext",
      pair.numerator + ", numerator of " + fractionText,
    );
    control.denominator.setAttribute(
      "aria-valuetext",
      pair.denominator + ", denominator of " + fractionText,
    );
  }
  for (const [key, knob] of knobControls) {
    const spec = knob.controlSpec;
    const value = state.params[key];
    const unit = webGpuChiptuneParamToUnit(key, value);
    const angle = -135 + unit * 270;
    const valueText = formatWebGpuChiptuneValue(key, value);
    knob.style.setProperty("--knob-angle", angle + "deg");
    knob.style.setProperty("--knob-fill", unit * 75 + "%");
    knob.setAttribute("aria-valuenow", String(value));
    knob.setAttribute("aria-valuetext", valueText);
    const output = knobOutputs.get(key);
    if (output) output.textContent = valueText;
  }

  const scaleOutput = $("scaleMaskOut");
  if (scaleOutput) {
    scaleOutput.textContent = enabledPitchClassCount(state.params.scaleMask)
      + " notes · "
      + formatWebGpuChiptuneValue("scaleMask", state.params.scaleMask);
  }
  for (const [pitchClass, button] of scaleButtons) {
    const enabled = (state.params.scaleMask & (1 << pitchClass)) !== 0;
    button.setAttribute("aria-pressed", String(enabled));
  }
  for (const [identity, button] of gateButtons) {
    const [lane, stepText] = identity.split(":");
    const step = Number(stepText);
    const gateStateNumber = gateStateIndex(state.params, lane, step);
    const gateState = gateStates[gateStateNumber];
    const outsideLoop = step >= state.params.gatePatternSteps;
    const ratio = gateStateNumber === 1
      ? state.params.gateShortRatio
      : gateStateNumber === 3 ? state.params.gateLongRatio : gateState.duration;
    const duration = gateStateNumber === 0 ? "off" : ratio.toFixed(2) + "x " + gateState.label;
    button.dataset.gateState = String(gateStateNumber);
    button.dataset.outsideLoop = String(outsideLoop);
    button.textContent = gateState.glyph;
    button.setAttribute("aria-pressed", String(gateState.duration > 0));
    button.setAttribute("aria-label", "Gate " + lane + ", step " + (step + 1) + ", " + duration
      + (outsideLoop ? ", outside active loop" : ""));
    button.title = "Step " + (step + 1) + ": " + duration
      + (outsideLoop ? " (outside active loop)" : "");
  }
  for (const grid of document.querySelectorAll(".chiptune-gate-grid")) {
    grid.setAttribute("aria-label", "Gate " + grid.dataset.lane + " "
      + state.params.gatePatternSteps + "-step pattern");
  }

  syncPresetOutputs();
  $("voiceState").textContent = "seed " + state.params.patternSeed.toFixed(3);
  $("drumState").textContent = "bus " + Math.round(state.params.drumMix * 100) + "%";
  $("echoState").textContent = Math.round(state.params.echoTaps) + " taps";
  $("advancedState").textContent = enabledPitchClassCount(state.params.scaleMask)
    + "-note scale · editable gates";
  $("gestureReadout").textContent = "seed "
    + state.params.patternSeed.toFixed(3)
    + " · range "
    + state.params.pitchRange.toFixed(2)
    + "x";

  syncSequenceControls();
}

function applyParams(nextParams, presetId = "custom", { notify = true } = {}) {
  state.params = sanitizeWebGpuChiptuneParams(nextParams);
  state.presetId = presetId;
  syncParamOutputs();
  engine?.updateParams(state.params);
  if (notify) notifyWaxState();
}

function applySequence(
  nextSequence,
  { notify = true, markCustom = true, presetId = null } = {},
) {
  state.sequence = sanitizeWebGpuChiptuneSequence(nextSequence);
  if (markCustom) state.presetId = "custom";
  else if (typeof presetId === "string") state.presetId = presetId;
  trackerCacheSequence = null;
  trackerNoteCache.clear();
  engine?.updateSequence(state.sequence);
  syncSequenceControls();
  syncPresetOutputs();
  if (notify) notifyWaxState();
}

function applyPreset(preset) {
  state.params = sanitizeWebGpuChiptuneParams(preset.params);
  state.sequence = sanitizeWebGpuChiptuneSequence(preset.sequence);
  state.presetId = preset.id;
  trackerCacheParams = null;
  trackerCacheSequence = null;
  trackerNoteCache.clear();
  syncParamOutputs();
  engine?.updateParams(state.params);
  engine?.updateSequence(state.sequence);
  notifyWaxState();
  announce(preset.label + " selected.");
}

function cyclePreset(direction) {
  const activeIndex = presets.findIndex(({ id }) => id === state.presetId);
  const baseIndex = activeIndex < 0 ? (direction < 0 ? 0 : -1) : activeIndex;
  applyPreset(presets[positiveModulo(baseIndex + direction, presets.length)]);
}

function quantizeControlValue(spec, rawValue) {
  let value = clamp(rawValue, spec.min, spec.max);
  if (integerParams.has(spec.key)) return Math.round(value);
  const quantum = Number(spec.quantum) || 0;
  if (quantum > 0) {
    value = spec.min + Math.round((value - spec.min) / quantum) * quantum;
  }
  return clamp(Number(value.toFixed(12)), spec.min, spec.max);
}

function applyControlValue(spec, rawValue) {
  const value = quantizeControlValue(spec, rawValue);
  applyParams({ ...state.params, [spec.key]: value });
}

function applyControlUnit(spec, rawUnit) {
  applyControlValue(spec, webGpuChiptuneParamFromUnit(spec.key, rawUnit));
}

function nudgeControl(spec, direction, { page = false, fine = false } = {}) {
  if (integerParams.has(spec.key)) {
    applyControlValue(spec, state.params[spec.key] + direction * (page ? 8 : 1));
    return;
  }
  const scale = fine ? 0.1 : 1;
  const unit = webGpuChiptuneParamToUnit(spec.key, state.params[spec.key]);
  applyControlUnit(spec, unit + direction * (page ? 0.08 : 0.01) * scale);
}

function handleControlKey(event, spec) {
  if (event.key === "ArrowUp" || event.key === "ArrowRight") {
    event.preventDefault();
    nudgeControl(spec, 1, { fine: event.shiftKey });
    return true;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
    event.preventDefault();
    nudgeControl(spec, -1, { fine: event.shiftKey });
    return true;
  }
  if (event.key === "PageUp" || event.key === "PageDown") {
    event.preventDefault();
    nudgeControl(spec, event.key === "PageUp" ? 1 : -1, {
      page: true,
      fine: event.shiftKey,
    });
    return true;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    applyControlValue(spec, event.key === "Home" ? spec.min : spec.max);
    return true;
  }
  return false;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}

function fractionForValue(value, maximumDenominator = 128) {
  const source = Math.max(0, Number(value) || 0);
  let bestNumerator = Math.round(source);
  let bestDenominator = 1;
  let bestError = Math.abs(source - bestNumerator);
  for (let denominator = 1; denominator <= maximumDenominator; denominator += 1) {
    const numerator = Math.round(source * denominator);
    const error = Math.abs(source - numerator / denominator);
    if (error + 1e-12 < bestError) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
    }
    if (bestError < 1e-12) break;
  }
  const divisor = greatestCommonDivisor(bestNumerator, bestDenominator);
  return Object.freeze({
    numerator: bestNumerator / divisor,
    denominator: bestDenominator / divisor,
    exact: bestError < 1e-9,
  });
}

function nearestMusicalFraction(key, value, bounds = WEBGPU_CHIPTUNE_LIMITS[key]) {
  if (!musicalFractionParams.has(key)) return value;
  const [minimum, maximum] = bounds;
  const bounded = clamp(value, minimum, maximum);
  const pair = fractionForValue(bounded);
  return clamp(pair.numerator / pair.denominator, minimum, maximum);
}

function fractionUnitForKey(key) {
  if (fractionPhaseParams.has(key)) return " cycle";
  if (fractionDrumPeriodParams.has(key)) return " drum-clock units";
  if (fractionPeriodParams.has(key)) return " master beats";
  if (key === "gateLength") return " gate steps";
  if (key === "gateRate") return " x base gate clock (8 steps/beat)";
  if (key === "upperTwoClockRatio") return " x Upper A note rate";
  if (key === "gateShortRatio" || key === "gateLongRatio") {
    return " x gate length";
  }
  if (key === "gateFastRatio" || key.endsWith("GateRateRatio")) return " x gate rate";
  if ([
    "pitchClock",
    "bassClock",
    "leadClock",
    "leadTrillRate",
    "arpRate",
    "arpOctaveRate",
    "drumRate",
  ].includes(key)) return " per master beat";
  return "";
}

function restoreFractionControl(control) {
  const pair = fractionForValue(state.params[control.spec.key]);
  control.numerator.value = String(pair.numerator);
  control.denominator.value = String(pair.denominator);
  syncParamOutputs();
}

function commitFractionControl(control, { announceChange = false } = {}) {
  const numeratorText = control.numerator.value.trim();
  const denominatorText = control.denominator.value.trim();
  const draftText = (numeratorText || "empty") + "/" + (denominatorText || "empty");
  control.numerator.setAttribute("aria-valuetext", (numeratorText || "empty")
    + ", numerator of " + draftText);
  control.denominator.setAttribute("aria-valuetext", (denominatorText || "empty")
    + ", denominator of " + draftText);
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  const normalizedNumerator = Math.max(0, Math.trunc(numerator));
  const normalizedDenominator = Math.trunc(denominator);
  const value = normalizedNumerator / normalizedDenominator;
  if (
    !numeratorText
    || !denominatorText
    || !Number.isFinite(numerator)
    || !Number.isFinite(denominator)
    || !Number.isInteger(numerator)
    || !Number.isInteger(denominator)
    || numerator < 0
    || denominator < 1
    || denominator > 128
    || value < control.spec.min
    || value > control.spec.max
    || (fractionPhaseParams.has(control.spec.key)
      && normalizedNumerator >= normalizedDenominator)
  ) {
    if (announceChange) {
      announce(control.spec.label + " needs an in-range fraction with denominator 1 to 128.");
      const setTimer = globalThis.setTimeout ?? setTimeout;
      setTimer(() => restoreFractionControl(control), 0);
    }
    return false;
  }
  const divisor = greatestCommonDivisor(normalizedNumerator, normalizedDenominator);
  const reducedNumerator = normalizedNumerator / divisor;
  const reducedDenominator = normalizedDenominator / divisor;
  control.numerator.value = String(reducedNumerator);
  control.denominator.value = String(reducedDenominator);
  applyParams({
    ...state.params,
    [control.spec.key]: reducedNumerator / reducedDenominator,
  });
  if (announceChange) {
    const actual = fractionForValue(state.params[control.spec.key]);
    announce(
      control.spec.label
        + " set to "
        + actual.numerator
        + "/"
        + actual.denominator
        + ".",
    );
  }
  return true;
}

function createFractionControl(spec) {
  const wrapper = document.createElement("fieldset");
  wrapper.className = "control chiptune-fraction-control";
  const legend = document.createElement("legend");
  const label = document.createElement("b");
  label.textContent = spec.label;
  const output = document.createElement("output");
  output.id = spec.key + "Out";
  legend.append(label, output);

  const fields = document.createElement("div");
  fields.className = "chiptune-fraction-fields";
  const numerator = document.createElement("input");
  numerator.id = spec.key + "Numerator";
  numerator.type = "number";
  numerator.min = spec.min === 0 ? "0" : "1";
  numerator.max = String(Math.max(1, Math.ceil(spec.max * 128)));
  numerator.step = "1";
  numerator.inputMode = "numeric";
  numerator.setAttribute("aria-label", spec.label + " numerator");
  const slash = document.createElement("span");
  slash.setAttribute("aria-hidden", "true");
  slash.textContent = "/";
  const denominator = document.createElement("input");
  denominator.id = spec.key + "Denominator";
  denominator.type = "number";
  denominator.min = "1";
  denominator.max = "128";
  denominator.step = "1";
  denominator.inputMode = "numeric";
  denominator.setAttribute("aria-label", spec.label + " denominator");
  const unit = document.createElement("small");
  unit.textContent = fractionUnitForKey(spec.key).trim();
  fields.append(numerator, slash, denominator, unit);

  const control = { spec, wrapper, numerator, denominator, output, lastPair: null };
  const applyLive = () => commitFractionControl(control);
  const commit = () => commitFractionControl(control, { announceChange: true });
  for (const input of [numerator, denominator]) {
    input.addEventListener("input", applyLive);
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        restoreFractionControl(control);
      }
    });
  }
  wrapper.addEventListener("focusout", () => {
    const setTimer = globalThis.setTimeout ?? setTimeout;
    setTimer(() => {
      if (!wrapper.contains(document.activeElement)) syncParamOutputs();
    }, 0);
  });
  fractionControls.set(spec.key, control);
  wrapper.append(legend, fields);
  return wrapper;
}

function createParamControl(spec) {
  return musicalFractionParams.has(spec.key)
    ? createFractionControl(spec)
    : createRangeControl(spec);
}

function createRangeControl(spec) {
  const wrapper = document.createElement("label");
  wrapper.className = "control";
  wrapper.htmlFor = spec.key;

  const row = document.createElement("span");
  const label = document.createElement("b");
  label.textContent = spec.label;
  const output = document.createElement("output");
  output.id = spec.key + "Out";
  output.htmlFor = spec.key;
  row.append(label, output);

  const input = document.createElement("input");
  input.id = spec.key;
  input.type = "range";
  input.min = "0";
  input.max = "1";
  input.step = "0.001";
  input.controlSpec = spec;
  input.setAttribute("aria-label", spec.label);
  input.addEventListener("input", () => {
    const requestedUnit = input.value;
    applyControlUnit(spec, requestedUnit);
    input.value = requestedUnit;
  });
  input.addEventListener("keydown", (event) => handleControlKey(event, spec));

  controlInputs.set(spec.key, input);
  controlOutputs.set(spec.key, output);
  wrapper.append(row, input);
  return wrapper;
}

function createScaleEditor() {
  const wrapper = document.createElement("div");
  wrapper.className = "chiptune-advanced-editor";
  const heading = document.createElement("span");
  heading.className = "chiptune-editor-heading";
  const label = document.createElement("b");
  label.textContent = "Scale pitch classes";
  const output = document.createElement("output");
  output.id = "scaleMaskOut";
  heading.append(label, output);

  const grid = document.createElement("div");
  grid.className = "chiptune-scale-grid";
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Scale pitch classes");
  scaleButtons.clear();
  for (let pitchClass = 0; pitchClass < scaleLabels.length; pitchClass += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = scaleLabels[pitchClass];
    button.addEventListener("click", () => {
      const bit = 1 << pitchClass;
      const nextMask = state.params.scaleMask ^ bit;
      if (nextMask === 0) {
        announce("The scale needs at least one pitch class.");
        return;
      }
      applyParams({ ...state.params, scaleMask: nextMask });
    });
    scaleButtons.set(pitchClass, button);
    grid.append(button);
  }
  wrapper.append(heading, grid);
  return wrapper;
}

function createGateLane(lane) {
  const wrapper = document.createElement("div");
  wrapper.className = "chiptune-gate-lane";
  const label = document.createElement("b");
  label.textContent = "Gate " + lane;
  const grid = document.createElement("div");
  grid.className = "chiptune-gate-grid";
  grid.dataset.lane = lane;
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Gate " + lane + " 32-step pattern");
  for (let step = 0; step < 32; step += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => {
      const nextState = (gateStateIndex(state.params, lane, step) + 1) % gateStates.length;
      applyParams(setGateState(state.params, lane, step, nextState));
    });
    gateButtons.set(lane + ":" + step, button);
    grid.append(button);
  }
  wrapper.append(label, grid);
  return wrapper;
}

function createGateEditor() {
  const wrapper = document.createElement("div");
  wrapper.className = "chiptune-advanced-editor chiptune-gate-editor";
  gateButtons.clear();
  wrapper.append(createGateLane("A"), createGateLane("B"));
  const note = document.createElement("small");
  note.textContent = "Each cell cycles off · short · medium · long.";
  wrapper.append(note);
  return wrapper;
}

function activeSequenceDefinition() {
  return sequenceLaneDefinitions.find(({ key }) => key === state.activeSequenceLane)
    ?? sequenceLaneDefinitions[0];
}

function activeSequenceSpec() {
  return WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[state.activeSequenceLane];
}

function sequenceRateForUi(lane) {
  if (WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane)) {
    return state.params.drumRate * 4;
  }
  if (lane === "upperOne") return state.params.pitchClock;
  if (lane === "upperTwo") {
    return state.params.pitchClock * state.params.upperTwoClockRatio;
  }
  if (lane === "bass") return state.params.bassClock;
  if (lane === "lead") return state.params.leadClock;
  return state.params.arpRate;
}

function sequencePhaseForUi(lane) {
  const key = {
    upperOne: "upperOnePhase",
    upperTwo: "upperTwoPhase",
    bass: "bassPhase",
    lead: "leadPhase",
    arp: "arpPhase",
  }[lane];
  return state.params[key] ?? 0;
}

function sequenceBeatForStep(lane, step) {
  const length = state.sequence.lanes[lane].activeLength;
  const rate = Math.max(0.000001, sequenceRateForUi(lane));
  return (step - sequencePhaseForUi(lane) * length) / rate;
}

function suggestedSequenceValue(lane, step) {
  const spec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
  if (spec.kind === "drums") return 1;
  const beat = sequenceBeatForStep(lane, step + 0.5);
  const generated = webGpuChiptuneProceduralLaneValue(lane, beat, state.params, state.sequence);
  return webGpuChiptuneSequenceEditorValue(
    lane,
    webGpuChiptuneSequenceEditorUnit(lane, generated),
  );
}

function sequenceLaneWithChanges(lane, changes) {
  return {
    schemaVersion: 2,
    lanes: {
      ...state.sequence.lanes,
      [lane]: {
        ...state.sequence.lanes[lane],
        ...changes,
      },
    },
  };
}

function signedNumber(value) {
  const number = Number(value);
  return (number >= 0 ? "+" : "") + (Number.isInteger(number) ? number : number.toFixed(2));
}

function shaderNoteName(note) {
  if (!Number.isFinite(note)) return "";
  const midi = 69 + Math.round(note);
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function resolvedSequenceNote(lane, step) {
  const beat = sequenceBeatForStep(lane, step + 0.5);
  return webGpuChiptuneBeatSnapshot(beat, state.params, state.sequence)[lane];
}

function describeSequenceCell(lane, step, cell, activeLength) {
  const definition = sequenceLaneDefinitions.find(({ key }) => key === lane);
  const spec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
  let description = spec.kind === "drums"
    ? "source shader rhythm"
    : "source shader value";
  if (cell.state === "rest") description = spec.kind === "drums" ? "off" : "rest";
  else if (cell.state === "note" && spec.kind === "drums") description = "hit";
  else if (cell.state === "note" && spec.kind === "contour") {
    description = "manual shape " + cell.value.toFixed(3);
  } else if (cell.state === "note") description = "manual note offset " + signedNumber(cell.value);
  return definition.label
    + ", step "
    + (step + 1)
    + ", "
    + description
    + (step < activeLength ? ", inside " : ", stored outside ")
    + activeLength
    + "-step loop";
}

function sequencePageSizeForWidth(width) {
  return Number(width) <= 620 ? 8 : 16;
}

function activeSequencePageSize() {
  const width = $("stage")?.getBoundingClientRect?.().width
    || $("stageWrap")?.getBoundingClientRect?.().width
    || 981;
  return sequencePageSizeForWidth(width);
}

function sequencePageForStep(step, pageSize = activeSequencePageSize()) {
  return Math.floor(clamp(step, 0, WEBGPU_CHIPTUNE_SEQUENCE_STEPS - 1) / pageSize);
}

function liveEditLeadSeconds() {
  if (!state.audioOn || !state.synthPlaying) return 0;
  return clamp(state.chunkDuration + 0.03, 0.08, 0.35);
}

function setSequenceFollow(enabled, { announceChange = true } = {}) {
  state.sequenceFollowLive = Boolean(enabled);
  activeSequenceValueStep = null;
  sequencePlayhead = -1;
  syncSequencePlayhead(transportTime(), { force: true });
  syncSequenceControls();
  if (announceChange) {
    announce(
      state.sequenceFollowLive
        ? "Follow next enabled. The inspector targets the first safely renderable voice cell or next drum onset."
        : "Step locked. The timing line shows when that cell naturally returns.",
    );
  }
}

function setTrackerView(view, { focus = false, quiet = false } = {}) {
  state.trackerView = view === "sequence" ? "sequence" : "morph";
  if (
    state.trackerView === "morph"
    && WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(state.activeSequenceLane)
  ) {
    state.activeSequenceLane = lastVoiceSequenceLane;
    sequencePlayhead = -1;
  }
  $("stageWrap").dataset.trackerView = state.trackerView;
  $("sequenceVoiceTabs").dataset.editorView = state.trackerView;
  $("sequenceWorkspace").hidden = state.trackerView !== "sequence";
  $("morphWorkspace").hidden = state.trackerView !== "morph";
  $("trackerViewMorph").checked = state.trackerView === "morph";
  $("trackerViewSequence").checked = state.trackerView === "sequence";
  $("editorState").textContent = state.trackerView === "sequence"
    ? activeSequenceDefinition().label + (state.sequenceFollowLive ? " · edit next" : " · locked")
    : "seed × pitch range";
  $("stage").tabIndex = 0;
  $("stage").removeAttribute("aria-hidden");
  $("stage").setAttribute(
    "aria-label",
    state.trackerView === "sequence"
      ? "Focused live Chiptune sequence editor with a nine-lane overview. "
        + activeSequenceDefinition().label
        + " step "
        + (state.activeSequenceStep + 1)
        + " selected."
      : "Pattern Morph Pad. Horizontal position changes the procedural seed and vertical position changes pitch range.",
  );
  $("stage").setAttribute(
    "aria-describedby",
    state.trackerView === "sequence"
      ? "webgpuChiptuneDescription sequenceInstructions liveStatus"
      : "webgpuChiptuneDescription trackerInstructions liveStatus",
  );
  syncSequenceControls();
  if (focus) $("stage").focus();
  if (!quiet) {
    announce(
      state.trackerView === "sequence"
        ? "Sequence editor. One large lane is editable; the mini tracker shows all nine. "
          + activeSequenceDefinition().label
          + " is selected."
        : "Source Pad. Drag seed and pitch range; only SOURCE cells regenerate.",
    );
  }
}

function selectSequenceLane(lane, { focus = false } = {}) {
  if (!WEBGPU_CHIPTUNE_SEQUENCE_LANES.includes(lane)) return;
  state.activeSequenceLane = lane;
  if (WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES.includes(lane)) {
    lastVoiceSequenceLane = lane;
  }
  sequencePlayhead = -1;
  syncSequenceControls();
  if (focus) $("stage").focus();
}

function selectSequenceStep(step, { focus = false } = {}) {
  state.sequenceFollowLive = false;
  state.activeSequenceStep = Math.round(clamp(
    step,
    0,
    WEBGPU_CHIPTUNE_SEQUENCE_STEPS - 1,
  ));
  state.sequencePage = sequencePageForStep(state.activeSequenceStep);
  syncSequenceControls();
  if (focus) $("stage").focus();
}

function setSequencePage(page, { focus = true } = {}) {
  const pageSize = activeSequencePageSize();
  const pageCount = WEBGPU_CHIPTUNE_SEQUENCE_STEPS / pageSize;
  state.sequenceFollowLive = false;
  state.sequencePage = Math.round(clamp(page, 0, pageCount - 1));
  const pageStart = state.sequencePage * pageSize;
  if (
    state.activeSequenceStep < pageStart
    || state.activeSequenceStep >= pageStart + pageSize
  ) {
    state.activeSequenceStep = pageStart;
  }
  syncSequenceControls();
  if (focus) $("stage").focus();
}

function setSequenceLaneLength(value) {
  const length = Math.round(clamp(value, 1, WEBGPU_CHIPTUNE_SEQUENCE_STEPS));
  applySequence(sequenceLaneWithChanges(state.activeSequenceLane, {
    activeLength: length,
  }));
  announce(
    activeSequenceDefinition().label
      + " loop length "
      + length
      + ". Stored cells outside the loop are preserved.",
  );
}

function requestSequenceAudition(lane, cellState, value) {
  if (
    cellState !== "note"
    || WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane)
    || !state.audioOn
    || !state.synthPlaying
  ) return false;
  return engine?.auditionSequenceCell(lane, value) === true;
}

function setSequenceCell(
  step,
  cellState,
  value,
  { announceChange = true, lane = state.activeSequenceLane } = {},
) {
  const definition = sequenceLaneDefinitions.find(({ key }) => key === lane);
  const spec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
  const laneState = state.sequence.lanes[lane];
  const cellIndex = Math.round(clamp(step, 0, WEBGPU_CHIPTUNE_SEQUENCE_STEPS - 1));
  const current = laneState.cells[cellIndex];
  const stateName = ["auto", "note", "rest"].includes(cellState) ? cellState : "auto";
  const fallback = current.state === "note"
    ? current.value
    : suggestedSequenceValue(lane, cellIndex);
  const nextValue = spec.kind === "drums"
    ? 1
    : webGpuChiptuneSequenceEditorValue(
      lane,
      webGpuChiptuneSequenceEditorUnit(lane, value ?? fallback),
    );
  const cells = [...laneState.cells];
  cells[cellIndex] = { state: stateName, value: nextValue };
  state.activeSequenceStep = cellIndex;
  state.sequencePage = sequencePageForStep(cellIndex);
  applySequence(sequenceLaneWithChanges(lane, { cells }));
  const previewed = requestSequenceAudition(lane, stateName, nextValue);
  if (announceChange) {
    const detail = stateName === "note"
      ? spec.kind === "drums"
        ? "hit"
        : spec.kind === "contour"
          ? "manual shape " + nextValue.toFixed(3)
          : "manual note " + signedNumber(nextValue)
      : stateName === "rest" && spec.kind === "drums" ? "off" : stateName;
    announce(
      definition.label
        + " step "
        + (cellIndex + 1)
        + " set to "
        + detail
        + (previewed ? ". Same-shader preview queued" : "")
        + ".",
    );
  }
}

function cycleSequenceCell(step) {
  const cell = state.sequence.lanes[state.activeSequenceLane].cells[step];
  const next = cell.state === "auto" ? "note" : cell.state === "note" ? "rest" : "auto";
  setSequenceCell(step, next);
}

function nudgeSequenceCell(step, direction, { octave = false } = {}) {
  const lane = state.activeSequenceLane;
  const spec = activeSequenceSpec();
  if (spec.kind === "drums") {
    setSequenceCell(step, direction > 0 ? "note" : "rest");
    return;
  }
  const cell = state.sequence.lanes[lane].cells[step];
  const base = cell.state === "note" ? cell.value : suggestedSequenceValue(lane, step);
  const increment = spec.kind === "contour" ? (octave ? 0.1 : 0.025) : (octave ? 12 : 1);
  setSequenceCell(step, "note", base + direction * increment);
}

function varySequenceLane() {
  const lane = state.activeSequenceLane;
  const spec = activeSequenceSpec();
  const laneState = state.sequence.lanes[lane];
  const cells = laneState.cells.map((cell, step) => {
    if (step >= laneState.activeLength) return cell;
    if (spec.kind === "drums") {
      const chance = Math.random();
      return chance < 0.2
        ? { state: "auto", value: 1 }
        : { state: chance < 0.58 ? "note" : "rest", value: 1 };
    }
    if (Math.random() < 0.14) return { state: "rest", value: cell.value };
    const generated = suggestedSequenceValue(lane, step);
    const value = spec.kind === "contour"
      ? Number(
        clamp(generated + (Math.random() - 0.5) * 0.36, 0, 1).toFixed(3)
      )
      : clamp(
        generated + randomIntegerInclusive(-5, 5),
        spec.minimum,
        spec.maximum,
      );
    return { state: "note", value };
  });
  applySequence(sequenceLaneWithChanges(lane, { cells }));
  announce(activeSequenceDefinition().label + " sequence varied.");
}

function clearSequenceLane() {
  const lane = state.activeSequenceLane;
  const laneState = state.sequence.lanes[lane];
  const cells = laneState.cells.map(() => ({ state: "auto", value: 0 }));
  applySequence(sequenceLaneWithChanges(lane, { cells }));
  announce(activeSequenceDefinition().label + " restored to all SOURCE.");
}

function transformSequenceLane(transform, label) {
  const lane = state.activeSequenceLane;
  const laneState = state.sequence.lanes[lane];
  const active = laneState.cells.slice(0, laneState.activeLength);
  const transformed = transform([...active]);
  const cells = [...laneState.cells];
  cells.splice(0, laneState.activeLength, ...transformed);
  applySequence(sequenceLaneWithChanges(lane, { cells }));
  announce(activeSequenceDefinition().label + " " + label + ".");
}

function rotateSequenceLane(direction) {
  transformSequenceLane((cells) => {
    if (cells.length <= 1) return cells;
    return direction < 0
      ? [...cells.slice(1), cells[0]]
      : [cells.at(-1), ...cells.slice(0, -1)];
  }, direction < 0 ? "rotated left" : "rotated right");
}

function reverseSequenceLane() {
  transformSequenceLane((cells) => cells.reverse(), "reversed");
}

function setVoiceSequencesToSource() {
  const lanes = { ...state.sequence.lanes };
  for (const lane of WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES) {
    lanes[lane] = {
      ...lanes[lane],
      cells: lanes[lane].cells.map((cell, step) => (
        step < lanes[lane].activeLength ? { state: "auto", value: cell.value } : cell
      )),
    };
  }
  applySequence({ schemaVersion: 2, lanes });
  announce("All five voice lanes now use the procedural SOURCE.");
}

function sourceCoverage(lanes) {
  let source = 0;
  let active = 0;
  for (const lane of lanes) {
    const laneState = state.sequence.lanes[lane];
    active += laneState.activeLength;
    for (let step = 0; step < laneState.activeLength; step += 1) {
      if (laneState.cells[step].state === "auto") source += 1;
    }
  }
  return Object.freeze({ source, active });
}

function setSequencePaintMode(mode, { quiet = false } = {}) {
  state.sequenceEditMode = ["auto", "note", "rest"].includes(mode) ? mode : "note";
  syncSequenceControls();
  if (!quiet) {
    const spec = activeSequenceSpec();
    const label = state.sequenceEditMode === "auto"
      ? "SOURCE"
      : state.sequenceEditMode === "rest"
        ? spec.kind === "drums" ? "OFF" : "REST"
        : spec.kind === "drums" ? "HIT" : spec.kind === "contour" ? "POINT" : "NOTE";
    announce(label + " paint mode selected for " + activeSequenceDefinition().label + ".");
  }
}

function laneClockText(lane) {
  const rate = fractionForValue(sequenceRateForUi(lane));
  const phase = fractionForValue(sequencePhaseForUi(lane));
  const ratePrefix = rate.exact ? "" : "~";
  const phasePrefix = phase.exact ? "" : "~";
  return "RATE " + ratePrefix + rate.numerator + "/" + rate.denominator
    + " × MASTER · PHASE " + phasePrefix + phase.numerator + "/" + phase.denominator;
}

function timingText(seconds) {
  if (!Number.isFinite(seconds)) return "outside loop";
  if (seconds < 0.095) return Math.max(0, Math.round(seconds * 1000)) + " ms";
  if (seconds < 10) return seconds.toFixed(1) + " s";
  if (seconds < 120) return Math.round(seconds) + " s";
  return (seconds / 60).toFixed(1) + " min";
}

function syncSequenceTimingOutput(time = transportTime()) {
  if (!$("sequenceTimingStatus")) return;
  const lane = state.activeSequenceLane;
  const timing = webGpuChiptuneLaneTiming(
    lane,
    time,
    state.params,
    state.sequence,
    state.activeSequenceStep,
  );
  const liveTarget = webGpuChiptuneLiveEditTarget(
    lane,
    time,
    state.params,
    state.sequence,
    liveEditLeadSeconds(),
  );
  const play = String(timing.currentStep + 1).padStart(2, "0");
  const selected = String(state.activeSequenceStep + 1).padStart(2, "0");
  let detail;
  if (state.activeSequenceStep >= timing.length) {
    detail = "STORED OUTSIDE LOOP · raise loop length to hear";
  } else if (!state.audioOn) {
    detail = "AUDIO OFF · edits remain saved";
  } else if (!state.synthPlaying) {
    detail = "PAUSED · edits remain saved";
  } else if (state.sequenceFollowLive) {
    detail = WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane)
      ? "NEXT HIT IN " + timingText(liveTarget.naturalSeconds)
      : "PREVIEW QUEUED ≈ "
        + timingText(liveTarget.leadSeconds)
        + " · "
        + Math.round(WEBGPU_CHIPTUNE_PREVIEW_DURATION_SECONDS * 1000)
        + " MS NOTE";
  } else {
    detail = timing.targetActiveNow
      ? "ACTIVE NOW"
      : "NATURALLY IN " + timingText(timing.secondsUntilTarget);
  }
  $("sequenceTimingStatus").textContent = "PLAY "
    + play
    + " · "
    + (state.sequenceFollowLive ? "EDIT NEXT " : "LOCKED ")
    + selected
    + " · "
    + detail;
}

function syncSequenceControls() {
  if (!$("sequenceWorkspace")) return;
  const lane = state.activeSequenceLane;
  const definition = activeSequenceDefinition();
  const laneState = state.sequence.lanes[lane];
  const selected = laneState.cells[state.activeSequenceStep];
  const pageSize = activeSequencePageSize();
  const pageCount = WEBGPU_CHIPTUNE_SEQUENCE_STEPS / pageSize;
  state.sequencePage = Math.round(clamp(
    sequencePageForStep(state.activeSequenceStep, pageSize),
    0,
    pageCount - 1,
  ));
  $("stageWrap").dataset.sequencePage = String(state.sequencePage);
  $("sequencePageControls").style.setProperty("--sequence-page-count", String(pageCount));
  $("sequenceWorkspace").hidden = state.trackerView !== "sequence";
  $("morphWorkspace").hidden = state.trackerView !== "morph";
  const pageButtons = [
    $("sequencePageOne"),
    $("sequencePageTwo"),
    $("sequencePageThree"),
    $("sequencePageFour"),
  ];
  pageButtons.forEach((button, page) => {
    const visible = page < pageCount;
    button.hidden = !visible;
    if (!visible) return;
    const start = page * pageSize + 1;
    button.textContent = String(start).padStart(2, "0")
      + "–"
      + String(start + pageSize - 1).padStart(2, "0");
    button.setAttribute("aria-pressed", String(state.sequencePage === page));
  });
  $("sequenceLength").value = String(laneState.activeLength);
  $("sequenceLength").setAttribute("aria-valuetext", laneState.activeLength + " steps");

  for (const button of $("sequenceVoiceTabs").querySelectorAll("button")) {
    const active = button.dataset.lane === lane;
    button.setAttribute("aria-pressed", String(active));
    button.tabIndex = active ? 0 : -1;
  }

  for (const stateName of ["auto", "note", "rest"]) {
    const button = $("sequenceState" + stateName[0].toUpperCase() + stateName.slice(1));
    button.setAttribute("aria-pressed", String(state.sequenceEditMode === stateName));
  }
  const spec = activeSequenceSpec();
  $("sequenceStateAuto").textContent = "SOURCE";
  $("sequenceStateNote").textContent = spec.kind === "drums"
    ? "HIT"
    : spec.kind === "contour" ? "POINT" : "NOTE";
  $("sequenceStateRest").textContent = spec.kind === "drums" ? "OFF" : "REST";
  const valueInput = $("sequenceValue");
  const valueRange = $("sequenceValueRange");
  const valueControl = valueInput.closest("label");
  valueControl.hidden = spec.kind === "drums";
  valueInput.disabled = spec.kind === "drums";
  valueRange.disabled = spec.kind === "drums";
  valueInput.min = String(spec.minimum);
  valueInput.max = String(spec.maximum);
  valueInput.inputMode = spec.kind === "contour" ? "decimal" : "numeric";
  valueInput.step = String(spec.quantum);
  valueRange.min = String(spec.minimum);
  valueRange.max = String(spec.maximum);
  valueRange.step = String(spec.quantum);
  const shownValue = selected.state === "note"
    ? selected.value
    : suggestedSequenceValue(lane, state.activeSequenceStep);
  if (document.activeElement !== valueInput && document.activeElement !== valueRange) {
    valueInput.value = String(shownValue);
    valueRange.value = String(shownValue);
  }
  $("sequenceValueLabel").textContent = spec.kind === "contour" ? "Shape 0–1" : "Semitone offset";
  $("sequenceValueOut").textContent = spec.kind === "contour"
    ? shownValue.toFixed(3)
    : signedNumber(shownValue)
      + " · "
      + shaderNoteName(resolvedSequenceNote(lane, state.activeSequenceStep));
  const pitchSpanControl = $("sequencePitchSpan").closest("label");
  pitchSpanControl.hidden = spec.kind !== "steps";
  $("sequencePitchSpan").value = String(state.sequencePitchSpan);
  if (spec.kind === "steps") {
    const [visibleMinimum, visibleMaximum] = sequenceVisiblePitchBounds(lane);
    $("sequencePitchSpanOut").textContent = signedNumber(visibleMinimum)
      + "…"
      + signedNumber(visibleMaximum)
      + " semitones";
  }
  const insideLoop = state.activeSequenceStep < laneState.activeLength;
  const effectiveNote = selected.state === "note" && spec.kind === "steps" && insideLoop
    ? shaderNoteName(resolvedSequenceNote(lane, state.activeSequenceStep))
    : "";
  const stateText = selected.state === "note"
    ? spec.kind === "drums"
      ? "HIT"
      : spec.kind === "contour"
        ? "POINT " + selected.value.toFixed(3)
        : "NOTE " + signedNumber(selected.value)
        + (effectiveNote ? " (" + effectiveNote + ")" : "")
    : selected.state === "rest" && spec.kind === "drums"
      ? "OFF"
      : selected.state === "auto" ? "SOURCE" : "REST";
  $("sequenceStatus").textContent = definition.label
    + " · STEP "
    + String(state.activeSequenceStep + 1).padStart(2, "0")
    + "/"
    + laneState.activeLength
    + " · "
    + stateText
    + " · "
    + laneClockText(lane)
    + (state.activeSequenceStep >= laneState.activeLength ? " · STORED OUTSIDE LOOP" : "");
  const activeCoverage = sourceCoverage([lane]);
  $("sequenceSourceCoverage").innerHTML = "<strong>"
    + activeCoverage.source
    + " of "
    + activeCoverage.active
    + "</strong> active "
    + definition.label
    + " cells use SOURCE.";
  const voiceCoverage = sourceCoverage(WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES);
  $("morphSourceCoverage").innerHTML = "<strong>"
    + voiceCoverage.source
    + " of "
    + voiceCoverage.active
    + "</strong> active voice cells follow the Source Pad. "
    + (voiceCoverage.source === 0 ? "Convert cells to SOURCE to hear it." : "Manual notes stay fixed.");
  const morphLaneButton = $("morphLaneSource");
  morphLaneButton.disabled = WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane);
  morphLaneButton.textContent = morphLaneButton.disabled
    ? "Select a voice lane first"
    : definition.label + " → SOURCE";
  $("sequenceFollow").setAttribute("aria-pressed", String(state.sequenceFollowLive));
  $("sequenceFollow").textContent = state.sequenceFollowLive ? "FOLLOW: ON" : "FOLLOW: OFF";
  $("editorState").textContent = state.trackerView === "sequence"
    ? definition.label + (state.sequenceFollowLive ? " · edit next" : " · locked")
    : "seed × pitch range";
  syncSequenceTimingOutput();
  if (state.trackerView === "sequence") {
    $("stage").setAttribute(
      "aria-label",
      "Focused live Chiptune sequence editor with nine-lane overview. "
        + describeSequenceCell(lane, state.activeSequenceStep, selected, laneState.activeLength)
        + ". "
        + laneClockText(lane),
    );
  }
}

function syncSequencePlayhead(time, { force = false } = {}) {
  if (state.trackerView !== "sequence") return;
  const timing = webGpuChiptuneLaneTiming(
    state.activeSequenceLane,
    time,
    state.params,
    state.sequence,
  );
  const liveTarget = state.audioOn && state.synthPlaying
    ? webGpuChiptuneLiveEditTarget(
      state.activeSequenceLane,
      time,
      state.params,
      state.sequence,
      liveEditLeadSeconds(),
    )
    : { step: timing.currentStep };
  const valueFocused = document.activeElement === $("sequenceValue")
    || document.activeElement === $("sequenceValueRange");
  let selectionChanged = false;
  if (
    state.sequenceFollowLive
    && !activeSequenceDrag
    && activeSequenceValueStep === null
    && !valueFocused
    && state.activeSequenceStep !== liveTarget.step
  ) {
    state.activeSequenceStep = liveTarget.step;
    state.sequencePage = sequencePageForStep(liveTarget.step);
    selectionChanged = true;
  }
  const now = performance.now();
  const shouldSync = force
    || selectionChanged
    || timing.currentStep !== sequencePlayhead
    || now - lastSequenceTimingUi > 160;
  sequencePlayhead = timing.currentStep;
  if (!shouldSync) return;
  lastSequenceTimingUi = now;
  if (selectionChanged || force) syncSequenceControls();
  else syncSequenceTimingOutput(time);
}

function renderSequenceControls() {
  const laneButtons = sequenceLaneDefinitions.map((definition) => {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "sequenceLane-" + definition.key;
    button.dataset.lane = definition.key;
    button.dataset.laneKind = definition.kind;
    button.setAttribute("aria-pressed", "false");
    button.textContent = definition.label;
    button.addEventListener("click", () => selectSequenceLane(definition.key));
    button.addEventListener("keydown", (event) => {
      const index = sequenceLaneDefinitions.findIndex(({ key }) => key === definition.key);
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % sequenceLaneDefinitions.length;
      else if (event.key === "ArrowLeft") {
        nextIndex = (index - 1 + sequenceLaneDefinitions.length) % sequenceLaneDefinitions.length;
      } else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = sequenceLaneDefinitions.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      const next = sequenceLaneDefinitions[nextIndex].key;
      selectSequenceLane(next);
      $("sequenceLane-" + next).focus();
    });
    return button;
  });
  $("sequenceVoiceTabs").replaceChildren(...laneButtons);

  $("trackerViewMorph").addEventListener("change", () => setTrackerView("morph"));
  $("trackerViewSequence").addEventListener("change", () => setTrackerView("sequence"));
  $("sequenceLength").addEventListener("change", (event) => {
    setSequenceLaneLength(event.currentTarget.value);
  });
  $("sequencePageOne").addEventListener("click", () => setSequencePage(0));
  $("sequencePageTwo").addEventListener("click", () => setSequencePage(1));
  $("sequencePageThree").addEventListener("click", () => setSequencePage(2));
  $("sequencePageFour").addEventListener("click", () => setSequencePage(3));
  const applySelectedSequenceState = (cellState) => {
    setSequencePaintMode(cellState);
    setSequenceCell(state.activeSequenceStep, cellState);
  };
  $("sequenceStateAuto").addEventListener("click", () => applySelectedSequenceState("auto"));
  $("sequenceStateNote").addEventListener("click", () => applySelectedSequenceState("note"));
  $("sequenceStateRest").addEventListener("click", () => applySelectedSequenceState("rest"));
  const valueInput = $("sequenceValue");
  const valueRange = $("sequenceValueRange");
  const beginValueEdit = () => {
    if (activeSequenceValueStep === null) {
      activeSequenceValueStep = state.activeSequenceStep;
    }
  };
  const liveValueEdit = (input) => {
    if (!input.value || !input.validity.valid) return;
    beginValueEdit();
    setSequenceCell(activeSequenceValueStep, "note", Number(input.value), {
      announceChange: false,
    });
  };
  const finishValueEdit = () => {
    activeSequenceValueStep = null;
    syncSequencePlayhead(transportTime(), { force: true });
  };
  valueRange.addEventListener("pointerdown", beginValueEdit);
  valueRange.addEventListener("focus", beginValueEdit);
  valueRange.addEventListener("input", (event) => {
    valueInput.value = event.currentTarget.value;
    liveValueEdit(event.currentTarget);
  });
  valueRange.addEventListener("change", () => {
    const step = activeSequenceValueStep ?? state.activeSequenceStep;
    const value = Number(valueRange.value);
    setSequenceCell(step, "note", value);
    finishValueEdit();
  });
  valueRange.addEventListener("pointercancel", finishValueEdit);
  valueRange.addEventListener("focusout", finishValueEdit);
  valueInput.addEventListener("focus", beginValueEdit);
  valueInput.addEventListener("input", (event) => {
    if (event.currentTarget.validity.valid) {
      valueRange.value = event.currentTarget.value;
      liveValueEdit(event.currentTarget);
    }
  });
  valueInput.addEventListener("change", (event) => {
    const input = event.currentTarget;
    if (!input.value || !input.validity.valid) {
      const cell = state.sequence
        .lanes[state.activeSequenceLane]
        .cells[activeSequenceValueStep ?? state.activeSequenceStep];
      const stepMismatch = input.validity.stepMismatch;
      const spec = activeSequenceSpec();
      input.value = String(cell.value);
      announce(
        activeSequenceDefinition().label
          + (stepMismatch
            ? " value must use increments of " + spec.quantum + "."
            : " value must be between " + spec.minimum + " and " + spec.maximum + "."),
      );
      return;
    }
    setSequenceCell(
      activeSequenceValueStep ?? state.activeSequenceStep,
      "note",
      Number(event.currentTarget.value),
    );
    finishValueEdit();
  });
  valueInput.addEventListener("focusout", finishValueEdit);
  $("sequencePitchSpan").addEventListener("input", (event) => {
    state.sequencePitchSpan = Math.round(clamp(event.currentTarget.value, 12, 72) / 12) * 12;
    syncSequenceControls();
  });
  $("sequenceFollow").addEventListener("click", () => {
    setSequenceFollow(!state.sequenceFollowLive);
  });
  $("rotateSequenceLeft").addEventListener("click", () => rotateSequenceLane(-1));
  $("rotateSequenceRight").addEventListener("click", () => rotateSequenceLane(1));
  $("reverseSequenceLane").addEventListener("click", reverseSequenceLane);
  $("varySequenceLane").addEventListener("click", varySequenceLane);
  $("clearSequenceLane").addEventListener("click", clearSequenceLane);
  $("morphLaneSource").addEventListener("click", clearSequenceLane);
  $("morphVoicesSource").addEventListener("click", setVoiceSequencesToSource);
  syncSequenceControls();
}

function createKnobControl(key) {
  const spec = controlSpecsByKey.get(key);
  const hue = knobHueByKey.get(key) ?? 0;
  const wrapper = document.createElement("div");
  wrapper.className = "webgpu-knob";
  wrapper.style.setProperty("--knob-hue", String(hue));
  wrapper.style.setProperty("--knob-hue-b", String((hue + 126) % 360));
  wrapper.style.setProperty("--knob-hue-c", String((hue + 252) % 360));

  const dial = document.createElement("div");
  dial.className = "webgpu-knob-dial";
  dial.tabIndex = 0;
  dial.controlSpec = spec;
  dial.dataset.paramKey = key;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", (knobLabels[key] ?? spec.label) + " — " + spec.label);
  dial.setAttribute("aria-valuemin", String(spec.min));
  dial.setAttribute("aria-valuemax", String(spec.max));

  const label = document.createElement("span");
  label.className = "webgpu-knob-label";
  label.textContent = knobLabels[key] ?? spec.label;

  const output = document.createElement("output");
  output.className = "webgpu-knob-value";
  output.htmlFor = key;

  dial.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    activeKnobDrag = {
      key,
      startY: event.clientY,
      startUnit: webGpuChiptuneParamToUnit(key, state.params[key]),
    };
    dial.setPointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointermove", (event) => {
    if (activeKnobDrag?.key !== key) return;
    event.preventDefault();
    const movement = (activeKnobDrag.startY - event.clientY) / 130;
    applyControlUnit(spec, activeKnobDrag.startUnit + movement);
  });
  dial.addEventListener("pointerup", (event) => {
    if (activeKnobDrag?.key !== key) return;
    activeKnobDrag = null;
    dial.releasePointerCapture?.(event.pointerId);
  });
  dial.addEventListener("pointercancel", () => {
    if (activeKnobDrag?.key === key) activeKnobDrag = null;
  });
  dial.addEventListener("wheel", (event) => {
    event.preventDefault();
    nudgeControl(spec, Math.sign(-event.deltaY), { fine: event.shiftKey });
  }, { passive: false });
  dial.addEventListener("keydown", (event) => {
    handleControlKey(event, spec);
  });

  knobControls.set(key, dial);
  knobOutputs.set(key, output);
  wrapper.append(dial, label, output);
  return wrapper;
}

function balancedKnobColumnCount(totalKnobs, maximumColumns) {
  const total = Math.max(1, Math.floor(Number(totalKnobs) || 1));
  const boundedMaximum = Math.floor(clamp(maximumColumns, 1, total));
  const rowCount = Math.ceil(total / boundedMaximum);
  return Math.ceil(total / rowCount);
}

function balanceKnobRows() {
  const bank = $("knobControls");
  const firstKnob = bank.querySelector(".webgpu-knob");
  const bankBounds = bank.getBoundingClientRect();
  const knobBounds = firstKnob?.getBoundingClientRect();
  if (!bank.children.length || !bankBounds.width || !knobBounds?.width) return;
  const styles = getComputedStyle(bank);
  const gap = Number.parseFloat(styles.columnGap) || 0;
  const maximumColumns = Math.floor((bankBounds.width + gap) / (knobBounds.width + gap));
  const columns = balancedKnobColumnCount(bank.children.length, maximumColumns);
  bank.style.setProperty("--knob-columns", String(columns));
  bank.dataset.knobColumns = String(columns);
}

function syncResponsiveLayout() {
  balanceKnobRows();
  syncSequenceControls();
}

function createAdvancedGroup(definition) {
  const details = document.createElement("details");
  details.className = "chiptune-subgroup";
  details.dataset.groupId = definition.id;
  details.open = definition.open === true;
  const summary = document.createElement("summary");
  const label = document.createElement("b");
  label.textContent = definition.label;
  const count = document.createElement("small");
  count.textContent = definition.keys.length + " controls";
  summary.append(label, count);
  const body = document.createElement("div");
  body.className = "chiptune-subgroup-body";
  for (const key of definition.keys) {
    const spec = controlSpecsByKey.get(key);
    if (!spec) throw new Error("Missing Chiptune control spec: " + key);
    body.append(createParamControl(spec));
  }
  details.append(summary, body);
  return details;
}

function renderControls() {
  controlInputs.clear();
  controlOutputs.clear();
  fractionControls.clear();
  $("knobControls").replaceChildren(...knobOrder.map(createKnobControl));
  const morphKeys = new Set(["patternSeed", "pitchRange"]);
  $("morphControls").replaceChildren(
    ...controlGroups.pattern.filter(({ key }) => morphKeys.has(key)).map(createParamControl),
  );
  $("patternControls").replaceChildren(
    ...controlGroups.pattern.filter(({ key }) => !morphKeys.has(key)).map(createParamControl),
  );
  $("voiceControls").replaceChildren(...controlGroups.voice.map(createParamControl));
  $("drumControls").replaceChildren(...controlGroups.drums.map(createParamControl));
  $("echoControls").replaceChildren(...controlGroups.echo.map(createParamControl));
  $("scaleControls").replaceChildren(createScaleEditor());
  $("gateControls").replaceChildren(createGateEditor());
  $("advancedControls").replaceChildren(
    ...advancedGroupDefinitions.map(createAdvancedGroup),
  );

  const buttons = presets.map((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.presetId = preset.id;
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", String(preset.id === state.presetId));
    button.addEventListener("click", () => applyPreset(preset));
    return button;
  });
  $("presetButtons").replaceChildren(...buttons);
  balanceKnobRows();
  requestAnimationFrame(balanceKnobRows);
  syncParamOutputs();
}

function randomBetween(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function randomIntegerInclusive(minimum, maximum) {
  return Math.ceil(minimum)
    + Math.floor(Math.random() * (Math.floor(maximum) - Math.ceil(minimum) + 1));
}

function safeRandomValue(key, bounds = SAFE_RANDOM_RANGES[key]) {
  if (key === "scaleMask") {
    const musicalMasks = [1717, 1453, 1387, 661, 1193, 2741, 4095];
    return musicalMasks[randomIntegerInclusive(0, musicalMasks.length - 1)];
  }
  const [minimum, maximum] = bounds ?? WEBGPU_CHIPTUNE_LIMITS[key];
  if (integerParams.has(key)) {
    return randomIntegerInclusive(minimum, maximum);
  }
  const spec = controlSpecsByKey.get(key);
  if (!spec) throw new Error("Missing Chiptune randomization spec: " + key);
  const minimumUnit = webGpuChiptuneParamToUnit(key, minimum);
  const maximumUnit = webGpuChiptuneParamToUnit(key, maximum);
  const value = quantizeControlValue(
    spec,
    webGpuChiptuneParamFromUnit(key, randomBetween(minimumUnit, maximumUnit)),
  );
  return nearestMusicalFraction(key, value, [minimum, maximum]);
}

function randomGateLane(patternSteps = 32) {
  const codes = [0, 0, 0, 0];
  let enabled = 0;
  for (let step = 0; step < Math.round(clamp(patternSteps, 1, 32)); step += 1) {
    let gateState = 0;
    if (Math.random() < 0.42) {
      const roll = Math.random();
      gateState = roll < 0.28 ? 1 : roll < 0.62 ? 2 : 3;
      enabled += 1;
    }
    const segment = Math.floor(step / 8);
    codes[segment] |= gateState << ((step % 8) * 2);
  }
  if (enabled === 0) codes[0] = 3;
  return codes;
}


function gateReleaseMaximum(params) {
  let shortestRatio = Number.POSITIVE_INFINITY;
  for (const lane of ["A", "B"]) {
    for (let step = 0; step < params.gatePatternSteps; step += 1) {
      const stateNumber = gateStateIndex(params, lane, step);
      if (stateNumber === 1) shortestRatio = Math.min(shortestRatio, params.gateShortRatio);
      else if (stateNumber === 2) shortestRatio = Math.min(shortestRatio, 1);
      else if (stateNumber === 3) {
        shortestRatio = Math.min(shortestRatio, params.gateLongRatio);
      }
    }
  }
  return Number.isFinite(shortestRatio)
    ? Math.max(0.05, shortestRatio * params.gateLength)
    : WEBGPU_CHIPTUNE_LIMITS.gateRelease[1];
}

function shuffledCopy(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomIntegerInclusive(0, index);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function boundedRandom(key, maximum) {
  const [safeMinimum, safeMaximum] = SAFE_RANDOM_RANGES[key];
  const boundedMaximum = Math.min(safeMaximum, maximum);
  return safeRandomValue(key, [Math.min(safeMinimum, boundedMaximum), boundedMaximum]);
}
function energyManagedParams(params) {
  const next = sanitizeWebGpuChiptuneParams(params);
  const voiceKeys = [
    "upperOneLevel",
    "upperTwoLevel",
    "bassPulseLevel",
    "bassSineLevel",
    "leadLevel",
    "arpLevel",
    "noiseLevel",
  ];
  const voiceEnergy = voiceKeys.reduce((sum, key) => sum + next[key], 0) / voiceKeys.length;
  const drumEnergy = next.drumMix
    * (next.kickLevel + next.snareLevel + next.hatLevel + next.shakerLevel) / 4;
  const echoEnergy = next.echoDecay * Math.max(1, next.echoTaps / 4);
  const ceiling = clamp(0.9 - voiceEnergy * 0.12 - drumEnergy * 0.09 - echoEnergy * 0.08, 0.42, 0.76);
  next.gain = Math.min(next.gain, ceiling);
  return next;
}

function randomizePatch() {
  const next = {};
  const deferred = new Set([
    "pwmDepth",
    "kickSubcycle",
    "hatASubcycle",
    "hatARepeat",
    "gateRelease",
  ]);
  for (const key of randomizableParamOrder) {
    if (!deferred.has(key)) next[key] = safeRandomValue(key);
  }
  const pwmMaximum = Math.max(
    0,
    Math.min(next.pulseWidth - 0.02, 0.98 - next.pulseWidth),
  );
  next.pwmDepth = boundedRandom("pwmDepth", pwmMaximum);
  next.kickSubcycle = boundedRandom("kickSubcycle", next.kickCycle);
  next.hatASubcycle = boundedRandom("hatASubcycle", next.hatACycle);
  next.hatARepeat = boundedRandom("hatARepeat", next.hatASubcycle);
  const laneA = randomGateLane(next.gatePatternSteps);
  const laneB = randomGateLane(next.gatePatternSteps);
  laneA.forEach((code, index) => {
    next["gateA" + index] = code;
  });
  laneB.forEach((code, index) => {
    next["gateB" + index] = code;
  });
  next.gateRelease = boundedRandom("gateRelease", gateReleaseMaximum(next));
  applyParams(energyManagedParams(next));
  announce("Safe shader parameters randomized.");
}

function mutatePatch() {
  const next = { ...state.params };
  const shuffled = shuffledCopy(randomizableParamOrder);
  for (const key of shuffled.slice(0, 9)) {
    if (key === "scaleMask") {
      next[key] = safeRandomValue(key);
      continue;
    }
    if (WEBGPU_CHIPTUNE_INTEGER_PARAMS.includes(key)) {
      const [minimum, maximum] = SAFE_RANDOM_RANGES[key];
      const lower = Math.ceil(minimum);
      const upper = Math.floor(maximum);
      const current = clamp(Math.round(next[key]), lower, upper);
      if (upper === lower) continue;
      if (upper - lower === 1) {
        next[key] = current === lower ? upper : lower;
      } else {
        const direction = Math.random() < 0.5 ? -1 : 1;
        const candidate = current + direction;
        next[key] = candidate < lower || candidate > upper ? current - direction : candidate;
      }
      continue;
    }
    const [minimum, maximum] = SAFE_RANDOM_RANGES[key];
    const minimumUnit = webGpuChiptuneParamToUnit(key, minimum);
    const maximumUnit = webGpuChiptuneParamToUnit(key, maximum);
    const currentUnit = webGpuChiptuneParamToUnit(key, next[key]);
    const targetUnit = clamp(
      currentUnit + randomBetween(-0.09, 0.09),
      minimumUnit,
      maximumUnit,
    );
    const value = quantizeControlValue(
      controlSpecsByKey.get(key),
      webGpuChiptuneParamFromUnit(key, targetUnit),
    );
    next[key] = nearestMusicalFraction(
      key,
      value,
      SAFE_RANDOM_RANGES[key],
    );
  }
  const lane = Math.random() < 0.5 ? "A" : "B";
  const step = randomIntegerInclusive(0, Math.max(0, next.gatePatternSteps - 1));
  const gateMutation = setGateState(
    next,
    lane,
    step,
    (gateStateIndex(next, lane, step) + randomIntegerInclusive(1, 3)) % 4,
  );
  applyParams(gateMutation);
  announce("Shader patch mutated.");
}

function outputChanged() {
  const value = clamp($("output").value, 0, 1);
  $("outputOut").textContent = Math.round(value * 100) + "%";
  engine?.setOutput(value);
}

async function startAudio() {
  if (state.audioOn && engine?.context) return true;
  if (audioStartPromise) return audioStartPromise;

  clearError();
  $("audioButton").disabled = true;
  const generation = audioLifecycleGeneration;
  const nextEngine = new WebGpuChiptuneAudio(globalThis, {
    chunkDuration: state.chunkDuration,
    workgroupSize: state.workgroupSize,
  });
  nextEngine.setOutput(Number($("output").value));
  nextEngine.setPlaybackEnabled(false);
  nextEngine.setErrorHandler((error) => {
    showError(error);
    if (engine === nextEngine) void stopAudio({ quiet: true });
  });
  engine = nextEngine;

  let pending;
  pending = nextEngine.start(state.params, {
    offset: 0,
    autoStart: false,
    sequence: state.sequence,
  }).then(async (context) => {
    if (
      generation !== audioLifecycleGeneration
      || engine !== nextEngine
      || context !== nextEngine.context
    ) {
      await nextEngine.stop();
      return false;
    }
    nextEngine.setOutput(Number($("output").value));
    nextEngine.setPlaybackEnabled(false);
    if (state.synthPlaying) {
      const offset = transportTime();
      const playGeneration = transportGeneration;
      await restartSynchronizedAudio(nextEngine, offset, playGeneration);
    }
    setAudioState(true);
    announce(state.synthPlaying
      ? "WebGPU Chiptune audio on and tracker playing."
      : "WebGPU Chiptune audio ready.");
    return true;
  }).catch(async (error) => {
    if (engine === nextEngine) engine = null;
    await nextEngine.stop().catch(() => {});
    setAudioState(false);
    showError(error);
    return false;
  }).finally(() => {
    if (audioStartPromise === pending) audioStartPromise = null;
    $("audioButton").disabled = !support.supported;
  });

  audioStartPromise = pending;
  return pending;
}

async function stopAudio({ quiet = false } = {}) {
  audioLifecycleGeneration += 1;
  const previous = engine;
  engine = null;
  audioStartPromise = null;
  if (previous) await previous.stop();
  setAudioState(false);
  if (!quiet) announce("WebGPU Chiptune audio off.");
}

async function toggleAudio() {
  if (state.audioOn) await stopAudio();
  else await startAudio();
}

function pauseTransport({ quiet = false } = {}) {
  if (!state.synthPlaying) return;
  state.transportOffset = transportTime();
  transportGeneration += 1;
  state.synthPlaying = false;
  engine?.setPlaybackEnabled(false);
  engine?.pause();
  setSynthPlayButtonState();
  if (!quiet) announce("WebGPU Chiptune paused.");
}

async function playTransport({ quiet = false } = {}) {
  if (state.synthPlaying) return;
  transportGeneration += 1;
  const generation = transportGeneration;
  const offset = state.transportOffset;
  state.synthPlaying = true;

  if (!state.audioOn || !engine) {
    state.transportStartedAt = performance.now() / 1000;
    setSynthPlayButtonState();
    if (!quiet) announce("Audio is off — turn it on to hear playback.");
    return;
  }

  const activeEngine = engine;
  state.transportStartedAt = Number.POSITIVE_INFINITY;
  setSynthPlayButtonState();
  try {
    const started = await restartSynchronizedAudio(activeEngine, offset, generation);
    if (started) {
      if (!quiet) announce("WebGPU Chiptune playing.");
    }
  } catch (error) {
    showError(error);
    await stopAudio({ quiet: true });
  }
}

async function toggleSynthPlay() {
  if (state.synthPlaying) pauseTransport();
  else await playTransport();
}

async function restartAudio() {
  setRuntimeState();
  if (!state.audioOn) return;
  await stopAudio({ quiet: true });
  await startAudio();
}

function runtimeChanged() {
  state.chunkDuration = clamp($("chunkDuration").value, 0.03, 0.25);
  const candidate = Number($("workgroupSize").value);
  state.workgroupSize = WEBGPU_CHIPTUNE_WORKGROUP_SIZES.includes(candidate)
    ? candidate
    : WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.workgroupSize;
  setRuntimeState();
}

function resetPatch() {
  applyParams(WEBGPU_CHIPTUNE_DEFAULTS, "source-tracker", { notify: false });
  applySequence(WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE, {
    notify: false,
    markCustom: false,
    presetId: "source-tracker",
  });
  notifyWaxState();
  state.transportOffset = 0;
  if (state.synthPlaying) {
    transportGeneration += 1;
    const generation = transportGeneration;
    if (state.audioOn && engine) {
      const activeEngine = engine;
      state.transportStartedAt = Number.POSITIVE_INFINITY;
      void restartSynchronizedAudio(activeEngine, 0, generation).catch(async (error) => {
        showError(error);
        await stopAudio({ quiet: true });
      });
    } else {
      state.transportStartedAt = performance.now() / 1000;
    }
  } else {
    engine?.pause();
  }
  announce("Source tracker patch and all-AUTO sequence restored.");
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const backingWidth = Math.max(1, Math.round(width * pixelRatio));
  const backingHeight = Math.max(1, Math.round(height * pixelRatio));
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  return { width, height, pixelRatio };
}

const laneDefinitions = Object.freeze(
  sequenceLaneDefinitions
    .filter(({ kind }) => kind !== "drums")
    .map(({ key, label, color }) => [key, label, color]),
);

function trackerNotesForLane(key, subdivisions, windowStartStep) {
  if (
    trackerCacheParams !== state.params
    || trackerCacheSequence !== state.sequence
    || trackerCacheWindowStart !== windowStartStep
  ) {
    trackerCacheParams = state.params;
    trackerCacheSequence = state.sequence;
    trackerCacheWindowStart = windowStartStep;
    trackerNoteCache.clear();
  }
  const cacheKey = key + ":" + subdivisions + ":" + windowStartStep;
  let notes = trackerNoteCache.get(cacheKey);
  if (!notes) {
    const pointCount = 32 * subdivisions;
    notes = new Float32Array(pointCount);
    for (let point = 0; point < pointCount; point += 1) {
      const step = windowStartStep + Math.floor(point / subdivisions);
      const substep = (point % subdivisions + 0.5) / subdivisions;
      notes[point] = webGpuChiptuneStepSnapshot(
        step,
        state.params,
        substep,
        state.sequence,
      )[key];
    }
    trackerNoteCache.set(cacheKey, notes);
  }
  return notes;
}

function drawBackground(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#071218");
  gradient.addColorStop(0.48, "#08090f");
  gradient.addColorStop(1, "#170918");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(102, 216, 255, 0.065)";
  context.lineWidth = 1;
  const grid = Math.max(28, Math.round(width / 36));
  context.beginPath();
  for (let x = 0; x <= width; x += grid) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += grid) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}

function drawMorphTracker(context, width, height, time) {
  const top = height * 0.24;
  const bottom = height * 0.88;
  const laneHeight = (bottom - top) / laneDefinitions.length;
  const cellWidth = width / 32;
  const absoluteStep = Math.floor(time * state.params.tempo * 4);
  const windowStartStep = Math.floor(absoluteStep / 32) * 32;
  const activeStep = ((absoluteStep % 32) + 32) % 32;

  context.fillStyle = "rgba(157, 255, 87, 0.075)";
  context.fillRect(activeStep * cellWidth, top, cellWidth, bottom - top);

  context.textBaseline = "middle";
  context.font = Math.max(8, width / 150) + "px ui-monospace, SFMono-Regular, Consolas, monospace";

  for (let laneIndex = 0; laneIndex < laneDefinitions.length; laneIndex += 1) {
    const [key, label, color] = laneDefinitions[laneIndex];
    const laneTop = top + laneIndex * laneHeight;
    context.fillStyle = laneIndex % 2 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.12)";
    context.fillRect(0, laneTop, width, laneHeight);

    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.beginPath();
    context.moveTo(0, laneTop);
    context.lineTo(width, laneTop);
    context.stroke();

    context.fillStyle = color;
    context.globalAlpha = 0.68;
    context.fillText(label, 8, laneTop + laneHeight * 0.5);
    context.globalAlpha = 1;

    const subdivisions = key === "lead" || key === "arp" ? 8 : 1;
    const pointCount = 32 * subdivisions;
    const notes = trackerNotesForLane(key, subdivisions, windowStartStep);
    let previousY = laneTop + laneHeight * 0.5;
    let drawing = false;
    context.beginPath();
    for (let point = 0; point < pointCount; point += 1) {
      const note = notes[point];
      if (!Number.isFinite(note)) {
        drawing = false;
        continue;
      }
      const normalized = clamp((note + 48) / 84, 0, 1);
      const x = (point + 0.5) * width / pointCount;
      const y = laneTop + laneHeight * (0.82 - normalized * 0.64);
      if (!drawing) context.moveTo(x, y);
      else {
        context.lineTo(x, previousY);
        context.lineTo(x, y);
      }
      previousY = y;
      drawing = true;
    }
    context.strokeStyle = color;
    context.globalAlpha = 0.66;
    context.lineWidth = Math.max(1, width / 900);
    context.stroke();
    context.globalAlpha = 1;

    for (let point = 0; point < pointCount; point += 1) {
      const step = Math.floor(point / subdivisions);
      const note = notes[point];
      if (!Number.isFinite(note)) continue;
      const normalized = clamp((note + 48) / 84, 0, 1);
      const x = (point + 0.5) * width / pointCount;
      const y = laneTop + laneHeight * (0.82 - normalized * 0.64);
      const isActive = step === activeStep;
      const radius = isActive
        ? Math.max(2.2, cellWidth * 0.14)
        : Math.max(1, cellWidth * 0.065);
      context.fillStyle = color;
      context.globalAlpha = isActive ? 1 : 0.54;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  context.strokeStyle = "rgba(244, 201, 93, 0.2)";
  context.lineWidth = 1;
  for (let step = 0; step <= 32; step += 4) {
    const x = step * cellWidth;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
  }

  const drumTempo = state.params.tempo * Math.max(state.params.drumRate, 0.01);
  const drumClock = time * drumTempo;
  const drumDecay = Math.max(state.params.drumDecay, 0.1);
  const kickCycle = Math.max(state.params.kickCycle, 0.05);
  const kickClock = positiveModulo(
    drumClock - state.params.kickPhase * kickCycle,
    kickCycle,
  );
  const kickTime = positiveModulo(
    kickClock,
    Math.max(state.params.kickSubcycle, 0.05),
  ) / drumTempo;
  const kickDecay = state.params.kickDecayRate / drumDecay;
  const pulse = Math.exp(-kickTime * kickDecay)
    * Math.exp(-Math.max(state.params.kickAttackTime - kickTime, 0) * kickDecay);
  const snareCycle = Math.max(state.params.snareCycle, 0.01);
  const snareTime = positiveModulo(
    drumClock - state.params.snarePhase * snareCycle,
    snareCycle,
  ) / drumTempo;
  const snare = Math.exp(
    -Math.max(snareTime - state.params.snareHoldTime, 0)
      * state.params.snareDecayRate / drumDecay,
  );
  const drumY = height * 0.935;
  context.fillStyle = "rgba(244, 201, 93, " + (0.08 + pulse * 0.55) + ")";
  context.fillRect(0, drumY, width * clamp(state.params.kickLevel / 2, 0, 1) * pulse, height * 0.016);
  context.fillStyle = "rgba(255, 101, 189, " + (0.08 + snare * 0.48) + ")";
  context.fillRect(
    width,
    drumY + height * 0.023,
    -width * clamp(state.params.snareLevel / 2, 0, 1) * snare,
    height * 0.012,
  );

  context.fillStyle = "#d8e7e7";
  context.globalAlpha = 0.72;
  context.font = Math.max(8, width / 120) + "px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.fillText(
    "STEP " + String(activeStep + 1).padStart(2, "0")
      + "  ·  " + Math.round(state.params.tempo * 60) + " BPM"
      + "  ·  " + Math.round(state.params.echoTaps) + " ECHO TAPS",
    8,
    height * 0.97,
  );
  const [seedMinimum, seedMaximum] = WEBGPU_CHIPTUNE_LIMITS.patternSeed;
  const [rangeMinimum, rangeMaximum] = WEBGPU_CHIPTUNE_LIMITS.pitchRange;
  const handleX = clamp(
    (state.params.patternSeed - seedMinimum) / Math.max(0.000001, seedMaximum - seedMinimum),
    0,
    1,
  ) * width;
  const handleY = (
    1 - clamp(
      (state.params.pitchRange - rangeMinimum)
        / Math.max(0.000001, rangeMaximum - rangeMinimum),
      0,
      1,
    )
  ) * height;
  const coverage = sourceCoverage(WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES);
  context.strokeStyle = "rgba(83,246,255,0.2)";
  context.lineWidth = 1;
  context.setLineDash([5, 5]);
  context.beginPath();
  context.moveTo(handleX, 0);
  context.lineTo(handleX, height);
  context.moveTo(0, handleY);
  context.lineTo(width, handleY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#061016";
  context.strokeStyle = "#f4c95d";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(handleX, handleY, Math.max(9, Math.min(15, width / 75)), 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#f4c95d";
  context.font = "800 " + Math.max(8, width / 130)
    + "px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillText("X · PATTERN SEED →", 9, 8);
  context.save();
  context.translate(width - 9, height - 8);
  context.rotate(-Math.PI / 2);
  context.fillText("Y · PITCH RANGE →", 0, 0);
  context.restore();
  context.fillStyle = "rgba(216,231,231,0.74)";
  context.textBaseline = "bottom";
  context.fillText(
    coverage.source + "/" + coverage.active + " ACTIVE VOICE CELLS USE SOURCE",
    9,
    height - 8,
  );
  context.globalAlpha = 1;
}

function sequenceWindowForWidth(width) {
  const stepCount = sequencePageSizeForWidth(width);
  const maximumPage = WEBGPU_CHIPTUNE_SEQUENCE_STEPS / stepCount - 1;
  const page = Math.round(clamp(state.sequencePage, 0, maximumPage));
  return Object.freeze({
    startStep: page * stepCount,
    stepCount,
  });
}

function sequenceEditorMetrics(width, height) {
  const narrow = width <= 620;
  const { startStep, stepCount } = sequenceWindowForWidth(width);
  const left = narrow ? 45 : 66;
  const right = narrow ? 5 : 10;
  const top = narrow ? 38 : 42;
  const overviewHeight = clamp(height * 0.23, 66, 88);
  const overviewBottom = height - 17;
  const overviewTop = overviewBottom - overviewHeight;
  const bottom = Math.max(top + 120, overviewTop - 15);
  const definition = activeSequenceDefinition();
  const row = Object.freeze({ definition, top, height: Math.max(1, bottom - top) });
  const overviewLabelWidth = narrow ? 31 : 48;
  const overviewGridWidth = Math.max(1, width - overviewLabelWidth - right);
  const overviewHeader = 13;
  const overviewRowHeight = Math.max(
    4,
    (overviewHeight - overviewHeader) / sequenceLaneDefinitions.length,
  );
  const overviewRows = sequenceLaneDefinitions.map((laneDefinition, index) => Object.freeze({
    definition: laneDefinition,
    top: overviewTop + overviewHeader + index * overviewRowHeight,
    height: overviewRowHeight,
  }));
  return Object.freeze({
    left,
    right,
    top,
    bottom,
    width: Math.max(1, width - left - right),
    cellWidth: Math.max(1, (width - left - right) / stepCount),
    startStep,
    stepCount,
    row,
    rows: Object.freeze([row]),
    overview: Object.freeze({
      top: overviewTop,
      bottom: overviewBottom,
      left: overviewLabelWidth,
      right,
      width: overviewGridWidth,
      cellWidth: overviewGridWidth / WEBGPU_CHIPTUNE_SEQUENCE_STEPS,
      rowHeight: overviewRowHeight,
      rows: Object.freeze(overviewRows),
    }),
  });
}

function selectedSequenceValue(lane, step) {
  const cell = state.sequence.lanes[lane].cells[step];
  return cell.state === "note" ? cell.value : suggestedSequenceValue(lane, step);
}

function sourceDrumPreview(lane, step) {
  if (trackerCacheParams !== state.params || trackerCacheSequence !== state.sequence) {
    trackerCacheParams = state.params;
    trackerCacheSequence = state.sequence;
    trackerNoteCache.clear();
  }
  const cacheKey = "source-drum:" + lane + ":" + step;
  if (trackerNoteCache.has(cacheKey)) return trackerNoteCache.get(cacheKey);
  const rate = Math.max(0.000001, sequenceRateForUi(lane));
  const previewBeat = (step + 0.08) / rate;
  const snapshot = webGpuChiptuneStageSnapshot(
    previewBeat / Math.max(0.000001, state.params.tempo),
    state.params,
    state.sequence,
  );
  const value = lane === "hats"
    ? Math.max(snapshot.drums.hatA, snapshot.drums.hatB)
    : snapshot.drums[lane];
  const bounded = clamp(value, 0, 1);
  trackerNoteCache.set(cacheKey, bounded);
  return bounded;
}

function sequenceVisiblePitchBounds(lane) {
  const spec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
  return Object.freeze([
    Math.max(spec.minimum, -state.sequencePitchSpan),
    Math.min(spec.maximum, state.sequencePitchSpan),
  ]);
}

function sequenceLaneY(lane, value, row) {
  const spec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
  const unit = spec.kind === "steps"
    ? (() => {
      const [minimum, maximum] = sequenceVisiblePitchBounds(lane);
      return clamp((Number(value) - minimum) / Math.max(1, maximum - minimum), 0, 1);
    })()
    : webGpuChiptuneSequenceEditorUnit(lane, value);
  const padding = Math.min(18, row.height * 0.1);
  return row.top + padding + (1 - unit) * Math.max(1, row.height - padding * 2);
}

function sequenceValueForY(lane, localY, row) {
  const padding = Math.min(18, row.height * 0.1);
  const unit = clamp(
    1 - (localY - row.top - padding) / Math.max(1, row.height - padding * 2),
    0,
    1,
  );
  const spec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
  if (spec.kind === "drums") return 1;
  if (spec.kind === "steps") {
    const [minimum, maximum] = sequenceVisiblePitchBounds(lane);
    const visibleValue = minimum + unit * (maximum - minimum);
    return webGpuChiptuneSequenceEditorValue(
      lane,
      webGpuChiptuneSequenceEditorUnit(lane, visibleValue),
    );
  }
  return webGpuChiptuneSequenceEditorValue(lane, unit);
}

function drawRestCell(context, x, y, width, height) {
  const inset = Math.max(2, Math.min(5, width * 0.18));
  context.strokeStyle = "rgba(216,231,231,0.3)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + inset, y + inset);
  context.lineTo(x + width - inset, y + height - inset);
  context.moveTo(x + width - inset, y + inset);
  context.lineTo(x + inset, y + height - inset);
  context.stroke();
}

function drawResolvedLeadTrace(context, metrics, row) {
  const subdivisions = 4;
  context.save();
  context.beginPath();
  let drawing = false;
  for (let stepOffset = 0; stepOffset < metrics.stepCount; stepOffset += 1) {
    const step = metrics.startStep + stepOffset;
    for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
      const beat = sequenceBeatForStep("lead", step + (subdivision + 0.5) / subdivisions);
      const resolved = webGpuChiptuneBeatSnapshot(beat, state.params, state.sequence).lead;
      const offset = resolved
        - state.params.leadRegister
        - state.params.transpose
        - state.params.tuningCents / 100;
      if (!Number.isFinite(offset)) {
        drawing = false;
        continue;
      }
      const x = metrics.left
        + (stepOffset + (subdivision + 0.5) / subdivisions) * metrics.cellWidth;
      const y = sequenceLaneY("lead", offset, row);
      if (!drawing) context.moveTo(x, y);
      else context.lineTo(x, y);
      drawing = true;
    }
  }
  context.setLineDash([2, 3]);
  context.strokeStyle = "rgba(255,255,255,0.42)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function drawLegacySequenceEditor(context, width, height, time) {
  const metrics = sequenceEditorMetrics(width, height, sequenceEditorOverlayBounds(height));
  const fontSize = Math.max(7, Math.min(10, width / 118));
  context.save();
  context.textBaseline = "middle";
  context.font = "700 " + fontSize + "px ui-monospace, SFMono-Regular, Consolas, monospace";

  for (const row of metrics.rows) {
    const { definition } = row;
    const lane = definition.key;
    const laneState = state.sequence.lanes[lane];
    const selectedLane = lane === state.activeSequenceLane;
    context.fillStyle = selectedLane
      ? "rgba(244,201,93,0.075)"
      : sequenceLaneDefinitions.indexOf(definition) % 2
        ? "rgba(255,255,255,0.018)"
        : "rgba(0,0,0,0.14)";
    context.fillRect(0, row.top, width, row.height);
    context.strokeStyle = selectedLane ? "rgba(244,201,93,0.44)" : "rgba(255,255,255,0.09)";
    context.lineWidth = selectedLane ? 1.5 : 1;
    context.beginPath();
    context.moveTo(0, row.top);
    context.lineTo(width, row.top);
    context.stroke();
    context.fillStyle = definition.color;
    context.globalAlpha = selectedLane ? 1 : 0.68;
    context.fillText(definition.shortLabel, 5, row.top + row.height * 0.5);
    context.globalAlpha = 1;

    const playhead = webGpuChiptuneSequenceCellIndex(
      lane,
      time * state.params.tempo,
      state.params,
      state.sequence,
    );
    if (playhead >= metrics.startStep && playhead < metrics.startStep + metrics.stepCount) {
      const playheadX = metrics.left + (playhead - metrics.startStep) * metrics.cellWidth;
      context.fillStyle = "rgba(255,255,255,0.075)";
      context.fillRect(playheadX, row.top, metrics.cellWidth, row.height);
      context.fillStyle = definition.color;
      context.fillRect(playheadX, row.top, Math.max(1, metrics.cellWidth * 0.08), row.height);
    }

    if (definition.kind === "contour") {
      context.beginPath();
      let drawing = false;
      for (let offset = 0; offset < metrics.stepCount; offset += 1) {
        const step = metrics.startStep + offset;
        const cell = laneState.cells[step];
        if (cell.state === "rest") {
          drawing = false;
          continue;
        }
        const value = selectedSequenceValue(lane, step);
        const x = metrics.left + (offset + 0.5) * metrics.cellWidth;
        const y = sequenceLaneY(lane, value, row);
        if (!drawing) context.moveTo(x, y);
        else context.lineTo(x, y);
        drawing = true;
      }
      context.strokeStyle = definition.color;
      context.globalAlpha = 0.62;
      context.lineWidth = Math.max(1.25, metrics.cellWidth * 0.08);
      context.stroke();
      context.globalAlpha = 1;
    }

    for (let offset = 0; offset < metrics.stepCount; offset += 1) {
      const step = metrics.startStep + offset;
      const x = metrics.left + offset * metrics.cellWidth;
      const cell = laneState.cells[step];
      const outsideLoop = step >= laneState.activeLength;
      context.strokeStyle = step % 4 === 0
        ? "rgba(244,201,93,0.24)"
        : "rgba(255,255,255,0.065)";
      context.lineWidth = step % 4 === 0 ? 1.2 : 1;
      context.beginPath();
      context.moveTo(x, row.top);
      context.lineTo(x, row.top + row.height);
      context.stroke();
      if (outsideLoop) {
        context.fillStyle = "rgba(2,4,7,0.5)";
        context.fillRect(x, row.top, metrics.cellWidth, row.height);
      }
      if (cell.state === "rest") {
        drawRestCell(context, x, row.top, metrics.cellWidth, row.height);
        continue;
      }
      if (definition.kind === "drums") {
        if (cell.state === "note") {
          const inset = Math.max(1, metrics.cellWidth * 0.14);
          context.fillStyle = definition.color;
          context.globalAlpha = outsideLoop ? 0.28 : 0.82;
          context.fillRect(
            x + inset,
            row.top + row.height * 0.2,
            Math.max(1, metrics.cellWidth - inset * 2),
            row.height * 0.6,
          );
          context.globalAlpha = 1;
        } else {
          const source = sourceDrumPreview(lane, step);
          if (source > 0.04) {
            const inset = Math.max(1, metrics.cellWidth * 0.2);
            const sourceHeight = Math.max(2, row.height * (0.18 + source * 0.48));
            context.fillStyle = definition.color;
            context.globalAlpha = outsideLoop ? 0.1 : 0.18 + source * 0.28;
            context.fillRect(
              x + inset,
              row.top + (row.height - sourceHeight) * 0.5,
              Math.max(1, metrics.cellWidth - inset * 2),
              sourceHeight,
            );
            context.globalAlpha = 1;
          }
          context.strokeStyle = definition.color;
          context.globalAlpha = 0.34;
          context.setLineDash([2, 2]);
          context.strokeRect(
            x + 2,
            row.top + Math.max(2, row.height * 0.28),
            Math.max(1, metrics.cellWidth - 4),
            Math.max(1, row.height * 0.44),
          );
          context.setLineDash([]);
          context.globalAlpha = 1;
        }
        continue;
      }
      const value = selectedSequenceValue(lane, step);
      const y = sequenceLaneY(lane, value, row);
      if (definition.kind === "steps") {
        const inset = Math.max(1, metrics.cellWidth * 0.13);
        const blockHeight = Math.max(3, row.height * 0.16);
        context.fillStyle = definition.color;
        context.globalAlpha = cell.state === "note" ? (outsideLoop ? 0.3 : 0.9) : 0.24;
        context.fillRect(
          x + inset,
          y - blockHeight * 0.5,
          Math.max(1, metrics.cellWidth - inset * 2),
          blockHeight,
        );
        context.globalAlpha = 1;
      } else {
        context.fillStyle = cell.state === "note" ? definition.color : "rgba(216,231,231,0.46)";
        context.globalAlpha = outsideLoop ? 0.3 : 1;
        context.beginPath();
        context.arc(
          x + metrics.cellWidth * 0.5,
          y,
          Math.max(1.8, Math.min(4, metrics.cellWidth * 0.16)),
          0,
          Math.PI * 2,
        );
        context.fill();
        context.globalAlpha = 1;
      }
      if (cell.state === "auto") {
        context.strokeStyle = definition.color;
        context.globalAlpha = 0.33;
        context.setLineDash([2, 2]);
        context.strokeRect(x + 1, row.top + 1, Math.max(1, metrics.cellWidth - 2), row.height - 2);
        context.setLineDash([]);
        context.globalAlpha = 1;
      }
    }

    if (lane === "lead") drawResolvedLeadTrace(context, metrics, row);
    if (
      selectedLane
      && state.activeSequenceStep >= metrics.startStep
      && state.activeSequenceStep < metrics.startStep + metrics.stepCount
    ) {
      const selectedX = metrics.left
        + (state.activeSequenceStep - metrics.startStep) * metrics.cellWidth;
      context.strokeStyle = "#f4c95d";
      context.lineWidth = 2;
      context.strokeRect(
        selectedX + 1,
        row.top + 1,
        Math.max(1, metrics.cellWidth - 2),
        Math.max(1, row.height - 2),
      );
    }
  }

  context.strokeStyle = "rgba(255,255,255,0.14)";
  context.beginPath();
  context.moveTo(metrics.left + metrics.width, metrics.top);
  context.lineTo(metrics.left + metrics.width, metrics.bottom);
  context.stroke();
  context.fillStyle = "rgba(216,231,231,0.72)";
  context.font = "700 " + Math.max(7, fontSize - 1) + "px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textAlign = "center";
  for (let offset = 0; offset < metrics.stepCount; offset += 1) {
    const step = metrics.startStep + offset;
    if (step % 4 !== 0 && metrics.cellWidth < 24) continue;
    context.fillText(
      String(step + 1).padStart(2, "0"),
      metrics.left + (offset + 0.5) * metrics.cellWidth,
      Math.min(height - 8, metrics.bottom + 9),
    );
  }
  context.textAlign = "start";
  context.restore();
}

function drawFocusedLaneGuides(context, metrics, definition) {
  const row = metrics.row;
  context.save();
  context.font = "700 8px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textAlign = "right";
  context.textBaseline = "middle";
  const [pitchMinimum, pitchMaximum] = definition.kind === "steps"
    ? sequenceVisiblePitchBounds(definition.key)
    : [0, 1];
  const guides = definition.kind === "steps"
    ? [...new Set([
      pitchMaximum,
      Math.round((pitchMaximum + 0) * 0.5),
      0,
      Math.round((pitchMinimum + 0) * 0.5),
      pitchMinimum,
    ])].map((value) => [value, signedNumber(value)])
    : definition.kind === "contour"
      ? [[1, "1.00"], [0.75, ".75"], [0.5, ".50"], [0.25, ".25"], [0, ".00"]]
      : [];
  for (const [value, label] of guides) {
    const y = sequenceLaneY(definition.key, value, row);
    context.strokeStyle = value === 0 || value === 0.5
      ? "rgba(244,201,93,0.3)"
      : "rgba(255,255,255,0.085)";
    context.lineWidth = value === 0 || value === 0.5 ? 1.2 : 1;
    context.beginPath();
    context.moveTo(metrics.left, y);
    context.lineTo(metrics.left + metrics.width, y);
    context.stroke();
    context.fillStyle = value === 0 || value === 0.5
      ? "rgba(244,201,93,0.84)"
      : "rgba(216,231,231,0.48)";
    context.fillText(label, metrics.left - 6, y);
  }
  context.restore();
}

function drawResolvedArpTrace(context, metrics, row) {
  const points = [];
  const subdivisions = 4;
  for (let stepOffset = 0; stepOffset < metrics.stepCount; stepOffset += 1) {
    const step = metrics.startStep + stepOffset;
    for (let subdivision = 0; subdivision < subdivisions; subdivision += 1) {
      const beat = sequenceBeatForStep("arp", step + (subdivision + 0.5) / subdivisions);
      const note = webGpuChiptuneBeatSnapshot(beat, state.params, state.sequence).arp;
      if (!Number.isFinite(note)) continue;
      points.push({
        note,
        x: metrics.left
          + (stepOffset + (subdivision + 0.5) / subdivisions) * metrics.cellWidth,
      });
    }
  }
  if (points.length < 2) return;
  const minimum = Math.min(...points.map(({ note }) => note));
  const maximum = Math.max(...points.map(({ note }) => note));
  const spread = Math.max(12, maximum - minimum);
  context.save();
  context.beginPath();
  points.forEach(({ note, x }, index) => {
    const unit = clamp((note - minimum + (spread - (maximum - minimum)) * 0.5) / spread, 0, 1);
    const y = row.top + 14 + (1 - unit) * Math.max(1, row.height - 28);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.setLineDash([3, 4]);
  context.strokeStyle = "rgba(255,255,255,0.46)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();
}

function drawSequenceOverview(context, metrics, time) {
  const overview = metrics.overview;
  const canvasWidth = overview.left + overview.width + overview.right;
  context.save();
  context.fillStyle = "rgba(2,5,8,0.82)";
  context.fillRect(0, overview.top, canvasWidth, overview.bottom - overview.top);
  context.font = "700 7px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = "rgba(216,231,231,0.58)";
  context.fillText("ALL CLOCKS · TAP A ROW OR STEP", 5, overview.top + 6);

  for (const row of overview.rows) {
    const definition = row.definition;
    const lane = definition.key;
    const laneState = state.sequence.lanes[lane];
    const selectedLane = lane === state.activeSequenceLane;
    const playhead = webGpuChiptuneSequenceCellIndex(
      lane,
      time * state.params.tempo,
      state.params,
      state.sequence,
    );
    context.fillStyle = selectedLane ? "rgba(244,201,93,0.08)" : "rgba(255,255,255,0.018)";
    context.fillRect(0, row.top, canvasWidth, row.height);
    context.fillStyle = definition.color;
    context.globalAlpha = selectedLane ? 1 : 0.58;
    context.fillText(definition.shortLabel, 4, row.top + row.height * 0.5);
    context.globalAlpha = 1;
    for (let step = 0; step < WEBGPU_CHIPTUNE_SEQUENCE_STEPS; step += 1) {
      const x = overview.left + step * overview.cellWidth;
      const cell = laneState.cells[step];
      const insideLoop = step < laneState.activeLength;
      if (!insideLoop) {
        context.fillStyle = "rgba(0,0,0,0.46)";
        context.fillRect(x, row.top, overview.cellWidth, row.height);
      } else if (cell.state === "note") {
        context.fillStyle = definition.color;
        context.globalAlpha = 0.62;
        context.fillRect(
          x + 1,
          row.top + Math.max(1, row.height * 0.2),
          Math.max(1, overview.cellWidth - 2),
          Math.max(1, row.height * 0.6),
        );
        context.globalAlpha = 1;
      } else if (cell.state === "auto") {
        context.fillStyle = definition.color;
        context.globalAlpha = 0.22;
        context.fillRect(
          x + overview.cellWidth * 0.36,
          row.top + row.height * 0.38,
          Math.max(1, overview.cellWidth * 0.28),
          Math.max(1, row.height * 0.24),
        );
        context.globalAlpha = 1;
      }
      if (step === playhead) {
        context.fillStyle = "#ffffff";
        context.fillRect(x, row.top, Math.max(1, overview.cellWidth * 0.22), row.height);
      }
      if (selectedLane && step === state.activeSequenceStep) {
        context.strokeStyle = "#f4c95d";
        context.lineWidth = 1;
        context.strokeRect(x + 0.5, row.top + 0.5, Math.max(1, overview.cellWidth - 1), Math.max(1, row.height - 1));
      }
    }
  }
  context.restore();
}

function drawSequenceEditor(context, width, height, time) {
  const metrics = sequenceEditorMetrics(width, height);
  const definition = metrics.row.definition;
  const lane = definition.key;
  const laneState = state.sequence.lanes[lane];
  const playhead = webGpuChiptuneSequenceCellIndex(
    lane,
    time * state.params.tempo,
    state.params,
    state.sequence,
  );
  context.save();
  context.fillStyle = "rgba(2,5,8,0.52)";
  context.fillRect(0, 0, width, metrics.bottom + 2);
  context.font = "800 10px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = definition.color;
  context.fillText(definition.label, 6, 16);
  context.fillStyle = "rgba(216,231,231,0.6)";
  context.font = "700 8px ui-monospace, SFMono-Regular, Consolas, monospace";
  const actionLabel = definition.kind === "drums"
    ? "TAP = PAD STATE · HEIGHT IS BINARY"
    : definition.kind === "contour"
      ? "DRAW HEIGHT = SHAPE 0–1 · WHITE = RESOLVED INTERNAL PITCH"
      : "DRAW HEIGHT = SEMITONES · HOLLOW = SOURCE";
  context.fillText(actionLabel, Math.min(width * 0.36, metrics.left + 84), 16);
  context.textAlign = "right";
  context.fillText(
    String(metrics.startStep + 1).padStart(2, "0")
      + "–"
      + String(metrics.startStep + metrics.stepCount).padStart(2, "0"),
    width - 7,
    16,
  );
  context.textAlign = "left";

  context.fillStyle = "rgba(255,255,255,0.018)";
  context.fillRect(0, metrics.row.top, width, metrics.row.height);
  drawFocusedLaneGuides(context, metrics, definition);

  for (let offset = 0; offset < metrics.stepCount; offset += 1) {
    const step = metrics.startStep + offset;
    const x = metrics.left + offset * metrics.cellWidth;
    const outsideLoop = step >= laneState.activeLength;
    if (offset & 1) {
      context.fillStyle = "rgba(255,255,255,0.018)";
      context.fillRect(x, metrics.row.top, metrics.cellWidth, metrics.row.height);
    }
    if (outsideLoop) {
      context.fillStyle = "rgba(0,0,0,0.5)";
      context.fillRect(x, metrics.row.top, metrics.cellWidth, metrics.row.height);
    }
    if (step === playhead) {
      context.fillStyle = "rgba(255,255,255,0.085)";
      context.fillRect(x, metrics.row.top, metrics.cellWidth, metrics.row.height);
      context.fillStyle = definition.color;
      context.fillRect(x, metrics.row.top, Math.max(2, metrics.cellWidth * 0.055), metrics.row.height);
    }
    context.strokeStyle = step % 4 === 0
      ? "rgba(244,201,93,0.3)"
      : "rgba(255,255,255,0.1)";
    context.lineWidth = step % 4 === 0 ? 1.4 : 1;
    context.beginPath();
    context.moveTo(x, metrics.row.top);
    context.lineTo(x, metrics.bottom);
    context.stroke();
    context.fillStyle = "rgba(216,231,231,0.68)";
    context.font = "700 8px ui-monospace, SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.fillText(String(step + 1).padStart(2, "0"), x + metrics.cellWidth * 0.5, metrics.row.top - 8);
  }
  context.strokeStyle = "rgba(255,255,255,0.14)";
  context.strokeRect(metrics.left, metrics.row.top, metrics.width, metrics.row.height);

  if (definition.kind !== "drums") {
    context.save();
    context.beginPath();
    for (let offset = 0; offset < metrics.stepCount; offset += 1) {
      const step = metrics.startStep + offset;
      const x = metrics.left + (offset + 0.5) * metrics.cellWidth;
      const y = sequenceLaneY(lane, suggestedSequenceValue(lane, step), metrics.row);
      if (offset === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.setLineDash([4, 5]);
    context.strokeStyle = definition.color;
    context.globalAlpha = 0.32;
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
  }

  if (definition.kind === "contour") {
    context.beginPath();
    let drawing = false;
    for (let offset = 0; offset < metrics.stepCount; offset += 1) {
      const step = metrics.startStep + offset;
      const cell = laneState.cells[step];
      if (cell.state === "rest") {
        drawing = false;
        continue;
      }
      const x = metrics.left + (offset + 0.5) * metrics.cellWidth;
      const y = sequenceLaneY(lane, selectedSequenceValue(lane, step), metrics.row);
      if (!drawing) context.moveTo(x, y);
      else context.lineTo(x, y);
      drawing = true;
    }
    context.strokeStyle = definition.color;
    context.globalAlpha = 0.78;
    context.lineWidth = 3;
    context.stroke();
    context.globalAlpha = 1;
  }

  for (let offset = 0; offset < metrics.stepCount; offset += 1) {
    const step = metrics.startStep + offset;
    const x = metrics.left + offset * metrics.cellWidth;
    const cell = laneState.cells[step];
    const outsideLoop = step >= laneState.activeLength;
    const selected = step === state.activeSequenceStep;
    if (definition.kind === "drums") {
      const padInset = Math.max(4, metrics.cellWidth * 0.1);
      const padTop = metrics.row.top + metrics.row.height * 0.18;
      const padHeight = metrics.row.height * 0.64;
      const preview = cell.state === "auto" ? sourceDrumPreview(lane, step) : 0;
      context.fillStyle = cell.state === "note"
        ? definition.color
        : cell.state === "rest"
          ? "rgba(8,12,16,0.94)"
          : "rgba(8,12,16," + (0.72 - preview * 0.24) + ")";
      context.globalAlpha = outsideLoop ? 0.3 : 1;
      context.fillRect(
        x + padInset,
        padTop,
        Math.max(2, metrics.cellWidth - padInset * 2),
        padHeight,
      );
      context.strokeStyle = cell.state === "auto" ? definition.color : "rgba(255,255,255,0.34)";
      context.setLineDash(cell.state === "auto" ? [4, 3] : []);
      context.strokeRect(
        x + padInset,
        padTop,
        Math.max(2, metrics.cellWidth - padInset * 2),
        padHeight,
      );
      context.setLineDash([]);
      context.globalAlpha = 1;
      context.fillStyle = cell.state === "note" ? "#061016" : definition.color;
      context.font = "800 " + Math.max(7, Math.min(11, metrics.cellWidth * 0.2))
        + "px ui-monospace, SFMono-Regular, Consolas, monospace";
      context.textAlign = "center";
      context.fillText(
        cell.state === "note" ? "HIT" : cell.state === "rest" ? "OFF" : "SRC",
        x + metrics.cellWidth * 0.5,
        padTop + padHeight * 0.5,
      );
    } else if (cell.state === "rest") {
      drawRestCell(context, x, metrics.row.top, metrics.cellWidth, metrics.row.height);
      context.fillStyle = "rgba(216,231,231,0.5)";
      context.font = "800 9px ui-monospace, SFMono-Regular, Consolas, monospace";
      context.textAlign = "center";
      context.fillText("REST", x + metrics.cellWidth * 0.5, metrics.bottom - 12);
    } else {
      const value = selectedSequenceValue(lane, step);
      const sourceY = sequenceLaneY(lane, suggestedSequenceValue(lane, step), metrics.row);
      const y = sequenceLaneY(lane, value, metrics.row);
      const radius = Math.max(4, Math.min(8, metrics.cellWidth * 0.14));
      context.beginPath();
      context.arc(x + metrics.cellWidth * 0.5, sourceY, Math.max(2.5, radius * 0.58), 0, Math.PI * 2);
      context.strokeStyle = definition.color;
      context.globalAlpha = 0.42;
      context.lineWidth = 1.5;
      context.stroke();
      context.globalAlpha = outsideLoop ? 0.3 : 1;
      if (cell.state === "note") {
        if (definition.kind === "steps") {
          context.fillStyle = definition.color;
          context.fillRect(
            x + Math.max(3, metrics.cellWidth * 0.12),
            y - 4,
            Math.max(3, metrics.cellWidth * 0.76),
            8,
          );
        }
        context.beginPath();
        context.arc(x + metrics.cellWidth * 0.5, y, radius, 0, Math.PI * 2);
        context.fillStyle = definition.color;
        context.fill();
      }
      context.globalAlpha = 1;
      context.fillStyle = cell.state === "note" ? definition.color : "rgba(216,231,231,0.58)";
      context.font = "800 8px ui-monospace, SFMono-Regular, Consolas, monospace";
      context.textAlign = "center";
      context.fillText(cell.state === "note" ? "N" : "S", x + metrics.cellWidth * 0.5, metrics.bottom - 9);
      if (metrics.cellWidth >= 36) {
        context.fillStyle = "rgba(216,231,231,0.72)";
        context.font = "700 7px ui-monospace, SFMono-Regular, Consolas, monospace";
        context.fillText(
          definition.kind === "contour" ? value.toFixed(2) : signedNumber(value),
          x + metrics.cellWidth * 0.5,
          clamp(y - 12, metrics.row.top + 9, metrics.bottom - 24),
        );
      }
    }
    if (selected) {
      context.strokeStyle = "#f4c95d";
      context.lineWidth = 2.5;
      context.strokeRect(
        x + 2,
        metrics.row.top + 2,
        Math.max(2, metrics.cellWidth - 4),
        Math.max(2, metrics.row.height - 4),
      );
    }
  }

  if (lane === "lead") drawResolvedLeadTrace(context, metrics, metrics.row);
  if (lane === "arp") drawResolvedArpTrace(context, metrics, metrics.row);
  context.restore();
  drawSequenceOverview(context, metrics, time);
}

const characterPalettes = Object.freeze([
  Object.freeze({ hue: 186, name: "SCOUT" }),
  Object.freeze({ hue: 103, name: "RUNNER" }),
  Object.freeze({ hue: 267, name: "MONSTER" }),
  Object.freeze({ hue: 326, name: "HERO" }),
  Object.freeze({ hue: 43, name: "SPRITE" }),
]);
const reducedMotionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

function deterministicPixel(seed) {
  return positiveModulo(Math.sin(seed * 12.9898 + 78.233) * 43758.5453, 1);
}

function resizeCharacterCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const pixelScale = rect.width >= 1500 ? 3 : 2;
  const width = Math.max(120, Math.floor(rect.width / pixelScale));
  const height = Math.max(32, Math.floor(rect.height / pixelScale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, pixelScale, cssWidth: rect.width };
}

function pixelRect(context, x, y, width, height, color) {
  context.fillStyle = color;
  context.fillRect(
    Math.round(x),
    Math.round(y),
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
  );
}

function actorColors(actor, index) {
  const base = characterPalettes[index].hue;
  const hue = positiveModulo(base + (actor.hue - 0.5) * 64, 360);
  const lightness = 38 + actor.levelUnit * 24;
  return Object.freeze({
    outline: "#020509",
    shadow: "hsl(" + hue + " 62% " + Math.max(18, lightness - 22) + "%)",
    mid: "hsl(" + positiveModulo(hue - 14, 360) + " 76% "
      + Math.max(24, lightness - 10) + "%)",
    body: "hsl(" + hue + " 88% " + lightness + "%)",
    highlight: "hsl(" + positiveModulo(hue + 18, 360) + " 96% "
      + Math.min(88, lightness + 22) + "%)",
    spark: "hsl(" + positiveModulo(hue + 46, 360) + " 100% "
      + Math.min(94, lightness + 30) + "%)",
  });
}

function drawStateBadge(context, actor, x, y, unit, colors) {
  if (actor.cellState === "note") {
    pixelRect(context, x - unit, y, unit * 2, unit, colors.highlight);
  } else if (actor.cellState === "rest") {
    pixelRect(context, x - unit * 2, y, unit, unit, colors.shadow);
    pixelRect(context, x + unit, y, unit, unit, colors.shadow);
  } else {
    pixelRect(context, x - unit, y, unit, unit, colors.body);
    pixelRect(context, x + unit, y, unit, unit, colors.body);
  }
}

function drawRestGlyph(context, x, y, unit, color) {
  pixelRect(context, x, y, unit * 3, unit, color);
  pixelRect(context, x + unit * 2, y + unit, unit, unit, color);
  pixelRect(context, x, y + unit * 2, unit * 3, unit, color);
}

const pixelGait = Object.freeze([0, 1, 1, 0, 0, -1, -1, 0]);

function actorPose(actor, reducedMotion) {
  const animated = !reducedMotion && !actor.resting;
  const frame = animated ? actor.frame & 7 : 0;
  const modulation = animated ? Math.sin(actor.motionPhase * Math.PI * 2) : 0;
  return {
    animated,
    frame,
    gait: pixelGait[frame],
    counterGait: pixelGait[(frame + 4) & 7],
    sway: Math.round(modulation * (0.5 + actor.motion * 1.5)),
    flutter: Math.round(Math.abs(modulation) * (1 + actor.range * 2)),
    recoil: animated ? Math.round(actor.onset * 2) : 0,
  };
}

function drawScout(context, actor, x, ground, unit, colors, pose, grow) {
  const torsoWidth = (4 + Math.round(actor.shape * 2)) * unit;
  const packWidth = (1 + Math.round(actor.detail * 2)) * unit;
  const top = ground - (13 + grow) * unit;
  const antennaX = x + pose.sway * unit;
  pixelRect(context, x - unit, top - 3 * unit, unit, 3 * unit, colors.outline);
  pixelRect(context, antennaX - unit, top - 4 * unit, 2 * unit, unit, colors.spark);
  pixelRect(context, x - 3 * unit, top, 6 * unit, 4 * unit, colors.outline);
  pixelRect(context, x - 2 * unit, top + unit, 4 * unit, 3 * unit, colors.body);
  pixelRect(context, x - 2 * unit, top + unit, 4 * unit, unit, colors.highlight);
  pixelRect(context, x - unit + pose.sway * unit, top + 2 * unit, 2 * unit, unit, colors.outline);
  pixelRect(context, x + pose.sway * unit, top + 2 * unit, unit, unit, colors.spark);
  pixelRect(context, x - torsoWidth / 2 - unit, top + 4 * unit, torsoWidth + 2 * unit, 6 * unit, colors.outline);
  pixelRect(context, x - torsoWidth / 2, top + 4 * unit, torsoWidth, 5 * unit, colors.body);
  pixelRect(context, x - torsoWidth / 2, top + 4 * unit, torsoWidth, unit, colors.highlight);
  pixelRect(context, x - torsoWidth / 2 - packWidth, top + 5 * unit, packWidth, 4 * unit, colors.mid);
  pixelRect(context, x - torsoWidth / 2 - packWidth, top + 6 * unit, unit, unit, colors.spark);
  pixelRect(context, x - torsoWidth / 2 - 2 * unit, top + (5 + pose.gait) * unit, 2 * unit, unit, colors.body);
  pixelRect(context, x + torsoWidth / 2, top + (6 - pose.gait) * unit, 3 * unit, unit, colors.body);
  pixelRect(context, x + torsoWidth / 2 + 2 * unit, top + (5 - pose.gait) * unit, unit, 3 * unit, colors.highlight);
  if (actor.gate > 0.08) {
    const beam = 1 + Math.round(actor.detail * 3);
    for (let index = 0; index < beam; index += 1) {
      if ((index + pose.frame) & 1) continue;
      pixelRect(
        context,
        x + torsoWidth / 2 + (4 + index) * unit,
        top + (5 - pose.gait) * unit,
        unit,
        unit,
        colors.spark,
      );
    }
  }
  pixelRect(context, x - torsoWidth / 2, top + 8 * unit, torsoWidth, unit, colors.mid);
  pixelRect(context, x - 2 * unit + pose.gait * unit, top + 10 * unit, 2 * unit, 3 * unit, colors.body);
  pixelRect(context, x + pose.counterGait * unit, top + 10 * unit, 2 * unit, 3 * unit, colors.body);
  pixelRect(context, x - 3 * unit + pose.gait * unit, top + 12 * unit, 3 * unit, unit, colors.shadow);
  pixelRect(context, x + pose.counterGait * unit, top + 12 * unit, 3 * unit, unit, colors.shadow);
}

function drawRunner(context, actor, x, ground, unit, colors, pose, grow) {
  const top = ground - (12 + grow) * unit;
  const shoulder = (actor.shape > 0.5 ? 5 : 4) * unit;
  const scarf = 2 + Math.round(actor.detail * 3);
  pixelRect(context, x - unit, top - 2 * unit, 2 * unit, 2 * unit, colors.body);
  pixelRect(context, x + pose.sway * unit, top - 3 * unit, unit, unit, colors.spark);
  for (let tail = 0; tail < scarf; tail += 1) {
    pixelRect(
      context,
      x - (3 + tail) * unit,
      top + (2 + ((tail + pose.frame) & 1)) * unit,
      unit,
      unit,
      tail & 1 ? colors.mid : colors.highlight,
    );
  }
  pixelRect(context, x - 3 * unit, top, 6 * unit, 4 * unit, colors.outline);
  pixelRect(context, x - 2 * unit, top + unit, 4 * unit, 2 * unit, colors.body);
  pixelRect(context, x - 2 * unit, top + unit, 3 * unit, unit, colors.highlight);
  pixelRect(context, x + pose.sway * unit, top + 2 * unit, unit, unit, colors.outline);
  pixelRect(context, x - shoulder / 2 - unit, top + 4 * unit, shoulder + 2 * unit, 5 * unit, colors.outline);
  pixelRect(context, x - shoulder / 2, top + 4 * unit, shoulder, 4 * unit, colors.body);
  pixelRect(context, x - unit, top + 5 * unit, 2 * unit, 2 * unit, colors.mid);
  pixelRect(context, x - shoulder / 2, top + 7 * unit, shoulder, unit, colors.highlight);
  pixelRect(context, x - 4 * unit, top + (5 + pose.gait) * unit, 3 * unit, unit, colors.shadow);
  pixelRect(context, x + 2 * unit, top + (5 - pose.gait) * unit, 3 * unit, unit, colors.highlight);
  pixelRect(context, x - 2 * unit + pose.counterGait * unit, top + 9 * unit, 2 * unit, 3 * unit, colors.body);
  pixelRect(context, x + pose.gait * unit, top + 9 * unit, 2 * unit, 3 * unit, colors.body);
  pixelRect(context, x - 3 * unit + pose.counterGait * unit, top + 11 * unit, 3 * unit, unit, colors.shadow);
  pixelRect(context, x + pose.gait * unit, top + 11 * unit, 3 * unit, unit, colors.shadow);
  if (pose.animated && actor.gate > 0.2) {
    const streaks = 1 + Math.round(actor.motion * 2);
    for (let streak = 0; streak < streaks; streak += 1) {
      pixelRect(
        context,
        x - (5 + streak * 2) * unit,
        top + (8 + streak * 2) * unit,
        unit * (1 + (streak & 1)),
        unit,
        colors.spark,
      );
    }
  }
}

function drawMonster(context, actor, x, ground, unit, colors, pose, grow) {
  const roundness = Math.round(actor.shape * 2);
  const width = (8 + grow) * unit;
  const top = ground - (10 + grow) * unit;
  const horn = 1 + Math.round(actor.range * 2);
  const jaw = actor.resting ? 0 : 1 + Math.round(actor.gate * 2);
  const mouthWidth = (3 + Math.round(actor.detail * 4)) * unit;
  pixelRect(context, x - width / 2 + unit, top - horn * unit, unit, horn * unit, colors.highlight);
  pixelRect(context, x + width / 2 - 2 * unit, top - horn * unit, unit, horn * unit, colors.highlight);
  pixelRect(context, x - width / 2 + roundness * unit, top, width - roundness * 2 * unit, unit, colors.outline);
  pixelRect(context, x - width / 2, top + unit, width, (7 + grow + jaw) * unit, colors.outline);
  pixelRect(context, x - width / 2 + unit, top + 2 * unit, width - 2 * unit, (5 + grow) * unit, colors.body);
  pixelRect(context, x - width / 2 + 2 * unit, top + 2 * unit, width - 4 * unit, unit, colors.highlight);
  pixelRect(context, x - 2 * unit + pose.sway * unit, top + 4 * unit, unit, unit, colors.outline);
  pixelRect(context, x + unit + pose.sway * unit, top + 4 * unit, unit, unit, colors.outline);
  pixelRect(context, x - mouthWidth / 2, top + 6 * unit, mouthWidth, jaw * unit, colors.shadow);
  pixelRect(context, x - mouthWidth / 2 + unit, top + 6 * unit, unit, unit, colors.spark);
  pixelRect(context, x + mouthWidth / 2 - 2 * unit, top + 6 * unit, unit, unit, colors.spark);
  if (jaw > 1) {
    pixelRect(context, x - unit, top + (5 + jaw) * unit, 2 * unit, unit, colors.highlight);
  }
  pixelRect(context, x - width / 2 + unit, top + (6 + grow) * unit, width - 2 * unit, unit, colors.mid);
  pixelRect(context, x - width / 2 - 2 * unit, top + (4 + pose.gait) * unit, 2 * unit, 4 * unit, colors.body);
  pixelRect(context, x + width / 2, top + (4 - pose.gait) * unit, 2 * unit, 4 * unit, colors.body);
  pixelRect(context, x - width / 2 - 2 * unit, top + (7 + pose.gait) * unit, 2 * unit, 2 * unit, colors.shadow);
  pixelRect(context, x + width / 2, top + (7 - pose.gait) * unit, 2 * unit, 2 * unit, colors.shadow);
  pixelRect(context, x - 3 * unit + pose.gait * unit, top + (8 + grow + jaw) * unit, 3 * unit, 2 * unit, colors.shadow);
  pixelRect(context, x + pose.counterGait * unit, top + (8 + grow + jaw) * unit, 3 * unit, 2 * unit, colors.shadow);
  if (pose.recoil > 0) {
    pixelRect(context, x - 5 * unit, ground, 2 * unit, unit, colors.spark);
    pixelRect(context, x + 3 * unit, ground, 2 * unit, unit, colors.spark);
  }
}

function drawHero(context, actor, x, ground, unit, colors, pose, grow) {
  const top = ground - (14 + grow) * unit;
  const capeDirection = actor.shape >= 0.5 ? -1 : 1;
  const capeLength = 4 + Math.round(actor.range * 3);
  const trillRaised = pose.animated && actor.motionPhase >= 1 - actor.detail;
  for (let row = 0; row < capeLength; row += 1) {
    const flutter = row > 1 ? pose.sway * capeDirection : 0;
    pixelRect(
      context,
      x + capeDirection * (3 + Math.abs(flutter)) * unit,
      top + (5 + row) * unit,
      (2 + (row >> 1)) * unit,
      unit,
      row & 1 ? colors.shadow : colors.mid,
    );
  }
  pixelRect(context, x - 2 * unit, top - unit, 4 * unit, unit, colors.highlight);
  pixelRect(context, x - unit + pose.sway * unit, top - 2 * unit, 2 * unit, unit, colors.spark);
  pixelRect(context, x - 3 * unit, top, 6 * unit, 4 * unit, colors.outline);
  pixelRect(context, x - 2 * unit, top + unit, 4 * unit, 3 * unit, colors.body);
  pixelRect(context, x - 2 * unit, top + unit, 4 * unit, unit, colors.highlight);
  pixelRect(context, x + pose.sway * unit, top + 2 * unit, unit, unit, colors.outline);
  pixelRect(context, x - 3 * unit, top + 4 * unit, 6 * unit, 7 * unit, colors.outline);
  pixelRect(context, x - 2 * unit, top + 4 * unit, 4 * unit, 6 * unit, colors.body);
  pixelRect(context, x - unit, top + 5 * unit, 2 * unit, 2 * unit, colors.highlight);
  pixelRect(context, x - 2 * unit, top + 8 * unit, 4 * unit, unit, colors.mid);
  pixelRect(context, x - 4 * unit, top + (5 + pose.gait) * unit, 2 * unit, unit, colors.body);
  const swordX = x + 4 * unit;
  const swordTop = trillRaised ? top : top + 3 * unit;
  pixelRect(context, x + 2 * unit, top + (5 - pose.gait) * unit, 3 * unit, unit, colors.highlight);
  pixelRect(context, swordX, swordTop, unit, 6 * unit, colors.highlight);
  pixelRect(context, swordX + unit, swordTop - unit, unit, unit, colors.spark);
  if (pose.recoil > 0) {
    pixelRect(context, swordX + 2 * unit, swordTop + unit, unit, unit, colors.spark);
    pixelRect(context, swordX - unit, swordTop - 2 * unit, unit, unit, colors.spark);
  }
  pixelRect(context, x - 2 * unit + pose.gait * unit, top + 11 * unit, 2 * unit, 3 * unit, colors.body);
  pixelRect(context, x + pose.counterGait * unit, top + 11 * unit, 2 * unit, 3 * unit, colors.body);
  pixelRect(context, x - 3 * unit + pose.gait * unit, top + 13 * unit, 3 * unit, unit, colors.shadow);
  pixelRect(context, x + pose.counterGait * unit, top + 13 * unit, 3 * unit, unit, colors.shadow);
}

function drawSprite(context, actor, x, ground, unit, colors, pose, grow) {
  const top = ground - (11 + grow) * unit;
  const wing = 2 + Math.round(actor.shape * 3);
  const gateAperture = Math.round(actor.detail * 2);
  const wingLift = (pose.animated ? pose.flutter : 1) + gateAperture;
  pixelRect(context, x - (wing + 2) * unit, top + (3 - wingLift) * unit, wing * unit, unit, colors.highlight);
  pixelRect(context, x - (wing + 1) * unit, top + (2 + wingLift) * unit, wing * unit, unit, colors.body);
  pixelRect(context, x + 2 * unit, top + (2 + wingLift) * unit, wing * unit, unit, colors.body);
  pixelRect(context, x + 2 * unit, top + (3 - wingLift) * unit, wing * unit, unit, colors.highlight);
  pixelRect(context, x - unit, top - 2 * unit, unit, 2 * unit, colors.highlight);
  pixelRect(context, x + unit, top - 2 * unit, unit, 2 * unit, colors.highlight);
  pixelRect(context, x - 2 * unit + pose.sway * unit, top - 3 * unit, unit, unit, colors.spark);
  pixelRect(context, x - 3 * unit, top, 6 * unit, 5 * unit, colors.outline);
  pixelRect(context, x - 2 * unit, top + unit, 4 * unit, 4 * unit, colors.body);
  pixelRect(context, x - unit + pose.sway * unit, top + unit, unit, unit, colors.highlight);
  pixelRect(context, x + unit + pose.sway * unit, top + 2 * unit, unit, unit, colors.outline);
  pixelRect(context, x - 2 * unit, top + 5 * unit, 4 * unit, 5 * unit, colors.outline);
  pixelRect(context, x - unit, top + 5 * unit, 2 * unit, 4 * unit, colors.body);
  pixelRect(context, x - 2 * unit, top + 7 * unit, 4 * unit, unit, colors.mid);
  pixelRect(context, x - 2 * unit + pose.gait * unit, top + 10 * unit, 2 * unit, unit, colors.body);
  pixelRect(context, x + pose.counterGait * unit, top + 10 * unit, 2 * unit, unit, colors.body);
  const orbiters = 1 + Math.round(actor.range * 2) + Math.round(actor.detail);
  if (pose.animated && actor.gate > 0.08) {
    for (let orbiter = 0; orbiter < orbiters; orbiter += 1) {
      const orbitFrame = (pose.frame + orbiter * 2) & 7;
      const orbitX = pixelGait[orbitFrame] * (4 + gateAperture + orbiter) * unit;
      const orbitY = pixelGait[(orbitFrame + 2) & 7] * (2 + (orbiter & 1)) * unit;
      pixelRect(context, x + orbitX, top + 4 * unit + orbitY, unit, unit, colors.spark);
    }
  }
}

const defaultInvaderDancePose = Object.freeze({
  hold: 0.5,
  march: 0,
  bob: 0,
  claw: 0,
  feet: 0,
  wing: 0,
  lean: 0,
  reach: 0,
  turn: 0,
  look: 0,
  squat: 0,
  spin: 0,
});

function freezeInvaderDanceProfile(frames) {
  return Object.freeze(frames.map((frame) => Object.freeze({
    ...defaultInvaderDancePose,
    ...frame,
  })));
}

const invaderDanceProfiles = Object.freeze({
  upperOne: freezeInvaderDanceProfile([
    { hold: 0.72 },
    { hold: 0.76, claw: 2, feet: -0.8, lean: -1, reach: 1.5, turn: -1, look: -1, wing: -0.5 },
    { hold: 0.58, bob: -1.5, claw: -1, lean: -0.5, reach: 0.5, turn: -1, look: -1 },
    { hold: 0.74 },
    { hold: 0.76, claw: 2, feet: 0.8, lean: 1, reach: 1.5, turn: 1, look: 1, wing: 0.5 },
    { hold: 0.58, bob: -1.5, claw: -1, lean: 0.5, reach: 0.5, turn: 1, look: 1 },
    { hold: 0.68, bob: 1, claw: -1, squat: 1, wing: 1 },
    { hold: 0.82, bob: -2, claw: 2, reach: 2, feet: 0 },
  ]),
  upperTwo: freezeInvaderDanceProfile([
    { hold: 0.42, march: -2, feet: -1, lean: 1, wing: -1, look: 1, turn: -1 },
    { hold: 0.38, march: -1.4, bob: -0.5, feet: -0.4, lean: 0.6, wing: -0.5, look: 1, turn: -0.7 },
    { hold: 0.46, march: 0, bob: -1, feet: 0.5, wing: 0, turn: 0 },
    { hold: 0.38, march: 1.4, bob: -0.5, feet: 1, lean: -0.6, wing: 0.5, look: -1, turn: 0.7 },
    { hold: 0.42, march: 2, feet: 0.3, lean: -1, wing: 1, look: -1, turn: 1 },
    { hold: 0.38, march: 1.2, bob: -0.5, feet: -1, lean: -0.5, wing: 0.4, look: -1, turn: 0.7 },
    { hold: 0.46, march: 0, bob: -1, feet: -0.3, turn: 0 },
    { hold: 0.38, march: -1.2, bob: -0.5, feet: 1, lean: 0.6, wing: -0.5, look: 1, turn: -0.7 },
  ]),
  bass: freezeInvaderDanceProfile([
    { hold: 0.72 },
    { hold: 0.6, bob: 1, claw: -0.5, reach: 0.5, squat: 1 },
    { hold: 0.62, bob: 2.5, claw: -1.5, feet: -0.4, reach: 1.5, squat: 2 },
    { hold: 0.82, bob: 3, claw: -2, reach: 2, squat: 2.5 },
    { hold: 0.62, bob: 1.5, claw: 1, feet: -1.5, reach: 1, squat: 1.5, look: -1 },
    { hold: 0.42, bob: -1, claw: 2, feet: 0, reach: 1, squat: 0.2 },
    { hold: 0.66, bob: 1, claw: 0.5, feet: 1.5, squat: 0.8, look: 1 },
    { hold: 0.78 },
  ]),
  lead: freezeInvaderDanceProfile([
    { hold: 0.62 },
    { hold: 0.45, march: -0.3, bob: -0.5, feet: -1, lean: -1, reach: 1.5, turn: -1, look: -1, wing: 1 },
    { hold: 0.58, bob: -2, feet: -1.5, lean: -1.5, reach: 3, turn: -1, look: -1, wing: 2 },
    { hold: 0.4, bob: -2.5, feet: 0, reach: 2, turn: 0, wing: 1.5 },
    { hold: 0.58, bob: -2, feet: 1.5, lean: 1.5, reach: 3, turn: 1, look: 1, wing: 2 },
    { hold: 0.45, march: 0.3, bob: -0.5, feet: 1, lean: 1, reach: 1.5, turn: 1, look: 1, wing: 0.5 },
    { hold: 0.68, bob: 1.5, feet: -1, lean: -1, reach: 2, turn: -1, look: -1, squat: 1, wing: -1 },
    { hold: 0.84 },
  ]),
  arp: freezeInvaderDanceProfile([
    { hold: 0.58, wing: -2, feet: -1, turn: -1, look: -1, spin: 0 },
    { hold: 0.52, march: 0.6, bob: -1, wing: -1, feet: -0.5, reach: 0.5, turn: -0.6, look: -1, spin: 1 },
    { hold: 0.62, march: 1, bob: -2, wing: 1, feet: 0, reach: 1.5, turn: 0, spin: 2 },
    { hold: 0.68, march: 0.6, bob: -1, wing: 2, feet: 0.7, reach: 2, turn: 0.6, look: 1, spin: 3 },
    { hold: 0.58, wing: 2, feet: 1, reach: 2, turn: 1, look: 1, spin: 4 },
    { hold: 0.52, march: -0.6, bob: -1, wing: 1, feet: 0.5, reach: 1.5, turn: 0.6, look: 1, spin: 5 },
    { hold: 0.62, march: -1, bob: -2, wing: -1, feet: 0, reach: 0.5, turn: 0, spin: 6 },
    { hold: 0.68, march: -0.6, bob: -1, wing: -2, feet: -0.7, turn: -0.6, look: -1, spin: 7 },
  ]),
});

const invaderDanceKeys = Object.freeze([
  "march", "bob", "claw", "feet", "wing", "lean", "reach", "turn", "look", "squat", "spin",
]);

function invaderDancePoseAtPhase(profile, phase) {
  const scaledPhase = positiveModulo(phase, 1) * profile.length;
  const frame = Math.floor(scaledPhase) % profile.length;
  const progress = scaledPhase - Math.floor(scaledPhase);
  const current = profile[frame];
  const next = profile[(frame + 1) % profile.length];
  const transition = clamp(
    (progress - current.hold) / Math.max(0.001, 1 - current.hold),
    0,
    1,
  );
  const eased = transition * transition * (3 - 2 * transition);
  const pose = { frame };
  for (const key of invaderDanceKeys) {
    pose[key] = current[key] + (next[key] - current[key]) * eased;
  }
  return pose;
}

function detailedActorPose(actor, reducedMotion) {
  const animated = !reducedMotion;
  const sounding = animated && !actor.resting;
  const profile = invaderDanceProfiles[actor.key] ?? invaderDanceProfiles.upperOne;
  const formation = invaderDancePoseAtPhase(profile, animated ? actor.dancePhase : 0);
  return Object.freeze({
    ...formation,
    animated,
    sounding,
    hairMotion: animated
      ? formation.turn * (0.55 + actor.motion * 0.35)
      : 0,
    eyeX: animated ? formation.look : 0,
    eyeY: 1,
    compression: animated
      ? Math.max(0, Math.round(Math.max(0, formation.squat) * 0.6))
      : 0,
  });
}

function spriteRect(context, x, ground, texel, gridX, gridY, width, height, color) {
  pixelRect(
    context,
    x + gridX * texel,
    ground + gridY * texel,
    width * texel,
    height * texel,
    color,
  );
}

function drawPixelSegment(context, x, ground, texel, from, to, color, thickness = 2) {
  let x0 = Math.round(from[0]);
  let y0 = Math.round(from[1]);
  const x1 = Math.round(to[0]);
  const y1 = Math.round(to[1]);
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    spriteRect(
      context,
      x,
      ground,
      texel,
      x0 - Math.floor(thickness / 2),
      y0 - Math.floor(thickness / 2),
      thickness,
      thickness,
      color,
    );
    if (x0 === x1 && y0 === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x0 += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y0 += sy;
    }
  }
}

function drawPixelEyes(context, x, ground, texel, centerY, colors, pose, wide = false) {
  const spacing = wide ? 5 : 4;
  const pupilX = pose.eyeX > 0 ? 1 : 0;
  const pupilY = pose.eyeY > 0 ? 1 : 0;
  for (const side of [-1, 1]) {
    const eyeX = side * spacing - 2;
    spriteRect(context, x, ground, texel, eyeX, centerY - 2, 4, 4, colors.outline);
    spriteRect(context, x, ground, texel, eyeX + 1, centerY - 1, 2, 2, "#f4fbff");
    spriteRect(context, x, ground, texel, eyeX + 1, centerY - 1, 1, 1, colors.spark);
    spriteRect(
      context,
      x,
      ground,
      texel,
      eyeX + 1 + pupilX,
      centerY - 1 + pupilY,
      1,
      1,
      colors.outline,
    );
  }
}

function drawPixelHair(context, x, ground, texel, points, color, motion = 0) {
  for (const [hairX, hairY, height = 2] of points) {
    spriteRect(
      context,
      x,
      ground,
      texel,
      hairX + Math.sign(hairX || 1) * motion,
      hairY - Math.abs(motion),
      2,
      height + Math.abs(motion),
      color,
    );
  }
}

function drawInvaderAntennae(
  context,
  x,
  ground,
  texel,
  y,
  spacing,
  height,
  colors,
  pose,
) {
  const flare = pose.animated ? pose.wing : 0;
  for (const side of [-1, 1]) {
    const stemX = side * spacing - (side < 0 ? 1 : 0);
    spriteRect(context, x, ground, texel, stemX, y - height, 2, height, colors.outline);
    spriteRect(context, x, ground, texel, stemX + (side < 0 ? 1 : 0), y - height + 1, 1, height - 1, colors.highlight);
    spriteRect(
      context,
      x,
      ground,
      texel,
      stemX + side * (1 + flare),
      y - height - 2,
      2,
      2,
      colors.spark,
    );
  }
}

function drawInvaderClaws(
  context,
  x,
  ground,
  texel,
  anchorY,
  halfWidth,
  reach,
  colors,
  pose,
) {
  const baseOpen = pose.animated ? pose.claw : 0;
  const expressiveReach = pose.animated ? pose.reach : 0;
  const turn = pose.animated ? pose.turn : 0;
  for (const side of [-1, 1]) {
    const sideReach = reach + Math.max(0, expressiveReach + side * turn * 0.85);
    const open = baseOpen + side * turn * 0.55;
    const shoulder = [side * halfWidth, anchorY];
    const elbow = [side * (halfWidth + sideReach), anchorY + 2 - Math.abs(open)];
    drawPixelSegment(context, x, ground, texel, shoulder, elbow, colors.outline, 4);
    drawPixelSegment(context, x, ground, texel, shoulder, elbow, colors.body, 2);
    const clawX = side * (halfWidth + sideReach + 1);
    spriteRect(context, x, ground, texel, clawX - 1, anchorY - 2 - open, 2, 3, colors.highlight);
    spriteRect(context, x, ground, texel, clawX - 1, anchorY + 2 + open, 2, 3, colors.highlight);
  }
}

function drawInvaderFeet(
  context,
  x,
  ground,
  texel,
  positions,
  colors,
  pose,
  width = 4,
  liftScale = 1,
) {
  positions.forEach((footX, index) => {
    const side = footX < 0 ? -1 : footX > 0 ? 1 : index & 1 ? 1 : -1;
    const lift = pose.animated
      ? Math.max(0, Math.round(side * pose.feet * 1.25 * liftScale))
      : 0;
    spriteRect(context, x, ground, texel, footX - 1, -5 - lift, 2, 4, colors.outline);
    spriteRect(context, x, ground, texel, footX - Math.floor(width / 2), -2 - lift, width, 2, colors.shadow);
    spriteRect(context, x, ground, texel, footX - 1, -3 - lift, 2, 1, colors.spark);
  });
}

function drawDetailedScout(context, actor, x, ground, unit, colors, pose, grow) {
  const px = unit * 0.5;
  const bodyX = x + pose.lean * px;
  const bob = pose.bob + Math.max(0, pose.squat);
  const shellWidth = 8 + Math.round(actor.shape * 3);
  const detailBars = 1 + Math.round(actor.detail * 3);
  drawInvaderAntennae(context, bodyX, ground, px, -28 + bob, 5, 4, colors, pose);
  spriteRect(context, bodyX, ground, px, -4, -29 + bob, 8, 2, colors.outline);
  spriteRect(context, bodyX, ground, px, -7, -27 + bob, 14, 3, colors.outline);
  spriteRect(context, bodyX, ground, px, -shellWidth, -24 + bob, shellWidth * 2, 10 + grow, colors.outline);
  spriteRect(context, bodyX, ground, px, -shellWidth + 1, -23 + bob, shellWidth * 2 - 2, 7 + grow, colors.body);
  spriteRect(context, bodyX, ground, px, -shellWidth + 2, -22 + bob, shellWidth * 2 - 4, 2, colors.highlight);
  spriteRect(context, bodyX, ground, px, -5, -16 + bob, 10, 6 + grow, colors.mid);
  drawPixelEyes(context, bodyX, ground, px, -20 + bob, colors, pose);
  for (let detail = 0; detail < detailBars; detail += 1) {
    const markX = -5 + detail * Math.max(2, Math.floor(10 / detailBars));
    spriteRect(context, bodyX, ground, px, markX, -14 + bob, 1, 3, colors.spark);
  }
  drawInvaderClaws(
    context,
    bodyX,
    ground,
    px,
    -16 + bob,
    shellWidth - 1,
    2 + Math.round(actor.range * 2),
    colors,
    pose,
  );
  drawInvaderFeet(context, x, ground, px, [-6, 0, 6], colors, pose);
  if (pose.sounding && actor.audibleGate > 0.08) {
    const beam = 1 + Math.round(actor.detail * 2);
    const scannerOffset = Math.round(pose.turn * (1 + actor.range * 2));
    for (let index = 0; index < beam; index += 1) {
      spriteRect(
        context,
        bodyX,
        ground,
        px,
        scannerOffset - Math.floor(beam / 2) + index,
        -9 + bob + index % 2,
        1,
        2,
        colors.spark,
      );
    }
  }
}

function drawDetailedRunner(context, actor, x, ground, unit, colors, pose, grow) {
  const px = unit * 0.5;
  const bob = pose.bob;
  const bodyX = x + pose.lean * px;
  const fin = 2 + Math.round(actor.shape * 3);
  const exhaust = 1 + Math.round(actor.detail * 3);
  drawInvaderAntennae(context, bodyX, ground, px, -27 + bob, 3, 5, colors, pose);
  spriteRect(context, bodyX, ground, px, -2, -30 + bob, 4, 2, colors.spark);
  spriteRect(context, bodyX, ground, px, -5, -28 + bob, 10, 3, colors.outline);
  spriteRect(context, bodyX, ground, px, -8, -25 + bob, 16, 4, colors.outline);
  spriteRect(context, bodyX, ground, px, -10, -21 + bob, 20, 9 + grow, colors.outline);
  spriteRect(context, bodyX, ground, px, -9, -20 + bob, 18, 6 + grow, colors.body);
  spriteRect(context, bodyX, ground, px, -6, -24 + bob, 12, 10, colors.mid);
  spriteRect(context, bodyX, ground, px, -4, -23 + bob, 8, 2, colors.highlight);
  drawPixelEyes(context, bodyX, ground, px, -19 + bob, colors, pose);
  for (const side of [-1, 1]) {
    const finX = side < 0 ? -10 - fin : 10;
    const counterLift = pose.wing + side * pose.turn * 0.6;
    spriteRect(context, bodyX, ground, px, finX, -20 + bob + counterLift, fin, 3, colors.highlight);
    spriteRect(context, bodyX, ground, px, finX + (side < 0 ? 1 : 0), -16 + bob - counterLift, fin, 2, colors.body);
  }
  drawInvaderFeet(context, x, ground, px, [-7, -2, 3, 8], colors, pose, 3);
  const scarfLength = 3 + Math.round(actor.detail * 3);
  if (pose.sounding && actor.audibleGate > 0.08) {
    const trailDirection = pose.turn > 0.05 ? -1 : pose.turn < -0.05 ? 1 : -1;
    const trailLift = Math.round(pose.feet * 0.65);
    for (let tail = 0; tail < Math.min(scarfLength, exhaust + 3); tail += 1) {
      spriteRect(
        context,
        bodyX,
        ground,
        px,
        trailDirection * (3 + tail) - (trailDirection < 0 ? 2 : 0),
        -8 + trailLift + Math.round(tail * 0.25),
        2,
        1,
        tail & 1 ? colors.spark : colors.highlight,
      );
    }
  } else {
    spriteRect(
      context,
      bodyX,
      ground,
      px,
      -2,
      -9,
      2,
      2,
      colors.shadow,
    );
  }
}

function drawDetailedMonster(context, actor, x, ground, unit, colors, pose, grow) {
  const px = unit * 0.5;
  const squat = pose.animated ? Math.max(0, pose.squat) : 0;
  const bob = pose.bob + Math.round(squat * 1.25);
  const plantedSpread = Math.round(squat * 0.7);
  const reach = 2 + Math.round(actor.range * 2);
  const hornHeight = 3 + Math.round(actor.range * 4);
  spriteRect(context, x, ground, px, -9 - plantedSpread, -29 - hornHeight + bob, 3, hornHeight + 3, colors.outline);
  spriteRect(context, x, ground, px, -8 - plantedSpread, -29 - hornHeight + bob, 1, hornHeight + 1, colors.highlight);
  spriteRect(context, x, ground, px, 6 + plantedSpread, -29 - hornHeight + bob, 3, hornHeight + 3, colors.outline);
  spriteRect(context, x, ground, px, 7 + plantedSpread, -29 - hornHeight + bob, 1, hornHeight + 1, colors.highlight);
  drawPixelHair(context, x, ground + bob * px, px, [
    [-8, -31, 4], [-5, -33, 5], [-2, -35, 6], [1, -35, 6], [4, -33, 5], [7, -31, 4],
  ], colors.mid, pose.sounding ? Math.round(actor.onset * 1.5) : 0);
  spriteRect(context, x, ground, px, -11, -30 + bob, 22, 5, colors.outline);
  spriteRect(context, x, ground, px, -13 - plantedSpread, -25 + bob, 26 + plantedSpread * 2, 13 + grow, colors.outline);
  spriteRect(context, x, ground, px, -12 - plantedSpread, -24 + bob, 24 + plantedSpread * 2, 10 + grow, colors.body);
  spriteRect(context, x, ground, px, -10 - plantedSpread, -23 + bob, 20 + plantedSpread * 2, 3, colors.highlight);
  spriteRect(context, x, ground, px, -9, -15 + bob, 18, 7 + grow, colors.mid);
  drawPixelEyes(context, x, ground, px, -20 + bob, colors, pose, true);
  spriteRect(context, x, ground, px, -10, -24 + bob, 6, 2, colors.shadow);
  spriteRect(context, x, ground, px, 4, -24 + bob, 6, 2, colors.shadow);
  const snoutWidth = 7 + Math.round(actor.detail * 7);
  spriteRect(context, x, ground, px, -Math.floor(snoutWidth / 2), -17 + bob, snoutWidth, 4, colors.highlight);
  spriteRect(context, x, ground, px, -3, -16 + bob, 2, 1, colors.outline);
  spriteRect(context, x, ground, px, 2, -16 + bob, 2, 1, colors.outline);
  const jaw = !pose.sounding ? 0 : 2 + Math.round(actor.audibleGate * 5);
  if (jaw > 0) {
    spriteRect(context, x, ground, px, -7, -13 + bob, 14, jaw, colors.outline);
    const toothCount = 2 + Math.round(actor.detail * 4);
    for (let tooth = 0; tooth < toothCount; tooth += 1) {
      const toothX = -6 + Math.round(tooth * 11 / Math.max(1, toothCount - 1));
      spriteRect(context, x, ground, px, toothX, -12 + bob, 1, 2, "#fff3c9");
    }
    if (jaw >= 5) spriteRect(context, x, ground, px, -3, -9 + bob, 6, 2, "#ff65bd");
  }
  const spots = 2 + Math.round(actor.shape * 4);
  for (let spot = 0; spot < spots; spot += 1) {
    spriteRect(
      context,
      x,
      ground,
      px,
      -7 + (spot * 5) % 13,
      -10 + bob + (spot & 1) * 3,
      2,
      2,
      spot & 1 ? colors.shadow : colors.highlight,
    );
  }
  drawInvaderClaws(context, x, ground, px, -14 + bob, 11, reach, colors, pose);
  drawInvaderFeet(context, x, ground, px, [-9, -3, 3, 9], colors, pose, 5, 0.45);
  if (pose.sounding && actor.onset > 0.12) {
    spriteRect(context, x, ground, px, -13, -1, 4, 1, colors.spark);
    spriteRect(context, x, ground, px, 9, -1, 4, 1, colors.spark);
    spriteRect(context, x, ground, px, -15, -3, 2, 1, colors.highlight);
    spriteRect(context, x, ground, px, 13, -3, 2, 1, colors.highlight);
  }
}

function drawDetailedHero(context, actor, x, ground, unit, colors, pose, grow) {
  const px = unit * 0.5;
  const bodyX = x + pose.lean * px;
  const bob = pose.bob + Math.max(0, pose.squat) * 0.7;
  const capeReach = 2 + Math.round(actor.range * 2);
  const crownHeight = 3 + Math.round(actor.detail * 3);
  spriteRect(context, bodyX, ground, px, -2, -30 - crownHeight + bob, 4, crownHeight + 2, colors.spark);
  spriteRect(context, bodyX, ground, px, -7, -29 + bob, 3, 5, colors.outline);
  spriteRect(context, bodyX, ground, px, 4, -29 + bob, 3, 5, colors.outline);
  spriteRect(context, bodyX, ground, px, -10, -25 + bob, 20, 5, colors.outline);
  spriteRect(context, bodyX, ground, px, -12, -20 + bob, 24, 10 + grow, colors.outline);
  spriteRect(context, bodyX, ground, px, -11, -19 + bob, 22, 7 + grow, colors.body);
  spriteRect(context, bodyX, ground, px, -7, -24 + bob, 14, 12, colors.mid);
  spriteRect(context, bodyX, ground, px, -4, -23 + bob, 8, 3, colors.highlight);
  drawPixelEyes(context, bodyX, ground, px, -18 + bob, colors, pose);
  spriteRect(context, bodyX, ground, px, -5, -13 + bob, 10, 3, colors.highlight);
  for (const side of [-1, 1]) {
    const flourish = Math.max(0, pose.reach + side * pose.turn);
    const sideReach = capeReach + Math.round(flourish);
    const capeX = side < 0 ? -12 - sideReach : 12;
    const capeLift = pose.wing + side * pose.turn;
    spriteRect(context, bodyX, ground, px, capeX, -20 + bob + capeLift, sideReach, 4, colors.mid);
    spriteRect(context, bodyX, ground, px, capeX + (side < 0 ? 1 : 0), -15 + bob - capeLift, sideReach, 3, colors.shadow);
    spriteRect(context, bodyX, ground, px, side * 10 - (side < 0 ? 2 : 0), -13 + bob - flourish * 0.4, 2, 5, colors.spark);
  }
  const bladeStart = [0, -10 + bob];
  const bladeLength = 4 + actor.range * 3 + pose.reach;
  const bladeEnd = [
    pose.turn * bladeLength,
    -14 + bob - Math.max(0, pose.reach) * 1.6,
  ];
  drawPixelSegment(context, bodyX, ground, px, bladeStart, bladeEnd, colors.highlight, 2);
  spriteRect(context, bodyX, ground, px, -3, -11 + bob, 6, 2, colors.spark);
  drawInvaderFeet(context, x, ground, px, [-8, -3, 3, 8], colors, pose, 4);
}

function drawDetailedSprite(context, actor, x, ground, unit, colors, pose, grow) {
  const px = unit * 0.5;
  const bob = pose.bob;
  const bodyX = x + pose.turn * px * 0.8;
  const wingReach = 4 + Math.round(actor.shape * 3);
  const wingLift = pose.animated ? pose.wing * 2 : 0;
  drawInvaderAntennae(context, bodyX, ground, px, -27 + bob, 4, 5, colors, pose);
  spriteRect(context, bodyX, ground, px, -5, -28 + bob, 10, 3, colors.outline);
  spriteRect(context, bodyX, ground, px, -8, -25 + bob, 16, 12 + grow, colors.outline);
  spriteRect(context, bodyX, ground, px, -7, -24 + bob, 14, 9 + grow, colors.body);
  spriteRect(context, bodyX, ground, px, -4, -23 + bob, 8, 3, colors.highlight);
  drawPixelEyes(context, bodyX, ground, px, -19 + bob, colors, pose);
  for (const side of [-1, 1]) {
    const fan = Math.max(0, pose.reach + side * pose.turn * 0.65);
    const sideReach = wingReach + Math.round(fan);
    const sideLift = wingLift + side * pose.turn;
    const wingX = side < 0 ? -8 - sideReach : 8;
    spriteRect(context, bodyX, ground, px, wingX, -24 + bob - sideLift, sideReach, 4, colors.highlight);
    spriteRect(context, bodyX, ground, px, wingX + (side < 0 ? 1 : 0), -19 + bob - side * pose.turn, sideReach, 4, colors.mid);
    spriteRect(context, bodyX, ground, px, wingX, -14 + bob + sideLift, sideReach, 3, colors.body);
  }
  spriteRect(context, bodyX, ground, px, -5, -14 + bob, 10, 4, colors.mid);
  drawInvaderFeet(context, x, ground, px, [-6, -2, 2, 6], colors, pose, 3);
  if (pose.sounding && actor.audibleGate > 0.08) {
    const orbiters = 2 + Math.round(actor.range * 3) + Math.round(actor.detail * 2);
    for (let orbiter = 0; orbiter < orbiters; orbiter += 1) {
      const angle = (pose.spin + orbiter * 8 / orbiters) * Math.PI / 4;
      const orbitRadius = 10 + Math.min(3, orbiter) + Math.max(0, pose.reach);
      spriteRect(
        context,
        bodyX,
        ground,
        px,
        Math.round(Math.cos(angle) * orbitRadius),
        -18 + bob + Math.round(Math.sin(angle) * (4 + (orbiter & 1))),
        1,
        1,
        colors.spark,
      );
    }
  }
}

function drawEchoSilhouette(context, actor, x, ground, unit, colors, reducedMotion) {
  const px = unit * 0.5;
  const pose = detailedActorPose(actor, reducedMotion);
  const halfWidth = actor.key === "bass" ? 11 : actor.key === "lead" ? 10 : 8;
  const top = actor.key === "bass" ? -29 : -27;
  spriteRect(context, x, ground, px, -4, top - 2, 8, 2, colors.highlight);
  spriteRect(context, x, ground, px, -halfWidth + 3, top, (halfWidth - 3) * 2, 3, colors.body);
  spriteRect(context, x, ground, px, -halfWidth, top + 3, halfWidth * 2, 12, colors.mid);
  spriteRect(context, x, ground, px, -halfWidth + 3, top + 15, (halfWidth - 3) * 2, 5, colors.body);
  drawInvaderFeet(context, x, ground, px, [-6, 0, 6], colors, pose, 3);
}

function drawPixelActor(
  context,
  actor,
  index,
  x,
  ground,
  unit,
  alpha,
  reducedMotion,
  showState = true,
) {
  const colors = actorColors(actor, index);
  const grow = Math.round(actor.levelUnit * 2);
  const pose = detailedActorPose(actor, reducedMotion);
  const actorGround = ground;
  context.save();
  context.globalAlpha = alpha;
  const shadowWidth = (8 + Math.round(actor.size * 3) - pose.compression) * unit;
  pixelRect(context, x - shadowWidth / 2, ground + unit, shadowWidth, unit, colors.shadow);
  if (!showState) {
    drawEchoSilhouette(context, actor, x, actorGround, unit, colors, true);
    context.restore();
    return;
  }
  if (actor.key === "upperOne") {
    drawDetailedScout(context, actor, x, actorGround, unit, colors, pose, grow);
  } else if (actor.key === "upperTwo") {
    drawDetailedRunner(context, actor, x, actorGround, unit, colors, pose, grow);
  } else if (actor.key === "bass") {
    drawDetailedMonster(context, actor, x, actorGround, unit, colors, pose, grow);
  } else if (actor.key === "lead") {
    drawDetailedHero(context, actor, x, actorGround, unit, colors, pose, grow);
  } else {
    drawDetailedSprite(context, actor, x, actorGround, unit, colors, pose, grow);
  }
  if (pose.animated && actor.onset > 0.18) {
    const accents = 1 + Math.round(actor.range * 2);
    for (let accent = 0; accent < accents; accent += 1) {
      const side = (accent + index) & 1 ? 1 : -1;
      pixelRect(
        context,
        x + side * (4 + accent) * unit,
        actorGround - (7 + accent * 2) * unit,
        Math.max(1, unit * 0.5),
        Math.max(1, unit * 0.5),
        colors.spark,
      );
    }
  }
  if (actor.resting) {
    drawRestGlyph(context, x + 3 * unit, actorGround - 12 * unit, unit, colors.highlight);
  }
  context.restore();
}

function drawArcadeBayBackplane(context, bay, actor, index, height, floor, unit) {
  const colors = actorColors(actor, index);
  const top = Math.max(2, Math.floor(height * 0.12));
  const bottom = height - 2;
  const inset = 1;
  context.save();
  context.globalAlpha = 0.055 + actor.levelUnit * 0.025;
  context.fillStyle = colors.body;
  context.fillRect(
    bay.left + inset,
    top,
    Math.max(1, bay.width - inset * 2),
    Math.max(1, bottom - top),
  );
  context.globalAlpha = 0.09;
  pixelRect(context, bay.center, top + 3, 1, Math.max(1, floor - top - 3), colors.highlight);
  const beamStep = Math.max(3, Math.round(unit * 1.5));
  for (let beamY = top + beamStep; beamY < floor; beamY += beamStep) {
    const beamInset = 2 + Math.floor((beamY - top) / Math.max(1, beamStep)) % 2;
    pixelRect(
      context,
      bay.left + beamInset,
      beamY,
      Math.max(1, bay.width - beamInset * 2),
      1,
      colors.shadow,
    );
  }
  context.restore();
}

function drawArcadeBayFrame(context, bay, actor, index, height, floor, unit) {
  const colors = actorColors(actor, index);
  const top = Math.max(2, Math.floor(height * 0.12));
  const bottom = height - 2;
  const labelBand = Math.max(6, Math.min(10, Math.round(height * 0.09)));
  const badgeUnit = Math.max(1, Math.round(unit * 0.42));
  const lampSize = Math.max(1, Math.round(unit * 0.7));
  context.save();
  context.globalAlpha = 0.62;
  pixelRect(context, bay.left, top, 1, bottom - top, colors.shadow);
  pixelRect(context, bay.right - 1, top, 1, bottom - top, colors.shadow);
  pixelRect(context, bay.left, top, bay.width, 1, colors.body);
  pixelRect(context, bay.left, bottom - labelBand, bay.width, 1, colors.mid);
  pixelRect(context, bay.left, bottom - 1, bay.width, 1, colors.shadow);
  context.globalAlpha = 0.92;
  pixelRect(context, bay.left + 1, top + 1, 3, 2, colors.highlight);
  pixelRect(context, bay.right - 4, top + 1, 3, 2, colors.highlight);
  context.globalAlpha = 0.22 + actor.audibleGate * 0.78;
  pixelRect(
    context,
    bay.center - Math.floor(lampSize * 0.5),
    top + 2,
    lampSize,
    lampSize,
    colors.spark,
  );
  context.globalAlpha = 0.78;
  drawStateBadge(
    context,
    actor,
    bay.center,
    top + Math.max(4, lampSize + 3),
    badgeUnit,
    colors,
  );
  pixelRect(
    context,
    bay.left + 2,
    floor + 2,
    Math.max(1, bay.width - 4),
    1 + Math.round(actor.onset),
    colors.body,
  );
  context.globalAlpha = 0.88;
  context.fillStyle = colors.highlight;
  context.font = Math.max(5, Math.min(8, Math.floor(bay.width / 7)))
    + "px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "bottom";
  context.fillText(actor.label, bay.center, bottom - 1);
  context.restore();
}

function drawPercussionStage(context, snapshot, width, horizon, floor, unit, reducedMotion) {
  const sparkSize = Math.max(1, Math.round(unit * 0.24));
  const center = Math.round(width * 0.5);
  if (reducedMotion) {
    const levels = [
      snapshot.drums.kick,
      snapshot.drums.snare,
      Math.max(snapshot.drums.hatA, snapshot.drums.hatB),
      snapshot.drums.shaker,
    ];
    const colors = ["#f4c95d", "#ff65bd", "#53f6ff", "#fff0a8"];
    for (let index = 0; index < levels.length; index += 1) {
      context.globalAlpha = 0.18 + levels[index] * 0.82;
      pixelRect(
        context,
        center + (index * 3 - 5) * unit,
        horizon - 2 * unit,
        2 * unit,
        unit,
        colors[index],
      );
    }
    context.globalAlpha = 1;
    return;
  }
  const motionScale = 1;
  const kick = snapshot.drums.kick * motionScale;
  const kickBands = Math.round(kick * 4);
  for (let band = 0; band < kickBands; band += 1) {
    const reach = Math.round((3 + band * 3 + (1 - kick) * 4) * unit);
    const widthUnits = (2 + band) * unit;
    const color = "rgba(244,201,93," + (0.22 + kick * 0.62) + ")";
    pixelRect(context, center - reach - widthUnits, floor + band, widthUnits, sparkSize, color);
    pixelRect(context, center + reach, floor + band, widthUnits, sparkSize, color);
  }

  const snareBlocks = Math.round(snapshot.drums.snare * motionScale * 14);
  const snareFrame = snapshot.drumSteps.snare.cellIndex * 11
    + Math.floor(snapshot.drumSteps.snare.stepPhase * 8);
  for (let block = 0; block < snareBlocks; block += 1) {
    const seed = snareFrame * 37 + block * 17 + 41;
    const spread = 0.15 + deterministicPixel(seed + 2) * 0.7;
    const x = Math.floor(width * spread);
    const y = Math.max(
      1,
      floor - unit * (2 + Math.floor(deterministicPixel(seed + 7) * 10)),
    );
    const size = sparkSize * (1 + (block % 3 === 0 ? 1 : 0));
    pixelRect(context, x, y, size, sparkSize, block & 1 ? "#ff65bd" : "#ffd2ec");
  }

  const hatLevel = (snapshot.drums.hatA + snapshot.drums.hatB) * motionScale;
  const hatSparks = Math.round(hatLevel * 12);
  const hatFrame = snapshot.drumSteps.hats.cellIndex * 13
    + Math.floor(snapshot.drumSteps.hats.stepPhase * 8);
  for (let spark = 0; spark < hatSparks; spark += 1) {
    const seed = hatFrame * 29 + spark * 7 + 73;
    const x = Math.floor(deterministicPixel(seed) * width);
    const y = 1 + Math.floor(deterministicPixel(seed + 5) * Math.max(2, horizon * 0.7));
    const streak = spark % 3 === 0 ? sparkSize * 3 : sparkSize;
    pixelRect(context, x, y, streak, sparkSize, spark & 1 ? "#53f6ff" : "#d8ffff");
  }

  const shaker = Math.round(snapshot.drums.shaker * motionScale * 8);
  const shakerFrame = snapshot.drumSteps.shaker.cellIndex
    + Math.floor(snapshot.drumSteps.shaker.stepPhase * 8);
  for (let edge = 0; edge < shaker; edge += 1) {
    const left = (edge + shakerFrame) & 1;
    const y = horizon + ((edge * 5 + shakerFrame * 3) % Math.max(1, floor - horizon));
    pixelRect(context, left ? 1 : width - 1 - sparkSize, y, sparkSize, sparkSize, "#f4c95d");
    if (edge % 3 === 0) {
      pixelRect(context, left ? width - 1 - sparkSize : 1, y + unit, sparkSize, sparkSize, "#fff0a8");
    }
  }
}

function drawCharacterStage(time) {
  const canvas = $("characterStage");
  const context = canvas.getContext("2d");
  const { width, height, pixelScale, cssWidth } = resizeCharacterCanvas(canvas);
  const snapshot = webGpuChiptuneStageSnapshot(time, state.params, state.sequence);
  const reducedMotion = Boolean(reducedMotionQuery?.matches);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#04080d";
  context.fillRect(0, 0, width, height);

  const horizon = Math.max(8, Math.floor(height * 0.36));
  pixelRect(context, 0, horizon, width, 1, "rgba(83,246,255,0.16)");
  for (let x = 0; x < width; x += Math.max(12, Math.floor(width / 24))) {
    pixelRect(context, x, horizon, 1, height - horizon, "rgba(83,246,255,0.035)");
  }
  const textureRows = 1 + Math.round(snapshot.environment.texture * 4);
  for (let row = 0; row < textureRows; row += 1) {
    const phase = reducedMotion
      ? (row + 1) / (textureRows + 1)
      : positiveModulo(
        snapshot.masterBeat * (0.04 + snapshot.environment.texture * 0.12)
          + row / textureRows,
        1,
      );
    const y = Math.max(1, Math.floor(phase * Math.max(2, horizon - 2)));
    pixelRect(
      context,
      0,
      y,
      width,
      1,
      "rgba(115,99,255," + (0.025 + snapshot.environment.texture * 0.055) + ")",
    );
  }
  const particleCount = Math.round(5 + snapshot.environment.noise * 18);
  for (let particle = 0; particle < particleCount; particle += 1) {
    const seed = state.params.patternSeed * 97 + particle * 19;
    const x = Math.floor(deterministicPixel(seed) * width);
    const y = Math.floor(deterministicPixel(seed + 7) * Math.max(1, horizon - 2));
    const brightness = 0.12 + deterministicPixel(seed + 13) * 0.28;
    pixelRect(context, x, y, 1, 1, "rgba(216,231,231," + brightness + ")");
  }

  const bays = webGpuChiptuneCharacterBayLayout(width, snapshot.actors.length);
  const narrowestBay = Math.min(...bays.map((bay) => bay.width));
  const desiredCssUnit = cssWidth > 980 ? 24 : cssWidth > 620 ? 16 : 8;
  const desiredUnit = Math.max(1, Math.round(desiredCssUnit / pixelScale));
  const bayTop = Math.max(2, Math.floor(height * 0.12));
  const baseline = Math.round(height * 0.78);
  const widthBudget = cssWidth <= 620 ? 22 : 20;
  const heightBudget = cssWidth <= 620 ? 21 : 19;
  const widthFit = Math.max(1, (narrowestBay - 2) / widthBudget);
  const heightFit = Math.max(1, (baseline - bayTop) / heightBudget);
  const unit = Math.max(1, Math.min(desiredUnit, widthFit, heightFit));
  const floor = baseline;
  snapshot.actors.forEach((actor, index) => {
    drawArcadeBayBackplane(context, bays[index], actor, index, height, floor, unit);
  });
  drawPercussionStage(context, snapshot, width, horizon, floor, unit, reducedMotion);
  const trails = reducedMotion
    ? 0
    : Math.min(3, Math.round(
      snapshot.environment.echo
        * snapshot.environment.echoDecay
        * snapshot.environment.echoTaps * 0.5,
    ));
  snapshot.actors.forEach((actor, index) => {
    const bay = bays[index];
    const pose = detailedActorPose(actor, reducedMotion);
    const marchDistance = pose.animated
      ? pose.march * unit * actor.motion * 0.8
      : 0;
    const center = bay.center + marchDistance;
    context.save();
    context.beginPath();
    context.rect(
      bay.left + 1,
      1,
      Math.max(1, bay.width - 2),
      Math.max(1, height - 2),
    );
    context.clip();
    for (let trail = trails; trail >= 1; trail -= 1) {
      const direction = index & 1 ? 1 : -1;
      drawPixelActor(
        context,
        actor,
        index,
        center + direction * trail * Math.max(
          1,
          Math.round(unit * (0.32 + snapshot.environment.stereo * 0.36)),
        ),
        floor + trail % 2,
        unit,
        (0.05 + snapshot.environment.echoDecay * 0.14) / Math.max(1, trail * 0.72),
        true,
        false,
      );
    }
    drawPixelActor(context, actor, index, center, floor, unit, 0.68 + actor.levelUnit * 0.32, reducedMotion);
    context.restore();
  });
  snapshot.actors.forEach((actor, index) => {
    drawArcadeBayFrame(context, bays[index], actor, index, height, floor, unit);
  });
}

function draw() {
  if (state.disposed) return;
  const canvas = $("stage");
  const context = canvas.getContext("2d");
  const { width, height, pixelRatio } = resizeCanvas(canvas);
  const time = transportTime();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawCharacterStage(time);
  drawBackground(context, width, height);
  if (state.trackerView === "sequence") drawSequenceEditor(context, width, height, time);
  else drawMorphTracker(context, width, height, time);
  syncSequencePlayhead(time);
  animationFrame = requestAnimationFrame(draw);
}

function editStageFromPointer(event) {
  const canvas = $("stage");
  const rect = canvas.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const y = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  const [seedMin, seedMax] = WEBGPU_CHIPTUNE_LIMITS.patternSeed;
  const [rangeMin, rangeMax] = WEBGPU_CHIPTUNE_LIMITS.pitchRange;
  applyParams({
    ...state.params,
    patternSeed: seedMin + x * (seedMax - seedMin),
    pitchRange: rangeMax - y * (rangeMax - rangeMin),
  });
}

function sequencePointFromPointer(event, lockedLane = null) {
  const canvas = $("stage");
  const rect = canvas.getBoundingClientRect();
  const metrics = sequenceEditorMetrics(rect.width, rect.height);
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  if (!lockedLane && localY >= metrics.overview.top && localY < metrics.overview.bottom) {
    const overviewRow = metrics.overview.rows.find(
      ({ top, height }) => localY >= top && localY < top + height,
    );
    if (!overviewRow) return null;
    const boundedX = clamp(
      localX,
      metrics.overview.left,
      metrics.overview.left + metrics.overview.width - 0.001,
    );
    const step = Math.floor(
      (boundedX - metrics.overview.left) / metrics.overview.cellWidth,
    );
    return Object.freeze({
      lane: overviewRow.definition.key,
      step,
      value: 0,
      overview: true,
      gutter: localX < metrics.overview.left,
    });
  }
  const row = metrics.row;
  if (!lockedLane && (localY < row.top || localY >= row.top + row.height)) return null;
  const lane = lockedLane ?? row.definition.key;
  if (!lockedLane && localX < metrics.left) return Object.freeze({ lane, gutter: true });
  const boundedX = clamp(localX, metrics.left, metrics.left + metrics.width - 0.001);
  const stepOffset = Math.floor((boundedX - metrics.left) / metrics.cellWidth);
  const step = Math.round(clamp(
    metrics.startStep + stepOffset,
    metrics.startStep,
    metrics.startStep + metrics.stepCount - 1,
  ));
  return Object.freeze({
    lane,
    step,
    value: sequenceValueForY(lane, clamp(localY, row.top, row.top + row.height), row),
    gutter: false,
    overview: false,
  });
}

function paintSequencePoint(point, previous = point) {
  const next = paintWebGpuChiptuneSequenceSegment(
    state.sequence,
    point.lane,
    previous.step,
    point.step,
    previous.value,
    point.value,
    state.sequenceEditMode,
  );
  state.activeSequenceLane = point.lane;
  if (WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES.includes(point.lane)) {
    lastVoiceSequenceLane = point.lane;
  }
  state.activeSequenceStep = point.step;
  state.sequencePage = sequencePageForStep(point.step);
  applySequence(next, { notify: false });
  requestSequenceAudition(point.lane, state.sequenceEditMode, point.value);
}

function stagePointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  $("stage").focus({ preventScroll: true });
  if (state.trackerView === "sequence") {
    const point = sequencePointFromPointer(event);
    if (!point) return;
    if (point.overview) {
      state.sequenceFollowLive = false;
      state.activeSequenceLane = point.lane;
      if (WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES.includes(point.lane)) {
        lastVoiceSequenceLane = point.lane;
      }
      state.activeSequenceStep = point.step;
      state.sequencePage = sequencePageForStep(point.step);
      syncSequenceControls();
      announce(
        activeSequenceDefinition().label
          + " step "
          + (point.step + 1)
          + " locked from the all-clock overview.",
      );
      return;
    }
    if (point.gutter) {
      selectSequenceLane(point.lane);
      announce(activeSequenceDefinition().label + " selected.");
      return;
    }
    state.sequenceFollowLive = false;
    const originalSequence = state.sequence;
    const originalPresetId = state.presetId;
    activeSequenceDrag = {
      pointerId: event.pointerId,
      lane: point.lane,
      lastPoint: point,
      originalSequence,
      originalPresetId,
    };
    $("stage").setPointerCapture?.(event.pointerId);
    paintSequencePoint(point);
    return;
  }
  state.editingStage = true;
  $("stage").setPointerCapture?.(event.pointerId);
  editStageFromPointer(event);
}

function stagePointerMove(event) {
  if (activeSequenceDrag?.pointerId === event.pointerId) {
    event.preventDefault();
    const point = sequencePointFromPointer(event, activeSequenceDrag.lane);
    if (!point) return;
    if (
      point.step === activeSequenceDrag.lastPoint.step
      && point.value === activeSequenceDrag.lastPoint.value
    ) return;
    paintSequencePoint(point, activeSequenceDrag.lastPoint);
    activeSequenceDrag.lastPoint = point;
    return;
  }
  if (!state.editingStage) return;
  event.preventDefault();
  editStageFromPointer(event);
}

function stagePointerEnd(event) {
  if (activeSequenceDrag?.pointerId === event.pointerId) {
    event.preventDefault();
    const drag = activeSequenceDrag;
    activeSequenceDrag = null;
    $("stage").releasePointerCapture?.(event.pointerId);
    notifyWaxState();
    const cell = state.sequence.lanes[drag.lane].cells[state.activeSequenceStep];
    announce(describeSequenceCell(
      drag.lane,
      state.activeSequenceStep,
      cell,
      state.sequence.lanes[drag.lane].activeLength,
    ) + ". Live shader sequence updated; voice notes use the same WGSL path for preview.");
    return;
  }
  if (!state.editingStage) return;
  state.editingStage = false;
  $("stage").releasePointerCapture?.(event.pointerId);
  announce(
    "Pattern seed " + state.params.patternSeed.toFixed(3)
      + ", pitch range " + state.params.pitchRange.toFixed(2) + ".",
  );
}

function stagePointerCancel(event) {
  if (activeSequenceDrag?.pointerId === event.pointerId) {
    event.preventDefault();
    const drag = activeSequenceDrag;
    activeSequenceDrag = null;
    $("stage").releasePointerCapture?.(event.pointerId);
    applySequence(drag.originalSequence, {
      markCustom: false,
      presetId: drag.originalPresetId,
    });
    announce("Sequence paint cancelled; the previous performance was restored.");
    return;
  }
  stagePointerEnd(event);
}

function sequenceStageKeyDown(event) {
  const laneIndex = sequenceLaneDefinitions.findIndex(
    ({ key }) => key === state.activeSequenceLane,
  );
  const lowerKey = event.key.toLowerCase();
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    selectSequenceStep(
      state.activeSequenceStep + (event.key === "ArrowRight" ? 1 : -1),
    );
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    event.stopPropagation();
    nudgeSequenceCell(
      state.activeSequenceStep,
      event.key === "ArrowUp" ? 1 : -1,
      { octave: event.shiftKey },
    );
  } else if (event.key === "PageUp" || event.key === "PageDown") {
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "PageDown" ? 1 : -1;
    const nextIndex = positiveModulo(laneIndex + direction, sequenceLaneDefinitions.length);
    selectSequenceLane(sequenceLaneDefinitions[nextIndex].key);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    event.stopPropagation();
    selectSequenceStep(event.key === "Home" ? 0 : WEBGPU_CHIPTUNE_SEQUENCE_STEPS - 1);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    event.stopPropagation();
    cycleSequenceCell(state.activeSequenceStep);
  } else if (lowerKey === "a" || event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    event.stopPropagation();
    setSequencePaintMode("auto", { quiet: true });
    setSequenceCell(state.activeSequenceStep, "auto");
  } else if (lowerKey === "n" || lowerKey === "h") {
    event.preventDefault();
    event.stopPropagation();
    setSequencePaintMode("note", { quiet: true });
    setSequenceCell(state.activeSequenceStep, "note");
  } else if (lowerKey === "r" || lowerKey === "o") {
    event.preventDefault();
    event.stopPropagation();
    setSequencePaintMode("rest", { quiet: true });
    setSequenceCell(state.activeSequenceStep, "rest");
  }
}

function stageKeyDown(event) {
  if (state.trackerView === "sequence") {
    sequenceStageKeyDown(event);
    return;
  }
  const seedSpec = controlSpecsByKey.get("patternSeed");
  const rangeSpec = controlSpecsByKey.get("pitchRange");
  const multiplier = event.shiftKey ? 5 : 1;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    applyControlValue(seedSpec, state.params.patternSeed - 0.04 * multiplier);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    applyControlValue(seedSpec, state.params.patternSeed + 0.04 * multiplier);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    applyControlValue(rangeSpec, state.params.pitchRange + 0.02 * multiplier);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    applyControlValue(rangeSpec, state.params.pitchRange - 0.02 * multiplier);
  } else if (event.key === "Home") {
    event.preventDefault();
    applyParams({
      ...state.params,
      patternSeed: WEBGPU_CHIPTUNE_DEFAULTS.patternSeed,
      pitchRange: WEBGPU_CHIPTUNE_DEFAULTS.pitchRange,
    });
  } else {
    return;
  }
  announce(
    "Pattern seed " + state.params.patternSeed.toFixed(3)
      + ", pitch range " + state.params.pitchRange.toFixed(2) + ".",
  );
}

function pageKeyDown(event) {
  if (
    event.defaultPrevented
    || event.code !== "Space"
    || event.repeat
    || event.altKey
    || event.ctrlKey
    || event.metaKey
  ) return;
  const interactive = event.target?.closest?.(
    "input, select, textarea, button, a, summary, [contenteditable='true'], [role='slider'], [role='application']",
  );
  if (interactive) return;
  event.preventDefault();
  void toggleSynthPlay();
}

function registerWaxHostAdapter() {
  const wax = globalThis.MorphazoidWAX;
  if (!wax || typeof wax.register !== "function") return;
  try {
    wax.register({
      id: "webgpu-chiptune",
      stateVersion: 3,
      getState() {
        return {
          parameters: { ...state.params },
          activePresetId: state.presetId,
          sequence: state.sequence,
        };
      },
      applyState(snapshot) {
        if (!snapshot || typeof snapshot !== "object") return;
        const presetId = typeof snapshot.activePresetId === "string"
          && presets.some(({ id }) => id === snapshot.activePresetId)
          ? snapshot.activePresetId
          : "custom";
        if (snapshot.parameters && typeof snapshot.parameters === "object") {
          applyParams({
            ...WEBGPU_CHIPTUNE_DEFAULTS,
            ...snapshot.parameters,
          }, presetId, { notify: false });
        }
        applySequence(
          snapshot.sequence && typeof snapshot.sequence === "object"
            ? snapshot.sequence
            : WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
          { notify: false, markCustom: false, presetId },
        );
      },
      subscribeState(listener) {
        waxStateListener = typeof listener === "function" ? listener : null;
        return () => {
          if (waxStateListener === listener) waxStateListener = null;
        };
      },
    });
  } catch (error) {
    console.warn("WebGPU Chiptune WAX registration failed.", error);
  }
}

renderControls();
renderSequenceControls();
setTrackerView("sequence", { quiet: true });
setRuntimeState();
setSupportState();
setSynthPlayButtonState();
outputChanged();
clearError();
registerWaxHostAdapter();

$("audioButton").addEventListener("click", () => {
  void toggleAudio();
});
$("synthPlayButton").addEventListener("click", () => {
  void toggleSynthPlay();
});
$("previousPreset").addEventListener("click", () => {
  cyclePreset(-1);
});
$("nextPreset").addEventListener("click", () => {
  cyclePreset(1);
});
$("output").addEventListener("input", outputChanged);
$("chunkDuration").addEventListener("input", runtimeChanged);
$("chunkDuration").addEventListener("change", () => {
  void restartAudio();
});
$("workgroupSize").addEventListener("change", () => {
  runtimeChanged();
  void restartAudio();
});
$("randomizePatch").addEventListener("click", randomizePatch);
$("mutatePatch").addEventListener("click", mutatePatch);
$("resetPatch").addEventListener("click", resetPatch);
$("stage").addEventListener("pointerdown", stagePointerDown);
$("stage").addEventListener("pointermove", stagePointerMove);
$("stage").addEventListener("pointerup", stagePointerEnd);
$("stage").addEventListener("pointercancel", stagePointerCancel);
$("stage").addEventListener("keydown", stageKeyDown);
document.addEventListener("keydown", pageKeyDown);

resizeObserver = "ResizeObserver" in globalThis
  ? new ResizeObserver(syncResponsiveLayout)
  : null;
resizeObserver?.observe($("stageWrap"));
resizeObserver?.observe($("knobControls"));
if (!resizeObserver) globalThis.addEventListener("resize", syncResponsiveLayout);

animationFrame = requestAnimationFrame(draw);

globalThis.addEventListener("pagehide", () => {
  state.disposed = true;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  resizeObserver?.disconnect();
  if (!resizeObserver) globalThis.removeEventListener("resize", syncResponsiveLayout);
  waxStateListener = null;
  void stopAudio({ quiet: true });
});

globalThis.addEventListener("pageshow", (event) => {
  if (!event.persisted || !state.disposed) return;
  state.disposed = false;
  resizeObserver?.observe($("stageWrap"));
  resizeObserver?.observe($("knobControls"));
  if (!resizeObserver) globalThis.addEventListener("resize", syncResponsiveLayout);
  setSynthPlayButtonState();
  animationFrame = requestAnimationFrame(draw);
});

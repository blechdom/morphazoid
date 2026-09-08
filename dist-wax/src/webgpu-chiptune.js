import { connectAudioOutput } from "./audio-output-manager.js";

const NUM_CHANNELS = 2;
const TIME_INFO_BUFFER_SIZE = 16;
const MAX_BUFFERED_CHUNKS = 2.5;
const SEQUENCE_META_BUFFER_SIZE = 64;
const REFRESH_CONTINUITY_SECONDS = 0.03;
const INTERACTIVE_REFRESH_DELAY_MS = 16;

export const WEBGPU_CHIPTUNE_PREVIEW_DURATION_SECONDS = 0.22;
export const WEBGPU_CHIPTUNE_SEQUENCE_STEPS = 32;
export const WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES = Object.freeze([
  "upperOne",
  "upperTwo",
  "bass",
  "lead",
  "arp",
]);
export const WEBGPU_CHIPTUNE_PERFORMANCE_LANES = Object.freeze([
  ...WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES,
  "drums",
]);

export const WEBGPU_CHIPTUNE_PERFORMANCE_AXES = Object.freeze({
  upperOne: Object.freeze({
    label: "UPPER A",
    levelKeys: Object.freeze(["upperOneLevel"]),
    x: Object.freeze({ key: "upperOneSpan", label: "SPAN" }),
    y: Object.freeze({ key: "upperOnePhase", label: "PHASE" }),
  }),
  upperTwo: Object.freeze({
    label: "UPPER B",
    levelKeys: Object.freeze(["upperTwoLevel"]),
    x: Object.freeze({ key: "upperTwoClockRatio", label: "CHASE" }),
    y: Object.freeze({ key: "upperTwoGateRateRatio", label: "CHOP" }),
  }),
  bass: Object.freeze({
    label: "BASS",
    levelKeys: Object.freeze(["bassPulseLevel", "bassSineLevel"]),
    x: Object.freeze({ key: "bassPulseWidth", label: "BODY" }),
    y: Object.freeze({ key: "bassGateRateRatio", label: "BOUNCE" }),
  }),
  lead: Object.freeze({
    label: "LEAD",
    levelKeys: Object.freeze(["leadLevel"]),
    x: Object.freeze({ key: "leadInterval", label: "INTERVAL" }),
    y: Object.freeze({ key: "leadTrillShare", label: "TRILL" }),
  }),
  arp: Object.freeze({
    label: "ARP",
    levelKeys: Object.freeze(["arpLevel"]),
    x: Object.freeze({ key: "arpSpan", label: "SPREAD" }),
    y: Object.freeze({ key: "arpGateDepth", label: "CHOP" }),
  }),
  drums: Object.freeze({
    label: "DRUMS",
    levelKeys: Object.freeze(["drumMix"]),
    x: Object.freeze({ key: "drumRate", label: "RATE" }),
    y: Object.freeze({ key: "drumDecay", label: "TAIL" }),
  }),
});

function defaultPerformanceVoice() {
  return Object.freeze({
    muted: false,
    solo: false,
    x: 0.5,
    y: 0.5,
  });
}

export const WEBGPU_CHIPTUNE_PERFORMANCE_DEFAULTS = Object.freeze(
  Object.fromEntries(WEBGPU_CHIPTUNE_PERFORMANCE_LANES.map((lane) => [
    lane,
    defaultPerformanceVoice(),
  ])),
);
export const WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES = Object.freeze([
  "kick",
  "snare",
  "hats",
  "shaker",
]);
export const WEBGPU_CHIPTUNE_SEQUENCE_LANES = Object.freeze([
  ...WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES,
  ...WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES,
]);
const WEBGPU_CHIPTUNE_PERFORMER_SEQUENCE_LANES = Object.freeze({
  upperOne: Object.freeze(["upperOne"]),
  upperTwo: Object.freeze(["upperTwo"]),
  bass: Object.freeze(["bass"]),
  lead: Object.freeze(["lead"]),
  arp: Object.freeze(["arp"]),
  drums: WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES,
});
const NO_SEQUENCE_LANES = Object.freeze([]);

export function webGpuChiptuneSequenceLanesForPerformer(performer) {
  return WEBGPU_CHIPTUNE_PERFORMER_SEQUENCE_LANES[performer] ?? NO_SEQUENCE_LANES;
}

export function webGpuChiptunePerformerForSequenceLane(lane) {
  if (WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane)) return "drums";
  return WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES.includes(lane) ? lane : null;
}

export const WEBGPU_CHIPTUNE_SEQUENCE_STATES = Object.freeze({
  auto: 0,
  note: 1,
  rest: 2,
});
export const WEBGPU_CHIPTUNE_SEQUENCE_NOTE_LIMITS = Object.freeze([-72, 72]);
export const WEBGPU_CHIPTUNE_SEQUENCE_ARP_LIMITS = Object.freeze([0, 1]);
export const WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS = Object.freeze({
  upperOne: Object.freeze({ kind: "steps", minimum: -12, maximum: 36, quantum: 1 }),
  upperTwo: Object.freeze({ kind: "steps", minimum: -12, maximum: 24, quantum: 1 }),
  bass: Object.freeze({ kind: "steps", minimum: -24, maximum: 12, quantum: 1 }),
  lead: Object.freeze({ kind: "steps", minimum: -12, maximum: 36, quantum: 1 }),
  arp: Object.freeze({ kind: "contour", minimum: 0, maximum: 1, quantum: 0.001 }),
  kick: Object.freeze({ kind: "drums", minimum: 0, maximum: 1, quantum: 1 }),
  snare: Object.freeze({ kind: "drums", minimum: 0, maximum: 1, quantum: 1 }),
  hats: Object.freeze({ kind: "drums", minimum: 0, maximum: 1, quantum: 1 }),
  shaker: Object.freeze({ kind: "drums", minimum: 0, maximum: 1, quantum: 1 }),
});

const SEQUENCE_CELL_STRIDE = 16;
const SEQUENCE_CELL_BUFFER_SIZE = WEBGPU_CHIPTUNE_SEQUENCE_LANES.length
  * WEBGPU_CHIPTUNE_SEQUENCE_STEPS
  * SEQUENCE_CELL_STRIDE;
const sequenceLaneIndex = new Map(
  WEBGPU_CHIPTUNE_SEQUENCE_LANES.map((lane, index) => [lane, index]),
);
const sequenceRateKeys = Object.freeze({
  upperOne: "pitchClock",
  upperTwo: "pitchClock",
  bass: "bassClock",
  lead: "leadClock",
  arp: "arpRate",
});
const sequencePhaseKeys = Object.freeze({
  upperOne: "upperOnePhase",
  upperTwo: "upperTwoPhase",
  bass: "bassPhase",
  lead: "leadPhase",
  arp: "arpPhase",
});

export const WEBGPU_CHIPTUNE_OUTPUT_CEILING = 0.88;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const fract = (value) => value - Math.floor(value);
const positiveModulo = (value, modulus) => ((value % modulus) + modulus) % modulus;
const finiteOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function setParamValue(param, value, time = 0) {
  if (typeof param?.setValueAtTime === "function") param.setValueAtTime(value, time);
  else if (param) param.value = value;
}

function setTarget(param, value, time = 0, constant = 0.015) {
  if (typeof param?.setTargetAtTime === "function") param.setTargetAtTime(value, time, constant);
  else setParamValue(param, value, time);
}

export const WEBGPU_CHIPTUNE_CREDIT = Object.freeze({
  sourceTitle: "Chiptune (sound)",
  creator: "srtuss",
  year: 2015,
  platform: "Shadertoy",
  shaderId: "MljSRt",
  href: "https://www.shadertoy.com/view/MljSRt",
});

// Every field below reaches the active mainSound -> s2 / beat2 signal path.
// Source functions and commented branches that mainSound never calls are not
// included merely to create inert controls.
export const WEBGPU_CHIPTUNE_PARAM_ORDER = Object.freeze([
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

const PARAM_BUFFER_SIZE = WEBGPU_CHIPTUNE_PARAM_ORDER.length * Float32Array.BYTES_PER_ELEMENT;

export const WEBGPU_CHIPTUNE_DEFAULTS = Object.freeze({
  tempo: 1.3,
  transpose: 0,
  patternSeed: 1.79425579,
  pitchRange: 1,
  gateRate: 1,
  gateLength: 1,
  pulseWidth: 0.4,
  pwmDepth: 0.25,
  pwmRate: 0.3,
  upperOneLevel: 1,
  upperTwoLevel: 1,
  bassPulseLevel: 1,
  bassSineLevel: 1,
  leadLevel: 1,
  arpLevel: 1,
  noiseLevel: 1,
  stereoWidth: 1,
  kickLevel: 1,
  snareLevel: 1,
  hatLevel: 1,
  shakerLevel: 1,
  kickTone: 1,
  snareTone: 1,
  drumDecay: 1,
  drumMix: 1,
  ghostDrums: 1,
  echoTaps: 8,
  echoTime: 0.33,
  echoDecay: 0.3,
  echoStereo: 1,
  fadeIn: 1,
  gain: 0.8,
  scaleMask: 1717,
  upperOneSpan: 20,
  upperTwoSpan: 10,
  bassSpan: 4,
  upperOneRegister: -12,
  bassRegister: -36,
  arpRegister: -12,
  sectionUnits: 32,
  pitchClock: 4,
  bassClock: 1,
  gateFastRatio: 2,
  gateSwitchShortUnits: 4,
  gateSwitchLongUnits: 16,
  leadTrillRate: 16,
  leadInterval: 7,
  leadPhraseUnits: 3,
  arpRate: 32,
  arpSpan: 8,
  arpOctaveRate: 0.5,
  arpOctaves: 3,
  bassPulseWidth: 0.4,
  drumRate: 1,
  echoCrossfeed: 0.4,
  gateAttack: 0.05,
  gateRelease: 0.4,
  texturePeriod: 8,
  textureDecay: 0.4,
  kickCycle: 2,
  kickSubcycle: 1.25,
  snareNoiseMix: 0.55555556,
  hatBalance: 0.44444444,
  ghostDelayDivisor: 6,
  ghostPan: -0.2,
  gateA0: 12547,
  gateA1: 784,
  gateA2: 8323,
  gateA3: 8754,
  gateB0: 12547,
  gateB1: 0,
  gateB2: 8323,
  gateB3: 8242,
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
});

export const WEBGPU_CHIPTUNE_LIMITS = Object.freeze({
  tempo: Object.freeze([0.25, 4]),
  transpose: Object.freeze([-24, 12]),
  patternSeed: Object.freeze([0.1, 8]),
  pitchRange: Object.freeze([0, 2]),
  gateRate: Object.freeze([0.125, 4]),
  gateLength: Object.freeze([0.05, 4]),
  pulseWidth: Object.freeze([0.05, 0.95]),
  pwmDepth: Object.freeze([0, 0.45]),
  pwmRate: Object.freeze([0.005, 8]),
  upperOneLevel: Object.freeze([0, 2]),
  upperTwoLevel: Object.freeze([0, 2]),
  bassPulseLevel: Object.freeze([0, 2]),
  bassSineLevel: Object.freeze([0, 2]),
  leadLevel: Object.freeze([0, 2]),
  arpLevel: Object.freeze([0, 2]),
  noiseLevel: Object.freeze([0, 2]),
  stereoWidth: Object.freeze([0, 2]),
  kickLevel: Object.freeze([0, 2]),
  snareLevel: Object.freeze([0, 2]),
  hatLevel: Object.freeze([0, 2]),
  shakerLevel: Object.freeze([0, 2]),
  kickTone: Object.freeze([0.125, 3]),
  snareTone: Object.freeze([0.125, 3]),
  drumDecay: Object.freeze([0.125, 8]),
  drumMix: Object.freeze([0, 1.5]),
  ghostDrums: Object.freeze([0, 1.5]),
  echoTaps: Object.freeze([1, 8]),
  echoTime: Object.freeze([0.01, 2]),
  echoDecay: Object.freeze([0, 0.88]),
  echoStereo: Object.freeze([0, 2]),
  fadeIn: Object.freeze([0.01, 16]),
  gain: Object.freeze([0, 1]),
  scaleMask: Object.freeze([1, 4095]),
  upperOneSpan: Object.freeze([1, 36]),
  upperTwoSpan: Object.freeze([1, 24]),
  bassSpan: Object.freeze([1, 12]),
  upperOneRegister: Object.freeze([-36, 12]),
  bassRegister: Object.freeze([-60, -12]),
  arpRegister: Object.freeze([-36, 12]),
  sectionUnits: Object.freeze([1, 128]),
  pitchClock: Object.freeze([0.125, 24]),
  bassClock: Object.freeze([0.0625, 12]),
  gateFastRatio: Object.freeze([0.25, 8]),
  gateSwitchShortUnits: Object.freeze([0.25, 64]),
  gateSwitchLongUnits: Object.freeze([1, 128]),
  leadTrillRate: Object.freeze([0.25, 64]),
  leadInterval: Object.freeze([-24, 24]),
  leadPhraseUnits: Object.freeze([0.25, 32]),
  arpRate: Object.freeze([0.5, 96]),
  arpSpan: Object.freeze([1, 36]),
  arpOctaveRate: Object.freeze([0.015625, 8]),
  arpOctaves: Object.freeze([0, 5]),
  bassPulseWidth: Object.freeze([0.05, 0.95]),
  drumRate: Object.freeze([0.0625, 4]),
  echoCrossfeed: Object.freeze([0, 1]),
  gateAttack: Object.freeze([0.001, 0.25]),
  gateRelease: Object.freeze([0.005, 2]),
  texturePeriod: Object.freeze([0.125, 128]),
  textureDecay: Object.freeze([0.01, 16]),
  kickCycle: Object.freeze([0.5, 16]),
  kickSubcycle: Object.freeze([0.25, 8]),
  snareNoiseMix: Object.freeze([0, 1]),
  hatBalance: Object.freeze([0, 1]),
  ghostDelayDivisor: Object.freeze([0.25, 64]),
  ghostPan: Object.freeze([-1, 1]),
  gateA0: Object.freeze([0, 65535]),
  gateA1: Object.freeze([0, 65535]),
  gateA2: Object.freeze([0, 65535]),
  gateA3: Object.freeze([0, 65535]),
  gateB0: Object.freeze([0, 65535]),
  gateB1: Object.freeze([0, 65535]),
  gateB2: Object.freeze([0, 65535]),
  gateB3: Object.freeze([0, 65535]),
  gatePatternSteps: Object.freeze([1, 32]),
  gateShortRatio: Object.freeze([0.1, 1]),
  gateLongRatio: Object.freeze([1, 8]),
  fastGateShare: Object.freeze([0, 1]),
  longGateBoostShare: Object.freeze([0, 1]),
  leadSectionShare: Object.freeze([0, 1]),
  leadTrillShare: Object.freeze([0, 1]),
  tuningCents: Object.freeze([-100, 100]),
  upperTwoRegister: Object.freeze([-36, 24]),
  leadRegister: Object.freeze([-36, 24]),
  leadClock: Object.freeze([0.125, 24]),
  leadSpan: Object.freeze([1, 36]),
  arpBassFollow: Object.freeze([0, 2]),
  voiceCrossfeed: Object.freeze([0, 1]),
  synthMix: Object.freeze([0, 2]),
  fadeCurve: Object.freeze([0.125, 16]),
  echoAlternate: Object.freeze([0, 1]),
  snareCycle: Object.freeze([0.25, 16]),
  snarePhase: Object.freeze([0, 127 / 128]),
  hatACycle: Object.freeze([0.5, 16]),
  hatASubcycle: Object.freeze([0.15625, 8]),
  hatARepeat: Object.freeze([0.0625, 4]),
  hatAPhase: Object.freeze([0, 127 / 128]),
  hatBCycle: Object.freeze([0.125, 8]),
  shakerCycle: Object.freeze([0.125, 8]),
  shakerPhase: Object.freeze([0, 127 / 128]),
  noiseRate: Object.freeze([250, 16000]),
  noiseColor: Object.freeze([0.0625, 16]),
  textureSweep: Object.freeze([0.03125, 32]),
  kickBodyPhase: Object.freeze([100, 1600]),
  kickTransientPhase: Object.freeze([0, 400]),
  kickBodySweep: Object.freeze([0.125, 8]),
  kickTransientSweep: Object.freeze([25, 400]),
  kickAttackTime: Object.freeze([0.025, 4]),
  kickDecayRate: Object.freeze([2.5, 40]),
  kickClipKnee: Object.freeze([0.05, 8]),
  snareHoldTime: Object.freeze([0, 4]),
  snareDecayRate: Object.freeze([2.5, 40]),
  snareNoiseSweep: Object.freeze([0.125, 8]),
  snareNoiseRate: Object.freeze([1, 16]),
  snareModRate: Object.freeze([25, 400]),
  snareModDepth: Object.freeze([0, 10]),
  snareCarrierRate: Object.freeze([500, 8000]),
  hatANoiseRate: Object.freeze([1, 16]),
  hatADecayRate: Object.freeze([6.25, 100]),
  hatBLowNoiseRate: Object.freeze([0.5, 8]),
  hatBHighNoiseRate: Object.freeze([25, 400]),
  hatBHighMix: Object.freeze([0, 6]),
  hatBDecayRate: Object.freeze([1, 16]),
  shakerNoiseRate: Object.freeze([2.25, 36]),
  shakerDecayRate: Object.freeze([2, 32]),
  upperTwoClockRatio: Object.freeze([0.25, 4]),
  kickPhase: Object.freeze([0, 127 / 128]),
  hatBPhase: Object.freeze([0, 127 / 128]),
  hatARepeatPhase: Object.freeze([0, 127 / 128]),
  arpPhase: Object.freeze([0, 127 / 128]),
  echoWet: Object.freeze([0, 2]),
  arpGateDepth: Object.freeze([0, 1]),
  bassGateRateRatio: Object.freeze([0.25, 4]),
  leadGateRateRatio: Object.freeze([0.25, 4]),
  upperTwoGateRateRatio: Object.freeze([0.25, 4]),
  snareNoiseColor: Object.freeze([0.125, 8]),
  hatANoiseColor: Object.freeze([0.125, 8]),
  hatBNoiseColor: Object.freeze([0.125, 8]),
  shakerNoiseColor: Object.freeze([0.125, 8]),
  upperOnePhase: Object.freeze([0, 127 / 128]),
  upperTwoPhase: Object.freeze([0, 127 / 128]),
  bassPhase: Object.freeze([0, 127 / 128]),
  leadPhase: Object.freeze([0, 127 / 128]),
  gatePatternPhase: Object.freeze([0, 127 / 128]),
  gateSwitchShortPhase: Object.freeze([0, 127 / 128]),
  gateSwitchLongPhase: Object.freeze([0, 127 / 128]),
  sectionPhase: Object.freeze([0, 127 / 128]),
  leadTrillPhase: Object.freeze([0, 127 / 128]),
  leadPhrasePhase: Object.freeze([0, 127 / 128]),
  arpOctavePhase: Object.freeze([0, 127 / 128]),
  texturePhase: Object.freeze([0, 127 / 128]),
});

export const WEBGPU_CHIPTUNE_INTEGER_PARAMS = Object.freeze([
  "transpose",
  "echoTaps",
  "scaleMask",
  "upperOneSpan",
  "upperTwoSpan",
  "bassSpan",
  "upperOneRegister",
  "bassRegister",
  "arpRegister",
  "arpOctaves",
  "gateA0",
  "gateA1",
  "gateA2",
  "gateA3",
  "gateB0",
  "gateB1",
  "gateB2",
  "gateB3",
  "gatePatternSteps",
  "upperTwoRegister",
  "leadRegister",
  "leadSpan",
  "echoAlternate",
]);
const integerParams = new Set(WEBGPU_CHIPTUNE_INTEGER_PARAMS);

const logParams = new Set([
  "tempo",
  "gateRate",
  "gateLength",
  "pwmRate",
  "kickTone",
  "snareTone",
  "drumDecay",
  "echoTime",
  "fadeIn",
  "sectionUnits",
  "pitchClock",
  "bassClock",
  "gateFastRatio",
  "gateSwitchShortUnits",
  "gateSwitchLongUnits",
  "leadTrillRate",
  "leadPhraseUnits",
  "arpRate",
  "arpOctaveRate",
  "drumRate",
  "gateAttack",
  "gateRelease",
  "texturePeriod",
  "textureDecay",
  "kickCycle",
  "kickSubcycle",
  "ghostDelayDivisor",
  "gateShortRatio",
  "gateLongRatio",
  "leadClock",
  "fadeCurve",
  "snareCycle",
  "hatACycle",
  "hatASubcycle",
  "hatARepeat",
  "hatBCycle",
  "shakerCycle",
  "noiseRate",
  "noiseColor",
  "textureSweep",
  "kickBodyPhase",
  "kickBodySweep",
  "kickTransientSweep",
  "kickAttackTime",
  "kickDecayRate",
  "kickClipKnee",
  "snareDecayRate",
  "snareNoiseSweep",
  "snareNoiseRate",
  "snareModRate",
  "snareCarrierRate",
  "hatANoiseRate",
  "hatADecayRate",
  "hatBLowNoiseRate",
  "hatBHighNoiseRate",
  "hatBDecayRate",
  "shakerNoiseRate",
  "shakerDecayRate",
  "upperTwoClockRatio",
  "bassGateRateRatio",
  "leadGateRateRatio",
  "upperTwoGateRateRatio",
  "snareNoiseColor",
  "hatANoiseColor",
  "hatBNoiseColor",
  "shakerNoiseColor",
]);
const decibelParams = new Set([
  "upperOneLevel",
  "upperTwoLevel",
  "bassPulseLevel",
  "bassSineLevel",
  "leadLevel",
  "arpLevel",
  "noiseLevel",
  "kickLevel",
  "snareLevel",
  "hatLevel",
  "shakerLevel",
  "drumMix",
  "ghostDrums",
  "gain",
  "synthMix",
  "hatBHighMix",
  "echoWet",
]);
const bipolarParams = new Set(["ghostPan", "tuningCents"]);
const powerParams = new Set(["snareHoldTime"]);
const DECIBEL_FLOOR = -60;
const UNITY_POSITION = 0.75;

const DECIBEL_ACTIVE_START = 0.025;
export const WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS = Object.freeze(
  Object.fromEntries(WEBGPU_CHIPTUNE_PARAM_ORDER.map((key) => {
    let distribution = "linear";
    if (integerParams.has(key)) distribution = "integer";
    else if (logParams.has(key)) distribution = "log";
    else if (decibelParams.has(key)) distribution = "db";
    else if (bipolarParams.has(key)) distribution = "bipolar";
    else if (powerParams.has(key)) distribution = "power";
    return [key, distribution];
  })),
);

export function webGpuChiptuneParamToUnit(key, value) {
  const [minimum, maximum] = WEBGPU_CHIPTUNE_LIMITS[key] ?? [];
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new RangeError("Unknown WebGPU Chiptune parameter: " + key);
  }
  const physical = clamp(finiteOr(value, WEBGPU_CHIPTUNE_DEFAULTS[key]), minimum, maximum);
  const distribution = WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS[key];
  if (distribution === "log") {
    return clamp(Math.log(physical / minimum) / Math.log(maximum / minimum), 0, 1);
  }
  if (distribution === "db") {
    if (physical <= 0) return 0;
    if (maximum > 1 && physical > 1) {
      return UNITY_POSITION + (1 - UNITY_POSITION) * (physical - 1) / (maximum - 1);
    }
    const reference = maximum > 1 ? 1 : maximum;
    const endpoint = maximum > 1 ? UNITY_POSITION : 1;
    const decibelUnit = clamp(
      1 + (20 * Math.log10(physical / reference)) / -DECIBEL_FLOOR,
      0,
      1,
    );
    return DECIBEL_ACTIVE_START + (endpoint - DECIBEL_ACTIVE_START) * decibelUnit;
  }
  if (distribution === "bipolar" && minimum < 0 && maximum > 0) {
    if (physical <= 0) return 0.5 * (physical - minimum) / -minimum;
    return 0.5 + 0.5 * physical / maximum;
  }
  const unit = (physical - minimum) / Math.max(Number.EPSILON, maximum - minimum);
  return distribution === "power" ? Math.sqrt(clamp(unit, 0, 1)) : clamp(unit, 0, 1);
}

export function webGpuChiptuneParamFromUnit(key, value) {
  const [minimum, maximum] = WEBGPU_CHIPTUNE_LIMITS[key] ?? [];
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    throw new RangeError("Unknown WebGPU Chiptune parameter: " + key);
  }
  const unit = clamp(finiteOr(value, 0), 0, 1);
  const distribution = WEBGPU_CHIPTUNE_PARAM_DISTRIBUTIONS[key];
  let physical;
  if (distribution === "log") {
    physical = minimum * (maximum / minimum) ** unit;
  } else if (distribution === "db") {
    if (unit === 0) return 0;
    if (maximum > 1 && unit > UNITY_POSITION) {
      physical = 1 + (maximum - 1) * (unit - UNITY_POSITION) / (1 - UNITY_POSITION);
    } else {
      const reference = maximum > 1 ? 1 : maximum;
      const endpoint = maximum > 1 ? UNITY_POSITION : 1;
      const decibelUnit = clamp(
        (unit - DECIBEL_ACTIVE_START) / (endpoint - DECIBEL_ACTIVE_START),
        0,
        1,
      );
      physical = reference * 10 ** ((DECIBEL_FLOOR * (1 - decibelUnit)) / 20);
    }
  } else if (distribution === "bipolar" && minimum < 0 && maximum > 0) {
    physical = unit <= 0.5
      ? minimum + (unit / 0.5) * -minimum
      : ((unit - 0.5) / 0.5) * maximum;
  } else {
    const shaped = distribution === "power" ? unit * unit : unit;
    physical = minimum + shaped * (maximum - minimum);
  }
  const bounded = clamp(physical, minimum, maximum);
  return integerParams.has(key) ? Math.round(bounded) : bounded;
}

export function sanitizeWebGpuChiptunePerformance(performance = {}) {
  return Object.freeze(Object.fromEntries(
    WEBGPU_CHIPTUNE_PERFORMANCE_LANES.map((lane) => {
      const candidate = performance?.[lane];
      const fallback = WEBGPU_CHIPTUNE_PERFORMANCE_DEFAULTS[lane];
      return [lane, Object.freeze({
        muted: candidate?.muted === true,
        solo: candidate?.solo === true,
        x: clamp(finiteOr(candidate?.x, fallback.x), 0, 1),
        y: clamp(finiteOr(candidate?.y, fallback.y), 0, 1),
      })];
    }),
  ));
}

function performanceAxisValue(key, baseValue, position) {
  const baseUnit = webGpuChiptuneParamToUnit(key, baseValue);
  const unit = clamp(finiteOr(position, 0.5), 0, 1);
  if (unit === 0.5) return baseValue;
  const effectiveUnit = unit <= 0.5
    ? baseUnit * unit * 2
    : baseUnit + (1 - baseUnit) * (unit - 0.5) * 2;
  return webGpuChiptuneParamFromUnit(key, effectiveUnit);
}

/**
 * Applies the live character-bay performance layer without modifying the
 * underlying preset. The center of each axis is bit-for-bit neutral, while
 * either edge reaches that parameter's real limit using its declared linear,
 * logarithmic, bipolar, integer, power, or decibel distribution.
 */
export function applyWebGpuChiptunePerformance(
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  performance = WEBGPU_CHIPTUNE_PERFORMANCE_DEFAULTS,
) {
  const base = sanitizeWebGpuChiptuneParams(params);
  const controls = sanitizeWebGpuChiptunePerformance(performance);
  const effective = { ...base };
  for (const lane of WEBGPU_CHIPTUNE_PERFORMANCE_LANES) {
    const definition = WEBGPU_CHIPTUNE_PERFORMANCE_AXES[lane];
    const voice = controls[lane];
    effective[definition.x.key] = performanceAxisValue(
      definition.x.key,
      base[definition.x.key],
      voice.x,
    );
    effective[definition.y.key] = performanceAxisValue(
      definition.y.key,
      base[definition.y.key],
      voice.y,
    );
  }
  const anySolo = WEBGPU_CHIPTUNE_PERFORMANCE_LANES.some(
    (lane) => controls[lane].solo,
  );
  for (const lane of WEBGPU_CHIPTUNE_PERFORMANCE_LANES) {
    const definition = WEBGPU_CHIPTUNE_PERFORMANCE_AXES[lane];
    const voice = controls[lane];
    const audible = !voice.muted && (!anySolo || voice.solo);
    if (audible) continue;
    for (const levelKey of definition.levelKeys) effective[levelKey] = 0;
  }
  return sanitizeWebGpuChiptuneParams(effective);
}

export const WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS = Object.freeze({
  chunkDuration: 0.1,
  workgroupSize: 256,
  output: 0.55,
});

export const WEBGPU_CHIPTUNE_WORKGROUP_SIZES = Object.freeze([32, 64, 128, 256]);

export function sanitizeWebGpuChiptuneParams(params = {}) {
  const sanitized = {};
  for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER) {
    const [minimum, maximum] = WEBGPU_CHIPTUNE_LIMITS[key];
    const value = clamp(finiteOr(params[key], WEBGPU_CHIPTUNE_DEFAULTS[key]), minimum, maximum);
    sanitized[key] = integerParams.has(key) ? Math.round(value) : value;
  }
  const pwmMargin = Math.max(
    0,
    Math.min(sanitized.pulseWidth - 0.02, 0.98 - sanitized.pulseWidth),
  );
  sanitized.pwmDepth = Math.min(sanitized.pwmDepth, pwmMargin);
  sanitized.kickSubcycle = Math.min(sanitized.kickSubcycle, sanitized.kickCycle);
  sanitized.hatASubcycle = Math.min(sanitized.hatASubcycle, sanitized.hatACycle);
  sanitized.hatARepeat = Math.min(sanitized.hatARepeat, sanitized.hatASubcycle);

  let shortestGateRatio = Number.POSITIVE_INFINITY;
  for (const lane of ["gateA", "gateB"]) {
    for (let step = 0; step < sanitized.gatePatternSteps; step += 1) {
      const code = Math.round(sanitized[lane + Math.floor(step / 8)]) >>> 0;
      const state = (code >> ((step % 8) * 2)) & 3;
      if (state === 1) shortestGateRatio = Math.min(shortestGateRatio, sanitized.gateShortRatio);
      else if (state === 2) shortestGateRatio = Math.min(shortestGateRatio, 1);
      else if (state === 3) {
        shortestGateRatio = Math.min(shortestGateRatio, sanitized.gateLongRatio);
      }
    }
  }
  if (Number.isFinite(shortestGateRatio)) {
    sanitized.gateRelease = Math.min(
      sanitized.gateRelease,
      Math.max(0.05, shortestGateRatio * sanitized.gateLength),
    );
  }
  return sanitized;
}

export function webGpuChiptuneParamArray(params = {}) {
  const sanitized = sanitizeWebGpuChiptuneParams(params);
  return new Float32Array(WEBGPU_CHIPTUNE_PARAM_ORDER.map((key) => sanitized[key]));
}

export function webGpuChiptuneScaleLock(
  value,
  scaleMask = WEBGPU_CHIPTUNE_DEFAULTS.scaleMask,
) {
  const source = finiteOr(value, 0);
  const pitchClass = ((source % 12) + 12) % 12;
  const mask = Math.round(clamp(finiteOr(scaleMask, WEBGPU_CHIPTUNE_DEFAULTS.scaleMask), 1, 4095));
  let bestDistance = Number.POSITIVE_INFINITY;
  let signedDistance = 0;
  for (let note = 0; note <= 12; note += 1) {
    if ((mask & (1 << (note % 12))) !== 0) {
      const candidate = pitchClass - note;
      const distance = Math.abs(candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        signedDistance = candidate;
      }
    }
  }
  return source - signedDistance;
}

export function webGpuChiptunePatternValue(step, seed = WEBGPU_CHIPTUNE_DEFAULTS.patternSeed) {
  const source = Math.floor(finiteOr(step, 0));
  return fract(source * source * finiteOr(seed, WEBGPU_CHIPTUNE_DEFAULTS.patternSeed));
}

const sequenceStateNames = new Set(Object.keys(WEBGPU_CHIPTUNE_SEQUENCE_STATES));
const sanitizedSequenceObjects = new WeakSet();

function frozenSequenceCell(state = "auto", value = 0) {
  return Object.freeze({ state, value });
}

function frozenSequenceLane(activeLength = WEBGPU_CHIPTUNE_SEQUENCE_STEPS, cells = []) {
  return Object.freeze({
    activeLength,
    cells: Object.freeze(cells),
  });
}

function createDefaultSequenceLanes() {
  return Object.fromEntries(WEBGPU_CHIPTUNE_SEQUENCE_LANES.map((lane) => [
    lane,
    frozenSequenceLane(
      WEBGPU_CHIPTUNE_SEQUENCE_STEPS,
      Array.from(
        { length: WEBGPU_CHIPTUNE_SEQUENCE_STEPS },
        () => frozenSequenceCell(),
      ),
    ),
  ]));
}

export const WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE = Object.freeze({
  schemaVersion: 2,
  lanes: Object.freeze(createDefaultSequenceLanes()),
});
sanitizedSequenceObjects.add(WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE);

export function createWebGpuChiptuneSequence() {
  return sanitizeWebGpuChiptuneSequence({});
}

export function sanitizeWebGpuChiptuneSequence(
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
) {
  if (sanitizedSequenceObjects.has(sequence)) return sequence;
  const source = sequence && typeof sequence === "object" ? sequence : {};
  const sourceLanes = source.lanes && typeof source.lanes === "object"
    ? source.lanes
    : {};
  const lanes = {};
  for (const lane of WEBGPU_CHIPTUNE_SEQUENCE_LANES) {
    const sourceLane = sourceLanes[lane] && typeof sourceLanes[lane] === "object"
      ? sourceLanes[lane]
      : {};
    const sourceCells = Array.isArray(sourceLane.cells) ? sourceLane.cells : [];
    const activeLength = Math.round(clamp(
      finiteOr(sourceLane.activeLength, WEBGPU_CHIPTUNE_SEQUENCE_STEPS),
      1,
      WEBGPU_CHIPTUNE_SEQUENCE_STEPS,
    ));
    const editorSpec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
    const [minimum, maximum] = editorSpec.kind === "drums"
      ? [0, 1]
      : lane === "arp"
        ? WEBGPU_CHIPTUNE_SEQUENCE_ARP_LIMITS
        : WEBGPU_CHIPTUNE_SEQUENCE_NOTE_LIMITS;
    const cells = Array.from({ length: WEBGPU_CHIPTUNE_SEQUENCE_STEPS }, (_, index) => {
      const sourceCell = sourceCells[index] && typeof sourceCells[index] === "object"
        ? sourceCells[index]
        : {};
      const numericState = Number(sourceCell.state);
      const state = sequenceStateNames.has(sourceCell.state)
        ? sourceCell.state
        : numericState === WEBGPU_CHIPTUNE_SEQUENCE_STATES.note
          ? "note"
          : numericState === WEBGPU_CHIPTUNE_SEQUENCE_STATES.rest ? "rest" : "auto";
      const value = clamp(finiteOr(sourceCell.value, 0), minimum, maximum);
      return frozenSequenceCell(state, value);
    });
    lanes[lane] = frozenSequenceLane(activeLength, cells);
  }
  const sanitized = Object.freeze({
    schemaVersion: 2,
    lanes: Object.freeze(lanes),
  });
  sanitizedSequenceObjects.add(sanitized);
  return sanitized;
}

export function packWebGpuChiptuneSequence(sequence, revision = 0) {
  const sanitized = sanitizeWebGpuChiptuneSequence(sequence);
  const meta = new Uint32Array(SEQUENCE_META_BUFFER_SIZE / Uint32Array.BYTES_PER_ELEMENT);
  meta[0] = 2;
  meta[1] = Math.max(0, Math.trunc(finiteOr(revision, 0))) >>> 0;
  meta[2] = WEBGPU_CHIPTUNE_SEQUENCE_LANES.length;
  meta[3] = WEBGPU_CHIPTUNE_SEQUENCE_STEPS;
  WEBGPU_CHIPTUNE_SEQUENCE_LANES.forEach((lane, index) => {
    meta[4 + index] = sanitized.lanes[lane].activeLength;
  });
  const cells = new ArrayBuffer(SEQUENCE_CELL_BUFFER_SIZE);
  const view = new DataView(cells);
  WEBGPU_CHIPTUNE_SEQUENCE_LANES.forEach((lane, laneIndex) => {
    sanitized.lanes[lane].cells.forEach((cell, cellIndex) => {
      const offset = (laneIndex * WEBGPU_CHIPTUNE_SEQUENCE_STEPS + cellIndex)
        * SEQUENCE_CELL_STRIDE;
      view.setFloat32(offset, cell.value, true);
      view.setUint32(offset + 4, WEBGPU_CHIPTUNE_SEQUENCE_STATES[cell.state], true);
      view.setUint32(offset + 8, 0, true);
      view.setUint32(offset + 12, 0, true);
    });
  });
  return Object.freeze({ meta, cells });
}

function requireSequenceEditorSpec(lane) {
  const spec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
  if (!spec) throw new RangeError("Unknown WebGPU Chiptune sequence lane: " + lane);
  return spec;
}

export function webGpuChiptuneSequenceEditorValue(lane, unitValue) {
  const spec = requireSequenceEditorSpec(lane);
  if (spec.kind === "drums") return 1;
  const unit = clamp(finiteOr(unitValue, 0), 0, 1);
  const raw = spec.minimum + unit * (spec.maximum - spec.minimum);
  const quantized = Math.round(raw / spec.quantum) * spec.quantum;
  return clamp(
    Number(quantized.toFixed(spec.quantum < 0.01 ? 3 : 0)),
    spec.minimum,
    spec.maximum,
  );
}

export function webGpuChiptuneSequenceEditorUnit(lane, value) {
  const spec = requireSequenceEditorSpec(lane);
  if (spec.kind === "drums") return clamp(finiteOr(value, 1), 0, 1);
  return clamp(
    (finiteOr(value, spec.minimum) - spec.minimum)
      / Math.max(Number.EPSILON, spec.maximum - spec.minimum),
    0,
    1,
  );
}

export function paintWebGpuChiptuneSequenceSegment(
  sequence,
  lane,
  fromStep,
  toStep,
  fromValue,
  toValue,
  cellState = "note",
) {
  const spec = requireSequenceEditorSpec(lane);
  const sanitized = sanitizeWebGpuChiptuneSequence(sequence);
  const start = Math.round(clamp(fromStep, 0, WEBGPU_CHIPTUNE_SEQUENCE_STEPS - 1));
  const end = Math.round(clamp(toStep, 0, WEBGPU_CHIPTUNE_SEQUENCE_STEPS - 1));
  const state = sequenceStateNames.has(cellState) ? cellState : "note";
  const cells = [...sanitized.lanes[lane].cells];
  const direction = end >= start ? 1 : -1;
  const distance = Math.max(1, Math.abs(end - start));
  for (let step = start; ; step += direction) {
    const progress = Math.abs(step - start) / distance;
    const interpolated = finiteOr(fromValue, 0)
      + (finiteOr(toValue, fromValue) - finiteOr(fromValue, 0)) * progress;
    const current = cells[step];
    const value = state === "note"
      ? spec.kind === "drums"
        ? 1
        : webGpuChiptuneSequenceEditorValue(
          lane,
          (interpolated - spec.minimum)
            / Math.max(Number.EPSILON, spec.maximum - spec.minimum),
        )
      : current.value;
    cells[step] = { state, value };
    if (step === end) break;
  }
  return sanitizeWebGpuChiptuneSequence({
    schemaVersion: 2,
    lanes: {
      ...sanitized.lanes,
      [lane]: {
        ...sanitized.lanes[lane],
        cells,
      },
    },
  });
}

function positiveIntegerModulo(value, modulus) {
  return ((Math.floor(value) % modulus) + modulus) % modulus;
}

function sequenceRateForLane(lane, patch) {
  if (WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane)) {
    return Math.max(patch.drumRate, 0.000001) * 4;
  }
  const rate = patch[sequenceRateKeys[lane]];
  return lane === "upperTwo" ? rate * patch.upperTwoClockRatio : rate;
}

function sequenceCellIndexFromSanitized(lane, beatTime, patch, sequence) {
  const length = sequence.lanes[lane].activeLength;
  const rate = sequenceRateForLane(lane, patch);
  const phase = finiteOr(patch[sequencePhaseKeys[lane]], 0) * length;
  return positiveIntegerModulo(finiteOr(beatTime, 0) * rate + phase, length);
}

function requireSequenceLane(lane) {
  if (!sequenceLaneIndex.has(lane)) {
    throw new RangeError("Unknown WebGPU Chiptune sequence lane: " + lane);
  }
}

export function webGpuChiptuneSequenceCellIndex(
  lane,
  beatTime,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
) {
  requireSequenceLane(lane);
  const patch = sanitizeWebGpuChiptuneParams(params);
  const sanitized = sanitizeWebGpuChiptuneSequence(sequence);
  return sequenceCellIndexFromSanitized(lane, beatTime, patch, sanitized);
}

export function webGpuChiptuneSequenceCellAtBeat(
  lane,
  beatTime,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
) {
  requireSequenceLane(lane);
  const patch = sanitizeWebGpuChiptuneParams(params);
  const sanitized = sanitizeWebGpuChiptuneSequence(sequence);
  return sanitized.lanes[lane].cells[
    sequenceCellIndexFromSanitized(lane, beatTime, patch, sanitized)
  ];
}

export function webGpuChiptuneLaneTiming(
  lane,
  timeSeconds,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
  targetStep = null,
) {
  requireSequenceLane(lane);
  const patch = sanitizeWebGpuChiptuneParams(params);
  const sanitized = sanitizeWebGpuChiptuneSequence(sequence);
  const length = sanitized.lanes[lane].activeLength;
  const rate = Math.max(sequenceRateForLane(lane, patch), 0.000001);
  const seconds = Math.max(0, finiteOr(timeSeconds, 0));
  const absolutePosition = seconds * patch.tempo * rate
    + finiteOr(patch[sequencePhaseKeys[lane]], 0) * length;
  const position = positiveModulo(absolutePosition, length);
  const currentStep = Math.min(length - 1, Math.max(0, Math.floor(position)));
  const progress = positiveModulo(position, 1);
  const secondsPerStep = 1 / Math.max(patch.tempo * rate, 0.000001);
  const hasTarget = targetStep !== null
    && targetStep !== undefined
    && targetStep !== "";
  const numericTarget = hasTarget ? Number(targetStep) : Number.NaN;
  const boundedTarget = Number.isFinite(numericTarget)
    ? Math.round(clamp(numericTarget, 0, WEBGPU_CHIPTUNE_SEQUENCE_STEPS - 1))
    : null;
  const insideLoop = boundedTarget === null ? null : boundedTarget < length;
  const targetActiveNow = insideLoop === true && boundedTarget === currentStep;
  const distance = insideLoop
    ? targetActiveNow ? 0 : positiveModulo(boundedTarget - position, length)
    : null;
  return Object.freeze({
    lane,
    length,
    rate,
    position,
    currentStep,
    nextStep: (currentStep + 1) % length,
    progress,
    secondsPerStep,
    secondsPerLoop: secondsPerStep * length,
    targetStep: boundedTarget,
    targetInsideLoop: insideLoop,
    targetActiveNow,
    secondsUntilTarget: distance === null ? null : distance * secondsPerStep,
  });
}

export function webGpuChiptuneLiveEditTarget(
  lane,
  timeSeconds,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
  leadSeconds = 0.12,
) {
  requireSequenceLane(lane);
  const lead = clamp(finiteOr(leadSeconds, 0.12), 0, 1);
  const anchor = webGpuChiptuneLaneTiming(
    lane,
    Math.max(0, finiteOr(timeSeconds, 0)) + lead,
    params,
    sequence,
  );
  const drumsUseNextOnset = WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane);
  const step = drumsUseNextOnset
    ? anchor.nextStep
    : anchor.currentStep;
  const natural = webGpuChiptuneLaneTiming(
    lane,
    timeSeconds,
    params,
    sequence,
    step,
  );
  return Object.freeze({
    lane,
    step,
    leadSeconds: lead,
    naturalSeconds: drumsUseNextOnset
      ? lead + (1 - anchor.progress) * anchor.secondsPerStep
      : natural.secondsUntilTarget,
    anchorStep: anchor.currentStep,
    drumsUseNextOnset,
  });
}

function proceduralLaneValueFromSanitized(lane, beatTime, patch, sequence) {
  const beat = finiteOr(beatTime, 0);
  if (WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane)) return 0;
  if (lane === "arp") {
    const span = Math.max(patch.arpSpan, 0.000001);
    const phase = beat * patch.arpRate + patch.arpPhase * span * 2;
    return Math.abs(phase - Math.floor(phase / (span * 2)) * span * 2 - span) / span;
  }
  const rate = sequenceRateForLane(lane, patch);
  const phaseLength = sequence.lanes[lane].activeLength;
  const source = Math.floor(
    beat * rate + finiteOr(patch[sequencePhaseKeys[lane]], 0) * phaseLength,
  );
  const spanKey = {
    upperOne: "upperOneSpan",
    upperTwo: "upperTwoSpan",
    bass: "bassSpan",
    lead: "leadSpan",
  }[lane];
  return Math.floor(
    webGpuChiptunePatternValue(source, patch.patternSeed)
      * patch[spanKey] * patch.pitchRange,
  );
}

export function webGpuChiptuneProceduralLaneValue(
  lane,
  beatTime,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
) {
  requireSequenceLane(lane);
  const sanitizedSequence = sanitizeWebGpuChiptuneSequence(sequence);
  return proceduralLaneValueFromSanitized(
    lane,
    beatTime,
    sanitizeWebGpuChiptuneParams(params),
    sanitizedSequence,
  );
}

function sequenceLaneInput(lane, beatTime, patch, sequence) {
  const cell = sequence.lanes[lane].cells[
    sequenceCellIndexFromSanitized(lane, beatTime, patch, sequence)
  ];
  const generated = proceduralLaneValueFromSanitized(lane, beatTime, patch, sequence);
  return {
    cell,
    value: cell.state === "note" ? cell.value : generated,
  };
}

export function webGpuChiptuneBeatSnapshot(
  beatTime,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
) {
  const patch = sanitizeWebGpuChiptuneParams(params);
  const sanitizedSequence = sanitizeWebGpuChiptuneSequence(sequence);
  const beat = finiteOr(beatTime, 0);
  const tuning = patch.tuningCents / 100;
  const upperOneInput = sequenceLaneInput("upperOne", beat, patch, sanitizedSequence);
  const upperTwoInput = sequenceLaneInput("upperTwo", beat, patch, sanitizedSequence);
  const bassInput = sequenceLaneInput("bass", beat, patch, sanitizedSequence);
  const leadInput = sequenceLaneInput("lead", beat, patch, sanitizedSequence);
  const arpInput = sequenceLaneInput("arp", beat, patch, sanitizedSequence);
  const upperOne = webGpuChiptuneScaleLock(upperOneInput.value, patch.scaleMask)
    + patch.upperOneRegister + patch.transpose + tuning;
  const upperTwo = webGpuChiptuneScaleLock(upperTwoInput.value, patch.scaleMask)
    + patch.upperTwoRegister + patch.transpose + tuning;
  const bassBase = webGpuChiptuneScaleLock(bassInput.value, patch.scaleMask);
  const bass = bassBase + patch.bassRegister + patch.transpose + tuning;
  const lead = webGpuChiptuneScaleLock(leadInput.value, patch.scaleMask)
    + (fract(
      beat * patch.leadTrillRate + patch.leadTrillPhase,
    ) >= 1 - patch.leadTrillShare
      ? patch.leadInterval
      : 0)
    + patch.leadRegister
    + patch.transpose
    + tuning;
  const arpContour = arpInput.value * patch.arpSpan;
  const octaveMotion = Math.floor(
    Math.abs(positiveModulo(
      beat * patch.arpOctaveRate + patch.arpOctavePhase * 2,
      2,
    ) - 1) * patch.arpOctaves,
  ) * 12;
  const arp = webGpuChiptuneScaleLock(arpContour * patch.pitchRange, patch.scaleMask)
    + bassBase * patch.arpBassFollow
    + octaveMotion
    + patch.arpRegister
    + patch.transpose
    + tuning;
  return Object.freeze({
    upperOne: upperOneInput.cell.state === "rest" ? Number.NaN : upperOne,
    upperTwo: upperTwoInput.cell.state === "rest" ? Number.NaN : upperTwo,
    bass: bassInput.cell.state === "rest" ? Number.NaN : bass,
    lead: leadInput.cell.state === "rest" ? Number.NaN : lead,
    arp: arpInput.cell.state === "rest" ? Number.NaN : arp,
  });
}

// Total positions on each existing lane clock per eight-pose body phrase.
// Fast notes still reach the lamps and accents without becoming a second clock.
const CHIPTUNE_STAGE_VOICES = Object.freeze({
  upperOne: Object.freeze({
    label: "UPPER A",
    levelKeys: Object.freeze(["upperOneLevel"]),
    danceSteps: 16,
  }),
  upperTwo: Object.freeze({
    label: "UPPER B",
    levelKeys: Object.freeze(["upperTwoLevel"]),
    danceSteps: 32,
  }),
  bass: Object.freeze({
    label: "BASS",
    levelKeys: Object.freeze(["bassPulseLevel", "bassSineLevel"]),
    danceSteps: 8,
  }),
  lead: Object.freeze({
    label: "LEAD",
    levelKeys: Object.freeze(["leadLevel"]),
    danceSteps: 24,
  }),
  arp: Object.freeze({
    label: "ARP",
    levelKeys: Object.freeze(["arpLevel"]),
    danceSteps: 128,
  }),
});

function stageLevelUnit(definition, patch) {
  const units = definition.levelKeys.map((key) => webGpuChiptuneParamToUnit(key, patch[key]));
  return units.reduce((sum, unit) => sum + unit, 0) / units.length;
}

function stageShapeUnit(lane, patch) {
  if (lane === "upperOne") {
    return clamp(
      webGpuChiptuneParamToUnit("pulseWidth", patch.pulseWidth) * 0.7
        + webGpuChiptuneParamToUnit("pwmDepth", patch.pwmDepth) * 0.3,
      0,
      1,
    );
  }
  if (lane === "upperTwo") {
    return clamp(
      webGpuChiptuneParamToUnit("pulseWidth", patch.pulseWidth) * 0.55
        + webGpuChiptuneParamToUnit("pwmRate", patch.pwmRate) * 0.45,
      0,
      1,
    );
  }
  if (lane === "bass") {
    const pulse = Math.max(0, patch.bassPulseLevel);
    const sine = Math.max(0, patch.bassSineLevel);
    return sine / Math.max(Number.EPSILON, pulse + sine);
  }
  if (lane === "lead") {
    return webGpuChiptuneParamToUnit("leadInterval", patch.leadInterval);
  }
  return clamp(
    webGpuChiptuneParamToUnit("arpSpan", patch.arpSpan) * 0.6
      + webGpuChiptuneParamToUnit("arpOctaves", patch.arpOctaves) * 0.4,
    0,
    1,
  );
}

function stageStepValue(edge, value) {
  return value >= edge ? 1 : 0;
}

function stageSmoothAny(edge0, edge1, value) {
  const width = edge1 - edge0;
  if (Math.abs(width) < 0.000001) return stageStepValue(edge0, value);
  const t = clamp((value - edge0) / width, 0, 1);
  return t * t * (3 - 2 * t);
}

function stagePackedGateDuration(patch, laneB, step) {
  const segment = Math.floor(step / 8);
  const code = Math.round(patch[(laneB ? "gateB" : "gateA") + segment]) >>> 0;
  const gateState = (code >> ((step % 8) * 2)) & 3;
  if (gateState === 1) return patch.gateShortRatio;
  if (gateState === 2) return 1;
  if (gateState === 3) return patch.gateLongRatio;
  return 0;
}

function stageNoteGate(tSource, offset, duration, length, patternSteps, attack, release) {
  const patternPeriod = Math.max(Math.round(patternSteps), 1);
  const t = positiveModulo(tSource - offset, patternPeriod);
  const scaledDuration = Math.max(0.05, duration * length);
  const attackWidth = Math.max(attack, 0.001);
  const releaseWidth = Math.max(release, 0.001);
  const gateAt = (gateTime) => (
    stageSmoothAny(-attackWidth, 0, gateTime)
      * stageSmoothAny(0, -releaseWidth, gateTime - scaledDuration)
  );
  return Math.max(gateAt(t), gateAt(t - patternPeriod));
}

function stagePatternGateFromSanitized(t, length, patch, laneB = false) {
  const patternSteps = Math.round(clamp(patch.gatePatternSteps, 1, 32));
  const phasedTime = t + patch.gatePatternPhase * patternSteps;
  let value = 0;
  for (let step = 0; step < patternSteps; step += 1) {
    const duration = stagePackedGateDuration(patch, laneB, step);
    if (duration <= 0) continue;
    value += stageNoteGate(
      phasedTime,
      step,
      duration,
      length,
      patternSteps,
      patch.gateAttack,
      patch.gateRelease,
    );
  }
  return clamp(value, 0, 1);
}

export function webGpuChiptunePatternGate(
  time,
  length = WEBGPU_CHIPTUNE_DEFAULTS.gateLength,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  laneB = false,
) {
  return stagePatternGateFromSanitized(
    finiteOr(time, 0),
    finiteOr(length, WEBGPU_CHIPTUNE_DEFAULTS.gateLength),
    sanitizeWebGpuChiptuneParams(params),
    Boolean(laneB),
  );
}

function stageAudibleGate(lane, masterBeat, patch) {
  const gateRate = patch.gateRate;
  const bassGate = stagePatternGateFromSanitized(
    masterBeat * 8 * gateRate * patch.bassGateRateRatio,
    patch.gateLength,
    patch,
    false,
  );
  if (lane === "bass") return bassGate;
  if (lane === "arp") return 1 + (bassGate - 1) * patch.arpGateDepth;

  const section = stageStepValue(
    patch.leadSectionShare,
    fract(masterBeat / Math.max(patch.sectionUnits, 0.01) + patch.sectionPhase),
  );
  if (lane === "lead") {
    const phraseUnits = Math.max(patch.leadPhraseUnits, 0.01);
    const phrase = positiveModulo(
      masterBeat + patch.leadPhrasePhase * phraseUnits,
      phraseUnits,
    );
    return stagePatternGateFromSanitized(
      phrase * 8 * gateRate * patch.leadGateRateRatio,
      patch.gateLength,
      patch,
      true,
    ) * (1 - section);
  }

  const shortSwitch = fract(
    masterBeat / Math.max(patch.gateSwitchShortUnits, 0.01)
      + patch.gateSwitchShortPhase,
  );
  const fast = stageStepValue(1 - patch.fastGateShare, shortSwitch);
  if (lane === "upperOne") {
    return stagePatternGateFromSanitized(
      masterBeat * 8 * (1 + (patch.gateFastRatio - 1) * fast) * gateRate,
      patch.gateLength,
      patch,
      false,
    ) * section;
  }
  const longSwitch = fract(
    masterBeat / Math.max(patch.gateSwitchLongUnits, 0.01)
      + patch.gateSwitchLongPhase,
  );
  const alternateFast = Math.max(
    fast,
    1 - stageStepValue(patch.longGateBoostShare, longSwitch),
  );
  return stagePatternGateFromSanitized(
    masterBeat
      * 8
      * (1 + (patch.gateFastRatio - 1) * alternateFast)
      * gateRate
      * patch.upperTwoGateRateRatio,
    patch.gateLength,
    patch,
    false,
  ) * section;
}

function stageMotionPhase(lane, seconds, masterBeat, patch) {
  if (lane === "upperOne" || lane === "upperTwo") {
    return positiveModulo(seconds * patch.pwmRate, Math.PI * 2) / (Math.PI * 2);
  }
  if (lane === "bass") {
    const patternSteps = Math.max(1, Math.round(patch.gatePatternSteps));
    return positiveModulo(
      masterBeat * 8 * patch.gateRate * patch.bassGateRateRatio
        + patch.gatePatternPhase * patternSteps,
      1,
    );
  }
  if (lane === "lead") {
    return positiveModulo(masterBeat * patch.leadTrillRate + patch.leadTrillPhase, 1);
  }
  return positiveModulo(
    masterBeat * patch.arpOctaveRate + patch.arpOctavePhase * 2,
    2,
  ) / 2;
}

function stageMotionUnit(lane, patch) {
  if (lane === "upperOne" || lane === "upperTwo") {
    return webGpuChiptuneParamToUnit("pwmRate", patch.pwmRate);
  }
  if (lane === "bass") {
    return webGpuChiptuneParamToUnit("bassGateRateRatio", patch.bassGateRateRatio);
  }
  if (lane === "lead") {
    return webGpuChiptuneParamToUnit("leadTrillRate", patch.leadTrillRate);
  }
  return webGpuChiptuneParamToUnit("arpOctaveRate", patch.arpOctaveRate);
}

function stageDetailUnit(lane, patch) {
  if (lane === "upperOne") {
    return webGpuChiptuneParamToUnit("pwmDepth", patch.pwmDepth);
  }
  if (lane === "upperTwo") {
    return webGpuChiptuneParamToUnit("upperTwoClockRatio", patch.upperTwoClockRatio);
  }
  if (lane === "bass") {
    return webGpuChiptuneParamToUnit("bassPulseWidth", patch.bassPulseWidth);
  }
  if (lane === "lead") {
    return webGpuChiptuneParamToUnit("leadTrillShare", patch.leadTrillShare);
  }
  return webGpuChiptuneParamToUnit("arpGateDepth", patch.arpGateDepth);
}

function stageRangeUnit(lane, patch) {
  if (lane === "upperOne") {
    return webGpuChiptuneParamToUnit("upperOneSpan", patch.upperOneSpan);
  }
  if (lane === "upperTwo") {
    return webGpuChiptuneParamToUnit("upperTwoSpan", patch.upperTwoSpan);
  }
  if (lane === "bass") {
    return webGpuChiptuneParamToUnit("bassSpan", patch.bassSpan);
  }
  if (lane === "lead") {
    return webGpuChiptuneParamToUnit("leadSpan", patch.leadSpan);
  }
  return clamp(
    webGpuChiptuneParamToUnit("arpSpan", patch.arpSpan) * 0.55
      + webGpuChiptuneParamToUnit("arpOctaves", patch.arpOctaves) * 0.45,
    0,
    1,
  );
}

const STAGE_BODY_TAP_OFFSETS = Object.freeze({
  jump: 0,
  body: 1 / 6,
  leftArm: 2 / 6,
  rightArm: 3 / 6,
  leftLeg: 4 / 6,
  rightLeg: 5 / 6,
});

function stageBodyValueUnit(lane, value) {
  const spec = WEBGPU_CHIPTUNE_SEQUENCE_EDITOR_SPECS[lane];
  return clamp(
    (finiteOr(value, spec.minimum) - spec.minimum)
      / Math.max(Number.EPSILON, spec.maximum - spec.minimum),
    0,
    1,
  );
}

function stageBodyGroupSummary(
  lane,
  laneState,
  boundary,
  stride,
  clockRate,
  phasePosition,
  patch,
  sequence,
) {
  let activeSteps = 0;
  let valueTotal = 0;
  for (let offset = 0; offset < stride; offset += 1) {
    const lanePosition = boundary - offset;
    const beatTime = (lanePosition + 0.5 - phasePosition)
      / Math.max(clockRate, 0.000001);
    const input = sequenceLaneInput(lane, beatTime, patch, sequence);
    if (input.cell.state === "rest") continue;
    activeSteps += 1;
    valueTotal += stageBodyValueUnit(lane, input.value);
  }
  const activeDensity = activeSteps / stride;
  const valueUnit = activeSteps > 0 ? valueTotal / activeSteps : 0.5;
  return Object.freeze({
    sourceStep: positiveIntegerModulo(boundary, laneState.activeLength),
    activeDensity,
    valueUnit,
    signedValue: valueUnit * 2 - 1,
  });
}

function stageVoiceBodyMotion(
  lane,
  laneState,
  position,
  clockRate,
  phasePosition,
  definition,
  patch,
  sequence,
  levelUnit,
) {
  // Six staggered taps read one divided position on this voice's real lane.
  // They are a deterministic score delay line, never independent clocks.
  const stride = Math.max(1, Math.round(definition.danceSteps / 8));
  const countPosition = position / stride;
  const energy = Math.sqrt(clamp(levelUnit, 0, 1));
  const summaries = new Map();
  const taps = {};
  for (const [channel, delay] of Object.entries(STAGE_BODY_TAP_OFFSETS)) {
    const tapCount = countPosition - delay;
    const phase = positiveModulo(tapCount, 1);
    const boundary = Math.floor(tapCount) * stride;
    let summary = summaries.get(boundary);
    if (!summary) {
      summary = stageBodyGroupSummary(
        lane,
        laneState,
        boundary,
        stride,
        clockRate,
        phasePosition,
        patch,
        sequence,
      );
      summaries.set(boundary, summary);
    }
    const densityEnergy = summary.activeDensity * energy;
    const arc = Math.sin(Math.PI * phase) ** 2 * densityEnergy;
    const impact = (1 - phase) ** 3 * densityEnergy;
    taps[channel] = Object.freeze({
      ...summary,
      phase,
      arc,
      impact,
    });
  }
  const gesture = (tap) => clamp(tap.arc + tap.impact * 0.35, 0, 1);
  const armGesture = (tap) => clamp(
    tap.signedValue * tap.activeDensity * energy * 0.42
      + gesture(tap) * 0.92,
    -1,
    1,
  );
  const bodyTap = taps.body;
  return Object.freeze({
    sourceVoice: lane,
    stride,
    phase: positiveModulo(countPosition, 1),
    jump: clamp(gesture(taps.jump) * (0.65 + taps.jump.valueUnit * 0.35), 0, 1),
    jiggle: clamp(
      Math.sin(bodyTap.phase * Math.PI * 2)
        * (bodyTap.arc + bodyTap.impact * 0.28)
        + bodyTap.signedValue * bodyTap.impact * 0.18,
      -1,
      1,
    ),
    squash: clamp(bodyTap.impact * 0.85 + bodyTap.arc * 0.35, 0, 1),
    leftArm: armGesture(taps.leftArm),
    rightArm: armGesture(taps.rightArm),
    leftLeg: gesture(taps.leftLeg),
    rightLeg: gesture(taps.rightLeg),
    taps: Object.freeze(taps),
  });
}

function stageDrumTime(seconds, tempo, cycle, phase = 0) {
  const safeCycle = Math.max(0.01, cycle);
  return positiveModulo(seconds * tempo - phase * safeCycle, safeCycle)
    / Math.max(0.01, tempo);
}

function stageDrumEnvelope(time, decayRate, decay, hold = 0) {
  return clamp(Math.exp(
    -Math.max(time - hold, 0) * decayRate / Math.max(0.1, decay),
  ), 0, 1);
}

function stageSequencedDrumTiming(
  lane,
  sourceTime,
  masterBeat,
  patch,
  sequence,
) {
  const laneState = sequence.lanes[lane];
  const rate = sequenceRateForLane(lane, patch);
  const position = positiveModulo(masterBeat * rate, laneState.activeLength);
  const cellIndex = positiveIntegerModulo(position, laneState.activeLength);
  const stepPhase = positiveModulo(position, 1);
  const cell = laneState.cells[cellIndex];
  const stepDuration = 1 / Math.max(patch.tempo * rate, 0.000001);
  const manualTime = stepPhase * stepDuration;
  const fadeLength = Math.min(0.004, stepDuration * 0.25);
  const tail = fadeLength <= 0
    ? 1
    : 1 - clamp((manualTime - (stepDuration - fadeLength)) / fadeLength, 0, 1);
  return Object.freeze({
    time: cell.state === "note" ? manualTime : sourceTime,
    active: cell.state === "rest" ? 0 : cell.state === "note" ? tail : 1,
    cellIndex,
    cellState: cell.state,
    stepPhase,
  });
}

function stageDrumBodyMotion(drums, drumSteps, levelUnit, phase) {
  const energy = Math.sqrt(clamp(levelUnit, 0, 1));
  const kick = clamp(drums.kick * energy, 0, 1);
  const snare = clamp(drums.snare * energy, 0, 1);
  const hats = clamp(Math.max(drums.hatA, drums.hatB) * energy, 0, 1);
  const shaker = clamp(drums.shaker * energy, 0, 1);
  const snareRight = (drumSteps.snare.cellIndex & 1) === 1;
  const hatsRight = (
    drumSteps.hats.cellIndex + Math.floor(drumSteps.hats.stepPhase * 2)
  ) & 1;
  const shakerRight = (
    drumSteps.shaker.cellIndex + Math.floor(drumSteps.shaker.stepPhase * 4)
  ) & 1;
  return Object.freeze({
    sourceVoice: "drums",
    stride: 1,
    phase: positiveModulo(phase, 1),
    jump: clamp(kick * 0.92 + hats * 0.08, 0, 1),
    jiggle: shaker * (shakerRight ? 1 : -1),
    squash: kick,
    leftArm: snare * (snareRight ? 0.22 : 1),
    rightArm: snare * (snareRight ? 1 : 0.22),
    leftLeg: hats * (hatsRight ? 0.18 : 1),
    rightLeg: hats * (hatsRight ? 1 : 0.18),
    sources: Object.freeze({
      kick,
      snare,
      hats,
      shaker,
    }),
  });
}

/**
 * A deterministic, JSON-safe visual model for the five pitched voices and
 * their sixth drum dancer. It uses the same master beat, per-lane rates,
 * phases, cells, notes, and drum envelopes as the shader. Renderers can change
 * style without creating a second musical clock.
 */
export function webGpuChiptuneCharacterBayLayout(width, count = 6) {
  const bayCount = Math.max(1, Math.min(16, Math.round(finiteOr(count, 6))));
  const safeWidth = Math.max(bayCount, Math.floor(finiteOr(width, bayCount)));
  return Object.freeze(Array.from({ length: bayCount }, (_, index) => {
    const left = Math.round(index * safeWidth / bayCount);
    const right = Math.round((index + 1) * safeWidth / bayCount);
    return Object.freeze({
      index,
      left,
      right,
      width: right - left,
      center: Math.round((left + right) * 0.5),
    });
  }));
}

export function webGpuChiptuneStageSnapshot(
  timeSeconds,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
) {
  const patch = sanitizeWebGpuChiptuneParams(params);
  const sanitizedSequence = sanitizeWebGpuChiptuneSequence(sequence);
  const seconds = Math.max(0, finiteOr(timeSeconds, 0));
  const masterBeat = seconds * patch.tempo;
  const notes = webGpuChiptuneBeatSnapshot(masterBeat, patch, sanitizedSequence);
  const voiceActors = WEBGPU_CHIPTUNE_VOICE_SEQUENCE_LANES.map((lane) => {
    const definition = CHIPTUNE_STAGE_VOICES[lane];
    const laneState = sanitizedSequence.lanes[lane];
    const clockRate = sequenceRateForLane(lane, patch);
    const phasePosition = finiteOr(patch[sequencePhaseKeys[lane]], 0)
      * laneState.activeLength;
    const position = masterBeat * clockRate + phasePosition;
    const cellIndex = positiveIntegerModulo(position, laneState.activeLength);
    const stepPhase = positiveModulo(position, 1);
    const cell = laneState.cells[cellIndex];
    const resting = cell.state === "rest";
    const note = resting || !Number.isFinite(notes[lane]) ? null : notes[lane];
    const levelUnit = stageLevelUnit(definition, patch);
    const attack = clamp(stepPhase / Math.max(0.025, patch.gateAttack), 0, 1);
    const release = clamp(
      (Math.min(1, patch.gateLength) - stepPhase) / Math.max(0.05, patch.gateRelease),
      0,
      1,
    );
    const cellGate = resting ? 0 : clamp(Math.min(attack, release), 0, 1);
    const audibleGate = resting ? 0 : stageAudibleGate(lane, masterBeat, patch);
    const activity = resting ? 0 : clamp((0.14 + audibleGate * 0.86) * levelUnit, 0, 1);
    const onset = resting
      ? 0
      : clamp((1 - stepPhase / 0.18) * (0.25 + audibleGate * 0.75) * levelUnit, 0, 1);
    const danceSteps = definition.danceSteps;
    const dancePhase = positiveModulo(position, danceSteps) / danceSteps;
    const bodyMotion = stageVoiceBodyMotion(
      lane,
      laneState,
      position,
      clockRate,
      phasePosition,
      definition,
      patch,
      sanitizedSequence,
      levelUnit,
    );
    return Object.freeze({
      key: lane,
      label: definition.label,
      clockRate,
      activeLength: laneState.activeLength,
      cellIndex,
      cellState: cell.state,
      cellValue: cell.value,
      stepPhase,
      note,
      resting,
      gate: audibleGate,
      cellGate,
      audibleGate,
      activity,
      levelUnit,
      size: clamp(0.56 + levelUnit * 0.44, 0, 1),
      hue: note === null ? 0.5 : clamp((note + 72) / 144, 0, 1),
      shape: stageShapeUnit(lane, patch),
      motionPhase: stageMotionPhase(lane, seconds, masterBeat, patch),
      motion: stageMotionUnit(lane, patch),
      detail: stageDetailUnit(lane, patch),
      range: stageRangeUnit(lane, patch),
      onset,
      bounce: resting ? 0 : clamp(onset * 0.35, 0, 1),
      danceSteps,
      dancePhase,
      bodyMotion,
      frame: Math.floor(dancePhase * 8) % 8,
    });
  });

  const drumTempo = patch.tempo * Math.max(patch.drumRate, 0.01);
  const kickCycle = Math.max(patch.kickCycle, 0.05);
  const kickCycleTime = positiveModulo(
    seconds * drumTempo - patch.kickPhase * kickCycle,
    kickCycle,
  );
  const kickTime = positiveModulo(kickCycleTime, Math.max(patch.kickSubcycle, 0.05))
    / drumTempo;
  const snareTime = stageDrumTime(seconds, drumTempo, patch.snareCycle, patch.snarePhase);
  const hatATime = stageDrumTime(seconds, drumTempo, patch.hatARepeat, patch.hatARepeatPhase);
  const hatBTime = stageDrumTime(seconds, drumTempo, patch.hatBCycle, patch.hatBPhase);
  const shakerTime = stageDrumTime(
    seconds,
    drumTempo,
    patch.shakerCycle,
    patch.shakerPhase,
  );
  const kickSequence = stageSequencedDrumTiming(
    "kick", kickTime, masterBeat, patch, sanitizedSequence,
  );
  const snareSequence = stageSequencedDrumTiming(
    "snare", snareTime, masterBeat, patch, sanitizedSequence,
  );
  const hatASequence = stageSequencedDrumTiming(
    "hats", hatATime, masterBeat, patch, sanitizedSequence,
  );
  const hatBSequence = stageSequencedDrumTiming(
    "hats", hatBTime, masterBeat, patch, sanitizedSequence,
  );
  const shakerSequence = stageSequencedDrumTiming(
    "shaker", shakerTime, masterBeat, patch, sanitizedSequence,
  );
  const drumDecay = Math.max(0.1, patch.drumDecay);
  const drums = Object.freeze({
    kick: clamp(
      webGpuChiptuneParamToUnit("kickLevel", patch.kickLevel)
        * stageDrumEnvelope(kickSequence.time, patch.kickDecayRate, drumDecay)
        * kickSequence.active,
      0,
      1,
    ),
    snare: clamp(
      webGpuChiptuneParamToUnit("snareLevel", patch.snareLevel)
        * stageDrumEnvelope(
          snareSequence.time,
          patch.snareDecayRate,
          drumDecay,
          patch.snareHoldTime,
        )
        * snareSequence.active,
      0,
      1,
    ),
    hatA: clamp(
      webGpuChiptuneParamToUnit("hatLevel", patch.hatLevel)
        * (1 - clamp(patch.hatBalance, 0, 1))
        * stageDrumEnvelope(hatASequence.time, patch.hatADecayRate, drumDecay)
        * hatASequence.active,
      0,
      1,
    ),
    hatB: clamp(
      webGpuChiptuneParamToUnit("hatLevel", patch.hatLevel)
        * clamp(patch.hatBalance, 0, 1)
        * stageDrumEnvelope(hatBSequence.time, patch.hatBDecayRate, drumDecay)
        * hatBSequence.active,
      0,
      1,
    ),
    shaker: clamp(
      webGpuChiptuneParamToUnit("shakerLevel", patch.shakerLevel)
        * stageDrumEnvelope(shakerSequence.time, patch.shakerDecayRate, drumDecay)
        * shakerSequence.active,
      0,
      1,
    ),
  });
  const drumSteps = Object.freeze({
    kick: kickSequence,
    snare: snareSequence,
    hats: hatASequence,
    shaker: shakerSequence,
  });
  const drumPosition = masterBeat * sequenceRateForLane("kick", patch);
  const drumDanceSteps = 8;
  const drumDancePhase = positiveModulo(drumPosition, drumDanceSteps) / drumDanceSteps;
  const drumPeak = Math.max(
    drums.kick,
    drums.snare,
    drums.hatA,
    drums.hatB,
    drums.shaker,
  );
  const drumBusUnit = webGpuChiptuneParamToUnit("drumMix", patch.drumMix);
  const kitLevelUnit = (
    webGpuChiptuneParamToUnit("kickLevel", patch.kickLevel)
      + webGpuChiptuneParamToUnit("snareLevel", patch.snareLevel)
      + webGpuChiptuneParamToUnit("hatLevel", patch.hatLevel)
      + webGpuChiptuneParamToUnit("shakerLevel", patch.shakerLevel)
  ) / 4;
  const drumLevelUnit = clamp(drumBusUnit * kitLevelUnit, 0, 1);
  const drumCellStates = Object.values(drumSteps).map(({ cellState }) => cellState);
  const drumCellState = drumCellStates.every((cellState) => cellState === "rest")
    ? "rest"
    : drumCellStates.some((cellState) => cellState === "note") ? "note" : "auto";
  const drumActor = Object.freeze({
    key: "drums",
    label: "DRUMS",
    clockRate: sequenceRateForLane("kick", patch),
    activeLength: Math.max(
      ...WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.map(
        (lane) => sanitizedSequence.lanes[lane].activeLength,
      ),
    ),
    cellIndex: kickSequence.cellIndex,
    cellState: drumCellState,
    cellValue: drumCellState === "note" ? 1 : 0,
    stepPhase: kickSequence.stepPhase,
    note: null,
    resting: drumCellState === "rest",
    gate: drumPeak,
    cellGate: drumPeak,
    audibleGate: drumPeak,
    activity: clamp(drumPeak * drumLevelUnit, 0, 1),
    levelUnit: drumLevelUnit,
    size: clamp(0.62 + drumLevelUnit * 0.38, 0, 1),
    hue: webGpuChiptuneParamToUnit("hatBalance", patch.hatBalance),
    shape: clamp(
      (webGpuChiptuneParamToUnit("kickTone", patch.kickTone)
        + webGpuChiptuneParamToUnit("snareTone", patch.snareTone)) * 0.5,
      0,
      1,
    ),
    motionPhase: positiveModulo(drumPosition, 1),
    motion: clamp(drumPeak * 0.8 + webGpuChiptuneParamToUnit("drumRate", patch.drumRate) * 0.2, 0, 1),
    detail: clamp(
      (webGpuChiptuneParamToUnit("hatLevel", patch.hatLevel)
        + webGpuChiptuneParamToUnit("shakerLevel", patch.shakerLevel)) * 0.5,
      0,
      1,
    ),
    range: webGpuChiptuneParamToUnit("drumDecay", patch.drumDecay),
    onset: drumPeak,
    bounce: drums.kick,
    danceSteps: drumDanceSteps,
    dancePhase: drumDancePhase,
    bodyMotion: stageDrumBodyMotion(drums, drumSteps, drumLevelUnit, drumPosition),
    frame: Math.floor(drumDancePhase * 8) % 8,
  });
  const actors = Object.freeze([...voiceActors, drumActor]);
  return Object.freeze({
    timeSeconds: seconds,
    masterBeat,
    actors,
    drums,
    drumSteps,
    environment: Object.freeze({
      echo: webGpuChiptuneParamToUnit("echoWet", patch.echoWet),
      echoTaps: patch.echoTaps,
      echoDecay: webGpuChiptuneParamToUnit("echoDecay", patch.echoDecay),
      noise: webGpuChiptuneParamToUnit("noiseLevel", patch.noiseLevel),
      texture: webGpuChiptuneParamToUnit("textureSweep", patch.textureSweep),
      stereo: webGpuChiptuneParamToUnit("stereoWidth", patch.stereoWidth),
      crossfeed: webGpuChiptuneParamToUnit("voiceCrossfeed", patch.voiceCrossfeed),
    }),
  });
}

export function webGpuChiptuneStepSnapshot(
  step,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  substep = 0,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
) {
  const source = Math.floor(finiteOr(step, 0));
  const localSubstep = clamp(finiteOr(substep, 0), 0, 0.999999);
  return webGpuChiptuneBeatSnapshot((source + localSubstep) / 4, params, sequence);
}

export function formatWebGpuChiptuneValue(key, value) {
  const number = finiteOr(value, WEBGPU_CHIPTUNE_DEFAULTS[key] ?? 0);
  if (key === "tempo") return Math.round(number * 60) + " BPM";
  if (key === "tuningCents") {
    return (number >= 0 ? "+" : "") + Math.round(number) + " cents";
  }
  if (key === "transpose" || key.endsWith("Register") || key === "leadInterval") {
    return (number >= 0 ? "+" : "") + Math.round(number) + " st";
  }
  if (key === "echoAlternate") return number >= 0.5 ? "alternating" : "fixed";
  if (key === "gatePatternSteps") return Math.round(number) + " steps";
  if (key === "patternSeed") return number.toFixed(4);
  if (key === "scaleMask") {
    return "0x" + Math.round(number).toString(16).toUpperCase().padStart(3, "0");
  }
  if (key === "arpSpan") {
    return number.toFixed(Number.isInteger(number) ? 0 : 2) + " notes";
  }
  if (key.endsWith("Span")) return Math.round(number) + " notes";
  if (
    [
      "sectionUnits",
      "gateSwitchShortUnits",
      "gateSwitchLongUnits",
      "leadPhraseUnits",
      "texturePeriod",
    ].includes(key)
  ) {
    return number.toFixed(Number.isInteger(number) ? 0 : 2) + " master beats";
  }
  if (
    [
      "kickCycle",
      "kickSubcycle",
      "snareCycle",
      "hatACycle",
      "hatASubcycle",
      "hatARepeat",
      "hatBCycle",
      "shakerCycle",
    ].includes(key)
  ) {
    return number.toFixed(Number.isInteger(number) ? 0 : 2) + " drum-clock units";
  }
  if (
    [
      "pitchRange",
      "gateRate",
      "gateLength",
      "kickTone",
      "snareTone",
      "drumDecay",
      "pitchClock",
      "bassClock",
      "gateFastRatio",
      "leadTrillRate",
      "arpRate",
      "arpOctaveRate",
      "drumRate",
      "textureDecay",
      "gateShortRatio",
      "gateLongRatio",
      "leadClock",
      "arpBassFollow",
      "noiseColor",
      "fadeCurve",
      "upperTwoClockRatio",
      "bassGateRateRatio",
      "leadGateRateRatio",
      "upperTwoGateRateRatio",
      "snareNoiseColor",
      "hatANoiseColor",
      "hatBNoiseColor",
      "shakerNoiseColor",
    ].includes(key)
  ) {
    return number.toFixed(2) + "x";
  }
  if (
    [
      "noiseRate",
      "textureSweep",
      "kickBodyPhase",
      "kickTransientPhase",
      "kickBodySweep",
      "kickTransientSweep",
      "kickDecayRate",
      "kickClipKnee",
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
      "hatBDecayRate",
      "shakerNoiseRate",
      "shakerDecayRate",
    ].includes(key)
  ) {
    const magnitude = Math.abs(number);
    const precision = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : 2;
    return number.toFixed(precision);
  }
  if (
    key === "pulseWidth"
    || key === "bassPulseWidth"
    || key === "pwmDepth"
    || key.endsWith("Level")
    || [
      "drumMix",
      "ghostDrums",
      "echoDecay",
      "stereoWidth",
      "echoStereo",
      "echoCrossfeed",
      "snareNoiseMix",
      "hatBalance",
      "gain",
      "noiseLevel",
      "fastGateShare",
      "longGateBoostShare",
      "leadSectionShare",
      "leadTrillShare",
      "snarePhase",
      "hatAPhase",
      "shakerPhase",
      "voiceCrossfeed",
      "synthMix",
      "hatBHighMix",
      "echoWet",
      "arpGateDepth",
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
    ].includes(key)
  ) {
    return Math.round(number * 100) + "%";
  }
  if (key === "pwmRate") return number.toFixed(2) + " rad/s";
  if (key === "echoTaps") return Math.round(number) + " taps";
  if (key === "echoTime" || key === "fadeIn") return Math.round(number * 1000) + " ms";
  if (
    key === "gateAttack"
    || key === "gateRelease"
  ) {
    return number.toFixed(3) + " gate steps";
  }
  if (key === "kickAttackTime" || key === "snareHoldTime") {
    return Math.round(number * 1000) + " ms";
  }
  if (key === "arpOctaves") return Math.round(number) + " oct";
  if (key === "ghostDelayDivisor") return "÷" + number.toFixed(2);
  if (key === "ghostPan") {
    if (Math.abs(number) < 0.005) return "center";
    return (number < 0 ? "L " : "R ") + Math.abs(number).toFixed(2);
  }
  return number.toFixed(2);
}

export function webGpuChiptuneSupport(runtime = globalThis) {
  const AudioContextCtor = runtime.AudioContext ?? runtime.webkitAudioContext;
  const webgpu = Boolean(runtime.navigator?.gpu?.requestAdapter);
  const audio = Boolean(AudioContextCtor);
  return Object.freeze({ audio, webgpu, supported: audio && webgpu });
}

export const WEBGPU_CHIPTUNE_SHADER = `// WGSL port of "Chiptune (sound)" by srtuss (2015).
// Original Shadertoy: https://www.shadertoy.com/view/MljSRt
// Only the functions reachable from the source mainSound are rendered here.
const PI2: f32 = 6.283185307179586476925286766559;
const OUTPUT_CEILING: f32 = 0.88;
const PREVIEW_DURATION: f32 = ${WEBGPU_CHIPTUNE_PREVIEW_DURATION_SECONDS};
const PREVIEW_HOLD: f32 = 0.14;
const PREVIEW_GAIN: f32 = 1.6;

override WORKGROUP_SIZE: u32 = 256;
override SAMPLE_RATE: f32 = 44100.0;

struct TimeInfo {
  offset: f32,
  preview_lane: f32,
  preview_value: f32,
  preview_start: f32,
}
struct AudioParam {
  tempo: f32,
  transpose: f32,
  patternSeed: f32,
  pitchRange: f32,
  gateRate: f32,
  gateLength: f32,
  pulseWidth: f32,
  pwmDepth: f32,
  pwmRate: f32,
  upperOneLevel: f32,
  upperTwoLevel: f32,
  bassPulseLevel: f32,
  bassSineLevel: f32,
  leadLevel: f32,
  arpLevel: f32,
  noiseLevel: f32,
  stereoWidth: f32,
  kickLevel: f32,
  snareLevel: f32,
  hatLevel: f32,
  shakerLevel: f32,
  kickTone: f32,
  snareTone: f32,
  drumDecay: f32,
  drumMix: f32,
  ghostDrums: f32,
  echoTaps: f32,
  echoTime: f32,
  echoDecay: f32,
  echoStereo: f32,
  fadeIn: f32,
  gain: f32,
  scaleMask: f32,
  upperOneSpan: f32,
  upperTwoSpan: f32,
  bassSpan: f32,
  upperOneRegister: f32,
  bassRegister: f32,
  arpRegister: f32,
  sectionUnits: f32,
  pitchClock: f32,
  bassClock: f32,
  gateFastRatio: f32,
  gateSwitchShortUnits: f32,
  gateSwitchLongUnits: f32,
  leadTrillRate: f32,
  leadInterval: f32,
  leadPhraseUnits: f32,
  arpRate: f32,
  arpSpan: f32,
  arpOctaveRate: f32,
  arpOctaves: f32,
  bassPulseWidth: f32,
  drumRate: f32,
  echoCrossfeed: f32,
  gateAttack: f32,
  gateRelease: f32,
  texturePeriod: f32,
  textureDecay: f32,
  kickCycle: f32,
  kickSubcycle: f32,
  snareNoiseMix: f32,
  hatBalance: f32,
  ghostDelayDivisor: f32,
  ghostPan: f32,
  gateA0: f32,
  gateA1: f32,
  gateA2: f32,
  gateA3: f32,
  gateB0: f32,
  gateB1: f32,
  gateB2: f32,
  gateB3: f32,
  gatePatternSteps: f32,
  gateShortRatio: f32,
  gateLongRatio: f32,
  fastGateShare: f32,
  longGateBoostShare: f32,
  leadSectionShare: f32,
  leadTrillShare: f32,
  tuningCents: f32,
  upperTwoRegister: f32,
  leadRegister: f32,
  leadClock: f32,
  leadSpan: f32,
  arpBassFollow: f32,
  voiceCrossfeed: f32,
  synthMix: f32,
  fadeCurve: f32,
  echoAlternate: f32,
  snareCycle: f32,
  snarePhase: f32,
  hatACycle: f32,
  hatASubcycle: f32,
  hatARepeat: f32,
  hatAPhase: f32,
  hatBCycle: f32,
  shakerCycle: f32,
  shakerPhase: f32,
  noiseRate: f32,
  noiseColor: f32,
  textureSweep: f32,
  kickBodyPhase: f32,
  kickTransientPhase: f32,
  kickBodySweep: f32,
  kickTransientSweep: f32,
  kickAttackTime: f32,
  kickDecayRate: f32,
  kickClipKnee: f32,
  snareHoldTime: f32,
  snareDecayRate: f32,
  snareNoiseSweep: f32,
  snareNoiseRate: f32,
  snareModRate: f32,
  snareModDepth: f32,
  snareCarrierRate: f32,
  hatANoiseRate: f32,
  hatADecayRate: f32,
  hatBLowNoiseRate: f32,
  hatBHighNoiseRate: f32,
  hatBHighMix: f32,
  hatBDecayRate: f32,
  shakerNoiseRate: f32,
  shakerDecayRate: f32,
  upperTwoClockRatio: f32,
  kickPhase: f32,
  hatBPhase: f32,
  hatARepeatPhase: f32,
  arpPhase: f32,
  echoWet: f32,
  arpGateDepth: f32,
  bassGateRateRatio: f32,
  leadGateRateRatio: f32,
  upperTwoGateRateRatio: f32,
  snareNoiseColor: f32,
  hatANoiseColor: f32,
  hatBNoiseColor: f32,
  shakerNoiseColor: f32,
  upperOnePhase: f32,
  upperTwoPhase: f32,
  bassPhase: f32,
  leadPhase: f32,
  gatePatternPhase: f32,
  gateSwitchShortPhase: f32,
  gateSwitchLongPhase: f32,
  sectionPhase: f32,
  leadTrillPhase: f32,
  leadPhrasePhase: f32,
  arpOctavePhase: f32,
  texturePhase: f32,
}

struct SequenceMeta {
  header: vec4<u32>,
  lengths0: vec4<u32>,
  lengths1: vec4<u32>,
  lengths2: vec4<u32>,
}

struct SequenceCell {
  value: f32,
  state: u32,
  reserved0: u32,
  reserved1: u32,
}

@group(0) @binding(0) var<uniform> time_info: TimeInfo;
@group(0) @binding(1) var<storage, read_write> sound_chunk: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> audio_param: AudioParam;
@group(0) @binding(3) var<uniform> sequence_meta: SequenceMeta;
@group(0) @binding(4) var<storage, read>
  sequence_cells: array<SequenceCell, 288>;

@compute
@workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let sample_count = global_id.x;
  if (sample_count >= arrayLength(&sound_chunk)) { return; }
  let local_time = f32(sample_count) / SAMPLE_RATE;
  sound_chunk[sample_count] = mainSound(time_info.offset + local_time, audio_param);
}

fn modulo(x: f32, y: f32) -> f32 {
  return x - floor(x / y) * y;
}

fn sequenceLength(lane: u32) -> u32 {
  var length = sequence_meta.lengths2.x;
  switch lane {
    case 0u: { length = sequence_meta.lengths0.x; }
    case 1u: { length = sequence_meta.lengths0.y; }
    case 2u: { length = sequence_meta.lengths0.z; }
    case 3u: { length = sequence_meta.lengths0.w; }
    case 4u: { length = sequence_meta.lengths1.x; }
    case 5u: { length = sequence_meta.lengths1.y; }
    case 6u: { length = sequence_meta.lengths1.z; }
    case 7u: { length = sequence_meta.lengths1.w; }
    default: { length = sequence_meta.lengths2.x; }
  }
  return clamp(length, 1u, 32u);
}

fn sequenceCellAt(
  lane: u32,
  master_beat: f32,
  rate: f32,
  phase: f32,
) -> SequenceCell {
  let length = sequenceLength(lane);
  let position = modulo(
    master_beat * max(rate, 0.000001) + phase * f32(length),
    f32(length),
  );
  let local_index = min(u32(max(floor(position), 0.0)), length - 1u);
  let cell_index = lane * 32u + local_index;
  return sequence_cells[cell_index];
}

fn sequenceStepTime(
  lane: u32,
  master_beat: f32,
  rate: f32,
  tempo_hz: f32,
) -> f32 {
  let length = sequenceLength(lane);
  let position = modulo(master_beat * max(rate, 0.000001), f32(length));
  return fract(position) / max(tempo_hz * rate, 0.000001);
}

fn stepValue(edge: f32, x: f32) -> f32 {
  return select(0.0, 1.0, x >= edge);
}

// GLSL permits the descending-edge smoothsteps used by the source gate. This
// explicit form preserves that behavior without depending on WGSL edge order.
fn smoothAny(edge0: f32, edge1: f32, x: f32) -> f32 {
  let width = edge1 - edge0;
  if (abs(width) < 0.000001) { return stepValue(edge0, x); }
  let t = clamp((x - edge0) / width, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn sine(phase: f32) -> f32 {
  return sin(phase * PI2);
}

fn shns(x: f32, p: AudioParam) -> f32 {
  return fract(sin(floor(x * p.noiseRate)) * 29919.0) - 0.5;
}

fn hpns(x: f32, h: f32, p: AudioParam) -> f32 {
  let colored_h = h * p.noiseColor;
  return shns(x + colored_h, p) - shns(x - colored_h, p);
}

fn noteGate(
  t_source: f32,
  offset: f32,
  duration: f32,
  length: f32,
  pattern_steps: f32,
  attack: f32,
  release: f32,
) -> f32 {
  let pattern_period = max(round(pattern_steps), 1.0);
  let t = modulo(t_source - offset, pattern_period);
  let scaled_duration = max(0.05, duration * length);
  let attack_width = max(attack, 0.001);
  let release_width = max(release, 0.001);
  let current_gate = smoothAny(-attack_width, 0.0, t)
    * smoothAny(0.0, -release_width, t - scaled_duration);
  let next_t = t - pattern_period;
  let next_gate = smoothAny(-attack_width, 0.0, next_t)
    * smoothAny(0.0, -release_width, next_t - scaled_duration);
  return max(current_gate, next_gate);
}

fn packedGateCode(p: AudioParam, lane_b: bool, segment: u32) -> u32 {
  var code = 0.0;
  switch segment {
    case 0u: { code = select(p.gateA0, p.gateB0, lane_b); }
    case 1u: { code = select(p.gateA1, p.gateB1, lane_b); }
    case 2u: { code = select(p.gateA2, p.gateB2, lane_b); }
    default: { code = select(p.gateA3, p.gateB3, lane_b); }
  }
  return u32(clamp(round(code), 0.0, 65535.0));
}

fn packedGateDuration(p: AudioParam, lane_b: bool, step: u32) -> f32 {
  let code = packedGateCode(p, lane_b, step / 8u);
  let state = (code >> ((step % 8u) * 2u)) & 3u;
  switch state {
    case 1u: { return p.gateShortRatio; }
    case 2u: { return 1.0; }
    case 3u: { return p.gateLongRatio; }
    default: { return 0.0; }
  }
}

fn patternGate(t: f32, length: f32, p: AudioParam, lane_b: bool) -> f32 {
  var value = 0.0;
  let pattern_steps = u32(clamp(round(p.gatePatternSteps), 1.0, 32.0));
  let phased_t = t + p.gatePatternPhase * f32(pattern_steps);
  for (var step = 0u; step < 32u; step += 1u) {
    let duration = packedGateDuration(p, lane_b, step);
    if (step < pattern_steps && duration > 0.0) {
      value += noteGate(
        phased_t,
        f32(step),
        duration,
        length,
        f32(pattern_steps),
        p.gateAttack,
        p.gateRelease,
      );
    }
  }
  return clamp(value, 0.0, 1.0);
}

fn gate(t: f32, length: f32, p: AudioParam) -> f32 {
  return patternGate(t, length, p, false);
}

fn gateOne(t: f32, length: f32, p: AudioParam) -> f32 {
  return patternGate(t, length, p, true);
}

fn previewEnvelope(time: f32) -> f32 {
  let local_time = time - time_info.preview_start;
  return smoothAny(0.0, 0.004, local_time)
    * smoothAny(0.0, PREVIEW_HOLD - PREVIEW_DURATION, local_time - PREVIEW_DURATION);
}

fn blep(t_source: f32, dt_source: f32) -> f32 {
  let dt = clamp(dt_source, 0.000001, 0.5);
  if (t_source < dt) {
    let t = t_source / dt;
    return t + t - t * t - 1.0;
  }
  if (t_source > 1.0 - dt) {
    let t = (t_source - 1.0) / dt;
    return t * t + t + t + 1.0;
  }
  return 0.0;
}

fn sawWave(time: f32, frequency: f32) -> f32 {
  let phase = fract(time * frequency);
  return phase * 2.0 - 1.0 - blep(phase, frequency / SAMPLE_RATE);
}

fn squareWave(time: f32, frequency: f32, pulse_width: f32) -> f32 {
  let phase = fract(time * frequency);
  var value = select(-1.0, 1.0, phase < pulse_width);
  value += blep(phase, frequency / SAMPLE_RATE);
  value -= blep(fract(phase - pulse_width), frequency / SAMPLE_RATE);
  return value;
}

fn considerNearest(best: vec2<f32>, candidate: f32) -> vec2<f32> {
  let distance = abs(candidate);
  return select(best, vec2(distance, candidate), distance < best.x);
}

fn scaleLock(y: f32, scale_mask_source: f32) -> f32 {
  let x = modulo(y, 12.0);
  let scale_mask = u32(clamp(round(scale_mask_source), 1.0, 4095.0));
  var nearest = vec2(1e10, 0.0);
  for (var note = 0u; note <= 12u; note += 1u) {
    let pitch_class = note % 12u;
    if ((scale_mask & (1u << pitch_class)) != 0u) {
      nearest = considerNearest(nearest, x - f32(note));
    }
  }
  return y - nearest.y;
}

fn noteFrequency(note: f32, p: AudioParam) -> f32 {
  let frequency = 440.0 * pow(2.0, (note + p.tuningCents / 100.0) / 12.0);
  return clamp(frequency, 20.0, SAMPLE_RATE * 0.45);
}

fn widenStereo(value: vec2<f32>, width: f32) -> vec2<f32> {
  let middle = (value.x + value.y) * 0.5;
  let side = (value.x - value.y) * 0.5 * width;
  return vec2(middle + side, middle - side);
}

fn voiceBalance(right_voice: bool, p: AudioParam) -> vec2<f32> {
  let crossfeed = clamp(p.voiceCrossfeed, 0.0, 1.0);
  let normalization = 1.5 / (1.0 + crossfeed);
  return select(vec2(1.0, crossfeed), vec2(crossfeed, 1.0), right_voice)
    * normalization;
}

fn drumSequenceTiming(
  lane: u32,
  master_beat: f32,
  rate: f32,
  tempo_hz: f32,
  source_time: f32,
) -> vec2<f32> {
  let cell = sequenceCellAt(lane, master_beat, rate, 0.0);
  let manual_time = sequenceStepTime(lane, master_beat, rate, tempo_hz);
  let step_duration = 1.0 / max(tempo_hz * rate, 0.000001);
  let fade_start = max(0.0, step_duration - min(0.004, step_duration * 0.25));
  let manual_tail = 1.0 - smoothstep(fade_start, step_duration, manual_time);
  let activity = select(1.0, 0.0, cell.state == 2u)
    * select(1.0, manual_tail, cell.state == 1u);
  return vec2(select(source_time, manual_time, cell.state == 1u), activity);
}

fn beatTwo(time: f32, p: AudioParam) -> f32 {
  let tempo = p.tempo * max(p.drumRate, 0.01);
  let master_beat = time * p.tempo;
  let sequence_rate = max(p.drumRate, 0.01) * 4.0;
  let decay = max(p.drumDecay, 0.1);
  var value = 0.0;

  var tb = modulo(
    time * tempo - p.kickPhase * p.kickCycle,
    max(p.kickCycle, 0.05),
  );
  tb = modulo(tb, max(p.kickSubcycle, 0.05)) / tempo;
  let kick_sequence = drumSequenceTiming(
    5u, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = kick_sequence.x;
  var kick = sin(
    exp(tb * -p.kickBodySweep) * p.kickBodyPhase * p.kickTone
    + exp(tb * -p.kickTransientSweep) * p.kickTransientPhase * p.kickTone
  ) * exp(
    max(p.kickAttackTime - tb, 0.0) * (-p.kickDecayRate / decay),
  ) * exp(tb * (-p.kickDecayRate / decay));
  kick = smoothAny(-p.kickClipKnee, p.kickClipKnee, kick) * 2.0 - 1.0;
  value = kick * kick_sequence.y * 0.3 * p.kickLevel;

  tb = modulo(
    time * tempo - p.snarePhase * p.snareCycle,
    max(p.snareCycle, 0.01),
  ) / tempo;
  let snare_sequence = drumSequenceTiming(
    6u, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = snare_sequence.x;
  let snare_envelope = exp(
    max(tb - p.snareHoldTime, 0.0) * (-p.snareDecayRate / decay),
  );
  let snare_mix = clamp(p.snareNoiseMix, 0.0, 1.0);
  value += (
    hpns(
      exp(-tb * p.snareNoiseSweep) * p.snareNoiseRate,
      0.0002 * p.snareNoiseColor,
      p,
    )
      * snare_envelope * 0.9 * snare_mix
    + sin(
      sin(tb * p.snareModRate * p.snareTone) * p.snareModDepth
        + tb * p.snareCarrierRate * p.snareTone
    )
      * snare_envelope * 0.9 * (1.0 - snare_mix)
  ) * snare_sequence.y * 0.6 * p.snareLevel;

  tb = modulo(
    time * tempo + p.hatAPhase * p.hatACycle,
    max(p.hatACycle, 0.01),
  );
  tb = modulo(tb, max(p.hatASubcycle, 0.01));
  tb = modulo(
    tb - 1.0 - p.hatARepeatPhase * p.hatARepeat,
    max(p.hatARepeat, 0.01),
  ) / tempo;
  let hat_a_sequence = drumSequenceTiming(
    7u, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = hat_a_sequence.x;
  let hat_mix = clamp(p.hatBalance, 0.0, 1.0);
  value += hpns(tb * p.hatANoiseRate, 0.0002 * p.hatANoiseColor, p)
    * exp(tb * (-p.hatADecayRate / decay))
    * hat_a_sequence.y * 0.45 * (1.0 - hat_mix) * p.hatLevel;

  tb = modulo(
    time * tempo - p.hatBPhase * p.hatBCycle,
    max(p.hatBCycle, 0.01),
  ) / tempo;
  let hat_b_sequence = drumSequenceTiming(
    7u, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = hat_b_sequence.x;
  value += (
    hpns(tb * p.hatBLowNoiseRate, 0.00002 * p.hatBNoiseColor, p)
      + hpns(tb * p.hatBHighNoiseRate, 0.002 * p.hatBNoiseColor, p)
        * p.hatBHighMix
  ) * exp(tb * (-p.hatBDecayRate / decay))
    * hat_b_sequence.y * 0.45 * hat_mix * p.hatLevel;

  tb = modulo(
    time * tempo - p.shakerPhase * p.shakerCycle,
    max(p.shakerCycle, 0.01),
  ) / tempo;
  let shaker_sequence = drumSequenceTiming(
    8u, master_beat, sequence_rate, p.tempo, tb,
  );
  tb = shaker_sequence.x;
  value += hpns(tb * p.shakerNoiseRate, 0.0002 * p.shakerNoiseColor, p)
    * exp(tb * (-p.shakerDecayRate / decay))
    * shaker_sequence.y * 0.3 * p.shakerLevel;
  return value;
}

fn previewVoice(
  time: f32,
  p: AudioParam,
  pulse_width: f32,
  bass_basis: f32,
) -> vec2<f32> {
  let envelope = previewEnvelope(time);
  if (time_info.preview_lane < 0.0 || envelope <= 0.0) {
    return vec2(0.0);
  }
  let lane = u32(clamp(round(time_info.preview_lane), 0.0, 4.0));
  let master_beat = time * p.tempo;
  var preview_note = scaleLock(time_info.preview_value, p.scaleMask);
  switch lane {
    case 0u: {
      preview_note += p.upperOneRegister + p.transpose;
      return squareWave(time, noteFrequency(preview_note, p), pulse_width)
        * envelope
        * p.upperOneLevel
        * widenStereo(voiceBalance(false, p), p.stereoWidth);
    }
    case 1u: {
      preview_note += p.upperTwoRegister + p.transpose;
      return squareWave(time, noteFrequency(preview_note, p), pulse_width)
        * envelope
        * p.upperTwoLevel
        * widenStereo(voiceBalance(true, p), p.stereoWidth);
    }
    case 2u: {
      preview_note += p.bassRegister + p.transpose;
      let preview_frequency = noteFrequency(preview_note, p);
      let preview_bass = squareWave(time, preview_frequency, p.bassPulseWidth)
          * 1.5 * p.bassPulseLevel
        + sine(time * preview_frequency) * 2.0 * p.bassSineLevel;
      return vec2(preview_bass * envelope);
    }
    case 3u: {
      preview_note += stepValue(
          1.0 - p.leadTrillShare,
          fract(master_beat * p.leadTrillRate + p.leadTrillPhase),
        )
          * p.leadInterval
        + p.leadRegister
        + p.transpose;
      return vec2(
        sawWave(time, noteFrequency(preview_note, p))
          * envelope
          * 1.5
          * p.leadLevel,
      );
    }
    case 4u: {
      let arp_span = max(p.arpSpan, 0.01);
      preview_note = scaleLock(
        clamp(time_info.preview_value, 0.0, 1.0) * arp_span * p.pitchRange,
        p.scaleMask,
      )
        + bass_basis * p.arpBassFollow
        + floor(
          abs(
            modulo(
              master_beat * p.arpOctaveRate + p.arpOctavePhase * 2.0,
              2.0,
            ) - 1.0,
          ) * p.arpOctaves,
        )
          * 12.0
        + p.arpRegister
        + p.transpose;
      return sawWave(time, noteFrequency(preview_note, p))
        * p.arpLevel
        * envelope
        * widenStereo(voiceBalance(true, p), p.stereoWidth);
    }
    default: {}
  }
  return vec2(0.0);
}

fn synthVoices(time: f32, p: AudioParam) -> vec2<f32> {
  let tempo = p.tempo;
  let master_beat = time * tempo;
  let pulse_width = clamp(
    sin(time * p.pwmRate) * p.pwmDepth + p.pulseWidth,
    0.02,
    0.98,
  );
  let short_gate_switch = fract(
    master_beat / max(p.gateSwitchShortUnits, 0.01) + p.gateSwitchShortPhase,
  );
  let long_gate_switch = fract(
    master_beat / max(p.gateSwitchLongUnits, 0.01) + p.gateSwitchLongPhase,
  );
  let p0 = stepValue(
    1.0 - p.fastGateShare,
    short_gate_switch,
  );
  let p1 = max(
    stepValue(
      1.0 - p.fastGateShare,
      short_gate_switch,
    ),
    1.0 - stepValue(
      p.longGateBoostShare,
      long_gate_switch,
    ),
  );
  let section = stepValue(
    p.leadSectionShare,
    fract(master_beat / max(p.sectionUnits, 0.01) + p.sectionPhase),
  );
  let gate_rate = p.gateRate;
  let upper_one_cell = sequenceCellAt(
    0u,
    master_beat,
    p.pitchClock,
    p.upperOnePhase,
  );
  let upper_one_source = floor(
    master_beat * p.pitchClock
      + p.upperOnePhase * f32(sequenceLength(0u)),
  );
  let upper_one_generated = floor(
    fract(upper_one_source * upper_one_source * p.patternSeed)
      * p.upperOneSpan * p.pitchRange,
  );
  let upper_one_input = select(
    upper_one_generated,
    upper_one_cell.value,
    upper_one_cell.state == 1u,
  );

  var note = scaleLock(upper_one_input, p.scaleMask);
  note = note + p.upperOneRegister + p.transpose;
  let first_gate = gate(
      master_beat * 8.0 * mix(1.0, p.gateFastRatio, p0) * gate_rate,
      p.gateLength,
      p,
    ) * section;
  let first = squareWave(time, noteFrequency(note, p), pulse_width)
    * first_gate
    * p.upperOneLevel
    * select(1.0, 0.0, upper_one_cell.state == 2u);
  var value = first * widenStereo(voiceBalance(false, p), p.stereoWidth);

  let upper_two_rate = p.pitchClock * p.upperTwoClockRatio;
  let upper_two_cell = sequenceCellAt(
    1u,
    master_beat,
    upper_two_rate,
    p.upperTwoPhase,
  );
  let upper_two_source = floor(
    master_beat * upper_two_rate
      + p.upperTwoPhase * f32(sequenceLength(1u)),
  );
  let upper_two_generated = floor(
    fract(upper_two_source * upper_two_source * p.patternSeed)
      * p.upperTwoSpan * p.pitchRange,
  );
  let upper_two_input = select(
    upper_two_generated,
    upper_two_cell.value,
    upper_two_cell.state == 1u,
  );
  note = scaleLock(upper_two_input, p.scaleMask);
  note += p.upperTwoRegister + p.transpose;
  let second_gate = gate(
      master_beat
        * 8.0
        * mix(1.0, p.gateFastRatio, p1)
        * gate_rate
        * p.upperTwoGateRateRatio,
      p.gateLength,
      p,
    ) * section;
  let second = squareWave(time, noteFrequency(note, p), pulse_width)
    * second_gate
    * p.upperTwoLevel
    * select(1.0, 0.0, upper_two_cell.state == 2u);
  value += second * widenStereo(voiceBalance(true, p), p.stereoWidth);

  let bass_cell = sequenceCellAt(2u, master_beat, p.bassClock, p.bassPhase);
  let bass_source = floor(
    master_beat * p.bassClock
      + p.bassPhase * f32(sequenceLength(2u)),
  );
  let bass_generated = floor(
    fract(bass_source * bass_source * p.patternSeed) * p.bassSpan * p.pitchRange,
  );
  let bass_input = select(
    bass_generated,
    bass_cell.value,
    bass_cell.state == 1u,
  );
  note = scaleLock(bass_input, p.scaleMask);
  let bass_basis = note;
  note = note + p.bassRegister + p.transpose;
  let bass_frequency = noteFrequency(note, p);
  let bass_pattern_gate = gate(
    master_beat * 8.0 * gate_rate * p.bassGateRateRatio,
    p.gateLength,
    p,
  );
  let bass_gate = bass_pattern_gate;
  let bass_active = select(1.0, 0.0, bass_cell.state == 2u);
  value += vec2(squareWave(time, bass_frequency, p.bassPulseWidth)
    * bass_gate * bass_active * 1.5 * p.bassPulseLevel);
  value += vec2(sine(time * bass_frequency)
    * bass_gate * bass_active * 2.0 * p.bassSineLevel);

  let lead_cell = sequenceCellAt(3u, master_beat, p.leadClock, p.leadPhase);
  let lead_source = floor(
    master_beat * p.leadClock
      + p.leadPhase * f32(sequenceLength(3u)),
  );
  let lead_generated = floor(
    fract(lead_source * lead_source * p.patternSeed) * p.leadSpan * p.pitchRange,
  );
  let lead_input = select(
    lead_generated,
    lead_cell.value,
    lead_cell.state == 1u,
  );
  note = scaleLock(lead_input, p.scaleMask);
  note += stepValue(
      1.0 - p.leadTrillShare,
      fract(master_beat * p.leadTrillRate + p.leadTrillPhase),
    )
      * p.leadInterval
    + p.leadRegister
    + p.transpose;
  let lead_phrase_units = max(p.leadPhraseUnits, 0.01);
  let lead_gate = gateOne(
      modulo(master_beat + p.leadPhrasePhase * lead_phrase_units, lead_phrase_units)
        * 8.0
        * gate_rate
        * p.leadGateRateRatio,
      p.gateLength,
      p,
    ) * (1.0 - section);
  let lead = sawWave(time, noteFrequency(note, p))
    * lead_gate
    * 1.5
    * p.leadLevel
    * select(1.0, 0.0, lead_cell.state == 2u);
  value += vec2(lead);

  let arp_span = max(p.arpSpan, 0.01);
  let arp_cell = sequenceCellAt(4u, master_beat, p.arpRate, p.arpPhase);
  let arp_generated = abs(
    modulo(
      master_beat * p.arpRate + p.arpPhase * arp_span * 2.0,
      arp_span * 2.0,
    ) - arp_span,
  );
  let arp_contour = select(
    arp_generated,
    clamp(arp_cell.value, 0.0, 1.0) * arp_span,
    arp_cell.state == 1u,
  );
  note = scaleLock(arp_contour * p.pitchRange, p.scaleMask)
    + bass_basis * p.arpBassFollow
    + floor(
      abs(
        modulo(master_beat * p.arpOctaveRate + p.arpOctavePhase * 2.0, 2.0) - 1.0,
      )
        * p.arpOctaves,
    )
      * 12.0
    + p.arpRegister
    + p.transpose;
  let arp_gate = mix(1.0, bass_pattern_gate, p.arpGateDepth);
  let arp = sawWave(time, noteFrequency(note, p))
    * p.arpLevel
    * arp_gate
    * select(1.0, 0.0, arp_cell.state == 2u);
  value += arp * widenStereo(voiceBalance(true, p), p.stereoWidth);
  let preview_envelope = previewEnvelope(time);
  value *= mix(1.0, 0.22, preview_envelope);
  value += previewVoice(time, p, pulse_width, bass_basis) * PREVIEW_GAIN;

  let texture_period = max(p.texturePeriod, 0.01);
  let noise_time = modulo(
    master_beat + p.texturePhase * texture_period,
    texture_period,
  );
  value += vec2(hpns(exp(noise_time * -p.textureSweep), 0.0002, p)
    * exp(noise_time * -p.textureDecay) * p.noiseLevel);
  return value * 0.2 * p.synthMix;
}

fn mainSound(time: f32, p: AudioParam) -> vec2<f32> {
  var value = vec2(0.0);
  var amplitude = 1.0;
  var swap_channels = false;
  var delay_time = 0.0;
  let tap_count = u32(clamp(round(p.echoTaps), 1.0, 8.0));
  for (var tap = 0u; tap < 8u; tap += 1u) {
    if (tap < tap_count) {
      let source = synthVoices(time - delay_time, p);
      let swapped = select(source, source.yx, swap_channels);
      let crossfeed = clamp(p.echoCrossfeed, 0.0, 1.0);
      let balance = select(vec2(1.0, crossfeed), vec2(crossfeed, 1.0), swap_channels);
      let wet = select(1.0, p.echoWet, tap > 0u);
      value += widenStereo(swapped * balance, p.echoStereo) * amplitude * wet;
      if (p.echoAlternate >= 0.5) {
        swap_channels = !swap_channels;
      }
      amplitude *= p.echoDecay;
      delay_time += p.echoTime;
    }
  }

  let ghost_pan = clamp(p.ghostPan, -1.0, 1.0);
  let ghost_balance = vec2(0.25 * (1.0 - ghost_pan), 0.25 * (1.0 + ghost_pan));
  let drums = beatTwo(time, p) * vec2(0.8)
    + beatTwo(time - p.tempo / max(p.ghostDelayDivisor, 0.25), p)
      * ghost_balance * p.ghostDrums;
  let preview_duck = mix(1.0, 0.22, previewEnvelope(time));
  value += drums * p.drumMix * preview_duck;

  let fade = pow(
    clamp(max(time, 0.0) / max(p.fadeIn, 0.01), 0.0, 1.0),
    max(p.fadeCurve, 0.01),
  );
  let output = value * fade * p.gain;
  return clamp(output, vec2(-OUTPUT_CEILING), vec2(OUTPUT_CEILING));
}`;

function requireGpuConstants(runtime) {
  const usage = runtime.GPUBufferUsage ?? globalThis.GPUBufferUsage;
  const mapMode = runtime.GPUMapMode ?? globalThis.GPUMapMode;
  if (!usage || !mapMode) {
    throw new Error("WebGPU constants are not available in this browser context.");
  }
  return { usage, mapMode };
}

export class WebGpuChiptuneAudio {
  constructor(runtime = globalThis, {
    chunkDuration = WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.chunkDuration,
    workgroupSize = WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.workgroupSize,
  } = {}) {
    this.runtime = runtime;
    this.chunkDurationInSeconds = clamp(finiteOr(chunkDuration, 0.1), 0.03, 0.5);
    this.workgroupSize = WEBGPU_CHIPTUNE_WORKGROUP_SIZES.includes(Number(workgroupSize))
      ? Number(workgroupSize)
      : WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.workgroupSize;
    this.context = null;
    this.input = null;
    this.master = null;
    this.releaseAudioOutput = null;
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.timeInfoBuffer = null;
    this.chunkBuffer = null;
    this.chunkMapBuffer = null;
    this.audioParamBuffer = null;
    this.sequenceMetaBuffer = null;
    this.sequenceCellBuffer = null;
    this.chunkNumSamplesPerChannel = 0;
    this.chunkNumSamples = 0;
    this.chunkBufferSize = 0;
    this.sampleRate = 44100;
    this.renderOffset = 0;
    this.nextStartTime = 0;
    this.timeoutId = null;
    this.refreshTimeoutId = null;
    this.paramRevision = 0;
    this.sequenceRevision = 0;
    this.renderRevision = 0;
    this.previewSerial = 0;
    this.pendingPreview = null;
    this.renderingPromise = null;
    this.running = false;
    this.playbackEnabled = false;
    this.output = WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.output;
    this.params = sanitizeWebGpuChiptuneParams();
    this.sequence = createWebGpuChiptuneSequence();
    this.sources = new Set();
    this.scheduledChunks = [];
    this.onError = null;
    this.ownsContext = false;
    this.destination = null;
  }

  setErrorHandler(handler) {
    this.onError = typeof handler === "function" ? handler : null;
  }

  async start(params = this.params, options = {}) {
    if (
      params
      && typeof params === "object"
      && (
        params.context
        || params.audioContext
        || params.destination
        || "autoStart" in params
        || "offset" in params
        || "startAt" in params
        || "sequence" in params
      )
      && arguments.length < 2
    ) {
      options = params;
      params = this.params;
    }
    if (this.context) await this.stop();

    const support = webGpuChiptuneSupport(this.runtime);
    const externalContext = options.context ?? options.audioContext ?? null;
    if (!externalContext && !support.audio) {
      throw new Error("Web Audio is not available in this browser.");
    }
    if (!support.webgpu) throw new Error("WebGPU is not available in this browser.");

    this.params = sanitizeWebGpuChiptuneParams(params);
    this.sequence = sanitizeWebGpuChiptuneSequence(options.sequence ?? this.sequence);
    this.ownsContext = !externalContext;
    if (externalContext) {
      this.context = externalContext;
    } else {
      const AudioContextCtor = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      this.context = new AudioContextCtor();
    }
    try {
      if (
        this.ownsContext
        && this.context.state === "suspended"
        && typeof this.context.resume === "function"
      ) {
        await this.context.resume();
      }
      this.sampleRate = this.context.sampleRate;
      this.destination = options.destination ?? null;
      this.createAudioGraph(this.destination);
      await this.initGpu();
      this.updateParams(this.params);
      this.updateSequence(this.sequence);
      this.setOutput(this.output);
      this.renderOffset = Math.max(0, finiteOr(options.offset, 0));
      this.nextStartTime = Number.isFinite(Number(options.startAt))
        ? Math.max(this.context.currentTime, Number(options.startAt))
        : this.context.currentTime + 0.06;
      this.scheduledChunks = [];
      this.running = options.autoStart !== false;
      if (this.running) {
        const prime = this.fillBuffer({ forceFirstChunk: true, maxChunks: 1 });
        this.renderingPromise = prime;
        try {
          await prime;
        } finally {
          if (this.renderingPromise === prime) this.renderingPromise = null;
        }
        this.queueFill();
      }
      return this.context;
    } catch (error) {
      await this.stop().catch(() => {});
      throw error;
    }
  }

  createAudioGraph(destination = null) {
    if (!this.context) return;
    const input = this.context.createGain();
    const master = this.context.createGain();
    input.gain.value = 1;
    master.gain.value = this.playbackEnabled ? this.output : 0;
    input.connect(master);
    if (destination) {
      master.connect(destination);
      this.releaseAudioOutput = () => {
        try {
          master.disconnect?.(destination);
        } catch {
          // The shared graph or destination may already have been torn down.
        }
      };
    } else {
      this.releaseAudioOutput = connectAudioOutput(this.context, master, { runtime: this.runtime });
    }
    this.input = input;
    this.master = master;
  }

  async initGpu() {
    if (!this.context) throw new Error("Audio must be initialized before WebGPU.");
    const { usage } = requireGpuConstants(this.runtime);
    const adapter = await this.runtime.navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter was found.");
    this.device = await adapter.requestDevice();
    this.chunkNumSamplesPerChannel = Math.max(
      128,
      Math.round(this.sampleRate * this.chunkDurationInSeconds),
    );
    this.chunkNumSamples = NUM_CHANNELS * this.chunkNumSamplesPerChannel;
    this.chunkBufferSize = this.chunkNumSamples * Float32Array.BYTES_PER_ELEMENT;
    this.timeInfoBuffer = this.device.createBuffer({
      size: TIME_INFO_BUFFER_SIZE,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.chunkBuffer = this.device.createBuffer({
      size: this.chunkBufferSize,
      usage: usage.STORAGE | usage.COPY_SRC,
    });
    this.chunkMapBuffer = this.device.createBuffer({
      size: this.chunkBufferSize,
      usage: usage.MAP_READ | usage.COPY_DST,
    });
    this.audioParamBuffer = this.device.createBuffer({
      size: PARAM_BUFFER_SIZE,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    this.sequenceMetaBuffer = this.device.createBuffer({
      size: SEQUENCE_META_BUFFER_SIZE,
      usage: usage.UNIFORM | usage.COPY_DST,
    });
    this.sequenceCellBuffer = this.device.createBuffer({
      size: SEQUENCE_CELL_BUFFER_SIZE,
      usage: usage.STORAGE | usage.COPY_DST,
    });
    const shaderModule = this.device.createShaderModule({ code: WEBGPU_CHIPTUNE_SHADER });
    this.pipeline = this.device.createComputePipeline({
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "synthesize",
        constants: {
          SAMPLE_RATE: this.sampleRate,
          WORKGROUP_SIZE: this.workgroupSize,
        },
      },
    });
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.timeInfoBuffer } },
        { binding: 1, resource: { buffer: this.chunkBuffer } },
        { binding: 2, resource: { buffer: this.audioParamBuffer } },
        { binding: 3, resource: { buffer: this.sequenceMetaBuffer } },
        { binding: 4, resource: { buffer: this.sequenceCellBuffer } },
      ],
    });
  }

  updateParams(params = this.params) {
    this.params = sanitizeWebGpuChiptuneParams(params);
    this.paramRevision += 1;
    this.renderRevision += 1;
    if (this.device && this.audioParamBuffer) {
      this.device.queue.writeBuffer(this.audioParamBuffer, 0, webGpuChiptuneParamArray(this.params));
    }
    if (this.running) this.scheduleRenderRefresh();
  }

  updateSequence(sequence = this.sequence) {
    this.pendingPreview = null;
    this.sequence = sanitizeWebGpuChiptuneSequence(sequence);
    this.sequenceRevision += 1;
    this.renderRevision += 1;
    if (this.device && this.sequenceMetaBuffer && this.sequenceCellBuffer) {
      const packed = packWebGpuChiptuneSequence(this.sequence, this.sequenceRevision);
      this.device.queue.writeBuffer(this.sequenceMetaBuffer, 0, packed.meta);
      this.device.queue.writeBuffer(this.sequenceCellBuffer, 0, packed.cells);
    }
    if (this.running) this.scheduleRenderRefresh();
  }

  auditionSequenceCell(lane, value) {
    const laneIndex = sequenceLaneIndex.get(lane);
    if (
      laneIndex === undefined
      || WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane)
      || !this.running
      || !this.playbackEnabled
      || !this.context
    ) return false;
    const previewValue = webGpuChiptuneSequenceEditorValue(
      lane,
      webGpuChiptuneSequenceEditorUnit(lane, value),
    );
    this.previewSerial += 1;
    this.pendingPreview = Object.freeze({
      lane: laneIndex,
      value: previewValue,
      serial: this.previewSerial,
      startOffset: null,
    });
    this.renderRevision += 1;
    this.scheduleRenderRefresh();
    return true;
  }

  scheduleParamRefresh() {
    this.scheduleRenderRefresh();
  }

  scheduleRenderRefresh() {
    if (!this.running || this.refreshTimeoutId !== null) return;
    const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
    this.refreshTimeoutId = setTimer(() => {
      this.refreshTimeoutId = null;
      if (!this.running) return;
      this.refreshScheduledParams();
    }, INTERACTIVE_REFRESH_DELAY_MS);
  }

  refreshScheduledParams() {
    if (!this.running || !this.context) return;
    const now = finiteOr(this.context.currentTime, 0);
    const keepThrough = now + REFRESH_CONTINUITY_SECONDS;
    const requestedStartAt = this.nextStartTime;
    const requestedOffset = this.renderOffset;
    const playbackTime = this.currentPlaybackTime();
    const activeChunks = this.scheduledChunks.filter((chunk) => chunk.endAt > now);
    const queuedPrerollAnchor = activeChunks.length > 0
      && activeChunks.every((chunk) => chunk.startAt > now)
      ? activeChunks.reduce((earliest, chunk) => (
        chunk.startAt < earliest.startAt ? chunk : earliest
      )) : null;
    const renderingPrerollAnchor = activeChunks.length === 0
      && requestedStartAt > keepThrough
      ? { startAt: requestedStartAt, offset: requestedOffset }
      : null;
    const prerollAnchor = queuedPrerollAnchor ?? renderingPrerollAnchor;
    const kept = [];
    for (const chunk of this.scheduledChunks) {
      if (chunk.endAt <= now) {
        this.sources.delete(chunk.source);
        continue;
      }
      if (chunk.startAt <= keepThrough) {
        kept.push(chunk);
        continue;
      }
      chunk.source.onended = null;
      try {
        chunk.source.stop?.(now);
      } catch {
        // A source can finish between the timeline check and cancellation.
      }
      try {
        chunk.source.disconnect?.();
      } catch {
        // The source can already be disconnected by its host implementation.
      }
      this.sources.delete(chunk.source);
    }
    this.scheduledChunks = kept;
    const anchor = kept.at(-1);
    if (anchor) {
      this.nextStartTime = anchor.endAt;
      this.renderOffset = anchor.offset + anchor.duration;
    } else if (prerollAnchor) {
      this.nextStartTime = prerollAnchor.startAt;
      this.renderOffset = prerollAnchor.offset;
    } else {
      this.nextStartTime = now + 0.012;
      this.renderOffset = Math.max(0, finiteOr(playbackTime, this.renderOffset));
    }
    if (this.timeoutId !== null) {
      const clearTimer = this.runtime.clearTimeout ?? globalThis.clearTimeout;
      clearTimer(this.timeoutId);
      this.timeoutId = null;
    }
    this.queueFill();
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, WEBGPU_CHIPTUNE_RUNTIME_DEFAULTS.output), 0, 1);
    this.applyOutputGain();
  }

  setPlaybackEnabled(enabled) {
    this.playbackEnabled = Boolean(enabled);
    this.applyOutputGain();
  }

  applyOutputGain() {
    if (this.master && this.context) {
      setTarget(this.master.gain, this.playbackEnabled ? this.output : 0, this.context.currentTime, 0.018);
    }
  }

  queueFill(delay = 0) {
    if (!this.running || this.renderingPromise || this.timeoutId !== null) return;
    const setTimer = this.runtime.setTimeout ?? globalThis.setTimeout;
    this.timeoutId = setTimer(() => {
      this.timeoutId = null;
      const task = this.fillBuffer()
        .catch((error) => this.handleRenderError(error))
        .finally(() => {
          if (this.renderingPromise === task) {
            this.renderingPromise = null;
            if (this.running) this.queueFill(this.chunkDurationInSeconds * 220);
          }
        });
      this.renderingPromise = task;
    }, Math.max(0, delay));
  }

  async fillBuffer({ forceFirstChunk = false, maxChunks = Number.POSITIVE_INFINITY } = {}) {
    if (!this.context || !this.input) return;
    const scheduleHorizon = this.chunkDurationInSeconds * MAX_BUFFERED_CHUNKS + 0.05;
    const chunkLimit = Number.isFinite(Number(maxChunks))
      ? Math.max(1, Math.trunc(Number(maxChunks)))
      : Number.POSITIVE_INFINITY;
    let scheduledChunkCount = 0;
    while (
      this.running
      && this.context
      && scheduledChunkCount < chunkLimit
      && (
        (scheduledChunkCount === 0 && forceFirstChunk)
        || (this.nextStartTime - this.context.currentTime) < scheduleHorizon
      )
    ) {
      const chunkOffset = this.renderOffset;
      const revision = this.renderRevision;
      const paramsSnapshot = { ...this.params };
      const sequenceSnapshot = this.sequence;
      let previewSnapshot = this.pendingPreview;
      if (previewSnapshot && !Number.isFinite(previewSnapshot.startOffset)) {
        const anchoredPreview = Object.freeze({
          ...previewSnapshot,
          startOffset: chunkOffset,
        });
        if (this.pendingPreview === previewSnapshot) {
          this.pendingPreview = anchoredPreview;
        }
        previewSnapshot = anchoredPreview;
      }
      const chunkData = await this.renderChunk(
        chunkOffset,
        paramsSnapshot,
        sequenceSnapshot,
        revision,
        previewSnapshot,
      );
      if (!this.running || !this.context || !this.input) return;
      if (
        revision !== this.renderRevision
        && this.nextStartTime > this.context.currentTime + REFRESH_CONTINUITY_SECONDS
      ) return;
      const audioBuffer = this.context.createBuffer(
        NUM_CHANNELS,
        this.chunkNumSamplesPerChannel,
        this.sampleRate,
      );
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      for (let sample = 0; sample < audioBuffer.length; sample += 1) {
        left[sample] = chunkData[sample * NUM_CHANNELS];
        right[sample] = chunkData[sample * NUM_CHANNELS + 1];
      }
      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.input);
      source.onended = () => {
        this.sources.delete(source);
        this.scheduledChunks = this.scheduledChunks.filter((chunk) => chunk.source !== source);
      };
      this.sources.add(source);
      const startAt = Math.max(this.context.currentTime + 0.012, this.nextStartTime);
      const endAt = startAt + audioBuffer.duration;
      this.scheduledChunks.push({
        source,
        offset: chunkOffset,
        startAt,
        endAt,
        duration: audioBuffer.duration,
        revision,
      });
      source.start(startAt);
      const previewTapCount = Math.max(
        1,
        Math.min(8, Math.round(finiteOr(paramsSnapshot.echoTaps, 1))),
      );
      const previewTailSeconds = WEBGPU_CHIPTUNE_PREVIEW_DURATION_SECONDS
        + (previewTapCount - 1) * Math.max(0, finiteOr(paramsSnapshot.echoTime, 0));
      if (
        previewSnapshot
        && this.pendingPreview === previewSnapshot
        && chunkOffset + audioBuffer.duration
          >= previewSnapshot.startOffset + previewTailSeconds
      ) {
        this.pendingPreview = null;
      }
      scheduledChunkCount += 1;
      this.nextStartTime = endAt;
      this.renderOffset = chunkOffset + audioBuffer.duration;
    }
  }

  currentPlaybackTime() {
    if (!this.context || !this.running) return null;
    const now = finiteOr(this.context.currentTime, 0);
    this.scheduledChunks = this.scheduledChunks.filter((chunk) => chunk.endAt >= now - 0.1);
    const current = this.scheduledChunks.find((chunk) => now >= chunk.startAt && now < chunk.endAt);
    if (current) return Math.max(0, current.offset + now - current.startAt);
    const next = this.scheduledChunks.find((chunk) => now < chunk.startAt);
    if (next) return Math.max(0, next.offset);
    const last = this.scheduledChunks.at(-1);
    if (last) {
      return Math.max(0, last.offset + clamp(now - last.startAt, 0, last.duration));
    }
    return Math.max(0, this.renderOffset);
  }

  async renderChunk(
    offset,
    paramsSnapshot = this.params,
    sequenceSnapshot = this.sequence,
    revision = this.renderRevision,
    previewSnapshot = null,
  ) {
    if (
      !this.device
      || !this.timeInfoBuffer
      || !this.chunkBuffer
      || !this.chunkMapBuffer
      || !this.audioParamBuffer
      || !this.sequenceMetaBuffer
      || !this.sequenceCellBuffer
      || !this.pipeline
      || !this.bindGroup
    ) {
      throw new Error("WebGPU renderer is not initialized.");
    }
    const { mapMode } = requireGpuConstants(this.runtime);
    const packedSequence = packWebGpuChiptuneSequence(sequenceSnapshot, revision);
    this.device.queue.writeBuffer(this.timeInfoBuffer, 0, new Float32Array([
      offset,
      previewSnapshot?.lane ?? -1,
      previewSnapshot?.value ?? 0,
      previewSnapshot?.startOffset ?? -1,
    ]));
    this.device.queue.writeBuffer(this.audioParamBuffer, 0, webGpuChiptuneParamArray(paramsSnapshot));
    this.device.queue.writeBuffer(this.sequenceMetaBuffer, 0, packedSequence.meta);
    this.device.queue.writeBuffer(this.sequenceCellBuffer, 0, packedSequence.cells);
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.chunkNumSamplesPerChannel / this.workgroupSize));
    pass.end();
    commandEncoder.copyBufferToBuffer(
      this.chunkBuffer,
      0,
      this.chunkMapBuffer,
      0,
      this.chunkBufferSize,
    );
    this.device.queue.submit([commandEncoder.finish()]);
    await this.chunkMapBuffer.mapAsync(mapMode.READ, 0, this.chunkBufferSize);
    const chunkData = new Float32Array(this.chunkNumSamples);
    chunkData.set(new Float32Array(this.chunkMapBuffer.getMappedRange(0, this.chunkBufferSize)));
    this.chunkMapBuffer.unmap();
    return chunkData;
  }

  handleRenderError(error) {
    this.running = false;
    this.clearQueueTimer();
    this.stopScheduledSources();
    if (this.master && this.context) {
      setTarget(this.master.gain, 0, this.context.currentTime, 0.008);
    }
    this.onError?.(error);
  }

  clearQueueTimer() {
    const clearTimer = this.runtime.clearTimeout ?? globalThis.clearTimeout;
    if (this.timeoutId !== null) clearTimer(this.timeoutId);
    if (this.refreshTimeoutId !== null) clearTimer(this.refreshTimeoutId);
    this.timeoutId = null;
    this.refreshTimeoutId = null;
  }

  stopScheduledSources(when = this.context?.currentTime) {
    for (const source of this.sources) {
      try {
        source.stop?.(when);
      } catch {
        // Already ended.
      }
      try {
        source.disconnect?.();
      } catch {
        // Already disconnected.
      }
    }
    this.sources.clear();
    this.scheduledChunks = [];
  }

  pauseTimeline() {
    const playbackTime = this.currentPlaybackTime();
    this.running = false;
    this.pendingPreview = null;
    this.clearQueueTimer();
    this.stopScheduledSources();
    if (playbackTime !== null) this.renderOffset = playbackTime;
    if (this.context) this.nextStartTime = this.context.currentTime;
    return this.renderOffset;
  }

  pause() {
    return this.pauseTimeline();
  }

  async restartTimeline({ startAt, offset = 0 } = {}) {
    if (!this.context || !this.input || !this.device) {
      throw new Error("WebGPU audio must be initialized before restarting its timeline.");
    }
    this.running = false;
    this.clearQueueTimer();
    const render = this.renderingPromise;
    if (render) await render.catch(() => {});
    this.stopScheduledSources();
    this.renderOffset = Math.max(0, finiteOr(offset, 0));
    this.nextStartTime = Number.isFinite(Number(startAt))
      ? Math.max(this.context.currentTime, Number(startAt))
      : this.context.currentTime + 0.012;
    this.running = true;
    const prime = this.fillBuffer({ forceFirstChunk: true, maxChunks: 1 });
    this.renderingPromise = prime;
    try {
      await prime;
    } catch (error) {
      this.running = false;
      throw error;
    } finally {
      if (this.renderingPromise === prime) this.renderingPromise = null;
    }
    const actualStartTime = this.scheduledChunks[0]?.startAt ?? this.nextStartTime;
    this.queueFill();
    return actualStartTime;
  }

  async restart(options = {}) {
    return this.restartTimeline(options);
  }

  async stop() {
    this.running = false;
    this.pendingPreview = null;
    this.clearQueueTimer();
    const render = this.renderingPromise;
    if (render) await render.catch(() => {});
    this.stopScheduledSources();
    const context = this.context;
    const ownsContext = this.ownsContext;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    this.destination = null;
    this.ownsContext = false;
    if (ownsContext && context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
    this.destroyGpuResources();
  }

  destroyGpuResources() {
    for (const buffer of [
      this.timeInfoBuffer,
      this.chunkBuffer,
      this.chunkMapBuffer,
      this.audioParamBuffer,
      this.sequenceMetaBuffer,
      this.sequenceCellBuffer,
    ]) {
      try {
        buffer?.destroy?.();
      } catch {
        // Some browsers reject destroying a mapped/readback buffer during teardown.
      }
    }
    try {
      this.device?.destroy?.();
    } catch {
      // Device.destroy is not universally implemented.
    }
    this.device = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.timeInfoBuffer = null;
    this.chunkBuffer = null;
    this.chunkMapBuffer = null;
    this.audioParamBuffer = null;
    this.sequenceMetaBuffer = null;
    this.sequenceCellBuffer = null;
  }
}

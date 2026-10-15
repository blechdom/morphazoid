import {
  WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES,
  WEBGPU_CHIPTUNE_INTEGER_PARAMS,
  WEBGPU_CHIPTUNE_LIMITS,
  WEBGPU_CHIPTUNE_PARAM_ORDER,
  WEBGPU_CHIPTUNE_PERFORMANCE_LANES,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES,
  WEBGPU_CHIPTUNE_SEQUENCE_STEPS,
  createWebGpuChiptunePattern,
  sanitizeWebGpuChiptuneDrumMix,
  sanitizeWebGpuChiptuneParams,
  sanitizeWebGpuChiptunePerformance,
  sanitizeWebGpuChiptuneSequence,
  webGpuChiptuneParamFromUnit,
  webGpuChiptuneParamToUnit,
} from "../../instruments/webgpu-chiptune/webgpu-chiptune.js";
import {
  SIMD_CHIPTUNE_PERFORMANCE_LANES,
  sanitizeSimdChiptuneDrumMix,
  sanitizeSimdChiptunePerformance,
} from "../../instruments/simd-chiptune/performance.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
const integerParams = new Set(WEBGPU_CHIPTUNE_INTEGER_PARAMS);
const gateCodeKeys = Object.freeze(["gateA0", "gateA1", "gateA2", "gateA3", "gateB0", "gateB1", "gateB2", "gateB3"]);
const gateCodeKeySet = new Set(gateCodeKeys);
const MUSICAL_SCALE_MASKS = Object.freeze([1717, 1453, 1387, 661, 1193, 2741, 4095]);

const safeRandomRanges = simd => Object.freeze({
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
  fadeIn: simd ? [0.01, 0.02] : [0.08, 1.7],
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

const VOICE_NOTE_RANGES = Object.freeze({
  upperOne: [-5, 12], upperTwo: [-12, 7], bass: [-12, 0], lead: [-7, 12],
});
const DRUM_HITS = Object.freeze({ kick: [3, 6], snare: [2, 4], hats: [7, 14], shaker: [3, 11] });

function energyManagedParams(params) {
  const next = sanitizeWebGpuChiptuneParams(params);
  const voiceKeys = ["upperOneLevel", "upperTwoLevel", "bassPulseLevel", "bassSineLevel", "leadLevel", "arpLevel", "noiseLevel"];
  const voiceEnergy = voiceKeys.reduce((sum, key) => sum + next[key], 0) / voiceKeys.length;
  const drumEnergy = next.drumMix * (next.kickLevel + next.snareLevel + next.hatLevel + next.shakerLevel) / 4;
  const echoEnergy = next.echoDecay * Math.max(1, next.echoTaps / 4);
  const ceiling = clamp(0.9 - voiceEnergy * 0.12 - drumEnergy * 0.09 - echoEnergy * 0.08, 0.42, 0.76);
  next.gain = Math.min(next.gain, ceiling);
  return next;
}

export function chiptuneFullPresets(simd) {
  const ranges = safeRandomRanges(simd);
  const performanceLanes = simd ? SIMD_CHIPTUNE_PERFORMANCE_LANES : WEBGPU_CHIPTUNE_PERFORMANCE_LANES;
  const sanitizePerformance = simd ? sanitizeSimdChiptunePerformance : sanitizeWebGpuChiptunePerformance;
  const sanitizeDrumMix = simd ? sanitizeSimdChiptuneDrumMix : sanitizeWebGpuChiptuneDrumMix;

  function canonical(parts) {
    const pattern = sanitizeWebGpuChiptuneSequence(parts.patternSequence);
    const baseline = sanitizeWebGpuChiptuneSequence(parts.patternBaseline);
    const snapshot = {
      params: sanitizeWebGpuChiptuneParams(parts.params),
      sequenceMode: parts.sequenceMode === "song" ? "song" : "pattern",
      songSequence: sanitizeWebGpuChiptuneSequence(parts.songSequence),
      patternSequence: pattern,
      patternBaseline: baseline,
      voicePerformance: sanitizePerformance(parts.voicePerformance),
      drumMix: sanitizeDrumMix(parts.drumMix),
    };
    if (simd) {
      snapshot.patternSection = Math.round(clamp(parts.patternSection, 0, 31));
      snapshot.patternSections = {};
      for (const [key, section] of Object.entries(parts.patternSections ?? {})) {
        if (!/^([0-9]|[12][0-9]|3[01])$/.test(key) || Number(key) === snapshot.patternSection
          || !section?.sequence || !section?.baseline) continue;
        snapshot.patternSections[key] = {
          sequence: sanitizeWebGpuChiptuneSequence(section.sequence),
          baseline: sanitizeWebGpuChiptuneSequence(section.baseline),
        };
      }
    }
    return snapshot;
  }

  function capture(state) {
    const mode = state.sequence.mode;
    return canonical({
      params: state.params,
      sequenceMode: mode,
      songSequence: mode === "song" ? state.sequence : state.songSequence,
      patternSequence: mode === "pattern" ? state.sequence : state.patternSequence,
      patternBaseline: state.patternBaseline,
      voicePerformance: state.voicePerformance,
      drumMix: state.drumMix,
      patternSection: state.patternSection,
      patternSections: state.patternSections,
    });
  }

  function validate(snapshot) {
    const complete = snapshot && typeof snapshot === "object" && snapshot.params && snapshot.songSequence
      && snapshot.patternSequence && snapshot.patternBaseline && snapshot.voicePerformance && snapshot.drumMix
      && WEBGPU_CHIPTUNE_PARAM_ORDER.every(key => Number.isFinite(snapshot.params[key]))
      && (snapshot.sequenceMode === "song" || snapshot.sequenceMode === "pattern")
      && (!simd || (Number.isInteger(snapshot.patternSection) && snapshot.patternSections
        && typeof snapshot.patternSections === "object"));
    if (!complete || presetStateKey(snapshot) !== presetStateKey(canonical(snapshot))) {
      throw new TypeError("Invalid complete Chiptune preset");
    }
    return snapshot;
  }

  function entry(preset) {
    const params = sanitizeWebGpuChiptuneParams(preset.params);
    const song = sanitizeWebGpuChiptuneSequence(preset.sequence);
    const pattern = createWebGpuChiptunePattern(params, song);
    return Object.freeze({
      id: preset.id, label: preset.label, description: preset.description,
      snapshot: Object.freeze(validate(canonical({
        params, sequenceMode: "pattern", songSequence: song, patternSequence: pattern, patternBaseline: pattern,
        voicePerformance: {}, drumMix: {}, patternSection: 0, patternSections: {},
      }))),
    });
  }

  const randomParamValue = (rng, key, bounds = ranges[key] ?? WEBGPU_CHIPTUNE_LIMITS[key]) => {
    if (key === "scaleMask") return rng.pick(MUSICAL_SCALE_MASKS);
    const [minimum, maximum] = bounds;
    if (integerParams.has(key)) return rng.integer(Math.ceil(minimum), Math.floor(maximum));
    const unit = rng.between(webGpuChiptuneParamToUnit(key, minimum), webGpuChiptuneParamToUnit(key, maximum));
    return nearestMusicalFraction(key, webGpuChiptuneParamFromUnit(key, unit), [minimum, maximum]);
  };
  const boundedParamValue = (rng, key, maximum) => {
    const [safeMinimum, safeMaximum] = ranges[key];
    const bounded = Math.min(safeMaximum, maximum);
    return randomParamValue(rng, key, [Math.min(safeMinimum, bounded), bounded]);
  };

  function randomGateLane(rng, steps) {
    const codes = [0, 0, 0, 0];
    let enabled = 0;
    const density = rng.between(0.25, 0.65);
    for (let step = 0; step < Math.round(clamp(steps, 1, 32)); step += 1) {
      let gate = 0;
      if (rng.unit() < density) {
        const roll = rng.unit();
        gate = roll < 0.28 ? 1 : roll < 0.62 ? 2 : 3;
        enabled += 1;
      }
      codes[Math.floor(step / 8)] |= gate << ((step % 8) * 2);
    }
    if (enabled === 0) codes[0] = 3;
    return codes;
  }

  function randomParams(rng) {
    const next = {};
    const deferred = new Set(["pwmDepth", "kickSubcycle", "hatASubcycle", "hatARepeat", "gateRelease"]);
    for (const key of WEBGPU_CHIPTUNE_PARAM_ORDER) {
      if (!gateCodeKeySet.has(key) && !deferred.has(key)) next[key] = randomParamValue(rng, key);
    }
    next.pwmDepth = boundedParamValue(rng, "pwmDepth", Math.max(0, Math.min(next.pulseWidth - 0.02, 0.98 - next.pulseWidth)));
    next.kickSubcycle = boundedParamValue(rng, "kickSubcycle", next.kickCycle);
    next.hatASubcycle = boundedParamValue(rng, "hatASubcycle", next.hatACycle);
    next.hatARepeat = boundedParamValue(rng, "hatARepeat", next.hatASubcycle);
    for (const [prefix, lane] of [["gateA", randomGateLane(rng, next.gatePatternSteps)], ["gateB", randomGateLane(rng, next.gatePatternSteps)]]) {
      lane.forEach((code, index) => { next[prefix + index] = code; });
    }
    next.gateRelease = randomParamValue(rng, "gateRelease", [ranges.gateRelease[0], Math.min(ranges.gateRelease[1], gateReleaseMaximum(next))]);
    return energyManagedParams(next);
  }

  function gateReleaseMaximum(params) {
    let shortest = Number.POSITIVE_INFINITY;
    for (const lane of ["A", "B"]) {
      for (let step = 0; step < params.gatePatternSteps; step += 1) {
        const code = Math.round(params["gate" + lane + Math.floor(step / 8)]);
        const gate = (code >> ((step % 8) * 2)) & 3;
        if (gate === 1) shortest = Math.min(shortest, params.gateShortRatio);
        else if (gate === 2) shortest = Math.min(shortest, 1);
        else if (gate === 3) shortest = Math.min(shortest, params.gateLongRatio);
      }
    }
    return Number.isFinite(shortest) ? Math.max(0.05, shortest * params.gateLength) : WEBGPU_CHIPTUNE_LIMITS.gateRelease[1];
  }

  function randomSequenceLanes(rng) {
    const lanes = {};
    const cell = (state, value = 0, velocity = 1) => ({ state, value, velocity });
    const blank = () => Array.from({ length: WEBGPU_CHIPTUNE_SEQUENCE_STEPS }, () => cell("auto"));
    for (const lane of WEBGPU_CHIPTUNE_SEQUENCE_LANES) {
      const drum = WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane);
      const activeLength = drum ? rng.pick([16, 16, 32]) : rng.pick([8, 12, 16, 16, 24, 32]);
      const cells = blank();
      if (drum) {
        const [low, high] = DRUM_HITS[lane];
        const hits = Math.round(rng.integer(low, high) * activeLength / 16);
        const rotation = lane === "snare" ? activeLength / 4 | 0 : rng.integer(0, 3);
        for (let step = 0; step < activeLength; step += 1) {
          const hit = ((step * hits + rotation) % activeLength) < hits;
          cells[step] = hit ? cell("note", rng.between(0.7, 1), rng.between(0.55, 1)) : cell("rest");
        }
      } else {
        const [low, high] = VOICE_NOTE_RANGES[lane] ?? [0, 1];
        const motif = Array.from({ length: rng.pick([3, 4, 5, 6, 8]) }, () => (
          lane === "arp" ? rng.between(0.02, 0.98) : rng.integer(low, high)));
        const density = rng.between(0.6, 0.95);
        const drift = rng.between(0.1, 0.4);
        for (let step = 0; step < activeLength; step += 1) {
          if (step !== 0 && rng.unit() > density) { cells[step] = cell("rest"); continue; }
          if (rng.unit() < 0.06) continue;
          const value = rng.unit() < drift
            ? (lane === "arp" ? rng.between(0.02, 0.98) : rng.integer(low, high))
            : motif[step % motif.length];
          cells[step] = cell("note", value, step % 4 === 0 ? rng.between(0.8, 1) : rng.between(0.5, 0.95));
        }
      }
      lanes[lane] = {
        activeLength, cells, gate: rng.between(0.35, 0.95),
        stepBeats: drum ? 0.25 : rng.pick([0.25, 0.25, 0.25, 0.5, 0.125]),
      };
    }
    return lanes;
  }

  function randomize(current, random = Math.random) {
    validate(current);
    const rng = presetRandom(random);
    const params = randomParams(rng);
    const lanes = randomSequenceLanes(rng);
    const song = sanitizeWebGpuChiptuneSequence({ schemaVersion: 4, mode: "song", lanes });
    const pattern = sanitizeWebGpuChiptuneSequence({ schemaVersion: 4, mode: "pattern", lanes });
    let mutes = 0;
    const voicePerformance = Object.fromEntries(performanceLanes.map(lane => {
      const muted = lane !== "drums" && lane !== "bass" && mutes < 2 && rng.unit() < 0.12;
      if (muted) mutes += 1;
      return [lane, {
        muted, solo: false, x: rng.between(0.25, 0.75), y: rng.between(0.25, 0.75),
        ...(simd ? { volume: rng.between(0.7, 1) } : {}),
      }];
    }));
    const drumMix = Object.fromEntries(WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.map(lane => [lane, {
      muted: lane === "shaker" && rng.unit() < 0.12, solo: false,
      ...(simd ? { volume: rng.between(0.7, 1) } : {}),
    }]));
    return validate(canonical({
      params, sequenceMode: current.sequenceMode, songSequence: song, patternSequence: pattern, patternBaseline: pattern,
      voicePerformance, drumMix, patternSection: 0, patternSections: {},
    }));
  }

  return Object.freeze({ simd, capture, validate, entry, randomize });
}

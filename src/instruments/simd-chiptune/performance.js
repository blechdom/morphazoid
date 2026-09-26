import {
  WEBGPU_CHIPTUNE_DEFAULTS,
  WEBGPU_CHIPTUNE_LIMITS,
  WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
  WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES,
  WEBGPU_CHIPTUNE_PERFORMANCE_AXES,
  WEBGPU_CHIPTUNE_PERFORMANCE_DEFAULTS,
  WEBGPU_CHIPTUNE_SEQUENCE_LANES,
  applyWebGpuChiptunePerformance,
  applyWebGpuChiptuneDrumMix,
  sanitizeWebGpuChiptuneDrumMix,
  createWebGpuChiptunePattern,
  migrateWebGpuChiptunePerformance,
  sanitizeWebGpuChiptuneParams,
  sanitizeWebGpuChiptunePerformance,
  sanitizeWebGpuChiptuneSequence,
  webGpuChiptuneParamFromUnit,
  webGpuChiptuneParamToUnit,
  webGpuChiptuneProceduralLaneValue,
  webGpuChiptuneStageSnapshot,
} from "../webgpu-chiptune/webgpu-chiptune.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const modulo = (value, period) => ((value % period) + period) % period;

export const SIMD_CHIPTUNE_PERFORMANCE_LANES = Object.freeze([
  "drums", "bass", "arp", "lead", "upperOne", "upperTwo", "noise",
]);

export const SIMD_CHIPTUNE_PERFORMANCE_AXES = Object.freeze({
  ...WEBGPU_CHIPTUNE_PERFORMANCE_AXES,
  noise: Object.freeze({
    label: "NOISE",
    levelKeys: Object.freeze(["noiseLevel"]),
    x: Object.freeze({ key: "textureSweep", label: "SWEEP" }),
    y: Object.freeze({ key: "noiseLevel", label: "LEVEL" }),
  }),
});

export const SIMD_CHIPTUNE_PERFORMANCE_DEFAULTS = Object.freeze(Object.fromEntries(
  SIMD_CHIPTUNE_PERFORMANCE_LANES.map((lane) => [lane,
    Object.freeze({ ...(WEBGPU_CHIPTUNE_PERFORMANCE_DEFAULTS[lane]
      ?? { muted: false, solo: false, x: 0.5, y: 0.5 }), volume: 1 }),
  ]),
));

export function sanitizeSimdChiptunePerformance(performance = {}) {
  const source = sanitizeWebGpuChiptunePerformance(performance);
  const candidate = performance?.noise;
  const noise = Object.freeze({
    muted: candidate?.muted === true,
    solo: candidate?.solo === true,
    x: clamp(finite(candidate?.x, 0.5), 0, 1),
    y: clamp(finite(candidate?.y, 0.5), 0, 1),
  });
  return Object.freeze(Object.fromEntries(SIMD_CHIPTUNE_PERFORMANCE_LANES.map(
    (lane) => [lane, Object.freeze({ ...(lane === "noise" ? noise : source[lane]),
      volume: clamp(finite(performance?.[lane]?.volume, 1), 0, 1) })],
  )));
}

function noiseAxisValue(key, baseValue, position) {
  if (position === 0.5) return baseValue;
  const baseUnit = webGpuChiptuneParamToUnit(key, baseValue);
  const effectiveUnit = position <= 0.5
    ? baseUnit * position * 2
    : baseUnit + (1 - baseUnit) * (position - 0.5) * 2;
  return webGpuChiptuneParamFromUnit(key, effectiveUnit);
}

/** Preserve the six source pads and give their previously unowned sweep a pad. */
export function applySimdChiptunePerformance(
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  performance = SIMD_CHIPTUNE_PERFORMANCE_DEFAULTS,
) {
  const controls = sanitizeSimdChiptunePerformance(performance);
  const effective = { ...applyWebGpuChiptunePerformance(params, controls) };
  const noise = controls.noise;
  for (const axis of ["x", "y"]) {
    const { key } = SIMD_CHIPTUNE_PERFORMANCE_AXES.noise[axis];
    effective[key] = noiseAxisValue(key, effective[key], noise[axis]);
  }
  // Re-evaluate solo across all seven performers: the original six-voice layer
  // cannot see a soloed noise actor, and used to leave noise under every solo.
  const anySolo = SIMD_CHIPTUNE_PERFORMANCE_LANES.some((lane) => controls[lane].solo);
  for (const lane of SIMD_CHIPTUNE_PERFORMANCE_LANES) {
    const voice = controls[lane];
    const gain = !voice.muted && (!anySolo || voice.solo) ? voice.volume : 0;
    for (const key of SIMD_CHIPTUNE_PERFORMANCE_AXES[lane].levelKeys) effective[key] *= gain;
  }
  return sanitizeWebGpuChiptuneParams(effective);
}

/** Old WAX/preset snapshots keep their exact six mappings and gain a neutral pad. */
export function migrateSimdChiptunePerformance(snapshot = {}) {
  const migrated = migrateWebGpuChiptunePerformance(snapshot);
  return {
    parameters: migrated.parameters,
    performance: sanitizeSimdChiptunePerformance({
      ...Object.fromEntries(Object.entries(migrated.performance).map(([lane, voice]) => [
        lane, { ...voice, volume: snapshot.voicePerformance?.[lane]?.volume },
      ])),
      noise: snapshot.voicePerformance?.noise,
    }),
  };
}

/** Mixer trims sit after the original patch/XY levels; unity preserves its timbre. */
export const SIMD_CHIPTUNE_DRUM_LEVELS = Object.freeze({
  kick: "kickLevel", snare: "snareLevel", hats: "hatLevel", shaker: "shakerLevel",
});

export function sanitizeSimdChiptuneDrumMix(mix = {}) {
  const original = sanitizeWebGpuChiptuneDrumMix(mix);
  return Object.freeze(Object.fromEntries(Object.entries(original).map(([lane, voice]) => [
    lane, Object.freeze({ ...voice, volume: clamp(finite(mix?.[lane]?.volume, 1), 0, 1) }),
  ])));
}

export function applySimdChiptuneDrumMix(params, mix = {}) {
  const controls = sanitizeSimdChiptuneDrumMix(mix);
  const effective = { ...applyWebGpuChiptuneDrumMix(params, controls) };
  for (const [lane, key] of Object.entries(SIMD_CHIPTUNE_DRUM_LEVELS)) effective[key] *= controls[lane].volume;
  return sanitizeWebGpuChiptuneParams(effective);
}

/** One footer level owns each single-gain voice; Bass retains its two-source mix. */
export const SIMD_CHIPTUNE_LEVEL_KEYS = Object.freeze({
  drums: "drumMix", arp: "arpLevel", lead: "leadLevel",
  upperOne: "upperOneLevel", upperTwo: "upperTwoLevel", noise: "noiseLevel",
});

/**
 * Read intended levels, including legacy XY/trim, without mute/solo making a
 * fader jump to zero. Drum parts are pre-bus levels; Bass is its common trim.
 * Reading never normalizes or rewrites a saved patch.
 */
export function readSimdChiptuneLevels(
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  performance = SIMD_CHIPTUNE_PERFORMANCE_DEFAULTS,
  mix = {},
) {
  const controls = sanitizeSimdChiptunePerformance(performance);
  const drums = sanitizeSimdChiptuneDrumMix(mix);
  const unmuted = Object.fromEntries(Object.entries(controls).map(([lane, voice]) => [
    lane, { ...voice, muted: false, solo: false },
  ]));
  const unmutedDrums = Object.fromEntries(Object.entries(drums).map(([lane, voice]) => [
    lane, { ...voice, muted: false, solo: false },
  ]));
  const effective = applySimdChiptuneDrumMix(
    applySimdChiptunePerformance(params, unmuted), unmutedDrums,
  );
  return Object.freeze({
    ...Object.fromEntries(Object.entries(SIMD_CHIPTUNE_LEVEL_KEYS).map(([lane, key]) => [lane, effective[key]])),
    bass: controls.bass.volume,
    ...Object.fromEntries(Object.entries(SIMD_CHIPTUNE_DRUM_LEVELS).map(([lane, key]) => [lane, effective[key]])),
  });
}

/**
 * An explicit level edit absorbs the legacy trim and that voice's level-axis
 * offset into the patch value. Unrelated timbre/XY, mix, mute and solo survive.
 * A zero patch/trim remains recoverable by the same visible control.
 */
export function setSimdChiptuneLevel(params, performance, mix, lane, requested) {
  const patch = sanitizeWebGpuChiptuneParams(params);
  const controls = sanitizeSimdChiptunePerformance(performance);
  const drums = sanitizeSimdChiptuneDrumMix(mix);
  const levelKey = Object.hasOwn(SIMD_CHIPTUNE_LEVEL_KEYS, lane) ? SIMD_CHIPTUNE_LEVEL_KEYS[lane]
    : Object.hasOwn(SIMD_CHIPTUNE_DRUM_LEVELS, lane) ? SIMD_CHIPTUNE_DRUM_LEVELS[lane] : null;
  if (lane !== "bass" && !levelKey) throw new RangeError("Unknown Chiptune level: " + lane);
  const fallback = readSimdChiptuneLevels(patch, controls, drums)[lane];
  const maximum = lane === "bass" ? 1 : WEBGPU_CHIPTUNE_LIMITS[levelKey][1];
  const value = clamp(finite(requested, fallback), 0, maximum);
  if (lane === "bass") {
    return {
      parameters: patch,
      performance: sanitizeSimdChiptunePerformance({ ...controls, bass: { ...controls.bass, volume: value } }),
      drumMix: drums,
    };
  }
  if (Object.hasOwn(SIMD_CHIPTUNE_DRUM_LEVELS, lane)) {
    return {
      parameters: sanitizeWebGpuChiptuneParams({ ...patch, [levelKey]: value }),
      performance: controls,
      drumMix: sanitizeSimdChiptuneDrumMix({ ...drums, [lane]: { ...drums[lane], volume: 1 } }),
    };
  }
  const voice = { ...controls[lane], volume: 1 };
  if (SIMD_CHIPTUNE_PERFORMANCE_AXES[lane].y.key === levelKey) voice.y = 0.5;
  return {
    parameters: sanitizeWebGpuChiptuneParams({ ...patch, [levelKey]: value }),
    performance: sanitizeSimdChiptunePerformance({ ...controls, [lane]: voice }),
    drumMix: drums,
  };
}

/** The noise dancer follows the shader's texture clock and exponential sweep. */
export function simdChiptuneStageSnapshot(
  timeSeconds,
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  sequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
) {
  const patch = sanitizeWebGpuChiptuneParams(params);
  const song = sanitizeWebGpuChiptuneSequence(sequence);
  const source = webGpuChiptuneStageSnapshot(timeSeconds, patch, song);
  const period = Math.max(patch.texturePeriod, 0.01);
  const noiseTime = modulo(source.masterBeat + patch.texturePhase * period, period);
  const phase = noiseTime / period;
  const envelope = Math.exp(-noiseTime * patch.textureDecay);
  const sweepPosition = Math.exp(-noiseTime * patch.textureSweep);
  const levelUnit = webGpuChiptuneParamToUnit("noiseLevel", patch.noiseLevel);
  // The original Pattern synthesis deliberately excludes the Song texture.
  const resting = song.mode === "pattern" || patch.noiseLevel === 0 || patch.synthMix === 0;
  const activity = resting ? 0 : clamp(envelope * levelUnit, 0, 1);
  const onset = activity * clamp(1 - phase / 0.08, 0, 1);
  const noise = Object.freeze({
    key: "noise", label: "NOISE", clockRate: 1 / period, activeLength: 1,
    cellIndex: 0, cellState: resting ? "rest" : "auto", cellValue: 0,
    stepPhase: phase, note: null, resting, gate: resting ? 0 : envelope,
    cellGate: resting ? 0 : envelope, audibleGate: resting ? 0 : envelope,
    activity, levelUnit, size: 0.56 + levelUnit * 0.44,
    hue: webGpuChiptuneParamToUnit("noiseColor", patch.noiseColor),
    shape: sweepPosition, motionPhase: phase, motion: activity,
    detail: webGpuChiptuneParamToUnit("noiseRate", patch.noiseRate),
    range: webGpuChiptuneParamToUnit("textureSweep", patch.textureSweep),
    onset, bounce: onset * 0.35, danceSteps: 1, dancePhase: phase,
    bodyMotion: Object.freeze({
      sourceVoice: "noise", stride: 1, phase,
      jump: onset, jiggle: Math.sin(phase * Math.PI * 2) * activity,
      squash: activity * sweepPosition,
      leftArm: activity * (1 - sweepPosition), rightArm: activity * sweepPosition,
      leftLeg: activity * (1 - phase), rightLeg: activity * phase,
    }),
    frame: Math.floor(phase * 8) % 8,
    noiseTime, envelope, sweepPosition,
  });
  const actors = new Map(source.actors.map((actor) => [actor.key, actor]));
  actors.set("noise", noise);
  return Object.freeze({ ...source,
    actors: Object.freeze(SIMD_CHIPTUNE_PERFORMANCE_LANES.map((lane) => actors.get(lane))),
  });
}

/** Each Next section advances one complete source section (32 master beats by default). */
export function simdChiptuneSectionStartBeat(params = WEBGPU_CHIPTUNE_DEFAULTS, sectionIndex = 0) {
  const patch = sanitizeWebGpuChiptuneParams(params);
  const index = clamp(Math.floor(finite(sectionIndex, 0)), 0, 65535);
  return index * patch.sectionUnits;
}

/** Bake later procedural material into the same independent editable lane format. */
export function createSimdChiptunePatternSection(
  params = WEBGPU_CHIPTUNE_DEFAULTS,
  songSequence = WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
  sectionIndex = 0,
) {
  const patch = sanitizeWebGpuChiptuneParams(params);
  const song = sanitizeWebGpuChiptuneSequence(songSequence);
  const pattern = createWebGpuChiptunePattern(patch, song);
  const startBeat = simdChiptuneSectionStartBeat(patch, sectionIndex);
  if (song.mode === "pattern" || startBeat === 0) return pattern;
  const lanes = {};
  for (const lane of WEBGPU_CHIPTUNE_SEQUENCE_LANES) {
    const generated = pattern.lanes[lane];
    const cells = song.lanes[lane].cells.map((cell, step) => {
      // Manual edits remain stable as the procedural section advances.
      if (cell.state !== "auto") return cell;
      if (WEBGPU_CHIPTUNE_DRUM_SEQUENCE_LANES.includes(lane)) {
        const seconds = (startBeat + (step + 0.08) * generated.stepBeats) / patch.tempo;
        const drums = webGpuChiptuneStageSnapshot(seconds, patch, song).drums;
        const strength = lane === "hats" ? Math.max(drums.hatA, drums.hatB) : drums[lane];
        return { state: strength > 0.08 ? "note" : "rest", value: strength > 0.08 ? 1 : 0, velocity: 1 };
      }
      return { state: "note", velocity: 1,
        value: webGpuChiptuneProceduralLaneValue(lane,
          startBeat + (step + 0.5) * generated.stepBeats, patch, song),
      };
    });
    lanes[lane] = { ...generated, cells };
  }
  return sanitizeWebGpuChiptuneSequence({ ...pattern, lanes });
}

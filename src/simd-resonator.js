export const SIMD_RESONATOR_BLOCK_SIZE = 128;
export const SIMD_RESONATOR_MAX_MODES = 128;
export const SIMD_GRANULAR_MAX_GRAINS = 64;
export const SIMD_GRANULAR_SOURCE_SIZE = 16_384;
export const SIMD_FREEZE_MAX_BINS = 64;
export const SIMD_IR_MAX_TAPS = 128;
export const SIMD_IR_HISTORY_SIZE = SIMD_IR_MAX_TAPS * 2;
export const SIMD_MESH_MAX_MODES = 64;
export const SIMD_WAVEGUIDE_MAX_STRINGS = 16;
export const SIMD_WAVEGUIDE_DELAY_SIZE = 1_024;
export const SIMD_SPATIAL_MAX_SOURCES = 64;
export const SIMD_AUDIO_ENGINES = Object.freeze([
  "resonator", "granular", "swarm", "freeze", "ir", "mesh", "waveguide", "spatial",
]);

export const SIMD_RESONATOR_DEFAULTS = Object.freeze({ modeCount: 128, baseFrequency: 82, decaySeconds: 2.8, spread: 0.34, strikePosition: 0.38, hardness: 0.62 });
export const SIMD_GRANULAR_DEFAULTS = Object.freeze({ grainCount: 64, density: 110, grainSizeMs: 110, pitchSemitones: 0, scanPosition: 0.46, scatter: 0.3, stereoWidth: 0.82 });
export const SIMD_SWARM_DEFAULTS = Object.freeze({ voiceCount: 128, centerFrequency: 118, detuneCents: 34, stereoWidth: 0.86 });
export const SIMD_FREEZE_DEFAULTS = Object.freeze({ binCount: 64, holdSeconds: 12, tilt: 0.08, stereoWidth: 0.76, scanPosition: 0.42 });
export const SIMD_IR_DEFAULTS = Object.freeze({ tapCount: 128, morph: 0.36, decay: 0.72, tone: 0.58 });
export const SIMD_MESH_DEFAULTS = Object.freeze({ modeCount: 64, baseFrequency: 54, decaySeconds: 3.8, coupling: 0.34, strikeX: 0.37, strikeY: 0.58 });
export const SIMD_WAVEGUIDE_DEFAULTS = Object.freeze({ stringCount: 16, baseFrequency: 82, decaySeconds: 3.4, brightness: 0.66, stereoWidth: 0.84 });
export const SIMD_SPATIAL_DEFAULTS = Object.freeze({ sourceCount: 64, centerFrequency: 110, arcDegrees: 260, rotationDegrees: 0 });

export const SIMD_RESONATOR_LIMITS = Object.freeze({
  modeCount: Object.freeze([32, SIMD_RESONATOR_MAX_MODES]),
  baseFrequency: Object.freeze([42, 220]),
  decaySeconds: Object.freeze([0.35, 6]),
  spread: Object.freeze([0, 1]),
  strikePosition: Object.freeze([0.04, 0.96]),
  hardness: Object.freeze([0, 1]),
});
export const SIMD_GRANULAR_LIMITS = Object.freeze({
  grainCount: Object.freeze([16, SIMD_GRANULAR_MAX_GRAINS]),
  density: Object.freeze([8, 720]),
  grainSizeMs: Object.freeze([18, 260]),
  pitchSemitones: Object.freeze([-12, 12]),
  scanPosition: Object.freeze([0, 1]),
  scatter: Object.freeze([0, 1]),
  stereoWidth: Object.freeze([0, 1]),
});
export const SIMD_SWARM_LIMITS = Object.freeze({
  voiceCount: Object.freeze([16, SIMD_RESONATOR_MAX_MODES]),
  centerFrequency: Object.freeze([45, 880]),
  detuneCents: Object.freeze([2, 90]),
  stereoWidth: Object.freeze([0, 1]),
});
export const SIMD_FREEZE_LIMITS = Object.freeze({
  binCount: Object.freeze([8, SIMD_FREEZE_MAX_BINS]),
  holdSeconds: Object.freeze([0.4, 30]),
  tilt: Object.freeze([-1, 1]),
  stereoWidth: Object.freeze([0, 1]),
  scanPosition: Object.freeze([0, 1]),
});
export const SIMD_IR_LIMITS = Object.freeze({
  tapCount: Object.freeze([32, SIMD_IR_MAX_TAPS]),
  morph: Object.freeze([0, 1]),
  decay: Object.freeze([0.05, 1]),
  tone: Object.freeze([0, 1]),
});
export const SIMD_MESH_LIMITS = Object.freeze({
  modeCount: Object.freeze([16, SIMD_MESH_MAX_MODES]),
  baseFrequency: Object.freeze([32, 180]),
  decaySeconds: Object.freeze([0.3, 9]),
  coupling: Object.freeze([0, 1]),
  strikeX: Object.freeze([0.05, 0.95]),
  strikeY: Object.freeze([0.05, 0.95]),
});
export const SIMD_WAVEGUIDE_LIMITS = Object.freeze({
  stringCount: Object.freeze([4, SIMD_WAVEGUIDE_MAX_STRINGS]),
  baseFrequency: Object.freeze([48, 440]),
  decaySeconds: Object.freeze([0.25, 8]),
  brightness: Object.freeze([0.04, 1]),
  stereoWidth: Object.freeze([0, 1]),
});
export const SIMD_SPATIAL_LIMITS = Object.freeze({
  sourceCount: Object.freeze([8, SIMD_SPATIAL_MAX_SOURCES]),
  centerFrequency: Object.freeze([45, 660]),
  arcDegrees: Object.freeze([20, 360]),
  rotationDegrees: Object.freeze([-180, 180]),
});

export const SIMD_RESONATOR_ARRAY_EXPORTS = Object.freeze({
  input: "input_ptr", outputLeft: "output_left_ptr", outputRight: "output_right_ptr",
  real: "real_ptr", imaginary: "imaginary_ptr", cosine: "cosine_ptr", sine: "sine_ptr",
  decay: "decay_ptr", strike: "strike_ptr", gain: "gain_ptr", panLeft: "pan_left_ptr",
  panRight: "pan_right_ptr", energy: "energy_ptr", grainSource: "grain_source_ptr",
  grainPosition: "grain_position_ptr", grainSpeed: "grain_speed_ptr", grainAge: "grain_age_ptr",
  grainAgeStep: "grain_age_step_ptr", grainGain: "grain_gain_ptr",
  grainPanLeft: "grain_pan_left_ptr", grainPanRight: "grain_pan_right_ptr",
  grainMeta: "grain_meta_ptr", swarmReal: "swarm_real_ptr",
  swarmImaginary: "swarm_imaginary_ptr", swarmCosine: "swarm_cosine_ptr",
  swarmSine: "swarm_sine_ptr", swarmGain: "swarm_gain_ptr",
  swarmPanLeft: "swarm_pan_left_ptr", swarmPanRight: "swarm_pan_right_ptr",
  swarmEnergy: "swarm_energy_ptr",
  freezeReal: "freeze_real_ptr", freezeImaginary: "freeze_imaginary_ptr",
  freezeCosine: "freeze_cosine_ptr", freezeSine: "freeze_sine_ptr",
  freezeMagnitude: "freeze_magnitude_ptr", freezeDecay: "freeze_decay_ptr",
  freezeGain: "freeze_gain_ptr", freezePanLeft: "freeze_pan_left_ptr",
  freezePanRight: "freeze_pan_right_ptr", freezeEnergy: "freeze_energy_ptr",
  irA: "ir_a_ptr", irB: "ir_b_ptr", irHistory: "ir_history_ptr", irMeta: "ir_meta_ptr",
  meshReal: "mesh_real_ptr", meshImaginary: "mesh_imaginary_ptr",
  meshCosine: "mesh_cosine_ptr", meshSine: "mesh_sine_ptr", meshDecay: "mesh_decay_ptr",
  meshStrike: "mesh_strike_ptr", meshGain: "mesh_gain_ptr",
  meshPanLeft: "mesh_pan_left_ptr", meshPanRight: "mesh_pan_right_ptr", meshEnergy: "mesh_energy_ptr",
  waveguideBuffer: "waveguide_buffer_ptr", waveguideFilter: "waveguide_filter_ptr",
  waveguideDelay: "waveguide_delay_ptr", waveguideDamping: "waveguide_damping_ptr",
  waveguideFeedback: "waveguide_feedback_ptr", waveguideGain: "waveguide_gain_ptr",
  waveguidePanLeft: "waveguide_pan_left_ptr", waveguidePanRight: "waveguide_pan_right_ptr",
  waveguideMeta: "waveguide_meta_ptr", spatialReal: "spatial_real_ptr",
  spatialImaginary: "spatial_imaginary_ptr", spatialCosine: "spatial_cosine_ptr",
  spatialSine: "spatial_sine_ptr", spatialGain: "spatial_gain_ptr",
  spatialPanLeft: "spatial_pan_left_ptr", spatialPanRight: "spatial_pan_right_ptr",
  spatialEnergy: "spatial_energy_ptr",
});

const RESONATOR_KEYS = Object.freeze(["cosine", "sine", "decay", "strike", "gain", "panLeft", "panRight"]);
const SWARM_KEYS = Object.freeze(["swarmCosine", "swarmSine", "swarmGain", "swarmPanLeft", "swarmPanRight"]);
const FREEZE_KEYS = Object.freeze(["freezeCosine", "freezeSine", "freezeDecay", "freezeGain", "freezePanLeft", "freezePanRight"]);
const IR_KEYS = Object.freeze(["irA", "irB"]);
const MESH_KEYS = Object.freeze(["meshCosine", "meshSine", "meshDecay", "meshStrike", "meshGain", "meshPanLeft", "meshPanRight"]);
const WAVEGUIDE_KEYS = Object.freeze(["waveguideDelay", "waveguideDamping", "waveguideFeedback", "waveguideGain", "waveguidePanLeft", "waveguidePanRight"]);
const SPATIAL_KEYS = Object.freeze(["spatialCosine", "spatialSine", "spatialGain", "spatialPanLeft", "spatialPanRight"]);
const STATE_KEYS = Object.freeze([
  "real", "imaginary", "energy", "grainSource", "grainPosition", "grainSpeed",
  "grainAge", "grainAgeStep", "grainGain", "grainPanLeft", "grainPanRight",
  "grainMeta", "swarmReal", "swarmImaginary", "swarmEnergy",
  "freezeReal", "freezeImaginary", "freezeMagnitude", "freezeEnergy",
  "irHistory", "irMeta", "meshReal", "meshImaginary", "meshEnergy",
  "waveguideBuffer", "waveguideFilter", "waveguideMeta",
  "spatialReal", "spatialImaginary", "spatialEnergy",
]);

function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function finiteNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function bounded(value, fallback, limits) { return clamp(finiteNumber(value, fallback), limits[0], limits[1]); }
function laneAligned(value, fallback, limits) { return clamp(Math.round(bounded(value, fallback, limits) / 4) * 4, ...limits); }
function sampleRateValue(value) { return clamp(finiteNumber(value, 48_000), 8_000, 384_000); }

export function sanitizeSimdResonatorSettings(value = {}) {
  return Object.freeze({
    modeCount: laneAligned(value.modeCount, SIMD_RESONATOR_DEFAULTS.modeCount, SIMD_RESONATOR_LIMITS.modeCount),
    baseFrequency: bounded(value.baseFrequency, SIMD_RESONATOR_DEFAULTS.baseFrequency, SIMD_RESONATOR_LIMITS.baseFrequency),
    decaySeconds: bounded(value.decaySeconds, SIMD_RESONATOR_DEFAULTS.decaySeconds, SIMD_RESONATOR_LIMITS.decaySeconds),
    spread: bounded(value.spread, SIMD_RESONATOR_DEFAULTS.spread, SIMD_RESONATOR_LIMITS.spread),
    strikePosition: bounded(value.strikePosition, SIMD_RESONATOR_DEFAULTS.strikePosition, SIMD_RESONATOR_LIMITS.strikePosition),
    hardness: bounded(value.hardness, SIMD_RESONATOR_DEFAULTS.hardness, SIMD_RESONATOR_LIMITS.hardness),
  });
}

export function sanitizeSimdGranularSettings(value = {}) {
  return Object.freeze({
    grainCount: laneAligned(value.grainCount, SIMD_GRANULAR_DEFAULTS.grainCount, SIMD_GRANULAR_LIMITS.grainCount),
    density: bounded(value.density, SIMD_GRANULAR_DEFAULTS.density, SIMD_GRANULAR_LIMITS.density),
    grainSizeMs: bounded(value.grainSizeMs, SIMD_GRANULAR_DEFAULTS.grainSizeMs, SIMD_GRANULAR_LIMITS.grainSizeMs),
    pitchSemitones: bounded(value.pitchSemitones, SIMD_GRANULAR_DEFAULTS.pitchSemitones, SIMD_GRANULAR_LIMITS.pitchSemitones),
    scanPosition: bounded(value.scanPosition, SIMD_GRANULAR_DEFAULTS.scanPosition, SIMD_GRANULAR_LIMITS.scanPosition),
    scatter: bounded(value.scatter, SIMD_GRANULAR_DEFAULTS.scatter, SIMD_GRANULAR_LIMITS.scatter),
    stereoWidth: bounded(value.stereoWidth, SIMD_GRANULAR_DEFAULTS.stereoWidth, SIMD_GRANULAR_LIMITS.stereoWidth),
  });
}

export function sanitizeSimdSwarmSettings(value = {}) {
  return Object.freeze({
    voiceCount: laneAligned(value.voiceCount, SIMD_SWARM_DEFAULTS.voiceCount, SIMD_SWARM_LIMITS.voiceCount),
    centerFrequency: bounded(value.centerFrequency, SIMD_SWARM_DEFAULTS.centerFrequency, SIMD_SWARM_LIMITS.centerFrequency),
    detuneCents: bounded(value.detuneCents, SIMD_SWARM_DEFAULTS.detuneCents, SIMD_SWARM_LIMITS.detuneCents),
    stereoWidth: bounded(value.stereoWidth, SIMD_SWARM_DEFAULTS.stereoWidth, SIMD_SWARM_LIMITS.stereoWidth),
  });
}

export function sanitizeSimdFreezeSettings(value = {}) {
  return Object.freeze({
    binCount: laneAligned(value.binCount, SIMD_FREEZE_DEFAULTS.binCount, SIMD_FREEZE_LIMITS.binCount),
    holdSeconds: bounded(value.holdSeconds, SIMD_FREEZE_DEFAULTS.holdSeconds, SIMD_FREEZE_LIMITS.holdSeconds),
    tilt: bounded(value.tilt, SIMD_FREEZE_DEFAULTS.tilt, SIMD_FREEZE_LIMITS.tilt),
    stereoWidth: bounded(value.stereoWidth, SIMD_FREEZE_DEFAULTS.stereoWidth, SIMD_FREEZE_LIMITS.stereoWidth),
    scanPosition: bounded(value.scanPosition, SIMD_FREEZE_DEFAULTS.scanPosition, SIMD_FREEZE_LIMITS.scanPosition),
  });
}

export function sanitizeSimdIrSettings(value = {}) {
  return Object.freeze({
    tapCount: laneAligned(value.tapCount, SIMD_IR_DEFAULTS.tapCount, SIMD_IR_LIMITS.tapCount),
    morph: bounded(value.morph, SIMD_IR_DEFAULTS.morph, SIMD_IR_LIMITS.morph),
    decay: bounded(value.decay, SIMD_IR_DEFAULTS.decay, SIMD_IR_LIMITS.decay),
    tone: bounded(value.tone, SIMD_IR_DEFAULTS.tone, SIMD_IR_LIMITS.tone),
  });
}

export function sanitizeSimdMeshSettings(value = {}) {
  return Object.freeze({
    modeCount: laneAligned(value.modeCount, SIMD_MESH_DEFAULTS.modeCount, SIMD_MESH_LIMITS.modeCount),
    baseFrequency: bounded(value.baseFrequency, SIMD_MESH_DEFAULTS.baseFrequency, SIMD_MESH_LIMITS.baseFrequency),
    decaySeconds: bounded(value.decaySeconds, SIMD_MESH_DEFAULTS.decaySeconds, SIMD_MESH_LIMITS.decaySeconds),
    coupling: bounded(value.coupling, SIMD_MESH_DEFAULTS.coupling, SIMD_MESH_LIMITS.coupling),
    strikeX: bounded(value.strikeX, SIMD_MESH_DEFAULTS.strikeX, SIMD_MESH_LIMITS.strikeX),
    strikeY: bounded(value.strikeY, SIMD_MESH_DEFAULTS.strikeY, SIMD_MESH_LIMITS.strikeY),
  });
}

export function sanitizeSimdWaveguideSettings(value = {}) {
  return Object.freeze({
    stringCount: laneAligned(value.stringCount, SIMD_WAVEGUIDE_DEFAULTS.stringCount, SIMD_WAVEGUIDE_LIMITS.stringCount),
    baseFrequency: bounded(value.baseFrequency, SIMD_WAVEGUIDE_DEFAULTS.baseFrequency, SIMD_WAVEGUIDE_LIMITS.baseFrequency),
    decaySeconds: bounded(value.decaySeconds, SIMD_WAVEGUIDE_DEFAULTS.decaySeconds, SIMD_WAVEGUIDE_LIMITS.decaySeconds),
    brightness: bounded(value.brightness, SIMD_WAVEGUIDE_DEFAULTS.brightness, SIMD_WAVEGUIDE_LIMITS.brightness),
    stereoWidth: bounded(value.stereoWidth, SIMD_WAVEGUIDE_DEFAULTS.stereoWidth, SIMD_WAVEGUIDE_LIMITS.stereoWidth),
  });
}

export function sanitizeSimdSpatialSettings(value = {}) {
  return Object.freeze({
    sourceCount: laneAligned(value.sourceCount, SIMD_SPATIAL_DEFAULTS.sourceCount, SIMD_SPATIAL_LIMITS.sourceCount),
    centerFrequency: bounded(value.centerFrequency, SIMD_SPATIAL_DEFAULTS.centerFrequency, SIMD_SPATIAL_LIMITS.centerFrequency),
    arcDegrees: bounded(value.arcDegrees, SIMD_SPATIAL_DEFAULTS.arcDegrees, SIMD_SPATIAL_LIMITS.arcDegrees),
    rotationDegrees: bounded(value.rotationDegrees, SIMD_SPATIAL_DEFAULTS.rotationDegrees, SIMD_SPATIAL_LIMITS.rotationDegrees),
  });
}

export function createSimdResonatorConfiguration(value = {}, sampleRateInput = 48_000) {
  const settings = sanitizeSimdResonatorSettings(value);
  const sampleRate = sampleRateValue(sampleRateInput);
  const arrays = {};
  for (const key of RESONATOR_KEYS) arrays[key] = new Float32Array(SIMD_RESONATOR_MAX_MODES);
  const nyquistGuard = sampleRate * 0.44;
  const brightnessLength = 5 + settings.hardness * 91;
  let audibleModes = 0;
  for (let index = 0; index < settings.modeCount; index += 1) {
    const modeNumber = index + 1;
    const stiffness = 1 + settings.spread * 0.00016 * index * index;
    const irregularity = 1 + settings.spread * 0.006 * Math.sin(modeNumber * 2.399963);
    const frequency = settings.baseFrequency * modeNumber * Math.sqrt(stiffness) * irregularity;
    const audible = frequency < nyquistGuard;
    const phase = Math.PI * 2 * Math.min(frequency, nyquistGuard) / sampleRate;
    const lifetime = Math.max(0.08, settings.decaySeconds / (1 + index * (0.006 + settings.spread * 0.012)));
    const panning = Math.sin(modeNumber * 1.61803398875) * 0.68;
    arrays.cosine[index] = Math.cos(phase);
    arrays.sine[index] = Math.sin(phase);
    arrays.decay[index] = Math.exp(-1 / (sampleRate * lifetime));
    arrays.strike[index] = audible ? Math.sin(Math.PI * modeNumber * settings.strikePosition) * Math.exp(-index / brightnessLength) : 0;
    arrays.gain[index] = audible ? 1 / Math.sqrt(modeNumber) : 0;
    arrays.panLeft[index] = Math.sqrt((1 - panning) * 0.5);
    arrays.panRight[index] = Math.sqrt((1 + panning) * 0.5);
    if (audible) audibleModes += 1;
  }
  return Object.freeze({ engine: "resonator", settings, sampleRate, modeCount: settings.modeCount, audibleModes, outputScale: 0.19 / Math.sqrt(settings.modeCount / 32), ...arrays });
}

export function createSimdGranularSource() {
  const source = new Float32Array(SIMD_GRANULAR_SOURCE_SIZE);
  let noiseState = 0x6d2b79f5;
  let lowNoise = 0;
  for (let index = 0; index < source.length; index += 1) {
    const phase = Math.PI * 2 * index / source.length;
    noiseState = (Math.imul(noiseState, 1_664_525) + 1_013_904_223) >>> 0;
    const noise = noiseState / 0xffff_ffff * 2 - 1;
    lowNoise += (noise - lowNoise) * 0.045;
    const pulse = Math.sin(phase * 43) + Math.sin(phase * 67 + 0.8) * 0.62 + Math.sin(phase * 97 + 1.7) * 0.38;
    source[index] = (pulse * 0.31 + lowNoise * 0.22) * (0.68 + Math.sin(phase * 3 - 0.4) * 0.25);
  }
  return source;
}

let sharedGranularSource = null;

function defaultGranularSource() {
  if (!sharedGranularSource) sharedGranularSource = createSimdGranularSource();
  return sharedGranularSource;
}

export function createSimdGranularConfiguration(value = {}, sampleRateInput = 48_000) {
  const settings = sanitizeSimdGranularSettings(value);
  const sampleRate = sampleRateValue(sampleRateInput);
  const expectedActiveGrains = Math.min(settings.grainCount, Math.max(1, settings.density * settings.grainSizeMs / 1_000));
  return Object.freeze({
    engine: "granular", settings, sampleRate, grainCount: settings.grainCount,
    spawnIncrement: settings.density / sampleRate,
    grainSizeSamples: settings.grainSizeMs * sampleRate / 1_000,
    pitchRatio: 2 ** (settings.pitchSemitones / 12),
    scanPosition: settings.scanPosition, scatter: settings.scatter,
    stereoWidth: settings.stereoWidth,
    expectedActiveGrains,
    outputScale: 0.38 / Math.sqrt(Math.max(2, expectedActiveGrains)),
    source: defaultGranularSource(),
  });
}

export function createSimdSwarmConfiguration(value = {}, sampleRateInput = 48_000) {
  const settings = sanitizeSimdSwarmSettings(value);
  const sampleRate = sampleRateValue(sampleRateInput);
  const arrays = {};
  for (const key of SWARM_KEYS) arrays[key] = new Float32Array(SIMD_RESONATOR_MAX_MODES);
  const nyquistGuard = sampleRate * 0.44;
  let audibleVoices = 0;
  for (let index = 0; index < settings.voiceCount; index += 1) {
    const normalized = index / Math.max(1, settings.voiceCount - 1) * 2 - 1;
    const bowed = Math.sign(normalized) * normalized * normalized;
    const frequency = settings.centerFrequency * 2 ** (bowed * settings.detuneCents / 1_200);
    const audible = frequency < nyquistGuard;
    const phase = Math.PI * 2 * Math.min(frequency, nyquistGuard) / sampleRate;
    const pan = Math.sin((index + 1) * 2.399963) * settings.stereoWidth;
    arrays.swarmCosine[index] = Math.cos(phase);
    arrays.swarmSine[index] = Math.sin(phase);
    arrays.swarmGain[index] = audible ? 0.78 + 0.22 * Math.cos(normalized * Math.PI * 0.5) : 0;
    arrays.swarmPanLeft[index] = Math.sqrt((1 - pan) * 0.5);
    arrays.swarmPanRight[index] = Math.sqrt((1 + pan) * 0.5);
    if (audible) audibleVoices += 1;
  }
  return Object.freeze({ engine: "swarm", settings, sampleRate, voiceCount: settings.voiceCount, audibleVoices, outputScale: 0.16 / Math.sqrt(settings.voiceCount / 16), ...arrays });
}

export function createSimdFreezeConfiguration(value = {}, sampleRateInput = 48_000) {
  const settings = sanitizeSimdFreezeSettings(value);
  const sampleRate = sampleRateValue(sampleRateInput);
  const arrays = {};
  for (const key of FREEZE_KEYS) arrays[key] = new Float32Array(SIMD_RESONATOR_MAX_MODES);
  for (let index = 0; index < settings.binCount; index += 1) {
    const bin = index + 1;
    const phase = Math.PI * 2 * bin / SIMD_RESONATOR_BLOCK_SIZE;
    const normalized = index / Math.max(1, settings.binCount - 1);
    const pan = Math.sin((bin + 3) * 1.61803398875) * settings.stereoWidth;
    arrays.freezeCosine[index] = Math.cos(phase);
    arrays.freezeSine[index] = Math.sin(phase);
    arrays.freezeDecay[index] = Math.exp(-1 / (sampleRate * settings.holdSeconds));
    arrays.freezeGain[index] = (2 ** (settings.tilt * (normalized - 0.5) * 4)) / Math.sqrt(bin);
    arrays.freezePanLeft[index] = Math.sqrt((1 - pan) * 0.5);
    arrays.freezePanRight[index] = Math.sqrt((1 + pan) * 0.5);
  }
  return Object.freeze({
    engine: "freeze", settings, sampleRate, binCount: settings.binCount,
    sourceOffset: Math.round(settings.scanPosition * (SIMD_GRANULAR_SOURCE_SIZE - SIMD_RESONATOR_BLOCK_SIZE)),
    outputScale: 2.8 / Math.sqrt(settings.binCount), source: defaultGranularSource(), ...arrays,
  });
}

function normalizeImpulseResponse(values, targetEnergy = 0.9) {
  let squareSum = 0;
  for (const value of values) squareSum += value * value;
  const scale = squareSum > 1e-12 ? targetEnergy / Math.sqrt(squareSum) : 1;
  for (let index = 0; index < values.length; index += 1) values[index] *= scale;
  return values;
}

export function createSimdIrConfiguration(value = {}, sampleRateInput = 48_000) {
  const settings = sanitizeSimdIrSettings(value);
  const sampleRate = sampleRateValue(sampleRateInput);
  const irA = new Float32Array(SIMD_IR_MAX_TAPS);
  const irB = new Float32Array(SIMD_IR_MAX_TAPS);
  let randomState = 0x4d595df4;
  for (let index = 0; index < settings.tapCount; index += 1) {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    const noise = randomState / 0xffff_ffff * 2 - 1;
    const bright = 0.22 + settings.tone * 0.78;
    const envelopeA = Math.exp(-index / (5 + settings.decay * 54));
    const envelopeB = Math.exp(-index / (12 + settings.decay * 108));
    const sparse = index === 0 ? 1 : index % Math.max(3, Math.round(11 - settings.tone * 6)) === 0
      ? Math.sin(index * (0.38 + settings.tone * 0.27)) * 0.78
      : Math.sin(index * 0.23) * 0.08;
    irA[index] = sparse * envelopeA * bright;
    irB[index] = (index === 0 ? 0.65 : noise * (0.18 + settings.tone * 0.55)) * envelopeB;
  }
  normalizeImpulseResponse(irA, 0.92);
  normalizeImpulseResponse(irB, 0.92);
  return Object.freeze({
    engine: "ir", settings, sampleRate, tapCount: settings.tapCount,
    morph: settings.morph, outputScale: 0.52, irA, irB,
  });
}

export function createSimdMeshConfiguration(value = {}, sampleRateInput = 48_000) {
  const settings = sanitizeSimdMeshSettings(value);
  const sampleRate = sampleRateValue(sampleRateInput);
  const arrays = {};
  for (const key of MESH_KEYS) arrays[key] = new Float32Array(SIMD_RESONATOR_MAX_MODES);
  const nyquistGuard = sampleRate * 0.44;
  let audibleModes = 0;
  for (let index = 0; index < settings.modeCount; index += 1) {
    const column = index % 8 + 1;
    const row = Math.floor(index / 8) + 1;
    const order = Math.sqrt(column * column + row * row);
    const frequency = settings.baseFrequency * order;
    const audible = frequency < nyquistGuard;
    const phase = Math.PI * 2 * Math.min(frequency, nyquistGuard) / sampleRate;
    const lifetime = Math.max(0.08, settings.decaySeconds / (1 + order * 0.055));
    const pan = ((column - row) / 7) * 0.72;
    arrays.meshCosine[index] = Math.cos(phase);
    arrays.meshSine[index] = Math.sin(phase);
    arrays.meshDecay[index] = Math.exp(-1 / (sampleRate * lifetime));
    arrays.meshStrike[index] = audible
      ? Math.sin(Math.PI * column * settings.strikeX) * Math.sin(Math.PI * row * settings.strikeY) / Math.sqrt(order)
      : 0;
    arrays.meshGain[index] = audible ? 1 / Math.sqrt(order) : 0;
    arrays.meshPanLeft[index] = Math.sqrt((1 - pan) * 0.5);
    arrays.meshPanRight[index] = Math.sqrt((1 + pan) * 0.5);
    if (audible) audibleModes += 1;
  }
  return Object.freeze({
    engine: "mesh", settings, sampleRate, modeCount: settings.modeCount, audibleModes,
    coupling: settings.coupling, outputScale: 0.14 / Math.sqrt(settings.modeCount / 16), ...arrays,
  });
}

export function createSimdWaveguideConfiguration(value = {}, sampleRateInput = 48_000) {
  const settings = sanitizeSimdWaveguideSettings(value);
  const sampleRate = sampleRateValue(sampleRateInput);
  const arrays = {};
  for (const key of WAVEGUIDE_KEYS) arrays[key] = new Float32Array(SIMD_WAVEGUIDE_MAX_STRINGS);
  const ratios = [1, 1.25, 1.5, 2];
  for (let index = 0; index < settings.stringCount; index += 1) {
    const group = Math.floor(index / 4);
    const delay = clamp(Math.round(sampleRate / (settings.baseFrequency * ratios[group])), 16, SIMD_WAVEGUIDE_DELAY_SIZE);
    const pan = Math.sin((index + 1) * 2.399963) * settings.stereoWidth;
    arrays.waveguideDelay[index] = delay;
    arrays.waveguideDamping[index] = 0.035 + settings.brightness * (0.62 + (index % 4) * 0.055);
    arrays.waveguideFeedback[index] = 0.001 ** (delay / (sampleRate * settings.decaySeconds)) * (0.992 - (index % 4) * 0.002);
    arrays.waveguideGain[index] = 0.72 + (index % 4) * 0.06;
    arrays.waveguidePanLeft[index] = Math.sqrt((1 - pan) * 0.5);
    arrays.waveguidePanRight[index] = Math.sqrt((1 + pan) * 0.5);
  }
  return Object.freeze({
    engine: "waveguide", settings, sampleRate, stringCount: settings.stringCount,
    brightness: settings.brightness, outputScale: 0.24 / Math.sqrt(settings.stringCount / 4), ...arrays,
  });
}

export function createSimdSpatialConfiguration(value = {}, sampleRateInput = 48_000) {
  const settings = sanitizeSimdSpatialSettings(value);
  const sampleRate = sampleRateValue(sampleRateInput);
  const arrays = {};
  for (const key of SPATIAL_KEYS) arrays[key] = new Float32Array(SIMD_RESONATOR_MAX_MODES);
  const nyquistGuard = sampleRate * 0.44;
  for (let index = 0; index < settings.sourceCount; index += 1) {
    const normalized = index / Math.max(1, settings.sourceCount - 1);
    const angle = (settings.rotationDegrees + (normalized - 0.5) * settings.arcDegrees) * Math.PI / 180;
    const frequency = settings.centerFrequency * 2 ** (((index * 7) % 19 - 9) / 24);
    const phase = Math.PI * 2 * Math.min(frequency, nyquistGuard) / sampleRate;
    const pan = Math.sin(angle);
    arrays.spatialCosine[index] = Math.cos(phase);
    arrays.spatialSine[index] = Math.sin(phase);
    arrays.spatialGain[index] = frequency < nyquistGuard ? 0.55 + 0.45 * Math.cos((normalized - 0.5) * Math.PI) : 0;
    arrays.spatialPanLeft[index] = Math.sqrt((1 - pan) * 0.5);
    arrays.spatialPanRight[index] = Math.sqrt((1 + pan) * 0.5);
  }
  return Object.freeze({
    engine: "spatial", settings, sampleRate, sourceCount: settings.sourceCount,
    outputScale: 0.17 / Math.sqrt(settings.sourceCount / 16), ...arrays,
  });
}

const DEFAULTS_BY_ENGINE = Object.freeze({
  resonator: SIMD_RESONATOR_DEFAULTS, granular: SIMD_GRANULAR_DEFAULTS, swarm: SIMD_SWARM_DEFAULTS,
  freeze: SIMD_FREEZE_DEFAULTS, ir: SIMD_IR_DEFAULTS, mesh: SIMD_MESH_DEFAULTS,
  waveguide: SIMD_WAVEGUIDE_DEFAULTS, spatial: SIMD_SPATIAL_DEFAULTS,
});

function preset(engine, id, label, settings, note) {
  return Object.freeze({
    engine,
    id: engine + ":" + id,
    label,
    note,
    settings: Object.freeze({ ...DEFAULTS_BY_ENGINE[engine], ...settings }),
  });
}

export const SIMD_AUDIO_PRESETS = Object.freeze([
  preset("resonator", "glass", "Glass plate", { baseFrequency: 96, decaySeconds: 5.4, spread: 0.2, hardness: 0.9 }, "A hard strike opens a long, bright plate ring."),
  preset("resonator", "wood", "Soft wood", { modeCount: 80, baseFrequency: 68, decaySeconds: 1.5, spread: 0.08, hardness: 0.24 }, "A soft strike makes a dark, short wooden body."),
  preset("resonator", "metal", "Bent metal", { baseFrequency: 57, decaySeconds: 4.2, spread: 0.82, hardness: 0.74 }, "Wide modal spacing makes an uneven metallic clang."),
  preset("resonator", "pin", "Pinned wire", { modeCount: 48, baseFrequency: 146, decaySeconds: 0.85, spread: 0.38, hardness: 1 }, "A hard, high, short wire-like twang."),
  preset("granular", "dust", "Slow dust", { density: 22, grainSizeMs: 180, scatter: 0.74, pitchSemitones: -5 }, "Sparse low grains leave air between particles."),
  preset("granular", "rain", "Grain rain", { density: 118, grainSizeMs: 54, scatter: 0.62, pitchSemitones: 4 }, "Short, scattered grains fall as bright stereo rain."),
  preset("granular", "thicket", "Dense thicket", { density: 320, grainSizeMs: 120, scatter: 0.42, pitchSemitones: 0 }, "Overlapping grains turn the source into a thick continuous fabric."),
  preset("granular", "whiteout", "Whiteout", { density: 680, grainSizeMs: 210, scatter: 0.9, pitchSemitones: -2 }, "The bounded grain pool saturates into a broad noisy wash."),
  preset("granular", "shards", "High shards", { density: 210, grainSizeMs: 34, scatter: 0.32, pitchSemitones: 12 }, "Tiny octave-up grains become sharp bright fragments."),
  preset("swarm", "bees", "Close bees", { centerFrequency: 154, detuneCents: 18, stereoWidth: 0.42 }, "A tight cluster buzzes around one center pitch."),
  preset("swarm", "chorus", "Wide chorus", { centerFrequency: 92, detuneCents: 42, stereoWidth: 1 }, "Wide detuning and stereo spread reveal the full oscillator cloud."),
  preset("swarm", "razor", "Razor cloud", { voiceCount: 80, centerFrequency: 330, detuneCents: 82, stereoWidth: 0.68 }, "A high, widely detuned swarm makes a sharper edge."),
  preset("swarm", "halo", "Low halo", { centerFrequency: 55, detuneCents: 9, stereoWidth: 0.92 }, "A deep, nearly tuned cloud forms a slow stereo halo."),
  preset("freeze", "vowel", "Held vowel", { holdSeconds: 24, tilt: -0.18, stereoWidth: 0.58, scanPosition: 0.22 }, "Captures a warm region of the built-in source and holds its spectrum."),
  preset("freeze", "ice", "Thin ice", { binCount: 48, holdSeconds: 7, tilt: 0.72, stereoWidth: 1, scanPosition: 0.63 }, "Fewer bright-weighted bins make a thin, wide frozen sheen."),
  preset("freeze", "organ", "Frozen organ", { holdSeconds: 30, tilt: 0.12, stereoWidth: 0.34, scanPosition: 0.46 }, "A long harmonic freeze makes the clearest sustained demo."),
  preset("freeze", "ash", "Spectral ash", { binCount: 32, holdSeconds: 2.6, tilt: -0.62, stereoWidth: 0.88, scanPosition: 0.84 }, "A short low-weighted capture crumbles away quickly."),
  preset("ir", "plate", "Bright edge", { morph: 0.08, decay: 0.72, tone: 0.88 }, "A four-hit phrase passes through the bright 128-tap kernel."),
  preset("ir", "tunnel", "Hollow comb", { morph: 0.86, decay: 0.94, tone: 0.34 }, "The same phrase exposes the darker, noisier kernel."),
  preset("ir", "coin", "Coin filter", { tapCount: 64, morph: 0.28, decay: 0.32, tone: 1 }, "A short bright filter colors attacks without pretending to be a room."),
  preset("ir", "between", "A / B morph", { morph: 0.5, decay: 0.8, tone: 0.62 }, "Halfway between both kernels makes the vector interpolation obvious."),
  preset("mesh", "skin", "Loose skin", { baseFrequency: 38, decaySeconds: 2.2, coupling: 0.62 }, "A low strike spreads quickly through strongly coupled modes."),
  preset("mesh", "ceramic", "Ceramic grid", { baseFrequency: 88, decaySeconds: 6.2, coupling: 0.18 }, "Higher, lightly coupled modes ring like a brittle grid."),
  preset("mesh", "wire", "Wire web", { modeCount: 48, baseFrequency: 124, decaySeconds: 3.2, coupling: 0.88 }, "Strong coupling pulls a bright modal web together."),
  preset("mesh", "drum", "Wide drum", { baseFrequency: 46, decaySeconds: 1.1, coupling: 0.4, strikeX: 0.5, strikeY: 0.5 }, "A centered low strike gives the clearest membrane hit."),
  preset("waveguide", "nylon", "Nylon bank", { baseFrequency: 74, decaySeconds: 4.6, brightness: 0.38, stereoWidth: 0.68 }, "Sixteen mellow delay-line strings pluck together."),
  preset("waveguide", "steel", "Steel bank", { baseFrequency: 110, decaySeconds: 6.8, brightness: 0.92, stereoWidth: 1 }, "Bright, long, wide strings make the bank easiest to hear."),
  preset("waveguide", "mute", "Muted strings", { stringCount: 12, baseFrequency: 148, decaySeconds: 0.72, brightness: 0.28, stereoWidth: 0.54 }, "A compact bank gives short damped higher plucks."),
  preset("waveguide", "bass", "Bass lattice", { baseFrequency: 49, decaySeconds: 5.2, brightness: 0.58, stereoWidth: 0.9 }, "Low parallel strings form a long resonant lattice."),
  preset("spatial", "front", "Front cluster", { sourceCount: 32, centerFrequency: 132, arcDegrees: 70, rotationDegrees: 0 }, "A narrow oscillator field stays mostly centered."),
  preset("spatial", "ring", "Full ring", { centerFrequency: 88, arcDegrees: 360, rotationDegrees: 0 }, "A full circle distributes the oscillator bank across stereo."),
  preset("spatial", "left", "Left wake", { sourceCount: 48, centerFrequency: 176, arcDegrees: 150, rotationDegrees: -80 }, "A higher cluster leans clearly left; headphones help."),
  preset("spatial", "orbit", "Offset orbit", { centerFrequency: 64, arcDegrees: 300, rotationDegrees: 115 }, "A low wide field rotates away from center."),
]);

export function presetsForSimdEngine(engine) {
  return SIMD_AUDIO_PRESETS.filter((entry) => entry.engine === engine);
}

export function createSimdAudioConfiguration(engine, settings, sampleRate = 48_000) {
  if (engine === "granular") return createSimdGranularConfiguration(settings, sampleRate);
  if (engine === "swarm") return createSimdSwarmConfiguration(settings, sampleRate);
  if (engine === "freeze") return createSimdFreezeConfiguration(settings, sampleRate);
  if (engine === "ir") return createSimdIrConfiguration(settings, sampleRate);
  if (engine === "mesh") return createSimdMeshConfiguration(settings, sampleRate);
  if (engine === "waveguide") return createSimdWaveguideConfiguration(settings, sampleRate);
  if (engine === "spatial") return createSimdSpatialConfiguration(settings, sampleRate);
  return createSimdResonatorConfiguration(settings, sampleRate);
}

function arrayLength(key) {
  if (key === "input" || key === "outputLeft" || key === "outputRight") return SIMD_RESONATOR_BLOCK_SIZE;
  if (key === "grainSource") return SIMD_GRANULAR_SOURCE_SIZE;
  if (key === "irHistory") return SIMD_IR_HISTORY_SIZE;
  if (key === "waveguideBuffer") return SIMD_WAVEGUIDE_DELAY_SIZE * SIMD_WAVEGUIDE_MAX_STRINGS;
  if (key === "grainMeta" || key === "irMeta" || key === "waveguideMeta") return 4;
  if (key.startsWith("grain")) return SIMD_GRANULAR_MAX_GRAINS;
  if (key.startsWith("waveguide")) return SIMD_WAVEGUIDE_MAX_STRINGS;
  return SIMD_RESONATOR_MAX_MODES;
}

export function createSimdResonatorKernelViews(instance) {
  const exports = instance?.exports;
  if (!(exports?.memory instanceof WebAssembly.Memory)) throw new TypeError("SIMD audio kernel is missing exported memory.");
  for (const name of [
    "process_resonator", "process_granular", "process_swarm", "process_freeze", "process_ir",
    "process_mesh", "process_waveguides", "process_spatial", "reset", "lane_width",
    "block_size", "max_modes", "max_grains", "grain_source_size",
  ]) {
    if (typeof exports[name] !== "function") throw new TypeError("SIMD audio kernel is missing export: " + name);
  }
  const views = {};
  for (const [key, pointerExport] of Object.entries(SIMD_RESONATOR_ARRAY_EXPORTS)) {
    if (typeof exports[pointerExport] !== "function") throw new TypeError("SIMD audio kernel is missing export: " + pointerExport);
    views[key] = new Float32Array(exports.memory.buffer, exports[pointerExport](), arrayLength(key));
  }
  return Object.freeze({ instance, exports, ...views });
}

export function writeSimdResonatorConfiguration(kernel, configuration) {
  for (const key of RESONATOR_KEYS) kernel[key].set(configuration[key]);
  return kernel;
}
export function writeSimdGranularConfiguration(kernel, configuration) {
  if (configuration.source?.length) kernel.grainSource.set(configuration.source);
  return kernel;
}
export function writeSimdSwarmConfiguration(kernel, configuration) {
  for (const key of SWARM_KEYS) kernel[key].set(configuration[key]);
  return kernel;
}
export function writeSimdFreezeConfiguration(kernel, configuration) {
  for (const key of FREEZE_KEYS) kernel[key].set(configuration[key]);
  if (configuration.source?.length) kernel.grainSource.set(configuration.source);
  return kernel;
}
export function writeSimdIrConfiguration(kernel, configuration) {
  for (const key of IR_KEYS) kernel[key].set(configuration[key]);
  return kernel;
}
export function writeSimdMeshConfiguration(kernel, configuration) {
  for (const key of MESH_KEYS) kernel[key].set(configuration[key]);
  return kernel;
}
export function writeSimdWaveguideConfiguration(kernel, configuration) {
  for (const key of WAVEGUIDE_KEYS) kernel[key].set(configuration[key]);
  return kernel;
}
export function writeSimdSpatialConfiguration(kernel, configuration) {
  for (const key of SPATIAL_KEYS) kernel[key].set(configuration[key]);
  return kernel;
}
export function writeSimdAudioConfiguration(kernel, configuration) {
  if (configuration.engine === "granular") return writeSimdGranularConfiguration(kernel, configuration);
  if (configuration.engine === "swarm") return writeSimdSwarmConfiguration(kernel, configuration);
  if (configuration.engine === "freeze") return writeSimdFreezeConfiguration(kernel, configuration);
  if (configuration.engine === "ir") return writeSimdIrConfiguration(kernel, configuration);
  if (configuration.engine === "mesh") return writeSimdMeshConfiguration(kernel, configuration);
  if (configuration.engine === "waveguide") return writeSimdWaveguideConfiguration(kernel, configuration);
  if (configuration.engine === "spatial") return writeSimdSpatialConfiguration(kernel, configuration);
  return writeSimdResonatorConfiguration(kernel, configuration);
}
export function copySimdResonatorState(source, destination) {
  for (const key of STATE_KEYS) destination[key].set(source[key]);
  return destination;
}
export const copySimdAudioState = copySimdResonatorState;

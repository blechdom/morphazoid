export const BLOCK_SIZE: i32 = 128;
export const MAX_MODES: i32 = 128;
export const MAX_GRAINS: i32 = 64;
export const GRAIN_SOURCE_SIZE: i32 = 16_384;
export const GRAIN_SOURCE_MASK: i32 = GRAIN_SOURCE_SIZE - 1;
export const MAX_FREEZE_BINS: i32 = 64;
export const MAX_IR_TAPS: i32 = 128;
export const IR_HISTORY_SIZE: i32 = MAX_IR_TAPS * 2;
export const MAX_MESH_MODES: i32 = 64;
export const MAX_WAVEGUIDES: i32 = 16;
export const WAVEGUIDE_DELAY_SIZE: i32 = 1_024;
export const MAX_SPATIAL_SOURCES: i32 = 64;
const FLOAT_BYTES: i32 = 4;
const BLOCK_BYTES: i32 = BLOCK_SIZE * FLOAT_BYTES;
const MODE_BYTES: i32 = MAX_MODES * FLOAT_BYTES;
const GRAIN_BYTES: i32 = MAX_GRAINS * FLOAT_BYTES;
const SOURCE_BYTES: i32 = GRAIN_SOURCE_SIZE * FLOAT_BYTES;
const META_BYTES: i32 = 4 * FLOAT_BYTES;
const IR_HISTORY_BYTES: i32 = IR_HISTORY_SIZE * FLOAT_BYTES;
const WAVEGUIDE_BYTES: i32 = MAX_WAVEGUIDES * FLOAT_BYTES;
const WAVEGUIDE_BUFFER_BYTES: i32 = WAVEGUIDE_DELAY_SIZE * MAX_WAVEGUIDES * FLOAT_BYTES;

const INPUT: usize = memory.data(BLOCK_BYTES, 16);
const OUTPUT_LEFT: usize = memory.data(BLOCK_BYTES, 16);
const OUTPUT_RIGHT: usize = memory.data(BLOCK_BYTES, 16);

const REAL: usize = memory.data(MODE_BYTES, 16);
const IMAGINARY: usize = memory.data(MODE_BYTES, 16);
const COSINE: usize = memory.data(MODE_BYTES, 16);
const SINE: usize = memory.data(MODE_BYTES, 16);
const DECAY: usize = memory.data(MODE_BYTES, 16);
const STRIKE: usize = memory.data(MODE_BYTES, 16);
const GAIN: usize = memory.data(MODE_BYTES, 16);
const PAN_LEFT: usize = memory.data(MODE_BYTES, 16);
const PAN_RIGHT: usize = memory.data(MODE_BYTES, 16);
const ENERGY: usize = memory.data(MODE_BYTES, 16);

const GRAIN_SOURCE: usize = memory.data(SOURCE_BYTES, 16);
const GRAIN_POSITION: usize = memory.data(GRAIN_BYTES, 16);
const GRAIN_SPEED: usize = memory.data(GRAIN_BYTES, 16);
const GRAIN_AGE: usize = memory.data(GRAIN_BYTES, 16);
const GRAIN_AGE_STEP: usize = memory.data(GRAIN_BYTES, 16);
const GRAIN_GAIN: usize = memory.data(GRAIN_BYTES, 16);
const GRAIN_PAN_LEFT: usize = memory.data(GRAIN_BYTES, 16);
const GRAIN_PAN_RIGHT: usize = memory.data(GRAIN_BYTES, 16);
const GRAIN_META: usize = memory.data(META_BYTES, 16);

const SWARM_REAL: usize = memory.data(MODE_BYTES, 16);
const SWARM_IMAGINARY: usize = memory.data(MODE_BYTES, 16);
const SWARM_COSINE: usize = memory.data(MODE_BYTES, 16);
const SWARM_SINE: usize = memory.data(MODE_BYTES, 16);
const SWARM_GAIN: usize = memory.data(MODE_BYTES, 16);
const SWARM_PAN_LEFT: usize = memory.data(MODE_BYTES, 16);
const SWARM_PAN_RIGHT: usize = memory.data(MODE_BYTES, 16);
const SWARM_ENERGY: usize = memory.data(MODE_BYTES, 16);

const FREEZE_REAL: usize = memory.data(MODE_BYTES, 16);
const FREEZE_IMAGINARY: usize = memory.data(MODE_BYTES, 16);
const FREEZE_COSINE: usize = memory.data(MODE_BYTES, 16);
const FREEZE_SINE: usize = memory.data(MODE_BYTES, 16);
const FREEZE_MAGNITUDE: usize = memory.data(MODE_BYTES, 16);
const FREEZE_DECAY: usize = memory.data(MODE_BYTES, 16);
const FREEZE_GAIN: usize = memory.data(MODE_BYTES, 16);
const FREEZE_PAN_LEFT: usize = memory.data(MODE_BYTES, 16);
const FREEZE_PAN_RIGHT: usize = memory.data(MODE_BYTES, 16);
const FREEZE_ENERGY: usize = memory.data(MODE_BYTES, 16);

const IR_A: usize = memory.data(MODE_BYTES, 16);
const IR_B: usize = memory.data(MODE_BYTES, 16);
const IR_HISTORY: usize = memory.data(IR_HISTORY_BYTES, 16);
const IR_META: usize = memory.data(META_BYTES, 16);

const MESH_REAL: usize = memory.data(MODE_BYTES, 16);
const MESH_IMAGINARY: usize = memory.data(MODE_BYTES, 16);
const MESH_COSINE: usize = memory.data(MODE_BYTES, 16);
const MESH_SINE: usize = memory.data(MODE_BYTES, 16);
const MESH_DECAY: usize = memory.data(MODE_BYTES, 16);
const MESH_STRIKE: usize = memory.data(MODE_BYTES, 16);
const MESH_GAIN: usize = memory.data(MODE_BYTES, 16);
const MESH_PAN_LEFT: usize = memory.data(MODE_BYTES, 16);
const MESH_PAN_RIGHT: usize = memory.data(MODE_BYTES, 16);
const MESH_ENERGY: usize = memory.data(MODE_BYTES, 16);

const WAVEGUIDE_BUFFER: usize = memory.data(WAVEGUIDE_BUFFER_BYTES, 16);
const WAVEGUIDE_FILTER: usize = memory.data(WAVEGUIDE_BYTES, 16);
const WAVEGUIDE_DELAY: usize = memory.data(WAVEGUIDE_BYTES, 16);
const WAVEGUIDE_DAMPING: usize = memory.data(WAVEGUIDE_BYTES, 16);
const WAVEGUIDE_FEEDBACK: usize = memory.data(WAVEGUIDE_BYTES, 16);
const WAVEGUIDE_GAIN: usize = memory.data(WAVEGUIDE_BYTES, 16);
const WAVEGUIDE_PAN_LEFT: usize = memory.data(WAVEGUIDE_BYTES, 16);
const WAVEGUIDE_PAN_RIGHT: usize = memory.data(WAVEGUIDE_BYTES, 16);
const WAVEGUIDE_META: usize = memory.data(META_BYTES, 16);

const SPATIAL_REAL: usize = memory.data(MODE_BYTES, 16);
const SPATIAL_IMAGINARY: usize = memory.data(MODE_BYTES, 16);
const SPATIAL_COSINE: usize = memory.data(MODE_BYTES, 16);
const SPATIAL_SINE: usize = memory.data(MODE_BYTES, 16);
const SPATIAL_GAIN: usize = memory.data(MODE_BYTES, 16);
const SPATIAL_PAN_LEFT: usize = memory.data(MODE_BYTES, 16);
const SPATIAL_PAN_RIGHT: usize = memory.data(MODE_BYTES, 16);
const SPATIAL_ENERGY: usize = memory.data(MODE_BYTES, 16);

export function input_ptr(): usize { return INPUT; }
export function output_left_ptr(): usize { return OUTPUT_LEFT; }
export function output_right_ptr(): usize { return OUTPUT_RIGHT; }
export function real_ptr(): usize { return REAL; }
export function imaginary_ptr(): usize { return IMAGINARY; }
export function cosine_ptr(): usize { return COSINE; }
export function sine_ptr(): usize { return SINE; }
export function decay_ptr(): usize { return DECAY; }
export function strike_ptr(): usize { return STRIKE; }
export function gain_ptr(): usize { return GAIN; }
export function pan_left_ptr(): usize { return PAN_LEFT; }
export function pan_right_ptr(): usize { return PAN_RIGHT; }
export function energy_ptr(): usize { return ENERGY; }
export function grain_source_ptr(): usize { return GRAIN_SOURCE; }
export function grain_position_ptr(): usize { return GRAIN_POSITION; }
export function grain_speed_ptr(): usize { return GRAIN_SPEED; }
export function grain_age_ptr(): usize { return GRAIN_AGE; }
export function grain_age_step_ptr(): usize { return GRAIN_AGE_STEP; }
export function grain_gain_ptr(): usize { return GRAIN_GAIN; }
export function grain_pan_left_ptr(): usize { return GRAIN_PAN_LEFT; }
export function grain_pan_right_ptr(): usize { return GRAIN_PAN_RIGHT; }
export function grain_meta_ptr(): usize { return GRAIN_META; }
export function swarm_real_ptr(): usize { return SWARM_REAL; }
export function swarm_imaginary_ptr(): usize { return SWARM_IMAGINARY; }
export function swarm_cosine_ptr(): usize { return SWARM_COSINE; }
export function swarm_sine_ptr(): usize { return SWARM_SINE; }
export function swarm_gain_ptr(): usize { return SWARM_GAIN; }
export function swarm_pan_left_ptr(): usize { return SWARM_PAN_LEFT; }
export function swarm_pan_right_ptr(): usize { return SWARM_PAN_RIGHT; }
export function swarm_energy_ptr(): usize { return SWARM_ENERGY; }
export function freeze_real_ptr(): usize { return FREEZE_REAL; }
export function freeze_imaginary_ptr(): usize { return FREEZE_IMAGINARY; }
export function freeze_cosine_ptr(): usize { return FREEZE_COSINE; }
export function freeze_sine_ptr(): usize { return FREEZE_SINE; }
export function freeze_magnitude_ptr(): usize { return FREEZE_MAGNITUDE; }
export function freeze_decay_ptr(): usize { return FREEZE_DECAY; }
export function freeze_gain_ptr(): usize { return FREEZE_GAIN; }
export function freeze_pan_left_ptr(): usize { return FREEZE_PAN_LEFT; }
export function freeze_pan_right_ptr(): usize { return FREEZE_PAN_RIGHT; }
export function freeze_energy_ptr(): usize { return FREEZE_ENERGY; }
export function ir_a_ptr(): usize { return IR_A; }
export function ir_b_ptr(): usize { return IR_B; }
export function ir_history_ptr(): usize { return IR_HISTORY; }
export function ir_meta_ptr(): usize { return IR_META; }
export function mesh_real_ptr(): usize { return MESH_REAL; }
export function mesh_imaginary_ptr(): usize { return MESH_IMAGINARY; }
export function mesh_cosine_ptr(): usize { return MESH_COSINE; }
export function mesh_sine_ptr(): usize { return MESH_SINE; }
export function mesh_decay_ptr(): usize { return MESH_DECAY; }
export function mesh_strike_ptr(): usize { return MESH_STRIKE; }
export function mesh_gain_ptr(): usize { return MESH_GAIN; }
export function mesh_pan_left_ptr(): usize { return MESH_PAN_LEFT; }
export function mesh_pan_right_ptr(): usize { return MESH_PAN_RIGHT; }
export function mesh_energy_ptr(): usize { return MESH_ENERGY; }
export function waveguide_buffer_ptr(): usize { return WAVEGUIDE_BUFFER; }
export function waveguide_filter_ptr(): usize { return WAVEGUIDE_FILTER; }
export function waveguide_delay_ptr(): usize { return WAVEGUIDE_DELAY; }
export function waveguide_damping_ptr(): usize { return WAVEGUIDE_DAMPING; }
export function waveguide_feedback_ptr(): usize { return WAVEGUIDE_FEEDBACK; }
export function waveguide_gain_ptr(): usize { return WAVEGUIDE_GAIN; }
export function waveguide_pan_left_ptr(): usize { return WAVEGUIDE_PAN_LEFT; }
export function waveguide_pan_right_ptr(): usize { return WAVEGUIDE_PAN_RIGHT; }
export function waveguide_meta_ptr(): usize { return WAVEGUIDE_META; }
export function spatial_real_ptr(): usize { return SPATIAL_REAL; }
export function spatial_imaginary_ptr(): usize { return SPATIAL_IMAGINARY; }
export function spatial_cosine_ptr(): usize { return SPATIAL_COSINE; }
export function spatial_sine_ptr(): usize { return SPATIAL_SINE; }
export function spatial_gain_ptr(): usize { return SPATIAL_GAIN; }
export function spatial_pan_left_ptr(): usize { return SPATIAL_PAN_LEFT; }
export function spatial_pan_right_ptr(): usize { return SPATIAL_PAN_RIGHT; }
export function spatial_energy_ptr(): usize { return SPATIAL_ENERGY; }

export function sample_ptr(base: usize, index: i32): usize {
  return base + <usize>(index << 2);
}

export function bounded_frames(value: i32): i32 {
  return value < 0 ? 0 : value > BLOCK_SIZE ? BLOCK_SIZE : value;
}

export function bounded_modes(value: i32): i32 {
  const limited = value < 4 ? 4 : value > MAX_MODES ? MAX_MODES : value;
  return limited & ~3;
}

export function bounded_grains(value: i32): i32 {
  const limited = value < 4 ? 4 : value > MAX_GRAINS ? MAX_GRAINS : value;
  return limited & ~3;
}

export function bounded_freeze_bins(value: i32): i32 {
  const limited = value < 8 ? 8 : value > MAX_FREEZE_BINS ? MAX_FREEZE_BINS : value;
  return limited & ~3;
}

export function bounded_mesh_modes(value: i32): i32 {
  const limited = value < 8 ? 8 : value > MAX_MESH_MODES ? MAX_MESH_MODES : value;
  return limited & ~3;
}

export function bounded_waveguides(value: i32): i32 {
  const limited = value < 4 ? 4 : value > MAX_WAVEGUIDES ? MAX_WAVEGUIDES : value;
  return limited & ~3;
}

export function bounded_spatial_sources(value: i32): i32 {
  const limited = value < 8 ? 8 : value > MAX_SPATIAL_SOURCES ? MAX_SPATIAL_SOURCES : value;
  return limited & ~3;
}

export function soft_clip(value: f32): f32 {
  return value / (1.0 + Mathf.abs(value));
}

function random_unit(sequence: i32, salt: i32): f32 {
  let hash = sequence ^ salt;
  hash = (hash ^ (hash >>> 16)) * <i32>0x7feb352d;
  hash = (hash ^ (hash >>> 15)) * <i32>0x846ca68b;
  hash ^= hash >>> 16;
  return <f32>(<u32>hash) / 4_294_967_295.0;
}

export function reset_resonator(): void {
  memory.fill(REAL, 0, MODE_BYTES);
  memory.fill(IMAGINARY, 0, MODE_BYTES);
  memory.fill(ENERGY, 0, MODE_BYTES);
}

export function reset_granular(): void {
  memory.fill(GRAIN_POSITION, 0, GRAIN_BYTES);
  memory.fill(GRAIN_SPEED, 0, GRAIN_BYTES);
  memory.fill(GRAIN_AGE_STEP, 0, GRAIN_BYTES);
  memory.fill(GRAIN_GAIN, 0, GRAIN_BYTES);
  memory.fill(GRAIN_PAN_LEFT, 0, GRAIN_BYTES);
  memory.fill(GRAIN_PAN_RIGHT, 0, GRAIN_BYTES);
  memory.fill(GRAIN_META, 0, META_BYTES);
  for (let grain = 0; grain < MAX_GRAINS; grain += 1) {
    store<f32>(sample_ptr(GRAIN_AGE, grain), 2.0);
  }
}

export function activate_swarm(startValue: i32, endValue: i32): void {
  const start = startValue < 0 ? 0 : startValue > MAX_MODES ? MAX_MODES : startValue;
  const end = endValue < start ? start : endValue > MAX_MODES ? MAX_MODES : endValue;
  for (let voice = start; voice < end; voice += 1) {
    let phaseX = random_unit(voice + 1, 0x2c1b3c6d) * 2.0 - 1.0;
    let phaseY = random_unit(voice + 1, 0x297a2d39) * 2.0 - 1.0;
    const magnitude = Mathf.sqrt(phaseX * phaseX + phaseY * phaseY);
    if (magnitude > 0.0001) {
      phaseX /= magnitude;
      phaseY /= magnitude;
    } else {
      phaseX = 1.0;
      phaseY = 0.0;
    }
    store<f32>(sample_ptr(SWARM_REAL, voice), phaseX);
    store<f32>(sample_ptr(SWARM_IMAGINARY, voice), phaseY);
    store<f32>(sample_ptr(SWARM_ENERGY, voice), 0.0);
  }
}

export function reset_swarm(): void {
  memory.fill(SWARM_REAL, 0, MODE_BYTES);
  memory.fill(SWARM_IMAGINARY, 0, MODE_BYTES);
  memory.fill(SWARM_ENERGY, 0, MODE_BYTES);
  activate_swarm(0, MAX_MODES);
}

export function reset_freeze(): void {
  memory.fill(FREEZE_REAL, 0, MODE_BYTES);
  memory.fill(FREEZE_IMAGINARY, 0, MODE_BYTES);
  memory.fill(FREEZE_MAGNITUDE, 0, MODE_BYTES);
  memory.fill(FREEZE_ENERGY, 0, MODE_BYTES);
}

export function reset_ir(): void {
  memory.fill(IR_HISTORY, 0, IR_HISTORY_BYTES);
  memory.fill(IR_META, 0, META_BYTES);
}

export function reset_mesh(): void {
  memory.fill(MESH_REAL, 0, MODE_BYTES);
  memory.fill(MESH_IMAGINARY, 0, MODE_BYTES);
  memory.fill(MESH_ENERGY, 0, MODE_BYTES);
}

export function reset_waveguides(): void {
  memory.fill(WAVEGUIDE_BUFFER, 0, WAVEGUIDE_BUFFER_BYTES);
  memory.fill(WAVEGUIDE_FILTER, 0, WAVEGUIDE_BYTES);
  memory.fill(WAVEGUIDE_META, 0, META_BYTES);
}

export function reset_spatial(): void {
  memory.fill(SPATIAL_REAL, 0, MODE_BYTES);
  memory.fill(SPATIAL_IMAGINARY, 0, MODE_BYTES);
  memory.fill(SPATIAL_ENERGY, 0, MODE_BYTES);
  for (let source = 0; source < MAX_SPATIAL_SOURCES; source += 1) {
    const phase = random_unit(source + 31, 0x51ed270b) * 6.283185307;
    store<f32>(sample_ptr(SPATIAL_REAL, source), Mathf.cos(phase));
    store<f32>(sample_ptr(SPATIAL_IMAGINARY, source), Mathf.sin(phase));
  }
}

export function reset(): void {
  memory.fill(INPUT, 0, BLOCK_BYTES);
  memory.fill(OUTPUT_LEFT, 0, BLOCK_BYTES);
  memory.fill(OUTPUT_RIGHT, 0, BLOCK_BYTES);
  reset_resonator();
  reset_granular();
  reset_swarm();
  reset_freeze();
  reset_ir();
  reset_mesh();
  reset_waveguides();
  reset_spatial();
}

export function wrap_source_position(value: f32): f32 {
  const size = <f32>GRAIN_SOURCE_SIZE;
  return value - Mathf.floor(value / size) * size;
}

export function read_grain_source(position: f32): f32 {
  const wrapped = wrap_source_position(position);
  const before = <i32>Mathf.floor(wrapped) & GRAIN_SOURCE_MASK;
  const after = (before + 1) & GRAIN_SOURCE_MASK;
  const mix = wrapped - <f32>before;
  const first = load<f32>(sample_ptr(GRAIN_SOURCE, before));
  const second = load<f32>(sample_ptr(GRAIN_SOURCE, after));
  return first + (second - first) * mix;
}

function spawn_grain(
  grainCount: i32,
  grainSizeSamples: f32,
  pitchRatio: f32,
  scanPosition: f32,
  scatter: f32,
  stereoWidth: f32,
  captureInput: i32,
): void {
  const sequence = <i32>load<f32>(sample_ptr(GRAIN_META, 2));
  let slot: i32 = -1;
  for (let search = 0; search < grainCount; search += 1) {
    const candidate = (sequence + search) % grainCount;
    if (load<f32>(sample_ptr(GRAIN_AGE, candidate)) >= 1.0) {
      slot = candidate;
      break;
    }
  }
  store<f32>(sample_ptr(GRAIN_META, 2), <f32>(sequence + 1));
  if (slot < 0) return;
  const writeIndex = <i32>load<f32>(sample_ptr(GRAIN_META, 0));
  const randomA = random_unit(sequence + 1, 0x68e31da4);
  const randomB = random_unit(sequence + 1, 0x1b56c4e9);
  const randomC = random_unit(sequence + 1, 0x9e3779b9);
  const randomD = random_unit(sequence + 1, 0x85ebca6b);
  const sourceCenter = captureInput != 0
    ? <f32>writeIndex - (192.0 + scanPosition * <f32>(GRAIN_SOURCE_SIZE - 384))
    : scanPosition * <f32>(GRAIN_SOURCE_SIZE - 1);
  const sourceJitter = (randomA * 2.0 - 1.0) * scatter * <f32>GRAIN_SOURCE_SIZE * 0.14;
  const sizeVariation = 0.76 + randomB * scatter * 0.48;
  const pan = (randomC * 2.0 - 1.0) * stereoWidth;

  store<f32>(sample_ptr(GRAIN_POSITION, slot), wrap_source_position(sourceCenter + sourceJitter));
  store<f32>(
    sample_ptr(GRAIN_SPEED, slot),
    pitchRatio * (1.0 + (randomD * 2.0 - 1.0) * scatter * 0.16),
  );
  store<f32>(sample_ptr(GRAIN_AGE, slot), 0.0);
  store<f32>(
    sample_ptr(GRAIN_AGE_STEP, slot),
    <f32>1.0 / Mathf.max(<f32>32.0, <f32>(grainSizeSamples * sizeVariation)),
  );
  store<f32>(sample_ptr(GRAIN_GAIN, slot), 0.58 + randomA * 0.34);
  store<f32>(sample_ptr(GRAIN_PAN_LEFT, slot), Mathf.sqrt((1.0 - pan) * 0.5));
  store<f32>(sample_ptr(GRAIN_PAN_RIGHT, slot), Mathf.sqrt((1.0 + pan) * 0.5));
}

export function prepare_granular_frame(
  frame: i32,
  grainCountValue: i32,
  spawnIncrement: f32,
  grainSizeSamples: f32,
  pitchRatio: f32,
  scanPosition: f32,
  scatter: f32,
  stereoWidth: f32,
  captureInput: i32,
  burstValue: i32,
): void {
  const grainCount = bounded_grains(grainCountValue);
  if (captureInput != 0) {
    const writeIndex = <i32>load<f32>(sample_ptr(GRAIN_META, 0)) & GRAIN_SOURCE_MASK;
    store<f32>(
      sample_ptr(GRAIN_SOURCE, writeIndex),
      load<f32>(sample_ptr(INPUT, frame)),
    );
    store<f32>(sample_ptr(GRAIN_META, 0), <f32>((writeIndex + 1) & GRAIN_SOURCE_MASK));
  }

  let phase = load<f32>(sample_ptr(GRAIN_META, 1)) + Mathf.max(0.0, spawnIncrement);
  let spawnCount = <i32>Mathf.floor(phase);
  phase -= <f32>spawnCount;
  if (frame == 0) {
    const burst = burstValue < 0 ? 0 : burstValue > 8 ? 8 : burstValue;
    spawnCount += burst;
  }
  if (spawnCount > 8) spawnCount = 8;
  store<f32>(sample_ptr(GRAIN_META, 1), phase);
  for (let spawn = 0; spawn < spawnCount; spawn += 1) {
    spawn_grain(
      grainCount,
      Mathf.max(32.0, grainSizeSamples),
      Mathf.max(0.125, pitchRatio),
      Mathf.max(0.0, Mathf.min(1.0, scanPosition)),
      Mathf.max(0.0, Mathf.min(1.0, scatter)),
      Mathf.max(0.0, Mathf.min(1.0, stereoWidth)),
      captureInput,
    );
  }
}

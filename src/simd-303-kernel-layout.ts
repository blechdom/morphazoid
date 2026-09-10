export const BLOCK_SIZE: i32 = 128;
export const PARAM_COUNT: i32 = 17;
export const SEQUENCE_LENGTH: i32 = 512;
export const MODULATION_COMPONENTS: i32 = 4;
export const MAX_PARTIALS: i32 = 512;
export const XL_PARAM_COUNT: i32 = 6;
export const DELAY_FRAMES: i32 = 65536;
export const DELAY_MASK: i32 = DELAY_FRAMES - 1;

const FLOAT_BYTES: i32 = 4;
const BLOCK_BYTES: i32 = BLOCK_SIZE * FLOAT_BYTES;
const PARAM_BYTES: i32 = PARAM_COUNT * FLOAT_BYTES;
const SEQUENCE_BYTES: i32 = SEQUENCE_LENGTH * FLOAT_BYTES;
const MODULATION_BYTES: i32 = SEQUENCE_LENGTH * MODULATION_COMPONENTS * FLOAT_BYTES;
const PARTIAL_BYTES: i32 = MAX_PARTIALS * FLOAT_BYTES;
const CONTROL_BYTES: i32 = 4 * FLOAT_BYTES;
const XL_PARAM_BYTES: i32 = XL_PARAM_COUNT * FLOAT_BYTES;
const DELAY_BYTES: i32 = DELAY_FRAMES * FLOAT_BYTES;

const OUTPUT_LEFT: usize = memory.data(BLOCK_BYTES, 16);
const OUTPUT_RIGHT: usize = memory.data(BLOCK_BYTES, 16);
const PARAMS: usize = memory.data(PARAM_BYTES, 16);
// The host resolves the authored/noise sequence to one base frequency per step.
const STEP_FREQUENCY: usize = memory.data(SEQUENCE_BYTES, 16);
const STEP_MODULATION: usize = memory.data(MODULATION_BYTES, 16);
const STEP_EXPRESSION: usize = memory.data(MODULATION_BYTES, 16);
const PARTIAL_BASE: usize = memory.data(PARTIAL_BYTES, 16);
const PARTIAL_FOLD: usize = memory.data(PARTIAL_BYTES, 16);
const XL_PARAMS: usize = memory.data(XL_PARAM_BYTES, 16);

// Four-sample control scratch. The SIMD kernel loads these arrays as f32x4.
const CONTROL_TIME: usize = memory.data(CONTROL_BYTES, 16);
const CONTROL_AMP: usize = memory.data(CONTROL_BYTES, 16);
const CONTROL_BASE: usize = memory.data(CONTROL_BYTES, 16);
const CONTROL_FILTER: usize = memory.data(CONTROL_BYTES, 16);
const CONTROL_RESONANCE: usize = memory.data(CONTROL_BYTES, 16);
const CONTROL_STEREO: usize = memory.data(CONTROL_BYTES, 16);
const CONTROL_SQUARE: usize = memory.data(CONTROL_BYTES, 16);
const DELAY_LEFT: usize = memory.data(DELAY_BYTES, 16);
const DELAY_RIGHT: usize = memory.data(DELAY_BYTES, 16);
let delayCursor: i32 = 0;

export function output_left_ptr(): usize { return OUTPUT_LEFT; }
export function output_right_ptr(): usize { return OUTPUT_RIGHT; }
export function params_ptr(): usize { return PARAMS; }
export function step_frequency_ptr(): usize { return STEP_FREQUENCY; }
export function step_modulation_ptr(): usize { return STEP_MODULATION; }
export function step_expression_ptr(): usize { return STEP_EXPRESSION; }
export function partial_base_ptr(): usize { return PARTIAL_BASE; }
export function partial_fold_ptr(): usize { return PARTIAL_FOLD; }
export function xl_params_ptr(): usize { return XL_PARAMS; }
export function control_time_ptr(): usize { return CONTROL_TIME; }
export function control_amp_ptr(): usize { return CONTROL_AMP; }
export function control_base_ptr(): usize { return CONTROL_BASE; }
export function control_filter_ptr(): usize { return CONTROL_FILTER; }
export function control_resonance_ptr(): usize { return CONTROL_RESONANCE; }
export function control_stereo_ptr(): usize { return CONTROL_STEREO; }
export function control_square_ptr(): usize { return CONTROL_SQUARE; }
export function delay_left_ptr(): usize { return DELAY_LEFT; }
export function delay_right_ptr(): usize { return DELAY_RIGHT; }
export function delay_cursor(): i32 { return delayCursor; }
export function advance_delay_cursor(frames: i32): void {
  delayCursor = (delayCursor + frames) & DELAY_MASK;
}

export function sample_ptr(base: usize, index: i32): usize {
  return base + <usize>(index << 2);
}

export function bounded_frames(value: i32): i32 {
  return value < 0 ? 0 : value > BLOCK_SIZE ? BLOCK_SIZE : value;
}

export function bounded_partials(value: i32): i32 {
  return value < 1 ? 1 : value > MAX_PARTIALS ? MAX_PARTIALS : value;
}

export function clampf(value: f32, minimum: f32, maximum: f32): f32 {
  return Mathf.min(maximum, Mathf.max(minimum, value));
}

export function reset(): void {
  memory.fill(OUTPUT_LEFT, 0, BLOCK_BYTES);
  memory.fill(OUTPUT_RIGHT, 0, BLOCK_BYTES);
  memory.fill(DELAY_LEFT, 0, DELAY_BYTES);
  memory.fill(DELAY_RIGHT, 0, DELAY_BYTES);
  delayCursor = 0;
}

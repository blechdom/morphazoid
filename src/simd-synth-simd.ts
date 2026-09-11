import {
  BLOCK_SIZE,
  DELAY_MASK,
  VOICE_COUNT,
  advance_delay_cursor_1,
  advance_delay_cursor_2,
  all_notes_off,
  bounded_frames,
  clampf,
  delay_1_left_ptr,
  delay_1_right_ptr,
  delay_2_left_ptr,
  delay_2_right_ptr,
  delay_cursor_1,
  delay_cursor_2,
  filter_1_band_ptr,
  filter_1_low_ptr,
  filter_2_band_ptr,
  filter_2_low_ptr,
  filter_feedback_ptr,
  mod_routes_ptr,
  note_off,
  note_on,
  output_left_ptr,
  output_right_ptr,
  params_ptr,
  reset as reset_layout,
  sample_ptr,
  sequence_active,
  sequence_ptr,
  set_sequence_active as set_sequence_active_layout,
  voice_envelope_ptr,
  voice_gate_ptr,
  voice_note_ptr,
  voice_phase_a_ptr,
  voice_phase_b_ptr,
  voice_stage_ptr,
  voice_velocity_ptr,
} from "./simd-synth-kernel-layout";

export {
  all_notes_off,
  mod_routes_ptr,
  note_off,
  note_on,
  output_left_ptr,
  output_right_ptr,
  params_ptr,
  sequence_ptr,
  voice_envelope_ptr,
  voice_gate_ptr,
  voice_note_ptr,
} from "./simd-synth-kernel-layout";

const PI: f32 = 3.14159265358979323846;
const TAU: f32 = 6.28318530717958647692;
const HALF_PI: f32 = 1.57079632679489661923;
const INV_TAU: f32 = 0.15915494309189533577;
const LN2: f32 = 0.69314718055994530942;
const INV_LN2: f32 = 1.44269504088896340736;
const OUTPUT_CEILING: f32 = 0.92;

let lastSequenceStep: i32 = -1;
let fxOutLeft: f32 = 0.0;
let fxOutRight: f32 = 0.0;
let dcInputLeft: f32 = 0.0;
let dcInputRight: f32 = 0.0;
let dcOutputLeft: f32 = 0.0;
let dcOutputRight: f32 = 0.0;

export function lane_width(): i32 { return 4; }
export function block_size(): i32 { return BLOCK_SIZE; }
export function voice_count(): i32 { return VOICE_COUNT; }
export function set_sequence_active(value: i32): void {
  const changed = (sequence_active() != 0) != (value != 0);
  set_sequence_active_layout(value);
  if (changed) lastSequenceStep = -1;
}
export function reset(): void {
  reset_layout();
  lastSequenceStep = -1;
  dcInputLeft = 0.0; dcInputRight = 0.0;
  dcOutputLeft = 0.0; dcOutputRight = 0.0;
}

function param(index: i32): f32 { return load<f32>(params_ptr() + <usize>(index << 2)); }
function fract(value: f32): f32 { return value - Mathf.floor(value); }

function fast_exp(value: f32): f32 {
  const x = clampf(value, -80.0, 80.0);
  const exponent = <i32>Mathf.floor(x * INV_LN2);
  const remainder = x - <f32>exponent * LN2;
  const polynomial: f32 = 1.0 + remainder * (1.0 + remainder * (0.5 + remainder * (0.1666666716 + remainder * (0.0416666679 + remainder * 0.0083333338))));
  return <f32>(polynomial * reinterpret<f32>((exponent + 127) << 23));
}

function fast_sin(value: f32): f32 {
  let x = value - Mathf.round(value * INV_TAU) * TAU;
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1.0 + x2 * (-0.1666666716 + x2 * (0.0083333338 + x2 * (-0.0001984127 + x2 * (0.0000027557 + x2 * -0.0000000251)))));
}

function fast_pow2(value: f32): f32 { return fast_exp(value * LN2); }

function fast_exp4(value: v128): v128 {
  const x = v128.max<f32>(v128.splat<f32>(-80.0), v128.min<f32>(v128.splat<f32>(80.0), value));
  const exponent = v128.floor<f32>(v128.mul<f32>(x, v128.splat<f32>(INV_LN2)));
  const remainder = v128.sub<f32>(x, v128.mul<f32>(exponent, v128.splat<f32>(LN2)));
  let polynomial = v128.splat<f32>(0.0083333338);
  polynomial = v128.add<f32>(v128.splat<f32>(0.0416666679), v128.mul<f32>(remainder, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(0.1666666716), v128.mul<f32>(remainder, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(0.5), v128.mul<f32>(remainder, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(remainder, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(remainder, polynomial));
  const exponentInteger = v128.trunc_sat<i32>(exponent);
  const exponentBits = v128.shl<i32>(v128.add<i32>(exponentInteger, v128.splat<i32>(127)), 23);
  return v128.mul<f32>(polynomial, exponentBits);
}

function fast_sin4(value: v128): v128 {
  let x = v128.sub<f32>(value, v128.mul<f32>(v128.nearest<f32>(v128.mul<f32>(value, v128.splat<f32>(INV_TAU))), v128.splat<f32>(TAU)));
  const high = v128.gt<f32>(x, v128.splat<f32>(HALF_PI));
  x = v128.bitselect(v128.sub<f32>(v128.splat<f32>(PI), x), x, high);
  const low = v128.lt<f32>(x, v128.splat<f32>(-HALF_PI));
  x = v128.bitselect(v128.sub<f32>(v128.splat<f32>(-PI), x), x, low);
  const x2 = v128.mul<f32>(x, x);
  let polynomial = v128.splat<f32>(-0.0000000251);
  polynomial = v128.add<f32>(v128.splat<f32>(0.0000027557), v128.mul<f32>(x2, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(-0.0001984127), v128.mul<f32>(x2, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(0.0083333338), v128.mul<f32>(x2, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(-0.1666666716), v128.mul<f32>(x2, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(x2, polynomial));
  return v128.mul<f32>(x, polynomial);
}

function clamp4(value: v128, minimum: f32, maximum: f32): v128 {
  return v128.max<f32>(v128.splat<f32>(minimum), v128.min<f32>(v128.splat<f32>(maximum), value));
}

function fract4(value: v128): v128 { return v128.sub<f32>(value, v128.floor<f32>(value)); }
function fast_pow2_4(value: v128): v128 { return fast_exp4(v128.mul<f32>(value, v128.splat<f32>(LN2))); }

function smoothstep01(value: f32): f32 {
  const x = clampf(value, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

function hash11(value: f32): f32 { return fract(fast_sin(value * 127.1 + param(50) * 0.0137) * 43758.5453); }
function hash14(value: v128): v128 { return fract4(v128.mul<f32>(fast_sin4(v128.add<f32>(v128.mul<f32>(value, v128.splat<f32>(127.1)), v128.splat<f32>(param(50) * 0.0137))), v128.splat<f32>(43758.5453))); }

function swing_time(straightTime: f32, swing: f32): f32 {
  const amount: f32 = clampf(swing, 0.0, 0.42);
  const pair: f32 = Mathf.floor(straightTime * 0.5);
  const within: f32 = straightTime - pair * 2.0;
  const evenDuration: f32 = 1.0 + amount;
  if (within < evenDuration) return pair * 2.0 + within / evenDuration;
  return pair * 2.0 + 1.0 + (within - evenDuration) / (1.0 - amount);
}

function scale_size(scale: i32): i32 { if (scale == 4) return 6; if (scale == 5) return 5; return scale == 0 ? 12 : 7; }

function scale_interval(index: i32, scale: i32): f32 {
  if (scale == 0) return <f32>index;
  if (scale == 1) { if (index == 0) return 0.0; if (index == 1) return 2.0; if (index == 2) return 3.0; if (index == 3) return 5.0; if (index == 4) return 7.0; if (index == 5) return 9.0; return 10.0; }
  if (scale == 2) { if (index == 0) return 0.0; if (index == 1) return 1.0; if (index == 2) return 3.0; if (index == 3) return 5.0; if (index == 4) return 7.0; if (index == 5) return 8.0; return 10.0; }
  if (scale == 3) { if (index == 0) return 0.0; if (index == 1) return 2.0; if (index == 2) return 3.0; if (index == 3) return 5.0; if (index == 4) return 7.0; if (index == 5) return 8.0; return 11.0; }
  if (scale == 4) return <f32>(index * 2);
  if (index == 0) return 0.0; if (index == 1) return 3.0; if (index == 2) return 5.0; if (index == 3) return 7.0; return 10.0;
}

function scale_note(degreeValue: f32, scale: i32): f32 {
  const degree = <i32>Mathf.round(degreeValue);
  if (scale == 0) return <f32>degree;
  const size = scale_size(scale);
  let octave = degree / size;
  let index = degree % size;
  if (index < 0) { index += size; octave -= 1; }
  return <f32>(octave * 12) + scale_interval(index, scale);
}

function prepare_sequence(sequenceSeconds: f32): f32 {
  if (sequence_active() == 0) return 0.0;
  const straight = sequenceSeconds * clampf(param(42), 30.0, 240.0) / 60.0 * 4.0;
  const clock = swing_time(straight, param(43));
  const steps = <i32>clampf(Mathf.round(param(44)), 4.0, 16.0);
  const absoluteStep = <i32>Mathf.floor(clock);
  let step = absoluteStep % steps;
  if (step < 0) step += steps;
  const phase = fract(clock);
  const base = sequence_ptr() + <usize>(step << 4);
  const previousStep = step > 0 ? step - 1 : steps - 1;
  const previousBase = sequence_ptr() + <usize>(previousStep << 4);
  const degree = load<f32>(base);
  const previousDegree = load<f32>(previousBase);
  const enabled = load<f32>(base, 4) >= 0.5;
  const velocity = clampf(load<f32>(base, 8), 0.05, 1.0);
  const slide = clampf(Mathf.max(load<f32>(base, 12), param(28)), 0.0, 1.0);
  const scale = <i32>clampf(Mathf.round(param(47)), 0.0, 5.0);
  const targetNote: f32 = param(46) + scale_note(degree, scale);
  const previousNote: f32 = param(46) + scale_note(previousDegree, scale);
  const glideAmount: f32 = slide <= 0.0 ? 1.0 : smoothstep01(phase / Mathf.max(0.001, slide * 0.9));
  const gate = enabled && phase < clampf(param(45), 0.05, 1.0);
  store<f32>(voice_note_ptr(), previousNote + (targetNote - previousNote) * glideAmount);
  store<f32>(voice_velocity_ptr(), velocity);
  if (step != lastSequenceStep) {
    store<f32>(voice_envelope_ptr(), load<f32>(voice_envelope_ptr()) * 0.18);
    store<f32>(voice_stage_ptr(), gate ? 1.0 : 0.0);
    store<f32>(voice_phase_a_ptr(), 0.0);
    store<f32>(voice_phase_b_ptr(), 0.0);
    lastSequenceStep = step;
  }
  store<f32>(voice_gate_ptr(), gate ? 1.0 : 0.0);
  if (!gate) store<f32>(voice_stage_ptr(), 0.0);
  return clampf((degree + 12.0) / 36.0, 0.0, 1.0);
}

function modulation_source4(kind: i32, time: f32, envelope: v128, velocity: v128, note: v128, sequenceValue: f32): v128 {
  if (kind == 1) return v128.splat<f32>(fast_sin(time * param(31) * TAU));
  if (kind == 2) return v128.splat<f32>(fast_sin(time * param(32) * TAU + HALF_PI));
  if (kind == 3) return v128.sub<f32>(v128.mul<f32>(envelope, v128.splat<f32>(2.0)), v128.splat<f32>(1.0));
  if (kind == 4) return v128.splat<f32>(sequenceValue * 2.0 - 1.0);
  if (kind == 5) return v128.splat<f32>(hash11(Mathf.floor(time * Mathf.max(0.05, param(31) * 3.0))) * 2.0 - 1.0);
  if (kind == 6) return v128.sub<f32>(v128.mul<f32>(velocity, v128.splat<f32>(2.0)), v128.splat<f32>(1.0));
  if (kind == 7) return clamp4(v128.div<f32>(v128.sub<f32>(note, v128.splat<f32>(60.0)), v128.splat<f32>(24.0)), -1.0, 1.0);
  if (kind == 8) return v128.splat<f32>(param(48) * 2.0 - 1.0);
  if (kind == 9) return v128.splat<f32>(param(49) * 2.0 - 1.0);
  return v128.splat<f32>(0.0);
}

function render_vector4(phase: v128, color: v128, detail: i32): v128 {
  let output = v128.splat<f32>(0.0);
  const requested = detail < 1 ? 1 : detail > 24 ? 24 : detail;
  const first = clamp4(v128.mul<f32>(color, v128.splat<f32>(2.0)), 0.0, 1.0);
  const second = clamp4(v128.mul<f32>(v128.sub<f32>(color, v128.splat<f32>(0.5)), v128.splat<f32>(2.0)), 0.0, 1.0);
  for (let partial = 1; partial <= requested; partial += 1) {
    const harmonic = <f32>partial;
    const odd = (partial & 1) == 1;
    const sineWeight: f32 = partial == 1 ? 1.0 : 0.0;
    const triangleWeight: f32 = odd ? (((partial - 1) & 2) == 0 ? 1.0 : -1.0) / (harmonic * harmonic) : 0.0;
    const sawWeight: f32 = 1.0 / harmonic;
    let weight = v128.add<f32>(v128.splat<f32>(sineWeight), v128.mul<f32>(v128.sub<f32>(v128.splat<f32>(triangleWeight), v128.splat<f32>(sineWeight)), first));
    weight = v128.add<f32>(weight, v128.mul<f32>(v128.splat<f32>(sawWeight - triangleWeight), second));
    output = v128.add<f32>(output, v128.mul<f32>(fast_sin4(v128.mul<f32>(phase, v128.splat<f32>(harmonic * TAU))), weight));
  }
  return v128.mul<f32>(output, v128.splat<f32>(0.72));
}

function render_fm4(phase: v128, color: v128, motion: v128, detail: i32, time: f32): v128 {
  const operators = detail < 1 ? 1 : detail > 6 ? 6 : detail;
  const ratio = v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(v128.floor<f32>(v128.mul<f32>(color, v128.splat<f32>(5.0))), v128.splat<f32>(0.5)));
  const index = v128.add<f32>(v128.splat<f32>(0.08), v128.add<f32>(v128.mul<f32>(color, v128.splat<f32>(5.2)), v128.mul<f32>(motion, v128.splat<f32>(2.4))));
  let modulator = v128.splat<f32>(0.0);
  for (let operator = operators; operator > 0; operator -= 1) {
    const order = <f32>operator;
    let angle = v128.mul<f32>(v128.mul<f32>(phase, v128.splat<f32>(TAU)), v128.add<f32>(ratio, v128.splat<f32>(order * 0.37)));
    angle = v128.add<f32>(angle, v128.div<f32>(v128.mul<f32>(modulator, index), v128.splat<f32>(Mathf.sqrt(order))));
    angle = v128.add<f32>(angle, v128.mul<f32>(motion, v128.splat<f32>(time * order * 0.31)));
    modulator = fast_sin4(angle);
  }
  return v128.mul<f32>(fast_sin4(v128.add<f32>(v128.mul<f32>(phase, v128.splat<f32>(TAU)), v128.mul<f32>(modulator, index))), v128.splat<f32>(0.86));
}

function render_fold4(phase: v128, color: v128, motion: v128, detail: i32, time: f32): v128 {
  const sine = fast_sin4(v128.mul<f32>(phase, v128.splat<f32>(TAU)));
  const triangle = v128.sub<f32>(v128.splat<f32>(1.0), v128.mul<f32>(v128.abs<f32>(v128.sub<f32>(phase, v128.splat<f32>(0.5))), v128.splat<f32>(4.0)));
  const saw = v128.sub<f32>(v128.mul<f32>(phase, v128.splat<f32>(2.0)), v128.splat<f32>(1.0));
  const first = clamp4(v128.mul<f32>(color, v128.splat<f32>(2.0)), 0.0, 1.0);
  const second = clamp4(v128.mul<f32>(v128.sub<f32>(color, v128.splat<f32>(0.5)), v128.splat<f32>(2.0)), 0.0, 1.0);
  let value = v128.add<f32>(sine, v128.mul<f32>(v128.sub<f32>(triangle, sine), first));
  value = v128.add<f32>(value, v128.mul<f32>(v128.sub<f32>(saw, triangle), second));
  const folds = detail < 1 ? 1 : detail > 8 ? 8 : detail;
  for (let layer = 0; layer < folds; layer += 1) {
    const wobble = fast_sin(time * (0.17 + <f32>layer * 0.031) * TAU);
    const moved = v128.add<f32>(value, v128.mul<f32>(motion, v128.splat<f32>(wobble * 0.08)));
    value = fast_sin4(v128.mul<f32>(v128.mul<f32>(moved, v128.add<f32>(v128.splat<f32>(1.1), v128.mul<f32>(color, v128.splat<f32>(0.9)))), v128.splat<f32>(PI)));
  }
  return v128.mul<f32>(value, v128.splat<f32>(0.82));
}

function render_modal4(phase: v128, frequency: v128, color: v128, motion: v128, detail: i32, time: f32): v128 {
  let output = v128.splat<f32>(0.0);
  const requested = detail < 1 ? 1 : detail > 24 ? 24 : detail;
  for (let mode = 1; mode <= requested; mode += 1) {
    const order = <f32>mode;
    const baseRatio = order + order * order * 0.009;
    const ratio = v128.add<f32>(v128.splat<f32>(baseRatio), v128.mul<f32>(color, v128.splat<f32>(order * order * 0.026 + (hash11(order * 19.7) - 0.5) * 0.18)));
    const audible = v128.lt<f32>(v128.mul<f32>(frequency, ratio), v128.splat<f32>(21000.0));
    const tremble = v128.mul<f32>(motion, v128.splat<f32>(fast_sin(time * (0.21 + order * 0.013) * TAU) * 0.035));
    const sample = v128.div<f32>(fast_sin4(v128.add<f32>(v128.mul<f32>(v128.mul<f32>(phase, ratio), v128.splat<f32>(TAU)), tremble)), v128.splat<f32>(Mathf.sqrt(order) * (1.0 + order * 0.08)));
    output = v128.add<f32>(output, v128.bitselect(sample, v128.splat<f32>(0.0), audible));
  }
  return v128.mul<f32>(output, v128.splat<f32>(0.35));
}

function particle_grit(color: f32, time: f32, order: f32): f32 {
  return hash11(Mathf.floor(time * (3000.0 + color * 18000.0)) + order) * 2.0 - 1.0;
}

function particle_grit4(color: v128, time: f32, order: f32): v128 {
  let grit = v128.splat<f32>(0.0);
  grit = v128.replace_lane<f32>(grit, 0, particle_grit(v128.extract_lane<f32>(color, 0), time, order));
  grit = v128.replace_lane<f32>(grit, 1, particle_grit(v128.extract_lane<f32>(color, 1), time, order));
  grit = v128.replace_lane<f32>(grit, 2, particle_grit(v128.extract_lane<f32>(color, 2), time, order));
  return v128.replace_lane<f32>(grit, 3, particle_grit(v128.extract_lane<f32>(color, 3), time, order));
}

function render_particle4(phase: v128, color: v128, motion: v128, detail: i32, time: f32): v128 {
  let output = v128.splat<f32>(0.0);
  const grains = detail < 1 ? 1 : detail > 16 ? 16 : detail;
  const density = v128.add<f32>(v128.splat<f32>(3.0), v128.mul<f32>(motion, v128.splat<f32>(37.0)));
  for (let grain = 0; grain < grains; grain += 1) {
    const order = <f32>(grain + 1);
    const offset = hash11(order * 31.1);
    const position = fract4(v128.add<f32>(v128.mul<f32>(density, v128.splat<f32>(time)), v128.splat<f32>(offset)));
    const window = fast_sin4(v128.mul<f32>(position, v128.splat<f32>(PI)));
    const ratio: f32 = 0.5 + Mathf.floor(hash11(order * 7.3) * 9.0) * 0.5;
    const tone = fast_sin4(v128.add<f32>(v128.mul<f32>(phase, v128.splat<f32>(ratio * TAU)), v128.splat<f32>(offset * TAU)));
    const grit = particle_grit4(color, time, order);
    const particle = v128.add<f32>(tone, v128.mul<f32>(v128.sub<f32>(grit, tone), v128.mul<f32>(color, v128.splat<f32>(0.62))));
    output = v128.add<f32>(output, v128.mul<f32>(particle, v128.mul<f32>(window, window)));
  }
  return v128.mul<f32>(output, v128.splat<f32>(0.66 / Mathf.sqrt(<f32>grains)));
}

function organ_ratio(index: i32): f32 { if (index == 0) return 0.5; if (index == 1) return 1.0; if (index == 2) return 1.5; if (index == 3) return 2.0; if (index == 4) return 3.0; if (index == 5) return 4.0; if (index == 6) return 5.0; if (index == 7) return 6.0; return 8.0; }

function render_organ4(phase: v128, frequency: v128, color: v128, motion: v128, detail: i32, time: f32): v128 {
  let output = v128.splat<f32>(0.0);
  const ranks = detail < 1 ? 1 : detail > 9 ? 9 : detail;
  for (let rank = 0; rank < ranks; rank += 1) {
    const ratio = organ_ratio(rank);
    const audible = v128.lt<f32>(v128.mul<f32>(frequency, v128.splat<f32>(ratio)), v128.splat<f32>(21000.0));
    const colorSign: f32 = (rank & 1) == 0 ? 0.38 : -0.18;
    const level = v128.mul<f32>(v128.add<f32>(v128.splat<f32>(0.62), v128.mul<f32>(color, v128.splat<f32>(colorSign))), v128.splat<f32>(1.0 / Mathf.sqrt(<f32>(rank + 1))));
    const amMotion = fast_sin(time * (0.31 + <f32>rank * 0.09) * TAU) * 0.2 - 0.2;
    const am = v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(motion, v128.splat<f32>(amMotion)));
    const angle = v128.add<f32>(v128.mul<f32>(phase, v128.splat<f32>(ratio * TAU)), v128.mul<f32>(motion, v128.splat<f32>(fast_sin(time * 0.46 * TAU) * ratio * 0.03)));
    const sample = v128.mul<f32>(fast_sin4(angle), v128.mul<f32>(level, am));
    output = v128.add<f32>(output, v128.bitselect(sample, v128.splat<f32>(0.0), audible));
  }
  return v128.mul<f32>(output, v128.splat<f32>(0.31));
}

function render_formant4(phase: v128, frequency: v128, color: v128, motion: v128, detail: i32, time: f32): v128 {
  let output = v128.splat<f32>(0.0);
  const partials = detail < 1 ? 1 : detail > 24 ? 24 : detail;
  const first = v128.add<f32>(v128.splat<f32>(300.0), v128.mul<f32>(color, v128.splat<f32>(620.0)));
  const second = v128.sub<f32>(v128.splat<f32>(2450.0), v128.mul<f32>(color, v128.splat<f32>(1300.0)));
  const third = v128.sub<f32>(v128.splat<f32>(3100.0), v128.mul<f32>(color, v128.splat<f32>(420.0)));
  for (let partial = 1; partial <= partials; partial += 1) {
    const harmonic = <f32>partial;
    const hz = v128.mul<f32>(frequency, v128.splat<f32>(harmonic));
    const audible = v128.lt<f32>(hz, v128.splat<f32>(21000.0));
    const d1 = v128.div<f32>(v128.sub<f32>(hz, first), v128.splat<f32>(210.0));
    const d2 = v128.div<f32>(v128.sub<f32>(hz, second), v128.splat<f32>(360.0));
    const d3 = v128.div<f32>(v128.sub<f32>(hz, third), v128.splat<f32>(470.0));
    let weight = fast_exp4(v128.neg<f32>(v128.mul<f32>(d1, d1)));
    weight = v128.add<f32>(weight, v128.mul<f32>(fast_exp4(v128.neg<f32>(v128.mul<f32>(d2, d2))), v128.splat<f32>(0.72)));
    weight = v128.add<f32>(weight, v128.mul<f32>(fast_exp4(v128.neg<f32>(v128.mul<f32>(d3, d3))), v128.splat<f32>(0.42)));
    const wobble = v128.mul<f32>(motion, v128.splat<f32>(fast_sin(time * 0.7 * TAU + harmonic) * 0.08));
    let sample = v128.mul<f32>(fast_sin4(v128.add<f32>(v128.mul<f32>(phase, v128.splat<f32>(harmonic * TAU)), wobble)), v128.div<f32>(weight, v128.splat<f32>(Mathf.sqrt(harmonic))));
    sample = v128.bitselect(sample, v128.splat<f32>(0.0), audible);
    output = v128.add<f32>(output, sample);
  }
  return v128.mul<f32>(output, v128.splat<f32>(0.48));
}

function byte_formula(timeValue: u32, formula: i32, variation: u32): u32 {
  const t = timeValue + variation * 97;
  if (formula == 0) return t * ((t >> 5) | (t >> 8));
  if (formula == 1) return (t >> 6 | t | t >> (t >> 16)) * 10 + ((t >> 11) & 7);
  if (formula == 2) return (t * 5 & t >> 7) | (t * 3 & t >> 10);
  if (formula == 3) return t * ((t >> 9 | t >> 13) & (25 + (t >> 6)));
  if (formula == 4) return (t >> 7 | t | t >> 6) * 10 + 4 * (t & t >> 13 | t >> 6);
  return (t * (t >> 11 & t >> 8 & 123 & t >> 3)) ^ (t >> 4);
}

function render_bytebeat_lane(frequency: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  const clock = <u32>Mathf.max(0.0, time * (2800.0 + frequency * (18.0 + motion * 72.0)));
  const byte = byte_formula(clock, <i32>Mathf.floor(color * 5.999), <u32>(detail * 13) ^ <u32>param(50)) & 255;
  return (<f32>byte / 127.5 - 1.0) * 0.62;
}

function render_bytebeat4(frequency: v128, color: v128, motion: v128, detail: i32, time: f32): v128 {
  let result = v128.splat<f32>(0.0);
  result = v128.replace_lane<f32>(result, 0, render_bytebeat_lane(v128.extract_lane<f32>(frequency, 0), v128.extract_lane<f32>(color, 0), v128.extract_lane<f32>(motion, 0), detail, time));
  result = v128.replace_lane<f32>(result, 1, render_bytebeat_lane(v128.extract_lane<f32>(frequency, 1), v128.extract_lane<f32>(color, 1), v128.extract_lane<f32>(motion, 1), detail, time));
  result = v128.replace_lane<f32>(result, 2, render_bytebeat_lane(v128.extract_lane<f32>(frequency, 2), v128.extract_lane<f32>(color, 2), v128.extract_lane<f32>(motion, 2), detail, time));
  return v128.replace_lane<f32>(result, 3, render_bytebeat_lane(v128.extract_lane<f32>(frequency, 3), v128.extract_lane<f32>(color, 3), v128.extract_lane<f32>(motion, 3), detail, time));
}

function render_source4(kind: i32, phase: v128, frequency: v128, color: v128, motion: v128, detail: i32, time: f32): v128 {
  if (kind == 0) return render_vector4(phase, color, detail);
  if (kind == 1) return render_fm4(phase, color, motion, detail, time);
  if (kind == 2) return render_fold4(phase, color, motion, detail, time);
  if (kind == 3) return render_modal4(phase, frequency, color, motion, detail, time);
  if (kind == 4) return render_particle4(phase, color, motion, detail, time);
  if (kind == 5) return render_organ4(phase, frequency, color, motion, detail, time);
  if (kind == 6) return render_formant4(phase, frequency, color, motion, detail, time);
  return render_bytebeat4(frequency, color, motion, detail, time);
}

function combine_sources4(a: v128, b: v128, phaseA: v128, kind: i32, mixValue: v128, drive: f32): v128 {
  const amount = clamp4(mixValue, 0.0, 1.0);
  let value: v128;
  if (kind == 0) {
    const angle = v128.mul<f32>(amount, v128.splat<f32>(HALF_PI));
    value = v128.add<f32>(v128.mul<f32>(a, fast_sin4(v128.sub<f32>(v128.splat<f32>(HALF_PI), angle))), v128.mul<f32>(b, fast_sin4(angle)));
  } else if (kind == 1) {
    value = v128.div<f32>(v128.add<f32>(a, v128.mul<f32>(b, amount)), v128.sqrt<f32>(v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(amount, amount))));
  } else if (kind == 2) value = v128.mul<f32>(v128.mul<f32>(a, b), v128.add<f32>(v128.splat<f32>(0.8), v128.mul<f32>(amount, v128.splat<f32>(3.2))));
  else if (kind == 3) value = v128.mul<f32>(a, v128.add<f32>(v128.sub<f32>(v128.splat<f32>(1.0), amount), v128.mul<f32>(amount, v128.add<f32>(v128.mul<f32>(b, v128.splat<f32>(0.5)), v128.splat<f32>(0.5)))));
  else if (kind == 4) value = v128.add<f32>(v128.mul<f32>(fast_sin4(v128.mul<f32>(v128.add<f32>(phaseA, v128.mul<f32>(v128.mul<f32>(b, amount), v128.splat<f32>(0.32))), v128.splat<f32>(TAU))), v128.splat<f32>(0.82)), v128.mul<f32>(a, v128.splat<f32>(0.18)));
  else value = v128.sub<f32>(a, v128.mul<f32>(b, amount));
  const driven = v128.mul<f32>(value, v128.splat<f32>(clampf(drive, 0.25, 6.0)));
  return v128.div<f32>(driven, v128.add<f32>(v128.splat<f32>(1.0), v128.abs<f32>(driven)));
}

function shape_signal4(input: v128, kind: i32, amountValue: v128): v128 {
  const amount = clamp4(amountValue, 0.0, 1.0);
  if (kind == 0) return input;
  let wet = input;
  if (kind == 1) {
    const driven = v128.mul<f32>(input, v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(amount, v128.splat<f32>(11.0))));
    wet = v128.div<f32>(driven, v128.add<f32>(v128.splat<f32>(1.0), v128.abs<f32>(driven)));
  } else if (kind == 2) wet = fast_sin4(v128.mul<f32>(v128.mul<f32>(input, v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(amount, v128.splat<f32>(7.0)))), v128.splat<f32>(PI)));
  else if (kind == 3) { const x = clamp4(v128.mul<f32>(input, v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(amount, v128.splat<f32>(2.0)))), -1.0, 1.0); wet = v128.mul<f32>(v128.sub<f32>(v128.mul<f32>(v128.mul<f32>(v128.mul<f32>(x, x), x), v128.splat<f32>(4.0)), v128.mul<f32>(x, v128.splat<f32>(3.0))), v128.splat<f32>(0.82)); }
  else if (kind == 4) wet = v128.sub<f32>(v128.mul<f32>(v128.abs<f32>(input), v128.splat<f32>(2.0)), v128.splat<f32>(0.72));
  else { const levels = v128.max<f32>(v128.splat<f32>(4.0), v128.nearest<f32>(v128.add<f32>(v128.mul<f32>(v128.sub<f32>(v128.splat<f32>(1.0), amount), v128.splat<f32>(256.0)), v128.splat<f32>(4.0)))); wet = v128.div<f32>(v128.nearest<f32>(v128.mul<f32>(input, levels)), levels); }
  return v128.add<f32>(input, v128.mul<f32>(v128.sub<f32>(wet, input), amount));
}

function apply_filter4(input: v128, kind: i32, cutoffValue: v128, resonanceValue: v128, sampleRate: f32, lowBase: usize, bandBase: usize, offset: usize, active: v128): v128 {
  if (kind == 0) return input;
  const cutoff = clamp4(cutoffValue, 45.0, Mathf.min(18000.0, sampleRate * 0.42));
  const coefficient = clamp4(v128.sub<f32>(v128.splat<f32>(1.0), fast_exp4(v128.mul<f32>(cutoff, v128.splat<f32>(-TAU / sampleRate)))), 0.001, 0.92);
  const resonance = clamp4(resonanceValue, 0.0, 1.0);
  const previousLow = v128.load(lowBase + offset);
  const previousBand = v128.load(bandBase + offset);
  let low = previousLow;
  let band = previousBand;
  const driven = clamp4(v128.sub<f32>(input, v128.mul<f32>(v128.mul<f32>(band, resonance), v128.splat<f32>(1.72))), -3.0, 3.0);
  low = v128.add<f32>(low, v128.mul<f32>(coefficient, v128.sub<f32>(driven, low)));
  const high = v128.sub<f32>(driven, low);
  band = v128.add<f32>(band, v128.mul<f32>(coefficient, v128.sub<f32>(high, band)));
  low = clamp4(low, -2.0, 2.0);
  band = clamp4(band, -2.0, 2.0);
  v128.store(lowBase + offset, v128.bitselect(low, previousLow, active));
  v128.store(bandBase + offset, v128.bitselect(band, previousBand, active));
  if (kind == 1) return low;
  if (kind == 2) return v128.mul<f32>(band, v128.splat<f32>(1.4));
  if (kind == 3) return high;
  return v128.add<f32>(low, high);
}

function filter_rack4(input: v128, packOffset: usize, sampleRate: f32, cutoff1: v128, resonance1: v128, cutoff2: v128, resonance2: v128, active: v128): v128 {
  const kind1 = <i32>Mathf.round(param(16));
  const kind2 = <i32>Mathf.round(param(19));
  const route = <i32>Mathf.round(param(22));
  const blend = clampf(param(23), 0.0, 1.0);
  let first: v128;
  let second: v128;
  if (route == 0) { first = apply_filter4(input, kind1, cutoff1, resonance1, sampleRate, filter_1_low_ptr(), filter_1_band_ptr(), packOffset, active); return apply_filter4(first, kind2, cutoff2, resonance2, sampleRate, filter_2_low_ptr(), filter_2_band_ptr(), packOffset, active); }
  if (route == 1) { second = apply_filter4(input, kind2, cutoff2, resonance2, sampleRate, filter_2_low_ptr(), filter_2_band_ptr(), packOffset, active); return apply_filter4(second, kind1, cutoff1, resonance1, sampleRate, filter_1_low_ptr(), filter_1_band_ptr(), packOffset, active); }
  if (route == 5) {
    const previous = v128.load(filter_feedback_ptr() + packOffset);
    const feedbackInput = clamp4(v128.add<f32>(input, v128.mul<f32>(previous, v128.splat<f32>(blend * 0.82))), -2.0, 2.0);
    first = apply_filter4(feedbackInput, kind1, cutoff1, resonance1, sampleRate, filter_1_low_ptr(), filter_1_band_ptr(), packOffset, active);
    second = apply_filter4(first, kind2, cutoff2, resonance2, sampleRate, filter_2_low_ptr(), filter_2_band_ptr(), packOffset, active);
    v128.store(filter_feedback_ptr() + packOffset, v128.bitselect(second, previous, active));
    return second;
  }
  first = apply_filter4(input, kind1, cutoff1, resonance1, sampleRate, filter_1_low_ptr(), filter_1_band_ptr(), packOffset, active);
  second = apply_filter4(input, kind2, cutoff2, resonance2, sampleRate, filter_2_low_ptr(), filter_2_band_ptr(), packOffset, active);
  if (route == 2) return v128.add<f32>(v128.mul<f32>(first, v128.splat<f32>(fast_sin(HALF_PI - blend * HALF_PI))), v128.mul<f32>(second, v128.splat<f32>(fast_sin(blend * HALF_PI))));
  if (route == 3) {
    let evenMask = v128.splat<i32>(-1);
    evenMask = v128.replace_lane<i32>(evenMask, 1, 0);
    evenMask = v128.replace_lane<i32>(evenMask, 3, 0);
    return v128.bitselect(first, second, evenMask);
  }
  if (route == 4) return clamp4(v128.mul<f32>(v128.mul<f32>(first, second), v128.splat<f32>(1.0 + blend * 4.0)), -1.5, 1.5);
  return input;
}

function read_delay(base: usize, cursor: i32, delaySamplesValue: f32): f32 {
  const delaySamples = clampf(delaySamplesValue, 1.0, <f32>(DELAY_MASK - 2));
  const whole = <i32>Mathf.floor(delaySamples);
  const fraction = delaySamples - <f32>whole;
  const newer = (cursor - whole) & DELAY_MASK;
  const older = (newer - 1) & DELAY_MASK;
  return load<f32>(sample_ptr(base, newer)) * (1.0 - fraction) + load<f32>(sample_ptr(base, older)) * fraction;
}

function process_fx(slot: i32, kind: i32, amountValue: f32, timeValue: f32, feedbackValue: f32, inputLeft: f32, inputRight: f32, time: f32, sampleRate: f32): void {
  const amount = clampf(amountValue, 0.0, 1.0);
  if (kind == 0 || amount <= 0.0001) { fxOutLeft = inputLeft; fxOutRight = inputRight; return; }
  const leftBase = slot == 0 ? delay_1_left_ptr() : delay_2_left_ptr();
  const rightBase = slot == 0 ? delay_1_right_ptr() : delay_2_right_ptr();
  const cursor = slot == 0 ? delay_cursor_1() : delay_cursor_2();
  const feedback = clampf(feedbackValue, 0.0, 0.84);
  let delaySeconds = clampf(timeValue, 0.002, 0.68);
  let wetLeft: f32 = 0.0, wetRight: f32 = 0.0;
  if (kind == 1) {
    const motion = fast_sin(time * (0.18 + timeValue * 12.0) * TAU);
    delaySeconds = 0.012 + timeValue * 0.028 + motion * (0.001 + amount * 0.006);
    wetLeft = read_delay(leftBase, cursor, delaySeconds * sampleRate);
    wetRight = read_delay(rightBase, cursor, (delaySeconds + 0.003 - motion * 0.002) * sampleRate);
  } else if (kind == 2) {
    const motion = fast_sin(time * (0.08 + timeValue * 18.0) * TAU);
    delaySeconds = 0.0015 + timeValue * 0.009 + motion * 0.0012;
    wetLeft = read_delay(leftBase, cursor, delaySeconds * sampleRate);
    wetRight = read_delay(rightBase, cursor, (delaySeconds + 0.0007) * sampleRate);
  } else if (kind == 3) {
    wetLeft = read_delay(rightBase, cursor, delaySeconds * sampleRate);
    wetRight = read_delay(leftBase, cursor, delaySeconds * sampleRate);
  } else if (kind == 4) {
    const motion = fast_sin(time * (0.07 + amount * 0.9) * TAU);
    delaySeconds = 0.006 + timeValue * (0.24 + motion * 0.18);
    wetLeft = fast_sin(read_delay(leftBase, cursor, delaySeconds * sampleRate) * (1.0 + amount * 2.4));
    wetRight = fast_sin(read_delay(rightBase, cursor, delaySeconds * 1.07 * sampleRate) * (1.0 + amount * 2.4));
  } else {
    const d1 = delaySeconds * sampleRate;
    wetLeft = (read_delay(leftBase, cursor, d1) + read_delay(rightBase, cursor, d1 * 0.73) + read_delay(leftBase, cursor, d1 * 0.47)) * 0.333;
    wetRight = (read_delay(rightBase, cursor, d1 * 0.89) + read_delay(leftBase, cursor, d1 * 0.61) + read_delay(rightBase, cursor, d1 * 0.37)) * 0.333;
  }
  const wetGain: f32 = kind == 2 ? 0.72 : 1.0;
  fxOutLeft = inputLeft * (1.0 - amount * 0.45) + wetLeft * amount * wetGain;
  fxOutRight = inputRight * (1.0 - amount * 0.45) + wetRight * amount * wetGain;
  store<f32>(sample_ptr(leftBase, cursor), clampf(inputLeft + (kind == 3 ? wetRight : wetLeft) * feedback, -1.5, 1.5));
  store<f32>(sample_ptr(rightBase, cursor), clampf(inputRight + (kind == 3 ? wetLeft : wetRight) * feedback, -1.5, 1.5));
  if (slot == 0) advance_delay_cursor_1(); else advance_delay_cursor_2();
}

function global_mod(destination: i32, time: f32, sequenceValue: f32): f32 {
  let result: f32 = 0.0;
  for (let routeIndex = 0; routeIndex < 4; routeIndex += 1) {
    const base = mod_routes_ptr() + <usize>(routeIndex << 4);
    if (<i32>Mathf.round(load<f32>(base, 4)) != destination) continue;
    const source = <i32>Mathf.round(load<f32>(base));
    let sourceValue: f32 = 0.0;
    if (source == 1) sourceValue = fast_sin(time * param(31) * TAU);
    else if (source == 2) sourceValue = fast_sin(time * param(32) * TAU + HALF_PI);
    else if (source == 4) sourceValue = sequenceValue * 2.0 - 1.0;
    else if (source == 5) sourceValue = hash11(Mathf.floor(time * Mathf.max(0.05, param(31) * 3.0))) * 2.0 - 1.0;
    else if (source == 8) sourceValue = param(48) * 2.0 - 1.0;
    else if (source == 9) sourceValue = param(49) * 2.0 - 1.0;
    result += sourceValue * clampf(load<f32>(base, 8), -1.0, 1.0);
  }
  return clampf(result, -1.0, 1.0);
}

export function process(framesValue: i32, sampleRateValue: f32, startTime: f32, sequenceTime: f32): void {
  const frames = bounded_frames(framesValue);
  const sampleRate = Mathf.max(8000.0, sampleRateValue);
  const attackCoefficient = v128.splat<f32>(1.0 - fast_exp(-1.0 / (clampf(param(24), 0.002, 2.0) * sampleRate)));
  const decayCoefficient = v128.splat<f32>(1.0 - fast_exp(-1.0 / (clampf(param(25), 0.02, 4.0) * sampleRate)));
  const releaseCoefficient = v128.splat<f32>(1.0 - fast_exp(-1.0 / (clampf(param(27), 0.02, 8.0) * sampleRate)));
  const dcCoefficient: f32 = fast_exp(-TAU * 18.0 / sampleRate);
  const zero = v128.splat<f32>(0.0);

  for (let frame = 0; frame < frames; frame += 1) {
    const time = startTime + <f32>frame / sampleRate;
    const seqTime = sequenceTime + <f32>frame / sampleRate;
    const sequenceValue = prepare_sequence(seqTime);
    let left: f32 = 0.0, right: f32 = 0.0;

    for (let pack = 0; pack < VOICE_COUNT; pack += 4) {
      const offset = <usize>(pack << 2);
      const note = v128.load(voice_note_ptr() + offset);
      const gate = clamp4(v128.load(voice_gate_ptr() + offset), 0.0, 1.0);
      const velocity = clamp4(v128.load(voice_velocity_ptr() + offset), 0.0, 1.0);
      let envelope = clamp4(v128.load(voice_envelope_ptr() + offset), 0.0, 1.2);
      let stage = v128.load(voice_stage_ptr() + offset);
      const attackMask = v128.and(v128.gt<f32>(stage, v128.splat<f32>(0.5)), v128.lt<f32>(stage, v128.splat<f32>(1.5)));
      const decayMask = v128.and(v128.ge<f32>(stage, v128.splat<f32>(1.5)), v128.gt<f32>(gate, v128.splat<f32>(0.5)));
      const sustainTarget = v128.mul<f32>(velocity, v128.splat<f32>(clampf(param(26), 0.0, 1.0)));
      let target = v128.bitselect(velocity, zero, attackMask);
      target = v128.bitselect(sustainTarget, target, decayMask);
      let coefficient = v128.bitselect(attackCoefficient, releaseCoefficient, attackMask);
      coefficient = v128.bitselect(decayCoefficient, coefficient, decayMask);
      envelope = v128.add<f32>(envelope, v128.mul<f32>(v128.sub<f32>(target, envelope), coefficient));
      const attackDone = v128.and(attackMask, v128.ge<f32>(envelope, v128.mul<f32>(velocity, v128.splat<f32>(0.992))));
      stage = v128.bitselect(v128.splat<f32>(2.0), stage, attackDone);
      const releasing = v128.le<f32>(gate, v128.splat<f32>(0.5));
      stage = v128.bitselect(zero, stage, releasing);
      envelope = v128.bitselect(zero, envelope, v128.and(releasing, v128.lt<f32>(envelope, v128.splat<f32>(0.000001))));
      v128.store(voice_envelope_ptr() + offset, envelope);
      v128.store(voice_stage_ptr() + offset, stage);
      const active = v128.and(v128.ge<f32>(note, zero), v128.gt<f32>(envelope, v128.splat<f32>(0.000001)));

      let pitchModA = zero, pitchModB = zero, colorModA = zero, colorModB = zero, motionModA = zero, motionModB = zero;
      let combineMod = zero, shaperMod = zero, cutoffMod1 = zero, cutoffMod2 = zero, resonanceMod1 = zero, resonanceMod2 = zero, stereoMod = zero;
      for (let routeIndex = 0; routeIndex < 4; routeIndex += 1) {
        const routeBase = mod_routes_ptr() + <usize>(routeIndex << 4);
        const source = <i32>Mathf.round(load<f32>(routeBase));
        const destination = <i32>Mathf.round(load<f32>(routeBase, 4));
        const value = v128.mul<f32>(modulation_source4(source, time, envelope, velocity, note, sequenceValue), v128.splat<f32>(clampf(load<f32>(routeBase, 8), -1.0, 1.0)));
        if (destination == 0) pitchModA = v128.add<f32>(pitchModA, value); else if (destination == 1) pitchModB = v128.add<f32>(pitchModB, value);
        else if (destination == 2) colorModA = v128.add<f32>(colorModA, value); else if (destination == 3) colorModB = v128.add<f32>(colorModB, value);
        else if (destination == 4) motionModA = v128.add<f32>(motionModA, value); else if (destination == 5) motionModB = v128.add<f32>(motionModB, value);
        else if (destination == 6) combineMod = v128.add<f32>(combineMod, value); else if (destination == 7) shaperMod = v128.add<f32>(shaperMod, value);
        else if (destination == 8) cutoffMod1 = v128.add<f32>(cutoffMod1, value); else if (destination == 9) cutoffMod2 = v128.add<f32>(cutoffMod2, value);
        else if (destination == 10) resonanceMod1 = v128.add<f32>(resonanceMod1, value); else if (destination == 11) resonanceMod2 = v128.add<f32>(resonanceMod2, value);
        else if (destination == 12) stereoMod = v128.add<f32>(stereoMod, value);
      }

      let drift = v128.splat<f32>(0.0);
      drift = v128.replace_lane<f32>(drift, 0, (<f32>pack - 3.5) * param(30) * 1.8 / 1200.0);
      drift = v128.replace_lane<f32>(drift, 1, (<f32>(pack + 1) - 3.5) * param(30) * 1.8 / 1200.0);
      drift = v128.replace_lane<f32>(drift, 2, (<f32>(pack + 2) - 3.5) * param(30) * 1.8 / 1200.0);
      drift = v128.replace_lane<f32>(drift, 3, (<f32>(pack + 3) - 3.5) * param(30) * 1.8 / 1200.0);
      const baseFrequency = v128.mul<f32>(v128.splat<f32>(440.0), fast_pow2_4(v128.add<f32>(v128.div<f32>(v128.sub<f32>(note, v128.splat<f32>(69.0)), v128.splat<f32>(12.0)), drift)));
      const frequencyA = v128.mul<f32>(baseFrequency, fast_pow2_4(v128.div<f32>(v128.add<f32>(v128.splat<f32>(param(2)), v128.mul<f32>(pitchModA, v128.splat<f32>(12.0))), v128.splat<f32>(12.0))));
      const frequencyB = v128.mul<f32>(baseFrequency, fast_pow2_4(v128.div<f32>(v128.add<f32>(v128.splat<f32>(param(3)), v128.mul<f32>(pitchModB, v128.splat<f32>(12.0))), v128.splat<f32>(12.0))));
      const previousPhaseA = v128.load(voice_phase_a_ptr() + offset);
      const previousPhaseB = v128.load(voice_phase_b_ptr() + offset);
      const phaseA = v128.bitselect(fract4(v128.add<f32>(previousPhaseA, v128.div<f32>(frequencyA, v128.splat<f32>(sampleRate)))), previousPhaseA, active);
      const phaseB = v128.bitselect(fract4(v128.add<f32>(previousPhaseB, v128.div<f32>(frequencyB, v128.splat<f32>(sampleRate)))), previousPhaseB, active);
      v128.store(voice_phase_a_ptr() + offset, phaseA);
      v128.store(voice_phase_b_ptr() + offset, phaseB);
      const colorA = clamp4(v128.add<f32>(v128.splat<f32>(param(4)), v128.mul<f32>(colorModA, v128.splat<f32>(0.5))), 0.0, 1.0);
      const colorB = clamp4(v128.add<f32>(v128.splat<f32>(param(5)), v128.mul<f32>(colorModB, v128.splat<f32>(0.5))), 0.0, 1.0);
      const motionA = clamp4(v128.add<f32>(v128.splat<f32>(param(6)), v128.mul<f32>(motionModA, v128.splat<f32>(0.5))), 0.0, 1.0);
      const motionB = clamp4(v128.add<f32>(v128.splat<f32>(param(7)), v128.mul<f32>(motionModB, v128.splat<f32>(0.5))), 0.0, 1.0);
      const sourceA = render_source4(<i32>Mathf.round(param(0)), phaseA, frequencyA, colorA, motionA, <i32>Mathf.round(param(8)), time);
      const sourceB = render_source4(<i32>Mathf.round(param(1)), phaseB, frequencyB, colorB, motionB, <i32>Mathf.round(param(9)), time);
      let signal = combine_sources4(sourceA, sourceB, phaseA, <i32>Mathf.round(param(10)), v128.add<f32>(v128.splat<f32>(param(11)), v128.mul<f32>(combineMod, v128.splat<f32>(0.5))), param(12));
      const shaperAmount = clamp4(v128.add<f32>(v128.splat<f32>(param(14)), v128.mul<f32>(shaperMod, v128.splat<f32>(0.5))), 0.0, 1.0);
      const cutoff1 = clamp4(v128.mul<f32>(v128.splat<f32>(param(17)), fast_pow2_4(v128.mul<f32>(cutoffMod1, v128.splat<f32>(4.0)))), 45.0, 18000.0);
      const cutoff2 = clamp4(v128.mul<f32>(v128.splat<f32>(param(20)), fast_pow2_4(v128.mul<f32>(cutoffMod2, v128.splat<f32>(4.0)))), 45.0, 18000.0);
      const resonance1 = clamp4(v128.add<f32>(v128.splat<f32>(param(18)), v128.mul<f32>(resonanceMod1, v128.splat<f32>(0.5))), 0.0, 1.0);
      const resonance2 = clamp4(v128.add<f32>(v128.splat<f32>(param(21)), v128.mul<f32>(resonanceMod2, v128.splat<f32>(0.5))), 0.0, 1.0);
      if (param(15) < 0.5) { signal = shape_signal4(signal, <i32>Mathf.round(param(13)), shaperAmount); signal = filter_rack4(signal, offset, sampleRate, cutoff1, resonance1, cutoff2, resonance2, active); }
      else { signal = filter_rack4(signal, offset, sampleRate, cutoff1, resonance1, cutoff2, resonance2, active); signal = shape_signal4(signal, <i32>Mathf.round(param(13)), shaperAmount); }
      signal = v128.bitselect(clamp4(v128.mul<f32>(signal, v128.mul<f32>(envelope, v128.splat<f32>(0.33))), -1.2, 1.2), zero, active);
      const width = clamp4(v128.add<f32>(v128.splat<f32>(param(29)), v128.mul<f32>(stereoMod, v128.splat<f32>(0.5))), 0.0, 1.0);
      const sample0 = v128.extract_lane<f32>(signal, 0);
      const sample1 = v128.extract_lane<f32>(signal, 1);
      const sample2 = v128.extract_lane<f32>(signal, 2);
      const sample3 = v128.extract_lane<f32>(signal, 3);
      const pan0 = ((<f32>pack / <f32>(VOICE_COUNT - 1)) * 2.0 - 1.0) * v128.extract_lane<f32>(width, 0);
      const pan1 = ((<f32>(pack + 1) / <f32>(VOICE_COUNT - 1)) * 2.0 - 1.0) * v128.extract_lane<f32>(width, 1);
      const pan2 = ((<f32>(pack + 2) / <f32>(VOICE_COUNT - 1)) * 2.0 - 1.0) * v128.extract_lane<f32>(width, 2);
      const pan3 = ((<f32>(pack + 3) / <f32>(VOICE_COUNT - 1)) * 2.0 - 1.0) * v128.extract_lane<f32>(width, 3);
      left += sample0 * (0.72 - pan0 * 0.42) + sample1 * (0.72 - pan1 * 0.42) + sample2 * (0.72 - pan2 * 0.42) + sample3 * (0.72 - pan3 * 0.42);
      right += sample0 * (0.72 + pan0 * 0.42) + sample1 * (0.72 + pan1 * 0.42) + sample2 * (0.72 + pan2 * 0.42) + sample3 * (0.72 + pan3 * 0.42);
    }

    left = left / (1.0 + Mathf.abs(left));
    right = right / (1.0 + Mathf.abs(right));
    const fx1Amount = clampf(param(34) + global_mod(13, time, sequenceValue) * 0.5, 0.0, 1.0);
    const fx2Amount = clampf(param(38) + global_mod(14, time, sequenceValue) * 0.5, 0.0, 1.0);
    if (param(41) < 0.5) {
      process_fx(0, <i32>Mathf.round(param(33)), fx1Amount, param(35), param(36), left, right, time, sampleRate);
      process_fx(1, <i32>Mathf.round(param(37)), fx2Amount, param(39), param(40), fxOutLeft, fxOutRight, time, sampleRate);
    } else {
      process_fx(1, <i32>Mathf.round(param(37)), fx2Amount, param(39), param(40), left, right, time, sampleRate);
      process_fx(0, <i32>Mathf.round(param(33)), fx1Amount, param(35), param(36), fxOutLeft, fxOutRight, time, sampleRate);
    }
    const blockedLeft: f32 = fxOutLeft - dcInputLeft + dcOutputLeft * dcCoefficient;
    const blockedRight: f32 = fxOutRight - dcInputRight + dcOutputRight * dcCoefficient;
    dcInputLeft = fxOutLeft; dcInputRight = fxOutRight;
    dcOutputLeft = blockedLeft; dcOutputRight = blockedRight;
    store<f32>(sample_ptr(output_left_ptr(), frame), clampf(blockedLeft, -OUTPUT_CEILING, OUTPUT_CEILING));
    store<f32>(sample_ptr(output_right_ptr(), frame), clampf(blockedRight, -OUTPUT_CEILING, OUTPUT_CEILING));
  }
}

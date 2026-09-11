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

export function lane_width(): i32 { return 1; }
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

function smoothstep01(value: f32): f32 {
  const x = clampf(value, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

function hash11(value: f32): f32 {
  return fract(fast_sin(value * 127.1 + param(50) * 0.0137) * 43758.5453);
}

function swing_time(straightTime: f32, swing: f32): f32 {
  const amount: f32 = clampf(swing, 0.0, 0.42);
  const pair: f32 = Mathf.floor(straightTime * 0.5);
  const within: f32 = straightTime - pair * 2.0;
  const evenDuration: f32 = 1.0 + amount;
  if (within < evenDuration) return pair * 2.0 + within / evenDuration;
  return pair * 2.0 + 1.0 + (within - evenDuration) / (1.0 - amount);
}

function scale_size(scale: i32): i32 {
  if (scale == 4) return 6;
  if (scale == 5) return 5;
  return scale == 0 ? 12 : 7;
}

function scale_interval(index: i32, scale: i32): f32 {
  if (scale == 0) return <f32>index;
  if (scale == 1) {
    if (index == 0) return 0.0; if (index == 1) return 2.0; if (index == 2) return 3.0;
    if (index == 3) return 5.0; if (index == 4) return 7.0; if (index == 5) return 9.0; return 10.0;
  }
  if (scale == 2) {
    if (index == 0) return 0.0; if (index == 1) return 1.0; if (index == 2) return 3.0;
    if (index == 3) return 5.0; if (index == 4) return 7.0; if (index == 5) return 8.0; return 10.0;
  }
  if (scale == 3) {
    if (index == 0) return 0.0; if (index == 1) return 2.0; if (index == 2) return 3.0;
    if (index == 3) return 5.0; if (index == 4) return 7.0; if (index == 5) return 8.0; return 11.0;
  }
  if (scale == 4) return <f32>(index * 2);
  if (index == 0) return 0.0; if (index == 1) return 3.0; if (index == 2) return 5.0;
  if (index == 3) return 7.0; return 10.0;
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
  const bpm = clampf(param(42), 30.0, 240.0);
  const straight = sequenceSeconds * bpm / 60.0 * 4.0;
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
  const note: f32 = previousNote + (targetNote - previousNote) * glideAmount;
  const gate = enabled && phase < clampf(param(45), 0.05, 1.0);
  store<f32>(voice_note_ptr(), note);
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

function modulation_source(kind: i32, time: f32, envelope: f32, velocity: f32, note: f32, sequenceValue: f32): f32 {
  if (kind == 1) return fast_sin(time * param(31) * TAU);
  if (kind == 2) return fast_sin(time * param(32) * TAU + HALF_PI);
  if (kind == 3) return envelope * 2.0 - 1.0;
  if (kind == 4) return sequenceValue * 2.0 - 1.0;
  if (kind == 5) return hash11(Mathf.floor(time * Mathf.max(0.05, param(31) * 3.0))) * 2.0 - 1.0;
  if (kind == 6) return velocity * 2.0 - 1.0;
  if (kind == 7) return clampf((note - 60.0) / 24.0, -1.0, 1.0);
  if (kind == 8) return param(48) * 2.0 - 1.0;
  if (kind == 9) return param(49) * 2.0 - 1.0;
  return 0.0;
}

function render_vector(phase: f32, color: f32, detail: i32): f32 {
  let output: f32 = 0.0;
  const requested = detail < 1 ? 1 : detail > 24 ? 24 : detail;
  for (let partial = 1; partial <= requested; partial += 1) {
    const harmonic = <f32>partial;
    const odd = (partial & 1) == 1;
    const sineWeight: f32 = partial == 1 ? 1.0 : 0.0;
    const triangleWeight: f32 = odd ? (((partial - 1) & 2) == 0 ? 1.0 : -1.0) / (harmonic * harmonic) : 0.0;
    const sawWeight: f32 = 1.0 / harmonic;
    const first = color < 0.5 ? color * 2.0 : 1.0;
    const second = color > 0.5 ? (color - 0.5) * 2.0 : 0.0;
    const weight = (sineWeight + (triangleWeight - sineWeight) * first) + (sawWeight - triangleWeight) * second;
    output += fast_sin(phase * harmonic * TAU) * weight;
  }
  return output * 0.72;
}

function render_fm(phase: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  const operators = detail < 1 ? 1 : detail > 6 ? 6 : detail;
  const ratio: f32 = 1.0 + Mathf.floor(color * 5.0) * 0.5;
  const index: f32 = 0.08 + color * 5.2 + motion * 2.4;
  let modulator: f32 = 0.0;
  for (let operator = operators; operator > 0; operator -= 1) {
    const order = <f32>operator;
    modulator = fast_sin(phase * TAU * (ratio + order * 0.37) + modulator * index / Mathf.sqrt(order) + time * motion * order * 0.31);
  }
  return fast_sin(phase * TAU + modulator * index) * 0.86;
}

function render_fold(phase: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  const sine: f32 = fast_sin(phase * TAU);
  const triangle: f32 = 1.0 - 4.0 * Mathf.abs(phase - 0.5);
  const saw: f32 = phase * 2.0 - 1.0;
  const first: f32 = color < 0.5 ? color * 2.0 : 1.0;
  const second: f32 = color > 0.5 ? (color - 0.5) * 2.0 : 0.0;
  let value: f32 = sine + (triangle - sine) * first + (saw - triangle) * second;
  const folds = detail < 1 ? 1 : detail > 8 ? 8 : detail;
  for (let layer = 0; layer < folds; layer += 1) {
    value = fast_sin((value + fast_sin(time * (0.17 + <f32>layer * 0.031) * TAU) * motion * 0.08) * PI * (1.1 + color * 0.9));
  }
  return value * 0.82;
}

function render_modal(phase: f32, frequency: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  let output: f32 = 0.0;
  const requested = detail < 1 ? 1 : detail > 24 ? 24 : detail;
  for (let mode = 1; mode <= requested; mode += 1) {
    const order = <f32>mode;
    const ratio = order + order * order * (0.009 + color * 0.026) + (hash11(order * 19.7) - 0.5) * color * 0.18;
    if (frequency * ratio > 21000.0) break;
    const tremble = fast_sin(time * (0.21 + order * 0.013) * TAU) * motion * 0.035;
    output += fast_sin(phase * ratio * TAU + tremble) / (Mathf.sqrt(order) * (1.0 + order * 0.08));
  }
  return output * 0.35;
}

function render_particle(phase: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  let output: f32 = 0.0;
  const grains = detail < 1 ? 1 : detail > 16 ? 16 : detail;
  const density: f32 = 3.0 + motion * 37.0;
  for (let grain = 0; grain < grains; grain += 1) {
    const order = <f32>(grain + 1);
    const offset: f32 = hash11(order * 31.1);
    const position: f32 = fract(time * density + offset);
    const window: f32 = fast_sin(position * PI);
    const ratio: f32 = 0.5 + Mathf.floor(hash11(order * 7.3) * 9.0) * 0.5;
    const tone: f32 = fast_sin(phase * ratio * TAU + offset * TAU);
    const grit: f32 = hash11(Mathf.floor(time * (3000.0 + color * 18000.0)) + order) * 2.0 - 1.0;
    output += (tone + (grit - tone) * color * 0.62) * window * window;
  }
  return output * (0.66 / Mathf.sqrt(<f32>grains));
}

function organ_ratio(index: i32): f32 {
  if (index == 0) return 0.5; if (index == 1) return 1.0; if (index == 2) return 1.5;
  if (index == 3) return 2.0; if (index == 4) return 3.0; if (index == 5) return 4.0;
  if (index == 6) return 5.0; if (index == 7) return 6.0; return 8.0;
}

function render_organ(phase: f32, frequency: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  let output: f32 = 0.0;
  const ranks = detail < 1 ? 1 : detail > 9 ? 9 : detail;
  for (let rank = 0; rank < ranks; rank += 1) {
    const ratio = organ_ratio(rank);
    if (frequency * ratio > 21000.0) continue;
    const level: f32 = (1.0 / Mathf.sqrt(<f32>(rank + 1))) * (0.62 + color * ((rank & 1) == 0 ? 0.38 : -0.18));
    const am: f32 = 1.0 - motion * 0.2 + fast_sin(time * (0.31 + <f32>rank * 0.09) * TAU) * motion * 0.2;
    output += fast_sin(phase * ratio * TAU + fast_sin(time * 0.46 * TAU) * motion * ratio * 0.03) * level * am;
  }
  return output * 0.31;
}

function render_formant(phase: f32, frequency: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  let output: f32 = 0.0;
  const partials = detail < 1 ? 1 : detail > 24 ? 24 : detail;
  const first: f32 = 300.0 + color * 620.0;
  const second: f32 = 2450.0 - color * 1300.0;
  const third: f32 = 3100.0 - color * 420.0;
  for (let partial = 1; partial <= partials; partial += 1) {
    const harmonic = <f32>partial;
    const hz: f32 = frequency * harmonic;
    if (hz > 21000.0) break;
    const d1: f32 = (hz - first) / 210.0;
    const d2: f32 = (hz - second) / 360.0;
    const d3: f32 = (hz - third) / 470.0;
    const weight: f32 = fast_exp(-d1 * d1) + fast_exp(-d2 * d2) * 0.72 + fast_exp(-d3 * d3) * 0.42;
    output += fast_sin(phase * harmonic * TAU + fast_sin(time * 0.7 * TAU + harmonic) * motion * 0.08) * weight / Mathf.sqrt(harmonic);
  }
  return output * 0.48;
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

function render_bytebeat(frequency: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  const clock = <u32>Mathf.max(0.0, time * (2800.0 + frequency * (18.0 + motion * 72.0)));
  const formula = <i32>Mathf.floor(color * 5.999);
  const variation = <u32>(detail * 13) ^ <u32>param(50);
  const byte = byte_formula(clock, formula, variation) & 255;
  return (<f32>byte / 127.5 - 1.0) * 0.62;
}

function render_source(kind: i32, phase: f32, frequency: f32, color: f32, motion: f32, detail: i32, time: f32): f32 {
  if (kind == 0) return render_vector(phase, color, detail);
  if (kind == 1) return render_fm(phase, color, motion, detail, time);
  if (kind == 2) return render_fold(phase, color, motion, detail, time);
  if (kind == 3) return render_modal(phase, frequency, color, motion, detail, time);
  if (kind == 4) return render_particle(phase, color, motion, detail, time);
  if (kind == 5) return render_organ(phase, frequency, color, motion, detail, time);
  if (kind == 6) return render_formant(phase, frequency, color, motion, detail, time);
  return render_bytebeat(frequency, color, motion, detail, time);
}

function combine_sources(a: f32, b: f32, phaseA: f32, kind: i32, mixValue: f32, drive: f32): f32 {
  const amount = clampf(mixValue, 0.0, 1.0);
  let value: f32;
  if (kind == 0) value = a * Mathf.cos(amount * HALF_PI) + b * fast_sin(amount * HALF_PI);
  else if (kind == 1) value = (a + b * amount) / Mathf.sqrt(1.0 + amount * amount);
  else if (kind == 2) value = a * b * (0.8 + amount * 3.2);
  else if (kind == 3) value = a * (1.0 - amount + amount * (b * 0.5 + 0.5));
  else if (kind == 4) value = fast_sin((phaseA + b * amount * 0.32) * TAU) * 0.82 + a * 0.18;
  else value = a - b * amount;
  const driven = value * clampf(drive, 0.25, 6.0);
  return driven / (1.0 + Mathf.abs(driven));
}

function shape_signal(input: f32, kind: i32, amountValue: f32): f32 {
  const amount = clampf(amountValue, 0.0, 1.0);
  if (kind == 0 || amount <= 0.0001) return input;
  let wet: f32 = input;
  if (kind == 1) { const driven = input * (1.0 + amount * 11.0); wet = driven / (1.0 + Mathf.abs(driven)); }
  else if (kind == 2) wet = fast_sin(input * PI * (1.0 + amount * 7.0));
  else if (kind == 3) { const x = clampf(input * (1.0 + amount * 2.0), -1.0, 1.0); wet = (4.0 * x * x * x - 3.0 * x) * 0.82; }
  else if (kind == 4) wet = Mathf.abs(input) * 2.0 - 0.72;
  else { const levels = Mathf.max(4.0, Mathf.round(256.0 * (1.0 - amount) + 4.0)); wet = Mathf.round(input * levels) / levels; }
  return input + (wet - input) * amount;
}

function apply_filter(input: f32, kind: i32, cutoffValue: f32, resonanceValue: f32, sampleRate: f32, lowBase: usize, bandBase: usize, offset: usize): f32 {
  if (kind == 0) return input;
  const cutoff = clampf(cutoffValue, 45.0, Mathf.min(18000.0, sampleRate * 0.42));
  const coefficient = clampf(1.0 - fast_exp(-TAU * cutoff / sampleRate), 0.001, 0.92);
  const resonance = clampf(resonanceValue, 0.0, 1.0);
  let low = load<f32>(lowBase + offset);
  let band = load<f32>(bandBase + offset);
  const driven = clampf(input - band * resonance * 1.72, -3.0, 3.0);
  low += coefficient * (driven - low);
  const high = driven - low;
  band += coefficient * (high - band);
  low = clampf(low, -2.0, 2.0);
  band = clampf(band, -2.0, 2.0);
  store<f32>(lowBase + offset, low);
  store<f32>(bandBase + offset, band);
  if (kind == 1) return low;
  if (kind == 2) return band * 1.4;
  if (kind == 3) return high;
  return low + high;
}

function filter_rack(input: f32, voice: i32, sampleRate: f32, cutoff1: f32, resonance1: f32, cutoff2: f32, resonance2: f32): f32 {
  const offset = <usize>(voice << 2);
  const kind1 = <i32>Mathf.round(param(16));
  const kind2 = <i32>Mathf.round(param(19));
  const route = <i32>Mathf.round(param(22));
  const blend = clampf(param(23), 0.0, 1.0);
  let first: f32;
  let second: f32;
  if (route == 0) {
    first = apply_filter(input, kind1, cutoff1, resonance1, sampleRate, filter_1_low_ptr(), filter_1_band_ptr(), offset);
    return apply_filter(first, kind2, cutoff2, resonance2, sampleRate, filter_2_low_ptr(), filter_2_band_ptr(), offset);
  }
  if (route == 1) {
    second = apply_filter(input, kind2, cutoff2, resonance2, sampleRate, filter_2_low_ptr(), filter_2_band_ptr(), offset);
    return apply_filter(second, kind1, cutoff1, resonance1, sampleRate, filter_1_low_ptr(), filter_1_band_ptr(), offset);
  }
  if (route == 5) {
    const previous = load<f32>(filter_feedback_ptr() + offset);
    const feedbackInput = clampf(input + previous * blend * 0.82, -2.0, 2.0);
    first = apply_filter(feedbackInput, kind1, cutoff1, resonance1, sampleRate, filter_1_low_ptr(), filter_1_band_ptr(), offset);
    second = apply_filter(first, kind2, cutoff2, resonance2, sampleRate, filter_2_low_ptr(), filter_2_band_ptr(), offset);
    store<f32>(filter_feedback_ptr() + offset, second);
    return second;
  }
  first = apply_filter(input, kind1, cutoff1, resonance1, sampleRate, filter_1_low_ptr(), filter_1_band_ptr(), offset);
  second = apply_filter(input, kind2, cutoff2, resonance2, sampleRate, filter_2_low_ptr(), filter_2_band_ptr(), offset);
  if (route == 2) return first * Mathf.cos(blend * HALF_PI) + second * fast_sin(blend * HALF_PI);
  if (route == 3) return (voice & 1) == 0 ? first : second;
  if (route == 4) return clampf(first * second * (1.0 + blend * 4.0), -1.5, 1.5);
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
  let wetLeft: f32 = 0.0;
  let wetRight: f32 = 0.0;
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
    wetRight = fast_sin(read_delay(rightBase, cursor, (delaySeconds * 1.07) * sampleRate) * (1.0 + amount * 2.4));
  } else {
    const d1 = delaySeconds * sampleRate;
    wetLeft = (read_delay(leftBase, cursor, d1) + read_delay(rightBase, cursor, d1 * 0.73) + read_delay(leftBase, cursor, d1 * 0.47)) * 0.333;
    wetRight = (read_delay(rightBase, cursor, d1 * 0.89) + read_delay(leftBase, cursor, d1 * 0.61) + read_delay(rightBase, cursor, d1 * 0.37)) * 0.333;
  }
  const wetGain: f32 = kind == 2 ? 0.72 : 1.0;
  fxOutLeft = inputLeft * (1.0 - amount * 0.45) + wetLeft * amount * wetGain;
  fxOutRight = inputRight * (1.0 - amount * 0.45) + wetRight * amount * wetGain;
  const writeLeft = clampf(inputLeft + (kind == 3 ? wetRight : wetLeft) * feedback, -1.5, 1.5);
  const writeRight = clampf(inputRight + (kind == 3 ? wetLeft : wetRight) * feedback, -1.5, 1.5);
  store<f32>(sample_ptr(leftBase, cursor), writeLeft);
  store<f32>(sample_ptr(rightBase, cursor), writeRight);
  if (slot == 0) advance_delay_cursor_1(); else advance_delay_cursor_2();
}

function global_mod(destination: i32, time: f32, sequenceValue: f32): f32 {
  let result: f32 = 0.0;
  for (let routeIndex = 0; routeIndex < 4; routeIndex += 1) {
    const base = mod_routes_ptr() + <usize>(routeIndex << 4);
    const source = <i32>Mathf.round(load<f32>(base));
    const target = <i32>Mathf.round(load<f32>(base, 4));
    if (target != destination) continue;
    const amount = clampf(load<f32>(base, 8), -1.0, 1.0);
    result += modulation_source(source, time, 0.5, 0.5, 60.0, sequenceValue) * amount;
  }
  return clampf(result, -1.0, 1.0);
}

export function process(framesValue: i32, sampleRateValue: f32, startTime: f32, sequenceTime: f32): void {
  const frames = bounded_frames(framesValue);
  const sampleRate: f32 = Mathf.max(8000.0, sampleRateValue);
  const attackCoefficient: f32 = 1.0 - fast_exp(-1.0 / (clampf(param(24), 0.002, 2.0) * sampleRate));
  const decayCoefficient: f32 = 1.0 - fast_exp(-1.0 / (clampf(param(25), 0.02, 4.0) * sampleRate));
  const releaseCoefficient: f32 = 1.0 - fast_exp(-1.0 / (clampf(param(27), 0.02, 8.0) * sampleRate));
  const dcCoefficient: f32 = fast_exp(-TAU * 18.0 / sampleRate);

  for (let frame = 0; frame < frames; frame += 1) {
    const time: f32 = startTime + <f32>frame / sampleRate;
    const seqTime: f32 = sequenceTime + <f32>frame / sampleRate;
    const sequenceValue: f32 = prepare_sequence(seqTime);
    let left: f32 = 0.0;
    let right: f32 = 0.0;

    for (let voice = 0; voice < VOICE_COUNT; voice += 1) {
      const offset = <usize>(voice << 2);
      const note: f32 = load<f32>(voice_note_ptr() + offset);
      const gate: f32 = load<f32>(voice_gate_ptr() + offset);
      const velocity: f32 = clampf(load<f32>(voice_velocity_ptr() + offset), 0.0, 1.0);
      let envelope = clampf(load<f32>(voice_envelope_ptr() + offset), 0.0, 1.2);
      let stage = load<f32>(voice_stage_ptr() + offset);
      if (stage > 0.5 && stage < 1.5) {
        envelope += (velocity - envelope) * attackCoefficient;
        if (envelope >= velocity * 0.992) stage = 2.0;
      } else if (stage >= 1.5 && gate > 0.5) {
        envelope += (velocity * clampf(param(26), 0.0, 1.0) - envelope) * decayCoefficient;
      } else {
        envelope += -envelope * releaseCoefficient;
        stage = 0.0;
      }
      if (envelope < 0.000001 && gate <= 0.5) envelope = 0.0;
      store<f32>(voice_envelope_ptr() + offset, envelope);
      store<f32>(voice_stage_ptr() + offset, stage);
      if (note < 0.0 || envelope <= 0.000001) continue;

      let pitchModA: f32 = 0.0, pitchModB: f32 = 0.0, colorModA: f32 = 0.0, colorModB: f32 = 0.0;
      let motionModA: f32 = 0.0, motionModB: f32 = 0.0, combineMod: f32 = 0.0, shaperMod: f32 = 0.0;
      let cutoffMod1: f32 = 0.0, cutoffMod2: f32 = 0.0, resonanceMod1: f32 = 0.0, resonanceMod2: f32 = 0.0, stereoMod: f32 = 0.0;
      for (let routeIndex = 0; routeIndex < 4; routeIndex += 1) {
        const routeBase = mod_routes_ptr() + <usize>(routeIndex << 4);
        const source = <i32>Mathf.round(load<f32>(routeBase));
        const destination = <i32>Mathf.round(load<f32>(routeBase, 4));
        const amount = clampf(load<f32>(routeBase, 8), -1.0, 1.0);
        const value = modulation_source(source, time, envelope, velocity, note, sequenceValue) * amount;
        if (destination == 0) pitchModA += value; else if (destination == 1) pitchModB += value;
        else if (destination == 2) colorModA += value; else if (destination == 3) colorModB += value;
        else if (destination == 4) motionModA += value; else if (destination == 5) motionModB += value;
        else if (destination == 6) combineMod += value; else if (destination == 7) shaperMod += value;
        else if (destination == 8) cutoffMod1 += value; else if (destination == 9) cutoffMod2 += value;
        else if (destination == 10) resonanceMod1 += value; else if (destination == 11) resonanceMod2 += value;
        else if (destination == 12) stereoMod += value;
      }

      const voiceDrift = (<f32>voice - 3.5) * param(30) * 1.8 / 1200.0;
      const baseFrequency: f32 = 440.0 * fast_pow2((note - 69.0) / 12.0 + voiceDrift);
      const frequencyA: f32 = baseFrequency * fast_pow2((param(2) + pitchModA * 12.0) / 12.0);
      const frequencyB: f32 = baseFrequency * fast_pow2((param(3) + pitchModB * 12.0) / 12.0);
      let phaseA: f32 = fract(load<f32>(voice_phase_a_ptr() + offset) + frequencyA / sampleRate);
      let phaseB: f32 = fract(load<f32>(voice_phase_b_ptr() + offset) + frequencyB / sampleRate);
      store<f32>(voice_phase_a_ptr() + offset, phaseA);
      store<f32>(voice_phase_b_ptr() + offset, phaseB);
      const colorA = clampf(param(4) + colorModA * 0.5, 0.0, 1.0);
      const colorB = clampf(param(5) + colorModB * 0.5, 0.0, 1.0);
      const motionA = clampf(param(6) + motionModA * 0.5, 0.0, 1.0);
      const motionB = clampf(param(7) + motionModB * 0.5, 0.0, 1.0);
      const sourceA = render_source(<i32>Mathf.round(param(0)), phaseA, frequencyA, colorA, motionA, <i32>Mathf.round(param(8)), time);
      const sourceB = render_source(<i32>Mathf.round(param(1)), phaseB, frequencyB, colorB, motionB, <i32>Mathf.round(param(9)), time);
      let voiceSignal = combine_sources(sourceA, sourceB, phaseA, <i32>Mathf.round(param(10)), param(11) + combineMod * 0.5, param(12));
      const shaperAmount = clampf(param(14) + shaperMod * 0.5, 0.0, 1.0);
      const cutoff1 = clampf(param(17) * fast_pow2(cutoffMod1 * 4.0), 45.0, 18000.0);
      const cutoff2 = clampf(param(20) * fast_pow2(cutoffMod2 * 4.0), 45.0, 18000.0);
      const resonance1 = clampf(param(18) + resonanceMod1 * 0.5, 0.0, 1.0);
      const resonance2 = clampf(param(21) + resonanceMod2 * 0.5, 0.0, 1.0);
      if (param(15) < 0.5) {
        voiceSignal = shape_signal(voiceSignal, <i32>Mathf.round(param(13)), shaperAmount);
        voiceSignal = filter_rack(voiceSignal, voice, sampleRate, cutoff1, resonance1, cutoff2, resonance2);
      } else {
        voiceSignal = filter_rack(voiceSignal, voice, sampleRate, cutoff1, resonance1, cutoff2, resonance2);
        voiceSignal = shape_signal(voiceSignal, <i32>Mathf.round(param(13)), shaperAmount);
      }
      voiceSignal = clampf(voiceSignal * envelope * 0.33, -1.2, 1.2);
      const width = clampf(param(29) + stereoMod * 0.5, 0.0, 1.0);
      const pan = ((<f32>voice / <f32>(VOICE_COUNT - 1)) * 2.0 - 1.0) * width;
      left += voiceSignal * (0.72 - pan * 0.42);
      right += voiceSignal * (0.72 + pan * 0.42);
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

import {
  BLOCK_SIZE,
  DELAY_MASK,
  MAX_PARTIALS,
  SEQUENCE_LENGTH,
  advance_delay_cursor,
  bounded_frames,
  bounded_partials,
  clampf,
  delay_cursor,
  delay_left_ptr,
  delay_right_ptr,
  output_left_ptr,
  output_right_ptr,
  params_ptr,
  partial_base_ptr,
  partial_fold_ptr,
  reset,
  sample_ptr,
  step_expression_ptr,
  step_frequency_ptr,
  step_modulation_ptr,
  xl_params_ptr,
} from "./simd-303-kernel-layout";

export {
  output_left_ptr,
  output_right_ptr,
  params_ptr,
  partial_base_ptr,
  partial_fold_ptr,
  reset,
  step_expression_ptr,
  step_frequency_ptr,
  step_modulation_ptr,
  xl_params_ptr,
} from "./simd-303-kernel-layout";

const PI: f32 = 3.14159265358979323846;
const PI2: f32 = 6.28318530717958647692;
const HALF_PI: f32 = 1.57079632679489661923;
const INV_PI2: f32 = 0.15915494309189533577;
const LN2: f32 = 0.69314718055994530942;
const INV_LN2: f32 = 1.44269504088896340736;
const OUTPUT_MAKEUP: f32 = 5.0;
const OUTPUT_CEILING: f32 = 0.88;

export function lane_width(): i32 { return 1; }
export function block_size(): i32 { return BLOCK_SIZE; }
export function max_partials(): i32 { return MAX_PARTIALS; }
export function sequence_length(): i32 { return SEQUENCE_LENGTH; }

function fast_exp(value: f32): f32 {
  const x = clampf(value, -80.0, 80.0);
  const exponent = <i32>Mathf.floor(x * INV_LN2);
  const remainder = x - <f32>exponent * LN2;
  const polynomial: f32 = 1.0 + remainder * (
    1.0 + remainder * (
      0.5 + remainder * (
        0.1666666716 + remainder * (0.0416666679 + remainder * 0.0083333338)
      )
    )
  );
  return <f32>(polynomial * reinterpret<f32>((exponent + 127) << 23));
}

function fast_sin(value: f32): f32 {
  let x = value - Mathf.round(value * INV_PI2) * PI2;
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (
    1.0 + x2 * (
      -0.1666666716 + x2 * (
        0.0083333338 + x2 * (
          -0.0001984127 + x2 * (0.0000027557 + x2 * -0.0000000251)
        )
      )
    )
  );
}

function smoothstep(edge0: f32, edge1: f32, value: f32): f32 {
  const amount: f32 = clampf((value - edge0) / (edge1 - edge0), 0.0, 1.0);
  return amount * amount * (3.0 - 2.0 * amount);
}

function rem(value: f32, divisor: f32): f32 {
  return value - Mathf.floor(value / divisor) * divisor;
}

function swing_time(straightTime: f32, swing: f32): f32 {
  const amount: f32 = clampf(swing, 0.0, 0.42);
  if (amount <= 0.0) return straightTime;
  const pair: f32 = Mathf.floor(straightTime * 0.5);
  const pairTime: f32 = straightTime - pair * 2.0;
  const evenDuration: f32 = 1.0 + amount;
  if (pairTime < evenDuration) return <f32>(pair * 2.0 + pairTime / evenDuration);
  return <f32>(pair * 2.0 + 1.0 + (pairTime - evenDuration) / (1.0 - amount));
}

function probability_value(step: i32, cycle: i32): f32 {
  let value: u32 = (<u32>(step + 1) * 0x9e3779b9) ^ (<u32>(cycle + 1) * 0x85ebca6b);
  value ^= value << 13;
  value ^= value >> 17;
  value ^= value << 5;
  return <f32>(value & 0x00ffffff) / 16777215.0;
}

function read_delay(base: usize, cursor: i32, delaySamplesValue: f32): f32 {
  const delaySamples = clampf(delaySamplesValue, 1.0, <f32>(DELAY_MASK - 1));
  const whole = <i32>Mathf.floor(delaySamples);
  const fraction = delaySamples - <f32>whole;
  const newer = (cursor - whole) & DELAY_MASK;
  const older = (newer - 1) & DELAY_MASK;
  return load<f32>(sample_ptr(base, newer)) * (1.0 - fraction)
    + load<f32>(sample_ptr(base, older)) * fraction;
}

function render_effects(
  frame: i32,
  dryLeft: f32,
  dryRight: f32,
  time: f32,
  sampleRate: f32,
  timeScale: f32,
): void {
  const effects = xl_params_ptr();
  const chorusMix = clampf(load<f32>(effects), 0.0, 1.0);
  const chorusDepth = clampf(load<f32>(effects, 1 << 2), 0.0, 12.0) * 0.001;
  const chorusRate = clampf(load<f32>(effects, 2 << 2), 0.05, 5.0);
  const delayMix = clampf(load<f32>(effects, 3 << 2), 0.0, 1.0);
  const delaySteps = clampf(load<f32>(effects, 4 << 2), 0.25, 8.0);
  const feedback = clampf(load<f32>(effects, 5 << 2), 0.0, 0.85);
  const cursor = delay_cursor();
  const chorusMotion = fast_sin(time * chorusRate * PI2);
  const chorusLeft = read_delay(
    delay_left_ptr(),
    cursor,
    Mathf.max(2.0, (0.014 + chorusMotion * chorusDepth) * sampleRate),
  );
  const chorusRight = read_delay(
    delay_right_ptr(),
    cursor,
    Mathf.max(2.0, (0.014 - chorusMotion * chorusDepth) * sampleRate),
  );
  const delaySeconds = clampf(delaySteps / Mathf.max(timeScale, 0.01), 0.04, 0.6);
  const delayedLeft = read_delay(delay_left_ptr(), cursor, delaySeconds * sampleRate);
  const delayedRight = read_delay(delay_right_ptr(), cursor, delaySeconds * sampleRate);
  const chorusedLeft = dryLeft * (1.0 - chorusMix * 0.35) + chorusLeft * chorusMix * 0.7;
  const chorusedRight = dryRight * (1.0 - chorusMix * 0.35) + chorusRight * chorusMix * 0.7;
  const outputLeft = clampf(chorusedLeft + delayedLeft * delayMix * 0.72, -OUTPUT_CEILING, OUTPUT_CEILING);
  const outputRight = clampf(chorusedRight + delayedRight * delayMix * 0.72, -OUTPUT_CEILING, OUTPUT_CEILING);
  store<f32>(sample_ptr(delay_left_ptr(), cursor), clampf(dryLeft + delayedRight * feedback, -1.0, 1.0));
  store<f32>(sample_ptr(delay_right_ptr(), cursor), clampf(dryRight + delayedLeft * feedback, -1.0, 1.0));
  advance_delay_cursor(1);
  store<f32>(sample_ptr(output_left_ptr(), frame), outputLeft);
  store<f32>(sample_ptr(output_right_ptr(), frame), outputRight);
}

export function process(framesValue: i32, sampleRateValue: f32, startTime: f32): void {
  const frames = bounded_frames(framesValue);
  const sampleRate = Mathf.max(8_000.0, sampleRateValue);
  const params = params_ptr();
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const frequencies = step_frequency_ptr();
  const modulation = step_modulation_ptr();
  const expression = step_expression_ptr();
  const partialBase = partial_base_ptr();
  const partialFold = partial_fold_ptr();
  const partials = bounded_partials(<i32>load<f32>(params));
  const timeMod = Mathf.max(load<f32>(params, 2 << 2), 0.001);
  const timeScale = load<f32>(params, 3 << 2);
  const gain = load<f32>(params, 4 << 2);
  const drive = load<f32>(params, 5 << 2);
  const duration = load<f32>(params, 6 << 2);
  const stereoParam = load<f32>(params, 10 << 2);
  const resonanceParam = load<f32>(params, 12 << 2);
  const lfo = load<f32>(params, 13 << 2);
  const filterParam = load<f32>(params, 14 << 2);
  const swing = load<f32>(params, 15 << 2);
  const sequencePhase = load<f32>(params, 16 << 2);

  for (let frame = 0; frame < frames; frame += 1) {
    const time = startTime + <f32>frame / sampleRate;
    const straightTime = time * timeScale + sequencePhase;
    const swungTime = swing_time(straightTime, swing);
    const sequenceTime = rem(swungTime, timeMod);
    const noteTime = sequenceTime - Mathf.floor(sequenceTime);
    const step = <i32>Mathf.floor(sequenceTime) & (SEQUENCE_LENGTH - 1);
    const modulationOffset = <usize>(step << 4);
    const expressionOffset = <usize>(step << 4);
    const accent = clampf(load<f32>(expression + expressionOffset), 0.0, 1.0);
    const gate = clampf(load<f32>(expression + expressionOffset + 4), 0.05, 1.0);
    const slide = clampf(load<f32>(expression + expressionOffset + 8), 0.0, 1.0);
    const probability = clampf(load<f32>(expression + expressionOffset + 12), 0.0, 1.0);
    const cycle = <i32>Mathf.floor(swungTime / timeMod);
    const triggered = probability > 0.0
      && (probability >= 0.9999 || probability_value(step, cycle) <= probability);
    const stepGain = clampf(load<f32>(modulation + modulationOffset), 0.0, 1.0);
    const gatedDuration = duration * gate;
    const amplitude = smoothstep(
      0.05,
      0.0,
      Mathf.abs(noteTime - gatedDuration - 0.05) - gatedDuration,
    ) * fast_exp(-noteTime) * stepGain * (1.0 + accent * 1.25) * (triggered ? 1.0 : 0.0);
    const currentBase = load<f32>(frequencies + <usize>(step << 2));
    const activeSteps = <i32>Mathf.max(1.0, Mathf.round(timeMod));
    const previousStep = step > 0 ? step - 1 : activeSteps - 1;
    const previousBase = load<f32>(frequencies + <usize>(previousStep << 2));
    const slideAmount: f32 = slide <= 0.0 ? 1.0 : smoothstep(0.0, Mathf.max(0.001, slide * 0.9), noteTime);
    const base: f32 = previousBase + (currentBase - previousBase) * slideAmount;
    const square = smoothstep(
      0.0,
      0.01,
      Mathf.abs(rem(straightTime, timeMod) - 20.0) - 20.0,
    );
    const lfoSource = fast_sin(time * lfo + HALF_PI) * 0.5 + 0.5;
    const lfoSquared = lfoSource * lfoSource;
    const filter = fast_exp(noteTime * filterParam) * 50.0
      + lfoSquared * lfoSquared * 80.0
      + load<f32>(modulation + modulationOffset + 4)
      + accent * 18.0;
    const resonance = clampf(
      resonanceParam + load<f32>(modulation + modulationOffset + 8),
      0.0,
      15.0,
    );
    const stereo = clampf(
      stereoParam + load<f32>(modulation + modulationOffset + 12),
      -8.0,
      8.0,
    );
    const cut = filter - 20.0;
    let left: f32 = 0.0;
    let right: f32 = 0.0;
    const nyquist = sampleRate * 0.48;

    for (let partial = 0; partial < partials; partial += 1) {
      const partialOffset = <usize>(partial << 2);
      const harmonic = Mathf.max(<f32>partial + load<f32>(params, 8 << 2), 1.0);
      const stereoFrequencyRatio = (PI2 + Mathf.abs(stereo) * 0.5) / PI2;
      const partialFrequency = base * harmonic * stereoFrequencyRatio;
      if (partialFrequency >= nyquist) break;
      const bandLimit: f32 = smoothstep(nyquist, nyquist * 0.86, partialFrequency);
      const delta = harmonic - cut;
      const highDistance = Mathf.max(delta, 0.0);
      const resonanceDistance = Mathf.abs(delta);
      const spectralFilter = fast_exp(-0.005 * highDistance * highDistance) * 0.5
        + fast_exp(-0.1 * resonanceDistance * resonanceDistance) * resonance;
      const baseWeight = load<f32>(partialBase + partialOffset);
      const foldedWeight = load<f32>(partialFold + partialOffset);
      const intensity = (baseWeight + (foldedWeight - baseWeight) * square) * spectralFilter * bandLimit;
      const phase = time * base * harmonic;
      left += intensity * fast_sin((PI2 + stereo * 0.5) * phase);
      right += intensity * fast_sin((PI2 - stereo * 0.5) * phase);
    }

    const drivenLeft = clampf(left * amplitude * drive, -1.0, 1.0);
    const drivenRight = clampf(right * amplitude * drive, -1.0, 1.0);
    const dryLeft = clampf(drivenLeft * gain * OUTPUT_MAKEUP, -OUTPUT_CEILING, OUTPUT_CEILING);
    const dryRight = clampf(drivenRight * gain * OUTPUT_MAKEUP, -OUTPUT_CEILING, OUTPUT_CEILING);
    render_effects(frame, dryLeft, dryRight, time, sampleRate, timeScale);
  }
}

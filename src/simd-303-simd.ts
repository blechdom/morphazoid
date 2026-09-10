import {
  BLOCK_SIZE,
  DELAY_MASK,
  MAX_PARTIALS,
  SEQUENCE_LENGTH,
  advance_delay_cursor,
  bounded_frames,
  bounded_partials,
  clampf,
  control_amp_ptr,
  control_base_ptr,
  control_filter_ptr,
  control_resonance_ptr,
  control_square_ptr,
  control_stereo_ptr,
  control_time_ptr,
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

export function lane_width(): i32 { return 4; }
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

function fast_exp4(value: v128): v128 {
  const lower = v128.splat<f32>(-80.0);
  const upper = v128.splat<f32>(80.0);
  const x = v128.max<f32>(lower, v128.min<f32>(upper, value));
  const exponent = v128.floor<f32>(v128.mul<f32>(x, v128.splat<f32>(INV_LN2)));
  const remainder = v128.sub<f32>(x, v128.mul<f32>(exponent, v128.splat<f32>(LN2)));
  let polynomial = v128.splat<f32>(0.0083333338);
  polynomial = v128.add<f32>(v128.splat<f32>(0.0416666679), v128.mul<f32>(remainder, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(0.1666666716), v128.mul<f32>(remainder, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(0.5), v128.mul<f32>(remainder, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(remainder, polynomial));
  polynomial = v128.add<f32>(v128.splat<f32>(1.0), v128.mul<f32>(remainder, polynomial));
  const exponentInteger = v128.trunc_sat<i32>(exponent);
  const exponentBits = v128.shl<i32>(
    v128.add<i32>(exponentInteger, v128.splat<i32>(127)),
    23,
  );
  return v128.mul<f32>(polynomial, exponentBits);
}

function fast_sin4(value: v128): v128 {
  let x = v128.sub<f32>(
    value,
    v128.mul<f32>(v128.nearest<f32>(v128.mul<f32>(value, v128.splat<f32>(INV_PI2))), v128.splat<f32>(PI2)),
  );
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

function prepare_control(lane: i32, time: f32): void {
  const params = params_ptr();
  const frequencies = step_frequency_ptr();
  const modulation = step_modulation_ptr();
  const expression = step_expression_ptr();
  const timeMod = Mathf.max(load<f32>(params, 2 << 2), 0.001);
  const timeScale = load<f32>(params, 3 << 2);
  const duration = load<f32>(params, 6 << 2);
  const straightTime = time * timeScale + load<f32>(params, 16 << 2);
  const swungTime = swing_time(straightTime, load<f32>(params, 15 << 2));
  const sequenceTime = rem(swungTime, timeMod);
  const noteTime = sequenceTime - Mathf.floor(sequenceTime);
  const step = <i32>Mathf.floor(sequenceTime) & (SEQUENCE_LENGTH - 1);
  const modulationOffset = <usize>(step << 4);
  const expressionOffset = <usize>(step << 4);
  const laneOffset = <usize>(lane << 2);
  const accent = clampf(load<f32>(expression + expressionOffset), 0.0, 1.0);
  const gate = clampf(load<f32>(expression + expressionOffset + 4), 0.05, 1.0);
  const slide = clampf(load<f32>(expression + expressionOffset + 8), 0.0, 1.0);
  const probability = clampf(load<f32>(expression + expressionOffset + 12), 0.0, 1.0);
  const cycle = <i32>Mathf.floor(swungTime / timeMod);
  const triggered = probability > 0.0
    && (probability >= 0.9999 || probability_value(step, cycle) <= probability);
  const gatedDuration = duration * gate;
  const amplitude = smoothstep(
    0.05,
    0.0,
    Mathf.abs(noteTime - gatedDuration - 0.05) - gatedDuration,
  ) * fast_exp(-noteTime)
    * clampf(load<f32>(modulation + modulationOffset), 0.0, 1.0)
    * (1.0 + accent * 1.25)
    * (triggered ? 1.0 : 0.0);
  const square = smoothstep(
    0.0,
    0.01,
    Mathf.abs(rem(straightTime, timeMod) - 20.0) - 20.0,
  );
  const lfoSource = fast_sin(time * load<f32>(params, 13 << 2) + HALF_PI) * 0.5 + 0.5;
  const lfoSquared = lfoSource * lfoSource;
  const filter = fast_exp(noteTime * load<f32>(params, 14 << 2)) * 50.0
    + lfoSquared * lfoSquared * 80.0
    + load<f32>(modulation + modulationOffset + 4)
    + accent * 18.0;
  const currentBase = load<f32>(frequencies + <usize>(step << 2));
  const activeSteps = <i32>Mathf.max(1.0, Mathf.round(timeMod));
  const previousStep = step > 0 ? step - 1 : activeSteps - 1;
  const previousBase = load<f32>(frequencies + <usize>(previousStep << 2));
  const slideAmount: f32 = slide <= 0.0 ? 1.0 : smoothstep(0.0, Mathf.max(0.001, slide * 0.9), noteTime);
  const base: f32 = previousBase + (currentBase - previousBase) * slideAmount;
  store<f32>(control_time_ptr() + laneOffset, time);
  store<f32>(control_amp_ptr() + laneOffset, amplitude);
  store<f32>(control_base_ptr() + laneOffset, base);
  store<f32>(control_filter_ptr() + laneOffset, filter);
  store<f32>(
    control_resonance_ptr() + laneOffset,
    clampf(load<f32>(params, 12 << 2) + load<f32>(modulation + modulationOffset + 8), 0.0, 15.0),
  );
  store<f32>(
    control_stereo_ptr() + laneOffset,
    clampf(load<f32>(params, 10 << 2) + load<f32>(modulation + modulationOffset + 12), -8.0, 8.0),
  );
  store<f32>(control_square_ptr() + laneOffset, square);
}

export function process(framesValue: i32, sampleRateValue: f32, startTime: f32): void {
  const frames = bounded_frames(framesValue);
  const sampleRate = Mathf.max(8_000.0, sampleRateValue);
  const params = params_ptr();
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const partialBase = partial_base_ptr();
  const partialFold = partial_fold_ptr();
  const partials = bounded_partials(<i32>load<f32>(params));
  const sampleOffset = load<f32>(params, 8 << 2);
  const gainDrive = load<f32>(params, 4 << 2) * OUTPUT_MAKEUP;
  const drive = load<f32>(params, 5 << 2);
  const timeScale = load<f32>(params, 3 << 2);
  const zero = v128.splat<f32>(0.0);
  const one = v128.splat<f32>(1.0);

  for (let frame = 0; frame < frames; frame += 4) {
    prepare_control(0, startTime + <f32>frame / sampleRate);
    prepare_control(1, startTime + <f32>(frame + 1) / sampleRate);
    prepare_control(2, startTime + <f32>(frame + 2) / sampleRate);
    prepare_control(3, startTime + <f32>(frame + 3) / sampleRate);
    const time = v128.load(control_time_ptr());
    const amplitude = v128.load(control_amp_ptr());
    const base = v128.load(control_base_ptr());
    const filterCut = v128.sub<f32>(v128.load(control_filter_ptr()), v128.splat<f32>(20.0));
    const resonance = v128.load(control_resonance_ptr());
    const stereo = v128.load(control_stereo_ptr());
    const square = v128.load(control_square_ptr());
    const minimumBase = Mathf.min(
      Mathf.min(load<f32>(control_base_ptr()), load<f32>(control_base_ptr(), 4)),
      Mathf.min(load<f32>(control_base_ptr(), 8), load<f32>(control_base_ptr(), 12)),
    );
    const nyquistValue = sampleRate * 0.48;
    const bandLimitedPartials = <i32>Mathf.ceil(nyquistValue / Mathf.max(minimumBase, 0.001) - sampleOffset + 1.0);
    const effectivePartials = bandLimitedPartials < 0
      ? 0
      : bandLimitedPartials < partials ? bandLimitedPartials : partials;
    const nyquist = v128.splat<f32>(nyquistValue);
    const stereoFrequencyRatio = v128.div<f32>(
      v128.add<f32>(v128.splat<f32>(PI2), v128.mul<f32>(v128.abs<f32>(stereo), v128.splat<f32>(0.5))),
      v128.splat<f32>(PI2),
    );
    let left = zero;
    let right = zero;

    for (let partial = 0; partial < effectivePartials; partial += 1) {
      const partialOffset = <usize>(partial << 2);
      const harmonicValue = Mathf.max(<f32>partial + sampleOffset, 1.0);
      const harmonic = v128.splat<f32>(harmonicValue);
      const partialFrequency = v128.mul<f32>(v128.mul<f32>(base, harmonic), stereoFrequencyRatio);
      const bandAmount = v128.max<f32>(
        zero,
        v128.min<f32>(
          one,
          v128.div<f32>(
            v128.sub<f32>(partialFrequency, nyquist),
            v128.splat<f32>(nyquistValue * -0.14),
          ),
        ),
      );
      const bandLimit = v128.mul<f32>(
        v128.mul<f32>(bandAmount, bandAmount),
        v128.sub<f32>(v128.splat<f32>(3.0), v128.mul<f32>(v128.splat<f32>(2.0), bandAmount)),
      );
      const delta = v128.sub<f32>(harmonic, filterCut);
      const highDistance = v128.max<f32>(delta, zero);
      const resonanceDistance = v128.abs<f32>(delta);
      const highSquared = v128.mul<f32>(highDistance, highDistance);
      const resonanceSquared = v128.mul<f32>(resonanceDistance, resonanceDistance);
      const spectralFilter = v128.add<f32>(
        v128.mul<f32>(fast_exp4(v128.mul<f32>(v128.splat<f32>(-0.005), highSquared)), v128.splat<f32>(0.5)),
        v128.mul<f32>(fast_exp4(v128.mul<f32>(v128.splat<f32>(-0.1), resonanceSquared)), resonance),
      );
      const baseWeight = v128.splat<f32>(load<f32>(partialBase + partialOffset));
      const foldedWeight = v128.splat<f32>(load<f32>(partialFold + partialOffset));
      const intensity = v128.mul<f32>(
        v128.mul<f32>(
          v128.add<f32>(baseWeight, v128.mul<f32>(v128.sub<f32>(foldedWeight, baseWeight), square)),
          spectralFilter,
        ),
        bandLimit,
      );
      const phase = v128.mul<f32>(v128.mul<f32>(time, base), harmonic);
      const leftAngle = v128.mul<f32>(
        v128.add<f32>(v128.splat<f32>(PI2), v128.mul<f32>(stereo, v128.splat<f32>(0.5))),
        phase,
      );
      const rightAngle = v128.mul<f32>(
        v128.sub<f32>(v128.splat<f32>(PI2), v128.mul<f32>(stereo, v128.splat<f32>(0.5))),
        phase,
      );
      left = v128.add<f32>(left, v128.mul<f32>(intensity, fast_sin4(leftAngle)));
      right = v128.add<f32>(right, v128.mul<f32>(intensity, fast_sin4(rightAngle)));
    }

    const drivenLeft = v128.max<f32>(
      v128.splat<f32>(-1.0),
      v128.min<f32>(one, v128.mul<f32>(v128.mul<f32>(left, amplitude), v128.splat<f32>(drive))),
    );
    const drivenRight = v128.max<f32>(
      v128.splat<f32>(-1.0),
      v128.min<f32>(one, v128.mul<f32>(v128.mul<f32>(right, amplitude), v128.splat<f32>(drive))),
    );
    const ceiling = v128.splat<f32>(OUTPUT_CEILING);
    const floor = v128.splat<f32>(-OUTPUT_CEILING);
    const dryLeft = v128.max<f32>(floor, v128.min<f32>(ceiling, v128.mul<f32>(drivenLeft, v128.splat<f32>(gainDrive))));
    const dryRight = v128.max<f32>(floor, v128.min<f32>(ceiling, v128.mul<f32>(drivenRight, v128.splat<f32>(gainDrive))));
    v128.store(
      sample_ptr(outputLeft, frame),
      dryLeft,
    );
    v128.store(
      sample_ptr(outputRight, frame),
      dryRight,
    );
    render_effects(frame, load<f32>(sample_ptr(outputLeft, frame)), load<f32>(sample_ptr(outputRight, frame)), startTime + <f32>frame / sampleRate, sampleRate, timeScale);
    render_effects(frame + 1, load<f32>(sample_ptr(outputLeft, frame + 1)), load<f32>(sample_ptr(outputRight, frame + 1)), startTime + <f32>(frame + 1) / sampleRate, sampleRate, timeScale);
    render_effects(frame + 2, load<f32>(sample_ptr(outputLeft, frame + 2)), load<f32>(sample_ptr(outputRight, frame + 2)), startTime + <f32>(frame + 2) / sampleRate, sampleRate, timeScale);
    render_effects(frame + 3, load<f32>(sample_ptr(outputLeft, frame + 3)), load<f32>(sample_ptr(outputRight, frame + 3)), startTime + <f32>(frame + 3) / sampleRate, sampleRate, timeScale);
  }
}

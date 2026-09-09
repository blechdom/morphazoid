import {
  activate_swarm,
  bounded_frames,
  bounded_freeze_bins,
  bounded_grains,
  bounded_mesh_modes,
  bounded_modes,
  bounded_spatial_sources,
  bounded_waveguides,
  cosine_ptr,
  decay_ptr,
  energy_ptr,
  freeze_cosine_ptr,
  freeze_decay_ptr,
  freeze_energy_ptr,
  freeze_gain_ptr,
  freeze_imaginary_ptr,
  freeze_magnitude_ptr,
  freeze_pan_left_ptr,
  freeze_pan_right_ptr,
  freeze_real_ptr,
  freeze_sine_ptr,
  gain_ptr,
  grain_age_ptr,
  grain_age_step_ptr,
  grain_gain_ptr,
  grain_meta_ptr,
  grain_pan_left_ptr,
  grain_pan_right_ptr,
  grain_position_ptr,
  grain_source_ptr,
  grain_speed_ptr,
  imaginary_ptr,
  input_ptr,
  ir_a_ptr,
  ir_b_ptr,
  ir_history_ptr,
  ir_meta_ptr,
  mesh_cosine_ptr,
  mesh_decay_ptr,
  mesh_energy_ptr,
  mesh_gain_ptr,
  mesh_imaginary_ptr,
  mesh_pan_left_ptr,
  mesh_pan_right_ptr,
  mesh_real_ptr,
  mesh_sine_ptr,
  mesh_strike_ptr,
  output_left_ptr,
  output_right_ptr,
  pan_left_ptr,
  pan_right_ptr,
  prepare_granular_frame,
  read_grain_source,
  real_ptr,
  reset,
  reset_granular,
  reset_freeze,
  reset_ir,
  reset_mesh,
  reset_resonator,
  reset_spatial,
  reset_swarm,
  reset_waveguides,
  sample_ptr,
  sine_ptr,
  soft_clip,
  spatial_cosine_ptr,
  spatial_energy_ptr,
  spatial_gain_ptr,
  spatial_imaginary_ptr,
  spatial_pan_left_ptr,
  spatial_pan_right_ptr,
  spatial_real_ptr,
  spatial_sine_ptr,
  strike_ptr,
  swarm_cosine_ptr,
  swarm_energy_ptr,
  swarm_gain_ptr,
  swarm_imaginary_ptr,
  swarm_pan_left_ptr,
  swarm_pan_right_ptr,
  swarm_real_ptr,
  swarm_sine_ptr,
  wrap_source_position,
  waveguide_buffer_ptr,
  waveguide_damping_ptr,
  waveguide_delay_ptr,
  waveguide_feedback_ptr,
  waveguide_filter_ptr,
  waveguide_gain_ptr,
  waveguide_meta_ptr,
  waveguide_pan_left_ptr,
  waveguide_pan_right_ptr,
} from "./simd-resonator-kernel-layout";

export {
  activate_swarm,
  cosine_ptr,
  decay_ptr,
  energy_ptr,
  freeze_cosine_ptr,
  freeze_decay_ptr,
  freeze_energy_ptr,
  freeze_gain_ptr,
  freeze_imaginary_ptr,
  freeze_magnitude_ptr,
  freeze_pan_left_ptr,
  freeze_pan_right_ptr,
  freeze_real_ptr,
  freeze_sine_ptr,
  gain_ptr,
  grain_age_ptr,
  grain_age_step_ptr,
  grain_gain_ptr,
  grain_meta_ptr,
  grain_pan_left_ptr,
  grain_pan_right_ptr,
  grain_position_ptr,
  grain_source_ptr,
  grain_speed_ptr,
  imaginary_ptr,
  input_ptr,
  ir_a_ptr,
  ir_b_ptr,
  ir_history_ptr,
  ir_meta_ptr,
  mesh_cosine_ptr,
  mesh_decay_ptr,
  mesh_energy_ptr,
  mesh_gain_ptr,
  mesh_imaginary_ptr,
  mesh_pan_left_ptr,
  mesh_pan_right_ptr,
  mesh_real_ptr,
  mesh_sine_ptr,
  mesh_strike_ptr,
  output_left_ptr,
  output_right_ptr,
  pan_left_ptr,
  pan_right_ptr,
  real_ptr,
  reset,
  reset_granular,
  reset_freeze,
  reset_ir,
  reset_mesh,
  reset_resonator,
  reset_spatial,
  reset_swarm,
  reset_waveguides,
  sine_ptr,
  spatial_cosine_ptr,
  spatial_energy_ptr,
  spatial_gain_ptr,
  spatial_imaginary_ptr,
  spatial_pan_left_ptr,
  spatial_pan_right_ptr,
  spatial_real_ptr,
  spatial_sine_ptr,
  strike_ptr,
  swarm_cosine_ptr,
  swarm_energy_ptr,
  swarm_gain_ptr,
  swarm_imaginary_ptr,
  swarm_pan_left_ptr,
  swarm_pan_right_ptr,
  swarm_real_ptr,
  swarm_sine_ptr,
  waveguide_buffer_ptr,
  waveguide_damping_ptr,
  waveguide_delay_ptr,
  waveguide_feedback_ptr,
  waveguide_filter_ptr,
  waveguide_gain_ptr,
  waveguide_meta_ptr,
  waveguide_pan_left_ptr,
  waveguide_pan_right_ptr,
} from "./simd-resonator-kernel-layout";

export function lane_width(): i32 { return 4; }
export function max_modes(): i32 { return 128; }
export function max_grains(): i32 { return 64; }
export function grain_source_size(): i32 { return 16_384; }
export function block_size(): i32 { return 128; }

function horizontal_sum(value: v128): f32 {
  return v128.extract_lane<f32>(value, 0)
    + v128.extract_lane<f32>(value, 1)
    + v128.extract_lane<f32>(value, 2)
    + v128.extract_lane<f32>(value, 3);
}

function gathered_source(position: v128): v128 {
  let result = v128.splat<f32>(0.0);
  result = v128.replace_lane<f32>(
    result,
    0,
    read_grain_source(v128.extract_lane<f32>(position, 0)),
  );
  result = v128.replace_lane<f32>(
    result,
    1,
    read_grain_source(v128.extract_lane<f32>(position, 1)),
  );
  result = v128.replace_lane<f32>(
    result,
    2,
    read_grain_source(v128.extract_lane<f32>(position, 2)),
  );
  return v128.replace_lane<f32>(
    result,
    3,
    read_grain_source(v128.extract_lane<f32>(position, 3)),
  );
}

function wrapped_position(position: v128): v128 {
  let result = v128.splat<f32>(0.0);
  result = v128.replace_lane<f32>(
    result,
    0,
    wrap_source_position(v128.extract_lane<f32>(position, 0)),
  );
  result = v128.replace_lane<f32>(
    result,
    1,
    wrap_source_position(v128.extract_lane<f32>(position, 1)),
  );
  result = v128.replace_lane<f32>(
    result,
    2,
    wrap_source_position(v128.extract_lane<f32>(position, 2)),
  );
  return v128.replace_lane<f32>(
    result,
    3,
    wrap_source_position(v128.extract_lane<f32>(position, 3)),
  );
}

export function process_resonator(
  framesValue: i32,
  modesValue: i32,
  impulse: f32,
  outputScale: f32,
): void {
  const frames = bounded_frames(framesValue);
  const modes = bounded_modes(modesValue);
  const input = input_ptr();
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const real = real_ptr();
  const imaginary = imaginary_ptr();
  const cosine = cosine_ptr();
  const sine = sine_ptr();
  const decay = decay_ptr();
  const strike = strike_ptr();
  const gain = gain_ptr();
  const panLeft = pan_left_ptr();
  const panRight = pan_right_ptr();
  const energy = energy_ptr();
  const energyFall = v128.splat<f32>(0.997);

  for (let frame = 0; frame < frames; frame += 1) {
    const excitation = load<f32>(sample_ptr(input, frame))
      + (frame == 0 ? impulse : 0.0);
    const excitationVector = v128.splat<f32>(excitation);
    let left = v128.splat<f32>(0.0);
    let right = v128.splat<f32>(0.0);

    for (let mode = 0; mode < modes; mode += 4) {
      const offset = <usize>(mode << 2);
      const previousReal = v128.load(real + offset);
      const previousImaginary = v128.add<f32>(
        v128.load(imaginary + offset),
        v128.mul<f32>(excitationVector, v128.load(strike + offset)),
      );
      const modeCosine = v128.load(cosine + offset);
      const modeSine = v128.load(sine + offset);
      const modeDecay = v128.load(decay + offset);
      const nextReal = v128.mul<f32>(
        v128.sub<f32>(
          v128.mul<f32>(previousReal, modeCosine),
          v128.mul<f32>(previousImaginary, modeSine),
        ),
        modeDecay,
      );
      const nextImaginary = v128.mul<f32>(
        v128.add<f32>(
          v128.mul<f32>(previousReal, modeSine),
          v128.mul<f32>(previousImaginary, modeCosine),
        ),
        modeDecay,
      );
      v128.store(real + offset, nextReal);
      v128.store(imaginary + offset, nextImaginary);

      const sample = v128.mul<f32>(nextReal, v128.load(gain + offset));
      left = v128.add<f32>(left, v128.mul<f32>(sample, v128.load(panLeft + offset)));
      right = v128.add<f32>(right, v128.mul<f32>(sample, v128.load(panRight + offset)));
      const previousEnergy = v128.mul<f32>(v128.load(energy + offset), energyFall);
      v128.store(energy + offset, v128.max<f32>(previousEnergy, v128.abs<f32>(sample)));
    }

    store<f32>(sample_ptr(outputLeft, frame), soft_clip(horizontal_sum(left) * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(horizontal_sum(right) * outputScale));
  }
}

export function process(
  framesValue: i32,
  modesValue: i32,
  impulse: f32,
  outputScale: f32,
): void {
  process_resonator(framesValue, modesValue, impulse, outputScale);
}

export function process_granular(
  framesValue: i32,
  grainCountValue: i32,
  spawnIncrement: f32,
  grainSizeSamples: f32,
  pitchRatio: f32,
  scanPosition: f32,
  scatter: f32,
  stereoWidth: f32,
  captureInput: i32,
  burstValue: i32,
  outputScale: f32,
): void {
  const frames = bounded_frames(framesValue);
  const grainCount = bounded_grains(grainCountValue);
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const positions = grain_position_ptr();
  const speeds = grain_speed_ptr();
  const ages = grain_age_ptr();
  const ageSteps = grain_age_step_ptr();
  const gains = grain_gain_ptr();
  const panLeft = grain_pan_left_ptr();
  const panRight = grain_pan_right_ptr();
  const zero = v128.splat<f32>(0.0);
  const one = v128.splat<f32>(1.0);
  const two = v128.splat<f32>(2.0);
  const four = v128.splat<f32>(4.0);

  for (let frame = 0; frame < frames; frame += 1) {
    prepare_granular_frame(
      frame,
      grainCount,
      spawnIncrement,
      grainSizeSamples,
      pitchRatio,
      scanPosition,
      scatter,
      stereoWidth,
      captureInput,
      burstValue,
    );
    let left = zero;
    let right = zero;
    for (let grain = 0; grain < grainCount; grain += 4) {
      const offset = <usize>(grain << 2);
      const age = v128.load(ages + offset);
      const active = v128.lt<f32>(age, one);
      const envelopeBase = v128.mul<f32>(four, v128.mul<f32>(age, v128.sub<f32>(one, age)));
      const envelope = v128.mul<f32>(envelopeBase, envelopeBase);
      const position = v128.load(positions + offset);
      const rawSample = v128.mul<f32>(
        v128.mul<f32>(gathered_source(position), envelope),
        v128.load(gains + offset),
      );
      const sample = v128.bitselect(rawSample, zero, active);
      left = v128.add<f32>(left, v128.mul<f32>(sample, v128.load(panLeft + offset)));
      right = v128.add<f32>(right, v128.mul<f32>(sample, v128.load(panRight + offset)));
      v128.store(
        positions + offset,
        wrapped_position(v128.add<f32>(position, v128.load(speeds + offset))),
      );
      v128.store(
        ages + offset,
        v128.min<f32>(two, v128.add<f32>(age, v128.load(ageSteps + offset))),
      );
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(horizontal_sum(left) * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(horizontal_sum(right) * outputScale));
  }
}

export function process_swarm(
  framesValue: i32,
  voicesValue: i32,
  outputScale: f32,
): void {
  const frames = bounded_frames(framesValue);
  const voices = bounded_modes(voicesValue);
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const real = swarm_real_ptr();
  const imaginary = swarm_imaginary_ptr();
  const cosine = swarm_cosine_ptr();
  const sine = swarm_sine_ptr();
  const gain = swarm_gain_ptr();
  const panLeft = swarm_pan_left_ptr();
  const panRight = swarm_pan_right_ptr();
  const energy = swarm_energy_ptr();
  const energyFall = v128.splat<f32>(0.995);
  const secondMix = v128.splat<f32>(0.18);
  const fundamentalMix = v128.splat<f32>(0.82);
  const two = v128.splat<f32>(2.0);
  const epsilon = v128.splat<f32>(0.0001);
  const fallbackReal = v128.splat<f32>(1.0);
  const fallbackImaginary = v128.splat<f32>(0.0);

  for (let voice = 0; voice < voices; voice += 4) {
    const offset = <usize>(voice << 2);
    const phaseReal = v128.load(real + offset);
    const phaseImaginary = v128.load(imaginary + offset);
    const magnitude = v128.sqrt<f32>(v128.add<f32>(
      v128.mul<f32>(phaseReal, phaseReal),
      v128.mul<f32>(phaseImaginary, phaseImaginary),
    ));
    const valid = v128.gt<f32>(magnitude, epsilon);
    const safeMagnitude = v128.max<f32>(magnitude, epsilon);
    v128.store(
      real + offset,
      v128.bitselect(v128.div<f32>(phaseReal, safeMagnitude), fallbackReal, valid),
    );
    v128.store(
      imaginary + offset,
      v128.bitselect(
        v128.div<f32>(phaseImaginary, safeMagnitude),
        fallbackImaginary,
        valid,
      ),
    );
  }

  for (let frame = 0; frame < frames; frame += 1) {
    let left = v128.splat<f32>(0.0);
    let right = v128.splat<f32>(0.0);
    for (let voice = 0; voice < voices; voice += 4) {
      const offset = <usize>(voice << 2);
      const previousReal = v128.load(real + offset);
      const previousImaginary = v128.load(imaginary + offset);
      const modeCosine = v128.load(cosine + offset);
      const modeSine = v128.load(sine + offset);
      const nextReal = v128.sub<f32>(
        v128.mul<f32>(previousReal, modeCosine),
        v128.mul<f32>(previousImaginary, modeSine),
      );
      const nextImaginary = v128.add<f32>(
        v128.mul<f32>(previousReal, modeSine),
        v128.mul<f32>(previousImaginary, modeCosine),
      );
      v128.store(real + offset, nextReal);
      v128.store(imaginary + offset, nextImaginary);
      const secondHarmonic = v128.mul<f32>(two, v128.mul<f32>(nextReal, nextImaginary));
      const sample = v128.mul<f32>(
        v128.add<f32>(
          v128.mul<f32>(nextImaginary, fundamentalMix),
          v128.mul<f32>(secondHarmonic, secondMix),
        ),
        v128.load(gain + offset),
      );
      left = v128.add<f32>(left, v128.mul<f32>(sample, v128.load(panLeft + offset)));
      right = v128.add<f32>(right, v128.mul<f32>(sample, v128.load(panRight + offset)));
      const previousEnergy = v128.mul<f32>(v128.load(energy + offset), energyFall);
      v128.store(energy + offset, v128.max<f32>(previousEnergy, v128.abs<f32>(sample)));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(horizontal_sum(left) * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(horizontal_sum(right) * outputScale));
  }
}

function capture_freeze_bins(
  bins: i32,
  captureStrength: f32,
  useInput: i32,
  sourceOffset: i32,
): void {
  const input = input_ptr();
  const source = grain_source_ptr();
  const real = freeze_real_ptr();
  const imaginary = freeze_imaginary_ptr();
  const magnitude = freeze_magnitude_ptr();
  const cosine = freeze_cosine_ptr();
  const sine = freeze_sine_ptr();
  const energy = freeze_energy_ptr();
  const one = v128.splat<f32>(1.0);
  const zero = v128.splat<f32>(0.0);
  const epsilon = v128.splat<f32>(0.000001);
  const magnitudeScale = v128.splat<f32>(0.03125);
  for (let bin = 0; bin < bins; bin += 4) {
    const offset = <usize>(bin << 2);
    const rotationReal = v128.load(cosine + offset);
    const rotationImaginary = v128.load(sine + offset);
    let phaseReal = one;
    let phaseImaginary = zero;
    let sumReal = zero;
    let sumImaginary = zero;
    for (let frame = 0; frame < 128; frame += 1) {
      const sample = useInput != 0
        ? load<f32>(sample_ptr(input, frame))
        : load<f32>(sample_ptr(source, (sourceOffset + frame) & 16_383)) * captureStrength;
      const sampleVector = v128.splat<f32>(sample);
      sumReal = v128.add<f32>(sumReal, v128.mul<f32>(sampleVector, phaseReal));
      sumImaginary = v128.sub<f32>(sumImaginary, v128.mul<f32>(sampleVector, phaseImaginary));
      const nextReal = v128.sub<f32>(
        v128.mul<f32>(phaseReal, rotationReal),
        v128.mul<f32>(phaseImaginary, rotationImaginary),
      );
      phaseImaginary = v128.add<f32>(
        v128.mul<f32>(phaseReal, rotationImaginary),
        v128.mul<f32>(phaseImaginary, rotationReal),
      );
      phaseReal = nextReal;
    }
    const rawMagnitude = v128.sqrt<f32>(v128.add<f32>(v128.mul<f32>(sumReal, sumReal), v128.mul<f32>(sumImaginary, sumImaginary)));
    const safeMagnitude = v128.max<f32>(epsilon, rawMagnitude);
    const capturedMagnitude = v128.mul<f32>(rawMagnitude, magnitudeScale);
    v128.store(real + offset, v128.div<f32>(sumReal, safeMagnitude));
    v128.store(imaginary + offset, v128.div<f32>(sumImaginary, safeMagnitude));
    v128.store(magnitude + offset, capturedMagnitude);
    v128.store(energy + offset, capturedMagnitude);
  }
}

export function process_freeze(
  framesValue: i32,
  binsValue: i32,
  captureStrength: f32,
  useInput: i32,
  sourceOffset: i32,
  outputScale: f32,
): void {
  const frames = bounded_frames(framesValue);
  const bins = bounded_freeze_bins(binsValue);
  if (captureStrength > 0.0) capture_freeze_bins(bins, captureStrength, useInput, sourceOffset);
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const real = freeze_real_ptr();
  const imaginary = freeze_imaginary_ptr();
  const cosine = freeze_cosine_ptr();
  const sine = freeze_sine_ptr();
  const magnitude = freeze_magnitude_ptr();
  const decay = freeze_decay_ptr();
  const gain = freeze_gain_ptr();
  const panLeft = freeze_pan_left_ptr();
  const panRight = freeze_pan_right_ptr();
  const energy = freeze_energy_ptr();
  const energyFall = v128.splat<f32>(0.996);
  for (let frame = 0; frame < frames; frame += 1) {
    let left = v128.splat<f32>(0.0);
    let right = v128.splat<f32>(0.0);
    for (let bin = 0; bin < bins; bin += 4) {
      const offset = <usize>(bin << 2);
      const previousReal = v128.load(real + offset);
      const previousImaginary = v128.load(imaginary + offset);
      const modeCosine = v128.load(cosine + offset);
      const modeSine = v128.load(sine + offset);
      const nextReal = v128.sub<f32>(v128.mul<f32>(previousReal, modeCosine), v128.mul<f32>(previousImaginary, modeSine));
      const nextImaginary = v128.add<f32>(v128.mul<f32>(previousReal, modeSine), v128.mul<f32>(previousImaginary, modeCosine));
      const nextMagnitude = v128.mul<f32>(v128.load(magnitude + offset), v128.load(decay + offset));
      v128.store(real + offset, nextReal);
      v128.store(imaginary + offset, nextImaginary);
      v128.store(magnitude + offset, nextMagnitude);
      const sample = v128.mul<f32>(v128.mul<f32>(nextReal, nextMagnitude), v128.load(gain + offset));
      left = v128.add<f32>(left, v128.mul<f32>(sample, v128.load(panLeft + offset)));
      right = v128.add<f32>(right, v128.mul<f32>(sample, v128.load(panRight + offset)));
      v128.store(energy + offset, v128.max<f32>(v128.mul<f32>(v128.load(energy + offset), energyFall), v128.abs<f32>(sample)));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(horizontal_sum(left) * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(horizontal_sum(right) * outputScale));
  }
}

export function process_ir(
  framesValue: i32,
  tapsValue: i32,
  morphValue: f32,
  excitation: f32,
  useInput: i32,
  outputScale: f32,
): void {
  const frames = bounded_frames(framesValue);
  const taps = bounded_modes(tapsValue);
  const morph = Mathf.max(0.0, Mathf.min(1.0, morphValue));
  const morphVector = v128.splat<f32>(morph);
  const input = input_ptr();
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const irA = ir_a_ptr();
  const irB = ir_b_ptr();
  const history = ir_history_ptr();
  const meta = ir_meta_ptr();
  let cursor = <i32>load<f32>(meta) & 127;
  for (let frame = 0; frame < frames; frame += 1) {
    cursor = (cursor - 1) & 127;
    const burstPhase = <f32>frame / 28.0;
    const burst = frame < 28
      ? excitation * (<f32>(((frame * 37 + 11) & 63) - 31) / 31.0) * (1.0 - burstPhase)
      : 0.0;
    const sample = (useInput != 0 ? load<f32>(sample_ptr(input, frame)) : 0.0) + burst;
    store<f32>(sample_ptr(history, cursor), sample);
    store<f32>(sample_ptr(history, cursor + 128), sample);
    let left = v128.splat<f32>(0.0);
    let right = v128.splat<f32>(0.0);
    for (let tap = 0; tap < taps; tap += 4) {
      const offset = <usize>(tap << 2);
      const sourceVector = v128.load(sample_ptr(history, cursor + tap));
      const a = v128.load(irA + offset);
      const b = v128.load(irB + offset);
      const leftIr = v128.add<f32>(a, v128.mul<f32>(v128.sub<f32>(b, a), morphVector));
      const rightIr = v128.add<f32>(b, v128.mul<f32>(v128.sub<f32>(a, b), morphVector));
      left = v128.add<f32>(left, v128.mul<f32>(sourceVector, leftIr));
      right = v128.add<f32>(right, v128.mul<f32>(sourceVector, rightIr));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(horizontal_sum(left) * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(horizontal_sum(right) * outputScale));
  }
  store<f32>(meta, <f32>cursor);
}

export function process_mesh(
  framesValue: i32,
  modesValue: i32,
  impulse: f32,
  couplingValue: f32,
  outputScale: f32,
): void {
  const frames = bounded_frames(framesValue);
  const modes = bounded_mesh_modes(modesValue);
  const coupling = Mathf.max(0.0, Mathf.min(1.0, couplingValue)) * 0.0035;
  const input = input_ptr();
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const real = mesh_real_ptr();
  const imaginary = mesh_imaginary_ptr();
  const cosine = mesh_cosine_ptr();
  const sine = mesh_sine_ptr();
  const decay = mesh_decay_ptr();
  const strike = mesh_strike_ptr();
  const gain = mesh_gain_ptr();
  const panLeft = mesh_pan_left_ptr();
  const panRight = mesh_pan_right_ptr();
  const energy = mesh_energy_ptr();
  const energyFall = v128.splat<f32>(0.996);
  for (let frame = 0; frame < frames; frame += 1) {
    let meanVector = v128.splat<f32>(0.0);
    for (let mode = 0; mode < modes; mode += 4) meanVector = v128.add<f32>(meanVector, v128.load(sample_ptr(real, mode)));
    const mean = horizontal_sum(meanVector) / <f32>modes;
    const excitation = load<f32>(sample_ptr(input, frame)) + (frame == 0 ? impulse : 0.0);
    const excitationVector = v128.splat<f32>(excitation);
    const couplingVector = v128.splat<f32>(mean * coupling);
    let left = v128.splat<f32>(0.0);
    let right = v128.splat<f32>(0.0);
    for (let mode = 0; mode < modes; mode += 4) {
      const offset = <usize>(mode << 2);
      const previousReal = v128.load(real + offset);
      const previousImaginary = v128.add<f32>(
        v128.add<f32>(v128.load(imaginary + offset), v128.mul<f32>(excitationVector, v128.load(strike + offset))),
        couplingVector,
      );
      const modeDecay = v128.load(decay + offset);
      const nextReal = v128.mul<f32>(v128.sub<f32>(v128.mul<f32>(previousReal, v128.load(cosine + offset)), v128.mul<f32>(previousImaginary, v128.load(sine + offset))), modeDecay);
      const nextImaginary = v128.mul<f32>(v128.add<f32>(v128.mul<f32>(previousReal, v128.load(sine + offset)), v128.mul<f32>(previousImaginary, v128.load(cosine + offset))), modeDecay);
      v128.store(real + offset, nextReal);
      v128.store(imaginary + offset, nextImaginary);
      const sample = v128.mul<f32>(nextReal, v128.load(gain + offset));
      left = v128.add<f32>(left, v128.mul<f32>(sample, v128.load(panLeft + offset)));
      right = v128.add<f32>(right, v128.mul<f32>(sample, v128.load(panRight + offset)));
      v128.store(energy + offset, v128.max<f32>(v128.mul<f32>(v128.load(energy + offset), energyFall), v128.abs<f32>(sample)));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(horizontal_sum(left) * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(horizontal_sum(right) * outputScale));
  }
}

function waveguide_burst(frame: i32, group: i32, excitation: f32): v128 {
  if (frame >= 42) return v128.splat<f32>(0.0);
  const envelope = excitation * (1.0 - <f32>frame / 42.0);
  let result = v128.splat<f32>(0.0);
  result = v128.replace_lane<f32>(result, 0, <f32>(((frame * 29 + (group + 0) * 47 + 13) & 127) - 63) / 63.0 * envelope);
  result = v128.replace_lane<f32>(result, 1, <f32>(((frame * 29 + (group + 1) * 47 + 13) & 127) - 63) / 63.0 * envelope);
  result = v128.replace_lane<f32>(result, 2, <f32>(((frame * 29 + (group + 2) * 47 + 13) & 127) - 63) / 63.0 * envelope);
  return v128.replace_lane<f32>(result, 3, <f32>(((frame * 29 + (group + 3) * 47 + 13) & 127) - 63) / 63.0 * envelope);
}

export function process_waveguides(
  framesValue: i32,
  stringsValue: i32,
  excitation: f32,
  useInput: i32,
  outputScale: f32,
): void {
  const frames = bounded_frames(framesValue);
  const strings = bounded_waveguides(stringsValue);
  const input = input_ptr();
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const buffer = waveguide_buffer_ptr();
  const filter = waveguide_filter_ptr();
  const delay = waveguide_delay_ptr();
  const damping = waveguide_damping_ptr();
  const feedback = waveguide_feedback_ptr();
  const gain = waveguide_gain_ptr();
  const panLeft = waveguide_pan_left_ptr();
  const panRight = waveguide_pan_right_ptr();
  const meta = waveguide_meta_ptr();
  for (let frame = 0; frame < frames; frame += 1) {
    let left = v128.splat<f32>(0.0);
    let right = v128.splat<f32>(0.0);
    for (let group = 0; group < strings; group += 4) {
      const groupIndex = group >> 2;
      let cursor = <i32>load<f32>(sample_ptr(meta, groupIndex));
      let stringDelay = <i32>load<f32>(sample_ptr(delay, group));
      if (stringDelay < 16) stringDelay = 16;
      if (stringDelay > 1_024) stringDelay = 1_024;
      if (cursor >= stringDelay) cursor = 0;
      const offset = <usize>((cursor * 16 + group) << 2);
      const stringOffset = <usize>(group << 2);
      const delayed = v128.load(buffer + offset);
      const previousFilter = v128.load(filter + stringOffset);
      const smoothed = v128.add<f32>(previousFilter, v128.mul<f32>(v128.sub<f32>(delayed, previousFilter), v128.load(damping + stringOffset)));
      const inputVector = useInput != 0 ? v128.splat<f32>(load<f32>(sample_ptr(input, frame)) * 0.24) : v128.splat<f32>(0.0);
      const driven = v128.add<f32>(inputVector, waveguide_burst(frame, group, excitation));
      v128.store(buffer + offset, v128.add<f32>(driven, v128.mul<f32>(smoothed, v128.load(feedback + stringOffset))));
      v128.store(filter + stringOffset, smoothed);
      const signal = v128.mul<f32>(delayed, v128.load(gain + stringOffset));
      left = v128.add<f32>(left, v128.mul<f32>(signal, v128.load(panLeft + stringOffset)));
      right = v128.add<f32>(right, v128.mul<f32>(signal, v128.load(panRight + stringOffset)));
      cursor += 1;
      if (cursor >= stringDelay) cursor = 0;
      store<f32>(sample_ptr(meta, groupIndex), <f32>cursor);
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(horizontal_sum(left) * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(horizontal_sum(right) * outputScale));
  }
}

export function process_spatial(
  framesValue: i32,
  sourcesValue: i32,
  outputScale: f32,
): void {
  const frames = bounded_frames(framesValue);
  const sources = bounded_spatial_sources(sourcesValue);
  const outputLeft = output_left_ptr();
  const outputRight = output_right_ptr();
  const real = spatial_real_ptr();
  const imaginary = spatial_imaginary_ptr();
  const cosine = spatial_cosine_ptr();
  const sine = spatial_sine_ptr();
  const gain = spatial_gain_ptr();
  const panLeft = spatial_pan_left_ptr();
  const panRight = spatial_pan_right_ptr();
  const energy = spatial_energy_ptr();
  const epsilon = v128.splat<f32>(0.0001);
  const energyFall = v128.splat<f32>(0.995);
  const color = v128.splat<f32>(0.16);
  for (let source = 0; source < sources; source += 4) {
    const offset = <usize>(source << 2);
    const phaseReal = v128.load(real + offset);
    const phaseImaginary = v128.load(imaginary + offset);
    const magnitude = v128.sqrt<f32>(v128.add<f32>(v128.mul<f32>(phaseReal, phaseReal), v128.mul<f32>(phaseImaginary, phaseImaginary)));
    const safeMagnitude = v128.max<f32>(magnitude, epsilon);
    v128.store(real + offset, v128.div<f32>(phaseReal, safeMagnitude));
    v128.store(imaginary + offset, v128.div<f32>(phaseImaginary, safeMagnitude));
  }
  for (let frame = 0; frame < frames; frame += 1) {
    let left = v128.splat<f32>(0.0);
    let right = v128.splat<f32>(0.0);
    for (let source = 0; source < sources; source += 4) {
      const offset = <usize>(source << 2);
      const previousReal = v128.load(real + offset);
      const previousImaginary = v128.load(imaginary + offset);
      const nextReal = v128.sub<f32>(v128.mul<f32>(previousReal, v128.load(cosine + offset)), v128.mul<f32>(previousImaginary, v128.load(sine + offset)));
      const nextImaginary = v128.add<f32>(v128.mul<f32>(previousReal, v128.load(sine + offset)), v128.mul<f32>(previousImaginary, v128.load(cosine + offset)));
      v128.store(real + offset, nextReal);
      v128.store(imaginary + offset, nextImaginary);
      const sample = v128.mul<f32>(v128.add<f32>(nextImaginary, v128.mul<f32>(v128.mul<f32>(nextReal, nextImaginary), color)), v128.load(gain + offset));
      left = v128.add<f32>(left, v128.mul<f32>(sample, v128.load(panLeft + offset)));
      right = v128.add<f32>(right, v128.mul<f32>(sample, v128.load(panRight + offset)));
      v128.store(energy + offset, v128.max<f32>(v128.mul<f32>(v128.load(energy + offset), energyFall), v128.abs<f32>(sample)));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(horizontal_sum(left) * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(horizontal_sum(right) * outputScale));
  }
}

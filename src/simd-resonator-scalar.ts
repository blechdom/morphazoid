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

export function lane_width(): i32 { return 1; }
export function max_modes(): i32 { return 128; }
export function max_grains(): i32 { return 64; }
export function grain_source_size(): i32 { return 16_384; }
export function block_size(): i32 { return 128; }

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

  for (let frame = 0; frame < frames; frame += 1) {
    const excitation = load<f32>(sample_ptr(input, frame))
      + (frame == 0 ? impulse : 0.0);
    let left: f32 = 0.0;
    let right: f32 = 0.0;

    for (let mode = 0; mode < modes; mode += 1) {
      const offset = <usize>(mode << 2);
      const previousReal = load<f32>(real + offset);
      const previousImaginary = load<f32>(imaginary + offset)
        + excitation * load<f32>(strike + offset);
      const modeCosine = load<f32>(cosine + offset);
      const modeSine = load<f32>(sine + offset);
      const modeDecay = load<f32>(decay + offset);
      const nextReal = (
        previousReal * modeCosine - previousImaginary * modeSine
      ) * modeDecay;
      const nextImaginary = (
        previousReal * modeSine + previousImaginary * modeCosine
      ) * modeDecay;
      store<f32>(real + offset, nextReal);
      store<f32>(imaginary + offset, nextImaginary);

      const sample = nextReal * load<f32>(gain + offset);
      left += sample * load<f32>(panLeft + offset);
      right += sample * load<f32>(panRight + offset);
      const previousEnergy = load<f32>(energy + offset) * 0.997;
      store<f32>(energy + offset, Mathf.max(previousEnergy, Mathf.abs(sample)));
    }

    store<f32>(sample_ptr(outputLeft, frame), soft_clip(left * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(right * outputScale));
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
    let left: f32 = 0.0;
    let right: f32 = 0.0;
    for (let grain = 0; grain < grainCount; grain += 1) {
      const offset = <usize>(grain << 2);
      const age = load<f32>(ages + offset);
      if (age >= 1.0) continue;
      const envelopeBase: f32 = <f32>4.0 * age * (<f32>1.0 - age);
      const envelope: f32 = envelopeBase * envelopeBase;
      const sample: f32 = read_grain_source(load<f32>(positions + offset))
        * envelope
        * load<f32>(gains + offset);
      left = <f32>(left + sample * load<f32>(panLeft + offset));
      right = <f32>(right + sample * load<f32>(panRight + offset));
      store<f32>(
        positions + offset,
        wrap_source_position(load<f32>(positions + offset) + load<f32>(speeds + offset)),
      );
      store<f32>(ages + offset, age + load<f32>(ageSteps + offset));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(left * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(right * outputScale));
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

  for (let voice = 0; voice < voices; voice += 1) {
    const offset = <usize>(voice << 2);
    const phaseReal = load<f32>(real + offset);
    const phaseImaginary = load<f32>(imaginary + offset);
    const magnitude = Mathf.sqrt(
      phaseReal * phaseReal + phaseImaginary * phaseImaginary,
    );
    if (magnitude > 0.0001) {
      store<f32>(real + offset, phaseReal / magnitude);
      store<f32>(imaginary + offset, phaseImaginary / magnitude);
    }
  }

  for (let frame = 0; frame < frames; frame += 1) {
    let left: f32 = 0.0;
    let right: f32 = 0.0;
    for (let voice = 0; voice < voices; voice += 1) {
      const offset = <usize>(voice << 2);
      const previousReal = load<f32>(real + offset);
      const previousImaginary = load<f32>(imaginary + offset);
      const nextReal = previousReal * load<f32>(cosine + offset)
        - previousImaginary * load<f32>(sine + offset);
      const nextImaginary = previousReal * load<f32>(sine + offset)
        + previousImaginary * load<f32>(cosine + offset);
      store<f32>(real + offset, nextReal);
      store<f32>(imaginary + offset, nextImaginary);
      const secondHarmonic: f32 = <f32>2.0 * nextReal * nextImaginary;
      const sample: f32 = <f32>(
        nextImaginary * <f32>0.82 + secondHarmonic * <f32>0.18
      ) * load<f32>(gain + offset);
      left = <f32>(left + sample * load<f32>(panLeft + offset));
      right = <f32>(right + sample * load<f32>(panRight + offset));
      const previousEnergy: f32 = load<f32>(energy + offset) * <f32>0.995;
      store<f32>(energy + offset, Mathf.max(previousEnergy, Mathf.abs(sample)));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(left * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(right * outputScale));
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
  for (let bin = 0; bin < bins; bin += 1) {
    const offset = <usize>(bin << 2);
    const rotationReal = load<f32>(cosine + offset);
    const rotationImaginary = load<f32>(sine + offset);
    let phaseReal: f32 = 1.0;
    let phaseImaginary: f32 = 0.0;
    let sumReal: f32 = 0.0;
    let sumImaginary: f32 = 0.0;
    for (let frame = 0; frame < 128; frame += 1) {
      const sample = useInput != 0
        ? load<f32>(sample_ptr(input, frame))
        : load<f32>(sample_ptr(source, (sourceOffset + frame) & 16_383)) * captureStrength;
      sumReal += sample * phaseReal;
      sumImaginary -= sample * phaseImaginary;
      const nextReal = phaseReal * rotationReal - phaseImaginary * rotationImaginary;
      phaseImaginary = phaseReal * rotationImaginary + phaseImaginary * rotationReal;
      phaseReal = nextReal;
    }
    const rawMagnitude = Mathf.sqrt(sumReal * sumReal + sumImaginary * sumImaginary);
    const safeMagnitude = Mathf.max(0.000001, rawMagnitude);
    const capturedMagnitude = rawMagnitude * 0.03125;
    store<f32>(real + offset, sumReal / safeMagnitude);
    store<f32>(imaginary + offset, sumImaginary / safeMagnitude);
    store<f32>(magnitude + offset, capturedMagnitude);
    store<f32>(energy + offset, capturedMagnitude);
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
  for (let frame = 0; frame < frames; frame += 1) {
    let left: f32 = 0.0;
    let right: f32 = 0.0;
    for (let bin = 0; bin < bins; bin += 1) {
      const offset = <usize>(bin << 2);
      const previousReal = load<f32>(real + offset);
      const previousImaginary = load<f32>(imaginary + offset);
      const nextReal = previousReal * load<f32>(cosine + offset) - previousImaginary * load<f32>(sine + offset);
      const nextImaginary = previousReal * load<f32>(sine + offset) + previousImaginary * load<f32>(cosine + offset);
      const nextMagnitude = load<f32>(magnitude + offset) * load<f32>(decay + offset);
      store<f32>(real + offset, nextReal);
      store<f32>(imaginary + offset, nextImaginary);
      store<f32>(magnitude + offset, nextMagnitude);
      const sample = nextReal * nextMagnitude * load<f32>(gain + offset);
      left += sample * load<f32>(panLeft + offset);
      right += sample * load<f32>(panRight + offset);
      store<f32>(energy + offset, Mathf.max(load<f32>(energy + offset) * 0.996, Mathf.abs(sample)));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(left * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(right * outputScale));
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
    let left: f32 = 0.0;
    let right: f32 = 0.0;
    for (let tap = 0; tap < taps; tap += 1) {
      const source = load<f32>(sample_ptr(history, cursor + tap));
      const a = load<f32>(sample_ptr(irA, tap));
      const b = load<f32>(sample_ptr(irB, tap));
      left += source * (a + (b - a) * morph);
      right += source * (b + (a - b) * morph);
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(left * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(right * outputScale));
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
  for (let frame = 0; frame < frames; frame += 1) {
    let mean: f32 = 0.0;
    for (let mode = 0; mode < modes; mode += 1) mean += load<f32>(sample_ptr(real, mode));
    mean /= <f32>modes;
    const excitation = load<f32>(sample_ptr(input, frame)) + (frame == 0 ? impulse : 0.0);
    let left: f32 = 0.0;
    let right: f32 = 0.0;
    for (let mode = 0; mode < modes; mode += 1) {
      const offset = <usize>(mode << 2);
      const previousReal = load<f32>(real + offset);
      const previousImaginary = load<f32>(imaginary + offset)
        + excitation * load<f32>(strike + offset) + mean * coupling;
      const modeDecay = load<f32>(decay + offset);
      const nextReal = (previousReal * load<f32>(cosine + offset) - previousImaginary * load<f32>(sine + offset)) * modeDecay;
      const nextImaginary = (previousReal * load<f32>(sine + offset) + previousImaginary * load<f32>(cosine + offset)) * modeDecay;
      store<f32>(real + offset, nextReal);
      store<f32>(imaginary + offset, nextImaginary);
      const sample = nextReal * load<f32>(gain + offset);
      left += sample * load<f32>(panLeft + offset);
      right += sample * load<f32>(panRight + offset);
      store<f32>(energy + offset, Mathf.max(load<f32>(energy + offset) * 0.996, Mathf.abs(sample)));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(left * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(right * outputScale));
  }
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
    let left: f32 = 0.0;
    let right: f32 = 0.0;
    for (let string = 0; string < strings; string += 1) {
      const group = string >> 2;
      let cursor = <i32>load<f32>(sample_ptr(meta, group));
      let stringDelay = <i32>load<f32>(sample_ptr(delay, string));
      if (stringDelay < 16) stringDelay = 16;
      if (stringDelay > 1_024) stringDelay = 1_024;
      if (cursor >= stringDelay) cursor = 0;
      const bufferIndex = cursor * 16 + string;
      const delayed = load<f32>(sample_ptr(buffer, bufferIndex));
      const previousFilter = load<f32>(sample_ptr(filter, string));
      const smoothed = previousFilter + (delayed - previousFilter) * load<f32>(sample_ptr(damping, string));
      const burstPhase = <f32>frame / 42.0;
      const burst = frame < 42
        ? excitation * (<f32>(((frame * 29 + string * 47 + 13) & 127) - 63) / 63.0) * (1.0 - burstPhase)
        : 0.0;
      const driven = (useInput != 0 ? load<f32>(sample_ptr(input, frame)) * 0.24 : 0.0) + burst;
      store<f32>(sample_ptr(buffer, bufferIndex), driven + smoothed * load<f32>(sample_ptr(feedback, string)));
      store<f32>(sample_ptr(filter, string), smoothed);
      const signal = delayed * load<f32>(sample_ptr(gain, string));
      left += signal * load<f32>(sample_ptr(panLeft, string));
      right += signal * load<f32>(sample_ptr(panRight, string));
      if ((string & 3) == 3) {
        cursor += 1;
        if (cursor >= stringDelay) cursor = 0;
        store<f32>(sample_ptr(meta, group), <f32>cursor);
      }
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(left * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(right * outputScale));
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
  for (let source = 0; source < sources; source += 1) {
    const offset = <usize>(source << 2);
    const phaseReal = load<f32>(real + offset);
    const phaseImaginary = load<f32>(imaginary + offset);
    const magnitude = Mathf.sqrt(phaseReal * phaseReal + phaseImaginary * phaseImaginary);
    if (magnitude > 0.0001) {
      store<f32>(real + offset, phaseReal / magnitude);
      store<f32>(imaginary + offset, phaseImaginary / magnitude);
    }
  }
  for (let frame = 0; frame < frames; frame += 1) {
    let left: f32 = 0.0;
    let right: f32 = 0.0;
    for (let source = 0; source < sources; source += 1) {
      const offset = <usize>(source << 2);
      const previousReal = load<f32>(real + offset);
      const previousImaginary = load<f32>(imaginary + offset);
      const nextReal = previousReal * load<f32>(cosine + offset) - previousImaginary * load<f32>(sine + offset);
      const nextImaginary = previousReal * load<f32>(sine + offset) + previousImaginary * load<f32>(cosine + offset);
      store<f32>(real + offset, nextReal);
      store<f32>(imaginary + offset, nextImaginary);
      const sample = (nextImaginary + nextReal * nextImaginary * 0.16) * load<f32>(gain + offset);
      left += sample * load<f32>(panLeft + offset);
      right += sample * load<f32>(panRight + offset);
      store<f32>(energy + offset, Mathf.max(load<f32>(energy + offset) * 0.995, Mathf.abs(sample)));
    }
    store<f32>(sample_ptr(outputLeft, frame), soft_clip(left * outputScale));
    store<f32>(sample_ptr(outputRight, frame), soft_clip(right * outputScale));
  }
}

// Authored WebGPU Sound-pass ports for three public srtuss Shadertoy projects.
// Upstream metadata and source lengths come from the pinned JSON mirrors below.

const XD_SGZ1_WGSL = `// srtuss, 2013 — "noir et blanc (sound)" (XdSGz1)
// Original: https://www.shadertoy.com/view/XdSGz1
// Adaptation: authored WGSL compute translation of the original Sound pass.
// GLSL floor-mod is explicit, and reversed-edge smoothstep calls use the
// polynomial implemented by common GLSL drivers instead of relying on undefined edges.

const PI2: f32 = 6.283185307179586476925286766559;
const MAX_FINITE_F32: f32 = 3.402823466e+38;

override WORKGROUP_SIZE: u32 = 256u;
override SAMPLE_RATE: f32 = 44100.0;

struct SynthesisUniforms {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
}

@group(0) @binding(0) var<uniform> synthesis: SynthesisUniforms;
@group(0) @binding(1) var<storage, read_write> sound_output: array<vec2<f32>>;
@group(0) @binding(2) var source_texture: texture_2d<f32>;
@group(0) @binding(3) var source_sampler: sampler;

fn sourceMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

fn sourceSmoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
  let amount = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return amount * amount * (3.0 - 2.0 * amount);
}

fn sourceSmoothstep2(edge0: f32, edge1: f32, x: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    sourceSmoothstep(edge0, edge1, x.x),
    sourceSmoothstep(edge0, edge1, x.y),
  );
}

fn sourceHash(x: f32) -> f32 {
  return fract(sin(11.42 * x) * 298251.5762);
}

fn sourceS(time: f32) -> vec2<f32> {
  var t = time * 8.0;
  var tt = t;

  t = floor(t);
  t *= 5.0;
  t = sourceMod(t, 8.0);
  t += floor(tt / 4.0) * 1.0;
  t = sourceMod(t, 8.0);

  var f = -4.0;
  f += step(1.0, t) * 2.0;
  f += step(2.0, t) * 1.0;
  f += step(3.0, t) * 2.0;
  f += step(4.0, t) * 2.0;
  f += step(5.0, t) * 1.0;
  f += step(6.0, t) * 2.0;
  f += step(7.0, t) * 2.0;

  var ch = floor(tt / 64.0) * 40.0;
  ch = sourceMod(ch, 6.0);
  ch = floor(ch);
  f += ch;

  var fa = 440.0 * pow(2.0, (f + 10.0) / 12.0);
  t = fract(tt);

  let adsr = sourceSmoothstep(1.0, 0.5, t) * sourceSmoothstep(0.0, 0.1, t);
  var v = sin(vec2<f32>(fa, fa * 1.001) * time * PI2) * adsr * vec2<f32>(1.0);

  let adsr2 = sourceSmoothstep(1.0, 0.99, t) * sourceSmoothstep(0.0, 0.005, t);
  v += vec2<f32>(sin(time * PI2 * fa * 0.5) * adsr2 * 0.4);
  v += vec2<f32>(sin(time * PI2 * fa * 4.0) * adsr * 0.1);

  tt = sourceMod(tt, 32.0);
  let ttx = sourceMod(tt - 4.0, 4.0);
  let n = ch + 2.0 - step(6.0, tt) * 8.0 + step(16.0, tt) * 3.0
    + step(22.0, tt) * -7.0;
  tt = sourceMod(tt, 5.0);
  tt = fract(tt / 3.0) * 3.0;
  let bn = n - 12.0 * step(tt, 1.0);
  fa = 440.0 * pow(2.0, bn / 12.0);

  let shape_width = (1.1 + sin(time)) * 0.2;
  let pulse_width = sin(time * 17.0) * 0.4;
  v += (sourceSmoothstep2(
    -shape_width + pulse_width,
    shape_width + pulse_width,
    sin(time * PI2 * vec2<f32>(fa, fa * 1.01) / 4.0),
  ) - vec2<f32>(0.5)) * 2.4;
  v *= sourceSmoothstep(1.0, 0.9, t) * sourceSmoothstep(0.0, 0.01, t);

  v += vec2<f32>(sin(fa * PI2 * time * 2.0) * adsr * 0.4);
  fa = 440.0 * pow(2.0, n / 12.0);
  v += vec2<f32>(sin(fa * PI2 * time * 0.125) * 0.55
    * (1.0 - exp(ttx * ttx * -0.4)));

  return v;
}

fn sourceEcho(t: f32) -> vec2<f32> {
  var amplitude = 0.2;
  var echo_time = 0.1;
  let feedback = 0.6;
  var v = sourceS(t);
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= feedback;
  echo_time += 0.2;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(0.5, 1.0);
  amplitude *= -feedback;
  echo_time += 0.2;
  v = v + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= feedback;
  echo_time += 0.3;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= -feedback;
  echo_time += 0.2;
  v = v + sourceS(t - echo_time) * amplitude * vec2<f32>(0.5, 1.0);
  amplitude *= feedback;
  echo_time += 0.3;
  v = v + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= -feedback;
  echo_time += 0.3;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(0.5, 1.0);
  amplitude *= feedback;
  echo_time += 0.2;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= -feedback;
  echo_time += 0.3;
  v = v + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= feedback;
  echo_time += 0.4;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(0.5, 1.0);
  amplitude *= -feedback;
  echo_time += 0.3;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= feedback;
  echo_time += 0.2;

  return v * 0.3;
}

fn sourceMainSound(samp: i32, time: f32) -> vec2<f32> {
  _ = samp;
  return sourceEcho(time) * 0.4;
}

fn safeSample(value: f32) -> f32 {
  if (value != value || abs(value) > MAX_FINITE_F32) {
    return 0.0;
  }
  return clamp(value, -0.88, 0.88);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let local_sample = global_id.x;
  if (local_sample >= arrayLength(&sound_output)) {
    return;
  }

  let unwrapped_source_position =
      f32(synthesis.sample_offset)
      + synthesis.source_fraction
      + f32(local_sample) * synthesis.time_rate;
  let source_duration = SAMPLE_RATE * 60.0;
  let source_position = unwrapped_source_position
      - source_duration * floor(unwrapped_source_position / source_duration);
  let fade_samples = max(1.0, SAMPLE_RATE * 0.01 * synthesis.time_rate);
  let head_gain = sin(
    clamp((source_position + synthesis.time_rate) / fade_samples, 0.0, 1.0)
    * 1.5707963267948966
  );
  let tail_gain = sin(
    clamp(
      (source_duration - source_position - synthesis.time_rate) / fade_samples,
      0.0,
      1.0
    ) * 1.5707963267948966
  );
  let time = source_position / SAMPLE_RATE;
  let raw = sourceMainSound(i32(floor(source_position)), time) * min(head_gain, tail_gain);

  if ((synthesis.flags & 1u) != 0u) {
    _ = source_texture;
    _ = source_sampler;
  }

  sound_output[local_sample] = vec2<f32>(safeSample(raw.x), safeSample(raw.y));
}`;

const MLJ_SRT_WGSL = `// srtuss, 2015 — "Chiptune (sound)" (MljSRt)
// Original: https://www.shadertoy.com/view/MljSRt
// Adaptation: authored WGSL compute translation of the original Sound pass.
// The two GLSL note-gate macros are expanded below. GLSL floor-mod is explicit,
// and reversed-edge smoothstep calls use the common driver polynomial directly.

const PI2: f32 = 6.283185307179586476925286766559;
const TEMPO: f32 = 1.3;
const MAX_FINITE_F32: f32 = 3.402823466e+38;

override WORKGROUP_SIZE: u32 = 256u;
override SAMPLE_RATE: f32 = 44100.0;

struct SynthesisUniforms {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
}

@group(0) @binding(0) var<uniform> synthesis: SynthesisUniforms;
@group(0) @binding(1) var<storage, read_write> sound_output: array<vec2<f32>>;
@group(0) @binding(2) var source_texture: texture_2d<f32>;
@group(0) @binding(3) var source_sampler: sampler;

fn sourceMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

fn sourceSmoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
  let amount = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return amount * amount * (3.0 - 2.0 * amount);
}

fn sourceN2f(n: f32) -> f32 {
  return 440.0 * pow(2.0, (n - 69.0) / 12.0);
}

fn sourceN2m(n: f32) -> f32 {
  return pow(2.0, n / 12.0);
}

fn sourceSine(phase: f32) -> f32 {
  return sin(phase * PI2);
}

fn sourceShns(x: f32) -> f32 {
  return fract(sin(floor(x * 4000.0)) * 29919.0) - 0.5;
}

fn sourceHpns(x: f32, h: f32) -> f32 {
  return sourceShns(x + h) - sourceShns(x - h);
}

fn sourceAdsr3(x: f32, attack: f32, decay: f32) -> f32 {
  return sourceSmoothstep(0.0, attack, x) * exp(max(x - attack, 0.0) * -decay);
}

fn sourceAdsr4(x: f32, attack: f32, decay: f32, gate: f32) -> f32 {
  return sourceSmoothstep(0.0, attack, x)
    * sourceSmoothstep(attack + decay + gate, attack + gate, x);
}

fn sourcePwm(t: f32, value: f32) -> f32 {
  let softness = 0.001;
  let phase = fract(t);
  return sourceSmoothstep(value, value + softness, phase)
    * sourceSmoothstep(1.0, 1.0 - softness, phase) * 2.0 - 1.0;
}

fn sourceOscc(t: f32, tt: f32, pulse_width: f32) -> f32 {
  let blend = sourceSmoothstep(-1.0, 1.0, cos(tt * 0.1));
  let first_gain = sqrt(1.0 - blend);
  let second_gain = sqrt(blend);
  return sourcePwm(t, pulse_width) * first_gain * 0.5 + sourceSine(t) * second_gain;
}

fn sourceOsc(t: f32, tt: f32) -> vec2<f32> {
  let pulse_width = sin(t * 0.01) * 0.25 + 0.5;
  let first = sourceOscc(t, tt, pulse_width);
  let second = sourceOscc(t * 1.01, tt, pulse_width);
  return vec2<f32>(first + second, first - second);
}

fn sourceGate(t_in: f32) -> f32 {
  let t = sourceMod(t_in, 32.0);
  var value = 0.0;
  value += sourceSmoothstep(-0.05, 0.0, t - 0.0)
    * sourceSmoothstep(0.0, -0.4, t - 0.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 4.0)
    * sourceSmoothstep(0.0, -0.4, t - 4.0 - (1.0 - 0.2));
  value += sourceSmoothstep(-0.05, 0.0, t - 6.0)
    * sourceSmoothstep(0.0, -0.4, t - 6.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 10.0)
    * sourceSmoothstep(0.0, -0.4, t - 10.0 - (1.0 - 0.2));
  value += sourceSmoothstep(-0.05, 0.0, t - 12.0)
    * sourceSmoothstep(0.0, -0.4, t - 12.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 16.0)
    * sourceSmoothstep(0.0, -0.4, t - 16.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 19.0)
    * sourceSmoothstep(0.0, -0.4, t - 19.0 - 1.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 22.0)
    * sourceSmoothstep(0.0, -0.4, t - 22.0 - 1.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 24.0)
    * sourceSmoothstep(0.0, -0.4, t - 24.0 - 1.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 26.0)
    * sourceSmoothstep(0.0, -0.4, t - 26.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 28.0)
    * sourceSmoothstep(0.0, -0.4, t - 28.0 - 1.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 30.0)
    * sourceSmoothstep(0.0, -0.4, t - 30.0 - 1.0);
  return value;
}

fn sourceGate1(t_in: f32) -> f32 {
  let t = sourceMod(t_in, 32.0);
  var value = 0.0;
  value += sourceSmoothstep(-0.05, 0.0, t - 0.0)
    * sourceSmoothstep(0.0, -0.4, t - 0.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 4.0)
    * sourceSmoothstep(0.0, -0.4, t - 4.0 - (1.0 - 0.2));
  value += sourceSmoothstep(-0.05, 0.0, t - 6.0)
    * sourceSmoothstep(0.0, -0.4, t - 6.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 16.0)
    * sourceSmoothstep(0.0, -0.4, t - 16.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 19.0)
    * sourceSmoothstep(0.0, -0.4, t - 19.0 - 1.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 22.0)
    * sourceSmoothstep(0.0, -0.4, t - 22.0 - 1.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 24.0)
    * sourceSmoothstep(0.0, -0.4, t - 24.0 - 1.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 26.0)
    * sourceSmoothstep(0.0, -0.4, t - 26.0 - 2.0);
  value += sourceSmoothstep(-0.05, 0.0, t - 30.0)
    * sourceSmoothstep(0.0, -0.4, t - 30.0 - 1.0);
  return value;
}

fn sourceBlep(t_in: f32, dt: f32) -> f32 {
  var t = t_in;
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1.0;
  } else if (t > 1.0 - dt) {
    t = (t - 1.0) / dt;
    return t * t + t + t + 1.0;
  }
  return 0.0;
}

fn sourceSaw(x_in: f32, frequency: f32) -> f32 {
  let x = fract(x_in * frequency);
  var value = x * 2.0 - 1.0;
  value -= sourceBlep(x, frequency / 44100.0);
  return value;
}

fn sourceSqr(x_in: f32, frequency: f32, pulse_width: f32) -> f32 {
  let x = fract(x_in * frequency);
  var value = select(-1.0, 1.0, x < pulse_width);
  value += sourceBlep(x, frequency / 44100.0);
  value -= sourceBlep(fract(x - pulse_width), frequency / 44100.0);
  return value;
}

fn sourceBeat(time: f32, big: f32) -> f32 {
  var value = 0.0;
  var beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time, 2.0);
  beat_time = sourceMod(beat_time, 5.0 / 4.0);
  beat_time /= TEMPO;
  value += sin(exp(beat_time * -1.0) * 800.0 + exp(beat_time * -100.0) * 200.0)
    * exp(max(0.1 - beat_time, 0.0) * -10.0)
    * exp(beat_time * -10.0) * 0.5 * big;

  beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time - 0.25, 2.0);
  beat_time /= TEMPO;
  value += sin(exp(beat_time * -1.0) * 800.0 + exp(beat_time * -100.0) * 200.0)
    * exp(max(0.1 - beat_time, 0.0) * -10.0)
    * exp(beat_time * -10.0) * 0.5 * big;

  beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time - 1.0, 2.0);
  beat_time /= TEMPO;
  value += (sin(exp(beat_time * -2.0) * 300.0) + sourceHpns(beat_time, 0.0003) * 0.1)
    * exp(max(0.1 - beat_time, 0.0) * -10.0)
    * exp(beat_time * -5.0) * big;

  beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time, 2.0);
  beat_time = sourceMod(beat_time, 2.5 / 4.0);
  beat_time = sourceMod(beat_time - 1.0, 0.25);
  beat_time /= TEMPO;
  value += sourceHpns(beat_time, 0.0002) * exp(beat_time * -20.0) * 0.3;

  beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time, 0.5);
  beat_time /= TEMPO;
  value += sourceHpns(beat_time, 0.00002) * exp(beat_time * -5.0) * 0.3;

  return value;
}

fn sourceBeat2(time: f32, big: f32) -> f32 {
  var beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time, 2.0);
  beat_time = sourceMod(beat_time, 5.0 / 4.0);
  beat_time /= TEMPO;
  var kick = sin(exp(beat_time * -1.0) * 400.0 + exp(beat_time * -100.0) * 200.0)
    * exp(max(0.1 - beat_time, 0.0) * -10.0) * exp(beat_time * -10.0);
  kick = sourceSmoothstep(-0.2, 0.2, kick) * 2.0 - 1.0;
  var value = kick * 0.3;

  beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time - 0.5, 1.0);
  beat_time /= TEMPO;
  value += (sourceHpns(exp(-beat_time) * 4.0, 0.0002)
    * exp(max(beat_time - 0.1, 0.0) * -10.0) * 0.5
    + sin(sin(beat_time * 100.0) * 5.0 + beat_time * 2000.0)
    * exp(max(beat_time - 0.1, 0.0) * -10.0) * 0.4) * 0.6;

  beat_time = time * TEMPO + 0.25;
  beat_time = sourceMod(beat_time, 2.0);
  beat_time = sourceMod(beat_time, 2.5 / 4.0);
  beat_time = sourceMod(beat_time - 1.0, 0.25);
  beat_time /= TEMPO;
  value += sourceHpns(beat_time * 4.0, 0.0002) * exp(beat_time * -25.0) * 0.25;

  beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time, 0.5);
  beat_time /= TEMPO;
  value += (sourceHpns(beat_time * 2.0, 0.00002)
    + sourceHpns(beat_time * 100.0, 0.002) * 0.3)
    * exp(beat_time * -4.0) * 0.2;

  beat_time = time * TEMPO;
  beat_time = sourceMod(beat_time - 0.25, 0.5);
  beat_time /= TEMPO;
  value += sourceHpns(beat_time * 9.0, 0.0002) * exp(beat_time * -8.0) * 0.3;

  return value;
}

fn sourceS(time: f32) -> vec2<f32> {
  let scaled_time = time * TEMPO;
  let beat = floor(sourceMod(scaled_time, 32.0) * 0.5)
    - 3.0 * step(15.0, sourceMod(scaled_time, 16.0));
  let random_note = fract(sin(beat * 11.0) * 29082.523);

  let oscillator_time = scaled_time * sourceN2m(floor(random_note * 12.0) - 6.0) / TEMPO;
  var value = sourceOsc(oscillator_time * sourceN2f(29.0), scaled_time);
  value += sourceOsc(oscillator_time * sourceN2f(53.0), scaled_time);
  value += sourceOsc(oscillator_time * sourceN2f(56.0), scaled_time);
  value += sourceOsc(oscillator_time * sourceN2f(60.0), scaled_time);
  value += sourceOsc(oscillator_time * sourceN2f(65.0), scaled_time);
  value += sourceOsc(oscillator_time * sourceN2f(68.0), scaled_time);
  value += sourceOsc(oscillator_time * sourceN2f(72.0), scaled_time);
  value += sourceOsc(oscillator_time * sourceN2f(75.0), scaled_time);
  value += sourceOsc(oscillator_time * sourceN2f(87.0), scaled_time);

  value *= mix(
    1.0,
    sourceGate(scaled_time * 8.0),
    sourceSmoothstep(-1.0, 1.0, cos(scaled_time * 0.1)),
  );
  return value;
}

fn sourceMad(input_value: vec2<f32>, candidate: f32) -> vec2<f32> {
  var value = input_value;
  let magnitude = abs(candidate);
  if (magnitude < value.x) {
    value.y = candidate;
    value.x = magnitude;
  }
  return value;
}

fn sourceLock(y: f32) -> f32 {
  var nearest = vec2<f32>(1e38, 0.0);
  let x = sourceMod(y, 12.0);
  nearest = sourceMad(nearest, x - 0.0);
  nearest = sourceMad(nearest, x - 2.0);
  nearest = sourceMad(nearest, x - 4.0);
  nearest = sourceMad(nearest, x - 5.0);
  nearest = sourceMad(nearest, x - 7.0);
  nearest = sourceMad(nearest, x - 9.0);
  nearest = sourceMad(nearest, x - 10.0);
  nearest = sourceMad(nearest, x - 12.0);
  return y - nearest.y;
}

fn sourceS2(time: f32) -> vec2<f32> {
  let pulse_width = sin(time * 0.3) * 0.25 + 0.4;
  let first_pattern = step(0.5, fract(time * TEMPO / 4.0));
  let second_pattern = max(
    step(0.5, fract(time * TEMPO / 4.0)),
    step(fract(time * TEMPO / 16.0), 0.5),
  );
  let first_section = step(0.5, fract(time * TEMPO / 32.0));
  let second_section = 1.0;

  var value = vec2<f32>(0.0);
  var sequence_source = floor(time * TEMPO * 4.0);
  var note = sourceLock(floor(fract(sequence_source * sequence_source * 1.79425579) * 20.0));
  note -= 12.0;
  var scalar_voice = sourceSqr(time, 440.0 * pow(2.0, note / 12.0), pulse_width)
    * sourceGate(time * TEMPO * (8.0 + first_pattern * 8.0)) * 1.0 * first_section;
  value = vec2<f32>(scalar_voice) * vec2<f32>(1.0, 0.5);

  note = sourceLock(floor(fract(sequence_source * sequence_source * 1.79425579) * 10.0));
  scalar_voice = sourceSqr(time, 440.0 * pow(2.0, note / 12.0), pulse_width)
    * sourceGate(time * TEMPO * (8.0 + second_pattern * 8.0)) * 1.0 * first_section;
  value += vec2<f32>(scalar_voice) * vec2<f32>(0.5, 1.0);

  sequence_source = floor(time * TEMPO * 1.0);
  note = sourceLock(floor(fract(sequence_source * sequence_source * 1.79425579) * 4.0));
  let bass_note = note;
  note -= 36.0;
  let bass_frequency = 440.0 * pow(2.0, note / 12.0);
  value += vec2<f32>(sourceSqr(time, bass_frequency, 0.4)
    * sourceGate(time * TEMPO * 8.0) * 1.5 * second_section);
  value += vec2<f32>(sourceSine(time * bass_frequency * 1.0)
    * sourceGate(time * TEMPO * 8.0) * 2.0 * second_section);

  sequence_source = floor(time * TEMPO * 4.0);
  note = sourceLock(floor(fract(sequence_source * sequence_source * 1.79425579) * 10.0));
  note += step(0.5, fract(time * TEMPO * 16.0)) * 7.0;
  value += vec2<f32>(sourceSaw(time, 440.0 * pow(2.0, note / 12.0))
    * 1.0 * sourceGate1(sourceMod(time * TEMPO, 3.0) * 8.0)
    * 1.5 * (1.0 - first_section));

  note = abs((sourceMod(time * TEMPO * 32.0, 16.0) - 8.0) * 1.0);
  note = sourceLock(note) + bass_note
    + floor(abs((sourceMod(time * TEMPO * 0.5, 2.0) - 1.0) * 3.0)) * 12.0 - 12.0;
  value += sourceSaw(time, 440.0 * pow(2.0, note / 12.0)) * vec2<f32>(0.5, 1.0);

  let beat_time = sourceMod(time * TEMPO, 8.0);
  value += vec2<f32>(sourceHpns(exp(beat_time * -1.0), 0.0002)
    * exp(beat_time * -0.4));

  return value * vec2<f32>(0.2);
}

fn sourceMainSound(samp: i32, time: f32) -> vec2<f32> {
  _ = samp;
  var value = vec2<f32>(0.0);
  var amplitude = 1.0;
  var swap_mix = 0.0;
  var time_offset = 0.0;
  for (var i = 0; i < 8; i += 1) {
    let source = sourceS2(time - time_offset);
    value += mix(source, source.yx, vec2<f32>(swap_mix)) * amplitude
      * mix(vec2<f32>(1.0, 0.4), vec2<f32>(0.4, 1.0), vec2<f32>(swap_mix));
    swap_mix = 1.0 - swap_mix;
    amplitude *= 0.3;
    time_offset += 0.33;
  }

  value *= vec2<f32>(1.0);
  let big = 1.0;
  value += vec2<f32>(sourceBeat2(time, big) * 0.8);
  value += sourceBeat2(time - TEMPO / 6.0, big) * vec2<f32>(0.3, 0.2);

  let delay_level = time * 1.0;
  value *= min(delay_level * delay_level, 1.0);
  return value * 0.8;
}

fn safeSample(value: f32) -> f32 {
  if (value != value || abs(value) > MAX_FINITE_F32) {
    return 0.0;
  }
  return clamp(value, -0.88, 0.88);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let local_sample = global_id.x;
  if (local_sample >= arrayLength(&sound_output)) {
    return;
  }

  let unwrapped_source_position =
      f32(synthesis.sample_offset)
      + synthesis.source_fraction
      + f32(local_sample) * synthesis.time_rate;
  let source_duration = SAMPLE_RATE * 60.0;
  let source_position = unwrapped_source_position
      - source_duration * floor(unwrapped_source_position / source_duration);
  let fade_samples = max(1.0, SAMPLE_RATE * 0.01 * synthesis.time_rate);
  let head_gain = sin(
    clamp((source_position + synthesis.time_rate) / fade_samples, 0.0, 1.0)
    * 1.5707963267948966
  );
  let tail_gain = sin(
    clamp(
      (source_duration - source_position - synthesis.time_rate) / fade_samples,
      0.0,
      1.0
    ) * 1.5707963267948966
  );
  let time = source_position / SAMPLE_RATE;
  let raw = sourceMainSound(i32(floor(source_position)), time) * min(head_gain, tail_gain);

  if ((synthesis.flags & 1u) != 0u) {
    _ = source_texture;
    _ = source_sampler;
  }

  sound_output[local_sample] = vec2<f32>(safeSample(raw.x), safeSample(raw.y));
}`;

const XD_2GW3_WGSL = `// srtuss, 2014 — "Industry II (sound)" (Xd2GW3)
// Original: https://www.shadertoy.com/view/Xd2GW3
// Adaptation: authored WGSL compute translation of the original Sound pass.
// GLSL floor-mod is explicit. The source's unusual clamp(-1, 1, signal)
// argument order is retained through sourceClamp rather than silently corrected.

const PI2: f32 = 6.283185307179586476925286766559;
const MAX_FINITE_F32: f32 = 3.402823466e+38;

override WORKGROUP_SIZE: u32 = 256u;
override SAMPLE_RATE: f32 = 44100.0;

struct SynthesisUniforms {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
}

@group(0) @binding(0) var<uniform> synthesis: SynthesisUniforms;
@group(0) @binding(1) var<storage, read_write> sound_output: array<vec2<f32>>;
@group(0) @binding(2) var source_texture: texture_2d<f32>;
@group(0) @binding(3) var source_sampler: sampler;

fn sourceMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

fn sourceClamp(x: f32, lower: f32, upper: f32) -> f32 {
  return min(max(x, lower), upper);
}

fn sourceHash(x: f32) -> f32 {
  return (fract(cos(x * 115.5782) * 1000.0 + sin(x * 0.5782) * 333.333) - 0.5) * 1.0;
}

fn sourceNse(t: f32) -> f32 {
  let whole = floor(t);
  return mix(sourceHash(whole), sourceHash(whole + 1.0), smoothstep(0.0, 1.0, fract(t)));
}

fn sourceQuan(x: f32, value: f32) -> f32 {
  return floor(x * value) / value;
}

fn sourceEngine1(t: f32) -> f32 {
  return sourceNse(fract(t * 40.0) * 60.0);
}

fn sourceF1(t: f32, start: f32, length: f32, rate: f32) -> f32 {
  let onset = sourceClamp(t - start, 0.0, length);
  let after = max(t - (start + length), 0.0);
  return onset * onset * rate / (2.0 * length) + after * rate;
}

fn sourcePhase(t: f32) -> f32 {
  var start = 0.0;
  var frequency = 4.0;
  var next_frequency = 10.6;

  var phase_result = frequency * t;
  phase_result += sourceF1(t, start, 0.4, next_frequency - frequency);
  frequency = next_frequency;
  start += 2.0;
  next_frequency = 13.0;
  phase_result += sourceF1(t, start, 0.05, next_frequency - frequency);
  frequency = next_frequency;
  start += 0.05;
  next_frequency = 0.001;
  phase_result += sourceF1(t, start, 0.8, next_frequency - frequency);
  frequency = next_frequency;
  start += 0.3;

  return phase_result;
}

fn sourceWf2(x: f32) -> f32 {
  return sourceNse(fract((sin(x * 300.0) * 0.001 + x) * 100.0) * 26.0);
}

fn sourceS(t: f32) -> f32 {
  var h = 0.7;
  var tt = sourceMod(t, 4.0);
  var v = sourceNse(tt * 40000.0 - h) - sourceNse(tt * 40000.0 + h);
  v = v * 0.5 * exp(-10.0 * max(tt - 2.0, 0.0))
    * exp(-40.0 * max(1.0 - tt, 0.0));

  h = 0.005;
  v += ((sourceEngine1(t - h) + sourceEngine1(t + h)) * 0.4
    + sin(t * 40.0 * PI2) * 0.2)
    * smoothstep(-0.1, 0.1, sin(t * 10.0)) * 0.5;

  h = 0.1;
  v += (sourceNse(t * 1000.0 - h) + sourceNse(t * 1000.0 + h)) * sin(t * 20.0);

  tt = sourceMod(t, 7.0);
  v += sourceWf2(sourcePhase(tt) * 1.0)
    * exp(-1.0 * max(tt - 2.0, 0.0))
    * exp(-1.0 * max(1.0 - tt, 0.0)) * 0.5;

  tt = sourceMod(t + 0.1, 1.25);
  let phase_value = (pow(tt, 0.5) + t) * 1.1;
  let thump = (sourceNse(phase_value * 200.0) + sin(phase_value * 200.0) * 0.5)
    * exp(max(0.04 - tt, 0.0) * -100.0)
    * exp(max(tt, 0.0) * -4.0) * 8.0;
  v += sourceClamp(-1.0, 1.0, thump) * 0.8;

  return v;
}

fn sourceEcho(t: f32) -> vec2<f32> {
  var amplitude = 0.5;
  var echo_time = 0.1;
  let feedback = 0.6;
  var v = vec2<f32>(sourceS(t));
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= feedback;
  echo_time += 0.2;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(0.5, 1.0);
  amplitude *= -feedback;
  echo_time += 0.2;
  v = v + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= feedback;
  echo_time += 0.3;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= -feedback;
  echo_time += 0.2;
  v = v + sourceS(t - echo_time) * amplitude * vec2<f32>(0.5, 1.0);
  amplitude *= feedback;
  echo_time += 0.3;
  v = v + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= -feedback;
  echo_time += 0.3;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(0.5, 1.0);
  amplitude *= feedback;
  echo_time += 0.2;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= -feedback;
  echo_time += 0.3;
  v = v + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= feedback;
  echo_time += 0.4;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(0.5, 1.0);
  amplitude *= -feedback;
  echo_time += 0.3;
  v = v.yx + sourceS(t - echo_time) * amplitude * vec2<f32>(1.0, 0.5);
  amplitude *= feedback;
  echo_time += 0.2;

  return v;
}

fn sourceMainSound(samp: i32, time: f32) -> vec2<f32> {
  _ = samp;
  return sourceEcho(time) * 0.35;
}

fn safeSample(value: f32) -> f32 {
  if (value != value || abs(value) > MAX_FINITE_F32) {
    return 0.0;
  }
  return clamp(value, -0.88, 0.88);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let local_sample = global_id.x;
  if (local_sample >= arrayLength(&sound_output)) {
    return;
  }

  let unwrapped_source_position =
      f32(synthesis.sample_offset)
      + synthesis.source_fraction
      + f32(local_sample) * synthesis.time_rate;
  let source_duration = SAMPLE_RATE * 60.0;
  let source_position = unwrapped_source_position
      - source_duration * floor(unwrapped_source_position / source_duration);
  let fade_samples = max(1.0, SAMPLE_RATE * 0.01 * synthesis.time_rate);
  let head_gain = sin(
    clamp((source_position + synthesis.time_rate) / fade_samples, 0.0, 1.0)
    * 1.5707963267948966
  );
  let tail_gain = sin(
    clamp(
      (source_duration - source_position - synthesis.time_rate) / fade_samples,
      0.0,
      1.0
    ) * 1.5707963267948966
  );
  let time = source_position / SAMPLE_RATE;
  let raw = sourceMainSound(i32(floor(source_position)), time) * min(head_gain, tail_gain);

  if ((synthesis.flags & 1u) != 0u) {
    _ = source_texture;
    _ = source_sampler;
  }

  sound_output[local_sample] = vec2<f32>(safeSample(raw.x), safeSample(raw.y));
}`;

export const SRTUSS_SHADER_PORTS_A = Object.freeze([
  Object.freeze({
    id: "MljSRt",
    title: "Chiptune (sound)",
    sourceUrl: "https://www.shadertoy.com/view/MljSRt",
    sourceMirrorUrl: "https://github.com/GabeRundlett/shadertoy-api-shaders/blob/f6d538adf936215ccf2d11ba9b4a6c79ccb448c5/shaders/MljSRt.json",
    sourceDate: "2015-10-27",
    license: "CC BY-NC-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/3.0/",
    usesTexture0: false,
    sourceCodeLength: 8731,
    sourceSha256: "756e533c2a4b7e78b445b3b2dba38b9640f73927d57f4f3a5173cc581d751b93",
    wgsl: MLJ_SRT_WGSL,
  }),
  Object.freeze({
    id: "XdSGz1",
    title: "noir et blanc (sound)",
    sourceUrl: "https://www.shadertoy.com/view/XdSGz1",
    sourceMirrorUrl: "https://github.com/GabeRundlett/shadertoy-api-shaders/blob/f6d538adf936215ccf2d11ba9b4a6c79ccb448c5/shaders/XdSGz1.json",
    sourceDate: "2013-11-01",
    license: "CC BY-NC-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/3.0/",
    usesTexture0: false,
    sourceCodeLength: 3079,
    sourceSha256: "21089af3cae2f7db53f5f14bbbc74c16f8922cc4b65f406821c7f10809586ba3",
    wgsl: XD_SGZ1_WGSL,
  }),
  Object.freeze({
    id: "Xd2GW3",
    title: "Industry II (sound)",
    sourceUrl: "https://www.shadertoy.com/view/Xd2GW3",
    sourceMirrorUrl: "https://github.com/GabeRundlett/shadertoy-api-shaders/blob/f6d538adf936215ccf2d11ba9b4a6c79ccb448c5/shaders/Xd2GW3.json",
    sourceDate: "2014-03-08",
    license: "CC BY-NC-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/3.0/",
    usesTexture0: false,
    sourceCodeLength: 3102,
    sourceSha256: "c0a24cb94da59e08b36e25e433713a113b7938c7a6d7f82b5a41b39d3bb86e11",
    wgsl: XD_2GW3_WGSL,
  }),
]);

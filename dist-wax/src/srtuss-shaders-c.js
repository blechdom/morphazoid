/*
 * Faithful WebGPU compute adaptations of three public Sound passes associated
 * with srtuss. Only Sound-pass GLSL is translated; visual passes are excluded.
 *
 * Shadertoy publications use CC BY-NC-SA 3.0. Keep author attribution,
 * canonical links, and this same license on adaptations.
 */

const LICENSE = "CC BY-NC-SA 3.0";
const LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/3.0/";

const WGSL_PREAMBLE = String.raw`
// Adapted from an original GLSL Sound pass. The source math and evaluation
// order are retained; GLSL mod is implemented explicitly as floor-mod.
override WORKGROUP_SIZE: u32 = 256u;
override SAMPLE_RATE: f32 = 44100.0;

struct RenderInfo {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
}

@group(0) @binding(0) var<uniform> render_info: RenderInfo;
@group(0) @binding(1) var<storage, read_write> sound_chunk: array<vec2<f32>>;
@group(0) @binding(2) var texture_0: texture_2d<f32>;
@group(0) @binding(3) var texture_0_sampler: sampler;

fn floorMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

// The source uses reversed smoothstep edges in several envelopes. GLSL leaves
// that case undefined, but Shadertoy implementations conventionally evaluate
// the polynomial below, so the adaptation makes that observed intent explicit.
fn sourceSmoothstep(edge_0: f32, edge_1: f32, x: f32) -> f32 {
  let t = clamp((x - edge_0) / (edge_1 - edge_0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn sourceStep(edge: f32, x: f32) -> f32 {
  return select(0.0, 1.0, x >= edge);
}

fn finiteOrZero(value: f32) -> f32 {
  if (value != value || abs(value) > 3.402823e38) {
    return 0.0;
  }
  return value;
}

fn sanitizeOutput(value: vec2<f32>) -> vec2<f32> {
  let finite = vec2<f32>(finiteOrZero(value.x), finiteOrZero(value.y));
  return clamp(finite, vec2<f32>(-0.88), vec2<f32>(0.88));
}
`;

const WGSL_TEXTURE_ENTRY = String.raw`
@compute @workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let local_sample = global_id.x;
  if (local_sample >= arrayLength(&sound_chunk)) {
    return;
  }

  let unwrapped_source_position =
      f32(render_info.sample_offset)
      + render_info.source_fraction
      + f32(local_sample) * render_info.time_rate;
  let source_duration = SAMPLE_RATE * 60.0;
  let source_position = unwrapped_source_position
      - source_duration * floor(unwrapped_source_position / source_duration);
  let fade_samples = max(1.0, SAMPLE_RATE * 0.01 * render_info.time_rate);
  let head_gain = sin(
    clamp((source_position + render_info.time_rate) / fade_samples, 0.0, 1.0)
    * 1.5707963267948966
  );
  let tail_gain = sin(
    clamp(
      (source_duration - source_position - render_info.time_rate) / fade_samples,
      0.0,
      1.0
    ) * 1.5707963267948966
  );
  let loop_gain = min(head_gain, tail_gain);
  let time = source_position / SAMPLE_RATE;
  sound_chunk[local_sample] =
      sanitizeOutput(sourceMainSound(i32(floor(source_position)), time) * loop_gain);
}
`;

const WGSL_KEEPALIVE_ENTRY = String.raw`
// Bindings 2 and 3 are part of the common pipeline layout. Source shaders that
// do not use a texture keep them observable behind reserved flag bit 31.
// Normal rendering must leave that bit clear.
fn keepTextureBindingsLive() -> vec2<f32> {
  if ((render_info.flags & 0x80000000u) != 0u) {
    return textureSampleLevel(
      texture_0,
      texture_0_sampler,
      vec2<f32>(0.0),
      0.0
    ).xy;
  }
  return vec2<f32>(0.0);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn synthesize(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let local_sample = global_id.x;
  if (local_sample >= arrayLength(&sound_chunk)) {
    return;
  }

  let unwrapped_source_position =
      f32(render_info.sample_offset)
      + render_info.source_fraction
      + f32(local_sample) * render_info.time_rate;
  let source_duration = SAMPLE_RATE * 60.0;
  let source_position = unwrapped_source_position
      - source_duration * floor(unwrapped_source_position / source_duration);
  let fade_samples = max(1.0, SAMPLE_RATE * 0.01 * render_info.time_rate);
  let head_gain = sin(
    clamp((source_position + render_info.time_rate) / fade_samples, 0.0, 1.0)
    * 1.5707963267948966
  );
  let tail_gain = sin(
    clamp(
      (source_duration - source_position - render_info.time_rate) / fade_samples,
      0.0,
      1.0
    ) * 1.5707963267948966
  );
  let loop_gain = min(head_gain, tail_gain);
  let time = source_position / SAMPLE_RATE;
  let source_sample =
      sourceMainSound(i32(floor(source_position)), time) * loop_gain
      + keepTextureBindingsLive();
  sound_chunk[local_sample] = sanitizeOutput(source_sample);
}
`;

const GRAVITY_SHIELDING_BODY = String.raw`
fn sourceS(t: f32) -> f32 {
  var v = 0.0;
  for (var i: i32 = 0; i < 32; i = i + 1) {
    let h = f32(i + 6);
    v = v + sin(t * h) / h;
  }
  return v;
}

fn sourceS2(source_t: f32) -> vec2<f32> {
  var t = source_t;
  var v = vec2<f32>(0.0);
  var rnd = vec4<f32>(1.0, 2.0, 3.0, 4.0);
  for (var i: i32 = 0; i < 16; i = i + 1) {
    t = t + rnd.z;
    rnd = fract(sin(rnd * 11.3123) * 908745.123);
    let tone = sourceS(
      (t + sin(t * (6.0 + rnd.y * 1.111)) * 0.01) *
      exp2(rnd.y * 0.1 + 8.0)
    );
    v = v + vec2<f32>(tone) * vec2<f32>(rnd.x, 1.0 - rnd.x);
  }
  let wob = sin(t * 40.0) * 0.2 + 0.5;
  return mix(
    v * 0.3,
    vec2<f32>(sin(t * 400.0)),
    vec2<f32>(wob)
  );
}

fn sourceHash(x: f32) -> f32 {
  return fract(sin(x * 237.234234) * 982734.1235);
}

fn sourceNoise(source_x: f32) -> f32 {
  var x = source_x;
  let fl = floor(x);
  x = sourceSmoothstep(0.0, 1.0, fract(x));
  return mix(sourceHash(fl), sourceHash(fl + 1.0), x) - 0.5;
}

fn sourceFbm(x: f32) -> f32 {
  return sourceNoise(x) +
      sourceNoise(x * -2.0) * 0.5 +
      sourceNoise(x * 4.1) * 0.25;
}

fn sourceMetal(
  source_time: f32,
  seed: f32,
  frequency_multiplier: f32,
  lowpass: f32
) -> vec2<f32> {
  var time = source_time;
  var v = vec2<f32>(0.0);
  for (var i: i32 = 0; i < 30; i = i + 1) {
    var frequency =
        100.0 + pow(sourceHash(f32(i) + seed), 3.0) * 15000.0;
    frequency = frequency * frequency_multiplier;
    // Source metadata specifies repeat wrapping and mipmap filtering. Explicit
    // LOD 0 is required because compute shaders have no implicit derivatives.
    let data = textureSampleLevel(
      texture_0,
      texture_0_sampler,
      vec2<f32>(f32(i) / 100.0, time * 0.1),
      0.0
    );
    let amplitude = data.x * exp(-frequency * lowpass);
    let modulation = vec2<f32>(
      sourceNoise(time * 0.09 * frequency),
      sourceNoise(time * 0.091 * frequency)
    ) * 0.8 + vec2<f32>(0.2);
    v = v + vec2<f32>(sin(time * frequency * 6.0) * amplitude) *
        modulation;
    time = time - 3.3333;
  }
  v = v * 0.5;
  return v;
}

fn sourceSparks(source_t: f32) -> vec2<f32> {
  var t = source_t;
  var v = vec2<f32>(0.0);
  let frequency = 80.0;
  let first = exp(
    fract(t * frequency + sourceHash(floor(t * frequency)) * 0.1) * -100.0
  );
  v = v + vec2<f32>(first) * vec2<f32>(0.2, 0.8);
  t = t - 0.1;
  let second = exp(
    fract(t * frequency + sourceHash(floor(t * frequency)) * 0.1) * -100.0
  );
  v = v + vec2<f32>(second) * vec2<f32>(0.8, 0.2);
  return v * fract(t + sin(t) * 0.3);
}

fn sourceF1(t: f32, start: f32, length: f32, slope: f32) -> f32 {
  let offset_1 = clamp(t - start, 0.0, length);
  let offset_2 = max(t - (start + length), 0.0);
  return offset_1 * offset_1 * slope / (2.0 * length) +
      offset_2 * slope;
}

fn sourcePhase(t: f32) -> f32 {
  var phase: f32;
  var time_base = 0.0;
  let _time_delta = 1.0;
  var frequency_low = 4.0;
  var frequency_next = 10.6;

  phase = frequency_low * t;
  phase = phase + sourceF1(
    t,
    time_base,
    0.4,
    frequency_next - frequency_low
  );
  frequency_low = frequency_next;
  time_base = time_base + 2.0;
  frequency_next = 13.0;
  phase = phase + sourceF1(
    t,
    time_base,
    0.05,
    frequency_next - frequency_low
  );
  frequency_low = frequency_next;
  time_base = time_base + 0.05;
  frequency_next = 0.001;
  phase = phase + sourceF1(
    t,
    time_base,
    0.8,
    frequency_next - frequency_low
  );
  frequency_low = frequency_next;
  time_base = time_base + 0.3;

  return phase;
}

fn sourcePhase2(t: f32) -> f32 {
  var phase: f32;
  var time_base = 0.0;
  let _time_delta = 1.0;
  var frequency_low = 0.5;
  let frequency_next = 1.2;

  phase = frequency_low * t;
  phase = phase + sourceF1(
    t,
    time_base,
    8.0,
    frequency_next - frequency_low
  );
  frequency_low = frequency_next;
  time_base = time_base + 8.0;

  return phase;
}

fn sourceWaveform2(x: f32) -> f32 {
  return sourceNoise(
    fract((sin(x * 300.0) * 0.001 + x) * 100.0) * 26.0
  ) + sin(x * 100.0);
}

fn sourceSoundEffect(time: f32) -> vec2<f32> {
  var v = vec2<f32>(0.0);
  if (time > 1.0) {
    v = v + vec2<f32>(sourceHash(time)) * 0.1 *
        (exp(max(time - 1.0, 0.0) * -8.0) + 0.5) *
        exp(max(time - 2.0, 0.0) * -2.0);
  }

  let shifted_time = max(time - 1.1, 0.0) * 0.6;
  let effect = sourceWaveform2(sourcePhase(shifted_time)) *
      exp(-max(shifted_time - 2.0, 0.0)) *
      exp(-max(1.0 - shifted_time, 0.0)) *
      0.1;
  v = v + vec2<f32>(effect);
  return v;
}

fn sourceEcho(t: f32) -> vec2<f32> {
  var v = vec2<f32>(sourceS(t));
  var amplitude = 0.5;
  var echo_time = 0.0;
  let feedback = 0.6;

  v = v.yx + sourceSoundEffect(t - echo_time) * amplitude *
      vec2<f32>(1.0, 0.5);
  amplitude = amplitude * feedback;
  echo_time = echo_time + 0.2;
  v = v.yx + sourceSoundEffect(t - echo_time) * amplitude *
      vec2<f32>(0.5, 1.0);
  amplitude = amplitude * -feedback;
  echo_time = echo_time + 0.2;
  v = v + sourceSoundEffect(t - echo_time) * amplitude *
      vec2<f32>(1.0, 0.5);
  amplitude = amplitude * feedback;
  echo_time = echo_time + 0.3;
  v = v.yx + sourceSoundEffect(t - echo_time) * amplitude *
      vec2<f32>(1.0, 0.5);
  return v;
}

fn sourceMainSound(samp: i32, source_time: f32) -> vec2<f32> {
  let _samp = samp;
  let original_time = source_time;
  var time = sourcePhase2(source_time);
  var v = sourceSparks(time) * 0.05;
  time = time * 2.0;
  v = v + (
    sourceS2(time) * 0.5 * 0.9 +
    sourceMetal(time, 1.0, 0.1, 0.0) * 0.2
  ) * 0.5;

  var thunder = vec2<f32>(0.0);
  var thunder_time = floorMod(time, 6.2);
  let thunder_envelope =
      exp(thunder_time * -1.0) * min(thunder_time * 40.0, 1.0);
  thunder = vec2<f32>(sourceFbm(time * 30.0) * thunder_envelope);
  time = time - 1.0;
  thunder_time = floorMod(time, 6.2);
  thunder = thunder + vec2<f32>(0.3) * sourceFbm(time * 30.0) *
      exp(thunder_time * -1.0) * min(thunder_time * 40.0, 1.0);
  time = time - 1.0;
  thunder_time = floorMod(time, 6.2);
  thunder = thunder + vec2<f32>(0.1) * sourceFbm(time * 30.0) *
      exp(thunder_time * -1.0) * min(thunder_time * 40.0, 1.0);

  time = original_time;
  v = v + sourceSoundEffect(original_time) * 0.4;
  return mix(
    v,
    thunder * 2.0,
    vec2<f32>(sqrt(thunder_envelope) * 0.5)
  ) * 1.3;
}
`;

const gravityShieldingWgsl =
    WGSL_PREAMBLE + GRAVITY_SHIELDING_BODY + WGSL_TEXTURE_ENTRY;

const DNB_BODY = String.raw`
const SOURCE_TEMPO: f32 = 2.2;

fn sourceHash(x: f32) -> f32 {
  return fract(sin(x * 237.234234) * 982734.1235);
}

fn sourceNoise(source_x: f32) -> f32 {
  var x = source_x;
  let fl = floor(x);
  x = fract(x);
  x = sourceSmoothstep(0.0, 1.0, x);
  return mix(sourceHash(fl), sourceHash(fl + 1.0), x) - 0.5;
}

fn sourceFbm(x: f32) -> f32 {
  return sourceNoise(x) +
      sourceNoise(x * -2.0) * 0.5 +
      sourceNoise(x * 4.1) * 0.25;
}

fn sourceMetal(
  source_time: f32,
  seed: f32,
  frequency_multiplier: f32,
  lowpass: f32,
  decay: f32
) -> vec2<f32> {
  var time = source_time;
  var v = vec2<f32>(0.0);
  var base_time = time;

  // The GLSL macro N is expanded literally to 100.
  for (var i: i32 = 0; i < 100; i = i + 1) {
    let x = f32(i) / 100.0;
    var frequency =
        300.0 * exp2(sourceHash(f32(i) + seed) * 6.195);
    frequency = frequency * frequency_multiplier;
    // Source metadata specifies repeat wrapping and mipmap filtering. Explicit
    // LOD 0 is required because compute shaders have no implicit derivatives.
    let data = textureSampleLevel(
      texture_0,
      texture_0_sampler,
      vec2<f32>(x, base_time * 0.5),
      0.0
    );
    var amplitude = data.x * exp(-frequency * lowpass);
    amplitude = amplitude * exp(
      -time * decay * (1.0 - exp(-frequency * 100.0))
    );
    var modulation = vec2<f32>(
      sourceNoise(base_time * 0.09 * frequency),
      sourceNoise(base_time * 0.091 * frequency)
    );
    modulation = mix(
      modulation,
      vec2<f32>(1.0),
      vec2<f32>(0.7 * sourceHash(f32(i)))
    );
    v = v + vec2<f32>(sin(base_time * frequency * 6.0) * amplitude) *
        modulation;
    base_time = base_time - 3.3333;
  }
  v = v * 0.1;
  return v;
}

fn sourcePad(source_t: f32) -> f32 {
  var t = source_t * 100.0;
  var v = 0.0;
  for (var i: i32 = 0; i < 10; i = i + 1) {
    let harmonic = f32(i + 1);
    v = v + sin(t * harmonic * 6.0) / harmonic;
  }
  return v;
}

fn sourceEcho(source_time: f32) -> f32 {
  var time = source_time;
  time = time * exp2(
    floor(5.0 * sourceHash(floor(time * SOURCE_TEMPO / 4.0))) / 12.0
  );
  time = time * exp2(
    floor(5.0 * sourceHash(floor(time * SOURCE_TEMPO)))
  );
  let v = sourcePad(time) +
      sourcePad(time * exp2(11.0 / 12.0)) +
      sourcePad(time * exp2(14.0 / 12.0)) +
      sourcePad(time * exp2(16.0 / 12.0));
  return v * min(1.0, fract(time * SOURCE_TEMPO) * 2.0) * 0.2;
}

fn sourceMainSound(samp: i32, time: f32) -> vec2<f32> {
  let _samp = samp;
  var t = floorMod(time * SOURCE_TEMPO, 4.0);
  t = floorMod(t, 2.5);
  t = t / (SOURCE_TEMPO * 0.9);
  let kick_noise =
      sourceNoise(120.0 * sqrt(t)) *
      min(exp(t * -10.0) * 2.0, 1.0) *
      min(1.0, t * 5000.0);
  var v = vec2<f32>(kick_noise) * 0.5;

  t = floorMod(time * SOURCE_TEMPO, 1.0) / SOURCE_TEMPO;
  v = v + sourceMetal(t, 35.0, 2.0, 0.0, 2.0) * 0.05;

  t = floorMod(time * SOURCE_TEMPO + 0.5, 1.0) / SOURCE_TEMPO;
  v = v + sourceMetal(t, 35.0, 1.0, 0.0, 2.0) * 0.04 *
      sourceStep(8.0, floorMod(time * SOURCE_TEMPO, 16.0));

  t = floorMod(time * SOURCE_TEMPO, 0.25) / SOURCE_TEMPO;
  v = v + sourceMetal(t, 500.0, 10.0, 0.0, 20.0) * 0.1;

  t = floorMod(time * SOURCE_TEMPO, 2.0) / SOURCE_TEMPO;
  v = v + sourceMetal(t, 500.0, 10.0, 0.0, 20.0) * 0.1;

  t = floorMod(time * SOURCE_TEMPO + 1.0, 2.0) / SOURCE_TEMPO;
  t = t * 1.9;
  var w = vec2<f32>(sourceHash(t), sourceHash(t + 0.1)) *
      exp(t * -10.0) *
      0.2;
  w = w + vec2<f32>(
    sin(t * 400.0) *
    exp(t * -10.0) *
    min(1.0, t * 5000.0) *
    0.1
  );
  v = v + w * (
    max(exp(-fract(t * 20.0)), min(t * 9.0, 1.0)) +
    3.0 * clamp(1.0 - abs(t - 0.4) * 10.0, 0.0, 1.0)
  );

  t = (8.0 - floorMod(time * SOURCE_TEMPO, 8.0)) / SOURCE_TEMPO;
  w = sourceMetal(t, 400.0, 1.0, 0.0, 0.5) * 0.2;
  v = mix(
    v,
    w,
    vec2<f32>(
      sourceStep(floorMod(time * SOURCE_TEMPO, 32.0), 8.0)
    )
  );

  t = floorMod(time * SOURCE_TEMPO, 8.0);
  t = floorMod(t, 3.0);
  t = t / SOURCE_TEMPO;
  let bass = sin(300.0 * (t - t * t * 0.3)) *
      sourceSmoothstep(0.0, 0.01, t) *
      sourceSmoothstep(0.4, 0.3, t);
  v = v + vec2<f32>(bass) * 0.2;

  let echo_time = SOURCE_TEMPO / 4.0;
  v = v + (
    vec2<f32>(sourceEcho(time)) +
    vec2<f32>(sourceEcho(time - echo_time)) * vec2<f32>(0.5, 0.3) +
    vec2<f32>(sourceEcho(time - echo_time * 2.0)) *
        vec2<f32>(0.10, 0.25)
  ) * 0.05;

  v = v * 4.0;
  return v;
}
`;

const dnbWgsl = WGSL_PREAMBLE + DNB_BODY + WGSL_TEXTURE_ENTRY;

const CIPHER_BODY = String.raw`
const SOURCE_PI: f32 = 3.1415926535897932384626433832795;
const SOURCE_TEMPO: f32 = 2.4;

fn sourceLydian(source_x: f32) -> f32 {
  var x = source_x;
  let octave = floor(x / 12.0);
  x = x - octave * 12.0;
  return octave * 12.0 +
      sourceStep(2.0, x) * 2.0 +
      sourceStep(4.0, x) * 2.0 +
      sourceStep(6.0, x) * 2.0 +
      sourceStep(7.0, x) * 1.0 +
      sourceStep(9.0, x) * 2.0 +
      sourceStep(11.0, x) * 2.0;
}

fn sourceDorian(source_x: f32) -> f32 {
  var x = source_x;
  let octave = floor(x / 12.0);
  x = x - octave * 12.0;
  return octave * 12.0 +
      sourceStep(2.0, x) * 2.0 +
      sourceStep(3.0, x) * 1.0 +
      sourceStep(5.0, x) * 2.0 +
      sourceStep(7.0, x) * 2.0 +
      sourceStep(9.0, x) * 2.0 +
      sourceStep(10.0, x) * 1.0;
}

fn sourcePadVoice(time: f32, frequency: f32) -> f32 {
  return (
    sin(time * frequency * 2000.0) +
    sin(time * frequency * 4000.0) +
    sin(time * frequency * 2000.0 * exp2(17.0 / 12.0)) * 0.5
  ) * (sin(time * frequency * 40.0) * 0.3 + 0.5);
}

fn sourceLeadVoice(time: f32, frequency: f32) -> f32 {
  let x = fract(time * frequency * 500.0 / SOURCE_PI);
  let smoothing = 0.01;
  let pulse_width = 0.5 + sin(time) * 0.4;
  return sourceSmoothstep(
    pulse_width - smoothing,
    pulse_width,
    x
  ) * sourceSmoothstep(1.0, 1.0 - smoothing, x) - 0.5;
}

fn sourceVoice1(time: f32) -> f32 {
  var v = 0.0;
  let time_beat = fract(time * SOURCE_TEMPO * 2.0);
  let time_index = floor(time * SOURCE_TEMPO * 2.0);

  let root_note =
      (sin(floor(time_index * 0.125) * 10.0) * 0.5 + 0.5) * 10.0;
  var random_note =
      (sin(time_index * 10.0) * 0.5 + 0.5) * 30.0;
  let _dorian_ratio = exp2(sourceDorian(root_note) / 12.0);

  var w = 0.0;
  w = w + sin(
    2000.0 * exp2(sourceLydian(random_note) / 12.0) * time
  ) * sourceSmoothstep(0.0, 0.01, time_beat) *
      sourceSmoothstep(1.0, 0.9, time_beat) *
      0.5;
  w = w + sin(
    2000.0 * exp2(sourceLydian(random_note + 4.0) / 12.0) * time
  ) * sourceSmoothstep(0.0, 0.01, time_beat) *
      sourceSmoothstep(1.0, 0.9, time_beat) *
      0.5;
  w = w * sourceStep(
    floorMod(time * SOURCE_TEMPO, 128.0),
    64.0
  );
  v = v + w;

  w = 0.0;
  w = w + sin(
    250.0 * exp2(sourceLydian(root_note) / 12.0) * time
  );
  w = w + sin(
    500.0 * exp2(sourceLydian(root_note) / 12.0) * time
  );
  w = w + sourcePadVoice(
    time,
    exp2(sourceLydian(root_note) / 12.0)
  );
  w = w + sourcePadVoice(
    time,
    exp2(sourceLydian(root_note + 4.0) / 12.0)
  );
  w = w + sourcePadVoice(
    time,
    exp2(sourceLydian(root_note + 7.0) / 12.0)
  );
  w = w * sourceStep(
    floorMod(time * SOURCE_TEMPO, 64.0),
    32.0
  );

  random_note = (
    fract(floor(time * SOURCE_TEMPO * 4.0) * 0.02) * 0.5 + 0.5
  ) * 30.0 + root_note;
  v = v + sourceLeadVoice(
    time,
    exp2(sourceLydian(random_note) / 12.0)
  ) * sourceStep(
    64.0,
    floorMod(time * SOURCE_TEMPO, 128.0)
  ) * 0.8;

  v = v + w * fract(time * SOURCE_TEMPO) *
      sourceSmoothstep(1.0, 0.9, fract(time * SOURCE_TEMPO));
  return v;
}

fn sourceMainSound(samp: i32, time: f32) -> vec2<f32> {
  let _samp = samp;
  var v = vec2<f32>(0.0);
  var pan = vec2<f32>(1.0, 0.5);
  var time_offset = vec2<f32>(0.002, 0.0);
  let feedback_time = 2.0 / 3.0 / SOURCE_TEMPO;

  v = v + vec2<f32>(sourceVoice1(time));
  for (var i: i32 = 1; i < 4; i = i + 1) {
    v.x = v.x + sourceVoice1(
      time - f32(i) * feedback_time + time_offset.x
    ) * exp(f32(i) * -0.4) * pan.x;
    v.y = v.y + sourceVoice1(
      time - f32(i) * feedback_time + time_offset.y
    ) * exp(f32(i) * -0.4) * pan.y;
    pan = pan.yx;
    time_offset = time_offset.yx;
  }
  v = v * 0.6;

  var time_beat = floorMod(time * SOURCE_TEMPO, 8.0);
  time_beat = max(
    floorMod(time_beat, 1.0 / 8.0),
    time_beat - 1.0
  );
  let noise_1 =
      fract(sin(time * 234.523) * 7862134.0) *
      exp(floorMod(time_beat, 1.0 / 4.0) / SOURCE_TEMPO * -80.0) *
      (fract(time_beat) + 0.2) *
      2.0;
  v = v + vec2<f32>(noise_1);

  let drum_mix = sourceStep(
    64.0,
    floorMod(time * SOURCE_TEMPO, 128.0)
  );
  time_beat = floorMod(time * SOURCE_TEMPO, 4.0);
  time_beat = min(
    time_beat,
    floorMod(time * SOURCE_TEMPO - 2.5, 4.0)
  );
  time_beat = max(time_beat, 0.0);
  v = mix(
    v,
    v * (1.0 - exp(time_beat * -1.0) * 0.8),
    vec2<f32>(drum_mix)
  );
  v = v + vec2<f32>(
    sin(sqrt(time_beat) * 150.0) *
    exp(time_beat * -0.5) *
    drum_mix
  );

  time_beat = floorMod(time * SOURCE_TEMPO - 1.0, 4.0);
  time_beat = min(
    time_beat,
    floorMod(time * SOURCE_TEMPO - 2.5, 5.0)
  );
  let noise_2 =
      fract(sin(time * 142.523) * 7862134.0) *
      exp(time_beat * -8.0) *
      0.5 *
      drum_mix;
  v = v + vec2<f32>(noise_2);

  time_beat = floorMod(time * SOURCE_TEMPO - 1.5, 4.0);
  time_beat = floorMod(time_beat - 1.5, 3.0);
  v = v + vec2<f32>(
    sin(sqrt(time_beat) * 1000.0) *
    exp(time_beat * -10.0) *
    0.2 *
    drum_mix
  );

  return v * 0.25;
}
`;

const cipherWgsl = WGSL_PREAMBLE + CIPHER_BODY + WGSL_KEEPALIVE_ENTRY;

export const SRTUSS_SHADER_PORTS_C = Object.freeze([
  Object.freeze({
    id: "ltKSRc",
    title: "Gravity Shielding (sound)",
    sourceUrl: "https://www.shadertoy.com/view/ltKSRc",
    sourceMirrorUrl:
      "https://raw.githubusercontent.com/GabeRundlett/shadertoy-api-shaders/f6d538adf936215ccf2d11ba9b4a6c79ccb448c5/shaders/ltKSRc.json",
    sourceDate: "2017-01-24",
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    usesTexture0: true,
    sourceCodeLength: 4948,
    sourceSha256:
      "6e551aee3fcd21bda0602165d1d5afa84e697f42e111ec197234e98dd02aa01d",
    wgsl: gravityShieldingWgsl,
  }),
  Object.freeze({
    id: "4tdSDB",
    title: "DnB (sound)",
    sourceUrl: "https://www.shadertoy.com/view/4tdSDB",
    sourceMirrorUrl:
      "https://raw.githubusercontent.com/GabeRundlett/shadertoy-api-shaders/f6d538adf936215ccf2d11ba9b4a6c79ccb448c5/shaders/4tdSDB.json",
    sourceDate: "2016-12-11",
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    usesTexture0: true,
    sourceCodeLength: 3596,
    sourceSha256:
      "ed8f8d1e228eb365ece9b8c988cda4822f9ac01e435589a6f4e61774b0751a8b",
    wgsl: dnbWgsl,
  }),
  Object.freeze({
    id: "MslBR4",
    title: "Cipher (sound)",
    sourceUrl: "https://www.shadertoy.com/view/MslBR4",
    sourceMirrorUrl:
      "https://raw.githubusercontent.com/GabeRundlett/shadertoy-api-shaders/f6d538adf936215ccf2d11ba9b4a6c79ccb448c5/shaders/MslBR4.json",
    sourceDate: "2017-05-18",
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    usesTexture0: false,
    sourceCodeLength: 3613,
    sourceSha256:
      "07488ae62faacc03e3e25ba72c0e9bfbf7ef3264e1145dbd39e6eff805bc87cd",
    wgsl: cipherWgsl,
  }),
]);

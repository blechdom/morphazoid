/*
 * Faithful WebGPU compute adaptation of the public Sound pass for
 * srtuss's "sound - acid jam". Only the Sound-pass GLSL is translated;
 * the visual pass is excluded.
 *
 * Shadertoy publications use CC BY-NC-SA 3.0. Keep author attribution,
 * the canonical link, and this same license on adaptations.
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

const ACID_JAM_BODY = String.raw`
const SOURCE_TAU: f32 = 6.283185307179586476925286766559;

fn sourceDistScalar(sample: f32, drive: f32) -> f32 {
  return clamp(sample * drive, -1.0, 1.0);
}

fn sourceDistStereo(sample: vec2<f32>, drive: f32) -> vec2<f32> {
  return clamp(sample * drive, vec2<f32>(-1.0), vec2<f32>(1.0));
}

fn sourceQuantize(sample: f32, step_size: f32) -> f32 {
  return floor(sample / step_size) * step_size;
}

fn sourceFilter(
  harmonic: f32,
  source_cutoff: f32,
  resonance: f32
) -> f32 {
  let _resonance = resonance;
  let cutoff = source_cutoff - 20.0;
  let distance_above = max(harmonic - cutoff, 0.0);
  let distance = abs(harmonic - cutoff);
  return exp(-0.005 * distance_above * distance_above) * 0.5 +
      exp(distance * distance * -0.1) * 2.2;
}

fn sourceNoise(x: f32) -> f32 {
  return fract(sin(x * 110.082) * 19871.8972);
}

fn sourceNoiseSlide(x: f32) -> f32 {
  let whole = floor(x);
  return mix(
    sourceNoise(whole),
    sourceNoise(whole + 1.0),
    sourceSmoothstep(0.0, 1.0, fract(x))
  );
}

fn sourceNoteToFrequency(note: f32) -> f32 {
  return 440.0 * pow(2.0, (note - 69.0) / 12.0);
}

fn sourceSynth(sequence_time: f32, time: f32) -> vec2<f32> {
  var value = vec2<f32>(0.0);

  let note_time = fract(sequence_time);
  let duration = 0.26;
  let amplitude = sourceSmoothstep(
    0.05,
    0.0,
    abs(note_time - duration - 0.05) - duration
  ) * exp(note_time * -1.0);
  let sequence_noise = sourceNoise(floor(sequence_time));
  let note = 20.0 + floor(sequence_noise * 38.0);
  let frequency = sourceNoteToFrequency(note);

  let square_mix = sourceSmoothstep(
    0.0,
    0.01,
    abs(floorMod(time * 9.0, 64.0) - 20.0) - 20.0
  );

  let base = frequency;
  let cutoff = exp(note_time * -1.5) * 50.0 +
      pow(cos(time) * 0.5 + 0.5, 4.0) * 80.0;

  for (var i: i32 = 0; i < 256; i = i + 1) {
    let harmonic = f32(i + 1);
    var intensity = 1.0 / harmonic;
    intensity = mix(
      intensity,
      intensity * floorMod(harmonic, 2.0),
      square_mix
    );
    intensity = intensity * exp(
      -1.0 * max(2.0 - harmonic, 0.0)
    );
    intensity = intensity * sourceFilter(harmonic, cutoff, 4.0);

    value.x = value.x + intensity * sin(
      (SOURCE_TAU + 0.01) * (time * base * harmonic)
    );
    value.y = value.y + intensity * sin(
      SOURCE_TAU * (time * base * harmonic)
    );
  }

  let _left_output = value.x * amplitude;
  return sourceDistStereo(value * amplitude, 2.0);
}

fn sourceKick(source_beat: f32, source_time: f32) -> f32 {
  let _source_time = source_time;
  var beat = fract(source_beat / 4.0) * 0.5;
  let amount = 5.0;
  beat = sqrt(beat * amount) / amount;

  let amplitude = exp(max(beat - 0.15, 0.0) * -10.0);
  var value = sin(beat * 100.0 * SOURCE_TAU) * amplitude;
  value = sourceDistScalar(value, 4.0) * amplitude;
  value = value +
      sourceNoise(sourceQuantize(beat, 0.001)) *
      sourceNoise(sourceQuantize(beat, 0.00001)) *
      exp(beat * -20.0) * 2.5;
  return value;
}

fn sourceHat(source_beat: f32) -> f32 {
  let beat = fract(source_beat / 4.0) * 0.5;
  let _amount = 4.0;
  return sourceNoise(sin(beat * 4000.0) * 0.0001) *
      sourceSmoothstep(0.0, 0.01, beat - 0.25) *
      exp(beat * -5.0);
}

fn sourceGate1(time: f32) -> f32 {
  let step_size = 0.0625;
  var value = abs(time - 0.00 - 0.015) - 0.015;
  value = min(value, abs(time - step_size * 1.0 - 0.015) - 0.015);
  value = min(value, abs(time - step_size * 2.0 - 0.015) - 0.015);
  value = min(value, abs(time - step_size * 4.0 - 0.015) - 0.015);
  value = min(value, abs(time - step_size * 6.0 - 0.015) - 0.015);
  value = min(value, abs(time - step_size * 8.0 - 0.05) - 0.05);
  value = min(value, abs(time - step_size * 11.0 - 0.05) - 0.05);
  value = min(value, abs(time - step_size * 14.0 - 0.05) - 0.05);
  return sourceSmoothstep(0.001, 0.0, value);
}

fn sourceSynth2(time: f32) -> vec2<f32> {
  let beat = floorMod(time * 9.0, 16.0) / 16.0;
  let phase = time * SOURCE_TAU * sourceNoteToFrequency(
    87.0 - 12.0 + floorMod(beat, 4.0)
  );
  let value = sourceDistScalar(
    sin(phase + sin(phase * 0.5)),
    5.0
  ) * sourceGate1(beat);
  return vec2<f32>(value);
}

fn sourceSynth2Echo(time: f32, source_beat: f32) -> vec2<f32> {
  let _source_beat = source_beat;
  var mix_value = sourceSynth2(time) * 0.5;
  var echo = 0.3;
  let feedback = 0.6;
  var echo_time = 3.0 / 9.0;
  let time_step = 2.0 / 9.0;

  mix_value = mix_value + sourceSynth2(time - echo_time) * echo *
      vec2<f32>(1.0, 0.2);
  echo = echo * feedback;
  echo_time = echo_time + time_step;
  mix_value = mix_value + sourceSynth2(time - echo_time) * echo *
      vec2<f32>(0.2, 1.0);
  echo = echo * feedback;
  echo_time = echo_time + time_step;
  mix_value = mix_value + sourceSynth2(time - echo_time) * echo *
      vec2<f32>(1.0, 0.2);
  echo = echo * feedback;
  echo_time = echo_time + time_step;
  mix_value = mix_value + sourceSynth2(time - echo_time) * echo *
      vec2<f32>(0.2, 1.0);
  return mix_value;
}

fn sourceExplosion(source_beat: f32) -> f32 {
  var beat = source_beat;
  let amount = 20.0;
  beat = sqrt(beat * amount) / amount;

  let amplitude = exp(max(beat - 0.15, 0.0) * -10.0);
  var value = sourceNoise(
    sourceQuantize(floorMod(beat, 0.1), 0.0001)
  );
  value = sourceDistScalar(value, 4.0) * amplitude;
  return value;
}

fn sourceSynth1Echo(beat: f32, time: f32) -> vec2<f32> {
  var value = sourceSynth(beat, time) * 0.5;
  var echo = 0.4;
  let feedback = 0.6;
  var echo_time = 2.0 / 9.0;
  let time_step = 2.0 / 9.0;

  value = value + sourceSynth(beat, time - echo_time) * echo *
      vec2<f32>(1.0, 0.5);
  echo = echo * feedback;
  echo_time = echo_time + time_step;
  value = value + sourceSynth(beat, time - echo_time).yx * echo *
      vec2<f32>(0.5, 1.0);
  echo = echo * feedback;
  echo_time = echo_time + time_step;
  value = value + sourceSynth(beat, time - echo_time) * echo *
      vec2<f32>(1.0, 0.5);
  echo = echo * feedback;
  echo_time = echo_time + time_step;
  value = value + sourceSynth(beat, time - echo_time).yx * echo *
      vec2<f32>(0.5, 1.0);
  return value;
}

fn sourceMainSound(sample_index: i32, time: f32) -> vec2<f32> {
  let _sample_index = sample_index;
  var mix_value = vec2<f32>(0.0);
  let beat = floorMod(time * 9.0, 16.0);

  mix_value = sourceSynth1Echo(beat, time) * 0.8 * sourceSmoothstep(
    0.0,
    0.01,
    abs(floorMod(time * 9.0, 256.0) + 8.0 - 128.0) - 8.0
  );

  let kick_intensity = sourceSmoothstep(
    0.01,
    0.0,
    abs(floorMod(time * 9.0, 256.0) - 64.0 - 128.0) - 64.0
  );
  let synth2_intensity = 1.0 - sourceSmoothstep(
    0.01,
    0.0,
    abs(floorMod(time * 9.0, 256.0) - 64.0 - 128.0) - 64.0
  );
  let hat_intensity = kick_intensity;

  mix_value = mix_value + vec2<f32>(
    sourceExplosion(floorMod(time * 9.0, 64.0) / 4.5) *
    0.4 * synth2_intensity
  );
  mix_value = mix_value + vec2<f32>(
    sourceHat(beat) * 1.5 * hat_intensity
  );
  mix_value = mix_value + sourceSynth2Echo(time, beat) *
      0.2 * synth2_intensity;

  mix_value = mix(
    mix_value,
    mix_value * (1.0 - fract(beat / 4.0) * 0.5),
    vec2<f32>(kick_intensity)
  );
  let sidechain = sin(SOURCE_TAU * beat) * 0.4 + 0.6;
  let kick_value = sourceKick(beat, time) *
      0.8 * sidechain * kick_intensity;
  mix_value = mix_value + vec2<f32>(kick_value);

  return sourceDistStereo(mix_value, 1.0);
}
`;

const acidJamWgsl = WGSL_PREAMBLE + ACID_JAM_BODY + WGSL_KEEPALIVE_ENTRY;

export const SRTUSS_SHADER_PORTS_D = Object.freeze([
  Object.freeze({
    id: "ldfSW2",
    title: "sound - acid jam",
    sourceUrl: "https://www.shadertoy.com/view/ldfSW2",
    sourceMirrorUrl:
      "https://raw.githubusercontent.com/mike-seger/simpleshader/3d0593e14bbd585b3eb88d042a3bf251af6c4b63/shaders/shadertoy-gpu-audio/sound-acid-jam-sound.glsl",
    corroboratingSourceUrl:
      "https://raw.githubusercontent.com/audiojs/audio-shader/f8de3cd2ddf231198ae7d7aa367bae25d01ed453/test/sounds/acid.glsl",
    sourceDate: "2014",
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    usesTexture0: false,
    sourceCodeLength: 5607,
    sourceSha256:
      "1f6c0e5cfb9577681ca79843907ab7f061427fc1a8e35b5d292d3ee8a01b456a",
    corroboratingSourceSha256:
      "f889afecc6270358227964d7fe6f2ac2ea714822ef1eefdf9751da4320cf4cd2",
    wgsl: acidJamWgsl,
  }),
]);

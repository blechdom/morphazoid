const PINNED_MIRROR_COMMIT = "f6d538adf936215ccf2d11ba9b4a6c79ccb448c5";
const MIRROR_ROOT = `https://raw.githubusercontent.com/GabeRundlett/shadertoy-api-shaders/${PINNED_MIRROR_COMMIT}/shaders`;
const LICENSE = "CC BY-NC-SA 3.0";
const LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/3.0/";

const SHARED_BINDINGS = `
override WORKGROUP_SIZE: u32 = 256u;
override SAMPLE_RATE: f32 = 44100.0;

// Four 32-bit fields keep this uniform exactly 16 bytes wide.
struct RenderInfo {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
}

@group(0) @binding(0) var<uniform> render_info: RenderInfo;
@group(0) @binding(1) var<storage, read_write> sound_chunk: array<vec2<f32>>;
@group(0) @binding(2) var source_texture_0: texture_2d<f32>;
@group(0) @binding(3) var source_sampler_0: sampler;

fn floorMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

// Several originals deliberately use descending smoothstep edges. GLSL leaves
// that case undefined, but Shadertoy's common implementation evaluates this
// polynomial. Keeping it explicit preserves the source's audible falling ramps.
fn sourceSmoothstep(edge_0: f32, edge_1: f32, x: f32) -> f32 {
  let amount = clamp((x - edge_0) / (edge_1 - edge_0), 0.0, 1.0);
  return amount * amount * (3.0 - 2.0 * amount);
}

fn finiteOrZero(value: f32) -> f32 {
  // An all-ones IEEE-754 exponent identifies both infinities and every NaN.
  let exponent = bitcast<u32>(value) & 0x7f800000u;
  return select(value, 0.0, exponent == 0x7f800000u);
}

fn safeOutput(value: vec2<f32>) -> vec2<f32> {
  let left = finiteOrZero(value.x);
  let right = finiteOrZero(value.y);
  return clamp(vec2<f32>(left, right), vec2<f32>(-0.88), vec2<f32>(0.88));
}
`;

function buildWgsl({
  id,
  title,
  sourceUrl,
  sourceMirrorUrl,
  sourceDate,
  sourceSha256,
  usesTexture0,
  body,
}) {
  const dummyResourceUse = usesTexture0
    ? ""
    : `
  // These ports do not sample iChannel0. The runtime-only branch keeps the
  // shared texture/sampler bind-group contract statically visible to WebGPU.
  if ((render_info.flags & 1u) != 0u) {
    _ = textureSampleLevel(
      source_texture_0,
      source_sampler_0,
      vec2<f32>(0.5),
      0.0,
    );
  }
`;

  return `// "${title}" by srtuss — original Shadertoy Sound pass.
// Source: ${sourceUrl}
// Pinned public mirror: ${sourceMirrorUrl}
// Source date: ${sourceDate}; license: ${LICENSE} (${LICENSE_URL})
// Original Sound-pass SHA-256: ${sourceSha256}
//
// WebGPU adaptation notice: GLSL ES was translated to strict WGSL by
// Morphazoid. The original synthesis math and evaluation order are retained;
// macros are expanded, GLSL mod uses an explicit floor-mod helper, and only the
// shared compute bindings, per-layer time rate, and a finite-output / +/-0.88
// safety wrapper are new. A time rate of 1 retains the original sample clock.
// Mirror shader id: ${id}
${SHARED_BINDINGS}
${body}

@compute
@workgroup_size(WORKGROUP_SIZE)
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
  let time = source_position / SAMPLE_RATE;
  let value = sourceMainSound(i32(floor(source_position)), time)
      * min(head_gain, tail_gain);
${dummyResourceUse}
  sound_chunk[local_sample] = safeOutput(value);
}
`;
}

function makePort({
  id,
  title,
  sourceDate,
  usesTexture0,
  sourceCodeLength,
  sourceSha256,
  body,
}) {
  const sourceUrl = `https://www.shadertoy.com/view/${id}`;
  const sourceMirrorUrl = `${MIRROR_ROOT}/${id}.json`;
  return Object.freeze({
    id,
    title,
    sourceUrl,
    sourceMirrorUrl,
    sourceDate,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    usesTexture0,
    sourceCodeLength,
    sourceSha256,
    wgsl: buildWgsl({
      id,
      title,
      sourceUrl,
      sourceMirrorUrl,
      sourceDate,
      sourceSha256,
      usesTexture0,
      body,
    }),
  });
}

const SHIFT_SOUND_BODY = `
fn hash(x: f32) -> f32 {
  return fract(sin(x * 133.31254) * 873412.23423);
}

fn noise(x: f32) -> f32 {
  let fl = floor(x);
  return mix(hash(fl), hash(fl + 1.0), sourceSmoothstep(0.0, 1.0, fract(x)));
}

fn spec(x: f32) -> f32 {
  return noise(x);
}

fn osc(t: f32, f: f32) -> f32 {
  var v = 0.0;
  var amp = 0.0;
  for (var i: i32 = 0; i < 256; i = i + 1) {
    let h = f32(i + 1);
    var k = spec(t * 3.0 + h * (0.5 + sin(t) * 0.48));
    k = pow(k, 3.0);
    v += sin(t * h * f * 6.0)
      * (cos(t * h * 4.0) * 0.5 + 1.0)
      * (cos(t * h * 7.0) * 0.5 + 1.0)
      * k / h;
    amp += k / h;
  }
  return v / amp;
}

const pi: f32 = 3.1415926535897932384626433832795;

fn leadvoice(time: f32, f: f32) -> f32 {
  let x = fract(time * f * 6.0 / pi);
  let s = 0.002;
  let pw = 0.5 + sin(time * 2.0) * 0.4;
  return sourceSmoothstep(pw - s, pw, x)
    * sourceSmoothstep(1.0, 1.0 - s, x) - 0.5;
}

fn dorian(source_x: f32) -> f32 {
  let o = floor(source_x / 12.0);
  let x = source_x - o * 12.0;
  return o * 12.0
    + step(2.0, x) * 2.0
    + step(3.0, x) * 1.0
    + step(5.0, x) * 2.0
    + step(7.0, x) * 2.0
    + step(9.0, x) * 2.0
    + step(10.0, x) * 1.0;
}

fn lydian(source_x: f32) -> f32 {
  let o = floor(source_x / 12.0);
  let x = source_x - o * 12.0;
  return o * 12.0
    + step(2.0, x) * 2.0
    + step(4.0, x) * 2.0
    + step(6.0, x) * 2.0
    + step(7.0, x) * 1.0
    + step(9.0, x) * 2.0
    + step(11.0, x) * 2.0;
}

fn bsf(time: f32) -> f32 {
  var tb = time * 10.0;
  tb = floorMod(tb, 128.0);
  return exp2((step(64.0, tb) * 3.0 + step(96.0, tb) * 2.0) / 12.0);
}

fn snd(time: f32) -> vec2<f32> {
  let f = 70.0 * exp2(floorMod(floor(time * 5.0), 2.0)) * bsf(time);
  var v = vec2<f32>(osc(time, f), osc(time + 0.01, f * 1.001)) * 0.6;

  var tb = time * 10.0;
  tb = floorMod(tb, 4.0);
  tb = floorMod(tb, 3.25);
  tb = floorMod(tb, 1.0);
  v *= sourceSmoothstep(0.0, 0.01, tb)
    * sourceSmoothstep(0.61, 0.6, tb) * 0.7 + 0.3;

  let arp_wi = floor(hash(floor(time * 10.0 / 2.0)) * 10.0) + 1.0;
  let lead = leadvoice(
    time,
    140.0 * 4.0
      * exp2(dorian(sin(floor(time * 10.0) * 3.0) * arp_wi) / 12.0),
  ) * 0.4 * exp(fract(tb * 1.0) * -2.0);
  v += vec2<f32>(lead);

  return v;
}

fn sourceMainSound(samp: i32, time: f32) -> vec2<f32> {
  _ = samp;
  var v = snd(time);
  v += snd(time - 0.5).yx * vec2<f32>(0.5, 0.3);
  v += snd(time - 1.0) * vec2<f32>(0.2, 0.25);

  v += vec2<f32>(sin(time * 70.0 * 6.0) * sin(time * 10.0) * 0.05);
  v += vec2<f32>(sin(100.0 * sqrt(floorMod(time * 10.0 - 1.0, 4.0))) * 0.5);
  v += vec2<f32>(sin(100.0 * sqrt(floorMod(time * 10.0 - 3.0, 4.0))) * 0.1);

  v += vec2<f32>(hash(time) * exp(floorMod(time * 10.0 - 3.0, 4.0) * -2.0) * 0.5);
  v += vec2<f32>(
    hash(time)
      * exp(floorMod(time * 10.0 - 3.0, 1.0) * -8.0)
      * 0.6
      * (0.3 + 0.7 * hash(floor(floorMod(time * 10.0, 8.0)))),
  );

  let tb = floorMod(time * 10.0 - 3.0, 4.0);
  v += vec2<f32>(
    leadvoice(time, 35.0 * bsf(time))
      * 0.7
      * sourceSmoothstep(0.0, 0.1, tb)
      * sourceSmoothstep(2.1, 1.0, tb),
  );

  return v * 0.75;
}
`;

const BOULDER_DASH_SOUND_BODY = `
fn c0(source_t: f32) -> vec2<f32> {
  let t = floorMod(source_t, 128.0);
  var v = vec2<f32>(0.0);
  v += max(t - 0.0, 0.0) * vec2<f32>(29.1352, 58.2705);
  v += max(t - 1.0, 0.0) * vec2<f32>(14.5183, 15.1457);
  v += max(t - 2.0, 0.0) * vec2<f32>(14.6169, 13.8909);
  v += max(t - 3.0, 0.0) * vec2<f32>(11.0252, 29.2339);
  v += max(t - 4.0, 0.0) * vec2<f32>(-43.3391, -51.1345);
  v += max(t - 5.0, 0.0) * vec2<f32>(23.0429, 12.3754);
  v += max(t - 6.0, 0.0) * vec2<f32>(2.91366, 9.52531);
  v += max(t - 7.0, 0.0) * vec2<f32>(25.8687, 43.5057);
  v += max(t - 8.0, 0.0) * vec2<f32>(-54.6571, -38.3142);
  v += max(t - 9.0, 0.0) * vec2<f32>(0.0, 11.3276);
  v += max(t - 10.0, 0.0) * vec2<f32>(23.1247, 12.7148);
  v += max(t - 11.0, 0.0) * vec2<f32>(-23.1247, 22.0504);
  v += max(t - 12.0, 0.0) * vec2<f32>(28.7884, -34.7651);
  v += max(t - 13.0, 0.0) * vec2<f32>(103.65, 92.1715);
  v += max(t - 14.0, 0.0) * vec2<f32>(-100.563, -85.9977);
  v += max(t - 15.0, 0.0) * vec2<f32>(83.5913, 64.6141);
  v += max(t - 16.0, 0.0) * vec2<f32>(-109.456, -116.344);
  v += max(t - 17.0, 0.0) * vec2<f32>(0.0, 58.2705);
  v += max(t - 18.0, 0.0) * vec2<f32>(0.0, -72.8874);
  v += max(t - 19.0, 0.0) * vec2<f32>(0.0, 21.7529);
  v += max(t - 20.0, 0.0) * vec2<f32>(-3.17869, -13.4933);
  v += max(t - 21.0, 0.0) * vec2<f32>(0.0, 78.8997);
  v += max(t - 22.0, 0.0) * vec2<f32>(0.0, -65.4064);
  v += max(t - 23.0, 0.0) * vec2<f32>(0.0, -13.4933);
  v += max(t - 24.0, 0.0) * vec2<f32>(3.17869, 6.35738);
  v += max(t - 25.0, 0.0) * vec2<f32>(0.0, 58.2705);
  v += max(t - 26.0, 0.0) * vec2<f32>(0.0, -72.8874);
  v += max(t - 27.0, 0.0) * vec2<f32>(0.0, 21.7529);
  v += max(t - 28.0, 0.0) * vec2<f32>(17.1141, 27.0922);
  v += max(t - 29.0, 0.0) * vec2<f32>(0.0, 140.583);
  v += max(t - 30.0, 0.0) * vec2<f32>(0.0, -116.541);
  v += max(t - 31.0, 0.0) * vec2<f32>(0.0, -24.0423);
  v += max(t - 32.0, 0.0) * vec2<f32>(-20.2928, 11.3276);
  v += max(t - 34.0, 0.0) * vec2<f32>(0.0, -64.9353);
  v += max(t - 35.0, 0.0) * vec2<f32>(0.0, 19.3796);
  v += max(t - 36.0, 0.0) * vec2<f32>(15.2469, 24.1364);
  v += max(t - 37.0, 0.0) * vec2<f32>(0.0, 125.245);
  v += max(t - 38.0, 0.0) * vec2<f32>(0.0, -103.826);
  v += max(t - 39.0, 0.0) * vec2<f32>(0.0, -21.4193);
  v += max(t - 40.0, 0.0) * vec2<f32>(-19.3767, -38.7534);
  v += max(t - 41.0, 0.0) * vec2<f32>(65.4803, 66.3465);
  v += max(t - 42.0, 0.0) * vec2<f32>(-65.4803, -61.0006);
  v += max(t - 43.0, 0.0) * vec2<f32>(65.4803, 67.5415);
  v += max(t - 44.0, 0.0) * vec2<f32>(-67.8616, -38.7592);
  v += max(t - 46.0, 0.0) * vec2<f32>(9.6898, 77.7817);
  v += max(t - 47.0, 0.0) * vec2<f32>(0.0, -77.7817);
  v += max(t - 48.0, 0.0) * vec2<f32>(0.0, 38.7592);
  v += max(t - 52.0, 0.0) * vec2<f32>(29.1352, 0.0);
  v += max(t - 54.0, 0.0) * vec2<f32>(-29.1352, 0.0);
  v += max(t - 56.0, 0.0) * vec2<f32>(-3.17869, 0.0);
  v += max(t - 60.0, 0.0) * vec2<f32>(25.9565, 0.0);
  v += max(t - 62.0, 0.0) * vec2<f32>(-25.9565, 0.0);
  v += max(t - 64.0, 0.0) * vec2<f32>(3.17869, 0.0);
  v += max(t - 65.0, 0.0) * vec2<f32>(117.697, 0.0);
  v += max(t - 66.0, 0.0) * vec2<f32>(-117.697, 0.0);
  v += max(t - 67.0, 0.0) * vec2<f32>(126.428, 0.0);
  v += max(t - 68.0, 0.0) * vec2<f32>(-97.293, 0.0);
  v += max(t - 69.0, 0.0) * vec2<f32>(88.5619, 0.0);
  v += max(t - 70.0, 0.0) * vec2<f32>(-117.697, 0.0);
  v += max(t - 71.0, 0.0) * vec2<f32>(126.428, 0.0);
  v += max(t - 72.0, 0.0) * vec2<f32>(-129.607, 0.0);
  v += max(t - 73.0, 0.0) * vec2<f32>(120.876, 0.0);
  v += max(t - 74.0, 0.0) * vec2<f32>(-120.876, 0.0);
  v += max(t - 75.0, 0.0) * vec2<f32>(129.607, 0.0);
  v += max(t - 76.0, 0.0) * vec2<f32>(-103.65, -12.7148);
  v += max(t - 77.0, 0.0) * vec2<f32>(78.8997, 0.0);
  v += max(t - 78.0, 0.0) * vec2<f32>(-104.856, 0.0);
  v += max(t - 79.0, 0.0) * vec2<f32>(112.635, 0.0);
  v += max(t - 80.0, 0.0) * vec2<f32>(-109.456, 12.7148);
  v += max(t - 81.0, 0.0) * vec2<f32>(0.0, 116.541);
  v += max(t - 82.0, 0.0) * vec2<f32>(0.0, -116.541);
  v += max(t - 83.0, 0.0) * vec2<f32>(145.479, 91.1114);
  v += max(t - 84.0, 0.0) * vec2<f32>(-116.344, -91.1114);
  v += max(t - 85.0, 0.0) * vec2<f32>(0.0, 79.4568);
  v += max(t - 86.0, 0.0) * vec2<f32>(-29.1352, -79.4568);
  v += max(t - 87.0, 0.0) * vec2<f32>(109.456, 58.0732);
  v += max(t - 88.0, 0.0) * vec2<f32>(-112.635, -70.7879);
  v += max(t - 89.0, 0.0) * vec2<f32>(0.0, 103.826);
  v += max(t - 90.0, 0.0) * vec2<f32>(0.0, -103.826);
  v += max(t - 91.0, 0.0) * vec2<f32>(0.0, 103.826);
  v += max(t - 92.0, 0.0) * vec2<f32>(25.9565, -103.826);
  v += max(t - 93.0, 0.0) * vec2<f32>(0.0, 51.7373);
  v += max(t - 94.0, 0.0) * vec2<f32>(-25.9565, -51.7373);
  v += max(t - 95.0, 0.0) * vec2<f32>(0.0, 103.826);
  v += max(t - 96.0, 0.0) * vec2<f32>(3.17869, -91.1114);
  v += max(t - 97.0, 0.0) * vec2<f32>(117.697, 0.0);
  v += max(t - 98.0, 0.0) * vec2<f32>(-117.697, 0.0);
  v += max(t - 99.0, 0.0) * vec2<f32>(126.428, 0.0);
  v += max(t - 100.0, 0.0) * vec2<f32>(-97.293, 0.0);
  v += max(t - 101.0, 0.0) * vec2<f32>(88.5619, 0.0);
  v += max(t - 102.0, 0.0) * vec2<f32>(-117.697, 0.0);
  v += max(t - 103.0, 0.0) * vec2<f32>(126.428, 0.0);
  v += max(t - 104.0, 0.0) * vec2<f32>(-129.607, 0.0);
  v += max(t - 105.0, 0.0) * vec2<f32>(120.876, 0.0);
  v += max(t - 106.0, 0.0) * vec2<f32>(-120.876, 0.0);
  v += max(t - 107.0, 0.0) * vec2<f32>(129.607, 0.0);
  v += max(t - 108.0, 0.0) * vec2<f32>(-103.65, -12.7148);
  v += max(t - 109.0, 0.0) * vec2<f32>(78.8997, 0.0);
  v += max(t - 110.0, 0.0) * vec2<f32>(-104.856, 0.0);
  v += max(t - 111.0, 0.0) * vec2<f32>(112.635, 0.0);
  v += max(t - 112.0, 0.0) * vec2<f32>(-22.0504, 43.0062);
  v += max(t - 113.0, 0.0) * vec2<f32>(-29.2339, -30.2914);
  v += max(t - 114.0, 0.0) * vec2<f32>(-13.8909, -29.2339);
  v += max(t - 115.0, 0.0) * vec2<f32>(-15.1457, -13.8909);
  v += max(t - 116.0, 0.0) * vec2<f32>(45.5557, 57.3966);
  v += max(t - 117.0, 0.0) * vec2<f32>(-26.0444, -26.9866);
  v += max(t - 118.0, 0.0) * vec2<f32>(-12.3754, -26.0444);
  v += max(t - 119.0, 0.0) * vec2<f32>(-39.4498, -25.8687);
  v += max(t - 120.0, 0.0) * vec2<f32>(148.658, 94.9193);
  v += max(t - 121.0, 0.0) * vec2<f32>(-27.7817, -30.2914);
  v += max(t - 122.0, 0.0) * vec2<f32>(-30.2914, -29.2339);
  v += max(t - 123.0, 0.0) * vec2<f32>(-29.2339, -13.8909);
  v += max(t - 124.0, 0.0) * vec2<f32>(-9.52531, 57.3966);
  v += max(t - 125.0, 0.0) * vec2<f32>(-12.3754, -26.9866);
  v += max(t - 126.0, 0.0) * vec2<f32>(-13.4933, -26.0444);
  v += max(t - 127.0, 0.0) * vec2<f32>(-25.9565, -25.8687);
  return v;
}

fn hsh(x: f32) -> f32 {
  return fract(sin(x * 12.315623) * 219862.251235);
}

fn nse(x: f32) -> f32 {
  let fl = floor(x);
  return mix(hsh(fl), hsh(fl + 1.0), sourceSmoothstep(0.0, 1.0, fract(x)));
}

fn osc(x: f32) -> vec2<f32> {
  return vec2<f32>(
    abs(fract(x) - 0.5) - 0.5,
    abs(fract(x - 0.05) - 0.5) - 0.5,
  );
}

fn s(source_time: f32) -> vec2<f32> {
  let ts = 2.2;

  // BAD_SOUND is defined in the original, so both guarded blocks are expanded.
  let time = source_time + sin(source_time * 40.0) * 0.0001;
  let songtime = time - 0.8;

  let phs = c0(songtime * 3.0 * ts) / ts;
  var v = osc(phs.x);
  v += osc(phs.y);
  let nt = fract(songtime * 3.0 * ts);
  v *= sourceSmoothstep(0.0, 0.007, nt)
    * sourceSmoothstep(1.0, 0.3, nt) * 0.5 + 0.5;

  let beep_frequency = mix(
    1560.8,
    3543.1,
    fract(1.61803398875 * floor(songtime * 35.0)),
  );
  let beep = osc(beep_frequency * songtime) * 0.8;
  v = mix(v, beep, vec2<f32>(step(songtime, 0.0)));

  let d_n = (nse(time * 5.0) + nse(time * 15.0) * 0.5) * 0.66666666666;
  v += vec2<f32>(
    nse(fract(time * 100.0) * 50.0)
      * clamp(pow(d_n * 1.2, 30.0), 0.0, 1.0) * 0.1,
  );
  v += vec2<f32>(hsh(time) * (0.005 + pow(d_n, 20.0) * 0.5));
  v *= 1.1;
  return v;
}

fn sourceMainSound(samp: i32, time: f32) -> vec2<f32> {
  _ = samp;
  var v = s(time);
  v += s(time - 0.02) * 0.4;
  v += s(time - 0.04) * 0.25;
  v += s(time - 0.06) * 0.2;
  return v * 0.6;
}
`;

const NOISE_BANDS_SOUND_BODY = `
fn hsh(x: f32) -> f32 {
  return fract(sin(x * 237.234234) * 982734.1235);
}

fn nse(source_x: f32) -> f32 {
  let fl = floor(source_x);
  let x = sourceSmoothstep(0.0, 1.0, fract(source_x));
  return mix(hsh(fl), hsh(fl + 1.0), x) - 0.5;
}

fn fbm(x: f32) -> f32 {
  return nse(x) + nse(x * -2.0) * 0.5 + nse(x * 4.1) * 0.25;
}

fn sampleChannel0Repeat(uv: vec2<f32>) -> vec4<f32> {
  // The source JSON requests repeat wrapping. fract() preserves GLSL repeat UV
  // semantics, while the runtime sampler must also use repeat addressing so
  // linear filtering crosses texture edges correctly. Shadertoy marks the
  // source texture vflip=true; the runtime must upload it in that orientation.
  return textureSampleLevel(
    source_texture_0,
    source_sampler_0,
    fract(uv),
    0.0,
  );
}

fn metal(source_time: f32, seed: f32, fmul: f32, lp: f32) -> vec2<f32> {
  var v = vec2<f32>(0.0);
  var time = source_time;
  for (var i: i32 = 0; i < 30; i = i + 1) {
    var f = 100.0 + pow(hsh(f32(i) + seed), 3.0) * 15000.0;
    f *= fmul;
    let dat = sampleChannel0Repeat(vec2<f32>(f32(i) / 100.0, time * 0.1));
    let amp = dat.x * exp(-f * lp);

    v += sin(time * f * 6.0)
      * amp
      * (vec2<f32>(nse(time * 0.09 * f), nse(time * 0.091 * f))
        * 0.8 + vec2<f32>(0.2));
    time -= 3.3333;
  }
  v *= 0.6;
  return v;
}

fn stereomix(time: f32) -> vec2<f32> {
  var spd = 0.2;
  var sd = floor(time * spd) * 100.0;
  let lp = 0.002;

  let blend = sourceSmoothstep(0.0, 1.0, fract(time * spd));
  var v = mix(
    metal(time, sd, 0.1, lp),
    metal(time, sd + 100.0, 0.1, lp),
    vec2<f32>(blend),
  );

  spd = 0.13333;
  sd = floor(time * spd) * 100.0;
  let high_blend = sourceSmoothstep(0.0, 1.0, fract(time * spd));
  let vh = mix(
    metal(time, sd, 1.0, lp),
    metal(time, sd + 100.0, 1.0, lp),
    vec2<f32>(high_blend),
  );
  _ = vh;

  // The source computes tmp before a commented-out experiment.
  let tmp = fract(time * 3.0);
  _ = tmp;
  v += vec2<f32>(0.1, 0.2)
    * 0.2
    * sin(time * 13000.0)
    * sourceSmoothstep(
      0.001,
      0.0,
      abs(fract(time * 0.1) - 0.5) - 0.015,
    );

  return v;
}

const tempo: f32 = 2.1;

fn echo(time: f32) -> f32 {
  var v = 0.0;
  let nt = floor(hsh(floor(time * tempo * 4.0)) * 2.0) * 5.0;
  let tm = fract(time * tempo * 4.0);
  v += sin(time * 5000.0 * exp2(nt / 12.0))
    * exp(tm * -2.0)
    * sourceSmoothstep(0.0, 0.1, tm);
  return v;
}

fn sourceMainSound(samp: i32, time: f32) -> vec2<f32> {
  _ = samp;
  var v = stereomix(time);

  var tm = fract(time * tempo) / tempo;
  let tmk = tm;
  var w = sin(tm * 400.0 * exp(tm * -0.5)) * exp(tm * -10.0);
  w += sin(tm * 1000.0 * exp(tm * -0.4)) * exp(tm * -100.0);
  w = clamp(w, -0.4, 0.4);

  let mhats = sourceSmoothstep(31.99, 32.0, time * tempo);

  tm = fract(time * tempo + 0.5) / tempo;
  w += hsh(fract(time)) * exp(tm * -40.0) * 0.3 * mhats;
  tm = fract(time * tempo + 0.75) / tempo;
  w += hsh(fract(time)) * exp(tm * -40.0) * 0.05 * mhats;
  tm = fract(time * tempo + 0.25) / tempo;
  w += hsh(fract(time)) * exp(tm * -40.0) * 0.03 * mhats;

  tm = floorMod(time * tempo + 0.25, 4.0) / tempo;
  v += vec2<f32>(hsh(fract(time)) * exp(tm * -5.0) * 0.03 * mhats);

  tm = floorMod(time * tempo, 32.0) / tempo;
  v += metal(tm, 2000.0, 3.0, tm * 0.0001)
    * 0.1 * exp(fract(tm) * -2.0) * 0.5;
  v += metal(tm, 3000.0, 3.0, tm * 0.0001)
    * 0.1 * exp(fract(-tm) * -2.0) * 0.5;

  let et = tempo / 4.0;
  v += (
    vec2<f32>(echo(time))
      + echo(time - et) * vec2<f32>(0.5, 0.3)
      + echo(time - et * 2.0) * vec2<f32>(0.10, 0.25)
  ) * 0.05 * sourceSmoothstep(15.99, 16.0, time * tempo);

  let duck = clamp(
    1.0 - exp(tmk * -9.0) * 2.0 * sourceSmoothstep(0.0, 0.005, tmk),
    0.0,
    1.0,
  );
  v = vec2<f32>(w * 0.3) + v * duck;
  v = (vec2<f32>(1.0) - exp(abs(v) * -1.5)) * sign(v);
  return v;
}
`;

export const SRTUSS_SHADER_PORTS_B = Object.freeze([
  makePort({
    id: "ldlfRS",
    title: "Shift (sound)",
    sourceDate: "2017-06-06T21:28:55Z",
    usesTexture0: false,
    sourceCodeLength: 2955,
    sourceSha256: "98b8966a1441d63f0a118d2a5eb897323e2bcfdc377bfaa82cec82511addaf4f",
    body: SHIFT_SOUND_BODY,
  }),
  makePort({
    id: "4tsGD8",
    title: "Boulder Dash title (sound)",
    sourceDate: "2015-01-19T12:54:31Z",
    usesTexture0: false,
    sourceCodeLength: 4524,
    sourceSha256: "8e469de20f17a51a46070ce2fe31fe6b593f52025dd9ae4f037819705d4e2afc",
    body: BOULDER_DASH_SOUND_BODY,
  }),
  makePort({
    id: "lldGDM",
    title: "Noise Bands (sound)",
    sourceDate: "2016-07-28T17:16:26Z",
    usesTexture0: true,
    sourceCodeLength: 3390,
    sourceSha256: "b826e1325d7796b6352eb76be4e480a74f9064e21ea0c6f34c2721fa01a21eef",
    body: NOISE_BANDS_SOUND_BODY,
  }),
]);

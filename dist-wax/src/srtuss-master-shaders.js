// Expressive adapters for the eight non-Chiptune, non-Acid srtuss Sound ports.
// The pinned exact WGSL strings remain owned by the source modules. This file
// always returns a newly adapted string and never mutates a project record.

const SUPPORTED_PROJECT_IDS = new Set([
  "XdSGz1",
  "Xd2GW3",
  "ldlfRS",
  "4tsGD8",
  "lldGDM",
  "ltKSRc",
  "4tdSDB",
  "MslBR4",
]);

const SYNTHESIS_UNIFORM = `struct SynthesisUniforms {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
}`;

const EXTENDED_SYNTHESIS_UNIFORM = `struct SynthesisUniforms {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
  master_0: vec4<f32>,
  master_1: vec4<f32>,
  master_2: vec4<f32>,
  master_3: vec4<f32>,
}`;

const RENDER_UNIFORM = `struct RenderInfo {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
}`;

const EXTENDED_RENDER_UNIFORM = `struct RenderInfo {
  sample_offset: u32,
  flags: u32,
  time_rate: f32,
  source_fraction: f32,
  master_0: vec4<f32>,
  master_1: vec4<f32>,
  master_2: vec4<f32>,
  master_3: vec4<f32>,
}`;

const MASTER_HELPERS = String.raw`
// Morphazoid master controls. Neutral expressive defaults are:
// tune/shape/brightness/contour/pattern/motion/noise/space/drive 0;
// tone/bass/percussion/texture/fx/width 1.
fn mzMasterTuneRatio() -> f32 {
  return exp2(clamp(__MASTER__.master_0.x, -24.0, 24.0) / 12.0);
}

fn mzMasterShapeRatio() -> f32 {
  return exp2(clamp(__MASTER__.master_0.y, -1.0, 1.0) * 0.5);
}

fn mzMasterBrightnessRatio() -> f32 {
  return exp2(clamp(__MASTER__.master_0.z, -1.0, 1.0));
}

fn mzMasterContourRatio() -> f32 {
  return exp2(clamp(__MASTER__.master_0.w, -1.0, 1.0));
}

fn mzMasterMotionRatio() -> f32 {
  return exp2(clamp(__MASTER__.master_1.y, -1.0, 1.0));
}

fn mzMasterNoiseGain() -> f32 {
  return exp2(clamp(__MASTER__.master_1.z, -1.0, 1.0));
}

fn mzMasterSpaceGain() -> f32 {
  return exp2(clamp(__MASTER__.master_1.w, -1.0, 1.0));
}

fn mzMasterToneBus() -> f32 {
  return clamp(__MASTER__.master_2.y, 0.0, 2.0);
}

fn mzMasterBassBus() -> f32 {
  return clamp(__MASTER__.master_2.z, 0.0, 2.0);
}

fn mzMasterPercussionBus() -> f32 {
  return clamp(__MASTER__.master_2.w, 0.0, 2.0);
}

fn mzMasterTextureBus() -> f32 {
  return clamp(__MASTER__.master_3.x, 0.0, 2.0);
}

fn mzMasterFxBus() -> f32 {
  return clamp(__MASTER__.master_3.y, 0.0, 2.0);
}

fn mzMasterPartSelection() -> f32 {
  return round(clamp(__MASTER__.master_3.w, 0.0, 31.0));
}

fn mzMasterPart(part_id: f32) -> f32 {
  let selection = mzMasterPartSelection();
  return select(0.0, 1.0, selection < 0.5 || abs(selection - part_id) < 0.25);
}

fn mzMasterPartOr(first: f32, second: f32) -> f32 {
  return max(mzMasterPart(first), mzMasterPart(second));
}

fn mzMasterPartNot(part_id: f32) -> f32 {
  let selection = mzMasterPartSelection();
  if (selection < 0.5) {
    return 1.0;
  }
  return select(1.0, 0.0, abs(selection - part_id) < 0.25);
}

fn mzMasterPatternGate(time: f32) -> f32 {
  let pattern = clamp(__MASTER__.master_1.x, -1.0, 1.0);
  if (abs(pattern) <= 0.001) {
    return 1.0;
  }
  let motion = clamp(__MASTER__.master_1.y, -1.0, 1.0);
  let phase = fract(time * mix(2.0, 12.0, (motion + 1.0) * 0.5));
  if (pattern > 0.0) {
    let accent = 0.72 + 0.28 * (1.0 - smoothstep(0.0, 0.2, phase));
    return mix(1.0, accent, pattern);
  }
  let density = 1.0 + pattern;
  if (density <= 0.001) {
    return 0.0;
  }
  let edge = max(0.002, min(0.04, density * 0.2));
  let attack = smoothstep(0.0, edge, phase);
  let release = 1.0 - smoothstep(max(edge, density - edge), density, phase);
  return attack * release;
}

fn mzMasterFinish(source_value: vec2<f32>) -> vec2<f32> {
  var value = source_value;
  let mono = vec2<f32>((value.x + value.y) * 0.5);
  let width = clamp(__MASTER__.master_3.z, 0.0, 2.0);
  value = mono + (value - mono) * width;

  let shape = clamp(__MASTER__.master_0.y, -1.0, 1.0);
  if (shape > 0.0001) {
    let amount = shape;
    let rounded = value / (vec2<f32>(1.0) + abs(value) * 1.5);
    value = mix(value, rounded, vec2<f32>(amount));
  } else if (shape < -0.0001) {
    let amount = -shape;
    let squared = sign(value) * pow(abs(value), vec2<f32>(1.8));
    value = mix(value, squared, vec2<f32>(amount));
  }

  let drive = clamp(__MASTER__.master_2.x, -1.0, 1.0);
  if (drive > 0.0001) {
    let gain = 1.0 + drive * 8.0;
    value = value * gain / (vec2<f32>(1.0) + abs(value) * (gain - 1.0));
  } else if (drive < -0.0001) {
    value *= 1.0 + drive * 0.5;
  }
  return value;
}
`;

function replaceRequired(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) {
    throw new Error("srtuss master adapter missing " + label);
  }
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error("srtuss master adapter found ambiguous " + label);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function applyRequiredReplacements(source, projectId, replacements) {
  return replacements.reduce(
    (result, [needle, replacement, label]) => replaceRequired(
      result,
      needle,
      replacement,
      projectId + " " + label,
    ),
    source,
  );
}

function extendMasterUniform(source, projectId) {
  if (source.includes("fn mzMasterTuneRatio")) {
    throw new Error("srtuss master adapter helper collision for " + projectId);
  }
  if (source.includes(SYNTHESIS_UNIFORM)) {
    let result = replaceRequired(
      source,
      SYNTHESIS_UNIFORM,
      EXTENDED_SYNTHESIS_UNIFORM,
      projectId + " synthesis uniform",
    );
    result = replaceRequired(
      result,
      "@group(0) @binding(3) var source_sampler: sampler;\n",
      "@group(0) @binding(3) var source_sampler: sampler;\n"
        + MASTER_HELPERS.replaceAll("__MASTER__", "synthesis"),
      projectId + " synthesis helper insertion",
    );
    return result;
  }
  if (source.includes(RENDER_UNIFORM)) {
    let result = replaceRequired(
      source,
      RENDER_UNIFORM,
      EXTENDED_RENDER_UNIFORM,
      projectId + " render uniform",
    );
    const samplerMarker = source.includes("source_sampler_0")
      ? "@group(0) @binding(3) var source_sampler_0: sampler;\n"
      : "@group(0) @binding(3) var texture_0_sampler: sampler;\n";
    result = replaceRequired(
      result,
      samplerMarker,
      samplerMarker + MASTER_HELPERS.replaceAll("__MASTER__", "render_info"),
      projectId + " render helper insertion",
    );
    return result;
  }
  throw new Error("srtuss master adapter found no supported uniform in " + projectId);
}

function adaptNoir(source) {
  return applyRequiredReplacements(source, "XdSGz1", [
    [
      "  var fa = 440.0 * pow(2.0, (f + 10.0) / 12.0);",
      "  var fa = 440.0 * mzMasterTuneRatio() * pow(2.0, (f + 10.0) / 12.0);",
      "lead tuning",
    ],
    [
      "  let adsr = sourceSmoothstep(1.0, 0.5, t) * sourceSmoothstep(0.0, 0.1, t);",
      "  let adsr = sourceSmoothstep(1.0, 0.5, t) * sourceSmoothstep(0.0, 0.1, t) * mzMasterContourRatio();",
      "lead contour",
    ],
    [
      "  var v = sin(vec2<f32>(fa, fa * 1.001) * time * PI2) * adsr * vec2<f32>(1.0);",
      "  var v = sin(vec2<f32>(fa, fa * 1.001) * time * PI2) * adsr * vec2<f32>(mzMasterToneBus() * mzMasterPartOr(1.0, 3.0));",
      "lead bus",
    ],
    [
      "  v += vec2<f32>(sin(time * PI2 * fa * 0.5) * adsr2 * 0.4);",
      "  v += vec2<f32>(sin(time * PI2 * fa * 0.5) * adsr2 * 0.4 * mzMasterToneBus() * mzMasterPartOr(1.0, 3.0));",
      "lead subharmonic",
    ],
    [
      "  v += vec2<f32>(sin(time * PI2 * fa * 4.0) * adsr * 0.1);",
      "  v += vec2<f32>(sin(time * PI2 * fa * 4.0) * adsr * 0.1 * mzMasterToneBus() * mzMasterBrightnessRatio() * mzMasterPartOr(1.0, 3.0));",
      "lead brightness",
    ],
    [
      "  let shape_width = (1.1 + sin(time)) * 0.2;",
      "  let shape_width = (1.1 + sin(time * mzMasterMotionRatio())) * 0.2 * mzMasterShapeRatio();",
      "bass shape",
    ],
    [
      "  ) - vec2<f32>(0.5)) * 2.4;",
      "  ) - vec2<f32>(0.5)) * 2.4 * mzMasterBassBus() * mzMasterPartOr(2.0, 3.0);",
      "pulse bass bus",
    ],
    [
      "  v += vec2<f32>(sin(fa * PI2 * time * 2.0) * adsr * 0.4);",
      "  v += vec2<f32>(sin(fa * PI2 * time * 2.0) * adsr * 0.4 * mzMasterToneBus() * mzMasterPartOr(1.0, 3.0));",
      "lead upper voice",
    ],
    [
      "  fa = 440.0 * pow(2.0, n / 12.0);",
      "  fa = 440.0 * mzMasterTuneRatio() * pow(2.0, n / 12.0);",
      "bass tuning",
    ],
    [
      "  v += vec2<f32>(sin(fa * PI2 * time * 0.125) * 0.55\n    * (1.0 - exp(ttx * ttx * -0.4)));",
      "  v += vec2<f32>(sin(fa * PI2 * time * 0.125) * 0.55\n    * (1.0 - exp(ttx * ttx * -0.4)) * mzMasterBassBus() * mzMasterPartOr(2.0, 3.0));",
      "sub bass bus",
    ],
    [
      "  return v;\n}\n\nfn sourceEcho",
      "  return v * mzMasterPatternGate(time);\n}\n\nfn sourceEcho",
      "pattern gate",
    ],
    [
      "  var v = sourceS(t);",
      "  var v = sourceS(t) * mzMasterPartNot(3.0);",
      "echo dry gate",
    ],
    [
      "  var amplitude = 0.2;",
      "  var amplitude = 0.2 * mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(3.0);",
      "echo bus",
    ],
    [
      "  return sourceEcho(time) * 0.4;",
      "  return mzMasterFinish(sourceEcho(time) * 0.4);",
      "master finish",
    ],
  ]);
}

function adaptIndustry(source) {
  return applyRequiredReplacements(source, "Xd2GW3", [
    [
      "  var h = 0.7;",
      "  var h = 0.7 * mzMasterShapeRatio();",
      "noise shape",
    ],
    [
      "    * exp(-40.0 * max(1.0 - tt, 0.0));",
      "    * exp(-40.0 * max(1.0 - tt, 0.0)) * mzMasterTextureBus() * mzMasterNoiseGain() * mzMasterPartOr(1.0, 6.0);",
      "industrial noise bus",
    ],
    [
      "  h = 0.005;",
      "  h = 0.005 * mzMasterShapeRatio();",
      "engine shape",
    ],
    [
      "  v += ((sourceEngine1(t - h) + sourceEngine1(t + h)) * 0.4\n    + sin(t * 40.0 * PI2) * 0.2)\n    * smoothstep(-0.1, 0.1, sin(t * 10.0)) * 0.5;",
      "  v += ((sourceEngine1(t - h) + sourceEngine1(t + h)) * 0.4\n    + sin(t * 40.0 * PI2 * mzMasterTuneRatio()) * 0.2)\n    * smoothstep(-0.1, 0.1, sin(t * 10.0 * mzMasterMotionRatio()))\n    * 0.5 * mzMasterToneBus() * mzMasterPartOr(2.0, 6.0);",
      "engine sweep bus",
    ],
    [
      "  v += (sourceNse(t * 1000.0 - h) + sourceNse(t * 1000.0 + h)) * sin(t * 20.0);",
      "  v += (sourceNse(t * 1000.0 - h) + sourceNse(t * 1000.0 + h))\n    * sin(t * 20.0 * mzMasterMotionRatio())\n    * mzMasterNoiseGain() * mzMasterBrightnessRatio() * mzMasterPartOr(3.0, 6.0);",
      "noise sweep bus",
    ],
    [
      "  v += sourceWf2(sourcePhase(tt) * 1.0)\n    * exp(-1.0 * max(tt - 2.0, 0.0))\n    * exp(-1.0 * max(1.0 - tt, 0.0)) * 0.5;",
      "  v += sourceWf2(sourcePhase(tt * mzMasterMotionRatio()) * mzMasterTuneRatio())\n    * exp(-1.0 * max(tt - 2.0, 0.0) * mzMasterContourRatio())\n    * exp(-1.0 * max(1.0 - tt, 0.0)) * 0.5 * mzMasterFxBus() * mzMasterPartOr(4.0, 6.0);",
      "effect sweep bus",
    ],
    [
      "  let thump = (sourceNse(phase_value * 200.0) + sin(phase_value * 200.0) * 0.5)",
      "  let thump = (sourceNse(phase_value * 200.0) + sin(phase_value * 200.0 * mzMasterTuneRatio()) * 0.5)",
      "thump tuning",
    ],
    [
      "  v += sourceClamp(-1.0, 1.0, thump) * 0.8;",
      "  v += sourceClamp(-1.0, 1.0, thump) * 0.8 * mzMasterBassBus() * mzMasterPercussionBus() * mzMasterPartOr(5.0, 6.0);",
      "thump bus",
    ],
    [
      "  return v;\n}\n\nfn sourceEcho",
      "  return v * mzMasterPatternGate(t);\n}\n\nfn sourceEcho",
      "pattern gate",
    ],
    [
      "  var v = vec2<f32>(sourceS(t));",
      "  var v = vec2<f32>(sourceS(t)) * mzMasterPartNot(6.0);",
      "echo dry gate",
    ],
    [
      "  var amplitude = 0.5;",
      "  var amplitude = 0.5 * mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(6.0);",
      "echo bus",
    ],
    [
      "  return sourceEcho(time) * 0.35;",
      "  return mzMasterFinish(sourceEcho(time) * 0.35);",
      "master finish",
    ],
  ]);
}

function adaptShift(source) {
  return applyRequiredReplacements(source, "ldlfRS", [
    [
      "    var k = spec(t * 3.0 + h * (0.5 + sin(t) * 0.48));",
      "    var k = spec(t * 3.0 * mzMasterMotionRatio() + h * (0.5 + sin(t) * 0.48));",
      "spectral motion",
    ],
    [
      "  let f = 70.0 * exp2(floorMod(floor(time * 5.0), 2.0)) * bsf(time);",
      "  let f = 70.0 * mzMasterTuneRatio() * exp2(floorMod(floor(time * 5.0), 2.0)) * bsf(time);",
      "spectral tuning",
    ],
    [
      "  var v = vec2<f32>(osc(time, f), osc(time + 0.01, f * 1.001)) * 0.6;",
      "  var v = vec2<f32>(osc(time, f), osc(time + 0.01, f * 1.001))\n    * 0.6 * mzMasterTextureBus() * mzMasterBrightnessRatio() * mzMasterPartOr(1.0, 7.0);",
      "spectral bus",
    ],
    [
      "  let pw = 0.5 + sin(time * 2.0) * 0.4;",
      "  let pw = 0.5 + sin(time * 2.0 * mzMasterMotionRatio()) * 0.4 * mzMasterShapeRatio();",
      "arp shape",
    ],
    [
      "    140.0 * 4.0\n      * exp2(dorian(sin(floor(time * 10.0) * 3.0) * arp_wi) / 12.0),",
      "    140.0 * 4.0 * mzMasterTuneRatio()\n      * exp2(dorian(sin(floor(time * 10.0) * 3.0) * arp_wi) / 12.0),",
      "arp tuning",
    ],
    [
      "  ) * 0.4 * exp(fract(tb * 1.0) * -2.0);",
      "  ) * 0.4 * exp(fract(tb * 1.0) * -2.0 * mzMasterContourRatio())\n    * mzMasterToneBus() * mzMasterPartOr(2.0, 7.0);",
      "arp bus",
    ],
    [
      "  var v = snd(time);",
      "  var v = snd(time) * mzMasterPartNot(7.0);",
      "delay dry gate",
    ],
    [
      "  v += snd(time - 0.5).yx * vec2<f32>(0.5, 0.3);",
      "  v += snd(time - 0.5).yx * vec2<f32>(0.5, 0.3)\n    * mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(7.0);",
      "first delay",
    ],
    [
      "  v += snd(time - 1.0) * vec2<f32>(0.2, 0.25);",
      "  v += snd(time - 1.0) * vec2<f32>(0.2, 0.25)\n    * mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(7.0);",
      "second delay",
    ],
    [
      "  v += vec2<f32>(sin(time * 70.0 * 6.0) * sin(time * 10.0) * 0.05);",
      "  v += vec2<f32>(sin(time * 70.0 * 6.0 * mzMasterTuneRatio())\n    * sin(time * 10.0) * 0.05 * mzMasterBassBus() * mzMasterPart(3.0));",
      "bass bus",
    ],
    [
      "  v += vec2<f32>(sin(100.0 * sqrt(floorMod(time * 10.0 - 1.0, 4.0))) * 0.5);",
      "  v += vec2<f32>(sin(100.0 * mzMasterTuneRatio()\n    * sqrt(floorMod(time * 10.0 - 1.0, 4.0))) * 0.5 * mzMasterPercussionBus() * mzMasterPart(4.0));",
      "kick bus",
    ],
    [
      "  v += vec2<f32>(sin(100.0 * sqrt(floorMod(time * 10.0 - 3.0, 4.0))) * 0.1);",
      "  v += vec2<f32>(sin(100.0 * mzMasterTuneRatio()\n    * sqrt(floorMod(time * 10.0 - 3.0, 4.0))) * 0.1 * mzMasterPercussionBus() * mzMasterPart(4.0));",
      "secondary kick bus",
    ],
    [
      "  v += vec2<f32>(hash(time) * exp(floorMod(time * 10.0 - 3.0, 4.0) * -2.0) * 0.5);",
      "  v += vec2<f32>(hash(time) * exp(floorMod(time * 10.0 - 3.0, 4.0)\n    * -2.0 * mzMasterContourRatio()) * 0.5 * mzMasterNoiseGain() * mzMasterPart(5.0));",
      "noise bus",
    ],
    [
      "      * (0.3 + 0.7 * hash(floor(floorMod(time * 10.0, 8.0)))),",
      "      * (0.3 + 0.7 * hash(floor(floorMod(time * 10.0, 8.0))))\n      * mzMasterNoiseGain() * mzMasterTextureBus() * mzMasterPart(6.0),",
      "noise texture bus",
    ],
    [
      "    leadvoice(time, 35.0 * bsf(time))\n      * 0.7",
      "    leadvoice(time, 35.0 * mzMasterTuneRatio() * bsf(time))\n      * 0.7 * mzMasterBassBus() * mzMasterPart(3.0)",
      "low lead bus",
    ],
    [
      "  return v * 0.75;",
      "  return mzMasterFinish(v * 0.75 * mzMasterPatternGate(time));",
      "master finish",
    ],
  ]);
}

function adaptBoulder(source) {
  return applyRequiredReplacements(source, "4tsGD8", [
    [
      "  let time = source_time + sin(source_time * 40.0) * 0.0001;",
      "  let time = source_time + sin(source_time * 40.0 * mzMasterMotionRatio())\n    * 0.0001 * mzMasterMotionRatio();",
      "micro-vibrato motion",
    ],
    [
      "  let phs = c0(songtime * 3.0 * ts) / ts;",
      "  let phs = c0(songtime * 3.0 * ts) * mzMasterTuneRatio() / ts;",
      "score tuning",
    ],
    [
      "  var v = osc(phs.x);",
      "  var v = osc(phs.x) * mzMasterToneBus() * mzMasterPartOr(1.0, 5.0);",
      "score left bus",
    ],
    [
      "  v += osc(phs.y);",
      "  v += osc(phs.y) * mzMasterToneBus() * mzMasterPartOr(2.0, 5.0);",
      "score right bus",
    ],
    [
      "  v *= sourceSmoothstep(0.0, 0.007, nt)\n    * sourceSmoothstep(1.0, 0.3, nt) * 0.5 + 0.5;",
      "  v *= sourceSmoothstep(0.0, 0.007, nt)\n    * sourceSmoothstep(1.0, 0.3, nt * mzMasterContourRatio()) * 0.5 + 0.5;",
      "score contour",
    ],
    [
      "  let beep_frequency = mix(\n    1560.8,\n    3543.1,",
      "  let beep_frequency = mzMasterTuneRatio() * mzMasterBrightnessRatio() * mix(\n    1560.8,\n    3543.1,",
      "beep tuning",
    ],
    [
      "  let beep = osc(beep_frequency * songtime) * 0.8;",
      "  let beep = osc(beep_frequency * songtime) * 0.8 * mzMasterPercussionBus() * mzMasterPartOr(3.0, 5.0);",
      "beep percussion bus",
    ],
    [
      "      * clamp(pow(d_n * 1.2, 30.0), 0.0, 1.0) * 0.1,",
      "      * clamp(pow(d_n * 1.2, 30.0), 0.0, 1.0) * 0.1\n      * mzMasterNoiseGain() * mzMasterTextureBus() * mzMasterPartOr(4.0, 5.0),",
      "noise swell bus",
    ],
    [
      "  v += vec2<f32>(hsh(time) * (0.005 + pow(d_n, 20.0) * 0.5));",
      "  v += vec2<f32>(hsh(time) * (0.005 + pow(d_n, 20.0) * 0.5)\n    * mzMasterNoiseGain() * mzMasterTextureBus() * mzMasterPartOr(4.0, 5.0));",
      "noise bed bus",
    ],
    [
      "  var v = s(time);\n  v += s(time - 0.02) * 0.4;\n  v += s(time - 0.04) * 0.25;\n  v += s(time - 0.06) * 0.2;\n  return v * 0.6;",
      "  var v = s(time) * mzMasterPartNot(5.0);\n  let smear = mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(5.0);\n  v += s(time - 0.02) * 0.4 * smear;\n  v += s(time - 0.04) * 0.25 * smear;\n  v += s(time - 0.06) * 0.2 * smear;\n  return mzMasterFinish(v * 0.6 * mzMasterPatternGate(time));",
      "smear and master finish",
    ],
  ]);
}

function adaptNoiseBands(source) {
  return applyRequiredReplacements(source, "lldGDM", [
    [
      "  var spd = 0.2;",
      "  var spd = 0.2 * mzMasterMotionRatio();",
      "seed morph motion",
    ],
    [
      "    f *= fmul;",
      "    f *= fmul * mzMasterTuneRatio() * mzMasterBrightnessRatio();",
      "metal tuning",
    ],
    [
      "  let lp = 0.002;",
      "  let lp = 0.002 / mzMasterBrightnessRatio();",
      "metal brightness",
    ],
    [
      "  var v = mix(\n    metal(time, sd, 0.1, lp),\n    metal(time, sd + 100.0, 0.1, lp),\n    vec2<f32>(blend),\n  );",
      "  let motion_time = time * mzMasterMotionRatio();\n  var v = mix(\n    metal(motion_time, sd, 0.1, lp),\n    metal(motion_time, sd + 100.0, 0.1, lp),\n    vec2<f32>(blend),\n  ) * mzMasterTextureBus() * mzMasterPart(1.0);",
      "metal texture bus",
    ],
    [
      "    * sin(time * 13000.0)",
      "    * sin(time * 13000.0 * mzMasterTuneRatio())\n    * mzMasterPart(2.0)",
      "bleep tuning",
    ],
    [
      "  var w = sin(tm * 400.0 * exp(tm * -0.5)) * exp(tm * -10.0);",
      "  var w = sin(tm * 400.0 * mzMasterTuneRatio() * exp(tm * -0.5))\n    * exp(tm * -10.0 * mzMasterContourRatio());",
      "kick body",
    ],
    [
      "  w += sin(tm * 1000.0 * exp(tm * -0.4)) * exp(tm * -100.0);",
      "  w += sin(tm * 1000.0 * mzMasterTuneRatio() * exp(tm * -0.4))\n    * exp(tm * -100.0 * mzMasterContourRatio());",
      "kick click",
    ],
    [
      "  w = clamp(w, -0.4, 0.4);",
      "  w = clamp(w, -0.4, 0.4) * mzMasterPercussionBus() * mzMasterBassBus() * mzMasterPart(3.0);",
      "kick bus",
    ],
    [
      "  w += hsh(fract(time)) * exp(tm * -40.0) * 0.3 * mhats;",
      "  w += hsh(fract(time * mzMasterMotionRatio())) * exp(tm * -40.0) * 0.3 * mhats\n    * mzMasterPercussionBus() * mzMasterNoiseGain() * mzMasterPart(4.0);",
      "hat one",
    ],
    [
      "  w += hsh(fract(time)) * exp(tm * -40.0) * 0.05 * mhats;",
      "  w += hsh(fract(time * mzMasterMotionRatio())) * exp(tm * -40.0) * 0.05 * mhats\n    * mzMasterPercussionBus() * mzMasterNoiseGain() * mzMasterPart(4.0);",
      "hat two",
    ],
    [
      "  w += hsh(fract(time)) * exp(tm * -40.0) * 0.03 * mhats;",
      "  w += hsh(fract(time * mzMasterMotionRatio())) * exp(tm * -40.0) * 0.03 * mhats\n    * mzMasterPercussionBus() * mzMasterNoiseGain() * mzMasterPart(4.0);",
      "hat three",
    ],
    [
      "  v += vec2<f32>(hsh(fract(time)) * exp(tm * -5.0) * 0.03 * mhats);",
      "  v += vec2<f32>(hsh(fract(time * mzMasterMotionRatio())) * exp(tm * -5.0) * 0.03 * mhats\n    * mzMasterPercussionBus() * mzMasterNoiseGain() * mzMasterPart(4.0));",
      "hat accent",
    ],
    [
      "    * 0.1 * exp(fract(tm) * -2.0) * 0.5;",
      "    * 0.1 * exp(fract(tm) * -2.0) * 0.5\n    * mzMasterPercussionBus() * mzMasterTextureBus() * mzMasterPart(5.0);",
      "metal hit one",
    ],
    [
      "    * 0.1 * exp(fract(-tm) * -2.0) * 0.5;",
      "    * 0.1 * exp(fract(-tm) * -2.0) * 0.5\n    * mzMasterPercussionBus() * mzMasterTextureBus() * mzMasterPart(5.0);",
      "metal hit two",
    ],
    [
      "  v += (\n    vec2<f32>(echo(time))\n      + echo(time - et) * vec2<f32>(0.5, 0.3)\n      + echo(time - et * 2.0) * vec2<f32>(0.10, 0.25)\n  ) * 0.05 * sourceSmoothstep(15.99, 16.0, time * tempo);",
      "  v += (\n    vec2<f32>(echo(time))\n      + echo(time - et) * vec2<f32>(0.5, 0.3)\n      + echo(time - et * 2.0) * vec2<f32>(0.10, 0.25)\n  ) * 0.05 * sourceSmoothstep(15.99, 16.0, time * tempo)\n    * mzMasterToneBus() * mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(6.0);",
      "bleep echo bus",
    ],
    [
      "    1.0 - exp(tmk * -9.0) * 2.0 * sourceSmoothstep(0.0, 0.005, tmk),",
      "    1.0 - exp(tmk * -9.0) * 2.0 * mzMasterContourRatio()\n      * sourceSmoothstep(0.0, 0.005, tmk),",
      "duck contour",
    ],
    [
      "  v = (vec2<f32>(1.0) - exp(abs(v) * -1.5)) * sign(v);\n  return v;\n}",
      "  v = (vec2<f32>(1.0) - exp(abs(v) * -1.5)) * sign(v);\n  return mzMasterFinish(v * mzMasterPatternGate(time));\n}",
      "master finish",
    ],
  ]);
}

function adaptGravity(source) {
  return applyRequiredReplacements(source, "ltKSRc", [
    [
      "      exp2(rnd.y * 0.1 + 8.0)",
      "      exp2(rnd.y * 0.1 + 8.0) * mzMasterTuneRatio()",
      "cloud tuning",
    ],
    [
      "    frequency = frequency * frequency_multiplier;",
      "    frequency = frequency * frequency_multiplier * mzMasterTuneRatio()\n      * mzMasterBrightnessRatio();",
      "metal tuning",
    ],
    [
      "  let frequency = 80.0;",
      "  let frequency = 80.0 * mzMasterMotionRatio();",
      "spark motion",
    ],
    [
      "  let effect = sourceWaveform2(sourcePhase(shifted_time)) *",
      "  let effect = sourceWaveform2(sourcePhase(shifted_time) * mzMasterTuneRatio()) *",
      "effect tuning",
    ],
    [
      "  var time = sourcePhase2(source_time);",
      "  var time = sourcePhase2(source_time * mzMasterMotionRatio());",
      "cloud motion",
    ],
    [
      "  var v = sourceSparks(time) * 0.05;",
      "  var v = sourceSparks(time) * 0.05 * mzMasterPercussionBus()\n    * mzMasterNoiseGain() * mzMasterPatternGate(source_time) * mzMasterPart(3.0);",
      "spark bus",
    ],
    [
      "    sourceS2(time) * 0.5 * 0.9 +\n    sourceMetal(time, 1.0, 0.1, 0.0) * 0.2\n  ) * 0.5;",
      "    sourceS2(time) * 0.5 * 0.9 * mzMasterToneBus() * mzMasterPart(1.0) +\n    sourceMetal(time, 1.0, 0.1, 0.0) * 0.2 * mzMasterTextureBus() * mzMasterPart(2.0)\n  ) * 0.5;",
      "cloud and metal buses",
    ],
    [
      "  v = v + sourceSoundEffect(original_time) * 0.4;",
      "  v = v + sourceSoundEffect(original_time) * 0.4\n    * mzMasterFxBus() * mzMasterSpaceGain() * mzMasterPart(4.0);",
      "effect bus",
    ],
    [
      "  return mix(\n    v,\n    thunder * 2.0,\n    vec2<f32>(sqrt(thunder_envelope) * 0.5)\n  ) * 1.3;",
      "  let thunder_mix = thunder * 2.0 * mzMasterBassBus()\n    * mzMasterPercussionBus() * mzMasterNoiseGain() * mzMasterPart(5.0);\n  return mzMasterFinish(mix(\n    v,\n    thunder_mix,\n    vec2<f32>(sqrt(thunder_envelope) * 0.5 * mzMasterContourRatio())\n  ) * 1.3);",
      "thunder bus and master finish",
    ],
  ]);
}

function adaptDnb(source) {
  return applyRequiredReplacements(source, "4tdSDB", [
    [
      "      -time * decay * (1.0 - exp(-frequency * 100.0))",
      "      -time * decay * mzMasterContourRatio()\n        * (1.0 - exp(-frequency * 100.0))",
      "metal contour",
    ],
    [
      "      min(exp(t * -10.0) * 2.0, 1.0) *",
      "      min(exp(t * -10.0 * mzMasterContourRatio()) * 2.0, 1.0) *",
      "kick contour",
    ],
    [
      "    frequency = frequency * frequency_multiplier;",
      "    frequency = frequency * frequency_multiplier * mzMasterTuneRatio()\n      * mzMasterBrightnessRatio();",
      "metal tuning",
    ],
    [
      "  var t = source_t * 100.0;",
      "  var t = source_t * 100.0 * mzMasterTuneRatio();",
      "pad tuning",
    ],
    [
      "  var v = vec2<f32>(kick_noise) * 0.5;",
      "  var v = vec2<f32>(kick_noise) * 0.5 * mzMasterPercussionBus()\n    * mzMasterBassBus() * mzMasterNoiseGain() * mzMasterPatternGate(time) * mzMasterPart(1.0);",
      "kick bus",
    ],
    [
      "  v = v + sourceMetal(t, 35.0, 2.0, 0.0, 2.0) * 0.05;",
      "  v = v + sourceMetal(t, 35.0, 2.0, 0.0, 2.0) * 0.05\n    * mzMasterPercussionBus() * mzMasterTextureBus() * mzMasterPart(2.0);",
      "metal bus",
    ],
    [
      "  v = v + sourceMetal(t, 35.0, 1.0, 0.0, 2.0) * 0.04 *",
      "  v = v + sourceMetal(t, 35.0, 1.0, 0.0, 2.0) * 0.04\n    * mzMasterPercussionBus() * mzMasterTextureBus() * mzMasterPart(2.0) *",
      "late metal bus",
    ],
    [
      "  t = floorMod(time * SOURCE_TEMPO, 0.25) / SOURCE_TEMPO;\n  v = v + sourceMetal(t, 500.0, 10.0, 0.0, 20.0) * 0.1;",
      "  t = floorMod(time * SOURCE_TEMPO, 0.25) / SOURCE_TEMPO;\n  v = v + sourceMetal(t, 500.0, 10.0, 0.0, 20.0) * 0.1\n    * mzMasterPercussionBus() * mzMasterNoiseGain() * mzMasterPart(3.0);",
      "closed hat bus",
    ],
    [
      "  t = floorMod(time * SOURCE_TEMPO, 2.0) / SOURCE_TEMPO;\n  v = v + sourceMetal(t, 500.0, 10.0, 0.0, 20.0) * 0.1;",
      "  t = floorMod(time * SOURCE_TEMPO, 2.0) / SOURCE_TEMPO;\n  v = v + sourceMetal(t, 500.0, 10.0, 0.0, 20.0) * 0.1\n    * mzMasterPercussionBus() * mzMasterNoiseGain() * mzMasterPart(3.0);",
      "open hat bus",
    ],
    [
      "  v = v + w * (\n    max(exp(-fract(t * 20.0)), min(t * 9.0, 1.0)) +",
      "  v = v + w * mzMasterTextureBus() * mzMasterNoiseGain() * mzMasterPart(4.0) * (\n    max(exp(-fract(t * 20.0 * mzMasterMotionRatio())), min(t * 9.0, 1.0)) +",
      "sweep bus",
    ],
    [
      "  w = sourceMetal(t, 400.0, 1.0, 0.0, 0.5) * 0.2;",
      "  w = sourceMetal(t, 400.0, 1.0, 0.0, 0.5) * 0.2\n    * mzMasterTextureBus() * mzMasterFxBus() * mzMasterPart(7.0);",
      "riser bus",
    ],
    [
      "  let bass = sin(300.0 * (t - t * t * 0.3)) *",
      "  let bass = sin(300.0 * mzMasterTuneRatio() * (t - t * t * 0.3)) *",
      "bass tuning",
    ],
    [
      "  v = v + vec2<f32>(bass) * 0.2;",
      "  v = v + vec2<f32>(bass) * 0.2 * mzMasterBassBus() * mzMasterToneBus() * mzMasterPart(5.0);",
      "bass bus",
    ],
    [
      "  ) * 0.05;",
      "  ) * 0.05 * mzMasterToneBus() * mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(6.0);",
      "pad echo bus",
    ],
    [
      "  v = v * 4.0;\n  return v;\n}",
      "  v = v * 4.0;\n  return mzMasterFinish(v);\n}",
      "master finish",
    ],
  ]);
}

function adaptCipher(source) {
  return applyRequiredReplacements(source, "MslBR4", [
    [
      "fn sourcePadVoice(time: f32, frequency: f32) -> f32 {\n  return (\n    sin(time * frequency * 2000.0) +\n    sin(time * frequency * 4000.0) +\n    sin(time * frequency * 2000.0 * exp2(17.0 / 12.0)) * 0.5\n  ) * (sin(time * frequency * 40.0) * 0.3 + 0.5);\n}",
      "fn sourcePadVoice(time: f32, frequency: f32) -> f32 {\n  let tuned_frequency = frequency * mzMasterTuneRatio();\n  return (\n    sin(time * tuned_frequency * 2000.0) +\n    sin(time * tuned_frequency * 4000.0) +\n    sin(time * tuned_frequency * 2000.0 * exp2(17.0 / 12.0))\n      * 0.5 * mzMasterBrightnessRatio()\n  ) * (sin(time * tuned_frequency * 40.0 * mzMasterMotionRatio()) * 0.3 + 0.5);\n}",
      "pad controls",
    ],
    [
      "fn sourceLeadVoice(time: f32, frequency: f32) -> f32 {\n  let x = fract(time * frequency * 500.0 / SOURCE_PI);\n  let smoothing = 0.01;\n  let pulse_width = 0.5 + sin(time) * 0.4;",
      "fn sourceLeadVoice(time: f32, frequency: f32) -> f32 {\n  let x = fract(time * frequency * mzMasterTuneRatio() * 500.0 / SOURCE_PI);\n  let smoothing = 0.01 * mzMasterShapeRatio();\n  let pulse_width = 0.5 + sin(time * mzMasterMotionRatio()) * 0.4;",
      "lead controls",
    ],
    [
      "    2000.0 * exp2(sourceLydian(random_note) / 12.0) * time",
      "    2000.0 * mzMasterTuneRatio() * exp2(sourceLydian(random_note) / 12.0) * time",
      "upper tone tuning one",
    ],
    [
      "    2000.0 * exp2(sourceLydian(random_note + 4.0) / 12.0) * time",
      "    2000.0 * mzMasterTuneRatio() * exp2(sourceLydian(random_note + 4.0) / 12.0) * time",
      "upper tone tuning two",
    ],
    [
      "    250.0 * exp2(sourceLydian(root_note) / 12.0) * time",
      "    250.0 * mzMasterTuneRatio() * exp2(sourceLydian(root_note) / 12.0) * time",
      "root tuning one",
    ],
    [
      "    500.0 * exp2(sourceLydian(root_note) / 12.0) * time",
      "    500.0 * mzMasterTuneRatio() * exp2(sourceLydian(root_note) / 12.0) * time",
      "root tuning two",
    ],
    [
      "  v = v + w;\n\n  w = 0.0;",
      "  v = v + w * mzMasterPartOr(1.0, 5.0);\n\n  w = 0.0;",
      "Lydian dyad part",
    ],
    [
      "  w = w + sin(\n    250.0 * mzMasterTuneRatio() * exp2(sourceLydian(root_note) / 12.0) * time\n  );",
      "  w = w + sin(\n    250.0 * mzMasterTuneRatio() * exp2(sourceLydian(root_note) / 12.0) * time\n  ) * mzMasterPartOr(2.0, 5.0);",
      "root bass one part",
    ],
    [
      "  w = w + sin(\n    500.0 * mzMasterTuneRatio() * exp2(sourceLydian(root_note) / 12.0) * time\n  );",
      "  w = w + sin(\n    500.0 * mzMasterTuneRatio() * exp2(sourceLydian(root_note) / 12.0) * time\n  ) * mzMasterPartOr(2.0, 5.0);",
      "root bass two part",
    ],
    [
      "  w = w + sourcePadVoice(\n    time,\n    exp2(sourceLydian(root_note) / 12.0)\n  );",
      "  w = w + sourcePadVoice(\n    time,\n    exp2(sourceLydian(root_note) / 12.0)\n  ) * mzMasterPartOr(3.0, 5.0);",
      "chord pad root part",
    ],
    [
      "  w = w + sourcePadVoice(\n    time,\n    exp2(sourceLydian(root_note + 4.0) / 12.0)\n  );",
      "  w = w + sourcePadVoice(\n    time,\n    exp2(sourceLydian(root_note + 4.0) / 12.0)\n  ) * mzMasterPartOr(3.0, 5.0);",
      "chord pad fourth part",
    ],
    [
      "  w = w + sourcePadVoice(\n    time,\n    exp2(sourceLydian(root_note + 7.0) / 12.0)\n  );",
      "  w = w + sourcePadVoice(\n    time,\n    exp2(sourceLydian(root_note + 7.0) / 12.0)\n  ) * mzMasterPartOr(3.0, 5.0);",
      "chord pad seventh part",
    ],
    [
      "  v = v + sourceLeadVoice(\n    time,\n    exp2(sourceLydian(random_note) / 12.0)\n  ) * sourceStep(\n    64.0,\n    floorMod(time * SOURCE_TEMPO, 128.0)\n  ) * 0.8;",
      "  v = v + sourceLeadVoice(\n    time,\n    exp2(sourceLydian(random_note) / 12.0)\n  ) * sourceStep(\n    64.0,\n    floorMod(time * SOURCE_TEMPO, 128.0)\n  ) * 0.8 * mzMasterPartOr(4.0, 5.0);",
      "PWM lead part",
    ],
    [
      "  return v;\n}\n\nfn sourceMainSound",
      "  return v * mzMasterToneBus() * mzMasterPatternGate(time);\n}\n\nfn sourceMainSound",
      "tonal bus and pattern gate",
    ],
    [
      "  v = v + vec2<f32>(sourceVoice1(time));",
      "  v = v + vec2<f32>(sourceVoice1(time)) * mzMasterPartNot(5.0);",
      "tonal dry gate",
    ],
    [
      "    ) * exp(f32(i) * -0.4) * pan.x;",
      "    ) * exp(f32(i) * -0.4 * mzMasterContourRatio()) * pan.x\n      * mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(5.0);",
      "left delay bus",
    ],
    [
      "    ) * exp(f32(i) * -0.4) * pan.y;",
      "    ) * exp(f32(i) * -0.4 * mzMasterContourRatio()) * pan.y\n      * mzMasterSpaceGain() * mzMasterFxBus() * mzMasterPart(5.0);",
      "right delay bus",
    ],
    [
      "  v = v + vec2<f32>(noise_1);",
      "  v = v + vec2<f32>(noise_1 * mzMasterNoiseGain() * mzMasterTextureBus() * mzMasterPart(6.0));",
      "noise bus",
    ],
    [
      "    v * (1.0 - exp(time_beat * -1.0) * 0.8),",
      "    v * (1.0 - exp(time_beat * -1.0 * mzMasterContourRatio()) * 0.8),",
      "drum duck contour",
    ],
    [
      "    exp(time_beat * -0.5) *\n    drum_mix\n  );",
      "    exp(time_beat * -0.5) *\n    drum_mix * mzMasterPercussionBus() * mzMasterBassBus() * mzMasterPart(7.0)\n  );",
      "kick bus",
    ],
    [
      "      0.5 *\n      drum_mix;",
      "      0.5 *\n      drum_mix * mzMasterPercussionBus() * mzMasterNoiseGain() * mzMasterPart(8.0);",
      "snare bus",
    ],
    [
      "    0.2 *\n    drum_mix",
      "    0.2 *\n    drum_mix * mzMasterPercussionBus() * mzMasterPart(9.0)",
      "drum tone bus",
    ],
    [
      "  return v * 0.25;",
      "  return mzMasterFinish(v * 0.25);",
      "master finish",
    ],
  ]);
}

const ADAPTERS = Object.freeze({
  XdSGz1: adaptNoir,
  Xd2GW3: adaptIndustry,
  ldlfRS: adaptShift,
  "4tsGD8": adaptBoulder,
  lldGDM: adaptNoiseBands,
  ltKSRc: adaptGravity,
  "4tdSDB": adaptDnb,
  MslBR4: adaptCipher,
});

export function makeSrtussMasterWgsl(project) {
  const projectId = String(project?.id ?? "");
  if (!SUPPORTED_PROJECT_IDS.has(projectId)) return null;
  if (typeof project?.wgsl !== "string" || !project.wgsl.trim()) {
    throw new Error("srtuss master adapter requires WGSL for " + projectId);
  }

  const exactWgsl = project.wgsl;
  let expressiveWgsl = extendMasterUniform(exactWgsl, projectId);
  expressiveWgsl = ADAPTERS[projectId](expressiveWgsl);

  const attribution = [
    "// Morphazoid expressive master adaptation for " + projectId + ".",
    "// The exact project WGSL is retained separately and is not modified here.",
    "// Original by srtuss; adaptation remains CC BY-NC-SA 3.0.",
    "// https://creativecommons.org/licenses/by-nc-sa/3.0/",
    "",
  ].join("\n");
  return attribution + expressiveWgsl;
}

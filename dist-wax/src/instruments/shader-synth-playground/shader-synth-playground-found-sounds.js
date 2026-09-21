const freeze = (value) => Object.freeze(value);

function port(id, label, type, options = {}) {
  return freeze({
    id,
    label,
    type,
    types: freeze([...(options.types ?? [type])]),
    required: Boolean(options.required),
    component: options.component ?? null,
  });
}

function parameter(id, label, minimum, maximum, defaultValue, options = {}) {
  return freeze({
    id,
    label,
    min: minimum,
    max: maximum,
    default: defaultValue,
    step: options.step ?? (maximum - minimum) / 100,
    unit: options.unit ?? "",
    scale: options.scale ?? "linear",
    options: options.options ? freeze([...options.options]) : null,
    low: options.low ?? "less",
    high: options.high ?? "more",
    behavior: options.behavior ?? "Changes the source response.",
  });
}

function source(spec) {
  return freeze({
    ...spec,
    aliases: freeze([...(spec.aliases ?? [])]),
    tags: freeze([...(spec.tags ?? [])]),
    inputs: freeze([...(spec.inputs ?? [])]),
    outputs: freeze([...(spec.outputs ?? [])]),
    params: freeze([...(spec.params ?? [])]),
    faust: spec.faust ? freeze({ ...spec.faust }) : null,
  });
}

const STEREO_OUTPUT = freeze([
  port("out", "stereo", "stereo"),
]);

// Each source packs its first four parameters into p0 and its remaining four
// into p1. The fragments below are intentionally binding-free and assume the
// host sample shader already defines PI, TAU, SAMPLE_RATE, hashU32, softClip,
// and phaseAtSample.
export const SHADER_SYNTH_PLAYGROUND_FOUND_MODULES = freeze([
  source({
    id: "shepard-risset-spiral",
    kind: 57,
    name: "Shepard / Risset Spiral",
    aliases: ["shepard tone", "risset glissando", "endless gliss", "sonic barber pole"],
    tags: ["shepard", "risset", "spiral", "glissando", "octave illusion", "psychoacoustic"],
    category: "source",
    color: "#74f7ff",
    description: "Layers octave-related oscillators under a sliding cosine envelope so the pitch appears to rise or fall continuously without leaving its register.",
    execution: "Single-sample · 3–10 bounded octave layers",
    wgsl: "layerHz = baseHz * exp2(layer - center + glide); layer *= octaveWindow;",
    auditionKind: "source",
    auditionPreset: null,
    inputs: [],
    outputs: STEREO_OUTPUT,
    params: [
      parameter("frequency", "Center pitch", 20, 880, 82.41, { step: 0.01, unit: "Hz", scale: "log", low: "subterranean", high: "bright", behavior: "Sets the log-frequency center around which octave layers fade in and out." }),
      parameter("glide", "Gliss rate", -2, 2, 0.16, { step: 0.01, unit: "oct/s", low: "falling", high: "rising", behavior: "Sets the direction and speed of the endlessly wrapping octave glide; zero holds one spiral position." }),
      parameter("layers", "Octave layers", 3, 10, 7, { step: 1, low: "lean", high: "seamless", behavior: "Raises the number of octave-related voices available to hide each wrap." }),
      parameter("focus", "Octave focus", 0.35, 4, 1.45, { step: 0.01, low: "broad blend", high: "narrow band", behavior: "Shapes the cosine amplitude window across the stacked octaves." }),
      parameter("color", "Harmonic color", 0, 1, 0.18, { step: 0.01, low: "pure sine", high: "brighter", behavior: "Adds a Nyquist-faded second harmonic without breaking octave equivalence." }),
      parameter("stereo", "Stereo spiral", 0, 1, 0.72, { step: 0.01, low: "centered", high: "wide", behavior: "Places neighboring octave layers at different deterministic stereo positions." }),
      parameter("rotation", "Image rotation", 0, 1, 0.2, { step: 0.01, low: "still field", high: "orbiting", behavior: "Rotates the stereo positions slowly while the pitch spiral moves independently." }),
      parameter("level", "Level", 0, 1, 0.52, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the energy-normalized spiral into a soft output ceiling." }),
    ],
    faust: { symbol: "os.osc", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  source({
    id: "procedural-bird-flock",
    kind: 58,
    name: "Procedural Bird Flock",
    aliases: ["birdsong", "bird chirps", "digital aviary", "procedural flock"],
    tags: ["bird", "flock", "chirp", "trill", "procedural", "nature", "shadertoy-inspired"],
    category: "source",
    color: "#74f7ff",
    description: "Schedules deterministic clusters of short analytic chirps, trills, and airy calls across independently offset stereo positions.",
    execution: "Single-sample · 2–8 bounded deterministic call lanes",
    wgsl: "call = chirp(startHz, endHz, age) * trill(age) * birdWindow(age);",
    auditionKind: "source",
    auditionPreset: null,
    inputs: [],
    outputs: STEREO_OUTPUT,
    params: [
      parameter("rate", "Cluster rate", 0.1, 12, 2.4, { step: 0.01, unit: "Hz", scale: "log", low: "occasional calls", high: "busy canopy", behavior: "Sets how often another bounded flock cluster begins." }),
      parameter("birds", "Birds", 2, 8, 5, { step: 1, low: "pair", high: "flock", behavior: "Raises the number of independently timed chirp lanes evaluated per sample." }),
      parameter("frequency", "Call center", 500, 8000, 2450, { step: 1, unit: "Hz", scale: "log", low: "large bird", high: "tiny bird", behavior: "Sets the central frequency around which deterministic calls are distributed." }),
      parameter("range", "Pitch range", 0, 36, 15, { step: 0.1, unit: "st", low: "unison", high: "varied species", behavior: "Widens the seeded start pitches and within-call chirp bends." }),
      parameter("length", "Call length", 0.025, 0.8, 0.19, { step: 0.001, unit: "s", scale: "log", low: "ticks", high: "phrases", behavior: "Sets the requested call duration, safely shortened when clusters overlap." }),
      parameter("trill", "Trill rate", 3, 90, 24, { step: 0.1, unit: "Hz", scale: "log", low: "slow warble", high: "rapid trill", behavior: "Sets the phase flutter within every chirp." }),
      parameter("spread", "Flock width", 0, 1, 0.9, { step: 0.01, low: "centered", high: "wide canopy", behavior: "Scales each bird's deterministic equal-power stereo position." }),
      parameter("level", "Level", 0, 1, 0.42, { step: 0.01, low: "distant", high: "near", behavior: "Scales the activity-normalized flock into a soft output ceiling." }),
    ],
    faust: { symbol: "os.osc", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  source({
    id: "thunder-impact-cell",
    kind: 59,
    name: "Thunder / Impact Cell",
    aliases: ["thunder", "impact", "cinematic hit", "procedural boom"],
    tags: ["thunder", "impact", "click", "body", "rumble", "noise", "multi-timescale"],
    category: "source",
    color: "#ff6eaa",
    description: "Combines an immediate crack, an analytically falling resonant body, and several deterministic low-rate noise bands into a repeating impact cell.",
    execution: "Single-sample · bounded click, body, and rumble layers",
    wgsl: "impact = crack(age) + fallingBody(age) + lowRateNoise(age) * rumbleTail;",
    auditionKind: "source",
    auditionPreset: null,
    inputs: [],
    outputs: STEREO_OUTPUT,
    params: [
      parameter("rate", "Impact rate", 0.05, 8, 0.42, { step: 0.01, unit: "Hz", scale: "log", low: "rare thunder", high: "impact roll", behavior: "Sets how often the deterministic event cell restarts." }),
      parameter("frequency", "Body pitch", 20, 240, 54, { step: 0.1, unit: "Hz", scale: "log", low: "deep", high: "compact", behavior: "Sets the resting resonance beneath the initial pitch fall." }),
      parameter("decay", "Rumble decay", 0.12, 8, 2.7, { step: 0.01, unit: "s", scale: "log", low: "short hit", high: "long thunder", behavior: "Sets the exponential tail of the low body and noise rumble." }),
      parameter("bend", "Body drop", 0, 4, 1.65, { step: 0.01, unit: "oct", low: "steady", high: "steep fall", behavior: "Raises the impact's starting resonance before it falls analytically toward the body pitch." }),
      parameter("crack", "Crack", 0, 1, 0.76, { step: 0.01, low: "soft onset", high: "sharp strike", behavior: "Scales the fast broadband click and its short high resonant edge." }),
      parameter("rumble", "Rumble", 0, 1, 0.84, { step: 0.01, low: "tonal body", high: "noisy tail", behavior: "Scales three decorrelated low-rate noise bands beneath the impact body." }),
      parameter("stereo", "Storm width", 0, 1, 0.74, { step: 0.01, low: "centered", high: "wide", behavior: "Moves each event to a deterministic stereo position and decorrelates its rumble." }),
      parameter("level", "Level", 0, 1, 0.5, { step: 0.01, low: "distant", high: "massive", behavior: "Scales the normalized multi-timescale event into a soft output ceiling." }),
    ],
    faust: { symbol: "no.noise + os.osc", url: "https://faustlibraries.grame.fr/libs/noises/" },
  }),
]);

export const SHADER_SYNTH_PLAYGROUND_FOUND_HELPERS = /* wgsl */ `
const FOUND_MAX_SHEPARD_LAYERS: u32 = 10u;
const FOUND_MAX_BIRDS: u32 = 8u;
const FOUND_LN_2: f32 = 0.6931471805599453;

fn foundSmooth01(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

fn foundNyquistFade(frequency: f32) -> f32 {
  return 1.0 - smoothstep(SAMPLE_RATE * 0.36, SAMPLE_RATE * 0.47, abs(frequency));
}

fn foundValueNoise(sampleIndex: u32, rate: f32, seed: u32) -> f32 {
  let boundedRate = clamp(rate, 0.01, SAMPLE_RATE * 0.45);
  let periodSamples = max(u32(round(SAMPLE_RATE / boundedRate)), 1u);
  let cell = sampleIndex / periodSamples;
  let cellSample = sampleIndex % periodSamples;
  let position = f32(cellSample) / f32(periodSamples);
  let a = hashU32(cell + seed * 1664525u) * 2.0 - 1.0;
  let b = hashU32(cell + seed * 1664525u + 1013904223u) * 2.0 - 1.0;
  return mix(a, b, foundSmooth01(position));
}

fn foundShepardRisset(sampleIndex: u32, p0: vec4<f32>, p1: vec4<f32>) -> vec2<f32> {
  let baseHz = clamp(p0.x * exp2(render_info.performancePitch / 12.0), 20.0, SAMPLE_RATE * 0.45);
  let glideRate = clamp(p0.y, -2.0, 2.0);
  let layerCount = u32(clamp(round(p0.z), 3.0, f32(FOUND_MAX_SHEPARD_LAYERS)));
  let focus = clamp(p0.w, 0.35, 4.0);
  let color = clamp(p1.x, 0.0, 1.0);
  let stereo = clamp(p1.y, 0.0, 1.0);
  let rotationRate = clamp(p1.z, 0.0, 1.0) * 0.22;
  let level = clamp(p1.w, 0.0, 1.0);
  let glide = fract(f32(sampleIndex) / SAMPLE_RATE * glideRate);
  let center = (f32(layerCount) - 1.0) * 0.5;
  let halfSpan = max(f32(layerCount) * 0.5, 1.0);
  let rotation = phaseAtSample(sampleIndex, rotationRate);
  var voice = vec2<f32>(0.0);
  var energy = 0.0;
  for (var layer = 0u; layer < FOUND_MAX_SHEPARD_LAYERS; layer += 1u) {
    if (layer >= layerCount) { break; }
    let octaveOffset = f32(layer) - center + glide - 0.5;
    let frequency = baseHz * exp2(octaveOffset);
    let normalizedOffset = clamp(octaveOffset / halfSpan, -1.0, 1.0);
    let window = pow(max(cos(normalizedOffset * PI * 0.5), 0.0), focus);
    let fundamentalFade = foundNyquistFade(frequency);
    let secondFade = foundNyquistFade(frequency * 2.0);
    // frequency / (rate * ln(2)) is the closed-form phase of an
    // exponential chirp because its derivative is the instantaneous
    // frequency. It also gives neighboring octave lanes identical phase at
    // the wrap, so a fading lane can hand the trajectory to its neighbor
    // without a reset click.
    var fundamentalPhase = phaseAtSample(sampleIndex, frequency);
    if (abs(glideRate) > 0.0001) {
      fundamentalPhase = fract(frequency / (glideRate * FOUND_LN_2));
    }
    let fundamental = sin(TAU * fundamentalPhase) * fundamentalFade;
    let second = sin(TAU * fract(fundamentalPhase * 2.0) + 0.17) * secondFade;
    let tone = fundamental + second * color * 0.34;
    // Tie image position to the continuous log-frequency trajectory instead
    // of the array row, which also prevents a stereo jump at octave wraps.
    let pan = sin(TAU * (octaveOffset / f32(layerCount) + rotation)) * stereo;
    let panAngle = (pan + 1.0) * PI * 0.25;
    let amplitude = window * (0.55 + 0.45 * fundamentalFade);
    voice += vec2<f32>(cos(panAngle), sin(panAngle)) * tone * amplitude;
    energy += amplitude * amplitude * (1.0 + color * color * 0.1156);
  }
  let normalized = voice / max(sqrt(energy), 1.0);
  return softClip(normalized * level * 1.8);
}

fn foundBirdFlock(sampleIndex: u32, p0: vec4<f32>, p1: vec4<f32>) -> vec2<f32> {
  let clusterRate = clamp(p0.x, 0.1, 12.0);
  let birdCount = u32(clamp(round(p0.y), 2.0, f32(FOUND_MAX_BIRDS)));
  let centerHz = clamp(p0.z * exp2(render_info.performancePitch / 12.0), 20.0, SAMPLE_RATE * 0.45);
  let pitchRange = clamp(p0.w, 0.0, 36.0);
  let requestedLength = clamp(p1.x, 0.025, 0.8);
  let trillRate = clamp(p1.y, 3.0, 90.0);
  let spread = clamp(p1.z, 0.0, 1.0);
  let level = clamp(p1.w, 0.0, 1.0);
  let clusterSamples = max(u32(round(SAMPLE_RATE / clusterRate)), 1u);
  let clusterIndex = sampleIndex / clusterSamples;
  let clusterSample = sampleIndex % clusterSamples;
  var flock = vec2<f32>(0.0);
  var energy = 0.0;
  for (var bird = 0u; bird < FOUND_MAX_BIRDS; bird += 1u) {
    if (bird >= birdCount) { break; }
    let seed = clusterIndex * 747796405u + bird * 2891336453u + 277803737u;
    let onsetSample = u32(floor(hashU32(seed + 11u) * f32(clusterSamples) * 0.58));
    if (clusterSample < onsetSample) { continue; }
    let localSample = clusterSample - onsetSample;
    let availableSamples = max(clusterSamples - onsetSample, 1u);
    let durationScale = 0.68 + hashU32(seed + 23u) * 0.52;
    let requestedSamples = max(u32(round(requestedLength * durationScale * SAMPLE_RATE)), 1u);
    let durationSamples = min(requestedSamples, availableSamples);
    if (localSample >= durationSamples) { continue; }
    let position = f32(localSample) / f32(max(durationSamples - 1u, 1u));
    let age = f32(localSample) / SAMPLE_RATE;
    let duration = f32(durationSamples) / SAMPLE_RATE;
    let pitchOffset = (hashU32(seed + 37u) * 2.0 - 1.0) * pitchRange * 0.5;
    let bendDirection = hashU32(seed + 43u) * 2.0 - 1.0;
    let bendSemitones = bendDirection * (3.0 + pitchRange * 0.38);
    let startHz = centerHz * exp2(pitchOffset / 12.0);
    let endHz = startHz * exp2(bendSemitones / 12.0);
    let slope = (endHz - startHz) / max(duration, 0.0001);
    let chirpCycles = startHz * age + 0.5 * slope * age * age;
    let trillPhase = TAU * trillRate * age + hashU32(seed + 59u) * TAU;
    let phaseFlutter = sin(trillPhase) * (0.09 + hashU32(seed + 61u) * 0.16);
    let highFrequency = max(startHz, endHz) * 2.0 + trillRate * 2.0;
    let nyquistFade = foundNyquistFade(highFrequency);
    let callPhase = TAU * chirpCycles + phaseFlutter;
    let call = (sin(callPhase) + sin(callPhase * 2.0 + 0.41) * 0.22 * nyquistFade) * nyquistFade;
    let air = foundValueNoise(sampleIndex, 700.0 + f32(bird) * 83.0, seed + 71u) * 0.075;
    let window = pow(max(sin(PI * position), 0.0), 1.35);
    let amplitude = window * (0.62 + hashU32(seed + 79u) * 0.38);
    let pan = (hashU32(seed + 97u) * 2.0 - 1.0) * spread;
    let panAngle = (pan + 1.0) * PI * 0.25;
    flock += vec2<f32>(cos(panAngle), sin(panAngle)) * (call + air) * amplitude;
    energy += amplitude * amplitude;
  }
  let normalized = flock / max(sqrt(energy), 1.0);
  return softClip(normalized * level * 1.85);
}

fn foundThunderImpact(sampleIndex: u32, p0: vec4<f32>, p1: vec4<f32>) -> vec2<f32> {
  let rate = clamp(p0.x, 0.05, 8.0);
  let bodyHz = clamp(p0.y * exp2(render_info.performancePitch / 12.0), 10.0, SAMPLE_RATE * 0.3);
  let decay = clamp(p0.z, 0.12, 8.0);
  let bendOctaves = clamp(p0.w, 0.0, 4.0);
  let crackAmount = clamp(p1.x, 0.0, 1.0);
  let rumbleAmount = clamp(p1.y, 0.0, 1.0);
  let stereo = clamp(p1.z, 0.0, 1.0);
  let level = clamp(p1.w, 0.0, 1.0);
  let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
  let eventIndex = sampleIndex / periodSamples;
  let eventSample = sampleIndex % periodSamples;
  let age = f32(eventSample) / SAMPLE_RATE;
  let eventPosition = f32(eventSample) / f32(periodSamples);
  let seed = eventIndex * 2891336453u + 1013904223u;
  let intensity = 0.72 + hashU32(seed + 3u) * 0.28;
  let boundaryRelease = 1.0 - smoothstep(0.92, 1.0, eventPosition);

  let startHz = bodyHz * exp2(bendOctaves);
  let pitchTau = clamp(decay * 0.035, 0.018, 0.18);
  let bodyCycles = bodyHz * age + (startHz - bodyHz) * pitchTau * (1.0 - exp(-age / pitchTau));
  let bodyEnvelope = smoothstep(0.0, 0.0025, age) * exp(-age / max(decay * 0.32, 0.02));
  let bodyFade = foundNyquistFade(startHz);
  let body = sin(TAU * bodyCycles) * bodyEnvelope * bodyFade;

  let clickEnvelope = exp(-age / 0.012) * (1.0 - smoothstep(0.025, 0.075, age));
  let clickToneHz = min(bodyHz * 18.0, SAMPLE_RATE * 0.42);
  let clickTone = sin(TAU * phaseAtSample(sampleIndex, clickToneHz) + hashU32(seed + 7u) * TAU);
  let crackLeft = (hashU32(sampleIndex + seed + 11u) * 2.0 - 1.0) * 0.76 + clickTone * 0.24;
  let crackRight = (hashU32(sampleIndex + seed + 19u) * 2.0 - 1.0) * 0.76 + clickTone * 0.24;
  let crack = vec2<f32>(crackLeft, crackRight) * clickEnvelope * crackAmount;

  let rumbleEnvelope = smoothstep(0.008, 0.055, age) * exp(-age / max(decay, 0.02));
  let rumbleLeft = foundValueNoise(sampleIndex, 17.0 + bodyHz * 0.08, seed + 31u) * 0.54
    + foundValueNoise(sampleIndex, 43.0 + bodyHz * 0.13, seed + 41u) * 0.29
    + foundValueNoise(sampleIndex, 91.0 + bodyHz * 0.21, seed + 53u) * 0.17;
  let rumbleRightIndependent = foundValueNoise(sampleIndex, 19.0 + bodyHz * 0.07, seed + 67u) * 0.54
    + foundValueNoise(sampleIndex, 47.0 + bodyHz * 0.11, seed + 73u) * 0.29
    + foundValueNoise(sampleIndex, 97.0 + bodyHz * 0.19, seed + 89u) * 0.17;
  let rumbleRight = mix(rumbleLeft, rumbleRightIndependent, stereo);
  let rumble = vec2<f32>(rumbleLeft, rumbleRight) * rumbleEnvelope * rumbleAmount;

  let pan = (hashU32(seed + 101u) * 2.0 - 1.0) * stereo;
  let panAngle = (pan + 1.0) * PI * 0.25;
  let bodyStereo = vec2<f32>(cos(panAngle), sin(panAngle)) * body * 1.41421356;
  let normalization = inverseSqrt(max(1.0 + crackAmount * crackAmount * 0.58 + rumbleAmount * rumbleAmount * 0.62, 1.0));
  let impact = (bodyStereo + crack + rumble) * normalization * intensity * boundaryRelease;
  return softClip(impact * level * 1.9);
}
`;

export const SHADER_SYNTH_PLAYGROUND_FOUND_CASES = /* wgsl */ `
    case 57u: { result = foundShepardRisset(sampleIndex, p0, p1); }
    case 58u: { result = foundBirdFlock(sampleIndex, p0, p1); }
    case 59u: { result = foundThunderImpact(sampleIndex, p0, p1); }
`;

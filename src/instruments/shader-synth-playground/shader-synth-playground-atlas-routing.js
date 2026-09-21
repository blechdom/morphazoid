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
    behavior: options.behavior ?? "Changes the module's response.",
  });
}

function moduleSpec(spec) {
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

const CONTROL_OUTPUT = freeze([port("out", "control", "control")]);
const STEREO_OUTPUT = freeze([port("out", "stereo", "stereo")]);

// These are graph-sized, stateless adaptations of four atlas entries. The
// original routed-unit/routed-range helpers inspect score-lane buffers; here a
// typed graph cable is the route, so the modules preserve the same fallback,
// normalization, range, and depth operations without pretending to read lanes.
export const SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_MODULES = freeze([
  moduleSpec({
    id: "analytic-glide-oscillator",
    kind: 101,
    name: "Analytic Glide Oscillator",
    category: "source",
    color: "#74f7ff",
    aliases: ["phase-correct glide", "exponential chirp", "repeating analytic glide", "analytic pitch glide"],
    tags: ["glide", "repeating chirp", "phase integral", "exponential pitch", "stateless", "source"],
    description: "Repeats a finite exponential pitch glide, then continues at its exact ending phase and frequency during a hold segment; a short zero-edge window makes the stateless restart click-safe.",
    execution: "Single-sample · analytic phase integral · no history",
    wgsl: "cycles = integrateExponentialGlide(age, startHz, endHz, glideTime); phase = fract(cycles);",
    auditionKind: "source",
    auditionPreset: null,
    inputs: [],
    outputs: STEREO_OUTPUT,
    params: [
      parameter("frequency", "Start frequency", 20, 4000, 110, { step: 0.1, unit: "Hz", scale: "log", low: "low start", high: "high start", behavior: "Sets the frequency at the beginning of each finite glide before performance-note transposition." }),
      parameter("interval", "Glide interval", -48, 48, 24, { step: 0.1, unit: "st", low: "falling", high: "rising", behavior: "Sets the ending pitch relative to the start in semitones; pitch changes exponentially in hertz and linearly in pitch space." }),
      parameter("glide", "Glide time", 0.02, 8, 1.2, { step: 0.01, unit: "s", scale: "log", low: "quick bend", high: "long traverse", behavior: "Sets the finite interval over which instantaneous frequency moves from the start to the end." }),
      parameter("hold", "End hold", 0, 8, 0.65, { step: 0.01, unit: "s", low: "immediate repeat", high: "long ending tone", behavior: "Keeps the oscillator at its ending frequency after the glide while continuing from the accumulated phase." }),
      parameter("waveform", "Waveform", 0, 2, 0, { step: 1, options: ["Sine", "Triangle", "Saw"], low: "sine", high: "bright saw", behavior: "Chooses the waveform evaluated from the analytically integrated phase; the saw uses the host's local edge correction." }),
      parameter("edge", "Restart edge", 0.5, 50, 8, { step: 0.1, unit: "ms", scale: "log", low: "tight edge", high: "soft edge", behavior: "Fades the beginning and end of each repeated event so its stateless phase restart does not click." }),
      parameter("stereo", "Stereo phase", 0, 0.5, 0.035, { step: 0.001, unit: "cycle", low: "mono", high: "opposed phase", behavior: "Offsets the two channels around the same continuous glide phase." }),
      parameter("level", "Level", 0, 1, 0.42, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the windowed stereo glide into a soft output ceiling." }),
    ],
    faust: { symbol: "os.osc", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "normalized-route",
    kind: 102,
    name: "Normalized Route",
    category: "control",
    color: "#91ff63",
    aliases: ["routed unit", "unit routing", "normalized modulation", "control route"],
    tags: ["routing", "normalized", "control", "fallback", "depth", "stateless"],
    description: "Adapts the atlas lane router to a graph cable: the incoming control is converted to 0–1, optionally inverted, then blended with a normalized fallback value.",
    execution: "Single-sample · graph input mapping · no lane buffer",
    wgsl: "out = mix(fallback, graphInputAsUnit, amount);",
    auditionKind: "control",
    auditionPreset: null,
    inputs: [port("route", "routed control", "control", { required: true })],
    outputs: CONTROL_OUTPUT,
    params: [
      parameter("fallback", "Fallback", 0, 1, 0.5, { step: 0.01, low: "zero", high: "one", behavior: "Sets the normalized value heard when routing amount is zero." }),
      parameter("amount", "Route amount", 0, 1, 1, { step: 0.01, low: "fallback only", high: "routed input", behavior: "Blends continuously from the fallback value to the normalized cable value." }),
      parameter("domain", "Input domain", 0, 1, 0, { step: 1, options: ["Bipolar −1…1", "Unipolar 0…1"], low: "bipolar conversion", high: "unit input", behavior: "Chooses whether the incoming graph signal is remapped from −1…1 or already represents 0…1." }),
      parameter("invert", "Direction", 0, 1, 0, { step: 1, options: ["Normal", "Inverted"], low: "follows input", high: "opposes input", behavior: "Reflects the normalized routed value around 0.5 before the depth blend." }),
    ],
    faust: { symbol: "hslider, min, max", url: "https://faustdoc.grame.fr/manual/syntax/#user-interface-elements" },
  }),
  moduleSpec({
    id: "linear-range-map",
    kind: 103,
    name: "Linear Range Map",
    category: "control",
    color: "#91ff63",
    aliases: ["routed range", "unit to range", "linear scaler", "physical range mapping"],
    tags: ["routing", "range", "mapping", "control", "linear", "stateless"],
    description: "Converts a normalized graph control into a chosen linear output range while retaining the atlas router's physical fallback and route-depth behavior.",
    execution: "Single-sample · linear unit-to-range mapping",
    wgsl: "out = mix(minimum, maximum, mix(fallbackUnit, graphInputAsUnit, amount));",
    auditionKind: "control",
    auditionPreset: null,
    inputs: [port("route", "routed control", "control", { required: true })],
    outputs: CONTROL_OUTPUT,
    params: [
      parameter("minimum", "Range start", -96, 96, -12, { step: 0.1, low: "low endpoint", high: "high endpoint", behavior: "Sets the output produced by a normalized value of zero; crossing the other endpoint reverses the mapping." }),
      parameter("maximum", "Range end", -96, 96, 12, { step: 0.1, low: "low endpoint", high: "high endpoint", behavior: "Sets the output produced by a normalized value of one; the mapping between endpoints stays linear." }),
      parameter("fallback", "Fallback", -96, 96, 0, { step: 0.1, low: "toward range start", high: "toward range end", behavior: "Sets the physical output used when route amount is zero, clamped within the selected endpoints." }),
      parameter("amount", "Route amount", 0, 1, 1, { step: 0.01, low: "fallback only", high: "routed input", behavior: "Blends in normalized space before converting to the selected physical range." }),
      parameter("domain", "Input domain", 0, 1, 0, { step: 1, options: ["Bipolar −1…1", "Unipolar 0…1"], low: "bipolar conversion", high: "unit input", behavior: "Chooses whether the incoming graph signal is remapped from −1…1 or already represents 0…1." }),
      parameter("invert", "Direction", 0, 1, 0, { step: 1, options: ["Normal", "Inverted"], low: "start to end", high: "end to start", behavior: "Reflects the normalized routed input before it is mapped into the output range." }),
    ],
    faust: { symbol: "hslider, min, max", url: "https://faustdoc.grame.fr/manual/syntax/#user-interface-elements" },
  }),
  moduleSpec({
    id: "wavefold-table-oscillator",
    kind: 104,
    name: "Wavefold Table Oscillator",
    category: "source",
    color: "#74f7ff",
    aliases: ["wavefold table", "analytic wavetable", "folded unison", "sine triangle saw scan"],
    tags: ["wavetable", "wavefold", "sine", "triangle", "saw", "unison", "detune", "stateless"],
    description: "Scans an analytic sine–triangle–saw family, evaluates up to eight symmetrically detuned layers, and passes every layer through a sine fold before stereo summing.",
    execution: "Single-sample · 1–8 bounded analytic layers",
    wgsl: "table = scan(sine, triangle, saw); folded = sin(table * folds * PI);",
    auditionKind: "source",
    auditionPreset: null,
    inputs: [
      port("scan", "scan control", "control"),
      port("pitch", "pitch", "control"),
    ],
    outputs: STEREO_OUTPUT,
    params: [
      parameter("frequency", "Frequency", 20, 4000, 82.41, { step: 0.1, unit: "Hz", scale: "log", low: "low", high: "high", behavior: "Sets the center frequency before graph and performance-note transposition." }),
      parameter("scan", "Table scan", 0, 1, 0.34, { step: 0.01, low: "sine", high: "saw", behavior: "Moves through the overlapping analytic sine, triangle, and saw regions." }),
      parameter("scanDepth", "Scan CV depth", -1, 1, 0.72, { step: 0.01, low: "reverse scan", high: "forward scan", behavior: "Scales and optionally reverses the connected scan control before adding it to the table position." }),
      parameter("layers", "Layers", 1, 8, 5, { step: 1, low: "single oscillator", high: "eight layers", behavior: "Bounds the number of symmetrically detuned oscillator lanes evaluated for each sample." }),
      parameter("detune", "Detune", 0, 80, 13, { step: 0.1, unit: "cent", low: "locked", high: "wide beating", behavior: "Spreads the bounded layers symmetrically around the center pitch in cents." }),
      parameter("fold", "Sine folds", 0.5, 12, 2.7, { step: 0.01, low: "rounded", high: "dense fold harmonics", behavior: "Scales the scanned waveform before sine shaping; stronger values create additional folded lobes and can alias." }),
      parameter("stereo", "Stereo spread", 0, 1, 0.72, { step: 0.01, low: "mono", high: "wide layers", behavior: "Distributes detuned layers across an equal-power stereo field." }),
      parameter("level", "Level", 0, 1, 0.38, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the square-root-normalized layer sum into a soft output ceiling." }),
    ],
    faust: { symbol: "os.osc + sin", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
]);

// The host shader supplies SAMPLE_RATE, PI, TAU, render_info, phaseAtSample,
// smootherstep01, oscillatorWave, and softClip. These helpers hold no mutable
// state and are safe to insert before evaluateNode.
export const SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_HELPERS = /* wgsl */ `
fn atlasRoutingUnit(value: f32, domain: f32, invert: f32) -> f32 {
  let bipolar = clamp(value * 0.5 + 0.5, 0.0, 1.0);
  let unipolar = clamp(value, 0.0, 1.0);
  let normalized = select(bipolar, unipolar, round(domain) >= 1.0);
  return select(normalized, 1.0 - normalized, round(invert) >= 1.0);
}

fn atlasRoutingGlideCycles(age: f32, startHz: f32, endHz: f32, glideTime: f32) -> f32 {
  let duration = max(glideTime, 0.000001);
  let glideAge = clamp(age, 0.0, duration);
  let logRatio = log(max(endHz, 0.000001) / max(startHz, 0.000001));
  var cycles = startHz * glideAge;
  if (abs(logRatio) > 0.00001) {
    cycles = startHz * duration * (exp(logRatio * glideAge / duration) - 1.0) / logRatio;
  }
  if (age > duration) {
    cycles += endHz * (age - duration);
  }
  return cycles;
}

fn atlasRoutingGlideFrequency(age: f32, startHz: f32, endHz: f32, glideTime: f32) -> f32 {
  let duration = max(glideTime, 0.000001);
  if (age >= duration) { return endHz; }
  let logRatio = log(max(endHz, 0.000001) / max(startHz, 0.000001));
  return startHz * exp(logRatio * clamp(age / duration, 0.0, 1.0));
}

fn atlasRoutingTableWave(phase: f32, scan: f32) -> f32 {
  let position = fract(phase);
  let sine = sin(TAU * position);
  let triangle = 1.0 - 4.0 * abs(position - 0.5);
  let saw = position * 2.0 - 1.0;
  let sineTriangle = mix(sine, triangle, smoothstep(0.0, 0.55, scan));
  return mix(sineTriangle, saw, smoothstep(0.48, 1.0, scan));
}
`;

// Inserted directly inside the host evaluateNode switch. Parameter order is
// fixed: p0 contains the first four descriptors and p1 the remaining four.
export const SHADER_SYNTH_PLAYGROUND_ATLAS_ROUTING_CASES = /* wgsl */ `
    case 101u: {
      let transpose = exp2(render_info.performancePitch / 12.0);
      let startHz = clamp(p0.x * transpose, 1.0, SAMPLE_RATE * 0.45);
      let requestedEnd = startHz * exp2(p0.y / 12.0);
      let endHz = clamp(requestedEnd, 1.0, SAMPLE_RATE * 0.45);
      let glideTime = max(p0.z, 0.000001);
      let holdTime = max(p0.w, 0.0);
      let periodSamples = max(u32(round((glideTime + holdTime) * SAMPLE_RATE)), 2u);
      let localSample = sampleIndex % periodSamples;
      let age = f32(localSample) / SAMPLE_RATE;
      let cycles = atlasRoutingGlideCycles(age, startHz, endHz, glideTime);
      let instantaneousHz = atlasRoutingGlideFrequency(age, startHz, endHz, glideTime);
      let centerPhase = fract(cycles);
      let stereoOffset = clamp(p1.z, 0.0, 0.5) * 0.5;
      let waveform = u32(clamp(round(p1.x), 0.0, 2.0));
      let increment = instantaneousHz / SAMPLE_RATE;
      let tone = vec2<f32>(
        oscillatorWave(fract(centerPhase - stereoOffset), increment, waveform, 0.5),
        oscillatorWave(fract(centerPhase + stereoOffset), increment, waveform, 0.5)
      );
      let requestedEdge = max(u32(round(p1.y * 0.001 * SAMPLE_RATE)), 1u);
      let edgeSamples = min(requestedEdge, max(periodSamples / 4u, 1u));
      let remaining = periodSamples - 1u - min(localSample, periodSamples - 1u);
      let envelope = smootherstep01(f32(localSample) / f32(edgeSamples))
        * smootherstep01(f32(remaining) / f32(edgeSamples));
      result = softClip(tone * envelope * p1.w);
    }
    case 102u: {
      let routed = atlasRoutingUnit(inputA.x, p0.z, p0.w);
      let normalized = mix(clamp(p0.x, 0.0, 1.0), routed, clamp(p0.y, 0.0, 1.0));
      result = vec2<f32>(clamp(normalized, 0.0, 1.0));
    }
    case 103u: {
      let rangeStart = p0.x;
      let rangeEnd = p0.y;
      let span = rangeEnd - rangeStart;
      var fallbackUnit = 0.0;
      if (abs(span) > 0.000001) {
        fallbackUnit = clamp((p0.z - rangeStart) / span, 0.0, 1.0);
      }
      let routed = atlasRoutingUnit(inputA.x, p1.x, p1.y);
      let normalized = mix(fallbackUnit, routed, clamp(p0.w, 0.0, 1.0));
      result = vec2<f32>(mix(rangeStart, rangeEnd, normalized));
    }
    case 104u: {
      let baseHz = clamp(
        p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0),
        1.0,
        SAMPLE_RATE * 0.45
      );
      let scan = clamp(p0.y + inputA.x * p0.z * 0.5, 0.0, 1.0);
      let layerCount = u32(clamp(round(p0.w), 1.0, 8.0));
      let detuneCents = clamp(p1.x, 0.0, 80.0);
      let folds = clamp(p1.y, 0.5, 12.0);
      let spread = clamp(p1.z, 0.0, 1.0);
      var voice = vec2<f32>(0.0);
      for (var layer = 0u; layer < 8u; layer += 1u) {
        if (layer >= layerCount) { break; }
        var position = 0.0;
        if (layerCount > 1u) {
          position = f32(layer) / f32(layerCount - 1u) * 2.0 - 1.0;
        }
        let layerHz = clamp(baseHz * exp2(position * detuneCents / 1200.0), 1.0, SAMPLE_RATE * 0.45);
        let phase = phaseAtSample(sampleIndex, layerHz);
        let table = atlasRoutingTableWave(phase, scan);
        let folded = sin(table * folds * PI);
        let pan = position * spread;
        let gains = sqrt(max(vec2<f32>(0.5 * (1.0 - pan), 0.5 * (1.0 + pan)), vec2<f32>(0.0)));
        voice += gains * folded;
      }
      result = softClip(voice * inverseSqrt(f32(layerCount)) * p1.w * 1.25);
    }
`;

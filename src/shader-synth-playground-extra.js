const freeze = (value) => Object.freeze(value);

function port(id, label, type, options = {}) {
  return freeze({
    id,
    label,
    type,
    types: freeze(options.types ?? [type]),
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
    lanes: spec.lanes ? freeze([...spec.lanes]) : null,
    faust: spec.faust ? freeze({ ...spec.faust }) : null,
  });
}

const organLaneControl = (id, label, component, minimum, maximum, defaultValue, unit = "") => freeze({
  id,
  label,
  component,
  min: minimum,
  max: maximum,
  default: defaultValue,
  unit,
});

const ORGAN_RANK_DEFAULTS = freeze([
  freeze(["16′", 0.5, 0.76, 0.00, 0.00]),
  freeze(["5⅓′", 1.5, 0.24, 0.17, 0.04]),
  freeze(["8′", 1.0, 1.00, 0.00, 0.00]),
  freeze(["4′", 2.0, 0.72, 0.23, 0.05]),
  freeze(["2⅔′", 3.0, 0.38, 0.31, 0.07]),
  freeze(["2′", 4.0, 0.42, 0.41, 0.06]),
  freeze(["1⅗′", 5.0, 0.25, 0.53, 0.08]),
  freeze(["1⅓′", 6.0, 0.18, 0.67, 0.09]),
  freeze(["1′", 8.0, 0.12, 0.89, 0.10]),
]);

const ORGAN_RANK_LANES = freeze(ORGAN_RANK_DEFAULTS.map(([label, ratio, level, amRate, amDepth], index) => freeze({
  id: `organ-rank-${index + 1}`,
  label: `Rank ${index + 1} · ${label}`,
  binding: "organ_rank",
  row: index,
  controls: freeze([
    organLaneControl("ratio", "Ratio", "x", 0.125, 16, ratio, "×"),
    organLaneControl("level", "Level", "y", 0, 1, level),
    organLaneControl("amRate", "AM rate", "z", 0, 30, amRate, "Hz"),
    organLaneControl("amDepth", "AM depth", "w", 0, 1, amDepth),
  ]),
})));

const PITCH_GATE_OUTPUTS = freeze([
  port("pitch", "pitch", "control", { component: "x" }),
  port("gate", "gate", "control", { component: "y" }),
]);

// Parameter order is fixed: the first four values occupy p0.xyzw and the next
// four occupy p1.xyzw in evaluateNode. Keep every module at eight parameters or
// fewer so graph-node serialization stays compatible with the host layout.
export const SHADER_SYNTH_PLAYGROUND_EXTRA_MODULES = freeze([
  moduleSpec({
    id: "am-tremolo", kind: 36, name: "AM / Tremolo", category: "modulation", color: "#ffda57",
    aliases: ["am", "amplitude modulation", "tremolo", "chopper"],
    tags: ["am", "tremolo", "ring modulation", "lfo", "audio rate", "effect"],
    description: "Multiplies one incoming signal by a continuous low- or audio-rate waveform, moving from tremolo into carrier-retaining AM sidebands.",
    execution: "Single-sample · analytic modulator · no history", wgsl: "out = signal * mix(1.0, modulator, depth);",
    auditionKind: "effect", auditionPreset: null,
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true })],
    outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Mod rate", 0.05, 8000, 5.2, { step: 0.01, unit: "Hz", scale: "log", low: "slow tremolo", high: "AM sidebands", behavior: "Moves the modulator from rhythmic loudness motion into the audible range." }),
      parameter("depth", "Depth", 0, 1, 0.72, { step: 0.01, low: "dry level", high: "full modulation", behavior: "Sets how completely the modulator replaces constant gain." }),
      parameter("shape", "Waveform", 0, 3, 0, { step: 1, options: ["Sine", "Triangle", "Square", "Saw"], low: "rounded", high: "edged", behavior: "Selects the periodic AM waveform; discontinuous choices use the host's band-limited oscillator helper." }),
      parameter("polarity", "Polarity", 0, 1, 0, { step: 1, options: ["Unipolar", "Bipolar"], low: "tremolo", high: "carrier-suppressed", behavior: "Keeps the gain positive for tremolo or lets it invert for ring-modulator-like AM." }),
      parameter("phase", "Start phase", 0, 1, 0, { step: 0.01, unit: "cycle", low: "aligned", high: "shifted", behavior: "Offsets both channel modulators around their cycle." }),
      parameter("stereo", "Stereo phase", 0, 0.5, 0.06, { step: 0.01, unit: "cycle", low: "mono motion", high: "opposed motion", behavior: "Offsets left and right AM phase in opposite directions." }),
      parameter("mix", "Wet mix", 0, 1, 1, { step: 0.01, low: "dry", high: "modulated", behavior: "Crossfades between the incoming signal and AM result." }),
      parameter("level", "Level", 0, 1.5, 0.92, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the final dry/wet result into a soft ceiling." }),
    ],
    faust: { symbol: "os.osc + *", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "chord-arpeggiator", kind: 37, name: "Chord Arpeggiator", category: "control", color: "#91ff63",
    aliases: ["chord arp", "triad sequencer", "broken chord", "chorder"],
    tags: ["arpeggiator", "chord", "pitch", "gate", "sequence", "packed output"],
    description: "Traverses triads and seventh chords with inversion, direction, glide, swing, and a click-safe gate packed beside pitch.",
    execution: "Single-sample · deterministic chord lookup", wgsl: "out = vec2(semitones, edgeSafeGate);",
    auditionKind: "pitch-gate", auditionPreset: null,
    inputs: [port("root", "root pitch", "control")], outputs: PITCH_GATE_OUTPUTS,
    params: [
      parameter("rate", "Step rate", 0.25, 24, 5, { step: 0.01, unit: "Hz", scale: "log", low: "slow", high: "rapid", behavior: "Sets how often the next chord tone is selected." }),
      parameter("chord", "Chord", 0, 7, 0, { step: 1, options: ["Major", "Minor", "Dominant 7", "Major 7", "Minor 7", "Diminished 7", "Sus 2", "Sus 4"], low: "triadic", high: "suspended", behavior: "Chooses the interval table traversed by the arpeggiator." }),
      parameter("voicing", "Voicing", 0, 4, 0, { step: 1, options: ["Root", "1st inversion", "2nd inversion", "Two octaves", "Wide alternating"], low: "closed", high: "spread", behavior: "Rotates the chord or opens it across a wider register." }),
      parameter("pattern", "Direction", 0, 3, 0, { step: 1, options: ["Up", "Down", "Up / down", "Fifths skip"], low: "ordered", high: "skipping", behavior: "Changes how positions are mapped onto the voiced chord tones." }),
      parameter("transpose", "Transpose", -24, 24, 0, { step: 0.5, unit: "st", low: "down", high: "up", behavior: "Offsets the packed pitch in half-semitone steps before root-pitch input is added." }),
      parameter("width", "Gate width", 0.05, 1, 0.72, { step: 0.01, low: "staccato", high: "legato", behavior: "Sets the active portion of each step; both edges are smoothed." }),
      parameter("glide", "Glide", 0, 0.95, 0.08, { step: 0.01, low: "stepped", high: "sliding", behavior: "Interpolates toward the following chord tone near each step end." }),
      parameter("swing", "Swing", 0, 0.42, 0.08, { step: 0.01, low: "even", high: "long / short", behavior: "Alternates step lengths while retaining the two-step duration." }),
    ],
    faust: { symbol: "ba.pulse + select2", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),
  moduleSpec({
    id: "euclidean-arpeggiator", kind: 38, name: "Euclidean Arpeggiator", category: "control", color: "#91ff63",
    aliases: ["euclidean arp", "bjorklund arp", "even rhythm melody"],
    tags: ["arpeggiator", "euclidean", "rhythm", "scale", "pitch", "gate"],
    description: "Places notes with an integer Euclidean predicate, advances scale pitch only across hits, and packs an edge-safe gate into output Y.",
    execution: "Single-sample · bounded rhythm ordinal", wgsl: "hit = ((rotatedStep * pulses) % steps) < pulses;",
    auditionKind: "pitch-gate", auditionPreset: null,
    inputs: [port("root", "root pitch", "control")], outputs: PITCH_GATE_OUTPUTS,
    params: [
      parameter("rate", "Step rate", 0.25, 32, 8, { step: 0.01, unit: "Hz", scale: "log", low: "slow", high: "rapid", behavior: "Sets the Euclidean grid rate." }),
      parameter("steps", "Steps", 2, 128, 16, { step: 1, low: "short cycle", high: "long cycle", behavior: "Sets the number of grid positions in one rhythm cycle." }),
      parameter("pulses", "Pulses", 1, 128, 5, { step: 1, low: "sparse", high: "dense", behavior: "Sets how many evenly distributed positions produce notes." }),
      parameter("rotation", "Rotation", 0, 127, 0, { step: 1, low: "original", high: "rotated", behavior: "Rotates the hit pattern without changing its spacing family." }),
      parameter("scale", "Scale", 0, 6, 1, { step: 1, options: ["Chromatic", "Major", "Minor", "Pentatonic", "Whole tone", "Octatonic", "Quarter tone"], low: "chromatic", high: "quarter-tone", behavior: "Maps each hit ordinal onto a pitch collection, including 0.5-semitone quarter-tone steps." }),
      parameter("octaves", "Range", 1, 4, 2, { step: 1, unit: "oct", low: "compact", high: "wide", behavior: "Sets how many scale octaves the hit sequence traverses." }),
      parameter("width", "Gate width", 0.05, 1, 0.46, { step: 0.01, low: "short trigger", high: "held step", behavior: "Sets how much of every active grid step remains high." }),
      parameter("glide", "Glide", 0, 0.95, 0.05, { step: 0.01, low: "stepped", high: "sliding", behavior: "Moves toward the next Euclidean hit's scale pitch near the end of a note." }),
    ],
    faust: { symbol: "ba.pulse", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),
  moduleSpec({
    id: "random-walk-arpeggiator", kind: 39, name: "Random-walk Arpeggiator", category: "control", color: "#91ff63",
    aliases: ["random walk arp", "drunk walk sequencer", "brownian melody"],
    tags: ["arpeggiator", "random walk", "deterministic", "scale", "pitch", "gate"],
    description: "Reconstructs a repeatable bounded pitch walk from the absolute step coordinate, with no mutable sequencer state.",
    execution: "Single-sample · at most 128 hashed walk increments", wgsl: "degree = wrap(degree + seededStep, noteCount);",
    auditionKind: "pitch-gate", auditionPreset: null,
    inputs: [port("root", "root pitch", "control")], outputs: PITCH_GATE_OUTPUTS,
    params: [
      parameter("rate", "Step rate", 0.25, 24, 5.5, { step: 0.01, unit: "Hz", scale: "log", low: "wandering", high: "skittering", behavior: "Sets how often the deterministic walk takes another step." }),
      parameter("length", "Walk length", 2, 128, 16, { step: 1, low: "short reset", high: "long journey", behavior: "Sets how many increments are reconstructed before a newly seeded walk begins." }),
      parameter("scale", "Scale", 0, 6, 2, { step: 1, options: ["Chromatic", "Major", "Minor", "Pentatonic", "Whole tone", "Octatonic", "Quarter tone"], low: "chromatic", high: "quarter-tone", behavior: "Maps the wrapped walk degree onto a pitch collection, including 0.5-semitone quarter-tone steps." }),
      parameter("octaves", "Range", 1, 4, 2, { step: 1, unit: "oct", low: "narrow", high: "wide", behavior: "Bounds the walk before it wraps into the scale range." }),
      parameter("stride", "Max stride", 1, 6, 2, { step: 1, low: "neighbor steps", high: "large leaps", behavior: "Sets the largest signed scale-degree change per step." }),
      parameter("seed", "Seed", 1, 65535, 17011, { step: 1, low: "walk A", high: "walk B", behavior: "Selects a repeatable family of walk increments and restart degrees." }),
      parameter("width", "Gate width", 0.05, 1, 0.68, { step: 0.01, low: "staccato", high: "legato", behavior: "Sets the active portion of every step with smoothed edges." }),
      parameter("glide", "Glide", 0, 0.95, 0.14, { step: 0.01, low: "stepped", high: "sliding", behavior: "Interpolates toward the next reconstructed walk degree." }),
    ],
    faust: { symbol: "no.lfnoise + ba.pulse", url: "https://faustlibraries.grame.fr/libs/noises/" },
  }),
  moduleSpec({
    id: "additive-drawbar-organ", kind: 40, name: "Additive Drawbar Organ", category: "source", color: "#ff9a62",
    aliases: ["additive organ", "drawbar organ", "tonewheel", "harmonic ranks", "hammond-like"],
    tags: ["additive", "organ", "drawbar", "nine ranks", "lanes", "chorale", "rotor"],
    description: "Sums nine editable rank lanes from organ_rank; every lane carries ratio, level, AM rate, and AM depth for GPU-parallel registration design.",
    execution: "Single-sample · 1–9 external analytic rank lanes", wgsl: "rank = organ_rank[i]; voice += sin(rankPhase) * rankLevel * rankAM;",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("control", "timbre / motion", "control"), port("pitch", "pitch", "control")],
    outputs: [port("out", "stereo", "stereo")], lanes: ORGAN_RANK_LANES,
    params: [
      parameter("frequency", "Fundamental", 20, 1200, 110, { step: 0.1, unit: "Hz", scale: "log", low: "pedal", high: "upper manual", behavior: "Sets the fundamental beneath all external rank ratios." }),
      parameter("ranks", "Active ranks", 1, 9, 9, { step: 1, low: "single drawbar", high: "all lanes", behavior: "Bounds how many rows of organ_rank are evaluated." }),
      parameter("timbre", "Timbre tilt", 0, 1, 0.52, { step: 0.01, low: "lower ranks", high: "upper ranks", behavior: "Tilts rank levels by their frequency ratio." }),
      parameter("chorale", "Chorale", 0, 1, 0.28, { step: 0.01, low: "steady", high: "phase chorus", behavior: "Adds rank-dependent slow phase motion without history reads." }),
      parameter("rotor", "Rotor", 0, 1, 0.42, { step: 0.01, low: "stationary", high: "spinning", behavior: "Adds opposing analytic amplitude and phase motion across stereo." }),
      parameter("width", "Width", 0, 1, 0.72, { step: 0.01, low: "mono", high: "wide ranks", behavior: "Separates alternating drawbars and increases rotor stereo depth." }),
      parameter("level", "Level", 0, 1, 0.52, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the energy-normalized registration into a soft ceiling." }),
      parameter("cvDepth", "Control depth", 0, 1, 0.64, { step: 0.01, low: "fixed", high: "wide motion", behavior: "Routes the control input into timbre and chorale motion." }),
    ],
    faust: { symbol: "os.quadosc : os.sidebands", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "supersaw", kind: 41, name: "Supersaw Unison", category: "source", color: "#74f7ff",
    aliases: ["super saw", "unison saw", "detuned saw stack", "trance saw"],
    tags: ["supersaw", "unison", "polyblep", "detune", "stereo", "oscillator"],
    description: "Stacks up to nine phase-scattered, band-limited oscillators with symmetric detune, analytic drift, and stereo distribution.",
    execution: "Single-sample · 1–9 bounded unison voices", wgsl: "voice += oscillatorWave(detunedPhase) * panGain;",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("motion", "drift CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Frequency", 20, 4000, 110, { step: 0.1, unit: "Hz", scale: "log", low: "low", high: "high", behavior: "Sets the center pitch of the unison bank." }),
      parameter("voices", "Voices", 1, 9, 7, { step: 1, low: "single", high: "dense", behavior: "Sets how many symmetric oscillator lanes are summed." }),
      parameter("detune", "Detune", 0, 80, 18, { step: 0.1, unit: "cent", low: "locked", high: "wide beating", behavior: "Spreads voice pitch around the center in cents." }),
      parameter("spread", "Stereo spread", 0, 1, 0.86, { step: 0.01, low: "mono", high: "wide", behavior: "Distributes unison lanes across equal-power stereo positions." }),
      parameter("driftRate", "Drift rate", 0.02, 3, 0.19, { step: 0.01, unit: "Hz", scale: "log", low: "slow", high: "flutter", behavior: "Sets the speed of per-voice analytic pitch drift." }),
      parameter("driftDepth", "Drift depth", 0, 1, 0.22, { step: 0.01, low: "stable", high: "wandering", behavior: "Scales integrated sinusoidal pitch drift and its control input." }),
      parameter("waveform", "Waveform", 0, 2, 0, { step: 1, options: ["Saw", "Triangle", "Pulse"], low: "bright saw", high: "hollow pulse", behavior: "Chooses the host band-limited waveform used by every lane." }),
      parameter("level", "Level", 0, 1, 0.54, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the power-normalized unison sum into a soft ceiling." }),
    ],
    faust: { symbol: "os.polyblep_saw", url: "https://faustlibraries.grame.fr/libs/oscillators/#ospolyblep_saw" },
  }),
  moduleSpec({
    id: "chirp-sweep", kind: 42, name: "Analytic Chirp Sweep", category: "source", color: "#74f7ff",
    aliases: ["chirp", "sweep oscillator", "frequency sweep", "sine sweep"],
    tags: ["chirp", "sweep", "analytic phase", "riser", "downer", "oscillator"],
    description: "Integrates a curved frequency trajectory exactly within each event, producing clean risers, dives, pings, and test-like sweeps.",
    execution: "Single-sample · analytic frequency integral", wgsl: "cycles = start * age + delta * duration * pow(u, curve + 1) / (curve + 1);",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Event rate", 0.05, 12, 0.8, { step: 0.01, unit: "Hz", scale: "log", low: "isolated", high: "rapid", behavior: "Sets how often a new sweep begins." }),
      parameter("start", "Start", 20, 12000, 90, { step: 0.1, unit: "Hz", scale: "log", low: "low", high: "high", behavior: "Sets the frequency at event onset before pitch input." }),
      parameter("end", "End", 20, 12000, 3200, { step: 0.1, unit: "Hz", scale: "log", low: "low", high: "high", behavior: "Sets the frequency reached at the end of the active sweep." }),
      parameter("duration", "Duration", 0.02, 6, 0.72, { step: 0.01, unit: "s", scale: "log", low: "ping", high: "long scan", behavior: "Sets active sweep time, clamped below the repetition period." }),
      parameter("curve", "Curve", 0.2, 5, 1, { step: 0.01, low: "fast early", high: "fast late", behavior: "Curves instantaneous frequency while retaining its analytic phase integral." }),
      parameter("decay", "Tail", 0.02, 6, 1.4, { step: 0.01, unit: "s", scale: "log", low: "short", high: "sustained", behavior: "Applies a click-safe exponential amplitude contour within the sweep window." }),
      parameter("stereo", "Stereo phase", 0, 1, 0.24, { step: 0.01, low: "mono", high: "wide", behavior: "Offsets the harmonic detail in opposite directions without delaying history." }),
      parameter("level", "Level", 0, 1, 0.5, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the completed chirp." }),
    ],
    faust: { symbol: "an.linsweep", url: "https://faustlibraries.grame.fr/libs/analyzers/" },
  }),
  moduleSpec({
    id: "air-swoosh", kind: 43, name: "Air Swoosh", category: "source", color: "#74f7ff",
    aliases: ["swoosh", "whoosh", "wind sweep", "air riser", "noise sweep"],
    tags: ["swoosh", "whoosh", "air", "noise", "chirp cloud", "transition"],
    description: "Sweeps a randomized bank of analytic partials through a raised-sine air envelope, with optional decorrelated hash hiss.",
    execution: "Single-sample · eight chirp lanes + bounded hiss", wgsl: "air += sin(integratedRandomChirp) * pan;",
    auditionKind: "source", auditionPreset: null,
    inputs: [], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Event rate", 0.05, 6, 0.42, { step: 0.01, unit: "Hz", scale: "log", low: "isolated", high: "rapid", behavior: "Sets how often another air gesture begins." }),
      parameter("duration", "Duration", 0.04, 8, 1.5, { step: 0.01, unit: "s", scale: "log", low: "short", high: "long", behavior: "Sets the active whoosh length below the event period." }),
      parameter("center", "Start center", 30, 8000, 180, { step: 1, unit: "Hz", scale: "log", low: "rumble", high: "hiss", behavior: "Sets the initial center of the randomized partial cloud." }),
      parameter("sweep", "Sweep ratio", 0.08, 24, 9, { step: 0.01, unit: "×", scale: "log", low: "falling", high: "rising", behavior: "Multiplies every lane's frequency across the gesture." }),
      parameter("bandwidth", "Bandwidth", 0, 1, 0.74, { step: 0.01, low: "tonal", high: "broad air", behavior: "Spreads chirp lanes around the center frequency." }),
      parameter("texture", "Hiss", 0, 1, 0.42, { step: 0.01, low: "smooth cloud", high: "grainy air", behavior: "Adds decorrelated, transient-windowed hash hiss and phase turbulence." }),
      parameter("stereo", "Width", 0, 1, 0.9, { step: 0.01, low: "mono", high: "wide", behavior: "Spreads randomized lanes and hiss across stereo." }),
      parameter("level", "Level", 0, 1, 0.46, { step: 0.01, low: "quiet", high: "large", behavior: "Scales the normalized air gesture into a soft ceiling." }),
    ],
    faust: { symbol: "no.multinoise + os.osc", url: "https://faustlibraries.grame.fr/libs/noises/" },
  }),
  moduleSpec({
    id: "laser-woosh", kind: 44, name: "Laser Woosh", category: "source", color: "#ff6eaa",
    aliases: ["laser", "laser sweep", "pew", "zap", "sci-fi woosh"],
    tags: ["laser", "woosh", "chirp", "sci-fi", "phase modulation", "impact"],
    description: "Fires a curved analytic chirp through bounded self-phase modulation for repeatable zaps, pews, dives, and ricochets.",
    execution: "Single-sample · curved chirp + phase warp", wgsl: "laser = sin(chirpPhase + feedback * sin(chirpPhase));",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Event rate", 0.05, 16, 1.1, { step: 0.01, unit: "Hz", scale: "log", low: "single shots", high: "rapid fire", behavior: "Sets how often the laser envelope and phase restart." }),
      parameter("start", "Start", 30, 14000, 3600, { step: 1, unit: "Hz", scale: "log", low: "low", high: "bright", behavior: "Sets the laser's onset frequency before pitch input." }),
      parameter("end", "End", 20, 12000, 120, { step: 1, unit: "Hz", scale: "log", low: "deep landing", high: "rising zap", behavior: "Sets the frequency at the end of the shot." }),
      parameter("duration", "Duration", 0.015, 4, 0.34, { step: 0.001, unit: "s", scale: "log", low: "click", high: "long dive", behavior: "Sets active shot length below the repetition period." }),
      parameter("curve", "Trajectory", 0.2, 6, 2.2, { step: 0.01, low: "early bend", high: "late bend", behavior: "Shapes the instantaneous-frequency path while phase remains integrated." }),
      parameter("feedback", "Phase warp", 0, 4, 1.25, { step: 0.01, unit: "rad", low: "sine", high: "robotic edge", behavior: "Adds bounded self-phase modulation and an overtone flash." }),
      parameter("stereo", "Stereo", 0, 1, 0.38, { step: 0.01, low: "centered", high: "split beam", behavior: "Offsets phase warp and overtone detail across channels." }),
      parameter("level", "Level", 0, 1, 0.54, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the completed shot into a soft ceiling." }),
    ],
    faust: { symbol: "an.logsweep + os.osc", url: "https://faustlibraries.grame.fr/libs/analyzers/" },
  }),
  moduleSpec({
    id: "robot-voice", kind: 45, name: "Robot Voice", category: "source", color: "#a78bff",
    aliases: ["robot", "robotic voice", "vocoder droid", "talking synth", "android"],
    tags: ["robot", "voice", "formant", "vocoder", "phase modulation", "harmonic bank"],
    description: "Weights a phase-warped harmonic carrier with moving vowel peaks and smooth machine-rate articulation for intelligible metallic drones.",
    execution: "Single-sample · 4–24 formant-weighted harmonics", wgsl: "voice += warpedHarmonic * gaussianFormantWeight;",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("vowel", "vowel / talk CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Fundamental", 25, 600, 92, { step: 0.1, unit: "Hz", scale: "log", low: "large robot", high: "small robot", behavior: "Sets harmonic spacing beneath the synthetic mouth." }),
      parameter("vowel", "Vowel scan", 0, 1, 0.34, { step: 0.01, low: "A / E", high: "O / U", behavior: "Moves three spectral peaks through a vowel trajectory." }),
      parameter("harmonics", "Harmonics", 4, 24, 18, { step: 1, low: "simple", high: "articulate", behavior: "Sets how many carrier partials can meet the formant peaks." }),
      parameter("bandwidth", "Mouth width", 40, 700, 210, { step: 1, unit: "Hz", scale: "log", low: "nasal", high: "broad", behavior: "Sets the width of the synthetic formant regions." }),
      parameter("robotRate", "Machine rate", 0.2, 40, 7.5, { step: 0.01, unit: "Hz", scale: "log", low: "slow syllables", high: "buzzing", behavior: "Adds continuous periodic articulation without hard gain edges." }),
      parameter("metal", "Metal", 0, 4, 1.15, { step: 0.01, unit: "rad", low: "vocal", high: "droid", behavior: "Raises inharmonic phase-warp sidebands around each formant-weighted partial." }),
      parameter("cvDepth", "Talk depth", 0, 1, 0.72, { step: 0.01, low: "fixed mouth", high: "wide talk", behavior: "Sets how strongly the control input moves the vowel scan." }),
      parameter("level", "Level", 0, 1, 0.46, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the energy-normalized robot voice into a soft ceiling." }),
    ],
    faust: { symbol: "os.sidebands + sy.fm", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "analytic-plucked-string", kind: 46, name: "Analytic Plucked String", category: "source", color: "#ff9a62",
    aliases: ["pluck", "modal string", "closed-form string", "shadertoy string"],
    tags: ["plucked string", "analytic", "modal", "physical model", "harmonics", "pluck position"],
    description: "Evaluates a finite damped string-mode series whose initial amplitudes follow pluck position and whose upper modes bend with stiffness.",
    execution: "Single-sample · 1–32 damped analytic modes", wgsl: "mode = sin(n * PI * pluckPosition) * exp(-damping[n] * age) * sin(modePhase);",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Pluck rate", 0.1, 16, 1.8, { step: 0.01, unit: "Hz", scale: "log", low: "isolated", high: "rapid", behavior: "Sets how often all modes are excited from zero." }),
      parameter("frequency", "Fundamental", 20, 1400, 110, { step: 0.1, unit: "Hz", scale: "log", low: "long string", high: "short string", behavior: "Sets the ideal-string fundamental before pitch input." }),
      parameter("modes", "Modes", 1, 32, 20, { step: 1, low: "pure", high: "detailed", behavior: "Bounds the number of damped string modes evaluated per sample." }),
      parameter("pluck", "Pluck position", 0.03, 0.97, 0.24, { step: 0.01, low: "near bridge", high: "opposite end", behavior: "Places spectral notches through the physical sin(nπp) excitation law." }),
      parameter("decay", "Decay", 0.03, 8, 1.7, { step: 0.01, unit: "s", scale: "log", low: "muted", high: "ringing", behavior: "Sets the low-mode exponential decay time." }),
      parameter("stiffness", "Stiffness", 0, 1, 0.12, { step: 0.01, low: "ideal string", high: "glassy", behavior: "Stretches upper modes progressively sharp for wire- and bar-like colors." }),
      parameter("stereo", "Width", 0, 1, 0.36, { step: 0.01, low: "mono", high: "wide modes", behavior: "Offsets alternating modal phase in opposite stereo directions." }),
      parameter("level", "Level", 0, 1, 0.56, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the energy-normalized pluck." }),
    ],
    faust: { symbol: "pm.pluckString", url: "https://faustlibraries.grame.fr/libs/physmodels/" },
  }),
  moduleSpec({
    id: "wave-terrain", kind: 47, name: "Analytic Wave Terrain", category: "source", color: "#74f7ff",
    aliases: ["wave terrain", "terrain oscillator", "2d wavetable", "orbit oscillator"],
    tags: ["wave terrain", "2d", "procedural", "orbit", "wavetable", "shadertoy"],
    description: "Drives a closed circular orbit through one of six procedural 2D height fields, turning geometric path changes into timbre changes.",
    execution: "Single-sample · analytic orbit + terrain function", wgsl: "sample = terrain(center + radius * vec2(cos(phase), sin(phase)));",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("motion", "terrain CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Orbit pitch", 20, 4000, 96, { step: 0.1, unit: "Hz", scale: "log", low: "low", high: "high", behavior: "Sets how often the path circles the terrain." }),
      parameter("radius", "Orbit radius", 0.02, 2, 0.72, { step: 0.01, low: "small orbit", high: "large orbit", behavior: "Changes how much of the height field one waveform cycle traverses." }),
      parameter("centerX", "Center X", -2, 2, 0.16, { step: 0.01, low: "left field", high: "right field", behavior: "Moves the orbit horizontally through the procedural terrain." }),
      parameter("centerY", "Center Y", -2, 2, -0.12, { step: 0.01, low: "lower field", high: "upper field", behavior: "Moves the orbit vertically through the procedural terrain." }),
      parameter("terrain", "Terrain", 0, 5, 3, { step: 1, options: ["Cross waves", "Rings", "Checker", "Domain warp", "Cell ridges", "Fractal folds"], low: "smooth", high: "complex", behavior: "Selects a bounded analytic 2D surface." }),
      parameter("warp", "Warp", 0, 3, 0.86, { step: 0.01, low: "simple", high: "folded", behavior: "Increases domain deformation inside the chosen terrain." }),
      parameter("width", "Stereo orbit", 0, 1, 0.42, { step: 0.01, low: "same path", high: "split paths", behavior: "Rotates the right-channel orbit and offsets both centers oppositely." }),
      parameter("level", "Level", 0, 1, 0.48, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the terrain samples into a soft ceiling." }),
    ],
    faust: { symbol: "os.osc", url: "https://faustlibraries.grame.fr/libs/oscillators/" },
  }),
  moduleSpec({
    id: "fractal-recurrence", kind: 48, name: "Fractal Recurrence", category: "source", color: "#a78bff",
    aliases: ["chaos oscillator", "inversion machine", "fractal synth", "iterated map"],
    tags: ["fractal", "chaos", "recurrence", "fixed iteration", "shadertoy", "brittle"],
    description: "Maps a periodic orbit through a clamped inversion recurrence, exposing brittle tones and deterministic pseudo-chaos without sample feedback.",
    execution: "Single-sample · 1–12 bounded recurrence iterations", wgsl: "point = abs(point) / max(dot(point, point), epsilon) - offset;",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("control", "chaos CV", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Orbit pitch", 5, 4000, 74, { step: 0.1, unit: "Hz", scale: "log", low: "slow", high: "bright", behavior: "Sets how quickly the seed orbit circles before iteration." }),
      parameter("seed", "Seed", -1, 1, 0.17, { step: 0.01, low: "orbit A", high: "orbit B", behavior: "Moves the inversion offset through different attractor families." }),
      parameter("iterations", "Iterations", 1, 12, 7, { step: 1, low: "recognizable", high: "fractured", behavior: "Sets the fixed maximum recurrence depth." }),
      parameter("fold", "Readout fold", 0.5, 12, 3.8, { step: 0.01, low: "rounded", high: "brittle", behavior: "Scales the final bounded coordinates before sinusoidal readout." }),
      parameter("motion", "Seed motion", 0.01, 8, 0.21, { step: 0.01, unit: "Hz", scale: "log", low: "slow mutation", high: "warble", behavior: "Moves the recurrence offset with an analytic low-frequency orbit." }),
      parameter("cvDepth", "Chaos CV", 0, 1, 0.62, { step: 0.01, low: "fixed", high: "wide mutation", behavior: "Sets how strongly the control input changes the recurrence seed." }),
      parameter("stereo", "Stereo seed", 0, 1, 0.48, { step: 0.01, low: "mono", high: "split attractors", behavior: "Offsets the two channel recurrences in opposite directions." }),
      parameter("level", "Level", 0, 1, 0.42, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the bounded recurrence readout." }),
    ],
    faust: { symbol: "ef.cubicnl", url: "https://faustlibraries.grame.fr/libs/misceffects/" },
  }),
  moduleSpec({
    id: "procedural-snare", kind: 49, name: "Procedural Snare", category: "source", color: "#ff6eaa",
    aliases: ["snare", "synthetic snare", "noise drum", "snare drum"],
    tags: ["snare", "drum", "noise", "body", "snap", "percussion"],
    description: "Layers two decaying shell modes with differentiated deterministic noise and a short wire snap, all reconstructed from event age.",
    execution: "Single-sample · analytic body + stateless noise", wgsl: "snare = shell(age) + highNoise(sample) * noiseEnvelope(age);",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("pitch", "body pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Hit rate", 0.1, 20, 2.2, { step: 0.01, unit: "Hz", scale: "log", low: "spaced", high: "roll", behavior: "Sets how often the snare is struck." }),
      parameter("body", "Body pitch", 70, 420, 176, { step: 0.1, unit: "Hz", scale: "log", low: "deep shell", high: "tight shell", behavior: "Sets the lower pair of decaying tonal modes." }),
      parameter("bodyDecay", "Body decay", 0.02, 1.5, 0.16, { step: 0.01, unit: "s", scale: "log", low: "tight", high: "ringing", behavior: "Sets how long shell modes remain audible." }),
      parameter("noiseDecay", "Wire decay", 0.01, 2, 0.28, { step: 0.01, unit: "s", scale: "log", low: "dry", high: "sizzling", behavior: "Sets the exponential tail of the noise layer." }),
      parameter("tone", "Noise tone", 0, 1, 0.72, { step: 0.01, low: "broad", high: "high passed", behavior: "Crossfades white hash noise toward a normalized first difference." }),
      parameter("snap", "Snap", 0, 1, 0.58, { step: 0.01, low: "soft wires", high: "hard crack", behavior: "Adds a much shorter high-noise onset above the main wire tail." }),
      parameter("stereo", "Width", 0, 1, 0.44, { step: 0.01, low: "mono", high: "split wires", behavior: "Blends toward decorrelated left and right noise while the shell stays centered." }),
      parameter("level", "Level", 0, 1, 0.62, { step: 0.01, low: "quiet", high: "full", behavior: "Scales shell and wires together into a soft ceiling." }),
    ],
    faust: { symbol: "no.noise + sy.additiveDrum", url: "https://faustlibraries.grame.fr/libs/synths/" },
  }),
  moduleSpec({
    id: "metallic-hi-hat", kind: 50, name: "Metallic Hi-hat", category: "source", color: "#ff6eaa",
    aliases: ["hi hat", "hihat", "cymbal", "metal hat", "808 hat"],
    tags: ["hi-hat", "cymbal", "metallic", "inharmonic", "percussion", "sine bank"],
    description: "Excites an eight-lane inharmonic sine alloy with a fast transient and variable open decay, avoiding raw square-wave alias spray.",
    execution: "Single-sample · eight inharmonic modes", wgsl: "metal += sin(TAU * ratio[i] * age) * exp(-age / decay);",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("pitch", "metal pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Hit rate", 0.1, 32, 6, { step: 0.01, unit: "Hz", scale: "log", low: "spaced", high: "rapid", behavior: "Sets how often the metallic bank is excited." }),
      parameter("frequency", "Metal pitch", 180, 6000, 760, { step: 1, unit: "Hz", scale: "log", low: "large cymbal", high: "tiny metal", behavior: "Sets the base beneath eight inharmonic ratios." }),
      parameter("decay", "Closed decay", 0.01, 1.2, 0.085, { step: 0.001, unit: "s", scale: "log", low: "tick", high: "ring", behavior: "Sets the base amplitude decay before Open extends it." }),
      parameter("alloy", "Alloy", 0, 1, 0.48, { step: 0.01, low: "ordered", high: "scattered", behavior: "Moves the fixed ratio bank through deterministic inharmonic offsets." }),
      parameter("brightness", "Brightness", 0, 1, 0.78, { step: 0.01, low: "lower modes", high: "upper modes", behavior: "Tilts energy toward higher metallic lanes." }),
      parameter("open", "Open", 0, 1, 0.18, { step: 0.01, low: "closed", high: "open", behavior: "Extends the modal decay toward an open-hat tail." }),
      parameter("stereo", "Width", 0, 1, 0.68, { step: 0.01, low: "mono", high: "wide alloy", behavior: "Distributes alternating metal modes across stereo." }),
      parameter("level", "Level", 0, 1, 0.48, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the energy-normalized metal bank." }),
    ],
    faust: { symbol: "sy.hat", url: "https://faustlibraries.grame.fr/libs/synths/" },
  }),
  moduleSpec({
    id: "clap-burst", kind: 51, name: "Clap Burst", category: "source", color: "#ff6eaa",
    aliases: ["clap", "hand clap", "burst train", "flam clap", "crowd clap"],
    tags: ["clap", "burst", "noise", "flam", "percussion", "transient"],
    description: "Shapes decorrelated noise into one to four softened attacks plus a diffuse exponential tail for flams, crushed claps, and crowds.",
    execution: "Single-sample · four bounded burst windows", wgsl: "clap = noise * (sum(softBurst[i]) + diffuseTail);",
    auditionKind: "source", auditionPreset: null,
    inputs: [], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Clap rate", 0.1, 16, 1.6, { step: 0.01, unit: "Hz", scale: "log", low: "spaced", high: "roll", behavior: "Sets how often the entire burst cluster repeats." }),
      parameter("tone", "Tone", 0, 1, 0.72, { step: 0.01, low: "broad hands", high: "sharp hands", behavior: "Moves the noise from white toward differentiated high-frequency energy." }),
      parameter("spacing", "Burst spacing", 0.008, 0.06, 0.024, { step: 0.001, unit: "s", low: "tight", high: "flam", behavior: "Sets the time between successive hand-like attacks." }),
      parameter("bursts", "Bursts", 1, 4, 3, { step: 1, low: "single", high: "crowd", behavior: "Sets how many softened noise windows make the initial cluster." }),
      parameter("decay", "Tail decay", 0.03, 2.5, 0.34, { step: 0.01, unit: "s", scale: "log", low: "dry", high: "diffuse", behavior: "Sets the exponential duration of the post-cluster noise." }),
      parameter("tail", "Tail", 0, 1, 0.36, { step: 0.01, low: "bursts only", high: "wash", behavior: "Raises the diffuse noise behind and after the hand bursts." }),
      parameter("stereo", "Width", 0, 1, 0.74, { step: 0.01, low: "mono", high: "crowd width", behavior: "Blends toward independently hashed left and right clap noise." }),
      parameter("level", "Level", 0, 1, 0.58, { step: 0.01, low: "quiet", high: "full", behavior: "Scales burst cluster and tail into a soft ceiling." }),
    ],
    faust: { symbol: "sy.clap", url: "https://faustlibraries.grame.fr/libs/synths/" },
  }),
  moduleSpec({
    id: "fof-voice", kind: 52, name: "FOF Formant Voice", category: "source", color: "#74f7ff",
    aliases: ["fof", "fonction d'onde formantique", "formant grain", "vowel pulse", "chant voice"],
    tags: ["fof", "formant", "grain", "voice", "pulse train", "vowel"],
    description: "Repeats exponentially damped formant sinusoids at the fundamental rate, separating perceived pitch from resonant vocal color.",
    execution: "Single-sample · analytic pitch-synchronous grain", wgsl: "fof = sin(formant * grainAge) * exp(-bandwidth * grainAge) * window;",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("formant", "formant shift", "control"), port("pitch", "pitch", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("frequency", "Pulse pitch", 20, 800, 110, { step: 0.1, unit: "Hz", scale: "log", low: "low voice", high: "high voice", behavior: "Sets how often a new formant grain begins." }),
      parameter("formant", "Formant", 120, 6000, 920, { step: 1, unit: "Hz", scale: "log", low: "dark", high: "bright", behavior: "Sets the principal ringing frequency inside every pitch-synchronous grain." }),
      parameter("bandwidth", "Bandwidth", 20, 1400, 190, { step: 1, unit: "Hz", scale: "log", low: "narrow ring", high: "breathy", behavior: "Sets exponential formant damping; higher values make shorter, wider-band grains." }),
      parameter("duration", "Grain length", 0.001, 0.08, 0.012, { step: 0.001, unit: "s", scale: "log", low: "impulse", high: "ring", behavior: "Sets the maximum raised-sine grain window below one pitch period." }),
      parameter("second", "Second formant", 1, 4, 2.35, { step: 0.01, unit: "×", low: "close", high: "far", behavior: "Adds a quieter formant at a ratio of the principal resonance." }),
      parameter("breath", "Breath", 0, 1, 0.08, { step: 0.01, low: "pure", high: "airy", behavior: "Adds deterministic noise under the same click-safe grain window." }),
      parameter("stereo", "Width", 0, 1, 0.32, { step: 0.01, low: "mono", high: "wide formants", behavior: "Offsets formant phase and breath seeds across stereo." }),
      parameter("level", "Level", 0, 1, 0.48, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the formant-grain voice into a soft ceiling." }),
    ],
    faust: { symbol: "os.imptrain + fi.resonbp", url: "https://faustlibraries.grame.fr/libs/filters/" },
  }),
  moduleSpec({
    id: "full-wave-rectifier", kind: 53, name: "Full-wave Rectifier", category: "shape", color: "#e883ee",
    aliases: ["rectifier", "full wave", "frequency doubler", "absolute shaper"],
    tags: ["rectify", "frequency doubling", "even harmonics", "waveshaper", "dc", "effect"],
    description: "Folds negative waveform halves upward, optionally smoothing the cusp and subtracting the normalized-sine DC estimate.",
    execution: "Single-sample · absolute-value waveshaper", wgsl: "rectified = abs(signal * drive + bias) - dcTrim;",
    auditionKind: "effect", auditionPreset: null,
    inputs: [port("signal", "audio", "audio", { types: ["audio", "stereo"], required: true })], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("drive", "Drive", 0.25, 8, 1, { step: 0.01, unit: "×", low: "gentle", high: "hard fold", behavior: "Scales the signal before its negative half is folded upward." }),
      parameter("bias", "Bias", -1, 1, 0, { step: 0.01, low: "negative", high: "positive", behavior: "Offsets the fold point and changes the balance of even harmonics." }),
      parameter("dcTrim", "DC trim", 0, 1, 1, { step: 0.01, low: "raw positive", high: "centered sine", behavior: "Subtracts up to 2/π, the mean of a unit full-wave-rectified sine." }),
      parameter("mix", "Wet mix", 0, 1, 0.78, { step: 0.01, low: "dry", high: "rectified", behavior: "Crossfades between the input and centered rectifier output." }),
      parameter("softness", "Cusp softness", 0, 1, 0.08, { step: 0.01, low: "hard absolute", high: "rounded", behavior: "Rounds the zero-crossing cusp to reduce the brightest generated harmonics." }),
      parameter("level", "Level", 0, 1.5, 0.78, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the dry/wet result into a soft ceiling." }),
    ],
    faust: { symbol: "abs", url: "https://faustdoc.grame.fr/manual/syntax/#prefix-notation" },
  }),
  moduleSpec({
    id: "mid-side-width", kind: 54, name: "Mid / Side Width", category: "space", color: "#6ca8ff",
    aliases: ["m/s", "mid side", "stereo width", "stereo matrix", "mono maker"],
    tags: ["mid side", "stereo", "width", "matrix", "mono", "effect"],
    description: "Encodes stereo into center and difference components, scales and rotates that plane, then decodes it with peak compensation.",
    execution: "Single-sample · stereo matrix", wgsl: "out = vec2(mid + width * side, mid - width * side);",
    auditionKind: "effect", auditionPreset: null,
    inputs: [port("signal", "stereo", "stereo", { types: ["audio", "stereo"], required: true })], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("width", "Width", 0, 2, 1, { step: 0.01, low: "mono", high: "extra wide", behavior: "Scales the difference channel before stereo decoding." }),
      parameter("mid", "Mid gain", 0, 2, 1, { step: 0.01, unit: "×", low: "no center", high: "strong center", behavior: "Scales material common to both channels." }),
      parameter("side", "Side gain", 0, 2, 1, { step: 0.01, unit: "×", low: "no difference", high: "strong difference", behavior: "Scales channel-difference material before Width." }),
      parameter("rotation", "M/S rotation", -1, 1, 0, { step: 0.01, low: "rotate left", high: "rotate right", behavior: "Rotates the mid/side coordinate plane by up to 45 degrees." }),
      parameter("mix", "Wet mix", 0, 1, 1, { step: 0.01, low: "original", high: "matrix", behavior: "Crossfades between the original stereo and decoded matrix result." }),
      parameter("level", "Level", 0, 1.5, 1, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the final matrix output after peak compensation." }),
    ],
    faust: { symbol: "sp.stereoize", url: "https://faustlibraries.grame.fr/libs/spats/" },
  }),
  moduleSpec({
    id: "cyclic-fractal-noise", kind: 55, name: "Cyclic Fractal Noise", category: "source", color: "#a78bff",
    aliases: ["cyclic noise", "fractal noise", "procedural weather", "shadertoy noise", "liquid noise"],
    tags: ["cyclic noise", "fractal", "procedural", "noise", "shadertoy", "texture"],
    description: "Loops a 3D seed orbit through a rotated, trigonometric octave field for coherent textures ranging from air to liquid machinery.",
    execution: "Single-sample · 1–6 fixed cyclic-noise octaves", wgsl: "field += cross(cos(p), sin(p.yzx)) * amplitude;",
    auditionKind: "source", auditionPreset: null,
    inputs: [port("control", "weather CV", "control")], outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("rate", "Orbit rate", 0.01, 8000, 72, { step: 0.01, unit: "Hz", scale: "log", low: "slow weather", high: "bright noise", behavior: "Sets how quickly the closed seed path is traversed." }),
      parameter("octaves", "Octaves", 1, 6, 5, { step: 1, low: "simple", high: "dense", behavior: "Bounds the number of rotated procedural field layers." }),
      parameter("lacunarity", "Lacunarity", 1.1, 3, 1.78, { step: 0.01, low: "related layers", high: "fine detail", behavior: "Scales coordinates between fractal octaves." }),
      parameter("warp", "Warp", 0, 3, 1.05, { step: 0.01, low: "smooth", high: "turbulent", behavior: "Feeds trigonometric cross-components back into the next octave coordinate." }),
      parameter("color", "Color", 0, 1, 0.46, { step: 0.01, low: "round", high: "folded", behavior: "Changes field phase offsets and the balance of its three readout axes." }),
      parameter("cvDepth", "Weather CV", 0, 2, 0.72, { step: 0.01, low: "fixed", high: "wide deformation", behavior: "Moves the seed orbit and color from the control input." }),
      parameter("stereo", "Width", 0, 1, 0.84, { step: 0.01, low: "mono", high: "wide field", behavior: "Blends the left field axis toward an independently structured right axis." }),
      parameter("level", "Level", 0, 1, 0.46, { step: 0.01, low: "quiet", high: "full", behavior: "Scales the normalized procedural field into a soft ceiling." }),
    ],
    faust: { symbol: "no.noise", url: "https://faustlibraries.grame.fr/libs/noises/" },
  }),
  moduleSpec({
    id: "bitmask-rhythm", kind: 56, name: "Bitmask Rhythm", category: "control", color: "#ff6eaa",
    aliases: ["bitmask gate", "binary rhythm", "hex sequencer", "bit pattern", "algorithmic gate"],
    tags: ["bitmask", "rhythm", "binary", "gate", "sequence", "accent"],
    description: "Reads a 16-bit pattern and accent word on a swung step grid, producing a deterministic click-safe control gate.",
    execution: "Single-sample · u32 mask test", wgsl: "hit = (mask & (1u << step)) != 0u;",
    auditionKind: "gate", auditionPreset: null,
    inputs: [], outputs: [port("gate", "gate", "control")],
    params: [
      parameter("rate", "Step rate", 0.25, 32, 8, { step: 0.01, unit: "Hz", scale: "log", low: "slow", high: "rapid", behavior: "Sets how quickly the mask reader advances." }),
      parameter("steps", "Steps", 1, 16, 16, { step: 1, low: "short mask", high: "full word", behavior: "Sets how many low-order bits form the repeating cycle." }),
      parameter("mask", "Gate mask", 0, 65535, 43690, { step: 1, low: "empty", high: "all bits", behavior: "Stores the 16 on/off gate positions as an exactly representable integer." }),
      parameter("rotation", "Rotation", 0, 15, 0, { step: 1, low: "original", high: "shifted", behavior: "Rotates the bit reader without rewriting the mask." }),
      parameter("width", "Gate width", 0.03, 1, 0.48, { step: 0.01, low: "trigger", high: "held", behavior: "Sets active gate duration with a short smoothed attack and release." }),
      parameter("accentMask", "Accent mask", 0, 65535, 34952, { step: 1, low: "no accents", high: "all accents", behavior: "Stores a second 16-bit word that marks emphasized active steps." }),
      parameter("accent", "Accent depth", 0, 1, 0.34, { step: 0.01, low: "even", high: "strong pattern", behavior: "Lowers unaccented gate levels while accented bits remain at one." }),
      parameter("swing", "Swing", 0, 0.42, 0.1, { step: 0.01, low: "even", high: "long / short", behavior: "Alternates bit-step lengths while preserving each two-step duration." }),
    ],
    faust: { symbol: "ba.pulse", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),
  moduleSpec({
    id: "morph-crossfade", kind: 66, name: "Morph Crossfade", category: "compose", color: "#91ff63",
    aliases: ["crossfade", "xfade", "morph", "equal power mix"],
    tags: ["crossfade", "morph", "equal power", "two input", "cv", "utility"],
    description: "Morphs between two stereo signals with equal-power gains, an optional control input, and adjustable motion around the center.",
    execution: "Single-sample · equal-power stereo crossfade", wgsl: "out = a * cos(morph * PI / 2) + b * sin(morph * PI / 2);",
    auditionKind: "effect", auditionPreset: null,
    inputs: [
      port("a", "signal A", "stereo", { types: ["audio", "stereo"], required: true }),
      port("b", "signal B", "stereo", { types: ["audio", "stereo"] }),
      port("morph", "morph CV", "control"),
    ],
    outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("morph", "Morph", 0, 1, 0.5, { step: 0.01, low: "signal A", high: "signal B", behavior: "Moves continuously between the two inputs with equal-power gains." }),
      parameter("cvDepth", "CV depth", -1, 1, 0, { step: 0.01, low: "reverse motion", high: "forward motion", behavior: "Sets how strongly the morph control moves the crossfade position and can reverse its direction." }),
      parameter("curve", "Response", 0.25, 4, 1, { step: 0.01, low: "wide center", high: "fast center", behavior: "Reshapes crossfade travel while preserving both endpoints and the exact center." }),
      parameter("gainA", "A gain", 0, 2, 1, { step: 0.01, unit: "×", low: "remove A", high: "boost A", behavior: "Trims the first input before its equal-power gain is applied." }),
      parameter("gainB", "B gain", 0, 2, 1, { step: 0.01, unit: "×", low: "remove B", high: "boost B", behavior: "Trims the second input before its equal-power gain is applied." }),
      parameter("centerTrim", "Center trim", 0, 1, 0, { step: 0.01, low: "full equal power", high: "correlation-safe", behavior: "Reduces the center overlap when both inputs contain strongly correlated material." }),
      parameter("level", "Level", 0, 1.5, 1, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the completed morph after its gain law." }),
    ],
    faust: { symbol: "si.smoo", url: "https://faustlibraries.grame.fr/libs/signals/" },
  }),
  moduleSpec({
    id: "harmonic-exciter", kind: 67, name: "Harmonic Exciter", category: "shape", color: "#e883ee",
    aliases: ["exciter", "harmonic enhancer", "warmth", "air waveshaper"],
    tags: ["exciter", "waveshaper", "harmonics", "chebyshev", "warmth", "effect"],
    description: "Adds controlled second-, third-, and fifth-order color with a zero-safe asymmetric branch and a bounded output ceiling.",
    execution: "Single-sample · bounded polynomial waveshaper", wgsl: "excited = x + even*T2(x) + warm*T3(x) + air*T5(x);",
    auditionKind: "effect", auditionPreset: null,
    inputs: [
      port("signal", "audio", "stereo", { types: ["audio", "stereo"], required: true }),
      port("drive", "drive CV", "control"),
    ],
    outputs: [port("out", "stereo", "stereo")],
    params: [
      parameter("drive", "Drive", 0.5, 4, 1.35, { step: 0.01, unit: "×", low: "subtle", high: "dense", behavior: "Raises the signal into the harmonic polynomial while its domain remains bounded." }),
      parameter("warmth", "Third harmonic", 0, 1, 0.24, { step: 0.01, low: "clean", high: "warm", behavior: "Adds a lower odd harmonic that thickens fundamentals without a hard corner." }),
      parameter("air", "Fifth harmonic", 0, 1, 0.08, { step: 0.01, low: "dark", high: "bright", behavior: "Adds a quieter upper odd harmonic for presence and edge." }),
      parameter("even", "Even color", 0, 1, 0.06, { step: 0.01, low: "symmetric", high: "asymmetric", behavior: "Adds a zero-referenced second-order branch for tube-like asymmetry." }),
      parameter("cvDepth", "Drive CV", 0, 2, 0, { step: 0.01, low: "fixed drive", high: "dynamic drive", behavior: "Lets a control signal push the excitation amount without changing the dry level." }),
      parameter("mix", "Wet mix", 0, 1, 0.42, { step: 0.01, low: "dry", high: "excited", behavior: "Crossfades from the original signal to the generated harmonic color." }),
      parameter("ceiling", "Ceiling", 0.5, 1.5, 0.95, { step: 0.01, low: "restrained", high: "open", behavior: "Sets the smooth hyperbolic ceiling that keeps bright settings bounded." }),
      parameter("level", "Level", 0, 1.5, 0.9, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the dry/wet result after excitation." }),
    ],
    faust: { symbol: "ef.cubicnl", url: "https://faustlibraries.grame.fr/libs/misceffects/" },
  }),
  moduleSpec({
    id: "cv-curve-mapper", kind: 68, name: "CV Curve Mapper", category: "control", color: "#ffda57",
    aliases: ["cv mapper", "curve", "control shaper", "modulation curve", "invert cv"],
    tags: ["control", "mapping", "curve", "bipolar", "unipolar", "utility"],
    description: "Scales, offsets, bends, inverts, and limits a control signal so one modulation source can suit very different destinations.",
    execution: "Single-sample · signed or unipolar power curve", wgsl: "mapped = sign(x) * pow(abs(x), curve);",
    auditionKind: "control", auditionPreset: null,
    inputs: [port("control", "control", "control", { required: true })],
    outputs: [port("out", "control", "control")],
    params: [
      parameter("gain", "Gain", -4, 4, 1, { step: 0.01, unit: "×", low: "inverted", high: "expanded", behavior: "Scales the incoming control; negative values invert its direction." }),
      parameter("offset", "Offset", -2, 2, 0, { step: 0.01, low: "shift down", high: "shift up", behavior: "Moves the control range before curve shaping." }),
      parameter("curve", "Curve", 0.2, 5, 1, { step: 0.01, low: "early response", high: "late response", behavior: "Changes whether small or large input movements dominate the output." }),
      parameter("polarity", "Polarity", 0, 1, 0, { step: 1, options: ["Bipolar", "Unipolar"], low: "signed", high: "positive", behavior: "Chooses signed shaping around zero or a 0–1 control range." }),
      parameter("limit", "Limit", 0.1, 4, 1, { step: 0.01, low: "narrow", high: "wide", behavior: "Clamps the shaped control to a predictable destination-safe range." }),
      parameter("mix", "Shape mix", 0, 1, 1, { step: 0.01, low: "linear", high: "curved", behavior: "Blends between the scaled linear control and its curved version." }),
    ],
    faust: { symbol: "ba.sAndH", url: "https://faustlibraries.grame.fr/libs/basics/" },
  }),
]);

// The host shader already supplies SAMPLE_RATE, PI, TAU, phaseAtSample,
// hashU32, softClip, smootherstep01, oscillatorWave, and arpScalePitch.
// It also declares organ_rank as a read-only storage array before these cases
// are compiled. Every helper below is stateless with respect to output samples.
export const SHADER_SYNTH_PLAYGROUND_EXTRA_HELPERS = /* wgsl */ `
fn extraScaleSize(scale: u32) -> u32 {
  switch scale {
    case 1u: { return 7u; }
    case 2u: { return 7u; }
    case 3u: { return 5u; }
    case 4u: { return 6u; }
    case 5u: { return 8u; }
    case 6u: { return 24u; }
    default: { return 12u; }
  }
}

// Returns absolute step, sample within step, step length, and pair parity.
fn extraStepCoordinates(sampleIndex: u32, rate: f32, swing: f32) -> vec4<u32> {
  let safeRate = max(rate, 0.001);
  let pairSamples = max(u32(round(SAMPLE_RATE * 2.0 / safeRate)), 2u);
  let pairIndex = sampleIndex / pairSamples;
  let withinPair = sampleIndex % pairSamples;
  let swingAmount = clamp(swing, 0.0, 0.42);
  let requestedFirst = u32(round(f32(pairSamples) * 0.5 * (1.0 + swingAmount)));
  let firstSamples = min(max(requestedFirst, 1u), pairSamples - 1u);
  var localSample = withinPair;
  var stepSamples = firstSamples;
  var parity = 0u;
  if (withinPair >= firstSamples) {
    localSample = withinPair - firstSamples;
    stepSamples = pairSamples - firstSamples;
    parity = 1u;
  }
  return vec4<u32>(pairIndex * 2u + parity, localSample, stepSamples, parity);
}

fn extraEdgeGate(localSample: u32, stepSamples: u32, requestedWidth: f32) -> f32 {
  let safeStep = max(stepSamples, 1u);
  let activeSamples = min(
    max(u32(round(f32(safeStep) * clamp(requestedWidth, 0.02, 1.0))), 1u),
    safeStep
  );
  if (localSample >= activeSamples) { return 0.0; }
  let edgeSamples = min(
    max(u32(round(SAMPLE_RATE * 0.0025)), 1u),
    max(activeSamples / 3u, 1u)
  );
  let boundedLocal = min(localSample, activeSamples - 1u);
  let remaining = activeSamples - 1u - boundedLocal;
  let attack = smootherstep01(f32(boundedLocal) / f32(edgeSamples));
  let release = smootherstep01(f32(remaining) / f32(edgeSamples));
  return attack * release;
}

fn extraChordSize(chord: u32) -> u32 {
  if (chord >= 2u && chord <= 5u) { return 4u; }
  return 3u;
}

fn extraChordTone(position: u32, chord: u32) -> f32 {
  let note = position % extraChordSize(chord);
  switch chord {
    case 0u: {
      if (note == 1u) { return 4.0; }
      if (note == 2u) { return 7.0; }
      return 0.0;
    }
    case 1u: {
      if (note == 1u) { return 3.0; }
      if (note == 2u) { return 7.0; }
      return 0.0;
    }
    case 2u: {
      if (note == 1u) { return 4.0; }
      if (note == 2u) { return 7.0; }
      if (note == 3u) { return 10.0; }
      return 0.0;
    }
    case 3u: {
      if (note == 1u) { return 4.0; }
      if (note == 2u) { return 7.0; }
      if (note == 3u) { return 11.0; }
      return 0.0;
    }
    case 4u: {
      if (note == 1u) { return 3.0; }
      if (note == 2u) { return 7.0; }
      if (note == 3u) { return 10.0; }
      return 0.0;
    }
    case 5u: {
      if (note == 1u) { return 3.0; }
      if (note == 2u) { return 6.0; }
      if (note == 3u) { return 9.0; }
      return 0.0;
    }
    case 6u: {
      if (note == 1u) { return 2.0; }
      if (note == 2u) { return 7.0; }
      return 0.0;
    }
    default: {
      if (note == 1u) { return 5.0; }
      if (note == 2u) { return 7.0; }
      return 0.0;
    }
  }
}

fn extraChordPatternIndex(absoluteStep: u32, count: u32, pattern: u32) -> u32 {
  let safeCount = max(count, 1u);
  let position = absoluteStep % safeCount;
  if (pattern == 1u) { return safeCount - 1u - position; }
  if (pattern == 2u) {
    let period = max(safeCount * 2u - 2u, 1u);
    let folded = absoluteStep % period;
    return select(folded, period - folded, folded >= safeCount);
  }
  if (pattern == 3u) { return (position * 5u) % safeCount; }
  return position;
}

fn extraChordPitch(position: u32, chord: u32, voicing: u32) -> f32 {
  let size = extraChordSize(chord);
  let inversion = min(voicing, 2u);
  let shifted = position + inversion;
  var octave = shifted / size;
  if (voicing == 4u && (position & 1u) == 1u) { octave += 1u; }
  return extraChordTone(shifted % size, chord) + f32(octave) * 12.0;
}

fn extraEuclideanHit(position: u32, steps: u32, pulses: u32) -> bool {
  let safeSteps = max(steps, 1u);
  let safePulses = min(max(pulses, 1u), safeSteps);
  return ((position % safeSteps) * safePulses) % safeSteps < safePulses;
}

fn extraEuclideanOrdinal(rotatedStep: u32, steps: u32, pulses: u32) -> u32 {
  var ordinal = 0u;
  for (var position = 0u; position < 128u; position += 1u) {
    if (position >= rotatedStep || position >= steps) { break; }
    if (extraEuclideanHit(position, steps, pulses)) { ordinal += 1u; }
  }
  return ordinal;
}

fn extraRandomWalkDegree(
  absoluteStep: u32,
  length: u32,
  noteCount: u32,
  stride: u32,
  seed: u32
) -> u32 {
  let safeLength = max(length, 1u);
  let safeCount = max(noteCount, 1u);
  let cycle = absoluteStep / safeLength;
  let position = absoluteStep % safeLength;
  var degree = i32(floor(hashU32(cycle * 2246822519u + seed) * f32(safeCount)));
  let span = stride * 2u + 1u;
  for (var walkIndex = 0u; walkIndex < 128u; walkIndex += 1u) {
    if (walkIndex >= position) { break; }
    let randomStep = u32(floor(hashU32(cycle * 3266489917u + walkIndex * 668265263u + seed) * f32(span)));
    degree += i32(randomStep) - i32(stride);
    degree = degree % i32(safeCount);
    if (degree < 0) { degree += i32(safeCount); }
  }
  return u32(degree);
}

fn extraSoftWindow(age: f32, start: f32, duration: f32, requestedEdge: f32) -> f32 {
  let safeDuration = max(duration, 0.000001);
  let local = age - start;
  if (local < 0.0 || local >= safeDuration) { return 0.0; }
  let edge = clamp(requestedEdge, 0.000001, safeDuration * 0.45);
  return smootherstep01(local / edge) * smootherstep01((safeDuration - local) / edge);
}

fn extraVowelFormants(scan: f32) -> vec3<f32> {
  let position = clamp(scan, 0.0, 1.0) * 4.0;
  let segment = u32(min(floor(position), 3.0));
  let amount = position - f32(segment);
  var lower = vec3<f32>(800.0, 1150.0, 2900.0);
  var upper = vec3<f32>(400.0, 1700.0, 2600.0);
  if (segment == 1u) {
    lower = vec3<f32>(400.0, 1700.0, 2600.0);
    upper = vec3<f32>(350.0, 2000.0, 2800.0);
  } else if (segment == 2u) {
    lower = vec3<f32>(350.0, 2000.0, 2800.0);
    upper = vec3<f32>(450.0, 800.0, 2830.0);
  } else if (segment == 3u) {
    lower = vec3<f32>(450.0, 800.0, 2830.0);
    upper = vec3<f32>(325.0, 700.0, 2530.0);
  }
  return mix(lower, upper, amount);
}

fn extraTerrainValue(point: vec2<f32>, terrain: u32, warp: f32) -> f32 {
  let p = point * (2.0 + warp * 0.55);
  if (terrain == 0u) {
    return sin(p.x * 2.1 + sin(p.y * 1.7) * warp) * cos(p.y * 2.7 - sin(p.x) * 0.4);
  }
  if (terrain == 1u) {
    return sin(length(p + vec2<f32>(sin(p.y), cos(p.x)) * warp * 0.25) * 5.0);
  }
  if (terrain == 2u) {
    return sin(p.x * 3.1) * sin(p.y * 3.7 + sin(p.x * 1.3) * warp);
  }
  if (terrain == 3u) {
    let q = p + vec2<f32>(sin(p.y * 2.3), cos(p.x * 1.9)) * warp;
    return sin(q.x * 2.4 + sin(q.y * 2.8)) * cos(q.y * 1.6 - cos(q.x));
  }
  if (terrain == 4u) {
    let cells = abs(fract(p * 0.72) * 2.0 - vec2<f32>(1.0));
    let ridge = 1.0 - min(abs(cells.x - cells.y) * (3.0 + warp), 1.0);
    return ridge * 2.0 - 1.0;
  }
  var q = p;
  var sum = 0.0;
  var amplitude = 0.58;
  var weight = 0.0;
  for (var octave = 0u; octave < 4u; octave += 1u) {
    q = abs(fract(q * 0.3183099 + vec2<f32>(0.17, 0.43)) * 2.0 - vec2<f32>(1.0));
    sum += sin((q.x + q.y * 0.73) * TAU) * amplitude;
    weight += amplitude;
    amplitude *= 0.52;
    q = q.yx * (1.55 + warp * 0.18) + vec2<f32>(0.31, -0.27);
  }
  return clamp(sum / max(weight, 0.001), -1.0, 1.0);
}

fn extraFractalSample(phase: f32, seed: f32, iterations: u32, fold: f32) -> f32 {
  let angle = phase * TAU;
  var point = vec2<f32>(cos(angle), sin(angle)) * (0.62 + abs(seed) * 0.16);
  point += vec2<f32>(seed * 0.27, seed * -0.19);
  for (var iteration = 0u; iteration < 12u; iteration += 1u) {
    if (iteration >= iterations) { break; }
    let radiusSquared = max(dot(point, point), 0.075);
    let offset = vec2<f32>(1.04 + seed * 0.21, 0.76 - seed * 0.17);
    point = abs(point) / radiusSquared - offset;
    point = clamp(point, vec2<f32>(-6.0), vec2<f32>(6.0));
  }
  return sin((point.x + point.y * 0.73) * max(fold, 0.01));
}

fn extraCyclicField(
  origin: vec3<f32>,
  octaves: u32,
  lacunarity: f32,
  warp: f32,
  color: f32
) -> vec3<f32> {
  var point = origin;
  var field = vec3<f32>(0.0);
  var amplitude = 0.58;
  var weight = 0.0;
  for (var octave = 0u; octave < 6u; octave += 1u) {
    if (octave >= octaves) { break; }
    let rotated = vec3<f32>(
      point.y - point.z * 0.31,
      point.z + point.x * 0.47,
      point.x - point.y * 0.53
    );
    point = rotated * lacunarity
      + sin(point.zxy + vec3<f32>(0.7, 1.9, 3.1) + color * 2.0) * warp;
    let wave = cross(
      cos(point + vec3<f32>(color, 0.0, -color)),
      sin(point.yzx + vec3<f32>(1.3, 2.1, 0.4))
    );
    field += wave * amplitude;
    weight += amplitude;
    amplitude *= mix(0.58, 0.38, color);
  }
  return field / max(weight, 0.001);
}
`;

// Insert this text directly inside the host evaluateNode switch. It deliberately
// has no outer switch so the host retains one fixed parameter-ramp path.
export const SHADER_SYNTH_PLAYGROUND_EXTRA_CASES = /* wgsl */ `
    case 36u: {
      let rate = clamp(p0.x, 0.001, SAMPLE_RATE * 0.45);
      let increment = rate / SAMPLE_RATE;
      let requestedShape = u32(clamp(round(p0.z), 0.0, 3.0));
      var waveform = 0u;
      if (requestedShape == 1u) { waveform = 1u; }
      if (requestedShape == 2u) { waveform = 3u; }
      if (requestedShape == 3u) { waveform = 2u; }
      let centerPhase = phaseAtSample(sampleIndex, rate) + p1.x;
      let leftPhase = fract(centerPhase - p1.y * 0.5);
      let rightPhase = fract(centerPhase + p1.y * 0.5);
      let leftWave = oscillatorWave(leftPhase, increment, waveform, 0.5);
      let rightWave = oscillatorWave(rightPhase, increment, waveform, 0.5);
      let polarity = clamp(p0.w, 0.0, 1.0);
      let modulator = mix(
        vec2<f32>(0.5) + vec2<f32>(leftWave, rightWave) * 0.5,
        vec2<f32>(leftWave, rightWave),
        polarity
      );
      let gain = mix(vec2<f32>(1.0), modulator, clamp(p0.y, 0.0, 1.0));
      let wet = inputA * gain;
      result = softClip(mix(inputA, wet, clamp(p1.z, 0.0, 1.0)) * p1.w);
    }
    case 37u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, p1.w);
      let chord = u32(clamp(round(p0.y), 0.0, 7.0));
      let voicing = u32(clamp(round(p0.z), 0.0, 4.0));
      let pattern = u32(clamp(round(p0.w), 0.0, 3.0));
      let chordSize = extraChordSize(chord);
      var noteCount = chordSize;
      if (voicing >= 3u) { noteCount *= 2u; }
      let currentIndex = extraChordPatternIndex(coordinates.x, noteCount, pattern);
      let nextIndex = extraChordPatternIndex(coordinates.x + 1u, noteCount, pattern);
      let stepPhase = f32(coordinates.y) / f32(max(coordinates.z - 1u, 1u));
      let glideStart = 1.0 - clamp(p1.z, 0.0, 0.95);
      let glide = smootherstep01((stepPhase - glideStart) / max(1.0 - glideStart, 0.0001));
      let root = inputA.x + p1.x;
      let currentPitch = root + extraChordPitch(currentIndex, chord, voicing);
      let nextPitch = root + extraChordPitch(nextIndex, chord, voicing);
      let gate = extraEdgeGate(coordinates.y, coordinates.z, p1.y);
      result = vec2<f32>(mix(currentPitch, nextPitch, glide), gate);
    }
    case 38u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let steps = u32(clamp(round(p0.y), 2.0, 128.0));
      let pulses = min(u32(clamp(round(p0.z), 1.0, 128.0)), steps);
      let rotation = u32(max(round(p0.w), 0.0)) % steps;
      let cycleStep = coordinates.x % steps;
      let rotatedStep = (cycleStep + rotation) % steps;
      let hit = extraEuclideanHit(rotatedStep, steps, pulses);
      let ordinal = extraEuclideanOrdinal(rotatedStep, steps, pulses);
      let scale = u32(clamp(round(p1.x), 0.0, 6.0));
      let octaves = u32(clamp(round(p1.y), 1.0, 4.0));
      let noteCount = extraScaleSize(scale) * octaves;
      let currentDegree = arpSpanDegree(ordinal, pulses, noteCount);
      let nextOrdinal = (ordinal + 1u) % max(pulses, 1u);
      let nextDegree = arpSpanDegree(nextOrdinal, pulses, noteCount);
      let stepPhase = f32(coordinates.y) / f32(max(coordinates.z - 1u, 1u));
      let glideStart = 1.0 - clamp(p1.w, 0.0, 0.95);
      let glide = smootherstep01((stepPhase - glideStart) / max(1.0 - glideStart, 0.0001));
      let pitch = inputA.x + mix(
        arpScalePitch(currentDegree, scale),
        arpScalePitch(nextDegree, scale),
        glide
      );
      let gate = select(0.0, extraEdgeGate(coordinates.y, coordinates.z, p1.z), hit);
      result = vec2<f32>(pitch, gate);
    }
    case 39u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, 0.0);
      let length = u32(clamp(round(p0.y), 2.0, 128.0));
      let scale = u32(clamp(round(p0.z), 0.0, 6.0));
      let octaves = u32(clamp(round(p0.w), 1.0, 4.0));
      let noteCount = extraScaleSize(scale) * octaves;
      let stride = u32(clamp(round(p1.x), 1.0, 6.0));
      let seed = u32(round(abs(p1.y)));
      let currentDegree = extraRandomWalkDegree(coordinates.x, length, noteCount, stride, seed);
      let nextDegree = extraRandomWalkDegree(coordinates.x + 1u, length, noteCount, stride, seed);
      let stepPhase = f32(coordinates.y) / f32(max(coordinates.z - 1u, 1u));
      let glideStart = 1.0 - clamp(p1.w, 0.0, 0.95);
      let glide = smootherstep01((stepPhase - glideStart) / max(1.0 - glideStart, 0.0001));
      let pitch = inputA.x + mix(
        arpScalePitch(currentDegree, scale),
        arpScalePitch(nextDegree, scale),
        glide
      );
      result = vec2<f32>(pitch, extraEdgeGate(coordinates.y, coordinates.z, p1.z));
    }
    case 40u: {
      let frequency = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.45);
      let availableRanks = min(arrayLength(&organ_rank) / 2u, 9u);
      let requestedRanks = min(u32(clamp(round(p0.y), 1.0, 9.0)), availableRanks);
      let control = clamp(inputA.x, -1.0, 1.0);
      let timbre = clamp(p0.z + control * p1.w * 0.5, 0.0, 1.0);
      let choraleAmount = clamp(p0.w + abs(control) * p1.w * 0.22, 0.0, 1.0);
      let rotorAmount = clamp(p1.x, 0.0, 1.0);
      let width = clamp(p1.y, 0.0, 1.0);
      let choralePhase = phaseAtSample(sampleIndex, 0.46);
      let rotorPhase = phaseAtSample(sampleIndex, mix(0.72, 4.8, rotorAmount));
      let rotorWave = sin(TAU * rotorPhase);
      var voice = vec2<f32>(0.0);
      var energy = 0.0;
      for (var rankIndex = 0u; rankIndex < 9u; rankIndex += 1u) {
        if (rankIndex >= requestedRanks) { break; }
        let rank = organ_rank[organRankOffset + rankIndex];
        let order = f32(rankIndex + 1u);
        let ratio = clamp(rank.x, 0.125, 16.0);
        let rankHz = frequency * ratio;
        let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, rankHz);
        if (bandGain <= 0.0001) { continue; }
        let brightness = pow(ratio, (timbre - 0.5) * 0.7);
        let rankAmPhase = phaseAtSample(sampleIndex, clamp(rank.z, 0.0, 30.0));
        let rankAm = mix(
          1.0,
          0.5 + 0.5 * sin(TAU * rankAmPhase + order * 0.71),
          clamp(rank.w, 0.0, 1.0)
        );
        let rankLevel = clamp(rank.y, 0.0, 1.0) * brightness * rankAm * bandGain;
        let basePhase = TAU * phaseAtSample(sampleIndex, rankHz);
        let chorale = sin(TAU * choralePhase + order * 0.53) * choraleAmount * (0.018 + order * 0.003);
        let side = select(-1.0, 1.0, (rankIndex & 1u) == 0u);
        let stereoPhase = side * width * (0.012 + rotorAmount * 0.034);
        voice += vec2<f32>(
          sin(basePhase + chorale + stereoPhase),
          sin(basePhase - chorale - stereoPhase)
        ) * rankLevel;
        energy += rankLevel * rankLevel;
      }
      let rotorDepth = rotorAmount * width * 0.17;
      let rotorGain = vec2<f32>(1.0 - rotorWave * rotorDepth, 1.0 + rotorWave * rotorDepth);
      result = softClip(voice / max(sqrt(energy), 1.0) * rotorGain * p1.z * 0.9);
    }
    case 41u: {
      let frequency = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.44);
      let voiceCount = u32(clamp(round(p0.y), 1.0, 9.0));
      let requestedWave = u32(clamp(round(p1.z), 0.0, 2.0));
      var waveform = 2u;
      if (requestedWave == 1u) { waveform = 1u; }
      if (requestedWave == 2u) { waveform = 3u; }
      let motionDepth = clamp(p1.y * (1.0 + inputA.x * 0.5), 0.0, 1.5);
      var voice = vec2<f32>(0.0);
      for (var lane = 0u; lane < 9u; lane += 1u) {
        if (lane >= voiceCount) { break; }
        var position = 0.0;
        if (voiceCount > 1u) {
          position = f32(lane) / f32(voiceCount - 1u) * 2.0 - 1.0;
        }
        let detuneRatio = exp2(position * p0.z / 1200.0);
        let laneHz = clamp(frequency * detuneRatio, 1.0, SAMPLE_RATE * 0.45);
        let driftRate = max(p1.x * (1.0 + f32(lane) * 0.071), 0.001);
        let seedPhase = hashU32(lane * 104729u + 8191u);
        let driftPhase = fract(phaseAtSample(sampleIndex, driftRate) + seedPhase);
        let driftFraction = (exp2(p0.z * 0.15 / 1200.0) - 1.0) * motionDepth;
        let driftCycles = -laneHz * driftFraction / (TAU * driftRate) * cos(TAU * driftPhase);
        let phase = fract(phaseAtSample(sampleIndex, laneHz) + seedPhase + driftCycles);
        let sampleValue = oscillatorWave(phase, laneHz / SAMPLE_RATE, waveform, 0.5);
        let pan = position * clamp(p0.w, 0.0, 1.0);
        let gains = sqrt(max(vec2<f32>(0.5 * (1.0 - pan), 0.5 * (1.0 + pan)), vec2<f32>(0.0)));
        voice += gains * sampleValue;
      }
      result = softClip(voice * inverseSqrt(f32(voiceCount)) * p1.w * 0.78);
    }
    case 42u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let eventSample = sampleIndex % periodSamples;
      let age = f32(eventSample) / SAMPLE_RATE;
      let periodSeconds = f32(periodSamples) / SAMPLE_RATE;
      let duration = min(max(p0.w, 0.0001), periodSeconds * 0.96);
      if (age < duration) {
        let pitchRatio = exp2((inputA.x + render_info.performancePitch) / 12.0);
        let startHz = clamp(p0.y * pitchRatio, 1.0, SAMPLE_RATE * 0.45);
        let endHz = clamp(p0.z * pitchRatio, 1.0, SAMPLE_RATE * 0.45);
        let curve = clamp(p1.x, 0.2, 5.0);
        let unitAge = clamp(age / duration, 0.0, 1.0);
        let cycles = startHz * age
          + (endHz - startHz) * duration * pow(unitAge, curve + 1.0) / (curve + 1.0);
        let angle = TAU * cycles;
        let width = clamp(p1.z, 0.0, 1.0);
        let phaseDetail = sin(angle * 0.503 + unitAge * PI) * width * 0.18;
        let tone = vec2<f32>(sin(angle + phaseDetail), sin(angle - phaseDetail));
        let overtone = vec2<f32>(sin(angle * 2.003 + width), sin(angle * 2.003 - width)) * width * 0.12;
        let edge = min(0.012, duration * 0.2);
        let envelope = extraSoftWindow(age, 0.0, duration, edge) * exp(-age / max(p1.y, 0.001));
        result = (tone + overtone) * envelope * p1.w * 0.82;
      }
    }
    case 43u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let eventIndex = sampleIndex / periodSamples;
      let eventSample = sampleIndex % periodSamples;
      let age = f32(eventSample) / SAMPLE_RATE;
      let periodSeconds = f32(periodSamples) / SAMPLE_RATE;
      let duration = min(max(p0.y, 0.0001), periodSeconds * 0.96);
      if (age < duration) {
        let unitAge = clamp(age / duration, 0.0, 1.0);
        let width = clamp(p1.z, 0.0, 1.0);
        let texture = clamp(p1.y, 0.0, 1.0);
        var air = vec2<f32>(0.0);
        for (var lane = 0u; lane < 8u; lane += 1u) {
          let seed = eventIndex * 2246822519u + lane * 3266489917u + 374761393u;
          let pitchScatter = (hashU32(seed) - 0.5) * clamp(p1.x, 0.0, 1.0) * 5.0;
          let startHz = clamp(p0.z * exp2(render_info.performancePitch / 12.0) * exp2(pitchScatter), 8.0, SAMPLE_RATE * 0.42);
          let endHz = clamp(startHz * p0.w, 8.0, SAMPLE_RATE * 0.44);
          let cycles = startHz * age + (endHz - startHz) * age * age / max(2.0 * duration, 0.0001);
          let phaseOffset = hashU32(seed ^ 0x9e3779b9u);
          let angle = TAU * (cycles + phaseOffset);
          let turbulence = sin(angle * 1.371 + f32(lane) * 0.73) * texture * 1.8;
          let particle = sin(angle + turbulence);
          let currentHz = mix(startHz, endHz, unitAge);
          let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, currentHz);
          let pan = (hashU32(seed ^ 0x85ebca6bu) * 2.0 - 1.0) * width;
          air += vec2<f32>(particle * (1.0 - pan * 0.72), particle * (1.0 + pan * 0.72)) * bandGain;
        }
        let previousIndex = select(0u, sampleIndex - 1u, sampleIndex > 0u);
        let hissLeft = (hashU32(sampleIndex * 747796405u + eventIndex) - hashU32(previousIndex * 747796405u + eventIndex)) * 0.7071;
        let hissRightRaw = (hashU32(sampleIndex * 2891336453u + eventIndex + 17u) - hashU32(previousIndex * 2891336453u + eventIndex + 17u)) * 0.7071;
        let hiss = vec2<f32>(hissLeft, mix(hissLeft, hissRightRaw, width)) * texture * 0.28;
        let sineWindow = pow(max(sin(PI * unitAge), 0.0), 0.65);
        let edgeWindow = smootherstep01(unitAge / 0.025) * smootherstep01((1.0 - unitAge) / 0.025);
        let envelope = sineWindow * edgeWindow;
        result = softClip((air * 0.194 + hiss) * envelope * p1.w);
      }
    }
    case 44u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let eventSample = sampleIndex % periodSamples;
      let age = f32(eventSample) / SAMPLE_RATE;
      let periodSeconds = f32(periodSamples) / SAMPLE_RATE;
      let duration = min(max(p0.w, 0.0001), periodSeconds * 0.96);
      if (age < duration) {
        let pitchRatio = exp2((inputA.x + render_info.performancePitch) / 12.0);
        let startHz = clamp(p0.y * pitchRatio, 1.0, SAMPLE_RATE * 0.45);
        let endHz = clamp(p0.z * pitchRatio, 1.0, SAMPLE_RATE * 0.45);
        let trajectory = clamp(p1.x, 0.2, 6.0);
        let unitAge = clamp(age / duration, 0.0, 1.0);
        let cycles = startHz * age
          + (endHz - startHz) * duration * pow(unitAge, trajectory + 1.0) / (trajectory + 1.0);
        let angle = TAU * cycles;
        let feedback = clamp(p1.y, 0.0, 4.0);
        let width = clamp(p1.z, 0.0, 1.0);
        let leftWarp = feedback * sin(angle * 0.501 + width * 0.23);
        let rightWarp = feedback * sin(angle * 0.499 - width * 0.23);
        let beam = vec2<f32>(sin(angle + leftWarp), sin(angle + rightWarp));
        let flash = vec2<f32>(sin(angle * 2.031 + width), sin(angle * 1.973 - width)) * feedback * 0.09;
        let attack = smootherstep01(age / min(0.002, duration * 0.2));
        let release = smootherstep01((duration - age) / min(0.018, duration * 0.3));
        let envelope = attack * release * exp(-age / max(duration * 0.72, 0.001));
        result = softClip((beam + flash) * envelope * p1.w * 0.94);
      }
    }
    case 45u: {
      let fundamental = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.42);
      let vowel = clamp(p0.y + inputA.x * p1.z * 0.5, 0.0, 1.0);
      let formants = extraVowelFormants(vowel);
      let harmonicCount = u32(clamp(round(p0.z), 4.0, 24.0));
      let bandwidth = max(p0.w, 1.0);
      let machinePhase = phaseAtSample(sampleIndex, max(p1.x, 0.001));
      let metal = clamp(p1.y, 0.0, 4.0);
      var voice = vec2<f32>(0.0);
      var energy = 0.0;
      for (var partial = 1u; partial <= 24u; partial += 1u) {
        if (partial > harmonicCount) { break; }
        let harmonic = f32(partial);
        let partialHz = fundamental * harmonic;
        let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, partialHz);
        let d1 = (partialHz - formants.x) / bandwidth;
        let d2 = (partialHz - formants.y) / (bandwidth * 1.35);
        let d3 = (partialHz - formants.z) / (bandwidth * 1.75);
        let formantGain = 0.025 + exp(-d1 * d1) + exp(-d2 * d2) * 0.72 + exp(-d3 * d3) * 0.42;
        let amplitude = formantGain * bandGain / pow(harmonic, 0.68);
        let phase = TAU * phaseAtSample(sampleIndex, partialHz);
        let machineAngle = TAU * machinePhase + harmonic * 0.17;
        let articulation = 0.72 + sin(machineAngle) * 0.28;
        let phaseWarp = sin(phase * 1.377 + machineAngle) * metal;
        let stereoPhase = harmonic * metal * 0.006;
        voice += vec2<f32>(
          sin(phase + phaseWarp + stereoPhase),
          sin(phase + phaseWarp - stereoPhase)
        ) * amplitude * articulation;
        energy += amplitude * amplitude;
      }
      result = softClip(voice / max(sqrt(energy), 1.0) * p1.w * 0.86);
    }
    case 46u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let eventSample = sampleIndex % periodSamples;
      let eventProgress = f32(eventSample) / f32(max(periodSamples - 1u, 1u));
      let age = f32(eventSample) / SAMPLE_RATE;
      let fundamental = clamp(p0.y * exp2((inputA.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.42);
      let modeCount = u32(clamp(round(p0.z), 1.0, 32.0));
      let pluckPosition = clamp(p0.w, 0.03, 0.97);
      let decay = max(p1.x, 0.001);
      let stiffness = clamp(p1.y, 0.0, 1.0);
      let width = clamp(p1.z, 0.0, 1.0);
      var voice = vec2<f32>(0.0);
      var referenceEnergy = 0.0;
      for (var mode = 1u; mode <= 32u; mode += 1u) {
        if (mode > modeCount) { break; }
        let order = f32(mode);
        let stiffnessRatio = sqrt(1.0 + stiffness * order * order * 0.0035);
        let modeHz = fundamental * order * stiffnessRatio;
        let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, modeHz);
        let pluckGain = sin(PI * order * pluckPosition) / pow(order, 1.15);
        let coefficient = pluckGain * bandGain;
        let damping = exp(-age * (1.0 + order * (0.055 + stiffness * 0.09)) / decay);
        let phase = TAU * modeHz * age;
        let stereoPhase = select(-1.0, 1.0, (mode & 1u) == 0u) * width * order * 0.012;
        voice += vec2<f32>(sin(phase + stereoPhase), sin(phase - stereoPhase)) * coefficient * damping;
        referenceEnergy += coefficient * coefficient;
      }
      let attack = smootherstep01(age / 0.0015);
      let release = 1.0 - smootherstep01((eventProgress - 0.985) / 0.015);
      result = voice / max(sqrt(referenceEnergy), 1.0) * attack * release * p1.w;
    }
    case 47u: {
      let frequency = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.42);
      let phase = phaseAtSample(sampleIndex, frequency);
      let width = clamp(p1.z, 0.0, 1.0);
      let control = clamp(inputA.x, -1.0, 1.0);
      let center = vec2<f32>(p0.z + control * 0.28, p0.w - control * 0.19);
      let radius = max(p0.y, 0.001);
      let leftAngle = TAU * phase - width * 0.08;
      let rightAngle = TAU * phase + width * 0.08;
      let leftPoint = center + vec2<f32>(cos(leftAngle), sin(leftAngle)) * radius + vec2<f32>(-width * 0.07, 0.0);
      let rightPoint = center + vec2<f32>(cos(rightAngle), sin(rightAngle)) * radius + vec2<f32>(width * 0.07, 0.0);
      let terrain = u32(clamp(round(p1.x), 0.0, 5.0));
      let warp = clamp(p1.y + abs(control) * 0.35, 0.0, 3.5);
      let terrainSample = vec2<f32>(
        extraTerrainValue(leftPoint, terrain, warp),
        extraTerrainValue(rightPoint, terrain, warp)
      );
      result = softClip(terrainSample * p1.w * 1.08);
    }
    case 48u: {
      let frequency = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 0.01, SAMPLE_RATE * 0.43);
      let phase = phaseAtSample(sampleIndex, frequency);
      let seedMotion = sin(TAU * phaseAtSample(sampleIndex, max(p1.x, 0.001))) * 0.18;
      let seed = clamp(p0.y + inputA.x * p1.y + seedMotion, -1.5, 1.5);
      let iterations = u32(clamp(round(p0.z), 1.0, 12.0));
      let width = clamp(p1.z, 0.0, 1.0);
      let left = extraFractalSample(phase, seed - width * 0.11, iterations, p0.w);
      let right = extraFractalSample(fract(phase + width * 0.006), seed + width * 0.11, iterations, p0.w);
      result = vec2<f32>(left, right) * p1.w;
    }
    case 49u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let eventIndex = sampleIndex / periodSamples;
      let eventSample = sampleIndex % periodSamples;
      let eventProgress = f32(eventSample) / f32(max(periodSamples - 1u, 1u));
      let age = f32(eventSample) / SAMPLE_RATE;
      let bodyHz = clamp(p0.y * exp2((inputA.x + render_info.performancePitch) / 12.0), 20.0, SAMPLE_RATE * 0.3);
      let pitchTau = 0.014;
      let bodyCycles = bodyHz * age + bodyHz * 1.8 * pitchTau * (1.0 - exp(-age / pitchTau));
      let shell = (
        sin(TAU * bodyCycles)
        + sin(TAU * bodyCycles * 1.613 + 0.31) * 0.43
      ) * exp(-age / max(p0.z, 0.001));
      let previousIndex = select(0u, sampleIndex - 1u, sampleIndex > 0u);
      let seed = eventIndex * 2246822519u + 17011u;
      let whiteLeft = hashU32(sampleIndex * 747796405u + seed) * 2.0 - 1.0;
      let whiteLeftOld = hashU32(previousIndex * 747796405u + seed) * 2.0 - 1.0;
      let whiteRight = hashU32(sampleIndex * 2891336453u + seed + 97u) * 2.0 - 1.0;
      let whiteRightOld = hashU32(previousIndex * 2891336453u + seed + 97u) * 2.0 - 1.0;
      let highLeft = (whiteLeft - whiteLeftOld) * 0.70710678;
      let highRight = (whiteRight - whiteRightOld) * 0.70710678;
      let tone = clamp(p1.x, 0.0, 1.0);
      let noiseLeft = mix(whiteLeft, highLeft, tone);
      let noiseRight = mix(whiteRight, highRight, tone);
      let width = clamp(p1.z, 0.0, 1.0);
      let wires = vec2<f32>(noiseLeft, mix(noiseLeft, noiseRight, width));
      let wireEnvelope = exp(-age / max(p0.w, 0.001));
      let snapEnvelope = exp(-age / 0.009) * clamp(p1.y, 0.0, 1.0);
      let attack = smootherstep01(age / 0.0008);
      let release = 1.0 - smootherstep01((eventProgress - 0.985) / 0.015);
      let combined = vec2<f32>(shell * 0.72) + wires * (wireEnvelope * 0.62 + snapEnvelope * 0.42);
      result = softClip(combined * attack * release * p1.w);
    }
    case 50u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let eventIndex = sampleIndex / periodSamples;
      let eventSample = sampleIndex % periodSamples;
      let eventProgress = f32(eventSample) / f32(max(periodSamples - 1u, 1u));
      let age = f32(eventSample) / SAMPLE_RATE;
      let baseHz = clamp(p0.y * exp2((inputA.x + render_info.performancePitch) / 12.0), 20.0, SAMPLE_RATE * 0.4);
      let decay = max(p0.z * mix(1.0, 12.0, clamp(p1.y, 0.0, 1.0)), 0.001);
      let alloy = clamp(p0.w, 0.0, 1.0);
      let brightness = clamp(p1.x, 0.0, 1.0);
      let width = clamp(p1.z, 0.0, 1.0);
      var voice = vec2<f32>(0.0);
      var energy = 0.0;
      for (var lane = 0u; lane < 8u; lane += 1u) {
        var ratio = 1.0;
        if (lane == 1u) { ratio = 1.447; }
        if (lane == 2u) { ratio = 1.617; }
        if (lane == 3u) { ratio = 1.926; }
        if (lane == 4u) { ratio = 2.502; }
        if (lane == 5u) { ratio = 2.663; }
        if (lane == 6u) { ratio = 3.151; }
        if (lane == 7u) { ratio = 3.917; }
        ratio *= 1.0 + (hashU32(lane * 7919u + eventIndex * 17u) - 0.5) * alloy * 0.18;
        let laneHz = baseHz * ratio;
        let bandGain = 1.0 - smoothstep(SAMPLE_RATE * 0.34, SAMPLE_RATE * 0.46, laneHz);
        let order = f32(lane + 1u);
        let tilt = mix(pow(order, -0.52), pow(order, 0.14), brightness);
        let coefficient = bandGain * tilt;
        let damping = exp(-age * (1.0 + order * 0.055) / decay);
        let phase = TAU * laneHz * age + hashU32(lane * 104729u + eventIndex) * TAU;
        let pan = select(-1.0, 1.0, (lane & 1u) == 0u) * width * (0.24 + order * 0.065);
        voice += vec2<f32>(sin(phase) * (1.0 - pan * 0.55), sin(phase) * (1.0 + pan * 0.55)) * coefficient * damping;
        energy += coefficient * coefficient;
      }
      let attack = smootherstep01(age / 0.00065);
      let release = 1.0 - smootherstep01((eventProgress - 0.985) / 0.015);
      result = voice / max(sqrt(energy), 1.0) * attack * release * p1.w * 0.78;
    }
    case 51u: {
      let rate = max(p0.x, 0.001);
      let periodSamples = max(u32(round(SAMPLE_RATE / rate)), 1u);
      let eventIndex = sampleIndex / periodSamples;
      let eventSample = sampleIndex % periodSamples;
      let eventProgress = f32(eventSample) / f32(max(periodSamples - 1u, 1u));
      let age = f32(eventSample) / SAMPLE_RATE;
      let previousIndex = select(0u, sampleIndex - 1u, sampleIndex > 0u);
      let seed = eventIndex * 3266489917u + 8191u;
      let whiteLeft = hashU32(sampleIndex * 747796405u + seed) * 2.0 - 1.0;
      let whiteLeftOld = hashU32(previousIndex * 747796405u + seed) * 2.0 - 1.0;
      let whiteRight = hashU32(sampleIndex * 2891336453u + seed + 53u) * 2.0 - 1.0;
      let whiteRightOld = hashU32(previousIndex * 2891336453u + seed + 53u) * 2.0 - 1.0;
      let tone = clamp(p0.y, 0.0, 1.0);
      let noiseLeft = mix(whiteLeft, (whiteLeft - whiteLeftOld) * 0.70710678, tone);
      let noiseRight = mix(whiteRight, (whiteRight - whiteRightOld) * 0.70710678, tone);
      let width = clamp(p1.z, 0.0, 1.0);
      let noise = vec2<f32>(noiseLeft, mix(noiseLeft, noiseRight, width));
      let burstCount = u32(clamp(round(p0.w), 1.0, 4.0));
      let burstDuration = mix(0.024, 0.009, tone);
      var burstEnvelope = 0.0;
      for (var burst = 0u; burst < 4u; burst += 1u) {
        if (burst >= burstCount) { break; }
        let burstStart = f32(burst) * p0.z;
        let burstWeight = exp(-f32(burst) * 0.24);
        burstEnvelope += extraSoftWindow(age, burstStart, burstDuration, min(0.0022, burstDuration * 0.22)) * burstWeight;
      }
      let tailOnset = smootherstep01(age / 0.008);
      let tailEnvelope = tailOnset * exp(-age / max(p1.x, 0.001)) * clamp(p1.y, 0.0, 1.0);
      let release = 1.0 - smootherstep01((eventProgress - 0.985) / 0.015);
      result = softClip(noise * (burstEnvelope + tailEnvelope) * release * p1.w);
    }
    case 52u: {
      let fundamental = clamp(p0.x * exp2((inputB.x + render_info.performancePitch) / 12.0), 1.0, SAMPLE_RATE * 0.42);
      let pitchPhase = phaseAtSample(sampleIndex, fundamental);
      let grainAge = pitchPhase / fundamental;
      let pitchPeriod = 1.0 / fundamental;
      let duration = min(max(p0.w, 0.0001), pitchPeriod * 0.96);
      if (grainAge < duration) {
        let unitAge = clamp(grainAge / duration, 0.0, 1.0);
        let formant = clamp(p0.y * exp2(inputA.x / 12.0), 20.0, SAMPLE_RATE * 0.42);
        let secondFormant = clamp(formant * p1.x, 20.0, SAMPLE_RATE * 0.44);
        let damping = exp(-PI * max(p0.z, 1.0) * grainAge);
        let window = sin(PI * unitAge);
        let grainWindow = window * window * damping;
        let width = clamp(p1.z, 0.0, 1.0);
        let principalAngle = TAU * formant * grainAge;
        let secondAngle = TAU * secondFormant * grainAge;
        let phaseOffset = width * window * 0.18;
        let voiced = vec2<f32>(
          sin(principalAngle + phaseOffset) + sin(secondAngle + phaseOffset * 1.7) * 0.42,
          sin(principalAngle - phaseOffset) + sin(secondAngle - phaseOffset * 1.7) * 0.42
        );
        let breathLeft = hashU32(sampleIndex * 747796405u + 1013904223u) * 2.0 - 1.0;
        let breathRight = hashU32(sampleIndex * 2891336453u + 1664525u) * 2.0 - 1.0;
        let breath = vec2<f32>(breathLeft, mix(breathLeft, breathRight, width)) * clamp(p1.y, 0.0, 1.0);
        result = softClip((voiced * 0.72 + breath * 0.24) * grainWindow * p1.w);
      }
    }
    case 53u: {
      let drive = max(p0.x, 0.0);
      let driven = inputA * drive + vec2<f32>(p0.y);
      let hardRectified = abs(driven);
      let softness = clamp(p1.x, 0.0, 1.0);
      let radius = mix(0.0001, 0.25, softness);
      let rounded = sqrt(driven * driven + vec2<f32>(radius * radius)) - vec2<f32>(radius);
      let centered = mix(hardRectified, rounded, softness)
        - vec2<f32>(clamp(p0.z, 0.0, 1.0) * 0.63661977 * drive);
      result = softClip(mix(inputA, centered, clamp(p0.w, 0.0, 1.0)) * p1.y);
    }
    case 54u: {
      let mid = (inputA.x + inputA.y) * 0.5;
      let side = (inputA.x - inputA.y) * 0.5;
      let angle = clamp(p0.w, -1.0, 1.0) * PI * 0.25;
      let cosine = cos(angle);
      let sine = sin(angle);
      let rotatedMid = mid * cosine - side * sine;
      let rotatedSide = mid * sine + side * cosine;
      let midGain = max(p0.y, 0.0);
      let sideGain = max(p0.z, 0.0) * max(p0.x, 0.0);
      let compensation = 1.0 / max(max(midGain, sideGain), 1.0);
      let wet = vec2<f32>(
        rotatedMid * midGain + rotatedSide * sideGain,
        rotatedMid * midGain - rotatedSide * sideGain
      ) * compensation;
      let combined = mix(inputA, wet, clamp(p1.x, 0.0, 1.0)) * p1.y;
      result = clamp(combined, vec2<f32>(-1.25), vec2<f32>(1.25));
    }
    case 55u: {
      let orbitPhase = phaseAtSample(sampleIndex, max(p0.x * exp2(render_info.performancePitch / 12.0), 0.001));
      let angle = TAU * orbitPhase;
      let control = clamp(inputA.x, -1.0, 1.0) * p1.y;
      let origin = vec3<f32>(
        cos(angle) + control * 0.31,
        sin(angle) - control * 0.23,
        sin(angle * 2.0 + 0.7) * 0.72 + control * 0.17
      );
      let octaves = u32(clamp(round(p0.y), 1.0, 6.0));
      let color = clamp(p1.x + control * 0.12, 0.0, 1.0);
      let field = extraCyclicField(
        origin,
        octaves,
        clamp(p0.z, 1.1, 3.0),
        clamp(p0.w, 0.0, 3.0),
        color
      );
      let left = field.x + field.z * mix(0.18, 0.52, color);
      let independentRight = field.y - field.z * mix(0.38, 0.12, color);
      let right = mix(left, independentRight, clamp(p1.z, 0.0, 1.0));
      result = softClip(vec2<f32>(left, right) * p1.w * 0.92);
    }
    case 56u: {
      let coordinates = extraStepCoordinates(sampleIndex, p0.x, p1.w);
      let steps = u32(clamp(round(p0.y), 1.0, 16.0));
      let rotation = u32(max(round(p0.w), 0.0)) % steps;
      let step = (coordinates.x + rotation) % steps;
      let bit = 1u << step;
      let gateMask = u32(clamp(round(p0.z), 0.0, 65535.0));
      let accentMask = u32(clamp(round(p1.y), 0.0, 65535.0));
      let hit = (gateMask & bit) != 0u;
      let accented = (accentMask & bit) != 0u;
      let unaccentedLevel = 1.0 - clamp(p1.z, 0.0, 1.0) * 0.62;
      let gateLevel = select(unaccentedLevel, 1.0, accented);
      let gate = select(0.0, extraEdgeGate(coordinates.y, coordinates.z, p1.x) * gateLevel, hit);
      result = vec2<f32>(gate);
    }
    case 66u: {
      let rawPosition = clamp(p0.x + inputC.x * p0.y, 0.0, 1.0);
      let response = clamp(p0.z, 0.25, 4.0);
      var position = 0.5 * pow(rawPosition * 2.0, response);
      if (rawPosition >= 0.5) {
        position = 1.0 - 0.5 * pow((1.0 - rawPosition) * 2.0, response);
      }
      let angle = position * PI * 0.5;
      let weightA = cos(angle) * max(p0.w, 0.0);
      let weightB = sin(angle) * max(p1.x, 0.0);
      let centerOverlap = sin(position * PI);
      let correlationTrim = mix(1.0, 0.70710678, centerOverlap * clamp(p1.y, 0.0, 1.0));
      let morphed = (inputA * weightA + inputB * weightB) * correlationTrim * p1.z;
      result = clamp(morphed, vec2<f32>(-2.0), vec2<f32>(2.0));
    }
    case 67u: {
      let drive = clamp(p0.x + inputB.x * p1.x, 0.5, 4.0);
      let x = clamp(inputA * drive, vec2<f32>(-1.0), vec2<f32>(1.0));
      let x2 = x * x;
      let x3 = x2 * x;
      let x5 = x3 * x2;
      let second = x2 * 2.0;
      let third = x3 * 4.0 - x * 3.0;
      let fifth = x5 * 16.0 - x3 * 20.0 + x * 5.0;
      let colored = x
        + third * clamp(p0.y, 0.0, 1.0) * 0.18
        + fifth * clamp(p0.z, 0.0, 1.0) * 0.08
        + second * clamp(p0.w, 0.0, 1.0) * 0.12;
      let ceiling = clamp(p1.z, 0.5, 1.5);
      let bounded = tanh(colored / ceiling) * ceiling;
      result = clamp(
        mix(inputA, bounded, clamp(p1.y, 0.0, 1.0)) * p1.w,
        vec2<f32>(-1.75),
        vec2<f32>(1.75)
      );
    }
    case 68u: {
      let limit = max(p1.x, 0.1);
      let linear = inputA * p0.x + vec2<f32>(p0.y);
      let curve = clamp(p0.z, 0.2, 5.0);
      var boundedLinear = clamp(linear, vec2<f32>(-limit), vec2<f32>(limit));
      var curved = sign(boundedLinear) * pow(abs(boundedLinear) / limit, vec2<f32>(curve)) * limit;
      if (p0.w >= 0.5) {
        boundedLinear = clamp(linear, vec2<f32>(0.0), vec2<f32>(limit));
        curved = pow(boundedLinear / limit, vec2<f32>(curve)) * limit;
      }
      result = mix(boundedLinear, curved, clamp(p1.y, 0.0, 1.0));
    }
`;

// Covers the longest public history read: a 12-second room plus 400 ms of
// pre-delay. The per-chunk guard in shaderSynthPlaygroundFxHistoryFrames keeps
// that oldest read intact while the current chunk is being written.
const FX_HISTORY_SECONDS = 12.5;
const FX_MIN_HISTORY_FRAMES = 1024;
const FX_HISTORY_PADDING_FRAMES = 2;
const FX_MAX_CHAIN_EFFECTS = 3;
const FX_HISTORY_REGIONS = FX_MAX_CHAIN_EFFECTS + 1;

const freeze = (value) => Object.freeze(value);

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
    behavior: options.behavior ?? "Changes the effect response.",
  });
}

function effect(spec) {
  return freeze({
    ...spec,
    aliases: freeze(spec.aliases ?? []),
    tags: freeze(spec.tags ?? []),
    inputs: freeze(spec.inputs ?? [{ id: "signal", label: "audio", type: "audio", types: freeze(["audio", "stereo"]), required: true }]),
    outputs: freeze(spec.outputs ?? [{ id: "out", label: "stereo", type: "stereo", types: freeze(["stereo"]), required: false }]),
    params: freeze(spec.params),
    faust: spec.faust ? freeze(spec.faust) : null,
  });
}

/**
 * These bindings intentionally extend, rather than replace, the playground's
 * current RenderInfo and GraphNode layouts. The dry graph pass populates
 * history region zero; each ordered effect pass writes the next region before
 * its downstream neighbor is dispatched.
 */
export const SHADER_SYNTH_PLAYGROUND_FX_BINDINGS = freeze({
  renderInfo: 0,
  graphNodes: 1,
  inputChunk: 2,
  soundChunk: 3,
  fxHistory: 4,
  stageInfo: 5,
});

export const SHADER_SYNTH_PLAYGROUND_FX_KINDS = freeze({
  delay: 29,
  reverb: 30,
  recombobulator: 31,
  spectralResynth: 32,
  flanger: 60,
  chorus: 61,
  dopplerSweep: 62,
  fftRobotizer: 63,
  spectralGate: 64,
  vibrato: 65,
  firLowpass: 84,
  firHighpass: 85,
  firBandpass: 86,
  sampleRateReducer: 87,
});

// Core graph kinds occupy values between the original and extended history
// effects, so membership must remain explicit rather than relying on a range.
const SHADER_SYNTH_PLAYGROUND_FX_KIND_VALUES = freeze(
  Object.values(SHADER_SYNTH_PLAYGROUND_FX_KINDS),
);

export const SHADER_SYNTH_PLAYGROUND_FX_LIMITS = freeze({
  historySeconds: FX_HISTORY_SECONDS,
  delayRepeats: 6,
  delayTimeSeconds: 2,
  reverbTaps: 64,
  reverbSizeSeconds: 12,
  reverbPredelaySeconds: 0.4,
  recombobulatorHeads: 12,
  recombobulatorMemorySeconds: 12,
  spectralWindow: 128,
  spectralBins: 24,
  firTaps: 31,
  chorusVoices: 6,
  maxChainEffects: FX_MAX_CHAIN_EFFECTS,
  historyRegions: FX_HISTORY_REGIONS,
});

// Parameter order is the GraphNode previous0/previous1/target0/target1 order.
export const SHADER_SYNTH_PLAYGROUND_FX_MODULES = freeze([
  effect({
    id: "delay",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.delay,
    name: "Simple Delay",
    aliases: ["echo", "stereo delay", "multi-tap delay"],
    tags: ["delay", "echo", "multi-tap", "stereo", "space"],
    category: "space",
    color: "#6ca8ff",
    auditionKind: "history",
    execution: "History pass · simple 1–6 tap echo",
    description: "Reads fractional positions from persistent signal history to make decaying echoes whose taps can alternate across stereo.",
    wgsl: "tap += history(sample - delay * repeat) * pow(decay, repeat);",
    auditionPreset: null,
    faust: { symbol: "de.fdelay", url: "https://faustlibraries.grame.fr/libs/delays/" },
    params: [
      parameter("time", "Time", 0.005, 2, 0.24, { step: 0.001, unit: "s", scale: "log", low: "comb", high: "long echo", behavior: "Sets the spacing between taps; at the maximum, six taps extend across twelve seconds of history." }),
      parameter("repeats", "Taps", 1, 6, 4, { step: 1, low: "single", high: "echo train", behavior: "Adds later history reads without introducing a recursive feedback loop." }),
      parameter("decay", "Decay", 0, 0.94, 0.62, { step: 0.01, low: "short tail", high: "lingering", behavior: "Reduces each successive tap, controlling how far the echo train appears to recede." }),
      parameter("mix", "Mix", 0, 1, 0.42, { step: 0.01, low: "dry", high: "echoes", behavior: "Crossfades the current signal with the normalized history-tap sum." }),
      parameter("spread", "Stereo spread", 0, 1, 0.72, { step: 0.01, low: "centered", high: "ping-pong", behavior: "Alternately pans successive taps so even a mono source opens into stereo." }),
      parameter("tone", "Smear", 0, 1, 0.18, { step: 0.01, low: "sharp", high: "soft", behavior: "Averages neighboring history samples, slightly softening bright echo edges." }),
      parameter("pattern", "Spacing", 0, 1, 0, { step: 0.01, low: "even", high: "expanding", behavior: "Warps the intermediate tap positions while keeping the first and final delay anchors fixed." }),
      parameter("level", "Level", 0, 1.5, 0.9, { step: 0.01, low: "quiet", high: "loud", behavior: "Scales the complete dry/wet result before it reaches the next post effect." }),
    ],
  }),
  effect({
    id: "reverb",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.reverb,
    name: "Convolution Reverb",
    aliases: ["reverb", "room", "hall", "ambience", "sparse convolution"],
    tags: ["reverb", "room", "reflections", "space", "history"],
    category: "space",
    color: "#6ca8ff",
    auditionKind: "history",
    execution: "History pass · 4–64 reflection taps",
    description: "Builds a deterministic stereo reflection field from scattered reads of the persistent dry history.",
    wgsl: "room += history(sample - reflection[i]) * decay[i];",
    auditionPreset: null,
    faust: { symbol: "re.satrev", url: "https://faustlibraries.grame.fr/libs/reverbs/" },
    params: [
      parameter("size", "Size", 0.08, 12, 1.8, { step: 0.01, unit: "s", scale: "log", low: "chamber", high: "vast tail", behavior: "Spreads the reflection field from a compact room to a twelve-second response." }),
      parameter("decay", "Decay (RT60)", 0.1, 12, 3.6, { step: 0.01, unit: "s", scale: "log", low: "tight decay", high: "twelve-second tail", behavior: "Sets the time for reflection amplitude to fall by 60 dB; pre-delay shifts the room later without changing this decay rate." }),
      parameter("taps", "Density", 4, 64, 36, { step: 1, low: "separate echoes", high: "diffuse", behavior: "Raises the number of deterministic reflection points summed for every sample." }),
      parameter("mix", "Mix", 0, 1, 0.38, { step: 0.01, low: "dry", high: "room", behavior: "Crossfades from the incoming chain to the scattered reflection field." }),
      parameter("predelay", "Pre-delay", 0, 0.4, 0.025, { step: 0.001, unit: "s", low: "attached", high: "detached", behavior: "Inserts up to 400 milliseconds between the direct event and the first reflection." }),
      parameter("width", "Width", 0, 1, 0.86, { step: 0.01, low: "mono", high: "wide", behavior: "Distributes reflection taps asymmetrically between the stereo channels." }),
      parameter("tone", "Softness", 0, 1, 0.35, { step: 0.01, low: "bright", high: "soft", behavior: "Blends each reflection with its next-older sample to soften the room." }),
      parameter("level", "Level", 0, 1.5, 0.82, { step: 0.01, low: "quiet", high: "large", behavior: "Scales the complete dry/room result before the next post effect." }),
    ],
  }),
  effect({
    id: "recombobulator",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.recombobulator,
    name: "Recombobulator",
    aliases: ["granular delay", "history collage", "glitch cloud", "moving taps"],
    tags: ["delay", "glitch", "granular", "history", "stereo"],
    category: "space",
    color: "#6ca8ff",
    auditionKind: "history",
    execution: "History pass · crossfaded moving tap field",
    description: "Continuously replaces a bank of signed, folded history reads with a new deterministic routing pattern.",
    wgsl: "wet = crossfade(historyHeads(epoch), historyHeads(epoch + 1));",
    auditionPreset: null,
    faust: { symbol: "de.fdelay + ef.cubicnl", url: "https://faustlibraries.grame.fr/libs/delays/" },
    params: [
      parameter("memory", "Memory", 0.02, 12, 0.74, { step: 0.01, unit: "s", scale: "log", low: "micro fragments", high: "long recall", behavior: "Sets how far backward the moving read heads may reach, up to twelve seconds." }),
      parameter("heads", "Heads", 1, 12, 8, { step: 1, low: "single shard", high: "cloud", behavior: "Adds simultaneous signed fragments before energy normalization." }),
      parameter("rate", "Mutation", 0.05, 20, 1.1, { step: 0.01, unit: "Hz", scale: "log", low: "slow scenes", high: "flicker", behavior: "Sets how often a new deterministic tap map replaces the current one." }),
      parameter("mix", "Mix", 0, 1, 0.55, { step: 0.01, low: "dry", high: "recombined", behavior: "Crossfades from the incoming chain to the moving history collage." }),
      parameter("scatter", "Scatter", 0, 1, 0.8, { step: 0.01, low: "ordered", high: "dispersed", behavior: "Moves head positions from an ordered spacing toward seeded random locations." }),
      parameter("fold", "Fold", 0, 1, 0.28, { step: 0.01, low: "clean", high: "fractured", behavior: "Morphs the fragment sum from soft saturation into repeated sine folding." }),
      parameter("width", "Width", 0, 1, 0.9, { step: 0.01, low: "mono", high: "split", behavior: "Controls channel swaps and independent pan offsets for the history heads." }),
      parameter("level", "Level", 0, 1.5, 0.78, { step: 0.01, low: "quiet", high: "volatile", behavior: "Scales the complete dry/recombined result before the next post effect." }),
    ],
  }),
  effect({
    id: "spectral-resynth",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.spectralResynth,
    name: "Sliding-DFT Resynth",
    aliases: ["spectral resynthesis", "fft resynth", "phase vocoder", "robot spectrum"],
    tags: ["spectral", "dft", "fft", "resynthesis", "robotic"],
    category: "spectral",
    color: "#a78bff",
    auditionKind: "history",
    execution: "History pass · bounded sliding DFT",
    description: "Measures a short causal spectrum at every sample and rebuilds its energy with shifted, phase-scattered oscillator bins.",
    wgsl: "magnitude[k] = length(sum(history[n] * cis(TAU * k * n / N)));",
    auditionPreset: null,
    faust: { symbol: "an.fft", url: "https://faustlibraries.grame.fr/libs/analyzers/" },
    params: [
      parameter("window", "Window", 64, 128, 64, { step: 1, unit: "samples", low: "fast", high: "resolved", behavior: "Sets the causal analysis span; the 64-sample minimum keeps every exposed positive-frequency bin available." }),
      parameter("bins", "Bins", 4, 24, 14, { step: 1, low: "sparse", high: "dense", behavior: "Raises the number of measured and resynthesized frequency bands." }),
      parameter("shift", "Bin shift", 0.25, 4, 1.5, { step: 0.01, unit: "x", scale: "log", low: "down", high: "up", behavior: "Moves measured magnitudes onto lower or higher oscillator-bin frequencies." }),
      parameter("mix", "Mix", 0, 1, 0.48, { step: 0.01, low: "dry", high: "resynthesized", behavior: "Crossfades from the incoming chain to the rebuilt oscillator bank." }),
      parameter("smear", "Phase scatter", 0, 1, 0.38, { step: 0.01, low: "coherent", high: "shimmering", behavior: "Adds a deterministic phase offset to each resynthesis bin." }),
      parameter("tilt", "Spectral tilt", 0.25, 2.5, 1.05, { step: 0.01, low: "bright", high: "dark", behavior: "Weights high measured bins more strongly or more weakly during reconstruction." }),
      parameter("width", "Width", 0, 1, 0.76, { step: 0.01, low: "centered", high: "decorrelated", behavior: "Applies opposing fractions of each bin's phase scatter to the stereo channels." }),
      parameter("level", "Level", 0, 1.5, 0.8, { step: 0.01, low: "quiet", high: "large", behavior: "Scales the complete dry/resynthesized result before the next post effect." }),
    ],
  }),
  effect({
    id: "flanger",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.flanger,
    name: "Flanger",
    aliases: ["jet flanger", "comb sweep", "modulated delay"],
    tags: ["flanger", "modulation", "fractional delay", "comb", "stereo"],
    category: "space",
    color: "#6ca8ff",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · stereo modulated fractional read",
    description: "Adds a very short, smoothly moving feed-forward delay to the dry signal for a swept comb-filter jet without recursive feedback.",
    wgsl: "out = normalize(dry + polarity * fractionalHistory(base + lfo * depth) * mix);",
    faust: { symbol: "de.fdelay", url: "https://faustlibraries.grame.fr/libs/delays/" },
    params: [
      parameter("base", "Base delay", 0.2, 12, 2.6, { step: 0.1, unit: "ms", scale: "log", low: "tight comb", high: "hollow sweep", behavior: "Sets the shortest delay around which the moving comb pattern forms." }),
      parameter("depth", "Sweep depth", 0, 10, 3.8, { step: 0.1, unit: "ms", low: "still", high: "wide jet", behavior: "Expands the delay excursion while every read remains inside the persistent history buffer." }),
      parameter("rate", "Sweep rate", 0.02, 12, 0.24, { step: 0.01, unit: "Hz", scale: "log", low: "slow pass", high: "vibrating", behavior: "Sets how quickly the fractional delay moves through its comb positions." }),
      parameter("mix", "Wet amount", 0, 1, 0.62, { step: 0.01, low: "dry", high: "deep comb", behavior: "Raises the moving feed-forward tap against the direct signal." }),
      parameter("stereo", "Stereo phase", 0, 1, 0.68, { step: 0.01, low: "locked", high: "opposed", behavior: "Offsets the left and right delay orbits to widen the sweep." }),
      parameter("polarity", "Tap polarity", -1, 1, 0.72, { step: 0.01, low: "notches", high: "peaks", behavior: "Moves between inverted and normal delayed taps, changing where the comb peaks and nulls land." }),
      parameter("tone", "Tap softness", 0, 1, 0.08, { step: 0.01, low: "bright", high: "soft", behavior: "Averages neighboring history samples to restrain sharp high-frequency motion." }),
      parameter("level", "Level", 0, 1.2, 0.88, { step: 0.01, low: "quiet", high: "forward", behavior: "Scales the bounded flanged result before the next post effect." }),
    ],
  }),
  effect({
    id: "chorus",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.chorus,
    name: "Chorus",
    aliases: ["ensemble chorus", "detuned doubles", "multi-voice delay"],
    tags: ["chorus", "ensemble", "modulation", "fractional delay", "stereo"],
    category: "space",
    color: "#6ca8ff",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · 3–6 moving stereo voices",
    description: "Averages several gently detuned fractional-delay voices with independent stereo phases to create a broad ensemble.",
    wgsl: "chorus += fractionalHistory(base + voiceLfo[i] * depth) / voices;",
    faust: { symbol: "de.fdelay", url: "https://faustlibraries.grame.fr/libs/delays/" },
    params: [
      parameter("base", "Base delay", 6, 40, 18, { step: 0.1, unit: "ms", scale: "log", low: "tight double", high: "loose ensemble", behavior: "Sets the common delay around which the ensemble voices drift." }),
      parameter("depth", "Detune depth", 0, 14, 5.4, { step: 0.1, unit: "ms", low: "still doubles", high: "wavy", behavior: "Sets each voice's delay excursion and therefore its audible pitch movement; zero freezes the delayed voices." }),
      parameter("rate", "Motion rate", 0.02, 6, 0.31, { step: 0.01, unit: "Hz", scale: "log", low: "slow bloom", high: "warble", behavior: "Sets the central orbit rate shared by the chorus voices." }),
      parameter("mix", "Mix", 0, 1, 0.48, { step: 0.01, low: "dry", high: "ensemble", behavior: "Crossfades into the normalized bank of moving delay voices." }),
      parameter("voices", "Voices", 3, 6, 4, { step: 1, low: "trio", high: "six-wide", behavior: "Raises the number of independently phased history reads from three to six." }),
      parameter("spread", "Stereo spread", 0, 1, 0.9, { step: 0.01, low: "centered", high: "wide", behavior: "Separates each voice's left and right modulation phase." }),
      parameter("drift", "Rate drift", 0, 1, 0.3, { step: 0.01, low: "uniform", high: "organic", behavior: "Offsets the voice rates slightly so their delay orbits continually re-form." }),
      parameter("level", "Level", 0, 1.2, 0.88, { step: 0.01, low: "quiet", high: "lush", behavior: "Scales the bounded dry/ensemble result before the next post effect." }),
    ],
  }),
  effect({
    id: "doppler-sweep",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.dopplerSweep,
    name: "Doppler Sweep",
    aliases: ["moving delay", "flyby", "pitch sweep"],
    tags: ["doppler", "moving source", "fractional delay", "pitch", "space"],
    category: "space",
    color: "#6ca8ff",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · bounded moving propagation read",
    description: "Moves a causal fractional-delay read toward and away from the listener so pitch bends emerge from changing propagation time.",
    wgsl: "wet = fractionalHistory(max(1, center + excursion * orbit(time)));",
    faust: { symbol: "de.fdelay", url: "https://faustlibraries.grame.fr/libs/delays/" },
    params: [
      parameter("center", "Center distance", 1, 500, 82, { step: 0.1, unit: "ms", scale: "log", low: "near", high: "far", behavior: "Sets the middle propagation delay of the simulated pass." }),
      parameter("travel", "Travel", 0, 500, 68, { step: 0.1, unit: "ms", low: "stationary", high: "long flyby", behavior: "Sets how far the read head travels around the center delay." }),
      parameter("rate", "Sweep rate", 0.02, 8, 0.18, { step: 0.01, unit: "Hz", scale: "log", low: "slow flyby", high: "rapid orbit", behavior: "Sets the speed of the delay motion and resulting pitch bend." }),
      parameter("mix", "Mix", 0, 1, 0.68, { step: 0.01, low: "dry", high: "moving", behavior: "Crossfades from the direct signal to the moving propagation read." }),
      parameter("curve", "Motion curve", 0.25, 4, 1.35, { step: 0.01, low: "lingers far", high: "lingers near", behavior: "Warps the smooth orbit to redistribute acceleration across the pass." }),
      parameter("stereo", "Stereo offset", 0, 1, 0.58, { step: 0.01, low: "mono path", high: "split path", behavior: "Offsets the two channel trajectories for a wider moving image." }),
      parameter("distanceLoss", "Distance loss", 0, 1, 0.34, { step: 0.01, low: "constant", high: "recedes", behavior: "Attenuates longer delay positions so the source appears to move farther away." }),
      parameter("level", "Level", 0, 1.2, 0.9, { step: 0.01, low: "quiet", high: "close", behavior: "Scales the bounded Doppler result before the next post effect." }),
    ],
  }),
  effect({
    id: "fft-robotizer",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.fftRobotizer,
    name: "FFT Robotizer",
    aliases: ["robot voice", "phase robotizer", "phase vocoder"],
    tags: ["fft", "robotizer", "spectral", "phase", "resynthesis"],
    category: "spectral",
    color: "#a78bff",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · bounded sliding DFT phase replacement",
    description: "Keeps short-window spectral magnitudes but replaces analyzed phase with a fixed quantized phase map for a rigid robotic resynthesis.",
    wgsl: "robot += magnitude[k] * oscillator(k, quantizedFixedPhase[k]);",
    faust: { symbol: "an.fft", url: "https://faustlibraries.grame.fr/libs/analyzers/" },
    params: [
      parameter("window", "Window", 64, 128, 96, { step: 1, unit: "samples", low: "raspy", high: "resolved", behavior: "Sets the causal DFT span; the 64-sample minimum keeps all 24 exposed magnitude bins active." }),
      parameter("bins", "Bins", 4, 24, 18, { step: 1, low: "blocky", high: "detailed", behavior: "Raises the number of magnitude bands rebuilt by the robotic oscillator bank." }),
      parameter("phaseSteps", "Phase states", 1, 16, 4, { step: 1, low: "locked", high: "faceted", behavior: "Quantizes the deterministic per-bin phase map into one to sixteen fixed states." }),
      parameter("mix", "Mix", 0, 1, 0.7, { step: 0.01, low: "dry", high: "robotic", behavior: "Crossfades from the incoming chain to magnitude-only phase-replaced resynthesis." }),
      parameter("shift", "Pitch ratio", 0.5, 2, 1, { step: 0.01, unit: "x", scale: "log", low: "lower robot", high: "higher robot", behavior: "Moves measured magnitude bins onto lower or higher oscillator frequencies." }),
      parameter("tilt", "Spectral tilt", 0.5, 2.5, 1.12, { step: 0.01, low: "bright", high: "dark", behavior: "Changes the balance between low and high robotic bands." }),
      parameter("width", "Stereo phase", 0, 1, 0.32, { step: 0.01, low: "locked", high: "split", behavior: "Applies opposing portions of the fixed phase map to the stereo channels." }),
      parameter("level", "Level", 0, 1.2, 0.86, { step: 0.01, low: "quiet", high: "assertive", behavior: "Scales the bounded robotic result before the next post effect." }),
    ],
  }),
  effect({
    id: "spectral-gate",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.spectralGate,
    name: "Spectral Gate",
    aliases: ["frequency gate", "bin gate", "spectral mask"],
    tags: ["fft", "spectral gate", "threshold", "mask", "noise reduction"],
    category: "spectral",
    color: "#a78bff",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · bounded sliding DFT threshold mask",
    description: "Measures a causal short-window spectrum, attenuates bins below a soft threshold, and resynthesizes the surviving phase-coherent bands.",
    wgsl: "mask[k] = smoothstep(threshold - knee, threshold + knee, magnitude[k]);",
    faust: { symbol: "an.fft", url: "https://faustlibraries.grame.fr/libs/analyzers/" },
    params: [
      parameter("window", "Window", 64, 128, 96, { step: 1, unit: "samples", low: "fast", high: "resolved", behavior: "Sets the causal DFT span; the 64-sample minimum keeps all 24 exposed gate bins active." }),
      parameter("bins", "Bins", 4, 24, 20, { step: 1, low: "broad", high: "detailed", behavior: "Raises the number of independently gated frequency bands." }),
      parameter("threshold", "Threshold", 0.001, 0.5, 0.055, { step: 0.001, scale: "log", low: "open", high: "selective", behavior: "Sets the magnitude a bin must approach before it opens." }),
      parameter("mix", "Mix", 0, 1, 0.74, { step: 0.01, low: "dry", high: "gated", behavior: "Crossfades from the incoming chain to the masked spectral reconstruction." }),
      parameter("knee", "Soft knee", 0, 1, 0.22, { step: 0.01, low: "hard mask", high: "gentle mask", behavior: "Widens the transition around the threshold to reduce chatter." }),
      parameter("reduction", "Reduction", 0, 1, 0.92, { step: 0.01, low: "shallow", high: "deep", behavior: "Sets how strongly bins below the threshold are attenuated." }),
      parameter("tilt", "Mask tilt", 0.5, 2.5, 1, { step: 0.01, low: "favor highs", high: "favor lows", behavior: "Weights reconstructed bands while retaining bounded overall energy." }),
      parameter("level", "Level", 0, 1.2, 0.9, { step: 0.01, low: "quiet", high: "present", behavior: "Scales the bounded gated result before the next post effect." }),
    ],
  }),
  effect({
    id: "fir-lowpass",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.firLowpass,
    name: "FIR Low-pass",
    aliases: ["low pass", "sinc filter", "finite impulse response", "tone filter"],
    tags: ["filter", "fir", "low-pass", "sinc", "history", "linear phase"],
    category: "filter",
    color: "#67c8ff",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · 7–31 FIR taps · fixed 15-sample alignment",
    description: "Applies a short causal windowed-sinc low-pass inside a fixed 31-sample span. Every kernel and the dry comparison share the same 15-sample latency, so changing tap count does not move the signal in time.",
    wgsl: "low = sum(history[n - tap] * windowedSinc(tap, cutoff));",
    faust: { symbol: "fi.lowpass", url: "https://faustlibraries.grame.fr/libs/filters/" },
    params: [
      parameter("cutoff", "Kernel cutoff", 1000, 18000, 2400, { step: 1, unit: "Hz", scale: "log", low: "dark", high: "open", behavior: "Moves the short FIR kernel's broad transition. A 31-tap audio-rate kernel does not represent sub-bass cutoff values precisely." }),
      parameter("taps", "Taps", 7, 31, 31, { step: 2, low: "very broad transition", high: "sharper transition", behavior: "Sets the odd active kernel length inside a fixed 31-sample span; latency remains 15 samples at every setting." }),
      parameter("window", "Hann window", 0, 1, 1, { step: 0.01, low: "rectangular", high: "smooth sidelobes", behavior: "Morphs the sinc kernel from a narrow rectangular window toward a Hann window with lower spectral ringing." }),
      parameter("mix", "Mix", 0, 1, 1, { step: 0.01, low: "aligned dry", high: "low-pass", behavior: "Moves from the time-aligned input to the filtered signal without introducing a parallel-path phase mismatch." }),
      parameter("stereo", "Stereo cutoff", 0, 1200, 0, { step: 1, unit: "cents", low: "matched channels", high: "split cutoffs", behavior: "Moves the left and right cutoff in opposite directions by up to one octave." }),
      parameter("level", "Level", 0, 1.2, 0.92, { step: 0.01, low: "quiet", high: "forward", behavior: "Scales the filtered result through the shared soft output ceiling." }),
    ],
  }),
  effect({
    id: "fir-highpass",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.firHighpass,
    name: "FIR High-pass",
    aliases: ["high pass", "sinc filter", "finite impulse response", "low cut"],
    tags: ["filter", "fir", "high-pass", "sinc", "history", "linear phase"],
    category: "filter",
    color: "#67c8ff",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · aligned subtraction · 7–31 taps · fixed latency",
    description: "Subtracts a short windowed-sinc low-pass from the input delayed by 15 samples. The active kernel stays centered in a fixed span, preserving both the high-pass subtraction and live tap-count alignment.",
    wgsl: "high = history[n - centerTap] - sincLowpass(n, cutoff);",
    faust: { symbol: "fi.highpass", url: "https://faustlibraries.grame.fr/libs/filters/" },
    params: [
      parameter("cutoff", "Kernel cutoff", 1000, 18000, 2400, { step: 1, unit: "Hz", scale: "log", low: "full body", high: "thin air", behavior: "Moves the short FIR kernel's broad low-cut transition; the range begins where a 31-tap audio-rate kernel responds meaningfully." }),
      parameter("taps", "Taps", 7, 31, 31, { step: 2, low: "very broad transition", high: "sharper transition", behavior: "Sets the odd active kernel length while its center and the dry path remain fixed at 15 samples of latency." }),
      parameter("window", "Hann window", 0, 1, 1, { step: 0.01, low: "rectangular", high: "smooth sidelobes", behavior: "Trades a narrower raw transition for lower stop-band ringing by tapering the sinc kernel." }),
      parameter("mix", "Mix", 0, 1, 1, { step: 0.01, low: "aligned dry", high: "high-pass", behavior: "Moves from the center-delayed input to the high-frequency remainder." }),
      parameter("stereo", "Stereo cutoff", 0, 1200, 0, { step: 1, unit: "cents", low: "matched channels", high: "split cutoffs", behavior: "Offsets the two channel cutoffs in opposite directions for frequency-dependent width." }),
      parameter("level", "Level", 0, 1.2, 0.92, { step: 0.01, low: "quiet", high: "forward", behavior: "Scales the high-pass result through the shared soft output ceiling." }),
    ],
  }),
  effect({
    id: "fir-bandpass",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.firBandpass,
    name: "FIR Band-pass",
    aliases: ["band pass", "sinc filter", "finite impulse response", "frequency band"],
    tags: ["filter", "fir", "band-pass", "sinc", "history", "linear phase"],
    category: "filter",
    color: "#67c8ff",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · two aligned FIR sums · 7–31 taps · fixed latency",
    description: "Subtracts two short, equally aligned windowed-sinc low-passes. Both kernels stay centered at the same fixed 15-sample position so the selected broad frequency band and live tap changes remain aligned.",
    wgsl: "band = sincLowpass(n, highHz) - sincLowpass(n, lowHz);",
    faust: { symbol: "fi.bandpass", url: "https://faustlibraries.grame.fr/libs/filters/" },
    params: [
      parameter("low", "Lower kernel cutoff", 1000, 16000, 1800, { step: 1, unit: "Hz", scale: "log", low: "keeps body", high: "removes body", behavior: "Moves the lower broad transition of the surviving band." }),
      parameter("high", "Upper kernel cutoff", 1500, 18000, 5000, { step: 1, unit: "Hz", scale: "log", low: "narrow band", high: "keeps highs", behavior: "Moves the upper broad transition; the shader safely orders crossed cutoff controls." }),
      parameter("taps", "Taps", 7, 31, 31, { step: 2, low: "very broad edges", high: "sharper edges", behavior: "Sets the shared odd active length of both kernels inside their fixed 31-sample span." }),
      parameter("window", "Hann window", 0, 1, 1, { step: 0.01, low: "rectangular", high: "smooth sidelobes", behavior: "Tapers both sinc kernels equally so their subtraction remains aligned." }),
      parameter("mix", "Mix", 0, 1, 1, { step: 0.01, low: "aligned dry", high: "isolated band", behavior: "Moves from the center-delayed input to the isolated frequency band." }),
      parameter("stereo", "Stereo cutoff", 0, 1200, 0, { step: 1, unit: "cents", low: "matched channels", high: "split bands", behavior: "Moves both band edges oppositely across the left and right channels." }),
      parameter("level", "Level", 0, 1.2, 0.96, { step: 0.01, low: "quiet", high: "forward", behavior: "Scales the isolated band through the shared soft output ceiling." }),
    ],
  }),
  effect({
    id: "sample-rate-reducer",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.sampleRateReducer,
    name: "Sample-rate Reducer",
    aliases: ["sample rate crush", "downsample", "sample hold audio", "time crusher"],
    tags: ["sample rate", "downsample", "hold", "digital", "history", "lo-fi"],
    category: "shape",
    color: "#e883ee",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · causal held-sample reads",
    description: "Reads one earlier sample for each reduced-rate cell, optionally interpolating causally between adjacent held values; unlike bit crushing, this changes time resolution.",
    wgsl: "heldIndex = (sampleIndex / holdSamples) * holdSamples;",
    faust: { symbol: "ba.sAndH", url: "https://faustlibraries.grame.fr/libs/basics/" },
    params: [
      parameter("rate", "Sample rate", 50, 48000, 6000, { step: 1, unit: "Hz", scale: "log", low: "stepped", high: "nearly original", behavior: "Sets how frequently the effect captures a new input value." }),
      parameter("interpolation", "Interpolation", 0, 1, 0, { step: 0.01, low: "hard hold", high: "causal glide", behavior: "Moves from zero-order sample holding toward a one-cell-late smooth interpolation between captured values." }),
      parameter("phase", "Capture phase", 0, 1, 0, { step: 0.01, unit: "cycle", low: "grid start", high: "shifted grid", behavior: "Moves the capture boundaries through the incoming waveform without reading future samples." }),
      parameter("stereo", "Stereo phase", 0, 1, 0, { step: 0.01, unit: "cycle", low: "shared captures", high: "offset captures", behavior: "Offsets the right-channel capture grid by up to half a reduced-rate cell." }),
      parameter("bits", "Bit depth", 0, 16, 0, { step: 1, unit: "bit", low: "rate only", high: "fine quantization", behavior: "Optionally adds amplitude quantization; zero or one leaves amplitude untouched." }),
      parameter("dither", "Dither", 0, 1, 0, { step: 0.01, low: "undithered", high: "one LSB", behavior: "Adds deterministic cell-rate dither before optional amplitude quantization." }),
      parameter("mix", "Mix", 0, 1, 1, { step: 0.01, low: "dry", high: "reduced", behavior: "Crossfades from the current input to the held or interpolated result." }),
      parameter("level", "Level", 0, 1.2, 0.9, { step: 0.01, low: "quiet", high: "forward", behavior: "Scales the reduced-rate result through the shared soft output ceiling." }),
    ],
  }),
  effect({
    id: "vibrato",
    kind: SHADER_SYNTH_PLAYGROUND_FX_KINDS.vibrato,
    name: "Vibrato",
    aliases: ["pitch vibrato", "warble", "wow", "modulated delay"],
    tags: ["vibrato", "pitch", "modulation", "fractional delay", "stereo"],
    category: "space",
    color: "#e883ee",
    auditionKind: "history",
    auditionPreset: null,
    execution: "History pass · continuously moving fractional read",
    description: "Moves a causal fractional-delay read smoothly around the present, turning delay motion into a controlled periodic pitch bend.",
    wgsl: "wet = fractionalHistory(centerDelay + pitchDepth * vibratoWave(time));",
    faust: { symbol: "de.fdelay", url: "https://faustlibraries.grame.fr/libs/delays/" },
    params: [
      parameter("rate", "Rate", 0.15, 12, 5.2, { step: 0.01, unit: "Hz", scale: "log", low: "slow wow", high: "fast trill", behavior: "Sets how many complete pitch-bend cycles occur each second." }),
      parameter("depth", "Pitch depth", 0, 100, 18, { step: 1, unit: "cents", low: "steady", high: "wide bend", behavior: "Sets the approximate peak pitch excursion; one hundred cents is one semitone." }),
      parameter("delay", "Base delay", 2, 80, 8, { step: 0.1, unit: "ms", scale: "log", low: "near", high: "soft latency", behavior: "Sets the causal look-back position; the shader raises it automatically when a wide, slow bend needs more travel." }),
      parameter("mix", "Mix", 0, 1, 1, { step: 0.01, low: "dry", high: "pure vibrato", behavior: "Crossfades from the direct signal to the moving read; intermediate values also create a light chorus." }),
      parameter("stereo", "Stereo phase", 0, 1, 0.08, { step: 0.01, low: "together", high: "wide orbit", behavior: "Offsets the right-channel vibrato cycle by up to one quarter turn." }),
      parameter("shape", "Wave shape", 0, 1, 0.12, { step: 0.01, low: "sine", high: "triangle", behavior: "Morphs the smooth sinusoidal bend toward a more constant-speed triangular rise and fall." }),
      parameter("tone", "Softness", 0, 1, 0.06, { step: 0.01, low: "clear", high: "soft", behavior: "Averages neighboring history samples to gently restrain bright interpolation edges." }),
      parameter("level", "Level", 0, 1.2, 0.92, { step: 0.01, low: "quiet", high: "present", behavior: "Scales the bounded vibrato result before the next post effect." }),
    ],
  }),
]);

export function isShaderSynthPlaygroundFxKind(kind) {
  const numericKind = Number(kind);
  return Number.isFinite(numericKind)
    && SHADER_SYNTH_PLAYGROUND_FX_KIND_VALUES.includes(numericKind);
}

export function shaderSynthPlaygroundFxNodes(encodedPatch) {
  const kindById = new Map(SHADER_SYNTH_PLAYGROUND_FX_MODULES.map(({ id, kind }) => [id, kind]));
  let orderedNodes = [];
  if (Array.isArray(encodedPatch?.orderedNodes)) {
    orderedNodes = encodedPatch.orderedNodes;
  } else if (Array.isArray(encodedPatch?.order) && Array.isArray(encodedPatch?.patch?.nodes)) {
    const nodeById = new Map(encodedPatch.patch.nodes.map((node) => [node.id, node]));
    orderedNodes = encodedPatch.order.map((id) => nodeById.get(id)).filter(Boolean);
  } else if (Array.isArray(encodedPatch?.nodes)) {
    orderedNodes = encodedPatch.nodes;
  } else if (Array.isArray(encodedPatch?.patch?.nodes)) {
    orderedNodes = encodedPatch.patch.nodes;
  }
  return orderedNodes.filter((node) => {
    const kind = node?.kind ?? node?.type?.kind ?? kindById.get(node?.type);
    return isShaderSynthPlaygroundFxKind(kind);
  });
}

function normalizedFxSampleRate(sampleRate) {
  return Math.min(384000, Math.max(8000, Number(sampleRate) || 44100));
}

/**
 * Maximum history index read by one effect at any value in its public
 * parameter range. This is intentionally kind-based instead of following the
 * current knob values, so live parameter changes never require reallocating a
 * GPU ring. Interpolation safety is added by the history sizing functions.
 */
export function shaderSynthPlaygroundFxMaxLookbackFrames(kind, sampleRate) {
  const rate = normalizedFxSampleRate(sampleRate);
  const numericKind = Number(kind);
  if ([
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.delay,
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.reverb,
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.recombobulator,
  ].includes(numericKind)) {
    // Retain the established 12.5-second capacity: it covers the 12-second
    // delay train, 12.4-second room read, and 12.002-second recombination read.
    return Math.ceil(rate * FX_HISTORY_SECONDS);
  }
  if ([
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.spectralResynth,
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.fftRobotizer,
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.spectralGate,
  ].includes(numericKind)) {
    return 127; // The maximum 128-sample causal window reads lags 0..127.
  }
  if (numericKind === SHADER_SYNTH_PLAYGROUND_FX_KINDS.flanger) {
    // softenedHistoryAt adds an older fractional read to the 12 + 10 ms tap.
    return Math.floor(rate * 0.022 + 1) + 1;
  }
  if (numericKind === SHADER_SYNTH_PLAYGROUND_FX_KINDS.chorus) {
    // fractionalHistoryAt reads one sample beyond the 40 + 14 ms tap.
    return Math.floor(rate * 0.054) + 1;
  }
  if (numericKind === SHADER_SYNTH_PLAYGROUND_FX_KINDS.dopplerSweep) {
    // fractionalHistoryAt reads one sample beyond the one-second far point.
    return Math.floor(rate) + 1;
  }
  if (numericKind === SHADER_SYNTH_PLAYGROUND_FX_KINDS.vibrato) {
    const pitchRatioExcursion = 2 ** (100 / 1200) - 1;
    const maximumSweep = pitchRatioExcursion * rate / (4 * 0.15);
    // At the widest, slowest triangular sweep, centerDelay is sweep + two
    // samples and the positive orbit adds the same sweep once more.
    const maximumRequestedDelay = maximumSweep * 2 + 2;
    return Math.floor(maximumRequestedDelay + 1) + 1;
  }
  if ([
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.firLowpass,
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.firHighpass,
    SHADER_SYNTH_PLAYGROUND_FX_KINDS.firBandpass,
  ].includes(numericKind)) {
    return 30; // The fixed 31-tap span reads history indices 0..30.
  }
  if (numericKind === SHADER_SYNTH_PLAYGROUND_FX_KINDS.sampleRateReducer) {
    const maximumHold = Math.max(Math.round(rate / 50), 1);
    return maximumHold * 2 - 1; // Previous capture plus the current hold cell.
  }
  return 0;
}

function alignedFxHistoryFrames(maxLookbackFrames, chunkFrames) {
  const chunk = Math.max(0, Math.round(Number(chunkFrames) || 0));
  const lookback = Math.max(0, Math.ceil(Number(maxLookbackFrames) || 0));
  // One complete current chunk remains protected from ring overwrite while a
  // later effect pass reads it. Two extra frames cover fractional/soft reads.
  const required = Math.max(
    FX_MIN_HISTORY_FRAMES,
    lookback + chunk + FX_HISTORY_PADDING_FRAMES,
  );
  return Math.ceil(required / 256) * 256;
}

/**
 * The extra chunk prevents current dry writes from overwriting the oldest tap
 * that the same effect dispatch can still need when the ring wraps.
 */
export function shaderSynthPlaygroundFxHistoryFrames(sampleRate, chunkFrames = 0) {
  return alignedFxHistoryFrames(
    Math.ceil(normalizedFxSampleRate(sampleRate) * FX_HISTORY_SECONDS),
    chunkFrames,
  );
}

/**
 * Patch-aware counterpart to shaderSynthPlaygroundFxHistoryFrames. Passing no
 * patch deliberately preserves the complete-catalog allocation.
 */
export function shaderSynthPlaygroundFxHistoryFramesForPatch(
  patch,
  sampleRate,
  chunkFrames = 0,
) {
  if (patch == null) return shaderSynthPlaygroundFxHistoryFrames(sampleRate, chunkFrames);
  const lookback = shaderSynthPlaygroundFxKindsForPatch(patch).reduce(
    (maximum, kind) => Math.max(
      maximum,
      shaderSynthPlaygroundFxMaxLookbackFrames(kind, sampleRate),
    ),
    0,
  );
  return alignedFxHistoryFrames(lookback, chunkFrames);
}

export function shaderSynthPlaygroundFxHistoryByteSize(
  sampleRate,
  chunkFrames = 0,
  historyRegions = FX_HISTORY_REGIONS,
) {
  const regions = Math.min(
    FX_HISTORY_REGIONS,
    Math.max(1, Math.round(Number(historyRegions) || FX_HISTORY_REGIONS)),
  );
  return shaderSynthPlaygroundFxHistoryFrames(sampleRate, chunkFrames)
    * regions
    * 2
    * Float32Array.BYTES_PER_ELEMENT;
}

export function shaderSynthPlaygroundFxHistoryByteSizeForPatch(
  patch,
  sampleRate,
  chunkFrames = 0,
  historyRegions = FX_HISTORY_REGIONS,
) {
  const regions = Math.min(
    FX_HISTORY_REGIONS,
    Math.max(1, Math.round(Number(historyRegions) || FX_HISTORY_REGIONS)),
  );
  return shaderSynthPlaygroundFxHistoryFramesForPatch(patch, sampleRate, chunkFrames)
    * regions
    * 2
    * Float32Array.BYTES_PER_ELEMENT;
}

// Kept as a separate compute pass so every dry sample in the current chunk is
// visible before any temporal, spatial, or spectral invocation reads the ring.
export const SHADER_SYNTH_PLAYGROUND_HISTORY_CAPTURE_SHADER = /* wgsl */ `
override WORKGROUP_SIZE: u32 = 256u;

struct RenderInfo {
  baseSample: u32,
  nodeCount: u32,
  outputIndex: u32,
  sampleCount: u32,
  rampActive: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
}

@group(0) @binding(0) var<uniform> render_info: RenderInfo;
@group(0) @binding(1) var<storage, read> dry_chunk: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> fx_history: array<vec2<f32>>;

@compute @workgroup_size(WORKGROUP_SIZE)
fn captureDryHistory(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let sample = globalId.x;
  if (sample >= render_info.sampleCount || sample >= arrayLength(&dry_chunk)) { return; }
  let activeRegions = clamp((render_info.padding2 >> 8u) & 255u, 1u, ${FX_HISTORY_REGIONS}u);
  let historyFrames = arrayLength(&fx_history) / activeRegions;
  if (historyFrames == 0u) { return; }
  // Region zero always owns the dry, pre-effect timeline. Later ordered FX
  // dispatches fill one additional region per stage.
  fx_history[(render_info.baseSample + sample) % historyFrames] = dry_chunk[sample];
}
`;

export const SHADER_SYNTH_PLAYGROUND_FX_SHADER = /* wgsl */ `
override SAMPLE_RATE: f32 = 44100.0;
override WORKGROUP_SIZE: u32 = 256u;

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const PARAMETER_TRANSITION_SECONDS: f32 = 0.035;
const LN_1000: f32 = 6.907755278982137;
const MAX_GRAPH_NODES: u32 = 16u;
const MAX_DELAY_TAPS: u32 = 6u;
const MAX_REVERB_TAPS: u32 = 64u;
const MAX_RECOMBOBULATOR_HEADS: u32 = 12u;
const MAX_SPECTRAL_WINDOW: u32 = 128u;
const MAX_SPECTRAL_BINS: u32 = 24u;
const MAX_CHORUS_VOICES: u32 = 6u;
const MAX_FIR_TAPS: u32 = 31u;
const FIR_CENTER_TAP: u32 = (MAX_FIR_TAPS - 1u) / 2u;
const FX_HISTORY_REGIONS: u32 = ${FX_HISTORY_REGIONS}u;

struct RenderInfo {
  baseSample: u32,
  nodeCount: u32,
  outputIndex: u32,
  sampleCount: u32,
  rampActive: u32,
  padding0: u32,
  padding1: u32,
  padding2: u32,
}

struct GraphNode {
  header: vec4<f32>,
  previous0: vec4<f32>,
  previous1: vec4<f32>,
  target0: vec4<f32>,
  target1: vec4<f32>,
}

struct FxStageInfo {
  nodeIndex: u32,
  inputHistoryRegion: u32,
  outputHistoryRegion: u32,
  flags: u32,
}

@group(0) @binding(0) var<uniform> render_info: RenderInfo;
@group(0) @binding(1) var<storage, read> graph_nodes: array<GraphNode>;
@group(0) @binding(2) var<storage, read> input_chunk: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> sound_chunk: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> fx_history: array<vec2<f32>>;
@group(0) @binding(5) var<uniform> fx_stage: FxStageInfo;

fn hashU32(value: u32) -> f32 {
  var word = value;
  word = word ^ (word >> 16u);
  word = word * 0x7feb352du;
  word = word ^ (word >> 15u);
  word = word * 0x846ca68bu;
  word = word ^ (word >> 16u);
  return f32(word) * 2.3283064365386963e-10;
}

fn hashCoordinate(a: u32, b: u32, c: u32) -> f32 {
  return hashU32(a * 747796405u + b * 2891336453u + c * 277803737u + 1013904223u);
}

fn softClip(value: vec2<f32>) -> vec2<f32> {
  return value / (vec2<f32>(1.0) + abs(value));
}

fn equalPowerMix(dry: vec2<f32>, wet: vec2<f32>, amount: f32) -> vec2<f32> {
  let angle = clamp(amount, 0.0, 1.0) * PI * 0.5;
  return dry * cos(angle) + wet * sin(angle);
}

fn safeEffectLevel(signal: vec2<f32>, level: f32) -> vec2<f32> {
  return softClip(signal * clamp(level, 0.0, 1.2) * 1.25);
}

fn isHistoryEffectKind(kind: u32) -> bool {
  return kind == 29u
    || kind == 30u
    || kind == 31u
    || kind == 32u
    || kind == 60u
    || kind == 61u
    || kind == 62u
    || kind == 63u
    || kind == 64u
    || kind == 65u
    || kind == 84u
    || kind == 85u
    || kind == 86u
    || kind == 87u;
}

fn smootherstep01(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

fn phaseAtSample(sampleIndex: u32, rate: f32) -> f32 {
  var digits = sampleIndex;
  var scale = max(rate, 0.0) / SAMPLE_RATE;
  var phase = 0.0;
  for (var digit = 0u; digit < 4u; digit += 1u) {
    phase = fract(phase + f32(digits & 255u) * scale);
    digits = digits >> 8u;
    scale = fract(scale * 256.0);
  }
  return phase;
}

fn historyAt(sampleIndex: u32, delaySamples: u32) -> vec2<f32> {
  let activeRegions = clamp((render_info.padding2 >> 8u) & 255u, 1u, FX_HISTORY_REGIONS);
  let historyFrames = arrayLength(&fx_history) / activeRegions;
  if (historyFrames == 0u || delaySamples > sampleIndex) { return vec2<f32>(0.0); }
  let region = min(fx_stage.inputHistoryRegion, activeRegions - 1u);
  return fx_history[region * historyFrames + (sampleIndex - delaySamples) % historyFrames];
}

fn fractionalHistoryAt(sampleIndex: u32, requestedDelay: f32) -> vec2<f32> {
  let activeRegions = clamp((render_info.padding2 >> 8u) & 255u, 1u, FX_HISTORY_REGIONS);
  let historyFrames = arrayLength(&fx_history) / activeRegions;
  if (historyFrames < 3u) { return vec2<f32>(0.0); }
  let boundedDelay = clamp(requestedDelay, 1.0, f32(historyFrames - 2u));
  let whole = u32(floor(boundedDelay));
  return mix(historyAt(sampleIndex, whole), historyAt(sampleIndex, whole + 1u), fract(boundedDelay));
}

fn writeStageHistory(sampleIndex: u32, signal: vec2<f32>) {
  let activeRegions = clamp((render_info.padding2 >> 8u) & 255u, 1u, FX_HISTORY_REGIONS);
  let historyFrames = arrayLength(&fx_history) / activeRegions;
  if (historyFrames == 0u) { return; }
  let region = min(fx_stage.outputHistoryRegion, activeRegions - 1u);
  fx_history[region * historyFrames + sampleIndex % historyFrames] = signal;
}

fn softenedHistoryAt(sampleIndex: u32, delaySamples: f32, softness: f32) -> vec2<f32> {
  let sharp = fractionalHistoryAt(sampleIndex, delaySamples);
  let older = fractionalHistoryAt(sampleIndex, delaySamples + 1.0);
  return mix(sharp, (sharp + older) * 0.5, clamp(softness, 0.0, 1.0));
}

fn firTapCount(requested: f32) -> u32 {
  var taps = u32(clamp(round(requested), 7.0, f32(MAX_FIR_TAPS)));
  if ((taps & 1u) == 0u) { taps = min(taps + 1u, MAX_FIR_TAPS); }
  return taps;
}

fn firStereoCutoffs(cutoffHz: f32, stereoCents: f32) -> vec2<f32> {
  let split = exp2(clamp(stereoCents, 0.0, 1200.0) / 1200.0);
  let nyquistGuard = SAMPLE_RATE * 0.48;
  return clamp(vec2<f32>(cutoffHz / split, cutoffHz * split), vec2<f32>(5.0), vec2<f32>(nyquistGuard));
}

fn firSinc(value: vec2<f32>) -> vec2<f32> {
  let argument = PI * value;
  let outsideCenter = abs(argument) > vec2<f32>(0.00001);
  let safeArgument = select(vec2<f32>(1.0), argument, outsideCenter);
  return select(vec2<f32>(1.0), sin(argument) / safeArgument, outsideCenter);
}

fn firLowpassAt(
  sampleIndex: u32,
  cutoffHz: vec2<f32>,
  tapCount: u32,
  windowAmount: f32
) -> vec2<f32> {
  let activeCenter = (tapCount - 1u) / 2u;
  let firstHistoryTap = FIR_CENTER_TAP - activeCenter;
  let normalizedCutoff = clamp(cutoffHz / SAMPLE_RATE, vec2<f32>(0.00001), vec2<f32>(0.48));
  var filtered = vec2<f32>(0.0);
  var coefficientSum = vec2<f32>(0.0);
  for (var tap = 0u; tap < MAX_FIR_TAPS; tap += 1u) {
    if (tap >= tapCount) { break; }
    let offset = f32(i32(tap) - i32(activeCenter));
    let position = f32(tap) / f32(max(tapCount - 1u, 1u));
    let hann = 0.5 - 0.5 * cos(TAU * position);
    let window = mix(1.0, hann, clamp(windowAmount, 0.0, 1.0));
    let coefficient = 2.0 * normalizedCutoff * firSinc(2.0 * normalizedCutoff * offset) * window;
    filtered += historyAt(sampleIndex, firstHistoryTap + tap) * coefficient;
    coefficientSum += coefficient;
  }
  let safeSum = max(abs(coefficientSum), vec2<f32>(0.000001));
  return filtered / safeSum;
}

fn firLowpassEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let taps = firTapCount(p0.y);
  let alignedDry = historyAt(sampleIndex, FIR_CENTER_TAP);
  let cutoff = firStereoCutoffs(p0.x, p1.x);
  let filtered = firLowpassAt(sampleIndex, cutoff, taps, p0.z);
  return safeEffectLevel(equalPowerMix(alignedDry, filtered, p0.w), p1.y);
}

fn firHighpassEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let taps = firTapCount(p0.y);
  let alignedDry = historyAt(sampleIndex, FIR_CENTER_TAP);
  let cutoff = firStereoCutoffs(p0.x, p1.x);
  let filtered = alignedDry - firLowpassAt(sampleIndex, cutoff, taps, p0.z);
  return safeEffectLevel(equalPowerMix(alignedDry, filtered, p0.w), p1.y);
}

fn firBandpassEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let taps = firTapCount(p0.z);
  let alignedDry = historyAt(sampleIndex, FIR_CENTER_TAP);
  let lower = min(p0.x, p0.y);
  let upper = max(p0.x, p0.y);
  let lowerCutoff = firStereoCutoffs(lower, p1.y);
  let upperCutoff = firStereoCutoffs(upper, p1.y);
  let filtered = firLowpassAt(sampleIndex, upperCutoff, taps, p0.w)
    - firLowpassAt(sampleIndex, lowerCutoff, taps, p0.w);
  return safeEffectLevel(equalPowerMix(alignedDry, filtered, p1.x), p1.z);
}

fn reducerCellStart(sampleIndex: u32, holdSamples: u32, phase: f32) -> u32 {
  let phaseSamples = u32(round(clamp(phase, 0.0, 1.0) * f32(max(holdSamples - 1u, 0u))));
  let shiftedSample = sampleIndex + phaseSamples;
  let shiftedStart = (shiftedSample / holdSamples) * holdSamples;
  return shiftedStart - min(shiftedStart, phaseSamples);
}

fn reducedRateChannel(
  sampleIndex: u32,
  holdSamples: u32,
  phase: f32,
  interpolation: f32,
  bits: u32,
  dither: f32,
  channel: u32
) -> f32 {
  let currentStart = reducerCellStart(sampleIndex, holdSamples, phase);
  let currentDelay = sampleIndex - min(currentStart, sampleIndex);
  let currentValue = historyAt(sampleIndex, currentDelay)[channel];
  let previousStart = currentStart - min(currentStart, holdSamples);
  let previousDelay = sampleIndex - min(previousStart, sampleIndex);
  let previousValue = historyAt(sampleIndex, previousDelay)[channel];
  let cellPosition = f32(sampleIndex - min(currentStart, sampleIndex)) / f32(max(holdSamples - 1u, 1u));
  let interpolated = mix(previousValue, currentValue, smootherstep01(cellPosition));
  var reduced = mix(currentValue, interpolated, clamp(interpolation, 0.0, 1.0));
  if (bits >= 2u) {
    let levels = exp2(f32(min(bits, 16u))) - 1.0;
    let noise = (hashU32(currentStart ^ (channel * 0x9e3779b9u)) - 0.5) * clamp(dither, 0.0, 1.0) / levels;
    let unit = clamp(reduced * 0.5 + 0.5 + noise, 0.0, 1.0);
    reduced = round(unit * levels) / levels * 2.0 - 1.0;
  }
  return reduced;
}

fn sampleRateReducerEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let requestedRate = clamp(p0.x, 50.0, SAMPLE_RATE);
  let holdSamples = max(u32(round(SAMPLE_RATE / requestedRate)), 1u);
  let leftPhase = fract(clamp(p0.z, 0.0, 1.0));
  let rightPhase = fract(leftPhase + clamp(p0.w, 0.0, 1.0) * 0.5);
  let bits = u32(clamp(round(p1.x), 0.0, 16.0));
  let reduced = vec2<f32>(
    reducedRateChannel(sampleIndex, holdSamples, leftPhase, p0.y, bits, p1.y, 0u),
    reducedRateChannel(sampleIndex, holdSamples, rightPhase, p0.y, bits, p1.y, 1u)
  );
  return safeEffectLevel(equalPowerMix(signal, reduced, p1.z), p1.w);
}

fn delayEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let baseDelay = clamp(p0.x, 0.005, 2.0) * SAMPLE_RATE;
  let tapCount = u32(clamp(round(p0.y), 1.0, f32(MAX_DELAY_TAPS)));
  let decay = clamp(p0.z, 0.0, 0.94);
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let stereoSpread = clamp(p1.x, 0.0, 1.0);
  let softness = clamp(p1.y, 0.0, 1.0);
  let spacingExponent = mix(1.0, 1.55, clamp(p1.z, 0.0, 1.0));
  var wet = vec2<f32>(0.0);
  var energy = 0.0;
  for (var tap = 1u; tap <= MAX_DELAY_TAPS; tap += 1u) {
    if (tap > tapCount) { break; }
    let linearPosition = f32(tap - 1u) / max(f32(tapCount - 1u), 1.0);
    let tapPosition = 1.0 + pow(linearPosition, spacingExponent) * f32(tapCount - 1u);
    let gain = pow(decay, f32(tap - 1u));
    let history = softenedHistoryAt(sampleIndex, baseDelay * tapPosition, softness);
    // Alternating equal-power pans remain audible for mono sources; swapping
    // channels alone cannot widen two identical channels.
    let mono = (history.x + history.y) * 0.5;
    let tapPan = select(-1.0, 1.0, (tap & 1u) == 1u) * stereoSpread;
    let panAngle = (tapPan + 1.0) * PI * 0.25;
    let panned = vec2<f32>(cos(panAngle), sin(panAngle)) * mono * 1.41421356;
    wet += mix(history, panned, stereoSpread) * gain;
    energy += gain * gain;
  }
  wet /= max(sqrt(energy), 1.0);
  return mix(signal, wet, wetMix) * max(p1.w, 0.0);
}

fn reverbEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32, nodeIndex: u32) -> vec2<f32> {
  let roomSize = clamp(p0.x, 0.08, 12.0);
  let decayTime = clamp(p0.y, 0.1, 12.0);
  let tapCount = u32(clamp(round(p0.z), 4.0, f32(MAX_REVERB_TAPS)));
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let predelay = clamp(p1.x, 0.0, 0.4);
  let width = clamp(p1.y, 0.0, 1.0);
  let softness = clamp(p1.z, 0.0, 1.0);
  var wet = vec2<f32>(0.0);
  var energy = 0.0;
  for (var tap = 1u; tap <= MAX_REVERB_TAPS; tap += 1u) {
    if (tap > tapCount) { break; }
    let position = f32(tap) / f32(tapCount);
    let randomDelay = hashCoordinate(nodeIndex + 1u, tap, 17u);
    let scatter = 0.82 + randomDelay * 0.30;
    let reflectionPosition = clamp((0.003 + pow(position, 1.72) * 0.997) * scatter, 0.001, 1.0);
    let reflectionSeconds = roomSize * reflectionPosition;
    let delaySeconds = predelay + reflectionSeconds;
    let reflection = softenedHistoryAt(sampleIndex, delaySeconds * SAMPLE_RATE, softness);
    let mono = (reflection.x + reflection.y) * 0.5;
    let source = mix(vec2<f32>(mono), reflection, width * 0.45);
    let pan = (hashCoordinate(nodeIndex + 1u, tap, 53u) * 2.0 - 1.0) * width;
    let polarity = select(-1.0, 1.0, hashCoordinate(nodeIndex + 1u, tap, 91u) >= 0.48);
    let spatial = vec2<f32>(source.x * (1.0 - pan * 0.68), source.y * (1.0 + pan * 0.68));
    let gain = exp(-LN_1000 * reflectionSeconds / decayTime) / sqrt(f32(tap));
    wet += spatial * gain * polarity;
    energy += gain * gain;
  }
  wet = softClip(wet / max(sqrt(energy), 0.0001) * 1.35);
  return mix(signal, wet, wetMix) * max(p1.w, 0.0);
}

fn recombobulatorPattern(
  epoch: u32,
  memorySeconds: f32,
  headCount: u32,
  scatter: f32,
  width: f32,
  sampleIndex: u32,
  nodeIndex: u32
) -> vec2<f32> {
  var result = vec2<f32>(0.0);
  for (var head = 0u; head < MAX_RECOMBOBULATOR_HEADS; head += 1u) {
    if (head >= headCount) { break; }
    let ordered = (f32(head) + 0.5) / f32(headCount);
    let randomPosition = hashCoordinate(epoch + 1u, head + nodeIndex * 13u, 131u);
    let position = mix(ordered, randomPosition, scatter);
    let delaySeconds = 0.002 + memorySeconds * pow(clamp(position, 0.001, 1.0), mix(1.35, 0.48, scatter));
    var fragment = fractionalHistoryAt(sampleIndex, delaySeconds * SAMPLE_RATE);
    let channelFlip = hashCoordinate(epoch + 1u, head + nodeIndex * 7u, 197u) < width * 0.65;
    fragment = select(fragment, fragment.yx, channelFlip);
    let polarity = select(-1.0, 1.0, hashCoordinate(epoch + 1u, head, nodeIndex + 239u) >= 0.5);
    let pan = (hashCoordinate(epoch + 1u, head, nodeIndex + 271u) * 2.0 - 1.0) * width;
    result += vec2<f32>(fragment.x * (1.0 - pan * 0.7), fragment.y * (1.0 + pan * 0.7)) * polarity;
  }
  return result / sqrt(max(f32(headCount), 1.0));
}

fn recombobulatorEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32, nodeIndex: u32) -> vec2<f32> {
  let memorySeconds = clamp(p0.x, 0.02, 12.0);
  let headCount = u32(clamp(round(p0.y), 1.0, f32(MAX_RECOMBOBULATOR_HEADS)));
  let mutationRate = clamp(p0.z, 0.05, 20.0);
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let scatter = clamp(p1.x, 0.0, 1.0);
  let fold = clamp(p1.y, 0.0, 1.0);
  let width = clamp(p1.z, 0.0, 1.0);
  let periodSamples = max(u32(round(SAMPLE_RATE / mutationRate)), 1u);
  let epoch = sampleIndex / periodSamples;
  let epochPhase = f32(sampleIndex % periodSamples) / f32(periodSamples);
  let currentPattern = recombobulatorPattern(epoch, memorySeconds, headCount, scatter, width, sampleIndex, nodeIndex);
  let nextPattern = recombobulatorPattern(epoch + 1u, memorySeconds, headCount, scatter, width, sampleIndex, nodeIndex);
  let patternFade = smootherstep01((epochPhase - 0.68) / 0.32);
  var wet = mix(currentPattern, nextPattern, patternFade);
  let fractured = sin(wet * PI * (1.0 + fold * 5.0));
  wet = mix(softClip(wet * 1.2), fractured, fold);
  return mix(signal, wet, wetMix) * max(p1.w, 0.0);
}

fn spectralResynthEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32, nodeIndex: u32) -> vec2<f32> {
  let windowSize = u32(clamp(round(p0.x), 64.0, f32(MAX_SPECTRAL_WINDOW)));
  let binLimit = min(u32(clamp(round(p0.y), 4.0, f32(MAX_SPECTRAL_BINS))), max(windowSize / 2u - 1u, 1u));
  let shift = clamp(p0.z, 0.25, 4.0);
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let smear = clamp(p1.x, 0.0, 1.0);
  let tilt = clamp(p1.y, 0.25, 2.5);
  let width = clamp(p1.z, 0.0, 1.0);
  var resynthesized = vec2<f32>(0.0);
  for (var bin = 1u; bin <= MAX_SPECTRAL_BINS; bin += 1u) {
    if (bin > binLimit) { break; }
    var coefficientLeft = vec2<f32>(0.0);
    var coefficientRight = vec2<f32>(0.0);
    for (var lag = 0u; lag < MAX_SPECTRAL_WINDOW; lag += 1u) {
      if (lag >= windowSize) { break; }
      let sample = historyAt(sampleIndex, lag);
      let window = 0.5 - 0.5 * cos(TAU * f32(lag) / max(f32(windowSize - 1u), 1.0));
      let angle = TAU * f32(bin * lag) / f32(windowSize);
      let basis = vec2<f32>(cos(angle), sin(angle)) * window;
      coefficientLeft += basis * sample.x;
      coefficientRight += basis * sample.y;
    }
    let magnitudeScale = 4.0 / f32(windowSize);
    let magnitude = vec2<f32>(length(coefficientLeft), length(coefficientRight)) * magnitudeScale;
    let targetBin = f32(bin) * shift;
    let targetHz = targetBin * SAMPLE_RATE / f32(windowSize);
    if (targetHz < SAMPLE_RATE * 0.46) {
      let phase = TAU * phaseAtSample(sampleIndex, targetHz);
      let randomPhase = (hashCoordinate(nodeIndex + 1u, bin, 353u) * 2.0 - 1.0) * PI * smear;
      let sharedPhase = randomPhase * (1.0 - width);
      let stereoPhase = randomPhase * width;
      let spectralWeight = pow(f32(bin), 1.0 - tilt);
      resynthesized += vec2<f32>(
        sin(phase + sharedPhase + stereoPhase) * magnitude.x,
        sin(phase + sharedPhase - stereoPhase) * magnitude.y
      ) * spectralWeight;
    }
  }
  let wet = softClip(resynthesized * 0.82) * 1.35;
  return mix(signal, wet, wetMix) * max(p1.w, 0.0);
}

fn flangerEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let baseDelay = clamp(p0.x, 0.2, 12.0) * SAMPLE_RATE * 0.001;
  let sweepDepth = clamp(p0.y, 0.0, 10.0) * SAMPLE_RATE * 0.001;
  let rate = clamp(p0.z, 0.02, 12.0);
  let wetAmount = clamp(p0.w, 0.0, 1.0);
  let stereoPhase = clamp(p1.x, 0.0, 1.0) * 0.5;
  let polarity = clamp(p1.y, -1.0, 1.0);
  let softness = clamp(p1.z, 0.0, 1.0);
  let phase = phaseAtSample(sampleIndex, rate);
  let leftOrbit = 0.5 + 0.5 * sin(TAU * phase);
  let rightOrbit = 0.5 + 0.5 * sin(TAU * fract(phase + stereoPhase));
  let leftTap = softenedHistoryAt(sampleIndex, max(1.0, baseDelay + sweepDepth * leftOrbit), softness);
  let rightTap = softenedHistoryAt(sampleIndex, max(1.0, baseDelay + sweepDepth * rightOrbit), softness);
  let wet = vec2<f32>(leftTap.x, rightTap.y);
  let tapGain = wetAmount * polarity;
  let normalized = (signal + wet * tapGain) * inverseSqrt(max(1.0 + tapGain * tapGain, 1.0));
  return safeEffectLevel(normalized, p1.w);
}

fn chorusEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let baseDelay = clamp(p0.x, 6.0, 40.0) * SAMPLE_RATE * 0.001;
  let sweepDepth = clamp(p0.y, 0.0, 14.0) * SAMPLE_RATE * 0.001;
  let rate = clamp(p0.z, 0.02, 6.0);
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let voiceCount = u32(clamp(round(p1.x), 3.0, f32(MAX_CHORUS_VOICES)));
  let stereoSpread = clamp(p1.y, 0.0, 1.0);
  let rateDrift = clamp(p1.z, 0.0, 1.0);
  var wet = vec2<f32>(0.0);
  for (var voice = 0u; voice < MAX_CHORUS_VOICES; voice += 1u) {
    if (voice >= voiceCount) { break; }
    let voicePosition = (f32(voice) + 0.5) / f32(voiceCount);
    let voiceRate = rate * (1.0 + (voicePosition - 0.5) * rateDrift * 0.32);
    let phase = phaseAtSample(sampleIndex, max(voiceRate, 0.001));
    let leftPhase = fract(phase + voicePosition);
    let rightOffset = stereoSpread * (0.125 + voicePosition * 0.375);
    let rightPhase = fract(phase + voicePosition + rightOffset);
    let leftDelay = baseDelay + sweepDepth * (0.5 + 0.5 * sin(TAU * leftPhase));
    let rightDelay = baseDelay + sweepDepth * (0.5 + 0.5 * sin(TAU * rightPhase));
    let leftTap = fractionalHistoryAt(sampleIndex, max(leftDelay, 1.0));
    let rightTap = fractionalHistoryAt(sampleIndex, max(rightDelay, 1.0));
    wet += vec2<f32>(leftTap.x, rightTap.y);
  }
  wet /= max(f32(voiceCount), 1.0);
  return safeEffectLevel(equalPowerMix(signal, wet, wetMix), p1.w);
}

fn vibratoWave(phase: f32, shape: f32) -> f32 {
  let sine = sin(TAU * phase);
  let triangle = 1.0 - 4.0 * abs(fract(phase + 0.25) - 0.5);
  return mix(sine, triangle, clamp(shape, 0.0, 1.0));
}

fn vibratoEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let rate = clamp(p0.x, 0.15, 12.0);
  let cents = clamp(p0.y, 0.0, 100.0);
  let requestedBase = clamp(p0.z, 2.0, 80.0) * SAMPLE_RATE * 0.001;
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let stereoOffset = clamp(p1.x, 0.0, 1.0) * 0.25;
  let shape = clamp(p1.y, 0.0, 1.0);
  let softness = clamp(p1.z, 0.0, 1.0);
  // A changing delay has resampling ratio 1 - d(delay)/d(sample). Converting
  // cents to a ratio here keeps Depth musical even when Rate changes.
  let pitchRatioExcursion = pow(2.0, cents / 1200.0) - 1.0;
  let peakWaveSlope = mix(TAU, 4.0, shape);
  let sweepDepth = pitchRatioExcursion * SAMPLE_RATE / max(peakWaveSlope * rate, 0.0001);
  let centerDelay = max(requestedBase, sweepDepth + 2.0);
  let phase = phaseAtSample(sampleIndex, rate);
  let leftDelay = centerDelay + sweepDepth * vibratoWave(phase, shape);
  let rightDelay = centerDelay + sweepDepth * vibratoWave(fract(phase + stereoOffset), shape);
  let leftTap = softenedHistoryAt(sampleIndex, leftDelay, softness);
  let rightTap = softenedHistoryAt(sampleIndex, rightDelay, softness);
  let wet = vec2<f32>(leftTap.x, rightTap.y);
  return safeEffectLevel(equalPowerMix(signal, wet, wetMix), p1.w);
}

fn dopplerSweepEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let centerDelayMs = clamp(p0.x, 1.0, 500.0);
  let travelMs = clamp(p0.y, 0.0, 500.0);
  let rate = clamp(p0.z, 0.02, 8.0);
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let motionCurve = clamp(p1.x, 0.25, 4.0);
  let stereoOffset = clamp(p1.y, 0.0, 1.0) * 0.24;
  let distanceLoss = clamp(p1.z, 0.0, 1.0);
  let phase = phaseAtSample(sampleIndex, rate);
  let leftOrbitRaw = 0.5 + 0.5 * sin(TAU * phase);
  let rightOrbitRaw = 0.5 + 0.5 * sin(TAU * fract(phase + stereoOffset));
  let leftOrbit = pow(clamp(leftOrbitRaw, 0.0001, 1.0), motionCurve);
  let rightOrbit = pow(clamp(rightOrbitRaw, 0.0001, 1.0), motionCurve);
  let leftDelayMs = max(0.05, centerDelayMs + (leftOrbit * 2.0 - 1.0) * travelMs);
  let rightDelayMs = max(0.05, centerDelayMs + (rightOrbit * 2.0 - 1.0) * travelMs);
  let leftTap = fractionalHistoryAt(sampleIndex, max(leftDelayMs * SAMPLE_RATE * 0.001, 1.0));
  let rightTap = fractionalHistoryAt(sampleIndex, max(rightDelayMs * SAMPLE_RATE * 0.001, 1.0));
  let leftAttenuation = 1.0 / (1.0 + distanceLoss * leftDelayMs * 0.01);
  let rightAttenuation = 1.0 / (1.0 + distanceLoss * rightDelayMs * 0.01);
  let wet = vec2<f32>(leftTap.x * leftAttenuation, rightTap.y * rightAttenuation);
  return safeEffectLevel(equalPowerMix(signal, wet, wetMix), p1.w);
}

fn fftRobotizerEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32, nodeIndex: u32) -> vec2<f32> {
  let windowSize = u32(clamp(round(p0.x), 64.0, f32(MAX_SPECTRAL_WINDOW)));
  let binLimit = min(u32(clamp(round(p0.y), 4.0, f32(MAX_SPECTRAL_BINS))), max(windowSize / 2u - 1u, 1u));
  let phaseStates = u32(clamp(round(p0.z), 1.0, 16.0));
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let shift = clamp(p1.x, 0.5, 2.0);
  let tilt = clamp(p1.y, 0.5, 2.5);
  let width = clamp(p1.z, 0.0, 1.0);
  var resynthesized = vec2<f32>(0.0);
  var weightEnergy = 0.0;
  var activeBins = 0.0;
  for (var bin = 1u; bin <= MAX_SPECTRAL_BINS; bin += 1u) {
    if (bin > binLimit) { break; }
    var coefficientLeft = vec2<f32>(0.0);
    var coefficientRight = vec2<f32>(0.0);
    for (var lag = 0u; lag < MAX_SPECTRAL_WINDOW; lag += 1u) {
      if (lag >= windowSize) { break; }
      let historySample = historyAt(sampleIndex, lag);
      let window = 0.5 - 0.5 * cos(TAU * f32(lag) / max(f32(windowSize - 1u), 1.0));
      let angle = TAU * f32(bin * lag) / f32(windowSize);
      let basis = vec2<f32>(cos(angle), sin(angle)) * window;
      coefficientLeft += basis * historySample.x;
      coefficientRight += basis * historySample.y;
    }
    let magnitudeScale = 4.0 / f32(windowSize);
    let magnitude = vec2<f32>(length(coefficientLeft), length(coefficientRight)) * magnitudeScale;
    let targetHz = f32(bin) * shift * SAMPLE_RATE / f32(windowSize);
    if (targetHz < SAMPLE_RATE * 0.46) {
      let phaseSlot = floor(hashCoordinate(nodeIndex + 1u, bin, 607u) * f32(phaseStates));
      let fixedPhase = TAU * phaseSlot / f32(phaseStates);
      let carrierPhase = TAU * phaseAtSample(sampleIndex, targetHz);
      let rightFixedPhase = mix(fixedPhase, -fixedPhase, width);
      let spectralWeight = pow(f32(bin), 1.0 - tilt);
      resynthesized += vec2<f32>(
        sin(carrierPhase + fixedPhase) * magnitude.x,
        sin(carrierPhase + rightFixedPhase) * magnitude.y
      ) * spectralWeight;
      weightEnergy += spectralWeight * spectralWeight;
      activeBins += 1.0;
    }
  }
  let normalization = sqrt(max(activeBins, 1.0)) / sqrt(max(weightEnergy, 0.0001));
  let wet = resynthesized * normalization * 0.82;
  return safeEffectLevel(equalPowerMix(signal, wet, wetMix), p1.w);
}

fn spectralGateEffect(signal: vec2<f32>, p0: vec4<f32>, p1: vec4<f32>, sampleIndex: u32) -> vec2<f32> {
  let windowSize = u32(clamp(round(p0.x), 64.0, f32(MAX_SPECTRAL_WINDOW)));
  let binLimit = min(u32(clamp(round(p0.y), 4.0, f32(MAX_SPECTRAL_BINS))), max(windowSize / 2u - 1u, 1u));
  let threshold = clamp(p0.z, 0.001, 0.5);
  let wetMix = clamp(p0.w, 0.0, 1.0);
  let knee = clamp(p1.x, 0.0, 1.0);
  let reduction = clamp(p1.y, 0.0, 1.0);
  let tilt = clamp(p1.z, 0.5, 2.5);
  var reconstructed = vec2<f32>(0.0);
  var weightEnergy = 0.0;
  for (var bin = 1u; bin <= MAX_SPECTRAL_BINS; bin += 1u) {
    if (bin > binLimit) { break; }
    var coefficientLeft = vec2<f32>(0.0);
    var coefficientRight = vec2<f32>(0.0);
    for (var lag = 0u; lag < MAX_SPECTRAL_WINDOW; lag += 1u) {
      if (lag >= windowSize) { break; }
      let historySample = historyAt(sampleIndex, lag);
      let angle = TAU * f32(bin * lag) / f32(windowSize);
      // A causal rectangular sliding DFT has unity weight at lag zero, so the
      // real coefficients of open positive-frequency bins reconstruct the
      // current in-band sample. A Hann analysis is zero at lag zero and makes
      // its neighboring lobes cancel when summed without overlap-add.
      let basis = vec2<f32>(cos(angle), sin(angle));
      coefficientLeft += basis * historySample.x;
      coefficientRight += basis * historySample.y;
    }
    let magnitudeScale = 2.0 / f32(windowSize);
    let magnitude = vec2<f32>(length(coefficientLeft), length(coefficientRight)) * magnitudeScale;
    let sharedMagnitude = max(magnitude.x, magnitude.y);
    let kneeWidth = max(threshold * (0.04 + knee * 0.96), 0.0001);
    let gate = smoothstep(max(threshold - kneeWidth, 0.0), threshold + kneeWidth, sharedMagnitude);
    let mask = mix(1.0 - reduction, 1.0, gate);
    let spectralWeight = pow(f32(bin), 1.0 - tilt);
    reconstructed += vec2<f32>(coefficientLeft.x, coefficientRight.x) * magnitudeScale * spectralWeight * mask;
    weightEnergy += spectralWeight * spectralWeight;
  }
  let normalization = sqrt(max(f32(binLimit), 1.0)) / sqrt(max(weightEnergy, 0.0001));
  let wet = reconstructed * normalization;
  return safeEffectLevel(equalPowerMix(signal, wet, wetMix), p1.w);
}

fn applyEffect(
  kind: u32,
  signal: vec2<f32>,
  p0: vec4<f32>,
  p1: vec4<f32>,
  sampleIndex: u32,
  nodeIndex: u32
) -> vec2<f32> {
  switch kind {
    case 29u: { return delayEffect(signal, p0, p1, sampleIndex); }
    case 30u: { return reverbEffect(signal, p0, p1, sampleIndex, nodeIndex); }
    case 31u: { return recombobulatorEffect(signal, p0, p1, sampleIndex, nodeIndex); }
    case 32u: { return spectralResynthEffect(signal, p0, p1, sampleIndex, nodeIndex); }
    case 60u: { return flangerEffect(signal, p0, p1, sampleIndex); }
    case 61u: { return chorusEffect(signal, p0, p1, sampleIndex); }
    case 62u: { return dopplerSweepEffect(signal, p0, p1, sampleIndex); }
    case 63u: { return fftRobotizerEffect(signal, p0, p1, sampleIndex, nodeIndex); }
    case 64u: { return spectralGateEffect(signal, p0, p1, sampleIndex); }
    case 65u: { return vibratoEffect(signal, p0, p1, sampleIndex); }
    case 84u: { return firLowpassEffect(signal, p0, p1, sampleIndex); }
    case 85u: { return firHighpassEffect(signal, p0, p1, sampleIndex); }
    case 86u: { return firBandpassEffect(signal, p0, p1, sampleIndex); }
    case 87u: { return sampleRateReducerEffect(signal, p0, p1, sampleIndex); }
    default: { return signal; }
  }
}

fn finalizeOutput(signal: vec2<f32>, params: vec4<f32>) -> vec2<f32> {
  let ceiling = clamp(params.y, 0.2, 1.0);
  return clamp(softClip(signal * params.x) * 1.7, vec2<f32>(-ceiling), vec2<f32>(ceiling));
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn processPostGraphFx(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let sample = globalId.x;
  if (sample >= render_info.sampleCount || sample >= arrayLength(&input_chunk) || sample >= arrayLength(&sound_chunk)) { return; }
  let sampleIndex = render_info.baseSample + sample;
  var ramp = 1.0;
  if (render_info.rampActive != 0u && render_info.sampleCount > 1u) {
    let transitionSamples = min(
      render_info.sampleCount - 1u,
      max(u32(round(SAMPLE_RATE * PARAMETER_TRANSITION_SECONDS)), 1u)
    );
    ramp = smootherstep01(f32(min(sample, transitionSamples)) / f32(transitionSamples));
  }
  var previousSignal = input_chunk[sample];
  var targetSignal = previousSignal;
  let stageActive = (fx_stage.flags & 1u) != 0u;
  let stageFinal = (fx_stage.flags & 2u) != 0u;
  if (stageActive && fx_stage.nodeIndex < render_info.nodeCount && fx_stage.nodeIndex < arrayLength(&graph_nodes)) {
    let graphNode = graph_nodes[fx_stage.nodeIndex];
    let kind = u32(round(graphNode.header.x));
    if (isHistoryEffectKind(kind)) {
      previousSignal = applyEffect(kind, previousSignal, graphNode.previous0, graphNode.previous1, sampleIndex, fx_stage.nodeIndex);
      if (render_info.rampActive != 0u) {
        targetSignal = applyEffect(kind, targetSignal, graphNode.target0, graphNode.target1, sampleIndex, fx_stage.nodeIndex);
      } else {
        targetSignal = previousSignal;
      }
    }
  }
  let stageSignal = mix(previousSignal, targetSignal, ramp);
  if (stageActive) { writeStageHistory(sampleIndex, stageSignal); }
  if (!stageFinal) {
    sound_chunk[sample] = stageSignal;
    return;
  }

  var previousOutput = vec4<f32>(1.0, 0.98, 0.0, 0.0);
  var targetOutput = previousOutput;
  if (render_info.outputIndex < render_info.nodeCount && render_info.outputIndex < arrayLength(&graph_nodes)) {
    let outputNode = graph_nodes[render_info.outputIndex];
    if (u32(round(outputNode.header.x)) == 16u) {
      previousOutput = outputNode.previous0;
      targetOutput = outputNode.target0;
    }
  }
  let previousFinal = finalizeOutput(previousSignal, previousOutput);
  let targetFinal = finalizeOutput(targetSignal, targetOutput);
  sound_chunk[sample] = clamp(mix(previousFinal, targetFinal, ramp), vec2<f32>(-0.98), vec2<f32>(0.98));
}
`;

export function shaderSynthPlaygroundFxKindsForPatch(patch) {
  const kindById = new Map(SHADER_SYNTH_PLAYGROUND_FX_MODULES.map(({ id, kind }) => [id, kind]));
  return [...new Set(shaderSynthPlaygroundFxNodes(patch)
    .map((node) => node?.kind ?? node?.type?.kind ?? kindById.get(node?.type))
    .map(Number)
    .filter((kind) => isShaderSynthPlaygroundFxKind(kind)))]
    .sort((left, right) => left - right);
}

export function shaderSynthPlaygroundFxShaderKeyForPatch(patch) {
  return shaderSynthPlaygroundFxKindsForPatch(patch).join(",");
}

function fxMatchingWgslBrace(source, openingIndex) {
  let depth = 0;
  let lineComment = false;
  let blockCommentDepth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (current === "{") depth += 1;
    else if (current === "}" && --depth === 0) return index;
  }
  return -1;
}

function fxNextWgslOpeningBrace(source, startIndex, limit = source.length) {
  let lineComment = false;
  let blockCommentDepth = 0;
  for (let index = startIndex; index < limit; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 1;
    } else if (current === "{") return index;
  }
  return -1;
}

function filterFxApplyCases(source, activeKinds) {
  const keep = new Set(activeKinds.map((kind) => Math.round(Number(kind))));
  const functionStart = source.indexOf("fn applyEffect(");
  const switchStart = source.indexOf("switch kind", functionStart);
  const switchOpen = fxNextWgslOpeningBrace(source, switchStart);
  const switchClose = fxMatchingWgslBrace(source, switchOpen);
  if (functionStart < 0 || switchStart < 0 || switchOpen < 0 || switchClose < 0) return source;
  const clauses = [];
  let cursor = switchOpen + 1;
  while (cursor < switchClose) {
    const marker = source.slice(cursor, switchClose).match(/\b(?:case\s+\d+u\s*:|default\s*:)/);
    if (!marker) break;
    const clauseStart = cursor + marker.index;
    const clauseOpen = fxNextWgslOpeningBrace(source, clauseStart, switchClose);
    if (clauseOpen < 0) break;
    const clauseClose = fxMatchingWgslBrace(source, clauseOpen);
    if (clauseClose < 0 || clauseClose > switchClose) break;
    const clause = source.slice(clauseStart, clauseClose + 1);
    const kindMatch = clause.match(/^case\s+(\d+)u\s*:/);
    if (!kindMatch || keep.has(Number(kindMatch[1]))) clauses.push(clause.trim());
    cursor = clauseClose + 1;
  }
  return `${source.slice(0, switchOpen + 1)}\n    ${clauses.join("\n    ")}\n  ${source.slice(switchClose)}`;
}

function fxTopLevelWgslFunctions(source) {
  const functions = [];
  let depth = 0;
  let lineComment = false;
  let blockCommentDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (current === "{") {
      depth += 1;
      continue;
    }
    if (current === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (
      depth !== 0
      || source.slice(index, index + 2) !== "fn"
      || /[A-Za-z0-9_]/.test(source[index - 1] ?? "")
      || /[A-Za-z0-9_]/.test(source[index + 2] ?? "")
    ) continue;
    const header = source.slice(index).match(/^fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!header) continue;
    const opening = fxNextWgslOpeningBrace(source, index + header[0].length);
    const closing = fxMatchingWgslBrace(source, opening);
    if (opening < 0 || closing < 0) continue;
    functions.push({ name: header[1], start: index, end: closing + 1, source: source.slice(index, closing + 1) });
    index = closing;
  }
  return functions;
}

function removeUnusedFxWgslFunctions(source) {
  const functions = fxTopLevelWgslFunctions(source);
  const byName = new Map(functions.map((entry) => [entry.name, entry]));
  const retained = new Set(["processPostGraphFx", "applyEffect"]);
  const queue = [...retained];
  while (queue.length) {
    const current = byName.get(queue.shift());
    if (!current) continue;
    for (const candidate of functions) {
      if (retained.has(candidate.name)) continue;
      if (new RegExp(`\\b${candidate.name}\\s*\\(`).test(current.source)) {
        retained.add(candidate.name);
        queue.push(candidate.name);
      }
    }
  }
  let specialized = source;
  for (const entry of [...functions].reverse()) {
    if (!retained.has(entry.name)) {
      specialized = specialized.slice(0, entry.start) + specialized.slice(entry.end);
    }
  }
  return specialized;
}

/**
 * Compile only the effect implementations present in one patch. The complete
 * shader remains exported above for documentation and coverage auditing.
 */
export function createShaderSynthPlaygroundFxShader(patch) {
  const activeKinds = shaderSynthPlaygroundFxKindsForPatch(patch);
  return removeUnusedFxWgslFunctions(filterFxApplyCases(
    SHADER_SYNTH_PLAYGROUND_FX_SHADER,
    activeKinds,
  ));
}

import { SYNTHESIS_METHODS } from "./catalog.js";

const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

/** Primary references describe the named example, not every member of a family.
 * The implementation explanations below are an audit of this engine, not a
 * claim that its common note envelope recreates the referenced instruments. */
export const AMPLITUDE_SOURCES = freeze({
  noteShaping: {
    label: "Csound manual: linen and independently applied amplitude contours",
    url: "https://csound.com/manual/opcodes/linen/",
    evidence: "An amplitude function can shape a generated signal separately from its synthesis algorithm.",
  },
  minimoog: {
    label: "Moog / Universal Audio: Minimoog contour controls",
    url: "https://help.uaudio.com/hc/en-us/articles/360041479272-Moog-Minimoog-Manual",
    evidence: "The documented Minimoog contour has attack, decay and sustain; its decay switch also uses decay time after key release. Filter and loudness contours are separate.",
  },
  dx7: {
    label: "Yamaha: DX7 Operating Manual, envelope generator",
    url: "https://usa.yamaha.com/files/download/other_assets/9/333979/DX7E1.pdf",
    evidence: "Each DX7 operator has four rates and four levels. A carrier envelope affects amplitude; a modulator envelope changes timbre.",
  },
  karplus: {
    label: "Julius O. Smith: The Karplus–Strong Algorithm",
    url: "https://www.dsprelated.com/freebooks/pasp/Karplus_Strong_Algorithm.html",
    evidence: "Noise initializes a plucked delay loop; the loop loss filter produces frequency-dependent decay.",
  },
  grains: {
    label: "Barry Truax: Granular Synthesis",
    url: "https://www.sfu.ca/~truax/gran.html",
    evidence: "Grains have short amplitude windows; window shape and grain duration also affect the spectrum. This is a different time scale from the amplitude of a complete phrase.",
  },
  fof: {
    label: "Csound manual: FOF sinusoidal bursts",
    url: "https://csound.com/docs/manual/fof.html",
    evidence: "Bandwidth sets the sinusoidal burst's exponential decay; rise, duration and decay further window each burst.",
  },
  scanned: {
    label: "Csound manual: scanned synthesis",
    url: "https://csound.com/manual/siggen/scantop/",
    evidence: "A slowly changing mass–spring model supplies a waveform that is scanned at audio rate; damping and excitation belong to the evolving model.",
  },
  scans: {
    label: "Csound manual: scans output amplitude",
    url: "https://csound.com/manual/opcodes/scans/",
    evidence: "The scanner's amplitude multiplier is separate from the instantaneous amplitude of its evolving wavetable.",
  },
  psg: {
    label: "General Instrument: AY-3-8910/8912 data manual (1979)",
    url: "https://archive.org/details/rearc_atari-st-e-tt-toolkit-b1-73-ay-3-8910-8912-psg-data-manual-1979-02",
    evidence: "Clocked envelope shapes and stepped volume levels are a hardware articulation mechanism, not a continuous four-parameter ADSR.",
  },
});

// These are UI recommendations only. They NEVER replace, disable or flatten an
// envelope. lib.rs multiplies every generator by its host ADSR, and some models
// also use that envelope for excitation/timbre. Existing presets retain both.
const natural = (label, controls, explanation, sourceIds = []) => ({
  category: "natural-decay", label, intrinsicControlIds: controls,
  intrinsicExplanation: explanation, displayStyle: "decay-controls",
  collapseNoteEnvelope: true, sourceIds,
});
const windowed = (label, controls, explanation, sourceIds = ["grains"]) => ({
  category: "microsound-window", label, intrinsicControlIds: controls,
  intrinsicExplanation: explanation, displayStyle: "window-controls",
  sourceIds,
});
const spectral = (label, controls, explanation, sourceIds = []) => ({
  category: "spectral-articulation", label, intrinsicControlIds: controls,
  intrinsicExplanation: explanation, displayStyle: "spectral-controls",
  sourceIds,
});

const DETAILS = {
  sampling: {
    category: "source-playback", label: "Recorded contour / loop",
    intrinsicControlIds: ["position", "loop-length", "loop-crossfade"],
    intrinsicExplanation: "The recording contains its own amplitude history. This engine repeats the selected region; loop crossfade softens its edges, not the beginning and end of the played note.",
    displayStyle: "source-region",
  },
  additive: {
    label: "Partial levels / note amplitude",
    intrinsicControlIds: Array.from({ length: 8 }, (_, i) => `partial-${i + 1}`),
    intrinsicExplanation: "Partial levels set the spectrum, not independent time envelopes. This implementation applies one note contour after summing the partials.",
    displayStyle: "partial-levels",
  },
  granular: windowed("Grain windows / phrase amplitude",
    ["grain-size", "grain-window", "density"],
    "Each source grain is windowed before overlap. Duration, window shape and density shape the grain stream; they do not replace a whole-note contour."),
  subtractive: {
    label: "Loudness contour / filter movement",
    intrinsicControlIds: [],
    intrinsicExplanation: "The oscillator is continuous. The added note contour shapes output amplitude and, through Cutoff envelope, also moves this engine's filter cutoff.",
    historicalContext: "Minimoog's three-knob contours and release switch differ from an independent ADSR. This teaching engine also shares its amplitude contour with cutoff modulation rather than supplying two independent contour generators.",
    sourceIds: ["minimoog"],
  },
  fm: spectral("Index transient / carrier amplitude", ["index-envelope"],
    "Index envelope mixes in a fixed exponential fall of modulation index after a note starts. It changes brightness; the added note contour controls overall amplitude.", ["dx7"]),
  pm: {
    label: "Operator levels / note amplitude",
    intrinsicControlIds: [],
    intrinsicExplanation: "This engine has continuous phase-modulation operators, not per-operator time envelopes. The added note contour supplies amplitude articulation.",
    sourceIds: ["dx7"],
  },
  physical: natural("Strike / mechanical damping", ["damping", "strike-width"],
    "A velocity impulse excites the mass–spring chain; damping removes its energy. The note contour still multiplies the result and also changes stiffness when Tension envelope is nonzero."),
  modal: natural("Strike / mode decay", ["modal-decay", "decay-tilt", "strike-hardness", "strike-noise"],
    "A strike excites resonant modes. Each mode decays internally, with Modal decay and Decay tilt setting their losses. The added note contour can shorten that ringing."),
  waveguide: {
    category: "driven-resonator", label: "Breath excitation / bore loss",
    intrinsicControlIds: ["pressure", "loss", "breath-noise"],
    intrinsicExplanation: "Pressure drives a nonlinear reed while the gate is held. The note contour scales that pressure and noise as well as output amplitude; bore losses shape the remaining vibration.",
    displayStyle: "excitation-controls",
  },
  "karplus-strong": natural("Pick excitation / string decay", ["decay", "damping", "excitation-length", "pick-burst"],
    "A burst excites the delay loop; loop decay and damping produce the string's own fading sound. The added note contour still gates the result and can truncate that tail.", ["karplus"]),
  fof: windowed("Burst onset / formant decay", ["onset-time", "bandwidth", "grain-decay-span"],
    "Each repeated sinusoidal burst has an onset and exponential decay tied to bandwidth. These microscopic envelopes set formant color, not the duration of the complete sung note.", ["fof"]),
  vosim: windowed("Pulse-group damping", ["pulses", "damping", "silence"],
    "Sine-squared pulses lose amplitude within each repeating group, followed by silence. Group damping is not a one-shot whole-note release.", []),
  "window-formant": windowed("Cycle window / note amplitude", ["window-width", "window-skew", "window-shape"],
    "A window shapes the carrier within each repeating fundamental cycle. Window width and skew shape its formant spectrum; note amplitude is applied separately."),
  "noise-modulation": {
    label: "Amplitude fluctuation / note contour", intrinsicControlIds: ["depth", "noise-rate", "am-fm"],
    intrinsicExplanation: "Correlated noise can fluctuate amplitude or frequency. This ongoing modulation does not end a note; the added contour controls the note and can also modulate fluctuation depth.",
  },
  stochastic: {
    label: "Breakpoint motion / note amplitude", intrinsicControlIds: [],
    intrinsicExplanation: "Amplitude step changes a random walk of waveform breakpoint heights, not a note's decay time. The added note contour articulates this continuing waveform process.",
  },
  pulsar: windowed("Pulsaret window / note amplitude", ["duty", "window", "pulse-damping", "pulse-skew"],
    "A window and local damping shape each repeating pulsaret. The stream continues independently of a complete note's amplitude contour."),
  "phase-vocoder": {
    category: "source-playback", label: "Source dynamics / spectral gate",
    intrinsicControlIds: ["spectral-gate", "freeze"],
    intrinsicExplanation: "Resynthesis retains or freezes analyzed source energy; Spectral gate rejects weak bins. Neither is a played-note envelope, which is added after resynthesis.",
    displayStyle: "spectral-controls",
  },
  scanned: {
    category: "driven-resonator", label: "Shape damping / bow excitation",
    intrinsicControlIds: ["damping", "bow-force"],
    intrinsicExplanation: "A struck mass–spring shape decays, while Bow force can keep supplying energy during a held gate. Scanning reads that moving shape; the added output contour is separate from its mechanical damping.",
    displayStyle: "excitation-controls", collapseNoteEnvelope: true,
    sourceIds: ["scanned", "scans"],
  },
  corpus: windowed("Fragment windows / phrase amplitude", ["fragment-length", "fragment-window", "fragment-overlap"],
    "Selected fragments retain source dynamics and receive overlap windows. The added note contour controls the complete concatenated stream."),
  ddsp: spectral("Attack color / note amplitude", ["attack-brightness", "attack-time"],
    "Attack brightness and Attack color time control a spectral transient in the learned-controller output. They are not a separate amplitude envelope."),
  "hard-sync": spectral("Sync sweep / note amplitude", ["sync-envelope"],
    "Sync envelope moves the slave ratio using the added note contour. Its amount changes harmonic motion; it does not supply an independent amplitude envelope."),
  wavelet: {
    label: "Scale weights / note amplitude", intrinsicControlIds: [],
    intrinsicExplanation: "Scale decay reduces weights across wavelet scales. It is not a decay time and does not make the repeating waveform into a fading note.",
  },
  "particle-shaker": {
    category: "driven-resonator", label: "Shake energy / collision decay",
    intrinsicControlIds: ["energy-decay", "shake-force", "resonance-q"],
    intrinsicExplanation: "A note injects shake energy. Energy decay and resonator losses let it die away; Shake force can replenish energy while the gate is held. The added note contour still gates the audible result.",
    displayStyle: "excitation-controls", collapseNoteEnvelope: true,
  },
  "fdtd-membrane": natural("Strike / membrane damping", ["damping", "strike-hardness"],
    "A strike excites the finite-difference membrane. Internal damping removes vibration energy; the added note contour can shorten the natural model response."),
  "fdn-resonator": natural("Excitation / network decay", ["decay", "damping", "injection", "excitation-noise"],
    "A short excitation enters coupled delay lines. Feedback losses and damping create a resonant tail; the added note contour still bounds its audible duration."),
  "psg-pulse": {
    category: "stepped-envelope", label: "Clocked volume envelope",
    intrinsicControlIds: ["envelope-rate", "envelope-shape", "envelope-depth", "level-bits", "dac-curve"],
    intrinsicExplanation: "The pulse generator already has quantized volume shapes: repeating fall/triangle or one-shot fall/rise. Envelope depth blends that mechanism with constant amplitude. A separate host note contour remains applied.",
    historicalContext: "This combines NES-like duty/timer ideas with AY-style envelope ideas. It is not a cycle-accurate emulation of either chip.",
    displayStyle: "stepped-envelope-controls", collapseNoteEnvelope: true, sourceIds: ["psg"],
  },
  dpcm: {
    category: "source-playback", label: "Decoded source / playback mode",
    intrinsicControlIds: ["source-level", "playback-mode"],
    intrinsicExplanation: "The encoded source supplies its amplitude detail, and playback mode controls repetition. The decoder is not a keyboard amplitude-envelope generator; note shaping remains separate.",
    displayStyle: "source-region",
  },
  chebyshev: spectral("Index transient / note amplitude", ["index-attack", "index-decay"],
    "Index attack is the amount of an index boost, while Index decay sets its exponential fall time. They evolve harmonic content, not overall note amplitude."),
};

const HOST_COUPLINGS = {
  subtractive: ["envelope-depth"], physical: ["tension-envelope"],
  waveguide: ["pressure", "breath-noise"],
  "noise-modulation": ["depth-envelope"], "hard-sync": ["sync-envelope"],
};

const FM_HISTORY = "Yamaha's DX7 uses four rates and four levels for each operator, with carrier and modulator envelopes doing different jobs. This engine does not implement those independent operator envelopes; its common ADSR is a host addition, not a DX7 reconstruction.";

/** Frozen UI/research metadata for the implemented generators. It does not own
 * musical state, DSP parameters, audio lifecycle, or hidden envelope overrides.
 * 'collapseNoteEnvelope' hides only its editor until opened, never its effect. */
export const AMPLITUDE_MODELS = freeze(Object.fromEntries(SYNTHESIS_METHODS.map(method => {
  const detail = DETAILS[method.id] || {};
  const category = detail.category || "continuous-generator";
  const sourceIds = [...new Set(["noteShaping", ...(detail.sourceIds || [])])];
  const alsoModulatesControlIds = HOST_COUPLINGS[method.id] || [];
  const nativeDecay = category === "natural-decay" || category === "driven-resonator";
  return [method.id, {
    methodId: method.id,
    category,
    label: detail.label || "Note amplitude",
    intrinsicControlIds: detail.intrinsicControlIds || [],
    intrinsicExplanation: detail.intrinsicExplanation || "This generator builds a continuing signal. Its synthesis method does not supply a complete keyboard-note amplitude contour; Synthesaurus adds one for note-on, held level and release.",
    displayStyle: detail.displayStyle || "note-envelope",
    historicalContext: method.id === "fm" || method.id === "pm" ? FM_HISTORY : detail.historicalContext || "This describes the implemented teaching model, not a universal envelope design for its synthesis family or a replica of a historical instrument.",
    hostEnvelope: {
      label: "Added note envelope",
      alwaysApplied: true,
      collapseByDefault: Boolean(detail.collapseNoteEnvelope),
      alsoModulatesControlIds,
      explanation: nativeDecay
        ? "The model already has internal energy or decay controls. This additional ADSR remains active on output and may shorten the model's ringing; collapsing its editor does not bypass it."
        : "This ADSR is Synthesaurus's added whole-note amplitude control. Grain, pulse, spectral or chip envelopes, when present, remain separate mechanisms.",
    },
    sources: sourceIds.map(id => AMPLITUDE_SOURCES[id]),
  }];
})));

/** Unknown methods and processors have no generator-note envelope metadata. */
export function getAmplitudeModel(methodOrId) {
  const id = typeof methodOrId === "string" ? methodOrId : methodOrId?.id;
  return Object.hasOwn(AMPLITUDE_MODELS, id) ? AMPLITUDE_MODELS[id] : null;
}

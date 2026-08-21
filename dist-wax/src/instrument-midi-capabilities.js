// Browser MIDI and WAX MIDI share this page classification. Keep it independent
// of nav.js and instrument-catalog.js so navigation can install MIDI without an
// import cycle through the catalogue.
const NOTE_MODE_IDS = Object.freeze({
  processor: Object.freeze([
    "lumber",
    "micmic",
    "graph-delay",
    "sandy-syrup-delay",
    "candy-coil-delay",
    "recursion",
  ]),
  drums: Object.freeze([
    "shape-drums",
    "lattice-drums",
    "spiral-drums",
    "solid-drums",
    "rubix",
    "hyper-drums",
    "l-system-drums",
    "linear-drums-machine",
    "drum-roll-please",
    "ouroboros",
    "ouroboros-borealis",
    "fm-drums",
    "linear-drums",
    "sample-drums",
    "gear-ratio-drums",
    "gesturama",
  ]),
  pitched: Object.freeze([
    "shape",
    "playhead-paint",
    "lattice",
    "spiral",
    "solid",
    "hyper",
    "image-to-instrument-3",
    "throatazoid",
    "syrinx",
    "tongued-beasts",
    "hybrinx",
    "jaw-harp",
    "morphynx",
    "hyper-syrinx",
    "alien-larynx",
    "spelling-synthesizer",
    "shepard-risset",
    "l-system",
    "julia",
    "recursive-fm",
    "recursive-pm",
    "chaotic-fm",
    "chaotic-pm",
    "cascading-fm",
    "cascading-pm",
    "weierstrass",
    "plasma-ball",
    "karplus-strong",
    "karplus-carpet",
    "webgpu-303",
    "moire-organ",
    "chladni-plate",
    "spring-choir",
    "lissajous-orbits",
    "atomic-orbitals",
    "fourier-epicycles",
    "gravity-lens",
  ]),
  sequence: Object.freeze([
    "boidzoid",
    "pink-trombonazoid",
    "vocalzoid",
    "hyper-rubix",
    "sorting-algorithms",
    "dijkstra",
    "hanoi",
    "minimax",
    "nqueens",
    "euclid",
    "escher-tessellation",
    "order-tones",
    "morphazoidical",
    "bell-square",
    "entanglement-dance",
    "quantum-square-dance",
    "annealogue",
    "gravity-walk",
    "ricochet",
    "rigidity",
    "rolling-measure",
    "falling-forms",
    "charge-garden",
    "packing-pressure",
    "geodesic-drift",
    "kinetic-hull",
    "cellular-automata",
    "prime-sieve",
    "pendulum-wave",
    "double-pendulum",
    "reaction-diffusion",
    "dna-translator",
    "neural-pulse",
    "cantor-lock",
    "escape-dust",
    "linebreaker",
    "striped-staircase",
    "orbital-ferris",
  ]),
});

export const NATIVE_INSTRUMENT_MIDI_IDS = Object.freeze([
  "shape",
  "recursive-fm",
  "recursive-pm",
  "chaotic-fm",
  "chaotic-pm",
  "fm-drums",
  "sample-drums",
]);

export const PAGE_KEYBOARD_INSTRUMENT_IDS = Object.freeze([
  "image-to-instrument-3",
  "throatazoid",
  "tongued-beasts",
  "jaw-harp",
  "morphynx",
  "hyper-syrinx",
  "alien-larynx",
  "spelling-synthesizer",
  "lumber",
  "micmic",
  "karplus-strong",
  "karplus-carpet",
  "gesturama",
]);

// These pages still expose hardware MIDI for labeled controls, presets, and
// transport, but they have no conservative note action. Do not capture QWERTY
// piano/drum keys until an explicit page mapping exists.
export const NO_GENERIC_NOTE_KEYBOARD_IDS = Object.freeze([
  "boidzoid",
  "pink-trombonazoid",
  "vocalzoid",
  "hyper-rubix",
  "playhead-paint",
  "candy-coil-delay",
  "chladni-plate",
  "spring-choir",
  "gear-ratio-drums",
  "cellular-automata",
  "reaction-diffusion",
  "neural-pulse",
  "cantor-lock",
  "quantum-square-dance",
  "orbital-ferris",
]);

const nativeIds = new Set(NATIVE_INSTRUMENT_MIDI_IDS);
const pageKeyboardIds = new Set(PAGE_KEYBOARD_INSTRUMENT_IDS);
const noGenericNoteKeyboardIds = new Set(NO_GENERIC_NOTE_KEYBOARD_IDS);
const processorAudioIds = new Set(["recursion"]);
const audioInputIds = new Set([
  "lumber",
  "micmic",
  "graph-delay",
  "sandy-syrup-delay",
  "candy-coil-delay",
  "recursion",
  "throatazoid",
  "morphynx",
  "alien-larynx",
]);
const midiOutputExtraIds = new Set([
  "shape",
  "lattice",
  "spiral",
  "solid",
  "hyper",
  "l-system",
  "julia",
]);
const noMidiOutputIds = new Set(["pink-trombonazoid", "vocalzoid"]);

export const INSTRUMENT_MIDI_CAPABILITIES = Object.freeze(
  Object.entries(NOTE_MODE_IDS).flatMap(([noteMode, ids]) => ids.map((id) => Object.freeze({
    id,
    midiInput: true,
    midiInputMode: nativeIds.has(id) ? "native" : "universal-control",
    noteMode,
    audioInput: audioInputIds.has(id),
    midiOutput: !noMidiOutputIds.has(id)
      && (noteMode === "drums" || noteMode === "sequence" || midiOutputExtraIds.has(id)),
    startsAudio: noteMode !== "processor" || processorAudioIds.has(id),
    computerKeyboardMode: pageKeyboardIds.has(id)
      ? "page"
      : noGenericNoteKeyboardIds.has(id) ? "none" : "midi",
  }))),
);

const capabilityById = new Map(
  INSTRUMENT_MIDI_CAPABILITIES.map((capability) => [capability.id, capability]),
);

if (capabilityById.size !== INSTRUMENT_MIDI_CAPABILITIES.length) {
  throw new Error("Duplicate instrument MIDI capability id");
}

export function instrumentMidiCapabilityForId(id) {
  return capabilityById.get(id) ?? null;
}

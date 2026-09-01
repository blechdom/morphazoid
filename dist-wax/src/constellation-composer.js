const EPSILON = 1e-7;
const MAX_SECTIONS = 64;
const MAX_FLOW_NODES = 256;
const MAX_PROJECTED_CLIPS = 2_048;

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum, maximum, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finite(value, fallback)))
);

const freeze = (value) => Object.freeze(value);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export const INSTRUMENT_LIBRARY = freeze([
  freeze({ id: "graph-drums", label: "Graph Drums", type: "drums", color: "#ff8f70", imageHref: "assets/instruments/graph-drums.webp", href: "graph-drums.html", description: "Network percussion with branching attacks and cycle-colored accents." }),
  freeze({ id: "graph-synth", label: "Graph Synth", type: "pitched", color: "#b299ff", imageHref: "assets/instruments/graph-synth.webp", href: "graph-synth.html", description: "Inherited-pitch pulses, glass voices, and graph-shaped melodic motion." }),
  freeze({ id: "lattice", label: "Lattice", type: "pitched", color: "#69d9dc", imageHref: "assets/instruments/lattice.webp", href: "lattice.html", description: "Bright interlocking tones arranged as repeating geometric cells." }),
  freeze({ id: "spiral", label: "Spiral", type: "pitched", color: "#e8c46b", imageHref: "assets/instruments/spiral.webp", href: "spiral.html", description: "Circular rising figures and Shepard-like rotational motion." }),
  freeze({ id: "fm-drums", label: "FM Drums", type: "drums", color: "#ffad69", imageHref: "assets/instruments/fm-drums.webp", href: "fm-drums.html", description: "Sixteen synthetic kicks, snares, hats, metals, and bells." }),
  freeze({ id: "graph-delay", label: "Graph Delay", type: "pitched", color: "#70d8e7", imageHref: "assets/instruments/graph-delay.webp", href: "graph-delay.html", description: "Timed glass replies and darkening network echoes." }),
  freeze({ id: "harmonic-bed", label: "Harmonic Bed", type: "pitched", color: "#8fd59b", imageHref: "assets/instruments/shepard-risset.webp", href: "shepard-risset.html", description: "Slow harmonic fields for holding a section together." }),
  freeze({ id: "sample-voice", label: "Voice Fragment", type: "pitched", color: "#ff82c8", imageHref: "assets/instruments/vocalzoid.webp", href: "vocalzoid.html", description: "Short vocal-like tones and formant-colored punctuation." }),
]);

const INSTRUMENT_BY_ID = new Map(INSTRUMENT_LIBRARY.map((instrument) => [instrument.id, instrument]));

const PATTERNS = deepFreeze({
  fourFloor: { steps: [1, 0, 0, 0, .9, 0, 0, 0, 1, 0, 0, 0, .82, 0, 0, 0], stepBeats: .25, noteOffsets: [0] },
  brokenKick: { steps: [1, 0, 0, .42, 0, 0, .8, 0, 1, 0, .35, 0, 0, .72, 0, 0], stepBeats: .25, noteOffsets: [0, 0, 2, 0] },
  backbeat: { steps: [0, 0, 0, 0, 1, 0, 0, .2, 0, 0, 0, 0, .92, 0, .28, 0], stepBeats: .25, noteOffsets: [0] },
  hats16: { steps: [.56, .22, .42, .2, .62, .22, .46, .24, .58, .22, .44, .18, .72, .22, .5, .3], stepBeats: .25, noteOffsets: [0, 0, 2, 0] },
  claveFive: { steps: [1, 0, 0, .62, 0, 1, 0, 0, .7, 0], stepBeats: .5, noteOffsets: [0, 3, 7, 5, 10] },
  tresillo: { steps: [1, 0, 0, 1, 0, 0, 1, 0], stepBeats: .5, noteOffsets: [0, 0, 7, 0, 0, 5, 0, 0] },
  pulseBass: { steps: [1, 0, .55, 0, .82, 0, .42, 0], stepBeats: .5, noteOffsets: [0, 0, 7, 0, 5, 0, 10, 0] },
  acidSteps: { steps: [1, .15, .65, 0, .82, .2, .55, .15, 1, 0, .48, .2, .72, .12, .6, 0], stepBeats: .25, noteOffsets: [0, 12, 7, 3, 10, 7, 15, 5, 0, 7, 12, 3, 10, 14, 5, 7] },
  glassArp: { steps: [1, 0, .62, 0, .78, 0, .52, .2], stepBeats: .5, noteOffsets: [0, 7, 12, 19, 14, 7, 5, 12] },
  orbitArp: { steps: [1, .35, .7, .28, .8, .32, .62, .2, .92, .3, .74, .26], stepBeats: 1 / 3, noteOffsets: [0, 7, 12, 19, 14, 21, 17, 12, 7, 5, 10, 14] },
  sparseBell: { steps: [1, 0, 0, 0, 0, 0, .52, 0, 0, 0, .76, 0, 0, 0, 0, 0], stepBeats: .5, noteOffsets: [0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 12, 0, 0, 0, 0, 0] },
  choir: { steps: [1, 0, 0, 0], stepBeats: 2, noteOffsets: [0, 7, 12, 5] },
  drone: { steps: [1], stepBeats: 8, noteOffsets: [0] },
  breath: { steps: [.75, 0, 0, .3, 0, 0, .55, 0], stepBeats: 1, noteOffsets: [0, 2, 7, 5, 12, 7, 3, 10] },
  silence: { steps: [0], stepBeats: 1, noteOffsets: [0] },
});

export function quantizeBeat(value, division = .25) {
  const grid = Math.max(1 / 64, finite(division, .25));
  return Math.round(Math.max(0, finite(value, 0)) / grid) * grid;
}

export function formatBeat(value) {
  const beat = Math.max(0, finite(value, 0));
  const whole = Math.floor(beat + EPSILON);
  const fraction = beat - whole;
  const common = [[0, ""], [.125, "⅛"], [.25, "¼"], [.333333, "⅓"], [.5, "½"], [.666667, "⅔"], [.75, "¾"], [.875, "⅞"]];
  const nearest = common.reduce((best, candidate) => (
    Math.abs(candidate[0] - fraction) < Math.abs(best[0] - fraction) ? candidate : best
  ), common[0]);
  if (Math.abs(nearest[0] - fraction) < .015) return `${whole || ""}${nearest[1] || (whole ? "" : "0")}`;
  return beat.toFixed(2).replace(/\.00$/, "").replace(/0$/, "");
}

function pattern(id) {
  return clone(PATTERNS[id] ?? PATTERNS.glassArp);
}

function clipNode(sectionId, layer, index) {
  const instrument = INSTRUMENT_BY_ID.get(layer.instrumentId) ?? INSTRUMENT_LIBRARY[1];
  return {
    id: `${sectionId}-${layer.id ?? `voice-${index + 1}`}`,
    type: "clip",
    label: layer.label ?? instrument.label,
    lane: index,
    role: layer.role ?? (instrument.type === "drums" ? "rhythm" : "voice"),
    instrumentId: instrument.id,
    instrumentType: instrument.type,
    soundId: layer.soundId ?? instrument.id,
    patternId: layer.patternId ?? "glassArp",
    pattern: clone(layer.pattern ?? pattern(layer.patternId)),
    rootNote: clamp(layer.rootNote, 0, 127, instrument.type === "drums" ? 60 : 48),
    durationBeats: Math.max(.25, finite(layer.durationBeats, 16)),
    x: clamp(layer.x, 0, 1, .32 + (index % 3) * .18),
    y: clamp(layer.y, 0, 1, .18 + index * .16),
  };
}

function makeSection(id, label, layers, options = {}) {
  const clips = layers.map((layer, index) => clipNode(id, layer, index));
  const entry = { id: `${id}-entry`, type: "entry", label: "ENTRY", x: .06, y: .5 };
  const fork = { id: `${id}-fork`, type: "fork", label: "FORK", x: .18, y: .5 };
  const join = { id: `${id}-join`, type: "join", label: "JOIN · ALL", joinMode: "all", x: .82, y: .5 };
  const exit = { id: `${id}-exit`, type: "exit", label: "EXIT", x: .94, y: .5 };
  const nodes = [entry, fork, ...clips, join, exit];
  const edges = [
    { id: `${id}-entry-fork`, from: entry.id, to: fork.id, delayBeats: 0, mode: "all" },
    ...clips.flatMap((node, index) => {
      const layer = layers[index];
      const startBeat = quantizeBeat(layer.startBeat ?? 0, 1 / 12);
      return [
        { id: `${id}-launch-${index}`, from: fork.id, to: node.id, delayBeats: startBeat, mode: "all" },
        { id: `${id}-finish-${index}`, from: node.id, to: join.id, delayBeats: node.durationBeats, mode: "all" },
      ];
    }),
    { id: `${id}-join-exit`, from: join.id, to: exit.id, delayBeats: 0, mode: "all" },
  ];
  return {
    id,
    label,
    description: options.description ?? `${layers.length} synchronized musical branches.`,
    color: options.color ?? "#8de7ff",
    x: clamp(options.x, 0, 1, .12),
    y: clamp(options.y, 0, 1, .5),
    flow: { entryNodeId: entry.id, nodes, edges },
  };
}

function layer(instrumentId, patternId, durationBeats, rootNote, overrides = {}) {
  return { instrumentId, patternId, durationBeats, rootNote, ...overrides };
}

function makeComposition({ id, label, description, tempo, meter = [4, 4], sections, transitions }) {
  const normalizedSections = sections.slice(0, MAX_SECTIONS).map((section, index) => ({
    ...section,
    x: section.x ?? (.12 + (index % 4) * .24),
    y: section.y ?? (.25 + Math.floor(index / 4) * .4),
  }));
  const normalizedTransitions = transitions ?? normalizedSections.slice(0, -1).map((section, index) => ({
    id: `${section.id}-to-${normalizedSections[index + 1].id}`,
    from: section.id,
    to: normalizedSections[index + 1].id,
    delayBeats: 0,
    mode: "default",
    label: "NEXT",
  }));
  return deepFreeze({
    id,
    label,
    description,
    tempo: clamp(tempo, 30, 240, 120),
    meter: [Math.max(1, Math.floor(meter[0] || 4)), Math.max(1, Math.floor(meter[1] || 4))],
    selectedSectionId: normalizedSections[0]?.id ?? null,
    sections: normalizedSections,
    transitions: normalizedTransitions,
  });
}

const PRESET_RECIPES = [
  {
    id: "neon-causeway", label: "Neon Causeway", tempo: 124,
    description: "A four-on-the-floor graph opens into glass arpeggios, a dark bridge, and a wide return.",
    sections: [
      makeSection("nc-intro", "01 · Ignition", [
        layer("graph-drums", "fourFloor", 16, 48, { label: "Circuit kick", soundId: "sub kick", role: "rhythm" }),
        layer("fm-drums", "hats16", 16, 72, { label: "Silver hats", soundId: "closed hat", startBeat: 2, role: "percussion" }),
        layer("graph-synth", "glassArp", 12, 57, { label: "Violet graph", soundId: "glass arp", startBeat: 4 }),
      ], { color: "#8de7ff", description: "The rhythm graph gains one branch every four beats." }),
      makeSection("nc-body", "02 · Causeway", [
        layer("graph-drums", "fourFloor", 32, 48, { label: "Main pulse", soundId: "fm kick", role: "rhythm" }),
        layer("fm-drums", "backbeat", 32, 60, { label: "Backbeat", soundId: "snap snare", role: "percussion" }),
        layer("graph-synth", "pulseBass", 32, 38, { label: "Graph bass", soundId: "bass" }),
        layer("lattice", "glassArp", 28, 62, { label: "Lattice lights", soundId: "lattice bell", startBeat: 4 }),
      ], { color: "#b299ff" }),
      makeSection("nc-bridge", "03 · Underpass", [
        layer("harmonic-bed", "drone", 16, 43, { label: "Low harmonic bed", soundId: "dark pad", role: "texture" }),
        layer("graph-delay", "sparseBell", 14, 67, { label: "Delay beacons", soundId: "delay glass", startBeat: 2 }),
        layer("fm-drums", "tresillo", 12, 52, { label: "Metal tresillo", soundId: "metal", startBeat: 4, role: "percussion" }),
      ], { color: "#70d8e7" }),
      makeSection("nc-return", "04 · Wide Return", [
        layer("graph-drums", "brokenKick", 32, 48, { label: "Broken kick", soundId: "sub kick", role: "rhythm" }),
        layer("fm-drums", "backbeat", 32, 60, { label: "Snare branch", soundId: "clap", role: "percussion" }),
        layer("graph-synth", "acidSteps", 32, 45, { label: "Acid graph", soundId: "bass" }),
        layer("spiral", "orbitArp", 24, 64, { label: "Spiral crown", soundId: "shepard", startBeat: 8 }),
      ], { color: "#ff82c8" }),
    ],
  },
  {
    id: "polyrhythm-garden", label: "Polyrhythm Garden", tempo: 105, meter: [5, 4],
    description: "Five-beat percussion roots support three-, four-, and seven-note melodic cycles.",
    sections: [
      makeSection("pg-seed", "Seed Pattern", [
        layer("graph-drums", "claveFive", 20, 50, { label: "Five-root", soundId: "low tom", role: "rhythm" }),
        layer("lattice", "orbitArp", 20, 60, { label: "Twelve-cell lattice", soundId: "lattice bell" }),
        layer("harmonic-bed", "choir", 20, 48, { label: "Garden bed", soundId: "pad", role: "texture" }),
      ], { color: "#8fd59b" }),
      makeSection("pg-bloom", "Cross Bloom", [
        layer("graph-drums", "claveFive", 40, 50, { label: "Five-root", soundId: "tom", role: "rhythm" }),
        layer("fm-drums", "tresillo", 40, 65, { label: "Three-leaf metal", soundId: "metal", role: "percussion" }),
        layer("graph-synth", "glassArp", 35, 57, { label: "Seven-note vine", soundId: "glass", startBeat: 5 }),
        layer("sample-voice", "breath", 30, 69, { label: "Voice pollen", soundId: "voice", startBeat: 10 }),
      ], { color: "#e8c46b" }),
      makeSection("pg-night", "Night Flowers", [
        layer("harmonic-bed", "drone", 30, 41, { label: "Night bed", soundId: "dark pad", role: "texture" }),
        layer("spiral", "orbitArp", 25, 65, { label: "Orbit petals", soundId: "shepard", startBeat: 5 }),
        layer("graph-delay", "sparseBell", 20, 72, { label: "Dew echoes", soundId: "delay bell", startBeat: 10 }),
      ], { color: "#b299ff" }),
    ],
  },
  {
    id: "coral-feedback", label: "Coral Feedback", tempo: 92,
    description: "Dub-weight rhythm, delayed glass, and slow harmonic returns in four connected chambers.",
    sections: [
      makeSection("cf-dry", "Dry Chamber", [layer("graph-drums", "brokenKick", 16, 47, { soundId: "sub kick", role: "rhythm" }), layer("graph-synth", "pulseBass", 16, 35, { soundId: "bass" })], { color: "#ff826f" }),
      makeSection("cf-reef", "Reef", [layer("graph-drums", "brokenKick", 32, 47, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "backbeat", 32, 60, { soundId: "snare", role: "percussion" }), layer("graph-delay", "glassArp", 28, 62, { soundId: "delay glass", startBeat: 4 }), layer("harmonic-bed", "choir", 32, 43, { soundId: "pad", role: "texture" })], { color: "#70d8e7" }),
      makeSection("cf-cave", "Feedback Cave", [layer("graph-delay", "sparseBell", 24, 55, { soundId: "dark delay" }), layer("sample-voice", "breath", 20, 67, { soundId: "voice", startBeat: 4 }), layer("fm-drums", "tresillo", 16, 52, { soundId: "gong", startBeat: 8, role: "percussion" })], { color: "#b299ff" }),
      makeSection("cf-surface", "Surface", [layer("graph-drums", "fourFloor", 16, 48, { soundId: "kick", role: "rhythm" }), layer("lattice", "glassArp", 16, 67, { soundId: "lattice bell" }), layer("harmonic-bed", "choir", 16, 48, { soundId: "bright pad", role: "texture" })], { color: "#8fd59b" }),
    ],
  },
  {
    id: "machine-bloom", label: "Machine Bloom", tempo: 138,
    description: "Tight synthetic percussion unfolds into a bright mechanical garden.",
    sections: [
      makeSection("mb-grid", "Grid", [layer("fm-drums", "fourFloor", 16, 50, { soundId: "fm kick", role: "rhythm" }), layer("fm-drums", "hats16", 16, 76, { soundId: "hat", role: "percussion" }), layer("graph-synth", "pulseBass", 16, 36, { soundId: "bass" })], { color: "#ffad69" }),
      makeSection("mb-branch", "Branching Steel", [layer("graph-drums", "brokenKick", 32, 50, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "backbeat", 32, 62, { soundId: "scrap metal", role: "percussion" }), layer("lattice", "acidSteps", 32, 52, { soundId: "lattice bell" }), layer("graph-delay", "glassArp", 24, 69, { soundId: "delay glass", startBeat: 8 })], { color: "#8de7ff" }),
      makeSection("mb-bloom", "Bloom", [layer("graph-drums", "fourFloor", 32, 48, { soundId: "sub", role: "rhythm" }), layer("spiral", "orbitArp", 32, 60, { soundId: "spiral shepard" }), layer("harmonic-bed", "choir", 32, 48, { soundId: "pad", role: "texture" }), layer("sample-voice", "breath", 24, 72, { soundId: "voice", startBeat: 8 })], { color: "#ff82c8" }),
    ],
  },
  {
    id: "lunar-procession", label: "Lunar Procession", tempo: 72,
    description: "A slow cinematic constellation of bells, breath, low drums, and widening harmonic fields.",
    sections: [
      makeSection("lp-rise", "Moonrise", [layer("harmonic-bed", "drone", 32, 38, { soundId: "dark pad", role: "texture" }), layer("graph-delay", "sparseBell", 28, 62, { soundId: "bell delay", startBeat: 4 }), layer("fm-drums", "tresillo", 24, 48, { soundId: "gong", startBeat: 8, role: "rhythm" })], { color: "#b299ff" }),
      makeSection("lp-walk", "Procession", [layer("graph-drums", "tresillo", 48, 45, { soundId: "low tom", role: "rhythm" }), layer("harmonic-bed", "choir", 48, 43, { soundId: "pad", role: "texture" }), layer("sample-voice", "breath", 40, 67, { soundId: "voice", startBeat: 8 }), layer("spiral", "orbitArp", 32, 58, { soundId: "shepard", startBeat: 16 })], { color: "#e8c46b" }),
      makeSection("lp-eclipse", "Eclipse", [layer("harmonic-bed", "drone", 24, 36, { soundId: "dark pad", role: "texture" }), layer("graph-synth", "sparseBell", 20, 72, { soundId: "glass", startBeat: 4 }), layer("graph-delay", "breath", 16, 55, { soundId: "delay", startBeat: 8 })], { color: "#ff826f" }),
      makeSection("lp-set", "Moonset", [layer("harmonic-bed", "choir", 24, 43, { soundId: "pad", role: "texture" }), layer("lattice", "sparseBell", 16, 67, { soundId: "lattice bell", startBeat: 8 })], { color: "#70d8e7" }),
    ],
  },
  {
    id: "fractured-club", label: "Fractured Club", tempo: 148,
    description: "Fast broken rhythms, acid branches, abrupt joins, and a half-time rupture.",
    sections: [
      makeSection("fc-lock", "Lock", [layer("graph-drums", "fourFloor", 16, 50, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "hats16", 16, 75, { soundId: "hat", role: "percussion" })], { color: "#ff826f" }),
      makeSection("fc-fracture", "Fracture", [layer("graph-drums", "brokenKick", 32, 50, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "backbeat", 32, 62, { soundId: "snare", role: "percussion" }), layer("graph-synth", "acidSteps", 32, 39, { soundId: "bass" }), layer("lattice", "orbitArp", 24, 64, { soundId: "metal bell", startBeat: 8 })], { color: "#8de7ff" }),
      makeSection("fc-rupture", "Half-time Rupture", [layer("graph-drums", "tresillo", 16, 45, { soundId: "sub kick", role: "rhythm" }), layer("graph-delay", "sparseBell", 16, 58, { soundId: "delay glass" }), layer("sample-voice", "breath", 12, 70, { soundId: "voice", startBeat: 4 })], { color: "#b299ff" }),
      makeSection("fc-release", "Release", [layer("graph-drums", "fourFloor", 32, 50, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "hats16", 32, 77, { soundId: "open hat", role: "percussion" }), layer("graph-synth", "acidSteps", 32, 43, { soundId: "bass" }), layer("spiral", "orbitArp", 24, 67, { soundId: "shepard", startBeat: 8 })], { color: "#ff82c8" }),
    ],
  },
  {
    id: "constellation-choir", label: "Constellation Choir", tempo: 64,
    description: "Long vocal-like calls connect slow harmonic nodes across a spacious form.",
    sections: [
      makeSection("cc-call", "Call", [layer("sample-voice", "breath", 24, 60, { soundId: "voice" }), layer("harmonic-bed", "drone", 24, 36, { soundId: "pad", role: "texture" })], { color: "#ff82c8" }),
      makeSection("cc-answer", "Answer Field", [layer("sample-voice", "choir", 32, 67, { soundId: "voice" }), layer("harmonic-bed", "choir", 32, 43, { soundId: "pad", role: "texture" }), layer("graph-delay", "sparseBell", 24, 74, { soundId: "delay", startBeat: 8 })], { color: "#70d8e7" }),
      makeSection("cc-cluster", "Cluster", [layer("sample-voice", "breath", 40, 62, { soundId: "voice" }), layer("graph-synth", "glassArp", 32, 55, { soundId: "glass", startBeat: 8 }), layer("spiral", "orbitArp", 24, 67, { soundId: "shepard", startBeat: 16 }), layer("harmonic-bed", "drone", 40, 38, { soundId: "dark bed", role: "texture" })], { color: "#b299ff" }),
      makeSection("cc-fade", "Distant Fade", [layer("harmonic-bed", "choir", 32, 41, { soundId: "pad", role: "texture" }), layer("sample-voice", "sparseBell", 20, 69, { soundId: "voice", startBeat: 12 })], { color: "#8fd59b" }),
    ],
  },
  {
    id: "small-world-suite", label: "Small World Suite", tempo: 116,
    description: "A compact suite whose alternate section route rejoins the same final cadence.",
    sections: [
      makeSection("sw-a", "A · Clear Steps", [layer("graph-drums", "fourFloor", 16, 48, { soundId: "kick", role: "rhythm" }), layer("graph-synth", "glassArp", 16, 60, { soundId: "glass" })], { color: "#8de7ff", x: .1, y: .5 }),
      makeSection("sw-b1", "B1 · Bright Shortcut", [layer("fm-drums", "hats16", 24, 76, { soundId: "hat", role: "rhythm" }), layer("lattice", "acidSteps", 24, 55, { soundId: "lattice bell" }), layer("graph-synth", "pulseBass", 24, 38, { soundId: "bass" })], { color: "#e8c46b", x: .38, y: .28 }),
      makeSection("sw-b2", "B2 · Dark Shortcut", [layer("graph-drums", "brokenKick", 24, 45, { soundId: "sub", role: "rhythm" }), layer("graph-delay", "sparseBell", 20, 58, { soundId: "delay" }), layer("harmonic-bed", "drone", 24, 41, { soundId: "dark pad", role: "texture" })], { color: "#b299ff", x: .38, y: .72 }),
      makeSection("sw-c", "C · Rejoin", [layer("graph-drums", "tresillo", 32, 48, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "backbeat", 32, 60, { soundId: "snare", role: "percussion" }), layer("spiral", "orbitArp", 24, 67, { soundId: "shepard", startBeat: 8 }), layer("sample-voice", "breath", 16, 72, { soundId: "voice", startBeat: 16 })], { color: "#ff82c8", x: .72, y: .5 }),
    ],
    transitions: [
      { id: "sw-a-b1", from: "sw-a", to: "sw-b1", delayBeats: 0, mode: "default", label: "BRIGHT" },
      { id: "sw-a-b2", from: "sw-a", to: "sw-b2", delayBeats: 0, mode: "choice", label: "DARK" },
      { id: "sw-b1-c", from: "sw-b1", to: "sw-c", delayBeats: 0, mode: "all", label: "REJOIN" },
      { id: "sw-b2-c", from: "sw-b2", to: "sw-c", delayBeats: 0, mode: "all", label: "REJOIN" },
    ],
  },
  {
    id: "perimeter-funk", label: "Perimeter Funk", tempo: 110,
    description: "Syncopated drums orbit a warm bass while bells and voice fragments enter at the corners.",
    sections: [
      makeSection("pf-pocket", "Pocket", [layer("graph-drums", "brokenKick", 24, 48, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "backbeat", 24, 60, { soundId: "snare", role: "percussion" }), layer("graph-synth", "pulseBass", 24, 36, { soundId: "bass" })], { color: "#ffad69" }),
      makeSection("pf-corners", "Four Corners", [layer("graph-drums", "brokenKick", 32, 48, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "hats16", 32, 72, { soundId: "hat", role: "percussion" }), layer("graph-synth", "pulseBass", 32, 36, { soundId: "bass" }), layer("lattice", "sparseBell", 24, 65, { soundId: "bell", startBeat: 8 })], { color: "#8fd59b" }),
      makeSection("pf-break", "Open Perimeter", [layer("fm-drums", "tresillo", 16, 54, { soundId: "metal", role: "rhythm" }), layer("sample-voice", "breath", 16, 69, { soundId: "voice" }), layer("graph-delay", "glassArp", 12, 60, { soundId: "delay", startBeat: 4 })], { color: "#70d8e7" }),
      makeSection("pf-home", "Pocket Return", [layer("graph-drums", "fourFloor", 24, 48, { soundId: "kick", role: "rhythm" }), layer("fm-drums", "backbeat", 24, 60, { soundId: "clap", role: "percussion" }), layer("graph-synth", "acidSteps", 24, 38, { soundId: "bass" }), layer("sample-voice", "sparseBell", 16, 72, { soundId: "voice", startBeat: 8 })], { color: "#ff82c8" }),
    ],
  },
  {
    id: "slow-orbit", label: "Slow Orbit", tempo: 80,
    description: "A minimal ring of low pulses and descending luminous echoes.",
    sections: [
      makeSection("so-launch", "Launch", [layer("graph-drums", "tresillo", 16, 45, { soundId: "low tom", role: "rhythm" }), layer("harmonic-bed", "drone", 16, 36, { soundId: "pad", role: "texture" })], { color: "#70d8e7" }),
      makeSection("so-orbit", "Orbit", [layer("graph-drums", "tresillo", 32, 45, { soundId: "tom", role: "rhythm" }), layer("spiral", "orbitArp", 32, 57, { soundId: "shepard" }), layer("graph-delay", "sparseBell", 28, 69, { soundId: "delay", startBeat: 4 }), layer("harmonic-bed", "choir", 32, 40, { soundId: "pad", role: "texture" })], { color: "#b299ff" }),
      makeSection("so-return", "Atmospheric Return", [layer("harmonic-bed", "drone", 24, 35, { soundId: "dark bed", role: "texture" }), layer("graph-delay", "breath", 20, 62, { soundId: "delay" }), layer("sample-voice", "sparseBell", 16, 74, { soundId: "voice", startBeat: 8 })], { color: "#ff82c8" }),
    ],
  },
];

export const COMPOSITION_PRESETS = freeze(PRESET_RECIPES.map((recipe) => makeComposition(recipe)));

export function cloneCompositionPreset(id = COMPOSITION_PRESETS[0]?.id) {
  const preset = COMPOSITION_PRESETS.find((candidate) => candidate.id === id) ?? COMPOSITION_PRESETS[0];
  return clone(preset);
}

export function createComposition(options = {}) {
  if (typeof options === "string") return cloneCompositionPreset(options);
  return cloneCompositionPreset(options.presetId ?? options.id);
}

export function currentSection(composition) {
  if (!composition?.sections?.length) return null;
  return composition.sections.find(({ id }) => id === composition.selectedSectionId)
    ?? composition.sections[0];
}

function arrivalTimes(section) {
  const nodes = section?.flow?.nodes?.slice(0, MAX_FLOW_NODES) ?? [];
  const edges = section?.flow?.edges ?? [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    incoming.get(edge.to).push(edge);
    outgoing.get(edge.from).push(edge);
  }
  const indegree = new Map(nodes.map((node) => [node.id, incoming.get(node.id).length]));
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const times = new Map(queue.map((id) => [id, 0]));
  const order = [];
  while (queue.length && order.length < MAX_FLOW_NODES) {
    const id = queue.shift();
    order.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const candidate = (times.get(id) ?? 0) + Math.max(0, finite(edge.delayBeats, 0));
      times.set(edge.to, Math.max(times.get(edge.to) ?? 0, candidate));
      indegree.set(edge.to, indegree.get(edge.to) - 1);
      if (indegree.get(edge.to) === 0) queue.push(edge.to);
    }
  }
  // Invalid/raw cycles stay inspectable without producing an infinite score.
  for (const node of nodes) if (!times.has(node.id)) times.set(node.id, 0);
  return { times, order, cyclic: order.length !== nodes.length };
}

export function projectTimeline(composition, sectionId = composition?.selectedSectionId) {
  const section = composition?.sections?.find(({ id }) => id === sectionId) ?? currentSection(composition);
  if (!section) return freeze({ section: null, clips: freeze([]), lanes: freeze([]), durationBeats: 0, cyclic: false });
  const { times, cyclic } = arrivalTimes(section);
  const clips = [];
  for (const node of section.flow.nodes) {
    if (node.type !== "clip") continue;
    const instrument = INSTRUMENT_BY_ID.get(node.instrumentId) ?? INSTRUMENT_LIBRARY[1];
    const startBeat = Math.max(0, times.get(node.id) ?? 0);
    const durationBeats = Math.max(.25, finite(node.durationBeats, 4));
    clips.push({
      id: node.id,
      nodeId: node.id,
      sectionId: section.id,
      label: node.label,
      lane: Math.max(0, Math.floor(finite(node.lane, clips.length))),
      role: node.role,
      instrumentId: instrument.id,
      instrumentType: instrument.type,
      instrumentLabel: instrument.label,
      instrumentColor: instrument.color,
      soundId: node.soundId,
      patternId: node.patternId,
      pattern: clone(node.pattern),
      rootNote: node.rootNote,
      startBeat,
      endBeat: startBeat + durationBeats,
      durationBeats,
      iteration: 0,
      graphProvenance: { sectionId: section.id, nodeId: node.id },
    });
    if (clips.length >= MAX_PROJECTED_CLIPS) break;
  }
  clips.sort((first, second) => first.lane - second.lane || first.startBeat - second.startBeat);
  const durationBeats = Math.max(1, ...clips.map(({ endBeat }) => endBeat));
  const lanes = clips.map((clip) => ({ id: `${section.id}-lane-${clip.lane}`, lane: clip.lane, label: clip.label, instrumentId: clip.instrumentId, color: clip.instrumentColor }));
  return { section, clips, lanes, durationBeats, cyclic };
}

export function sectionDurationBeats(composition, sectionId) {
  return projectTimeline(composition, sectionId).durationBeats;
}

export function compositionDurationBeats(composition) {
  return (composition?.sections ?? []).reduce((sum, section) => (
    sum + sectionDurationBeats(composition, section.id)
  ), 0);
}

export function selectSection(composition, sectionId) {
  const next = clone(composition);
  if (next.sections.some(({ id }) => id === sectionId)) next.selectedSectionId = sectionId;
  return next;
}

export function updateFlowEdgeDelay(composition, sectionId, edgeId, delayBeats) {
  const next = clone(composition);
  const edge = next.sections.find(({ id }) => id === sectionId)?.flow?.edges?.find(({ id }) => id === edgeId);
  if (edge) edge.delayBeats = quantizeBeat(delayBeats, .25);
  return next;
}

export function moveTimelineClip(composition, sectionId, nodeId, startBeat) {
  const next = clone(composition);
  const section = next.sections.find(({ id }) => id === sectionId);
  const node = section?.flow?.nodes?.find(({ id }) => id === nodeId);
  if (!node) return next;
  const incoming = section.flow.edges.find((edge) => edge.to === nodeId);
  if (incoming) incoming.delayBeats = quantizeBeat(startBeat, .25);
  return next;
}

export function resizeTimelineClip(composition, sectionId, nodeId, durationBeats) {
  const next = clone(composition);
  const section = next.sections.find(({ id }) => id === sectionId);
  const node = section?.flow?.nodes?.find(({ id }) => id === nodeId);
  if (!node) return next;
  node.durationBeats = Math.max(.25, quantizeBeat(durationBeats, .25));
  const finish = section.flow.edges.find((edge) => edge.from === nodeId && section.flow.nodes.find(({ id }) => id === edge.to)?.type === "join");
  if (finish) finish.delayBeats = node.durationBeats;
  return next;
}

export function moveFlowNode(composition, sectionId, nodeId, x, y) {
  const next = clone(composition);
  const node = next.sections.find(({ id }) => id === sectionId)?.flow?.nodes?.find(({ id }) => id === nodeId);
  if (node) {
    node.x = clamp(x, 0, 1, node.x);
    node.y = clamp(y, 0, 1, node.y);
  }
  return next;
}

export function moveSectionNode(composition, sectionId, x, y) {
  const next = clone(composition);
  const section = next.sections.find(({ id }) => id === sectionId);
  if (section) {
    section.x = clamp(x, 0, 1, section.x);
    section.y = clamp(y, 0, 1, section.y);
  }
  return next;
}

export function addInstrumentClip(composition, sectionId, instrumentId, options = {}) {
  const next = clone(composition);
  const section = next.sections.find(({ id }) => id === sectionId);
  const instrument = INSTRUMENT_BY_ID.get(instrumentId);
  if (!section || !instrument || section.flow.nodes.length >= MAX_FLOW_NODES) return next;
  const existingClips = section.flow.nodes.filter(({ type }) => type === "clip");
  const suffix = `${instrument.id}-${existingClips.length + 1}`;
  const id = `${section.id}-${suffix}`;
  const node = clipNode(section.id, {
    id: suffix,
    instrumentId: instrument.id,
    label: options.label ?? instrument.label,
    patternId: options.patternId ?? (instrument.type === "drums" ? "brokenKick" : "glassArp"),
    soundId: options.soundId ?? instrument.id,
    rootNote: options.rootNote ?? (instrument.type === "drums" ? 60 : 55),
    durationBeats: options.durationBeats ?? 16,
  }, existingClips.length);
  node.id = id;
  const fork = section.flow.nodes.find(({ type }) => type === "fork") ?? section.flow.nodes[0];
  const join = section.flow.nodes.find(({ type }) => type === "join") ?? section.flow.nodes.at(-1);
  section.flow.nodes.splice(Math.max(0, section.flow.nodes.indexOf(join)), 0, node);
  section.flow.edges.push(
    { id: `${id}-launch`, from: fork.id, to: id, delayBeats: quantizeBeat(options.startBeat ?? 0, .25), mode: "all" },
    { id: `${id}-finish`, from: id, to: join.id, delayBeats: node.durationBeats, mode: "all" },
  );
  return next;
}

export function validateComposition(composition) {
  const errors = [];
  if (!composition || typeof composition !== "object") return { valid: false, errors: ["Composition must be an object."] };
  if (!Array.isArray(composition.sections) || !composition.sections.length) errors.push("Composition needs at least one section.");
  if ((composition.sections?.length ?? 0) > MAX_SECTIONS) errors.push(`Composition exceeds ${MAX_SECTIONS} sections.`);
  const sectionIds = new Set();
  for (const section of composition.sections ?? []) {
    if (!section.id || sectionIds.has(section.id)) errors.push(`Duplicate or missing section id: ${section.id ?? "(missing)"}.`);
    sectionIds.add(section.id);
    const nodeIds = new Set();
    for (const node of section.flow?.nodes ?? []) {
      if (!node.id || nodeIds.has(node.id)) errors.push(`Duplicate or missing node id in ${section.id}.`);
      nodeIds.add(node.id);
    }
    for (const edge of section.flow?.edges ?? []) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) errors.push(`Dangling edge ${edge.id} in ${section.id}.`);
      if (finite(edge.delayBeats, -1) < 0) errors.push(`Negative edge duration ${edge.id}.`);
    }
  }
  for (const transition of composition.transitions ?? []) {
    if (!sectionIds.has(transition.from) || !sectionIds.has(transition.to)) errors.push(`Dangling section transition ${transition.id}.`);
  }
  return { valid: errors.length === 0, errors };
}

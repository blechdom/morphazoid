import { INSTRUMENTS } from "./src/instrument-catalog.js?v=catalog-20260913-1";

const ALL_TAG_ID = "all";

// A repository-history snapshot balances log-scaled commit count (58%) with
// latest direct work (42%). Everything not yet ranked retains registry order.
// Refresh this list when a catalogue addition or sustained instrument rewrite
// materially changes the active end of the collection.
export const HOMEPAGE_ACTIVITY_IDS = Object.freeze([
  "shader-synth-playground",
  "jaw-harp",
  "webgpu-synths",
  "webgpu-303",
  "roach-synth",
  "puggler",
  "graph-synth",
  "linear-drums",
  "hiccup-head",
  "hyper-rubix",
  "rubix",
  "quadruped",
  "harmonica",
  "syrinx",
  "webgpu-chiptune",
  "lattice",
  "spider-synth",
  "breath-atlas",
  "hyper",
  "micmic",
  "fm-drums",
  "julie-saw",
  "solid",
  "cellular-automata",
  "graph-delay",
  "spiral",
  "linear-drums-machine",
  "graph-drums",
  "creaturazoid",
  "l-system-drums",
  "surround-field",
  "hybrinx",
  "hyper-syrinx",
  "moire-drone",
  "object-forge",
  "colony-syrinx",
  "boidzoid",
  "hocket-loom",
  "ffmpeg-wasm",
  "lumber",
  "enveloper",
  "simd-resonator",
  "simd-303",
  "sliding-puzzle",
  "recursive-fm",
  "plugazoid",
  "yoyodyne",
  "srtuss",
  "l-system",
  "constellation",
  "shape",
  "throatazoid",
  "julia",
  "tiles-app",
  "recursive-pm",
  "gesturama",
  "simd-synth",
  "ourorourobouroboros",
  "chaotic-fm",
  "moebius",
  "micromorph",
  "shape-drums",
  "combo",
  "weierstrass",
  "blowhole",
  "shepard-risset",
  "hyper-drums",
  "solid-drums",
  "algorithmic-mazes",
  "recursion",
  "karplus-carpet",
  "chaotic-pm",
  "tongued-beasts",
  "ouroboros",
  "ouroborousel",
  "jaw-jam",
  "candy-coil-delay",
  "spelling-synthesizer",
  "throat-singing",
  "sandy-syrup-delay",
  "drum-roll-please",
  "klein-bottle",
  "pink-trombonazoid",
  "lattice-drums",
  "paths",
  "penrose-tilings",
  "l-systems",
  "annealogue",
  "order-tones",
  "vector-flight",
  "spiral-drums",
  "digestazoid",
  "sorting-algorithms",
  "bell-square",
  "cascading-fm",
  "charge-garden",
  "falling-forms",
  "geodesic-drift",
  "gravity-walk",
  "kinetic-hull",
  "packing-pressure",
  "ricochet",
  "rigidity",
  "rolling-measure",
  "karplus-strong",
  "morphynx",
  "sample-drums",
  "cascading-pm",
  "moire-organ",
  "wave-pool",
  "linebreaker",
  "ouroboros-borealis",
  "slippery-resynthesis",
  "chladni-plate",
  "gear-ratio-drums",
  "spring-choir",
  "striped-staircase",
  "image-to-instrument-3",
  "entanglement-dance",
  "cantor-lock",
  "escape-dust",
  "atomic-orbitals",
  "dna-translator",
  "double-pendulum",
  "escher-tessellation",
  "fourier-epicycles",
  "gravity-lens",
  "lissajous-orbits",
  "neural-pulse",
  "nqueens",
  "pendulum-wave",
  "prime-sieve",
  "reaction-diffusion",
  "vocalzoid",
  "orbital-ferris",
  "dijkstra",
  "euclid",
  "hanoi",
  "minimax",
  "morphazoidical",
  "plasma-ball",
  "playhead-paint",
  "quantum-square-dance",
  "alien-larynx",
]);

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createCard(doc, instrument, index) {
  const card = element(doc, "article", "instrument-card");
  card.dataset.instrumentId = instrument.id;

  const cardLink = element(doc, "a", "instrument-card-link");
  cardLink.href = instrument.href;
  cardLink.setAttribute("aria-label", instrument.label);

  const visual = element(doc, "span", "instrument-card-visual");
  const image = element(doc, "img", "instrument-card-image");
  image.alt = "";
  image.width = 512;
  image.height = 512;
  image.loading = index < 12 ? "eager" : "lazy";
  if (index < 6) image.fetchPriority = "high";
  image.decoding = index < 12 ? "sync" : "async";
  image.src = instrument.imageHref;
  visual.append(image);

  const title = element(doc, "h3", "instrument-card-title", instrument.label);
  cardLink.append(visual, title);
  card.append(cardLink);
  return card;
}

export function instrumentMatchesTag(instrument, tagId) {
  return tagId === ALL_TAG_ID || instrument.tags.some(({ id }) => id === tagId);
}

export function orderHomepageInstruments(instruments) {
  const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  const rankedIds = new Set(HOMEPAGE_ACTIVITY_IDS);
  return [
    ...HOMEPAGE_ACTIVITY_IDS.map((id) => instrumentById.get(id)).filter(Boolean),
    ...instruments.filter(({ id }) => !rankedIds.has(id)),
  ];
}

export function renderInstrumentCatalog(root) {
  if (!root?.ownerDocument) return null;
  const doc = root.ownerDocument;
  const grid = element(doc, "div", "instrument-catalog-grid");
  const instruments = orderHomepageInstruments(INSTRUMENTS);
  const cards = instruments.map((instrument, index) => createCard(doc, instrument, index));
  grid.append(...cards);
  root.replaceChildren(grid);
  return Object.freeze({
    root,
    grid,
    cards: Object.freeze(cards),
  });
}

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll("[data-instrument-catalog]")) {
    renderInstrumentCatalog(root);
  }
}

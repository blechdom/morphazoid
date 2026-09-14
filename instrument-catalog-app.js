import {
  INSTRUMENT_GROUPS,
  INSTRUMENTS,
} from "./src/instrument-catalog.js?v=catalog-20260913-2";

const ALL_TAG_ID = "all";
export const FIRST_CATEGORY_ID = "faves";

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

function previewDescription(description) {
  const firstSentence = description.match(/^[^.!?]+[.!?]/)?.[0] ?? description;
  const maximumLength = 88;
  if (firstSentence.length <= maximumLength) return firstSentence;
  const excerpt = firstSentence.slice(0, maximumLength - 1).trimEnd();
  const finalWordBreak = excerpt.lastIndexOf(" ");
  return `${excerpt.slice(0, finalWordBreak > 0 ? finalWordBreak : excerpt.length).trimEnd()}…`;
}

function createPreview(doc) {
  const node = element(doc, "aside", "instrument-card-preview");
  node.hidden = true;
  node.setAttribute("aria-hidden", "true");

  const visual = element(doc, "span", "instrument-card-preview-visual");
  const image = element(doc, "img", "instrument-card-preview-image");
  image.alt = "";
  image.width = 512;
  image.height = 512;
  image.decoding = "async";
  visual.append(image);

  const copy = element(doc, "span", "instrument-card-preview-copy");
  const title = element(doc, "h3", "instrument-card-preview-title");
  const description = element(doc, "p", "instrument-card-preview-description");
  copy.append(title, description);
  node.append(visual, copy);
  return Object.freeze({ node, image, title, description });
}

function showPreview(preview, cardLink, instrument) {
  const { node } = preview;
  const anchorRect = cardLink.getBoundingClientRect();
  const viewportWidth = Math.max(0, globalThis.innerWidth ?? 1024);
  const horizontalMargin = 8;
  const previewWidth = Math.min(212, Math.max(0, viewportWidth - (horizontalMargin * 2)));
  const centeredLeft = anchorRect.left + (anchorRect.width / 2) - (previewWidth / 2);
  const left = Math.max(horizontalMargin, Math.min(
    centeredLeft,
    viewportWidth - previewWidth - horizontalMargin,
  ));
  const showBelow = anchorRect.top < 176;

  preview.image.src = instrument.imageHref;
  preview.title.textContent = instrument.label;
  preview.description.textContent = previewDescription(instrument.description);
  node.className = `instrument-card-preview${showBelow ? " is-below" : ""}`;
  node.style.left = `${left}px`;
  node.style.top = `${showBelow ? anchorRect.bottom + horizontalMargin : anchorRect.top - horizontalMargin}px`;
  node.hidden = false;
}

function createCard(doc, instrument, index, preview) {
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

  cardLink.addEventListener("pointerenter", () => showPreview(preview, cardLink, instrument));
  cardLink.addEventListener("pointerleave", () => {
    preview.node.hidden = true;
  });
  cardLink.addEventListener("focus", () => showPreview(preview, cardLink, instrument));
  cardLink.addEventListener("blur", () => {
    preview.node.hidden = true;
  });

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

function homepageCategories() {
  return [
    Object.freeze({ id: FIRST_CATEGORY_ID, label: "Faves" }),
    ...INSTRUMENT_GROUPS.filter(({ id, tools }) => id !== FIRST_CATEGORY_ID && tools.length > 0),
  ];
}

export function renderInstrumentCatalog(root) {
  if (!root?.ownerDocument) return null;
  const doc = root.ownerDocument;
  const instruments = orderHomepageInstruments(INSTRUMENTS);
  const preview = createPreview(doc);
  const cards = [];
  let renderIndex = 0;
  const groupViews = homepageCategories().map((category) => {
    const categoryInstruments = instruments.filter((instrument) => (
      instrumentMatchesTag(instrument, category.id)
    ));
    const section = element(doc, "section", "catalogue-group");
    const heading = element(doc, "h3", "catalogue-group-title", category.label);
    const grid = element(doc, "div", "instrument-catalog-grid");
    const headingId = `catalogue-${category.id}-title`;
    heading.id = headingId;
    section.dataset.categoryId = category.id;
    section.setAttribute("aria-labelledby", headingId);
    grid.dataset.categoryId = category.id;

    const groupCards = categoryInstruments.map((instrument) => {
      const card = createCard(doc, instrument, renderIndex, preview);
      renderIndex += 1;
      card.dataset.categoryId = category.id;
      cards.push(card);
      return card;
    });
    grid.append(...groupCards);
    section.append(heading, grid);
    return Object.freeze({
      id: category.id,
      section,
      heading,
      grid,
      cards: Object.freeze(groupCards),
    });
  });

  root.replaceChildren(...groupViews.map(({ section }) => section), preview.node);
  return Object.freeze({
    root,
    groups: Object.freeze(groupViews),
    cards: Object.freeze(cards),
    preview,
  });
}

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll("[data-instrument-catalog]")) {
    renderInstrumentCatalog(root);
  }
}

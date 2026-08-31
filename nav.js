import {
  MIDI_PROFILES,
  getSharedMidiManager,
} from "./src/midi-manager.js";
import { getSharedAudioOutputManager } from "./src/audio-output-manager.js";
import { installBrowserMidiAdapter } from "./src/browser-midi-adapter.js";
import { instrumentMidiCapabilityForId } from "./src/instrument-midi-capabilities.js";
import { initializeMidiOutputMonitor } from "./src/midi-output-preview.js";
import { initializeChaoticViewportControls } from "./src/chaotic-viewport-controls.js";
import { createMidiStatus, createStereoMeter } from "./src/ui/index.js";

const LEGACY_SETTINGS_KEYS = [
  "morphazoid:shape:audio:v1",
  "morphazoid:lattice:audio:v2",
  "morphazoid:lumber:audio:v2",
];
const RESET_SHAPE_SIDES_KEY = "morphazoid:shape:reset:sides";
const AUDIO_TRANSPORT_CONTRACTS = new WeakMap();
const AUDIO_OFF_TRANSPORT_MESSAGE = "Audio is off — turn it on to hear playback";
const OUTPUT_METER_SILENCE_FLOOR = 0.001;
const ARIA_WIDGET_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "grid",
  "gridcell",
  "link",
  "listbox",
  "menu",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "tree",
  "treeitem",
]);

const freezeGroup = (id, label, tools, metadata = {}) => Object.freeze({
  id,
  label,
  ...metadata,
  tools: Object.freeze(tools.map((tool) => Object.freeze(tool))),
});

export const FAVE_TOOL_IDS = Object.freeze([
  "shape",
  "solid",
  "hyper",
  "rubix",
  "hyper-rubix",
  "pink-trombonazoid",
  "hybrinx",
  "ouroborousel",
  "lattice-drums",
  "micmic",
  "webgpu-synths",
  "shader-synth-playground",
  "sandy-syrup-delay",
  "slippery-resynthesis",
  "moire-drone",
]);

/**
 * Shared navigation contract.
 *
 * `href` values are relative to nav.js, which lives at the published site
 * root. Directory tools use prefix matching so their secondary pages remain
 * associated with the same top-level tool.
 */
export const TOOL_GROUPS = Object.freeze([
  freezeGroup("apps", "Apps", [
    { id: "combo", label: "Shapes", href: "shapes.html" },
  ]),
  freezeGroup("geometry", "Geometry Synths", [
    { id: "shape", label: "Shape", href: "shape.html" },
    { id: "lattice", label: "Lattice", href: "lattice.html" },
    { id: "spiral", label: "Spiral", href: "spiral.html" },
    { id: "solid", label: "Solid", href: "solid.html" },
    { id: "hyper", label: "Hyper", href: "hyper.html" },
    {
      id: "graph-synth",
      label: "Graph Synth",
      href: "graph-synth.html",
    },
  ]),
  freezeGroup("geometry-drums", "Drum Machines", [
    {
      id: "shape-drums",
      label: "Shape Drum Machine",
      href: "shape-drums.html",
    },
    {
      id: "lattice-drums",
      label: "Lattice Drum Machine",
      href: "lattice-drums.html",
    },
    {
      id: "spiral-drums",
      label: "Spiral Drum Machine",
      href: "spiral-drums.html",
    },
    {
      id: "solid-drums",
      label: "Solid Drum Machine",
      href: "solid-drums.html",
    },
    {
      id: "hyper-drums",
      label: "Hyper Drum Machine",
      href: "hyper-drums.html",
    },
    {
      id: "l-system-drums",
      label: "L-System Drum Machine",
      href: "l-system-drums.html",
    },
    {
      id: "graph-drums",
      label: "Graph Drum Machine",
      href: "graph-drums.html",
    },
    {
      id: "linear-drums-machine",
      label: "Rattle Snake Skin",
      href: "linear-drums-machine.html",
    },
  ]),
  freezeGroup("sequencers", "Sequencers", [
    {
      id: "rubix",
      label: "Rubix Cube Sequencer",
      href: "rubix.html",
    },
    {
      id: "sliding-puzzle",
      label: "Sliding Puzzle Sequencer",
      href: "sliding-puzzle.html",
    },
    {
      id: "wave-pool",
      label: "Wave Pool",
      href: "wave-pool.html",
    },
    { id: "hyper-rubix", label: "Hyper Rubix", href: "hyper-rubix.html" },
    { id: "webgpu-303", label: "WebGPU 303", href: "webgpu-303.html" },
    { id: "webgpu-synths", label: "GPU Shader Synths", href: "webgpu-synths.html" },
    {
      id: "shader-synth-playground",
      label: "Modular Shader Synth",
      href: "shader-synth-playground.html",
      imageHref: "assets/instruments/webgpu-synths.webp",
    },
  ]),
  freezeGroup("voice-synths", "Voice Synths", [
    { id: "throatazoid", label: "Throatazoid", href: "throatazoid.html" },
    {
      id: "pink-trombonazoid",
      label: "Pink Trombonazoid",
      href: "pink-trombonazoid.html",
    },
    { id: "syrinx", label: "Syrinx", href: "syrinx.html" },
    {
      id: "tongued-beasts",
      label: "Tongued Beasts",
      href: "tongued-beasts.html",
    },
    { id: "hybrinx", label: "Hybrinx", href: "hybrinx.html" },
    {
      id: "colony-syrinx",
      label: "Colony Syrinx",
      href: "colony-syrinx.html",
    },
    { id: "blowhole", label: "Blowhole", href: "blowhole.html" },
    { id: "jaw-harp", label: "Jaw Harp", href: "jaw-harp.html" },
    { id: "harmonica", label: "Harmonica", href: "harmonica.html" },
    { id: "hiccup-head", label: "Hiccup Head", href: "hiccup-head.html" },
    {
      id: "breath-atlas",
      label: "Breath Atlas",
      href: "breath-atlas.html",
    },
    {
      id: "spelling-synthesizer",
      label: "Spelling Synthesizer",
      href: "spelling-synthesizer.html",
    },
    {
      id: "vocalzoid",
      label: "Vocalzoid",
      href: "vocalzoid.html",
    },
  ]),
  freezeGroup("mic-fx", "Mic FX", [
    { id: "lumber", label: "Lumber Loops", href: "lumber.html" },
    { id: "micmic", label: "L-system Delay", href: "l-mic.html" },
    { id: "graph-delay", label: "Graph Delay", href: "graph-delay.html" },
    { id: "micromorph", label: "Micromorph", href: "micromorph.html" },
  ]),
  freezeGroup("barber-shop-poles", "Barber Shop Poles", [
    { id: "shepard-risset", label: "Shepard–Risset", href: "shepard-risset.html" },
    {
      id: "slippery-resynthesis",
      label: "Slippery Resynthesis",
      href: "slippery-resynthesis.html",
    },
    {
      id: "moire-drone",
      label: "Fabric Filter",
      href: "moire-drone.html",
    },
    {
      id: "drum-roll-please",
      label: "Drum Roll Please!",
      href: "drum-roll-please.html",
    },
    { id: "ouroborousel", label: "Ouroborousel", href: "ouroborousel.html" },
    {
      id: "ourorourobouroboros",
      label: "Ourorourobouroboros",
      href: "ourorourobouroboros.html",
    },
    { id: "ouroboros", label: "Ouroboros", href: "ouroboros.html" },
    {
      id: "ouroboros-borealis",
      label: "Ouroboros Borealis",
      href: "ouroboros-borealis.html",
    },
    { id: "sandy-syrup-delay", label: "Sandy Syrup Delay", href: "sandy-syrup-delay.html" },
    { id: "candy-coil-delay", label: "Candy Coil Delay", href: "candy-coil-delay.html" },
  ]),
  freezeGroup("fractals-recursion", "Fractals & Recursion", [
    { id: "l-system", label: "L-System", href: "l-system.html" },
    { id: "recursion", label: "Recursion", href: "recursion.html" },
    { id: "julia", label: "Julia", href: "julia.html" },
    {
      id: "striped-staircase",
      label: "Striped Staircase",
      href: "striped-staircase.html",
    },
  ]),
  freezeGroup("chaotic-synths", "Chaotic Synths", [
    { id: "recursive-fm", label: "Recursive FM", href: "recursive-fm.html" },
    { id: "recursive-pm", label: "Recursive PM", href: "recursive-pm.html" },
    { id: "chaotic-fm", label: "Chaotic FM", href: "chaotic-fm.html" },
    { id: "chaotic-pm", label: "Chaotic PM", href: "chaotic-pm.html" },
    { id: "cascading-fm", label: "Cascading FM", href: "cascading-fm.html" },
    { id: "cascading-pm", label: "Cascading PM", href: "cascading-pm.html" },
    { id: "weierstrass", label: "Weierstrass", href: "weierstrass.html" },
  ]),
  freezeGroup("misc", "Misc", [
    { id: "playhead-paint", label: "Playhead Paint", href: "playhead-paint.html" },
    { id: "boidzoid", label: "Boidzoid", href: "boidzoid.html" },
    { id: "vector-flight", label: "Vector Flight", href: "vector-flight.html" },
    { id: "gesturama", label: "Gesturama", href: "gesturama.html" },
    {
      id: "image-to-instrument-3",
      label: "Wheel of Organs",
      href: "image-to-instrument-3.html",
    },
    {
      id: "orbital-ferris",
      label: "Feral Fairy Ferris Ferry",
      href: "orbital-ferris.html",
    },
  ]),
  freezeGroup("instruments", "Instruments", [
    { id: "fm-drums", label: "FM Drums", href: "fm-drums.html" },
    { id: "linear-drums", label: "Rattlesnake", href: "linear-drums.html" },
    { id: "karplus-strong", label: "Karplus Strong", href: "karplus-strong.html" },
    { id: "karplus-carpet", label: "Karplus Carpet", href: "karplus-carpet.html" },
    { id: "surround-field", label: "Surround Field", href: "surround-field.html" },
    { id: "sample-drums", label: "Sample Drums", href: "sample-drums.html" },
  ]),
  freezeGroup("algorithmic-sequencers", "Algorithmic Sequencers", [
    { id: "sorting-algorithms", label: "Sorting", href: "algorithmic-sequencers.html" },
    { id: "dijkstra", label: "DJ Dijkstra", href: "dijkstra.html" },
  ]),
  freezeGroup("experiments", "Experiments", [
    {
      id: "room-lobby",
      label: "Music Rooms",
      href: "music-rooms.html",
      catalogue: false,
    },
    {
      id: "vocal-effects-room",
      label: "Vocal Effects Room",
      href: "vocal-effects-room.html",
      catalogue: false,
    },
    {
      id: "instrument-share-room",
      label: "Instrument Share Room",
      href: "instrument-share-room.html",
      catalogue: false,
    },
    {
      id: "morphazoid-roulette",
      label: "Morphazoid Roulette",
      href: "morphazoid-roulette.html",
      catalogue: false,
    },
    { id: "hanoi", label: "Hanoi Carillon", href: "hanoi.html" },
    { id: "minimax", label: "Alpha-Beta Minimax", href: "minimax.html" },
    { id: "nqueens", label: "N-Queens Backtracker", href: "nqueens.html" },
    { id: "euclid", label: "Euclidean Pulse", href: "euclid.html" },
    { id: "alien-larynx", label: "Alien Larynx", href: "alien-larynx.html" },
    { id: "hyper-syrinx", label: "Hyper-Syrinx", href: "hyper-syrinx.html" },
    { id: "morphynx", label: "Morphynx", href: "morphynx.html" },
    {
      id: "escher-tessellation",
      label: "Escher",
      href: "escher-tessellation.html",
    },
    { id: "plasma-ball", label: "Plasma Ball", href: "plasma-ball.html" },
    { id: "order-tones", label: "Order Tones", href: "order-tones.html" },
    {
      id: "morphazoidical",
      label: "Morphazoidical",
      href: "morphazoidical/",
      match: "directory",
    },
    { id: "bell-square", label: "Bell Square", href: "bell-square.html" },
    { id: "entanglement-dance", label: "Entanglement Dance", href: "entanglement-dance.html" },
    {
      id: "quantum-square-dance",
      label: "Quantum Square Dance",
      href: "quantum-square-dance.html",
    },
    { id: "annealogue", label: "Annealogue", href: "annealogue.html" },
    { id: "gravity-walk", label: "Gravity Walk", href: "gravity-walk.html" },
    { id: "ricochet", label: "Ricochet", href: "ricochet.html" },
    { id: "rigidity", label: "Rigidity", href: "rigidity.html" },
    { id: "rolling-measure", label: "Rolling Measure", href: "rolling-measure.html" },
    { id: "falling-forms", label: "Falling Forms", href: "falling-forms.html" },
    { id: "charge-garden", label: "Charge Garden", href: "charge-garden.html" },
    { id: "packing-pressure", label: "Packing Pressure", href: "packing-pressure.html" },
    { id: "geodesic-drift", label: "Geodesic Drift", href: "geodesic-drift.html" },
    { id: "kinetic-hull", label: "Kinetic Hull", href: "kinetic-hull.html" },
    { id: "moire-organ", label: "RISSET-MOIRE", href: "moire-organ.html" },
    { id: "chladni-plate", label: "Chladni Plate", href: "chladni-plate.html" },
    { id: "spring-choir", label: "Spring Choir", href: "spring-choir.html" },
    {
      id: "gear-ratio-drums",
      label: "Gear Ratio Drums",
      href: "gear-ratio-drums.html",
    },
    {
      id: "cellular-automata",
      label: "Automata, Automay-to",
      href: "automata.html",
    },
    { id: "prime-sieve", label: "Prime Sieve", href: "prime-sieve.html" },
    {
      id: "lissajous-orbits",
      label: "Lissajous Orbits",
      href: "lissajous-orbits.html",
    },
    { id: "pendulum-wave", label: "Pendulum Wave", href: "pendulum-wave.html" },
    {
      id: "double-pendulum",
      label: "Double Pendulum",
      href: "double-pendulum.html",
    },
    {
      id: "reaction-diffusion",
      label: "Reaction-Diffusion",
      href: "reaction-diffusion.html",
    },
    {
      id: "atomic-orbitals",
      label: "Atomic Orbitals",
      href: "atomic-orbitals.html",
    },
    { id: "dna-translator", label: "DNA Translator", href: "dna-translator.html" },
    { id: "neural-pulse", label: "Neural Pulse", href: "neural-pulse.html" },
    {
      id: "fourier-epicycles",
      label: "Fourier Epicycles",
      href: "fourier-epicycles.html",
    },
    { id: "gravity-lens", label: "Gravity Lens", href: "gravity-lens.html" },
    { id: "cantor-lock", label: "Cantor Lock", href: "cantor-lock.html" },
    { id: "escape-dust", label: "Escape Dust", href: "escape-dust.html" },
    { id: "linebreaker", label: "Linebreaker", href: "linebreaker.html" },
  ], { picker: false }),
]);

export const SITE_LINKS = Object.freeze([]);
const SITE_LINK_ALIASES = Object.freeze({});

export const NAVIGATION_BASE_URL = new URL("./", import.meta.url).href;

const allTools = () => TOOL_GROUPS.flatMap((group) => group.tools);
const basePickerGroups = () => TOOL_GROUPS.flatMap((group) => {
  const tools = group.tools.filter((tool) => (
    group.picker !== false || tool.picker === true
  ));
  return tools.length > 0 ? [{ ...group, tools }] : [];
});
const pickerGroups = () => {
  const groups = basePickerGroups();
  const toolById = new Map(groups.flatMap((group) => (
    group.tools.map((tool) => [tool.id, tool])
  )));
  const faves = FAVE_TOOL_IDS.map((id) => toolById.get(id)).filter(Boolean);
  return faves.length > 0
    ? [{ id: "faves", label: "Faves", tools: faves }, ...groups]
    : groups;
};

/**
 * Normalize a navigation URL to a pathname suitable for route comparison.
 * The site root and its index.html spelling intentionally resolve identically.
 */
export function normalizeNavigationPath(value, siteRoot = NAVIGATION_BASE_URL) {
  try {
    const root = new URL(siteRoot);
    const url = new URL(value, root);
    const rootPath = root.pathname.endsWith("/")
      ? root.pathname
      : root.pathname.replace(/[^/]*$/, "");
    let pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/index\.html$/i, "/");
    if (rootPath.length > 1 && pathname === rootPath.slice(0, -1)) pathname = rootPath;
    return pathname;
  } catch {
    return null;
  }
}

/**
 * Resolve the active tool without assuming the site is hosted at `/`.
 */
export function resolveActiveTool(currentUrl, siteRoot = NAVIGATION_BASE_URL) {
  const currentPath = normalizeNavigationPath(currentUrl, siteRoot);
  if (!currentPath) return null;
  for (const tool of allTools()) {
    const toolPath = normalizeNavigationPath(tool.href, siteRoot);
    if (!toolPath) continue;
    if (tool.match === "directory") {
      const directory = toolPath.endsWith("/") ? toolPath : `${toolPath}/`;
      if (
        currentPath === directory
        || currentPath === directory.slice(0, -1)
        || currentPath.startsWith(directory)
      ) return tool;
    } else if (currentPath === toolPath) {
      return tool;
    }
  }
  return null;
}

export function resolveActiveSiteLink(currentUrl, siteRoot = NAVIGATION_BASE_URL) {
  const currentPath = normalizeNavigationPath(currentUrl, siteRoot);
  if (!currentPath) return null;
  return SITE_LINKS.find((link) => {
    const paths = [
      link.href,
      ...(SITE_LINK_ALIASES[link.id] ?? []),
    ].map((href) => normalizeNavigationPath(href, siteRoot));
    return paths.includes(currentPath);
  }) ?? null;
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function staticCurrentHref(doc) {
  const currentLink = doc.querySelector?.('.tabs [aria-current="page"]');
  if (currentLink?.getAttribute) return currentLink.getAttribute("href");
  const selectedOption = doc.querySelector?.(".mobile-instrument-select option:checked");
  return selectedOption?.value ?? selectedOption?.getAttribute?.("value") ?? null;
}

function createInstrumentPicker(doc, activeTool, siteRoot, index) {
  const details = element(doc, "details", "instrument-picker");
  details.setAttribute("data-active-tool-id", activeTool?.id ?? "");
  const summary = element(doc, "summary", "instrument-picker-trigger");
  summary.setAttribute(
    "aria-label",
    activeTool ? `Choose instrument. Current: ${activeTool.label}` : "Choose instrument",
  );
  summary.setAttribute("title", activeTool?.label ?? "Choose instrument");
  summary.append(element(doc, "strong", "instrument-picker-current", activeTool?.label ?? "Choose"));
  const chevron = element(doc, "span", "instrument-picker-chevron");
  chevron.setAttribute("aria-hidden", "true");
  summary.append(chevron);

  const panel = element(doc, "div", "instrument-picker-panel");
  panel.id = `instrument-picker-panel-${index}`;
  const search = element(doc, "label", "instrument-picker-search");
  const searchLabel = element(doc, "span", "instrument-picker-search-label", "Find");
  const searchInput = element(doc, "input", "instrument-picker-search-input");
  searchInput.type = "search";
  searchInput.placeholder = "Type an instrument";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInput.setAttribute("aria-label", "Filter instruments");
  search.append(searchLabel, searchInput);
  const list = element(doc, "div", "instrument-picker-list");
  list.setAttribute("aria-label", "Morphazoid instruments");
  const groupRecords = [];

  for (const group of pickerGroups()) {
    const section = element(doc, "details", "instrument-picker-group");
    section.setAttribute("data-group-id", group.id);
    const heading = element(doc, "summary", "instrument-picker-group-title");
    heading.id = `instrument-picker-group-${index}-${group.id}`;
    const groupChevron = element(doc, "span", "instrument-picker-group-chevron");
    groupChevron.setAttribute("aria-hidden", "true");
    heading.append(
      element(doc, "span", "instrument-picker-group-label", group.label),
      element(doc, "span", "instrument-picker-group-count", String(group.tools.length)),
      groupChevron,
    );
    section.open = group.id === "faves"
      || group.tools.some((tool) => tool.id === activeTool?.id);
    const rows = [];
    section.append(heading);

    for (const tool of group.tools) {
      const row = element(doc, "div", "instrument-picker-row");
      row.setAttribute("data-filter-text", `${tool.label} ${group.label}`.toLocaleLowerCase());
      const link = element(doc, "a", "instrument-picker-link");
      link.setAttribute("href", new URL(tool.href, siteRoot).href);
      link.setAttribute("data-tool-id", tool.id);
      link.setAttribute("title", tool.label);
      const icon = element(doc, "img", "instrument-picker-link-icon");
      icon.alt = "";
      icon.width = 24;
      icon.height = 24;
      icon.decoding = "async";
      icon.src = new URL(tool.imageHref ?? `assets/instruments/${tool.id}.webp`, siteRoot).href;
      const label = element(doc, "span", "instrument-picker-link-label", tool.label);
      link.append(icon, label);
      if (tool.id === activeTool?.id) {
        link.classList.add("is-current");
        link.setAttribute("aria-current", "page");
      }
      link.addEventListener?.("click", () => {
        details.open = false;
      });
      row.append(link);
      section.append(row);
      rows.push(row);
    }
    groupRecords.push({ group, section, rows, defaultOpen: section.open });
    list.append(section);
  }

  const noResults = element(doc, "p", "instrument-picker-empty", "No instruments found");
  noResults.hidden = true;
  noResults.setAttribute("role", "status");
  list.append(noResults);

  const applyFilter = () => {
    const query = searchInput.value.trim().toLocaleLowerCase();
    let visibleRows = 0;
    for (const record of groupRecords) {
      let groupMatches = 0;
      for (const row of record.rows) {
        const matches = !query || row.getAttribute("data-filter-text").includes(query);
        row.hidden = !matches;
        if (matches) groupMatches += 1;
      }
      const hideDuplicateFaves = Boolean(query) && record.group.id === "faves";
      record.section.hidden = hideDuplicateFaves || groupMatches === 0;
      record.section.open = query ? groupMatches > 0 : record.defaultOpen;
      if (!hideDuplicateFaves) visibleRows += groupMatches;
    }
    noResults.hidden = visibleRows > 0;
  };

  searchInput.addEventListener?.("input", applyFilter);
  panel.append(search, list);
  details.append(summary, panel);
  details.addEventListener?.("keydown", (event) => {
    if (event.key !== "Escape" || !details.open) return;
    event.preventDefault?.();
    if (searchInput.value) {
      searchInput.value = "";
      applyFilter();
      searchInput.focus?.();
      return;
    }
    details.open = false;
    summary.focus?.();
  });
  details.addEventListener?.("toggle", () => {
    if (details.open || !searchInput.value) return;
    searchInput.value = "";
    applyFilter();
  });
  doc.addEventListener?.("pointerdown", (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  });
  return details;
}

const INSTRUMENT_INFO_HOST_SELECTORS = Object.freeze([
  ".panel",
  ".linear-control-panel",
  ".spelling-panel",
  ".image-instrument-panel",
  ".paint-inspector",
  ".control-rail",
  ".vocalzoid-rail",
  ".hyper-console",
  ".analysis-rail",
  ".fm-drums-shell",
]);

function createInstrumentPageInfo(doc, activeTool) {
  if (!activeTool || activeTool.catalogue === false) return null;
  if (doc.body?.getAttribute?.("data-instrument-info") === "off") return null;
  const host = INSTRUMENT_INFO_HOST_SELECTORS
    .map((selector) => doc.querySelector?.(selector))
    .find(Boolean);
  if (!host) return null;
  const existing = host.querySelector?.(".instrument-page-info");
  if (existing) return existing;

  const root = element(doc, "section", "instrument-page-info");
  root.setAttribute("data-tool-id", activeTool.id);
  root.setAttribute("aria-label", `About ${activeTool.label}`);
  host.append(root);
  return root;
}

function renderInstrumentPickerCard(doc, preview, instrument, siteRoot) {
  if (preview.getAttribute?.("data-preview-id") === instrument.id) return;
  preview.setAttribute("data-preview-id", instrument.id);

  const card = element(doc, "article", "instrument-picker-card");
  const heading = element(doc, "header", "instrument-picker-card-heading");
  const visual = element(doc, "div", "instrument-picker-card-visual");
  const image = element(doc, "img", "instrument-picker-card-image");
  image.alt = "";
  image.width = 512;
  image.height = 512;
  image.loading = "eager";
  image.decoding = "sync";
  image.src = new URL(instrument.imageHref, siteRoot).href;
  visual.append(image);

  const headingCopy = element(doc, "div", "instrument-picker-card-heading-copy");
  headingCopy.append(element(doc, "h2", "instrument-picker-card-title", instrument.label));
  headingCopy.append(
    element(doc, "p", "instrument-picker-card-subtitle", instrument.kind),
  );
  if (instrument.status) {
    headingCopy.append(
      element(doc, "span", "instrument-picker-card-status", instrument.status),
    );
  }
  const tags = element(doc, "ul", "instrument-picker-card-tags");
  tags.setAttribute("aria-label", `${instrument.label} tags`);
  for (const tag of instrument.tags) tags.append(element(doc, "li", "", tag.label));
  headingCopy.append(tags);
  heading.append(visual, headingCopy);

  const traits = element(doc, "ul", "instrument-picker-card-traits");
  traits.setAttribute("aria-label", `${instrument.label} inputs and controls`);
  for (const trait of instrument.features) {
    traits.append(element(doc, "li", "", trait));
  }
  const description = element(
    doc,
    "p",
    "instrument-picker-card-description",
    instrument.description,
  );
  const start = element(doc, "div", "instrument-picker-card-start");
  start.append(
    element(doc, "h3", "", "Start"),
    element(doc, "p", "", instrument.start),
  );
  card.append(heading, traits, description, start);
  preview.replaceChildren(card);
}

export function hydrateInstrumentPickers(
  doc,
  instruments,
  siteRoot = NAVIGATION_BASE_URL,
) {
  const instrumentById = new Map(instruments.map((instrument) => [instrument.id, instrument]));
  for (const root of doc?.querySelectorAll?.(".instrument-page-info") ?? []) {
    const instrument = instrumentById.get(root.getAttribute("data-tool-id"));
    if (!instrument) {
      root.hidden = true;
      continue;
    }
    root.hidden = false;
    renderInstrumentPickerCard(doc, root, instrument, siteRoot);
  }
}

function loadInstrumentPageInfo(doc, siteRoot) {
  if (!doc?.querySelector?.(".instrument-page-info")) return;
  import("./src/instrument-catalog.js")
    .then(({ INSTRUMENTS }) => hydrateInstrumentPickers(doc, INSTRUMENTS, siteRoot))
    .catch(() => {
      for (const root of doc.querySelectorAll?.(".instrument-page-info") ?? []) {
        root.hidden = true;
      }
    });
}

function insertBeforeOrAppend(parent, node, reference) {
  if (reference && typeof parent.insertBefore === "function") parent.insertBefore(node, reference);
  else parent.append?.(node);
}

function syncAudioButtonState(button) {
  const pressed = button.getAttribute?.("aria-pressed") === "true";
  const status = button.querySelector?.("#audioState")?.textContent?.trim().toLowerCase() ?? "";
  const state = pressed
    ? "on"
    : /start|load|wait|request|connect/.test(status)
      ? "starting"
      : /error|unavailable|failed|blocked|denied/.test(status)
        ? "error"
        : "off";
  const labels = {
    on: ["Turn audio off", "Audio on"],
    starting: ["Starting audio", "Starting audio"],
    error: ["Audio unavailable", "Audio unavailable"],
    off: ["Turn audio on", "Audio off"],
  };
  button.setAttribute?.("data-audio-state", state);
  button.setAttribute?.("aria-label", labels[state][0]);
  button.setAttribute?.("title", labels[state][1]);
}

export function normalizeAudioButtonIcons(doc) {
  const Observer = doc?.defaultView?.MutationObserver;
  const buttons = new Set([
    ...(doc?.querySelectorAll?.(".audio-button") ?? []),
    ...(doc?.querySelectorAll?.(".audio-toggle") ?? []),
  ]);
  for (const button of buttons) {
    const usesAuthoredPseudoIcon = button.classList?.contains?.("audio-toggle")
      && !button.classList?.contains?.("audio-button");
    let icon = button.querySelector?.(".audio-speaker-icon");
    if (!icon && !usesAuthoredPseudoIcon) {
      icon = element(doc, "span", "audio-speaker-icon");
      icon.setAttribute?.("aria-hidden", "true");
      button.insertBefore?.(icon, button.children?.[0] ?? null);
    }
    for (const child of button.children ?? []) {
      if (child !== icon) child.setAttribute?.("aria-hidden", "true");
    }
    const legacyCopy = button.querySelector?.(".audio-speaker-copy");
    if (legacyCopy) {
      if (typeof legacyCopy.remove === "function") legacyCopy.remove();
      else legacyCopy.hidden = true;
    }
    syncAudioButtonState(button);

    if (button.getAttribute?.("data-audio-icon-ready") === "true") continue;
    button.setAttribute?.("data-audio-icon-ready", "true");
    if (typeof Observer === "function") {
      const observer = new Observer(() => syncAudioButtonState(button));
      observer.observe(button, {
        attributes: true,
        attributeFilter: ["aria-pressed"],
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
  }
}

function primaryTransportControls(doc) {
  const explicit = [...(doc?.querySelectorAll?.("[data-primary-transport]") ?? [])];
  const legacy = doc?.getElementById?.("playButton") ?? doc?.querySelector?.("#playButton");
  return [...new Set([...explicit, legacy].filter(Boolean))];
}

function isPressedControl(control) {
  if (!control) return false;
  if (control.matches?.("input[type='checkbox']")) return Boolean(control.checked);
  return control.getAttribute?.("aria-pressed") === "true"
    || control.dataset?.state === "playing"
    || control.classList?.contains?.("is-playing");
}

function isDisabledControl(control) {
  return Boolean(
    control?.disabled
    || control?.getAttribute?.("disabled") != null
    || control?.getAttribute?.("aria-disabled") === "true"
    || control?.matches?.(":disabled"),
  );
}

function nodeOrAncestor(target, predicate) {
  let node = target;
  while (node && typeof node === "object") {
    if (predicate(node)) return node;
    node = node.parentNode;
  }
  return null;
}

function isKeyboardOwnedTarget(target) {
  return Boolean(nodeOrAncestor(target, (node) => {
    const tagName = String(node.tagName ?? "").toUpperCase();
    if ([
      "AUDIO",
      "BUTTON",
      "INPUT",
      "SELECT",
      "SUMMARY",
      "TEXTAREA",
      "VIDEO",
    ].includes(tagName)) return true;
    if (tagName === "A" && node.getAttribute?.("href") != null) return true;
    if (node.isContentEditable) return true;
    const contentEditable = node.getAttribute?.("contenteditable");
    if (contentEditable != null && String(contentEditable).toLowerCase() !== "false") return true;
    return ARIA_WIDGET_ROLES.has(String(node.getAttribute?.("role") ?? "").toLowerCase());
  }));
}

function eventTargetsControl(event, controls) {
  return controls.find((control) => (
    control === event?.target || control?.contains?.(event?.target)
  )) ?? null;
}

function nearestHeader(node, doc) {
  return nodeOrAncestor(node, (candidate) => (
    candidate.tagName === "HEADER"
    || candidate.classList?.contains?.("masthead")
    || candidate.classList?.contains?.("topbar")
    || candidate.getAttribute?.("data-midi-toolbar-host") != null
  ))
    ?? doc?.querySelector?.(".masthead")
    ?? doc?.querySelector?.("[data-midi-toolbar-host]")
    ?? null;
}

function enqueueContractSync(runtime, callback) {
  const enqueue = runtime?.queueMicrotask ?? globalThis.queueMicrotask;
  if (typeof enqueue === "function") enqueue.call(runtime, callback);
  else Promise.resolve().then(callback);
}

/**
 * Install the shared Audio/transport interaction contract for one document.
 *
 * Space owns only the primary transport and only when focus is outside native
 * or ARIA widgets. Audio remains a separate explicit control; starting a
 * transport while it is off exposes a persistent, live masthead instruction.
 */
export function initializeAudioTransportContract(doc, runtime = globalThis) {
  if (!doc || (typeof doc !== "object" && typeof doc !== "function")) return null;
  if (AUDIO_TRANSPORT_CONTRACTS.has(doc)) return AUDIO_TRANSPORT_CONTRACTS.get(doc);

  const transports = primaryTransportControls(doc);
  const primaryTransport = transports[0] ?? null;
  const audioButton = doc.querySelector?.(".audio-button")
    ?? doc.getElementById?.("audioButton")
    ?? doc.querySelector?.("#audioButton")
    ?? doc.getElementById?.("audioToggle")
    ?? doc.querySelector?.("#audioToggle")
    ?? null;

  for (const control of transports) control.setAttribute?.("aria-keyshortcuts", "Space");

  let status = null;
  const header = nearestHeader(audioButton, doc);
  if (audioButton && primaryTransport && header && typeof doc.createElement === "function") {
    status = header.querySelector?.(".transport-audio-attention") ?? null;
    if (!status) {
      status = element(doc, "p", "transport-audio-attention", AUDIO_OFF_TRANSPORT_MESSAGE);
      status.id = "transportAudioAttention";
      status.hidden = true;
      status.setAttribute?.("role", "status");
      status.setAttribute?.("aria-live", "polite");
      status.setAttribute?.("aria-atomic", "true");
      header.append?.(status);
    }
  }

  let assumedControl = null;
  let assumedPlaying = false;
  let keyboardClickControl = null;
  const observers = [];

  const audioIsOn = () => isPressedControl(audioButton);
  const transportIsActiveOrRequested = (control) => (
    control === assumedControl ? assumedPlaying : isPressedControl(control)
  );
  const sync = () => {
    const audioOn = audioIsOn();
    if (audioOn) assumedControl = null;
    const needsAudioAttention = !audioOn && transports.some(transportIsActiveOrRequested);
    if (status) {
      if (status.textContent !== AUDIO_OFF_TRANSPORT_MESSAGE) {
        status.textContent = AUDIO_OFF_TRANSPORT_MESSAGE;
      }
      status.hidden = !needsAudioAttention;
    }
    if (needsAudioAttention) audioButton?.setAttribute?.("data-audio-attention", "true");
    else audioButton?.removeAttribute?.("data-audio-attention");
    return needsAudioAttention;
  };
  const noteTransportIntent = (control) => {
    // Derive each request from the control's real state. If an instrument
    // rejects Play while Audio is off and leaves aria-pressed=false, repeated
    // requests must keep the Audio guidance visible instead of alternating it.
    const wasPlaying = isPressedControl(control);
    assumedControl = control;
    assumedPlaying = !wasPlaying;
    sync();
  };
  const reconcile = () => {
    if (assumedControl && isPressedControl(assumedControl) === assumedPlaying) {
      assumedControl = null;
    }
    sync();
  };
  const handleClick = (event) => {
    const transport = eventTargetsControl(event, transports);
    if (transport && transport !== keyboardClickControl && !isDisabledControl(transport)) {
      noteTransportIntent(transport);
    }
    if (transport || eventTargetsControl(event, audioButton ? [audioButton] : [])) {
      enqueueContractSync(runtime, reconcile);
    }
  };
  const handleKeydown = (event) => {
    const isSpace = event?.code === "Space" || event?.key === " ";
    if (!isSpace || isKeyboardOwnedTarget(event.target) || !primaryTransport) return;

    const shortcutIsGuarded = Boolean(
      event.defaultPrevented
      || event.repeat
      || event.isComposing
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || isDisabledControl(primaryTransport)
    );
    if (shortcutIsGuarded) {
      // A page-surface Space belongs to this shared contract even when its
      // shortcut is guarded. Stop older bubbling listeners without changing
      // browser behavior or activating the transport.
      event.stopImmediatePropagation?.();
      if (!event.stopImmediatePropagation) event.stopPropagation?.();
      return;
    }

    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    if (!event.stopImmediatePropagation) event.stopPropagation?.();
    noteTransportIntent(primaryTransport);
    keyboardClickControl = primaryTransport;
    try {
      primaryTransport.click?.();
    } finally {
      keyboardClickControl = null;
    }
    enqueueContractSync(runtime, reconcile);
  };

  doc.addEventListener?.("keydown", handleKeydown, true);
  doc.addEventListener?.("click", handleClick, true);

  const Observer = doc?.defaultView?.MutationObserver ?? runtime?.MutationObserver;
  if (typeof Observer === "function") {
    for (const control of [audioButton, ...transports].filter(Boolean)) {
      const observer = new Observer(reconcile);
      observer.observe(control, {
        attributes: true,
        attributeFilter: ["aria-pressed", "aria-disabled", "class", "data-state"],
      });
      observers.push(observer);
    }
  }

  sync();
  let destroyed = false;
  const contract = Object.freeze({
    audioButton,
    primaryTransport,
    status,
    sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.removeEventListener?.("keydown", handleKeydown, true);
      doc.removeEventListener?.("click", handleClick, true);
      for (const observer of observers) observer.disconnect?.();
      AUDIO_TRANSPORT_CONTRACTS.delete(doc);
    },
  });
  AUDIO_TRANSPORT_CONTRACTS.set(doc, contract);
  return contract;
}

function headerSettingsSection(doc, id, title, control) {
  const section = element(doc, "section", "header-settings-section");
  const label = element(doc, "label", "header-settings-section-title", title);
  label.id = id;
  label.setAttribute("for", control.id);
  section.append(label, control);
  return section;
}

function syncSelectOptions(doc, select, choices, selectedValue = "") {
  const options = choices.map((choice) => ({
    value: String(choice.value ?? ""),
    label: String(choice.label ?? ""),
    disabled: Boolean(choice.disabled),
  }));
  const current = [...(select.children ?? [])];
  const matches = current.length === options.length && current.every((option, index) => (
    String(option.value ?? "") === options[index].value
    && option.textContent === options[index].label
    && Boolean(option.disabled) === options[index].disabled
  ));
  if (!matches) {
    select.replaceChildren(...options.map((choice) => {
      const option = element(doc, "option", "", choice.label);
      option.value = choice.value;
      option.disabled = choice.disabled;
      return option;
    }));
  }
  const value = String(selectedValue ?? "");
  select.value = options.some((option) => option.value === value)
    ? value
    : options[0]?.value ?? "";
}

function outputDeviceId(device) {
  return String(device?.deviceId ?? device?.id ?? "").trim();
}

function outputDeviceLabel(device) {
  return String(device?.label ?? device?.name ?? "Audio output").trim() || "Audio output";
}

/** Build the one site-level MIDI control used by every mapped instrument. */
export function createMidiToolbar(
  doc,
  runtime,
  manager = getSharedMidiManager(runtime),
  {
    idSuffix = "",
    host = null,
    routeId = null,
    audioOutputManager = getSharedAudioOutputManager(runtime),
  } = {},
) {
  const suffix = idSuffix ? `-${String(idSuffix).replace(/[^a-z\d_-]/gi, "-")}` : "";
  const capability = instrumentMidiCapabilityForId(routeId);
  const midiStatus = createMidiStatus({
    ariaLabel: "MIDI and computer keyboard controls",
    controlled: true,
    interactive: false,
    state: "off",
  }, doc);
  const toolbar = midiStatus;
  toolbar.className = "midi-toolbar";
  toolbar.hidden = true;
  const toggle = midiStatus.toggle;
  toggle.id = `sharedMidiToggle${suffix}`;
  toggle.setAttribute("aria-label", "Turn MIDI input on");
  toggle.setAttribute("title", "MIDI input off");
  const toggleState = midiStatus.statusElement;
  const activityLight = midiStatus.activityLight;

  const meterShell = createStereoMeter({
    active: false,
    ariaLabel: "Stereo audio output levels",
    left: 0,
    right: 0,
  }, doc);
  meterShell.setAttribute("title", "Stereo audio output · inactive");
  meterShell.hidden = true;
  const leftOutput = { channel: meterShell.leftChannel, meter: meterShell.leftMeter };
  const rightOutput = { channel: meterShell.rightChannel, meter: meterShell.rightMeter };
  const leftMeter = leftOutput.meter;
  const rightMeter = rightOutput.meter;
  // Keep the original `meter` handle as a backwards-compatible alias.
  const meter = leftMeter;

  const details = element(doc, "details", "header-settings-menu");
  details.hidden = true;
  const summary = element(doc, "summary", "header-settings-trigger");
  summary.setAttribute("aria-label", "Morphazoid Settings");
  summary.setAttribute("title", "Morphazoid Settings");
  summary.setAttribute("aria-controls", `headerSettingsPanel${suffix}`);
  const settingsIcon = element(doc, "span", "header-settings-icon");
  settingsIcon.setAttribute("aria-hidden", "true");
  summary.append(settingsIcon);

  const panel = element(doc, "div", "header-settings-panel");
  panel.id = `headerSettingsPanel${suffix}`;
  const heading = element(doc, "div", "header-settings-heading");
  heading.append(element(doc, "h2", "", "Morphazoid Settings"));

  const audioOutputSelect = element(doc, "select", "audio-output-select");
  audioOutputSelect.id = `audioOutputSelect${suffix}`;
  audioOutputSelect.setAttribute("aria-label", "Audio output device");
  const initialAudioOption = element(doc, "option", "", "System default");
  initialAudioOption.value = "";
  audioOutputSelect.append(initialAudioOption);
  const audioOutSection = headerSettingsSection(
    doc,
    `headerSettingsAudioOut${suffix}`,
    "Audio Out",
    audioOutputSelect,
  );
  const audioOutputError = element(doc, "p", "header-settings-error");
  audioOutputError.setAttribute("role", "alert");
  audioOutputError.hidden = true;

  const audioInputSelect = element(doc, "select", "audio-input-select");
  audioInputSelect.id = `audioInputSelect${suffix}`;
  audioInputSelect.setAttribute("aria-label", "Microphone or audio input route");
  const usesAudioInput = Boolean(capability?.audioInput);
  syncSelectOptions(doc, audioInputSelect, [{
    value: usesAudioInput ? "instrument" : "",
    label: usesAudioInput
      ? runtime?.MorphazoidWAX ? "DAW / host" : "Page input"
      : "Not used",
  }], usesAudioInput ? "instrument" : "");
  audioInputSelect.disabled = !usesAudioInput;
  const audioInputSection = headerSettingsSection(
    doc,
    `headerSettingsAudioInput${suffix}`,
    "Mic / Audio In",
    audioInputSelect,
  );
  if (!usesAudioInput) audioInputSection.classList.add("is-unavailable");

  const midiInputSelect = element(doc, "select", "midi-input-select");
  midiInputSelect.id = `midiInputSelect${suffix}`;
  midiInputSelect.setAttribute("aria-label", "MIDI input");
  syncSelectOptions(doc, midiInputSelect, [{ value: "", label: "Unavailable" }]);
  midiInputSelect.disabled = true;
  const midiInSection = headerSettingsSection(
    doc,
    `headerSettingsMidiIn${suffix}`,
    "MIDI In",
    midiInputSelect,
  );
  const midiInputWarning = element(doc, "p", "header-settings-error midi-input-warning");
  midiInputWarning.id = `sharedMidiInputWarning${suffix}`;
  midiInputWarning.setAttribute("role", "alert");
  midiInputWarning.hidden = true;

  const midiOutputSelect = element(doc, "select", "midi-output-select");
  midiOutputSelect.id = `midiOutputSelect${suffix}`;
  midiOutputSelect.setAttribute(
    "aria-label",
    capability?.midiOutput && !runtime?.MorphazoidWAX
      ? "MIDI output: preview only, not routed"
      : "MIDI output route",
  );
  midiOutputSelect.disabled = true;
  syncSelectOptions(doc, midiOutputSelect, [{
    value: "",
    label: !capability?.midiOutput
      ? "Not used"
      : runtime?.MorphazoidWAX ? "DAW / host" : "Preview · no route",
  }]);
  const midiOutSection = headerSettingsSection(
    doc,
    `headerSettingsMidiOut${suffix}`,
    "MIDI Out",
    midiOutputSelect,
  );
  midiOutSection.classList.add("is-unavailable");

  const select = element(doc, "select", "midi-profile-select");
  select.id = `midiProfileSelect${suffix}`;
  select.setAttribute("aria-label", "MIDI controller profile");
  for (const profile of MIDI_PROFILES) {
    let label = profile.label;
    if (profile.id === "auto") {
      label = capability?.computerKeyboardMode === "page"
        ? "Page keys"
        : capability?.computerKeyboardMode === "none"
        ? "Auto hardware"
        : "Computer keys";
    }
    const option = element(doc, "option", "", label);
    option.value = profile.id;
    select.append(option);
  }
  const midiMapSection = headerSettingsSection(
    doc,
    `headerSettingsMidiMap${suffix}`,
    "MIDI Map",
    select,
  );
  const guide = element(doc, "a", "midi-profile-guide", "MIDI Guide");
  guide.setAttribute("href", new URL("midi-guide.html", NAVIGATION_BASE_URL).href);
  const error = element(doc, "p", "midi-profile-error");
  error.id = `sharedMidiError${suffix}`;
  error.setAttribute("role", "alert");
  error.hidden = true;
  panel.append(
    heading,
    audioOutSection,
    audioInputSection,
    midiInSection,
    midiOutSection,
    midiMapSection,
    guide,
    audioOutputError,
    midiInputWarning,
    error,
  );
  details.append(summary, panel);
  toolbar.append(toggle);

  const paintMidiInput = (status) => {
    if (!status.supported) {
      syncSelectOptions(doc, midiInputSelect, [{ value: "", label: "Unavailable" }]);
      midiInputSelect.disabled = true;
      midiInSection.classList.add("is-unavailable");
    } else {
      const inputKind = status.computerKeyboard?.supported
        ? status.webMidiSupported ? "keys + MIDI" : "keys"
        : "MIDI";
      syncSelectOptions(doc, midiInputSelect, [
        { value: "off", label: "Off" },
        { value: "on", label: `On · ${inputKind}` },
      ], status.enabled ? "on" : "off");
      midiInputSelect.disabled = Boolean(status.enabling);
      midiInSection.classList.remove("is-unavailable");
    }

    const hardwareDegraded = Boolean(
      status.enabled
      && status.hardwareError
      && status.computerKeyboard?.active,
    );
    midiInputWarning.textContent = hardwareDegraded
      ? "Hardware MIDI unavailable — computer keys still work."
      : "";
    midiInputWarning.title = hardwareDegraded ? String(status.hardwareError) : "";
    midiInputWarning.hidden = !hardwareDegraded;
  };

  const paintMidiOutput = () => {
    if (!capability?.midiOutput) {
      syncSelectOptions(doc, midiOutputSelect, [{
        value: "",
        label: "Not used",
      }]);
      midiOutputSelect.disabled = true;
      midiOutSection.classList.add("is-unavailable");
      return;
    }
    if (runtime?.MorphazoidWAX) {
      syncSelectOptions(doc, midiOutputSelect, [{ value: "", label: "DAW / host" }]);
      midiOutputSelect.disabled = true;
      midiOutSection.classList.remove("is-unavailable");
      return;
    }
    syncSelectOptions(doc, midiOutputSelect, [{
      value: "",
      label: "Preview · no route",
    }]);
    midiOutputSelect.disabled = true;
    midiOutSection.classList.add("is-unavailable");
  };

  const paint = (status) => {
    const clientCount = Number(status.clientCount) || 0;
    const visible = clientCount > 0;
    const toolbarHost = host ?? toolbar.parentNode;
    toolbar.hidden = !visible;
    meterShell.hidden = !visible;
    details.hidden = !visible;
    if (visible) toolbarHost?.classList?.add("has-midi-toolbar");
    else {
      toolbarHost?.classList?.remove("has-midi-toolbar");
      toolbar.classList.remove("is-error");
      error.textContent = "";
      error.hidden = true;
    }
    toggle.disabled = !status.supported || clientCount === 0;
    toggle.setAttribute("aria-pressed", String(Boolean(status.enabled)));
    toggle.setAttribute(
      "aria-label",
      status.enabled ? "Turn MIDI input off" : "Turn MIDI input on",
    );
    toggle.title = status.enabled ? "MIDI input on" : "MIDI input off";
    toggleState.textContent = status.enabled
      ? status.computerKeyboard?.active
        ? status.inputCount ? `keys+${status.inputCount}` : "keys"
        : `${status.inputCount} in`
      : status.enabling ? "wait" : status.supported ? "off" : "n/a";
    select.value = status.selectedProfileId;
    paintMidiInput(status);
    paintMidiOutput(status);
    if (!status.enabled) toolbar.classList.remove("is-receiving");
  };

  const unsubscribe = manager.subscribeStatus(paint);
  let audioOutputCanSelect = false;
  const paintAudioOutput = (status = {}) => {
    const clampLevel = (value) => Math.max(0, Math.min(1, Number(value) || 0));
    const aggregatePeak = status.peak ?? status.rms ?? 0;
    const hasLeftPeak = status.leftPeak != null;
    const hasRightPeak = status.rightPeak != null;
    const leftValue = clampLevel(status.leftPeak ?? status.leftRms ?? aggregatePeak);
    const rightValue = clampLevel(status.rightPeak ?? status.rightRms ?? aggregatePeak);
    const leftClipped = hasLeftPeak
      ? Number(status.leftPeak) >= 1
      : Boolean(status.clipped);
    const rightClipped = hasRightPeak
      ? Number(status.rightPeak) >= 1
      : Boolean(status.clipped);

    const paintChannel = ({ channel, channelMeter }, side, value, clipped) => {
      const displayedValue = value >= OUTPUT_METER_SILENCE_FLOOR ? value : 0;
      const percentage = Math.round(displayedValue * 100);
      const active = displayedValue > 0;
      channelMeter.value = displayedValue;
      channelMeter.textContent = `${percentage}%`;
      channelMeter.setAttribute("value", String(displayedValue));
      channelMeter.setAttribute("aria-valuenow", String(displayedValue));
      channelMeter.setAttribute(
        "aria-valuetext",
        clipped
          ? `${side} channel clipping at ${percentage}%`
          : active
          ? `${side} channel ${percentage}% output signal`
          : `${side} channel has no output signal`,
      );
      if (active) {
        channel.classList.add("is-active");
        channelMeter.classList.add("is-active");
      } else {
        channel.classList.remove("is-active");
        channelMeter.classList.remove("is-active");
      }
      if (clipped) {
        channel.classList.add("is-clipping");
        channelMeter.classList.add("is-clipping");
      } else {
        channel.classList.remove("is-clipping");
        channelMeter.classList.remove("is-clipping");
      }
      return percentage;
    };
    const leftPercentage = paintChannel({
      channel: leftOutput.channel,
      channelMeter: leftMeter,
    }, "Left", leftValue, leftClipped);
    const rightPercentage = paintChannel({
      channel: rightOutput.channel,
      channelMeter: rightMeter,
    }, "Right", rightValue, rightClipped);
    const hasSignal = Boolean(
      status.active
      || leftValue >= OUTPUT_METER_SILENCE_FLOOR
      || rightValue >= OUTPUT_METER_SILENCE_FLOOR,
    );
    meterShell.title = hasSignal
      ? `Stereo audio output · L ${leftPercentage}%${leftClipped ? " CLIP" : ""} · R ${rightPercentage}%${rightClipped ? " CLIP" : ""}`
      : "Stereo audio output · inactive";
    if (hasSignal) meterShell.classList.add("is-active");
    else meterShell.classList.remove("is-active");
    if (leftClipped || rightClipped) meterShell.classList.add("is-clipping");
    else meterShell.classList.remove("is-clipping");
    const canSelect = Boolean(
      status.output?.canSelect
      && typeof audioOutputManager?.setOutputDevice === "function"
      && typeof audioOutputManager?.listOutputDevices === "function",
    );
    audioOutputCanSelect = canSelect;
    audioOutputSelect.disabled = !canSelect;
    if (canSelect) {
      const hasSystemDefault = [...audioOutputSelect.children].some((option) => (
        option.value === "" && option.textContent === "System default"
      ));
      if (!hasSystemDefault) {
        syncSelectOptions(doc, audioOutputSelect, [{ value: "", label: "System default" }]);
      }
      audioOutSection.classList.remove("is-unavailable");
      const selectedId = String(status.output?.selectedId ?? "");
      if ([...audioOutputSelect.children].some(({ value: id }) => id === selectedId)) {
        audioOutputSelect.value = selectedId;
      }
      return;
    }

    const mode = runtime?.MorphazoidWAX ? "wax-host" : status.output?.mode;
    const label = mode === "wax-host"
      ? "DAW / host"
      : mode === "system-default"
      ? "System default"
      : "Start audio first";
    syncSelectOptions(doc, audioOutputSelect, [{ value: "", label }]);
    audioOutSection.classList.add("is-unavailable");
  };
  const unsubscribeAudioOutput = (typeof audioOutputManager?.subscribe === "function"
    ? audioOutputManager.subscribe(paintAudioOutput)
    : (() => {
      paintAudioOutput(audioOutputManager?.getStatus?.());
      return () => {};
    })()) ?? (() => {});

  const refreshAudioOutputChoices = async () => {
    const output = audioOutputManager?.getStatus?.()?.output;
    if (!output?.canSelect || typeof audioOutputManager?.listOutputDevices !== "function") return;
    try {
      audioOutputError.hidden = true;
      audioOutputError.textContent = "";
      if (typeof audioOutputManager.refreshOutputDevices === "function") {
        await audioOutputManager.refreshOutputDevices();
      }
      const devices = await audioOutputManager.listOutputDevices();
      const options = [{ value: "", label: "System default" }];
      for (const device of devices ?? []) {
        const id = outputDeviceId(device);
        if (!id) continue;
        options.push({ value: id, label: outputDeviceLabel(device) });
      }
      syncSelectOptions(doc, audioOutputSelect, options, output.selectedId ?? "");
    } catch (reason) {
      audioOutputError.textContent = reason instanceof Error ? reason.message : String(reason);
      audioOutputError.hidden = false;
    }
  };
  const activityTimers = (
    typeof runtime?.setTimeout === "function"
    && typeof runtime?.clearTimeout === "function"
  ) ? runtime : globalThis;
  let activityTimer = null;
  const clearActivity = () => {
    if (activityTimer !== null) activityTimers.clearTimeout(activityTimer);
    activityTimer = null;
    toolbar.classList.remove("is-receiving");
  };
  const pulseActivity = (message) => {
    if (message?.synthetic || !manager.enabled) return;
    toolbar.classList.add("is-receiving");
    if (activityTimer !== null) activityTimers.clearTimeout(activityTimer);
    activityTimer = activityTimers.setTimeout(clearActivity, 110);
    activityTimer?.unref?.();
  };
  const unsubscribeMessages = typeof manager.subscribeMessages === "function"
    ? manager.subscribeMessages(pulseActivity)
    : () => {};
  const clearError = () => {
    toolbar.classList.remove("is-error");
    error.textContent = "";
    error.hidden = true;
  };
  const showError = (reason) => {
    error.textContent = reason instanceof Error ? reason.message : String(reason);
    error.hidden = false;
    toolbar.classList.add("is-error");
    details.open = true;
  };
  const handleToggle = async () => {
    clearError();
    try {
      if (manager.enabled) manager.disable();
      else await manager.enable();
      clearError();
    } catch (reason) {
      showError(reason);
    }
  };
  const handleProfileChange = () => {
    clearError();
    try {
      manager.setProfile(select.value);
    } catch (reason) {
      select.value = manager.selectedProfileId;
      showError(reason);
    }
  };
  const handleMidiInputChange = async () => {
    clearError();
    try {
      if (midiInputSelect.value === "on") await manager.enable();
      else manager.disable();
      clearError();
    } catch (reason) {
      showError(reason);
    } finally {
      paint(manager.status());
    }
  };
  const handleAudioOutputChange = async () => {
    if (typeof audioOutputManager?.setOutputDevice !== "function") return;
    audioOutputSelect.disabled = true;
    try {
      await audioOutputManager.setOutputDevice(audioOutputSelect.value);
      audioOutputError.hidden = true;
      audioOutputError.textContent = "";
    } catch (reason) {
      audioOutputError.textContent = reason instanceof Error ? reason.message : String(reason);
      audioOutputError.hidden = false;
    } finally {
      audioOutputSelect.disabled = !audioOutputCanSelect;
    }
  };
  const handleDetailsToggle = () => {
    if (details.open) return refreshAudioOutputChoices();
    return undefined;
  };
  const handleDetailsKeydown = (event) => {
    if (event.key !== "Escape" || !details.open) return;
    event.preventDefault?.();
    details.open = false;
    summary.focus?.();
  };
  const handleDocumentPointerdown = (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  };
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    unsubscribeMessages();
    unsubscribeAudioOutput();
    clearActivity();
    midiStatus.destroy();
    toggle.removeEventListener?.("click", handleToggle);
    select.removeEventListener?.("change", handleProfileChange);
    midiInputSelect.removeEventListener?.("change", handleMidiInputChange);
    audioOutputSelect.removeEventListener?.("change", handleAudioOutputChange);
    details.removeEventListener?.("toggle", handleDetailsToggle);
    details.removeEventListener?.("keydown", handleDetailsKeydown);
    doc.removeEventListener?.("pointerdown", handleDocumentPointerdown);
    runtime.removeEventListener?.("pagehide", handlePageHide);
  };
  const handlePageHide = (event) => {
    manager.disable();
    if (!event?.persisted) destroy();
  };
  toggle.addEventListener("click", handleToggle);
  select.addEventListener("change", handleProfileChange);
  midiInputSelect.addEventListener("change", handleMidiInputChange);
  audioOutputSelect.addEventListener("change", handleAudioOutputChange);
  details.addEventListener("toggle", handleDetailsToggle);
  details.addEventListener("keydown", handleDetailsKeydown);
  doc.addEventListener?.("pointerdown", handleDocumentPointerdown);
  runtime.addEventListener?.("pagehide", handlePageHide);

  return Object.freeze({
    toolbar,
    toggle,
    details,
    select,
    meter,
    leftMeter,
    rightMeter,
    meterShell,
    audioOutputSelect,
    audioInputSelect,
    midiInputSelect,
    midiOutputSelect,
    activityLight,
    unsubscribe: destroy,
    destroy,
  });
}

export function initializeMidiToolbars(
  doc,
  runtime,
  manager = getSharedMidiManager(runtime),
  {
    routeId = resolveActiveTool(runtime?.location?.href || doc?.baseURI)?.id ?? null,
    audioOutputManager = getSharedAudioOutputManager(runtime),
  } = {},
) {
  const controls = [];
  const mastheads = [...new Set([
    ...(doc?.querySelectorAll?.(".masthead") ?? []),
    ...(doc?.querySelectorAll?.("[data-midi-toolbar-host]") ?? []),
  ])];
  for (const [index, masthead] of mastheads.entries()) {
    if (masthead.querySelector?.(".midi-toolbar")) continue;
    const control = createMidiToolbar(doc, runtime, manager, {
      idSuffix: index === 0 ? "" : String(index + 1),
      host: masthead,
      routeId,
      audioOutputManager,
    });
    const audioControls = masthead.querySelector?.(".audio-strip")
      ?? masthead.querySelector?.(".header-actions")
      ?? masthead.querySelector?.(".audio-toggle");
    if (audioControls) {
      let ioControls = masthead.querySelector?.(".header-io-controls");
      if (!ioControls) {
        ioControls = element(doc, "div", "header-io-controls");
        ioControls.setAttribute("role", "group");
        ioControls.setAttribute("aria-label", "MIDI, audio, and settings controls");
        insertBeforeOrAppend(masthead, ioControls, audioControls);
        ioControls.append(audioControls);
      }
      insertBeforeOrAppend(ioControls, control.toolbar, audioControls);
      insertBeforeOrAppend(ioControls, control.meterShell, audioControls);
      const audioButton = audioControls.querySelector?.(".audio-button");
      if (audioButton) audioControls.append(audioButton);
      ioControls.append(control.details);
    } else {
      masthead.append?.(control.toolbar, control.meterShell, control.details);
    }
    masthead.classList?.add("has-header-settings");
    if (manager.status().clientCount > 0) masthead.classList?.add("has-midi-toolbar");
    controls.push(control);
  }
  return Object.freeze(controls);
}

function populateMobileSelect(doc, select, activeTool, activeSiteLink, siteRoot) {
  const options = [];
  if (!activeTool && !activeSiteLink) {
    const placeholder = element(doc, "option", "", "Choose");
    placeholder.value = "";
    placeholder.selected = true;
    placeholder.disabled = true;
    options.push(placeholder);
  }

  const groups = basePickerGroups().map((group) => {
    const optgroup = element(doc, "optgroup");
    optgroup.label = group.label;
    for (const tool of group.tools) {
      const option = element(doc, "option", "", tool.label);
      option.value = new URL(tool.href, siteRoot).href;
      if (tool.id === activeTool?.id) option.selected = true;
      optgroup.append(option);
    }
    return optgroup;
  });
  options.push(...groups);
  if (SITE_LINKS.length > 0) {
    const information = element(doc, "optgroup");
    information.label = "Information";
    for (const link of SITE_LINKS) {
      const option = element(doc, "option", "", link.label);
      option.value = new URL(link.href, siteRoot).href;
      if (link.id === activeSiteLink?.id) option.selected = true;
      information.append(option);
    }
    options.push(information);
  }
  select.replaceChildren(...options);
  select.setAttribute("aria-label", "Instrument");
  if (activeTool) select.value = new URL(activeTool.href, siteRoot).href;
  if (activeSiteLink) select.value = new URL(activeSiteLink.href, siteRoot).href;
}

/**
 * Enhance the static desktop links and mobile options in place. Static markup
 * remains a complete no-JavaScript fallback in every page.
 */
export function enhanceSharedNavigation(doc, {
  currentHref = doc?.baseURI ?? NAVIGATION_BASE_URL,
  siteRoot = NAVIGATION_BASE_URL,
} = {}) {
  if (!doc?.querySelectorAll || !doc?.createElement) {
    return Object.freeze({ activeTool: null, disclosures: Object.freeze([]) });
  }

  const fallbackHref = staticCurrentHref(doc);
  const activeTool = resolveActiveTool(currentHref, siteRoot)
    ?? (fallbackHref ? resolveActiveTool(fallbackHref, siteRoot) : null);
  const activeSiteLink = resolveActiveSiteLink(currentHref, siteRoot);
  const disclosures = [];

  [...doc.querySelectorAll(".tabs")].forEach((nav, index) => {
    const picker = createInstrumentPicker(doc, activeTool, siteRoot, index + 1);
    nav.replaceChildren(picker);
    nav.classList.add("tools-nav");
    nav.hidden = false;
    nav.setAttribute("aria-label", "Morphazoid main menu");
    disclosures.push(picker);
  });

  const pageInfo = createInstrumentPageInfo(doc, activeTool);

  for (const select of doc.querySelectorAll(".mobile-instrument-select")) {
    populateMobileSelect(doc, select, activeTool, activeSiteLink, siteRoot);
  }

  return Object.freeze({
    activeTool,
    activeSiteLink,
    disclosures: Object.freeze(disclosures),
    pageInfos: Object.freeze(pageInfo ? [pageInfo] : []),
    selectedInfos: Object.freeze([]),
  });
}

function runtimeStorage(runtime, key) {
  try {
    return runtime?.[key] ?? null;
  } catch {
    return null;
  }
}

function clearLegacySettings(localStorage) {
  try {
    for (const key of LEGACY_SETTINGS_KEYS) localStorage?.removeItem(key);
  } catch {
    // Pages still reset normally when storage is unavailable.
  }
}

function preserveShapeSides(doc, storage) {
  try {
    const sides = doc.getElementById?.("sides");
    if (!sides) return;
    storage?.setItem(RESET_SHAPE_SIDES_KEY, sides.value);
  } catch {
    // Reset still works when one-shot session storage is unavailable.
  }
}

export function initializeSharedNavigation(doc = globalThis.document, runtime = globalThis) {
  clearLegacySettings(runtimeStorage(runtime, "localStorage"));

  normalizeAudioButtonIcons(doc);

  const siteRoot = NAVIGATION_BASE_URL;
  const navigation = enhanceSharedNavigation(doc, {
    currentHref: runtime.location?.href || doc?.baseURI || NAVIGATION_BASE_URL,
    siteRoot,
  });
  loadInstrumentPageInfo(doc, siteRoot);
  initializeChaoticViewportControls(doc, runtime, {
    instrumentId: navigation.activeTool?.id,
  });

  installBrowserMidiAdapter(runtime, doc, { routeId: navigation.activeTool?.id });
  if (navigation.activeTool) {
    const capability = instrumentMidiCapabilityForId(navigation.activeTool.id);
    initializeMidiToolbars(doc, runtime, getSharedMidiManager(runtime), {
      routeId: navigation.activeTool.id,
    });
    initializeMidiOutputMonitor(doc, runtime, {
      routeId: navigation.activeTool.id,
      capability,
    });
  }
  initializeAudioTransportContract(doc, runtime);

  for (const select of doc?.querySelectorAll?.(".mobile-instrument-select") ?? []) {
    select.addEventListener("change", () => {
      if (select.value) runtime.location.href = select.value;
    });
  }

  for (const button of doc?.querySelectorAll?.("[data-reset-all]") ?? []) {
    if (button.hasAttribute?.("data-reset-in-place")) continue;
    button.addEventListener("click", () => {
      preserveShapeSides(doc, runtimeStorage(runtime, "sessionStorage"));
      clearLegacySettings(runtimeStorage(runtime, "localStorage"));
      runtime.location.reload();
    });
  }
}

if (typeof document !== "undefined") initializeSharedNavigation(document, globalThis);

import {
  COMPUTER_KEYBOARD_DEFAULTS,
  MIDI_PROFILES,
  MIDI_PROFILE_REGISTRY,
  getSharedMidiManager,
} from "./src/midi-manager.js";
import { getSharedAudioOutputManager } from "./src/audio-output-manager.js";
import { installBrowserMidiAdapter } from "./src/browser-midi-adapter.js";
import { instrumentMidiCapabilityForId } from "./src/instrument-midi-capabilities.js";

const LEGACY_SETTINGS_KEYS = [
  "morphazoid:shape:audio:v1",
  "morphazoid:lattice:audio:v2",
  "morphazoid:lumber:audio:v2",
];
const RESET_SHAPE_SIDES_KEY = "morphazoid:shape:reset:sides";

const freezeGroup = (id, label, tools, metadata = {}) => Object.freeze({
  id,
  label,
  ...metadata,
  tools: Object.freeze(tools.map((tool) => Object.freeze(tool))),
});

/**
 * Shared navigation contract.
 *
 * `href` values are relative to nav.js, which lives at the published site
 * root. Directory tools use prefix matching so their secondary pages remain
 * associated with the same top-level tool.
 */
export const TOOL_GROUPS = Object.freeze([
  freezeGroup("geometry", "Geometry Synths", [
    { id: "shape", label: "Shape", href: "shape.html" },
    { id: "lattice", label: "Lattice", href: "lattice.html" },
    { id: "spiral", label: "Spiral", href: "spiral.html" },
    { id: "solid", label: "Solid", href: "solid.html" },
    { id: "hyper", label: "Hyper", href: "hyper.html" },
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
      id: "rubix",
      label: "Rubix Cube Sequencer",
      href: "rubix.html",
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
      id: "linear-drums-machine",
      label: "Rattle Snake Boogie",
      href: "linear-drums-machine.html",
    },
  ]),
  freezeGroup("signal-voice", "Signal & Voice", [
    {
      id: "image-to-instrument-3",
      label: "Wheel of Organs",
      href: "image-to-instrument-3.html",
    },
    { id: "lumber", label: "Lumber Loops", href: "lumber.html" },
    { id: "micmic", label: "L-mic", href: "l-mic.html" },
    { id: "graph-delay", label: "Graph Delay", href: "graph-delay.html" },
    { id: "throatazoid", label: "Throatazoid", href: "throatazoid.html" },
    {
      id: "spelling-synthesizer",
      label: "Spelling Synthesizer",
      href: "spelling-synthesizer.html",
    },
  ]),
  freezeGroup("barber-shop-poles", "Barber Shop Poles", [
    { id: "shepard-risset", label: "Shepard–Risset", href: "shepard-risset.html" },
    {
      id: "drum-roll-please",
      label: "Drum Roll Please!",
      href: "drum-roll-please.html",
    },
    { id: "sandy-syrup-delay", label: "Sandy Syrup Delay", href: "sandy-syrup-delay.html" },
    {
      id: "striped-sludge-delay",
      label: "Striped Sludge Delay",
      href: "striped-sludge-delay.html",
    },
    { id: "candy-coil-delay", label: "Candy Coil Delay", href: "candy-coil-delay.html" },
  ]),
  freezeGroup("fractals-recursion", "Fractals & Recursion", [
    { id: "l-system", label: "L-System", href: "l-system.html" },
    { id: "recursion", label: "Recursion", href: "recursion.html" },
    { id: "julia", label: "Julia", href: "julia.html" },
  ]),
  freezeGroup("chaotic-synths", "Chaotic Synths", [
    { id: "recursive-fm", label: "Recursive FM", href: "recursive-fm.html" },
    { id: "recursive-pm", label: "Recursive PM", href: "recursive-pm.html" },
    { id: "chaotic-fm", label: "Chaotic FM", href: "chaotic-fm.html" },
    { id: "chaotic-pm", label: "Chaotic PM", href: "chaotic-pm.html" },
    { id: "cascading-fm", label: "Cascading FM", href: "cascading-fm.html" },
    { id: "cascading-pm", label: "Cascading PM", href: "cascading-pm.html" },
    { id: "weierstrass", label: "Weierstrass", href: "weierstrass.html" },
    { id: "plasma-ball", label: "Plasma Ball", href: "plasma-ball.html" },
  ]),
  freezeGroup("webgpu-synths", "WebGPU Synths", [
    { id: "webgpu-303", label: "WebGPU 303", href: "webgpu-303.html" },
  ]),
  freezeGroup("instruments", "Instruments", [
    { id: "fm-drums", label: "FM Drums", href: "fm-drums.html" },
    { id: "linear-drums", label: "Rattlesnake", href: "linear-drums.html" },
    { id: "sample-drums", label: "Sample Drums", href: "sample-drums.html" },
  ]),
  freezeGroup("algorithmic-sequencers", "Algorithmic Sequencers", [
    { id: "sorting-algorithms", label: "Sorting", href: "algorithmic-sequencers.html" },
    { id: "dijkstra", label: "DJ Dijkstra", href: "dijkstra.html" },
    { id: "hanoi", label: "Hanoi Carillon", href: "hanoi.html" },
    { id: "minimax", label: "Alpha-Beta Minimax", href: "minimax.html" },
    { id: "nqueens", label: "N-Queens Backtracker", href: "nqueens.html" },
    { id: "euclid", label: "Euclidean Pulse", href: "euclid.html" },
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
    {
      id: "escher-tessellation",
      label: "Escher",
      href: "escher-tessellation.html",
    },
    { id: "order-tones", label: "Order Tones", href: "order-tones.html" },
    {
      id: "morphazoidical",
      label: "Morphazoidical",
      href: "morphazoidical/",
      match: "directory",
    },
    { id: "bell-square", label: "Bell Square", href: "bell-square.html" },
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
      label: "Cellular Automata",
      href: "cellular-automata.html",
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
const pickerGroups = () => TOOL_GROUPS.filter((group) => group.picker !== false);

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
  const list = element(doc, "div", "instrument-picker-list");
  list.setAttribute("aria-label", "Morphazoid instruments");

  for (const group of pickerGroups()) {
    const section = element(doc, "section", "instrument-picker-group");
    const heading = element(doc, "h2", "instrument-picker-group-title", group.label);
    heading.id = `instrument-picker-group-${index}-${group.id}`;
    section.setAttribute("aria-labelledby", heading.id);
    section.append(heading);

    for (const tool of group.tools) {
      const row = element(doc, "div", "instrument-picker-row");
      const link = element(doc, "a", "instrument-picker-link");
      link.setAttribute("href", new URL(tool.href, siteRoot).href);
      link.setAttribute("data-tool-id", tool.id);
      link.setAttribute("title", tool.label);
      const icon = element(doc, "img", "instrument-picker-link-icon");
      icon.alt = "";
      icon.width = 24;
      icon.height = 24;
      icon.decoding = "async";
      icon.src = new URL(`assets/instruments/${tool.id}.webp`, siteRoot).href;
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
    }
    list.append(section);
  }

  panel.append(list);
  details.append(summary, panel);
  details.addEventListener?.("keydown", (event) => {
    if (event.key !== "Escape" || !details.open) return;
    event.preventDefault?.();
    details.open = false;
    summary.focus?.();
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
  ".analysis-rail",
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
  traits.setAttribute("aria-label", `${instrument.label} type and inputs`);
  for (const trait of [instrument.kind, ...instrument.features]) {
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
  for (const button of doc?.querySelectorAll?.(".audio-button") ?? []) {
    let icon = button.querySelector?.(".audio-speaker-icon");
    if (!icon) {
      icon = element(doc, "span", "audio-speaker-icon");
      icon.setAttribute?.("aria-hidden", "true");
      button.insertBefore?.(icon, button.children?.[0] ?? null);
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

function midiInputSummary(status) {
  if (!status.supported) return "Web MIDI is unavailable in this browser.";
  if (!status.enabled) return "Off · computer keys and hardware MIDI are inactive.";
  const sources = [];
  if (status.computerKeyboard?.active) sources.push("computer keys ready");
  if (status.enabling) sources.push("waiting for hardware MIDI permission…");
  if (status.hardwareError) sources.push(`hardware MIDI: ${status.hardwareError}`);
  const names = status.inputs.map((input) => {
    const name = input.name || input.manufacturer || "MIDI input";
    return input.profileLabel ? `${name} — ${input.profileLabel}` : name;
  });
  sources.push(...names);
  if (
    status.webMidiSupported
    && !status.enabling
    && !status.hardwareError
    && names.length === 0
  ) sources.push("no hardware inputs connected");
  return `On · ${sources.join(" · ") || "ready"}`;
}

function computerKeyboardPresentation(status) {
  const clients = status.computerKeyboard?.clients ?? [];
  const layouts = new Set(clients.map(({ layout }) => layout));
  if (layouts.size === 0) return null;
  if (layouts.size === 1 && layouts.has("pad-grid")) {
    return { compact: "Pads", spoken: "pads", kind: "pad-grid" };
  }
  if (layouts.size === 1 && layouts.has("piano")) {
    return { compact: "Piano", spoken: "piano", kind: "piano" };
  }
  return { compact: "Mixed", spoken: "piano and pads", kind: "mixed" };
}

function effectiveComputerKeyboardVelocity(status, clients) {
  const sharedVelocity = Number(status.computerKeyboard?.velocity)
    || COMPUTER_KEYBOARD_DEFAULTS.velocity;
  const values = clients.map((client) => Math.max(1, Math.min(
    127,
    Math.round(
      Number(client.velocity ?? COMPUTER_KEYBOARD_DEFAULTS.velocity)
      + sharedVelocity
      - COMPUTER_KEYBOARD_DEFAULTS.velocity,
    ),
  )));
  if (values.length === 0) return sharedVelocity;
  const unique = [...new Set(values)].sort((left, right) => left - right);
  return unique.length === 1 ? unique[0] : `${unique[0]}–${unique.at(-1)}`;
}

function computerKeyboardHint(status) {
  const clients = status.computerKeyboard?.clients ?? [];
  const presentation = computerKeyboardPresentation(status);
  if (!presentation) {
    const universalId = status.clientIds?.find((id) => String(id).startsWith("browser-universal:"));
    const routeId = String(universalId || "").slice("browser-universal:".length);
    const keyboardMode = instrumentMidiCapabilityForId(routeId)?.computerKeyboardMode;
    if (keyboardMode === "page") {
      return status.webMidiSupported
        ? "This instrument reserves typing keys for its own interface. Hardware MIDI remains available when MIDI is on."
        : "This instrument reserves typing keys for its own interface, and Web MIDI is unavailable in this browser.";
    }
    if (keyboardMode === "none") {
      return status.webMidiSupported
        ? "Computer note keys are disabled because this page has no safe universal note action. Hardware MIDI can still control labeled parameters."
        : "This page has no safe computer-note mapping, and Web MIDI is unavailable in this browser.";
    }
    return "Computer keyboard input is disabled for this instrument.";
  }
  const octave = status.computerKeyboard?.octave ?? 0;
  const velocity = effectiveComputerKeyboardVelocity(status, clients);
  const tuning = `Octave ${octave >= 0 ? "+" : ""}${octave} · velocity ${velocity}`;
  if (presentation.kind === "pad-grid") {
    return `Computer pads · 1 2 3 4 / Q W E R / A S D F / Z X C V. [ ] octave · - / = velocity. ${tuning}.`;
  }
  if (presentation.kind === "mixed") {
    return `Computer piano + pads · piano uses Z–M and Q–U; pads use 1–4 / Q–R / A–F / Z–V. [ ] octave · - / = velocity. ${tuning}.`;
  }
  return `Computer piano · Z S X D C V G B H N J M / Q 2 W 3 E R 5 T 6 Y 7 U. Q is C4. [ ] octave · - / = velocity. ${tuning}.`;
}

function midiProfileHint(status, selectedProfile) {
  if (selectedProfile.id !== "auto") {
    return selectedProfile.setupHint || selectedProfile.description;
  }
  if (status.inputs.length === 0) return "";
  const resolved = [...new Set(status.inputs.map(({ profileId }) => profileId))]
    .map((profileId) => MIDI_PROFILE_REGISTRY[profileId])
    .filter(Boolean);
  if (resolved.length === 0) return "";
  return resolved.map((profile) => (
    `${profile.shortLabel}: ${profile.setupHint || profile.description}`
  )).join(" ");
}

function headerSettingsSection(doc, id, title, description = "") {
  const section = element(doc, "section", "header-settings-section");
  const heading = element(doc, "h3", "header-settings-section-title", title);
  heading.id = id;
  section.setAttribute("aria-labelledby", id);
  section.append(heading);
  if (description) section.append(element(doc, "p", "header-settings-copy", description));
  return section;
}

function outputDeviceId(device) {
  return String(device?.deviceId ?? device?.id ?? "").trim();
}

function outputDeviceLabel(device) {
  return String(device?.label ?? device?.name ?? "Audio output").trim() || "Audio output";
}

function audioOutputDescription(status, runtime) {
  const output = status?.output ?? {};
  if (runtime?.MorphazoidWAX || output.mode === "wax-host") {
    return "DAW track (host controlled). The meter shows signal sent toward the host, not speaker loudness.";
  }
  if (output.mode === "browser-selectable") {
    return `${output.label || "System default"} · selected by this browser. The meter shows signal sent toward the output, not speaker loudness.`;
  }
  if (output.mode === "system-default") {
    return "System default (browser controlled). This browser cannot choose an output device here.";
  }
  return "Audio output becomes available after this instrument creates an audio connection.";
}

function midiOutputDescription(status, capability, runtime) {
  const outputs = status?.outputs ?? [];
  const detected = outputs.length === 0
    ? "No browser MIDI destinations detected."
    : `${outputs.length} browser MIDI destination${outputs.length === 1 ? "" : "s"} detected${status.selectedOutput?.name ? `; available: ${status.selectedOutput.name}` : ""}.`;
  if (!capability?.midiOutput) {
    return "Unavailable for this instrument. Incoming MIDI is never echoed.";
  }
  if (runtime?.MorphazoidWAX) {
    return `DAW / plug-in host routing where supported. ${detected} MIDI Thru is off.`;
  }
  return `Off · this page is classified for future event output, but browser MIDI Out is not enabled here yet. ${detected} MIDI Thru is off.`;
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
  const toolbar = element(doc, "div", "midi-toolbar");
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "MIDI and computer keyboard controls");
  toolbar.hidden = true;

  const toggle = element(doc, "button", "midi-toggle");
  toggle.type = "button";
  toggle.id = `sharedMidiToggle${suffix}`;
  toggle.setAttribute("aria-pressed", "false");
  toggle.setAttribute("aria-label", "Turn MIDI input on");
  toggle.setAttribute("title", "MIDI input off");
  const dot = element(doc, "span", "midi-status-dot");
  dot.setAttribute("aria-hidden", "true");
  const toggleTitle = element(doc, "b", "", "MIDI");
  const toggleState = element(doc, "small", "", "off");
  const activityLight = element(doc, "span", "midi-activity-light");
  activityLight.setAttribute("aria-hidden", "true");
  toggle.append(dot, toggleTitle, toggleState, activityLight);

  const meterShell = element(doc, "div", "header-output-meter-shell");
  meterShell.setAttribute("title", "Audio output signal");
  meterShell.hidden = true;
  const meter = element(doc, "meter", "header-output-meter", "0%");
  meter.min = 0;
  meter.max = 1;
  meter.low = 0.18;
  meter.high = 0.72;
  meter.optimum = 0.5;
  meter.value = 0;
  meter.setAttribute("min", "0");
  meter.setAttribute("max", "1");
  meter.setAttribute("value", "0");
  meter.setAttribute("aria-label", "Audio output signal level");
  meter.setAttribute("aria-valuetext", "No output signal");
  meterShell.append(meter);

  const details = element(doc, "details", "header-settings-menu");
  details.hidden = true;
  const summary = element(doc, "summary", "header-settings-trigger");
  summary.setAttribute("aria-label", "Open input, output, and MIDI settings");
  summary.setAttribute("title", "Settings");
  summary.setAttribute("aria-controls", `headerSettingsPanel${suffix}`);
  const settingsIcon = element(doc, "span", "header-settings-icon");
  settingsIcon.setAttribute("aria-hidden", "true");
  summary.append(settingsIcon);

  const panel = element(doc, "div", "header-settings-panel");
  panel.id = `headerSettingsPanel${suffix}`;
  const heading = element(doc, "div", "header-settings-heading");
  heading.append(
    element(doc, "h2", "", "Input & output settings"),
    element(doc, "span", "", runtime?.MorphazoidWAX ? "WAX / host" : "Browser"),
  );

  const audioOutSection = headerSettingsSection(
    doc,
    `headerSettingsAudioOut${suffix}`,
    "Audio Out",
  );
  const audioOutputStatus = element(doc, "p", "header-settings-copy", "System default");
  audioOutputStatus.setAttribute("aria-live", "polite");
  const audioOutputField = element(doc, "label", "header-settings-field");
  audioOutputField.append(element(doc, "span", "", "Output device"));
  const audioOutputSelect = element(doc, "select", "audio-output-select");
  audioOutputSelect.id = `audioOutputSelect${suffix}`;
  audioOutputSelect.setAttribute("aria-label", "Audio output device");
  const initialAudioOption = element(doc, "option", "", "System default");
  initialAudioOption.value = "";
  audioOutputSelect.append(initialAudioOption);
  audioOutputField.append(audioOutputSelect);
  audioOutputField.hidden = true;
  const audioOutputError = element(doc, "p", "header-settings-error");
  audioOutputError.setAttribute("role", "alert");
  audioOutputError.hidden = true;
  audioOutSection.append(audioOutputStatus, audioOutputField, audioOutputError);

  const audioInputSection = headerSettingsSection(
    doc,
    `headerSettingsAudioInput${suffix}`,
    "Mic / Audio In",
    capability?.audioInput
      ? runtime?.MorphazoidWAX
        ? "DAW / host audio input where this instrument supports it. Use the page controls to monitor or process input."
        : "Use this instrument’s microphone or input controls. Browser permission is requested there when input starts."
      : "This instrument does not request microphone or audio input.",
  );

  const midiInSection = headerSettingsSection(
    doc,
    `headerSettingsMidiIn${suffix}`,
    "MIDI In",
  );
  const keyboardHint = element(doc, "p", "midi-keyboard-hint");
  const statusLine = element(doc, "p", "midi-profile-status", "MIDI off");
  statusLine.id = `sharedMidiStatus${suffix}`;
  statusLine.setAttribute("aria-live", "polite");
  midiInSection.append(statusLine, keyboardHint);

  const midiOutSection = headerSettingsSection(
    doc,
    `headerSettingsMidiOut${suffix}`,
    "MIDI Out",
  );
  const midiOutputField = element(doc, "label", "header-settings-field");
  midiOutputField.append(element(doc, "span", "", "Output route"));
  const midiOutputSelect = element(doc, "select", "midi-output-select");
  midiOutputSelect.id = `midiOutputSelect${suffix}`;
  midiOutputSelect.setAttribute("aria-label", "MIDI output route");
  midiOutputSelect.disabled = true;
  const midiOutputOption = element(
    doc,
    "option",
    "",
    !capability?.midiOutput
      ? "Unavailable on this instrument"
      : runtime?.MorphazoidWAX ? "DAW / plug-in host" : "Off (not enabled yet)",
  );
  midiOutputOption.value = "";
  midiOutputSelect.append(midiOutputOption);
  midiOutputField.append(midiOutputSelect);
  const midiOutputStatus = element(doc, "p", "header-settings-copy");
  midiOutSection.append(midiOutputField, midiOutputStatus);

  const midiMapSection = headerSettingsSection(
    doc,
    `headerSettingsMidiMap${suffix}`,
    "MIDI Map",
    "Computer keys + hardware controllers · no SysEx",
  );
  const field = element(doc, "label", "midi-profile-field");
  field.append(element(doc, "span", "", "Controller profile"));
  const select = element(doc, "select", "");
  select.id = `midiProfileSelect${suffix}`;
  select.setAttribute("aria-label", "MIDI controller profile");
  for (const profile of MIDI_PROFILES) {
    const option = element(doc, "option", "", profile.label);
    option.value = profile.id;
    select.append(option);
  }
  field.append(select);
  const hint = element(doc, "p", "midi-profile-hint");
  const guide = element(doc, "a", "midi-profile-guide", "MIDI guide");
  guide.setAttribute("href", new URL("index.html#midi", NAVIGATION_BASE_URL).href);
  const error = element(doc, "p", "midi-profile-error");
  error.id = `sharedMidiError${suffix}`;
  error.setAttribute("role", "alert");
  error.hidden = true;
  midiMapSection.append(field, hint, guide, error);
  panel.append(
    heading,
    audioOutSection,
    audioInputSection,
    midiInSection,
    midiOutSection,
    midiMapSection,
  );
  details.append(summary, panel);
  toolbar.append(toggle);

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
    const profile = MIDI_PROFILE_REGISTRY[status.selectedProfileId] ?? MIDI_PROFILE_REGISTRY.auto;
    keyboardHint.textContent = computerKeyboardHint(status);
    statusLine.textContent = midiInputSummary(status);
    midiOutputStatus.textContent = midiOutputDescription(status, capability, runtime);
    hint.textContent = midiProfileHint(status, profile);
    hint.hidden = !hint.textContent;
    if (!status.enabled) toolbar.classList.remove("is-receiving");
    if (status.enabled) {
      toolbar.classList.remove("is-error");
      error.textContent = "";
      error.hidden = true;
    }
  };

  const unsubscribe = manager.subscribeStatus(paint);
  const paintAudioOutput = (status = {}) => {
    const value = Math.max(0, Math.min(1, Number(status.peak ?? status.rms) || 0));
    const percentage = Math.round(value * 100);
    meter.value = value;
    meter.setAttribute("value", String(value));
    meter.setAttribute(
      "aria-valuetext",
      status.active ? `${percentage}% output signal` : "No output signal",
    );
    meterShell.title = status.active
      ? `Audio output signal ${percentage}%`
      : "Audio output signal · inactive";
    if (status.active || value > 0) meterShell.classList.add("is-active");
    else meterShell.classList.remove("is-active");
    audioOutputStatus.textContent = audioOutputDescription(status, runtime);
    const canSelect = Boolean(
      status.output?.canSelect
      && typeof audioOutputManager?.setOutputDevice === "function"
      && typeof audioOutputManager?.listOutputDevices === "function",
    );
    audioOutputField.hidden = !canSelect;
    audioOutputSelect.disabled = !canSelect;
    if (canSelect && status.output?.selectedId != null) {
      audioOutputSelect.value = String(status.output.selectedId);
    }
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
      const options = [];
      const systemDefault = element(doc, "option", "", "System default");
      systemDefault.value = "";
      options.push(systemDefault);
      for (const device of devices ?? []) {
        const id = outputDeviceId(device);
        if (!id) continue;
        const option = element(doc, "option", "", outputDeviceLabel(device));
        option.value = id;
        options.push(option);
      }
      audioOutputSelect.replaceChildren(...options);
      audioOutputSelect.value = String(output.selectedId ?? options[0]?.value ?? "");
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
      audioOutputSelect.disabled = false;
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
    toggle.removeEventListener?.("click", handleToggle);
    select.removeEventListener?.("change", handleProfileChange);
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
    meterShell,
    audioOutputSelect,
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

  const groups = pickerGroups().map((group) => {
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

  installBrowserMidiAdapter(runtime, doc, { routeId: navigation.activeTool?.id });
  if (navigation.activeTool) {
    initializeMidiToolbars(doc, runtime, getSharedMidiManager(runtime), {
      routeId: navigation.activeTool.id,
    });
  }

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

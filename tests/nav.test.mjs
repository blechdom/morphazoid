import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FAVE_TOOL_IDS,
  SITE_LINKS,
  TOOL_GROUPS,
  enhanceSharedNavigation,
  hydrateInstrumentPickers,
  initializeAudioTransportContract,
  initializeMidiToolbars,
  initializeSharedNavigation,
  normalizeNavigationPath,
  normalizeAudioButtonIcons,
  resolveActiveSiteLink,
  resolveActiveTool,
} from "../nav.js";
import {
  MIDI_PROFILES,
  WebMidiManager,
} from "../src/midi-manager.js";

const SITE_ROOT = "https://example.test/blechdom/morphazoid/";

function expectedBasePickerGroups() {
  return TOOL_GROUPS.flatMap((group) => {
    const tools = group.tools.filter((tool) => (
      group.picker !== false || tool.picker === true
    ));
    return tools.length > 0 ? [{ ...group, tools }] : [];
  });
}

function expectedPickerGroups() {
  const groups = expectedBasePickerGroups();
  const toolById = new Map(groups.flatMap(({ tools }) => (
    tools.map((tool) => [tool.id, tool])
  )));
  return [
    {
      id: "faves",
      label: "Faves",
      tools: FAVE_TOOL_IDS.map((id) => toolById.get(id)).filter(Boolean),
    },
    ...groups,
  ];
}

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  values() {
    return new Set(this.owner.className.split(/\s+/).filter(Boolean));
  }

  add(...tokens) {
    const values = this.values();
    tokens.forEach((token) => values.add(token));
    this.owner.className = [...values].join(" ");
  }

  remove(...tokens) {
    const values = this.values();
    tokens.forEach((token) => values.delete(token));
    this.owner.className = [...values].join(" ");
  }

  contains(token) {
    return this.values().has(token);
  }
}

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.textContent = "";
    this.open = false;
    this.selected = false;
    this.value = "";
    this.focused = false;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) {
        node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  insertBefore(node, reference) {
    if (node.parentNode) {
      node.parentNode.children = node.parentNode.children.filter((child) => child !== node);
    }
    const index = this.children.indexOf(reference);
    if (index < 0) {
      this.append(node);
      return;
    }
    node.parentNode = this;
    this.children.splice(index, 0, node);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  contains(target) {
    return this === target || this.children.some((child) => child.contains(target));
  }

  focus() {
    this.focused = true;
  }

  querySelector(selector) {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.findAll((node) => node.classList.contains(className))[0] ?? null;
    }
    if (selector.startsWith("#")) {
      const id = selector.slice(1);
      return this.findAll((node) => node.id === id)[0] ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.findAll((node) => node.classList.contains(className));
    }
    return [];
  }

  findAll(predicate) {
    const matches = predicate(this) ? [this] : [];
    for (const child of this.children) matches.push(...child.findAll(predicate));
    return matches;
  }
}

class FakeDocument {
  constructor() {
    this.baseURI = `${SITE_ROOT}julia.html`;
    this.tabs = new FakeNode("nav");
    this.tabs.className = "tabs";
    this.panel = new FakeNode("aside");
    this.panel.className = "panel";
    this.select = new FakeNode("select");
    this.select.className = "mobile-instrument-select";
    this.listeners = new Map();
  }

  createElement(tagName) {
    return new FakeNode(tagName);
  }

  querySelector(selector) {
    if (selector === ".panel") return this.panel;
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return [this.tabs, this.panel]
        .flatMap((node) => node.findAll((candidate) => candidate.classList.contains(className)))[0]
        ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === ".tabs") return [this.tabs];
    if (selector === ".mobile-instrument-select") return [this.select];
    if (selector === "[data-reset-all]") return [];
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return [this.tabs, this.panel]
        .flatMap((node) => node.findAll((candidate) => candidate.classList.contains(className)));
    }
    return [];
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

test("tool registry is categorized, unique, and includes Morphazoidical", () => {
  assert.deepEqual(
    TOOL_GROUPS.map((group) => group.label),
    [
      "Geometry Synths",
      "Drum Machines",
      "Sequencers",
      "Voice Synths",
      "Mic FX",
      "Barber Shop Poles",
      "Fractals & Recursion",
      "Chaotic Synths",
      "Misc",
      "Instruments",
      "Algorithmic Sequencers",
      "Experiments",
    ],
  );
  const tools = TOOL_GROUPS.flatMap((group) => group.tools);
  assert.equal(tools.length, 102);
  assert.equal(new Set(tools.map((tool) => tool.id)).size, tools.length);
  assert.equal(new Set(tools.map((tool) => tool.href)).size, tools.length);
  assert.equal(
    tools.every((tool) => !/^[a-z][a-z\d+.-]*:/i.test(tool.href)),
    true,
    "menu entries must stay inside Morphazoid",
  );
  assert.equal(
    tools.every((tool) => !Object.hasOwn(tool, "external")),
    true,
    "the menu registry must not introduce external destinations",
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "playhead-paint"),
    {
      id: "playhead-paint",
      label: "Playhead Paint",
      href: "playhead-paint.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "boidzoid"),
    {
      id: "boidzoid",
      label: "Boidzoid",
      href: "boidzoid.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "hyper-rubix"),
    {
      id: "hyper-rubix",
      label: "Hyper Rubix",
      href: "hyper-rubix.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "fm-drums"),
    {
      id: "fm-drums",
      label: "FM Drums",
      href: "fm-drums.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "linear-drums"),
    {
      id: "linear-drums",
      label: "Rattlesnake",
      href: "linear-drums.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "karplus-strong"),
    {
      id: "karplus-strong",
      label: "Karplus Strong",
      href: "karplus-strong.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "karplus-carpet"),
    {
      id: "karplus-carpet",
      label: "Karplus Carpet",
      href: "karplus-carpet.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "ouroborousel"),
    {
      id: "ouroborousel",
      label: "Ouroborousel",
      href: "ouroborousel.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "ouroboros"),
    {
      id: "ouroboros",
      label: "Ouroboros",
      href: "ouroboros.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "ouroboros-borealis"),
    {
      id: "ouroboros-borealis",
      label: "Ouroboros Borealis",
      href: "ouroboros-borealis.html",
    },
  );
  const barberShopTools = TOOL_GROUPS.find(({ id }) => (
    id === "barber-shop-poles"
  ))?.tools ?? [];
  assert.equal(
    barberShopTools.findIndex(({ id }) => id === "ouroborousel"),
    barberShopTools.findIndex(({ id }) => id === "drum-roll-please") + 1,
    "Ouroborousel belongs immediately after Drum Roll Please",
  );
  assert.equal(
    barberShopTools.findIndex(({ id }) => id === "ouroboros"),
    barberShopTools.findIndex(({ id }) => id === "ouroborousel") + 1,
    "Ouroboros belongs immediately after Ouroborousel",
  );
  assert.equal(
    barberShopTools.findIndex(({ id }) => id === "ouroboros-borealis"),
    barberShopTools.findIndex(({ id }) => id === "ouroboros") + 1,
    "Ouroboros Borealis belongs immediately after Ouroboros",
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "sample-drums"),
    {
      id: "sample-drums",
      label: "Sample Drums",
      href: "sample-drums.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "linear-drums-machine"),
    {
      id: "linear-drums-machine",
      label: "Rattle Snake Skin",
      href: "linear-drums-machine.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "gesturama"),
    {
      id: "gesturama",
      label: "Gesturama",
      href: "gesturama.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "shape-drums"),
    {
      id: "shape-drums",
      label: "Shape Drum Machine",
      href: "shape-drums.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "lattice-drums"),
    {
      id: "lattice-drums",
      label: "Lattice Drum Machine",
      href: "lattice-drums.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "spiral-drums"),
    {
      id: "spiral-drums",
      label: "Spiral Drum Machine",
      href: "spiral-drums.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "solid-drums"),
    {
      id: "solid-drums",
      label: "Solid Drum Machine",
      href: "solid-drums.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "rubix"),
    {
      id: "rubix",
      label: "Rubix Cube Sequencer",
      href: "rubix.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "hyper-drums"),
    {
      id: "hyper-drums",
      label: "Hyper Drum Machine",
      href: "hyper-drums.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "l-system-drums"),
    {
      id: "l-system-drums",
      label: "L-System Drum Machine",
      href: "l-system-drums.html",
    },
  );
  assert.equal(TOOL_GROUPS.some((group) => group.id === "physics-synths"), false);
  assert.equal(
    TOOL_GROUPS.flatMap(({ tools: groupTools }) => groupTools)
      .find(({ id }) => id === "escher-tessellation")?.label,
    "Escher",
  );
  assert.equal(
    TOOL_GROUPS.find(({ tools: groupTools }) => (
      groupTools.some(({ id }) => id === "escher-tessellation")
    ))?.id,
    "experiments",
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "geometry")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "shape", href: "shape.html" },
      { id: "lattice", href: "lattice.html" },
      { id: "spiral", href: "spiral.html" },
      { id: "solid", href: "solid.html" },
      { id: "hyper", href: "hyper.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "geometry-drums")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "shape-drums", href: "shape-drums.html" },
      { id: "lattice-drums", href: "lattice-drums.html" },
      { id: "spiral-drums", href: "spiral-drums.html" },
      { id: "solid-drums", href: "solid-drums.html" },
      { id: "hyper-drums", href: "hyper-drums.html" },
      { id: "l-system-drums", href: "l-system-drums.html" },
      { id: "linear-drums-machine", href: "linear-drums-machine.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "sequencers")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "rubix", href: "rubix.html" },
      { id: "hyper-rubix", href: "hyper-rubix.html" },
      { id: "webgpu-303", href: "webgpu-303.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "misc")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "playhead-paint", href: "playhead-paint.html" },
      { id: "boidzoid", href: "boidzoid.html" },
      { id: "gesturama", href: "gesturama.html" },
      { id: "image-to-instrument-3", href: "image-to-instrument-3.html" },
      { id: "orbital-ferris", href: "orbital-ferris.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "instruments")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "fm-drums", href: "fm-drums.html" },
      { id: "linear-drums", href: "linear-drums.html" },
      { id: "karplus-strong", href: "karplus-strong.html" },
      { id: "karplus-carpet", href: "karplus-carpet.html" },
      { id: "sample-drums", href: "sample-drums.html" },
    ],
  );
  assert.equal(TOOL_GROUPS.some((group) => group.id === "image-to-instrument"), false);
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "voice-synths")?.tools.map(
      ({ id, label, href }) => ({ id, label, href }),
    ),
    [
      { id: "throatazoid", label: "Throatazoid", href: "throatazoid.html" },
      {
        id: "pink-trombonazoid",
        label: "Pink Trombonazoid",
        href: "pink-trombonazoid.html",
      },
      { id: "syrinx", label: "Syrinx", href: "syrinx.html" },
      { id: "tongued-beasts", label: "Tongued Beasts", href: "tongued-beasts.html" },
      { id: "hybrinx", label: "Hybrinx", href: "hybrinx.html" },
      { id: "jaw-harp", label: "Jaw Harp", href: "jaw-harp.html" },
      {
        id: "spelling-synthesizer",
        label: "Spelling Synthesizer",
        href: "spelling-synthesizer.html",
      },
      { id: "vocalzoid", label: "Vocalzoid", href: "vocalzoid.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "mic-fx")?.tools.map(
      ({ id, label, href }) => ({ id, label, href }),
    ),
    [
      { id: "lumber", label: "Lumber Loops", href: "lumber.html" },
      { id: "micmic", label: "L-system Delay", href: "l-mic.html" },
      { id: "graph-delay", label: "Graph Delay", href: "graph-delay.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "algorithmic-sequencers")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "sorting-algorithms", href: "algorithmic-sequencers.html" },
      { id: "dijkstra", href: "dijkstra.html" },
    ],
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "sorting-algorithms"),
    {
      id: "sorting-algorithms",
      label: "Sorting",
      href: "algorithmic-sequencers.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "dijkstra"),
    {
      id: "dijkstra",
      label: "DJ Dijkstra",
      href: "dijkstra.html",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "morphazoidical"),
    {
      id: "morphazoidical",
      label: "Morphazoidical",
      href: "morphazoidical/",
      match: "directory",
    },
  );
  assert.deepEqual(
    tools.find((tool) => tool.id === "micmic"),
    {
      id: "micmic",
      label: "L-system Delay",
      href: "l-mic.html",
    },
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "barber-shop-poles")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "shepard-risset", href: "shepard-risset.html" },
      { id: "drum-roll-please", href: "drum-roll-please.html" },
      { id: "ouroborousel", href: "ouroborousel.html" },
      { id: "ouroboros", href: "ouroboros.html" },
      { id: "ouroboros-borealis", href: "ouroboros-borealis.html" },
      { id: "sandy-syrup-delay", href: "sandy-syrup-delay.html" },
      { id: "candy-coil-delay", href: "candy-coil-delay.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "chaotic-synths")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "recursive-fm", href: "recursive-fm.html" },
      { id: "recursive-pm", href: "recursive-pm.html" },
      { id: "chaotic-fm", href: "chaotic-fm.html" },
      { id: "chaotic-pm", href: "chaotic-pm.html" },
      { id: "cascading-fm", href: "cascading-fm.html" },
      { id: "cascading-pm", href: "cascading-pm.html" },
      { id: "weierstrass", href: "weierstrass.html" },
    ],
  );
  assert.equal(TOOL_GROUPS.some((group) => group.id === "webgpu-synths"), false);
  assert.deepEqual(
    tools.find((tool) => tool.id === "webgpu-303"),
    {
      id: "webgpu-303",
      label: "WebGPU 303",
      href: "webgpu-303.html",
    },
  );
  const experiments = TOOL_GROUPS.find((group) => group.id === "experiments");
  assert.equal(experiments?.picker, false);
  assert.equal(experiments?.tools.some(({ id }) => id === "plasma-ball"), true);
  assert.deepEqual(experiments?.tools.slice(0, 4), [
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
  ]);
  assert.deepEqual(
    experiments?.tools.map(({ id, href }) => ({ id, href })),
    [
      { id: "room-lobby", href: "music-rooms.html" },
      { id: "vocal-effects-room", href: "vocal-effects-room.html" },
      { id: "instrument-share-room", href: "instrument-share-room.html" },
      { id: "morphazoid-roulette", href: "morphazoid-roulette.html" },
      { id: "hanoi", href: "hanoi.html" },
      { id: "minimax", href: "minimax.html" },
      { id: "nqueens", href: "nqueens.html" },
      { id: "euclid", href: "euclid.html" },
      { id: "alien-larynx", href: "alien-larynx.html" },
      { id: "hyper-syrinx", href: "hyper-syrinx.html" },
      { id: "morphynx", href: "morphynx.html" },
      { id: "escher-tessellation", href: "escher-tessellation.html" },
      { id: "plasma-ball", href: "plasma-ball.html" },
      { id: "order-tones", href: "order-tones.html" },
      { id: "morphazoidical", href: "morphazoidical/" },
      { id: "bell-square", href: "bell-square.html" },
      { id: "entanglement-dance", href: "entanglement-dance.html" },
      { id: "quantum-square-dance", href: "quantum-square-dance.html" },
      { id: "annealogue", href: "annealogue.html" },
      { id: "gravity-walk", href: "gravity-walk.html" },
      { id: "ricochet", href: "ricochet.html" },
      { id: "rigidity", href: "rigidity.html" },
      { id: "rolling-measure", href: "rolling-measure.html" },
      { id: "falling-forms", href: "falling-forms.html" },
      { id: "charge-garden", href: "charge-garden.html" },
      { id: "packing-pressure", href: "packing-pressure.html" },
      { id: "geodesic-drift", href: "geodesic-drift.html" },
      { id: "kinetic-hull", href: "kinetic-hull.html" },
      { id: "moire-organ", href: "moire-organ.html" },
      { id: "chladni-plate", href: "chladni-plate.html" },
      { id: "spring-choir", href: "spring-choir.html" },
      { id: "gear-ratio-drums", href: "gear-ratio-drums.html" },
      { id: "cellular-automata", href: "automata.html" },
      { id: "prime-sieve", href: "prime-sieve.html" },
      { id: "lissajous-orbits", href: "lissajous-orbits.html" },
      { id: "pendulum-wave", href: "pendulum-wave.html" },
      { id: "double-pendulum", href: "double-pendulum.html" },
      { id: "reaction-diffusion", href: "reaction-diffusion.html" },
      { id: "atomic-orbitals", href: "atomic-orbitals.html" },
      { id: "dna-translator", href: "dna-translator.html" },
      { id: "neural-pulse", href: "neural-pulse.html" },
      { id: "fourier-epicycles", href: "fourier-epicycles.html" },
      { id: "gravity-lens", href: "gravity-lens.html" },
      { id: "cantor-lock", href: "cantor-lock.html" },
      { id: "escape-dust", href: "escape-dust.html" },
      { id: "linebreaker", href: "linebreaker.html" },
    ],
  );
  assert.deepEqual(SITE_LINKS, []);
});

test("every navigation tool ships a valid picker icon", async () => {
  const tools = TOOL_GROUPS.flatMap((group) => group.tools);
  await Promise.all(tools.map(async (tool) => {
    const imageUrl = new URL(`../assets/instruments/${tool.id}.webp`, import.meta.url);
    const bytes = await readFile(imageUrl);
    assert.ok(bytes.length > 1000, `${tool.id} picker icon is unexpectedly small`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", tool.id);
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", tool.id);
  }));
});

test("active tool resolution preserves GitHub Pages subpaths and nested workbench pages", () => {
  assert.equal(normalizeNavigationPath(`${SITE_ROOT}index.html?mode=test`, SITE_ROOT), "/blechdom/morphazoid/");
  assert.equal(resolveActiveTool("https://example.test/blechdom/morphazoid", SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink("https://example.test/blechdom/morphazoid", SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}shape.html`, SITE_ROOT)?.id, "shape");
  assert.equal(
    resolveActiveTool(`${SITE_ROOT}playhead-paint.html`, SITE_ROOT)?.id,
    "playhead-paint",
  );
  assert.equal(
    resolveActiveTool(`${SITE_ROOT}escher-tessellation.html`, SITE_ROOT)?.id,
    "escher-tessellation",
  );
  assert.equal(resolveActiveTool(`${SITE_ROOT}image-to-instrument-1.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}image-to-instrument-2.html`, SITE_ROOT), null);
  assert.equal(
    resolveActiveTool(`${SITE_ROOT}image-to-instrument-3.html`, SITE_ROOT)?.id,
    "image-to-instrument-3",
  );
  assert.equal(resolveActiveTool(`${SITE_ROOT}spiral.html#reader`, SITE_ROOT)?.id, "spiral");
  assert.equal(resolveActiveTool(`${SITE_ROOT}l-mic.html`, SITE_ROOT)?.id, "micmic");
  assert.equal(resolveActiveTool(`${SITE_ROOT}micmic.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}graph-delay.html`, SITE_ROOT)?.id, "graph-delay");
  assert.equal(
    resolveActiveTool(`${SITE_ROOT}pink-trombonazoid.html`, SITE_ROOT)?.id,
    "pink-trombonazoid",
  );
  assert.equal(resolveActiveTool(`${SITE_ROOT}alien-larynx.html`, SITE_ROOT)?.id, "alien-larynx");
  assert.equal(resolveActiveTool(`${SITE_ROOT}orbital-ferris.html`, SITE_ROOT)?.id, "orbital-ferris");
  assert.equal(resolveActiveTool(`${SITE_ROOT}audio-engine-lab.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}shepard-risset.html`, SITE_ROOT)?.id, "shepard-risset");
  assert.equal(resolveActiveTool(`${SITE_ROOT}drum-roll-please.html`, SITE_ROOT)?.id, "drum-roll-please");
  assert.equal(resolveActiveTool(`${SITE_ROOT}ouroborousel.html`, SITE_ROOT)?.id, "ouroborousel");
  assert.equal(resolveActiveTool(`${SITE_ROOT}ouroboros.html`, SITE_ROOT)?.id, "ouroboros");
  assert.equal(resolveActiveTool(`${SITE_ROOT}candy-coil-delay.html`, SITE_ROOT)?.id, "candy-coil-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}striped-sludge-delay.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}sandy-syrup-delay.html`, SITE_ROOT)?.id, "sandy-syrup-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}recursive-fm.html`, SITE_ROOT)?.id, "recursive-fm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}cascading-fm.html`, SITE_ROOT)?.id, "cascading-fm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}recursive-pm.html`, SITE_ROOT)?.id, "recursive-pm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}cascading-pm.html`, SITE_ROOT)?.id, "cascading-pm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}chaotic-fm.html`, SITE_ROOT)?.id, "chaotic-fm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}chaotic-pm.html`, SITE_ROOT)?.id, "chaotic-pm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}weierstrass.html`, SITE_ROOT)?.id, "weierstrass");
  assert.equal(resolveActiveTool(`${SITE_ROOT}webgpu-303.html`, SITE_ROOT)?.id, "webgpu-303");
  assert.equal(resolveActiveTool(`${SITE_ROOT}gravity-walk.html`, SITE_ROOT)?.id, "gravity-walk");
  assert.equal(resolveActiveTool(`${SITE_ROOT}ricochet.html`, SITE_ROOT)?.id, "ricochet");
  assert.equal(resolveActiveTool(`${SITE_ROOT}rigidity.html`, SITE_ROOT)?.id, "rigidity");
  assert.equal(resolveActiveTool(`${SITE_ROOT}rolling-measure.html`, SITE_ROOT)?.id, "rolling-measure");
  assert.equal(resolveActiveTool(`${SITE_ROOT}falling-forms.html`, SITE_ROOT)?.id, "falling-forms");
  assert.equal(resolveActiveTool(`${SITE_ROOT}charge-garden.html`, SITE_ROOT)?.id, "charge-garden");
  assert.equal(resolveActiveTool(`${SITE_ROOT}packing-pressure.html`, SITE_ROOT)?.id, "packing-pressure");
  assert.equal(resolveActiveTool(`${SITE_ROOT}geodesic-drift.html`, SITE_ROOT)?.id, "geodesic-drift");
  assert.equal(resolveActiveTool(`${SITE_ROOT}kinetic-hull.html`, SITE_ROOT)?.id, "kinetic-hull");
  assert.equal(resolveActiveTool(`${SITE_ROOT}order-tones.html`, SITE_ROOT)?.id, "order-tones");
  assert.equal(resolveActiveTool(`${SITE_ROOT}bell-square.html`, SITE_ROOT)?.id, "bell-square");
  assert.equal(
    resolveActiveTool(`${SITE_ROOT}quantum-square-dance.html`, SITE_ROOT)?.id,
    "quantum-square-dance",
  );
  assert.equal(resolveActiveTool(`${SITE_ROOT}annealogue.html`, SITE_ROOT)?.id, "annealogue");
  assert.equal(resolveActiveTool(`${SITE_ROOT}plasma-ball.html`, SITE_ROOT)?.id, "plasma-ball");
  assert.equal(resolveActiveTool(`${SITE_ROOT}moire-organ.html`, SITE_ROOT)?.id, "moire-organ");
  assert.equal(resolveActiveTool(`${SITE_ROOT}chladni-plate.html`, SITE_ROOT)?.id, "chladni-plate");
  assert.equal(resolveActiveTool(`${SITE_ROOT}spring-choir.html`, SITE_ROOT)?.id, "spring-choir");
  assert.equal(resolveActiveTool(`${SITE_ROOT}gear-ratio-drums.html`, SITE_ROOT)?.id, "gear-ratio-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}automata.html`, SITE_ROOT)?.id, "cellular-automata");
  assert.equal(resolveActiveTool(`${SITE_ROOT}prime-sieve.html`, SITE_ROOT)?.id, "prime-sieve");
  assert.equal(resolveActiveTool(`${SITE_ROOT}lissajous-orbits.html`, SITE_ROOT)?.id, "lissajous-orbits");
  assert.equal(resolveActiveTool(`${SITE_ROOT}pendulum-wave.html`, SITE_ROOT)?.id, "pendulum-wave");
  assert.equal(resolveActiveTool(`${SITE_ROOT}double-pendulum.html`, SITE_ROOT)?.id, "double-pendulum");
  assert.equal(resolveActiveTool(`${SITE_ROOT}reaction-diffusion.html`, SITE_ROOT)?.id, "reaction-diffusion");
  assert.equal(resolveActiveTool(`${SITE_ROOT}atomic-orbitals.html`, SITE_ROOT)?.id, "atomic-orbitals");
  assert.equal(resolveActiveTool(`${SITE_ROOT}dna-translator.html`, SITE_ROOT)?.id, "dna-translator");
  assert.equal(resolveActiveTool(`${SITE_ROOT}neural-pulse.html`, SITE_ROOT)?.id, "neural-pulse");
  assert.equal(resolveActiveTool(`${SITE_ROOT}fourier-epicycles.html`, SITE_ROOT)?.id, "fourier-epicycles");
  assert.equal(resolveActiveTool(`${SITE_ROOT}gravity-lens.html`, SITE_ROOT)?.id, "gravity-lens");
  assert.equal(resolveActiveTool(`${SITE_ROOT}cantor-lock.html`, SITE_ROOT)?.id, "cantor-lock");
  assert.equal(resolveActiveTool(`${SITE_ROOT}escape-dust.html`, SITE_ROOT)?.id, "escape-dust");
  assert.equal(resolveActiveTool(`${SITE_ROOT}linebreaker.html`, SITE_ROOT)?.id, "linebreaker");
  assert.equal(resolveActiveTool(`${SITE_ROOT}algorithmic-sequencers.html`, SITE_ROOT)?.id, "sorting-algorithms");
  assert.equal(resolveActiveTool(`${SITE_ROOT}music-rooms.html`, SITE_ROOT)?.id, "room-lobby");
  assert.equal(resolveActiveTool(`${SITE_ROOT}vocal-effects-room.html`, SITE_ROOT)?.id, "vocal-effects-room");
  assert.equal(resolveActiveTool(`${SITE_ROOT}instrument-share-room.html`, SITE_ROOT)?.id, "instrument-share-room");
  assert.equal(resolveActiveTool(`${SITE_ROOT}morphazoid-roulette.html`, SITE_ROOT)?.id, "morphazoid-roulette");
  assert.equal(resolveActiveTool(`${SITE_ROOT}dijkstra.html`, SITE_ROOT)?.id, "dijkstra");
  assert.equal(resolveActiveTool(`${SITE_ROOT}hanoi.html`, SITE_ROOT)?.id, "hanoi");
  assert.equal(resolveActiveTool(`${SITE_ROOT}minimax.html`, SITE_ROOT)?.id, "minimax");
  assert.equal(resolveActiveTool(`${SITE_ROOT}nqueens.html`, SITE_ROOT)?.id, "nqueens");
  assert.equal(resolveActiveTool(`${SITE_ROOT}euclid.html`, SITE_ROOT)?.id, "euclid");
  assert.equal(resolveActiveTool(`${SITE_ROOT}algorithmic-scores.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}fm-drums.html`, SITE_ROOT)?.id, "fm-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}linear-drums.html`, SITE_ROOT)?.id, "linear-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}karplus-strong.html`, SITE_ROOT)?.id, "karplus-strong");
  assert.equal(resolveActiveTool(`${SITE_ROOT}karplus-carpet.html`, SITE_ROOT)?.id, "karplus-carpet");
  assert.equal(
    resolveActiveTool(`${SITE_ROOT}linear-drums-machine.html`, SITE_ROOT)?.id,
    "linear-drums-machine",
  );
  assert.equal(resolveActiveTool(`${SITE_ROOT}sample-drums.html`, SITE_ROOT)?.id, "sample-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}gesturama.html`, SITE_ROOT)?.id, "gesturama");
  assert.equal(resolveActiveTool(`${SITE_ROOT}shape-drums.html`, SITE_ROOT)?.id, "shape-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}lattice-drums.html`, SITE_ROOT)?.id, "lattice-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}spiral-drums.html`, SITE_ROOT)?.id, "spiral-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}solid-drums.html`, SITE_ROOT)?.id, "solid-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}hyper-rubix.html`, SITE_ROOT)?.id, "hyper-rubix");
  assert.equal(resolveActiveTool(`${SITE_ROOT}rubix.html`, SITE_ROOT)?.id, "rubix");
  assert.equal(resolveActiveTool(`${SITE_ROOT}hyper-drums.html`, SITE_ROOT)?.id, "hyper-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}l-system-drums.html`, SITE_ROOT)?.id, "l-system-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}analyzer.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}morphazoidical/`, SITE_ROOT)?.id, "morphazoidical");
  assert.equal(resolveActiveTool(`${SITE_ROOT}morphazoidical/atlas.html`, SITE_ROOT)?.id, "morphazoidical");
  assert.equal(resolveActiveTool(`${SITE_ROOT}unknown.html`, SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}plugins.html`, SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}instruments.html`, SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}about.html`, SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}`, SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}julia.html`, SITE_ROOT), null);
});

test("shared navigation creates a searchable accordion picker and preserves the native select fallback", () => {
  const doc = new FakeDocument();
  const result = enhanceSharedNavigation(doc, {
    currentHref: `${SITE_ROOT}julia.html`,
    siteRoot: SITE_ROOT,
  });

  assert.equal(result.activeTool?.id, "julia");
  assert.equal(result.activeSiteLink, null);
  assert.equal(result.disclosures.length, 1);
  assert.equal(result.selectedInfos.length, 0);
  assert.equal(result.pageInfos.length, 1);
  assert.equal(doc.tabs.getAttribute("aria-label"), "Morphazoid main menu");
  assert.equal(doc.tabs.classList.contains("tools-nav"), true);
  assert.equal(doc.tabs.hidden, false);
  assert.equal(doc.tabs.children.length, 1);
  const picker = result.disclosures[0];
  assert.equal(picker.tagName, "DETAILS");
  assert.equal(picker.className, "instrument-picker");
  const trigger = picker.children[0];
  assert.equal(trigger.tagName, "SUMMARY");
  assert.equal(trigger.getAttribute("aria-label"), "Choose instrument. Current: Julia");
  assert.equal(
    trigger.findAll((node) => node.className === "instrument-picker-current")[0]?.textContent,
    "Julia",
  );
  assert.doesNotMatch(trigger.textContent, /Fractals|Recursion/);
  const pickerGroups = expectedPickerGroups();
  const basePickerGroups = expectedBasePickerGroups();
  const pickerTools = pickerGroups.flatMap((group) => group.tools);
  assert.equal(pickerGroups.some(({ id }) => id === "experiments"), false);
  assert.deepEqual(
    picker.findAll((node) => node.classList.contains("instrument-picker-group-title"))
      .map((heading) => heading.querySelector(".instrument-picker-group-label").textContent),
    pickerGroups.map((group) => group.label),
  );
  const groupNodes = picker.findAll(
    (node) => node.classList.contains("instrument-picker-group"),
  );
  assert.equal(groupNodes.every(({ tagName }) => tagName === "DETAILS"), true);
  assert.equal(groupNodes[0].getAttribute("data-group-id"), "faves");
  assert.equal(groupNodes[0].open, true);
  assert.equal(
    groupNodes.find((group) => group.getAttribute("data-group-id") === "fractals-recursion").open,
    true,
  );
  assert.deepEqual(
    groupNodes[0].findAll((node) => node.classList.contains("instrument-picker-link"))
      .map((link) => link.getAttribute("data-tool-id")),
    FAVE_TOOL_IDS,
  );
  const pickerLinks = picker.findAll(
    (node) => node.classList.contains("instrument-picker-link"),
  );
  assert.equal(pickerLinks.length, pickerTools.length);
  const shapeLink = pickerLinks.find((link) => link.getAttribute("data-tool-id") === "shape");
  const shapeIcon = shapeLink.querySelector(".instrument-picker-link-icon");
  assert.equal(shapeIcon.tagName, "IMG");
  assert.equal(shapeIcon.src, `${SITE_ROOT}assets/instruments/shape.webp`);
  assert.equal(shapeIcon.alt, "");
  assert.equal(shapeLink.querySelector(".instrument-picker-link-label").textContent, "Shape");
  assert.equal(
    picker.findAll((node) => node.classList.contains("instrument-picker-info")).length,
    0,
  );
  assert.equal(
    picker.findAll((node) => node.getAttribute("data-tool-id") === "escher-tessellation").length,
    0,
  );
  const orbitalFerrisLink = picker.findAll(
    (node) => node.getAttribute("data-tool-id") === "orbital-ferris",
  );
  assert.equal(orbitalFerrisLink.length, 1);
  assert.equal(
    orbitalFerrisLink[0].getAttribute("href"),
    `${SITE_ROOT}orbital-ferris.html`,
  );
  const searchInput = picker.querySelector(".instrument-picker-search-input");
  assert.equal(searchInput.type, "search");
  assert.equal(searchInput.placeholder, "Type an instrument");
  searchInput.value = "trombonazoid";
  searchInput.dispatch("input");
  assert.equal(groupNodes[0].hidden, true, "search suppresses duplicate Faves results");
  const voiceGroup = groupNodes.find(
    (group) => group.getAttribute("data-group-id") === "voice-synths",
  );
  assert.equal(voiceGroup.hidden, false);
  assert.equal(voiceGroup.open, true);
  assert.equal(
    voiceGroup.findAll((node) => node.getAttribute("data-tool-id") === "pink-trombonazoid")[0]
      .parentNode.hidden,
    false,
  );
  assert.equal(
    voiceGroup.findAll((node) => node.getAttribute("data-tool-id") === "throatazoid")[0]
      .parentNode.hidden,
    true,
  );
  searchInput.value = "not-an-instrument";
  searchInput.dispatch("input");
  assert.equal(picker.querySelector(".instrument-picker-empty").hidden, false);
  searchInput.value = "";
  searchInput.dispatch("input");
  assert.equal(groupNodes[0].hidden, false);
  assert.equal(groupNodes[0].open, true);
  const pageInfo = result.pageInfos[0];
  assert.equal(pageInfo.getAttribute("data-tool-id"), "julia");
  assert.equal(pageInfo.getAttribute("aria-label"), "About Julia");
  assert.equal(doc.panel.children.at(-1), pageInfo);
  assert.equal(doc.select.children.length, basePickerGroups.length);
  assert.deepEqual(
    doc.select.children.map((group) => group.label),
    basePickerGroups.map((group) => group.label),
  );
  const selectedOptions = doc.select.findAll((node) => node.tagName === "OPTION" && node.selected);
  const orbitalFerrisOption = doc.select.findAll(
    (node) => node.tagName === "OPTION" && node.textContent === "Feral Fairy Ferris Ferry",
  );
  assert.equal(orbitalFerrisOption.length, 1);
  assert.equal(orbitalFerrisOption[0].value, `${SITE_ROOT}orbital-ferris.html`);
  assert.equal(selectedOptions.length, 1);
  assert.equal(selectedOptions[0].textContent, "Julia");
  assert.doesNotMatch(selectedOptions[0].textContent, /Fractals|Recursion/);
  assert.equal(doc.select.getAttribute("aria-label"), "Instrument");
});

test("home navigation shows Choose in both enhanced and fallback controls", () => {
  const doc = new FakeDocument();
  const result = enhanceSharedNavigation(doc, {
    currentHref: SITE_ROOT,
    siteRoot: SITE_ROOT,
  });

  assert.equal(result.activeTool, null);
  assert.equal(result.activeSiteLink, null);
  assert.equal(result.selectedInfos.length, 0);
  assert.equal(result.pageInfos.length, 0);
  assert.equal(doc.tabs.children.length, 1);
  assert.equal(
    doc.tabs.findAll((node) => node.className === "instrument-picker-current")[0]?.textContent,
    "Choose",
  );
  assert.equal(
    doc.select.children.length,
    expectedBasePickerGroups().length + 1,
  );

  const selectedOptions = doc.select.findAll(
    (node) => node.tagName === "OPTION" && node.selected,
  );
  assert.equal(selectedOptions.length, 1);
  assert.equal(selectedOptions[0].textContent, "Choose");
  assert.equal(selectedOptions[0].disabled, true);
});

test("instrument info lives once at the bottom of the page control rail", () => {
  const doc = new FakeDocument();
  const { disclosures: [picker], pageInfos: [pageInfo] } = enhanceSharedNavigation(doc, {
    currentHref: `${SITE_ROOT}julia.html`,
    siteRoot: SITE_ROOT,
  });
  const instruments = [
    {
      id: "shape",
      label: "Shape",
      href: "shape.html",
      imageHref: "assets/instruments/shape.webp",
      tags: [{ id: "geometry", label: "Geometry Synths" }],
      kind: "Synth",
      features: ["MIDI"],
      description: "A geometric contour instrument.",
      start: "Turn on audio and move the contour.",
    },
    {
      id: "julia",
      label: "Julia",
      href: "julia.html",
      imageHref: "assets/instruments/julia.webp",
      tags: [{ id: "fractals-recursion", label: "Fractals & Recursion" }],
      kind: "Synth",
      features: [],
      description: "A Julia boundary instrument.",
      start: "Turn on audio and trace the boundary.",
    },
  ];

  hydrateInstrumentPickers(doc, instruments, SITE_ROOT);
  assert.equal(picker.querySelectorAll(".instrument-picker-info").length, 0);
  assert.equal(picker.querySelector(".instrument-picker-preview"), null);
  assert.equal(doc.tabs.querySelector(".selected-instrument-info"), null);
  assert.equal(pageInfo.hidden, false);
  assert.equal(pageInfo.getAttribute("data-preview-id"), "julia");
  assert.equal(
    pageInfo.findAll((node) => node.className === "instrument-picker-card-title")[0]?.textContent,
    "Julia",
  );
  assert.equal(
    pageInfo.findAll((node) => node.className === "instrument-picker-card-subtitle")[0]?.textContent,
    "Synth",
  );
  assert.deepEqual(
    pageInfo.querySelector(".instrument-picker-card-traits").children.map(
      ({ textContent }) => textContent,
    ),
    [],
  );
  assert.equal(
    pageInfo.findAll((node) => node.className === "instrument-picker-card-image")[0]?.src,
    `${SITE_ROOT}assets/instruments/julia.webp`,
  );
  assert.equal(pageInfo.querySelector(".instrument-picker-card-play"), null);
  assert.equal(doc.panel.children.at(-1), pageInfo);
});

test("custom instrument layouts can opt out of the shared catalog card", () => {
  const doc = new FakeDocument();
  doc.body = new FakeNode("body");
  doc.body.setAttribute("data-instrument-info", "off");
  const result = enhanceSharedNavigation(doc, {
    currentHref: `${SITE_ROOT}morphazoidical/`,
    siteRoot: SITE_ROOT,
  });
  assert.equal(result.activeTool?.id, "morphazoidical");
  assert.deepEqual(result.pageInfos, []);
  assert.equal(doc.panel.querySelector(".instrument-page-info"), null);
});

test("top Audio buttons expose icon-only accessible on/off speaker controls", async () => {
  const button = new FakeNode("button");
  button.className = "audio-button";
  button.setAttribute("aria-pressed", "false");
  const oldGlyph = new FakeNode("span");
  oldGlyph.className = "audio-glyph";
  const status = new FakeNode("small");
  status.id = "audioState";
  status.textContent = "off";
  button.append(oldGlyph, status);
  const customButton = new FakeNode("button");
  customButton.className = "audio-toggle";
  customButton.setAttribute("aria-pressed", "false");
  const customDot = new FakeNode("span");
  customDot.className = "audio-dot";
  const customStatus = new FakeNode("small");
  customStatus.id = "audioState";
  customStatus.textContent = "off";
  customButton.append(customDot, customStatus);
  const doc = {
    createElement(tagName) { return new FakeNode(tagName); },
    querySelectorAll(selector) {
      if (selector === ".audio-button") return [button];
      if (selector === ".audio-toggle") return [customButton];
      assert.fail(`Unexpected selector: ${selector}`);
    },
  };

  normalizeAudioButtonIcons(doc);
  const icon = button.children[0];
  assert.equal(icon.className, "audio-speaker-icon");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  assert.equal(button.getAttribute("data-audio-state"), "off");
  assert.equal(button.getAttribute("aria-label"), "Turn audio on");
  assert.equal(button.getAttribute("title"), "Audio off");
  assert.equal(button.querySelector(".audio-speaker-copy"), null);
  assert.equal(oldGlyph.getAttribute("aria-hidden"), "true");
  assert.equal(status.getAttribute("aria-hidden"), "true");
  assert.equal(
    customButton.querySelector(".audio-speaker-icon"),
    null,
    "the custom workbench keeps its single authored CSS speaker icon",
  );
  assert.equal(customButton.getAttribute("data-audio-icon-ready"), "true");
  assert.equal(customButton.getAttribute("data-audio-state"), "off");
  assert.equal(customButton.getAttribute("aria-label"), "Turn audio on");
  assert.equal(customButton.getAttribute("title"), "Audio off");
  assert.equal(customDot.getAttribute("aria-hidden"), "true");
  assert.equal(customStatus.getAttribute("aria-hidden"), "true");

  button.setAttribute("aria-pressed", "true");
  status.textContent = "on";
  normalizeAudioButtonIcons(doc);
  assert.equal(button.children.filter((child) => child.className === "audio-speaker-icon").length, 1);
  assert.equal(button.getAttribute("data-audio-state"), "on");
  assert.equal(button.getAttribute("aria-label"), "Turn audio off");
  assert.equal(button.getAttribute("title"), "Audio on");
  assert.equal(button.querySelector(".audio-speaker-copy"), null);

  customButton.setAttribute("aria-pressed", "true");
  customStatus.textContent = "on";
  normalizeAudioButtonIcons(doc);
  assert.equal(customButton.getAttribute("data-audio-state"), "on");
  assert.equal(customButton.getAttribute("aria-label"), "Turn audio off");
  assert.equal(customButton.getAttribute("title"), "Audio on");
  assert.equal(customButton.querySelector(".audio-speaker-icon"), null);

  const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /--audio-control-width:\s*44px/);
  assert.match(css, /\.audio-button\s*\{[^}]*width: var\(--audio-control-width\);[^}]*height: 44px;/s);
  assert.match(
    css,
    /\.audio-button > :not\(\.audio-speaker-icon\),\s*\.audio-speaker-copy\s*\{[^}]*position: absolute !important;[^}]*width: 1px !important;[^}]*clip-path: inset\(50%\) !important;/s,
    "authored Audio copy is visually hidden but remains available as the no-script accessible name",
  );
  assert.match(
    css,
    /\.audio-button::before,\s*\.audio-speaker-icon\s*\{[^}]*mask: url\("data:image\/svg\+xml/s,
    "a CSS speaker-off icon is present even before JavaScript normalization",
  );
  assert.doesNotMatch(css, /\.audio-button > :not\(\.audio-speaker-icon\)[^}]*display:\s*none/s);
  assert.match(css, /m16 9 6 6M22 9l-6 6/);
  assert.match(css, /\.audio-button\[aria-pressed="true"\]\s*\{[^}]*color: var\(--bg-deep\);[^}]*background: var\(--accent\);[^}]*box-shadow:/s);
  assert.match(
    css,
    /@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.audio-button,\s*#playButton,\s*\[data-primary-transport\]\s*\{[^}]*min-width:\s*48px;[^}]*min-height:\s*48px/s,
  );
});

test("shared Space transport stays independent from Audio and guides Audio-off playback", () => {
  const doc = new FakeDocument();
  const masthead = new FakeNode("header");
  masthead.className = "masthead";
  const audioButton = new FakeNode("button");
  audioButton.className = "audio-button";
  audioButton.setAttribute("aria-pressed", "false");
  const playButton = new FakeNode("button");
  playButton.id = "playButton";
  playButton.setAttribute("aria-pressed", "false");
  let playClicks = 0;
  playButton.click = () => {
    playClicks += 1;
    playButton.setAttribute(
      "aria-pressed",
      playButton.getAttribute("aria-pressed") === "true" ? "false" : "true",
    );
  };
  masthead.append(audioButton, playButton);

  const baseQuerySelector = doc.querySelector.bind(doc);
  const baseQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelector = (selector) => {
    if (selector === ".audio-button" || selector === "#audioButton") return audioButton;
    if (selector === "#playButton") return playButton;
    if (selector === ".masthead") return masthead;
    return baseQuerySelector(selector);
  };
  doc.querySelectorAll = (selector) => {
    if (selector === "[data-primary-transport]") return [];
    return baseQuerySelectorAll(selector);
  };
  const listenerOptions = [];
  const baseAddEventListener = doc.addEventListener.bind(doc);
  doc.addEventListener = (type, listener, options) => {
    listenerOptions.push([type, options]);
    baseAddEventListener(type, listener);
  };

  const runtime = { queueMicrotask(callback) { callback(); } };
  const contract = initializeAudioTransportContract(doc, runtime);
  assert.equal(contract.primaryTransport, playButton);
  assert.equal(playButton.getAttribute("aria-keyshortcuts"), "Space");
  assert.deepEqual(
    listenerOptions.filter(([type]) => type === "keydown"),
    [["keydown", true]],
    "exactly one capture-phase Space owner is installed",
  );
  assert.equal(initializeAudioTransportContract(doc, runtime), contract);
  assert.equal(doc.listeners.get("keydown").length, 1);
  assert.equal(contract.status.parentNode, masthead);
  assert.equal(contract.status.getAttribute("role"), "status");
  assert.equal(contract.status.getAttribute("aria-live"), "polite");
  assert.equal(contract.status.hidden, true);

  const surface = new FakeNode("main");
  let prevented = 0;
  let stopped = 0;
  doc.dispatch("keydown", {
    code: "Space",
    key: " ",
    target: surface,
    preventDefault() { prevented += 1; },
    stopImmediatePropagation() { stopped += 1; },
  });
  assert.equal(playClicks, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(playButton.getAttribute("aria-pressed"), "true");
  assert.equal(audioButton.getAttribute("aria-pressed"), "false");
  assert.equal(contract.status.hidden, false);
  assert.equal(contract.status.textContent, "Audio is off — turn it on to hear playback");
  assert.equal(audioButton.getAttribute("data-audio-attention"), "true");

  audioButton.setAttribute("aria-pressed", "true");
  doc.dispatch("click", { target: audioButton });
  assert.equal(contract.status.hidden, true);
  assert.equal(audioButton.getAttribute("data-audio-attention"), null);

  audioButton.setAttribute("aria-pressed", "false");
  contract.sync();
  assert.equal(contract.status.hidden, false, "an already-running silent transport stays explained");
  doc.dispatch("click", { target: playButton });
  playButton.setAttribute("aria-pressed", "false");
  contract.sync();
  assert.equal(contract.status.hidden, true);

  doc.dispatch("click", { target: playButton });
  assert.equal(contract.status.hidden, false, "a rejected Audio-off Play request gets guidance");
  doc.dispatch("click", { target: playButton });
  assert.equal(
    contract.status.hidden,
    false,
    "repeated rejected Play requests do not alternate the Audio-off guidance",
  );

  const ignoredTargets = [
    new FakeNode("input"),
    new FakeNode("select"),
    new FakeNode("textarea"),
    new FakeNode("button"),
    new FakeNode("summary"),
  ];
  const editable = new FakeNode("div");
  editable.setAttribute("contenteditable", "true");
  ignoredTargets.push(editable);
  const slider = new FakeNode("div");
  slider.setAttribute("role", "slider");
  ignoredTargets.push(slider);
  const nestedButton = new FakeNode("button");
  const nestedButtonIcon = new FakeNode("svg");
  nestedButton.append(nestedButtonIcon);
  ignoredTargets.push(nestedButtonIcon);

  for (const target of ignoredTargets) {
    let ignoredPrevented = false;
    let ignoredStopped = false;
    doc.dispatch("keydown", {
      code: "Space",
      key: " ",
      target,
      preventDefault() { ignoredPrevented = true; },
      stopImmediatePropagation() { ignoredStopped = true; },
    });
    assert.equal(ignoredPrevented, false, `${target.tagName} keeps its native Space behavior`);
    assert.equal(ignoredStopped, false, `${target.tagName} remains available to page handlers`);
  }

  for (const override of [
    { defaultPrevented: true },
    { repeat: true },
    { isComposing: true },
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
  ]) {
    let guardedPrevented = false;
    let guardedStopped = false;
    doc.dispatch("keydown", {
      code: "Space",
      key: " ",
      target: surface,
      ...override,
      preventDefault() { guardedPrevented = true; },
      stopImmediatePropagation() { guardedStopped = true; },
    });
    assert.equal(guardedPrevented, false, "guarded Space preserves the browser default");
    assert.equal(guardedStopped, true, "guarded Space cannot reach legacy transport handlers");
    assert.equal(playClicks, 1, "guarded Space never activates the transport");
  }

  playButton.disabled = true;
  let disabledPrevented = false;
  let disabledStopped = false;
  doc.dispatch("keydown", {
    code: "Space",
    target: surface,
    preventDefault() { disabledPrevented = true; },
    stopImmediatePropagation() { disabledStopped = true; },
  });
  assert.equal(disabledPrevented, false);
  assert.equal(disabledStopped, true, "disabled transports stay protected from legacy handlers");
  assert.equal(playClicks, 1);
  contract.destroy();
  assert.equal(doc.listeners.get("keydown").length, 0);
});

test("one header MIDI control owns connection and controller profile selection", async () => {
  const doc = new FakeDocument();
  const masthead = new FakeNode("header");
  masthead.className = "masthead";
  const audioStrip = new FakeNode("div");
  audioStrip.className = "audio-strip";
  const audioButton = new FakeNode("button");
  audioButton.className = "audio-button";
  const outputLevel = new FakeNode("label");
  outputLevel.className = "header-level";
  audioStrip.append(audioButton, outputLevel);
  masthead.append(audioStrip);
  const baseQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector) => (
    selector === ".masthead" ? [masthead] : baseQuerySelectorAll(selector)
  );

  const inputListeners = new Map();
  const input = {
    id: "keys",
    name: "Komplete Kontrol S49 MK2",
    manufacturer: "Native Instruments",
    state: "connected",
    addEventListener(type, listener) { inputListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (inputListeners.get(type) === listener) inputListeners.delete(type);
    },
  };
  const access = {
    inputs: new Map([[input.id, input]]),
    addEventListener() {},
    removeEventListener() {},
  };
  const requests = [];
  const stored = new Map();
  let pendingActivity = null;
  const runtime = {
    navigator: {
      async requestMIDIAccess(options) {
        requests.push(options);
        return access;
      },
    },
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, String(value)); },
    },
    addEventListener() {},
    setTimeout(callback) {
      pendingActivity = callback;
      return 1;
    },
    clearTimeout() {
      pendingActivity = null;
    },
  };
  const manager = new WebMidiManager(runtime);
  const [control] = initializeMidiToolbars(doc, runtime, manager);

  assert.equal(control.toolbar.hidden, true, "unmapped pages do not show a dead MIDI control");
  assert.equal(masthead.classList.contains("has-midi-toolbar"), false);
  assert.equal(control.select.children.length, MIDI_PROFILES.length);
  const messages = [];
  const unregisterClient = manager.registerClient({
    id: "browser-universal:test-instrument",
    onMessage: (message) => messages.push(message),
  });
  assert.equal(control.toolbar.hidden, false);
  assert.equal(control.meterShell.hidden, false);
  assert.equal(control.details.hidden, false);
  assert.equal(masthead.classList.contains("has-midi-toolbar"), true);
  const ioControls = masthead.children[0];
  assert.equal(ioControls.className, "header-io-controls");
  assert.deepEqual(
    ioControls.children,
    [control.toolbar, control.meterShell, audioStrip, control.details],
  );
  assert.deepEqual(audioStrip.children, [outputLevel, audioButton]);
  assert.equal(initializeMidiToolbars(doc, runtime, manager).length, 0);
  assert.equal(masthead.findAll((node) => node.className === "midi-toolbar").length, 1);

  await control.toggle.listeners.get("click")[0]();
  assert.deepEqual(requests, [{ sysex: false }]);
  assert.equal(control.toggle.getAttribute("aria-pressed"), "true");
  assert.equal(control.toggle.getAttribute("aria-controls"), null);
  assert.equal(manager.status().inputs[0].profileId, "ni-komplete-kontrol-s49-mk2");
  const settingsSummary = control.details.children[0];
  assert.equal(
    settingsSummary.getAttribute("aria-label"),
    "Morphazoid Settings",
  );
  assert.equal(settingsSummary.getAttribute("title"), "Morphazoid Settings");
  assert.equal(settingsSummary.children.length, 1);
  assert.equal(settingsSummary.children[0].className, "header-settings-icon");
  assert.equal(control.details.getAttribute("role"), null, "settings is a disclosure, not an ARIA menu");
  const settingsHeading = control.details.findAll(
    (node) => node.className === "header-settings-heading",
  )[0];
  assert.equal(settingsHeading.children.length, 1);
  assert.equal(settingsHeading.children[0].textContent, "Morphazoid Settings");
  const settingsRows = control.details.findAll(
    (node) => node.classList.contains("header-settings-section"),
  );
  assert.equal(settingsRows.length, 5, "settings has exactly five control rows");
  assert.deepEqual(
    control.details.findAll((node) => node.className === "header-settings-section-title")
      .map((node) => node.textContent),
    ["Audio Out", "Mic / Audio In", "MIDI In", "MIDI Out", "MIDI Map"],
  );
  assert.deepEqual(
    settingsRows.map((row) => row.children[1]),
    [
      control.audioOutputSelect,
      control.audioInputSelect,
      control.midiInputSelect,
      control.midiOutputSelect,
      control.select,
    ],
  );
  for (const row of settingsRows) {
    assert.equal(row.children.length, 2, "each compact row is directly one label and one select");
    assert.equal(row.children[0].tagName, "LABEL");
    assert.equal(row.children[1].tagName, "SELECT");
    assert.equal(row.children[0].getAttribute("for"), row.children[1].id);
  }
  for (const removedClass of [
    "header-settings-copy",
    "midi-keyboard-hint",
    "midi-profile-status",
    "midi-profile-hint",
  ]) {
    assert.equal(
      control.details.findAll((node) => node.classList.contains(removedClass)).length,
      0,
      `${removedClass} routine prose is removed from the compact menu`,
    );
  }
  assert.equal(control.meter, control.leftMeter, "the legacy meter handle aliases Left");
  assert.equal(control.leftMeter.tagName, "METER");
  assert.equal(control.rightMeter.tagName, "METER");
  assert.equal(control.meterShell.getAttribute("role"), "group");
  assert.equal(control.meterShell.getAttribute("aria-label"), "Stereo audio output levels");
  assert.deepEqual(
    control.meterShell.children.map((channel) => channel.children[0].textContent),
    ["L", "R"],
  );
  assert.equal(control.leftMeter.getAttribute("aria-label"), "Left audio output level");
  assert.equal(control.rightMeter.getAttribute("aria-label"), "Right audio output level");
  const guide = control.details.findAll((node) => node.className === "midi-profile-guide")[0];
  assert.equal(guide.textContent, "MIDI Guide");
  assert.match(guide.getAttribute("href"), /midi-guide\.html$/);
  assert.deepEqual(
    settingsHeading.parentNode.children.filter((node) => node.hidden !== true),
    [settingsHeading, ...settingsRows, guide],
    "the normal Settings view contains only its heading, five rows, and guide",
  );
  assert.equal(control.audioInputSelect.disabled, true);
  assert.equal(control.audioInputSelect.children[0].textContent, "Not used");
  assert.equal(control.select.children[0].value, "auto");
  assert.equal(control.select.children[0].textContent, "Computer keys");
  assert.equal(control.midiInputSelect.value, "on");
  assert.equal(control.midiInputSelect.disabled, false);
  assert.equal(control.toggle.children[2].textContent, "keys+1");
  assert.equal(control.toggle.getAttribute("aria-label"), "Turn MIDI input off");
  assert.equal(control.toggle.title, "MIDI input on");
  assert.equal(control.details.querySelector("#sharedMidiInputWarning").hidden, true);

  inputListeners.get("midimessage")({ data: new Uint8Array([0x90, 60, 100]) });
  assert.equal(control.toolbar.classList.contains("is-receiving"), true);
  assert.equal(control.activityLight.getAttribute("aria-hidden"), "true");
  const finishActivity = pendingActivity;
  finishActivity();
  assert.equal(control.toolbar.classList.contains("is-receiving"), false);

  control.select.value = "arturia-minilab-3";
  control.select.dispatch("change");
  assert.equal(manager.selectedProfileId, "arturia-minilab-3");
  assert.equal(stored.get("morphazoid:midi:profile:v1"), "arturia-minilab-3");

  control.midiInputSelect.value = "off";
  await control.midiInputSelect.listeners.get("change")[0]();
  assert.equal(manager.enabled, false);
  assert.equal(control.midiInputSelect.value, "off");
  control.midiInputSelect.value = "on";
  await control.midiInputSelect.listeners.get("change")[0]();
  assert.equal(manager.enabled, true);
  assert.equal(control.midiInputSelect.value, "on");
  assert.deepEqual(requests, [{ sysex: false }, { sysex: false }]);

  await control.toggle.listeners.get("click")[0]();
  assert.equal(control.toggle.getAttribute("aria-pressed"), "false");
  assert.equal(control.toggle.getAttribute("aria-label"), "Turn MIDI input on");
  assert.equal(inputListeners.has("midimessage"), false);
  assert.equal(messages.at(-1).controller, 120);
  assert.equal(messages.at(-1).reason, "manager-disabled");
  unregisterClient();
  assert.equal(control.toolbar.hidden, true);
  assert.equal(control.meterShell.hidden, true);
  assert.equal(control.details.hidden, true);
  assert.equal(masthead.classList.contains("has-midi-toolbar"), false);
  control.destroy();
});

test("MIDI toolbar IDs stay unique and repeated initialization adds no subscriptions", () => {
  const doc = new FakeDocument();
  const mastheads = [new FakeNode("header"), new FakeNode("header")];
  for (const masthead of mastheads) {
    masthead.className = "masthead";
    const audioStrip = new FakeNode("div");
    audioStrip.className = "audio-strip";
    masthead.append(audioStrip);
  }
  const baseQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector) => (
    selector === ".masthead" ? mastheads : baseQuerySelectorAll(selector)
  );
  const { runtime } = (() => {
    const runtimeListeners = new Map();
    return {
      runtime: {
        navigator: {},
        addEventListener(type, listener) {
          if (!runtimeListeners.has(type)) runtimeListeners.set(type, []);
          runtimeListeners.get(type).push(listener);
        },
        removeEventListener(type, listener) {
          runtimeListeners.set(
            type,
            (runtimeListeners.get(type) ?? []).filter((candidate) => candidate !== listener),
          );
        },
      },
    };
  })();
  const manager = new WebMidiManager(runtime);
  const controls = initializeMidiToolbars(doc, runtime, manager);
  assert.equal(controls.length, 2);
  assert.equal(controls[0].toggle.id, "sharedMidiToggle");
  assert.equal(controls[1].toggle.id, "sharedMidiToggle-2");
  assert.equal(
    controls[1].details.children[0].getAttribute("aria-controls"),
    "headerSettingsPanel-2",
  );
  assert.equal(new Set(controls.map(({ select }) => select.id)).size, 2);
  assert.equal(manager.statusSubscribers.size, 2);
  assert.equal(manager.messageSubscribers.size, 2);
  assert.equal(initializeMidiToolbars(doc, runtime, manager).length, 0);
  assert.equal(manager.statusSubscribers.size, 2);
  const unregister = manager.registerClient({
    id: "fm-drums",
    computerKeyboard: { layout: "pad-grid", baseNote: 36, velocity: 72 },
  });
  for (const control of controls) {
    assert.equal(
      control.details.children[0].getAttribute("aria-label"),
      "Morphazoid Settings",
    );
    assert.equal(control.details.children[0].children[0].className, "header-settings-icon");
    assert.equal(control.midiInputSelect.value, "off");
    assert.match(control.midiInputSelect.children[1].textContent, /^On · /);
    assert.equal(control.select.children[0].textContent, "Computer keys");
  }
  manager.setComputerKeyboardVelocity(108);
  for (const control of controls) {
    assert.equal(control.midiInputSelect.value, "off");
    assert.equal(
      control.details.findAll((node) => node.classList.contains("midi-keyboard-hint")).length,
      0,
    );
  }
  unregister();
  controls.forEach(({ destroy }) => destroy());
  assert.equal(manager.statusSubscribers.size, 0);
  assert.equal(manager.messageSubscribers.size, 0);
});

test("MIDI and audio controls keep one semantic order across shared header variants", () => {
  const doc = new FakeDocument();
  const audioStripHost = new FakeNode("header");
  audioStripHost.className = "masthead";
  const actionHost = new FakeNode("header");
  actionHost.className = "masthead";
  const dedicatedHost = new FakeNode("div");
  dedicatedHost.className = "session-state";

  const createAudioGroup = (className) => {
    const group = new FakeNode("div");
    group.className = className;
    const audioButton = new FakeNode("button");
    audioButton.className = "audio-button";
    const level = new FakeNode("label");
    level.className = "header-level";
    group.append(audioButton, level);
    return { group, audioButton, level };
  };
  const strip = createAudioGroup("audio-strip");
  const actions = createAudioGroup("header-actions");
  audioStripHost.append(strip.group);
  actionHost.append(actions.group);
  const audioToggle = new FakeNode("button");
  audioToggle.className = "audio-toggle";
  dedicatedHost.append(audioToggle);

  const baseQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector) => {
    if (selector === ".masthead") return [audioStripHost, actionHost];
    if (selector === "[data-midi-toolbar-host]") return [dedicatedHost];
    return baseQuerySelectorAll(selector);
  };
  const runtime = { navigator: {}, addEventListener() {}, removeEventListener() {} };
  const manager = new WebMidiManager(runtime);
  const controls = initializeMidiToolbars(doc, runtime, manager);
  assert.equal(controls.length, 3);

  const [stripWrapper, actionWrapper, dedicatedWrapper] = [
    audioStripHost,
    actionHost,
    dedicatedHost,
  ].map((host) => host.querySelector(".header-io-controls"));
  assert.deepEqual(
    stripWrapper.children,
    [controls[0].toolbar, controls[0].meterShell, strip.group, controls[0].details],
  );
  assert.deepEqual(
    actionWrapper.children,
    [controls[1].toolbar, controls[1].meterShell, actions.group, controls[1].details],
  );
  assert.deepEqual(
    dedicatedWrapper.children,
    [controls[2].toolbar, controls[2].meterShell, audioToggle, controls[2].details],
  );
  assert.deepEqual(strip.group.children, [strip.level, strip.audioButton]);
  assert.deepEqual(actions.group.children, [actions.level, actions.audioButton]);

  const unregister = manager.registerClient({ id: "late-native-client" });
  for (const host of [audioStripHost, actionHost, dedicatedHost]) {
    assert.equal(host.classList.contains("has-midi-toolbar"), true);
    assert.equal(host.querySelector(".header-io-controls").classList.contains("has-midi-toolbar"), false);
  }
  unregister();
  for (const host of [audioStripHost, actionHost, dedicatedHost]) {
    assert.equal(host.classList.contains("has-midi-toolbar"), false);
  }
  controls.forEach(({ destroy }) => destroy());
});

test("header settings meter and browser output chooser report real shared output state", async () => {
  const doc = new FakeDocument();
  doc.baseURI = `${SITE_ROOT}julia.html`;
  const masthead = new FakeNode("header");
  masthead.className = "masthead";
  const audioStrip = new FakeNode("div");
  audioStrip.className = "audio-strip";
  const level = new FakeNode("label");
  level.className = "header-level";
  const audioButton = new FakeNode("button");
  audioButton.className = "audio-button";
  audioStrip.append(level, audioButton);
  masthead.append(audioStrip);
  const baseQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector) => (
    selector === ".masthead" ? [masthead] : baseQuerySelectorAll(selector)
  );

  const midiOutputs = [
    { id: "out-a", name: "WAX DAW MIDI", state: "connected", send() {} },
    { id: "out-b", name: "Hardware Synth", state: "connected", send() {} },
  ];
  const midiAccess = {
    inputs: new Map(),
    outputs: new Map(midiOutputs.map((output) => [output.id, output])),
    addEventListener() {},
    removeEventListener() {},
  };
  const runtime = {
    navigator: { requestMIDIAccess: async () => midiAccess },
    addEventListener() {},
    removeEventListener() {},
  };
  const midiManager = new WebMidiManager(runtime);
  let audioStatus = {
    rms: 0.24,
    peak: 0.62,
    leftRms: 0.08,
    leftPeak: 0.31,
    rightRms: 0.24,
    rightPeak: 0.62,
    active: true,
    output: {
      mode: "browser-selectable",
      canSelect: true,
      selectedId: "usb",
      label: "USB Interface",
    },
  };
  let audioListener = null;
  let refreshed = 0;
  const selected = [];
  const audioOutputManager = {
    subscribe(listener) {
      audioListener = listener;
      listener(audioStatus);
      return () => { audioListener = null; };
    },
    getStatus() { return audioStatus; },
    async refreshOutputDevices() { refreshed += 1; },
    async listOutputDevices() {
      return [{ id: "usb", deviceId: "usb", label: "USB Interface" }];
    },
    async setOutputDevice(id) { selected.push(id); },
  };
  const [control] = initializeMidiToolbars(doc, runtime, midiManager, {
    routeId: "julia",
    audioOutputManager,
  });
  const unregister = midiManager.registerClient({ id: "julia" });

  assert.equal(control.meter, control.leftMeter);
  assert.equal(control.leftMeter.value, 0.31);
  assert.equal(control.rightMeter.value, 0.62);
  assert.equal(
    control.leftMeter.getAttribute("aria-valuetext"),
    "Left channel 31% output signal",
  );
  assert.equal(
    control.rightMeter.getAttribute("aria-valuetext"),
    "Right channel 62% output signal",
  );
  assert.equal(control.meterShell.title, "Stereo audio output · L 31% · R 62%");
  assert.equal(control.audioOutputSelect.hidden, undefined);
  assert.equal(control.audioOutputSelect.disabled, false);
  assert.equal(
    control.details.findAll((node) => node.classList.contains("header-settings-copy")).length,
    0,
  );

  control.details.open = true;
  await control.details.listeners.get("toggle")[0]();
  assert.equal(refreshed, 1);
  assert.deepEqual(
    control.audioOutputSelect.children.map((option) => [option.value, option.textContent]),
    [["", "System default"], ["usb", "USB Interface"]],
    "the browser chooser always retains a System default route",
  );
  control.audioOutputSelect.value = "";
  await control.audioOutputSelect.listeners.get("change")[0]();
  assert.deepEqual(selected, [""]);

  assert.equal(control.midiOutputSelect.disabled, true);
  assert.equal(control.midiOutputSelect.children[0].textContent, "Preview · no route");
  assert.equal(
    control.midiOutputSelect.getAttribute("aria-label"),
    "MIDI output: preview only, not routed",
  );
  await midiManager.enable();
  assert.equal(control.midiOutputSelect.disabled, true);
  assert.deepEqual(
    control.midiOutputSelect.children.map((option) => [option.value, option.textContent]),
    [["", "Preview · no route"]],
  );
  assert.equal(midiManager.outputSelectionId, null, "preview does not select a fake output route");

  audioStatus = {
    ...audioStatus,
    rms: 0.31,
    peak: 0.72,
    leftRms: 3e-17,
    leftPeak: 3e-17,
    rightRms: 0.31,
    rightPeak: 0.72,
    clipped: false,
    active: true,
  };
  audioListener(audioStatus);
  assert.equal(control.leftMeter.value, 0, "floating-point residue stays below silence");
  assert.equal(control.rightMeter.value, 0.72);
  assert.equal(
    control.leftMeter.getAttribute("aria-valuetext"),
    "Left channel has no output signal",
  );
  assert.equal(
    control.meterShell.children[0].classList.contains("is-active"),
    false,
    "a hard-right signal does not falsely light the Left channel",
  );
  assert.equal(control.meterShell.title, "Stereo audio output · L 0% · R 72%");

  audioStatus = {
    ...audioStatus,
    rms: 3e-17,
    peak: 3e-17,
    rightRms: 3e-17,
    rightPeak: 3e-17,
    active: false,
  };
  audioListener(audioStatus);
  assert.equal(
    control.meterShell.classList.contains("is-active"),
    false,
    "sub-floor residue does not keep the stereo meter shell active",
  );
  assert.equal(control.meterShell.title, "Stereo audio output · inactive");

  audioStatus = {
    ...audioStatus,
    rms: 0.45,
    peak: 1,
    leftRms: 0.01,
    leftPeak: 0.02,
    rightRms: 0.45,
    rightPeak: 1,
    clipped: true,
    active: true,
  };
  audioListener(audioStatus);
  assert.equal(control.leftMeter.value, 0.02);
  assert.equal(control.rightMeter.value, 1);
  assert.equal(
    control.rightMeter.getAttribute("aria-valuetext"),
    "Right channel clipping at 100%",
  );
  assert.equal(control.rightMeter.classList.contains("is-clipping"), true);
  assert.equal(control.leftMeter.classList.contains("is-clipping"), false);
  assert.equal(control.meterShell.classList.contains("is-clipping"), true);
  assert.equal(control.meterShell.title, "Stereo audio output · L 2% · R 100% CLIP");

  audioStatus = {
    rms: 0.2,
    peak: 0.4,
    clipped: false,
    active: true,
    output: audioStatus.output,
  };
  audioListener(audioStatus);
  assert.equal(control.leftMeter.value, 0.4, "legacy mono levels fall back to both channels");
  assert.equal(control.rightMeter.value, 0.4, "legacy mono levels fall back to both channels");
  assert.equal(control.meterShell.classList.contains("is-clipping"), false);

  audioStatus = { ...audioStatus, peak: 0, rms: 0, active: false };
  audioListener(audioStatus);
  assert.equal(control.leftMeter.value, 0);
  assert.equal(control.rightMeter.value, 0);
  assert.equal(
    control.leftMeter.getAttribute("aria-valuetext"),
    "Left channel has no output signal",
  );
  assert.equal(
    control.rightMeter.getAttribute("aria-valuetext"),
    "Right channel has no output signal",
  );
  assert.equal(control.meterShell.title, "Stereo audio output · inactive");

  midiManager.disable();
  unregister();
  control.destroy();
  assert.equal(audioListener, null);
});

test("header settings report WAX and instrument route capabilities without fake device controls", () => {
  const doc = new FakeDocument();
  const masthead = new FakeNode("header");
  masthead.className = "masthead";
  const audioStrip = new FakeNode("div");
  audioStrip.className = "audio-strip";
  masthead.append(audioStrip);
  const baseQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector) => (
    selector === ".masthead" ? [masthead] : baseQuerySelectorAll(selector)
  );
  const runtime = {
    MorphazoidWAX: {},
    navigator: {},
    addEventListener() {},
    removeEventListener() {},
  };
  const manager = new WebMidiManager(runtime);
  const audioStatus = {
    leftRms: 0,
    leftPeak: 0,
    rightRms: 0,
    rightPeak: 0,
    rms: 0,
    peak: 0,
    clipped: false,
    active: false,
    output: {
      mode: "wax-host",
      canSelect: false,
      selectedId: "wax-host",
      label: "DAW / plug-in host",
    },
  };
  const audioOutputManager = {
    subscribe(listener) {
      listener(audioStatus);
      return () => {};
    },
    getStatus() { return audioStatus; },
  };
  const [control] = initializeMidiToolbars(doc, runtime, manager, {
    routeId: "lumber",
    audioOutputManager,
  });
  const unregister = manager.registerClient({ id: "lumber" });

  assert.equal(control.audioOutputSelect.disabled, true);
  assert.equal(control.audioOutputSelect.children[0].textContent, "DAW / host");
  assert.equal(control.audioInputSelect.disabled, false);
  assert.equal(control.audioInputSelect.children[0].textContent, "DAW / host");
  assert.equal(control.audioInputSelect.parentNode.classList.contains("is-unavailable"), false);
  assert.equal(control.midiOutputSelect.disabled, true);
  assert.equal(
    control.midiOutputSelect.children[0].textContent,
    "Not used",
    "WAX does not advertise a MIDI output route when this instrument has none",
  );
  assert.equal(control.midiOutputSelect.parentNode.classList.contains("is-unavailable"), true);
  assert.equal(control.select.children[0].textContent, "Page keys");

  unregister();
  control.destroy();
});

test("MIDI toolbar keeps computer keys active when hardware permission fails and can retry cleanly", async () => {
  const doc = new FakeDocument();
  const masthead = new FakeNode("header");
  masthead.className = "masthead";
  const audioStrip = new FakeNode("div");
  audioStrip.className = "audio-strip";
  masthead.append(audioStrip);
  const baseQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector) => (
    selector === ".masthead" ? [masthead] : baseQuerySelectorAll(selector)
  );
  const input = {
    id: "keys",
    name: "Keyboard",
    state: "connected",
    addEventListener() {},
    removeEventListener() {},
  };
  const access = {
    inputs: new Map([[input.id, input]]),
    addEventListener() {},
    removeEventListener() {},
  };
  let attempts = 0;
  const runtimeListeners = new Map();
  const runtime = {
    document: doc,
    navigator: {
      requestMIDIAccess() {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("Permission denied")) : access;
      },
    },
    addEventListener(type, listener) {
      if (!runtimeListeners.has(type)) runtimeListeners.set(type, []);
      runtimeListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      runtimeListeners.set(
        type,
        (runtimeListeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    },
  };
  const manager = new WebMidiManager(runtime);
  const [control] = initializeMidiToolbars(doc, runtime, manager);
  manager.registerClient({ id: "instrument" });
  const error = control.details.querySelector("#sharedMidiError");

  await control.toggle.listeners.get("click")[0]();
  assert.equal(attempts, 1);
  assert.equal(manager.enabled, true);
  assert.equal(manager.status().computerKeyboard.active, true);
  assert.equal(manager.status().hardwareError, "Permission denied");
  assert.equal(control.toggle.children[2].textContent, "keys");
  assert.equal(control.toolbar.classList.contains("is-error"), false);
  assert.equal(error.hidden, true);
  assert.equal(error.textContent, "");
  const inputWarning = control.details.querySelector("#sharedMidiInputWarning");
  assert.equal(inputWarning.hidden, false);
  assert.equal(inputWarning.getAttribute("role"), "alert");
  assert.equal(inputWarning.textContent, "Hardware MIDI unavailable — computer keys still work.");
  assert.equal(inputWarning.title, "Permission denied");
  assert.equal(control.midiInputSelect.value, "on");

  await control.toggle.listeners.get("click")[0]();
  assert.equal(manager.enabled, false, "the second click explicitly disables the fallback");
  await control.toggle.listeners.get("click")[0]();
  assert.equal(attempts, 2);
  assert.equal(manager.enabled, true);
  assert.equal(manager.status().inputCount, 1);
  assert.equal(manager.status().hardwareError, null);
  assert.equal(control.toggle.children[2].textContent, "keys+1");
  assert.equal(control.toolbar.classList.contains("is-error"), false);
  assert.equal(error.hidden, true);
  assert.equal(error.textContent, "");
  assert.equal(inputWarning.hidden, true);
  assert.equal(inputWarning.textContent, "");

  control.select.value = "invalid-profile";
  control.select.dispatch("change");
  assert.equal(control.select.value, manager.selectedProfileId);
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /Unknown MIDI profile/);
  manager.disable();
  control.destroy();
});

test("pagehide disables MIDI, retains BFCache painting, and destroys on final exit", async () => {
  const doc = new FakeDocument();
  const masthead = new FakeNode("header");
  masthead.className = "masthead";
  const audioStrip = new FakeNode("div");
  audioStrip.className = "audio-strip";
  masthead.append(audioStrip);
  const baseQuerySelectorAll = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector) => (
    selector === ".masthead" ? [masthead] : baseQuerySelectorAll(selector)
  );
  const input = {
    id: "keys",
    name: "Keyboard",
    state: "connected",
    addEventListener() {},
    removeEventListener() {},
  };
  const access = {
    inputs: new Map([[input.id, input]]),
    addEventListener() {},
    removeEventListener() {},
  };
  const runtimeListeners = new Map();
  const runtime = {
    navigator: { requestMIDIAccess: async () => access },
    addEventListener(type, listener) {
      if (!runtimeListeners.has(type)) runtimeListeners.set(type, []);
      runtimeListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      runtimeListeners.set(
        type,
        (runtimeListeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    },
  };
  const dispatchRuntime = (type, event) => {
    for (const listener of [...(runtimeListeners.get(type) ?? [])]) listener(event);
  };
  const manager = new WebMidiManager(runtime);
  manager.registerClient({ id: "instrument" });
  const [control] = initializeMidiToolbars(doc, runtime, manager);
  await manager.enable();
  assert.equal(manager.enabled, true);
  assert.equal(manager.statusSubscribers.size, 1);

  dispatchRuntime("pagehide", { persisted: true });
  assert.equal(manager.enabled, false);
  assert.equal(manager.statusSubscribers.size, 1, "BFCache pages retain live status painting");
  assert.equal(control.toggle.getAttribute("aria-pressed"), "false");

  await manager.enable();
  dispatchRuntime("pagehide", { persisted: false });
  assert.equal(manager.enabled, false);
  assert.equal(manager.statusSubscribers.size, 0);
  assert.equal(runtimeListeners.get("pagehide").length, 0);
  control.destroy();
});

test("mapped tablet and phone headers keep MIDI and output controls visible", async () => {
  const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
  assert.match(
    css,
    /@media \(max-width: 900px\)[\s\S]*?\.wordmark \{[\s\S]*?display: inline-flex;[\s\S]*?width: 28px;[\s\S]*?overflow: hidden;[\s\S]*?flex: 0 0 28px;/,
  );
  assert.match(
    css,
    /@media \(max-width: 900px\)[\s\S]*?\.wordmark > span:last-child \{\s+display: none;/,
  );
  assert.doesNotMatch(
    css,
    /@media \(max-width: 650px\)[\s\S]*?\.wordmark > span:last-child \{\s+display: inline;/,
  );
  assert.doesNotMatch(css, /\.instrument-picker-info\s*\{/);
  assert.doesNotMatch(css, /\.selected-instrument-info/);
  assert.doesNotMatch(css, /\.instrument-picker-preview/);
  assert.match(
    css,
    /\.instrument-picker-panel\s*\{[^}]*display: grid;[^}]*grid-template-rows: auto minmax\(0, 1fr\);/s,
  );
  assert.match(css, /\.instrument-picker-search-input\s*\{[^}]*height: 36px;/s);
  assert.match(css, /\.instrument-picker-group-title\s*\{[^}]*position: sticky;[^}]*top: 0;/s);
  assert.match(
    css,
    /\.instrument-picker-group-title\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto 14px;/s,
  );
  assert.match(css, /\.instrument-picker-link\s*\{[^}]*padding: 5px 8px 5px 10px;[^}]*gap: 10px;/s);
  assert.match(css, /\.instrument-picker-link-icon\s*\{[^}]*width: 24px;[^}]*height: 24px;[^}]*object-fit: contain;/s);
  assert.match(css, /\.instrument-picker-link-label\s*\{[^}]*text-overflow: ellipsis;/s);
  assert.doesNotMatch(css, /\.instrument-picker-link::before\s*\{/);
  assert.match(css, /\.instrument-picker-row\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/s);
  assert.match(css, /\.instrument-page-info\s*\{[^}]*padding: 20px;[^}]*border-top: 1px solid var\(--line-strong\);/s);
  assert.match(
    css,
    /\.instrument-picker-card\s*\{[^}]*min-height: 0;[^}]*grid-template-rows: repeat\(4, auto\);/s,
  );
  assert.match(
    css,
    /@media \(max-width: 650px\)[\s\S]*?\.instrument-picker-panel \{[^}]*grid-template-rows:/s,
  );
  assert.match(
    css,
    /@media \(max-width: 650px\)[\s\S]*?\.instrument-picker-search-input \{[^}]*font-size: 16px;/s,
  );
  assert.doesNotMatch(css, /\.instrument-picker\.has-preview/);
  assert.match(
    css,
    /@media \(max-width: 900px\)[\s\S]+\.masthead\.has-midi-toolbar \.tabs\.tools-nav \+ \.mobile-instrument-nav/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \{\s+height: auto;[\s\S]*?flex-wrap: wrap;/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \.header-io-controls \{\s+width: 100%;[\s\S]*?flex: 1 0 100%;/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \.header-io-controls > \.audio-strip,[\s\S]*?grid-template-columns: minmax\(0, 1fr\) var\(--audio-control-width\);/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \.header-level \{\s+display: grid;/,
  );
  assert.doesNotMatch(css, /\.masthead\.has-midi-toolbar \.header-level \{\s+display: none;/);
  assert.doesNotMatch(css, /\.midi-toolbar\[hidden\][\s\S]{0,80}display:\s*flex/);
  assert.match(css, /\.header-settings-trigger \{[\s\S]*?width: 44px;/);
  assert.match(css, /\.header-settings-icon \{[\s\S]*?mask: url\("data:image\/svg\+xml/);
  assert.match(css, /\.header-settings-panel \{[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.header-settings-section \{[^}]*grid-template-columns: minmax\(92px, 112px\) minmax\(0, 1fr\);/s);
  assert.match(css, /\.header-settings-section > select \{[^}]*min-height: 40px;/s);
  assert.match(
    css,
    /\.header-settings-section > select \{[^}]*background-image:\s*linear-gradient\(45deg, transparent 50%, currentColor 50%\),[^}]*appearance: none;/s,
    "direct Settings selects retain an unmistakable dropdown chevron",
  );
  assert.match(css, /\.header-settings-section > select:disabled \{[^}]*cursor: not-allowed;[^}]*opacity: 1;/s);
  assert.match(css, /\.header-output-meter \{[\s\S]*?writing-mode: vertical-rl;/);
  assert.match(css, /\.header-output-meter-shell \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s);
  assert.match(css, /\.header-output-meter-shell \{[^}]*width: 22px;[^}]*gap: 0;/s);
  assert.match(css, /\.header-output-channel-label \{[^}]*font-size: 7px;/s);
  assert.match(css, /\.midi-toolbar\.is-receiving \.midi-activity-light \{/);
  assert.match(
    css,
    /\.audio-strip \{[\s\S]*?grid-template-columns: minmax\(96px, 140px\) var\(--audio-control-width\);/,
  );
});

test("Reset all preserves Shape sides for one reload", () => {
  const listeners = new Map();
  const removedKeys = [];
  const sessionValues = new Map();
  let reloads = 0;
  const resetButton = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const doc = {
    getElementById(id) {
      return id === "sides" ? { value: "11" } : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-reset-all]") return [resetButton];
      return [];
    },
  };
  const runtime = {
    localStorage: {
      removeItem(key) { removedKeys.push(key); },
    },
    sessionStorage: {
      getItem(key) { return sessionValues.get(key) ?? null; },
      setItem(key, value) { sessionValues.set(key, String(value)); },
      removeItem(key) { sessionValues.delete(key); },
    },
    location: {
      href: "",
      reload() { reloads += 1; },
    },
  };

  initializeSharedNavigation(doc, runtime);
  listeners.get("click")();

  assert.equal(sessionValues.get("morphazoid:shape:reset:sides"), "11");
  assert.equal(reloads, 1);
  assert.deepEqual(removedKeys, [
    "morphazoid:shape:audio:v1",
    "morphazoid:lattice:audio:v2",
    "morphazoid:lumber:audio:v2",
    "morphazoid:shape:audio:v1",
    "morphazoid:lattice:audio:v2",
    "morphazoid:lumber:audio:v2",
  ]);
});

test("shared reset leaves in-place instrument resets to their page app", () => {
  let sharedListenerAdded = false;
  const resetButton = {
    hasAttribute(name) {
      return name === "data-reset-in-place";
    },
    addEventListener() {
      sharedListenerAdded = true;
    },
  };
  const doc = {
    getElementById() { return null; },
    querySelectorAll(selector) {
      return selector === "[data-reset-all]" ? [resetButton] : [];
    },
  };
  initializeSharedNavigation(doc, {
    location: { href: "", reload() {} },
  });
  assert.equal(sharedListenerAdded, false);
});

test("storage accessors cannot abort navigation setup or reset", () => {
  const listeners = new Map();
  let reloads = 0;
  const resetButton = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  const doc = {
    baseURI: `${SITE_ROOT}index.html`,
    getElementById(id) {
      return id === "sides" ? { value: "9" } : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-reset-all]") return [resetButton];
      return [];
    },
  };
  const runtime = {
    get localStorage() {
      throw new Error("storage denied");
    },
    get sessionStorage() {
      throw new Error("storage denied");
    },
    location: {
      href: `${SITE_ROOT}index.html`,
      reload() {
        reloads += 1;
      },
    },
  };

  assert.doesNotThrow(() => initializeSharedNavigation(doc, runtime));
  assert.doesNotThrow(() => listeners.get("click")());
  assert.equal(reloads, 1);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SITE_LINKS,
  TOOL_GROUPS,
  enhanceSharedNavigation,
  hydrateInstrumentPickers,
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
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  insertBefore(node, reference) {
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
      "Signal & Voice",
      "Barber Shop Poles",
      "Fractals & Recursion",
      "Chaotic Synths",
      "WebGPU Synths",
      "Instruments",
      "Algorithmic Sequencers",
      "Experiments",
    ],
  );
  const tools = TOOL_GROUPS.flatMap((group) => group.tools);
  assert.equal(tools.length, 81);
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
      label: "Rattle Snake Boogie",
      href: "linear-drums-machine.html",
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
      { id: "rubix", href: "rubix.html" },
      { id: "hyper-drums", href: "hyper-drums.html" },
      { id: "l-system-drums", href: "l-system-drums.html" },
      { id: "linear-drums-machine", href: "linear-drums-machine.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "instruments")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "fm-drums", href: "fm-drums.html" },
      { id: "linear-drums", href: "linear-drums.html" },
      { id: "sample-drums", href: "sample-drums.html" },
    ],
  );
  assert.equal(TOOL_GROUPS.some((group) => group.id === "image-to-instrument"), false);
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "signal-voice")?.tools.map(
      ({ id, label, href }) => ({ id, label, href }),
    ),
    [
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
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "algorithmic-sequencers")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "sorting-algorithms", href: "algorithmic-sequencers.html" },
      { id: "dijkstra", href: "dijkstra.html" },
      { id: "hanoi", href: "hanoi.html" },
      { id: "minimax", href: "minimax.html" },
      { id: "nqueens", href: "nqueens.html" },
      { id: "euclid", href: "euclid.html" },
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
      label: "L-mic",
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
      { id: "sandy-syrup-delay", href: "sandy-syrup-delay.html" },
      { id: "striped-sludge-delay", href: "striped-sludge-delay.html" },
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
      { id: "plasma-ball", href: "plasma-ball.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "webgpu-synths")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "webgpu-303", href: "webgpu-303.html" },
    ],
  );
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
      { id: "escher-tessellation", href: "escher-tessellation.html" },
      { id: "order-tones", href: "order-tones.html" },
      { id: "morphazoidical", href: "morphazoidical/" },
      { id: "bell-square", href: "bell-square.html" },
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
      { id: "cellular-automata", href: "cellular-automata.html" },
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

test("active tool resolution preserves GitHub Pages subpaths and nested workbench pages", () => {
  assert.equal(normalizeNavigationPath(`${SITE_ROOT}index.html?mode=test`, SITE_ROOT), "/blechdom/morphazoid/");
  assert.equal(resolveActiveTool("https://example.test/blechdom/morphazoid", SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink("https://example.test/blechdom/morphazoid", SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}shape.html`, SITE_ROOT)?.id, "shape");
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
  assert.equal(resolveActiveTool(`${SITE_ROOT}audio-engine-lab.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}shepard-risset.html`, SITE_ROOT)?.id, "shepard-risset");
  assert.equal(resolveActiveTool(`${SITE_ROOT}drum-roll-please.html`, SITE_ROOT)?.id, "drum-roll-please");
  assert.equal(resolveActiveTool(`${SITE_ROOT}candy-coil-delay.html`, SITE_ROOT)?.id, "candy-coil-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}striped-sludge-delay.html`, SITE_ROOT)?.id, "striped-sludge-delay");
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
  assert.equal(resolveActiveTool(`${SITE_ROOT}annealogue.html`, SITE_ROOT)?.id, "annealogue");
  assert.equal(resolveActiveTool(`${SITE_ROOT}plasma-ball.html`, SITE_ROOT)?.id, "plasma-ball");
  assert.equal(resolveActiveTool(`${SITE_ROOT}moire-organ.html`, SITE_ROOT)?.id, "moire-organ");
  assert.equal(resolveActiveTool(`${SITE_ROOT}chladni-plate.html`, SITE_ROOT)?.id, "chladni-plate");
  assert.equal(resolveActiveTool(`${SITE_ROOT}spring-choir.html`, SITE_ROOT)?.id, "spring-choir");
  assert.equal(resolveActiveTool(`${SITE_ROOT}gear-ratio-drums.html`, SITE_ROOT)?.id, "gear-ratio-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}cellular-automata.html`, SITE_ROOT)?.id, "cellular-automata");
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
  assert.equal(
    resolveActiveTool(`${SITE_ROOT}linear-drums-machine.html`, SITE_ROOT)?.id,
    "linear-drums-machine",
  );
  assert.equal(resolveActiveTool(`${SITE_ROOT}sample-drums.html`, SITE_ROOT)?.id, "sample-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}shape-drums.html`, SITE_ROOT)?.id, "shape-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}lattice-drums.html`, SITE_ROOT)?.id, "lattice-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}spiral-drums.html`, SITE_ROOT)?.id, "spiral-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}solid-drums.html`, SITE_ROOT)?.id, "solid-drums");
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

test("shared navigation creates a title-only picker and preserves the native select fallback", () => {
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
  const pickerGroups = TOOL_GROUPS.filter((group) => group.picker !== false);
  const pickerTools = pickerGroups.flatMap((group) => group.tools);
  assert.deepEqual(
    picker.findAll((node) => node.classList.contains("instrument-picker-group-title"))
      .map((heading) => heading.textContent),
    pickerGroups.map((group) => group.label),
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
  const pageInfo = result.pageInfos[0];
  assert.equal(pageInfo.getAttribute("data-tool-id"), "julia");
  assert.equal(pageInfo.getAttribute("aria-label"), "About Julia");
  assert.equal(doc.panel.children.at(-1), pageInfo);
  assert.equal(doc.select.children.length, pickerGroups.length);
  assert.deepEqual(
    doc.select.children.map((group) => group.label),
    pickerGroups.map((group) => group.label),
  );
  const selectedOptions = doc.select.findAll((node) => node.tagName === "OPTION" && node.selected);
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
    TOOL_GROUPS.filter((group) => group.picker !== false).length + 1,
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

test("top Audio buttons become square accessible speaker controls", async () => {
  const button = new FakeNode("button");
  button.className = "audio-button";
  button.setAttribute("aria-pressed", "false");
  const oldGlyph = new FakeNode("span");
  oldGlyph.className = "audio-glyph";
  const status = new FakeNode("small");
  status.id = "audioState";
  status.textContent = "off";
  button.append(oldGlyph, status);
  const doc = {
    createElement(tagName) { return new FakeNode(tagName); },
    querySelectorAll(selector) {
      assert.equal(selector, ".audio-button");
      return [button];
    },
  };

  normalizeAudioButtonIcons(doc);
  const icon = button.children[0];
  assert.equal(icon.className, "audio-speaker-icon");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  assert.equal(button.getAttribute("data-audio-state"), "off");
  assert.equal(button.getAttribute("aria-label"), "Turn audio on");
  assert.equal(button.getAttribute("title"), "Audio off");

  button.setAttribute("aria-pressed", "true");
  status.textContent = "on";
  normalizeAudioButtonIcons(doc);
  assert.equal(button.children.filter((child) => child.className === "audio-speaker-icon").length, 1);
  assert.equal(button.getAttribute("data-audio-state"), "on");
  assert.equal(button.getAttribute("aria-label"), "Turn audio off");
  assert.equal(button.getAttribute("title"), "Audio on");

  const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.audio-button\s*\{[^}]*width: 44px;[^}]*height: 44px;/s);
  assert.match(css, /\.audio-button > :not\(\.audio-speaker-icon\)\s*\{[^}]*display: none !important;/s);
  assert.match(css, /\.audio-speaker-icon\s*\{[^}]*mask: url\("data:image\/svg\+xml/s);
  assert.match(css, /\.audio-button\[aria-pressed="true"\]\s*\{[^}]*color: var\(--accent\);/s);
});

test("one header MIDI control owns connection and controller profile selection", async () => {
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
  assert.equal(masthead.classList.contains("has-midi-toolbar"), true);
  assert.equal(masthead.children[0], control.toolbar);
  assert.equal(masthead.children[1], audioStrip);
  assert.equal(initializeMidiToolbars(doc, runtime, manager).length, 0);
  assert.equal(masthead.findAll((node) => node.className === "midi-toolbar").length, 1);

  await control.toggle.listeners.get("click")[0]();
  assert.deepEqual(requests, [{ sysex: false }]);
  assert.equal(control.toggle.getAttribute("aria-pressed"), "true");
  assert.equal(control.toggle.getAttribute("aria-controls"), null);
  assert.equal(manager.status().inputs[0].profileId, "ni-komplete-kontrol-s49-mk2");
  const profileSummary = control.details.children[0];
  assert.equal(
    profileSummary.getAttribute("aria-label"),
    "MIDI mapping: Auto (per device); computer keys: piano",
  );
  assert.equal(profileSummary.title, "Auto (per device) · Computer piano");
  assert.equal(profileSummary.children[1].textContent, "Piano");
  assert.equal(control.toggle.children[2].textContent, "keys+1");
  const keyboardHint = control.details.findAll(
    (node) => node.className === "midi-keyboard-hint",
  )[0];
  assert.match(keyboardHint.textContent, /Computer piano/);
  assert.match(keyboardHint.textContent, /Q is C4/);
  assert.match(keyboardHint.textContent, /Octave \+0 · velocity 100/);
  const statusLine = control.details.findAll(
    (node) => node.className === "midi-profile-status",
  )[0];
  assert.match(statusLine.textContent, /computer keys ready/);
  assert.match(statusLine.textContent, /Komplete Kontrol S49 MK2/);
  const hint = control.details.findAll((node) => node.className === "midi-profile-hint")[0];
  assert.match(hint.textContent, /Morphazoid MIDI-mode template/);
  assert.match(hint.textContent, /not Native Instruments factory defaults/);
  assert.match(hint.textContent, /where a safe note target exists, notes set pitch or trigger sound/);
  assert.match(hint.textContent, /MIDI Clock, Start, and Stop/);

  control.select.value = "arturia-minilab-3";
  control.select.dispatch("change");
  assert.equal(manager.selectedProfileId, "arturia-minilab-3");
  assert.equal(stored.get("morphazoid:midi:profile:v1"), "arturia-minilab-3");

  await control.toggle.listeners.get("click")[0]();
  assert.equal(control.toggle.getAttribute("aria-pressed"), "false");
  assert.equal(inputListeners.has("midimessage"), false);
  assert.equal(messages.at(-1).controller, 120);
  assert.equal(messages.at(-1).reason, "manager-disabled");
  unregisterClient();
  assert.equal(control.toolbar.hidden, true);
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
    "midiProfilePanel-2",
  );
  assert.equal(new Set(controls.map(({ select }) => select.id)).size, 2);
  assert.equal(manager.statusSubscribers.size, 2);
  assert.equal(initializeMidiToolbars(doc, runtime, manager).length, 0);
  assert.equal(manager.statusSubscribers.size, 2);
  const unregister = manager.registerClient({
    id: "fm-drums",
    computerKeyboard: { layout: "pad-grid", baseNote: 36, velocity: 72 },
  });
  for (const control of controls) {
    assert.equal(control.details.children[0].children[1].textContent, "Pads");
    const keyboardHint = control.details.findAll(
      (node) => node.className === "midi-keyboard-hint",
    )[0];
    assert.match(keyboardHint.textContent, /Computer pads/);
    assert.match(keyboardHint.textContent, /1 2 3 4 \/ Q W E R \/ A S D F \/ Z X C V/);
    assert.match(keyboardHint.textContent, /Octave \+0 · velocity 72/);
  }
  manager.setComputerKeyboardVelocity(108);
  for (const control of controls) {
    const keyboardHint = control.details.findAll(
      (node) => node.className === "midi-keyboard-hint",
    )[0];
    assert.match(
      keyboardHint.textContent,
      /velocity 80/,
      "the hint reports the effective custom velocity, including shared adjustments",
    );
  }
  unregister();
  controls.forEach(({ destroy }) => destroy());
  assert.equal(manager.statusSubscribers.size, 0);
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
  const statusLine = control.details.findAll(
    (node) => node.className === "midi-profile-status",
  )[0];
  assert.match(statusLine.textContent, /computer keys ready/);
  assert.match(statusLine.textContent, /hardware MIDI: Permission denied/);
  const keyboardHint = control.details.findAll(
    (node) => node.className === "midi-keyboard-hint",
  )[0];
  assert.match(keyboardHint.textContent, /Z S X D C V G B H N J M/);
  assert.match(keyboardHint.textContent, /\[ \] octave · - \/ = velocity/);

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
    /@media \(max-width: 650px\)[\s\S]*?\.wordmark \{[\s\S]*?display: inline-flex;[\s\S]*?width: auto;[\s\S]*?flex: 0 0 auto;/,
  );
  assert.match(
    css,
    /@media \(max-width: 650px\)[\s\S]*?\.wordmark > span:last-child \{\s+display: inline;/,
  );
  assert.doesNotMatch(
    css,
    /@media \(min-width: 651px\) and \(max-width: 900px\)[\s\S]*?\.masthead\.has-midi-toolbar \.wordmark \{\s+display: none;/,
  );
  assert.doesNotMatch(css, /\.instrument-picker-info\s*\{/);
  assert.doesNotMatch(css, /\.selected-instrument-info/);
  assert.doesNotMatch(css, /\.instrument-picker-preview/);
  assert.match(css, /\.instrument-picker-group-title\s*\{[^}]*position: sticky;[^}]*top: 0;/s);
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
  assert.doesNotMatch(css, /\.instrument-picker\.has-preview/);
  assert.match(
    css,
    /@media \(min-width: 651px\) and \(max-width: 900px\)[\s\S]+\.masthead\.has-midi-toolbar \.tabs\.tools-nav \+ \.mobile-instrument-nav/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \{\s+height: auto;[\s\S]*?flex-wrap: wrap;/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \.audio-strip \{\s+width: 100%;[\s\S]*?grid-template-columns: 44px minmax\(0, 1fr\);/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \.header-level \{\s+display: grid;/,
  );
  assert.doesNotMatch(css, /\.masthead\.has-midi-toolbar \.header-level \{\s+display: none;/);
  assert.doesNotMatch(css, /\.midi-toolbar\[hidden\][\s\S]{0,80}display:\s*flex/);
  assert.match(
    css,
    /@media \(max-width: 650px\)[\s\S]*?\.midi-profile-trigger small \{\s+font-size: 8px;/,
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

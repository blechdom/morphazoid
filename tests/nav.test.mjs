import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SITE_LINKS,
  TOOL_GROUPS,
  enhanceSharedNavigation,
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
    this.select = new FakeNode("select");
    this.select.className = "mobile-instrument-select";
    this.listeners = new Map();
  }

  createElement(tagName) {
    return new FakeNode(tagName);
  }

  querySelector() {
    return null;
  }

  querySelectorAll(selector) {
    if (selector === ".tabs") return [this.tabs];
    if (selector === ".mobile-instrument-select") return [this.select];
    if (selector === "[data-reset-all]") return [];
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
      "Geometry Drum Machines",
      "Signal & Voice",
      "Barber Shop Poles",
      "Fractals & Recursion",
      "Chaotic Synths",
      "Instruments",
      "Algorithmic Sequencers",
      "Experiments (works-in-progress)",
    ],
  );
  const tools = TOOL_GROUPS.flatMap((group) => group.tools);
  assert.equal(tools.length, 60);
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
    TOOL_GROUPS.find((group) => group.id === "instruments")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "fm-drums", href: "fm-drums.html" },
      { id: "linear-drums", href: "linear-drums.html" },
      { id: "sample-drums", href: "sample-drums.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "algorithmic-sequencers")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
      { id: "sorting-algorithms", href: "algorithmic-sequencers.html" },
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
      { id: "weierstrass", href: "weierstrass.html" },
    ],
  );
  assert.deepEqual(
    TOOL_GROUPS.find((group) => group.id === "experiments")?.tools.map(
      ({ id, href }) => ({ id, href }),
    ),
    [
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
    ],
  );
  assert.deepEqual(SITE_LINKS, [
    { id: "plugins", label: "Plug-ins", href: "plugins.html" },
    { id: "about", label: "About", href: "./" },
  ]);
});

test("active tool resolution preserves GitHub Pages subpaths and nested workbench pages", () => {
  assert.equal(normalizeNavigationPath(`${SITE_ROOT}index.html?mode=test`, SITE_ROOT), "/blechdom/morphazoid/");
  assert.equal(resolveActiveTool("https://example.test/blechdom/morphazoid", SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink("https://example.test/blechdom/morphazoid", SITE_ROOT)?.id, "about");
  assert.equal(resolveActiveTool(`${SITE_ROOT}shape.html`, SITE_ROOT)?.id, "shape");
  assert.equal(resolveActiveTool(`${SITE_ROOT}spiral.html#reader`, SITE_ROOT)?.id, "spiral");
  assert.equal(resolveActiveTool(`${SITE_ROOT}l-mic.html`, SITE_ROOT)?.id, "micmic");
  assert.equal(resolveActiveTool(`${SITE_ROOT}micmic.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}graph-delay.html`, SITE_ROOT)?.id, "graph-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}audio-engine-lab.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}shepard-risset.html`, SITE_ROOT)?.id, "shepard-risset");
  assert.equal(resolveActiveTool(`${SITE_ROOT}candy-coil-delay.html`, SITE_ROOT)?.id, "candy-coil-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}striped-sludge-delay.html`, SITE_ROOT)?.id, "striped-sludge-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}sandy-syrup-delay.html`, SITE_ROOT)?.id, "sandy-syrup-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}recursive-fm.html`, SITE_ROOT)?.id, "recursive-fm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}recursive-pm.html`, SITE_ROOT)?.id, "recursive-pm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}chaotic-fm.html`, SITE_ROOT)?.id, "chaotic-fm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}chaotic-pm.html`, SITE_ROOT)?.id, "chaotic-pm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}weierstrass.html`, SITE_ROOT)?.id, "weierstrass");
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
  assert.equal(resolveActiveTool(`${SITE_ROOT}algorithmic-sequencers.html`, SITE_ROOT)?.id, "sorting-algorithms");
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
  assert.equal(resolveActiveTool(`${SITE_ROOT}hyper-drums.html`, SITE_ROOT)?.id, "hyper-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}l-system-drums.html`, SITE_ROOT)?.id, "l-system-drums");
  assert.equal(resolveActiveTool(`${SITE_ROOT}analyzer.html`, SITE_ROOT), null);
  assert.equal(resolveActiveTool(`${SITE_ROOT}morphazoidical/`, SITE_ROOT)?.id, "morphazoidical");
  assert.equal(resolveActiveTool(`${SITE_ROOT}morphazoidical/atlas.html`, SITE_ROOT)?.id, "morphazoidical");
  assert.equal(resolveActiveTool(`${SITE_ROOT}unknown.html`, SITE_ROOT), null);
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}plugins.html`, SITE_ROOT)?.id, "plugins");
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}about.html`, SITE_ROOT)?.id, "about");
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}`, SITE_ROOT)?.id, "about");
  assert.equal(resolveActiveSiteLink(`${SITE_ROOT}julia.html`, SITE_ROOT), null);
});

test("shared navigation generates one grouped disclosure and grouped mobile options", () => {
  const doc = new FakeDocument();
  const result = enhanceSharedNavigation(doc, {
    currentHref: `${SITE_ROOT}julia.html`,
    siteRoot: SITE_ROOT,
  });

  assert.equal(result.activeTool?.id, "julia");
  assert.equal(result.activeSiteLink, null);
  assert.equal(result.disclosures.length, 1);
  assert.equal(doc.tabs.getAttribute("aria-label"), "Morphazoid main menu");
  assert.equal(doc.tabs.classList.contains("tools-nav"), true);

  const details = result.disclosures[0];
  assert.equal(details.tagName, "DETAILS");
  const summary = details.children[0];
  assert.equal(summary.tagName, "SUMMARY");
  assert.equal(
    summary.getAttribute("aria-label"),
    "Fractals & Recursion. Current tool: Julia",
  );
  assert.equal(
    summary.findAll((node) => node.className === "tools-menu-label")[0]?.textContent,
    "Fractals & Recursion",
  );
  assert.equal(
    summary.findAll((node) => node.className === "tools-menu-current")[0]?.textContent,
    "Julia",
  );
  const menuIcon = summary.findAll(
    (node) => node.className === "tools-menu-chevron",
  )[0];
  assert.equal(menuIcon?.textContent, "");
  assert.equal(menuIcon?.getAttribute("aria-hidden"), "true");

  const sections = details.findAll((node) => node.tagName === "SECTION");
  assert.equal(sections.length, TOOL_GROUPS.length);
  assert.deepEqual(
    sections.map((section) => section.children[0].textContent),
    TOOL_GROUPS.map((group) => group.label),
  );
  const nestedLists = details.findAll((node) => node.className === "tools-menu-links");
  assert.equal(nestedLists.length, TOOL_GROUPS.length);
  assert.equal(nestedLists[0].children[0].getAttribute("data-tool-id"), "shape");
  const links = details.findAll((node) => node.tagName === "A");
  assert.equal(links.length, 60);
  const siteLinks = doc.tabs.children.filter((node) => node.classList.contains("site-nav-link"));
  assert.equal(siteLinks.length, 2);
  assert.equal(siteLinks[0].textContent, "Plug-ins");
  assert.equal(siteLinks[0].getAttribute("href"), `${SITE_ROOT}plugins.html`);
  assert.equal(siteLinks[1].textContent, "About");
  assert.equal(siteLinks[1].getAttribute("href"), SITE_ROOT);
  const currentLinks = links.filter((link) => link.getAttribute("aria-current") === "page");
  assert.equal(currentLinks.length, 1);
  assert.equal(currentLinks[0].getAttribute("data-tool-id"), "julia");

  assert.equal(doc.select.children.length, TOOL_GROUPS.length + 1);
  assert.deepEqual(
    doc.select.children.map((group) => group.label),
    [...TOOL_GROUPS.map((group) => group.label), "Information"],
  );
  const selectedOptions = doc.select.findAll((node) => node.tagName === "OPTION" && node.selected);
  assert.equal(selectedOptions.length, 1);
  assert.equal(selectedOptions[0].textContent, "Julia");
  assert.equal(doc.select.getAttribute("aria-label"), "Morphazoid page");

  let prevented = false;
  details.open = true;
  details.dispatch("keydown", {
    key: "Escape",
    preventDefault() { prevented = true; },
  });
  assert.equal(details.open, false);
  assert.equal(prevented, true);
  assert.equal(summary.focused, true);

  details.open = true;
  doc.dispatch("pointerdown", { target: new FakeNode("div") });
  assert.equal(details.open, false);
  details.open = true;
  doc.dispatch("pointerdown", { target: summary });
  assert.equal(details.open, true);
});

test("About is current in both forms of the shared main menu", () => {
  const doc = new FakeDocument();
  const result = enhanceSharedNavigation(doc, {
    currentHref: `${SITE_ROOT}about.html`,
    siteRoot: SITE_ROOT,
  });

  assert.equal(result.activeTool, null);
  assert.equal(result.activeSiteLink?.id, "about");

  const currentDesktopLinks = doc.tabs.findAll(
    (node) => node.tagName === "A" && node.getAttribute("aria-current") === "page",
  );
  assert.equal(currentDesktopLinks.length, 1);
  assert.equal(currentDesktopLinks[0].textContent, "About");

  const selectedOptions = doc.select.findAll(
    (node) => node.tagName === "OPTION" && node.selected,
  );
  assert.equal(selectedOptions.length, 1);
  assert.equal(selectedOptions[0].textContent, "About");
});

test("top Audio button icons normalize across glyph and dot markup", async () => {
  const glyph = new FakeNode("span");
  glyph.className = "audio-glyph chaotic-fm-audio-glyph";
  glyph.textContent = "≋";
  const dot = new FakeNode("span");
  dot.className = "audio-dot";

  normalizeAudioButtonIcons({
    querySelectorAll(selector) {
      assert.equal(selector, ".audio-glyph, .audio-dot");
      return [glyph, dot];
    },
  });

  for (const icon of [glyph, dot]) {
    assert.equal(icon.textContent, "◉");
    assert.equal(icon.classList.contains("audio-glyph"), true);
    assert.equal(icon.getAttribute("aria-hidden"), "true");
  }

  const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.audio-button \.audio-glyph,\s*\.audio-button \.audio-dot\s*\{/);
  assert.match(
    css,
    /\.audio-button \.audio-glyph::before,\s*\.audio-button \.audio-dot::before\s*\{\s*content: "◉";/,
  );
});

test("Plug-ins is current in both forms of the shared main menu", () => {
  const doc = new FakeDocument();
  const result = enhanceSharedNavigation(doc, {
    currentHref: `${SITE_ROOT}plugins.html`,
    siteRoot: SITE_ROOT,
  });

  assert.equal(result.activeTool, null);
  assert.equal(result.activeSiteLink?.id, "plugins");

  const currentDesktopLinks = doc.tabs.findAll(
    (node) => node.tagName === "A" && node.getAttribute("aria-current") === "page",
  );
  assert.equal(currentDesktopLinks.length, 1);
  assert.equal(currentDesktopLinks[0].textContent, "Plug-ins");

  const selectedOptions = doc.select.findAll(
    (node) => node.tagName === "OPTION" && node.selected,
  );
  assert.equal(selectedOptions.length, 1);
  assert.equal(selectedOptions[0].textContent, "Plug-ins");
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
    id: "test-instrument",
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
    /@media \(min-width: 651px\) and \(max-width: 900px\)[\s\S]+\.masthead\.has-midi-toolbar \.tabs\.tools-nav \+ \.mobile-instrument-nav/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \{\s+height: auto;[\s\S]*?flex-wrap: wrap;/,
  );
  assert.match(
    css,
    /\.masthead\.has-midi-toolbar \.audio-strip \{\s+width: 100%;[\s\S]*?grid-template-columns: 56px minmax\(0, 1fr\);/,
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

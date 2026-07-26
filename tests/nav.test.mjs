import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_GROUPS,
  enhanceSharedNavigation,
  initializeSharedNavigation,
  normalizeNavigationPath,
  resolveActiveTool,
} from "../nav.js";

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

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  contains(target) {
    return this === target || this.children.some((child) => child.contains(target));
  }

  focus() {
    this.focused = true;
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

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

test("tool registry is categorized, unique, and includes Morphazoidical", () => {
  assert.deepEqual(
    TOOL_GROUPS.map((group) => group.label),
    [
      "Geometry",
      "Fractals & Recursion",
      "Barber Shop Poles",
      "Chaotic Synths",
      "Audio & Mic",
      "Analysis",
      "Workbench",
    ],
  );
  const tools = TOOL_GROUPS.flatMap((group) => group.tools);
  assert.equal(tools.length, 23);
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
    tools.find((tool) => tool.id === "morphazoidical"),
    {
      id: "morphazoidical",
      label: "Morphazoidical",
      href: "morphazoidical/",
      match: "directory",
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
      { id: "weierstrass", href: "weierstrass.html" },
    ],
  );
});

test("active tool resolution preserves GitHub Pages subpaths and nested workbench pages", () => {
  assert.equal(normalizeNavigationPath(`${SITE_ROOT}index.html?mode=test`, SITE_ROOT), "/blechdom/morphazoid/");
  assert.equal(resolveActiveTool("https://example.test/blechdom/morphazoid", SITE_ROOT)?.id, "shape");
  assert.equal(resolveActiveTool(`${SITE_ROOT}spiral.html#reader`, SITE_ROOT)?.id, "spiral");
  assert.equal(resolveActiveTool(`${SITE_ROOT}graph-delay.html`, SITE_ROOT)?.id, "graph-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}audio-engine-lab.html`, SITE_ROOT)?.id, "audio-engine-lab");
  assert.equal(resolveActiveTool(`${SITE_ROOT}shepard-risset.html`, SITE_ROOT)?.id, "shepard-risset");
  assert.equal(resolveActiveTool(`${SITE_ROOT}candy-coil-delay.html`, SITE_ROOT)?.id, "candy-coil-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}striped-sludge-delay.html`, SITE_ROOT)?.id, "striped-sludge-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}sandy-syrup-delay.html`, SITE_ROOT)?.id, "sandy-syrup-delay");
  assert.equal(resolveActiveTool(`${SITE_ROOT}recursive-fm.html`, SITE_ROOT)?.id, "recursive-fm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}recursive-pm.html`, SITE_ROOT)?.id, "recursive-pm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}chaotic-fm.html`, SITE_ROOT)?.id, "chaotic-fm");
  assert.equal(resolveActiveTool(`${SITE_ROOT}weierstrass.html`, SITE_ROOT)?.id, "weierstrass");
  assert.equal(resolveActiveTool(`${SITE_ROOT}analyzer.html`, SITE_ROOT)?.id, "analyzer");
  assert.equal(resolveActiveTool(`${SITE_ROOT}morphazoidical/`, SITE_ROOT)?.id, "morphazoidical");
  assert.equal(resolveActiveTool(`${SITE_ROOT}morphazoidical/atlas.html`, SITE_ROOT)?.id, "morphazoidical");
  assert.equal(resolveActiveTool(`${SITE_ROOT}unknown.html`, SITE_ROOT), null);
});

test("shared navigation generates one grouped disclosure and grouped mobile options", () => {
  const doc = new FakeDocument();
  const result = enhanceSharedNavigation(doc, {
    currentHref: `${SITE_ROOT}julia.html`,
    siteRoot: SITE_ROOT,
  });

  assert.equal(result.activeTool?.id, "julia");
  assert.equal(result.disclosures.length, 1);
  assert.equal(doc.tabs.getAttribute("aria-label"), "Morphazoid tools");
  assert.equal(doc.tabs.classList.contains("tools-nav"), true);

  const details = result.disclosures[0];
  assert.equal(details.tagName, "DETAILS");
  const summary = details.children[0];
  assert.equal(summary.tagName, "SUMMARY");
  assert.equal(summary.getAttribute("aria-label"), "Tools. Current tool: Julia");
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
  const links = details.findAll((node) => node.tagName === "A");
  assert.equal(links.length, 23);
  const currentLinks = links.filter((link) => link.getAttribute("aria-current") === "page");
  assert.equal(currentLinks.length, 1);
  assert.equal(currentLinks[0].getAttribute("data-tool-id"), "julia");

  assert.equal(doc.select.children.length, TOOL_GROUPS.length);
  assert.deepEqual(
    doc.select.children.map((group) => group.label),
    TOOL_GROUPS.map((group) => group.label),
  );
  const selectedOptions = doc.select.findAll((node) => node.tagName === "OPTION" && node.selected);
  assert.equal(selectedOptions.length, 1);
  assert.equal(selectedOptions[0].textContent, "Julia");
  assert.equal(doc.select.getAttribute("aria-label"), "Tool");

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

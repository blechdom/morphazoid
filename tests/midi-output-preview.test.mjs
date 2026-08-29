import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MIDI_OUTPUT_PREVIEW_EVENT,
  createMidiOutputPreviewState,
  emitMidiOutputPreview,
  initializeMidiOutputMonitor,
  midiNoteName,
  normalizeMidiOutputPreview,
  normalizedMidiValue,
  reduceMidiOutputPreview,
} from "../src/midi-output-preview.js";

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  values() { return new Set(this.owner.className.split(/\s+/).filter(Boolean)); }
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
  contains(token) { return this.values().has(token); }
}

class FakeNode {
  constructor(tagName, ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.classList = new FakeClassList(this);
    this.attributes = new Map();
    this.dataset = {};
    this.textContent = "";
    this.open = false;
    this.id = "";
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode?.removeChild?.(node);
      node.parentNode = this;
      this.children.push(node);
    }
  }
  insertBefore(node, reference) {
    node.parentNode?.removeChild?.(node);
    const index = this.children.indexOf(reference);
    node.parentNode = this;
    if (index < 0) this.children.push(node);
    else this.children.splice(index, 0, node);
  }
  removeChild(node) {
    this.children = this.children.filter((child) => child !== node);
    node.parentNode = null;
  }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this.append(...nodes);
  }
  remove() { this.parentNode?.removeChild?.(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    return false;
  }
  findAll(predicate) {
    const found = predicate(this) ? [this] : [];
    for (const child of this.children) found.push(...child.findAll(predicate));
    return found;
  }
  querySelector(selector) {
    if (selector.startsWith(".")) {
      return this.findAll((node) => node.classList.contains(selector.slice(1)))[0] ?? null;
    }
    if (selector.startsWith("#")) {
      return this.findAll((node) => node.id === selector.slice(1))[0] ?? null;
    }
    const outputFor = selector.match(/^output\[for="([^"]+)"\]$/);
    if (outputFor) {
      return this.findAll((node) => (
        node.tagName === "OUTPUT" && node.getAttribute("for") === outputFor[1]
      ))[0] ?? null;
    }
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeNode("body", this);
    this.panel = new FakeNode("aside", this);
    this.panel.className = "panel";
    this.body.append(this.panel);
    this.listeners = new Map();
  }
  createElement(tagName) { return new FakeNode(tagName, this); }
  querySelector(selector) {
    return this.body.querySelector(selector);
  }
  querySelectorAll(selector) {
    if (selector === "input[type='range']") {
      return this.body.findAll((node) => (
        node.tagName === "INPUT" && String(node.type).toLowerCase() === "range"
      ));
    }
    return [];
  }
  getElementById(id) { return this.body.findAll((node) => node.id === id)[0] ?? null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }
}

function fakeRuntime() {
  const listeners = new Map();
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  return {
    listeners,
    CustomEvent,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    queueMicrotask(callback) { callback(); },
    setTimeout,
    clearTimeout,
  };
}

test("continuous instrument values become truthful unassigned 7-bit candidates", () => {
  assert.equal(normalizedMidiValue(0.5, 0, 1), 64);
  assert.equal(normalizedMidiValue(-1, -1, 1), 0);
  assert.equal(normalizedMidiValue(1, -1, 1), 127);

  const event = normalizeMidiOutputPreview({
    kind: "control",
    source: "Pattern angle",
    rawValue: 45,
    min: 0,
    max: 90,
    unit: "degrees",
  }, 12.5);
  assert.deepEqual(event, {
    kind: "control",
    source: "Pattern angle",
    sourceId: "pattern-angle",
    routeId: "",
    channel: null,
    timestamp: 12.5,
    mapped: false,
    sent: false,
    label: "Pattern angle",
    rawValue: 45,
    min: 0,
    max: 90,
    value: 64,
    unit: "degrees",
    displayValue: "",
  });
});

test("trusted range movement previews its formatted value and unassigned 7-bit position", () => {
  const doc = new FakeDocument();
  const runtime = fakeRuntime();
  const range = new FakeNode("input", doc);
  range.id = "patternAngle";
  range.type = "range";
  range.min = "0";
  range.max = "90";
  range.value = "45";
  range.disabled = false;
  range.setAttribute("aria-label", "Pattern angle");
  doc.panel.append(range);
  const monitor = initializeMidiOutputMonitor(doc, runtime, {
    routeId: "lattice",
    capability: { midiOutput: true },
  });

  for (const listener of doc.listeners.get("input") ?? []) {
    listener({ target: range, isTrusted: true });
  }
  for (const listener of doc.listeners.get("change") ?? []) {
    listener({ target: range, isTrusted: true });
  }
  assert.equal(monitor.state.control.sourceId, "patternAngle");
  assert.equal(monitor.state.control.value, 64);
  assert.equal(monitor.state.control.sent, false);
  assert.equal(monitor.state.eventCount, 1, "input/change at the same value is coalesced");
  assert.match(
    doc.panel.querySelector(".midi-output-monitor-latest").textContent,
    /Pattern angle · 64\/127 candidate/,
  );
  monitor.destroy();
});

test("generic timing uses displayed musical units and rejects rate-shaped non-time controls", () => {
  const doc = new FakeDocument();
  const runtime = fakeRuntime();
  const addRange = ({ id, label, value, min, max, display }) => {
    const range = new FakeNode("input", doc);
    range.id = id;
    range.type = "range";
    range.min = String(min);
    range.max = String(max);
    range.value = String(value);
    range.disabled = false;
    range.setAttribute("aria-label", label);
    const output = new FakeNode("output", doc);
    output.setAttribute("for", id);
    output.textContent = display;
    doc.panel.append(range, output);
    return range;
  };
  const traversal = addRange({
    id: "speed",
    label: "Traversal speed",
    value: 0.3386,
    min: -1,
    max: 1,
    display: "-0.017 cyc/s",
  });
  const tempo = addRange({
    id: "tempo",
    label: "Branch rate",
    value: 168,
    min: 40,
    max: 240,
    display: "168 BPM",
  });
  const feed = addRange({
    id: "feedRate",
    label: "Feed rate",
    value: 0.055,
    min: 0,
    max: 0.1,
    display: "55%",
  });
  const monitor = initializeMidiOutputMonitor(doc, runtime, {
    routeId: "reaction-diffusion",
    capability: { midiOutput: true },
  });
  const publish = (target) => {
    for (const listener of doc.listeners.get("input") ?? []) {
      listener({ target, isTrusted: true });
    }
  };

  publish(traversal);
  assert.equal(monitor.state.timebase.rate, -0.017, "displayed nonlinear/signed rate is authoritative");
  assert.equal(monitor.state.timebase.unit, "cyc/s");
  assert.equal(monitor.state.timebase.running, null);

  publish(tempo);
  assert.equal(monitor.state.clock.bpm, 168);
  assert.equal(monitor.state.clock.running, null);

  publish(feed);
  assert.equal(monitor.state.timebases.length, 1, "non-temporal Feed rate is not called a timebase");
  monitor.destroy();
});

test("deferred initial timing shows generic BPM but skips app-owned exact telemetry", async () => {
  const doc = new FakeDocument();
  const runtime = fakeRuntime();
  const addRange = ({ id, label, value, min, max, display, excluded = false }) => {
    const range = new FakeNode("input", doc);
    range.id = id;
    range.type = "range";
    range.min = String(min);
    range.max = String(max);
    range.value = String(value);
    range.disabled = false;
    range.setAttribute("aria-label", label);
    if (excluded) range.setAttribute("data-no-midi-preview", "");
    const output = new FakeNode("output", doc);
    output.setAttribute("for", id);
    output.textContent = display;
    doc.panel.append(range, output);
  };
  addRange({ id: "tempo", label: "Branch rate", value: 144, min: 40, max: 240, display: "144 BPM" });
  addRange({
    id: "speed",
    label: "Pattern speed",
    value: 0.3386,
    min: 0,
    max: 1,
    display: "0.080 cyc/s",
    excluded: true,
  });
  const monitor = initializeMidiOutputMonitor(doc, runtime, {
    routeId: "dijkstra",
    capability: { midiOutput: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 8));

  assert.equal(monitor.state.clock.bpm, 144);
  assert.equal(monitor.state.timebases.length, 0, "app-owned timebase stays out of generic seeding");
  monitor.destroy();
});

test("note previews retain channel, velocity, gate, and readable pitch", () => {
  assert.equal(midiNoteName(60), "C4");
  assert.equal(midiNoteName(127), "G9");

  const note = normalizeMidiOutputPreview({
    kind: "note",
    source: "Reader crossing",
    channel: 10,
    note: 36,
    velocity: 108,
    frequencyHz: 65.406,
    durationMs: 95,
  }, 20);
  assert.equal(note.noteName, "C2");
  assert.equal(note.action, "on");
  assert.equal(note.velocity, 108);
  assert.equal(note.channel, 10);
  assert.equal(note.frequencyHz, 65.406);
  assert.equal(note.durationMs, 95);

  const off = normalizeMidiOutputPreview({
    kind: "note",
    note: 36,
    velocity: 0,
  });
  assert.equal(off.action, "off");
});

test("clock and transport remain previews rather than routed MIDI", () => {
  const clock = normalizeMidiOutputPreview({
    kind: "clock",
    source: "Tempo",
    bpm: 123.5,
    running: true,
  });
  assert.equal(clock.bpm, 123.5);
  assert.equal(clock.ppqn, 24);
  assert.equal(clock.running, true);
  assert.equal(clock.mapped, false);
  assert.equal(clock.sent, false);

  const rate = normalizeMidiOutputPreview({
    kind: "timebase",
    source: "Pattern speed",
    rate: 0.36,
    unit: "cycles/s",
  });
  assert.equal(rate.rate, 0.36);
  assert.equal(rate.kind, "timebase");
  assert.equal(rate.mapped, false);

  const transport = normalizeMidiOutputPreview({
    kind: "transport",
    source: "Play",
    state: "continue",
    position: 48,
  });
  assert.equal(transport.state, "continue");
  assert.equal(transport.position, 48);
  assert.throws(
    () => normalizeMidiOutputPreview({ kind: "transport", state: "rewind" }),
    /Unknown MIDI transport preview state/,
  );
});

test("generic transport follows real state mutations, including programmatic stop", () => {
  const doc = new FakeDocument();
  const runtime = fakeRuntime();
  let notify = null;
  let disconnected = false;
  runtime.MutationObserver = class {
    constructor(callback) { notify = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const play = new FakeNode("button", doc);
  play.id = "playButton";
  play.setAttribute("aria-label", "Play sequence");
  play.setAttribute("aria-pressed", "false");
  doc.panel.append(play);
  const monitor = initializeMidiOutputMonitor(doc, runtime, {
    routeId: "dijkstra",
    capability: { midiOutput: true },
  });
  assert.equal(monitor.state.transport.state, "stop");

  play.setAttribute("aria-pressed", "true");
  notify();
  assert.equal(monitor.state.transport.state, "start");
  play.setAttribute("aria-pressed", "false");
  notify();
  assert.equal(monitor.state.transport.state, "stop");
  assert.equal(monitor.state.eventCount, 2);

  monitor.destroy();
  assert.equal(disconnected, true);
});

test("preview reducer preserves the latest value in every signal family", () => {
  let state = createMidiOutputPreviewState();
  state = reduceMidiOutputPreview(state, { kind: "transport", state: "start" });
  state = reduceMidiOutputPreview(state, { kind: "note", note: 64, velocity: 90 });
  state = reduceMidiOutputPreview(state, {
    kind: "control",
    source: "Density",
    label: "Density",
    rawValue: 0.25,
    min: 0,
    max: 1,
  });
  assert.equal(state.eventCount, 3);
  assert.equal(state.transport.state, "start");
  assert.equal(state.note.noteName, "E4");
  assert.equal(state.control.value, 32);
  assert.equal(state.controls.length, 1);
  assert.equal(state.last.kind, "control");
});

test("preview state retains polyphony and independent live signal sources", () => {
  let state = createMidiOutputPreviewState();
  state = reduceMidiOutputPreview(state, {
    kind: "note",
    source: "Reader A",
    note: 60,
    velocity: 90,
  });
  state = reduceMidiOutputPreview(state, {
    kind: "note",
    source: "Reader B",
    note: 67,
    velocity: 80,
  });
  state = reduceMidiOutputPreview(state, {
    kind: "control",
    source: "Phase",
    rawValue: 0.2,
    min: 0,
    max: 1,
  });
  state = reduceMidiOutputPreview(state, {
    kind: "control",
    source: "Pan",
    rawValue: -0.5,
    min: -1,
    max: 1,
  });
  state = reduceMidiOutputPreview(state, {
    kind: "transport",
    source: "Reader",
    state: "start",
  });
  state = reduceMidiOutputPreview(state, {
    kind: "transport",
    source: "Zoom",
    state: "stop",
  });

  assert.equal(state.activeNotes.length, 2);
  assert.deepEqual(state.controls.map(({ source }) => source), ["Pan", "Phase"]);
  assert.deepEqual(state.transports.map(({ source }) => source), ["Zoom", "Reader"]);

  state = reduceMidiOutputPreview(state, {
    kind: "note",
    source: "Reader A",
    note: 60,
    velocity: 0,
  });
  assert.equal(state.activeNotes.length, 1);
  assert.equal(state.activeNotes[0].noteName, "G4");
});

test("preview dispatch uses one public non-routing event contract", () => {
  const events = [];
  class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const runtime = {
    CustomEvent,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };

  const detail = emitMidiOutputPreview({
    kind: "note",
    source: "Contact",
    note: 67,
    velocity: 96,
  }, runtime);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, MIDI_OUTPUT_PREVIEW_EVENT);
  assert.equal(events[0].detail, detail);
  assert.equal(detail.noteName, "G4");
  assert.equal(detail.sent, false);
});

test("output-capable pages get one flow-contained live monitor and no routing controls", () => {
  const doc = new FakeDocument();
  const runtime = fakeRuntime();
  const monitor = initializeMidiOutputMonitor(doc, runtime, {
    routeId: "lattice",
    capability: { midiOutput: true },
  });
  assert.ok(monitor);
  assert.equal(doc.panel.children.length, 1);
  assert.equal(doc.panel.children[0].className, "midi-output-monitor");
  assert.equal(doc.panel.findAll((node) => node.tagName === "SELECT").length, 0);
  assert.equal(
    doc.panel.querySelector(".midi-output-monitor-badge").textContent,
    "PREVIEW · NOT ROUTED",
  );

  monitor.accept({
    kind: "note",
    routeId: "lattice",
    source: "Lattice crossing",
    note: 69,
    velocity: 104,
    frequencyHz: 440,
    durationMs: 90,
  });
  monitor.accept({
    kind: "control",
    routeId: "lattice",
    source: "Lattice pan",
    rawValue: -0.25,
    min: -1,
    max: 1,
    displayValue: "L 25%",
  });
  assert.equal(
    doc.panel.querySelector(".midi-output-monitor-badge").textContent,
    "LIVE · NOT ROUTED",
  );
  const values = doc.panel.findAll((node) => node.classList.contains("midi-output-monitor-value"));
  assert.equal(values.some((node) => node.textContent === "A4 · 69 · VEL 104"), true);
  assert.equal(values.some((node) => node.textContent === "L 25%"), true);
  assert.equal(
    doc.panel.findAll((node) => node.tagName === "SMALL")
      .some((node) => /Lattice crossing.*440 HZ.*GATE 90 MS CANDIDATE/.test(node.textContent)),
    true,
  );
  assert.match(doc.panel.querySelector(".midi-output-monitor-latest").textContent, /Lattice pan.*48\/127 candidate/);
  assert.equal(
    doc.panel.findAll((node) => node.tagName === "SMALL")
      .some((node) => /CC — · 48\/127 CANDIDATE/.test(node.textContent)),
    true,
  );
  assert.equal(
    initializeMidiOutputMonitor(doc, runtime, {
      routeId: "lattice",
      capability: { midiOutput: true },
    }),
    monitor,
    "monitor initialization is idempotent",
  );

  monitor.destroy();
  assert.equal(doc.panel.children.length, 0);
  assert.equal(runtime.listeners.get(MIDI_OUTPUT_PREVIEW_EVENT)?.length, 0);
});

test("the modular synth keeps its MIDI monitor inside the inspector grid child", () => {
  const doc = new FakeDocument();
  const runtime = fakeRuntime();
  doc.body.removeChild(doc.panel);

  const workspace = new FakeNode("main", doc);
  workspace.className = "playground-workspace";
  const moduleBrowser = new FakeNode("aside", doc);
  moduleBrowser.className = "module-browser";
  const workbench = new FakeNode("section", doc);
  workbench.className = "patch-workbench";
  const inspector = new FakeNode("aside", doc);
  inspector.className = "node-inspector";
  workspace.append(moduleBrowser, workbench, inspector);
  doc.body.append(workspace);

  const monitor = initializeMidiOutputMonitor(doc, runtime, {
    routeId: "shader-synth-playground",
    capability: { midiOutput: true },
  });

  assert.equal(workspace.children.length, 3, "the three-column workspace must not gain a second grid row");
  assert.equal(inspector.children.at(-1), monitor.monitor);

  monitor.destroy();
});

test("non-output routes and WAX hosts do not receive a duplicate browser monitor", () => {
  const doc = new FakeDocument();
  assert.equal(initializeMidiOutputMonitor(doc, fakeRuntime(), {
    routeId: "graph-delay",
    capability: { midiOutput: false },
  }), null);
  assert.equal(doc.panel.children.length, 0);

  const waxRuntime = { ...fakeRuntime(), MorphazoidWAX: {} };
  assert.equal(initializeMidiOutputMonitor(doc, waxRuntime, {
    routeId: "lattice",
    capability: { midiOutput: true },
  }), null);
  assert.equal(doc.panel.children.length, 0);
});

test("finite preview notes leave the monitor's active set after their gate", async () => {
  const doc = new FakeDocument();
  const monitor = initializeMidiOutputMonitor(doc, fakeRuntime(), {
    routeId: "spiral-drums",
    capability: { midiOutput: true },
  });
  monitor.accept({
    kind: "note",
    routeId: "spiral-drums",
    source: "Drum crossing",
    voiceId: "edge:4",
    channel: 10,
    note: 40,
    velocity: 110,
    durationMs: 2,
  });
  assert.equal(monitor.state.activeNotes.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.equal(monitor.state.activeNotes.length, 0);
  assert.equal(monitor.state.note.action, "off");
  monitor.destroy();
});

test("exact geometry preview controls are excluded before shared navigation initializes", async () => {
  const pages = new Map(await Promise.all([
    "lattice.html",
    "lattice-drums.html",
    "spiral.html",
    "spiral-drums.html",
  ].map(async (file) => [
    file,
    await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
  ])));
  const expectedIds = new Map([
    ["lattice.html", ["playButton", "position", "speed"]],
    ["lattice-drums.html", ["playButton", "position", "speed"]],
    ["spiral.html", ["playButton", "loopPlayButton", "position", "speed", "loopPhase", "loopSpeed"]],
    ["spiral-drums.html", ["playButton", "loopPlayButton", "position", "speed", "loopPhase", "loopSpeed"]],
  ]);

  for (const [file, ids] of expectedIds) {
    const html = pages.get(file);
    for (const id of ids) {
      const openingTag = html.match(new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`))?.[0] ?? "";
      assert.match(
        openingTag,
        /\bdata-no-midi-preview(?:\s|=|>)/,
        `${file} #${id} must suppress generic capture before its exact app starts`,
      );
    }
  }
});

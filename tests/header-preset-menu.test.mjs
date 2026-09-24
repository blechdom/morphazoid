import assert from "node:assert/strict";
import test from "node:test";
import { registerHeaderPresets } from "../src/site/header-presets.js";

// Minimal DOM fixture: exercise the real menu composition/recall without
// starting a browser or importing any instrument/audio implementation.
class Element {
  constructor(tagName, ownerDocument) {
    Object.assign(this, {
      tagName: tagName.toUpperCase(), ownerDocument, children: [], parentNode: null,
      className: "", dataset: {}, style: {}, attributes: new Map(), listeners: new Map(),
      textContent: "", value: "", open: false,
    });
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), name])].join(" "); },
      remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(" "); },
    };
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  before(node) {
    node.remove();
    const parent = this.parentNode;
    node.parentNode = parent;
    parent.children.splice(parent.children.indexOf(this), 0, node);
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  addEventListener(type, callback, options = {}) {
    if (options.signal?.aborted) return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    options.signal?.addEventListener("abort", () => this.removeEventListener(type, callback), { once: true });
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) { for (const callback of this.listeners.get(type) ?? []) callback(event); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  matches(selector) { if (selector.startsWith("[")) return this.attributes.has(selector.slice(1, -1)); return selector.startsWith(".") ? this.classList.contains(selector.slice(1)) : this.id === selector.slice(1); }
  querySelector(selector) { return this.descendants().find(node => node.matches(selector)) ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null; }
  contains(target) { return target === this || this.descendants().includes(target); }
  getBoundingClientRect() { return { left: 820, bottom: 48 }; }
  focus() { this.ownerDocument.activeElement = this; }
}

function randomFixture(options = {}) {
  const doc = new Element("document");
  doc.ownerDocument = doc;
  doc.documentElement = { clientWidth: 390, clientHeight: 844 };
  doc.createElement = tag => new Element(tag, doc);
  doc.createElementNS = (_, tag) => doc.createElement(tag);
  const header = doc.createElement("header"), io = doc.createElement("div"), meter = doc.createElement("div");
  header.className = "masthead"; meter.className = "header-output-meter-shell";
  io.append(meter); header.append(io); doc.append(header);
  const rail = doc.createElement("aside"); rail.setAttribute("data-instrument-preset-host", ""); doc.append(rail);
  const runtime = new Element("window", doc);
  runtime.AbortController = AbortController;
  runtime.queueMicrotask = callback => callback();
  const errors = [];
  runtime.console = { error: (...message) => errors.push(message) };
  const presets = Array.from({ length: 12 }, (_, value) => ({ id: `p-${value}`, label: `Scene ${value}`, snapshot: { value } }));
  let state = { value: 0 }, applies = 0;
  const controller = registerHeaderPresets({
    id: "test", presets, document: doc, runtime,
    capture: () => state,
    apply: snapshot => { applies++; state = options.apply ? options.apply(snapshot) : snapshot; },
    randomize: options.randomize ?? ((previous, rng) => ({ value: previous.value + rng() / 2 })),
    random: () => 0.5,
  });
  return { doc, controller, errors, state: () => state, applies: () => applies };
}

test("dice is an accessible ordinary button; random settings become Custom and a preset restores them", () => {
  const fixture = randomFixture();
  try {
    const dice = fixture.doc.querySelector(".header-preset-random");
    assert.equal(dice.type, "button");
    assert.equal(dice.attributes.get("aria-label"), "Randomize instrument parameters");
    assert.equal(dice.children[0].attributes.get("aria-hidden"), "true");
    assert.equal(dice.children[0].attributes.get("focusable"), "false");
    assert.equal(fixture.applies(), 0);
    dice.emit("click");
    assert.deepEqual(fixture.state(), { value: 0.25 });
    assert.equal(fixture.controller.selectedId, null);
    assert.match(fixture.doc.querySelector(".sr-only").textContent, /randomized/);
    fixture.controller.view.select("p-3");
    assert.deepEqual(fixture.state(), { value: 3 });
    assert.equal(fixture.controller.selectedId, "p-3");
    const applies = fixture.applies();
    fixture.controller.destroy();
    dice.emit("click");
    assert.equal(fixture.applies(), applies, "teardown unbinds the dice");
  } finally { fixture.controller.destroy(); }
});

test("every page starts at Select Preset even when its defaults match a factory record", () => {
  const fixture = randomFixture();
  try {
    const label = fixture.doc.querySelector(".instrument-picker-current");
    const root = fixture.doc.querySelector(".header-preset-controls");
    assert.equal(label.textContent, "Select Preset");
    assert.equal(root.dataset.presetId, "unselected");
    assert.equal(fixture.controller.selectedId, null);
    assert.equal(fixture.applies(), 0);
    fixture.state().value = 5; // manual/programmatic state matching is not a menu choice
    fixture.controller.refresh();
    assert.equal(label.textContent, "Select Preset");
    fixture.doc.querySelector(".header-preset-next").emit("click");
    assert.equal(fixture.controller.selectedId, "p-0", "first next action must load the first preset, not skip it");
    assert.equal(label.textContent, "Scene 0");
    assert.equal(fixture.applies(), 1);
    fixture.controller.view.select("p-0");
    assert.equal(fixture.applies(), 2, "a selected row still recalls its settings");
  } finally { fixture.controller.destroy(); }
});

test("invalid, asynchronous, no-op and factory-only randomizers do not apply anything", () => {
  for (const randomize of [
    () => ({ value: NaN }), () => undefined, () => Promise.resolve({ value: 0.2 }),
    previous => previous, () => ({ value: 5 }),
    previous => { previous.value = 8; throw new Error("injected"); },
  ]) {
    const fixture = randomFixture({ randomize });
    try {
      fixture.controller.view.randomize();
      assert.deepEqual(fixture.state(), { value: 0 }, "failed preparation never mutates live state");
      assert.equal(fixture.applies(), 0);
      assert.equal(fixture.errors.length, 1);
      assert.match(fixture.doc.querySelector(".sr-only").textContent, /not randomized/);
    } finally { fixture.controller.destroy(); }
  }
});

test("partial and throwing random recall roll back to the previous complete snapshot", () => {
  for (const apply of [
    snapshot => snapshot.value === 0.25 ? { value: 42 } : snapshot,
    snapshot => { if (snapshot.value === 0.25) throw new Error("injected"); return snapshot; },
  ]) {
    const fixture = randomFixture({ apply });
    try {
      fixture.controller.view.randomize();
      assert.deepEqual(fixture.state(), { value: 0 });
      assert.equal(fixture.applies(), 2);
      assert.equal(fixture.controller.selectedId, null, "failed first action retains Select Preset");
      assert.equal(fixture.doc.querySelector(".instrument-picker-current").textContent, "Select Preset");
      assert.equal(fixture.errors.length, 1);
    } finally { fixture.controller.destroy(); }
  }
});

test("arrows on the dice still browse presets; ordinary dice activation alone randomizes", () => {
  const fixture = randomFixture();
  try {
    const dice = fixture.doc.querySelector(".header-preset-random");
    const event = {
      key: "ArrowRight", target: dice, preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() {},
    };
    fixture.doc.emit("keydown", event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(fixture.state(), { value: 0 });
    fixture.doc.emit("keydown", { ...event, defaultPrevented: false });
    assert.deepEqual(fixture.state(), { value: 1 });
    dice.emit("click");
    assert.deepEqual(fixture.state(), { value: 1.25 });
  } finally { fixture.controller.destroy(); }
});

test("the next arrow retains its tour position after a generative score or manual edit becomes Custom", () => {
  const fixture = randomFixture();
  try {
    fixture.controller.view.select("p-5");
    fixture.controller.view.randomize();
    assert.equal(fixture.controller.selectedId, null);
    fixture.doc.querySelector(".header-preset-next").emit("click");
    assert.equal(fixture.controller.selectedId, "p-6");
  } finally { fixture.controller.destroy(); }
});

for (const withMidi of [true, false]) {
test(`main preset menu has only full scene choices and preserves control order (MIDI ${withMidi ? "present" : "absent"})`, () => {
  const doc = new Element("document");
  doc.ownerDocument = doc;
  doc.documentElement = { clientWidth: 1440, clientHeight: 900 };
  doc.createElement = tag => new Element(tag, doc);
  doc.createElementNS = (_, tag) => doc.createElement(tag);
  const header = doc.createElement("header");
  header.className = "masthead";
  const io = doc.createElement("div"), meter = doc.createElement("div");
  meter.className = "header-output-meter-shell";
  const midi = doc.createElement("div"), midiButton = doc.createElement("button");
  midi.className = "midi-toolbar";
  midiButton.setAttribute("aria-pressed", "true");
  let midiClicks = 0;
  midiButton.addEventListener("click", () => { midiClicks++; });
  midi.append(midiButton);
  const audio = doc.createElement("div"), settings = doc.createElement("details");
  audio.className = "audio-strip";
  settings.className = "header-settings-menu";
  io.append(...(withMidi ? [midi] : []), meter, audio, settings);
  header.append(io);
  const originalIoOrder = [...io.children];
  const rail = doc.createElement("aside"), body = doc.createElement("select"), pattern = doc.createElement("select");
  body.id = "bodyPresets"; pattern.id = "sequencePresets";
  rail.setAttribute("data-instrument-preset-host", "");
  rail.append(body, pattern); doc.append(header, rail);
  const presets = Array.from({ length: 12 }, (_, index) => ({
    id: `scene-${index}`, label: `Full scene ${index}`, snapshot: { value: index },
  }));
  let state = { value: 0 }, recalls = 0;
  const runtime = new Element("window", doc);
  runtime.AbortController = AbortController;
  runtime.queueMicrotask = callback => callback();
  const options = {
    id: "fixture", presets,
    capture: () => state,
    apply: next => { state = next; recalls++; },
    randomize: previous => ({ value: previous.value + 0.125 }),
    // Old callers must not be able to put local editors back inside this menu.
    ingredientSelectors: ["#bodyPresets", "#sequencePresets"],
    document: doc, runtime,
  };
  const controller = registerHeaderPresets(options);
  try {
    const root = doc.querySelector(".header-preset-controls");
    const picker = root.querySelector(".header-preset-picker");
    const list = picker.querySelector(".instrument-picker-list");
    assert.equal(recalls, 0, "registration must not change instrument settings");
    assert.equal(root.parentNode, rail);
    assert.deepEqual(header.children, [io], "MIDI must not be pulled into the middle of the masthead");
    assert.deepEqual(io.children, originalIoOrder, "presets no longer displace header controls");
    assert.deepEqual(root.children.slice(0, 3).map(node => node.className),
      ["instrument-picker header-preset-picker", "instrument-picker-next header-preset-next",
        "instrument-picker-next header-preset-random"], "dice is immediately after next in the right panel");
    if (withMidi) {
      assert.equal(midi.parentNode, io);
      assert.equal(midiButton.attributes.get("aria-pressed"), "true", "moving the preset control must not reset enabled MIDI");
      midiButton.emit("click");
      assert.equal(midiClicks, 1, "the original MIDI button retains its handler");
    }
    assert.deepEqual(rail.children, [root, body, pattern]);
    assert.equal(picker.descendants().some(node => ["SELECT", "DETAILS"].includes(node.tagName)), false);
    assert.equal(list.children.length, 13, "twelve scene rows plus the empty-result message");
    const buttons = list.descendants().filter(node => node.tagName === "BUTTON");
    assert.equal(buttons.length, presets.length);
    assert.ok(buttons.every(node => Object.hasOwn(node.dataset, "fullPreset")));
    assert.equal(picker.descendants().some(node => node.textContent === "Edit preset ingredients"), false);
    buttons[3].emit("click");
    assert.equal(recalls, 1);
    assert.deepEqual(state, { value: 3 });
    assert.equal(controller.selectedId, "scene-3");
    root.querySelector(".header-preset-next").emit("click");
    assert.deepEqual(state, { value: 4 });
    root.querySelector(".header-preset-random").emit("click");
    assert.deepEqual(state, { value: 4.125 });
    assert.equal(controller.selectedId, null);
    assert.equal(root.dataset.presetId, "custom");
    assert.deepEqual(rail.children, [root, body, pattern], "recall never moves local editors");
  } finally {
    controller.destroy();
  }
  assert.equal(doc.querySelector(".header-preset-controls"), null);
  assert.deepEqual(rail.children, [body, pattern], "teardown also leaves editors in place");
  assert.deepEqual(io.children, originalIoOrder, "teardown leaves MIDI/meters/Audio/settings in their original group");
  const remounted = registerHeaderPresets(options);
  try {
    assert.deepEqual(header.children, [io]);
    assert.equal(rail.children[0], doc.querySelector(".header-preset-controls"));
    assert.deepEqual(io.children, originalIoOrder, "reinitialization cannot duplicate or move MIDI");
    if (withMidi) {
      midiButton.emit("click");
      assert.equal(midiClicks, 2, "reinitialization does not double-bind the MIDI control");
    }
  } finally {
    remounted.destroy();
  }
});
}

import assert from "node:assert/strict";
import test from "node:test";
import { captureHeaderPresetState, registerHeaderPresets } from "../src/site/header-presets.js";

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
  getAttribute(key) { return this.attributes.get(key) ?? null; }
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
  runtime.queueMicrotask = options.queueMicrotask ?? (callback => callback());
  const errors = [];
  runtime.console = { error: (...message) => errors.push(message) };
  const presets = Array.from({ length: 12 }, (_, value) => ({ id: `p-${value}`, label: `Scene ${value}`, snapshot: { value } }));
  let state = { value: 0 }, applies = 0;
  const controller = registerHeaderPresets({
    id: "test", presets, document: doc, runtime,
    capture: () => { options.onCapture?.(); return state; },
    apply: snapshot => {
      applies++;
      const result = options.apply ? options.apply(snapshot) : snapshot;
      if (result?.then) return result.then(next => { state = next; });
      state = result;
    },
    randomize: options.randomize ?? ((previous, rng) => ({ value: previous.value + rng() / 2 })),
    random: () => 0.5, onApplied: options.onApplied, isPresetAvailable: options.isPresetAvailable,
  });
  return { doc, controller, errors, state: () => state, applies: () => applies };
}

// Count display writes, including assignments of the same attribute value.
// Repeated live-state checks must not cause menu mutation/layout churn.
function trackMenuMutations(fixture) {
  const writes = [], root = fixture.doc.querySelector(".header-preset-controls");
  for (const node of [root, ...root.descendants()]) {
    const setAttribute = node.setAttribute.bind(node);
    node.setAttribute = (key, value) => { writes.push({ node, key }); setAttribute(key, value); };
    node.dataset = new Proxy(node.dataset, { set(target, key, value) {
      writes.push({ node, key: `data-${key}` }); target[key] = value; return true;
    } });
    for (const key of ["hidden", "disabled", "title", "textContent"]) {
      let value = node[key];
      Object.defineProperty(node, key, { configurable: true, get: () => value,
        set: next => { writes.push({ node, key }); value = next; } });
    }
  }
  return writes;
}

test("unchanged menu refreshes evaluate live state and availability without any display mutations", () => {
  let captures = 0, availabilityChecks = 0;
  const fixture = randomFixture({ onCapture: () => captures++, isPresetAvailable: () => { availabilityChecks++; return true; } });
  try {
    fixture.controller.view.select("p-5");
    const writes = trackMenuMutations(fixture), beforeCaptures = captures, beforeChecks = availabilityChecks;
    for (let iteration = 0; iteration < 5; iteration++) fixture.controller.refresh();
    assert.equal(writes.length, 0, "an unchanged full bank and selected scene need no DOM writes");
    assert.equal(captures, beforeCaptures + 5, "complete musical state remains live");
    assert.equal(availabilityChecks, beforeChecks + 5 * fixture.controller.bank.length, "dynamic eligibility is never memoized away");
    fixture.state().value = 5.125; fixture.controller.refresh();
    assert.equal(fixture.controller.selectedId, null);
    assert.equal(fixture.doc.querySelector(".header-preset-controls").dataset.presetId, "custom");
    assert.equal(fixture.doc.querySelector(".instrument-picker-current").textContent, "Preset · Custom");
    const pressedWrites = writes.filter(write => write.key === "aria-pressed");
    assert.equal(pressedWrites.length, 1, "only the previously selected preset changes its pressed state");
    assert.equal(pressedWrites[0].node.dataset.presetId, "p-5");
    writes.length = 0; fixture.controller.refresh();
    assert.equal(writes.length, 0, "Custom edits also retain an unchanged menu");
    fixture.controller.view.select("p-5");
    assert.deepEqual(fixture.state(), { value: 5 });
    assert.equal(fixture.controller.selectedId, "p-5", "complete recall still restores the scene");
  } finally { fixture.controller.destroy(); }
});

test("one task of automatic edit events queues one live refresh, including on a hidden document", () => {
  let captures = 0;
  const queued = [], fixture = randomFixture({ onCapture: () => captures++, queueMicrotask: callback => queued.push(callback) });
  try {
    fixture.controller.view.select("p-2"); fixture.state().value = 2.125;
    const beforeCaptures = captures;
    for (const type of ["input", "input", "change", "click", "pointerup", "keyup"]) fixture.doc.emit(type);
    assert.equal(queued.length, 1, "a burst does not enqueue a separate bank pass per event");
    assert.equal(captures, beforeCaptures, "automatic display work yields until the native event task completes");
    fixture.doc.hidden = true; queued.shift()();
    assert.equal(captures, beforeCaptures + 1);
    assert.equal(fixture.controller.selectedId, null);
    assert.equal(fixture.doc.querySelector(".instrument-picker-current").textContent, "Preset · Custom");
    fixture.doc.emit("input"); assert.equal(queued.length, 1, "the next edit can enqueue its own refresh");
    const writes = trackMenuMutations(fixture); queued.shift()();
    assert.equal(writes.length, 0, "an unchanged follow-up still has no menu DOM mutations");
  } finally { fixture.controller.destroy(); }
});

test("coalesced display updates keep dynamic availability and asynchronous recall independent", async () => {
  let available = true, release;
  const queued = [], fixture = randomFixture({ queueMicrotask: callback => queued.push(callback),
    isPresetAvailable: () => available,
    apply: snapshot => new Promise(resolve => { release = () => resolve(snapshot); }),
  });
  try {
    fixture.controller.view.select("p-4");
    available = false;
    fixture.doc.emit("change"); fixture.doc.emit("input"); queued.shift()();
    assert.equal(fixture.doc.querySelector(".header-preset-next").disabled, true);
    assert.ok(fixture.doc.descendants().filter(node => node.dataset.fullPreset !== undefined).every(button => button.parentNode.hidden));
    release(); await settle();
    assert.deepEqual(fixture.state(), { value: 4 }); assert.equal(fixture.controller.selectedId, "p-4");
    assert.equal(fixture.applies(), 1, "display batching cannot replay or cancel the transaction");
  } finally { fixture.controller.destroy(); }
});

test("an automatic refresh queued before teardown cannot capture or revive the removed menu", () => {
  let captures = 0;
  const queued = [], fixture = randomFixture({ onCapture: () => captures++, queueMicrotask: callback => queued.push(callback) });
  fixture.doc.emit("input"); fixture.doc.emit("change");
  assert.equal(queued.length, 1);
  fixture.controller.destroy();
  const beforeCaptures = captures; queued.shift()();
  assert.equal(captures, beforeCaptures);
  assert.equal(fixture.doc.querySelector(".header-preset-controls"), null);
});

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


test("shadow-host retargeting preserves preset clicks and arrow shortcuts, while outside clicks dismiss", () => {
  const fixture = randomFixture();
  try {
    const root = fixture.doc.querySelector(".header-preset-controls");
    const picker = fixture.doc.querySelector(".header-preset-picker");
    const summary = fixture.doc.querySelector(".instrument-picker-trigger");
    const button = fixture.doc.querySelector(".instrument-picker-link");
    const shadowHost = fixture.doc.createElement("section");
    picker.open = true;
    fixture.doc.emit("pointerdown", { target: shadowHost, composedPath: () => [button, picker, root, shadowHost] });
    assert.equal(picker.open, true, "pointerdown inside the shadow menu must leave its click target visible");
    button.emit("click");
    assert.equal(fixture.controller.selectedId, "p-0");
    fixture.doc.emit("keydown", {
      key: "ArrowRight", target: shadowHost, composedPath: () => [summary, picker, root, shadowHost],
      preventDefault() {}, stopImmediatePropagation() {},
    });
    assert.equal(fixture.controller.selectedId, "p-1");
    picker.open = true;
    fixture.doc.emit("pointerdown", { target: shadowHost, composedPath: () => [shadowHost] });
    assert.equal(picker.open, false);
  } finally { fixture.controller.destroy(); }
});
const settle = () => new Promise(resolve => setImmediate(resolve));
test("async recall waits for complete capture and serializes repeated clicks", async () => {
  let release;
  const fixture = randomFixture({apply:snapshot => new Promise(resolve => { release=()=>resolve(snapshot); })});
  try {
    fixture.controller.view.select('p-4');
    assert.equal(fixture.controller.selectedId,null);
    assert.equal(fixture.doc.querySelector('.header-preset-controls').attributes.get('aria-busy'),'true');
    fixture.controller.view.select('p-5'); fixture.controller.view.randomize();
    assert.equal(fixture.applies(),1);
    release(); await settle();
    assert.equal(fixture.controller.selectedId,'p-4');
    assert.equal(fixture.doc.querySelector('.header-preset-controls').attributes.get('aria-busy'),'false');
    assert.deepEqual(fixture.errors,[]);
  } finally { fixture.controller.destroy(); }
});
test("async incomplete or rejected recall rolls back the full previous snapshot", async () => {
  for (const reject of [true,false]) {
    const fixture=randomFixture({apply:async snapshot => {
      if(snapshot.value===4) { if(reject) throw new Error('unavailable voice'); return {value:4.5}; }
      return snapshot;
    }});
    try {
      fixture.controller.view.select('p-4'); await settle();
      assert.deepEqual(fixture.state(),{value:0});
      assert.equal(fixture.controller.selectedId,null);
      assert.equal(fixture.applies(),2);
      assert.equal(fixture.errors.length,1);
      fixture.controller.view.select('p-2'); await settle();
      assert.equal(fixture.controller.selectedId,'p-2');
    } finally {fixture.controller.destroy();}
  }
});
test("destroying a pending async menu prevents late selection and rollback callbacks", async () => {
  let release, callbacks = 0;
  const fixture=randomFixture({apply:snapshot=>new Promise(resolve=>{release=()=>resolve(snapshot);}), onApplied:()=>callbacks++});
  fixture.controller.view.select('p-7');fixture.controller.destroy();release();await settle();
  assert.equal(callbacks,0);
  assert.equal(fixture.controller.selectedId,null);
  assert.equal(fixture.applies(),1);
  assert.deepEqual(fixture.errors,[]);
});


test("success feedback sees refreshed preset and dice metadata, never registration", () => {
  const calls = [];
  const fixture = randomFixture({onApplied: () => calls.push({
    state: {...fixture.state()}, selected: fixture.controller.selectedId,
    busy: fixture.doc.querySelector(".header-preset-controls").attributes.get("aria-busy"),
    message: fixture.doc.querySelector(".sr-only").textContent,
  })});
  try {
    assert.deepEqual(calls, []);
    fixture.controller.view.select("p-3");
    fixture.doc.querySelector(".header-preset-next").emit("click");
    fixture.doc.querySelector(".header-preset-random").emit("click");
    assert.deepEqual(calls.map(({state, selected, busy}) => ({state, selected, busy})), [
      {state: {value: 3}, selected: "p-3", busy: "false"},
      {state: {value: 4}, selected: "p-4", busy: "false"},
      {state: {value: 4.25}, selected: null, busy: "false"},
    ]);
    assert.match(calls[0].message, /Scene 3 loaded/);
    assert.match(calls[2].message, /randomized/);
  } finally { fixture.controller.destroy(); }
});

test("asynchronous success feedback waits for the validated capture and runs once", async () => {
  let release;
  const calls = [];
  const fixture = randomFixture({
    apply: snapshot => new Promise(resolve => {release = () => resolve(snapshot);}),
    onApplied: () => calls.push({state: {...fixture.state()}, selected: fixture.controller.selectedId}),
  });
  try {
    fixture.controller.view.select("p-4");
    fixture.controller.view.randomize();
    assert.deepEqual(calls, []);
    release(); await settle();
    assert.deepEqual(calls, [{state: {value: 4}, selected: "p-4"}]);
    fixture.doc.querySelector(".header-preset-random").emit("click");
    assert.equal(calls.length, 1);
    release(); await settle();
    assert.deepEqual(calls[1], {state: {value: 4.25}, selected: null});
  } finally { fixture.controller.destroy(); }
});

test("invalid recall and rollback never trigger success feedback", async () => {
  for (const asynchronous of [false, true]) for (const rejected of [false, true]) {
    let callbacks = 0;
    const recall = snapshot => {
      if (snapshot.value !== 4) return snapshot;
      if (rejected) throw new Error("unavailable voice");
      return {value: 4.5};
    };
    const fixture = randomFixture({
      apply: asynchronous ? async snapshot => recall(snapshot) : recall,
      onApplied: () => callbacks++,
    });
    try {
      fixture.controller.view.select("p-4"); await settle();
      assert.deepEqual(fixture.state(), {value: 0});
      assert.equal(fixture.applies(), 2);
      assert.equal(callbacks, 0);
      fixture.controller.view.select("p-2"); await settle();
      assert.equal(callbacks, 1);
    } finally { fixture.controller.destroy(); }
  }
  let callbacks = 0;
  const fixture = randomFixture({randomize: previous => previous, onApplied: () => callbacks++});
  try {
    fixture.controller.view.randomize();
    assert.equal(fixture.applies(), 0);
    assert.equal(callbacks, 0);
  } finally { fixture.controller.destroy(); }
});

test("throwing or rejected success feedback cannot roll back a complete recall", async () => {
  for (const asynchronous of [false, true]) {
    const fail = () => {throw new Error("preview unavailable");};
    const fixture = randomFixture({onApplied: asynchronous ? async () => fail() : fail});
    try {
      fixture.controller.view.select("p-4"); await settle();
      assert.deepEqual(fixture.state(), {value: 4});
      assert.equal(fixture.controller.selectedId, "p-4");
      assert.equal(fixture.applies(), 1);
      assert.match(fixture.doc.querySelector(".sr-only").textContent, /Scene 4 loaded/);
      assert.equal(fixture.errors.length, 1);
      assert.match(fixture.errors[0][0], /Preset feedback failed/);
      fixture.controller.view.select("p-2"); await settle();
      assert.equal(fixture.controller.selectedId, "p-2");
      assert.equal(fixture.applies(), 2);
    } finally { fixture.controller.destroy(); }
  }
});


const presetButtons = fixture => fixture.doc.descendants().filter(node => node.dataset.fullPreset !== undefined);
const visiblePresetIds = fixture => presetButtons(fixture).filter(button => !button.parentNode.hidden).map(button => button.dataset.presetId);
const presetArrow = (fixture, key, target = fixture.doc.querySelector(".header-preset-random")) => fixture.doc.emit("keydown", {
  key, target, preventDefault() {}, stopImmediatePropagation() {},
});

test("dynamic availability changes only choices, preserving the complete bank and an excluded current scene", () => {
  let available = null, feedback = 0;
  const fixture = randomFixture({isPresetAvailable: preset => available === null || available.includes(preset.id), onApplied: () => feedback++});
  try {
    assert.equal(visiblePresetIds(fixture).length, 12);
    assert.equal(fixture.applies(), 0); assert.equal(feedback, 0);
    fixture.controller.view.select("p-5");
    const captured = captureHeaderPresetState(fixture.doc);
    available = ["p-2", "p-8"];
    fixture.controller.refresh();
    assert.deepEqual(visiblePresetIds(fixture), available);
    assert.deepEqual(captureHeaderPresetState(fixture.doc), captured);
    assert.equal(captured.presetCount, 12); assert.equal(captured.selectedId, "p-5");
    assert.equal(fixture.controller.bank.length, 12);
    assert.equal(fixture.doc.querySelector(".instrument-picker-current").textContent, "Scene 5");
    const selected = presetButtons(fixture).find(button => button.dataset.presetId === "p-5");
    assert.equal(selected.parentNode.hidden, true); assert.equal(selected.attributes.get("aria-pressed"), "true");
    available = null; fixture.controller.refresh();
    assert.equal(visiblePresetIds(fixture).length, 12);
    assert.equal(fixture.applies(), 1); assert.equal(feedback, 1);
    assert.deepEqual(captureHeaderPresetState(fixture.doc), captured);
  } finally { fixture.controller.destroy(); }
});

test("direct and stale row selections check the current predicate before any recall or feedback", () => {
  let available = ["p-1", "p-4", "p-8"], feedback = 0;
  const fixture = randomFixture({isPresetAvailable: preset => available.includes(preset.id), onApplied: () => feedback++});
  try {
    fixture.controller.view.select("p-4");
    available = ["p-2", "p-6"]; // Deliberately do not refresh the old visible rows.
    fixture.controller.view.select("p-8");
    presetButtons(fixture).find(button => button.dataset.presetId === "p-8").emit("click");
    fixture.controller.view.select("missing");
    assert.equal(fixture.applies(), 1); assert.equal(feedback, 1);
    assert.deepEqual(fixture.state(), {value: 4}); assert.equal(fixture.controller.selectedId, "p-4");
    fixture.controller.view.select("p-6");
    assert.deepEqual(fixture.state(), {value: 6}); assert.equal(fixture.controller.selectedId, "p-6");
    assert.equal(fixture.applies(), 2); assert.equal(feedback, 2);
  } finally { fixture.controller.destroy(); }
});

test("Next and every arrow direction skip excluded scenes and wrap in full-bank order", () => {
  let available = ["p-2", "p-5", "p-9"];
  const fixture = randomFixture({isPresetAvailable: preset => available.includes(preset.id)});
  try {
    const next = fixture.doc.querySelector(".header-preset-next");
    for (const id of ["p-2", "p-5", "p-9", "p-2"]) {
      next.emit("click"); assert.equal(fixture.controller.selectedId, id);
    }
    for (const [key, id] of [["ArrowLeft", "p-9"], ["ArrowUp", "p-5"], ["ArrowRight", "p-9"], ["ArrowDown", "p-2"]]) {
      presetArrow(fixture, key); assert.equal(fixture.controller.selectedId, id);
    }
    fixture.controller.view.select("p-5"); available = ["p-2", "p-9"];
    next.emit("click"); assert.equal(fixture.controller.selectedId, "p-9", "continue after an excluded current preset");
    available = ["p-2", "p-5", "p-9"]; fixture.controller.view.select("p-5"); available = ["p-2", "p-9"];
    presetArrow(fixture, "ArrowLeft"); assert.equal(fixture.controller.selectedId, "p-2");
    fixture.controller.view.randomize();
    next.emit("click"); assert.equal(fixture.controller.selectedId, "p-9", "Custom retains its position in the available tour");
    available = ["p-5"]; next.emit("click");
    const applies = fixture.applies(); presetArrow(fixture, "ArrowLeft");
    assert.equal(fixture.controller.selectedId, "p-5"); assert.equal(fixture.applies(), applies + 1, "one available scene still recalls normally");
  } finally { fixture.controller.destroy(); }
  const initial = randomFixture({isPresetAvailable: preset => ["p-2", "p-9"].includes(preset.id)});
  try {
    presetArrow(initial, "ArrowLeft"); assert.equal(initial.controller.selectedId, "p-9", "previous from Select Preset starts at the last eligible scene");
  } finally { initial.controller.destroy(); }
});

test("text search intersects live availability and clearing search keeps the scope", () => {
  let parity = 0, feedback = 0;
  const fixture = randomFixture({isPresetAvailable: preset => preset.snapshot.value % 2 === parity, onApplied: () => feedback++});
  try {
    const search = fixture.doc.querySelector(".instrument-picker-search-input"), empty = fixture.doc.querySelector(".instrument-picker-empty");
    search.value = "  sCeNe 1  "; search.emit("input");
    assert.deepEqual(visiblePresetIds(fixture), ["p-10"]);
    parity = 1; fixture.controller.refresh();
    assert.deepEqual(visiblePresetIds(fixture), ["p-1", "p-11"]);
    search.value = "Scene 2"; search.emit("input");
    assert.deepEqual(visiblePresetIds(fixture), []); assert.equal(empty.hidden, false);
    assert.equal(fixture.doc.querySelector(".header-preset-next").disabled, false, "search does not disable the eligible preset tour");
    const picker = fixture.doc.querySelector(".header-preset-picker");
    picker.open = true;
    fixture.doc.querySelector(".header-preset-controls").emit("keydown", {key: "Escape", stopPropagation() {}, preventDefault() {}});
    assert.equal(search.value, "");
    assert.deepEqual(visiblePresetIds(fixture), ["p-1", "p-3", "p-5", "p-7", "p-9", "p-11"]);
    assert.equal(empty.hidden, true); assert.equal(fixture.applies(), 0); assert.equal(feedback, 0);
  } finally { fixture.controller.destroy(); }
});

test("an empty eligible set safely disables Next without recalling or previewing another scene", () => {
  let enabled = true, feedback = 0;
  const fixture = randomFixture({isPresetAvailable: () => enabled, onApplied: () => feedback++});
  try {
    fixture.controller.view.select("p-4"); const captured = captureHeaderPresetState(fixture.doc);
    enabled = false; fixture.controller.refresh();
    assert.deepEqual(visiblePresetIds(fixture), []);
    assert.equal(fixture.doc.querySelector(".instrument-picker-empty").hidden, false);
    const next = fixture.doc.querySelector(".header-preset-next"); assert.equal(next.disabled, true);
    next.emit("click"); presetArrow(fixture, "ArrowLeft"); fixture.controller.view.select("p-4");
    assert.deepEqual(captureHeaderPresetState(fixture.doc), captured);
    assert.equal(fixture.applies(), 1); assert.equal(feedback, 1);
    enabled = true; fixture.controller.refresh(); assert.equal(next.disabled, false);
    next.emit("click"); assert.equal(fixture.controller.selectedId, "p-5");
  } finally { fixture.controller.destroy(); }
});

test("scope changes during asynchronous recall leave the existing successful transaction intact", async () => {
  let available = true, release, feedback = 0;
  const fixture = randomFixture({
    isPresetAvailable: () => available,
    apply: snapshot => new Promise(resolve => {release = () => resolve(snapshot);}),
    onApplied: () => feedback++,
  });
  try {
    fixture.controller.view.select("p-4");
    available = false; fixture.controller.refresh();
    assert.deepEqual(visiblePresetIds(fixture), [], "scope updates immediately even while recall is pending");
    assert.equal(fixture.doc.querySelector(".header-preset-next").disabled, true);
    assert.equal(feedback, 0);
    release(); await settle();
    assert.deepEqual(fixture.state(), {value: 4}); assert.equal(fixture.controller.selectedId, "p-4");
    assert.deepEqual(visiblePresetIds(fixture), []);
    assert.equal(fixture.applies(), 1); assert.equal(feedback, 1);
    fixture.controller.view.select("p-4");
    assert.equal(fixture.applies(), 1); assert.equal(feedback, 1);
  } finally { fixture.controller.destroy(); }
});

test("preset eligibility does not replace instrument-owned dice generation or its full-bank validation", () => {
  let feedback = 0;
  const fixture = randomFixture({isPresetAvailable: () => false, onApplied: () => feedback++});
  try {
    fixture.doc.querySelector(".header-preset-random").emit("click");
    assert.deepEqual(fixture.state(), {value: .25}); assert.equal(fixture.applies(), 1); assert.equal(feedback, 1);
    assert.deepEqual(visiblePresetIds(fixture), []);
    assert.equal(captureHeaderPresetState(fixture.doc).presetCount, 12);
  } finally { fixture.controller.destroy(); }
  const invalid = randomFixture({isPresetAvailable: () => false, randomize: () => ({value: 4})});
  try {
    invalid.controller.view.randomize();
    assert.equal(invalid.applies(), 0, "an excluded factory preset still is not a random parameter result");
    assert.equal(invalid.errors.length, 1);
  } finally { invalid.controller.destroy(); }
});


test("availability and search never leave keyboard focus inside a hidden preset row", () => {
  let maximum = 12, feedback = 0;
  const fixture = randomFixture({isPresetAvailable: preset => preset.snapshot.value < maximum, onApplied: () => feedback++});
  try {
    const picker = fixture.doc.querySelector(".header-preset-picker"), search = fixture.doc.querySelector(".instrument-picker-search-input");
    const focusPreset = id => presetButtons(fixture).find(button => button.dataset.presetId === id).focus();
    picker.open = true; focusPreset("p-9"); maximum = 5; fixture.controller.refresh();
    assert.equal(fixture.doc.activeElement, search);
    focusPreset("p-2"); search.value = "Scene 3"; search.emit("input");
    assert.equal(fixture.doc.activeElement, search);
    picker.open = false; focusPreset("p-3"); maximum = 2; fixture.controller.refresh();
    assert.equal(fixture.doc.activeElement, fixture.doc.querySelector(".instrument-picker-trigger"));
    assert.equal(fixture.applies(), 0); assert.equal(feedback, 0);
  } finally { fixture.controller.destroy(); }
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  createButton,
  createAudioStrip,
  createChoiceSwitch,
  createControlSection,
  createRangeField,
  createSelectField,
} from "../src/ui/index.js";

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
  toggle(token, force) {
    const enabled = force === undefined ? !this.contains(token) : Boolean(force);
    if (enabled) this.add(token);
    else this.remove(token);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.classList = new FakeClassList(this);
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = "";
    this.id = "";
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.open = false;
  }
  append(...children) {
    for (const child of children) {
      child.parentNode?.removeChild?.(child);
      child.parentNode = this;
      this.children.push(child);
    }
  }
  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parentNode = null;
  }
  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this.append(...children);
  }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }
  get options() {
    if (this.tagName !== "SELECT") return undefined;
    return this.children.flatMap((child) => child.tagName === "OPTGROUP" ? child.children : [child]);
  }
}

class FakeText {
  constructor(text, ownerDocument) {
    this.textContent = text;
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
  }
}

class FakeDocument {
  constructor() { this.created = []; }
  createElement(tagName) {
    const element = new FakeElement(tagName, this);
    this.created.push(element);
    return element;
  }
  createTextNode(text) { return new FakeText(String(text), this); }
  getElementById(id) { return this.created.find((element) => element.id === id) ?? null; }
}

test("button exposes native states and optional transport/audio controllers", () => {
  const doc = new FakeDocument();
  let clicks = 0;
  const button = createButton({
    label: "Listen",
    variant: "audio",
    audioState: "starting",
    attention: true,
    onClick: () => { clicks += 1; },
  }, doc);

  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.classList.contains("audio-button"), true);
  assert.equal(button.getAttribute("data-audio-icon-ready"), "true");
  assert.equal(button.getAttribute("data-audio-state"), "starting");
  assert.equal(button.getAttribute("data-audio-attention"), "true");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.equal(button.getAttribute("aria-label"), "Starting audio");
  button.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1);

  button.setAudioState("on");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(button.getAttribute("aria-label"), "Turn audio off");
  button.setDisabled(true);
  button.dispatchEvent({ type: "click" });
  assert.equal(clicks, 1, "disabled buttons do not invoke callbacks in synthetic runtimes");

  const toggle = createButton({ label: "Latch", toggle: true }, doc);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  toggle.dispatchEvent({ type: "click" });
  assert.equal(toggle.getAttribute("aria-pressed"), "true");

  const generic = createButton({ label: "Generic" }, doc);
  const mini = createButton({ label: "Reset 90°", variant: "mini" }, doc);
  const reset = createButton({ label: "Reset all parameters", variant: "reset" }, doc);
  assert.equal(generic.classList.contains("mini-action"), false);
  assert.equal(mini.classList.contains("mini-action"), true);
  assert.equal(reset.classList.contains("reset-all-button"), true);

  const playToggle = createButton({ label: "Play", variant: "play" }, doc);
  assert.equal(playToggle.getAttribute("aria-pressed"), "false");
  assert.deepEqual(
    playToggle.iconElement.children.map((child) => child.getAttribute("class")),
    ["transport-play", "transport-pause"],
  );
  const playTrigger = createButton({ label: "Pluck", variant: "play", toggle: false }, doc);
  assert.equal(playTrigger.getAttribute("aria-pressed"), null);
  playTrigger.dispatchEvent({ type: "click" });
  assert.equal(playTrigger.getAttribute("aria-pressed"), null);
});

test("audio strip composes the production speaker switch and master level", () => {
  const doc = new FakeDocument();
  const levels = [];
  const strip = createAudioStrip({
    audioState: "off",
    level: 0.56,
    onLevelInput: (value) => levels.push(value),
  }, doc);

  assert.equal(strip.classList.contains("audio-strip"), true);
  assert.equal(strip.getAttribute("role"), "group");
  assert.equal(strip.audioButton.classList.contains("audio-button"), true);
  assert.equal(strip.audioButton.getAttribute("aria-label"), "Turn audio on");
  assert.equal(strip.levelField.classList.contains("header-level"), true);
  assert.equal(strip.levelOutput.textContent, "56%");
  strip.levelInput.value = "0.65";
  strip.levelInput.dispatchEvent({ type: "input" });
  assert.equal(strip.level, 0.65);
  assert.equal(strip.levelOutput.textContent, "65%");
  assert.deepEqual(levels, [0.65]);
  strip.setAudioState("on");
  assert.equal(strip.audioState, "on");
  strip.setLevelDisabled(true);
  assert.equal(strip.levelInput.disabled, true);
});

test("range field keeps its output, value and callbacks synchronized", () => {
  const doc = new FakeDocument();
  const seen = [];
  const field = createRangeField({
    id: "density",
    label: "Density",
    min: 0,
    max: 2,
    step: 0.1,
    value: 0.7,
    formatValue: (value) => `${value.toFixed(1)}×`,
    description: "Controls event density.",
    onInput: (value) => seen.push(["input", value]),
    onChange: (value) => seen.push(["change", value]),
  }, doc);

  assert.equal(field.tagName, "LABEL");
  assert.equal(field.classList.contains("control"), true);
  assert.equal(field.input.type, "range");
  assert.equal(field.output.getAttribute("for"), "density");
  assert.equal(field.output.textContent, "0.7×");
  assert.equal(field.input.getAttribute("aria-describedby"), "density-description");

  field.input.value = "1.2";
  field.input.dispatchEvent({ type: "input" });
  field.input.dispatchEvent({ type: "change" });
  assert.equal(field.value, 1.2);
  assert.equal(field.output.textContent, "1.2×");
  assert.deepEqual(seen, [["input", 1.2], ["change", 1.2]]);
  field.setDisabled(true);
  assert.equal(field.disabled, true);
  assert.equal(field.classList.contains("is-disabled"), true);
});

test("select field supports primitive options, optgroups, updates and change callbacks", () => {
  const doc = new FakeDocument();
  let selected;
  const field = createSelectField({
    id: "waveform",
    label: "Waveform",
    value: "triangle",
    options: [
      "sine",
      { label: "Angular", options: [
        { value: "triangle", label: "Triangle" },
        { value: "square", label: "Square", disabled: true },
      ] },
    ],
    onChange: (value) => { selected = value; },
  }, doc);

  assert.equal(field.select.children[0].tagName, "OPTION");
  assert.equal(field.select.children[1].tagName, "OPTGROUP");
  assert.equal(field.select.options.length, 3);
  assert.equal(field.value, "triangle");
  field.select.value = "sine";
  field.select.dispatchEvent({ type: "change" });
  assert.equal(selected, "sine");

  field.setOptions([{ value: "noise", label: "Noise" }], { value: "noise" });
  assert.equal(field.select.options.length, 1);
  assert.equal(field.value, "noise");
});

test("choice switch preserves typed values while using native pressed buttons", () => {
  const doc = new FakeDocument();
  let changed;
  const field = createChoiceSwitch({
    label: "Enabled",
    value: false,
    choices: [
      { value: false, label: "Off" },
      { value: true, label: "On" },
    ],
    onChange: (value) => { changed = value; },
  }, doc);

  assert.equal(field.group.getAttribute("role"), "group");
  assert.equal(field.buttons[0].getAttribute("aria-pressed"), "true");
  field.buttons[1].dispatchEvent({ type: "click" });
  assert.equal(field.value, true);
  assert.equal(changed, true);
  assert.equal(field.buttons[1].getAttribute("aria-pressed"), "true");
  assert.equal(field.buttons[0].getAttribute("aria-pressed"), "false");
});

test("control section retains native append and scopes content helpers to its body", () => {
  const doc = new FakeDocument();
  const child = doc.createElement("p");
  child.textContent = "Initial control";
  const section = createControlSection({
    title: "Sound",
    state: "Ready",
    section: "sound",
    open: false,
    children: child,
  }, doc);

  assert.equal(section.tagName, "DETAILS");
  assert.equal(section.open, false);
  assert.equal(section.getAttribute("data-section"), "sound");
  assert.equal(section.stateElement.getAttribute("aria-live"), null);
  assert.equal(section.body.children[0], child);
  assert.equal(Object.hasOwn(section, "append"), false, "native append is not shadowed");

  const next = doc.createElement("button");
  section.appendToBody(next);
  assert.equal(section.body.children[1], next);
  section.setOpen(true);
  section.setState("Active");
  assert.equal(section.isOpen, true);
  assert.equal(section.stateElement.textContent, "Active");

  const liveSection = createControlSection({
    title: "Output",
    state: "Ready",
    stateLive: "polite",
  }, doc);
  assert.equal(liveSection.stateElement.getAttribute("aria-live"), "polite");
});

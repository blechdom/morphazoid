import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_INSTRUMENT_ROOT_SELECTOR,
  INSTRUMENT_ROOT_CHANGE_EVENT,
  activeInstrumentControls,
} from "../src/ui/active-instrument-controls.js";
import { installUniversalWaxAdapter } from "../scripts/wax/wax-universal-adapter.js";

class Emitter {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }
}

class Control extends Emitter {
  constructor(id, options = {}) {
    super();
    Object.assign(this, {
      id, tagName: "INPUT", type: "range", min: "0", max: "1", step: "0.01", value: "0.5",
      disabled: false, pressed: false, clicks: 0,
    }, options);
  }
  matches(selector) {
    if (selector.includes("checkbox")) return this.type === "checkbox";
    return this.tagName === "INPUT" || this.tagName === "SELECT";
  }
  closest() { return null; }
  getAttribute(name) {
    if (name === "aria-pressed") return String(this.pressed);
    if (name === "aria-label") return this.label ?? null;
    return null;
  }
  click() { this.pressed = !this.pressed; this.clicks++; }
}

function controlRoot(controls) {
  return {
    getElementById(id) { return controls.find(control => control.id === id) ?? null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    querySelectorAll(selector) {
      if (selector.startsWith("#")) return controls.filter(control => control.id === selector.slice(1));
      if (selector.startsWith("label[for=")) {
        const id = selector.match(/for="([^"]+)"/)?.[1];
        const control = controls.find(candidate => candidate.id === id);
        return control ? [{ textContent: control.label ?? id }] : [];
      }
      if (selector.startsWith("select[id*='preset'")) {
        return controls.filter(control => control.tagName === "SELECT" && /preset/i.test(control.id));
      }
      if (selector.startsWith("input[type='range']")) {
        return controls.filter(control => !control.disabled && (
          (control.tagName === "INPUT" && control.type === "range")
          || (selector.includes("select") && control.tagName === "SELECT")
        ));
      }
      return [];
    },
  };
}

function pageHarness() {
  const headerOutput = new Control("output");
  const headerOnly = new Control("balance", { label: "Balance" });
  const page = controlRoot([headerOutput, headerOnly]);
  const realQuery = page.querySelector.bind(page);
  let active = null;
  page.querySelector = selector => selector === ACTIVE_INSTRUMENT_ROOT_SELECTOR ? active : realQuery(selector);
  let creations = 0;
  Object.assign(page, {
    head: { append() {} }, body: { append() {} },
    documentElement: { dataset: {}, removeAttribute() {} },
    createElement() {
      creations++;
      return { dataset: {}, setAttribute() {}, querySelector() { return null; } };
    },
  });
  return {
    document: page, headerOutput, headerOnly,
    select(root) { active = root ? { shadowRoot: root } : null; },
    get creations() { return creations; },
  };
}

function instrumentControls() {
  const tempo = new Control("tempo", { min: "30", max: "300", step: "1", value: "120" });
  const cutoff = new Control("cutoff", { min: "100", max: "8000", step: "1", value: "900" });
  const output = new Control("output");
  const play = new Control("playButton", { tagName: "BUTTON" });
  const audio = new Control("audioButton", { tagName: "BUTTON" });
  const preset = new Control("voicePreset", {
    tagName: "SELECT", options: [{ value: "first" }, { value: "second" }], value: "first",
  });
  return { root: controlRoot([tempo, cutoff, output, play, audio, preset]), tempo, cutoff, output, play, audio, preset };
}

test("active queries follow root changes, prefer native IDs, and retain shared header controls", () => {
  const page = pageHarness();
  const first = instrumentControls(), second = instrumentControls();
  const queries = activeInstrumentControls(page.document);
  assert.equal(queries.querySelector("#output"), page.headerOutput);
  page.select(first.root);
  assert.equal(queries.querySelector("#output"), first.output);
  assert.equal(queries.getElementById("output"), first.output);
  assert.equal(queries.body, page.document.body);
  assert.equal(queries.head, page.document.head);
  queries.createElement("span");
  assert.equal(page.creations, 1, "DOM creation stays on the real document");
  const controls = queries.querySelectorAll("input[type='range']:not([disabled])");
  assert.deepEqual(controls, [first.tempo, first.cutoff, first.output, page.headerOnly]);
  assert.equal(queries.querySelector("#balance"), page.headerOnly);
  page.select(second.root);
  assert.equal(queries.querySelector("#output"), second.output);
  assert.equal(queries.querySelector("label[for=\"tempo\"]").textContent, "tempo");
  assert.ok(!queries.querySelectorAll("input[type='range']:not([disabled])").includes(first.tempo));
  page.select(null);
  assert.deepEqual(queries.querySelectorAll("input[type='range']:not([disabled])"), [page.headerOutput, page.headerOnly]);
});

test("WAX MIDI and host transport follow the active instrument; automation retires old listeners", () => {
  const page = pageHarness();
  const first = instrumentControls(), second = instrumentControls();
  page.select(first.root);
  let registration;
  const runtime = Object.assign(new Emitter(), {
    document: page.document, location: { pathname: "/dist-wax/rubixoids.html" }, Event, CustomEvent,
    MorphazoidWAX: {
      register(value) { registration = value; return () => {}; },
    },
  });
  const controls = activeInstrumentControls(page.document);
  // The visible header forwards into whichever native output is active.
  page.headerOutput.addEventListener("input", () => {
    const nativeOutput = controls.getElementById("output");
    nativeOutput.value = page.headerOutput.value;
    nativeOutput.dispatchEvent({ type: "input", isTrusted: false });
  });
  const adapter = installUniversalWaxAdapter(runtime, page.document);
  const sent = [];
  adapter.manager.send = bytes => { sent.push([...bytes]); return true; };
  const client = adapter.manager.clients.get("wax-universal:rubixoids");
  const rootChanged = () => runtime.dispatchEvent(new Event(INSTRUMENT_ROOT_CHANGE_EVENT));
  try {
    assert.ok(client);
    registration.applyState({ outputMode: "both", hostSync: true });
    registration.transport.bpm(173);
    registration.transport.play();
    assert.equal(first.tempo.value, "173");
    assert.equal(first.play.pressed, true);
    assert.equal(second.tempo.value, "120");
    assert.equal(second.play.pressed, false);
    client.onMessage({ type: "controlChange", controller: 74, value: 127 });
    assert.equal(first.cutoff.value, "8000");
    assert.equal(second.cutoff.value, "900");
    client.onMessage({ type: "programChange", program: 1 });
    assert.equal(first.preset.value, "second");
    assert.equal(second.preset.value, "first");
    client.onMessage({ type: "noteOn", note: 60, velocity: 100 });
    assert.equal(first.audio.pressed, true);
    assert.equal(second.audio.pressed, false);

    page.select(second.root);
    rootChanged();
    rootChanged();
    assert.equal(adapter.manager.status().clientCount, 1, "dimension selection retains one MIDI client");
    assert.equal(adapter.manager.clients.get(client.id), client, "device/manager registration survives selection");
    registration.transport.bpm(201);
    registration.transport.play();
    client.onMessage({ type: "controlChange", controller: 74, value: 0 });
    assert.equal(second.tempo.value, "201");
    assert.equal(first.tempo.value, "173");
    assert.equal(second.play.pressed, true);
    assert.equal(second.cutoff.value, "100");
    assert.equal(first.cutoff.value, "8000");
    registration.transport.stop();
    assert.equal(second.play.pressed, false);
    assert.equal(first.play.pressed, true, "host controls no longer reach the parked root");

    sent.length = 0;
    first.cutoff.dispatchEvent({ type: "input", isTrusted: true });
    assert.deepEqual(sent, [], "inactive controls cannot send automation");
    page.headerOutput.value = "0.75";
    page.headerOutput.dispatchEvent({ type: "input", isTrusted: true });
    assert.equal(second.output.value, "0.75", "the visible header forwards to the active native parameter");
    assert.equal(first.output.value, "0.5", "the parked dimension keeps its own parameter state");
    assert.deepEqual(sent, [[0xb0, 7, 95]], "one trusted header gesture emits once despite synthetic forwarding");
    sent.length = 0;
    second.output.dispatchEvent({ type: "input", isTrusted: false });
    assert.deepEqual(sent, [], "synthetic native forwarding never emits automation");
    assert.equal(page.headerOutput.listeners.get("input").size, 2, "root refresh retains one alias binding beside forwarding");
    second.cutoff.value = "8000";
    second.cutoff.dispatchEvent({ type: "input", isTrusted: false });
    assert.deepEqual(sent, [], "MIDI/programmatic changes do not echo back to the host");
    second.cutoff.dispatchEvent({ type: "input", isTrusted: true });
    assert.deepEqual(sent, [[0xb0, 74, 127]], "root refresh never duplicates automation listeners");
    second.output.dispatchEvent({ type: "input", isTrusted: true });
    assert.deepEqual(sent.at(-1), [0xb0, 7, 95]);
    assert.equal(second.cutoff.listeners.get("input").size, 1);
    assert.equal(first.cutoff.listeners.get("input").size, 0);
  } finally { adapter.cleanup(); }
  assert.equal(adapter.manager.status().clientCount, 0);
  assert.equal(second.cutoff.listeners.get("input").size, 0);
  sent.length = 0;
  rootChanged();
  second.cutoff.dispatchEvent({ type: "input", isTrusted: true });
  page.headerOutput.dispatchEvent({ type: "input", isTrusted: true });
  assert.equal(page.headerOutput.listeners.get("input").size, 1, "teardown removes alias automation and retains page forwarding");
  assert.deepEqual(sent, [], "teardown removes the root observer as well as native and alias listeners");
});

test("active control roots never enable WAX behavior on normal browser pages", () => {
  const page = pageHarness();
  page.select(instrumentControls().root);
  assert.equal(installUniversalWaxAdapter({ document: page.document }, page.document), null);
  assert.equal(page.creations, 0);
});

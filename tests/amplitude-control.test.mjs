import assert from "node:assert/strict";
import test from "node:test";

import { createAmplitudeControl } from "../src/amplitude-control.js";

function near(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function controlHost() {
  const listeners = new Map();
  return {
    listeners,
    hidden: false,
    className: "",
    innerHTML: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    querySelector() {
      return null;
    },
    setPointerCapture() {},
  };
}

function clickTarget({ action, preset } = {}) {
  return {
    closest(selector) {
      if (selector === "[data-action]" && action) return { dataset: { action } };
      if (selector === "[data-preset]" && preset) return { dataset: { preset } };
      return null;
    },
  };
}

test("millisecond amplitude control makes Release own envelope duration", () => {
  const host = controlHost();
  const control = createAmplitudeControl(host, { timing: "milliseconds" });

  near(control.durationSeconds(), 1.4);
  near(control.sampleAtTime(0.03), 1);
  near(control.envelopeValueAtTime(0.9), 0.78);
  near(control.sampleAtTime(1.4), 0);
  assert.match(host.innerHTML, /Release 1400 ms/);
  assert.match(host.innerHTML, /Node positions are milliseconds/);
  assert.doesNotMatch(host.innerHTML, /data-action="swell"/);

  host.listeners.get("click")({ target: clickTarget({ preset: "pluck" }) });
  near(control.durationSeconds(), 0.1);
  assert.match(host.innerHTML, /Release 100 ms/);

  host.listeners.get("click")({ target: clickTarget({ action: "toggle" }) });
  assert.equal(control.state.enabled, false);
  assert.equal(control.sampleAtTime(10), 1);
  assert.equal(control.envelopeValueAtTime(0.01), 0);
});

test("phase amplitude control retains spatial swell behavior", () => {
  const host = controlHost();
  const control = createAmplitudeControl(host);

  assert.match(host.innerHTML, /data-action="swell"/);
  assert.doesNotMatch(host.innerHTML, /Node positions are milliseconds/);
  assert.ok(control.sample(0.5) > 0);
});

test("amplitude controls snapshot and restore a shared five-node envelope", () => {
  const source = createAmplitudeControl(controlHost());
  source.state.enabled = false;
  source.state.swell = true;
  source.state.preset = "custom";
  source.state.level = 0.63;
  source.state.points = [
    { x: 0, y: 0 },
    { x: 0.12, y: 1 },
    { x: 0.44, y: 0.72 },
    { x: 0.68, y: 0.72 },
    { x: 0.91, y: 0 },
  ];

  const snapshot = source.captureState();
  const target = createAmplitudeControl(controlHost());
  const applied = target.applyState(snapshot);
  assert.deepEqual(applied.points, snapshot.points);
  assert.equal(applied.enabled, false);
  assert.equal(applied.swell, false, "a bypassed envelope cannot keep swell active");
  assert.equal(applied.preset, "custom");
  assert.equal(applied.level, 0.63);
  snapshot.points[1].x = 0.99;
  assert.equal(target.captureState().points[1].x, 0.12, "state is copied across the bridge");
});

test("keyboard node focus is restored after a consumer synchronizes the editor", () => {
  const host = controlHost();
  let renderedNode;
  let markup = "";
  Object.defineProperty(host, "innerHTML", {
    get: () => markup,
    set(value) { markup = value; renderedNode = { focused: false, focus() { this.focused = true; } }; },
  });
  host.querySelector = () => renderedNode;
  let syncing = false;
  createAmplitudeControl(host, { onChange(control) {
    if (syncing) return;
    syncing = true;
    control.applyState(control.captureState());
    syncing = false;
  } });
  host.listeners.get("keydown")({
    target: { closest: () => ({ dataset: { node: "1" } }) },
    key: "ArrowUp", shiftKey: false, preventDefault() {},
  });
  assert.equal(renderedNode.focused, true, "focus belongs to the final rendered node");
});

test("constrained ARIA sliders accept every standard arrow direction", () => {
  const host = controlHost();
  const points = [
    { x: 0, y: 0 }, { x: .4, y: 1 }, { x: .5, y: .6 },
    { x: .7, y: .6 }, { x: .9, y: 0 },
  ];
  const control = createAmplitudeControl(host, { editorModel: {
    presetPoints: () => points.map(point => ({ ...point })),
    normalizePoints: value => value.map(point => ({ ...point })),
    nodeAria: (_value, index) => ({ min: 0, max: 1, value: 0, orientation: index === 3 ? "vertical" : "horizontal" }),
    moveNode(value, index, point) {
      const next = value.map(entry => ({ ...entry })); next[index] = { ...point }; return next;
    },
  } });
  const press = (index, key) => host.listeners.get("keydown")({
    target: { closest: () => ({ dataset: { node: String(index) } }) },
    key, shiftKey: false, preventDefault() {},
  });

  press(1, "ArrowUp");
  near(control.state.points[1].x, .41); near(control.state.points[1].y, 1);
  press(1, "ArrowDown");
  near(control.state.points[1].x, .4); near(control.state.points[1].y, 1);
  press(3, "ArrowRight");
  near(control.state.points[3].x, .7); near(control.state.points[3].y, .61);
  press(3, "ArrowLeft");
  near(control.state.points[3].x, .7); near(control.state.points[3].y, .6);
});

test("pointer cancellation restores the envelope at gesture start", () => {
  const host = controlHost();
  host.releasePointerCapture = () => {};
  host.querySelector = selector => selector === "[data-editor]" ? {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  } : null;
  let changes = 0;
  const control = createAmplitudeControl(host, { onChange: () => { changes += 1; } });
  const before = control.captureState();
  host.listeners.get("pointerdown")({
    target: { closest: () => ({ dataset: { node: "1" } }) },
    pointerId: 9, button: 0, isPrimary: true, clientX: 40, clientY: 30, preventDefault() {},
  });
  assert.notDeepEqual(control.captureState().points, before.points);
  host.listeners.get("pointercancel")({ pointerId: 9 });
  assert.deepEqual(control.captureState().points, before.points);
  assert.equal(control.captureState().preset, before.preset);
  assert.equal(changes, 2, "the live edit and rollback are both observable");
});

test("destroy releases pointer ownership and removes shared editor listeners", () => {
  const host = controlHost(), released = [];
  host.removeEventListener = (type, callback) => { if (host.listeners.get(type) === callback) host.listeners.delete(type); };
  host.releasePointerCapture = pointerId => released.push(pointerId);
  const control = createAmplitudeControl(host);
  host.listeners.get("pointerdown")({
    target: { closest: () => ({ dataset: { node: "1" } }) },
    pointerId: 7, button: 0, clientX: .2, clientY: .1, preventDefault() {},
  });
  control.destroy();
  assert.deepEqual(released, [7]);
  assert.equal(host.listeners.size, 0);
});

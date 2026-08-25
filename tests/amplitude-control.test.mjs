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

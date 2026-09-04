import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("L-System Drum Machine exposes a continuous Shape-style transport", async () => {
  const html = await readFile(new URL("../l-system-drums.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function element(id) {
    const classes = new Set();
    const node = {
      id,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      dataset: {},
      style: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
      },
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelector(selector) {
        if (id === "drumMap" && selector.startsWith("[data-voice-index=")) return null;
        return null;
      },
      querySelectorAll(selector) {
        if (id === "playheadMotion" && selector === "button[data-value]") {
          return [elements.get("loopMotion"), elements.get("pingPongMotion")];
        }
        if (id === "drumMap" && selector === ".l-system-drum-cell") return [];
        return [];
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      click() {
        listeners.get(`${id}:click`)?.({ currentTarget: node });
      },
    };
    elements.set(id, node);
    return node;
  }

  for (const id of ids) element(id);
  elements.get("loopMotion").dataset.value = "loop";
  elements.get("pingPongMotion").dataset.value = "pingpong";

  const drawingContext = {
    arc() {},
    beginPath() {},
    clearRect() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setTransform() {},
    stroke() {},
  };
  const canvas = elements.get("stage");
  canvas.getContext = () => drawingContext;

  const rafQueue = [];
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    rafQueue.push(callback);
    frameId += 1;
    return frameId;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
  };
  globalThis.localStorage = {
    getItem() { return null; },
  };

  let frameNow = performance.now();
  function flushAnimationFrames(now = frameNow + 20) {
    frameNow = Math.max(frameNow + 1, Number(now) || frameNow + 20);
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) callback(frameNow);
  }

  await import(`../l-system-drums-app.js?smoke=${Date.now()}`);
  frameNow = performance.now();
  assert.ok(rafQueue.length > 0, "startup should schedule an initial render");
  flushAnimationFrames();

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(elements.get("stageReadout").textContent, /^PYTHAGOREAN TREE · FINAL I7 · 1 HEAD · AUDIO OFF$/);
  for (const id of [
    "playheadMotion",
    "traversalDirection",
    "loopMotion",
    "pingPongMotion",
  ]) {
    assert.ok(elements.has(id), `the Shape-style transport should expose #${id}`);
  }
  for (const legacyId of [
    "directionButton",
    "traversalMode",
    "traversalLoop",
    "traversalPingPong",
  ]) {
    assert.equal(elements.has(legacyId), false, `legacy #${legacyId} should be removed`);
  }
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "→");
  assert.equal(elements.get("traversalDirectionText").textContent, "FWD");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Traversal direction: forward");
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");

  const initialPosition = Number(elements.get("position").value);
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "←");
  assert.equal(elements.get("traversalDirectionText").textContent, "REV");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Traversal direction: reverse");
  assert.equal(Number(elements.get("position").value), initialPosition);
  listeners.get("traversalDirection:click")();

  elements.get("position").value = "0.997";
  listeners.get("position:input")();
  const positionBeforePingPong = Number(elements.get("position").value);
  listeners.get("pingPongMotion:click")();
  assert.equal(Number(elements.get("position").value), positionBeforePingPong);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "false");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Traversal direction: forward ping-pong travel");

  listeners.get("playButton:click")();
  flushAnimationFrames(frameNow + 100);
  const reflectedPosition = Number(elements.get("position").value);
  assert.ok(reflectedPosition < positionBeforePingPong, "Ping-pong should reverse at the tree endpoint");
  assert.ok(reflectedPosition > 0.9, "Ping-pong should reflect instead of wrapping to the trunk");
  assert.equal(elements.get("traversalDirectionText").textContent, "REV");
  listeners.get("playButton:click")();
  flushAnimationFrames();

  const positionBeforeModeRoundTrip = Number(elements.get("position").value);
  listeners.get("loopMotion:click")();
  assert.equal(Number(elements.get("position").value), positionBeforeModeRoundTrip);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  listeners.get("pingPongMotion:click")();
  assert.equal(Number(elements.get("position").value), positionBeforeModeRoundTrip);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "false");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");

  elements.get("position").value = "0.72";
  listeners.get("position:input")();
  listeners.get("playButton:click")();
  flushAnimationFrames(frameNow + 100);
  assert.ok(
    Number(elements.get("position").value) < 0.72,
    "scrubbing a returning ping-pong leg should preserve that leg",
  );
  listeners.get("playButton:click")();
  flushAnimationFrames();

  listeners.get("resetAll:click")();
  flushAnimationFrames();
  assert.equal(Number(elements.get("position").value), 0);
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "→");
  assert.equal(elements.get("traversalDirectionText").textContent, "FWD");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Traversal direction: forward");
});

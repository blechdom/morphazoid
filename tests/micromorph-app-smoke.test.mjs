import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Micromorph initializes one bounded render loop and does not request audio", async () => {
  const html = await readFile(new URL("../micromorph.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const documentListeners = new Map();
  const globalListeners = new Map();

  function classList() {
    const values = new Set();
    return {
      toggle(name, force) {
        if (force) values.add(name);
        else values.delete(name);
      },
    };
  }

  function element(id = "") {
    const node = {
      id,
      value: "",
      textContent: "",
      disabled: false,
      dataset: {},
      style: {},
      children: [],
      className: "",
      classList: classList(),
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute() {},
      append(child) { this.children.push(child); },
      replaceChildren(fragment) { this.children = [...(fragment.children ?? [])]; },
      querySelectorAll(selector) {
        return selector === "[data-preset]"
          ? this.children.filter((child) => child.dataset?.preset)
          : [];
      },
      getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 620 }; },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
    return node;
  }

  for (const id of ids) elements.set(id, element(id));
  const drawingContext = {
    arc() {},
    beginPath() {},
    clearRect() {},
    closePath() {},
    fill() {},
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setTransform() {},
    stroke() {},
  };
  elements.get("stage").getContext = () => drawingContext;
  elements.get("stageWrap").getBoundingClientRect = () => ({ width: 900, height: 620 });

  const saved = new Map(
    [
      "document",
      "localStorage",
      "matchMedia",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "ResizeObserver",
      "addEventListener",
      "removeEventListener",
      "devicePixelRatio",
      "navigator",
      "AudioContext",
      "webkitAudioContext",
      "AudioWorkletNode",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  let animationRequests = 0;
  let nextFrame = null;
  let microphoneRequests = 0;
  try {
    Object.defineProperties(globalThis, {
      document: {
        configurable: true,
        value: {
          hidden: false,
          getElementById(id) { return elements.get(id) ?? null; },
          querySelector(selector) {
            return selector === "[data-reset-all]" ? element("reset") : null;
          },
          createDocumentFragment() { return element("fragment"); },
          createElement() { return element(); },
          addEventListener(type, listener) { documentListeners.set(type, listener); },
          removeEventListener(type) { documentListeners.delete(type); },
        },
      },
      localStorage: {
        configurable: true,
        value: { getItem() { return null; }, setItem() {} },
      },
      matchMedia: {
        configurable: true,
        value: () => ({ matches: false }),
      },
      requestAnimationFrame: {
        configurable: true,
        value(callback) {
          animationRequests += 1;
          nextFrame = callback;
          return animationRequests;
        },
      },
      cancelAnimationFrame: { configurable: true, value() {} },
      ResizeObserver: {
        configurable: true,
        value: class {
          constructor(callback) { this.callback = callback; }
          observe() { this.callback(); }
          disconnect() {}
        },
      },
      addEventListener: {
        configurable: true,
        value(type, listener) { globalListeners.set(type, listener); },
      },
      removeEventListener: {
        configurable: true,
        value(type) { globalListeners.delete(type); },
      },
      devicePixelRatio: { configurable: true, value: 1 },
      navigator: {
        configurable: true,
        value: {
          mediaDevices: {
            async getUserMedia() {
              microphoneRequests += 1;
              throw new Error("not expected during initialization");
            },
          },
        },
      },
    });

    await import(`../micromorph-app.js?smoke=${Date.now()}`);
    assert.equal(microphoneRequests, 0);
    assert.equal(animationRequests, 1, "startup and ResizeObserver share one pending frame");

    nextFrame?.(16);
    assert.equal(animationRequests, 2, "one completed animation schedules exactly one successor");
    const derivationInput = listeners.get("derivation:input");
    for (let index = 0; index < 20; index += 1) derivationInput?.();
    assert.equal(animationRequests, 2, "control updates do not fan out additional RAF chains");

    globalListeners.get("pagehide")?.();
    assert.equal(documentListeners.has("visibilitychange"), false);
    assert.equal(documentListeners.has("keydown"), false);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shape drum app starts with the complete Shape form and sixteen drum previews", async () => {
  const html = await readFile(new URL("../shape-drums.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function makeNode(id = "", tagName = "div") {
    const node = {
      id,
      tagName: tagName.toUpperCase(),
      type: "",
      value: "",
      textContent: "",
      className: "",
      hidden: false,
      disabled: false,
      selected: false,
      dataset: {},
      children: [],
      style: {
        setProperty(name, value) {
          this[name] = String(value);
        },
      },
      classList: {
        add() {},
        remove() {},
      },
      addEventListener(type, listener) {
        if (id) listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        if (id) attributes.set(`${id}:${name}`, String(value));
      },
      append(...children) {
        for (const child of children) {
          if (child?.isFragment) {
            this.children.push(...child.children);
            child.children = [];
          } else {
            this.children.push(child);
          }
        }
      },
      replaceChildren(...children) {
        this.children = [];
        this.append(...children);
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      setPointerCapture() {},
      focus() {},
      click() {
        listeners.get(`${id}:click`)?.({ currentTarget: node, target: node });
      },
    };
    if (id) elements.set(id, node);
    return node;
  }

  for (const id of ids) makeNode(id);

  function configureButtonGroup(groupId, buttonIds, values) {
    const buttons = buttonIds.map((id, index) => {
      const button = elements.get(id);
      if (values) button.dataset.value = values[index];
      return button;
    });
    elements.get(groupId).querySelectorAll = (selector) => (
      selector.includes("data-value") ? buttons.filter(({ dataset }) => dataset.value) : buttons
    );
    return buttons;
  }

  configureButtonGroup(
    "playMethod",
    ["traceMode", "scanMode", "radialMode"],
    ["trace", "scan", "radial"],
  );
  configureButtonGroup(
    "playheadMotion",
    ["loopMotion", "pingPongMotion"],
    ["loop", "pingpong"],
  );
  configureButtonGroup(
    "rotationMotion",
    ["rotationLoopMotion", "rotationPingPongMotion"],
    ["loop", "pingpong"],
  );
  configureButtonGroup(
    "closedShapeType",
    ["polygonShape", "starShape"],
    ["polygon", "star"],
  );

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
    setLineDash() {},
    setTransform() {},
    stroke() {},
  };
  elements.get("stage").getContext = () => drawingContext;
  elements.get("stage").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });
  elements.get("stageWrap").getBoundingClientRect = () => ({ width: 900, height: 600 });
  elements.get("headLayoutTrack").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 320,
    height: 42,
  });

  const rafQueue = [];
  let frameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    rafQueue.push(callback);
    frameId += 1;
    return frameId;
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback();
    }
  };

  globalThis.document = {
    hidden: false,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createDocumentFragment() {
      const fragment = { isFragment: true, children: [] };
      fragment.append = (...children) => fragment.children.push(...children);
      return fragment;
    },
    createElement(tagName) {
      return makeNode("", tagName);
    },
    addEventListener() {},
  };
  globalThis.window = {
    devicePixelRatio: 2,
    addEventListener() {},
  };
  globalThis.localStorage = {
    getItem() {
      return null;
    },
  };

  function flushAnimationFrame(now = performance.now() + 20) {
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) callback(now);
  }

  await import(`../shape-drums-app.js?smoke=${Date.now()}`);
  assert.ok(rafQueue.length > 0, "startup should schedule an initial render");
  flushAnimationFrame();

  assert.equal(elements.get("drumMap").children.length, 16);
  assert.equal(elements.get("mappingMode").children.length, 3);
  assert.equal(elements.get("mappingMode").value, "contour-corner");
  assert.equal(elements.get("sides").value, "4");
  assert.match(elements.get("formSummary").textContent, /4-point polygon/);
  assert.equal(elements.get("headsControl").hidden, false);
  assert.equal(elements.get("lineCountControl").hidden, true);
  assert.equal(elements.get("headMarker0").hidden, false);
  assert.equal(elements.get("headMarker1").hidden, true);
  assert.equal(elements.get("stage").width, 1800);
  assert.equal(elements.get("stage").height, 1200);
  assert.equal(typeof listeners.get("stage:pointerdown"), "function");
  assert.equal(typeof listeners.get("headLayoutTrack:pointermove"), "function");

  elements.get("sides").value = "7";
  listeners.get("sides:input")();
  assert.match(elements.get("formSummary").textContent, /7-point polygon/);

  listeners.get("starShape:click")();
  assert.match(elements.get("formSummary").textContent, /7-point star/);
  assert.equal(elements.get("starDepthControl").hidden, false);

  listeners.get("scanMode:click")();
  assert.equal(elements.get("headsControl").hidden, true);
  assert.equal(elements.get("lineCountControl").hidden, false);
  assert.equal(elements.get("playheadCountOut").textContent, "1 line");

  listeners.get("addPlayhead:click")();
  assert.equal(elements.get("playheadCountOut").textContent, "2 lines");
  assert.equal(elements.get("headMarker1").hidden, false);

  elements.get("mappingMode").value = "position-grid";
  listeners.get("mappingMode:change")();
  assert.match(elements.get("mappingSummary").textContent, /contact position/);

  for (const oldSoundId of [
    "soundMode",
    "soundSection",
    "percussionArticulation",
    "shepardArticulation",
    "fmArticulation",
    "pmArticulation",
  ]) {
    assert.equal(elements.has(oldSoundId), false, `${oldSoundId} should remain on the Shape synth page`);
  }
});

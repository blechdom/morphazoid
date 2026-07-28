import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPrototile, tilingInfo } from "../src/lattice.js";

test("lattice drum app starts with the complete editable isohedral form", async () => {
  const html = await readFile(new URL("../lattice-drums.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function makeNode(id = "", tagName = "div") {
    const node = {
      id,
      tagName: tagName.toUpperCase(),
      value: "",
      textContent: "",
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
    };
    if (id) elements.set(id, node);
    return node;
  }

  for (const id of ids) makeNode(id);

  const directionButtons = [
    makeNode("", "button"),
    makeNode("", "button"),
  ];
  directionButtons[0].dataset.direction = "-1";
  directionButtons[1].dataset.direction = "1";
  elements.get("directionChoice").querySelectorAll = () => directionButtons;

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
    scale() {},
    setTransform() {},
    stroke() {},
    translate() {},
  };
  const canvas = elements.get("stage");
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 600 });
  const tileEditorCanvas = elements.get("tileEditorCanvas");
  tileEditorCanvas.getContext = () => drawingContext;
  tileEditorCanvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 320,
    height: 220,
  });
  elements.get("stageWrap").getBoundingClientRect = () => ({ width: 900, height: 600 });

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
      return { isFragment: true, children: [], append: makeNode().append };
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
    setItem() {},
  };

  function flushAnimationFrame(now = performance.now() + 20) {
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) callback(now);
  }

  function descendants(node) {
    return [node, ...node.children.flatMap(descendants)];
  }

  await import(`../lattice-drums-app.js?smoke=${Date.now()}`);
  assert.ok(rafQueue.length > 0, "startup should schedule an initial render");
  flushAnimationFrame();

  const tilingOptions = descendants(elements.get("tilingType"))
    .filter((node) => node.tagName === "OPTION");
  assert.equal(tilingOptions.length, 72, "the selector should expose every isohedral preset");
  assert.equal(elements.get("tilingType").value, "20");
  assert.match(elements.get("formSummary").textContent, /Pentagon · IH20/);
  assert.equal(elements.get("parameterCount").textContent, "2 parameters · guarded");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal(tileEditorCanvas.width, 640);
  assert.equal(tileEditorCanvas.height, 440);
  assert.equal(typeof listeners.get("tileEditorCanvas:pointerdown"), "function");
  assert.equal(typeof listeners.get("tileEditorCanvas:pointermove"), "function");
  assert.equal(typeof listeners.get("tileEditorCanvas:pointerup"), "function");

  const editorModel = buildPrototile({
    type: 20,
    parameters: tilingInfo(20).defaultParameters,
  });
  const editorScale = Math.min(
    (320 - 54) / (editorModel.bounds.maxX - editorModel.bounds.minX),
    (220 - 54) / (editorModel.bounds.maxY - editorModel.bounds.minY),
  );
  const editorCenter = {
    x: (editorModel.bounds.minX + editorModel.bounds.maxX) / 2,
    y: (editorModel.bounds.minY + editorModel.bounds.maxY) / 2,
  };
  const draggableVertex = editorModel.vertices[1];
  const handle = {
    x: 160 + (draggableVertex.x - editorCenter.x) * editorScale,
    y: 110 - (draggableVertex.y - editorCenter.y) * editorScale,
  };
  const parametersBeforeDrag = [
    elements.get("parameter0Out").textContent,
    elements.get("parameter1Out").textContent,
  ];
  listeners.get("tileEditorCanvas:pointerdown")({
    clientX: handle.x,
    clientY: handle.y,
    pointerId: 2,
    preventDefault() {},
  });
  listeners.get("tileEditorCanvas:pointermove")({
    clientX: handle.x + 18,
    clientY: handle.y - 12,
    pointerId: 2,
    preventDefault() {},
  });
  assert.notDeepEqual([
    elements.get("parameter0Out").textContent,
    elements.get("parameter1Out").textContent,
  ], parametersBeforeDrag);
  listeners.get("tileEditorCanvas:pointerup")({ pointerId: 2 });
  listeners.get("resetTileVertices:click")();
  assert.equal(elements.get("parameter0Out").textContent, "0.105");
  assert.equal(elements.get("parameter1Out").textContent, "0.650");

  elements.get("tilingType").value = "1";
  listeners.get("tilingType:change")();
  flushAnimationFrame();
  assert.match(elements.get("formSummary").textContent, /IH01/);
  assert.equal(elements.get("parameterCount").textContent, "4 parameters · guarded");
  assert.equal(elements.get("parameterControl4").hidden, true);

  elements.get("parameter0").value = "0.2";
  listeners.get("parameter0:input")();
  assert.equal(elements.get("parameter0Out").textContent, "0.200");
  elements.get("edgeCurve1").value = "0.7";
  listeners.get("edgeCurve1:input")();
  assert.equal(elements.get("edgeCurve1Out").textContent, "70% forward");
  listeners.get("straightenEdges:click")();
  assert.equal(elements.get("edgeCurve1Out").textContent, "straight");

  elements.get("tilingType").value = "31";
  listeners.get("tilingType:change")();
  assert.equal(elements.get("edgeCount").textContent, "0 bendable classes");
  assert.equal(elements.get("edgeControl0").hidden, true);
  assert.equal(elements.get("edgeCurve0").disabled, true);
  assert.equal(elements.get("resetTileVertices").disabled, true);
  assert.equal(attributes.get("tileEditorCanvas:aria-disabled"), "true");
  assert.equal(elements.get("tileEditorLegend").textContent, "symmetry-locked corners");

  elements.get("density").value = "0.7";
  listeners.get("density:input")();
  elements.get("lineAngle").value = "42";
  listeners.get("lineAngle:input")();
  listeners.get("resetForm:click")();
  flushAnimationFrame();
  assert.equal(elements.get("tilingType").value, "20");
  assert.equal(elements.get("density").value, "0.52");
  assert.equal(elements.get("lineAngle").value, "90");
  assert.equal(elements.get("position").value, "0.5");
  assert.match(elements.get("formSummary").textContent, /Pentagon · IH20/);

  for (const oldSoundId of [
    "soundMode",
    "percussionArticulation",
    "shepardArticulation",
    "fmArticulation",
    "pmArticulation",
  ]) {
    assert.equal(elements.has(oldSoundId), false, `${oldSoundId} should remain on the old Lattice page`);
  }
});

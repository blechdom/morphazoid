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
  const previousSetTimeout = globalThis.setTimeout;
  const previousAudioContext = globalThis.AudioContext;
  const previousFetch = globalThis.fetch;
  let oscillatorStarts = 0;
  let bufferSourceStarts = 0;
  let sampleFetches = 0;
  const audioParam = (value = 0) => ({
    value,
    setValueAtTime(next) { this.value = next; },
    linearRampToValueAtTime(next) { this.value = next; },
    exponentialRampToValueAtTime(next) { this.value = next; },
    setTargetAtTime(next) { this.value = next; },
  });
  const audioNode = (properties = {}) => ({
    ...properties,
    connect(destination) {
      return destination;
    },
  });
  globalThis.setTimeout = (callback) => {
    queueMicrotask(callback);
    return 1;
  };
  globalThis.AudioContext = class {
    constructor() {
      this.state = "running";
      this.currentTime = 1;
      this.sampleRate = 44_100;
      this.destination = audioNode();
    }

    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(),
        knee: audioParam(),
        ratio: audioParam(),
        attack: audioParam(),
        release: audioParam(),
      });
    }

    createGain() {
      return audioNode({ gain: audioParam() });
    }

    createAnalyser() {
      return audioNode({ fftSize: 0 });
    }

    createOscillator() {
      return audioNode({
        frequency: audioParam(),
        type: "sine",
        start() {
          oscillatorStarts += 1;
        },
        stop() {},
      });
    }

    createBufferSource() {
      return audioNode({
        playbackRate: audioParam(1),
        start() {
          bufferSourceStarts += 1;
        },
        stop() {},
      });
    }

    createBiquadFilter() {
      return audioNode({ frequency: audioParam(), Q: audioParam(), type: "lowpass" });
    }

    createBuffer(_channels, frameCount) {
      return {
        getChannelData() {
          return new Float32Array(frameCount);
        },
      };
    }

    decodeAudioData(_data, resolve) {
      const decoded = { duration: .5 };
      if (resolve) {
        queueMicrotask(() => resolve(decoded));
        return undefined;
      }
      return Promise.resolve(decoded);
    }

    async resume() {}

    async close() {
      this.state = "closed";
    }
  };
  globalThis.fetch = async () => {
    sampleFetches += 1;
    return {
      ok: true,
      async arrayBuffer() {
        return new ArrayBuffer(16);
      },
    };
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
  const mappingOptions = descendants(elements.get("mappingMode"))
    .filter((node) => node.tagName === "OPTION");
  assert.equal(tilingOptions.length, 72, "the selector should expose every isohedral preset");
  assert.equal(mappingOptions.length, 4);
  assert.equal(mappingOptions.at(-1).value, "tile-color-pair");
  assert.equal(elements.get("tilingType").value, "20");
  assert.equal(elements.get("drumEngine").value, "fm");
  assert.equal(elements.get("engineStatus").textContent, "FM synth · audio off");
  assert.equal(elements.get("speed").value, "0.36");
  assert.equal(elements.get("speedOut").textContent, "0.360 cyc/s");
  assert.equal(elements.get("motionSummary").textContent, "paused · 0.360 cyc/s");
  assert.match(elements.get("formSummary").textContent, /Pentagon · IH20/);
  assert.equal(elements.get("parameterCount").textContent, "2 parameters · guarded");
  assert.equal(elements.get("edgeCount").textContent, "3 bendable classes");
  assert.equal(elements.get("drumMap").children.length, 16);
  assert.equal(elements.get("mappingLegend").children.length, 5);
  assert.equal(elements.get("drumMap").dataset.mappingMode, "edge-angle");
  assert.equal(tileEditorCanvas.width, 640);
  assert.equal(tileEditorCanvas.height, 440);
  assert.equal(typeof listeners.get("tileEditorCanvas:pointerdown"), "function");
  assert.equal(typeof listeners.get("tileEditorCanvas:pointermove"), "function");
  assert.equal(typeof listeners.get("tileEditorCanvas:pointerup"), "function");
  assert.equal(typeof listeners.get("auditionEngine:click"), "function");

  elements.get("mappingMode").value = "tile-color-pair";
  listeners.get("mappingMode:change")();
  assert.equal(elements.get("mappingSummary").textContent, "tile color pair · fm synth");
  assert.match(elements.get("mappingDescription").textContent, /two tile colors/i);
  assert.equal(elements.get("drumMap").dataset.mappingMode, "tile-color-pair");
  assert.equal(elements.get("drumMap").children.length, 16);
  assert.equal(elements.get("drumMap").children[0].children[1].children.length, 2);
  elements.get("drumEngine").value = "samples";
  await listeners.get("drumEngine:change")();
  assert.equal(elements.get("drumEngine").value, "samples");
  assert.equal(elements.get("mappingSummary").textContent, "tile color pair · 808/909 samples");
  assert.equal(elements.get("engineStatus").textContent, "Sample engine · audio off · 0/16 in RAM");
  assert.equal(elements.get("drumMap").children[0].children[0].textContent, "808 BD Short");

  elements.get("drumEngine").value = "fm";
  await listeners.get("drumEngine:change")();
  await listeners.get("audioButton:click")();
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(elements.get("engineStatus").textContent, "FM synth active");
  await listeners.get("auditionEngine:click")?.();
  assert.ok(oscillatorStarts > 0, "FM audition should start oscillator voices");

  const bufferSourcesAfterFm = bufferSourceStarts;
  elements.get("drumEngine").value = "samples";
  await listeners.get("drumEngine:change")();
  assert.equal(elements.get("audioState").textContent, "on");
  assert.match(elements.get("engineStatus").textContent, /^Sample engine · \d+\/16 samples in RAM$/);
  assert.ok(sampleFetches > 0, "sample audition should fetch decoded sample buffers");
  assert.ok(bufferSourceStarts > bufferSourcesAfterFm, "sample audition should start buffer sources");

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
  elements.get("patternAngle").value = "17.6";
  listeners.get("patternAngle:input")();
  assert.equal(elements.get("patternAngleOut").textContent, "17.6°");
  elements.get("lineAngle").value = "42.3";
  listeners.get("lineAngle:input")();
  assert.equal(elements.get("lineAngleOut").textContent, "42.3°");
  listeners.get("resetForm:click")();
  flushAnimationFrame();
  assert.equal(elements.get("tilingType").value, "20");
  assert.equal(elements.get("density").value, "0.52");
  assert.equal(elements.get("lineAngle").value, "90");
  assert.equal(elements.get("lineAngleOut").textContent, "90.0°");
  assert.equal(elements.get("position").value, "0.5");
  assert.match(elements.get("formSummary").textContent, /Pentagon · IH20/);

  elements.get("speed").value = "0.1";
  listeners.get("speed:input")();
  assert.equal(elements.get("speedOut").textContent, "0.100 cyc/s");
  listeners.get("resetLatticeDrums:click")();
  flushAnimationFrame();
  assert.equal(elements.get("speed").value, "0.36");
  assert.equal(elements.get("speedOut").textContent, "0.360 cyc/s");
  assert.equal(elements.get("motionSummary").textContent, "paused · 0.360 cyc/s");
  assert.equal(elements.get("mappingMode").value, "edge-angle");
  assert.equal(elements.get("drumEngine").value, "fm");
  assert.equal(elements.get("engineStatus").textContent, "FM synth active");
  assert.equal(elements.get("drumMap").dataset.mappingMode, "edge-angle");

  for (const oldSoundId of [
    "soundMode",
    "percussionArticulation",
    "shepardArticulation",
    "fmArticulation",
    "pmArticulation",
  ]) {
    assert.equal(elements.has(oldSoundId), false, `${oldSoundId} should remain on the old Lattice page`);
  }

  if (previousSetTimeout === undefined) delete globalThis.setTimeout;
  else globalThis.setTimeout = previousSetTimeout;
  if (previousAudioContext === undefined) delete globalThis.AudioContext;
  else globalThis.AudioContext = previousAudioContext;
  if (previousFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = previousFetch;
});

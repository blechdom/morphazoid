import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  cancelAndHoldAtTime(time) {
    this.events.push(["cancelAndHoldAtTime", time]);
  }

  cancelScheduledValues(time) {
    this.events.push(["cancelScheduledValues", time]);
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(["setValueAtTime", value, time]);
  }

  setTargetAtTime(value, time, timeConstant) {
    this.value = value;
    this.events.push(["setTargetAtTime", value, time, timeConstant]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["linearRampToValueAtTime", value, time]);
  }
}

class FakeAudioNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
    this.disconnectCount = 0;
  }

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect(destination) {
    this.disconnectCount += 1;
    if (destination === undefined) this.connections.length = 0;
    else this.connections = this.connections.filter((target) => target !== destination);
  }
}

class FakeOscillator extends FakeAudioNode {
  constructor() {
    super("oscillator");
    this.type = "sine";
    this.frequency = new FakeAudioParam(440);
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }

  start(time = 0) {
    this.starts.push(time);
  }

  stop(time = 0) {
    this.stops.push(time);
  }
}

class FakeGain extends FakeAudioNode {
  constructor() {
    super("gain");
    this.gain = new FakeAudioParam(1);
  }
}

class FakeFilter extends FakeAudioNode {
  constructor() {
    super("filter");
    this.type = "lowpass";
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
  }
}

class FakePanner extends FakeAudioNode {
  constructor() {
    super("panner");
    this.pan = new FakeAudioParam(0);
  }
}

class FakeCompressor extends FakeAudioNode {
  constructor() {
    super("compressor");
    this.threshold = new FakeAudioParam(-24);
    this.knee = new FakeAudioParam(30);
    this.ratio = new FakeAudioParam(12);
    this.attack = new FakeAudioParam(0.003);
    this.release = new FakeAudioParam(0.25);
  }
}

class FakeBufferSource extends FakeAudioNode {
  constructor() {
    super("buffer-source");
    this.buffer = null;
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }

  start(time = 0) {
    this.starts.push(time);
  }

  stop(time = 0) {
    this.stops.push(time);
  }
}

class FakeAudioContext {
  static instances = [];

  constructor(options = {}) {
    this.options = options;
    this.state = "suspended";
    this.currentTime = 1;
    this.sampleRate = 48_000;
    this.destination = new FakeAudioNode("destination");
    this.oscillators = [];
    this.bufferSources = [];
    this.resumeCount = 0;
    this.closeCount = 0;
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return new FakeGain();
  }

  createBiquadFilter() {
    return new FakeFilter();
  }

  createStereoPanner() {
    return new FakePanner();
  }

  createDynamicsCompressor() {
    return new FakeCompressor();
  }

  createBuffer(channels, length) {
    return {
      getChannelData() { return new Float32Array(Math.max(1, channels * length)); },
    };
  }

  createBufferSource() {
    const source = new FakeBufferSource();
    this.bufferSources.push(source);
    return source;
  }

  async resume() {
    this.resumeCount += 1;
    this.state = "running";
  }

  async close() {
    this.closeCount += 1;
    this.state = "closed";
  }
}

function camelDataName(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function attributeValue(source, name) {
  return source.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? null;
}

function createBrowserHarness(html) {
  const elements = new Map();
  const queryNodes = new Set();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const frames = new Map();
  const storage = new Map();
  let nextFrame = 1;
  let drawingCalls = 0;
  let drawingArcs = [];

  const addListener = (registry, type, listener) => {
    const bucket = registry.get(type) ?? [];
    bucket.push(listener);
    registry.set(type, bucket);
  };

  const dispatchListeners = (registry, type, event, target) => {
    const payload = {
      type,
      target,
      currentTarget: target,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...event,
    };
    for (const listener of registry.get(type) ?? []) listener(payload);
    return payload;
  };

  function createElementNode(tagName = "div", source = "", id = "") {
    const listeners = new Map();
    const attributes = new Map();
    const classes = new Set((attributeValue(source, "class") ?? "").split(/\s+/).filter(Boolean));
    const styleValues = new Map();
    const dataset = {};
    for (const match of source.matchAll(/\bdata-([a-z0-9-]+)="([^"]*)"/gi)) {
      dataset[camelDataName(match[1])] = match[2];
    }
    for (const match of source.matchAll(/\b([a-z][a-z0-9-]*)="([^"]*)"/gi)) {
      attributes.set(match[1], match[2]);
    }

    const node = {
      id,
      tagName: tagName.toUpperCase(),
      type: attributeValue(source, "type") ?? "",
      name: attributeValue(source, "name") ?? "",
      value: attributeValue(source, "value") ?? "",
      title: attributeValue(source, "title") ?? "",
      textContent: "",
      innerHTML: "",
      hidden: /(?:^|\s)hidden(?:\s|$)/i.test(source),
      disabled: /(?:^|\s)disabled(?:\s|$)/i.test(source),
      checked: /(?:^|\s)checked(?:\s|$)/i.test(source),
      dataset,
      children: [],
      parentElement: null,
      lastChild: null,
      width: 0,
      height: 0,
      style: {
        width: "",
        height: "",
        cursor: "",
        color: "",
        setProperty(name, value) { styleValues.set(name, String(value)); },
        getPropertyValue(name) { return styleValues.get(name) ?? ""; },
      },
      classList: {
        add(...names) { for (const name of names) classes.add(name); },
        remove(...names) { for (const name of names) classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
      },
      addEventListener(type, listener) { addListener(listeners, type, listener); },
      dispatch(type, event = {}) { return dispatchListeners(listeners, type, event, node); },
      click() { return node.dispatch("click"); },
      setAttribute(name, value) {
        const text = String(value);
        attributes.set(name, text);
        if (name.startsWith("data-")) dataset[camelDataName(name.slice(5))] = text;
      },
      getAttribute(name) { return attributes.get(name) ?? null; },
      append(...children) {
        for (const child of children) {
          if (!child) continue;
          child.parentElement = node;
          node.children.push(child);
          node.lastChild = child;
        }
      },
      replaceChildren(...children) {
        node.children.length = 0;
        const expanded = children.flatMap((child) => child?.isFragment ? child.children : [child]);
        node.append(...expanded);
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 400, height: 400 };
      },
      setPointerCapture(pointerId) { node.capturedPointers.add(pointerId); },
      releasePointerCapture(pointerId) { node.capturedPointers.delete(pointerId); },
      hasPointerCapture(pointerId) { return node.capturedPointers.has(pointerId); },
      capturedPointers: new Set(),
      focus() { documentObject.activeElement = node; },
    };
    Object.defineProperty(node, "className", {
      get() { return [...classes].join(" "); },
      set(value) {
        classes.clear();
        for (const name of String(value).split(/\s+/).filter(Boolean)) classes.add(name);
      },
    });
    return node;
  }

  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const [, tagName, source, id] = match;
    const node = createElementNode(tagName, source, id);
    elements.set(id, node);
    queryNodes.add(node);
  }
  let anonymousSequence = 0;
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const [, tagName, source] = match;
    if (!/\bdata-(?:axis|tool)=/i.test(source) || /\bid="/i.test(source)) continue;
    queryNodes.add(createElementNode(tagName, source, `anonymous-${++anonymousSequence}`));
  }

  const voiceFooter = createElementNode("span");
  voiceFooter.lastChild = { textContent: " PLAYHEAD" };
  elements.get("voiceCount").parentElement = voiceFooter;

  const drawingContext = {
    save() { drawingCalls += 1; },
    restore() { drawingCalls += 1; },
    beginPath() { drawingCalls += 1; },
    moveTo() { drawingCalls += 1; },
    lineTo() { drawingCalls += 1; },
    arc(...values) {
      drawingCalls += 1;
      drawingArcs.push(values);
    },
    stroke() { drawingCalls += 1; },
    fill() { drawingCalls += 1; },
    fillRect() { drawingCalls += 1; },
    setLineDash() { drawingCalls += 1; },
    setTransform() { drawingCalls += 1; },
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
  };
  const canvas = elements.get("paintStage");
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  elements.get("stageWrap").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 400,
    height: 400,
  });

  const documentObject = {
    hidden: false,
    visibilityState: "visible",
    activeElement: null,
    getElementById(id) { return elements.get(id) ?? null; },
    querySelectorAll(selector) {
      if (selector === "[data-axis]") {
        return [...queryNodes].filter((element) => element.dataset.axis !== undefined);
      }
      if (selector === "[data-tool]") {
        return [...queryNodes].filter((element) => element.dataset.tool !== undefined);
      }
      if (selector === 'input[name="playbackMode"]') {
        return [...queryNodes].filter((element) => (
          element.tagName === "INPUT" && element.name === "playbackMode"
        ));
      }
      return [];
    },
    createElement(tagName) { return createElementNode(tagName); },
    createDocumentFragment() {
      return {
        isFragment: true,
        children: [],
        append(...children) { this.children.push(...children); },
      };
    },
    addEventListener(type, listener) { addListener(documentListeners, type, listener); },
    dispatch(type, event = {}) {
      return dispatchListeners(documentListeners, type, event, documentObject);
    },
  };

  const mediaListeners = new Map();
  const windowObject = {
    devicePixelRatio: 2,
    addEventListener(type, listener) { addListener(windowListeners, type, listener); },
    dispatch(type, event = {}) {
      return dispatchListeners(windowListeners, type, event, windowObject);
    },
    matchMedia() {
      return {
        matches: false,
        addEventListener(type, listener) { addListener(mediaListeners, type, listener); },
      };
    },
  };

  const requestAnimationFrame = (callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  const cancelAnimationFrame = (id) => frames.delete(id);
  const flushFrame = (timestamp = 1_000) => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(timestamp);
    return callbacks.length;
  };
  const flushUntilIdle = (limit = 12) => {
    let count = 0;
    while (frames.size && count < limit) {
      flushFrame(1_000 + count * 16);
      count += 1;
    }
    return count;
  };

  return {
    elements,
    canvas,
    drawingContext,
    documentObject,
    windowObject,
    requestAnimationFrame,
    cancelAnimationFrame,
    flushFrame,
    flushUntilIdle,
    frameCount: () => frames.size,
    drawingCallCount: () => drawingCalls,
    drawingArcs: () => [...drawingArcs],
    clearDrawingArcs: () => { drawingArcs = []; },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    storage,
  };
}

function pointerEvent(pointerId, clientX, clientY, timeStamp) {
  return {
    pointerId,
    pointerType: "mouse",
    button: 0,
    clientX,
    clientY,
    pressure: 0.5,
    timeStamp,
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function installGlobals(replacements) {
  const originals = new Map();
  for (const [name, value] of Object.entries(replacements)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

test("Playhead Paint initializes, gates browser audio, performs symmetry, and tears down", async () => {
  const html = await readFile(new URL("../playhead-paint.html", import.meta.url), "utf8");
  const harness = createBrowserHarness(html);
  FakeAudioContext.instances.length = 0;
  const restoreGlobals = installGlobals({
    document: harness.documentObject,
    window: harness.windowObject,
    localStorage: harness.localStorage,
    AudioContext: FakeAudioContext,
    webkitAudioContext: undefined,
    requestAnimationFrame: harness.requestAnimationFrame,
    cancelAnimationFrame: harness.cancelAnimationFrame,
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() {}
      disconnect() {}
    },
  });

  const element = (id) => {
    const result = harness.elements.get(id);
    assert.ok(result, `missing fake DOM element #${id}`);
    return result;
  };
  const drawGesture = async ({ pointerId, start, move, end, finishType = "pointerup" }) => {
    harness.canvas.dispatch("pointerdown", pointerEvent(pointerId, ...start));
    await settle();
    if (move) harness.canvas.dispatch("pointermove", pointerEvent(pointerId, ...move));
    await settle();
    const finishEvent = finishType === "lostpointercapture"
      ? { pointerId, timeStamp: end[2] }
      : pointerEvent(pointerId, ...end);
    harness.canvas.dispatch(finishType, finishEvent);
    await settle();
  };

  try {
    await import(`../playhead-paint-app.js?smoke=${Date.now()}`);

    assert.equal(element("audioState").textContent, "off");
    assert.equal(element("audioButton").getAttribute("aria-pressed"), "false");
    assert.equal(element("markCount").textContent, "0");
    assert.equal(element("symmetryCount").textContent, "1 VOICE");
    assert.equal(element("voiceCount").textContent, "1");
    assert.equal(element("paintPalette").children.length, 4);
    assert.equal(element("xTarget").value, "pan");
    assert.equal(element("yTarget").value, "pitch");
    assert.equal(element("xTarget").children.length, 8, "assignment menus expose all sound targets");
    assert.deepEqual(
      element("xTarget").children.slice(-2).map(({ textContent }) => textContent),
      ["Shepard spiral", "Ouroboros orbit"],
    );
    assert.equal(element("coordinateMode").value, "cartesian");
    assert.equal(element("xSourceLabel").textContent, "X axis");
    assert.equal(element("ySourceLabel").textContent, "Y axis");
    assert.equal(harness.canvas.width, 800);
    assert.equal(harness.canvas.height, 800);
    assert.ok(harness.drawingCallCount() > 0, "initial canvas frame rendered");
    assert.equal(FakeAudioContext.instances.length, 0, "initialization is audio-lazy");

    await drawGesture({
      pointerId: 1,
      start: [80, 300, 1_000],
      move: [180, 210, 1_025],
      end: [260, 120, 1_050],
    });
    assert.equal(element("markCount").textContent, "1", "silent drawing still commits a mark");
    assert.equal(FakeAudioContext.instances.length, 0, "drawing never auto-arms audio");
    assert.equal(element("audioState").textContent, "off");

    element("audioButton").click();
    await settle();
    const [context] = FakeAudioContext.instances;
    assert.ok(context, "the explicit Audio button constructs the context");
    assert.equal(context.state, "running");
    assert.equal(context.resumeCount, 1);
    assert.equal(context.oscillators.length, 0, "arming remains silent until pointer down");
    assert.equal(element("audioState").textContent, "on");
    assert.equal(element("audioButton").getAttribute("aria-pressed"), "true");

    const ordinaryVoiceStart = context.oscillators.length;
    await drawGesture({
      pointerId: 2,
      start: [110, 290, 1_100],
      move: [210, 190, 1_125],
      end: [290, 110, 1_150],
    });
    const ordinaryOscillators = context.oscillators.slice(ordinaryVoiceStart);
    assert.equal(ordinaryOscillators.length, 2, "one playhead creates one carrier/modulator pair");
    assert.ok(ordinaryOscillators.every(({ starts }) => starts.length === 1));
    assert.ok(ordinaryOscillators.every(({ stops }) => stops.length >= 1), "pointerup gates off both nodes");
    assert.equal(element("markCount").textContent, "2");

    const cancelStart = context.oscillators.length;
    await drawGesture({
      pointerId: 3,
      start: [120, 270, 1_200],
      move: [180, 220, 1_220],
      end: [190, 210, 1_230],
      finishType: "pointercancel",
    });
    assert.ok(
      context.oscillators.slice(cancelStart).every(({ stops }) => stops.length >= 1),
      "pointercancel releases its live gate",
    );

    const lostCaptureStart = context.oscillators.length;
    await drawGesture({
      pointerId: 4,
      start: [140, 250, 1_300],
      move: [220, 170, 1_320],
      end: [220, 170, 1_335],
      finishType: "lostpointercapture",
    });
    assert.ok(
      context.oscillators.slice(lostCaptureStart).every(({ stops }) => stops.length >= 1),
      "lost capture releases its live gate",
    );

    element("coordinateMode").value = "polar";
    element("coordinateMode").dispatch("change");
    assert.equal(element("xSourceLabel").textContent, "Center radius");
    assert.equal(element("ySourceLabel").textContent, "Bearing / cyclic phase");
    assert.equal(element("coordinateReadout").textContent, "RADIUS / BEARING");
    assert.equal(element("stageSourceOne").textContent, "R");
    assert.equal(element("stageSourceTwo").textContent, "B/φ");

    const polarSeamStart = context.oscillators.length;
    harness.canvas.dispatch("pointerdown", pointerEvent(8, 320, 199, 1_340));
    await settle();
    const polarCarrier = context.oscillators[polarSeamStart];
    const aboveSeamFrequency = polarCarrier.frequency.value;
    harness.canvas.dispatch("pointermove", pointerEvent(8, 320, 201, 1_345));
    await settle();
    const belowSeamFrequency = polarCarrier.frequency.value;
    assert.ok(
      Math.max(aboveSeamFrequency, belowSeamFrequency)
        / Math.min(aboveSeamFrequency, belowSeamFrequency) < 1.001,
      "linear pitch uses seam-free polar bearing",
    );
    harness.canvas.dispatch("pointermove", pointerEvent(8, 200, 200, 1_350));
    await settle();
    assert.ok(
      Math.abs(polarCarrier.frequency.value - Math.sqrt(55 * 1_760)) < 1e-6,
      "undefined center bearing is finite and neutral",
    );
    harness.canvas.dispatch("pointermove", pointerEvent(8, 200.2, 199.8, 1_355));
    await settle();
    assert.ok(
      Math.abs(polarCarrier.frequency.value - Math.sqrt(55 * 1_760)) < 1,
      "sub-pixel center jitter stays bounded",
    );
    harness.canvas.dispatch("pointerup", pointerEvent(8, 200.2, 199.8, 1_358));
    await settle();

    element("yTarget").value = "ouroboros";
    element("yTarget").dispatch("change");
    const ouroborosStart = context.oscillators.length;
    harness.canvas.dispatch("pointerdown", pointerEvent(9, 200, 200, 1_360));
    await settle();
    const ouroborosCarrier = context.oscillators[ouroborosStart];
    const neutralOrbitFrequency = ouroborosCarrier.frequency.value;
    assert.ok(Math.abs(neutralOrbitFrequency - Math.sqrt(55 * 1_760)) < 1e-6);
    harness.canvas.dispatch("pointermove", pointerEvent(9, 200.2, 199.8, 1_363));
    await settle();
    assert.ok(
      Math.abs(ouroborosCarrier.frequency.value - neutralOrbitFrequency) < 1,
      "angular Ouroboros influence fades through undefined center jitter",
    );
    harness.canvas.dispatch("pointermove", pointerEvent(9, 200, 80, 1_366));
    await settle();
    const northOrbitFrequency = ouroborosCarrier.frequency.value;
    harness.canvas.dispatch("pointermove", pointerEvent(9, 200, 320, 1_369));
    await settle();
    const southOrbitFrequency = ouroborosCarrier.frequency.value;
    assert.ok(
      northOrbitFrequency / southOrbitFrequency > 2,
      "Ouroboros receives true circular phase rather than folded bearing",
    );
    harness.canvas.dispatch("pointermove", pointerEvent(9, 320, 199, 1_372));
    await settle();
    const aboveOrbitSeam = ouroborosCarrier.frequency.value;
    harness.canvas.dispatch("pointermove", pointerEvent(9, 320, 201, 1_375));
    await settle();
    const belowOrbitSeam = ouroborosCarrier.frequency.value;
    assert.ok(
      Math.max(aboveOrbitSeam, belowOrbitSeam) / Math.min(aboveOrbitSeam, belowOrbitSeam) < 1.02,
      "cyclic Ouroboros crosses the raw phase seam continuously",
    );
    harness.canvas.dispatch("pointerup", pointerEvent(9, 320, 202, 1_378));
    await settle();

    element("yTarget").value = "shepard";
    element("yTarget").dispatch("change");
    const shepardStart = context.oscillators.length;
    harness.canvas.dispatch("pointerdown", pointerEvent(7, 320, 199, 1_380));
    await settle();
    assert.equal(
      context.oscillators.length - shepardStart,
      6,
      "one Shepard playhead crossfades three carrier/modulator pairs",
    );
    const shepardCarriers = [0, 2, 4].map((offset) => context.oscillators[shepardStart + offset]);
    const shepardAbove = shepardCarriers.map(({ frequency }) => frequency.value);
    harness.canvas.dispatch("pointermove", pointerEvent(7, 320, 201, 1_395));
    await settle();
    assert.equal(context.oscillators.length - shepardStart, 6);
    shepardCarriers.forEach(({ frequency }, index) => {
      assert.ok(
        Math.max(shepardAbove[index], frequency.value)
          / Math.min(shepardAbove[index], frequency.value) < 1.001,
        "fixed-key Shepard voices use seam-free bearing",
      );
    });
    harness.canvas.dispatch("pointerup", pointerEvent(7, 320, 202, 1_410));
    await settle();
    element("yTarget").value = "pitch";
    element("yTarget").dispatch("change");

    const axisButtons = harness.documentObject.querySelectorAll("[data-axis]");
    assert.equal(axisButtons.length, 4);
    for (const button of axisButtons) button.click();
    assert.ok(axisButtons.every((button) => button.getAttribute("aria-pressed") === "true"));
    assert.equal(element("symmetryCount").textContent, "8 VOICES");
    assert.equal(element("voiceCount").textContent, "8");
    assert.equal(element("voiceCount").parentElement.lastChild.textContent, " PLAYHEADS");

    const symmetryStart = context.oscillators.length;
    harness.canvas.dispatch("pointerdown", pointerEvent(5, 84, 256, 1_420));
    await settle();
    const symmetryOscillators = context.oscillators.slice(symmetryStart);
    assert.equal(symmetryOscillators.length, 16, "D4 produces eight keyed carrier/modulator pairs");
    harness.canvas.dispatch("pointermove", pointerEvent(5, 132, 200, 1_435));
    await settle();
    assert.equal(
      context.oscillators.length,
      symmetryStart + 16,
      "coincident reflections on an axis retain all eight voice identities",
    );
    assert.ok(
      symmetryOscillators.every(({ stops }) => stops.length === 0),
      "touching a reflection axis does not gate off duplicate-looking voices",
    );
    harness.clearDrawingArcs();
    harness.flushFrame(1_436);
    assert.equal(
      harness.drawingArcs().filter(([, , radius]) => radius === 4.5).length,
      4,
      "coincident D4 audio voices collapse to four visual playhead circles on the axis",
    );
    harness.canvas.dispatch("pointermove", pointerEvent(5, 132, 176, 1_445));
    await settle();
    assert.equal(
      context.oscillators.length,
      symmetryStart + 16,
      "crossing an axis updates stable D4 voices rather than reallocating them",
    );
    assert.ok(
      symmetryOscillators.every(({ stops }) => stops.length === 0),
      "axis crossing remains legato until pointer release",
    );
    harness.canvas.dispatch("pointerup", pointerEvent(5, 180, 160, 1_470));
    await settle();
    assert.ok(symmetryOscillators.every(({ stops }) => stops.length >= 1));
    assert.equal(element("markCount").textContent, "8");

    harness.flushUntilIdle();
    const renderCount = harness.drawingCallCount();
    element("rotation").value = "45";
    element("rotation").dispatch("input");
    element("scaleX").value = "1.2";
    element("scaleX").dispatch("input");
    assert.equal(element("rotationOut").textContent, "45°");
    assert.equal(element("scaleXOut").textContent, "120%");
    assert.ok(harness.frameCount() > 0);
    harness.flushUntilIdle();
    assert.ok(harness.drawingCallCount() > renderCount, "transformed marks render without mutation errors");
    const saved = JSON.parse(harness.storage.get("morphazoid:playhead-paint:v1"));
    assert.equal(saved.sceneTransform.rotationDeg, 45);
    assert.equal(saved.sceneTransform.scaleX, 1.2);

    element("playButton").click();
    assert.equal(element("playButton").getAttribute("aria-pressed"), "true");
    assert.equal(element("playLabel").textContent, "Pause");
    assert.ok(harness.frameCount() > 0);
    harness.flushFrame(2_000);
    await settle();
    element("stopButton").click();
    await settle();
    assert.equal(element("playButton").getAttribute("aria-pressed"), "false");
    assert.equal(element("playLabel").textContent, "Play");
    assert.match(element("playbackReadout").textContent, /^0\.0 \/ /);
    harness.flushUntilIdle();

    const teardownStart = context.oscillators.length;
    harness.canvas.dispatch("pointerdown", pointerEvent(6, 92, 244, 1_500));
    await settle();
    assert.equal(context.oscillators.length, teardownStart + 16);
    harness.windowObject.dispatch("pagehide");
    await settle();
    assert.equal(element("audioState").textContent, "off");
    assert.equal(context.state, "closed");
    assert.equal(context.closeCount, 1);
    assert.ok(
      context.oscillators.every(({ stops }) => stops.length >= 1),
      "page teardown stops every carrier and modulator, including the active pointer",
    );
  } finally {
    if (FakeAudioContext.instances[0]?.state !== "closed") {
      harness.windowObject.dispatch("pagehide");
      await settle();
    }
    restoreGlobals();
  }
});

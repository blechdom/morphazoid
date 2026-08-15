import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Escher app renders, responds to every input path, and cleans up", async (t) => {
  const html = await readFile(new URL("escher-tessellation.html", root), "utf8");
  const openingTags = new Map(
    [...html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)]
      .map((match) => [match[2], { tagName: match[1].toUpperCase(), markup: match[0] }]),
  );
  const elements = new Map();
  const elementListeners = new Map();
  const globalListeners = new Map();
  const attributes = new Map();
  const capturedPointers = new Set();

  const listenerKey = (node, type) => `${node.testId}:${type}`;
  const addListener = (registry, key, listener) => {
    if (!registry.has(key)) registry.set(key, []);
    registry.get(key).push(listener);
  };

  function makeEvent(properties = {}) {
    return {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...properties,
    };
  }

  async function dispatchNode(node, type, properties = {}) {
    const event = makeEvent({ target: node, currentTarget: node, ...properties });
    const results = (elementListeners.get(listenerKey(node, type)) ?? [])
      .map((listener) => listener(event));
    await Promise.all(results.filter((result) => result && typeof result.then === "function"));
    return event;
  }

  async function dispatchGlobal(type, properties = {}) {
    const event = makeEvent(properties);
    const results = (globalListeners.get(type) ?? []).map((listener) => listener(event));
    await Promise.all(results.filter((result) => result && typeof result.then === "function"));
    return event;
  }

  function makeClassList() {
    const classes = new Set();
    return {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
    };
  }

  function createElement(id, tagName = "DIV", markup = "") {
    const valueMatch = markup.match(/\bvalue="([^"]*)"/);
    const node = {
      id,
      testId: id,
      tagName,
      value: valueMatch?.[1] ?? "",
      textContent: "",
      innerHTML: "",
      hidden: /\bhidden(?:\s|>|=)/.test(markup),
      checked: /\bchecked(?:\s|>|=)/.test(markup),
      disabled: /\bdisabled(?:\s|>|=)/.test(markup),
      href: "",
      dataset: {},
      style: {},
      classList: makeClassList(),
      addEventListener(type, listener) {
        addListener(elementListeners, listenerKey(this, type), listener);
      },
      removeEventListener(type, listener) {
        const key = listenerKey(this, type);
        elementListeners.set(key, (elementListeners.get(key) ?? []).filter(
          (candidate) => candidate !== listener,
        ));
      },
      setAttribute(name, value) {
        attributes.set(`${this.testId}:${name}`, String(value));
      },
      getAttribute(name) {
        return attributes.get(`${this.testId}:${name}`) ?? null;
      },
      removeAttribute(name) {
        attributes.delete(`${this.testId}:${name}`);
      },
      hasAttribute(name) {
        return new RegExp(`\\b${name}(?:\\s|>|=)`).test(markup)
          || attributes.has(`${this.testId}:${name}`);
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 };
      },
      setPointerCapture(pointerId) { capturedPointers.add(pointerId); },
      releasePointerCapture(pointerId) { capturedPointers.delete(pointerId); },
      focus() {},
    };
    elements.set(id, node);
    return node;
  }

  for (const [id, { tagName, markup }] of openingTags) createElement(id, tagName, markup);

  const playbackButtons = [
    ["shape", "Shape"],
    ["neighbors", "Neighbors"],
    ["pattern", "Pattern"],
  ].map(([playback, label]) => {
    const button = createElement(`playback-${playback}`, "BUTTON");
    button.dataset.playback = playback;
    button.textContent = label;
    return button;
  });

  let canvasRect = { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600 };
  const renderSnapshots = [];
  let fills = 0;
  let strokes = 0;
  let currentSnapshot = null;
  const mixHash = (...values) => {
    if (!currentSnapshot) return;
    for (const value of values) {
      const tokens = typeof value === "string"
        ? [...value].map((character) => character.codePointAt(0))
        : [Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0];
      for (const token of tokens) {
        currentSnapshot.hash = Math.imul(
          currentSnapshot.hash ^ token,
          16_777_619,
        ) >>> 0;
      }
    }
  };
  const coordinateMethod = (...values) => mixHash(...values);
  const contextTarget = {
    beginPath() {},
    closePath() {},
    save() {},
    restore() {},
    clip() {},
    setLineDash() {},
    setTransform(...values) { mixHash(...values); },
    translate(...values) { mixHash(...values); },
    rotate(...values) { mixHash(...values); },
    scale(...values) { mixHash(...values); },
    moveTo: coordinateMethod,
    lineTo: coordinateMethod,
    bezierCurveTo: coordinateMethod,
    quadraticCurveTo: coordinateMethod,
    ellipse: coordinateMethod,
    arc: coordinateMethod,
    rect: coordinateMethod,
    strokeRect: coordinateMethod,
    fillText(text, ...values) { mixHash(String(text).length, ...values); },
    fill() { fills += 1; if (currentSnapshot) currentSnapshot.fills += 1; },
    stroke() { strokes += 1; if (currentSnapshot) currentSnapshot.strokes += 1; },
    fillRect(x, y, width, height) {
      fills += 1;
      if (
        x === 0
        && y === 0
        && Math.abs(width - canvasRect.width) < 1
        && Math.abs(height - canvasRect.height) < 1
      ) {
        currentSnapshot = { hash: 2_166_136_261, fills: 0, strokes: 0 };
        renderSnapshots.push(currentSnapshot);
      }
      if (currentSnapshot) {
        currentSnapshot.fills += 1;
        mixHash(x, y, width, height);
      }
    },
    clearRect() {},
  };
  const drawingContext = new Proxy(contextTarget, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property === "symbol") return target[property];
      const fallback = () => {};
      target[property] = fallback;
      return fallback;
    },
    set(target, property, value) {
      target[property] = value;
      if (typeof property === "string") mixHash(property, value);
      return true;
    },
  });

  const canvas = elements.get("stage");
  assert.ok(canvas, "markup must expose #stage");
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({ ...canvasRect });

  let nextFrameId = 0;
  const queuedFrames = new Map();
  const cancelledFrames = [];
  globalThis.requestAnimationFrame = (callback) => {
    nextFrameId += 1;
    queuedFrames.set(nextFrameId, callback);
    return nextFrameId;
  };
  globalThis.cancelAnimationFrame = (frameId) => {
    cancelledFrames.push(frameId);
    queuedFrames.delete(frameId);
  };
  let frameTime = 1_000;
  function runFrame(delta = 16) {
    const entry = queuedFrames.entries().next().value;
    assert.ok(entry, "the app should leave an animation frame queued");
    const [frameId, callback] = entry;
    queuedFrames.delete(frameId);
    frameTime += delta;
    callback(frameTime);
  }

  let resizeObserver = null;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      resizeObserver = this;
    }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };

  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    querySelectorAll(selector) {
      if (selector === "#playbackChoice button") return playbackButtons;
      return [];
    },
  };
  globalThis.window = globalThis;
  globalThis.devicePixelRatio = 2;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.addEventListener = (type, listener) => addListener(globalListeners, type, listener);
  globalThis.removeEventListener = (type, listener) => {
    globalListeners.set(type, (globalListeners.get(type) ?? []).filter(
      (candidate) => candidate !== listener,
    ));
  };

  let nextTimerId = 0;
  const intervalTimers = new Map();
  const clearedTimers = [];
  globalThis.setInterval = (callback, delay) => {
    nextTimerId += 1;
    intervalTimers.set(nextTimerId, { callback, delay });
    return nextTimerId;
  };
  globalThis.clearInterval = (timerId) => {
    clearedTimers.push(timerId);
    intervalTimers.delete(timerId);
  };
  function runAudioTimers() {
    for (const { callback } of [...intervalTimers.values()]) callback();
  }

  const audioContexts = [];
  const oscillators = [];
  const audioParamEvents = [];
  const audioParam = (value = 0) => ({
    value,
    setTargetAtTime(next, time, constant) {
      this.value = next;
      audioParamEvents.push({ method: "target", value: next, time, constant });
    },
    setValueAtTime(next, time) {
      this.value = next;
      audioParamEvents.push({ method: "set", value: next, time });
    },
    linearRampToValueAtTime(next, time) {
      this.value = next;
      audioParamEvents.push({ method: "linear", value: next, time });
    },
    exponentialRampToValueAtTime(next, time) {
      this.value = next;
      audioParamEvents.push({ method: "exponential", value: next, time });
    },
    cancelScheduledValues(time) {
      audioParamEvents.push({ method: "cancel", time });
    },
  });
  const audioNode = (properties = {}) => ({
    ...properties,
    connect(destination) { return destination; },
    disconnect() {},
  });
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = audioNode();
      this.sampleRate = 48_000;
      this.suspendCalls = 0;
      this.closeCalls = 0;
      audioContexts.push(this);
    }
    createGain() { return audioNode({ gain: audioParam(0) }); }
    createBiquadFilter() {
      return audioNode({ type: "lowpass", frequency: audioParam(2_400), Q: audioParam(0) });
    }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0),
        knee: audioParam(0),
        ratio: audioParam(0),
        attack: audioParam(0),
        release: audioParam(0),
      });
    }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createOscillator() {
      const oscillator = audioNode({
        type: "sine",
        frequency: audioParam(110),
        started: false,
        stopped: false,
        startTimes: [],
        stopTimes: [],
        start(time = 0) { this.started = true; this.startTimes.push(time); },
        stop(time = 0) { this.stopped = true; this.stopTimes.push(time); },
      });
      oscillators.push(oscillator);
      return oscillator;
    }
    createBuffer() { return {}; }
    createBufferSource() {
      return audioNode({ start() { this.onended?.(); } });
    }
    async resume() { this.state = "running"; }
    async suspend() { this.suspendCalls += 1; this.state = "suspended"; }
    async close() { this.closeCalls += 1; this.state = "closed"; }
  };

  const { EscherPerformanceAudio } = await import("../src/escher-performance-audio.js");
  const originalConfigure = EscherPerformanceAudio.prototype.configure;
  const performanceConfigs = [];
  EscherPerformanceAudio.prototype.configure = function capturePerformanceConfig(config) {
    performanceConfigs.push(config);
    return originalConfigure.call(this, config);
  };
  t.after(() => {
    EscherPerformanceAudio.prototype.configure = originalConfigure;
  });

  await import(`../escher-tessellation-app.js?smoke=${Date.now()}`);

  assert.ok(renderSnapshots.length >= 1, "initialization should paint a complete frame");
  assert.ok(fills > 10, "the initial tessellation should fill its tiles");
  assert.ok(strokes > 0, "the initial tessellation should stroke outlines and guides");
  assert.equal(canvas.width, 1_800);
  assert.equal(canvas.height, 1_200);
  assert.match(
    elements.get("stageReadout").textContent,
    /^SHAPE · READY · 1 PLAYHEAD · \d+ TILES$/,
  );
  assert.match(attributes.get("stage:aria-label"), /Counterform current/);
  assert.match(attributes.get("stage:aria-label"), /actual shape outline playhead/);
  assert.equal(elements.get("playbackSummary").textContent, "ready · 1 actual outline");
  assert.equal(attributes.get("playback-shape:aria-pressed"), "true");
  assert.equal(attributes.get("playback-neighbors:aria-pressed"), "false");
  assert.equal(attributes.get("playback-pattern:aria-pressed"), "false");
  assert.equal(elements.get("neighborReach").disabled, true);
  assert.equal(typeof queuedFrames.values().next().value, "function");
  assert.equal(
    elements.get("soundSummary").textContent,
    "position · angle · color · border · 82.5 Hz",
  );

  const initialPerformanceConfig = performanceConfigs.at(-1);
  assert.ok(initialPerformanceConfig, "initial contours must configure the performance engine");
  assert.ok(initialPerformanceConfig.fieldBounds, "audio must receive the full tessellation bounds");
  for (const coordinate of ["minX", "minY", "maxX", "maxY"]) {
    assert.ok(Number.isFinite(initialPerformanceConfig.fieldBounds[coordinate]));
  }
  assert.ok(initialPerformanceConfig.fieldBounds.minX < initialPerformanceConfig.fieldBounds.maxX);
  assert.ok(initialPerformanceConfig.fieldBounds.minY < initialPerformanceConfig.fieldBounds.maxY);
  assert.equal(initialPerformanceConfig.visualRotation, 0);
  assert.equal(initialPerformanceConfig.contrast, 0.76);
  assert.equal(initialPerformanceConfig.orientationDepth, 0.68);
  assert.equal(initialPerformanceConfig.colorAspectDepth, 0.76);
  assert.equal(initialPerformanceConfig.positionDepth, 0.64);
  assert.equal(initialPerformanceConfig.edgeArticulation, 0.72);

  const idleRenderCount = renderSnapshots.length;
  runFrame(1_000);
  assert.equal(
    renderSnapshots.length,
    idleRenderCount,
    "an idle tessellation must stay completely static without a hidden scan or drone clock",
  );

  async function renderControlAt(id, value, expectedOutput) {
    const control = elements.get(id);
    control.value = String(value);
    const beforeRender = renderSnapshots.length;
    await dispatchNode(control, "input");
    assert.equal(elements.get(`${id}Out`).textContent, expectedOutput);
    runFrame();
    assert.ok(renderSnapshots.length > beforeRender, `${id} must redraw the visible study`);
    return renderSnapshots.at(-1).hash;
  }

  assert.equal(elements.get("deformation").disabled, false);
  assert.match(elements.get("deformationNote").textContent, /curves the shared edges/i);
  for (const [id, low, lowOutput, high, highOutput] of [
    ["density", 0, "0%", 1, "100%"],
    ["deformation", 0, "0%", 1, "100%"],
    ["detail", 0, "0%", 1, "100%"],
  ]) {
    const lowHash = await renderControlAt(id, low, lowOutput);
    const highHash = await renderControlAt(id, high, highOutput);
    assert.notEqual(lowHash, highHash, `${id} extremes must materially change rendered geometry`);
  }
  const configsBeforeContrast = performanceConfigs.length;
  const lowContrastHash = await renderControlAt("contrast", 0.2, "20%");
  assert.ok(performanceConfigs.length > configsBeforeContrast, "contrast must reconfigure audio");
  assert.equal(performanceConfigs.at(-1).contrast, 0.2);
  const highContrastHash = await renderControlAt("contrast", 1, "100%");
  assert.equal(performanceConfigs.at(-1).contrast, 1);
  assert.notEqual(
    lowContrastHash,
    highContrastHash,
    "contrast extremes must materially change rendered figure/ground colors",
  );

  for (const [id, value] of [
    ["density", 0.54],
    ["deformation", 0.72],
    ["detail", 0.78],
    ["contrast", 0.76],
  ]) {
    elements.get(id).value = String(value);
    await dispatchNode(elements.get(id), "input");
  }
  runFrame();
  assert.equal(elements.get("densityOut").textContent, "54%");
  assert.equal(elements.get("deformationOut").textContent, "72%");
  assert.equal(elements.get("detailOut").textContent, "78%");
  assert.equal(elements.get("contrastOut").textContent, "76%");

  for (const id of ["zoomOutButton", "resetViewButton", "zoomInButton"]) {
    assert.ok(elements.has(id), `markup must expose accessible view control #${id}`);
    assert.ok(
      (elementListeners.get(`${id}:click`) ?? []).length > 0,
      `${id} must be wired at runtime`,
    );
  }
  assert.match(
    openingTags.get("resetButton")?.markup ?? "",
    /data-reset-all[^>]+data-reset-in-place/,
  );
  for (const [id, eventType] of [
    ["travelSpeed", "input"],
    ["neighborReach", "input"],
    ["playheadSize", "input"],
    ["pitchSpan", "input"],
    ["timbreMotion", "input"],
    ["stereoWidth", "input"],
    ["orientationDepth", "input"],
    ["colorAspectDepth", "input"],
    ["positionDepth", "input"],
    ["edgeArticulation", "input"],
    ["rotation", "input"],
    ["contrast", "input"],
  ]) {
    assert.ok((elementListeners.get(`${id}:${eventType}`) ?? []).length > 0, `${id} must be wired`);
  }
  assert.ok(playbackButtons.every((button) => (
    (elementListeners.get(`${button.testId}:click`) ?? []).length > 0
  )), "all three real-outline playback buttons must be wired");

  const preset = elements.get("preset");
  preset.value = "dual-horizon";
  await dispatchNode(preset, "change");
  assert.match(elements.get("studySummary").textContent, /Circle Limit IV/);
  assert.match(elements.get("presetDescription").textContent, /reflection tiling/i);
  assert.match(elements.get("symmetryReadout").textContent, /\{6,4\}/);
  assert.equal(elements.get("palette").value, "woodcut");
  assert.equal(elements.get("deformation").disabled, true);
  assert.equal(elements.get("deformationOut").textContent, "locked");
  assert.match(elements.get("deformationNote").textContent, /Poincaré geodesics/i);
  const beforePresetRender = renderSnapshots.length;
  runFrame();
  assert.ok(renderSnapshots.length > beforePresetRender, "preset changes must redraw the canvas");
  assert.match(
    elements.get("stageReadout").textContent,
    /^SHAPE · READY · 1 PLAYHEAD · \d+ POLYGONS$/,
  );

  const modeHashes = new Map();
  for (const button of playbackButtons) {
    await dispatchNode(button, "click");
    assert.equal(attributes.get(`${button.testId}:aria-pressed`), "true");
    for (const other of playbackButtons.filter((candidate) => candidate !== button)) {
      assert.equal(attributes.get(`${other.testId}:aria-pressed`), "false");
    }
    const beforeModeRender = renderSnapshots.length;
    runFrame();
    assert.ok(renderSnapshots.length > beforeModeRender, `${button.dataset.playback} must redraw`);
    modeHashes.set(button.dataset.playback, renderSnapshots.at(-1).hash);
    assert.match(elements.get("liveStatus").textContent, /playheads remain on actual shape outlines/i);
  }
  assert.ok(
    new Set(modeHashes.values()).size >= 2,
    "shape and multi-contour choices must draw different sets of real outlines",
  );
  assert.equal(elements.get("neighborReach").disabled, true, "Pattern leaves neighbor reach disabled");

  elements.get("travelSpeed").value = "0.73";
  await dispatchNode(elements.get("travelSpeed"), "input");
  assert.equal(elements.get("travelSpeedOut").textContent, "0.73 units/sec");
  await dispatchNode(playbackButtons.find(({ dataset }) => dataset.playback === "neighbors"), "click");
  assert.equal(elements.get("neighborReach").disabled, false);
  elements.get("neighborReach").value = "3";
  await dispatchNode(elements.get("neighborReach"), "input");
  elements.get("playheadSize").value = "0.81";
  await dispatchNode(elements.get("playheadSize"), "input");
  assert.equal(elements.get("neighborReachOut").textContent, "3 hops");
  assert.equal(elements.get("playheadSizeOut").textContent, "81%");

  for (const [id, value, expected] of [
    ["pitchSpan", "21", "21 semitones"],
    ["timbreMotion", "0.44", "44%"],
    ["stereoWidth", "0.61", "61%"],
    ["orientationDepth", "0.23", "23%"],
    ["colorAspectDepth", "0.34", "34%"],
    ["positionDepth", "0.45", "45%"],
    ["edgeArticulation", "0.56", "56%"],
  ]) {
    const configurationsBeforeInput = performanceConfigs.length;
    elements.get(id).value = value;
    await dispatchNode(elements.get(id), "input");
    assert.equal(elements.get(`${id}Out`).textContent, expected);
    assert.ok(
      performanceConfigs.length > configurationsBeforeInput,
      `${id} must reconfigure the contour performance engine`,
    );
    if (["orientationDepth", "colorAspectDepth", "positionDepth", "edgeArticulation"].includes(id)) {
      assert.equal(performanceConfigs.at(-1)[id], Number(value));
    }
  }
  const beforeContourControlsRender = renderSnapshots.length;
  runFrame();
  assert.ok(renderSnapshots.length > beforeContourControlsRender, "contour controls must redraw");
  assert.match(
    elements.get("stageReadout").textContent,
    /^NEIGHBORS · READY · \d+ PLAYHEADS? · \d+ POLYGONS$/,
  );
  assert.match(attributes.get("stage:aria-label"), /actual shape outline playheads/);

  const rotation = elements.get("rotation");
  rotation.value = "31";
  const configsBeforeRotation = performanceConfigs.length;
  await dispatchNode(rotation, "input");
  assert.equal(elements.get("rotationOut").textContent, "31°");
  assert.ok(performanceConfigs.length > configsBeforeRotation, "rotation must reconfigure audio");
  assert.equal(performanceConfigs.at(-1).visualRotation, 31);
  const beforeRangeRender = renderSnapshots.length;
  runFrame();
  assert.ok(renderSnapshots.length > beforeRangeRender, "range input must schedule a redraw");

  canvasRect = { left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 };
  globalThis.devicePixelRatio = 3;
  assert.ok(resizeObserver?.callback, "the app should observe canvas size changes");
  resizeObserver.callback();
  assert.equal(canvas.width, 1_600, "DPR should be capped at 2.5");
  assert.equal(canvas.height, 900);
  const beforeResizeRender = renderSnapshots.length;
  runFrame();
  assert.ok(renderSnapshots.length > beforeResizeRender, "a resize must redraw at the new resolution");

  elements.get("liveStatus").textContent = "";
  await dispatchNode(canvas, "pointerdown", {
    pointerId: 31,
    pointerType: "touch",
    isPrimary: true,
    clientX: 320,
    clientY: 180,
  });
  await dispatchNode(canvas, "pointerup", {
    pointerId: 31,
    pointerType: "touch",
    isPrimary: true,
    clientX: 320,
    clientY: 180,
  });
  assert.match(
    elements.get("liveStatus").textContent,
    /selected actual shape outline .+ with \d+ borders?/i,
    "a tap inside a rendered shape must select that exact contour",
  );
  runFrame();

  elements.get("liveStatus").textContent = "";
  const beforePan = renderSnapshots.at(-1).hash;
  await dispatchNode(canvas, "pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: 120,
    clientY: 120,
  });
  await dispatchNode(canvas, "pointermove", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: 168,
    clientY: 146,
  });
  await dispatchNode(canvas, "pointerup", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: 168,
    clientY: 146,
  });
  runFrame();
  assert.notEqual(renderSnapshots.at(-1).hash, beforePan, "one-pointer drag must pan the field");
  assert.equal(capturedPointers.has(1), false);
  assert.doesNotMatch(
    elements.get("liveStatus").textContent,
    /selected actual shape outline/i,
    "a drag must never be misread as a contour tap",
  );
  assert.equal(oscillators.length, 0, "dragging a shape must not excite it");

  elements.get("liveStatus").textContent = "";
  const beforePinch = renderSnapshots.at(-1).hash;
  await dispatchNode(canvas, "pointerdown", {
    pointerId: 11,
    pointerType: "touch",
    isPrimary: true,
    clientX: 170,
    clientY: 150,
  });
  await dispatchNode(canvas, "pointerdown", {
    pointerId: 12,
    pointerType: "touch",
    isPrimary: false,
    clientX: 270,
    clientY: 150,
  });
  await dispatchNode(canvas, "pointermove", {
    pointerId: 12,
    pointerType: "touch",
    isPrimary: false,
    clientX: 330,
    clientY: 150,
  });
  await dispatchNode(canvas, "pointerup", {
    pointerId: 12,
    pointerType: "touch",
    isPrimary: false,
    clientX: 330,
    clientY: 150,
  });
  await dispatchNode(canvas, "pointerup", {
    pointerId: 11,
    pointerType: "touch",
    isPrimary: true,
    clientX: 170,
    clientY: 150,
  });
  runFrame();
  assert.notEqual(renderSnapshots.at(-1).hash, beforePinch, "two pointers must pinch-zoom the field");
  assert.doesNotMatch(
    elements.get("liveStatus").textContent,
    /selected actual shape outline/i,
    "a pinch must never select or excite a contour",
  );
  assert.equal(oscillators.length, 0, "pinching the field must remain silent");

  const plusEvent = await dispatchGlobal("keydown", {
    target: canvas,
    key: "+",
    code: "Equal",
  });
  assert.equal(plusEvent.defaultPrevented, true);
  const beforePlusRender = renderSnapshots.length;
  runFrame();
  assert.ok(renderSnapshots.length > beforePlusRender, "+ should redraw at a larger zoom");

  const minusEvent = await dispatchGlobal("keydown", {
    target: canvas,
    key: "-",
    code: "Minus",
  });
  assert.equal(minusEvent.defaultPrevented, true);
  runFrame();

  const homeEvent = await dispatchGlobal("keydown", {
    target: canvas,
    key: "Home",
    code: "Home",
  });
  assert.equal(homeEvent.defaultPrevented, true);
  runFrame();
  assert.match(elements.get("liveStatus").textContent, /view reset/i);

  preset.value = "night-flight";
  await dispatchNode(preset, "change");
  await dispatchNode(playbackButtons.find(({ dataset }) => dataset.playback === "pattern"), "click");
  await dispatchNode(elements.get("resetButton"), "click");
  runFrame();
  assert.equal(preset.value, "counterform-current");
  assert.equal(elements.get("rotation").value, "0");
  assert.equal(elements.get("travelSpeed").value, "0.32");
  assert.equal(elements.get("neighborReach").value, "2");
  assert.equal(elements.get("playheadSize").value, "0.65");
  assert.equal(elements.get("pitchSpan").value, "14");
  assert.equal(elements.get("timbreMotion").value, "0.72");
  assert.equal(elements.get("stereoWidth").value, "0.82");
  assert.equal(elements.get("density").value, "0.54");
  assert.equal(elements.get("deformation").value, "0.72");
  assert.equal(elements.get("detail").value, "0.78");
  assert.equal(elements.get("contrast").value, "0.76");
  assert.equal(elements.get("orientationDepth").value, "0.68");
  assert.equal(elements.get("colorAspectDepth").value, "0.76");
  assert.equal(elements.get("positionDepth").value, "0.64");
  assert.equal(elements.get("edgeArticulation").value, "0.72");
  assert.equal(elements.get("orientationDepthOut").textContent, "68%");
  assert.equal(elements.get("colorAspectDepthOut").textContent, "76%");
  assert.equal(elements.get("positionDepthOut").textContent, "64%");
  assert.equal(elements.get("edgeArticulationOut").textContent, "72%");
  assert.equal(elements.get("deformation").disabled, false);
  assert.match(elements.get("deformationNote").textContent, /curves the shared edges/i);
  assert.equal(attributes.get("playback-shape:aria-pressed"), "true");
  assert.equal(attributes.get("playback-neighbors:aria-pressed"), "false");
  assert.equal(attributes.get("playback-pattern:aria-pressed"), "false");
  assert.equal(elements.get("playbackSummary").textContent, "ready · 1 actual outline");
  assert.match(elements.get("liveStatus").textContent, /reset to Counterform current/i);

  await dispatchNode(elements.get("audioButton"), "click");
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(audioContexts.length, 1);
  assert.equal(oscillators.length, 0, "enabling audio while paused must create no sounding oscillators");

  await dispatchNode(elements.get("playButton"), "click");
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(intervalTimers.size, 1, "playing audio should start one look-ahead scheduler");
  assert.equal([...intervalTimers.values()][0].delay, 25);
  assert.ok(
    oscillators.length >= 1 && oscillators.length <= 32,
    "Play should schedule finite border transients for active real contours",
  );
  const firstTransientBatch = [...oscillators];
  assert.ok(firstTransientBatch.every(({ startTimes, stopTimes }) => (
    startTimes.length === 1
    && Number.isFinite(startTimes[0])
    && stopTimes.length === 1
    && stopTimes[0] > startTimes[0]
  )));
  assert.ok(audioParamEvents.some(({ method }) => method === "exponential"));

  const playheadFrame = renderSnapshots.at(-1).hash;
  runFrame(50);
  assert.notEqual(
    renderSnapshots.at(-1).hash,
    playheadFrame,
    "while playing, the marker must advance directly along contourPointAtDistance",
  );
  assert.match(elements.get("stageReadout").textContent, /^SHAPE · EDGE \d+\/\d+ · 1 PLAYHEAD · \d+ TILES$/);

  const oscillatorsBeforeClockAdvance = oscillators.length;
  audioContexts[0].currentTime = 2;
  runAudioTimers();
  assert.ok(
    oscillators.length > oscillatorsBeforeClockAdvance,
    "advancing the AudioContext clock should schedule the next measured contour border",
  );
  const oscillatorsBeforeSpeedChange = oscillators.length;
  elements.get("travelSpeed").value = "1.2";
  await dispatchNode(elements.get("travelSpeed"), "input");
  assert.equal(intervalTimers.size, 1, "speed changes must retain one contour look-ahead clock");
  audioContexts[0].currentTime = 3;
  runAudioTimers();
  assert.ok(
    oscillators.length > oscillatorsBeforeSpeedChange,
    "the resynchronized scheduler must use geometric travel speed for later borders",
  );
  runFrame();

  const beforePauseRender = renderSnapshots.length;
  await dispatchNode(elements.get("playButton"), "click");
  runFrame();
  assert.ok(renderSnapshots.length > beforePauseRender, "pause must clear the moving marker immediately");
  assert.match(elements.get("stageReadout").textContent, /^SHAPE · READY · 1 PLAYHEAD · \d+ TILES$/);
  assert.equal(intervalTimers.size, 0, "pause must stop contour event scheduling");
  await dispatchNode(elements.get("playButton"), "click");
  assert.equal(intervalTimers.size, 1, "resuming must restart contour event scheduling");

  const escapeEvent = await dispatchGlobal("keydown", {
    target: preset,
    key: "Escape",
    code: "Escape",
  });
  assert.equal(escapeEvent.target, preset, "Escape should be exercised from a form control");
  assert.match(elements.get("liveStatus").textContent, /audio off/i);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(attributes.get("audioButton:aria-pressed"), "false");
  assert.ok(audioContexts[0].suspendCalls > 0);
  assert.equal(intervalTimers.size, 0, "switching audio off must clear the look-ahead scheduler");
  assert.ok(clearedTimers.length > 0);

  await dispatchNode(elements.get("audioButton"), "click");
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(intervalTimers.size, 1, "restoring audio during playback should restart scheduling");

  const queuedBeforeHide = [...queuedFrames.keys()];
  assert.ok(queuedBeforeHide.length > 0);
  await dispatchGlobal("pagehide", { persisted: false });
  assert.ok(cancelledFrames.some((frameId) => queuedBeforeHide.includes(frameId)));
  assert.equal(intervalTimers.size, 0, "pagehide must clear the audio scheduler");
  assert.ok(oscillators.every(({ stopped }) => stopped), "pagehide should stop every oscillator");
  assert.equal(audioContexts[0].closeCalls, 1, "pagehide should close the AudioContext");
});

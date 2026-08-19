import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("solid drum app starts, renders sixteen voices, and plays plane intersections", async () => {
  const html = await readFile(new URL("../solid-drums.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map();
  const listeners = new Map();
  const attributes = new Map();

  function element(id) {
    const classes = new Set();
    const nestedSpan = { textContent: "" };
    const node = {
      id,
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      dataset: {},
      style: {
        setProperty() {},
      },
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
      },
      addEventListener(type, listener) {
        listeners.set(`${id}:${type}`, listener);
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      querySelector(selector) {
        if (selector === "span") return nestedSpan;
        return null;
      },
      querySelectorAll(selector) {
        if (id === "playheadMotion" && selector === "button[data-value]") {
          return [elements.get("loopMotion"), elements.get("pingPongMotion")];
        }
        return [];
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 600 };
      },
      setPointerCapture() {},
      focus() {},
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
  const canvas = elements.get("stage");
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
  canvas.getContext = () => drawingContext;
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  });
  elements.get("stageWrap").getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 900,
    height: 600,
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

  function audioParam(value = 0) {
    return {
      value,
      setTargetAtTime(next) { this.value = next; },
      setValueAtTime(next) { this.value = next; },
      exponentialRampToValueAtTime(next) { this.value = next; },
      linearRampToValueAtTime(next) { this.value = next; },
      cancelScheduledValues() {},
    };
  }

  function audioNode(properties = {}) {
    return {
      ...properties,
      connect(destination) { return destination; },
      disconnect() {},
    };
  }

  const oscillators = [];
  let audioContextCount = 0;
  globalThis.AudioContext = class {
    constructor() {
      audioContextCount += 1;
      this.currentTime = 0;
      this.sampleRate = 1_000;
      this.state = "running";
      this.destination = audioNode();
    }
    createAnalyser() {
      return audioNode({ fftSize: 0 });
    }
    createBiquadFilter() {
      return audioNode({
        type: "lowpass",
        frequency: audioParam(0),
        Q: audioParam(0),
      });
    }
    createBuffer(_channels, frameCount) {
      const samples = new Float32Array(frameCount);
      return { getChannelData() { return samples; } };
    }
    createBufferSource() {
      return audioNode({
        buffer: null,
        start() {},
        stop() {},
      });
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
    createGain() {
      return audioNode({ gain: audioParam(0) });
    }
    createOscillator() {
      const oscillator = audioNode({
        type: "sine",
        frequency: audioParam(220),
        start() {},
        stop() {},
      });
      oscillators.push(oscillator);
      return oscillator;
    }
    async resume() {
      this.state = "running";
    }
    async close() {
      this.state = "closed";
    }
  };

  function flushAnimationFrames(now = performance.now() + 20) {
    const callbacks = rafQueue.splice(0);
    for (const callback of callbacks) callback(now);
  }

  await import(`../solid-drums-app.js?smoke=${Date.now()}`);
  assert.ok(rafQueue.length > 0, "startup should schedule an initial render");
  flushAnimationFrames();

  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  assert.match(
    elements.get("stageReadout").textContent,
    /^CUBE · SURFACE READER · 2 SEGMENTS\/SIDE · \d+ CONTACT/,
  );
  assert.equal(elements.get("formSummary").textContent, "cube");
  assert.equal(
    elements.get("mappingSummary").textContent,
    "surface → edge × axis · 2/side",
  );
  assert.match(elements.get("solidMappingSourceText").textContent, /Edge number modulo 4/);
  assert.equal(elements.get("subdivisions").value, "2");
  assert.equal(elements.get("subdivisionsOut").textContent, "2");
  assert.match(
    elements.get("triggerSourceDescription").textContent,
    /2 equal segments on a projected solid side \(edge\)/,
  );
  assert.equal(
    (elements.get("mappingMode").innerHTML.match(/<option /g) ?? []).length,
    3,
  );
  assert.equal(
    (elements.get("drumMap").innerHTML.match(/class="solid-drum-cell"/g) ?? []).length,
    16,
  );
  assert.equal(attributes.get("selectSolid:aria-pressed"), "true");
  assert.equal(attributes.get("selectSurface:aria-pressed"), "false");
  for (const id of [
    "playheadMotion",
    "traversalDirection",
    "loopMotion",
    "pingPongMotion",
  ]) {
    assert.ok(elements.has(id), `the Shape-style transport should expose #${id}`);
  }
  assert.equal(elements.has("directionButton"), false);
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "→");
  assert.equal(elements.get("traversalDirectionText").textContent, "FWD");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Surface direction: forward");
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");

  const initialPosition = Number(elements.get("position").value);
  listeners.get("traversalDirection:click")();
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "←");
  assert.equal(elements.get("traversalDirectionText").textContent, "REV");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Surface direction: reverse");
  assert.equal(Number(elements.get("position").value), initialPosition);
  listeners.get("traversalDirection:click")();

  listeners.get("pingPongMotion:click")();
  elements.get("position").value = "1";
  listeners.get("position:input")();
  flushAnimationFrames();
  listeners.get("loopMotion:click")();
  flushAnimationFrames();
  assert.equal(
    Number(elements.get("position").value),
    1,
    "switching to Loop at the far endpoint must preserve the visible surface position",
  );
  listeners.get("pingPongMotion:click")();

  elements.get("position").value = "0.997";
  listeners.get("position:input")();
  const positionBeforePingPong = Number(elements.get("position").value);
  listeners.get("pingPongMotion:click")();
  assert.equal(Number(elements.get("position").value), positionBeforePingPong);
  assert.equal(attributes.get("loopMotion:aria-pressed"), "false");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "true");
  listeners.get("playButton:click")();
  flushAnimationFrames(performance.now() + 100);
  const reflectedPosition = Number(elements.get("position").value);
  assert.ok(reflectedPosition < positionBeforePingPong, "Ping-pong should reverse at the surface endpoint");
  assert.ok(reflectedPosition > 0.9, "Ping-pong should reflect instead of wrapping to the opposite endpoint");
  listeners.get("playButton:click")();
  flushAnimationFrames();

  const positionBeforeModeRoundTrip = Number(elements.get("position").value);
  listeners.get("loopMotion:click")();
  assert.equal(Number(elements.get("position").value), positionBeforeModeRoundTrip);
  listeners.get("pingPongMotion:click")();
  assert.equal(Number(elements.get("position").value), positionBeforeModeRoundTrip);
  elements.get("position").value = "0.72";
  listeners.get("position:input")();
  listeners.get("playButton:click")();
  flushAnimationFrames(performance.now() + 100);
  assert.ok(
    Number(elements.get("position").value) < 0.72,
    "scrubbing a returning ping-pong leg should preserve that leg",
  );
  listeners.get("playButton:click")();
  flushAnimationFrames();

  listeners.get("resetSolidDrums:click")();
  flushAnimationFrames();
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  assert.equal(elements.get("traversalDirectionText").textContent, "FWD");
  assert.equal(attributes.get("traversalDirection:aria-label"), "Surface direction: forward");

  for (const id of ["rotationXPlay", "rotationYPlay", "rotationZPlay", "planeYawPlay", "planePitchPlay"]) {
    listeners.get(`${id}:click`)();
    assert.equal(attributes.get(`${id}:aria-pressed`), "true");
    assert.notEqual(attributes.get("audioButton:aria-pressed"), "true");
    assert.equal(audioContextCount, 0, `${id} must not create an AudioContext`);
    listeners.get(`${id}:click`)();
  }

  listeners.get("playButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  flushAnimationFrames(performance.now() + 240);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.notEqual(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(audioContextCount, 0, "Play must not create an AudioContext");
  assert.equal(oscillators.length, 0, "silent motion must not strike drums");
  const positionBeforeAudioTap = Number(elements.get("position").value);
  await listeners.get("audioButton:click")();
  assert.equal(attributes.get("audioButton:aria-pressed"), "true");
  assert.equal(attributes.get("playButton:aria-pressed"), "true");
  assert.equal(audioContextCount, 1, "only the explicit Audio action should create audio");
  assert.equal(Number(elements.get("position").value), positionBeforeAudioTap);
  assert.equal(oscillators.length, 0, "arming Audio must not strike existing contacts");
  let motionNow = performance.now() + 400;
  for (let index = 0; index < 160 && oscillators.length === 0; index += 1) {
    flushAnimationFrames(motionNow);
    motionNow += 160;
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    oscillators.length > 0,
    `the next surface crossing should trigger FM drums (position ${elements.get("position").value})`,
  );
  assert.match(
    elements.get("mappingReadout").textContent,
    /^SURFACE · EDGE \d+ · SEGMENT [12]\/2 · /,
  );

  elements.get("mappingMode").value = "position-grid";
  listeners.get("mappingMode:change")();
  assert.equal(
    elements.get("mappingSummary").textContent,
    "surface → 3d position · 2/side",
  );
  assert.match(elements.get("solidMappingSourceText").textContent, /3D height \(Y\)/);

  elements.get("subdivisions").value = "4";
  listeners.get("subdivisions:input")();
  flushAnimationFrames(performance.now() + 320);
  assert.equal(elements.get("subdivisionsOut").textContent, "4");
  assert.equal(
    elements.get("mappingSummary").textContent,
    "surface → 3d position · 4/side",
  );
  assert.match(
    elements.get("triggerSourceDescription").textContent,
    /4 equal segments on a projected solid side \(edge\)/,
  );
  assert.match(elements.get("stageReadout").textContent, /4 SEGMENTS\/SIDE/);

  elements.get("solidType").value = "octahedron";
  listeners.get("solidType:change")({ currentTarget: elements.get("solidType") });
  flushAnimationFrames(performance.now() + 400);
  assert.equal(elements.get("formSummary").textContent, "octahedron");
  assert.match(
    elements.get("stageReadout").textContent,
    /^OCTAHEDRON · SURFACE READER · 4 SEGMENTS\/SIDE · \d+ CONTACT/,
  );

  listeners.get("rotationYPlay:click")();
  assert.equal(attributes.get("rotationYPlay:aria-pressed"), "true");
  assert.equal(elements.get("rotationSummary").textContent, "Y");

  listeners.get("resetSolidDrums:click")();
  flushAnimationFrames();
  assert.equal(attributes.get("playButton:aria-pressed"), "false");
  assert.equal(elements.get("rotationSummary").textContent, "paused");
  assert.equal(
    elements.get("mappingSummary").textContent,
    "surface → edge × axis · 2/side",
  );
  assert.equal(elements.get("formSummary").textContent, "cube");
  assert.equal(elements.get("subdivisions").value, "2");
  assert.equal(elements.get("subdivisionsOut").textContent, "2");
  assert.equal(attributes.get("loopMotion:aria-pressed"), "true");
  assert.equal(attributes.get("pingPongMotion:aria-pressed"), "false");
  assert.equal(elements.get("traversalDirectionGlyph").textContent, "→");
  assert.equal(elements.get("traversalDirectionText").textContent, "FWD");
  assert.match(
    elements.get("triggerSourceDescription").textContent,
    /2 equal segments on a projected solid side \(edge\)/,
  );
});

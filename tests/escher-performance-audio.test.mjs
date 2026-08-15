import assert from "node:assert/strict";
import test from "node:test";

import {
  ESCHER_PERFORMANCE_AUDIO_LIMITS,
  EscherPerformanceAudio,
} from "../src/escher-performance-audio.js";

const near = (actual, expected, epsilon = 1e-7) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
};

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }

  record(method, values) {
    this.value = values[0];
    this.calls.push([method, ...values]);
  }

  setValueAtTime(...values) { this.record("setValueAtTime", values); }
  setTargetAtTime(...values) { this.record("setTargetAtTime", values); }
  linearRampToValueAtTime(...values) { this.record("linearRampToValueAtTime", values); }
  exponentialRampToValueAtTime(...values) {
    this.record("exponentialRampToValueAtTime", values);
  }
  cancelScheduledValues(...values) { this.calls.push(["cancelScheduledValues", ...values]); }
}

class FakeNode {
  constructor() {
    this.connections = [];
    this.disconnected = false;
  }

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  constructor() {
    super();
    this.gain = new FakeParam(1);
  }
}

class FakeFilter extends FakeNode {
  constructor() {
    super();
    this.type = "lowpass";
    this.frequency = new FakeParam(350);
    this.Q = new FakeParam(1);
  }
}

class FakePanner extends FakeNode {
  constructor() {
    super();
    this.pan = new FakeParam(0);
  }
}

class FakeCompressor extends FakeNode {
  constructor() {
    super();
    this.threshold = new FakeParam(-24);
    this.knee = new FakeParam(16);
    this.ratio = new FakeParam(6);
    this.attack = new FakeParam(0.004);
    this.release = new FakeParam(0.18);
  }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super();
    this.type = "sine";
    this.frequency = new FakeParam(440);
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }

  start(time = 0) { this.starts.push(time); }
  stop(time = 0) { this.stops.push(time); }
}

class FakeBufferSource extends FakeNode {
  constructor() {
    super();
    this.buffer = null;
    this.starts = [];
    this.onended = null;
  }

  start(time = 0) {
    this.starts.push(time);
    this.onended?.();
  }
}

class FakeAudioContext {
  constructor(runtime) {
    this.runtime = runtime;
    this.currentTime = 0;
    this.sampleRate = 48_000;
    this.state = "suspended";
    this.destination = new FakeNode();
    this.oscillators = [];
    this.gains = [];
    this.filters = [];
    this.panners = [];
    this.bufferSources = [];
    this.resumeCount = 0;
    this.suspendCount = 0;
    this.closeCount = 0;
  }

  createGain() {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createOscillator() {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createBiquadFilter() {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  createStereoPanner() {
    const node = new FakePanner();
    this.panners.push(node);
    return node;
  }

  createDynamicsCompressor() { return new FakeCompressor(); }
  createBuffer(channels, frames, sampleRate) { return { channels, frames, sampleRate }; }

  createBufferSource() {
    const node = new FakeBufferSource();
    this.bufferSources.push(node);
    return node;
  }

  async resume() {
    this.resumeCount += 1;
    this.state = "running";
  }

  async suspend() {
    this.suspendCount += 1;
    this.state = "suspended";
  }

  async close() {
    this.closeCount += 1;
    this.state = "closed";
  }
}

function fakeRuntime() {
  const timers = new Map();
  const contexts = [];
  let nextTimer = 1;
  const runtime = {
    timers,
    contexts,
    AudioContext: class extends FakeAudioContext {
      constructor() {
        super(runtime);
        contexts.push(this);
      }
    },
    setInterval(callback, milliseconds) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, { callback, milliseconds });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    advance(seconds, quantum = 0.025) {
      let remaining = seconds;
      while (remaining > 1e-10) {
        const amount = Math.min(quantum, remaining);
        for (const context of contexts) {
          if (context.state === "running") context.currentTime += amount;
        }
        for (const { callback } of [...timers.values()]) callback();
        remaining -= amount;
      }
    },
  };
  return runtime;
}

function frozenContour(id, coordinates, {
  color = "#d28b42",
  aspect = 0,
  model = "euclidean",
  role = "tile",
  edgeColors = [],
  curvedFirstEdge = false,
} = {}) {
  const points = coordinates.map(([x, y]) => Object.freeze({ x, y }));
  let cumulative = 0;
  const edges = points.map((start, edgeIndex) => {
    const end = points[(edgeIndex + 1) % points.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const samples = curvedFirstEdge && edgeIndex === 0
      ? [
        Object.freeze({ x: start.x, y: start.y }),
        Object.freeze({ x: (start.x + end.x) / 2, y: start.y - 0.2 }),
        Object.freeze({ x: end.x, y: end.y }),
      ]
      : [start, end];
    const edge = Object.freeze({
      id: `${id}:actual:${edgeIndex}`,
      points: Object.freeze(samples),
      length,
      startDistance: cumulative,
      endDistance: cumulative + length,
      color: edgeColors[edgeIndex] ?? color,
    });
    cumulative += length;
    return edge;
  });
  return Object.freeze({
    id,
    model,
    role,
    color,
    aspect,
    points: Object.freeze(points),
    edges: Object.freeze(edges),
    perimeter: cumulative,
  });
}

const square = frozenContour("small", [
  [0, 0], [1, 0], [1, 1], [0, 1],
], { color: "#e34b4b", curvedFirstEdge: true });
const rectangle = frozenContour("large", [
  [3, 0], [5, 0], [5, 1], [3, 1],
], { color: "#315fd0" });

const config = (overrides = {}) => ({
  presetId: "counterform-current",
  contours: Object.freeze([square, rectangle]),
  selectedContourIds: Object.freeze([]),
  mode: "pattern",
  travelSpeed: 2,
  direction: 1,
  baseFrequency: 82.5,
  pitchSpan: 24,
  tone: 0.58,
  timbreMotion: 0.72,
  stereoWidth: 0.8,
  orientationDepth: 0.68,
  colorAspectDepth: 0.76,
  positionDepth: 0.64,
  edgeArticulation: 0.72,
  visualRotation: 0,
  contrast: 0.78,
  level: 0.5,
  ...overrides,
});

function transformCoordinates(coordinates, {
  angle = 0,
  x = 0,
  y = 0,
} = {}) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return coordinates.map(([sourceX, sourceY]) => [
    sourceX * cosine - sourceY * sine + x,
    sourceX * sine + sourceY * cosine + y,
  ]);
}

async function firstVoice(contour, overrides = {}) {
  const runtime = fakeRuntime();
  const heard = [];
  const engine = new EscherPerformanceAudio(runtime, {
    onEvent(event) { heard.push(event); },
  });
  await engine.enable(config({
    contours: Object.freeze([contour]),
    mode: "shape",
    fieldBounds: Object.freeze({ minimumX: -8, maximumX: 8, minimumY: -8, maximumY: 8 }),
    ...overrides,
  }));
  engine.setPlaying(true, 0);
  runtime.advance(0.03);
  const event = heard[0];
  assert.ok(event, `expected an initial event for ${contour.id}`);
  engine.dispose();
  return event.voice;
}

test("paused audio creates no oscillators and every scheduled event names a real contour edge", async () => {
  const runtime = fakeRuntime();
  const heard = [];
  const engine = new EscherPerformanceAudio(runtime, {
    onEvent(event) { heard.push(event); },
  });
  await engine.enable(config());
  const [context] = runtime.contexts;

  assert.equal(context.oscillators.length, 0);
  assert.equal(runtime.timers.size, 0);
  engine.setPlaying(true, 0);
  assert.equal(runtime.timers.size, 1);
  assert.equal([...runtime.timers.values()][0].milliseconds, 25);
  assert.equal(context.oscillators.length, 4);
  assert.equal(
    context.oscillators.length,
    2 * ESCHER_PERFORMANCE_AUDIO_LIMITS.maximumOscillatorsPerVoice,
  );
  assert.ok(
    context.oscillators.every(({ frequency }) => (
      frequency.calls.some(([method]) => method === "exponentialRampToValueAtTime")
    )),
    "both finite oscillator layers receive a bounded pitch gesture",
  );
  assert.ok(context.filters.every(({ frequency }) => (
    frequency.calls.some(([method]) => method === "exponentialRampToValueAtTime")
  )));
  assert.ok(context.panners.every(({ pan }) => (
    pan.calls.some(([method]) => method === "linearRampToValueAtTime")
  )));
  runtime.advance(0.03);

  assert.equal(heard.length, 2);
  const contourById = new Map([square, rectangle].map((contour) => [contour.id, contour]));
  for (const event of heard) {
    const contour = contourById.get(event.contourId);
    assert.ok(contour, "event contourId must reference an active contour");
    assert.equal(contour.edges[event.edgeIndex].id, event.edgeId);
    assert.deepEqual(event.position, contour.edges[event.edgeIndex].points[0]);
    assert.ok(Object.isFrozen(event));
    assert.ok(Object.isFrozen(event.position));
    assert.ok(Object.isFrozen(event.voice));
    assert.ok(event.voice.family);
    assert.ok(event.voice.frequency > 0 && event.voice.filterFrequency > 0);
  }
  assert.ok(Object.isFrozen(square) && Object.isFrozen(square.edges));
  engine.dispose();
});

test("unequal measured perimeters produce unequal loop periods at one geometric speed", async () => {
  const runtime = fakeRuntime();
  const heard = [];
  const engine = new EscherPerformanceAudio(runtime, {
    onEvent(event) { heard.push(event); },
  });
  const travelSpeed = 4;
  await engine.enable(config({ travelSpeed }));
  engine.setPlaying(true, 0);
  runtime.advance(3.2);

  const cycleStarts = (contourId) => heard.filter((event) => (
    event.contourId === contourId && event.edgeIndex === 0
  )).map(({ when }) => when);
  const smallStarts = cycleStarts(square.id);
  const largeStarts = cycleStarts(rectangle.id);
  assert.ok(smallStarts.length >= 3 && largeStarts.length >= 3);
  near(smallStarts[1] - smallStarts[0], square.perimeter / travelSpeed);
  near(largeStarts[1] - largeStarts[0], rectangle.perimeter / travelSpeed);
  assert.ok(smallStarts[1] - smallStarts[0] < largeStarts[1] - largeStarts[0]);
  assert.equal(heard.find(({ contourId }) => contourId === square.id).period, 1);
  assert.equal(heard.find(({ contourId }) => contourId === rectangle.id).period, 1.5);
  engine.dispose();
});

test("successive boundary times come from cumulative edge arc length", async () => {
  const irregular = frozenContour("irregular", [
    [-2, 0], [0, 0], [0, 1], [-1, 2], [-2, 1],
  ], { edgeColors: ["#f00", "#0f0", "#00f", "#ff0", "#0ff"] });
  const runtime = fakeRuntime();
  const heard = [];
  const speed = 2;
  const engine = new EscherPerformanceAudio(runtime, {
    onEvent(event) { heard.push(event); },
  });
  await engine.enable(config({ contours: Object.freeze([irregular]), travelSpeed: speed }));
  engine.setPlaying(true, 0);
  runtime.advance(irregular.perimeter / speed + 0.2);

  const firstCycle = heard.filter(({ cycle }) => cycle === 0);
  assert.equal(firstCycle.length, irregular.edges.length);
  for (let index = 0; index < firstCycle.length - 1; index += 1) {
    near(
      firstCycle[index + 1].when - firstCycle[index].when,
      irregular.edges[index].length / speed,
    );
    assert.equal(firstCycle[index].distance, irregular.edges[index].startDistance);
  }
  engine.dispose();
});

test("perimeter, turn, curvature, color, and position vary the transient mapping", async () => {
  const irregular = frozenContour("mapping-irregular", [
    [-3, -1], [-1.1, -0.8], [-0.4, 0.7], [-2.2, 1.8],
  ], { edgeColors: ["#f00", "#0f0", "#00f", "#ff0"] });
  const runtime = fakeRuntime();
  const heard = [];
  const engine = new EscherPerformanceAudio(runtime, {
    onEvent(event) { heard.push(event); },
  });
  await engine.enable(config({
    contours: Object.freeze([square, rectangle, irregular]),
    travelSpeed: 4,
  }));
  engine.setPlaying(true, 0);
  runtime.advance(0.03);
  const [context] = runtime.contexts;
  const smallVoice = heard.find(({ contourId }) => contourId === square.id).voice;
  const largeVoice = heard.find(({ contourId }) => contourId === rectangle.id).voice;
  assert.notEqual(smallVoice.frequency, largeVoice.frequency);
  assert.notEqual(smallVoice.family, largeVoice.family);
  runtime.advance(0.8);

  const primaryOscillators = context.oscillators.filter((__, index) => index % 2 === 0);
  const frequencies = primaryOscillators.map(({ frequency }) => frequency.value);
  const durations = primaryOscillators.map((oscillator) => oscillator.stops[0] - oscillator.starts[0]);
  const pans = context.panners.map(({ pan }) => pan.value);
  const filters = context.filters.map(({ frequency }) => frequency.value);
  const waveforms = primaryOscillators.map(({ type }) => type);
  assert.ok(new Set(frequencies.map((value) => value.toFixed(5))).size >= 3);
  assert.ok(new Set(durations.map((value) => value.toFixed(5))).size >= 2);
  assert.ok(new Set(pans.map((value) => value.toFixed(5))).size >= 3);
  assert.ok(new Set(filters.map((value) => value.toFixed(5))).size >= 3);
  assert.ok(waveforms.every((value) => ["sine", "triangle", "sawtooth", "square"].includes(value)));

  engine.dispose();
});

test("congruent tiles at different angles, locations, and colors get unmistakably different voices", async () => {
  const coordinates = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const first = frozenContour("first-congruent", coordinates, {
    color: "#f04a35",
    aspect: 0,
  });
  const second = frozenContour(
    "second-congruent",
    transformCoordinates(coordinates, { angle: Math.PI / 2, x: 4.5, y: -2.5 }),
    { color: "#315fd0", aspect: 0 },
  );
  const runtime = fakeRuntime();
  const heard = [];
  const engine = new EscherPerformanceAudio(runtime, {
    onEvent(event) { heard.push(event); },
  });
  await engine.enable(config({
    contours: Object.freeze([first, second]),
    fieldBounds: Object.freeze({ minimumX: -3, maximumX: 7, minimumY: -5, maximumY: 3 }),
  }));
  engine.setPlaying(true, 0);
  runtime.advance(0.03);

  const firstVoiceDescriptor = heard.find(({ contourId }) => contourId === first.id).voice;
  const secondVoiceDescriptor = heard.find(({ contourId }) => contourId === second.id).voice;
  assert.notEqual(firstVoiceDescriptor.family, secondVoiceDescriptor.family, "color must select a distinct voice family");
  assert.notEqual(firstVoiceDescriptor.waveform, secondVoiceDescriptor.waveform);
  assert.ok(
    Math.abs(firstVoiceDescriptor.frequency - secondVoiceDescriptor.frequency) > 3,
    "angle, vertical position, and color must produce an audible pitch difference",
  );
  assert.ok(
    Math.abs(firstVoiceDescriptor.filterFrequency - secondVoiceDescriptor.filterFrequency) > 30,
    "timbre cutoff must differ materially",
  );
  assert.ok(
    Math.abs(firstVoiceDescriptor.pan - secondVoiceDescriptor.pan) > 0.35,
    "world position must spread congruent tiles across the stereo image",
  );
  assert.notEqual(firstVoiceDescriptor.attack, secondVoiceDescriptor.attack);
  assert.notEqual(firstVoiceDescriptor.duration, secondVoiceDescriptor.duration);
  engine.dispose();
});

test("global field bounds preserve translation when Shape mode selects only one contour", async () => {
  const coordinates = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const leftLow = frozenContour(
    "left-low",
    transformCoordinates(coordinates, { x: -4, y: 2.5 }),
    { color: "#db7b32", aspect: 1 },
  );
  const rightHigh = frozenContour(
    "right-high",
    transformCoordinates(coordinates, { x: 4, y: -2.5 }),
    { color: "#db7b32", aspect: 1 },
  );
  const fieldBounds = Object.freeze({ minimumX: -6, maximumX: 6, minimumY: -5, maximumY: 5 });
  const leftVoice = await firstVoice(leftLow, { fieldBounds });
  const rightVoice = await firstVoice(rightHigh, { fieldBounds });

  assert.ok(leftVoice.pan < -0.35);
  assert.ok(rightVoice.pan > 0.35);
  assert.ok(rightVoice.frequency > leftVoice.frequency, "higher screen/world placement raises register");
  assert.notEqual(leftVoice.yUnit, rightVoice.yUnit);
});

test("rotation alone changes pitch gesture and timbre for a congruent tile", async () => {
  const coordinates = [[-1.2, -0.8], [1.2, -0.8], [1.2, 0.8], [-1.2, 0.8]];
  const horizontal = frozenContour("horizontal", coordinates, { color: "#59a95a", aspect: 2 });
  const vertical = frozenContour(
    "vertical",
    transformCoordinates(coordinates, { angle: Math.PI / 2 }),
    { color: "#59a95a", aspect: 2 },
  );
  const horizontalVoice = await firstVoice(horizontal);
  const verticalVoice = await firstVoice(vertical);

  assert.equal(horizontalVoice.family, verticalVoice.family);
  assert.notEqual(horizontalVoice.orientation, verticalVoice.orientation);
  assert.ok(Math.abs(horizontalVoice.frequency - verticalVoice.frequency) > 2);
  assert.notEqual(horizontalVoice.frequencyEnd / horizontalVoice.frequency, verticalVoice.frequencyEnd / verticalVoice.frequency);
  assert.notEqual(horizontalVoice.filterFrequencyEnd, verticalVoice.filterFrequencyEnd);
});

test("color/aspect and reflection chirality change voice family and envelope direction", async () => {
  const clockwisePoints = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const reflectedPoints = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
  const warm = frozenContour("warm", clockwisePoints, { color: "#f04432", aspect: 0 });
  const cool = frozenContour("cool", clockwisePoints, { color: "#315fd0", aspect: 3 });
  const reflected = frozenContour("reflected", reflectedPoints, { color: "#f04432", aspect: 0 });
  const warmVoice = await firstVoice(warm);
  const coolVoice = await firstVoice(cool);
  const reflectedVoice = await firstVoice(reflected);

  assert.notEqual(warmVoice.family, coolVoice.family);
  assert.notEqual(warmVoice.waveform, coolVoice.waveform);
  assert.notEqual(warmVoice.filterFrequency, coolVoice.filterFrequency);
  assert.notEqual(warmVoice.frequency, coolVoice.frequency);
  assert.equal(warmVoice.chirality, 1);
  assert.equal(reflectedVoice.chirality, -1);
  assert.ok(warmVoice.attack < reflectedVoice.attack, "reflections use an opposing envelope gesture");
  assert.ok(warmVoice.frequencyEnd > warmVoice.frequency);
  assert.ok(reflectedVoice.frequencyEnd < reflectedVoice.frequency);
});

test("playback mode and each depth control materially reshape finite boundary transients", async () => {
  const contour = frozenContour("mode-voice", [
    [-1.4, -0.7], [1.4, -0.7], [0.9, 0.9], [-0.8, 1.2],
  ], { color: "#b747cc", aspect: 2, curvedFirstEdge: true });
  const shapeVoice = await firstVoice(contour, { mode: "shape" });
  const neighborVoice = await firstVoice(contour, { mode: "neighbors" });
  const patternVoice = await firstVoice(contour, { mode: "pattern" });
  assert.notEqual(shapeVoice.frequency, neighborVoice.frequency);
  assert.ok(shapeVoice.duration > neighborVoice.duration);
  assert.ok(neighborVoice.duration > patternVoice.duration);

  const flatVoice = await firstVoice(contour, {
    orientationDepth: 0,
    colorAspectDepth: 0,
    positionDepth: 0,
    edgeArticulation: 0,
  });
  const expressiveVoice = await firstVoice(contour, {
    orientationDepth: 1,
    colorAspectDepth: 1,
    positionDepth: 1,
    edgeArticulation: 1,
  });
  assert.notEqual(flatVoice.frequency, expressiveVoice.frequency);
  assert.notEqual(flatVoice.filterFrequency, expressiveVoice.filterFrequency);
  assert.notEqual(flatVoice.duration, expressiveVoice.duration);
  assert.notEqual(flatVoice.pan, expressiveVoice.pan);
  assert.notEqual(flatVoice.frequencyEnd, expressiveVoice.frequencyEnd);
});

test("successive outline cycles evolve pitch and filter without adding a continuous drone", async () => {
  const contour = frozenContour("evolving", [
    [-1, -1], [1, -1], [1, 1], [-1, 1],
  ], { color: "#974bd1", aspect: 2 });
  const runtime = fakeRuntime();
  const heard = [];
  const engine = new EscherPerformanceAudio(runtime, {
    onEvent(event) { heard.push(event); },
  });
  await engine.enable(config({
    contours: Object.freeze([contour]),
    travelSpeed: 4,
    timbreMotion: 1,
  }));
  assert.equal(runtime.contexts[0].oscillators.length, 0, "enabling remains silent");
  engine.setPlaying(true, 0);
  runtime.advance(2.3);
  const loopStarts = heard.filter(({ edgeIndex }) => edgeIndex === 0);
  assert.ok(loopStarts.length >= 2);
  assert.notEqual(loopStarts[0].voice.frequency, loopStarts[1].voice.frequency);
  assert.notEqual(loopStarts[0].voice.filterFrequencyEnd, loopStarts[1].voice.filterFrequencyEnd);

  engine.setPlaying(false, 0);
  const oscillatorCount = runtime.contexts[0].oscillators.length;
  runtime.advance(1);
  assert.equal(runtime.contexts[0].oscillators.length, oscillatorCount, "pause schedules no sources");
  engine.dispose();
});

test("selection IDs and the playhead cap bound active geometry without mutating inputs", async () => {
  const contours = Object.freeze(Array.from({ length: 16 }, (_, index) => (
    frozenContour(`contour-${index}`, [
      [index * 2, 0], [index * 2 + 1, 0], [index * 2 + 1, 1], [index * 2, 1],
    ], { color: index })
  )));
  const runtime = fakeRuntime();
  const selectedEngine = new EscherPerformanceAudio(runtime);
  const sanitized = selectedEngine.configure(config({
    contours,
    mode: "neighbors",
    selectedContourIds: Object.freeze(["contour-2", "contour-7"]),
    orientationDepth: 2,
    colorAspectDepth: -1,
    positionDepth: 4,
    edgeArticulation: -4,
    visualRotation: 900,
    contrast: 3,
    fieldBounds: Object.freeze({ minimumX: -20, maximumX: 40, minimumY: -3, maximumY: 5 }),
  }));
  assert.equal(sanitized.mode, "neighbors");
  assert.deepEqual(selectedEngine.measuredContours.map(({ id }) => id), ["contour-2", "contour-7"]);
  assert.ok(Object.isFrozen(sanitized.contours));
  assert.ok(Object.isFrozen(sanitized.selectedContourIds));
  assert.equal(sanitized.orientationDepth, 1);
  assert.equal(sanitized.colorAspectDepth, 0);
  assert.equal(sanitized.positionDepth, 1);
  assert.equal(sanitized.edgeArticulation, 0);
  assert.equal(sanitized.visualRotation, 360);
  assert.equal(sanitized.contrast, 1);
  assert.ok(Object.isFrozen(sanitized.fieldBounds));

  selectedEngine.configure(config({ contours, selectedContourIds: Object.freeze([]) }));
  assert.equal(
    selectedEngine.measuredContours.length,
    ESCHER_PERFORMANCE_AUDIO_LIMITS.maximumPlayheads,
  );
  assert.equal(contours.length, 16);

  await selectedEngine.enable(config({ contours }));
  selectedEngine.setPlaying(true, 0);
  assert.ok(selectedEngine.activeVoices.length <= ESCHER_PERFORMANCE_AUDIO_LIMITS.maximumActiveVoices);
  assert.ok(
    selectedEngine.activeVoices.reduce((sum, voice) => sum + voice.oscillators.length, 0)
      <= ESCHER_PERFORMANCE_AUDIO_LIMITS.maximumLiveOscillators,
  );
  selectedEngine.dispose();
});

test("setPosition cancels queued voices and resyncs to the actual containing edge boundary", async () => {
  const runtime = fakeRuntime();
  const heard = [];
  const engine = new EscherPerformanceAudio(runtime, {
    onEvent(event) { heard.push(event); },
  });
  await engine.enable(config({ contours: Object.freeze([rectangle]), travelSpeed: 1 }));
  engine.setPlaying(true, 0);
  const oldVoice = runtime.contexts[0].oscillators[0];
  assert.ok(oldVoice);

  engine.setPosition(2);
  assert.ok(oldVoice.stops.length >= 2, "position resync should cancel the queued voice");
  runtime.advance(0.03);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].contourId, rectangle.id);
  assert.equal(heard[0].edgeIndex, 1);
  assert.deepEqual(heard[0].position, rectangle.edges[1].points[0]);
  engine.dispose();
});

test("pause, disable, and dispose stop all contour voices and timers safely", async () => {
  const runtime = fakeRuntime();
  const engine = new EscherPerformanceAudio(runtime);
  await engine.enable(config());
  engine.setPlaying(true, 0);
  const [context] = runtime.contexts;
  let voices = [...context.oscillators];
  assert.equal(runtime.timers.size, 1);

  engine.setPlaying(false, 0.5);
  assert.equal(runtime.timers.size, 0);
  assert.equal(engine.activeVoices.length, 0);
  assert.ok(voices.every(({ stops }) => stops.length >= 2));
  const countWhilePaused = context.oscillators.length;
  runtime.advance(1);
  assert.equal(context.oscillators.length, countWhilePaused);

  engine.setPlaying(true, 0);
  voices = [...context.oscillators];
  await engine.disable();
  assert.equal(runtime.timers.size, 0);
  assert.equal(engine.activeVoices.length, 0);
  assert.equal(context.state, "suspended");
  assert.ok(voices.every(({ stops }) => stops.length >= 1));

  await engine.enable(config());
  engine.setPlaying(true, 0);
  engine.dispose();
  engine.dispose();
  assert.equal(runtime.timers.size, 0);
  assert.equal(context.state, "closed");
  assert.equal(context.closeCount, 1);
});

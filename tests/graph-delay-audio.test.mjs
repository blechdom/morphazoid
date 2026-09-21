import assert from "node:assert/strict";
import test from "node:test";
import { generateGraph } from "../src/instruments/graph-delay/graph-delay.js";
import {
  GraphDelayAudio,
  graphAudibleTapGain,
  graphAudioTopologySignature,
  graphFirstAudibleTapSeconds,
  graphTerminalDelaySeconds,
  graphTurnSemitoneMatrix,
  sanitizeGraphDelayAudioSettings,
} from "../src/instruments/graph-delay/graph-delay-audio.js";

const closeTo = (actual, expected, tolerance = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }

  cancelAndHoldAtTime(time) {
    this.calls.push(["hold", time]);
  }

  cancelScheduledValues(time) {
    this.calls.push(["cancel", time]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.calls.push(["linear", value, time]);
  }

  setTargetAtTime(value, time, timeConstant) {
    this.value = value;
    this.calls.push(["target", value, time, timeConstant]);
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.calls.push(["set", value, time]);
  }
}

class FakeAudioNode {
  constructor(kind, properties = {}) {
    this.kind = kind;
    this.connections = [];
    this.disconnectCount = 0;
    Object.assign(this, properties);
  }

  connect(destination, output, input) {
    this.connections.push({ destination, output, input });
    return destination;
  }

  disconnect(destination) {
    this.disconnectCount += 1;
    if (destination === undefined) {
      this.connections.length = 0;
      return;
    }
    this.connections = this.connections.filter((connection) => (
      connection.destination !== destination
    ));
  }
}

function makeTrack() {
  return {
    stopCount: 0,
    stop() { this.stopCount += 1; },
  };
}

function makeRuntime({
  getUserMedia,
  worklet = "missing",
  analyserPeak = 0.25,
  resume,
  addModule,
} = {}) {
  const created = {
    contexts: [],
    nodes: [],
    gains: [],
    delays: [],
    workletModuleCalls: 0,
    workletConstructions: 0,
    mediaRequests: [],
    timers: [],
  };

  const node = (kind, properties = {}) => {
    const value = new FakeAudioNode(kind, properties);
    created.nodes.push(value);
    return value;
  };

  class FakeContext {
    constructor(options) {
      this.options = options;
      this.currentTime = 0.5;
      this.sampleRate = 48_000;
      this.state = "suspended";
      this.destination = node("destination");
      this.closeCount = 0;
      this.resumeCount = 0;
      this.audioWorklet = {
        addModule: async (...arguments_) => {
          created.workletModuleCalls += 1;
          if (addModule) return addModule(this, ...arguments_);
          if (worklet === "reject") throw new Error("worklet unavailable");
        },
      };
      created.contexts.push(this);
    }

    createGain() {
      const gain = node("gain", { gain: new FakeAudioParam(0) });
      created.gains.push(gain);
      return gain;
    }

    createDelay(maxDelayTime) {
      const delay = node("delay", {
        delayTime: new FakeAudioParam(0),
        maxDelayTime,
      });
      created.delays.push(delay);
      return delay;
    }

    createBiquadFilter() {
      return node("filter", {
        type: "",
        frequency: new FakeAudioParam(0),
        Q: new FakeAudioParam(0),
      });
    }

    createStereoPanner() {
      return node("panner", { pan: new FakeAudioParam(0) });
    }

    createDynamicsCompressor() {
      return node("compressor", {
        threshold: new FakeAudioParam(0),
        knee: new FakeAudioParam(0),
        ratio: new FakeAudioParam(0),
        attack: new FakeAudioParam(0),
        release: new FakeAudioParam(0),
      });
    }

    createWaveShaper() {
      return node("waveshaper", { curve: null, oversample: "none" });
    }

    createAnalyser() {
      return node("analyser", {
        fftSize: 2_048,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(array) {
          array.fill(0);
          array[0] = analyserPeak;
        },
      });
    }

    createMediaStreamSource(stream) {
      return node("media-source", { stream });
    }

    async resume() {
      this.resumeCount += 1;
      if (resume) return resume(this);
      this.state = "running";
    }

    async close() {
      this.closeCount += 1;
      this.state = "closed";
    }
  }

  class FakeWorkletNode extends FakeAudioNode {
    constructor(_context, processorName, options) {
      super("worklet");
      created.workletConstructions += 1;
      this.processorName = processorName;
      this.options = options;
      this.port = {
        messages: [],
        closeCount: 0,
        postMessage: (message) => this.port.messages.push(message),
        close: () => { this.port.closeCount += 1; },
      };
      created.nodes.push(this);
    }
  }

  const defaultStream = { getTracks: () => [makeTrack()] };
  const runtime = {
    AudioContext: FakeContext,
    navigator: {
      mediaDevices: {
        async getUserMedia(constraints) {
          created.mediaRequests.push(constraints);
          if (getUserMedia) return getUserMedia(constraints);
          return defaultStream;
        },
      },
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      created.timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      const index = created.timers.indexOf(timer);
      if (index >= 0) created.timers.splice(index, 1);
    },
  };
  if (worklet !== "missing") runtime.AudioWorkletNode = FakeWorkletNode;

  return { runtime, created, defaultStream };
}

test("Graph Delay audio settings are finite, bounded, immutable, and accept level as output", () => {
  assert.deepEqual(sanitizeGraphDelayAudioSettings(), {
    baseDelay: 62,
    distanceRatio: 1.94,
    timeCurve: 0.9,
    nodePass: 1,
    feedback: 0.72,
    damping: 4_800,
    wet: 1.08,
    dry: 0.18,
    spread: 0.82,
    inputTrim: 0.8,
    output: 0.58,
    pitchScale: 0.26,
    pitchAsymmetry: 0,
    pitchCurve: 1.35,
    pitchSlew: 165,
    inputX: 0.08,
    inputY: 0.5,
  });

  const settings = sanitizeGraphDelayAudioSettings({
    baseDelay: "900",
    distanceRatio: 99,
    timeCurve: 0,
    nodePass: -1,
    feedback: 5,
    damping: 0,
    wet: 9,
    dry: -1,
    spread: 4,
    inputTrim: 2,
    level: 3,
    pitchScale: -2,
    pitchAsymmetry: 2,
    pitchCurve: 0,
    pitchSlew: 0,
    inputX: -1,
    inputY: 2,
  });
  assert.deepEqual(settings, {
    baseDelay: 600,
    distanceRatio: 12,
    timeCurve: 0.25,
    nodePass: 0,
    feedback: 0.92,
    damping: 250,
    wet: 1.5,
    dry: 0,
    spread: 1,
    inputTrim: 1.5,
    output: 0.9,
    pitchScale: 0,
    pitchAsymmetry: 0.8,
    pitchCurve: 0.5,
    pitchSlew: 10,
    inputX: 0.02,
    inputY: 0.98,
  });
  assert.equal(Object.isFrozen(settings), true);
  assert.equal(sanitizeGraphDelayAudioSettings({ output: 0.2, level: 0.8 }).output, 0.2);
  assert.deepEqual(sanitizeGraphDelayAudioSettings(null), sanitizeGraphDelayAudioSettings());
  assert.equal(graphAudibleTapGain(Number.NaN), 0.9);
});

test("Graph Delay topology signatures include entries, edge order, and feedback roles but not layout", () => {
  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 7 });
  const signature = graphAudioTopologySignature(graph);
  const moved = {
    ...graph,
    nodes: graph.nodes.map((node, index) => ({ ...node, x: 0.2 + index * 0.1, y: 0.7 })),
  };
  assert.equal(graphAudioTopologySignature(moved), signature);
  assert.notEqual(graphAudioTopologySignature({ ...graph, entries: [1] }), signature);
  assert.notEqual(graphAudioTopologySignature({
    ...graph,
    edges: graph.edges.map((edge, index) => (
      index === 0 ? { ...edge, feedbackEdge: true } : edge
    )),
  }), signature);
  assert.notEqual(graphAudioTopologySignature({ ...graph, edges: [...graph.edges].reverse() }), signature);
});

test("Graph Delay timing helpers account for terminal distance, gates, and pitch pre-roll", () => {
  const terminalSettings = { baseDelay: 100, distanceRatio: 4 };
  closeTo(
    graphTerminalDelaySeconds({ x: 0, y: 0 }, { x: 1, y: 1 }, terminalSettings),
    0.068,
  );

  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 1 });
  const settings = {
    baseDelay: 100,
    distanceRatio: 1,
    timeCurve: 1,
    inputX: 0.08,
    inputY: 0.5,
    pitchScale: 0,
  };
  closeTo(graphFirstAudibleTapSeconds(graph, settings), 0.208);
  closeTo(
    graphFirstAudibleTapSeconds(graph, settings, null, { pitchReady: true }),
    0.328,
  );
  assert.equal(graphFirstAudibleTapSeconds(graph, settings, [false, true]), 0);
  assert.equal(
    graphFirstAudibleTapSeconds(graph, settings, new Map([["0>1", true], ["1>2", false]])),
    0,
  );
  assert.equal(graphFirstAudibleTapSeconds({ nodes: [] }, settings), 0);
});

test("Graph Delay turn matrices retain source/output coordinates and silent missing routes", () => {
  const matrix = graphTurnSemitoneMatrix({
    sources: [{}, {}],
    outputs: [{}, {}, {}],
    turns: [
      { sourceIndex: 0, outputIndex: 2, semitones: 3.5 },
      { sourceIndex: 1, outputIndex: 0, semitones: -7 },
    ],
  });
  assert.deepEqual(matrix, [[0, 0, 3.5], [-7, 0, 0]]);
  closeTo(graphAudibleTapGain(0), 0.9);
  closeTo(graphAudibleTapGain(1), 0.9);
  closeTo(graphAudibleTapGain(16), 0.45);
});

test("Graph Delay falls back from a failed Worklet and updates non-structural state in place", async () => {
  const track = makeTrack();
  const stream = { getTracks: () => [track] };
  const { runtime, created } = makeRuntime({
    worklet: "reject",
    getUserMedia: async () => stream,
  });
  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 5 });
  const audio = new GraphDelayAudio(runtime);

  assert.equal(audio.context, null, "construction and configuration remain lazy");
  audio.configure(graph, { output: 0.4 }, [true, true]);
  assert.equal(created.contexts.length, 0);

  const context = await audio.start();
  assert.equal(context, audio.context);
  assert.equal(context.options.latencyHint, "interactive");
  assert.equal(context.resumeCount, 1);
  assert.equal(created.workletModuleCalls, 1);
  assert.equal(created.workletConstructions, 0);
  assert.equal(audio.pitchProcessorReady, false);
  assert.ok(audio.audioGraph.routers.some((router) => router.gains?.length));
  assert.equal(created.mediaRequests.length, 1);
  assert.deepEqual(created.mediaRequests[0], {
    audio: {
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
    },
  });
  assert.equal(audio.analyser.fftSize, 512);
  closeTo(audio.inputLevel, 0.25);

  const originalAudioGraph = audio.audioGraph;
  const originalNodeCount = created.nodes.length;
  const originalInputDelay = originalAudioGraph.inputRoutes[0].delay.delayTime.value;
  const moved = {
    ...graph,
    nodes: graph.nodes.map((node, index) => ({
      ...node,
      x: Math.min(0.98, node.x + 0.04 * (index + 1)),
      y: Math.max(0.02, node.y - 0.03 * index),
    })),
  };
  audio.update(moved, {
    ...audio.settings,
    dry: 0.44,
    damping: 8_000,
    inputTrim: 1.1,
    inputX: 0.3,
  }, [true, false]);

  assert.equal(audio.audioGraph, originalAudioGraph);
  assert.equal(created.nodes.length, originalNodeCount, "layout and parameter edits allocate no nodes");
  assert.equal(originalAudioGraph.dry.gain.value, 0.44);
  assert.equal(originalAudioGraph.inputTrim.gain.value, 1.1);
  assert.equal(originalAudioGraph.edges[1].switchGain.gain.value, 0);
  assert.notEqual(originalAudioGraph.inputRoutes[0].delay.delayTime.value, originalInputDelay);

  const structuralGraph = generateGraph({ type: "tree", nodeCount: 3, seed: 5 });
  audio.update(structuralGraph, audio.settings, [true, true]);
  const replacement = audio.audioGraph;
  assert.notEqual(replacement, originalAudioGraph);
  assert.equal(audio.retiring.has(originalAudioGraph), true);
  assert.equal(created.timers.length, 1);
  assert.ok(created.timers[0].delay >= 330, "replacement waits for pre-roll and crossfade");
  context.currentTime += created.timers[0].delay / 1_000;
  created.timers.shift().callback();
  assert.equal(audio.retiring.has(originalAudioGraph), false);
  assert.ok(originalAudioGraph.owned.every((node) => node.disconnectCount > 0));
  assert.equal(
    audio.analyser.connections.some(({ destination }) => destination === originalAudioGraph.inputTrim),
    false,
    "the live analyser no longer feeds the retired graph",
  );

  await audio.close();
  assert.equal(track.stopCount, 1);
  assert.equal(context.state, "closed");
  assert.equal(context.closeCount, 1);
  assert.equal(audio.context, null);
  assert.equal(audio.audioGraph, null);
  assert.equal(audio.stream, null);
});

test("Graph Delay closes a partially built graph when microphone permission is denied", async () => {
  const denial = new Error("permission denied");
  denial.name = "NotAllowedError";
  const { runtime, created } = makeRuntime({
    getUserMedia: async () => { throw denial; },
  });
  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 9 });
  const audio = new GraphDelayAudio(runtime);

  await assert.rejects(audio.start({ graph }), ({ name }) => name === "NotAllowedError");
  assert.equal(created.contexts.length, 1);
  assert.equal(created.contexts[0].state, "closed");
  assert.equal(created.contexts[0].closeCount, 1);
  assert.equal(audio.context, null);
  assert.equal(audio.audioGraph, null);
  assert.equal(audio.stream, null);
  assert.ok(
    created.nodes.some((value) => value.kind === "delay" && value.disconnectCount > 0),
    "nodes allocated before the permission rejection are disconnected",
  );
});

test("Graph Delay disposes a replacement graph when its microphone input cannot connect", async () => {
  const { runtime, created } = makeRuntime();
  const initialGraph = generateGraph({ type: "chain", nodeCount: 3, seed: 17 });
  const replacementGraph = generateGraph({ type: "tree", nodeCount: 4, seed: 19 });
  const audio = new GraphDelayAudio(runtime);
  await audio.start({ graph: initialGraph });

  const context = audio.context;
  const originalAudioGraph = audio.audioGraph;
  const replacementStart = created.nodes.length;
  const gainCountBeforeInput = 5
    + replacementGraph.nodes.length * 2
    + replacementGraph.edges.length * 3
    + replacementGraph.entries.length
    + replacementGraph.edges.length;
  const createGain = context.createGain.bind(context);
  let replacementGainCalls = 0;
  context.createGain = () => {
    replacementGainCalls += 1;
    if (replacementGainCalls > gainCountBeforeInput) throw new Error("input trim failed");
    return createGain();
  };

  assert.throws(
    () => audio.update(replacementGraph, audio.settings),
    /input trim failed/,
  );
  assert.strictEqual(audio.audioGraph, originalAudioGraph);
  assert.strictEqual(audio.graph, initialGraph, "the public configuration rolls back too");
  assert.ok(
    created.nodes.slice(replacementStart).every((node) => node.disconnectCount > 0),
    "every node allocated for the rejected replacement is disconnected",
  );

  context.createGain = createGain;
  await audio.close();
});

test("Graph Delay stops a late microphone stream when close cancels a pending start", async () => {
  let resolvePermission;
  const permission = new Promise((resolve) => { resolvePermission = resolve; });
  const lateTrack = makeTrack();
  const lateStream = { getTracks: () => [lateTrack] };
  const { runtime, created } = makeRuntime({
    getUserMedia: () => permission,
  });
  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 13 });
  const audio = new GraphDelayAudio(runtime);

  const starting = audio.start({ graph });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.mediaRequests.length, 1, "permission request is pending");
  const context = audio.context;
  await audio.close();
  assert.equal(context.state, "closed");
  assert.equal(audio.context, null);

  const rejected = assert.rejects(starting, ({ name }) => name === "AbortError");
  resolvePermission(lateStream);
  await rejected;
  assert.equal(lateTrack.stopCount, 1);
  assert.equal(audio.context, null);
  assert.equal(audio.stream, null);
});

test("Graph Delay applies the newest graph edited during the microphone prompt", async () => {
  let resolvePermission;
  const permission = new Promise((resolve) => { resolvePermission = resolve; });
  const stream = { getTracks: () => [makeTrack()] };
  const { runtime } = makeRuntime({ getUserMedia: () => permission });
  const initialGraph = generateGraph({ type: "chain", nodeCount: 3, seed: 23 });
  const editedGraph = generateGraph({ type: "tree", nodeCount: 4, seed: 29 });
  const audio = new GraphDelayAudio(runtime);

  const initialStart = audio.start({ graph: initialGraph, settings: { dry: 0.1 } });
  await new Promise((resolve) => setImmediate(resolve));
  const editedStart = audio.start({
    graph: editedGraph,
    settings: { dry: 0.73, inputX: 0.42 },
    switches: editedGraph.edges.map((_edge, index) => index !== 0),
  });
  resolvePermission(stream);
  await Promise.all([initialStart, editedStart]);

  assert.strictEqual(audio.graph, editedGraph);
  assert.strictEqual(audio.audioGraph.graph, editedGraph);
  assert.equal(audio.audioGraph.dry.gain.value, 0.73);
  assert.equal(audio.audioGraph.switches[0], false);
  assert.equal(audio.audioGraph.inputTrim.gain.value, 0.8);
  await audio.close();
});

test("Graph Delay defers direct structural edits until a pending microphone is wired", async () => {
  let resolvePermission;
  const permission = new Promise((resolve) => { resolvePermission = resolve; });
  const stream = { getTracks: () => [makeTrack()] };
  const { runtime } = makeRuntime({ getUserMedia: () => permission });
  const initialGraph = generateGraph({ type: "chain", nodeCount: 3, seed: 61 });
  const editedGraph = generateGraph({ type: "tree", nodeCount: 4, seed: 67 });
  const audio = new GraphDelayAudio(runtime);

  const starting = audio.start({ graph: initialGraph });
  await new Promise((resolve) => setImmediate(resolve));
  const waitingGraph = audio.audioGraph;
  assert.ok(waitingGraph);
  assert.equal(audio.stream, null);

  audio.update(editedGraph, { ...audio.settings, dry: 0.63 });
  assert.strictEqual(
    audio.audioGraph,
    waitingGraph,
    "pre-permission edits update desired state without replacing the graph that will receive input",
  );
  resolvePermission(stream);
  await starting;

  assert.strictEqual(audio.audioGraph.graph, editedGraph);
  assert.equal(audio.audioGraph.dry.gain.value, 0.63);
  assert.ok(audio.audioGraph.inputTrim, "the graph fading in owns an input trim");
  assert.equal(
    audio.analyser.connections.some(({ destination }) => destination === audio.audioGraph.inputTrim),
    true,
    "the live analyser feeds the current graph rather than only its predecessor",
  );
  await audio.close();
});

test("Graph Delay close cancels a start waiting for AudioContext resume", async () => {
  let resolveResume;
  const resumePending = new Promise((resolve) => { resolveResume = resolve; });
  const { runtime, created } = makeRuntime({
    resume: () => resumePending,
  });
  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 31 });
  const audio = new GraphDelayAudio(runtime);

  const starting = audio.start({ graph });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.contexts.length, 1);
  assert.equal(created.mediaRequests.length, 0);
  const context = created.contexts[0];
  await audio.close();
  resolveResume();
  await assert.rejects(starting, ({ name }) => name === "AbortError");
  assert.equal(context.state, "closed");
  assert.equal(audio.context, null);
  assert.equal(audio.audioGraph, null);
  assert.equal(created.mediaRequests.length, 0, "a cancelled resume cannot open a permission prompt");
});

test("Graph Delay close cancels a start waiting for its pitch Worklet", async () => {
  let resolveWorklet;
  const workletPending = new Promise((resolve) => { resolveWorklet = resolve; });
  const { runtime, created } = makeRuntime({
    worklet: "ready",
    addModule: () => workletPending,
  });
  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 37 });
  const audio = new GraphDelayAudio(runtime);

  const starting = audio.start({ graph });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created.workletModuleCalls, 1);
  assert.equal(created.mediaRequests.length, 0);
  await audio.close();
  resolveWorklet();
  await assert.rejects(starting, ({ name }) => name === "AbortError");
  assert.equal(audio.pitchProcessorReady, false);
  assert.equal(audio.context, null);
  assert.equal(audio.audioGraph, null);
  assert.equal(created.mediaRequests.length, 0, "a stale Worklet continuation cannot request the mic");
});

test("Graph Delay resumes and reuses a suspended live realization", async () => {
  const { runtime, created } = makeRuntime();
  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 41 });
  const audio = new GraphDelayAudio(runtime);
  const context = await audio.start({ graph });
  const liveGraph = audio.audioGraph;
  context.state = "suspended";

  const resumed = await audio.start({ graph, settings: { dry: 0.71 } });
  assert.strictEqual(resumed, context);
  assert.strictEqual(audio.audioGraph, liveGraph);
  assert.equal(context.resumeCount, 2);
  assert.equal(created.contexts.length, 1);
  assert.equal(created.mediaRequests.length, 1);
  assert.equal(liveGraph.dry.gain.value, 0.71);
  await audio.close();
});

test("Graph Delay replaces an externally closed realization without leaking its stream", async () => {
  const firstTrack = makeTrack();
  const secondTrack = makeTrack();
  let requestCount = 0;
  const { runtime, created } = makeRuntime({
    getUserMedia: async () => ({
      getTracks: () => [requestCount++ === 0 ? firstTrack : secondTrack],
    }),
  });
  const graph = generateGraph({ type: "chain", nodeCount: 3, seed: 43 });
  const audio = new GraphDelayAudio(runtime);
  const firstContext = await audio.start({ graph });
  firstContext.state = "closed";

  const secondContext = await audio.start({ graph });
  assert.notStrictEqual(secondContext, firstContext);
  assert.equal(created.contexts.length, 2);
  assert.equal(created.mediaRequests.length, 2);
  assert.equal(firstTrack.stopCount, 1);
  await audio.close();
  assert.equal(secondTrack.stopCount, 1);
});

test("Graph Delay serializes structural transitions and keeps ordinary edits out of the fade lane", async () => {
  const { runtime, created } = makeRuntime();
  const initial = generateGraph({ type: "chain", nodeCount: 3, seed: 47 });
  const firstReplacement = generateGraph({ type: "tree", nodeCount: 4, seed: 53 });
  const queuedReplacement = generateGraph({ type: "ring", nodeCount: 5, seed: 59 });
  const audio = new GraphDelayAudio(runtime);
  const context = await audio.start({ graph: initial });

  audio.update(firstReplacement, { ...audio.settings, wet: 1.2 });
  const fadingIn = audio.audioGraph;
  const fadingOut = [...audio.retiring][0];
  const crossfadeCallCount = fadingIn.crossfade.gain.calls.length;
  const nodeCountAfterFirstReplacement = created.nodes.length;
  audio.update({
    ...firstReplacement,
    nodes: firstReplacement.nodes.map((node) => ({ ...node, x: Math.min(0.98, node.x + 0.02) })),
  }, { ...audio.settings, output: 0.23 });
  assert.equal(
    fadingIn.crossfade.gain.calls.length,
    crossfadeCallCount,
    "motion and knob edits preserve the scheduled crossfade",
  );
  assert.equal(fadingOut.output.gain.value, 0.23, "the still-audible graph follows shared output edits");

  audio.update(queuedReplacement, audio.settings);
  assert.equal(created.nodes.length, nodeCountAfterFirstReplacement, "a second shape waits instead of allocating a third graph");
  assert.equal(audio.retiring.size, 1);
  assert.equal(created.timers.length, 1);

  context.currentTime += created.timers[0].delay / 1_000;
  created.timers.shift().callback();
  assert.strictEqual(audio.audioGraph.graph, queuedReplacement);
  assert.equal(audio.retiring.size, 1, "only the newly superseded graph can be retiring");
  assert.equal(created.timers.length, 1, "the queued shape owns the only retirement timer");

  await audio.close();
  assert.equal(created.timers.length, 0);
  assert.equal(audio.retiring.size, 0);
});

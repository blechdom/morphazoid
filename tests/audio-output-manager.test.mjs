import assert from "node:assert/strict";
import test from "node:test";

import {
  AudioOutputManager,
  connectAudioOutput,
  getSharedAudioOutputManager,
} from "../src/audio-output-manager.js";

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function fakeRuntime() {
  const document = new FakeEventTarget();
  document.visibilityState = "visible";
  let timerId = 0;
  const timers = new Map();
  const runtime = {
    document,
    navigator: {},
    setTimeout(callback) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  return {
    runtime,
    document,
    timerCount: () => timers.size,
    runNextTimer() {
      const entry = timers.entries().next().value;
      if (!entry) return false;
      timers.delete(entry[0]);
      entry[1]();
      return true;
    },
  };
}

class FakeAnalyser {
  constructor(samples = [0, 0, 0, 0]) {
    this.fftSize = samples.length;
    this.smoothingTimeConstant = 0.8;
    this.samples = samples;
    this.connections = [];
    this.disconnections = [];
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect(target) {
    this.disconnections.push(target);
  }

  getFloatTimeDomainData(target) {
    for (let index = 0; index < target.length; index += 1) {
      target[index] = this.samples[index % this.samples.length];
    }
  }
}

class FakeGain {
  constructor() {
    this.gain = { value: 0 };
    this.channelCount = 1;
    this.channelCountMode = "max";
    this.channelInterpretation = "discrete";
    this.connections = [];
    this.disconnections = [];
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect(target) {
    this.disconnections.push(target);
  }
}

class FakeChannelSplitter {
  constructor(channelCount) {
    this.channelCount = channelCount;
    this.connections = [];
    this.disconnections = [];
  }

  connect(target, output = 0, input = 0) {
    this.connections.push({ target, output, input });
    return target;
  }

  disconnect(target) {
    this.disconnections.push(target);
  }
}

test("recording taps the original clock, deduplicates sources and leaves playback connected", () => {
  const manager = new AudioOutputManager();
  const graph = fakeAudioGraph();
  graph.context.sampleRate = 44100;
  const releaseFirst = manager.connect(graph.context, graph.source);
  const secondSource = new FakeGain();
  const releaseSecond = manager.connect(graph.context, secondSource);
  assert.equal(manager.canRecord(), true);
  assert.equal(manager.recordingContext(), graph.context);
  assert.equal(manager.recordingSampleRate(), 44100);
  const input = new FakeGain();
  const releaseTap = manager.tapInto(graph.context, input);
  assert.deepEqual(graph.gains[0].connections, [graph.splitters[0], input]);
  assert.deepEqual(graph.source.connections, [graph.destination, graph.gains[0]]);
  releaseFirst();
  assert.deepEqual(graph.gains[0].disconnections, [], "second output keeps the tap alive");
  releaseTap();
  releaseTap();
  assert.deepEqual(graph.gains[0].disconnections, [input]);
  assert.deepEqual(secondSource.disconnections, [], "stopping recording does not stop playback");
  assert.equal(manager.recordingTaps.size, 0);
  releaseSecond();
});

test("separate running clocks are rejected without touching either audible route", () => {
  const manager = new AudioOutputManager();
  const first = fakeAudioGraph();
  const second = fakeAudioGraph();
  const releaseFirst = manager.connect(first.context, first.source);
  const releaseSecond = manager.connect(second.context, second.source);
  assert.throws(() => manager.tapInto(first.context, new FakeGain()), /separate audio outputs/);
  assert.equal(manager.recordingTaps.size, 0);
  assert.deepEqual(first.source.disconnections, []);
  assert.deepEqual(second.source.disconnections, []);
  releaseFirst(); releaseSecond();
});

test("a new independent output interrupts capture explicitly while preserving playback", () => {
  const manager = new AudioOutputManager();
  const first = fakeAudioGraph();
  const releaseFirst = manager.connect(first.context, first.source);
  const errors = [];
  const releaseTap = manager.tapInto(first.context, new FakeGain(), { onerror: error => errors.push(error.message) });
  const second = fakeAudioGraph();
  const releaseSecond = manager.connect(second.context, second.source);
  assert.match(errors[0], /separate audio outputs/);
  assert.deepEqual(first.source.disconnections, []);
  assert.deepEqual(second.source.disconnections, []);
  releaseTap(); releaseFirst(); releaseSecond();
});

test("recording eligibility respects Audio off and host ownership", () => {
  const graph = fakeAudioGraph();
  const manager = new AudioOutputManager();
  const release = manager.connect(graph.context, graph.source);
  graph.context.state = "suspended";
  assert.equal(manager.canRecord(), false);
  graph.context.state = "running";
  assert.equal(manager.canRecord(), true);
  const hostManager = new AudioOutputManager({ MorphazoidWAX: {} });
  assert.equal(hostManager.canRecord(), false);
  assert.throws(() => hostManager.tapInto({}, {}), /plug-in host/);
  release();
});

function fakeAudioGraph(samples = [-0.5, 0.5, -0.5, 0.5]) {
  const destination = { kind: "destination" };
  const analysers = [];
  const gains = [];
  const splitters = [];
  const channelSamples = Array.isArray(samples)
    ? { left: samples, right: samples }
    : samples;
  const context = {
    destination,
    state: "running",
    createAnalyser() {
      const analyser = new FakeAnalyser(
        analysers.length % 2 === 0 ? channelSamples.left : channelSamples.right,
      );
      analysers.push(analyser);
      return analyser;
    },
    createGain() {
      const gain = new FakeGain();
      gains.push(gain);
      return gain;
    },
    createChannelSplitter(channelCount) {
      const splitter = new FakeChannelSplitter(channelCount);
      splitters.push(splitter);
      return splitter;
    },
  };
  const source = {
    connections: [],
    disconnections: [],
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect(target) {
      this.disconnections.push(target);
    },
  };
  return { context, source, destination, analysers, gains, splitters };
}

test("authored stereo downmix feeds capture without duplicating the physical surround output", () => {
  const runtime = {};
  const graph = fakeAudioGraph();
  const stereoSource = new FakeGain();
  const releaseFirst = connectAudioOutput(graph.context, graph.source, { runtime, stereoSource });
  const releaseSecond = connectAudioOutput(graph.context, graph.source, { runtime, stereoSource });
  const manager = getSharedAudioOutputManager(runtime);
  const capture = new FakeGain();
  const releaseTap = manager.tapInto(graph.context, capture);
  assert.deepEqual(graph.source.connections, [graph.destination]);
  assert.deepEqual(stereoSource.connections, [graph.gains[0]]);
  assert.deepEqual(graph.gains[0].connections, [graph.splitters[0], capture]);
  releaseTap();
  assert.deepEqual(graph.source.disconnections, []);
  assert.deepEqual(stereoSource.disconnections, []);
  releaseFirst();
  assert.equal(manager.connectionCount(), 1);
  releaseSecond();
  releaseSecond();
  assert.equal(manager.connectionCount(), 0);
  assert.deepEqual(graph.source.disconnections, [graph.destination]);
  assert.deepEqual(stereoSource.disconnections, [graph.gains[0]]);
});

test("an unavailable authored downmix preserves playback and rejects incomplete capture", () => {
  const graph = fakeAudioGraph();
  const manager = new AudioOutputManager();
  const stereoSource = { connect() { throw new Error("Stereo route unavailable"); } };
  const release = manager.connect(graph.context, graph.source, { stereoSource });
  assert.deepEqual(graph.source.connections, [graph.destination]);
  assert.throws(() => manager.tapInto(graph.context, new FakeGain()), /cannot be recorded/);
  assert.equal(manager.recordingTaps.size, 0);
  assert.deepEqual(graph.source.disconnections, []);
  release();
  assert.deepEqual(graph.source.disconnections, [graph.destination]);
});

test("shared audio output managers are stable and scoped to a runtime", () => {
  const firstRuntime = {};
  const secondRuntime = {};
  assert.equal(
    getSharedAudioOutputManager(firstRuntime),
    getSharedAudioOutputManager(firstRuntime),
  );
  assert.notEqual(
    getSharedAudioOutputManager(firstRuntime),
    getSharedAudioOutputManager(secondRuntime),
  );
});

test("final mix keeps its direct route and adds one non-audible stereo meter tap", () => {
  const { runtime } = fakeRuntime();
  const {
    context,
    source,
    destination,
    analysers,
    gains,
    splitters,
  } = fakeAudioGraph();
  const firstRelease = connectAudioOutput(context, source, { runtime });
  const secondRelease = connectAudioOutput(context, source, { runtime });
  const manager = getSharedAudioOutputManager(runtime);

  assert.equal(analysers.length, 2);
  assert.equal(gains.length, 1);
  assert.equal(splitters.length, 1);
  assert.deepEqual(source.connections, [destination, gains[0]]);
  assert.deepEqual(gains[0].connections, [splitters[0]]);
  assert.deepEqual(splitters[0].connections, [
    { target: analysers[0], output: 0, input: 0 },
    { target: analysers[1], output: 1, input: 0 },
  ]);
  assert.deepEqual(analysers[0].connections, []);
  assert.deepEqual(analysers[1].connections, []);
  assert.equal(gains[0].gain.value, 1);
  assert.equal(gains[0].channelCount, 2);
  assert.equal(gains[0].channelCountMode, "explicit");
  assert.equal(gains[0].channelInterpretation, "speakers");
  assert.equal(manager.getStatus().connectionCount, 1);

  firstRelease();
  firstRelease();
  assert.equal(source.disconnections.length, 0, "the second lease keeps the route alive");
  secondRelease();
  assert.deepEqual(source.disconnections, [destination, gains[0]]);
  assert.deepEqual(gains[0].disconnections, [undefined]);
  assert.deepEqual(splitters[0].disconnections, [undefined]);
  assert.deepEqual(analysers[0].disconnections, [undefined]);
  assert.deepEqual(analysers[1].disconnections, [undefined]);
  assert.equal(manager.getStatus().connectionCount, 0);
});

test("contexts without analyser support retain the direct destination route", () => {
  const runtime = {};
  const destination = { kind: "destination" };
  const context = { destination, state: "running" };
  const source = {
    connections: [],
    disconnections: [],
    connect(target) { this.connections.push(target); },
    disconnect(target) { this.disconnections.push(target); },
  };

  const release = connectAudioOutput(context, source, { runtime });
  assert.deepEqual(source.connections, [destination]);
  assert.equal(getSharedAudioOutputManager(runtime).getStatus().monitoring, false);
  release();
  assert.deepEqual(source.disconnections, [destination]);

  assert.doesNotThrow(() => connectAudioOutput(null, null, { runtime })());
});

test("meter subscriptions sample near 30 Hz only while visible", () => {
  const controls = fakeRuntime();
  const graph = fakeAudioGraph([-0.5, 0.5, -0.5, 0.5]);
  const release = connectAudioOutput(graph.context, graph.source, { runtime: controls.runtime });
  const manager = getSharedAudioOutputManager(controls.runtime);
  const statuses = [];
  const unsubscribe = manager.subscribe((status) => statuses.push(status));

  assert.equal(controls.timerCount(), 1);
  assert.equal(controls.document.listenerCount("visibilitychange"), 1);
  assert.equal(controls.runNextTimer(), true);
  assert.equal(controls.timerCount(), 1, "the visible subscriber schedules the next sample");
  assert.equal(statuses.at(-1).rms, 0.5);
  assert.equal(statuses.at(-1).peak, 0.5);
  assert.equal(statuses.at(-1).leftRms, 0.5);
  assert.equal(statuses.at(-1).leftPeak, 0.5);
  assert.equal(statuses.at(-1).rightRms, 0.5);
  assert.equal(statuses.at(-1).rightPeak, 0.5);
  assert.equal(statuses.at(-1).active, true);
  assert.equal(statuses.at(-1).monitoring, true);

  controls.document.visibilityState = "hidden";
  controls.document.emit("visibilitychange");
  assert.equal(controls.timerCount(), 0);
  assert.equal(statuses.at(-1).rms, 0);
  assert.equal(statuses.at(-1).leftRms, 0);
  assert.equal(statuses.at(-1).rightRms, 0);
  assert.equal(statuses.at(-1).monitoring, false);

  controls.document.visibilityState = "visible";
  controls.document.emit("visibilitychange");
  assert.equal(controls.timerCount(), 1);
  unsubscribe();
  unsubscribe();
  assert.equal(controls.timerCount(), 0);
  assert.equal(controls.document.listenerCount("visibilitychange"), 0);
  release();
});

test("meter aggregation reports combined RMS, maximum peak, and clipping", () => {
  const manager = new AudioOutputManager({});
  const loud = fakeAudioGraph([1.2, -1.2]);
  const quiet = fakeAudioGraph([0.4, -0.4]);
  const releaseLoud = manager.connect(loud.context, loud.source);
  const releaseQuiet = manager.connect(quiet.context, quiet.source);
  const level = manager.sample();

  assert.ok(
    Math.abs(level.rms - Math.sqrt((1.44 + 1.44 + 0.16 + 0.16) / 4)) < 1e-6,
  );
  assert.equal(level.peak, 1);
  assert.ok(Math.abs(level.leftRms - Math.sqrt((1.44 + 1.44 + 0.16 + 0.16) / 4)) < 1e-6);
  assert.ok(Math.abs(level.rightRms - level.leftRms) < 1e-6);
  assert.equal(level.leftPeak, 1);
  assert.equal(level.rightPeak, 1);
  assert.equal(level.clipped, true);
  assert.equal(level.active, true);
  releaseLoud();
  releaseQuiet();
});

test("stereo meters preserve asymmetric panning and aggregate compatibility", () => {
  const manager = new AudioOutputManager({});
  const graph = fakeAudioGraph({
    left: [0.8, -0.8, 0.8, -0.8],
    right: [0.2, -0.2, 0.2, -0.2],
  });
  const release = manager.connect(graph.context, graph.source);
  const level = manager.sample();

  assert.ok(Math.abs(level.leftRms - 0.8) < 1e-6);
  assert.ok(Math.abs(level.rightRms - 0.2) < 1e-6);
  assert.ok(Math.abs(level.leftPeak - 0.8) < 1e-6);
  assert.ok(Math.abs(level.rightPeak - 0.2) < 1e-6);
  assert.ok(Math.abs(level.rms - Math.sqrt((0.8 ** 2 + 0.2 ** 2) / 2)) < 1e-6);
  assert.ok(Math.abs(level.peak - 0.8) < 1e-6);
  assert.equal(level.clipped, false);
  assert.equal(level.active, true);
  release();
});

test("minimal analyser-only contexts expose their mono meter on both channels", () => {
  const manager = new AudioOutputManager({});
  const samples = [0.3, -0.3];
  const destination = { kind: "destination" };
  const analyser = new FakeAnalyser(samples);
  const context = {
    destination,
    state: "running",
    createAnalyser: () => analyser,
  };
  const source = {
    connections: [],
    disconnections: [],
    connect(target) { this.connections.push(target); },
    disconnect(target) { this.disconnections.push(target); },
  };

  const release = manager.connect(context, source);
  const level = manager.sample();

  assert.deepEqual(source.connections, [destination, analyser]);
  assert.ok(Math.abs(level.leftRms - 0.3) < 1e-6);
  assert.ok(Math.abs(level.rightRms - 0.3) < 1e-6);
  assert.ok(Math.abs(level.rms - 0.3) < 1e-6);
  assert.ok(Math.abs(level.leftPeak - 0.3) < 1e-6);
  assert.ok(Math.abs(level.rightPeak - 0.3) < 1e-6);
  release();
  assert.deepEqual(source.disconnections, [destination, analyser]);
});

test("browser output selection enumerates sinks and applies them to active contexts", async () => {
  const devices = new FakeEventTarget();
  devices.enumerateDevices = async () => [
    { kind: "audioinput", deviceId: "mic", label: "Mic" },
    { kind: "audiooutput", deviceId: "speakers", label: "Studio speakers" },
  ];
  const { runtime } = fakeRuntime();
  runtime.navigator.mediaDevices = devices;
  const graph = fakeAudioGraph();
  const sinkCalls = [];
  graph.context.setSinkId = async (id) => { sinkCalls.push(id); };
  const manager = getSharedAudioOutputManager(runtime);
  const release = manager.connect(graph.context, graph.source);

  assert.deepEqual(await manager.listOutputDevices(), [
    {
      id: "speakers",
      deviceId: "speakers",
      label: "Studio speakers",
      kind: "audiooutput",
    },
  ]);
  assert.equal(manager.getStatus().output.mode, "browser-selectable");
  assert.equal(await manager.setOutputDevice("speakers"), true);
  assert.deepEqual(sinkCalls, ["speakers"]);
  assert.deepEqual(manager.getStatus().output, {
    mode: "browser-selectable",
    canSelect: true,
    selectedId: "speakers",
    label: "Studio speakers",
  });
  release();
});

test("WAX reports DAW-owned output and never attempts browser sink selection", async () => {
  const runtime = { MorphazoidWAX: {} };
  const manager = getSharedAudioOutputManager(runtime);
  assert.deepEqual(manager.getStatus().output, {
    mode: "wax-host",
    canSelect: false,
    selectedId: "wax-host",
    label: "DAW / plug-in host",
  });
  assert.deepEqual(await manager.listOutputDevices(), [
    {
      id: "wax-host",
      deviceId: "wax-host",
      label: "DAW / plug-in host",
      kind: "audiooutput",
    },
  ]);
  assert.equal(await manager.setOutputDevice("speakers"), false);
});

test("a failing meter observer cannot interrupt other subscribers", () => {
  const manager = new AudioOutputManager({});
  let received = 0;
  const releaseFailing = manager.subscribe(() => { throw new Error("render failed"); });
  const releaseWorking = manager.subscribe(() => { received += 1; });
  manager.publish();
  assert.equal(received, 2, "working observer receives its initial snapshot and the publish");
  releaseFailing();
  releaseWorking();
});

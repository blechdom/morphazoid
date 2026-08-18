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

function fakeAudioGraph(samples = [-0.5, 0.5, -0.5, 0.5]) {
  const destination = { kind: "destination" };
  const analysers = [];
  const context = {
    destination,
    state: "running",
    createAnalyser() {
      const analyser = new FakeAnalyser(samples);
      analysers.push(analyser);
      return analyser;
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
  return { context, source, destination, analysers };
}

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

test("final mix sources connect once through one pre-destination analyser", () => {
  const { runtime } = fakeRuntime();
  const { context, source, destination, analysers } = fakeAudioGraph();
  const firstRelease = connectAudioOutput(context, source, { runtime });
  const secondRelease = connectAudioOutput(context, source, { runtime });
  const manager = getSharedAudioOutputManager(runtime);

  assert.equal(analysers.length, 1);
  assert.deepEqual(analysers[0].connections, [destination]);
  assert.deepEqual(source.connections, [analysers[0]]);
  assert.equal(manager.getStatus().connectionCount, 1);

  firstRelease();
  firstRelease();
  assert.equal(source.disconnections.length, 0, "the second lease keeps the route alive");
  secondRelease();
  assert.deepEqual(source.disconnections, [analysers[0]]);
  assert.deepEqual(analysers[0].disconnections, [destination]);
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
  assert.equal(statuses.at(-1).active, true);
  assert.equal(statuses.at(-1).monitoring, true);

  controls.document.visibilityState = "hidden";
  controls.document.emit("visibilitychange");
  assert.equal(controls.timerCount(), 0);
  assert.equal(statuses.at(-1).rms, 0);
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
  assert.equal(level.clipped, true);
  assert.equal(level.active, true);
  releaseLoud();
  releaseQuiet();
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

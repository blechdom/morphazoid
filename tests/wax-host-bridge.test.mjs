import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  WAX_HOST_CONSTANTS,
  createWaxHostBridge,
  installWaxHostBridge,
  normalizePlayhead,
  validateWaxEnvelope,
} from "../scripts/wax/wax-host-bridge.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createRuntime({ readyState = "complete" } = {}) {
  const documentListeners = new Map();
  const runtimeListeners = new Map();
  const document = {
    readyState,
    addEventListener(type, callback) {
      const listeners = documentListeners.get(type) || new Set();
      listeners.add(callback);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, callback) {
      documentListeners.get(type)?.delete(callback);
    },
  };
  const runtime = {
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    addEventListener(type, callback) {
      const listeners = runtimeListeners.get(type) || new Set();
      listeners.add(callback);
      runtimeListeners.set(type, listeners);
    },
    clearInterval,
    clearTimeout,
    console: { error() {} },
    dispatchEvent() {},
    document,
    navigator: {},
    removeEventListener(type, callback) {
      runtimeListeners.get(type)?.delete(callback);
    },
    setInterval,
    setTimeout,
  };
  runtime.emitDocument = (type) => {
    if (type === "DOMContentLoaded") document.readyState = "complete";
    for (const listener of documentListeners.get(type) || []) listener({ type });
  };
  runtime.emit = (type, properties = {}) => {
    for (const listener of runtimeListeners.get(type) || []) listener({ type, ...properties });
  };
  return runtime;
}

function waxEnvelope(pages, route = null) {
  return {
    schema: WAX_HOST_CONSTANTS.SCHEMA,
    schemaVersion: WAX_HOST_CONSTANTS.SCHEMA_VERSION,
    route,
    pages,
  };
}

test("normal browser runtime stays inert even when Web MIDI exists", () => {
  const runtime = createRuntime();
  let midiRequests = 0;
  let adapterMidiEnables = 0;
  runtime.navigator.requestMIDIAccess = () => {
    midiRequests += 1;
    return Promise.resolve({});
  };

  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.register({
    id: "shape",
    enableMidi() {
      adapterMidiEnables += 1;
      return runtime.navigator.requestMIDIAccess();
    },
  });
  bridge.start();

  assert.equal(bridge.detected, false);
  assert.equal(adapterMidiEnables, 0);
  assert.equal(midiRequests, 0);
  assert.deepEqual(bridge.capabilities(), {
    dataTree: false,
    midi: true,
    playhead: false,
    transport: false,
  });
  bridge.dispose();
});

test("transport received before registration replays the latest valid host state", () => {
  const runtime = createRuntime();
  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  const events = [];

  bridge.handleTransport("bpm", 126);
  bridge.handleTransport("bpm", Number.NaN);
  bridge.handleTransport("play");
  const unregister = bridge.register({
    id: "chaotic-fm",
    transport: {
      bpm(value) { events.push(["bpm", value]); },
      play(playhead) { events.push(["play", playhead.isPlaying]); },
      stop(playhead) { events.push(["stop", playhead.isPlaying]); },
    },
  });

  assert.deepEqual(events, [["bpm", 126], ["play", null]]);
  bridge.handleTransport("stop");
  assert.deepEqual(events.at(-1), ["stop", null]);
  unregister();
  unregister();
  bridge.dispose();
});

test("DataTree pulls before it permits state pushes", async () => {
  const runtime = createRuntime();
  const pull = deferred();
  const pushes = [];
  let provider = null;
  let stateListener = null;
  let currentState = { cutoff: 400 };
  const applied = [];

  runtime.WAX_DataTree = {
    pull(appName, timeoutMs) {
      assert.equal(appName, WAX_HOST_CONSTANTS.APP_NAME);
      assert.equal(timeoutMs, 3000);
      return pull.promise;
    },
    push(value, appName) {
      pushes.push({ appName, value });
    },
    setProvider(callback) { provider = callback; },
  };

  const bridge = createWaxHostBridge(runtime, {
    probeDelaysMs: [],
    pushDebounceMs: 0,
  });
  bridge.register({
    id: "chaotic-fm",
    stateVersion: 2,
    getState: () => currentState,
    applyState(state, metadata) {
      applied.push({ metadata, state });
      currentState = state;
    },
    subscribeState(listener) {
      stateListener = listener;
      return () => { stateListener = null; };
    },
  });
  bridge.start();

  stateListener({ cutoff: 900 }, "user");
  currentState = { cutoff: 900 };
  assert.equal(pushes.length, 0, "defaults or edits must not push before pull settles");

  pull.resolve(waxEnvelope({
    "chaotic-fm": { stateVersion: 1, state: { cutoff: 200 } },
  }, "chaotic-fm"));
  await bridge.initialPull;
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(applied.length, 0, "a user edit made during pull wins over late hydration");
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].appName, WAX_HOST_CONSTANTS.APP_NAME);
  assert.deepEqual(pushes[0].value.pages["chaotic-fm"], {
    stateVersion: 2,
    state: { cutoff: 900 },
  });
  assert.equal(typeof provider, "function");
  assert.deepEqual(provider().pages["chaotic-fm"].state, { cutoff: 900 });
  bridge.dispose();
});

test("valid stored state hydrates an adapter and malformed envelopes keep defaults", async () => {
  for (const [stored, expectedApplications] of [
    [waxEnvelope({ shape: { stateVersion: 3, state: { gain: 0.75 } } }, "shape"), 1],
    [{ schema: "someone-else", schemaVersion: 1, route: "shape", pages: {} }, 0],
  ]) {
    const runtime = createRuntime();
    runtime.WAX_DataTree = {
      pull: () => Promise.resolve(stored),
      push() {},
    };
    const applications = [];
    const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
    bridge.register({
      id: "shape",
      applyState(state, metadata) { applications.push({ state, metadata }); },
    });
    bridge.start();
    await bridge.initialPull;

    assert.equal(applications.length, expectedApplications);
    if (applications.length) {
      assert.deepEqual(applications[0].state, { gain: 0.75 });
      assert.equal(applications[0].metadata.source, "wax-hydration");
      assert.equal(applications[0].metadata.stateVersion, 3);
    }
    bridge.dispose();
  }
});

test("the same host preset can be recalled after an intervening user edit", async () => {
  const runtime = createRuntime();
  const presetA = waxEnvelope({ synth: { stateVersion: 1, state: { value: 1 } } }, "synth");
  let hydrate = null;
  let stateListener = null;
  let currentState = { value: 0 };
  const applied = [];
  runtime.WAX_DataTree = {
    onHydrated(callback) { hydrate = callback; },
    pull: () => Promise.resolve(presetA),
    push() {},
  };

  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [], pushDebounceMs: 0 });
  bridge.register({
    id: "synth",
    getState: () => currentState,
    applyState(state) {
      currentState = state;
      applied.push(state.value);
    },
    subscribeState(listener) { stateListener = listener; },
  });
  bridge.start();
  await bridge.initialPull;
  assert.deepEqual(applied, [1]);

  currentState = { value: 2 };
  stateListener(currentState, "user");
  await bridge.flush();
  hydrate(presetA);

  assert.deepEqual(applied, [1, 1]);
  assert.deepEqual(currentState, { value: 1 });
  bridge.dispose();
});

test("a subscription's immediate current-value emission does not block host restore", async () => {
  const runtime = createRuntime();
  const applied = [];
  runtime.WAX_DataTree = {
    pull: () => Promise.resolve(waxEnvelope({
      synth: { stateVersion: 1, state: { value: 9 } },
    }, "synth")),
    push() {},
  };

  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.register({
    id: "synth",
    getState: () => ({ value: 1 }),
    applyState(state) { applied.push(state.value); },
    subscribeState(listener) { listener({ value: 1 }, "initial"); },
  });
  bridge.start();
  await bridge.initialPull;

  assert.deepEqual(applied, [9]);
  bridge.dispose();
});

test("MIDI enable waits for both strong WAX detection and DOM readiness", async () => {
  const runtime = createRuntime({ readyState: "loading" });
  let midiEnables = 0;
  runtime.WAX_RequestPlayheadInfo = () => {};
  runtime.Request_PlayheadTimerStart = () => {};
  runtime.Request_PlayheadTimerStop = () => {};

  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.register({
    id: "recursive-fm",
    enableMidi() { midiEnables += 1; },
  });
  bridge.start();
  assert.equal(bridge.detected, true);
  assert.equal(midiEnables, 0);

  runtime.emitDocument("DOMContentLoaded");
  await Promise.resolve();
  bridge.refreshDetection();
  assert.equal(midiEnables, 1);
  bridge.dispose();
});

test("WAX MIDI waits for the initial DataTree restore to settle", async () => {
  const runtime = createRuntime();
  const pull = deferred();
  let midiEnables = 0;
  runtime.WAX_DataTree = {
    pull: () => pull.promise,
    push() {},
  };

  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.register({
    id: "chaotic-fm",
    enableMidi() { midiEnables += 1; },
  });
  bridge.start();
  assert.equal(midiEnables, 0);

  pull.resolve(waxEnvelope({}, null));
  await bridge.initialPull;
  assert.equal(midiEnables, 1);
  bridge.dispose();
});

test("DataTree pull and push failures remain nonfatal", async () => {
  const runtime = createRuntime();
  runtime.WAX_DataTree = {
    pull: () => Promise.reject(new Error("no saved state")),
    push: () => Promise.reject(new Error("host refused state")),
  };
  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.register({ id: "shape", getState: () => ({ gain: 0.5 }) });
  bridge.start();

  assert.equal(await bridge.initialPull, null);
  assert.equal(await bridge.flush(), false);
  assert.equal(bridge.detected, true);
  bridge.dispose();
});

test("capabilities injected after startup are detected without false positives", async () => {
  const runtime = createRuntime();
  let midiEnables = 0;
  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.register({
    id: "delayed",
    enableMidi() { midiEnables += 1; },
  });
  bridge.start();
  assert.equal(bridge.detected, false);

  runtime.WAX_DataTree = { pull: () => Promise.resolve(null) };
  assert.equal(bridge.refreshDetection(), false, "partial DataTree is not a host marker");
  runtime.WAX_DataTree.push = () => {};
  assert.equal(bridge.refreshDetection(), true);
  await bridge.initialPull;
  assert.equal(midiEnables, 1);
  bridge.dispose();
});

test("continuous playhead is clamped, normalized, and stopped on unregister", async () => {
  const runtime = createRuntime();
  const starts = [];
  let stops = 0;
  const updates = [];
  runtime.WAX_RequestPlayheadInfo = () => {};
  runtime.Request_PlayheadTimerStart = (interval) => starts.push(interval);
  runtime.Request_PlayheadTimerStop = () => { stops += 1; };
  runtime.PlayheadInfo = {
    state: { isPlaying: true },
    tempo: { bpm: 128, timeSigNumerator: "four" },
    timing: { ppqPosition: 3.5, timeInSeconds: Number.NaN },
  };

  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.start();
  const unregister = bridge.register({
    id: "linear-drums",
    transport: {
      playheadIntervalMs: 1,
      playhead(value) { updates.push(value); },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 12));

  assert.deepEqual(starts, [4]);
  assert.ok(updates.length >= 1);
  assert.equal(updates[0].isPlaying, true);
  assert.equal(updates[0].timeSigNumerator, null);
  assert.equal(updates[0].timeInSeconds, null);
  assert.equal(updates[0].ppqPosition, 3.5);
  unregister();
  assert.equal(stops, 1);
  bridge.dispose();
});

test("persisted page restore restarts playhead delivery and retries WAX MIDI", () => {
  const runtime = createRuntime();
  let midiEnables = 0;
  let playheadStarts = 0;
  let playheadStops = 0;
  runtime.WAX_RequestPlayheadInfo = () => {};
  runtime.Request_PlayheadTimerStart = () => { playheadStarts += 1; };
  runtime.Request_PlayheadTimerStop = () => { playheadStops += 1; };

  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.register({
    id: "sequencer",
    enableMidi() { midiEnables += 1; },
    transport: { playhead() {} },
  });
  bridge.start();
  assert.equal(midiEnables, 1);
  assert.equal(playheadStarts, 1);

  runtime.emit("pagehide", { persisted: true });
  assert.equal(playheadStops, 1);
  runtime.emit("pageshow", { persisted: true });
  assert.equal(midiEnables, 2);
  assert.equal(playheadStarts, 2);
  bridge.dispose();
});

test("transport is routed only to the active adapter", () => {
  const runtime = createRuntime();
  const first = [];
  const second = [];
  const bridge = createWaxHostBridge(runtime, { probeDelaysMs: [] });
  bridge.register({
    id: "first",
    transport: { play: () => first.push("play"), stop: () => first.push("stop") },
  });
  bridge.register({
    id: "second",
    transport: { play: () => second.push("play"), stop: () => second.push("stop") },
  });

  bridge.handleTransport("play");
  bridge.handleTransport("stop");
  assert.deepEqual(first, []);
  assert.deepEqual(second, ["play", "stop"]);
  bridge.dispose();
});

test("playhead normalization and envelope validation are defensive", () => {
  assert.deepEqual(normalizePlayhead(null), {
    isPlaying: null,
    isRecording: null,
    isLooping: null,
    bpm: null,
    timeSigNumerator: null,
    timeSigDenominator: null,
    timeInSamples: null,
    timeInSeconds: null,
    ppqPosition: null,
    ppqPositionOfLastBarStart: null,
    ppqLoopStart: null,
    ppqLoopEnd: null,
  });
  assert.equal(validateWaxEnvelope(null), null);
  assert.equal(validateWaxEnvelope({ schema: "morphazoid-wax", pages: {} }), null);
});

test("classic bootstrap defines callbacks early and queues calls until the module loads", async () => {
  const bootstrapPath = path.join(repositoryRoot, "scripts/wax/wax-host-bootstrap.js");
  const bootstrapSource = await readFile(bootstrapPath, "utf8");
  const callbacks = [];
  let previousPlayCalls = 0;
  const windowObject = createRuntime();
  windowObject.WAX_Play = () => { previousPlayCalls += 1; };
  windowObject.document.currentScript = { src: pathToFileURL(bootstrapPath).href };
  windowObject.document.baseURI = pathToFileURL(path.join(repositoryRoot, "index.html")).href;

  const context = vm.createContext({
    URL,
    document: windowObject.document,
    window: windowObject,
  });
  const script = new vm.Script(bootstrapSource, { filename: bootstrapPath });
  script.runInContext(context);

  assert.equal(typeof windowObject.WAX_Play, "function");
  assert.equal(typeof windowObject.WAX_Stop, "function");
  assert.equal(typeof windowObject.WAX_BPM, "function");
  windowObject.WAX_BPM(117);
  windowObject.WAX_Play();
  const unregister = windowObject.MorphazoidWAX.register({
    id: "early-adapter",
    transport: {
      bpm(value) { callbacks.push(["bpm", value]); },
      play() { callbacks.push(["play"]); },
    },
  });

  const state = vm.runInContext(
    'window[Symbol.for("com.morphazoid.wax.bootstrap.v1")]',
    context,
  );
  installWaxHostBridge(windowObject, state);
  await Promise.resolve();
  assert.equal(previousPlayCalls, 1);
  assert.deepEqual(callbacks, [["bpm", 117], ["play"]]);
  assert.equal(windowObject.MorphazoidWAX.detected, true);

  unregister();
  state.implementation.dispose();
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  ConstellationAudio,
  MAX_RUNTIME_EVENT_QUEUE,
  performanceEventsForWindow,
  recordingExtension,
  recordingMimeType,
} from "../src/constellation-audio.js";
import { createPatch, projectGraphEvents } from "../src/constellation-composer.js";

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.minValue = -Infinity;
    this.maxValue = Infinity;
    this.events = [];
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(["set", value, time]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["linear", value, time]);
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["exponential", value, time]);
  }

  setTargetAtTime(value, time, constant) {
    this.value = value;
    this.events.push(["target", value, time, constant]);
  }

  cancelScheduledValues(time) {
    this.events.push(["cancel", time]);
  }
}

class FakeAudioNode {
  constructor(kind = "node") {
    this.kind = kind;
    this.connections = [];
    this.channelCount = 2;
    this.channelCountMode = "max";
    this.channelInterpretation = "speakers";
  }

  connect(destination, ...channels) {
    this.connections.push({ destination, channels });
    return destination;
  }

  disconnect(destination) {
    if (destination === undefined) this.connections = [];
    else this.connections = this.connections.filter((connection) => connection.destination !== destination);
  }
}

class FakeAnalyser extends FakeAudioNode {
  constructor(signal = {}) {
    super("analyser");
    this.signal = signal;
    this._fftSize = 2048;
    this.frequencyBinCount = 1024;
    this.minDecibels = -100;
    this.maxDecibels = -18;
    this.smoothingTimeConstant = 0;
  }

  get fftSize() { return this._fftSize; }

  set fftSize(value) {
    this._fftSize = value;
    this.frequencyBinCount = value / 2;
  }

  getFloatTimeDomainData(target) {
    const amplitude = Number.isFinite(Number(this.signal.amplitude))
      ? Number(this.signal.amplitude)
      : .2;
    for (let index = 0; index < target.length; index += 1) {
      target[index] = Math.sin((index / target.length) * Math.PI * 8) * amplitude;
    }
  }

  getFloatFrequencyData(target) {
    target.fill(this.minDecibels);
    const frequencyBin = Number.isFinite(Number(this.signal.frequencyBin))
      ? Math.max(1, Math.round(Number(this.signal.frequencyBin)))
      : 20;
    target[Math.min(target.length - 1, frequencyBin)] = -18;
    target[Math.min(target.length - 1, frequencyBin * 2)] = -30;
  }
}

class FakeMediaRecorder {
  static instances = [];

  static isTypeSupported(type) {
    return type === "audio/webm;codecs=opus" || type === "audio/webm";
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || "audio/webm";
    this.state = "inactive";
    FakeMediaRecorder.instances.push(this);
  }

  start() { this.state = "recording"; }

  requestData() {}

  stop() {
    if (this.state === "inactive") return;
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
    this.state = "inactive";
    this.onstop?.({ type: "stop" });
  }
}

function paramNode(kind, names = []) {
  const node = new FakeAudioNode(kind);
  for (const name of names) node[name] = new FakeAudioParam();
  return node;
}

function fakeRuntime({ maxChannelCount = 12, recorder = true, analyserState = {} } = {}) {
  let now = 1_000;
  class FakeAudioContext {
    constructor() {
      this.state = "suspended";
      this.currentTime = 1;
      this.sampleRate = 48_000;
      this.destination = new FakeAudioNode("destination");
      this.destination.maxChannelCount = maxChannelCount;
      this.created = [];
    }

    keep(node) {
      this.created.push(node);
      return node;
    }

    createGain() {
      const node = paramNode("gain", ["gain"]);
      node.gain.value = 1;
      return this.keep(node);
    }

    createDynamicsCompressor() {
      return this.keep(paramNode("compressor", ["threshold", "knee", "ratio", "attack", "release"]));
    }

    createBiquadFilter() {
      return this.keep(paramNode("biquad", ["frequency", "Q"]));
    }

    createDelay() { return this.keep(paramNode("delay", ["delayTime"])); }

    createConvolver() { return this.keep(new FakeAudioNode("convolver")); }

    createAnalyser() { return this.keep(new FakeAnalyser(analyserState)); }

    createChannelSplitter() { return this.keep(new FakeAudioNode("splitter")); }

    createChannelMerger(channels) {
      const node = new FakeAudioNode("merger");
      node.numberOfInputs = channels;
      return this.keep(node);
    }

    createStereoPanner() { return this.keep(paramNode("stereo-panner", ["pan"])); }

    createOscillator() {
      const node = paramNode("oscillator", ["frequency", "detune"]);
      node.type = "sine";
      node.start = (time) => { node.startedAt = time; };
      node.stop = (time) => { node.stoppedAt = time; };
      return this.keep(node);
    }

    createBufferSource() {
      const node = paramNode("buffer-source", ["playbackRate"]);
      node.start = (time) => { node.startedAt = time; };
      node.stop = (time) => { node.stoppedAt = time; };
      return this.keep(node);
    }

    createBuffer(channels, frames, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      return {
        numberOfChannels: channels,
        length: frames,
        sampleRate,
        getChannelData: (channel) => data[channel],
      };
    }

    createMediaStreamDestination() {
      const track = { stopped: false, stop() { this.stopped = true; } };
      const node = new FakeAudioNode("media-stream-destination");
      node.stream = { getTracks: () => [track], track };
      return this.keep(node);
    }

    async resume() { this.state = "running"; }

    async close() { this.state = "closed"; }
  }
  return {
    AudioContext: FakeAudioContext,
    ...(recorder ? { MediaRecorder: FakeMediaRecorder } : {}),
    Blob,
    performance: { now: () => now += 40 },
  };
}

function outputOnlyPatch(params = {}) {
  return {
    id: "output-test",
    rootGraphId: "root",
    selectedGraphId: "root",
    tempo: 120,
    graphs: [{
      id: "root",
      label: "Root",
      kind: "routing",
      interface: [],
      nodes: [{
        id: "out",
        type: "primitive",
        primitiveId: "surround-output",
        label: "Output",
        params,
      }],
      edges: [],
    }],
  };
}

function amplitudeConverterPatch(params = {}) {
  return {
    id: "amplitude-runtime-test",
    rootGraphId: "root",
    selectedGraphId: "root",
    tempo: 120,
    graphs: [{
      id: "root",
      label: "Root",
      kind: "routing",
      interface: [],
      nodes: [{
        id: "gate",
        type: "primitive",
        primitiveId: "amplitude-to-midi",
        label: "Amplitude gate",
        params,
      }],
      edges: [],
    }],
  };
}

function frequencyConverterPatch(params = {}) {
  return {
    id: "frequency-runtime-test",
    rootGraphId: "root",
    selectedGraphId: "root",
    tempo: 120,
    graphs: [{
      id: "root",
      label: "Root",
      kind: "routing",
      interface: [],
      nodes: [
        {
          id: "tracker",
          type: "primitive",
          primitiveId: "frequency-tracker",
          label: "Tracker",
        },
        {
          id: "converter",
          type: "primitive",
          primitiveId: "frequency-to-midi",
          label: "Pitch MIDI",
          params,
        },
      ],
      edges: [{
        id: "tracked-frequency",
        signal: "control",
        from: { nodeId: "tracker", portId: "control-out" },
        to: { nodeId: "converter", portId: "control-in" },
      }],
    }],
  };
}

function projectedFrequencyConverterPatch(params = {}) {
  const patch = frequencyConverterPatch(params);
  patch.graphs[0].nodes = patch.graphs[0].nodes.filter(({ id }) => id === "converter");
  patch.graphs[0].edges = [];
  return patch;
}

const projectedEvents = Object.freeze([
  Object.freeze({ id: "control:0", beat: 0, signal: "control", playable: false, value: 0.2 }),
  Object.freeze({ id: "drums:0", beat: 0, signal: "trigger", playable: true, address: "patch/drums/voice", note: 48 }),
  Object.freeze({ id: "trace:1", beat: 1, signal: "trigger", playable: false, address: "patch/clock/out" }),
  Object.freeze({ id: "bass:1", beat: 1, signal: "trigger", playable: true, address: "patch/bass/voice", note: 36 }),
  Object.freeze({ id: "control:2", beat: 2, signal: "control", playable: false, value: 0.8 }),
  Object.freeze({ id: "drums:2", beat: 2, signal: "trigger", playable: true, address: "patch/drums/voice", note: 50 }),
  Object.freeze({ id: "bass:3", beat: 3, signal: "trigger", playable: true, address: "patch/bass/voice", note: 43 }),
  Object.freeze({ id: "drums:4", beat: 4, signal: "trigger", playable: true, address: "patch/drums/voice", note: 48 }),
]);

test("performance windows consume graph-projected playable events", () => {
  const result = performanceEventsForWindow({ events: projectedEvents }, 0, 4);
  assert.deepEqual(result.map(({ id }) => id), ["drums:0", "bass:1", "drums:2", "bass:3"]);
  assert.equal(result.every(({ playable }) => playable), true);
});

test("performance windows are half-open and preserve event identity across slices", () => {
  const first = performanceEventsForWindow(projectedEvents, 0, 2);
  const second = performanceEventsForWindow(projectedEvents, 2, 4);

  assert.deepEqual(first.map(({ id }) => id), ["drums:0", "bass:1"]);
  assert.deepEqual(second.map(({ id }) => id), ["drums:2", "bass:3"]);
  assert.equal(new Set([...first, ...second].map(({ id }) => id)).size, 4);
  assert.equal(first[0], projectedEvents[1], "windowing preserves the projected event object");
});

test("control events are opt-in and remain ordered with playable triggers", () => {
  assert.deepEqual(
    performanceEventsForWindow(projectedEvents, 0, 3).map(({ id }) => id),
    ["drums:0", "bass:1", "drums:2"],
  );
  assert.deepEqual(
    performanceEventsForWindow(projectedEvents, 0, 3, { includeControl: true }).map(({ id }) => id),
    ["control:0", "drums:0", "bass:1", "control:2", "drums:2"],
  );
});

test("non-playable MIDI sink events are opt-in for the shared performance scheduler", () => {
  const midi = { id: "midi:1", beat: .25, signal: "midi", playable: false, note: 64, velocity: .8 };
  const source = [midi, ...projectedEvents];
  assert.equal(performanceEventsForWindow(source, 0, 1).includes(midi), false);
  assert.equal(performanceEventsForWindow(source, 0, 1, { includeMidi: true }).includes(midi), true);
});

test("performance event windows remain bounded under dense projections", () => {
  const dense = Array.from({ length: 2_000 }, (_, index) => ({
    id: `dense:${String(index).padStart(4, "0")}`,
    beat: index / 64,
    signal: "trigger",
    playable: true,
  }));
  const events = performanceEventsForWindow({ events: dense }, 0, 32, { maximum: 37 });
  assert.equal(events.length, 37);
  assert.deepEqual(events.map(({ beat }) => beat), dense.slice(0, 37).map(({ beat }) => beat));
});

test("zero-velocity playable events are silent while zero-valued control remains observable", () => {
  const source = [
    { id: "silent-note", beat: 0, signal: "trigger", playable: true, velocity: 0 },
    { id: "audible-note", beat: 0.5, signal: "trigger", playable: true, velocity: 0.01 },
    { id: "zero-control", beat: 0.75, signal: "control", playable: false, value: 0, velocity: 0 },
  ];

  assert.deepEqual(
    performanceEventsForWindow(source, 0, 1).map(({ id }) => id),
    ["audible-note"],
  );
  assert.deepEqual(
    performanceEventsForWindow(source, 0, 1, { includeControl: true }).map(({ id }) => id),
    ["audible-note", "zero-control"],
  );
});

test("direct zero-velocity triggers skip before starting an AudioContext", async () => {
  let contextStarts = 0;
  class UnexpectedAudioContext {
    constructor() {
      contextStarts += 1;
      throw new Error("silent events must not start Web Audio");
    }
  }
  const audio = new ConstellationAudio({ AudioContext: UnexpectedAudioContext });
  const result = await audio.trigger({
    id: "direct-silent-note",
    signal: "trigger",
    playable: true,
    velocity: 0,
  });

  assert.deepEqual(result, { scheduled: false, skipped: true, reason: "silent" });
  assert.equal(contextStarts, 0);
  assert.equal(audio.context, null);
  assert.equal(audio.started, false);
});

test("recording helpers negotiate a browser-supported compressed container", () => {
  const runtime = fakeRuntime();
  assert.equal(recordingMimeType(runtime), "audio/webm;codecs=opus");
  assert.equal(recordingExtension("audio/webm;codecs=opus"), "webm");
  assert.equal(recordingExtension("audio/ogg;codecs=opus"), "ogg");
  assert.equal(recordingExtension("audio/mp4"), "m4a");
  assert.equal(recordingMimeType({}), "");
});

test("output-node params select discrete surround and report the active layout", async () => {
  const runtime = fakeRuntime({ maxChannelCount: 12 });
  const audio = new ConstellationAudio(runtime);
  audio.setPatch(outputOnlyPatch({
    layoutId: "7-4-1",
    customCount: 10,
    position: { x: .25, y: -.2, z: .4 },
    focus: .7,
  }));

  assert.equal(audio.outputCapabilities().layoutId, "7-4-1", "setPatch configures output before audio starts");
  await audio.start();
  const capabilities = audio.outputCapabilities();
  assert.equal(capabilities.mode, "discrete");
  assert.equal(capabilities.layoutName, "7:4:1");
  assert.equal(capabilities.layout.channels, 12);
  assert.equal(capabilities.virtualChannels, 12);
  assert.equal(capabilities.deviceChannels, 12);
  assert.deepEqual(capabilities.position, { x: .25, y: -.2, z: .4 });
  await audio.close();
});

test("surround output falls back to a safe stereo preview and supports preset aliases", async () => {
  const runtime = fakeRuntime({ maxChannelCount: 2 });
  const audio = new ConstellationAudio(runtime);
  audio.setPatch(outputOnlyPatch({ layoutId: "quad" }));
  await audio.start();
  assert.equal(audio.outputCapabilities().mode, "stereo-preview");
  assert.equal(audio.outputCapabilities().virtualChannels, 4);

  audio.configureOutput({ layoutId: "5-1", forceStereo: true });
  assert.equal(audio.outputCapabilities().layoutName, "5.1");
  assert.equal(audio.outputCapabilities().virtualChannels, 6);
  assert.equal(audio.outputCapabilities().mode, "stereo-preview");

  audio.configureOutput({ layoutId: "binaural", forceStereo: false });
  assert.equal(audio.outputCapabilities().layoutId, "binaural");
  assert.equal(audio.outputCapabilities().mode, "stereo-preview");
  await audio.close();
});

test("monitor snapshots expose mix telemetry plus stable graph-node and address indexes", async () => {
  const runtime = fakeRuntime({ maxChannelCount: 2 });
  const audio = new ConstellationAudio(runtime);
  const patch = createPatch("composer-studio");
  audio.setPatch(patch);
  await audio.start();

  const first = audio.getMonitorSnapshot({ force: true });
  assert.equal(first.waveform instanceof Float32Array, true);
  assert.equal(first.waveform.length, 128);
  assert.equal(first.spectrum.length, 64);
  assert.equal(first.rms > 0, true);
  assert.equal(first.peak > first.rms, true);
  assert.equal(first.dominantFrequencyHz > 0, true);
  assert.deepEqual(Object.keys(first.bands), ["sub", "bass", "lowMid", "mid", "presence", "air"]);
  const records = Object.values(first.nodes);
  assert.equal(records.length > 0, true);
  assert.equal(records.some(({ primitiveId }) => primitiveId === "scope"), true);
  assert.equal(records.some(({ role }) => role === "subgraph-output"), true);
  for (const record of records) {
    assert.equal(first.byAddress[record.address], record);
    assert.equal(record.waveform.length, 64);
    assert.equal(record.spectrum.length, 32);
  }

  const second = audio.getMonitorSnapshot({ force: true });
  assert.equal(Object.keys(second.controls).length > 0, true, "analysis control edges produce numeric telemetry");
  await audio.close();
});

test("live amplitude conversion emits Schmitt-gated MIDI open and close transitions", async () => {
  const analyserState = { amplitude: .4, frequencyBin: 19 };
  const audio = new ConstellationAudio(fakeRuntime({ analyserState }));
  audio.setPatch(amplitudeConverterPatch({
    note: 45,
    channel: 9,
    openThreshold: .2,
    closeThreshold: .1,
  }));
  await audio.start();

  audio.getMonitorSnapshot({ force: true });
  const [opened] = audio.drainRuntimeEvents();
  assert.ok(opened);
  assert.equal(opened.midi.type, "noteOn");
  assert.deepEqual(opened.message, opened.midi);
  assert.equal(opened.note, 45);
  assert.equal(opened.channel, 9);
  assert.equal(opened.velocity > 0, true);
  assert.equal(opened.value > .2, true);
  assert.equal(opened.address, "root/gate");
  assert.equal(opened.sourceAddress, "root/gate");
  assert.equal(opened.graphId, "root");
  assert.equal(opened.nodeId, "gate");
  assert.equal(opened.primitiveId, "amplitude-to-midi");
  assert.equal(opened.monitorAddress, "root/gate");
  assert.equal(Number.isFinite(opened.timestamp), true);

  analyserState.amplitude = .2;
  audio.getMonitorSnapshot({ force: true });
  assert.deepEqual(audio.drainRuntimeEvents(), [], "the hysteresis band holds the note open");

  analyserState.amplitude = .05;
  audio.getMonitorSnapshot({ force: true });
  const [closed] = audio.drainRuntimeEvents();
  assert.equal(closed.midi.type, "noteOff");
  assert.equal(closed.note, 45);
  assert.equal(closed.velocity, 0);
  assert.equal(closed.value < .1, true);
  await audio.close();
});

test("frequency tracker generic control output drives live MIDI note transitions from measured Hz", async () => {
  const analyserState = { amplitude: .3, frequencyBin: 19 };
  const audio = new ConstellationAudio(fakeRuntime({ analyserState }));
  audio.setPatch(frequencyConverterPatch({
    channel: 2,
    minimumHz: 20,
    maximumHz: 20_000,
  }));
  await audio.start();

  audio.getMonitorSnapshot({ force: true });
  const [first] = audio.drainRuntimeEvents();
  assert.equal(first.midi.type, "noteOn");
  assert.equal(first.note, 69, "FFT bin 19 at 48 kHz / 2048 maps close to concert A");
  assert.equal(first.channel, 2);
  assert.equal(first.frequencyHz, 445.3125);
  assert.equal(first.monitorAddress, "root/tracker");

  analyserState.frequencyBin = 38;
  audio.getMonitorSnapshot({ force: true });
  const changed = audio.drainRuntimeEvents();
  assert.deepEqual(changed.map(({ midi }) => midi.type), ["noteOff", "noteOn"]);
  assert.deepEqual(changed.map(({ note }) => note), [69, 81]);

  audio.getMonitorSnapshot({ force: true });
  assert.deepEqual(audio.drainRuntimeEvents(), [], "an unchanged quantized note is deduplicated");
  await audio.close();
});

test("projected frequency control values do not duplicate into the live runtime queue", async () => {
  const audio = new ConstellationAudio(fakeRuntime());
  audio.setPatch(projectedFrequencyConverterPatch({
    channel: 1,
    minimumHz: 55,
    maximumHz: 1_760,
  }));
  await audio.trigger({
    id: "projected:lfo:0",
    signal: "control",
    address: "root/converter",
    source: "source:event",
    value: .5,
  });
  audio.getMonitorSnapshot({ force: true });
  assert.deepEqual(audio.drainRuntimeEvents(), []);
  await audio.close();
});

test("live runtime event storage and draining stay bounded and reset with graph lifecycle", async () => {
  const analyserState = { amplitude: .4 };
  const audio = new ConstellationAudio(fakeRuntime({ analyserState }));
  const patch = amplitudeConverterPatch({
    note: 60,
    channel: 0,
    openThreshold: .2,
    closeThreshold: .1,
  });
  audio.setPatch(patch);
  await audio.start();

  const transitionCount = MAX_RUNTIME_EVENT_QUEUE + 31;
  for (let index = 0; index < transitionCount; index += 1) {
    analyserState.amplitude = index % 2 ? .02 : .4;
    audio.getMonitorSnapshot({ force: true });
  }
  const first = audio.drainRuntimeEvents({ maximum: 7 });
  const rest = audio.drainRuntimeEvents();
  assert.equal(first.length, 7);
  assert.equal(rest.length, MAX_RUNTIME_EVENT_QUEUE - 7);
  assert.match(first[0].id, /^runtime-midi:31:/, "the bounded queue drops its oldest transitions");
  assert.deepEqual(audio.drainRuntimeEvents(), []);

  analyserState.amplitude = .4;
  audio.setPatch(amplitudeConverterPatch(patch.graphs[0].nodes[0].params));
  assert.deepEqual(audio.drainRuntimeEvents(), [], "recompiling drops obsolete queued events");
  audio.getMonitorSnapshot({ force: true });
  assert.equal(audio.drainRuntimeEvents().length, 1, "recompiling also resets gate state");

  analyserState.amplitude = .02;
  audio.getMonitorSnapshot({ force: true });
  await audio.close();
  assert.deepEqual(audio.drainRuntimeEvents(), [], "close clears any pending runtime events");
});

test("stereo mix and selected stem recording produce downloadable takes", async () => {
  FakeMediaRecorder.instances.length = 0;
  const runtime = fakeRuntime();
  const audio = new ConstellationAudio(runtime);
  audio.setPatch(createPatch("pulse-cascade"));
  await audio.start();
  assert.equal(audio.recordingCapabilities().supported, true);

  const stems = audio.listRecordableStems();
  assert.equal(stems.length >= 2, true);
  const recording = await audio.startRecording({ mode: "stems", stemIds: [stems[0].id] });
  assert.equal(recording.active, true);
  assert.equal(recording.takeCount, 1);

  audio.setPatch(createPatch("pulse-cascade"));
  assert.equal(audio.recordingState().active, true, "safe graph recompilation keeps MediaRecorder alive");
  const stemResult = await audio.stopRecording();
  assert.equal(stemResult.mode, "stems");
  assert.equal(stemResult.takes.length, 1);
  assert.equal(stemResult.takes[0].blob instanceof Blob, true);
  assert.equal(stemResult.takes[0].blob.size > 0, true);
  assert.equal(stemResult.takes[0].extension, "webm");

  await audio.startRecording({ mode: "mix" });
  const mixResult = await audio.stopRecording();
  assert.equal(mixResult.takes.length, 1);
  assert.equal(mixResult.takes[0].sourceId, "mix");
  assert.equal(audio.recordingState().active, false);
  const captureDestinations = audio.context.created.filter(({ kind }) => kind === "media-stream-destination");
  assert.equal(captureDestinations.every(({ stream }) => stream.track.stopped), true);
  await audio.close();
});

test("stem choices prefer explicit stem taps and retain unmarked playable sound graphs", async () => {
  const audio = new ConstellationAudio(fakeRuntime());
  audio.setPatch(createPatch("composer-studio"));
  await audio.start();

  const stems = audio.listRecordableStems();
  assert.deepEqual(
    stems.map(({ label }) => label),
    ["Hiccup stereo stem", "303 stereo stem", "Graph Synth"],
  );
  assert.equal(stems.some(({ label }) => label === "Stereo master recorder"), false, "mix recorders are not stems");
  assert.equal(stems.some(({ primitiveId }) => primitiveId === "hiccup-head"), false, "an explicit tap replaces its raw sound branch");
  assert.equal(stems.some(({ primitiveId }) => primitiveId === "webgpu-303"), false, "each marked branch appears only once");
  assert.equal(stems.find(({ label }) => label === "Graph Synth")?.primitiveId, "graph-synth");

  await audio.close();
});

test("automatic sound stems remain bounded to sixteen", async () => {
  const patch = createPatch("composer-studio");
  const root = patch.graphs.find(({ id }) => id === patch.rootGraphId);
  const synth = root.nodes.find(({ id }) => id === "synth");
  root.nodes = Array.from({ length: 20 }, (_, index) => ({
    ...structuredClone(synth),
    id: `synth-${index + 1}`,
    label: `Graph Synth ${index + 1}`,
  }));
  root.edges = [];

  const audio = new ConstellationAudio(fakeRuntime());
  audio.setPatch(patch);
  await audio.start();
  assert.equal(audio.listRecordableStems().length, 16);
  await audio.close();
});

test("recording capability checks fail closed without MediaRecorder", () => {
  const audio = new ConstellationAudio(fakeRuntime({ recorder: false }));
  assert.equal(audio.recordingCapabilities().supported, false);
  assert.equal(audio.recordingCapabilities().multichannel, false);
});

test("Hiccup Head and WebGPU 303 receive distinct lightweight preview engines", async () => {
  const runtime = fakeRuntime();
  const audio = new ConstellationAudio(runtime);
  const patch = createPatch("composer-studio");
  audio.setPatch(patch);
  const projection = projectGraphEvents(patch, { durationBeats: patch.cycleBeats });
  const hiccup = projection.events.find(({ instrumentType }) => instrumentType === "hiccup-head");
  const acid = projection.events.find(({ instrumentType }) => instrumentType === "webgpu-303");
  assert.ok(hiccup);
  assert.ok(acid);

  const hiccupResult = await audio.trigger(hiccup, { secondsPerBeat: .5 });
  const acidResult = await audio.trigger(acid, { secondsPerBeat: .5 });
  assert.equal(hiccupResult.previewEngine, "hiccup-head");
  assert.equal(acidResult.previewEngine, "webgpu-303");
  const oscillators = audio.context.created.filter(({ kind }) => kind === "oscillator");
  const filters = audio.context.created.filter(({ kind }) => kind === "biquad");
  assert.equal(oscillators.length >= 2, true);
  assert.equal(filters.some(({ type }) => type === "bandpass"), true);
  assert.equal(filters.some(({ type, Q }) => type === "lowpass" && Number(Q?.value) >= 8), true);
  await audio.close();
});

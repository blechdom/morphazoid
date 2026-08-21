import assert from "node:assert/strict";
import test from "node:test";

import {
  VOCALZOID_MAX_BANK_BYTES,
  VOCALZOID_MAX_BANK_FILES,
  VocalzoidAudio,
} from "../src/vocalzoid-audio.js";
import { SPELLING_DIPHONE_CLIPS } from "../src/spelling-diphone-atlas.js";
import { parseUtauOto } from "../src/vocalzoid.js";

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

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["exponentialRampToValueAtTime", value, time]);
  }

  setValueCurveAtTime(curve, time, duration) {
    this.value = curve.at(-1);
    this.events.push(["setValueCurveAtTime", curve, time, duration]);
  }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.connections = [];
    this.disconnections = [];
  }

  connect(destination, output, input) {
    this.connections.push({ destination, output, input });
    return destination;
  }

  disconnect(destination) {
    this.disconnections.push(destination);
  }
}

class FakeGain extends FakeNode {
  constructor() {
    super("gain");
    this.gain = new FakeAudioParam(1);
  }
}

class FakeFilter extends FakeNode {
  constructor() {
    super("biquad");
    this.type = "lowpass";
    this.frequency = new FakeAudioParam(350);
    this.Q = new FakeAudioParam(1);
    this.gain = new FakeAudioParam(0);
  }
}

class FakeCompressor extends FakeNode {
  constructor() {
    super("compressor");
    this.threshold = new FakeAudioParam(-24);
    this.knee = new FakeAudioParam(30);
    this.ratio = new FakeAudioParam(12);
    this.attack = new FakeAudioParam(0.003);
    this.release = new FakeAudioParam(0.25);
  }
}

class FakeAnalyser extends FakeNode {
  constructor() {
    super("analyser");
    this.fftSize = 256;
    this.smoothingTimeConstant = 0;
  }

  getFloatTimeDomainData(target) {
    target.fill(0);
  }

  getByteFrequencyData(target) {
    target.fill(7);
  }
}

class FakeBufferSource extends FakeNode {
  constructor() {
    super("buffer-source");
    this.buffer = null;
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.playbackRate = new FakeAudioParam(1);
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }

  start(time = 0, offset, duration) {
    this.starts.push({ time, offset, duration });
  }

  stop(time = 0) {
    this.stops.push(time);
  }
}

class FakeAudioContext {
  static instances = [];

  constructor(options = {}) {
    this.options = options;
    this.currentTime = 1;
    this.sampleRate = 48_000;
    this.state = "suspended";
    this.destination = new FakeNode("destination");
    this.gains = [];
    this.filters = [];
    this.compressors = [];
    this.analysers = [];
    this.sources = [];
    this.decodeCalls = [];
    this.decodedBuffers = [];
    this.resumeCount = 0;
    this.suspendCount = 0;
    this.closeCount = 0;
    FakeAudioContext.instances.push(this);
  }

  createBuffer(numberOfChannels, length, sampleRate) {
    return { kind: "unlock", numberOfChannels, length, sampleRate, duration: length / sampleRate };
  }

  createBufferSource() {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBiquadFilter() {
    const filter = new FakeFilter();
    this.filters.push(filter);
    return filter;
  }

  createDynamicsCompressor() {
    const compressor = new FakeCompressor();
    this.compressors.push(compressor);
    return compressor;
  }

  createAnalyser() {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser;
  }

  decodeAudioData(bytes, onSuccess) {
    this.decodeCalls.push(bytes);
    const index = this.decodedBuffers.length;
    const buffer = {
      kind: index === 0 ? "atlas" : "bank",
      duration: index === 0 ? 12 : 1.2,
      bytes,
    };
    this.decodedBuffers.push(buffer);
    onSuccess?.(buffer);
    return Promise.resolve(buffer);
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
  FakeAudioContext.instances.length = 0;
  const fetches = [];
  return {
    AudioContext: FakeAudioContext,
    async fetch(url) {
      fetches.push(String(url));
      return {
        ok: true,
        async arrayBuffer() {
          return new ArrayBuffer(32);
        },
      };
    },
    fetches,
  };
}

function atlasSources(context) {
  return context.sources.filter(({ buffer }) => buffer?.kind === "atlas");
}

function bankSources(context) {
  return context.sources.filter(({ buffer }) => buffer?.kind === "bank");
}

async function waitForMicrotasks(predicate, message) {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

test("Vocalzoid audio starts lazily, configures its output graph, and reuses the atlas", async () => {
  const runtime = fakeRuntime();
  const audio = new VocalzoidAudio({ runtime, level: 0.4, style: "glass" });

  assert.equal(FakeAudioContext.instances.length, 0);
  assert.equal(audio.running, false);
  await audio.enable();

  const [context] = FakeAudioContext.instances;
  assert.equal(context.options.latencyHint, "interactive");
  assert.equal(context.state, "running");
  assert.equal(audio.running, true);
  assert.equal(runtime.fetches.length, 1);
  assert.match(runtime.fetches[0], /spelling-diphone-kal16\.wav$/);
  assert.equal(context.decodeCalls.length, 1);
  assert.deepEqual(context.filters.map(({ type }) => type), ["highpass", "peaking", "lowpass"]);
  assert.equal(context.compressors[0].ratio.value, 7);
  assert.equal(audio.highpass.frequency.value, 105);
  assert.equal(audio.presence.gain.value, 4.2);
  assert.equal(audio.lowpass.frequency.value, 12_800);
  assert.equal(audio.master.gain.value, 0.4);

  assert.equal(audio.setStyle("velvet").id, "velvet");
  assert.equal(audio.highpass.frequency.value, 45);
  assert.equal(audio.lowpass.frequency.value, 5_800);
  assert.equal(audio.setLevel(99), 0.86);
  const bins = new Uint8Array(8);
  assert.equal(audio.spectrum(bins), true);
  assert.deepEqual([...bins], Array(8).fill(7));

  await audio.disable();
  assert.equal(context.state, "suspended");
  await audio.enable();
  assert.equal(runtime.fetches.length, 1, "resume keeps the already decoded atlas");
  await audio.close();
  assert.equal(context.state, "closed");
  assert.equal(audio.running, false);
});

test("built-in playback schedules pitched phone slices, vowel loops, and a bounded stop", async () => {
  const runtime = fakeRuntime();
  const audio = new VocalzoidAudio({ runtime, style: "raw" });
  const note = {
    id: "note-a",
    lyric: "a",
    alias: "",
    phones: ["AE"],
    start: 0,
    duration: 1,
    midi: 55,
  };

  const playback = await audio.play([note], {
    bpm: 120,
    vibratoCents: 0,
    glideMs: 60,
  });
  const [context] = FakeAudioContext.instances;
  const [source] = atlasSources(context);
  const clip = SPELLING_DIPHONE_CLIPS.a;

  assert.equal(playback.duration, 0.5);
  assert.equal(playback.customNotes, 0);
  assert.equal(playback.fallbackNotes, 0);
  assert.equal(source.loop, true);
  assert.equal(source.loopStart, clip.offset + clip.sustainStart);
  assert.equal(source.loopEnd, clip.offset + clip.sustainEnd);
  assert.equal(source.starts[0].time, playback.startedAt);
  assert.equal(source.starts[0].offset, clip.offset);
  assert.equal(source.stops[0], playback.startedAt + 0.536 + 0.006);
  assert.ok(source.playbackRate.events.some(([method, value]) => (
    method === "exponentialRampToValueAtTime" && value === 2
  )));

  assert.equal(audio.stop({ fadeMs: 20 }), true);
  assert.equal(source.stops.at(-1), context.currentTime + 0.02);
  await audio.close();
});

test("custom OTO samples decode once and preserve pitch, slice, loop, and pickup timing", async () => {
  const runtime = fakeRuntime();
  const audio = new VocalzoidAudio({ runtime });
  await audio.enable();
  const [entry] = parseUtauOto("samples\\la.wav=la,50,100,-500,100,20");
  const sample = {
    name: "la.wav",
    size: 64,
    async arrayBuffer() {
      return new ArrayBuffer(64);
    },
  };
  audio.setBank({
    name: "Test bank",
    entries: [entry],
    files: new Map([["BANK/SAMPLES/LA.WAV", sample]]),
    sourceMidiByPath: new Map([["bank/samples/la.wav", 60]]),
    rootMidi: 48,
  });
  const note = {
    id: "note-la",
    lyric: "la",
    alias: "",
    phones: ["L", "AA"],
    start: 1,
    duration: 1,
    midi: 60,
  };

  const first = await audio.play([note], { bpm: 120, vibratoCents: 0, glideMs: 60 });
  const [context] = FakeAudioContext.instances;
  const [source] = bankSources(context);
  assert.equal(first.customNotes, 1);
  assert.equal(first.fallbackNotes, 0);
  assert.equal(source.starts[0].time, first.startedAt + 0.5 - 0.1);
  assert.equal(source.starts[0].offset, 0.05);
  assert.equal(source.loop, true);
  assert.ok(Math.abs(source.loopStart - 0.15) < 1e-12);
  assert.ok(Math.abs(source.loopEnd - 0.546) < 1e-12);
  assert.equal(source.stops[0], source.starts[0].time + 0.6 + 0.008);

  await audio.play([note], { bpm: 120, vibratoCents: 0, glideMs: 60 });
  assert.equal(context.decodeCalls.length, 2, "the atlas and one bank sample are each decoded once");
  await audio.close();
});

test("local samples decode serially and a corrupt sample falls back without replacing good notes", async () => {
  const runtime = fakeRuntime();
  const audio = new VocalzoidAudio({ runtime });
  await audio.enable();
  const [context] = FakeAudioContext.instances;
  const pendingDecodes = [];
  const fileReads = [];
  context.decodeAudioData = (bytes) => new Promise((resolve, reject) => {
    pendingDecodes.push({ bytes, resolve, reject });
  });

  const entries = parseUtauOto(`
good.wav=good,0,80,-500,0,12
bad.wav=bad,0,80,-500,0,12
`);
  const sampleFile = (name, marker) => ({
    name,
    size: 1,
    async arrayBuffer() {
      fileReads.push(name);
      return Uint8Array.of(marker).buffer;
    },
  });
  audio.setBank({
    name: "Mixed bank",
    entries,
    files: new Map([
      ["good.wav", sampleFile("good.wav", 1)],
      ["bad.wav", sampleFile("bad.wav", 2)],
    ]),
    rootMidi: 60,
  });
  const notes = [
    {
      id: "good-note",
      lyric: "good",
      alias: "good",
      phones: ["AA"],
      start: 0,
      duration: 1,
      midi: 60,
    },
    {
      id: "bad-note",
      lyric: "bad",
      alias: "bad",
      phones: ["AE"],
      start: 1,
      duration: 1,
      midi: 60,
    },
  ];

  const playbackPromise = audio.play(notes, {
    bpm: 120,
    vibratoCents: 0,
    glideMs: 0,
  });
  await waitForMicrotasks(
    () => pendingDecodes.length === 1,
    "the first local sample decode should start",
  );
  assert.deepEqual(fileReads, ["good.wav"], "the second file waits for the first decode");
  assert.equal(pendingDecodes.length, 1, "only one decode is in flight");

  pendingDecodes[0].resolve({
    kind: "bank",
    duration: 1.2,
    length: 57_600,
    numberOfChannels: 1,
  });
  await waitForMicrotasks(
    () => pendingDecodes.length === 2,
    "the second decode should start after the first settles",
  );
  assert.deepEqual(fileReads, ["good.wav", "bad.wav"]);
  pendingDecodes[1].reject(new Error("corrupt WAV"));

  const playback = await playbackPromise;
  assert.equal(playback.customNotes, 1);
  assert.equal(playback.fallbackNotes, 1);
  assert.equal(bankSources(context).length, 1, "the valid note keeps its local sample");
  assert.equal(atlasSources(context).length, 1, "only the corrupt note uses KAL16");
  assert.equal(audio.bank.decoded.has("good.wav"), true);
  assert.equal(audio.bank.decoded.has("bad.wav"), false, "failed decodes are not cached");
  await audio.close();
});

test("voicebank installation normalizes paths and enforces declared browser limits", () => {
  const audio = new VocalzoidAudio({ runtime: {} });
  const bank = audio.setBank({
    files: new Map([["Voices\\A.WAV", { size: 12 }]]),
    entries: [],
    sourceMidiByPath: new Map([["Voices\\A.WAV", 61]]),
  });
  assert.equal(bank.files.has("voices/a.wav"), true);
  assert.equal(bank.sourceMidiByPath.get("voices/a.wav"), 61);

  const tooMany = new Map(Array.from(
    { length: VOCALZOID_MAX_BANK_FILES + 1 },
    (_, index) => [`sample-${index}.wav`, { size: 0 }],
  ));
  assert.throws(
    () => audio.setBank({ files: tooMany }),
    /more than 12,000 files/,
  );
  assert.throws(
    () => audio.setBank({ files: new Map([["huge.wav", { size: VOCALZOID_MAX_BANK_BYTES + 1 }]]) }),
    /larger than the 512 MB/,
  );
});

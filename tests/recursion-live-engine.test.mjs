import assert from "node:assert/strict";
import test from "node:test";

import { RecursiveAudioEngine } from "../src/recursion-audio-engine.js";
import {
  LIVE_DEFAULTS,
  normalizeLiveAxes,
} from "../src/recursion-live.js";
import { MOTION_CAPS } from "../src/recursion-motion.js";

const EPSILON = 1e-6;

function approximately(actual, expected, tolerance = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function arraysApproximately(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= EPSILON,
      `${message}: index ${index} changed from ${expected[index]} to ${actual[index]}`,
    );
  }
}

function audioParam(value = 0) {
  return {
    value,
    calls: [],
    cancelScheduledValues(time) {
      this.calls.push(["cancel", time]);
    },
    exponentialRampToValueAtTime(next, time) {
      this.value = next;
      this.calls.push(["exponential", next, time]);
    },
    linearRampToValueAtTime(next, time) {
      this.value = next;
      this.calls.push(["linear", next, time]);
    },
    setTargetAtTime(next, time, constant) {
      this.value = next;
      this.calls.push(["target", next, time, constant]);
    },
    setValueAtTime(next, time) {
      this.value = next;
      this.calls.push(["value", next, time]);
    },
  };
}

function audioNode(properties = {}) {
  return {
    connections: [],
    ...properties,
    connect(destination) {
      this.connections.push(destination);
      return destination;
    },
    disconnect() {
      this.disconnected = true;
    },
  };
}

function fakeContext() {
  const delays = [];
  const sources = [];
  const gains = [];
  const filters = [];
  const oscillators = [];
  const panners = [];
  const context = {
    currentTime: 1,
    sampleRate: 48_000,
    createGain() {
      const gain = audioNode({ gain: audioParam(1) });
      gains.push(gain);
      return gain;
    },
    createBiquadFilter() {
      const filter = audioNode({
        type: "lowpass",
        frequency: audioParam(1_000),
        Q: audioParam(1),
        gain: audioParam(0),
      });
      filters.push(filter);
      return filter;
    },
    createStereoPanner() {
      const panner = audioNode({ pan: audioParam(0) });
      panners.push(panner);
      return panner;
    },
    createDelay() {
      const delay = audioNode({ delayTime: audioParam(0) });
      delays.push(delay);
      return delay;
    },
    createOscillator() {
      const oscillator = audioNode({
        type: "sine",
        frequency: audioParam(1),
        start(...args) {
          this.startArgs = args;
        },
        stop(...args) {
          this.stopArgs = args;
        },
      });
      oscillators.push(oscillator);
      return oscillator;
    },
    createBufferSource() {
      const source = audioNode({
        buffer: null,
        onended: null,
        playbackRate: audioParam(1),
        start(...args) {
          this.startArgs = args;
        },
        stop(...args) {
          this.stopArgs = args;
        },
      });
      sources.push(source);
      return source;
    },
  };
  return {
    context,
    delays,
    filters,
    gains,
    oscillators,
    panners,
    sources,
  };
}

function fakeBuffer(duration = 10, sampleRate = 1_000) {
  const length = Math.round(duration * sampleRate);
  const channels = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  return {
    duration,
    length,
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData(channel) {
      return channels[channel];
    },
  };
}

function configuredEngine(maximumDepth = 4) {
  const fake = fakeContext();
  const engine = new RecursiveAudioEngine();
  engine.context = fake.context;
  engine.master = audioNode();
  engine.sessionBus = audioNode({ gain: audioParam(1) });
  engine.sessionTone = fake.context.createBiquadFilter();
  engine.prepared = {
    parameters: { depth: maximumDepth },
    motionBufferCache: new Map(),
  };
  engine.liveAxes = normalizeLiveAxes(LIVE_DEFAULTS);
  return { engine, ...fake };
}

test("absolute live-axis moves always resolve from immutable voice anchors", () => {
  const {
    engine,
    context,
  } = configuredEngine();
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const panner = context.createStereoPanner();
  source.playbackRate.value = 3;
  filter.frequency.value = 14_000;
  filter.Q.value = 12;
  panner.pan.value = 0.8;
  const anchors = {
    playbackRate: source.playbackRate.value,
    frequency: filter.frequency.value,
    q: filter.Q.value,
    pan: panner.pan.value,
  };
  engine.trackLiveVoice(source, { filters: [filter], panner });

  const high = {
    ...LIVE_DEFAULTS,
    pitch: 1,
    timbre: 1,
    phrase: 1,
    twist: 1,
  };
  const low = {
    ...LIVE_DEFAULTS,
    pitch: 0,
    timbre: 0,
    phrase: 0,
    twist: 0,
  };
  let firstHigh = null;
  let firstLow = null;

  for (let repetition = 0; repetition < 8; repetition += 1) {
    engine.setLiveAxes("ouroboros-tape", high, true);
    const highValues = [
      source.playbackRate.value,
      filter.frequency.value,
      filter.Q.value,
      panner.pan.value,
    ];
    if (firstHigh) {
      arraysApproximately(
        highValues,
        firstHigh,
        "the same absolute high setting must not compound",
      );
    } else {
      firstHigh = highValues;
    }

    engine.setLiveAxes("ouroboros-tape", low, true);
    const lowValues = [
      source.playbackRate.value,
      filter.frequency.value,
      filter.Q.value,
      panner.pan.value,
    ];
    if (firstLow) {
      arraysApproximately(
        lowValues,
        firstLow,
        "the same absolute low setting must not drift",
      );
    } else {
      firstLow = lowValues;
    }
  }

  engine.setLiveAxes("ouroboros-tape", LIVE_DEFAULTS, true);
  approximately(source.playbackRate.value, anchors.playbackRate);
  approximately(filter.frequency.value, anchors.frequency);
  approximately(filter.Q.value, anchors.q);
  approximately(panner.pan.value, anchors.pan);
});

test("Fuzzy Donut keeps one recursive graph alive while all six axes move it", () => {
  const {
    engine,
    context,
    delays,
    oscillators,
    sources,
  } = configuredEngine(4);
  engine.beginSession("ouroboros-tape", LIVE_DEFAULTS);
  const donut = engine.sessionDonut;
  const sessionBus = engine.sessionBus;
  assert.ok(donut, "Fuzzy Donut must create its persistent recursive graph");
  assert.equal(delays.length, 1, "the graph keeps one phrase/feedback delay");
  assert.equal(oscillators.length, 1, "the graph keeps one rhythm modulator");
  assert.deepEqual(oscillators[0].startArgs, [context.currentTime]);
  assert.equal(donut.twist.type, "allpass");
  assert.equal(donut.feedbackFilter.type, "lowpass");
  assert.ok(
    donut.feedback.connections.includes(donut.delay),
    "feedback must close back into the bounded delay",
  );

  const buffer = fakeBuffer(1);
  engine.scheduleBuffer(buffer, context.currentTime + 0.05, {
    depth: 4,
    duration: 1,
    gain: 0.2,
    pan: 0,
  });
  assert.equal(sources.length, 1);
  const source = sources[0];

  const endpoint = (axis, value) => ({
    ...LIVE_DEFAULTS,
    [axis]: value,
  });

  engine.setLiveAxes("ouroboros-tape", endpoint("timbre", 0), true);
  const lowCutoff = engine.sessionTone.frequency.value;
  engine.setLiveAxes("ouroboros-tape", endpoint("timbre", 1), true);
  assert.ok(engine.sessionTone.frequency.value / lowCutoff >= 100);

  engine.setLiveAxes("ouroboros-tape", endpoint("pitch", 0), true);
  const lowRate = source.playbackRate.value;
  engine.setLiveAxes("ouroboros-tape", endpoint("pitch", 1), true);
  assert.ok(source.playbackRate.value / lowRate >= 16);

  engine.setLiveAxes("ouroboros-tape", endpoint("rhythm", 0), true);
  const lowRhythm = donut.rhythmOscillator.frequency.value;
  engine.setLiveAxes("ouroboros-tape", endpoint("rhythm", 1), true);
  assert.ok(donut.rhythmOscillator.frequency.value / lowRhythm >= 40);
  assert.ok(donut.rhythmModDepth.gain.value >= 0.4);

  engine.setLiveAxes("ouroboros-tape", endpoint("phrase", 0), true);
  const shortPhrase = donut.delay.delayTime.value;
  const leftPan = donut.panner.pan.value;
  engine.setLiveAxes("ouroboros-tape", endpoint("phrase", 1), true);
  assert.ok(donut.delay.delayTime.value / shortPhrase >= 30);
  assert.ok(donut.panner.pan.value - leftPan >= 1.7);

  engine.setLiveAxes("ouroboros-tape", endpoint("twist", 0), true);
  const lowTwist = donut.twist.frequency.value;
  engine.setLiveAxes("ouroboros-tape", endpoint("twist", 1), true);
  assert.ok(donut.twist.frequency.value / lowTwist >= 50);
  assert.ok(donut.twist.Q.value >= 13);

  engine.setLiveAxes("ouroboros-tape", endpoint("memory", 0), true);
  assert.equal(donut.feedback.gain.value, 0);
  engine.setLiveAxes("ouroboros-tape", endpoint("memory", 1), true);
  approximately(donut.feedback.gain.value, 0.88);
  assert.ok(donut.wet.gain.value >= 0.49);

  assert.equal(engine.sessionBus, sessionBus, "live axes must not restart the graph");
  engine.stopSession();
  assert.ok(oscillators[0].stopArgs, "the rhythm modulator stops with the session");
  assert.equal(engine.sessionDonut, null);
  assert.equal(engine.sessionBus, null);
  assert.equal(sessionBus.disconnected, undefined, "fade teardown is deferred safely");
});

test("native filter anchors survive excursions outside generic motion bounds", () => {
  const { engine, context } = configuredEngine();
  const source = context.createBufferSource();
  const subFilter = context.createBiquadFilter();
  const airFilter = context.createBiquadFilter();
  subFilter.frequency.value = 24;
  airFilter.frequency.value = 18_000;
  engine.trackLiveVoice(source, {
    filters: [subFilter, airFilter],
  });

  engine.setLiveAxes("filter-hydra", {
    ...LIVE_DEFAULTS,
    timbre: 1,
  }, true);
  engine.setLiveAxes("filter-hydra", {
    ...LIVE_DEFAULTS,
    timbre: 0,
  }, true);
  engine.setLiveAxes("filter-hydra", LIVE_DEFAULTS, true);

  approximately(subFilter.frequency.value, 24);
  approximately(airFilter.frequency.value, 18_000);
});

test("Memory zero mutes every ancestor depth bus but retains the deepest bus", () => {
  const { engine } = configuredEngine(5);
  const buses = Array.from(
    { length: 6 },
    (_, depth) => engine.depthBus(depth),
  );

  engine.setLiveAxes("cantor-delay", {
    ...LIVE_DEFAULTS,
    memory: 0,
  }, true);

  for (let depth = 0; depth < 5; depth += 1) {
    assert.equal(
      buses[depth].gain.value,
      0,
      `Memory=0 must mute ancestor depth ${depth}`,
    );
  }
  assert.equal(buses[5].gain.value, 1, "the deepest live depth must remain audible");

  engine.setLiveAxes("cantor-delay", {
    ...LIVE_DEFAULTS,
    memory: 1,
  }, true);
  const retained = buses.map((bus) => bus.gain.value);
  assert.ok(retained.every((gain) => gain > 0));
  for (const gain of retained.slice(1)) approximately(gain, retained[0]);

  engine.setLiveAxes("cantor-delay", {
    ...LIVE_DEFAULTS,
    memory: 0,
  }, true);
  assert.deepEqual(
    buses.map((bus) => bus.gain.value),
    [0, 0, 0, 0, 0, 1],
    "returning to zero Memory must prune ancestors absolutely",
  );
});

test("motion source reads provision enough buffer for a later max-rate live move", () => {
  const {
    engine,
    sources,
  } = configuredEngine(3);
  const buffer = fakeBuffer();
  engine.prepared = {
    parameters: { depth: 3 },
    seedBuffer: buffer,
    generationBuffers: null,
    motionBufferCache: new Map(),
  };
  const duration = 0.5;
  const pulse = {
    channelSwap: false,
    delay: 0,
    duration,
    filterHz: 1_200,
    generation: 3,
    pan: 0.1,
    phraseIndex: 0,
    pitchEnd: 0,
    playbackRate: MOTION_CAPS.minPlaybackRate,
    polarity: 1,
    q: 1.2,
    routeIndex: 0,
    sourcePosition: 0.5,
    timeDirection: 1,
  };

  engine.scheduleMotionPulse(
    "ouroboros-tape",
    { depth: 3, events: [] },
    pulse,
    1.1,
    0.08,
  );

  assert.equal(sources.length, 1);
  const [, offset, readDuration] = sources[0].startArgs;
  assert.ok(Number.isFinite(offset) && offset >= 0);
  assert.ok(Number.isFinite(readDuration) && readDuration > 0);
  assert.ok(
    readDuration + EPSILON >= duration * MOTION_CAPS.maxPlaybackRate,
    "the finite source read must survive a live jump to max playback rate",
  );
  assert.ok(
    offset + readDuration <= buffer.duration + EPSILON,
    "max-rate provisioning must still remain inside the source buffer",
  );
});

test("long motion bodies loop a bounded source region when max live rate can exhaust it", () => {
  const {
    engine,
    sources,
  } = configuredEngine(4);
  const buffer = fakeBuffer(2.6);
  engine.prepared = {
    parameters: { depth: 4 },
    seedBuffer: buffer,
    generationBuffers: [buffer],
    motionBufferCache: new Map(),
  };
  const duration = 1.25;
  engine.scheduleMotionPulse(
    "spectral-mobius",
    { depth: 4, events: [] },
    {
      channelSwap: false,
      delay: 0,
      duration,
      filterHz: 2_400,
      generation: 4,
      pan: -0.2,
      phraseIndex: 2,
      pitchEnd: 0,
      playbackRate: 1,
      polarity: 1,
      q: 2,
      routeIndex: 1,
      sourcePosition: 0.8,
      timeDirection: 1,
    },
    1.1,
    0.06,
  );

  assert.equal(sources.length, 1);
  assert.equal(sources[0].loop, true);
  assert.equal(sources[0].startArgs.length, 2);
  assert.ok(sources[0].loopStart >= 0);
  assert.ok(sources[0].loopEnd > sources[0].loopStart);
  assert.ok(sources[0].loopEnd <= buffer.duration + EPSILON);
  assert.ok(
    sources[0].stopArgs[0] >= 1.1 + duration,
    "the envelope, not finite source exhaustion, should end the long body",
  );
});

test("Cantor native taps are selected by the rolling live window", () => {
  const {
    engine,
    sources,
  } = configuredEngine(3);
  const buffer = fakeBuffer(3);
  engine.prepared = {
    parameters: { depth: 3 },
    seedBuffer: buffer,
    generationBuffers: null,
    motionBufferCache: new Map(),
  };
  const events = [0.02, 0.12, 0.21].map((offset, index) => ({
    depth: 3,
    duration: 0.06,
    gain: 0.04,
    offset,
    pan: 0,
    path: [index % 2],
    source: "noise",
    synth: "cantor-delay-node",
  }));

  engine.scheduleMoment(
    "cantor-delay",
    { depth: 3, duration: 1, events },
    1.1,
    1,
    {
      includeNative: false,
      windowStart: 0.09,
      windowDuration: 0.09,
    },
  );
  assert.equal(sources.length, 1);
  approximately(sources[0].startArgs[0], 1.13);

  engine.scheduleMoment(
    "cantor-delay",
    { depth: 3, duration: 1, events },
    1.19,
    1,
    {
      includeNative: false,
      windowStart: 0.18,
      windowDuration: 0.09,
    },
  );
  assert.equal(sources.length, 2);
  approximately(sources[1].startArgs[0], 1.22);
});

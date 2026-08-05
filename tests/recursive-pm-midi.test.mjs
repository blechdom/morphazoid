import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RECURSIVE_PM_PERFORMANCE_DEFAULTS,
  RecursivePmMidiPerformance,
  RecursivePmWebMidi,
  decodeRecursivePmMidiMessage,
  recursivePmFactoryControlChange,
  recursivePmMidiPitchRatio,
  recursivePmVelocityGain,
  sanitizeRecursivePmPerformance,
} from "../src/recursive-pm-midi.js";
import {
  RECURSIVE_PM_PRESETS,
  RecursivePmAudioEngine,
  RecursivePmProcessor,
} from "../src/recursive-pm.js";

test("Recursive PM performance defaults preserve the browser drone", () => {
  assert.equal(RECURSIVE_PM_PERFORMANCE_DEFAULTS.playMode, "drone");
  assert.deepEqual(
    sanitizeRecursivePmPerformance({
      playMode: "unknown",
      ampAttackMs: -2,
      ampDecayMs: Infinity,
      ampSustainLevel: 2,
      ampReleaseMs: 0,
      glideMode: "mystery",
      glideTimeMs: 9_999,
      pitchBendRangeSemitones: 99,
    }),
    {
      playMode: "drone",
      ampAttackMs: 0,
      ampDecayMs: 120,
      ampSustainLevel: 1,
      ampReleaseMs: 2,
      glideMode: "off",
      glideTimeMs: 2_000,
      rootMidiNote: 60,
      pitchBendRangeSemitones: 24,
    },
  );
  assert.equal(recursivePmMidiPitchRatio(60, 60), 1);
  assert.equal(recursivePmMidiPitchRatio(72, 60), 2);
  assert.equal(recursivePmMidiPitchRatio(48, 60), 0.5);
  assert.equal(recursivePmMidiPitchRatio(60, 60, 12), 2);
  assert.equal(recursivePmVelocityGain(0), 0);
  assert.equal(recursivePmVelocityGain(127), 1);
  assert.equal(recursivePmVelocityGain(64), 64 / 127);
});

test("Recursive PM decoder handles notes, zero-velocity note-off, bend, and CC", () => {
  assert.deepEqual(decodeRecursivePmMidiMessage([0x92, 60, 100]), {
    type: "noteOn",
    note: 60,
    velocity: 100,
    channel: 2,
  });
  assert.deepEqual(decodeRecursivePmMidiMessage([0x92, 60, 0]), {
    type: "noteOff",
    note: 60,
    velocity: 0,
    channel: 2,
  });
  assert.equal(decodeRecursivePmMidiMessage([0xe0, 0, 64]).normalized, 0);
  assert.equal(decodeRecursivePmMidiMessage([0xe0, 0, 0]).normalized, -1);
  assert.equal(decodeRecursivePmMidiMessage([0xef, 127, 127]).normalized, 1);
  assert.deepEqual(decodeRecursivePmMidiMessage([0xb1, 64, 127]), {
    type: "controlChange",
    controller: 64,
    value: 127,
    channel: 1,
  });
  assert.equal(decodeRecursivePmMidiMessage([0xf0, 1, 2]), null);
});

test("Recursive PM uses the portable conservative factory CC map", () => {
  assert.equal(recursivePmFactoryControlChange(7, 64), null);
  assert.equal(recursivePmFactoryControlChange(5, 0).value, 0);
  assert.equal(recursivePmFactoryControlChange(5, 127).value, 2_000);
  assert.deepEqual(recursivePmFactoryControlChange(11, 127), {
    type: "expression",
    value: 1,
  });
  assert.deepEqual(recursivePmFactoryControlChange(64, 64), {
    type: "sustain",
    down: true,
  });
  assert.deepEqual(recursivePmFactoryControlChange(65, 63), {
    type: "glideEnabled",
    enabled: false,
  });
  assert.equal(recursivePmFactoryControlChange(72, 0).parameterId, "performance.ampReleaseMs");
  assert.equal(recursivePmFactoryControlChange(73, 0).value, 0);
  assert.equal(recursivePmFactoryControlChange(75, 127).value, 5_000);
  assert.deepEqual(recursivePmFactoryControlChange(120, 0), { type: "allSoundOff" });
  assert.deepEqual(recursivePmFactoryControlChange(121, 0), { type: "resetControllers" });
  assert.deepEqual(recursivePmFactoryControlChange(123, 0), { type: "allNotesOff" });
  assert.equal(recursivePmFactoryControlChange(74, 100), null);
});

test("Recursive PM mono MIDI uses last-note priority, bend, and sustain", () => {
  const performance = new RecursivePmMidiPerformance({
    pitchBendRangeSemitones: 2,
  });
  const first = performance.handle({ type: "noteOn", note: 60, velocity: 70 });
  assert.equal(first[0].type, "gateOn");
  assert.equal(first[0].legato, false);
  assert.equal(performance.currentNote, 60);

  const second = performance.handle({ type: "noteOn", note: 67, velocity: 110 });
  assert.equal(second[0].note, 67);
  assert.equal(second[0].legato, true);
  assert.equal(performance.currentNote, 67);

  const fallback = performance.handle({ type: "noteOff", note: 67 });
  assert.equal(fallback[0].type, "gateOn");
  assert.equal(fallback[0].note, 60);
  assert.equal(fallback[0].legato, true);

  const bend = performance.handle({ type: "pitchBend", normalized: 1 });
  assert.equal(bend[0].type, "pitchBend");
  assert.equal(bend[0].bendSemitones, 2);
  assert.ok(
    Math.abs(
      performance.currentPitchRatio() - recursivePmMidiPitchRatio(60, 60, 2),
    ) < 1e-12,
  );

  performance.handle({
    type: "controlChange",
    controller: 64,
    value: 127,
  });
  assert.deepEqual(
    performance.handle({ type: "noteOff", note: 60 }),
    [],
  );
  assert.equal(performance.currentNote, 60);
  const pedalUp = performance.handle({
    type: "controlChange",
    controller: 64,
    value: 0,
  });
  assert.deepEqual(pedalUp.map(({ type }) => type), ["sustain", "gateOff"]);
  assert.equal(performance.currentNote, null);
});

test("Recursive PM note ownership distinguishes identical pitches by source and channel", () => {
  const performance = new RecursivePmMidiPerformance();
  performance.handle({
    type: "noteOn",
    note: 60,
    velocity: 64,
    channel: 0,
    sourceId: "keyboard-a",
  });
  performance.handle({
    type: "noteOn",
    note: 60,
    velocity: 112,
    channel: 1,
    sourceId: "keyboard-b",
  });
  assert.equal(performance.heldNotes.size, 2);

  const fallback = performance.handle({
    type: "noteOff",
    note: 60,
    channel: 1,
    sourceId: "keyboard-b",
  });
  assert.equal(fallback[0].type, "gateOn");
  assert.equal(fallback[0].legato, true);
  assert.equal(fallback[0].velocity, 64);
  assert.equal(performance.currentNote, 60);
  assert.equal(performance.heldNotes.size, 1);

  assert.deepEqual(
    performance.handle({
      type: "noteOff",
      note: 60,
      channel: 0,
      sourceId: "keyboard-a",
    }).map(({ type }) => type),
    ["gateOff"],
  );
});

test("Recursive PM panic channel modes clear notes and sustain latch", () => {
  for (const controller of [120, 123]) {
    const performance = new RecursivePmMidiPerformance();
    performance.noteOn(60, 100);
    performance.setSustain(true);
    performance.noteOff(60);
    assert.equal(performance.sustain, true);
    const events = performance.handle({
      type: "controlChange",
      controller,
      value: 0,
    });
    assert.equal(events[0].type, controller === 120 ? "allSoundOff" : "gateOff");
    assert.equal(performance.currentNote, null);
    assert.equal(performance.heldNotes.size, 0);
    assert.equal(performance.sustain, false);
  }
});

class FakeMidiInput {
  constructor(id = null) {
    this.id = id;
    this.state = "connected";
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
}

test("Recursive PM Web MIDI requests no SysEx and cleans up every listener", async () => {
  const input = new FakeMidiInput("keyboard-main");
  const accessListeners = new Map();
  const access = {
    inputs: new Map([["keyboard", input]]),
    addEventListener: (type, listener) => accessListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (accessListeners.get(type) === listener) accessListeners.delete(type);
    },
  };
  const requests = [];
  const actions = [];
  const statuses = [];
  const midi = new RecursivePmWebMidi({
    navigator: {
      requestMIDIAccess: async (options) => {
        requests.push(options);
        return access;
      },
    },
  }, {
    onAction: (action) => actions.push(action),
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(requests.length, 0);
  await midi.enable();
  assert.deepEqual(requests, [{ sysex: false }]);
  assert.equal(midi.status().inputCount, 1);
  assert.ok(input.listeners.has("midimessage"));
  assert.ok(accessListeners.has("statechange"));
  assert.equal(statuses.length, 1);
  input.listeners.get("midimessage")({ data: [0x90, 64, 96] });
  assert.equal(actions[0].type, "noteOn");
  assert.equal(actions[0].note, 64);
  assert.equal(actions[0].sourceId, "keyboard-main");

  midi.close();
  assert.equal(input.listeners.has("midimessage"), false);
  assert.equal(accessListeners.has("statechange"), false);
  assert.equal(midi.enabled, false);
  assert.equal(statuses.length, 2);
  assert.equal(statuses.at(-1).enabled, false);

  await assert.rejects(
    new RecursivePmWebMidi({ navigator: {} }).enable(),
    /not available/,
  );
});

test("Recursive PM disconnect panic clears held notes and sustain", async () => {
  const input = new FakeMidiInput();
  const accessListeners = new Map();
  const access = {
    inputs: new Map([["keyboard", input]]),
    addEventListener: (type, listener) => accessListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (accessListeners.get(type) === listener) accessListeners.delete(type);
    },
  };
  const performance = new RecursivePmMidiPerformance();
  const actions = [];
  const midi = new RecursivePmWebMidi({
    navigator: { requestMIDIAccess: async () => access },
  }, {
    onAction: (action) => {
      actions.push(action);
      performance.handle(action);
    },
  });
  await midi.enable();
  input.listeners.get("midimessage")({ data: [0x90, 64, 100] });
  input.listeners.get("midimessage")({ data: [0xb0, 64, 127] });
  assert.equal(performance.currentNote, 64);
  assert.equal(performance.sustain, true);

  input.state = "disconnected";
  accessListeners.get("statechange")();
  assert.equal(input.listeners.has("midimessage"), false);
  assert.equal(performance.currentNote, null);
  assert.equal(performance.sustain, false);
  assert.equal(actions.at(-1).controller, 120);
  assert.equal(actions.at(-1).reason, "input-disconnected");
});

test("Recursive PM close invalidates a pending MIDI permission request", async () => {
  const input = new FakeMidiInput();
  const accessListeners = new Map();
  const access = {
    inputs: new Map([["keyboard", input]]),
    addEventListener: (type, listener) => accessListeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (accessListeners.get(type) === listener) accessListeners.delete(type);
    },
  };
  let resolveAccess;
  const permission = new Promise((resolve) => { resolveAccess = resolve; });
  const midi = new RecursivePmWebMidi({
    navigator: { requestMIDIAccess: () => permission },
  });
  const pending = midi.enable();
  midi.close();
  resolveAccess(access);
  assert.equal(await pending, null);
  assert.equal(midi.enabled, false);
  assert.equal(input.listeners.size, 0);
  assert.equal(accessListeners.size, 0);
});

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  cancelScheduledValues(time) { this.events.push(["cancel", time]); }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(["set", value, time]);
  }

  setTargetAtTime(value, time, constant) {
    this.value = value;
    this.events.push(["target", value, time, constant]);
  }

  linearRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(["ramp", value, time]);
  }
}

class FakeAudioNode {
  constructor() { this.connections = []; }

  connect(node) { this.connections.push(node); return node; }

  disconnect() {}
}

class FakeWorkletNode extends FakeAudioNode {
  constructor() {
    super();
    this.messages = [];
    this.port = { postMessage: (message) => this.messages.push(message) };
  }
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 48_000;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new FakeAudioNode();
    this.audioWorklet = { addModule: async () => {} };
  }

  createGain() {
    const node = new FakeAudioNode();
    node.gain = new FakeAudioParam();
    return node;
  }

  createDynamicsCompressor() {
    const node = new FakeAudioNode();
    for (const key of ["threshold", "knee", "ratio", "attack", "release"]) {
      node[key] = new FakeAudioParam();
    }
    return node;
  }

  createAnalyser() {
    const node = new FakeAudioNode();
    node.fftSize = 0;
    node.getByteTimeDomainData = (target) => target.fill(128);
    return node;
  }

  async resume() { this.state = "running"; }

  async close() { this.state = "closed"; }
}

test("Recursive PM engine separates exact note glide, bend, velocity, and ADSR", async () => {
  const engine = new RecursivePmAudioEngine({
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeWorkletNode,
    setTimeout: (callback) => callback(),
  });
  engine.setPlayMode("midi");
  await engine.start(RECURSIVE_PM_PRESETS[1].settings, 0.58);
  assert.equal(engine.articulationGain.gain.value, 0);
  assert.equal(engine.analyser.fftSize, 2_048);
  assert.equal(engine.analyser.minDecibels, -90);
  assert.equal(engine.analyser.maxDecibels, 0);
  assert.equal(engine.analyser.smoothingTimeConstant, 0.45);

  engine.noteOn(2, 0.5, {
    attackMs: 10,
    decayMs: 20,
    sustainLevel: 0.4,
    glideTimeMs: 250,
    glide: true,
  });
  assert.deepEqual(engine.worklet.messages.find(
    ({ type }) => type === "note-pitch",
  ), {
    type: "note-pitch",
    pitchRatio: 2,
    glideSeconds: 0,
    immediate: false,
  });
  assert.ok(engine.articulationGain.gain.events.some(
    (event) => event[0] === "ramp" && event[1] === 1 && event[2] === 0.01,
  ));
  assert.ok(engine.articulationGain.gain.events.some(
    (event) => event[0] === "ramp" && event[1] === 0.4 && event[2] === 0.03,
  ));
  assert.ok(engine.velocityGain.gain.events.some(
    (event) => event[0] === "target" && event[1] === 0.5,
  ));

  const envelopeEventCount = engine.articulationGain.gain.events.length;
  engine.context.currentTime = 0.04;
  engine.noteOn(4, 0.8, {
    sustainLevel: 0.4,
    glideTimeMs: 250,
    glide: true,
    retrigger: false,
  });
  const notePitchMessages = engine.worklet.messages.filter(
    ({ type }) => type === "note-pitch",
  );
  assert.equal(notePitchMessages.at(-1).glideSeconds, 0.25);
  assert.equal(engine.articulationGain.gain.events.length, envelopeEventCount);
  assert.ok(engine.velocityGain.gain.events.some(
    (event) => event[0] === "target" && event[1] === 0.8,
  ));

  engine.setSustainLevel(0.65);
  assert.deepEqual(
    engine.articulationGain.gain.events.at(-1),
    ["target", 0.65, 0.04, 0.008],
  );
  assert.ok(engine.worklet.messages.some(
    (message) => message.type === "pitch-bend"
      && message.dezipperSeconds === 0.008,
  ));

  engine.noteOff(200);
  assert.equal(engine.articulationGain.gain.events.at(-1)[0], "ramp");
  assert.equal(engine.articulationGain.gain.events.at(-1)[1], 0);
  assert.ok(Math.abs(engine.articulationGain.gain.events.at(-1)[2] - 0.24) < 1e-12);
  engine.setExpression(0.5);
  assert.equal(engine.expression, 0.5);
  assert.equal(engine.masterGain.gain.value, 0.29);
  engine.setPlayMode("drone", { immediate: true });
  assert.equal(engine.performancePitchRatio, 1);
  assert.deepEqual(engine.worklet.messages.at(-1), {
    type: "pitch-bend",
    bendSemitones: 0,
    dezipperSeconds: 0.008,
    immediate: true,
  });
  assert.equal(engine.articulationGain.gain.value, 1);
  await engine.stop({ immediate: true });
});

test("Recursive PM worklet time-scales carrier and every PM phasor together", () => {
  const processor = new RecursivePmProcessor();
  processor.port.onmessage({
    data: {
      type: "settings",
      immediate: true,
      settings: {
        carrierHz: 100,
        startModFrequencyHz: 200,
        frequencyDivisor: 2,
        startPhaseIndex: 1,
        indexDivisor: 2,
        depth: 1,
        maximumFrequencyHz: 20_000,
      },
    },
  });
  processor.port.onmessage({
    data: {
      type: "note-pitch",
      pitchRatio: 2,
      glideSeconds: 0,
      immediate: true,
    },
  });
  processor.process([], [[new Float32Array(1)]]);
  assert.ok(Math.abs(processor.carrierPhase - 200 / 48_000) < 1e-12);
  assert.ok(Math.abs(processor.operatorPhases[0] - 400 / 48_000) < 1e-12);
});

test("Recursive PM worklet glides linearly in semitones for the exact duration", () => {
  const processor = new RecursivePmProcessor();
  processor.port.onmessage({
    data: {
      type: "note-pitch",
      pitchRatio: 2,
      glideSeconds: 4 / 48_000,
      immediate: false,
    },
  });
  processor.port.onmessage({
    data: {
      type: "pitch-bend",
      bendSemitones: 2,
      dezipperSeconds: 0.008,
      immediate: false,
    },
  });

  processor.process([], [[new Float32Array(2)]]);
  assert.equal(processor.currentNoteSemitones, 6);
  assert.equal(processor.noteGlideRemainingSamples, 2);
  assert.equal(processor.bendDezipperTotalSamples, 384);
  assert.equal(processor.bendDezipperRemainingSamples, 382);

  processor.process([], [[new Float32Array(2)]]);
  assert.equal(processor.currentNoteSemitones, 12);
  assert.equal(processor.noteGlideRemainingSamples, 0);
  assert.equal(processor.bendDezipperRemainingSamples, 380);
});

test("Recursive PM uses shared header MIDI and keeps foreground live analysis", async () => {
  const [html, app, css, engineSource] = await Promise.all([
    readFile(new URL("../recursive-pm.html", import.meta.url), "utf8"),
    readFile(new URL("../recursive-pm-app.js", import.meta.url), "utf8"),
    readFile(new URL("../recursive-pm.css", import.meta.url), "utf8"),
    readFile(new URL("../src/recursive-pm.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(html, /id="midiButton"|id="midiState"|id="midiError"/);
  assert.doesNotMatch(html, /id="playModeDrone"|id="playModeMidi"/);
  assert.doesNotMatch(html, /Web MIDI permission is requested/);
  assert.match(html, /id="midiActivity"/);
  assert.match(html, /id="ampAttackMs"/);
  assert.match(html, /id="ampSustainLevel"/);
  assert.match(html, /id="glideMode"/);
  assert.match(html, /id="rootMidiNote"/);
  assert.match(html, /CC5 glide · CC11 expression/);
  assert.match(html, /Controller macros · 1 Depth · 2 Mod frequency/);
  assert.match(html, /4 Index divisor · 5 Attack · 6 Release · 7 Glide · 8 Output/);
  assert.doesNotMatch(html, /CC7 volume/);
  assert.match(app, /getSharedMidiManager/);
  assert.match(app, /sharedMidiManager\.registerClient\(\{/);
  assert.match(app, /id: "recursive-pm"/);
  assert.match(app, /onMessage: handleSharedMidiMessage/);
  assert.match(app, /onEnabledChange: handleSharedMidiEnabledChange/);
  assert.match(app, /onPrepareEnable: prepareSharedMidiEnable/);
  assert.match(app, /onProfileChange: handleSharedMidiProfileChange/);
  assert.match(app, /unregisterMidiClient\?\.\(\)/);
  assert.doesNotMatch(app, /new RecursivePmWebMidi|requestMIDIAccess|midiButton/);
  assert.match(app, /handleMidiAction\(message\)/);
  assert.match(app, /sourceId: "shared-midi"/);
  assert.match(app, /setPlayMode\(active \? "midi" : "drone"\)/);
  assert.match(app, /logical\?\.type !== "macro"/);
  assert.match(app, /controls\.depth\.input/);
  assert.match(app, /controls\.indexDivisor\.input/);
  assert.match(app, /performanceControls\.ampAttackMs\.input/);
  assert.match(app, /performanceControls\.ampReleaseMs\.input/);
  assert.match(app, /performanceControls\.glideTimeMs\.input/);
  assert.match(app, /\{ label: "Output", input: \$\("level"\) \}/);
  assert.match(app, /dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.match(app, /if \(applySharedMidiMacro\(message\.logical\)\) return;/);
  assert.match(app, /engine\.start\(state\.settings, state\.level\)/);
  assert.match(app, /syncCurrentNoteToAudio\(\)/);
  assert.match(app, /retrigger: !event\.legato/);
  assert.match(app, /engine\.setSustainLevel/);
  assert.match(app, /createChaoticSpectrum\(\)/);
  assert.match(app, /drawChaoticLiveAnalysis\(canvasContext/);
  assert.match(app, /spectrumBarFill/);
  assert.doesNotMatch(app, /createChaoticSpectrogram/);
  assert.doesNotMatch(app, /drawChaoticAnalysis\(canvasContext/);
  assert.match(html, /non-scrolling log-frequency spectrum/);
  assert.match(html, /rectangular level bars behind a bright oscilloscope trace/);
  assert.doesNotMatch(html, /rolling spectrogram/i);
  assert.doesNotMatch(css, /\.chaotic-midi-connect|\.chaotic-midi-permission-note|\.chaotic-mode-switch/);
  assert.match(engineSource, /this\.current\.carrierHz \* this\.currentPitchRatio/);
  assert.match(engineSource, /this\.current\.startModFrequencyHz\s*\n\s*\* this\.currentPitchRatio/);
  assert.match(engineSource, /analyser\.fftSize = 2_048/);
  assert.match(engineSource, /analyser\.smoothingTimeConstant = 0\.45/);
});

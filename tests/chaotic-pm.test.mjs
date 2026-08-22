import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHAOTIC_PM_DC_BLOCKER_HZ,
  CHAOTIC_PM_LIMITS,
  CHAOTIC_PM_LEGACY_PRESETS,
  CHAOTIC_PM_PARAMETER_IDS,
  CHAOTIC_PM_PERFORMANCE_DEFAULTS,
  CHAOTIC_PM_PRESETS,
  CHAOTIC_PM_TRANSFER_MODES,
  DEFAULT_CHAOTIC_PM_PRESET_ID,
  ChaoticPmAudio,
  ChaoticPmWebMidi,
  chaoticPmFactoryControlChange,
  chaoticPmTurnSample,
  createChaoticPmSoftCeilingCurve,
  deriveChaoticPmStack,
  decodeChaoticPmMidiMessage,
  sanitizeChaoticPmParams,
  sanitizeChaoticPmPerformance,
  smoothChaoticPmTurnSample,
} from "../src/chaotic-pm.js";
import { fft } from "../src/recursion-spectral-dsp.js";

const LEGACY_PRESET_IDS = [
  "subzero-thread",
  "forty-fold",
  "still-glass",
  "runaway-stair",
  "braided-orbit",
  "low-ember",
  "kilohertz-veil",
  "chrome-cascade",
];

const LEGACY_SETTINGS = [
  [2, 0.06, 0.035, 22, 0.625, 6, 0.34],
  [1, 0.666, 40, 10, 6.66, 6.5, 0.512],
  [4, 0.002, 0.002, 1, 0.365, 5.75, 0.246],
  [8, 0.006, 0.05, 0.001, 0.625, 4.75, 0.666],
  [5, 1.41, 1.14, 1, 0.864, 6.75, 0.41],
  [4, 3, 0.08, 2.6, 0.5, 7, 0.9],
  [4, 1_000, 0.02, 17.85, 13.5, 6.75, 0.13],
  [6, 0.144, 400, 10.247, 64, 1.75, 0.279],
].map(([
  depth,
  carrierHz,
  startModFrequencyHz,
  frequencyDivisor,
  startPhaseIndex,
  indexDivisor,
  nonlinearity,
]) => ({
  depth,
  carrierHz,
  startModFrequencyHz,
  frequencyDivisor,
  startPhaseIndex,
  indexDivisor,
  nonlinearity,
}));

function expectedLegacyTurn(
  previousSignal,
  basePhase,
  modFrequencyHz,
  phaseIndex,
  nonlinearity,
) {
  // Morphisma's `mod(..., 1)` is remainder, not a positive wrap. This signed
  // result matters because tanh is applied before the final sine.
  const phase = (basePhase + previousSignal * phaseIndex) % 1;
  const drive = nonlinearity * modFrequencyHz * modFrequencyHz;
  const gain = 1.2 - Math.sqrt(nonlinearity);
  return Math.sin(Math.PI * 2 * Math.tanh(phase * drive) * gain);
}

function approximatelyEqual(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("Chaotic PM performance parameters stay bounded and keep drone compatibility", () => {
  assert.equal(CHAOTIC_PM_PERFORMANCE_DEFAULTS.playMode, "drone");
  assert.equal(CHAOTIC_PM_PARAMETER_IDS.playMode, "performance.playMode");
  assert.equal(CHAOTIC_PM_PARAMETER_IDS.ampAttackMs, "performance.ampAttackMs");
  const safe = sanitizeChaoticPmPerformance({
    playMode: "MIDI",
    rootMidiNote: 999,
    pitchBendRangeSemitones: 99,
    ampAttackMs: -10,
    ampDecayMs: 99_999,
    ampSustainLevel: 2,
    ampReleaseMs: 0,
    glideTimeMs: 99_999,
    glideMode: "LEGATO",
  });
  assert.deepEqual(safe, {
    playMode: "midi",
    rootMidiNote: 127,
    pitchBendRangeSemitones: 24,
    ampAttackMs: 0,
    ampDecayMs: 5_000,
    ampSustainLevel: 1,
    ampReleaseMs: 2,
    glideTimeMs: 2_000,
    glideMode: "legato",
  });
});

test("Chaotic PM decodes notes, velocity-zero note-off, bend, and factory CCs", () => {
  assert.deepEqual(decodeChaoticPmMidiMessage([0x92, 61, 99]), {
    type: "noteOn",
    note: 61,
    velocity: 99,
    channel: 2,
  });
  assert.deepEqual(decodeChaoticPmMidiMessage([0x92, 61, 0]), {
    type: "noteOff",
    note: 61,
    velocity: 0,
    channel: 2,
  });
  assert.equal(decodeChaoticPmMidiMessage([0xe0, 0, 64]).normalized, 0);
  assert.equal(decodeChaoticPmMidiMessage([0xf0, 1, 2]), null);
  assert.deepEqual(chaoticPmFactoryControlChange(11, 127), {
    type: "expression",
    value: 1,
  });
  assert.deepEqual(chaoticPmFactoryControlChange(64, 127), {
    type: "sustain",
    down: true,
  });
  assert.equal(chaoticPmFactoryControlChange(5, 0).value, 0);
  assert.equal(chaoticPmFactoryControlChange(72, 127).key, "ampReleaseMs");
  assert.equal(chaoticPmFactoryControlChange(73, 127).key, "ampAttackMs");
  assert.equal(chaoticPmFactoryControlChange(75, 127).key, "ampDecayMs");
  assert.deepEqual(chaoticPmFactoryControlChange(123, 0), {
    type: "allNotesOff",
  });
  assert.equal(
    chaoticPmFactoryControlChange(74, 127),
    null,
    "algorithm controls remain unfixed for MIDI learn",
  );
});

test("Chaotic PM Web MIDI waits for enable, requests no SysEx, and cleans up", async () => {
  const listeners = new Map();
  const accessListeners = new Map();
  const input = {
    state: "connected",
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  let requestOptions = null;
  const access = {
    inputs: new Map([["input", input]]),
    addEventListener(type, listener) { accessListeners.set(type, listener); },
    removeEventListener(type) { accessListeners.delete(type); },
  };
  const actions = [];
  const notes = [];
  const controlChanges = [];
  const midi = new ChaoticPmWebMidi({
    navigator: {
      async requestMIDIAccess(options) {
        requestOptions = options;
        return access;
      },
    },
  }, {
    target: {
      noteOn: (...values) => notes.push(values),
      controlChange: (...values) => controlChanges.push(values),
    },
    onAction: (action) => actions.push(action),
  });

  assert.equal(midi.enabled, false);
  assert.equal(requestOptions, null, "construction must not prompt");
  await midi.enable();
  assert.deepEqual(requestOptions, { sysex: false });
  assert.equal(midi.status().inputCount, 1);
  listeners.get("midimessage")({ data: new Uint8Array([0x90, 60, 100]) });
  assert.deepEqual(notes, [[60, 100, 0]]);
  assert.equal(actions[0].type, "noteOn");
  input.state = "disconnected";
  accessListeners.get("statechange")();
  assert.deepEqual(controlChanges, [[120, 0]]);
  assert.equal(actions.at(-1).synthetic, true);
  assert.equal(actions.at(-1).reason, "inputDisconnected");
  assert.equal(midi.status().inputCount, 0);
  assert.equal(listeners.has("midimessage"), false);
  midi.close();
  assert.equal(listeners.has("midimessage"), false);
  assert.equal(accessListeners.has("statechange"), false);
  assert.equal(midi.enabled, false);
});

test("Chaotic PM Web MIDI cannot revive after close while permission is pending", async () => {
  let resolveAccess = null;
  let stateListenerAttached = false;
  let inputListenerAttached = false;
  const input = {
    state: "connected",
    addEventListener() { inputListenerAttached = true; },
    removeEventListener() { inputListenerAttached = false; },
  };
  const access = {
    inputs: new Map([["input", input]]),
    addEventListener() { stateListenerAttached = true; },
    removeEventListener() { stateListenerAttached = false; },
  };
  const midi = new ChaoticPmWebMidi({
    navigator: {
      requestMIDIAccess() {
        return new Promise((resolve) => { resolveAccess = resolve; });
      },
    },
  });

  const pending = midi.enable();
  midi.close();
  resolveAccess(access);
  assert.equal(await pending, null);
  assert.equal(midi.enabled, false);
  assert.equal(midi.status().inputCount, 0);
  assert.equal(stateListenerAttached, false);
  assert.equal(inputListenerAttached, false);
});

function methodBody(source, signature) {
  const methodStart = source.indexOf(signature);
  assert.ok(methodStart >= 0, `missing ${signature}`);
  const bodyStart = source.indexOf("{", methodStart);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`unterminated ${signature}`);
}

test("Chaotic PM preserves the eight WIP tuples apart from the playable bank", () => {
  // Morphisma displayed tuple two initially; its Play effect then accidentally
  // forced tuple one. The recovered values remain reference material, but are
  // not suitable as an audible preset bank.
  assert.equal(DEFAULT_CHAOTIC_PM_PRESET_ID, "forty-fold");
  assert.deepEqual(
    CHAOTIC_PM_LEGACY_PRESETS.map(({ id }) => id),
    LEGACY_PRESET_IDS,
  );
  assert.deepEqual(
    CHAOTIC_PM_LEGACY_PRESETS.map(({ settings }) => {
      const { transferMode: _transferMode, ...sourceTuple } = settings;
      return sourceTuple;
    }),
    LEGACY_SETTINGS,
  );
  assert.ok(
    CHAOTIC_PM_LEGACY_PRESETS.every(
      ({ settings }) => settings.transferMode === "legacy",
    ),
    "exported legacy presets must select their preserved Raw transfer",
  );
  assert.ok(Object.isFrozen(CHAOTIC_PM_LEGACY_PRESETS));
  assert.ok(CHAOTIC_PM_LEGACY_PRESETS.every(Object.isFrozen));
  assert.ok(
    CHAOTIC_PM_LEGACY_PRESETS.every(
      ({ settings }) => Object.isFrozen(settings),
    ),
  );

  assert.deepEqual(
    CHAOTIC_PM_PRESETS.map(({ id }) => id),
    LEGACY_PRESET_IDS,
  );
  assert.notDeepEqual(
    CHAOTIC_PM_PRESETS.map(({ settings }) => settings),
    LEGACY_SETTINGS,
    "the playable bank must not silently alias the inaudible WIP tuples",
  );
  CHAOTIC_PM_PRESETS.forEach((preset, index) => {
    assert.notDeepEqual(
      preset.settings,
      CHAOTIC_PM_LEGACY_PRESETS[index].settings,
      `${preset.id} must identify its audible adaptation separately from WIP`,
    );
  });
  assert.ok(Object.isFrozen(CHAOTIC_PM_PRESETS));
  assert.ok(CHAOTIC_PM_PRESETS.every(Object.isFrozen));
  assert.ok(CHAOTIC_PM_PRESETS.every(({ settings }) => Object.isFrozen(settings)));
});

test("Chaotic PM accepts the original parameter names without altering presets", () => {
  const legacy = sanitizeChaoticPmParams({
    steps: 8,
    carrierFreq: 0.006,
    startModFreq: 0.05,
    freqDiv: 0.001,
    indexOfMod: 0.625,
    indexDiv: 4.75,
    filter: 0.666,
  });

  assert.deepEqual(
    {
      depth: legacy.depth,
      carrierHz: legacy.carrierHz,
      startModFrequencyHz: legacy.startModFrequencyHz,
      frequencyDivisor: legacy.frequencyDivisor,
      startPhaseIndex: legacy.startPhaseIndex,
      indexDivisor: legacy.indexDivisor,
      nonlinearity: legacy.nonlinearity,
    },
    LEGACY_SETTINGS[3],
  );

  const bounded = sanitizeChaoticPmParams({
    steps: 99,
    carrierFreq: -1,
    startModFreq: -1,
    freqDiv: 0,
    indexOfMod: 1_000,
    indexDiv: 0,
    filter: 2,
  });
  assert.equal(bounded.depth, CHAOTIC_PM_LIMITS.maxDepth);
  assert.equal(bounded.carrierHz, CHAOTIC_PM_LIMITS.minCarrierHz);
  assert.equal(
    bounded.startModFrequencyHz,
    CHAOTIC_PM_LIMITS.minModFrequencyHz,
  );
  assert.equal(
    bounded.frequencyDivisor,
    CHAOTIC_PM_LIMITS.minFrequencyDivisor,
  );
  assert.equal(bounded.startPhaseIndex, CHAOTIC_PM_LIMITS.maxPhaseIndex);
  assert.equal(bounded.indexDivisor, CHAOTIC_PM_LIMITS.minIndexDivisor);
  assert.equal(bounded.nonlinearity, CHAOTIC_PM_LIMITS.maxNonlinearity);
});

test("Chaotic PM defaults to Smooth and sanitizes explicit Legacy Raw mode", () => {
  assert.deepEqual(CHAOTIC_PM_TRANSFER_MODES, {
    smooth: "smooth",
    legacy: "legacy",
  });
  assert.equal(sanitizeChaoticPmParams({}).transferMode, "smooth");
  assert.equal(
    sanitizeChaoticPmParams({ transferMode: "LEGACY" }).transferMode,
    "legacy",
  );
  assert.equal(sanitizeChaoticPmParams({ mode: "raw" }).transferMode, "legacy");
  assert.equal(
    sanitizeChaoticPmParams({ transferMode: "unknown" }).transferMode,
    "smooth",
  );
  assert.equal(CHAOTIC_PM_PARAMETER_IDS.transferMode, "synthesis.transferMode");
});

test("Smooth Chaotic PM is periodic and becomes Recursive PM at zero chaos", () => {
  const epsilon = 1e-7;
  const smoothLeft = smoothChaoticPmTurnSample(
    0,
    1 - epsilon,
    40,
    6.66,
    0.016,
  );
  const smoothRight = smoothChaoticPmTurnSample(
    0,
    epsilon,
    40,
    6.66,
    0.016,
  );
  assert.ok(
    Math.abs(smoothLeft - smoothRight) < 2e-6,
    "the production transfer must join continuously at a phasor wrap",
  );
  assert.ok(
    Math.abs(
      chaoticPmTurnSample(0, 1 - epsilon, 40, 6.66, 0.016)
      - chaoticPmTurnSample(0, epsilon, 40, 6.66, 0.016)
    ) > 0.4,
    "the Legacy Raw seam remains available for comparison",
  );

  for (const values of [
    [-0.75, 0.1, 3.5, 0.6, 0],
    [0.37, 0.123, 440, 1.75, 0],
    [0, 0.333, 40, 13.5, 0],
  ]) {
    const [previous, phase, _frequency, index] = values;
    approximatelyEqual(
      smoothChaoticPmTurnSample(...values),
      Math.sin(Math.PI * 2 * phase + index * previous),
    );
  }

  approximatelyEqual(
    smoothChaoticPmTurnSample(0.42, 0.37, 40, 2.5, 0.7),
    smoothChaoticPmTurnSample(0.42, 0.37, 400, 2.5, 0.7),
  );
  for (const values of [
    [Infinity, -Infinity, Infinity, Infinity, Infinity],
    [-10, 1e30, -1, -5, -4],
  ]) {
    const sample = smoothChaoticPmTurnSample(...values);
    assert.ok(Number.isFinite(sample));
    assert.ok(Math.abs(sample) <= 1);
  }
});

test("one Chaotic PM turn matches the signed-remainder legacy transfer", () => {
  for (const values of [
    [0.25, 0.125, 40, 6.66, 0.512],
    [-0.75, 0.1, 3.5, 0.6, 0.34],
    [0.9, 0.95, 0.08, 0.5, 0.9],
    [1, 0.25, 400, 64, 0.279],
  ]) {
    approximatelyEqual(
      chaoticPmTurnSample(...values),
      expectedLegacyTurn(...values),
    );
  }

  const negativeValues = [-0.75, 0.1, 3.5, 0.6, 0.34];
  const signedPhase = (
    negativeValues[1] + negativeValues[0] * negativeValues[3]
  ) % 1;
  assert.ok(signedPhase < 0, "fixture must exercise signed remainder semantics");
  const positivePhase = signedPhase - Math.floor(signedPhase);
  const positiveWrapResult = Math.sin(
    Math.PI * 2
      * Math.tanh(
        positivePhase * negativeValues[4] * negativeValues[2] ** 2,
      )
      * (1.2 - Math.sqrt(negativeValues[4])),
  );
  assert.notEqual(chaoticPmTurnSample(...negativeValues), positiveWrapResult);
  assert.equal(chaoticPmTurnSample(0.5, 0.5, 20, 2, 0), 0);
});

test("operator ledger divides frequency and index independently", () => {
  const stack = deriveChaoticPmStack({
    ...LEGACY_SETTINGS[0],
    transferMode: "legacy",
  });

  assert.equal(stack.requestedDepth, 2);
  assert.equal(stack.actualDepth, 2);
  assert.equal(stack.audibleIndex, 2);
  assert.equal(stack.operators.length, 3);
  assert.deepEqual(
    stack.operators.map(({ sourceIndex }) => sourceIndex),
    [null, 0, 1],
  );
  assert.equal(stack.operators[0].kind, "carrier");
  assert.equal(stack.operators[0].frequencyHz, 0.06);
  assert.equal(stack.operators[1].frequencyHz, 0.035);
  assert.equal(stack.operators[1].phaseIndex, 0.625);
  assert.equal(stack.operators[1].nonlinearity, 0.34);
  assert.equal(stack.operators[1].phaseIndexUnit, "cycles");
  approximatelyEqual(stack.operators[1].drive, 0.34 * 0.035 ** 2);
  approximatelyEqual(stack.operators[1].gain, 1.2 - Math.sqrt(0.34));
  approximatelyEqual(stack.operators[2].frequencyHz, 0.035 / 22);
  approximatelyEqual(stack.operators[2].phaseIndex, 0.625 / 6);
});

test("Smooth operator ledger uses a bounded pitch-independent chaos drive", () => {
  const stack = deriveChaoticPmStack(CHAOTIC_PM_PRESETS[0].settings);
  assert.equal(stack.settings.transferMode, "smooth");
  assert.equal(stack.operators[1].phaseIndexUnit, "radians");
  assert.equal(stack.operators[2].phaseIndexUnit, "radians");
  approximatelyEqual(stack.operators[1].drive, 1 + 0.34 * 8);
  approximatelyEqual(stack.operators[2].drive, 1 + 0.34 * 8);
  assert.equal(stack.operators[1].gain, 1);
  assert.equal(stack.operators[2].gain, 1);
  assert.notEqual(stack.operators[1].frequencyHz, stack.operators[2].frequencyHz);
});

test("operator ledger omits a turn whose base frequency reaches the ceiling", () => {
  const stack = deriveChaoticPmStack({
    depth: 8,
    carrierHz: 0.006,
    startModFrequencyHz: 0.05,
    frequencyDivisor: 0.001,
    startPhaseIndex: 0.625,
    indexDivisor: 4.75,
    nonlinearity: 0.666,
  }, { sampleRate: 48_000 });

  assert.equal(stack.requestedDepth, 8);
  assert.equal(stack.actualDepth, 2);
  assert.equal(stack.boundedByFrequency, true);
  assert.deepEqual(
    stack.operators.slice(1).map(({ frequencyHz }) => frequencyHz),
    [0.05, 50],
  );
  assert.ok(50_000 >= stack.settings.maximumFrequencyHz);
});

test("every playable preset reaches an untruncated audio-rate final operator", () => {
  for (const preset of CHAOTIC_PM_PRESETS) {
    const stack = deriveChaoticPmStack(preset.settings, {
      sampleRate: 48_000,
    });
    const finalOperator = stack.operators[stack.audibleIndex];

    assert.equal(
      stack.actualDepth,
      stack.requestedDepth,
      `${preset.id} must not lose requested turns to the frequency ceiling`,
    );
    assert.equal(
      stack.boundedByFrequency,
      false,
      `${preset.id} must fit below the render ceiling`,
    );
    assert.ok(
      finalOperator.frequencyHz >= 40,
      `${preset.id} final operator is sub-audio at ${finalOperator.frequencyHz} Hz`,
    );
    assert.ok(
      finalOperator.frequencyHz <= 2_000,
      `${preset.id} final operator is unnecessarily high at ${finalOperator.frequencyHz} Hz`,
    );
    assert.ok(
      finalOperator.frequencyHz < stack.settings.maximumFrequencyHz,
      `${preset.id} final operator must remain below the render ceiling`,
    );
    assert.ok(
      finalOperator.drive >= 1 && finalOperator.drive <= 9,
      `${preset.id} dimensionless chaos drive ${finalOperator.drive} left its bounded range`,
    );
  }
});

test("soft ceiling is finite, bounded, monotonic, and antisymmetric", () => {
  const curve = createChaoticPmSoftCeilingCurve(1_025);
  assert.ok(curve instanceof Float32Array);
  assert.equal(curve.length, 1_025);
  for (let index = 0; index < curve.length; index += 1) {
    assert.ok(Number.isFinite(curve[index]));
    assert.ok(Math.abs(curve[index]) <= 1);
    if (index > 0) assert.ok(curve[index] >= curve[index - 1]);
    approximatelyEqual(curve[index], -curve[curve.length - 1 - index], 1e-6);
  }
});

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
  }

  cancelScheduledValues() {}

  setValueAtTime(value) {
    this.value = value;
  }

  setTargetAtTime(value) {
    this.value = value;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
  }
}

class FakeNode {
  constructor() {
    this.connections = [];
    this.disconnected = false;
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeAudioWorkletNode extends FakeNode {
  constructor(context, name, options) {
    super();
    this.context = context;
    this.name = name;
    this.options = options;
    this.messages = [];
    this.port = {
      postMessage: (message) => this.messages.push(message),
    };
  }
}

class FakeAudioContext {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.sampleRate = 48_000;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new FakeNode();
    this.modules = [];
    this.audioWorklet = {
      addModule: async (url) => this.modules.push(String(url)),
    };
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    const node = new FakeNode();
    node.gain = new FakeAudioParam();
    return node;
  }

  createDynamicsCompressor() {
    const node = new FakeNode();
    for (const name of ["threshold", "knee", "ratio", "attack", "release"]) {
      node[name] = new FakeAudioParam();
    }
    return node;
  }

  createWaveShaper() {
    const node = new FakeNode();
    node.curve = null;
    node.oversample = "none";
    return node;
  }

  createBiquadFilter() {
    const node = new FakeNode();
    node.frequency = new FakeAudioParam();
    node.Q = new FakeAudioParam();
    return node;
  }

  createAnalyser() {
    const node = new FakeNode();
    node.fftSize = 0;
    node.smoothingTimeConstant = 0;
    node.getByteTimeDomainData = (target) => target.fill(128);
    node.getFloatTimeDomainData = (target) => target.fill(0);
    return node;
  }

  async resume() {
    this.state = "running";
  }

  async suspend() {
    this.state = "suspended";
  }

  async close() {
    this.state = "closed";
  }
}

test("audio stays lazy, starts one worklet, and closes every node", async () => {
  FakeAudioContext.instances.length = 0;
  const runtime = {
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout() {},
  };
  const audio = new ChaoticPmAudio(runtime);
  assert.equal(FakeAudioContext.instances.length, 0);

  await audio.start(LEGACY_SETTINGS[0], 0.58);
  assert.equal(FakeAudioContext.instances.length, 1);
  assert.equal(audio.running, true);
  assert.equal(audio.context.options.latencyHint, "interactive");
  assert.match(audio.context.modules[0], /src\/chaotic-pm\.js$/);
  const worklet = audio.worklet ?? audio.node;
  assert.equal(worklet.name, "morphazoid-chaotic-pm");
  assert.equal(CHAOTIC_PM_DC_BLOCKER_HZ, 18);
  assert.equal(audio.highpass.frequency.value, CHAOTIC_PM_DC_BLOCKER_HZ);
  assert.equal(audio.waveform.length, 512, "scope window matches Chaotic FM");
  assert.equal(
    worklet.messages.find(({ type }) => type === "settings")?.settings.transferMode,
    "smooth",
  );
  audio.updateSettings({
    ...LEGACY_SETTINGS[0],
    transferMode: "legacy",
  });
  assert.equal(worklet.messages.at(-1).settings.transferMode, "legacy");

  audio.setPerformanceParameters({
    playMode: "midi",
    glideMode: "legato",
    glideTimeMs: 80,
  });
  assert.equal(worklet.messages.at(-1).type, "performance");
  assert.equal(worklet.messages.at(-1).parameters.playMode, "midi");
  audio.noteOn(60, 96, 0);
  const noteOnMessage = worklet.messages.at(-1);
  assert.deepEqual({
    type: noteOnMessage.type,
    note: noteOnMessage.note,
    velocity: noteOnMessage.velocity,
    channel: noteOnMessage.channel,
  }, {
    type: "noteOn",
    note: 60,
    velocity: 96,
    channel: 0,
  });
  if ("sourceId" in noteOnMessage) assert.equal(noteOnMessage.sourceId, "default");
  audio.pitchBend(0.5);
  assert.deepEqual(worklet.messages.at(-1), {
    type: "pitchBend",
    normalized: 0.5,
  });
  audio.noteOff(60, 0);
  const noteOffMessage = worklet.messages.at(-1);
  assert.deepEqual({
    type: noteOffMessage.type,
    note: noteOffMessage.note,
    channel: noteOffMessage.channel,
  }, {
    type: "noteOff",
    note: 60,
    channel: 0,
  });
  if ("sourceId" in noteOffMessage) assert.equal(noteOffMessage.sourceId, "default");

  await audio.start(LEGACY_SETTINGS[1], 0.4);
  assert.equal(FakeAudioContext.instances.length, 1);
  await audio.stop({ immediate: true });
  assert.equal(audio.running, false);
  assert.equal(FakeAudioContext.instances[0].state, "closed");
  assert.equal(worklet.disconnected, true);
});

class DeferredAudioContext extends FakeAudioContext {
  static releaseModule = null;

  constructor(options) {
    super(options);
    this.audioWorklet = {
      addModule: (url) => {
        this.modules.push(String(url));
        return new Promise((resolve) => {
          DeferredAudioContext.releaseModule = resolve;
        });
      },
    };
  }
}

test("concurrent start keeps the latest controls and a closed context restarts", async () => {
  FakeAudioContext.instances.length = 0;
  const runtime = {
    AudioContext: DeferredAudioContext,
    AudioWorkletNode: FakeAudioWorkletNode,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout() {},
  };
  const audio = new ChaoticPmAudio(runtime);
  const firstStart = audio.start(LEGACY_SETTINGS[0], 0.2);
  const secondStart = audio.start(LEGACY_SETTINGS[3], 0.66);
  assert.equal(FakeAudioContext.instances.length, 1);
  await Promise.resolve();
  DeferredAudioContext.releaseModule();
  await Promise.all([firstStart, secondStart]);

  assert.equal(audio.running, true);
  assert.equal(audio.worklet.messages.at(-1).settings.carrierHz, 0.006);
  assert.equal(audio.worklet.messages.at(-1).settings.depth, 2);
  assert.equal(audio.masterGain.gain.value, 0.66);

  const firstContext = audio.context;
  const firstWorklet = audio.worklet;
  await firstContext.close();
  assert.equal(audio.running, false);
  const restart = audio.start(LEGACY_SETTINGS[1], 0.4);
  await Promise.resolve();
  DeferredAudioContext.releaseModule();
  await restart;
  assert.equal(FakeAudioContext.instances.length, 2);
  assert.notEqual(audio.context, firstContext);
  assert.equal(firstWorklet.disconnected, true);
  await audio.stop({ immediate: true });
});

function configureWorkletProcessor(Processor, settings, sampleRate) {
  const stack = deriveChaoticPmStack(settings, { sampleRate });
  const processor = new Processor();
  processor.port.onmessage({
    data: {
      type: "settings",
      settings: {
        ...stack.settings,
        depth: stack.actualDepth,
      },
      immediate: true,
    },
  });
  return processor;
}

function powerFractionAbove(samples, sampleRate, cutoffHz) {
  const mean = samples.reduce((sum, sample) => sum + sample, 0)
    / samples.length;
  const windowed = Float64Array.from(samples, (sample, index) => (
    (sample - mean)
    * (0.5 - 0.5 * Math.cos(
      Math.PI * 2 * index / (samples.length - 1),
    ))
  ));
  const spectrum = fft(windowed);
  const nyquistBin = samples.length / 2;
  const highStart = Math.ceil(cutoffHz * samples.length / sampleRate);
  let totalPower = 0;
  let highPower = 0;
  for (let bin = 1; bin <= nyquistBin; bin += 1) {
    const power = spectrum.real[bin] ** 2 + spectrum.imag[bin] ** 2;
    totalPower += power;
    if (bin >= highStart) highPower += power;
  }
  return totalPower > 0 ? highPower / totalPower : 0;
}

function renderAudibilityMetrics(Processor, settings, {
  sampleRate = 48_000,
  warmupSeconds = 0.25,
  measureSeconds = 1,
  dcBlockerHz = CHAOTIC_PM_DC_BLOCKER_HZ,
} = {}) {
  globalThis.sampleRate = sampleRate;
  const processor = configureWorkletProcessor(Processor, settings, sampleRate);
  const warmupFrames = Math.round(warmupSeconds * sampleRate);
  const measureFrames = Math.round(measureSeconds * sampleRate);
  const totalFrames = warmupFrames + measureFrames;
  // Match the audible graph's Butterworth-like high-pass closely enough to
  // reject DC-heavy WIP signals in a deterministic, browser-free render.
  const angularFrequency = Math.PI * 2 * dcBlockerHz / sampleRate;
  const cosine = Math.cos(angularFrequency);
  const alpha = Math.sin(angularFrequency) / (2 * 0.707);
  const a0 = 1 + alpha;
  const highpass = {
    b0: (1 + cosine) / (2 * a0),
    b1: -(1 + cosine) / a0,
    b2: (1 + cosine) / (2 * a0),
    a1: -2 * cosine / a0,
    a2: (1 - alpha) / a0,
  };
  let input1 = 0;
  let input2 = 0;
  let output1 = 0;
  let output2 = 0;
  let renderedFrames = 0;
  let measuredFrames = 0;
  let sum = 0;
  let squareSum = 0;
  let postDcSquareSum = 0;
  let peak = 0;
  let previousMeasuredSample = null;
  let maxAdjacentDelta = 0;
  let largeJumpCount = 0;
  const spectralSamples = new Float64Array(4_096);

  while (renderedFrames < totalFrames) {
    const output = new Float32Array(128);
    assert.equal(processor.process([], [[output]]), true);
    for (const sample of output) {
      assert.ok(Number.isFinite(sample), "worklet emitted a non-finite sample");
      assert.ok(Math.abs(sample) <= 1.000001, "worklet exceeded unity");
      const postDc = highpass.b0 * sample
        + highpass.b1 * input1
        + highpass.b2 * input2
        - highpass.a1 * output1
        - highpass.a2 * output2;
      assert.ok(Number.isFinite(postDc), "DC blocker emitted a non-finite sample");
      input2 = input1;
      input1 = sample;
      output2 = output1;
      output1 = postDc;

      if (renderedFrames >= warmupFrames && measuredFrames < measureFrames) {
        sum += sample;
        squareSum += sample * sample;
        postDcSquareSum += postDc * postDc;
        peak = Math.max(peak, Math.abs(sample));
        if (previousMeasuredSample !== null) {
          const delta = Math.abs(sample - previousMeasuredSample);
          maxAdjacentDelta = Math.max(maxAdjacentDelta, delta);
          if (delta > 0.5) largeJumpCount += 1;
        }
        previousMeasuredSample = sample;
        if (measuredFrames < spectralSamples.length) {
          spectralSamples[measuredFrames] = sample;
        }
        measuredFrames += 1;
      }
      renderedFrames += 1;
      if (renderedFrames >= totalFrames) break;
    }
  }

  assert.equal(measuredFrames, measureFrames);
  const mean = sum / measuredFrames;
  return {
    peak,
    acRms: Math.sqrt(Math.max(0, squareSum / measuredFrames - mean * mean)),
    postDcRms: Math.sqrt(postDcSquareSum / measuredFrames),
    maxAdjacentDelta,
    largeJumpCount,
    highFrequencyPowerFraction: powerFractionAbove(
      spectralSamples,
      sampleRate,
      5_000,
    ),
  };
}

test("worklet renders both banks finitely and playable presets audibly", async () => {
  const previousProcessorBase = globalThis.AudioWorkletProcessor;
  const previousRegisterProcessor = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;
  try {
    globalThis.AudioWorkletProcessor = class {
      constructor() {
        this.port = { onmessage: null };
      }
    };
    globalThis.registerProcessor = (_name, ProcessorClass) => {
      Processor = ProcessorClass;
    };
    const workletUrl = new URL("../src/chaotic-pm.js", import.meta.url);
    workletUrl.searchParams.set("worklet-test", String(Date.now()));
    await import(workletUrl);
    assert.equal(typeof Processor, "function");

    for (const sampleRate of [32_000, 44_100, 48_000, 96_000]) {
      globalThis.sampleRate = sampleRate;
      const settingsBank = [
        ...CHAOTIC_PM_LEGACY_PRESETS.map(({ settings }) => settings),
        ...CHAOTIC_PM_PRESETS.map(({ settings }) => settings),
      ];
      for (const settings of settingsBank) {
        const processor = configureWorkletProcessor(
          Processor,
          settings,
          sampleRate,
        );
        for (let block = 0; block < 16; block += 1) {
          const left = new Float32Array(128);
          const right = new Float32Array(128);
          assert.equal(processor.process([], [[left, right]]), true);
          for (let frame = 0; frame < left.length; frame += 1) {
            assert.ok(Number.isFinite(left[frame]));
            assert.ok(Math.abs(left[frame]) <= 1.000001);
            assert.equal(left[frame], right[frame]);
          }
        }
      }
    }

    globalThis.sampleRate = 48_000;
    const smoothReferenceSettings = {
      transferMode: "smooth",
      depth: 1,
      carrierHz: 173,
      startModFrequencyHz: 229,
      frequencyDivisor: 1,
      startPhaseIndex: 2.4,
      indexDivisor: 1,
      nonlinearity: 0,
    };
    const smoothReference = configureWorkletProcessor(
      Processor,
      smoothReferenceSettings,
      48_000,
    );
    let referenceCarrierPhase = 0;
    let referenceOperatorPhase = 0;
    for (let block = 0; block < 4; block += 1) {
      const rendered = new Float32Array(128);
      smoothReference.process([], [[rendered]]);
      for (const sample of rendered) {
        referenceCarrierPhase = (
          referenceCarrierPhase + smoothReferenceSettings.carrierHz / 48_000
        ) % 1;
        referenceOperatorPhase = (
          referenceOperatorPhase
          + smoothReferenceSettings.startModFrequencyHz / 48_000
        ) % 1;
        const carrierSignal = Math.sin(Math.PI * 2 * referenceCarrierPhase);
        const expected = Math.sin(
          Math.PI * 2 * referenceOperatorPhase
          + smoothReferenceSettings.startPhaseIndex * carrierSignal,
        );
        approximatelyEqual(sample, expected, 1e-6);
      }
    }

    const rawReferenceSettings = {
      ...LEGACY_SETTINGS[1],
      transferMode: "legacy",
      depth: 1,
    };
    const rawReference = configureWorkletProcessor(
      Processor,
      rawReferenceSettings,
      48_000,
    );
    referenceCarrierPhase = 0;
    referenceOperatorPhase = 0;
    const rawRendered = new Float32Array(128);
    rawReference.process([], [[rawRendered]]);
    for (const sample of rawRendered) {
      referenceCarrierPhase = (
        referenceCarrierPhase + rawReferenceSettings.carrierHz / 48_000
      ) % 1;
      referenceOperatorPhase = (
        referenceOperatorPhase
        + rawReferenceSettings.startModFrequencyHz / 48_000
      ) % 1;
      const carrierSignal = Math.sin(Math.PI * 2 * referenceCarrierPhase);
      approximatelyEqual(
        sample,
        chaoticPmTurnSample(
          carrierSignal,
          referenceOperatorPhase,
          rawReferenceSettings.startModFrequencyHz,
          rawReferenceSettings.startPhaseIndex,
          rawReferenceSettings.nonlinearity,
        ),
        1e-6,
      );
    }

    rawReference.port.onmessage({
      data: {
        type: "settings",
        settings: { transferMode: "smooth" },
      },
    });
    rawReference.process([], [[new Float32Array(128)]]);
    approximatelyEqual(
      rawReference.currentLegacyMix,
      1 - 128 / (48_000 * 0.009),
      1e-12,
    );
    const descendingMix = rawReference.currentLegacyMix;
    rawReference.port.onmessage({
      data: {
        type: "settings",
        settings: { transferMode: "legacy" },
      },
    });
    rawReference.process([], [[new Float32Array(64)]]);
    assert.ok(rawReference.currentLegacyMix > descendingMix);
    assert.ok(rawReference.currentLegacyMix < 1);
    const ascendingMix = rawReference.currentLegacyMix;
    rawReference.port.onmessage({
      data: {
        type: "settings",
        settings: { transferMode: "smooth" },
      },
    });
    rawReference.process([], [[new Float32Array(64)]]);
    assert.ok(rawReference.currentLegacyMix < ascendingMix);
    for (let block = 0; block < 4; block += 1) {
      rawReference.process([], [[new Float32Array(128)]]);
    }
    assert.equal(rawReference.currentLegacyMix, 0);
    rawReference.port.onmessage({
      data: {
        type: "settings",
        settings: { transferMode: "legacy" },
      },
    });
    for (let block = 0; block < 4; block += 1) {
      rawReference.process([], [[new Float32Array(128)]]);
    }
    assert.equal(rawReference.currentLegacyMix, 1);

    const wrapFixture = {
      depth: 1,
      carrierHz: 100,
      startModFrequencyHz: 40,
      frequencyDivisor: 1,
      startPhaseIndex: 0,
      indexDivisor: 1,
      nonlinearity: 0.016,
    };
    const maximumWorkletDelta = (processor, frameTotal) => {
      let previous = null;
      let maximum = 0;
      let remaining = frameTotal;
      while (remaining > 0) {
        const output = new Float32Array(Math.min(128, remaining));
        processor.process([], [[output]]);
        for (const sample of output) {
          if (previous !== null) {
            maximum = Math.max(maximum, Math.abs(sample - previous));
          }
          previous = sample;
        }
        remaining -= output.length;
      }
      return maximum;
    };
    const rawWrap = configureWorkletProcessor(
      Processor,
      { ...wrapFixture, transferMode: "legacy" },
      48_000,
    );
    const smoothWrap = configureWorkletProcessor(
      Processor,
      { ...wrapFixture, transferMode: "smooth" },
      48_000,
    );
    assert.ok(maximumWorkletDelta(rawWrap, 1_400) > 0.4);
    assert.ok(maximumWorkletDelta(smoothWrap, 1_400) < 0.01);

    const midiVoice = configureWorkletProcessor(
      Processor,
      CHAOTIC_PM_PRESETS[1].settings,
      48_000,
    );
    midiVoice.port.onmessage({
      data: {
        type: "performance",
        parameters: {
          playMode: "midi",
          rootMidiNote: 60,
          pitchBendRangeSemitones: 2,
          ampAttackMs: 0,
          ampDecayMs: 0,
          ampSustainLevel: 1,
          ampReleaseMs: 2,
          glideTimeMs: 100,
          glideMode: "legato",
        },
      },
    });
    const gatedSilence = new Float32Array(128);
    midiVoice.process([], [[gatedSilence]]);
    assert.ok(gatedSilence.every((sample) => sample === 0));
    midiVoice.port.onmessage({
      data: { type: "noteOn", note: 60, velocity: 64, channel: 9 },
    });
    assert.equal(midiVoice.selectedNote, 60);
    assert.equal(midiVoice.noteChannel[60], 9);
    assert.equal(midiVoice.targetVelocity, 64 / 127);
    midiVoice.port.onmessage({
      data: { type: "noteOn", note: 67, velocity: 127, channel: 0 },
    });
    assert.equal(midiVoice.selectedNote, 67, "newest note has mono priority");
    assert.ok(midiVoice.baseGlideDuration > 0, "legato note starts portamento");
    midiVoice.port.onmessage({
      data: { type: "pitchBend", normalized: 1 },
    });
    assert.equal(midiVoice.targetBendSemitones, 2);
    midiVoice.port.onmessage({ data: { type: "noteOff", note: 67 } });
    assert.equal(midiVoice.selectedNote, 60, "release falls back to last held note");
    const articulated = new Float32Array(128);
    midiVoice.process([], [[articulated]]);
    assert.ok(articulated.some((sample) => Math.abs(sample) > 0));
    midiVoice.port.onmessage({ data: { type: "sustain", down: true } });
    midiVoice.port.onmessage({ data: { type: "noteOff", note: 60, channel: 9 } });
    assert.equal(midiVoice.selectedNote, 60, "sustain holds the released voice");
    midiVoice.port.onmessage({ data: { type: "sustain", down: false } });
    assert.equal(midiVoice.selectedNote, -1);
    for (let block = 0; block < 4; block += 1) {
      midiVoice.process([], [[new Float32Array(128)]]);
    }
    assert.equal(midiVoice.envelopeStage, 0);

    const ownedVoice = configureWorkletProcessor(
      Processor,
      CHAOTIC_PM_PRESETS[1].settings,
      48_000,
    );
    ownedVoice.port.onmessage({
      data: { type: "performance", parameters: { playMode: "midi" } },
    });
    ownedVoice.port.onmessage({
      data: {
        type: "noteOn", note: 60, velocity: 70, channel: 0,
        sourceId: "web-midi:hardware",
      },
    });
    ownedVoice.port.onmessage({
      data: {
        type: "noteOn", note: 64, velocity: 90, channel: 0,
        sourceId: "web-midi:hardware",
      },
    });
    ownedVoice.port.onmessage({
      data: {
        type: "noteOn", note: 60, velocity: 110, channel: 0,
        sourceId: "computer-keyboard",
      },
    });
    assert.equal(ownedVoice.noteHeld[60], 2);
    ownedVoice.port.onmessage({
      data: {
        type: "noteOff", note: 60, channel: 0,
        sourceId: "computer-keyboard",
      },
    });
    assert.equal(ownedVoice.selectedNote, 64);
    assert.equal(ownedVoice.noteHeld[60], 1);
    ownedVoice.port.onmessage({
      data: {
        type: "noteOff", note: 64, channel: 0,
        sourceId: "web-midi:hardware",
      },
    });
    assert.equal(ownedVoice.selectedNote, 60);
    assert.equal(ownedVoice.targetVelocity, 70 / 127);
    ownedVoice.port.onmessage({
      data: {
        type: "noteOff", note: 60, channel: 0,
        sourceId: "web-midi:hardware",
      },
    });
    assert.equal(ownedVoice.selectedNote, -1);

    const smoothZeroChaos = new Processor();
    smoothZeroChaos.port.onmessage({
      data: {
        type: "settings",
        settings: {
          ...LEGACY_SETTINGS[1],
          transferMode: "smooth",
          depth: 1,
          nonlinearity: 0,
          maximumFrequencyHz: 20_000,
        },
        immediate: true,
      },
    });
    const recursivePm = new Float32Array(128);
    smoothZeroChaos.process([], [[recursivePm]]);
    assert.ok(recursivePm.some((sample) => Math.abs(sample) > 0));

    const legacyZeroWarp = new Processor();
    legacyZeroWarp.port.onmessage({
      data: {
        type: "settings",
        settings: {
          ...LEGACY_SETTINGS[1],
          transferMode: "legacy",
          depth: 1,
          nonlinearity: 0,
          maximumFrequencyHz: 20_000,
        },
        immediate: true,
      },
    });
    const legacySilence = new Float32Array(128);
    legacyZeroWarp.process([], [[legacySilence]]);
    assert.ok(legacySilence.every((sample) => sample === 0));

    const carrierOnly = new Processor();
    carrierOnly.port.onmessage({
      data: {
        type: "settings",
        settings: {
          ...LEGACY_SETTINGS[1],
          depth: 0,
          maximumFrequencyHz: 20_000,
        },
        immediate: true,
      },
    });
    const carrier = new Float32Array(128);
    carrierOnly.process([], [[carrier]]);
    assert.ok(carrier.some((sample) => Math.abs(sample) > 0));

    for (const sampleRate of [44_100, 48_000]) {
      for (const preset of CHAOTIC_PM_PRESETS) {
        const metrics = renderAudibilityMetrics(Processor, preset.settings, {
          sampleRate,
        });
        const fixture = `${preset.id} at ${sampleRate} Hz`;
        assert.ok(
          metrics.peak >= 0.25,
          `${fixture} rendered peak ${metrics.peak} is effectively silent`,
        );
        assert.ok(
          metrics.acRms >= 0.15,
          `${fixture} AC RMS ${metrics.acRms} is effectively silent`,
        );
        assert.ok(
          metrics.postDcRms >= 0.15,
          `${fixture} post-${CHAOTIC_PM_DC_BLOCKER_HZ} Hz DC-blocker RMS ${metrics.postDcRms} is effectively silent`,
        );
        assert.equal(
          metrics.largeJumpCount,
          0,
          `${fixture} produced ${metrics.largeJumpCount} discontinuity-sized jumps`,
        );
        assert.ok(
          metrics.maxAdjacentDelta < 0.5,
          `${fixture} adjacent-sample delta reached ${metrics.maxAdjacentDelta}`,
        );
        assert.ok(
          metrics.highFrequencyPowerFraction < 0.05,
          `${fixture} placed ${metrics.highFrequencyPowerFraction * 100}% of analyzed power above 5 kHz`,
        );
      }
    }
  } finally {
    if (previousProcessorBase === undefined) {
      delete globalThis.AudioWorkletProcessor;
    } else {
      globalThis.AudioWorkletProcessor = previousProcessorBase;
    }
    if (previousRegisterProcessor === undefined) {
      delete globalThis.registerProcessor;
    } else {
      globalThis.registerProcessor = previousRegisterProcessor;
    }
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("worklet preallocates state and keeps its render loop allocation-free", async () => {
  const source = await readFile(
    new URL("../src/chaotic-pm.js", import.meta.url),
    "utf8",
  );
  const processBody = methodBody(source, "process(_inputs, outputs)");

  assert.match(source, /registerProcessor/);
  assert.match(source, /new Float(?:32|64)Array/);
  assert.doesNotMatch(processBody, /new (?:Array|Float(?:32|64)Array)/);
  assert.match(source, /Number\.isFinite/);
});

test("Chaotic PM exposes Smooth and Legacy transfers with shared MIDI performance UI", async () => {
  const [markup, app, source, css] = await Promise.all([
    readFile(new URL("../chaotic-pm.html", import.meta.url), "utf8"),
    readFile(new URL("../chaotic-pm-app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/chaotic-pm.js", import.meta.url), "utf8"),
    readFile(new URL("../chaotic-pm.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(markup, /id="midiButton"/);
  assert.doesNotMatch(markup, /id="midiState"|id="midiError"/);
  assert.doesNotMatch(markup, /id="playModeDrone"|id="playModeMidi"/);
  assert.doesNotMatch(markup, /Web MIDI permission is requested/);
  assert.match(markup, /id="midiActivity"/);
  assert.match(markup, /id="midiEnvelopeControls" hidden/);
  assert.match(markup, /id="ampAttackMs"/);
  assert.match(markup, /id="ampDecayMs"/);
  assert.match(markup, /id="ampSustainLevel"/);
  assert.match(markup, /id="ampReleaseMs"/);
  assert.match(markup, /id="glideMode"/);
  assert.match(markup, /id="transferMode"/);
  assert.match(markup, /<option value="smooth" selected>Smooth<\/option>/);
  assert.match(markup, /<option value="legacy">Legacy \/ Raw<\/option>/);
  assert.match(markup, /Smooth mode shapes the previous sine continuously/);
  assert.match(markup, /Controller macros · 1 Depth · 2 Mod frequency/);
  assert.match(markup, /4 Chaos \/ warp · 5 Attack · 6 Release · 7 Glide · 8 Output/);
  assert.match(markup, /CC11 expression · CC64 sustain/);
  assert.match(markup, /non-scrolling log-frequency spectrum/);
  assert.match(app, /getSharedMidiManager/);
  assert.match(
    app,
    /midiEnvelopeControls"\)\.hidden = state\.performance\.playMode !== "midi"/,
  );
  assert.match(app, /sharedMidiManager\.registerClient\(\{/);
  assert.match(app, /id: "chaotic-pm"/);
  assert.match(app, /onMessage: handleSharedMidiMessage/);
  assert.match(app, /onEnabledChange: handleSharedMidiEnabledChange/);
  assert.match(app, /onPrepareEnable: prepareSharedMidiEnable/);
  assert.match(app, /onProfileChange: handleSharedMidiProfileChange/);
  assert.match(app, /unregisterMidiClient\?\.\(\)/);
  assert.doesNotMatch(app, /new ChaoticPmWebMidi|requestMIDIAccess|midiButton/);
  assert.match(app, /audio\.noteOn\(action\.note, action\.velocity, action\.channel, action\.sourceId\)/);
  assert.match(app, /if \(!audio\.running\)/);
  assert.match(app, /state\.performance\.playMode !== previousMode/);
  assert.match(app, /playMode: active \? "midi" : "drone"/);
  assert.match(app, /logical\?\.type !== "macro"/);
  assert.match(app, /controls\.depth\.input/);
  assert.match(app, /controls\.nonlinearity\.input/);
  assert.match(app, /\$\("transferMode"\)\.addEventListener\("change"/);
  assert.match(app, /TANH CONTROL · PM/);
  assert.match(app, /performanceControls\.ampAttackMs\.input/);
  assert.match(app, /performanceControls\.ampReleaseMs\.input/);
  assert.match(app, /performanceControls\.glideTimeMs\.input/);
  assert.match(app, /\{ label: "Output", input: \$\("output"\) \}/);
  assert.match(app, /dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.match(app, /if \(applySharedMidiMacro\(message\.logical\)\) return;/);
  assert.match(app, /clearMidiMonitorState\(\)/);
  assert.match(app, /midiSelectedNote/);
  assert.match(app, /!state\.sustain && !isMidiNoteHeld/);
  assert.match(app, /createChaoticSpectrum\(\)/);
  assert.match(app, /drawChaoticLiveAnalysis/);
  assert.doesNotMatch(app, /createChaoticSpectrogram|drawChaoticAnalysis/);
  assert.match(app, /class="chaotic-pm-flow-detailed"/);
  assert.match(app, /class="chaotic-pm-flow-compact"/);
  assert.match(app, />PHASE ENTRY</);
  assert.match(app, /%1 · TANH · SINE/);
  assert.match(source, /new Float64Array\(CHAOTIC_PM_LIMITS\.maxDepth \+ 1\)/);
  assert.match(source, /MAX_SMOOTH_CHAOS_DRIVE/);
  assert.match(source, /this\.legacySignals/);
  assert.match(
    css,
    /grid-template-rows: clamp\(360px, 50dvh, 460px\) minmax\(0, 1fr\)/,
  );
  assert.match(css, /height: clamp\(0px, calc\(100% - 274px\), 118px\)/);
  assert.match(css, /\.chaotic-pm-flow-detailed \{\s+display: none;/);
  assert.match(css, /\.chaotic-pm-flow-compact \{\s+display: block;/);
  assert.doesNotMatch(css, /\.chaotic-midi-connect|\.chaotic-midi-permission-note|\.chaotic-mode-switch/);
  assert.match(source, /requestMIDIAccess\(\{ sysex: false \}\)/);
  assert.match(source, /generation !== this\.generation/);
  assert.match(source, /reason: "inputDisconnected"/);
  assert.match(source, /new Uint8Array\(128\)/);
  assert.match(source, /new Uint8Array\(512\)/);
  assert.match(source, /this\.noteChannel\[note\]/);
  assert.match(markup, /live log-frequency spectrum with a foreground oscilloscope/i);
  assert.match(source, /newestNote\(\{ physicallyHeldOnly = false \}/);
  assert.match(source, /envelope \* this\.currentVelocity \* this\.currentExpression/);
});

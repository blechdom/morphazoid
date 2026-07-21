import assert from "node:assert/strict";
import test from "node:test";

import {
  AMPLITUDE_ENVELOPE_PRESETS,
  amplitudeEnvelopePreset,
  clamp,
  cornerAttackSeconds,
  cornerDecaySeconds,
  cornerStrikePeak,
  levelToGain,
  mapCurve01,
  normalizeStrikeGains,
  normalizeVoiceGains,
  pitch01ToFrequency,
  reduceVoiceContacts,
  sampleAmplitudeEnvelope,
  sanitizeAmplitudeEnvelope,
  scaleShapeVoiceGains,
  sineCornerEnvelopeGain,
  synthParametersForMode,
  timbreParametersForMode,
  VoicePool,
  waveformForIndex,
  updateAmplitudeEnvelopeNode,
} from "../src/audio.js";

test("audio module imports and constructs without browser globals", () => {
  const pool = new VoicePool();
  assert.equal(pool.size, 32);
  assert.equal(pool.running, false);
  assert.equal(pool.isEnabled, false);
});

test("starting without Web Audio fails only when explicitly requested", async () => {
  const pool = new VoicePool();
  await assert.rejects(pool.start(), /Web Audio is not available/);
  assert.equal(pool.running, false);
});

test("clamp handles normal, reversed, infinite, and NaN values", () => {
  assert.equal(clamp(4, 0, 3), 3);
  assert.equal(clamp(-1, 3, 0), 0);
  assert.equal(clamp(Infinity, 0, 3), 3);
  assert.equal(clamp(Number.NaN, 0, 3), 0);
});

test("pitch mapping is continuous and safely clamped", () => {
  assert.equal(pitch01ToFrequency(0, 20, 2), 20);
  assert.equal(pitch01ToFrequency(0, 110, 2), 110);
  assert.equal(pitch01ToFrequency(0.5, 110, 2), 220);
  assert.equal(pitch01ToFrequency(1, 110, 2), 440);
  assert.equal(pitch01ToFrequency(-1, 110, 2), 110);
  assert.equal(pitch01ToFrequency(2, 110, 2), 440);
  assert.equal(pitch01ToFrequency(1, 18_000, 10), 20_000);
});

test("geometry drive produces bounded and mode-specific synth parameters", () => {
  assert.deepEqual(synthParametersForMode("sine", 0.75), {
    mode: "sine",
    synthDrive: 0.75,
    modulationIndex: 0,
    modulationRatio: 1,
    shepardRate: 0,
    shepardWidth: 4,
    shepardPosition: null,
  });

  const fm = synthParametersForMode("fm", 0.5, { fmIndex: 6, fmRatio: 2.5 });
  assert.equal(fm.modulationIndex, 3);
  assert.equal(fm.modulationRatio, 2.5);

  const pm = synthParametersForMode("pm", 0.25, { pmIndex: 4, pmRatio: 1.5 });
  assert.equal(pm.modulationIndex, 1);
  assert.equal(pm.modulationRatio, 1.5);

  const shepard = synthParametersForMode("shepard", 2, {
    shepardRate: -20,
    shepardWidth: 12,
  });
  assert.equal(shepard.synthDrive, 1);
  assert.equal(shepard.shepardRate, -8);
  assert.equal(shepard.shepardWidth, 8);
  assert.equal(
    synthParametersForMode("shepard", 1, { shepardPosition: 2.25 }).shepardPosition,
    0.25,
  );
  assert.equal(synthParametersForMode("unknown", Number.NaN).mode, "sine");
});

test("timbre mapping targets the sound-specific DSP amount", () => {
  assert.deepEqual(timbreParametersForMode("sine", 0.75, {
    fmIndex: 8,
    pmIndex: 6,
    shepardWidth: 7,
  }), {
    modulationIndex: 0,
    shepardWidth: 7,
  });

  assert.equal(
    timbreParametersForMode("fm", 0.5, { fmIndex: 6 }).modulationIndex,
    3,
  );
  assert.equal(
    timbreParametersForMode("pm", 0.25, { pmIndex: 4 }).modulationIndex,
    1,
  );

  assert.equal(
    timbreParametersForMode("shepard", 0, { shepardWidth: 7 }).shepardWidth,
    1,
  );
  assert.equal(
    timbreParametersForMode("shepard", 0.5, { shepardWidth: 7 }).shepardWidth,
    4,
  );
  assert.equal(
    timbreParametersForMode("shepard", 1, { shepardWidth: 7 }).shepardWidth,
    7,
  );

  const boundedFm = timbreParametersForMode("fm", 2, { fmIndex: 40 });
  const boundedPm = timbreParametersForMode("pm", 2, { pmIndex: 40 });
  const boundedShepard = timbreParametersForMode("shepard", 2, {
    shepardWidth: 40,
  });
  assert.equal(boundedFm.modulationIndex, 20);
  assert.equal(boundedPm.modulationIndex, 12);
  assert.equal(boundedShepard.shepardWidth, 8);
});

test("synth parameters use mapped Shepard width without changing sine", () => {
  assert.equal(
    synthParametersForMode("shepard", 0, { shepardWidth: 7 }).shepardWidth,
    1,
  );
  assert.equal(
    synthParametersForMode("shepard", 0.5, { shepardWidth: 7 }).shepardWidth,
    4,
  );
  assert.equal(
    synthParametersForMode("shepard", 1, { shepardWidth: 7 }).shepardWidth,
    7,
  );

  const sine = synthParametersForMode("sine", 0.8, { shepardWidth: 6 });
  assert.equal(sine.modulationIndex, 0);
  assert.equal(sine.shepardWidth, 6);
});

test("source response curves are bounded and preserve their intended shape", () => {
  for (const curve of ["linear", "exponential", "logarithmic", "smooth"]) {
    assert.equal(mapCurve01(-1, curve), 0);
    assert.equal(mapCurve01(0, curve), 0);
    assert.equal(mapCurve01(1, curve), 1);
    assert.equal(mapCurve01(2, curve), 1);
  }

  assert.equal(mapCurve01(0.5, "linear"), 0.5);
  assert.equal(mapCurve01(0.5, "exponential"), 0.25);
  assert.equal(mapCurve01(0.5, "smooth"), 0.5);
  assert.ok(mapCurve01(0.5, "logarithmic") > 0.5);
  assert.equal(mapCurve01(0.2, "inverted"), 0.8);
  assert.equal(mapCurve01(-1, "inverted"), 1);
  assert.equal(mapCurve01(2, "inverted"), 0);
  assert.equal(mapCurve01(0.35, "unknown"), 0.35);

  for (const curve of ["linear", "exponential", "logarithmic", "smooth"]) {
    const samples = [0, 0.1, 0.5, 0.9, 1].map((value) => mapCurve01(value, curve));
    for (let index = 1; index < samples.length; index += 1) {
      assert.ok(samples[index] >= samples[index - 1], `${curve} must be monotonic`);
    }
  }
});

test("amplitude envelope presets are five-node immutable templates", () => {
  assert.deepEqual(Object.keys(AMPLITUDE_ENVELOPE_PRESETS), [
    "pluck",
    "sustain",
    "pad",
  ]);
  for (const preset of Object.values(AMPLITUDE_ENVELOPE_PRESETS)) {
    assert.equal(preset.length, 5);
    assert.equal(Object.isFrozen(preset), true);
    assert.ok(preset.every((node) => Object.isFrozen(node)));
    assert.ok(preset.every((node, index) => index === 0 || node.x >= preset[index - 1].x));
    assert.equal(preset[0].x, 0);
    assert.ok(preset.at(-1).x < 1, "release endpoint should leave an explicit hold segment");
  }

  const editable = amplitudeEnvelopePreset("pluck");
  editable[1].y = 0.25;
  assert.equal(AMPLITUDE_ENVELOPE_PRESETS.pluck[1].y, 1);
  assert.deepEqual(amplitudeEnvelopePreset("missing"), amplitudeEnvelopePreset("sustain"));
});

test("amplitude envelopes sanitize malformed points and preserve node order while editing", () => {
  const sanitized = sanitizeAmplitudeEnvelope([
    { x: 2, y: -1 },
    null,
    { x: 0.4, y: 2 },
    { x: Number.NaN, y: 0.3 },
    { x: -1, y: 0.45 },
  ]);
  assert.equal(sanitized.length, 5);
  assert.ok(sanitized.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1));
  assert.ok(sanitized.every((node, index) => index === 0 || node.x >= sanitized[index - 1].x));
  assert.deepEqual(sanitizeAmplitudeEnvelope(null), amplitudeEnvelopePreset("sustain"));

  const original = amplitudeEnvelopePreset("sustain");
  const moved = updateAmplitudeEnvelopeNode(original, 2, { x: 0.99, y: -2 });
  assert.equal(moved[2].x, original[3].x, "a node cannot cross its right neighbour");
  assert.equal(moved[2].y, 0);
  assert.deepEqual(original, amplitudeEnvelopePreset("sustain"), "editing must be immutable");

  const movedLeft = updateAmplitudeEnvelopeNode(original, 2, { x: -1, y: 2 });
  assert.equal(movedLeft[2].x, original[1].x);
  assert.equal(movedLeft[2].y, 1);
  assert.deepEqual(updateAmplitudeEnvelopeNode(original, 99, { x: 0 }), original);
  assert.equal(updateAmplitudeEnvelopeNode(original, 0, { x: 0.8 })[0].x, 0);
});

test("amplitude envelope sampling interpolates and holds the release endpoint", () => {
  const zeroRelease = [
    { x: 0, y: 0 },
    { x: 0.1, y: 1 },
    { x: 0.3, y: 0.5 },
    { x: 0.6, y: 0.5 },
    { x: 0.8, y: 0 },
  ];
  nearAudio(sampleAmplitudeEnvelope(0.05, zeroRelease), 0.5);
  nearAudio(sampleAmplitudeEnvelope(0.2, zeroRelease), 0.75);
  assert.equal(sampleAmplitudeEnvelope(0.8, zeroRelease), 0);
  assert.equal(sampleAmplitudeEnvelope(0.95, zeroRelease), 0);
  assert.equal(sampleAmplitudeEnvelope(2, zeroRelease), 0);

  const heldRelease = updateAmplitudeEnvelopeNode(zeroRelease, 4, { y: 0.35 });
  assert.equal(sampleAmplitudeEnvelope(0.8, heldRelease), 0.35);
  assert.equal(sampleAmplitudeEnvelope(0.95, heldRelease), 0.35);
  assert.equal(sampleAmplitudeEnvelope(1, heldRelease), 0.35);
  assert.equal(sampleAmplitudeEnvelope(Number.NaN, null), 0);
  assert.equal(sampleAmplitudeEnvelope(undefined, null), 0);
});

test("corner articulation parameters remain independent", () => {
  assert.equal(cornerStrikePeak(0.5, 1), 0.375);
  assert.equal(cornerStrikePeak(1, 0.5), 0.375);
  assert.equal(cornerStrikePeak(0, 1), 0);
  assert.equal(cornerAttackSeconds(0), 0.0005);
  assert.equal(cornerAttackSeconds(4), 0.004);
  assert.equal(cornerAttackSeconds(100), 0.03);
  assert.equal(cornerDecaySeconds(0), 0.015);
  assert.equal(cornerDecaySeconds(15), 0.015);
  assert.equal(cornerDecaySeconds(80), 0.08);
  assert.equal(cornerDecaySeconds(1_000), 1);
  assert.equal(cornerDecaySeconds(2_000), 2);
  assert.equal(cornerDecaySeconds(20_000), 2);
  assert.equal(levelToGain(0), 0);
  assert.equal(levelToGain(0.25), 0.5);
  assert.equal(levelToGain(1), 1);
});

test("sine corner envelope has stronger impact and millisecond decay control", () => {
  // A square's 0.5 corner strength now gets a stronger but still bounded onset.
  assert.equal(sineCornerEnvelopeGain(0.5, 0), 0.36);

  const spatialProfile = [0, 0.25, 0.5, 0.75, 1].map((distance) =>
    sineCornerEnvelopeGain(0.5, distance)
  );
  for (let index = 1; index < spatialProfile.length; index += 1) {
    assert.ok(spatialProfile[index] < spatialProfile[index - 1]);
  }

  // Accent changes the corner rise, not the underlying sine oscillator: even
  // with no accent, the spatial envelope has a strictly positive floor.
  assert.equal(sineCornerEnvelopeGain(1, 0, 0, 650), 0.12);
  assert.ok(sineCornerEnvelopeGain(1, 1, 0, 650) > 0.015);
  assert.ok(
    sineCornerEnvelopeGain(1, 0.6, 1, 4000)
      > sineCornerEnvelopeGain(1, 0.6, 1, 100),
    "longer millisecond decay must retain more corner impact",
  );
  assert.ok(
    sineCornerEnvelopeGain(1, 0.5, 1, 300, 100)
      > sineCornerEnvelopeGain(1, 0.5, 1, 300, 1000),
    "the same decay must cover more of an edge when the cursor moves faster",
  );
  assert.ok(sineCornerEnvelopeGain(1, 0, 1.5, 650) > 0.8);

  // Every public input is bounded before it participates in the envelope.
  assert.equal(
    sineCornerEnvelopeGain(2, -1, 2, -1),
    sineCornerEnvelopeGain(1, 0, 1.5, 20),
  );
  assert.equal(
    sineCornerEnvelopeGain(-1, 2, -1, 2),
    sineCornerEnvelopeGain(0, 1, 0, 20),
  );
});

test("alternating waveform resolves deterministically", () => {
  assert.equal(waveformForIndex("alternating", 0), "sine");
  assert.equal(waveformForIndex("alternating", 1), "triangle");
  assert.equal(waveformForIndex("square", 1), "square");
});

test("contact reduction retains the loudest voices in original order", () => {
  const voices = [
    { frequency: 110, gain: 0.2 },
    { frequency: 220, gain: 0.9 },
    { frequency: 330, gain: 0.5 },
  ];
  assert.deepEqual(
    reduceVoiceContacts(voices, 2).map((voice) => voice.frequency),
    [220, 330],
  );
});

test("normalization caps combined gain without boosting quiet input", () => {
  const loud = normalizeVoiceGains([
    { frequency: 110, gain: 1 },
    { frequency: 220, gain: 1 },
  ]);
  assert.ok(Math.abs(Math.hypot(...loud.map((voice) => voice.gain)) - 1) < 1e-12);

  const quiet = normalizeVoiceGains([{ frequency: 110, gain: 0.25 }]);
  assert.equal(quiet[0]?.gain, 0.25);
});

test("Shape voice scaling follows inverse square-root active voice count", () => {
  for (const count of [1, 4, 9]) {
    const voices = Array.from({ length: count }, (_, index) => ({
      key: `shape:${index}`,
      frequency: 220 + index,
      gain: 0.9,
    }));
    const snapshot = structuredClone(voices);
    const scaled = scaleShapeVoiceGains(voices);
    nearAudio(scaled[0].gain, 0.9 / Math.sqrt(count));
    assert.ok(scaled.every((voice) => voice.gain === scaled[0].gain));
    assert.deepEqual(voices, snapshot, "input voices must not be modified");
    assert.notEqual(scaled[0], voices[0]);
  }

  const partlySilent = scaleShapeVoiceGains([
    { frequency: 110, gain: 0.8 },
    { frequency: 220, gain: 0 },
    { frequency: 330, gain: 0.6 },
  ]);
  nearAudio(partlySilent[0].gain, 0.8 / Math.sqrt(2));
  assert.equal(partlySilent[1].gain, 0);
  nearAudio(partlySilent[2].gain, 0.6 / Math.sqrt(2));
  assert.deepEqual(scaleShapeVoiceGains(null), []);
});

test("phase-aligned strike batches share a 0.78 peak ceiling proportionally", () => {
  const strikes = Array.from({ length: 12 }, (_, index) => ({
    key: `strike:${index}`,
    frequency: 110 + index * 30,
    gain: (index + 1) / 12,
  }));
  const normalized = normalizeStrikeGains(strikes);
  const peakSum = normalized.reduce((sum, strike) => sum + strike.gain, 0);

  assert.ok(peakSum <= 0.78 + 1e-12);
  nearAudio(peakSum, 0.78);
  nearAudio(normalized[11].gain / normalized[0].gain, 12);
  nearAudio(normalized[7].gain / normalized[3].gain, 2);
});

function fakeParam(value = 0) {
  return {
    value,
    calls: [],
    setTargetAtTime(...args) {
      this.value = args[0];
      this.calls.push(["target", ...args]);
    },
    setValueAtTime(...args) {
      this.value = args[0];
      this.calls.push(["value", ...args]);
    },
    exponentialRampToValueAtTime(...args) {
      this.value = args[0];
      this.calls.push(["exponential", ...args]);
    },
    cancelScheduledValues(...args) {
      this.calls.push(["cancel", ...args]);
    },
  };
}

function fakeNode(properties = {}) {
  return {
    ...properties,
    connect() { return this; },
    disconnect() {},
  };
}

test("continuous synth specs use one worklet while native fallback voices stay silent", async () => {
  const previousAudioContext = globalThis.AudioContext;
  const previousAudioWorkletNode = globalThis.AudioWorkletNode;
  const messages = [];
  let moduleUrl = "";
  let workletCount = 0;
  let resumedBeforeWorklet = false;

  class FakeWorkletNode {
    constructor(_context, name, options) {
      workletCount += 1;
      this.name = name;
      this.options = options;
      this.port = { postMessage(message) { messages.push(message); } };
      this.onprocessorerror = null;
    }
    connect() { return this; }
    disconnect() {}
  }

  class FakeContext {
    constructor() {
      this.currentTime = 0;
      this.state = "suspended";
      this.destination = fakeNode();
      const context = this;
      this.audioWorklet = {
        async addModule(url) {
          resumedBeforeWorklet = context.state === "running";
          moduleUrl = String(url);
        },
      };
    }
    createGain() { return fakeNode({ gain: fakeParam(0) }); }
    createStereoPanner() { return fakeNode({ pan: fakeParam(0) }); }
    createDynamicsCompressor() {
      return fakeNode({
        threshold: fakeParam(0),
        knee: fakeParam(0),
        ratio: fakeParam(0),
        attack: fakeParam(0),
        release: fakeParam(0),
      });
    }
    createOscillator() {
      return fakeNode({
        type: "sine",
        frequency: fakeParam(220),
        start() {},
        stop() {},
      });
    }
    async resume() { this.state = "running"; }
    async close() { this.state = "closed"; }
  }

  globalThis.AudioContext = FakeContext;
  globalThis.AudioWorkletNode = FakeWorkletNode;
  const pool = new VoicePool(2);
  try {
    await pool.enable();
    pool.setVoices([{
      key: "shape:contact:0",
      frequency: 330,
      gain: 0.2,
      pan: -0.4,
      mode: "pm",
      synthDrive: 0.75,
      modulationIndex: 2.25,
      modulationRatio: 1.5,
    }]);

    assert.equal(workletCount, 1);
    assert.equal(resumedBeforeWorklet, true, "iOS audio must resume before awaiting worklet load");
    assert.match(moduleUrl, /contour-synth-processor\.js$/);
    assert.equal(pool.synthNode.name, "morphazoid-contour-synth");
    assert.deepEqual(pool.synthNode.options.outputChannelCount, [2]);
    const latest = messages.at(-1);
    assert.equal(latest.type, "voices");
    assert.equal(latest.voices.length, 1);
    assert.equal(latest.voices[0].mode, "pm");
    assert.equal(latest.voices[0].modulationIndex, 2.25);
    assert.ok(pool.voices.every((voice) => voice.gain.gain.value === 0));

    pool.setVoiceTrajectory([{
      key: "shape:contact:0",
      frequency: 330,
      gain: 0.2,
      mode: "fm",
      modulationIndex: 1,
    }], [{
      key: "shape:contact:0",
      frequency: 440,
      gain: 0.16,
      mode: "fm",
      modulationIndex: 5,
    }], 0.075);
    const trajectory = messages.at(-1);
    assert.equal(trajectory.durationSeconds, 0.075);
    assert.equal(trajectory.voices[0].frequency, 330);
    assert.equal(trajectory.nextVoices[0].frequency, 440);
    assert.equal(trajectory.nextVoices[0].modulationIndex, 5);

    pool.silence();
    assert.deepEqual(messages.at(-1), { type: "voices", voices: [] });
  } finally {
    await pool.close();
    if (previousAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previousAudioContext;
    if (previousAudioWorkletNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previousAudioWorkletNode;
  }
});

test("strike headroom tracks scheduled exponential envelopes and overlapping tails", () => {
  const pool = new VoicePool(0);
  const created = [];
  pool.context = {
    currentTime: 10,
    createOscillator() {
      const oscillator = fakeNode({
        type: "sine",
        frequency: fakeParam(220),
        start() {},
        stop() {},
        onended: null,
      });
      created.push(oscillator);
      return oscillator;
    },
    createGain() { return fakeNode({ gain: fakeParam(0) }); },
    createStereoPanner() { return fakeNode({ pan: fakeParam(0) }); },
  };
  pool.master = fakeNode();
  pool.enabled = true;

  assert.equal(pool.strike(
    { key: "headroom:inaudible", frequency: 330, gain: 0.0001 },
  ), false, "sub-floor strikes must not overbook a nearly exhausted batch");

  assert.equal(pool.strike(
    { key: "headroom:solo", frequency: 440, gain: 0.4 },
    { attackSeconds: 0.01, decaySeconds: 0.09, startDelaySeconds: 0.05 },
  ), true);

  const [solo] = [...pool.activeStrikes];
  assert.deepEqual({
    startedAt: solo.startedAt,
    attackEndsAt: solo.attackEndsAt,
    endedAt: solo.endedAt,
    peakGain: solo.peakGain,
  }, {
    startedAt: 10.05,
    attackEndsAt: 10.06,
    endedAt: 10.15,
    peakGain: 0.4,
  });

  // A delayed strike reserves its eventual peak immediately. This prevents a
  // following animation frame from claiming the same budget before it starts.
  nearAudio(pool.availableStrikeHeadroom(), 0.38);

  pool.context.currentTime = 10.055;
  nearAudio(pool.availableStrikeHeadroom(), 0.38);

  // At the attack peak, its full requested gain occupies the shared budget.
  pool.context.currentTime = 10.06;
  nearAudio(pool.availableStrikeHeadroom(), 0.38);

  // Web Audio interpolates exponential ramps geometrically, not linearly.
  pool.context.currentTime = 10.105;
  nearAudio(
    pool.availableStrikeHeadroom(),
    0.78 - Math.sqrt(0.4 * 0.0001),
  );

  // The metadata may remain until onended, but an ended envelope is ignored.
  pool.context.currentTime = 10.15;
  assert.equal(pool.activeStrikeCount, 1);
  nearAudio(pool.availableStrikeHeadroom(), 0.78);

  // Multiple future strikes reserve their combined peaks, too.
  pool.context.currentTime = 11;
  assert.equal(pool.strike(
    { key: "headroom:a", frequency: 550, gain: 0.5 },
    { attackSeconds: 0.01, decaySeconds: 0.09, startDelaySeconds: 0.05 },
  ), true);
  assert.equal(pool.strike(
    { key: "headroom:b", frequency: 660, gain: 0.4 },
    { attackSeconds: 0.01, decaySeconds: 0.09, startDelaySeconds: 0.05 },
  ), true);
  assert.equal(pool.availableStrikeHeadroom(), 0);

  pool.context.currentTime = 11.06;
  assert.equal(pool.availableStrikeHeadroom(), 0);
  assert.equal(pool.availableStrikeHeadroom(0.5), 0);

  pool.context.currentTime = 11.105;
  nearAudio(
    pool.availableStrikeHeadroom(),
    0.78
      - Math.sqrt(0.5 * 0.0001)
      - Math.sqrt(0.4 * 0.0001),
  );

  pool.context.currentTime = 11.15;
  nearAudio(pool.availableStrikeHeadroom(), 0.78);
  assert.equal(created.length, 3);
});

test("keyed voices keep their oscillator slots when specs reorder", () => {
  const pool = new VoicePool(2);
  pool.context = { currentTime: 1 };
  pool.voices = [0, 1].map((index) => ({
    oscillator: fakeNode({ id: index, type: "sine", frequency: fakeParam(220) }),
    gain: fakeNode({ gain: fakeParam(0) }),
    pan: fakeNode({ pan: fakeParam(0) }),
    key: null,
  }));

  pool.applyVoices([
    { key: "upper", frequency: 220, gain: 0.1 },
    { key: "lower", frequency: 330, gain: 0.1 },
  ]);
  const upperSlot = pool.voices.findIndex((voice) => voice.key === "upper");
  const lowerSlot = pool.voices.findIndex((voice) => voice.key === "lower");

  pool.applyVoices([
    { key: "lower", frequency: 331, gain: 0.1 },
    { key: "upper", frequency: 221, gain: 0.1 },
  ]);
  assert.equal(pool.voices[upperSlot].key, "upper");
  assert.equal(pool.voices[lowerSlot].key, "lower");
});

test("same-key strikes debounce clicks but overlap naturally after 12 ms", () => {
  const pool = new VoicePool(1);
  const created = [];
  pool.context = {
    currentTime: 2,
    createOscillator() {
      const oscillator = fakeNode({
        type: "sine",
        frequency: fakeParam(220),
        startCalls: [],
        stopCalls: [],
        start(...args) { this.startCalls.push(args); },
        stop(...args) { this.stopCalls.push(args); },
        onended: null,
      });
      created.push(oscillator);
      return oscillator;
    },
    createGain() { return fakeNode({ gain: fakeParam(0) }); },
    createStereoPanner() { return fakeNode({ pan: fakeParam(0) }); },
  };
  pool.master = fakeNode();
  pool.enabled = true;

  assert.equal(pool.strike(
    {
      key: "corner:scan:0:2",
      frequency: 440,
      gain: 0.2,
      pan: -0.4,
      waveform: "triangle",
    },
    { attackSeconds: 0.004, decaySeconds: 0.06 },
  ), true);
  assert.equal(pool.activeStrikeCount, 1);
  assert.equal(pool.pendingVoices.length, 0);
  assert.equal(created[0].type, "triangle");
  assert.deepEqual(created[0].startCalls, [[2]]);
  assert.ok(Math.abs(created[0].stopCalls[0][0] - 2.076) < 1e-12);

  pool.context.currentTime = 2.011;
  assert.equal(pool.strike(
    { key: "corner:scan:0:2", frequency: 440, gain: 0.2 },
    { attackSeconds: 0.004, decaySeconds: 0.06 },
  ), false);
  assert.equal(created.length, 1);

  const firstGain = [...pool.activeStrikes][0].gain.gain;
  const firstNaturalStop = created[0].stopCalls[0][0];
  pool.context.currentTime = 2.013;
  assert.equal(pool.strike(
    { key: "corner:scan:0:2", frequency: 660, gain: 0.15 },
    { attackSeconds: 0.003, decaySeconds: 0.09 },
  ), true);

  assert.equal(created.length, 2);
  assert.equal(pool.activeStrikeCount, 2);
  assert.equal(created[0].stopCalls.length, 1);
  assert.equal(created[0].stopCalls[0][0], firstNaturalStop);
  assert.equal(firstGain.calls.some(([kind]) => kind === "cancel"), false);
  assert.ok(created[1].startCalls[0][0] < firstNaturalStop, "tails should overlap naturally");

  created[0].onended();
  assert.equal(pool.activeStrikeCount, 1);
  assert.equal(pool.activeStrikeByKey.size, 1);
  created[1].onended();
  assert.equal(pool.activeStrikeCount, 0);
  assert.equal(pool.activeStrikeByKey.size, 0);
});

test("crossfade retriggers release the previous same-key percussion voice", () => {
  const pool = new VoicePool(0);
  const created = [];
  pool.context = {
    currentTime: 1,
    createOscillator() {
      const oscillator = fakeNode({
        type: "sine",
        frequency: fakeParam(220),
        start() {},
        stopCalls: [],
        stop(...args) { this.stopCalls.push(args); },
        onended: null,
      });
      created.push(oscillator);
      return oscillator;
    },
    createGain() { return fakeNode({ gain: fakeParam(0) }); },
    createStereoPanner() { return fakeNode({ pan: fakeParam(0) }); },
  };
  pool.master = fakeNode();
  pool.enabled = true;

  assert.equal(pool.strike(
    { key: "lattice:edge-a", frequency: 330, gain: 0.2 },
    { attackSeconds: 0.004, decaySeconds: 0.2, retriggerMode: "crossfade" },
  ), true);
  const first = [...pool.activeStrikes][0];
  pool.context.currentTime = 1.02;
  assert.equal(pool.strike(
    { key: "lattice:edge-a", frequency: 440, gain: 0.2 },
    { attackSeconds: 0.004, decaySeconds: 0.2, retriggerMode: "crossfade" },
  ), true);
  assert.equal(created.length, 2);
  assert.ok(first.gain.gain.calls.some(([kind]) => kind === "cancel"));
  assert.equal(created[0].stopCalls.length, 2);
  assert.ok(created[0].stopCalls[1][0] < created[0].stopCalls[0][0]);
});

test("corner strikes schedule delayed attacks and the full 2000 ms decay", () => {
  const pool = new VoicePool(0);
  const created = [];
  pool.context = {
    currentTime: 5,
    createOscillator() {
      const oscillator = fakeNode({
        type: "sine",
        frequency: fakeParam(220),
        startCalls: [],
        stopCalls: [],
        start(...args) { this.startCalls.push(args); },
        stop(...args) { this.stopCalls.push(args); },
        onended: null,
      });
      created.push(oscillator);
      return oscillator;
    },
    createGain() { return fakeNode({ gain: fakeParam(0) }); },
    createStereoPanner() { return fakeNode({ pan: fakeParam(0) }); },
  };
  pool.master = fakeNode();
  pool.enabled = true;

  assert.equal(pool.strike(
    {
      key: "corner:point:3:8",
      frequency: 880,
      gain: 0.4,
      pan: 0.6,
      waveform: "square",
    },
    { attackSeconds: 0.003, decaySeconds: 2, startDelaySeconds: 0.025 },
  ), true);

  const [strike] = [...pool.activeStrikes];
  const startAt = 5.025;
  const endAt = startAt + 0.003 + 2;
  nearAudio(created[0].startCalls[0][0], startAt);
  nearAudio(created[0].stopCalls[0][0], endAt + 0.012);
  assert.deepEqual(created[0].frequency.calls, [["value", 880, startAt]]);
  assert.deepEqual(strike.pan.pan.calls, [["value", 0.6, startAt]]);
  assert.deepEqual(strike.gain.gain.calls.map(([kind]) => kind), [
    "value",
    "exponential",
    "exponential",
    "value",
  ]);
  nearAudio(strike.gain.gain.calls[0][2], startAt);
  nearAudio(strike.gain.gain.calls[1][2], startAt + 0.003);
  nearAudio(strike.gain.gain.calls[2][2], endAt);
  nearAudio(strike.gain.gain.calls[3][2], endAt + 0.008);
  assert.equal(strike.gain.gain.calls[3][1], 0);
});

function nearAudio(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

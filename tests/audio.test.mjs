import assert from "node:assert/strict";
import test from "node:test";

import {
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
  sineCornerEnvelopeGain,
  VoicePool,
  waveformForIndex,
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
  assert.equal(pitch01ToFrequency(0, 110, 2), 110);
  assert.equal(pitch01ToFrequency(0.5, 110, 2), 220);
  assert.equal(pitch01ToFrequency(1, 110, 2), 440);
  assert.equal(pitch01ToFrequency(-1, 110, 2), 110);
  assert.equal(pitch01ToFrequency(2, 110, 2), 440);
  assert.equal(pitch01ToFrequency(1, 18_000, 10), 20_000);
});

test("mark mapping curves are bounded and preserve their intended shape", () => {
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

test("sine corner envelope preserves the original single-oscillator profile", () => {
  // A square turns through 90 degrees, giving it a normalized corner strength
  // of 0.5. At the corner, the default Tesselateher profile is its 0.12
  // continuous sine level plus the corner-shaped amplitude rise.
  assert.equal(sineCornerEnvelopeGain(0.5, 0), 0.2475);

  const spatialProfile = [0, 0.25, 0.5, 0.75, 1].map((distance) =>
    sineCornerEnvelopeGain(0.5, distance)
  );
  for (let index = 1; index < spatialProfile.length; index += 1) {
    assert.ok(spatialProfile[index] < spatialProfile[index - 1]);
  }

  // Accent changes the corner rise, not the underlying sine oscillator: even
  // with no accent, the spatial envelope has a strictly positive floor.
  assert.equal(sineCornerEnvelopeGain(1, 0, 0, 1), 0.12);
  assert.ok(sineCornerEnvelopeGain(1, 1, 0, 1) > 0.006);

  // Every public input is bounded before it participates in the envelope.
  assert.equal(
    sineCornerEnvelopeGain(2, -1, 2, -1),
    sineCornerEnvelopeGain(1, 0, 1, 0),
  );
  assert.equal(
    sineCornerEnvelopeGain(-1, 2, -1, 2),
    sineCornerEnvelopeGain(0, 1, 0, 1),
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
  assert.ok(Math.abs(created[0].stopCalls[0][0] - 2.084) < 1e-12);

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
  nearAudio(created[0].stopCalls[0][0], endAt + 0.02);
  assert.deepEqual(created[0].frequency.calls, [["value", 880, startAt]]);
  assert.deepEqual(strike.pan.pan.calls, [["value", 0.6, startAt]]);
  assert.deepEqual(strike.gain.gain.calls.map(([kind]) => kind), [
    "value",
    "exponential",
    "exponential",
  ]);
  nearAudio(strike.gain.gain.calls[0][2], startAt);
  nearAudio(strike.gain.gain.calls[1][2], startAt + 0.003);
  nearAudio(strike.gain.gain.calls[2][2], endAt);
});

function nearAudio(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

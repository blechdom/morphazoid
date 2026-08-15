import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DRUM_ROLL_DEFAULTS,
  DRUM_ROLL_PHASE_SEED,
  DRUM_ROLL_PRESETS,
  DrumRollPleaseAudio,
  advanceDrumRollPosition,
  calculateDrumRollLayers,
  drumRollRateSafety,
  drumRollWindow,
  sanitizeDrumRollParams,
} from "../src/drum-roll-please.js";

const ROOT = new URL("../", import.meta.url);

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

function percentile(values, proportion) {
  assert.ok(values.length > 0, "percentile requires at least one value");
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(proportion * (sorted.length - 1))),
  );
  return sorted[position];
}

function windowRms(samples, windowSize = 240) {
  const levels = [];
  for (let offset = 0; offset + windowSize <= samples.length; offset += windowSize) {
    let squareSum = 0;
    for (let index = 0; index < windowSize; index += 1) {
      squareSum += samples[offset + index] ** 2;
    }
    levels.push(Math.sqrt(squareSum / windowSize));
  }
  return levels;
}

function assertNormalizedMorphWeights(layer, label = `layer ${layer.index}`) {
  assert.ok(Object.isFrozen(layer.morphWeights), `${label} morph weights are mutable`);
  const entries = Object.entries(layer.morphWeights);
  assert.deepEqual(entries.map(([name]) => name), ["kick", "tom", "hand", "air"]);
  const total = entries.reduce((sum, [, amount]) => {
    assert.ok(Number.isFinite(amount), `${label} has a non-finite morph weight`);
    assert.ok(amount >= 0 && amount <= 1, `${label} morph weight escaped [0, 1]`);
    return sum + amount;
  }, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `${label} morph weights sum to ${total}`);
}

test("Drum Roll parameters are finite, bounded, directional, and immutable", () => {
  const sanitized = sanitizeDrumRollParams({
    direction: -0.001,
    driftRate: 99,
    centerRate: -4,
    width: 99,
    decay: Number.NaN,
    character: Infinity,
    morphDepth: 99,
    centerPitch: -99,
    cutoff: 99_000,
    stripeAngle: -99,
    pitchFollow: true,
    spread: -2,
    level: 9,
  });

  assert.deepEqual(Object.keys(sanitized), Object.keys(DRUM_ROLL_DEFAULTS));
  assert.equal(sanitized.direction, -1);
  assert.equal(sanitized.driftRate, 1.2);
  assert.equal(sanitized.centerRate, 0.5);
  assert.equal(sanitized.width, 9);
  assert.equal(sanitized.decay, DRUM_ROLL_DEFAULTS.decay);
  assert.equal(sanitized.character, DRUM_ROLL_DEFAULTS.character);
  assert.equal(sanitized.morphDepth, 1);
  assert.equal(sanitized.pitchFollow, true);
  assert.ok(sanitized.centerPitch >= 20 && sanitized.centerPitch <= 20_000);
  assert.ok(sanitized.cutoff >= 800 && sanitized.cutoff <= 20_000);
  assert.ok(sanitized.stripeAngle >= 10 && sanitized.stripeAngle <= 80);
  assert.equal(sanitized.spread, 0);
  assert.equal(sanitized.level, 0.82);
  assert.ok(Object.isFrozen(sanitized));

  const fallback = sanitizeDrumRollParams({
    direction: Number.NaN,
    driftRate: Number.NaN,
    centerRate: Infinity,
    width: -Infinity,
    decay: Infinity,
    character: Number.NaN,
    morphDepth: Number.NaN,
    centerPitch: Number.NaN,
    cutoff: Number.NaN,
    stripeAngle: Number.NaN,
    spread: Infinity,
    level: Number.NaN,
  });
  assert.deepEqual(fallback, DRUM_ROLL_DEFAULTS);
  assert.equal(sanitizeDrumRollParams({ pitchFollow: false }).pitchFollow, false);
  assert.equal(sanitizeDrumRollParams({ pitchFollow: true }).pitchFollow, true);
});

test("tempo window and strike-rate guard fade continuously to silent edges", () => {
  assert.equal(drumRollWindow(-2.5, 5), 0);
  assert.equal(drumRollWindow(2.5, 5), 0);
  assert.equal(drumRollWindow(0, 5), 1);
  assert.ok(Math.abs(drumRollWindow(-1.25, 5) - 0.5) < 1e-12);
  assert.equal(drumRollWindow(-1.25, 5), drumRollWindow(1.25, 5));

  assert.equal(drumRollRateSafety(0.0625), 0);
  assert.ok(Math.abs(drumRollRateSafety(0.09375) - 0.5) < 1e-12);
  assert.equal(drumRollRateSafety(0.125), 1);
  assert.equal(drumRollRateSafety(48), 1);
  assert.ok(Math.abs(drumRollRateSafety(72) - 0.5) < 1e-12);
  assert.equal(drumRollRateSafety(96), 0);
  assert.equal(drumRollRateSafety(Number.NaN), 0);
});

test("rhythmic position reports octave wraps in either direction", () => {
  assert.deepEqual(advanceDrumRollPosition(0.9, 0.25), {
    position: 0.1499999999999999,
    wraps: 1,
  });
  assert.deepEqual(advanceDrumRollPosition(0.1, -0.25), {
    position: 0.8500000000000001,
    wraps: -1,
  });
  assert.deepEqual(advanceDrumRollPosition(0.2, 2.25), {
    position: 0.4500000000000002,
    wraps: 2,
  });
});

test("adjacent rhythm layers stay exactly 2:1 and the bank is power normalized", () => {
  const frame = calculateDrumRollLayers({
    position: 0.37,
    centerRate: 4,
    width: 7,
    decay: 0.18,
    spread: 0.6,
  });

  assert.equal(frame.layers.length, 17);
  assert.ok(frame.activeLayers >= 5);
  assert.equal(frame.audibleLayers, frame.activeLayers);
  for (let index = 1; index < frame.layers.length; index += 1) {
    assert.ok(
      Math.abs(frame.layers[index].hitRate / frame.layers[index - 1].hitRate - 2)
        < 1e-12,
    );
  }
  assert.ok(Math.abs(frame.normalization ** 2 * frame.weightPower - 1) < 1e-12);
  assert.ok(frame.layers.every((layer) => (
    Number.isFinite(layer.hitRate)
    && Number.isFinite(layer.gain)
    && Number.isFinite(layer.pan)
    && layer.weight >= 0
    && layer.safety >= 0
    && layer.safety <= 1
  )));
  assert.ok(Object.isFrozen(frame));
  assert.ok(Object.isFrozen(frame.layers));
  assert.ok(frame.layers.every(Object.isFrozen));
});

test("visible layers morph continuously through Rattlesnake characters", () => {
  const frame = calculateDrumRollLayers({
    position: 0.37,
    centerRate: 3,
    centerPitch: 180,
    width: 7,
    character: 0.5,
    morphDepth: 1,
    pitchFollow: false,
  });
  const visible = frame.layers.filter(({ weight }) => weight > 1e-5);
  assert.ok(visible.length >= 5);

  let previousPosition = -Infinity;
  const dominantCharacters = new Set();
  for (const layer of frame.layers) {
    assert.ok(
      Number.isFinite(layer.morphPosition)
        && layer.morphPosition >= 0
        && layer.morphPosition <= 1,
      `layer ${layer.index} has invalid morph position ${layer.morphPosition}`,
    );
    assert.ok(
      layer.morphPosition + 1e-12 >= previousPosition,
      "percussion character must progress from the slow edge to the fast edge",
    );
    previousPosition = layer.morphPosition;
    assertNormalizedMorphWeights(layer);

    if (layer.weight > 1e-5) {
      const dominant = Object.entries(layer.morphWeights)
        .sort((left, right) => right[1] - left[1])[0][0];
      dominantCharacters.add(dominant);
    }
  }

  const slow = visible[0].morphWeights;
  const fast = visible.at(-1).morphWeights;
  assert.ok(slow.kick + slow.tom > fast.kick + fast.tom);
  assert.ok(fast.hand + fast.air > slow.hand + slow.air);
  assert.ok(
    dominantCharacters.size >= 3,
    `expected waves of distinct percussion, got ${[...dominantCharacters].join(", ")}`,
  );

  const flatMorph = calculateDrumRollLayers({
    position: 0.37,
    centerRate: 3,
    centerPitch: 180,
    width: 7,
    character: 0.5,
    morphDepth: 0,
    pitchFollow: false,
  }).layers.filter(({ weight }) => weight > 1e-5);
  assert.ok(flatMorph.length >= 5);
  assert.ok(flatMorph.every((layer) => (
    Math.abs(layer.morphPosition - flatMorph[0].morphPosition) < 1e-12
  )));
});

test("pitch follow adds a Shepard pitch bank without changing the rhythm bank", () => {
  const common = {
    position: 0.19,
    centerRate: 3,
    centerPitch: 180,
    width: 5,
    character: 0.5,
    morphDepth: 1,
    decay: 0.09,
    spread: 0.4,
  };
  const rhythmOnly = calculateDrumRollLayers({ ...common, pitchFollow: false });
  const rhythmAndPitch = calculateDrumRollLayers({ ...common, pitchFollow: true });

  assert.equal(rhythmOnly.pitchFollow, false);
  assert.equal(rhythmAndPitch.pitchFollow, true);
  assert.equal(rhythmOnly.layers.length, rhythmAndPitch.layers.length);

  for (let index = 0; index < rhythmOnly.layers.length; index += 1) {
    const unpitched = rhythmOnly.layers[index];
    const pitched = rhythmAndPitch.layers[index];
    for (const key of ["hitRate", "window", "safety", "weight", "gain", "pan"]) {
      assert.equal(pitched[key], unpitched[key], `pitch follow changed ${key}`);
    }
    assert.equal(pitched.morphPosition, unpitched.morphPosition);
    assert.deepEqual(pitched.morphWeights, unpitched.morphWeights);
    assert.ok(relativeError(unpitched.fundamentalHz, common.centerPitch) < 1e-12);
    assert.equal(unpitched.sourceHz, unpitched.fundamentalHz);
    assert.equal(pitched.sourceHz, pitched.fundamentalHz);
  }

  for (let index = 1; index < rhythmAndPitch.layers.length; index += 1) {
    const lower = rhythmAndPitch.layers[index - 1];
    const upper = rhythmAndPitch.layers[index];
    assert.ok(relativeError(upper.fundamentalHz / lower.fundamentalHz, 2) < 1e-12);
  }
});

test("crossing the rhythmic octave seam only relabels equivalent layers", () => {
  const epsilon = 1e-9;
  const common = {
    centerRate: 4,
    centerPitch: 160,
    width: 7,
    decay: 0.2,
    character: 0.5,
    morphDepth: 1,
    pitchFollow: true,
    spread: 0.5,
  };
  const acceleratingBefore = calculateDrumRollLayers({
    ...common,
    direction: 1,
    position: 1 - epsilon,
  });
  const acceleratingAfter = calculateDrumRollLayers({
    ...common,
    direction: 1,
    position: epsilon,
  });
  const deceleratingBefore = calculateDrumRollLayers({
    ...common,
    direction: -1,
    position: epsilon,
  });
  const deceleratingAfter = calculateDrumRollLayers({
    ...common,
    direction: -1,
    position: 1 - epsilon,
  });

  let compared = 0;
  for (let index = 0; index < acceleratingBefore.layers.length - 1; index += 1) {
    const before = acceleratingBefore.layers[index];
    const after = acceleratingAfter.layers[index + 1];
    if (Math.max(before.weight, after.weight) < 1e-5) continue;
    compared += 1;
    assert.ok(relativeError(after.hitRate, before.hitRate) < 2e-8);
    assert.ok(Math.abs(after.weight - before.weight) < 2e-8);
    assert.ok(relativeError(after.gain, before.gain) < 3e-8);
    assert.ok(Math.abs(after.morphPosition - before.morphPosition) < 2e-8);
    assert.ok(relativeError(after.fundamentalHz, before.fundamentalHz) < 2e-8);
    for (const name of ["kick", "tom", "hand", "air"]) {
      assert.ok(
        Math.abs(after.morphWeights[name] - before.morphWeights[name]) < 2e-8,
        `accelerating seam changed ${name} character`,
      );
    }

    const reverseBefore = deceleratingBefore.layers[index + 1];
    const reverseAfter = deceleratingAfter.layers[index];
    assert.ok(relativeError(reverseAfter.hitRate, reverseBefore.hitRate) < 2e-8);
    assert.ok(Math.abs(reverseAfter.weight - reverseBefore.weight) < 2e-8);
    assert.ok(relativeError(reverseAfter.gain, reverseBefore.gain) < 3e-8);
    assert.ok(
      Math.abs(reverseAfter.morphPosition - reverseBefore.morphPosition) < 2e-8,
    );
    assert.ok(
      relativeError(reverseAfter.fundamentalHz, reverseBefore.fundamentalHz) < 2e-8,
    );
    for (const name of ["kick", "tom", "hand", "air"]) {
      assert.ok(
        Math.abs(reverseAfter.morphWeights[name] - reverseBefore.morphWeights[name]) < 2e-8,
        `decelerating seam changed ${name} character`,
      );
    }
  }
  assert.ok(compared >= 5);
  assert.ok(
    Math.abs(acceleratingBefore.weightPower - acceleratingAfter.weightPower)
      < 5e-8,
  );
});

test("preset bank is frozen, unique, valid, and supports both infinite directions", () => {
  assert.ok(Object.isFrozen(DRUM_ROLL_DEFAULTS));
  assert.ok(Object.isFrozen(DRUM_ROLL_PRESETS));
  assert.ok(DRUM_ROLL_PRESETS.length >= 4);
  assert.ok(DRUM_ROLL_PRESETS.every(Object.isFrozen));
  assert.equal(
    new Set(DRUM_ROLL_PRESETS.map(({ id }) => id)).size,
    DRUM_ROLL_PRESETS.length,
  );
  assert.ok(DRUM_ROLL_PRESETS.some(({ direction }) => direction === 1));
  assert.ok(DRUM_ROLL_PRESETS.some(({ direction }) => direction === -1));

  for (const preset of DRUM_ROLL_PRESETS) {
    const safe = sanitizeDrumRollParams(preset);
    for (const key of Object.keys(DRUM_ROLL_DEFAULTS)) {
      assert.equal(safe[key], preset[key], `${preset.id}.${key}`);
    }
  }
});

test("audio wrapper remains lazy and sends sanitized parameter and transport messages", async () => {
  const scheduled = [];
  const runtime = {
    clearTimeout(id) {
      scheduled.push(["clear", id]);
    },
    setTimeout(callback, delay) {
      scheduled.push(["set", callback, delay]);
      return 41;
    },
  };
  const audio = new DrumRollPleaseAudio(runtime);
  assert.equal(audio.context, null);
  assert.equal(audio.node, null);

  audio.setParameters({ direction: -1, centerRate: 999, level: 0.7 });
  assert.equal(audio.context, null, "setParameters must not eagerly create audio");
  assert.equal(audio.params.direction, -1);
  assert.equal(audio.params.centerRate, 16);
  assert.equal(audio.params.level, 0.7);

  const messages = [];
  const ramps = [];
  const filterTargets = [];
  let resumes = 0;
  audio.context = {
    state: "running",
    currentTime: 3,
    async resume() {
      resumes += 1;
    },
  };
  audio.node = {
    port: {
      postMessage(message) {
        messages.push(message);
      },
    },
  };
  audio.lowpass = {
    frequency: {
      setTargetAtTime(...args) {
        filterTargets.push(args);
      },
    },
  };
  audio.master = {
    gain: {
      value: 0,
      cancelScheduledValues(time) {
        ramps.push(["cancel", time]);
      },
      setValueAtTime(value, time) {
        this.value = value;
        ramps.push(["set", value, time]);
      },
      linearRampToValueAtTime(value, time) {
        this.value = value;
        ramps.push(["ramp", value, time]);
      },
      setTargetAtTime(value, time, constant) {
        ramps.push(["target", value, time, constant]);
      },
    },
  };

  audio.setParameters({
    character: 0.7,
    morphDepth: 0.82,
    centerPitch: 220,
    pitchFollow: true,
    cutoff: 9_000,
    stripeAngle: 52,
    spread: 99,
  });
  assert.deepEqual(messages.at(-1), {
    type: "parameters",
    parameters: sanitizeDrumRollParams({
      ...DRUM_ROLL_DEFAULTS,
      direction: -1,
      centerRate: 16,
      level: 0.7,
      character: 0.7,
      morphDepth: 0.82,
      centerPitch: 220,
      pitchFollow: true,
      cutoff: 9_000,
      stripeAngle: 52,
      spread: 1,
    }),
  });
  assert.deepEqual(filterTargets.at(-1), [9_000, 3, 0.025]);

  await audio.start();
  assert.equal(resumes, 1);
  assert.equal(audio.enabled, true);
  assert.deepEqual(messages.at(-1), { type: "active", value: true });
  assert.deepEqual(ramps.at(-1), ["ramp", 0.7, 3.035]);

  audio.setParameters({ level: 0.42 });
  assert.deepEqual(ramps.at(-1), ["target", 0.42, 3, 0.015]);
  audio.stop();
  assert.equal(audio.enabled, false);
  assert.deepEqual(messages.at(-1), { type: "active", value: false });
  assert.deepEqual(ramps.at(-1), ["ramp", 0, 3.035]);
  assert.equal(scheduled.at(-1)[0], "set");
  assert.equal(scheduled.at(-1)[2], 55);
});

test("worklet process reuses typed-array state without render-loop allocations", async () => {
  const source = await readFile(
    new URL("src/drum-roll-please.js", ROOT),
    "utf8",
  );
  const start = source.indexOf("    process(_inputs, outputs) {");
  const end = source.indexOf("\n      return true;\n    }\n  };", start);
  assert.ok(start >= 0 && end > start);
  const processBody = source.slice(start, end);
  assert.doesNotMatch(processBody, /\bnew\s+/);
  assert.doesNotMatch(processBody, /Array\.from|\.(?:map|filter|reduce)\(/);
  assert.match(source, /pulsePhases = new Float64Array\(LAYER_COUNT\)/);
  assert.match(source, /slowEnvelopes = new Float64Array\(LAYER_COUNT\)/);
  assert.match(source, /fastEnvelopes = new Float64Array\(LAYER_COUNT\)/);
});

test("worklet registers once and renders bounded stereo audio through both seams", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;
  let registeredName = null;
  let registrationCount = 0;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (name, ProcessorConstructor) => {
    registeredName = name;
    Processor = ProcessorConstructor;
    registrationCount += 1;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/drum-roll-please.js?worklet-test=${Date.now()}`);
    assert.equal(registeredName, "morphazoid-drum-roll-please");
    assert.equal(registrationCount, 1);
    assert.equal(typeof Processor, "function");

    for (const direction of [1, -1]) {
      const processor = new Processor({
        processorOptions: {
          direction,
          driftRate: 1.2,
          centerRate: 8,
          width: 7,
          decay: 0.12,
          character: 0.7,
          morphDepth: 1,
          pitchFollow: direction > 0,
          centerPitch: 140,
          cutoff: 12_000,
          stripeAngle: 44,
          spread: 0.8,
          level: 0.58,
        },
      });
      assert.ok(processor.pulsePhases instanceof Float64Array);
      assert.ok(
        Math.abs(processor.pulsePhases[0] - DRUM_ROLL_PHASE_SEED) < 1e-12,
      );
      assert.ok(processor.slowEnvelopes instanceof Float64Array);
      assert.ok(processor.fastEnvelopes instanceof Float64Array);
      const stateArrays = Object.entries(processor).filter(([, value]) => (
        ArrayBuffer.isView(value) && !(value instanceof DataView)
      ));
      assert.ok(stateArrays.length >= 12, "per-layer synthesis state should use typed arrays");
      processor.position = direction > 0 ? 0.9995 : 0.0005;
      processor.port.onmessage({ data: { type: "active", value: true } });

      let previousPosition = processor.position;
      let previousLeft = 0;
      let crossedSeam = false;
      let peak = 0;
      let squareSum = 0;
      let stereoDifference = 0;
      let maximumStep = 0;
      let sampleCount = 0;

      for (let block = 0; block < 220; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        assert.equal(processor.process([], [[left, right]]), true);
        if (direction > 0 && processor.position < previousPosition) {
          crossedSeam = true;
        }
        if (direction < 0 && processor.position > previousPosition) {
          crossedSeam = true;
        }
        previousPosition = processor.position;

        for (let index = 0; index < left.length; index += 1) {
          assert.ok(Number.isFinite(left[index]));
          assert.ok(Number.isFinite(right[index]));
          peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
          maximumStep = Math.max(maximumStep, Math.abs(left[index] - previousLeft));
          squareSum += left[index] ** 2 + right[index] ** 2;
          stereoDifference += Math.abs(left[index] - right[index]);
          previousLeft = left[index];
          sampleCount += 2;
        }
      }

      const rms = Math.sqrt(squareSum / sampleCount);
      assert.ok(crossedSeam, `${direction} render never crossed its octave seam`);
      assert.ok(rms > 0.005, `${direction} render was unexpectedly silent: ${rms}`);
      assert.ok(rms < 0.25, `${direction} render was unexpectedly loud: ${rms}`);
      assert.ok(peak < 0.75, `${direction} render peak escaped its ceiling: ${peak}`);
      assert.ok(
        maximumStep < 0.6,
        `${direction} render contained an abrupt discontinuity: ${maximumStep}`,
      );
      assert.ok(
        stereoDifference / (sampleCount * 0.5) > 1e-4,
        `${direction} render collapsed unexpectedly to mono`,
      );
      for (const [name, reference] of stateArrays) {
        assert.strictEqual(
          processor[name],
          reference,
          `${name} was reallocated inside the render loop`,
        );
      }
    }

    const transientProcessor = new Processor({
      processorOptions: DRUM_ROLL_DEFAULTS,
    });
    transientProcessor.port.onmessage({ data: { type: "active", value: true } });
    const warmupBlocks = 120;
    const measuredBlocks = 1_800;
    const rendered = new Float32Array(measuredBlocks * 128);
    let writeOffset = 0;
    for (let block = 0; block < warmupBlocks + measuredBlocks; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(transientProcessor.process([], [[left, right]]), true);
      if (block >= warmupBlocks) {
        rendered.set(left, writeOffset);
        writeOffset += left.length;
      }
    }

    // Five-millisecond loudness windows distinguish articulated hits from a
    // continuously noisy bed without depending on the final master level.
    const levels = windowRms(rendered, 240);
    const p10 = percentile(levels, 0.1);
    const median = percentile(levels, 0.5);
    const p90 = percentile(levels, 0.9);
    const p95 = percentile(levels, 0.95);
    const peakToMedian = p95 / Math.max(1e-9, median);
    const hitToTail = p90 / Math.max(1e-9, p10);
    assert.ok(
      peakToMedian > 2.5,
      `default roll lacks transient contrast (p95 / median ${peakToMedian})`,
    );
    assert.ok(
      hitToTail > 4,
      `default roll behaves like a noise bed (p90 / p10 ${hitToTail})`,
    );
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("Drum Roll Please page uses Shepard-aligned controls and an accessible pitch toggle", async () => {
  const [markup, app, audioModule] = await Promise.all([
    readFile(new URL("drum-roll-please.html", ROOT), "utf8"),
    readFile(new URL("drum-roll-please-app.js", ROOT), "utf8"),
    readFile(new URL("src/drum-roll-please.js", ROOT), "utf8"),
  ]);

  assert.match(markup, /<title>Drum Roll Please! — Morphazoid<\/title>/);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /<h1[^>]*>\s*Drum Roll Please!\s*<\/h1>/);
  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="audioState">off</);
  assert.match(markup, /<canvas[\s\S]+role="img"[\s\S]+aria-describedby=/);
  assert.match(markup, /id="liveStatus"[^>]+aria-live="polite"/);
  assert.match(markup, /id="audioError"[^>]+role="alert"[^>]+hidden/);
  assert.match(markup, /data-reset-all[^>]+data-reset-in-place/);
  assert.match(markup, /id="direction"[^>]+role="group"[^>]+aria-label=/);
  assert.match(markup, /id="directionAccelerate"[^>]+aria-pressed="true"/);
  assert.match(markup, /id="directionDecelerate"[^>]+aria-pressed="false"/);
  assert.match(markup, /<b>Tempo glissando speed<\/b>/);
  assert.match(markup, /<b>Center tempo<\/b>/);
  assert.match(markup, /<b>Tempo bank width<\/b>/);
  assert.match(markup, /<b>Stereo spread<\/b>/);
  assert.match(markup, /<b>Stripe angle<\/b>/);
  assert.match(markup, /<b>Center body pitch<\/b>/);
  assert.match(markup, /<b>Hit decay<\/b>/);
  assert.match(markup, /<b>Timbre morph depth<\/b>/);
  assert.match(markup, /<b>Character bias<\/b>/);
  assert.match(markup, /<b>Brightness ceiling<\/b>/);
  assert.match(markup, /id="centerRateOut"[^>]*>[^<]*BPM/);
  const compactNumberSource = app.match(
    /function compactNumber\(value, digits = 2\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(compactNumberSource, "display number formatter is missing");
  const compactNumber = Function(
    `"use strict"; ${compactNumberSource}; return compactNumber;`,
  )();
  assert.equal(compactNumber(240, 0), "240");
  assert.equal(compactNumber(110, 0), "110");
  assert.equal(compactNumber(8.3, 1), "8.3");
  for (const id of [
    "level",
    "driftRate",
    "centerRate",
    "width",
    "stripeAngle",
    "centerPitch",
    "decay",
    "morphDepth",
    "character",
    "cutoff",
    "spread",
  ]) {
    assert.match(markup, new RegExp(`<label[^>]+for="${id}"`), id);
    assert.match(markup, new RegExp(`<input[^>]+id="${id}"`), id);
    assert.match(markup, new RegExp(`<output[^>]+id="${id}Out"`), id);
  }
  assert.match(
    markup,
    /<button[\s\S]*?id="pitchFollow"[\s\S]*?aria-pressed="false"[\s\S]*?<\/button>/,
  );
  assert.match(markup, /id="pitchFollowState">\s*Off\b/i);
  assert.match(markup, /id="stripeAngleNote">[\s\S]*?Display only:/);
  assert.match(markup, /Crisp diagonal tempo bands/);
  assert.match(markup, /kick, tom, hand, and air/);
  assert.match(markup, /src="drum-roll-please-app\.js"/);
  assert.doesNotMatch(markup, /https?:\/\//);

  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /event\.key === "ArrowUp"/);
  assert.match(app, /event\.key === "ArrowDown"/);
  assert.match(app, /event\.key === " "/);
  assert.match(app, /addEventListener\("pagehide", handlePageHide/);
  assert.match(app, /addEventListener\("pageshow", handlePageShow/);
  assert.match(app, /audio\.close\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);
  assert.match(audioModule, /async start\(\)\s*\{\s*await this\.initialize\(\)/);
});

test("visualization is a crisp angled barber field with persistent hit history", async () => {
  const app = await readFile(new URL("drum-roll-please-app.js", ROOT), "utf8");

  assert.match(app, /visualHitHistories/);
  const historyDuration = app.match(/HIT_HISTORY_SECONDS\s*=\s*([\d.]+)/);
  assert.ok(historyDuration);
  assert.ok(Number(historyDuration[1]) >= 2.4, "hit marks disappear too quickly to read as waves");
  assert.match(app, /DRUM_ROLL_PHASE_SEED \* 2 \*\* visualPulsePhases\.length/);
  assert.match(app, /function advanceHitHistories/);
  assert.match(app, /function drawBarberField/);
  assert.match(app, /function drawHitGlyph/);
  assert.match(app, /stripeAngle/);
  assert.match(app, /Math\.PI\s*\/\s*180/);
  assert.match(app, /\.rotate\(/);
  assert.match(app, /morphPosition/);

  const drawStart = app.indexOf("function draw(");
  const drawEnd = app.indexOf("\nfunction animate(", drawStart);
  assert.ok(drawStart >= 0 && drawEnd > drawStart);
  assert.doesNotMatch(
    app.slice(drawStart, drawEnd),
    /visualHitHistories\s*=\s*\[\]/,
    "draw() clears the persistent hit history",
  );

  assert.doesNotMatch(app, /createRadialGradient/);
  assert.doesNotMatch(app, /createLinearGradient/);
  assert.doesNotMatch(app, /globalCompositeOperation\s*=\s*["']destination-in["']/);
  assert.doesNotMatch(app, /function drawWaveform/);
});

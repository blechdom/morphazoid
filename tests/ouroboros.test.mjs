import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OUROBOROS_DEFAULTS,
  OUROBOROS_PRESETS,
  OuroborosAudio,
  advanceOuroborosPosition,
  calculateOuroborosLayers,
  ouroborosFrequencySafety,
  ouroborosWindow,
  sanitizeOuroborosParams,
} from "../src/ouroboros.js";

const ROOT = new URL("../", import.meta.url);
const SAMPLE_RATE = 48_000;

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

function percentile(values, proportion) {
  assert.ok(values.length > 0, "percentile requires at least one value");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(proportion * (sorted.length - 1))),
  );
  return sorted[index];
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

function functionBody(source, name) {
  const signature = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `missing ${name}()`);
  const bodyStart = source.indexOf("{", match.index);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  assert.fail(`unterminated ${name}()`);
}

function assertMorphWeights(layer, label = `layer ${layer.index}`) {
  assert.ok(Object.isFrozen(layer.morphWeights), `${label} morph weights are mutable`);
  const entries = Object.entries(layer.morphWeights);
  assert.deepEqual(entries.map(([name]) => name), ["kick", "tom", "hand", "air"]);
  const total = entries.reduce((sum, [, value]) => {
    assert.ok(Number.isFinite(value), `${label} has a non-finite morph weight`);
    assert.ok(value >= 0 && value <= 1, `${label} morph weight escaped [0, 1]`);
    return sum + value;
  }, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `${label} morph weights sum to ${total}`);
}

test("Ouroboros parameters are finite, bounded, directional, and immutable", () => {
  assert.deepEqual(OUROBOROS_DEFAULTS, {
    direction: 1,
    glissRate: 0.12,
    hitRate: 4,
    centerPitch: 110,
    bankWidth: 5,
    voiceInterval: 1,
    spread: 0.34,
    decay: 0.18,
    character: 0.5,
    morphDepth: 1,
    noiseMix: 0.3,
    cutoff: 8_000,
    level: 0.56,
  });
  assert.ok(Object.isFrozen(OUROBOROS_DEFAULTS));

  const safe = sanitizeOuroborosParams({
    direction: -0.001,
    glissRate: 99,
    hitRate: -4,
    centerPitch: 9_999,
    bankWidth: 99,
    voiceInterval: 99,
    spread: -2,
    decay: Number.NaN,
    character: Infinity,
    morphDepth: 9,
    noiseMix: 9,
    cutoff: 99_000,
    level: 9,
  });
  assert.deepEqual(safe, {
    direction: -1,
    glissRate: 1.2,
    hitRate: 0.5,
    centerPitch: 440,
    bankWidth: 7,
    voiceInterval: 2,
    spread: 0,
    decay: OUROBOROS_DEFAULTS.decay,
    character: OUROBOROS_DEFAULTS.character,
    morphDepth: 1,
    noiseMix: 1,
    cutoff: 18_000,
    level: 0.82,
  });
  assert.ok(Object.isFrozen(safe));

  assert.deepEqual(sanitizeOuroborosParams({
    direction: Number.NaN,
    glissRate: Number.NaN,
    hitRate: Infinity,
    centerPitch: Number.NaN,
    bankWidth: -Infinity,
    voiceInterval: Number.NaN,
    spread: Number.NaN,
    decay: Infinity,
    character: Number.NaN,
    morphDepth: Number.NaN,
    noiseMix: Number.NaN,
    cutoff: Number.NaN,
    level: Number.NaN,
  }), OUROBOROS_DEFAULTS);
});

test("the Shepard window and frequency guard fade continuously at both band edges", () => {
  assert.equal(ouroborosWindow(-2.5, 5), 0);
  assert.equal(ouroborosWindow(2.5, 5), 0);
  assert.equal(ouroborosWindow(0, 5), 1);
  assert.ok(Math.abs(ouroborosWindow(-1.25, 5) - 0.5) < 1e-12);
  assert.equal(ouroborosWindow(-1.25, 5), ouroborosWindow(1.25, 5));

  assert.equal(ouroborosFrequencySafety(12, SAMPLE_RATE), 0);
  assert.ok(Math.abs(ouroborosFrequencySafety(16, SAMPLE_RATE) - 0.5) < 1e-12);
  assert.equal(ouroborosFrequencySafety(20, SAMPLE_RATE), 1);
  assert.equal(ouroborosFrequencySafety(SAMPLE_RATE * 0.36, SAMPLE_RATE), 1);
  assert.ok(
    Math.abs(ouroborosFrequencySafety(SAMPLE_RATE * 0.4, SAMPLE_RATE) - 0.5)
      < 1e-12,
  );
  assert.equal(ouroborosFrequencySafety(SAMPLE_RATE * 0.44, SAMPLE_RATE), 0);
  assert.equal(ouroborosFrequencySafety(Number.NaN, SAMPLE_RATE), 0);
});

test("the cyclic position reports octave wraps in either direction", () => {
  assert.deepEqual(advanceOuroborosPosition(0.9, 0.25), {
    position: 0.1499999999999999,
    wraps: 1,
  });
  assert.deepEqual(advanceOuroborosPosition(0.1, -0.25), {
    position: 0.8500000000000001,
    wraps: -1,
  });
  assert.deepEqual(advanceOuroborosPosition(0.2, 2.25), {
    position: 0.4500000000000002,
    wraps: 2,
  });
});

test("the default Shepard body bank stays octave-spaced, power normalized, and in band", () => {
  const frame = calculateOuroborosLayers({
    position: 0.37,
    centerPitch: 110,
    bankWidth: 7,
    spread: 0.6,
    sampleRate: SAMPLE_RATE,
  });

  assert.equal(frame.layers.length, 17);
  assert.ok(frame.activeLayers >= 5);
  assert.ok(Object.isFrozen(frame));
  assert.ok(Object.isFrozen(frame.layers));
  assert.ok(frame.layers.every(Object.isFrozen));
  assert.ok(Math.abs(frame.normalization ** 2 * frame.weightPower - 1) < 1e-12);

  for (let index = 1; index < frame.layers.length; index += 1) {
    assert.ok(
      relativeError(
        frame.layers[index].fundamentalHz / frame.layers[index - 1].fundamentalHz,
        2,
      ) < 1e-12,
      `layers ${index - 1}/${index} are not a 2:1 Shepard pair`,
    );
  }

  for (const layer of frame.layers) {
    for (const key of [
      "octaveOffset", "fundamentalHz", "sourceHz", "window", "safety",
      "weight", "gain", "pan", "morphPosition",
    ]) {
      assert.ok(Number.isFinite(layer[key]), `layer ${layer.index}.${key} is not finite`);
    }
    assert.equal(layer.sourceHz, layer.fundamentalHz);
    assert.ok(layer.window >= 0 && layer.window <= 1);
    assert.ok(layer.safety >= 0 && layer.safety <= 1);
    assert.ok(layer.weight >= 0);
    assert.ok(layer.gain >= 0);
    assert.ok(layer.pan >= -1 && layer.pan <= 1);
    assert.ok(layer.morphPosition >= 0 && layer.morphPosition <= 1);
    assertMorphWeights(layer);

    assert.ok(Object.isFrozen(layer.modalRatios));
    assert.ok(Object.isFrozen(layer.modalGains));
    assert.equal(layer.modalRatios.length, 4);
    assert.equal(layer.modalGains.length, 4);
    for (let mode = 0; mode < layer.modalRatios.length; mode += 1) {
      const ratio = layer.modalRatios[mode];
      const gain = layer.modalGains[mode];
      assert.ok(Number.isFinite(ratio) && ratio >= 1);
      assert.ok(Number.isFinite(gain) && gain >= 0);
      if (gain > 1e-9) {
        const modalFrequency = layer.fundamentalHz * ratio;
        assert.ok(
          ouroborosFrequencySafety(modalFrequency, SAMPLE_RATE) > 0,
          `layer ${layer.index} mode ${mode} escapes the anti-alias band at ${modalFrequency} Hz`,
        );
      }
    }
  }
});

test("parallel voice spacing is variable, safely bounded, and defaults to one octave", () => {
  assert.equal(OUROBOROS_DEFAULTS.voiceInterval, 1);
  assert.equal(sanitizeOuroborosParams({ voiceInterval: -99 }).voiceInterval, 0.5);
  assert.equal(sanitizeOuroborosParams({ voiceInterval: 99 }).voiceInterval, 2);
  assert.equal(
    sanitizeOuroborosParams({ voiceInterval: Number.NaN }).voiceInterval,
    1,
  );

  for (const voiceInterval of [0.5, 1, 1.5, 2]) {
    const frame = calculateOuroborosLayers({
      position: 0.37,
      centerPitch: 110,
      bankWidth: 7,
      voiceInterval,
      sampleRate: SAMPLE_RATE,
    });
    const expectedRatio = 2 ** voiceInterval;
    assert.equal(frame.voiceInterval, voiceInterval);
    assert.ok(relativeError(frame.voiceRatio, expectedRatio) < 1e-12);
    assert.ok(frame.activeLayers >= 2, `${voiceInterval} octave spacing is silent`);

    for (let index = 1; index < frame.layers.length; index += 1) {
      const previous = frame.layers[index - 1];
      const layer = frame.layers[index];
      assert.ok(
        relativeError(layer.fundamentalHz / previous.fundamentalHz, expectedRatio)
          < 1e-12,
        `${voiceInterval} octave spacing did not produce a ${expectedRatio}:1 ratio`,
      );
      assert.ok(
        Math.abs(layer.octaveOffset - previous.octaveOffset - voiceInterval)
          < 1e-12,
      );
    }
  }
});

test("the visible bank preserves Rattlesnake's smooth kick-to-air morph", () => {
  const frame = calculateOuroborosLayers({
    position: 0.37,
    centerPitch: 140,
    bankWidth: 7,
    character: 0.5,
    morphDepth: 1,
    sampleRate: SAMPLE_RATE,
  });
  const visible = frame.layers.filter(({ weight }) => weight > 1e-5);
  assert.ok(visible.length >= 5);

  let previousPosition = -Infinity;
  const dominantCharacters = new Set();
  for (const layer of frame.layers) {
    assert.ok(layer.morphPosition + 1e-12 >= previousPosition);
    previousPosition = layer.morphPosition;
    assertMorphWeights(layer);
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
  assert.ok(dominantCharacters.size >= 3);

  const flat = calculateOuroborosLayers({
    position: 0.37,
    centerPitch: 140,
    bankWidth: 7,
    character: 0.5,
    morphDepth: 0,
    sampleRate: SAMPLE_RATE,
  }).layers.filter(({ weight }) => weight > 1e-5);
  assert.ok(flat.length >= 5);
  assert.ok(flat.every(({ morphPosition }) => (
    Math.abs(morphPosition - flat[0].morphPosition) < 1e-12
  )));
});

test("crossing the cyclic seam relabels equivalent Shepard drum bodies at every interval", () => {
  const epsilon = 1e-9;
  const common = {
    centerPitch: 140,
    bankWidth: 7,
    spread: 0.5,
    decay: 0.2,
    character: 0.55,
    morphDepth: 1,
    noiseMix: 0.7,
    sampleRate: SAMPLE_RATE,
  };

  for (const voiceInterval of [0.5, 1, 1.5, 2]) {
    for (const direction of [1, -1]) {
      const before = calculateOuroborosLayers({
        ...common,
        direction,
        voiceInterval,
        position: 1 - epsilon,
      });
      const after = calculateOuroborosLayers({
        ...common,
        direction,
        voiceInterval,
        position: epsilon,
      });

      let compared = 0;
      for (let index = 0; index < before.layers.length - 1; index += 1) {
        const earlier = before.layers[index];
        const later = after.layers[index + 1];
        if (Math.max(earlier.weight, later.weight) < 1e-5) continue;
        compared += 1;
        assert.ok(relativeError(later.fundamentalHz, earlier.fundamentalHz) < 4e-8);
        assert.ok(Math.abs(later.window - earlier.window) < 4e-8);
        assert.ok(Math.abs(later.safety - earlier.safety) < 4e-8);
        assert.ok(Math.abs(later.weight - earlier.weight) < 4e-8);
        assert.ok(relativeError(later.gain, earlier.gain) < 5e-8);
        assert.ok(Math.abs(later.pan - earlier.pan) < 4e-8);
        assert.ok(Math.abs(later.morphPosition - earlier.morphPosition) < 4e-8);
        for (const name of ["kick", "tom", "hand", "air"]) {
          assert.ok(
            Math.abs(later.morphWeights[name] - earlier.morphWeights[name]) < 4e-8,
            `${direction}/${voiceInterval} seam changed the ${name} body`,
          );
        }
        for (let mode = 0; mode < earlier.modalRatios.length; mode += 1) {
          assert.ok(Math.abs(later.modalRatios[mode] - earlier.modalRatios[mode]) < 4e-8);
          assert.ok(Math.abs(later.modalGains[mode] - earlier.modalGains[mode]) < 4e-8);
        }
      }
      assert.ok(compared >= 2);
      assert.ok(Math.abs(before.weightPower - after.weightPower) < 1e-7);
    }
  }
});

test("all presets are frozen, unique, bounded, audible, and support both directions", () => {
  assert.ok(Object.isFrozen(OUROBOROS_PRESETS));
  assert.ok(OUROBOROS_PRESETS.length >= 4);
  assert.ok(OUROBOROS_PRESETS.every(Object.isFrozen));
  assert.equal(
    new Set(OUROBOROS_PRESETS.map(({ id }) => id)).size,
    OUROBOROS_PRESETS.length,
  );
  assert.ok(OUROBOROS_PRESETS.some(({ direction }) => direction === 1));
  assert.ok(OUROBOROS_PRESETS.some(({ direction }) => direction === -1));

  for (const preset of OUROBOROS_PRESETS) {
    const safe = sanitizeOuroborosParams(preset);
    for (const key of Object.keys(OUROBOROS_DEFAULTS)) {
      assert.equal(safe[key], preset[key], `${preset.id}.${key}`);
    }
    for (const sampleRate of [44_100, 48_000, 96_000]) {
      const frame = calculateOuroborosLayers({
        ...preset,
        position: 0.37,
        sampleRate,
      });
      assert.ok(frame.activeLayers >= 3, `${preset.id} is silent at ${sampleRate} Hz`);
      assert.ok(frame.layers.every((layer) => (
        Number.isFinite(layer.fundamentalHz)
        && Number.isFinite(layer.gain)
        && layer.safety >= 0
        && layer.safety <= 1
      )));
    }
  }
});

test("the audio wrapper keeps audible output independent from automatic transport", async () => {
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
  const audio = new OuroborosAudio(runtime);
  assert.equal(audio.context, null);
  assert.equal(audio.node, null);

  audio.setParameters({ direction: -1, glissRate: 999, hitRate: 999, level: 0.7 });
  assert.equal(audio.context, null, "setParameters must not eagerly create audio");
  assert.equal(audio.params.direction, -1);
  assert.equal(audio.params.glissRate, 1.2);
  assert.equal(audio.params.hitRate, 24);
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
    centerPitch: 220,
    bankWidth: 7,
    voiceInterval: 0.75,
    character: 0.7,
    morphDepth: 0.82,
    noiseMix: 0.9,
    cutoff: 12_000,
    spread: 99,
  });
  assert.deepEqual(messages.at(-1), {
    type: "parameters",
    parameters: sanitizeOuroborosParams({
      ...OUROBOROS_DEFAULTS,
      direction: -1,
      glissRate: 1.2,
      hitRate: 24,
      level: 0.7,
      centerPitch: 220,
      bankWidth: 7,
      voiceInterval: 0.75,
      character: 0.7,
      morphDepth: 0.82,
      noiseMix: 0.9,
      cutoff: 12_000,
      spread: 1,
    }),
  });
  assert.deepEqual(filterTargets.at(-1), [12_000, 3, 0.025]);

  await audio.enable();
  assert.equal(resumes, 1);
  assert.equal(audio.enabled, true);
  assert.equal(audio.transportRunning, false);
  assert.deepEqual(messages.at(-1), { type: "audible", value: true });
  assert.deepEqual(ramps.at(-1), ["ramp", 0.7, 3.035]);

  audio.setParameters({ level: 0.42 });
  assert.deepEqual(ramps.at(-1), ["target", 0.42, 3, 0.015]);
  assert.equal(audio.setPosition(0.37), true);
  assert.equal(messages.at(-1).type, "position");
  assert.ok(Math.abs(messages.at(-1).value - 0.37) < 1e-12);
  assert.equal(audio.setPosition(1.25), true);
  assert.deepEqual(messages.at(-1), { type: "position", value: 0.25 });
  assert.equal(audio.setPosition(Number.NaN), false);
  audio.strike(0.8, 0.37);
  assert.deepEqual(messages.at(-1), {
    type: "strike",
    velocity: 0.8,
    position: 0.37,
  });
  assert.ok(messages.at(-1).position >= 0 && messages.at(-1).position <= 1);

  await audio.start();
  assert.equal(audio.transportRunning, true);
  assert.deepEqual(messages.at(-1), { type: "transport", value: true });
  assert.equal(audio.stopTransport(), true);
  assert.equal(audio.transportRunning, false);
  assert.deepEqual(messages.at(-1), { type: "transport", value: false });

  audio.strike(0.6);
  assert.deepEqual(messages.at(-1), { type: "strike", velocity: 0.6 });
  audio.strike(0.4, -10);
  assert.deepEqual(messages.at(-1), { type: "strike", velocity: 0.4, position: 0 });
  audio.strike(0.4, 10);
  assert.deepEqual(messages.at(-1), { type: "strike", velocity: 0.4, position: 1 });

  audio.stop();
  assert.equal(audio.enabled, false);
  assert.equal(audio.transportRunning, false);
  assert.deepEqual(messages.at(-2), { type: "transport", value: false });
  assert.deepEqual(messages.at(-1), { type: "audible", value: false });
  assert.deepEqual(ramps.at(-1), ["ramp", 0, 3.035]);
  assert.equal(scheduled.at(-1)[0], "set");
  assert.equal(scheduled.at(-1)[2], 55);
});

test("the worklet render loop reuses typed state and contains no explicit allocations", async () => {
  const source = await readFile(new URL("src/ouroboros.js", ROOT), "utf8");
  const start = source.indexOf("    process(_inputs, outputs) {");
  const end = source.indexOf("\n      return true;\n    }\n  };", start);
  assert.ok(start >= 0 && end > start);
  const processBody = source.slice(start, end);
  assert.doesNotMatch(processBody, /\bnew\s+/);
  assert.doesNotMatch(processBody, /Array\.from|\.(?:map|filter|reduce)\(/);
});

test("the worklet registers once and renders finite, audible stereo through both seams", async () => {
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
  globalThis.sampleRate = SAMPLE_RATE;

  try {
    await import(`../src/ouroboros.js?worklet-test=${Date.now()}`);
    assert.equal(registeredName, "morphazoid-ouroboros");
    assert.equal(registrationCount, 1);
    assert.equal(typeof Processor, "function");

    for (const direction of [1, -1]) {
      const processor = new Processor({
        processorOptions: {
          ...OUROBOROS_DEFAULTS,
          direction,
          glissRate: 1.2,
          hitRate: 9,
          bankWidth: 7,
          spread: 0.8,
        },
      });
      const stateArrays = Object.entries(processor).filter(([, value]) => (
        ArrayBuffer.isView(value) && !(value instanceof DataView)
      ));
      assert.ok(stateArrays.length >= 18, "per-layer synthesis state should use typed arrays");
      processor.position = direction > 0 ? 0.9995 : 0.0005;
      processor.port.onmessage({ data: { type: "active", value: true } });
      processor.port.onmessage({ data: { type: "strike", velocity: 0.9 } });

      let previousPosition = processor.position;
      let previousLeft = 0;
      let crossedSeam = false;
      let peak = 0;
      let squareSum = 0;
      let stereoDifference = 0;
      let maximumStep = 0;
      let sampleCount = 0;

      for (let block = 0; block < 260; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        assert.equal(processor.process([], [[left, right]]), true);
        if (direction > 0 && processor.position < previousPosition) crossedSeam = true;
        if (direction < 0 && processor.position > previousPosition) crossedSeam = true;
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
      assert.ok(rms > 0.003, `${direction} render was unexpectedly silent: ${rms}`);
      assert.ok(rms < 0.3, `${direction} render was unexpectedly loud: ${rms}`);
      assert.ok(peak < 0.8, `${direction} render peak escaped its ceiling: ${peak}`);
      assert.ok(maximumStep < 0.6, `${direction} seam produced a ${maximumStep} sample step`);
      assert.ok(
        stereoDifference / (sampleCount * 0.5) > 1e-4,
        `${direction} render collapsed unexpectedly to mono`,
      );
      for (const [name, reference] of stateArrays) {
        assert.strictEqual(processor[name], reference, `${name} was reallocated`);
      }
    }

    const slow = new Processor({
      processorOptions: { ...OUROBOROS_DEFAULTS, glissRate: 0.02, hitRate: 7 },
    });
    const fast = new Processor({
      processorOptions: {
        ...OUROBOROS_DEFAULTS,
        direction: -1,
        glissRate: 1.2,
        hitRate: 7,
      },
    });
    slow.port.onmessage({ data: { type: "active", value: true } });
    fast.port.onmessage({ data: { type: "active", value: true } });
    for (let block = 0; block < 60; block += 1) {
      slow.process([], [[new Float32Array(128), new Float32Array(128)]]);
      fast.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.ok(Math.abs(slow.pulsePhase - fast.pulsePhase) < 1e-12);
    assert.notEqual(slow.position, fast.position, "gliss motion should remain independent");

    const closeVoices = new Processor({
      processorOptions: {
        ...OUROBOROS_DEFAULTS,
        glissRate: 0.4,
        voiceInterval: 0.5,
      },
    });
    const wideVoices = new Processor({
      processorOptions: {
        ...OUROBOROS_DEFAULTS,
        glissRate: 0.4,
        voiceInterval: 2,
      },
    });
    const closeStart = closeVoices.position;
    const wideStart = wideVoices.position;
    closeVoices.port.onmessage({ data: { type: "active", value: true } });
    wideVoices.port.onmessage({ data: { type: "active", value: true } });
    for (let block = 0; block < 50; block += 1) {
      closeVoices.process([], [[new Float32Array(128), new Float32Array(128)]]);
      wideVoices.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    const closeOctaveTravel = (closeVoices.position - closeStart) * 0.5;
    const wideOctaveTravel = (wideVoices.position - wideStart) * 2;
    assert.ok(
      Math.abs(closeOctaveTravel - wideOctaveTravel) < 1e-8,
      "glissRate must remain physical octaves/second when voice spacing changes",
    );

    const manual = new Processor({ processorOptions: OUROBOROS_DEFAULTS });
    const manualPosition = 0.68;
    const manualPulsePhase = manual.pulsePhase;
    manual.port.onmessage({ data: { type: "audible", value: true } });
    manual.port.onmessage({ data: { type: "position", value: manualPosition } });
    manual.port.onmessage({
      data: { type: "strike", velocity: 0.82 },
    });
    let manualPeak = 0;
    for (let block = 0; block < 24; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      manual.process([], [[left, right]]);
      for (let index = 0; index < left.length; index += 1) {
        manualPeak = Math.max(manualPeak, Math.abs(left[index]), Math.abs(right[index]));
      }
    }
    assert.ok(manualPeak > 1e-4, "manual strikes should be audible without transport");
    assert.ok(
      Math.abs(manual.position - manualPosition) < 1e-12,
      "manual control must place the full bank",
    );
    assert.equal(manual.pulsePhase, manualPulsePhase, "manual strikes must not start the hit clock");

    const manualLevels = [];
    for (const position of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const placed = new Processor({ processorOptions: OUROBOROS_DEFAULTS });
      placed.port.onmessage({ data: { type: "audible", value: true } });
      placed.port.onmessage({ data: { type: "position", value: position } });
      placed.port.onmessage({ data: { type: "strike", velocity: 0.82 } });
      let squareSum = 0;
      let sampleCount = 0;
      for (let block = 0; block < 48; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        placed.process([], [[left, right]]);
        for (let index = 0; index < left.length; index += 1) {
          squareSum += left[index] ** 2 + right[index] ** 2;
          sampleCount += 2;
        }
      }
      manualLevels.push(Math.sqrt(squareSum / sampleCount));
    }
    const quietestManualLevel = Math.min(...manualLevels);
    const loudestManualLevel = Math.max(...manualLevels);
    assert.ok(quietestManualLevel > 0.002, "manual full-bank placement became silent");
    assert.ok(
      quietestManualLevel / loudestManualLevel > 0.55,
      `manual loudness changes too much around the loop: ${manualLevels.join(", ")}`,
    );

    const targetedLow = new Processor({ processorOptions: OUROBOROS_DEFAULTS });
    const targetedHigh = new Processor({ processorOptions: OUROBOROS_DEFAULTS });
    const autonomousPosition = targetedLow.position;
    targetedLow.port.onmessage({
      data: { type: "strike", velocity: 0.72, position: 0.08 },
    });
    targetedHigh.port.onmessage({
      data: { type: "strike", velocity: 0.72, position: 0.92 },
    });
    targetedLow.process([], [[new Float32Array(128), new Float32Array(128)]]);
    targetedHigh.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(targetedLow.position, autonomousPosition);
    assert.equal(
      targetedHigh.position,
      autonomousPosition,
      "pointer audition must not jump the autonomous gliss/playhead",
    );
    const strongestLowLayer = targetedLow.slowEnvelopes.indexOf(
      Math.max(...targetedLow.slowEnvelopes),
    );
    const strongestHighLayer = targetedHigh.slowEnvelopes.indexOf(
      Math.max(...targetedHigh.slowEnvelopes),
    );
    assert.ok(
      strongestLowLayer < strongestHighLayer,
      "opposite racetrack positions must audition different low/high spectral layers",
    );

    const parameterLifecycle = new Processor({ processorOptions: OUROBOROS_DEFAULTS });
    parameterLifecycle.port.onmessage({
      data: {
        type: "parameters",
        parameters: { ...OUROBOROS_DEFAULTS, voiceInterval: 2 },
      },
    });
    assert.equal(parameterLifecycle.target.voiceInterval, 2);
    assert.equal(
      parameterLifecycle.current.voiceInterval,
      2,
      "an inactive engine must adopt new interval settings before restart",
    );
    parameterLifecycle.port.onmessage({ data: { type: "active", value: true } });
    parameterLifecycle.port.onmessage({
      data: {
        type: "parameters",
        parameters: { ...OUROBOROS_DEFAULTS, voiceInterval: 0.5 },
      },
    });
    assert.equal(parameterLifecycle.target.voiceInterval, 0.5);
    assert.equal(
      parameterLifecycle.current.voiceInterval,
      2,
      "active interval changes should retain the worklet's click-free slew",
    );
    parameterLifecycle.process([], [[
      new Float32Array(128),
      new Float32Array(128),
    ]]);
    assert.ok(parameterLifecycle.current.voiceInterval < 2);
    assert.ok(parameterLifecycle.current.voiceInterval > 0.5);
    parameterLifecycle.port.onmessage({ data: { type: "active", value: false } });
    assert.equal(parameterLifecycle.current.voiceInterval, 0.5);

    const transient = new Processor({ processorOptions: OUROBOROS_DEFAULTS });
    transient.port.onmessage({ data: { type: "active", value: true } });
    const warmupBlocks = 80;
    const measuredBlocks = 900;
    const rendered = new Float32Array(measuredBlocks * 128);
    let writeOffset = 0;
    for (let block = 0; block < warmupBlocks + measuredBlocks; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(transient.process([], [[left, right]]), true);
      if (block >= warmupBlocks) {
        rendered.set(left, writeOffset);
        writeOffset += left.length;
      }
    }
    const levels = windowRms(rendered);
    const p10 = percentile(levels, 0.1);
    const median = percentile(levels, 0.5);
    const p90 = percentile(levels, 0.9);
    const p95 = percentile(levels, 0.95);
    assert.ok(p95 / Math.max(1e-9, median) > 2, "default lacks a percussive attack");
    assert.ok(p90 / Math.max(1e-9, p10) > 3, "default behaves like a noise bed");
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("the native page exposes an accessible, lazy Ouroboros instrument", async () => {
  const [markup, app, source, styles] = await Promise.all([
    readFile(new URL("ouroboros.html", ROOT), "utf8"),
    readFile(new URL("ouroboros-app.js", ROOT), "utf8"),
    readFile(new URL("src/ouroboros.js", ROOT), "utf8"),
    readFile(new URL("ouroboros.css", ROOT), "utf8"),
  ]);

  assert.match(markup, /<title>Ouroboros — Morphazoid<\/title>/);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /<h1[^>]*>\s*Ouroboros\s*<\/h1>/);
  assert.match(markup, /<body class="ouroboros-page">/);
  assert.match(markup, /<main[^>]+id="ouroboros"/);
  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="audioButton"[\s\S]{0,220}aria-label="Turn Ouroboros audio on"/);
  assert.match(markup, /id="audioAction"[^>]*>Audio</);
  assert.match(markup, /id="audioState">off</);
  assert.match(
    markup,
    /<canvas[\s\S]+id="stage"[\s\S]+data-interactive-track[\s\S]+role="img"[\s\S]+aria-describedby=/,
  );
  const transportTag = markup.match(/<button\b[^>]*\bid="transportButton"[^>]*>/)?.[0];
  assert.ok(transportTag, "missing explicit Ouroboros Sweep/Stop transport");
  assert.match(transportTag, /\baria-pressed="false"/);
  assert.match(transportTag, /\bdata-primary-transport(?:\s|=|>)/);
  assert.match(markup, /id="transportIcon"[^>]*>[\s\S]*▶/);
  assert.match(markup, /id="transportLabel"[^>]*>Sweep</);
  assert.match(markup, /id="liveStatus"[^>]+aria-live="polite"/);
  assert.match(markup, /id="audioError"[^>]+role="alert"[^>]+hidden/);
  assert.match(markup, /data-reset-all[^>]+data-reset-in-place/);
  assert.match(
    markup,
    /id="strikeButton"[^>]+data-midi-trigger="strike"[^>]+aria-label=/,
  );
  assert.match(markup, /id="presetGrid"[^>]+role="group"/);
  assert.match(markup, /<fieldset[^>]+id="direction"[^>]+aria-label="Sweep direction"/);
  assert.match(markup, /id="directionRise"[^>]+name="sweepDirection"[^>]+value="1"[^>]+checked/);
  assert.match(markup, /id="directionFall"[^>]+name="sweepDirection"[^>]+value="-1"/);
  for (const id of [
    "level", "pluckPosition", "glissRate", "hitRate", "centerPitch", "bankWidth", "voiceInterval", "spread",
    "decay", "character", "morphDepth", "noiseMix", "cutoff",
  ]) {
    assert.match(markup, new RegExp(`<label[^>]+for="${id}"`), id);
    assert.match(markup, new RegExp(`<input[^>]+id="${id}"`), id);
    assert.match(markup, new RegExp(`<output[^>]+id="${id}Out"`), id);
  }
  for (const id of [
    "stageWrap", "stageReadout", "directionMarker", "directionMarkerText",
    "canvasInstructions", "presetSummary", "engineSummary", "motionSummary",
    "shepardSummary", "soundSummary",
  ]) assert.match(markup, new RegExp(`id="${id}"`), id);
  assert.match(markup, /id="centerPitch"[^>]+min="55"[^>]+max="440"/);
  assert.match(markup, /id="bankWidth"[^>]+min="3"[^>]+max="7"/);
  assert.match(
    markup,
    /id="voiceInterval"[^>]+min="0\.5"[^>]+max="2"[^>]+step="0\.01"[^>]+value="1"/,
  );
  assert.match(markup, /id="hitRate"[^>]+min="0\.5"[^>]+max="24"[^>]+value="4"/);
  assert.match(markup, /id="pluckPosition"[^>]+min="0"[^>]+max="1"[^>]+step="\.0001"/);
  assert.match(markup, /Pluck rail/i);
  assert.match(markup, /Hit density/i);
  assert.match(markup, /Gliss speed/i);
  assert.match(markup, /id="shepardSummary">19\.4 Hz–622 Hz · 5\.0 oct</);
  assert.match(markup, /id="noiseMixOut"[^>]*>30%</);
  assert.match(markup, /id="cutoffOut"[^>]*>8\.0 kHz</);
  assert.match(markup, /id="levelOut"[^>]*>56%</);
  assert.match(markup, /Rattlesnake/i);
  assert.match(markup, /Shepard/i);
  assert.match(markup, /voice interval|parallel voice/i);
  assert.match(markup, /one octave|2:1/i);
  assert.match(markup, /drag|pointer/i);
  assert.match(markup, /thick[^<]+oval|closed oval/i);
  assert.match(markup, /src="ouroboros-app\.js"/);
  assert.doesNotMatch(markup, /https?:\/\//);

  assert.match(app, /new OuroborosAudio\(globalThis\)/);
  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /transportButton"\)\.addEventListener\("click", toggleSweep\)/);
  assert.match(app, /audioAction"\)\.textContent = "Audio"/);
  assert.match(app, /setPressed\(\$\("transportButton"\), state\.sweeping\)/);
  assert.match(
    app,
    /transportLabel"\)\.textContent = state\.audioStarting[\s\S]{0,180}"Stop"[\s\S]{0,80}"Sweep"/,
  );
  assert.match(
    app,
    /transportIcon"\)\.textContent = state\.audioStarting[\s\S]{0,120}state\.sweeping[\s\S]{0,80}"■"[\s\S]{0,80}"▶"/,
  );
  const audioStart = functionBody(app, "startAudio");
  assert.match(audioStart, /await audio\.enable\(\)/);
  assert.doesNotMatch(audioStart, /audio\.start\(\)|setTransport\(/);
  const sweepStart = functionBody(app, "startSweep");
  assert.match(sweepStart, /await startAudio\(\)/);
  assert.match(sweepStart, /audio\.setTransport\(true\)/);
  const sweepStop = functionBody(app, "stopSweep");
  assert.match(sweepStop, /audio\.stopTransport\(\)/);
  assert.match(app, /calculateOuroborosLayers/);
  assert.match(
    app,
    /center \* 2 \*\* -halfWidth[\s\S]*center \* 2 \*\* halfWidth/,
  );
  assert.match(app, /shepardSummary"\)\.textContent = `\$\{register\}/);
  assert.match(source, /morphPosition/);
  assert.match(app, /function trackPositionFromPointer\(event\)/);
  assert.match(app, /function strikeTrackPosition\(position, velocity/);
  assert.match(app, /function setPluckPosition\(position\)/);
  assert.match(app, /function releaseTrackPointer\(event\)/);
  assert.match(app, /function drawPlayhead\(/);
  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /canvas\.addEventListener\("pointermove"/);
  assert.match(app, /canvas\.addEventListener\("pointerup", releaseTrackPointer\)/);
  assert.match(app, /canvas\.addEventListener\("pointercancel", releaseTrackPointer\)/);
  assert.match(app, /canvas\.setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(app, /canvas\.releasePointerCapture\?\.\(event\.pointerId\)/);
  const pointerMapping = functionBody(app, "trackPositionFromPointer");
  assert.match(pointerMapping, /canvas\.getBoundingClientRect\(\)/);
  assert.match(pointerMapping, /event\.clientX/);
  assert.match(pointerMapping, /event\.clientY/);
  assert.match(pointerMapping, /pointOnCoil\(/);
  assert.match(pointerMapping, /return wrapUnit\(closestPosition\)/);
  assert.match(
    app,
    /canvas\.addEventListener\("pointerdown",[\s\S]{0,800}trackPositionFromPointer\(event\)[\s\S]{0,500}setPluckPosition\(position\)[\s\S]{0,500}strikeTrackPosition\(position,/,
  );
  assert.match(
    app,
    /canvas\.addEventListener\("pointermove",[\s\S]{0,900}trackPositionFromPointer\(event\)[\s\S]{0,600}strikeTrackPosition\(position, velocity\)/,
  );
  const trackStrike = functionBody(app, "strikeTrackPosition");
  assert.match(trackStrike, /await startAudio\(\)/);
  assert.match(
    trackStrike,
    /audio\.setPosition\([^)]*position\)/,
    "manual playing must place the complete Shepard bank at the playhead",
  );
  assert.match(
    trackStrike,
    /audio\.strike\([^,\n]+\)/,
    "manual playing must strike the normalized full bank",
  );
  assert.doesNotMatch(trackStrike, /audio\.strike\([^,\n]+,\s*[^)\n]+\)/);
  const setPluck = functionBody(app, "setPluckPosition");
  assert.match(setPluck, /state\.visualPosition\s*=\s*normalized/);
  assert.match(setPluck, /audio\.setPosition\(normalized\)/);
  assert.match(
    app,
    /canvas\.addEventListener\("pointerdown",[\s\S]{0,400}stopSweep\(\{ announceStop: false \}\)/,
  );
  assert.match(app, /pluckPosition"\)\.addEventListener\("input"/);
  assert.match(
    app,
    /pluckPosition"\)\.addEventListener\("input"[\s\S]{0,500}strikeTrackPosition\(position,/,
  );
  const playhead = functionBody(app, "drawPlayhead");
  assert.match(playhead, /state\.visualPosition/);
  assert.match(playhead, /pointOnCoil\(normalized, geometry\)/);
  assert.doesNotMatch(playhead, /AUDITION|pointerTrackPosition/);
  assert.match(app, /function drawHitFlash\(/);
  assert.doesNotMatch(app, /function drawLayerNodes\(|function drawStrikeGlyph\(/);
  assert.match(app, /drawPlayhead\(context2d, geometry, safe\)/);
  const visualAdvance = functionBody(app, "advanceVisualState");
  assert.match(visualAdvance, /if \(!state\.sweeping\) return/);
  assert.match(
    visualAdvance,
    /phaseMotionDelta = motionDelta \/ safe\.voiceInterval/,
    "visual lattice phase must use the same physical-octave conversion as audio",
  );
  assert.match(
    visualAdvance,
    /state\.visualPosition \+ phaseMotionDelta/,
  );
  assert.match(
    visualAdvance,
    /averagePhaseRate = phaseMotionDelta \/ elapsed/,
  );
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /audio\.context\?\.currentTime/);
  assert.match(app, /lastAudioVisualTime/);
  assert.match(app, /retainedHitCount/);
  assert.doesNotMatch(app, /Math\.min\(0\.1,[^\n]*elapsed/);
  assert.match(app, /audioStartGeneration/);
  assert.match(app, /if \(disposed\) await audio\.close\(\)/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /addEventListener\("pageshow"/);
  assert.match(app, /audio\.close\(\)/);
  const pageHide = functionBody(app, "handlePageHide");
  assert.match(pageHide, /audioStartGeneration \+= 1/);
  assert.match(pageHide, /cancelTrackInteraction\(\)/);
  assert.match(pageHide, /audio\.stop\(\)/);
  assert.match(pageHide, /audio\.close\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);
  assert.match(source, /async enable\(\)\s*\{\s*await this\.initialize\(\)/);
  assert.match(source, /async start\(\)[\s\S]{0,100}await this\.enable\(\)/);
  assert.match(source, /type: "audible"/);
  assert.match(source, /type: "transport"/);
  assert.match(source, /type: "position"/);
  assert.match(source, /setPosition\(position\)/);
  assert.match(source, /const transportActive = this\.transportTarget > 0\.5/);
  assert.match(styles, /#stage\s*\{[^}]*touch-action:\s*none/s);
  assert.match(styles, /\.ouroboros-stage-wrap\s*\{[^}]*height:\s*clamp/s);
  assert.match(styles, /\.ouroboros-performance-transport/);
  assert.match(styles, /@media \(max-width: 560px\)/);
});

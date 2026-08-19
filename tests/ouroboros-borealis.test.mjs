import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OUROBOROS_BOREALIS_DEFAULTS,
  OUROBOROS_BOREALIS_PHASE_SEED,
  OUROBOROS_BOREALIS_PRESETS,
  OuroborosBorealisAudio,
  advanceOuroborosBorealisCoordinates,
  advanceOuroborosBorealisPosition,
  calculateOuroborosBorealisFrame,
  ouroborosBorealisCouplingWeight,
  ouroborosBorealisFrequencySafety,
  ouroborosBorealisPitchWindow,
  ouroborosBorealisRateSafety,
  ouroborosBorealisRhythmWindow,
  sanitizeOuroborosBorealisParams,
} from "../src/ouroboros-borealis.js";

const ROOT = new URL("../", import.meta.url);
const SAMPLE_RATE = 48_000;

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

function wrapUnit(value) {
  return ((value % 1) + 1) % 1;
}

function circularDistance(first, second) {
  const direct = Math.abs(wrapUnit(first) - wrapUnit(second));
  return Math.min(direct, 1 - direct);
}

function percentile(values, proportion) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor(proportion * (sorted.length - 1))),
  )];
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

function assertMorphWeights(layer, label = `pitch layer ${layer.index}`) {
  assert.ok(Object.isFrozen(layer.morphWeights), `${label} morph weights are mutable`);
  assert.deepEqual(Object.keys(layer.morphWeights), ["kick", "tom", "hand", "air"]);
  const total = Object.values(layer.morphWeights).reduce((sum, value) => {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, label);
    return sum + value;
  }, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `${label} weights sum to ${total}`);
}

test("Borealis defaults, bounds, directions, and presets are immutable", () => {
  assert.deepEqual(OUROBOROS_BOREALIS_DEFAULTS, {
    pitchDirection: 1,
    rhythmDirection: -1,
    pitchGlissRate: 0.12,
    rhythmGlissRate: 0.1,
    centerPitch: 110,
    centerRate: 4,
    pitchWidth: 5,
    rhythmWidth: 5,
    pitchInterval: 1,
    rhythmInterval: 1,
    phaseOffset: 0.25,
    coupling: 0,
    couplingFocus: 0.5,
    spread: 0.34,
    decay: 0.18,
    character: 0.5,
    morphDepth: 1,
    noiseMix: 0.3,
    cutoff: 8_000,
    level: 0.52,
  });
  assert.ok(Object.isFrozen(OUROBOROS_BOREALIS_DEFAULTS));

  const safe = sanitizeOuroborosBorealisParams({
    pitchDirection: -0.01,
    rhythmDirection: 0,
    pitchGlissRate: 99,
    rhythmGlissRate: -99,
    centerPitch: 99_999,
    centerRate: -99,
    pitchWidth: 99,
    rhythmWidth: -99,
    pitchInterval: 99,
    rhythmInterval: -99,
    phaseOffset: 99,
    coupling: -99,
    couplingFocus: 99,
    spread: -99,
    decay: Number.NaN,
    character: Infinity,
    morphDepth: 99,
    noiseMix: 99,
    cutoff: 99_999,
    level: 99,
  });
  assert.deepEqual(safe, {
    pitchDirection: -1,
    rhythmDirection: 1,
    pitchGlissRate: 1.2,
    rhythmGlissRate: 0.02,
    centerPitch: 880,
    centerRate: 0.5,
    pitchWidth: 9,
    rhythmWidth: 3,
    pitchInterval: 2,
    rhythmInterval: 0.5,
    phaseOffset: 1,
    coupling: -1,
    couplingFocus: 1,
    spread: 0,
    decay: OUROBOROS_BOREALIS_DEFAULTS.decay,
    character: OUROBOROS_BOREALIS_DEFAULTS.character,
    morphDepth: 1,
    noiseMix: 1,
    cutoff: 18_000,
    level: 0.82,
  });
  assert.ok(Object.isFrozen(safe));

  assert.deepEqual(sanitizeOuroborosBorealisParams({
    pitchDirection: Number.NaN,
    rhythmDirection: Number.NaN,
    pitchGlissRate: Number.NaN,
    rhythmGlissRate: Number.NaN,
    centerPitch: Number.NaN,
    centerRate: Number.NaN,
    pitchWidth: Number.NaN,
    rhythmWidth: Number.NaN,
    pitchInterval: Number.NaN,
    rhythmInterval: Number.NaN,
    phaseOffset: Number.NaN,
    coupling: Number.NaN,
    couplingFocus: Number.NaN,
    spread: Number.NaN,
    decay: Number.NaN,
    character: Number.NaN,
    morphDepth: Number.NaN,
    noiseMix: Number.NaN,
    cutoff: Number.NaN,
    level: Number.NaN,
  }), OUROBOROS_BOREALIS_DEFAULTS);

  assert.ok(Object.isFrozen(OUROBOROS_BOREALIS_PRESETS));
  assert.ok(OUROBOROS_BOREALIS_PRESETS.length >= 4);
  assert.ok(OUROBOROS_BOREALIS_PRESETS.every(Object.isFrozen));
  assert.equal(
    new Set(OUROBOROS_BOREALIS_PRESETS.map(({ id }) => id)).size,
    OUROBOROS_BOREALIS_PRESETS.length,
  );
  assert.deepEqual(
    new Set(OUROBOROS_BOREALIS_PRESETS.map((preset) => (
      `${preset.pitchDirection},${preset.rhythmDirection}`
    ))),
    new Set(["1,1", "1,-1", "-1,1", "-1,-1"]),
    "the presets must expose all four independent direction quadrants",
  );
  for (const preset of OUROBOROS_BOREALIS_PRESETS) {
    const sanitized = sanitizeOuroborosBorealisParams(preset);
    for (const key of Object.keys(OUROBOROS_BOREALIS_DEFAULTS)) {
      assert.equal(sanitized[key], preset[key], `${preset.id}.${key}`);
    }
  }
});

test("pitch/rhythm windows and frequency/rate guards fade continuously", () => {
  for (const windowFunction of [
    ouroborosBorealisPitchWindow,
    ouroborosBorealisRhythmWindow,
  ]) {
    assert.equal(windowFunction(-2.5, 5), 0);
    assert.equal(windowFunction(2.5, 5), 0);
    assert.equal(windowFunction(0, 5), 1);
    assert.ok(Math.abs(windowFunction(-1.25, 5) - 0.5) < 1e-12);
    assert.equal(windowFunction(-1.25, 5), windowFunction(1.25, 5));
  }

  assert.equal(ouroborosBorealisFrequencySafety(12, SAMPLE_RATE), 0);
  assert.ok(Math.abs(ouroborosBorealisFrequencySafety(16, SAMPLE_RATE) - 0.5) < 1e-12);
  assert.equal(ouroborosBorealisFrequencySafety(20, SAMPLE_RATE), 1);
  assert.equal(ouroborosBorealisFrequencySafety(SAMPLE_RATE * 0.36, SAMPLE_RATE), 1);
  assert.ok(
    Math.abs(ouroborosBorealisFrequencySafety(SAMPLE_RATE * 0.4, SAMPLE_RATE) - 0.5)
      < 1e-12,
  );
  assert.equal(ouroborosBorealisFrequencySafety(SAMPLE_RATE * 0.44, SAMPLE_RATE), 0);
  assert.equal(ouroborosBorealisFrequencySafety(Number.NaN, SAMPLE_RATE), 0);

  assert.equal(ouroborosBorealisRateSafety(0.0625), 0);
  assert.ok(Math.abs(ouroborosBorealisRateSafety(0.09375) - 0.5) < 1e-12);
  assert.equal(ouroborosBorealisRateSafety(0.125), 1);
  assert.equal(ouroborosBorealisRateSafety(48), 1);
  assert.ok(Math.abs(ouroborosBorealisRateSafety(72) - 0.5) < 1e-12);
  assert.equal(ouroborosBorealisRateSafety(96), 0);
  assert.equal(ouroborosBorealisRateSafety(Number.NaN), 0);
});

test("pitch and rhythm coordinates wrap independently at constant physical gliss speeds", () => {
  assert.deepEqual(advanceOuroborosBorealisPosition(0.9, 0.25), {
    position: 0.1499999999999999,
    wraps: 1,
  });
  assert.deepEqual(advanceOuroborosBorealisPosition(0.1, -0.25), {
    position: 0.8500000000000001,
    wraps: -1,
  });

  const state = { pitchPosition: 0.2, rhythmPosition: 0.8 };
  const common = {
    pitchDirection: 1,
    rhythmDirection: -1,
    pitchGlissRate: 0.4,
    rhythmGlissRate: 0.3,
  };
  for (const interval of [0.5, 1, 1.5, 2]) {
    const advanced = advanceOuroborosBorealisCoordinates(state, 0.5, {
      ...common,
      pitchInterval: interval,
      rhythmInterval: interval,
    });
    assert.ok(Object.isFrozen(advanced));
    assert.ok(Math.abs(advanced.pitchOctaveDelta - 0.2) < 1e-12);
    assert.ok(Math.abs(advanced.rhythmOctaveDelta + 0.15) < 1e-12);
    assert.ok(
      Math.abs(advanced.pitchPosition - (0.2 + 0.2 / interval)) < 1e-12,
    );
    assert.ok(
      Math.abs(advanced.rhythmPosition - (0.8 - 0.15 / interval)) < 1e-12,
    );
    assert.equal(advanced.pitchWraps, 0);
    assert.equal(advanced.rhythmWraps, 0);
  }

  const independentlyWrapped = advanceOuroborosBorealisCoordinates(
    { pitchPosition: 0.9, rhythmPosition: 0.1 },
    1,
    {
      ...common,
      pitchGlissRate: 0.25,
      rhythmGlissRate: 0.25,
      pitchInterval: 1,
      rhythmInterval: 1,
    },
  );
  assert.equal(independentlyWrapped.pitchWraps, 1);
  assert.equal(independentlyWrapped.rhythmWraps, -1);
});

test("the dual 21-layer frame preserves variable pitch and rhythm ratios", () => {
  for (const interval of [0.5, 1, 1.5, 2]) {
    const frame = calculateOuroborosBorealisFrame({
      pitchPosition: 0.37,
      rhythmPosition: 0.63,
      pitchInterval: interval,
      rhythmInterval: interval,
      pitchWidth: 9,
      rhythmWidth: 9,
      sampleRate: SAMPLE_RATE,
    });
    const expectedRatio = 2 ** interval;
    assert.ok(Object.isFrozen(frame));
    assert.ok(Object.isFrozen(frame.pitchLayers));
    assert.ok(Object.isFrozen(frame.rhythmLayers));
    assert.equal(frame.pitchLayers.length, 21);
    assert.equal(frame.rhythmLayers.length, 21);
    assert.ok(frame.pitchLayers.every(Object.isFrozen));
    assert.ok(frame.rhythmLayers.every(Object.isFrozen));
    assert.equal(frame.pitchInterval, interval);
    assert.equal(frame.rhythmInterval, interval);
    assert.ok(relativeError(frame.pitchRatio, expectedRatio) < 1e-12);
    assert.ok(relativeError(frame.rhythmRatio, expectedRatio) < 1e-12);
    assert.ok(frame.pitchActiveLayers >= 2);
    assert.ok(frame.rhythmActiveLayers >= 2);
    assert.equal(frame.pitchActiveLayers, frame.activePitchLayers);
    assert.equal(frame.rhythmActiveLayers, frame.activeRhythmLayers);
    assert.ok(Math.abs(frame.pitchNormalization ** 2 * frame.pitchWeightPower - 1) < 1e-12);
    assert.ok(Math.abs(frame.rhythmNormalization ** 2 * frame.rhythmWeightPower - 1) < 1e-12);
    assert.ok(Number.isFinite(frame.totalHitRate) && frame.totalHitRate > 0);

    for (let index = 1; index < frame.pitchLayers.length; index += 1) {
      const lower = frame.pitchLayers[index - 1];
      const upper = frame.pitchLayers[index];
      assert.ok(relativeError(upper.fundamentalHz / lower.fundamentalHz, expectedRatio) < 1e-12);
      assert.ok(Math.abs(upper.octaveOffset - lower.octaveOffset - interval) < 1e-12);
    }
    for (let index = 1; index < frame.rhythmLayers.length; index += 1) {
      const slower = frame.rhythmLayers[index - 1];
      const faster = frame.rhythmLayers[index];
      assert.ok(relativeError(faster.hitRate / slower.hitRate, expectedRatio) < 1e-12);
      assert.equal(faster.hitRate, faster.rate);
      assert.ok(Math.abs(faster.octaveOffset - slower.octaveOffset - interval) < 1e-12);
    }

    for (const layer of frame.pitchLayers) {
      for (const key of [
        "coordinate", "octaveOffset", "normalizedPosition", "window", "safety",
        "weight", "gain", "pan", "morphPosition", "fundamentalHz", "sourceHz",
      ]) assert.ok(Number.isFinite(layer[key]), `pitch ${layer.index}.${key}`);
      assert.ok(layer.window >= 0 && layer.window <= 1);
      assert.ok(layer.safety >= 0 && layer.safety <= 1);
      assert.ok(layer.normalizedPosition >= -1 && layer.normalizedPosition <= 1);
      assert.ok(layer.pan >= -1 && layer.pan <= 1);
      assert.equal(layer.sourceHz, layer.fundamentalHz);
      assertMorphWeights(layer);
      assert.ok(Object.isFrozen(layer.modalRatios));
      assert.ok(Object.isFrozen(layer.modalGains));
      assert.equal(layer.modalRatios.length, 4);
      assert.equal(layer.modalGains.length, 4);
    }
    for (const layer of frame.rhythmLayers) {
      for (const key of [
        "coordinate", "octaveOffset", "normalizedPosition", "hitRate", "rate",
        "bpm", "window", "safety", "weight", "gain", "pan", "pulsePhase",
      ]) assert.ok(Number.isFinite(layer[key]), `rhythm ${layer.index}.${key}`);
      assert.ok(layer.window >= 0 && layer.window <= 1);
      assert.ok(layer.safety >= 0 && layer.safety <= 1);
      assert.ok(layer.normalizedPosition >= -1 && layer.normalizedPosition <= 1);
      assert.ok(layer.pulsePhase >= 0 && layer.pulsePhase < 1);
      assert.ok(
        circularDistance(
          layer.pulsePhase,
          OUROBOROS_BOREALIS_PHASE_SEED * 2 ** layer.octaveOffset
            + frame.phaseOffset,
        ) < 1e-12,
        `rhythm ${layer.index} pulse phase drifted from its audio-layer coordinate`,
      );
    }
  }
});

test("phase offset and signed, focused coupling remain explicit and bounded", () => {
  assert.equal(ouroborosBorealisCouplingWeight(0.2, 0.8, 0, 0.5), 1);
  const positiveAligned = ouroborosBorealisCouplingWeight(0.6, 0.6, 1, 0.25);
  const positiveOpposed = ouroborosBorealisCouplingWeight(0.6, -0.6, 1, 0.25);
  const negativeAligned = ouroborosBorealisCouplingWeight(-0.6, 0.6, -1, 0.25);
  const negativeOpposed = ouroborosBorealisCouplingWeight(0.6, 0.6, -1, 0.25);
  assert.ok(positiveAligned > positiveOpposed);
  assert.ok(negativeAligned > negativeOpposed);
  assert.ok(
    ouroborosBorealisCouplingWeight(0.1, 0.55, 1, 0.15)
      >= ouroborosBorealisCouplingWeight(0.1, 0.55, 1, 1),
  );
  assert.ok(ouroborosBorealisCouplingWeight(0.2, 0.2, 1, 0.15) > 0.9);
  assert.ok(ouroborosBorealisCouplingWeight(0.2, 0.2, 1, 1) > 0.9);
  for (const pitch of [-1, -0.5, 0, 0.5, 1]) {
    for (const rhythm of [-1, -0.5, 0, 0.5, 1]) {
      for (const coupling of [-1, -0.5, 0, 0.5, 1]) {
        const weight = ouroborosBorealisCouplingWeight(
          pitch,
          rhythm,
          coupling,
          0.35,
        );
        assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
      }
    }
  }

  const base = calculateOuroborosBorealisFrame({
    pitchPosition: 0.23,
    rhythmPosition: 0.61,
    phaseOffset: 0,
  });
  const offset = calculateOuroborosBorealisFrame({
    pitchPosition: 0.23,
    rhythmPosition: 0.61,
    phaseOffset: 0.5,
  });
  assert.equal(base.phaseOffset, 0);
  assert.equal(offset.phaseOffset, 0.5);
  assert.deepEqual(
    base.rhythmLayers.map(({ hitRate }) => hitRate),
    offset.rhythmLayers.map(({ hitRate }) => hitRate),
    "phase offset must not retune the rhythm bank",
  );
  for (let index = 0; index < base.rhythmLayers.length; index += 1) {
    assert.ok(
      Math.abs(
        Math.abs(
          base.rhythmLayers[index].pulsePhase
            - offset.rhythmLayers[index].pulsePhase,
        ) - 0.5,
      ) < 1e-12,
      `phaseOffset did not shift rhythm pulse ${index} by half a cycle`,
    );
  }
});

test("pitch and rhythm seams relabel independently in both directions", () => {
  const epsilon = 1e-9;
  const common = {
    centerPitch: 140,
    centerRate: 4,
    pitchWidth: 9,
    rhythmWidth: 9,
    phaseOffset: 0.31,
    coupling: 0.65,
    couplingFocus: 0.4,
    spread: 0.6,
    sampleRate: SAMPLE_RATE,
  };

  for (const interval of [0.5, 1, 1.5, 2]) {
    for (const direction of [1, -1]) {
      const beforePosition = direction > 0 ? 1 - epsilon : epsilon;
      const afterPosition = direction > 0 ? epsilon : 1 - epsilon;
      const pitchBefore = calculateOuroborosBorealisFrame({
        ...common,
        pitchDirection: direction,
        pitchInterval: interval,
        rhythmInterval: interval,
        pitchPosition: beforePosition,
        rhythmPosition: 0.42,
      });
      const pitchAfter = calculateOuroborosBorealisFrame({
        ...common,
        pitchDirection: direction,
        pitchInterval: interval,
        rhythmInterval: interval,
        pitchPosition: afterPosition,
        rhythmPosition: 0.42,
      });
      assert.deepEqual(
        pitchBefore.rhythmLayers,
        pitchAfter.rhythmLayers,
        "crossing the pitch seam changed the independent rhythm bank",
      );
      let comparedPitch = 0;
      for (let index = 0; index < pitchBefore.pitchLayers.length - 1; index += 1) {
        const earlier = direction > 0
          ? pitchBefore.pitchLayers[index]
          : pitchBefore.pitchLayers[index + 1];
        const later = direction > 0
          ? pitchAfter.pitchLayers[index + 1]
          : pitchAfter.pitchLayers[index];
        if (Math.max(earlier.weight, later.weight) < 1e-5) continue;
        comparedPitch += 1;
        assert.ok(relativeError(later.fundamentalHz, earlier.fundamentalHz) < 5e-8);
        for (const key of [
          "octaveOffset", "normalizedPosition", "window", "safety", "weight",
          "gain", "pan", "morphPosition",
        ]) assert.ok(Math.abs(later[key] - earlier[key]) < 5e-8, key);
        for (const name of ["kick", "tom", "hand", "air"]) {
          assert.ok(
            Math.abs(later.morphWeights[name] - earlier.morphWeights[name]) < 5e-8,
          );
        }
        for (let mode = 0; mode < earlier.modalRatios.length; mode += 1) {
          assert.ok(Math.abs(later.modalRatios[mode] - earlier.modalRatios[mode]) < 5e-8);
          assert.ok(Math.abs(later.modalGains[mode] - earlier.modalGains[mode]) < 5e-8);
        }
      }
      assert.ok(comparedPitch >= 2);
      assert.ok(
        Math.abs(pitchBefore.pitchWeightPower - pitchAfter.pitchWeightPower) < 1e-7,
      );

      const rhythmBefore = calculateOuroborosBorealisFrame({
        ...common,
        rhythmDirection: direction,
        pitchInterval: interval,
        rhythmInterval: interval,
        pitchPosition: 0.42,
        rhythmPosition: beforePosition,
      });
      const rhythmAfter = calculateOuroborosBorealisFrame({
        ...common,
        rhythmDirection: direction,
        pitchInterval: interval,
        rhythmInterval: interval,
        pitchPosition: 0.42,
        rhythmPosition: afterPosition,
      });
      assert.deepEqual(
        rhythmBefore.pitchLayers,
        rhythmAfter.pitchLayers,
        "crossing the rhythm seam changed the independent pitch bank",
      );
      let comparedRhythm = 0;
      for (let index = 0; index < rhythmBefore.rhythmLayers.length - 1; index += 1) {
        const earlier = direction > 0
          ? rhythmBefore.rhythmLayers[index]
          : rhythmBefore.rhythmLayers[index + 1];
        const later = direction > 0
          ? rhythmAfter.rhythmLayers[index + 1]
          : rhythmAfter.rhythmLayers[index];
        if (Math.max(earlier.weight, later.weight) < 1e-5) continue;
        comparedRhythm += 1;
        assert.ok(relativeError(later.hitRate, earlier.hitRate) < 5e-8);
        assert.ok(relativeError(later.rate, earlier.rate) < 5e-8);
        for (const key of [
          "octaveOffset", "normalizedPosition", "window", "safety", "weight",
          "gain", "pan",
        ]) assert.ok(Math.abs(later[key] - earlier[key]) < 5e-8, key);
      }
      assert.ok(comparedRhythm >= 2);
      assert.ok(
        Math.abs(rhythmBefore.rhythmWeightPower - rhythmAfter.rhythmWeightPower)
          < 1e-7,
      );
    }
  }
});

test("the lazy audio wrapper sends sanitized parameters, transport, and strikes", async () => {
  const scheduled = [];
  const runtime = {
    clearTimeout(id) {
      scheduled.push(["clear", id]);
    },
    setTimeout(callback, delay) {
      scheduled.push(["set", callback, delay]);
      return 47;
    },
  };
  const audio = new OuroborosBorealisAudio(runtime);
  assert.equal(audio.context, null);
  assert.equal(audio.node, null);

  audio.setParameters({
    pitchDirection: -1,
    rhythmDirection: 1,
    pitchGlissRate: 999,
    rhythmGlissRate: 999,
    pitchInterval: 0.75,
    rhythmInterval: 1.5,
    level: 0.7,
  });
  assert.equal(audio.context, null, "parameters must not eagerly construct Web Audio");
  assert.equal(audio.params.pitchDirection, -1);
  assert.equal(audio.params.rhythmDirection, 1);
  assert.equal(audio.params.pitchGlissRate, 1.2);
  assert.equal(audio.params.rhythmGlissRate, 1.2);

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
  audio.node = { port: { postMessage(message) { messages.push(message); } } };
  audio.lowpass = {
    frequency: { setTargetAtTime(...args) { filterTargets.push(args); } },
  };
  audio.master = {
    gain: {
      value: 0,
      cancelScheduledValues(time) { ramps.push(["cancel", time]); },
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
    centerRate: 7,
    pitchWidth: 7,
    rhythmWidth: 6,
    phaseOffset: 0.6,
    coupling: -0.7,
    couplingFocus: 0.3,
    cutoff: 12_000,
    spread: 99,
  });
  assert.deepEqual(messages.at(-1), {
    type: "parameters",
    parameters: sanitizeOuroborosBorealisParams({
      ...OUROBOROS_BOREALIS_DEFAULTS,
      pitchDirection: -1,
      rhythmDirection: 1,
      pitchGlissRate: 1.2,
      rhythmGlissRate: 1.2,
      pitchInterval: 0.75,
      rhythmInterval: 1.5,
      level: 0.7,
      centerPitch: 220,
      centerRate: 7,
      pitchWidth: 7,
      rhythmWidth: 6,
      phaseOffset: 0.6,
      coupling: -0.7,
      couplingFocus: 0.3,
      cutoff: 12_000,
      spread: 1,
    }),
  });
  assert.deepEqual(filterTargets.at(-1), [12_000, 3, 0.025]);

  await audio.start();
  assert.equal(resumes, 1);
  assert.equal(audio.enabled, true);
  assert.deepEqual(messages.at(-1), { type: "active", value: true });
  assert.deepEqual(ramps.at(-1), ["ramp", 0.7, 3.035]);
  audio.strike(0.8, 0.37);
  assert.deepEqual(messages.at(-1), {
    type: "strike",
    velocity: 0.8,
    position: 0.37,
  });
  audio.strike(0.4, -10);
  assert.deepEqual(messages.at(-1), { type: "strike", velocity: 0.4, position: 0 });
  audio.strike(0.4, 10);
  assert.deepEqual(messages.at(-1), { type: "strike", velocity: 0.4, position: 1 });
  audio.strike(0.6);
  assert.deepEqual(messages.at(-1), { type: "strike", velocity: 0.6 });

  audio.setParameters({ level: 0.42 });
  assert.deepEqual(ramps.at(-1), ["target", 0.42, 3, 0.015]);
  audio.stop();
  assert.equal(audio.enabled, false);
  assert.deepEqual(messages.at(-1), { type: "active", value: false });
  assert.deepEqual(ramps.at(-1), ["ramp", 0, 3.035]);
  assert.equal(scheduled.at(-1)[0], "set");
  assert.equal(scheduled.at(-1)[2], 55);
});

test("the worklet render loop contains no explicit allocations", async () => {
  const source = await readFile(new URL("src/ouroboros-borealis.js", ROOT), "utf8");
  const start = source.indexOf("    process(_inputs, outputs) {");
  const end = source.indexOf("\n      return true;\n    }\n  };", start);
  assert.ok(start >= 0 && end > start);
  const processBody = source.slice(start, end);
  assert.doesNotMatch(processBody, /\bnew\s+/);
  assert.doesNotMatch(processBody, /Array\.from|\.(?:map|filter|reduce)\(/);
  assert.match(source, /pulsePhases = new Float64Array\(/);
});

test("the worklet renders bounded stereo through both independent seams and extremes", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;
  let registeredName = null;
  let registrationCount = 0;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
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
    await import(`../src/ouroboros-borealis.js?worklet-test=${Date.now()}`);
    assert.equal(registeredName, "morphazoid-ouroboros-borealis");
    assert.equal(registrationCount, 1);
    assert.equal(typeof Processor, "function");

    const quadrants = [
      [1, 1, 0.5, -0.8],
      [1, -1, 1, -0.25],
      [-1, 1, 1.5, 0.25],
      [-1, -1, 2, 0.8],
    ];
    for (const [pitchDirection, rhythmDirection, interval, coupling] of quadrants) {
      const processor = new Processor({
        processorOptions: {
          ...OUROBOROS_BOREALIS_DEFAULTS,
          pitchDirection,
          rhythmDirection,
          pitchGlissRate: 1.2,
          rhythmGlissRate: 1.2,
          pitchInterval: interval,
          rhythmInterval: interval,
          pitchWidth: 9,
          rhythmWidth: 9,
          centerRate: 8,
          spread: 0.8,
          coupling,
          couplingFocus: 0.42,
          phaseOffset: 0.33,
        },
      });
      assert.ok(processor.pulsePhases instanceof Float64Array);
      assert.equal(processor.pulsePhases.length, 21);
      assert.ok(
        Number.isFinite(OUROBOROS_BOREALIS_PHASE_SEED)
          && OUROBOROS_BOREALIS_PHASE_SEED >= 0
          && OUROBOROS_BOREALIS_PHASE_SEED < 1,
      );
      const stateArrays = Object.entries(processor).filter(([, value]) => (
        ArrayBuffer.isView(value) && !(value instanceof DataView)
      ));
      assert.ok(stateArrays.length >= 18, "dual-bank synthesis state should use typed arrays");
      processor.pitchPosition = pitchDirection > 0 ? 0.9995 : 0.0005;
      processor.rhythmPosition = rhythmDirection > 0 ? 0.9995 : 0.0005;
      processor.port.onmessage({ data: { type: "active", value: true } });
      processor.port.onmessage({
        data: { type: "strike", velocity: 0.9, position: 0.65 },
      });

      let previousPitch = processor.pitchPosition;
      let previousRhythm = processor.rhythmPosition;
      let crossedPitch = false;
      let crossedRhythm = false;
      let previousLeft = 0;
      let peak = 0;
      let squareSum = 0;
      let stereoDifference = 0;
      let maximumStep = 0;
      let sampleCount = 0;

      for (let block = 0; block < 120; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        assert.equal(processor.process([], [[left, right]]), true);
        if (pitchDirection > 0 && processor.pitchPosition < previousPitch) crossedPitch = true;
        if (pitchDirection < 0 && processor.pitchPosition > previousPitch) crossedPitch = true;
        if (rhythmDirection > 0 && processor.rhythmPosition < previousRhythm) crossedRhythm = true;
        if (rhythmDirection < 0 && processor.rhythmPosition > previousRhythm) crossedRhythm = true;
        previousPitch = processor.pitchPosition;
        previousRhythm = processor.rhythmPosition;

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
      const label = `${pitchDirection},${rhythmDirection}/${interval}`;
      assert.ok(crossedPitch, `${label} missed the pitch seam`);
      assert.ok(crossedRhythm, `${label} missed the rhythm seam`);
      assert.ok(rms > 0.001, `${label} was unexpectedly silent: ${rms}`);
      assert.ok(rms < 0.35, `${label} was unexpectedly loud: ${rms}`);
      assert.ok(peak < 0.9, `${label} peak escaped its ceiling: ${peak}`);
      assert.ok(maximumStep < 0.7, `${label} produced a discontinuity: ${maximumStep}`);
      assert.ok(
        stereoDifference / (sampleCount * 0.5) > 1e-5,
        `${label} collapsed unexpectedly to mono`,
      );
      for (const [name, reference] of stateArrays) {
        assert.strictEqual(processor[name], reference, `${name} was reallocated`);
      }
    }

    const closeVoices = new Processor({
      processorOptions: {
        ...OUROBOROS_BOREALIS_DEFAULTS,
        pitchDirection: 1,
        rhythmDirection: 1,
        pitchGlissRate: 0.4,
        rhythmGlissRate: 0.3,
        pitchInterval: 0.5,
        rhythmInterval: 0.5,
      },
    });
    const wideVoices = new Processor({
      processorOptions: {
        ...OUROBOROS_BOREALIS_DEFAULTS,
        pitchDirection: 1,
        rhythmDirection: 1,
        pitchGlissRate: 0.4,
        rhythmGlissRate: 0.3,
        pitchInterval: 2,
        rhythmInterval: 2,
      },
    });
    const closePitchStart = closeVoices.pitchPosition;
    const closeRhythmStart = closeVoices.rhythmPosition;
    const widePitchStart = wideVoices.pitchPosition;
    const wideRhythmStart = wideVoices.rhythmPosition;
    closeVoices.port.onmessage({ data: { type: "active", value: true } });
    wideVoices.port.onmessage({ data: { type: "active", value: true } });
    for (let block = 0; block < 30; block += 1) {
      closeVoices.process([], [[new Float32Array(128), new Float32Array(128)]]);
      wideVoices.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.ok(Math.abs(
      (closeVoices.pitchPosition - closePitchStart) * 0.5
        - (wideVoices.pitchPosition - widePitchStart) * 2,
    ) < 1e-8);
    assert.ok(Math.abs(
      (closeVoices.rhythmPosition - closeRhythmStart) * 0.5
        - (wideVoices.rhythmPosition - wideRhythmStart) * 2,
    ) < 1e-8);

    const targeted = new Processor({ processorOptions: OUROBOROS_BOREALIS_DEFAULTS });
    const pitchPosition = targeted.pitchPosition;
    const rhythmPosition = targeted.rhythmPosition;
    targeted.port.onmessage({
      data: { type: "strike", velocity: 0.8, position: 0.9 },
    });
    targeted.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(targeted.pitchPosition, pitchPosition);
    assert.equal(targeted.rhythmPosition, rhythmPosition);

    const phaseOnly = new Processor({
      processorOptions: OUROBOROS_BOREALIS_DEFAULTS,
    });
    const phaseOnlyPitchPosition = phaseOnly.pitchPosition;
    const phaseOnlyRhythmPosition = phaseOnly.rhythmPosition;
    const phasesBeforeOffset = Array.from(phaseOnly.pulsePhases);
    phaseOnly.port.onmessage({
      data: {
        type: "parameters",
        parameters: { phaseOffset: 0.75 },
      },
    });
    assert.equal(phaseOnly.pitchPosition, phaseOnlyPitchPosition);
    assert.equal(phaseOnly.rhythmPosition, phaseOnlyRhythmPosition);
    assert.equal(phaseOnly.current.phaseOffset, 0.75);
    assert.equal(phaseOnly.appliedPhaseOffset, 0.75);
    for (let index = 0; index < phaseOnly.pulsePhases.length; index += 1) {
      assert.ok(
        circularDistance(
          phaseOnly.pulsePhases[index],
          phasesBeforeOffset[index] + 0.5,
        ) < 1e-12,
        `phaseOffset retimed rhythm pulse ${index} incorrectly`,
      );
    }

    const transient = new Processor({
      processorOptions: OUROBOROS_BOREALIS_DEFAULTS,
    });
    transient.port.onmessage({ data: { type: "active", value: true } });
    const warmupBlocks = 100;
    const measuredBlocks = 1_000;
    const rendered = new Float32Array(measuredBlocks * 128);
    let writeOffset = 0;
    for (let block = 0; block < warmupBlocks + measuredBlocks; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      transient.process([], [[left, right]]);
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
    assert.ok(
      p95 / Math.max(1e-9, median) > 2,
      `default lacks percussive contrast (p95/median ${p95 / Math.max(1e-9, median)})`,
    );
    assert.ok(
      p90 / Math.max(1e-9, p10) > 3,
      `default behaves like a noise bed (p90/p10 ${p90 / Math.max(1e-9, p10)})`,
    );

    for (const extreme of [
      {
        pitchGlissRate: 0.02,
        rhythmGlissRate: 0.02,
        centerPitch: 45,
        centerRate: 0.5,
        pitchWidth: 3,
        rhythmWidth: 3,
        pitchInterval: 2,
        rhythmInterval: 2,
        coupling: -1,
        couplingFocus: 0,
        cutoff: 800,
        level: 0,
      },
      {
        pitchGlissRate: 1.2,
        rhythmGlissRate: 1.2,
        centerPitch: 880,
        centerRate: 16,
        pitchWidth: 9,
        rhythmWidth: 9,
        pitchInterval: 0.5,
        rhythmInterval: 0.5,
        coupling: 1,
        couplingFocus: 1,
        cutoff: 18_000,
        level: 0.82,
      },
    ]) {
      const processor = new Processor({
        processorOptions: { ...OUROBOROS_BOREALIS_DEFAULTS, ...extreme },
      });
      processor.port.onmessage({ data: { type: "active", value: true } });
      processor.port.onmessage({ data: { type: "strike", velocity: 1 } });
      for (let block = 0; block < 40; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        processor.process([], [[left, right]]);
        for (const sample of [...left, ...right]) {
          assert.ok(Number.isFinite(sample));
          assert.ok(Math.abs(sample) < 1);
        }
      }
    }
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("the native page exposes accessible Start/Stop and two interactive racetracks", async () => {
  const [markup, app, source, styles] = await Promise.all([
    readFile(new URL("ouroboros-borealis.html", ROOT), "utf8"),
    readFile(new URL("ouroboros-borealis-app.js", ROOT), "utf8"),
    readFile(new URL("src/ouroboros-borealis.js", ROOT), "utf8"),
    readFile(new URL("ouroboros-borealis.css", ROOT), "utf8"),
  ]);

  assert.match(markup, /<title>Ouroboros Borealis — Morphazoid<\/title>/);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /<h1[^>]*>\s*Ouroboros Borealis\s*<\/h1>/);
  assert.match(markup, /<body class="borealis-page">/);
  assert.match(markup, /<main[^>]+id="ouroborosBorealis"/);
  assert.match(markup, /id="audioButton"[\s\S]{0,220}aria-pressed="false"/);
  assert.match(markup, /id="audioButton"[\s\S]{0,260}aria-label="Start Ouroboros Borealis"/);
  assert.match(markup, /id="audioAction"[^>]*>Start</);
  assert.match(markup, /id="audioState">off</);
  const transportTag = markup.match(/<button\b[^>]*\bid="transportButton"[^>]*>/)?.[0];
  assert.ok(transportTag);
  assert.match(transportTag, /\bdata-primary-transport(?:\s|=|>)/);
  assert.match(transportTag, /\baria-pressed="false"/);
  assert.match(markup, /id="transportIcon"[^>]*>▶</);
  assert.match(markup, /id="transportLabel"[^>]*>Start</);
  assert.match(
    markup,
    /id="strikeButton"[^>]+data-midi-trigger="strike"[^>]+aria-label=/,
  );
  const canvasTag = markup.match(/<canvas\b[^>]*\bid="stage"[^>]*>/)?.[0];
  assert.ok(canvasTag);
  assert.match(canvasTag, /\bdata-interactive-track(?:\s|=|>)/);
  assert.match(canvasTag, /\btabindex="0"/);
  assert.match(canvasTag, /\brole="img"/);
  assert.match(canvasTag, /\baria-describedby="canvasInstructions liveStatus"/);
  assert.match(markup, /id="liveStatus"[^>]+aria-live="polite"/);
  assert.match(markup, /id="audioError"[^>]+role="alert"[^>]+hidden/);
  assert.match(markup, /data-reset-all[^>]+data-reset-in-place/);
  assert.match(markup, /two (?:interactive )?(?:aurora )?racetracks/i);
  assert.match(markup, /two playheads/i);
  assert.match(markup, /drag either/i);

  assert.match(markup, /id="pitchDirection"[^>]+role="group"[^>]+aria-label=/);
  assert.match(markup, /id="pitchRise"[^>]+data-value="1"[^>]+aria-pressed="true"/);
  assert.match(markup, /id="pitchFall"[^>]+data-value="-1"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="rhythmDirection"[^>]+role="group"[^>]+aria-label=/);
  assert.match(markup, /id="rhythmAccelerate"[^>]+data-value="1"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="rhythmDecelerate"[^>]+data-value="-1"[^>]+aria-pressed="true"/);
  for (const id of [
    "level", "pitchGlissRate", "centerPitch", "pitchWidth", "pitchInterval",
    "rhythmGlissRate", "centerRate", "rhythmWidth", "rhythmInterval",
    "phaseOffset", "coupling", "couplingFocus", "spread", "decay", "character",
    "morphDepth", "noiseMix", "cutoff",
  ]) {
    assert.match(markup, new RegExp(`<label[^>]+for="${id}"`), id);
    assert.match(markup, new RegExp(`<input[^>]+id="${id}"`), id);
    assert.match(markup, new RegExp(`<output[^>]+id="${id}Out"`), id);
  }
  assert.match(markup, /id="centerPitch"[^>]+min="45"[^>]+max="880"/);
  assert.match(markup, /id="centerRate"[^>]+min="0\.5"[^>]+max="16"/);
  assert.match(markup, /id="pitchWidth"[^>]+min="3"[^>]+max="9"/);
  assert.match(markup, /id="rhythmWidth"[^>]+min="3"[^>]+max="9"/);
  assert.match(markup, /id="pitchInterval"[^>]+min="0\.5"[^>]+max="2"[^>]+value="1"/);
  assert.match(markup, /id="rhythmInterval"[^>]+min="0\.5"[^>]+max="2"[^>]+value="1"/);
  assert.match(markup, /id="phaseOffset"[^>]+min="0"[^>]+max="1"[^>]+value="0\.25"/);
  assert.match(markup, /id="coupling"[^>]+min="-1"[^>]+max="1"[^>]+value="0"/);
  assert.match(markup, /id="couplingFocus"[^>]+min="0"[^>]+max="1"[^>]+value="0\.5"/);
  assert.match(markup, /id="presetGrid"[^>]+role="group"/);
  assert.match(markup, /src="ouroboros-borealis-app\.js"/);
  assert.doesNotMatch(markup, /https?:\/\//);

  assert.match(app, /new OuroborosBorealisAudio\(globalThis\)/);
  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /transportButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /setPressed\(\$\("transportButton"\), state\.audioOn\)/);
  assert.match(app, /function trackPositionFromPointer\(event\)/);
  assert.match(app, /function strikeTrackPosition\(lane, position, velocity/);
  assert.match(app, /function drawPlayhead\(/);
  assert.match(app, /drawPlayhead\(context2d, "pitch", state\.pitchPosition/);
  assert.match(app, /drawPlayhead\(context2d, "rhythm", state\.rhythmPosition/);
  assert.match(app, /function drawStrikeHistory\(/);
  const historyDuration = Number(app.match(/STRIKE_HISTORY_SECONDS\s*=\s*([\d.]+)/)?.[1]);
  assert.ok(historyDuration >= 2.8);
  assert.match(app, /canvas\.addEventListener\("pointerdown"/);
  assert.match(app, /canvas\.addEventListener\("pointermove"/);
  assert.match(app, /canvas\.addEventListener\("pointerup", releaseTrackPointer\)/);
  assert.match(app, /canvas\.addEventListener\("pointercancel", releaseTrackPointer\)/);
  assert.match(app, /canvas\.setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(app, /canvas\.releasePointerCapture\?\.\(event\.pointerId\)/);
  const trackStrike = functionBody(app, "strikeTrackPosition");
  assert.match(trackStrike, /await startAudio\(\)/);
  assert.match(trackStrike, /audio\.strike\([^,\n]+,\s*[^)\n]*position\)/);
  assert.doesNotMatch(trackStrike, /state\.(?:pitchPosition|rhythmPosition)\s*=/);
  const visualAdvance = functionBody(app, "advanceVisualState");
  assert.match(visualAdvance, /advanceOuroborosBorealisCoordinates\(/);
  assert.match(visualAdvance, /state\.pitchTravel \+= advanced\.pitchOctaveDelta/);
  assert.match(visualAdvance, /state\.rhythmTravel \+= advanced\.rhythmOctaveDelta/);
  assert.match(visualAdvance, /state\.pitchPosition = advanced\.pitchPosition/);
  assert.match(visualAdvance, /state\.rhythmPosition = advanced\.rhythmPosition/);
  assert.match(visualAdvance, /rotateRhythmVisualPhases\(advanced\.rhythmWraps\)/);
  const phaseShift = functionBody(app, "shiftRhythmVisualPhases");
  assert.match(phaseShift, /rhythmVisualPhases\.set\(key, wrapUnit\(phase \+ shift\)\)/);
  assert.doesNotMatch(phaseShift, /state\.(?:pitchPosition|rhythmPosition)\s*=/);
  assert.match(
    app,
    /bindRange\("phaseOffset"[\s\S]{0,300}shiftRhythmVisualPhases\(value - prior\)/,
  );
  const applyPreset = functionBody(app, "applyPreset");
  assert.equal(
    (applyPreset.match(/shiftRhythmVisualPhases\(/g) ?? []).length,
    1,
    "one preset phase change must shift the visual rhythm phases exactly once",
  );
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "p"]) {
    assert.match(app, new RegExp(`event\\.key[^\\n]*${key === " " ? '" "' : key}`, "i"));
  }
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /addEventListener\("pageshow"/);
  const pageHide = functionBody(app, "handlePageHide");
  assert.match(pageHide, /audioStartGeneration \+= 1/);
  assert.match(pageHide, /cancelTrackInteraction\(\)/);
  assert.match(pageHide, /audio\.stop\(\)/);
  assert.match(pageHide, /audio\.close\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);
  assert.match(source, /async start\(\)\s*\{\s*await this\.initialize\(\)/);
  assert.match(styles, /#stage\s*\{[^}]*touch-action:\s*none/s);
  assert.match(styles, /@media \(max-width: 560px\)/);
});

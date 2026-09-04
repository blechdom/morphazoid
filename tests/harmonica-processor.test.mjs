import assert from "node:assert/strict";
import test from "node:test";

import {
  HARMONICA_DEFAULTS,
  harmonicaState,
  sanitizeHarmonicaState,
} from "../src/harmonica.js";

const RATE = 48_000;
const BLOCK_SIZE = 128;

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function renderBlock(processor) {
  const left = new Float32Array(BLOCK_SIZE);
  const right = new Float32Array(BLOCK_SIZE);
  assert.equal(processor.process([], [[left, right]]), true);
  for (const channel of [left, right]) {
    for (const sample of channel) {
      assert.ok(Number.isFinite(sample), "the processor must never emit NaN or Infinity");
      assert.ok(Math.abs(sample) <= 0.781, "the output limiter ceiling must be retained");
    }
  }
  return { left, right };
}

function renderBlocks(processor, count) {
  const blocks = [];
  for (let index = 0; index < count; index += 1) blocks.push(renderBlock(processor));
  return blocks;
}

function channelDeltas(blocks, channel) {
  const deltas = [];
  const seamDeltas = [];
  let previous;
  blocks.forEach((block, blockIndex) => {
    for (let frame = 0; frame < block[channel].length; frame += 1) {
      const sample = block[channel][frame];
      if (previous !== undefined) {
        const delta = Math.abs(sample - previous);
        deltas.push(delta);
        if (frame === 0 && blockIndex > 0) seamDeltas.push(delta);
      }
      previous = sample;
    }
  });
  return { deltas, seamDeltas };
}

function transitionMetrics(before, after) {
  const boundaryDeltas = [];
  const allDeltas = [];
  const seamDeltas = [];
  for (const channel of ["left", "right"]) {
    boundaryDeltas.push(Math.abs(
      after[0][channel][0] - before.at(-1)[channel].at(-1),
    ));
    const measured = channelDeltas(after, channel);
    allDeltas.push(...measured.deltas);
    seamDeltas.push(...measured.seamDeltas);
  }
  return {
    boundary: Math.max(...boundaryDeltas),
    maxDelta: Math.max(...allDeltas),
    p999Delta: percentile(allDeltas, 0.999),
    maxBlockSeam: Math.max(0, ...seamDeltas),
  };
}

async function withProcessorHarness(run) {
  const previousRate = globalThis.sampleRate;
  const previousBase = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  let Processor;
  globalThis.sampleRate = RATE;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  };
  globalThis.registerProcessor = (name, implementation) => {
    assert.equal(name, "harmonica-physical-model");
    Processor = implementation;
  };
  try {
    await import(`../src/harmonica-processor.js?continuity=${Date.now()}`);
    assert.equal(typeof Processor, "function");
    const makeProcessor = (configuration = {}) => new Processor({
      processorOptions: {
        configuration: sanitizeHarmonicaState({
          ...HARMONICA_DEFAULTS,
          autoBreath: false,
          vibratoDepth: 0,
          tremoloDepth: 0,
          ...configuration,
        }),
      },
    });
    await run({ makeProcessor });
  } finally {
    globalThis.sampleRate = previousRate;
    globalThis.AudioWorkletProcessor = previousBase;
    globalThis.registerProcessor = previousRegister;
  }
}

function captureTransition(processor, change, blocks = 12) {
  const before = renderBlocks(processor, 4);
  change();
  const after = renderBlocks(processor, blocks);
  return transitionMetrics(before, after);
}

function assertClickSafe(metrics, label) {
  // At 0.78 full scale, a one-sample jump above 0.20 is an impulse-like edge,
  // not a normal articulation transient. Block seams get a tighter ceiling
  // because parameter messages are applied exactly at those boundaries.
  assert.ok(metrics.boundary < 0.18, `${label}: boundary jump ${metrics.boundary}`);
  assert.ok(
    metrics.maxBlockSeam < metrics.p999Delta * 1.5 + 0.015,
    `${label}: block-seam jump ${metrics.maxBlockSeam} vs ${metrics.p999Delta}`,
  );
  assert.ok(metrics.maxDelta < 0.25, `${label}: one-sample jump ${metrics.maxDelta}`);
}

function maximumDifference(first, second, frameCount = BLOCK_SIZE) {
  let difference = 0;
  for (const channel of ["left", "right"]) {
    for (let frame = 0; frame < frameCount; frame += 1) {
      difference = Math.max(
        difference,
        Math.abs(first[channel][frame] - second[channel][frame]),
      );
    }
  }
  return difference;
}

function renderSingleSample(processor) {
  const left = new Float32Array(1);
  const right = new Float32Array(1);
  assert.equal(processor.process([], [[left, right]]), true);
  assert.ok(Number.isFinite(left[0]) && Number.isFinite(right[0]));
  return { left: left[0], right: right[0], breathFlow: processor.breathFlow };
}

function secondDifference(samples, index) {
  return Math.abs(samples[index + 1] - 2 * samples[index] + samples[index - 1]);
}

test("harmonica fast articulation and control changes remain click-safe", async (t) => {
  await withProcessorHarness(async ({ makeProcessor }) => {
    await t.test("rapid technique switches retain continuous output", () => {
      const voice = makeProcessor({
        hole: 4,
        chordWidth: 1,
        breathAttackMs: 8,
        breathReleaseMs: 30,
        breathShiftSlop: 0.5,
        techniqueAmount: 1.15,
        techniqueRateHz: 14,
        handCup: 0.55,
        cupMotionDepth: 0.45,
        tongueBlock: 0.42,
        tongueMotionDepth: 0.4,
        growl: 0.55,
      });
      voice._handleMessage({ type: "breath", flow: -1.1, manual: true });
      renderBlocks(voice, 140);
      for (const techniqueId of [
        "shake-warble",
        "tongue-slap",
        "hand-wah",
        "flutter",
        "growl",
        "draw-bend",
        "dip",
        "fall",
        "octave-tongue-block",
        "double-stop",
        "clean",
      ]) {
        const metrics = captureTransition(voice, () => voice._handleMessage({
          type: "configure",
          configuration: { bluesTechniqueId: techniqueId },
        }), 8);
        assertClickSafe(metrics, techniqueId);
      }
    });

    await t.test("hand-wah activation cannot introduce a first-sample edge", () => {
      const configuration = {
        hole: 4,
        chordWidth: 3,
        breathAttackMs: 0,
        breathReleaseMs: 0,
        techniqueAmount: 2,
        techniqueRateHz: 18,
        handCup: 0.85,
        cupMotionDepth: 0,
        tongueBlock: 0.75,
        tongueMotionDepth: 0,
        growl: 0,
        brightness: 1.5,
        bluesTechniqueId: "clean",
      };
      const changed = makeProcessor(configuration);
      const unchangedReference = makeProcessor(configuration);
      for (const voice of [changed, unchangedReference]) {
        voice._handleMessage({ type: "breath", flow: -1.4, manual: true });
      }
      for (let block = 0; block < 140; block += 1) {
        assert.equal(
          maximumDifference(renderBlock(changed), renderBlock(unchangedReference)),
          0,
        );
      }

      // Choose a loud process boundary so a discontinuous cup-filter switch
      // cannot be hidden by a coincidental oscillator zero crossing.
      let previousChanged;
      let previousReference;
      for (let attempts = 0; attempts < 500; attempts += 1) {
        previousChanged = renderBlock(changed);
        previousReference = renderBlock(unchangedReference);
        assert.equal(maximumDifference(previousChanged, previousReference), 0);
        if (Math.abs(previousChanged.left.at(-1)) > 0.5) break;
      }
      assert.ok(Math.abs(previousChanged.left.at(-1)) > 0.5);

      changed._handleMessage({
        type: "configure",
        configuration: { bluesTechniqueId: "hand-wah" },
      });
      const changedBlock = renderBlock(changed);
      const referenceBlock = renderBlock(unchangedReference);
      const firstSampleDifference = maximumDifference(changedBlock, referenceBlock, 1);

      // This compares against the exact counterfactual next sample, removing
      // the reed waveform's ordinary slope from the measurement. A smoothed
      // articulation may diverge over the block, but not on its first sample.
      assert.ok(
        firstSampleDifference < 0.01,
        `hand-wah introduced a ${firstSampleDifference} first-sample edge`,
      );
    });

    await t.test("fast breath reversals crossfade instead of stepping", () => {
      for (const breathShiftSlop of [0, 0.5, 1]) {
        const voice = makeProcessor({
          hole: 4,
          chordWidth: 1,
          breathAttackMs: 0,
          breathReleaseMs: 0,
          breathShiftSlop,
          handCup: 0.35,
          tongueBlock: 0.2,
          growl: 0.4,
        });
        voice._handleMessage({ type: "breath", flow: -1.2, manual: true });
        renderBlocks(voice, 120);
        for (const flow of [1.2, -0.85, 0.65, -1.2, 0, 1]) {
          const metrics = captureTransition(voice, () => voice._handleMessage({
            type: "breath",
            flow,
            manual: true,
          }), 12);
          assertClickSafe(metrics, `breath shift ${breathShiftSlop}, flow ${flow}`);
        }
      }
    });

    await t.test("breath reversal preserves reed-bank polarity through zero", () => {
      for (const phaseOffset of [0, 17, 43, 89, 137, 211, 307]) {
        const voice = makeProcessor({
          hole: 4,
          chordWidth: 1,
          breathAttackMs: 0,
          breathReleaseMs: 0,
          breathShiftSlop: 0,
          handCup: 0,
          cupMotionDepth: 0,
          tongueBlock: 0,
          tongueMotionDepth: 0,
          growl: 0,
          airLeak: 0,
          brightness: 0.7,
          vocalTractCoupling: 0.7,
        });
        voice._random = () => 0;
        voice._handleMessage({ type: "breath", flow: -1.25, manual: true });
        renderBlocks(voice, 160);
        for (let index = 0; index < phaseOffset; index += 1) renderSingleSample(voice);
        voice._handleMessage({ type: "breath", flow: 1.25, manual: true });
        const trace = [];
        for (let index = 0; index < 800; index += 1) trace.push(renderSingleSample(voice));
        const crossing = trace.findIndex((sample, index) => (
          index > 0 && sample.breathFlow >= 0 && trace[index - 1].breathFlow < 0
        ));
        assert.ok(crossing > 4 && crossing < trace.length - 5);
        for (const channel of ["left", "right"]) {
          const samples = trace.map((sample) => sample[channel]);
          // A discontinuity between the last negative-flow sample and first
          // positive-flow sample appears in the three second differences that
          // straddle that boundary. Compare that localized triplet with the
          // immediately surrounding curvature, not with an arbitrary global
          // peak elsewhere in the waveform.
          const crossingCurvature = Math.max(
            ...[-1, 0, 1].map((offset) => secondDifference(samples, crossing + offset)),
          );
          const neighboringCurvature = Math.max(
            ...[-5, -4, -3, -2, 2, 3, 4, 5]
              .map((offset) => secondDifference(samples, crossing + offset)),
          );
          // The small denominator floor prevents ordinary oscillator phases
          // with nearly zero curvature from manufacturing an unstable ratio.
          const localizedRatio = crossingCurvature / Math.max(0.005, neighboringCurvature);
          assert.ok(
            crossingCurvature < 0.04,
            `phase ${phaseOffset} ${channel}: zero-crossing curvature ${crossingCurvature}`,
          );
          assert.ok(
            localizedRatio < 3.2,
            `phase ${phaseOffset} ${channel}: localized curvature ratio ${localizedRatio}`,
          );
        }
      }
    });

    await t.test("hole, chord, and mouth gestures slide without discontinuities", () => {
      const voice = makeProcessor({
        hole: 2,
        chordWidth: 1,
        breathAttackMs: 5,
        breathReleaseMs: 35,
        breathShiftSlop: 0.7,
        handCup: 0.5,
        tongueBlock: 0.25,
        growl: 0.35,
      });
      voice._handleMessage({ type: "breath", flow: -1, manual: true });
      renderBlocks(voice, 140);
      for (const configuration of [
        { hole: 9, chordWidth: 1 },
        { hole: 6, chordWidth: 5 },
        { hole: 1, chordWidth: 3 },
        { tongueBlock: 1, tonguePosition: -2, tongueHeight: 3 },
        { tongueBlock: 0, tonguePosition: 3, tongueHeight: -2 },
        { handCup: 1, cupMotionDepth: 1, vocalTractCoupling: 2 },
        { handCup: 0, cupMotionDepth: 0, vocalTractCoupling: 0 },
        { bend: 1.5, embouchure: 3, throatOpening: -2 },
        { bend: 0, embouchure: -2, throatOpening: 3 },
      ]) {
        const label = JSON.stringify(configuration);
        const metrics = captureTransition(voice, () => voice._handleMessage({
          type: "configure",
          configuration,
        }), 14);
        assertClickSafe(metrics, label);
      }
    });

    await t.test("material preset and key retunes fade through silence", () => {
      const voice = makeProcessor({ hole: 4, chordWidth: 1 });
      voice._handleMessage({ type: "breath", flow: -1, manual: true });
      renderBlocks(voice, 140);
      for (const [presetId, keyId] of [
        ["g-richter", "g"],
        ["a-richter", "a"],
        ["low-c", "low-c"],
        ["c-richter", "c"],
      ]) {
        const metrics = captureTransition(voice, () => voice._handleMessage({
          type: "configure",
          configuration: harmonicaState(presetId, {
            ...voice.targetConfiguration,
            presetId,
            keyId,
            autoBreath: false,
          }),
        }), 180);
        assertClickSafe(metrics, `${presetId}/${keyId}`);
        assert.equal(voice.presetTransition, null);
        assert.equal(voice.configuration.presetId, presetId);
        assert.equal(voice.configuration.keyId, keyId);
      }
    });
  });
});

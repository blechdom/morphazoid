import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ORDER_TONES_PRESETS,
  analyzeModularOrder,
  continuedFraction,
  continuedFractionConvergents,
  createSeededRandom,
  dominantPeakBins,
  greatestCommonDivisor,
  modularExponentiation,
  modularSequence,
  multiplicativeOrder,
  orderFindingDistribution,
  periodicCoset,
  phasorContributions,
  qftCosetDistribution,
  recoverFactorsFromMeasurement,
  recoverFactorsFromOrder,
  sampleDistribution,
  shotHistogram,
  simulateOrderFindingShots,
} from "../src/order-tones.js";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

function approximately(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );
}

test("friendly presets contain only coprime bases and exact finite orders", () => {
  assert.deepEqual(ORDER_TONES_PRESETS.map(({ modulus }) => modulus), [15, 21, 35]);
  assert.ok(Object.isFrozen(ORDER_TONES_PRESETS));
  for (const preset of ORDER_TONES_PRESETS) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.bases));
    assert.ok(preset.bases.includes(preset.defaultBase));
    for (const base of preset.bases) {
      assert.equal(greatestCommonDivisor(base, preset.modulus), 1);
      const order = multiplicativeOrder(base, preset.modulus);
      assert.ok(order > 0 && order < preset.modulus);
      assert.equal(modularExponentiation(base, order, preset.modulus), 1);
      for (let exponent = 1; exponent < order; exponent += 1) {
        assert.notEqual(modularExponentiation(base, exponent, preset.modulus), 1);
      }
    }
  }
});

test("modular arithmetic reproduces canonical small order-finding sequences", () => {
  assert.equal(greatestCommonDivisor(54, 24), 6);
  assert.equal(greatestCommonDivisor(-54, 24), 6);
  assert.equal(modularExponentiation(2, 0, 15), 1);
  assert.equal(modularExponentiation(2, 100, 15), 1);
  assert.deepEqual(modularSequence(15, 2), [1, 2, 4, 8]);
  assert.deepEqual(modularSequence(21, 2), [1, 2, 4, 8, 16, 11]);
  assert.deepEqual(modularSequence(35, 2), [1, 2, 4, 8, 16, 32, 29, 23, 11, 22, 9, 18]);
  assert.deepEqual(analyzeModularOrder(15, 2), {
    modulus: 15,
    base: 2,
    order: 4,
    residues: [1, 2, 4, 8],
  });
  assert.throws(() => modularSequence(15, 3), /coprime/);
  assert.throws(() => modularExponentiation(2, -1, 15), /exponent/);
});

test("periodic cosets partition a power-of-two counting register", () => {
  assert.deepEqual(periodicCoset(4, 16, 0), [0, 4, 8, 12]);
  assert.deepEqual(periodicCoset(4, 16, 3), [3, 7, 11, 15]);
  const cosets = Array.from({ length: 6 }, (_, offset) => periodicCoset(6, 64, offset));
  const covered = cosets.flat().sort((left, right) => left - right);
  assert.deepEqual(covered, Array.from({ length: 64 }, (_, index) => index));
});

test("inverse-QFT probabilities normalize and form exact peaks when Q is divisible by r", () => {
  const distribution = qftCosetDistribution(4, 8, 0);
  approximately(distribution.probabilities.reduce((sum, value) => sum + value, 0), 1);
  assert.deepEqual(dominantPeakBins(distribution.probabilities, 4), [0, 64, 128, 192]);
  for (const bin of [0, 64, 128, 192]) approximately(distribution.probabilities[bin], 0.25);
  for (const bin of [1, 63, 65, 127, 193, 255]) {
    assert.ok(distribution.probabilities[bin] < 1e-25);
  }

  const selected = phasorContributions(4, 8, 0, 64);
  approximately(selected.probability, 0.25);
  approximately(
    selected.sum.real ** 2 + selected.sum.imaginary ** 2,
    selected.probability,
  );
  assert.equal(selected.contributions.length, 64);
});

test("mixed-coset distribution keeps approximate r-spaced peaks for non-dividing periods", () => {
  const distribution = orderFindingDistribution(21, 2, 8);
  approximately(distribution.probabilities.reduce((sum, value) => sum + value, 0), 1);
  assert.equal(distribution.order, 6);
  assert.equal(distribution.cosets.reduce((sum, coset) => sum + coset.weight, 0), 1);
  const strongest = new Set(dominantPeakBins(distribution.probabilities, 6));
  for (const expected of [0, 43, 85, 128, 171, 213]) {
    assert.ok(strongest.has(expected), `expected peak near bin ${expected}`);
  }
  assert.ok(distribution.probabilities[43] > distribution.probabilities[32] * 100);
});

test("seeded sampling is deterministic and histograms conserve shot count", () => {
  const distribution = orderFindingDistribution(15, 2, 8);
  const first = sampleDistribution(distribution.probabilities, 32, { seed: "same-seed" });
  const second = sampleDistribution(distribution.probabilities, 32, { seed: "same-seed" });
  const third = sampleDistribution(distribution.probabilities, 32, { seed: "different-seed" });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, third);
  assert.ok(first.every((bin) => [0, 64, 128, 192].includes(bin)));
  const histogram = shotHistogram(first, 256);
  assert.equal(histogram.reduce((sum, count) => sum + count, 0), 32);

  const randomA = createSeededRandom(42);
  const randomB = createSeededRandom(42);
  assert.deepEqual(
    Array.from({ length: 8 }, () => randomA()),
    Array.from({ length: 8 }, () => randomB()),
  );
});

test("continued fractions recover usable orders and factor receipts", () => {
  assert.deepEqual(continuedFraction(43, 256), [0, 5, 1, 20, 2]);
  assert.deepEqual(continuedFractionConvergents([0, 4]), [
    { numerator: 0, denominator: 1 },
    { numerator: 1, denominator: 4 },
  ]);

  const fifteen = recoverFactorsFromMeasurement(15, 2, 64, 8);
  assert.equal(fifteen.success, true);
  assert.equal(fifteen.order, 4);
  assert.deepEqual(fifteen.factors, [3, 5]);
  assert.equal(fifteen.reason, "factors-found");

  const reducedPhase = recoverFactorsFromMeasurement(21, 2, 128, 8);
  assert.equal(reducedPhase.success, true);
  assert.equal(reducedPhase.denominator, 2);
  assert.equal(reducedPhase.multiplier, 3);
  assert.equal(reducedPhase.order, 6);
  assert.deepEqual(reducedPhase.factors, [3, 7]);

  const thirtyFive = recoverFactorsFromMeasurement(35, 2, 64, 8);
  assert.equal(thirtyFive.success, true);
  assert.equal(thirtyFive.order, 12);
  assert.deepEqual(thirtyFive.factors, [5, 7]);
});

test("factor post-processing reports honest zero, denominator, odd-order, and trivial-root failures", () => {
  assert.equal(recoverFactorsFromMeasurement(15, 2, 0, 8).reason, "zero-bin");
  assert.equal(recoverFactorsFromMeasurement(15, 2, 1, 8).reason, "no-order-candidate");
  assert.deepEqual(
    recoverFactorsFromMeasurement(21, 4, 85, 8),
    {
      success: false,
      reason: "odd-order",
      message: "The recovered order 3 is odd.",
      order: 3,
      denominator: 3,
      multiplier: 1,
      measuredBin: 85,
      registerSize: 256,
      phase: 85 / 256,
      continuedFraction: [0, 3, 85],
      convergents: [
        { numerator: 0, denominator: 1 },
        { numerator: 1, denominator: 3 },
        { numerator: 85, denominator: 256 },
      ],
      orderReason: "order-recovered",
    },
  );
  const trivial = recoverFactorsFromMeasurement(15, 14, 128, 8);
  assert.equal(trivial.success, false);
  assert.equal(trivial.reason, "trivial-square-root");
  assert.equal(trivial.halfPower, 14);
  assert.equal(recoverFactorsFromOrder(21, 4, 3).reason, "odd-order");
});

test("complete seeded batches carry distributions, conserved counts, and receipts", () => {
  const first = simulateOrderFindingShots({
    modulus: 21,
    base: 2,
    precision: 8,
    count: 64,
    seed: "batch",
  });
  const second = simulateOrderFindingShots({
    modulus: 21,
    base: 2,
    precision: 8,
    count: 64,
    seed: "batch",
  });
  assert.deepEqual(first.shots, second.shots);
  assert.equal(first.histogram.reduce((sum, count) => sum + count, 0), 64);
  assert.equal(first.receipts.length, 64);
  assert.ok(first.receipts.some((receipt) => receipt.success));
  assert.ok(first.receipts.some((receipt) => !receipt.success));
});

test("Order Tones markup follows the shared quantum and Morphazoid contracts", async () => {
  const html = await read("order-tones.html");
  assert.match(html, /<body class="quantum-page order-tones-page">/);
  assert.match(html, /<main class="shell quantum-shell"/);
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);
  assert.match(html, /<link rel="stylesheet" href="quantum-synths\.css"/);
  assert.match(html, /QUANTUM SYNTHS · 01/);
  assert.match(html, /<h1 id="orderTonesTitle">Order Tones<\/h1>/);
  assert.match(html, /EXACT TINY CLASSICAL SIMULATION · NOT QPU OUTPUT/);
  assert.match(html, /id="stage"[\s\S]*role="img"[\s\S]*aria-describedby="orderTonesDescription liveStatus"/);

  for (const id of [
    "stageReadout",
    "liveStatus",
    "audioError",
    "audioButton",
    "audioState",
    "orderN",
    "orderBase",
    "orderPrecision",
    "playButton",
    "computationalView",
    "iqftView",
    "binSlider",
    "oneShotButton",
    "shots64Button",
    "resetButton",
    "shotsHistogram",
    "resultStatus",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);

  assert.match(html, /<small id="audioState">off<\/small>/);
  assert.match(html, /href="shape\.html">shape<\/a>/);
  assert.match(html, /href="order-tones\.html"[^>]*>order tones<\/a>/);
  assert.match(html, /href="bell-square\.html">bell square<\/a>/);
  assert.match(html, /href="annealogue\.html">annealogue<\/a>/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="order-tones-app\.js"><\/script>/);
});

test("Order Tones app bounds rendering and audio and supports required gestures", async () => {
  const [app, math] = await Promise.all([
    read("order-tones-app.js"),
    read("src/order-tones.js"),
  ]);
  assert.match(app, /new VoicePool\(MAX_AUDIO_VOICES\)/);
  assert.match(app, /const MAX_AUDIO_VOICES = 8/);
  assert.match(app, /const MAX_QFT_VOICES = 4/);
  assert.match(app, /Math\.min\(2, Math\.max\(1, globalThis\.devicePixelRatio/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /takeShots\(64\)/);
  assert.match(app, /event\.code === "Space"/);
  assert.match(app, /event\.key === "ArrowLeft"/);
  assert.match(app, /event\.key === "Escape"/);
  const transport = app.slice(
    app.indexOf("function togglePlayback()"),
    app.indexOf("function strikeResidue", app.indexOf("function togglePlayback()")),
  );
  assert.doesNotMatch(transport, /enableAudio|toggleAudio|state\.audio\s*=/);
  assert.match(transport, /playing silently\. Turn Audio on to hear it/);
  assert.match(app, /window\.addEventListener\("pagehide"/);
  assert.match(app, /void pool\.close\(\)/);
  assert.doesNotMatch(app, /new (?:AudioContext|webkitAudioContext)/);
  assert.doesNotMatch(math, /\b(?:document|window|AudioContext|requestAnimationFrame)\b/);
});

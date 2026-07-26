import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_RECURSIVE_FM_PRESET_ID,
  RECURSIVE_FM_LIMITS,
  RECURSIVE_FM_PRESETS,
  deriveRecursiveFmStack,
  formatRecursiveFmFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  sanitizeRecursiveFmSettings,
  summarizeRecursiveFmStack,
} from "../src/recursive-fm.js";

test("Recursive FM preserves the six legacy Morphisma parameter sets", () => {
  assert.equal(RECURSIVE_FM_PRESETS.length, 6);
  assert.equal(DEFAULT_RECURSIVE_FM_PRESET_ID, "deep-well");
  assert.deepEqual(
    RECURSIVE_FM_PRESETS.map(({ settings }) => settings),
    [
      { depth: 0, carrierHz: 1, offsetHz: 0, modulationHz: 500, divisor: 2 },
      { depth: 3, carrierHz: 3.32, offsetHz: 0, modulationHz: 7_307, divisor: 3.68 },
      { depth: 3, carrierHz: 5.25, offsetHz: 5_057, modulationHz: 6_508, divisor: 5.56 },
      { depth: 3, carrierHz: 0.06, offsetHz: 0, modulationHz: 1_650, divisor: 0.18 },
      { depth: 3, carrierHz: 0.18, offsetHz: 4_000, modulationHz: 4_236, divisor: 1.53 },
      { depth: 3, carrierHz: 7, offsetHz: 2_000, modulationHz: 2_340, divisor: 0.75 },
    ],
  );
  assert.ok(Object.isFrozen(RECURSIVE_FM_PRESETS));
  assert.ok(Object.isFrozen(RECURSIVE_FM_PRESETS[0].settings));
});

test("settings sanitizer accepts legacy names and contains unsafe values", () => {
  const settings = sanitizeRecursiveFmSettings({
    steps: 99,
    carrierFreq: Number.POSITIVE_INFINITY,
    offset: -50,
    modAmp: 99_999,
    modAmpDiv: 0,
  }, { sampleRate: 44_100 });

  assert.equal(settings.depth, RECURSIVE_FM_LIMITS.maxDepth);
  assert.equal(settings.carrierHz, 3.32);
  assert.equal(settings.offsetHz, 0);
  assert.equal(settings.modulationHz, 12_000);
  assert.equal(settings.divisor, RECURSIVE_FM_LIMITS.minDivisor);
  assert.equal(settings.maximumFrequencyHz, 19_845);
});

test("amount divisor retains the original Morphisma exploration range", () => {
  assert.equal(RECURSIVE_FM_LIMITS.minDivisor, 0.001);
});

test("operator derivation matches the original safe Recursive FM topology", () => {
  const stack = deriveRecursiveFmStack({
    depth: 3,
    carrierHz: 3.32,
    offsetHz: 0,
    modulationHz: 7_307,
    divisor: 3.68,
  });

  assert.equal(stack.operators.length, 5);
  assert.equal(stack.audibleIndex, 4);
  assert.deepEqual(
    stack.operators.map(({ sourceIndex }) => sourceIndex),
    [null, 0, 1, 2, 3],
  );
  assert.equal(stack.operators[0].biasHz, 3.32);
  assert.equal(stack.operators[1].biasHz, 3_653.5);
  assert.equal(stack.operators[1].modulationHz, 3_653.5);
  assert.equal(stack.operators[2].modulationHz, 3_653.5);
  assert.ok(Math.abs(stack.operators[3].modulationHz - (3_653.5 / 3.68)) < 1e-10);
  assert.ok(stack.normalizedGain >= 0.2 && stack.normalizedGain <= 0.38);
});

test("expanding recursion is capped at a sample-rate-safe ceiling", () => {
  const stack = deriveRecursiveFmStack({
    depth: 10,
    carrierHz: 0.06,
    offsetHz: 0,
    modulationHz: 12_000,
    divisor: 0.05,
  }, { sampleRate: 32_000 });

  assert.equal(stack.settings.maximumFrequencyHz, 14_400);
  for (const operator of stack.operators) {
    assert.ok(operator.modulationHz <= 14_400);
    assert.ok(Number.isFinite(operator.modulationHz));
  }
  assert.equal(stack.operators.length, 12);
  assert.equal(summarizeRecursiveFmStack(stack).label, "10 recursions · 12 operators");
});

test("frequency slider mappings are stable at their bounds and round trip", () => {
  for (const value of [0.01, 0.06, 3.32, 440, 4_800]) {
    const position = logarithmicSliderPosition(value);
    assert.ok(Math.abs(logarithmicSliderValue(position) - value) < 1e-8);
  }
  for (const value of [0, 500, 5_057, 7_307, 12_000]) {
    const position = quadraticSliderPosition(value);
    assert.ok(Math.abs(quadraticSliderValue(position) - value) < 1e-8);
  }
});

test("frequency readouts stay compact", () => {
  assert.equal(formatRecursiveFmFrequency(0.06), "0.06 Hz");
  assert.equal(formatRecursiveFmFrequency(3.32), "3.32 Hz");
  assert.equal(formatRecursiveFmFrequency(440), "440 Hz");
  assert.equal(formatRecursiveFmFrequency(5_057), "5.06 kHz");
  assert.equal(formatRecursiveFmFrequency(12_000), "12 kHz");
});

test("Recursive FM page is internal and uses a gesture-controlled audio button", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../recursive-fm.html", import.meta.url), "utf8"),
    readFile(new URL("../recursive-fm-app.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="audioButton"/);
  assert.match(html, /id="level"/);
  assert.match(html, /id="stage"/);
  assert.match(html, /href="chaotic-synth-ui\.css"/);
  assert.match(html, /class="recursive-fm-signal-graph"/);
  assert.match(html, /id="recursiveFmFlow"/);
  assert.match(html, /carrier modulates the entry oscillator frequency/i);
  assert.doesNotMatch(html, /SPECTROGRAM · LOG FREQUENCY|signal → frequency → signal/);
  assert.doesNotMatch(html, /flowCarrierValue|flowEntryValue|flowRecursionValue|flowOutputValue/);
  assert.match(app, /function updateSignalFlow\(stack\)/);
  assert.match(app, /recursive-fm-mod-edge/);
  assert.match(app, /recursive-fm-tap-switch/);
  assert.match(app, /operator\.modulationHz/);
  assert.match(app, /operators\[0\]\.biasHz < 20/);
  assert.match(app, /updateSignalFlow\(stack\)/);
  assert.match(html, /id="turnsReadout"/);
  assert.doesNotMatch(html, />Turn \d+</);
  assert.match(html, /src="recursive-fm-app\.js"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(app, /class RecursiveFmAudioEngine/);
  assert.match(app, /drawChaoticAnalysis/);
  assert.match(app, /createChaoticSpectrogram/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /\$\("audioButton"\)\.addEventListener\("click"/);
  assert.match(app, /pagehide/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CASCADING_FM_DEFAULTS,
  CASCADING_FM_LIMITS,
  CASCADING_FM_PRESETS,
  DEFAULT_CASCADING_FM_PRESET_ID,
  cascadeRatioForStageCount,
  cascadeFrequencyDirection,
  deriveCascadeStack,
  formatCascadeFrequency,
  formatCascadeRatio,
  ratioSliderPosition,
  ratioSliderValue,
  sanitizeCascadingFmSettings,
} from "../src/cascading-fm.js";

const ROOT = new URL("../", import.meta.url);
const RATIO_UNITY_POSITION = ratioSliderPosition(1);

function approximatelyEqual(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function functionBody(source, signature) {
  const functionStart = source.indexOf(signature);
  assert.ok(functionStart >= 0, `missing ${signature}`);
  const bodyStart = source.indexOf(") {", functionStart) + 2;
  assert.ok(bodyStart > 1, `missing body for ${signature}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`unterminated ${signature}`);
}

test("Cascading FM settings and preset tuples stay bounded and immutable", () => {
  assert.equal(CASCADING_FM_LIMITS.minCascadeRatio, 0.25);
  assert.equal(CASCADING_FM_LIMITS.maxStages, 12);
  assert.equal(sanitizeCascadingFmSettings({ stages: 99 }).stages, 12);
  assert.equal(DEFAULT_CASCADING_FM_PRESET_ID, "brass-choir");
  assert.equal(CASCADING_FM_PRESETS.length, 6);
  assert.ok(Object.isFrozen(CASCADING_FM_PRESETS));
  assert.ok(CASCADING_FM_PRESETS.every(Object.isFrozen));
  assert.ok(CASCADING_FM_PRESETS.every(({ settings }) => Object.isFrozen(settings)));

  assert.equal(sanitizeCascadingFmSettings({ cascadeRatio: 0.01 }).cascadeRatio, 0.25);
  assert.equal(sanitizeCascadingFmSettings({ cascadeRatio: 0.75 }).cascadeRatio, 0.75);
  assert.equal(
    sanitizeCascadingFmSettings({ cascadeRatio: Infinity }).cascadeRatio,
    CASCADING_FM_DEFAULTS.cascadeRatio,
  );

  for (const preset of CASCADING_FM_PRESETS) {
    assert.deepEqual(
      sanitizeCascadingFmSettings(preset.settings),
      preset.settings,
      `${preset.id} is not already sanitized`,
    );
  }
  assert.equal(
    new Set(CASCADING_FM_PRESETS.map(({ settings }) => JSON.stringify(settings))).size,
    CASCADING_FM_PRESETS.length,
    "each preset should select a distinct complete settings tuple",
  );
});

test("factory FM presets stay audible and clear of the ceiling clamp", () => {
  assert.deepEqual(
    CASCADING_FM_DEFAULTS,
    CASCADING_FM_PRESETS.find(({ id }) => id === DEFAULT_CASCADING_FM_PRESET_ID).settings,
  );
  for (const preset of CASCADING_FM_PRESETS) {
    const stack = deriveCascadeStack(preset.settings);
    const carrierHz = stack.oscillators.at(-1).freq;
    assert.ok(preset.settings.stages >= 3 && preset.settings.stages <= 8);
    assert.ok(preset.settings.rootHz >= 55, `${preset.id} root is sub-audio`);
    assert.ok(preset.settings.rootHz <= CASCADING_FM_LIMITS.maxRootHz);
    assert.ok(preset.settings.cascadeRatio <= 4.5, `${preset.id} ratio is too steep`);
    assert.ok(preset.settings.modDepth <= 1_800, `${preset.id} starts too deep`);
    assert.ok(carrierHz >= 500 && carrierHz < CASCADING_FM_LIMITS.audioCeiling,
      `${preset.id} carrier is ${carrierHz} Hz`);

    for (let index = 0; index < stack.oscillators.length; index += 1) {
      const rawFrequencyHz = preset.settings.rootHz
        * preset.settings.cascadeRatio ** index;
      assert.ok(rawFrequencyHz < CASCADING_FM_LIMITS.audioCeiling);
      assert.equal(
        stack.oscillators[index].freq,
        rawFrequencyHz,
        `${preset.id} stage ${index} relies on the frequency ceiling`,
      );
    }
    for (let index = 0; index < stack.connections.length; index += 1) {
      const depthHz = stack.connections[index].depthHz;
      const destinationHz = stack.oscillators[index + 1].freq;
      assert.ok(depthHz <= 1_800, `${preset.id} stage ${index} depth is ${depthHz} Hz`);
      assert.ok(
        depthHz / destinationHz <= 5,
        `${preset.id} stage ${index} deviation is ${(depthHz / destinationHz).toFixed(3)}× its centre`,
      );
    }
    assert.ok(
      stack.connections.at(-1).depthHz / carrierHz <= 0.25,
      `${preset.id} final deviation is too wide`,
    );
  }
});

test("cascade frequencies can fall, remain equal, or rise", () => {
  const common = { stages: 4, rootHz: 64, modDepth: 100, depthTaper: 1 };
  assert.deepEqual(
    deriveCascadeStack({ ...common, cascadeRatio: 0.5 }).oscillators.map(({ freq }) => freq),
    [64, 32, 16, 8],
  );
  assert.deepEqual(
    deriveCascadeStack({ ...common, cascadeRatio: 1 }).oscillators.map(({ freq }) => freq),
    [64, 64, 64, 64],
  );
  assert.deepEqual(
    deriveCascadeStack({ ...common, cascadeRatio: 2 }).oscillators.map(({ freq }) => freq),
    [64, 128, 256, 512],
  );
  assert.equal(cascadeFrequencyDirection(0.5), "falling");
  assert.equal(cascadeFrequencyDirection(1), "equal");
  assert.equal(cascadeFrequencyDirection(2), "rising");
});

test("stage-count compensation preserves rising and descending FM endpoints", () => {
  const cases = [
    { ratio: 3.2, previousStages: 8, nextStages: 12, rootHz: 0.025 },
    { ratio: 0.72, previousStages: 6, nextStages: 11, rootHz: 100 },
    { ratio: 1.5, previousStages: 8, nextStages: 2, rootHz: 0.025 },
    { ratio: 0.9, previousStages: 8, nextStages: 2, rootHz: 100 },
  ];

  for (const { ratio, previousStages, nextStages, rootHz } of cases) {
    const adjustedRatio = cascadeRatioForStageCount(
      ratio,
      previousStages,
      nextStages,
    );
    const previous = deriveCascadeStack({
      stages: previousStages,
      rootHz,
      cascadeRatio: ratio,
      modDepth: 0,
      depthTaper: 1,
    });
    const next = deriveCascadeStack({
      stages: nextStages,
      rootHz,
      cascadeRatio: adjustedRatio,
      modDepth: 0,
      depthTaper: 1,
    });
    const expectedCarrierHz = previous.oscillators.at(-1).freq;
    approximatelyEqual(
      next.oscillators.at(-1).freq,
      expectedCarrierHz,
      Math.max(1, expectedCarrierHz) * 1e-12,
    );
    approximatelyEqual(
      cascadeRatioForStageCount(adjustedRatio, nextStages, previousStages),
      ratio,
      1e-12,
    );
  }
  assert.equal(cascadeRatioForStageCount(1, 2, 12), 1);
});

test("ratio slider preserves useful travel and twelve-stage precision", () => {
  assert.equal(ratioSliderValue(0), CASCADING_FM_LIMITS.minCascadeRatio);
  approximatelyEqual(ratioSliderValue(RATIO_UNITY_POSITION), 1);
  approximatelyEqual(ratioSliderPosition(1), RATIO_UNITY_POSITION);
  approximatelyEqual(ratioSliderValue(1), CASCADING_FM_LIMITS.maxCascadeRatio);

  let previous = ratioSliderValue(0);
  for (let tick = 1; tick <= 10_000; tick += 1) {
    const value = ratioSliderValue(tick / 10_000);
    assert.ok(Number.isFinite(value));
    assert.ok(value > previous, `ratio stopped increasing at slider tick ${tick}`);
    assert.ok(value >= CASCADING_FM_LIMITS.minCascadeRatio);
    assert.ok(value <= CASCADING_FM_LIMITS.maxCascadeRatio);
    previous = value;
  }

  for (const position of [0, 0.08, 0.1, 0.19, RATIO_UNITY_POSITION, 0.21, 0.4, 0.72, 0.9, 1]) {
    approximatelyEqual(ratioSliderPosition(ratioSliderValue(position)), position);
  }
  for (const ratio of [0.25, 0.33, 0.5, 0.8, 1, 1.25, 4, 10, 80, 200]) {
    approximatelyEqual(ratioSliderValue(ratioSliderPosition(ratio)), ratio, 1e-10);
  }

  const musicalStart = ratioSliderPosition(1);
  const musicalEnd = ratioSliderPosition(5);
  assert.ok(
    musicalEnd - musicalStart >= 0.4,
    "the musically useful ×1–×5 region should occupy at least 40% of the track",
  );

  for (let tick = 0; tick < 1_000; tick += 1) {
    const start = musicalStart
      + (musicalEnd - musicalStart - 0.001) * tick / 999;
    const ratioStep = ratioSliderValue(start + 0.001) / ratioSliderValue(start);
    const finalStageStep = ratioStep ** (CASCADING_FM_LIMITS.maxStages - 1);
    assert.ok(
      finalStageStep <= 1.055,
      `one fine drag step compounded to ${finalStageStep.toFixed(4)}× at the final stage`,
    );
  }
});

test("preset ratios occupy the usable rising side of the slider", () => {
  const sorted = [...new Set(
    CASCADING_FM_PRESETS.map(({ settings }) => settings.cascadeRatio),
  )].sort((a, b) => a - b);
  assert.ok(sorted.length >= 4, "factory presets should expose several ratio families");
  let previousPosition = RATIO_UNITY_POSITION;
  for (const ratio of sorted) {
    const position = ratioSliderPosition(ratio);
    approximatelyEqual(ratioSliderValue(position), ratio, 1e-10);
    assert.ok(position > previousPosition, `${ratio} should have a distinct slider position`);
    previousPosition = position;
  }
  const positions = sorted.map((ratio) => ratioSliderPosition(ratio));
  assert.ok(
    positions.at(-1) - positions[0] >= 0.16,
    "factory ratios should not be bunched into a narrow part of the track",
  );
});

test("descending stages retain meaningful sub-Hertz readouts", () => {
  const stack = deriveCascadeStack({
    stages: CASCADING_FM_LIMITS.maxStages,
    rootHz: CASCADING_FM_LIMITS.minRootHz,
    cascadeRatio: CASCADING_FM_LIMITS.minCascadeRatio,
    modDepth: 100,
    depthTaper: 1,
  });
  const labels = stack.oscillators.map(({ freq }) => formatCascadeFrequency(freq));
  assert.deepEqual(labels.slice(-3), ["7.63e-8 Hz", "1.91e-8 Hz", "4.77e-9 Hz"]);
  assert.ok(labels.every((label) => label !== "0 Hz"));
  assert.equal(formatCascadeFrequency(0.009), "9 mHz");
  assert.equal(formatCascadeRatio(0.25), "×0.25");
  assert.equal(formatCascadeRatio(1), "×1");
  assert.equal(formatCascadeRatio(10), "×10");
});

test("preset clicks synchronize the complete UI tuple and the live audio graph", async () => {
  const [app, html] = await Promise.all([
    readFile(new URL("cascading-fm-app.js", ROOT), "utf8"),
    readFile(new URL("cascading-fm.html", ROOT), "utf8"),
  ]);
  const applyBody = functionBody(app, "function applySettings(rawSettings");
  const guardedWrite = /if\s*\(\s*syncControls\s*\)\s*(?:\{\s*)?writeControlsFromState\(\);/;
  assert.match(
    applyBody,
    guardedWrite,
    "control synchronization must be opt-in so a manual drag does not rewrite its own thumb",
  );
  assert.equal(
    [...applyBody.matchAll(/writeControlsFromState\(\);/g)].length,
    1,
    "applySettings must not contain an additional unconditional control write",
  );
  const writeIndex = applyBody.indexOf("writeControlsFromState();");
  const audioIndex = applyBody.indexOf("engine.updateSettings(safe)");
  const outputsIndex = applyBody.indexOf("updateControlOutputs(stack);");
  assert.ok(audioIndex > writeIndex, "slider synchronization should precede live audio retargeting");
  assert.ok(outputsIndex > audioIndex, "readouts should reflect the same stack sent to audio");
  assert.match(
    app,
    /\$\("presetButtons"\)\.addEventListener\("click",[\s\S]*?applySettings\(preset\.settings,\s*\{\s*presetId:\s*preset\.id,\s*syncControls:\s*true\s*\}\)/,
    "preset selection must explicitly synchronize its complete tuple",
  );
  assert.match(
    app,
    /\$\("resetCascadingFm"\)\.addEventListener\("click",[\s\S]*?applySettings\(defaultPreset\.settings,\s*\{\s*presetId:\s*defaultPreset\.id,\s*syncControls:\s*true\s*\}\)/,
    "reset must explicitly synchronize its complete tuple",
  );

  const manualInputHandler = app.match(
    /for \(const \[key, control\] of Object\.entries\(controls\)\) \{\s*control\.input\.addEventListener\("input",[\s\S]*?\n\}/,
  );
  assert.ok(manualInputHandler, "missing manual control input handler");
  assert.match(
    manualInputHandler[0],
    /if \(key === "stages"\)[\s\S]*?cascadeRatioForStageCount\([\s\S]*?\{ syncControls: true \}\);[\s\S]*?return;/,
    "stage changes should preserve the final carrier and move the ratio thumb",
  );
  const nonStageInputPath = manualInputHandler[0].slice(
    manualInputHandler[0].indexOf("return;") + "return;".length,
  );
  assert.match(nonStageInputPath, /applySettings\(\{ \.\.\.state\.settings, \[key\]: value \}\)/);
  assert.doesNotMatch(nonStageInputPath, /syncControls|writeControlsFromState/);

  for (const preset of CASCADING_FM_PRESETS) {
    assert.match(html, new RegExp(`data-preset="${preset.id}"`));
  }
  assert.match(html, /id="stages"[^>]*max="12"/);
  const defaultRatioPosition = ratioSliderPosition(
    CASCADING_FM_PRESETS.find(({ id }) => id === DEFAULT_CASCADING_FM_PRESET_ID)
      .settings.cascadeRatio,
  ).toFixed(4);
  assert.match(html, /id="resetCascadingFm"[^>]*data-reset-all[^>]*data-reset-in-place/);
  assert.match(html, /focused logarithmic · 40% of the track covers ×1 to ×5[^<]*extended range ×0\.25 to ×200/i);
  assert.match(
    html,
    new RegExp(`id="cascadeRatio"[\\s\\S]*?value="${defaultRatioPosition}"[\\s\\S]*?aria-describedby="cascadeRatioNote"`),
    "the static ratio thumb should match the default preset mapping",
  );
  assert.doesNotMatch(html, /unity detent at center/i);
  assert.match(html, /below 1 falls, above 1 rises/i);
});

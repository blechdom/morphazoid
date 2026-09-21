import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CASCADING_FM_PRESETS, CASCADING_FM_DEFAULTS, DEFAULT_CASCADING_FM_PRESET_ID,
  deriveCascadeStack as fmStack,
} from "../src/instruments/cascading-fm/cascading-fm.js";
import {
  CASCADING_PM_PRESETS, CASCADING_PM_DEFAULTS, DEFAULT_CASCADING_PM_PRESET_ID,
  deriveCascadeStack as pmStack, renderCascadingPmSamples,
} from "../src/instruments/cascading-pm/cascading-pm.js";
import { CASCADING_FM_FULL_PRESETS, CASCADING_PM_FULL_PRESETS } from "../src/families/cascading/full-presets.js";
import { renderCascadeReference, summarizeCascadeRhythm, spectrumOfCascade } from "../scripts/presets/cascade-rhythm-analysis.mjs";

const banks = [
  { kind: "fm", factory: CASCADING_FM_PRESETS, full: CASCADING_FM_FULL_PRESETS, defaults: CASCADING_FM_DEFAULTS, defaultId: DEFAULT_CASCADING_FM_PRESET_ID, stack: fmStack },
  { kind: "pm", factory: CASCADING_PM_PRESETS, full: CASCADING_PM_FULL_PRESETS, defaults: CASCADING_PM_DEFAULTS, defaultId: DEFAULT_CASCADING_PM_PRESET_ID, stack: pmStack },
];
const rejectedIds = [
  "brass-choir", "bell-tower", "neon-reed", "glass-forest", "organ-pulse", "electric-wind",
  "slow-cascade", "dense-wave", "wide-steps", "bright-shimmer", "deep-strata", "harmonic-rain",
  "pure-pair", "soft-reed", "crooked-bell", "grinding-chain", "restless-sparks", "slow-orbit",
];

test("each cascade has one replacement bank of twelve complete beginner-readable rhythmic scenes", () => {
  for (const { kind, factory, full, defaults, defaultId, stack } of banks) {
    assert.equal(factory.length, 12);
    assert.equal(full.length, factory.length);
    assert.equal(defaultId, "slow-steps");
    assert.deepEqual(defaults, factory[0].settings);
    assert.ok(!factory.some(preset => rejectedIds.includes(preset.id)));
    assert.equal(new Set(factory.map(preset => JSON.stringify(preset.settings))).size, 12);
    const modes = new Set(factory.map(preset => preset.settings.stages));
    assert.ok(modes.has(2) && modes.has(3), "simple demonstrations before more involved cascades");
    assert.ok(modes.has(5) && modes.has(6) && modes.has(7), "several hierarchy depths");
    for (let index = 0; index < factory.length; index++) {
      const preset = factory[index], ledger = stack(preset.settings);
      assert.equal(preset.motion, "rhythmic");
      assert.ok(preset.label.length <= 20 && !/\bdrone\b/i.test(preset.label));
      assert.ok(preset.description.length > 60);
      assert.deepEqual(full[index].snapshot, {
        settings: preset.settings, activePresetId: preset.id, level: preset.level,
      });
      assert.ok(preset.level <= 0.48 && preset.level > 0);
      assert.ok(preset.settings.rootHz >= 0.125 && preset.settings.rootHz <= 3);
      assert.ok(ledger.oscillators.at(-1).freq >= 45 && ledger.oscillators.at(-1).freq <= 160);
      if (preset.settings.stages >= 4) {
        assert.ok(ledger.oscillators.filter(oscillator => oscillator.freq < 20).length >= 3,
          `${kind}/${preset.id}: several real LFO time scales`);
      }
    }
  }
});

test("analysis PM reference matches the unchanged production model's nested phase equation", () => {
  const preset = CASCADING_PM_PRESETS.find(preset => preset.id === "skipping-stones");
  const sampleRate = 48000, seconds = 0.2, phaseOffset = 0.37;
  const actual = renderCascadeReference("pm", preset.settings, { sampleRate, seconds, phaseOffset }).samples;
  const expected = renderCascadingPmSamples(preset.settings, {
    sampleRate, frameCount: actual.length,
    initialPhases: Array.from({ length: preset.settings.stages }, (_, i) => phaseOffset * (i + 1)),
  });
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-6);
});

test("the FM analysis integrates only preceding-stage frequency modulation, not added amplitude gates", () => {
  const settings = { stages: 2, rootHz: 3, cascadeRatio: 32, modDepth: 72, depthTaper: 1 };
  const sampleRate = 48000;
  const { samples } = renderCascadeReference("fm", settings, { seconds: 0.1, sampleRate });
  let modPhase = 0, carrierPhase = 0;
  for (let i = 0; i < samples.length; i++) {
    assert.ok(Math.abs(samples[i] - Math.sin(carrierPhase)) < 1e-7);
    carrierPhase += Math.PI * 2 * (96 + 72 * Math.sin(modPhase)) / sampleRate;
    modPhase += Math.PI * 2 * 3 / sampleRate;
  }
});

test("all rhythmic presets have motion above their unmodulated carrier across three initial phases", () => {
  const sampleRate = 48000, seconds = 12;
  for (const { kind, factory } of banks) {
    let strongAmplitudeContrasts = 0;
    for (const preset of factory) {
      const unmodulated = { ...preset.settings, ...(kind === "fm" ? { modDepth: 0 } : { phaseIndex: 0 }) };
      const baseline = summarizeCascadeRhythm(renderCascadeReference(kind, unmodulated, { sampleRate, seconds }).samples, sampleRate);
      let minAmplitudeContrast = Infinity;
      for (const phaseOffset of [0, 0.37, 1.1]) {
        const { samples } = renderCascadeReference(kind, preset.settings, { sampleRate, seconds, phaseOffset });
        const actual = summarizeCascadeRhythm(samples, sampleRate);
        assert.ok(actual.peak <= 1 && actual.rms > 0.2 && actual.rms < 0.85, `${kind}/${preset.id}: bounded audible reference`);
        assert.ok(actual.activityContrast > baseline.activityContrast + 0.25,
          `${kind}/${preset.id}: contour must not collapse into a constant sine`);
        assert.ok(actual.accentCount >= 8, `${kind}/${preset.id}: audible activity should change repeatedly`);
        minAmplitudeContrast = Math.min(minAmplitudeContrast, actual.amplitudeContrastDb);
      }
      if (minAmplitudeContrast > 0.6) strongAmplitudeContrasts++;
    }
    assert.ok(strongAmplitudeContrasts >= 8, `${kind}: most hierarchical scenes need genuine amplitude contrast as well as pitch/timbre motion`);
  }
});

test("the replacement voices avoid piercing high-frequency energy throughout their slow cycles", () => {
  for (const { kind, factory } of banks) {
    for (const preset of factory) {
      for (const phaseOffset of [0, 0.37, 1.1]) {
        const { samples } = renderCascadeReference(kind, preset.settings, { seconds: 12, phaseOffset });
        const spectrum = spectrumOfCascade(samples, 48000);
        assert.ok(spectrum.maximumRolloff99Hz < 900, `${kind}/${preset.id}: ${spectrum.maximumRolloff99Hz} Hz rolloff`);
        assert.ok(spectrum.highEnergyAbove2k < 0.0001, `${kind}/${preset.id}: energy above 2 kHz`);
        assert.ok(spectrum.highEnergyAbove5k < 0.000001, `${kind}/${preset.id}: energy above 5 kHz`);
      }
    }
  }
});

test("page startup, Reset and header use the same new bank with no old preset grid or ingredient editor", async () => {
  for (const { kind, factory } of banks) {
    const [html, app] = await Promise.all([
      readFile(new URL(`../cascading-${kind}.html`, import.meta.url), "utf8"),
      readFile(new URL(`../src/instruments/cascading-${kind}/cascading-${kind}-app.js`, import.meta.url), "utf8"),
    ]);
    assert.doesNotMatch(html, /id="presetButtons"|data-preset=|Edit preset ingredients/);
    assert.match(html, /id="presetState">Slow Steps</);
    assert.match(html, new RegExp(`id="level"[^>]*value="${factory[0].level}"`));
    assert.match(app, /const DEFAULT_LEVEL = CASCADING_(FM|PM)_PRESETS\[0\]\.level/);
    assert.match(app, /registerHeaderPresets\(/);
    assert.match(app, /applySettings\(snapshot.settings, \{ presetId: snapshot.activePresetId, syncControls: true \}\)/);
    assert.match(app, /applySettings\(defaultPreset.settings, \{ presetId: defaultPreset.id, syncControls: true \}\)/);
    for (const parameter of Object.keys(factory[0].settings)) {
      assert.match(html, new RegExp(`id="${parameter}"`), `${kind}: preserve direct ${parameter} control`);
    }
  }
  const menu = await readFile(new URL("../src/site/header-presets.js", import.meta.url), "utf8");
  assert.doesNotMatch(menu, /Edit preset ingredients|ingredientSelectors|preset-ingredients/);
});

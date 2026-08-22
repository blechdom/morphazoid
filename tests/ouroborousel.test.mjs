import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OUROBOROUSEL_DEFAULTS,
  OUROBOROUSEL_MATERIAL_MODES,
  OUROBOROUSEL_PHASE_SEED,
  OUROBOROUSEL_PRESETS,
  OuroborouselAudio,
  advanceOuroborouselPosition,
  calculateOuroborouselLayers,
  ouroborouselChunkEnvelope,
  ouroborouselFrequencySafety,
  ouroborouselFusionBlend,
  ouroborouselWindow,
  sanitizeOuroborouselParams,
} from "../src/ouroborousel.js";

const ROOT = new URL("../", import.meta.url);

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

function circularDistance(left, right) {
  const distance = Math.abs(left - right) % 1;
  return Math.min(distance, 1 - distance);
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

test("Ouroborousel parameters are finite, bounded, integral where required, and frozen", () => {
  const sanitized = sanitizeOuroborouselParams({
    materialMode: "taffy",
    direction: -0.01,
    glissRate: 99,
    centerRate: -4,
    bankWidth: 99,
    noteLift: 5.7,
    chunkDuty: -1,
    fusionPoint: 99,
    fusionWidth: 0,
    spread: 9,
    brightness: -2,
    cutoff: 99_000,
    level: 4,
  });

  assert.deepEqual(Object.keys(sanitized), Object.keys(OUROBOROUSEL_DEFAULTS));
  assert.equal(sanitized.materialMode, "notes");
  assert.equal(sanitized.direction, -1);
  assert.equal(sanitized.glissRate, 1.2);
  assert.equal(sanitized.centerRate, 0.5);
  assert.equal(sanitized.bankWidth, 9);
  assert.equal(sanitized.noteLift, 6);
  assert.equal(sanitized.chunkDuty, 0.15);
  assert.equal(sanitized.fusionPoint, 48);
  assert.equal(sanitized.fusionWidth, 0.25);
  assert.equal(sanitized.spread, 1);
  assert.equal(sanitized.brightness, 0);
  assert.equal(sanitized.cutoff, 18_000);
  assert.equal(sanitized.level, 0.82);
  assert.ok(Object.isFrozen(sanitized));
  for (const materialMode of OUROBOROUSEL_MATERIAL_MODES) {
    assert.equal(
      sanitizeOuroborouselParams({ materialMode }).materialMode,
      materialMode,
    );
  }

  assert.deepEqual(sanitizeOuroborouselParams({
    materialMode: null,
    direction: Number.NaN,
    glissRate: Number.NaN,
    centerRate: Infinity,
    bankWidth: -Infinity,
    noteLift: Number.NaN,
    chunkDuty: Number.NaN,
    fusionPoint: Number.NaN,
    fusionWidth: Number.NaN,
    spread: Number.NaN,
    brightness: Number.NaN,
    cutoff: Number.NaN,
    level: Number.NaN,
  }), OUROBOROUSEL_DEFAULTS);
});

test("low note materials raise only their source lift enough to keep a full-safe lane", () => {
  const notes = sanitizeOuroborouselParams({
    materialMode: "notes",
    centerRate: 0.5,
    bankWidth: 3,
    noteLift: 3,
  });
  const combo = sanitizeOuroborouselParams({
    materialMode: "combo",
    centerRate: 0.5,
    bankWidth: 3,
    noteLift: 3,
  });
  const drums = sanitizeOuroborouselParams({
    materialMode: "drums",
    centerRate: 0.5,
    bankWidth: 3,
    noteLift: 3,
  });
  assert.equal(notes.centerRate, 0.5);
  assert.equal(notes.noteLift, 5);
  assert.equal(combo.centerRate, 0.5);
  assert.equal(combo.noteLift, 5);
  assert.equal(drums.centerRate, 0.5);
  assert.equal(drums.noteLift, 3, "drum-only note settings should remain parked");

  const drumFrame = calculateOuroborouselLayers({
    ...drums,
    position: 0,
  });
  assert.equal(drumFrame.noteActiveLayers, 0);
  assert.ok(drumFrame.drumActiveLayers >= 3);
  assert.equal(drumFrame.activeLayers, drumFrame.drumActiveLayers);
  assert.equal(drumFrame.audibleLayers, drumFrame.drumActiveLayers);
  assert.equal(drumFrame.totalHitRate, drumFrame.drumTotalHitRate);
  assert.ok(drumFrame.noteTotalHitRate === 0);
  assert.ok(drumFrame.layers.every((layer) => layer.active === layer.drumActive));
  assert.ok(drumFrame.layers.filter(({ active }) => active).every(({ gain }) => gain > 0));

  for (const materialMode of ["notes", "combo"]) {
    for (const centerRate of [0.5, 0.6, 1, 1.5, 2]) {
      for (const bankWidth of [3, 3.5, 5, 9]) {
        for (let phaseIndex = 0; phaseIndex < 64; phaseIndex += 1) {
          const frame = calculateOuroborouselLayers({
            materialMode,
            centerRate,
            bankWidth,
            noteLift: 3,
            position: phaseIndex / 64,
          });
          assert.equal(frame.layers.some((layer) => (
            layer.window > 1e-7 && layer.safety === 1
          )), true, `${materialMode}/${centerRate}/${bankWidth}/${phaseIndex}`);
          assert.ok(frame.weightPower > 1e-8);
          const expectedActiveLayers = frame.layers.filter((layer) => (
            materialMode === "combo"
              ? layer.noteActive || layer.drumActive
              : layer.noteActive
          ));
          assert.equal(frame.activeLayers, expectedActiveLayers.length);
          assert.equal(
            frame.totalHitRate,
            expectedActiveLayers.reduce((sum, layer) => sum + layer.hitRate, 0),
          );
          for (const layer of frame.layers) {
            assert.ok(relativeError(
              layer.sourceHz / layer.hitRate,
              frame.cyclesPerChunk,
            ) < 1e-12);
          }
        }
      }
    }
  }
});

test("defaults match the page contract and whimsical presets are complete", () => {
  assert.deepEqual(OUROBOROUSEL_DEFAULTS, {
    materialMode: "notes",
    direction: 1,
    glissRate: 0.12,
    centerRate: 8,
    bankWidth: 6,
    noteLift: 6,
    chunkDuty: 0.72,
    fusionPoint: 18,
    fusionWidth: 1,
    spread: 0.48,
    brightness: 0.68,
    cutoff: 12_000,
    level: 0.52,
  });
  assert.ok(Object.isFrozen(OUROBOROUSEL_DEFAULTS));
  assert.deepEqual(OUROBOROUSEL_MATERIAL_MODES, ["notes", "drums", "combo"]);
  assert.ok(Object.isFrozen(OUROBOROUSEL_MATERIAL_MODES));
  assert.ok(Object.isFrozen(OUROBOROUSEL_PRESETS));
  assert.equal(OUROBOROUSEL_PRESETS.length, 6);
  assert.equal(
    new Set(OUROBOROUSEL_PRESETS.map(({ id }) => id)).size,
    OUROBOROUSEL_PRESETS.length,
  );
  assert.ok(OUROBOROUSEL_PRESETS.some(({ direction }) => direction < 0));
  assert.deepEqual(
    new Set(OUROBOROUSEL_PRESETS.map(({ materialMode }) => materialMode)),
    new Set(OUROBOROUSEL_MATERIAL_MODES),
  );
  for (const preset of OUROBOROUSEL_PRESETS) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(preset.label.length > 4);
    assert.ok(preset.description.length > 8);
    const safe = sanitizeOuroborouselParams(preset);
    for (const key of Object.keys(OUROBOROUSEL_DEFAULTS)) {
      assert.equal(safe[key], preset[key], `${preset.id}.${key}`);
    }
  }
});

test("the page wires its recursive rail, transport, controls, and reset accessibly", async () => {
  const [markup, app, styles] = await Promise.all([
    readFile(new URL("ouroborousel.html", ROOT), "utf8"),
    readFile(new URL("ouroborousel-app.js", ROOT), "utf8"),
    readFile(new URL("ouroborousel.css", ROOT), "utf8"),
  ]);

  assert.match(markup, /<title>Ouroborousel — Morphazoid<\/title>/);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /<h1[^>]*>Ouroborousel<\/h1>/);
  assert.match(markup, /<canvas[^>]+id="stage"[^>]+role="slider"/);
  assert.match(markup, /id="transportButton"[^>]+data-primary-transport/);
  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="liveStatus"[^>]+aria-live="polite"/);
  assert.match(markup, /id="soundSummary">open · bright<\/span>/);
  assert.match(
    markup,
    /<fieldset[^>]+id="materialMode"[^>]+aria-label="Sound material"[^>]+aria-describedby="materialModeHelp"/,
  );
  assert.equal((markup.match(/name="soundMaterial"/g) ?? []).length, 3);
  assert.match(markup, /id="materialNotes"[^>]+value="notes"[^>]+checked/);
  assert.match(markup, /id="materialDrums"[^>]+value="drums"/);
  assert.match(markup, /id="materialCombo"[^>]+value="combo"/);
  assert.match(markup, /id="materialModeHelp"/);
  assert.match(markup, /pink and cream dots are Ouroboros drum strikes/);
  assert.match(markup, /data-reset-all[^>]+data-reset-in-place/);
  assert.match(
    app,
    /document\.querySelector\("\[data-reset-all\]"\)\.addEventListener\("click"/,
  );
  assert.match(app, /calculateOuroborouselLayers/);
  assert.match(app, /const DRUM_OVERLAP_POINT = 18/);
  assert.match(app, /ouroborouselFusionBlend\([\s\S]*?DRUM_OVERLAP_POINT/);
  assert.match(app, /new OuroborouselAudio/);
  assert.match(app, /audio\.strike\(velocity, normalized\)/);
  assert.match(app, /function layerMaterialWeight\(layer, materialMode = "notes"\)/);
  assert.match(app, /Number\(layer\?\.drumWeight\)/);
  assert.match(app, /\$\(id\)\.disabled = drumsOnly/);
  assert.match(app, /materialMode === "drums"[\s\S]*?return drumWeight/);
  assert.match(app, /materialMode === "combo"[\s\S]*?Math\.max\(noteWeight, drumWeight\)/);
  assert.match(app, /Ouroboros bodies are live\. Note-only settings stay parked/);
  assert.match(app, /const RAIL_END_POSITION = 1 - Number\.EPSILON/);
  assert.match(
    app,
    /event\.key === "Home" \? 0 : RAIL_END_POSITION/,
  );
  assert.match(
    app,
    /\(note - 24\) \/ 84,[\s\S]*?RAIL_END_POSITION/,
  );
  assert.match(styles, /repeating-conic-gradient/);
  assert.match(styles, /--carousel-red: #e94057/);
  assert.match(styles, /--carousel-pink: #ff7fa8/);
  assert.match(
    styles,
    /\.ouroborousel-segmented\.ouroborousel-material-mode span \{[^}]*min-height: 46px/s,
  );
  assert.match(
    styles,
    /\.ouroborousel-page \.control-section\[data-section="play"\],[\s\S]*?\.control-section\[data-section="sound"\][^{]*\{[^}]*--accent: var\(--carousel-pink\)/,
  );
  assert.doesNotMatch(styles, /#f1c86f|rgba\(241,\s*200,\s*111/);
  assert.doesNotMatch(styles, /#5fe8c4|#7db4ff/);
  assert.match(styles, /@media \(max-width: 840px\)[\s\S]*?#stage \{[\s\S]*?touch-action: pan-y/);

  for (const id of [
    "level",
    "glissRate",
    "centerRate",
    "bankWidth",
    "noteLift",
    "chunkDuty",
    "fusionPoint",
    "fusionWidth",
    "spread",
    "brightness",
    "cutoff",
  ]) {
    assert.match(markup, new RegExp(`<label[^>]+for="${id}"`), id);
    assert.match(markup, new RegExp(`<input[^>]+id="${id}"`), id);
    assert.match(markup, new RegExp(`<output[^>]+id="${id}Out"`), id);
  }
});

test("cosine bank, carrier safety, Hann chunks, and fusion bridge are continuous", () => {
  assert.equal(ouroborouselWindow(-3, 6), 0);
  assert.equal(ouroborouselWindow(3, 6), 0);
  assert.equal(ouroborouselWindow(0, 6), 1);
  assert.ok(Math.abs(ouroborouselWindow(1.5, 6) - 0.5) < 1e-12);

  assert.equal(ouroborouselFrequencySafety(12, 48_000), 0);
  assert.ok(Math.abs(ouroborouselFrequencySafety(16, 48_000) - 0.5) < 1e-12);
  assert.equal(ouroborouselFrequencySafety(20, 48_000), 1);
  assert.equal(ouroborouselFrequencySafety(48_000 * 0.36, 48_000), 1);
  assert.ok(
    Math.abs(ouroborouselFrequencySafety(48_000 * 0.4, 48_000) - 0.5) < 1e-12,
  );
  assert.equal(ouroborouselFrequencySafety(48_000 * 0.44, 48_000), 0);

  const point = 18;
  const width = 1;
  assert.ok(ouroborouselFusionBlend(point / Math.SQRT2, point, width) < 1e-12);
  assert.ok(Math.abs(ouroborouselFusionBlend(point, point, width) - 0.5) < 1e-12);
  assert.ok(1 - ouroborouselFusionBlend(point * Math.SQRT2, point, width) < 1e-12);
  let previous = -1;
  for (let step = -20; step <= 20; step += 1) {
    const blend = ouroborouselFusionBlend(point * 2 ** (step / 20), point, width);
    assert.ok(blend >= previous, "fusion bridge must be monotonic");
    previous = blend;
  }

  assert.equal(ouroborouselChunkEnvelope(0, 0.72), 0);
  assert.ok(Math.abs(ouroborouselChunkEnvelope(0.18, 0.72) - 0.5) < 1e-12);
  assert.equal(ouroborouselChunkEnvelope(0.36, 0.72), 1);
  assert.ok(Math.abs(ouroborouselChunkEnvelope(0.54, 0.72) - 0.5) < 1e-12);
  assert.equal(ouroborouselChunkEnvelope(0.72, 0.72), 0);
  assert.equal(ouroborouselChunkEnvelope(0.9, 0.72), 0);
  assert.equal(ouroborouselChunkEnvelope(1, 0.72), 0);
});

test("position wraps report every crossed octave in either direction", () => {
  assert.deepEqual(advanceOuroborouselPosition(0.9, 0.25), {
    position: 0.1499999999999999,
    wraps: 1,
  });
  assert.deepEqual(advanceOuroborouselPosition(0.1, -0.25), {
    position: 0.8500000000000001,
    wraps: -1,
  });
  assert.deepEqual(advanceOuroborouselPosition(0.2, 2.25), {
    position: 0.4500000000000002,
    wraps: 2,
  });
});

test("tempo lanes and their upper note chunks remain exact octave relatives", () => {
  const frame = calculateOuroborouselLayers({
    position: 0.37,
    centerRate: 4,
    bankWidth: 8,
    noteLift: 6,
    fusionPoint: 18,
    fusionWidth: 1.2,
    spread: 0.7,
  });

  assert.equal(frame.layers.length, 21);
  assert.equal(frame.cyclesPerChunk, 64);
  assert.ok(frame.activeLayers >= 5);
  assert.equal(frame.audibleLayers, frame.activeLayers);
  assert.ok(Math.abs(frame.normalization ** 2 * frame.weightPower - 1) < 1e-12);
  for (let index = 0; index < frame.layers.length; index += 1) {
    const layer = frame.layers[index];
    assert.ok(Number.isFinite(layer.hitRate));
    assert.ok(Number.isFinite(layer.sourceHz));
    assert.ok(relativeError(layer.sourceHz / layer.hitRate, 64) < 1e-12);
    assert.ok(circularDistance(
      layer.carrierPhase,
      (layer.pulsePhase * layer.cyclesPerChunk) % 1,
    ) < 1e-12);
    assert.ok(Math.abs(layer.chunkGain + layer.toneGain - 1) < 1e-12);
    assert.ok(layer.chunkGain >= 0 && layer.toneGain >= 0);
    // At the Hann peak the two correlated paths sum to exactly one carrier;
    // the fusion bridge must not create an equal-power gain hump.
    assert.ok(layer.chunkGain + layer.toneGain <= 1 + 1e-12);
    const sourceIndex = index + Math.log2(frame.cyclesPerChunk);
    if (sourceIndex < frame.layers.length) {
      const sourceLayer = frame.layers[sourceIndex];
      assert.ok(relativeError(layer.sourceHz, sourceLayer.hitRate) < 1e-12);
      assert.ok(circularDistance(
        layer.carrierPhase,
        sourceLayer.pulsePhase,
      ) < 1e-10);
    }
    if (index > 0) {
      assert.ok(relativeError(layer.hitRate / frame.layers[index - 1].hitRate, 2) < 1e-12);
      assert.ok(relativeError(layer.sourceHz / frame.layers[index - 1].sourceHz, 2) < 1e-12);
    }
  }
  assert.ok(Object.isFrozen(frame));
  assert.ok(Object.isFrozen(frame.layers));
  assert.ok(frame.layers.every(Object.isFrozen));
});

test("material modes keep notes and authentic drum bodies on parallel endless banks", () => {
  const notes = calculateOuroborouselLayers({
    materialMode: "notes",
    position: 0.37,
    centerRate: 8,
    bankWidth: 7,
  });
  const drums = calculateOuroborouselLayers({
    materialMode: "drums",
    position: 0.37,
    centerRate: 8,
    bankWidth: 7,
  });
  const combo = calculateOuroborouselLayers({
    materialMode: "combo",
    position: 0.37,
    centerRate: 8,
    bankWidth: 7,
  });

  assert.equal(notes.materialMix, 0);
  assert.equal(notes.noteMaterialGain, 1);
  assert.equal(notes.drumMaterialGain, 0);
  assert.equal(drums.materialMix, 1);
  assert.ok(Math.abs(drums.noteMaterialGain) < 1e-12);
  assert.equal(drums.drumMaterialGain, 1);
  assert.equal(combo.materialMix, 0.5);
  assert.ok(Math.abs(combo.noteMaterialGain - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(combo.drumMaterialGain - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(combo.drumNormalization ** 2 * combo.drumWeightPower - 1) < 1e-12);

  for (let index = 0; index < combo.layers.length; index += 1) {
    const layer = combo.layers[index];
    const morphTotal = Object.values(layer.drumMorphWeights).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    assert.ok(Math.abs(morphTotal - 1) < 1e-12);
    assert.ok(layer.drumWeight >= 0 && layer.drumWeight <= 1);
    if (index > 0) {
      assert.ok(relativeError(
        layer.drumFundamentalHz / combo.layers[index - 1].drumFundamentalHz,
        2,
      ) < 1e-12);
    }
  }
  const centerLayer = combo.layers[Math.floor(combo.layers.length / 2)];
  assert.ok(relativeError(
    centerLayer.drumFundamentalHz,
    110 * 2 ** combo.position,
  ) < 1e-12);
});

test("crossing either endless seam only relabels phase-coherent lanes", () => {
  const epsilon = 1e-9;
  const common = {
    centerRate: 5,
    bankWidth: 8,
    noteLift: 5,
    chunkDuty: 0.64,
    fusionPoint: 21,
    fusionWidth: 1.1,
    spread: 0.6,
  };
  const before = calculateOuroborouselLayers({ ...common, position: 1 - epsilon });
  const after = calculateOuroborouselLayers({ ...common, position: epsilon });
  let compared = 0;
  for (let index = 0; index < before.layers.length - 1; index += 1) {
    const oldLayer = before.layers[index];
    const newLayer = after.layers[index + 1];
    if (Math.max(oldLayer.weight, newLayer.weight) < 1e-6) continue;
    compared += 1;
    assert.ok(relativeError(newLayer.hitRate, oldLayer.hitRate) < 3e-8);
    assert.ok(relativeError(newLayer.sourceHz, oldLayer.sourceHz) < 3e-8);
    assert.ok(Math.abs(newLayer.weight - oldLayer.weight) < 3e-8);
    assert.ok(Math.abs(newLayer.gain - oldLayer.gain) < 4e-8);
    assert.ok(Math.abs(newLayer.fusionBlend - oldLayer.fusionBlend) < 3e-8);
    assert.ok(circularDistance(newLayer.pulsePhase, oldLayer.pulsePhase) < 3e-8);
    assert.ok(circularDistance(newLayer.carrierPhase, oldLayer.carrierPhase) < 1e-6);
  }
  assert.ok(compared >= 5);

  const reverseBefore = calculateOuroborouselLayers({ ...common, position: epsilon });
  const reverseAfter = calculateOuroborouselLayers({ ...common, position: 1 - epsilon });
  for (let index = 0; index < reverseAfter.layers.length - 1; index += 1) {
    const oldLayer = reverseBefore.layers[index + 1];
    const newLayer = reverseAfter.layers[index];
    if (Math.max(oldLayer.weight, newLayer.weight) < 1e-6) continue;
    assert.ok(relativeError(newLayer.hitRate, oldLayer.hitRate) < 3e-8);
    assert.ok(relativeError(newLayer.sourceHz, oldLayer.sourceHz) < 3e-8);
    assert.ok(Math.abs(newLayer.weight - oldLayer.weight) < 3e-8);
  }
});

test("fused note lanes remain audible well beyond the old 96-hit ceiling", () => {
  const frame = calculateOuroborouselLayers({
    position: 0,
    centerRate: 24,
    bankWidth: 9,
    noteLift: 3,
    fusionPoint: 18,
    fusionWidth: 0.5,
    sampleRate: 48_000,
  });
  const extended = frame.layers.filter((layer) => (
    layer.hitRate > 96 && layer.weight > 1e-6
  ));
  assert.ok(extended.length >= 2);
  assert.ok(extended.every(({ sourceHz, safety }) => sourceHz > 768 && safety > 0));
  assert.ok(extended.every(({ fusionBlend, toneGain }) => (
    fusionBlend === 1 && Math.abs(toneGain - 1) < 1e-12
  )));
});

test("worklet process has typed phase state and no render-loop allocations", async () => {
  const source = await readFile(new URL("src/ouroborousel.js", ROOT), "utf8");
  const start = source.indexOf("    process(_inputs, outputs) {");
  const end = source.indexOf("\n      return true;\n    }\n  };", start);
  assert.ok(start >= 0 && end > start);
  const processBody = source.slice(start, end);
  assert.doesNotMatch(processBody, /\bnew\s+/);
  assert.doesNotMatch(processBody, /Array\.from|\.(?:map|filter|reduce)\(/);
  assert.doesNotMatch(processBody, /Math\.tanh/);
  assert.match(source, /pulsePhases = new Float64Array\(LAYER_COUNT\)/);
  assert.match(source, /noteLifts = new Uint8Array\(LAYER_COUNT\)/);
  assert.match(source, /drumSlowEnvelopes = new Float64Array\(LAYER_COUNT\)/);
  assert.match(source, /drumNoiseSeeds = new Uint32Array\(LAYER_COUNT\)/);
  assert.match(source, /drumModalRe = new Float64Array\(LAYER_COUNT \* MODE_COUNT\)/);
  assert.match(source, /drumModalIm = new Float64Array\(LAYER_COUNT \* MODE_COUNT\)/);
  assert.match(source, /copyDrumLayerVoice\(processor, index,/);
  assert.match(source, /clearDrumLayerVoice\(processor,/);
  assert.doesNotMatch(source, /MAX_HIT_RATE|MAX_FULL_HIT_RATE/);
});

test("worklet renders bounded stereo chunks and tones through its octave seam", async () => {
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
  globalThis.registerProcessor = (name, Constructor) => {
    registeredName = name;
    Processor = Constructor;
    registrationCount += 1;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/ouroborousel.js?worklet-test=${Date.now()}`);
    assert.equal(registeredName, "morphazoid-ouroborousel");
    assert.equal(registrationCount, 1);
    assert.equal(typeof Processor, "function");

    const processor = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        glissRate: 1.2,
        centerRate: 12,
        bankWidth: 8,
        noteLift: 3,
        fusionPoint: 18,
        fusionWidth: 0.75,
        spread: 0.82,
      },
    });
    assert.ok(processor.pulsePhases instanceof Float64Array);
    assert.ok(processor.noteLifts instanceof Uint8Array);
    const phaseState = processor.pulsePhases;
    const noteLiftState = processor.noteLifts;
    const typedState = Object.entries(processor).filter(([, value]) => (
      ArrayBuffer.isView(value) && !(value instanceof DataView)
    ));
    assert.ok(typedState.length >= 24, "note and drum voices should use typed state");
    assert.equal(processor.currentMaterialMix, 0);
    processor.port.onmessage({ data: { type: "audible", value: true } });

    for (let block = 0; block < 12; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      assert.equal(left.some((sample) => sample !== 0), false, "paused bank leaked audio");
      assert.equal(right.some((sample) => sample !== 0), false, "paused bank leaked audio");
    }

    processor.port.onmessage({
      data: { type: "strike", velocity: 0.8, position: 0.62 },
    });
    let auditionEnergy = 0;
    for (let block = 0; block < 40; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      processor.process([], [[left, right]]);
      for (let index = 0; index < left.length; index += 1) {
        auditionEnergy += left[index] ** 2 + right[index] ** 2;
      }
    }
    assert.ok(auditionEnergy > 1e-4, "rail strike did not audition an upper note chunk");

    processor.port.onmessage({ data: { type: "position", value: 0.9995 } });
    processor.port.onmessage({ data: { type: "transport", value: true } });
    let previousPosition = processor.position;
    let crossedSeam = false;
    let previousLeft = 0;
    let peak = 0;
    let squareSum = 0;
    let stereoDifference = 0;
    let maximumStep = 0;
    let sampleCount = 0;
    for (let block = 0; block < 220; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([], [[left, right]]), true);
      if (processor.position < previousPosition) crossedSeam = true;
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
    assert.ok(crossedSeam, "render never crossed its octave seam");
    assert.ok(rms > 0.005, `render was unexpectedly silent: ${rms}`);
    assert.ok(rms < 0.4, `render was unexpectedly loud: ${rms}`);
    assert.ok(peak < 0.95, `render peak escaped its ceiling: ${peak}`);
    assert.ok(maximumStep < 0.12, `render contained an abrupt step: ${maximumStep}`);
    assert.ok(stereoDifference / (sampleCount * 0.5) > 1e-4, "render collapsed to mono");
    assert.strictEqual(processor.pulsePhases, phaseState);
    assert.strictEqual(processor.noteLifts, noteLiftState);
    for (const [name, reference] of typedState) {
      assert.strictEqual(processor[name], reference, `${name} was reallocated`);
    }
    assert.ok(
      processor.drumSlowEnvelopes.some((value) => value > 1e-7),
      "hidden drum voices should keep receiving and decaying automatic hits",
    );

    const changed = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        noteLift: 3,
      },
    });
    const unchanged = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        noteLift: 3,
      },
    });
    for (const candidate of [changed, unchanged]) {
      candidate.port.onmessage({ data: { type: "audible", value: true } });
      candidate.port.onmessage({ data: { type: "transport", value: true } });
    }
    let previousChanged = 0;
    for (let block = 0; block < 321; block += 1) {
      const changedLeft = new Float32Array(128);
      const unchangedLeft = new Float32Array(128);
      changed.process([], [[changedLeft, new Float32Array(128)]]);
      unchanged.process([], [[unchangedLeft, new Float32Array(128)]]);
      previousChanged = changedLeft.at(-1);
    }
    changed.port.onmessage({
      data: { type: "parameters", parameters: { noteLift: 7 } },
    });
    assert.ok(changed.noteLifts.every((value) => value === 3));
    const changedLeft = new Float32Array(128);
    const unchangedLeft = new Float32Array(128);
    changed.process([], [[changedLeft, new Float32Array(128)]]);
    unchanged.process([], [[unchangedLeft, new Float32Array(128)]]);
    assert.equal(
      changedLeft[0],
      unchangedLeft[0],
      "note lift changed at an arbitrary render-quantum phase",
    );
    assert.ok(
      Math.abs(changedLeft[0] - previousChanged) < 0.02,
      "note lift update introduced a block-boundary click",
    );
    assert.ok(
      changed.noteLifts.some((value) => value === 7),
      "lanes did not adopt the new lift at their pulse boundaries",
    );

    const drumLayerStateNames = [
      "drumSlowEnvelopes",
      "drumFastEnvelopes",
      "drumPitchBends",
      "drumBodyNoiseLow",
      "drumBodyNoiseHigh",
      "drumAirNoiseLow",
    ];
    const drumModalStateNames = ["drumModalRe", "drumModalIm"];
    for (const direction of [1, -1]) {
      const rotated = new Processor({ processorOptions: OUROBOROUSEL_DEFAULTS });
      for (const name of drumLayerStateNames) {
        for (let index = 0; index < rotated[name].length; index += 1) {
          rotated[name][index] = index + 1;
        }
      }
      for (let index = 0; index < rotated.drumNoiseSeeds.length; index += 1) {
        rotated.drumNoiseSeeds[index] = 1_000 + index;
      }
      for (const name of drumModalStateNames) {
        for (let index = 0; index < rotated[name].length; index += 1) {
          rotated[name][index] = 2_000 + index;
        }
      }
      if (direction > 0) {
        rotated.position = 0.99;
        rotated.pulsePhases[0] = 0.4;
        rotated.noteLifts[0] = 3;
        rotated.port.onmessage({ data: { type: "position", value: 0.01 } });
        assert.equal(rotated.pulsePhases[1], 0.4);
        assert.equal(rotated.noteLifts[1], 3);
        for (const name of drumLayerStateNames) {
          assert.equal(rotated[name][1], 1, `${name} did not rotate upward`);
          assert.equal(rotated[name][0], 0, `${name} did not clear its lower edge`);
        }
        assert.equal(rotated.drumNoiseSeeds[1], 1_000);
        assert.notEqual(rotated.drumNoiseSeeds[0], 0);
        for (const name of drumModalStateNames) {
          for (let mode = 0; mode < 4; mode += 1) {
            assert.equal(rotated[name][4 + mode], 2_000 + mode);
            assert.equal(rotated[name][mode], 0);
          }
        }
      } else {
        const last = rotated.pulsePhases.length - 1;
        rotated.position = 0.01;
        rotated.pulsePhases[1] = 0.6;
        rotated.noteLifts[1] = 7;
        rotated.port.onmessage({ data: { type: "position", value: 0.99 } });
        assert.equal(rotated.pulsePhases[0], 0.6);
        assert.equal(rotated.noteLifts[0], 7);
        for (const name of drumLayerStateNames) {
          assert.equal(rotated[name][0], 2, `${name} did not rotate downward`);
          assert.equal(rotated[name][last], 0, `${name} did not clear its upper edge`);
        }
        assert.equal(rotated.drumNoiseSeeds[0], 1_001);
        assert.notEqual(rotated.drumNoiseSeeds[last], 0);
        for (const name of drumModalStateNames) {
          for (let mode = 0; mode < 4; mode += 1) {
            assert.equal(rotated[name][mode], 2_004 + mode);
            assert.equal(rotated[name][last * 4 + mode], 0);
          }
        }
      }
    }

    const manualDrums = [];
    for (const position of [0.08, 0.92]) {
      const manual = new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode: "drums",
          centerRate: 2,
          bankWidth: 7,
        },
      });
      manual.port.onmessage({ data: { type: "audible", value: true } });
      manual.port.onmessage({
        data: { type: "strike", velocity: 0.82, position },
      });
      let energy = 0;
      for (let block = 0; block < 40; block += 1) {
        const manualLeft = new Float32Array(128);
        const manualRight = new Float32Array(128);
        manual.process([], [[manualLeft, manualRight]]);
        for (let index = 0; index < manualLeft.length; index += 1) {
          energy += manualLeft[index] ** 2 + manualRight[index] ** 2;
        }
      }
      const strongestLayer = manual.drumSlowEnvelopes.indexOf(
        Math.max(...manual.drumSlowEnvelopes),
      );
      assert.equal(manual.transportTarget, 0);
      assert.equal(manual.position, 0, "manual drums moved the transport position");
      assert.ok(energy > 1e-4, "manual drum strike was inaudible without transport");
      manualDrums.push(strongestLayer);
    }
    assert.ok(
      manualDrums[0] < manualDrums[1],
      "opposite rail strikes should excite different low/high drum lanes",
    );

    const materialResults = new Map();
    for (const materialMode of OUROBOROUSEL_MATERIAL_MODES) {
      const material = new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode,
          centerRate: 4,
          bankWidth: 6,
        },
      });
      material.port.onmessage({ data: { type: "audible", value: true } });
      material.port.onmessage({ data: { type: "transport", value: true } });
      const levels = [];
      let materialPeak = 0;
      let materialSquareSum = 0;
      let materialSamples = 0;
      let materialStereoDifference = 0;
      for (let block = 0; block < 1_000; block += 1) {
        const materialLeft = new Float32Array(128);
        const materialRight = new Float32Array(128);
        material.process([], [[materialLeft, materialRight]]);
        let blockSquareSum = 0;
        for (let index = 0; index < materialLeft.length; index += 1) {
          const leftSample = materialLeft[index];
          const rightSample = materialRight[index];
          assert.ok(Number.isFinite(leftSample));
          assert.ok(Number.isFinite(rightSample));
          materialPeak = Math.max(
            materialPeak,
            Math.abs(leftSample),
            Math.abs(rightSample),
          );
          materialSquareSum += leftSample ** 2 + rightSample ** 2;
          materialStereoDifference += Math.abs(leftSample - rightSample);
          materialSamples += 2;
          blockSquareSum += leftSample ** 2;
        }
        if (block >= 80) {
          levels.push(Math.sqrt(blockSquareSum / materialLeft.length));
        }
      }
      const materialRms = Math.sqrt(materialSquareSum / materialSamples);
      assert.ok(materialRms > 0.004, `${materialMode} mode was unexpectedly silent`);
      assert.ok(materialRms < 0.25, `${materialMode} mode was unexpectedly loud`);
      assert.ok(materialPeak < 0.8, `${materialMode} mode escaped its ceiling`);
      assert.ok(
        materialStereoDifference / (materialSamples * 0.5) > 1e-4,
        `${materialMode} mode collapsed to mono`,
      );
      materialResults.set(materialMode, { levels, materialRms });
    }
    const drumLevels = materialResults.get("drums").levels;
    const drumP10 = percentile(drumLevels, 0.1);
    const drumMedian = percentile(drumLevels, 0.5);
    const drumP90 = percentile(drumLevels, 0.9);
    const drumP95 = percentile(drumLevels, 0.95);
    assert.ok(
      drumP95 / Math.max(1e-9, drumMedian) > 2,
      "drum mode lacks the authentic percussive attack",
    );
    assert.ok(
      drumP90 / Math.max(1e-9, drumP10) > 3,
      "drum mode behaves like a constant noise bed",
    );

    const switching = new Processor({ processorOptions: OUROBOROUSEL_DEFAULTS });
    const switchingControl = new Processor({ processorOptions: OUROBOROUSEL_DEFAULTS });
    for (const candidate of [switching, switchingControl]) {
      candidate.port.onmessage({ data: { type: "audible", value: true } });
      candidate.port.onmessage({ data: { type: "transport", value: true } });
    }
    for (let block = 0; block < 180; block += 1) {
      switching.process([], [[new Float32Array(128), new Float32Array(128)]]);
      switchingControl.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    switching.port.onmessage({
      data: { type: "parameters", parameters: { materialMode: "drums" } },
    });
    assert.equal(switching.targetMaterialMix, 1);
    assert.equal(switching.currentMaterialMix, 0);
    const switchingLeft = new Float32Array(128);
    const switchingRight = new Float32Array(128);
    const controlLeft = new Float32Array(128);
    switching.process([], [[switchingLeft, switchingRight]]);
    switchingControl.process([], [[controlLeft, new Float32Array(128)]]);
    assert.ok(
      Math.abs(switchingLeft[0] - controlLeft[0]) < 0.002,
      "material switch jumped instead of starting its slew",
    );
    assert.ok(switching.currentMaterialMix > 0 && switching.currentMaterialMix < 1);
    for (let block = 0; block < 500; block += 1) {
      switching.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.ok(switching.currentMaterialMix > 0.999);

    const lowMaterialSwitch = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        materialMode: "drums",
        centerRate: 0.5,
        bankWidth: 3,
        noteLift: 3,
      },
    });
    lowMaterialSwitch.port.onmessage({ data: { type: "audible", value: true } });
    lowMaterialSwitch.port.onmessage({ data: { type: "transport", value: true } });
    for (let block = 0; block < 100; block += 1) {
      lowMaterialSwitch.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    lowMaterialSwitch.port.onmessage({
      data: { type: "parameters", parameters: { materialMode: "notes" } },
    });
    assert.equal(lowMaterialSwitch.target.noteLift, 5);
    assert.equal(lowMaterialSwitch.targetMaterialMix, 0);
    assert.deepEqual(
      Array.from(lowMaterialSwitch.noteLifts.slice(9, 12)),
      [3, 3, 3],
      "switching material must not retune visible lanes away from a pulse boundary",
    );
    let lowSwitchStarted = -1;
    let lowSwitchSettled = -1;
    let lowSwitchMaximumStep = 0;
    let lowSwitchPreviousSample = 0;
    let transitionSquareSum = 0;
    let transitionSampleCount = 0;
    for (let block = 0; block < 420; block += 1) {
      const switchLeft = new Float32Array(128);
      const switchRight = new Float32Array(128);
      lowMaterialSwitch.process([], [[switchLeft, switchRight]]);
      if (block < 120) {
        assert.equal(
          lowMaterialSwitch.currentMaterialMix,
          1,
          "drums faded before a phase-safe note lane was ready",
        );
      }
      if (lowSwitchStarted < 0 && lowMaterialSwitch.currentMaterialMix < 0.999) {
        lowSwitchStarted = block;
      }
      if (lowSwitchSettled < 0 && lowMaterialSwitch.currentMaterialMix < 0.01) {
        lowSwitchSettled = block;
      }
      let switchSquareSum = 0;
      for (let index = 0; index < switchLeft.length; index += 1) {
        const sample = switchLeft[index];
        lowSwitchMaximumStep = Math.max(
          lowSwitchMaximumStep,
          Math.abs(sample - lowSwitchPreviousSample),
        );
        lowSwitchPreviousSample = sample;
        switchSquareSum += sample ** 2;
      }
      if (
        lowMaterialSwitch.currentMaterialMix < 0.99
        && lowMaterialSwitch.currentMaterialMix > 0.01
      ) {
        transitionSquareSum += switchSquareSum;
        transitionSampleCount += switchLeft.length;
      }
    }
    assert.ok(lowSwitchStarted >= 120 && lowSwitchStarted < 260);
    assert.ok(lowSwitchSettled > lowSwitchStarted);
    assert.ok(lowMaterialSwitch.currentMaterialMix < 1e-6);
    assert.ok(
      Math.sqrt(transitionSquareSum / transitionSampleCount) > 0.003,
      "material switch crossed silence",
    );
    assert.ok(
      lowSwitchMaximumStep < 0.02,
      `phase-safe material switch produced a ${lowSwitchMaximumStep} sample step`,
    );

    for (const centerRate of [0.5, 0.6, 1]) {
      const lowNotes = new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode: "notes",
          centerRate,
          bankWidth: 3,
          noteLift: 3,
          glissRate: 1.2,
        },
      });
      assert.ok(lowNotes.target.noteLift > 3);
      assert.equal(lowNotes.target.centerRate, centerRate);
      lowNotes.port.onmessage({ data: { type: "audible", value: true } });
      lowNotes.port.onmessage({ data: { type: "transport", value: true } });
      let lowSquareSum = 0;
      let lowSampleCount = 0;
      let lowMaximumStep = 0;
      let lowPreviousSample = 0;
      for (let block = 0; block < 600; block += 1) {
        const lowLeft = new Float32Array(128);
        const lowRight = new Float32Array(128);
        lowNotes.process([], [[lowLeft, lowRight]]);
        for (let index = 0; index < lowLeft.length; index += 1) {
          const sample = lowLeft[index];
          assert.ok(Number.isFinite(sample));
          lowMaximumStep = Math.max(
            lowMaximumStep,
            Math.abs(sample - lowPreviousSample),
          );
          lowPreviousSample = sample;
          if (block >= 80) {
            lowSquareSum += sample ** 2;
            lowSampleCount += 1;
          }
        }
      }
      const lowRms = Math.sqrt(lowSquareSum / lowSampleCount);
      assert.ok(lowRms > 0.003, `${centerRate} Hz note bank dropped out`);
      assert.ok(
        lowMaximumStep < 0.02,
        `${centerRate} Hz safety fade produced a ${lowMaximumStep} sample step`,
      );
    }

    for (const transition of [
      {
        label: "center-rate",
        initial: { centerRate: 2, bankWidth: 3, noteLift: 3 },
        update: { centerRate: 0.5 },
        property: "centerRate",
        target: 0.5,
        minimumHoldBlocks: 20,
      },
      {
        label: "bank-width",
        initial: { centerRate: 0.5, bankWidth: 9, noteLift: 3 },
        update: { bankWidth: 3 },
        property: "bankWidth",
        target: 3,
        minimumHoldBlocks: 100,
      },
    ]) {
      const liveControl = new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode: "notes",
          ...transition.initial,
        },
      });
      liveControl.port.onmessage({ data: { type: "audible", value: true } });
      liveControl.port.onmessage({ data: { type: "transport", value: true } });
      let livePreviousSample = 0;
      for (let block = 0; block < 100; block += 1) {
        const warmLeft = new Float32Array(128);
        liveControl.process([], [[warmLeft, new Float32Array(128)]]);
        livePreviousSample = warmLeft.at(-1);
      }
      liveControl.port.onmessage({
        data: { type: "parameters", parameters: transition.update },
      });
      assert.equal(liveControl.target.noteLift, 5);
      let liveControlMovedAt = -1;
      let liveMaximumStep = 0;
      let liveEnergy = 0;
      for (let block = 0; block < 500; block += 1) {
        const liveLeft = new Float32Array(128);
        const liveRight = new Float32Array(128);
        liveControl.process([], [[liveLeft, liveRight]]);
        if (
          liveControlMovedAt < 0
          && Math.abs(
            liveControl.current[transition.property]
              - transition.initial[transition.property]
          ) > 1e-10
        ) {
          liveControlMovedAt = block;
        }
        assert.equal(
          liveControl.hasSafeNoteLane(
            liveControl.current.centerRate,
            liveControl.current.bankWidth,
            48_000,
          ),
          true,
          `${transition.label} abandoned its old safe note bank`,
        );
        for (let index = 0; index < liveLeft.length; index += 1) {
          const sample = liveLeft[index];
          liveMaximumStep = Math.max(
            liveMaximumStep,
            Math.abs(sample - livePreviousSample),
          );
          livePreviousSample = sample;
          liveEnergy += sample ** 2;
        }
      }
      assert.ok(liveControlMovedAt >= transition.minimumHoldBlocks);
      assert.ok(Math.abs(
        liveControl.current[transition.property] - transition.target
      ) < 1e-6);
      assert.ok(liveEnergy > 1, `${transition.label} transition dropped out`);
      assert.ok(
        liveMaximumStep < 0.01,
        `${transition.label} transition produced a ${liveMaximumStep} sample step`,
      );
    }

    const saturatedRetrigger = new Processor({
      processorOptions: OUROBOROUSEL_DEFAULTS,
    });
    saturatedRetrigger.port.onmessage({ data: { type: "audible", value: true } });
    saturatedRetrigger.manualSlowEnvelope = 1.6;
    saturatedRetrigger.manualFastEnvelope = 0;
    saturatedRetrigger.port.onmessage({
      data: { type: "strike", velocity: 1, position: 0.08 },
    });
    saturatedRetrigger.process([], [[new Float32Array(1), new Float32Array(1)]]);
    assert.ok(
      saturatedRetrigger.manualSlowEnvelope
        - saturatedRetrigger.manualFastEnvelope >= 1.6,
      "a saturated retrigger reduced the live manual envelope",
    );

    for (const materialMode of ["notes", "combo"]) {
      const rapidManual = new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode,
        },
      });
      rapidManual.port.onmessage({ data: { type: "audible", value: true } });
      let rapidPreviousSample = 0;
      let rapidMaximumStep = 0;
      let rapidEnergy = 0;
      for (let block = 0; block < 300; block += 1) {
        if (block % 14 === 0) {
          rapidManual.port.onmessage({
            data: { type: "strike", velocity: 1, position: 0.08 },
          });
        }
        const rapidLeft = new Float32Array(128);
        const rapidRight = new Float32Array(128);
        rapidManual.process([], [[rapidLeft, rapidRight]]);
        for (let index = 0; index < rapidLeft.length; index += 1) {
          const sample = rapidLeft[index];
          if (block >= 20) {
            rapidMaximumStep = Math.max(
              rapidMaximumStep,
              Math.abs(sample - rapidPreviousSample),
            );
          }
          rapidPreviousSample = sample;
          rapidEnergy += sample ** 2;
        }
      }
      assert.ok(rapidEnergy > 1, `${materialMode} rapid strikes were inaudible`);
      assert.ok(
        rapidMaximumStep < 0.01,
        `${materialMode} rapid retriggers produced a ${rapidMaximumStep} sample step`,
      );
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

test("audio wrapper keeps audibility, transport, position, and strikes independent", async () => {
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
  const audio = new OuroborouselAudio(runtime);
  assert.equal(audio.context, null);
  assert.equal(audio.enabled, false);
  assert.equal(audio.transportRunning, false);
  audio.setParameters({ noteLift: 99, fusionPoint: 2, level: 0.7 });
  assert.equal(audio.context, null, "parameter changes must remain lazy");
  assert.equal(audio.params.noteLift, 7);
  assert.equal(audio.params.fusionPoint, 8);

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
    port: { postMessage(message) { messages.push(message); } },
  };
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

  assert.equal(audio.setTransport(true), false);
  await audio.enable();
  assert.equal(resumes, 1);
  assert.equal(audio.enabled, true);
  assert.equal(audio.transportRunning, false);
  assert.deepEqual(messages.at(-1), { type: "audible", value: true });
  assert.deepEqual(ramps.at(-1), ["ramp", 0.7, 3.035]);

  assert.equal(audio.setPosition(-0.25), true);
  assert.deepEqual(messages.at(-1), { type: "position", value: 0.75 });
  assert.equal(audio.strike(2, 0.6), true);
  assert.deepEqual(messages.at(-1), { type: "strike", velocity: 1, position: 0.6 });
  assert.equal(audio.accent(0.4), true);
  assert.deepEqual(messages.at(-1), { type: "strike", velocity: 0.4 });

  await audio.start();
  assert.equal(audio.transportRunning, true);
  assert.deepEqual(messages.at(-1), { type: "transport", value: true });
  assert.equal(audio.stopTransport(), true);
  assert.equal(audio.transportRunning, false);
  assert.deepEqual(messages.at(-1), { type: "transport", value: false });

  audio.setParameters({ cutoff: 9_000, level: 0.42 });
  assert.deepEqual(filterTargets.at(-1), [9_000, 3, 0.025]);
  assert.deepEqual(ramps.at(-1), ["target", 0.42, 3, 0.015]);
  audio.stop();
  assert.equal(audio.enabled, false);
  assert.equal(audio.transportRunning, false);
  assert.deepEqual(messages.slice(-2), [
    { type: "transport", value: false },
    { type: "audible", value: false },
  ]);
  assert.equal(scheduled.at(-1)[0], "set");
  assert.equal(scheduled.at(-1)[2], 55);
});

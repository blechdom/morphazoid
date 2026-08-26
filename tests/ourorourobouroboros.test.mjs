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
  ouroborouselContinuumGate,
  ouroborouselDrumFusionGate,
  ouroborouselDrumFusionHarmonic,
  ouroborouselDrumFusionToneBlend,
  ouroborouselFrequencySafety,
  ouroborouselFusionBlend,
  ouroborouselFusionSpotlight,
  ouroborouselFusionToneGain,
  ouroborouselNestedSilenceGate,
  ouroborouselAudioMix,
  ouroborouselPitchBlend,
  ouroborouselPitchLift,
  ouroborouselRhythmShare,
  ouroborouselWindow,
  sanitizeOuroborouselParams,
} from "../src/ourorourobouroboros.js";

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

function spectralMagnitude(values, frequency, sampleRate = 48_000) {
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < values.length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos(
      Math.PI * 2 * index / Math.max(1, values.length - 1),
    );
    const angle = Math.PI * 2 * frequency * index / sampleRate;
    real += values[index] * window * Math.cos(angle);
    imaginary -= values[index] * window * Math.sin(angle);
  }
  return Math.hypot(real, imaginary) / Math.max(1, values.length);
}

test("Ourorourobouroboros parameters are finite, bounded, integral where required, and frozen", () => {
  const sanitized = sanitizeOuroborouselParams({
    materialMode: "taffy",
    direction: -0.01,
    glissRate: 99,
    centerRate: -4,
    bankWidth: 99,
    noteLift: 5.7,
    chunkDuty: -1,
    nestedSilence: 9,
    audioMix: 9,
    fusionPoint: 99,
    fusionWidth: 0,
    fusionEmphasis: 9,
    spread: 9,
    brightness: -2,
    cutoff: 99_000,
    level: 4,
  });

  assert.deepEqual(Object.keys(sanitized), Object.keys(OUROBOROUSEL_DEFAULTS));
  assert.equal(sanitized.materialMode, "combo");
  assert.equal(sanitized.direction, -1);
  assert.equal(sanitized.glissRate, 1.2);
  assert.equal(sanitized.centerRate, 0.5);
  assert.equal(sanitized.bankWidth, 20);
  assert.equal(sanitized.noteLift, 6);
  assert.equal(sanitized.chunkDuty, 0.15);
  assert.equal(sanitized.nestedSilence, 1);
  assert.equal(sanitized.audioMix, 1);
  assert.equal(sanitized.fusionPoint, 48);
  assert.equal(sanitized.fusionWidth, 0.25);
  assert.equal(sanitized.fusionEmphasis, 1);
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
    nestedSilence: Number.NaN,
    audioMix: Number.NaN,
    fusionPoint: Number.NaN,
    fusionWidth: Number.NaN,
    fusionEmphasis: Number.NaN,
    spread: Number.NaN,
    brightness: Number.NaN,
    cutoff: Number.NaN,
    level: Number.NaN,
  }), OUROBOROUSEL_DEFAULTS);
  assert.equal(sanitizeOuroborouselParams({ fusionWidth: 99 }).fusionWidth, 6);
  assert.equal(
    sanitizeOuroborouselParams({ nestedSilence: -1 }).nestedSilence,
    0,
  );
  assert.equal(
    sanitizeOuroborouselParams({ fusionEmphasis: -1 }).fusionEmphasis,
    0,
  );
  assert.equal(sanitizeOuroborouselParams({ audioMix: -1 }).audioMix, 0);
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

test("a low narrow Notes bank falls back to audible octave-lifted chunks", () => {
  const notes = calculateOuroborouselLayers({
    materialMode: "notes",
    centerRate: 2,
    bankWidth: 3,
    noteLift: 7,
    position: 0,
  });
  const combo = calculateOuroborouselLayers({
    materialMode: "combo",
    centerRate: 2,
    bankWidth: 3,
    noteLift: 7,
    position: 0,
  });

  for (const frame of [notes, combo]) {
    assert.ok(frame.noteActiveLayers > 0);
    assert.ok(frame.noteTotalHitRate > 0);
    assert.ok(frame.weightPower > 1e-8);
    assert.ok(frame.layers.every(({ noteToneWeight }) => noteToneWeight === 0));
    assert.ok(frame.layers.some(({ noteRhythmWeight }) => (
      noteRhythmWeight > 1e-6
    )));
  }
});

test("Notes articulates pitched chunks below fusion without thickening Layered or Drums", () => {
  const common = {
    ...OUROBOROUSEL_DEFAULTS,
    position: 0,
  };
  const notes = calculateOuroborouselLayers({
    ...common,
    materialMode: "notes",
  });
  const combo = calculateOuroborouselLayers({
    ...common,
    materialMode: "combo",
  });
  const drums = calculateOuroborouselLayers({
    ...common,
    materialMode: "drums",
  });
  const articulated = notes.layers.filter(({ noteRhythmWeight }) => (
    noteRhythmWeight > 1e-6
  ));

  assert.ok(articulated.length >= 5, "Notes lacks a playable pitched rhythm bank");
  assert.ok(Math.max(...articulated.map(({ noteRhythmWeight }) => (
    noteRhythmWeight
  ))) > 0.95);
  assert.ok(articulated.some(({ sourceHz }) => sourceHz >= 55 && sourceHz <= 220));
  for (const layer of articulated) {
    assert.ok(Math.abs(
      layer.noteRhythmWeight
        - layer.window
          * layer.safety
          * layer.pitchPulseShare
          * layer.fusionSpotlight,
    ) < 1e-12);
    assert.ok(
      layer.hitRate < OUROBOROUSEL_DEFAULTS.fusionPoint * 4,
      `pitched chunk survived beyond fusion at ${layer.hitRate} Hz`,
    );
  }
  assert.ok(combo.layers.every(({ noteRhythmWeight }) => noteRhythmWeight === 0));
  assert.ok(drums.layers.every(({ noteRhythmWeight }) => noteRhythmWeight === 0));
  assert.deepEqual(
    combo.layers.map(({ noteToneWeight }) => noteToneWeight),
    notes.layers.map(({ noteToneWeight }) => noteToneWeight),
    "Notes changed the existing sustained/nested rail",
  );
});

test("defaults match the page contract and whimsical presets are complete", () => {
  assert.deepEqual(OUROBOROUSEL_DEFAULTS, {
    materialMode: "combo",
    direction: 1,
    glissRate: 0.12,
    centerRate: 4,
    bankWidth: 8,
    noteLift: 4,
    chunkDuty: 0.72,
    nestedSilence: 0.8,
    audioMix: 0.5,
    fusionPoint: 18,
    fusionWidth: 2,
    fusionEmphasis: 0,
    spread: 0.48,
    brightness: 0.68,
    cutoff: 12_000,
    level: 0.52,
  });
  assert.ok(Object.isFrozen(OUROBOROUSEL_DEFAULTS));
  assert.deepEqual(OUROBOROUSEL_MATERIAL_MODES, ["notes", "drums", "combo"]);
  assert.ok(Object.isFrozen(OUROBOROUSEL_MATERIAL_MODES));
  assert.ok(Object.isFrozen(OUROBOROUSEL_PRESETS));
  assert.ok(OUROBOROUSEL_PRESETS.length >= 6);
  assert.equal(OUROBOROUSEL_PRESETS[0].centerRate, 4);
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
    if (preset.materialMode === "drums") {
      const fusionOffset = Math.log2(preset.fusionPoint / preset.centerRate);
      assert.ok(
        ouroborouselWindow(fusionOffset, preset.bankWidth) > 0.1,
        `${preset.id} hides its drum-fusion point outside the audible bank`,
      );
    }
  }
});

test("the new page wires its recursive rail, ring stepper, transport, controls, and reset accessibly", async () => {
  const [markup, app, styles] = await Promise.all([
    readFile(new URL("ourorourobouroboros.html", ROOT), "utf8"),
    readFile(new URL("ourorourobouroboros-app.js", ROOT), "utf8"),
    readFile(new URL("ourorourobouroboros.css", ROOT), "utf8"),
  ]);

  assert.match(markup, /<title>Ourorourobouroboros — Morphazoid<\/title>/);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 0);
  assert.match(markup, /<section class="ouroborousel-performance" aria-label="Ourorourobouroboros">/);
  assert.doesNotMatch(markup, /ENDLESS RECURSIVE RHYTHM|id="rateReadout"|id="sourceReadout"|id="fusionReadout"/);
  assert.doesNotMatch(
    markup,
    /ouroborousel-stage-meta|ouroborousel-axis-labels|ouroborousel-loop-core|ouroborousel-rule|ouroborousel-explainer/,
  );
  assert.match(markup, /<canvas[^>]+id="stage"[^>]+role="slider"/);
  assert.match(markup, /id="transportButton"[^>]+data-primary-transport/);
  assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
  assert.match(markup, /id="liveStatus"[^>]+aria-live="polite"/);
  assert.match(markup, /id="soundSummary">open · bright<\/span>/);
  assert.match(
    markup,
    /<fieldset[^>]+id="materialMode"[^>]+aria-label="Sound source"[^>]+aria-describedby="materialModeHelp"/,
  );
  assert.equal((markup.match(/name="soundMaterial"/g) ?? []).length, 3);
  assert.match(markup, /id="materialNotes"[^>]+value="notes"/);
  assert.match(markup, /id="materialDrums"[^>]+value="drums"/);
  assert.match(markup, /id="materialCombo"[^>]+value="combo"[^>]+checked/);
  assert.match(markup, /id="materialModeHelp"/);
  assert.match(markup, /aria-describedby="canvasInstructions materialModeHelp recursionNote liveStatus"/);
  assert.match(markup, /id="centerRate"[^>]+value="4"/);
  assert.match(markup, /id="bankWidthOut"[^>]*>8 rings<\/output>/);
  assert.match(markup, /id="bankWidth"[^>]+min="3"[^>]+max="20"[^>]+step="1"[^>]+value="8"/);
  assert.match(markup, /id="bankWidthDown"[^>]+aria-label="Remove one Shepard ring"/);
  assert.match(markup, /id="bankWidthUp"[^>]+aria-label="Add one Shepard ring"/);
  assert.match(markup, /for="noteLift"[\s\S]*?<b>Note lift \/ nested distance<\/b>/);
  assert.match(markup, /id="noteLiftOut"[^>]*>4 oct · 1\.13 pulses\/s at 18 Hz<\/output>/);
  assert.match(markup, /id="noteLift"[^>]+value="4"/);
  assert.match(markup, /id="noteLift"[^>]+aria-describedby="noteLiftHelp"/);
  assert.match(markup, /id="noteLiftHelp"[\s\S]*?octave-lifted note source/);
  assert.match(markup, /for="audioMix"[\s\S]*?<b>Audio mix<\/b>/);
  assert.match(markup, /id="audioMixOut"[^>]*>Balanced<\/output>/);
  assert.match(markup, /id="audioMix"[^>]+min="0"[^>]+max="1"[^>]+value="0\.5"/);
  assert.match(app, /\$\("audioMixOut"\)\.textContent/);
  assert.match(app, /% rhythmic sound,.*% sustained Shepard sound/);
  assert.match(markup, /data-section="notes"[\s\S]*?>\s*<summary[\s\S]*?Note settings/);
  assert.match(markup, /id="chunkDuty"[^>]+aria-describedby="notesSectionNote"/);
  assert.match(markup, /id="brightness"[^>]+aria-describedby="notesSectionNote"/);
  assert.match(markup, /for="nestedSilence"[\s\S]*?<b>Nested silence<\/b>[\s\S]*?id="nestedSilenceOut"[^>]*>80%<\/output>[\s\S]*?id="nestedSilence"[^>]+min="0"[^>]+max="1"[^>]+value="0\.8"/);
  assert.match(markup, /for="fusionPoint"[\s\S]*?<b>Pitch threshold<\/b>/);
  assert.match(markup, /for="fusionWidth"[\s\S]*?<b>Interruption reach<\/b>/);
  assert.match(markup, /id="fusionWidth"[^>]+min="0.25"[^>]+max="6"/);
  assert.match(markup, /id="fusionWidthOut"[^>]*>2\.00 oct above<\/output>/);
  assert.match(markup, /id="fusionWidth"[^>]+value="2"/);
  assert.match(
    markup,
    /for="fusionEmphasis"[\s\S]*?id="fusionEmphasisOut"[\s\S]*?id="fusionEmphasis"[^>]+min="0"[^>]+max="1"[^>]+value="0"/,
  );
  assert.match(app, /\$\("fusionEmphasisOut"\)\.textContent/);
  assert.match(app, /\$\("fusionEmphasis"\)\.setAttribute\([\s\S]*?"aria-valuetext"/);
  assert.match(app, /\$\("nestedSilenceOut"\)\.textContent/);
  assert.match(app, /\$\("nestedSilence"\)\.setAttribute\([\s\S]*?"aria-valuetext"/);
  assert.match(app, /\$\("bankWidthDown"\)\.addEventListener\("click"/);
  assert.match(app, /\$\("bankWidthUp"\)\.addEventListener\("click"/);
  assert.match(markup, /Purple octave rings[\s\S]*?continuous blue pitch/);
  assert.match(markup, /data-reset-all[^>]+data-reset-in-place/);
  assert.match(
    app,
    /document\.querySelector\("\[data-reset-all\]"\)\.addEventListener\("click"/,
  );
  assert.match(app, /calculateOuroborouselLayers/);
  assert.match(app, /from "\.\/src\/ourorourobouroboros\.js"/);
  assert.doesNotMatch(app, /from "\.\/src\/ouroborousel\.js"/);
  assert.match(app, /const BLUE = \[86, 166, 255\]/);
  assert.match(app, /const ICE = \[238, 247, 255\]/);
  assert.match(app, /const VIOLET = \[139, 92, 246\]/);
  assert.doesNotMatch(app, /\b(?:RED|PINK|CREAM)\b/);
  assert.doesNotMatch(app, /DRUM_OVERLAP_POINT|DRUM_OVERLAP_WIDTH/);
  assert.match(app, /function layerFusionAmount\(layer, materialMode = "combo"\)/);
  assert.match(app, /const drum = clamp\(layer\?\.drumToneGain/);
  assert.match(app, /new OuroborouselAudio/);
  assert.match(app, /const struck = audio\.strike\(velocity\);/);
  assert.doesNotMatch(app, /audio\.strike\(velocity, normalized\)/);
  assert.match(app, /const edgePadding = clamp\(minimum \* 0\.12, 42, 54, 48\)/);
  assert.match(app, /function drawCoiledCandySnake\(ctx, layout\)/);
  assert.match(app, /const coilTurns = 3\.15/);
  assert.match(app, /ctx\.setLineDash\(\[stripeLength, stripeLength\]\)/);
  assert.doesNotMatch(app, /drawCandyCenter|createRadialGradient/);
  assert.match(app, /requestedScaleCount \+ requestedScaleCount % 2/);
  assert.doesNotMatch(app, /drawLayerLabels|fillText\(|ctx\.ellipse\(/);
  assert.match(app, /function layerMaterialWeight\(layer, materialMode = "combo"\)/);
  assert.match(app, /Number\(layer\?\.drumWeight\)/);
  assert.match(app, /\$\(id\)\.disabled = drumsOnly/);
  const drumDisabledControls = app.match(
    /for \(const id of \[[\s\S]*?\]\) \{\s*\$\(id\)\.disabled = drumsOnly;/,
  )?.[0] ?? "";
  assert.match(drumDisabledControls, /"chunkDuty"[\s\S]*?"brightness"/);
  assert.doesNotMatch(drumDisabledControls, /"noteLift"/);
  assert.doesNotMatch(
    drumDisabledControls,
    /fusionPoint|fusionWidth|fusionEmphasis/,
  );
  assert.match(app, /materialMode === "drums"[\s\S]*?return drumWeight/);
  assert.match(app, /materialMode === "combo"[\s\S]*?Math\.max\(noteWeight, drumWeight\)/);
  assert.match(markup, /role="group" aria-label="Nested rhythm-to-pitch path"/);
  assert.match(markup, /Note lift \/ nested distance/);
  assert.match(markup, /4 oct · 1\.13 pulses\/s at 18 Hz/);
  assert.match(app, /octave note lift and nested distance;.*interruptions below the.*pitch threshold/);
  assert.match(app, /Grabbed all.*lanes.*through/);
  assert.match(app, /visual\.fusion \* visual\.rhythm/);
  assert.match(markup, /high tones are interrupted into slower rhythms/i);
  assert.match(app, /interruption|nested silence/i);
  const source = await readFile(
    new URL("src/ourorourobouroboros.js", ROOT),
    "utf8",
  );
  assert.match(source, /highpass\.frequency\.value = 12/);
  assert.match(source, /new URL\("\.\/ourorourobouroboros\.js", import\.meta\.url\)/);
  assert.doesNotMatch(source, /new URL\("\.\/ouroborousel\.js", import\.meta\.url\)/);
  for (const id of ["fusionPoint", "fusionWidth", "fusionEmphasis"]) {
    assert.doesNotMatch(
      markup,
      new RegExp(`for="${id}"[^>]*data-note-material-control`),
      `${id} must stay available for drum fusion`,
    );
  }
  assert.match(app, /const RAIL_END_POSITION = 1 - Number\.EPSILON/);
  assert.match(
    app,
    /event\.key === "Home" \? 0 : RAIL_END_POSITION/,
  );
  assert.match(
    app,
    /\(note - 24\) \/ 84,[\s\S]*?RAIL_END_POSITION/,
  );
  assert.doesNotMatch(
    styles,
    /ouroborousel-stage-meta|ouroborousel-axis-labels|ouroborousel-loop-core|ouroborousel-rule|ouroborousel-explainer/,
  );
  assert.doesNotMatch(styles, /\.ouroborousel-stage-wrap::before/);
  assert.match(styles, /\.ouroborousel-page\s*\{[^}]*background:\s*#05050d/s);
  assert.match(styles, /\.ouroborousel-shell\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(styles, /width:\s*min\(1720px,\s*100%\)/);
  assert.match(
    styles,
    /@media \(min-width: 961px\)[\s\S]*?\.ouroborousel-performance\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0[^}]*padding-block:\s*clamp\(18px,\s*2\.5vh,\s*38px\)[^}]*flex-direction:\s*column[^}]*\}[\s\S]*?\.ouroborousel-stage-wrap\s*\{[^}]*height:\s*auto[^}]*flex:\s*1 1 auto/s,
  );
  assert.doesNotMatch(
    styles,
    /\.ouroborousel-stage-wrap\s*\{[^}]*(?:border|background|box-shadow)\s*:/s,
  );
  assert.match(styles, /--carousel-blue: #56a6ff/);
  assert.match(styles, /--carousel-violet: #8b5cf6/);
  assert.doesNotMatch(styles, /#e94057|#ff7fa8|--carousel-red|--carousel-pink/);
  assert.match(
    styles,
    /\.ouroborousel-segmented\.ouroborousel-material-mode span \{[^}]*min-height: 46px/s,
  );
  assert.match(
    styles,
    /\.ouroborousel-page \.control-section\[data-section="play"\],[\s\S]*?\.control-section\[data-section="sound"\][^{]*\{[^}]*--accent: var\(--carousel-violet\)/,
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
    "nestedSilence",
    "audioMix",
    "fusionPoint",
    "fusionWidth",
    "fusionEmphasis",
    "spread",
    "brightness",
    "cutoff",
  ]) {
    if (id !== "bankWidth") {
      assert.match(markup, new RegExp(`<label[^>]+for="${id}"`), id);
    }
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
  const extendedWidth = 4;
  assert.ok(ouroborouselFusionBlend(point / 4, point, extendedWidth) < 1e-12);
  assert.ok(
    Math.abs(ouroborouselFusionBlend(point, point, extendedWidth) - 0.5) < 1e-12,
  );
  assert.ok(1 - ouroborouselFusionBlend(point * 2, point, extendedWidth) > 0.14);
  assert.ok(1 - ouroborouselFusionBlend(point * 4, point, extendedWidth) < 1e-12);
  const maximumWidth = 6;
  assert.ok(ouroborouselFusionBlend(point / 8, point, maximumWidth) < 1e-12);
  assert.ok(
    Math.abs(ouroborouselFusionBlend(point, point, maximumWidth) - 0.5) < 1e-12,
  );
  assert.ok(1 - ouroborouselFusionBlend(point * 4, point, maximumWidth) > 0.04);
  assert.ok(1 - ouroborouselFusionBlend(point * 8, point, maximumWidth) < 1e-12);
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

test("nested silence continuously turns a future pitch lane into a lower rhythm", () => {
  const duty = 0.72;
  for (let step = 0; step <= 128; step += 1) {
    const phase = step / 128;
    assert.equal(
      ouroborouselNestedSilenceGate(phase, 0, duty),
      1,
      "zero depth must preserve the continuous future pitch",
    );
    const fullGate = ouroborouselNestedSilenceGate(phase, 1, duty);
    assert.ok(fullGate >= 0 && fullGate <= 1);
    assert.ok(Math.abs(
      fullGate - ouroborouselChunkEnvelope(phase, duty)
    ) < 1e-12, `full-depth gate drifted at phase ${phase}`);
    for (const nestedMix of [0.2, 0.5, 0.8]) {
      const gate = ouroborouselNestedSilenceGate(phase, nestedMix, duty);
      assert.ok(gate >= fullGate && gate <= 1);
    }
  }
});

test("audio mix continuously balances rhythmic and sustained Shepard buses", () => {
  const rhythm = ouroborouselAudioMix(0);
  const balanced = ouroborouselAudioMix(0.5);
  const shepard = ouroborouselAudioMix(1);

  assert.ok(Object.isFrozen(rhythm));
  assert.ok(Math.abs(rhythm.rhythmGain - Math.SQRT2) < 1e-12);
  assert.ok(Math.abs(rhythm.sustainGain) < 1e-12);
  assert.ok(Math.abs(balanced.rhythmGain - 1) < 1e-12);
  assert.ok(Math.abs(balanced.sustainGain - 1) < 1e-12);
  assert.ok(Math.abs(shepard.rhythmGain) < 1e-12);
  assert.ok(Math.abs(shepard.sustainGain - Math.SQRT2) < 1e-12);

  let previousRhythm = Number.POSITIVE_INFINITY;
  let previousSustain = -1;
  for (let step = 0; step <= 100; step += 1) {
    const gains = ouroborouselAudioMix(step / 100);
    assert.ok(gains.rhythmGain <= previousRhythm + 1e-12);
    assert.ok(gains.sustainGain >= previousSustain - 1e-12);
    assert.ok(Math.abs(
      gains.rhythmGain ** 2 + gains.sustainGain ** 2 - 2,
    ) < 1e-12);
    previousRhythm = gains.rhythmGain;
    previousSustain = gains.sustainGain;
  }
});

test("one rate continuum overlaps direct pitch with an independently extendable rhythm tail", () => {
  const point = 18;
  assert.equal(ouroborouselPitchBlend(point / 2, point), 0);
  assert.ok(Math.abs(ouroborouselPitchBlend(point, point) - 0.5) < 1e-12);
  assert.equal(ouroborouselPitchBlend(point * 2, point), 1);
  assert.ok(Math.abs(
    ouroborouselDrumFusionToneBlend(point, point) - 0.5,
  ) < 1e-12);

  assert.equal(ouroborouselRhythmShare(point, point, 1), 1);
  assert.ok(Math.abs(
    ouroborouselRhythmShare(point * Math.SQRT2, point, 1) - 0.5,
  ) < 1e-12);
  assert.equal(ouroborouselRhythmShare(point * 2, point, 1), 0);
  assert.equal(ouroborouselRhythmShare(point * 64, point, 6), 0);
  assert.ok(
    ouroborouselRhythmShare(point * 4, point, 6) > 0.74,
    "a wide tail must retain rhythmic articulation several pitch octaves above fusion",
  );
  assert.equal(
    ouroborouselPitchBlend(point * 4, point),
    1,
    "rhythm-tail width must not postpone pitch onset",
  );

  assert.equal(ouroborouselPitchLift(0), 1);
  assert.ok(Math.abs(ouroborouselPitchLift(0.5) - 1.175) < 1e-12);
  assert.ok(Math.abs(ouroborouselPitchLift(1) - 1.35) < 1e-12);
  assert.equal(ouroborouselContinuumGate(0.9, 1, 0.72), 0);
  assert.equal(ouroborouselContinuumGate(0.36, 1, 0.72), 1);
  assert.equal(ouroborouselContinuumGate(0.9, 0, 0.72), 1);
  assert.equal(ouroborouselDrumFusionGate(0.9, 0), 0);
  assert.equal(ouroborouselDrumFusionGate(0.9, 1), 1);

  assert.equal(ouroborouselDrumFusionHarmonic(4), 28);
  for (const centerRate of [0.5, 4, 12, 24]) {
    for (const modalRatio of [1, 1.56, 2.29, 3.91]) {
      const harmonic = ouroborouselDrumFusionHarmonic(centerRate, modalRatio);
      assert.ok(Number.isInteger(harmonic) && harmonic > 0);
      assert.ok(Math.abs(Math.sin(Math.PI * 2 * harmonic)) < 1e-11);
    }
  }

  const position = Math.log2(point / 4) % 1;
  const frame = calculateOuroborouselLayers({
    ...OUROBOROUSEL_DEFAULTS,
    position,
  });
  const crossing = frame.layers.find((layer) => (
    Math.abs(layer.hitRate - point) < 1e-10
  ));
  assert.ok(crossing);
  assert.equal(crossing.pitchHz, crossing.hitRate);
  assert.equal(crossing.drumFusionHz, crossing.hitRate);
  assert.equal(crossing.rhythmShare, 1);
  assert.ok(Math.abs(crossing.pitchBlend - 0.5) < 1e-12);
  assert.ok(Math.abs(crossing.pitchPulseShare - 0.5) < 1e-12);
  assert.ok(Math.abs(
    crossing.drumFusionGate
      - ouroborouselContinuumGate(
        crossing.pulsePhase,
        1 - crossing.pitchBlend,
        0.72,
      )
  ) < 1e-12);
  assert.equal(crossing.noteRhythmBankGain, 0);
  assert.ok(crossing.noteToneBankGain > 0);
  assert.ok(crossing.nestedRhythmActive);
  assert.ok(crossing.nestedMix > 0);
  assert.ok(Math.abs(
    crossing.nestedGate - ouroborouselNestedSilenceGate(
      crossing.interruptionPhase,
      crossing.nestedMix,
      0.72,
    )
  ) < 1e-12);
  assert.ok(crossing.drumHitBankGain > 0);
  assert.ok(crossing.drumToneBankGain > 0);
  assert.ok(crossing.drumHitGain + crossing.drumToneGain > 1);
});

test("the default Shepard bank keeps slow drums, fusion, and nested high pitch together", () => {
  for (let phaseIndex = 0; phaseIndex < 256; phaseIndex += 1) {
    const frame = calculateOuroborouselLayers({
      ...OUROBOROUSEL_DEFAULTS,
      position: phaseIndex / 256,
    });
    const active = frame.layers.filter(({ active: layerActive }) => layerActive);
    const rhythmAmounts = active.map((layer) => Math.hypot(
      layer.noteRhythmBankGain * frame.noteMaterialGain,
      layer.drumHitBankGain * frame.drumMaterialGain,
    ));
    const pitchAmounts = active.map((layer) => Math.hypot(
      layer.noteToneBankGain * frame.noteMaterialGain,
      layer.drumToneBankGain * frame.drumMaterialGain,
    ));
    const high = active.filter((layer, index) => (
      layer.pitchBlend > 0.15 && pitchAmounts[index] > 0.005
    ));
    assert.ok(Math.max(...rhythmAmounts) > 0.22, `weak rhythm at ${phaseIndex}`);
    assert.ok(Math.max(...pitchAmounts) > 0.48, `weak pitch at ${phaseIndex}`);
    assert.ok(high.length >= 2, `short pitch bank at ${phaseIndex}`);
    assert.ok(
      Math.log2(high.at(-1).hitRate / high[0].hitRate) >= 1,
      `pitch span collapsed at ${phaseIndex}`,
    );
    assert.ok(active.some((layer, index) => (
      layer.rhythmShare > 0.15
      && layer.pitchBlend > 0.15
      && Math.min(rhythmAmounts[index], pitchAmounts[index]) > 0.025
    )), `no audible overlap lane at ${phaseIndex}`);
    const nestedPairs = active.filter((layer) => (
      layer.noteToneBankGain > 0.01
      && layer.nestedRhythmActive
    ));
    assert.ok(
      nestedPairs.length >= 2,
      `future pitches stopped taking slower rhythm interruptions at ${phaseIndex}`,
    );
    for (const layer of nestedPairs) {
      const rhythm = frame.layers[layer.nestedRhythmIndex];
      assert.equal(layer.interruptionRate, rhythm.hitRate);
      assert.equal(layer.nestedRhythmHz, rhythm.hitRate);
      assert.ok(circularDistance(
        layer.interruptionPhase,
        rhythm.pulsePhase,
      ) < 1e-10);
    }

    let previousPitchFraction = -1;
    for (let index = 0; index < active.length; index += 1) {
      const total = rhythmAmounts[index] + pitchAmounts[index];
      if (total < 1e-9) continue;
      const pitchFraction = pitchAmounts[index] / total;
      assert.ok(
        pitchFraction + 1e-10 >= previousPitchFraction,
        `pitch fraction reversed at ${phaseIndex}/${index}`,
      );
      previousPitchFraction = pitchFraction;
    }
  }
});

test("fusion focus keeps legacy gain shaping bounded and spotlights the live crossing", () => {
  for (let step = 0; step <= 100; step += 1) {
    const blend = step / 100;
    assert.equal(
      ouroborouselFusionToneGain(blend, 0),
      blend,
      "zero emphasis must preserve the existing bridge exactly",
    );
  }

  assert.equal(ouroborouselFusionToneGain(0, 1), 0);
  assert.equal(ouroborouselFusionToneGain(1, 1), 1);
  assert.ok(Math.abs(ouroborouselFusionToneGain(0.5, 1) - 0.125) < 1e-12);
  assert.equal(ouroborouselFusionSpotlight(0, 1), 1);
  assert.equal(ouroborouselFusionSpotlight(1, 1), 1);
  assert.equal(ouroborouselFusionSpotlight(0.5, 0), 1);
  assert.ok(Math.abs(ouroborouselFusionSpotlight(0.5, 1) - 1.75) < 1e-12);

  let previousToneGain = -1;
  for (let step = 0; step <= 100; step += 1) {
    const blend = step / 100;
    const toneGain = ouroborouselFusionToneGain(blend, 1);
    const chunkGain = 1 - toneGain;
    assert.ok(toneGain >= previousToneGain, "emphasized fusion must stay monotonic");
    assert.ok(toneGain >= 0 && toneGain <= 1);
    assert.ok(Math.abs(toneGain + chunkGain - 1) < 1e-12);
    previousToneGain = toneGain;
  }

  const blendAtTwenty = ouroborouselFusionBlend(20, 18, 1);
  const originalRhythmDepth = 1 - blendAtTwenty;
  const emphasizedRhythmDepth = 1 - ouroborouselFusionToneGain(blendAtTwenty, 1);
  assert.ok(originalRhythmDepth > 0.26 && originalRhythmDepth < 0.28);
  assert.ok(emphasizedRhythmDepth > 0.69 && emphasizedRhythmDepth < 0.72);
  assert.ok(1 - emphasizedRhythmDepth > 0.28, "the crossing must retain a pitch floor");

  const common = { position: 0.25, centerRate: 4, bankWidth: 6 };
  const ordinary = calculateOuroborouselLayers({
    ...common,
    fusionEmphasis: 0,
  });
  const emphasized = calculateOuroborouselLayers({
    ...common,
    fusionEmphasis: 1,
  });
  const crossingIndex = ordinary.layers.reduce((best, layer, index) => (
    Math.abs(layer.hitRate - 20) < Math.abs(ordinary.layers[best].hitRate - 20)
      ? index
      : best
  ), 0);
  assert.ok(emphasized.layers[crossingIndex].gain > ordinary.layers[crossingIndex].gain);
  assert.ok(Math.abs(
    emphasized.layers.reduce((sum, layer) => sum + layer.gain ** 2, 0) - 1,
  ) < 1e-12, "the spotlight must preserve normalized note-bank power");
  assert.ok(
    emphasized.layers[crossingIndex].drumToneWeight
      > ordinary.layers[crossingIndex].drumToneWeight,
    "shared emphasis must spotlight the drum-to-pitch crossing too",
  );
  for (const frame of [ordinary, emphasized]) {
    assert.ok(Math.abs(
      frame.drumNormalization ** 2 * frame.drumWeightPower - 1,
    ) < 1e-12, "drum fusion must preserve normalized bank power");
  }
  for (let index = 0; index < ordinary.layers.length; index += 1) {
    if (ordinary.layers[index].drumToneGain > 0) continue;
    assert.equal(
      emphasized.layers[index].drumHitWeight,
      ordinary.layers[index].drumHitWeight,
      "emphasis must leave pre-fusion drum hits unchanged",
    );
  }
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

test("tempo lanes and their nested interruptions remain exact octave relatives", () => {
  const frame = calculateOuroborouselLayers({
    position: 0.37,
    centerRate: 4,
    bankWidth: 8,
    noteLift: 4,
    nestedSilence: 0.8,
    fusionPoint: 18,
    fusionWidth: 1.2,
    fusionEmphasis: 0.7,
    spread: 0.7,
  });

  assert.equal(frame.layers.length, 21);
  assert.equal(frame.cyclesPerChunk, 16);
  assert.ok(frame.activeLayers >= 5);
  assert.equal(frame.audibleLayers, frame.activeLayers);
  assert.ok(Math.abs(frame.normalization ** 2 * frame.weightPower - 1) < 1e-12);
  for (let index = 0; index < frame.layers.length; index += 1) {
    const layer = frame.layers[index];
    assert.ok(Number.isFinite(layer.hitRate));
    assert.ok(Number.isFinite(layer.sourceHz));
    assert.ok(relativeError(layer.sourceHz / layer.hitRate, 16) < 1e-12);
    assert.ok(circularDistance(
      layer.carrierPhase,
      (layer.pulsePhase * layer.cyclesPerChunk) % 1,
    ) < 1e-12);
    assert.ok(layer.chunkGain >= 0 && layer.toneGain >= 0);
    assert.equal(layer.pitchHz, layer.hitRate);
    assert.ok(Math.abs(
      layer.toneGain
        - ouroborouselPitchBlend(layer.hitRate, 18),
    ) < 1e-12);
    assert.ok(Math.abs(
      layer.chunkGain
        - layer.nestedMix,
    ) < 1e-12);
    assert.ok(Math.abs(
      layer.nestedGate
        - ouroborouselNestedSilenceGate(
          layer.interruptionPhase,
          layer.nestedMix,
          0.72,
        ),
    ) < 1e-12);
    assert.ok(Math.abs(
      layer.weight
        - Math.hypot(layer.noteRhythmWeight, layer.noteToneWeight),
    ) < 1e-12);
    const sourceIndex = index + Math.log2(frame.cyclesPerChunk);
    if (sourceIndex < frame.layers.length) {
      const sourceLayer = frame.layers[sourceIndex];
      assert.ok(relativeError(layer.sourceHz, sourceLayer.hitRate) < 1e-12);
      assert.ok(circularDistance(
        layer.carrierPhase,
        sourceLayer.pulsePhase,
      ) < 1e-10);
      assert.equal(layer.recursiveSourceIndex, sourceIndex);
      assert.equal(layer.recursiveSourceHz, sourceLayer.pitchHz);
      assert.ok(circularDistance(
        layer.recursiveSourcePhase,
        sourceLayer.pulsePhase,
      ) < 1e-10);
    }
    if (layer.nestedRhythmIndex !== null) {
      const rhythmLayer = frame.layers[layer.nestedRhythmIndex];
      assert.ok(relativeError(layer.interruptionRate, rhythmLayer.hitRate) < 1e-12);
      assert.ok(circularDistance(
        layer.interruptionPhase,
        rhythmLayer.pulsePhase,
      ) < 1e-10);
    }
    if (index > 0) {
      assert.ok(relativeError(layer.hitRate / frame.layers[index - 1].hitRate, 2) < 1e-12);
      assert.ok(relativeError(layer.sourceHz / frame.layers[index - 1].sourceHz, 2) < 1e-12);
      assert.ok(relativeError(layer.pitchHz / frame.layers[index - 1].pitchHz, 2) < 1e-12);
    }
  }
  assert.ok(Object.isFrozen(frame));
  assert.ok(Object.isFrozen(frame.layers));
  assert.ok(frame.layers.every(Object.isFrozen));
});

test("material modes color the same rhythm-to-pitch continuum", () => {
  const notes = calculateOuroborouselLayers({
    materialMode: "notes",
    position: 0.37,
    centerRate: 8,
    bankWidth: 16,
  });
  const drums = calculateOuroborouselLayers({
    materialMode: "drums",
    position: 0.37,
    centerRate: 8,
    bankWidth: 16,
  });
  const combo = calculateOuroborouselLayers({
    materialMode: "combo",
    position: 0.37,
    centerRate: 8,
    bankWidth: 16,
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
    assert.ok(Number.isFinite(layer.drumWeight) && layer.drumWeight >= 0);
    assert.ok(layer.drumGain >= 0 && layer.drumGain <= 1);
    assert.equal(layer.pitchHz, layer.hitRate);
    assert.equal(layer.drumFusionHz, layer.hitRate);
    assert.equal(layer.pitchBlend, notes.layers[index].pitchBlend);
    assert.equal(layer.rhythmShare, drums.layers[index].rhythmShare);
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
    fusionEmphasis: 0.62,
    spread: 0.6,
  };
  const before = calculateOuroborouselLayers({ ...common, position: 1 - epsilon });
  const after = calculateOuroborouselLayers({ ...common, position: epsilon });
  let compared = 0;
  for (let index = 0; index < before.layers.length - 1; index += 1) {
    const oldLayer = before.layers[index];
    const newLayer = after.layers[index + 1];
    if (Math.max(oldLayer.gain, newLayer.gain) < 1e-6) continue;
    compared += 1;
    assert.ok(relativeError(newLayer.hitRate, oldLayer.hitRate) < 3e-8);
    assert.ok(relativeError(newLayer.sourceHz, oldLayer.sourceHz) < 3e-8);
    assert.ok(Math.abs(newLayer.weight - oldLayer.weight) < 3e-8);
    assert.ok(Math.abs(newLayer.gain - oldLayer.gain) < 4e-8);
    assert.ok(Math.abs(newLayer.fusionBlend - oldLayer.fusionBlend) < 3e-8);
    assert.ok(Math.abs(newLayer.toneGain - oldLayer.toneGain) < 3e-8);
    assert.ok(Math.abs(newLayer.chunkGain - oldLayer.chunkGain) < 3e-8);
    assert.ok(circularDistance(newLayer.pulsePhase, oldLayer.pulsePhase) < 3e-8);
    assert.ok(circularDistance(newLayer.carrierPhase, oldLayer.carrierPhase) < 1e-6);
  }
  assert.ok(compared >= 6);

  const reverseBefore = calculateOuroborouselLayers({ ...common, position: epsilon });
  const reverseAfter = calculateOuroborouselLayers({ ...common, position: 1 - epsilon });
  for (let index = 0; index < reverseAfter.layers.length - 1; index += 1) {
    const oldLayer = reverseBefore.layers[index + 1];
    const newLayer = reverseAfter.layers[index];
    if (Math.max(oldLayer.gain, newLayer.gain) < 1e-6) continue;
    assert.ok(relativeError(newLayer.hitRate, oldLayer.hitRate) < 3e-8);
    assert.ok(relativeError(newLayer.sourceHz, oldLayer.sourceHz) < 3e-8);
    assert.ok(Math.abs(newLayer.weight - oldLayer.weight) < 3e-8);
    assert.ok(Math.abs(newLayer.toneGain - oldLayer.toneGain) < 3e-8);
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
  const source = await readFile(new URL("src/ourorourobouroboros.js", ROOT), "utf8");
  const start = source.indexOf("    process(_inputs, outputs) {");
  const end = source.indexOf("\n      return true;\n    }\n  };", start);
  assert.ok(start >= 0 && end > start);
  const processBody = source.slice(start, end);
  assert.doesNotMatch(processBody, /\bnew\s+/);
  assert.doesNotMatch(processBody, /Array\.from|\.(?:map|filter|reduce)\(/);
  assert.doesNotMatch(processBody, /Math\.tanh/);
  assert.match(source, /pulsePhases = new Float64Array\(LAYER_COUNT\)/);
  assert.match(source, /noteLifts = new Uint8Array\(LAYER_COUNT\)/);
  assert.match(source, /notePitchSamples = new Float64Array\(SOURCE_LAYER_COUNT\)/);
  assert.match(source, /drumPitchSamples = new Float64Array\(SOURCE_LAYER_COUNT\)/);
  assert.match(source, /drumSlowEnvelopes = new Float64Array\(LAYER_COUNT\)/);
  assert.match(source, /drumNoiseSeeds = new Uint32Array\(LAYER_COUNT\)/);
  assert.match(source, /drumModalRe = new Float64Array\(LAYER_COUNT \* MODE_COUNT\)/);
  assert.match(source, /drumModalIm = new Float64Array\(LAYER_COUNT \* MODE_COUNT\)/);
  assert.match(
    source,
    /drumFusionHarmonics = new Uint16Array\(LAYER_COUNT \* MODE_COUNT\)/,
  );
  assert.match(
    source,
    /drumFusionHarmonicTargets = new Uint16Array\([\s\S]*?LAYER_COUNT \* MODE_COUNT/,
  );
  assert.match(source, /fastSineCycle\([\s\S]*?pulsePhase \* harmonic/);
  assert.match(source, /this\.notePitchSamples\[[\s\S]*?recursiveSourceIndex/);
  assert.match(source, /this\.drumPitchSamples\[[\s\S]*?recursiveSourceIndex/);
  assert.match(
    source,
    /const automaticDrumPitch = this\.drumPitchSamples\[index\][\s\S]*?\* drumToneWeight;/,
  );
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
    await import(`../src/ourorourobouroboros.js?worklet-test=${Date.now()}`);
    assert.equal(registeredName, "morphazoid-ourorourobouroboros");
    assert.equal(registrationCount, 1);
    assert.equal(typeof Processor, "function");

    const articulatedNotes = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        materialMode: "notes",
      },
    });
    const layeredControl = new Processor({
      processorOptions: OUROBOROUSEL_DEFAULTS,
    });
    const drumsControl = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        materialMode: "drums",
      },
    });
    for (const candidate of [
      articulatedNotes,
      layeredControl,
      drumsControl,
    ]) {
      candidate.process([], [[new Float32Array(1), new Float32Array(1)]]);
    }
    assert.ok(
      articulatedNotes.renderNoteRhythmWeights.some((weight) => weight > 1e-6),
      "the worklet did not route automatic pitched chunks in Notes",
    );
    assert.ok(
      layeredControl.renderNoteRhythmWeights.every((weight) => weight === 0),
      "Layered unexpectedly inherited the Notes-only attack rail",
    );
    assert.ok(
      drumsControl.renderNoteRhythmWeights.every((weight) => weight === 0),
      "Drums unexpectedly inherited the Notes-only attack rail",
    );
    assert.deepEqual(
      Array.from(articulatedNotes.renderNoteToneWeights),
      Array.from(layeredControl.renderNoteToneWeights),
      "Notes changed the established sustained rail in the worklet",
    );
    articulatedNotes.current.glissRate = 0;
    articulatedNotes.target.glissRate = 0;
    articulatedNotes.port.onmessage({ data: { type: "audible", value: true } });
    articulatedNotes.port.onmessage({ data: { type: "transport", value: true } });
    const articulatedCapture = [];
    for (let block = 0; block < 1_200; block += 1) {
      const noteLeft = new Float32Array(128);
      articulatedNotes.process([], [[noteLeft, new Float32Array(128)]]);
      if (block >= 500) articulatedCapture.push(...noteLeft);
    }
    assert.ok(
      spectralMagnitude(articulatedCapture, 128) > 4e-4,
      "default Notes did not audibly expose its octave-lifted 128 Hz note rail",
    );

    const processor = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        glissRate: 1.2,
        centerRate: 12,
        bankWidth: 8,
        noteLift: 3,
        fusionPoint: 18,
        fusionWidth: 0.75,
        fusionEmphasis: 1,
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
    assert.equal(processor.currentMaterialMix, 0.5);
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

    const defaultSpectrum = new Processor({
      processorOptions: OUROBOROUSEL_DEFAULTS,
    });
    defaultSpectrum.current.glissRate = 0;
    defaultSpectrum.target.glissRate = 0;
    defaultSpectrum.port.onmessage({
      data: { type: "audible", value: true },
    });
    defaultSpectrum.port.onmessage({
      data: { type: "transport", value: true },
    });
    const defaultCapture = [];
    for (let block = 0; block < 1_200; block += 1) {
      const spectrumLeft = new Float32Array(128);
      defaultSpectrum.process([], [[spectrumLeft, new Float32Array(128)]]);
      if (block >= 500) defaultCapture.push(...spectrumLeft);
    }
    for (const frequency of [16, 32]) {
      assert.ok(
        spectralMagnitude(defaultCapture, frequency) > 0.005,
        `default spectrum lost its ${frequency} Hz direct-rate pitch`,
      );
    }
    const futurePitch = spectralMagnitude(defaultCapture, 32);
    for (const sideband of [30, 34]) {
      assert.ok(
        spectralMagnitude(defaultCapture, sideband) > futurePitch * 0.1,
        `the slow 2 Hz rhythm stopped cutting its future 32 Hz source (${sideband} Hz sideband)`,
      );
    }
    for (let index = 0; index < defaultSpectrum.pulsePhases.length; index += 1) {
      const lift = defaultSpectrum.renderNoteLifts[index];
      const sourceIndex = index + lift;
      const sourcePhaseError = circularDistance(
        defaultSpectrum.renderPulsePhases[sourceIndex],
        (defaultSpectrum.renderPulsePhases[index] * 2 ** lift) % 1,
      );
      assert.ok(
        sourcePhaseError < 1e-8,
        `future source phase drifted at lane ${index}: ${sourcePhaseError}`,
      );
    }

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

    const emphasisChange = new Processor({
      processorOptions: OUROBOROUSEL_DEFAULTS,
    });
    emphasisChange.port.onmessage({ data: { type: "audible", value: true } });
    emphasisChange.port.onmessage({ data: { type: "transport", value: true } });
    emphasisChange.port.onmessage({
      data: {
        type: "parameters",
        parameters: { fusionEmphasis: 0.9, nestedSilence: 0.25 },
      },
    });
    assert.equal(emphasisChange.target.fusionEmphasis, 0.9);
    assert.equal(emphasisChange.target.nestedSilence, 0.25);
    assert.equal(emphasisChange.current.fusionEmphasis, 0);
    assert.equal(emphasisChange.current.nestedSilence, 0.8);
    emphasisChange.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.ok(emphasisChange.current.fusionEmphasis > 0);
    assert.ok(emphasisChange.current.fusionEmphasis < 0.9);
    assert.ok(emphasisChange.current.nestedSilence < 0.8);
    assert.ok(emphasisChange.current.nestedSilence > 0.25);

    const slowDrumVariants = [
      new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode: "drums",
          centerRate: 0.5,
          bankWidth: 3,
          fusionWidth: 0.25,
          fusionEmphasis: 0,
        },
      }),
      new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode: "drums",
          centerRate: 0.5,
          bankWidth: 3,
          fusionWidth: 6,
          fusionEmphasis: 1,
        },
      }),
    ];
    for (const candidate of slowDrumVariants) {
      for (let index = 9; index <= 11; index += 1) {
        candidate.pulsePhases[index] = 0.99999;
      }
      candidate.port.onmessage({ data: { type: "audible", value: true } });
      candidate.port.onmessage({ data: { type: "transport", value: true } });
    }
    const slowDrumEnergy = [0, 0];
    const slowDrumPeakEnvelope = [0, 0];
    let slowDrumDifferenceEnergy = 0;
    let slowDrumSampleCount = 0;
    for (let block = 0; block < 180; block += 1) {
      const narrowLeft = new Float32Array(128);
      const narrowRight = new Float32Array(128);
      const extendedLeft = new Float32Array(128);
      const extendedRight = new Float32Array(128);
      slowDrumVariants[0].process([], [[narrowLeft, narrowRight]]);
      slowDrumVariants[1].process([], [[extendedLeft, extendedRight]]);
      for (let variant = 0; variant < slowDrumVariants.length; variant += 1) {
        slowDrumPeakEnvelope[variant] = Math.max(
          slowDrumPeakEnvelope[variant],
          ...slowDrumVariants[variant].drumSlowEnvelopes,
        );
      }
      for (let index = 0; index < narrowLeft.length; index += 1) {
        slowDrumEnergy[0] += narrowLeft[index] ** 2 + narrowRight[index] ** 2;
        slowDrumEnergy[1] += extendedLeft[index] ** 2 + extendedRight[index] ** 2;
        slowDrumDifferenceEnergy += (
          extendedLeft[index] - narrowLeft[index]
        ) ** 2 + (
          extendedRight[index] - narrowRight[index]
        ) ** 2;
        slowDrumSampleCount += 2;
      }
    }
    const slowDrumRms = slowDrumEnergy.map((energy) => (
      Math.sqrt(energy / slowDrumSampleCount)
    ));
    assert.ok(slowDrumRms.every((rms) => rms > 0.001));
    assert.ok(
      Math.min(...slowDrumRms) / Math.max(...slowDrumRms) >= 0.9,
      `nested rail overwhelmed an authentic low drum: ${slowDrumRms}`,
    );
    assert.ok(
      slowDrumPeakEnvelope.every((value) => value > 0.1),
      "low drum variants did not retain their struck modal/attack state",
    );
    assert.deepEqual(
      slowDrumVariants[1].drumSlowEnvelopes,
      slowDrumVariants[0].drumSlowEnvelopes,
    );
    assert.deepEqual(
      slowDrumVariants[1].drumFastEnvelopes,
      slowDrumVariants[0].drumFastEnvelopes,
    );
    assert.deepEqual(
      slowDrumVariants[1].drumModalRe,
      slowDrumVariants[0].drumModalRe,
    );
    assert.deepEqual(
      slowDrumVariants[1].drumModalIm,
      slowDrumVariants[0].drumModalIm,
    );
    assert.ok(
      slowDrumDifferenceEnergy > 1e-8,
      "interruption reach did not affect the nested background rail",
    );

    const extendedTailRate = 72;
    const crossingPosition = Math.log2(extendedTailRate / 4) % 1;
    const crossingDrumVariants = [
      new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode: "drums",
          centerRate: 4,
          bankWidth: 20,
          fusionPoint: 18,
          fusionWidth: 1,
          fusionEmphasis: 0,
        },
      }),
      new Processor({
        processorOptions: {
          ...OUROBOROUSEL_DEFAULTS,
          materialMode: "drums",
          centerRate: 4,
          bankWidth: 20,
          fusionPoint: 18,
          fusionWidth: 6,
          fusionEmphasis: 0,
        },
      }),
    ];
    for (const candidate of crossingDrumVariants) {
      candidate.port.onmessage({
        data: { type: "position", value: crossingPosition },
      });
      candidate.current.glissRate = 0;
      candidate.target.glissRate = 0;
      candidate.port.onmessage({ data: { type: "audible", value: true } });
      candidate.port.onmessage({ data: { type: "transport", value: true } });
    }
    let crossingDifferenceEnergy = 0;
    const emphasizedTail = [];
    for (let block = 0; block < 260; block += 1) {
      const ordinaryLeft = new Float32Array(128);
      const ordinaryRight = new Float32Array(128);
      const emphasizedLeft = new Float32Array(128);
      const emphasizedRight = new Float32Array(128);
      crossingDrumVariants[0].process([], [[ordinaryLeft, ordinaryRight]]);
      crossingDrumVariants[1].process([], [[emphasizedLeft, emphasizedRight]]);
      if (block >= 196) {
        emphasizedTail.push(...emphasizedLeft);
      }
      if (block < 30) continue;
      for (let index = 0; index < ordinaryLeft.length; index += 1) {
        crossingDifferenceEnergy += (
          emphasizedLeft[index] - ordinaryLeft[index]
        ) ** 2;
      }
    }
    assert.ok(
      crossingDifferenceEnergy > 1,
      "the rhythm-tail control did not carry drum articulation into high pitch",
    );
    const crossingLine = spectralMagnitude(emphasizedTail, extendedTailRate);
    const nearbyOffLine = spectralMagnitude(emphasizedTail, 100);
    assert.ok(crossingLine > 0.0025, "the 72 Hz repetition lacks its direct 72 Hz pitch");
    assert.ok(
      crossingLine > nearbyOffLine * 5,
      "the fused drum carrier is not spectrally stable",
    );

    const harmonicLatch = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        materialMode: "drums",
        centerRate: 4,
      },
    });
    const centerMode = 10 * 4;
    const neighboringMode = 9 * 4;
    const originalCenterHarmonic = harmonicLatch.drumFusionHarmonics[centerMode];
    const originalNeighborHarmonic = harmonicLatch.drumFusionHarmonics[
      neighboringMode
    ];
    harmonicLatch.current.centerRate = 5;
    harmonicLatch.pulsePhases[10] = 0.99999;
    harmonicLatch.pulsePhases[9] = 0.5;
    harmonicLatch.port.onmessage({ data: { type: "audible", value: true } });
    harmonicLatch.port.onmessage({ data: { type: "transport", value: true } });
    harmonicLatch.process([], [[new Float32Array(2), new Float32Array(2)]]);
    assert.notEqual(
      harmonicLatch.drumFusionHarmonics[centerMode],
      originalCenterHarmonic,
      "a wrapped drum lane did not latch its new integer harmonic",
    );
    assert.equal(
      harmonicLatch.drumFusionHarmonics[neighboringMode],
      originalNeighborHarmonic,
      "an unwrapped drum lane changed harmonic at an arbitrary phase",
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
    assert.equal(
      manualDrums[0],
      manualDrums[1],
      "pointer placement must not collapse a manual grab to one drum lane",
    );

    const manualBank = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        materialMode: "drums",
        centerRate: 2,
        bankWidth: 7,
      },
    });
    manualBank.port.onmessage({ data: { type: "audible", value: true } });
    manualBank.port.onmessage({
      data: { type: "strike", velocity: 0.82 },
    });
    manualBank.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.ok(
      manualBank.drumSlowEnvelopes.filter((value) => value > 1e-7).length >= 5,
      "an unpositioned manual strike should excite the complete active drum bank",
    );
    assert.equal(
      Number.isNaN(manualBank.manualPosition),
      true,
      "an all-bank strike should not retain a single-lane position",
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
      drumP95 / Math.max(1e-9, drumMedian) > 1.5,
      `drum mode lacks the authentic percussive attack (${drumP95 / Math.max(1e-9, drumMedian)})`,
    );
    assert.ok(
      drumP90 / Math.max(1e-9, drumP10) > 3,
      `drum mode behaves like a constant noise bed (${drumP90 / Math.max(1e-9, drumP10)})`,
    );

    for (const materialMode of OUROBOROUSEL_MATERIAL_MODES) {
      for (const audioMix of [0, 1]) {
        const mixed = new Processor({
          processorOptions: {
            ...OUROBOROUSEL_DEFAULTS,
            materialMode,
            audioMix,
            bankWidth: 6,
          },
        });
        mixed.port.onmessage({ data: { type: "audible", value: true } });
        mixed.port.onmessage({ data: { type: "transport", value: true } });
        let mixedSquareSum = 0;
        let mixedSampleCount = 0;
        let mixedPeak = 0;
        for (let block = 0; block < 360; block += 1) {
          const mixedLeft = new Float32Array(128);
          const mixedRight = new Float32Array(128);
          mixed.process([], [[mixedLeft, mixedRight]]);
          if (block >= 120) {
            for (const sample of mixedLeft) {
              mixedSquareSum += sample ** 2;
              mixedPeak = Math.max(mixedPeak, Math.abs(sample));
              mixedSampleCount += 1;
            }
          }
        }
        const mixedRms = Math.sqrt(mixedSquareSum / mixedSampleCount);
        assert.ok(
          mixedRms > 0.001,
          `${materialMode} audio mix endpoint ${audioMix} was silent: ${mixedRms}`,
        );
        assert.ok(
          mixedPeak < 0.85,
          `${materialMode} audio mix endpoint ${audioMix} escaped its ceiling: ${mixedPeak}`,
        );
      }
    }

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
    assert.equal(switching.currentMaterialMix, 0.5);
    const switchingLeft = new Float32Array(128);
    const switchingRight = new Float32Array(128);
    const controlLeft = new Float32Array(128);
    switching.process([], [[switchingLeft, switchingRight]]);
    switchingControl.process([], [[controlLeft, new Float32Array(128)]]);
    assert.ok(
      Math.abs(switchingLeft[0] - controlLeft[0]) < 0.002,
      "material switch jumped instead of starting its slew",
    );
    assert.ok(switching.currentMaterialMix > 0.5 && switching.currentMaterialMix < 1);
    for (let block = 0; block < 500; block += 1) {
      switching.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.ok(switching.currentMaterialMix > 0.999);

    switching.port.onmessage({
      data: { type: "parameters", parameters: { materialMode: "notes" } },
    });
    assert.equal(switching.targetMaterialMix, 0);
    let returnedNoteSquareSum = 0;
    let returnedNoteSamples = 0;
    let returnedNotePeak = 0;
    for (let block = 0; block < 700; block += 1) {
      const noteLeft = new Float32Array(128);
      const noteRight = new Float32Array(128);
      switching.process([], [[noteLeft, noteRight]]);
      if (block >= 500) {
        for (const sample of noteLeft) {
          returnedNoteSquareSum += sample ** 2;
          returnedNotePeak = Math.max(returnedNotePeak, Math.abs(sample));
          returnedNoteSamples += 1;
        }
      }
    }
    assert.ok(
      switching.currentMaterialMix < 1e-6,
      "Notes must finish fading back in after Drums",
    );
    const returnedNoteRms = Math.sqrt(
      returnedNoteSquareSum / returnedNoteSamples,
    );
    assert.ok(
      returnedNoteRms > 0.002,
      `Notes stayed silent after returning from Drums: ${returnedNoteRms}`,
    );
    assert.ok(returnedNotePeak < 0.8);

    const fallbackSwitch = new Processor({
      processorOptions: {
        ...OUROBOROUSEL_DEFAULTS,
        materialMode: "drums",
        centerRate: 2,
        bankWidth: 3,
        noteLift: 7,
      },
    });
    fallbackSwitch.port.onmessage({ data: { type: "audible", value: true } });
    fallbackSwitch.port.onmessage({ data: { type: "transport", value: true } });
    for (let block = 0; block < 180; block += 1) {
      fallbackSwitch.process([], [[
        new Float32Array(128),
        new Float32Array(128),
      ]]);
    }
    assert.equal(fallbackSwitch.currentMaterialMix, 1);
    fallbackSwitch.port.onmessage({
      data: { type: "parameters", parameters: { materialMode: "notes" } },
    });
    let fallbackSwitchStarted = -1;
    let fallbackSquareSum = 0;
    let fallbackSampleCount = 0;
    let fallbackMaximumStep = 0;
    let fallbackPreviousSample = 0;
    for (let block = 0; block < 700; block += 1) {
      const fallbackLeft = new Float32Array(128);
      const fallbackRight = new Float32Array(128);
      fallbackSwitch.process([], [[fallbackLeft, fallbackRight]]);
      if (
        fallbackSwitchStarted < 0
        && fallbackSwitch.currentMaterialMix < 0.999
      ) {
        fallbackSwitchStarted = block;
      }
      for (const sample of fallbackLeft) {
        fallbackMaximumStep = Math.max(
          fallbackMaximumStep,
          Math.abs(sample - fallbackPreviousSample),
        );
        fallbackPreviousSample = sample;
        if (block >= 300) {
          fallbackSquareSum += sample ** 2;
          fallbackSampleCount += 1;
        }
      }
    }
    assert.ok(fallbackSwitchStarted >= 0 && fallbackSwitchStarted < 2);
    assert.ok(fallbackSwitch.currentMaterialMix < 1e-6);
    const fallbackRms = Math.sqrt(
      fallbackSquareSum / fallbackSampleCount,
    );
    assert.ok(
      fallbackRms > 0.002,
      `low/narrow Notes fallback was silent after Drums: ${fallbackRms}`,
    );
    assert.ok(
      fallbackMaximumStep < 0.03,
      `low/narrow Notes fallback clicked by ${fallbackMaximumStep}`,
    );

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
    assert.ok(lowSwitchStarted >= 0 && lowSwitchStarted < 260);
    assert.ok(lowSwitchSettled > lowSwitchStarted);
    assert.ok(lowMaterialSwitch.currentMaterialMix < 1e-6);
    const transitionRms = Math.sqrt(
      transitionSquareSum / transitionSampleCount,
    );
    assert.ok(
      transitionRms > 0.001,
      `material switch crossed silence: ${transitionRms}`,
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
      assert.ok(
        lowRms > 0.001,
        `${centerRate} Hz note bank dropped out: ${lowRms}`,
      );
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
        rapidMaximumStep < 0.16,
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

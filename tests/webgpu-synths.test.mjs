import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS,
  WEBGPU_SYNTHS_DEFAULT_LANE_ROUTES,
  WEBGPU_SYNTHS_DEFAULTS,
  WEBGPU_SYNTHS_LANE_TARGETS,
  WEBGPU_SYNTHS_MAX_LANES,
  WEBGPU_SYNTHS_MAX_MODEL_LAYERS,
  WEBGPU_SYNTHS_MODELS,
  WEBGPU_SYNTHS_ORGAN_RANK_COUNT,
  WEBGPU_SYNTHS_PARAM_ORDER,
  WEBGPU_SYNTHS_SEQUENCE_LENGTH,
  WEBGPU_SYNTHS_SHADER,
  createWebGpuSynthSequence,
  sanitizeWebGpuSynthLaneRoutes,
  sanitizeWebGpuSynthModelLayers,
  sanitizeWebGpuSynthOrganRanks,
  sanitizeWebGpuSynthParams,
  sanitizeWebGpuSynthSequence,
  varyWebGpuSynthSequence,
  webGpuSynthModelLabel,
  webGpuSynthLaneRouteArray,
  webGpuSynthModelLayerArray,
  webGpuSynthOrganRankArray,
  webGpuSynthParamArray,
  webGpuSynthSequenceArray,
} from "../src/webgpu-synths.js";

const root = new URL("../", import.meta.url);

test("GPU Shader Synths packs one stable 42-float shader parameter contract", () => {
  assert.deepEqual(WEBGPU_SYNTHS_PARAM_ORDER, [
    "topology",
    "modelMix",
    "layerCount",
    "layerMode",
    "baseNote",
    "clock",
    "steps",
    "laneCount",
    "glide",
    "complexity",
    "color",
    "motion",
    "decay",
    "fold",
    "space",
    "chaos",
    "swing",
    "gain",
    "seed",
    "scale",
    "acidPartials",
    "fmOperators",
    "foldLayers",
    "modalModes",
    "grainCount",
    "organRanks",
    "wavetableHarmonics",
    "formantVoices",
    "filterCutoff",
    "filterTaps",
    "filterMix",
    "delayTime",
    "delayRepeats",
    "delayDecay",
    "delayMix",
    "shaperDrive",
    "shaperFold",
    "shaperMix",
    "reverbSize",
    "reverbDecay",
    "reverbTaps",
    "reverbMix",
  ]);
  assert.equal(webGpuSynthParamArray().length, 42);
  assert.deepEqual(sanitizeWebGpuSynthParams(), WEBGPU_SYNTHS_DEFAULTS);
  const clamped = sanitizeWebGpuSynthParams({ topology: 99, modelMix: 9, layerCount: 99, laneCount: 99, steps: 2, gain: 9, scale: -4, fmOperators: 99, filterTaps: 10, reverbTaps: 99 });
  assert.equal(clamped.topology, 7);
  assert.equal(clamped.modelMix, 1);
  assert.equal(clamped.layerCount, 6);
  assert.equal(clamped.laneCount, 8);
  assert.equal(clamped.steps, 4);
  assert.equal(clamped.gain, 0.22);
  assert.equal(clamped.scale, 0);
  assert.equal(clamped.fmOperators, 6);
  assert.equal(clamped.filterTaps, 11);
  assert.equal(clamped.reverbTaps, 64);
});

test("eight routed control lanes are deterministic, bounded, and GPU-buffer ready", () => {
  assert.equal(WEBGPU_SYNTHS_SEQUENCE_LENGTH, 64);
  assert.equal(WEBGPU_SYNTHS_MAX_LANES, 8);
  for (const technique of ["euclid", "brownian", "cellular", "recurrence", "orbit", "noise"]) {
    const first = createWebGpuSynthSequence(technique, { steps: 21, seed: 1447, variation: 0.62 });
    const second = createWebGpuSynthSequence(technique, { steps: 21, seed: 1447, variation: 0.62 });
    assert.deepEqual(first, second, `${technique} must be deterministic`);
    assert.equal(first.length, WEBGPU_SYNTHS_SEQUENCE_LENGTH);
    assert.equal(first.every((step) => step.length === WEBGPU_SYNTHS_MAX_LANES), true);
    assert.equal(first.flat().every((value) => value >= 0 && value <= 1), true);
    assert.equal(webGpuSynthSequenceArray(first).length, WEBGPU_SYNTHS_SEQUENCE_LENGTH * WEBGPU_SYNTHS_MAX_LANES);
  }
  const invalid = sanitizeWebGpuSynthSequence([[Infinity, -2, 8, "nope"]]);
  assert.deepEqual(invalid[0], [0.5, 0, 1, 0.5, 0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(sanitizeWebGpuSynthLaneRoutes([99, 99, -4, 999]), [0, 1, 2, 19, 4, 5, 6, 9]);
  assert.deepEqual([...webGpuSynthLaneRouteArray()], WEBGPU_SYNTHS_DEFAULT_LANE_ROUTES);
  assert.equal(WEBGPU_SYNTHS_LANE_TARGETS.length, 20);
});

test("lane variations preserve unselected values and model layers are bounded", () => {
  const sequence = createWebGpuSynthSequence("orbit", { steps: 16, seed: 91 });
  const varied = varyWebGpuSynthSequence(sequence, 5, 0.4, 123);
  for (let step = 0; step < sequence.length; step += 1) {
    assert.equal(varied[step][0], sequence[step][0]);
    assert.equal(varied[step][1], sequence[step][1]);
    assert.equal(varied[step][3], sequence[step][3]);
  }
  assert.equal(WEBGPU_SYNTHS_MODELS.length, 8);
  assert.equal(webGpuSynthModelLabel(0), "Spectral Acid");
  assert.equal(webGpuSynthModelLabel(1.5), "Classic FM × Wavefold Table");
  assert.equal(webGpuSynthModelLabel(4), "Particle Cloud");
  assert.equal(webGpuSynthModelLabel(4.5), "Particle Cloud × Additive Organ");
  assert.equal(webGpuSynthModelLabel(5), "Additive Organ");
  assert.equal(webGpuSynthModelLabel(5, 0, 0.4), "Additive Organ × Spectral Acid");
  assert.equal(webGpuSynthModelLabel(5, 0, 1), "Spectral Acid");
  assert.equal(WEBGPU_SYNTHS_MAX_MODEL_LAYERS, 6);
  const layers = sanitizeWebGpuSynthModelLayers([{ model: 99, level: 2, detune: -99, pan: 3 }]);
  assert.deepEqual(layers[0], { model: 7, level: 1, detune: -24, pan: 1 });
  assert.equal(webGpuSynthModelLayerArray(layers).length, WEBGPU_SYNTHS_MAX_MODEL_LAYERS * 4);
});

test("additive organ ranks expose editable ratios, levels, and per-rank AM", () => {
  assert.equal(WEBGPU_SYNTHS_ORGAN_RANK_COUNT, 9);
  assert.equal(WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS.length, 9);
  assert.equal(webGpuSynthOrganRankArray().length, 36);
  const ranks = sanitizeWebGpuSynthOrganRanks([
    { ratio: 99, level: -1, amRate: 99, amDepth: 4 },
  ]);
  assert.deepEqual(ranks[0], { ratio: 16, level: 0, amRate: 30, amDepth: 1 });
  assert.deepEqual(ranks[1], WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS[1]);
});

test("the WGSL shader owns sequencing and the complete synthesis signal path", () => {
  assert.match(WEBGPU_SYNTHS_SHADER, /@compute/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn swingTime/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn scaleNote/);
  assert.match(WEBGPU_SYNTHS_SHADER, /@binding\(3\) var<storage, read> sequence_lanes: array<f32>/);
  assert.match(WEBGPU_SYNTHS_SHADER, /@binding\(4\) var<storage, read> organ_rank: array<vec4<f32>>/);
  assert.match(WEBGPU_SYNTHS_SHADER, /@binding\(7\) var<storage, read> lane_route: array<u32>/);
  assert.match(WEBGPU_SYNTHS_SHADER, /@binding\(8\) var<storage, read> model_layer: array<vec4<f32>>/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn routedUnit/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn spectralAcid/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn classicFm/);
  assert.doesNotMatch(WEBGPU_SYNTHS_SHADER, /fn cascadePm/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn wavefoldTable/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn modalMetal/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn particleCloud/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn additiveOrgan/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn vectorWavetable/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn formantBank/);
  assert.match(WEBGPU_SYNTHS_SHADER, /for \(var drawbar = 0u; drawbar < 9u/);
  assert.match(WEBGPU_SYNTHS_SHADER, /synth_param\.fmOperators/);
  assert.match(WEBGPU_SYNTHS_SHADER, /synth_param\.modalModes/);
  assert.match(WEBGPU_SYNTHS_SHADER, /rank\.z/);
  assert.match(WEBGPU_SYNTHS_SHADER, /rank\.w/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn layeredSound/);
  assert.match(WEBGPU_SYNTHS_SHADER, /if \(synth_param\.layerMode < 0\.5\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let lowerWeight = cos\(blend \* PI \* 0\.5\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let currentNote = synth_param\.baseNote \+ scaleNote\(laneValue\(stepIndex, 0u\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let followingNote = synth_param\.baseNote \+ scaleNote\(laneValue\(nextIndex, 0u\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let note = mix\(currentNote, followingNote, glide\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let edge = clamp\(synth_param\.clock \* 0\.008, 0\.018, 0\.24\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let release = 1\.0 - smoothstep\(1\.0 - edge, 1\.0, phase\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let envelope =/);
  assert.doesNotMatch(WEBGPU_SYNTHS_SHADER, /smoothTail/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let pan =/);
  assert.match(WEBGPU_SYNTHS_SHADER, /softClip/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn synthesizeDry/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn sincLowpass/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn multiTapDelay/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn postWaveshaper/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn convolutionReverb/);
  assert.match(WEBGPU_SYNTHS_SHADER, /synth_param\.reverbTaps/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn processFx/);
});

test("the page exposes 32 shuffled presets, persistent envelopes, direct note editing, and no Web Audio synthesis nodes", async () => {
  const [html, css, app, engine, nav, catalogue, build] = await Promise.all([
    readFile(new URL("webgpu-synths.html", root), "utf8"),
    readFile(new URL("webgpu-synths.css", root), "utf8"),
    readFile(new URL("webgpu-synths-app.js", root), "utf8"),
    readFile(new URL("src/webgpu-synths.js", root), "utf8"),
    readFile(new URL("nav.js", root), "utf8"),
    readFile(new URL("src/instrument-catalog.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);
  assert.match(html, /<h1 id="webgpuSynthsTitle">GPU Shader Synths<\/h1>/);
  assert.match(html, /<html lang="en" class="webgpu-synths-document">/);
  assert.doesNotMatch(html, /ALL MUSICAL LOGIC IN WGSL/);
  assert.match(html, /id="sequenceStage"/);
  assert.doesNotMatch(html, /id="modelRail"/);
  assert.doesNotMatch(html, /id="laneButtons"/);
  assert.match(html, /id="addLane"[^>]*>\+ Add parameter lane/);
  assert.match(html, /id="laneTargetSelect"/);
  assert.doesNotMatch(html, /<b>Edit lane<\/b>|<b>Destination<\/b>/);
  assert.match(html, /data-section="sequence-tools"[\s\S]*id="laneState">4 of 8 lanes[\s\S]*id="rotateLeft"[\s\S]*id="invertLane"/);
  assert.match(html, /id="addModelLayer"[^>]*>\+ Add synthesis layer/);
  assert.match(html, /One layer is fully isolated\. Add up to six/);
  assert.doesNotMatch(`${html}\n${app}`, /sequenceEditHint|Click a lane to add or edit|double-click Pitch or Pulse/);
  assert.doesNotMatch(`${html}\n${app}`, /Pitch · scale degree|Pulse · gate \+ energy|Timbre · model color|Morph · model \+ motion/);
  assert.match(html, /<h2 class="group-title">Presets<\/h2>/);
  assert.match(html, /id="presetButtons"/);
  assert.match(html, /id="techniqueButtons"/);
  assert.match(html, /Web Audio is buffer playback only/);
  assert.doesNotMatch(`${html}\n${app}`, /eight synthesis models · layered in WGSL|id="engineBadge"/);
  assert.match(html, /equal-power morphing, classic FM, sparse convolution reverb/);
  assert.match(html, /id="componentsControls"/);
  assert.match(html, /id="organRankControls"/);
  assert.match(html, /id="effectsControls"/);
  assert.match(html, /one GPU submission with two compute passes/);
  assert.match(html, /upload only when edited/);
  assert.ok(html.indexOf('data-section="presets"') < html.indexOf('data-section="time"'));
  assert.ok(html.indexOf('data-section="time"') < html.indexOf('data-section="sequence-tools"'));
  assert.ok(html.indexOf('data-section="sequence-tools"') < html.indexOf('data-section="variations"'));
  assert.ok(html.indexOf('id="resetPatch"') < html.indexOf('class="wgsl-boundary"'));
  assert.doesNotMatch(css, /\.model-rail/);
  assert.match(css, /\.sequence-router/);
  assert.match(css, /\.model-layer-row/);
  assert.doesNotMatch(css, /\.sequence-edit-hint/);
  assert.match(css, /\.preset-grid \{[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(css, /\.organ-rank-row/);
  assert.match(css, /\.effect-module/);
  assert.doesNotMatch(`${html}\n${css}\n${app}`, /knobControls|webgpu-synth-knob|KNOB_ORDER/);
  assert.match(css, /\.webgpu-synths-stage \{[\s\S]*overflow-y: auto/);
  assert.match(css, /@media \(min-width: 981px\) and \(max-height: 1000px\) \{[\s\S]*#sequenceStage \{[\s\S]*min-height: 0/);
  assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*html\.webgpu-synths-document \{[\s\S]*overflow-y: auto/);
  assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*#sequenceStage \{[\s\S]*touch-action: pan-y/);
  assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*\.webgpu-synths-page \.masthead \{[\s\S]*grid-template-rows: 48px 48px/);
  assert.match(css, /\.masthead\.has-midi-toolbar \.header-io-controls > \.audio-strip \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*grid-template-columns: 48px minmax\(92px, 0\.85fr\) minmax\(110px, 1\.15fr\)/);
  assert.match(app, /Acid Fossil/);
  assert.match(app, /Recursive Chrome/);
  assert.match(app, /Folded Mutant/);
  assert.match(app, /Bell Swarm/);
  assert.match(app, /Dust Engine/);
  assert.match(app, /Velvet Drawbars/);
  assert.match(app, /Interzone/);
  assert.match(app, /Void Grinder/);
  const presetBlock = app.slice(app.indexOf("const PRESET_LIBRARY"), app.indexOf("const CONTROL_GROUPS"));
  const presetMatches = [...presetBlock.matchAll(/preset\("([^"]+)", "([^"]+)", "[^"]+", [^,]+, \{([^}]+)\}\)/g)];
  assert.equal(presetMatches.length, 32);
  assert.match(app, /function shuffledPresetBank\(presets, seed = 0x4d4f5250\)/);
  assert.match(app, /const featured = presets\.find\(\(\{ id \}\) => id === "modal-bloom"\)/);
  assert.match(app, /return Object\.freeze\(\[featured, \.\.\.shuffled\]\)/);
  assert.match(app, /const PRESETS = shuffledPresetBank\(PRESET_LIBRARY\)/);
  assert.match(html, /id="presetState">Modal Bloom</);
  assert.match(html, /id="timeState">27 steps · 9\.80 Hz</);
  assert.match(presetBlock, /preset\("velvet-drawbars", "Velvet Drawbars", "orbit", 0\.16, \{[^}]*clock: 2\.2[^}]*gain: 0\.092/);
  assert.match(presetBlock, /preset\("modal-bloom", "Modal Bloom", "recurrence", 0\.14/);
  assert.match(presetBlock, /preset\("folded-mutant", "Folded Mutant", "cellular", 0\.54/);
  assert.match(presetBlock, /preset\("interzone", "Interzone", "noise", 0\.68, \{[^}]*chaos: 0\.94/);
  assert.match(presetBlock, /preset\("dust-engine", "Dust Engine", "brownian", 0\.46, \{[^}]*gain: 0\.11/);
  assert.match(app, /createWebGpuSynthSequence/);
  assert.match(app, /varyWebGpuSynthSequence/);
  assert.match(app, /editSequenceLane/);
  assert.match(app, /editingStep: null/);
  assert.match(app, /next\[position\.stepIndex\]\[1\] = 0\.82/);
  assert.match(app, /function removeSequenceNote\(event\)/);
  assert.match(app, /next\[position\.stepIndex\]\[1\] = 0/);
  assert.match(app, /addEventListener\("dblclick", removeSequenceNote\)/);
  assert.match(app, /if \(state\.sequence\[step\]\[1\] <= 0\.01\) continue/);
  assert.match(app, /if \(lane\.id === "pitch"\)/);
  assert.match(app, /const WIDE_LANE_MAX_HEIGHT = 56/);
  assert.match(app, /\(width \/ pixelRatio\) < 920 \? 96 : 150/);
  assert.match(app, /Math\.min\(naturalHeight, WIDE_LANE_MAX_HEIGHT \* pixelRatio\)/);
  assert.match(app, /const \{ width, height, pixelRatio \} = resizeCanvas\(canvas\)/);
  assert.match(app, /bottom \+ Math\.min\(5 \* pixelRatio, gap \* 0\.5\)/);
  const modelControls = app.slice(app.indexOf("model: Object.freeze"), app.indexOf("time: Object.freeze"));
  assert.doesNotMatch(modelControls, /key: "topology"/);
  assert.doesNotMatch(modelControls, /key: "modelB"/);
  assert.match(modelControls, /key: "modelMix", label: "Layer morph", step: 0\.01/);
  assert.doesNotMatch(modelControls, /knobOnly/);
  assert.match(modelControls, /key: "complexity", label: "Density"/);
  assert.match(modelControls, /key: "fold", label: "Fold"/);
  assert.match(app, /key: "motion", label: "Orbit"/);
  assert.match(app, /function addModelLayer/);
  assert.match(app, /function removeModelLayer/);
  assert.match(app, /function addSequenceLane/);
  assert.match(app, /function changeLaneTarget/);
  assert.match(app, /WEBGPU_SYNTHS_LANE_TARGETS/);
  assert.match(app, /models: \[7\]/);
  assert.doesNotMatch(app, /topology: "Model"/);
  assert.doesNotMatch(app, /function drawModelGraphic/);
  assert.doesNotMatch(app, /WGSL synthesis running/);
  assert.match(app, /FIR low-pass/);
  assert.match(app, /Feed-forward delay/);
  assert.match(app, /Waveshaper/);
  assert.match(app, /Convolution reverb/);
  assert.doesNotMatch(`${html}\n${engine}`, /Cascade PM/);
  assert.doesNotMatch(`${html}\n${css}\n${app}\n${engine}`, /\b(?:genome|organism|DNA)\b/i);
  assert.doesNotMatch(`${app}\n${engine}`, /createOscillator|createBiquadFilter|createDelay|createWaveShaper|audioWorklet|OscillatorNode|BiquadFilterNode/);
  assert.match(engine, /createBufferSource/);
  assert.match(engine, /entryPoint: "synthesizeDry"/);
  assert.match(engine, /entryPoint: "processFx"/);
  const renderChunkStart = engine.indexOf("async renderChunk");
  const renderChunk = engine.slice(renderChunkStart, engine.indexOf("  handleRenderError(", renderChunkStart));
  assert.equal((renderChunk.match(/queue\.writeBuffer/g) ?? []).length, 1);
  assert.match(nav, /webgpu-synths\.html/);
  assert.match(catalogue, /"webgpu-synths": define/);
  assert.match(build, /webgpu-synths\.html/);
});

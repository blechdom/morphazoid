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
  assert.match(WEBGPU_SYNTHS_SHADER, /let contour = mix\(laneValue\(step, lane\), laneValue\(nextStep, lane\), clamp\(phase, 0\.0, 1\.0\)\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /routedUnit\(stepIndex, nextIndex, phase, 2u/);
  assert.match(WEBGPU_SYNTHS_SHADER, /routedRange\(stepIndex, nextIndex, phase, 9u/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn spectralAcid/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn classicFm/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let ratio = 1\.0 \+ floor\(clamp\(synth_param\.color, 0\.0, 1\.0\) \* 5\.0\) \* 0\.5/);
  assert.doesNotMatch(WEBGPU_SYNTHS_SHADER, /floor\(timbre \* 5\.0\)/);
  assert.doesNotMatch(WEBGPU_SYNTHS_SHADER, /fn cascadePm/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn wavefoldTable/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn modalMetal/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let scatter = \(hash11\(f32\(mode\) \* 19\.7\) - 0\.5\) \* 0\.12/);
  assert.doesNotMatch(WEBGPU_SYNTHS_SHADER, /hash11\([^\n]*motion/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let decayNorm = clamp\(\(macros\.w - 0\.03\) \/ 1\.77/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let bandGain = 1\.0 - smoothstep\(SAMPLE_RATE \* 0\.34, SAMPLE_RATE \* 0\.46, modalHz\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let phase = local \* modalHz \* TAU \+ phaseMotion/);
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
  assert.match(WEBGPU_SYNTHS_SHADER, /fn smootherstep01/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let stepDuration = select\(\(1\.0 - swingAmount\) \/ clockRate, \(1\.0 \+ swingAmount\) \/ clockRate/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let edgeSeconds = min\(0\.012, stepDuration \* 0\.24\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let attack = smootherstep01\(local \/ max\(edgeSeconds, 0\.0001\)\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let release = smootherstep01\(remaining \/ max\(edgeSeconds, 0\.0001\)\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let envelope = attack \* release \* exp\(-local \/ max\(0\.03, decay\)\) \* energy/);
  assert.doesNotMatch(WEBGPU_SYNTHS_SHADER, /\bt \* frequency/);
  assert.doesNotMatch(WEBGPU_SYNTHS_SHADER, /time \* \(0\.07 \+ motion/);
  assert.match(WEBGPU_SYNTHS_SHADER, /time \* 0\.07 \+ local \* \(0\.08 \+ motion \* 0\.41\)/);
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
  assert.ok(html.indexOf('class="sequence-deck"') < html.indexOf('id="stageWrap"'));
  assert.match(html, /class="play-button webgpu-synths-play-button"[\s\S]*?id="synthPlayButton"[\s\S]*?aria-label="Play GPU shader sequence"[\s\S]*?data-primary-transport/);
  assert.match(html, /class="transport-play"[^>]*>[\s\S]*?M8 5\.5 18 12 8 18\.5Z/);
  assert.match(html, /class="transport-pause"[^>]*>[\s\S]*?M8 6v12M16 6v12/);
  const masthead = html.slice(html.indexOf('<header class="masthead">'), html.indexOf("</header>"));
  assert.doesNotMatch(masthead, /synthPlayButton|data-primary-transport/);
  assert.ok(html.indexOf('class="sequence-deck"') < html.indexOf('id="synthPlayButton"'));
  assert.ok(html.indexOf('id="synthPlayButton"') < html.indexOf('class="sequence-router"'));
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
  assert.match(css, /\.sequence-deck \{[\s\S]*grid-template-columns: max-content minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /\.webgpu-synths-page \.audio-strip|\.synth-play-button/);
  assert.match(css, /\.sequence-router select,[\s\S]*height: 36px;[\s\S]*min-height: 36px/);
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
  const synthTransportState = app.slice(
    app.indexOf("function setSynthPlayState"),
    app.indexOf("async function startAudio", app.indexOf("function setSynthPlayState")),
  );
  assert.doesNotMatch(synthTransportState, /\.textContent/);
  assert.match(synthTransportState, /button\.setAttribute\("aria-label", action\)/);
  assert.match(synthTransportState, /button\.title = `\$\{action\} \(Space\)`/);
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
  assert.match(app, /const INTENTIONAL_NOISE_PRESET_IDS = Object\.freeze/);
  assert.match(app, /const tonal = remainder\.filter\(\(\{ id \}\) => !INTENTIONAL_NOISE_PRESET_IDS\.includes\(id\)\)/);
  assert.match(app, /return Object\.freeze\(\[featured, \.\.\.shuffle\(tonal\), \.\.\.shuffle\(destructive\)\]\)/);
  assert.match(app, /const PRESETS = shuffledPresetBank\(PRESET_LIBRARY\)/);
  assert.match(html, /id="presetState">Modal Bloom</);
  assert.match(html, /id="timeState">27 steps · 9\.80 Hz</);
  assert.match(presetBlock, /preset\("velvet-drawbars", "Velvet Drawbars", "orbit", 0\.16, \{[^}]*clock: 2\.2[^}]*gain: 0\.092/);
  assert.match(presetBlock, /preset\("modal-bloom", "Modal Bloom", "recurrence", 0\.14, \{[^}]*topology: 3[^}]*modalModes: 16[^}]*filterCutoff: 8200/);
  assert.match(presetBlock, /preset\("folded-mutant", "Folded Mutant", "cellular", 0\.54/);
  assert.match(presetBlock, /preset\("interzone", "Interzone", "noise", 0\.68, \{[^}]*chaos: 0\.94/);
  assert.match(presetBlock, /preset\("dust-engine", "Dust Engine", "brownian", 0\.46, \{[^}]*topology: 4[^}]*color: 0\.44[^}]*gain: 0\.09/);
  assert.match(presetBlock, /preset\("shrapnel-fold", "Shrapnel Fold", "cellular", 0\.88, \{[^}]*topology: 2[^}]*foldLayers: 6/);
  assert.match(presetBlock, /preset\("void-grinder", "Void Grinder", "noise", 1, \{[^}]*topology: 2[^}]*shaperDrive: 9\.5/);
  assert.match(app, /createWebGpuSynthSequence/);
  assert.match(app, /varyWebGpuSynthSequence/);
  assert.match(app, /editSequenceLane/);
  assert.match(app, /editingStep: null/);
  assert.match(app, /next\[position\.stepIndex\]\[1\] = 0\.82/);
  assert.match(app, /function removeSequenceNote\(event\)/);
  assert.match(app, /if \(target\.id <= 1\) next\[position\.stepIndex\]\[1\] = 0/);
  assert.match(app, /else next\[position\.stepIndex\]\[position\.laneIndex\] = 0/);
  assert.match(app, /addEventListener\("dblclick", removeSequenceNote\)/);
  assert.match(app, /function sequenceLaneOrder/);
  assert.match(app, /\[order\[0\], order\[1\]\] = \[order\[1\], order\[0\]\]/);
  assert.match(app, /if \(lane\.key === "energy"\)/);
  assert.match(app, /if \(lane\.key === "pitch"\)/);
  assert.doesNotMatch(app, /lane\.id === "(?:energy|pitch)"/);
  assert.match(app, /const barWidth = Math\.max\(pixelRatio, cellWidth - barGap \* 2\)/);
  assert.match(app, /context\.strokeRect\(x \+ 0\.5, y \+ 2\.5 \* pixelRatio/);
  assert.match(app, /context\.fillRect\(x, valueY, barWidth, fillHeight\)/);
  assert.match(app, /context\.lineTo\(x, valueY\)/);
  assert.match(app, /sequencePointerPosition\(event, \{ laneIndex: state\.editingLane \}\)/);
  assert.match(app, /state\.editingStep = position\.stepIndex/);
  assert.match(app, /laneIndex < WEBGPU_SYNTHS_MIN_LANES \? laneIndex : state\.laneRoutes\[laneIndex\]/);
  assert.match(html, /Pulse gate and amplitude rectangles first, followed by contour lanes/);
  assert.doesNotMatch(app, /WIDE_LANE_MAX_HEIGHT/);
  assert.match(app, /\(width \/ pixelRatio\) < 920 \? 96 : 150/);
  assert.match(app, /const heightEach = naturalHeight/);
  assert.match(app, /const \{ width, height, pixelRatio \} = resizeCanvas\(canvas\)/);
  assert.match(app, /bottom \+ Math\.min\(5 \* pixelRatio, gap \* 0\.5\)/);
  assert.match(app, /const numberedStepInterval = steps > 32 \? 8 : 4/);
  assert.match(app, /context\.lineTo\(x, bottom\)/);
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

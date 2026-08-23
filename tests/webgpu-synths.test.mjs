import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_SYNTHS_DEFAULT_ORGAN_RANKS,
  WEBGPU_SYNTHS_DEFAULTS,
  WEBGPU_SYNTHS_MODELS,
  WEBGPU_SYNTHS_ORGAN_RANK_COUNT,
  WEBGPU_SYNTHS_PARAM_ORDER,
  WEBGPU_SYNTHS_SEQUENCE_LENGTH,
  WEBGPU_SYNTHS_SHADER,
  createWebGpuSynthSequence,
  sanitizeWebGpuSynthOrganRanks,
  sanitizeWebGpuSynthParams,
  sanitizeWebGpuSynthSequence,
  varyWebGpuSynthSequence,
  webGpuSynthModelLabel,
  webGpuSynthOrganRankArray,
  webGpuSynthParamArray,
  webGpuSynthSequenceArray,
} from "../src/webgpu-synths.js";

const root = new URL("../", import.meta.url);

test("GPU Shader Synths packs one stable 32-float shader parameter contract", () => {
  assert.deepEqual(WEBGPU_SYNTHS_PARAM_ORDER, [
    "topology",
    "baseNote",
    "clock",
    "steps",
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
    "pmOperators",
    "foldLayers",
    "modalModes",
    "grainCount",
    "organRanks",
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
  ]);
  assert.equal(webGpuSynthParamArray().length, 32);
  assert.deepEqual(sanitizeWebGpuSynthParams(), WEBGPU_SYNTHS_DEFAULTS);
  const clamped = sanitizeWebGpuSynthParams({ topology: 99, steps: 2, gain: 9, scale: -4, pmOperators: 99, filterTaps: 10 });
  assert.equal(clamped.topology, 5);
  assert.equal(clamped.steps, 4);
  assert.equal(clamped.gain, 0.22);
  assert.equal(clamped.scale, 0);
  assert.equal(clamped.pmOperators, 12);
  assert.equal(clamped.filterTaps, 11);
});

test("four control lanes are deterministic, bounded, and GPU-buffer ready", () => {
  assert.equal(WEBGPU_SYNTHS_SEQUENCE_LENGTH, 64);
  for (const technique of ["euclid", "brownian", "cellular", "recurrence", "orbit", "noise"]) {
    const first = createWebGpuSynthSequence(technique, { steps: 21, seed: 1447, variation: 0.62 });
    const second = createWebGpuSynthSequence(technique, { steps: 21, seed: 1447, variation: 0.62 });
    assert.deepEqual(first, second, `${technique} must be deterministic`);
    assert.equal(first.length, WEBGPU_SYNTHS_SEQUENCE_LENGTH);
    assert.equal(first.every((step) => step.length === 4), true);
    assert.equal(first.flat().every((value) => value >= 0 && value <= 1), true);
    assert.equal(webGpuSynthSequenceArray(first).length, WEBGPU_SYNTHS_SEQUENCE_LENGTH * 4);
  }
  const invalid = sanitizeWebGpuSynthSequence([[Infinity, -2, 8, "nope"]]);
  assert.deepEqual(invalid[0], [0.5, 0, 1, 0.5]);
});

test("lane variations preserve unselected values and model topology labels expose morphs", () => {
  const sequence = createWebGpuSynthSequence("orbit", { steps: 16, seed: 91 });
  const varied = varyWebGpuSynthSequence(sequence, "timbre", 0.4, 123);
  for (let step = 0; step < sequence.length; step += 1) {
    assert.equal(varied[step][0], sequence[step][0]);
    assert.equal(varied[step][1], sequence[step][1]);
    assert.equal(varied[step][3], sequence[step][3]);
  }
  assert.equal(WEBGPU_SYNTHS_MODELS.length, 6);
  assert.equal(webGpuSynthModelLabel(0), "Spectral Acid");
  assert.equal(webGpuSynthModelLabel(1.5), "Cascade PM × Wavefold Table");
  assert.equal(webGpuSynthModelLabel(4), "Particle Cloud");
  assert.equal(webGpuSynthModelLabel(4.5), "Particle Cloud × Additive Organ");
  assert.equal(webGpuSynthModelLabel(5), "Additive Organ");
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
  assert.match(WEBGPU_SYNTHS_SHADER, /@binding\(3\) var<storage, read> sequence_lanes: array<vec4<f32>>/);
  assert.match(WEBGPU_SYNTHS_SHADER, /@binding\(4\) var<storage, read> organ_rank: array<vec4<f32>>/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn spectralAcid/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn cascadePm/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn wavefoldTable/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn modalMetal/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn particleCloud/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn additiveOrgan/);
  assert.match(WEBGPU_SYNTHS_SHADER, /for \(var drawbar = 0u; drawbar < 9u/);
  assert.match(WEBGPU_SYNTHS_SHADER, /synth_param\.pmOperators/);
  assert.match(WEBGPU_SYNTHS_SHADER, /synth_param\.modalModes/);
  assert.match(WEBGPU_SYNTHS_SHADER, /rank\.z/);
  assert.match(WEBGPU_SYNTHS_SHADER, /rank\.w/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let topology = clamp/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let currentNote = synth_param\.baseNote \+ scaleNote\(current\.x/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let followingNote = synth_param\.baseNote \+ scaleNote\(following\.x/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let note = mix\(currentNote, followingNote, glide\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let release = 1\.0 - smoothstep\(0\.982, 1\.0, phase\)/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let envelope =/);
  assert.doesNotMatch(WEBGPU_SYNTHS_SHADER, /smoothTail/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let pan =/);
  assert.match(WEBGPU_SYNTHS_SHADER, /softClip/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn synthesizeDry/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn sincLowpass/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn multiTapDelay/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn postWaveshaper/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn processFx/);
});

test("the page exposes 32 ordered presets, variations, direct lane drawing, and no Web Audio synthesis nodes", async () => {
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
  assert.match(html, /ALL MUSICAL LOGIC IN WGSL/);
  assert.match(html, /id="sequenceStage"/);
  assert.match(html, /<h2 class="group-title">Presets<\/h2>/);
  assert.match(html, /id="presetButtons"/);
  assert.match(html, /id="techniqueButtons"/);
  assert.match(html, /Web Audio is buffer playback only/);
  assert.match(html, /six synthesis models · two GPU passes/);
  assert.match(html, /not a claim of mathematical chaos/);
  assert.match(html, /id="componentsControls"/);
  assert.match(html, /id="organRankControls"/);
  assert.match(html, /id="effectsControls"/);
  assert.match(html, /one GPU submission with two compute passes/);
  assert.match(html, /upload only when edited/);
  assert.ok(html.indexOf('data-section="presets"') < html.indexOf('data-section="time"'));
  assert.ok(html.indexOf('data-section="time"') < html.indexOf('data-section="variations"'));
  assert.ok(html.indexOf('id="resetPatch"') < html.indexOf('class="wgsl-boundary"'));
  assert.match(css, /\.model-rail/);
  assert.match(css, /\.sequence-lane-tabs/);
  assert.match(css, /\.preset-grid \{[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(css, /\.organ-rank-row/);
  assert.match(css, /\.effect-module/);
  assert.match(css, /\.webgpu-synth-knob-bank/);
  assert.match(css, /\.webgpu-synths-stage \{[\s\S]*overflow-y: auto/);
  assert.match(css, /@media \(min-width: 981px\) and \(max-height: 1000px\) \{[\s\S]*#sequenceStage \{[\s\S]*min-height: 0/);
  assert.match(app, /Acid Fossil/);
  assert.match(app, /Recursive Chrome/);
  assert.match(app, /Folded Mutant/);
  assert.match(app, /Bell Swarm/);
  assert.match(app, /Dust Engine/);
  assert.match(app, /Velvet Drawbars/);
  assert.match(app, /Interzone/);
  assert.match(app, /Void Grinder/);
  const presetBlock = app.slice(app.indexOf("const PRESETS"), app.indexOf("const CONTROL_GROUPS"));
  const presetMatches = [...presetBlock.matchAll(/preset\("([^"]+)", "([^"]+)", "[^"]+", [^,]+, \{([^}]+)\}\)/g)];
  assert.equal(presetMatches.length, 32);
  const earlyPresetParams = presetMatches.slice(0, 8).map(([, , , params]) => ({
    baseNote: Number(params.match(/baseNote: ([\d.]+)/)?.[1]),
    clock: Number(params.match(/clock: ([\d.]+)/)?.[1]),
  }));
  assert.ok(Math.min(...earlyPresetParams.map(({ clock }) => clock)) <= 0.72);
  assert.ok(Math.max(...earlyPresetParams.map(({ clock }) => clock)) >= 12.6);
  assert.ok(Math.max(...earlyPresetParams.map(({ baseNote }) => baseNote)) - Math.min(...earlyPresetParams.map(({ baseNote }) => baseNote)) >= 40);
  assert.ok(presetBlock.indexOf("Velvet Drawbars") < presetBlock.indexOf("Dust Engine"));
  assert.ok(presetBlock.indexOf("Dust Engine") < presetBlock.indexOf("Void Grinder"));
  assert.ok(presetMatches.findIndex(([, id]) => id === "folded-mutant") >= 12);
  assert.ok(presetMatches.findIndex(([, id]) => id === "interzone") >= 20);
  assert.ok(presetMatches.findIndex(([, id]) => id === "dust-engine") >= 20);
  assert.match(presetBlock, /preset\("velvet-drawbars", "Velvet Drawbars", "orbit", 0\.16, \{[^}]*clock: 2\.2[^}]*gain: 0\.092/);
  assert.match(presetBlock, /preset\("folded-mutant", "Folded Mutant", "cellular", 0\.54/);
  assert.match(presetBlock, /preset\("interzone", "Interzone", "noise", 0\.68, \{[^}]*chaos: 0\.94/);
  assert.match(presetBlock, /preset\("dust-engine", "Dust Engine", "brownian", 0\.46, \{[^}]*gain: 0\.11/);
  assert.match(app, /createWebGpuSynthSequence/);
  assert.match(app, /varyWebGpuSynthSequence/);
  assert.match(app, /editSequenceLane/);
  assert.match(app, /FIR low-pass/);
  assert.match(app, /Feed-forward delay/);
  assert.match(app, /Waveshaper/);
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

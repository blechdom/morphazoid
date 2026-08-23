import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_SYNTHS_DEFAULTS,
  WEBGPU_SYNTHS_MODELS,
  WEBGPU_SYNTHS_PARAM_ORDER,
  WEBGPU_SYNTHS_SEQUENCE_LENGTH,
  WEBGPU_SYNTHS_SHADER,
  createWebGpuSynthSequence,
  sanitizeWebGpuSynthParams,
  sanitizeWebGpuSynthSequence,
  varyWebGpuSynthSequence,
  webGpuSynthModelLabel,
  webGpuSynthParamArray,
  webGpuSynthSequenceArray,
} from "../src/webgpu-synths.js";

const root = new URL("../", import.meta.url);

test("WebGPU Synths packs one stable 16-float shader parameter contract", () => {
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
  ]);
  assert.equal(webGpuSynthParamArray().length, 16);
  assert.deepEqual(sanitizeWebGpuSynthParams(), WEBGPU_SYNTHS_DEFAULTS);
  const clamped = sanitizeWebGpuSynthParams({ topology: 99, steps: 2, gain: 9, scale: -4 });
  assert.equal(clamped.topology, 4);
  assert.equal(clamped.steps, 4);
  assert.equal(clamped.gain, 0.22);
  assert.equal(clamped.scale, 0);
});

test("four-lane genomes are deterministic, bounded, and GPU-buffer ready", () => {
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

test("lane variations preserve unselected genes and model topology labels expose morphs", () => {
  const sequence = createWebGpuSynthSequence("orbit", { steps: 16, seed: 91 });
  const varied = varyWebGpuSynthSequence(sequence, "timbre", 0.4, 123);
  for (let step = 0; step < sequence.length; step += 1) {
    assert.equal(varied[step][0], sequence[step][0]);
    assert.equal(varied[step][1], sequence[step][1]);
    assert.equal(varied[step][3], sequence[step][3]);
  }
  assert.equal(WEBGPU_SYNTHS_MODELS.length, 5);
  assert.equal(webGpuSynthModelLabel(0), "Spectral Acid");
  assert.equal(webGpuSynthModelLabel(1.5), "Cascade FM × Wavefold Table");
  assert.equal(webGpuSynthModelLabel(4), "Particle Cloud");
});

test("the WGSL shader owns sequencing and the complete synthesis signal path", () => {
  assert.match(WEBGPU_SYNTHS_SHADER, /@compute/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn swingTime/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn scaleNote/);
  assert.match(WEBGPU_SYNTHS_SHADER, /@binding\(3\) var<storage, read> sequence_dna: array<vec4<f32>>/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn spectralAcid/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn cascadeFm/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn wavefoldTable/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn modalMetal/);
  assert.match(WEBGPU_SYNTHS_SHADER, /fn particleCloud/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let topology = clamp/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let envelope =/);
  assert.match(WEBGPU_SYNTHS_SHADER, /let pan =/);
  assert.match(WEBGPU_SYNTHS_SHADER, /softClip/);
  assert.match(WEBGPU_SYNTHS_SHADER, /sound_chunk\[sample\] = mainSound\(time\)/);
});

test("the new page exposes themes, variations, direct lane drawing, and no Web Audio synthesis nodes", async () => {
  const [html, css, app, engine, nav, catalogue, build] = await Promise.all([
    readFile(new URL("webgpu-synths.html", root), "utf8"),
    readFile(new URL("webgpu-synths.css", root), "utf8"),
    readFile(new URL("webgpu-synths-app.js", root), "utf8"),
    readFile(new URL("src/webgpu-synths.js", root), "utf8"),
    readFile(new URL("nav.js", root), "utf8"),
    readFile(new URL("src/instrument-catalog.js", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);
  assert.match(html, /<h1 id="webgpuSynthsTitle">WebGPU Synths<\/h1>/);
  assert.match(html, /ALL MUSICAL LOGIC IN WGSL/);
  assert.match(html, /id="genomeStage"/);
  assert.match(html, /id="themeButtons"/);
  assert.match(html, /id="techniqueButtons"/);
  assert.match(html, /Web Audio is buffer playback only/);
  assert.match(css, /\.model-rail/);
  assert.match(css, /\.genome-lane-tabs/);
  assert.match(css, /\.webgpu-synth-knob-bank/);
  assert.match(app, /Acid Fossil/);
  assert.match(app, /Recursive Chrome/);
  assert.match(app, /Folded Mutant/);
  assert.match(app, /Bell Swarm/);
  assert.match(app, /Dust Engine/);
  assert.match(app, /Interzone/);
  assert.match(app, /createWebGpuSynthSequence/);
  assert.match(app, /varyWebGpuSynthSequence/);
  assert.match(app, /editGenome/);
  assert.doesNotMatch(`${app}\n${engine}`, /createOscillator|createBiquadFilter|createDelay|createWaveShaper|audioWorklet|OscillatorNode|BiquadFilterNode/);
  assert.match(engine, /createBufferSource/);
  assert.match(nav, /webgpu-synths\.html/);
  assert.match(catalogue, /"webgpu-synths": define/);
  assert.match(build, /webgpu-synths\.html/);
});

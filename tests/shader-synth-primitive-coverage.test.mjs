import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SHADER_SYNTH_PRIMITIVE_COVERAGE,
  SHADER_SYNTH_PRIMITIVE_COVERAGE_KINDS,
  shaderSynthPrimitiveCoverageById,
  shaderSynthPrimitivePlaygroundHref,
} from "../src/shader-synth-playground-primitive-coverage.js";
import { SHADER_PLAYGROUND_MODULES } from "../src/shader-synth-playground.js";
import { WEBGPU_DSP_PRIMITIVES } from "../src/webgpu-dsp-primitives.js";

const ROOT = new URL("../", import.meta.url);
const ADVANCED_MODULE_IDS = new Set([
  "sequence-lane",
  "uploaded-wavetable",
  "gpu-sampler-granulator",
  "spatializer",
  "recursive-filter",
  "feedback-network",
  "wavefield-solver",
  "spectral-transport",
  "dynamics",
  "convolution-space",
  "massive-bank",
  "audio-analysis-field",
  "ddsp-resynth",
  "spectral-vocoder",
  "neural-processor",
]);

test("every atlas primitive has one explicit playable, infrastructure, or workflow destination", () => {
  const primitiveIds = WEBGPU_DSP_PRIMITIVES.map(({ id }) => id).sort();
  const coverageIds = Object.keys(SHADER_SYNTH_PRIMITIVE_COVERAGE).sort();
  assert.deepEqual(coverageIds, primitiveIds);
  assert.equal(coverageIds.length, 145);

  const validKinds = new Set(SHADER_SYNTH_PRIMITIVE_COVERAGE_KINDS);
  const knownModuleIds = new Set([
    ...SHADER_PLAYGROUND_MODULES.map(({ id }) => id),
    ...ADVANCED_MODULE_IDS,
  ]);
  for (const [primitiveId, coverage] of Object.entries(SHADER_SYNTH_PRIMITIVE_COVERAGE)) {
    assert.ok(validKinds.has(coverage.kind), `${primitiveId} has an unknown coverage kind`);
    assert.ok(coverage.label.trim(), `${primitiveId} needs a user-facing coverage label`);
    if (coverage.kind === "playable") {
      assert.ok(knownModuleIds.has(coverage.moduleId), `${primitiveId} points at unknown module ${coverage.moduleId}`);
      assert.equal(
        shaderSynthPrimitivePlaygroundHref(primitiveId),
        `shader-synth-playground.html?module=${encodeURIComponent(coverage.moduleId)}`,
      );
    } else {
      assert.ok(coverage.featureId.trim(), `${primitiveId} needs an infrastructure/workflow feature id`);
      assert.equal(shaderSynthPrimitivePlaygroundHref(primitiveId), null);
    }
    assert.equal(shaderSynthPrimitiveCoverageById(primitiveId), coverage);
  }
  assert.equal(shaderSynthPrimitiveCoverageById("not-a-primitive"), null);
  assert.equal(shaderSynthPrimitiveCoverageById("__proto__"), null);
});

test("the combined advanced modules are all reachable from their source primitives", () => {
  const coveredModuleIds = new Set(Object.values(SHADER_SYNTH_PRIMITIVE_COVERAGE)
    .filter(({ kind }) => kind === "playable")
    .map(({ moduleId }) => moduleId));
  assert.deepEqual(
    [...ADVANCED_MODULE_IDS].filter((moduleId) => !coveredModuleIds.has(moduleId)),
    [],
  );

  assert.equal(SHADER_SYNTH_PRIMITIVE_COVERAGE["fft-stft"].kind, "infrastructure");
  assert.equal(SHADER_SYNTH_PRIMITIVE_COVERAGE["overlap-add"].kind, "infrastructure");
  assert.equal(SHADER_SYNTH_PRIMITIVE_COVERAGE["compute-audio-stream-bridge"].kind, "infrastructure");
  assert.equal(SHADER_SYNTH_PRIMITIVE_COVERAGE["batch-patch-renderer"].kind, "workflow");
  assert.deepEqual(
    ["feedback-delay", "comb-allpass", "feedback-delay-network"]
      .map((id) => SHADER_SYNTH_PRIMITIVE_COVERAGE[id].moduleId),
    ["feedback-network", "feedback-network", "feedback-network"],
  );
});

test("the atlas renders searchable coverage links and the playground accepts module deep links", async () => {
  const [atlasApp, atlasCss, playgroundApp] = await Promise.all([
    readFile(new URL("webgpu-dsp-primitives-app.js", ROOT), "utf8"),
    readFile(new URL("webgpu-dsp-primitives.css", ROOT), "utf8"),
    readFile(new URL("shader-synth-playground-app.js", ROOT), "utf8"),
  ]);

  assert.match(atlasApp, /shaderSynthPrimitiveCoverageById/);
  assert.match(atlasApp, /shaderSynthPrimitivePlaygroundHref/);
  assert.match(atlasApp, /Playable as \$\{escapeHtml\(coverage\.label\)\}/);
  assert.match(atlasApp, /Runtime infrastructure/);
  assert.match(atlasApp, /coverage\?\.moduleId/);
  assert.match(atlasApp, /coverage\?\.featureId/);
  assert.match(atlasCss, /\.primitive-coverage/);
  assert.match(atlasCss, /data-coverage-kind="infrastructure"/);

  const resolverSource = playgroundApp.match(/function requestedModuleId\(search, validModuleIds\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(resolverSource, "the module query resolver must remain directly testable");
  const requestedModuleId = Function(`"use strict"; return (${resolverSource});`)();
  const valid = new Set(["spectral-transport", "fm"]);
  assert.equal(requestedModuleId("?module=spectral-transport", valid), "spectral-transport");
  assert.equal(requestedModuleId("?q=fm&module=fm", valid), "fm");
  assert.equal(requestedModuleId("?module=missing", valid), null);
  assert.equal(requestedModuleId("", valid), null);

  assert.match(playgroundApp, /initialModuleId[\s\S]*?auditionModule\(initialModuleId\)/);
  assert.match(playgroundApp, /Press Run patch or play a note to hear it/);
});

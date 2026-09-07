import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildShaderSynthXyflow } from "./build-shader-synth-xyflow.mjs";

const expectedFiles = Object.freeze([
  "THIRD_PARTY_LICENSES.txt",
  "shader-synth-playground-xyflow.css",
  "shader-synth-playground-xyflow.js",
]);

async function buildAt(root, label) {
  const outputDirectory = path.join(root, label, "assets", "xyflow");
  return buildShaderSynthXyflow(outputDirectory);
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "morphazoid-xyflow-check-"));
try {
  const firstBuild = await buildAt(temporaryRoot, "first");
  const secondBuild = await buildAt(temporaryRoot, "second");
  const first = firstBuild.outputDirectory;
  const second = secondBuild.outputDirectory;
  assert.deepEqual(firstBuild.externalImports, [], "XYFlow build retained external imports");
  assert.deepEqual(secondBuild.externalImports, [], "repeat XYFlow build retained external imports");
  const [firstFiles, secondFiles] = await Promise.all([
    readdir(first),
    readdir(second),
  ]);
  firstFiles.sort();
  secondFiles.sort();
  assert.deepEqual(firstFiles, expectedFiles, "XYFlow build emitted an unexpected file inventory");
  assert.deepEqual(secondFiles, expectedFiles, "repeat XYFlow build emitted an unexpected file inventory");

  for (const filename of expectedFiles) {
    const [firstBytes, secondBytes] = await Promise.all([
      readFile(path.join(first, filename)),
      readFile(path.join(second, filename)),
    ]);
    assert.equal(firstBytes.equals(secondBytes), true, `${filename} is not deterministic`);
  }

  const bundle = await readFile(path.join(first, "shader-synth-playground-xyflow.js"), "utf8");
  assert.doesNotMatch(bundle, /\bprocess\.env\b/, "browser bundle must not depend on Node environment variables");
  assert.match(bundle, /MorphazoidShaderSynthGraphRenderer/);
  console.log("Static Shader Synth XYFlow bundle is complete and deterministic.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

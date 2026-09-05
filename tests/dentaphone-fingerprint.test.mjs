import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fingerprintDentaphone } from "../scripts/fingerprint-dentaphone.mjs";

const visualAssetPathnames = Object.freeze([
  "assets/dentaphone-upper.webp",
  "assets/dentaphone-lower.webp",
  "assets/dentaphone-toothbrush.webp",
  "assets/dentaphone-chew-apple.webp",
  "assets/dentaphone-chew-crystal.webp",
  "assets/dentaphone-chew-gear.webp",
  "assets/dentaphone-chew-seedpod.webp",
]);

function contentVersion(source) {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function assertVersioned(source, reference, version) {
  assert.ok(
    source.includes(`${reference}?v=${version}`),
    `expected ${reference} to carry version ${version}`,
  );
}

async function readArtifact(outputDirectory, pathname) {
  return readFile(path.join(outputDirectory, pathname), "utf8");
}

async function appendArtifact(outputDirectory, pathname, addition) {
  const artifactPath = path.join(outputDirectory, pathname);
  const source = await readFile(artifactPath, "utf8");
  await writeFile(artifactPath, `${source}${addition}`, "utf8");
}

async function assertVersionsMatchContents(outputDirectory, versions) {
  const versionPaths = {
    appVersion: "physical-sounds-app.js",
    audioOutputManagerVersion: "src/audio-output-manager.js",
    bufferGeometryUtilsVersion: "vendor/three/utils/BufferGeometryUtils.js",
    cssVersion: "physical-sounds.css",
    dentaphoneVersion: "src/dentaphone.js",
    glbVersion: "assets/models/dentaphone-chomper.glb",
    gltfLoaderVersion: "vendor/three/loaders/GLTFLoader.js",
    physicalSoundsVersion: "src/physical-sounds.js",
    processorVersion: "src/physical-sounds-processor.js",
    rendererVersion: "src/dentaphone-webgl.js",
    skeletonUtilsVersion: "vendor/three/utils/SkeletonUtils.js",
    threeCoreVersion: "vendor/three/three.core.min.js",
    threeModuleVersion: "vendor/three/three.module.min.js",
  };
  for (const [name, pathname] of Object.entries(versionPaths)) {
    assert.equal(
      versions[name],
      contentVersion(await readFile(path.join(outputDirectory, pathname))),
      `${name} must describe the final published bytes`,
    );
  }
  for (const pathname of visualAssetPathnames) {
    assert.equal(
      versions.visualAssetVersions[pathname],
      contentVersion(await readFile(path.join(outputDirectory, pathname))),
      `${pathname} version must describe the published asset bytes`,
    );
  }
}

test("Dentaphone publish fingerprints propagate through the complete 3D and audio graphs", async (t) => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "dentaphone-fingerprint-"));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(outputDirectory, "assets/models"), { recursive: true }),
    mkdir(path.join(outputDirectory, "src"), { recursive: true }),
    mkdir(path.join(outputDirectory, "vendor/three/loaders"), { recursive: true }),
    mkdir(path.join(outputDirectory, "vendor/three/utils"), { recursive: true }),
  ]);

  await Promise.all([
    writeFile(
      path.join(outputDirectory, "vendor/three/three.core.min.js"),
      "export const core = 'first core';\n",
    ),
    writeFile(
      path.join(outputDirectory, "vendor/three/three.module.min.js"),
      [
        'import { core } from "./three.core.min.js?v=stale-core";',
        'export { core } from "./three.core.min.js?v=older-core";',
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(outputDirectory, "vendor/three/utils/BufferGeometryUtils.js"),
      "import { core } from '../three.module.min.js'; export { core };\n",
    ),
    writeFile(
      path.join(outputDirectory, "vendor/three/utils/SkeletonUtils.js"),
      "import { core } from '../three.module.min.js?v=stale-module'; export { core };\n",
    ),
    writeFile(
      path.join(outputDirectory, "vendor/three/loaders/GLTFLoader.js"),
      [
        "import * as THREE from '../three.module.min.js?v=stale-three';",
        "import { merge } from '../utils/BufferGeometryUtils.js';",
        "import { clone } from '../utils/SkeletonUtils.js?v=stale-skeleton';",
        "export { THREE, merge, clone };",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(outputDirectory, "assets/models/dentaphone-chomper.glb"),
      Buffer.from("first dentaphone mesh"),
    ),
    ...visualAssetPathnames.map((pathname, index) => writeFile(
      path.join(outputDirectory, pathname),
      Buffer.from(`first Dentaphone visual ${index}`),
    )),
    writeFile(
      path.join(outputDirectory, "src/dentaphone-webgl.js"),
      [
        'import * as THREE from "../vendor/three/three.module.min.js";',
        'import { GLTFLoader } from "../vendor/three/loaders/GLTFLoader.js?v=stale-loader";',
        'const model = new URL("../assets/models/dentaphone-chomper.glb?v=stale-model", import.meta.url);',
        "export { THREE, GLTFLoader, model };",
        "",
      ].join("\n"),
    ),
    writeFile(
      path.join(outputDirectory, "src/audio-output-manager.js"),
      "export const connectAudioOutput = () => 'first output';\n",
    ),
    writeFile(
      path.join(outputDirectory, "src/dentaphone.js"),
      "export const teeth = 32;\n",
    ),
    writeFile(
      path.join(outputDirectory, "src/physical-sounds.js"),
      "export const sound = 'first modal bank';\n",
    ),
    writeFile(
      path.join(outputDirectory, "src/physical-sounds-processor.js"),
      'import { sound } from "./physical-sounds.js?v=stale-physical"; void sound;\n',
    ),
    writeFile(
      path.join(outputDirectory, "physical-sounds-app.js"),
      [
        'import "./src/audio-output-manager.js";',
        'import "./src/physical-sounds.js?v=stale-physical";',
        'import "./src/dentaphone.js";',
        'const renderer = import("./src/dentaphone-webgl.js?v=stale-renderer");',
        'const processor = new URL("./src/physical-sounds-processor.js?v=stale-worklet", import.meta.url);',
        "void renderer; void processor;",
        "",
      ].join("\n"),
    ),
    writeFile(path.join(outputDirectory, "physical-sounds.css"), ".tooth { color: ivory; }\n"),
    writeFile(
      path.join(outputDirectory, "dentaphone.html"),
      [
        '<link rel="stylesheet" href="physical-sounds.css?v=stale-css">',
        '<script type="module" src="physical-sounds-app.js?v=stale-app"></script>',
        '<img src="assets/dentaphone-upper.webp?v=stale-upper">',
        '<img src="assets/dentaphone-lower.webp">',
        '<img src="assets/dentaphone-toothbrush.webp?v=stale-brush">',
        '<img src="assets/dentaphone-toothbrush.webp">',
        '<img src="assets/dentaphone-chew-apple.webp">',
        '<img src="assets/dentaphone-chew-crystal.webp?v=stale-crystal">',
        '<img src="assets/dentaphone-chew-gear.webp">',
        '<img src="assets/dentaphone-chew-seedpod.webp">',
        "",
      ].join("\n"),
    ),
  ]);

  const first = await fingerprintDentaphone(outputDirectory);
  await assertVersionsMatchContents(outputDirectory, first);

  const firstThreeModule = await readArtifact(outputDirectory, "vendor/three/three.module.min.js");
  const firstBufferUtils = await readArtifact(outputDirectory, "vendor/three/utils/BufferGeometryUtils.js");
  const firstSkeletonUtils = await readArtifact(outputDirectory, "vendor/three/utils/SkeletonUtils.js");
  const firstLoader = await readArtifact(outputDirectory, "vendor/three/loaders/GLTFLoader.js");
  const firstRenderer = await readArtifact(outputDirectory, "src/dentaphone-webgl.js");
  const firstProcessor = await readArtifact(outputDirectory, "src/physical-sounds-processor.js");
  const firstApp = await readArtifact(outputDirectory, "physical-sounds-app.js");
  const firstHtml = await readArtifact(outputDirectory, "dentaphone.html");
  assertVersioned(firstThreeModule, "./three.core.min.js", first.threeCoreVersion);
  assert.equal(
    firstThreeModule.split(`./three.core.min.js?v=${first.threeCoreVersion}`).length - 1,
    2,
    "both the Three core import and re-export must use the same version",
  );
  assertVersioned(firstBufferUtils, "../three.module.min.js", first.threeModuleVersion);
  assertVersioned(firstSkeletonUtils, "../three.module.min.js", first.threeModuleVersion);
  assertVersioned(firstLoader, "../three.module.min.js", first.threeModuleVersion);
  assertVersioned(firstLoader, "../utils/BufferGeometryUtils.js", first.bufferGeometryUtilsVersion);
  assertVersioned(firstLoader, "../utils/SkeletonUtils.js", first.skeletonUtilsVersion);
  assertVersioned(firstRenderer, "../vendor/three/three.module.min.js", first.threeModuleVersion);
  assertVersioned(firstRenderer, "../vendor/three/loaders/GLTFLoader.js", first.gltfLoaderVersion);
  assertVersioned(firstRenderer, "../assets/models/dentaphone-chomper.glb", first.glbVersion);
  assertVersioned(firstProcessor, "./physical-sounds.js", first.physicalSoundsVersion);
  assertVersioned(firstApp, "./src/audio-output-manager.js", first.audioOutputManagerVersion);
  assertVersioned(firstApp, "./src/physical-sounds.js", first.physicalSoundsVersion);
  assertVersioned(firstApp, "./src/dentaphone.js", first.dentaphoneVersion);
  assertVersioned(firstApp, "./src/dentaphone-webgl.js", first.rendererVersion);
  assertVersioned(firstApp, "./src/physical-sounds-processor.js", first.processorVersion);
  assertVersioned(firstHtml, "physical-sounds.css", first.cssVersion);
  assertVersioned(firstHtml, "physical-sounds-app.js", first.appVersion);
  for (const pathname of visualAssetPathnames) {
    assertVersioned(firstHtml, pathname, first.visualAssetVersions[pathname]);
  }
  assert.equal(
    firstHtml.split(
      `assets/dentaphone-toothbrush.webp?v=${first.visualAssetVersions["assets/dentaphone-toothbrush.webp"]}`,
    ).length - 1,
    2,
    "every direct reference to the toothbrush image must use the same version",
  );
  assert.doesNotMatch(
    [firstThreeModule, firstBufferUtils, firstSkeletonUtils, firstLoader, firstRenderer, firstProcessor, firstApp, firstHtml].join("\n"),
    /\?v=(?:stale|older)-/,
  );

  await writeFile(
    path.join(outputDirectory, "assets/models/dentaphone-chomper.glb"),
    Buffer.from("second, re-exported dentaphone mesh"),
  );
  const afterGlb = await fingerprintDentaphone(outputDirectory);
  assert.notEqual(afterGlb.glbVersion, first.glbVersion);
  assert.notEqual(afterGlb.rendererVersion, first.rendererVersion);
  assert.notEqual(afterGlb.appVersion, first.appVersion);
  assert.equal(afterGlb.gltfLoaderVersion, first.gltfLoaderVersion);
  assertVersioned(
    await readArtifact(outputDirectory, "src/dentaphone-webgl.js"),
    "../assets/models/dentaphone-chomper.glb",
    afterGlb.glbVersion,
  );
  assertVersioned(
    await readArtifact(outputDirectory, "dentaphone.html"),
    "physical-sounds-app.js",
    afterGlb.appVersion,
  );

  await writeFile(
    path.join(outputDirectory, "vendor/three/three.core.min.js"),
    "export const core = 'second core';\n",
  );
  const afterThreeCore = await fingerprintDentaphone(outputDirectory);
  for (const name of [
    "threeCoreVersion",
    "threeModuleVersion",
    "bufferGeometryUtilsVersion",
    "skeletonUtilsVersion",
    "gltfLoaderVersion",
    "rendererVersion",
    "appVersion",
  ]) {
    assert.notEqual(afterThreeCore[name], afterGlb[name], `${name} must follow Three core changes`);
  }
  assert.equal(afterThreeCore.glbVersion, afterGlb.glbVersion);
  await assertVersionsMatchContents(outputDirectory, afterThreeCore);

  await appendArtifact(
    outputDirectory,
    "vendor/three/utils/BufferGeometryUtils.js",
    "export const bufferUtilsRevision = 2;\n",
  );
  const afterBufferUtils = await fingerprintDentaphone(outputDirectory);
  for (const name of [
    "bufferGeometryUtilsVersion",
    "gltfLoaderVersion",
    "rendererVersion",
    "appVersion",
  ]) {
    assert.notEqual(afterBufferUtils[name], afterThreeCore[name], `${name} must follow buffer utility changes`);
  }
  assert.equal(afterBufferUtils.threeModuleVersion, afterThreeCore.threeModuleVersion);
  assert.equal(afterBufferUtils.skeletonUtilsVersion, afterThreeCore.skeletonUtilsVersion);

  await appendArtifact(
    outputDirectory,
    "vendor/three/utils/SkeletonUtils.js",
    "export const skeletonUtilsRevision = 2;\n",
  );
  const afterSkeletonUtils = await fingerprintDentaphone(outputDirectory);
  for (const name of ["skeletonUtilsVersion", "gltfLoaderVersion", "rendererVersion", "appVersion"]) {
    assert.notEqual(afterSkeletonUtils[name], afterBufferUtils[name], `${name} must follow skeleton utility changes`);
  }
  assert.equal(
    afterSkeletonUtils.bufferGeometryUtilsVersion,
    afterBufferUtils.bufferGeometryUtilsVersion,
  );

  await appendArtifact(
    outputDirectory,
    "vendor/three/loaders/GLTFLoader.js",
    "export const loaderRevision = 2;\n",
  );
  const afterGltfLoader = await fingerprintDentaphone(outputDirectory);
  for (const name of ["gltfLoaderVersion", "rendererVersion", "appVersion"]) {
    assert.notEqual(afterGltfLoader[name], afterSkeletonUtils[name], `${name} must follow GLTF loader changes`);
  }
  assert.equal(afterGltfLoader.threeModuleVersion, afterSkeletonUtils.threeModuleVersion);

  await appendArtifact(
    outputDirectory,
    "src/dentaphone-webgl.js",
    "export const rendererRevision = 2;\n",
  );
  const afterRenderer = await fingerprintDentaphone(outputDirectory);
  assert.notEqual(afterRenderer.rendererVersion, afterGltfLoader.rendererVersion);
  assert.notEqual(afterRenderer.appVersion, afterGltfLoader.appVersion);
  assert.equal(afterRenderer.gltfLoaderVersion, afterGltfLoader.gltfLoaderVersion);

  await appendArtifact(
    outputDirectory,
    "src/physical-sounds-processor.js",
    "export const processorRevision = 2;\n",
  );
  const afterProcessor = await fingerprintDentaphone(outputDirectory);
  assert.notEqual(afterProcessor.processorVersion, afterRenderer.processorVersion);
  assert.notEqual(afterProcessor.appVersion, afterRenderer.appVersion);
  assert.equal(afterProcessor.rendererVersion, afterRenderer.rendererVersion);

  await writeFile(
    path.join(outputDirectory, "src/physical-sounds.js"),
    "export const sound = 'second modal bank';\n",
  );
  const afterPhysicalSounds = await fingerprintDentaphone(outputDirectory);
  assert.notEqual(afterPhysicalSounds.physicalSoundsVersion, afterProcessor.physicalSoundsVersion);
  assert.notEqual(afterPhysicalSounds.processorVersion, afterProcessor.processorVersion);
  assert.notEqual(afterPhysicalSounds.appVersion, afterProcessor.appVersion);
  assert.equal(afterPhysicalSounds.rendererVersion, afterProcessor.rendererVersion);
  assertVersioned(
    await readArtifact(outputDirectory, "src/physical-sounds-processor.js"),
    "./physical-sounds.js",
    afterPhysicalSounds.physicalSoundsVersion,
  );

  await writeFile(
    path.join(outputDirectory, "src/dentaphone.js"),
    "export const teeth = 32; export const layout = 'changed';\n",
  );
  const afterDentaphone = await fingerprintDentaphone(outputDirectory);
  assert.notEqual(afterDentaphone.dentaphoneVersion, afterPhysicalSounds.dentaphoneVersion);
  assert.notEqual(afterDentaphone.appVersion, afterPhysicalSounds.appVersion);
  assert.equal(afterDentaphone.processorVersion, afterPhysicalSounds.processorVersion);

  await writeFile(
    path.join(outputDirectory, "src/audio-output-manager.js"),
    "export const connectAudioOutput = () => 'second output';\n",
  );
  const afterAudioOutput = await fingerprintDentaphone(outputDirectory);
  assert.notEqual(
    afterAudioOutput.audioOutputManagerVersion,
    afterDentaphone.audioOutputManagerVersion,
  );
  assert.notEqual(afterAudioOutput.appVersion, afterDentaphone.appVersion);

  await writeFile(
    path.join(outputDirectory, "physical-sounds.css"),
    ".tooth { color: porcelain; }\n",
  );
  const afterCss = await fingerprintDentaphone(outputDirectory);
  assert.notEqual(afterCss.cssVersion, afterAudioOutput.cssVersion);
  assert.equal(afterCss.appVersion, afterAudioOutput.appVersion);
  assertVersioned(
    await readArtifact(outputDirectory, "dentaphone.html"),
    "physical-sounds.css",
    afterCss.cssVersion,
  );

  await writeFile(
    path.join(outputDirectory, "assets/dentaphone-upper.webp"),
    Buffer.from("second Dentaphone upper jaw visual"),
  );
  const afterVisualAsset = await fingerprintDentaphone(outputDirectory);
  assert.notEqual(
    afterVisualAsset.visualAssetVersions["assets/dentaphone-upper.webp"],
    afterCss.visualAssetVersions["assets/dentaphone-upper.webp"],
  );
  assert.equal(afterVisualAsset.appVersion, afterCss.appVersion);
  assert.equal(afterVisualAsset.cssVersion, afterCss.cssVersion);
  assertVersioned(
    await readArtifact(outputDirectory, "dentaphone.html"),
    "assets/dentaphone-upper.webp",
    afterVisualAsset.visualAssetVersions["assets/dentaphone-upper.webp"],
  );

  const mutableArtifacts = [
    "dentaphone.html",
    "physical-sounds-app.js",
    "src/dentaphone-webgl.js",
    "src/physical-sounds-processor.js",
    "vendor/three/loaders/GLTFLoader.js",
    "vendor/three/three.module.min.js",
    "vendor/three/utils/BufferGeometryUtils.js",
    "vendor/three/utils/SkeletonUtils.js",
  ];
  const beforeRepeat = await Promise.all(
    mutableArtifacts.map((pathname) => readArtifact(outputDirectory, pathname)),
  );
  const repeated = await fingerprintDentaphone(outputDirectory);
  assert.deepEqual(
    repeated,
    afterVisualAsset,
    "fingerprinting the same artifact twice must be idempotent",
  );
  assert.deepEqual(
    await Promise.all(mutableArtifacts.map((pathname) => readArtifact(outputDirectory, pathname))),
    beforeRepeat,
  );
});

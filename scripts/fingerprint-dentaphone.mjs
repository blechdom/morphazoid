import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

function versionReference(source, pathname, version) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let matchCount = 0;
  const fingerprinted = source.replace(
    new RegExp(`${escaped}(?:\\?v=[^\"']+)?`, "g"),
    () => {
      matchCount += 1;
      return `${pathname}?v=${version}`;
    },
  );
  if (matchCount === 0) throw new Error(`Cannot fingerprint missing reference: ${pathname}`);
  return fingerprinted;
}

async function sourceVersion(pathname) {
  return contentVersion(await readFile(pathname));
}

async function fingerprintSource(pathname, references) {
  const source = await readFile(pathname, "utf8");
  let fingerprinted = source;
  for (const [reference, version] of references) {
    fingerprinted = versionReference(fingerprinted, reference, version);
  }
  if (fingerprinted !== source) await writeFile(pathname, fingerprinted, "utf8");
  return contentVersion(fingerprinted);
}

export async function fingerprintDentaphone(outputDirectory) {
  const threeDirectory = path.join(outputDirectory, "vendor/three");
  const threeCorePath = path.join(threeDirectory, "three.core.min.js");
  const threeModulePath = path.join(threeDirectory, "three.module.min.js");
  const bufferGeometryUtilsPath = path.join(threeDirectory, "utils/BufferGeometryUtils.js");
  const skeletonUtilsPath = path.join(threeDirectory, "utils/SkeletonUtils.js");
  const gltfLoaderPath = path.join(threeDirectory, "loaders/GLTFLoader.js");
  const glbPath = path.join(outputDirectory, "assets/models/dentaphone-chomper.glb");
  const rendererPath = path.join(outputDirectory, "src/dentaphone-webgl.js");
  const audioOutputManagerPath = path.join(outputDirectory, "src/audio-output-manager.js");
  const dentaphonePath = path.join(outputDirectory, "src/dentaphone.js");
  const physicalSoundsPath = path.join(outputDirectory, "src/physical-sounds.js");
  const processorPath = path.join(outputDirectory, "src/physical-sounds-processor.js");
  const appPath = path.join(outputDirectory, "physical-sounds-app.js");
  const cssPath = path.join(outputDirectory, "physical-sounds.css");
  const htmlPath = path.join(outputDirectory, "dentaphone.html");

  // Fingerprint the vendored Three.js graph from its leaf module upward.
  const threeCoreVersion = await sourceVersion(threeCorePath);
  const threeModuleVersion = await fingerprintSource(threeModulePath, [
    ["./three.core.min.js", threeCoreVersion],
  ]);
  const bufferGeometryUtilsVersion = await fingerprintSource(bufferGeometryUtilsPath, [
    ["../three.module.min.js", threeModuleVersion],
  ]);
  const skeletonUtilsVersion = await fingerprintSource(skeletonUtilsPath, [
    ["../three.module.min.js", threeModuleVersion],
  ]);
  const gltfLoaderVersion = await fingerprintSource(gltfLoaderPath, [
    ["../three.module.min.js", threeModuleVersion],
    ["../utils/BufferGeometryUtils.js", bufferGeometryUtilsVersion],
    ["../utils/SkeletonUtils.js", skeletonUtilsVersion],
  ]);

  // The renderer hash carries the model and every vendored runtime dependency.
  const glbVersion = await sourceVersion(glbPath);
  const rendererVersion = await fingerprintSource(rendererPath, [
    ["../vendor/three/three.module.min.js", threeModuleVersion],
    ["../vendor/three/loaders/GLTFLoader.js", gltfLoaderVersion],
    ["../assets/models/dentaphone-chomper.glb", glbVersion],
  ]);

  // Fingerprint the worklet after its shared model so the entry app changes
  // whenever either side of the AudioWorklet module graph changes.
  const audioOutputManagerVersion = await sourceVersion(audioOutputManagerPath);
  const dentaphoneVersion = await sourceVersion(dentaphonePath);
  const physicalSoundsVersion = await sourceVersion(physicalSoundsPath);
  const processorVersion = await fingerprintSource(processorPath, [
    ["./physical-sounds.js", physicalSoundsVersion],
  ]);
  const appVersion = await fingerprintSource(appPath, [
    ["./src/audio-output-manager.js", audioOutputManagerVersion],
    ["./src/physical-sounds.js", physicalSoundsVersion],
    ["./src/dentaphone.js", dentaphoneVersion],
    ["./src/dentaphone-webgl.js", rendererVersion],
    ["./src/physical-sounds-processor.js", processorVersion],
  ]);

  const cssVersion = await sourceVersion(cssPath);
  const visualAssetVersions = Object.fromEntries(await Promise.all(
    visualAssetPathnames.map(async (pathname) => [
      pathname,
      await sourceVersion(path.join(outputDirectory, pathname)),
    ]),
  ));
  await fingerprintSource(htmlPath, [
    ["physical-sounds.css", cssVersion],
    ["physical-sounds-app.js", appVersion],
    ...Object.entries(visualAssetVersions),
  ]);

  return {
    appVersion,
    audioOutputManagerVersion,
    bufferGeometryUtilsVersion,
    cssVersion,
    dentaphoneVersion,
    glbVersion,
    gltfLoaderVersion,
    physicalSoundsVersion,
    processorVersion,
    rendererVersion,
    skeletonUtilsVersion,
    threeCoreVersion,
    threeModuleVersion,
    visualAssetVersions,
  };
}

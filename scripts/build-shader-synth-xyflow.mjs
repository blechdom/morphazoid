import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild-wasm";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const entryFile = path.join(repositoryRoot, "src", "xyflow", "shader-synth-playground-xyflow.jsx");
const bundleBaseName = "shader-synth-playground-xyflow";
const bundledPackages = Object.freeze([
  "@xyflow/react",
  "@xyflow/system",
  "react",
  "react-dom",
  "scheduler",
  "zustand",
  "use-sync-external-store",
  "classcat",
  "d3-color",
  "d3-dispatch",
  "d3-drag",
  "d3-ease",
  "d3-interpolate",
  "d3-selection",
  "d3-timer",
  "d3-transition",
  "d3-zoom",
]);

function isStrictDescendant(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

export function resolveShaderSynthXyflowOutputDirectory(outputArgument) {
  const outputDirectory = path.isAbsolute(outputArgument)
    ? path.resolve(outputArgument)
    : path.resolve(repositoryRoot, outputArgument);
  const normalized = outputDirectory.split(path.sep).join("/");
  if (!normalized.endsWith("/assets/xyflow")) {
    throw new Error(`XYFlow output must end in assets/xyflow, received: ${outputDirectory}`);
  }
  const allowedRoots = [repositoryRoot, path.resolve(tmpdir())];
  if (!allowedRoots.some((root) => isStrictDescendant(outputDirectory, root))) {
    throw new Error(`XYFlow output must stay inside the repository or temporary directory: ${outputDirectory}`);
  }
  return outputDirectory;
}

export async function validateShaderSynthXyflowOutputDirectory(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const lexicalAllowedRoots = [repositoryRoot, path.resolve(tmpdir())];
  const lexicalRoot = lexicalAllowedRoots.find((root) => isStrictDescendant(outputDirectory, root));
  if (!lexicalRoot) {
    throw new Error(`XYFlow output must stay inside the repository or temporary directory: ${outputDirectory}`);
  }
  let currentPath = lexicalRoot;
  for (const segment of path.relative(lexicalRoot, outputDirectory).split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    if ((await lstat(currentPath)).isSymbolicLink()) {
      throw new Error(`XYFlow output path must not contain symbolic links or junctions: ${currentPath}`);
    }
  }
  const [realOutputDirectory, ...realAllowedRoots] = await Promise.all([
    realpath(outputDirectory),
    realpath(repositoryRoot),
    realpath(path.resolve(tmpdir())),
  ]);
  const normalized = realOutputDirectory.split(path.sep).join("/");
  if (!normalized.endsWith("/assets/xyflow")) {
    throw new Error(`XYFlow output must resolve to an assets/xyflow directory: ${realOutputDirectory}`);
  }
  if (!realAllowedRoots.some((root) => isStrictDescendant(realOutputDirectory, root))) {
    throw new Error(
      `XYFlow output must resolve inside the repository or temporary directory: ${realOutputDirectory}`,
    );
  }
  return realOutputDirectory;
}

async function packageLicense(packageName) {
  const packageDirectory = path.join(repositoryRoot, "node_modules", ...packageName.split("/"));
  const manifest = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
  const candidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "license.md"];
  for (const candidate of candidates) {
    try {
      const contents = await readFile(path.join(packageDirectory, candidate), "utf8");
      return { name: manifest.name, version: manifest.version, license: manifest.license, contents: contents.trim() };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`No license file found for bundled package ${packageName}`);
}

async function writeThirdPartyLicenses(outputDirectory) {
  const records = await Promise.all(bundledPackages.map(packageLicense));
  const sections = records.map((record) => [
    "=".repeat(78),
    `${record.name} ${record.version} (${record.license})`,
    "=".repeat(78),
    record.contents,
  ].join("\n"));
  const notice = [
    "Morphazoid Shader Synth XYFlow bundle — third-party licenses",
    "",
    "This file is generated from the installed dependency license files.",
    "",
    ...sections,
    "",
  ].join("\n");
  await writeFile(path.join(outputDirectory, "THIRD_PARTY_LICENSES.txt"), notice, "utf8");
}

export async function buildShaderSynthXyflow(outputArgument = "assets/xyflow") {
  const outputDirectory = resolveShaderSynthXyflowOutputDirectory(outputArgument);
  const realOutputDirectory = await validateShaderSynthXyflowOutputDirectory(outputDirectory);
  await rm(realOutputDirectory, { recursive: true, force: true });
  await mkdir(realOutputDirectory, { recursive: true });
  const buildResult = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [entryFile],
    bundle: true,
    outdir: realOutputDirectory,
    entryNames: bundleBaseName,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    jsxImportSource: "react",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    treeShaking: true,
    minify: true,
    sourcemap: false,
    legalComments: "none",
    metafile: true,
    logLevel: "warning",
  });
  await writeThirdPartyLicenses(realOutputDirectory);
  const externalImports = [...new Set(Object.values(buildResult.metafile.outputs).flatMap((output) => (
    output.imports.map((entry) => entry.path)
  )))].sort();
  return {
    outputDirectory,
    javascript: path.join(outputDirectory, `${bundleBaseName}.js`),
    stylesheet: path.join(outputDirectory, `${bundleBaseName}.css`),
    licenses: path.join(outputDirectory, "THIRD_PARTY_LICENSES.txt"),
    externalImports,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await buildShaderSynthXyflow(process.argv[2] || "assets/xyflow");
  console.log(`Built the static Shader Synth XYFlow renderer in ${result.outputDirectory}`);
}

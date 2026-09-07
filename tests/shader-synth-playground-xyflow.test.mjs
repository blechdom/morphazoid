import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("shader playground offers XYFlow as a renderer-only comparison route", async () => {
  const [html, bootstrap, app, jsx] = await Promise.all([
    source("shader-synth-playground.html"),
    source("shader-synth-playground-bootstrap.js"),
    source("shader-synth-playground-app.js"),
    source("src/xyflow/shader-synth-playground-xyflow.jsx"),
  ]);

  assert.match(html, /id="graphRendererComparison"[\s\S]*href="\?graph=xyflow"/);
  assert.match(html, /id="xyflowGraphRoot"[\s\S]*hidden/);
  assert.match(html, /src="shader-synth-playground-bootstrap\.js/);
  assert.doesNotMatch(html, /<script[^>]+src="shader-synth-playground-app\.js/);

  assert.match(bootstrap, /requestedRenderer === xyflowRenderer/);
  assert.match(bootstrap, /import\(`\.\/assets\/xyflow\/shader-synth-playground-xyflow\.js\?v=\$\{xyflowAssetVersion\}`\)/);
  assert.match(bootstrap, /shader-synth-playground-xyflow\.css\?v=\$\{xyflowAssetVersion\}/);
  assert.match(bootstrap, /stylesheet\.addEventListener\(\s*"error"/);
  assert.match(bootstrap, /await Promise\.allSettled\(\[/);
  assert.match(bootstrap, /assetResults\.find\(\(result\) => result\.status === "rejected"\)/);
  assert.match(bootstrap, /delete globalThis\.MorphazoidShaderSynthGraphRenderer/);
  assert.match(bootstrap, /catch \(error\)[\s\S]*using the original canvas/);
  assert.match(bootstrap, /await import\("\.\/shader-synth-playground-app\.js/);

  assert.doesNotMatch(app, /from\s+["'](?:react|react-dom|@xyflow\/react)/);
  assert.match(app, /graphRendererFactory\.mount/);
  assert.match(app, /function graphRendererSnapshot\(/);
  assert.match(app, /function reconnectGraphConnection\(/);
  assert.match(app, /replaceConnectionId/);

  assert.match(jsx, /from "@xyflow\/react"/);
  assert.match(jsx, /<MiniMap/);
  assert.match(jsx, /elevateEdgesOnSelect/);
  assert.match(jsx, /nodesDraggable=\{!coarsePointer\}/);
  assert.match(jsx, /panOnDrag=\{!coarsePointer\}/);
  assert.match(jsx, /preventScrolling=\{!coarsePointer\}/);
  assert.match(jsx, /onReconnect=/);
  assert.match(jsx, /reconnectingEdgeId\.current = edge\.id/);
  assert.match(jsx, /ignoreConnectionId: reconnectingEdgeId\.current/);
  assert.doesNotMatch(jsx, /onConnectStart=\{[^}]*reconnectingEdgeId\.current = null/);
  assert.match(jsx, /change\.type === "position"[\s\S]*change\.dragging !== true[\s\S]*actions\.moveNode/);
  assert.match(jsx, /change\.type === "select"[\s\S]*actions\.selectNode/);
  assert.match(jsx, /actions\.selectConnection\(change\.id\)/);
  assert.match(jsx, /if \(edge\.selected\) actions\.activateConnection\(edge\.id\)/);
  assert.match(jsx, /<button[\s\S]*mz-flow-port-action/);
  assert.match(jsx, /deleteKeyCode=\{\["Backspace", "Delete"\]\}/);
});

test("XYFlow output cleanup is confined to repository and temporary build roots", async () => {
  const { resolveShaderSynthXyflowOutputDirectory } = await import(
    "../scripts/build-shader-synth-xyflow.mjs"
  );
  const repositoryRoot = path.resolve(fileURLToPath(root));
  const repositoryOutput = path.join(repositoryRoot, "assets", "xyflow");
  const temporaryOutput = path.join(tmpdir(), "morphazoid-xyflow-test", "assets", "xyflow");
  const escapedOutput = path.join(
    path.parse(repositoryRoot).root,
    "morphazoid-xyflow-outside",
    "assets",
    "xyflow",
  );

  assert.equal(resolveShaderSynthXyflowOutputDirectory("assets/xyflow"), repositoryOutput);
  assert.equal(resolveShaderSynthXyflowOutputDirectory(temporaryOutput), path.resolve(temporaryOutput));
  assert.throws(
    () => resolveShaderSynthXyflowOutputDirectory(escapedOutput),
    /must stay inside the repository or temporary directory/,
  );
  assert.throws(
    () => resolveShaderSynthXyflowOutputDirectory(path.join(repositoryRoot, "dist")),
    /must end in assets\/xyflow/,
  );
});

test("XYFlow output cleanup rejects a linked assets directory before touching its target", async (context) => {
  const { validateShaderSynthXyflowOutputDirectory } = await import(
    "../scripts/build-shader-synth-xyflow.mjs"
  );
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "morphazoid-xyflow-link-"));
  const targetDirectory = path.join(temporaryRoot, "linked-target", "assets", "xyflow");
  const assetsDirectory = path.join(temporaryRoot, "build", "assets");
  const linkedOutput = path.join(assetsDirectory, "xyflow");
  const sentinel = path.join(targetDirectory, "keep.txt");
  try {
    await Promise.all([
      mkdir(targetDirectory, { recursive: true }),
      mkdir(assetsDirectory, { recursive: true }),
    ]);
    await writeFile(sentinel, "keep", "utf8");
    try {
      await symlink(targetDirectory, linkedOutput, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        context.skip(`directory links are unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      () => validateShaderSynthXyflowOutputDirectory(linkedOutput),
      /must not contain symbolic links or junctions/,
    );
    assert.equal(await readFile(sentinel, "utf8"), "keep");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("XYFlow authoring stays out of runtime copies and static builders own its output", async () => {
  const [manifestText, buildSite, releaseBuilder, waxBuilder, bundleBuilder, css] = await Promise.all([
    source("package.json"),
    source("scripts/build-site.sh"),
    source("scripts/build-release-site.mjs"),
    source("scripts/build-wax-site.mjs"),
    source("scripts/build-shader-synth-xyflow.mjs"),
    source("src/xyflow/shader-synth-playground-xyflow.css"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.deepEqual(
    Object.keys(manifest.dependencies).sort(),
    ["@xyflow/react", "react", "react-dom"],
  );
  assert.match(manifest.scripts.dev, /build:xyflow/);
  assert.match(manifest.scripts.verify, /check:xyflow/);
  assert.match(buildSite, /src\/xyflow\/\*/);
  assert.match(buildSite, /shader-synth-playground-bootstrap\.js/);
  assert.match(releaseBuilder, /buildShaderSynthXyflow/);
  assert.match(waxBuilder, /buildShaderSynthXyflow/);
  assert.match(bundleBuilder, /THIRD_PARTY_LICENSES\.txt/);
  assert.match(bundleBuilder, /from "esbuild-wasm"/);
  assert.doesNotMatch(bundleBuilder, /from "(?:vite|@vitejs\/plugin-react)"/);
  assert.match(bundleBuilder, /await rm\(realOutputDirectory, \{ recursive: true, force: true \}\)/);
  assert.match(bundleBuilder, /metafile: true/);
  assert.match(css, /data-graph-renderer="xyflow"/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /react-flow__pane,[\s\S]*touch-action: pan-y/);
});

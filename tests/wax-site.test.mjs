import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  addWaxLayer,
  injectWaxBootstrap,
  injectWaxUniversalAdapter,
  rewriteWaxHostedLinks,
  rewriteWaxAdapterImports,
  waxBootstrapPathFor,
  waxUniversalAdapterPathFor,
} from "../scripts/build-wax-site.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const waxSourceDirectory = path.join(repositoryRoot, "scripts", "wax");
const marker = "data-morphazoid-wax-bootstrap";
const adapterMarker = "data-morphazoid-wax-universal-adapter";

async function listSourceHtml(directory) {
  const excludedDirectories = new Set([".git", "dist", "dist-wax", "node_modules"]);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSourceHtml(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(entryPath);
  }
  return files;
}

test("WAX layer changes artifact copies without changing normal browser HTML", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "morphazoid-wax-test-"));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await mkdir(path.join(temporaryRoot, "morphazoidical"), { recursive: true });

  const rootHtml = `<!doctype html>
<html><head><meta charset="utf-8">
  <link rel="stylesheet" href="app.css">
  <script type="module" src="app.js"></script>
</head><body><a href="shape.html#play">Shape</a></body></html>`;
  const nestedHtml = `<!doctype html>
<html><head><meta charset='utf-8'>
  <script>window.beforeModule = true;</script>
  <script type="module" src="app.js"></script>
</head><body><img src="../artwork/example.webp"></body></html>`;
  const rootPath = path.join(temporaryRoot, "index.html");
  const nestedPath = path.join(temporaryRoot, "morphazoidical", "index.html");
  await Promise.all([
    writeFile(rootPath, rootHtml, "utf8"),
    writeFile(nestedPath, nestedHtml, "utf8"),
  ]);

  const result = await addWaxLayer(temporaryRoot, { waxSourceDirectory });
  assert.equal(result.htmlCount, 2);

  const transformedRoot = await readFile(rootPath, "utf8");
  const transformedNested = await readFile(nestedPath, "utf8");
  assert.match(
    transformedRoot,
    /<meta charset="utf-8">\n\s*<script src="wax\/wax-host-bootstrap\.js" data-morphazoid-wax-bootstrap><\/script>/,
  );
  assert.match(
    transformedNested,
    /<meta charset='utf-8'>\n\s*<script src="\.\.\/wax\/wax-host-bootstrap\.js" data-morphazoid-wax-bootstrap><\/script>/,
  );
  assert.ok(transformedRoot.indexOf(marker) < transformedRoot.indexOf("app.js"));
  assert.ok(transformedNested.indexOf(marker) < transformedNested.indexOf("window.beforeModule"));
  assert.match(
    transformedRoot,
    /<script type="module" src="wax\/wax-universal-adapter\.js" data-morphazoid-wax-universal-adapter><\/script>\n<\/body>/,
  );
  assert.match(
    transformedNested,
    /<script type="module" src="\.\.\/wax\/wax-universal-adapter\.js" data-morphazoid-wax-universal-adapter><\/script>\n<\/body>/,
  );
  assert.equal((transformedRoot.match(new RegExp(marker, "g")) || []).length, 1);
  assert.equal((transformedNested.match(new RegExp(marker, "g")) || []).length, 1);
  assert.equal((transformedRoot.match(new RegExp(adapterMarker, "g")) || []).length, 1);
  assert.doesNotMatch(transformedRoot, /<base\b/i);
  assert.match(transformedRoot, /href="shape\.html#play"/);
  assert.match(transformedNested, /src="\.\.\/artwork\/example\.webp"/);

  assert.equal(
    await readFile(path.join(temporaryRoot, "wax", "wax-host-bootstrap.js"), "utf8"),
    await readFile(path.join(waxSourceDirectory, "wax-host-bootstrap.js"), "utf8"),
  );
  assert.equal(
    await readFile(path.join(temporaryRoot, "wax", "wax-host-bridge.js"), "utf8"),
    await readFile(path.join(waxSourceDirectory, "wax-host-bridge.js"), "utf8"),
  );
  assert.equal(
    await readFile(path.join(temporaryRoot, "wax", "wax-universal-adapter.js"), "utf8"),
    rewriteWaxAdapterImports(
      await readFile(path.join(waxSourceDirectory, "wax-universal-adapter.js"), "utf8"),
    ),
  );
  assert.equal(
    await readFile(path.join(temporaryRoot, "wax", "wax-universal-adapter.css"), "utf8"),
    await readFile(path.join(waxSourceDirectory, "wax-universal-adapter.css"), "utf8"),
  );

  await addWaxLayer(temporaryRoot, { waxSourceDirectory });
  assert.equal(
    (await readFile(rootPath, "utf8")).match(new RegExp(marker, "g")).length,
    1,
    "running the WAX layer twice must not duplicate the bootstrap",
  );
  assert.equal(
    (await readFile(rootPath, "utf8")).match(new RegExp(adapterMarker, "g")).length,
    1,
    "running the WAX layer twice must not duplicate the universal adapter",
  );

  assert.equal(rootHtml.includes(marker), false);
  assert.equal(rootHtml.includes(adapterMarker), false);
  assert.equal(nestedHtml.includes(marker), false);
});

test("bootstrap path is relative to each artifact page", () => {
  const outputDirectory = path.join("/tmp", "morphazoid-wax-path-test");
  assert.equal(
    waxBootstrapPathFor(path.join(outputDirectory, "index.html"), outputDirectory),
    "wax/wax-host-bootstrap.js",
  );
  assert.equal(
    waxUniversalAdapterPathFor(path.join(outputDirectory, "index.html"), outputDirectory),
    "wax/wax-universal-adapter.js",
  );
  assert.equal(
    waxBootstrapPathFor(
      path.join(outputDirectory, "morphazoidical", "atlas.html"),
      outputDirectory,
    ),
    "../wax/wax-host-bootstrap.js",
  );
  assert.equal(
    waxUniversalAdapterPathFor(
      path.join(outputDirectory, "morphazoidical", "atlas.html"),
      outputDirectory,
    ),
    "../wax/wax-universal-adapter.js",
  );
});

test("injection falls back to the head and rejects documents without one", () => {
  const withoutCharset = "<!doctype html><html><head><title>WAX</title></head><body></body></html>";
  const injected = injectWaxBootstrap(withoutCharset, "wax/wax-host-bootstrap.js");
  assert.match(injected, /<head>\n\s*<script src="wax\/wax-host-bootstrap\.js"/);
  assert.throws(
    () => injectWaxBootstrap("<main>No document head</main>", "wax.js"),
    /without a <head>/,
  );
});

test("universal adapter injection requires a body and is idempotent", () => {
  const source = "<!doctype html><html><head></head><body><main>WAX</main></body></html>";
  const injected = injectWaxUniversalAdapter(source, "wax/wax-universal-adapter.js");
  assert.match(injected, /data-morphazoid-wax-universal-adapter/);
  assert.equal(injectWaxUniversalAdapter(injected, "ignored.js"), injected);
  assert.throws(
    () => injectWaxUniversalAdapter("<main>No body end</main>", "wax.js"),
    /without a <\/body>/,
  );
});

test("the copied adapter rewrites source-tree imports for the public artifact", () => {
  const source = 'import { x } from "../../src/example.js";';
  assert.equal(rewriteWaxAdapterImports(source), 'import { x } from "../src/example.js";');
  assert.throws(() => rewriteWaxAdapterImports(null), /source must be a string/);
});

test("WAX pages keep the deployed component catalog rooted beside the WAX site", () => {
  const outputDirectory = path.join("tmp", "public", "dist-wax");
  assert.equal(
    rewriteWaxHostedLinks(
      '<a href="storybook/">Design system</a>',
      path.join(outputDirectory, "index.html"),
      outputDirectory,
    ),
    '<a href="../storybook/">Design system</a>',
  );
  assert.equal(
    rewriteWaxHostedLinks(
      '<a href="storybook/">Design system</a>',
      path.join(outputDirectory, "nested", "index.html"),
      outputDirectory,
    ),
    '<a href="../../storybook/">Design system</a>',
  );
  assert.throws(
    () => rewriteWaxHostedLinks(null, "index.html", outputDirectory),
    /HTML source must be a string/,
  );
});

test("canonical source pages do not load the WAX-only bootstrap", async () => {
  const htmlFiles = await listSourceHtml(repositoryRoot);
  assert.ok(htmlFiles.length >= 85, "the check should cover the complete Morphazoid page set");
  for (const htmlPath of htmlFiles) {
    const relativePath = path.relative(repositoryRoot, htmlPath);
    const source = await readFile(htmlPath, "utf8");
    assert.equal(source.includes(marker), false, `${relativePath} must remain the normal browser page`);
    assert.equal(source.includes(adapterMarker), false, `${relativePath} must not load WAX MIDI routing`);
    assert.doesNotMatch(source, /wax-host-bootstrap\.js/);
  }
});

test("the site builder excludes committed generated artifacts", async () => {
  const buildScript = await readFile(
    path.join(repositoryRoot, "scripts", "build-site.sh"),
    "utf8",
  );
  assert.match(
    buildScript,
    /dist\/\*\|dist-wax\/\*/,
    "a tracked dist-wax tree must not be copied recursively into later builds",
  );
});

test("GitHub Pages deploys the freshly generated release tree", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github", "workflows", "pages.yml"),
    "utf8",
  );
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /run: npm run build:deploy/);
  assert.match(workflow, /npm run check:storybook-dist/);
  assert.match(workflow, /path: dist\b/);
  assert.match(workflow, /storybook\/iframe\.html/);
  assert.match(workflow, /storybook\/index\.json/);
});

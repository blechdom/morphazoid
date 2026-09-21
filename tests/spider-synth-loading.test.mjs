import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";
import { SPIDER_SPECIMENS } from "../src/instruments/spider-synth/spider-synth-specimens.js";
import { requireLoadedSpider, spiderModelStatus } from "../e2e/helpers/spider-readiness.mjs";

const app = await readFile(new URL("../src/instruments/spider-synth/spider-synth-app.js", import.meta.url), "utf8");
const tree = parse(app, { ecmaVersion: "latest", sourceType: "module" });
const declarations = [];
function walk(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && node.id.name === "assetBase") declarations.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") walk(value);
  }
}
walk(tree);
assert.equal(declarations.length, 1);
const initializer = app.slice(declarations[0].init.start, declarations[0].init.end);
const baseFromController = moduleUrl => vm.runInNewContext(
  initializer.replace("import.meta.url", "moduleUrl"), { URL, moduleUrl },
);

test("every specimen model and rig stay inside source, WAX and nested deployment roots", () => {
  for (const mount of ["/", "/dist-wax/", "/music/morphazoid/", "/music/morphazoid/dist-wax/"]) {
    const site = `https://example.test${mount}`;
    const moduleUrl = `${site}src/instruments/spider-synth/spider-synth-app.js?v=release`;
    const base = baseFromController(moduleUrl);
    for (const specimen of SPIDER_SPECIMENS) {
      for (const property of ["modelPath", "phoneModelPath", "rigPath"]) {
        const asset = specimen[property];
        const expected = new URL(asset.replace(/^(?:\.\.\/)+/, ""), site);
        const actual = new URL(asset, base);
        assert.equal(actual.href, expected.href, `${mount}/${specimen.id}/${property}`);
        const versioned = new URL(`${asset}?v=0123456789ab`, base);
        assert.equal(versioned.search, "?v=0123456789ab");
      }
    }
  }
});

test("the previous flat-src URL base demonstrably escaped a nested deployment", () => {
  const site = "https://example.test/music/morphazoid/";
  const moduleUrl = `${site}src/instruments/spider-synth/spider-synth-app.js`;
  const model = SPIDER_SPECIMENS[0].modelPath;
  assert.notEqual(new URL(model, new URL("../../", moduleUrl)).href, new URL(model, baseFromController(moduleUrl)).href);
});

test("the declared desktop/phone files and all 38-joint rig companions exist", async () => {
  const moduleUrl = new URL("../src/instruments/spider-synth/spider-synth-app.js", import.meta.url);
  for (const specimen of SPIDER_SPECIMENS) {
    for (const key of ["modelPath", "phoneModelPath"]) {
      const info = await stat(new URL(specimen[key], moduleUrl));
      assert.ok(info.isFile() && info.size > 1024 && info.size <= 16 * 1024 * 1024, `${specimen.id}/${key}`);
    }
    const rig = JSON.parse(await readFile(new URL(specimen.rigPath, moduleUrl), "utf8"));
    assert.equal(rig.joints.length, 38, specimen.id);
    assert.equal(rig.legs.length, 8, specimen.id);
  }
});

const ready = {
  initialized: true, loaded: true, loading: false, disposed: false,
  retryVisible: false, bones: 38, vertices: 53102, message: "", audioOn: false,
};
test("smoke acceptance requires loaded geometry, not a poster/loading/error state", () => {
  assert.doesNotThrow(() => requireLoadedSpider(ready));
  for (const patch of [
    { initialized: false }, { loading: true }, { loaded: false }, { disposed: true },
    { retryVisible: true }, { bones: 0 }, { bones: 31 }, { vertices: 0 },
  ]) assert.throws(() => requireLoadedSpider({ ...ready, ...patch }), /did not become ready/);
});

test("readiness diagnostic is read-only and can explain a failed or pending load", () => {
  let reads = 0;
  const win = { spiderSynth: { getState() {
    reads++;
    return { modelLoading: true, loaded: false, bones: [], skin: null, audioOn: false };
  } } };
  const doc = { getElementById(id) {
    return id === "modelStatus" ? { textContent: " Loading the spider… " } : { hidden: true };
  } };
  assert.deepEqual(spiderModelStatus(win, doc), {
    initialized: true, loading: true, loaded: false, disposed: false,
    bones: 0, vertices: 0, audioOn: false, retryVisible: false, message: "Loading the spider…",
  });
  assert.equal(reads, 1);
});

test("smoke keeps aborted-download diagnostics and attaches actual model-load evidence", async () => {
  const smoke = await readFile(new URL("../e2e/site-smoke.spec.mjs", import.meta.url), "utf8");
  const diagnostics = await readFile(new URL("../e2e/helpers/diagnostics.mjs", import.meta.url), "utf8");
  assert.match(smoke, /requireLoadedSpider\(status\)/);
  assert.match(smoke, /spider-model-loading\.json/);
  assert.match(diagnostics, /requestFailures\.push/);
  assert.doesNotMatch(diagnostics, /ERR_ABORTED/);
});

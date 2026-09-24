import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { rewriteModulePaths, rewriteRepositoryPaths, relocateReference } from "../scripts/architecture/module-paths.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { restoreShapesSoundBanks, shapesSoundBankChanges as shapeBankChanges } from "./helpers/shapes-sound-banks-reference.mjs";
import { restorePointerExtraction } from "./helpers/pointer-extraction-reference.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const plan = JSON.parse(await readFile(new URL("../docs/source-module-layout.json", import.meta.url)));
const siteMoves = JSON.parse(await readFile(new URL("../docs/site-metadata-layout.json", import.meta.url))).moves;
const proof = JSON.parse(await readFile(new URL("fixtures/module-hierarchy-runtime.json", import.meta.url)));
const ioChanges = JSON.parse(await readFile(new URL("../docs/io-settings-runtime-changes.json", import.meta.url))).changes;
const iphoneChanges = JSON.parse(await readFile(new URL("../docs/iphone-audio-runtime-changes.json", import.meta.url))).changes;
const shapesChanges = JSON.parse(await readFile(new URL("../docs/shapes-manual-notes-runtime-changes.json", import.meta.url))).changes;
const automataChanges = JSON.parse(await readFile(new URL("../docs/automatapoeia-preset-lifecycle-runtime-changes.json", import.meta.url))).changes;
const automataBottomChanges = JSON.parse(await readFile(new URL("../docs/automatapoeia-bottom-entry-runtime-changes.json", import.meta.url))).changes;
const automataTransportChanges = JSON.parse(await readFile(new URL("../docs/automatapoeia-live-transport-runtime-changes.json", import.meta.url))).changes;
const automataClockChanges = JSON.parse(await readFile(new URL("../docs/automatapoeia-audio-clock-runtime-changes.json", import.meta.url))).changes;
const pugglerChanges = JSON.parse(await readFile(new URL("../docs/puggler-expansion-runtime-changes.json", import.meta.url))).changes;
const inverse = Object.fromEntries(Object.entries({ ...plan.moves, ...siteMoves }).map(([before, after]) => [after, before]));
const sha = value => createHash("sha256").update(value).digest("hex");

test("all relocated instrument modules have one owner and explicit release inclusion", async () => {
  const inventory = await readRuntimeManifest();
  assert.equal(new Set(Object.values(plan.moves)).size, Object.keys(plan.moves).length);
  for (const [before, after] of Object.entries(plan.moves)) {
    assert.match(after, /^src\/(?:instruments|families)\/[^/]+\//);
    assert.equal(existsSync(path.join(root, before)), false, before);
    assert.ok((await stat(path.join(root, after))).isFile(), after);
    assert.ok(inventory.worktreeFiles.includes(after), `pre-commit build inclusion: ${after}`);
  }
  for (const file of plan.retainedSharedModules) assert.ok((await stat(path.join(root, siteMoves[file] ?? file))).isFile(), file);
});

test("runtime modules reverse exactly after explicit runtime fixes and documented feature amendments", async () => {
  assert.deepEqual(plan.reviewedRuntimeFixes.map(fix => fix.file), [
    "src/instruments/shepard-risset/shepard-risset-app.js",
    "src/instruments/spider-synth/spider-synth-app.js",
    "src/instruments/spider-synth/spider-synth-viewer.js",
    "src/families/proto-graph/proto-shell.js",
  ]);
  for (const record of proof.files) {
    let current = await readFile(path.join(root, record.after), "utf8");
    for (const change of shapeBankChanges.filter(change => change.file === record.after)) {
      for (const testFile of change.regressionTests) assert.ok(existsSync(path.join(root, testFile)), testFile);
    }
    current = restorePointerExtraction(restoreShapesSoundBanks(current, record.after), record.after);
    for (const change of pugglerChanges.filter(change => change.file === record.after)) {
      for (const testFile of change.regressionTests) assert.ok(existsSync(path.join(root, testFile)), testFile);
      for (const replacement of [...change.replacements].reverse()) {
        assert.equal(current.split(replacement.after).length - 1, 1, `exactly one Puggler expansion edit: ${change.file}`);
        current = current.replace(replacement.after, replacement.before);
      }
    }
    for (const change of iphoneChanges.filter(change => change.file === record.after)) {
      for (const testFile of change.regressionTests) assert.ok(existsSync(path.join(root, testFile)), testFile);
      for (const replacement of [...change.replacements].reverse()) {
        assert.equal(current.split(replacement.after).length - 1, 1, `exactly one iPhone startup edit: ${change.file}`);
        current = current.replace(replacement.after, replacement.before);
      }
    }
    // Keep the relocation baseline frozen. Reverse only the exact, separately
    // documented feature edits, whose behavior has focused DSP/browser tests.
    for (const change of [...ioChanges, ...shapesChanges, ...automataBottomChanges, ...automataTransportChanges, ...automataClockChanges, ...automataChanges].filter(change => change.file === record.after)) {
      for (const testFile of change.regressionTests) assert.ok(existsSync(path.join(root, testFile)), testFile);
      for (const replacement of [...change.replacements].reverse()) {
        assert.equal(current.split(replacement.after).length - 1, 1, `exactly one documented feature edit: ${change.file}`);
        current = current.replace(replacement.after, replacement.before);
      }
    }
    for (const fix of plan.reviewedRuntimeFixes.filter(fix => fix.file === record.after)) {
      assert.equal(current.split(fix.after).length - 1, 1, `exactly one reviewed fix: ${fix.file}`);
      assert.ok(existsSync(path.join(root, fix.regressionTest)), fix.regressionTest);
      current = current.replace(fix.after, fix.before);
    }
    const restored = rewriteRepositoryPaths(rewriteModulePaths(current, record.after, inverse), inverse);
    assert.equal(sha(restored), record.sha256, record.after);
  }
});

test("Automatapoeia preset lifecycle amendment is limited to its controller with regression evidence", () => {
  assert.deepEqual(automataChanges.map(change => change.file), ["src/families/experiments/experiments-app.js"]);
  assert.deepEqual(automataChanges[0].regressionTests, [
    "tests/automatapoeia-preset-lifecycle.test.mjs", "e2e/automatapoeia-preset-lifecycle.spec.mjs",
  ]);
  assert.ok(automataChanges[0].replacements.length > 0);
});

test("iPhone amendments are scoped to the four startup controllers, with regression evidence", () => {
  assert.deepEqual(iphoneChanges.map(change => change.file).sort(), [
    "src/families/syrinx/syrinx-app.js",
    "src/instruments/julie-saw/julie-saw-app.js",
    "src/instruments/morphynx/morphynx-app.js",
    "src/instruments/shapes/shapes-app.js",
  ]);
  for (const change of iphoneChanges) {
    assert.ok(proof.files.some(record => record.after === change.file));
    assert.match(change.reason, /iPhone/);
    assert.ok(change.replacements.length > 0);
    assert.deepEqual(change.regressionTests, ["tests/audio-startup.test.mjs", "e2e/iphone-audio-startup.spec.mjs"]);
  }
});
test("stereo-input amendments identify existing modules and focused regression evidence", () => {
  assert.equal(new Set(ioChanges.map(change => change.file)).size, ioChanges.length);
  for (const change of ioChanges) {
    assert.ok(proof.files.some(record => record.after === change.file), change.file);
    assert.match(change.reason, /stereo/);
    assert.ok(change.replacements.length > 0, change.file);
    assert.deepEqual(change.regressionTests, ["tests/stereo-audio-input.test.mjs", "e2e/io-settings.spec.mjs"]);
  }
});

test("Shapes manual-audio amendments preserve the frozen baseline and name their regression evidence", () => {
  const expected = [
    ["src/instruments/shapes/shapes-app.js", 16, [
      "tests/audio.test.mjs", "tests/synth-processor.test.mjs",
      "e2e/shapes-manual-notes.spec.mjs", "e2e/shapes-manual-motion.spec.mjs", "e2e/shapes-4d-drag.spec.mjs",
      "tests/shapes-stage-gestures.test.mjs", "e2e/shapes-3d-drag.spec.mjs",
    ]],
    ["src/instruments/fm-drums/fm-drums.js", 2, ["tests/fm-drums.test.mjs", "e2e/shapes-manual-motion.spec.mjs"]],
    ["src/instruments/linear-drums/linear-drums.js", 4, ["tests/linear-drums.test.mjs", "e2e/shapes-manual-motion.spec.mjs"]],
    ["src/instruments/shapes/original-audio.js", 2, [
      "tests/shapes-subdivision-cache.test.mjs", "tests/shapes-full-presets.test.mjs",
      "e2e/shapes-high-divisions.spec.mjs",
    ]],
    ["src/instruments/shapes/shapes-state.js", 1, [
      "tests/shapes-starter-sounds.test.mjs", "tests/shapes-full-presets.test.mjs",
      "tests/synth-processor.test.mjs", "e2e/shapes-waveforms.spec.mjs",
    ]],
    ["src/instruments/shapes/full-presets.js", 5, [
      "tests/shapes-starter-sounds.test.mjs", "tests/shapes-full-presets.test.mjs",
      "tests/synth-processor.test.mjs", "e2e/shapes-waveforms.spec.mjs",
    ]],
    ["src/instruments/shapes/mode-presets.js", 2, [
      "tests/shapes-starter-sounds.test.mjs", "tests/shapes-full-presets.test.mjs",
      "tests/synth-processor.test.mjs", "e2e/shapes-waveforms.spec.mjs",
    ]],
  ];
  assert.deepEqual(shapesChanges.map(change => change.file), expected.map(([file]) => file));
  for (const [index, change] of shapesChanges.entries()) {
    assert.ok(proof.files.some(record => record.after === change.file), change.file);
    assert.match(change.reason, /manual/);
    assert.equal(change.replacements.length, expected[index][1]);
    assert.deepEqual(change.regressionTests, expected[index][2]);
  }
});

test("path rewriting preserves queries, templates, resources and non-path slash characters", () => {
  const moves = { "src/voice.js": "src/instruments/example/voice.js" };
  const exists = file => ["src/voice.js", "assets/samples/", "src/audio.js"].includes(file);
  assert.equal(relocateReference("../src/voice.js?v=123", "tests/example.test.mjs", moves, { exists }), "../src/instruments/example/voice.js?v=123");
  assert.equal(rewriteModulePaths("import(`../src/voice.js?test=${Date.now()}`)", "tests/a.mjs", moves, { exists }),
    "import(`../src/instruments/example/voice.js?test=${Date.now()}`)");
  assert.equal(rewriteModulePaths("new URL(`../assets/samples/${id}.wav`, import.meta.url)", "src/voice.js", moves, { exists }),
    "new URL(`../../../assets/samples/${id}.wav`, import.meta.url)");
  assert.equal(rewriteModulePaths('const key = "/"; const text = `/${id}/`;', "src/voice.js", moves, { exists }),
    'const key = "/"; const text = `/${id}/`;');
  assert.equal(relocateReference("./audio.js", "src/voice.js", moves, { exists }), "../../audio.js");
});

test("Puggler expansion amendments are limited to its seven existing feature owners (including the shared-controls redesign)", () => {
  assert.deepEqual(pugglerChanges.map(change => change.file).sort(), [
    "puggler-app.js", "puggler-audio.js", "puggler-controls.js", "puggler-lighting.js", "puggler-presets.js", "puggler-renderer.js", "puggler.js",
  ].map(file => `src/instruments/puggler/${file}`));
  for (const change of pugglerChanges) {
    assert.ok(proof.files.some(record => record.after === change.file));
    assert.ok(change.replacements.length > 0);
    assert.ok(change.regressionTests.includes("e2e/puggler-expansion.spec.mjs"));
    assert.ok(change.regressionTests.includes("tests/puggler-audio.test.mjs"));
  }
});

test("Shapes bank amendments stay scoped and preserve all frozen relocation records", () => {
  assert.deepEqual(shapeBankChanges.map(change => change.file), [
    "src/instruments/rubix/rubix-app.js", "src/instruments/shapes/full-presets.js",
    "src/instruments/shapes/mode-presets.js", "src/instruments/shapes/shapes-app.js",
    "src/instruments/shapes/shapes-state.js",
  ]);
  for (const change of shapeBankChanges) {
    assert.ok(proof.files.some(record => record.after === change.file));
    assert.ok(change.replacements.length);
    assert.ok(change.regressionTests.includes("e2e/shapes-sound-banks.spec.mjs"));
  }
});

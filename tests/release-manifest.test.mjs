import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  defaultManifest, parseRuntimeManifest, readRuntimeManifest,
} from "../scripts/site/runtime-manifest.mjs";
import {
  createSiteBuilderHarness, fileHashes, historicalManifest, legacyBuilderInventory,
} from "./helpers/site-builder-harness.mjs";

test("manifest policies keep pre-commit copying separate from required artifact files", () => {
  const inventory = parseRuntimeManifest([
    "# One declaration per path", "",
    "copy\tassets/optional.bin",
    "require\tsrc/tracked.js",
    "copy+require\tsrc/new/controller.js",
  ].join("\r\n"));
  assert.deepEqual(inventory.worktreeFiles, ["assets/optional.bin", "src/new/controller.js"]);
  assert.deepEqual(inventory.requiredFiles, ["src/tracked.js", "src/new/controller.js"]);
  assert.deepEqual(inventory.entries.map(({ copy, required }) => ({ copy, required })), [
    { copy: true, required: false }, { copy: false, required: true }, { copy: true, required: true },
  ]);
  assert.ok(Object.isFrozen(inventory));
  assert.ok(Object.isFrozen(inventory.entries) && inventory.entries.every(Object.isFrozen));
  assert.ok(Object.isFrozen(inventory.worktreeFiles) && Object.isFrozen(inventory.requiredFiles));
});

test("manifest parser accepts literal spaces/unicode without treating paths as shell expressions", () => {
  const file = 'assets/échantillons/$(touch nope) "quoted".wav';
  assert.equal(parseRuntimeManifest(`copy\t${file}\n`).entries[0].path, file);
});

test("manifest rejects malformed policies, duplicate paths and path escapes with line diagnostics", () => {
  for (const invalid of [
    "", "# comments only\n", "bogus\tfile.js", "copy file.js", "copy\tfile.js\textra",
    "copy\t", "copy\t/file.js", "copy\t../file.js", "copy\ta/../file.js",
    "copy\t./file.js", "copy\ta//file.js", "copy\ta/", "copy\tC:/file.js",
    "copy\ta\\file.js", "copy\ta\0b.js", "copy\t file.js", "copy\tfile.js ",
    "copy\tfile.js\nrequire\tfile.js",
  ]) {
    assert.throws(() => parseRuntimeManifest(invalid), Error, JSON.stringify(invalid));
  }
  assert.throws(() => parseRuntimeManifest("# comment\ncopy\t../oops", "fixture.tsv"),
    /fixture\.tsv:2: invalid repository-relative path/);
  assert.throws(() => parseRuntimeManifest(null), TypeError);
});

test("the live inventory is explicit, nonempty and parseable independently of the browser", async () => {
  const text = await readFile(defaultManifest, "utf8");
  const inventory = await readRuntimeManifest();
  assert.deepEqual(inventory, parseRuntimeManifest(text, String(defaultManifest)));
  assert.ok(inventory.worktreeFiles.length > 0 && inventory.requiredFiles.length > 0);
  assert.equal(new Set(inventory.entries.map(entry => entry.path)).size, inventory.entries.length);
});

test("historical manifest encodes all original permissions and preserves requirement order", async () => {
  const legacy = await legacyBuilderInventory();
  const inventory = parseRuntimeManifest(historicalManifest(legacy));
  assert.deepEqual(inventory.requiredFiles, legacy.required);
  assert.deepEqual([...inventory.worktreeFiles].sort(), [...legacy.copy].sort());
});

test("the manifest CLI validates all input before emitting shell records", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "morphazoid-manifest-cli-"));
  const file = path.join(directory, "bad.tsv");
  try {
    await writeFile(file, "copy\tvalid.js\ninvalid\tother.js\n");
    assert.throws(() => execFileSync(process.execPath, [
      fileURLToPath(new URL("../scripts/site/runtime-manifest.mjs", import.meta.url)), file,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), error => {
      assert.notEqual(error.status, 0);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /unknown policy "invalid"/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("new and frozen builders publish identical fixture bytes, including nested files and asset globs", async () => {
  const fixture = await createSiteBuilderHarness();
  try {
    const before = await fixture.build("legacy");
    const after = await fixture.build("current");
    assert.equal(before.code, 0, before.stderr);
    assert.equal(after.code, 0, after.stderr);
    const expected = await fileHashes(before.output);
    const actual = await fileHashes(after.output);
    assert.deepEqual(actual, expected);
    for (const file of [
      "src/nested/new-controller.js", "src/spider-synth-audio.js",
      "assets/authors/kristin-galvin.png", "assets/instruments/untracked-review.webp",
      "assets/spider-synth/skins/untracked/model.glb", "assets/audio/spider-synth/untracked.wav",
    ]) assert.ok(actual[file], file);
    for (const file of [
      "untracked-not-allowlisted.js", "assets/spider-synth/skins/untracked/unsupported.bin",
      "src/xyflow/private.js", "scripts/private.js", "tests/private.js", ".github/private.js",
      "README.md", "package.json", "scripts/site/runtime-files.tsv",
    ]) assert.equal(actual[file], undefined, file);
    assert.equal(actual["src/spider-synth-world.js"], undefined, "an absent optional file stays optional");
  } finally {
    await fixture.cleanup();
  }
});

for (const scenario of [
  { name: "require-only entries do not gain explicit untracked-copy permission", untrackedRequired: ["src/audio.js"], missing: "src/audio.js" },
  { name: "missing copy-and-require files retain the original build failure", absent: ["spider-synth.html"], missing: "spider-synth.html" },
]) {
  test(scenario.name, async () => {
    const fixture = await createSiteBuilderHarness(scenario);
    try {
      const before = await fixture.build("legacy");
      const after = await fixture.build("current");
      assert.equal(before.code, 1, before.stderr);
      assert.equal(after.code, before.code);
      assert.equal(after.stderr, before.stderr);
      assert.ok(after.stderr.includes(`Missing required runtime file: ${scenario.missing}`));
    } finally {
      await fixture.cleanup();
    }
  });
}

test("invalid manifest aborts the shell build before replacing an existing artifact", async () => {
  const fixture = await createSiteBuilderHarness();
  try {
    await fixture.write("scripts/site/runtime-files.tsv", "copy\t../escape.js\n");
    await fixture.write("existing/keep.txt", "keep this artifact");
    const result = await fixture.build("current", "existing");
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /invalid repository-relative path/);
    assert.equal(await readFile(path.join(result.output, "keep.txt"), "utf8"), "keep this artifact");
  } finally {
    await fixture.cleanup();
  }
});

test("the shell copies space/unicode filenames literally without evaluating their contents", async () => {
  const fixture = await createSiteBuilderHarness();
  try {
    const file = 'assets/échantillons/$(touch nope) "quoted".wav';
    await fixture.write(file, "literal sound bytes");
    await fixture.write("scripts/site/runtime-files.tsv",
      historicalManifest(fixture.legacy) + `copy+require\t${file}\n`);
    const result = await fixture.build("current");
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(path.join(result.output, file), "utf8"), "literal sound bytes");
    await assert.rejects(readFile(path.join(fixture.directory, "nope")), { code: "ENOENT" });
  } finally {
    await fixture.cleanup();
  }
});

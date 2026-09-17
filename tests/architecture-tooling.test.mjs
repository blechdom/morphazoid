import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import configuration from "../scripts/architecture/dependency-cruiser.config.mjs";
import { architectureCommand, runtimeEntries } from "../scripts/architecture/report.mjs";

test("architecture entries include root browser modules and nested runtime source, not test configuration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "morphazoid-architecture-"));
  try {
    await Promise.all(["z-app.js", "app.js", "nav.js", "playwright.config.mjs", "package.json"]
      .map((name) => writeFile(path.join(root, name), "")));
    assert.deepEqual(await runtimeEntries(root), ["app.js", "nav.js", "z-app.js", "src", "morphazoidical"]);
    const duplicates = await architectureCommand("duplicates", root);
    assert.equal(duplicates.output, path.join(root, "test-results", "architecture"));
    assert.ok(duplicates.args.includes("--fail-on-empty"));
    for (const option of ["--exit-code", "--threshold", "--update-baseline", "--fail-on-new-clones"]) {
      assert.equal(duplicates.args.includes(option), false, option);
    }
    const dependencies = await architectureCommand("dependencies", root);
    assert.ok(dependencies.args.includes(path.join(root, "test-results", "architecture", "dependencies.json")));
    await assert.rejects(architectureCommand("delete", root), /Usage:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency findings are advisory and AssemblyScript is not parsed as browser TypeScript", () => {
  assert.ok(configuration.forbidden.length > 0);
  assert.ok(configuration.forbidden.every((rule) => rule.severity === "warn"));
  const excluded = new RegExp(configuration.options.exclude.path);
  assert.ok(excluded.test("src/simd-resonator-scalar.ts"));
  assert.ok(excluded.test("morphazoidical/tests/runtime.test.mjs"));
  assert.equal(excluded.test("src/instruments/example/controller.js"), false);
  const boundary = configuration.forbidden.find((rule) => rule.name.startsWith("shared-ui"));
  assert.ok(new RegExp(boundary.from.path).test("src/ui/primitives/button.js"));
  assert.ok(new RegExp(boundary.to.path).test("src/audio.js"));
  assert.ok(new RegExp(boundary.to.path).test("solid-app.js"));
  assert.equal(new RegExp(boundary.to.path).test("src/ui/primitives/button.js"), false);
});

test("duplication reporting excludes generated and third-party material without ignoring identifiers or literals", async () => {
  const config = JSON.parse(await readFile(new URL("../scripts/architecture/jscpd.json", import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  for (const name of ["dependency-cruiser", "jscpd"]) {
    assert.match(manifest.devDependencies[name], /^\d+\.\d+\.\d+$/, `${name} must be pinned`);
    assert.equal(Object.hasOwn(manifest.dependencies, name), false, `${name} must not be a runtime dependency`);
  }
  for (const directory of ["dist", "dist-wax", "vendor", "node_modules", "assets", "artwork", "tests", "e2e"]) {
    assert.ok(config.ignore.includes(`**/${directory}/**`), directory);
  }
  assert.equal(config.mode, "weak");
  assert.equal(config.ignoreIdentifiers, undefined);
  assert.equal(config.ignoreLiterals, undefined);
  assert.equal(config.threshold, undefined);
  assert.equal(config.exitCode, undefined);
});

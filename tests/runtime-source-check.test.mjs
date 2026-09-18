import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkSyntaxFile, runtimeSourceFiles } from "../scripts/check-runtime-source.mjs";

test("syntax discovery includes nested families and tools without parsing AssemblyScript, JSX, or vendor output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "morphazoid-syntax-scope-"));
  try {
    const paths = [
      "src/instruments/lumber/lumber-app.js", "src/families/tract/geometry.js", "src/graphics/canvas-sizing.js",
      "scripts/architecture/report.mjs", "scripts/wax/bridge.js", "morphazoidical/app.js",
      "src/simd-resonator-scalar.ts", "src/xyflow/graph.jsx", "vendor/library.js",
      "dist-wax/app.js", "tests/example.test.mjs", "morphazoidical/tests/example.test.mjs",
    ];
    for (const name of paths) {
      const target = path.join(root, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "");
    }
    const discovered = await runtimeSourceFiles(root);
    for (const name of paths.slice(0, 6)) assert.ok(discovered.includes(name), name);
    for (const name of paths.slice(6)) assert.equal(discovered.includes(name), false, name);
    // Required entry points are checked even when missing, not silently omitted.
    for (const name of ["src/instruments/shape-synth/shape-synth-app.js", "nav.js", "wax-page.js", "shader-synth-playground-bootstrap.js"]) {
      assert.ok(discovered.includes(name), name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syntax checking parses but does not execute browser code, and rejects invalid or missing files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "morphazoid-syntax-parse-"));
  try {
    await writeFile(path.join(root, "valid.js"), 'throw new Error("This must never execute");\n');
    await writeFile(path.join(root, "invalid.js"), "const = ;\n");
    assert.equal((await checkSyntaxFile("valid.js", root)).ok, true);
    assert.equal((await checkSyntaxFile("invalid.js", root)).ok, false);
    assert.equal((await checkSyntaxFile("missing.js", root)).ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

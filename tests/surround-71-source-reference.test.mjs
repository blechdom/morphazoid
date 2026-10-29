import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { restoreSurround71Source, surround71SourceChanges } from "./helpers/surround-71-source-reference.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const root = new URL("../", import.meta.url);

test("7.1 shared-source additions reverse exactly to fresh main without hiding drift", async () => {
  assert.deepEqual(surround71SourceChanges.map(({ file }) => file), [
    "README.md", "src/pages/spartial.html", "src/pages/surround-field.html",
    "src/pages/simd-resonator-rust.html", "src/instruments/spartial/spartial.css",
    "src/instruments/surround-field/surround-field.css",
    "src/instruments/simd-resonator-rust/surround-output.js",
    "docs/spartial.md", "docs/simd-resonator-rust.md",
    "src/instruments/surround-field/surround-field.js",
  ]);
  for (const change of surround71SourceChanges) {
    const source = await readFile(new URL(change.file, root), "utf8");
    assert.equal(hash(source), change.afterSha256, `${change.file}: reviewed 7.1 source`);
    const restored = restoreSurround71Source(source, change.file);
    assert.equal(hash(restored), change.beforeSha256, `${change.file}: untouched main source`);
    assert.equal(restoreSurround71Source(restored, change.file, { allowRestored: true }), restored);
    assert.throws(() => restoreSurround71Source(restored, change.file), /exact 7\.1 surround source amendment/);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreSurround71Source(source.replace(after, ""), change.file),
        /exact 7\.1 surround source amendment/);
      assert.throws(() => restoreSurround71Source(source + after, change.file),
        /exact 7\.1 surround source amendment/);
    }
    const drift = "\n// unrelated change\n";
    assert.equal(restoreSurround71Source(source + drift, change.file), restored + drift);
    assert.notEqual(hash(restored + drift), change.beforeSha256);
  }
  const binary = Buffer.from("raw bytes");
  assert.equal(restoreSurround71Source(binary, "README.md"), binary);
  assert.equal(restoreSurround71Source("untouched", "unrelated.js"), "untouched");
});

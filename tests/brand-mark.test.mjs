import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("header brand marks reuse the geometric tab icon", async () => {
  const [favicon, instrumentCss, workbenchCss] = await Promise.all([
    readFile(new URL("favicon.svg", root), "utf8"),
    readFile(new URL("style.css", root), "utf8"),
    readFile(new URL("morphazoidical/style.css", root), "utf8"),
  ]);

  // Tesseract projection: an outer cube (12 edges), an inner cube (12 edges),
  // and the connecting edges between their corresponding vertices (8 edges),
  // each drawn in their own stroke color rather than labeled by comment.
  assert.equal((favicon.match(/stroke="#00ffb2"/g) ?? []).length, 20, "outer cube edges + vertex markers");
  assert.equal((favicon.match(/stroke="#00e5ff"/g) ?? []).length, 20, "inner cube edges + vertex markers");
  assert.equal((favicon.match(/stroke="#b85dff"/g) ?? []).length, 8, "connecting (4th-dimension) edges");
  assert.match(instrumentCss, /\.brand-mark\s*\{[\s\S]*?background:\s*url\("favicon\.svg"\)\s+center\s*\/\s*contain\s+no-repeat/);
  assert.match(instrumentCss, /\.brand-mark i\s*\{[\s\S]*?display:\s*none/);
  assert.match(workbenchCss, /\.brand-glyph\s*\{[\s\S]*?background:\s*url\("\.\.\/favicon\.svg"\)\s+center\s*\/\s*175%\s+no-repeat/);
  assert.match(workbenchCss, /\.brand-glyph i\s*\{[\s\S]*?display:\s*none/);
});

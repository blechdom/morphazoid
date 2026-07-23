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

  assert.match(favicon, /Outer cube edges/);
  assert.match(favicon, /Inner cube edges/);
  assert.match(favicon, /Connecting edges \(4th dimension\)/);
  assert.match(instrumentCss, /\.brand-mark\s*\{[\s\S]*?background:\s*url\("favicon\.svg"\)\s+center\s*\/\s*175%\s+no-repeat/);
  assert.match(instrumentCss, /\.brand-mark i\s*\{[\s\S]*?display:\s*none/);
  assert.match(workbenchCss, /\.brand-glyph\s*\{[\s\S]*?background:\s*url\("\.\.\/favicon\.svg"\)\s+center\s*\/\s*175%\s+no-repeat/);
  assert.match(workbenchCss, /\.brand-glyph i\s*\{[\s\S]*?display:\s*none/);
});

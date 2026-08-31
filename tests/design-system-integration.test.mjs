import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the production stylesheet consumes the shared design tokens", async () => {
  const [style, entrypoint, foundations] = await Promise.all([
    readProjectFile("style.css"),
    readProjectFile("src/ui/index.css"),
    readProjectFile("src/ui/foundations/foundations.css"),
  ]);

  assert.match(style, /^@import url\("\.\/src\/ui\/index\.css"\);/);
  assert.match(style, /--bg: var\(--mz-color-bg\);/);
  assert.match(style, /--ink: var\(--mz-color-ink\);/);
  assert.match(style, /--mono: var\(--mz-font-mono\);/);
  assert.match(entrypoint, /foundations\/tokens\.css/);
  assert.match(entrypoint, /primitives\/range-field\.css/);
  assert.match(entrypoint, /patterns\/amplitude-control\.css/);
  assert.match(foundations, /prefers-reduced-motion:[\s\S]*animation: none !important;/);
});

test("the physics instrument family renders controls with shared factories", async () => {
  const source = await readProjectFile("physics-app.js");

  assert.match(source, /from "\.\/src\/ui\/index\.js";/);
  assert.match(source, /return createRangeField\(\{/);
  assert.match(source, /return createSelectField\(\{/);
  assert.match(source, /return createChoiceSwitch\(\{/);
  assert.doesNotMatch(source, /document\.createElement\("select"\)/);
});

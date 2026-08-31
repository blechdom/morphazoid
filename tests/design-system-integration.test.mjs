import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the production stylesheet consumes the shared design tokens and controls", async () => {
  const [style, entrypoint, foundations, buttons, choices] = await Promise.all([
    readProjectFile("style.css"),
    readProjectFile("src/ui/index.css"),
    readProjectFile("src/ui/foundations/foundations.css"),
    readProjectFile("src/ui/primitives/button.css"),
    readProjectFile("src/ui/primitives/choice-switch.css"),
  ]);

  assert.match(style, /^@import url\("\.\/src\/ui\/index\.css"\);/);
  assert.match(style, /--bg: var\(--mz-color-bg\);/);
  assert.match(style, /--ink: var\(--mz-color-ink\);/);
  assert.match(style, /--mono: var\(--mz-font-mono\);/);
  assert.match(entrypoint, /foundations\/tokens\.css/);
  assert.match(entrypoint, /primitives\/field\.css/);
  assert.match(entrypoint, /primitives\/range-field\.css/);
  assert.match(entrypoint, /patterns\/audio-strip\.css/);
  assert.match(entrypoint, /patterns\/amplitude-control\.css/);
  assert.match(foundations, /prefers-reduced-motion:[\s\S]*animation: none !important;/);
  assert.doesNotMatch(
    style,
    /\.audio-button,\s*\.play-button,\s*\.direction-toggle,[\s\S]*?\.mini-action\s*\{/,
    "late legacy rules must not override shared button geometry",
  );
  assert.match(buttons, /\.mini-action,\s*\.mz-button--mini\s*\{/);
  assert.match(buttons, /\.reset-all-button,\s*\.mz-button--reset\s*\{/);
  assert.match(buttons, /@media \(pointer: coarse\)[\s\S]*--audio-control-width: 48px;/);
  assert.match(choices, /\.choice-switch\.compact button,[\s\S]*?font-size: var\(--mz-font-size-xs\);/);
  assert.doesNotMatch(choices, /\.choice-switch\.compact[^{]*\{[^}]*min-height:/s);
});

test("the physics instrument family renders controls with shared factories", async () => {
  const source = await readProjectFile("physics-app.js");

  assert.match(source, /from "\.\/src\/ui\/index\.js";/);
  assert.match(source, /return createRangeField\(\{/);
  assert.match(source, /return createSelectField\(\{/);
  assert.match(source, /return createChoiceSwitch\(\{/);
  assert.doesNotMatch(source, /document\.createElement\("select"\)/);
});

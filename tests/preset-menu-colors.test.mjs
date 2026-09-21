import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../style.css", import.meta.url), "utf8");

// Check the authored shared style contract. Actual computed colors (including
// browser defaults and instrument themes) are covered by the browser spec.
function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`, "u"));
  assert.ok(match, `Missing shared rule: ${selector}`);
  return match[1];
}

test("preset buttons and Choose links explicitly share neutral row paint", () => {
  const row = ruleFor(".instrument-picker-link");
  assert.match(row, /\bappearance:\s*none;/);
  assert.match(row, /\bbackground:\s*transparent;/);
  assert.match(row, /\bborder:\s*0;/);
  assert.match(row, /\bborder-radius:\s*0;/);
  assert.match(row, /\bbox-shadow:\s*none;/);
  assert.match(row, /\bcolor:\s*color-mix\(in oklab, var\(--ink\) 76%, var\(--muted\)\);/);
  assert.match(ruleFor(".instrument-picker-panel"), /\bbackground:\s*var\(--bg-deep\);/);
  assert.doesNotMatch(ruleFor(".header-preset-picker .instrument-picker-link"), /\b(?:background|color|opacity):/);
});

test("selected preset, current instrument and hover use one shared accent rule", () => {
  assert.match(css,
    /\.instrument-picker-link:hover,\s*\.instrument-picker-link\[aria-current="page"\],\s*\.instrument-picker-link\[aria-pressed="true"\]\s*\{[^}]*color:\s*var\(--accent\);[^}]*background:\s*color-mix\(in oklab, var\(--accent\) 5%, transparent\);/s);
  assert.doesNotMatch(css, /\.header-preset-picker \.instrument-picker-link\[aria-pressed="true"\]\s*\{/);
});

test("both next controls use the Choose surface rather than native button chrome", () => {
  const next = ruleFor(".instrument-picker-next");
  const trigger = ruleFor(".instrument-picker-trigger");
  for (const style of [next, trigger]) {
    assert.match(style, /\bbackground:\s*var\(--bg-deep\);/);
    assert.match(style, /\bcolor:\s*var\(--accent\);/);
    assert.match(style, /\bborder:\s*1px solid var\(--line-strong\);/);
  }
  assert.match(next, /\bappearance:\s*none;/);
  assert.match(next, /\bbox-shadow:\s*none;/);
});

test("dice reuses the next-button paint and coarse-pointer sizing without a new theme", async () => {
  const source = await readFile(new URL("../src/site/header-presets.js", import.meta.url), "utf8");
  assert.match(source, /dice\.className = "instrument-picker-next header-preset-random"/);
  assert.match(source, /"Randomize instrument parameters"/);
  assert.match(css, /@media \(pointer: coarse\)\s*\{\s*\.instrument-picker-next\s*\{[^}]*width: 48px;[^}]*height: 48px;/s);
  assert.doesNotMatch(css, /\.header-preset-random\s*\{[^}]*\b(?:background|color):/);
});

import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { runCanvasResize } from "../tests/helpers/canvas-resize-harness.mjs";
import { canvasLayouts, attachJson } from "./helpers/canvas-preservation.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const root = new URL("../", import.meta.url);
const fixture = JSON.parse(await readFile(new URL("tests/fixtures/canvas-resize-variants-v1.json", root)));
const original = await readFile(new URL("tests/fixtures/canvas-resize-v1.txt", root), "utf8");
const controllers = new Map([
  ...fixture.entries.map((entry) => [entry.file, entry]),
  ...["solid-app.js", "hyper-app.js"].map((file) => [file, { file, source: original, options: {} }]),
]);
const wrapperTargets = new Map([
  ["graph-drums-app.js", "src/graph-instrument-app.js"],
  ["graph-synth-app.js", "src/graph-instrument-app.js"],
]);

const routes = [];
for (const name of (await readdir(root)).filter((name) => name.endsWith(".html")).sort()) {
  const html = await readFile(new URL(name, root), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=(["'])(.*?)\1/g)]
    .map((match) => match[2].split(/[?#]/)[0].replace(/^\.\//, "").replace(/^\//, ""));
  const matches = [...new Set(scripts.map((file) => wrapperTargets.get(file) ?? file)
    .filter((file) => controllers.has(file)))];
  if (!matches.length) continue;
  if (matches.length !== 1) throw new Error(`Review the multiple sizing controllers on ${name}`);
  const entry = controllers.get(matches[0]);
  const source = await readFile(new URL(entry.file, root), "utf8");
  const canvasId = source.match(/const canvas = \$\("([^"]+)"\)/)?.[1];
  const wrapId = source.match(/const stageWrap = \$\("([^"]+)"\)/)?.[1];
  if (!canvasId || !wrapId) throw new Error(`Review canvas selectors for ${entry.file}`);
  routes.push({ href: name, entry, canvasId, wrapId });
}

test("every migrated sizing controller has an explicitly discovered browser route", () => {
  expect([...new Set(routes.map(({ entry }) => entry.file))].sort()).toEqual([...controllers.keys()].sort());
});

async function inspectSizing(page, route) {
  const actual = await page.evaluate(({ canvasId, wrapId }) => {
    const canvas = document.getElementById(canvasId);
    const bounds = document.getElementById(wrapId).getBoundingClientRect();
    return {
      bounds: { width: bounds.width, height: bounds.height },
      dpr: window.devicePixelRatio,
      width: canvas.width,
      height: canvas.height,
      styleWidth: canvas.style.width,
      styleHeight: canvas.style.height,
    };
  }, { canvasId: route.canvasId, wrapId: route.wrapId });
  // The expected dimensions come from the frozen original callback, NOT the
  // shared runtime helper or a default policy imposed on all instruments.
  const expected = runCanvasResize(route.entry.source, actual.bounds, actual.dpr).execute();
  return {
    actual,
    expected: { ...expected.backing, styles: expected.styles, pixelRatio: expected.pixelRatio },
    matches: actual.width === expected.backing.width
      && actual.height === expected.backing.height
      && (!Object.hasOwn(expected.styles, "width") || actual.styleWidth === expected.styles.width)
      && (!Object.hasOwn(expected.styles, "height") || actual.styleHeight === expected.styles.height),
  };
}

for (const layout of canvasLayouts) {
  test.describe(layout.name, () => {
    test.use({
      viewport: { width: layout.width, height: layout.height },
      deviceScaleFactor: layout.dpr,
      hasTouch: layout.touch,
    });
    for (const route of routes) {
      test(`${route.href}: retains its original canvas policy through resize`, async ({ page, baseURL, browser }, testInfo) => {
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        const response = await page.goto(route.href, { waitUntil: "load" });
        expect(response?.ok()).toBe(true);
        await settlePage(page);
        await expect.poll(async () => (await inspectSizing(page, route)).matches).toBe(true);
        const initial = await inspectSizing(page, route);
        await page.setViewportSize({ width: layout.width + 37, height: layout.height + 23 });
        await expect.poll(async () => (await inspectSizing(page, route)).matches).toBe(true);
        const resized = await inspectSizing(page, route);
        await page.setViewportSize({ width: layout.width, height: layout.height });
        await expect.poll(async () => (await inspectSizing(page, route)).matches).toBe(true);
        const restored = await inspectSizing(page, route);
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
        await attachJson(testInfo, "canvas-policy.json", {
          comparisonReferenceCommit: fixture.referenceCommit,
          browser: browser.version(), route: page.url(), controller: route.entry.file,
          preservedOptions: route.entry.options, layout, initial, resized, restored,
        });
      });
    }
  });
}

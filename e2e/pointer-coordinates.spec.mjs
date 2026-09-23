import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { readAudioStatus } from "./helpers/audio-probe.mjs";
import { settlePage, watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

const reference = JSON.parse(await readFile(new URL("../tests/fixtures/pointer-coordinates-v1.json", import.meta.url)));
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function exposeActualAndOriginal(page, entry) {
  // Test-only access to the real instrument closure. The production callback
  // and all event handlers stay intact; the independent reference is frozen
  // pre-extraction code, not a reimplementation of the shared helper.
  await page.route(new RegExp(`/${escape(entry.file)}(?:\\?.*)?$`), async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const source = await response.text();
    expect(source.split(entry.after)).toHaveLength(2);
    await route.fulfill({
      response,
      body: source.replace(entry.after, `${entry.after}
globalThis.__pointerCoordinateProbe = {
  actual: ${entry.name},
  reference: (${entry.before}),
  canvas,
};`),
    });
  });
}

async function compareBrowserCoordinates(page) {
  return page.evaluate(() => {
    const probe = globalThis.__pointerCoordinateProbe;
    const canvas = probe.canvas;
    const originalStyle = canvas.getAttribute("style");
    const comparisons = [];
    try {
      for (const transform of ["none", "scale(0.625, 1.375)", "scale(1.75, 0.5)", "scale(0)"]) {
        canvas.style.transformOrigin = "top left";
        canvas.style.transform = transform;
        const rect = canvas.getBoundingClientRect();
        const points = [
          [rect.left, rect.top],
          [rect.right, rect.bottom],
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + 0.125, rect.top + 0.375],
          [rect.left - 57.625, rect.top - 33.25],
          [rect.right + 210.875, rect.bottom + 301.125],
          [0, 0], [-100, -250],
        ];
        for (const [clientX, clientY] of points) {
          const event = new PointerEvent("pointermove", { clientX, clientY, pointerId: 7 });
          const expected = probe.reference(event);
          const actual = probe.actual(event);
          comparisons.push({
            transform, clientX, clientY, actual, expected,
            equal: Object.is(actual.x, expected.x) && Object.is(actual.y, expected.y),
          });
        }
      }
    } finally {
      if (originalStyle === null) canvas.removeAttribute("style");
      else canvas.setAttribute("style", originalStyle);
    }
    return comparisons;
  });
}

for (const viewport of [
  { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 900 });
    for (const entry of reference.entries) for (const href of entry.routes) {
      test(`${href}: actual pointer mapping exactly preserves its original policy`, async ({ page, baseURL }, testInfo) => {
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        await exposeActualAndOriginal(page, entry);
        await page.goto(href, { waitUntil: "load" });
        await settlePage(page);
        await expect.poll(() => page.evaluate(() => Boolean(globalThis.__pointerCoordinateProbe))).toBe(true);
        const comparisons = await compareBrowserCoordinates(page);
        expect(comparisons).toHaveLength(32);
        expect(comparisons.filter(row => !row.equal)).toEqual([]);
        const resizedViewport = { width: viewport.width - 37, height: viewport.height + 23 };
        await page.setViewportSize(resizedViewport);
        await settlePage(page);
        const resizedComparisons = await compareBrowserCoordinates(page);
        expect(resizedComparisons).toHaveLength(32);
        expect(resizedComparisons.filter(row => !row.equal)).toEqual([]);
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        expect((await readAudioStatus(page)).connectionCount).toBe(0);
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
        await testInfo.attach("pointer-comparisons.json", {
          body: JSON.stringify({ href, viewport, resizedViewport, policy: entry.mode, comparisons, resizedComparisons }),
          contentType: "application/json",
        });
      });
    }
  });
}

for (const id of ["rubix", "hiccup-head"]) {
  const entry = reference.entries.find(entry => entry.routes.includes(`${id}.html`));
  test(`WAX ${id}: shared helper loads under the hosted prefix with unchanged mapping`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await exposeActualAndOriginal(page, entry);
    await page.goto(`dist-wax/${id}.html`, { waitUntil: "load" });
    await settlePage(page);
    const comparisons = await compareBrowserCoordinates(page);
    expect(comparisons.filter(row => !row.equal)).toEqual([]);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

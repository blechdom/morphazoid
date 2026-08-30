import { expect, test } from "@playwright/test";

import {
  formatPageDiagnostics,
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";
import { allHtmlRoutes, instrumentRoutes, toolRoutes } from "./routes.mjs";

test("route inventory contains every catalogue and navigation route", () => {
  const htmlHrefs = new Set(allHtmlRoutes.map(({ href }) => href));
  const hasSourceHtml = ({ href }) => htmlHrefs.has(href)
    || (href.endsWith("/") && htmlHrefs.has(`${href}index.html`));

  expect(instrumentRoutes.length).toBeGreaterThan(0);
  expect(toolRoutes.length).toBeGreaterThanOrEqual(instrumentRoutes.length);
  expect(new Set(allHtmlRoutes.map(({ href }) => href)).size).toBe(allHtmlRoutes.length);
  expect(instrumentRoutes.filter((route) => !hasSourceHtml(route))).toEqual([]);
  expect(toolRoutes.filter((route) => !hasSourceHtml(route))).toEqual([]);
});

for (const route of allHtmlRoutes) {
  test(`${route.href} loads without browser errors`, async ({ page }) => {
    const diagnostics = watchPageDiagnostics(page);
    const response = await page.goto(route.testHref, { waitUntil: "domcontentloaded" });

    expect(response, `${route.href} did not return a document response`).not.toBeNull();
    expect(response?.ok(), `${route.href} returned HTTP ${response?.status()}`).toBe(true);
    await settlePage(page);

    await expect(page.locator("html")).toHaveAttribute("lang", /\S/u);
    await expect(page).toHaveTitle(/\S/u);
    await expect(page.locator("body")).toBeVisible();

    expect(
      pageDiagnosticMessages(diagnostics),
      `${route.href} emitted browser diagnostics:\n${formatPageDiagnostics(diagnostics)}`,
    ).toEqual([]);
  });
}

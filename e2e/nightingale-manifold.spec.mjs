import fs from "node:fs/promises";

import { expect, test } from "@playwright/test";

function collectDiagnostics(page) {
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`page: ${error.message}`));
  return diagnostics;
}

test("the local study becomes a playable 18-strophe 3D graph", async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  const response = await page.goto("/nightingale-manifold.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);

  await expect(page.locator("html")).toHaveAttribute(
    "data-nightingale-manifold-ready",
    "true",
    { timeout: 20_000 },
  );
  await expect(page.locator("#source-label")).toContainText("18-strophe");
  await expect(page.locator("#strophe-stat")).toHaveText("18");
  await expect(page.locator("#manifold-canvas")).toHaveAttribute("data-nightingale-strophes", "18");
  await expect(page.locator("#manifold-canvas")).toHaveAttribute("data-nightingale-sequence-edges", "17");
  await expect(page.locator("#route-ribbon button")).toHaveCount(8);
  await expect(page.locator("#play-route")).toBeEnabled();

  await page.locator(".node-browser summary").click();
  await page.locator("#node-list button").nth(1).click();
  await expect(page.locator("#selected-title")).toContainText("S002");
  await page.locator("#clear-route").click();
  await page.locator("#add-selected").click();
  await expect(page.locator("#walk-rule")).toHaveValue("manual");
  await expect(page.locator("#route-ribbon button")).toHaveCount(1);
  await expect(page.locator("#route-ribbon button")).toHaveText("S002");

  await page.locator("#audition-selected").click();
  await expect(page.locator("#status")).toContainText("sample-free physical model", { timeout: 20_000 });
  await page.locator("#stop-route").click();

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const download = await downloadPromise;
  const path = await download.path();
  const exported = JSON.parse(await fs.readFile(path, "utf8"));
  expect(exported.format).toBe("morphazoid-nightingale-strophe-manifold");
  expect(exported.strophes).toHaveLength(18);
  expect(exported.edges.observedSuccession).toHaveLength(17);
  expect(exported.edges.acousticSimilarity.length).toBeGreaterThan(18);
  expect(exported.route.ids).toEqual(["S002"]);
  expect(exported.physicalModel.id).toBe("effective-bilateral-syrinx-v0");
  expect(exported.disclaimer).toContain("only sequence edges");
  expect(diagnostics).toEqual([]);
});

test("the phone view keeps the map, transport, and graph controls reachable", async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/nightingale-manifold.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-nightingale-manifold-ready",
    "true",
    { timeout: 20_000 },
  );
  await expect(page.locator("#manifold-canvas")).toBeVisible();
  await expect(page.locator("#play-route")).toBeInViewport();
  await page.locator("#build-route").scrollIntoViewIfNeeded();
  await expect(page.locator("#build-route")).toBeVisible();
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(diagnostics).toEqual([]);
});

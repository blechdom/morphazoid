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

test("the demo becomes a playable, editable, exportable cricket mechanism", async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  const response = await page.goto("/crickets.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);

  await expect(page.locator("html")).toHaveAttribute("data-crickets-ready", "true", { timeout: 20_000 });
  await expect(page.locator("#source-label")).toHaveText("Synthetic six-chirp cricket gesture");
  await expect(page.locator("#carrier-stat")).toHaveText(/4\.7\d kHz/);
  await expect(page.locator("#call-stat")).toHaveText("6 / 20");
  await expect(page.locator("#stroke-stat")).toHaveText(/26\.\d Hz/);
  await expect(page.locator("#play-input")).toBeEnabled();
  await expect(page.locator("#play-model")).toBeEnabled();
  await expect(page.locator("#export-json")).toBeEnabled();

  await page.locator("#coupling").evaluate((control) => {
    control.value = "0.72";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#coupling-value")).toHaveText("72%");
  await expect(page.locator("#fit-state")).toHaveText("fit · edited");
  await expect(page.locator("#status")).toContainText("Wings rebuilt", { timeout: 20_000 });

  await page.locator(".cricket-advanced").first().locator("summary").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-json").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("synthetic-six-chirp-cricket-gesture-crickets-gesture.json");
  const path = await download.path();
  const exported = JSON.parse(await fs.readFile(path, "utf8"));
  expect(exported.format).toBe("morphazoid-cricket-wing-gesture");
  expect(exported.analysis.chirps).toHaveLength(6);
  expect(exported.analysis.pulses).toHaveLength(20);
  expect(exported.synthesis.id).toBe("two-dof-cricket-wings-v1");
  expect(exported.synthesis.coupling).toBeCloseTo(0.72, 5);
  expect(exported.disclaimer).toContain("not recovered wing anatomy");
  expect(diagnostics).toEqual([]);
});

test("the tooth-file gesture works and the phone layout does not overflow", async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/crickets.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-crickets-ready", "true", { timeout: 20_000 });
  await expect(page.locator("#cricket-stage")).toBeVisible();
  await expect(page.locator("#play-model")).toBeInViewport();

  const canvas = page.locator("#cricket-stage");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.76, bounds.y + bounds.height * 0.24, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#status")).toContainText("Manual closing stroke");

  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(diagnostics).toEqual([]);
});

test("the built-in source selector compares distinct synthetic calls", async ({ page }) => {
  const diagnostics = collectDiagnostics(page);
  await page.goto("/crickets.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-crickets-ready", "true", { timeout: 20_000 });

  await page.locator("#source-preset").selectOption("slow-low-chirps");
  await expect(page.locator("#source-label")).toContainText("slow low chirps", { timeout: 20_000 });
  await expect(page.locator("#carrier-stat")).toHaveText(/3\.3\d kHz/);
  await expect(page.locator("#call-stat")).toHaveText("4 / 10");

  await page.locator("#source-preset").selectOption("fast-high-trill");
  await expect(page.locator("#source-label")).toContainText("fast high trill", { timeout: 20_000 });
  await expect(page.locator("#carrier-stat")).toHaveText(/6\.9\d kHz/);
  await expect(page.locator("#call-stat")).toHaveText("4 / 34");

  for (const [id, label] of [
    ["recorded-house-cricket", "House cricket recording"],
    ["recorded-field-cricket", "Field cricket recording"],
    ["recorded-european-field-cricket", "European field cricket recording"],
  ]) {
    await page.locator("#source-preset").selectOption(id);
    await expect(page.locator("#source-label")).toContainText(label, { timeout: 20_000 });
    await expect(page.locator("#status")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    await expect(page.locator("#source-attribution a")).toHaveCount(2);
  }
  expect(diagnostics).toEqual([]);
});

import fs from "node:fs/promises";

import { expect, test } from "@playwright/test";

test("demo analyzes, renders, intervenes, and exports controls", async ({ page }) => {
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`page: ${error.message}`));

  const response = await page.goto("/birdsong-lab.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await expect(page.locator("#labStatus")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator("#sourceLabel")).toHaveText("Synthetic six-syllable strophe");
  await expect(page.locator("#syllableStat")).toHaveText(/[5-9]/);
  await expect(page.locator("#pitchStat")).toHaveText(/\d+ Hz/);
  await expect(page.locator("#playOriginal")).toBeEnabled();
  await expect(page.locator("#playModel")).toBeEnabled();
  await expect(page.locator("#downloadJson")).toBeEnabled();

  await page.locator("#pitchShift").evaluate((control) => {
    control.value = "7";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#pitchShiftOut")).toHaveText("+7 st");
  await expect(page.locator("#labStatus")).toContainText("Physical copy rendered", { timeout: 20_000 });

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadJson").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("synthetic-six-syllable-strophe-gesture.json");
  const path = await download.path();
  const exported = JSON.parse(await fs.readFile(path, "utf8"));
  expect(exported.format).toBe("morphazoid-effective-birdsong-gesture");
  expect(exported.disclaimer).toContain("not recovered physiology");
  expect(exported.analysis.syllables.length).toBeGreaterThanOrEqual(5);
  expect(exported.synthesis.pitchShiftSemitones).toBe(7);
  expect(exported.analysis.frames.every((frame) => Number.isFinite(frame.timeSeconds))).toBe(true);
  expect(diagnostics).toEqual([]);
});

test("the POC remains usable at a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/birdsong-lab.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#labStatus")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(page.locator("#analysisCanvas")).toBeVisible();
  await expect(page.locator("#playModel")).toBeInViewport();
  await expect(page.locator("#fileDrop")).toBeVisible();
});

test("the built-in source selector spans low through high synthetic phrases", async ({ page }) => {
  const diagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`page: ${error.message}`));
  await page.goto("/birdsong-lab.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#labStatus")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });

  await page.locator("#source-preset").selectOption("high-whistles");
  await expect(page.locator("#sourceLabel")).toContainText("high whistle arcs", { timeout: 20_000 });
  await expect(page.locator("#pitchRange")).toHaveValue("ultrahigh");
  await expect(page.locator("#pitchStat")).toHaveText(/4\d{3} Hz/);

  await page.locator("#source-preset").selectOption("low-coos");
  await expect(page.locator("#sourceLabel")).toContainText("low four-note coo", { timeout: 20_000 });
  await expect(page.locator("#pitchRange")).toHaveValue("lowbird");
  await expect(page.locator("#pitchStat")).toHaveText(/3\d{2} Hz/);

  for (const [id, label] of [
    ["recorded-thrush-nightingale", "Thrush nightingale recording"],
    ["recorded-common-blackbird", "Common blackbird recording"],
    ["recorded-chaffinch", "Chaffinch recording"],
  ]) {
    await page.locator("#source-preset").selectOption(id);
    await expect(page.locator("#sourceLabel")).toContainText(label, { timeout: 20_000 });
    await expect(page.locator("#labStatus")).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
    await expect(page.locator("#source-attribution a")).toHaveCount(2);
  }
  expect(diagnostics).toEqual([]);
});

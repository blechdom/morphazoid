import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
} from "./helpers/audio-probe.mjs";
import {
  formatPageDiagnostics,
  pageDiagnosticMessages,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

test("Digestazoid gestures drive finite unclipped stereo physical-model audio", async ({ page }) => {
  const diagnostics = watchPageDiagnostics(page);
  await page.goto("digestazoid.html", { waitUntil: "load" });

  await expect(page.locator("[data-gesture]")).toHaveCount(8);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await waitForAudioState(page, true);

  await page.locator('[data-gesture="long-fart"]').click();
  await expect(page.locator("#eventOut")).toContainText("long");
  const envelope = await sampleAudioEnvelope(page, { durationMs: 1_050, intervalMs: 35 });

  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.activeSamples).toBeGreaterThan(0);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.00001);
  expect(envelope.samples.some(({ leftPeak, rightPeak }) => leftPeak > 0 && rightPeak > 0)).toBe(true);

  const status = await readAudioStatus(page);
  expect(status.connectionCount).toBe(1);
  await page.locator("#audioButton").click();
  await waitForAudioState(page, false);
  await page.locator("#audioButton").click();
  await waitForAudioState(page, true);
  await page.locator('[data-gesture="bubble"]').click();
  const resumed = await sampleAudioEnvelope(page, { durationMs: 360, intervalMs: 30 });
  expect(resumed.summary.maxPeak).toBeGreaterThan(0.00001);
  expect(resumed.summary.clippedSamples).toBe(0);
  await page.locator("#audioButton").click();
  await waitForAudioState(page, false);
  expect(
    pageDiagnosticMessages(diagnostics),
    formatPageDiagnostics(diagnostics),
  ).toEqual([]);
});

test("Digestazoid remains tactile and reachable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("digestazoid.html", { waitUntil: "load" });

  const canvas = await page.locator("#stage").boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.click(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#eventOut")).not.toHaveText("listening");

  const initialGas = Number(await page.locator("#gas").inputValue());
  await page.locator("#inflateButton").hover();
  await page.mouse.down();
  await page.waitForTimeout(130);
  await page.mouse.up();
  expect(Number(await page.locator("#gas").inputValue())).toBeGreaterThan(initialGas);

  await page.keyboard.press("8");
  await expect(page.locator("#eventOut")).toContainText("long fart");
  await page.locator('details[data-section="listening"] > summary').click();
  await page.locator("#listeningMode").selectOption("stethoscope");
  await expect(page.locator("#listeningSummary")).toContainText("stethoscope");

  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    canvasWidth: document.querySelector("#stage")?.getBoundingClientRect().width ?? 0,
    pads: [...document.querySelectorAll("[data-gesture]")]
      .every((button) => button.getBoundingClientRect().right <= innerWidth + 1),
  }));
  expect(layout.overflow).toBeLessThanOrEqual(2);
  expect(layout.canvasWidth).toBeGreaterThan(300);
  expect(layout.pads).toBe(true);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    accessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious"),
  ).toEqual([]);
});

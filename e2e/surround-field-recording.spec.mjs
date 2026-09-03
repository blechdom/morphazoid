import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { settlePage } from "./helpers/diagnostics.mjs";

function sineWaveFile({ sampleRate = 48_000, duration = 0.5, frequency = 440, amplitude = 0.25 } = {}) {
  const frames = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(frame * Math.PI * 2 * frequency / sampleRate) * amplitude * 0x7fff), 44 + frame * 2);
  }
  return buffer;
}

test("Surround for Safety records an isolated calibrated channel before stereo fold-down", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("surround-field.html", { waitUntil: "load" });
  await settlePage(page);
  await page.locator('[data-layout="7-4-1"]').click();
  await page.locator('[data-test-signal="tone"]').click();
  await page.locator("#recordButton").click();
  await expect(page.locator("#recordButton")).toHaveAttribute("aria-pressed", "true");

  const armed = await page.evaluate(() => window.__SURROUND_FIELD_DEBUG__.getState());
  expect(armed.outputMode).toBe("preview");
  expect(armed.routeTargetIndices).toEqual(Array.from({ length: 12 }, (_, index) => index));

  const rearLeft = page.locator('.channel-meter[data-index="4"]');
  await expect(rearLeft).toHaveAttribute("aria-label", /channel 5, Lrs/);
  await rearLeft.click();
  await page.waitForTimeout(1050);
  await page.locator("#recordButton").click();
  await expect(page.locator("#downloadRecording")).toBeEnabled({ timeout: 10_000 });

  const completed = await page.evaluate(() => window.__SURROUND_FIELD_DEBUG__.getState());
  expect(completed.lastRecording.channelCount).toBe(12);
  expect(completed.lastRecording.duration).toBeGreaterThan(0.9);
  expect(completed.lastRecording.peaks[4]).toBeGreaterThan(0.12);
  expect(completed.lastRecording.peaks[4]).toBeLessThan(0.13);
  completed.lastRecording.peaks.forEach((peak, index) => {
    if (index !== 4) expect(peak).toBeLessThan(0.0001);
  });

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadRecording").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^surround-field-7-4-1-.*\.zip$/);
  expect(pageErrors).toEqual([]);
});

test("a local audio file enters at unity and is captured across the virtual field", async ({ page }) => {
  await page.goto("surround-field.html", { waitUntil: "load" });
  await settlePage(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#centerSource").click();
  await page.locator("#patchFile").setInputFiles({
    name: "reference-tone.wav",
    mimeType: "audio/wav",
    buffer: sineWaveFile(),
  });
  await expect(page.locator("#fileSourceState")).toContainText("reference-tone.wav");

  await page.locator("#recordButton").click();
  await expect(page.locator("#recordButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#filePlayButton").click();
  await page.waitForTimeout(650);
  await page.locator("#recordButton").click();
  await expect(page.locator("#downloadRecording")).toBeEnabled({ timeout: 10_000 });

  const completed = await page.evaluate(() => window.__SURROUND_FIELD_DEBUG__.getState());
  expect(completed.lastRecording.channelCount).toBe(8);
  expect(completed.lastRecording.peaks).toHaveLength(8);
  for (const peak of completed.lastRecording.peaks) {
    expect(peak).toBeGreaterThan(0.08);
    expect(peak).toBeLessThan(0.1);
  }
});

test("new calibration and recorder controls retain readable contrast", async ({ page }) => {
  await page.goto("surround-field.html", { waitUntil: "domcontentloaded" });
  const audit = new AxeBuilder({ page }).withRules(["color-contrast"]);
  for (const selector of [
    ".test-signal-heading",
    ".test-signal-grid",
    ".test-trim-control",
    ".sweep-button",
    ".channel-meters",
    ".calibration-note",
    ".patch-source",
    ".recording-console",
    ".patch-note",
  ]) audit.include(selector);
  const results = await audit.analyze();
  expect(results.violations).toEqual([]);
});

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

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("Surround for Safety records an isolated calibrated channel before stereo fold-down", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("surround-field.html", { waitUntil: "load" });
  await settlePage(page);
  await page.locator('[data-layout="7-4-1"]').click();
  await page.locator('[data-test-signal="tone"]').click();
  await setRange(page, "#level", 0);
  await expect(page.locator("#levelOut")).toHaveText("0%");
  await page.locator("#recordButton").click();
  await expect(page.locator("#recordButton")).toHaveAttribute("aria-pressed", "true");

  const armed = await page.evaluate(() => window.__SURROUND_FIELD_DEBUG__.getState());
  expect(armed.outputMode).toBe("preview");
  expect(armed.routeTargetIndices).toEqual(Array.from({ length: 12 }, (_, index) => index));

  const rearLeft = page.locator('.channel-meter[data-index="4"]');
  await expect(rearLeft).toHaveAttribute("aria-label", /channel 5, Lrs/);
  await rearLeft.click();
  await expect.poll(async () => Number(await rearLeft.getAttribute("data-peak-dbfs"))).toBeGreaterThan(-18.4);
  const referenceMeter = await rearLeft.evaluate((row) => ({
    dbfs: Number(row.dataset.peakDbfs),
    fill: Number(row.style.getPropertyValue("--meter")),
  }));
  expect(referenceMeter.dbfs).toBeLessThan(-17.6);
  expect(referenceMeter.fill).toBeGreaterThan(0.68);
  expect(referenceMeter.fill).toBeLessThan(0.72);
  await page.waitForTimeout(1050);
  await page.locator("#recordButton").click();
  await expect(page.locator("#downloadRecording")).toBeEnabled({ timeout: 10_000 });

  const completed = await page.evaluate(() => window.__SURROUND_FIELD_DEBUG__.getState());
  expect(completed.lastRecording.channelCount).toBe(12);
  expect(completed.lastRecording.duration).toBeGreaterThan(0.9);
  expect(completed.lastRecording.peaks[4]).toBeGreaterThan(0.12);
  expect(completed.lastRecording.peaks[4]).toBeLessThan(0.13);
  expect(completed.lastRecording.clippedSamples).toBe(0);
  completed.lastRecording.peaks.forEach((peak, index) => {
    if (index !== 4) expect(peak).toBeLessThan(0.0001);
  });

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadRecording").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^surround-field-7-4-1-.*\.zip$/);
  expect(pageErrors).toEqual([]);
});

test("real channel peak meters follow test trim and clear instead of pinning", async ({ page }) => {
  await page.goto("surround-field.html", { waitUntil: "load" });
  await settlePage(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-test-signal="tone"]').click();

  await setRange(page, "#testTrim", -24);
  const low = page.locator('.channel-meter[data-index="0"]');
  await low.click();
  await expect.poll(async () => Number(await low.getAttribute("data-peak-dbfs"))).toBeGreaterThan(-42.5);
  const lowReading = await low.evaluate((row) => ({
    dbfs: Number(row.dataset.peakDbfs),
    fill: Number(row.style.getPropertyValue("--meter")),
  }));
  expect(lowReading.dbfs).toBeLessThan(-41.5);
  expect(lowReading.fill).toBeGreaterThan(0.28);
  expect(lowReading.fill).toBeLessThan(0.32);

  await setRange(page, "#testTrim", 6);
  const high = page.locator('.channel-meter[data-index="1"]');
  await high.click();
  await expect.poll(async () => Number(await high.getAttribute("data-peak-dbfs"))).toBeGreaterThan(-12.5);
  const highReading = await high.evaluate((row) => ({
    dbfs: Number(row.dataset.peakDbfs),
    fill: Number(row.style.getPropertyValue("--meter")),
  }));
  expect(highReading.dbfs).toBeLessThan(-11.5);
  expect(highReading.fill).toBeGreaterThan(0.78);
  expect(highReading.fill).toBeLessThan(0.82);
  expect(highReading.dbfs - lowReading.dbfs).toBeGreaterThan(29);
  expect(highReading.dbfs - lowReading.dbfs).toBeLessThan(31);

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(high.locator("output")).toHaveText("−∞");
  expect(Number(await high.getAttribute("data-peak-dbfs"))).toBe(-Infinity);
});

test("the louder default program remains balanced and below full scale", async ({ page }) => {
  await page.goto("surround-field.html", { waitUntil: "load" });
  await settlePage(page);
  await page.locator("#centerSource").click();
  await expect(page.locator("#levelOut")).toHaveText("55%");
  await page.locator("#recordButton").click();
  await expect(page.locator("#recordButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-note="55"]').click();
  const programMeter = page.locator('.channel-meter[data-index="0"]');
  await page.waitForFunction(
    () => Number(document.querySelector('.channel-meter[data-index="0"]')?.dataset.peakDbfs) > -20.5,
  );
  const programReading = await programMeter.evaluate((row) => ({
    dbfs: Number(row.dataset.peakDbfs),
    fill: Number(row.style.getPropertyValue("--meter")),
  }));
  expect(programReading.dbfs).toBeLessThan(-18.5);
  expect(programReading.fill).toBeGreaterThan(0.65);
  expect(programReading.fill).toBeLessThan(0.7);
  await page.waitForTimeout(1050);
  await page.locator("#recordButton").click();
  await expect(page.locator("#downloadRecording")).toBeEnabled({ timeout: 10_000 });

  const completed = await page.evaluate(() => window.__SURROUND_FIELD_DEBUG__.getState());
  expect(completed.lastRecording.channelCount).toBe(8);
  expect(completed.lastRecording.clippedSamples).toBe(0);
  completed.lastRecording.peaks.forEach((peak) => {
    expect(peak).toBeGreaterThan(0.095);
    expect(peak).toBeLessThan(0.12);
  });
  expect(Math.max(...completed.lastRecording.peaks) - Math.min(...completed.lastRecording.peaks)).toBeLessThan(0.002);
});

test("a full-level eight-note chord retains digital headroom", async ({ page }) => {
  await page.goto("surround-field.html", { waitUntil: "load" });
  await settlePage(page);
  await page.locator("#centerSource").click();
  await setRange(page, "#level", 1);
  await expect(page.locator("#levelOut")).toHaveText("100%");
  await page.locator("#recordButton").click();
  await expect(page.locator("#recordButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".note-pads button").evaluateAll((buttons) => {
    for (const button of buttons) {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    }
  });
  await page.waitForTimeout(1250);
  await page.locator("#recordButton").click();
  await expect(page.locator("#downloadRecording")).toBeEnabled({ timeout: 10_000 });

  const completed = await page.evaluate(() => window.__SURROUND_FIELD_DEBUG__.getState());
  expect(completed.lastRecording.clippedSamples).toBe(0);
  expect(Math.max(...completed.lastRecording.peaks)).toBeGreaterThan(0.1);
  expect(Math.max(...completed.lastRecording.peaks)).toBeLessThan(0.95);
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
    ".channel-meter-heading",
    ".channel-meters",
    ".calibration-note",
    ".patch-source",
    ".recording-console",
    ".patch-note",
  ]) audit.include(selector);
  const results = await audit.analyze();
  expect(results.violations).toEqual([]);
});

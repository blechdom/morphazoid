import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

const state = (page) => page.evaluate(() => window.__trackazoid.snapshot());

function diagnostics(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`Page: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`Console: ${message.text()}`); });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === new URL(page.url()).origin) errors.push(`Request: ${request.url()} ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return errors;
}

async function ready(page) {
  await page.goto("/trackazoid.html");
  await expect(page.locator("#trackazoid")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#audioButton")).toBeEnabled();
}

async function demos(page) {
  await ready(page); await page.locator("#demoPair").click();
  await expect(page.locator("#aState")).toHaveText("READY");
  await expect(page.locator("#bState")).toHaveText("READY");
  await expect(page.locator("#demoPair")).toBeEnabled();
  await expect(page.locator("#aTitle")).toContainText("Mint transmission");
  await expect(page.locator("#bTitle")).toContainText("Amber circuit");
}

async function slider(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function arm(page) {
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
}

async function audible(page, durationMs = 650) {
  const envelope = await sampleAudioEnvelope(page, { durationMs, intervalMs: 40 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(0.001);
  expect(envelope.summary.maxPeak).toBeLessThanOrEqual(1);
  expect(envelope.summary.clippedSamples).toBe(0);
  return envelope.summary;
}

async function dispose(page) {
  await page.evaluate(() => window.__trackazoid.dispose());
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect((await state(page)).disposed).toBe(true);
  expect((await state(page)).contextState).toBe("none");
}

test("demo decks, manual sync, loops and key lock retain transport across Audio off/on", async ({ page }) => {
  test.setTimeout(45_000);
  const errors = diagnostics(page);
  await demos(page);
  expect((await state(page)).contextState).toBe("none");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  // Source BPM changes the editable grid. Sync matches the effective other BPM.
  await page.locator("#aBpm").fill("120");
  await page.locator("#bBpm").fill("126");
  await page.locator("#aNudgeForward").click();
  expect((await state(page)).decks.a.position).toBeCloseTo(0.02, 5);
  await page.locator("#aNudgeBack").click();
  expect((await state(page)).decks.a.position).toBeCloseTo(0, 5);
  await page.locator("#aSync").click();
  expect((await state(page)).decks.a.rate).toBeCloseTo(1.05, 8);
  await expect(page.locator("#aEffective")).toHaveText("126.0");
  await page.locator("#aLoopBeats").selectOption("2");
  await page.locator("#aLoop").click();
  const loop = (await state(page)).decks.a.loop;
  expect(loop.end - loop.start).toBeCloseTo(1, 6);
  await page.locator("#aPlay").click();
  await expect(page.locator("#aState")).toHaveText("SILENT PLAY");
  await expect.poll(async () => (await state(page)).decks.a.position).toBeGreaterThan(0.05);
  expect((await state(page)).contextState).toBe("none");

  await arm(page); await audible(page);
  const loopState = (await state(page)).decks.a;
  expect(loopState.playing).toBe(true);
  expect(loopState.position).toBeGreaterThanOrEqual(loop.start);
  expect(loopState.position).toBeLessThan(loop.end);
  await page.locator("#aKeyLock").click();
  await expect(page.locator("#aKeyLock")).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator("#aKeyLock")).toHaveAttribute("aria-pressed", "true");
  await slider(page, "#aTempo", -8);
  expect((await state(page)).decks.a.rate).toBeCloseTo(0.92, 8);
  expect((await state(page)).decks.a.keyLock).toBe(true);
  await audible(page, 850);

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect((await state(page)).decks.a.playing).toBe(true);
  const silent = await sampleAudioEnvelope(page, { durationMs: 200 });
  expect(silent.summary.maxRms).toBeLessThan(0.0001);
  await arm(page); await audible(page, 850);
  expect((await state(page)).decks.a.loop).toEqual(loop);
  expect((await state(page)).decks.a.keyLock).toBe(true);
  await expect(page.locator("#errorMessage")).toBeHidden();
  await dispose(page);
  expect(errors).toEqual([]);
});

test("EQ and crossfader affect the master while mixer reset preserves live playback and master volume", async ({ page }) => {
  const errors = diagnostics(page);
  await demos(page);
  await page.locator("#aLoop").click(); await page.locator("#aPlay").click();
  await slider(page, "#level", 0.5); await slider(page, "#crossfader", -1);
  await arm(page);
  const initial = await audible(page, 1050);
  await slider(page, "#crossfader", 1); // B is loaded but paused.
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeLessThan(0.0001);
  const muted = await sampleAudioEnvelope(page, { durationMs: 250 });
  expect(muted.summary.maxRms).toBeLessThan(0.0001);
  expect((await state(page)).decks.a.playing).toBe(true);
  await slider(page, "#crossfader", -1);
  for (const band of ["alow", "amid", "ahigh"]) await slider(page, `#${band}`, -24);
  const attenuated = await sampleAudioEnvelope(page, { durationMs: 1050, intervalMs: 40 });
  expect(attenuated.summary.finite).toBe(true);
  expect(attenuated.summary.meanRms).toBeLessThan(initial.meanRms * 0.75);
  await slider(page, "#aFilter", -0.5); await slider(page, "#aGain", 0.4);
  await page.locator("#resetMixer").click();
  for (const band of ["alow", "amid", "ahigh", "aFilter"]) await expect(page.locator(`#${band}`)).toHaveValue("0");
  await expect(page.locator("#aGain")).toHaveValue("0.8");
  await expect(page.locator("#crossfader")).toHaveValue("0");
  await expect(page.locator("#level")).toHaveValue("0.5");
  expect((await state(page)).decks.a.playing).toBe(true);
  expect((await state(page)).decks.b.playing).toBe(false);
  await audible(page);
  await dispose(page);
  expect(errors).toEqual([]);
});

test("Space controls the selected deck without arming Audio or stealing text input", async ({ page }) => {
  const errors = diagnostics(page);
  await demos(page);
  await page.locator("h1").click(); await page.keyboard.press("b");
  expect((await state(page)).selected).toBe("b");
  await page.keyboard.press("Space");
  await expect(page.locator("#bPlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#aPlay")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#librarySearch").fill("two"); await page.keyboard.press("Space");
  await expect(page.locator("#librarySearch")).toHaveValue("two ");
  await expect(page.locator("#bPlay")).toHaveAttribute("aria-pressed", "true");
  await page.locator("h1").click(); await page.keyboard.press("Space");
  await expect(page.locator("#bPlay")).toHaveAttribute("aria-pressed", "false");
  expect((await state(page)).contextState).toBe("none");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await dispose(page);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`mixing controls remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const errors = diagnostics(page);
    await page.setViewportSize(viewport); await demos(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const selector of ["#aPlay", "#bPlay", "#crossfader", "#outputMode", "#openFolder", "#librarySearch"]) {
      const control = page.locator(selector);
      await control.scrollIntoViewIfNeeded(); await expect(control).toBeInViewport();
      const box = await control.boundingBox();
      expect(box.x, selector).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(viewport.width + 1);
    }
    await expect(page.locator("#errorMessage")).toBeHidden();
    // Axe copies CSS into a synthetic document; its relative @imports can
    // request nonexistent paths. Check real-page diagnostics before the scan.
    expect(errors).toEqual([]);
    const accessibility = await new AxeBuilder({ page }).include("#trackazoid").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations.filter(({ impact }) => ["serious", "critical"].includes(impact))).toEqual([]);
    await dispose(page);
  });
}

test("coarse-pointer Audio and both deck transports provide 48-pixel touch targets", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = diagnostics(page);
  try {
    await demos(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    for (const selector of ["#audioButton", "#aPlay", "#bPlay"]) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = await page.locator(selector).boundingBox();
      expect(box.width, selector).toBeGreaterThanOrEqual(48);
      expect(box.height, selector).toBeGreaterThanOrEqual(48);
    }
    await page.locator("#bPlay").tap();
    await expect(page.locator("#bPlay")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await state(page)).contextState).toBe("none");
    await dispose(page);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

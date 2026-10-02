import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

async function capturePreset(page) {
  return page.evaluate(async () => {
    const { captureHeaderPresetState } = await import("/src/site/header-presets.js");
    return captureHeaderPresetState();
  });
}

async function selectFullPreset(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
  await expect.poll(async () => (await capturePreset(page))?.selectedId).toBe(id);
}

async function readStage(page) {
  return page.locator("#stage").evaluate((canvas) => ({
    phase: Number(canvas.dataset.phase),
    pitchHz: Number(canvas.dataset.pitchHz),
    ornament: canvas.dataset.ornament,
    melody: canvas.dataset.melody,
  }));
}

test("Throat Singer pattern controls advance and freeze without implicitly enabling Audio", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("throat-singing.html", { waitUntil: "load" });
  await expect(page).toHaveTitle("Throat Singer · Morphazoid");
  expect(await page.locator("#ornamentSelect option").count()).toBeGreaterThanOrEqual(16);
  expect(await page.locator("#melodySelect option").count()).toBeGreaterThanOrEqual(10);

  for (const [selectId, nextId, randomId] of [
    ["ornamentSelect", "ornamentNext", "ornamentRandom"],
    ["ornamentLoop", "loopNext", "loopRandom"],
    ["melodySelect", "melodyNext", "melodyRandom"],
  ]) {
    const select = page.locator(`#${selectId}`);
    const choices = await select.locator("option").evaluateAll((options) => options.map(({ value }) => value));
    await select.selectOption(choices[0]);
    await page.locator(`#${nextId}`).click();
    await expect(select).toHaveValue(choices[1]);
    await page.locator(`#${randomId}`).click();
    await expect(select).not.toHaveValue(choices[1]);
    expect(choices).toContain(await select.inputValue());
  }

  await page.locator("#ornamentSelect").selectOption("roll");
  await page.locator("#ornamentLoop").selectOption("loop");
  await page.locator(".throat-motion-section > summary").click();
  await page.locator("#ornamentRate").fill("0.6");
  await page.locator("#melodySelect").selectOption("pendulum");
  await page.locator("#melodyRate").fill("0.35");
  await page.locator("#melodyDepth").fill("8");
  await page.locator("#vibratoDepth").fill("0");
  await page.locator("#singButton").click();
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  const starting = await readStage(page);
  await expect.poll(async () => Math.abs((await readStage(page)).phase - starting.phase)).toBeGreaterThan(0.05);
  await expect.poll(async () => Math.abs((await readStage(page)).pitchHz - starting.pitchHz)).toBeGreaterThan(1);
  await expect(page.locator("#stage")).toHaveAttribute("data-ornament", "roll");
  await expect(page.locator("#stage")).toHaveAttribute("data-melody", "pendulum");
  expect((await readAudioStatus(page)).active).toBe(false);

  await page.locator("#singButton").click();
  await page.waitForTimeout(200);
  const stopped = await readStage(page);
  await page.waitForTimeout(300);
  expect(await readStage(page)).toEqual(stopped);
  await page.locator("#gestureButton").click();
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).active).toBe(false);
  expect(errors).toEqual([]);
});

test("Throat Singer Once completes one ornament while Off and Loop preserve the drone", async ({ page }) => {
  await page.goto("throat-singing.html", { waitUntil: "load" });
  await page.locator("#ornamentSelect").selectOption("swell");
  await page.locator(".throat-motion-section > summary").click();
  await page.locator("#ornamentRate").fill("2");
  await page.locator("#ornamentDepth").fill("1.5");
  await page.locator("#ornamentLoop").selectOption("once");
  await page.locator("#gestureButton").click();
  await expect(page.locator("#phraseStatus")).toContainText("complete");
  await expect(page.locator("#stage")).toHaveAttribute("data-phase", "1.000");
  await expect(page.locator("#gestureButton")).not.toHaveClass(/is-active/);
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");

  await page.locator("#ornamentLoop").selectOption("off");
  await expect(page.locator("#gestureButton")).not.toHaveClass(/is-active/);
  await expect(page.locator("#phraseStatus")).not.toContainText("complete");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#ornamentLoop").selectOption("loop");
  await expect(page.locator("#gestureButton")).toHaveClass(/is-active/);
  const phases = await page.evaluate(async () => {
    const values = [];
    for (let index = 0; index < 16; index++) {
      values.push(Number(document.querySelector("#stage").dataset.phase));
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    return values;
  });
  expect(phases.every((phase) => Number.isFinite(phase) && phase >= 0 && phase <= 1)).toBe(true);
  expect(phases.some((phase, index) => index > 0 && phase < phases[index - 1] - 0.25)).toBe(true);
  await expect(page.locator("#phraseStatus")).not.toContainText("complete");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("Throat Singer complete presets and live pattern edits preserve transport, level, and bounded audio", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("throat-singing.html", { waitUntil: "load" });
  expect((await capturePreset(page)).presetCount).toBeGreaterThanOrEqual(24);
  await page.locator("#level").fill("0.17");
  await selectFullPreset(page, "bright-thread");
  const expectedSnapshot = await page.evaluate(async () => {
    const { THROAT_SINGER_PRESETS } = await import("/src/instruments/throat-singing/performance-patterns.js");
    return THROAT_SINGER_PRESETS.find(({ id }) => id === "bright-thread").snapshot;
  });
  expect((await capturePreset(page)).snapshot).toEqual(expectedSnapshot);
  await expect(page.locator("#level")).toHaveValue("0.17");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#audioButton").click();
  await page.locator("#singButton").click();
  await waitForAudioState(page, true);
  await page.locator("#ornamentSelect").selectOption("spiral");
  await page.locator("#melodySelect").selectOption("arch");
  await page.locator("#melodyRate").fill("0.4");
  await page.locator("#melodyDepth").fill("5");
  await page.locator("#growlRoughness").fill("0.35");
  await expect.poll(async () => (await capturePreset(page)).selectedId).toBe(null);
  const editedSnapshot = (await capturePreset(page)).snapshot;
  expect(editedSnapshot).not.toEqual(expectedSnapshot);
  await selectFullPreset(page, "bright-thread");
  expect((await capturePreset(page)).snapshot).toEqual(expectedSnapshot);

  await page.locator(".header-preset-next").click();
  await expect.poll(async () => (await capturePreset(page)).selectedId).toBe("rounded-glass");
  const nextSnapshot = (await capturePreset(page)).snapshot;
  await page.locator(".header-preset-random").click();
  await expect.poll(async () => (await capturePreset(page)).selectedId).toBe(null);
  expect((await capturePreset(page)).snapshot).not.toEqual(nextSnapshot);
  await expect(page.locator("#level")).toHaveValue("0.17");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");

  const audio = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 50 });
  expect(audio.summary.finite).toBe(true);
  expect(audio.summary.activeSamples).toBeGreaterThan(0);
  expect(audio.summary.maxPeak).toBeGreaterThan(0.001);
  expect(audio.summary.clippedSamples).toBe(0);
  await page.locator("#singButton").click();
  await waitForStableAudioState(page, false);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);
  expect(errors).toEqual([]);
});

test("Throat Singer presets and phrase controls remain reachable in all three supported layouts", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await test.step(`${viewport.width} × ${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto("throat-singing.html", { waitUntil: "load" });
      await expect(page.locator("#stage")).toBeVisible();
      for (const selector of [
        ".header-preset-picker > summary", ".header-preset-next", ".header-preset-random",
        "#singButton", "#gestureButton", "#ornamentSelect", "#ornamentNext", "#ornamentRandom",
        "#ornamentLoop", "#loopNext", "#loopRandom", "#melodySelect", "#melodyNext", "#melodyRandom",
        "#melodyRate", "#melodyDepth", "#resetButton",
      ]) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: 0.95 });
        await expect(control).toBeEnabled();
      }
      await page.locator(".header-preset-picker > summary").click();
      await expect(page.locator("[data-full-preset]").first()).toBeInViewport({ ratio: 0.95 });
      await page.keyboard.press("Escape");
      const overflow = await page.evaluate(() => {
        const panel = document.querySelector(".throat-panel");
        return {
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          panel: panel.scrollWidth - panel.clientWidth,
        };
      });
      expect(overflow.document).toBeLessThanOrEqual(1);
      expect(overflow.panel).toBeLessThanOrEqual(1);
    });
  }
  expect(errors).toEqual([]);
});

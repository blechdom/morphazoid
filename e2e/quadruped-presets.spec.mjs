import { test, expect } from "@playwright/test";
import { QUADRUPED_FULL_PRESETS } from "../src/instruments/quadruped/quadruped-presets.js";

const capture = page => page.evaluate(async () => {
  const { captureHeaderPresetState } = await import("./src/site/header-presets.js");
  return captureHeaderPresetState();
});

test("Quadruped full recall and dice start Play while retaining Audio and level", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/quadruped.html");
  const row = page.locator(".header-preset-controls");
  await expect(row).toHaveAttribute("data-preset-id", "unselected");
  expect(await row.evaluate(node => node === node.parentElement.firstElementChild)).toBe(true);
  await page.locator("#level").fill("0");
  for (const preset of QUADRUPED_FULL_PRESETS) {
    await row.locator("summary").click();
    await page.locator(`button[data-preset-id="${preset.id}"]`).click();
    await expect(row).toHaveAttribute("data-preset-id", preset.id);
    expect((await capture(page)).snapshot).toEqual(preset.snapshot);
    await expect(page.locator("#level")).toHaveValue("0");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#playButton").click();
  }
  await page.locator("#level").fill("0.31");
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-clock-position"))).toBeGreaterThan(16);
  for (let index = 0; index < 20; index += 1) {
    const before = await capture(page);
    await row.locator(".header-preset-random").click();
    await expect(row).toHaveAttribute("data-preset-id", "custom");
    const after = await capture(page);
    expect(after.snapshot).not.toEqual(before.snapshot);
    await expect(page.locator("#level")).toHaveValue("0.31");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  }
  await page.locator("#playButton").click();
  await row.locator(".header-preset-next").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(row).toHaveAttribute("data-preset-id", QUADRUPED_FULL_PRESETS[0].id);
  await expect.poll(async () => page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
    const { rms, peak, clipped, connectionCount } = getSharedAudioOutputManager().getStatus();
    return rms > 0.001 && peak < 0.90 && !clipped && connectionCount === 1;
  })).toBe(true);
  await page.locator("#level").fill("0");
  await expect.poll(async () => page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
    return getSharedAudioOutputManager().getStatus().peak;
  })).toBeLessThan(0.00001);
  await page.locator("#audioButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("recalling a captured solo scene does not rewind a formerly grouped actor", async ({ page }) => {
  // Expose the actual adapter only in this test, to exercise rollback/recall of
  // an edited snapshot rather than substituting a factory scene.
  await page.route("**/src/instruments/quadruped/quadruped-app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.quadrupedRecallTest = { capturePreset, applyPreset };` });
  });
  await page.goto("/quadruped.html");
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator('[data-actor-index="2"]').click();
  await page.locator('[data-group-mode="solo"]').click();
  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-clock-position"))).toBeGreaterThan(40);
  await page.locator("#playButton").click();
  const before = Number(await page.locator("#stage").getAttribute("data-clock-position"));
  await page.evaluate(() => {
    const { capturePreset, applyPreset } = globalThis.quadrupedRecallTest;
    applyPreset(capturePreset());
  });
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-clock-position"))).toBeCloseTo(before, 3);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
});

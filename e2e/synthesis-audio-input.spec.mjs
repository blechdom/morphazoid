import { test, expect } from "@playwright/test";
import { installAudioInputFixture } from "./helpers/audio-input-fixture.mjs";
import { choose } from "./helpers/synthesis-controls.mjs";

test("audio input visibility follows ordinary, file-source and Processing modes", async ({ page }) => {
  await installAudioInputFixture(page);
  const row = page.locator(".mz-audio-input-strip");
  const source = row.locator(".mz-input-source");
  const micOption = source.locator('option[value="mic"]');

  await page.goto("/synthesis.html?method=additive");
  await expect(row).toBeHidden();

  await page.goto("/synthesis.html?method=sampling");
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-input-source", "file");
  await expect(source).toBeHidden();
  await expect(micOption).toBeDisabled();
  expect(await micOption.evaluate(option => option.hidden)).toBe(true);
  await expect(row.locator(".mz-input-toggle")).toHaveAccessibleName("Activate file input");
  await expect(row.locator(".mz-input-file")).toBeVisible();
  expect(await page.evaluate(() => __familyInput.requests)).toBe(0);

  await page.goto("/synthesis.html?method=fx-biquad");
  await expect(page.locator("#inputCategory")).toHaveValue("signals");
  await expect(row).toBeHidden();
  expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
  await choose(page, "inputCategory", "microphone");
  await expect(row).toBeVisible();
  await expect(source).toBeHidden();
  await expect(micOption).toBeEnabled();
  expect(await micOption.evaluate(option => option.hidden)).toBe(false);
  await expect(row).toHaveAttribute("data-input-source", "mic");
  await expect(row.locator(".mz-input-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".mz-input-toggle")).toHaveAccessibleName("Deactivate microphone input");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => __familyInput.requests)).toBe(1);
  await choose(page, "inputCategory", "file");
  await expect(row).toHaveAttribute("data-input-source", "file");
  await expect(source).toBeHidden();
  await expect(row.locator(".mz-input-file")).toBeVisible();
  await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "ended"))).toBe(true);
  expect(await page.evaluate(() => __familyInput.requests)).toBe(1);
});

test("Synthesaurus captures and meters input with a muted master, retaining native dB gain", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await installAudioInputFixture(page);
  await page.goto("/synthesis.html?method=fx-biquad");
  const row = page.locator(".mz-audio-input-strip");
  await expect(row).toHaveCount(1);
  expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
  await choose(page, "inputCategory", "microphone");
  await expect(row.locator(".mz-input-toggle")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => row.locator("meter").first().evaluate(node => node.value)).toBeGreaterThan(0.02);
  await row.locator('input[type="range"]').evaluate(node => { node.value = "-36"; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect.poll(() => row.locator("meter").first().evaluate(node => node.value)).toBeLessThan(0.003);
  expect(await page.evaluate(() => MorphazoidSynthesis.getState().inputDb)).toBe(-36);
  expect(await page.evaluate(() => MorphazoidSynthesis.getState().routing.effect.inputDb)).toBe(-36);
  await row.locator(".mz-input-toggle").click();
  await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "ended"))).toBe(true);
  await expect(row.locator(".mz-input-toggle")).toHaveAccessibleName("Activate microphone input");
  await choose(page, "inputCategory", "file");
  await expect(row.locator(".mz-input-file")).toBeVisible();
  expect(await page.evaluate(() => __familyInput.requests)).toBe(1);
  expect(errors).toEqual([]);
});

test("Synthesaurus cancels a late mic permission without arming output", async ({ page }) => {
  await installAudioInputFixture(page, true);
  await page.goto("/synthesis.html?method=fx-biquad");
  const mic = page.locator(".mz-input-toggle");
  expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
  await choose(page, "inputCategory", "microphone");
  await expect.poll(() => page.evaluate(() => __familyInput.requests), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => __familyInput.releases.length)).toBe(1);
  await expect(mic).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await mic.click();
  await page.evaluate(() => __familyInput.releases.splice(0).forEach(resolve => resolve()));
  await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "ended"))).toBe(true);
  await expect(mic).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => __familyInput.requests)).toBe(1);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

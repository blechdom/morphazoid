import { expect, test } from "@playwright/test";
import { installAudioInputFixture } from "./helpers/audio-input-fixture.mjs";

for (const route of ["graphs", "l-systems"]) {
  test(`${route}: mic input is independent of Audio and releases tracks`, async ({ page }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await installAudioInputFixture(page);
    await page.goto(`/${route}.html`);
    await page.locator("#modeMic").click();
    const row = page.locator(".mz-audio-input-strip");
    await expect(row).toBeVisible();
    expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
    await row.locator(".mz-input-toggle").click();
    await expect(row.locator(".mz-input-toggle")).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => row.locator("meter").first().evaluate(node => node.value)).toBeGreaterThan(.02);
    await row.locator('input[type="range"]').evaluate(node => { node.value = "0"; node.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect.poll(() => row.locator("meter").first().evaluate(node => node.value)).toBeLessThan(.001);
    await row.locator('input[type="range"]').evaluate(node => { node.value = "1.5"; node.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect(row.locator('input[type="range"]')).toHaveValue("1.5");
    await expect(row.locator(".mz-input-gain output")).toHaveText("150%");
    await expect.poll(() => row.locator("meter").first().evaluate(node => node.value)).toBeGreaterThan(.09);
    await row.locator(".mz-input-toggle").click();
    await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "ended"))).toBe(true);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => __familyInput.requests)).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`${route}: cancel pending mic then switch modes keeps the input off`, async ({ page }) => {
    await installAudioInputFixture(page, true);
    await page.goto(`/${route}.html`);
    await page.locator("#modeMic").click();
    const mic = page.locator(".mz-input-toggle");
    await mic.click();
    await expect.poll(() => page.evaluate(() => __familyInput.requests), { timeout: 15_000 }).toBe(1);
    await mic.click();
    await page.evaluate(() => __familyInput.releases.splice(0).forEach(resolve => resolve()));
    await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "ended"))).toBe(true);
    await expect(mic).toHaveAttribute("aria-pressed", "false");
  });
}

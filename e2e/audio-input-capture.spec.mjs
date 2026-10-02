import { test, expect } from "@playwright/test";
import { installAudioInputFixture } from "./helpers/audio-input-fixture.mjs";

async function installMic(page, delayed = false) {
  await page.addInitScript(({ delayed }) => {
    window.__captureMic = { calls: 0, stopped: 0, resolve: null };
    navigator.mediaDevices.getUserMedia = async () => {
      const data = window.__captureMic; data.calls += 1;
      const context = new AudioContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      gain.gain.value = 0.16; oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track); track.stop = () => { data.stopped += 1; stop(); };
      }
      return delayed ? new Promise((resolve) => { data.resolve = () => resolve(destination.stream); }) : destination.stream;
    };
  }, { delayed });
}

test("Recursion can retry after a pending source change and ignores the old grant", async ({ page }) => {
  await installAudioInputFixture(page, true);
  await page.goto("/recursion.html");
  const strip = page.locator(".mz-audio-input-strip");
  const button = strip.locator(".mz-input-toggle");
  await button.click();
  await expect.poll(() => page.evaluate(() => __familyInput.releases.length)).toBe(1);
  await strip.locator("select").selectOption("file");
  await expect(button).toHaveAttribute("aria-busy", "false");
  await strip.locator("select").selectOption("mic");
  await button.click();
  await expect.poll(() => page.evaluate(() => __familyInput.releases.length)).toBe(2);
  // Resolve the fresh request first, then the cancelled browser prompt.
  await page.evaluate(() => __familyInput.releases[1]());
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => __familyInput.releases[0]());
  await expect.poll(() => page.evaluate(() => __familyInput.tracks[0].readyState)).toBe("ended");
  expect(await page.evaluate(() => __familyInput.tracks[1].readyState)).toBe("live");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await button.click();
  await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "ended"))).toBe(true);
});

for (const id of ["recursion", "acoustic-manifold", "tape-worm", "loop-soup", "hollowphonic", "loopini"]) {
  test(`${id}: mic toggles with Audio off and gain controls the measured input`, async ({ page }) => {
    await installMic(page);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/${id}.html`);
    const strip = page.locator(".mz-audio-input-strip");
    await expect(strip).toHaveCount(1);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => window.__captureMic.calls)).toBe(0);
    await strip.locator(".mz-input-toggle").click();
    await expect(strip.locator(".mz-input-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => Number(await strip.locator("meter").first().evaluate((meter) => meter.value))).toBeGreaterThan(0.005);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await strip.locator('input[type="range"]').evaluate((input) => { input.value = "0"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect.poll(async () => Number(await strip.locator("meter").first().evaluate((meter) => meter.value))).toBeLessThan(0.001);
    await strip.locator(".mz-input-toggle").click();
    await expect(strip.locator(".mz-input-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(() => window.__captureMic.stopped)).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`${id}: cancelling pending permission releases a late stream`, async ({ page }) => {
    await installMic(page, true);
    await page.goto(`/${id}.html`);
    const button = page.locator(".mz-audio-input-strip .mz-input-toggle");
    await button.click();
    await expect.poll(() => page.evaluate(() => window.__captureMic.calls)).toBe(1);
    await expect(button).toHaveAttribute("aria-busy", "true");
    await button.click();
    await page.evaluate(() => window.__captureMic.resolve());
    await expect.poll(() => page.evaluate(() => window.__captureMic.stopped)).toBe(1);
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  });
}

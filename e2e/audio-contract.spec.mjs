import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

const audibleContracts = [
  {
    id: "karplus-strong",
    href: "karplus-strong.html",
    trigger: "#pluckButton",
  },
  {
    id: "ouroboros",
    href: "ouroboros.html",
    trigger: "[data-primary-transport]",
    stop: "[data-primary-transport]",
  },
];

test.describe("real-browser Web Audio contracts", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "initial audio probes run in Chromium");

  for (const contract of audibleContracts) {
    test(`${contract.id} produces bounded output and returns to silence`, async ({ page }, testInfo) => {
      await page.goto(contract.href, { waitUntil: "load" });

      const initial = await readAudioStatus(page);
      expect(initial.active, "audio must not start by itself").toBe(false);

      const audioButton = page.locator("#audioButton");
      await audioButton.click();
      await expect(audioButton).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
      await page.locator(contract.trigger).click();
      await waitForAudioState(page, true, 5000);

      const envelope = await sampleAudioEnvelope(page);
      await testInfo.attach(`${contract.id}-audio-envelope.json`, {
        body: JSON.stringify(envelope, null, 2),
        contentType: "application/json",
      });
      expect(envelope.summary.finite).toBe(true);
      expect(envelope.summary.activeSamples).toBeGreaterThan(0);
      expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
      expect(envelope.summary.clippedSamples).toBe(0);

      if (contract.stop) {
        const stop = page.locator(contract.stop);
        if (await stop.getAttribute("aria-pressed") === "true") await stop.click();
      }
      await audioButton.click();
      await expect(audioButton).toHaveAttribute("aria-pressed", "false", { timeout: 5000 });
      await waitForStableAudioState(page, false);
      expect((await readAudioStatus(page)).active).toBe(false);
    });
  }

  test("Karplus Strong output slider changes the rendered signal", async ({ page }, testInfo) => {
    await page.goto("karplus-strong.html", { waitUntil: "domcontentloaded" });

    const setRange = (selector, value) => page.locator(selector).evaluate((input, nextValue) => {
      input.value = String(nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);

    const audioButton = page.locator("#audioButton");
    await audioButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "true");

    await setRange("#level", 0);
    await expect(page.locator("#levelOut")).toHaveText("0%");
    await page.locator("#pluckButton").click();
    const quiet = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });

    await setRange("#level", 0.85);
    await expect(page.locator("#levelOut")).toHaveText("85%");
    await page.locator("#pluckButton").click();
    await waitForAudioState(page, true, 5000);
    const loud = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 50 });

    await testInfo.attach("karplus-strong-output-slider.json", {
      body: JSON.stringify({ quiet: quiet.summary, loud: loud.summary }, null, 2),
      contentType: "application/json",
    });
    expect(quiet.summary.maxPeak).toBeLessThan(0.001);
    expect(loud.summary.maxPeak).toBeGreaterThan(0.01);
    expect(loud.summary.maxRms).toBeGreaterThan(quiet.summary.maxRms + 0.001);
    expect(loud.summary.clippedSamples).toBe(0);

    await audioButton.click();
    await waitForStableAudioState(page, false);
  });
});

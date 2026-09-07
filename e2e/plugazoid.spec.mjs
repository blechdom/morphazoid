import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";
import {
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test.describe("Plugazoid browser plug-in host MVP", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "AudioWorklet coverage runs in Chromium");

  test("keeps Audio, input, processing, and teardown as distinct live states", async ({ page }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, {
      baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3435",
    });
    const response = await page.goto("plugazoid.html", { waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBe(true);
    await settlePage(page);

    const audioButton = page.locator("#audioButton");
    const micButton = page.locator("#micButton");
    const testToneButton = page.locator("#testToneButton");

    expect((await readAudioStatus(page)).active).toBe(false);
    await micButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "false");
    await expect(micButton).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#audioError")).toContainText("Turn on Audio first");

    await audioButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#runtimeState")).toContainText("worklet active");
    await expect(page.locator("#processorRuntime")).toHaveText("AudioWorklet JS");
    expect((await readAudioStatus(page)).active).toBe(false);

    await testToneButton.click();
    await expect(testToneButton).toHaveAttribute("aria-pressed", "true");
    await waitForAudioState(page, true);
    const warm = await sampleAudioEnvelope(page, { durationMs: 550, intervalMs: 45 });
    expect(warm.summary.finite).toBe(true);
    expect(warm.summary.maxPeak).toBeGreaterThan(0.005);
    expect(warm.summary.clippedSamples).toBe(0);

    await page.locator("#preset").selectOption("feral-port");
    await expect(testToneButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#driveOut")).toHaveText("18.0 dB");
    const feral = await sampleAudioEnvelope(page, { durationMs: 550, intervalMs: 45 });
    expect(feral.summary.finite).toBe(true);
    expect(feral.summary.clippedSamples).toBe(0);
    expect(Math.abs(feral.summary.meanRms - warm.summary.meanRms)).toBeGreaterThan(0.001);

    for (const [selector, value, cssName] of [
      ["#drive", 0, "--drive"],
      ["#drive", 24, "--drive"],
      ["#tone", 180, "--tone"],
      ["#tone", 14_000, "--tone"],
      ["#mix", 0, "--mix"],
      ["#mix", 1, "--mix"],
    ]) {
      await setRange(page, selector, value);
      const cssValue = await page.locator(".plugazoid-rack").evaluate(
        (rack, property) => getComputedStyle(rack).getPropertyValue(property).trim(),
        cssName,
      );
      expect(Number(cssValue)).toBeGreaterThanOrEqual(0);
      expect(Number(cssValue)).toBeLessThanOrEqual(1);
      await expect(testToneButton).toHaveAttribute("aria-pressed", "true");
    }

    await page.locator("#bypassButton").click();
    await expect(page.locator("#bypassButton")).toHaveAttribute("aria-pressed", "true");
    await waitForAudioState(page, true);
    await page.locator("#resetButton").click();
    await expect(page.locator("#bypassButton")).toHaveAttribute("aria-pressed", "false");
    await expect(testToneButton).toHaveAttribute("aria-pressed", "true");

    await setRange(page, "#outputLevel", 0);
    await waitForStableAudioState(page, false);
    await expect(testToneButton).toHaveAttribute("aria-pressed", "true");
    await setRange(page, "#outputLevel", 0.52);
    await waitForAudioState(page, true);

    await testToneButton.click();
    await expect(testToneButton).toHaveAttribute("aria-pressed", "false");
    await waitForStableAudioState(page, false);
    await audioButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);

    await testInfo.attach("plugazoid-audio-scenes.json", {
      body: JSON.stringify({ warm: warm.summary, feral: feral.summary }, null, 2),
      contentType: "application/json",
    });
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test("routes a microphone-shaped MediaStream and releases it on page teardown", async ({ page }) => {
    const diagnostics = watchPageDiagnostics(page, {
      baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3435",
    });
    await page.goto("plugazoid.html", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");

    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
          const context = new AudioContextConstructor();
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const destination = context.createMediaStreamDestination();
          oscillator.type = "triangle";
          oscillator.frequency.value = 173;
          gain.gain.value = 0.035;
          oscillator.connect(gain);
          gain.connect(destination);
          oscillator.start();
          await context.resume();
          window.__plugazoidMockMic = {
            context,
            oscillator,
            track: destination.stream.getAudioTracks()[0],
          };
          return destination.stream;
        },
      });
    });

    await page.locator("#micButton").click();
    await expect(page.locator("#micButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#inputState")).toHaveText("microphone live");
    await waitForAudioState(page, true);

    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#micButton")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(
      () => window.__plugazoidMockMic.track.readyState,
    )).toBe("ended");
    await page.evaluate(async () => {
      const mock = window.__plugazoidMockMic;
      try {
        mock.oscillator.stop();
      } catch {
        // The fixture may already have been released by the browser.
      }
      if (mock.context.state !== "closed") await mock.context.close();
    });

    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
});

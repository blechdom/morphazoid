import { expect, test } from "@playwright/test";

import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";
import {
  attachJson,
  canvasLayouts as layouts,
  captureSettledLayout,
  expectCanvasSizing,
} from "./helpers/canvas-preservation.mjs";

// Characterization of the unchanged Solid/Hyper reference. Screenshots and
// coarse meter reports are evidence, not approved timbre/waveform baselines.
const instruments = ["solid", "hyper"];

for (const layout of layouts) {
  test.describe(layout.name, () => {
    test.use({
      viewport: { width: layout.width, height: layout.height },
      deviceScaleFactor: layout.dpr,
      hasTouch: layout.touch,
    });

    for (const id of instruments) {
      test(`${id}: original sizing and silent transport`, async ({ page, baseURL, browser }, testInfo) => {
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        const response = await page.goto(`${id}.html`, { waitUntil: "load" });
        expect(response?.ok()).toBe(true);
        await settlePage(page);
        const sizing = await expectCanvasSizing(page);
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        const initial = await readAudioStatus(page);
        expect(initial.active).toBe(false);
        expect(initial.connectionCount).toBe(0);
        await captureSettledLayout(page, testInfo);

        await page.locator("#playButton").click();
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        expect((await readAudioStatus(page)).connectionCount).toBe(0);
        await page.locator("#playButton").click();
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
        await attachJson(testInfo, "layout-and-transport.json", {
          comparisonReferenceCommit: "4e9feed0748d94aa86500b0d63218b62b20138c6",
          browser: browser.version(),
          route: page.url(),
          layout,
          sizing,
          initial,
        });
      });
    }
  });
}

for (const id of instruments) {
  test(`${id}: audio survives resize and mode changes, then cleans up`, async ({ page, baseURL, browser }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`, { waitUntil: "load" });
    await settlePage(page);
    const audio = page.locator("#audioButton");
    const play = page.locator("#playButton");
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "true");
    await expect(play).toHaveAttribute("aria-pressed", "false");
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.0001);
    const connections = (await readAudioStatus(page)).connectionCount;
    expect(connections).toBeGreaterThan(0);

    const samples = [];
    for (const layout of layouts) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      const sizing = await expectCanvasSizing(page);
      await expect(audio).toHaveAttribute("aria-pressed", "true");
      await expect(play).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.0001);
      const envelope = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });
      expect(envelope.summary.activeSamples).toBeGreaterThan(0);
      expect(envelope.summary.clippedSamples).toBe(0);
      expect((await readAudioStatus(page)).connectionCount).toBe(connections);
      samples.push({ scene: `resize-${layout.name}`, sizing, envelope });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const soundSection = page.locator('details[data-section="sound"]');
    if (!await soundSection.evaluate((element) => element.open)) {
      await soundSection.locator("summary").click();
    }
    for (const mode of ["fm", "pm", "sine"]) {
      await page.locator("#soundMode").selectOption(mode);
      await expect(play).toHaveAttribute("aria-pressed", "true");
      await expect(audio).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.0001);
      const envelope = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });
      expect(envelope.summary.activeSamples).toBeGreaterThan(0);
      expect(envelope.summary.clippedSamples).toBe(0);
      samples.push({ scene: `mode-${mode}`, envelope });
    }

    const contexts = await page.evaluate(async () => {
      const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
      return [...getSharedAudioOutputManager(globalThis).contexts.keys()]
        .map((context) => ({ sampleRate: context.sampleRate, state: context.state }));
    });
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await waitForStableAudioState(page, false);
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    await attachJson(testInfo, "audio-characterization.json", {
      comparisonReferenceCommit: "4e9feed0748d94aa86500b0d63218b62b20138c6",
      browser: browser.version(),
      route: page.url(),
      contexts,
      measurement: "Coarse output-manager meters; not PCM capture or listening approval.",
      samples,
    });
  });
}

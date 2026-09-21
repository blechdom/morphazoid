import { expect, test } from "@playwright/test";

import { PHYSICS_SCENES } from "../src/families/physics/physics-scenes.js";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import {
  attachJson, canvasLayouts, captureSettledLayout, expectCanvasSizing,
} from "./helpers/canvas-preservation.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const lSystemIds = ["l-system", "l-system-drums", "l-systems"];
const routeIds = [...lSystemIds, ...PHYSICS_SCENES.map(({ id }) => id)];

for (const layout of canvasLayouts) {
  test.describe(layout.name, () => {
    test.use({
      viewport: { width: layout.width, height: layout.height },
      deviceScaleFactor: layout.dpr,
      hasTouch: layout.touch,
    });

    for (const id of routeIds) {
      test(`${id}: sizing, initial layout, and silent transport`, async ({ page, baseURL, browser }, testInfo) => {
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        const response = await page.goto(`${id}.html`, { waitUntil: "load" });
        expect(response?.ok()).toBe(true);
        await settlePage(page);
        const sizing = await expectCanvasSizing(page);
        const audio = page.locator("#audioButton");
        const play = page.locator("#playButton");
        await expect(audio).toHaveAttribute("aria-pressed", "false");
        await expect(play).toHaveAttribute("aria-pressed", "false");
        expect((await readAudioStatus(page)).connectionCount).toBe(0);
        await captureSettledLayout(page, testInfo);

        await play.click();
        await expect(play).toHaveAttribute("aria-pressed", "true");
        await expect(audio).toHaveAttribute("aria-pressed", "false");
        expect((await readAudioStatus(page)).connectionCount).toBe(0);
        await play.click();
        await expect(play).toHaveAttribute("aria-pressed", "false");
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
        await attachJson(testInfo, "layout-and-transport.json", {
          comparisonReferenceCommit: "4e9feed0748d94aa86500b0d63218b62b20138c6",
          browser: browser.version(), route: page.url(), layout, sizing,
        });
      });
    }
  });
}

// Exercise all three L-system controllers and one representative from each
// physics implementation module. Other physics routes get the layout/transport
// matrix above, not a claim of exhaustive sonic coverage.
for (const id of [...lSystemIds, "gravity-walk", "charge-garden"]) {
  test(`${id}: playback survives resize without arming microphone`, async ({ page, baseURL, browser }, testInfo) => {
    await page.addInitScript(() => {
      globalThis.__v2MicrophoneRequests = 0;
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          globalThis.__v2MicrophoneRequests += 1;
          throw new Error("Unexpected microphone request in a non-microphone scene.");
        };
      }
    });
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

    const scenes = [];
    for (const layout of canvasLayouts) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      const sizing = await expectCanvasSizing(page);
      await expect(audio).toHaveAttribute("aria-pressed", "true");
      await expect(play).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.0001);
      const envelope = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 40 });
      expect(envelope.summary.activeSamples).toBeGreaterThan(0);
      expect(envelope.summary.clippedSamples).toBe(0);
      expect((await readAudioStatus(page)).connectionCount).toBe(connections);
      scenes.push({ scene: `resize-${layout.name}`, sizing, envelope });
    }

    if (id === "l-systems") {
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const mode of ["notes", "triggers", "continuous"]) {
        const button = page.locator(`#playingMode [data-playing-mode="${mode}"]`);
        await button.click();
        await expect(button).toHaveAttribute("aria-selected", "true");
        await expect(play).toHaveAttribute("aria-pressed", "true");
        await expect(audio).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.0001);
        const envelope = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 40 });
        expect(envelope.summary.activeSamples).toBeGreaterThan(0);
        expect(envelope.summary.clippedSamples).toBe(0);
        scenes.push({ scene: `mode-${mode}`, envelope });
      }
    }

    const contexts = await page.evaluate(async () => {
      const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
      return [...getSharedAudioOutputManager(globalThis).contexts.keys()]
        .map((context) => ({ sampleRate: context.sampleRate, state: context.state }));
    });
    expect(await page.evaluate(() => globalThis.__v2MicrophoneRequests)).toBe(0);
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await waitForStableAudioState(page, false);
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    if (lSystemIds.includes(id)) {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
      await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    }
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    await attachJson(testInfo, "audio-characterization.json", {
      comparisonReferenceCommit: "4e9feed0748d94aa86500b0d63218b62b20138c6",
      browser: browser.version(), route: page.url(), contexts,
      measurement: "Coarse meters, not PCM or listening approval. Physics teardown beyond mute is not measured.",
      scenes,
    });
  });
}

import { expect, test } from "@playwright/test";
import { createShapesState, SHAPES_STORAGE_KEY } from "../src/instruments/shapes/shapes-state.js";
import { sampleAudioEnvelope, readAudioStatus } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "portrait", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 },
];
for (const viewport of viewports) test.describe(viewport.name, () => {
  test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.name !== "desktop" });
  for (const dimension of ["2d", "3d", "4d"]) {
  test(`${viewport.name} ${dimension}: triangle/square/saw Continuous and Notes remain armed, audible and bounded`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(45000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    const state = createShapesState({ selection: { dimension }, play: { running: true, rateCyclesPerSecond: 0.65, divisions: 2 }, voice: { baseHz: 165, rangeOctaves: 2 }, synthesis: { model: "geometry" } });
    await page.addInitScript(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: SHAPES_STORAGE_KEY, state });
    await page.goto("shapes.html");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#voiceEngine").selectOption("triangle");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await page.locator("#audioButton").click();
    const results = [];
    for (const mode of ["continuous", "notes"]) {
      await page.locator(`#playingMode [data-playing-mode="${mode}"]`).click();
      for (const engine of ["triangle", "square", "saw"]) {
        await page.locator("#voiceEngine").selectOption(engine);
        await page.waitForTimeout(150);
        const signal = await sampleAudioEnvelope(page, { durationMs: 2200 });
        results.push({ mode, engine, ...signal.summary });
        expect(signal.summary.finite).toBe(true);
        expect(signal.summary.clippedSamples).toBe(0);
        expect(signal.summary.maxRms).toBeGreaterThan(0.001);
        await expect(page.locator("#voiceEngine")).toHaveValue(engine);
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
        expect((await readAudioStatus(page)).connectionCount).toBe(1);
        const saved = await page.evaluate(async () => (await import("/src/site/header-presets.js")).captureHeaderPresetState());
        expect(saved.snapshot.parameters.voice.engine).toBe(engine);
      }
    }
    expect(await page.locator(".shapes-panel-scroll").evaluate(node => node.clientHeight)).toBeGreaterThan(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#audioButton").click();
    await page.waitForTimeout(500);
    expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    await testInfo.attach("waveform-signal.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  });
}
});

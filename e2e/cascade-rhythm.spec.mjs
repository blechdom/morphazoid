import { expect, test } from "@playwright/test";
import { CASCADING_FM_FULL_PRESETS, CASCADING_PM_FULL_PRESETS } from "../src/families/cascading/full-presets.js";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages, settlePage } from "./helpers/diagnostics.mjs";

const banks = [["cascading-fm", CASCADING_FM_FULL_PRESETS], ["cascading-pm", CASCADING_PM_FULL_PRESETS]];
const snapshot = page => page.evaluate(async () => {
  const { captureHeaderPresetState } = await import("/src/site/header-presets.js");
  return captureHeaderPresetState();
});
async function choose(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`.header-preset-picker [data-full-preset][data-preset-id="${id}"]`).click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", id);
}

for (const [id, bank] of banks) {
  test(`${id}: default, main menu and Reset agree on the new slow-LFO bank`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`);
    await settlePage(page);
    expect((await snapshot(page)).snapshot).toEqual(bank[0].snapshot);
    await expect(page.locator("#presetState")).toHaveText("Slow Steps");
    await expect(page.locator("#rootReadout")).toContainText("0.5");
    await expect(page.locator("#presetButtons")).toHaveCount(0);
    await expect(page.locator(".header-preset-picker details")).toHaveCount(0);
    await expect(page.locator(".header-preset-picker")).not.toContainText("Edit preset ingredients");
    for (const preset of bank) {
      await choose(page, preset.id);
      expect((await snapshot(page)).snapshot).toEqual(preset.snapshot);
      await expect(page.locator("#presetState")).toHaveText(preset.label);
      await expect(page.locator("#presetDescription")).toHaveText(preset.description);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    }
    await page.locator(id === "cascading-fm" ? "#resetCascadingFm" : "#resetCascadingPm").click();
    expect((await snapshot(page)).snapshot).toEqual(bank[0].snapshot);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test(`${id}: live scene changes retain one audio owner, output and cleanup`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(60000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`);
    await settlePage(page);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBeGreaterThan(0);
    const initial = await readAudioStatus(page);
    const samples = [];
    for (const presetId of ["slow-steps", "simple-sway", "pocket-pulse", "drifting-beats", "busy-weave"]) {
      await choose(page, presetId);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      expect((await readAudioStatus(page)).connectionCount).toBe(initial.connectionCount);
      const envelope = await sampleAudioEnvelope(page, { durationMs: 1800 });
      expect(envelope.summary.finite).toBe(true);
      expect(envelope.summary.maxPeak).toBeGreaterThan(0.0001);
      expect(envelope.summary.clippedSamples).toBe(0);
      samples.push({ presetId, envelope });
    }
    await testInfo.attach("cascade-playback.json", { body: JSON.stringify(samples), contentType: "application/json" });
    await page.evaluate(() => dispatchEvent(new Event("pagehide")));
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { voicePresetState } from "../src/throatazoid.js";
import { createTractGeometryHarness } from "../tests/helpers/tract-geometry-harness.mjs";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { attachJson, canvasLayouts } from "./helpers/canvas-preservation.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const fixture = JSON.parse(await readFile(new URL("../tests/fixtures/tract-geometry-v1.json", import.meta.url)));
const reference = createTractGeometryHarness(fixture.records[0]);
const instruments = ["throatazoid", "alien-larynx"];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__tractMicRequests = 0;
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => {
        globalThis.__tractMicRequests += 1;
        throw new Error("Microphone access is outside these synthetic-source tests.");
      };
    }
  });
});

async function controls(page) {
  return page.evaluate(() => {
    const ids = [
      "throatCount", "tongueCount", "noseCount", "selectedTonguePosition",
      "selectedTongueHeight", "selectedTongueCurl", "articulationPlace", "articulationAperture",
    ];
    return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)?.value ?? null]));
  });
}

async function stageBounds(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("stage");
    const box = canvas.getBoundingClientRect();
    const wrap = document.getElementById("stageWrap").getBoundingClientRect();
    return {
      left: box.left, top: box.top,
      width: Math.max(1, Math.round(wrap.width)),
      height: Math.max(1, Math.round(wrap.height)),
      backingWidth: canvas.width, backingHeight: canvas.height,
    };
  });
}

for (const layout of canvasLayouts) {
  test.describe(layout.name, () => {
    test.use({
      viewport: { width: layout.width, height: layout.height },
      deviceScaleFactor: layout.dpr, hasTouch: layout.touch,
    });
    for (const id of instruments) {
      test(`${id}: default and multi-mouth layouts retain their controls`, async ({ page, baseURL, browser }, testInfo) => {
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        const response = await page.goto(`${id}.html`, { waitUntil: "load" });
        expect(response?.ok()).toBe(true);
        await settlePage(page);
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        expect((await readAudioStatus(page)).connectionCount).toBe(0);
        const initial = { bounds: await stageBounds(page), controls: await controls(page) };
        await testInfo.attach("default-tract.png", {
          body: await page.locator("#stage").screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
        await page.locator("#stage").focus();
        await page.keyboard.press("4");
        await expect(page.locator("#throatCount")).toHaveValue("7");
        await settlePage(page);
        const hydra = { bounds: await stageBounds(page), controls: await controls(page) };
        await testInfo.attach("hydra-tract.png", {
          body: await page.locator("#stage").screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
        await page.keyboard.press("2");
        await expect(page.locator("#throatCount")).toHaveValue("1");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        expect((await readAudioStatus(page)).connectionCount).toBe(0);
        expect(await page.evaluate(() => globalThis.__tractMicRequests)).toBe(0);
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
        await attachJson(testInfo, "tract-layouts.json", {
          route: page.url(), browser: browser.version(), layout, initial, hydra,
          oracle: await controls(page),
        });
      });
    }
  });
}

for (const id of instruments) {
  test(`${id}: direct tongue drag remains aligned across a held-pointer resize`, async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`, { waitUntil: "load" });
    await settlePage(page);
    const bounds = await stageBounds(page);
    reference.setScene(voicePresetState("clear"), { ...bounds, selectedThroat: 0 });
    const handle = reference.call("tractGeometry").tongueHandles[0].handle;
    const before = await controls(page);
    const x = bounds.left + handle.x;
    const y = bounds.top + handle.y;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect(page.locator("#stage")).toHaveClass(/is-dragging/);
    await page.mouse.move(x + 30, y - 24, { steps: 6 });
    const dragged = await controls(page);
    expect([dragged.selectedTonguePosition, dragged.selectedTongueHeight])
      .not.toEqual([before.selectedTonguePosition, before.selectedTongueHeight]);
    await page.setViewportSize({ width: 1100, height: 760 });
    await settlePage(page);
    await page.mouse.move(x + 45, y - 12, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator("#stage")).not.toHaveClass(/is-dragging/);
    const resized = await controls(page);
    for (const name of ["selectedTonguePosition", "selectedTongueHeight", "selectedTongueCurl"]) {
      expect(Number.isFinite(Number(resized[name]))).toBe(true);
      expect(Number(resized[name])).toBeGreaterThanOrEqual(0);
      expect(Number(resized[name])).toBeLessThanOrEqual(1);
    }
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    await attachJson(testInfo, "tract-drag.json", { route: page.url(), before, dragged, resized });
  });

  test(`${id}: synthetic voice, phonemes, anatomy changes, and resize remain continuous`, async ({ page, baseURL, browser }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`, { waitUntil: "load" });
    await settlePage(page);
    await expect(page.locator('#sourceButtons [data-source="glottis"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.0001);
    const connections = (await readAudioStatus(page)).connectionCount;
    const scenes = [];
    for (const phoneme of ["e", "o", "a"]) {
      const button = page.locator(`#phonemeButtons [data-phoneme="${phoneme}"]`);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.0001);
      const envelope = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 40 });
      expect(envelope.summary.activeSamples).toBeGreaterThan(0);
      expect(envelope.summary.clippedSamples).toBe(0);
      scenes.push({ scene: `phoneme-${phoneme}`, envelope, controls: await controls(page) });
    }
    await page.locator("#stage").focus();
    await page.keyboard.press("1");
    await expect(page.locator("#throatCount")).toHaveValue("3");
    for (const layout of canvasLayouts.slice(1)) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.0001);
      const envelope = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 40 });
      expect(envelope.summary.activeSamples).toBeGreaterThan(0);
      expect(envelope.summary.clippedSamples).toBe(0);
      expect((await readAudioStatus(page)).connectionCount).toBe(connections);
      scenes.push({ scene: `triune-${layout.name}`, envelope, controls: await controls(page) });
    }
    expect(await page.evaluate(() => globalThis.__tractMicRequests)).toBe(0);
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await waitForStableAudioState(page, false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    await attachJson(testInfo, "tract-audio.json", {
      route: page.url(), browser: browser.version(),
      measurement: "Coarse output meters, not PCM or listening approval.", scenes,
    });
  });
}

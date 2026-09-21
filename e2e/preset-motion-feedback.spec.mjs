import { expect, test } from "@playwright/test";
import { SOLID_FULL_PRESETS, HYPER_FULL_PRESETS } from "../src/families/geometry-presets/full-presets.js";
import { SHAPE_FULL_PRESETS } from "../src/instruments/shape-synth/full-presets.js";
import { FAVES_PRESET_CASES } from "../tests/helpers/faves-preset-cases.mjs";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

const otherIds = ["shape-synth", "hiccup-head", "creaturazoid", "karplus-strong", "cascading-fm", "cascading-pm", "dijkstra", "hanoi", "minimax", "nqueens", "euclid"];
const routes = [...FAVES_PRESET_CASES.map(p => ({ id: p.id, href: p.href })), ...otherIds.map(id => ({ id, href: `${id}.html` }))];
for (const { id, href } of routes) {
  test(`${id}: startup says Select Preset without selecting or applying a scene`, async ({ page }) => {
    await page.goto(href);
    const root = page.locator(".header-preset-controls");
    await expect(root.locator(".instrument-picker-current")).toHaveText("Select Preset");
    await expect(root).toHaveAttribute("data-preset-id", "unselected");
    await expect(root.locator('button[data-full-preset][aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
  });
}

async function select(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`.header-preset-picker button[data-preset-id="${id}"]`).click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", id);
}
for (const [kind, bank] of [["solid", SOLID_FULL_PRESETS], ["hyper", HYPER_FULL_PRESETS]]) {
  test(`${kind}: every preset recalls its own motion flags and bounded voices without arming Audio`, async ({ page, baseURL }) => {
    test.setTimeout(90000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${kind}-synth.html`);
    await expect(page.locator(".instrument-picker-current").last()).toBeVisible();
    await page.locator(".header-preset-next").click();
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", bank[0].id);
    for (const preset of bank) {
      await select(page, preset.id);
      const p = preset.snapshot.parameters;
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", String(p.playing));
      await expect(page.locator("#voiceLimit")).toHaveValue(String(p.voiceLimit));
      for (const key of Object.keys(p).filter(key => key.endsWith("Playing"))) {
        await expect(page.locator(`#${key.replace(/Playing$/, "Play")}`)).toHaveAttribute("aria-pressed", String(p[key]));
      }
      if (!p.playing) await expect(page.locator("#position")).toHaveValue("0.5");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    }
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  for (const id of kind === "solid"
    ? ["original-cube", "octahedron-chimes", "sphere-shepard", "plane-prism-skip", "shape-cube-orbit"]
    : ["original-tesseract", "klein-reed", "endless-hypersphere", "velvet-tesseract", "shape-tesseract-spin"]) {
    test(`${kind}/${id}: preset plays without another Play click after Audio is armed`, async ({ page, baseURL }, testInfo) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto(`${kind}-synth.html`);
      await select(page, id);
      await page.locator("#audioButton").click();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      const envelope = await sampleAudioEnvelope(page, { durationMs: 2400, intervalMs: 100 });
      expect(envelope.summary.finite).toBe(true);
      expect(envelope.summary.clippedSamples).toBe(0);
      expect(envelope.summary.maxRms).toBeGreaterThan(0.002);
      if (id.startsWith("shape-")) {
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("#position")).toHaveValue("0.5");
      }
      expect((await readAudioStatus(page)).connectionCount).toBe(1);
      await testInfo.attach("audio-summary.json", { body: JSON.stringify(envelope), contentType: "application/json" });
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  }
}

test("Shape has no paused scene, while manual pause and Audio remain independent", async ({ page }) => {
  await page.goto("shape-synth.html");
  await expect(page.locator(".header-preset-picker button[data-full-preset]")).toHaveCount(SHAPE_FULL_PRESETS.length);
  await expect(page.locator('.header-preset-picker button[data-preset-id="hands-on-sketch"]')).toHaveCount(0);
  await page.locator(".header-preset-next").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });
    for (const kind of ["solid", "hyper"]) {
      test(`${kind}: placeholder, menu, next and dice stay reachable`, async ({ page }) => {
        await page.goto(`${kind}-synth.html`);
        const root = page.locator(".header-preset-controls");
        await expect(root.locator(".instrument-picker-current")).toHaveText("Select Preset");
        for (const selector of [".header-preset-picker > summary", ".header-preset-next", ".header-preset-random"]) {
          const control = root.locator(selector);
          await expect(control).toBeVisible();
          const rect = await control.boundingBox();
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(rect.height).toBeGreaterThanOrEqual(48);
        }
        await root.locator(".header-preset-next").click();
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      });
    }
  });
}

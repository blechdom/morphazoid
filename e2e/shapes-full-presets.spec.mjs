import { expect, test } from "@playwright/test";
import { SHAPES_FULL_PRESETS } from "../src/instruments/shapes/full-presets.js";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

async function select(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`.header-preset-picker button[data-preset-id="${id}"]`).click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", id);
}
const capture = page => page.evaluate(async () => (await import("/src/site/header-presets.js")).captureHeaderPresetState());

test("Shapes: one Corners & Notes mode exposes subdivisions, real synth ADSR and pre-marker swell", async ({ page }) => {
  await page.goto("shapes.html?playing=corners");
  await expect(page.locator('[data-playing-mode="corners"]')).toHaveCount(0);
  await expect(page.locator('#playingMode [data-playing-mode="notes"]')).toHaveText("Corners & Notes");
  await expect(page.locator("#voiceEngine")).toHaveValue("percussion");
  await expect(page.locator("#divisions")).toHaveValue("1");
  await select(page, "shapes-folded-notes");
  await expect(page.locator("#voiceEngine")).toHaveValue("pm");
  await page.locator("#mappingBankTab").click();
  await expect(page.locator('[data-note="swell"]')).toBeChecked();
  await page.locator('[data-note-envelope] [data-preset="pad"]').click();
  expect((await capture(page)).snapshot.parameters.notes.preset).toBe("pad");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click();
  const signal = await sampleAudioEnvelope(page, { durationMs: 2400 });
  expect(signal.summary.maxRms).toBeGreaterThan(0.001);
  expect(signal.summary.clippedSamples).toBe(0);
});

test("Shapes: each Point/Radar direction and Line axis is editable, with spacing retained", async ({ page }) => {
  await page.goto("shapes.html");
  await select(page, "shape-crossed-scanners");
  const before = await capture(page);
  await page.locator("#headOption1").click();
  let current = await capture(page);
  expect(current.snapshot.parameters.dimension["2d"].scanLineAxes[1]).not.toBe(before.snapshot.parameters.dimension["2d"].scanLineAxes[1]);
  expect(current.snapshot.parameters.dimension["2d"].headOffsets).toEqual(before.snapshot.parameters.dimension["2d"].headOffsets);
  for (const reader of ["points", "radar"]) {
    await page.locator("#readerSelect").selectOption(reader);
    await page.locator("#headOption0").click();
    current = await capture(page);
    expect(current.snapshot.parameters.dimension["2d"][reader === "points" ? "traceHeadDirections" : "radialHeadDirections"][0]).toBe(-1);
  }
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("Shapes: all 106 recalls are exact, update dimension/motion and never arm Audio", async ({ page, baseURL }) => {
  test.setTimeout(120000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("shapes.html");
  await expect(page.locator(".header-preset-controls .instrument-picker-current")).toHaveText("Select Preset");
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "unselected");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  for (const preset of SHAPES_FULL_PRESETS) {
    await select(page, preset.id);
    const result = await capture(page);
    expect(result.snapshot).toEqual(preset.snapshot);
    await expect(page.locator("#dimensionSelect")).toHaveValue(preset.snapshot.parameters.selection.dimension);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", String(preset.snapshot.parameters.play.running));
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  }
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Shapes: full controls edit sound state and curve keyboard edits keep focus", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("shapes.html");
  await select(page, "shape-glass-star");
  await page.locator("#mappingBankTab").click();
  await page.locator('[data-tone="fmRatio"]').fill("0.75");
  expect((await capture(page)).snapshot.parameters.synthesis.tone.fmRatio).toBe(0.75);
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  const node = page.locator("[data-pitch-node='2']");
  await node.focus();
  const before = (await capture(page)).snapshot.parameters.synthesis.tone.pitchCurveNodes[2].y;
  await node.press("ArrowUp");
  expect((await capture(page)).snapshot.parameters.synthesis.tone.pitchCurveNodes[2].y).toBeCloseTo(before + 0.01, 8);
  await expect(node).toBeFocused();
  const amplitude = page.locator("[data-shape-envelope] [data-node='2']");
  await amplitude.focus();
  await amplitude.press("ArrowUp");
  await expect(amplitude).toBeFocused();
  expect((await capture(page)).snapshot.parameters.synthesis.tone.amplitudePreset).toBe("custom");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Shapes: dice generates parameters across dimensions and leaves Audio/output alone", async ({ page }) => {
  await page.goto("shapes.html");
  await select(page, "shape-square-study");
  const dimensions = new Set();
  for (let i = 0; i < 24; i++) {
    await page.locator(".header-preset-random").click();
    const current = await capture(page);
    dimensions.add(current.snapshot.parameters.selection.dimension);
    expect(current.selectedId).toBe(null);
    expect(SHAPES_FULL_PRESETS.some(p => JSON.stringify(p.snapshot) === JSON.stringify(current.snapshot))).toBe(false);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#level")).toHaveValue("0.65");
  }
  expect(dimensions.size).toBe(3);
});

const audioIds = [
  "shape-square-study", "solid-original-cube", "hyper-original-tesseract",
  "solid-shape-cube-orbit", "hyper-shape-tesseract-spin",
  "shape-crossed-scanners", "shape-glass-star", "hyper-klein-reed",
  "solid-sphere-shepard", "hyper-endless-hypersphere", "hyper-velvet-tesseract",
  "solid-plane-prism-skip", "hyper-pyramid-knocks",
  ...SHAPES_FULL_PRESETS.filter(p => p.source.kind === "shape" && p.snapshot.parameters.voice.engine === "percussion").slice(0, 3).map(p => p.id),
];
test("Shapes: live mixed-dimension tour remains armed, finite, audible and bounded, then stops", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const diagnostics = watchPageDiagnostics(page, { baseURL }), results = [];
  await page.goto("shapes.html");
  await select(page, audioIds[0]);
  await page.locator("#audioButton").click();
  for (const id of audioIds) {
    await select(page, id);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 1500, intervalMs: 90 });
    results.push({ id, ...envelope.summary });
    expect(envelope.summary.finite, id).toBe(true);
    expect(envelope.summary.clippedSamples, id).toBe(0);
    expect(envelope.summary.maxRms, id).toBeGreaterThan(0.001);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
  }
  await page.locator("#audioButton").click();
  await page.waitForTimeout(500);
  expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
  await testInfo.attach("live-tour.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Shapes: original extra Notes/Triggers banks, MIDI note release and saved state still work", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("shapes.html");
  await select(page, "solid-original-cube");
  await page.locator("#audioButton").click();
  await page.locator('#playingMode [data-playing-mode="notes"]').click();
  await page.locator("#playButton").click();
  const midi = async type => page.evaluate(type => {
    window.dispatchEvent(new CustomEvent("morphazoid:midi-input", {
      cancelable: true, detail: { routeId: "shapes", message: { type, note: 60, velocity: 100 } },
    }));
  }, type);
  await midi("noteOn");
  expect((await sampleAudioEnvelope(page, { durationMs: 400 })).summary.maxRms).toBeGreaterThan(0.001);
  await midi("noteOff");
  await page.waitForTimeout(400);
  expect((await readAudioStatus(page)).rms).toBeLessThan(0.001);
  await page.locator("#playButton").click();
  for (const mode of ["notes", "triggers"]) {
    await page.locator(`#playingMode [data-playing-mode="${mode}"]`).click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    const signal = await sampleAudioEnvelope(page, { durationMs: 1000 });
    expect(signal.summary.maxRms).toBeGreaterThan(0.001);
    expect(signal.summary.clippedSamples).toBe(0);
  }
  await page.locator("#triggerSoundBank").selectOption("fm-kit");
  const signal = await sampleAudioEnvelope(page, { durationMs: 1000 });
  expect(signal.summary.maxRms).toBeGreaterThan(0.001);
  await page.locator("#audioButton").click();
  await page.reload();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#triggerSoundBank")).toHaveValue("fm-kit");
  await expect(page.locator(".header-preset-controls .instrument-picker-current")).toHaveText("Select Preset");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Shapes: BFCache restoration keeps the preset menu, clears held audio and can explicitly rearm", async ({ page }) => {
  await page.goto("shapes.html");
  await select(page, "solid-original-cube");
  await page.locator("#audioButton").click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page.locator(".header-preset-controls")).toHaveCount(1);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator(".header-preset-next").click();
  const next = SHAPES_FULL_PRESETS[SHAPES_FULL_PRESETS.findIndex(p => p.id === "solid-original-cube") + 1].id;
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", next);
  await page.locator("#audioButton").click();
  const signal = await sampleAudioEnvelope(page, { durationMs: 1000 });
  expect(signal.summary.maxRms).toBeGreaterThan(0.001);
  expect(signal.summary.clippedSamples).toBe(0);
});

test("Shapes: every factory scene produces bounded audio after an explicit Audio action", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(240000);
  const diagnostics = watchPageDiagnostics(page, { baseURL }), results = [];
  await page.goto("shapes.html");
  await page.locator("#audioButton").click();
  for (const preset of SHAPES_FULL_PRESETS) {
    await select(page, preset.id);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 1000, intervalMs: 100 });
    results.push({ id: preset.id, ...envelope.summary });
    expect(envelope.summary.finite, preset.id).toBe(true);
    expect(envelope.summary.clippedSamples, preset.id).toBe(0);
    // A short sample can catch an intended rest. Retry once across a longer
    // phrase instead of treating legitimate envelope gaps as broken synthesis.
    const maximum = envelope.summary.maxRms > 0.0001 ? envelope.summary.maxRms
      : (await sampleAudioEnvelope(page, { durationMs: 3000, intervalMs: 100 })).summary.maxRms;
    expect(maximum, preset.id).toBeGreaterThan(0.0001);
  }
  await testInfo.attach("all-106-audio.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const initialSeed of [4913, 9417]) test(`Shapes: seeded live dice ${initialSeed} produces audible scenes in all three modes without rearming`, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.addInitScript(initialSeed => {
    let seed = initialSeed;
    globalThis.__qaPresetRandom = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  }, initialSeed);
  // Seed the header's existing RNG seam, not Math.random used by drum noise.
  // Audio scheduling must not change which parameter scene a failing seed means.
  await page.route("**/src/instruments/shapes/shapes-app.js", async route => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain("randomize: randomizeShapesPreset,");
    await route.fulfill({ response, body: source.replace("randomize: randomizeShapesPreset,", "random: globalThis.__qaPresetRandom, randomize: randomizeShapesPreset,") });
  });
  await page.goto("shapes.html");
  await page.locator("#audioButton").click();
  const results = [], modes = new Set();
  for (let index = 0; index < 24; index++) {
    await page.locator(".header-preset-random").click();
    const current = await capture(page);
    modes.add(current.snapshot.parameters.selection.playingMode);
    let signal = await sampleAudioEnvelope(page, { durationMs: 1000, intervalMs: 100 });
    if (signal.summary.maxRms < 0.0003) signal = await sampleAudioEnvelope(page, { durationMs: 3000, intervalMs: 100 });
    results.push({ index, snapshot: current.snapshot, ...signal.summary });
    await testInfo.attach(`random-${index}.json`, { body: JSON.stringify(results.at(-1)), contentType: "application/json" });
    expect(signal.summary.finite, `roll ${index}`).toBe(true);
    expect(signal.summary.clippedSamples, `roll ${index}`).toBe(0);
    expect(signal.summary.maxRms, `roll ${index}: ${JSON.stringify(current.snapshot)}`).toBeGreaterThan(0.0003);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  }
  expect([...modes].sort()).toEqual(["continuous", "notes", "triggers"]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });
    test("Shapes: header and parity controls are reachable without horizontal overflow", async ({ page }, testInfo) => {
      await page.goto("shapes.html");
      for (const selector of [".header-preset-picker > summary", ".header-preset-next", ".header-preset-random"]) {
        const node = page.locator(selector);
        await expect(node).toBeVisible();
        const box = await node.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.height).toBeGreaterThanOrEqual(48);
      }
      await select(page, "shape-crossed-scanners");
      await page.locator("#mappingBankTab").click();
      const ratio = page.locator('[data-tone="pmRatio"]');
      await ratio.scrollIntoViewIfNeeded();
      await ratio.fill("3.5");
      expect((await capture(page)).snapshot.parameters.synthesis.tone.pmRatio).toBe(3.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await testInfo.attach("phone-layout.png", { body: await page.screenshot(), contentType: "image/png" });
    });
  });
}

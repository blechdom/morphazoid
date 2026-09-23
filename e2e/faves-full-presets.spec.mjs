import { expect, test } from "@playwright/test";
import { FAVES_PRESET_CASES } from "../tests/helpers/faves-preset-cases.mjs";
import { readAudioStatus } from "./helpers/audio-probe.mjs";
import { settlePage, watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

// Capture in the same task as the native button action: automatic cube turns,
// grammar evolution and dynamic reference gestures may legitimately change a
// score afterwards. This checks complete recall, not an impossible frozen score.
async function recallAndCapture(page, id) {
  return page.evaluate(async presetId => {
    const { captureHeaderPresetState } = await import("/src/site/header-presets.js");
    const button = document.querySelector(`.header-preset-picker button[data-preset-id="${presetId}"]`);
    if (!button) throw new Error(`Missing preset ${presetId}`);
    button.click();
    return captureHeaderPresetState();
  }, id);
}
async function randomizeAndCapture(page) {
  return page.evaluate(async () => {
    const { captureHeaderPresetState } = await import("/src/site/header-presets.js");
    document.querySelector(".header-preset-random").click();
    return captureHeaderPresetState();
  });
}

async function browserReferenceBank(page, entry) {
  if (!["graph-delay", "graph-synth"].includes(entry.id)) return entry.bank;
  // Graph layouts use transcendental math. Node and Chromium can differ by one
  // floating-point bit, even with the same seed. Compare recall EXACTLY with
  // the bank authored in this browser, not a rounded/tolerant capture. This
  // imports the independent factory, never the state returned by the adapter.
  const bank = await page.evaluate(async id => {
    const presets = await import("/src/families/graph-presets/full-presets.js");
    if (id === "graph-delay") return presets.GRAPH_DELAY_FULL_PRESETS;
    const { graphInstrumentDefaultState } = await import("/src/families/graph/graph-instrument-app.js");
    return presets.graphSynthFullPresets(graphInstrumentDefaultState());
  }, entry.id);
  expect(bank.map(({ id, label }) => ({ id, label })))
    .toEqual(entry.bank.map(({ id, label }) => ({ id, label })));
  return bank;
}

for (const entry of FAVES_PRESET_CASES) {
  test(`${entry.id}: all scenes and dice use complete state without arming Audio or permissions`, async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.addInitScript(() => {
      globalThis.__presetPermissionRequests = [];
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
        globalThis.__presetPermissionRequests.push("getUserMedia");
        throw new Error("Preset must not request devices");
      };
    });
    await page.goto(entry.href, { waitUntil: "load" });
    await settlePage(page);
    const bank = await browserReferenceBank(page, entry);
    await expect(page.locator(".header-preset-controls")).toHaveCount(1);
    await expect(page.locator(".header-preset-picker button[data-full-preset]")).toHaveCount(entry.bank.length);
    await expect(page.locator(".header-preset-next")).toBeVisible();
    await expect(page.getByRole("button", { name: "Randomize instrument parameters", exact: true })).toBeVisible();
    for (const preset of bank) {
      const actual = await recallAndCapture(page, preset.id);
      expect(actual.instrumentId).toBe(entry.id);
      expect(actual.selectedId).toBe(preset.id);
      expect(actual.snapshot).toEqual(preset.snapshot);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    }
    for (let roll = 0; roll < 4; roll++) {
      const actual = await randomizeAndCapture(page);
      expect(actual.selectedId).toBeNull();
      expect(() => entry.validate(actual.snapshot)).not.toThrow();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    }
    expect((await recallAndCapture(page, bank[0].id)).snapshot).toEqual(bank[0].snapshot);
    expect(await page.evaluate(() => globalThis.__presetPermissionRequests)).toEqual([]);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 900 });
    for (const id of ["solid-synth", "rubix", "hybrinx", "graph-delay", "cellular-automata"]) {
      const entry = FAVES_PRESET_CASES.find(item => item.id === id);
      test(`${id}: new preset controls stay reachable and in order`, async ({ page }) => {
        await page.goto(entry.href);
        await settlePage(page);
        const controls = page.locator(".header-preset-controls");
        for (const selector of [".header-preset-picker > summary", ".header-preset-next", ".header-preset-random"]) {
          await expect(controls.locator(selector)).toBeVisible();
          const bounds = await controls.locator(selector).boundingBox();
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
          if (viewport.width < 900) expect(bounds.height).toBeGreaterThanOrEqual(48);
        }
        await controls.locator(".header-preset-next").focus();
        await page.keyboard.press("Tab");
        await expect(controls.locator(".header-preset-random")).toBeFocused();
        await controls.locator(".header-preset-picker > summary").click();
        await expect(controls.locator(".instrument-picker-panel")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      });
    }
  });
}

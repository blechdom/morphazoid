import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { SPARTIAL_FULL_PRESETS } from "../src/instruments/spartial/full-presets.js";
import { sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const diagnostics = new WeakMap();
const storageKey = "morphazoid:spartial:presets:v1";

test.beforeEach(async ({ page, baseURL }) => {
  diagnostics.set(page, watchPageDiagnostics(page, { baseURL }));
});
test.afterEach(async ({ page }) => {
  expect(pageDiagnosticMessages(diagnostics.get(page))).toEqual([]);
});

async function open(page) {
  expect((await page.goto("spartial.html"))?.ok()).toBe(true);
  await settlePage(page);
  await expect(page.locator("#addUserPreset")).toBeVisible();
}
async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function save(page, name) {
  await page.locator("#addUserPreset").click();
  await expect(page.locator("#userPresetName")).toBeFocused();
  await page.locator("#userPresetName").fill(name);
  await page.locator("#userPresetForm button[type=submit]").click();
  await expect(page.locator("#userPresetForm")).toBeHidden();
}
async function select(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`.header-preset-picker button[data-preset-id="${id}"]`).click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", id);
}
async function current(page) {
  return page.evaluate(async () => (await import("/src/site/header-presets.js")).captureHeaderPresetState());
}
async function upload(page, text) {
  await page.locator("#userPresetFile").setInputFiles({
    name: "spartial-presets.json", mimeType: "application/json", buffer: Buffer.from(text),
  });
}

test("save, recall and delete a named full scene; auto-save survives a reload without arming Audio", async ({ page }) => {
  await open(page);
  await page.locator('details[data-section="sound"] > summary').click();
  await page.locator("#layout").selectOption("7-1");
  await setRange(page, "#level", 0.21);
  await setRange(page, "#drive", 0.47);
  await page.locator("#organMode").selectOption("tonewheel");
  await setRange(page, "#organStop2", 7);
  const before = (await current(page)).snapshot;
  await expect(page.locator("#removeUserPreset")).toBeDisabled();
  await save(page, "Aurora halo");
  const saved = await current(page);
  expect(saved.selectedId).toBe("user-1");
  expect(saved.snapshot).toEqual(before);
  await expect(page.locator(".header-preset-picker .instrument-picker-current")).toHaveText("My · Aurora halo");
  await expect(page.locator("#userPresetCount")).toHaveText("1");
  await expect(page.locator("#removeUserPreset")).toBeEnabled();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  expect(persisted.presets[0].snapshot).toEqual(before);
  expect(persisted.presets[0].snapshot.settings.level).toBeUndefined();
  expect(persisted.presets[0].snapshot.settings.speakerCount).toBeUndefined();
  await select(page, "still");
  await expect(page.locator("#removeUserPreset")).toBeDisabled();
  await select(page, "user-1");
  await expect(page.locator("#organMode")).toHaveValue("tonewheel");
  await expect(page.locator("#organStop2")).toHaveValue("7");
  await expect(page.locator("#drive")).toHaveValue("0.47");
  await expect(page.locator("#layout")).toHaveValue("7-1");
  await expect(page.locator("#level")).toHaveValue("0.21");
  await setRange(page, "#drive", 0.2);
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  await expect(page.locator("#removeUserPreset")).toBeDisabled();
  await page.reload(); await settlePage(page);
  await expect(page.locator(".header-preset-picker .instrument-picker-current")).toHaveText("Select Preset");
  await expect(page.locator("#userPresetCount")).toHaveText("1");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await select(page, "user-1");
  await expect(page.locator("#drive")).toHaveValue("0.47");
  await expect(page.locator("#level")).toHaveValue("0.65", "master volume stays session-owned");
  await expect(page.locator("#layout")).toHaveValue("8-circle", "physical layout stays session-owned");
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#removeUserPreset").click();
  await expect(page.locator("#userPresetCount")).toHaveText("0");
  await expect(page.locator("#removeUserPreset")).toBeDisabled();
  await expect(page.locator(".header-preset-picker button[data-preset-id='user-1']")).toHaveCount(0);
  await expect(page.locator("#drive")).toHaveValue("0.47", "removal does not change live settings");
  await page.reload(); await settlePage(page);
  await expect(page.locator("#userPresetCount")).toHaveText("0");
});

test("download includes all factory and saved scenes; JSON import merges safely without applying a scene", async ({ page }) => {
  await open(page);
  await setRange(page, "#drive", 0.36);
  await save(page, "Bright arc");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadUserPresets").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("spartial-presets.json");
  const text = await readFile(await download.path(), "utf8");
  const json = JSON.parse(text);
  expect(json.version).toBe(1);
  expect(json.factoryPresets.map(item => item.id)).toEqual(SPARTIAL_FULL_PRESETS.map(item => item.id));
  expect(json.presets).toHaveLength(1);
  expect(json.presets[0].snapshot.settings.drive).toBe(0.36);

  const stored = await page.evaluate(key => localStorage.getItem(key), storageKey);
  json.presets[0].snapshot.settings.drive = 5;
  await upload(page, JSON.stringify(json));
  await expect(page.locator("#userPresetStatus")).toContainText("Could not load presets");
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(stored);
  await expect(page.locator("#userPresetCount")).toHaveText("1");

  page.once("dialog", dialog => dialog.accept());
  await page.locator("#removeUserPreset").click();
  await setRange(page, "#drive", 0.12);
  await upload(page, text);
  await expect(page.locator("#userPresetStatus")).toContainText("1 added, 0 updated");
  await expect(page.locator("#userPresetCount")).toHaveText("1");
  await expect(page.locator("#drive")).toHaveValue("0.12", "import does not apply a scene");
  await upload(page, text);
  await expect(page.locator("#userPresetStatus")).toContainText("0 added, 0 updated");
  await expect(page.locator("#userPresetCount")).toHaveText("1", "reimporting the same file is idempotent");
  await select(page, "user-1");
  await expect(page.locator("#drive")).toHaveValue("0.36");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("saving and loading presets leave a held voice, master level and Audio intact", async ({ page }) => {
  if (process.env.E2E_AUDIO_SILENT_SINK === "1") await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options = {}) { super({ ...options, sinkId: { type: "none" } }); }
    };
  });
  await open(page);
  for (const [control, value] of [["cascade", 0], ["cascadeStart", 0], ["attack", .01]]) {
    await setRange(page, `#${control}`, value);
  }
  await page.locator("#audioButton").click();
  await page.locator("#holdButton").click();
  await waitForStableAudioState(page, true);
  await save(page, "Held color");
  await upload(page, await page.evaluate(key => localStorage.getItem(key), storageKey));
  await expect(page.locator("#userPresetStatus")).toContainText("0 added, 0 updated");
  await select(page, "user-1");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#level")).toHaveValue("0.65");
  await waitForStableAudioState(page, true);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 35 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.005);
  expect(envelope.summary.maxPeak).toBeLessThan(1);
  expect(envelope.summary.clippedSamples).toBe(0);
});

test("a storage quota failure keeps new presets in the menu with a JSON backup warning", async ({ page }) => {
  await page.addInitScript(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, storageKey);
  await open(page);
  await save(page, "Tab only");
  await expect(page.locator("#userPresetStatus")).toContainText("Download JSON now");
  await expect(page.locator("#userPresetCount")).toHaveText("1");
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "user-1");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadUserPresets").click();
  expect(JSON.parse(await readFile(await (await downloadPromise).path(), "utf8")).presets).toHaveLength(1);
  await page.reload(); await settlePage(page);
  await expect(page.locator("#userPresetCount")).toHaveText("0", "storage failed, so reloading does not promise persistence");
});

test("replacing an existing name requires confirmation and keeps the saved ID", async ({ page }) => {
  await open(page);
  await save(page, "My sound");
  await setRange(page, "#drive", .54);
  await page.locator("#addUserPreset").click();
  await expect(page.locator("#userPresetName")).toHaveValue("My sound");
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator("#userPresetForm button[type=submit]").click();
  await expect(page.locator("#userPresetForm")).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).presets[0].snapshot.settings.drive, storageKey)).toBe(0);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#userPresetForm button[type=submit]").click();
  await expect(page.locator("#userPresetCount")).toHaveText("1");
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "user-1");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).presets[0].snapshot.settings.drive, storageKey)).toBe(.54);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`preset save and JSON actions stay reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page);
    const stage = await page.locator("#stageWrap").boundingBox();
    await save(page, "Phone scene");
    await page.locator("#downloadUserPresets").scrollIntoViewIfNeeded();
    for (const selector of ["#addUserPreset", "#removeUserPreset", "#downloadUserPresets", "#loadUserPresets"]) {
      const button = page.locator(selector);
      await button.scrollIntoViewIfNeeded();
      const bounds = await button.boundingBox();
      expect(bounds.width).toBeGreaterThanOrEqual(48);
      expect(bounds.height).toBeGreaterThanOrEqual(48);
      expect(await button.evaluate(node => {
        const box = node.getBoundingClientRect();
        return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === node;
      })).toBe(true);
    }
    const after = await page.locator("#stageWrap").boundingBox();
    expect(after.y).toBeCloseTo(stage.y, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
}

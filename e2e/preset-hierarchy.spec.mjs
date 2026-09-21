import { expect, test } from "@playwright/test";
import { CREATURAZOID_BODY_PRESETS, CREATURAZOID_SEQUENCE_PRESETS } from "../src/creaturazoid.js";
import { HICCUP_HEAD_PRESETS, HICCUP_HEAD_PATTERNS, HICCUP_HEAD_SOUND_BANKS } from "../src/hiccup-head.js";
import { CREATURAZOID_FULL_PRESETS } from "../src/instruments/creaturazoid/full-presets.js";
import { HICCUP_HEAD_FULL_PRESETS } from "../src/instruments/hiccup-head/full-presets.js";
import { readAudioStatus } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const snapshot = page => page.evaluate(async () => {
  const { captureHeaderPresetState } = await import("/src/site/header-presets.js");
  return captureHeaderPresetState();
});
async function mainPreset(page, id) {
  const menu = page.locator(".header-preset-picker");
  if (!await menu.evaluate(node => node.open)) await menu.locator(":scope > summary").click();
  await menu.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", id);
}
const optionIds = selector => selector.locator("option:not([disabled])").evaluateAll(options =>
  options.map(option => option.value).filter(value => !["custom", "mutated"].includes(value)));
const sorted = values => [...values].sort();
const without = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

for (const [id, bodies, rhythms, bank] of [
  ["creaturazoid", CREATURAZOID_BODY_PRESETS, CREATURAZOID_SEQUENCE_PRESETS, CREATURAZOID_FULL_PRESETS],
  ["hiccup-head", HICCUP_HEAD_PRESETS, HICCUP_HEAD_PATTERNS, HICCUP_HEAD_FULL_PRESETS],
]) {
  test(`${id}: main, body and sequence presets remain independently usable in their own locations`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`);
    await settlePage(page);
    const body = page.locator(`.${id}-panel #presetSelect`);
    const rhythm = page.locator(`.${id}-sequencer #patternSelect`);
    await body.scrollIntoViewIfNeeded();
    await expect(body).toBeVisible();
    await rhythm.scrollIntoViewIfNeeded();
    await expect(rhythm).toBeVisible();
    await expect(page.locator(".header-preset-picker #presetSelect, .header-preset-picker #patternSelect")).toHaveCount(0);
    await expect(page.locator(".header-preset-picker details")).toHaveCount(0);
    await expect(page.locator(".header-preset-picker")).not.toContainText("Edit preset ingredients");
    expect(sorted(await optionIds(body))).toEqual(sorted(bodies.map(p => p.id)));
    expect(sorted(await optionIds(rhythm))).toEqual(sorted(rhythms.map(p => p.id)));

    await mainPreset(page, bank[0].id);
    const before = (await snapshot(page)).snapshot;
    await rhythm.selectOption(rhythms[1].id);
    const changedRhythm = (await snapshot(page)).snapshot;
    expect(changedRhythm.currentPatternId).toBe(rhythms[1].id);
    expect(changedRhythm.pattern).not.toEqual(before.pattern);
    expect(without(changedRhythm.state, ["tempo", "swing", "patternLength", "sequencePresetId", "patternId"]))
      .toEqual(without(before.state, ["tempo", "swing", "patternLength", "sequencePresetId", "patternId"]));
    if (id === "hiccup-head") {
      expect(changedRhythm.visualSkinId).toBe(before.visualSkinId);
      expect(changedRhythm.faceEffectEnabled).toEqual(before.faceEffectEnabled);
      expect(changedRhythm.voiceSlots).toEqual(before.voiceSlots);
    }
    await body.selectOption(bodies[2].id);
    const changedBody = (await snapshot(page)).snapshot;
    expect(changedBody.pattern).toEqual(changedRhythm.pattern);
    expect(changedBody.currentPatternId).toBe(changedRhythm.currentPatternId);
    expect(changedBody.state.tempo).toBe(changedRhythm.state.tempo);
    expect(changedBody.state.swing).toBe(changedRhythm.state.swing);
    if (id === "hiccup-head") {
      expect(changedBody.visualSkinId).toBe(changedRhythm.visualSkinId);
      expect(changedBody.currentSoundBankId).toBe(changedRhythm.currentSoundBankId);
      expect(changedBody.voiceSlots).toEqual(changedRhythm.voiceSlots);
      expect(changedBody.faceEffectEnabled).toEqual(changedRhythm.faceEffectEnabled);
      for (const key of ["eyeDivergence", "leftEyeClosure", "rightEyeClosure", "earSpread", "leftHairLength", "rightHairLength"]) {
        expect(changedBody.state[key]).toBe(changedRhythm.state[key]);
      }
    }
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
    await mainPreset(page, bank[0].id);
    expect((await snapshot(page)).snapshot).toEqual(before);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

test("Hiccup main scenes demonstrate effects/skins while skin-only selection leaves sound and rhythm alone", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.addInitScript(() => {
    window.__sceneCameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.__sceneCameraRequests++;
      throw new Error("A factory scene must never request a camera or microphone");
    };
  });
  await page.goto("hiccup-head.html");
  await settlePage(page);
  await expect(page.locator(".hiccup-head-panel #visualSkinSelect")).toBeVisible();
  expect(sorted(await optionIds(page.locator("#soundBankSelect")))).toEqual(sorted(HICCUP_HEAD_SOUND_BANKS.map(p => p.id)));
  const skins = new Set(), decays = new Set(), eyes = new Set();
  for (const preset of HICCUP_HEAD_FULL_PRESETS) {
    await mainPreset(page, preset.id);
    const actual = (await snapshot(page)).snapshot;
    expect(actual).toEqual(preset.snapshot);
    await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", preset.snapshot.visualSkinId);
    await expect(page.locator("#visualSkinSelect")).toHaveValue(preset.snapshot.visualSkinId);
    await expect(page.locator("#decay")).toHaveValue(String(preset.snapshot.state.decay));
    skins.add(actual.visualSkinId); decays.add(actual.state.decay); eyes.add(actual.state.eyeDivergence);
  }
  expect(skins.size).toBe(6);
  expect(decays.size).toBeGreaterThanOrEqual(5);
  expect(eyes.size).toBeGreaterThanOrEqual(5);
  const before = (await snapshot(page)).snapshot;
  await page.locator("#visualSkinSelect").selectOption("food-portrait");
  const after = (await snapshot(page)).snapshot;
  expect(without(after, ["visualSkinId"])).toEqual(without(before, ["visualSkinId"]));
  await page.locator("#nextVisualSkinButton").click();
  await expect(page.locator("#visualSkinSelect")).toHaveValue("ascii");
  expect(without((await snapshot(page)).snapshot, ["visualSkinId"])).toEqual(without(before, ["visualSkinId"]));
  expect(await page.evaluate(() => window.__sceneCameraRequests)).toBe(0);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const size of [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "landscape", width: 844, height: 390, touch: true },
]) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch });
    for (const id of ["creaturazoid", "hiccup-head"]) {
      test(`${id}: sub-preset menus stay reachable and randomize stays compact`, async ({ page }) => {
        await page.goto(`${id}.html`);
        await settlePage(page);
        for (const selector of ["#patternSelect", "#nextPatternButton", "#presetSelect",
          id === "hiccup-head" ? "#nextFacePresetButton" : "#nextPresetButton",
          ...(id === "hiccup-head" ? ["#visualSkinSelect", "#nextVisualSkinButton", "#soundBankSelect"] : ["#anatomySelect"]),
        ]) {
          const control = page.locator(selector);
          await control.scrollIntoViewIfNeeded();
          await expect(control).toBeVisible();
          const box = await control.boundingBox();
          expect(box.width).toBeGreaterThan(0);
          expect(box.x).toBeGreaterThanOrEqual(-1);
          expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
        }
        const button = page.locator(id === "creaturazoid" && size.width <= 960 ? "#mobileRandomPatternButton" : "#randomizeButton");
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box.width).toBeLessThanOrEqual(190);
        expect(box.height).toBeLessThanOrEqual(size.touch ? 50 : 36);
        if (size.touch) expect(box.height).toBeGreaterThanOrEqual(48);
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      });
    }
  });
}

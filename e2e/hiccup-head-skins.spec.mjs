import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";

const SKIN_IDS = [
  "checker",
  "cutout-collage",
  "photo-1904",
  "food-portrait",
  "ascii",
  "wild-ink",
];

async function chooseSkin(page, id) {
  const picker = page.locator('.hiccup-head-select-picker[data-select-id="visualSkinSelect"]');
  await picker.locator('summary').click();
  await picker.locator(`button[data-value="${id}"]`).click();
}

async function controlSnapshot(page) {
  return page.locator("input, select").evaluateAll((controls) => controls
    .filter(({ id }) => id !== "visualSkinSelect")
    .map(({ id, value, type, checked }) => ({ id, value, checked: type === "checkbox" ? checked : null })));
}

test.describe("Hiccup Head visual skins", () => {
  test("switches six distinct canvases without touching instrument controls", async ({ page }) => {
    await page.goto("/hiccup-head.html");
    const selector = page.locator("#visualSkinSelect");
    await expect(selector.locator("option")).toHaveCount(6);
    await expect(selector.locator("option").last()).toHaveAttribute("value", "wild-ink");
    await expect(page.locator("#visualSkinDescription")).toContainText("does not change sound");

    const before = await controlSnapshot(page);
    const hashes = new Set();
    for (const id of SKIN_IDS) {
      await chooseSkin(page, id);
      await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", id);
      if (["cutout-collage", "photo-1904", "food-portrait", "wild-ink"].includes(id)) {
        await page.waitForTimeout(250);
      }
      const pixels = await page.locator("#stage").screenshot();
      hashes.add(createHash("sha256").update(pixels).digest("hex"));
    }
    expect(hashes.size).toBe(SKIN_IDS.length);
    expect(await controlSnapshot(page)).toEqual(before);

    await chooseSkin(page, "food-portrait");
    await page.reload();
    await expect(selector).toHaveValue("food-portrait");
  });

  test("keeps visual appearance in one mobile panel row without burying the sequencer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/hiccup-head.html");
    const skinDeck = page.locator(".hiccup-head-panel > .hiccup-head-skin-deck");
    const skinTools = skinDeck.locator(".hiccup-head-skin-tools");
    const camera = page.locator("#openWebcamSkinButton");
    const selectorBox = await page.locator("#visualSkinSelect-picker-trigger").boundingBox();
    const cameraBox = await camera.boundingBox();
    const skinToolsBox = await skinTools.boundingBox();
    const mastheadBox = await page.locator(".masthead").boundingBox();
    const stageBox = await page.locator("#stageWrap").boundingBox();
    const sequencerBox = await page.locator(".hiccup-head-sequencer").boundingBox();
    await expect(page.locator(".masthead #visualSkinSelect, .masthead #openWebcamSkinButton")).toHaveCount(0);
    await expect(skinDeck).toHaveCount(1);
    await expect(page.locator(".hiccup-head-panel > .hiccup-head-skin-deck + .hiccup-head-preset-deck")).toHaveCount(1);
    expect(selectorBox).toBeTruthy();
    expect(cameraBox).toBeTruthy();
    expect(skinToolsBox).toBeTruthy();
    expect(mastheadBox).toBeTruthy();
    expect(stageBox).toBeTruthy();
    expect(sequencerBox).toBeTruthy();
    expect(selectorBox.x).toBeGreaterThanOrEqual(skinToolsBox.x);
    expect(selectorBox.x + selectorBox.width).toBeLessThanOrEqual(cameraBox.x);
    expect(cameraBox.x + cameraBox.width).toBeLessThanOrEqual(skinToolsBox.x + skinToolsBox.width);
    expect(selectorBox.y).toBeGreaterThanOrEqual(skinToolsBox.y);
    expect(cameraBox.y).toBeGreaterThanOrEqual(skinToolsBox.y);
    expect(selectorBox.y + selectorBox.height).toBeLessThanOrEqual(skinToolsBox.y + skinToolsBox.height);
    expect(cameraBox.y + cameraBox.height).toBeLessThanOrEqual(skinToolsBox.y + skinToolsBox.height);
    expect(cameraBox.width).toBeGreaterThanOrEqual(44);
    expect(cameraBox.height).toBeGreaterThanOrEqual(44);
    // The shared performance toolbar wraps into two rows on a narrow phone.
    // Current main and this UI both measure 93px; allow two 48px target rows.
    expect(mastheadBox.height).toBeLessThanOrEqual(96);
    expect(sequencerBox.y).toBeLessThan(430);

    const shell = page.locator(".hiccup-head-shell");
    const stageTop = stageBox.y;
    await shell.evaluate((element) => { element.scrollTop = 620; });
    await expect.poll(async () => shell.evaluate((element) => element.scrollTop)).toBeGreaterThan(300);
    await expect.poll(async () => (await page.locator("#stageWrap").boundingBox()).y)
      .toBeCloseTo(stageTop, 0);
  });
});

test("Hiccup Head paired menus match Choose and stay synchronized with Next", async ({ page }) => {
  await page.goto("/hiccup-head.html");
  const pairs = [
    ["visualSkinSelect", "nextVisualSkinButton"],
    ["presetSelect", "nextFacePresetButton"],
    ["patternSelect", "nextPatternButton"],
    ["soundBankSelect", "nextSoundBankButton"],
  ];
  for (const [id, nextId] of pairs) {
    const picker = page.locator(`.hiccup-head-select-picker[data-select-id="${id}"]`);
    const select = page.locator(`#${id}`);
    await expect(select).toBeHidden();
    await picker.locator("summary").click();
    await expect(picker.locator(".instrument-picker-panel")).toBeVisible();
    const selected = await select.inputValue();
    await picker.locator(`.instrument-picker-link:not([data-value="${selected}"])`).first().click();
    await expect(picker.locator("summary")).toContainText(await select.evaluate(node => node.selectedOptions[0].label));
    await page.locator(`#${nextId}`).click();
    await expect(picker.locator("summary")).toContainText(await select.evaluate(node => node.selectedOptions[0].label));
    await page.mouse.move(0, 0);
    const appearance = await page.evaluate(buttonId => {
      const pick = selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return [style.width, style.height, style.border, style.borderRadius, style.color, style.backgroundColor, style.font];
      };
      return { actual: pick(`#${buttonId}`), shared: pick(".header-preset-next") };
    }, nextId);
    expect(appearance.actual, nextId).toEqual(appearance.shared);
  }
  const skinBox = await page.locator(".hiccup-head-visual-skin").evaluate(node => {
    const style = getComputedStyle(node);
    return { border: style.borderWidth, padding: style.padding, background: style.backgroundColor };
  });
  expect(skinBox).toEqual({ border: "0px", padding: "0px", background: "rgba(0, 0, 0, 0)" });
});

test("Hiccup Head keeps shared menus on a cached page transition", async ({ page }) => {
  await page.goto("/hiccup-head.html");
  const picker = page.locator('.hiccup-head-select-picker[data-select-id="visualSkinSelect"]');
  await picker.locator("summary").click();
  // Simulate the persisted lifecycle event: the preview deliberately sends no-store.
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(page.locator(".hiccup-head-select-picker")).toHaveCount(4);
  await expect(picker.locator(".instrument-picker-panel")).toBeHidden();
  await expect(page.locator("#visualSkinSelect")).toBeHidden();
  await chooseSkin(page, "food-portrait");
  await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", "food-portrait");
});

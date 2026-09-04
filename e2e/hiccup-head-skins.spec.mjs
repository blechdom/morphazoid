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
      await selector.selectOption(id);
      await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", id);
      if (["cutout-collage", "photo-1904", "food-portrait", "wild-ink"].includes(id)) {
        await page.waitForTimeout(250);
      }
      const pixels = await page.locator("#stage").screenshot();
      hashes.add(createHash("sha256").update(pixels).digest("hex"));
    }
    expect(hashes.size).toBe(SKIN_IDS.length);
    expect(await controlSnapshot(page)).toEqual(before);

    await selector.selectOption("food-portrait");
    await page.reload();
    await expect(selector).toHaveValue("food-portrait");
  });

  test("keeps the selector in the mobile masthead without burying the sequencer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/hiccup-head.html");
    const selectorBox = await page.locator("#visualSkinSelect").boundingBox();
    const mastheadBox = await page.locator(".masthead").boundingBox();
    const stageBox = await page.locator("#stageWrap").boundingBox();
    const sequencerBox = await page.locator(".hiccup-head-sequencer").boundingBox();
    expect(selectorBox).toBeTruthy();
    expect(mastheadBox).toBeTruthy();
    expect(stageBox).toBeTruthy();
    expect(sequencerBox).toBeTruthy();
    expect(selectorBox.x).toBeGreaterThanOrEqual(mastheadBox.x);
    expect(selectorBox.x + selectorBox.width).toBeLessThanOrEqual(mastheadBox.x + mastheadBox.width);
    expect(selectorBox.y).toBeGreaterThanOrEqual(mastheadBox.y);
    expect(selectorBox.y + selectorBox.height).toBeLessThanOrEqual(mastheadBox.y + mastheadBox.height);
    expect(selectorBox.y + selectorBox.height).toBeLessThanOrEqual(stageBox.y + 1);
    expect(mastheadBox.height).toBeGreaterThanOrEqual(96);
    expect(sequencerBox.y).toBeLessThan(430);

    const shell = page.locator(".hiccup-head-shell");
    const stageTop = stageBox.y;
    await shell.evaluate((element) => { element.scrollTop = 620; });
    await expect.poll(async () => shell.evaluate((element) => element.scrollTop)).toBeGreaterThan(300);
    await expect.poll(async () => (await page.locator("#stageWrap").boundingBox()).y)
      .toBeCloseTo(stageTop, 0);
  });
});

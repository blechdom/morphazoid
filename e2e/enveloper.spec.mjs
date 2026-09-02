import { expect, test } from "@playwright/test";

test("Enveloper keeps its visual clock separate from explicit audio", async ({ page }) => {
  await page.goto("/enveloper.html", { waitUntil: "domcontentloaded" });

  const audio = page.locator("#audioButton");
  const play = page.locator("#playButton");
  const position = page.locator("#position");

  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "false");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(0.005);

  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  await expect(play).toHaveAttribute("aria-pressed", "true");

  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(play).toHaveAttribute("aria-pressed", "true");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
});

test("Enveloper exposes all nine leaf XY and dual-contour controls without requiring the canvas", async ({ page }) => {
  await page.goto("/enveloper.html", { waitUntil: "domcontentloaded" });
  const selection = page.locator("details.enveloper-selection");
  await selection.locator(":scope > summary").click();
  await selection.locator('[data-leaf="8"]').click();

  await expect(page.locator("#stage")).toHaveAttribute("data-leaf-count", "9");
  await expect(page.locator("#stage")).toHaveAttribute("data-contours-per-leaf", "2");
  await expect(page.locator("#stage")).toHaveAttribute("data-rendered-leaf-contours", "18");
  await expect(page.locator("#selectionSummary")).toContainText("leaf 09");
  await expect(page.locator("#leafInspector")).toBeVisible();
  await expect(page.locator('[data-envelope-kind="pitch"]')).toHaveCount(4);
  await expect(page.locator('[data-envelope-kind="index"]')).toHaveCount(4);
  await expect(page.locator("#ancestorBendOut")).toContainText(/Ancestor bend [+-]?\d+\.\d st/);
  await page.locator("#selectedTimbre").evaluate((input) => {
    input.value = "0.93";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#selectedTimbreOut")).toHaveText("93%");

  await page.locator("#pitchEnvelopeLevel1").evaluate((input) => {
    input.value = "0.17";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#pitchEnvelopeLevel1Out")).toHaveText("17%");
  await page.locator("#indexEnvelopeLevel2").evaluate((input) => {
    input.value = "0.84";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#indexEnvelopeLevel2Out")).toHaveText("84%");
  await expect(page.locator("#treeState")).toHaveText("custom");

  await selection.locator('[data-leaf="7"]').click();
  await selection.locator('[data-leaf="8"]').click();
  await expect(page.locator("#pitchEnvelopeLevel1")).toHaveValue("0.17");
  await expect(page.locator("#indexEnvelopeLevel2")).toHaveValue("0.84");

  await selection.locator('[data-leaf="0"]').click();
  const bendBefore = await page.locator("#ancestorBendOut").textContent();
  const canvas = page.locator("#stage");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const compact = bounds.height < 470 || bounds.width < 620;
  const left = compact ? 18 : Math.max(34, bounds.width * 0.045);
  const top = compact ? 50 : 62;
  const bottomInset = compact ? 28 : 42;
  const usableHeight = Math.max(92, bounds.height - top - bottomInset);
  const rootBottom = top + usableHeight * 0.22;
  const rootNodeY = rootBottom + (top - rootBottom) * 0.72;
  await canvas.click({ position: { x: left, y: rootNodeY } });
  await expect(page.locator("#selectionSummary")).toContainText("parent · node 1");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await selection.locator('[data-leaf="0"]').click();
  await expect.poll(() => page.locator("#ancestorBendOut").textContent()).not.toBe(bendBefore);
  await expect(page.locator("#stage")).toHaveAttribute("data-rendered-leaf-contours", "18");
});

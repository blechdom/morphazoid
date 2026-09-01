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

test("Enveloper exposes all nine leaf XY controls without requiring the canvas", async ({ page }) => {
  await page.goto("/enveloper.html", { waitUntil: "domcontentloaded" });
  const selection = page.locator("details.enveloper-selection");
  await selection.locator(":scope > summary").click();
  await selection.locator('[data-leaf="8"]').click();

  await expect(page.locator("#selectionSummary")).toContainText("leaf 09");
  await expect(page.locator("#leafInspector")).toBeVisible();
  await page.locator("#selectedTimbre").evaluate((input) => {
    input.value = "0.93";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#selectedTimbreOut")).toHaveText("93%");
});

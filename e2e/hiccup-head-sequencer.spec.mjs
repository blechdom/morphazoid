import { test, expect } from "@playwright/test";

test.describe("Hiccup Head single-lane sequencer", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("edits one sound per step without coupling the voice collection", async ({ page }) => {
    await page.goto("/hiccup-head.html");

    const grid = page.locator("#sequenceGrid");
    const slots = grid.locator(".hiccup-head-step-slot");
    await expect(grid).toHaveAttribute("aria-rowcount", "1");
    await expect(slots).toHaveCount(16);
    await expect(grid.locator(".hiccup-head-grid-row")).toHaveCount(1);
    await expect(grid.locator(".hiccup-head-step-number")).toHaveCount(0);

    const firstCellBox = await grid.locator(".hiccup-head-step-cell").first().boundingBox();
    const lastCellBox = await grid.locator(".hiccup-head-step-cell").last().boundingBox();
    expect(firstCellBox.height).toBeGreaterThanOrEqual(145);
    expect(Math.abs(firstCellBox.y - lastCellBox.y)).toBeLessThanOrEqual(1);
    await expect(page.locator("#selectedStepContext")).toBeHidden();
    await grid.locator(".hiccup-head-step-audition:not([disabled])").first().click();
    await expect(page.locator("#selectedStepContext")).toBeHidden();

    const initialOptionCounts = await grid.locator(".hiccup-head-step-sound-select")
      .evaluateAll((selectors) => selectors.map(({ options }) => options.length));
    expect(Math.max(...initialOptionCounts)).toBeLessThanOrEqual(2);

    await page.locator("#clearPatternButton").click();
    const selector = grid.locator(".hiccup-head-step-sound-select").first();
    const trigger = grid.locator(".hiccup-head-step-cell").first();
    await selector.focus();
    await expect(selector.locator("option")).toHaveCount(53);

    await selector.selectOption("kick");
    await expect(trigger).toHaveAttribute("data-level", "2");
    const programmedLevel = await trigger.getAttribute("data-level");
    await trigger.locator("xpath=../*[@class='hiccup-head-step-audition']").click();
    await expect(trigger).toHaveAttribute("data-level", programmedLevel);
    await expect(selector).toHaveValue("kick");
    await selector.focus();
    await selector.selectOption("kiss");
    await expect(trigger).toHaveAttribute("data-level", "2");
    await trigger.click();
    await expect(trigger).toHaveAttribute("data-level", "3");
    await expect(page.locator("#selectedStepContext")).toBeVisible();
    await expect(trigger.locator("xpath=../*[@id='selectedStepContext']")).toHaveCount(1);
    await expect(page.locator("#selectedStepContext")).not.toContainText(/STEP\s*\d+/i);
    await trigger.click();
    await expect(trigger).toHaveAttribute("data-level", "0");

    const voiceCards = page.locator("#voiceRack .hiccup-head-voice-card");
    await expect(voiceCards).toHaveCount(4);
    await expect(page.locator("#voiceSelectionMode")).toHaveValue("roundRobin");

    await page.locator("#sequenceLengthEntry").fill("64");
    await page.locator("#sequenceLengthEntry").press("Enter");
    await expect(slots).toHaveCount(64);
    await expect(grid.locator(".hiccup-head-grid-row")).toHaveCount(1);
    const longFirstBox = await grid.locator(".hiccup-head-step-cell").first().boundingBox();
    const longLastBox = await grid.locator(".hiccup-head-step-cell").last().boundingBox();
    expect(Math.abs(longFirstBox.y - longLastBox.y)).toBeLessThanOrEqual(1);
    const retainedOptionCounts = await grid.locator(".hiccup-head-step-sound-select")
      .evaluateAll((selectors) => selectors.map(({ options }) => options.length));
    expect(Math.max(...retainedOptionCounts)).toBeLessThanOrEqual(2);
  });
});

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
    const hitMark = trigger.locator(".hiccup-head-step-hit-mark");
    await expect(trigger).toHaveAttribute("data-active", "false");
    await expect(hitMark).toBeHidden();

    const emptyCellBox = await trigger.boundingBox();
    await trigger.click({
      position: { x: emptyCellBox.width / 2, y: emptyCellBox.height * 0.33 },
    });
    await expect(trigger).toHaveAttribute("data-active", "true");
    await expect(hitMark).toBeVisible();
    const clickedVelocity = Number(await trigger.evaluate((cell) => (
      cell.style.getPropertyValue("--step-velocity")
    )));
    expect(clickedVelocity).toBeGreaterThan(0.64);
    expect(clickedVelocity).toBeLessThan(0.7);
    await expect(page.locator("#selectedStepContext")).toBeVisible();

    await page.mouse.move(
      emptyCellBox.x + emptyCellBox.width / 2,
      emptyCellBox.y + emptyCellBox.height * 0.33,
    );
    await page.mouse.down();
    await page.mouse.move(
      emptyCellBox.x + emptyCellBox.width / 2,
      emptyCellBox.y + emptyCellBox.height - 1,
    );
    await page.mouse.up();
    await expect(trigger).toHaveAttribute("data-active", "false");
    await expect(hitMark).toBeHidden();
    await expect(selector).toHaveValue("");

    const velocitySlider = page.locator("#selectedStepVelocity");
    await expect(velocitySlider).toBeEnabled();
    await velocitySlider.evaluate((input) => {
      input.value = "0.01";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(trigger).toHaveAttribute("data-active", "true");
    await expect(hitMark).toBeVisible();
    const lowMarkBox = await hitMark.boundingBox();
    const previewBox = await trigger.locator("xpath=../*[@class='hiccup-head-step-audition']").boundingBox();
    expect(lowMarkBox.y + lowMarkBox.height).toBeLessThanOrEqual(previewBox.y);
    await velocitySlider.evaluate((input) => {
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(trigger).toHaveAttribute("data-active", "false");
    await expect(hitMark).toBeHidden();
    await velocitySlider.evaluate((input) => {
      input.value = "0.64";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(trigger).toHaveAttribute("data-active", "true");
    await expect(hitMark).toBeVisible();
    await velocitySlider.evaluate((input) => {
      input.value = "0";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(trigger).toHaveAttribute("data-active", "false");
    await expect(hitMark).toBeHidden();

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
    await expect(page.locator("#selectedStepContext")).toBeVisible();
    await expect(trigger.locator("xpath=../*[@id='selectedStepContext']")).toHaveCount(1);
    await expect(page.locator("#selectedStepContext")).not.toContainText(/STEP\s*\d+/i);

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

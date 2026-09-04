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
    const cells = grid.locator(".hiccup-head-step-cell");
    const lanes = grid.locator(".hiccup-head-step-volume-lane");
    const hitMark = trigger.locator(".hiccup-head-step-hit-mark");
    await expect(trigger).toHaveAttribute("data-active", "false");
    await expect(hitMark).toBeHidden();
    await expect(page.locator("#selectedStepVelocity")).toHaveCount(0);

    const firstLaneBox = await lanes.first().boundingBox();
    const midpointY = firstLaneBox.y + firstLaneBox.height * 0.5;
    await page.mouse.click(firstLaneBox.x + firstLaneBox.width / 2, midpointY);
    await expect(trigger).toHaveAttribute("data-active", "true");
    await expect(hitMark).toBeVisible();
    const clickedVelocity = Number(await trigger.evaluate((cell) => (
      cell.style.getPropertyValue("--step-velocity")
    )));
    expect(clickedVelocity).toBeCloseTo(0.5, 2);
    await expect(trigger.locator(".hiccup-head-step-velocity-number")).toHaveText("50%");
    await expect(trigger).not.toHaveAttribute("title", /.+/);
    const midpointMarkBox = await hitMark.boundingBox();
    expect(Math.abs(midpointMarkBox.y + midpointMarkBox.height / 2 - midpointY)).toBeLessThan(2);
    await expect(page.locator("#selectedStepContext")).toBeVisible();
    await expect(page.locator("#selectedStepContext")).not.toContainText(/volume/i);
    await expect(page.locator("#selectedStepMode")).toHaveCount(0);

    const clearLaneBox = await lanes.first().boundingBox();
    await page.mouse.move(
      clearLaneBox.x + clearLaneBox.width / 2,
      clearLaneBox.y + clearLaneBox.height * 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      clearLaneBox.x + clearLaneBox.width / 2,
      clearLaneBox.y + clearLaneBox.height,
    );
    await page.mouse.up();
    await expect(trigger).toHaveAttribute("data-active", "false");
    await expect(hitMark).toBeHidden();
    await expect(selector).toHaveValue("");

    const paintStart = await lanes.nth(0).boundingBox();
    const paintEnd = await lanes.nth(5).boundingBox();
    await page.mouse.move(
      paintStart.x + paintStart.width / 2,
      paintStart.y + paintStart.height * 0.25,
    );
    await page.mouse.down();
    await page.mouse.move(
      paintEnd.x + paintEnd.width / 2,
      paintEnd.y + paintEnd.height * 0.75,
      { steps: 1 },
    );
    await expect(page.locator("#selectedStepContext")).toBeHidden();
    for (let step = 0; step < 6; step += 1) {
      await expect(cells.nth(step)).toHaveAttribute("data-active", "true");
    }
    await page.mouse.up();
    const paintedVelocities = await cells.evaluateAll((stepCells) => stepCells.slice(0, 6).map(
      (cell) => Number(cell.style.getPropertyValue("--step-velocity")),
    ));
    expect(paintedVelocities).toEqual([0.75, 0.65, 0.55, 0.45, 0.35, 0.25]);
    await expect(page.locator("#selectedStepContext")).toBeVisible();

    const secondSelector = grid.locator(".hiccup-head-step-sound-select").nth(1);
    await selector.focus();
    await selector.selectOption("kick");
    await secondSelector.focus();
    await secondSelector.selectOption("kiss");
    const secondLaneBox = await lanes.nth(1).boundingBox();
    await page.mouse.move(
      secondLaneBox.x + secondLaneBox.width / 2,
      secondLaneBox.y + secondLaneBox.height * 0.4,
    );
    await page.mouse.down();
    await page.mouse.move(
      secondLaneBox.x + secondLaneBox.width / 2,
      secondLaneBox.y + secondLaneBox.height,
    );
    await expect(secondSelector).toHaveValue("");
    await page.mouse.move(
      secondLaneBox.x + secondLaneBox.width / 2,
      secondLaneBox.y + secondLaneBox.height * 0.6,
    );
    await expect(secondSelector).toHaveValue("kiss");
    await page.mouse.up();
    await expect(selector).toHaveValue("kick");
    await expect(secondSelector).toHaveValue("kiss");

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

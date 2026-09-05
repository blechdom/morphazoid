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
    await expect(grid.locator(".hiccup-head-step-sound-number")).toHaveCount(0);
    const soundLanes = grid.locator(".hiccup-head-step-sound-lane");
    await expect(soundLanes).toHaveCount(16);
    await expect(soundLanes.first()).toHaveAttribute("min", "1");
    await expect(soundLanes.first()).toHaveAttribute("max", "52");
    await expect(soundLanes.first()).toHaveAttribute("aria-orientation", "vertical");
    await expect(soundLanes.first()).toHaveValue("1");
    await expect(
      grid.locator(".hiccup-head-step-sound-select").first().locator("option:checked"),
    ).toHaveText("BOP");
    await expect(page.locator("#selectedStepContext")).toHaveCount(0);
    await expect(grid.locator(".hiccup-head-step-hit-mark")).toHaveCount(0);

    const firstCellBox = await grid.locator(".hiccup-head-step-cell").first().boundingBox();
    const lastCellBox = await grid.locator(".hiccup-head-step-cell").last().boundingBox();
    const firstSelectorBox = await grid.locator(".hiccup-head-step-sound-select").first().boundingBox();
    const firstSoundLaneBox = await soundLanes.first().boundingBox();
    expect(firstCellBox.height).toBeGreaterThanOrEqual(100);
    expect(firstCellBox.height).toBeLessThanOrEqual(112);
    expect(firstSoundLaneBox.height).toBeGreaterThanOrEqual(60);
    expect(firstSoundLaneBox.y).toBeGreaterThanOrEqual(firstSelectorBox.y + firstSelectorBox.height - 1);
    expect(Math.abs(firstCellBox.y - lastCellBox.y)).toBeLessThanOrEqual(1);
    await grid.locator(".hiccup-head-step-audition:not([disabled])").first().click();

    const initialOptionCounts = await grid.locator(".hiccup-head-step-sound-select")
      .evaluateAll((selectors) => selectors.map(({ options }) => options.length));
    expect(Math.max(...initialOptionCounts)).toBeLessThanOrEqual(2);

    await page.locator("#clearPatternButton").click();
    const selector = grid.locator(".hiccup-head-step-sound-select").first();
    const trigger = grid.locator(".hiccup-head-step-cell").first();
    const cells = grid.locator(".hiccup-head-step-cell");
    const lanes = grid.locator(".hiccup-head-step-volume-lane");
    await expect(trigger).toHaveAttribute("data-active", "false");
    await expect(selector.locator("option:checked")).toHaveText("+");
    await expect(page.locator("#selectedStepVelocity")).toHaveCount(0);

    const emptySoundStart = await soundLanes.nth(0).boundingBox();
    const emptySoundEnd = await soundLanes.nth(2).boundingBox();
    await page.mouse.move(
      emptySoundStart.x + emptySoundStart.width / 2,
      emptySoundStart.y + emptySoundStart.height - 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      emptySoundEnd.x + emptySoundEnd.width / 2,
      emptySoundEnd.y + 0.5,
      { steps: 1 },
    );
    await page.mouse.up();
    for (let step = 0; step < 3; step += 1) {
      await expect(cells.nth(step)).toHaveAttribute("data-active", "false");
      await expect(grid.locator(".hiccup-head-step-sound-select").nth(step)).toHaveValue("");
    }
    await soundLanes.first().focus();
    await soundLanes.first().press("ArrowUp");
    await expect(soundLanes.first()).toHaveValue("1");
    await expect(trigger).toHaveAttribute("data-active", "false");
    await expect(selector).toHaveValue("");

    const firstLaneBox = await lanes.first().boundingBox();
    const midpointY = firstLaneBox.y + firstLaneBox.height * 0.5;
    await page.mouse.click(firstLaneBox.x + firstLaneBox.width / 2, midpointY);
    await expect(trigger).toHaveAttribute("data-active", "true");
    const clickedVelocity = Number(await trigger.evaluate((cell) => (
      cell.style.getPropertyValue("--step-velocity")
    )));
    expect(clickedVelocity).toBeCloseTo(0.5, 2);
    await expect(trigger.locator(".hiccup-head-step-velocity-number")).toHaveCount(0);
    await expect(trigger).not.toHaveAttribute("title", /.+/);
    const midpointFillRatio = await trigger.evaluate((cell) => {
      const lane = cell.querySelector(".hiccup-head-step-volume-lane");
      const fillHeight = Number.parseFloat(getComputedStyle(lane, "::before").height);
      return fillHeight / lane.getBoundingClientRect().height;
    });
    expect(midpointFillRatio).toBeCloseTo(0.5, 2);

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
    for (let step = 0; step < 6; step += 1) {
      await expect(cells.nth(step)).toHaveAttribute("data-active", "true");
    }
    await page.mouse.up();
    const paintedVelocities = await cells.evaluateAll((stepCells) => stepCells.slice(0, 6).map(
      (cell) => Number(cell.style.getPropertyValue("--step-velocity")),
    ));
    expect(paintedVelocities).toEqual([0.75, 0.65, 0.55, 0.45, 0.35, 0.25]);

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
    await expect(selector.locator("option:checked")).toHaveText("KISS");

    const velocitiesBeforeSoundPaint = await cells.evaluateAll((stepCells) => stepCells.slice(0, 6).map(
      (cell) => Number(cell.style.getPropertyValue("--step-velocity")),
    ));
    const soundPaintStart = await soundLanes.nth(0).boundingBox();
    const soundPaintEnd = await soundLanes.nth(5).boundingBox();
    await page.mouse.move(
      soundPaintStart.x + soundPaintStart.width / 2,
      soundPaintStart.y + soundPaintStart.height - 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      soundPaintEnd.x + soundPaintEnd.width / 2,
      soundPaintEnd.y + 0.5,
      { steps: 1 },
    );
    await page.mouse.up();
    const paintedSoundIds = await grid.locator(".hiccup-head-step-sound-select")
      .evaluateAll((selectors) => selectors.slice(0, 6).map((soundSelector) => soundSelector.value));
    expect(paintedSoundIds[0]).toBe("bop");
    expect(paintedSoundIds[5]).toBe("ehyeah");
    expect(new Set(paintedSoundIds).size).toBe(6);
    await expect(soundLanes.nth(0)).toHaveValue("1");
    await expect(soundLanes.nth(5)).toHaveValue("52");
    const velocitiesAfterSoundPaint = await cells.evaluateAll((stepCells) => stepCells.slice(0, 6).map(
      (cell) => Number(cell.style.getPropertyValue("--step-velocity")),
    ));
    expect(velocitiesAfterSoundPaint).toEqual(velocitiesBeforeSoundPaint);
    await soundLanes.first().focus();
    await soundLanes.first().press("ArrowUp");
    await expect(soundLanes.first()).toHaveValue("2");
    await expect(selector).toHaveValue("boop");
    await expect(trigger).toHaveCSS("--step-velocity", String(velocitiesBeforeSoundPaint[0]));
    await soundLanes.first().press("Home");
    await expect(soundLanes.first()).toHaveValue("1");
    await expect(selector).toHaveValue("bop");

    const voiceCards = page.locator("#voiceRack .hiccup-head-voice-card");
    await expect(voiceCards).toHaveCount(4);
    await expect(page.locator("#voiceSelectionMode")).toHaveValue("roundRobin");

    await page.locator("#sequenceLengthEntry").fill("64");
    await page.locator("#sequenceLengthEntry").press("Enter");
    await expect(slots).toHaveCount(64);
    await expect(soundLanes).toHaveCount(64);
    await expect(grid.locator(".hiccup-head-grid-row")).toHaveCount(1);
    const longFirstBox = await grid.locator(".hiccup-head-step-cell").first().boundingBox();
    const longLastBox = await grid.locator(".hiccup-head-step-cell").last().boundingBox();
    expect(Math.abs(longFirstBox.y - longLastBox.y)).toBeLessThanOrEqual(1);
    const retainedOptionCounts = await grid.locator(".hiccup-head-step-sound-select")
      .evaluateAll((selectors) => selectors.map(({ options }) => options.length));
    expect(Math.max(...retainedOptionCounts)).toBeLessThanOrEqual(2);
  });
});

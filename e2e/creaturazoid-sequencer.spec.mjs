import { expect, test } from "@playwright/test";

test.describe("Creaturazoid single-lane sequencer", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("paints continuous volume and any of 50 sounds across one accessible row", async ({ page }) => {
    await page.goto("/creaturazoid.html");

    const grid = page.locator("#sequenceGrid");
    const slots = grid.locator(".creaturazoid-step-slot");
    const cells = grid.locator(".creaturazoid-step-cell");
    const volumeLanes = grid.locator(".creaturazoid-step-volume-lane");
    const selectors = grid.locator(".creaturazoid-step-sound-select");
    const soundLanes = grid.locator(".creaturazoid-step-sound-lane");

    await expect(grid).toHaveAttribute("aria-rowcount", "1");
    await expect(grid).toHaveAttribute("aria-colcount", "32");
    await expect(slots).toHaveCount(32);
    await expect(grid.locator("[role='gridcell']")).toHaveCount(32);
    await expect(grid.locator(".creaturazoid-grid-row")).toHaveCount(1);
    await expect(cells).toHaveCount(32);
    await expect(soundLanes).toHaveCount(32);
    await expect(soundLanes.first()).toHaveAttribute("min", "1");
    await expect(soundLanes.first()).toHaveAttribute("max", "50");
    await expect(soundLanes.first()).toHaveAttribute("aria-orientation", "vertical");
    await expect(grid.locator(".creaturazoid-step-number")).toHaveCount(0);
    await expect(grid.locator(".creaturazoid-grid-cell")).toHaveCount(0);

    const firstCellBox = await cells.first().boundingBox();
    const lastCellBox = await cells.last().boundingBox();
    const firstSelectorBox = await selectors.first().boundingBox();
    const firstSoundLaneBox = await soundLanes.first().boundingBox();
    expect(firstCellBox.height).toBeGreaterThanOrEqual(104);
    expect(firstCellBox.height).toBeLessThanOrEqual(136);
    expect(firstSoundLaneBox.height).toBeGreaterThanOrEqual(60);
    expect(firstSelectorBox.height).toBeGreaterThanOrEqual(44);
    expect(firstSelectorBox.height).toBeLessThanOrEqual(45);
    expect(firstSoundLaneBox.y).toBeGreaterThanOrEqual(
      firstSelectorBox.y + firstSelectorBox.height - 1,
    );
    expect(Math.abs(firstCellBox.y - lastCellBox.y)).toBeLessThanOrEqual(1);

    const initialOptionCounts = await selectors.evaluateAll(
      (items) => items.map(({ options }) => options.length),
    );
    expect(Math.max(...initialOptionCounts)).toBeLessThanOrEqual(2);

    await expect(cells.first()).toHaveAttribute("tabindex", "0");
    await expect(cells.nth(1)).toHaveAttribute("tabindex", "-1");
    await cells.first().focus();
    await cells.first().press("ArrowRight");
    await expect(cells.nth(1)).toBeFocused();
    await expect(cells.first()).toHaveAttribute("tabindex", "-1");
    await expect(cells.nth(1)).toHaveAttribute("tabindex", "0");
    await cells.nth(1).press("End");
    await expect(cells.last()).toBeFocused();
    await cells.last().press("Home");
    await expect(cells.first()).toBeFocused();

    await page.locator("#clearPatternButton").click();
    const firstCell = cells.first();
    const firstSelector = selectors.first();
    await expect(firstCell).toHaveAttribute("data-active", "false");
    await expect(firstSelector).toHaveValue("");
    await expect(firstSelector.locator("option:checked")).toHaveText("+");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

    await soundLanes.first().scrollIntoViewIfNeeded();
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
      await expect(selectors.nth(step)).toHaveValue("");
    }
    await soundLanes.first().focus();
    await soundLanes.first().press("ArrowUp");
    await expect(soundLanes.first()).toHaveValue("1");
    await expect(firstCell).toHaveAttribute("data-active", "false");
    await expect(firstSelector).toHaveValue("");
    await expect(page.locator("#liveStatus")).toContainText(
      "empty; add volume or choose from the pull-down first",
    );

    const firstVolumeBox = await volumeLanes.first().boundingBox();
    await page.mouse.click(
      firstVolumeBox.x + firstVolumeBox.width / 2,
      firstVolumeBox.y + firstVolumeBox.height * 0.5,
    );
    await expect(firstCell).toHaveAttribute("data-active", "true");
    const clickedVelocity = Number(await firstCell.evaluate(
      (cell) => cell.style.getPropertyValue("--step-velocity"),
    ));
    expect(clickedVelocity).toBeCloseTo(0.5, 2);
    const midpointFillRatio = await firstCell.evaluate((cell) => {
      const lane = cell.querySelector(".creaturazoid-step-volume-lane");
      const fillHeight = Number.parseFloat(getComputedStyle(lane, "::before").height);
      return fillHeight / lane.getBoundingClientRect().height;
    });
    expect(midpointFillRatio).toBeCloseTo(0.5, 2);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

    await page.mouse.move(
      firstVolumeBox.x + firstVolumeBox.width / 2,
      firstVolumeBox.y + firstVolumeBox.height * 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      firstVolumeBox.x + firstVolumeBox.width / 2,
      firstVolumeBox.y + firstVolumeBox.height,
    );
    await page.mouse.up();
    await expect(firstCell).toHaveAttribute("data-active", "false");
    await expect(firstSelector).toHaveValue("");

    const paintStart = await volumeLanes.nth(0).boundingBox();
    const paintEnd = await volumeLanes.nth(5).boundingBox();
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
    await page.mouse.up();
    const paintedVelocities = await cells.evaluateAll((items) => items.slice(0, 6).map(
      (cell) => Number(cell.style.getPropertyValue("--step-velocity")),
    ));
    expect(paintedVelocities).toEqual([0.75, 0.65, 0.55, 0.45, 0.35, 0.25]);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

    const secondSelector = selectors.nth(1);
    await firstSelector.focus();
    await expect(firstSelector.locator("option")).toHaveCount(51);
    await firstSelector.selectOption("growl");
    await secondSelector.focus();
    await secondSelector.selectOption("purr");
    const secondVolumeBox = await volumeLanes.nth(1).boundingBox();
    await page.mouse.move(
      secondVolumeBox.x + secondVolumeBox.width / 2,
      secondVolumeBox.y + secondVolumeBox.height * 0.4,
    );
    await page.mouse.down();
    await page.mouse.move(
      secondVolumeBox.x + secondVolumeBox.width / 2,
      secondVolumeBox.y + secondVolumeBox.height,
    );
    await expect(secondSelector).toHaveValue("");
    await page.mouse.move(
      secondVolumeBox.x + secondVolumeBox.width / 2,
      secondVolumeBox.y + secondVolumeBox.height * 0.6,
    );
    await page.mouse.up();
    await expect(firstSelector).toHaveValue("growl");
    await expect(secondSelector).toHaveValue("purr");

    const programmedVelocity = await firstCell.getAttribute("data-velocity");
    const programmedSound = await firstSelector.inputValue();
    await grid.locator(".creaturazoid-step-audition").first().click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#liveStatus")).toContainText(
      "Audio is off — turn it on to hear this step",
    );
    await expect(firstCell).toHaveAttribute("data-velocity", programmedVelocity);
    await expect(firstSelector).toHaveValue(programmedSound);

    const velocitiesBeforeSoundPaint = await cells.evaluateAll((items) => items.slice(0, 6).map(
      (cell) => Number(cell.style.getPropertyValue("--step-velocity")),
    ));
    await soundLanes.first().scrollIntoViewIfNeeded();
    const soundPaintStart = await soundLanes.nth(0).boundingBox();
    const soundPaintEnd = await soundLanes.nth(5).boundingBox();
    expect(soundPaintStart.y + soundPaintStart.height).toBeLessThanOrEqual(844);
    await page.mouse.move(
      soundPaintStart.x + soundPaintStart.width / 2,
      soundPaintStart.y + soundPaintStart.height - 4,
    );
    await page.mouse.down();
    await page.mouse.move(
      soundPaintStart.x + soundPaintStart.width / 2,
      soundPaintStart.y + soundPaintStart.height - 0.5,
      { steps: 1 },
    );
    await page.mouse.move(
      soundPaintEnd.x + soundPaintEnd.width / 2,
      soundPaintEnd.y + 0.5,
      { steps: 1 },
    );
    await page.mouse.up();
    const paintedSoundIds = await selectors.evaluateAll(
      (items) => items.slice(0, 6).map((selector) => selector.value),
    );
    expect(paintedSoundIds[0]).toBe("roar");
    expect(paintedSoundIds[5]).toBe("jumping");
    expect(new Set(paintedSoundIds).size).toBe(6);
    await expect(soundLanes.nth(0)).toHaveValue("1");
    await expect(soundLanes.nth(5)).toHaveValue("50");
    const velocitiesAfterSoundPaint = await cells.evaluateAll((items) => items.slice(0, 6).map(
      (cell) => Number(cell.style.getPropertyValue("--step-velocity")),
    ));
    expect(velocitiesAfterSoundPaint).toEqual(velocitiesBeforeSoundPaint);

    await firstCell.focus();
    const keyboardStartVelocity = Number(await firstCell.getAttribute("data-velocity"));
    await firstCell.press("ArrowDown");
    expect(Number(await firstCell.getAttribute("data-velocity"))).toBeCloseTo(
      keyboardStartVelocity - 0.05,
      2,
    );
    await firstCell.press("Shift+ArrowUp");
    expect(Number(await firstCell.getAttribute("data-velocity"))).toBeCloseTo(
      keyboardStartVelocity + 0.05,
      2,
    );
    await firstCell.press("Delete");
    await expect(firstCell).toHaveAttribute("data-active", "false");
    await firstCell.press("ArrowUp");
    await expect(firstCell).toHaveAttribute("data-active", "true");
    expect(Number(await firstCell.getAttribute("data-velocity"))).toBeCloseTo(0.72, 2);

    await page.locator("#sequenceLengthEntry").fill("64");
    await page.locator("#sequenceLengthEntry").press("Enter");
    await expect(grid).toHaveAttribute("aria-colcount", "64");
    await expect(slots).toHaveCount(64);
    await expect(cells).toHaveCount(64);
    await expect(soundLanes).toHaveCount(64);
    await expect(grid.locator(".creaturazoid-grid-row")).toHaveCount(1);
    const longFirstBox = await cells.first().boundingBox();
    const longLastBox = await cells.last().boundingBox();
    expect(Math.abs(longFirstBox.y - longLastBox.y)).toBeLessThanOrEqual(1);
    const retainedOptionCounts = await selectors.evaluateAll(
      (items) => items.map(({ options }) => options.length),
    );
    expect(Math.max(...retainedOptionCounts)).toBeLessThanOrEqual(2);

    const longSelectorBox = await selectors.first().boundingBox();
    const longSoundLaneBox = await soundLanes.first().boundingBox();
    expect(longSoundLaneBox.y).toBeGreaterThanOrEqual(
      longSelectorBox.y + longSelectorBox.height - 1,
    );
  });
});

test.describe("Creaturazoid live sequence lifecycle", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("keeps the complete lower lane visible and reconciles a running shrink", async ({ page }) => {
    await page.goto("/creaturazoid.html");

    const scroller = page.locator(".creaturazoid-grid-scroll");
    const selectors = page.locator(".creaturazoid-step-sound-select");
    const soundLanes = page.locator(".creaturazoid-step-sound-lane");
    const grid = page.locator("#sequenceGrid");
    const audioButton = page.locator("#audioButton");
    const playButton = page.locator("#playButton");
    const playState = page.locator("#playState");

    const containment = await scroller.evaluate((element) => {
      const firstSelector = element.querySelector(".creaturazoid-step-sound-select");
      const firstLane = element.querySelector(".creaturazoid-step-sound-lane-shell");
      const scrollerRect = element.getBoundingClientRect();
      const selectorRect = firstSelector.getBoundingClientRect();
      const laneRect = firstLane.getBoundingClientRect();
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        selectorBottom: selectorRect.bottom,
        laneBottom: laneRect.bottom,
        scrollerBottom: scrollerRect.bottom,
      };
    });
    expect(containment.selectorBottom).toBeLessThanOrEqual(containment.scrollerBottom + 1);
    expect(containment.laneBottom).toBeLessThanOrEqual(containment.scrollerBottom + 1);
    expect(containment.scrollHeight).toBeLessThanOrEqual(containment.clientHeight + 1);
    await expect(selectors.first()).toBeVisible();
    await expect(soundLanes.first()).toBeVisible();

    const audition = grid.locator(".creaturazoid-step-audition:not([disabled])").first();
    const auditionCell = audition.locator("xpath=preceding-sibling::*[contains(@class, 'creaturazoid-step-cell')][1]");
    const velocityBefore = await auditionCell.getAttribute("data-velocity");

    await audioButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "true");
    await audition.click();
    await expect(page.locator("#liveStatus")).toContainText("heard without changing step");
    await expect(auditionCell).toHaveAttribute("data-velocity", velocityBefore);
    await expect(playButton).toHaveAttribute("aria-pressed", "false");

    await playButton.click();
    await expect(playButton).toHaveAttribute("aria-pressed", "true");
    await expect(grid.locator(".creaturazoid-step-cell.is-current")).toHaveCount(1);
    await audition.click();
    await expect(page.locator("#liveStatus")).toContainText(
      "Sequence is playing — stop it before hearing one step on its own",
    );
    await expect(playButton).toHaveAttribute("aria-pressed", "true");

    await page.locator("#sequenceLengthEntry").fill("1");
    await page.locator("#sequenceLengthEntry").press("Enter");
    await expect(grid).toHaveAttribute("aria-colcount", "1");
    await expect(grid.locator(".creaturazoid-step-slot")).toHaveCount(1);
    await expect(grid.locator(".creaturazoid-step-cell.is-current")).toHaveCount(1);
    for (let sample = 0; sample < 5; sample += 1) {
      await expect(playState).toContainText("step 1");
      await expect(grid.locator(".creaturazoid-step-cell.is-current")).toHaveCount(1);
      await page.waitForTimeout(35);
    }
    await expect(playButton).toHaveAttribute("aria-pressed", "true");

    await playButton.click();
    await expect(playButton).toHaveAttribute("aria-pressed", "false");
  });
});

import { expect, test } from "@playwright/test";

async function openJawJam(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("jaw-jam.html", { waitUntil: "load" });
  if (errors.length) throw new Error(`Jaw Jam page error: ${errors.join(" | ")}`);
  await expect(page.locator("#sequenceLane .jaw-jam-step")).toHaveCount(16);
  return errors;
}

async function setRange(locator, value) {
  await locator.evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function selectStep(page, index) {
  await page.locator("#sequenceLane .jaw-jam-step").nth(index).locator(".jaw-jam-step-number").click();
  await expect(page.locator("#sequenceLane .jaw-jam-step").nth(index)).toHaveClass(/is-selected/);
}

async function cardWidth(locator) {
  return locator.evaluate((card) => card.getBoundingClientRect().width);
}

test("Jaw Jam builds a compact monophonic lane and edits actions in one shared inspector", async ({ page }) => {
  const errors = await openJawJam(page);
  const cards = page.locator("#sequenceLane .jaw-jam-step");
  const first = cards.first();
  const second = cards.nth(1);

  expect(await cardWidth(first)).toBeLessThanOrEqual(84.5);
  await expect(first).toHaveClass(/is-pluck/);
  await expect(first.locator(".jaw-jam-step-action")).toHaveText("PLUCK");
  await expect(first.locator(".jaw-jam-pitch-lane")).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator("#stepActionPluck")).toHaveAttribute("aria-pressed", "true");
  await expect(second).toHaveClass(/is-sustain/);
  await expect(second.locator(".jaw-jam-step-action")).toHaveText("HOLD");
  await expect(second.locator(".jaw-jam-note-block")).toContainText("HOLD");

  await page.locator("#stepActionSustain").click();
  await expect(first).toHaveClass(/is-sustain/);
  await expect(first.locator(".jaw-jam-step-action")).toHaveText("HOLD");
  await expect(page.locator("#stepActionSustain")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stepPitch")).toBeDisabled();
  await expect(page.locator("#stepPull")).toBeDisabled();
  await expect(page.locator("#stepVowel")).toBeEnabled();
  await expect(page.locator("#stepVoice")).toBeEnabled();
  await expect(page.locator("#stepAir")).toBeEnabled();
  await expect(page.locator("#stepRate")).toBeEnabled();

  await page.locator("#stepActionRest").click();
  await expect(first).toHaveClass(/is-rest/);
  await expect(first.locator(".jaw-jam-step-action")).toHaveText("X");
  await expect(first.locator(".jaw-jam-pitch-lane")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#stepActionRest")).toHaveAttribute("aria-pressed", "true");
  for (const id of ["stepVowel", "stepVoice", "stepPitch", "stepPull", "stepAir", "stepRate"]) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }

  await page.locator("#stepActionPluck").click();
  await expect(first).toHaveClass(/is-pluck/);
  await expect(first.locator(".jaw-jam-pitch-lane")).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator("#stepPitch")).toBeEnabled();
  await expect(page.locator("#stepPull")).toBeEnabled();

  await selectStep(page, 1);
  await expect(page.locator("#stepActionSustain")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#selectedStepNumber")).toHaveText("02");
  expect(errors).toEqual([]);
});

test("Jaw Jam shared inspector edits one step and keeps the live performer in sync", async ({ page }) => {
  const errors = await openJawJam(page);
  const cards = page.locator("#sequenceLane .jaw-jam-step");
  const first = cards.first();
  const pitchLane = first.locator(".jaw-jam-pitch-lane");

  await selectStep(page, 1);
  const originalSecondVowel = await page.locator("#stepVowel").inputValue();
  await selectStep(page, 0);
  const originalMidi = Number(await page.locator("#stepPitch").inputValue());

  await pitchLane.focus();
  await page.keyboard.press("ArrowUp");
  await expect(pitchLane).toHaveAttribute("aria-valuenow", String(originalMidi + 1));
  await expect(page.locator("#stepPitch")).toHaveValue(String(originalMidi + 1));
  await expect(page.locator("#selectedStepSummary")).toContainText("Step 01");

  const soundSelect = page.locator("#stepVoice");
  expect(await soundSelect.locator("option").count()).toBeGreaterThanOrEqual(32);
  const originalSound = await soundSelect.inputValue();
  const alternateSound = await soundSelect.locator("option").evaluateAll(
    (options, current) => options.map(({ value }) => value).find((value) => value !== current),
    originalSound,
  );
  expect(alternateSound).toBeTruthy();
  await soundSelect.selectOption(alternateSound);
  await expect(page.locator("#stepVoice")).toHaveValue(alternateSound);
  await expect(page.locator("#patternSelect")).toHaveValue("custom");

  await page.locator("#stepVowel").selectOption("i");
  await expect(page.locator("#stepVowel")).toHaveValue("i");
  await expect(page.locator("#selectedStepSummary")).toContainText(" · I · pull");

  const breathPower = page.locator("#stepAir");
  await setRange(breathPower, 1.25);
  await expect(page.locator("#stepAirOut")).toHaveText("125%");
  await expect(page.locator("#selectedStepSummary")).toContainText("air 125%");
  await expect(page.locator("#selectedStepSummary")).toContainText("= pulse");
  await expect(first.locator(".jaw-jam-pulse-meter")).toHaveAttribute("aria-label", /tine pull plus 125% breath strength/);

  const performer = page.locator("#performerStage");
  await expect(performer).toBeVisible();
  const performerBox = await performer.boundingBox();
  expect(performerBox?.width).toBeGreaterThan(240);
  expect(performerBox?.height).toBeGreaterThan(160);
  await expect(page.locator("#performerStep")).toHaveText("01");
  await expect(page.locator("#performerVowel")).toContainText("i");
  await expect(page.locator("#performerAir")).toHaveText("125%");
  await expect(page.locator("#performerVoice")).not.toHaveText("");
  await expect(page.locator("#performerGesture")).toContainText(/pluck/i);
  await expect(performer).toHaveAttribute("aria-label", /performing step 1: pluck/i);

  await page.locator("#auditionButton").click();
  await page.waitForTimeout(120);
  await selectStep(page, 1);
  await expect(page.locator("#stepVowel")).toHaveValue(originalSecondVowel);
  await expect(page.locator("#performerStep")).toHaveText("02");

  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => {
    const currentIndex = await cards.evaluateAll((items) => items.findIndex((item) => item.classList.contains("is-current")));
    const performerStep = await page.locator("#performerStep").textContent();
    return currentIndex >= 0 && performerStep === String(currentIndex + 1).padStart(2, "0");
  }).toBe(true);
  await page.locator("#playButton").click();
  expect(errors).toEqual([]);
});

test("Jaw Jam paints pitch and plucks across consecutive steps with one WebGPU-style drag", async ({ page }) => {
  const errors = await openJawJam(page);
  const cards = page.locator("#sequenceLane .jaw-jam-step");

  await page.locator("#clearPatternButton").click();
  await expect(cards.locator(".jaw-jam-step-action")).toHaveText(Array(16).fill("X"));
  await page.locator('[data-paint-mode="pitch"]').click();
  await expect(page.locator('[data-paint-mode="pitch"]')).toHaveAttribute("aria-pressed", "true");

  await cards.nth(0).locator(".jaw-jam-pitch-lane").scrollIntoViewIfNeeded();
  const firstLaneBox = await cards.nth(0).locator(".jaw-jam-pitch-lane").boundingBox();
  const lastLaneBox = await cards.nth(5).locator(".jaw-jam-pitch-lane").boundingBox();
  expect(firstLaneBox).toBeTruthy();
  expect(lastLaneBox).toBeTruthy();

  await page.mouse.move(
    firstLaneBox.x + firstLaneBox.width / 2,
    firstLaneBox.y + firstLaneBox.height * 0.82,
  );
  await page.mouse.down();
  for (let index = 1; index <= 5; index += 1) {
    const laneBox = await cards.nth(index).locator(".jaw-jam-pitch-lane").boundingBox();
    const unit = index / 5;
    await page.mouse.move(
      laneBox.x + laneBox.width / 2,
      laneBox.y + laneBox.height * (0.82 - unit * 0.64),
      { steps: 2 },
    );
  }
  await page.mouse.up();

  for (let index = 0; index <= 5; index += 1) {
    await expect(cards.nth(index)).toHaveClass(/is-pluck/);
  }
  await expect(page.locator("#sequenceLane .jaw-jam-step.is-rest")).toHaveCount(10);
  const paintedMidi = await cards.locator(".jaw-jam-pitch-lane").evaluateAll((lanes) => (
    lanes.slice(0, 6).map((lane) => Number(lane.getAttribute("aria-valuenow")))
  ));
  expect(new Set(paintedMidi).size).toBeGreaterThan(2);
  expect(paintedMidi.at(-1)).toBeGreaterThan(paintedMidi[0]);
  await expect(page.locator("#selectedStepNumber")).toHaveText("06");
  await expect(page.locator("#patternSelect")).toHaveValue("custom");

  await page.locator('[data-paint-mode="pull"]').click();
  const untouchedRestBox = await cards.nth(6).locator(".jaw-jam-pitch-lane").boundingBox();
  expect(untouchedRestBox).toBeTruthy();
  await page.mouse.click(
    untouchedRestBox.x + untouchedRestBox.width / 2,
    untouchedRestBox.y + untouchedRestBox.height / 2,
  );
  await expect(page.locator("#selectedStepNumber")).toHaveText("07");
  await expect(page.locator("#selectedStepSummary")).toContainText("Step 07");
  await expect(cards.nth(6)).toHaveClass(/is-rest/);
  expect(errors).toEqual([]);
});

test("Jaw Jam retimes both clocks, resizes the lane, and keeps random phrases sounding", async ({ page }) => {
  const errors = await openJawJam(page);

  await setRange(page.locator("#tempo"), 200);
  await expect(page.locator("#tempoOut")).toHaveText("200 BPM");
  await setRange(page.locator("#swing"), -0.2);
  await expect(page.locator("#swingOut")).toHaveText("-20%");
  await page.locator("#breathRatio").selectOption("3");
  await expect(page.locator("#breathRatioOut")).toHaveText("3× per beat");
  await expect(page.locator("#breathClockReadout")).toContainText("3× per beat");

  await setRange(page.locator("#sequenceLength"), 8);
  const cards = page.locator("#sequenceLane .jaw-jam-step");
  await expect(cards).toHaveCount(8);
  await expect(page.locator("#sequenceLengthOut")).toHaveText("8 steps");

  await page.locator("#clearPatternButton").click();
  await expect(page.locator("#sequenceLane .jaw-jam-step.is-rest")).toHaveCount(8);
  await expect(page.locator("#liveStatus")).toHaveText("All steps changed to hard rests");

  await page.locator("#randomPatternButton").click();
  await expect(cards).toHaveCount(8);
  await expect.poll(() => cards.locator(".jaw-jam-step-action").allTextContents()).not.toEqual(Array(8).fill("X"));
  await expect(page.locator("#liveStatus")).toHaveText("Virtuosic Jaw Jam pattern randomized");
  expect(errors).toEqual([]);
});

test("Jaw Jam remains keyboard-operable inside a narrow horizontal scroller", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openJawJam(page);
  const scroller = page.locator("#sequenceScroller");
  const first = page.locator(".jaw-jam-step").first();
  const second = page.locator(".jaw-jam-step").nth(1);

  const dimensions = await scroller.evaluate(({ scrollWidth, clientWidth }) => ({ scrollWidth, clientWidth }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  expect(await cardWidth(first)).toBeLessThanOrEqual(84.5);
  const visibleCards = await page.locator("#sequenceLane .jaw-jam-step").evaluateAll((cards, bounds) => cards.filter((card) => {
    const rect = card.getBoundingClientRect();
    return rect.right > bounds.left && rect.left < bounds.right;
  }).length, await scroller.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }));
  expect(visibleCards).toBeGreaterThanOrEqual(4);

  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second).toHaveClass(/is-selected/);
  await expect(page.locator("#selectedStepSummary")).toContainText("Step 02");
  await page.keyboard.press("x");
  await expect(second).toHaveClass(/is-rest/);
  await expect(second.locator(".jaw-jam-step-action")).toHaveText("X");
  await expect(page.locator("#stepActionRest")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stepAir")).toBeDisabled();
  expect(errors).toEqual([]);
});

import { expect, test } from "@playwright/test";

import { settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

async function openHarmonicazoid(page) {
  const diagnostics = watchPageDiagnostics(page);
  const response = await page.goto("harmonica.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `harmonica.html returned HTTP ${response?.status()}`).toBe(true);
  await settlePage(page);
  await expect(page.locator("#stage")).toBeVisible();
  return diagnostics;
}

function expectNoPageErrors(diagnostics) {
  expect(diagnostics.pageErrors, "Harmonicazoid raised a page exception").toEqual([]);
}

test("Harmonicazoid exposes the renamed instrument and all five linked views", async ({ page }) => {
  const diagnostics = await openHarmonicazoid(page);

  await expect(page).toHaveTitle("Harmonicazoid · Morphazoid");
  await expect(page.locator(".harmonica-stage-heading h1")).toHaveText(/HARMONI\s*CAZOID/u);
  const currentNavLabel = page.getByRole("navigation", { name: "Morphazoid main menu" }).locator("strong");
  await expect(currentNavLabel).toBeVisible();
  await expect(currentNavLabel).toHaveText("Harmonicazoid");
  const mobileInstrumentHref = await page.locator(".mobile-instrument-select").inputValue();
  expect(new URL(mobileInstrumentHref, page.url()).pathname).toBe("/harmonica.html");
  await expect(page.locator(".mobile-instrument-select option:checked")).toHaveText(/harmonicazoid/iu);

  const canvasDescription = (await page.locator("#stage").getAttribute("aria-label")) ?? "";
  const linkedViews = [
    { label: "NOTE / HOLE", terms: ["note rail"] },
    { label: "LIP / TONGUE", terms: ["lip bracket", "tongue"] },
    { label: "BEND / REEDS", terms: ["bend ladder"] },
    { label: "HANDS / CUP", terms: ["hands", "cup"] },
    { label: "BREATH / RHYTHM", terms: ["breath ribbon", "rhythm"] },
  ];
  expect(canvasDescription).toMatch(/five simultaneous views/iu);
  expect(canvasDescription).toMatch(/round, unfilled head, nose, and hands traced in pink and blue/iu);
  for (const view of linkedViews) {
    for (const term of view.terms) {
      expect(
        canvasDescription.toLowerCase(),
        `${view.label} is missing “${term}” from the accessible canvas description`,
      ).toContain(term);
    }
  }

  expectNoPageErrors(diagnostics);
});

test("key selection retunes every hole while a body change retains the chosen key", async ({ page }) => {
  const diagnostics = await openHarmonicazoid(page);
  const noteLabels = page.locator("#holeButtons .harmonica-hole-button small");
  const bodySelect = page.locator("#presetSelect");
  const keySelect = page.locator("#keySelect");

  await expect(noteLabels).toHaveCount(10);
  await expect(keySelect).toHaveValue("c");
  const cLabels = await noteLabels.allTextContents();
  const initialBody = await bodySelect.inputValue();

  await keySelect.selectOption("d");
  await expect(keySelect).toHaveValue("d");
  await expect(noteLabels.first()).toHaveText("D / E");
  await expect(page.locator('[data-hole="1"]')).toHaveAttribute(
    "aria-label",
    "Hole 1; blow D4; draw E4",
  );
  const dLabels = await noteLabels.allTextContents();
  expect(dLabels).not.toEqual(cLabels);

  const alternateBody = await bodySelect.locator("option").evaluateAll(
    (options, current) => options.map(({ value }) => value).find((value) => value !== current),
    initialBody,
  );
  expect(alternateBody).toBeTruthy();
  await bodySelect.selectOption(alternateBody);
  await expect(bodySelect).toHaveValue(alternateBody);
  await expect(keySelect).toHaveValue("d");
  expect(await noteLabels.allTextContents()).toEqual(dLabels);

  expectNoPageErrors(diagnostics);
});

test("performance presets and Randomize keep a scored breath groove playing", async ({ page }) => {
  const diagnostics = await openHarmonicazoid(page);
  const performanceSelect = page.locator("#performancePresetSelect");
  const autoButton = page.locator("#breathCycleButton");
  const initialBody = await page.locator("#presetSelect").inputValue();
  const initialKey = await page.locator("#keySelect").inputValue();

  await expect(performanceSelect.locator("option")).toHaveCount(15);
  await expect(performanceSelect).toHaveValue("midnight-growl");
  await expect(page.locator("#bluesTechniqueSelect")).toHaveValue("growl");
  await expect(page.locator("#bluesRhythmSelect")).toHaveValue("slow-drag");
  await expect(page.locator("#breathRateBpm")).toHaveValue("24");
  await expect(page.locator("#breathShiftSlop")).toHaveValue("0.84");
  await expect(autoButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#breathScore > span")).toHaveCount(8);
  await expect(page.locator("#breathScore > .is-current")).toHaveCount(1);

  await performanceSelect.selectOption("tongue-block-boogie");
  await expect(page.locator("#presetSelect")).toHaveValue(initialBody);
  await expect(page.locator("#keySelect")).toHaveValue(initialKey);
  await expect(page.locator("#bluesRhythmSelect")).toHaveValue("walking-boogie");
  await expect(page.locator("#cupMotionDepth")).toHaveValue("0.42");
  await expect(page.locator("#tongueMotionDepth")).toHaveValue("0.82");
  await expect(autoButton).toHaveAttribute("aria-pressed", "true");

  await page.locator("#randomizeButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  await expect(autoButton).toHaveAttribute("aria-pressed", "true");
  await expect(performanceSelect).not.toHaveValue("custom");
  await expect(page.locator("#bluesRhythmSelect")).not.toHaveValue("free");
  expect(Number(await page.locator("#breathPressure").inputValue())).toBeGreaterThanOrEqual(0.72);
  expect(Number(await page.locator("#reedGap").inputValue())).toBeGreaterThanOrEqual(0.34);
  await expect(page.locator("#breathScore > .is-current")).toHaveCount(1);

  const sliderBackground = await page.locator("#cupMotionDepth").evaluate(
    (input) => getComputedStyle(input).backgroundColor,
  );
  expect(sliderBackground).toBe("rgba(0, 0, 0, 0)");
  expectNoPageErrors(diagnostics);
});

test("mouth-window edges drag across one to five holes and top breath controls stay live", async ({ page }) => {
  const diagnostics = await openHarmonicazoid(page);
  const rail = page.locator("#holeButtons");
  const window = page.locator("#holeWindow");
  const rightHandle = page.locator("#holeWindowRight");
  const leftHandle = page.locator("#holeWindowLeft");

  await expect(page.locator("#chordWidthButtons button[data-chord-width]")).toHaveCount(5);
  await expect(window).toHaveAttribute("data-first-hole", "1");
  await expect(window).toHaveAttribute("data-last-hole", "2");

  const railBox = await rail.boundingBox();
  const rightBox = await rightHandle.boundingBox();
  expect(railBox).toBeTruthy();
  expect(rightBox).toBeTruthy();
  await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(railBox.x + railBox.width * 0.49, railBox.y + railBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#chordWidth")).toHaveValue("5");
  await expect(window).toHaveAttribute("data-first-hole", "1");
  await expect(window).toHaveAttribute("data-last-hole", "5");

  const leftBox = await leftHandle.boundingBox();
  expect(leftBox).toBeTruthy();
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(railBox.x + railBox.width * 0.2, railBox.y + railBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#chordWidth")).toHaveValue("3");
  await expect(window).toHaveAttribute("data-first-hole", "3");
  await expect(window).toHaveAttribute("data-last-hole", "5");

  await page.locator("#breathRateBpm").fill("96");
  await expect(page.locator("#breathRateBpmOut")).toHaveText("96 cycles/min");
  await page.locator("#breathShiftSlop").fill("0");
  await expect(page.locator("#breathShiftSlopOut")).toHaveText("pristine");
  await page.locator("#breathShiftSlop").fill("1");
  await expect(page.locator("#breathShiftSlopOut")).toHaveText("sloppy");

  expectNoPageErrors(diagnostics);
});

for (const layout of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone portrait", width: 390, height: 844 },
]) {
  test(`canvas stays fully visible and clear of the controls at ${layout.name} size`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    const diagnostics = await openHarmonicazoid(page);

    const geometry = await page.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect && {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const intersection = (first, second) => ({
        width: Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left)),
        height: Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)),
      });
      const canvas = box("#stage");
      const panel = box(".panel");
      const transport = box(".harmonica-transport");
      return {
        canvas,
        panel,
        transport,
        canvasPanelIntersection: intersection(canvas, panel),
        canvasTransportIntersection: intersection(canvas, transport),
        viewport: { width: innerWidth, height: innerHeight },
      };
    });

    expect(geometry.canvas.width).toBeGreaterThan(250);
    expect(geometry.canvas.height).toBeGreaterThan(180);
    expect(geometry.canvas.left).toBeGreaterThanOrEqual(-1);
    expect(geometry.canvas.top).toBeGreaterThanOrEqual(-1);
    expect(geometry.canvas.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
    expect(geometry.canvas.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
    expect(
      geometry.canvasPanelIntersection.width * geometry.canvasPanelIntersection.height,
      "canvas overlaps the scrolling control panel",
    ).toBeLessThanOrEqual(1);
    expect(
      geometry.canvasTransportIntersection.width * geometry.canvasTransportIntersection.height,
      "canvas overlaps the breath transport",
    ).toBeLessThanOrEqual(1);

    expectNoPageErrors(diagnostics);
  });
}

test("performance keys step holes, hold breath, snap bends, and toggle Auto with Space", async ({ page }) => {
  const diagnostics = await openHarmonicazoid(page);
  const stage = page.locator("#stage");
  const drawButton = page.locator("#drawButton");
  const blowButton = page.locator("#blowButton");
  const autoButton = page.locator("[data-primary-transport]");

  await stage.focus();
  await expect(page.locator("#hole")).toHaveValue("2");
  await page.keyboard.press("a");
  await expect(page.locator("#hole")).toHaveValue("1");
  await page.keyboard.press("d");
  await expect(page.locator("#hole")).toHaveValue("2");

  await expect(page.locator("#bend")).toHaveValue("0.52");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#bend")).toHaveValue("0.02");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#bend")).toHaveValue("0.52");
  await expect(page.locator("#bendReadout")).toContainText("1.04 semitones");

  await page.keyboard.down("w");
  await expect(blowButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#breathReadout")).toContainText("blow");
  await page.keyboard.up("w");
  await expect(blowButton).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.down("s");
  await expect(drawButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#breathReadout")).toContainText("draw");
  await page.keyboard.up("s");
  await expect(drawButton).toHaveAttribute("aria-pressed", "false");

  await expect(autoButton).toHaveAttribute("aria-keyshortcuts", "Space");
  await expect(autoButton).toHaveAttribute("aria-pressed", "true");
  await stage.focus();
  await page.keyboard.press("Space");
  await expect(autoButton).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Space");
  await expect(autoButton).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });

  expectNoPageErrors(diagnostics);
});

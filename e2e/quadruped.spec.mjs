import { test, expect } from "@playwright/test";
import { QUADRUPED_ANIMALS, QUADRUPED_BEHAVIORS } from "../src/quadruped.js";

test.describe("Quadruped", () => {
  test("edits four touchdown lanes while transport remains independent of Audio", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const response = await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBe(true);

    await expect(page.getByRole("heading", { name: /quadruped/i })).toBeVisible();
    await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "8");
    await expect(page.getByRole("grid")).toHaveAttribute("aria-colcount", "17");
    await expect(page.getByRole("gridcell")).toHaveCount(112);
    await expect(page.getByRole("columnheader")).toHaveCount(16);
    await expect(page.locator("[data-animal-id]")).toHaveCount(QUADRUPED_ANIMALS.length);
    await expect(page.locator("[data-behavior-id]")).toHaveCount(QUADRUPED_BEHAVIORS.length);
    await expect(page.locator(".quadruped-cabinet-frame")).toHaveCount(16);
    await expect(page.locator(".quadruped-cabinet-frame canvas")).toHaveCount(16);

    const play = page.locator("#playButton");
    const audio = page.locator("#audioButton");
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#transportHint")).toContainText("Audio is off — turn it on to hear playback");
    const firstPosition = Number(await page.locator("#stage").getAttribute("data-clock-position"));
    await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-clock-position"))).toBeGreaterThan(firstPosition + 1);
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(50);
    const pauseFrame = await page.locator("#stage").getAttribute("data-frame");
    await page.waitForTimeout(350);
    expect(await page.locator("#stage").getAttribute("data-frame")).toBe(pauseFrame);
    await play.click();

    const firstFoot = page.getByRole("button", { name: /^Left front foot, frame 1:/ });
    await expect(firstFoot).toHaveAttribute("data-level", "none");
    await expect(firstFoot).toHaveAttribute("aria-pressed", "false");
    await expect(firstFoot).toHaveText("·");
    await firstFoot.click();
    await expect(firstFoot).toHaveAttribute("data-level", "soft");
    await expect(firstFoot).toHaveAttribute("aria-pressed", "mixed");
    await expect(firstFoot).toHaveText("○");
    await firstFoot.click();
    await expect(firstFoot).toHaveAttribute("data-level", "strong");
    await expect(firstFoot).toHaveAttribute("aria-pressed", "true");
    await expect(firstFoot).toHaveText("●");
    await expect(page.locator("#behaviorReadout")).toContainText("custom");

    await firstFoot.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: /^Left front foot, frame 2:/ })).toBeFocused();
    await expect(page.locator("#sequenceGrid button[tabindex='0']")).toHaveCount(1);

    const authoredHindFoot = page.getByRole("button", { name: /^Right hind foot, frame 1: strong touchdown/ });
    await authoredHindFoot.focus();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("button", { name: /^Right hind foot, frame 1: no new touchdown/ })).toHaveAttribute("data-level", "none");

    await page.locator("#terrain").selectOption("crystal");
    await expect(page.locator("#terrainReadout")).toHaveText("Resonant crystal");
    await page.locator("#groundProfile").selectOption("stairs-up");
    await expect(page.locator("#groundProfileReadout")).toHaveText("Steps up");

    await page.getByRole("button", { name: /^Unicorn/ }).click();
    await expect(page.locator("#animalReadout")).toHaveText("Unicorn");
    await expect(page.locator("[data-behavior-id]")).toHaveCount(QUADRUPED_BEHAVIORS.length);
    await page.locator('[data-behavior-id="trot"]').click();
    await expect(page.locator("#behaviorReadout")).toHaveText("Trot");
    await expect(page.locator("#behaviorDescription")).toContainText("diagonal pairs");
    // Longer uphill rear support closes this trot's short float interval.
    await expect(page.locator(".quadruped-cabinet-frame[data-air='true']")).toHaveCount(0);
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: /^Elephant/ }).click();
    await expect(page.locator("#behaviorReadout")).toHaveText("Trot");
    await expect(page.getByRole("button", { name: /^Right hind foot, frame 1: strong touchdown/ })).toHaveAttribute("data-level", "strong");
    expect(pageErrors).toEqual([]);
  });

  test("foot propulsion is the only clock and an empty score coasts to a stall", async ({ page }) => {
    await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    const play = page.locator("#playButton");
    const canvas = page.locator("#stage");
    await play.click();
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity")), { timeout: 3_000 }).toBeGreaterThan(0.1);
    await expect.poll(async () => page.locator(".quadruped-cabinet-frame[data-playing='true']").count()).toBe(1);
    await expect.poll(async () => page.evaluate(() => {
      const frame = document.querySelector("#stage").dataset.frame;
      return document.querySelector('.quadruped-cabinet-frame[data-playing="true"]')?.dataset.step === frame;
    })).toBe(true);

    await page.locator("#clearButton").click();
    await expect(page.locator("#playState")).toContainText("stalled", { timeout: 15_000 });
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity")), { timeout: 15_000 }).toBe(0);
    const stalledFrame = await canvas.getAttribute("data-frame");
    await page.waitForTimeout(350);
    expect(await canvas.getAttribute("data-frame")).toBe(stalledFrame);
    await expect(play).toHaveAttribute("aria-pressed", "true");

    const newPush = page.getByRole("button", { name: /^Left front foot, frame 1: no new touchdown/ });
    await newPush.click();
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity")), { timeout: 3_000 }).toBeGreaterThan(0.1);
    await expect(page.locator("#playState")).not.toContainText("stalled");

    await page.locator("#clearButton").click();
    await expect(page.locator("#playState")).toContainText("stalled", { timeout: 15_000 });
    await page.locator('[data-animal-id="gazelle"]').click();
    await expect(page.locator("#playState")).toContainText("stalled");
    await page.locator('[data-behavior-id="trot"]').click();
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity")), { timeout: 3_000 }).toBeGreaterThan(0.1);
    await expect(page.locator("#playState")).not.toContainText("stalled");
  });

  test("global BPM changes the running score immediately and survives animal and gait changes", async ({ page }) => {
    await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    const tempo = page.locator("#tempo");
    const canvas = page.locator("#stage");
    await page.locator("#playButton").click();
    await tempo.fill("60");
    await expect(page.locator("#tempoOut")).toHaveText("60 BPM · global");
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity"))).toBeCloseTo(16, 3);
    await tempo.fill("180");
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity"))).toBeCloseTo(48, 3);
    await page.locator('[data-animal-id="giraffe"]').click();
    await page.locator('[data-behavior-id="trot"]').click();
    await expect(tempo).toHaveValue("180");
    await expect(page.locator("#tempoOut")).toHaveText("180 BPM · global");
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity"))).toBeCloseTo(48, 3);
  });

  test("every animal can borrow the full gait dictionary", async ({ page }) => {
    await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    for (const { id: animalId } of QUADRUPED_ANIMALS) {
      await page.locator(`[data-animal-id="${animalId}"]`).click();
      await expect(page.locator("[data-behavior-id]")).toHaveCount(QUADRUPED_BEHAVIORS.length);
      expect(await page.locator("[data-behavior-id]").evaluateAll(elements => elements.map(element => element.dataset.behaviorId))).toEqual(QUADRUPED_BEHAVIORS.map(({ id }) => id));
      const activeGaitIsVisible = await page.evaluate(() => {
        const list = document.querySelector("#behaviorButtons")?.getBoundingClientRect();
        const active = document.querySelector('#behaviorButtons [aria-pressed="true"]')?.getBoundingClientRect();
        return Boolean(list && active && active.top >= list.top - 1 && active.bottom <= list.bottom + 1);
      });
      expect(activeGaitIsVisible).toBe(true);
      await page.locator('[data-behavior-id="run-leap"]').click();
      await expect(page.locator("#behaviorReadout")).toContainText("Run ×3 · leap");
    }
  });

  test("pace edits stay live, long leaps rest, and body skids sustain a material scrape", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/quadruped.html");
    const stage = page.locator("#stage");
    await page.locator("#tempo").fill("60");
    await page.locator("#playButton").click();
    for (const ratio of [0.5, 2, 3, 1]) {
      await page.locator(`[data-pace-ratio="${ratio}"]`).click();
      await expect.poll(async () => Number(await stage.getAttribute("data-motor-velocity"))).toBeCloseTo(16 * ratio, 3);
      await expect(page.locator("#tempo")).toHaveValue("60");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    }
    await page.locator('[data-animal-id="cat"]').click();
    await page.locator('[data-behavior-id="walk-leap"]').click();
    await page.locator("#suspensionBeats").fill("8");
    await expect(page.locator("#phraseLength")).toHaveText("9 beats / loop");
    await page.locator("#audioButton").click();
    await page.locator("#restartButton").click();
    await expect(stage).toHaveAttribute("data-airborne", "true");
    await page.waitForTimeout(1000);
    const restSamples = await page.evaluate(async () => {
      const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
      const samples = [];
      for (let i = 0; i < 5; i += 1) {
        samples.push({ ...document.querySelector("#stage").dataset, rms: getSharedAudioOutputManager().getStatus().rms });
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return samples;
    });
    expect(restSamples.every(sample => sample.support === "0" && sample.airborne === "true" && Number(sample.height) > 0)).toBe(true);
    expect(Math.max(...restSamples.map(sample => sample.rms))).toBeLessThan(0.008);
    expect(Number(restSamples.at(-1).clockPosition)).toBeGreaterThan(Number(restSamples[0].clockPosition));
    await page.locator('[data-animal-id="dinosaur"]').click();
    await expect(page.locator("#behaviorReadout")).toHaveText("Walk ×4 · leap");
    await expect(page.locator("#suspensionBeats")).toHaveValue("8");
    await page.locator('[data-behavior-id="skid"]').click();
    await page.locator("#restartButton").click();
    await expect.poll(async () => Number(await stage.getAttribute("data-body-slide"))).toBe(1);
    await expect(stage).toHaveAttribute("data-support", "0");
    await expect(stage).toHaveAttribute("data-airborne", "false");
    await expect(stage).toHaveAttribute("data-height", "0.0000");
    await expect.poll(async () => page.evaluate(async () => {
      const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
      return getSharedAudioOutputManager().getStatus().rms;
    })).toBeGreaterThan(0.0002);
    await page.locator("#suspensionBeats").fill("2");
    await expect(page.locator("#phraseLength")).toHaveText("3 beats / loop");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("the old spelling redirects without losing query or hash", async ({ page }) => {
    await page.goto("/quadroped.html?animal=gazelle#score", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/quadruped\.html\?animal=gazelle#score$/);
    await expect(page.getByRole("heading", { name: /quadruped/i })).toBeVisible();
  });

  test("Audio can join and leave a moving sequence without changing transport", async ({ page }) => {
    await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    const play = page.locator("#playButton");
    const audio = page.locator("#audioButton");
    await play.click();
    await page.waitForTimeout(220);
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "true");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    for (const { id: animalId } of QUADRUPED_ANIMALS) {
      await page.locator(`[data-animal-id="${animalId}"]`).click();
      await expect.poll(async () => page.evaluate(async () => {
        const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
        const status = getSharedAudioOutputManager().getStatus();
        return status.active && status.peak > 0 && status.connectionCount === 1;
      }), { timeout: 3_000 }).toBe(true);
      const level = await page.evaluate(async () => {
        const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
        return getSharedAudioOutputManager().getStatus();
      });
      expect(Number.isFinite(level.rms)).toBe(true);
      expect(Number.isFinite(level.peak)).toBe(true);
      expect(level.peak).toBeLessThanOrEqual(1);
      expect(level.clipped).toBe(false);
    }
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => page.evaluate(async () => {
      const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
      return getSharedAudioOutputManager().getStatus().connectionCount;
    })).toBe(0);
  });

  for (const viewport of [
    { label: "phone portrait", width: 390, height: 844 },
    { label: "phone landscape", width: 844, height: 390 },
  ]) {
    test(`${viewport.label} keeps the stage and controls reachable`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        gridClient: document.querySelector(".quadruped-grid-scroll")?.clientWidth ?? 0,
        gridScroll: document.querySelector(".quadruped-grid-scroll")?.scrollWidth ?? 0,
        canvasWidth: document.querySelector("#stage")?.getBoundingClientRect().width ?? 0,
      }));
      expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
      expect(dimensions.canvasWidth).toBeLessThanOrEqual(viewport.width);
      expect(dimensions.gridScroll).toBeGreaterThanOrEqual(dimensions.gridClient);
      if (viewport.width === 390) expect(dimensions.gridScroll).toBeGreaterThan(dimensions.gridClient);

      const shell = page.locator(".quadruped-shell");
      const shellBox = await shell.boundingBox();
      await page.mouse.move(shellBox.x + shellBox.width - 8, shellBox.y + shellBox.height - 8);
      await page.mouse.wheel(0, 360);
      await expect.poll(() => shell.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const downwardScroll = await shell.evaluate((element) => element.scrollTop);
      await page.mouse.wheel(0, -180);
      await expect.poll(() => shell.evaluate((element) => element.scrollTop)).toBeLessThan(downwardScroll);
      await shell.evaluate((element) => {
        element.scrollTop = Math.min(900, element.scrollHeight - element.clientHeight);
      });
      await expect.poll(() => shell.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const firstStickyTop = (await page.locator(".quadruped-stage-card").boundingBox())?.y ?? -1;
      await shell.evaluate((element) => {
        element.scrollTop = Math.min(1100, element.scrollHeight - element.clientHeight);
      });
      await expect.poll(async () => (await page.locator(".quadruped-stage-card").boundingBox())?.y ?? -1)
        .toBeCloseTo(firstStickyTop, 0);
      expect(firstStickyTop).toBeGreaterThanOrEqual(0);
      expect(firstStickyTop).toBeLessThan(viewport.height);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      await page.locator("#playButton").click();
      await page.locator("#sequenceGrid").scrollIntoViewIfNeeded();
      const offscreenStep = await page.locator("#stageStep").textContent();
      await expect.poll(async () => page.locator("#stageStep").textContent(), { timeout: 5_000 }).not.toBe(offscreenStep);

      for (const selector of ["#audioButton", "#playButton", "#restartButton", "#tempo", "[data-pace-ratio='3']", "#suspensionBeats", "#terrain", "#groundProfile", "#resetButton"]) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
      }
      const audioBox = await page.locator("#audioButton").boundingBox();
      const playBox = await page.locator("#playButton").boundingBox();
      const cardBox = await page.locator(".quadruped-cabinet-frame").first().boundingBox();
      expect(audioBox?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(playBox?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(58);
    });
  }
});

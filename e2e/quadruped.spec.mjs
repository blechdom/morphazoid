import { test, expect } from "@playwright/test";

test.describe("Quadruped", () => {
  test("edits four feet and a tail while transport remains independent of Audio", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const response = await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBe(true);

    await expect(page.getByRole("heading", { name: /quadruped/i })).toBeVisible();
    await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "7");
    await expect(page.getByRole("gridcell")).toHaveCount(112);
    await expect(page.locator("[data-behavior-id]")).toHaveCount(5);
    await expect(page.locator(".quadruped-cabinet-frame")).toHaveCount(16);
    await expect(page.locator(".quadruped-cabinet-frame canvas")).toHaveCount(16);

    const play = page.locator("#playButton");
    const audio = page.locator("#audioButton");
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#transportHint")).toContainText("Audio is off — turn it on to hear playback");
    const firstStep = await page.locator("#stageStep").textContent();
    await page.waitForTimeout(500);
    expect(await page.locator("#stageStep").textContent()).not.toBe(firstStep);

    const firstFoot = page.getByRole("button", { name: /^Left front foot, step 1:/ });
    await expect(firstFoot).toHaveAttribute("data-level", "off");
    await expect(firstFoot).toHaveText("·");
    await firstFoot.click();
    await expect(firstFoot).toHaveAttribute("data-level", "soft");
    await expect(firstFoot).toHaveText("○");
    await firstFoot.click();
    await expect(firstFoot).toHaveAttribute("data-level", "strong");
    await expect(firstFoot).toHaveText("●");
    await expect(page.locator("#behaviorReadout")).toContainText("custom");

    await firstFoot.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: /^Left front foot, step 2:/ })).toBeFocused();
    await expect(page.locator("#sequenceGrid button[tabindex='0']")).toHaveCount(1);

    const authoredHindFoot = page.getByRole("button", { name: /^Right hind foot, step 1: strong/ });
    await authoredHindFoot.focus();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("button", { name: /^Right hind foot, step 1: off/ })).toHaveAttribute("data-level", "off");

    const ground = page.getByRole("button", { name: /^Ground material, step 1:/ });
    const groundBefore = await ground.textContent();
    await ground.click();
    expect(await ground.textContent()).not.toBe(groundBefore);

    await page.getByRole("button", { name: /^Unicorn/ }).click();
    await expect(page.locator("#animalReadout")).toHaveText("Unicorn");
    await expect(page.locator("[data-behavior-id]")).toHaveCount(8);
    await page.getByRole("button", { name: "Trot" }).click();
    await expect(page.locator("#behaviorReadout")).toHaveText("Trot");
    await expect(page.locator("#behaviorDescription")).toContainText("diagonal pairs");
    await expect(page.locator(".quadruped-cabinet-frame[data-air='true']").first()).toBeVisible();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: /^Elephant/ }).click();
    await expect(page.getByRole("button", { name: /^Right hind foot, step 1: off/ })).toHaveAttribute("data-level", "off");
    expect(pageErrors).toEqual([]);
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
    for (const animal of ["Elephant", "Unicorn", "Gazelle"]) {
      await page.getByRole("button", { name: new RegExp(`^${animal}`) }).click();
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
      expect(dimensions.gridScroll).toBeGreaterThan(dimensions.gridClient);

      for (const selector of ["#audioButton", "#playButton", "#restartButton", "#resetButton"]) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
      }
      const audioBox = await page.locator("#audioButton").boundingBox();
      const playBox = await page.locator("#playButton").boundingBox();
      const cardBox = await page.locator(".quadruped-cabinet-frame").first().boundingBox();
      expect(audioBox?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(playBox?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(92);
    });
  }
});

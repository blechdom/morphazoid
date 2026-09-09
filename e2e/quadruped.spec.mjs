import { test, expect } from "@playwright/test";

test.describe("Quadruped", () => {
  test("edits four touchdown lanes while transport remains independent of Audio", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const response = await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBe(true);

    await expect(page.getByRole("heading", { name: /quadruped/i })).toBeVisible();
    await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "5");
    await expect(page.getByRole("grid")).toHaveAttribute("aria-colcount", "17");
    await expect(page.getByRole("gridcell")).toHaveCount(64);
    await expect(page.getByRole("columnheader")).toHaveCount(16);
    await expect(page.locator("[data-animal-id]")).toHaveCount(12);
    await expect(page.locator("[data-behavior-id]")).toHaveCount(39);
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
    const pauseFrame = await page.locator("#stage").getAttribute("data-frame");
    await play.click();
    await page.waitForTimeout(350);
    expect(await page.locator("#stage").getAttribute("data-frame")).toBe(pauseFrame);
    await play.click();

    const firstFoot = page.getByRole("button", { name: /^Left front foot, frame 1: no new touchdown;/ });
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
    await expect(page.locator("[data-behavior-id]")).toHaveCount(39);
    await page.getByRole("button", { name: "Trot" }).click();
    await expect(page.locator("#behaviorReadout")).toHaveText("Trot");
    await expect(page.locator("#behaviorDescription")).toContainText("diagonal pairs");
    await expect(page.locator(".quadruped-cabinet-frame[data-air='true']").first()).toBeVisible();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: /^Elephant/ }).click();
    await expect(page.getByRole("button", { name: /^Right hind foot, frame 1: no new touchdown/ })).toHaveAttribute("data-level", "none");
    expect(pageErrors).toEqual([]);
  });

  test("foot propulsion is the only clock and an empty score coasts to a stall", async ({ page }) => {
    await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    const play = page.locator("#playButton");
    const canvas = page.locator("#stage");
    await play.click();
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity")), { timeout: 3_000 }).toBeGreaterThan(0.1);
    await expect.poll(async () => page.locator(".quadruped-cabinet-frame[data-playing='true']").count()).toBe(1);
    const liveFrame = Number(await canvas.getAttribute("data-frame"));
    await expect(page.locator(`.quadruped-cabinet-frame[data-step="${liveFrame}"]`)).toHaveAttribute("data-playing", "true");

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
    await page.locator('[data-behavior-id="forward-roll"]').click();
    await expect(tempo).toHaveValue("180");
    await expect(page.locator("#tempoOut")).toHaveText("180 BPM · global");
    await expect.poll(async () => Number(await canvas.getAttribute("data-motor-velocity"))).toBeCloseTo(48, 3);
  });

  test("every animal can borrow the full gait dictionary", async ({ page }) => {
    await page.goto("/quadruped.html", { waitUntil: "domcontentloaded" });
    for (const animalId of ["elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe", "lizard", "horse", "dog", "goat", "rabbit", "camel"]) {
      await page.locator(`[data-animal-id="${animalId}"]`).click();
      await expect(page.locator("[data-behavior-id]")).toHaveCount(39);
      const activeGaitIsVisible = await page.evaluate(() => {
        const list = document.querySelector("#behaviorButtons")?.getBoundingClientRect();
        const active = document.querySelector('#behaviorButtons [aria-pressed="true"]')?.getBoundingClientRect();
        return Boolean(list && active && active.top >= list.top - 1 && active.bottom <= list.bottom + 1);
      });
      expect(activeGaitIsVisible).toBe(true);
      await page.getByRole("button", { name: "Run ×3 · leap", exact: true }).click();
      await expect(page.locator("#behaviorReadout")).toContainText("Run ×3 · leap");
    }
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
    for (const animalId of ["elephant", "unicorn", "gazelle", "cat", "cheetah", "giraffe", "lizard", "horse", "dog", "goat", "rabbit", "camel"]) {
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
      expect(dimensions.gridScroll).toBeGreaterThan(dimensions.gridClient);

      await page.locator("#playButton").click();
      await page.locator("#sequenceGrid").scrollIntoViewIfNeeded();
      const offscreenStep = await page.locator("#stageStep").textContent();
      await expect.poll(async () => page.locator("#stageStep").textContent(), { timeout: 5_000 }).not.toBe(offscreenStep);

      for (const selector of ["#audioButton", "#playButton", "#restartButton", "#tempo", "#terrain", "#groundProfile", "#resetButton"]) {
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

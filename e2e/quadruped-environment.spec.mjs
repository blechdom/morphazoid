import { test, expect } from "@playwright/test";
import { quadrupedGroundHeightAtWorldX, quadrupedSupportSnapshot } from "../src/instruments/quadruped/quadruped.js";

// Observe the actual renderer boundary without adding test hooks to shipped code.
async function observeEnvironment(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/src/instruments/quadruped/quadruped-environment.js", async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "export function drawQuadrupedEnvironment(";
    expect(source).toContain(marker);
    await route.fulfill({ response, body: `${source.replace(marker, "function drawQuadrupedEnvironmentOriginal(")}
      export function drawQuadrupedEnvironment(context, options) {
        const result = drawQuadrupedEnvironmentOriginal(context, options);
        const transform = context.getTransform();
        const calls = globalThis.quadrupedEnvironmentCalls ??= [];
        calls.push({ worldX: options.worldX, width: options.width, skinId: options.skinId,
          propCount: result.propCount, collageReady: result.collageReady,
          groundLeft: options.groundAt(0), groundY: options.groundY, worldScale: options.worldScale,
          left: transform.e / transform.a });
        calls.splice(0, Math.max(0, calls.length - 6));
        return result;
      }
    ` });
  });
  await page.goto("/quadruped.html");
  await expect.poll(() => page.evaluate(() => globalThis.quadrupedEnvironmentCalls?.length ?? 0)).toBeGreaterThan(0);
  return errors;
}

const rendered = page => page.evaluate(() => globalThis.quadrupedEnvironmentCalls.at(-1));
const capture = page => page.evaluate(async () => (await import("./src/site/header-presets.js")).captureHeaderPresetState().snapshot);
const pixels = page => page.locator("#stage").evaluate(canvas => {
  const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 7) hash = Math.imul(hash ^ bytes[index], 16777619);
  return hash >>> 0;
});

async function expectFrozenCanvas(page) {
  const before = await pixels(page);
  await page.waitForTimeout(300);
  expect(await pixels(page)).toBe(before);
}

test("scenery freezes after multiple travelled cycles and resumes from its actual world position", async ({ page }) => {
  const errors = await observeEnvironment(page);
  await page.locator("#visualSkinSelect").selectOption("constellation");
  await page.locator("#groundProfile").selectOption("stairs-up");
  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-clock-position"))).toBeGreaterThan(32);
  const beforePause = await rendered(page);
  await page.locator("#playButton").click();
  const paused = await rendered(page);
  expect(paused.worldX).toBeGreaterThanOrEqual(beforePause.worldX);
  const score = await capture(page);
  const position = await page.locator("#stage").evaluate(canvas => JSON.parse(canvas.dataset.actorPositions)[0]);
  expect(paused.worldX).toBeCloseTo(position / 16 * score.actors[score.selectedActor].stride, 3);
  const profile = score.actors[score.selectedActor].groundProfileId;
  const leftHeight = quadrupedGroundHeightAtWorldX(profile, paused.worldX - paused.width / 2 / paused.worldScale);
  const actor = score.actors[score.selectedActor];
  const bodyHeight = quadrupedSupportSnapshot(actor, paused.worldX / actor.stride * 16).bodyGroundHeight;
  expect(paused.groundLeft).toBeCloseTo(paused.groundY - (leftHeight - bodyHeight) * paused.worldScale, 5);
  await expectFrozenCanvas(page);
  expect((await rendered(page)).worldX).toBe(paused.worldX);

  // Previewing another score card must not rewind the travelling scenery.
  await page.locator("#stage").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(50);
  expect((await rendered(page)).worldX).toBe(paused.worldX);
  await page.locator("#playButton").click();
  await expect.poll(async () => (await rendered(page)).worldX).toBeGreaterThan(paused.worldX + 0.01);
  expect((await rendered(page)).worldX).toBeLessThan(paused.worldX + score.actors[score.selectedActor].stride);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("every skin paints all herd and trio lanes while preserving sound and score at desktop and phone widths", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await observeEnvironment(page);
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport);
    for (const mode of ["herd", "trio"]) {
      await page.locator(`[data-group-mode="${mode}"]`).click();
      for (const skin of ["animal", "skeleton", "constellation", "collage", "motion-card"]) {
        const before = await capture(page);
        await page.locator("#visualSkinSelect").selectOption(skin);
        await expect.poll(async () => page.evaluate(skin => {
          const calls = globalThis.quadrupedEnvironmentCalls.slice(-3);
          return calls.length === 3 && calls.every(call => call.skinId === skin && (skin !== "collage" || call.collageReady));
        }, skin)).toBe(true);
        const calls = await page.evaluate(() => globalThis.quadrupedEnvironmentCalls.slice(-3));
        const stageWidth = await page.locator("#stage").evaluate(canvas => canvas.getBoundingClientRect().width);
        expect(calls.map(call => Math.round(call.left))).toEqual([0, Math.round(stageWidth / 3), Math.round(stageWidth * 2 / 3)]);
        for (const call of calls) {
          expect(call.width).toBeCloseTo(stageWidth / 3, 1);
          expect(Number.isFinite(call.worldX)).toBe(true);
          expect(Number.isInteger(call.propCount)).toBe(true);
          expect(call.propCount).toBeGreaterThanOrEqual(0);
          expect(call.propCount).toBeLessThanOrEqual(2);
        }
        expect(await capture(page)).toEqual({ ...before, visualSkinId: skin });
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      }
    }
  }
  expect(errors).toEqual([]);
});

test("decorative scenery stops when an empty score stalls even with Play enabled", async ({ page }) => {
  test.setTimeout(30_000);
  const errors = await observeEnvironment(page);
  await page.locator("#playButton").click();
  await page.locator("#clearButton").click();
  await expect(page.locator("#playState")).toContainText("stalled", { timeout: 15_000 });
  for (const skin of ["constellation", "collage"]) {
    await page.locator("#visualSkinSelect").selectOption(skin);
    if (skin === "collage") await expect.poll(async () => (await rendered(page)).collageReady).toBe(true);
    // Let the articulated body finish loading its additional eye texture.
    await page.waitForTimeout(500);
    await expectFrozenCanvas(page);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#stage")).toHaveAttribute("data-motor-velocity", "0.0000");
  }
  expect(errors).toEqual([]);
});

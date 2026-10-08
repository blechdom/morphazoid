import { test, expect } from "@playwright/test";

const handle = (page, actor = 0) => page.locator(`.quadruped-animal-handle[data-gesture-actor="${actor}"]`);
const capture = page => page.evaluate(async () => (await import("./src/site/header-presets.js")).captureHeaderPresetState().snapshot);
const worldX = (page, actor = 0) => handle(page, actor).evaluate(node => Number(node.dataset.worldX));
const position = (page, actor = 0) => handle(page, actor).evaluate(node => Number(node.dataset.position));
const audioStatus = page => page.evaluate(async () => (await import("./src/audio-output-manager.js")).getSharedAudioOutputManager().getStatus());

async function openInstrument(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/quadruped.html");
  await expect(handle(page)).toBeVisible();
  await expect(handle(page)).toHaveAttribute("data-action", "idle");
  return errors;
}

async function point(page, part = "body", actor = 0) {
  return handle(page, actor).evaluate((node, part) => {
    const stage = document.querySelector("#stage").getBoundingClientRect();
    return { x: stage.x + Number(node.dataset[`${part}X`]), y: stage.y + Number(node.dataset[`${part}Y`]) };
  }, part);
}

async function beginDrag(page, part = "body", actor = 0) {
  const origin = await point(page, part, actor);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  return origin;
}

async function expectPausedAndDisarmed(page) {
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
}

test("paused body gestures perform temporary forward, backward, dance and jump without arming Audio", async ({ page }) => {
  const errors = await openInstrument(page);
  const before = await capture(page);
  let origin = await beginDrag(page);
  const forwardStart = await worldX(page);
  await page.mouse.move(origin.x + 100, origin.y, { steps: 8 });
  await expect(handle(page)).toHaveAttribute("data-action", "run");
  await expect.poll(() => worldX(page)).toBeGreaterThan(forwardStart);
  await expectPausedAndDisarmed(page);
  await page.mouse.up();
  await expect(handle(page)).toHaveAttribute("data-action", "idle");

  origin = await beginDrag(page);
  const backwardStart = await worldX(page);
  const scorePosition = await position(page);
  await page.mouse.move(origin.x - 100, origin.y, { steps: 8 });
  await expect(handle(page)).toHaveAttribute("data-action", "backward");
  await expect.poll(() => worldX(page)).toBeLessThan(backwardStart);
  expect(await position(page)).toBeGreaterThanOrEqual(scorePosition);
  await page.mouse.up();
  await expect(handle(page)).toHaveAttribute("data-action", "idle");

  origin = await beginDrag(page);
  for (const dx of [60, -30, 65]) await page.mouse.move(origin.x + dx, origin.y, { steps: 4 });
  await expect(handle(page)).toHaveAttribute("data-action", "dance");
  await page.mouse.up();
  await expect(handle(page)).toHaveAttribute("data-action", "idle");

  origin = await beginDrag(page);
  await page.mouse.move(origin.x + 3, origin.y - 90, { steps: 8 });
  await page.mouse.up();
  await expect(handle(page)).toHaveAttribute("data-action", "jump");
  await expect(handle(page)).toHaveAttribute("data-action", "idle", { timeout: 5_000 });
  expect(await capture(page)).toEqual(before);
  await expectPausedAndDisarmed(page);
  expect((await audioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

test("head calls sound while the score is paused only after explicit Audio arming", async ({ page }) => {
  const errors = await openInstrument(page);
  const before = await capture(page);
  let head = await point(page, "head");
  await page.mouse.click(head.x, head.y);
  await expectPausedAndDisarmed(page);
  expect((await audioStatus(page)).connectionCount).toBe(0);
  await expect(handle(page)).toHaveAttribute("data-action", "idle", { timeout: 5_000 });
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await audioStatus(page)).connectionCount).toBe(1);
  head = await point(page, "head");
  await page.mouse.click(head.x, head.y);
  await expect.poll(async () => (await audioStatus(page)).rms).toBeGreaterThan(0.0001);
  const signal = await audioStatus(page);
  expect(signal.peak).toBeLessThan(0.90);
  expect(signal.clipped).toBe(false);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await audioStatus(page)).peak, { timeout: 5_000 }).toBeLessThan(0.00001);
  expect(await capture(page)).toEqual(before);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await audioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

test("pointer cancellation releases gestures and keyboard performance preserves score-edit keys", async ({ page }) => {
  const errors = await openInstrument(page);
  await handle(page).evaluate(node => node.addEventListener("pointerdown", event => { globalThis.quadrupedGesturePointerId = event.pointerId; }, { once: true }));
  const origin = await beginDrag(page);
  await page.mouse.move(origin.x + 70, origin.y, { steps: 5 });
  await expect(handle(page)).toHaveAttribute("data-action", "run");
  await handle(page).dispatchEvent("pointercancel", { pointerId: await page.evaluate(() => globalThis.quadrupedGesturePointerId), pointerType: "mouse", isPrimary: true });
  await page.mouse.up();
  await expect(handle(page)).toHaveAttribute("data-action", "idle");
  const base = await capture(page);
  await page.locator("#stage").focus();
  for (const [key, action] of [["r", "run"], ["b", "backward"], ["d", "dance"]]) {
    await page.keyboard.down(key);
    await expect(handle(page)).toHaveAttribute("data-action", action);
    await page.keyboard.up(key);
    await expect(handle(page)).toHaveAttribute("data-action", "idle");
  }
  await page.keyboard.press("j");
  await expect(handle(page)).toHaveAttribute("data-action", "jump");
  await expect(handle(page)).toHaveAttribute("data-action", "idle", { timeout: 5_000 });
  await page.keyboard.press("c");
  await expectPausedAndDisarmed(page);
  await expect(handle(page)).toHaveAttribute("data-action", "idle", { timeout: 5_000 });
  expect(await capture(page)).toEqual(base);

  const selectedBefore = await page.locator("#stageStep").textContent();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#stageStep")).not.toHaveText(selectedBefore);
  await page.keyboard.press("1");
  const edited = await capture(page);
  const beforePattern = base.actors[base.selectedActor].pattern;
  const afterPattern = edited.actors[edited.selectedActor].pattern;
  expect(afterPattern["front-left"].filter((value, i) => value !== beforePattern["front-left"][i])).toHaveLength(1);
  for (const lane of ["front-right", "rear-left", "rear-right"]) expect(afterPattern[lane]).toEqual(beforePattern[lane]);
  expect(edited.actors[edited.selectedActor].callPattern).toEqual(base.actors[base.selectedActor].callPattern);
  await page.locator("#tempo").focus();
  await page.keyboard.press("r");
  await expect(handle(page)).toHaveAttribute("data-action", "idle");
  expect(errors).toEqual([]);
});

test("a gesture in one Trio lane leaves the other paused performers and their scores unchanged", async ({ page }) => {
  const errors = await openInstrument(page);
  await page.locator('[data-group-mode="trio"]').click();
  await expect(page.locator(".quadruped-animal-handle")).toHaveCount(3);
  const base = await capture(page);
  const before = await Promise.all([0, 1, 2].map(actor => worldX(page, actor)));
  const origin = await beginDrag(page, "body", 1);
  await page.mouse.move(origin.x - 65, origin.y, { steps: 6 });
  await expect(handle(page, 1)).toHaveAttribute("data-action", "backward");
  await expect.poll(() => worldX(page, 1)).toBeLessThan(before[1]);
  for (const actor of [0, 2]) {
    expect(await worldX(page, actor)).toBe(before[actor]);
    await expect(handle(page, actor)).toHaveAttribute("data-action", "idle");
  }
  await page.mouse.up();
  await expect(handle(page, 1)).toHaveAttribute("data-action", "idle");
  expect(await capture(page)).toEqual(base);
  await expectPausedAndDisarmed(page);
  expect(errors).toEqual([]);
});

test("phone blank-stage swipes scroll while tiny animal gestures stay captured", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    const errors = await openInstrument(page);
    const client = await context.newCDPSession(page);
    const touch = (type, p) => client.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ id: 1, x: p.x, y: p.y }] : [] });
    const shell = page.locator(".quadruped-shell");
    let stage = await page.locator("#stage").boundingBox();
    const blank = { x: stage.x + 12, y: stage.y + stage.height * 0.56 };
    expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, blank)).toBe("stage");
    await touch("touchStart", blank);
    for (let i = 1; i <= 8; i++) {
      await touch("touchMove", { x: blank.x, y: blank.y - i * 12 });
      await page.waitForTimeout(20);
    }
    await touch("touchEnd");
    await expect.poll(() => shell.evaluate(node => node.scrollTop)).toBeGreaterThan(20);

    await page.locator("#animalSelect").selectOption("mouse");
    await shell.evaluate(node => { node.scrollTop = 0; });
    const baselineScroll = await shell.evaluate(node => node.scrollTop);
    const before = await capture(page);
    let body = await point(page, "body");
    await touch("touchStart", body);
    for (let i = 1; i <= 6; i++) await touch("touchMove", { x: body.x + i * 8, y: body.y });
    await expect(handle(page)).toHaveAttribute("data-action", "run");
    expect(await shell.evaluate(node => node.scrollTop)).toBe(baselineScroll);
    await touch("touchEnd");
    await expect(handle(page)).toHaveAttribute("data-action", "idle");

    body = await point(page, "body");
    await touch("touchStart", body);
    for (let i = 1; i <= 6; i++) await touch("touchMove", { x: body.x, y: body.y - i * 10 });
    await touch("touchEnd");
    await expect(handle(page)).toHaveAttribute("data-action", "jump");
    expect(await shell.evaluate(node => node.scrollTop)).toBe(baselineScroll);
    await expect(handle(page)).toHaveAttribute("data-action", "idle", { timeout: 5_000 });
    expect(await capture(page)).toEqual(before);
    await expectPausedAndDisarmed(page);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

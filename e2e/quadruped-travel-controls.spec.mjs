import { test, expect } from "@playwright/test";

async function positions(page) {
  return page.locator("[data-gesture-actor]:visible").evaluateAll(elements => elements.map(element => ({
    actor: Number(element.dataset.gestureActor),
    position: Number(element.dataset.position),
    worldX: Number(element.dataset.worldX),
    action: element.dataset.action,
  })));
}

async function backUp(page, actor = 0) {
  const handle = page.locator(`[data-gesture-actor="${actor}"]`);
  const before = (await positions(page)).find(value => value.actor === actor);
  await handle.focus();
  await page.keyboard.down("b");
  await expect.poll(async () => (await positions(page)).find(value => value.actor === actor).position)
    .toBeGreaterThan(before.position + 4);
  await page.keyboard.up("b");
  await expect(handle).toHaveAttribute("data-action", "idle");
}

async function setStride(page, value) {
  await page.locator("#stride").evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function checkTravelRate(page, stride) {
  await page.locator("#playButton").click();
  const before = await positions(page);
  await expect.poll(async () => (await positions(page))[0].position).toBeGreaterThan(before[0].position + 4);
  const after = await positions(page);
  after.forEach((value, index) => {
    expect((value.worldX - before[index].worldX) / (value.position - before[index].position)).toBeCloseTo(stride / 16, 8);
  });
  await page.locator("#playButton").click();
}

test("stride edits after backing up preserve position and change subsequent physical travel", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/quadruped.html");
  await backUp(page);
  const before = await positions(page);
  await setStride(page, 1.35);
  const changed = await positions(page);
  expect(changed[0].worldX).toBeCloseTo(before[0].worldX, 10);
  expect(changed[0].position).toBe(before[0].position);
  await checkTravelRate(page, 1.35);
  expect(errors).toEqual([]);
});

test("ensemble stride edits and phase scattering preserve each actor's travelled course", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/quadruped.html");
  await page.locator('[data-group-mode="trio"]').click();
  for (let actor = 0; actor < 3; actor += 1) await backUp(page, actor);
  const before = await positions(page);
  await setStride(page, 0.55);
  (await positions(page)).forEach((value, index) => expect(value.worldX).toBeCloseTo(before[index].worldX, 10));
  await checkTravelRate(page, 0.55);
  const beforeScatter = await positions(page);
  await page.locator("#scatterButton").click();
  await expect.poll(async () => (await positions(page)).some((value, index) => Math.abs(value.position - beforeScatter[index].position) > 0.01)).toBe(true);
  (await positions(page)).forEach((value, index) => expect(value.worldX).toBeCloseTo(beforeScatter[index].worldX, 10));
  expect(errors).toEqual([]);
});

test("changing the ground after a gesture relatches current feet to the new treads", async ({ page }) => {
  // Canvas has no DOM nodes for individual feet. Expose a read-only sample of
  // the exact effective score/pose used by drawScene, only in this test response.
  await page.route("**/src/instruments/quadruped/quadruped-app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      globalThis.__quadrupedTravelProbe = () => activeActorIndices().map(index => {
        const score = scoreForActor(index);
        const position = actors[index].motor.position;
        const pose = deriveQuadrupedPose(score, position);
        return { worldX: quadrupedWorldAtPosition(score, position),
          feet: Object.values(pose.legs).filter(foot => foot.grounded).map(foot => ({
            worldY: foot.footWorldY,
            groundY: quadrupedGroundHeightAtWorldX(score.groundProfileId, foot.footWorldX),
          })) };
      });
    ` });
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/quadruped.html");
  await page.locator('[data-group-mode="trio"]').click();
  for (let actor = 0; actor < 3; actor += 1) await backUp(page, actor);
  const before = await page.evaluate(() => globalThis.__quadrupedTravelProbe());
  for (const profile of ["stairs-up", "stairs-down", "level"]) {
    await page.locator("#groundProfile").selectOption(profile);
    const after = await page.evaluate(() => globalThis.__quadrupedTravelProbe());
    after.forEach((value, index) => {
      expect(value.worldX).toBeCloseTo(before[index].worldX, 10);
      value.feet.forEach(foot => expect(foot.worldY).toBeCloseTo(foot.groundY, 10));
    });
    expect(after.flatMap(value => value.feet).length).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});

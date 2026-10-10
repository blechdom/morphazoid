import { test, expect } from "@playwright/test";
import { QUADRUPED_FULL_PRESETS } from "../src/instruments/quadruped/quadruped-presets.js";

const capture = page => page.evaluate(async () => {
  const { captureHeaderPresetState } = await import("./src/site/header-presets.js");
  return captureHeaderPresetState();
});

test("Quadruped full recall and dice start Play while retaining Audio and level", async ({ page }) => {
  // The full bank plus twenty live randomizations can exceed a minute while
  // the repository's audio checks run concurrently on a shared machine.
  test.setTimeout(120_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/quadruped.html");
  const row = page.locator(".header-preset-controls");
  await expect(row).toHaveAttribute("data-preset-id", "unselected");
  expect(await row.evaluate(node => node === node.parentElement.firstElementChild)).toBe(true);
  await page.locator("#level").fill("0");
  for (const preset of QUADRUPED_FULL_PRESETS) {
    await row.locator("summary").click();
    await page.locator(`button[data-preset-id="${preset.id}"]`).click();
    await expect(row).toHaveAttribute("data-preset-id", preset.id);
    expect((await capture(page)).snapshot).toEqual(preset.snapshot);
    await expect(page.locator("#visualSkinSelect")).toHaveValue("constellation");
    await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", "constellation");
    await expect(page.locator("#level")).toHaveValue("0");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#playButton").click();
  }
  await page.locator("#level").fill("0.31");
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-clock-position"))).toBeGreaterThan(16);
  for (let index = 0; index < 20; index += 1) {
    const before = await capture(page);
    await row.locator(".header-preset-random").click();
    await expect(row).toHaveAttribute("data-preset-id", "custom");
    const after = await capture(page);
    expect(after.snapshot).not.toEqual(before.snapshot);
    await expect(page.locator("#visualSkinSelect")).toHaveValue("constellation");
    await expect(page.locator("#level")).toHaveValue("0.31");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  }
  await page.locator("#playButton").click();
  await row.locator(".header-preset-next").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(row).toHaveAttribute("data-preset-id", QUADRUPED_FULL_PRESETS[0].id);
  await expect.poll(async () => page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
    const { rms, peak, clipped, connectionCount } = getSharedAudioOutputManager().getStatus();
    return rms > 0.001 && peak < 0.90 && !clipped && connectionCount === 1;
  })).toBe(true);
  await page.locator("#level").fill("0");
  await expect.poll(async () => page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("./src/audio-output-manager.js");
    return getSharedAudioOutputManager().getStatus().peak;
  })).toBeLessThan(0.00001);
  await page.locator("#audioButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("recalling a captured solo scene does not rewind a formerly grouped actor", async ({ page }) => {
  // Expose the actual adapter only in this test, to exercise rollback/recall of
  // an edited snapshot rather than substituting a factory scene.
  await page.route("**/src/instruments/quadruped/quadruped-app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.quadrupedRecallTest = { capturePreset, applyPreset };` });
  });
  await page.goto("/quadruped.html");
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator('[data-actor-index="2"]').click();
  await page.locator('[data-group-mode="solo"]').click();
  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-clock-position"))).toBeGreaterThan(40);
  await page.locator("#playButton").click();
  const before = Number(await page.locator("#stage").getAttribute("data-clock-position"));
  await page.evaluate(() => {
    const { capturePreset, applyPreset } = globalThis.quadrupedRecallTest;
    applyPreset(capturePreset());
  });
  await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-clock-position"))).toBeCloseTo(before, 3);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
});

test("animal appearance stays independent of named presets, Next, dice and legacy recall", async ({ page }) => {
  await page.route("**/src/instruments/quadruped/quadruped-app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nglobalThis.quadrupedRecallTest = { applyPreset };` });
  });
  await page.goto("/quadruped.html");
  const row = page.locator(".header-preset-controls");
  const skin = page.locator("#visualSkinSelect");
  await page.locator("#level").fill("0.27");
  await page.locator("#audioButton").click();
  for (const appearance of ["skeleton", "collage", "motion-card", "animal", "constellation"]) {
    await row.locator("summary").click();
    await page.locator('button[data-preset-id="earth-procession"]').click();
    const before = await capture(page);
    await skin.selectOption(appearance);
    expect(await capture(page)).toEqual(before);
    await expect(row).toHaveAttribute("data-preset-id", "earth-procession");
    for (const action of [".header-preset-next", ".header-preset-random"]) {
      await row.locator(action).click();
      await expect(skin).toHaveValue(appearance);
      await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", appearance);
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#level")).toHaveValue("0.27");
    }
    const music = QUADRUPED_FULL_PRESETS.find(preset => preset.id === "crooked-parade").snapshot;
    await page.evaluate(snapshot => globalThis.quadrupedRecallTest.applyPreset({
      ...snapshot, version: 2, visualSkinId: "skeleton",
    }), music);
    expect((await capture(page)).snapshot).toEqual(music);
    await expect(skin).toHaveValue(appearance);
    await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", appearance);
  }
});

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["portrait", { width: 390, height: 844 }],
  ["landscape", { width: 844, height: 390 }],
]) {
  test.describe(`independent skin menu on ${name}`, () => {
    test.use({ viewport, hasTouch: name !== "desktop" });
    test("sits directly below presets and remains reachable", async ({ page }) => {
      await page.goto("/quadruped.html");
      const skin = page.locator("#visualSkinSelect");
      await expect(skin).toHaveValue("constellation");
      expect(await page.locator(".quadruped-skin-card").evaluate(node =>
        node.previousElementSibling.matches(".header-preset-controls")
        && node.nextElementSibling.matches(".quadruped-transport-card"),
      )).toBe(true);
      await skin.scrollIntoViewIfNeeded();
      await skin.selectOption("skeleton");
      await page.locator('[data-next-select="visualSkinSelect"]').click();
      await expect(skin).toHaveValue("constellation");
      await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", "constellation");
      const bounds = await skin.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y).toBeGreaterThanOrEqual(name === "desktop" ? 0 : (await page.locator("#stage").boundingBox()).y + (await page.locator("#stage").boundingBox()).height);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      if (name !== "desktop") expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: test.info().outputPath(`skin-menu-${name}.png`) });
    });
  });
}

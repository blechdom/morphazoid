import { test, expect } from "@playwright/test";
import { readAudioStatus } from "./helpers/audio-probe.mjs";

for (const level of [0, .34]) test(`presets, Next and dice preserve live volume ${level}, Audio and Play`, async ({ page }) => {
  await page.route("**/src/instruments/l-systems/l-systems-app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      globalThis.__liveLevel = { state, get presets() { return presetController; },
        get ready() { return audioReady; }, get clock() { return discreteClock; } };
    ` });
  });
  await page.goto("l-systems.html");
  await page.waitForFunction(() => globalThis.__liveLevel);
  await page.locator("#level").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, level);

  for (const running of [false, true]) {
    if (running) {
      await page.locator("#audioButton").click();
      await page.waitForFunction(() => __liveLevel.ready);
      await page.locator("#playButton").click();
    }
    for (const action of ["continuous-1", "notes-2", "triggers-1", "next", "random"]) {
      if (action === "next" || action === "random") await page.locator(`.header-preset-${action}`).click();
      else await page.evaluate(id => __liveLevel.presets.view.select(id), action);
      if (running) await page.waitForFunction(() => __liveLevel.ready && __liveLevel.clock?.playingMode === __liveLevel.state.mode);
      expect(await page.evaluate(() => [__liveLevel.state.level, __liveLevel.state.audio, __liveLevel.state.playing]))
        .toEqual([level, running, running]);
      await expect(page.locator("#level")).toHaveValue(String(level));
    }
    if (!running) expect((await readAudioStatus(page)).connectionCount).toBe(0);
    else if (level === 0) {
      await page.waitForTimeout(250);
      expect((await readAudioStatus(page)).rms).toBeLessThan(.0001);
    }
  }
});

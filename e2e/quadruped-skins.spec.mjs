import { test, expect } from "@playwright/test";

test("independent skins preserve the score and the full tempo range stays live", async ({ page }) => {
  const errors = [];
  const imageRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.url().includes("/hiccup-head/skins/")) imageRequests.push(response);
  });
  await page.goto("/quadruped.html");
  await expect(page.locator("#padGrid")).toHaveCount(0);
  await expect(page.locator("#soundSkinSelect option")).toHaveCount(5);
  await expect(page.locator("#visualSkinSelect option")).toHaveCount(5);
  const capture = () => page.evaluate(async () => (await import("./src/site/header-presets.js")).captureHeaderPresetState().snapshot);
  const before = await capture();
  for (const [sound, visual] of [["ground", "animal"], ["tendon", "skeleton"], ["porcelain", "constellation"], ["voltage", "collage"], ["breath", "motion-card"]]) {
    await page.locator("#soundSkinSelect").selectOption(sound);
    await page.locator("#visualSkinSelect").selectOption(visual);
    await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", visual);
    const after = await capture();
    expect(after).toEqual({ ...before, soundSkinId: sound, visualSkinId: visual });
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  }
  await expect.poll(() => imageRequests.length).toBe(2);
  expect(imageRequests.every(response => response.ok())).toBe(true);
  await page.locator("#stage").focus();
  await page.keyboard.press("1");
  expect((await capture()).actors[0].pattern["front-left"][0]).toBeGreaterThan(0);
  await page.locator("#playButton").click();
  await page.locator('[data-pace-ratio="3"]').click();
  for (const tempo of [500, 25, 500]) {
    await page.locator("#tempo").fill(String(tempo));
    await expect.poll(async () => Number(await page.locator("#stage").getAttribute("data-motor-velocity"))).toBeCloseTo(tempo * 16 / 60 * 3, 3);
    await expect(page.locator("#tempoOut")).toHaveText(`${tempo} BPM · global`);
  }
  expect(errors).toEqual([]);
});

test("all sound skins stay bounded in a fast trio and release when paused", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/quadruped.html");
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator("#tempo").fill("500");
  await page.locator('[data-pace-ratio="3"]').click();
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  for (const skin of ["ground", "tendon", "porcelain", "voltage", "breath"]) {
    await page.locator("#soundSkinSelect").selectOption(skin);
    await expect.poll(() => page.evaluate(async () => {
      const { rms, peak, clipped, connectionCount } = (await import("./src/audio-output-manager.js")).getSharedAudioOutputManager().getStatus();
      return rms > 0.001 && peak < 0.90 && !clipped && connectionCount === 1;
    })).toBe(true);
  }
  await page.locator("#playButton").click();
  await expect.poll(() => page.evaluate(async () => (await import("./src/audio-output-manager.js")).getSharedAudioOutputManager().getStatus().peak)).toBeLessThan(0.00001);
  await page.locator("#audioButton").click();
  await expect.poll(() => page.evaluate(async () => (await import("./src/audio-output-manager.js")).getSharedAudioOutputManager().getStatus().connectionCount)).toBe(0);
});

test("fully painted 500 BPM trios retain future contacts within the voice budget", async ({ page }) => {
  await page.route("**/src/instruments/quadruped/quadruped-app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      let futureEvictions = 0;
      const originalEvict = evictAudioSource;
      evictAudioSource = predicate => {
        const record = [...activeSources].find(predicate);
        if (record && record.startTime > graph.context.currentTime) futureEvictions++;
        return originalEvict(predicate);
      };
      globalThis.quadrupedDensityTest = {
        fill(stride) {
          const snapshot = capturePreset();
          snapshot.actors.forEach((score, index) => {
            score.animalId = ["horse", "dog", "goat"][index];
            score.behaviorId = "walk"; score.suspensionBeats = 0;
            score.callPattern = emptyQuadrupedCalls();
            score.pattern = Object.fromEntries(QUADRUPED_LANES.map(({id}, lane) => [id, Array.from({length:16}, (_, step) => (step + lane) % stride === 0 ? 1 : 0)]));
          });
          applyPreset(snapshot);
        },
        stats: () => ({ futureEvictions, count: activeSources.size, batches: [...activeSources].filter(record => record.role === "body-contact-batch").length }),
      };` });
  });
  await page.goto("/quadruped.html");
  await page.locator('[data-group-mode="trio"]').click();
  await page.locator("#tempo").fill("500");
  await page.locator('[data-pace-ratio="3"]').click();
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  for (const stride of [8, 4, 1]) {
    await page.evaluate(stride => globalThis.quadrupedDensityTest.fill(stride), stride);
    const report = await page.evaluate(async () => {
      const manager = (await import("./src/audio-output-manager.js")).getSharedAudioOutputManager();
      const samples = [];
      for (let index = 0; index < 10; index++) {
        await new Promise(resolve => setTimeout(resolve, 60));
        samples.push({ ...globalThis.quadrupedDensityTest.stats(), ...manager.getStatus() });
      }
      return samples;
    });
    expect(report.every(row => row.count <= 48 && row.futureEvictions === 0 && !row.clipped && row.peak < 0.90)).toBe(true);
    expect(report.filter(row => row.rms > 0.001 && row.batches > 0).length).toBeGreaterThan(7);
  }
});

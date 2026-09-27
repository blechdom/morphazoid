import { expect, test } from "@playwright/test";
import { sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const voices = ["drums", "bass", "arp", "lead", "upperOne", "upperTwo", "noise"];
const skins = ["original", "cubist", "anime", "swirl"];
const layouts = [
  { name: "desktop", width: 1440, height: 900, coarse: false },
  { name: "phone portrait", width: 390, height: 844, coarse: true },
  { name: "phone landscape", width: 844, height: 390, coarse: true },
];

async function capture(page) {
  return page.evaluate(async () => (await import("./src/families/chiptune/chiptune-app.js")).captureChiptuneState());
}

function musicalState(snapshot) {
  const { characterSkin, voiceViews, ...musical } = snapshot;
  return musical;
}

async function open(page, baseURL) {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  expect((await page.goto("simd-chiptune.html"))?.ok()).toBe(true);
  await settlePage(page);
  await expect(page.locator("#characterSkin option")).toHaveCount(4);
  expect(await page.locator("#characterSkin option").evaluateAll(options => options.map(option => option.value))).toEqual(skins);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
  return diagnostics;
}

// Exercise the browser's native select menu, including its deferred Enter commit.
async function chooseNativeSkin(page, skin, { holdOpenMs = 0 } = {}) {
  await page.locator("#characterSkin").click();
  await page.keyboard.press("Home");
  for (let index = 0; index < skins.indexOf(skin); index += 1) await page.keyboard.press("ArrowDown");
  if (holdOpenMs) await page.waitForTimeout(holdOpenMs);
  await page.keyboard.press("Enter");
  await expect(page.locator("#characterSkin")).toHaveValue(skin);
  await expect.poll(async () => (await capture(page)).characterSkin).toBe(skin);
}

async function expectDanceViews(page) {
  await expect(page.locator('[data-character-voice][data-view="dance"]')).toHaveCount(7);
  await expect(page.locator(".simd-voice-controls:visible")).toHaveCount(0);
  expect((await capture(page)).voiceViews).toEqual(Object.fromEntries(voices.map(voice => [voice, "dance"])));
}

async function canvasPixels(page) {
  return page.evaluate(async () => {
    // Transport is paused in visual tests, so both frames use the same musical time.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.querySelector("#characterStage");
    return { width: canvas.width, height: canvas.height, pixels: canvas.toDataURL("image/png") };
  });
}

for (const layout of layouts) {
  test(`native Characters selection reveals distinct paused dancers at ${layout.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.coarse, isMobile: layout.coarse, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      const diagnostics = await open(page, baseURL);
      for (const voice of voices) await page.locator(`[data-voice-view="${voice}"]`).click();
      await expect(page.locator('[data-character-voice][data-view="controls"]')).toHaveCount(7);
      const initial = musicalState(await capture(page));
      // Choosing a different appearance must reveal it even when every dancer is covered.
      await chooseNativeSkin(page, "cubist");
      await expectDanceViews(page);
      const frames = [];
      for (const skin of skins) {
        await chooseNativeSkin(page, skin);
        await expectDanceViews(page);
        expect(musicalState(await capture(page))).toEqual(initial);
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
        const first = await canvasPixels(page);
        await page.waitForTimeout(80);
        expect(await canvasPixels(page), `${skin} must remain identical at paused musical time`).toEqual(first);
        frames.push(first);
      }
      expect(new Set(frames.map(frame => frame.pixels)).size, "all four appearances must differ without animation").toBe(4);
      expect(new Set(frames.map(frame => `${frame.width}x${frame.height}`)).size).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test("native Characters menu commits during Audio, Play and Follow without restarting the clock", async ({ page, baseURL }) => {
  const diagnostics = await open(page, baseURL);
  await page.evaluate(async () => {
    const { SimdChiptuneAudio } = await import("./src/instruments/simd-chiptune/audio.js");
    const start = SimdChiptuneAudio.prototype.start;
    globalThis.__skinAudioStarts = 0;
    SimdChiptuneAudio.prototype.start = function (...args) {
      globalThis.__skinAudioEngine = this;
      globalThis.__skinAudioStarts += 1;
      return start.apply(this, args);
    };
  });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await page.locator("#synthPlayButton").click();
  await waitForStableAudioState(page, true);
  if (await page.locator("#sequenceFollow").getAttribute("aria-pressed") !== "true") await page.locator("#sequenceFollow").click();
  const clock = () => page.evaluate(() => ({ starts: __skinAudioStarts, anchor: __skinAudioEngine.timelineStart,
    beat: __skinAudioEngine.currentPlaybackBeat(), running: __skinAudioEngine.running,
    contextState: __skinAudioEngine.context.state }));
  const before = await clock();
  const initial = musicalState(await capture(page));
  // Several Follow updates happen while the native menu owns an uncommitted selection.
  await chooseNativeSkin(page, "anime", { holdOpenMs: 1600 });
  await expectDanceViews(page);
  const after = await clock();
  expect(after.starts).toBe(before.starts);
  expect(after.anchor).toBe(before.anchor);
  expect(after.beat).toBeGreaterThan(before.beat);
  expect(after.running).toBe(true);
  expect(after.contextState).toBe("running");
  expect(musicalState(await capture(page))).toEqual(initial);
  await expect(page.locator("#sequenceFollow")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  const audio = await sampleAudioEnvelope(page, { durationMs: 300 });
  expect(audio.summary.finite).toBe(true);
  expect(audio.summary.maxRms).toBeGreaterThan(0.00001);
  expect(audio.summary.clippedSamples).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("WAX migrates legacy skins while preserving saved control views; explicit selection reveals dancers", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    globalThis.MorphazoidWAX = { register(adapter) { globalThis.__skinWaxAdapter = adapter; } };
  });
  const diagnostics = await open(page, baseURL);
  await page.waitForFunction(() => Boolean(globalThis.__skinWaxAdapter));
  const saved = () => page.evaluate(() => globalThis.__skinWaxAdapter.getState());
  const initial = await saved();
  const views = Object.fromEntries(voices.map((voice, index) => [voice, index % 2 ? "dance" : "controls"]));
  for (const [legacy, canonical] of [["animals", "anime"], ["blobs", "swirl"], ["arcade", "cubist"]]) {
    const snapshot = { ...initial, characterSkin: legacy, voiceViews: views };
    await page.evaluate(state => globalThis.__skinWaxAdapter.applyState(state), snapshot);
    expect(await saved()).toEqual({ ...snapshot, characterSkin: canonical });
    await expect(page.locator("#characterSkin")).toHaveValue(canonical);
    for (const voice of voices) await expect(page.locator(`[data-character-voice="${voice}"]`)).toHaveAttribute("data-view", views[voice]);
  }
  const beforeChoice = musicalState(await capture(page));
  await chooseNativeSkin(page, "swirl");
  await expectDanceViews(page);
  expect(musicalState(await capture(page))).toEqual(beforeChoice);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

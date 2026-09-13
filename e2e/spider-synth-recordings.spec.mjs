import { test, expect } from '@playwright/test';

test.setTimeout(90000);
const state = page => page.evaluate(() => window.spiderSynth.getState());

for (const mobile of [false, true]) test(`real spider samples load after Audio without blocking ${mobile ? 'phone' : 'desktop'} playback`, async ({ browser, baseURL }) => {
  const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), requests = [], errors = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/audio/spider-synth/*.wav*', async route => { requests.push(route.request().url()); await gate; await route.continue().catch(() => {}); });
  try {
    await page.goto(new URL('spider-synth.html', baseURL).href);
    await page.waitForFunction(() => Boolean(window.spiderSynth)); expect(requests).toHaveLength(0);
    await page.locator('#audioButton').click();
    await expect.poll(async () => (await state(page)).audio.enabled).toBe(true);
    expect((await state(page)).audio.samplesStatus).toBe('loading');
    release(); await expect.poll(async () => (await state(page)).audio.samplesStatus).toBe('ready');
    expect(new Set(requests).size).toBe(3);
    await page.locator('#motionButton').click(); await page.locator('#soundPreset').selectOption('peacock-percussion');
    await expect.poll(async () => (await state(page)).audio.recordingEvents).toBeGreaterThanOrEqual(3);
    const before = (await state(page)).audio;
    await page.evaluate(() => { const end = performance.now() + 650; while (performance.now() < end) Math.sin(performance.now()); });
    await expect.poll(async () => (await state(page)).audio.renderedFrames).toBeGreaterThan(before.renderedFrames + 10000);
    expect((await state(page)).playing).toBe(true);
    await page.locator('#motionButton').click();
    await expect.poll(async () => (await state(page)).audio.activeRecordings).toBe(0);
    const stopped = (await state(page)).audio.recordingEvents;
    await page.waitForTimeout(350); expect((await state(page)).audio.recordingEvents).toBe(stopped);
    expect(errors).toEqual([]);
  } finally { release(); await context.close(); }
});

test('unavailable animal recordings leave the procedural instrument playable', async ({ page }) => {
  await page.route('**/audio/spider-synth/*.wav*', route => route.abort());
  await page.goto('spider-synth.html'); await page.waitForFunction(() => Boolean(window.spiderSynth));
  await page.locator('#soundPlayButton').click(); await page.locator('#audioButton').click();
  await expect.poll(async () => (await state(page)).audio.samplesStatus).toBe('unavailable');
  await expect.poll(async () => (await state(page)).audio.peak).toBeGreaterThan(.001);
  expect((await state(page)).audio.enabled).toBe(true);
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await state(page)).audio.contactEvents).toBeGreaterThan(0);
});

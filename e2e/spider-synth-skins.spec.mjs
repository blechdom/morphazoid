import { test, expect } from '@playwright/test';

test.setTimeout(120000);
const state = page => page.evaluate(() => window.spiderSynth.getState());
const skins = ['argiope', 'golden', 'devil', 'tarantula', 'huntsman', 'fishing'];
async function ready(page, id) {
  await expect.poll(async () => { const s = await state(page); return !s.modelLoading && s.loaded && s.specimen; }, { timeout: 45000 }).toBe(id);
}
for (const mobile of [false, true]) test(`scanned skins load individually and preserve ${mobile ? 'phone' : 'desktop'} playback`, async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage(), requests = [], errors = [];
  page.on('request', request => { if (/spider-mobile\.glb/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  let release; const gate = new Promise(resolve => { release = resolve; });
  try {
    await page.goto('spider-synth.html'); await ready(page, 'argiope');
    expect(requests).toHaveLength(1);
    expect(await page.locator('#specimenPreset option').evaluateAll(items => items.map(item => item.value))).toEqual(skins);
    await page.locator('#posePreset').selectOption('peek');
    await page.locator('#audioButton').click(); await page.locator('#soundPlayButton').click(); await page.locator('#motionButton').click();
    await expect.poll(async () => (await state(page)).audio.contactEvents).toBeGreaterThan(2);
    const before = await state(page);
    await page.route('**/skins/golden/spider-mobile.glb*', async route => { await gate; await route.continue().catch(() => {}); });
    await page.locator('#specimenPreset').selectOption('golden');
    await expect(page.locator('#specimenPreset')).toHaveAttribute('aria-busy', 'true');
    expect((await state(page)).specimen).toBe('argiope');
    await expect.poll(async () => (await state(page)).audio.contactEvents).toBeGreaterThan(before.audio.contactEvents + 2);
    expect((await state(page)).playing).toBe(true);
    release();
    let lastTime = before.time;
    for (const id of skins.slice(1)) {
      if (id !== 'golden') await page.locator('#specimenPreset').selectOption(id);
      await ready(page, id);
      const after = await state(page);
      expect(after.bones).toHaveLength(38);
      expect(after.playing).toBe(true); expect(after.soundPlaying).toBe(true); expect(after.audioOn).toBe(true);
      expect(after.time).toBeGreaterThanOrEqual(lastTime); lastTime = after.time;
      expect(after.motionChoice).toBe(before.motionChoice); expect(after.posePreset).toBe('peek');
      expect(after.motionSettings.offsets).toEqual(before.motionSettings.offsets);
      expect(after.webSettings).toEqual(before.webSettings); expect(after.worldSettings).toEqual(before.worldSettings);
      expect(after.soundPreset).toBe(before.soundPreset); expect(after.sound).toEqual(before.sound); expect(after.bodyMix).toEqual(before.bodyMix);
      expect(after.frame.pose.every(Number.isFinite)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${id}.png`) });
    }
    expect(requests).toHaveLength(6);
    await page.locator('#motionButton').click(); await page.locator('#soundPlayButton').click();
    const paused = await state(page);
    await page.locator('#specimenPreset').selectOption('argiope'); await ready(page, 'argiope');
    const after = await state(page);
    expect(after.playing).toBe(false); expect(after.soundPlaying).toBe(false); expect(after.time).toBeCloseTo(paused.time, 5);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); await context.close(); }
});

test('failed and superseded skin loads retain a playable specimen and support retry', async ({ page }) => {
  await page.goto('spider-synth.html'); await ready(page, 'argiope');
  await page.locator('#motionButton').click();
  await page.route('**/skins/devil/rig-manifest.json*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"joints":[],"legs":[]}' }));
  await page.locator('#specimenPreset').selectOption('devil');
  await expect(page.locator('#retryModel')).toBeVisible();
  let s = await state(page); expect(s.specimen).toBe('argiope'); expect(s.loaded).toBe(true); expect(s.bones).toHaveLength(38); expect(s.playing).toBe(true);
  await page.unroute('**/skins/devil/rig-manifest.json*');
  await page.locator('#retryModel').click(); await ready(page, 'devil');
  await page.route('**/skins/golden/spider-mobile.glb*', route => route.abort());
  await page.evaluate(() => {
    const select = document.getElementById('specimenPreset');
    for (const id of ['golden', 'fishing']) { select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await ready(page, 'fishing'); s = await state(page);
  expect(s.playing).toBe(true); expect(s.bones).toHaveLength(38);
  await expect(page.locator('#retryModel')).toBeHidden(); await expect(page.locator('#modelStatus')).toBeHidden();
});

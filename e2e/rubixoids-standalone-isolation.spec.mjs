import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

for (const id of ['rubix', 'sliding-puzzle', 'hyper-rubix']) {
  test(`${id} retains native and Chiptune playback with Rubixoids unavailable`, async ({ page }, info) => {
    const errors = [];
    const blocked = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/\/src\/instruments\/rubixoids\//, route => {
      blocked.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    await page.goto(`/${id}.html`);
    const selector = id === 'hyper-rubix' ? '#voice' : '#soundBank';
    const voice = page.locator(selector);
    await voice.evaluate(element => {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      }
    });
    expect(await voice.inputValue(), 'the initial engine remains native').not.toMatch(/^shared-/);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#playButton').click();
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    const native = (await sampleAudioEnvelope(page, { durationMs: 1000 })).summary;
    expect(native.finite, `${id} native output`).toBe(true);
    expect(native.maxPeak, `${id} native output`).toBeGreaterThan(.001);

    await page.evaluate(() => {
      globalThis.__standaloneIsolationStops = 0;
      const play = document.getElementById('playButton');
      new MutationObserver(records => {
        if (play.getAttribute('aria-pressed') === 'false' || records.some(record => record.oldValue === 'false')) {
          globalThis.__standaloneIsolationStops += 1;
        }
      }).observe(play, { attributes: true, attributeFilter: ['aria-pressed'], attributeOldValue: true });
    });
    await voice.selectOption('shared-simd-chiptune');
    await page.waitForFunction(async ({ id, selector }) => {
      const module = await import(`/src/instruments/${id}/${id}-app.js`);
      const settings = module.rubixoidsNative.capture().settings;
      return (settings.soundBank ?? settings.voice) === 'shared-simd-chiptune'
        && !document.querySelector(selector).hasAttribute('aria-busy');
    }, { id, selector });
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    const chiptune = (await sampleAudioEnvelope(page, { durationMs: 1000 })).summary;
    expect(chiptune.finite, `${id} Chiptune output`).toBe(true);
    expect(chiptune.maxPeak, `${id} Chiptune output`).toBeGreaterThan(.001);
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => globalThis.__standaloneIsolationStops), 'engine changes preserve Play').toBe(0);
    await info.attach('standalone-isolation-audio.json', {
      body: JSON.stringify({ native, chiptune }, null, 2), contentType: 'application/json',
    });
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(blocked, 'standalone pages do not request Rubixoids modules or styles').toEqual([]);
    expect(errors).toEqual([]);
  });
}

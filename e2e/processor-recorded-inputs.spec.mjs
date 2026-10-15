import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const recordings = [
  ['music-vocal-scat', 'Madam Snowflake'],
  ['music-vocal-phrase', 'Rhiannon'],
  ['music-sax-multiphonic', 'jacksonsandre'],
  ['music-sax-fingerings', 'soulthom'],
  ['music-tabla', 'afleetingspeck'],
];

for (const route of ['candy-coil-delay', 'sandy-syrup-delay', 'slippery-resynthesis']) {
  test(`${route}: real vocal, sax and tabla inputs decode with credits and bounded audio`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.recordedInputMicRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => {
        window.recordedInputMicRequests++;
        throw Error('Samples must not request a microphone');
      };
    });
    await page.goto(`/${route}.html`);
    await expect(page.locator('#sampleSelect')).toHaveValue(recordings[0][0]);
    expect(await page.locator('#sampleSelect option').evaluateAll(options => options.slice(0, 5).map(option => option.value)))
      .toEqual(recordings.map(([id]) => id));
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.header-preset-next').click();
    await page.locator('#audioButton').click();
    await page.locator('#samplePlay').click();
    const evidence = [];
    for (const [id, creator] of recordings) {
      await page.locator('#sampleSelect').selectOption(id);
      await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#sampleCredit')).toContainText(creator);
      const creditUrl = await page.locator('#sampleCredit').getAttribute('href');
      expect((await page.request.get(creditUrl)).ok()).toBe(true);
      const envelope = await sampleAudioEnvelope(page, { durationMs: 800 });
      expect(envelope.summary.finite).toBe(true);
      expect(envelope.summary.maxRms).toBeGreaterThan(.001);
      expect(envelope.summary.clippedSamples).toBe(0);
      evidence.push({ id, creator, creditUrl, audio: envelope.summary });
    }
    await page.locator('#sampleStop').click();
    await expect(page.locator('#samplePlay')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.recordedInputMicRequests)).toBe(0);
    expect(errors).toEqual([]);
    await info.attach('recorded-inputs.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
  });
}

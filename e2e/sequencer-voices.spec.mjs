import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
const cases = [
  ['hocket-loom.html', '#soundEngine', ''], ['enveloper.html', '#sequenceVoice', ''],
  ['rubix.html', '#soundBank', 'shared-'], ['sliding-puzzle.html', '#soundBank', 'shared-'], ['hyper-rubix.html', '#voice', 'shared-'],
  ['algorithmic-sequencers.html', '#sequenceVoice', ''], ['dijkstra.html', '#sequenceVoice', ''], ['hanoi.html', '#sequenceVoice', ''],
  ['minimax.html', '#sequenceVoice', ''], ['nqueens.html', '#sequenceVoice', ''], ['euclid.html', '#sequenceVoice', ''],
];
for (const [route, selector, prefix] of cases) test(`${route} plays shared SIMD voices while retaining its original controls`, async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(`/${route}`);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator(selector).evaluate(el => { for (let p = el.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
  for (const id of ['simd-chiptune', 'simd-303', 'simd-synth']) await expect(page.locator(`${selector} option[value="${prefix}${id}"]`)).toHaveCount(1);
  await page.locator(selector).selectOption(`${prefix}simd-chiptune`);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  for (const id of ['simd-chiptune', 'simd-303', 'simd-synth']) {
    await page.locator(selector).selectOption(`${prefix}${id}`);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 1000 });
    expect(envelope.summary.finite).toBe(true); expect(envelope.summary.maxPeak, `${route} ${id}`).toBeGreaterThan(.001);
  }
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

import { test, expect } from '@playwright/test';

for (const angle of [0, 90]) test(`Text Apply keeps source pitch, resize and ${angle} degree rotation`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst originalVolume=MidiMixerEngine.prototype.setVolume;MidiMixerEngine.prototype.setVolume=function(...args){globalThis.__textSpigotEngine=this;return originalVolume.apply(this,args);};` });
  });
  await page.goto('/blech-midi.html'); await page.locator('#blechTab-text').click();
  await page.locator('#blechTextMessage').fill('HELLO');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  for (const [id, value] of [['blechDropWidth', 16], ['blechDropHeight', 4], ['blechDropPitch', 7], ['blechDropRotation', angle], ['blechDropDelay', 0]]) {
    await page.locator(`#${id}`).fill(String(value)); await page.locator(`#${id}`).press('Tab');
  }
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropSend').click();
  const layer = page.locator('.blech-live-layer'); await layer.locator('[data-layer-pause]').click();
  const capture = () => page.evaluate(() => { const sample = __textSpigotEngine.state.samples[0]; return { notes: sample.analysis.notes.map(({ note, beat, duration, channel }) => [note, beat, duration, channel]), duration: sample.analysis.durationBeats, paused: sample.paused }; });
  const before = await capture(); await layer.locator('[data-layer-edit]').click(); await page.locator('#blechTextApply').click();
  expect(await capture()).toEqual(before);
  // Live spigot edits must also update the authored Text Apply transform.
  await layer.locator('[data-layer-select]').click();
  for (const [field, value] of [['transpose', 12], ['widthNotes', 24], ['heightBeats', 6]]) {
    await page.locator(`[data-spigot-field="${field}"]`).fill(String(value)); await page.locator(`[data-spigot-field="${field}"]`).press('Tab');
  }
  await page.locator('#blechTextApply').click();
  const edited = await capture(); expect(edited.duration).toBe(6); expect(edited.notes).not.toEqual(before.notes); expect(edited.paused).toBe(true);
  await page.locator('#blechTextApply').click(); expect(await capture()).toEqual(edited);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect(errors).toEqual([]);
});

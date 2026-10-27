import { test, expect } from '@playwright/test';
import { installFakeMidi, enableFakeMidi, sendMidi } from './helpers/fake-midi.mjs';

const read = page => page.evaluate(() => ({
  state: __fractalSignals.state, playing: __fractalSignals.playing, armed: __fractalSignals.armed,
  phase: __fractalSignals.phase, level: __fractalSignals.audio.level, telemetry: __fractalSignals.telemetry,
}));

for (const mode of ['wander', 'grammar', 'grains', 'waveform', 'echoes', 'texture']) {
  test(`Fractal ${mode}: key-release pressure cannot zero master or interrupt the score`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await installFakeMidi(page, { inputs: [{ id: 'keys-a' }, { id: 'keys-b' }] });
    await page.goto(`/fractal-synthesis.html#${mode}`);
    await enableFakeMidi(page);
    if (await page.locator('.header-settings-menu').evaluate(menu => menu.open)) {
      await page.locator('.header-settings-trigger').click();
    }
    if (!(await read(page)).armed) await page.locator('#audioButton').click();
    await page.locator('#playButton').click();
    await expect.poll(async () => (await read(page)).telemetry?.activeEvents || 0).toBeGreaterThan(0);
    const level = await page.locator('#level').inputValue();
    await sendMidi(page, [0x90, 60, 90], { inputId: 'keys-a' });
    const before = await read(page);
    expect(before.state.base).toBeCloseTo(261.6256, 2);
    const node = await page.evaluateHandle(() => __fractalSignals.audio.node);
    for (const data of [
      [0xd0, 90], [0xa0, 60, 80], [0xb0, 11, 100],
      [0xd0, 0], [0xa0, 60, 0], [0xb0, 11, 0], [0x80, 60, 64],
      [0x91, 60, 110], [0xd1, 0], [0xa1, 60, 0], [0x91, 60, 0],
    ]) {
      await sendMidi(page, data, { inputId: data[0] % 16 ? 'keys-b' : 'keys-a' });
      await expect(page.locator('#level')).toHaveValue(level);
      const after = await read(page);
      expect(after.level).toBe(before.level);
      expect(after.playing).toBe(true); expect(after.armed).toBe(true);
      expect(after.state).toEqual(before.state);
    }
    expect(await page.evaluate(node => __fractalSignals.audio.node === node, node)).toBe(true);
    await expect.poll(async () => (await read(page)).phase).not.toBe(before.phase);
    await expect.poll(async () => (await read(page)).telemetry?.rms || 0).toBeGreaterThan(.0001);
    // MIDI Off must not leave a zero-pressure master behind either.
    await page.locator('.header-settings-trigger').click();
    await page.locator('#sharedMidiToggle').click();
    await expect(page.locator('#level')).toHaveValue(level);
    expect((await read(page)).playing).toBe(true);
    expect(errors).toEqual([]);
    await node.dispose();
  });
}

test('Fractal MIDI ownership preserves Audio-off, CC7, explicit macros and WAX behavior', async ({ page }) => {
  await page.goto('/fractal-synthesis.html');
  const result = await page.evaluate(async () => {
    const { applyBrowserMidiMessage } = await import('/src/browser-midi-adapter.js');
    const initial = document.querySelector('#level').value;
    const send = message => applyBrowserMidiMessage({ documentObject: document, runtime: window,
      routeId: 'fractal-signals', support: { noteMode: 'sequence', startsAudio: false }, message });
    for (const message of [{ type: 'noteOn', note: 69, velocity: 90 }, { type: 'noteOn', note: 69, velocity: 0 },
      { type: 'noteOff', note: 69, velocity: 0 }, { type: 'channelPressure', pressure: 0 },
      { type: 'polyPressure', note: 69, pressure: 0 }, { type: 'controlChange', controller: 11, value: 0 }]) send(message);
    const after = document.querySelector('#level').value;
    const unclaimed = detail => window.dispatchEvent(new CustomEvent('morphazoid:midi-input', { cancelable: true, detail }));
    const macro = unclaimed({ source: 'browser', routeId: 'fractal-signals', message: {
      type: 'controlChange', controller: 11, value: 0, logical: { type: 'macro', index: 0 } } });
    const otherRoute = unclaimed({ source: 'browser', routeId: 'puggler', message: { type: 'channelPressure', pressure: 0 } });
    const wax = unclaimed({ source: 'wax', routeId: 'fractal-signals', message: { type: 'channelPressure', pressure: 0 } });
    send({ type: 'controlChange', controller: 7, value: 32 });
    return { initial, after, cc7: document.querySelector('#level').value, macro, otherRoute, wax,
      armed: __fractalSignals.armed, playing: __fractalSignals.playing, base: __fractalSignals.state.base };
  });
  expect(result.after).toBe(result.initial);
  expect(result.cc7).not.toBe(result.initial);
  expect(result).toMatchObject({ macro: true, otherRoute: true, wax: true, armed: false, playing: false, base: 440 });
});

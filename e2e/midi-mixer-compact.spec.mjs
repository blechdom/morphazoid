import { expect, test } from '@playwright/test';
import { readAudioStatus } from './helpers/audio-probe.mjs';

function fixture(channels = 3) {
  const events = [];
  for (let channel = 0; channel < channels; channel++) {
    events.push([0, 192 | channel, 16], [0, 176 | channel, 91, 0], [0, 176 | channel, 93, 0]);
    for (const beat of [0, 8, 16, 24]) events.push([beat, 144 | channel, 48 + channel, 96], [beat + 7.75, 128 | channel, 48 + channel, 0]);
  }
  events.push([32, 255, 47, 0]); const track = []; let previous = 0;
  for (const [beat, ...message] of events.sort((a, b) => a[0] - b[0])) {
    const tick = beat * 480; let rest = tick - previous; const delta = [rest & 127];
    while ((rest = Math.floor(rest / 128))) delta.unshift((rest & 127) | 128);
    track.push(...delta, ...message); previous = tick;
  }
  const size = Buffer.alloc(4); size.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224]), Buffer.from('MTrk'), size, Buffer.from(track)]);
}

async function open(page, channels = 3) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__compactQA = { contexts: [], engine: null };
    const Native = AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); __compactQA.contexts.push(this); } };
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst qaVolume=MidiMixerEngine.prototype.setVolume;MidiMixerEngine.prototype.setVolume=function(...args){__compactQA.engine=this;return qaVolume.apply(this,args);};` });
  });
  await page.goto('/midiphoria.html'); await page.locator('#mixerModeButton').click(); await expect(page.locator('#tempoFromB')).toBeEnabled();
  for (const index of [0, 1]) {
    await page.locator(`#deckFile${index}`).setInputFiles({ name: `Compact ${index}.mid`, mimeType: 'audio/midi', buffer: fixture(channels) });
    await expect(page.locator(`#deckSong${index} option:checked`)).toHaveText(`Compact ${index}.mid`);
  }
  await expect(page.locator('.mixer-deck[data-deck="0"] .mixer-voice-row')).toHaveCount(channels);
  return errors;
}
const voice = (page, channel) => page.locator(`.mixer-deck[data-deck="0"] .mixer-voice-row[data-channel="${channel}"]`);
async function sounding(page) { await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001); }

test('volume-style knobs preserve native keyboard, pointer and precise lazy-editor input without arming Audio', async ({ page }) => {
  const errors = await open(page), tempo = page.locator('#masterTempo');
  await expect(tempo.locator('..')).toHaveClass(/mixer-range-knob/);
  await tempo.scrollIntoViewIfNeeded(); const box = await tempo.boundingBox(), before = Number(await tempo.inputValue());
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); expect(Number(await tempo.inputValue())).toBe(before);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12, { steps: 5 }); await page.mouse.up();
  const dragged = Number(await tempo.inputValue()); expect(dragged).toBeGreaterThan(before);
  await tempo.focus(); await page.keyboard.press('ArrowRight'); expect(Number(await tempo.inputValue())).toBeCloseTo(dragged + .1, 4);
  await expect(page.locator('#masterTempoOut')).toContainText(`${(dragged + .1).toFixed(1)} BPM`);
  const row = page.locator('#deckChannels0 .channel-row[data-channel="0"]');
  await row.locator('.channel-midi-editor > summary').click();
  const editor = row.locator('.midi-parameter-editor'); await editor.getByText('Mix', { exact: true }).click();
  const gain = editor.getByRole('slider', { name: 'Deck A channel 1: Voice gain', exact: true });
  await expect(gain.locator('..')).toHaveClass(/mixer-range-knob/);
  const exact = editor.getByRole('spinbutton', { name: 'Deck A channel 1: Voice gain, exact value', exact: true });
  await exact.fill('0.35'); await exact.press('Tab'); await expect(gain).toHaveValue('0.35');
  expect(await page.evaluate(() => __compactQA.engine.state.decks[0].channels[0].midi.gain)).toBeCloseTo(.35, 6);
  await gain.focus(); await gain.press('ArrowRight'); await expect(exact).toHaveValue('0.36');
  await editor.getByRole('button', { name: 'Deck A channel 1: Voice gain, follow deck / file', exact: true }).click();
  expect(await page.evaluate(() => __compactQA.engine.state.decks[0].channels[0].midi.gain)).toBeUndefined();
  await row.locator('.channel-midi-editor > summary').click(); await row.locator('.channel-midi-editor > summary').click();
  expect(await page.locator('.mixer-shell input[type="range"]').evaluateAll(inputs => inputs.every(input => input.parentElement.matches('.mixer-range-knob') && input.parentElement.querySelectorAll(':scope > .mz-range-knob__dial').length === 1))).toBe(true);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __compactQA.contexts.length)).toBe(0); expect(errors).toEqual([]);
});

test('inline map mute and solo alter native sound and retain map focus and transport', async ({ page }) => {
  test.setTimeout(60000); const errors = await open(page);
  await page.locator('#deckMute1').check(); await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await page.locator('#mixerPlay').click(); await sounding(page);
  const solo = voice(page, 1).getByRole('button', { name: 'Solo deck A channel 2', exact: true });
  await solo.focus(); await solo.press('Space'); await expect(solo).toHaveAttribute('aria-pressed', 'true');
  await expect(voice(page, 0)).toHaveClass(/is-muted/); await expect(voice(page, 2)).toHaveClass(/is-muted/);
  await expect(voice(page, 1)).not.toHaveClass(/is-muted/); await sounding(page); await expect(solo).toBeFocused();
  await voice(page, 1).getByRole('button', { name: 'Mute deck A channel 2', exact: true }).click();
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
  await voice(page, 1).getByRole('button', { name: 'Mute deck A channel 2', exact: true }).click(); await sounding(page);
  await solo.click();
  for (const channel of [0, 1, 2]) await voice(page, channel).getByRole('button', { name: `Mute deck A channel ${channel + 1}`, exact: true }).click();
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
  await page.locator('#deckAll0').click(); await sounding(page); await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#deckChannels0 [data-voice-action]').count()).toBe(0);
  await page.locator('#mixerStop').click(); expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`compact overview, knobs and aligned voice maps fit ${viewport.width}×${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000 });
    const page = await context.newPage();
    try {
      const errors = await open(page, 12); await page.evaluate(() => scrollTo(0, 0));
      const bounds = await page.evaluate(() => {
        const box = selector => { const b = document.querySelector(selector).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
        return { tabs: box('.midiphoria-stage-modes'), firstTab: box('#visualModeButton'), preset: box('#mixerPresetHost'), picture: box('#mixerPerformanceCanvas'), top: box('.mixer-main-row'), decks: box('#mixerDeckHost'), tempo: box('#masterTempo'), source: box('#tempoFromA') };
      });
      expect(bounds.picture.y).toBeGreaterThanOrEqual(bounds.preset.bottom);
      expect(bounds.picture.width).toBeLessThanOrEqual(360); expect(bounds.picture.height).toBeLessThanOrEqual(viewport.width === 390 ? 110 : 150);
      await expect(page.locator('#creativeControlsHost')).toBeHidden();
      expect(bounds.decks.y - bounds.top.bottom).toBeLessThan(30);
      expect(Math.abs(bounds.source.x - bounds.tempo.x)).toBeLessThan(180);
      // Preserve the existing content-height limit after accounting for the
      // actual extra row occupied by the fourth stage tab on narrow phones.
      const extraTabRows = Math.max(0, bounds.tabs.height - bounds.firstTab.height);
      expect(bounds.decks.y - extraTabRows).toBeLessThan(viewport.width === 390 ? 900 : 560);
      if (viewport.width === 1440) expect(bounds.source.height).toBeLessThan(40);
      for (const selector of ['#masterTempo', '#mixerCrossfade', '#tempoFromA', '#tempoFromB', '.mixer-deck[data-deck="0"] .mixer-voice-button']) {
        for (const node of await page.locator(selector).all()) {
          const b = await node.boundingBox(); expect(b.width).toBeGreaterThanOrEqual(viewport.width < 1000 ? 48 : 26); expect(b.height).toBeGreaterThanOrEqual(viewport.width < 1000 ? 48 : 26);
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`compact-${viewport.width}.png`) });
      const map = page.locator('.mixer-deck[data-deck="0"] .mixer-voice-map'); await map.scrollIntoViewIfNeeded();
      const alignment = () => map.evaluate(node => {
        const canvas = node.querySelector('canvas').getBoundingClientRect(), rows = [...node.querySelectorAll('.mixer-voice-row')];
        return rows.every((row, index) => { const b = row.getBoundingClientRect(); return Math.abs(b.y - canvas.y - index * b.height) < 1 && b.right <= canvas.x + 1; });
      });
      expect(await alignment()).toBe(true); await map.evaluate(node => { node.scrollTop = 180; }); expect(await alignment()).toBe(true);
      const last = voice(page, 11); await last.scrollIntoViewIfNeeded(); await expect(last.locator('.mixer-voice-count')).toHaveText('4 notes');
      await last.locator('[data-voice-action="mute"]').click(); await expect(last).toHaveClass(/is-muted/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await map.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`voices-${viewport.width}.png`) });
      expect(await page.evaluate(() => __compactQA.contexts.length)).toBe(0); expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

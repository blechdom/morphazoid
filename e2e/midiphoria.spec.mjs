import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFakeMidi, enableFakeMidi, sendMidi, fakeMidiSnapshot } from './helpers/fake-midi.mjs';

async function open(page, midi = true) {
  if (midi) await installFakeMidi(page);
  await page.goto('/midiphoria.html');
  await expect(page.locator('#notePads button')).toHaveCount(24);
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, next) => {
    node.value = String(next); node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function connect(page) {
  await enableFakeMidi(page);
  await page.locator('.header-settings-menu').evaluate(node => { node.open = false; });
}
async function pixel(page) {
  return page.locator('#visualCanvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(10, 10, 1, 1).data).slice(0, 3));
}

async function trailPixel(page) {
  return page.locator('#visualCanvas').evaluate(canvas => {
    const box = canvas.getBoundingClientRect(), ratio = canvas.width / box.width;
    const x = (16 + 60.5 / 128 * (box.width - 32)) * ratio;
    const y = (box.height - 36) * ratio;
    return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3);
  });
}

test('pads work before MIDI permission, and Reset in About preserves the connection', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(0);
  await range(page, 'trailSeconds', .3); await range(page, 'glow', 0); await range(page, 'motion', 0);
  const idle = await trailPixel(page);
  const pad = page.locator('[data-note="60"]');
  await pad.focus(); await page.keyboard.down('Enter');
  await expect(page.locator('#noteReadout')).toContainText('C4');
  await expect.poll(() => trailPixel(page)).not.toEqual(idle);
  await page.keyboard.up('Enter');
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
  await expect.poll(() => trailPixel(page)).toEqual(idle);
  await connect(page);
  await page.locator('#aboutSetup > summary').click();
  await page.locator('#resetButton').click();
  await expect(page.locator('#sharedMidiToggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#viewMode')).toHaveValue('trails');
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('real event path isolates channels, sustain, velocity-zero release and panic', async ({ page }) => {
  await open(page); await connect(page);
  await sendMidi(page, [0x90, 60, 100]);
  await sendMidi(page, [0x91, 60, 70]);
  await expect(page.locator('#noteReadout')).toContainText('2 held');
  await sendMidi(page, [0x80, 60, 0]);
  await expect(page.locator('#noteReadout')).toContainText('1 held');
  await sendMidi(page, [0xb1, 64, 127]);
  await sendMidi(page, [0x91, 60, 0]);
  await expect(page.locator('#noteReadout')).toContainText('1 held');
  await sendMidi(page, [0xb1, 64, 0]);
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
  await sendMidi(page, [0x93, 74, 127]);
  await sendMidi(page, [0xb3, 120, 0]);
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
});

test('learn maps CC and channel, and switching mapping releases previous input', async ({ page }) => {
  await open(page); await connect(page);
  await page.locator('#learnButton').click();
  await sendMidi(page, [0xb2, 21, 96]);
  await expect(page.locator('#mappedType')).toHaveValue('cc');
  await expect(page.locator('#mappedNumber')).toHaveValue('21');
  await expect(page.locator('#mappedChannel')).toHaveValue('2');
  await expect.poll(async () => parseInt(await page.locator('#levelReadout').textContent())).toBeGreaterThan(40);
  await sendMidi(page, [0xb0, 21, 0]);
  await expect.poll(async () => parseInt(await page.locator('#levelReadout').textContent())).toBeGreaterThan(40);
  await sendMidi(page, [0xb2, 21, 0]);
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
  await page.locator('#trigger').selectOption('all');
  await sendMidi(page, [0x90, 63, 127]);
  await expect(page.locator('#noteReadout')).toContainText('D♯4');
  await page.locator('#channel').selectOption('2');
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
});

test('two-row computer keys, octave shift, filtered channels and editable fields behave', async ({ page }) => {
  await open(page); await connect(page);
  await page.locator('#channel').selectOption('3');
  await page.locator('h1').click();
  await page.keyboard.down('z'); await page.keyboard.down('q');
  await expect(page.locator('#noteReadout')).toContainText('C3 · C4');
  await page.keyboard.up('z');
  await expect(page.locator('#noteReadout')).toContainText('C4 · 1 held');
  await page.keyboard.up('q');
  await page.keyboard.press(']'); await page.keyboard.down('q');
  await expect(page.locator('#noteReadout')).toContainText('C5');
  await page.keyboard.up('q');
  await page.locator('#trigger').selectOption('mapped');
  await page.locator('#mappedNumber').fill('72');
  await expect(page.locator('#mappedNumber')).toHaveValue('72');
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
});

test('disconnect and MIDI off clear all held channels without an audio context', async ({ page }) => {
  await page.addInitScript(() => {
    window.__midiphoriaAudioContexts = 0;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__midiphoriaAudioContexts++; } };
  });
  await open(page); await connect(page);
  await sendMidi(page, [0x97, 72, 100]);
  await expect(page.locator('#noteReadout')).toContainText('C5');
  await page.evaluate(() => window.__morphazoidFakeMidi.disconnectInput());
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
  await page.locator('h1').click(); await page.keyboard.down('q');
  await expect(page.locator('#noteReadout')).toContainText('C4');
  await page.locator('#midiSettingsButton').click();
  await page.locator('#sharedMidiToggle').click();
  await page.keyboard.up('q');
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
  expect(await page.evaluate(() => window.__midiphoriaAudioContexts)).toBe(0);
});

test('unsupported Web MIDI still supports pads, computer keys and recovery', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined }));
  await open(page, false);
  await page.locator('#midiSettingsButton').click(); await page.locator('#sharedMidiToggle').click();
  await page.locator('.header-settings-menu').evaluate(node => { node.open = false; });
  await page.locator('h1').click(); await page.keyboard.down('q');
  await expect(page.locator('#noteReadout')).toContainText('C4');
  await page.keyboard.up('q');
  await page.locator('[data-note="48"]').evaluate(node => node.click());
  await expect.poll(async () => parseInt(await page.locator('#levelReadout').textContent())).toBeGreaterThan(10);
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
});

for (const [name, width, height] of [['desktop', 1440, 900], ['portrait', 390, 844], ['landscape', 844, 390]]) {
  test(`${name} layout has reachable controls, usable pads, and accessible markup`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height }); await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#demoButton, #clearButton, .midiphoria-silent')).toHaveCount(0);
    await expect(page.locator('.midiphoria-player h2')).toHaveCount(0);
    const geometry = await page.evaluate(() => {
      const read = selector => {
        const node = document.querySelector(selector), bounds = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height,
          border: style.borderTopWidth, radius: style.borderRadius, background: style.backgroundColor };
      };
      return { play: read('#playButton'), speed: read('#playbackRate'), songs: read('#collectionSelect'),
        presets: ['.instrument-preset-controls', '.header-preset-picker > summary', '.header-preset-next', '.header-preset-random'].map(read) };
    });
    expect(geometry.play.width).toBe(geometry.play.height);
    expect(geometry.play.radius).toBe('50%');
    expect(geometry.play.bottom).toBeLessThan(geometry.songs.top);
    expect(geometry.speed.top).toBeLessThan(geometry.play.bottom + 4);
    expect(geometry.speed.bottom).toBeGreaterThan(geometry.play.top);
    for (const control of geometry.presets) { expect(control.border).toBe('0px'); expect(control.background).toBe('rgba(0, 0, 0, 0)'); }

    await page.mouse.move(width - 25, height - 60);
    await page.mouse.wheel(0, 550);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    for (const id of ['reflection', 'flow', 'lightEnvelopeEditor', 'padVelocity']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
    const pad = page.locator('[data-note="60"]');
    await pad.scrollIntoViewIfNeeded();
    const box = await pad.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(24); expect(box.height).toBeGreaterThanOrEqual(44);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await expect(page.locator('#noteReadout')).toContainText('C4');
    await page.mouse.up();
    await expect(page.locator('#levelReadout')).toHaveText('0% light');
    await pad.focus(); await page.keyboard.down('Enter');
    await page.locator('h1').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    await page.keyboard.up('Enter');
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(scan.violations.filter(item => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  });
}

test('pagehide releases devices and a restored page has one set of controls', async ({ page }) => {
  await open(page); await connect(page);
  await sendMidi(page, [0x96, 64, 110]);
  await expect(page.locator('#noteReadout')).toContainText('E4');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  expect((await fakeMidiSnapshot(page)).inputs[0].listenerCount).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#channel option')).toHaveCount(17);
  await expect(page.locator('#mappedChannel option')).toHaveCount(16);
  await expect(page.locator('#notePads button')).toHaveCount(24);
  await expect(page.locator('#levelReadout')).toHaveText('0% light');
  await connect(page); await sendMidi(page, [0x90, 60, 100]);
  await expect(page.locator('#noteReadout')).toContainText('C4 · 1 held');
});

test('activity hue changes the actual trail pixels and inversion changes the background', async ({ page }) => {
  await open(page); await connect(page);
  await page.locator('#colorSource').selectOption('pitch'); await page.locator('#hueMode').selectOption('activity');
  await range(page, 'hueSpeed', 1);
  await sendMidi(page, [0x90, 60, 127]);
  const first = await trailPixel(page);
  await sendMidi(page, [0x80, 60, 0]); await sendMidi(page, [0x90, 60, 127]);
  const second = await trailPixel(page);
  expect(second).not.toEqual(first);
  await range(page, 'glow', 0);
  await sendMidi(page, [0xb0, 120, 0]);
  await expect.poll(() => pixel(page)).toEqual([3, 7, 6]);
  await page.locator('#invert').check();
  await expect.poll(() => pixel(page)).toEqual([231, 239, 233]);
});

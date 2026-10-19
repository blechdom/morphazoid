import { expect, test } from '@playwright/test';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { settlePage } from './helpers/diagnostics.mjs';
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from './helpers/fake-midi.mjs';

// These are reference documents with independent headers, not shared consumers.
const independent = new Set(['chaotic-dsp-reference.html', 'webgpu-dsp-primitives.html', 'synthesaurus-reference.html']);
const mobileSizes = [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }];
const desktop = { width: 1440, height: 900 };
// Video capture stalls desktop Vector Flight's frame loop on this Chromium
// runner, including unchanged main. Keep layout assertions, screenshots and
// traces, without making the page's graphics compete with a video encoder.
test.use({ video: 'off' });
const geometry = header => {
  const selectors = ['.wordmark', '.tabs .instrument-picker-trigger', '.output-recording-control', '.header-output-meter-shell', '.header-level', '.audio-button', '.header-settings-trigger'];
  return selectors.flatMap(selector => {
    const node = header.querySelector(selector);
    if (!node?.checkVisibility()) return [];
    const rect = node.getBoundingClientRect();
    return [{ selector, x: rect.x, right: rect.right, width: rect.width, height: rect.height, center: rect.y + rect.height / 2 }];
  });
};
for (const route of CANONICAL_PAGE_ROUTES) test(`${route}: shared mobile menubar`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(mobileSizes[0]);
  await page.goto(route); await settlePage(page);
  if (independent.has(route)) {
    await expect(page.locator('.masthead.has-mobile-menubar')).toHaveCount(0);
    return;
  }
  const header = page.locator('.masthead.has-mobile-menubar');
  await expect(header).toBeVisible();
  // Direct mobile entry must not trap a late-mounted output strip in Settings.
  for (const selector of ['.audio-button', '.header-level']) {
    if (await header.locator(selector).count()) await expect(header.locator(selector)).toBeVisible();
  }
  await page.setViewportSize(desktop); await settlePage(page);
  await expect(header.locator('.mobile-menubar-brand')).toBeHidden();
  const before = await header.evaluate(geometry);
  for (const viewport of mobileSizes) {
    await page.setViewportSize(viewport);
    await expect(header.locator('.tabs .instrument-picker-next')).toBeHidden();
    await expect(header.locator('.wordmark .brand-mark')).toBeVisible();
    await expect(header.locator('.wordmark')).toHaveCSS('font-size', '0px');
    await expect(header.locator('.tabs .instrument-picker-current')).toBeHidden();
    const boxes = await header.evaluate(geometry);
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    for (const [i, box] of boxes.entries()) {
      expect(box.x, `${viewport.width} ${box.selector} left`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${viewport.width} ${box.selector} right`).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.width).toBeGreaterThan(0);
      expect(Math.abs(box.center - boxes[0].center), `${viewport.width} ${box.selector} one row`).toBeLessThanOrEqual(2);
      if (i) expect(box.x, `${viewport.width} ${box.selector} order/overlap`).toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
      if (box.selector === '.audio-button') { expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48); }
    }
    const audio = boxes.find(box => box.selector === '.audio-button');
    const settings = boxes.find(box => box.selector === '.header-settings-trigger');
    if (audio && settings) {
      expect(Math.abs(audio.center - settings.center), 'Audio and Settings share an exact horizontal centerline').toBeLessThan(.1);
      expect(audio.height).toBe(settings.height);
    }
    await header.locator('.tabs .instrument-picker-trigger').click();
    await expect(header.locator('.tabs .instrument-picker-search input')).toBeVisible();
    const panel = await header.locator('.tabs .instrument-picker-panel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize(desktop);
  await settlePage(page);
  await expect(header.locator('.tabs .instrument-picker-next')).toBeVisible();
  const after = await header.evaluate(geometry);
  expect(after).toEqual(before); // Reparenting must restore the authored desktop layout.
  expect(errors).toEqual([]);
});

test('mobile Choose searches, navigates, and returns focus; original level survives resize', async ({ page }) => {
  await page.setViewportSize(mobileSizes[0]); await page.goto('shapes.html'); await settlePage(page);
  const trigger = page.locator('.tabs .instrument-picker-trigger');
  await page.locator('.header-level input').evaluate(input => {
    window.__level = input; window.__levelEvents = 0;
    input.value = '0.42'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.addEventListener('input', () => __levelEvents++);
  });
  for (const size of [desktop, mobileSizes[1], mobileSizes[0]]) await page.setViewportSize(size);
  expect(await page.evaluate(() => __level === document.querySelector('.header-level input'))).toBe(true);
  await expect(page.locator('.header-level input')).toHaveValue('0.42');
  expect(await page.evaluate(() => __levelEvents)).toBe(0);
  await expect(page.locator('.audio-button')).toHaveAttribute('aria-pressed', 'false');
  await trigger.click();
  const search = page.locator('.tabs .instrument-picker-search input');
  await search.fill('no-such-instrument-987');
  await expect(page.locator('.tabs .instrument-picker-empty')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(search).toHaveValue('');
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await search.fill('Graph Synth');
  await page.locator('.tabs').getByRole('link', { name: 'Graph Synth', exact: true }).click();
  await expect(page).toHaveURL(/graph-synth\.html$/);
});

test('dynamic extra controls keep identity, focus, native events and teardown', async ({ page }) => {
  await page.goto('shapes.html'); await settlePage(page);
  await page.evaluate(async () => {
    const { initializeMobileMenubars } = await import('/src/site/mobile-menubar.js');
    window.__mobileController = initializeMobileMenubars();
    window.__sameController = __mobileController === initializeMobileMenubars();
    const input = document.createElement('input'); input.type = 'range'; input.value = '37'; input.id = 'mobile-extra-probe';
    input.setAttribute('aria-label', 'Extra test control');
    input.addEventListener('input', () => { window.__extraEvents = (window.__extraEvents ?? 0) + 1; });
    window.__extra = input;
    document.querySelector('.masthead').append(input);
    input.focus();
  });
  await page.setViewportSize(mobileSizes[0]);
  await expect(page.locator('.header-settings-panel #mobile-extra-probe')).toBeFocused();
  await page.locator('#mobile-extra-probe').press('ArrowRight');
  expect(await page.evaluate(() => __extraEvents)).toBe(1);
  await page.setViewportSize(desktop);
  await expect(page.locator('.masthead > #mobile-extra-probe')).toBeFocused();
  await expect(page.locator('#mobile-extra-probe')).toHaveValue('38');
  await page.setViewportSize(mobileSizes[1]);
  expect(await page.evaluate(() => __extra === document.querySelector('#mobile-extra-probe') && __sameController)).toBe(true);
  await page.evaluate(async () => {
    __mobileController.destroy(); __mobileController.destroy();
    const { initializeMobileMenubars } = await import('/src/site/mobile-menubar.js');
    initializeMobileMenubars();
  });
  await expect(page.locator('.header-settings-panel #mobile-extra-probe')).toHaveCount(1);
  await expect(page.locator('.mobile-menubar-extras')).toHaveCount(1);
  await page.locator('#mobile-extra-probe').evaluate(node => node.remove());
  await page.setViewportSize(desktop);
  await expect(page.locator('#mobile-extra-probe')).toHaveCount(0);
  await expect(page.locator('.audio-button')).toHaveAttribute('aria-pressed', 'false');
});

test('mobile Settings retains MIDI connection, CC volume and activity on rotation', async ({ page }) => {
  await installFakeMidi(page); await page.setViewportSize(mobileSizes[0]);
  await page.goto('graph-synth.html'); await settlePage(page); await enableFakeMidi(page);
  await sendMidi(page, MIDI_BYTES.controlChange(7, 127));
  await expect(page.locator('#output')).toHaveValue('0.9');
  await page.setViewportSize(mobileSizes[1]);
  await sendMidi(page, MIDI_BYTES.controlChange(7, 0));
  await expect(page.locator('#output')).toHaveValue('0');
  await expect(page.locator('.header-settings-panel .midi-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => __morphazoidFakeMidi.snapshot().requests.length)).toBe(1);
});


test('late output host replacement stays in the bar, not Settings', async ({ page }) => {
  await page.setViewportSize(mobileSizes[0]); await page.goto('shapes.html'); await settlePage(page);
  await page.evaluate(() => {
    const placeholder = document.createElement('div'); placeholder.id = 'late-output-host'; placeholder.className = 'audio-strip';
    document.querySelector('.masthead .header-io-controls').append(placeholder);
  });
  // Allow the structural observer to see the empty host before replacement.
  await expect(page.locator('.header-io-controls > #late-output-host')).toHaveCount(1);
  await page.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve));
    const replacement = document.createElement('div'); replacement.id = 'late-output-host'; replacement.className = 'audio-strip';
    const button = document.createElement('button'); button.className = 'audio-button'; button.textContent = 'Test Audio';
    replacement.append(button); document.querySelector('#late-output-host').replaceWith(replacement);
  });
  await expect(page.locator('#late-output-host .audio-button')).toBeVisible();
  await expect(page.locator('.header-settings-panel #late-output-host')).toHaveCount(0);
});


for (const hasTouch of [false, true]) test.describe(`Audio/Settings alignment, touch=${hasTouch}`, () => {
  test.use({ hasTouch });
  for (const route of ['shapes.html', 'graph-delay.html', 'l-mic-rust.html', 'synthesis.html']) {
    test(`${route}: button edges align with Settings closed and open`, async ({ page }) => {
      for (const viewport of mobileSizes) {
        await page.setViewportSize(viewport); await page.goto(route); await settlePage(page);
        const audio = page.locator('.masthead .audio-button');
        const settings = page.locator('.masthead .header-settings-trigger');
        for (const open of [false, true]) {
          if (open) await settings.click();
          const a = await audio.boundingBox(), s = await settings.boundingBox();
          expect(Math.abs(a.y - s.y)).toBeLessThan(.1);
          expect(Math.abs(a.y + a.height - s.y - s.height)).toBeLessThan(.1);
          expect(s.x).toBeGreaterThanOrEqual(a.x + a.width);
          await expect(audio).toHaveAttribute('aria-pressed', 'false');
          if (open) await page.keyboard.press('Escape');
        }
      }
    });
  }
});

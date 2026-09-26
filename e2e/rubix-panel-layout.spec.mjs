import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const targets = [
  { name: 'Rubix', route: '/rubix.html', kind: 'rubix' },
  { name: 'Hyper Rubix', route: '/hyper-rubix.html', kind: 'hyper' },
  { name: 'Rubixoids 3D', route: '/rubixoids.html?dimension=3d', kind: 'rubix', dim: '3d' },
  { name: 'Rubixoids 4D', route: '/rubixoids.html?dimension=4d', kind: 'hyper', dim: '4d' },
];
const root = (page, target) => target.dim ? page.locator(`.rubixoids-pane[data-dimension="${target.dim}"]`) : page.locator('body');
const setRange = async (scope, id, value) => scope.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
for (const target of targets) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${target.name} compact panel ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440 });
    test('presets, playback, twists and read path stay ordered and reachable', async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(target.route);
      const scope = root(page, target);
      const panel = scope.locator('.panel');
      await expect(panel.locator('.instrument-preset-controls')).toBeVisible();
      const order = await panel.evaluate(node => [...node.children].filter(child => child.getBoundingClientRect().height > 0).map(child => child.className));
      expect(order[0]).toContain('instrument-preset-controls');
      expect(order[1]).toContain('puzzle-performance');
      const ids = ['playButton', 'tempo', 'swing', target.kind === 'rubix' ? 'randomTwists' : 'twistPlayButton', target.kind === 'rubix' ? 'readPath' : 'sequenceMethod'];
      for (const id of ids) {
        await scope.locator(`#${id}`).scrollIntoViewIfNeeded();
        await expect(scope.locator(`#${id}`)).toBeInViewport();
      }
      const controls = scope.locator('.puzzle-performance');
      const geometry = await controls.evaluate(node => {
        const rect = selector => { const r = node.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom }; };
        return { play:rect('#playButton'), tempo:rect('#tempo'), swing:rect('#swing'), twists:rect('.puzzle-twist-row'), read:rect('#readPath, #sequenceMethod'), overflow:document.documentElement.scrollWidth > innerWidth + 1 };
      });
      expect(geometry.play.y).toBeLessThan(geometry.swing.y);
      expect(geometry.swing.y).toBeLessThan(geometry.twists.y);
      expect(geometry.overflow).toBe(false);
      if (viewport.width !== 1440) expect(geometry.play.width).toBeGreaterThanOrEqual(48);
      if (target.kind === 'rubix') {
        await expect(scope.locator('#stepStrip')).toBeHidden();
        expect(await scope.locator('#stepStrip').evaluate(node => node.children.length)).toBe(0);
        await expect(scope.locator('#laneList')).toBeHidden();
        await expect(scope.locator('#engineState')).toBeHidden();
        await expect(scope.locator('#sequenceState')).toBeHidden();
        await expect(panel).not.toContainText('Sticker colors choose kick');
        await expect(panel.locator('summary')).not.toContainText(['Clock', 'Visible score']);
        await expect(scope.locator('#readPath option')).toHaveText(['Rows', 'Snake', 'Face pairs']);
      }
      await expect(scope.locator('#playButton')).toHaveClass('play-button');
      await scope.locator('#tempo').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('compact-panel.png') });
      expect(errors).toEqual([]);
    });
  });
}
for (const target of targets) test(`${target.name} compact controls preserve sound, twist modes and shared tempo`, async ({ page }) => {
  await page.goto(target.route);
  const scope = root(page, target);
  const audio = target.dim ? page.locator('body > .masthead #audioButton') : scope.locator('#audioButton');
  await scope.locator(target.kind === 'rubix' ? '#soundBank' : '#voice').selectOption('shared-simd-chiptune');
  await scope.locator('#playButton').click();
  await expect(audio).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#transportAudioAttention')).toHaveCount(0);
  await expect(audio).toHaveAttribute('data-audio-attention', 'true');
  await audio.click();
  await expect(audio).toHaveAttribute('aria-pressed', 'true');
  if (await scope.locator('#playButton').getAttribute('aria-pressed') !== 'true') await scope.locator('#playButton').click();
  await setRange(scope, 'tempo', 153);
  await setRange(scope, 'swing', .17);
  if (target.kind === 'rubix') {
    const modulePath = `/src/instruments/${target.dim ? 'rubixoids/' : ''}rubix/rubix-app.js`;
    await page.evaluate(async path => (await import(path)).rubixoidsNative.applySettings({ readingMode: 'face' }), modulePath);
    await expect(scope.locator('#readPath')).toHaveValue('face');
    for (const mode of ['face','snake','parallel']) await scope.locator('#readPath').selectOption(mode);
    await scope.locator('#randomTwists').click();
    await expect(scope.locator('#randomTwists')).toHaveAttribute('aria-pressed', 'true');
    await scope.locator('#randomTwists').click();
    await expect(scope.locator('#randomTwists')).toHaveAttribute('aria-pressed', 'false');
  } else {
    await expect(scope.locator('#twistPlayButton')).toBeDisabled();
    await scope.locator('#sequenceMethod').selectOption('sticker-hyperbar');
    await expect(scope.locator('#twistPlayButton')).toBeEnabled();
    await scope.locator('#twistMotion').selectOption('beat');
    await scope.locator('#twistPlayButton').click();
    await expect(scope.locator('#twistMotion')).toHaveValue('off');
    await scope.locator('#twistPlayButton').click();
    await expect(scope.locator('#twistMotion')).toHaveValue('beat');
    await scope.locator('#sequenceMethod').selectOption('sticker-stream');
    await expect(scope.locator('#twistPlayButton')).toBeDisabled();
  }
  await expect(scope.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  const envelope = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  if (target.dim) {
    const clock = await page.evaluate(async () => (await import('/src/instruments/rubixoids/clock.js')).rubixoidsClock.snapshot());
    expect(clock.tempo).toBe(153);
    expect(clock.swing).toBe(.17);
    const destination = target.dim === '3d' ? '4d' : '3d';
    await page.locator(`.rubixoids-dimensions [data-dimension="${destination}"]`).click();
    const next = page.locator(`.rubixoids-pane[data-dimension="${destination}"]`);
    await expect(next.locator('#tempo')).toHaveValue('153');
    await expect(next.locator('#swing')).toHaveValue('0.17');
    await expect(next.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  }
  const active = target.dim ? page.locator('.rubixoids-pane:not([hidden])') : scope;
  await active.locator('#playButton').click();
  await expect(active.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  // Programmatic clicks and the shared Space path must each toggle only once.
  await active.locator('#playButton').evaluate(button => button.click());
  await expect(active.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await active.locator('#stage').focus();
  await page.keyboard.press('Space');
  await expect(active.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await audio.click();
});

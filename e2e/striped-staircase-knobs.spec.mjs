import { expect, test } from '@playwright/test';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const ids = ['progress', 'speed', 'baseFrequency', 'brightness', 'body', 'pitchSpan', 'voiceLimit', 'startIteration', 'maxIterations', 'steps', 'stripePeriod'];
const diagnostics = new WeakMap();
const snapshot = page => page.evaluate(() => window.__staircaseStudies.snapshot());
const values = page => page.locator('.studies-panel input[type="range"]').evaluateAll(inputs => Object.fromEntries(inputs.map(input => [input.id, input.value])));
test.beforeEach(async ({ page, baseURL }) => diagnostics.set(page, watchPageDiagnostics(page, { baseURL })));
test.afterEach(async ({ page }) => expect(pageDiagnosticMessages(diagnostics.get(page))).toEqual([]));

async function open(page) {
  await page.goto('/striped-staircase-rust.html');
  await page.waitForFunction(() => window.__staircaseStudies?.snapshot().ready);
  await page.locator('.study-section details > summary').click();
}

async function expectNeedle(page, id) {
  await expect.poll(() => page.locator(`#${id}`).evaluate(input => {
    const angle = Number(input.parentElement.querySelector('.mz-range-knob__dial > i').style.transform.match(/rotate\(([-\d.]+)deg\)/)?.[1]);
    const expected = -135 + 270 * (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
    return Math.abs(angle - expected);
  // Browsers serialize CSS angles with fewer digits than the native value.
  })).toBeLessThan(.001);
}

test('all parameter knobs retain native drag, keyboard, reset, disabled and Tap behavior', async ({ page }) => {
  await open(page);
  const defaults = await values(page);
  expect(await page.locator('.studies-panel input[type="range"]').evaluateAll(inputs => inputs.every(input => input.parentElement.classList.contains('mz-range-knob')))).toBe(true);
  await page.locator('[data-mode="2"]').click();
  for (const id of ids) {
    const control = page.locator(`#${id}`), previous = Number(await control.inputValue());
    await control.press('ArrowUp');
    expect(Number(await control.inputValue()), `${id} retains native keyboard adjustment`).toBeGreaterThan(previous);
    const state = await snapshot(page);
    expect(Number(state[id] ?? state.settings[id])).toBe(Number(await control.inputValue()));
    await expectNeedle(page, id);
  }

  const control = page.locator('#brightness');
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox(), before = Number(await control.inputValue());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  expect(Number(await control.inputValue()), 'taking hold does not jump the hidden slider').toBe(before);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 18, { steps: 4 });
  await page.mouse.up();
  expect((await snapshot(page)).brightness).toBeGreaterThan(before);
  await expectNeedle(page, 'brightness');

  await page.locator('[data-mode="0"]').click();
  await expect(page.locator('#body')).toBeDisabled();
  await expect(page.locator('#pitchControls')).toBeHidden();
  await expect(page.locator('label[for="body"]')).toHaveClass(/is-disabled/);
  await page.locator('[data-mode="3"]').click();
  await expect(page.locator('#body')).toBeEnabled();

  const tap = page.locator('[data-tap-control="#speed"]');
  await expect(tap).toHaveCount(1);
  await tap.click();
  await page.waitForTimeout(400);
  await tap.click();
  expect((await snapshot(page)).speed).toBeGreaterThan(Number(defaults.speed));
  await expectNeedle(page, 'speed');
  expect((await snapshot(page)).audio).toBe(false);
  await page.locator('#resetAll').click();
  await expect(page.locator('#pitchControls')).toBeVisible();
  expect(await values(page)).toEqual(defaults);
  for (const id of ids) await expectNeedle(page, id);
  expect((await snapshot(page)).audio).toBe(false);
});

test('the focused depth knob resumes following the clock after a captured drag', async ({ page }) => {
  await open(page);
  await page.locator('#playButton').click();
  const control = page.locator('#progress');
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12, { steps: 3 });
  await page.mouse.up();
  await expect(control).toBeFocused();
  const released = Number(await control.inputValue());
  await expect.poll(async () => Number(await control.inputValue())).toBeGreaterThan(released + .003);
  await expectNeedle(page, 'progress');
  expect((await snapshot(page)).audio).toBe(false);
  await page.evaluate(() => window.__staircaseStudies.teardown());
  await expect(page.locator('.studies-panel .mz-range-knob__dial')).toHaveCount(0);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`knobs ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });
    test('touch knobs keep readable labels and capture gestures without scrolling the page', async ({ page }, info) => {
      await open(page);
      for (const id of ids) {
        const input = page.locator(`#${id}`);
        await input.scrollIntoViewIfNeeded();
        const box = await input.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(48);
        expect(box.height).toBeGreaterThanOrEqual(48);
        expect(await input.evaluate(node => {
          const field = node.parentElement.getBoundingClientRect();
          const dial = node.parentElement.querySelector('.mz-range-knob__dial').getBoundingClientRect();
          return [...node.parentElement.querySelectorAll('b:not(.mz-range-knob__modulation),output')].every(label => {
            const rect = label.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1 && rect.left >= field.left - 1 && rect.right <= field.right + 1 && rect.top >= dial.bottom && rect.bottom <= field.bottom + 1;
          });
        }), `${id} keeps its label and readout below the dial`).toBe(true);
      }
      const input = page.locator('#brightness');
      await input.scrollIntoViewIfNeeded();
      const box = await input.boundingBox(), before = Number(await input.inputValue());
      const scrollBefore = await page.evaluate(() => document.documentElement.scrollTop + document.body.scrollTop);
      const client = await page.context().newCDPSession(page);
      const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      expect(Number(await input.inputValue())).toBe(before);
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 24 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      expect((await snapshot(page)).brightness).toBeGreaterThan(before);
      expect(await page.evaluate(() => document.documentElement.scrollTop + document.body.scrollTop)).toBe(scrollBefore);
      await expectNeedle(page, 'brightness');
      expect((await snapshot(page)).audio).toBe(false);
      await client.detach();
      await page.screenshot({ path: info.outputPath('staircase-knobs.png'), fullPage: true });
    });
  });
}

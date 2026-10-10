import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';

const motions = [
  { name: 'node', play: 'nodeMotionPlayButton', mode: 'nodeMotionMode', speed: 'nodeMotionSpeed', size: 'nodeMotionAmount', moving: 'nodeMoving' },
  { name: 'input', play: 'micMotionPlayButton', mode: 'micMotionMode', speed: 'micMotionSpeed', size: 'micMotionSize', moving: 'micMoving' },
];
const snapshot = page => page.evaluate(() => __graphDelayRust.snapshot());
const tapButton = (page, id) => page.locator(`.mz-tap-tempo[data-tap-control="#${id}"]`);
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installAudioInputFixture(page);
  await page.goto('/graph-delay-rust.html?renderer=canvas');
  await page.waitForFunction(() => Boolean(globalThis.__graphDelayRust));
  for (const { speed } of motions) await expect(tapButton(page, speed)).toHaveCount(1);
  await expect(page.locator('#motionSection')).toHaveJSProperty('open', false);
  return errors;
}

async function revealMotion(page) {
  await page.locator('#motionSection > summary').click();
  await expect(page.locator('#motionSection')).toHaveJSProperty('open', true);
}

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function tap(page, id, interval = 500) {
  await tapButton(page, id).evaluate((button, interval) => {
    button.reset();
    const time = performance.now();
    button.tap(time);
    button.tap(time + interval);
    button.tap(time + 2 * interval);
  }, interval);
}

async function expectSilent(page) {
  const state = await snapshot(page);
  expect(state.audio).toBe(false);
  expect(state.microphone).toBe(false);
  expect(state.metrics).toBeNull();
  expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`Graph Rust motion ${viewport.width}×${viewport.height}`, () => {
    const coarse = viewport.width !== 1440;
    test.use({ viewport, hasTouch: coarse, isMobile: coarse });
    test('circular Play stays beside its path, tempo, Tap and travel controls', async ({ page }, info) => {
      const errors = await open(page);
      await revealMotion(page);
      for (const { name, play, mode, speed, size } of motions) {
        const button = page.locator(`#${play}`);
        const group = button.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " graph-motion-group ")][1]');
        await expect(group).toHaveCount(1);
        expect(await group.evaluate(node => Boolean(node.closest('#motionSection')))).toBe(true);
        await expect(group.locator(`#${mode}`)).toHaveCount(1);
        await expect(group.locator(`#${speed}`)).toHaveCount(1);
        await expect(group.locator(`#${size}`)).toHaveCount(1);
        await expect(group.locator('.mz-tap-tempo')).toHaveCount(1);
        await group.scrollIntoViewIfNeeded();
        await expect(button).toBeVisible();
        await expect(tapButton(page, speed)).toBeVisible();
        await expect(button).toHaveCSS('border-radius', '50%');
        const box = await button.boundingBox();
        expect(Math.abs(box.width - box.height)).toBeLessThan(1);
        for (const target of [button, page.locator(`#${speed}`), tapButton(page, speed)]) {
          await target.scrollIntoViewIfNeeded();
          const rect = await target.boundingBox();
          expect(rect.x).toBeGreaterThanOrEqual(-1);
          expect(rect.y).toBeGreaterThanOrEqual(-1);
          expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
          if (coarse) {
            expect(rect.width).toBeGreaterThanOrEqual(48);
            expect(rect.height).toBeGreaterThanOrEqual(48);
          }
        }
        await expect(button).toHaveAttribute('aria-label', `Play ${name} motion`);
        await expect(button.locator('.transport-play')).toBeVisible();
        await expect(button.locator('.transport-pause')).toBeHidden();
        await button.click();
        await expect(button).toHaveAttribute('aria-label', `Pause ${name} motion`);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(button.locator('.transport-play')).toBeHidden();
        await expect(button.locator('.transport-pause')).toBeVisible();
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
      }
      await expect(page.locator('#motionSection')).toHaveJSProperty('open', true);
      await expectSilent(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(await page.locator('.panel').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      await info.attach(`graph-motion-${viewport.width}x${viewport.height}`, { contentType: 'image/png', body: await page.screenshot() });
      expect(errors).toEqual([]);
    });
  });
}

test('motion tempo taps act independently, preserve keyboard transport, and retain preset units', async ({ page }) => {
  const errors = await open(page);
  await page.locator('.header-preset-picker summary').click();
  await page.locator('button[data-preset-id="clearSteps"]').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'clearSteps');
  await revealMotion(page);
  const initial = await snapshot(page);
  await tap(page, 'nodeMotionSpeed');
  expect((await snapshot(page)).parameters).toMatchObject({
    nodeMotionSpeed: 2, micMotionSpeed: initial.parameters.micMotionSpeed, nodeMoving: false, micMoving: false,
  });
  await tap(page, 'micMotionSpeed');
  for (const { play, speed, moving } of motions) {
    await expect(page.locator(`#${speed}`)).toHaveValue('2');
    await expect(page.locator(`#${speed}Out`)).toHaveText(/^120(?:\.0+)? BPM$/);
    const button = page.locator(`#${play}`);
    await button.focus();
    await button.press('Enter');
    expect((await snapshot(page)).parameters[moving]).toBe(true);
    await button.press('Space');
    expect((await snapshot(page)).parameters[moving]).toBe(false);
  }
  const saved = await capture(page);
  expect(saved.snapshot.parameters).toMatchObject({ nodeMotionSpeed: 2, micMotionSpeed: 2 });
  expect(saved.selectedId).toBeNull();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  expect(await page.evaluate(async saved => {
    const { validateGraphDelayRustPreset } = await import('/src/instruments/graph-delay-rust/graph-delay-presets.js');
    return validateGraphDelayRustPreset(JSON.parse(JSON.stringify(saved))).parameters;
  }, saved.snapshot)).toEqual(saved.snapshot.parameters);
  await page.locator('.header-preset-picker summary').click();
  await page.locator('button[data-preset-id="clearSteps"]').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id', 'clearSteps');
  const factory = await page.evaluate(async () => (await import('/src/instruments/graph-delay-rust/graph-delay-presets.js'))
    .GRAPH_DELAY_RUST_PRESETS.find(preset => preset.id === 'clearSteps').snapshot);
  expect((await capture(page)).snapshot).toEqual(factory);
  for (const { speed } of motions) await expect(page.locator(`#${speed}`)).toHaveValue(String(factory.parameters[speed]));
  await expect(page.locator('#motionSection')).toHaveJSProperty('open', true);
  await expectSilent(page);
  expect(errors).toEqual([]);
});

test('doubling tapped tempo doubles periodic node and input motion without restarting either', async ({ page }) => {
  // Run the real motion timer against a controlled browser clock. This avoids
  // wall-clock scheduling tolerances while measuring the public graph geometry.
  await page.clock.install({ time: new Date('2026-10-10T12:00:00Z') });
  const errors = await open(page);
  await revealMotion(page);
  await page.clock.pauseAt(new Date('2026-10-10T12:01:00Z'));
  await setRange(page, 'nodeMotionAmount', .03);
  await page.locator('#nodeMotionMode').evaluate(select => {
    select.value = 'orbit'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const center = (await snapshot(page)).graph.nodes[0];
  for (const { speed } of motions) await tap(page, speed, 1000);
  await page.evaluate(() => {
    document.getElementById('nodeMotionPlayButton').click();
    document.getElementById('micMotionPlayButton').click();
  });
  await page.clock.runFor(50);
  const before = await snapshot(page);
  await page.clock.runFor(250);
  const slow = await snapshot(page);
  for (const { speed } of motions) await tap(page, speed, 500);
  const retuned = await snapshot(page);
  expect(retuned.graph).toEqual(slow.graph);
  expect([retuned.parameters.inputX, retuned.parameters.inputY]).toEqual([slow.parameters.inputX, slow.parameters.inputY]);
  expect(retuned.parameters).toMatchObject({ nodeMoving: true, micMoving: true, nodeMotionSpeed: 2, micMotionSpeed: 2 });
  await page.clock.runFor(250);
  const fast = await snapshot(page);
  const angle = (state, node) => node
    ? Math.atan2(state.graph.nodes[0].y - center.y, state.graph.nodes[0].x - center.x)
    : Math.atan2(state.parameters.inputY - .5, state.parameters.inputX - .5);
  const advance = (from, to, node) => (angle(to, node) - angle(from, node) + 2 * Math.PI) % (2 * Math.PI);
  for (const node of [true, false]) {
    expect(advance(before, slow, node)).toBeCloseTo(Math.PI / 2, 5);
    expect(advance(retuned, fast, node)).toBeCloseTo(Math.PI, 5);
  }
  await page.evaluate(() => {
    document.getElementById('nodeMotionPlayButton').click();
    document.getElementById('micMotionPlayButton').click();
  });
  const paused = await snapshot(page);
  await page.clock.runFor(500);
  const later = await snapshot(page);
  expect(later.graph).toEqual(paused.graph);
  expect([later.parameters.inputX, later.parameters.inputY]).toEqual([paused.parameters.inputX, paused.parameters.inputY]);
  await expectSilent(page);
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';
import { readAudioStatus, sampleAudioEnvelope, waitForAudioState, waitForStableAudioState } from './helpers/audio-probe.mjs';

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
const snapshot = page => page.evaluate(() => __graphDelayRust.snapshot());
async function open(page, delayed = false) {
  await installAudioInputFixture(page, delayed);
  await page.goto('/graph-delay-rust.html?renderer=webgl2');
  await page.waitForFunction(() => Boolean(globalThis.__graphDelayRust));
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Graph Delay Rust fits ${viewport.width}×${viewport.height}, silent gestures and keyboard`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await open(page);
    await expect(page.locator('h1')).toHaveText('Graph Delay Rust');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    const before = await snapshot(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('ArrowRight');
    expect((await snapshot(page)).graph.nodes[0].x).toBeGreaterThan(before.graph.nodes[0].x);
    await page.keyboard.press(']');
    await page.keyboard.press('Enter');
    expect(Object.values((await snapshot(page)).edgeSwitches).includes(false)).toBe(true);
    await page.locator('#motionSection > summary').click();
    await page.locator('#nodeMotionPlayButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const stage = await page.locator('#stage').boundingBox();
    expect(stage.width).toBeGreaterThan(200);
    expect(stage.height).toBeGreaterThan(120);
    expect(errors).toEqual([]);
  });
}

test('Rust feedback remains bounded through live geometry, dense presets, and panic', async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('.mz-input-toggle').click();
  await expect(page.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await waitForStableAudioState(page, false);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await waitForAudioState(page, true, 10_000);
  const initial = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(initial.summary.finite).toBe(true);
  expect(initial.summary.clippedSamples).toBe(0);
  await setRange(page, 'inputTrim', .65);
  await setRange(page, 'level', .32);
  // A larger factory scene proves admission above the old 192-turn ceiling.
  await page.locator('.header-preset-picker summary').click();
  await page.locator('button[data-preset-id="wovenGlass"]').click();
  await expect.poll(async () => (await snapshot(page)).graph.nodes.length).toBe(48);
  const availableIds = await page.locator('button[data-preset-id]').evaluateAll(nodes => nodes.map(node => node.dataset.presetId));
  expect(availableIds.length).toBeGreaterThanOrEqual(17);
  await setRange(page, 'nodeCount', 48);
  await page.locator('#topology').evaluate(node => { node.closest('details').open = true; });
  await page.locator('#topology').selectOption('dag');
  await setRange(page, 'density', .5);
  await expect.poll(async () => (await snapshot(page)).graph.nodes.length).toBe(48);
  await expect.poll(async () => (await snapshot(page)).metrics?.routes ?? 0).toBeGreaterThan(192);
  await expect(page.locator('#level')).toHaveValue('0.32');
  await expect(page.locator('#inputTrim')).toHaveValue('0.65');
  await setRange(page, 'pitchScale', .7);
  await setRange(page, 'baseDelay', 110);
  await page.locator('#stage').focus();
  await page.keyboard.press('ArrowDown');
  const changing = await sampleAudioEnvelope(page, { durationMs: 600 });
  expect(changing.summary.finite).toBe(true);
  expect(changing.summary.clippedSamples).toBe(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  // Stall only the main thread: the worklet must keep advancing its sample clock.
  const before = (await snapshot(page)).metrics.elapsedSeconds;
  await page.evaluate(() => { const end = performance.now() + 180; while (performance.now() < end) { /* deliberate UI stall */ } });
  await expect.poll(async () => (await snapshot(page)).metrics.elapsedSeconds).toBeGreaterThan(before + .15);
  await info.attach('graph-delay-rust-audio.json', { body: JSON.stringify({ initial: initial.summary, changing: changing.summary, state: await snapshot(page) }), contentType: 'application/json' });
  await page.locator('#panicButton').click();
  await waitForStableAudioState(page, false);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __familyInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

test('pending microphone permission is cancelled and a late grant is released', async ({ page }) => {
  await open(page, true);
  const button = page.locator('.mz-input-toggle');
  await button.click();
  await expect.poll(() => page.evaluate(() => __familyInput.requests)).toBe(1);
  await button.click();
  await page.evaluate(() => __familyInput.releases.splice(0).forEach(release => release()));
  await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('WebGL loss falls back to Canvas without disrupting the graph', async ({ page }) => {
  await open(page);
  const before = await snapshot(page);
  const supported = await page.evaluate(() => {
    const gl = document.querySelector('#graphGpuStage').getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    globalThis.__graphTestContext = extension;
    extension.loseContext();
    return true;
  });
  test.skip(!supported, 'This browser does not expose WebGL2 context-loss testing');
  await expect.poll(async () => (await snapshot(page)).renderer).toBe('canvas');
  expect((await snapshot(page)).graph).toEqual(before.graph);
  await page.evaluate(() => __graphTestContext.restoreContext());
  await expect.poll(async () => (await snapshot(page)).renderer).toBe('webgl2');
});

test('cold Audio startup can be cancelled and safely retried after a late WASM fetch', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/wasm/graph-delay.wasm', async route => { await gate; await route.continue(); });
  await open(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#panicButton')).toBeEnabled();
  await page.keyboard.press('Escape');
  release();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
  await expect(page.locator('#audioError')).toBeHidden();
  await page.locator('#panicButton').click();
});

test('moving presets and dice retain output zero and complete their state transactions', async ({ page }) => {
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await open(page);
  await page.locator('.mz-input-toggle').click();
  await expect(page.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await setRange(page, 'level', 0);
  await setRange(page, 'inputTrim', .42);
  for (const id of ['glassCanopy', 'islandConstellation', 'wideCanopy']) {
    await page.locator('.header-preset-picker summary').click();
    await page.locator(`button[data-preset-id="${id}"]`).click();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
    await expect(page.locator('#level')).toHaveValue('0');
    await expect(page.locator('#inputTrim')).toHaveValue('0.42');
  }
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
  await waitForStableAudioState(page, false);
  expect((await snapshot(page)).audio).toBe(true);
  expect((await snapshot(page)).microphone).toBe(true);
  expect(errors).toEqual([]);
  await page.locator('#panicButton').click();
});

test('a switch edited during asynchronous recall stays closed after the preset commits', async ({ page }) => {
  await open(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  expect((await snapshot(page)).graph.edges[0]).toMatchObject({ from: 0, to: 1 });
  await page.evaluate(async () => {
    const { GraphDelayRustEngine } = await import('/src/instruments/graph-delay-rust/graph-delay-engine.js');
    const update = GraphDelayRustEngine.prototype.update;
    const gate = new Promise(resolve => { globalThis.__releaseGraphRecall = resolve; });
    let held = false;
    GraphDelayRustEngine.prototype.update = async function (...args) {
      const result = await update.apply(this, args);
      if (!held && args[0].nodes.length === 63) {
        held = globalThis.__graphRecallReady = true;
        await gate;
      }
      return result;
    };
  });
  await page.locator('.header-preset-picker summary').click();
  await page.locator('button[data-preset-id="wideCanopy"]').click();
  await page.waitForFunction(() => globalThis.__graphRecallReady);
  await page.locator('#stage').focus();
  await page.keyboard.press(']');
  await page.keyboard.press('Enter');
  await setRange(page, 'pitchScale', 1.2);
  await page.evaluate(() => __releaseGraphRecall());
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false');
  expect((await snapshot(page)).graph.nodes).toHaveLength(63);
  expect((await snapshot(page)).edgeSwitches['0>1']).toBe(false);
  expect((await snapshot(page)).parameters.pitchScale).toBe(1.2);
  await page.locator('#panicButton').click();
});

test('wet output contains uninterrupted samples across a main-thread stall', async ({ page }, info) => {
  await open(page);
  await page.locator('#topology').evaluate(node => { node.closest('details').open = true; });
  await page.locator('#topology').selectOption('chain');
  await setRange(page, 'nodeCount', 3);
  await setRange(page, 'baseDelay', 20);
  await setRange(page, 'timeScale', 0);
  await setRange(page, 'pitchScale', 0);
  await setRange(page, 'dry', 0);
  await setRange(page, 'wet', 1);
  await expect.poll(async () => (await snapshot(page)).graph.nodes.length).toBe(3);
  await page.locator('.mz-input-toggle').click();
  await expect(page.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#audioButton').click();
  await waitForAudioState(page, true);
  const evidence = await page.evaluate(async () => {
    const { OutputRecorder } = await import('/src/output-recorder.js');
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager();
    const recorder = new OutputRecorder({ manager });
    await recorder.start();
    const context = manager.recordingContext(), start = context.currentTime;
    await new Promise(resolve => setTimeout(resolve, 250));
    const until = performance.now() + 180;
    while (performance.now() < until) { /* exercise continuity without UI callbacks */ }
    await new Promise(resolve => setTimeout(resolve, 250));
    const elapsed = context.currentTime - start;
    const take = await recorder.stop();
    const bytes = new Uint8Array(await take.blob.arrayBuffer());
    const frames = (bytes.length - 44) / 6, window = Math.round(take.sampleRate * .01);
    const rms = [];
    for (let at = window; at + window < frames; at += window) {
      let power = 0;
      for (let frame = at; frame < at + window; frame++) {
        for (let channel = 0; channel < 2; channel++) {
          const offset = 44 + frame * 6 + channel * 3;
          const integer = (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16) << 8 >> 8;
          power += (integer / 8388608) ** 2;
        }
      }
      rms.push(Math.sqrt(power / (window * 2)));
    }
    recorder.discard();
    return { error: take.error, seconds: frames / take.sampleRate, elapsed, rms };
  });
  expect(evidence.error).toBe('');
  expect(evidence.seconds).toBeGreaterThan(.6);
  expect(Math.abs(evidence.seconds - evidence.elapsed)).toBeLessThan(.04);
  expect(Math.min(...evidence.rms)).toBeGreaterThan(.0001);
  await info.attach('wet-output-through-ui-stall.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
  await page.locator('#panicButton').click();
});

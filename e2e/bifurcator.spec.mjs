import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFakeMidi, enableFakeMidi, sendMidi } from './helpers/fake-midi.mjs';

const snapshot = page => page.evaluate(() => window.bifurcator.snapshot());
const meter = page => page.evaluate(async () => (await import('/src/audio-output-manager.js')).getSharedAudioOutputManager().getStatus());
async function open(page) {
  await page.goto('/bifurcator.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.bifurcator))).toBe(true);
}
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}

test('explicit Audio, all five real models, mute continuity, pause/release and disposal', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await open(page);
  await page.locator('#playButton').click();
  await page.locator('#stage').press('Space');
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(.05);
  expect((await snapshot(page)).contextState).toBe('uncreated');
  expect((await meter(page)).connectionCount).toBe(0);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  for (const model of ['lorenz', 'hopf', 'logistic', 'fold', 'rossler']) {
    await page.locator('#model').selectOption(model);
    await expect.poll(async () => (await snapshot(page)).model).toBe(model);
    await expect.poll(async () => (await meter(page)).peak).toBeGreaterThan(.003);
    const output = await meter(page); expect(output.clipped).toBe(false); expect(output.peak).toBeLessThan(.65);
    expect((await snapshot(page)).params.playing).toBe(true);
  }
  const beforeEdit = await snapshot(page);
  await input(page, 'clarity', .97); await input(page, 'speed', 1.6); await input(page, 'frequency', 173.5);
  expect((await snapshot(page)).enabled).toBe(true);
  expect((await snapshot(page)).time).toBeGreaterThanOrEqual(beforeEdit.time);
  await page.locator('#resetButton').click();
  expect((await snapshot(page)).enabled).toBe(true);
  expect((await snapshot(page)).params.playing).toBe(true);
  expect((await snapshot(page)).output).toBe(beforeEdit.output);
  await expect.poll(async () => (await meter(page)).peak).toBeGreaterThan(.003);
  // Rendering stalls leave the worklet's audio clock advancing.
  const beforeStall = (await snapshot(page)).time;
  await page.evaluate(() => { const start = performance.now(); while (performance.now() - start < 250) {} });
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(beforeStall + .15);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await meter(page)).peak).toBeLessThan(.00001);
  const muted = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(muted.time + .1);
  expect((await snapshot(page)).params.playing).toBe(true);
  await page.locator('#audioButton').click(); await page.locator('#playButton').click();
  await expect.poll(async () => (await meter(page)).peak).toBeLessThan(.00001);
  const paused = await snapshot(page);
  await page.waitForTimeout(180);
  expect((await snapshot(page)).point).toEqual(paused.point);
  await page.evaluate(() => window.bifurcator.dispose());
  expect((await meter(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

test('keyboard, captured dragging and complete preset recall preserve Audio, Play and output', async ({ page }) => {
  await open(page);
  const canvas = page.locator('#stage'); await canvas.focus();
  const before = await snapshot(page);
  await canvas.press('ArrowRight'); await canvas.press('ArrowUp');
  expect((await snapshot(page)).params.regime).toBeGreaterThan(before.params.regime);
  expect((await snapshot(page)).params.clarity).toBeGreaterThan(before.params.clarity);
  await canvas.dispatchEvent('keydown', { key: ' ', code: 'Space', repeat: true });
  expect((await snapshot(page)).params.playing).toBe(true);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .4); await page.mouse.up();
  expect((await snapshot(page)).params.regime).toBeGreaterThan(before.params.regime + .05);
  await input(page, 'level', .17);
  await page.locator('#playButton').click();
  await page.locator('.header-preset-next').click();
  let state = await snapshot(page);
  expect(state.output).toBe(.17); expect(state.params.playing).toBe(false); expect(state.enabled).toBe(false);
  await page.locator('.header-preset-random').click();
  state = await snapshot(page);
  expect(state.output).toBe(.17); expect(state.params.playing).toBe(false); expect(state.contextState).toBe('uncreated');
  await page.locator('#resetButton').click();
  expect((await snapshot(page)).params.model).toBe('lorenz');
  expect((await snapshot(page)).output).toBe(.17);
});

test('universal MIDI maps note pitch, bend and transport to this instrument', async ({ page }) => {
  await installFakeMidi(page); await open(page); await enableFakeMidi(page);
  await sendMidi(page, [0x90, 69, 90]);
  await expect.poll(async () => (await snapshot(page)).params.frequency).toBeCloseTo(440, 1);
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await sendMidi(page, [0xe0, 127, 127]);
  await expect.poll(async () => (await snapshot(page)).params.frequency).toBeGreaterThan(440);
  await sendMidi(page, [0xfc]);
  await expect.poll(async () => (await snapshot(page)).params.playing).toBe(false);
  await sendMidi(page, [0xfa]);
  await expect.poll(async () => (await snapshot(page)).params.playing).toBe(true);
});

test('interrupted Audio resumes explicitly and BFCache preserves a usable instrument', async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options) { super(options); window.__bifurcatorTestContext = this; }
    };
  });
  await open(page); await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await page.evaluate(() => window.__bifurcatorTestContext.suspend());
  await expect(page.locator('#audioButton')).toHaveAttribute('data-audio-state', 'interrupted');
  await page.locator('#sweepButton').click();
  expect((await snapshot(page)).sweep.running).toBe(true);
  await input(page, 'regime', .5);
  expect((await snapshot(page)).sweep.running).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  expect((await snapshot(page)).disposed).toBe(false);
  await input(page, 'clarity', .82); expect((await snapshot(page)).params.clarity).toBe(.82);
});

test('startup and processor errors recover explicitly without rewinding the sweep', async ({ page }) => {
  // Chromium worklet fetches bypass Playwright's page-route interception.
  // Reject the real startup API once, then restore its native implementation.
  await page.addInitScript(() => {
    window.__rejectBifurcatorWorklet = true;
    const OriginalNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends OriginalNode {
      constructor(...args) { super(...args); window.__bifurcatorWorkletNode = this; }
    };
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      get audioWorklet() {
        const native = super.audioWorklet;
        return { addModule: (...args) => window.__rejectBifurcatorWorklet
          ? Promise.reject(new Error('Worklet unavailable during startup')) : native.addModule(...args) };
      }
    };
  });
  await open(page); await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('data-audio-state', 'error');
  expect((await snapshot(page)).enabled).toBe(false);
  expect((await meter(page)).connectionCount).toBe(0);
  await page.evaluate(() => { window.__rejectBifurcatorWorklet = false; }); await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await expect.poll(async () => (await meter(page)).peak).toBeGreaterThan(.003);
  await input(page, 'sweepSeconds', 8); await page.locator('#sweepButton').click();
  await expect.poll(async () => (await snapshot(page)).sweep.progress).toBeGreaterThan(.12);
  const beforeFailure = await snapshot(page);
  await page.evaluate(() => window.__bifurcatorWorkletNode.onprocessorerror(new Event('processorerror')));
  await expect(page.locator('#audioButton')).toHaveAttribute('data-audio-state', 'error');
  await expect.poll(async () => (await snapshot(page)).sweep.progress).toBeGreaterThanOrEqual(beforeFailure.sweep.progress);
  expect((await snapshot(page)).time).toBeGreaterThanOrEqual(beforeFailure.time);
  expect((await snapshot(page)).enabled).toBe(false);
  expect((await meter(page)).connectionCount).toBe(0);
  // An edit before the restart must survive the fallback state transfer.
  await input(page, 'clarity', .73);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await expect.poll(async () => (await snapshot(page)).sweep.progress).toBeGreaterThan(beforeFailure.sweep.progress + .02);
  expect((await snapshot(page)).params.clarity).toBe(.73);
  expect((await meter(page)).connectionCount).toBe(1);
});

test('Wave cycles observes actual audio branches and preserves them on pause', async ({ page }) => {
  await open(page);
  await page.locator('#cycleView').click();
  expect((await snapshot(page)).contextState).toBe('uncreated');
  await page.locator('#model').selectOption('logistic');
  await input(page, 'frequency', 220); await input(page, 'depth', 1); await input(page, 'clarity', .6);
  for (const [r, period] of [[2.8, 1], [3.2, 2], [3.5, 4], [3.835, 3]]) {
    await input(page, 'regime', (r - 2.6) / 1.4);
    await expect.poll(async () => (await snapshot(page)).cycles.period).toBe(period);
  }
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await input(page, 'regime', (3.2 - 2.6) / 1.4);
  await expect.poll(async () => (await snapshot(page)).cycles.period).toBe(2);
  await page.locator('#playButton').click();
  await expect.poll(async () => (await snapshot(page)).paused).toBe(true);
  const held = (await snapshot(page)).cycles;
  await page.waitForTimeout(180);
  expect((await snapshot(page)).cycles).toEqual(held);
  await page.locator('#playButton').click();
  await input(page, 'regime', (3.99 - 2.6) / 1.4);
  await expect.poll(async () => (await snapshot(page)).cycles.status).toBe('irregular');
  expect((await snapshot(page)).cycles.count).toBeLessThanOrEqual(24);
  await page.locator('#orbitView').click();
  expect((await snapshot(page)).graphic).toBe('orbit');
  expect((await snapshot(page)).enabled).toBe(true);
});

test('Sweep splits transfers from silent preview, follows audio time and preserves live controls', async ({ page }) => {
  await open(page); await input(page, 'frequency', 220); await input(page, 'sweepSeconds', 4);
  await page.locator('#sweepButton').click();
  await expect.poll(async () => (await snapshot(page)).sweep.progress).toBeGreaterThan(.03);
  const preview = await snapshot(page);
  expect(preview.enabled).toBe(false); expect(preview.graphic).toBe('cycles');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await expect.poll(async () => (await snapshot(page)).sweep.progress).toBeGreaterThan(preview.sweep.progress);
  expect((await snapshot(page)).sweep.running).toBe(true);
  await input(page, 'clarity', .8);
  expect((await snapshot(page)).sweep.running).toBe(true);
  const beforeStall = (await snapshot(page)).sweep.progress;
  await page.evaluate(() => { const start = performance.now(); while (performance.now() - start < 250) {} });
  await expect.poll(async () => (await snapshot(page)).sweep.progress).toBeGreaterThan(beforeStall + .04);
  await page.locator('#playButton').click();
  await expect.poll(async () => (await snapshot(page)).params.playing).toBe(false);
  await page.waitForTimeout(100); const held = (await snapshot(page)).sweep;
  await page.waitForTimeout(150); expect((await snapshot(page)).sweep).toEqual(held);
  await page.locator('#playButton').click();
  await expect.poll(async () => (await snapshot(page)).sweep.running, { timeout: 7000 }).toBe(false);
  const end = await snapshot(page);
  expect(end.sweep.progress).toBe(1); expect(end.params.frequency).toBe(220);
  expect(end.output).toBe(preview.output); expect(end.enabled).toBe(true);
  await page.locator('#sweepButton').click();
  await expect.poll(async () => (await snapshot(page)).sweep.running).toBe(true);
  await input(page, 'regime', .5);
  await expect.poll(async () => (await snapshot(page)).sweep.running).toBe(false);
});

test('Shape playheads follow real contours, hold growth and keep audio independent of drawing', async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalContext = window.AudioContext;
    window.AudioContext = class extends OriginalContext {
      constructor(...args) { super(...args); window.__shapeTestContext = this; }
    };
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(...args) { super(...args); window.__shapeWorkletNode = this; }
    };
  });
  await open(page);
  await page.locator('#sonification').selectOption('shape');
  await input(page, 'headCount', 4);
  await expect.poll(async () => (await snapshot(page)).shape?.count ?? 0).toBeGreaterThan(60);
  const preview = await snapshot(page);
  expect(preview.enabled).toBe(false); expect(preview.contextState).toBe('uncreated');
  expect(preview.shape.heads.length).toBe(4);
  await expect(page.locator('#clarity')).toBeHidden();
  await expect(page.locator('#pitchSpan')).toBeVisible();
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await expect.poll(async () => (await meter(page)).peak).toBeGreaterThan(.003);
  await expect.poll(async () => (await snapshot(page)).shape.count).toBeGreaterThanOrEqual(preview.shape.count);
  await page.locator('#growShape').uncheck();
  await expect.poll(async () => (await snapshot(page)).params.growShape).toBe(false);
  await page.waitForTimeout(80);
  const held = await snapshot(page);
  await page.evaluate(() => { const start = performance.now(); while (performance.now() - start < 250) {} });
  const afterStall = await snapshot(page);
  expect(afterStall.point).toEqual(held.point);
  expect(afterStall.shape.points).toEqual(held.shape.points);
  expect(afterStall.time).toBeGreaterThan(held.time + .15);
  expect(afterStall.shape.heads.map(head => head.position)).not.toEqual(held.shape.heads.map(head => head.position));
  await page.evaluate(() => window.__shapeWorkletNode.onprocessorerror(new Event('processorerror')));
  await expect(page.locator('#audioButton')).toHaveAttribute('data-audio-state', 'error');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  expect((await snapshot(page)).shape.points).toEqual(held.shape.points);
  expect((await snapshot(page)).time).toBeGreaterThanOrEqual(afterStall.time);
  expect((await meter(page)).connectionCount).toBe(1);
  await input(page, 'pitchSpan', 0);
  await expect.poll(async () => (await snapshot(page)).shape.heads.every(head => Math.abs(head.frequency - 110) < 1)).toBe(true);
  await input(page, 'frequency', 220);
  await expect.poll(async () => (await snapshot(page)).shape.heads.every(head => Math.abs(head.frequency - 220) < 1)).toBe(true);
  await page.locator('#pitchAxis').selectOption('horizontal');
  await input(page, 'pitchSpan', 3);
  await expect.poll(async () => (await snapshot(page)).shape.heads.some(head => head.frequency > 230)).toBe(true);
  await expect(page.locator('#headFrequencies')).toContainText('Hz');
  await page.locator('#playButton').click();
  await expect.poll(async () => (await snapshot(page)).paused).toBe(true);
  const paused = await snapshot(page); await page.waitForTimeout(120);
  expect((await snapshot(page)).shape).toEqual(paused.shape);
  await page.locator('#playButton').click();
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(paused.time);
  await page.locator('#audioButton').click();
  const muted = await snapshot(page); await page.waitForTimeout(120);
  expect((await snapshot(page)).time).toBeGreaterThan(muted.time);
  expect((await snapshot(page)).enabled).toBe(false);
  await page.evaluate(() => window.__shapeTestContext.suspend());
  const interrupted = await snapshot(page);
  await page.locator('#model').selectOption('rossler');
  expect((await snapshot(page)).shape).toBeNull();
  expect((await snapshot(page)).point).toEqual(interrupted.point);
  expect((await snapshot(page)).time).toBe(interrupted.time);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await expect.poll(async () => (await snapshot(page)).shape?.count ?? 0).toBeGreaterThan(0);
  await page.locator('#sonification').selectOption('orbit');
  await expect(page.locator('#clarity')).toBeVisible();
  await page.locator('#sweepButton').click();
  await expect.poll(async () => (await snapshot(page)).sweep.running).toBe(true);
  expect((await snapshot(page)).params.sonification).toBe('orbit');
});

test('sixteen rhythmic readers expose real tempos, retain beat clocks and recover stereo audio', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(...args) { super(...args); window.__rhythmWorkletNode = this; }
    };
  });
  await open(page);
  await page.locator('#sonification').selectOption('rhythm');
  await input(page, 'headCount', 16); await input(page, 'tempo', 120);
  await page.locator('#tempoAxis').selectOption('height'); await input(page, 'tempoSpan', 2);
  await page.locator('#pitchAxis').selectOption('depth');
  await expect.poll(async () => (await snapshot(page)).shape?.count ?? 0).toBeGreaterThan(60);
  let state = await snapshot(page);
  expect(state.contextState).toBe('uncreated'); expect(state.shape.heads).toHaveLength(16);
  expect(state.shape.heads.every(head => Number.isFinite(head.tempo) && head.tempo >= 8 && head.tempo <= 960)).toBe(true);
  await expect(page.locator('#headRows tr:visible')).toHaveCount(16);
  await expect(page.locator('#tempoSummary')).toContainText('60–240 BPM');
  await page.locator('#tempoView').click();
  await expect(page.locator('#stage')).toHaveAttribute('aria-label', /16 rhythm playheads.*actual BPM/);
  await page.locator('#stage').focus(); await page.keyboard.press('ArrowUp');
  expect((await snapshot(page)).params.tempoSpan).toBeGreaterThan(2);
  await page.locator('details.mapping-controls > summary').click();
  await page.locator('#travelAxis').selectOption('bend'); await input(page, 'travelSpan', 1.5);
  await page.locator('#amplitudeAxis').selectOption('center'); await input(page, 'amplitudeDepth', .5);
  await page.locator('#panAxis').selectOption('horizontal'); await input(page, 'panWidth', .9);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await expect.poll(async () => (await meter(page)).peak).toBeGreaterThan(.002);
  await page.locator('#growShape').uncheck(); await page.waitForTimeout(80);
  const held = await snapshot(page);
  await page.evaluate(() => { const start = performance.now(); while (performance.now() - start < 250) {} });
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(held.time + .15);
  state = await snapshot(page);
  expect(state.shape.points).toEqual(held.shape.points); expect(state.point).toEqual(held.point);
  expect(state.shape.heads.reduce((total, head) => total + head.hits, 0)).toBeGreaterThan(held.shape.heads.reduce((total, head) => total + head.hits, 0));
  await page.locator('#rhythmRatios').selectOption('two-three-four');
  await page.locator('#tempoAxis').selectOption('none');
  await input(page, 'headCount', 3); await input(page, 'tempo', 60);
  await expect.poll(async () => (await snapshot(page)).shape.heads.slice(0, 3).map(head => Math.round(head.tempo))).toEqual([60, 90, 120]);
  await expect(page.locator('#tempoSummary')).toContainText('×1.5: 90 BPM');
  await expect(page.locator('#tempoSpan')).toBeDisabled();
  await page.locator('#stage').focus(); await page.keyboard.press('ArrowUp');
  expect((await snapshot(page)).params.tempo).toBeGreaterThan(60);
  const beforeFailure = await snapshot(page);
  await page.evaluate(() => window.__rhythmWorkletNode.onprocessorerror(new Event('processorerror')));
  await expect(page.locator('#audioButton')).toHaveAttribute('data-audio-state', 'error');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  await expect.poll(async () => (await meter(page)).peak).toBeGreaterThan(.002);
  state = await snapshot(page);
  expect(state.shape.points).toEqual(held.shape.points); expect(state.time).toBeGreaterThanOrEqual(beforeFailure.time);
  expect(state.shape.heads[0].hits).toBeGreaterThanOrEqual(beforeFailure.shape.heads[0].hits);
  expect(state.channels.every(Number.isFinite)).toBe(true); expect((await meter(page)).connectionCount).toBe(1);
  await page.locator('#playButton').click(); await expect.poll(async () => (await snapshot(page)).paused).toBe(true);
  const paused = await snapshot(page); await page.waitForTimeout(150);
  expect((await snapshot(page)).shape).toEqual(paused.shape);
  await page.locator('#playButton').click(); await page.locator('#audioButton').click();
  const muted = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(muted.time + .1);
  await expect.poll(async () => (await meter(page)).peak).toBeLessThan(.00001);
  expect(errors).toEqual([]);
});

test('shared taps edit real tempo, travel, motion and sweep controls without resetting transport', async ({ page }) => {
  await open(page);
  const tap = async (selector, interval) => {
    const button = page.locator(`.mz-tap-tempo[data-tap-control="${selector}"]`);
    await expect(button).toBeVisible();
    return button.evaluate((node, interval) => {
      const before = window.bifurcator.snapshot();
      node.reset(); const start = performance.now();
      node.tap(start); node.tap(start + interval); node.tap(start + interval * 2);
      return { before, after: window.bifurcator.snapshot() };
    }, interval);
  };
  await input(page, 'level', .17);
  let result = await tap('#sweepSeconds', 5000);
  expect(result.after.params.sweepSeconds).toBe(5);
  expect(result.after.params.playing).toBe(result.before.params.playing);
  expect(result.after.contextState).toBe('uncreated');
  await page.locator('#sonification').selectOption('rhythm');
  await expect.poll(async () => (await snapshot(page)).shape?.count ?? 0).toBeGreaterThan(60);
  result = await tap('#tempo', 600);
  expect(result.after.params.tempo).toBe(100);
  expect(result.after.shape.heads.map(head => head.beatPhase)).toEqual(result.before.shape.heads.map(head => head.beatPhase));
  result = await tap('#headRate', 1000);
  expect(result.after.params.headRate).toBe(.5);
  expect(result.after.shape.heads.map(head => head.phase)).toEqual(result.before.shape.heads.map(head => head.phase));
  result = await tap('#speed', 500);
  expect(result.after.params.speed).toBe(1);
  expect(result.after.params.playing).toBe(true); expect(result.after.enabled).toBe(false);
  expect(result.after.output).toBe(.17); expect(result.after.contextState).toBe('uncreated');
  await page.locator('#audioButton').click(); await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  result = await tap('#tempo', 500);
  expect(result.after.params.tempo).toBe(120); expect(result.after.enabled).toBe(true);
  expect(result.after.params.playing).toBe(true); expect(result.after.output).toBe(.17);
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(result.before.time + .1);
});

test('fifty full presets restore every new route while preserving live transport and output', async ({ page }) => {
  await open(page); await input(page, 'level', .17); await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).enabled).toBe(true);
  const bank = await page.evaluate(async () => (await import('/src/instruments/bifurcator/presets.js')).PRESETS);
  expect(bank).toHaveLength(50);
  await expect(page.locator('[data-full-preset]')).toHaveCount(50);
  for (const id of ['shape-sixteen', 'rhythm-variable-234', 'rhythm-paper-ticks', 'rhythm-glass-sixteen', 'rhythm-depth-kick']) {
    const before = await snapshot(page);
    await page.locator('.header-preset-picker > summary').click();
    await page.locator(`[data-preset-id="${id}"]`).click();
    const state = await snapshot(page), preset = bank.find(preset => preset.id === id);
    for (const [key, value] of Object.entries(preset.snapshot)) expect(state.params[key], `${id}.${key}`).toEqual(value);
    expect(state.enabled).toBe(true); expect(state.params.playing).toBe(true); expect(state.output).toBe(.17);
    expect(state.time).toBeGreaterThanOrEqual(before.time);
  }
  await page.locator('#playButton').click();
  await page.locator('.header-preset-random').click();
  expect((await snapshot(page)).params.playing).toBe(false);
  expect((await snapshot(page)).enabled).toBe(true); expect((await snapshot(page)).output).toBe(.17);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`controls and accessible graphics at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: true }); const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const stage = await page.locator('.bifurcator-stage-wrap').boundingBox();
    const panel = await page.locator('.bifurcator-panel').boundingBox();
    expect(stage.height).toBeGreaterThanOrEqual(220);
    expect(panel.height).toBeGreaterThan(120);
    expect(stage.x + stage.width <= panel.x + 1 || stage.y + stage.height <= panel.y + 1).toBe(true);
    await page.locator('#cycleView').click();
    expect((await snapshot(page)).graphic).toBe('cycles');
    await page.locator('#sweepButton').scrollIntoViewIfNeeded();
    await page.locator('#sweepButton').click();
    await expect.poll(async () => (await snapshot(page)).cycles.count).toBeGreaterThan(0);
    await page.locator('#sweepButton').click();
    for (const id of ['audioButton', 'playButton']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
    }
    for (const model of ['lorenz', 'rossler', 'logistic', 'fold', 'hopf']) {
      await page.locator('#model').selectOption(model);
      await expect(page.locator('#clarity')).toBeVisible();
    }
    await page.locator('#sonification').selectOption('shape');
    await page.locator('#model').selectOption('lorenz');
    await input(page, 'headCount', 4);
    await expect.poll(async () => (await snapshot(page)).shape?.count ?? 0).toBeGreaterThan(0);
    await page.locator('#headRate').scrollIntoViewIfNeeded(); await expect(page.locator('#headRate')).toBeVisible();
    await page.locator('#pitchAxis').selectOption('center');
    await page.locator('#growShape').uncheck();
    await page.locator('#stage').scrollIntoViewIfNeeded();
    await page.locator('#stage').focus();
    const span = (await snapshot(page)).params.pitchSpan;
    await page.keyboard.press('ArrowUp'); expect((await snapshot(page)).params.pitchSpan).toBeGreaterThan(span);
    await expect(page.locator('#stage')).toHaveAttribute('aria-label', /4 pitch playheads/);
    await page.locator('#sonification').selectOption('rhythm');
    await input(page, 'headCount', 16); await page.locator('#tempoAxis').selectOption('path'); await input(page, 'tempoSpan', 2);
    await page.locator('#tempoView').click();
    await expect(page.locator('#tempoSummary')).toContainText('48–192 BPM');
    await expect.poll(async () => (await snapshot(page)).shape?.heads.length).toBe(16);
    await expect(page.locator('#headRows tr:visible')).toHaveCount(16);
    await page.locator('details.mapping-controls > summary').click();
    for (const id of ['travelAxis', 'amplitudeAxis', 'panAxis']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded(); await page.locator(`#${id}`).selectOption('depth');
    }
    await input(page, 'panWidth', .8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const tempoLayout = await page.evaluate(async () => {
      const { tempoMapBounds } = await import('/src/instruments/bifurcator/renderer.js');
      const canvas = document.getElementById('stage').getBoundingClientRect();
      const views = document.querySelector('.stage-view').getBoundingClientRect();
      const actions = document.querySelector('.stage-actions').getBoundingClientRect();
      const bounds = tempoMapBounds(canvas.width, canvas.height, 16);
      return { graphTop: canvas.y + bounds.top, buttonsBottom: views.bottom, lanesBottom: canvas.y + bounds.bottom, actionsTop: actions.top, graphHeight: bounds.mapBottom - bounds.top };
    });
    expect(tempoLayout.graphTop).toBeGreaterThanOrEqual(tempoLayout.buttonsBottom + 5);
    expect(tempoLayout.lanesBottom).toBeLessThanOrEqual(tempoLayout.actionsTop - 6);
    expect(tempoLayout.graphHeight).toBeGreaterThanOrEqual(30);
    await page.screenshot({ path: `/tmp/bifurcator-rhythm-${viewport.width}x${viewport.height}.png` });
    await page.locator('#cutoff').scrollIntoViewIfNeeded(); await expect(page.locator('#cutoff')).toBeVisible();
    const a11y = await new AxeBuilder({ page }).options({ preload: false }).analyze();
    expect(a11y.violations).toEqual([]); expect(errors).toEqual([]);
    await context.close();
  });
}

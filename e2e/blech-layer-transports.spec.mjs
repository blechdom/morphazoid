import { test, expect } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__layerQA = { engine: null, player: null, contexts: [], notes: [], held: new Map() };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __layerQA.contexts.push(this); } };
  });
  // Observe the real processor's notifications; preserve production synthesis,
  // sample clocks, file transport and source-specific note release.
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaLayerVolume = MidiMixerEngine.prototype.setVolume, qaLayerSeen = new WeakSet();
      MidiMixerEngine.prototype.setVolume = function(...args) {
        __layerQA.engine = this;
        if (!qaLayerSeen.has(this)) { qaLayerSeen.add(this); this.subscribeNotes(notes => {
          for (const note of notes) {
            __layerQA.notes.push({ ...note });
            if (note.type === 'noteOn') __layerQA.held.set(note.id, note);
            else if (note.type === 'noteOff') __layerQA.held.delete(note.id);
          }
        }); }
        return qaLayerVolume.apply(this, args);
      };` });
  });
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaLayerPublish = MidiphoriaPlayer.prototype._publish;
      MidiphoriaPlayer.prototype._publish = function(...args) { __layerQA.player = this; return qaLayerPublish.apply(this, args); };` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#blechMathDrop')).toBeEnabled();
  await expect.poll(() => page.locator('#blackSongSelect option').count()).toBeGreaterThan(100);
}

const rows = page => page.locator('#blechLiveLayers .blech-live-layer');
const row = (page, id) => page.locator(`#blechLiveLayers [data-sample-id="${id}"]`);
const snapshot = page => page.evaluate(() => ({
  samples: __layerQA.engine.state.samples.map(sample => ({ id: sample.id, name: sample.name,
    paused: sample.paused, loop: sample.loop, position: sample.positionBeats,
    cycle: sample.cycle, duration: sample.analysis.durationBeats })),
  contexts: __layerQA.contexts.length,
  fileTime: __layerQA.player?.state.time,
  filePlaying: __layerQA.player?.state.playing,
}));
const sample = async (page, id) => (await snapshot(page)).samples.find(item => item.id === id);
const progress = value => value.cycle * value.duration + value.position;
const noteCount = (page, id) => page.evaluate(id => __layerQA.notes.filter(note => note.sampleId === id && note.type === 'noteOn').length, id);
const heldCount = (page, id) => page.evaluate(id => [...__layerQA.held.values()].filter(note => note.sampleId === id).length, id);
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function tab(page, name) {
  if (['stamps', 'drawing'].includes(name)) await page.locator('#blechTab-frames').click();
  await page.locator(`#blechTab-${name}`).click();
  await expect(page.locator(`#blechPanel-${name}`)).toBeVisible();
}
async function drop(page) {
  const before = new Set((await snapshot(page)).samples.map(item => item.id));
  await page.locator('#blechDropLoop').click();
  await page.locator('#blechDropDelay').fill('0'); await page.locator('#blechDropDelay').press('Tab');
  await page.locator('#blechDropSend').click();
  await expect.poll(async () => (await snapshot(page)).samples.length).toBe(before.size + 1);
  return (await snapshot(page)).samples.find(item => !before.has(item.id));
}
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 12000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 50 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001); expect(summary.clippedSamples).toBe(0);
  return summary;
}

test('each dropped equation has identifiable pause, resume and stop controls without arming Audio', async ({ page }) => {
  await open(page); await tab(page, 'math');
  const first = await drop(page), second = await drop(page);
  expect(first.name).toBe(second.name); expect(first.id).not.toBe(second.id);
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, first.id).locator('[data-layer-pause]')).toHaveAccessibleName(`Pause ${first.name} · ${first.id}`);
  await expect(row(page, second.id).locator('[data-layer-stop]')).toHaveAccessibleName(`Remove ${second.name} · ${second.id}`);
  await expect(page.locator('#blechDropLoop')).toHaveAccessibleName('Loop');
  await page.locator('#blechDropOnce').click();
  expect((await snapshot(page)).samples.every(item => item.loop)).toBe(true);

  await row(page, first.id).locator('[data-layer-pause]').click();
  await expect(row(page, first.id).locator('[data-layer-pause]')).toHaveAccessibleName(`Resume ${first.name} · ${first.id}`);
  const paused = await sample(page, first.id), otherBefore = await sample(page, second.id);
  expect(paused.paused).toBe(true);
  await page.waitForTimeout(350);
  expect(await sample(page, first.id)).toEqual(paused);
  expect(progress(await sample(page, second.id))).toBeGreaterThan(progress(otherBefore) + .2);
  await row(page, first.id).locator('[data-layer-pause]').click();
  await expect.poll(async () => progress(await sample(page, first.id))).toBeGreaterThan(progress(paused) + .1);
  expect((await sample(page, first.id)).paused).toBe(false);
  await tab(page, 'stamps');
  await row(page, first.id).locator('[data-layer-stop]').click();
  await expect(row(page, first.id)).toHaveCount(0);
  await expect(row(page, second.id).locator('[data-layer-pause]')).toBeFocused();
  expect((await snapshot(page)).samples.map(item => item.id)).toEqual([second.id]);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await snapshot(page)).contexts).toBe(0);
});

test('pausing and stopping one sounding equation releases its notes while another equation and MIDI file continue', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await open(page);
  await tab(page, 'files');
  await page.locator('#blackSongSelect').selectOption('depeche-mode-everything-counts');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await expect(page.locator('#blackPlayButton')).toBeEnabled(); await page.locator('#blackPlayButton').click();
  await tab(page, 'math');
  const first = await drop(page);
  await page.locator('#blechMathPreset').selectOption('heart', { force: true });
  const second = await drop(page);
  await expect.poll(() => noteCount(page, first.id)).toBeGreaterThan(4);
  await expect.poll(() => noteCount(page, second.id)).toBeGreaterThan(4);
  const signal = await audible(page);
  await row(page, first.id).locator('[data-layer-pause]').click();
  await expect.poll(async () => (await sample(page, first.id)).paused).toBe(true);
  await expect.poll(() => heldCount(page, first.id)).toBe(0);
  // Allow the next worklet telemetry delivery before measuring the frozen phase.
  await page.waitForTimeout(150);
  const paused = await sample(page, first.id), before = await snapshot(page);
  const firstNotes = await noteCount(page, first.id), secondNotes = await noteCount(page, second.id);
  await page.waitForTimeout(500);
  expect(await sample(page, first.id)).toEqual(paused);
  expect(await noteCount(page, first.id)).toBe(firstNotes);
  expect(await heldCount(page, first.id)).toBe(0);
  expect(await noteCount(page, second.id)).toBeGreaterThan(secondNotes);
  expect((await snapshot(page)).fileTime).toBeGreaterThan(before.fileTime + .2);
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
  await audible(page);
  await row(page, first.id).locator('[data-layer-pause]').click();
  await expect.poll(() => noteCount(page, first.id)).toBeGreaterThan(firstNotes);
  expect((await sample(page, first.id)).paused).toBe(false);
  await expect.poll(async () => progress(await sample(page, first.id))).toBeGreaterThan(progress(paused));
  await row(page, first.id).locator('[data-layer-stop]').click();
  await expect(row(page, first.id)).toHaveCount(0);
  await expect.poll(() => heldCount(page, first.id)).toBe(0);
  const stoppedCount = await noteCount(page, first.id), continuing = await snapshot(page);
  await page.waitForTimeout(400);
  expect(await noteCount(page, first.id)).toBe(stoppedCount);
  expect((await snapshot(page)).samples.map(item => item.id)).toEqual([second.id]);
  expect(progress(await sample(page, second.id))).toBeGreaterThan(progress(continuing.samples[0]));
  expect((await snapshot(page)).fileTime).toBeGreaterThan(continuing.fileTime);
  await row(page, second.id).locator('[data-layer-pause]').click();
  await tab(page, 'files');
  await page.locator('#blackPlayButton').click();
  await expect.poll(() => heldCount(page, second.id)).toBe(0);
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 12000 }).toBeLessThan(.0001);
  expect((await snapshot(page)).contexts).toBe(1);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await testInfo.attach('native-layer-audio', { body: JSON.stringify({ signal, first: first.id, second: second.id, releasedHeldNotes: await heldCount(page, second.id) }), contentType: 'application/json' });
});

test('the live layer Loop checkbox finishes only that layer’s current pass', async ({ page }) => {
  await open(page); await tab(page, 'math');
  await input(page, 'creativeTempo', 60); await input(page, 'blechMathBeats', 4);
  const first = await drop(page), second = await drop(page);
  await page.waitForFunction(id => {
    const sample = __layerQA.engine.state.samples.find(item => item.id === id);
    return sample && sample.positionBeats > .1 && sample.positionBeats < 1.5;
  }, first.id);
  await row(page, first.id).getByRole('checkbox').uncheck();
  expect(await sample(page, first.id)).toMatchObject({ loop: false, paused: false });
  expect(await sample(page, second.id)).toMatchObject({ loop: true, paused: false });
  await page.waitForTimeout(350);
  await expect(row(page, first.id)).toHaveCount(1);
  await expect(row(page, first.id)).toHaveCount(0, { timeout: 6500 });
  expect((await snapshot(page)).samples.map(item => item.id)).toEqual([second.id]);
  expect((await snapshot(page)).contexts).toBe(0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`active layer recovery remains reachable across tabs at ${viewport.width} × ${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await open(page); await tab(page, 'math');
    const first = await drop(page), second = await drop(page);
    for (const name of ['stamps', 'drawing', 'automata', 'files']) {
      await tab(page, name); await expect(rows(page)).toHaveCount(2);
      for (const id of [first.id, second.id]) for (const selector of ['[data-layer-pause]', '[data-layer-stop]']) {
        const button = row(page, id).locator(selector); await button.scrollIntoViewIfNeeded();
        expect(await button.evaluate(node => { const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
      }
    }
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth - innerWidth,
      rows: [...document.querySelectorAll('.blech-live-layer')].map(node => node.scrollWidth - node.clientWidth) }));
    expect(overflow.document).toBeLessThanOrEqual(1); expect(Math.max(...overflow.rows)).toBeLessThanOrEqual(1);
    await row(page, first.id).locator('[data-layer-pause]').click();
    await row(page, second.id).locator('[data-layer-stop]').click();
    expect((await snapshot(page)).samples).toHaveLength(1);
    expect(await sample(page, first.id)).toMatchObject({ paused: true });
    await page.screenshot({ path: testInfo.outputPath('layer-transports.png') });
  });
}

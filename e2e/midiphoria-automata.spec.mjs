import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page), 'uncaught browser errors').toEqual([]); });

// Observe the real submitted scores and native contexts. Playback, timing,
// SoundFont synthesis, output routing and UI events retain their normal paths.
async function observe(page) {
  await page.addInitScript(() => {
    globalThis.__automataQA = { contexts: [], loads: [], launches: [], engine: null };
    const Native = globalThis.AudioContext;
    globalThis.AudioContext = class extends Native {
      constructor(...args) { super(...args); __automataQA.contexts.push(this); }
    };
  });
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaLoad = MidiphoriaPlayer.prototype.load;
      MidiphoriaPlayer.prototype.load = function(buffer, ...args) {
        __automataQA.loads.push({ name: args[0], bytes: Array.from(new Uint8Array(buffer)) });
        return qaLoad.call(this, buffer, ...args);
      };
    ` });
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume = MidiMixerEngine.prototype.setVolume;
      MidiMixerEngine.prototype.setVolume = function(...args) {
        __automataQA.engine = this; return qaVolume.apply(this, args);
      };
      const qaTrigger = MidiMixerEngine.prototype.triggerSample;
      MidiMixerEngine.prototype.triggerSample = function(...args) {
        const result = qaTrigger.apply(this, args);
        if (result) __automataQA.launches.push({ id: result.id, name: result.name,
          program: result.midi?.program ?? result.program, gain: result.gain,
          duration: result.analysis.durationBeats, bytes: Array.from(new Uint8Array(args[0])),
          notes: result.analysis.notes.map(({ note, beat, duration, velocity }) => ({ note, beat, duration, velocity })) });
        return result;
      };
    ` });
  });
}

async function open(page) {
  await observe(page); await page.goto('/blech-midi.html');
  await page.locator('#automataModeButton').click();
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-view', 'automata');
  await expect(page.locator('#automataMidiPreview')).toBeVisible();
  return 'automataMidi';
}
async function expand(details) { if (!await details.getAttribute('open').then(value => value !== null)) await details.locator(':scope > summary').click(); }
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function chooseRule(page, prefix, code) {
  await expand(page.locator(`#${prefix}RulePicker`));
  await page.locator(`#${prefix}RuleSearch`).fill(String(code));
  await page.locator(`#${prefix}RulePicker [data-automata-rule="${code}"]`).click();
}
async function configure(page, prefix, { rows = 16 } = {}) {
  await chooseRule(page, prefix, 90); await expand(page.locator(`#${prefix}Parameters`));
  for (const [field, value] of Object.entries({ Columns: 24, Rows: rows, RowBeats: .5, LowestNote: 40, Velocity: 73, Density: 0 })) await input(page, `${prefix}${field}`, value);
  await page.locator(`#${prefix}Articulation`).selectOption('retrigger');
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
}
async function audible(page, testInfo, name) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 30 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001);
  expect(summary.clippedSamples).toBe(0); expect(summary.maxPeak).toBeLessThanOrEqual(.981);
  await testInfo.attach(name, { body: JSON.stringify(summary), contentType: 'application/json' });
}
async function download(page, prefix) {
  const pending = page.waitForEvent('download'); await page.locator(`#${prefix}Download`).click();
  const result = await pending; expect(result.suggestedFilename()).toMatch(/\.mid$/);
  return readFile(await result.path());
}
const launches = page => page.evaluate(() => __automataQA.launches);
async function launch(page, action) {
  const before = (await launches(page)).length; await action();
  await expect.poll(async () => (await launches(page)).length).toBe(before + 1);
  return (await launches(page)).at(-1);
}

test('the rule atlas filters the active family and previews without selecting MIDI or arming Audio', async ({ page }) => {
  const prefix = await open(page), picker = page.locator(`#${prefix}RulePicker`);
  await expand(picker); const rules = picker.locator('[data-automata-rule]:visible');
  await expect(rules).toHaveCount(256);
  await page.locator(`#${prefix}RuleSearch`).fill('01011010'); await expect(rules).toHaveCount(1);
  await expect(rules).toHaveAttribute('data-automata-rule', '90');
  await rules.click(); await expect(page.locator(`#${prefix}RuleLabel`)).toContainText('90');
  expect(await launches(page)).toEqual([]);
  await page.locator(`#${prefix}Family`).selectOption('totalistic-r2'); await expand(picker);
  await page.locator(`#${prefix}RuleSearch`).fill(''); await expect(rules).toHaveCount(64);
  expect(await rules.evaluateAll(nodes => nodes.every(node => node.dataset.automataFamily === 'totalistic-r2' && Number(node.dataset.automataRule) <= 63))).toBe(true);
  await page.locator(`#${prefix}RuleSearch`).fill('101010'); await expect(rules).toHaveCount(1);
  await expect(rules).toHaveAttribute('data-automata-rule', '42');
  await page.locator(`#${prefix}RuleSearch`).fill('90'); await expect(rules).toHaveCount(0);
  await page.locator(`#${prefix}RuleSearch`).fill(''); await page.locator(`#${prefix}Representatives`).check();
  expect(await rules.count()).toBeGreaterThan(0); expect(await rules.count()).toBeLessThan(64);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0);
  expect(await page.evaluate(() => __automataQA.loads)).toEqual([]);
});

test('export and native stamp receive the exact selected rule, dimensions, pitch, timing and velocity', async ({ page }) => {
  const prefix = await open(page); await configure(page, prefix);
  await expect(page.locator(`#${prefix}Preview`)).toHaveAttribute('viewBox', '0 0 24 16');
  const bytes = await download(page, prefix), score = parseMidi(bytes);
  // Rule 90 is left XOR right with fixed zero edges. Independently derive its
  // cells to catch wrong family/selection, reversed time, thinning or stale UI.
  let cells = Array.from({ length: 24 }, (_, column) => Number(column === 12)); const expected = [], pixels = [];
  for (let row = 0; row < 16; row++) {
    pixels.push(cells);
    cells.forEach((on, column) => { if (on) expected.push({ note: 40 + column, beat: row * .5, duration: .5, velocity: 73 }); });
    cells = cells.map((_, column) => (cells[column - 1] ?? 0) ^ (cells[column + 1] ?? 0));
  }
  const notes = score.notes.map(({ note, beat, duration, velocity }) => ({ note, beat, duration, velocity }));
  expect(notes).toEqual(expected); expect(score.durationBeats).toBe(8);
  const displayed = await page.locator(`#${prefix}Preview path`).evaluate(path =>
    Array.from({ length: 16 }, (_, row) => Array.from({ length: 24 }, (_, column) =>
      Number(path.isPointInFill(new DOMPoint(column + .5, row + .5))))));
  expect(displayed).toEqual(pixels);
  const played = await launch(page, () => page.locator(`#${prefix}Generate`).click());
  expect(played.bytes).toEqual(Array.from(bytes)); expect(played.notes).toEqual(notes);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-view', 'automata');
  await expect(page.locator(`#${prefix}Generate`)).toHaveText('Send rule ↑');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0);
  expect(await page.evaluate(() => __automataQA.loads)).toEqual([]);
});

test('native automata playback stays in its tab, keeps existing sound during previews and preserves explicit Audio intent', async ({ page }, testInfo) => {
  test.setTimeout(60000); const prefix = await open(page); await configure(page, prefix, { rows: 64 });
  await page.locator('#mixerSampleLoop').check(); await arm(page);
  const first = await launch(page, () => page.locator(`#${prefix}Generate`).click());
  await audible(page, testInfo, 'automata-native');
  await chooseRule(page, prefix, 30);
  expect((await launches(page)).length).toBe(1);
  expect(await page.evaluate(id => __automataQA.engine.state.samples.some(sample => sample.id === id), first.id)).toBe(true);
  const next = await launch(page, () => page.locator(`#${prefix}Generate`).click());
  expect(next.notes).not.toEqual(first.notes);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-view', 'automata');
  await audible(page, testInfo, 'automata-regenerated-native');
  await page.locator('#audioButton').click();
  await chooseRule(page, prefix, 110); await launch(page, () => page.locator(`#${prefix}Generate`).click());
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  await arm(page); await audible(page, testInfo, 'automata-audio-recovered');
  expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(1);
  expect(await page.evaluate(() => __automataQA.loads)).toEqual([]);
});

test('native automata stamps repeat, paint by pitch and respond to sample controls without arming Audio implicitly', async ({ page }, testInfo) => {
  test.setTimeout(60000); const prefix = await open(page); await configure(page, prefix, { rows: 64 });
  const silent = await launch(page, () => page.locator(`#${prefix}Generate`).click());
  expect(silent.notes.length).toBeGreaterThan(0); expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#mixerStopSamples').click(); await arm(page);
  await page.locator('#mixerSampleProgram').selectOption('16');
  const sounding = await launch(page, () => page.locator(`#${prefix}Generate`).click());
  expect(sounding.notes).toEqual(silent.notes); expect(sounding.program).toBe(16);
  await audible(page, testInfo, 'automata-stamp-native');
  await input(page, 'mixerSampleLevel', 0);
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeLessThan(.001);
  await input(page, 'mixerSampleLevel', .7); await audible(page, testInfo, 'automata-stamp-level-recovered');
  const beforePreview = (await launches(page)).length; await chooseRule(page, prefix, 30);
  expect((await launches(page)).length).toBe(beforePreview);
  const repeated = await launch(page, () => page.locator(`#${prefix}Generate`).click());
  expect(repeated.notes).not.toEqual(sounding.notes);
  await page.locator('#mixerStopSamples').click();
  const canvas = page.locator('#mixerPerformanceCanvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  const painted = await launch(page, () => canvas.click({ position: { x: box.width * .65, y: box.height * .5 } }));
  expect(painted.notes.length).toBe(repeated.notes.length);
  // The chosen 24-column score starts at 40: put its center at pitch 83.2,
  // rather than reusing the original 48-column shape bank's center of 72.
  const shift = painted.notes[0].note - repeated.notes[0].note;
  expect(shift).toBe(Math.round(128 * .65 - 24 / 2) - 40);
  expect(painted.notes.map(note => ({ ...note, note: note.note - shift }))).toEqual(repeated.notes);
  await audible(page, testInfo, 'automata-painted-native');
  await page.locator('#mixerStopSamples').click();
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
  expect(await page.evaluate(() => __automataQA.engine.state.playing)).toBe(false);
  await expect(page.locator('[data-mixer-sample]')).toHaveCount(58);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`expanded automata controls remain reachable at ${viewport.width}×${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000 });
    const page = await context.newPage(); const failures = []; page.on('pageerror', error => failures.push(error.message));
    try {
      await open(page);
      for (const [prefix, host] of [['automataMidi', 'automataMidiTools']]) {
        await expand(page.locator(`#${prefix}Parameters`)); await expand(page.locator(`#${prefix}RulePicker`));
        await page.locator(`#${prefix}RuleSearch`).fill('90');
        for (const suffix of ['Family', 'RuleSearch', 'Columns', 'Rows', 'RowBeats', 'LowestNote', 'Articulation', 'Velocity', 'Generate', 'Download']) {
          const control = page.locator(`#${prefix}${suffix}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
          const bounds = await control.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(-1); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
          if (viewport.width < 1000) {
            expect(bounds.width, `${prefix}${suffix} coarse width`).toBeGreaterThanOrEqual(48);
            expect(bounds.height, `${prefix}${suffix} coarse height`).toBeGreaterThanOrEqual(48);
          }
        }
        const field = page.locator(`#${prefix}Columns`); await field.focus(); await field.fill('36');
        await expect(field).toBeFocused(); await page.waitForTimeout(150); await expect(field).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(await page.locator(`#${host}`).evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await page.locator(`#${prefix}Preview`).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${prefix}-${viewport.width}.png`) });
        await page.locator(`#${host} .midiphoria-automata > summary`).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${prefix}-rules-${viewport.width}.png`) });
      }
      expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0); expect(failures).toEqual([]);
    } finally { await context.close(); }
  });
}

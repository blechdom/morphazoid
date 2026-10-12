import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

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
  await expect(page.locator('#drawingCanvas')).toBeVisible();
  await expect(page.locator('#automataMidiPreview')).toBeVisible();
  await expand(page.locator('.automata-midi-rule-details'));
  return 'automataMidi';
}
// The reusable finite component still serves other instruments. Exercise its
// exact prepared-score/export contract explicitly; the real Blech route below
// uses live evolution and captured performance (covered by live-workspace QA).
async function openFinite(page) {
  await observe(page);
  await page.route('**/qa-finite-midi-controls', route => route.fulfill({contentType:'text/html',body:`<!doctype html>
    <html><head><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/instruments/midiphoria/midiphoria.css">
    <link rel="stylesheet" href="/src/instruments/midi-mixer/midi-mixer.css"><style>[hidden]{display:none!important}</style></head>
    <body><button id="audioButton" aria-pressed="false">Audio off</button><main class="mixer-shell">
    <div id="controls"></div><div id="rules"></div><div id="monitor"></div></main><script type="module">
    import {MidiMixerEngine} from '/src/instruments/midi-mixer/midi-mixer-engine.js';
    import {mountMixerPerformance} from '/src/instruments/midi-mixer/midi-mixer-performance.js';
    const engine=new MidiMixerEngine();engine.setVolume(.5);
    const view=mountMixerPerformance(document.querySelector('#controls'),{engine,
      automataHost:document.querySelector('#rules'),visualizerHost:document.querySelector('#monitor')});
    view.setView('automata');view.setActive(true);
    addEventListener('pagehide',()=>{view.dispose();engine.dispose();});
    </script></body></html>`}));
  await page.goto('/qa-finite-midi-controls');await expect(page.locator('#automataMidiPreview')).toBeVisible();return 'automataMidi';
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
  await page.locator(`#${prefix}RuleSearch`).fill(''); await page.locator(`#${prefix}RuleFilter`).selectOption('representatives');
  expect(await rules.count()).toBeGreaterThan(0); expect(await rules.count()).toBeLessThan(64);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0);
  expect(await page.evaluate(() => __automataQA.loads)).toEqual([]);
});

test('the original-style dropdown contains the current thumbnail and symmetry-family previews', async ({ page }) => {
  const prefix = await open(page), picker = page.locator(`#${prefix}RulePicker`);
  await expect(picker.locator(`:scope > summary #${prefix}RuleCurrentPreview`)).toBeVisible();
  const initialThumbnail = await picker.locator(`#${prefix}RuleCurrentPreview path`).getAttribute('d');
  expect(initialThumbnail.length).toBeGreaterThan(50);
  await expand(picker); await page.locator(`#${prefix}RuleFilter`).selectOption('family');
  expect(await picker.locator('[data-automata-rule]:visible').evaluateAll(nodes => nodes.map(node => Number(node.dataset.automataRule)))).toEqual([30, 86, 135, 149]);
  await picker.locator('[data-automata-rule="86"]').click();
  await expect(picker).not.toHaveAttribute('open');
  await expect(page.locator(`#${prefix}Rule`)).toHaveValue('86');
  expect(await picker.locator(`#${prefix}RuleCurrentPreview path`).getAttribute('d')).not.toEqual(initialThumbnail);
  await page.locator(`#${prefix}Family`).selectOption('totalistic-r2');
  await expect(page.locator(`#${prefix}Rule`)).toHaveAttribute('max', '63');
  await expect(page.locator(`#${prefix}RuleLabel`)).toHaveText('Totalistic R2 · Code 20');
  await expect(page.locator(`#${prefix}RuleNeighborhoods`)).toHaveText('5  4  3  2  1  0');
  await page.locator(`#${prefix}Family`).selectOption('elementary'); await expect(page.locator(`#${prefix}Rule`)).toHaveValue('86');
  expect(await launches(page)).toEqual([]); expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0);
});

test('finite controls: seed, restart, width and reciprocal rate preserve a sent MIDI layer', async ({ page }) => {
  const prefix = await openFinite(page); await expand(page.locator(`#${prefix}Parameters`));
  await input(page, `${prefix}Density`, .45); await input(page, `${prefix}Seed`, 123);
  await input(page, `${prefix}Columns`, 64); await input(page, `${prefix}Rows`, 16); await input(page, `${prefix}Rate`, 8);
  await expect(page.locator(`#${prefix}RowBeats`)).toHaveValue('0.125');
  await expect(page.locator(`#${prefix}Preview`)).toHaveAttribute('viewBox', '0 0 64 16');
  const original = await download(page, prefix); const parsed = parseMidi(original);
  expect(parsed.durationBeats).toBe(2); expect(parsed.notes.every(note => Number.isInteger(note.beat * 8))).toBe(true);
  await page.locator('#mixerSampleLoop').check(); const first = await launch(page, () => page.locator(`#${prefix}Generate`).click());
  await page.locator(`#${prefix}NextSeed`).click(); await expect(page.locator(`#${prefix}Seed`)).toHaveValue('124');
  const reseeded = await download(page, prefix); expect(reseeded).not.toEqual(original);
  await page.locator(`#${prefix}Restart`).click(); expect(await download(page, prefix)).toEqual(reseeded);
  await input(page, `${prefix}Columns`, 128); await input(page, `${prefix}RowBeats`, .5);
  await expect(page.locator(`#${prefix}RateOut`)).toHaveText('2 rows/beat');
  await expect(page.locator(`#${prefix}LowestNote`)).toHaveValue('0');
  await expect(page.locator(`#${prefix}Preview`)).toHaveAttribute('viewBox', '0 0 128 16');
  expect((await launches(page)).length).toBe(1);
  expect(await page.evaluate(id => __automataQA.engine.state.samples.some(sample => sample.id === id), first.id)).toBe(true);
  expect((await launches(page))[0].bytes).toEqual(Array.from(original));
  expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0);
  const duplicateIds = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id).filter((id, index, ids) => ids.indexOf(id) !== index));
  expect(duplicateIds).toEqual([]);
});

test('finite controls: export and sample receive exact rule, dimensions, pitch, timing and velocity', async ({ page }) => {
  const prefix = await openFinite(page); await configure(page, prefix);
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
  await expect(page.locator(`#${prefix}Generate`)).toHaveText('Play rule');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0);
  expect(await page.evaluate(() => __automataQA.loads)).toEqual([]);
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
        for (const suffix of ['Family', 'RuleSearch', 'RuleFilter', 'Rule', 'Rate', 'Density', 'Seed', 'Restart', 'NextSeed', 'Columns', 'RowBeats', 'LowestNote', 'Articulation', 'Velocity', 'PlayPause', 'CaptureBeats', 'Capture']) {
          const control = page.locator(`#${prefix}${suffix}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
          const bounds = await control.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(-1); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
          if (viewport.width < 1000) {
            expect(bounds.width, `${prefix}${suffix} coarse width`).toBeGreaterThanOrEqual(48);
            expect(bounds.height, `${prefix}${suffix} coarse height`).toBeGreaterThanOrEqual(48);
          }
        }
        await expect(page.locator(`#${prefix}Rows`)).toBeHidden();
        await expect(page.locator(`#${prefix}Generate`)).toBeHidden();
        await expect(page.locator('#drawingCanvas')).toBeVisible();
        const field = page.locator(`#${prefix}Columns`); await field.focus(); await field.fill('36');
        await expect(field).toBeFocused(); await page.waitForTimeout(150); await expect(field).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(await page.locator(`#${host}`).evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await page.locator(`#${prefix}Preview`).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${prefix}-${viewport.width}.png`) });
        await page.locator(`#${prefix}PlayPause`).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${prefix}-rules-${viewport.width}.png`) });
      }
      expect(await page.evaluate(() => __automataQA.contexts.length)).toBe(0); expect(failures).toEqual([]);
    } finally { await context.close(); }
  });
}

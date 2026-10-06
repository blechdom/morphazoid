import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { L_SYSTEM_TYPES } from '../src/instruments/micmic/native/model.js';

const TYPES = ['bush', 'fan', 'fern', 'whorled', 'ternary', 'quaternary'];
const ORIGINAL = ['pythagorean', 'plant', 'coral', 'dragon', 'koch', 'sierpinski', 'hilbert', 'gosper', 'cantor', 'levy', 'terdragon'];
const GAINS = [1.13, .37, 4];
const gains = d => [d.performance.inputGain, d.performance.level, d.performance.mastering.makeupDb];

async function fixture(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const qa = window.__branchingQa = { monitors: [], sources: [] };
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-l-system-delay') {
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 2048; mute.gain.value = 0;
        node.connect(analyser).connect(mute).connect(node.context.destination);
        qa.monitors.push({ analyser, samples: new Float32Array(analyser.fftSize) });
      }
      return node;
    } });
    const createSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const source = createSource.apply(this, args), record = { started: 0, stopped: 0 };
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { record.started++; return start(...args); };
      source.stop = (...args) => { record.stopped++; return stop(...args); };
      qa.sources.push(record); return source;
    };
  });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
__branchingQa.engine = browserEngine;
__branchingQa.view = () => ({ type: state.parameters.lSystemType, renderer: canvas.dataset.renderer,
  nodes: geometry?.nodes.map(({ id, parentId, x, y, startX, startY, generation, priority, gain }) =>
    ({ id, parentId, x, y, startX, startY, generation, priority, gain })) ?? [],
  tapTargets: [...tapTargets.values()], tapLevels: [...tapLevels.values()] });
` });
  });
  return errors;
}
async function diagnostics(page) {
  return page.evaluate(() => {
    const qa = __branchingQa, d = qa.engine.getDiagnostics(), monitor = qa.monitors.at(-1);
    let peak = 0, square = 0, nonFinite = 0;
    monitor?.analyser.getFloatTimeDomainData(monitor.samples);
    for (const sample of monitor?.samples ?? []) {
      if (!Number.isFinite(sample)) nonFinite++;
      else { peak = Math.max(peak, Math.abs(sample)); square += sample * sample; }
    }
    return { ...d, pcm: { peak, rms: Math.sqrt(square / (monitor?.samples.length || 1)), nonFinite },
      worklets: qa.monitors.length, sources: qa.sources, view: qa.view() };
  });
}
async function ready(page) {
  await page.goto('/l-mic-rust.html?renderer=canvas');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  return (await page.request.get('/src/instruments/micmic/native/presets.json')).json();
}
async function chooseInput(page, id, value) {
  const index = await page.locator(`#${id}`).evaluate((select, value) => [...select.options].findIndex(option => option.value === value), value);
  const menu = page.locator(`[data-select-id="${id}"]`);
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await menu.locator(`button[data-option-index="${index}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveValue(value);
}
async function preset(page, scene) {
  expect(scene).toBeTruthy();
  const menu = page.locator('.instrument-preset-controls details');
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await menu.locator('input[type="search"]').fill(scene.label.split(' · ')[0]);
  await menu.locator(`button[data-preset-id="${scene.id}"]`).click();
  await expect.poll(async () => (await diagnostics(page)).parameters, { timeout: 20000 }).toEqual(scene.snapshot.parameters);
  await expect(page.locator('#stage')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#wet')).toBeEnabled();
}
async function nativeInput(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function save(name, value) {
  const path = test.info().outputPath(`${name}.json`); await writeFile(path, JSON.stringify(value, null, 2));
  await test.info().attach(name, { path, contentType: 'application/json' });
}
async function cleanup(page, errors) {
  if ((await diagnostics(page)).audio) await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).input.playing).toBe(false);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await diagnostics(page)).disposed).toBe(true);
  expect(errors).toEqual([]);
}

test('all six new branching presets restore from Cantor with audible wet descendants and a continuous real source', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await fixture(page), bank = await ready(page);
  expect(bank).toHaveLength(186);
  const choices = await page.locator('#lSystemType option').evaluateAll(options => options.map(option => ({ id: option.value, group: option.closest('optgroup')?.label })));
  expect(choices.map(option => option.id).sort()).toEqual([...L_SYSTEM_TYPES].sort());
  expect(choices.filter(option => ORIGINAL.includes(option.id)).map(option => option.id)).toEqual(ORIGINAL);
  const groups = new Map(); for (const option of choices) groups.set(option.group, (groups.get(option.group) || 0) + 1);
  expect([...groups.values()].sort((a, b) => a - b)).toEqual([10, 13]);
  for (const type of TYPES) expect(bank.filter(scene => scene.snapshot.parameters.lSystemType === type)).toHaveLength(6);
  await preset(page, bank.find(scene => scene.id === 'pearl-lichen'));
  for (const [id, value] of [['inputTrim', GAINS[0]], ['level', GAINS[1]], ['makeupDb', GAINS[2]]]) await nativeInput(page, id, value);
  await chooseInput(page, 'source', 'samples'); await chooseInput(page, 'inputSample', 'music-keys');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).input.playing, { timeout: 20000 }).toBe(true);
  const before = await diagnostics(page), auditions = [];
  for (const type of TYPES) {
    // Recalling the same linear scene between every new tree catches stale
    // topology and one-branch preset regressions regardless of prior state.
    await preset(page, bank.find(scene => scene.id === 'pearl-lichen'));
    const scene = bank.find(scene => scene.id === `branch-${type}-cutting`); await preset(page, scene);
    // Real native mix control isolates actual descendants from the dry root.
    await nativeInput(page, 'dry', 0);
    await expect.poll(async () => (await diagnostics(page)).performance.dry).toBe(0);
    const start = (await diagnostics(page)).sampleClock;
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return d.audio && d.contextState === 'running' && d.input.playing && d.sampleClock > start + .5
        && d.status.activeVoices > 0 && Math.max(0, ...d.status.tapActivity) > 1e-5
        && d.pcm.nonFinite === 0 && d.pcm.peak > 1e-5 && d.pcm.peak <= 1;
    }, { timeout: 20000 }).toBe(true);
    const d = await diagnostics(page);
    expect(d.contextGeneration).toBe(before.contextGeneration); expect(d.worklets).toBe(1);
    expect(d.sources).toEqual([{ started: 1, stopped: 0 }]); expect(gains(d)).toEqual(GAINS);
    expect(d.parameters).toEqual(scene.snapshot.parameters); expect(d.error).toBeFalsy();
    const children = new Map();
    for (const node of d.view.nodes.filter(node => node.generation > 0)) {
      const list = children.get(node.parentId) || []; list.push(node); children.set(node.parentId, list);
    }
    expect([...children.values()].some(children => children.length > 1), type).toBe(true);
    const nodes = new Map(d.view.nodes.map(node => [node.id, node]));
    for (const node of d.view.nodes.filter(node => node.generation > 0)) {
      expect(node.startX).toBeCloseTo(nodes.get(node.parentId).x, 8); expect(node.startY).toBeCloseTo(nodes.get(node.parentId).y, 8);
    }
    auditions.push({ presetId: scene.id, parameters: d.parameters, requestedVoices: d.requestedVoices,
      eligibleVoices: d.eligibleVoices, voiceLimit: d.status.voiceLimit, activeVoices: d.status.activeVoices,
      sampleClock: d.sampleClock, pcm: d.pcm, tapPeak: Math.max(0, ...d.status.tapActivity), nodes: d.view.nodes });
  }
  const after = await diagnostics(page), wasmBuild = await (await page.request.get('/assets/wasm/l-system-delay-build.json')).json();
  expect(after.sampleClock).toBeGreaterThan(before.sampleClock);
  await save('branching-real-wet-audio', { choices, auditions, before, after, wasmBuild, actualBundledRecording: true,
    actualWasm: true, dryRootMutedDuringAuditions: true, listeningPerformed: false });
  await cleanup(page, errors);
});

test('three- and four-way canopies keep distinct connected siblings in desktop and phone previews without arming Audio', async ({ browser }) => {
  test.setTimeout(90000);
  const layouts = [];
  for (const [name, viewport, hasTouch] of [['desktop', { width: 1440, height: 900 }, false], ['portrait', { width: 390, height: 844 }, true]]) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport, hasTouch }), page = await context.newPage();
    const errors = await fixture(page), bank = await ready(page);
    for (const [type, degree] of [['ternary', 3], ['quaternary', 4]]) {
      await preset(page, bank.find(scene => scene.id === `branch-${type}-glass`));
      await expect.poll(async () => {
        const d = await diagnostics(page); return d.view.nodes.length === (type === 'ternary' ? 364 : 341);
      }).toBe(true);
      const d = await diagnostics(page); expect(d.audio).toBe(false); expect(d.input.playing).toBe(false);
      const children = new Map();
      for (const node of d.view.nodes.slice(1)) { const list = children.get(node.parentId) || []; list.push(node); children.set(node.parentId, list); }
      for (const siblings of children.values()) {
        expect(siblings).toHaveLength(degree); expect(new Set(siblings.map(node => node.id)).size).toBe(degree);
        expect(new Set(siblings.map(node => `${node.x.toFixed(7)},${node.y.toFixed(7)}`)).size).toBe(degree);
      }
      const screenshot = test.info().outputPath(`${name}-${type}.png`); await page.screenshot({ path: screenshot, fullPage: true });
      await test.info().attach(`${name}-${type}`, { path: screenshot, contentType: 'image/png' });
      layouts.push({ name, type, viewport, segments: d.view.nodes.length, forkDegree: degree,
        overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) });
      expect(layouts.at(-1).overflow).toBeLessThanOrEqual(1);
    }
    await cleanup(page, errors); await context.close();
  }
  await save('branching-distinct-siblings', { layouts, physicalTouchDeviceTested: false });
});

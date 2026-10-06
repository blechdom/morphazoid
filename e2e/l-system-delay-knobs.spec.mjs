import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { L_SYSTEM_TYPES } from '../src/instruments/micmic/native/model.js';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const APP = '/src/instruments/micmic/native/app.js';
const CONTRACT = [
  ['inputTrim', '0', '4', '0.01', '0.85'], ['level', '0', '1', '0.01', ''],
  ['voiceCeiling', '0', null, '1', '0'], ['generations', '1', null, '1', '13'],
  ['pruningBias', '-1', '1', '0.01', '0'], ['depth', '0', '0.96', '0.01', '0.72'],
  ['interval', '0', '1000', '1', '300'], ['timeRatio', '0.2', '2', '0.01', '0.72'],
  ['generationAngle', '0', '180', '0.5', '45'], ['generationPitchScale', '0', '4', '0.05', '1'],
  ['generationAsymmetry', '-0.8', '0.8', '0.01', '0'], ['mutation', '0', '1', '0.01', '0'],
  ['curls', '-8', '8', '0.01', '0'],
  ['wet', '0', '1', '0.01', '0.76'], ['dry', '0', '0.5', '0.01', '0'], ['spread', '0', '1', '0.01', '0.9'],
  ['inputHighpassHz', '0', '1000', '1', '220'], ['highpassHz', '0', '1000', '1', '0'],
  ['lowpassHz', '0', '1000', '1', '1000'], ['thresholdDb', '-60', '0', '0.5', '-12'],
  ['ratio', '1', '20', '0.1', '18'], ['kneeDb', '0', '40', '0.5', '5'],
  ['attackMs', '0.1', '100', '0.1', '3'], ['releaseMs', '10', '1500', '1', '180'],
  ['makeupDb', '-12', '24', '0.1', '0'],
];
const BANK = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
const LIVE_GAINS = [1.13, .37, 4];
const gainValues = d => [d.performance.inputGain, d.performance.level, d.performance.mastering.makeupDb];

async function fixture(page) {
  const errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    const qa = window.__knobsQa = { events: [], pointers: {}, compiles: 0, sources: [], nodes: [], frames: [], record: false };
    for (const type of ['input', 'change']) document.addEventListener(type, event => {
      if (event.target.matches?.('input[type="range"]')) qa.events.push({ type, id: event.target.id,
        value: Number(event.target.value), native: event instanceof Event, now: performance.now() });
    }, true);
    document.addEventListener('pointerdown', event => { qa.pointers[event.target.id] = event.pointerId; }, true);
    const NativeWorker = Worker;
    window.Worker = new Proxy(NativeWorker, { construct(Target, args) {
      const worker = new Target(...args);
      if (String(args[0]).includes('/native/topology-worker.js')) {
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (...args) => { qa.compiles++; return post(...args); };
      }
      return worker;
    } });
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-l-system-delay') {
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 1024; mute.gain.value = 0;
        node.connect(analyser).connect(mute).connect(node.context.destination);
        qa.nodes.push({ node, analyser, samples: new Float32Array(analyser.fftSize) });
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
    function frame(now) {
      if (qa.record && qa.engine) {
        const d = qa.engine.getDiagnostics(), monitor = qa.nodes.at(-1);
        let peak = 0, nonFinite = 0;
        monitor?.analyser.getFloatTimeDomainData(monitor.samples);
        for (const value of monitor?.samples ?? []) {
          if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value)); else nonFinite++;
        }
        qa.frames.push({ now, sampleTime: qa.engine.getSampleTime(), blocks: d.processedBlocks,
          peak, nonFinite, inputPeak: d.status.inputPeak, tapPeak: Math.max(0, ...d.status.tapActivity) });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\n__knobsQa.applyScene = applyScene; __knobsQa.engine = browserEngine;\n' });
  });
  return { errors, consoleErrors };
}

async function ready(page) {
  await page.goto('/l-mic-rust.html?renderer=canvas');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await page.waitForFunction(() => __knobsQa.engine?.getDiagnostics().initialized);
}

async function diagnostics(page) { return page.evaluate(() => __knobsQa.engine.getDiagnostics()); }
async function openControl(page, id) {
  const control = page.locator(`#${id}`);
  await control.evaluate(input => {
    // Header flyouts otherwise cover the next side-panel control in a sweep.
    const settings = document.getElementById('nativeSettings');
    if (settings && !settings.contains(input)) settings.open = false;
    for (let parent = input.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  });
  await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
  return control;
}
async function inputValue(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function beginDrag(page, id) {
  const input = await openControl(page, id), box = await input.boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  return point;
}
async function events(page, id) { return page.evaluate(id => __knobsQa.events.filter(event => event.id === id), id); }
async function clearEvents(page) { await page.evaluate(() => { __knobsQa.events = []; }); }
async function chooseInput(page, id, value) {
  const index = await page.locator(`#${id}`).evaluate((select, value) => [...select.options].findIndex(option => option.value === value), value);
  expect(index).toBeGreaterThanOrEqual(0);
  const menu = page.locator(`[data-select-id="${id}"]`);
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await menu.locator(`button[data-option-index="${index}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveValue(value);
}
async function save(name, data) {
  const path = test.info().outputPath(`${name}.json`); await writeFile(path, JSON.stringify(data, null, 2));
  await test.info().attach(name, { path, contentType: 'application/json' });
}
async function cleanup(page, evidence) {
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await diagnostics(page)).disposed).toBe(true);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
}
async function needleChecks(page) {
  return page.evaluate(ids => ids.map(id => {
    const input = document.getElementById(id), min = Number(input.min), max = Number(input.max), value = Number(input.value);
    const fraction = id === 'voiceCeiling' ? Math.log1p(value - min) / Math.log1p(max - min) : (value - min) / (max - min);
    const needle = input.parentElement.querySelector('.mz-range-knob__dial > i');
    return { id, value, expected: -135 + Math.max(0, Math.min(1, fraction)) * 270,
      actual: Number(needle?.style.transform.match(/rotate\(([-\d.]+)deg\)/)?.[1]) };
  }), CONTRACT.map(([id]) => id));
}
async function assertNeedles(page) {
  await expect.poll(async () => (await needleChecks(page)).every(row => Math.abs(row.actual - row.expected) < .001)).toBe(true);
}

test('all original native ranges plus Curls, complete parameter controls and runtime bounds remain accessible as knobs', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page); await ready(page);
  const d = await diagnostics(page), rows = await page.locator('input[type="range"]').evaluateAll(inputs => inputs.map(input => ({
    id: input.id, min: input.min, max: input.max, step: input.step, defaultValue: input.defaultValue,
    value: input.value, label: input.getAttribute('aria-label') || [...input.labels].map(label => label.textContent).join(' '),
    outputs: document.querySelectorAll(`output[for="${input.id}"]`).length,
    dials: input.parentElement.querySelectorAll(':scope > .mz-range-knob__dial').length,
    knob: input.parentElement.classList.contains('mz-range-knob'), tabIndex: input.tabIndex,
  })));
  expect(rows.map(row => row.id).sort()).toEqual(CONTRACT.map(([id]) => id).sort());
  for (const [id, min, fixedMax, step, defaultValue] of CONTRACT) {
    const row = rows.find(row => row.id === id), max = fixedMax ?? String(id === 'generations' ? d.generationLimits[d.parameters.lSystemType] : d.memoryVoiceCapacity);
    expect(row, id).toMatchObject({ min, max, step, defaultValue, outputs: 1, dials: 1, knob: true, tabIndex: 0 });
    expect(row.label.trim(), id).toBeTruthy();
    const input = await openControl(page, id), before = await input.inputValue();
    await input.click(); expect(await input.inputValue(), `${id}: taking hold must not jump`).toBe(before);
  }
  for (const id of ['source', 'inputSample', 'lSystemType', 'pitchDetail', 'masteringPreset', 'automatic', 'inputLoop',
    'compressorEnabled', 'autoMakeup', 'micButton', 'audioButton', 'sharedMidiToggle', 'panicButton', 'freezeButton', 'restartInput', 'stopInput',
    'resetGenerationRules', 'inputFile', 'outputBoostHint', 'pruningBiasGuide', 'generationCapacityInline']) {
    await expect(page.locator(`#${id}`), id).toHaveCount(1);
  }
  expect(await page.locator('#lSystemType option').evaluateAll(options => options.map(option => option.value).sort())).toEqual([...L_SYSTEM_TYPES].sort());
  expect(await page.locator('#inputSample option').count()).toBe(33);
  expect(await page.locator('#masteringPreset option').count()).toBe(8);
  await expect(page.locator('#voiceCeilingExact')).toHaveAttribute('max', String(d.memoryVoiceCapacity));
  await assertNeedles(page);
  // Attribute domains remain the existing authored contract even when memory
  // negotiation narrows the live generation/cap maxima.
  const served = await page.request.get('/l-mic-rust.html');
  expect(await served.text()).toContain('max="9007199254740991"');
  await save('knob-contract', { rows, generationLimits: d.generationLimits, memoryVoiceCapacity: d.memoryVoiceCapacity });
  await cleanup(page, evidence);
});

test('actual knob drags preserve native events, fine movement, keyboard endpoints and cancellation cleanup', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page); await ready(page);
  await inputValue(page, 'wet', .4); await clearEvents(page);
  let p = await beginDrag(page, 'wet');
  expect(await page.locator('#wet').inputValue()).toBe('0.4');
  for (const dy of [3, 6, 9, 12]) await page.mouse.move(p.x, p.y - dy);
  const held = await events(page, 'wet');
  expect(held.filter(e => e.type === 'input').length).toBeGreaterThanOrEqual(3);
  expect(held.every(e => e.native)).toBe(true); expect(held.some(e => e.type === 'change')).toBe(false);
  expect(Number(await page.locator('#wet').inputValue())).toBeCloseTo(.5, 8);
  await page.mouse.up(); expect((await events(page, 'wet')).filter(e => e.type === 'change')).toHaveLength(1);
  await inputValue(page, 'wet', .4); await clearEvents(page);
  await page.keyboard.down('Shift'); p = await beginDrag(page, 'wet'); await page.mouse.move(p.x, p.y - 12); await page.mouse.up(); await page.keyboard.up('Shift');
  expect(Number(await page.locator('#wet').inputValue())).toBeCloseTo(.41, 8);
  const fine = await events(page, 'wet');
  const input = await openControl(page, 'wet'); await input.focus();
  await page.keyboard.press('Home'); await expect(input).toHaveValue('0');
  await page.keyboard.press('ArrowRight'); await expect(input).toHaveValue('0.01');
  await page.keyboard.press('End'); await expect(input).toHaveValue('1');
  await page.keyboard.press('ArrowDown'); await expect(input).toHaveValue('0.99');
  const cancellations = [];
  for (const type of ['pointercancel', 'lostpointercapture']) {
    await inputValue(page, 'wet', .4); await clearEvents(page);
    p = await beginDrag(page, 'wet'); await page.mouse.move(p.x, p.y - 12);
    await input.evaluate((input, type) => {
      const pointerId = __knobsQa.pointers[input.id];
      if (type === 'lostpointercapture') input.releasePointerCapture(pointerId);
      else input.dispatchEvent(new PointerEvent(type, { pointerId, bubbles: true }));
    }, type);
    // The capture event is asynchronous in Chromium; wait for gesture commit.
    await expect.poll(async () => (await events(page, 'wet')).filter(e => e.type === 'change').length).toBe(1);
    const stopped = await input.inputValue(); await page.mouse.move(p.x, p.y - 24); await page.mouse.up();
    expect(await input.inputValue()).toBe(stopped);
    const log = await events(page, 'wet'); expect(log.filter(e => e.type === 'change')).toHaveLength(1);
    p = await beginDrag(page, 'wet'); await page.mouse.move(p.x, p.y - 12); await page.mouse.up();
    expect(Number(await input.inputValue())).toBeGreaterThan(Number(stopped)); cancellations.push({ type, stopped, log });
  }
  await inputValue(page, 'wet', .4); await clearEvents(page);
  p = await beginDrag(page, 'wet'); await page.mouse.move(p.x, p.y - 12);
  await page.locator('#dry').focus();
  const blurred = await input.inputValue(); await page.mouse.move(p.x, p.y - 24); await page.mouse.up();
  expect(await input.inputValue()).toBe(blurred);
  expect((await events(page, 'wet')).filter(e => e.type === 'change')).toHaveLength(0);
  p = await beginDrag(page, 'wet'); await page.mouse.move(p.x, p.y - 12); await page.mouse.up();
  expect(Number(await input.inputValue())).toBeGreaterThan(Number(blurred));
  cancellations.push({ type: 'individual control blur', stopped: blurred });
  await assertNeedles(page); await save('knob-native-interactions', { held, fine, cancellations });
  await cleanup(page, evidence);
});

test('log voice cap and exact editor reach the full existing device range without changing topology', async ({ page }) => {
  const evidence = await fixture(page); await ready(page);
  const cap = await openControl(page, 'voiceCeiling'), exact = page.locator('#voiceCeilingExact'), before = await diagnostics(page);
  const compiles = await page.evaluate(() => __knobsQa.compiles), max = String(before.memoryVoiceCapacity);
  await exact.fill('123457'); await exact.press('Enter');
  await expect.poll(async () => (await diagnostics(page)).performance.voiceCeiling).toBe(123457);
  await expect(cap).toHaveValue('123457'); await assertNeedles(page);
  await exact.fill(max); await exact.press('Enter'); await expect(cap).toHaveValue(max);
  await cap.focus(); await page.keyboard.press('Home'); await expect(cap).toHaveValue('0');
  await expect.poll(async () => (await diagnostics(page)).performance.voiceCeiling).toBe(0);
  const p = await beginDrag(page, 'voiceCeiling'); await page.mouse.move(p.x, p.y - 120, { steps: 12 }); await page.mouse.up();
  await expect(cap).toHaveValue(max); await expect.poll(async () => (await diagnostics(page)).performance.voiceCeiling).toBe(before.memoryVoiceCapacity);
  await expect(exact).toHaveValue(max);
  await exact.fill('17'); await exact.press('Escape'); await expect(exact).toHaveValue(max);
  await exact.fill(''); await exact.press('Enter'); await expect(exact).toHaveValue(max);
  await exact.fill('0'); await exact.press('Tab'); await expect(cap).toHaveValue('0');
  await expect.poll(async () => (await diagnostics(page)).performance.voiceCeiling).toBe(0);
  expect(await page.evaluate(() => __knobsQa.compiles)).toBe(compiles);
  await save('knob-full-voice-cap', { memoryVoiceCapacity: before.memoryVoiceCapacity, exactCount: 123457, noNewCeiling: true });
  await cleanup(page, evidence);
});

test('held depth and mix knob edits reach actual Rust before release while source, gains and sample clock continue', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page); await ready(page);
  await page.evaluate(async () => {
    const d = __knobsQa.engine.getDiagnostics();
    await __knobsQa.applyScene({ parameters: { ...d.parameters, generations: 1, intervalMs: 60, timeRatio: .8, depth: .6, pitchScale: 0 },
      performance: { ...d.performance, wet: .4, dry: .2 } });
  });
  for (const [id, value] of [['inputTrim', LIVE_GAINS[0]], ['level', LIVE_GAINS[1]], ['makeupDb', LIVE_GAINS[2]]]) await inputValue(page, id, value);
  await chooseInput(page, 'source', 'samples'); await chooseInput(page, 'inputSample', 'music-keys');
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.audio && d.input.playing && d.status.inputPeak > 1e-5 && Math.max(0, ...d.status.tapActivity) > 1e-5;
  }, { timeout: 20000 }).toBe(true);
  const before = await diagnostics(page), counts = await page.evaluate(() => ({ compiles: __knobsQa.compiles, sources: __knobsQa.sources.length, worklets: __knobsQa.nodes.length }));
  await page.evaluate(() => { __knobsQa.record = true; }); await clearEvents(page);
  const edits = [];
  for (const [id, path] of [['depth', 'parameters'], ['wet', 'performance'], ['dry', 'performance']]) {
    const p = await beginDrag(page, id), start = Number(await page.locator(`#${id}`).inputValue());
    for (const dy of [3, 6, 9, 12]) { await page.mouse.move(p.x, p.y - dy); await page.waitForTimeout(24); }
    const target = Number(await page.locator(`#${id}`).inputValue()); expect(target).toBeGreaterThan(start);
    await expect.poll(async () => (await diagnostics(page))[path][id]).toBe(target);
    const held = await events(page, id); expect(held.filter(e => e.type === 'input').length).toBeGreaterThan(1);
    expect(held.some(e => e.type === 'change')).toBe(false);
    const mid = await diagnostics(page); expect(mid.audio).toBe(true); expect(mid.contextGeneration).toBe(before.contextGeneration);
    expect(gainValues(mid)).toEqual(LIVE_GAINS); await page.mouse.up(); edits.push({ id, start, target, held, clock: mid.sampleClock });
  }
  await page.waitForTimeout(250); const after = await diagnostics(page);
  const captured = await page.evaluate(() => { __knobsQa.record = false; return { frames: __knobsQa.frames, compiles: __knobsQa.compiles, sources: __knobsQa.sources, worklets: __knobsQa.nodes.length }; });
  expect(captured.compiles).toBe(counts.compiles); expect(captured.sources).toHaveLength(counts.sources); expect(captured.worklets).toBe(counts.worklets);
  expect(captured.sources.every(source => source.started === 1 && source.stopped === 0)).toBe(true);
  expect(after.contextGeneration).toBe(before.contextGeneration); expect(after.sampleClock).toBeGreaterThan(before.sampleClock);
  expect(after.processedBlocks).toBeGreaterThan(before.processedBlocks); expect(gainValues(after)).toEqual(LIVE_GAINS);
  expect(captured.frames.length).toBeGreaterThan(5); expect(captured.frames.every(frame => frame.nonFinite === 0 && frame.peak <= 1)).toBe(true);
  expect(captured.frames.some(frame => frame.peak > 1e-5 && frame.tapPeak > 1e-5)).toBe(true);
  for (let i = 1; i < captured.frames.length; i++) expect(captured.frames[i].sampleTime).toBeGreaterThanOrEqual(captured.frames[i - 1].sampleTime);
  await assertNeedles(page);
  const wasmBuild = await (await page.request.get('/assets/wasm/l-system-delay-build.json')).json();
  await save('knob-live-rust', { before, after, edits, ...captured, wasmBuild, actualBundledRecording: true,
    analyserWindowsAreNotAClickTest: true, listeningPerformed: false });
  await page.locator('#audioButton').click(); await expect.poll(async () => (await diagnostics(page)).input.playing).toBe(false);
  await cleanup(page, evidence);
});

test('preset and mastering recall redraw every dial and preserve live gain values and all scene fields', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page); await ready(page);
  for (const [id, value] of [['inputTrim', LIVE_GAINS[0]], ['level', LIVE_GAINS[1]], ['makeupDb', LIVE_GAINS[2]]]) await inputValue(page, id, value);
  const expected = BANK.find(preset => preset.id === 'spruce-cutting'); expect(expected).toBeTruthy();
  await inputValue(page, 'generationAsymmetry', .31); await inputValue(page, 'mutation', .53);
  await openControl(page, 'masteringPreset'); await page.locator('#masteringPreset').selectOption('telephone');
  await expect.poll(async () => (await diagnostics(page)).performance.mastering.lowpassHz).toBeGreaterThan(0);
  await assertNeedles(page);
  const picker = page.locator('.instrument-preset-controls details'); await picker.locator('summary').click();
  await picker.locator(`button[data-preset-id="${expected.id}"]`).click();
  await expect.poll(async () => (await diagnostics(page)).parameters).toEqual(expected.snapshot.parameters);
  const d = await diagnostics(page);
  expect(d.performance.wet).toBe(expected.snapshot.performance.wet); expect(d.performance.dry).toBe(expected.snapshot.performance.dry);
  for (const [id, value] of Object.entries(expected.snapshot.performance.mastering)) expect(d.performance.mastering[id], id).toBe(value);
  expect(gainValues(d)).toEqual(LIVE_GAINS);
  await assertNeedles(page);
  const needles = await needleChecks(page);
  expect(needles.find(row => row.id === 'generationAsymmetry').value).toBe(expected.snapshot.parameters.asymmetry);
  expect(needles.find(row => row.id === 'mutation').value).toBe(expected.snapshot.parameters.mutation);
  // A scene recall also supersedes a knob's raw drag accumulator. Invoke the
  // real preset button handler while the actual mouse pointer is still held;
  // following moves from that old gesture must not overwrite the recalled mix.
  await clearEvents(page);
  const p = await beginDrag(page, 'wet'); await page.mouse.move(p.x, p.y - 12);
  await picker.locator(`button[data-preset-id="${expected.id}"]`).evaluate(button => button.click());
  await expect.poll(async () => (await diagnostics(page)).performance.wet).toBe(expected.snapshot.performance.wet);
  await page.mouse.move(p.x, p.y - 24); await page.mouse.up();
  await expect(page.locator('#wet')).toHaveValue(String(expected.snapshot.performance.wet));
  expect((await events(page, 'wet')).filter(event => event.type === 'change')).toHaveLength(0);
  await assertNeedles(page);
  await save('knob-preset-redraw', { presetId: expected.id, snapshot: d, needles, heldPresetRecallSupersededOldGesture: true });
  await cleanup(page, evidence);
});

test('compact knobs and every original control remain reachable in desktop, portrait and short landscape layouts', async ({ browser }) => {
  test.setTimeout(120000);
  const layouts = [];
  for (const [name, viewport, hasTouch] of [['desktop', { width: 1440, height: 900 }, false],
    ['portrait', { width: 390, height: 844 }, true], ['landscape', { width: 844, height: 390 }, true]]) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport, hasTouch, reducedMotion: 'reduce' }), page = await context.newPage();
    const evidence = await fixture(page); await ready(page);
    await page.evaluate(() => { for (const id of ['recursionSection', 'mixSection', 'masteringSection']) document.getElementById(id).open = true; });
    const controls = [];
    for (const [id] of CONTRACT) {
      const input = await openControl(page, id);
      const result = await input.evaluate(input => {
        const box = input.getBoundingClientRect(), label = input.parentElement.querySelector(':scope > span:first-child > b'), output = document.querySelector(`output[for="${input.id}"]`);
        const caption = label?.getBoundingClientRect(), readout = output?.getBoundingClientRect(), panelKnob = input.parentElement.classList.contains('native-knob-control');
        return { id: input.id, width: box.width, height: box.height,
          hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === input,
          // The existing menubar captions are intentionally visually hidden;
          // their accessible labels are covered by the native contract case.
          captionAbove: !panelKnob || !caption || caption.bottom <= box.top + 1,
          readoutBelow: !panelKnob || readout.top >= box.bottom,
          captionFits: !panelKnob || !label || label.scrollHeight <= label.clientHeight + 1,
          outputFits: !output || output.scrollWidth <= output.clientWidth + 1 };
      });
      expect(result.width, `${name}/${id}`).toBeGreaterThanOrEqual(hasTouch ? 48 : 44);
      expect(result.height, `${name}/${id}`).toBeGreaterThanOrEqual(hasTouch ? 48 : 44);
      expect(result.hit, `${name}/${id}: original native input is not occluded`).toBe(true);
      expect(result.captionAbove, `${name}/${id}: label overlaps target`).toBe(true);
      expect(result.readoutBelow, `${name}/${id}: readout overlaps target`).toBe(true);
      expect(result.captionFits, `${name}/${id}: clipped label`).toBe(true);
      expect(result.outputFits, `${name}/${id}: clipped readout`).toBe(true);
      controls.push(result);
    }
    await page.locator('#nativeSettings').evaluate(details => { details.open = false; });
    await page.locator('#recursionSection').scrollIntoViewIfNeeded();
    const footprint = await page.evaluate(() => ({ panel: { height: document.querySelector('.panel').clientHeight, scrollHeight: document.querySelector('.panel').scrollHeight },
      sections: Object.fromEntries(['recursionSection', 'mixSection', 'masteringSection'].map(id => [id, document.getElementById(id).getBoundingClientRect().height])),
      overflow: document.documentElement.scrollWidth - innerWidth, coarse: matchMedia('(pointer:coarse)').matches }));
    expect(footprint.overflow).toBeLessThanOrEqual(1); expect(footprint.coarse).toBe(hasTouch);
    for (const id of ['recursionSection', 'masteringSection']) await page.locator(`#${id}`).screenshot({ path: test.info().outputPath(`${name}-${id}.png`) });
    await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
    layouts.push({ name, viewport, controls, footprint }); await cleanup(page, evidence); await context.close();
  }
  const appResponse = await fetch(new URL(APP, test.info().project.use.baseURL));
  const appSha256 = createHash('sha256').update(Buffer.from(await appResponse.arrayBuffer())).digest('hex');
  await save('knob-layouts', { layouts, appSha256, physicalTouchDeviceTested: false, screenshotsAreBrowserRendered: true });
});

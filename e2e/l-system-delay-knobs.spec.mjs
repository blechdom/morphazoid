import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { RULE_MODES } from '../src/instruments/micmic/native/rule-modes.js';
import { SAMPLE_INPUT_OPTIONS } from '../src/instruments/micmic/native/input-source.js';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const APP = '/src/instruments/micmic/native/app.js';
const CONTRACT = [
  ['inputTrim', '0', '4', '0.01', '0.85'], ['level', '0', '1', '0.01', ''],
  ['voiceCeiling', '0', null, '1', '0'], ['capacityBudget', '1', null, '1', '1'], ['generations', '1', null, '1', '13'],
  ['pruningBias', '-1', '1', '0.01', '0'], ['depth', '0', '1', '0.01', '0.72'],
  ['interval', '0', '1000', 'any', '300'], ['timeRatio', '0.2', '2', '0.01', '0.72'],
  ['generationAngle', '0', '180', '0.5', '45'], ['generationPitchScale', '0', '4', '0.05', '1'],
  ['generationAsymmetry', '-0.8', '0.8', '0.01', '0'], ['mutation', '0', '1', '0.01', '0'],
  ['curls', '-8', '8', '0.01', '0'],
  ['branchProbability', '0', '1', '0.01', '0.65'],
  ['labLengthRatio', '0.2', '1.25', '0.01', '0.72'], ['labAngleIncrement', '-90', '90', '0.1', '0'],
  ['labDelayRatio', '0.2', '2', '0.01', '0.72'], ['labPitchRatio', '0.5', '2', '0.001', '1'],
  ['labBranchCount', '2', '6', '1', '2'], ['labMinLength', '0.001', '1', '0.001', '0.03'],
  ['labContextStrength', '0', '1', '0.01', '0.5'], ['labSymbolRatio', '0.25', '4', '0.01', '1.5'],
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

// A low-level, seamless file keeps the dense endpoint test independent of
// recorded attacks while decoding, playback, topology and Rust DSP remain real.
function seamlessWav() {
  const rate = 48000, frames = rate * 3, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / rate;
    bytes.writeInt16LE(Math.round((.025 * Math.sin(t * Math.PI * 2 * 173)
      + .012 * Math.sin(t * Math.PI * 2 * 257)) * 32767), 44 + frame * 2);
  }
  return bytes;
}

async function fixture(page, { seamlessInput = false } = {}) {
  const errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  if (seamlessInput) await page.route('**/assets/synthesis/loops/electric-piano.wav', route => route.fulfill({
    contentType: 'audio/wav', body: seamlessWav(),
  }));
  await page.addInitScript(() => {
    const qa = window.__knobsQa = { events: [], pointers: {}, compiles: 0, installs: 0, depthMessages: [],
      sources: [], nodes: [], frames: [], record: false, phase: '', microphoneRequests: 0 };
    for (const type of ['input', 'change']) document.addEventListener(type, event => {
      if (event.target.matches?.('input[type="range"]')) qa.events.push({ type, id: event.target.id,
        value: Number(event.target.value), native: event instanceof Event, trusted: event.isTrusted, now: performance.now() });
    }, true);
    document.addEventListener('pointerdown', event => { qa.pointers[event.target.id] = event.pointerId; }, true);
    if (navigator.mediaDevices?.getUserMedia) {
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => { qa.microphoneRequests++; return capture(...args); };
    }
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
        const post = node.port.postMessage.bind(node.port);
        node.port.postMessage = (data, ...rest) => {
          if (data.type === 'install') qa.installs++;
          if (data.type === 'depth') qa.depthMessages.push({ depth: data.depth, now: performance.now() });
          return post(data, ...rest);
        };
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
          phase: qa.phase, depth: d.parameters.depth, peak, nonFinite, inputPeak: d.status.inputPeak,
          tapPeak: Math.max(0, ...d.status.tapActivity), targetVoices: d.status.targetVoices,
          historyEnd: d.status.inputEnvelope.endTime, historyCount: d.status.inputEnvelope.values.length });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
__knobsQa.applyScene = applyScene;
__knobsQa.engine = browserEngine;
__knobsQa.view = () => ({ parameters: { ...previewParameters }, revision: visualRevision,
  nodes: geometry?.nodes.map(({ id, generation, priority, gain }) => ({ id, generation, priority, gain })) ?? [] });
` });
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
  // The stochastic-only range belongs to its grammar. Select it through the
  // actual menu so reachability checks exercise the performer-facing state.
  if (id === 'branchProbability' && !(await page.locator('#stochasticControls').isVisible())) {
    await page.locator('#lSystemType').selectOption('stochastic');
    await expect.poll(async () => (await diagnostics(page)).parameters.lSystemType).toBe('stochastic');
    await expect(page.locator('#stochasticControls')).toBeVisible();
    await expect(control).toBeEnabled();
  }
  if (id.startsWith('lab') && !(await control.isVisible())) {
    const kind = ['labContextStrength', 'labSymbolRatio'].includes(id) ? 'context' : 'parametric';
    await page.locator('#lSystemType').selectOption(`lab:${kind}`);
    await expect.poll(async () => (await diagnostics(page)).parameters.lab?.kind).toBe(kind);
    await expect(page.locator('#labRuleControls')).toBeVisible();
    await expect(control).toBeEnabled();
  }
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
    const fraction = ['voiceCeiling', 'capacityBudget'].includes(id) ? Math.log1p(value - min) / Math.log1p(max - min) : (value - min) / (max - min);
    const needle = input.parentElement.querySelector('.mz-range-knob__dial > i');
    return { id, value, expected: -135 + Math.max(0, Math.min(1, fraction)) * 270,
      actual: Number(needle?.style.transform.match(/rotate\(([-\d.]+)deg\)/)?.[1]) };
  }), CONTRACT.map(([id]) => id));
}
async function assertNeedles(page) {
  await expect.poll(async () => (await needleChecks(page)).every(row => Math.abs(row.actual - row.expected) < .001)).toBe(true);
}

async function assertDepth(page, depth) {
  const text = depth === 1 ? '100% · no decay' : `${Math.round(depth * 100)}%`;
  await expect(page.locator('#depth')).toHaveValue(String(depth));
  await expect(page.locator('#depth')).toHaveAttribute('aria-valuetext', text);
  await expect(page.locator('#depthOut')).toHaveText(text);
  await expect.poll(async () => (await diagnostics(page)).parameters.depth).toBe(depth);
  const native = await page.evaluate(() => __knobsQa.engine.request('/api/state'));
  expect(native.parameters.depth).toBe(depth);
  await expect.poll(async () => {
    const view = await page.evaluate(() => __knobsQa.view());
    return view.nodes.length > 1 && view.nodes.every(node => node.gain === (node.generation === 0 ? 1 : .5 * depth ** (node.generation * .72)));
  }).toBe(true);
  await assertNeedles(page);
}

async function captureScene(page) {
  return page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
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
  for (const id of ['source', 'inputSample', 'lSystemType', 'masteringPreset', 'automatic', 'inputLoop',
    'compressorEnabled', 'autoMakeup', 'micButton', 'audioButton', 'sharedMidiToggle', 'panicButton', 'freezeButton', 'restartInput', 'stopInput',
    'resetGenerationRules', 'inputFile', 'outputBoostHint', 'pruningBiasGuide', 'generationCapacityInline',
    'grammarSeed', 'grammarSeedOut', 'regrowGrammar', 'nextInputSample', 'nextLSystemType']) {
    await expect(page.locator(`#${id}`), id).toHaveCount(1);
  }
  expect(await page.locator('#lSystemType option').evaluateAll(options => options.map(option => option.value).sort())).toEqual([...RULE_MODES].sort());
  await expect(page.locator('#pitchDetail, #pitchDetailStatus')).toHaveCount(0);
  await expect(page.locator('#mixSection #masteringSection')).toHaveCount(1);
  await expect(page.locator('#masteringSection > summary')).toHaveCount(0);
  expect(await page.locator('#inputSample option').evaluateAll(options => options.map(option => option.value)))
    .toEqual(SAMPLE_INPUT_OPTIONS.map(option => option.id));
  expect(await page.locator('#masteringPreset option').count()).toBe(8);
  await expect(page.locator('#grammarSeed')).toHaveAttribute('type', 'number');
  await expect(page.locator('#grammarSeed')).toHaveAttribute('min', '0');
  await expect(page.locator('#grammarSeed')).toHaveAttribute('max', '4294967295');
  await expect(page.locator('#grammarSeed')).toHaveAttribute('step', '1');
  await expect(page.locator('#voiceCeilingExact')).toHaveAttribute('max', String(d.memoryVoiceCapacity));
  await assertNeedles(page);
  // Attribute domains remain the existing authored contract even when memory
  // negotiation narrows the live generation/cap maxima.
  const served = await page.request.get('/l-mic-rust.html');
  expect(await served.text()).toContain('max="9007199254740991"');
  await save('knob-contract', { rows, generationLimits: d.generationLimits, memoryVoiceCapacity: d.memoryVoiceCapacity });
  await cleanup(page, evidence);
});

test('Sample and L-system Next buttons wrap native choices without arming Audio or changing live gains', async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page); await ready(page);
  const before = await diagnostics(page), sampleIds = SAMPLE_INPUT_OPTIONS.map(option => option.id);
  await chooseInput(page, 'source', 'samples');
  await expect(page.locator('label[for="inputSample"]')).toHaveText('Sample');
  const samplePicker = page.locator('[data-select-id="inputSample"]');
  await expect(samplePicker.locator('summary')).toHaveAttribute('aria-label', /^Sample:/);
  await samplePicker.locator('summary').click();
  const list = samplePicker.locator('.instrument-picker-row');
  expect(await list.locator('button').allTextContents()).toEqual(SAMPLE_INPUT_OPTIONS.map(option =>
    option.label.replace(/\s+\((?:recorded|synthesized|synthetic voice|original)\)$/i, '')));
  await expect(list.locator('small, .instrument-picker-description')).toHaveCount(0);
  await expect(samplePicker.locator('.instrument-picker-group-label')).toHaveCount(0);
  await expect(page.locator('#inputSample optgroup')).toHaveCount(0);
  await samplePicker.locator('summary').click();
  await chooseInput(page, 'inputSample', sampleIds.at(-1));
  await page.locator('#nextInputSample').click();
  await expect.poll(async () => (await diagnostics(page)).input.sampleId).toBe(sampleIds[0]);
  await page.locator('#nextInputSample').click();
  await expect.poll(async () => (await diagnostics(page)).input.sampleId).toBe(sampleIds[1]);
  await expect(samplePicker.locator('summary')).toHaveAttribute('aria-label', `Sample: ${SAMPLE_INPUT_OPTIONS[1].label}`);
  await page.locator('#recursionSection').evaluate(details => { details.open = true; });
  const modes = await page.locator('#lSystemType option').evaluateAll(options => options.map(option => option.value));
  // The native select remains the event owner whether its presentation is the
  // browser control or the shared Choose menu.
  await page.locator('#lSystemType').selectOption(modes.at(-1), { force: true });
  await expect.poll(async () => (await diagnostics(page)).parameters.lab?.kind).toBe('sphinx');
  await page.locator('#nextLSystemType').click();
  await expect.poll(async () => (await diagnostics(page)).parameters.lSystemType).toBe(modes[0]);
  await expect.poll(async () => (await diagnostics(page)).parameters.lab).toBeUndefined();
  await page.locator('#nextLSystemType').click();
  await expect.poll(async () => (await diagnostics(page)).parameters.lSystemType).toBe(modes[1]);
  const after = await diagnostics(page);
  expect(after.audio).toBe(false); expect(after.connectionCount).toBe(0);
  expect(after.contextGeneration).toBe(before.contextGeneration);
  expect(after.input.playing).toBe(false); expect(after.microphoneEnabled).toBe(false);
  expect(gainValues(after)).toEqual(gainValues(before));
  // Observe the immediate transaction boundary in the same task that starts
  // recall. No synthetic waiting or replacement engine is needed to prove
  // that a Next click cannot alter the scene while its owner is applying it.
  const lock = await page.evaluate(async scene => {
    const applying = __knobsQa.applyScene(scene);
    const buttons = ['nextInputSample', 'nextLSystemType'].map(id => document.getElementById(id));
    const values = () => ['inputSample', 'lSystemType'].map(id => document.getElementById(id).value);
    const during = { disabled: buttons.map(button => button.disabled), beforeClicks: values() };
    for (const button of buttons) button.click();
    during.afterClicks = values();
    await applying;
    return during;
  }, { parameters: { ...after.parameters, generations: 2 }, performance: after.performance });
  expect(lock.disabled).toEqual([true, true]); expect(lock.afterClicks).toEqual(lock.beforeClicks);
  await expect(page.locator('#nextInputSample')).toBeEnabled();
  await expect(page.locator('#nextLSystemType')).toBeEnabled();
  const recalled = await diagnostics(page);
  expect(recalled.parameters.generations).toBe(2); expect(recalled.audio).toBe(false);
  expect(gainValues(recalled)).toEqual(gainValues(before));
  await save('sample-rule-next', { sampleIds, modes, before, after, lock, recalled });
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
    // Pending capture loss is delivered before the next native pointer event.
    // Horizontal movement leaves this vertical knob's value unchanged.
    if (type === 'lostpointercapture') await page.mouse.move(p.x + 1, p.y - 12);
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

test('100% no decay reaches dense wet-only Rust audio and recovers through held zero without rebuilding or losing history', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page, { seamlessInput: true }); await ready(page);
  await page.evaluate(async () => {
    const d = __knobsQa.engine.getDiagnostics();
    await __knobsQa.applyScene({ parameters: { ...d.parameters, lSystemType: 'pythagorean', generations: 8,
      intervalMs: 60, timeRatio: .8, depth: .6, pitchScale: .4 }, performance: { ...d.performance, wet: .65, dry: 0 } });
  });
  for (const [id, value] of [['inputTrim', LIVE_GAINS[0]], ['level', LIVE_GAINS[1]], ['makeupDb', LIVE_GAINS[2]]]) await inputValue(page, id, value);
  await chooseInput(page, 'source', 'samples'); await chooseInput(page, 'inputSample', 'music-keys');
  await expect.poll(async () => (await diagnostics(page)).input.pending).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.input.playing && d.sampleClock > 1.5 && d.status.inputPeak > 1e-5 && d.status.outputPeak > 1e-5;
  }, { timeout: 30000 }).toBe(true);
  const before = await diagnostics(page);
  expect(before.requestedVoices).toBeGreaterThanOrEqual(500);
  const counts = await page.evaluate(() => ({ compiles: __knobsQa.compiles, installs: __knobsQa.installs,
    sources: structuredClone(__knobsQa.sources), worklets: __knobsQa.nodes.length }));
  const control = await openControl(page, 'depth');
  await page.evaluate(() => { __knobsQa.record = true; __knobsQa.phase = 'keyboard-no-decay'; });
  await clearEvents(page); await control.focus(); await page.keyboard.press('End');
  await assertDepth(page, 1);
  const keyboard = await events(page, 'depth');
  expect(keyboard.some(event => event.type === 'input' && event.value === 1 && event.trusted)).toBe(true);
  await expect.poll(async () => (await diagnostics(page)).status.outputPeak).toBeGreaterThan(1e-5);
  await page.waitForTimeout(300);
  const full = await diagnostics(page), fullView = await page.evaluate(() => __knobsQa.view());
  expect(new Set(fullView.nodes.filter(node => node.generation > 0).map(node => node.generation)).size).toBe(8);
  const edits = [];
  for (const [target, dy] of [[0, 120], [1, -120]]) {
    await clearEvents(page);
    await page.evaluate(target => { __knobsQa.phase = target === 0 ? 'held-zero' : 'held-no-decay'; }, target);
    const p = await beginDrag(page, 'depth');
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(p.x, p.y + dy * step / 12); await page.waitForTimeout(24);
    }
    await assertDepth(page, target);
    const held = await events(page, 'depth');
    expect(held.filter(event => event.type === 'input').length).toBeGreaterThan(1);
    expect(held.some(event => event.type === 'change')).toBe(false);
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return target === 0 ? d.status.targetVoices === 0 && d.status.outputPeak < 1e-5
        : d.status.targetVoices > 0 && d.status.outputPeak > 1e-5;
    }).toBe(true);
    const d = await diagnostics(page), view = await page.evaluate(() => __knobsQa.view());
    expect(d.audio).toBe(true); expect(d.input.playing).toBe(true); expect(d.performance.dry).toBe(0);
    expect(gainValues(d)).toEqual(LIVE_GAINS); expect(d.contextGeneration).toBe(before.contextGeneration);
    expect(d.status.inputEnvelope.endTime).toBeGreaterThan(full.status.inputEnvelope.endTime);
    expect(d.status.inputEnvelope.values.length).toBeGreaterThanOrEqual(full.status.inputEnvelope.values.length);
    expect(view.nodes.map(node => [node.id, node.priority])).toEqual(fullView.nodes.map(node => [node.id, node.priority]));
    await page.waitForTimeout(300); await page.mouse.up();
    expect((await events(page, 'depth')).filter(event => event.type === 'change')).toHaveLength(1);
    edits.push({ target, held, diagnostics: d });
  }
  const after = await diagnostics(page), captured = await page.evaluate(() => {
    __knobsQa.record = false;
    return { frames: __knobsQa.frames, compiles: __knobsQa.compiles, installs: __knobsQa.installs,
      depthMessages: __knobsQa.depthMessages, sources: __knobsQa.sources, worklets: __knobsQa.nodes.length,
      microphoneRequests: __knobsQa.microphoneRequests };
  });
  expect(captured.compiles).toBe(counts.compiles); expect(captured.installs).toBe(counts.installs);
  expect(captured.sources).toEqual(counts.sources); expect(captured.sources).toEqual([{ started: 1, stopped: 0 }]);
  expect(captured.worklets).toBe(counts.worklets); expect(captured.worklets).toBe(1); expect(captured.microphoneRequests).toBe(0);
  expect(captured.depthMessages.some(message => message.depth === 0)).toBe(true);
  expect(captured.depthMessages.filter(message => message.depth === 1).length).toBeGreaterThanOrEqual(2);
  expect(after.contextState).toBe('running'); expect(after.connectionCount).toBe(1);
  expect(after.contextGeneration).toBe(before.contextGeneration); expect(after.sampleClock).toBeGreaterThan(full.sampleClock);
  expect(after.processedBlocks).toBeGreaterThan(full.processedBlocks); expect(after.error).toBeFalsy();
  expect(captured.frames.length).toBeGreaterThan(10);
  expect(captured.frames.every(frame => frame.nonFinite === 0 && frame.peak <= 1)).toBe(true);
  for (const phase of ['keyboard-no-decay', 'held-no-decay']) {
    expect(captured.frames.some(frame => frame.phase === phase && frame.depth === 1 && frame.peak > 1e-5 && frame.tapPeak > 1e-5)).toBe(true);
  }
  expect(captured.frames.some(frame => frame.phase === 'held-zero' && frame.depth === 0 && frame.targetVoices === 0 && frame.peak < 1e-5)).toBe(true);
  for (let i = 1; i < captured.frames.length; i++) {
    expect(captured.frames[i].sampleTime).toBeGreaterThanOrEqual(captured.frames[i - 1].sampleTime);
    expect(captured.frames[i].historyEnd).toBeGreaterThanOrEqual(captured.frames[i - 1].historyEnd);
    expect(captured.frames[i].historyCount).toBeGreaterThanOrEqual(captured.frames[i - 1].historyCount);
  }
  const wasmBuild = await (await page.request.get('/assets/wasm/l-system-delay-build.json')).json();
  await save('knob-no-decay-live-rust', { before, full, after, keyboard, edits, ...captured, wasmBuild,
    actualWasm: true, dryRootMuted: true, input: 'seamless two-sine WAV', listeningPerformed: false });
  await page.locator('#audioButton').click(); await expect.poll(async () => (await diagnostics(page)).input.playing).toBe(false);
  await cleanup(page, evidence);
});

test('100% no decay survives full scene JSON capture and recall while Audio stays off and live gains remain intact', async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page); await ready(page);
  for (const [id, value] of [['inputTrim', LIVE_GAINS[0]], ['level', LIVE_GAINS[1]], ['makeupDb', LIVE_GAINS[2]]]) await inputValue(page, id, value);
  const depth = await openControl(page, 'depth'); await depth.focus(); await page.keyboard.press('End');
  await assertDepth(page, 1);
  const saved = await captureScene(page);
  expect(saved.parameters.depth).toBe(1);
  await page.evaluate(scene => localStorage.setItem('morphazoid-no-decay-qa-scene', JSON.stringify(scene)), saved);
  await page.keyboard.press('Home'); await assertDepth(page, 0);
  await page.evaluate(async () => {
    await __knobsQa.applyScene(JSON.parse(localStorage.getItem('morphazoid-no-decay-qa-scene')));
    localStorage.removeItem('morphazoid-no-decay-qa-scene');
  });
  await assertDepth(page, 1); expect(await captureScene(page)).toEqual(saved);
  const recalled = await diagnostics(page);
  expect(recalled.parameters).toEqual(saved.parameters); expect(gainValues(recalled)).toEqual(LIVE_GAINS);
  expect(recalled.audio).toBe(false); expect(recalled.contextState).toBe('absent');
  expect(await page.evaluate(() => ({ sources: __knobsQa.sources, worklets: __knobsQa.nodes.length,
    microphoneRequests: __knobsQa.microphoneRequests }))).toEqual({ sources: [], worklets: 0, microphoneRequests: 0 });
  await save('knob-no-decay-scene-roundtrip', { saved, recalled, serializationApplySeam: true });
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
    await chooseInput(page, 'source', 'samples');
    await page.locator('#recursionSection').evaluate(details => { details.open = true; });
    const nextTargets = [];
    for (const id of ['nextInputSample', 'nextLSystemType']) {
      const button = page.locator(`#${id}`); await button.scrollIntoViewIfNeeded();
      const target = await button.evaluate(button => {
        const box = button.getBoundingClientRect();
        return { id: button.id, width: box.width, height: box.height,
          hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      });
      expect(target.width, `${name}/${id}`).toBeGreaterThanOrEqual(hasTouch ? 48 : 36);
      expect(target.height, `${name}/${id}`).toBeGreaterThanOrEqual(hasTouch ? 48 : 36);
      expect(target.hit, `${name}/${id}: Next stays reachable below the sticky row`).toBe(true);
      await button.click(); nextTargets.push(target);
    }
    await expect.poll(async () => (await diagnostics(page)).input.sampleId).toBe(SAMPLE_INPUT_OPTIONS[1].id);
    await expect.poll(async () => (await diagnostics(page)).parameters.lSystemType).toBe('plant');
    expect((await diagnostics(page)).audio).toBe(false);
    const depth = await openControl(page, 'depth'); await depth.focus(); await page.keyboard.press('End');
    await assertDepth(page, 1); expect((await diagnostics(page)).audio).toBe(false);
    await page.evaluate(() => { for (const id of ['recursionSection', 'mixSection']) document.getElementById(id).open = true; });
    const controls = [];
    for (const [id] of CONTRACT) {
      const input = await openControl(page, id);
      const result = await input.evaluate(input => {
        const box = input.getBoundingClientRect(), label = input.parentElement.querySelector(':scope > span:first-child > b');
        const output = input.closest('.native-voice-control')?.querySelector('input[type="number"]') ?? document.querySelector(`output[for="${input.id}"]`);
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
    await expect(page.locator('#recursionSection .parameter-cluster-title')).toHaveCount(0);
    const bank = await page.locator('#recursionSection .native-recursion-grid').evaluate(grid => {
      const box = grid.getBoundingClientRect(), labels = [...grid.querySelectorAll('.native-knob-control')]
        .filter(label => label.getBoundingClientRect().width > 0);
      const ordinary = labels.filter(label => !label.parentElement.classList.contains('mz-tap-tempo-field'));
      const widths = ordinary.map(label => label.getBoundingClientRect().width);
      return { controls: labels.map(label => label.htmlFor), width: box.width,
        minimumCellWidth: Math.min(...widths), maximumCellWidth: Math.max(...widths),
        contained: labels.every(label => { const cell = label.getBoundingClientRect(); return cell.left >= box.left - 1 && cell.right <= box.right + 1; }),
        firstRow: ['generations', 'pruningBias', 'depth'].map(id => document.getElementById(id).closest('label').getBoundingClientRect().top) };
    });
    expect(bank.contained, `${name}: every visible recursion knob stays in its bank`).toBe(true);
    expect(bank.minimumCellWidth, `${name}: labels and native targets have useful width`).toBeGreaterThanOrEqual(82);
    expect(bank.maximumCellWidth - bank.minimumCellWidth, `${name}: ordinary controls flow in even columns`).toBeLessThan(1);
    expect(Math.max(...bank.firstRow) - Math.min(...bank.firstRow), `${name}: common knobs share a continuous row`).toBeLessThan(1);
    const footprint = await page.evaluate(() => ({ panel: { height: document.querySelector('.panel').clientHeight, scrollHeight: document.querySelector('.panel').scrollHeight },
      sections: Object.fromEntries(['recursionSection', 'mixSection', 'masteringSection'].map(id => [id, document.getElementById(id).getBoundingClientRect().height])),
      overflow: document.documentElement.scrollWidth - innerWidth, coarse: matchMedia('(pointer:coarse)').matches }));
    expect(footprint.overflow).toBeLessThanOrEqual(1); expect(footprint.coarse).toBe(hasTouch);
    for (const id of ['recursionSection', 'masteringSection']) await page.locator(`#${id}`).screenshot({ path: test.info().outputPath(`${name}-${id}.png`) });
    await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
    layouts.push({ name, viewport, controls, nextTargets, bank, footprint }); await cleanup(page, evidence); await context.close();
  }
  const appResponse = await fetch(new URL(APP, test.info().project.use.baseURL));
  const appSha256 = createHash('sha256').update(Buffer.from(await appResponse.arrayBuffer())).digest('hex');
  await save('knob-layouts', { layouts, appSha256, physicalTouchDeviceTested: false, screenshotsAreBrowserRendered: true });
});

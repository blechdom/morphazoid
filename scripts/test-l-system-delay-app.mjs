#!/usr/bin/env node
// Build the Rust app first. Default QA uses no hardware; --native additionally
// exercises the real CPAL output at zero master level, never microphone capture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { timeFoldFromSlider } from '../src/instruments/micmic/micmic.js';
import { GENERATION_PRESET_KEYS } from '../src/instruments/micmic/native/model.js';
import { DEFAULT_MASTERING, MASTERING_PROFILES, MASTERING_LIMITS, cutoffFromSlider } from '../src/instruments/micmic/native/mastering.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const native = process.argv.includes('--native');
const artifacts = new URL('../artifacts/l-system-delay-app/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const child = spawn(`${root}src/instruments/micmic/rust/target/release/l-system-delay-app`,
  ['--port', '0', ...(native ? [] : ['--no-device'])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stderr.on('data', chunk => { logs += chunk; });
const backendAddress = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Native app did not start: ${logs}`)), 10000);
  child.once('error', reject);
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Native app exited ${code}: ${logs}`)); });
  child.stdout.on('data', chunk => {
    logs += chunk;
    const match = logs.match(/http:\/\/localhost:\d+\//);
    if (match) { clearTimeout(timer); resolve(match[0]); }
  });
});
const web = spawn('python3', ['scripts/dev-server.py', '--port', '0', '--strict-port',
  '--native-delay-port', new URL(backendAddress).port], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
web.stderr.on('data', chunk => { logs += chunk; });
const address = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Webapp did not start: ${logs}`)), 10000);
  web.once('error', reject);
  web.once('exit', code => { clearTimeout(timer); reject(new Error(`Webapp exited ${code}: ${logs}`)); });
  web.stdout.on('data', chunk => {
    const match = chunk.toString().match(/http:\/\/localhost:\d+\//);
    if (match) { clearTimeout(timer); resolve(match[0]); }
  });
});
const instrumentAddress = new URL('l-mic-rust.html', address).href;
const apiAddress = path => new URL(path.replace(/^\/api\//, '/api/l-system-delay/'), address);
const json = async (path, body) => {
  const response = await fetch(apiAddress(path), body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.error}`);
  return result;
};
const until = async (predicate, label, timeout = 5000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await json('/api/state');
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
let browser;
const report = { native, integratedWebapp: true, viewports: [], controlChecks: 0, live: [] };
try {
  const initial = await json('/api/state');
  assert.equal(initial.audio, false);
  assert.equal(initial.nodes.length, 16382);
  assert.equal(initial.performance.source, 'mic');
  assert.equal(initial.performance.voiceCeiling, 0);
  assert.deepEqual(initial.performance.mastering, DEFAULT_MASTERING);
  assert.equal(initial.status.gainReductionDb, 0);
  assert.ok(initial.generationLimits.pythagorean > 13);
  const forbidden = await fetch(apiAddress('/api/audio'), { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
    body: '{"enabled":true}' });
  assert.equal(forbidden.status, 403);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // Count actual Canvas subpaths so a recalled preset cannot pass while its
  // admitted descendants disappear from the drawing, including advanced trees.
  await page.addInitScript(() => {
    const NativePath = Path2D;
    window.Path2D = class extends NativePath {
      constructor(...args) { super(...args); this.presetSubpaths = []; }
      moveTo(...args) { this.presetSubpaths.push([args]); return super.moveTo(...args); }
      lineTo(...args) { this.presetSubpaths.at(-1)?.push(args); return super.lineTo(...args); }
    };
    const prototype = CanvasRenderingContext2D.prototype;
    const clear = prototype.clearRect, stroke = prototype.stroke;
    const colors = new Set(['#fff3d6', '#55d9ff', '#5fe8c4', '#7db4ff', '#c79bff', '#ff826f', '#e8c46b']);
    window.presetCanvasAudit = { frames: [], current: null };
    prototype.clearRect = function (...args) {
      if (this.canvas.id === 'stage') {
        const audit = window.presetCanvasAudit;
        if (audit.current) audit.frames.push(audit.current);
        if (audit.frames.length > 6) audit.frames.shift();
        audit.current = { presetId: document.querySelector('.instrument-preset-controls')?.dataset.presetId,
          coverage: 0, minimumPoints: Infinity };
      }
      return clear.apply(this, args);
    };
    prototype.stroke = function (path, ...args) {
      const frame = window.presetCanvasAudit.current;
      if (this.canvas.id === 'stage' && frame && colors.has(this.strokeStyle) && path?.presetSubpaths) {
        const branches = path.presetSubpaths.filter(points => points.length >= 2);
        frame.coverage += branches.length;
        for (const points of branches) frame.minimumPoints = Math.min(frame.minimumPoints, points.length);
      }
      return stroke.apply(this, arguments);
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(instrumentAddress);
  await page.waitForFunction(() => document.querySelector('.instrument-preset-controls')
    && document.getElementById('inputTrim') && !document.getElementById('audioButton').disabled);
  assert.equal(await page.locator('.instrument-picker-link[data-tool-id="micmic"]').first().getAttribute('href'), new URL('l-mic.html', address).href);
  assert.equal(await page.locator('.instrument-picker-link[data-tool-id="micmic-rust"]').first().getAttribute('href'), instrumentAddress);
  const setRange = async (id, value) => {
    await page.locator(`#${id}`).evaluate((input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  };
  const setChecked = async (id, checked) => {
    await page.locator(`#${id}`).evaluate((input, checked) => {
      input.checked = checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, checked);
  };
  await page.locator('.panel details.control-section').evaluateAll(nodes => {
    for (const node of nodes) node.open = true;
  });
  const parameterIds = { generations: 'generations', interval: 'intervalMs', timeRatio: 'timeRatio',
    depth: 'depth', mutation: 'mutation', generationAngle: 'angle', generationPitchScale: 'pitchScale',
    generationAsymmetry: 'asymmetry', spread: 'spread', pruningBias: 'pruningBias' };
  const ranges = await page.locator('input[type=range]').evaluateAll(inputs => inputs.map(input =>
    ({ id: input.id, min: Number(input.min), max: Number(input.max), initial: Number(input.value) })));
  for (const range of ranges.filter(range => parameterIds[range.id])) {
    // A functional gesture goes above the old13-generation cap; the maximum
    // memory-sized tree is intentionally not built by a UI regression test.
    const maximum = range.id === 'generations' ? Math.min(14, range.max) : range.max;
    for (const value of [range.min, maximum, range.initial]) {
      await setRange(range.id, value);
      const expected = range.id === 'interval' ? timeFoldFromSlider(value) : value;
      const state = await until(state => Math.abs(state.parameters[parameterIds[range.id]] - expected) < 1e-6, range.id);
      assert.equal(state.audio, false);
      report.controlChecks++;
    }
  }
  for (const [id, key, values] of [['frequency', 'frequency', [40, 1200, 173]],
    ['pulseRate', 'pulseRate', [.1, 12, 2]], ['wet', 'wet', [0, 1, .76]],
    ['dry', 'dry', [0, .5, 0]], ['inputTrim', 'inputGain', [0, 1.5, .85]]]) {
    for (const value of values) {
      await setRange(id, value);
      const state = await until(state => Math.abs(state.performance[key] - value) < 1e-6, id);
      assert.equal(state.audio, false);
      report.controlChecks++;
    }
  }
  const beforeMastering = await json('/api/status');
  const unchangedOutsideMastering = (state, before, label) => {
    assert.equal(state.audio, before.audio, `${label} preserves Audio`);
    assert.deepEqual(state.parameters, before.parameters, `${label} preserves the tree`);
    const { mastering: currentMastering, ...current } = state.performance;
    const { mastering: previousMastering, ...previous } = before.performance;
    assert.deepEqual(current, previous, `${label} preserves mix, input and device policy`);
  };
  report.masteringProfiles = [];
  for (const profile of MASTERING_PROFILES) {
    await page.locator('#masteringPreset').selectOption(profile.id);
    const state = await until(state => Object.entries(profile.settings).every(([key, value]) =>
      typeof value === 'number' ? Math.abs(state.performance.mastering[key] - value) < 1e-4
        : state.performance.mastering[key] === value), `mastering ${profile.label}`);
    unchangedOutsideMastering(state, beforeMastering, profile.label);
    assert.equal(await page.locator('#masteringPreset').inputValue(), profile.id);
    assert.ok((await page.locator('#gainReductionOut').textContent()).includes('0'), 'Idle reduction meter reports zero');
    report.masteringProfiles.push(profile.label);
  }
  report.masteringControls = [];
  for (const [id, bounds] of Object.entries(MASTERING_LIMITS)) {
    const range = await page.locator(`#${id}`).evaluate(input => ({
      min: Number(input.min), max: Number(input.max), initial: Number(input.value),
    }));
    for (const value of [range.min, range.max, range.initial]) {
      await setRange(id, value);
      const expected = ['inputHighpassHz', 'highpassHz', 'lowpassHz'].includes(id)
        ? cutoffFromSlider(value, bounds[1], id === 'lowpassHz') : value;
      const state = await until(state => Math.abs(state.performance.mastering[id] - expected) < 1e-3,
        `mastering ${id}=${expected}`);
      unchangedOutsideMastering(state, beforeMastering, id);
      assert.ok((await page.locator(`#${id}Out`).textContent()).trim().length > 0, `${id} displays physical units`);
      report.controlChecks++;
    }
    report.masteringControls.push(id);
  }
  for (const id of ['compressorEnabled', 'autoMakeup']) {
    for (const checked of [false, true]) {
      await setChecked(id, checked);
      const state = await until(state => state.performance.mastering[id] === checked, `mastering ${id}=${checked}`);
      unchangedOutsideMastering(state, beforeMastering, id);
      report.controlChecks++;
    }
    report.masteringControls.push(id);
  }
  // Native validation must reject a malformed nested setting atomically. A
  // rejected edit cannot silently clear the tree, mix or existing master bus.
  const validPerformance = (await json('/api/status')).performance;
  report.invalidMasteringChecks = [];
  for (const invalid of [{ mastering: { ...validPerformance.mastering, ratio: 0 } },
    { mastering: { ...validPerformance.mastering, lowpassHz: 20001 } }, { mastering: null },
    { mastering: { ...validPerformance.mastering, compressorEnabled: 'yes' } }]) {
    const response = await fetch(apiAddress('/api/performance'), { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validPerformance, ...invalid }) });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
    assert.deepEqual((await json('/api/status')).performance, validPerformance);
    assert.equal((await json('/api/status')).audio, false);
    report.invalidMasteringChecks.push(invalid);
  }
  // A telemetry fixture checks the meter's positive dB convention and idle
  // clearing without opening a physical device; Rust tests verify real gain.
  await setRange('lowpassHz', 999);
  await until(state => state.performance.mastering.lowpassHz === 20000 && !state.error, 'maximum requested LPF');
  // A poll may surface one of the deliberately rejected API edits. Acknowledge
  // its normal recovery popup before continuing actual pointer interactions.
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('audioError').hidden);
  let telemetrySampleRate = 48000;
  await page.route('**/api/l-system-delay/status', async route => {
    const upstream = await route.fetch(), state = await upstream.json();
    await route.fulfill({ response: upstream, json: { ...state, audio: true,
      status: { ...state.status, sampleRate: telemetrySampleRate, gainReductionDb: 7.3 } } });
  });
  await page.waitForFunction(() => document.getElementById('gainReductionOut').textContent === '7.3 dB');
  assert.equal((await json('/api/status')).audio, false, 'Meter fixture never arms native Audio');
  telemetrySampleRate = 8000;
  await page.waitForFunction(() => /3[,.]?600/.test(document.getElementById('lowpassHzOut').textContent));
  assert.match(await page.locator('#lowpassHz').getAttribute('title'), /20[,.]?000.*requested/i);
  assert.match(await page.locator('#lowpassHz').getAttribute('aria-valuetext'), /20[,.]?000.*requested/i);
  assert.equal((await json('/api/status')).performance.mastering.lowpassHz, 20000, 'Sample-rate clamp preserves the requested cutoff');
  await page.unroute('**/api/l-system-delay/status');
  await page.waitForFunction(() => document.getElementById('gainReductionOut').textContent === '0.0 dB');
  await page.waitForFunction(() => /20[,.]?000/.test(document.getElementById('lowpassHzOut').textContent));
  assert.equal(await page.locator('#lowpassHz').getAttribute('title'), null, 'Idle display clears the device clamp annotation');
  report.masteringMeterTelemetryFixture = { reductionDb: 7.3, idleDb: 0, nativeAudio: false,
    sampleRate: 8000, requestedCutoffHz: 20000, effectiveCutoffHz: 3600 };
  // Capture through the real shared preset adapter, not a parallel QA model.
  const captured = await page.evaluate(async () => {
    const { captureHeaderPresetState } = await import('./src/site/header-presets.js');
    return captureHeaderPresetState().snapshot;
  });
  assert.deepEqual(captured.performance.mastering, (await json('/api/status')).performance.mastering);
  report.masteringCaptured = captured.performance.mastering;
  const types = await page.locator('#lSystemType option').evaluateAll(options => options.map(option => option.value));
  assert.equal(types.length, 11);
  for (const type of types) {
    await page.locator('#lSystemType').selectOption(type);
    const state = await until(state => state.parameters.lSystemType === type, `grammar ${type}`);
    assert.equal(state.audio, false);
    assert.ok(state.nodes.length > 0);
    assert.ok(state.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.delay)));
  }
  await page.locator('[data-reset-all]').click();
  await until(state => state.parameters.intervalMs === 240 && state.parameters.angle === 45
    && state.parameters.lSystemType === 'pythagorean', 'reset');
  await page.locator('.panel details.control-section').evaluateAll(nodes => {
    for (const node of nodes) node.open = true;
  });
  // A slow API must not turn a continuous shape gesture into a returned-JSON jump.
  await page.route('**/api/l-system-delay/parameters', async route => {
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });
  const imageHash = () => page.locator('#stage').evaluate(canvas => {
    const sample = document.createElement('canvas'); sample.width = 128; sample.height = 128;
    const context = sample.getContext('2d'); context.drawImage(canvas, 0, 0, 128, 128);
    let hash = 2166136261;
    for (const value of context.getImageData(0, 0, 128, 128).data) hash = Math.imul(hash ^ value, 16777619);
    return hash >>> 0;
  });
  await page.waitForTimeout(200);
  const previousImage = await imageHash();
  await setRange('generationAngle', 75);
  const frames = [];
  for (let index = 0; index < 5; index++) {
    await page.waitForTimeout(30); frames.push(await imageHash());
  }
  assert.equal((await json('/api/status')).parameters.angle, 45, 'Fixture API is still waiting');
  assert.ok(frames.some(hash => hash !== previousImage), 'Drawing responds before HTTP completes');
  assert.ok(new Set(frames).size >= 3, 'Continuous gesture paints intermediate shape frames');
  await until(state => state.parameters.angle === 75, 'latest slider value reaches native engine');
  await page.unroute('**/api/l-system-delay/parameters');
  report.visualFrames = frames;
  const stage = page.locator('#stage');
  await stage.focus();
  const before = await json('/api/status');
  await stage.press('ArrowRight');
  await until(state => state.parameters.intervalMs > before.parameters.intervalMs, 'keyboard gesture');
  await stage.press('Enter');
  assert.equal((await json('/api/status')).audio, false);
  const presets = await page.locator('[data-generation-preset]').evaluateAll(buttons => buttons.map(button => button.dataset.generationPreset));
  assert.equal(presets.length, 26);
  const bank = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
  assert.deepEqual(new Set(presets), new Set(bank.map(preset => preset.id)));
  // Both preset surfaces are tested with Audio off. Full scenes intentionally
  // recall factory level; hardware QA restores master zero before enabling Audio.
  await page.locator('#seedSection').evaluate(node => { node.open = true; });
  await page.locator('#source').selectOption('seed');
  await until(state => state.performance.source === 'seed', 'preset fixture test-tone selection');
  await page.locator('#seedPauseButton').click();
  await until(state => state.performance.frozen, 'preset fixture paused input');
  await page.locator('#automatic').evaluate(input => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await setRange('voiceCeiling', 128);
  await setRange('frequency', 311);
  await setRange('pulseRate', .7);
  await setRange('level', .22);
  await setRange('pruningBias', -.61);
  await setRange('spread', .31);
  await page.locator('#lSystemType').selectOption('dragon');
  const warm = MASTERING_PROFILES.find(profile => profile.label === 'Warm');
  await page.locator('#masteringPreset').selectOption(warm.id);
  const presetFixture = await until(state => !state.performance.automatic && state.performance.voiceCeiling === 128
    && state.performance.frequency === 311 && state.performance.pulseRate === .7 && state.performance.level === Math.fround(.22)
    && state.parameters.pruningBias === -.61 && state.parameters.spread === .31 && state.parameters.lSystemType === 'dragon'
    && Object.entries(warm.settings).every(([key, value]) => state.performance.mastering[key] === value),
  'complete preset fixture').catch(async error => {
    const state = await json('/api/status');
    throw new Error(`${error.message}: ${JSON.stringify({ parameters: state.parameters, performance: state.performance, error: state.error })}`);
  });
  const assertLivePresetState = (state, label) => {
    assert.equal(state.audio, false, `${label} preserves Audio off`);
    for (const key of ['source', 'frozen', 'frequency', 'pulseRate', 'voiceCeiling', 'automatic']) {
      assert.equal(state.performance[key], presetFixture.performance[key], `${label} preserves ${key}`);
    }
  };
  report.quickPresetChecks = [];
  for (const id of presets) {
    const preset = bank.find(preset => preset.id === id), before = await json('/api/status');
    const expected = { ...before.parameters };
    for (const key of GENERATION_PRESET_KEYS) expected[key] = preset.snapshot.parameters[key];
    await page.locator(`[data-generation-preset="${id}"]`).click();
    const recalled = await until(state => Object.entries(expected).every(([key, value]) => state.parameters[key] === value), `quick ${id}`);
    assert.deepEqual(recalled.parameters, expected, `${id} recalls exactly eight growth fields`);
    assert.deepEqual(recalled.performance, before.performance, `${id} keeps the complete current mix and input policy`);
    assertLivePresetState(recalled, id);
    report.quickPresetChecks.push(id);
  }
  report.fullPresetChecks = [];
  report.fullPresetCanvas = [];
  for (const preset of bank) {
    await page.locator('.instrument-preset-controls summary').click();
    await page.locator(`.instrument-preset-controls button[data-full-preset][data-preset-id="${preset.id}"]`).click();
    const recalled = await until(state => Object.entries(preset.snapshot.parameters).every(([key, value]) => state.parameters[key] === value)
      && Object.entries(preset.snapshot.performance).every(([key, value]) => key === 'mastering'
        ? Object.entries(value).every(([field, setting]) => typeof setting === 'number'
          ? Math.abs(state.performance.mastering[field] - setting) < 1e-4 : state.performance.mastering[field] === setting)
        : state.performance[key] === Math.fround(value)), `full ${preset.id}`);
    assert.deepEqual(recalled.parameters, preset.snapshot.parameters, `${preset.id} recalls every musical parameter`);
    for (const [key, value] of Object.entries(preset.snapshot.performance)) {
      if (key === 'mastering') assert.deepEqual(recalled.performance.mastering, DEFAULT_MASTERING, `${preset.id} recalls Original mastering`);
      else assert.equal(recalled.performance[key], Math.fround(value), `${preset.id} recalls ${key} at native float32 precision`);
    }
    assertLivePresetState(recalled, preset.id);
    await page.waitForFunction(id => document.querySelector('.instrument-preset-controls').getAttribute('aria-busy') !== 'true'
      && document.querySelector('.instrument-preset-controls').dataset.presetId === id, preset.id);
    assert.equal(await page.locator('#presetSummary').textContent(), preset.label.split(' · ')[0], `${preset.id} keeps its named growth summary`);
    assert.equal(await page.locator(`[data-generation-preset="${preset.id}"]`).getAttribute('aria-pressed'), 'true', `${preset.id} highlights its selected quick button`);
    const expectedCoverage = 1 + Math.min(48, recalled.eligibleVoices);
    await page.waitForFunction(({ id, expected }) => window.presetCanvasAudit.frames.some(frame =>
      frame.presetId === id && frame.coverage === expected), { id: preset.id, expected: expectedCoverage });
    const rendered = await page.evaluate(id => window.presetCanvasAudit.frames.findLast(frame => frame.presetId === id), preset.id);
    assert.equal(rendered.coverage, expectedCoverage, `${preset.id} draws every admitted segment`);
    assert.ok(rendered.minimumPoints >= 6, `${preset.id} retains the original five branch intervals`);
    report.fullPresetCanvas.push({ id: preset.id, generations: recalled.parameters.generations,
      eligibleVoices: recalled.eligibleVoices, coverage: rendered.coverage, minimumPoints: rendered.minimumPoints });
    assert.equal(await page.locator('#level').inputValue(), '0.48', `${preset.id} paints its factory output level`);
    assert.equal(await page.locator('#pruningBias').inputValue(), String(preset.snapshot.parameters.pruningBias), `${preset.id} paints raw pruning`);
    report.fullPresetChecks.push(preset.id);
  }
  const bamboo = bank.find(preset => preset.id === 'clean');
  await page.locator('.instrument-preset-controls summary').click();
  await page.locator('.instrument-preset-controls button[data-full-preset][data-preset-id="clean"]').click();
  await page.waitForFunction(() => document.querySelector('.instrument-preset-controls').getAttribute('aria-busy') !== 'true'
    && document.querySelector('.instrument-preset-controls').dataset.presetId === 'clean');
  const beforeReload = await json('/api/status');
  await setRange('generationAngle', 73);
  await until(state => state.parameters.angle === 73, 'edit a recalled full preset');
  await page.locator('#resetGenerationRules').click();
  const reloaded = await until(state => GENERATION_PRESET_KEYS.every(key => state.parameters[key] === bamboo.snapshot.parameters[key]), 'reload the selected Bamboo growth');
  assert.deepEqual(reloaded.parameters, beforeReload.parameters, 'Reload selected preset returns the last full recall, not an earlier quick scene');
  assert.deepEqual(reloaded.performance, beforeReload.performance, 'Growth reload preserves the recalled mix and live input policy');
  assertLivePresetState(reloaded, 'Bamboo reload');
  assert.equal(await page.locator('#presetSummary').textContent(), 'Bamboo Shoot');
  assert.equal(await page.locator('[data-generation-preset="clean"]').getAttribute('aria-pressed'), 'true');
  report.presetReload = 'Bamboo full recall → edit → reload preserves its grammar, mix and input policy';
  await page.locator('#seedPauseButton').click();
  await until(state => !state.performance.frozen, 'restore input after preset tests');
  await page.locator('#automatic').evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await setRange('voiceCeiling', 0);
  await until(state => state.performance.automatic && state.performance.voiceCeiling === 0, 'restore uncapped adaptive preset policy');
  await page.getByRole('button', { name: 'Next full-instrument preset', exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Randomize instrument parameters', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal((await json('/api/status')).audio, false);
  await page.locator('#seedSection').evaluate(node => { node.open = true; });
  await page.locator('#source').selectOption('mic');
  await until(state => state.performance.source === 'mic', 'explicit mic selection with audio off');
  assert.equal((await json('/api/status')).audio, false);
  await page.locator('#source').selectOption('seed');
  await until(state => state.performance.source === 'seed', 'restore seed');
  await page.locator('[data-reset-all]').click();
  await until(state => state.parameters.intervalMs === 240 && state.parameters.lSystemType === 'pythagorean', 'restore default tree');
  await page.locator('#automatic').evaluate(input => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await setRange('voiceCeiling', 128);
  await until(state => !state.performance.automatic && state.performance.voiceCeiling === 128, 'manual ceiling');
  await page.locator('#automatic').evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await setRange('voiceCeiling', 0);
  await until(state => state.performance.automatic && state.performance.voiceCeiling === 0, 'automatic without a user ceiling');
  if (!native) {
    await page.locator('#audioButton').click();
    await until(state => !state.audio && Boolean(state.error), 'failed device enable stays off');
    await page.waitForFunction(() => document.getElementById('audioButton').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#audioButton').getAttribute('aria-pressed'), 'false');
  }
  await page.goto('about:blank');
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.instrument-preset-controls')
    && document.getElementById('inputTrim') && !document.getElementById('audioButton').disabled);
  await setRange('generationAngle', 65);
  await until(state => state.parameters.angle === 65, 'controls work after browser Back');
  assert.equal((await json('/api/status')).audio, false, 'Returning never arms audio');
  report.browserBack = true;
  await page.locator('.panel details.control-section').evaluateAll(nodes => {
    for (const node of nodes) node.open = false;
  });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.panel').evaluate(node => { node.scrollTop = 0; });
    await page.waitForTimeout(200);
    const layout = await page.evaluate(() => ({
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      stage: (() => { const r = document.getElementById('stage').getBoundingClientRect(); return { width: r.width, height: r.height }; })(),
      button: (() => { const r = document.getElementById('audioButton').getBoundingClientRect(); return { width: r.width, height: r.height }; })(),
    }));
    assert.ok(layout.scrollWidth <= viewport.width + 1, `Horizontal overflow at ${viewport.width}`);
    assert.ok(layout.stage.width > 200 && layout.stage.height > 150);
    assert.ok(layout.button.width >= 44 && layout.button.height >= 44);
    await page.screenshot({ path: fileURLToPath(new URL(`${viewport.width}x${viewport.height}.png`, artifacts)), fullPage: true });
    await page.locator('#masteringSection').evaluate(node => { node.open = true; });
    const reachable = [];
    for (const id of ['masteringPreset', ...report.masteringControls, 'gainReductionOut']) {
      const control = page.locator(`#${id}`);
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `${id} has a visible control at ${viewport.width}`);
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1, `${id} fits width at ${viewport.width}`);
      assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1, `${id} is scroll-reachable at ${viewport.width}`);
      reachable.push(id);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `Open mastering section has no horizontal overflow at ${viewport.width}`);
    await page.screenshot({ path: fileURLToPath(new URL(`mastering-${viewport.width}x${viewport.height}.png`, artifacts)), fullPage: true });
    layout.masteringControlsReachable = reachable;
    await page.locator('#masteringSection').evaluate(node => { node.open = false; });
    report.viewports.push({ ...viewport, ...layout });
  }
  assert.deepEqual(errors, [], 'Browser runtime errors');
  // Touch emulation checks actual coarse-pointer styling and drag ownership.
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true });
  const touchPage = await touchContext.newPage();
  await touchPage.goto(instrumentAddress);
  await touchPage.waitForFunction(() => document.querySelector('.instrument-preset-controls')
    && document.getElementById('inputTrim') && !document.getElementById('audioButton').disabled);
  const touchSize = await touchPage.locator('#audioButton').boundingBox();
  assert.ok(touchSize.width >= 48 && touchSize.height >= 48, 'Coarse-pointer Audio target');
  const treeBeforeTouch = await json('/api/status');
  const touchTree = await touchPage.locator('#stage').boundingBox();
  const touchPoint = { x: touchTree.x + touchTree.width * .4, y: touchTree.y + touchTree.height * .5 };
  const touchSession = await touchContext.newCDPSession(touchPage);
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove',
    touchPoints: [{ x: touchPoint.x + 25, y: touchPoint.y - 20 }] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const touched = await until(state => state.parameters.intervalMs !== treeBeforeTouch.parameters.intervalMs,
    'touch canvas updates the model');
  assert.equal(touched.audio, false, 'Touch gestures never arm Audio');
  const accessibility = await new AxeBuilder({ page: touchPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(accessibility.violations, [], 'Closed native interface accessibility');
  await touchPage.locator('#masteringSection').evaluate(node => { node.open = true; });
  await touchPage.locator('#masteringPreset').scrollIntoViewIfNeeded();
  const masteringAccessibility = await new AxeBuilder({ page: touchPage })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(masteringAccessibility.violations, [], 'Open mastering controls accessibility');
  report.touchAudioTarget = touchSize;
  report.accessibilityViolations = accessibility.violations.length;
  report.masteringAccessibilityViolations = masteringAccessibility.violations.length;
  await touchContext.close();
  // Restore the main page's latest local state after the separate touch client.
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.instrument-preset-controls')
    && document.getElementById('inputTrim') && !document.getElementById('audioButton').disabled);
  await page.locator('[data-reset-all]').click();
  await until(state => state.parameters.angle === 45 && state.parameters.intervalMs === 240,
    'restore after touch');
  console.log(`Audio-off interface passed: ${report.controlChecks} control checks, ${report.masteringProfiles.length} mastering profiles, ${report.viewports.length} viewports.`);
  if (native) {
    await page.locator('.panel details.control-section').evaluateAll(nodes => {
      for (const node of nodes) node.open = true;
    });
    // The real device smoke test is deliberately silent. It still runs Seed,
    // the delay pool, adaptation, and CPAL at the device's actual sample rate.
    await setRange('level', 0);
    await until(state => state.performance.level === 0, 'silent output');
    await page.locator('#audioButton').click();
    const started = await until(state => state.audio && state.status.sampleRate > 0, 'native audio start');
    assert.equal(started.status.inputDevice, null);
    report.live.push(started.status);
    for (let index = 0; index < 35; index++) {
      await page.waitForTimeout(1000);
      const state = await json('/api/status');
      assert.equal(state.audio, true, state.error || 'Native audio stopped');
      assert.equal(state.performance.source, 'seed');
      assert.equal(state.status.inputDevice, null);
      assert.equal(state.status.outputPeak, 0);
      assert.equal(state.status.wetBusGain, 0, 'Muted master also mutes descendant display activity');
      assert.equal(state.status.topologyRevision, state.topologyRevision, 'Published meters belong to the rendered topology');
      assert.equal(state.status.tapActivity.length, state.status.tapVoiceIndices.length);
      assert.ok(state.status.tapActivity.length <= 2048, 'Preview metering remains bounded independently of audio capacity');
      report.live.push(state.status);
    }
    assert.ok(report.live.some(status => status.tapActivity.some(level => level > 0)), 'Silent output still measures real internal tap audio');
    assert.ok(Math.max(...report.live.map(status => status.voiceLimit)) > 48, 'Measured spare capacity should grow the budget');
    const beforeLiveMastering = await json('/api/status');
    const compressionFixture = { ...beforeLiveMastering.performance, source: 'seed', level: 0,
      wet: 0, dry: .5, inputGain: 1.5, frequency: 173, pulseRate: 12,
      mastering: { ...DEFAULT_MASTERING, thresholdDb: -36, ratio: 8, kneeDb: 3, autoMakeup: false } };
    await page.locator('#masteringPreset').selectOption('original');
    for (const [id, value] of [['wet', 0], ['dry', .5], ['inputTrim', 1.5], ['frequency', 173],
      ['pulseRate', 12], ['thresholdDb', -36], ['ratio', 8], ['kneeDb', 3]]) await setRange(id, value);
    await setChecked('autoMakeup', false);
    await until(state => Object.entries(compressionFixture.mastering).every(([key, value]) => state.performance.mastering[key] === value)
      && state.performance.wet === 0 && state.performance.dry === .5 && state.performance.inputGain === 1.5
      && state.performance.pulseRate === 12, 'live compression fixture controls');
    const compressed = await until(state => state.status.gainReductionDb > 1, 'real native compressor reduction');
    assert.equal(compressed.audio, true);
    assert.equal(compressed.performance.level, 0);
    assert.equal(compressed.status.inputDevice, null);
    assert.equal(compressed.status.outputPeak, 0);
    assert.ok(compressed.status.elapsedSeconds >= beforeLiveMastering.status.elapsedSeconds);
    report.liveMastering = { gainReductionDb: compressed.status.gainReductionDb,
      elapsedBefore: beforeLiveMastering.status.elapsedSeconds, profiles: [], controls: [] };
    const liveMasteringSafety = (state, before, label) => {
      assert.equal(state.audio, true, `${label} preserves live Audio`);
      assert.equal(state.performance.level, 0, `${label} preserves silent output`);
      assert.equal(state.performance.source, 'seed', `${label} never selects the microphone`);
      assert.equal(state.status.inputDevice, null);
      assert.equal(state.status.outputPeak, 0);
      assert.ok(state.status.elapsedSeconds >= before.status.elapsedSeconds, `${label} preserves the sample clock`);
      assert.deepEqual(state.parameters, before.parameters, `${label} preserves the audio topology`);
    };
    for (const profile of MASTERING_PROFILES) {
      const before = await json('/api/status');
      await page.locator('#masteringPreset').selectOption(profile.id);
      const state = await until(state => Object.entries(profile.settings).every(([key, value]) =>
        state.performance.mastering[key] === value), `live ${profile.label} mastering`);
      liveMasteringSafety(state, before, profile.label);
      report.liveMastering.profiles.push(profile.label);
    }
    for (const [id, value] of [['inputHighpassHz', 625], ['highpassHz', 420], ['lowpassHz', 740],
      ['thresholdDb', -30], ['kneeDb', 8], ['ratio', 6], ['attackMs', 20], ['releaseMs', 280], ['makeupDb', 3]]) {
      const before = await json('/api/status');
      await setRange(id, value);
      const expected = ['inputHighpassHz', 'highpassHz', 'lowpassHz'].includes(id)
        ? cutoffFromSlider(value, MASTERING_LIMITS[id][1], id === 'lowpassHz') : value;
      const state = await until(state => Math.abs(state.performance.mastering[id] - expected) < 1e-6, `live ${id}`);
      liveMasteringSafety(state, before, id);
      report.liveMastering.controls.push(id);
    }
    const beforeBypass = await json('/api/status');
    await setChecked('compressorEnabled', false);
    const bypassed = await until(state => !state.performance.mastering.compressorEnabled
      && state.status.gainReductionDb < .01, 'native compressor bypass clears reduction');
    liveMasteringSafety(bypassed, beforeBypass, 'Compressor bypass');
    report.liveMastering.bypassGainReductionDb = bypassed.status.gainReductionDb;
    const restoreProfile = MASTERING_PROFILES.find(profile => Object.entries(profile.settings)
      .every(([key, value]) => beforeLiveMastering.performance.mastering[key] === value));
    assert.ok(restoreProfile, 'Capacity fixture begins with a known mastering profile');
    await page.locator('#masteringPreset').selectOption(restoreProfile.id);
    for (const [id, key] of [['wet', 'wet'], ['dry', 'dry'], ['inputTrim', 'inputGain'], ['frequency', 'frequency'],
      ['pulseRate', 'pulseRate']]) await setRange(id, beforeLiveMastering.performance[key]);
    const restoredMastering = await until(state => Object.entries(beforeLiveMastering.performance).every(([key, value]) =>
      key === 'mastering' ? Object.entries(value).every(([field, setting]) => state.performance.mastering[field] === setting)
        : state.performance[key] === value),
      'restore native mix and mastering before capacity tests');
    liveMasteringSafety(restoredMastering, beforeLiveMastering, 'Mastering restore');
    console.log(`Muted native mastering passed: ${report.liveMastering.gainReductionDb.toFixed(1)} dB measured reduction, ${report.liveMastering.profiles.length} profiles and ${report.liveMastering.controls.length} live controls.`);
    report.liveQuickPresetChecks = [];
    // Quick growth recall stays safe during the muted native run. Full header
    // scenes are tested above with Audio off because they recall output level.
    for (const id of ['pythagorean', 'ivy', 'pythagorean']) {
      const preset = bank.find(preset => preset.id === id), before = await json('/api/status');
      const expected = { ...before.parameters };
      for (const key of GENERATION_PRESET_KEYS) expected[key] = preset.snapshot.parameters[key];
      await page.locator(`[data-generation-preset="${id}"]`).click();
      const recalled = await until(state => Object.entries(expected).every(([key, value]) => state.parameters[key] === value), `live quick ${id}`);
      assert.equal(recalled.audio, true, `${id} preserves the live native session`);
      assert.deepEqual(recalled.performance, before.performance, `${id} preserves the muted mix and input policy`);
      assert.equal(recalled.performance.level, 0);
      assert.equal(recalled.performance.source, 'seed');
      assert.equal(recalled.status.inputDevice, null);
      assert.ok(recalled.status.elapsedSeconds >= before.status.elapsedSeconds, `${id} preserves recorded history and audio time`);
      report.liveQuickPresetChecks.push(id);
    }
    await setRange('generations', 14);
    const grown = await until(state => state.requestedVoices === 32766 && state.status.installedCapacity === 32766, 'live pool growth beyond the former ceiling');
    assert.ok(grown.status.elapsedSeconds >= report.live.at(-1).elapsedSeconds, 'Pool growth preserves the device clock');
    assert.equal(grown.performance.voiceCeiling, 0);
    report.liveGrowth = grown.status;
    const preview = await json('/api/preview');
    assert.equal(preview.nodes.length, 2049);
    assert.ok(preview.nodes.some(node => node.generation === 14) || grown.parameters.pruningBias === 0);
    await setRange('generationAngle', 75);
    const changed = await until(state => state.parameters.angle === 75, 'live parameter edit');
    assert.ok(changed.status.elapsedSeconds >= report.live.at(-1).elapsedSeconds, 'Audio history must not restart');
    await setRange('voiceCeiling', 32);
    const limited = await until(state => state.status.voiceLimit === 32, 'live budget decrease');
    assert.ok(limited.status.elapsedSeconds >= changed.status.elapsedSeconds);
    await setRange('voiceCeiling', 0);
    await until(state => state.status.voiceLimit > 32, 'voice budget grows after ceiling is restored', 6000);
    for (const type of ['plant', 'coral', 'dragon', 'pythagorean']) {
      await page.locator('#lSystemType').selectOption(type);
      const live = await until(state => state.parameters.lSystemType === type, `live ${type}`);
      assert.equal(live.audio, true);
      assert.equal(live.performance.level, 0, 'Live edits preserve muted output');
      assert.equal(live.status.inputDevice, null);
      assert.ok(live.status.elapsedSeconds >= changed.status.elapsedSeconds, 'Grammar edits preserve recording history');
    }
    for (const frozen of [true, false]) {
      const current = await json('/api/status');
      await json('/api/performance', { ...current.performance, frozen });
      const paused = await until(state => state.performance.frozen === frozen, 'input pause state');
      assert.equal(paused.audio, true, 'Input pause retains the audio session and delayed tails');
      assert.equal(paused.status.outputPeak, 0);
    }
    await page.locator('#audioButton').click();
    await until(state => !state.audio, 'native audio stop');
    await page.locator('#audioButton').click();
    await until(state => state.audio, 'native restart');
    await page.goto('about:blank');
    await until(state => !state.audio, 'page departure mutes native audio');
    // No browser heartbeat follows this API-only restart. The server must
    // release a still-silent device session when a control client disappears.
    await json('/api/audio', { enabled: true });
    await new Promise(resolve => setTimeout(resolve, 11000));
    assert.equal((await json('/api/status')).audio, false, 'Disconnected client idle timeout');
  }
  await context.close();
  report.browserErrors = errors;
  await writeFile(new URL(native ? 'native-qa.json' : 'interface-qa.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log(`Native L-system Delay QA passed: ${report.controlChecks} control checks, ${report.viewports.length} viewports${native ? ', silent CPAL scaling and live edits' : ', device-disabled controls'}.`);
  if (native) console.log(`Live voice limits: ${report.live.map(status => status.voiceLimit).join(', ')}`);
} finally {
  if (browser) await browser.close();
  web.kill('SIGTERM');
  child.kill('SIGTERM');
}

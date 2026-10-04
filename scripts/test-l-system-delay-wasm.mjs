#!/usr/bin/env node
// Static-site acceptance. Synthetic media feeds the normal worklet input;
// this runs no native server and cannot establish perceptual sound quality.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { GENERATION_PRESET_KEYS, isVoiceActive } from '../src/instruments/micmic/native/model.js';
import { MASTERING_PROFILES } from '../src/instruments/micmic/native/mastering.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = new URL('../artifacts/l-system-delay-wasm/', import.meta.url);
await mkdir(artifacts, { recursive: true });
// An accidental proxy request cannot use an unrelated user's local companion.
const web = spawn('python3', ['scripts/dev-server.py', '--port', '0', '--strict-port', '--native-delay-port', '1'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', browser;
web.stderr.on('data', chunk => { logs += chunk; });
const address = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Static server did not start: ${logs}`)), 10000);
  web.once('error', reject);
  web.once('exit', code => { clearTimeout(timeout); reject(new Error(`Static server exited ${code}: ${logs}`)); });
  web.stdout.on('data', chunk => {
    logs += chunk; const found = logs.match(/http:\/\/localhost:\d+\//);
    if (found) { clearTimeout(timeout); resolve(found[0]); }
  });
});
const url = new URL('l-mic-rust.html', address).href;
const engineModule = new URL('src/instruments/micmic/native/browser-engine.js', address).href;
const bank = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
const report = { serverRoot: root, url, nativeCompanion: false, actualMicrophone: false,
  listeningPerformed: false, httpApiRequests: [], wasmResponses: [], controls: [], presets: [], viewports: [] };

async function installFixture(page) {
  await page.addInitScript(() => {
    const NativeContext = AudioContext, NativeWorklet = AudioWorkletNode;
    const data = window.__delayFixture = { requests: 0, stopped: 0, contexts: [], worklets: 0,
      streams: [], sources: [], pending: [], mode: 'normal', gain: .08 };
    window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); data.contexts.push(this); } };
    window.AudioWorkletNode = class extends NativeWorklet { constructor(...args) { super(...args); data.worklets++; } };
    navigator.mediaDevices.getUserMedia = async constraints => {
      data.requests++; data.lastConstraints = constraints;
      if (data.mode === 'deny') throw new DOMException('Test permission denied', 'NotAllowedError');
      const context = new NativeContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 173; gain.gain.value = data.gain;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      data.sources.push({ context, oscillator, gain }); data.streams.push(destination.stream);
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { data.stopped++; stop(); oscillator.stop(); void context.close(); };
      }
      if (data.mode === 'hold') await new Promise(resolve => data.pending.push(resolve));
      return destination.stream;
    };
    // Real renderer paths, driven by actual WASM sample-clock/envelope packets.
    const NativePath = Path2D;
    window.Path2D = class extends NativePath {
      constructor(...args) { super(...args); this.auditSubpaths = []; }
      moveTo(...args) { this.auditSubpaths.push([args]); return super.moveTo(...args); }
      lineTo(...args) { this.auditSubpaths.at(-1)?.push(args); return super.lineTo(...args); }
    };
    const prototype = CanvasRenderingContext2D.prototype, clear = prototype.clearRect, stroke = prototype.stroke;
    const colors = new Set(['#fff3d6', '#55d9ff', '#5fe8c4', '#7db4ff', '#c79bff', '#ff826f', '#e8c46b']);
    const audit = window.__delayCanvas = { frames: [], current: null };
    prototype.clearRect = function (...args) {
      if (this.canvas.id === 'stage') {
        if (audit.current) audit.frames.push(audit.current);
        if (audit.frames.length > 12) audit.frames.shift();
        audit.current = { preset: document.querySelector('.instrument-preset-controls')?.dataset.presetId,
          coverage: 0, minimumPoints: Infinity, descendantBent: 0 };
      }
      return clear.apply(this, args);
    };
    prototype.stroke = function (path) {
      const frame = audit.current;
      if (this.canvas.id === 'stage' && frame && colors.has(this.strokeStyle) && path?.auditSubpaths) {
        for (const points of path.auditSubpaths.filter(points => points.length >= 2)) {
          const [x, y] = points[0], [endX, endY] = points.at(-1), length = Math.hypot(endX - x, endY - y);
          const bent = length > 1e-6 && points.some(([px, py]) =>
            Math.abs((px - x) * (endY - y) - (py - y) * (endX - x)) / length > .015);
          frame.coverage++; frame.minimumPoints = Math.min(frame.minimumPoints, points.length);
          if (bent && frame.coverage > 1) frame.descendantBent++;
        }
      }
      return stroke.apply(this, arguments);
    };
  });
}
const state = page => page.evaluate(async module =>
  (await import(module)).getBrowserDelayEngine().request('/api/status'), engineModule);
const diagnostics = page => page.evaluate(async module =>
  (await import(module)).getBrowserDelayEngine().getDiagnostics(), engineModule);
const request = (page, endpoint, body) => page.evaluate(async ({ module, endpoint, body }) =>
  (await import(module)).getBrowserDelayEngine().request(endpoint, body), { module: engineModule, endpoint, body });
async function until(page, predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) {
    last = await state(page); if (predicate(last)) return last; await page.waitForTimeout(60);
  }
  throw new Error(`Timed out: ${label}; ${JSON.stringify(last)}`);
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.instrument-preset-controls')
    && document.getElementById('inputTrim') && !document.getElementById('audioButton').disabled);
}
async function selectPreset(page, id) {
  await page.locator('.instrument-preset-controls summary').click();
  await page.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
  await page.waitForFunction(id => document.querySelector('.instrument-preset-controls').dataset.presetId === id
    && document.querySelector('.instrument-preset-controls').getAttribute('aria-busy') !== 'true', id);
}
function finiteSignal(reply, label) {
  for (const key of ['inputPeak', 'outputPeak', 'outputLeftPeak', 'outputRightPeak', 'elapsedSeconds', 'gainReductionDb']) {
    assert.ok(Number.isFinite(reply.status[key]), `${label}: finite ${key}`);
  }
  assert.ok(reply.status.outputPeak <= 1, `${label}: bounded output`);
  assert.ok(reply.status.tapActivity.every(Number.isFinite), `${label}: finite tap activity`);
}

try {
  browser = await chromium.launch({ headless: true }); report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), errors = [];
  await installFixture(page);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) report.httpApiRequests.push(req.url()); });
  page.on('response', res => {
    if (new URL(res.url()).pathname.endsWith('.wasm')) report.wasmResponses.push({ url: res.url(), status: res.status() });
  });
  await page.goto(url); await ready(page);
  assert.equal(await page.locator('#audioButton').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => __delayFixture.requests), 0, 'Load never requests microphone permission');
  assert.equal((await diagnostics(page)).audio, false);
  assert.equal(await page.locator('#nativeSeedSource').count(), 0, 'No top test-tone shortcut');
  assert.ok(!(await page.locator('body').textContent()).includes('Native audio requires the local'));
  const buttonOrder = await page.locator('[data-generation-preset]').evaluateAll(buttons => buttons.map(button => button.dataset.generationPreset));
  const menuOrder = await page.locator('[data-full-preset]').evaluateAll(buttons => buttons.map(button => button.dataset.presetId));
  assert.equal(buttonOrder.length, bank.length);
  assert.deepEqual(menuOrder.slice(0, buttonOrder.length), buttonOrder, 'Menu follows button order');
  assert.equal(new Set(menuOrder).size, menuOrder.length, 'No duplicate presets');
  await selectPreset(page, menuOrder.at(-1)); await page.locator('.header-preset-next').click();
  await page.waitForFunction(id => document.querySelector('.instrument-preset-controls').dataset.presetId === id, menuOrder[0]);
  report.menuOrder = menuOrder;
  await page.locator('.panel details.control-section').evaluateAll(sections => {
    for (const section of sections) section.open = true;
  });
  report.quickPresets = [];
  for (const id of buttonOrder) {
    const preset = bank.find(preset => preset.id === id), before = await state(page);
    const expected = { ...before.parameters };
    for (const key of GENERATION_PRESET_KEYS) expected[key] = preset.snapshot.parameters[key];
    await page.locator(`[data-generation-preset="${id}"]`).click();
    const recalled = await until(page, reply => Object.entries(expected)
      .every(([key, value]) => reply.parameters[key] === value), `quick growth ${id}`);
    assert.deepEqual(recalled.performance, before.performance, `${id}: growth preserves the mix/mastering/input policy`);
    assert.equal(recalled.audio, false); report.quickPresets.push(id);
  }
  await range(page, 'generationAngle', 61); await until(page, reply => reply.parameters.angle === 61, 'unarmed shape edit');
  await page.locator('#stage').focus(); await page.keyboard.press('ArrowRight');
  assert.equal((await state(page)).audio, false);
  assert.equal(await page.evaluate(() => __delayFixture.requests), 0, 'Gestures never request microphone');

  // Mic captures and meters independently while output remains unarmed.
  await page.locator('#micButton').click();
  await until(page, reply => reply.status.inputPeak > .005, 'capture meters with Audio off');
  assert.equal((await state(page)).audio, false);
  assert.equal((await diagnostics(page)).microphoneEnabled, true);
  assert.equal((await state(page)).status.outputPeak, 0);
  assert.ok(report.wasmResponses.some(response => response.status === 200), 'Real Rust WASM fetched/instantiated');
  await range(page, 'inputTrim', 0); await until(page, reply => reply.status.inputPeak < .001, 'gain controls actual input');
  await range(page, 'inputTrim', .85); await until(page, reply => reply.status.inputPeak > .005, 'input gain restore');
  await selectPreset(page, 'clean'); await range(page, 'generations', 3); await range(page, 'interval', 0);
  await range(page, 'wet', .76); await range(page, 'dry', 0); await page.locator('#audioButton').click();
  const sounding = await until(page, reply => reply.audio && reply.status.outputPeak > .001, 'actual delayed wet output');
  finiteSignal(sounding, 'wet output');
  assert.ok(sounding.status.tapActivity.some(level => level > 0), 'Delay taps carry the microphone fixture');
  assert.ok(sounding.status.inputEnvelope.values.some(value => value > 0), 'Graphic history uses sampled input');
  const live = await diagnostics(page), worklets = await page.evaluate(() => __delayFixture.worklets);
  assert.equal(live.connectionCount, 1); assert.equal(live.performance.voiceCeiling, 0);
  for (const [id, key, values] of [['wet', 'wet', [0, .8]], ['dry', 'dry', [.5, 0]],
    ['inputTrim', 'inputGain', [0, .8]], ['level', 'level', [0, .48]]]) {
    for (const value of values) {
      await range(page, id, value);
      const changed = await until(page, reply => Math.abs(reply.performance[key] - value) < 1e-5, `${id}=${value}`);
      assert.equal(changed.audio, true); finiteSignal(changed, id);
      assert.equal((await diagnostics(page)).contextGeneration, live.contextGeneration, `${id} preserves context`);
      if (value === 0 && key !== 'dry') {
        await until(page, reply => reply.status.outputPeak < .001, `${id}: actual output reaches silence`);
      } else if (value > 0 && key !== 'dry') {
        await until(page, reply => reply.status.outputPeak > .001, `${id}: actual output returns`);
      }
      report.controls.push({ id, value });
    }
  }
  for (const [id, key, value] of [['generationAngle', 'angle', 72], ['generationPitchScale', 'pitchScale', 1.8],
    ['timeRatio', 'timeRatio', .55], ['generationAsymmetry', 'asymmetry', -.35]]) {
    await range(page, id, value);
    const changed = await until(page, reply => Math.abs(reply.parameters[key] - value) < 1e-5, `live ${id}`);
    assert.equal(changed.audio, true); assert.ok(changed.status.elapsedSeconds >= sounding.status.elapsedSeconds);
    assert.equal((await diagnostics(page)).contextGeneration, live.contextGeneration); finiteSignal(changed, id);
  }
  assert.equal(await page.evaluate(() => __delayFixture.worklets), worklets, 'Edits reuse worklet');
  for (const profile of MASTERING_PROFILES) {
    const before = await state(page); await page.locator('#masteringPreset').selectOption(profile.id);
    const changed = await until(page, reply => Object.entries(profile.settings).every(([key, value]) =>
      typeof value === 'number' ? Math.abs(reply.performance.mastering[key] - value) < 1e-4
        : reply.performance.mastering[key] === value), `mastering ${profile.label}`);
    assert.equal(changed.audio, true); assert.deepEqual(changed.parameters, before.parameters);
    assert.ok(changed.status.elapsedSeconds >= before.status.elapsedSeconds);
    assert.equal((await diagnostics(page)).contextGeneration, live.contextGeneration); finiteSignal(changed, profile.label);
  }
  report.masteringProfiles = MASTERING_PROFILES.map(profile => profile.label);
  for (const id of menuOrder) {
    const preset = bank.find(preset => preset.id === id), before = await state(page);
    await selectPreset(page, id);
    const recalled = await until(page, reply => Object.entries(preset.snapshot.parameters)
      .every(([key, value]) => reply.parameters[key] === value), `full scene ${id}`);
    assert.equal(recalled.audio, true); assert.ok(recalled.status.elapsedSeconds >= before.status.elapsedSeconds);
    assert.equal((await diagnostics(page)).contextGeneration, live.contextGeneration);
    const preview = await request(page, '/api/preview');
    const expected = preview.nodes.filter(node => node.generation === 0 || isVoiceActive(node, recalled.status.voiceLimit)).length;
    await page.waitForFunction(({ id, expected }) => __delayCanvas.frames.some(frame =>
      frame.preset === id && frame.coverage >= expected && frame.minimumPoints >= 6), { id, expected });
    const frame = await page.evaluate(id => __delayCanvas.frames.findLast(frame => frame.preset === id), id);
    finiteSignal(recalled, id);
    report.presets.push({ id, requested: recalled.requestedVoices, admitted: recalled.status.voiceLimit,
      previewNodes: preview.nodes.length, coverage: frame.coverage, minimumPoints: frame.minimumPoints });
  }
  await selectPreset(page, 'pythagorean'); await range(page, 'generations', 3); await range(page, 'interval', 0);
  await until(page, reply => reply.parameters.generations === 3 && reply.status.tapActivity.some(value => value > 0), 'short descendants');
  await page.waitForFunction(() => __delayCanvas.frames.some(frame => frame.descendantBent > 0));
  report.descendantWave = await page.evaluate(() => __delayCanvas.frames.findLast(frame => frame.descendantBent > 0));
  const beforeStall = await state(page);
  await page.evaluate(() => { const end = performance.now() + 250; while (performance.now() < end) {} });
  const afterStall = await until(page, reply => reply.status.elapsedSeconds >= beforeStall.status.elapsedSeconds + .2, 'audio survives UI stall');
  assert.equal(afterStall.audio, true); finiteSignal(afterStall, 'UI stall');
  report.clockDuringUiStall = afterStall.status.elapsedSeconds - beforeStall.status.elapsedSeconds;
  // Demand exceeds the old pool bound; record measured device admission rather
  // than hardcoding a universally achievable voice count.
  await range(page, 'generations', 15);
  const demand = await until(page, reply => reply.parameters.generations === 15 && reply.requestedVoices > 32766, 'demand beyond former bound', 30000);
  assert.equal(demand.performance.voiceCeiling, 0);
  const admission = [];
  for (let i = 0; i < 20; i++) {
    const reply = await state(page); finiteSignal(reply, 'adaptive admission');
    assert.equal(reply.audio, true); assert.ok(reply.status.voiceLimit <= reply.eligibleVoices);
    admission.push({ elapsed: reply.status.elapsedSeconds, voices: reply.status.voiceLimit,
      cpuLoad: reply.status.cpuLoad, peakLoad: reply.status.peakLoad,
      deadlineMisses: reply.status.deadlineMisses }); await page.waitForTimeout(250);
  }
  report.admission = { requested: demand.requestedVoices, userCeiling: 0, samples: admission,
    peakAdmitted: Math.max(...admission.map(sample => sample.voices)),
    oldBoundExceeded: admission.some(sample => sample.voices > 32766) };
  await range(page, 'generations', 3);
  await page.locator('#audioButton').click(); await until(page, reply => !reply.audio && reply.status.outputPeak === 0, 'Audio off silence');
  assert.equal((await diagnostics(page)).microphoneEnabled, false);
  assert.ok(await page.evaluate(() => __delayFixture.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))));
  await page.locator('#audioButton').click(); await until(page, reply => reply.audio && reply.status.inputPeak > 0, 'explicit restart');
  assert.equal((await diagnostics(page)).connectionCount, 1);
  await page.locator('#audioButton').click(); await until(page, reply => !reply.audio, 'stop before layouts');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport); await page.locator('#masteringSection').evaluate(node => { node.open = true; });
    const reachable = [];
    for (const id of ['audioButton', 'micButton', 'masteringPreset', 'inputHighpassHz', 'highpassHz', 'lowpassHz',
      'compressorEnabled', 'thresholdDb', 'kneeDb', 'ratio', 'attackMs', 'releaseMs', 'autoMakeup', 'makeupDb']) {
      const input = page.locator(`#${id}`); await input.scrollIntoViewIfNeeded(); const box = await input.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0 && box.x >= -1 && box.x + box.width <= viewport.width + 1
        && box.y >= -1 && box.y + box.height <= viewport.height + 1, `${id} reachable at ${viewport.width}x${viewport.height}`);
      reachable.push(id);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal document overflow');
    await page.screenshot({ path: fileURLToPath(new URL(`instrument-${viewport.width}x${viewport.height}.png`, artifacts)), fullPage: true });
    report.viewports.push({ ...viewport, reachable });
  }
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  assert.deepEqual(axe.violations, [], 'Open mastering accessibility'); report.accessibilityViolations = axe.violations.length;
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const touchPage = await touchContext.newPage(); await installFixture(touchPage);
  await touchPage.goto(url); await ready(touchPage);
  const touchTarget = await touchPage.locator('#audioButton').boundingBox();
  assert.ok(touchTarget.width >= 48 && touchTarget.height >= 48, 'Coarse-pointer Audio target');
  const touchBefore = await state(touchPage), stage = await touchPage.locator('#stage').boundingBox();
  const touchSession = await touchContext.newCDPSession(touchPage);
  const point = { x: stage.x + stage.width * .4, y: stage.y + stage.height * .5 };
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 25, y: point.y - 20 }] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await until(touchPage, reply => reply.parameters.intervalMs !== touchBefore.parameters.intervalMs, 'touch drag edits the real tree');
  assert.equal((await state(touchPage)).audio, false);
  assert.equal(await touchPage.evaluate(() => __delayFixture.requests), 0, 'Touch never arms capture');
  report.touch = { audioTarget: touchTarget, cancelledGesture: true };
  await touchContext.close();
  await page.evaluate(() => { __delayFixture.mode = 'deny'; }); await page.locator('#micButton').click();
  await page.waitForFunction(() => !document.getElementById('audioError').hidden || !!document.querySelector('.mz-input-error:not([hidden])'));
  assert.equal((await diagnostics(page)).microphoneEnabled, false); assert.equal((await state(page)).audio, false);
  await page.keyboard.press('Escape'); await page.evaluate(() => { __delayFixture.mode = 'normal'; });
  await page.locator('#micButton').click(); await until(page, reply => reply.status.inputPeak > .005, 'permission retry');
  await page.locator('#micButton').click(); await page.evaluate(() => { __delayFixture.mode = 'hold'; });
  await page.locator('#micButton').click(); await page.waitForFunction(() => __delayFixture.pending.length === 1);
  await page.locator('#micButton').click(); await page.evaluate(() => { __delayFixture.pending[0](); });
  await page.waitForFunction(() => __delayFixture.streams.at(-1).getTracks().every(track => track.readyState === 'ended'));
  assert.equal((await diagnostics(page)).microphoneEnabled, false); assert.equal((await state(page)).audio, false);
  report.permissionRecovery = { retry: true, cancelledLateGrantReleased: true };
  await page.evaluate(() => { __delayFixture.mode = 'normal'; });
  await page.locator('#audioButton').click(); await until(page, reply => reply.audio, 'arm before departure');
  const departed = await page.evaluate(async module => {
    const engine = (await import(module)).getBrowserDelayEngine();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    await new Promise(resolve => setTimeout(resolve, 150)); return engine.getDiagnostics();
  }, engineModule);
  assert.equal(departed.audio, false); assert.equal(departed.microphoneEnabled, false);
  assert.equal(departed.connectionCount, 0); assert.equal(departed.contextState, 'closed');
  await page.goto(new URL('l-mic.html', address).href); await page.goBack(); await ready(page);
  assert.equal(await page.locator('#audioButton').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.evaluate(() => __delayFixture.requests), 0, 'Back never reopens microphone');
  assert.deepEqual(report.httpApiRequests, [], 'Static page never uses the native HTTP API');
  assert.deepEqual(errors, [], 'Browser runtime errors'); report.browserErrors = errors;
  await context.close(); await writeFile(new URL('qa.json', artifacts), JSON.stringify(report, null, 2) + '\n');
  console.log(`Rust WASM delay passed: ${report.presets.length} scenes, ${report.masteringProfiles.length} mastering profiles, ${report.viewports.length} layouts, no native API. Measured peak admission ${report.admission.peakAdmitted}/${report.admission.requested}.`);
} finally {
  if (browser) await browser.close(); web.kill('SIGTERM');
}

#!/usr/bin/env node
// Static-site acceptance. Synthetic media feeds the normal worklet input;
// this runs no native server and cannot establish perceptual sound quality.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { MASTERING_PROFILES } from '../src/instruments/micmic/native/mastering.js';
import { presetStateKey } from '../src/site/header-presets.js';
import { sliderFromTimeFold } from '../src/instruments/micmic/micmic.js';

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
    const NativeContext = AudioContext, NativeWorklet = AudioWorkletNode, NativeWorker = Worker;
    const data = window.__delayFixture = { requests: 0, stopped: 0, contexts: [], worklets: 0,
      streams: [], sources: [], pending: [], mode: 'normal', gain: .08,
      holdReady: false, holdNextInstallAck: false, holdNextPerformanceAck: false,
      pendingReady: [], pendingInstall: [], pendingPerformance: [], posted: [], received: [],
      holdNextCompileAck: false, pendingCompiles: [], signal: 'continuous' };
    window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); data.contexts.push(this); } };
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(...args) {
        super(...args); data.worklets++;
        const nativePost = this.port.postMessage.bind(this.port), messages = new Map();
        this.port.postMessage = (message, ...transfer) => {
          messages.set(message.id, message.type);
          data.posted.push({ id: message.id, type: message.type,
            revision: message.pool ? new DataView(message.pool).getUint32(16, true) : null,
            performance: message.performance ? structuredClone(message.performance) : null });
          nativePost(message, ...transfer);
        };
        const descriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
        let handler;
        Object.defineProperty(this.port, 'onmessage', { configurable: true,
          get: () => handler,
          set: value => {
            handler = value;
            descriptor.set.call(this.port, event => {
              if (event.data.id) data.received.push(event.data.id);
              if (event.data.type === 'ready' && data.holdReady) data.pendingReady.push(() => value(event));
              else if (messages.get(event.data.id) === 'install' && data.holdNextInstallAck) {
                data.holdNextInstallAck = false; data.pendingInstall.push(() => value(event));
              } else if (messages.get(event.data.id) === 'performance' && data.holdNextPerformanceAck) {
                data.holdNextPerformanceAck = false; data.pendingPerformance.push(() => value(event));
              } else value(event);
            });
          },
        });
      }
    };
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        const descriptor = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'onmessage');
        let handler;
        Object.defineProperty(this, 'onmessage', { configurable: true, get: () => handler,
          set: value => {
            handler = value;
            descriptor.set.call(this, event => {
              if (data.holdNextCompileAck && event.data.result) {
                data.holdNextCompileAck = false; data.pendingCompiles.push(() => value(event));
              } else value(event);
            });
          },
        });
      }
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      data.requests++; data.lastConstraints = constraints;
      if (data.mode === 'deny') throw new DOMException('Test permission denied', 'NotAllowedError');
      const context = new NativeContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 173; gain.gain.value = 0;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      const source = { context, oscillator, gain, timer: null, setSignal(mode, amplitude) {
        clearInterval(this.timer); this.timer = null;
        const parameter = gain.gain;
        parameter.cancelScheduledValues(context.currentTime);
        parameter.setValueAtTime(0, context.currentTime);
        if (!['burst', 'bursts'].includes(mode)) { parameter.setValueAtTime(amplitude, context.currentTime); return; }
        const pulse = () => {
          const time = context.currentTime;
          parameter.cancelScheduledValues(time); parameter.setValueAtTime(0, time);
          parameter.linearRampToValueAtTime(amplitude, time + .008);
          parameter.linearRampToValueAtTime(amplitude * .2, time + .16);
          parameter.linearRampToValueAtTime(0, time + .23);
        };
        pulse(); if (mode === 'bursts') this.timer = setInterval(pulse, 850);
      } };
      source.setSignal(data.signal, data.gain);
      data.sources.push(source); data.streams.push(destination.stream);
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { data.stopped++; clearInterval(source.timer); stop(); oscillator.stop(); void context.close(); };
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
          inputSeconds: data.sources.at(-1)?.context.currentTime ?? 0,
          coverage: 0, minimumPoints: Infinity, descendantBent: 0, neutralCoverage: 0,
          neutralSignature: 0, neutralEdges: [], root: null, paths: [] };
      }
      return clear.apply(this, args);
    };
    prototype.stroke = function (path) {
      const frame = audit.current;
      if (this.canvas.id === 'stage' && frame && path?.auditSubpaths) {
        const transform = this.getTransform(), dpr = Math.min(2, devicePixelRatio || 1);
        const project = ([x, y]) => [(transform.a * x + transform.c * y + transform.e) / dpr,
          (transform.b * x + transform.d * y + transform.f) / dpr];
        const segments = path.auditSubpaths.filter(points => points.length >= 2);
        if (!colors.has(this.strokeStyle)) {
          frame.neutralCoverage += segments.length;
          for (const points of segments) for (const [x, y] of points.map(project)) frame.neutralSignature += x + y * 3;
          frame.neutralEdges.push(...segments.slice(0, 3).map(points => ({
            start: project(points[0]), end: project(points.at(-1)),
          })));
          if (segments.length) {
            const start = project(segments[0][0]), end = project(segments[0].at(-1));
            frame.root = { start, end, length: Math.hypot(end[0] - start[0], end[1] - start[1]) };
          }
        } else for (const points of segments) {
          const projected = points.map(project), [x, y] = projected[0], [endX, endY] = projected.at(-1);
          const length = Math.hypot(endX - x, endY - y), deviation = length > 1e-6
            ? Math.max(...projected.map(([px, py]) => Math.abs((px - x) * (endY - y) - (py - y) * (endX - x)) / length)) : 0;
          const midpoint = projected[Math.floor(projected.length / 2)], root = frame.root;
          // Exclude the root and its close overlap. A root-only wave cannot
          // pass the Coral descendant visibility check.
          const descendant = root && Math.hypot(midpoint[0] - root.start[0], midpoint[1] - root.start[1]) > root.length + 12;
          frame.paths.push({ deviation, length, alpha: this.globalAlpha, descendant,
            color: this.strokeStyle, midpoint, start: projected[0], end: projected.at(-1), points: projected });
          frame.coverage++; frame.minimumPoints = Math.min(frame.minimumPoints, points.length);
          if (deviation >= 1 && descendant) frame.descendantBent++;
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
function matchesPreset(reply, preset) {
  return Object.entries(preset.snapshot.parameters).every(([key, value]) => reply.parameters[key] === value)
    && Object.entries(preset.snapshot.performance).every(([key, value]) =>
      presetStateKey(reply.performance[key]) === presetStateKey(value));
}
async function causalCoralResponse() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await installFixture(page); await page.goto(url); await ready(page); await selectPreset(page, 'coral');
  await page.waitForTimeout(250); // Allow the preserved 120 ms scene interpolation to finish.
  await page.evaluate(() => { __delayFixture.gain = 0; __delayFixture.signal = 'bursts'; });
  await page.locator('#audioButton').click();
  await until(page, reply => reply.audio && reply.status.microphoneEnabled, 'silent Coral capture');
  await page.evaluate(() => { __delayCanvas.frames = []; });
  await page.waitForFunction(() => __delayCanvas.frames.length >= 2);
  const silent = [];
  for (let i = 0; i < 12; i++) {
    const reply = await state(page), frames = await page.evaluate(() => __delayCanvas.frames);
    assert.equal(reply.status.inputPeak, 0); assert.equal(reply.status.outputPeak, 0);
    assert.ok(reply.status.tapActivity.every(value => value === 0));
    assert.ok(frames.every(frame => frame.coverage === 0), 'silent capacity growth cannot color any branch');
    assert.ok(frames.every(frame => frame.neutralCoverage === 512), 'the complete neutral Coral outline stays present');
    silent.push({ time: reply.status.elapsedSeconds, admitted: reply.status.voiceLimit,
      counts: reply.status.generationVoiceCounts.slice(0, 10), neutralSignature: frames.at(-1)?.neutralSignature });
    await page.waitForTimeout(220);
  }
  assert.ok(silent.some(sample => sample.admitted > silent[0].admitted), 'the silence regression exercises real adaptive growth');
  assert.ok(silent.every(sample => Math.abs(sample.neutralSignature - silent[0].neutralSignature) < 1e-6), 'admission never changes the neutral drawing');
  const bursts = [];
  for (const amplitude of [.01, .03, .05]) {
    await page.evaluate(amplitude => { __delayCanvas.frames = []; __delayFixture.sources.at(-1).setSignal('bursts', amplitude); }, amplitude);
    const paths = [], counts = []; let sounding = 0;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(280);
      const reply = await state(page), frames = await page.evaluate(() => __delayCanvas.frames);
      const descendants = frames.flatMap(frame => frame.paths.filter(path => path.descendant)); paths.push(...descendants);
      counts.push(Math.max(0, ...frames.map(frame => frame.paths.filter(path => path.descendant && path.deviation >= 1).length)));
      sounding = Math.max(sounding, ...reply.status.tapActivity);
    }
    const deviations = paths.map(path => path.deviation).sort((a, b) => a - b), q = percentile => deviations[Math.floor((deviations.length - 1) * percentile)] || 0;
    const result = { amplitude, medianCssPx: q(.5), p95CssPx: q(.95), maximumCssPx: q(1),
      maximumClearlyBentDescendants: Math.max(...counts), tapRmsPeak: sounding };
    console.log(`Coral burst response: ${JSON.stringify(result)}`);
    await writeFile(new URL(`coral-burst-${amplitude}.json`, artifacts), JSON.stringify(result, null, 2) + '\n');
    assert.ok(sounding > 0, `${amplitude}: real Rust taps sound`);
    if (amplitude === .03) {
      assert.ok(result.maximumCssPx >= 1, 'ordinary Coral microphone bursts visibly bend descendants by at least one CSS pixel');
      assert.ok(result.maximumClearlyBentDescendants >= 10, 'ordinary bursts move several descendants, not only the root');
    }
    bursts.push(result); await page.locator('#stage').screenshot({ path: fileURLToPath(new URL(`coral-bursts-${amplitude}.png`, artifacts)) });
  }
  await range(page, 'wet', 0);
  await until(page, reply => reply.performance.wet === 0 && reply.status.wetBusGain < 1e-7, 'wet bus fade reaches silence');
  await page.waitForTimeout(750);
  await page.evaluate(() => { __delayCanvas.frames = []; });
  await page.waitForFunction(() => __delayCanvas.frames.length >= 3);
  assert.ok((await page.evaluate(() => __delayCanvas.frames)).every(frame => frame.paths.every(path => !path.descendant)), 'muted wet output removes descendant color and vibration');
  await range(page, 'wet', .55);
  await page.evaluate(() => __delayFixture.sources.at(-1).setSignal('continuous', 0));
  await until(page, reply => reply.status.outputPeak < 1e-7 && reply.status.tapActivity.every(value => value < 1e-7), 'Coral delayed tails reach silence');
  await page.waitForTimeout(1000);
  await page.evaluate(() => { __delayCanvas.frames = []; });
  await page.waitForFunction(() => __delayCanvas.frames.length >= 3);
  assert.ok((await page.evaluate(() => __delayCanvas.frames)).every(frame => frame.coverage === 0), 'ended microphone bursts leave no colored activity');
  assert.deepEqual(errors, []);
  await context.close(); return { silentCapacityGrowth: silent, bursts, wetZeroDark: true, tailSilenceDark: true, actualWasm: true };
}
async function causalLongPineResponse() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await installFixture(page); await page.goto(url); await ready(page); await selectPreset(page, 'pythagorean');
  await range(page, 'generations', 3); await range(page, 'interval', sliderFromTimeFold(1500)); await range(page, 'timeRatio', 2);
  await until(page, reply => reply.parameters.generations === 3 && reply.parameters.intervalMs === 1500
    && reply.parameters.timeRatio === 2, 'long Pine geometry');
  await page.waitForTimeout(250);
  await page.evaluate(() => { __delayFixture.gain = 0; }); await page.locator('#audioButton').click();
  await until(page, reply => reply.audio && reply.status.microphoneEnabled, 'fresh silent long Pine');
  const preview = await request(page, '/api/preview');
  const firstChild = preview.nodes.find(node => node.generation === 1);
  assert.ok(firstChild.delay >= 2.8 && firstChild.delay <= 3.2, 'the test exercises a genuinely long first transit');
  const pulseStart = await page.evaluate(() => {
    const source = __delayFixture.sources.at(-1); __delayCanvas.frames = [];
    const time = source.context.currentTime; source.setSignal('burst', .03); return time;
  });
  await page.waitForTimeout(2470);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const reply = await state(page), frames = await page.evaluate(() => __delayCanvas.frames);
    assert.ok(reply.status.tapActivity.every(value => value < 1e-7), 'fresh Pine endpoints have no delayed sound before first arrival');
    for (const frame of frames.filter(frame => frame.inputSeconds - pulseStart >= 2.45 && frame.inputSeconds - pulseStart <= 2.86)) {
      const edge = frame.neutralEdges[1]; if (!edge) continue;
      const dx = edge.end[0] - edge.start[0], dy = edge.end[1] - edge.start[1], squaredLength = dx * dx + dy * dy;
      const cyan = frame.paths.filter(path => path.color === '#55d9ff');
      const progresses = cyan.flatMap(path => path.points.map(([x, y]) => ((x - edge.start[0]) * dx + (y - edge.start[1]) * dy) / squaredLength));
      assert.ok(cyan.every(path => Math.hypot(path.end[0] - edge.end[0], path.end[1] - edge.end[1]) > .01),
        'actual Canvas never colors a silent measured Pine endpoint merely because the previous interior sample sounds');
      samples.push({ inputSeconds: frame.inputSeconds - pulseStart, maximumProgress: Math.max(0, ...progresses), coloredParts: cyan.length });
    }
    await page.waitForTimeout(55);
  }
  assert.ok(samples.some(sample => sample.coloredParts && sample.maximumProgress > .7), 'the endpoint test includes a visible packet near the end of a long branch');
  await page.locator('#stage').screenshot({ path: fileURLToPath(new URL('pine-in-flight-silent-endpoint.png', artifacts)) });
  await page.evaluate(() => __delayFixture.sources.at(-1).setSignal('bursts', .03));
  await until(page, reply => reply.status.tapActivity.some(value => value > 1e-7), 'long Pine delayed sound arrives');
  await range(page, 'wet', 0);
  await until(page, reply => reply.performance.wet === 0 && reply.status.wetBusGain < 1e-7, 'long Pine wet bus silence');
  await page.waitForTimeout(1000); await page.evaluate(() => { __delayCanvas.frames = []; });
  await page.waitForFunction(() => __delayCanvas.frames.length >= 3);
  assert.ok((await page.evaluate(() => __delayCanvas.frames)).every(frame => frame.paths.every(path => path.color === '#fff3d6')),
    'wet-zero long Pine remains neutral on every descendant even while the dry root and microphone history sound');
  assert.deepEqual(errors, []); await context.close();
  const result = { firstTransitSeconds: firstChild.delay, samples, silentCanvasEndpoint: true, wetZeroDescendantsDark: true };
  await writeFile(new URL('pine-long-response.json', artifacts), JSON.stringify(result, null, 2) + '\n');
  return result;
}
async function factoryBurstResponses() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage();
  await installFixture(page); await page.goto(url); await ready(page);
  await page.evaluate(() => { __delayFixture.signal = 'bursts'; __delayFixture.gain = .03; });
  await page.locator('#audioButton').click(); await until(page, reply => reply.audio && reply.status.microphoneEnabled, 'factory burst microphone');
  const responses = [];
  for (const id of ['pythagorean', 'venus', 'ivy', 'dragon', 'koch']) {
    const preset = bank.find(preset => preset.id === id); await selectPreset(page, id);
    await until(page, reply => matchesPreset(reply, preset), `factory burst ${id}`);
    await page.waitForTimeout(250); await page.evaluate(() => { __delayCanvas.frames = []; });
    const paths = [], rms = []; let admitted = 0, requested = 0, maxResponding = 0, maxBent = 0, sounding = 0;
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(220);
      const reply = await state(page), frames = await page.evaluate(() => __delayCanvas.frames);
      requested = reply.requestedVoices; admitted = Math.max(admitted, reply.status.voiceLimit);
      const positive = reply.status.tapActivity.filter(value => value > 0); rms.push(...positive); sounding = Math.max(sounding, positive.length);
      for (const frame of frames) {
        const descendants = frame.paths.filter(path => path.descendant); paths.push(...descendants);
        maxResponding = Math.max(maxResponding, descendants.length); maxBent = Math.max(maxBent, descendants.filter(path => path.deviation >= 1).length);
      }
    }
    const quantile = (values, fraction) => { values.sort((a, b) => a - b); return values[Math.floor((values.length - 1) * fraction)] || 0; };
    const deviations = paths.map(path => path.deviation);
    const result = { id, amplitude: .03, requested, peakAdmitted: admitted, peakMeteredSounding: sounding,
      peakRespondingNonRootCurves: maxResponding, peakBentNonRootCurves: maxBent,
      medianPositiveTapRms: quantile(rms, .5), peakTapRms: quantile(rms, 1),
      medianCssPx: quantile(deviations, .5), p95CssPx: quantile(deviations, .95), maxCssPx: quantile(deviations, 1) };
    console.log(`Factory burst response: ${JSON.stringify(result)}`); responses.push(result);
    assert.ok(result.peakTapRms > 0, `${id}: real delay taps respond to ordinary microphone bursts`);
    assert.ok(result.peakBentNonRootCurves >= 5, `${id}: ordinary factory bursts visibly bend several descendants by at least one CSS pixel`);
    await page.locator('#stage').screenshot({ path: fileURLToPath(new URL(`factory-bursts-${id}.png`, artifacts)) });
  }
  await writeFile(new URL('factory-burst-response.json', artifacts), JSON.stringify(responses, null, 2) + '\n');
  await context.close(); return responses;
}
async function adversarialEdits(page) {
  // Change every owned field through normal DOM events. The source and device
  // policy are deliberately excluded, so recall cannot mask an input restart.
  await page.evaluate(() => {
    const values = { generations: 3, interval: 900, timeRatio: 1.85, depth: .13, mutation: .92,
      generationAngle: 133, generationPitchScale: 3.4, generationAsymmetry: .61, spread: .12, pruningBias: .77,
      wet: .19, dry: .41, inputTrim: 1.31, level: .19,
      inputHighpassHz: 640, highpassHz: 760, lowpassHz: 440,
      thresholdDb: -49, ratio: 2.2, kneeDb: 21, attackMs: 61, releaseMs: 941, makeupDb: 7 };
    const type = document.getElementById('lSystemType'); type.value = 'cantor'; type.dispatchEvent(new Event('change', { bubbles: true }));
    for (const [id, value] of Object.entries(values)) {
      const input = document.getElementById(id); input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    for (const id of ['compressorEnabled', 'autoMakeup']) {
      const input = document.getElementById(id); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  return until(page, reply => reply.parameters.lSystemType === 'cantor' && reply.parameters.angle === 133
    && reply.performance.wet === .19 && reply.performance.mastering.thresholdDb === -49
    && reply.performance.mastering.autoMakeup === false, 'all owned adversarial edits reached the engine');
}

try {
  browser = await chromium.launch({ headless: true }); report.browser = browser.version();
  if (!process.argv.includes('--factory-only')) {
    report.coralResponse = await causalCoralResponse();
    report.longPineResponse = await causalLongPineResponse();
  }
  report.factoryBurstResponse = await factoryBurstResponses();
  if (process.argv.includes('--factory-only')) {
    await browser.close(); web.kill('SIGTERM'); process.exit(0);
  }
  if (process.argv.includes('--coral-only')) {
    await writeFile(new URL('coral-response.json', artifacts), JSON.stringify(report.coralResponse, null, 2) + '\n');
    console.log('Actual WASM microphone-size checks passed: quiet capacity growth, Coral waves, long Pine endpoints and wet-zero descendants.');
    await browser.close(); web.kill('SIGTERM'); process.exit(0);
  }
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
  const menuOrder = await page.locator('[data-full-preset]').evaluateAll(buttons => buttons.map(button => button.dataset.presetId));
  assert.equal(await page.locator('[data-generation-preset]').count(), 0, 'Growth buttons are removed');
  assert.deepEqual(menuOrder, bank.map(preset => preset.id), 'Menu retains the complete ordered factory bank');
  assert.equal(new Set(menuOrder).size, menuOrder.length, 'No duplicate presets');
  await selectPreset(page, menuOrder.at(-1)); await page.locator('.header-preset-next').click();
  await page.waitForFunction(id => document.querySelector('.instrument-preset-controls').dataset.presetId === id, menuOrder[0]);
  report.menuOrder = menuOrder;
  await page.locator('.panel details.control-section').evaluateAll(sections => {
    for (const section of sections) section.open = true;
  });
  await range(page, 'generationAngle', 61); await until(page, reply => reply.parameters.angle === 61, 'unarmed shape edit');
  await page.locator('#stage').focus(); await page.keyboard.press('ArrowRight');
  assert.equal((await state(page)).audio, false);
  assert.equal(await page.evaluate(() => __delayFixture.requests), 0, 'Gestures never request microphone');

  // Hold real MessagePort deliveries to reproduce an initial Audio/preset race,
  // while allowing the actual Rust worklet and topology worker to execute.
  const startupContext = await browser.newContext(), startup = await startupContext.newPage();
  await installFixture(startup); await startup.goto(url); await ready(startup);
  await startup.evaluate(() => { __delayFixture.holdReady = true; __delayFixture.holdNextPerformanceAck = true; });
  await startup.locator('#audioButton').click();
  await startup.waitForFunction(() => __delayFixture.pendingReady.length === 1
    && __delayFixture.posted.filter(message => message.type === 'install').every(message => __delayFixture.received.includes(message.id)));
  await startup.evaluate(() => { __delayFixture.holdNextInstallAck = true; });
  await startup.locator('.instrument-preset-controls summary').click();
  await startup.locator('[data-full-preset][data-preset-id="koch"]').click();
  await startup.waitForFunction(() => __delayFixture.pendingInstall.length === 1);
  await startup.evaluate(() => { __delayFixture.holdReady = false; __delayFixture.pendingReady[0](); });
  await startup.waitForFunction(() => __delayFixture.pendingPerformance.length === 1);
  await startup.evaluate(() => __delayFixture.pendingInstall[0]());
  await startup.waitForFunction(() => document.querySelector('.instrument-preset-controls').dataset.presetId === 'koch'
    && document.querySelector('.instrument-preset-controls').getAttribute('aria-busy') !== 'true');
  // Keep first startup waiting on its initial performance ACK, then edit and
  // recall again. The new performance must reach Rust despite that pending ACK.
  await range(startup, 'wet', .29); await selectPreset(startup, 'koch');
  await startup.waitForFunction(() => __delayFixture.posted.filter(message => message.type === 'performance').length >= 2);
  await startup.evaluate(() => __delayFixture.pendingPerformance[0]());
  const firstPlaying = await until(startup, reply => reply.audio && reply.status.outputPeak > .001, 'first Audio and immediate preset');
  const koch = bank.find(preset => preset.id === 'koch');
  assert.deepEqual(firstPlaying.parameters, koch.snapshot.parameters);
  for (const [key, value] of Object.entries(koch.snapshot.performance)) assert.deepEqual(firstPlaying.performance[key], value);
  assert.equal(firstPlaying.status.requestedTargets, firstPlaying.requestedVoices, 'first start installs the selected audio topology');
  assert.equal(firstPlaying.status.topologyRevision, firstPlaying.topologyRevision, 'first start meters match displayed topology');
  const startupMessages = await startup.evaluate(() => __delayFixture.posted);
  const revisions = startupMessages.filter(message => message.type === 'install').map(message => message.revision);
  assert.ok(revisions.length >= 2 && revisions.every((revision, index) => index === 0 || revision >= revisions[index - 1]),
    'startup never replaces the new pool with its initial older pool');
  assert.deepEqual(startupMessages.filter(message => message.type === 'performance').at(-1).performance, firstPlaying.performance,
    'a preset recalled during first startup reaches the actual worklet');
  report.firstAudioRecall = { id: 'koch', requested: firstPlaying.requestedVoices,
    revision: firstPlaying.topologyRevision, clock: firstPlaying.status.elapsedSeconds, installRevisions: revisions };
  await startupContext.close();

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
  await page.locator('#automatic').evaluate(input => { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await range(page, 'voiceCeiling', 111); await range(page, 'frequency', 311); await range(page, 'pulseRate', .7);
  await until(page, reply => !reply.performance.automatic && reply.performance.voiceCeiling === 111
    && reply.performance.frequency === 311 && reply.performance.pulseRate === .7, 'external policy fixture');
  const externalKeys = ['source', 'frozen', 'automatic', 'voiceCeiling', 'frequency', 'pulseRate'];
  for (const id of menuOrder) {
    const preset = bank.find(preset => preset.id === id), before = await adversarialEdits(page);
    const requestsBefore = await page.evaluate(() => __delayFixture.requests);
    await selectPreset(page, id);
    const recalled = await until(page, reply => matchesPreset(reply, preset), `full scene ${id}`);
    assert.equal(recalled.audio, true); assert.ok(recalled.status.elapsedSeconds >= before.status.elapsedSeconds);
    assert.equal((await diagnostics(page)).contextGeneration, live.contextGeneration);
    assert.equal((await diagnostics(page)).microphoneEnabled, true, `${id}: capture stays active`);
    assert.equal(await page.evaluate(() => __delayFixture.requests), requestsBefore, `${id}: no new microphone permission`);
    for (const key of externalKeys) assert.equal(recalled.performance[key], before.performance[key], `${id}: preserves ${key}`);
    assert.equal(recalled.status.topologyRevision, recalled.topologyRevision);
    assert.equal(recalled.status.requestedTargets, recalled.requestedVoices);
    await page.waitForTimeout(150);
    assert.ok(matchesPreset(await state(page), preset), `${id}: delayed edits cannot overwrite recall`);
    const preview = await request(page, '/api/preview');
    const expected = preview.nodes.length;
    await page.waitForFunction(({ id, expected }) => __delayCanvas.frames.some(frame =>
      frame.preset === id && frame.neutralCoverage >= expected), { id, expected });
    const frame = await page.evaluate(id => __delayCanvas.frames.findLast(frame => frame.preset === id), id);
    finiteSignal(recalled, id);
    report.presets.push({ id, requested: recalled.requestedVoices, admitted: recalled.status.voiceLimit,
      previewNodes: preview.nodes.length, coverage: frame.coverage, minimumPoints: frame.minimumPoints,
      completeRecallAfterEveryOwnedEdit: true });
  }
  // Same preset selection and the lower Reload control both restore the entire
  // selected scene after a grammar, mix and mastering edit.
  const pine = bank.find(preset => preset.id === 'pythagorean');
  await selectPreset(page, 'koch'); await selectPreset(page, pine.id);
  assert.ok(matchesPreset(await state(page), pine), 'linear grammar → Pine restores the complete branching scene');
  report.samePresetReloads = [];
  for (const mode of ['menu', 'reload']) {
    const before = await adversarialEdits(page);
    if (mode === 'menu') await selectPreset(page, pine.id);
    else await page.locator('#resetGenerationRules').click();
    const recalled = await until(page, reply => matchesPreset(reply, pine), `${mode}: reload full Pine`);
    assert.equal(recalled.audio, true); assert.equal((await diagnostics(page)).microphoneEnabled, true);
    assert.ok(recalled.status.elapsedSeconds >= before.status.elapsedSeconds); report.samePresetReloads.push(mode);
  }
  await page.locator('#source').selectOption('seed');
  await until(page, reply => reply.performance.source === 'seed', 'explicitly select alternate source');
  await page.locator('#seedPauseButton').click();
  await until(page, reply => reply.performance.frozen, 'freeze input independently of recall');
  await selectPreset(page, 'coral');
  assert.equal((await state(page)).performance.frozen, true, 'recall preserves live input freeze');
  assert.equal((await state(page)).performance.source, 'seed', 'recall preserves the explicitly selected source');
  assert.equal((await diagnostics(page)).microphoneEnabled, false, 'recall does not reopen microphone capture');
  await page.locator('#seedPauseButton').click(); await until(page, reply => !reply.performance.frozen, 'unfreeze input');
  await page.locator('#source').selectOption('mic');
  await until(page, reply => reply.performance.source === 'mic' && reply.status.microphoneEnabled, 'restore explicit microphone source');
  // Delay an actual worker reply so the first edit remains in flight when the
  // full scene is selected. Queued and dirty edits must not win afterward.
  await page.evaluate(() => { __delayFixture.holdNextCompileAck = true; });
  await range(page, 'generationAngle', 131);
  await page.waitForFunction(() => __delayFixture.pendingCompiles.length === 1);
  await range(page, 'wet', .11); await range(page, 'spread', .17);
  await page.locator('.instrument-preset-controls summary').click();
  await page.locator(`[data-full-preset][data-preset-id="${pine.id}"]`).click();
  await page.evaluate(() => __delayFixture.pendingCompiles[0]());
  await until(page, reply => matchesPreset(reply, pine), 'queued edits → full Pine recall');
  await page.waitForTimeout(400);
  const settled = await state(page);
  assert.ok(matchesPreset(settled, pine)); assert.equal(settled.audio, true);
  assert.equal(settled.status.topologyRevision, settled.topologyRevision);
  assert.equal(settled.status.requestedTargets, settled.requestedVoices);
  assert.equal((await diagnostics(page)).contextGeneration, live.contextGeneration);
  report.queuedEditRecall = { id: pine.id, revision: settled.topologyRevision, requested: settled.requestedVoices };
  // A same-grammar, same-generation recall still changes timing and pool
  // identity. Hold its real install ACK: neither prior RMS nor retained capture
  // history may paint the new descendants before the selected pool is known.
  await range(page, 'generationAngle', pine.snapshot.parameters.angle + 27);
  await until(page, reply => reply.parameters.angle === pine.snapshot.parameters.angle + 27
    && reply.status.tapActivity.some(value => value > 0), 'same-grammar pre-recall sound');
  const pendingBefore = await page.evaluate(() => { __delayFixture.holdNextInstallAck = true; return __delayFixture.pendingInstall.length; });
  await page.locator('.instrument-preset-controls summary').click();
  await page.locator(`[data-full-preset][data-preset-id="${pine.id}"]`).click();
  await page.waitForFunction(count => __delayFixture.pendingInstall.length > count, pendingBefore);
  await page.waitForTimeout(350); await page.evaluate(() => { __delayCanvas.frames = []; });
  await page.waitForFunction(() => __delayCanvas.frames.length >= 3);
  assert.ok((await page.evaluate(() => __delayCanvas.frames)).every(frame =>
    frame.paths.every(path => path.color === '#fff3d6' && !path.descendant)),
  'same-grammar pending scene stays neutral on descendants until the pool ACK, including historical fallback');
  await page.evaluate(() => __delayFixture.pendingInstall.at(-1)());
  const ackedRecall = await until(page, reply => matchesPreset(reply, pine)
    && reply.status.topologyRevision === reply.topologyRevision, 'same-grammar pool ACK and matching meters');
  await page.waitForFunction(id => document.querySelector('.instrument-preset-controls').dataset.presetId === id
    && document.querySelector('.instrument-preset-controls').getAttribute('aria-busy') !== 'true', pine.id);
  report.pendingSceneCausality = { sameGrammar: true, sameGenerations: true, descendantsQuietUntilAck: true,
    matchingRevision: ackedRecall.topologyRevision };
  await page.locator('#automatic').evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await range(page, 'voiceCeiling', 0);
  await until(page, reply => reply.performance.automatic && reply.performance.voiceCeiling === 0, 'restore adaptive policy');
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

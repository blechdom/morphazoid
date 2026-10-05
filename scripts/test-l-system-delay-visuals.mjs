#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, L_SYSTEM_TYPES, buildPreview, sanitizeParameters } from '../src/instruments/micmic/native/model.js';

import { generationTopology } from '../src/instruments/micmic/micmic.js';
import { L_SYSTEM_PRESETS } from '../src/instruments/l-system/l-system.js';
import { decodeUtf8, withJson } from '../src/instruments/micmic/native/wasm-abi.js';

// Compile authoritative deep-topology fixtures with the published Rust WASM.
// Only this Canvas fixture harness substitutes the browser engine bridge;
// real audio/worklet acceptance lives in test-l-system-delay-wasm.mjs.
// Path2D inspection exercises the complete Canvas fallback. GPU shader and
// normal WebGL/WASM lifecycle acceptance live in l-system-delay-gpu.spec.mjs.
const root = resolve(process.env.MORPHAZOID_VISUAL_QA_ROOT ?? fileURLToPath(new URL('../', import.meta.url)));
const artifacts = process.env.MORPHAZOID_VISUAL_QA_ARTIFACTS ? resolve(process.env.MORPHAZOID_VISUAL_QA_ARTIFACTS) : resolve(root, 'artifacts/l-system-delay-visual-causality');
await mkdir(artifacts, { recursive: true });
const bank = JSON.parse(await readFile(resolve(root, 'src/instruments/micmic/native/presets.json'), 'utf8'));
const authoritativeFixtures = new Map();
const fixtureKey = parameters => JSON.stringify(sanitizeParameters(parameters));
const { instance: compiler } = await WebAssembly.instantiate(await readFile(resolve(root, 'assets/wasm/l-system-delay.wasm')), {});
const compilerApi = compiler.exports;
for (const id of ['cedar', 'aspen', 'foxglove']) {
    const preset = bank.find(preset => preset.id === id);
    assert.ok(preset && preset.snapshot.parameters.generations > 13, `${id}: deep factory preset`);
    const handle = withJson(compilerApi, preset.snapshot.parameters, (pointer, length) => compilerApi.lsd_compile(pointer, length, 48000));
    assert.ok(handle, `${id}: Rust WASM topology compiled`);
    try {
      const preview = JSON.parse(decodeUtf8(new Uint8Array(compilerApi.memory.buffer,
        compilerApi.lsd_compile_json_ptr(handle), compilerApi.lsd_compile_json_len(handle))));
      assert.ok(preview.nodes.length > 1 && preview.parameters.generations > 13, `${id}: authoritative preview of the actual deep Rust topology`);
      authoritativeFixtures.set(fixtureKey(preset.snapshot.parameters), { preview, requestedVoices: preview.requestedVoices,
        eligibleVoices: preview.eligibleVoices, previewRequests: 0 });
    } finally { compilerApi.lsd_compile_free(handle); }
}
let actualRevision = 1;
let renderChangesImmediately = false;
let audioClockStarted = Date.now(), audioClockOffset = 4, audioClockPaused = false;
let inputEnvelopeValue = null, inputEnvelopePulse = null;
const state = { parameters: { ...DEFAULT_PARAMETERS, generations: 10 }, performance: { ...DEFAULT_PERFORMANCE },
  topologyRevision: 1, audio: true, requestedVoices: 2046, eligibleVoices: 2046, generationLimits: { pythagorean: 20, cantor: 30 },
  status: { topologyRevision: 1, voiceLimit: 1000, activeVoices: 1000, cpuLoad: .2, peakLoad: .3,
    inputPeak: 0, tapVoiceIndices: [0, 1], tapActivity: [.3, 0], wetBusGain: .7, elapsedSeconds: 4 } };
let countTopologyKey = '', countTopology = [], countAdmissionKey = '';
function updateGenerationVoiceCounts() {
  const topologyKey = JSON.stringify(state.parameters);
  if (topologyKey !== countTopologyKey) {
    countTopologyKey = topologyKey;
    countTopology = authoritativeFixtures.get(fixtureKey(state.parameters))?.preview.nodes
      ?? buildPreview(state.parameters, generationTopology);
    countAdmissionKey = '';
  }
  const admissionKey = `${topologyKey}:${state.status.voiceLimit}`;
  if (admissionKey === countAdmissionKey) return;
  countAdmissionKey = admissionKey;
  state.status.generationVoiceCounts = Array(53).fill(0);
  for (const node of countTopology) if (node.generation > 0 && node.gain > 0
    && Number.isInteger(node.priority) && node.priority >= 0 && node.priority < state.status.voiceLimit)
    state.status.generationVoiceCounts[node.generation]++;
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/src/instruments/micmic/native/browser-engine.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(`export function createBrowserDelayEngine({ onStatus = () => {} } = {}) {
        return { request: async (path, body) => {
          const response = await fetch('/api/l-system-delay' + path.slice(4), body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
          });
          if (!response.ok) throw new Error('Visual fixture request failed');
          const reply = await response.json();
          if (path === '/api/status') onStatus(reply);
          return reply;
        }, getSampleTime: () => null, prepareAudio: async () => {}, muteForDeparture() {}, dispose() {} };
      }`);
      return;
    }
    if (url.pathname.startsWith('/api/l-system-delay/')) {
      if (request.method === 'POST') {
        let text = ''; for await (const chunk of request) text += chunk;
        const body = JSON.parse(text);
        if (url.pathname.endsWith('/parameters')) {
          state.parameters = body; state.topologyRevision++;
          if (renderChangesImmediately) actualRevision = state.topologyRevision;
          const fixture = authoritativeFixtures.get(fixtureKey(body));
          if (fixture) { state.requestedVoices = fixture.requestedVoices; state.eligibleVoices = fixture.eligibleVoices; }
        }
        if (url.pathname.endsWith('/performance')) state.performance = body;
        if (url.pathname.endsWith('/audio')) state.audio = body.enabled;
      }
      if (url.pathname.endsWith('/preview')) {
        const fixture = authoritativeFixtures.get(fixtureKey(state.parameters));
        if (!fixture) throw new Error('No authoritative fixture for this deep topology');
        fixture.previewRequests++;
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(fixture.preview)); return;
      }
      updateGenerationVoiceCounts();
      state.status.topologyRevision = actualRevision;
      state.status.elapsedSeconds = audioClockOffset + (audioClockPaused ? 0 : (Date.now() - audioClockStarted) / 1000);
      if (inputEnvelopeValue !== null || inputEnvelopePulse) state.status.inputEnvelope = { interval: .01,
        endTime: state.status.elapsedSeconds, values: Array.from({ length: 4000 }, (_, index) => {
          if (!inputEnvelopePulse) return inputEnvelopeValue;
          const time = state.status.elapsedSeconds - (3999 - index) * .01;
          return time >= inputEnvelopePulse.start && time <= inputEnvelopePulse.end ? inputEnvelopePulse.value : 0;
        }) };
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(state)); return;
    }
    const publicPath = url.pathname === '/l-mic-rust.html' ? '/src/pages/l-mic-rust.html' : url.pathname;
    const path = resolve(root, `.${publicPath}`);
    if (!path.startsWith(`${root}/`)) throw new Error('Invalid public path');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }); response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}/l-mic-rust.html?renderer=canvas`;
async function installCanvasAudit(page) {
  await page.addInitScript(() => {
    const native = Path2D;
    window.Path2D = class extends native {
      constructor(...args) { super(...args); this.auditSubpaths = []; }
      moveTo(...args) { this.auditSubpaths.push([args]); return super.moveTo(...args); }
      lineTo(...args) { this.auditSubpaths.at(-1)?.push(args); return super.lineTo(...args); }
    };
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect, stroke = proto.stroke, begin = proto.beginPath, move = proto.moveTo, line = proto.lineTo;
    const colors = new Set(['#fff3d6', '#55d9ff', '#5fe8c4', '#7db4ff', '#c79bff', '#ff826f', '#e8c46b']);
    window.visualAudit = { frames: [], current: null, telemetry: null };
    const requestFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = function (callback) {
      return requestFrame.call(this, timestamp => { window.visualAudit.lastRafTime = timestamp; callback(timestamp); });
    };
    const readJson = Response.prototype.json;
    Response.prototype.json = async function (...args) {
      const body = await readJson.apply(this, args);
      if (body?.status?.tapActivity) window.visualAudit.telemetry = { receivedAt: performance.now(),
        hasInputEnvelope: Boolean(body.status.inputEnvelope), topologyRevision: body.topologyRevision,
        renderedRevision: body.status.topologyRevision, voiceCounts: body.status.generationVoiceCounts, voiceLimit: body.status.voiceLimit,
        elapsedSeconds: body.status.elapsedSeconds, inputEnvelopeEndTime: body.status.inputEnvelope?.endTime };
      return body;
    };
    proto.clearRect = function (...args) {
      if (this.canvas.id === 'stage') {
        const previous = window.visualAudit.current;
        if (previous) window.visualAudit.frames.push(previous);
        if (window.visualAudit.frames.length > 6) window.visualAudit.frames.shift();
        window.visualAudit.current = { at: performance.now(), telemetryAgeMs: window.visualAudit.telemetry
          ? Math.max(0, (window.visualAudit.lastRafTime ?? performance.now()) - window.visualAudit.telemetry.receivedAt) : null,
        telemetryElapsedSeconds: window.visualAudit.telemetry?.elapsedSeconds,
        inputEnvelopeEndTime: window.visualAudit.telemetry?.inputEnvelopeEndTime,
        topologyRevision: window.visualAudit.telemetry?.topologyRevision,
        coverage: 0, baselineAlphas: [], baselines: [], glows: [] };
      }
      return clear.apply(this, args);
    };
    proto.beginPath = function (...args) { this.auditSubpaths = []; return begin.apply(this, args); };
    proto.moveTo = function (...args) { this.auditSubpaths?.push([args]); return move.apply(this, args); };
    proto.lineTo = function (...args) { this.auditSubpaths?.at(-1)?.push(args); return line.apply(this, args); };
    proto.stroke = function (path, ...args) {
      const current = window.visualAudit.current;
      if (this.canvas.id === 'stage' && current) {
        const transform = this.getTransform(), dpr = Math.min(2, window.devicePixelRatio || 1);
        const displayWidth = this.lineWidth * Math.hypot(transform.a, transform.b) / dpr;
        const baseline = !colors.has(this.strokeStyle) && Boolean(path?.auditSubpaths);
        const subpaths = path?.auditSubpaths ?? this.auditSubpaths ?? [];
        const project = point => [(transform.a * point[0] + transform.c * point[1] + transform.e) / dpr,
          (transform.b * point[0] + transform.d * point[1] + transform.f) / dpr];
        const describe = points => {
          const projected = points.map(project), start = projected[0], end = projected.at(-1);
          const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
          let interiorDeviation = 0, signature = 0, bentProgress = 0, bentCount = 0, quietInteriorCount = 0;
          for (let index = 1; index < projected.length - 1; index++) {
            const point = projected[index], displacement = length > 1e-9
              ? (dx * (point[1] - start[1]) - dy * (point[0] - start[0])) / length : 0;
            interiorDeviation = Math.max(interiorDeviation, Math.abs(displacement));
            signature += displacement * (index + .37);
            if (Math.abs(displacement) > .00001) {
              bentProgress += length > 1e-9 ? ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (length * length) : 0;
              bentCount++;
            } else quietInteriorCount++;
          }
          return { color: this.strokeStyle, alpha: this.globalAlpha, start, end,
            projectedPoints: window.__delayAuditPoints ? projected : undefined, lineWidth: displayWidth,
            pointCount: projected.length, interiorDeviation, signature, bentCount, quietInteriorCount,
            bentMeanProgress: bentCount ? bentProgress / bentCount : null };
        };
        const segments = subpaths.filter(points => points.length >= 2);
        if (baseline) {
          current.coverage += segments.length; current.baselineAlphas.push(this.globalAlpha);
          current.baselines.push(...segments.map(describe));
        } else if (colors.has(this.strokeStyle) && segments.length && this.globalAlpha > .00001) {
          for (const points of segments) current.glows.push({ ...describe(points), subpathCount: 1 });
        }
      }
      return path === undefined ? stroke.call(this) : stroke.call(this, path, ...args);
    };
  });
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], consoleErrors = [];
  const observeErrors = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  };
  observeErrors(page);
  await installCanvasAudit(page);
  await page.goto(address);
  const initialCoverage = buildPreview(state.parameters, generationTopology).length;
  const freshFrames = async (page, milliseconds = 400) => {
    const since = await page.evaluate(() => performance.now());
    await page.waitForTimeout(milliseconds);
    await page.waitForFunction(since => visualAudit.frames.filter(frame => frame.at > since).length >= 2, since);
    return page.evaluate(since => visualAudit.frames.filter(frame => frame.at > since).slice(-2), since);
  };
  const neutral = (frames, expected, label) => {
    assert.ok(frames.every(frame => frame.coverage + frame.glows.length === expected), `${label}: colored availability and grey unavailable branches cover the complete tree`);
    assert.ok(frames.every(frame => frame.baselines.every(branch => branch.pointCount === 2 && branch.interiorDeviation < 1e-8)),
      `${label}: the quiet outline stays straight`);
  };
  const waves = frame => frame.glows.filter(branch => branch.interiorDeviation > 1e-8);
  const availability = (frames, expected, label) => {
    assert.ok(frames.every(frame => frame.glows.length === expected), `${label}: every admitted branch has a complete colored line`);
    assert.ok(frames.every(frame => frame.glows.every(branch => branch.subpathCount === 1)), `${label}: colored availability never breaks into fragments`);
    const styles = frames.flatMap(frame => frame.glows.map(branch => [branch.alpha, branch.lineWidth]));
    assert.ok(styles.every(([alpha, width]) => Math.abs(alpha - styles[0][0]) < 1e-12
      && Math.abs(width - styles[0][1]) < 1e-12), `${label}: input and delay strokes share a fixed thin style independent of sound`);
  };
  await page.waitForFunction(coverage => visualAudit.frames.length >= 3
    && visualAudit.frames.slice(-3).every(frame => frame.coverage + frame.glows.length === coverage && frame.glows.length === 1001), initialCoverage);
  let frames = await page.evaluate(() => visualAudit.frames.slice(-3));
  const firstWave = waves(frames[0])[0];
  assert.ok(firstWave && frames.some(frame => Math.abs(waves(frame)[0]?.signature - firstWave.signature) > .01),
    'the actual sounding tap moves with audio time');
  const pressureChecks = [];
  for (const [name, load, peak] of [['normal', .2, .3], ['moderate', .7, .86], ['severe', .9, .96]]) {
    state.status.cpuLoad = load; state.status.peakLoad = peak;
    frames = await freshFrames(page, 650);
    neutral(frames, initialCoverage, name); availability(frames, 1001, name);
    assert.ok(frames.every(frame => waves(frame).length === 1), `${name}: only the sounding sibling receives a wave`);
    pressureChecks.push({ name, load, peak, previewSegments: initialCoverage,
      unavailableGreySegments: initialCoverage - 1001, coloredAvailableSegments: 1001, signalCurves: 1 });
  }
  const firstEndpoint = waves(frames.at(-1))[0].end;
  state.status.tapVoiceIndices = [1, 0]; state.status.tapActivity = [0, .3];
  frames = await freshFrames(page);
  assert.deepEqual(waves(frames.at(-1))[0].end, firstEndpoint, 'rank reordering retains the sounding branch');
  state.status.voiceLimit = 0; state.status.activeVoices = 1;
  frames = await freshFrames(page); neutral(frames, initialCoverage, 'admission shrink');
  availability(frames, 2, 'released tap');
  assert.ok(frames.every(frame => waves(frame).length === 1), 'a measured releasing tap remains visible after admission shrinks');
  state.status.wetBusGain = 0; frames = await freshFrames(page, 1800);
  availability(frames, 1, 'wet mute after admission shrink');
  assert.ok(frames.every(frame => waves(frame).length === 0), 'a muted wet bus removes descendant waves');
  state.status.voiceLimit = 1000; state.status.activeVoices = 1000; state.status.wetBusGain = .7;
  await page.locator('#lSystemType').evaluate(input => { input.value = 'cantor'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  frames = await freshFrames(page, 550);
  assert.ok(frames.every(frame => waves(frame).length === 0), 'old geometry meters cannot vibrate a new grammar');
  actualRevision = state.topologyRevision; frames = await freshFrames(page, 450);
  assert.ok(frames.every(frame => waves(frame).length === 1), 'matching topology RMS vibrates the measured tap');
  await page.close();

  // Availability is the complete colored line; the sound packet is measured
  // from its perpendicular deflection along the independently recorded axis.
  state.parameters = { ...DEFAULT_PARAMETERS, lSystemType: 'cantor', generations: 1,
    intervalMs: 3000, timeRatio: 2, angle: 0, pitchScale: 0, depth: .8 };
  state.topologyRevision++; actualRevision = state.topologyRevision;
  state.performance = { ...DEFAULT_PERFORMANCE, wet: 1 }; state.audio = true;
  Object.assign(state.status, { voiceLimit: 1, activeVoices: 1, cpuLoad: .2, peakLoad: .3,
    inputPeak: 0, wetBusGain: 1, tapVoiceIndices: [0], tapActivity: [0] });
  inputEnvelopePulse = { start: 10, end: 10.24, value: .03 };
  audioClockPaused = true; audioClockOffset = 10.3; audioClockStarted = Date.now();
  const pulsePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await pulsePage.addInitScript(() => { window.__delayAuditPoints = true; });
  observeErrors(pulsePage); await installCanvasAudit(pulsePage); await pulsePage.goto(address);
  await pulsePage.waitForFunction(() => visualAudit.frames.length >= 2
    && visualAudit.frames.at(-1).glows.some(branch => branch.color === '#55d9ff')
    && visualAudit.frames.at(-1).coverage + visualAudit.frames.at(-1).glows.length === 2);
  const pulseAxis = await pulsePage.evaluate(() => {
    const branch = visualAudit.frames.at(-1).glows.find(branch => branch.color === '#55d9ff');
    return { start: branch.start, end: branch.end };
  });
  const pulsePositions = [];
  const pulseDelay = buildPreview(state.parameters, generationTopology).find(node => node.priority === 0).delay;
  for (const [name, seconds] of [['early', 10.5], ['middle', 11], ['late', 11.5]]) {
    audioClockOffset = seconds; audioClockStarted = Date.now();
    const changedAt = await pulsePage.evaluate(() => performance.now());
    await pulsePage.waitForFunction(({ changedAt, seconds }) => visualAudit.frames.slice(-2).length === 2
      && visualAudit.frames.slice(-2).every(frame => frame.at > changedAt + 60
        && frame.telemetryElapsedSeconds === seconds && frame.inputEnvelopeEndTime === seconds
        && frame.telemetryAgeMs <= 100 && frame.glows.some(branch => branch.color === '#55d9ff' && branch.interiorDeviation > .1)),
      { changedAt, seconds });
    const frame = await pulsePage.evaluate(() => visualAudit.frames.at(-1));
    neutral([frame], 2, name); availability([frame], 2, name);
    const descendant = frame.glows.find(branch => branch.color === '#55d9ff'), axis = pulseAxis;
    assert.deepEqual(descendant.start, axis.start); assert.deepEqual(descendant.end, axis.end);
    const dx = axis.end[0] - axis.start[0], dy = axis.end[1] - axis.start[1], squaredLength = dx * dx + dy * dy;
    const positions = descendant.projectedPoints.map(([x, y]) => ({
      progress: ((x - axis.start[0]) * dx + (y - axis.start[1]) * dy) / squaredLength,
      weight: Math.abs(dx * (y - axis.start[1]) - dy * (x - axis.start[0])) / Math.sqrt(squaredLength),
    })).filter(point => point.weight > 1e-5);
    const weight = positions.reduce((sum, point) => sum + point.weight, 0);
    const activatedPosition = positions.reduce((sum, point) => sum + point.progress * point.weight, 0) / weight;
    const renderedSeconds = frame.telemetryElapsedSeconds + Math.min(2, frame.telemetryAgeMs / 1000);
    const expectedPosition = (renderedSeconds - (inputEnvelopePulse.start + inputEnvelopePulse.end) / 2) / pulseDelay;
    assert.ok(descendant.interiorDeviation >= .1, `${name}: the ordinary packet visibly bends its active portion`);
    assert.ok(Math.abs(activatedPosition - expectedPosition) < .14, `${name}: the active wave position follows the audio timestamp`);
    assert.ok(Math.max(...positions.map(point => point.progress)) - Math.min(...positions.map(point => point.progress)) < .5,
      `${name}: the packet bends only the portion currently carrying signal`);
    pulsePositions.push({ name, seconds, activatedPosition, expectedPosition, maximumDeflectionCssPx: descendant.interiorDeviation });
    await pulsePage.locator('#stage').screenshot({ path: resolve(artifacts, `pulse-${name}.png`) });
  }
  assert.ok(pulsePositions[1].activatedPosition > pulsePositions[0].activatedPosition + .1);
  assert.ok(pulsePositions[2].activatedPosition > pulsePositions[1].activatedPosition + .1);
  inputEnvelopePulse = null; inputEnvelopeValue = 0; frames = await freshFrames(pulsePage, 450);
  availability(frames, 2, 'long pulse silence');
  assert.ok(frames.every(frame => waves(frame).length === 0), 'silence straightens the traveling packet without hiding availability');
  await pulsePage.close(); audioClockPaused = false; audioClockStarted = Date.now();

  // Deep full-scene recall uses the actual WASM topology, independently of
  // audio admission. Unmetered history remains a signal-only fallback.
  renderChangesImmediately = true; state.parameters = { ...DEFAULT_PARAMETERS, generations: 4 };
  state.topologyRevision++; actualRevision = state.topologyRevision;
  state.performance = { ...DEFAULT_PERFORMANCE }; state.audio = true;
  state.generationLimits = Object.fromEntries(L_SYSTEM_TYPES.map(type => [type, 30]));
  Object.assign(state.status, { voiceLimit: 1000, activeVoices: 1000, cpuLoad: .2, peakLoad: .3,
    inputPeak: 0, wetBusGain: 1, tapVoiceIndices: [], tapActivity: [] });
  inputEnvelopeValue = .03; audioClockOffset = 60; audioClockStarted = Date.now();
  const deepPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  observeErrors(deepPage); await installCanvasAudit(deepPage); await deepPage.goto(address);
  await deepPage.waitForFunction(() => document.querySelector('.instrument-preset-controls'));
  const advancedPresetChecks = [];
  for (const id of ['cedar', 'aspen', 'foxglove']) {
    const preset = bank.find(preset => preset.id === id), fixture = authoritativeFixtures.get(fixtureKey(preset.snapshot.parameters));
    const before = fixture.previewRequests;
    await deepPage.locator('.instrument-preset-controls summary').click();
    await deepPage.locator(`[data-full-preset][data-preset-id="${id}"]`).click();
    await deepPage.waitForFunction(id => document.querySelector('.instrument-preset-controls').dataset.presetId === id, id);
    await deepPage.waitForFunction(({ expected, revision }) => visualAudit.frames.slice(-3).length === 3
      && visualAudit.frames.slice(-3).every(frame => frame.topologyRevision === revision
        && frame.coverage + frame.glows.length === expected && frame.glows.length > 0),
      { expected: fixture.preview.nodes.length, revision: state.topologyRevision });
    frames = await deepPage.evaluate(() => visualAudit.frames.slice(-3)); neutral(frames, fixture.preview.nodes.length, id);
    assert.ok(frames.some(frame => waves(frame).length > 0), `${id}: unmetered history still produces actual moving waves`);
    assert.ok(fixture.previewRequests > before); assert.equal(state.audio, true);
    advancedPresetChecks.push({ id, generations: state.parameters.generations, requestedTaps: fixture.requestedVoices,
      unavailableGreySegments: frames.at(-1).coverage, coloredAvailableSegments: frames.at(-1).glows.length,
      signalCurves: waves(frames.at(-1)).length, previewRequests: fixture.previewRequests - before });
  }
  await deepPage.close();

  // All grammars receive explicit measured RMS and ordinary capture history.
  // Available quiet voices stay colored and straight; only unavailable voices
  // use the grey skeleton. Capacity growth must never invent a moving wave.
  const denseGrammarChecks = [];
  for (const lSystemType of L_SYSTEM_TYPES) {
    const scene = bank.find(p => p.id === lSystemType) ?? bank.find(p => p.snapshot.parameters.lSystemType === lSystemType);
    const grammar = L_SYSTEM_PRESETS.find(p => p.id === lSystemType);
    const parameters = { ...DEFAULT_PARAMETERS, angle: grammar?.angle ?? 45, ...scene?.snapshot.parameters, lSystemType, generations: 13 };
    const nodes = buildPreview(parameters, generationTopology);
    const admitted = nodes.filter(n => Number.isInteger(n.priority) && n.priority >= 0 && n.gain > 0).sort((a, b) => a.priority - b.priority);
    const metered = admitted.slice(0, 2048);
    state.parameters = parameters; state.topologyRevision++; actualRevision = state.topologyRevision;
    state.performance = { ...DEFAULT_PERFORMANCE }; state.audio = true; inputEnvelopeValue = .03;
    audioClockOffset = 60; audioClockStarted = Date.now();
    Object.assign(state.status, { voiceLimit: admitted.length, activeVoices: admitted.length, cpuLoad: .2, peakLoad: .3, inputPeak: 0,
      wetBusGain: 1, tapVoiceIndices: metered.map(n => n.voiceIndex), tapActivity: metered.map(() => .0005) });
    const fixturePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    observeErrors(fixturePage); await installCanvasAudit(fixturePage); await fixturePage.goto(address);
    await fixturePage.waitForFunction(() => visualAudit.frames.length >= 3);
    const conditions = [];
    for (const [name, load, peak] of [['normal', .2, .3], ['severe', .9, .98]]) {
      state.status.cpuLoad = load; state.status.peakLoad = peak;
      frames = await freshFrames(fixturePage, name === 'normal' ? 350 : 700);
      neutral(frames, nodes.length, `${lSystemType}/${name}`); availability(frames, admitted.length + 1, `${lSystemType}/${name}`);
      assert.ok(frames.some(frame => waves(frame).some(branch => branch.interiorDeviation >= 1)),
        `${lSystemType}/${name}: actual sounding descendants have visible CSS-pixel movement`);
      const moving = frames.at(-1).glows.filter((branch, i) => frames[0].glows[i]
        && Math.abs(branch.signature - frames[0].glows[i].signature) > .01).length;
      assert.ok(moving > 0, `${lSystemType}/${name}: waves advance in audio time`);
      conditions.push({ name, previewSegments: nodes.length, unavailableGreySegments: frames.at(-1).coverage,
        coloredAvailableSegments: admitted.length + 1,
        maximumDeflectionCssPx: Math.max(...frames.flatMap(frame => frame.glows.map(branch => branch.interiorDeviation))), moving });
    }
    inputEnvelopeValue = 0; state.status.tapActivity.fill(0); state.status.inputPeak = 0;
    const silenceStarted = await fixturePage.evaluate(() => performance.now());
    await fixturePage.waitForFunction(since => visualAudit.frames.length >= 2
      && visualAudit.frames.slice(-2).every(frame => frame.at > since
        && frame.glows.every(branch => branch.interiorDeviation < 1e-8)), silenceStarted, { timeout: 5000 });
    frames = await fixturePage.evaluate(() => visualAudit.frames.slice(-2));
    availability(frames, admitted.length + 1, `${lSystemType}/silence`);
    assert.ok(frames.every(frame => waves(frame).length === 0), `${lSystemType}: capture/tap silence removes waves while retaining availability colors`);
    const silentAdmission = [];
    for (const limit of [0, Math.min(31, admitted.length), admitted.length]) {
      state.status.voiceLimit = limit; state.status.activeVoices = limit;
      // Wait for the fixture's new admission snapshot before collecting frames;
      // a slow 8-fps renderer must not compare the previous limit with this one.
      await fixturePage.waitForFunction(limit => visualAudit.telemetry?.voiceLimit === limit, limit);
      frames = await freshFrames(fixturePage, 300);
      neutral(frames, nodes.length, `${lSystemType}/silent${limit}`); availability(frames, limit + 1, `${lSystemType}/silent${limit}`);
      assert.ok(frames.every(frame => waves(frame).length === 0), `${lSystemType}: adding available silent voices never invents a wave`);
      silentAdmission.push({ voices: limit, neutralSegments: frames.at(-1).coverage, coloredAvailableSegments: limit + 1, movingWaves: 0 });
    }
    state.status.wetBusGain = 0; state.status.inputPeak = .03; state.status.tapActivity.fill(.003); inputEnvelopeValue = .03;
    frames = await freshFrames(fixturePage, 1500);
    availability(frames, admitted.length + 1, `${lSystemType}/wet mute`);
    assert.ok(frames.every(frame => waves(frame).length === 1 && waves(frame)[0].color === '#fff3d6'),
      `${lSystemType}: wet mute straightens descendants while the input root remains responsive`);
    denseGrammarChecks.push({ lSystemType, requestedTaps: admitted.length, meteredTaps: metered.length, conditions, silentAdmission });
    await fixturePage.close();
    console.log(`${lSystemType}: complete colored availability, actual moving waves, silent capacity growth and wet mute passed`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
  const report = { browserErrors: errors, browserConsoleErrors: consoleErrors, denseGrammarChecks, pressureChecks, pulsePositions,
    advancedPresetChecks, authoritativeDeepFixtureCompiler: 'Rust WASM', staticNeutralOutline: true, availabilityIndependentOfAmplitude: true,
    individualSiblingIsolation: true, reorderedRankContinuity: true, measuredReleaseAfterAdmissionShrink: true,
    mutedWetBusNoWaves: true, staleGrammarRejected: true, perPositionImpulseTravel: true, mockedAudioTelemetry: true, nativeDeviceStarted: false };
  await writeFile(resolve(artifacts, 'visual-qa.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ denseGrammarCount: denseGrammarChecks.length, availabilityIndependentOfAmplitude: true,
    longDelayPulsePositions: pulsePositions, artifacts }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';
import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, L_SYSTEM_TYPES, buildPreview, sanitizeParameters } from '../src/instruments/micmic/native/model.js';

import { generationTopology } from '../src/instruments/micmic/micmic.js';
import { L_SYSTEM_PRESETS } from '../src/instruments/l-system/l-system.js';

// Build the Rust app before running this harness. An isolated --no-device
// companion compiles authoritative deep-topology fixtures. The browser API is
// mocked; this never touches live CPAL, microphone access or an audio device.
const root = resolve(process.env.MORPHAZOID_VISUAL_QA_ROOT ?? fileURLToPath(new URL('../', import.meta.url)));
const artifacts = process.env.MORPHAZOID_VISUAL_QA_ARTIFACTS ? resolve(process.env.MORPHAZOID_VISUAL_QA_ARTIFACTS) : resolve(root, 'artifacts/l-system-delay-visual-causality');
await mkdir(artifacts, { recursive: true });
const bank = JSON.parse(await readFile(resolve(root, 'src/instruments/micmic/native/presets.json'), 'utf8'));
const authoritativeFixtures = new Map();
const fixtureKey = parameters => JSON.stringify(sanitizeParameters(parameters));
const compiler = spawn(resolve(root, 'src/instruments/micmic/rust/target/release/l-system-delay-app'),
  ['--port', '0', '--no-device'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let compilerLogs = '';
compiler.stderr.on('data', chunk => { compilerLogs += chunk; });
try {
  const compilerAddress = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fixture compiler did not start: ${compilerLogs}`)), 10000);
    compiler.once('error', error => { clearTimeout(timer); reject(error); });
    compiler.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture compiler exited ${code}: ${compilerLogs}`)); });
    compiler.stdout.on('data', chunk => {
      compilerLogs += chunk;
      const match = compilerLogs.match(/http:\/\/localhost:\d+\//);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const compilerJson = async (path, body) => {
    const response = await fetch(new URL(path, compilerAddress), body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.ok(response.ok, `${path}: ${result.error ?? response.status}`);
    return result;
  };
  for (const id of ['cedar', 'aspen', 'foxglove']) {
    const preset = bank.find(preset => preset.id === id);
    assert.ok(preset && preset.snapshot.parameters.generations > 13, `${id}: deep factory preset`);
    const snapshot = await compilerJson('/api/parameters', preset.snapshot.parameters);
    const preview = await compilerJson('/api/preview');
    assert.equal(snapshot.audio, false, 'The fixture compiler never opens an audio device');
    assert.ok(preview.nodes.length > 1 && preview.parameters.generations > 13, `${id}: authoritative preview of the actual deep native topology`);
    authoritativeFixtures.set(fixtureKey(preset.snapshot.parameters), { preview, requestedVoices: snapshot.requestedVoices,
      eligibleVoices: snapshot.eligibleVoices, previewRequests: 0 });
  }
} finally {
  compiler.kill('SIGTERM');
  if (compiler.exitCode === null && compiler.signalCode === null) await new Promise(resolve => compiler.once('exit', resolve));
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
const address = `http://127.0.0.1:${server.address().port}/l-mic-rust.html`;
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
        renderedRevision: body.status.topologyRevision, voiceCounts: body.status.generationVoiceCounts,
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
        coverage: 0, baselineAlphas: [], baselines: [], glows: [] };
      }
      return clear.apply(this, args);
    };
    proto.beginPath = function (...args) { this.auditSubpaths = []; return begin.apply(this, args); };
    proto.moveTo = function (...args) { this.auditSubpaths?.push([args]); return move.apply(this, args); };
    proto.lineTo = function (...args) { this.auditSubpaths?.at(-1)?.push(args); return line.apply(this, args); };
    proto.stroke = function (path, ...args) {
      const current = window.visualAudit.current;
      if (this.canvas.id === 'stage' && current && colors.has(this.strokeStyle)) {
        const transform = this.getTransform(), dpr = Math.min(2, window.devicePixelRatio || 1);
        const displayWidth = this.lineWidth * Math.hypot(transform.a, transform.b) / dpr;
        const baseline = Math.abs(displayWidth - .95) < 1e-5 || Math.abs(displayWidth - 1.85) < 1e-5;
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
          return { color: this.strokeStyle, alpha: this.globalAlpha, start, end, lineWidth: displayWidth,
            pointCount: projected.length, interiorDeviation, signature, bentCount, quietInteriorCount,
            bentMeanProgress: bentCount ? bentProgress / bentCount : null };
        };
        const segments = subpaths.filter(points => points.length >= 2);
        if (baseline) {
          current.coverage += segments.length; current.baselineAlphas.push(this.globalAlpha);
          current.baselines.push(...segments.map(describe));
        } else if (segments.length && this.globalAlpha > .00001) {
          const glow = describe(segments.flat()); glow.subpathCount = segments.length;
          current.glows.push(glow);
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
  await page.waitForFunction(() => visualAudit.frames.length > 3
    && visualAudit.frames.slice(-3).every(frame => frame.coverage === 1001 && frame.glows.length === 1));
  const movingFrames = await page.evaluate(() => visualAudit.frames.slice(-3));
  assert.ok(movingFrames.every(frame => frame.glows.length === 1), 'the fallback fixture isolates the actual sounding tap');
  assert.ok(movingFrames.some(frame => Math.abs(frame.glows[0].signature - movingFrames[0].glows[0].signature) > .01),
    'constant sounding tap changes wave position as the audio clock advances');
  const pressureChecks = [];
  for (const [name, load, peak] of [['normal', .2, .3], ['moderate', .7, .86], ['severe', .9, .96]]) {
    state.status.cpuLoad = load; state.status.peakLoad = peak;
    await page.waitForTimeout(700);
    const observed = await page.evaluate(() => visualAudit.frames.slice(-3));
    assert.ok(observed.every(frame => frame.coverage === 1001), `${name}: every admitted branch remains colored`);
    await page.locator('#stage').screenshot({ path: resolve(artifacts, `1000-voices-${name}.png`) });
    pressureChecks.push({ name, load, peak, admittedSegments: 1001 });
  }
  let frames = await page.evaluate(() => visualAudit.frames.slice(-3));
  assert.ok(frames.every(frame => frame.coverage === 1001), JSON.stringify(frames));
  assert.ok(frames.every(frame => frame.glows.length === 1), 'only the sounding sibling glows');
  const firstEndpoint = frames.at(-1).glows[0].end;
  state.status.tapVoiceIndices = [1, 0]; state.status.tapActivity = [0, .3];
  await page.waitForTimeout(400);
  frames = await page.evaluate(() => visualAudit.frames.slice(-3));
  assert.ok(frames.every(frame => frame.coverage === 1001));
  assert.deepEqual(frames.at(-1).glows[0].end, firstEndpoint, 'rank reordering retains the sounding branch');
  state.status.voiceLimit = 0; state.status.activeVoices = 1;
  await page.waitForTimeout(450);
  frames = await page.evaluate(() => visualAudit.frames.slice(-2));
  assert.ok(frames.every(frame => frame.coverage === 1), 'removed admission color leaves only the root skeleton');
  assert.ok(frames.every(frame => frame.glows.length === 1), 'measured releasing tap remains visible');
  assert.deepEqual(frames.at(-1).glows[0].end, firstEndpoint);
  state.status.voiceLimit = 1000; state.status.activeVoices = 1000;
  state.status.wetBusGain = 0;
  await page.waitForTimeout(1800);
  frames = await page.evaluate(() => visualAudit.frames.slice(-3));
  assert.ok(frames.every(frame => frame.glows.length === 0), 'zero output bus leaves all descendants dark');
  state.status.wetBusGain = .7;
  await page.locator('#lSystemType').evaluate(input => { input.value = 'cantor'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(550);
  frames = await page.evaluate(() => visualAudit.frames.slice(-2));
  assert.ok(frames.every(frame => frame.glows.length === 0), 'old geometry meters cannot light a new grammar');
  actualRevision = state.topologyRevision;
  await page.waitForTimeout(450);
  frames = await page.evaluate(() => visualAudit.frames.slice(-2));
  assert.ok(frames.every(frame => frame.glows.length === 1), 'matching native topology lights the actual tap');
  await page.close();
  // A short input packet must move through positions on one delayed segment.
  // Hold each published sample-clock epoch during this fixture so a slow page
  // load cannot make the next controlled epoch rewind native input history.
  // The renderer still extrapolates between packets using the actual RAF time.
  // The isolated clock and envelope contain no generation-wide RMS activity.
  state.parameters = { ...DEFAULT_PARAMETERS, lSystemType: 'cantor', generations: 1,
    intervalMs: 3000, timeRatio: 2, angle: 0, pitchScale: 0, depth: .8 };
  state.topologyRevision++; actualRevision = state.topologyRevision;
  state.performance = { ...DEFAULT_PERFORMANCE, wet: 1 }; state.audio = true;
  Object.assign(state.status, { voiceLimit: 1, activeVoices: 1, cpuLoad: .2, peakLoad: .3,
    inputPeak: 0, wetBusGain: 1, tapVoiceIndices: [0], tapActivity: [0] });
  inputEnvelopePulse = { start: 10, end: 10.24, value: .8 };
  audioClockPaused = true;
  audioClockOffset = 10.3; audioClockStarted = Date.now();
  const pulsePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  observeErrors(pulsePage); await installCanvasAudit(pulsePage); await pulsePage.goto(address);
  await pulsePage.waitForFunction(() => visualAudit.frames.length >= 2);
  const pulsePositions = [];
  const pulseDelay = buildPreview(state.parameters, generationTopology).find(node => node.priority === 0).delay;
  let previousPulseClock = audioClockOffset;
  for (const [name, seconds] of [['early', 10.5], ['middle', 11], ['late', 11.5]]) {
    assert.ok(seconds > previousPulseClock, `${name}: published sample clock advances monotonically`);
    previousPulseClock = seconds;
    audioClockOffset = seconds; audioClockStarted = Date.now();
    const changedAt = await pulsePage.evaluate(() => performance.now());
    await pulsePage.waitForFunction(({ changedAt, seconds }) => visualAudit.frames.slice(-2).length === 2
      && visualAudit.frames.slice(-2).every(frame => frame.at > changedAt + 60
        && frame.telemetryElapsedSeconds === seconds && frame.inputEnvelopeEndTime === seconds
        && frame.telemetryAgeMs <= 100
        && frame.baselines.some(branch => branch.color === '#55d9ff' && branch.bentCount > 0)), { changedAt, seconds });
    const frame = await pulsePage.evaluate(() => visualAudit.frames.at(-1));
    const descendant = frame.baselines.find(branch => branch.color === '#55d9ff');
    assert.equal(frame.coverage, 2, `${name}: original connected tree remains fully colored`);
    assert.ok(descendant.pointCount >= 6 && descendant.interiorDeviation > .01, `${name}: colored descendant itself vibrates`);
    assert.ok(descendant.quietInteriorCount > 0, `${name}: quiet positions stay straight instead of flashing the full branch`);
    assert.ok(frame.glows.some(glow => glow.color === '#55d9ff'), `${name}: in-flight sound brightens its active position`);
    const renderedSeconds = frame.telemetryElapsedSeconds + Math.min(2, frame.telemetryAgeMs / 1000);
    const expectedPosition = (renderedSeconds - (inputEnvelopePulse.start + inputEnvelopePulse.end) / 2) / pulseDelay;
    assert.ok(Math.abs(descendant.bentMeanProgress - expectedPosition) < .1,
      `${name}: active position follows the published input onset and actual frame clock`);
    pulsePositions.push({ name, seconds, activatedPosition: descendant.bentMeanProgress,
      expectedPosition, renderedSeconds, quietInteriorPoints: descendant.quietInteriorCount,
      coloredCurveDeviationPx: descendant.interiorDeviation });
    await pulsePage.locator('#stage').screenshot({ path: resolve(artifacts, `pulse-${name}.png`) });
  }
  assert.ok(pulsePositions[1].activatedPosition > pulsePositions[0].activatedPosition + .1,
    'the impulse advances from branch start toward the middle');
  assert.ok(pulsePositions[2].activatedPosition > pulsePositions[1].activatedPosition + .1,
    'the same impulse advances from the middle toward the delayed endpoint');
  inputEnvelopePulse = null; inputEnvelopeValue = 0;
  await pulsePage.waitForTimeout(400);
  const pulseSilent = await pulsePage.evaluate(() => visualAudit.frames.slice(-2));
  assert.ok(pulseSilent.every(frame => frame.glows.length === 0 && frame.baselines.every(branch => branch.interiorDeviation < 1e-8)),
    'silence removes both partial glow and curved colored vibration');
  await pulsePage.close();
  audioClockPaused = false; audioClockStarted = Date.now();
  await new Promise(resolve => setTimeout(resolve, 80));
  // The full preset surface must refresh authoritative geometry on every
  // recall beyond generation 13. Without that request only the root is admitted.
  renderChangesImmediately = true;
  state.parameters = { ...DEFAULT_PARAMETERS, generations: 4 };
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
    const beforeRequests = fixture.previewRequests;
    const expected = fixture.preview.nodes.filter(node => node.generation === 0
      || Number.isInteger(node.priority) && node.priority >= 0 && node.priority < state.status.voiceLimit && node.gain > 0).length;
    await deepPage.locator('.instrument-preset-controls summary').click();
    await deepPage.locator(`.instrument-preset-controls button[data-full-preset][data-preset-id="${id}"]`).click();
    await deepPage.waitForFunction(id => document.querySelector('.instrument-preset-controls')?.dataset.presetId === id, id);
    await deepPage.waitForFunction(coverage => visualAudit.frames.length >= 3 && visualAudit.frames.slice(-3).every(frame =>
      frame.coverage === coverage && frame.baselines.every(branch => branch.pointCount >= 6 && branch.interiorDeviation > .000001)
      && frame.glows.some(glow => glow.color !== '#fff3d6')), expected);
    assert.ok(fixture.previewRequests > beforeRequests, `${id}: full recall requests its exact native preview`);
    assert.equal(state.audio, true, `${id}: full recall preserves live Audio`);
    assert.equal(state.parameters.lSystemType, preset.snapshot.parameters.lSystemType);
    assert.equal(state.parameters.generations, preset.snapshot.parameters.generations);
    const frame = await deepPage.evaluate(() => visualAudit.frames.at(-1));
    advancedPresetChecks.push({ id, lSystemType: state.parameters.lSystemType, generations: state.parameters.generations,
      inputEnvelope: inputEnvelopeValue, requestedTaps: fixture.requestedVoices, authoritativePreviewSegments: fixture.preview.nodes.length,
      coloredAdmittedSegments: frame.coverage, nativePreviewRequests: fixture.previewRequests - beforeRequests,
      movingDescendants: frame.baselines.filter(branch => branch.lineWidth < 1 && branch.interiorDeviation > .000001).length });
    await deepPage.locator('#stage').screenshot({ path: resolve(artifacts, `advanced-full-${id}.png`) });
  }
  await deepPage.close();
  await new Promise(resolve => setTimeout(resolve, 80));
  // Ordinary input levels must curve the colored baseline even when the
  // original energetic-position threshold correctly leaves descendants dim.
  state.audio = true;
  const quietPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  observeErrors(quietPage); await installCanvasAudit(quietPage); await quietPage.goto(address);
  await quietPage.waitForFunction(() => document.querySelector('.instrument-preset-controls'));
  const quietPresetChecks = [];
  for (const envelope of [.005, .03]) for (const preset of bank.slice(0, 16)) {
    inputEnvelopeValue = envelope;
    await quietPage.locator('.instrument-preset-controls summary').click();
    await quietPage.locator(`.instrument-preset-controls button[data-full-preset][data-preset-id="${preset.id}"]`).click();
    await quietPage.waitForFunction(id => document.querySelector('.instrument-preset-controls')?.dataset.presetId === id, preset.id);
    const expected = buildPreview(preset.snapshot.parameters, generationTopology).filter(node => node.generation === 0
      || Number.isInteger(node.priority) && node.priority >= 0 && node.priority < state.status.voiceLimit && node.gain > 0).length;
    const selectedAt = await quietPage.evaluate(() => performance.now());
    await quietPage.waitForFunction(({ expected, selectedAt }) => visualAudit.frames.length >= 3 && visualAudit.frames.slice(-3)
      .every(frame => frame.at > selectedAt + 120 && frame.coverage === expected
        && frame.baselines.every(branch => branch.pointCount >= 6 && branch.interiorDeviation > .0000001)
        && frame.baselineAlphas.every(alpha => alpha >= .2 - 1e-12 && alpha <= .44 + 1e-12)), { expected, selectedAt });
    const frames = await quietPage.evaluate(() => visualAudit.frames.slice(-3));
    const descendants = frames.at(-1).baselines.filter(branch => branch.lineWidth < 1);
    assert.ok(descendants.length > 0, `${preset.id}: quiet factory fixture contains admitted descendants`);
    assert.ok(frames.at(-1).baselines.some((branch, index) => branch.lineWidth < 1
      && Math.abs(branch.signature - frames[0].baselines[index].signature) > .0000001), `${preset.id}: quiet descendants vibrate through time`);
    assert.equal(state.audio, true, `${preset.id}: quiet recall retains live Audio`);
    quietPresetChecks.push({ id: preset.id, inputEnvelope: envelope, coloredDescendants: descendants.length,
      minimumColoredCurveDeviationPx: Math.min(...descendants.map(branch => branch.interiorDeviation)),
      glowingBranches: frames.at(-1).glows.length });
    if (['pythagorean', 'plant', 'orchid'].includes(preset.id)) await quietPage.locator('#stage').screenshot({
      path: resolve(artifacts, `quiet-${preset.id}-${envelope}.png`) });
  }
  await quietPage.close();
  const denseGrammarChecks = [], representative = new Set(['pythagorean', 'plant', 'coral', 'hilbert']);
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  for (const lSystemType of L_SYSTEM_TYPES) {
    // Fixture every slot from the instrument's actual generation-13 topology,
    // not an invented 1,000-voice counter with only one metered tap.
    await pause(80);
    const scene = bank.find(preset => preset.id === lSystemType)
      ?? bank.find(preset => preset.snapshot.parameters.lSystemType === lSystemType && preset.snapshot.parameters.angle > 0);
    const grammar = L_SYSTEM_PRESETS.find(preset => preset.id === lSystemType);
    const parameters = { ...DEFAULT_PARAMETERS, angle: grammar?.angle ?? DEFAULT_PARAMETERS.angle,
      ...scene?.snapshot.parameters, lSystemType, generations: 13 };
    const nodes = buildPreview(parameters, generationTopology);
    const admitted = nodes.filter(node => Number.isInteger(node.priority) && node.priority >= 0 && node.gain > 0)
      .sort((a, b) => a.priority - b.priority);
    const metered = admitted.slice(0, 2048), measuredRms = .003, expectedCoverage = admitted.length + 1;
    const expectedGlowsForAge = ageMs => {
      const age = Math.min(2, Math.max(0, ageMs / 1000));
      const energyAt = delay => 1 - Math.exp(-.3 * Math.exp(-Math.max(0, age - delay) / .16) * 5);
      return Number(energyAt(0) >= .015) + admitted.filter(node => energyAt(node.delay)
        * Math.min(1, Math.sqrt(node.gain / .5) * Math.sqrt(DEFAULT_PERFORMANCE.wet)) >= .015).length;
    };
    assert.ok(metered.length > 0, `${lSystemType}: fixture includes audible taps`);
    state.parameters = parameters; state.topologyRevision++; actualRevision = state.topologyRevision;
    state.performance = { ...DEFAULT_PERFORMANCE }; state.audio = true;
    inputEnvelopeValue = .3;
    audioClockOffset = 60; audioClockStarted = Date.now();
    state.requestedVoices = nodes.length - 1; state.eligibleVoices = admitted.length;
    state.generationLimits = Object.fromEntries(L_SYSTEM_TYPES.map(type => [type, 30]));
    Object.assign(state.status, { topologyRevision: actualRevision, voiceLimit: admitted.length, activeVoices: admitted.length,
      cpuLoad: .2, peakLoad: .3, inputPeak: 0, wetBusGain: 1,
      tapVoiceIndices: metered.map(node => node.voiceIndex), tapActivity: metered.map(() => measuredRms) });
    const fixturePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    observeErrors(fixturePage); await installCanvasAudit(fixturePage); await fixturePage.goto(address);
    await fixturePage.waitForFunction(coverage => visualAudit.frames.length >= 3
      && visualAudit.frames.slice(-3).every(frame => frame.coverage === coverage
        && frame.baselines.length === coverage && frame.baselines.every(branch => branch.pointCount >= 6
          && branch.interiorDeviation > .00001)), expectedCoverage);
    const conditions = [];
    for (const [name, load, peak] of [['normal', .2, .3], ['severe', .9, .98]]) {
      state.status.cpuLoad = load; state.status.peakLoad = peak;
      await fixturePage.waitForTimeout(name === 'normal' ? 250 : 650);
      const frames = await fixturePage.evaluate(() => visualAudit.frames.slice(-3));
      for (const frame of frames) {
        assert.equal(frame.coverage, expectedCoverage, `${lSystemType}/${name}: complete admission color`);
        assert.equal(frame.glows.length, expectedGlowsForAge(frame.telemetryAgeMs),
          `${lSystemType}/${name}: glow follows the recorded input and original predicted release (telemetry age ${frame.telemetryAgeMs} ms)`);
        assert.ok(frame.baselines.every(branch => branch.pointCount >= 6), `${lSystemType}/${name}: original minimum five wave intervals`);
        assert.ok(frame.baselines.every(branch => branch.interiorDeviation > .00001), `${lSystemType}/${name}: every admitted colored branch bends`);
        assert.ok(frame.baselineAlphas.every(alpha => alpha >= .2 - 1e-12 && alpha <= .44 + 1e-12),
          `${lSystemType}/${name}: original colored baseline opacity`);
      }
      const first = frames[0], last = frames.at(-1);
      const movingCount = last.baselines.filter((branch, index) => Math.abs(branch.signature - first.baselines[index].signature) > .00001).length;
      assert.ok(movingCount >= Math.floor(expectedCoverage * .8), `${lSystemType}/${name}: constant audio vibrates most branches through time`);
      if (admitted.length > 2048) assert.ok(last.baselines.length - 1 > metered.length,
        `${lSystemType}/${name}: unmetered admitted descendants retain derived moving waves`);
      const minDeviation = Math.min(...frames.flatMap(frame => frame.baselines.map(branch => branch.interiorDeviation)));
      const minPoints = Math.min(...frames.flatMap(frame => frame.baselines.map(branch => branch.pointCount)));
      conditions.push({ name, load, peak, admittedSegments: expectedCoverage, meteredTaps: metered.length,
        derivedTaps: Math.max(0, admitted.length - metered.length), movingColoredBranches: movingCount,
        minimumInteriorDeviationPx: minDeviation, minimumCurvePoints: minPoints });
      if (representative.has(lSystemType)) await fixturePage.locator('#stage').screenshot({
        path: resolve(artifacts, `dense-${lSystemType}-${name}.png`) });
    }
    inputEnvelopeValue = 0;
    state.status.tapActivity.fill(0);
    const silenceStarted = await fixturePage.evaluate(() => performance.now());
    await fixturePage.waitForFunction(started => visualAudit.frames.length >= 3 && visualAudit.frames.slice(-3)
      .every(frame => frame.at > started && frame.glows.length === 0), silenceStarted, { timeout: 10000 });
    let silentFrames = await fixturePage.evaluate(() => visualAudit.frames.slice(-3));
    assert.ok(silentFrames.every(frame => frame.glows.length === 0 && frame.baselines.every(branch => branch.interiorDeviation < 1e-8)),
      `${lSystemType}: zero input history and RMS straighten every colored branch`);
    assert.ok(silentFrames.every(frame => frame.baselineAlphas.every(alpha => alpha >= .2 - 1e-12 && alpha <= .44 + 1e-12)),
      `${lSystemType}: silent baseline retains original opacity`);
    const silentAdmission = [];
    for (const limit of [0, Math.min(8, admitted.length), Math.floor(admitted.length / 2), admitted.length]) {
      state.status.voiceLimit = limit; state.status.activeVoices = limit;
      await fixturePage.waitForFunction(coverage => visualAudit.current?.coverage === coverage, limit + 1);
      await fixturePage.waitForTimeout(170);
      const silent = await fixturePage.evaluate(() => visualAudit.current);
      assert.equal(silent.coverage, limit + 1, `${lSystemType}: silent admission remains complete`);
      assert.equal(silent.glows.length, 0, `${lSystemType}: adding silent voices never creates moving waves`);
      assert.ok(silent.baselineAlphas.every(alpha => alpha >= .2 - 1e-12 && alpha <= .44 + 1e-12),
        `${lSystemType}: silent admission retains original opacity`);
      silentAdmission.push({ voices: limit, coloredSegments: silent.coverage, waves: silent.glows.length });
    }
    inputEnvelopeValue = .3;
    state.status.tapActivity.fill(measuredRms); state.status.wetBusGain = 0;
    const mutedStarted = await fixturePage.evaluate(() => performance.now());
    await fixturePage.waitForFunction(started => visualAudit.frames.length >= 2 && visualAudit.frames.slice(-2)
      .every(frame => frame.at > started + 250 && frame.glows.length === 1
        && frame.baselines.filter(branch => branch.lineWidth < 1).every(branch => branch.interiorDeviation < 1e-8)),
    mutedStarted, { timeout: 10000 });
    silentFrames = await fixturePage.evaluate(() => visualAudit.frames.slice(-2));
    assert.ok(silentFrames.every(frame => frame.glows.every(glow => glow.color === '#fff3d6')
      && frame.baselines.filter(branch => branch.lineWidth < 1).every(branch => branch.interiorDeviation < 1e-8)),
    `${lSystemType}: muted wet bus straightens descendants while the input root can respond`);
    const check = { lSystemType, parameters, generations: 13, actualTopologySegments: nodes.length,
      requestedTaps: nodes.length - 1, admittedTaps: admitted.length,
      meteredTaps: metered.length, measuredRms, conditions, silenceNoWaves: true, mutedWetBusNoWaves: true, silentAdmission };
    denseGrammarChecks.push(check);
    console.log(`${lSystemType}: ${admitted.length} admitted colored curves move at normal/severe pressure, including ${Math.max(0, admitted.length - metered.length)} derived taps`);
    await fixturePage.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  const report = { browserErrors: errors, browserConsoleErrors: consoleErrors, denseGrammarChecks, pressureChecks, pulsePositions,
    advancedPresetChecks, quietPresetChecks, authoritativeDeepFixtureCompiler: 'Rust --no-device',
    highPressureCoverage: 1001, individualSiblingIsolation: true, audioClockCarrierMovement: true, perPositionImpulseTravel: true,
    vibratingColoredBaselines: true, derivedResponseBeyondIndividualMeterLimit: true,
    reorderedRankContinuity: true, measuredReleaseAfterAdmissionShrink: true, mutedWetBusDark: true, staleGrammarRejected: true, currentTopologyAccepted: true,
    mockedAudioTelemetry: true, nativeDeviceStarted: false };
  await writeFile(resolve(artifacts, 'visual-qa.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ browserErrors: errors, browserConsoleErrors: consoleErrors,
    denseGrammarCount: denseGrammarChecks.length, testedPressureTiers: ['normal', 'severe'],
    minimumInteriorDeviationPx: Math.min(...denseGrammarChecks.flatMap(check => check.conditions.map(condition => condition.minimumInteriorDeviationPx))),
    silenceAdmissionAndMutePassed: true, artifacts }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

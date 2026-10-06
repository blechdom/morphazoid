import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { watchPageDiagnostics, pageDiagnosticMessages } from './helpers/diagnostics.mjs';

test.use({ reducedMotion: 'no-preference' });

const ROUTE = '/l-mic-rust.html?renderer=canvas';
const LIVE_GAINS = [1.13, .37, 4];
const gains = d => [d.performance.inputGain, d.performance.level, d.performance.mastering.makeupDb];

// A seamless file fixture avoids mistaking a drum attack or source restart for
// a live Curls response. Browser decoding, source playback and Rust DSP are real.
function wav() {
  const rate = 48000, frames = rate * 3, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / rate;
    const value = .025 * Math.sin(t * Math.PI * 2 * 173) + .012 * Math.sin(t * Math.PI * 2 * 257);
    bytes.writeInt16LE(Math.round(value * 32767), 44 + frame * 2);
  }
  return bytes;
}

async function fixture(page) {
  const errors = watchPageDiagnostics(page, { baseURL: test.info().project.use.baseURL });
  await page.route('**/assets/synthesis/loops/electric-piano.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav() }));
  await page.addInitScript(() => {
    const qa = window.__curlsQa = { monitors: [], sources: [], events: [], frames: [], recording: false, microphoneRequests: 0 };
    for (const type of ['input', 'change']) document.addEventListener(type, event => {
      if (event.target.id === 'curls') qa.events.push({ type, value: Number(event.target.value), now: performance.now() });
    }, true);
    if (navigator.mediaDevices?.getUserMedia) {
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (...args) => { qa.microphoneRequests++; return capture(...args); };
    }
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-l-system-delay') {
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 1024; mute.gain.value = 0;
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
    qa.pcm = () => {
      const monitor = qa.monitors.at(-1);
      let peak = 0, square = 0, nonFinite = 0;
      monitor?.analyser.getFloatTimeDomainData(monitor.samples);
      for (const sample of monitor?.samples ?? []) {
        if (!Number.isFinite(sample)) nonFinite++;
        else { peak = Math.max(peak, Math.abs(sample)); square += sample * sample; }
      }
      return { peak, rms: Math.sqrt(square / (monitor?.samples.length || 1)), nonFinite };
    };
    function frame(now) {
      if (qa.recording && qa.engine) {
        const d = qa.engine.getDiagnostics();
        qa.frames.push({ now, sampleClock: d.sampleClock, processedBlocks: d.processedBlocks,
          curls: d.parameters.curls, inputPeak: d.status.inputPeak,
          tapPeak: Math.max(0, ...d.status.tapActivity), ...qa.pcm() });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch(), source = await response.text();
    // Expose existing closures for observation/state roundtrip only. These hooks
    // do not replace controls, compiler, transition, rendering or audio code.
    await route.fulfill({ response, body: source + `
__curlsQa.engine = browserEngine;
__curlsQa.applyScene = applyScene;
__curlsQa.view = () => ({ parameters: { ...previewParameters }, revision: visualRevision,
  moving: nativePreviewMoving,
  nodes: geometry?.nodes.map(({ id, parentId, x, y, startX, startY, generation, rate, delay }) =>
    ({ id, parentId, x, y, startX, startY, generation, rate, delay })) ?? [] });
` });
  });
  return errors;
}

async function diagnostics(page) {
  return page.evaluate(() => ({ ...__curlsQa.engine.getDiagnostics(), pcm: __curlsQa.pcm(), view: __curlsQa.view(),
    worklets: __curlsQa.monitors.length, sources: __curlsQa.sources, microphoneRequests: __curlsQa.microphoneRequests }));
}
async function ready(page) {
  await page.goto(ROUTE);
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await page.waitForFunction(() => __curlsQa.engine?.getDiagnostics().initialized);
  await expect(page.locator('#curls')).toHaveAttribute('min', '-8');
  await expect(page.locator('#curls')).toHaveAttribute('max', '8');
  await expect(page.locator('#curls')).toHaveAttribute('step', '0.01');
  await expect(page.locator('#curls')).toHaveValue('0');
  await expect(page.locator('#curlsOut')).toHaveAttribute('for', 'curls');
}
async function openControl(page, id) {
  const control = page.locator(`#${id}`);
  await control.evaluate(input => {
    const settings = document.getElementById('nativeSettings');
    if (settings && !settings.contains(input)) settings.open = false;
    for (let parent = input.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  });
  await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
  return control;
}
async function setupRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function chooseInput(page, id, value) {
  const index = await page.locator(`#${id}`).evaluate((select, value) => [...select.options].findIndex(option => option.value === value), value);
  expect(index).toBeGreaterThanOrEqual(0);
  const menu = page.locator(`[data-select-id="${id}"]`);
  await menu.locator('summary').scrollIntoViewIfNeeded();
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await menu.locator(`button[data-option-index="${index}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveValue(value);
}
async function live(page) {
  await page.evaluate(async () => {
    const d = __curlsQa.engine.getDiagnostics();
    await __curlsQa.applyScene({ parameters: { ...d.parameters, lSystemType: 'pythagorean', generations: 6,
      intervalMs: 60, timeRatio: .8, depth: .72, pitchScale: .4, curls: 0 }, performance: { ...d.performance, wet: .65, dry: 0 } });
  });
  for (const [id, value] of [['inputTrim', LIVE_GAINS[0]], ['level', LIVE_GAINS[1]], ['makeupDb', LIVE_GAINS[2]]]) await setupRange(page, id, value);
  await chooseInput(page, 'source', 'samples'); await chooseInput(page, 'inputSample', 'music-keys');
  await expect.poll(async () => (await diagnostics(page)).input.pending).toBe(false);
  await page.locator('#audioButton').click();
  return finiteLive(page, -1);
}
async function finiteLive(page, previousClock) {
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.input.playing && d.contextState === 'running' && d.connectionCount === 1
      && d.sampleClock > previousClock && d.status.inputPeak > 1e-5
      && Math.max(0, ...d.status.tapActivity) > 1e-5 && d.pcm.peak > 1e-5 && d.pcm.nonFinite === 0;
  }, { timeout: 30000 }).toBe(true);
  const d = await diagnostics(page);
  expect(d.error).toBeFalsy(); expect(d.pcm.peak).toBeLessThanOrEqual(1); expect(gains(d)).toEqual(LIVE_GAINS);
  return d;
}
async function beginDrag(page) {
  const control = await openControl(page, 'curls'), box = await control.boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.evaluate(() => { __curlsQa.events = []; });
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  return p;
}
async function dragHeld(page, dy) {
  const p = await beginDrag(page);
  for (let step = 1; step <= 4; step++) {
    await page.mouse.move(p.x, p.y - dy * step / 4); await page.waitForTimeout(30);
  }
  const target = Number(await page.locator('#curls').inputValue());
  await expect.poll(async () => (await diagnostics(page)).parameters.curls, { timeout: 30000 }).toBe(target);
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.view.parameters.curls === target && d.view.revision === d.topologyRevision && !d.view.moving;
  }, { timeout: 30000 }).toBe(true);
  const events = await page.evaluate(() => __curlsQa.events), d = await diagnostics(page);
  expect(events.filter(event => event.type === 'input').length).toBeGreaterThan(1);
  expect(events.some(event => event.type === 'change')).toBe(false);
  await page.mouse.up();
  expect((await page.evaluate(() => __curlsQa.events)).filter(event => event.type === 'change')).toHaveLength(1);
  return { target, events, d };
}
async function nativeGeometry(page, { rustNodes = false } = {}) {
  return page.evaluate(async rustNodes => {
    const reply = await __curlsQa.engine.request('/api/preview');
    const { nativePreviewNodes } = await import('/src/instruments/micmic/native/model.js');
    const targets = rustNodes ? nativePreviewNodes(reply.nodes) : reply.visualNodes ?? nativePreviewNodes(reply.nodes);
    return { revision: reply.topologyRevision, targets: targets.map(({ id, parentId, x, y, startX, startY, rate, delay }) =>
      ({ id, parentId, x, y, startX, startY, rate, delay })) };
  }, rustNodes);
}
function assertConnectedNativeView(view, native) {
  expect(view.revision).toBe(native.revision);
  const targets = new Map(native.targets.map(node => [node.id, node])), nodes = new Map(view.nodes.map(node => [node.id, node]));
  expect(nodes.size).toBe(targets.size);
  for (const node of nodes.values()) {
    const target = targets.get(node.id); expect(target, node.id).toBeTruthy();
    for (const field of ['x', 'y', 'startX', 'startY', 'rate', 'delay']) expect(node[field], `${node.id}.${field}`).toBeCloseTo(target[field], 6);
    if (node.parentId) {
      expect(node.startX).toBeCloseTo(nodes.get(node.parentId).x, 6);
      expect(node.startY).toBeCloseTo(nodes.get(node.parentId).y, 6);
    }
  }
}
async function choosePreset(page, scene) {
  const picker = page.locator('.instrument-preset-controls'), menu = picker.locator('details');
  await menu.locator('summary').scrollIntoViewIfNeeded();
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await menu.locator('input[type="search"]').fill(scene.label);
  await menu.locator(`button[data-preset-id="${scene.id}"]`).click();
  await expect(picker).toHaveAttribute('data-preset-id', scene.id, { timeout: 30000 });
  await expect(page.locator('#curls')).toBeEnabled();
}
async function capture(page) {
  return page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
}
async function save(name, data) {
  const path = test.info().outputPath(`${name}.json`); await writeFile(path, JSON.stringify(data, null, 2));
  await test.info().attach(name, { path, contentType: 'application/json' });
}
async function cleanup(page, errors) {
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await diagnostics(page)).disposed).toBe(true);
  expect(pageDiagnosticMessages(errors)).toEqual([]);
}

test('Curls is a reachable signed compact knob on desktop and both phone orientations without arming Audio', async ({ browser }) => {
  test.setTimeout(120000);
  const layouts = [];
  for (const [name, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false],
    ['portrait', { width: 390, height: 844 }, true], ['landscape', { width: 844, height: 390 }, true]]) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport, hasTouch: mobile, isMobile: mobile }), page = await context.newPage();
    const errors = await fixture(page); await ready(page);
    const control = await openControl(page, 'curls'), box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(await control.evaluate(input => input.parentElement.classList.contains('mz-range-knob'))).toBe(true);
    if (mobile) { expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48); }
    await expect(control).toHaveAccessibleName(/Curls/i);
    await control.focus(); await page.keyboard.press('ArrowRight'); await expect(control).toHaveValue('0.01');
    await expect.poll(async () => (await diagnostics(page)).parameters.curls).toBe(.01);
    await page.keyboard.press('Home'); await expect(control).toHaveValue('-8');
    await expect.poll(async () => (await diagnostics(page)).parameters.curls).toBe(-8);
    const d = await diagnostics(page); expect(d.audio).toBe(false); expect(d.audioDesired).toBe(false);
    expect(d.contextState).toBe('absent'); expect(d.worklets).toBe(0); expect(d.microphoneRequests).toBe(0); expect(d.sources).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const screenshot = test.info().outputPath(`curls-${name}.png`); await page.screenshot({ path: screenshot });
    await test.info().attach(`curls-${name}`, { path: screenshot, contentType: 'image/png' });
    layouts.push({ name, viewport, box, curls: d.parameters.curls, contextState: d.contextState });
    await cleanup(page, errors); await context.close();
  }
  await save('curls-responsive-audio-off', { layouts, physicalTouchDeviceTested: false });
});

test('held positive and negative Curls reach real Rust audio and its connected graphic before release', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await fixture(page); await ready(page); const before = await live(page);
  await page.evaluate(() => { __curlsQa.recording = true; });
  const positive = await dragHeld(page, 6); expect(positive.target).toBeGreaterThan(0);
  assertConnectedNativeView(positive.d.view, await nativeGeometry(page, { rustNodes: true }));
  const negative = await dragHeld(page, -12); expect(negative.target).toBeLessThan(0);
  assertConnectedNativeView(negative.d.view, await nativeGeometry(page, { rustNodes: true }));
  const root = view => view.nodes.find(node => node.generation === 0);
  for (const changed of [positive.d, negative.d]) {
    for (const field of ['x', 'y', 'startX', 'startY']) expect(root(changed.view)[field]).toBeCloseTo(root(before.view)[field], 8);
    expect(changed.contextGeneration).toBe(before.contextGeneration); expect(changed.worklets).toBe(1);
    expect(changed.sources).toEqual([{ started: 1, stopped: 0 }]); expect(gains(changed)).toEqual(LIVE_GAINS);
    expect(changed.performance.dry).toBe(0);
  }
  const shifted = (a, b, fields) => a.nodes.some(node => node.generation > 0 && fields.some(field =>
    Math.abs(node[field] - b.nodes.find(other => other.id === node.id)[field]) > 1e-5));
  expect(shifted(positive.d.view, before.view, ['x', 'y'])).toBe(true);
  expect(shifted(negative.d.view, positive.d.view, ['x', 'y'])).toBe(true);
  expect(shifted(positive.d.view, before.view, ['rate'])).toBe(true);
  const after = await finiteLive(page, before.sampleClock + .25);
  const frames = await page.evaluate(() => { __curlsQa.recording = false; return __curlsQa.frames; });
  expect(frames.length).toBeGreaterThan(5); expect(frames.every(frame => frame.nonFinite === 0 && frame.peak <= 1)).toBe(true);
  expect(frames.some(frame => frame.curls > 0 && frame.peak > 1e-5)).toBe(true);
  expect(frames.some(frame => frame.curls < 0 && frame.peak > 1e-5)).toBe(true);
  expect(after.processedBlocks).toBeGreaterThan(before.processedBlocks);
  await save('curls-held-wet-audio', { before, positive, negative, after, frames,
    wasmBuild: await (await page.request.get('/assets/wasm/l-system-delay-build.json')).json(),
    actualWasm: true, dryRootMuted: true, input: 'seamless two-sine recorded fixture', humanListening: false });
  await cleanup(page, errors);
});

test('an original preset clears Curls and restores its native layout while retaining the live input graph', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await fixture(page); await ready(page); const before = await live(page);
  const curled = await dragHeld(page, 6); expect(curled.target).toBeGreaterThan(0);
  const bank = await (await page.request.get('/src/instruments/micmic/native/presets.json')).json(), scene = bank.find(scene => scene.id === 'pythagorean');
  await choosePreset(page, scene); await expect(page.locator('#curls')).toHaveValue('0');
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.parameters.curls === 0 && d.view.parameters.curls === 0 && !d.view.moving;
  }, { timeout: 30000 }).toBe(true);
  const restored = await finiteLive(page, before.sampleClock);
  assertConnectedNativeView(restored.view, await nativeGeometry(page));
  const expected = await page.evaluate(async scene => {
    const { sanitizeParameters } = await import('/src/instruments/micmic/native/model.js'); return sanitizeParameters(scene.snapshot.parameters);
  }, scene);
  expect(restored.parameters).toEqual(expected); expect(restored.contextGeneration).toBe(before.contextGeneration);
  expect(restored.worklets).toBe(1); expect(restored.sources).toEqual([{ started: 1, stopped: 0 }]);
  expect(gains(restored)).toEqual(LIVE_GAINS); expect(restored.microphoneRequests).toBe(0);
  await save('curls-original-preset-reset', { presetId: scene.id, curled: curled.target, expected, restored, humanListening: false });
  await cleanup(page, errors);
});

test('Curls survives complete-state JSON storage and recall, participates in dice, and preserves live gains', async ({ page }) => {
  test.setTimeout(120000);
  const errors = await fixture(page); await ready(page);
  for (const [id, value] of [['inputTrim', LIVE_GAINS[0]], ['level', LIVE_GAINS[1]], ['makeupDb', LIVE_GAINS[2]]]) await setupRange(page, id, value);
  const edited = await dragHeld(page, 6), saved = await capture(page);
  expect(saved.parameters.curls).toBe(edited.target);
  await page.evaluate(scene => localStorage.setItem('morphazoid-curls-qa-scene', JSON.stringify(scene)), saved);
  const bank = await (await page.request.get('/src/instruments/micmic/native/presets.json')).json(); await choosePreset(page, bank[0]);
  await expect(page.locator('#curls')).toHaveValue('0');
  await page.evaluate(async () => {
    await __curlsQa.applyScene(JSON.parse(localStorage.getItem('morphazoid-curls-qa-scene')));
    localStorage.removeItem('morphazoid-curls-qa-scene');
  });
  await expect(page.locator('#curls')).toHaveValue(String(edited.target)); expect(await capture(page)).toEqual(saved);
  const recalled = await diagnostics(page); expect(gains(recalled)).toEqual(LIVE_GAINS);
  const dice = page.locator('.header-preset-random'); await dice.scrollIntoViewIfNeeded(); await dice.click();
  await expect.poll(async () => (await diagnostics(page)).parameters.curls, { timeout: 30000 }).not.toBe(edited.target);
  await expect(page.locator('#curls')).toBeEnabled({ timeout: 30000 });
  const randomized = await diagnostics(page), capturedRandom = await capture(page);
  expect(Number.isFinite(randomized.parameters.curls)).toBe(true); expect(Math.abs(randomized.parameters.curls)).toBeLessThanOrEqual(8);
  expect(capturedRandom.parameters.curls).toBe(randomized.parameters.curls);
  expect(Number(await page.locator('#curls').inputValue())).toBeCloseTo(randomized.parameters.curls, 2);
  expect(gains(randomized)).toEqual(LIVE_GAINS); expect(randomized.audio).toBe(false); expect(randomized.worklets).toBe(0); expect(randomized.microphoneRequests).toBe(0);
  await save('curls-state-roundtrip', { saved, recalled: recalled.parameters, randomized: randomized.parameters,
    gains: gains(randomized), serializationApplySeam: true, noPresetFileUploaderClaim: true });
  await cleanup(page, errors);
});

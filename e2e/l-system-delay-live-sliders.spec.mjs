import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const bank = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));

test.use({ reducedMotion: 'no-preference' });

// A continuous, seamless recorded source isolates live edits from drum attacks
// and source restarts. Browser decoding, playback, worker and Rust DSP stay real.
function wav() {
  const rate = 48000, frames = rate * 3, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    const seconds = frame / rate;
    const sample = .025 * Math.sin(seconds * Math.PI * 2 * 173) + .012 * Math.sin(seconds * Math.PI * 2 * 257);
    bytes.writeInt16LE(Math.round(sample * 32767), 44 + frame * 2);
  }
  return bytes;
}

async function fixture(page) {
  const errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route('**/assets/synthesis/loops/electric-piano.wav', route => route.fulfill({
    contentType: 'audio/wav', body: wav(),
  }));
  await page.addInitScript(() => {
    const qa = window.__liveSlidersQa = { nodes: [], sources: [], compiles: [], installs: [],
      performanceMessages: [], depthMessages: [], statuses: [], frames: [], inputs: [], recording: false,
      phase: '', holdCompile: false, pendingCompileReplies: [], longTasks: [], geometryBuilds: [], draws: [] };
    const NativeWorker = Worker;
    window.Worker = new Proxy(NativeWorker, { construct(Target, args) {
      const worker = new Target(...args);
      if (!String(args[0]).includes('/native/topology-worker.js')) return worker;
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (data, ...rest) => {
        qa.compiles.push({ now: performance.now(), id: data.id, revision: data.revision, parameters: { ...data.parameters } });
        return post(data, ...rest);
      };
      const descriptor = Object.getOwnPropertyDescriptor(Target.prototype, 'onmessage');
      Object.defineProperty(worker, 'onmessage', {
        get() { return descriptor.get.call(this); },
        set(handler) { descriptor.set.call(this, handler && function (event) {
          if (qa.holdCompile) qa.pendingCompileReplies.push(() => handler.call(this, event));
          else handler.call(this, event);
        }); },
      });
      return worker;
    } });
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] !== 'morphazoid-l-system-delay') return node;
      const analyser = node.context.createAnalyser(), mute = node.context.createGain();
      analyser.fftSize = 512; mute.gain.value = 0;
      node.connect(analyser).connect(mute).connect(node.context.destination);
      qa.nodes.push({ node, analyser, samples: new Float32Array(analyser.fftSize) });
      const post = node.port.postMessage.bind(node.port);
      node.port.postMessage = (data, ...rest) => {
        if (data.type === 'install') qa.installs.push({ now: performance.now(), id: data.id });
        if (data.type === 'performance') qa.performanceMessages.push({ now: performance.now(), performance: structuredClone(data.performance) });
        if (data.type === 'depth') qa.depthMessages.push({ now: performance.now(), depth: data.depth });
        return post(data, ...rest);
      };
      node.port.addEventListener('message', ({ data }) => {
        if (!qa.recording || !data.status) return;
        const s = data.status;
        qa.statuses.push({ now: performance.now(), phase: qa.phase, clock: s.elapsedSeconds,
          blocks: s.processedBlocks, topologyRevision: s.topologyRevision, inputPeak: s.inputPeak,
          outputPeak: s.outputPeak, voiceLimit: s.voiceLimit, deadlines: s.deadlineMisses,
          tapPeak: Math.max(0, ...(s.tapActivity || [])), activeVoices: s.activeVoices,
          historyEnd: s.inputEnvelope?.endTime, historyCount: s.inputEnvelope?.values?.length });
      });
      return node;
    } });
    const createSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const node = createSource.apply(this, args), record = { started: 0, stopped: 0 };
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...values) => { record.started++; return start(...values); };
      node.stop = (...values) => { record.stopped++; return stop(...values); };
      qa.sources.push(record); return node;
    };
    if (typeof PerformanceObserver === 'function') new PerformanceObserver(list => {
      if (qa.recording) for (const entry of list.getEntries()) qa.longTasks.push({ phase: qa.phase, start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
    let previous;
    function frame(now) {
      if (qa.recording && qa.engine) {
        const d = qa.engine.getDiagnostics(), monitor = qa.nodes.at(-1);
        let peak = 0, nonFinite = 0;
        if (monitor && d.connectionCount) {
          monitor.analyser.getFloatTimeDomainData(monitor.samples);
          for (const sample of monitor.samples) {
            if (!Number.isFinite(sample)) nonFinite++;
            else peak = Math.max(peak, Math.abs(sample));
          }
        }
        qa.frames.push({ now, gap: previous == null ? 0 : now - previous, phase: qa.phase,
          sampleTime: qa.engine.getSampleTime(), peak, nonFinite, parameters: { ...d.parameters },
          wet: d.performance.wet, dry: d.performance.dry });
        previous = now;
      } else previous = undefined;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch(), source = await response.text();
    expect(source).toContain('function buildGeometry()');
    expect(source).toContain('function draw(now)');
    // Wrap the real functions without replacing their geometry, DSP, caching,
    // input handling, or scheduling. No production debug API is needed.
    const hook = `
const qaBuildGeometry = buildGeometry;
buildGeometry = function (...args) {
  const started = performance.now();
  const result = qaBuildGeometry.apply(this, args);
  if (__liveSlidersQa.recording) __liveSlidersQa.geometryBuilds.push({
    now: started, duration: performance.now() - started, phase: __liveSlidersQa.phase,
    count: geometry?.nodes.length });
  return result;
};
const qaDraw = draw;
draw = function (...args) {
  const started = performance.now();
  const result = qaDraw.apply(this, args);
  if (__liveSlidersQa.recording) __liveSlidersQa.draws.push({
    now: started, duration: performance.now() - started, phase: __liveSlidersQa.phase });
  return result;
};
__liveSlidersQa.visual = () => ({ count: geometry?.nodes.length,
  identities: geometry?.nodes.filter(node => node.generation > 0).slice(0, 16)
    .map(node => [node.id, node.voiceIndex, node.priority]),
  inputHistoryEnd: inputTelemetry.endTime });
`;
    await route.fulfill({ response, body: source + hook });
  });
  return { errors, consoleErrors };
}

async function diagnostics(page) {
  return page.evaluate(async path => {
    const qa = __liveSlidersQa, engine = (await import(path)).getBrowserDelayEngine();
    qa.engine = engine;
    const d = engine.getDiagnostics();
    return { ...d, worklets: qa.nodes.length,
      sourceStarts: qa.sources.reduce((sum, source) => sum + source.started, 0),
      sourceStops: qa.sources.reduce((sum, source) => sum + source.stopped, 0) };
  }, ENGINE);
}

async function choosePreset(page, id) {
  const picker = page.locator('.instrument-preset-controls'), menu = picker.locator('details');
  if (await menu.getAttribute('open') === null) await picker.locator('summary').click();
  await page.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
  await expect(picker).toHaveAttribute('data-preset-id', id, { timeout: 30000 });
  await expect(page.locator('#generations')).toBeEnabled({ timeout: 30000 });
  const d = await diagnostics(page), scene = bank.find(preset => preset.id === id);
  expect(d.parameters).toEqual(scene.snapshot.parameters);
}

async function ready(page, id) {
  await page.goto('/l-mic-rust.html?renderer=canvas');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await choosePreset(page, id);
  await page.locator('#source').selectOption('samples', { force: true });
  await page.locator('#inputSample').selectOption('music-keys', { force: true });
  await expect.poll(async () => (await diagnostics(page)).input.pending).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.input.playing && d.status.elapsedSeconds > 1.5
      && d.status.inputPeak > .001 && d.status.outputPeak > 1e-5;
  }, { timeout: 30000 }).toBe(true);
  return diagnostics(page);
}

async function sweep(page, id, values, { period = 16, hold = true } = {}) {
  return page.locator(`#${id}`).evaluate(async (input, { id, values, period, hold }) => {
    const qa = __liveSlidersQa;
    qa.phase = id;
    const started = performance.now(), before = qa.engine.getDiagnostics();
    const compileCount = qa.compiles.length, performanceCount = qa.performanceMessages.length;
    if (hold) input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77 }));
    for (const value of values) {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
      qa.inputs.push({ id, now: performance.now(), value: input.value });
      await new Promise(resolve => setTimeout(resolve, period));
    }
    const held = qa.engine.getDiagnostics();
    const during = { started, released: performance.now(), before, held,
      compiles: qa.compiles.length - compileCount, performanceMessages: qa.performanceMessages.length - performanceCount };
    if (hold) input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 77 }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return during;
  }, { id, values, period, hold });
}

async function evidence(page, before, sweeps) {
  const final = await diagnostics(page);
  const wasmBuild = await (await page.request.get('/assets/wasm/l-system-delay-build.json')).json();
  const measured = await page.evaluate(() => {
    const qa = __liveSlidersQa;
    qa.recording = false;
    return { frames: qa.frames, statuses: qa.statuses, compiles: qa.compiles, installs: qa.installs,
      inputs: qa.inputs, longTasks: qa.longTasks, performanceMessages: qa.performanceMessages,
      depthMessages: qa.depthMessages, geometryBuilds: qa.geometryBuilds, draws: qa.draws,
      browser: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
  });
  const steps = measured.frames.slice(1).map((frame, i) => frame.sampleTime - measured.frames[i].sampleTime);
  const result = { route: '/l-mic-rust.html?renderer=canvas', actualWasm: true,
    input: 'seamless two-sine WAV, browser sample input', listeningPerformed: false,
    before, final, sweeps, wasmBuild, ...measured,
    maximumFrameGap: Math.max(0, ...measured.frames.map(frame => frame.gap)),
    minimumClockStep: Math.min(...steps),
    maximumPcmPeak: Math.max(0, ...measured.frames.map(frame => frame.peak)),
    pcmNonFinite: measured.frames.reduce((sum, frame) => sum + frame.nonFinite, 0) };
  const path = test.info().outputPath('live-slider-evidence.json');
  await writeFile(path, JSON.stringify(result));
  await test.info().attach('live-slider-evidence', { path, contentType: 'application/json' });
  return result;
}

async function stop(page) {
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  expect((await diagnostics(page)).input.playing).toBe(false);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await diagnostics(page)).contextState).toBe('closed');
  expect((await diagnostics(page)).connectionCount).toBe(0);
}

for (const id of ['pythagorean', 'mycelium-crown', 'dragon-filigree']) {
  test(`${id} applies held Recursion and Mix sliders without restarting live input`, async ({ page }) => {
    test.setTimeout(120000);
    const errors = await fixture(page), before = await ready(page, id), sweeps = [];
    await page.evaluate(() => { __liveSlidersQa.recording = true; });
    const interpolate = (from, to) => Array.from({ length: 32 }, (_, i) => from + (to - from) * i / 31);
    sweeps.push(await sweep(page, 'depth', interpolate(.64, .92)));
    await expect.poll(async () => (await diagnostics(page)).parameters.depth, { timeout: 30000 }).toBe(.92);
    await page.waitForTimeout(200);
    sweeps.push(await sweep(page, 'wet', interpolate(.48, .88)));
    await expect.poll(async () => (await diagnostics(page)).performance.wet).toBe(.88);
    sweeps.push(await sweep(page, 'dry', interpolate(.04, .2)));
    await expect.poll(async () => (await diagnostics(page)).performance.dry).toBe(.2);
    sweeps.push(await sweep(page, 'thresholdDb', interpolate(-28, -16)));
    await expect.poll(async () => (await diagnostics(page)).performance.mastering.thresholdDb).toBe(-16);
    const heldAngle = await sweep(page, 'generationAngle', interpolate(24, 68));
    sweeps.push(heldAngle);
    await expect.poll(async () => (await diagnostics(page)).parameters.angle, { timeout: 30000 }).toBe(68);
    // Rapid values are one final target; integer generations stay discrete.
    sweeps.push(await sweep(page, 'generationPitchScale', [.2, .9, .35, .7], { period: 0 }));
    sweeps.push(await sweep(page, 'interval', [420, 620, 280, 520], { period: 0 }));
    sweeps.push(await sweep(page, 'generationAngle', [18, 72, 31, 48], { period: 0 }));
    sweeps.push(await sweep(page, 'pruningBias', [-.5, .8, -.1, .6], { period: 0 }));
    const generation = before.parameters.generations;
    sweeps.push(await sweep(page, 'generations', [generation - 1, generation, generation - 2, generation], { period: 0 }));
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return d.parameters.generations === generation && d.parameters.angle === 48
        && d.parameters.pitchScale === .7 && d.parameters.pruningBias === .6
        && d.status.topologyRevision === d.topologyRevision;
    }, { timeout: 30000 }).toBe(true);
    await page.waitForTimeout(500);
    const result = await evidence(page, before, sweeps);
    expect(result.final.contextGeneration).toBe(before.contextGeneration);
    expect(result.final.worklets).toBe(1); expect(result.final.sourceStarts).toBe(before.sourceStarts);
    expect(result.final.sourceStops).toBe(before.sourceStops);
    expect(result.final.performance.voiceCeiling).toBe(before.performance.voiceCeiling);
    expect(result.final.performance.automatic).toBe(before.performance.automatic);
    expect(result.minimumClockStep).toBeGreaterThanOrEqual(-1e-6);
    expect(result.pcmNonFinite).toBe(0); expect(result.maximumPcmPeak).toBeGreaterThan(1e-5);
    expect(result.maximumPcmPeak).toBeLessThanOrEqual(1);
    expect(result.statuses.some(status => status.tapPeak > 1e-5)).toBe(true);
    for (let i = 1; i < result.statuses.length; i++) {
      expect(result.statuses[i].blocks).toBeGreaterThanOrEqual(result.statuses[i - 1].blocks);
      expect(result.statuses[i].historyEnd).toBeGreaterThanOrEqual(result.statuses[i - 1].historyEnd);
      expect(result.statuses[i].historyCount).toBeGreaterThanOrEqual(result.statuses[i - 1].historyCount);
    }
    // Depth changes only gain coefficients. Mix/mastering changes performance;
    // neither operation should rebuild or install the full recursive tree.
    for (const edit of sweeps.slice(0, 4)) {
      expect(edit.compiles).toBe(0);
      expect(result.installs.filter(install => install.now >= edit.started && install.now <= edit.released)).toHaveLength(0);
      expect(result.geometryBuilds.filter(build => build.now >= edit.started && build.now <= edit.released)).toHaveLength(0);
    }
    expect(sweeps[0].held.parameters.depth).not.toBe(sweeps[0].before.parameters.depth);
    expect(sweeps[1].held.performance.wet).not.toBe(sweeps[1].before.performance.wet);
    expect(heldAngle.held.parameters.angle).not.toBe(heldAngle.before.parameters.angle);
    expect(heldAngle.compiles).toBeGreaterThan(0);
    expect(errors.errors).toEqual([]); expect(errors.consoleErrors).toEqual([]);
    await stop(page);
  });
}

test('preset recall supersedes a queued dense topology edit and retains the source session', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await fixture(page), before = await ready(page, 'pythagorean');
  await page.evaluate(() => { __liveSlidersQa.holdCompile = true; });
  await sweep(page, 'generationAngle', [89], { period: 0, hold: false });
  await page.waitForFunction(() => __liveSlidersQa.pendingCompileReplies.length > 0, null, { timeout: 30000 });
  // Pick a full scene while the old edit is genuinely in flight, then release
  // the delayed worker reply. The old edit cannot overwrite the recalled scene.
  const picker = page.locator('.instrument-preset-controls');
  await picker.locator('summary').click();
  await page.locator('button[data-full-preset][data-preset-id="rain-cedar"]').click();
  await page.evaluate(() => {
    const qa = __liveSlidersQa; qa.holdCompile = false;
    for (const reply of qa.pendingCompileReplies.splice(0)) reply();
  });
  const scene = bank.find(preset => preset.id === 'rain-cedar');
  await expect.poll(async () => (await diagnostics(page)).parameters, { timeout: 30000 }).toEqual(scene.snapshot.parameters);
  await expect(page.locator('#generations')).toBeEnabled();
  await page.waitForTimeout(300);
  const final = await diagnostics(page);
  expect(final.parameters).toEqual(scene.snapshot.parameters);
  expect(final.performance.wet).toBe(scene.snapshot.performance.wet);
  expect(final.performance.dry).toBe(scene.snapshot.performance.dry);
  expect(final.contextGeneration).toBe(before.contextGeneration); expect(final.sourceStarts).toBe(before.sourceStarts);
  expect(final.sourceStops).toBe(before.sourceStops); expect(final.worklets).toBe(1);
  expect(final.audio).toBe(true); expect(final.input.playing).toBe(true);
  expect(final.status.elapsedSeconds).toBeGreaterThan(before.status.elapsedSeconds);
  expect(errors.errors).toEqual([]); expect(errors.consoleErrors).toEqual([]);
  await stop(page);
});

test('zero Depth restores eligible descendants through the coefficient path without a rebuild', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await fixture(page), before = await ready(page, 'pythagorean');
  const counts = await page.evaluate(() => ({ compiles: __liveSlidersQa.compiles.length,
    installs: __liveSlidersQa.installs.length }));
  await sweep(page, 'depth', [0], { period: 0, hold: false });
  await expect.poll(async () => (await diagnostics(page)).parameters.depth).toBe(0);
  const zero = await diagnostics(page);
  expect(zero.eligibleVoices).toBeLessThan(before.eligibleVoices);
  await sweep(page, 'depth', [.9], { period: 0, hold: false });
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.parameters.depth === .9 && d.eligibleVoices === before.eligibleVoices && d.status.outputPeak > 1e-5;
  }, { timeout: 15000 }).toBe(true);
  const final = await diagnostics(page);
  expect(await page.evaluate(() => ({ compiles: __liveSlidersQa.compiles.length,
    installs: __liveSlidersQa.installs.length }))).toEqual(counts);
  expect(final.contextGeneration).toBe(before.contextGeneration); expect(final.sourceStarts).toBe(before.sourceStarts);
  expect(final.status.processedBlocks).toBeGreaterThan(before.status.processedBlocks);
  expect(final.status.inputEnvelope.endTime).toBeGreaterThanOrEqual(before.status.inputEnvelope.endTime);
  expect(final.error).toBeFalsy(); expect(errors.errors).toEqual([]); expect(errors.consoleErrors).toEqual([]);
  await stop(page);
});

test('Depth and Mix reach the live DSP while a structural compilation is pending', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await fixture(page), before = await ready(page, 'pythagorean');
  await page.evaluate(() => { __liveSlidersQa.holdCompile = true; });
  await sweep(page, 'generationAngle', [78], { period: 0, hold: false });
  await page.waitForFunction(() => __liveSlidersQa.pendingCompileReplies.length > 0, null, { timeout: 30000 });
  const compiles = await page.evaluate(() => __liveSlidersQa.compiles.length);
  const visualBefore = await page.evaluate(() => __liveSlidersQa.visual());
  await sweep(page, 'generationAngle', [19, 102, 43, 61], { period: 0, hold: false });
  await sweep(page, 'wet', [.42], { period: 0, hold: false });
  await sweep(page, 'depth', [.89], { period: 0, hold: false });
  // The worker response remains withheld. Applying either control by releasing
  // that response would mask serialization behind the expensive tree update.
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.performance.wet === .42 && d.parameters.depth === .89;
  }, { timeout: 5000 }).toBe(true);
  expect(await page.evaluate(() => __liveSlidersQa.compiles.length)).toBe(compiles);
  expect(await page.evaluate(() => __liveSlidersQa.performanceMessages.some(message => message.performance.wet === .42))).toBe(true);
  expect(await page.evaluate(() => __liveSlidersQa.depthMessages.some(message => message.depth === .89))).toBe(true);
  expect(await page.evaluate(() => __liveSlidersQa.pendingCompileReplies.length)).toBeGreaterThan(0);
  const visualPending = await page.evaluate(() => __liveSlidersQa.visual());
  expect(visualPending.count).toBe(visualBefore.count);
  expect(visualPending.identities).toEqual(visualBefore.identities);
  expect(visualPending.inputHistoryEnd).toBeGreaterThanOrEqual(visualBefore.inputHistoryEnd);
  const pending = await diagnostics(page);
  expect(pending.status.processedBlocks).toBeGreaterThan(before.status.processedBlocks);
  expect(pending.input.playing).toBe(true); expect(pending.contextGeneration).toBe(before.contextGeneration);
  await page.evaluate(() => {
    const qa = __liveSlidersQa; qa.holdCompile = false;
    for (const reply of qa.pendingCompileReplies.splice(0)) reply();
  });
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.parameters.angle === 61 && d.parameters.depth === .89 && d.performance.wet === .42
      && d.status.topologyRevision === d.topologyRevision;
  }, { timeout: 30000 }).toBe(true);
  const final = await diagnostics(page);
  // One in-flight compile and one coalesced latest target cover the five edits.
  expect(await page.evaluate(() => __liveSlidersQa.compiles.length)).toBeLessThanOrEqual(compiles + 1);
  expect(final.worklets).toBe(1); expect(final.sourceStarts).toBe(before.sourceStarts);
  expect(final.sourceStops).toBe(before.sourceStops); expect(final.error).toBeFalsy();
  expect(errors.errors).toEqual([]); expect(errors.consoleErrors).toEqual([]);
  await stop(page);
});

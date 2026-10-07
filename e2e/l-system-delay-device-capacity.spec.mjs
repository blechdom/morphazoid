import { test, expect } from '@playwright/test';

async function fixture(page, { voiceBudget = null } = {}) {
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) failures.push(response.url()); });
  await page.addInitScript(({ voiceBudget }) => {
    const qa = window.__deviceRuntime = { contexts: [], worklets: [], sources: [], compilations: [], microphoneRequests: 0 };
    const NativeWorker = Worker, NativeContext = AudioContext, NativeNode = AudioWorkletNode;
    window.Worker = new Proxy(NativeWorker, { construct(Target, args) {
      const worker = new Target(...args);
      if (String(args[0]).includes('/native/topology-worker.js')) {
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (data, ...rest) => post(Number.isFinite(voiceBudget) ? { ...data, voiceBudget } : data, ...rest);
        // This listener is registered before the application's onmessage.
        // Actual worker Rust measurement and bounded compilation still run.
        worker.addEventListener('message', ({ data }) => {
          if (!data.result) return;
          if (Number.isFinite(voiceBudget)) data.calibration.voices = voiceBudget;
          qa.compilations.push({ revision: data.revision, voiceBudget: data.voiceBudget,
            preparedVoices: data.result.preparedVoices, nodes: data.result.nodes.length,
            requestedGenerations: data.result.parameters.generations, requestedLab: data.result.parameters.lab,
            calibration: structuredClone(data.calibration) });
        });
      }
      return worker;
    } });
    window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); qa.contexts.push(this); } };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'morphazoid-l-system-delay') return;
        const analyser = this.context.createAnalyser(), mute = this.context.createGain();
        analyser.fftSize = 1024; mute.gain.value = 0;
        this.connect(analyser).connect(mute).connect(this.context.destination);
        qa.worklets.push({ analyser, samples: new Float32Array(analyser.fftSize) });
      }
    };
    const create = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const source = create.apply(this, args), record = { starts: 0, stops: 0 };
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { record.starts++; return start(...args); };
      source.stop = (...args) => { record.stops++; return stop(...args); };
      qa.sources.push(record); return source;
    };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => { qa.microphoneRequests++; return capture(...args); };
  }, { voiceBudget });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
window.__deviceQa = {
  engine: browserEngine, applyScene,
  scene: () => captureScene(state.parameters, state.performance),
  view: () => {
    const nodes = geometry?.nodes ?? [], ids = new Set(nodes.map(node => node.id));
    return { parameters: structuredClone(state.parameters), installed: structuredClone(previewParameters),
      prepared: preparedGraphicsNodes?.length ?? 0, nodes: nodes.length, maps: geometry?.byId.size ?? 0,
      waves: geometry?.waves.size ?? 0, roots: nodes.filter(node => node.generation === 0).length,
      connected: nodes.every(node => !node.parentId || ids.has(node.parentId)),
      graphics: graphicsCapacity?.diagnostics(), gpu: gpuRenderer?.stats ?? null };
  },
  forceGraphicsPressure: () => {
    const before = graphicsCapacity.limit;
    const changed = graphicsCapacity.observe({ nowMs: performance.now(), setupMs: 40, workMs: 20,
      drawnNodes: geometry?.nodes.length ?? 0, continuous: false });
    if (changed) { graphicsSelectionDirty = true; void refreshNativePreview(); scheduleDraw(); }
    return { before, after: graphicsCapacity.limit, changed };
  },
};
` });
  });
  return { errors, failures };
}

async function ready(page) {
  await page.goto('/l-mic-rust.html?renderer=webgl2');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 60000 });
  await page.waitForFunction(() => window.__deviceQa?.engine.getDiagnostics().initialized && __deviceQa.view().nodes > 0);
}
const diagnostics = page => page.evaluate(() => __deviceQa.engine.getDiagnostics());
const view = page => page.evaluate(() => __deviceQa.view());
const session = page => page.evaluate(() => ({ time: __deviceQa.engine.getSampleTime(), contexts: __deviceRuntime.contexts.length,
  worklets: __deviceRuntime.worklets.length, sources: structuredClone(__deviceRuntime.sources), microphoneRequests: __deviceRuntime.microphoneRequests }));
async function native(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function pcm(page) {
  return page.evaluate(() => {
    const monitor = __deviceRuntime.worklets.at(-1);
    if (!monitor) return { peak: 0, finite: true };
    monitor.analyser.getFloatTimeDomainData(monitor.samples);
    return { peak: Math.max(...monitor.samples.map(Math.abs)), finite: monitor.samples.every(Number.isFinite) };
  });
}
async function live(page) {
  await expect.poll(async () => {
    const d = await diagnostics(page), samples = await pcm(page);
    return d.audio && d.input.playing && d.performance.dry === 0 && samples.finite && samples.peak > 1e-5 && samples.peak <= 1;
  }, { timeout: 30000 }).toBe(true);
}
async function builtInInput(page) {
  await native(page, 'source', 'samples'); await native(page, 'inputSample', 'music-keys');
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.input.mode === 'samples' && d.input.sampleId === 'music-keys' && !d.input.pending;
  }, { timeout: 30000 }).toBe(true);
  await native(page, 'wet', .65); await native(page, 'dry', 0);
  await native(page, 'inputTrim', .7); await native(page, 'level', .6); await native(page, 'makeupDb', 4);
  await page.locator('#audioButton').click(); await live(page);
}
function denseScene(scene, kind = 'classic') {
  const { lab, ...classic } = scene.parameters;
  const parameters = kind === 'classic' ? { ...classic, lSystemType: 'pythagorean', generations: 52, intervalMs: 30, timeRatio: .8, depth: .85 }
    : { ...classic, generations: 24, intervalMs: 30, timeRatio: .8, depth: .85,
      lab: { kind, iterations: 24, lengthRatio: 1, branchCount: 6, minLength: .001 } };
  return { ...scene, parameters, performance: { ...scene.performance, wet: .65, dry: 0 } };
}
async function applyDense(page, kind) {
  const scene = denseScene(await page.evaluate(() => __deviceQa.scene()), kind);
  await page.evaluate(scene => __deviceQa.applyScene(scene), scene);
  await expect(page.locator('#generations')).toBeEnabled({ timeout: 30000 });
  await expect.poll(async () => {
    const d = await diagnostics(page), v = await view(page);
    return d.parameters.generations === scene.parameters.generations && v.parameters.generations === scene.parameters.generations
      && v.nodes > 0 && (kind === 'classic' ? !d.parameters.lab : d.parameters.lab?.kind === kind);
  }, { timeout: 30000 }).toBe(true);
  return scene;
}
function bounded(d, v) {
  expect(d.deviceCapacity.voices).toBeGreaterThan(0);
  expect(d.preparedVoices).toBeLessThanOrEqual(d.deviceCapacity.preparedCapacity);
  expect(v.prepared).toBeLessThanOrEqual(d.deviceCapacity.preparedCapacity + 1);
  expect(v.nodes).toBeLessThanOrEqual(v.graphics.limit); expect(v.nodes).toBeLessThanOrEqual(v.prepared);
  expect(v.maps).toBe(v.nodes); expect(v.waves).toBeLessThanOrEqual(v.nodes);
  expect(v.roots).toBe(1); expect(v.connected).toBe(true);
  if (v.gpu) expect(v.gpu.previewNodeCount).toBeLessThanOrEqual(v.nodes);
}
async function cleanup(page, evidence) {
  if ((await diagnostics(page)).audio) await page.locator('#audioButton').click();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  expect((await diagnostics(page)).disposed).toBe(true);
  expect(evidence.errors).toEqual([]); expect(evidence.failures).toEqual([]);
}

test('real cold Rust calibration precedes bounded hostile previews without arming Audio or capturing a device', async ({ page }) => {
  test.setTimeout(120000);
  const evidence = await fixture(page); await ready(page);
  const initial = await diagnostics(page), calibration = initial.deviceCapacity;
  expect(calibration.elapsedMs).toBeGreaterThan(0); expect(calibration.measurements.length).toBeGreaterThan(0);
  expect(calibration.measurements.every(row => row.voices > 0 && row.load > 0 && Number.isFinite(row.load))).toBe(true);
  for (const kind of ['classic', 'parametric']) {
    await applyDense(page, kind);
    const d = await diagnostics(page), v = await view(page); bounded(d, v);
    expect(d.parameters.generations).toBe(kind === 'classic' ? 52 : 24);
    if (kind === 'parametric') expect(d.parameters.lab.branchCount).toBe(6);
    expect(d.requestedVoices).toBeGreaterThan(d.preparedVoices);
    expect(d.audio).toBe(false); expect(d.audioDesired).toBe(false);
    expect(await session(page)).toMatchObject({ contexts: 0, worklets: 0, microphoneRequests: 0, sources: [] });
  }
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    bounded(await diagnostics(page), await view(page));
  }
  await cleanup(page, evidence);
});

test('controlled slow and fast preparation budgets change actual Rust node counts before main-thread cloning', async ({ browser }) => {
  test.setTimeout(120000);
  const counts = [];
  for (const budget of [32, 256]) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(), evidence = await fixture(page, { voiceBudget: budget });
    await ready(page); await applyDense(page, 'parametric');
    const d = await diagnostics(page), v = await view(page); bounded(d, v);
    expect(d.deviceCapacity.voices).toBe(budget); expect(d.deviceCapacity.preparedCapacity).toBe(budget);
    const rows = await page.evaluate(() => __deviceRuntime.compilations);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.nodes).toBeLessThanOrEqual(budget + 1); expect(row.preparedVoices).toBeLessThanOrEqual(budget);
      expect(row.calibration.measurements.length).toBeGreaterThan(0);
    }
    counts.push({ budget, prepared: d.preparedVoices, rawWorkerNodes: rows.at(-1).nodes });
    await cleanup(page, evidence); await context.close();
  }
  expect(counts[1].prepared).toBeGreaterThan(counts[0].prepared);
  expect(counts[1].rawWorkerNodes).toBeGreaterThan(counts[0].rawWorkerNodes);
  await test.info().attach('device-budget-before-cloning', { body: JSON.stringify(counts, null, 2), contentType: 'application/json' });
});

test('rapid dense rule-family changes retain real bundled wet audio, one source and independent live gains', async ({ page }) => {
  test.setTimeout(150000);
  const evidence = await fixture(page, { voiceBudget: 128 }); await ready(page); await builtInInput(page);
  const before = await session(page), rows = [];
  for (const kind of ['classic', 'parametric', 'penrose', 'sphinx', 'parametric', 'classic']) {
    await applyDense(page, kind); await live(page);
    const d = await diagnostics(page), v = await view(page), after = await session(page), samples = await pcm(page);
    bounded(d, v); expect(d.performance.inputGain).toBe(.7); expect(d.performance.level).toBe(.6); expect(d.performance.mastering.makeupDb).toBe(4);
    expect(after.contexts).toBe(before.contexts); expect(after.worklets).toBe(before.worklets); expect(after.sources).toEqual(before.sources);
    expect(after.time).toBeGreaterThan(before.time); expect(after.microphoneRequests).toBe(0);
    rows.push({ kind, requested: d.parameters.generations, prepared: d.preparedVoices, drawn: v.nodes, peak: samples.peak, sampleClock: after.time });
  }
  await test.info().attach('device-bounded-dense-live-audio', { body: JSON.stringify({ rows, input: 'actual bundled electric-piano.wav', actualWasm: true, fixtureAudio: false, dryRootMuted: true, humanListening: false }, null, 2), contentType: 'application/json' });
  await cleanup(page, evidence);
});

for (const audio of [false, true]) test(`graphics overload reduces connected GPU/maps work with Audio ${audio ? 'on' : 'off'} and preserves audio admission`, async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page, { voiceBudget: 128 }); await ready(page); await applyDense(page, 'parametric');
  if (audio) {
    await native(page, 'automatic', false); await native(page, 'voiceCeiling', 64);
    await builtInInput(page); await expect.poll(async () => (await diagnostics(page)).status.voiceLimit).toBe(64);
  }
  const before = await diagnostics(page), oldView = await view(page), oldSession = await session(page);
  expect(oldView.nodes).toBeGreaterThan(1);
  const pressure = await page.evaluate(() => __deviceQa.forceGraphicsPressure());
  expect(pressure.changed).toBe(true); expect(pressure.after).toBeLessThan(pressure.before);
  await expect.poll(async () => (await view(page)).nodes, { timeout: 30000 }).toBeLessThan(oldView.nodes);
  const after = await diagnostics(page), newView = await view(page), newSession = await session(page);
  bounded(after, newView); expect(newView.nodes).toBeLessThanOrEqual(pressure.after);
  expect(after.parameters).toEqual(before.parameters); expect(after.preparedVoices).toBe(before.preparedVoices);
  expect(after.eligibleVoices).toBe(before.eligibleVoices); expect(after.status.installedCapacity).toBe(before.status.installedCapacity);
  expect(after.status.voiceLimit).toBe(before.status.voiceLimit); expect(after.performance).toEqual(before.performance);
  expect(after.audio).toBe(audio); expect(newSession.worklets).toBe(oldSession.worklets); expect(newSession.sources).toEqual(oldSession.sources);
  if (audio) { await live(page); expect(newSession.time).toBeGreaterThan(oldSession.time); }
  await cleanup(page, evidence);
});

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
    const source = await response.text(), costUpdate = 'visualCostMs += (cost - visualCostMs) * .15;';
    expect(source.split(costUpdate).length - 1).toBe(1);
    // Control only the requested display cadence. Actual renderer work, Rust
    // processing, RAF timestamps and audio clocks remain real.
    await route.fulfill({ response, body: source.replace(costUpdate,
      'visualCostMs = __deviceRuntime.fixedVisualCost ?? (visualCostMs + (cost - visualCostMs) * .15);') + `
const qaObjectIds = new WeakMap(); let qaObjectSequence = 0;
const qaObjectId = value => {
  if (!value) return null;
  if (!qaObjectIds.has(value)) qaObjectIds.set(value, ++qaObjectSequence);
  return qaObjectIds.get(value);
};
window.__deviceQa = {
  engine: browserEngine, applyScene,
  scene: () => captureScene(state.parameters, state.performance),
  view: () => {
    const nodes = geometry?.nodes ?? [], ids = new Set(nodes.map(node => node.id));
    return { parameters: structuredClone(state.parameters), installed: structuredClone(previewParameters),
      prepared: preparedGraphicsNodes?.length ?? 0, nodes: nodes.length, maps: geometry?.byId.size ?? 0,
      waves: geometry?.waves.size ?? 0, roots: nodes.filter(node => node.generation === 0).length,
      connected: nodes.every(node => !node.parentId || ids.has(node.parentId)),
      graphics: graphicsCapacity?.diagnostics(), gpu: gpuRenderer?.stats ?? null,
      geometryIdentity: qaObjectId(geometry), fit: geometry ? { ...geometry.fit } : null,
      desiredFit: geometry ? { ...geometry.desiredFit } : null, bounds: nativePreview?.bounds,
      moving: nativePreviewMoving, cadence: typeof renderCadence === 'undefined' ? null : renderCadence.diagnostics(),
      fps: visualBudget(state.status.cpuLoad, state.status.peakLoad, false, state.audio, visualCostMs).fps };
  },
  positions: () => (geometry?.nodes ?? []).map(node => ({ id: node.id, object: qaObjectId(node),
    wave: qaObjectId(geometry.waves.get(node.id)), x: node.x, y: node.y, startX: node.startX, startY: node.startY,
    generation: node.generation, gain: node.gain })),
  holdVisualCost: value => { __deviceRuntime.fixedVisualCost = value; visualCostMs = value; scheduleDraw(); },
  traceGraphics: () => {
    const observe = graphicsCapacity.observe;
    __deviceRuntime.graphicsSamples = [];
    graphicsCapacity.observe = input => {
      const before = graphicsCapacity.diagnostics(), changed = observe(input);
      __deviceRuntime.graphicsSamples.push({ input, before, after: graphicsCapacity.diagnostics(), changed });
      if (__deviceRuntime.graphicsSamples.length > 1000) __deviceRuntime.graphicsSamples.shift();
      return changed;
    };
  },
  forceGraphicsPressure: () => {
    const before = graphicsCapacity.limit;
    const changed = graphicsCapacity.observe({ nowMs: performance.now(), setupMs: 40, workMs: 20,
      drawnNodes: geometry?.nodes.length ?? 0, continuous: false });
    if (changed) { graphicsSelectionDirty = true; void refreshNativePreview(); scheduleDraw(); }
    return { before, after: graphicsCapacity.limit, changed };
  },
  recoverGraphics: target => {
    const before = graphicsCapacity.limit, at = performance.now();
    let changed = false;
    // Prove healthy work deterministically through the public controller. The
    // connected-prefix update still runs through the application's real path.
    for (let step = 1; step <= 1024 && graphicsCapacity.limit < target; step++) {
      changed = graphicsCapacity.observe({ nowMs: at + step * 500, workMs: .01, setupMs: 0,
        drawnNodes: Math.min(graphicsCapacity.limit, preparedGraphicsNodes.length), continuous: false }) || changed;
    }
    if (changed) { graphicsSelectionDirty = true; void refreshNativePreview(); scheduleDraw(); }
    return { before, after: graphicsCapacity.limit, changed };
  },
};
` });
  });
  return { errors, failures };
}

async function ready(page, renderer = 'webgl2') {
  await page.goto(`/l-mic-rust.html?renderer=${renderer}`);
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
async function applyDense(page, kind, { depth } = {}) {
  const scene = denseScene(await page.evaluate(() => __deviceQa.scene()), kind);
  if (Number.isFinite(depth)) scene.parameters.depth = depth;
  await page.evaluate(scene => __deviceQa.applyScene(scene), scene);
  await expect(page.locator('#generations')).toBeEnabled({ timeout: 30000 });
  await expect.poll(async () => {
    const d = await diagnostics(page), v = await view(page);
    return d.parameters.generations === scene.parameters.generations && v.parameters.generations === scene.parameters.generations
      && d.parameters.depth === scene.parameters.depth
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

function sameCamera(actual, expected) {
  for (const property of ['scale', 'x', 'y']) expect(actual[property], `camera ${property}`).toBeCloseTo(expected[property], 10);
}
function sameSurvivingBranches(actual, previous) {
  const byId = new Map(previous.map(node => [node.id, node]));
  const shared = actual.filter(node => byId.has(node.id));
  expect(shared.length).toBeGreaterThan(1);
  for (const node of shared) {
    const old = byId.get(node.id);
    expect(node.object, `branch object ${node.id}`).toBe(old.object);
    for (const property of ['x', 'y', 'startX', 'startY']) expect(node[property], `${node.id} ${property}`).toBeCloseTo(old[property], 10);
    if (old.wave !== null) expect(node.wave, `wave cache ${node.id}`).toBe(old.wave);
  }
}

for (const renderer of ['canvas', 'webgl2']) test(`graphics pressure and recovery preserve camera, live depth and surviving branches during real wet audio with ${renderer}`, async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page, { voiceBudget: 256 }); await ready(page, renderer); await applyDense(page, 'parametric', { depth: 0 });
  await expect.poll(async () => (await view(page)).moving).toBe(false);
  expect((await page.evaluate(() => __deviceQa.positions())).filter(node => node.generation > 0).every(node => node.gain === 0)).toBe(true);
  const compiledRevision = (await diagnostics(page)).topologyRevision;
  await native(page, 'depth', .85);
  await expect.poll(async () => (await diagnostics(page)).parameters.depth).toBe(.85);
  expect((await diagnostics(page)).topologyRevision).toBe(compiledRevision);
  await native(page, 'automatic', false); await native(page, 'voiceCeiling', 96); await builtInInput(page);
  await expect.poll(async () => (await diagnostics(page)).status.voiceLimit).toBe(96);
  await expect.poll(async () => (await view(page)).moving).toBe(false);
  const before = await diagnostics(page), oldView = await view(page), oldSession = await session(page);
  const oldPositions = await page.evaluate(() => __deviceQa.positions());
  if (renderer === 'canvas') expect(oldPositions.some(node => node.wave !== null)).toBe(true);
  const pressure = await page.evaluate(() => __deviceQa.forceGraphicsPressure());
  expect(pressure.changed).toBe(true);
  await expect.poll(async () => (await view(page)).nodes).toBeLessThan(oldView.nodes);
  const small = await view(page), smallPositions = await page.evaluate(() => __deviceQa.positions());
  expect(small.geometryIdentity).toBe(oldView.geometryIdentity); expect(small.moving).toBe(false);
  sameCamera(small.fit, oldView.fit); sameCamera(small.desiredFit, oldView.desiredFit);
  expect(small.bounds).toEqual(oldView.bounds); sameSurvivingBranches(smallPositions, oldPositions);
  const recovery = await page.evaluate(target => __deviceQa.recoverGraphics(target), oldView.nodes);
  expect(recovery.changed).toBe(true);
  await expect.poll(async () => (await view(page)).nodes).toBeGreaterThan(small.nodes);
  const recovered = await view(page), recoveredPositions = await page.evaluate(() => __deviceQa.positions());
  expect(recovered.geometryIdentity).toBe(oldView.geometryIdentity); expect(recovered.moving).toBe(false);
  sameCamera(recovered.fit, oldView.fit); sameCamera(recovered.desiredFit, oldView.desiredFit);
  expect(recovered.bounds).toEqual(oldView.bounds); sameSurvivingBranches(recoveredPositions, smallPositions);
  const survivingIds = new Set(smallPositions.map(node => node.id));
  const returning = recoveredPositions.filter(node => !survivingIds.has(node.id));
  expect(returning.length).toBeGreaterThan(0);
  for (const node of returning) expect(node.gain, `returning branch ${node.id} reflects live depth`).toBeCloseTo(.5 * .85 ** (node.generation * .72), 12);
  const after = await diagnostics(page), afterSession = await session(page); await live(page);
  expect(after.parameters).toEqual(before.parameters); expect(after.topologyRevision).toBe(before.topologyRevision);
  expect(after.preparedVoices).toBe(before.preparedVoices); expect(after.status.voiceLimit).toBe(before.status.voiceLimit);
  expect(afterSession.contexts).toBe(oldSession.contexts); expect(afterSession.worklets).toBe(oldSession.worklets);
  expect(afterSession.sources).toEqual(oldSession.sources); expect(afterSession.time).toBeGreaterThan(oldSession.time);
  await test.info().attach('graphics-membership-with-stable-camera', { body: JSON.stringify({ renderer, oldView, pressure, small, recovery, recovered,
    sharedObjectsPreserved: true, actualBundledAudio: true, humanListening: false }, null, 2), contentType: 'application/json' });
  await cleanup(page, evidence);
});

test('intentional RAF skips at a fractional display rate do not shrink a cheap live tree', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page, { voiceBudget: 128 }); await ready(page); await applyDense(page, 'classic');
  await native(page, 'automatic', false); await native(page, 'voiceCeiling', 64); await builtInInput(page);
  await expect.poll(async () => (await diagnostics(page)).status.voiceLimit).toBe(64);
  await expect.poll(async () => (await view(page)).moving).toBe(false);
  await page.evaluate(() => __deviceQa.holdVisualCost(3.7));
  await expect.poll(async () => (await view(page)).fps).toBeLessThan(30);
  const before = await diagnostics(page), baseline = await view(page), initial = await session(page), rows = [];
  expect(Math.abs(baseline.fps - Math.round(baseline.fps))).toBeGreaterThan(.001);
  const started = Date.now();
  while (Date.now() - started < 8000) {
    await page.waitForTimeout(500);
    const d = await diagnostics(page), v = await view(page);
    expect(v.graphics.limit).toBe(baseline.graphics.limit); expect(v.graphics.changes).toBe(baseline.graphics.changes);
    expect(v.nodes).toBe(baseline.nodes); expect(v.geometryIdentity).toBe(baseline.geometryIdentity);
    sameCamera(v.fit, baseline.fit); expect(d.topologyRevision).toBe(before.topologyRevision);
    rows.push({ t: (Date.now() - started) / 1000, graphics: v.graphics, nodes: v.nodes, fps: v.fps, cadence: v.cadence });
  }
  await live(page); const final = await session(page);
  expect(final.sources).toEqual(initial.sources); expect(final.worklets).toBe(initial.worklets); expect(final.time).toBeGreaterThan(initial.time);
  await test.info().attach('planned-fractional-frame-cadence', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  await cleanup(page, evidence);
});

test('a minute of a steady dense real loop retains prepared capacity without repeated shrink and regrow', async ({ page }) => {
  test.setTimeout(150000);
  const evidence = await fixture(page); await ready(page); await page.evaluate(() => __deviceQa.traceGraphics());
  await applyDense(page, 'classic'); await builtInInput(page);
  const initial = await session(page), parameters = (await diagnostics(page)).parameters, rows = [];
  let previousCapacity = 0, previousPrepared = 0;
  const started = Date.now();
  try {
    while (Date.now() - started < 60000) {
      const d = await diagnostics(page), v = await view(page), current = await session(page), samples = await pcm(page);
      rows.push({ t: (Date.now() - started) / 1000, sampleClock: current.time, preparedCapacity: d.deviceCapacity.preparedCapacity,
        prepared: d.preparedVoices, voiceLimit: d.status.voiceLimit, requestedTargets: d.status.requestedTargets,
        cpu: d.status.cpuLoad, peakLoad: d.status.peakLoad, topologyRevision: d.topologyRevision,
        effectiveGenerations: d.effectiveParameters.generations, graphics: v.graphics, nodes: v.nodes, geometryIdentity: v.geometryIdentity,
        fit: v.fit, fps: v.fps, cadence: v.cadence, pcm: samples });
      expect(d.parameters).toEqual(parameters); expect(v.parameters).toEqual(parameters);
      expect(d.deviceCapacity.preparedCapacity).toBeGreaterThanOrEqual(previousCapacity);
      expect(d.preparedVoices).toBeGreaterThanOrEqual(previousPrepared);
      expect(d.preparedVoices).toBeLessThanOrEqual(d.deviceCapacity.preparedCapacity);
      expect(v.connected).toBe(true); expect(v.roots).toBe(1); expect(v.nodes).toBeGreaterThan(1);
      expect(samples.finite).toBe(true); expect(samples.peak).toBeLessThanOrEqual(1);
      expect(current.contexts).toBe(initial.contexts); expect(current.worklets).toBe(initial.worklets);
      expect(current.sources).toEqual(initial.sources); expect(current.microphoneRequests).toBe(0);
      previousCapacity = d.deviceCapacity.preparedCapacity; previousPrepared = d.preparedVoices;
      await page.waitForTimeout(500);
    }
    expect((await session(page)).time).toBeGreaterThan(initial.time + 50);
    for (let seconds = 0; seconds < 60; seconds += 10) expect(rows.some(row => row.t >= seconds && row.t < seconds + 10 && row.pcm.peak > 1e-5), `wet audio present during seconds ${seconds}–${seconds + 10}`).toBe(true);
  } finally {
    const graphicsSamples = await page.evaluate(() => __deviceRuntime.graphicsSamples);
    await test.info().attach('steady-device-capacity-minute', { body: JSON.stringify({ parameters, rows, actualBundledAudio: true,
      forcedAudioBudget: false, humanListening: false, graphicsSamples }, null, 2), contentType: 'application/json' });
  }
  await cleanup(page, evidence);
});

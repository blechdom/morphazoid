import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'no-preference' });

function toneWav() {
  const rate = 48000, frames = rate, buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * 173) * 3200), 44 + i * 2);
  return buffer;
}

async function fixture(page, { holdInitialState = false, audio = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/assets/synthesis/loops/electric-piano.wav', route => route.fulfill({ contentType: 'audio/wav', body: toneWav() }));
  await page.addInitScript(({ audio }) => {
    window.__shareRuntime = { texts: [], clipboard: 'success', resolveCopy: null,
      contexts: [], worklets: [], sources: [], controls: [] };
    const qa = window.__shareRuntime;
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value(text) {
      qa.texts.push(text);
      if (qa.clipboard === 'denied') return Promise.reject(new DOMException('Clipboard denied for QA', 'NotAllowedError'));
      if (qa.clipboard === 'pending') return new Promise(resolve => { qa.resolveCopy = resolve; });
      return Promise.resolve();
    } });
    if (!audio) return;
    const NativeContext = AudioContext, NativeNode = AudioWorkletNode, NativeWorker = Worker;
    window.Worker = new Proxy(NativeWorker, { construct(Target, args) {
      const worker = new Target(...args);
      if (String(args[0]).includes('/native/topology-worker.js')) {
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (data, ...rest) => { qa.controls.push({ kind: 'worker', id: data.id }); return post(data, ...rest); };
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
        qa.worklets.push({ node: this, analyser, samples: new Float32Array(1024) });
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (data, ...rest) => {
          if (data.type !== 'status') qa.controls.push({ kind: 'audio', type: data.type, id: data.id });
          return post(data, ...rest);
        };
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
  }, { audio });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch();
    let source = await response.text();
    if (holdInitialState) {
      const marker = "request('/api/state'), LAB_CONFIG";
      expect(source.split(marker).length - 1).toBe(1);
      source = source.replace(marker,
        "new Promise(resolve => { window.__releaseShareInitialState = resolve; }).then(() => request('/api/state')), LAB_CONFIG");
    }
    await route.fulfill({ response, body: source + `\nwindow.__shareQa = {
      engine: browserEngine, applyScene, timeFoldSlider: sliderFromTimeFold,
      scene: () => captureScene(state.parameters, state.performance),
      state: () => structuredClone({ parameters: state.parameters, performance: state.performance, input: state.input, audio: state.audio }),
      presets: () => structuredClone(presets),
      factoryLabel: () => presets.find(p => presetStateKey(p.snapshot) === presetStateKey(captureScene(state.parameters, state.performance)))?.label,
    };\n` });
  });
  return errors;
}

async function openSettings(page) {
  if (await page.locator('#nativeSettings').getAttribute('open') === null) await page.locator('#settingsButton').click();
  await expect(page.locator('#shareSoundName')).toBeVisible();
}
async function ready(page) {
  await expect(page.locator('#copySoundParameters')).toBeEnabled({ timeout: 30000 });
  await expect.poll(() => page.evaluate(() => {
    const d = __shareQa.engine.getDiagnostics();
    return d.initialized && !d.compilePending && !d.installPending && !d.capacityWorking;
  }), { timeout: 30000 }).toBe(true);
}
async function set(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function expectedPayload(page, name, instrument = 'micmic-rust') {
  return page.evaluate(async ({ name, instrument }) => {
    const model = await import('/src/instruments/micmic/native/model.js');
    const rules = await import('/src/instruments/micmic/native/rule-modes.js');
    const current = __shareQa.state();
    return { instrument, version: 1, name,
      snapshot: model.captureScene(current.parameters, current.performance),
      context: { ruleMode: rules.ruleMode(current.parameters), input: {
        mode: current.input.mode,
        ...(current.input.mode === 'samples' ? { sampleId: current.input.sampleId } : {}),
        loop: current.input.loop },
      liveLevels: { inputGain: current.performance.inputGain, outputLevel: current.performance.level,
        makeupDb: current.performance.mastering.makeupDb } } };
  }, { name, instrument });
}
async function copied(page, expected) {
  await expect(page.locator('#shareSoundStatus')).toContainText('Copied.');
  const text = await page.evaluate(() => __shareRuntime.texts.at(-1));
  expect(JSON.parse(text)).toEqual(expected);
  expect(text).toBe(JSON.stringify(expected, null, 2));
  await expect(page.locator('#sharedSoundText')).toHaveValue(text);
  await expect(page.locator('#sharedSoundDetails')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#sharedSoundDetails')).not.toHaveAttribute('open', '');
}

test('Share a sound preserves complete classic, nested lab, stochastic, fractional and mastering snapshots', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = await fixture(page);
  await page.goto('/l-mic-rust.html'); await ready(page); await openSettings(page);
  await expect(page.locator('#nativeSettings .header-settings-section').first()).toContainText('Share a sound');
  await expect(page.locator('#sharedSoundDetails')).toHaveAttribute('hidden', '');
  const initialName = await page.evaluate(() => __shareQa.factoryLabel() ?? 'Custom sound');
  await page.locator('#copySoundParameters').click();
  await copied(page, await expectedPayload(page, initialName));
  const factory = await page.evaluate(async () => {
    const preset = __shareQa.presets().find(p => !p.snapshot.parameters.lab);
    await __shareQa.applyScene(preset.snapshot, preset.id); return preset.label;
  });
  await ready(page);
  expect(await page.evaluate(() => __shareQa.factoryLabel())).toBe(factory);
  await page.locator('#copySoundParameters').click(); await copied(page, await expectedPayload(page, factory));
  await set(page, 'inputTrim', 1.17); await set(page, 'level', .83); await set(page, 'makeupDb', 7.5);
  await ready(page);
  const captures = [];
  for (const kind of ['classic', 'parametric', 'stochastic']) {
    await page.evaluate(async kind => {
      const scene = __shareQa.scene();
      scene.parameters = { ...scene.parameters, lSystemType: kind === 'stochastic' ? 'stochastic' : 'pythagorean',
        generations: 3, intervalMs: .375, timeRatio: 1.17, angle: 73.25, asymmetry: -.21, curls: 1.75,
        mutation: .37, pitchScale: 2.125, pruningBias: -.33, depth: .91, spread: .62,
        grammarSeed: 4294967001, branchProbability: .43 };
      if (kind === 'parametric') scene.parameters.lab = { kind: 'parametric', iterations: 3, lengthRatio: .69,
        angleIncrement: -17.25, delayRatio: .83, pitchRatio: 1.125, branchCount: 3, minLength: .017,
        contextStrength: .78, symbolRatio: 2.25 };
      else delete scene.parameters.lab;
      scene.performance = { wet: .61, dry: .17, mastering: { inputHighpassHz: 81, highpassHz: 133, lowpassHz: 7213,
        compressorEnabled: true, thresholdDb: -23.5, kneeDb: 11.25, ratio: 3.75, attackMs: .7,
        releaseMs: 347, autoMakeup: false } };
      await __shareQa.applyScene(scene);
    }, kind);
    await ready(page);
    const name = kind === 'stochastic' ? 'Custom sound' : `QA ${kind}`;
    await page.locator('#shareSoundName').fill(kind === 'stochastic' ? '' : `  ${name}  `);
    const expected = await expectedPayload(page, name);
    await page.locator('#copySoundParameters').click(); await copied(page, expected);
    expect(expected.snapshot.parameters.intervalMs).toBe(.375);
    expect(expected.snapshot.performance.mastering.releaseMs).toBe(347);
    expect(Object.keys(expected.snapshot.performance).sort()).toEqual(['dry', 'mastering', 'wet']);
    expect(expected.snapshot.performance.mastering).not.toHaveProperty('makeupDb');
    expect(expected.context.liveLevels).toEqual({ inputGain: 1.17, outputLevel: .83, makeupDb: 7.5 });
    expect(expected.context.input).not.toHaveProperty('sampleId');
    expect(expected.snapshot).not.toHaveProperty('input');
    expect(expected.snapshot.performance).not.toHaveProperty('voiceCeiling');
    captures.push(expected);
  }
  await testInfo.attach('canonical-captures', { body: JSON.stringify(captures, null, 2), contentType: 'application/json' });
  expect(await page.evaluate(() => __shareQa.state().audio)).toBe(false);
  expect(errors).toEqual([]);
});

test('capture locks during startup, scene recall and clipboard await, and captures requested edits synchronously', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await fixture(page, { holdInitialState: true });
  await page.goto('/l-mic-rust.html'); await openSettings(page);
  await page.waitForFunction(() => Boolean(window.__releaseShareInitialState));
  await expect(page.locator('#copySoundParameters')).toBeDisabled();
  await page.locator('#copySoundParameters').evaluate(button => button.click());
  expect(await page.evaluate(() => __shareRuntime.texts.length)).toBe(0);
  await page.evaluate(() => __releaseShareInitialState()); await ready(page);
  const applying = await page.evaluate(() => {
    const scene = __shareQa.scene(); scene.parameters.generations = 3;
    const promise = __shareQa.applyScene(scene); window.__shareApply = promise;
    const disabled = document.getElementById('copySoundParameters').disabled;
    document.getElementById('copySoundParameters').click();
    return { disabled, copies: __shareRuntime.texts.length };
  });
  expect(applying).toEqual({ disabled: true, copies: 0 });
  await page.evaluate(() => __shareApply); await ready(page);
  await page.locator('#shareSoundName').fill('Pending edit');
  const requested = await page.evaluate(() => {
    __shareRuntime.clipboard = 'pending';
    const input = document.getElementById('interval');
    input.value = String(__shareQa.timeFoldSlider(.625));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const snapshot = __shareQa.scene();
    // Same task: the export sees requested controls before a worker/install ACK.
    document.getElementById('copySoundParameters').click();
    document.getElementById('copySoundParameters').click();
    return { snapshot, copies: __shareRuntime.texts.length, captured: JSON.parse(__shareRuntime.texts[0]),
      disabled: document.getElementById('copySoundParameters').disabled };
  });
  expect(requested.disabled).toBe(true); expect(requested.copies).toBe(1);
  expect(requested.snapshot.parameters.intervalMs).toBeCloseTo(.625, 8);
  expect(requested.captured.snapshot).toEqual(requested.snapshot);
  await set(page, 'generationAngle', 114);
  expect(await page.evaluate(() => JSON.parse(__shareRuntime.texts[0]).snapshot)).toEqual(requested.snapshot);
  await page.evaluate(() => { __shareRuntime.clipboard = 'success'; __shareRuntime.resolveCopy(); });
  await expect(page.locator('#copySoundParameters')).toBeEnabled();
  const latest = await expectedPayload(page, 'Pending edit');
  await page.locator('#copySoundParameters').click(); await copied(page, latest);
  expect(latest.snapshot.parameters.angle).toBe(114); expect(errors).toEqual([]);
});

test('standalone laboratories identify their own instrument and capture their nested rule state', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await fixture(page);
  for (const instrument of ['l-system-parametric-lab', 'l-system-experiments']) {
    await page.goto(`/${instrument}.html`); await ready(page); await openSettings(page);
    await page.locator('#shareSoundName').fill('Lab sound');
    const expected = await expectedPayload(page, 'Lab sound', instrument);
    expect(expected.snapshot.parameters.lab).toBeDefined();
    expect(expected.context.ruleMode).toBe(`lab:${expected.snapshot.parameters.lab.kind}`);
    await page.locator('#copySoundParameters').click(); await copied(page, expected);
  }
  expect(errors).toEqual([]);
});

for (const layout of [
  { label: 'desktop', viewport: { width: 1440, height: 900 }, touch: false },
  { label: 'phone portrait', viewport: { width: 390, height: 844 }, touch: true },
  { label: 'phone landscape', viewport: { width: 844, height: 390 }, touch: true },
]) {
  test(`denied clipboard exposes selected manual text and permits a later copy on ${layout.label}`, async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(60000);
    const context = await browser.newContext({ baseURL, viewport: layout.viewport, hasTouch: layout.touch, colorScheme: 'dark', reducedMotion: 'no-preference' });
    const page = await context.newPage();
    try {
      const errors = await fixture(page); await page.goto('/l-mic-rust.html'); await ready(page); await openSettings(page);
      await page.locator('#shareSoundName').fill('Portable sound');
      const expected = await expectedPayload(page, 'Portable sound');
      await page.evaluate(() => { __shareRuntime.clipboard = 'denied'; });
      await page.locator('#copySoundParameters').click();
      await expect(page.locator('#shareSoundStatus')).toContainText('Select and copy');
      await expect(page.locator('#sharedSoundText')).toBeVisible();
      await expect(page.locator('#sharedSoundText')).toHaveAttribute('readonly', '');
      const manual = await page.locator('#sharedSoundText').evaluate(text => ({ value: text.value,
        selected: text.value.slice(text.selectionStart, text.selectionEnd), focused: document.activeElement === text,
        rect: { x: text.getBoundingClientRect().x, right: text.getBoundingClientRect().right,
          y: text.getBoundingClientRect().y, bottom: text.getBoundingClientRect().bottom } }));
      expect(JSON.parse(manual.value)).toEqual(expected); expect(manual.selected).toBe(manual.value); expect(manual.focused).toBe(true);
      await page.locator('#sharedSoundText').scrollIntoViewIfNeeded();
      const bounds = await page.locator('#sharedSoundText').boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.viewport.width);
      expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(layout.viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (layout.touch) {
        for (const id of ['shareSoundName', 'copySoundParameters']) expect((await page.locator(`#${id}`).boundingBox()).height).toBeGreaterThanOrEqual(48);
      }
      await testInfo.attach('manual-copy', { body: JSON.stringify({ layout, manual }, null, 2), contentType: 'application/json' });
      await page.evaluate(() => { __shareRuntime.clipboard = 'success'; });
      await page.locator('#copySoundParameters').click(); await copied(page, expected);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('copying parameters retains the live wet source, audio context, sample clock and controls', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = await fixture(page, { audio: true });
  await page.goto('/l-mic-rust.html'); await ready(page);
  await page.evaluate(async () => { const scene = __shareQa.scene(); scene.parameters.generations = 3;
    scene.performance.wet = .7; scene.performance.dry = 0; await __shareQa.applyScene(scene); });
  await set(page, 'source', 'samples'); await set(page, 'inputSample', 'music-keys');
  await set(page, 'inputTrim', .8); await set(page, 'level', .6); await ready(page);
  await page.locator('#audioButton').click();
  const witness = () => page.evaluate(() => {
    const qa = __shareRuntime, monitor = qa.worklets.at(-1), d = __shareQa.engine.getDiagnostics();
    if (monitor) monitor.analyser.getFloatTimeDomainData(monitor.samples);
    return { sampleClock: __shareQa.engine.getSampleTime(), contextClock: qa.contexts.at(-1)?.currentTime,
      contextState: qa.contexts.at(-1)?.state, contexts: qa.contexts.length, worklets: qa.worklets.length,
      sources: structuredClone(qa.sources), controls: structuredClone(qa.controls), audio: __shareQa.state().audio,
      processedBlocks: d.processedBlocks, finite: monitor?.samples.every(Number.isFinite),
      peak: monitor ? Math.max(...monitor.samples.map(Math.abs)) : 0 };
  });
  await expect.poll(async () => (await witness()).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
  await ready(page); await openSettings(page); await page.locator('#shareSoundName').fill('Live sample');
  const before = await witness(), expected = await expectedPayload(page, 'Live sample');
  expect(expected.context.input).toEqual({ mode: 'samples', sampleId: 'music-keys', loop: true });
  await page.evaluate(() => { __shareRuntime.clipboard = 'pending'; });
  await page.locator('#copySoundParameters').click(); await expect(page.locator('#copySoundParameters')).toBeDisabled();
  await page.waitForTimeout(300);
  const during = await witness();
  await page.evaluate(() => { __shareRuntime.clipboard = 'success'; __shareRuntime.resolveCopy(); });
  await copied(page, expected); await page.waitForTimeout(300);
  const after = await witness();
  for (const row of [during, after]) {
    expect(row.audio).toBe(true); expect(row.contextState).toBe('running');
    expect(row.contexts).toBe(before.contexts); expect(row.worklets).toBe(before.worklets);
    expect(row.sources).toEqual(before.sources); expect(row.controls).toEqual(before.controls);
    expect(row.contextClock).toBeGreaterThan(before.contextClock); expect(row.sampleClock).toBeGreaterThan(before.sampleClock);
    expect(row.processedBlocks).toBeGreaterThan(before.processedBlocks);
    expect(row.finite).toBe(true); expect(row.peak).toBeGreaterThan(1e-5); expect(row.peak).toBeLessThanOrEqual(1);
  }
  await testInfo.attach('live-capture-witness', { body: JSON.stringify({ before, during, after, expected }, null, 2), contentType: 'application/json' });
  await page.locator('#audioButton').click(); expect(errors).toEqual([]);
});

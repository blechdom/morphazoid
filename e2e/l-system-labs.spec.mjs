import { test, expect } from '@playwright/test';

const variants = [
  { route: 'l-system-parametric-lab.html', id: 'l-system-parametric-lab', kinds: ['parametric'] },
  { route: 'l-system-experiments.html', id: 'l-system-experiments', kinds: ['context', 'thue-morse', 'fibonacci', 'penrose', 'sphinx'] },
];
const layouts = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }];

function wav() {
  const rate = 48000, frames = rate, buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 2 * 173) * 3200), 44 + i * 2);
  return buffer;
}

async function fixture(page, { holdInitialState = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/assets/synthesis/loops/electric-piano.wav', route => route.fulfill({ contentType: 'audio/wav', body: wav() }));
  await page.addInitScript(() => {
    window.__labRuntime = { contexts: [], worklets: [], sources: [], peaks: [] };
    const NativeContext = AudioContext, NativeNode = AudioWorkletNode;
    window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); __labRuntime.contexts.push(this); } };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(...args) {
        super(...args);
        const analyser = this.context.createAnalyser(), mute = this.context.createGain();
        analyser.fftSize = 1024; mute.gain.value = 0; this.connect(analyser).connect(mute).connect(this.context.destination);
        __labRuntime.worklets.push({ node: this, analyser, buffer: new Float32Array(1024) });
      }
    };
    const create = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const source = create.apply(this, args), record = { starts: 0, stops: 0 };
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { record.starts++; return start(...args); };
      source.stop = (...args) => { record.stops++; return stop(...args); };
      __labRuntime.sources.push(record); return source;
    };
  });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch();
    let source = await response.text();
    if (holdInitialState) {
      const initialRequest = "request('/api/state'), LAB_CONFIG";
      expect(source.split(initialRequest).length - 1).toBe(1);
      // Delay only the startup read; real control requests and Rust compilation
      // remain active so the performer can edit while initialization is pending.
      source = source.replace(initialRequest,
        "new Promise(resolve => { window.__releaseInitialLabState = resolve; }).then(() => request('/api/state')), LAB_CONFIG");
    }
    await route.fulfill({ response, body: source + `\nwindow.__labQa = {
      engine: browserEngine, applyScene, presetBank: () => structuredClone(presets),
      scene: () => captureScene(state.parameters, state.performance),
      activityIdentityProof: () => {
        const saved = { tapIdentity, tapRuleMode, tapTargets, tapLevels, tapReceivedAt };
        try {
          const { lab, ...classic } = state.parameters;
          const base = { ...classic, lSystemType: 'pythagorean' };
          syncActivityIdentity(base); tapLevels = new Map([[7, .42]]); tapTargets = new Map([[7, .5]]);
          syncActivityIdentity({ ...base, generations: base.generations + 1 });
          const growthRetained = tapLevels.get(7) === .42 && tapTargets.get(7) === .5;
          syncActivityIdentity({ ...base, lab: { kind: 'parametric', iterations: 6 } });
          const classicToNumericCleared = tapLevels.size === 0 && tapTargets.size === 0;
          tapLevels = new Map([[7, .42]]); tapTargets = new Map([[7, .5]]);
          syncActivityIdentity({ ...base, lab: { kind: 'sphinx', iterations: 6 } });
          const numericToTileCleared = tapLevels.size === 0 && tapTargets.size === 0;
          return { growthRetained, classicToNumericCleared, numericToTileCleared };
        } finally { ({ tapIdentity, tapRuleMode, tapTargets, tapLevels, tapReceivedAt } = saved); }
      },
      view: () => ({ ui: structuredClone(state.parameters), installed: structuredClone(previewParameters),
        nodes: geometry?.nodes.map(({ id, parentId, x, y, delay, rate, priority, generation }) => ({ id, parentId, x, y, delay, rate, priority, generation })) ?? [] }),
    };\n` });
  });
  return errors;
}

async function set(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function diagnostics(page) { return page.evaluate(() => __labQa.engine.getDiagnostics()); }
async function settled(page, kind) {
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.parameters.lab?.kind === kind && !d.compilePending && !d.installPending;
  }, { timeout: 30000 }).toBe(true);
  await page.waitForFunction(kind => __labQa.view().installed.lab?.kind === kind && __labQa.view().nodes.length > 1, kind);
}
async function peak(page) {
  return page.evaluate(() => {
    const monitor = __labRuntime.worklets.at(-1); monitor.analyser.getFloatTimeDomainData(monitor.buffer);
    return { peak: Math.max(...monitor.buffer.map(Math.abs)), finite: monitor.buffer.every(Number.isFinite) };
  });
}

async function settledRule(page, mode) {
  const labKind = mode.startsWith('lab:') ? mode.slice(4) : null;
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return !d.compilePending && !d.installPending && (labKind ? d.parameters.lab?.kind === labKind
      : !d.parameters.lab && d.parameters.lSystemType === mode);
  }, { timeout: 30000 }).toBe(true);
  await page.waitForFunction(({ mode, labKind }) => {
    const view = __labQa.view();
    return view.nodes.length > 1 && (labKind ? view.installed.lab?.kind === labKind
      : !view.installed.lab && view.installed.lSystemType === mode);
  }, { mode, labKind });
}

async function choosePreset(page, preset) {
  const picker = page.locator('.instrument-preset-controls');
  if (await picker.locator('details').getAttribute('open') === null) await picker.locator('summary').click();
  await picker.locator(`button[data-full-preset][data-preset-id="${preset.id}"]`).click();
  await expect(picker).toHaveAttribute('data-preset-id', preset.id, { timeout: 30000 });
  await expect(page.locator('#generations')).toBeEnabled();
  const mode = preset.snapshot.parameters.lab ? `lab:${preset.snapshot.parameters.lab.kind}` : preset.snapshot.parameters.lSystemType;
  await settledRule(page, mode);
  expect(await page.evaluate(() => __labQa.scene())).toEqual(preset.snapshot);
  await expect(page.locator('#lSystemType')).toHaveValue(mode);
}

test('current Delay crosses every integrated rule family and factory preset without restarting live wet audio', async ({ page }) => {
  test.setTimeout(180000);
  const errors = await fixture(page);
  await page.goto('/l-mic-rust.html?renderer=webgl2');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await settledRule(page, 'pythagorean');
  expect(await page.evaluate(() => __labQa.activityIdentityProof())).toEqual({
    growthRetained: true, classicToNumericCleared: true, numericToTileCleared: true,
  });
  const bank = await page.evaluate(() => __labQa.presetBank());
  expect(bank).toHaveLength(210);
  const kinds = ['parametric', 'context', 'thue-morse', 'fibonacci', 'penrose', 'sphinx'];
  expect(new Set(bank.flatMap(preset => preset.snapshot.parameters.lab ? [preset.snapshot.parameters.lab.kind] : []))).toEqual(new Set(kinds));
  await page.locator('#recursionSection').evaluate(details => { details.open = true; });
  await set(page, 'source', 'samples');
  await expect.poll(async () => (await diagnostics(page)).input.mode).toBe('samples');
  await set(page, 'inputSample', 'music-keys');
  await set(page, 'inputTrim', .7); await set(page, 'level', .6); await set(page, 'makeupDb', 4);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
  const session = () => page.evaluate(() => ({ time: __labQa.engine.getSampleTime(),
    contexts: __labRuntime.contexts.length, worklets: __labRuntime.worklets.length,
    sources: structuredClone(__labRuntime.sources) }));
  const before = await session(), rows = [];
  for (const kind of kinds) {
    await page.locator('#lSystemType').selectOption(`lab:${kind}`);
    await settledRule(page, `lab:${kind}`);
    await expect(page.locator('#labRuleControls')).toBeVisible();
    await expect(page.locator('#stochasticControls')).toBeHidden();
    await expect(page.locator('#generations')).toHaveAttribute('max', '24');
    const visible = await page.locator('#labRuleControls input').evaluateAll(inputs => inputs.filter(input => !input.closest('label').hidden).map(input => input.id));
    expect(visible.sort()).toEqual((kind === 'parametric'
      ? ['labLengthRatio', 'labAngleIncrement', 'labDelayRatio', 'labPitchRatio', 'labBranchCount', 'labMinLength']
      : kind === 'context' ? ['labContextStrength', 'labSymbolRatio'] : ['labSymbolRatio']).sort());
    const preset = bank.find(preset => preset.snapshot.parameters.lab?.kind === kind);
    await choosePreset(page, preset);
    // Dry is disabled for the measurement so genuine descendants must sound.
    await set(page, 'dry', 0); await set(page, 'wet', .65);
    await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
    const d = await diagnostics(page), pcm = await peak(page);
    expect(pcm.finite).toBe(true); expect(pcm.peak).toBeLessThanOrEqual(1);
    expect(d.parameters.generations).toBe(d.parameters.lab.iterations);
    expect(d.performance.inputGain).toBe(.7); expect(d.performance.level).toBe(.6); expect(d.performance.mastering.makeupDb).toBe(4);
    expect(d.input.mode).toBe('samples'); expect(d.input.playing).toBe(true); expect(d.audio).toBe(true);
    const current = await session();
    expect(current.contexts).toBe(before.contexts); expect(current.worklets).toBe(before.worklets); expect(current.sources).toEqual(before.sources);
    expect(current.time).toBeGreaterThan(before.time);
    rows.push({ kind, presetId: preset.id, peak: pcm.peak, voices: d.status.activeVoices, time: current.time });
  }
  await choosePreset(page, bank.find(preset => preset.id === 'pythagorean'));
  await expect(page.locator('#labRuleControls')).toBeHidden();
  expect((await diagnostics(page)).parameters.lab).toBeUndefined();
  const after = await session();
  expect(after.time).toBeGreaterThan(before.time); expect(after.worklets).toBe(before.worklets); expect(after.sources).toEqual(before.sources);
  await test.info().attach('unified-rule-live-audio', { body: JSON.stringify({ rows, before, after, actualWasm: true, dryRootMuted: true, humanListening: false }, null, 2), contentType: 'application/json' });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  expect((await diagnostics(page)).disposed).toBe(true); expect(errors).toEqual([]);
});

test('rejected integrated scene restores mix and mastering in the same live Rust session', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await fixture(page);
  await page.goto('/l-mic-rust.html');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await settledRule(page, 'pythagorean');
  await set(page, 'source', 'samples'); await set(page, 'inputSample', 'music-keys');
  await set(page, 'wet', .43); await set(page, 'dry', .07); await set(page, 'thresholdDb', -23);
  await set(page, 'inputTrim', .7); await set(page, 'level', .6); await set(page, 'makeupDb', 4);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
  const before = await diagnostics(page), previousScene = await page.evaluate(() => __labQa.scene());
  const session = await page.evaluate(() => ({ time: __labQa.engine.getSampleTime(), worklets: __labRuntime.worklets.length, sources: structuredClone(__labRuntime.sources) }));
  const rejected = await page.evaluate(async () => {
    const engine = __labQa.engine, original = engine.request.bind(engine), performanceWrites = [];
    let reject = true;
    engine.request = async (url, body) => {
      if (url === '/api/performance') performanceWrites.push(structuredClone(body));
      if (url === '/api/parameters' && reject) { reject = false; throw new Error('QA topology capacity rejection'); }
      return original(url, body);
    };
    let message = '';
    try { await __labQa.applyScene(__labQa.presetBank().find(preset => preset.snapshot.parameters.lab?.kind === 'parametric').snapshot); }
    catch (error) { message = error.message; }
    finally { engine.request = original; }
    return { message, performanceWrites, scene: __labQa.scene() };
  });
  expect(rejected.message).toBe('QA topology capacity rejection');
  expect(rejected.performanceWrites).toHaveLength(2);
  expect(rejected.performanceWrites[0].wet).not.toBe(before.performance.wet);
  expect(rejected.scene).toEqual(previousScene);
  const after = await diagnostics(page);
  expect(after.parameters).toEqual(before.parameters);
  expect(after.performance).toEqual(before.performance);
  for (const [id, value] of [['wet', .43], ['dry', .07], ['thresholdDb', -23], ['inputTrim', .7], ['level', .6], ['makeupDb', 4]])
    expect(Number(await page.locator(`#${id}`).inputValue()), id).toBe(value);
  await expect(page.locator('#generations')).toBeEnabled();
  await expect(page.locator('#stage')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
  const current = await page.evaluate(() => ({ time: __labQa.engine.getSampleTime(), worklets: __labRuntime.worklets.length, sources: structuredClone(__labRuntime.sources) }));
  expect(current.time).toBeGreaterThanOrEqual(session.time); expect(current.worklets).toBe(session.worklets); expect(current.sources).toEqual(session.sources);
  expect(after.audio).toBe(true); expect(after.input.playing).toBe(true);
  await page.locator('#audioButton').click(); await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  expect((await diagnostics(page)).disposed).toBe(true); expect(errors).toEqual([]);
});

for (const variant of variants) {
  test(`${variant.id} preserves early mix and mastering edits while its initial state is delayed`, async ({ page }) => {
    const errors = await fixture(page, { holdInitialState: true });
    await page.goto(`/${variant.route}`);
    await page.waitForFunction(() => window.__labQa && window.__releaseInitialLabState);
    await expect(page.locator('#audioButton')).toBeDisabled();
    await set(page, 'wet', .33); await set(page, 'dry', .17); await set(page, 'thresholdDb', -22);
    await set(page, 'inputTrim', .7); await set(page, 'level', .6);
    const musicalState = async () => {
      const { performance } = await diagnostics(page);
      return { wet: performance.wet, dry: performance.dry, thresholdDb: performance.mastering.thresholdDb,
        inputGain: performance.inputGain, level: performance.level };
    };
    const edited = { wet: .33, dry: .17, thresholdDb: -22, inputGain: .7, level: .6 };
    await expect.poll(musicalState, { timeout: 30000 }).toEqual(edited);
    await page.evaluate(() => window.__releaseInitialLabState());
    await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
    await settled(page, variant.kinds[0]);
    await expect(page.locator('#pitchDetail, #pitchDetailStatus')).toHaveCount(0);
    await expect(page.locator('#mixSection #masteringSection')).toHaveCount(1);
    await expect(page.locator('#masteringSection > summary')).toHaveCount(0);
    expect(await musicalState()).toEqual(edited);
    for (const [id, value] of [['wet', '.33'], ['dry', '.17'], ['thresholdDb', '-22'], ['inputTrim', '.7'], ['level', '.6']])
      expect(Number(await page.locator(`#${id}`).inputValue()), id).toBe(Number(value));
    expect((await diagnostics(page)).audio).toBe(false);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    expect((await diagnostics(page)).disposed).toBe(true); expect(errors).toEqual([]);
  });
  test(`${variant.id} has reachable controls on desktop and both phone layouts`, async ({ page }) => {
    test.setTimeout(90000);
    const errors = await fixture(page);
    await page.goto(`/${variant.route}`);
    await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
    await settled(page, variant.kinds[0]);
    await expect(page.locator('[data-active-tool-id]')).toHaveAttribute('data-active-tool-id', variant.id);
    expect((await diagnostics(page)).audio).toBe(false);
    for (const viewport of layouts) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (viewport.width < 760) {
        const title = await page.locator('.lab-stage-title').boundingBox(), meta = await page.locator('.stage-meta').boundingBox();
        expect(meta.y).toBeGreaterThanOrEqual(title.y + title.height);
      }
      for (const id of ['source', 'generations', 'interval', 'generationAngle', 'curls', 'depth', 'wet', 'inputTrim', variant.kinds[0] === 'parametric' ? 'labDelayRatio' : 'labSymbolRatio']) {
        const control = page.locator(`#${id}`);
        await control.evaluate(input => { for (let p = input.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; });
        // Native selects retain their events beneath the compact Choose UI.
        const target = await control.evaluateHandle(input => input.closest('[data-select-id]') || input.closest('label') || input);
        await target.asElement().scrollIntoViewIfNeeded();
        expect(await target.asElement().isVisible(), id).toBe(true);
      }
      await page.screenshot({ path: test.info().outputPath(`${variant.id}-${viewport.width}.png`) });
    }
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    expect((await diagnostics(page)).disposed).toBe(true); expect(errors).toEqual([]);
  });

  test(`${variant.id} changes rules and presets through the same live Rust audio session`, async ({ page }) => {
    test.setTimeout(150000);
    const errors = await fixture(page);
    await page.goto(`/${variant.route}?renderer=webgl2`);
    await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
    await settled(page, variant.kinds[0]);
    await set(page, 'source', 'samples');
    await expect.poll(async () => (await diagnostics(page)).input.mode).toBe('samples');
    await set(page, 'inputSample', 'music-keys');
    await page.locator('#audioButton').click();
    await expect.poll(async () => (await diagnostics(page)).audio).toBe(true);
    await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
    await set(page, 'inputTrim', .7); await set(page, 'level', .6);
    const before = await page.evaluate(() => ({ time: __labQa.engine.getSampleTime(), worklets: __labRuntime.worklets.length,
      sources: __labRuntime.sources.filter(s => s.starts).length }));
    for (const kind of variant.kinds) {
      if (variant.kinds.length > 1) await set(page, 'labKind', kind);
      await settled(page, kind);
      const view = await page.evaluate(() => __labQa.view());
      expect(view.nodes.every(n => [n.x, n.y, n.delay, n.rate].every(Number.isFinite))).toBe(true);
      expect(view.nodes.some(n => n.generation > 0 && n.priority >= 0)).toBe(true);
      await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
      expect((await peak(page)).finite).toBe(true);
    }
    const viewBefore = await page.evaluate(() => __labQa.view());
    const sensitivity = variant.kinds[0] === 'parametric' ? ['labDelayRatio', 'delayRatio', .45] : ['labSymbolRatio', 'symbolRatio', 2.4];
    await set(page, sensitivity[0], sensitivity[2]);
    await expect.poll(async () => (await diagnostics(page)).parameters.lab[sensitivity[1]]).toBe(sensitivity[2]);
    await expect.poll(() => page.evaluate(key => __labQa.view().installed.lab[key], sensitivity[1])).toBe(sensitivity[2]);
    const viewAfter = await page.evaluate(() => __labQa.view());
    expect(viewAfter.nodes.map(n => [n.delay, n.rate])).not.toEqual(viewBefore.nodes.map(n => [n.delay, n.rate]));
    // Complete factory recall should restore lab rules while retaining live gains.
    const preset = await page.evaluate(() => __labQa.presetBank()[0]);
    await page.evaluate(preset => __labQa.applyScene(preset.snapshot, preset.id), preset);
    await settled(page, variant.kinds[0]);
    const final = await diagnostics(page);
    expect(final.parameters.lab).toEqual(preset.snapshot.parameters.lab);
    expect(final.performance.inputGain).toBe(.7); expect(final.performance.level).toBe(.6);
    expect(final.audio).toBe(true); expect(final.status.elapsedSeconds).toBeGreaterThan(0);
    const after = await page.evaluate(() => ({ time: __labQa.engine.getSampleTime(), worklets: __labRuntime.worklets.length,
      sources: __labRuntime.sources.filter(s => s.starts).length }));
    expect(after.time).toBeGreaterThan(before.time); expect(after.worklets).toBe(before.worklets); expect(after.sources).toBe(before.sources);
    await page.locator('#audioButton').click();
    await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    expect((await diagnostics(page)).disposed).toBe(true); expect(errors).toEqual([]);
  });
}

test('current Delay plays every added grammar and changes stochastic patterns only on rule edits', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await fixture(page);
  await page.goto('/l-mic-rust.html?renderer=webgl2');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await set(page, 'source', 'samples');
  await expect.poll(async () => (await diagnostics(page)).input.mode).toBe('samples');
  await set(page, 'inputSample', 'music-keys'); await page.locator('#audioButton').click();
  await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
  const bank = await page.evaluate(() => __labQa.presetBank());
  const before = await page.evaluate(() => ({ time: __labQa.engine.getSampleTime(), worklets: __labRuntime.worklets.length,
    sources: __labRuntime.sources.filter(s => s.starts).length }));
  for (const type of ['peano', 'arrowhead', 'quadratic-koch', 'kolam', 'dekking', 'stochastic']) {
    const preset = bank.find(preset => preset.snapshot.parameters.lSystemType === type);
    expect(preset, type).toBeTruthy();
    await page.evaluate(preset => __labQa.applyScene(preset.snapshot, preset.id), preset);
    await expect.poll(async () => (await diagnostics(page)).parameters.lSystemType).toBe(type);
    await expect.poll(() => page.evaluate(() => __labQa.view().installed.lSystemType)).toBe(type);
    await expect.poll(async () => (await peak(page)).peak, { timeout: 30000 }).toBeGreaterThan(1e-5);
    expect((await peak(page)).finite).toBe(true);
  }
  await page.locator('#recursionSection > summary').click();
  await expect(page.locator('#stochasticControls')).toBeVisible();
  const ids = () => page.evaluate(() => __labQa.view().nodes.map(n => [n.id, n.parentId]));
  const initial = await ids(), initialState = (await diagnostics(page)).parameters;
  await set(page, 'generationAngle', initialState.angle + 5);
  await expect.poll(async () => (await diagnostics(page)).parameters.angle).toBe(initialState.angle + 5);
  await expect.poll(() => page.evaluate(() => __labQa.view().installed.angle)).toBe(initialState.angle + 5);
  expect(await ids()).toEqual(initial);
  await page.locator('#regrowGrammar').click();
  await expect.poll(async () => (await diagnostics(page)).parameters.grammarSeed).toBe(initialState.grammarSeed + 1);
  await expect.poll(() => page.evaluate(() => __labQa.view().installed.grammarSeed)).toBe(initialState.grammarSeed + 1);
  expect(await ids()).not.toEqual(initial);
  const preset = bank.find(preset => preset.snapshot.parameters.lSystemType === 'stochastic');
  await page.evaluate(preset => __labQa.applyScene(preset.snapshot, preset.id), preset);
  await expect.poll(() => page.evaluate(() => __labQa.view().installed.grammarSeed)).toBe(initialState.grammarSeed);
  expect(await ids()).toEqual(initial);
  const after = await page.evaluate(() => ({ time: __labQa.engine.getSampleTime(), worklets: __labRuntime.worklets.length,
    sources: __labRuntime.sources.filter(s => s.starts).length }));
  expect(after.time).toBeGreaterThan(before.time); expect(after.worklets).toBe(before.worklets); expect(after.sources).toBe(before.sources);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  expect((await diagnostics(page)).disposed).toBe(true); expect(errors).toEqual([]);
});

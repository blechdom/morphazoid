import { test, expect } from '@playwright/test';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const WORKLET = '**/src/instruments/micmic/native/delay-worklet.js';
const FAULT = 'QA forced L-system processor failure';

async function audioFixture(page, { fault = false, sceneRecall = false } = {}) {
  const errors = [], consoleErrors = [];
  let faultSourceRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    window.__generationRecoveryQa = { nodes: [], monitors: [], processorErrors: 0, microphoneRequests: 0, streams: [], messages: [], startup: [] };
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-l-system-delay') {
        __generationRecoveryQa.nodes.push(node);
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 512; mute.gain.value = 0;
        node.connect(analyser).connect(mute).connect(node.context.destination);
        __generationRecoveryQa.monitors.push({ analyser, samples: new Float32Array(analyser.fftSize) });
        const nativeError = Object.getOwnPropertyDescriptor(Target.prototype, 'onprocessorerror');
        Object.defineProperty(node, 'onprocessorerror', {
          configurable: true,
          get() { return nativeError.get.call(this); },
          set(handler) { nativeError.set.call(this, handler && function (event) {
            __generationRecoveryQa.processorErrors++;
            handler.call(this, event);
          }); },
        });
        node.port.addEventListener('message', ({ data }) => {
          if (data.type || data.error) __generationRecoveryQa.messages.push({ type: data.type, error: data.error });
          const s = data.status, observations = __generationRecoveryQa.startup, previous = observations.at(-1);
          if (s && s.elapsedSeconds <= 5 && observations.length < 128
            && (!previous || s.elapsedSeconds >= previous.elapsedSeconds + .15)) {
            observations.push(Object.fromEntries(['elapsedSeconds', 'topologyRevision', 'voiceLimit', 'calibratedVoices',
              'installedCapacity', 'cpuLoad', 'peakLoad', 'deadlineMisses', 'inputPeak', 'outputPeak'].map(key => [key, s[key]])));
          }
        });
      }
      return node;
    } });
    navigator.mediaDevices.getUserMedia = async () => {
      __generationRecoveryQa.microphoneRequests++;
      const context = new AudioContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 173; gain.gain.value = .03;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      __generationRecoveryQa.streams.push(destination.stream);
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); oscillator.stop(); void context.close(); };
      }
      return destination.stream;
    };
  });
  if (sceneRecall) await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch(), source = await response.text();
    // Exercise the existing saved/legacy scene adapter without adding a
    // production debug API or replacing the real app, worker or Rust DSP.
    await route.fulfill({ response, body: source + '\n__generationRecoveryQa.applyScene = applyScene;\n' });
  });
  if (fault) await page.route(WORKLET, async route => {
    faultSourceRequests++;
    const response = await route.fetch();
    const source = await response.text();
    // A genuine process() exception dispatches the browser's processorerror.
    // This routed QA source leaves the Rust engine and production page intact.
    const marker = "registerProcessor('morphazoid-l-system-delay', LSystemDelayProcessor);";
    expect(source).toContain(marker);
    const injection = `
const qaMessage = LSystemDelayProcessor.prototype.message;
LSystemDelayProcessor.prototype.message = function (data) {
  if (data.type === 'qa-force-processor-error') { this.qaFaultRequested = true; this.port.postMessage({ type: 'qa-fault-armed' }); return; }
  if (data.type === 'qa-force-wasm-trap') {
    this.api = { ...this.api, lsd_process() { throw new WebAssembly.RuntimeError('${FAULT}'); } };
    this.port.postMessage({ type: 'qa-fault-armed' }); return;
  }
  return qaMessage.call(this, data);
};
const qaProcess = LSystemDelayProcessor.prototype.process;
LSystemDelayProcessor.prototype.process = function (...args) {
  if (this.qaFaultRequested) throw new Error('${FAULT}');
  return qaProcess.apply(this, args);
};
`;
    await route.fulfill({ response, body: source.replace(marker, injection + marker) });
  });
  if (fault) await page.addInitScript(() => {
    // Chromium's AudioWorklet module fetch bypasses Playwright page routing.
    // Fetch this one module through the page so its scoped QA route applies,
    // then load that unchanged module graph plus the fault hook as a Blob.
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, options) {
      const absolute = new URL(url, location.href);
      if (!absolute.pathname.endsWith('/src/instruments/micmic/native/delay-worklet.js')) return addModule.call(this, url, options);
      const response = await fetch(absolute), source = await response.text();
      const resolved = source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
        (_, quote, path) => `from ${quote}${new URL(path, absolute).href}${quote}`);
      const blob = URL.createObjectURL(new Blob([resolved], { type: 'text/javascript' }));
      try { return await addModule.call(this, blob, options); }
      finally { URL.revokeObjectURL(blob); }
    };
  });
  return { errors, consoleErrors, get faultSourceRequests() { return faultSourceRequests; } };
}

async function diagnostics(page) {
  return page.evaluate(async module => {
    const d = (await import(module)).getBrowserDelayEngine().getDiagnostics(), s = d.status;
    const monitor = __generationRecoveryQa.monitors.at(-1);
    let pcmPeak = 0, pcmNonFinite = 0;
    // Read actual copied AudioWorklet PCM rather than trusting Rust's meters
    // alone: detached output views could leave good meters and bad audio.
    if (d.connectionCount && monitor) {
      monitor.analyser.getFloatTimeDomainData(monitor.samples);
      for (const sample of monitor.samples) {
        if (!Number.isFinite(sample)) pcmNonFinite++;
        else pcmPeak = Math.max(pcmPeak, Math.abs(sample));
      }
    }
    return { audio: d.audio, microphoneEnabled: d.microphoneEnabled, contextState: d.contextState,
      contextGeneration: d.contextGeneration, connectionCount: d.connectionCount, parameters: d.parameters,
      performance: d.performance, topologyRevision: d.topologyRevision, requestedVoices: d.requestedVoices,
      eligibleVoices: d.eligibleVoices, failure: d.error, pcmPeak, pcmNonFinite,
      status: Object.fromEntries(['elapsedSeconds', 'processedBlocks', 'inputPeak', 'outputPeak', 'cpuLoad', 'voiceLimit',
        'installedCapacity', 'calibratedVoices', 'topologyRevision', 'deadlineMisses', 'wetBusGain', 'failure'].map(key => [key, s[key]])) };
  }, ENGINE);
}

async function ready(page, renderer) {
  await page.goto(`/l-mic-rust.html?renderer=${renderer}`);
  await expect(page.locator('#audioButton')).toBeEnabled();
  await expect(page.locator('#stage')).toHaveAttribute('data-renderer', renderer);
}

async function generation(page, value) {
  await page.locator('#generations').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.parameters.generations === value && (!d.connectionCount || d.status.topologyRevision === d.topologyRevision);
  }, { timeout: 15000 }).toBe(true);
}

async function rangeControl(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(page.locator(`#${id}`)).toHaveValue(String(value));
}

async function live(page, previousClock = -1) {
  await expect.poll(async () => {
    const d = await diagnostics(page), s = d.status;
    return d.audio && d.microphoneEnabled && d.contextState === 'running' && d.connectionCount === 1
      && s.elapsedSeconds > previousClock && s.inputPeak > .005 && s.outputPeak > .00001
      && d.pcmNonFinite === 0 && d.pcmPeak > .00001;
  }, { timeout: 15000 }).toBe(true);
  const d = await diagnostics(page);
  expect(Number.isFinite(d.status.outputPeak)).toBe(true);
  expect(d.status.outputPeak).toBeLessThanOrEqual(1);
  expect(d.pcmNonFinite).toBe(0); expect(d.pcmPeak).toBeLessThanOrEqual(1);
  expect(d.failure).toBeFalsy();
  return d;
}

for (const renderer of ['canvas', 'webgl2']) test(`real WASM microphone survives live and rapid generation edits with ${renderer}`, async ({ page }) => {
  test.setTimeout(120000);
  const evidence = await audioFixture(page);
  await ready(page, renderer);
  // Forced SwiftShader can stall the main thread for seconds at 16K branches.
  // Keep this explicitly forced GPU fixture small; Canvas covers G13 below.
  const largest = renderer === 'webgl2' ? 9 : 13;
  if (renderer === 'webgl2') await generation(page, largest);
  expect((await diagnostics(page)).audio).toBe(false);
  await page.locator('#micButton').click();
  await expect.poll(async () => (await diagnostics(page)).microphoneEnabled).toBe(true);
  expect((await diagnostics(page)).audio).toBe(false);
  await page.locator('#audioButton').click();
  await live(page);
  await expect.poll(async () => (await diagnostics(page)).status.calibratedVoices, { timeout: 10000 }).toBeGreaterThan(0);
  if (renderer === 'canvas') await page.waitForTimeout(4000);
  let previous = await live(page), initial = previous;
  const snapshots = [{ label: 'initial', ...initial }];
  // Exercise the exponential default tree without repeatedly allocating the
  // theoretical 2-million-voice maximum in software-GPU CI.
  for (const count of [1, 6, 9, largest, 1]) {
    await generation(page, count);
    previous = await live(page, previous.status.elapsedSeconds);
    expect(previous.contextGeneration).toBe(initial.contextGeneration);
    snapshots.push({ label: `generation-${count}`, ...previous });
  }
  await page.locator('#generations').evaluate((input, largest) => {
    for (const value of [largest, 1, 6, largest, 4, 9]) {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, largest);
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.parameters.generations === 9 && d.status.topologyRevision === d.topologyRevision;
  }, { timeout: 15000 }).toBe(true);
  const final = await live(page, previous.status.elapsedSeconds);
  expect(final.contextGeneration).toBe(initial.contextGeneration);
  expect(final.topologyRevision).toBeGreaterThan(initial.topologyRevision);
  expect(await page.evaluate(() => __generationRecoveryQa.processorErrors)).toBe(0);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  expect((await diagnostics(page)).microphoneEnabled).toBe(false);
  expect(await page.evaluate(() => __generationRecoveryQa.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await diagnostics(page)).connectionCount).toBe(0);
  await expect.poll(async () => (await diagnostics(page)).contextState).toBe('closed');
  const startup = await page.evaluate(revision => __generationRecoveryQa.startup.filter(s => s.topologyRevision === revision), initial.topologyRevision);
  await test.info().attach('live-generation-edits', { body: JSON.stringify({ renderer, startup, snapshots, final,
    actualWasm: true, syntheticMicrophone: true, listeningPerformed: false }, null, 2), contentType: 'application/json' });
});

for (const fault of ['processor-error', 'wasm-trap']) test(`${fault} recovers real WASM microphone on explicit Audio without reloading`, async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await audioFixture(page, { fault: true });
  await ready(page, 'canvas'); await generation(page, 3);
  await page.locator('#audioButton').click();
  const initial = await live(page);
  expect(evidence.faultSourceRequests).toBe(1);
  await page.evaluate(fault => __generationRecoveryQa.nodes.at(-1).port.postMessage({ type: `qa-force-${fault}` }), fault);
  await expect.poll(() => page.evaluate(() => __generationRecoveryQa.messages.some(message => message.type === 'qa-fault-armed'))).toBe(true);
  if (fault === 'processor-error') await expect.poll(() => page.evaluate(() => __generationRecoveryQa.processorErrors)).toBe(1);
  else await expect.poll(() => page.evaluate(() => __generationRecoveryQa.messages.some(message => message.type === 'failure'))).toBe(true);
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  const failed = await diagnostics(page);
  expect(failed.microphoneEnabled).toBe(false);
  expect(failed.status.outputPeak).toBe(0);
  expect(failed.failure).toBeTruthy();
  expect(await page.evaluate(() => __generationRecoveryQa.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await test.info().attach('injected-failure-state', { body: JSON.stringify({ fault, initial, failed }, null, 2), contentType: 'application/json' });
  const captureRequests = await page.evaluate(() => __generationRecoveryQa.microphoneRequests);
  await page.waitForTimeout(300);
  expect((await diagnostics(page)).audio).toBe(false);
  expect(await page.evaluate(() => __generationRecoveryQa.microphoneRequests)).toBe(captureRequests);
  // Editing a musical control must still work while the failed output is off.
  await generation(page, 4);
  expect((await diagnostics(page)).audio).toBe(false);
  expect(await page.evaluate(() => __generationRecoveryQa.nodes.length)).toBe(1);
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => __generationRecoveryQa.nodes.length), { timeout: 15000 }).toBe(2);
  const recovered = await live(page);
  const clock = recovered.status.elapsedSeconds;
  await live(page, clock + .1); // Reject stale nonzero meters from the dead node.
  expect(recovered.parameters).toEqual({ ...initial.parameters, generations: 4 });
  expect(recovered.performance).toEqual(initial.performance);
  expect(failed.connectionCount).toBe(0);
  expect(recovered.contextGeneration).toBeGreaterThan(initial.contextGeneration);
  expect(recovered.topologyRevision).toBeGreaterThan(initial.topologyRevision);
  expect(recovered.status.topologyRevision).toBe(recovered.topologyRevision);
  expect(await page.evaluate(() => __generationRecoveryQa.processorErrors)).toBe(fault === 'processor-error' ? 1 : 0);
  expect(await page.evaluate(() => __generationRecoveryQa.nodes[0].context.state)).toBe('closed');
  expect(await page.evaluate(() => __generationRecoveryQa.microphoneRequests)).toBe(captureRequests + 1);
  expect(evidence.errors.filter(message => !message.includes(FAULT))).toEqual([]);
  expect(evidence.consoleErrors.filter(message => !message.includes(FAULT))).toEqual([]);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await diagnostics(page)).connectionCount).toBe(0);
  await expect.poll(async () => (await diagnostics(page)).contextState).toBe('closed');
  await test.info().attach('processor-failure-recovery', { body: JSON.stringify({ initial, failed, recovered,
    fault, actualWasm: true, listeningPerformed: false }, null, 2), contentType: 'application/json' });
});

test('expanded input gain and output boost reach real WASM PCM and preserve mute and full recall', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await audioFixture(page);
  await ready(page, 'canvas');
  const capture = () => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
  const factory = await page.evaluate(async () => (await (await fetch('/src/instruments/micmic/native/presets.json')).json())
    .find(preset => preset.id === 'pythagorean').snapshot);
  await generation(page, 3);
  const range = (id, value) => rangeControl(page, id, value);
  const performance = async (inputGain, makeupDb, level = 1) => {
    await expect.poll(async () => {
      const d = await diagnostics(page), p = d.performance;
      return p.inputGain === inputGain && p.mastering.makeupDb === makeupDb && p.level === level;
    }).toBe(true);
  };
  await expect(page.locator('#inputTrim')).toHaveAttribute('max', '4');
  await expect(page.locator('#makeupDb')).toHaveAttribute('max', '24');
  await range('inputTrim', 4); await range('makeupDb', 24);
  await range('level', 1); await range('wet', 1); await range('dry', .5);
  await performance(4, 24);
  const silent = await diagnostics(page), saved = await capture();
  expect(silent.audio).toBe(false); expect(silent.connectionCount).toBe(0);
  expect(await page.evaluate(() => __generationRecoveryQa.microphoneRequests)).toBe(0);
  expect(saved.snapshot.performance).not.toHaveProperty('inputGain');
  expect(saved.snapshot.performance).not.toHaveProperty('level');
  expect(saved.snapshot.performance.mastering).not.toHaveProperty('makeupDb');
  await page.locator('#audioButton').click();
  const initial = await live(page);
  await range('makeupDb', 0); await performance(4, 0);
  await page.waitForTimeout(300);
  const baseline = await live(page, initial.status.elapsedSeconds);
  await range('makeupDb', 24); await performance(4, 24);
  await page.waitForTimeout(300);
  const boosted = await live(page, baseline.status.elapsedSeconds);
  // This comparison reads copied PCM with a fixed scene and synthetic mic,
  // rather than accepting a larger number in a control or a Rust meter.
  expect(boosted.pcmPeak).toBeGreaterThan(baseline.pcmPeak * 3);
  expect(boosted.pcmPeak).toBeLessThanOrEqual(.940001);
  for (const [inputGain, makeupDb] of [[.85, -12], [4, 12], [4, 24]]) {
    await range('inputTrim', inputGain); await range('makeupDb', makeupDb);
    await performance(inputGain, makeupDb);
    const current = await live(page, boosted.status.elapsedSeconds);
    expect(current.contextGeneration).toBe(initial.contextGeneration);
    expect(current.pcmPeak).toBeLessThanOrEqual(.940001);
  }
  await generation(page, 4); await live(page, boosted.status.elapsedSeconds);
  await page.locator('.instrument-preset-controls summary').click();
  await page.locator('button[data-full-preset][data-preset-id="pythagorean"]').click();
  await expect.poll(capture, { timeout: 15000 }).toMatchObject({ snapshot: factory });
  await expect(page.locator('#generations')).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('#stage')).toHaveAttribute('aria-busy', 'false');
  await performance(4, 24);
  await expect(page.locator('#inputTrim')).toHaveValue('4');
  await expect(page.locator('#makeupDb')).toHaveValue('24');
  await expect(page.locator('#level')).toHaveValue('1');
  const recalled = await live(page, boosted.status.elapsedSeconds);
  expect(recalled.contextGeneration).toBe(initial.contextGeneration);
  await generation(page, 3);
  await range('inputTrim', 4); await range('makeupDb', 24); await range('level', 0);
  await performance(4, 24, 0);
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.pcmPeak < .000001 && d.status.outputPeak < .000001 && d.status.elapsedSeconds > recalled.status.elapsedSeconds;
  }).toBe(true);
  const muted = await diagnostics(page);
  expect(muted.audio).toBe(true); expect(muted.microphoneEnabled).toBe(true);
  expect(muted.contextGeneration).toBe(initial.contextGeneration);
  expect(muted.pcmNonFinite).toBe(0);
  expect(await page.evaluate(() => __generationRecoveryQa.processorErrors)).toBe(0);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  expect((await diagnostics(page)).microphoneEnabled).toBe(false);
  expect(await page.evaluate(() => __generationRecoveryQa.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await diagnostics(page)).connectionCount).toBe(0);
  await expect.poll(async () => (await diagnostics(page)).contextState).toBe('closed');
  await test.info().attach('expanded-gain-range', { body: JSON.stringify({ silent, saved, baseline, boosted, recalled, muted,
    actualWasm: true, syntheticMicrophone: true, listeningPerformed: false }, null, 2), contentType: 'application/json' });
});

test('live levels survive sound navigation, dice, mastering and saved or legacy recall without changing identity', async ({ page }) => {
  test.setTimeout(90000);
  // A repeatable modest tree keeps the dice check independent of whichever
  // grammar and exponential generation demand Math.random selects on a host.
  await page.addInitScript(() => { Math.random = () => .5; });
  const evidence = await audioFixture(page, { sceneRecall: true });
  await ready(page, 'canvas');
  await page.locator('#masteringSection > summary').click();
  const capture = () => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
  const levels = d => ({ inputGain: d.performance.inputGain, level: d.performance.level, makeupDb: d.performance.mastering.makeupDb });
  const setLevels = async expected => {
    for (const [id, value] of [['inputTrim', expected.inputGain], ['level', expected.level], ['makeupDb', expected.makeupDb]]) {
      await rangeControl(page, id, value);
    }
    await expect.poll(async () => levels(await diagnostics(page))).toEqual(expected);
  };
  const settled = () => expect(page.locator('#generations')).toBeEnabled({ timeout: 15000 });
  const select = async id => {
    await page.locator('.instrument-preset-controls summary').click();
    await page.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
    await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', id, { timeout: 15000 });
    await settled();
  };
  const assertLevels = async expected => {
    await expect.poll(async () => levels(await diagnostics(page))).toEqual(expected);
    await expect(page.locator('#inputTrim')).toHaveValue(String(expected.inputGain));
    await expect(page.locator('#level')).toHaveValue(String(expected.level));
    await expect(page.locator('#makeupDb')).toHaveValue(String(expected.makeupDb));
  };
  await select('dragon');
  const soundBefore = await capture(), firstLevels = { inputGain: 1.31, level: .41, makeupDb: 7 };
  await setLevels(firstLevels);
  const afterLevels = await capture();
  expect(afterLevels.selectedId).toBe('dragon');
  expect(afterLevels.snapshot).toEqual(soundBefore.snapshot);
  expect((await diagnostics(page)).audio).toBe(false);
  expect(await page.evaluate(() => __generationRecoveryQa.microphoneRequests)).toBe(0);
  await page.locator('#audioButton').click();
  const initial = await live(page);
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', 'koch', { timeout: 15000 });
  await settled(); await assertLevels(firstLevels);
  await page.locator('.instrument-preset-controls summary').focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', 'dragon', { timeout: 15000 });
  await settled(); await assertLevels(firstLevels);
  const navigated = await live(page, initial.status.elapsedSeconds);
  expect(navigated.contextGeneration).toBe(initial.contextGeneration);
  await page.locator('#masteringPreset').selectOption('gentle');
  await expect.poll(async () => (await diagnostics(page)).performance.mastering.ratio).toBe(2);
  await assertLevels(firstLevels);
  await rangeControl(page, 'makeupDb', 11);
  const boostedLevels = { ...firstLevels, makeupDb: 11 };
  await assertLevels(boostedLevels);
  await expect(page.locator('#masteringPreset')).toHaveValue('gentle');
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', 'custom', { timeout: 15000 });
  await settled(); await assertLevels(boostedLevels);
  const saved = (await capture()).snapshot;
  expect(saved.performance).not.toHaveProperty('inputGain');
  expect(saved.performance).not.toHaveProperty('level');
  expect(saved.performance.mastering).not.toHaveProperty('makeupDb');
  expect(saved).not.toEqual(soundBefore.snapshot);
  const restoredLevels = { inputGain: 1.41, level: .37, makeupDb: 9 };
  await setLevels(restoredLevels);
  await rangeControl(page, 'generationAngle', 137); await rangeControl(page, 'wet', .25);
  await page.locator('#masteringPreset').selectOption('transparent');
  await expect.poll(async () => (await diagnostics(page)).performance.mastering.compressorEnabled).toBe(false);
  await page.evaluate(snapshot => __generationRecoveryQa.applyScene(snapshot), saved);
  await expect.poll(async () => (await capture()).snapshot).toEqual(saved);
  await assertLevels(restoredLevels);
  const legacy = structuredClone(saved);
  legacy.parameters.angle = 77;
  legacy.performance.inputGain = 0; legacy.performance.level = 0;
  legacy.performance.mastering.makeupDb = -12; legacy.performance.mastering.thresholdDb = -31;
  const legacySound = structuredClone(legacy);
  delete legacySound.performance.inputGain; delete legacySound.performance.level;
  delete legacySound.performance.mastering.makeupDb;
  await page.evaluate(snapshot => __generationRecoveryQa.applyScene(snapshot), legacy);
  await expect.poll(async () => (await capture()).snapshot).toEqual(legacySound);
  await assertLevels(restoredLevels);
  const restored = await live(page, navigated.status.elapsedSeconds);
  expect(restored.contextGeneration).toBe(initial.contextGeneration);
  // Zero is an intentional live level, not a missing preset field. Neither
  // full recall, focused mastering nor dice may make this muted engine loud.
  const zeroLevels = { inputGain: 0, level: 0, makeupDb: 0 };
  await setLevels(zeroLevels); await select('dragon'); await assertLevels(zeroLevels);
  await page.locator('#masteringPreset').selectOption('dense');
  await expect.poll(async () => (await diagnostics(page)).performance.mastering.ratio).toBe(4);
  await assertLevels(zeroLevels);
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', 'custom', { timeout: 15000 });
  await settled(); await assertLevels(zeroLevels);
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.microphoneEnabled && d.status.elapsedSeconds > restored.status.elapsedSeconds
      && d.pcmNonFinite === 0 && d.pcmPeak < .000001 && d.status.outputPeak < .000001;
  }).toBe(true);
  const muted = await diagnostics(page);
  await setLevels(restoredLevels);
  const resumed = await live(page, muted.status.elapsedSeconds);
  expect(resumed.contextGeneration).toBe(initial.contextGeneration);
  expect(await page.evaluate(() => __generationRecoveryQa.microphoneRequests)).toBe(1);
  expect(await page.evaluate(() => __generationRecoveryQa.processorErrors)).toBe(0);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  expect((await diagnostics(page)).microphoneEnabled).toBe(false);
  expect(await page.evaluate(() => __generationRecoveryQa.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => (await diagnostics(page)).connectionCount).toBe(0);
  await expect.poll(async () => (await diagnostics(page)).contextState).toBe('closed');
  await test.info().attach('live-level-preset-boundary', { body: JSON.stringify({ soundBefore, afterLevels, firstLevels,
    boostedLevels, saved, legacy, restoredLevels, restored, muted, resumed,
    actualWasm: true, syntheticMicrophone: true, listeningPerformed: false }, null, 2), contentType: 'application/json' });
});

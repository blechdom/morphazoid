import { test, expect } from '@playwright/test';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const WORKLET = '**/src/instruments/micmic/native/delay-worklet.js';
const FAULT = 'QA forced L-system processor failure';

async function audioFixture(page, { fault = false } = {}) {
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

import { test, expect } from '@playwright/test';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const APP = '**/src/instruments/micmic/native/app.js';
const KEYS = '**/assets/synthesis/loops/electric-piano.wav';
const TRANSPARENT = { inputHighpassHz: 0, highpassHz: 0, lowpassHz: 0,
  compressorEnabled: false, autoMakeup: false, makeupDb: 0 };

// Real browser decoding and AudioBufferSourceNode playback feed the unchanged
// Rust worklet. Known PCM makes source identity measurable without listening.
function wav(frequency, duration = 3, amplitude = .08) {
  const rate = 48000, frames = Math.round(rate * duration);
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(Math.sin(frame / rate * Math.PI * 2 * frequency) * amplitude * 32767), 44 + frame * 2);
  }
  return bytes;
}

async function fixture(page, { fault = false } = {}) {
  const errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    Math.random = () => .5;
    const qa = window.__recordedInputQa = { monitors: [], nodes: [], bufferSources: [], microphoneRequests: 0,
      streams: [], holdDecode: false, pendingDecodes: [], decoded: 0, hidden: false,
      holdMicrophone: false, pendingMicrophones: [] };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => qa.hidden });
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-l-system-delay') {
        qa.nodes.push(node);
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 4096; mute.gain.value = 0;
        node.connect(analyser).connect(mute).connect(node.context.destination);
        qa.monitors.push({ analyser, samples: new Float32Array(analyser.fftSize) });
      }
      return node;
    } });
    const createSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const node = createSource.apply(this, args), record = { node, started: 0, stopped: 0, ended: false };
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...values) => { record.started++; return start(...values); };
      node.stop = (...values) => { record.stopped++; return stop(...values); };
      node.addEventListener('ended', () => { record.ended = true; });
      qa.bufferSources.push(record); return node;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (...args) {
      const buffer = await decode.apply(this, args); qa.decoded++;
      if (qa.holdDecode) await new Promise(resolve => qa.pendingDecodes.push(resolve));
      return buffer;
    };
    navigator.mediaDevices.getUserMedia = async () => {
      qa.microphoneRequests++;
      const context = new AudioContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 173; gain.gain.value = .03;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      qa.streams.push(destination.stream);
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          if (track.readyState === 'ended') { stop(); return; }
          stop(); oscillator.stop(); void context.close();
        };
      }
      if (qa.holdMicrophone) await new Promise((resolve, reject) => qa.pendingMicrophones.push({ resolve,
        reject: () => {
          for (const track of destination.stream.getTracks()) track.stop();
          reject(new DOMException('QA obsolete microphone permission denied', 'NotAllowedError'));
        } }));
      return destination.stream;
    };
  });
  await page.route(APP, async route => {
    const response = await route.fetch(), source = await response.text();
    // The existing complete saved-scene adapter keeps model, UI and worklet
    // aligned. No production debug API or replacement DSP is introduced.
    await route.fulfill({ response, body: source + '\n__recordedInputQa.applyScene = applyScene;\n' });
  });
  if (fault) {
    await page.route('**/src/instruments/micmic/native/delay-worklet.js', async route => {
      const response = await route.fetch(), source = await response.text();
      const marker = "registerProcessor('morphazoid-l-system-delay', LSystemDelayProcessor);";
      expect(source).toContain(marker);
      const hook = `
const qaRecordedMessage = LSystemDelayProcessor.prototype.message;
LSystemDelayProcessor.prototype.message = function(data) {
  if (data.type === 'qa-recorded-input-trap') {
    this.api = { ...this.api, lsd_process() { throw new WebAssembly.RuntimeError('QA recorded-input processor trap'); } };
    return;
  }
  return qaRecordedMessage.call(this, data);
};
`;
      await route.fulfill({ response, body: source.replace(marker, hook + marker) });
    });
    await page.addInitScript(() => {
      // Route this one real worklet module through page fetch because Chromium
      // worklet loading otherwise bypasses scoped Playwright page routes.
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
  }
  return { errors, consoleErrors };
}

async function diagnostics(page) {
  return page.evaluate(async module => {
    const d = (await import(module)).getBrowserDelayEngine().getDiagnostics(), qa = __recordedInputQa;
    const monitor = qa.monitors.at(-1);
    let peak = 0, square = 0, nonFinite = 0, frequency = 0;
    if (d.connectionCount && monitor) {
      monitor.analyser.getFloatTimeDomainData(monitor.samples);
      const crossings = [];
      for (let i = 0; i < monitor.samples.length; i++) {
        const sample = monitor.samples[i];
        if (!Number.isFinite(sample)) { nonFinite++; continue; }
        peak = Math.max(peak, Math.abs(sample)); square += sample * sample;
        if (i && monitor.samples[i - 1] <= 0 && sample > 0) {
          crossings.push(i - 1 - monitor.samples[i - 1] / (sample - monitor.samples[i - 1]));
        }
      }
      if (crossings.length > 3) frequency = monitor.analyser.context.sampleRate
        * (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
    }
    return { audio: d.audio, microphoneEnabled: d.microphoneEnabled, contextState: d.contextState,
      contextGeneration: d.contextGeneration, connectionCount: d.connectionCount, input: d.input,
      performance: d.performance, parameters: d.parameters, error: d.error,
      status: { elapsedSeconds: d.status.elapsedSeconds, inputPeak: d.status.inputPeak, outputPeak: d.status.outputPeak },
      pcm: { peak, rms: Math.sqrt(square / (monitor?.samples.length || 1)), nonFinite, frequency },
      microphoneRequests: qa.microphoneRequests,
      sources: qa.bufferSources.map(s => ({ started: s.started, stopped: s.stopped, ended: s.ended, loop: s.node.loop })),
      liveTracks: qa.streams.flatMap(stream => stream.getTracks()).filter(track => track.readyState !== 'ended').length };
  }, ENGINE);
}

async function ready(page) {
  await page.goto('/l-mic-rust.html?renderer=canvas');
  await expect(page.locator('#audioButton')).toBeEnabled();
  await expect(page.locator('[data-select-id="source"] > summary')).toBeVisible();
  await expect(page.locator('.instrument-preset-controls')).toBeVisible();
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
}

async function chooseSelect(page, id, value) {
  const index = await page.locator(`#${id}`).evaluate((select, value) =>
    [...select.options].findIndex(option => option.value === value), value);
  expect(index).toBeGreaterThanOrEqual(0);
  const picker = page.locator(`[data-select-id="${id}"]`);
  if (await picker.getAttribute('open') === null) await picker.locator('summary').click();
  await picker.locator(`button[data-option-index="${index}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveValue(value);
  await expect.poll(async () => (await diagnostics(page)).input[id === 'source' ? 'mode' : 'sampleId']).toBe(value);
}

async function dryScene(page) {
  await page.evaluate(async mastering => {
    const d = (await import('/src/instruments/micmic/native/browser-engine.js')).getBrowserDelayEngine().getDiagnostics();
    await __recordedInputQa.applyScene({ parameters: { ...d.parameters, generations: 1 },
      performance: { ...d.performance, wet: 0, dry: .5,
        mastering: { ...d.performance.mastering, ...mastering } } });
  }, TRANSPARENT);
}

async function upload(page, frequency, name = `tone-${frequency}.wav`, duration = 3) {
  await page.locator('#inputFile').setInputFiles({ name, mimeType: 'audio/wav', buffer: wav(frequency, duration) });
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.input.hasFile && d.input.fileName.includes(name) && !d.input.pending;
  }, { timeout: 15000 }).toBe(true);
}

async function live(page, { frequency, previousClock = -1 } = {}) {
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.contextState === 'running' && d.connectionCount === 1
      && d.status.elapsedSeconds > previousClock && d.status.inputPeak > .00001
      && d.pcm.nonFinite === 0 && d.pcm.peak > .00001
      && (frequency === undefined || Math.abs(d.pcm.frequency - frequency) < 5);
  }, { timeout: 15000 }).toBe(true);
  const d = await diagnostics(page);
  expect(d.pcm.nonFinite).toBe(0); expect(d.pcm.peak).toBeLessThanOrEqual(1);
  expect(d.error).toBeFalsy(); return d;
}

async function audioOff(page) {
  if ((await diagnostics(page)).audio) await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return !d.audio && !d.input.playing && !d.input.pending && d.liveTracks === 0;
  }, { timeout: 15000 }).toBe(true);
}

async function selectPreset(page, id) {
  await page.locator('.instrument-preset-controls summary').click();
  await page.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', id, { timeout: 15000 });
  await expect(page.locator('#generations')).toBeEnabled({ timeout: 15000 });
}

test('sample/file selection and preset recall preserve external input and gains while Audio is off', async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page); await ready(page);
  await chooseSelect(page, 'source', 'samples');
  await chooseSelect(page, 'inputSample', 'music-keys');
  await expect.poll(async () => (await diagnostics(page)).input).toMatchObject({ mode: 'samples', sampleId: 'music-keys', playing: false });
  expect((await diagnostics(page)).audio).toBe(false);
  await chooseSelect(page, 'source', 'file');
  await upload(page, 173, 'retained-upload.wav');
  for (const [id, value] of [['inputTrim', 1.73], ['level', .31], ['makeupDb', 11]]) {
    await page.locator(`#${id}`).evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  await expect.poll(async () => {
    const p = (await diagnostics(page)).performance;
    return [p.inputGain, p.level, p.mastering.makeupDb];
  }).toEqual([1.73, .31, 11]);
  const before = await diagnostics(page);
  expect(before.input.mode).toBe('file'); expect(before.microphoneRequests).toBe(0);
  const gains = d => [d.performance.inputGain, d.performance.level, d.performance.mastering.makeupDb];
  for (const id of ['dragon', 'pythagorean']) {
    await selectPreset(page, id);
    const d = await diagnostics(page);
    expect(d.input).toMatchObject({ mode: 'file', hasFile: true, playing: false, pending: false, loop: true });
    expect(d.input.fileName).toContain('retained-upload.wav'); expect(gains(d)).toEqual(gains(before));
    expect(d.audio).toBe(false); expect(d.microphoneRequests).toBe(0);
  }
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', 'custom', { timeout: 15000 });
  await expect(page.locator('#generations')).toBeEnabled({ timeout: 15000 });
  const randomized = await diagnostics(page);
  expect(randomized.input.mode).toBe('file'); expect(randomized.input.fileName).toContain('retained-upload.wav');
  expect(gains(randomized)).toEqual(gains(before)); expect(randomized.audio).toBe(false);
  expect(randomized.microphoneRequests).toBe(0); expect(randomized.sources.every(s => s.started === 0)).toBe(true);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
});

test('uploaded WAVs reach real Rust PCM with distinct pitches and Original voice controls its level', async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page); await ready(page); await dryScene(page);
  await chooseSelect(page, 'source', 'file'); await upload(page, 173);
  expect((await diagnostics(page)).audio).toBe(false);
  await page.locator('#audioButton').click();
  const first = await live(page, { frequency: 173 });
  expect(first.input).toMatchObject({ mode: 'file', playing: true, pending: false, loop: true });
  expect(first.microphoneRequests).toBe(0);
  await upload(page, 347);
  const second = await live(page, { frequency: 347, previousClock: first.status.elapsedSeconds });
  expect(second.contextGeneration).toBe(first.contextGeneration);
  expect(second.sources.filter(s => s.started && !s.ended && !s.stopped)).toHaveLength(1);
  expect(second.sources.some(s => s.started && s.stopped)).toBe(true);
  await page.locator('#mixSection').evaluate(details => { details.open = true; });
  await page.locator('#dry').evaluate(input => { input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.input.playing && d.performance.dry === 0 && d.status.inputPeak > .00001
      && d.pcm.nonFinite === 0 && d.pcm.peak < .000001;
  }).toBe(true);
  await page.locator('#dry').evaluate(input => { input.value = '.5'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await live(page, { frequency: 347 }); await audioOff(page);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await test.info().attach('uploaded-real-wasm-pcm', { body: JSON.stringify({ first, second,
    syntheticRecordedPcm: true, actualWasm: true, listeningPerformed: false }, null, 2), contentType: 'application/json' });
});

test('built-in recorded samples play through Rust with credit, stop/restart and natural non-looping end', async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page); await ready(page); await dryScene(page);
  await chooseSelect(page, 'source', 'samples'); await chooseSelect(page, 'inputSample', 'music-bass');
  await page.locator('#audioButton').click();
  const playing = await live(page);
  expect(playing.input).toMatchObject({ mode: 'samples', sampleId: 'music-bass', playing: true });
  expect(playing.microphoneRequests).toBe(0);
  await expect(page.locator('#inputSourceCredit')).toBeVisible();
  expect(playing.input.credit).toBeTruthy();
  await page.locator('#stopInput').click();
  await expect.poll(async () => (await diagnostics(page)).input.playing).toBe(false);
  await page.locator('#restartInput').click();
  const restarted = await live(page, { previousClock: playing.status.elapsedSeconds });
  expect(restarted.contextGeneration).toBe(playing.contextGeneration);
  // A short uploaded one-shot exercises the actual ended callback promptly;
  // no synthetic timer or manually dispatched ended event stands in for it.
  await chooseSelect(page, 'source', 'file'); await page.locator('#inputLoop').uncheck();
  await upload(page, 281, 'one-shot.wav', .35);
  await expect.poll(async () => (await diagnostics(page)).input).toMatchObject({ mode: 'file', ended: true, playing: false, loop: false });
  expect((await diagnostics(page)).audio).toBe(true);
  await page.locator('#inputLoop').check(); await page.locator('#restartInput').click();
  await live(page, { frequency: 281 }); await audioOff(page);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
});

test('every offered recorded sample fetches, decodes and produces finite real Rust PCM with its local credit', async ({ page }) => {
  test.setTimeout(120000);
  const evidence = await fixture(page), responses = [], recordings = [];
  page.on('response', response => {
    if (/\/assets\/.*\.(wav|ogg)(?:\?|$)/.test(response.url())) responses.push({ url: response.url(), status: response.status() });
  });
  await ready(page); await dryScene(page); await chooseSelect(page, 'source', 'samples');
  const ids = await page.locator('#inputSample').evaluate(select => [...select.options].map(option => option.value));
  expect(ids).toEqual(expect.arrayContaining(['sample-drums', 'music-bass', 'music-keys', 'music-plucks',
    'music-arp', 'voice-bdl', 'voice-slt', 'speech', 'birdsong']));
  await page.locator('#audioButton').click();
  let previousClock = -1, generation;
  for (const id of ids) {
    await chooseSelect(page, 'inputSample', id);
    const d = await live(page, { previousClock }); previousClock = d.status.elapsedSeconds;
    generation ??= d.contextGeneration;
    expect(d.contextGeneration).toBe(generation); expect(d.input).toMatchObject({ mode: 'samples', sampleId: id, playing: true });
    expect(d.microphoneRequests).toBe(0); expect(d.input.credit).toBeTruthy();
    await expect(page.locator('#inputSourceCredit a')).toHaveAttribute('href', d.input.creditUrl);
    expect((await page.request.get(d.input.creditUrl)).status()).toBe(200);
    expect(d.sources.filter(source => source.started && !source.stopped && !source.ended)).toHaveLength(1);
    recordings.push({ id, credit: d.input.credit, creditUrl: d.input.creditUrl, pcm: d.pcm });
  }
  expect(responses.length).toBeGreaterThanOrEqual(ids.length);
  expect(responses.every(response => response.status === 200)).toBe(true);
  await audioOff(page);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await test.info().attach('all-recorded-inputs', { body: JSON.stringify({ recordings, responses,
    actualBundledRecordings: true, actualWasm: true, listeningPerformed: false }, null, 2), contentType: 'application/json' });
});

test('live mic/file/sample swaps release old tracks and nodes, then Audio-off and visibility allow explicit rearm', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page); await ready(page); await dryScene(page);
  await page.locator('#audioButton').click();
  const mic = await live(page, { frequency: 173 });
  expect(mic.microphoneEnabled).toBe(true); expect(mic.microphoneRequests).toBe(1);
  await chooseSelect(page, 'source', 'file');
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.input.mode === 'file' && !d.input.hasFile && !d.input.pending && !d.input.playing
      && d.liveTracks === 0 && d.microphoneRequests === 1;
  }).toBe(true);
  await expect(page.locator('#inputSourceStatus')).toHaveText('Choose a local audio file');
  await expect(page.locator('#audioError')).toBeHidden();
  await upload(page, 347);
  const file = await live(page, { frequency: 347, previousClock: mic.status.elapsedSeconds });
  expect(file.liveTracks).toBe(0); expect(file.microphoneEnabled).toBe(false);
  await chooseSelect(page, 'source', 'samples'); await chooseSelect(page, 'inputSample', 'music-keys');
  const sample = await live(page, { previousClock: file.status.elapsedSeconds });
  expect(sample.contextGeneration).toBe(mic.contextGeneration); expect(sample.microphoneRequests).toBe(1);
  expect(sample.sources.filter(s => s.started && !s.ended && !s.stopped)).toHaveLength(1);
  await chooseSelect(page, 'source', 'mic');
  const returnMic = await live(page, { frequency: 173, previousClock: sample.status.elapsedSeconds });
  expect(returnMic.microphoneRequests).toBe(2);
  expect(returnMic.sources.every(s => !s.started || s.stopped || s.ended)).toBe(true);
  await audioOff(page); await chooseSelect(page, 'source', 'file');
  expect((await diagnostics(page)).input.hasFile).toBe(true);
  await page.locator('#audioButton').click(); await live(page, { frequency: 347 });
  await page.evaluate(() => { __recordedInputQa.hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(async () => {
    const d = await diagnostics(page); return !d.audio && !d.input.playing && !d.input.pending && d.liveTracks === 0;
  }).toBe(true);
  await page.evaluate(() => { __recordedInputQa.hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  expect((await diagnostics(page)).audio).toBe(false);
  await page.locator('#audioButton').click(); await live(page, { frequency: 347 }); await audioOff(page);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
});

test('switching to a file promptly cancels pending mic permission and ignores its late grant or denial', async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page); await ready(page); await dryScene(page);
  await page.evaluate(() => { __recordedInputQa.holdMicrophone = true; });
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => __recordedInputQa.pendingMicrophones.length)).toBe(1);
  await chooseSelect(page, 'source', 'file'); await upload(page, 347, 'permission-independent.wav');
  // This must become playable before the old permission promise resolves.
  const beforeGrant = await live(page, { frequency: 347 });
  expect(beforeGrant.microphoneEnabled).toBe(false); expect(beforeGrant.microphoneRequests).toBe(1);
  await page.evaluate(() => __recordedInputQa.pendingMicrophones.shift().resolve());
  await expect.poll(async () => (await diagnostics(page)).liveTracks).toBe(0);
  await live(page, { frequency: 347, previousClock: beforeGrant.status.elapsedSeconds });
  await chooseSelect(page, 'source', 'mic');
  await expect.poll(() => page.evaluate(() => __recordedInputQa.pendingMicrophones.length)).toBe(1);
  await chooseSelect(page, 'source', 'file');
  const beforeDenial = await live(page, { frequency: 347 });
  expect(beforeDenial.microphoneRequests).toBe(2); expect(beforeDenial.microphoneEnabled).toBe(false);
  await page.evaluate(() => __recordedInputQa.pendingMicrophones.shift().reject());
  await expect.poll(async () => (await diagnostics(page)).liveTracks).toBe(0);
  const afterDenial = await live(page, { frequency: 347, previousClock: beforeDenial.status.elapsedSeconds });
  expect(afterDenial.input).toMatchObject({ mode: 'file', playing: true, pending: false });
  await expect(page.locator('#audioError')).toBeHidden(); await audioOff(page);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
});

for (const cancel of ['stop', 'hide']) test(`a pending recorded sample fetch cannot revive input after ${cancel}`, async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page);
  let release, requests = 0, completed = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(KEYS, async route => {
    requests++; await gate;
    try { await route.fulfill({ status: 200, contentType: 'audio/wav', body: wav(523) }); }
    catch (error) { if (!/closed|cancel|abort|disposed/i.test(error.message)) throw error; }
    completed++;
  });
  try {
    await ready(page); await dryScene(page);
    await chooseSelect(page, 'source', 'samples'); await chooseSelect(page, 'inputSample', 'music-keys');
    await page.locator('#audioButton').click();
    await expect.poll(() => requests).toBeGreaterThan(0);
    await expect.poll(async () => (await diagnostics(page)).input.pending).toBe(true);
    if (cancel === 'stop') await page.locator('#stopInput').click();
    else await page.evaluate(() => { __recordedInputQa.hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    release(); await expect.poll(() => completed).toBeGreaterThan(0);
    await expect.poll(async () => {
      const d = await diagnostics(page); return !d.input.pending && !d.input.playing;
    }).toBe(true);
    const canceled = await diagnostics(page);
    expect(canceled.sources.every(s => s.started === 0)).toBe(true); expect(canceled.microphoneRequests).toBe(0);
    if (cancel === 'hide') expect(canceled.audio).toBe(false);
    await page.evaluate(() => { __recordedInputQa.hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await audioOff(page); await page.locator('#audioButton').click(); await live(page, { frequency: 523 }); await audioOff(page);
    expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  } finally { release(); }
});

test('a completed real decode cannot start a replacement file after Audio is switched off', async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page); await ready(page); await dryScene(page);
  await chooseSelect(page, 'source', 'file'); await upload(page, 173);
  await page.locator('#audioButton').click(); await live(page, { frequency: 173 });
  await page.evaluate(() => { __recordedInputQa.holdDecode = true; });
  await page.locator('#inputFile').setInputFiles({ name: 'delayed-decode.wav', mimeType: 'audio/wav', buffer: wav(347) });
  await expect.poll(() => page.evaluate(() => __recordedInputQa.pendingDecodes.length)).toBeGreaterThan(0);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  const starts = (await diagnostics(page)).sources.reduce((n, s) => n + s.started, 0);
  await page.evaluate(() => { __recordedInputQa.holdDecode = false; for (const resolve of __recordedInputQa.pendingDecodes.splice(0)) resolve(); });
  await expect.poll(async () => (await diagnostics(page)).input.pending).toBe(false);
  const stopped = await diagnostics(page);
  expect(stopped.audio).toBe(false); expect(stopped.input.playing).toBe(false);
  expect(stopped.sources.reduce((n, s) => n + s.started, 0)).toBe(starts); expect(stopped.microphoneRequests).toBe(0);
  await page.locator('#audioButton').click(); await live(page, { frequency: 347 }); await audioOff(page);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
});

test('an uploaded recording survives a fatal worklet trap and resumes only on explicit Audio', async ({ page }) => {
  test.setTimeout(60000);
  const evidence = await fixture(page, { fault: true }); await ready(page); await dryScene(page);
  await chooseSelect(page, 'source', 'file'); await upload(page, 347, 'recoverable.wav');
  await page.locator('#audioButton').click();
  const before = await live(page, { frequency: 347 });
  await page.evaluate(() => __recordedInputQa.nodes.at(-1).port.postMessage({ type: 'qa-recorded-input-trap' }));
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return !d.audio && !d.input.playing && !d.input.pending && d.connectionCount === 0 && Boolean(d.error);
  }).toBe(true);
  const failed = await diagnostics(page);
  expect(failed.input).toMatchObject({ mode: 'file', hasFile: true }); expect(failed.input.fileName).toContain('recoverable.wav');
  expect(failed.microphoneRequests).toBe(0); expect(failed.sources.every(source => !source.started || source.stopped || source.ended)).toBe(true);
  await expect(page.locator('#audioError')).toBeVisible(); await page.locator('#audioError').click();
  await page.locator('#audioButton').click();
  const recovered = await live(page, { frequency: 347 });
  expect(recovered.contextGeneration).toBe(before.contextGeneration + 1);
  expect(recovered.input.fileName).toContain('recoverable.wav'); expect(recovered.microphoneRequests).toBe(0);
  await audioOff(page);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`recorded input controls ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440, isMobile: viewport.width !== 1440 });
    test('source controls remain reachable and coarse Audio/transport targets are 48px', async ({ page }) => {
      const evidence = await fixture(page); await ready(page);
      await expect(page.locator('#inputSection')).toHaveAttribute('open', '');
      for (const mode of ['samples', 'file', 'mic']) {
        await chooseSelect(page, 'source', mode);
        const control = page.locator(mode === 'samples' ? '[data-select-id="inputSample"] > summary' : mode === 'file' ? '#inputFile' : '[data-select-id="source"] > summary');
        await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        await expect.poll(async () => (await diagnostics(page)).input.mode).toBe(mode);
      }
      await chooseSelect(page, 'source', 'samples');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      for (const id of ['audioButton', 'restartInput', 'stopInput']) {
        const control = page.locator(`#${id}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        const box = await control.boundingBox(); expect(box).not.toBeNull();
        if (viewport.width !== 1440) { expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48); }
      }
      expect((await diagnostics(page)).audio).toBe(false);
      expect((await diagnostics(page)).microphoneRequests).toBe(0);
      expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
      await test.info().attach('recorded-input-layout', { body: await page.screenshot(), contentType: 'image/png' });
    });
  });
}

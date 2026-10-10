import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';

test.setTimeout(60_000);

// Known uploaded PCM exercises browser decoding and the actual Rust worklet.
function wav(frequency, duration = 3) {
  const rate = 48000, frames = Math.round(rate * duration), bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) bytes.writeInt16LE(
    Math.round(Math.sin(frame / rate * Math.PI * 2 * frequency) * .08 * 32767), 44 + frame * 2,
  );
  return bytes;
}

async function fixture(page, { delayedMic = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installAudioInputFixture(page, delayedMic);
  await page.addInitScript(() => {
    Math.random = () => .5;
    const qa = globalThis.__graphInputsQa = { monitors: [], sources: [], worklets: [], holdNextDecode: false, pendingDecodes: [] };
    const NativeWorklet = AudioWorkletNode;
    globalThis.AudioWorkletNode = new Proxy(NativeWorklet, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-graph-delay-rust') {
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 4096; mute.gain.value = 0;
        node.connect(analyser).connect(mute).connect(node.context.destination);
        qa.worklets.push(node); qa.monitors.push({ analyser, samples: new Float32Array(analyser.fftSize) });
      }
      return node;
    } });
    const create = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const node = create.apply(this, args), record = { node, started: 0, stopped: 0, ended: false, duration: 0 };
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...values) => { const result = start(...values); record.started++; record.duration = node.buffer?.duration ?? 0; return result; };
      node.stop = (...values) => { record.stopped++; return stop(...values); };
      node.addEventListener('ended', () => { record.ended = true; });
      qa.sources.push(record); return node;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (...args) {
      const result = await decode.apply(this, args);
      if (qa.holdNextDecode) {
        qa.holdNextDecode = false;
        await new Promise(resolve => qa.pendingDecodes.push(resolve));
      }
      return result;
    };
  });
  await page.goto('/graph-delay-rust.html?renderer=canvas');
  await page.waitForFunction(() => Boolean(globalThis.__graphDelayRust));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  return errors;
}

async function diagnostics(page) {
  return page.evaluate(() => {
    const state = __graphDelayRust.snapshot(), qa = __graphInputsQa, monitor = qa.monitors.at(-1);
    let peak = 0, square = 0, nonFinite = 0, frequency = 0;
    if (monitor?.analyser.context.state === 'running') {
      monitor.analyser.getFloatTimeDomainData(monitor.samples);
      const crossings = [];
      for (let i = 0; i < monitor.samples.length; i++) {
        const sample = monitor.samples[i];
        if (!Number.isFinite(sample)) { nonFinite++; continue; }
        peak = Math.max(peak, Math.abs(sample)); square += sample * sample;
        if (i && monitor.samples[i - 1] <= 0 && sample > 0) crossings.push(
          i - 1 - monitor.samples[i - 1] / (sample - monitor.samples[i - 1]),
        );
      }
      if (crossings.length > 3) frequency = monitor.analyser.context.sampleRate
        * (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
    }
    return { ...state, worklets: qa.worklets.length,
      pcm: { peak, rms: Math.sqrt(square / (monitor?.samples.length || 1)), nonFinite, frequency },
      microphoneRequests: __familyInput.requests,
      liveTracks: __familyInput.tracks.filter(track => track.readyState !== 'ended').length,
      // Ignore the one-frame silent buffer used to unlock a browser context.
      sources: qa.sources.filter(source => source.duration > .01).map(source => ({
        started: source.started, stopped: source.stopped, ended: source.ended,
        loop: source.node.loop, released: source.node.buffer === null,
      })),
    };
  });
}

async function choose(page, id, value) {
  await page.locator(`#${id}`).evaluate((select, next) => {
    select.value = next; select.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect.poll(async () => (await diagnostics(page)).inputSource[id === 'source' ? 'mode' : 'sampleId']).toBe(value);
}

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function dry(page) {
  for (const [id, value] of [['wet', 0], ['dry', .5], ['level', .3], ['inputTrim', .8]]) await setRange(page, id, value);
}

async function upload(page, frequency, { duration = 3, name = `tone-${frequency}.wav` } = {}) {
  await page.locator('#inputFile').setInputFiles({ name, mimeType: 'audio/wav', buffer: wav(frequency, duration) });
  await expect.poll(async () => {
    const input = (await diagnostics(page)).inputSource;
    return input.hasFile && input.fileName.includes(name) && !input.pending;
  }, { timeout: 15000 }).toBe(true);
}

async function live(page, frequency) {
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.audio && d.inputSource.playing && !d.inputSource.pending && d.metrics?.inputPeak > 1e-5
      && d.pcm.nonFinite === 0 && d.pcm.peak > 1e-5
      && (frequency === undefined || Math.abs(d.pcm.frequency - frequency) < 5);
  }, { timeout: 15000 }).toBe(true);
  const d = await diagnostics(page);
  expect(d.pcm.peak).toBeLessThanOrEqual(1); expect(d.pcm.nonFinite).toBe(0);
  expect(d.sources.filter(source => source.started && !source.stopped && !source.ended)).toHaveLength(1);
  return d;
}

async function revealPlayback(page) {
  await page.locator('#restartInput').evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  });
}

test('Graph Rust exposes the L-system sample bank and retains selected input through silent presets', async ({ page }) => {
  const errors = await fixture(page);
  const expected = await page.evaluate(async () => (await import('/src/instruments/micmic/native/input-source.js')).SAMPLE_INPUT_OPTIONS.map(option => option.id));
  expect(await page.locator('#inputSample').evaluate(select => [...select.options].map(option => option.value))).toEqual(expected);
  await choose(page, 'source', 'samples'); await choose(page, 'inputSample', 'music-bass');
  await revealPlayback(page); await page.locator('#nextInputSample').click();
  expect((await diagnostics(page)).inputSource.sampleId).toBe(expected[(expected.indexOf('music-bass') + 1) % expected.length]);
  await choose(page, 'source', 'file'); await upload(page, 173, { name: 'retained.wav' });
  await page.locator('#inputLoop').uncheck();
  await setRange(page, 'inputTrim', .42); await setRange(page, 'level', .31);
  const before = (await diagnostics(page)).inputSource;
  await page.locator('.header-preset-picker summary').click();
  await page.locator('button[data-preset-id="clearSteps"]').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
  const after = await diagnostics(page);
  expect(after.inputSource).toMatchObject({ mode: 'file', fileName: before.fileName, hasFile: true, loop: false, playing: false });
  expect(after.audio).toBe(false); expect(after.microphoneRequests).toBe(0); expect(after.sources).toHaveLength(0);
  await expect(page.locator('#inputTrim')).toHaveValue('0.42'); await expect(page.locator('#level')).toHaveValue('0.31');
  expect(errors).toEqual([]);
});

test('uploaded WAVs produce distinct real Rust PCM without acquiring a microphone', async ({ page }, info) => {
  const errors = await fixture(page); await dry(page); await choose(page, 'source', 'file');
  await upload(page, 173);
  expect((await diagnostics(page)).audio).toBe(false);
  await page.locator('#audioButton').click();
  const first = await live(page, 173);
  await upload(page, 347);
  const second = await live(page, 347);
  expect(second.worklets).toBe(first.worklets); expect(second.microphoneRequests).toBe(0);
  expect(second.metrics.elapsedSeconds).toBeGreaterThan(first.metrics.elapsedSeconds);
  expect(second.sources.some(source => source.stopped && source.released)).toBe(true);
  await page.locator('.header-preset-picker summary').click();
  await page.locator('button[data-preset-id="clearSteps"]').click();
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
  const recalled = await diagnostics(page);
  expect(recalled.audio).toBe(true);
  expect(recalled.inputSource).toMatchObject({ mode: 'file', fileName: second.inputSource.fileName, playing: true });
  expect(recalled.sources).toEqual(second.sources);
  await dry(page); await live(page, 347);
  await setRange(page, 'dry', 0);
  await expect.poll(async () => (await diagnostics(page)).pcm.peak).toBeLessThan(1e-6);
  expect((await diagnostics(page)).inputSource.playing).toBe(true);
  await setRange(page, 'dry', .5); await live(page, 347);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).inputSource.playing).toBe(false);
  expect((await diagnostics(page)).audio).toBe(false);
  expect(errors).toEqual([]);
  await info.attach('graph-uploaded-rust-pcm.json', { contentType: 'application/json', body: JSON.stringify({ first: first.pcm, second: second.pcm, actualWasm: true, listeningPerformed: false }) });
});

test('bundled sample, stop/restart, and real non-looping end preserve armed Audio', async ({ page }) => {
  const errors = await fixture(page); await dry(page);
  await choose(page, 'source', 'samples'); await choose(page, 'inputSample', 'music-bass');
  await page.locator('#audioButton').click();
  const sample = await live(page);
  expect(sample.inputSource.credit).toBeTruthy(); expect(sample.microphoneRequests).toBe(0);
  await expect(page.locator('#inputSourceStatus')).not.toBeEmpty();
  await expect(page.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.mz-input-toggle').click();
  await expect.poll(async () => (await diagnostics(page)).inputSource.playing).toBe(false);
  expect((await diagnostics(page)).audio).toBe(true);
  await page.locator('.mz-input-toggle').click();
  expect((await live(page)).microphoneRequests).toBe(0);
  await revealPlayback(page); await page.locator('#stopInput').click();
  await expect.poll(async () => (await diagnostics(page)).inputSource.playing).toBe(false);
  await expect.poll(async () => (await diagnostics(page)).pcm.peak).toBeLessThan(1e-6);
  expect((await diagnostics(page)).audio).toBe(true);
  await page.locator('#restartInput').click();
  expect((await live(page)).worklets).toBe(sample.worklets);
  await choose(page, 'source', 'file'); await page.locator('#inputLoop').uncheck();
  await upload(page, 281, { duration: .35, name: 'one-shot.wav' });
  await expect.poll(async () => (await diagnostics(page)).inputSource).toMatchObject({ mode: 'file', playing: false, ended: true, loop: false });
  expect((await diagnostics(page)).audio).toBe(true);
  await page.locator('#inputLoop').check(); await page.locator('#restartInput').click();
  await live(page, 281);
  await page.locator('#panicButton').click();
  const stopped = await diagnostics(page);
  expect(stopped.audio).toBe(false); expect(stopped.inputSource.playing).toBe(false); expect(stopped.inputSource.pending).toBe(false);
  expect(stopped.sources.every(source => source.stopped || source.ended)).toBe(true);
  expect(errors).toEqual([]);
});

test('selecting Mic never requests permission and changing source cancels a late explicit grant', async ({ page }) => {
  const errors = await fixture(page, { delayedMic: true }); await dry(page);
  await choose(page, 'source', 'file'); await upload(page, 173);
  await page.locator('#audioButton').click(); await live(page, 173);
  await choose(page, 'source', 'mic');
  expect((await diagnostics(page)).microphoneRequests).toBe(0);
  expect((await diagnostics(page)).audio).toBe(true);
  await page.locator('.mz-input-toggle').click();
  await expect.poll(() => page.evaluate(() => __familyInput.requests)).toBe(1);
  await choose(page, 'source', 'samples'); await choose(page, 'inputSample', 'music-bass');
  await live(page);
  await page.evaluate(() => __familyInput.releases.splice(0).forEach(release => release()));
  await expect.poll(async () => (await diagnostics(page)).liveTracks).toBe(0);
  const current = await diagnostics(page);
  expect(current.inputSource.mode).toBe('samples'); expect(current.inputSource.playing).toBe(true);
  expect(current.microphone).toBe(false); expect(current.microphoneRequests).toBe(1); expect(current.audio).toBe(true);
  await page.locator('#panicButton').click(); expect(errors).toEqual([]);
});

test('source changes and Panic discard late decoding without reviving obsolete playback', async ({ page }) => {
  const errors = await fixture(page); await dry(page);
  await choose(page, 'source', 'file'); await upload(page, 173);
  await page.locator('#audioButton').click(); await live(page, 173);
  const heldUpload = async name => {
    await page.evaluate(() => { __graphInputsQa.holdNextDecode = true; });
    await page.locator('#inputFile').setInputFiles({ name, mimeType: 'audio/wav', buffer: wav(347) });
    await expect.poll(() => page.evaluate(() => __graphInputsQa.pendingDecodes.length)).toBe(1);
  };
  await heldUpload('obsolete.wav');
  await choose(page, 'source', 'samples'); await choose(page, 'inputSample', 'music-bass'); await live(page);
  await page.evaluate(() => __graphInputsQa.pendingDecodes.splice(0).forEach(release => release()));
  expect((await diagnostics(page)).inputSource).toMatchObject({ mode: 'samples', playing: true, pending: false });
  await choose(page, 'source', 'file'); await upload(page, 173, { name: 'second-baseline.wav' });
  await live(page, 173); await heldUpload('cancelled.wav');
  await page.locator('#panicButton').click();
  await page.evaluate(() => __graphInputsQa.pendingDecodes.splice(0).forEach(release => release()));
  await expect.poll(async () => (await diagnostics(page)).inputSource).toMatchObject({ playing: false, pending: false });
  const cancelled = await diagnostics(page);
  expect(cancelled.audio).toBe(false); expect(cancelled.microphoneRequests).toBe(0);
  expect(cancelled.sources.every(source => source.stopped || source.ended)).toBe(true);
  await upload(page, 281, { name: 'fresh.wav' });
  expect((await diagnostics(page)).audio).toBe(false);
  await page.locator('#audioButton').click(); await live(page, 281);
  await heldUpload('stale-before-error.wav');
  await page.locator('#inputFile').setInputFiles({ name: 'invalid.wav', mimeType: 'audio/wav', buffer: Buffer.from('not an audio file') });
  await expect(page.locator('#audioError')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#audioError')).toContainText(/decode/i);
  await page.evaluate(async () => {
    __graphInputsQa.pendingDecodes.splice(0).forEach(release => release());
    // Drain the cancelled decode's promise chain before checking the newer error.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect(page.locator('#audioError')).toHaveJSProperty('hidden', false);
  await expect(page.locator('#audioError')).toContainText(/decode/i);
  await page.locator('#panicButton').click(); expect(errors).toEqual([]);
});

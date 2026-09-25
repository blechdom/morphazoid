import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { enforceRubixoidsOwnership } from './helpers/rubixoids-ownership.mjs';

enforceRubixoidsOwnership(test, expect);

const mainAudio = page => page.locator('body > .masthead #audioButton');
const mainPlay = page => page.locator('body > .rubixoids-bar #playButton');
const pane = (page, dimension) => page.locator(`.rubixoids-pane[data-dimension="${dimension}"]`);
const cubeSnapshot = page => page.evaluate(async () => (
  await import('/src/instruments/rubixoids/rubix/rubix-app.js')
).rubixPlaybackSnapshot());

// Tap the existing output after its gain and dynamics. The worklet measures PCM
// on the audio thread, so frozen UI meters cannot masquerade as sound continuity.
async function attachOutputProbe(page) {
  await page.evaluate(async () => {
    const analyser = globalThis.__ownedRubixOutput;
    const context = analyser.context;
    const source = `
      class OwnedRubixOutputProbe extends AudioWorkletProcessor {
        constructor() {
          super();
          this.frames = 0;
          this.peak = 0;
          this.squareSum = 0;
          this.sampleCount = 0;
          this.finite = true;
        }
        process(inputs) {
          const channels = inputs[0];
          const frames = channels?.[0]?.length ?? 128;
          if (!this.frames) this.start = currentTime;
          for (const channel of channels) for (const sample of channel) {
            this.finite &&= Number.isFinite(sample);
            this.peak = Math.max(this.peak, Math.abs(sample));
            this.squareSum += sample * sample;
            this.sampleCount += 1;
          }
          this.frames += frames;
          if (this.frames >= 1024) {
            this.port.postMessage({ start: this.start, end: currentTime + frames / sampleRate,
              frames: this.frames, finite: this.finite, peak: this.peak,
              rms: Math.sqrt(this.squareSum / Math.max(1, this.sampleCount)) });
            this.frames = this.peak = this.squareSum = this.sampleCount = 0;
            this.finite = true;
          }
          return true;
        }
      }
      registerProcessor('owned-rubix-output-probe', OwnedRubixOutputProbe);
    `;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(url); }
    finally { URL.revokeObjectURL(url); }
    const node = new AudioWorkletNode(context, 'owned-rubix-output-probe');
    const silent = context.createGain();
    silent.gain.value = 0;
    analyser.connect(node).connect(silent).connect(context.destination);
    const blocks = [];
    node.port.onmessage = ({ data }) => {
      blocks.push(data);
      if (blocks.length > 300) blocks.shift();
    };
    globalThis.__ownedRubixOutputProbe = { context, node, silent, blocks };
  });
}

test('owned 3D SIMD runs six face voices and keeps output sounding during a UI stall', async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/rubixoids.html');
  const cube = pane(page, '3d');
  await expect(cube.locator('#soundBank')).toBeVisible();
  await page.evaluate(async () => {
    const { RubixAudioEngine } = await import('/src/instruments/rubixoids/rubix/rubix-app.js');
    const buildGraph = RubixAudioEngine.prototype.buildGraph;
    RubixAudioEngine.prototype.buildGraph = function (...args) {
      const result = buildGraph.apply(this, args);
      globalThis.__ownedRubixOutput = this.analyser;
      return result;
    };
  });
  await cube.locator('#soundBank').selectOption('acid-303');
  await cube.locator('#acidEngine').selectOption('simd-303');
  await mainAudio(page).click();
  await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await expect.poll(async () => (await cubeSnapshot(page)).simdVoices).toBe(6);
  expect((await cubeSnapshot(page)).simdBackend).toBe('simd');
  await attachOutputProbe(page);
  await mainPlay(page).click();
  await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => page.evaluate(() =>
    globalThis.__ownedRubixOutputProbe.blocks.some(block => block.peak > .001)
  )).toBe(true);
  const before = await cubeSnapshot(page);
  const stall = await page.evaluate(() => {
    const probe = globalThis.__ownedRubixOutputProbe;
    const audioStart = probe.context.currentTime;
    const started = performance.now();
    while (performance.now() - started < 220) { /* simulate blocked rendering/UI */ }
    return { audioStart, audioEnd: probe.context.currentTime, elapsedMs: performance.now() - started };
  });
  await expect.poll(async () => page.evaluate(() =>
    globalThis.__ownedRubixOutputProbe.blocks.at(-1)?.end ?? 0
  )).toBeGreaterThan(stall.audioEnd);
  const during = await page.evaluate(({ audioStart, audioEnd }) => (
    globalThis.__ownedRubixOutputProbe.blocks.filter(block =>
      block.start >= audioStart + .01 && block.end <= audioEnd - .01)
  ), stall);
  expect(stall.elapsedMs).toBeGreaterThanOrEqual(220);
  expect(stall.audioEnd - stall.audioStart).toBeGreaterThan(.18);
  expect(during.length, 'PCM blocks must be rendered inside the blocked UI interval').toBeGreaterThanOrEqual(5);
  expect(during.every(block => block.finite)).toBe(true);
  expect(during.filter(block => block.peak > .0001).length).toBeGreaterThanOrEqual(Math.ceil(during.length / 2));
  expect(Math.max(...during.map(block => block.peak))).toBeGreaterThan(.001);
  expect(Math.max(...during.map(block => block.peak))).toBeLessThan(1);
  for (let index = 1; index < during.length; index += 1) {
    expect(Math.abs(during[index].start - during[index - 1].end)).toBeLessThan(.00001);
  }
  const after = await cubeSnapshot(page);
  expect(after.simdTimelineStart).toBe(before.simdTimelineStart);
  expect(after.simdBackend).toBe('simd');
  expect(after.simdVoices).toBe(6);
  expect(after.playing).toBe(true);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 350 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await info.attach('owned-simd-ui-stall.json', {
    body: JSON.stringify({ stall, during, envelope: envelope.summary, timelineStart: after.simdTimelineStart }),
    contentType: 'application/json',
  });
  await mainAudio(page).click();
  await waitForStableAudioState(page, false);
  expect((await cubeSnapshot(page)).simdVoices).toBe(0);
  expect(errors).toEqual([]);
});

test('owned Chiptune uses real SIMD kernels and sounding voices in every dimension', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/rubixoids.html');
  await expect(pane(page, '3d').locator('#soundBank')).toBeVisible();
  await page.evaluate(async () => {
    const { SequencerVoiceBank } = await import('/src/instruments/rubixoids/audio/sequencer-voices.js');
    const banks = globalThis.__ownedSequencerBanks = new Set();
    const prepare = SequencerVoiceBank.prototype.prepare;
    SequencerVoiceBank.prototype.prepare = function (...args) {
      banks.add(this);
      return prepare.apply(this, args);
    };
  });
  const runningBanks = () => page.evaluate(() => [...globalThis.__ownedSequencerBanks]
    .filter(bank => bank.context?.state === 'running')
    .map(bank => ({ ...bank.diagnostics(), voices: [...bank.active].map(({ voice, backend }) => ({ voice, backend })) })));
  await pane(page, '3d').locator('#soundBank').selectOption('shared-simd-chiptune');
  await mainAudio(page).click();
  await expect(mainAudio(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await mainPlay(page).click();
  const evidence = [];
  for (const dimension of ['3d', '2d', '4d']) {
    await page.locator(`.rubixoids-dimensions button[data-dimension="${dimension}"]`).click();
    const view = pane(page, dimension);
    await expect(view).toBeVisible();
    await expect(view.locator(dimension === '4d' ? '#voice' : '#soundBank')).toHaveValue('shared-simd-chiptune');
    await expect(mainPlay(page)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await runningBanks()).length).toBe(1);
    await expect.poll(async () => (await runningBanks())[0]?.voices
      .filter(voice => voice.voice === 'simd-chiptune' && voice.backend === 'simd').length ?? 0,
    { timeout: 15_000 }).toBeGreaterThan(0);
    const [bank] = await runningBanks();
    expect(bank.prepared).toBe(true);
    expect(bank.backends).toEqual({ synth: 'simd', acid: 'simd' });
    expect(bank.failures).toEqual([]);
    expect(bank.triggered).toBeGreaterThan(0);
    expect(bank.voices.every(voice => voice.backend === 'simd')).toBe(true);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 600 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak, dimension).toBeGreaterThan(.001);
    expect(envelope.summary.clippedSamples, dimension).toBe(0);
    evidence.push({ dimension, bank, envelope: envelope.summary });
  }
  await info.attach('owned-chiptune-backends.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
  await mainAudio(page).click();
  await waitForStableAudioState(page, false);
  expect(errors).toEqual([]);
});

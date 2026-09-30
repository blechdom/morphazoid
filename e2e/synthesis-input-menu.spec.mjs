import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { PROCESSING_INPUT_OPTIONS } from '../src/instruments/synthesis/demo-sources.js';

const demos = PROCESSING_INPUT_OPTIONS.filter(option => option.kind === 'demo');
const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
const inputStatus = async page => (await status(page)).input;
const isDemoRequest = request => /\/assets\/(?:puggler\/(?:kick|snare|hat|tom|mic-check)\.wav|audio\/vocalzoid-cmu-arctic-(?:bdl|slt)\.wav|bioacoustics\/chaffinch\.ogg)$/.test(new URL(request.url()).pathname);

async function arm(page) {
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await status(page)).armed, { timeout: 15_000 }).toBe(true);
}
async function startBypassed(page) {
  await page.goto('/synthesis.html?method=fx-biquad');
  await page.locator('#processingBypass').check();
  await arm(page);
  await page.locator('#playButton').click();
}
async function loaded(page, option) {
  await expect.poll(() => inputStatus(page), { timeout: 10_000 }).toMatchObject({
    selection: option.id, source: 0, loading: false, kind: 'file',
  });
  await expect(page.locator('#inputStatus')).toContainText(option.label);
}
function assertAudible(envelope) {
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.003);
  expect(envelope.summary.maxRms).toBeGreaterThan(.001);
  expect(envelope.summary.maxPeak).toBeLessThanOrEqual(1);
  expect(envelope.summary.clippedSamples).toBe(0);
}

// Short source loops include silence and strong acoustic transients; measure a
// window rather than requiring every instantaneous meter read to be nonzero.
test('sample selection and transport remain silent without Audio; explicit arming starts a repeating loop', async ({ page }, testInfo) => {
  const requests = [];
  page.on('request', request => { if (isDemoRequest(request)) requests.push(request.url()); });
  await page.goto('/synthesis.html?method=fx-biquad');
  const before = await page.evaluate(() => window.MorphazoidSynthesis.getState());
  const drums = demos.find(option => option.id === 'sample-drums');
  await choose(page, 'processingSource', drums.id);
  await page.locator('#triggerButton').click();
  await page.locator('#playButton').click();
  expect(await status(page)).toMatchObject({ armed: false, playing: true, input: { selection: drums.id, source: 0, kind: 'none', loading: false } });
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState())).toEqual(before);
  expect(requests).toEqual([]);
  await expect(page.locator('#inputStatus')).toContainText('Enable Audio');
  await page.locator('#processingBypass').check();
  await arm(page);
  await loaded(page, drums);
  const firstLoop = await sampleAudioEnvelope(page, { durationMs: 4400, intervalMs: 80 });
  const repeatedLoop = await sampleAudioEnvelope(page, { durationMs: 1400, intervalMs: 60 });
  assertAudible(firstLoop); assertAudible(repeatedLoop);
  expect(requests).toHaveLength(4);
  expect((await status(page)).playing).toBe(true);
  await page.locator('#playButton').click();
  await waitForStableAudioState(page, false, { stableMs: 200 });
  await expect(page.locator('#audioError')).toBeHidden();
  await testInfo.attach('processing-drum-loop.json', { body: JSON.stringify({ firstLoop, repeatedLoop }, null, 2), contentType: 'application/json' });
});

test('all five bundled sample inputs reach the output with finite bounded audio', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await startBypassed(page);
  const measurements = {};
  for (const option of demos) {
    await choose(page, 'processingSource', option.id);
    await loaded(page, option);
    measurements[option.id] = await sampleAudioEnvelope(page, { durationMs: 2300, intervalMs: 60 });
    assertAudible(measurements[option.id]);
    expect((await status(page)).playing).toBe(true);
    await expect(page.locator('#audioError')).toBeHidden();
  }
  expect(errors).toEqual([]);
  await testInfo.attach('processing-sample-levels.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

test('explicit input survives preset Next and both dice, then Noise releases the sample input', async ({ page }) => {
  const requests = []; page.on('request', request => { if (isDemoRequest(request)) requests.push(request.url()); });
  await startBypassed(page);
  const voice = demos.find(option => option.id === 'voice-slt');
  await choose(page, 'processingSource', voice.id);
  await loaded(page, voice);
  for (const selector of ['#nextPreset', '#randomMethod', '#randomPreset', '#nextPreset']) {
    await page.locator(selector).click();
    await expect(page.locator('#processingSource')).toHaveValue(voice.id);
    expect(await status(page)).toMatchObject({ section: 'processing', armed: true, playing: true, input: { selection: voice.id, source: 0, kind: 'file', loading: false } });
    await expect(page.locator('#inputStatus')).toContainText(voice.label);
  }
  expect(requests).toHaveLength(1);
  await choose(page, 'processingSource', 'noise');
  expect(await inputStatus(page)).toMatchObject({ selection: 'noise', source: 3, kind: 'none', loading: false });
  await expect(page.locator('#inputStatus')).toHaveText('Noise');
  await expect(page.locator('#frequencyRow')).toBeVisible();
  await expect(page.locator('#audioError')).toBeHidden();
});

for (const action of ['mute', 'section', 'input']) test(`a delayed sample request cannot reactivate input after ${action} changes`, async ({ page }) => {
  let release, requested = false, routeFinished;
  const held = new Promise(resolve => { release = resolve; });
  const finished = new Promise(resolve => { routeFinished = resolve; });
  await page.route('**/assets/audio/vocalzoid-cmu-arctic-bdl.wav', async route => {
    requested = true;
    await held;
    try { await route.continue(); } catch { /* The old request can already be aborted. */ }
    routeFinished();
  });
  try {
    await startBypassed(page);
    await choose(page, 'processingSource', 'voice-bdl');
    await expect.poll(() => requested).toBe(true);
    expect(await inputStatus(page)).toMatchObject({ selection: 'voice-bdl', loading: true, kind: 'none' });
    if (action === 'mute') await page.locator('#audioButton').click();
    else if (action === 'section') await page.locator('#sectionSynthesis').click();
    else await choose(page, 'processingSource', 'noise');
    await expect.poll(() => inputStatus(page)).toMatchObject({ loading: false, kind: 'none' });
    release();
    await finished;
    // The released response must have time to resolve/decode if a stale task
    // incorrectly survived cancellation; its callback must not attach a source.
    await page.waitForTimeout(350);
    expect(await inputStatus(page)).toMatchObject({ loading: false, kind: 'none' });
    if (action === 'mute') {
      expect((await status(page)).armed).toBe(false);
      await waitForStableAudioState(page, false);
    } else if (action === 'section') expect((await status(page)).section).toBe('synthesis');
    else expect(await inputStatus(page)).toMatchObject({ selection: 'noise', source: 3 });
    await expect(page.locator('#audioError')).toBeHidden();
  } finally { release(); }
});

function uploadedTone() {
  const sampleRate = 16000, frames = sampleRate / 2, buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) buffer.writeInt16LE(Math.round(Math.sin(frame * Math.PI * 2 * 330 / sampleRate) * .4 * 32767), 44 + frame * 2);
  return buffer;
}

test('Your audio file returns to the uploaded recording after using a demo sample', async ({ page }) => {
  await startBypassed(page);
  await choose(page, 'processingSource', 'file');
  await page.locator('#sourceFile').setInputFiles({ name: 'retained-loop.wav', mimeType: 'audio/wav', buffer: uploadedTone() });
  await expect.poll(() => inputStatus(page)).toMatchObject({ selection: 'file', kind: 'file', source: 0, loading: false });
  await expect(page.locator('#inputStatus')).toContainText('retained-loop.wav');
  assertAudible(await sampleAudioEnvelope(page, { durationMs: 500 }));
  const drums = demos.find(option => option.id === 'sample-drums');
  await choose(page, 'processingSource', drums.id);
  await loaded(page, drums);
  await choose(page, 'processingSource', 'file');
  await expect.poll(() => inputStatus(page)).toMatchObject({ selection: 'file', kind: 'file', source: 0, loading: false });
  await expect(page.locator('#inputStatus')).toContainText('retained-loop.wav');
  assertAudible(await sampleAudioEnvelope(page, { durationMs: 500 }));
  await expect(page.locator('#audioError')).toBeHidden();
});

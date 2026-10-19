import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';

const USES = ['body', 'processing', 'reverb', 'resynthesis'];
const EXCITERS = ['impulse', 'white-noise', 'pink-noise', 'pluck', 'soft-mallet', 'hard-mallet'];
const read = page => page.evaluate(() => globalThis.__MORPHAZOID_RUST_RESONATOR__.getState());
async function choose(page, id, value) {
  const index = await page.locator('#' + id).evaluate((select, wanted) => [...select.options].findIndex(option => option.value === wanted), value);
  expect(index, `${id} includes ${value}`).toBeGreaterThanOrEqual(0);
  await page.locator(`[data-select-id="${id}"] > summary`).click();
  await page.locator(`[data-select-id="${id}"] button[data-option-index="${index}"]`).click();
}
async function range(page, id, value) {
  await page.locator('#' + id).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function toggle(page, id) { await page.locator(`label[for="${id}"]`).click(); }

// Measure unencoded Float32 output through the same final stereo bus used by
// the recorder. The probe contributes silence; it cannot amplify the instrument.
async function installProbe(page) {
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager(), context = manager.recordingContext();
    if (!context) throw new Error('Enable Audio before installing the Rezoidinator probe.');
    const source = `class RezoModeProbe extends AudioWorkletProcessor {
      constructor() { super(); this.capture = null; this.port.onmessage = ({data}) => {
        this.capture = { frames: data.frames, at: 0, energy: 0, peak: 0, nonfinite: 0, clipped: 0 };
      }; }
      process(inputs, outputs) {
        for (const channel of outputs[0] || []) channel.fill(0);
        const take = this.capture, input = inputs[0];
        if (!take || !input?.[0]) return true;
        const frames = Math.min(input[0].length, take.frames - take.at);
        for (let f = 0; f < frames; f++) for (const channel of input) {
          const value = channel[f];
          if (!Number.isFinite(value)) { take.nonfinite++; continue; }
          take.energy += value * value; take.peak = Math.max(take.peak, Math.abs(value));
          if (Math.abs(value) >= 1) take.clipped++;
        }
        take.at += frames;
        if (take.at === take.frames) { this.port.postMessage(take); this.capture = null; }
        return true;
      }
    } registerProcessor('rezo-mode-probe', RezoModeProbe);`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const tap = new AudioWorkletNode(context, 'rezo-mode-probe', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const release = manager.tapInto(context, tap); tap.connect(context.destination);
    globalThis.__rezoModeProbe = {
      capture(seconds) { return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Rezoidinator output capture timed out')), 8000);
        tap.port.onmessage = ({ data }) => { clearTimeout(timer); resolve(data); };
        tap.port.postMessage({ frames: Math.round(context.sampleRate * seconds) });
      }); },
      dispose() { release(); tap.disconnect(); tap.port.close(); },
    };
  });
}
async function capture(page, trigger = false, seconds = .35) {
  await page.evaluate(duration => { globalThis.__rezoModeCapture = globalThis.__rezoModeProbe.capture(duration); }, seconds);
  if (trigger) await page.locator('#pluckButton').click();
  return page.evaluate(() => globalThis.__rezoModeCapture);
}
function audible(result, label) {
  expect(result.nonfinite, label).toBe(0);
  expect(result.clipped, label).toBe(0);
  expect(result.peak, label).toBeLessThan(1);
  expect(result.peak, label).toBeGreaterThan(.00001);
  expect(result.energy, label).toBeGreaterThan(0);
}

test('body and excitation are the defaults, with 100% volume and no implicit microphone or Audio start', async ({ page }) => {
  await installAudioInputFixture(page);
  await page.goto('simd-resonator-rust.html');
  expect(await read(page)).toMatchObject({ application: 'body', inputKind: 'excitation', audioOn: false });
  await expect(page.locator('#outputLevel')).toHaveAttribute('max', '1');
  await range(page, 'outputLevel', 1);
  await expect(page.locator('#outputLevelOut')).toHaveText('100%');
  await expect(page.locator('#pluckButton')).toHaveAccessibleName('Excite once');
  const bounds = await page.locator('#pluckButton').boundingBox();
  expect(bounds.width).toBe(bounds.height); expect(bounds.width).toBeLessThanOrEqual(36);
  for (const use of USES) {
    await choose(page, 'useSelect', use);
    expect((await read(page)).application).toBe(use);
    for (const id of EXCITERS) await choose(page, 'excitationType', id);
    await page.locator('#pluckButton').click();
    expect((await read(page)).audioOn).toBe(false);
  }
  await choose(page, 'inputSource', 'mic');
  expect(await page.evaluate(() => window.__familyInput.requests)).toBe(0);
  expect((await read(page)).audioReady).toBe(false);
});

for (const use of USES) test(`${use}: every exciter produces bounded first and repeated attacks at 100% master`, async ({ page }, info) => {
  test.setTimeout(60000);
  await page.goto('simd-resonator-rust.html');
  await range(page, 'outputLevel', 1);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).audioOn).toBe(true);
  await installProbe(page);
  const measurements = [];
  for (const kind of EXCITERS) {
    await page.locator('#resetButton').click();
    await choose(page, 'useSelect', use);
    // Remove the authored direct blend so dry sound cannot conceal a silent
    // FFT or a reverb which never received the excitation.
    if (use === 'resynthesis') await range(page, 'fftMix', 1);
    if (use === 'reverb') await range(page, 'reverbMix', 1);
    await choose(page, 'excitationType', kind);
    const initial = await capture(page, true);
    const repeated = await capture(page, true);
    audible(initial, `${use}/${kind} first attack`); audible(repeated, `${use}/${kind} repeated attack`);
    measurements.push({ kind, initial, repeated });
    expect((await read(page)).inputKind).toBe('excitation');
    expect((await read(page)).outputLevel).toBe(1);
  }
  await info.attach(`rezoidinator-${use}-excitations.json`, { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).contextState).toBe('none');
});

test('uses, characters and stage combinations retain the same sample loop and final output', async ({ page }) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('simd-resonator-rust.html');
  await choose(page, 'inputSource', 'sample-file'); await choose(page, 'inputSample', 'music-arp');
  await range(page, 'outputLevel', 1); await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  await installProbe(page);
  const before = await read(page);
  for (const use of USES) {
    await choose(page, 'useSelect', use);
    audible(await capture(page), use);
    const after = await read(page);
    expect(after.inputPlaybackRevision).toBe(before.inputPlaybackRevision);
    expect(after.input).toMatchObject({ playing: true, loop: true, sampleId: 'music-arp' });
    expect(after.contextTime).toBeGreaterThan(before.contextTime);
  }
  for (const id of ['bodyEnabled', 'processingEnabled', 'reverbEnabled']) await toggle(page, id);
  expect((await read(page)).signal).toMatchObject({ bodyEnabled: true, processingEnabled: true, resynthesisEnabled: true, reverbEnabled: true });
  await expect(page.locator('#signalPath')).toHaveText('Source → Process → Body + FFT → Reverb');
  for (const id of ['reverbCharacter', 'resynthesisCharacter']) {
    const options = await page.locator('#' + id).evaluate(select => [...select.options].map(option => option.value).filter(Boolean));
    expect(options.length).toBeGreaterThanOrEqual(4);
    await choose(page, id, options.at(-1));
  }
  await choose(page, 'filterType', 'bypass'); await expect(page.locator('#filterFrequency')).toBeDisabled();
  await range(page, 'drive', 24); audible(await capture(page), 'combined stages at full drive');
  await toggle(page, 'surroundEnabled'); await choose(page, 'surroundLayout', '16-ring');
  await expect.poll(async () => (await read(page)).spatialEnabled).toBe(true);
  await expect.poll(async () => (await read(page)).spatialPeaks.filter(value => value > .00001).length).toBeGreaterThan(3);
  audible(await capture(page), 'surround stereo monitor');
  const after = await read(page);
  expect(after.inputPlaybackRevision).toBe(before.inputPlaybackRevision);
  expect(after.outputLevel).toBe(1); expect(after.input.playing).toBe(true);
  expect(errors).toEqual([]);
});

function testWav() {
  const rate = 48000, frames = rate / 2, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index++) data.writeInt16LE(Math.round(6000 * Math.sin(index * 220 * Math.PI * 2 / rate)), 44 + index * 2);
  return data;
}
test('one local audio file keeps looping through all four uses', async ({ page }) => {
  await page.goto('simd-resonator-rust.html');
  await choose(page, 'inputSource', 'file');
  await page.locator('#inputFile').setInputFiles({ name: 'rezo-modes-voice.wav', mimeType: 'audio/wav', buffer: testWav() });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).input.playing).toBe(true);
  await installProbe(page); const revision = (await read(page)).inputPlaybackRevision;
  for (const use of USES) {
    await choose(page, 'useSelect', use); audible(await capture(page), `file/${use}`);
    expect((await read(page)).inputPlaybackRevision).toBe(revision);
    expect((await read(page)).input).toMatchObject({ mode: 'file', playing: true, loop: true });
  }
});

test('explicit microphone input works in every use without capture restart and releases on Audio off', async ({ page }) => {
  await installAudioInputFixture(page); await page.goto('simd-resonator-rust.html');
  await choose(page, 'inputSource', 'mic');
  expect(await page.evaluate(() => window.__familyInput.requests)).toBe(0);
  await page.locator('#micButton').click();
  await expect.poll(async () => (await read(page)).micOn).toBe(true);
  expect((await read(page)).audioOn).toBe(false);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).audioOn).toBe(true);
  await installProbe(page);
  for (const use of USES) {
    await choose(page, 'useSelect', use); audible(await capture(page), `microphone/${use}`);
    expect(await page.evaluate(() => window.__familyInput.requests)).toBe(1);
  }
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await read(page)).micOn).toBe(false);
  expect(await page.evaluate(() => window.__familyInput.tracks.every(track => track.readyState === 'ended'))).toBe(true);
});

test('mode, excitation and combination controls stay reachable in both mobile orientations', async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(test.info().project.use.baseURL + 'simd-resonator-rust.html');
    await choose(page, 'useSelect', 'resynthesis');
    for (const id of ['bodyEnabled', 'processingEnabled', 'reverbEnabled']) await toggle(page, id);
    await choose(page, 'excitationType', 'hard-mallet');
    for (const id of ['bodySection', 'processingSection', 'resynthesisSection', 'reverbSection']) {
      await page.locator('#' + id).scrollIntoViewIfNeeded(); await expect(page.locator('#' + id)).toBeVisible();
    }
    await page.locator('#pluckButton').scrollIntoViewIfNeeded();
    const trigger = await page.locator('#pluckButton').boundingBox();
    expect(trigger.height).toBeGreaterThanOrEqual(48); expect(trigger.width).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.locator('.panel').evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
    await context.close();
  }
});

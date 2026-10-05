import { test, expect } from '@playwright/test';
import { choose } from './helpers/synthesis-controls.mjs';
import { sampleAudioEnvelope, readAudioStatus } from './helpers/audio-probe.mjs';

const status = page => page.evaluate(() => window.MorphazoidSynthesis.getStatus());
async function knob(page, key, value) {
  await page.locator(`#voiceInputPanel input[data-param="${key}"]`).first().evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function sounding(page) {
  const audio = await sampleAudioEnvelope(page, { durationMs: 900 });
  expect(audio.summary.finite).toBe(true);
  expect(audio.summary.maxRms).toBeGreaterThan(.0001);
  expect(audio.summary.clippedSamples).toBe(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Sinsy knob rejection and failed-engine recovery without reload at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(100_000);
    await page.setViewportSize(viewport);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const Original = window.AudioWorkletNode;
      window.__recoveryNodes = [];
      window.__voiceStartOffsets = [];
      const startSource = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.__voiceStartOffsets.push(args[1] ?? 0);
        return startSource.apply(this, args);
      };
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, ...rest) {
        if (message?.engine === 'sinsy' && window.__delayVoiceReply) {
          const receive = this.onmessage;
          this.onmessage = event => setTimeout(() => receive(event), 400);
        }
        return post.call(this, message, ...rest);
      };
      window.AudioWorkletNode = class extends Original {
        constructor(...args) { super(...args); if (args[1] === 'roads-synthesis') window.__recoveryNodes.push(this); }
      };
      // AudioWorklet module fetches bypass Playwright routing in Chromium.
      // Patch a test-only blob at the loading boundary, reusing its URL so
      // Audio re-arm retains the browser's normal module-registration cache.
      const Context = window.AudioContext;
      window.AudioContext = class extends Context {
        constructor(...args) {
          super(...args);
          const addModule = this.audioWorklet.addModule.bind(this.audioWorklet), modules = new Map();
          this.audioWorklet.addModule = async (url, options) => {
            if (!String(url).endsWith('/synthesis/processor.js')) return addModule(url, options);
            if (!modules.has(String(url))) {
              const source = await fetch(url).then(response => response.text());
              if (!source.includes('try { this.message(data); }')) throw Error('Missing test failure injection seam.');
              modules.set(String(url), URL.createObjectURL(new Blob([source.replace('try { this.message(data); }',
                'try { if (data.type === "test-fatal-error") throw new Error("Injected engine failure."); this.message(data); }')], { type: 'text/javascript' })));
            }
            return addModule(modules.get(String(url)), options);
          };
        }
      };
    });
    await page.goto('/synthesis.html?method=fm&sequence=basic-up');
    await choose(page, 'inputCategory', 'singing');
    await choose(page, 'synthesis-voice-1-method', 'sinsy');
    await page.evaluate(() => {
      const next = window.MorphazoidSynthesis.getState();
      next.routing.voice.scene.input = { tempo: 180, notes: [
        { midi: 60, beats: 1, lyric: 'あ' }, { midi: 64, beats: 1, lyric: 'い' }, { midi: 67, beats: 1, lyric: 'う' },
      ] };
      window.MorphazoidSynthesis.applyState(next);
    });
    expect((await status(page)).armed).toBe(false);
    await page.locator('#audioButton').click();
    await expect.poll(async () => (await status(page)).armed).toBe(true);
    await page.locator('#playButton').click();
    await expect.poll(async () => (await status(page)).input.voice, { timeout: 30000 }).toMatchObject({ engine: 'sinsy', playing: true, loading: false, timingsCurrent: true });
    await expect(page.locator('.native-score-playhead')).toBeVisible();
    await sounding(page);

    await knob(page, 'alpha', .9);
    await expect(page.locator('#audioError')).toContainText('sustained clipping', { timeout: 30000 });
    expect((await status(page)).input.voice).toMatchObject({ playing: true, timingsCurrent: false });
    await expect(page.locator('#voiceInputStatus')).toContainText('keeping the last good voice');
    await expect(page.locator('.native-score-playhead')).toBeHidden();
    await sounding(page);
    await knob(page, 'alpha', .55);
    await expect(page.locator('#audioError')).toBeHidden({ timeout: 30000 });
    await expect.poll(async () => (await status(page)).input.voice.timingsCurrent).toBe(true);

    await knob(page, 'speed', .1);
    await expect(page.locator('#voiceInputStatus')).toContainText('stretched short notes', { timeout: 30000 });
    await expect(page.locator('.native-score-playhead')).toBeHidden();
    await knob(page, 'speed', 1);
    await expect.poll(async () => (await status(page)).input.voice.timingWarning, { timeout: 30000 }).toBe(null);

    // Seek in the same event turn as an edit. A delayed worker reply exposes
    // the old 160 ms debounce race that used to cancel this explicit request.
    await page.evaluate(() => {
      window.__delayVoiceReply = true; window.__voiceStartOffsets.length = 0;
      const alpha = document.querySelector('#voiceInputPanel input[data-param="alpha"]');
      alpha.value = '.56'; alpha.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.native-beat-ruler').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__voiceStartOffsets.some(offset => Math.abs(offset - 3.25 / 3) < 1e-6)), { timeout: 30000 }).toBe(true);
    await page.evaluate(() => { window.__delayVoiceReply = false; });

    // An actual exception on the audio thread, not merely a forged UI error.
    await page.evaluate(() => window.__recoveryNodes.at(-1).port.postMessage({ type: 'test-fatal-error' }));
    await expect.poll(async () => (await status(page)).armed).toBe(false);
    await expect(page.locator('#audioError')).toContainText('no page refresh is needed');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#audioButton').click();
    await expect.poll(async () => (await status(page)).input.voice, { timeout: 30000 }).toMatchObject({ playing: true, loading: false });
    await expect(page.locator('#audioError')).toBeHidden();
    expect(await page.evaluate(() => window.__recoveryNodes.length)).toBe(2);
    await sounding(page);
    await page.getByRole('button', { name: 'Next voice preset', exact: true }).click();
    await expect.poll(async () => (await status(page)).input.voice.timingsCurrent, { timeout: 30000 }).toBe(true);
    await sounding(page);
    await choose(page, 'inputCategory', 'synthesis');
    await sounding(page);
    expect(errors).toEqual([]);
    await page.locator('#audioButton').click();
    expect((await status(page)).armed).toBe(false);
  });
}

import { test, expect } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';
const modes = ['wander', 'grammar', 'grains', 'waveform', 'echoes', 'texture'];
const setRange = (page, id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  if (input.dataset.scale === 'log') {
    const min = Number(input.dataset.parameterMin), max = Number(input.dataset.parameterMax), offset = min === 0 ? .001 : 0;
    input.value = String(Math.log((value + offset) / (min + offset)) / Math.log((max + offset) / (min + offset)));
  } else input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

test('six modes: silent start, meaningful geometry, mode controls and presets', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('fractal-synthesis.html');
  await expect(page.locator('[data-mode]')).toHaveCount(6);
  expect((await readAudioStatus(page)).active).toBe(false);
  await page.locator('#playButton').click();
  expect(await page.evaluate(() => __fractalSignals.armed)).toBe(false);
  expect(await page.evaluate(() => __fractalSignals.audio.context)).toBeNull();
  for (const mode of modes) {
    await page.locator(`[data-mode="${mode}"]`).click();
    expect(await page.evaluate(() => __fractalSignals.state.mode)).toBe(mode);
    expect(await page.evaluate(() => __fractalSignals.playing)).toBe(true);
    const before = await page.evaluate(() => JSON.stringify(__fractalSignals.structure));
    await page.locator('#stage').focus();
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => JSON.stringify(__fractalSignals.structure))).not.toBe(before);
  }
  await page.locator('.header-preset-next').click();
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(true);
  await page.locator('.header-preset-random').click();
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(true);
  await expect(page.locator('#savePatch, #restorePatch, .patch-storage, .stage-heading')).toHaveCount(0);
  await expect(page.locator('#engine option')).toHaveCount(3);
  await page.locator('#instrumentInfo').click();
  await expect(page.locator('#helpDialog')).toBeVisible();
  await expect(page.locator('#helpBody')).toContainText(/microphone/i);
  await page.keyboard.press('Escape');
  await page.locator('[data-help="attack"]').click();
  await expect(page.locator('#helpTitle')).toHaveText('Attack');
  await expect(page.locator('#helpBody')).toContainText('0.2 ms');
  await page.locator('#closeHelp').click();
  await setRange(page, 'base', 1600);
  expect(await page.evaluate(() => __fractalSignals.state.base)).toBeCloseTo(1600, 0);
  expect(errors).toEqual([]);
});

test('six real worklet engines: bounded output, stall continuity, mute and release', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.goto('fractal-synthesis.html');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  const measurements = {};
  for (const mode of modes) {
    await page.locator(`[data-mode="${mode}"]`).click();
    await page.locator('#restart').click();
    const audio = await sampleAudioEnvelope(page, { durationMs: 950, intervalMs: 50 });
    measurements[mode] = audio.summary;
    expect(audio.summary.finite, mode).toBe(true);
    expect(audio.summary.maxPeak, mode).toBeGreaterThan(.0005);
    expect(audio.summary.clippedSamples, mode).toBe(0);
  }
  const before = await page.evaluate(() => __fractalSignals.phase);
  await page.evaluate(() => { const end = performance.now() + 420; while (performance.now() < end) {} });
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => __fractalSignals.phase)).not.toBe(before);
  await page.locator('.header-preset-next').click();
  expect(await page.evaluate(() => __fractalSignals.armed && __fractalSignals.playing)).toBe(true);
  await setRange(page, 'level', 0);
  await page.waitForTimeout(150);
  const silent = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 50 });
  expect(silent.summary.maxPeak).toBeLessThan(.001);
  await setRange(page, 'level', .55);
  await page.locator('#playButton').click();
  await page.waitForTimeout(3500);
  const stopped = await sampleAudioEnvelope(page, { durationMs: 200, intervalMs: 50 });
  expect(stopped.summary.maxPeak).toBeLessThan(.001);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await testInfo.attach('six-engine-audio.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`controls reachable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('fractal-synthesis.html#grammar');
    await expect(page.locator('[data-mode=grammar]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    if (viewport.width < 960) {
      await page.mouse.move(viewport.width / 2, viewport.height - 30);
      await page.mouse.wheel(0, 850);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    for (const id of ['playButton', 'audioButton', 'base', 'rate', 'phrase', 'memory']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const box = await page.locator('#stage').boundingBox();
    await page.mouse.move(box.x + box.width * .4, box.y + box.height * .65);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .75, box.y + box.height * .5, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => __fractalSignals.state.x)).toBeGreaterThan(.65);
    await page.screenshot({ path: testInfo.outputPath(`fractal-${viewport.width}.png`), fullPage: true });
  });
}

test('deep links and all 54 presets are reachable', async ({ page }) => {
  for (const mode of modes) {
    await page.goto(`fractal-synthesis.html#${mode}`);
    await expect(page.locator(`[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('.header-preset-picker summary').click();
  await expect(page.locator('.header-preset-picker [data-preset-id]')).toHaveCount(54);
});

test('local audio import and every full preset retain the live player', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('fractal-synthesis.html#texture');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  const wav = Buffer.alloc(44 + 24000 * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(48000, 40);
  for (let i = 0; i < 24000; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 24000) * 8000), 44 + i * 2);
  await page.locator('#sourceFile').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav });
  await expect(page.locator('#sourceStatus')).toContainText('tone.wav');
  expect(await page.evaluate(() => __fractalSignals.armed && __fractalSignals.playing)).toBe(true);
  await page.locator('#clearSource').click();
  await expect(page.locator('#sourceStatus')).toContainText('Original synthetic');
  const ids = await page.locator('.header-preset-picker button[data-preset-id]').evaluateAll(buttons => buttons.map(button => button.dataset.presetId));
  expect(ids).toHaveLength(54);
  for (const id of ids) {
    await page.locator('.header-preset-picker summary').click();
    await page.locator(`[data-preset-id="${id}"]`).click();
    expect(await page.evaluate(() => __fractalSignals.armed && __fractalSignals.playing)).toBe(true);
    await expect(page.locator('.header-preset-picker summary')).not.toContainText('Custom');
  }
});


test('renamed route preserves query and hash, and Faves order follows Jaw Harp', async ({ page }) => {
  await page.goto('fractal-signals.html?test=alias#echoes');
  await expect(page).toHaveURL(/fractal-synthesis\.html\?test=alias#echoes$/);
  await expect(page.locator('[data-mode="echoes"]')).toHaveAttribute('aria-pressed', 'true');
  const faves = await page.evaluate(async () => (await import('./src/site/instrument-registry.js')).FAVE_TOOL_IDS);
  expect(faves[faves.indexOf('jaw-harp') + 1]).toBe('fractal-signals');
});

async function installMicrophoneFixture(page, { rejected = false, pending = false } = {}) {
  await page.addInitScript(({ rejected, pending }) => {
    window.__micRequests = 0;
    window.__micTracks = [];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      window.__micRequests++;
      if (rejected) throw new DOMException('Permission denied', 'NotAllowedError');
      if (pending) await new Promise(resolve => { window.__resolveMicrophone = resolve; });
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator(); oscillator.frequency.value = 731;
      const gain = ctx.createGain(); gain.gain.value = .15;
      const destination = ctx.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination); oscillator.start(); await ctx.resume();
      window.__micFixtureContext = ctx;
      window.__micTracks.push(...destination.stream.getTracks());
      return destination.stream;
    }});
  }, { rejected, pending });
}

test('explicit live input in all six modes survives presets and releases tracks', async ({ page }) => {
  test.setTimeout(60000);
  await installMicrophoneFixture(page);
  await page.goto('fractal-synthesis.html#echoes');
  await expect(page.locator('#microphone')).toBeDisabled();
  await page.locator('#playButton').click();
  expect(await page.evaluate(() => __micRequests)).toBe(0);
  await page.locator('#audioButton').click();
  await expect(page.locator('#microphone')).toBeEnabled();
  expect(await page.evaluate(() => __micRequests)).toBe(0);
  await page.locator('#microphone').click();
  await expect(page.locator('#microphone')).toHaveAttribute('aria-pressed', 'true');
  for (const mode of modes) {
    await page.locator(`[data-mode="${mode}"]`).click();
    await setRange(page, 'inputMix', 1);
    await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.inputRms ?? 0)).toBeGreaterThan(.02);
    const output = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });
    expect(output.summary.finite, mode).toBe(true);
    expect(output.summary.maxPeak, mode).toBeGreaterThan(.00001);
    expect(output.summary.clippedSamples, mode).toBe(0);
    expect(await page.evaluate(() => __fractalSignals.audio.microphoneActive)).toBe(true);
  }
  await page.locator('.header-preset-next').click();
  expect(await page.evaluate(() => __fractalSignals.audio.microphoneActive && __fractalSignals.playing)).toBe(true);
  expect(await page.evaluate(() => __micRequests)).toBe(1);
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => __micTracks.every(track => track.readyState === 'ended'))).toBe(true);
  await expect(page.locator('#microphone')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => __micFixtureContext.close());
});

test('microphone denial leaves Audio and Play usable', async ({ page }) => {
  await installMicrophoneFixture(page, { rejected: true });
  await page.goto('fractal-synthesis.html');
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await page.locator('#microphone').click();
  await expect(page.locator('#microphoneStatus')).toContainText('unavailable');
  expect(await page.evaluate(() => __fractalSignals.armed && __fractalSignals.playing)).toBe(true);
  expect(await page.evaluate(() => __fractalSignals.audio.microphoneActive)).toBe(false);
  await page.locator('#audioButton').click();
});

test('turning Audio off during a microphone request releases a late stream', async ({ page }) => {
  await installMicrophoneFixture(page, { pending: true });
  await page.goto('fractal-synthesis.html');
  await page.locator('#audioButton').click();
  await page.locator('#microphone').click();
  await expect.poll(() => page.evaluate(() => __micRequests)).toBe(1);
  await page.locator('#audioButton').click();
  await page.evaluate(() => __resolveMicrophone());
  await expect.poll(() => page.evaluate(() => __micTracks.length > 0 && __micTracks.every(track => track.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => __fractalSignals.audio.microphoneActive)).toBe(false);
  await page.evaluate(() => __micFixtureContext.close());
});

async function installClipboardFixture(page, { rejected = false } = {}) {
  await page.addInitScript(({ rejected }) => {
    window.__copiedSettings = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(text) {
        if (rejected) throw new DOMException('Permission denied', 'NotAllowedError');
        window.__copiedSettings = text;
      },
    } });
  }, { rejected });
}

test('Copy settings captures exact values and seed without changing the patch or storing it', async ({ page }) => {
  await installClipboardFixture(page);
  await page.goto('fractal-synthesis.html#grains');
  await setRange(page, 'base', 923.125);
  await setRange(page, 'position', .371);
  const before = await page.evaluate(() => ({
    state: __fractalSignals.state, phase: __fractalSignals.phase,
    storage: { ...localStorage },
  }));
  await page.locator('#copySettings').click();
  await expect(page.locator('#status')).toHaveText('Settings copied');
  const result = await page.evaluate(() => ({
    copied: JSON.parse(__copiedSettings), state: __fractalSignals.state,
    phase: __fractalSignals.phase, playing: __fractalSignals.playing,
    armed: __fractalSignals.armed, storage: { ...localStorage },
  }));
  expect(result.copied).toEqual({
    instrument: 'fractal-synthesis', version: 1, modeLabel: 'grains',
    snapshot: before.state,
    source: { material: 'Built-in synthetic source', microphone: false },
  });
  expect(result.state).toEqual(before.state);
  expect(result.phase).toBe(before.phase);
  expect(result.storage).toEqual(before.storage);
  expect(result.playing).toBe(false);
  expect(result.armed).toBe(false);
});

test('Copy settings offers selectable exact text when clipboard access is denied on a phone', async ({ page }) => {
  await installClipboardFixture(page, { rejected: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('fractal-synthesis.html#echoes');
  const state = await page.evaluate(() => __fractalSignals.state);
  await page.locator('#copySettings').click();
  await expect(page.locator('#helpDialog')).toBeVisible();
  await expect(page.locator('#settingsText')).toBeFocused();
  const copied = JSON.parse(await page.locator('#settingsText').inputValue());
  expect(copied.snapshot).toEqual(state);
  expect(await page.locator('#settingsText').evaluate(input => input.selectionEnd - input.selectionStart)).toBe((await page.locator('#settingsText').inputValue()).length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => __fractalSignals.state)).toEqual(state);
  await page.locator('#closeHelp').click();
  await page.locator('#instrumentInfo').click();
  await expect(page.locator('#helpBody')).toContainText(/microphone/i);
  await expect(page.locator('#settingsText')).toHaveCount(0);
  await page.locator('#closeHelp').click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('#copySettings').click();
  const dialog = await page.locator('#helpDialog').boundingBox();
  const close = await page.locator('#closeHelp').boundingBox();
  expect(close.y).toBeGreaterThanOrEqual(dialog.y);
  expect(close.y + close.height).toBeLessThanOrEqual(dialog.y + dialog.height);
  await expect(page.locator('#settingsText')).toBeFocused();
  expect(JSON.parse(await page.locator('#settingsText').inputValue()).snapshot).toEqual(state);
});

test('ADSR presets change only the envelope and preserve live microphone, playback and phase', async ({ page }) => {
  await installMicrophoneFixture(page);
  await installClipboardFixture(page);
  await page.goto('fractal-synthesis.html#echoes');
  await setRange(page, 'rate', .0625);
  await setRange(page, 'phrase', 128);
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await page.locator('#microphone').click();
  await expect(page.locator('#microphone')).toHaveAttribute('aria-pressed', 'true');
  await setRange(page, 'position', .4);
  await expect.poll(() => page.evaluate(() => __fractalSignals.phase)).toBeGreaterThan(.39);
  const baseline = await page.evaluate(() => __fractalSignals.state);
  const envelopeKeys = ['attack', 'decay', 'sustain', 'release'];
  const expected = {
    pluck: [.003, .022, .08, .045],
    note: [.01, .09, .42, .25],
    sustain: [.03, .15, .78, .5],
    pad: [.35, .55, .72, 1.3],
  };
  for (const [id, values] of Object.entries(expected)) {
    await page.locator(`#envelopeControl [data-preset="${id}"]`).click();
    await expect(page.locator('#envelopeControl [data-preset][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator(`#envelopeControl [data-preset="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    const current = await page.evaluate(() => ({
      state: __fractalSignals.state, phase: __fractalSignals.phase,
      active: __fractalSignals.armed && __fractalSignals.playing && __fractalSignals.audio.microphoneActive,
      requests: __micRequests,
    }));
    for (const [index, key] of envelopeKeys.entries()) expect(current.state[key], `${id} ${key}`).toBeCloseTo(values[index], 9);
    for (const key of Object.keys(baseline).filter(key => !envelopeKeys.includes(key))) expect(current.state[key], key).toEqual(baseline[key]);
    expect(current.active).toBe(true);
    expect(current.requests).toBe(1);
    expect(current.phase).toBeGreaterThan(.39);
    expect(current.phase).toBeLessThan(.42);
  }
  await setRange(page, 'attack', .12);
  await expect(page.locator('#envelopeControl [data-preset][aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#copySettings').click();
  expect(await page.evaluate(() => JSON.parse(__copiedSettings).source.microphone)).toBe(true);
  expect(await page.evaluate(() => __fractalSignals.armed && __fractalSignals.playing && __fractalSignals.audio.microphoneActive)).toBe(true);
  await page.locator('#audioButton').click();
  await page.evaluate(() => __micFixtureContext.close());
});

for (const armed of [false, true]) test(`transport: single pass and ping-pong completion with Audio ${armed ? 'on' : 'off'}`, async ({ page }) => {
  await page.goto('fractal-synthesis.html');
  await setRange(page, 'rate', 8);
  await setRange(page, 'phrase', 2);
  await page.locator('#loop').click();
  if (armed) {
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.evaluate(() => {
    const audio = __fractalSignals.audio;
    window.__playCommands = [];
    const original = audio.setPlaying.bind(audio);
    audio.setPlaying = value => { __playCommands.push(value); return original(value); };
  });
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.transport.completed)).toBe(true);
  expect(await page.evaluate(() => __fractalSignals.phase)).toBe(1);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __playCommands)).toEqual([true]);
  expect(await page.evaluate(() => __fractalSignals.armed)).toBe(armed);
  if (!armed) expect(await page.evaluate(() => __fractalSignals.audio.context)).toBeNull();
  await page.locator('#pingPong').click();
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.transport.completed)).toBe(true);
  expect(await page.evaluate(() => __fractalSignals.phase)).toBe(0);
  expect(await page.evaluate(() => __playCommands)).toEqual([true, true]);
  await page.locator('#restart').click();
  expect(await page.evaluate(() => __fractalSignals.transport.completed)).toBe(false);
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(false);
  if (armed) await page.locator('#audioButton').click();
});

test('ping-pong pause, Audio off/on and restart retain the right travel state', async ({ page }) => {
  await page.goto('fractal-synthesis.html#grains');
  await setRange(page, 'rate', 4);
  await setRange(page, 'phrase', 4);
  await page.locator('#pingPong').click();
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await page.waitForFunction(() => __fractalSignals.transport.travelDirection === -1 && __fractalSignals.phase < .85 && __fractalSignals.phase > .4);
  await page.locator('#playButton').click();
  await page.waitForTimeout(120);
  const paused = await page.evaluate(() => ({ phase: __fractalSignals.phase, transport: __fractalSignals.transport }));
  expect(paused.transport.travelDirection).toBe(-1);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => __fractalSignals.phase)).toBe(paused.phase);
  await page.locator('#audioButton').click();
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.travelDirection)).toBe(-1);
  expect(await page.evaluate(() => __fractalSignals.phase)).toBeCloseTo(paused.phase, 8);
  expect(await page.evaluate(() => __fractalSignals.transport.motionTime)).toBeCloseTo(paused.transport.motionTime, 8);
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.phase)).toBeLessThan(paused.phase - .1);
  await page.locator('#restart').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.transport.travelDirection)).toBe(1);
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(true);
  await page.locator('#audioButton').click();
});

test('mapping, expanded structure and microphone controls are grouped and copied', async ({ page }) => {
  await installClipboardFixture(page);
  await page.goto('fractal-synthesis.html#textures');
  expect(await page.locator('#sourceSection').evaluate(node => node.previousElementSibling.classList.contains('engine-row'))).toBe(true);
  await expect(page.locator('#sourceSection #profileMemory')).toHaveCount(1);
  for (const id of ['restart', 'reverse', 'pingPong', 'loop']) await expect(page.locator(`.performance-row #${id}`)).toHaveCount(1);
  await setRange(page, 'depth', 48);
  await setRange(page, 'branch', 16);
  await setRange(page, 'roughness', 3);
  await setRange(page, 'phrase', 512);
  await setRange(page, 'timingBend', .6);
  await setRange(page, 'shapeToMod', -12);
  await setRange(page, 'stereoWidth', 0);
  await page.locator('#pitchInvert').click();
  await page.locator('#stereoFlip').click();
  await page.locator('#copySettings').click();
  expect(await page.evaluate(() => JSON.parse(__copiedSettings).snapshot)).toMatchObject({ depth: 48, branch: 16, roughness: 3, phrase: 512, timingBend: .6, shapeToMod: -12, stereoWidth: 0, pitchInvert: true, stereoFlip: true });
  expect(await page.evaluate(() => __fractalSignals.structure.points.length)).toBeLessThanOrEqual(768);
});

test('shared ADSR graph drags update knobs, sustain linkage and preserve keyboard focus', async ({ page }) => {
  await page.goto('fractal-synthesis.html');
  await page.locator('#envelopeControl [data-preset="note"]').click();
  const attack = page.locator('#envelopeControl [data-node="1"]');
  await attack.focus();
  await attack.press('ArrowUp');
  await expect(attack).toBeFocused();
  await expect(page.locator('#envelopeControl [data-preset="note"]')).toHaveAttribute('aria-pressed', 'true');
  await setRange(page, 'release', 16);
  await attack.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => __fractalSignals.state);
  const box = await attack.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2, { steps: 3 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => __fractalSignals.state);
  expect(dragged.attack).toBeGreaterThan(before.attack);
  expect(dragged.release).toBeCloseTo(16, 8);
  for (const key of ['decay', 'sustain']) expect(dragged[key]).toBeCloseTo(before[key], 8);
  const sustain = page.locator('#envelopeControl [data-node="3"]');
  await sustain.focus();
  await sustain.press('ArrowUp');
  await sustain.press('ArrowUp');
  await expect(sustain).toBeFocused();
  expect(await page.evaluate(() => __fractalSignals.state.sustain)).toBeGreaterThan(before.sustain);
  const linked = await page.locator('#envelopeControl').evaluate(node => ['2', '3'].map(index => node.querySelector(`[data-node="${index}"]`).style.top));
  expect(linked[0]).toBe(linked[1]);
  await expect(page.locator('#envelopeControl [data-preset][aria-pressed="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => __fractalSignals.audio.context)).toBeNull();
});

test('slow Audio startup hands over a completed visual phrase without an old attack', async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.AudioWorkletNode, OriginalContext = window.AudioContext;
    window.__workletInitialPlaying = [];
    window.AudioContext = class extends OriginalContext {
      constructor(...args) {
        super(...args);
        const addModule = this.audioWorklet.addModule.bind(this.audioWorklet);
        this.audioWorklet.addModule = async (...args) => {
          await new Promise(resolve => setTimeout(resolve, 700));
          return addModule(...args);
        };
      }
    };
    window.AudioWorkletNode = class extends Original {
      constructor(context, name, options) {
        if (name === 'fractal-signals') __workletInitialPlaying.push({ playing: options.processorOptions.playing, completed: __fractalSignals.transport.completed });
        super(context, name, options);
      }
    };
  });
  await page.goto('fractal-synthesis.html');
  await setRange(page, 'rate', 8);
  await setRange(page, 'phrase', 2);
  await page.locator('#loop').click();
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.transport.completed)).toBe(true);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.completed)).toBe(true);
  expect(await page.evaluate(() => __workletInitialPlaying)).toEqual([{ playing: false, completed: true }]);
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(false);
  const output = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 50 });
  expect(output.summary.maxPeak).toBeLessThan(.000001);
  await page.locator('#audioButton').click();
});

test('circular Branch angle wraps, and Timing bend returns to zero without a restart', async ({ page }) => {
  await page.goto('fractal-synthesis.html#branches');
  await setRange(page, 'turns', 32);
  expect(await page.evaluate(() => __fractalSignals.state.turns)).toBe(32);
  await setRange(page, 'branchAngle', 359.9);
  await page.locator('#branchAngle').focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => __fractalSignals.state.branchAngle)).toBeCloseTo(0, 8);
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => __fractalSignals.state.branchAngle)).toBeCloseTo(359.9, 8);
  await setRange(page, 'timingBend', .65);
  await setRange(page, 'position', .4);
  await page.locator('#timingBendReset').click();
  expect(await page.evaluate(() => __fractalSignals.state.timingBend)).toBe(0);
  expect(await page.evaluate(() => __fractalSignals.phase)).toBe(.4);
  expect(await page.evaluate(() => __fractalSignals.audio.context)).toBeNull();
});

test('knob modulators retain base values and clock phases across pause and Audio off/on', async ({ page }) => {
  await installClipboardFixture(page);
  await page.goto('fractal-synthesis.html#branches');
  await setRange(page, 'branchAngle', 45);
  await setRange(page, 'lfo1Rate', 1);
  await setRange(page, 'lfo1Depth', 1);
  await page.locator('#lfo1Shape').selectOption('rise');
  await page.locator('#lfo1On').click();
  await page.locator('#playButton').click();
  expect(await page.evaluate(() => __fractalSignals.audio.context)).toBeNull();
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.modValues?.branchAngle)).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __fractalSignals.state.branchAngle)).toBe(45);
  await expect(page.locator('#branchAngle').locator('..').locator('.mz-range-knob__modulation')).toBeVisible();
  await page.locator('#playButton').click();
  await page.waitForTimeout(100);
  const paused = await page.evaluate(() => __fractalSignals.transport.modPhases);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => __fractalSignals.transport.modPhases)).toEqual(paused);
  await page.locator('#audioButton').click();
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.modPhases?.[0])).toBeCloseTo(paused[0], 8);
  await page.locator('#copySettings').click();
  expect(await page.evaluate(() => JSON.parse(__copiedSettings).snapshot)).toMatchObject({ branchAngle: 45, lfo1On: true, lfo1Target: 'branchAngle', lfo1Shape: 'rise', lfo1Depth: 1 });
  await page.locator('#restart').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.transport.modPhases[0])).toBe(0);
  await page.locator('#audioButton').click();
});

test('Branches Ping-pong paints the played endpoint at both turns and completion in either direction', async ({ page }) => {
  await page.goto('fractal-synthesis.html');
  await page.locator('[data-mode="grammar"]').click();
  for (const [key, value] of [['depth', 4], ['branch', 0], ['phrase', 4], ['rate', 4]]) await setRange(page, key, value);
  await page.locator('#pingPong').click();
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.armed)).toBe(true);

  // Observe the actual white note centers painted by drawStage, not a copy of
  // its age formula. A sparse graph gives every note a distinct x coordinate.
  await page.evaluate(() => {
    const canvas = document.getElementById('stage'), ctx = canvas.getContext('2d');
    const clear = ctx.clearRect.bind(ctx), arc = ctx.arc.bind(ctx), fill = ctx.fill.bind(ctx);
    let current = null, lastArc = null;
    window.__endpointPaints = [];
    ctx.clearRect = function (...args) {
      const f = __fractalSignals, t = f.transport;
      current = { phase: f.phase, direction: t.travelDirection, time: t.time, playing: f.playing,
        completed: t.completed, now: performance.now(), lit: [], readout: '' };
      __endpointPaints.push(current);
      const frame = current;
      queueMicrotask(() => { frame.readout = document.getElementById('frequencyReadout').textContent; });
      return clear(...args);
    };
    ctx.arc = function (x, y, radius, ...args) { lastArc = { x, y, radius }; return arc(x, y, radius, ...args); };
    ctx.fill = function (...args) {
      if (current && lastArc?.radius === 2 && this.fillStyle === '#f0fff6') {
        const width = canvas.getBoundingClientRect().width;
        const points = __fractalSignals.structure.points;
        let nearest = -1, distance = Infinity;
        points.forEach((point, index) => {
          const delta = Math.abs(24 + point.x * (width - 48) - lastArc.x);
          if (delta < distance) { distance = delta; nearest = index; }
        });
        if (distance < 1) current.lit.push(nearest);
      }
      return fill(...args);
    };
  });

  for (const reverse of [false, true]) for (const loop of [true, false]) {
    if (await page.evaluate(() => __fractalSignals.playing)) await page.locator('#playButton').click();
    if ((await page.evaluate(() => __fractalSignals.state.direction < 0)) !== reverse) await page.locator('#reverse').click();
    if ((await page.evaluate(() => __fractalSignals.state.loop)) !== loop) await page.locator('#loop').click();
    await page.locator('#restart').click();
    const events = await page.evaluate(() => __fractalSignals.structure.events);
    const start = events[0], end = events.at(-1);
    expect(start.phase).toBe(0); expect(end.phase).toBe(1);
    expect(start.point).toBe(reverse ? 4 : 1); expect(end.point).toBe(reverse ? 1 : 4);
    await page.evaluate(() => { __endpointPaints.length = 0; });
    await page.locator('#playButton').click();
    await page.waitForTimeout(2350);
    const paints = await page.evaluate(() => __endpointPaints);
    const farTurn = paints.filter(frame => frame.playing && frame.direction < 0 && frame.phase > .94);
    expect(farTurn.length).toBeGreaterThan(0);
    expect(farTurn.some(frame => frame.lit.includes(end.point))).toBe(true);
    expect(farTurn.every(frame => !frame.lit.includes(start.point))).toBe(true);
    expect(farTurn.some(frame => frame.readout === `score ${Math.round(end.freq)} Hz`)).toBe(true);
    if (loop) {
      const nearTurn = paints.filter(frame => frame.playing && frame.direction > 0 && frame.time > 1.95 && frame.phase < .08);
      expect(nearTurn.length).toBeGreaterThan(0);
      expect(nearTurn.some(frame => frame.lit.includes(start.point))).toBe(true);
      expect(nearTurn.every(frame => !frame.lit.includes(end.point))).toBe(true);
      expect(nearTurn.some(frame => frame.readout === `score ${Math.round(start.freq)} Hz`)).toBe(true);
    } else {
      const completed = paints.filter(frame => frame.completed);
      expect(completed.length).toBeGreaterThan(0);
      expect(completed.some(frame => frame.lit.includes(start.point))).toBe(true);
      expect(completed.every(frame => !frame.lit.includes(end.point))).toBe(true);
      const late = completed.filter(frame => frame.now - completed[0].now > 180);
      expect(late.length).toBeGreaterThan(0);
      expect(late.every(frame => frame.lit.length === 0 && frame.readout.startsWith('root '))).toBe(true);
    }
  }
});

// Direct parameter transports have their own Play buttons. They can preview
// motion while the phrase is paused; only the main transport can sound notes.
test('direct Turns and Scan transports wrap, retain endpoints, and pause without arming Audio', async ({ page }) => {
  await installClipboardFixture(page);
  await page.goto('fractal-synthesis.html#branches');
  await setRange(page, 'turns', 32);
  await setRange(page, 'motionTurnsTempo', 0);
  await page.locator('#motionTurnsOn').click();
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => __fractalSignals.state.turns)).toBe(32);
  expect(await page.evaluate(() => __fractalSignals.motionValues.turns)).toBe(32);
  await setRange(page, 'motionTurnsTempo', 30);
  await expect.poll(() => page.evaluate(() => __fractalSignals.motionValues.turns)).toBeLessThan(24);
  await expect.poll(() => page.evaluate(() => __fractalSignals.motionValues.turns)).toBeGreaterThan(0);
  await page.locator('#motionTurnsOn').click();
  const heldTurns = await page.evaluate(() => __fractalSignals.motionValues.turns);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => __fractalSignals.motionValues.turns)).toBe(heldTurns);
  expect(await page.evaluate(() => __fractalSignals.state.turns)).toBe(32);
  await page.locator('#copySettings').click();
  expect(await page.evaluate(() => JSON.parse(__copiedSettings).snapshot)).toMatchObject({ turns: heldTurns, motionTurnsOn: false });
  await page.locator('#motionTurnsOn').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.motionValues.turns)).not.toBe(heldTurns);
  await page.locator('#motionTurnsOn').click();

  await page.locator('[data-mode="grains"]').click();
  await setRange(page, 'scan', 1);
  await setRange(page, 'motionScanTempo', 0);
  await page.locator('#motionScanOn').click();
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => __fractalSignals.state.scan)).toBe(1);
  expect(await page.evaluate(() => __fractalSignals.motionValues.scan)).toBe(1);
  await setRange(page, 'motionScanTempo', 30);
  await expect.poll(() => page.evaluate(() => __fractalSignals.motionValues.scan)).toBeLessThan(.75);
  await expect.poll(() => page.evaluate(() => __fractalSignals.motionValues.scan)).toBeGreaterThan(0);
  await page.locator('#motionScanOn').click();
  const heldScan = await page.evaluate(() => __fractalSignals.motionValues.scan);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => __fractalSignals.motionValues.scan)).toBe(heldScan);
  expect(await page.evaluate(() => __fractalSignals.state.scan)).toBe(1);
  await page.locator('#copySettings').click();
  expect(await page.evaluate(() => JSON.parse(__copiedSettings).snapshot)).toMatchObject({ scan: heldScan, motionScanOn: false });
  await page.locator('#motionScanOn').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.motionValues.scan)).not.toBe(heldScan);
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(false);
  expect(await page.evaluate(() => __fractalSignals.phase)).toBe(0);
  expect(await page.evaluate(() => __fractalSignals.armed)).toBe(false);
  expect(await page.evaluate(() => __fractalSignals.audio.context)).toBeNull();
});

test('sounding Branching and Turns use the audio clock through stalls, own pause and lifecycle changes', async ({ page }) => {
  test.setTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('fractal-synthesis.html#branches');
  for (const [key, value] of [['branch', 1], ['depth', 6], ['turns', 5], ['rate', 8], ['phrase', 16],
    ['motionBranchTempo', 6], ['motionTurnsTempo', 6]]) await setRange(page, key, value);
  await page.locator('#motionBranchOn').click();
  await page.locator('#motionTurnsOn').click();
  await expect(page.locator('#motionBranchOn')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.motionBankVersion ?? -1)).toBeGreaterThanOrEqual(0);
  const pausedTurns = await page.evaluate(() => __fractalSignals.telemetry.motions.values.turns);
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.motions.values.turns)).not.toBe(pausedTurns);
  const silent = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 50 });
  expect(silent.summary.maxPeak).toBeLessThan(.000001);
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(false);
  expect(await page.evaluate(() => __fractalSignals.phase)).toBe(0);

  await page.locator('#playButton').click();
  const audible = await sampleAudioEnvelope(page, { durationMs: 750, intervalMs: 50 });
  expect(audible.summary.finite).toBe(true);
  expect(audible.summary.maxPeak).toBeGreaterThan(.0005);
  expect(audible.summary.clippedSamples).toBe(0);
  const before = await page.evaluate(() => ({
    time: __fractalSignals.telemetry.time,
    turns: __fractalSignals.telemetry.motions.values.turns,
    branch: __fractalSignals.telemetry.motionValues.branch,
    geometry: JSON.stringify(__fractalSignals.branchGeometry),
  }));
  await page.evaluate(() => { const until = performance.now() + 420; while (performance.now() < until) {} });
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry.time)).toBeGreaterThan(before.time + .3);
  const after = await page.evaluate(() => ({
    time: __fractalSignals.telemetry.time,
    turns: __fractalSignals.telemetry.motions.values.turns,
    branch: __fractalSignals.telemetry.motionValues.branch,
    geometry: JSON.stringify(__fractalSignals.branchGeometry),
  }));
  expect((after.turns - before.turns + 1) % 1).toBeCloseTo((after.time - before.time) * 6 / 60, 3);
  expect(after.branch).not.toBe(before.branch);
  expect(after.geometry).not.toBe(before.geometry);
  expect(after.geometry).not.toBe('null');

  await page.locator('#motionBranchOn').click();
  await page.locator('#motionTurnsOn').click();
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => __fractalSignals.state)).toMatchObject({ branch: 1, turns: 5 });
  const held = await page.evaluate(() => ({ branch: __fractalSignals.motionValues.branch, turns: __fractalSignals.motionValues.turns }));
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => ({ branch: __fractalSignals.motionValues.branch, turns: __fractalSignals.motionValues.turns }))).toEqual(held);
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(true);
  await page.locator('#audioButton').click();
  expect(await page.evaluate(() => ({ branch: __fractalSignals.motionValues.branch, turns: __fractalSignals.motionValues.turns }))).toEqual(held);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.motionValues.turns)).toBeCloseTo(held.turns, 8);
  await expect.poll(() => page.evaluate(() => __fractalSignals.telemetry?.motionValues.branch)).toBeCloseTo(held.branch, 8);
  expect(await page.evaluate(() => __fractalSignals.playing)).toBe(true);

  await page.locator('#motionTurnsOn').click();
  await page.locator('[data-mode="grains"]').click();
  expect(await page.evaluate(() => __fractalSignals.armed && __fractalSignals.playing)).toBe(true);
  await page.locator('[data-mode="grammar"]').click();
  await expect(page.locator('#motionTurnsOn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.header-preset-picker summary').click();
  await page.locator('[data-preset-id="grammar-twig-talk"]').click();
  expect(await page.evaluate(() => __fractalSignals.state)).toMatchObject({ motionBranchOn: false, motionTurnsOn: false, branch: .86, turns: 1.25 });
  expect(await page.evaluate(() => __fractalSignals.armed && __fractalSignals.playing)).toBe(true);
  await page.locator('#audioButton').click();
  expect(errors).toEqual([]);
});

test('Echoes Random auditions every source engine while the real player remains running', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    const original = Math.random;
    window.__echoRandomSeed = null;
    Math.random = () => window.__echoRandomSeed === null ? original()
      : ((window.__echoRandomSeed = (Math.imul(window.__echoRandomSeed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  });
  await page.goto('fractal-synthesis.html#echoes');
  // Select reproducible looping examples without changing their generated
  // controls. Other tests cover finite completion; these audition mid-phrase.
  const cases = await page.evaluate(async () => {
    const { randomizeState } = await import('./src/instruments/fractal-signals/presets.js');
    const current = __fractalSignals.state, found = new Map();
    for (let seed = 1; seed <= 500 && found.size < 3; seed++) {
      let n = seed;
      const state = randomizeState(current, () => ((n = (Math.imul(n, 1664525) + 1013904223) >>> 0) / 2 ** 32));
      if (state.loop && state.depth > 24 && !state.motionBranchOn && !found.has(state.engine)) found.set(state.engine, { seed, engine: state.engine, patchSeed: state.seed });
    }
    return [...found.values()];
  });
  expect(cases.map(item => item.engine).sort()).toEqual(['resonant', 'shepard', 'strikes']);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  const measurements = {};
  for (const item of cases) {
    await setRange(page, 'position', .4);
    await page.evaluate(seed => { __echoRandomSeed = seed; }, item.seed);
    await page.locator('.header-preset-random').click();
    await page.evaluate(() => { __echoRandomSeed = null; });
    expect(await page.evaluate(() => __fractalSignals.state)).toMatchObject({ mode: 'echoes', engine: item.engine, seed: item.patchSeed });
    expect(await page.evaluate(() => __fractalSignals.armed && __fractalSignals.playing)).toBe(true);
    const output = await sampleAudioEnvelope(page, { durationMs: 2400, intervalMs: 50 });
    measurements[item.engine] = output.summary;
    expect(output.summary.finite, item.engine).toBe(true);
    expect(output.summary.maxPeak, item.engine).toBeGreaterThan(.0005);
    expect(output.summary.maxRms, item.engine).toBeGreaterThan(.0003);
    expect(output.summary.clippedSamples, item.engine).toBe(0);
  }
  await page.locator('#audioButton').click();
  await testInfo.attach('random-echoes-audio.json', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
});

// Replaying a completed phrase does not restart independent parameter motion.
test('completed phrase replay preserves independent Turns while Audio is off', async ({ page }) => {
  await page.goto('fractal-synthesis.html#branches');
  for (const [key, value] of [['turns', 8], ['motionTurnsTempo', 6], ['phrase', 1], ['rate', 64]]) await setRange(page, key, value);
  if (await page.evaluate(() => __fractalSignals.state.loop)) await page.locator('#loop').click();
  if (await page.evaluate(() => __fractalSignals.state.pingPong)) await page.locator('#pingPong').click();
  await page.locator('#motionTurnsOn').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.motionValues.turns)).toBeGreaterThan(8.5);
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.transport.completed)).toBe(true);
  const before = await page.evaluate(() => __fractalSignals.motionValues.turns);
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => __fractalSignals.transport.completed)).toBe(true);
  const after = await page.evaluate(() => __fractalSignals.motionValues.turns);
  expect(after).toBeGreaterThanOrEqual(before);
  expect(await page.evaluate(() => __fractalSignals.state.turns)).toBe(8);
  expect(await page.evaluate(() => __fractalSignals.state.motionTurnsOn)).toBe(true);
  expect(await page.evaluate(() => __fractalSignals.armed)).toBe(false);
  expect(await page.evaluate(() => __fractalSignals.audio.context)).toBeNull();
});

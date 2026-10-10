import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';
import { readAudioStatus } from './helpers/audio-probe.mjs';

test.setTimeout(60_000);

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installAudioInputFixture(page);
  await page.addInitScript(() => {
    const qa = globalThis.__graphAudibility = { nodes: [], monitors: [], configure: 0, controls: 0 };
    const Native = AudioWorkletNode;
    globalThis.AudioWorkletNode = new Proxy(Native, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-graph-delay-rust') {
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0; mute.gain.value = 0;
        node.connect(analyser).connect(mute).connect(node.context.destination);
        qa.nodes.push(node); qa.monitors.push(analyser);
        const post = node.port.postMessage.bind(node.port);
        node.port.postMessage = (message, ...rest) => {
          if (message.type === 'configure') qa.configure++;
          if (message.type === 'controls') qa.controls++;
          return post(message, ...rest);
        };
      }
      return node;
    } });
  });
  await page.goto('/graph-delay-rust.html?renderer=canvas');
  await page.waitForFunction(() => Boolean(globalThis.__graphDelayRust));
  return errors;
}

async function native(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function diagnostics(page) {
  return page.evaluate(() => {
    const qa = __graphAudibility, analyser = qa.monitors.at(-1);
    let peak = 0, square = 0, nonFinite = 0, dominantHz = 0;
    if (analyser) {
      const samples = new Float32Array(analyser.fftSize), spectrum = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatTimeDomainData(samples); analyser.getFloatFrequencyData(spectrum);
      for (const value of samples) {
        if (!Number.isFinite(value)) nonFinite++;
        else { peak = Math.max(peak, Math.abs(value)); square += value * value; }
      }
      let strongest = 4;
      for (let bin = 5; bin < spectrum.length; bin++) if (spectrum[bin] > spectrum[strongest]) strongest = bin;
      dominantHz = strongest * analyser.context.sampleRate / analyser.fftSize;
      square /= samples.length;
    }
    return { ...__graphDelayRust.snapshot(), pcm: { peak, rms: Math.sqrt(square), nonFinite, dominantHz },
      qa: { worklets: qa.nodes.length, configure: qa.configure, controls: qa.controls,
        requests: __familyInput.requests, liveTracks: __familyInput.tracks.filter(track => track.readyState === 'live').length } };
  });
}

async function manual(page, ceiling = 0) {
  await page.locator('#liveData').evaluate(details => { details.open = true; });
  await page.locator('#capacityTests').evaluate(details => { details.open = true; });
  await page.locator('#automatic').uncheck();
  await native(page, 'voiceCeiling', ceiling);
}

async function start(page) {
  await page.locator('.mz-input-toggle').click();
  await expect(page.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await diagnostics(page)).metrics?.inputPeak ?? 0).toBeGreaterThan(.01);
}

function expectContinuity(before, after) {
  expect(after.audio).toBe(true); expect(after.microphone).toBe(true);
  expect(after.qa.worklets).toBe(1); expect(after.qa.requests).toBe(1);
  expect(after.qa.liveTracks).toBe(before.qa.liveTracks); expect(after.qa.liveTracks).toBeGreaterThan(0);
  expect(after.metrics.elapsedSeconds).toBeGreaterThan(before.metrics.elapsedSeconds);
  expect(after.pcm.nonFinite).toBe(0); expect(after.pcm.peak).toBeLessThanOrEqual(1);
}

test('a cap below the Island output path explains silent wet audio and All restores it without restarting', async ({ page }, info) => {
  const errors = await open(page);
  await page.locator('.header-preset-picker summary').click();
  await page.locator('button[data-preset-id="islandConstellation"]').click();
  await expect.poll(async () => (await diagnostics(page)).graph.nodes.length).toBe(36);
  for (const [id, value] of [['baseDelay', 20], ['timeScale', 0], ['pitchScale', 0], ['wet', 1], ['dry', 0]]) await native(page, id, value);
  await manual(page, 16); await start(page);
  await expect.poll(async () => (await diagnostics(page)).metrics?.currentActiveRoutes).toBe(16);
  await expect(page.locator('#liveGraphStatus')).toHaveText('Needs 35 turns to reach output; cap allows 16');
  await expect(page.locator('#liveVoiceStatus')).toHaveText('16/41 turns processing · capped');
  await expect(page.locator('#performancePitchRoutes')).toHaveText('0/41 fully shifted');
  await expect.poll(async () => (await diagnostics(page)).pcm.peak).toBeLessThan(1e-6);
  const before = await diagnostics(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const warning = page.locator('#liveGraphStatus'); await warning.scrollIntoViewIfNeeded();
    await expect(warning).toBeVisible();
    const bounds = await warning.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(await warning.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  const capped = await diagnostics(page); expectContinuity(before, capped);
  expect(capped.pcm.peak).toBeLessThan(1e-6);
  await native(page, 'voiceCeiling', 0);
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.metrics?.currentActiveRoutes === 41 && d.pcm.rms > .0001;
  }, { timeout: 15000 }).toBe(true);
  const restored = await diagnostics(page); expectContinuity(before, restored);
  await expect(page.locator('#liveVoiceStatus')).toHaveText('41/41 turns processing');
  await expect(page.locator('#liveGraphStatus')).toBeHidden();
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await info.attach('graph-cap-audibility.json', { contentType: 'application/json', body: JSON.stringify({ capped: capped.pcm, restored: restored.pcm, actualWasm: true, listeningPerformed: false }) });
  await page.locator('#panicButton').click(); expect(errors).toEqual([]);
});

test('pitch and wet knobs alter real old-scene PCM during warmup without cancelling the queued graph', async ({ page }, info) => {
  const errors = await open(page);
  await native(page, 'topology', 'chain'); await native(page, 'nodeCount', 3);
  await expect.poll(async () => (await diagnostics(page)).graph.nodes.length).toBe(3);
  for (const [id, value] of [['baseDelay', 300], ['timeScale', 0], ['nodePass', 1], ['pitchScale', 0], ['pitchCurve', 1], ['pitchSlew', 10], ['wet', 1], ['dry', 0], ['spread', 0]]) await native(page, id, value);
  // Give the first input turn a real angle, using the playable stage itself.
  await page.locator('#stage').focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
  await manual(page); await start(page);
  await expect.poll(async () => (await diagnostics(page)).pcm.rms, { timeout: 10000 }).toBeGreaterThan(.005);
  const before = await diagnostics(page);
  await native(page, 'nodeCount', 24);
  await expect.poll(async () => {
    const m = (await diagnostics(page)).metrics;
    return m?.nodes === 24 && m.warmRemainingSeconds > 4 && m.transitionMix === 0;
  }, { timeout: 10000 }).toBe(true);
  await expect(page.locator('#liveGraphStatus')).toContainText('Previous graph audible');
  await native(page, 'nodeCount', 5);
  await expect.poll(async () => (await diagnostics(page)).metrics?.preparing).toBe(true);
  const queued = await diagnostics(page);
  await native(page, 'pitchScale', 1.3);
  await expect.poll(async () => Math.abs((await diagnostics(page)).pcm.dominantHz - before.pcm.dominantHz), { timeout: 2500 }).toBeGreaterThan(25);
  const pitched = await diagnostics(page);
  expect(pitched.metrics.warmRemainingSeconds).toBeGreaterThan(0); expect(pitched.metrics.transitionMix).toBe(0);
  expectContinuity(before, pitched);
  await native(page, 'wet', .2);
  await expect.poll(async () => (await diagnostics(page)).pcm.rms, { timeout: 2000 }).toBeLessThan(pitched.pcm.rms * .4);
  const quieter = await diagnostics(page);
  expect(quieter.pcm.rms).toBeGreaterThan(pitched.pcm.rms * .03);
  expect(quieter.metrics.preparing).toBe(true); expect(quieter.qa.configure).toBe(queued.qa.configure);
  expect(quieter.qa.controls).toBeGreaterThan(queued.qa.controls);
  const continuation = [];
  await expect.poll(async () => {
    const d = await diagnostics(page);
    continuation.push(d.pcm);
    return d.graph.nodes.length === 5 && d.metrics?.nodes === 5 && !d.metrics.preparing && !d.metrics.retiringActiveRoutes;
  }, { timeout: 20000, intervals: [100, 200] }).toBe(true);
  expect(continuation.every(pcm => pcm.nonFinite === 0 && pcm.peak > .00001)).toBe(true);
  const after = await diagnostics(page); expectContinuity(before, after);
  expect(after.parameters.pitchScale).toBe(1.3); expect(after.parameters.wet).toBe(.2);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await info.attach('graph-live-knob-pcm.json', { contentType: 'application/json', body: JSON.stringify({ before: before.pcm, pitched: pitched.pcm, quieter: quieter.pcm, after: after.pcm, actualWasm: true, listeningPerformed: false }) });
  await page.locator('#panicButton').click(); expect(errors).toEqual([]);
});

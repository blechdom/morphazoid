import { expect, test } from '@playwright/test';
import { readAudioStatus, waitForAudioState, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const amounts = ['turnAmount', 'accentAmount', 'forkAmount', 'curvatureAmount', 'endlessAmount'];
const details = ['turnSpan', 'accentRate', 'forkSpan', 'curvatureDrive'];
const studies = {
  original: [0, 0, 0, 0, 0], turning: [1, 0, 0, 0, 0], accents: [0, 1, 0, 0, 0],
  forks: [0, 0, 1, 0, 0], curvature: [0, 0, 0, 1, 0], endless: [0, 0, 0, 0, 1],
  braid: [.7, .5, .7, 0, 0],
};
const diagnostics = new WeakMap();
test.beforeEach(async ({ page, baseURL }) => diagnostics.set(page, watchPageDiagnostics(page, { baseURL })));
test.afterEach(async ({ page }, info) => {
  await page.evaluate(() => window.__staircaseStudies?.teardown());
  const messages = pageDiagnosticMessages(diagnostics.get(page));
  await info.attach('spiral-browser-diagnostics.json', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages).toEqual([]);
});

const snapshot = page => page.evaluate(() => {
  const state = window.__staircaseStudies.snapshot(), audio = state.audioVoices;
  return { ...state, audioVoices: undefined,
    voices: (state.rhythm?.voices ?? []).filter(voice => voice.presence > .5).map(voice => ({ ...voice,
      audioId: audio[voice.slot * 6], frequency: audio[voice.slot * 6 + 1],
      referenceX: audio[voice.slot * 6 + 2], referenceY: audio[voice.slot * 6 + 3] })) };
});
const amountValues = state => amounts.map(key => state[key]);

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function settled(page) {
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.ready && state.revision === state.acceptedRevision
      && (!state.audio || state.audioRevision === state.revision) && Boolean(state.rhythm);
  }, { timeout: 20_000 }).toBe(true);
}
async function open(page) {
  await page.goto('/striped-staircase-rust.html'); await settled(page);
  await expect(page.locator('#spiralStudy')).toHaveValue('original');
  expect(amountValues(await snapshot(page))).toEqual(studies.original);
}
async function sound(page, { hold = false } = {}) {
  if (hold) await page.locator('#holdButton').click();
  await page.locator('#audioButton').click(); await page.locator('#playButton').click();
  await settled(page); await waitForAudioState(page, true);
}

// Captures the actual shared output. Graph continuity is distinct from a
// physical-device loopback or a human judgment of these musical mappings.
async function captureOutput(page, { durationMs = 1400, stall = false } = {}) {
  return page.evaluate(async ({ durationMs, stall }) => {
    const { OutputRecorder } = await import('/src/output-recorder.js');
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager(), recorder = new OutputRecorder({ manager });
    const context = manager.recordingContext(), rows = [];
    let timer;
    const read = () => {
      const s = window.__staircaseStudies.snapshot();
      rows.push({ clock: s.clock, progress: s.progress, white: s.audioWhite, voices: s.audioBranches,
        mapped: s.rhythm?.tendrils, mode: s.mode, audio: s.audio, playing: s.playing, hold: s.hold });
    };
    try {
      await recorder.start(); const start = context.currentTime; read(); timer = setInterval(read, 30);
      let stallSeconds = 0;
      if (stall) {
        await new Promise(resolve => setTimeout(resolve, 250));
        const before = context.currentTime, until = performance.now() + 300;
        while (performance.now() < until) { /* UI stalls must not own synthesis. */ }
        stallSeconds = context.currentTime - before;
        await new Promise(resolve => setTimeout(resolve, 250));
      } else await new Promise(resolve => setTimeout(resolve, durationMs));
      clearInterval(timer); read(); const elapsed = context.currentTime - start;
      const take = await recorder.stop(), bytes = new Uint8Array(await take.blob.arrayBuffer());
      const frames = (bytes.length - 44) / 6, window = Math.round(take.sampleRate * .01), rms = [];
      let sum = 0, peak = 0, difference = 0, roughness = 0, previous = 0;
      for (let frame = 0; frame < frames; frame++) {
        const at = 44 + frame * 6;
        const left = ((bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16) << 8 >> 8) / 8388608;
        const right = ((bytes[at + 3] | bytes[at + 4] << 8 | bytes[at + 5] << 16) << 8 >> 8) / 8388608;
        sum += left * left; roughness += (left - previous) ** 2; previous = left;
        peak = Math.max(peak, Math.abs(left), Math.abs(right)); difference = Math.max(difference, Math.abs(left - right));
        if ((frame + 1) % window === 0) { rms.push(Math.sqrt(sum / window)); sum = 0; }
      }
      let binary = '';
      for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
      return { wav: btoa(binary), error: take.error, frames, sampleRate: take.sampleRate,
        seconds: frames / take.sampleRate, elapsed, stallSeconds, rows, rms, peak, difference, roughness: roughness / frames };
    } finally { clearInterval(timer); await recorder.destroy(); recorder.discard(); }
  }, { durationMs, stall });
}
async function attachCapture(info, name, capture) {
  const { wav, ...evidence } = capture;
  await info.attach(`${name}.wav`, { body: Buffer.from(wav, 'base64'), contentType: 'audio/wav' });
  await info.attach(`${name}.json`, { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
}
function expectSound(capture) {
  expect(capture.error).toBe(''); expect(capture.peak).toBeGreaterThan(.00001); expect(capture.peak).toBeLessThan(1);
  expect(capture.rms.every(Number.isFinite)).toBe(true); expect(capture.difference).toBe(0);
  expect(Math.abs(capture.seconds - capture.elapsed)).toBeLessThan(.05);
}

test('study choices and blends preserve live transport and independent mapping controls', async ({ page }, info) => {
  test.setTimeout(90_000);
  await open(page); await page.locator('#spiralTuning > summary').click();
  await page.locator('#playButton').click();
  await page.locator('#spiralStudy').selectOption('turning');
  expect((await snapshot(page)).audio).toBe(false);
  await page.locator('#holdButton').click(); await range(page, 'progress', .175);
  for (const [key, value] of Object.entries({ turnSpan: 2.1, accentRate: 7, forkSpan: 3, curvatureDrive: 2.5 })) await range(page, key, value);
  await page.locator('#endlessDirection').selectOption('1');
  await page.locator('#audioButton').click(); await settled(page); await waitForAudioState(page, true);
  const initial = await snapshot(page), evidence = [];
  const preserved = ['turnSpan', 'accentRate', 'forkSpan', 'curvatureDrive', 'endlessDirection',
    'speed', 'baseFrequency', 'brightness', 'body', 'level', 'pitchSource', 'pitchMapping', 'pitchSpan', 'voiceLimit'];
  for (const [id, expected] of Object.entries(studies)) {
    const before = await snapshot(page); await page.locator('#spiralStudy').selectOption(id);
    await expect.poll(async () => (await snapshot(page)).clock).toBeGreaterThan(before.clock);
    const state = await snapshot(page); expect(amountValues(state)).toEqual(expected);
    await expect(page.locator('#spiralStudy')).toHaveValue(id);
    expect(state).toMatchObject({ audio: true, playing: true, hold: true, mode: 2 });
    expect(state.progress).toBeCloseTo(initial.progress, 8); expect(state.camera).toEqual(initial.camera);
    expect(state.revision).toBe(initial.revision);
    for (const key of preserved) expect(state[key], `${id} preserves ${key}`).toBe(initial[key]);
    evidence.push({ id, state });
  }
  for (const id of ['turning', 'accents', 'forks', 'curvature', 'endless']) {
    await page.locator(`[data-study="${id}"]`).click();
    expect(amountValues(await snapshot(page))).toEqual(studies[id]);
    await expect(page.locator('#spiralStudy')).toHaveValue(id);
  }
  await page.locator('#spiralStudy').selectOption('original');
  for (let index = 0; index < amounts.length; index++) {
    const key = amounts[index], exclusive = ['turning', 'accents', 'forks', 'curvature', 'endless'][index];
    for (const value of [.5, 1, 0]) {
      await range(page, key, value); expect((await snapshot(page))[key]).toBe(value);
      await expect(page.locator('#spiralStudy')).toHaveValue(value === 0 ? 'original' : value === 1 ? exclusive : 'custom');
    }
  }
  await range(page, 'turnAmount', .35); await range(page, 'curvatureAmount', .6);
  await expect(page.locator('#spiralStudy')).toHaveValue('custom');
  expect((await snapshot(page))).toMatchObject({ turnAmount: .35, curvatureAmount: .6, audio: true, playing: true });
  await page.locator('#resetAll').click(); await settled(page);
  await expect(page.locator('#spiralStudy')).toHaveValue('original');
  expect(await snapshot(page)).toMatchObject({ turnAmount: 0, turnSpan: 1, accentAmount: 0, accentRate: 4,
    forkAmount: 0, forkSpan: 2, curvatureAmount: 0, curvatureDrive: 1, endlessAmount: 0, endlessDirection: -1, audio: true, playing: false });
  await info.attach('spiral-selection-continuity.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('all five studies carry real contour features into finite moving-stripe output', async ({ page }, info) => {
  test.setTimeout(90_000);
  await open(page); await page.locator('#branchingPassage').click(); await settled(page);
  const passageDepth = (await snapshot(page)).progress;
  await range(page, 'speed', .05); await sound(page);
  const evidence = [];
  for (const id of Object.keys(studies)) {
    await page.locator('#spiralStudy').selectOption(id); await range(page, 'progress', passageDepth);
    const capture = await captureOutput(page); expectSound(capture);
    expect(capture.rows.some(row => row.white)).toBe(true);
    expect(capture.rows.some(row => !row.white)).toBe(true);
    expect(capture.rows.at(-1).clock).toBeGreaterThan(capture.rows[0].clock);
    expect(capture.rows.every(row => row.audio && row.playing && !row.hold && row.mode === 2)).toBe(true);
    const state = await snapshot(page);
    expect(amountValues(state)).toEqual(studies[id]); expect(state.voices.length).toBeGreaterThan(0);
    for (const voice of state.voices) {
      for (const key of ['signedTurns', 'forkOffset', 'curvature', 'travelTurns', 'confidence']) {
        expect(Number.isFinite(voice.feature?.[key]), `${id}: finite ${key}`).toBe(true);
      }
      expect(voice.feature.confidence).toBeGreaterThanOrEqual(0); expect(voice.feature.confidence).toBeLessThanOrEqual(1);
      expect(Number.isFinite(voice.frequency)).toBe(true);
    }
    await attachCapture(info, `moving-${id}`, capture);
    evidence.push({ id, state });
  }
  await info.attach('moving-study-feature-state.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('held measured turns and certified forks blend into the actual carrier pitch', async ({ page }, info) => {
  test.setTimeout(60_000);
  await open(page); const originalSettings = (await snapshot(page)).settings;
  await page.locator('#holdButton').click();
  await range(page, 'pitchSpan', 2);
  await page.locator('#audioButton').click(); await page.locator('#playButton').click();
  await settled(page); await waitForAudioState(page, true);
  await range(page, 'maxIterations', 200); await settled(page);
  const beforePassage = await snapshot(page);
  await page.locator('#branchingPassage').click(); await settled(page);
  const passage = await snapshot(page);
  for (const key of ['audio', 'playing', 'hold', 'speed', 'baseFrequency', 'level', 'turnSpan', 'accentRate', 'forkSpan', 'curvatureDrive', 'endlessDirection']) {
    expect(passage[key], `branching passage preserves ${key}`).toBe(beforePassage[key]);
  }
  expect(passage).toMatchObject({ view: 'spiral', pitchSource: 1, voiceLimit: 32, forkAmount: 1 });
  expect(passage.settings).toEqual(originalSettings);
  expect(passage.progress).toBeCloseTo(51 / 63, 8);
  expect(passage.rhythm.tendrils).toBeGreaterThan(0); expect(passage.rhythm.tendrils).toBeLessThanOrEqual(16);
  await page.locator('#spiralStudy').selectOption('original');
  await page.locator('#spiralTuning > summary').click();
  await range(page, 'turnSpan', 1.5); await range(page, 'forkSpan', 2);
  await settled(page); await waitForAudioState(page, true); await page.waitForTimeout(500);
  const sampleRate = await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    return getSharedAudioOutputManager().recordingContext().sampleRate;
  });
  const baseline = await snapshot(page);
  const live = baseline.voices.filter(voice => voice.audioId === voice.id && voice.feature?.confidence > 0);
  expect(live.length).toBeGreaterThan(0);
  expect(Math.max(...live.map(voice => Math.abs(voice.feature.forkOffset)))).toBeGreaterThan(.05);
  expect(Math.max(...live.map(voice => Math.abs(voice.feature.signedTurns)))).toBeGreaterThan(.02);
  const baselineOffsets = new Map(live.map(voice => [voice.id, Math.log2(voice.frequency / baseline.baseFrequency)]));
  const evidence = [{ amounts: [0, 0], state: baseline }];
  for (const [turnAmount, forkAmount] of [[.5, 0], [1, 0], [0, .5], [0, 1], [.4, .7], [0, 0]]) {
    await range(page, 'turnAmount', turnAmount); await range(page, 'forkAmount', forkAmount);
    // Feature and control smoothing has an approximately 18 ms time constant.
    await page.waitForTimeout(500);
    const state = await snapshot(page);
    expect(state.progress).toBeCloseTo(baseline.progress, 8);
    expect(state.revision).toBe(baseline.revision); expect(state.audioWhite).toBe(true);
    expect(state.clock).toBeGreaterThan(evidence.at(-1).state.clock);
    for (const voice of state.voices.filter(voice => baselineOffsets.has(voice.id))) {
      expect(voice.audioId).toBe(voice.id);
      const { signedTurns, forkOffset } = voice.feature;
      const geometry = Math.max(-6, Math.min(6, turnAmount * state.turnSpan * signedTurns + forkAmount * state.forkSpan * forkOffset));
      const offset = baselineOffsets.get(voice.id) * (1 - Math.max(turnAmount, forkAmount)) + geometry;
      const expectedHz = Math.max(20, Math.min(state.baseFrequency * 2 ** offset, sampleRate * .42));
      expect(Math.abs(Math.log2(voice.frequency / expectedHz)), `carrier ${voice.id}, turns ${turnAmount}, forks ${forkAmount}`).toBeLessThan(.003);
    }
    evidence.push({ amounts: [turnAmount, forkAmount], state });
  }
  await page.locator('#spiralStudy').selectOption('forks'); await page.waitForTimeout(500);
  const capture = await captureOutput(page, { durationMs: 800 }); expectSound(capture);
  await attachCapture(info, 'held-certified-fork', capture);
  await page.locator('#stage').screenshot({ path: info.outputPath('certified-fork-contours.png') });
  await info.attach('held-carrier-feature-equations.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('a dense blend retains audio through a UI stall and obeys black, level, Pause and Audio gates', async ({ page }, info) => {
  test.setTimeout(90_000);
  await open(page); await page.locator('#holdButton').click();
  await page.locator('#pitchSource').selectOption('0'); await page.locator('#viewPreset').selectOption('double-spiral');
  await range(page, 'voiceLimit', 512); await range(page, 'progress', .723); await settled(page);
  for (const key of amounts) await range(page, key, 1);
  await page.locator('#spiralTuning > summary').click();
  for (const [key, value] of Object.entries({ turnSpan: 3, accentRate: 32, forkSpan: 4, curvatureDrive: 4 })) await range(page, key, value);
  await page.locator('#audioButton').click(); await page.locator('#playButton').click(); await settled(page);
  await waitForAudioState(page, true);
  await expect.poll(async () => (await snapshot(page)).audioBranches).toBeGreaterThan(256);
  const before = await snapshot(page), capture = await captureOutput(page, { stall: true });
  expectSound(capture); expect(capture.stallSeconds).toBeGreaterThan(.2); expect(capture.seconds).toBeGreaterThan(.7);
  expect(Math.min(...capture.rms.slice(1, -1))).toBeGreaterThan(.00001);
  expect(capture.rows.at(-1).clock - capture.rows[0].clock).toBeGreaterThan(capture.sampleRate * .6);
  expect((await snapshot(page)).progress).toBeCloseTo(before.progress, 8);
  await attachCapture(info, 'dense-blend-ui-stall', capture);
  await range(page, 'progress', .19); await expect.poll(async () => (await snapshot(page)).audioWhite).toBe(false);
  await waitForStableAudioState(page, false);
  await range(page, 'progress', .723); await waitForAudioState(page, true);
  await range(page, 'level', 0); await waitForStableAudioState(page, false);
  await range(page, 'level', .35); await waitForAudioState(page, true);
  await page.locator('#playButton').click(); await waitForStableAudioState(page, false);
  await page.locator('#playButton').click(); await waitForAudioState(page, true);
  await page.locator('#holdButton').click();
  const mutedAt = await snapshot(page); await page.locator('#audioButton').click(); await waitForStableAudioState(page, false);
  await expect.poll(async () => (await snapshot(page)).clock).toBeGreaterThan(mutedAt.clock);
  expect(await snapshot(page)).toMatchObject({ audio: false, playing: true, hold: false });
  expect((await readAudioStatus(page)).clipped).toBe(false);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`spiral studies ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440, isMobile: viewport.width !== 1440 });
    test('all study controls stay reachable and mapped counts survive comparison', async ({ page }, info) => {
      test.setTimeout(60_000);
      await open(page); await page.locator('#spiralTuning > summary').click();
      const selectors = ['#spiralStudy', '#branchingPassage', ...[...amounts, ...details, 'endlessDirection'].map(id => `#${id}`),
        ...['turning', 'accents', 'forks', 'curvature', 'endless'].map(id => `[data-study="${id}"]`)];
      for (const selector of selectors) {
        const control = page.locator(selector); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        expect(await control.evaluate(element => {
          const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.left >= -2 && box.right <= innerWidth + 2 && (hit === element || element.contains(hit));
        }), `${selector} can be reached`).toBe(true);
      }
      for (const id of [...amounts, ...details]) {
        const control = page.locator(`#${id}`), before = Number(await control.inputValue());
        await control.press('ArrowUp'); expect(Number(await control.inputValue())).toBeGreaterThan(before);
        expect((await snapshot(page))[id]).toBe(Number(await control.inputValue()));
        expect(await control.evaluate(input => input.parentElement.classList.contains('mz-range-knob'))).toBe(true);
      }
      const before = await snapshot(page); await page.locator('[data-study="endless"]').click();
      await expect(page.locator('#spiralStudy')).toHaveValue('endless');
      expect((await snapshot(page)).audio).toBe(false);
      await expect(page.locator('#tendrilCount')).toHaveText(String(before.rhythm.tendrils));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
      if (viewport.width !== 1440) {
        const client = await page.context().newCDPSession(page), notes = page.locator('#spiralDescription');
        await notes.scrollIntoViewIfNeeded(); const box = await notes.boundingBox();
        const start = await page.evaluate(() => document.documentElement.scrollTop + document.body.scrollTop);
        const x = Math.round(box.x + box.width / 2), y = Math.round(box.y + box.height / 2);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 6; step++) {
          await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 16 }] });
          await page.waitForTimeout(20);
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollTop + document.body.scrollTop)).toBeGreaterThan(start + 20);
      }
      await page.locator('#spiralControls').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('spiral-controls.png'), fullPage: true });
    });
  });
}

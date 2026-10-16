import { expect, test } from '@playwright/test';
import { waitForAudioState, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const diagnostics = new WeakMap();
test.beforeEach(async ({ page, baseURL }) => diagnostics.set(page, watchPageDiagnostics(page, { baseURL })));
test.afterEach(async ({ page }, info) => {
  await page.evaluate(() => window.__staircaseStudies?.teardown());
  const messages = pageDiagnosticMessages(diagnostics.get(page));
  await info.attach('path-browser-diagnostics.json', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages).toEqual([]);
});
const snapshot = page => page.evaluate(() => {
  const state = window.__staircaseStudies.snapshot();
  return { ...state, audioVoices: undefined, voices: (state.rhythm?.voices ?? []).map(voice => ({ ...voice,
    audioId: state.audioVoices[voice.slot * 6], frequency: state.audioVoices[voice.slot * 6 + 1] })) };
});
const groupId = (state, marker) => state.pitchSource === 1 ? marker.tendrilId : marker.voiceId;
const focused = state => state.pathDisplay.focusedTendril;
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
      && (!state.audio || state.audioRevision === state.revision) && Boolean(state.rhythm && state.pathDisplay);
  }, { timeout: 20_000 }).toBe(true);
}
async function open(page) {
  await page.goto('/striped-staircase-rust.html'); await settled(page);
  await expect(page.locator('#showPaths')).toBeChecked();
  await expect(page.locator('#showStripes')).toBeChecked();
  await expect(page.locator('#stripeGate')).toBeChecked();
  await expect(page.locator('#tendrilFocus')).toHaveValue('all');
}
async function heldSound(page) {
  await page.locator('#holdButton').click(); await page.locator('#audioButton').click(); await page.locator('#playButton').click();
  await settled(page); await waitForAudioState(page, true);
}
async function observeControls(page) {
  await page.evaluate(async () => {
    const { StaircaseEngine } = await import('/src/instruments/striped-staircase-rust/engine.js');
    const original = StaircaseEngine.prototype.send;
    window.__pathControlMessages = [];
    StaircaseEngine.prototype.send = function (data, transfer) {
      if (data.type === 'controls') window.__pathControlMessages.push({ focusFirst: data.focusFirst, focusSecond: data.focusSecond, stripeGate: data.stripeGate });
      return original.call(this, data, transfer);
    };
  });
}
const lastControls = page => page.evaluate(() => window.__pathControlMessages.at(-1));
async function chooseMapped(page) {
  const state = await snapshot(page), marker = state.pathDisplay.markers[0];
  expect(marker).toBeTruthy(); const id = groupId(state, marker);
  await page.locator('#tendrilFocus').selectOption(String(id));
  await expect.poll(async () => focused(await snapshot(page))).toBe(id);
  return id;
}
function expectFocusedMarkers(state, id, count) {
  const markers = state.pathDisplay.markers.filter(marker => marker.focused);
  expect(markers).toHaveLength(count);
  expect(markers.every(marker => groupId(state, marker) === id)).toBe(true);
  return markers;
}

// This records production shared-output PCM. Excluded-ID isolation is proved by
// the DSP tests; mapped voice metadata alone is not an envelope/active-voice probe.
async function capture(page, info, name) {
  const result = await page.evaluate(async () => {
    const { OutputRecorder } = await import('/src/output-recorder.js');
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const recorder = new OutputRecorder({ manager: getSharedAudioOutputManager() });
    try {
      await recorder.start(); await new Promise(resolve => setTimeout(resolve, 650));
      const take = await recorder.stop(), bytes = new Uint8Array(await take.blob.arrayBuffer());
      let sum = 0, peak = 0, difference = 0;
      const frames = (bytes.length - 44) / 6;
      for (let frame = 0; frame < frames; frame++) {
        const at = 44 + frame * 6;
        const left = ((bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16) << 8 >> 8) / 8388608;
        const right = ((bytes[at + 3] | bytes[at + 4] << 8 | bytes[at + 5] << 16) << 8 >> 8) / 8388608;
        sum += left * left; peak = Math.max(peak, Math.abs(left), Math.abs(right)); difference = Math.max(difference, Math.abs(left - right));
      }
      let binary = '';
      for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
      return { wav: btoa(binary), frames, sampleRate: take.sampleRate, error: take.error, rms: Math.sqrt(sum / frames), peak, difference };
    } finally { await recorder.destroy(); recorder.discard(); }
  });
  const { wav, ...evidence } = result;
  await info.attach(`${name}.wav`, { body: Buffer.from(wav, 'base64'), contentType: 'audio/wav' });
  await info.attach(`${name}.json`, { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  expect(result.error).toBe(''); expect(result.frames).toBeGreaterThan(result.sampleRate * .5);
  expect(Number.isFinite(result.rms)).toBe(true); expect(result.rms).toBeGreaterThan(.00001);
  expect(result.peak).toBeLessThan(1); expect(result.difference).toBe(0);
  return evidence;
}

test('path and stripe visibility change only the display while the sound clock continues', async ({ page }, info) => {
  test.setTimeout(60_000);
  await open(page); await heldSound(page); await chooseMapped(page); await page.waitForTimeout(300);
  const initial = await snapshot(page);
  expect(initial.pathDisplay.visible).toBe(true); expect(initial.pathDisplay.pathCount).toBeGreaterThan(0);
  const visibleCanvas = await page.locator('#stage').screenshot();
  const evidence = [];
  for (const id of ['showPaths', 'showStripes']) for (const checked of [false, true]) {
    const before = await snapshot(page); await page.locator(`#${id}`).setChecked(checked);
    await expect.poll(async () => (await snapshot(page)).clock).toBeGreaterThan(before.clock);
    const state = await snapshot(page);
    if (id === 'showPaths') expect(state.pathDisplay.visible).toBe(checked);
    if (id === 'showStripes') expect(state.showStripes).toBe(checked);
    expect(state).toMatchObject({ audio: true, playing: true, hold: true });
    expect(state.progress).toBeCloseTo(initial.progress, 8); expect(state.revision).toBe(initial.revision);
    expect(state.camera).toEqual(initial.camera); expect(focused(state)).toBe(focused(initial));
    for (const voice of state.voices.filter(voice => voice.audioId === voice.id)) {
      const prior = initial.voices.find(old => old.id === voice.id);
      if (prior?.frequency > 0) expect(voice.frequency).toBeCloseTo(prior.frequency, 5);
    }
    if (!checked) {
      await page.waitForTimeout(200);
      const hiddenCanvas = await page.locator('#stage').screenshot();
      expect(hiddenCanvas.equals(visibleCanvas), `${id} changes the held field display`).toBe(false);
      await info.attach(`${id}-off.png`, { body: hiddenCanvas, contentType: 'image/png' });
    }
    await waitForAudioState(page, true); evidence.push({ control: id, checked, state });
  }
  await capture(page, info, 'focused-visibility-toggles');
  await info.attach('display-only-controls.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('focus follows the selected two edge voices or one center voice without restarting transport', async ({ page }, info) => {
  test.setTimeout(60_000);
  await open(page); await observeControls(page); await heldSound(page);
  const before = await snapshot(page), id = await chooseMapped(page);
  await page.waitForTimeout(300); let state = await snapshot(page);
  const markers = expectFocusedMarkers(state, id, 2);
  const pairControls = await lastControls(page);
  expect([pairControls.focusFirst, pairControls.focusSecond].sort((a, b) => a - b)).toEqual(markers.map(marker => marker.voiceId).sort((a, b) => a - b));
  expect(new Set(markers.map(marker => marker.side))).toEqual(new Set([0, 1]));
  expect(state.clock).toBeGreaterThan(before.clock); expect(state.progress).toBeCloseTo(before.progress, 8);
  await expect(page.locator('#focusReadout')).toContainText(String(id));
  await expect(page.locator('#focusReadout')).toContainText(/two voices|2 voices/i);
  await expect(page.locator('#focusReadout')).not.toContainText(/\bHz\b/);
  await capture(page, info, 'focused-edge-pair');
  const carriers = new Map(state.voices.filter(voice => voice.tendrilId === id && voice.audioId === voice.id).map(voice => [voice.id, voice.frequency]));
  expect(carriers.size).toBe(2);
  await range(page, 'speed', .02); await page.locator('#holdButton').click();
  await expect.poll(async () => {
    const moving = await snapshot(page);
    return moving.voices.some(voice => carriers.has(voice.id) && voice.audioId === voice.id && Math.abs(voice.frequency - carriers.get(voice.id)) > .0001);
  }).toBe(true);
  await page.locator('#holdButton').click();
  await page.locator('#allTendrils').click(); await expect(page.locator('#tendrilFocus')).toHaveValue('all');
  expect(focused(await snapshot(page))).toBe(null);
  await range(page, 'progress', .175); await page.locator('#pitchSource').selectOption('0'); await settled(page);
  const centerId = await chooseMapped(page); await page.waitForTimeout(300); state = await snapshot(page);
  expectFocusedMarkers(state, centerId, 1);
  expect(await lastControls(page)).toMatchObject({ focusFirst: centerId, focusSecond: 0 });
  await expect(page.locator('#focusReadout')).toContainText(/one voice|1 voice/i);
  await expect(page.locator('#pathLegend')).not.toContainText(/two edge voices/i);
  await capture(page, info, 'focused-center-voice');
});

test('stripe gating is independent of visibility and focus survives an absent depth', async ({ page }, info) => {
  test.setTimeout(60_000);
  await open(page); await heldSound(page); await range(page, 'progress', .19);
  await expect.poll(async () => (await snapshot(page)).audioWhite).toBe(false);
  await waitForStableAudioState(page, false);
  const id = await chooseMapped(page), initial = await snapshot(page);
  await page.locator('#showStripes').uncheck(); await waitForStableAudioState(page, false);
  await page.locator('#stripeGate').uncheck(); await waitForAudioState(page, true);
  let state = await snapshot(page); expectFocusedMarkers(state, id, 2);
  expect(state.stripeGate).toBe(false); expect(state.audioWhite).toBe(false); expect(state.progress).toBeCloseTo(initial.progress, 8);
  expect(state.clock).toBeGreaterThan(initial.clock); expect(state.revision).toBe(initial.revision);
  await capture(page, info, 'focused-black-with-gate-off');
  await page.locator('#stripeGate').check(); await waitForStableAudioState(page, false);
  expect(focused(await snapshot(page))).toBe(id);
  await range(page, 'progress', .05); await page.waitForTimeout(150);
  await expect(page.locator('#tendrilFocus')).toHaveValue(String(id));
  await expect(page.locator('#focusReadout')).toContainText(/absent|not mapped|not present|outside|waiting/i);
  await expect(page.locator('#focusReadout')).not.toContainText(/\bHz\b/);
  await range(page, 'progress', .19); await page.locator('#stripeGate').uncheck(); await waitForAudioState(page, true);
  expectFocusedMarkers(await snapshot(page), id, 2);
});

test('a marker tap focuses its stable identity while a drag pans and clears scene focus', async ({ page }, info) => {
  test.setTimeout(60_000);
  await open(page); await page.locator('#stage').scrollIntoViewIfNeeded();
  const state = await snapshot(page), box = await page.locator('#stage').boundingBox();
  const marker = state.pathDisplay.markers.find(marker => marker.x > .05 && marker.x < .95 && marker.y > .27 && marker.y < .85);
  expect(marker).toBeTruthy(); const id = groupId(state, marker), x = box.x + marker.x * box.width, y = box.y + marker.y * box.height;
  await page.mouse.click(x, y); await expect(page.locator('#tendrilFocus')).toHaveValue(String(id));
  expect((await snapshot(page)).camera).toEqual(state.camera); expect((await snapshot(page)).audio).toBe(false);
  await page.screenshot({ path: info.outputPath('focused-marker.png') });
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 48, y + 24, { steps: 5 }); await page.mouse.up();
  await settled(page); const panned = await snapshot(page);
  expect(panned.camera).not.toEqual(state.camera); expect(panned.revision).toBeGreaterThan(state.revision);
  expect(focused(panned)).toBe(null); await expect(page.locator('#tendrilFocus')).toHaveValue('all');
  // Queue a real scene change and try the stale native-select event in the
  // same task, before any worker reply can be delivered. No worker/DSP mocking.
  const pending = await page.evaluate(() => {
    const select = document.querySelector('#tendrilFocus'), stale = select.options[1]?.value;
    if (!stale) throw new Error('Expected a mapped path before the scene change');
    document.querySelector('#zoomIn').click();
    const before = window.__staircaseStudies.snapshot(), disabled = select.disabled;
    select.value = stale; select.dispatchEvent(new Event('change', { bubbles: true }));
    const after = window.__staircaseStudies.snapshot();
    return { pending: before.acceptedRevision !== before.revision, disabled, focusedTendril: after.focusedTendril };
  });
  expect(pending).toEqual({ pending: true, disabled: true, focusedTendril: null });
  await settled(page); await expect(page.locator('#tendrilFocus')).toBeEnabled();
  await expect(page.locator('#tendrilFocus')).toHaveValue('all');
});

test('pitch contribution explains the base reference and its turning and fork blend', async ({ page }) => {
  await open(page);
  await expect(page.locator('#pitchContribution')).toContainText(/\b100%/);
  await expect(page.locator('#pitchMapping option[value="2"]')).toHaveText(/note.to.note/i);
  await page.locator('#spiralStudy').selectOption('turning');
  await expect(page.locator('#pitchContribution')).toContainText(/\b0%/);
  await expect(page.locator('#pitchContribution')).toContainText(/turn/i);
  await range(page, 'turnAmount', .5); await expect(page.locator('#pitchContribution')).toContainText(/\b50%/);
  await page.locator('#spiralStudy').selectOption('forks'); await expect(page.locator('#pitchContribution')).toContainText(/\b0%/);
  await range(page, 'forkAmount', .5); await expect(page.locator('#pitchContribution')).toContainText(/\b50%/);
  await page.locator('#spiralStudy').selectOption('original'); await expect(page.locator('#pitchContribution')).toContainText(/\b100%/);
  expect((await snapshot(page)).audio).toBe(false);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`path controls ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440, isMobile: viewport.width !== 1440 });
    test('legend, focus, stripe switches and contribution remain readable and reachable', async ({ page }, info) => {
      test.setTimeout(60_000); await open(page);
      const stageLayout = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { legend: rect('#stageLegend'), rhythm: rect('#rhythmReadout'), actions: rect('.view-actions') };
      });
      expect(stageLayout.legend.top, 'canvas legend clears the rhythm readout').toBeGreaterThanOrEqual(stageLayout.rhythm.bottom + 4);
      expect(stageLayout.legend.right <= stageLayout.actions.left - 4 || stageLayout.legend.bottom <= stageLayout.actions.top - 4,
        'canvas legend clears the zoom buttons').toBe(true);
      await info.attach('stage-label-layout.json', { body: JSON.stringify(stageLayout, null, 2), contentType: 'application/json' });
      for (const selector of ['#showPaths', '#showStripes', '#stripeGate', '#tendrilFocus', '#allTendrils', '#pathLegend', '#focusReadout', '#pitchContribution']) {
        const locator = page.locator(selector); await locator.scrollIntoViewIfNeeded(); await expect(locator).toBeVisible();
        expect(await locator.evaluate(element => {
          const box = element.getBoundingClientRect();
          return box.width > 1 && box.height > 1 && box.left >= -2 && box.right <= innerWidth + 2;
        }), `${selector} fits the viewport`).toBe(true);
      }
      const legend = page.locator('#pathLegend');
      for (const word of [/colo[u]?r/i, /●/, /◆/, /filled/i, /rest/i]) await expect(legend).toContainText(word);
      const id = await chooseMapped(page); await expect(page.locator('#focusReadout')).toContainText(String(id));
      await page.locator('#allTendrils').click(); await expect(page.locator('#tendrilFocus')).toHaveValue('all');
      await page.locator('#showPaths').uncheck(); await expect.poll(async () => (await snapshot(page)).pathDisplay.visible).toBe(false);
      await page.locator('#showPaths').check();
      expect((await snapshot(page)).audio).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
      await legend.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('path-controls.png'), fullPage: true });
    });
  });
}

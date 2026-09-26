import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const voices = ['drums', 'bass', 'arp', 'lead', 'upperOne', 'upperTwo', 'noise'];
const pitched = ['bass', 'arp', 'lead', 'upperOne', 'upperTwo'];
const parts = ['kick', 'snare', 'hats', 'shaker'];
const levelKeys = { drums: 'drumMix', arp: 'arpLevel', lead: 'leadLevel', upperOne: 'upperOneLevel', upperTwo: 'upperTwoLevel', noise: 'noiseLevel',
  kick: 'kickLevel', snare: 'snareLevel', hats: 'hatLevel', shaker: 'shakerLevel' };
const layouts = [
  { name: 'desktop', width: 1440, height: 900, coarse: false },
  { name: 'phone portrait', width: 390, height: 844, coarse: true },
  { name: 'phone landscape', width: 844, height: 390, coarse: true },
];
async function capture(page) {
  return page.evaluate(async () => (await import('./src/families/chiptune/chiptune-app.js')).captureChiptuneState());
}
async function openDeck(page, baseURL) {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  expect((await page.goto('simd-chiptune.html', { waitUntil: 'domcontentloaded' }))?.ok()).toBe(true);
  await settlePage(page);
  await expect(page.locator('#simdGlobalTabs [role="tab"]')).toHaveCount(4);
  await expect(page.locator('[data-voice-view]')).toHaveCount(7);
  return diagnostics;
}
async function showControls(page, voice) {
  const toggle = page.locator(`[data-voice-view="${voice}"]`);
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await expect(page.locator(`.simd-voice-controls[data-voice="${voice}"]`)).toBeVisible();
}
const stepDial = (page, lane) => page.locator(`[data-sequence-lane="${lane}"] [data-sequence-param="Steps"] [role="slider"]`);
async function setSteps(page, lane, value) {
  await showControls(page, parts.includes(lane) ? 'drums' : lane);
  if (parts.includes(lane)) await page.locator('#tab-drums-' + lane).click();
  const dial = stepDial(page, lane);
  await dial.press('Home');
  for (let i = 0; i < Math.floor((value - 1) / 5); i += 1) await dial.press('PageUp');
  for (let i = 0; i < (value - 1) % 5; i += 1) await dial.press('ArrowRight');
  await expect(dial).toHaveAttribute('aria-valuenow', String(value));
}
async function expectHitTarget(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport();
  const hit = await locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    const x = Math.max(1, Math.min(innerWidth - 1, r.x + r.width / 2));
    const y = Math.max(1, Math.min(innerHeight - 1, r.y + r.height / 2));
    const top = document.elementFromPoint(x, y);
    return { reachable: top === element || element.contains(top), control: element.getAttribute('aria-label') || element.id || element.className, blockedBy: top?.outerHTML.slice(0, 240) };
  });
  expect(hit.reachable, JSON.stringify(hit)).toBe(true);
}

for (const layout of layouts) {
  test(`SIMD flat live deck keeps dance/control faces and footer levels reachable on ${layout.name}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: layout.width, height: layout.height },
      hasTouch: layout.coarse, isMobile: layout.coarse, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      const diagnostics = await openDeck(page, baseURL);
      await expect(page.locator('aside:visible')).toHaveCount(0);
      await expect(page.locator('#simdLegacyControls')).toBeHidden();
      await expect(page.locator('[data-voice-length]')).toHaveCount(0);
      await expect(page.locator('.simd-voice-footer [data-sequence-param]')).toHaveCount(0);
      for (const selector of ['#simdPresetPicker > summary', '#nextPreset', '#randomizePatch', '#audioButton', '#synthPlayButton']) {
        await expectHitTarget(page.locator(selector));
        if (layout.coarse && ['#audioButton', '#synthPlayButton'].includes(selector)) {
          const box = await page.locator(selector).boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      for (const voice of voices) {
        const volume = page.locator(`[data-performer-volume="${voice}"] [role="slider"]`);
        await expectHitTarget(volume); // Level remains visible in the dance face.
        await showControls(page, voice);
        await expect(page.locator(`[data-character-voice="${voice}"]`)).toHaveAttribute('data-view', 'controls');
        for (const selector of [`[data-character-mute="${voice}"]`, `[data-character-solo="${voice}"]`]) await expectHitTarget(page.locator(selector));
        await expectHitTarget(volume);
        await expect(volume).toHaveClass(/webgpu-knob-dial/);
        const hitBox = await volume.boundingBox();
        const minimumHit = voice === 'drums' ? 32 : layout.coarse ? 44 : 40;
        expect(hitBox.width).toBeGreaterThanOrEqual(minimumHit);
        expect(hitBox.height).toBeGreaterThanOrEqual(minimumHit);
        if (pitched.includes(voice)) {
          await expect(page.locator(`#panel-${voice} [role="tab"]`)).toHaveCount(0);
          await expect(page.locator(`.simd-voice-controls[data-voice="${voice}"] [role="tablist"]`)).toHaveCount(0);
          await expectHitTarget(stepDial(page, voice));
        }
        await expectHitTarget(page.locator(`.simd-voice-controls[data-voice="${voice}"]`));
      }
      await expect(page.locator('.simd-knob-details')).toHaveCount(0);
      for (const part of parts) {
        const control = page.locator(`[data-drum-volume="${part}"] [role="slider"]`);
        await expectHitTarget(control);
        const bounds = await control.boundingBox();
        expect(bounds.width).toBeGreaterThanOrEqual(32); expect(bounds.height).toBeGreaterThanOrEqual(32);
      }
      await page.locator('[data-voice-view="lead"]').click();
      await expect(page.locator('.simd-voice-controls[data-voice="lead"]')).toBeHidden();
      for (const voice of voices.filter(voice => voice !== 'lead')) await expect(page.locator(`[data-character-voice="${voice}"]`)).toHaveAttribute('data-view', 'controls');
      const state = await capture(page);
      expect(state.voiceViews.lead).toBe('dance'); expect(state.voiceViews.bass).toBe('controls');
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}

test('SIMD flat live deck exposes all 154 parameters once, with footer levels and inline musical editors', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const diagnostics = await openDeck(page, baseURL);
  const contract = await page.evaluate(async () => {
    const { PARAM_GROUPS: groups, PARAM_MODES: modes, PARAM_SPECIAL: special } = await import('./src/instruments/simd-chiptune/parameter-groups.js');
    const { WEBGPU_CHIPTUNE_PARAM_ORDER: order } = await import('./src/instruments/webgpu-chiptune/webgpu-chiptune.js');
    return { groups, modes, special, order };
  });
  const footerKeys = new Set(Object.values(levelKeys));
  const ordinary = contract.order.filter(key => !['pitch-classes', 'gate-durations'].includes(contract.special[key]));
  expect(await page.locator('[data-param-key]').evaluateAll(elements => elements.map(element => element.dataset.paramKey).sort())).toEqual(ordinary.sort());
  expect(await page.locator('.simd-voice-footer [data-param-key]').evaluateAll(elements => elements.map(element => element.dataset.paramKey).sort())).toEqual([...footerKeys].sort());
  await expect(page.locator('[data-performer-volume="bass"] [data-param-key]')).toHaveCount(0);
  await expect(page.locator('input[type="range"]:not(#output):visible')).toHaveCount(0);
  for (const voice of voices) await showControls(page, voice);
  for (const mode of ['song', 'pattern']) {
    await page.locator('#compositionMode').selectOption(mode);
    const visited = new Set(['tempo', ...footerKeys]);
    for (const key of footerKeys) await expect(page.locator(`.simd-voice-footer [data-param-key="${key}"]`)).toBeVisible();
    for (const group of contract.groups) {
      const keys = group.keys.filter(key => key !== 'tempo' && !footerKeys.has(key));
      const active = keys.filter(key => mode === 'song' || contract.modes[key] === 'both');
      const block = page.locator(`[data-control-group="${group.id}"]`);
      if (!active.length) {
        if (await block.count()) await expect(block).toBeHidden();
        continue;
      }
      if (group.owner === 'global') await page.locator('#tab-' + group.id).click();
      else if (group.owner === 'drums') await page.locator('#tab-drums-' + (group.part ?? 'kit')).click();
      else await expect(page.locator('#panel-' + group.owner)).toBeVisible();
      await expect(block).toBeVisible(); await expect(block.locator('details')).toHaveCount(0);
      for (const key of active) {
        if (contract.special[key] === 'pitch-classes') {
          await expect(page.locator('#scaleControls')).toBeVisible(); await expect(page.locator('#scaleControls button')).toHaveCount(12);
        } else if (contract.special[key] === 'gate-durations') {
          await expect(page.locator('#gateControls')).toBeVisible(); await expect(page.locator('#gateControls .chiptune-gate-grid button')).toHaveCount(64);
        } else {
          const control = block.locator(`[data-param-key="${key}"]`); await expect(control).toBeVisible();
          if (contract.special[key] === 'toggle') expect(await control.evaluate(element => element.tagName)).toBe('BUTTON');
          else await expect(control).toHaveAttribute('role', 'slider');
        }
        visited.add(key);
      }
      const firstKnob = block.locator('[data-param-key]:visible').first();
      if (await firstKnob.count()) await expectHitTarget(firstKnob);
    }
    expect([...visited].sort()).toEqual(contract.order.filter(key => footerKeys.has(key) || mode === 'song' || contract.modes[key] === 'both').sort());
    if (mode === 'song') await expect(page.locator('#tab-songArrangement')).toBeVisible();
    else await expect(page.locator('#tab-songArrangement')).toBeHidden();
  }
  await page.locator('#compositionMode').selectOption('song'); await page.locator('#tab-globalMix').click();
  const beforeScale = (await capture(page)).parameters.scaleMask;
  await page.locator('#scaleControls button').nth(1).click();
  expect((await capture(page)).parameters.scaleMask).toBe(beforeScale ^ 2);
  await page.locator('#tab-songArrangement').click();
  for (const bank of ['A', 'B']) for (let word = 0; word < 4; word += 1) {
    const key = `gate${bank}${word}`, before = (await capture(page)).parameters[key];
    await page.locator(`#gateControls .chiptune-gate-grid[data-lane="${bank}"] button`).nth(word * 8).click();
    expect((await capture(page)).parameters[key]).not.toBe(before);
  }
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('SIMD flat live deck keeps Steps in each control face and edits independent voice and drum loops', async ({ page, baseURL }) => {
  const diagnostics = await openDeck(page, baseURL), initial = await capture(page);
  const lengths = { bass: 5, arp: 7, lead: 9, upperOne: 11, upperTwo: 13 };
  for (const [voice, length] of Object.entries(lengths)) await setSteps(page, voice, length);
  let state = await capture(page);
  for (const voice of pitched) {
    expect(state.sequence.lanes[voice].activeLength).toBe(lengths[voice]);
    expect(state.sequence.lanes[voice].cells).toEqual(initial.sequence.lanes[voice].cells);
  }
  const drumLengths = { kick: 6, snare: 10, hats: 14, shaker: 18 };
  for (const [part, length] of Object.entries(drumLengths)) {
    await setSteps(page, part, length);
    const rhythm = page.locator(`[data-sequence-lane="${part}"]`);
    const before = (await capture(page)).sequence.lanes[part].stepBeats;
    await rhythm.locator('[data-sequence-param="Step time"] [role="slider"]').press('ArrowRight');
    expect((await capture(page)).sequence.lanes[part].stepBeats).toBeGreaterThan(before);
    await expect(rhythm.locator('[data-sequence-param="Note length"]')).toHaveCount(0);
  }
  state = await capture(page);
  for (const [part, length] of Object.entries(drumLengths)) expect(state.sequence.lanes[part].activeLength).toBe(length);
  for (const voice of pitched) expect(state.sequence.lanes[voice].activeLength).toBe(lengths[voice]);
  const leadGate = page.locator('[data-sequence-lane="lead"] [data-sequence-param="Note length"] [role="slider"]');
  const beforeGate = state.sequence.lanes.lead.gate; await leadGate.press('ArrowLeft');
  expect((await capture(page)).sequence.lanes.lead.gate).toBeCloseTo(beforeGate - .01, 6);
  expect((await capture(page)).sequence.lanes.bass.gate).toBe(initial.sequence.lanes.bass.gate);
  await page.locator('#compositionMode').selectOption('song');
  await setSteps(page, 'lead', 23);
  expect((await capture(page)).sequence.lanes.lead.activeLength).toBe(23);
  await expect(page.locator('[data-sequence-lane="lead"] [data-sequence-param="Step time"]')).toBeHidden();
  await expect(page.locator('[data-sequence-lane="lead"] [data-sequence-param="Note length"]')).toBeHidden();
  await setSteps(page, 'snare', 21);
  expect((await capture(page)).sequence.lanes.snare.activeLength).toBe(21);
  await page.locator('#compositionMode').selectOption('pattern');
  expect((await capture(page)).sequence.lanes.lead.activeLength).toBe(lengths.lead);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('SIMD flat live deck mixed views and loop edits survive a WAX state round trip', async ({ page, baseURL }) => {
  await page.addInitScript(() => { globalThis.MorphazoidWAX = { register(adapter) { globalThis.__simdDeckWax = adapter; } }; });
  const diagnostics = await openDeck(page, baseURL); await page.waitForFunction(() => Boolean(globalThis.__simdDeckWax));
  await setSteps(page, 'bass', 7); await setSteps(page, 'upperTwo', 19);
  await page.locator('[data-character-solo="bass"]').click();
  const snapshot = await page.evaluate(() => globalThis.__simdDeckWax.getState());
  await page.locator('[data-voice-view="bass"]').click(); await showControls(page, 'lead'); await setSteps(page, 'bass', 12);
  await page.evaluate(snapshot => globalThis.__simdDeckWax.applyState(snapshot), snapshot);
  expect(await page.evaluate(() => globalThis.__simdDeckWax.getState())).toEqual(snapshot);
  for (const voice of voices) {
    const controls = ['bass', 'upperTwo'].includes(voice);
    await expect(page.locator(`[data-character-voice="${voice}"]`)).toHaveAttribute('data-view', controls ? 'controls' : 'dance');
    await expect(page.locator(`[data-voice-view="${voice}"]`)).toHaveAttribute('aria-pressed', String(controls));
  }
  await expect(stepDial(page, 'bass')).toHaveAttribute('aria-valuenow', '7');
  await expect(stepDial(page, 'upperTwo')).toHaveAttribute('aria-valuenow', '19');
  await expect(page.locator('[data-character-solo="bass"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('SIMD canonical footer levels preserve legacy trim and XY state until touched and can recover zero levels', async ({ page, baseURL }) => {
  await page.addInitScript(() => { globalThis.MorphazoidWAX = { register(adapter) { globalThis.__simdDeckWax = adapter; } }; });
  const diagnostics = await openDeck(page, baseURL); await page.waitForFunction(() => Boolean(globalThis.__simdDeckWax));
  const legacy = await page.evaluate(() => {
    const state = globalThis.__simdDeckWax.getState();
    state.parameters.leadLevel = .8; state.parameters.snareLevel = 0;
    state.voicePerformance = { ...state.voicePerformance,
      lead: { ...state.voicePerformance.lead, x: .71, y: .8, volume: .25, muted: true, solo: true } };
    state.drumMix = { ...state.drumMix, snare: { ...state.drumMix.snare, volume: .35, muted: true } };
    globalThis.__simdDeckWax.applyState(state); return state;
  });
  expect(await page.evaluate(() => globalThis.__simdDeckWax.getState())).toEqual(legacy);
  const expected = await page.evaluate(async () => {
    const { readSimdChiptuneLevels } = await import('./src/instruments/simd-chiptune/performance.js');
    const state = globalThis.__simdDeckWax.getState(); return readSimdChiptuneLevels(state.parameters, state.voicePerformance, state.drumMix);
  });
  const lead = page.locator('.simd-voice-footer [data-param-key="leadLevel"]');
  expect(Number(await lead.getAttribute('aria-valuenow'))).toBeCloseTo(expected.lead, 6);
  await lead.scrollIntoViewIfNeeded();
  const levelBox = await lead.boundingBox();
  await page.mouse.move(levelBox.x + levelBox.width / 2, levelBox.y + levelBox.height / 2);
  await page.mouse.down(); await page.mouse.move(levelBox.x + levelBox.width / 2, levelBox.y + levelBox.height / 2 - 12);
  expect((await capture(page)).parameters.leadLevel).not.toBe(legacy.parameters.leadLevel);
  await lead.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  const cancelled = await capture(page);
  expect(cancelled.parameters).toEqual(legacy.parameters);
  expect(cancelled.voicePerformance).toEqual(legacy.voicePerformance);
  expect(cancelled.drumMix).toEqual(legacy.drumMix);
  await lead.press('ArrowUp');
  let state = await capture(page);
  expect(state.voicePerformance.lead).toMatchObject({ x: .71, y: .5, volume: 1, muted: true, solo: true });
  expect(state.parameters.leadLevel).toBeGreaterThan(expected.lead);
  await page.locator('.simd-voice-footer [data-param-key="snareLevel"]').press('ArrowUp');
  state = await capture(page);
  expect(state.parameters.snareLevel).toBeGreaterThan(0);
  expect(state.drumMix.snare).toMatchObject({ volume: 1, muted: true });
  await page.evaluate(() => {
    const state = globalThis.__simdDeckWax.getState(); state.parameters.leadLevel = 0;
    state.voicePerformance = { ...state.voicePerformance, lead: { ...state.voicePerformance.lead, y: 0, volume: 0 } };
    globalThis.__simdDeckWax.applyState(state);
  });
  await lead.press('ArrowUp');
  state = await capture(page);
  expect(state.parameters.leadLevel).toBeGreaterThan(0);
  expect(state.voicePerformance.lead).toMatchObject({ x: .71, y: .5, volume: 1, muted: true, solo: true });
  expect(state.parameters.bassPulseLevel).toBe(legacy.parameters.bassPulseLevel);
  expect(state.parameters.bassSineLevel).toBe(legacy.parameters.bassSineLevel);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('SIMD flat live deck controls preserve audio and meters follow audible rather than saved levels', async ({ page, baseURL }) => {
  const diagnostics = await openDeck(page, baseURL);
  await page.evaluate(async () => {
    const { SimdChiptuneAudio } = await import('./src/instruments/simd-chiptune/audio.js');
    const start = SimdChiptuneAudio.prototype.start; globalThis.__simdDeckStarts = 0;
    SimdChiptuneAudio.prototype.start = function (...args) { globalThis.__simdDeckEngine = this; globalThis.__simdDeckStarts += 1; return start.apply(this, args); };
  });
  await expect(page.locator('[data-voice-meter]')).toHaveCount(7);
  await expect(page.locator('[data-drum-meter]')).toHaveCount(4);
  for (const meter of await page.locator('[data-voice-meter], [data-drum-meter]').all()) {
    await expect(meter).toHaveAttribute('role', 'meter'); await expect(meter).toHaveAttribute('aria-valuemin', '0');
    await expect(meter).toHaveAttribute('aria-valuemax', '1');
  }
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#synthPlayButton').click(); await waitForStableAudioState(page, true);
  const clock = () => page.evaluate(() => ({ starts: globalThis.__simdDeckStarts,
    time: globalThis.__simdDeckEngine.currentPlaybackTime(), anchor: globalThis.__simdDeckEngine.timelineStart,
    running: globalThis.__simdDeckEngine.running, context: globalThis.__simdDeckEngine.context.state }));
  const before = await clock();
  await showControls(page, 'lead'); await page.locator('#panel-lead [data-param-key="leadTone"]').press('ArrowRight');
  await page.locator('[data-sequence-lane="lead"] [data-sequence-param="Note length"] [role="slider"]').press('PageDown');
  await setSteps(page, 'bass', 13); await page.locator('#tab-echo').click();
  await page.locator('#knobControls [data-param-key="echoWet"]').press('ArrowLeft');
  await page.locator('[data-performer-volume="arp"] [role="slider"]').press('PageDown');
  await page.locator('[data-voice-view="lead"]').click();
  const bassMeter = page.locator('[data-voice-meter="bass"]');
  await expect.poll(async () => Number(await bassMeter.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  const bassLevel = await page.locator('[data-performer-volume="bass"] [role="slider"]').getAttribute('aria-valuenow');
  await page.locator('[data-character-mute="bass"]').click();
  await expect.poll(async () => Number(await bassMeter.getAttribute('aria-valuenow'))).toBe(0);
  await expect(page.locator('[data-performer-volume="bass"] [role="slider"]')).toHaveAttribute('aria-valuenow', bassLevel);
  await page.locator('[data-character-mute="bass"]').click();
  const after = await clock();
  expect(after.starts).toBe(before.starts); expect(after.anchor).toBe(before.anchor);
  expect(after.time).toBeGreaterThan(before.time); expect(after.running).toBe(true); expect(after.context).toBe('running');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#synthPlayButton')).toHaveAttribute('aria-pressed', 'true');
  const audio = await sampleAudioEnvelope(page, { durationMs: 350 });
  expect(audio.summary.finite).toBe(true); expect(audio.summary.maxRms).toBeGreaterThan(.00001); expect(audio.summary.clippedSamples).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

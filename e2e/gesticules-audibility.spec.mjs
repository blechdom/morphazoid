import {test, expect} from '@playwright/test';
import {readAudioStatus, sampleAudioEnvelope} from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(() => window.__gesticulatingHand.snapshot());
const range = (page, id, value) => page.locator('#' + id).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', {bubbles: true}));
}, value);
const arm = async page => {
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await snapshot(page)).audio.running).toBe(true);
};
const silence = async page => {
  await expect.poll(async () => (await snapshot(page)).audio.rms, {timeout: 4000}).toBeLessThan(.0001);
};

// Use the actual menu/dice handlers, with an exact before/after observation in
// their synchronous event. Only dice consumes the deterministic random stream.
async function choose(page, {id, seed}) {
  if (id) await page.locator('.header-preset-picker summary').click();
  const button = id ? page.locator(`button[data-preset-id="${id}"]`) : page.locator('.header-preset-random');
  await expect(button).toBeVisible();
  return button.evaluate(async (button, {id, seed}) => {
    const {HAND_PRESETS, randomizeHandConfig, handMotionPeriod, handTremorRate, handEffectiveTempo} = await import('/src/instruments/gesticulating-hand/hand-model.js');
    const {captureHeaderPresetState} = await import('/src/site/header-presets.js');
    const clocks = state => ({period: handMotionPeriod(state.config.motion), tremor: handTremorRate(state.config), tempo: handEffectiveTempo(state.config.motion)});
    const before = window.__gesticulatingHand.snapshot();
    let expectedSeed = seed;
    const expected = id ? HAND_PRESETS.find(preset => preset.id === id).snapshot
      : randomizeHandConfig(before.config, () => ((expectedSeed = (Math.imul(expectedSeed, 1664525) + 1013904223) >>> 0) / 4294967296));
    const level = document.getElementById('outputLevel').value, started = performance.now();
    if (!id) window.__audibilityDiceSeed = seed;
    try { button.click(); } finally { delete window.__audibilityDiceSeed; }
    const after = window.__gesticulatingHand.snapshot();
    return {before, after, expected, elapsed: (performance.now() - started) / 1000, oldClocks: clocks(before), newClocks: clocks(after),
      captured: captureHeaderPresetState(), level, nextLevel: document.getElementById('outputLevel').value};
  }, {id, seed});
}

function expectRecall(change) {
  const {before, after, expected, captured, oldClocks, newClocks, elapsed} = change;
  expect(after.config).toEqual(expected);
  expect(captured.snapshot).toEqual(expected);
  for (const flag of ['playing', 'soundPlaying', 'audioOn', 'held']) expect(after[flag], flag).toBe(before[flag]);
  expect(change.nextLevel).toBe(change.level);
  // The existing recall rescales seconds to retain each clock's musical phase.
  // Preview must not reset that phase or take ownership of any player.
  const ratios = {time: oldClocks.period / newClocks.period, tremorTime: newClocks.tremor / oldClocks.tremor,
    rhythmTime: newClocks.tempo / oldClocks.tempo};
  for (const [clock, ratio] of Object.entries(ratios)) {
    const difference = after[clock] * ratio - before[clock];
    expect(difference, clock).toBeGreaterThanOrEqual(-1e-7);
    expect(difference, clock).toBeLessThanOrEqual(before.playing ? (elapsed + .04) * Math.max(1, ratio) : 1e-7);
  }
}

async function expectPreview(page, change) {
  expectRecall(change);
  const envelope = await sampleAudioEnvelope(page, {durationMs: 400, intervalMs: 35});
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect(envelope.summary.maxRms).toBeGreaterThan(.001);
  expect(envelope.summary.maxPeak).toBeLessThanOrEqual(.890001);
  const current = await snapshot(page);
  expect(current.config).toEqual(change.after.config);
  for (const flag of ['playing', 'soundPlaying', 'audioOn', 'held']) expect(current[flag], flag).toBe(change.after[flag]);
  await expect(page.locator('#outputLevel')).toHaveValue(change.level);
}

test.beforeEach(async ({page}) => {
  page.audibilityErrors = [];
  page.on('pageerror', error => page.audibilityErrors.push(error.message));
  await page.addInitScript(() => {
    const random = Math.random;
    Math.random = () => {
      if (window.__audibilityDiceSeed === undefined) return random();
      window.__audibilityDiceSeed = (Math.imul(window.__audibilityDiceSeed, 1664525) + 1013904223) >>> 0;
      return window.__audibilityDiceSeed / 4294967296;
    };
  });
  await page.goto('gesticules.html');
  await page.waitForFunction(() => window.__gesticulatingHand?.snapshot().loaded);
  await range(page, 'outputLevel', .37);
});
test.afterEach(async ({page}) => expect(page.audibilityErrors).toEqual([]));

test('preset and dice selection never arm Audio, with either player state', async ({page}) => {
  for (const playing of [false, true]) {
    if (playing) {
      await page.locator('#motionButton').click(); await page.locator('#soundPlayButton').click();
      await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(.1);
    }
    for (const selection of [{id: 'hushed-palm'}, {seed: 75}]) {
      const change = await choose(page, selection); expectRecall(change);
      expect(change.after.audio.contextState).toBe('uninitialized');
      expect(change.after.audioOn).toBe(false);
      const output = await readAudioStatus(page);
      expect(output.connectionCount).toBe(0); expect(output.rms).toBe(0);
    }
  }
});

test('a soft, slow factory scene previews promptly with both players paused and releases', async ({page}) => {
  await arm(page); await silence(page);
  const change = await choose(page, {id: 'hushed-palm'});
  expect(change.after.config.motion.tempo * change.after.config.motion.speed).toBeLessThan(75);
  expect(change.after.playing || change.after.soundPlaying).toBe(false);
  await expectPreview(page, change); await silence(page);
  const after = await snapshot(page);
  expect(after.config).toEqual(change.expected);
  expect(after.time).toBe(change.after.time);
  expect(after.audioOn).toBe(true);
});

test('actual dice previews its conditioned mix and honors solo selection without changing the captured scene', async ({page}) => {
  await arm(page);
  for (const seed of [75, 51]) {
    await silence(page);
    const change = await choose(page, {seed});
    expect(change.after.config.sound.attack).toBeLessThanOrEqual(.25);
    expect(change.captured.selectedId).toBeNull();
    await expectPreview(page, change);
    const current = await snapshot(page), activeSolo = current.config.voices.some(voice => voice.solo && !voice.mute);
    if (seed === 51) expect(activeSolo).toBe(true);
    current.config.voices.forEach((voice, i) => {
      if (voice.mute || (activeSolo && !voice.solo)) expect(current.audio.levels[i]).toBeLessThan(.0001);
    });
    await silence(page);
    expect((await snapshot(page)).config).toEqual(change.expected);
  }
});

test('preset and dice feedback preserve running clocks, both players, held notes and master level', async ({page}) => {
  await page.locator('#motionButton').click(); await page.locator('#soundPlayButton').click(); await arm(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('morphazoid:midi-input', {cancelable: true,
    detail: {routeId: 'gesticulating-hand', message: {type: 'noteOn', note: 60, velocity: 80, sourceId: 'preview-test', channel: 0}}})));
  await expect.poll(async () => (await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  const connections = (await readAudioStatus(page)).connectionCount;
  for (const selection of [{id: 'hand-crystal-staccato'}, {seed: 75}]) {
    const change = await choose(page, selection);
    expect(change.before.held).toBe(1); await expectPreview(page, change);
    await page.waitForTimeout(850);
    const after = await snapshot(page);
    expect(after.time).toBeGreaterThan(change.after.time);
    expect(after.playing && after.soundPlaying && after.audioOn).toBe(true);
    expect(after.held).toBe(1);
    expect((await readAudioStatus(page)).connectionCount).toBe(connections);
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('morphazoid:midi-input', {cancelable: true,
    detail: {routeId: 'gesticulating-hand', message: {type: 'noteOff', note: 60, velocity: 0, sourceId: 'preview-test', channel: 0}}})));
  expect((await snapshot(page)).held).toBe(0);
});

test('recalling a frozen rhythm rest previews once and returns to the same silent rest', async ({page}) => {
  await choose(page, {id: 'hand-crystal-staccato'});
  await range(page, 'tempo', 120); await page.locator('#motionButton').click();
  // Stop in the latter half of a cell, beyond every written note gate.
  await page.waitForFunction(() => {
    const state = window.__gesticulatingHand.snapshot();
    const phase = state.rhythmTime * state.config.motion.tempo * state.config.motion.speed / 60 * 2 % 1;
    if (phase < .55 || phase > .8) return false;
    document.getElementById('motionButton').click(); return true;
  });
  await page.locator('#soundPlayButton').click(); await arm(page); await page.waitForTimeout(200); await silence(page);
  const change = await choose(page, {id: 'hand-crystal-staccato'});
  expect(change.after.soundPlaying).toBe(true); expect(change.after.playing).toBe(false);
  const phases = await page.evaluate(async () => {
    const {handRhythmPhase} = await import('/src/instruments/gesticulating-hand/hand-rhythm.js');
    const state = window.__gesticulatingHand.snapshot(), beat = state.rhythmTime * state.config.motion.tempo * state.config.motion.speed / 60;
    return state.config.voices.map((_, i) => handRhythmPhase(state.config.sound.rhythm, beat, i));
  });
  expect(phases.every(phase => phase < 0 || phase >= change.after.config.sound.noteLength)).toBe(true);
  await expectPreview(page, change); await silence(page);
  const after = await snapshot(page);
  expect(after.soundPlaying).toBe(true); expect(after.playing).toBe(false);
  expect(after.rhythmTime).toBe(change.after.rhythmTime);
});

test('Audio off cancels preview, and muted selection cannot queue a preview for rearm', async ({page}) => {
  await arm(page); await expectPreview(page, await choose(page, {id: 'hushed-palm'}));
  await page.locator('#audioButton').click(); await silence(page);
  const change = await choose(page, {seed: 75}); expectRecall(change);
  expect(change.after.audioOn).toBe(false);
  await arm(page);
  const envelope = await sampleAudioEnvelope(page, {durationMs: 1000, intervalMs: 50});
  expect(envelope.summary.maxRms).toBeLessThan(.0001);
  expect((await snapshot(page)).soundPlaying).toBe(false);
});

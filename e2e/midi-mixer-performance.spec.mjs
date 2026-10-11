import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const browserErrors = new WeakMap();
test.beforeEach(({ page }) => {
  browserErrors.set(page, []);
  page.on('pageerror', error => browserErrors.get(page).push(error.message));
});
test.afterEach(({ page }) => { expect(browserErrors.get(page), 'uncaught browser errors').toEqual([]); });

function vlq(value) {
  const bytes = [value & 127];
  while ((value >>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
}

// Original regression score: a half-second lead-in, three voices, three tempo
// regions, a mid-score patch change, and audible volume/pan/sustain controllers.
// Its 16 beats last 2 + 4 + 8/3 seconds at the embedded 120/60/180 BPM map.
function arrangement(root = 60) {
  const events = [
    { tick: 0, bytes: [255, 81, 3, 7, 161, 32] },
    { tick: 0, bytes: [255, 88, 4, 4, 2, 24, 8] },
    { tick: 0, bytes: [192, 16] }, { tick: 0, bytes: [193, 33] },
    { tick: 0, bytes: [176, 7, 91] }, { tick: 0, bytes: [177, 10, 76] },
    { tick: 4 * 480, bytes: [255, 81, 3, 15, 66, 64] },
    { tick: 4 * 480, bytes: [192, 48] },
    { tick: 8 * 480, bytes: [255, 81, 3, 5, 22, 21] },
    { tick: 3 * 480, bytes: [176, 64, 127] },
    { tick: 5 * 480, bytes: [176, 64, 0] },
  ];
  for (let beat = 1; beat < 16; beat++) for (const [channel, note, length] of [[0, root + beat % 3 * 2, 400], [1, root - 12, 360], [9, beat % 2 ? 38 : 36, 120]]) {
    events.push({ tick: beat * 480, bytes: [144 | channel, note, 96] },
      { tick: beat * 480 + length, bytes: [128 | channel, note, 0] });
  }
  events.push({ tick: 16 * 480, bytes: [176, 123, 0] });
  const track = []; let previous = 0;
  for (const event of events.sort((a, b) => a.tick - b.tick)) {
    track.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick;
  }
  track.push(0, 255, 47, 0);
  const length = Buffer.alloc(4); length.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224]), Buffer.from('MTrk'), length, Buffer.from(track)]);
}

// Passive observers of the real instances. No fake synth, scheduler, audio
// destination or injected MIDI event path; production exports stay unchanged.
async function observe(page) {
  await page.addInitScript(() => {
    globalThis.__performanceQA = { contexts: [], legacy: null, mixer: null, events: [], plays: [], notes: [] };
    const Native = globalThis.AudioContext;
    globalThis.AudioContext = class extends Native {
      constructor(...args) { super(...args); globalThis.__performanceQA.contexts.push(this); }
    };
  });
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qa = globalThis.__performanceQA;
      const volume = MidiphoriaPlayer.prototype.setVolume;
      MidiphoriaPlayer.prototype.setVolume = function (...args) { qa.legacy = this; return volume.apply(this, args); };
      const play = MidiphoriaPlayer.prototype.play;
      MidiphoriaPlayer.prototype.play = function (...args) {
        const before = this.state.playing, at = this.context?.currentTime;
        const result = play.apply(this, args);
        if (result && !before) qa.plays.push({ at, file: this.state.fileName });
        return result;
      };
      const bind = MidiphoriaPlayer.prototype._bindEvents;
      const observed = new WeakSet();
      MidiphoriaPlayer.prototype._bindEvents = function (...args) {
        if (!observed.has(this)) {
          observed.add(this); const forward = this.onMidi;
          this.onMidi = message => {
            qa.events.push({ ...message, at: this.context?.currentTime });
            if (qa.events.length > 4000) qa.events.shift();
            return forward?.(message);
          };
        }
        return bind.apply(this, args);
      };
    ` });
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qa = globalThis.__performanceQA, observed = new WeakSet();
      const volume = MidiMixerEngine.prototype.setVolume;
      MidiMixerEngine.prototype.setVolume = function (...args) {
        qa.mixer = this;
        if (!observed.has(this)) {
          observed.add(this);
          this.subscribeNotes(notes => {
            qa.notes.push(...notes.map(note => ({ ...note })));
            if (qa.notes.length > 10000) qa.notes.splice(0, qa.notes.length - 10000);
          });
        }
        return volume.apply(this, args);
      };
    ` });
  });
}

async function input(page, id, value, type = 'input') {
  await page.locator(`#${id}`).evaluate((node, { value, type }) => {
    node.value = String(value); node.dispatchEvent(new Event(type, { bubbles: true }));
  }, { value, type });
}
async function open(page) {
  await observe(page); await page.goto('/midiphoria.html');
  await input(page, 'playbackRate', 4); await page.locator('#loopSong').check();
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#tempoFromB')).toBeEnabled();
  for (const index of [0, 1]) {
    await page.locator(`#deckFile${index}`).setInputFiles({ name: `QA original ${index ? 'B' : 'A'}.mid`, mimeType: 'audio/midi', buffer: arrangement(index ? 67 : 60) });
    await expect(page.locator(`#deckSong${index} option:checked`)).toHaveText(`QA original ${index ? 'B' : 'A'}.mid`);
    await expect(page.locator(`#deckChannels${index} .channel-row`)).toHaveCount(3);
    await expect(page.locator(`#deckOriginal${index}`)).toBeEnabled();
  }
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
}
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 35 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001);
  expect(summary.maxPeak).toBeLessThanOrEqual(.981); expect(summary.clippedSamples).toBe(0);
  return summary;
}
async function silent(page) {
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
}
const state = page => page.evaluate(() => {
  const { legacy, mixer, contexts, events, plays } = globalThis.__performanceQA;
  const mix = mixer.state;
  return { legacy: legacy.state, contexts: contexts.map(context => context.state), events, plays,
    originalBytes: legacy._file ? Array.from(new Uint8Array(legacy._file.buffer)) : null,
    mixer: { playing: mix.playing, beat: mix.beat, audioEnabled: mix.audioEnabled,
      tempo: mix.tempo, crossfade: mix.crossfade, effects: mix.effects,
      decks: mix.decks.map(deck => ({ config: deck.config, channels: deck.channels, name: deck.name })),
      samples: (mix.samples ?? []).map(sample => ({ id: sample.id, name: sample.name, program: sample.program, gain: sample.gain })) } };
});
const mixSettings = value => ({ tempo: value.tempo, crossfade: value.crossfade, effects: value.effects, decks: value.decks });
const sourceIds = page => page.locator('#mixerPerformanceCanvas').getAttribute('data-sources').then(value => JSON.parse(value || '[]'));
async function busyMix(page) {
  await input(page, 'masterTempo', 174); await input(page, 'mixerCrossfade', -.42);
  await page.locator('#deckRate0').selectOption('2'); await input(page, 'deckPitch0', 12); await input(page, 'deckOffset1', 2);
  await page.locator('#deckProgram0_0').selectOption('80');
  await page.locator('#deckChannels0 [data-channel="1"] button').first().click();
  await input(page, 'deckLoopStart0', 3, 'change'); await input(page, 'deckLoopEnd0', 7, 'change');
  await page.locator('.mixer-effects summary').click();
  await input(page, 'mixerFilter', 2.6); await input(page, 'mixerEcho', .5); await input(page, 'mixerFeedback', .6);
}

test('Play original queues exact source bytes silently and resets speed and loop without changing the remix', async ({ page }) => {
  await open(page); await busyMix(page);
  const before = mixSettings((await state(page)).mixer);
  await page.locator('#deckOriginal0').click();
  await expect(page.locator('#visualModeButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playbackRate')).toHaveValue('1'); await expect(page.locator('#loopSong')).not.toBeChecked();
  await expect(page.locator('#songList [data-song-id="original-deck-0"]')).toHaveAttribute('aria-pressed', 'true');
  const after = await state(page);
  expect(after.originalBytes).toEqual([...arrangement()]);
  expect(after.contexts).toEqual([]); expect(after.legacy.playing).toBe(false);
  expect(after.mixer.playing).toBe(false); expect(mixSettings(after.mixer)).toEqual(before);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('original playback retains scored timing, programs and controllers, then returns to the preserved audible remix', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await open(page); await busyMix(page); await arm(page); await page.locator('#mixerPlay').click(); await audible(page);
  const before = mixSettings((await state(page)).mixer);
  await page.locator('#deckOriginal0').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  const paused = (await state(page)).mixer.beat;
  await expect.poll(async () => (await state(page)).events.filter(event => event.type === 'noteOn' && event.channel === 0).length).toBeGreaterThan(3);
  const result = await state(page), attacks = result.events.filter(event => event.type === 'noteOn');
  expect(result.originalBytes).toEqual([...arrangement()]);
  expect(result.legacy.rate).toBe(1); expect(result.legacy.loop).toBe(false);
  expect(result.legacy.duration).toBeCloseTo(2 + 4 + 8 / 3, 2);
  expect(result.mixer.beat).toBeCloseTo(paused, 5); expect(result.mixer.audioEnabled).toBe(false);
  expect(mixSettings(result.mixer)).toEqual(before);
  expect([...new Set(attacks.map(note => note.channel))].sort((a, b) => a - b)).toEqual([0, 1, 9]);
  expect(attacks.find(note => note.channel === 0).note).toBe(62);
  expect(attacks[0].at - result.plays.at(-1).at).toBeGreaterThan(.35);
  expect(new Set(attacks.filter(note => note.channel === 0).map(note => note.voiceName)).size).toBeGreaterThan(1);
  expect(result.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'controlChange', channel: 0, controller: 64, value: 127 }),
  ]));
  const audio = await audible(page);
  await testInfo.attach('original-native-audio', { body: JSON.stringify(audio), contentType: 'application/json' });
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).mixer.beat).toBeGreaterThan(paused + .5);
  expect(mixSettings((await state(page)).mixer)).toEqual(before);
  expect((await state(page)).legacy.playing).toBe(false);
  await audible(page);
  await page.locator('#deckMute0').check(); await page.locator('#deckMute1').check();
  // Mixer echoes intentionally have a tail; clear their mix to prove no hidden
  // original player remains audible after handing ownership back.
  await input(page, 'mixerEcho', 0); await silent(page);
  expect((await state(page)).contexts.filter(value => value === 'running')).toHaveLength(1);
});

test('Stop and Reset cancel an original queued while Audio is off', async ({ page }) => {
  test.setTimeout(60000);
  await open(page); await page.locator('#deckOriginal0').click();
  await page.locator('#stopButton').click();
  await arm(page); await expect(page.locator('#playButton')).toBeEnabled();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false'); await silent(page);
  await page.locator('#audioButton').click(); await page.locator('#mixerModeButton').click();
  await page.locator('#deckOriginal1').click();
  await page.locator('#aboutSetup > summary').click(); await page.locator('#resetButton').click();
  await arm(page);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false'); await silent(page);
});

test('returning to Mixer during original Audio initialization prevents a late original start', async ({ page }) => {
  test.setTimeout(60000);
  await open(page); await page.locator('#deckOriginal0').click();
  let release, intercepted = false;
  const firstFont = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/midiphoria/soundfont/TimGM6mb.sf2', route => {
    if (intercepted) return route.continue();
    intercepted = true; release(route);
  });
  await page.locator('#audioButton').click();
  const pendingFont = await firstFont;
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await pendingFont.continue();
  await expect.poll(async () => (await state(page)).legacy.loading, { timeout: 15000 }).toBe(false);
  const result = await state(page);
  expect(result.legacy.playing).toBe(false); expect(result.legacy.audioEnabled).toBe(false);
  expect(result.contexts.filter(value => value === 'running')).toHaveLength(1);
  await expect(page.locator('#mixerModeButton')).toHaveAttribute('aria-pressed', 'true');
  await audible(page);
});

test('combined canvas follows both audible decks and samples overlay the running mix', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await open(page); await arm(page); await page.locator('#mixerPlay').click();
  await expect.poll(() => sourceIds(page)).toEqual(expect.arrayContaining(['deck:0', 'deck:1']));
  await expect.poll(() => page.locator('#mixerPerformanceCanvas').getAttribute('data-captured-notes').then(Number)).toBeGreaterThan(5);
  await input(page, 'mixerCrossfade', -1);
  await expect.poll(async () => (await sourceIds(page)).includes('deck:1')).toBe(false);
  await expect.poll(() => sourceIds(page)).toContain('deck:0');
  await input(page, 'deckPitch0', 12);
  await expect.poll(() => page.evaluate(() => globalThis.__performanceQA.notes.some(note => note.type === 'noteOn' && note.sourceId === 'deck:0' && note.channel === 0 && note.note >= 72))).toBe(true);
  await page.locator('#deckMute0').check(); await page.locator('#deckMute1').check(); await silent(page);
  await expect.poll(() => sourceIds(page)).toEqual([]);
  const before = (await state(page)).mixer.beat;
  await page.locator('#mixerSampleProgram').selectOption('80'); await input(page, 'mixerSampleLevel', .31);
  await page.locator('[data-mixer-sample="heart"]').click();
  await expect.poll(() => sourceIds(page)).toEqual(expect.arrayContaining([expect.stringMatching(/^sample:/)]));
  expect((await state(page)).mixer.samples.at(-1)).toEqual(expect.objectContaining({ program: 80, gain: .31 }));
  const heart = await audible(page);
  await page.locator('#mixerSampleMessage').fill('HI ⭐'); await page.locator('#mixerSendMessage').click();
  await expect(page.locator('#mixerPerformanceCanvas')).toHaveAttribute('data-message', /HI/);
  await audible(page); await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await state(page)).mixer.beat).toBeGreaterThan(before + 1);
  await page.locator('#mixerStopSamples').click(); await silent(page);
  expect((await state(page)).mixer.samples).toEqual([]);
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await testInfo.attach('sample-native-audio', { body: JSON.stringify(heart), contentType: 'application/json' });
});

test('sample buttons and text are silent previews before Audio and never revive canceled gestures', async ({ page }) => {
  await open(page);
  await page.locator('[data-mixer-sample="square"]').click();
  await expect(page.locator('#mixerSampleStatus')).toContainText(/silent preview/i);
  await page.locator('#mixerSampleMessage').fill('HEY'); await page.locator('#mixerSendMessage').click();
  await expect(page.locator('#mixerPerformanceCanvas')).toHaveAttribute('data-message', /HEY/);
  expect((await state(page)).contexts).toEqual([]);
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#mixerStopSamples').click(); await arm(page); await silent(page);
  expect((await state(page)).mixer.samples).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`performance viewport ${viewport.width}×${viewport.height}`, () => {
    const touch = viewport.width < 1000;
    test.use({ viewport, hasTouch: touch });
    test('combined performance controls remain reachable', async ({ page }, testInfo) => {
      await open(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const selector of ['#mixerPerformanceCanvas', '[data-mixer-sample="heart"]', '[data-mixer-sample="square"]', '#mixerSampleMessage', '#mixerSendMessage', '#mixerSendDrawing', '#mixerStopSamples', '#deckOriginal0', '#deckOriginal1']) {
        const target = page.locator(selector); await target.scrollIntoViewIfNeeded(); await expect(target).toBeVisible();
        const box = await target.boundingBox(); expect(box.width).toBeGreaterThan(20);
        expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      if (touch) {
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
        const buttons = page.locator('.mixer-performance button, #deckOriginal0, #deckOriginal1, #audioButton, #mixerPlay');
        const dimensions = [];
        for (const button of await buttons.all()) {
          await button.scrollIntoViewIfNeeded(); await expect(button).toBeVisible();
          const box = await button.boundingBox(), name = await button.getAttribute('aria-label') || await button.innerText();
          expect(box.width, `${name}: touch width`).toBeGreaterThanOrEqual(48);
          expect(box.height, `${name}: touch height`).toBeGreaterThanOrEqual(48);
          dimensions.push({ name, width: box.width, height: box.height });
        }
        await testInfo.attach('touch-targets', { body: JSON.stringify(dimensions, null, 2), contentType: 'application/json' });
        await page.locator('[data-mixer-sample="heart"]').tap();
        await expect(page.locator('#mixerPerformanceCanvas')).toHaveAttribute('data-message', 'Heart');
        await expect(page.locator('#mixerSampleStatus')).toContainText(/silent preview/i);
        await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
      }
      await page.locator('#mixerPerformanceCanvas').scrollIntoViewIfNeeded();
      await testInfo.attach('performance-layout', { body: await page.screenshot(), contentType: 'image/png' });
      expect((await state(page)).contexts).toEqual([]);
    });
  });
}

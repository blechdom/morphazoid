import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { installFakeMidi, enableFakeMidi, sendMidiSequence } from './helpers/fake-midi.mjs';

const rendererPath = '/src/instruments/midiphoria/midiphoria-renderer.js';

// Observe the real page's renderer without adding a production debug API or
// replacing its model, MIDI transport, synthesizer, or rendering decisions.
async function observeRenderer(page) {
  await page.route(`**${rendererPath}`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const audit = globalThis.__midiphoriaVoiceAudit = {
        events: [], seenTrailIds: new Set(), peakHeld: 0, peakTrails: 0,
        renderer: null, scenes: [], pendingScenes: [],
      };
      const captureEvent = MidiphoriaRenderer.prototype.captureEvent;
      MidiphoriaRenderer.prototype.captureEvent = function (event) {
        const result = captureEvent.call(this, event);
        audit.renderer = this;
        audit.events.push({ ...event });
        audit.peakHeld = Math.max(audit.peakHeld, this.held.size);
        const trails = this.trails;
        audit.peakTrails = Math.max(audit.peakTrails, trails.length);
        for (const trail of trails) audit.seenTrailIds.add(trail.id);
        return result;
      };
      const drawScene = MidiphoriaRenderer.prototype._drawScene;
      MidiphoriaRenderer.prototype._drawScene = function (ctx, sample, now, settings, width, height, trails) {
        audit.pendingScenes.push({ width, height,
          voiceIds: [...new Set(trails.map(note => note.voiceId))],
          noteIds: trails.map(note => note.id),
        });
        return drawScene.call(this, ctx, sample, now, settings, width, height, trails);
      };
      const draw = MidiphoriaRenderer.prototype.draw;
      MidiphoriaRenderer.prototype.draw = function (...args) {
        audit.renderer = this; audit.pendingScenes = [];
        const result = draw.apply(this, args);
        audit.scenes = audit.pendingScenes;
        return result;
      };
    ` });
  });
}

async function open(page, { midi = false } = {}) {
  await observeRenderer(page);
  if (midi) await installFakeMidi(page);
  await page.goto('/midiphoria.html');
  await expect(page.locator('#notePads button')).toHaveCount(24);
  await expect(page.locator('#voiceLayout')).toHaveValue('lanes');
  await expect(page.locator('#colorSource')).toHaveValue('voice');
}

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, next) => {
    node.value = String(next); node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

function variableLength(number) {
  const bytes = [number & 127];
  while ((number >>= 7)) bytes.unshift((number & 127) | 128);
  return bytes;
}

// Original test scores, 960 ticks per quarter at 120 BPM. A final controller
// event preserves the scored tail in the real SoundFont sequencer.
function midiFile(events, endTick) {
  let tick = 0;
  const track = [0, 255, 81, 3, 7, 161, 32];
  for (const event of [...events].sort((a, b) => a.tick - b.tick)) {
    track.push(...variableLength(event.tick - tick), ...event.bytes);
    tick = event.tick;
  }
  track.push(...variableLength(endTick - tick), 176, 123, 0, 0, 255, 47, 0);
  const length = Buffer.alloc(4); length.writeUInt32BE(track.length);
  return Buffer.concat([
    Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 3, 192]),
    Buffer.from('MTrk'), length, Buffer.from(track),
  ]);
}

function briefNotes() {
  const events = [];
  for (let index = 0; index < 200; index++) {
    const tick = 960 + index * 10, channel = Math.floor(index / 64), note = 32 + index % 64;
    events.push({ tick, bytes: [0x90 | channel, note, 100] },
      { tick: tick + 2, bytes: [0x80 | channel, note, 0] });
  }
  return midiFile(events, 15360);
}

function denseChord() {
  const events = [];
  for (let index = 0; index < 512; index++) {
    const channel = Math.floor(index / 64), note = 32 + index % 64;
    events.push({ tick: 960, bytes: [0x90 | channel, note, 100] },
      { tick: 4800, bytes: [0x80 | channel, note, 0] });
  }
  return midiFile(events, 19200);
}

function fourVoices() {
  const events = [];
  for (const [channel, program] of [16, 48, 56, 80].entries()) {
    events.push({ tick: 0, bytes: [0xc0 | channel, program] },
      { tick: 960, bytes: [0x90 | channel, 60, 96] },
      { tick: 76800, bytes: [0x80 | channel, 60, 0] });
  }
  return midiFile(events, 78720);
}

async function loadAndPlay(page, buffer, rate = 1) {
  await page.locator('#midiFile').setInputFiles({ name: 'Voice regression.mid', mimeType: 'audio/midi', buffer });
  await page.locator('#audioButton').click();
  await expect(page.locator('#playButton')).toBeEnabled({ timeout: 15000 });
  await range(page, 'playbackRate', rate);
  await page.locator('#loopSong').uncheck();
  await page.locator('#playButton').click();
}

const audit = page => page.evaluate(() => {
  const value = globalThis.__midiphoriaVoiceAudit;
  return {
    events: value.events,
    seenTrailIds: [...value.seenTrailIds], peakHeld: value.peakHeld, peakTrails: value.peakTrails,
    voices: value.renderer.getVoices(), focus: value.renderer.voiceFocus, scenes: value.scenes,
    width: value.renderer.width, height: value.renderer.height,
  };
});

async function expectAllNotes(page, count) {
  await expect.poll(async () => (await audit(page)).events.filter(event => event.type === 'noteOff').length)
    .toBe(count);
  const result = await audit(page);
  const attacks = result.events.filter(event => event.type === 'noteOn');
  const releases = result.events.filter(event => event.type === 'noteOff');
  expect(attacks).toHaveLength(count);
  expect(attacks.every(event => event.id != null && Number.isFinite(event.time))).toBe(true);
  expect(new Set(attacks.map(event => event.id)).size).toBe(count);
  expect(new Set(releases.map(event => event.id))).toEqual(new Set(attacks.map(event => event.id)));
  expect(new Set(result.seenTrailIds)).toEqual(new Set(attacks.map(event => event.id)));
  expect(result.peakTrails).toBe(count);
  return result;
}

for (const rate of [1, 4]) {
  test(`the real MIDI player draws all 200 millisecond notes at ${rate}×`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await open(page);
    await loadAndPlay(page, briefNotes(), rate);
    await expectAllNotes(page, 200);
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
}

test('512 simultaneous file notes all reach visual history at 4×', async ({ page }) => {
  await open(page);
  await loadAndPlay(page, denseChord(), 4);
  const result = await expectAllNotes(page, 512);
  expect(result.peakHeld).toBe(512);
  expect(result.voices).toHaveLength(8);
  await expect(page.locator('#voiceLegend button[data-voice-id]')).toHaveCount(8);
});

test('same-pitch attacks within one display frame remain independent trails', async ({ page }) => {
  await open(page, { midi: true });
  await enableFakeMidi(page);
  await page.locator('.header-settings-menu').evaluate(node => { node.open = false; });
  // Overlap all 64 attacks, then release them in the same JS turn. Snapshot
  // sampling cannot discover any of these notes, and a pitch-keyed map loses 63.
  const messages = [
    ...Array.from({ length: 64 }, () => ({ data: [0x90, 60, 100] })),
    ...Array.from({ length: 64 }, () => ({ data: [0x80, 60, 0] })),
  ];
  await sendMidiSequence(page, messages);
  const result = await expectAllNotes(page, 64);
  expect(result.peakHeld).toBe(64);
  expect(new Set(result.events.map(event => event.note))).toEqual(new Set([60]));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test('voice colors, separate lanes, panels and visual focus preserve the sounding arrangement', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await loadAndPlay(page, fourVoices());
  await expect(page.locator('#voiceLegend button[data-voice-id]')).toHaveCount(4);
  await expect.poll(async () => (await audit(page)).scenes.length).toBe(4);
  const initial = await audit(page);
  expect(initial.voices.every(voice => voice.active)).toBe(true);
  expect(new Set(initial.voices.map(voice => voice.color)).size).toBe(4);
  expect(initial.voices.every(voice => /Ch \d+ · \S/.test(voice.label))).toBe(true);
  expect(initial.scenes.every(scene => scene.voiceIds.length === 1 && scene.noteIds.length === 1)).toBe(true);
  expect(new Set(initial.scenes.flatMap(scene => scene.voiceIds))).toEqual(new Set(initial.voices.map(voice => voice.id)));
  expect(initial.scenes.every(scene => scene.width === initial.width && scene.height < initial.height)).toBe(true);
  const song = await page.locator('#songSelect').inputValue();
  const before = Number(await page.locator('#songPosition').inputValue());

  await page.locator('#voiceLayout').selectOption('panels');
  await expect.poll(async () => (await audit(page)).scenes.every(scene => scene.width < initial.width)).toBe(true);
  await page.locator('#voiceLayout').selectOption('overlay');
  await expect.poll(async () => (await audit(page)).scenes.length).toBe(1);
  expect((await audit(page)).scenes[0].voiceIds).toHaveLength(4);

  const focusedId = initial.voices[1].id;
  await page.locator('#voiceFocus').selectOption(focusedId);
  await expect.poll(async () => (await audit(page)).scenes.map(scene => scene.voiceIds)).toEqual([[focusedId]]);
  await expect(page.locator('#voiceLegend button[aria-pressed="true"]')).toHaveCount(1);
  await page.locator('#voiceLegend button[aria-pressed="true"]').click();
  await expect(page.locator('#voiceFocus')).toHaveValue('');
  await expect.poll(async () => (await audit(page)).scenes[0].voiceIds.length).toBe(4);
  await page.locator('#voiceLayout').selectOption('lanes');
  await page.locator('#voiceLegend button[data-voice-id]').nth(2).click();
  await expect(page.locator('#voiceFocus')).toHaveValue(initial.voices[2].id);
  await expect.poll(async () => (await audit(page)).scenes.map(scene => scene.voiceIds)).toEqual([[initial.voices[2].id]]);
  await page.locator('#voiceFocus').selectOption('');

  await page.locator('.header-preset-next').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#songSelect')).toHaveValue(song);
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(before + .5);
  const signal = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 40 });
  expect(signal.summary.finite).toBe(true);
  expect(signal.summary.maxRms).toBeGreaterThan(.001);
  expect(signal.summary.maxPeak).toBeLessThanOrEqual(.981);
  expect(signal.summary.clippedSamples).toBe(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  expect((await audit(page)).events.filter(event => event.type === 'noteOn')).toHaveLength(4);
  await testInfo.attach('voice-layouts.json', { body: JSON.stringify(initial, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('replacing a playing file clears its stale visual focus and shows the new voices', async ({ page }) => {
  await open(page);
  await loadAndPlay(page, fourVoices());
  await expect(page.locator('#voiceLegend button[data-voice-id]')).toHaveCount(4);
  const oldVoices = (await audit(page)).voices;
  const absentVoice = oldVoices.find(voice => voice.channel === 3);
  await page.locator('#voiceFocus').selectOption(absentVoice.id);
  await expect.poll(async () => (await audit(page)).scenes.map(scene => scene.voiceIds)).toEqual([[absentVoice.id]]);
  const replacement = midiFile([
    { tick: 0, bytes: [0xc0, 32] },
    { tick: 960, bytes: [0x90, 67, 100] },
    { tick: 76800, bytes: [0x80, 67, 0] },
  ], 78720);
  await page.locator('#midiFile').setInputFiles({
    name: 'New solo arrangement.mid', mimeType: 'audio/midi', buffer: replacement,
  });
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#voiceFocus')).toHaveValue('');
  await expect(page.locator('#voiceLegend button[data-voice-id]')).toHaveCount(1);
  await expect.poll(async () => (await audit(page)).voices.filter(voice => voice.active).length).toBe(1);
  const result = await audit(page);
  expect(result.focus).toBe(null);
  expect(result.voices[0].channel).toBe(0);
  expect(result.voices.some(voice => voice.id === absentVoice.id)).toBe(false);
  expect(result.scenes).toHaveLength(1);
  expect(result.scenes[0].voiceIds).toEqual([result.voices[0].id]);
  expect(result.scenes[0].noteIds).toHaveLength(1);
  const position = Number(await page.locator('#songPosition').inputValue());
  await expect.poll(async () => Number(await page.locator('#songPosition').inputValue())).toBeGreaterThan(position + .2);
  const sound = await sampleAudioEnvelope(page, { durationMs: 400, intervalMs: 40 });
  expect(sound.summary.finite).toBe(true);
  expect(sound.summary.maxRms).toBeGreaterThan(.001);
  expect(sound.summary.clippedSamples).toBe(0);
});

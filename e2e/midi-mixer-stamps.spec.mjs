import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page).push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page), 'uncaught browser errors').toEqual([]); });

// Observe real submitted MIDI and native scheduler telemetry. No fake synth,
// AudioContext clock, output destination, or injected playback event path.
async function observe(page) {
  await page.addInitScript(() => {
    globalThis.__stampsQA = { engine: null, contexts: [], launches: [], notes: [] };
    const Native = globalThis.AudioContext;
    globalThis.AudioContext = class extends Native {
      constructor(...args) { super(...args); globalThis.__stampsQA.contexts.push(this); }
    };
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qa = globalThis.__stampsQA, observed = new WeakSet();
      const volume = MidiMixerEngine.prototype.setVolume;
      MidiMixerEngine.prototype.setVolume = function (...args) {
        qa.engine = this;
        if (!observed.has(this)) {
          observed.add(this); this.subscribeNotes(notes => {
            qa.notes.push(...notes.map(note => ({ ...note })));
            if (qa.notes.length > 20000) qa.notes.splice(0, qa.notes.length - 20000);
          });
        }
        return volume.apply(this, args);
      };
      const trigger = MidiMixerEngine.prototype.triggerSample;
      MidiMixerEngine.prototype.triggerSample = function (...args) {
        const result = trigger.apply(this, args);
        if (result) qa.launches.push({ id: result.id, name: result.name, program: result.midi?.program ?? result.program, gain: result.gain,
          duration: result.analysis.durationBeats,
          notes: result.analysis.notes.map(({ note, beat, duration, velocity, channel }) => ({ note, beat, duration, velocity, channel })),
          controls: result.analysis.events.filter(event => event.kind !== 8 && event.kind !== 9) });
        return result;
      };
    ` });
  });
}

async function open(page) {
  await observe(page); await page.goto('/midiphoria.html');
  await page.locator('#drawingModeButton').click();
  await expect(page.locator('#mixerStampCount')).toHaveText('58 / 58');
}
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
const stamp = (page, id) => page.locator(`[data-mixer-sample="${id}"]`);
const launches = page => page.evaluate(() => globalThis.__stampsQA.launches);
const snapshot = page => page.evaluate(() => {
  const qa = globalThis.__stampsQA, state = qa.engine.state;
  return { contexts: qa.contexts.map(context => context.state), playing: state.playing, beat: state.beat,
    audioEnabled: state.audioEnabled, samples: state.samples.map(sample => ({ id: sample.id, name: sample.name })),
    decks: state.decks.map(deck => ({ name: deck.name, config: deck.config, channels: deck.channels })) };
});
async function lastLaunch(page, action) {
  const count = (await launches(page)).length; await action();
  await expect.poll(async () => (await launches(page)).length).toBe(count + 1);
  return (await launches(page)).at(-1);
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
}
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 300, intervalMs: 30 });
  expect(summary.finite).toBe(true); expect(summary.maxRms).toBeGreaterThan(.001);
  expect(summary.maxPeak).toBeLessThanOrEqual(.981); expect(summary.clippedSamples).toBe(0);
  return summary;
}
const pitchRange = score => Math.max(...score.notes.map(note => note.note)) - Math.min(...score.notes.map(note => note.note));
function sustainedMidi(note) {
  const track = [0, 192, 16, 0, 144, note, 96, 0x8c, 0, 128, note, 0, 0, 255, 47, 0];
  const size = Buffer.alloc(4); size.writeUInt32BE(track.length);
  // Sixteen beats at 96 PPQ: one held organ voice keeps audio checks independent
  // of whichever songs happen to be the collection's current defaults.
  return Buffer.concat([Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96]), Buffer.from('MTrk'), size, Buffer.from(track)]);
}

test('one search field filters all 30 generated and 28 file stamps without arming audio', async ({ page }) => {
  await open(page);
  await expect(page.locator('.mixer-stamp-palette input')).toHaveCount(1);
  await expect(page.locator('[data-mixer-sample]')).toHaveCount(58);
  const filter = page.locator('#mixerStampFilter');
  await filter.fill('generated pattern'); await expect(page.locator('[data-mixer-sample]:visible')).toHaveCount(30);
  await expect(page.locator('#mixerStampCount')).toHaveText('30 / 58');
  await filter.fill('MIDI file'); await expect(page.locator('[data-mixer-sample]:visible')).toHaveCount(28);
  await filter.fill('black midi chasing'); await expect(page.locator('[data-mixer-sample]:visible')).toHaveCount(1);
  await expect(stamp(page, 'black-bleed-chasing-wind')).toBeVisible();
  await filter.fill('glooob'); await expect(page.locator('[data-mixer-sample]:visible')).toHaveCount(1);
  await stamp(page, 'glooob').click(); await expect(page.locator('#mixerSampleStatus')).toContainText('silent preview');
  await filter.fill('no such stamp'); await expect(page.locator('#mixerStampCount')).toHaveText('0 / 58');
  await filter.fill(''); await expect(page.locator('[data-mixer-sample]:visible')).toHaveCount(58);
  expect((await snapshot(page)).contexts).toEqual([]);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'false');
});

test('density, pitch span, length and Variation change the submitted MIDI notes', async ({ page }) => {
  await open(page);
  await input(page, 'mixerStampDensity', .1);
  const sparse = await lastLaunch(page, () => stamp(page, 'noise').click());
  await input(page, 'mixerStampDensity', .9);
  const dense = await lastLaunch(page, () => page.locator('#mixerStampAgain').click());
  expect(dense.notes.length).toBeGreaterThan(sparse.notes.length * 2);
  await input(page, 'mixerStampSpan', 12);
  const narrow = await lastLaunch(page, () => page.locator('#mixerStampAgain').click());
  expect(pitchRange(narrow)).toBeLessThanOrEqual(11); expect(pitchRange(dense)).toBeGreaterThan(30);
  await input(page, 'mixerStampBeats', 32);
  const long = await lastLaunch(page, () => page.locator('#mixerStampAgain').click());
  expect(long.duration / narrow.duration).toBeCloseTo(4, 2);
  expect(long.notes.map(note => note.note)).toEqual(narrow.notes.map(note => note.note));
  const variant = await lastLaunch(page, () => page.locator('#mixerStampVariation').click());
  expect(variant.notes).not.toEqual(long.notes); expect(variant.duration).toBeCloseTo(long.duration, 2);
  const repeat = await lastLaunch(page, () => page.locator('#mixerStampAgain').click());
  expect(repeat.notes).toEqual(variant.notes);
  expect((await snapshot(page)).contexts).toEqual([]);
});

test('file stamps preserve original instruments, cache excerpts and retain short whole patterns', async ({ page }) => {
  await open(page);
  let requests = 0;
  await page.route('**/assets/midiphoria/midi/black-bleed-chasing-wind.mid', route => { requests++; return route.continue(); });
  const first = await lastLaunch(page, () => stamp(page, 'black-bleed-chasing-wind').click());
  await expect(page.locator('#mixerSampleProgram')).toHaveValue('original'); expect(first.program).toBeNull();
  await expect(page.locator('#mixerStampDensity')).toBeDisabled(); await expect(page.locator('#mixerStampVariation')).toBeDisabled();
  await expect(page.locator('#mixerStampNextSlice')).toBeVisible();
  await expect(page.locator('#mixerStampCredit')).toHaveAttribute('href', /BLEEDING-EDGE-MONOTONE/);
  const firstRange = await page.locator('#mixerSampleStatus').innerText();
  expect(firstRange).toContain('excerpt');
  expect(first.duration).toBeLessThanOrEqual(8.01); expect(first.notes.length).toBeGreaterThan(0);
  const second = await lastLaunch(page, () => page.locator('#mixerStampNextSlice').click());
  expect(requests).toBe(1); expect(second.notes).not.toEqual(first.notes);
  expect(await page.locator('#mixerSampleStatus').innerText()).not.toBe(firstRange);
  const repeated = await lastLaunch(page, () => page.locator('#mixerStampAgain').click());
  expect(repeated.notes).toEqual(second.notes); expect(requests).toBe(1);
  const bytes = await readFile(new URL('../assets/midiphoria/midi/black-pattern-3-beat-funnel-128.mid', import.meta.url));
  const source = parseMidi(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const short = await lastLaunch(page, () => stamp(page, 'black-pattern-3-beat-funnel-128').click());
  await expect(page.locator('#mixerSampleStatus')).toContainText('whole pattern');
  expect(short.notes).toHaveLength(source.notes.length);
  const voices = notes => notes.map(note => [note.note, note.channel, note.velocity].join(':')).sort();
  expect(voices(short.notes)).toEqual(voices(source.notes));
  expect(short.duration).toBeLessThanOrEqual(8.01); expect(short.program).toBeNull();
  await input(page, 'mixerStampBeats', 16);
  const stretched = await lastLaunch(page, () => page.locator('#mixerStampAgain').click());
  expect(stretched.notes).toHaveLength(short.notes.length); expect(voices(stretched.notes)).toEqual(voices(short.notes));
  expect(stretched.duration / short.duration).toBeCloseTo(2, 2);
  await stamp(page, 'square').click(); await expect(page.locator('#mixerSampleProgram')).toHaveValue('0');
  await expect(page.locator('#mixerStampDensity')).toBeEnabled(); await expect(page.locator('#mixerStampNextSlice')).toBeHidden();
  expect((await snapshot(page)).contexts).toEqual([]);
});

test('tapping and dragging the flow places sounding scores at different pitches', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page); await input(page, 'mixerStampSpan', 12); await input(page, 'mixerStampBeats', 32);
  await stamp(page, 'square').click(); await page.locator('#mixerStopSamples').click(); await arm(page);
  const canvas = page.locator('#mixerPerformanceCanvas'); await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const low = await lastLaunch(page, () => canvas.click({ position: { x: box.width * .4, y: box.height * .5 } }));
  await page.locator('#mixerStopSamples').click();
  const high = await lastLaunch(page, () => canvas.click({ position: { x: box.width * .6, y: box.height * .5 } }));
  expect(high.notes.map(note => note.note - 26)).toEqual(low.notes.map(note => note.note));
  await expect.poll(() => page.evaluate(id => globalThis.__stampsQA.notes.some(note => note.type === 'noteOn' && note.sourceId === `sample:${id}`), high.id)).toBe(true);
  const audio = await audible(page); await testInfo.attach('paint-native-audio', { body: JSON.stringify(audio), contentType: 'application/json' });
  await canvas.scrollIntoViewIfNeeded(); const rect = await canvas.boundingBox(), before = (await launches(page)).length;
  await page.mouse.move(rect.x + rect.width * .4, rect.y + rect.height * .5); await page.mouse.down();
  await page.waitForTimeout(280); await page.mouse.move(rect.x + rect.width * .6, rect.y + rect.height * .5, { steps: 4 }); await page.mouse.up();
  await expect.poll(async () => (await launches(page)).length).toBeGreaterThanOrEqual(before + 2);
  const painted = (await launches(page)).slice(before);
  expect(Math.min(...painted.at(-1).notes.map(note => note.note))).toBeGreaterThan(Math.min(...painted[0].notes.map(note => note.note)));
  await page.locator('#mixerStampPaint').uncheck(); const count = (await launches(page)).length;
  await canvas.click(); expect((await launches(page)).length).toBe(count);
  await canvas.focus(); await page.keyboard.press('Enter'); await expect.poll(async () => (await launches(page)).length).toBe(count + 1);
});

async function holdFile(page) {
  let release, ready, done, pendingRequest;
  const started = new Promise(resolve => { ready = resolve; }), finished = new Promise(resolve => { done = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/midiphoria/midi/black-bleed-chasing-wind.mid', async route => {
    pendingRequest = route.request();
    const response = await route.fetch(); ready(); await gate;
    try { await route.fulfill({ response }); } finally { done(); }
  });
  await stamp(page, 'black-bleed-chasing-wind').click(); await started;
  await expect(page.locator('#mixerSampleStatus')).toContainText('Loading');
  return async () => {
    release(); await finished;
    await expect.poll(() => Boolean(pendingRequest.failure()), { message: 'superseded file request was aborted' }).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
}

for (const action of ['Stop samples', 'Stop mixer', 'Leave view', 'Audio off']) {
  test(`${action} cancels a pending file stamp before its MIDI arrives`, async ({ page }) => {
    test.setTimeout(60000); await open(page); if (action === 'Audio off') await arm(page);
    const deliver = await holdFile(page);
    if (action === 'Stop samples') await page.locator('#mixerStopSamples').click();
    else if (action === 'Stop mixer') { await page.locator('#mixerModeButton').click(); await page.locator('#mixerStop').click(); }
    else if (action === 'Leave view') await page.locator('#visualModeButton').click();
    else await page.locator('#audioButton').click();
    await deliver(); expect(await launches(page)).toEqual([]); expect((await snapshot(page)).samples).toEqual([]);
    if (action === 'Leave view') await page.locator('#drawingModeButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await arm(page); await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
    expect(await launches(page)).toEqual([]);
  });
}

test('a generated stamp wins over a delayed file without a stale second launch', async ({ page }) => {
  await open(page); const deliver = await holdFile(page);
  const immediate = await lastLaunch(page, () => stamp(page, 'zigzag').click());
  await deliver(); expect(await launches(page)).toEqual([immediate]);
  await expect(page.locator('#mixerPerformanceCanvas')).toHaveAttribute('data-message', 'Zigzag');
  await expect(page.locator('#mixerSampleStatus')).not.toContainText('Chasing Wind');
  expect((await snapshot(page)).contexts).toEqual([]);
});

test('four native one-shots can overlap, replace the oldest, and leave deck playback intact', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page); await input(page, 'mixerStampBeats', 32);
  await page.locator('#mixerModeButton').click(); await expect(page.locator('#tempoFromB')).toBeEnabled();
  for (const index of [0, 1]) {
    const name = `Stamp QA deck ${index}.mid`;
    await page.locator(`#deckFile${index}`).setInputFiles({ name, mimeType: 'audio/midi', buffer: sustainedMidi(60 + index * 7) });
    await expect(page.locator(`#deckSong${index} option:checked`)).toHaveText(name);
  }
  await arm(page);
  await page.locator('#mixerPlay').click(); await audible(page);
  await page.locator('#deckMute0').check(); await page.locator('#deckMute1').check();
  const before = await snapshot(page); await page.locator('#drawingModeButton').click();
  for (const id of ['heart', 'square', 'star', 'smile', 'zigzag']) await stamp(page, id).click();
  const played = await launches(page), current = await snapshot(page);
  expect(current.samples.map(sample => sample.id)).toEqual(played.slice(-4).map(sample => sample.id));
  expect(current.playing).toBe(true);
  expect(current.decks).toEqual(before.decks);
  const audio = await audible(page); await testInfo.attach('overlap-native-audio', { body: JSON.stringify(audio), contentType: 'application/json' });
  await page.locator('#mixerStopSamples').click(); await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
  expect((await snapshot(page)).samples).toEqual([]); await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).beat).toBeGreaterThan(before.beat + 1);
});

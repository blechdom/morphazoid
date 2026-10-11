import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const fileId = 'black-pattern-3-beat-funnel-128';

// A deliberately non-bar-length clip with a tempo change. Routing only its
// bytes leaves the real file excerpt encoder, synth and audio clock intact.
function tempoFixture({ end = 3.25, notes = [[0, 60, .25], [1, 64, .25], [2, 67, .25], [3, 72, .25]], tempos = [[0, 120], [2, 240]] } = {}) {
  const events = [[0, 192, 16], [0, 176, 91, 0], [0, 176, 93, 0], [0, 176, 94, 0]];
  for (const [beat, tempo] of tempos) {
    const mpq = Math.round(60000000 / tempo); events.push([beat, 255, 81, 3, mpq >>> 16, mpq >>> 8 & 255, mpq & 255]);
  }
  for (const [beat, note, duration] of notes) events.push([beat, 144, note, 96], [beat + duration, 128, note, 0]);
  events.push([end, 255, 47, 0]); let previous = 0; const track = [];
  for (const [beat, ...message] of events.sort((a, b) => a[0] - b[0])) {
    const tick = Math.round(beat * 480), delta = [(tick - previous) & 127]; let rest = tick - previous;
    while ((rest = Math.floor(rest / 128))) delta.unshift((rest & 127) | 128);
    track.push(...delta, ...message); previous = tick;
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224]), Buffer.from('MTrk'), length, Buffer.from(track)]);
}

async function open(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    globalThis.__stampLoopQA = { engine: null, contexts: [], launches: [], notes: [] };
    const Native = globalThis.AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __stampLoopQA.contexts.push(this); } };
  });
  await page.route(`**/assets/midiphoria/midi/${fileId}.mid`, route => route.fulfill({ contentType: 'audio/midi', body: tempoFixture() }));
  // Passive observers only: no fake audio context, note scheduler or output.
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume=MidiMixerEngine.prototype.setVolume,qaTrigger=MidiMixerEngine.prototype.triggerSample,qaObserved=new WeakSet();
      MidiMixerEngine.prototype.setVolume=function(...args){
        __stampLoopQA.engine=this;
        if(!qaObserved.has(this)){qaObserved.add(this);this.subscribeNotes(notes=>__stampLoopQA.notes.push(...notes.map(note=>({...note}))));}
        return qaVolume.apply(this,args);
      };
      MidiMixerEngine.prototype.triggerSample=function(...args){const sample=qaTrigger.apply(this,args);
        if(sample)__stampLoopQA.launches.push({id:sample.id,name:sample.name,loop:args[1]?.loop,sync:args[1]?.sync,
          duration:sample.analysis.durationBeats,tempoMap:sample.analysis.tempoMap,
          notes:sample.analysis.notes.map(({note,beat,duration})=>({note,beat,duration}))});return sample;
      };` });
  });
  await page.goto('/blech-midi.html');
  await expect(page.locator('#mixerStampCount')).toHaveText('58 / 58');
  return errors;
}
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function launch(page, action) {
  const count = await page.evaluate(() => __stampLoopQA.launches.length); await action();
  await expect.poll(() => page.evaluate(() => __stampLoopQA.launches.length)).toBe(count + 1);
  return page.evaluate(() => __stampLoopQA.launches.at(-1));
}
const stamp = (page, id) => page.locator(`[data-mixer-sample="${id}"]`);
const snapshot = page => page.evaluate(() => {
  const state = __stampLoopQA.engine.state;
  return { beat: state.beat, playing: state.playing, audio: state.audioEnabled, tempo: state.tempo,
    samples: state.samples.map(({ id, loop, sync, pending, positionBeats, cycle, tempo }) => ({ id, loop, sync, pending, positionBeats, cycle, tempo })) };
});
const attacks = (page, id, pitch = 60) => page.evaluate(({ id, pitch }) => __stampLoopQA.notes.filter(note => note.type === 'noteOn' && note.sampleId === id && note.note === pitch), { id, pitch });
async function transport(page) {
  // The standalone UI has no deck transport. Exercise the shared engine's
  // quantized-running-clock path with a muted original test fixture.
  await page.evaluate(async bytes => {
    const engine = __stampLoopQA.engine;
    if (!engine.state.decks[0].analysis) { await engine.loadDeck(0, new Uint8Array(bytes).buffer, 'Clock fixture'); engine.configureDeck(0, { gain: 0 }); }
    engine.state.playing ? engine.pause() : engine.play();
  }, Array.from(tempoFixture()));
}
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 }); }
async function audible(page) { await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 8000, intervals: [25, 50, 100] }).toBeGreaterThan(.001); }
async function silent(page) { await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001); }
async function noSamples(page) { await expect.poll(async () => (await snapshot(page)).samples.length).toBe(0); }
async function fixtureSource(page) {
  await input(page, 'mixerStampBeats', 4);
  // Keep the setup preview alive while the user opens its source controls.
  await page.locator('#mixerSampleLoop').check();
  await launch(page, () => stamp(page, fileId).click());
  const details = page.locator('.mixer-stamp-midi'); await details.locator(':scope > summary').click();
  await page.locator('#mixerStampSourceMode').selectOption('manual'); await page.locator('#mixerStampStart').fill('0');
  await details.locator(':scope > summary').click(); await page.locator('#mixerStopSamples').click();
}
async function assertPeriod(page, sampleId, seconds, { after = -Infinity, count = 4 } = {}) {
  // An immediate launch may rejoin its first held note a fraction into the
  // clip. Measure complete subsequent passes, never that initial remainder.
  const complete = async () => (await attacks(page, sampleId)).filter(note => note.at >= after).slice(after === -Infinity ? 1 : 0);
  await expect.poll(async () => (await complete()).length, { timeout: 12000 }).toBeGreaterThanOrEqual(count);
  const notes = (await complete()).slice(-count);
  const rate = await page.evaluate(() => __stampLoopQA.engine.context.sampleRate);
  for (let index = 1; index < notes.length; index++) expect(Math.abs(notes[index].at - notes[index - 1].at - seconds)).toBeLessThanOrEqual(2 / rate);
  return notes;
}

test('Loop and Sync default safely and apply to generated, file, message and drawing stamps without arming Audio', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#mixerSampleLoop')).not.toBeChecked(); await expect(page.locator('#mixerSampleSync')).toBeChecked();
  const first = await launch(page, () => stamp(page, 'heart').click()); expect(first.loop).toBe(false); expect(first.sync).toBe(true);
  await page.locator('#mixerSampleLoop').check(); await page.locator('#mixerSampleSync').uncheck();
  expect((await snapshot(page)).samples.every(sample => sample.loop && !sample.sync)).toBe(true);
  const generated = await launch(page, () => stamp(page, 'square').click());
  await page.locator('#mixerStopSamples').click();
  const file = await launch(page, () => stamp(page, fileId).click());
  expect(file.tempoMap.map(tempo => tempo.bpm)).toEqual([120, 240]);
  expect(file.notes[0].beat).toBe(0);
  await expect.poll(() => page.locator('#mixerPerformanceCanvas').getAttribute('data-history-sources')).toContain(`sample:${file.id}`);
  const captured = await page.locator('#mixerPerformanceCanvas').getAttribute('data-captured-notes').then(Number);
  await expect.poll(async () => (await snapshot(page)).samples.find(sample => sample.id === file.id)?.cycle, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  expect(await page.locator('#mixerPerformanceCanvas').getAttribute('data-captured-notes').then(Number)).toBeGreaterThan(captured);
  await page.locator('#mixerSampleMessage').fill('LOOP'); const message = await launch(page, () => page.locator('#mixerSendMessage').click());
  await page.locator('[data-drawing-stamp="❤"]').click();
  const drawing = await launch(page, () => page.locator('#generateDrawingMidi').click());
  for (const sample of [generated, file, message, drawing]) { expect(sample.loop).toBe(true); expect(sample.sync).toBe(false); }
  await page.locator('#mixerStopSamples').click(); await noSamples(page);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect(await page.evaluate(() => __stampLoopQA.contexts.length)).toBe(0); expect(errors).toEqual([]);
});

test('native stamp loops repeat their actual duration, track live master tempo and finish the current pass when Loop is disabled', async ({ page }, testInfo) => {
  test.setTimeout(60000); const errors = await open(page); await fixtureSource(page);
  await input(page, 'creativeTempo', 300); await page.locator('#mixerSampleLoop').check(); await arm(page); await transport(page);
  const sample = await launch(page, () => page.locator('#mixerStampAgain').click()); expect(sample.duration).toBe(3.25);
  expect(sample.tempoMap.map(tempo => [tempo.beat, tempo.bpm])).toEqual([[0, 120], [2, 240]]);
  await audible(page); const fast = await assertPeriod(page, sample.id, .65);
  expect((await snapshot(page)).samples.find(item => item.id === sample.id)?.cycle).toBeGreaterThanOrEqual(3);
  await expect.poll(() => page.locator('#mixerPerformanceCanvas').getAttribute('data-history-sources')).toContain(`sample:${sample.id}`);
  const captured = await page.locator('#mixerPerformanceCanvas').getAttribute('data-captured-notes').then(Number);
  await input(page, 'creativeTempo', 150); const changedAt = await page.evaluate(() => __stampLoopQA.engine.context.currentTime);
  const slow = await assertPeriod(page, sample.id, 1.3, { after: changedAt + 1.3, count: 3 });
  expect(await page.locator('#mixerPerformanceCanvas').getAttribute('data-captured-notes').then(Number)).toBeGreaterThan(captured);
  await audible(page); const envelope = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 30 });
  expect(envelope.summary.finite).toBe(true); expect(envelope.summary.maxPeak).toBeLessThanOrEqual(.981);
  // Toggle early in a pass so a natural end cannot race the assertion.
  await page.waitForFunction(id => { const sample = __stampLoopQA.engine.state.samples.find(sample => sample.id === id); return sample && sample.positionBeats > .2 && sample.positionBeats < 1; }, sample.id);
  await page.locator('#mixerSampleLoop').uncheck();
  const finishing = (await snapshot(page)).samples.find(item => item.id === sample.id); expect(finishing).toBeTruthy(); expect(finishing.loop).toBe(false);
  await noSamples(page); await silent(page); expect((await snapshot(page)).playing).toBe(true);
  const completed = (await attacks(page, sample.id)).length; await page.waitForTimeout(750); expect((await attacks(page, sample.id)).length).toBe(completed);
  // A two-beat loop at120 BPM also lands exactly on a 128-frame block edge at
  // 48 kHz. Every subsequent beat-zero attack must survive the wrap.
  await input(page, 'creativeTempo', 120);
  const alignedId = await page.evaluate(bytes => __stampLoopQA.engine.triggerSample(new Uint8Array(bytes).buffer, { name: 'Beat-zero loop', loop: true, sync: true, program: 16 }).id,
    Array.from(tempoFixture({ end: 2, notes: [[0, 60, 2]], tempos: [[0, 120]] })));
  const aligned = await assertPeriod(page, alignedId, 1, { count: 3 }); await audible(page);
  await page.locator('#mixerStopSamples').click(); await noSamples(page); await silent(page);
  await testInfo.attach('native-loop-tempo', { body: JSON.stringify({ fast, slow, aligned, envelope: envelope.summary }), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('native free stamps preserve source tempo changes and live Sync preserves position without reattacking or requantizing', async ({ page }, testInfo) => {
  test.setTimeout(60000); const errors = await open(page); await fixtureSource(page); await input(page, 'creativeTempo', 300);
  await page.locator('#mixerSampleLoop').check(); await page.locator('#mixerSampleSync').uncheck(); await arm(page); await transport(page);
  const sample = await launch(page, () => page.locator('#mixerStampAgain').click());
  const free = await assertPeriod(page, sample.id, 1.3125, { count: 3 }); await audible(page);
  const all = await page.evaluate(id => __stampLoopQA.notes.filter(note => note.type === 'noteOn' && note.sampleId === id), sample.id);
  const start = all.findIndex(note => note.at === free[0].at), sequence = all.slice(start, start + 5), rate = await page.evaluate(() => __stampLoopQA.engine.context.sampleRate);
  expect(sequence.map(note => note.note)).toEqual([60, 64, 67, 72, 60]);
  for (const [index, seconds] of [[1, .5], [2, .5], [3, .25], [4, .0625]]) expect(Math.abs(sequence[index].at - sequence[index - 1].at - seconds)).toBeLessThanOrEqual(2 / rate);
  await input(page, 'creativeTempo', 60); const changedAt = await page.evaluate(() => __stampLoopQA.engine.context.currentTime);
  await assertPeriod(page, sample.id, 1.3125, { after: changedAt, count: 3 });
  await page.waitForFunction(id => { const sample = __stampLoopQA.engine.state.samples.find(sample => sample.id === id); return sample && sample.positionBeats > .04 && sample.positionBeats < .12; }, sample.id);
  // Execute the toggle and snapshots in one task. No beat/phase or event reset
  // can be hidden by Playwright's scrolling/actionability waits.
  const continuity = await page.evaluate(async id => {
    const qa = __stampLoopQA, before = qa.engine.state.samples.find(sample => sample.id === id), attacks = qa.notes.filter(note => note.type === 'noteOn' && note.sampleId === id).length;
    document.getElementById('mixerSampleSync').click();
    const immediate = qa.engine.state.samples.find(sample => sample.id === id);
    await new Promise(resolve => setTimeout(resolve, 100)); const after = qa.engine.state.samples.find(sample => sample.id === id);
    return { before: { position: before.positionBeats, cycle: before.cycle }, immediate: { position: immediate.positionBeats, cycle: immediate.cycle, pending: immediate.pending, sync: immediate.sync },
      after: { position: after.positionBeats, cycle: after.cycle, pending: after.pending }, attacks, immediateAttacks: qa.notes.filter(note => note.type === 'noteOn' && note.sampleId === id).length };
  }, sample.id);
  expect(continuity.immediate.sync).toBe(true); expect(continuity.immediate.pending).toBe(false);
  expect(continuity.immediate.cycle).toBe(continuity.before.cycle); expect(Math.abs(continuity.immediate.position - continuity.before.position)).toBeLessThan(.03);
  expect(continuity.after.pending).toBe(false);
  expect(continuity.immediateAttacks).toBe(continuity.attacks);
  expect(continuity.after.position - continuity.immediate.position).toBeGreaterThan(.05);
  expect(continuity.after.position - continuity.immediate.position).toBeLessThan(.2);
  // A newly launched synced stamp is queued; disabling Sync starts that same
  // instance immediately instead of waiting for the next one-second beat.
  await page.evaluate(() => { __stampLoopQA.engine.stopSamples(); });
  await page.waitForFunction(() => { const phase = __stampLoopQA.engine.state.beat % 1; return phase > .15 && phase < .35; });
  const queued = await page.evaluate(() => {
    const count = __stampLoopQA.launches.length;
    document.getElementById('mixerStampAgain').click();
    return count + 1;
  });
  await expect.poll(() => page.evaluate(() => __stampLoopQA.launches.length)).toBe(queued);
  const pending = (await snapshot(page)).samples.at(-1); expect(pending?.pending).toBe(true);
  const released = await page.evaluate(() => {
    const qa = __stampLoopQA, before = qa.engine.state.samples.at(-1); document.getElementById('mixerSampleSync').click();
    const after = qa.engine.state.samples.at(-1); return { before: before.id, after: after.id, pending: after.pending, sync: after.sync };
  });
  expect(released).toEqual({ before: pending.id, after: pending.id, pending: false, sync: false }); await audible(page);
  await page.locator('#mixerStopSamples').click(); await noSamples(page); await silent(page);
  await testInfo.attach('native-free-tempo-and-sync', { body: JSON.stringify({ free, sequence, continuity, released }), contentType: 'application/json' }); expect(errors).toEqual([]);
});

test('native looping stamps stop on shared-engine Pause, Stop samples and Audio off, and can launch immediately while transport is paused', async ({ page }) => {
  test.setTimeout(60000); const errors = await open(page); await fixtureSource(page); await page.locator('#mixerSampleLoop').check(); await arm(page);
  const paused = await launch(page, () => page.locator('#mixerStampAgain').click());
  expect((await snapshot(page)).playing).toBe(false); expect((await snapshot(page)).samples.find(sample => sample.id === paused.id)?.pending).toBe(false); await audible(page);
  await page.locator('#mixerStopSamples').click(); await noSamples(page); await silent(page);
  await transport(page); await launch(page, () => page.locator('#mixerStampAgain').click()); await audible(page);
  await transport(page); await noSamples(page); await silent(page);
  await launch(page, () => page.locator('#mixerStampAgain').click()); await audible(page); await page.locator('#audioButton').click();
  await noSamples(page); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#mixerSampleSync').uncheck(); await page.locator('#mixerSampleSync').check(); await page.locator('#mixerSampleLoop').uncheck(); await page.locator('#mixerSampleLoop').check();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); await arm(page); await silent(page); await noSamples(page);
  await launch(page, () => page.locator('#mixerStampAgain').click()); await audible(page); await page.locator('#creativeStop').click(); await noSamples(page); await silent(page);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Loop and Sync controls are compact, keyboard accessible and reachable at ${viewport.width}×${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000 }); const page = await context.newPage();
    try {
      const errors = await open(page), group = page.getByRole('group', { name: 'Stamp playback', exact: true });
      await expect(group).toBeVisible(); await group.scrollIntoViewIfNeeded();
      for (const [id, name, initial] of [['mixerSampleLoop', 'Loop', false], ['mixerSampleSync', 'Sync to tempo', true]]) {
        const control = group.getByRole('checkbox', { name, exact: true }); await expect(page.locator(`#${id}`)).toHaveCount(1);
        await control.focus(); await control.press('Space'); await expect(control).toBeChecked({ checked: !initial });
        await control.press('Space'); await expect(control).toBeChecked({ checked: initial });
        const box = await control.locator('..').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        if (viewport.width < 1000) expect(box.height).toBeGreaterThanOrEqual(48);
      }
      const geometry = await page.evaluate(() => {
        const group = document.querySelector('.mixer-stamp-switches').getBoundingClientRect(), live = document.querySelector('#creativeVisualizerHost').getBoundingClientRect();
        return { gap: group.top - live.bottom, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      expect(geometry.gap).toBeGreaterThanOrEqual(0); expect(geometry.gap).toBeLessThan(30); expect(geometry.overflow).toBe(false);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false'); expect(await page.evaluate(() => __stampLoopQA.contexts.length)).toBe(0); expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`stamp-loop-${viewport.width}.png`) });
    } finally { await context.close(); }
  });
}

import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page), 'uncaught browser errors').toEqual([]); });

function vlq(value) { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; }
// A sustained organ pulse every second makes the first chord and its echo
// distinguishable from the next source attack without mocking a musical clock.
function fixture() {
  const events = [{ tick: 0, bytes: [255, 81, 3, 7, 161, 32] }, { tick: 0, bytes: [192, 16] }];
  for (let beat = 0; beat < 64; beat += 2) events.push(
    { tick: beat * 480, bytes: [144, 60, 100] }, { tick: (beat + 1.5) * 480, bytes: [128, 60, 0] });
  const track = []; let previous = 0;
  for (const event of events.sort((a, b) => a.tick - b.tick)) { track.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick; }
  track.push(...vlq(64 * 480 - previous), 255, 47, 0);
  const length = Buffer.alloc(4); length.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224]), Buffer.from('MTrk'), length, Buffer.from(track)]);
}
const views = [
  { name: 'Midiophilia', mode: 'visual', prefix: 'visualNoteFx', route: '/midiphoria.html', play: '#playButton', stop: '#stopButton' },
  { name: 'MIDI Mixer', mode: 'mixer', prefix: 'mixerNoteFx', route: '/midiphoria.html', play: '#mixerPlay', stop: '#mixerStop' },
  { name: 'Blech MIDI', mode: 'blech', prefix: 'blechNoteFx', route: '/blech-midi.html', stop: '#creativeStop' },
];

async function observe(page) {
  await page.addInitScript(() => {
    globalThis.__noteFxQA = { contexts: [], notes: [], graphics: [], player: null, engine: null, sampleId: null };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __noteFxQA.contexts.push(this); } };
  });
  // These observers preserve the real worklet, SoundFont, output connection and
  // renderer. Native note notifications are the sound/graphics joining seam.
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaLoad = MidiphoriaPlayer.prototype.load;
      MidiphoriaPlayer.prototype.load = function(...args) {
        if (__noteFxQA.player !== this) { __noteFxQA.player = this; const midi = this.onMidi;
          this.onMidi = message => { __noteFxQA.notes.push({ ...message, received: performance.now() }); return midi?.(message); }; }
        return qaLoad.apply(this, args);
      };` });
  });
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaSubscribe = MidiMixerEngine.prototype.subscribeNotes, qaPublish = MidiMixerEngine.prototype._publishNotes;
      MidiMixerEngine.prototype.subscribeNotes = function(...args) { __noteFxQA.engine = this; return qaSubscribe.apply(this, args); };
      MidiMixerEngine.prototype._publishNotes = function(notes) { __noteFxQA.notes.push(...notes.map(note => ({ ...note, received: performance.now() }))); return qaPublish.call(this, notes); };` });
  });
  await page.route('**/src/instruments/midiphoria/midiphoria-renderer.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaCapture = MidiphoriaRenderer.prototype.captureEvent;
      MidiphoriaRenderer.prototype.captureEvent = function(event) { __noteFxQA.graphics.push({ ...event }); return qaCapture.call(this, event); };` });
  });
}
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function open(page, view, { load = true } = {}) {
  await observe(page); await page.goto(view.route);
  if (view.mode === 'mixer') {
    await page.locator('#mixerModeButton').click(); await expect(page.locator('#tempoFromB')).toBeEnabled();
    if (load) {
      for (const index of [0, 1]) {
        await page.locator(`#deckFile${index}`).setInputFiles({ name: `FX pulse ${index}.mid`, mimeType: 'audio/midi', buffer: fixture() });
        await expect(page.locator(`#deckSong${index} option:checked`)).toHaveText(`FX pulse ${index}.mid`);
      }
      await page.locator('#deckMute1').check(); await input(page, 'masterTempo', 120);
    }
  } else if (view.mode === 'visual' && load) {
    await page.locator('#midiFile').setInputFiles({ name: 'FX pulse.mid', mimeType: 'audio/midi', buffer: fixture() });
    await expect(page.locator('#songList button[data-song-id="local-1"]')).toHaveAttribute('aria-pressed', 'true');
  }
  const details = page.locator(`#${view.prefix}Enabled`).locator('xpath=ancestor::details[1]');
  await details.locator(':scope > summary').click(); await expect(page.locator(`#${view.prefix}Enabled`)).toBeVisible();
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
}
async function start(page, view) {
  if (view.mode === 'blech') {
    await page.evaluate(bytes => {
      const sample = __noteFxQA.engine.triggerSample(Uint8Array.from(bytes).buffer, { name: 'FX pulse', program: 16, gain: .7, loop: true, sync: true });
      __noteFxQA.sampleId = sample.id;
    }, Array.from(fixture()));
  } else {
    await page.locator(view.play).click(); await expect(page.locator(view.play)).toHaveAttribute('aria-pressed', 'true');
  }
}
async function position(page, view) {
  return page.evaluate(mode => mode === 'visual' ? __noteFxQA.player.state.time : mode === 'mixer' ? __noteFxQA.engine.state.beat
    : __noteFxQA.engine.state.samples.find(sample => sample.id === __noteFxQA.sampleId)?.positionBeats ?? -1, view.mode);
}
const attacks = page => page.evaluate(() => __noteFxQA.notes.filter(note => note.type === 'noteOn' && note.velocity > 0));
async function resetObservations(page) { await page.evaluate(() => { __noteFxQA.notes = []; __noteFxQA.graphics = []; }); }

for (const view of views) test(`${view.name}: native note effects reach sound and graphics, preserve transport and cancel on Stop`, async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page, view);
  await page.locator(`#${view.prefix}Enabled`).check(); await input(page, `${view.prefix}Transpose`, 12);
  await page.locator(`#${view.prefix}Chord`).selectOption('major');
  await input(page, `${view.prefix}EchoCount`, 1); await input(page, `${view.prefix}EchoBeats`, .5);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __noteFxQA.contexts.length)).toBe(0);
  if (view.mode !== 'visual') {
    await start(page, view); const before = await position(page, view);
    await expect.poll(() => position(page, view)).toBeGreaterThan(before + .2);
    expect(await page.evaluate(() => __noteFxQA.contexts.length)).toBe(0);
    await page.locator(view.stop).click();
  }
  await arm(page); await resetObservations(page); await start(page, view);
  await expect.poll(async () => (await attacks(page)).length).toBeGreaterThanOrEqual(6);
  expect((await attacks(page)).slice(0, 6).map(note => note.note).sort((a, b) => a - b)).toEqual([72,72,76,76,79,79]);
  await expect.poll(() => page.evaluate(() => [...new Set(__noteFxQA.graphics.filter(note => note.type === 'noteOn').map(note => note.note))].sort((a, b) => a - b))).toEqual([72,76,79]);
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeGreaterThan(.001);
  const sound = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 30 });
  expect(sound.summary.finite).toBe(true); expect(sound.summary.maxRms).toBeGreaterThan(.001);
  expect(sound.summary.clippedSamples).toBe(0); expect(sound.summary.maxPeak).toBeLessThanOrEqual(.981);
  await testInfo.attach(`${view.mode}-native-effects`, { body: JSON.stringify(sound.summary), contentType: 'application/json' });

  const beforeEdit = await position(page, view); await resetObservations(page);
  await input(page, `${view.prefix}Transpose`, 7);
  await expect.poll(async () => (await attacks(page)).some(note => note.note === 67)).toBe(true);
  await expect.poll(() => position(page, view)).toBeGreaterThan(beforeEdit);
  await expect.poll(() => page.evaluate(() => __noteFxQA.graphics.some(note => note.type === 'noteOn' && note.note === 67))).toBe(true);
  const before = await position(page, view); await resetObservations(page);
  await page.locator(`#${view.prefix}Enabled`).uncheck();
  await expect.poll(async () => (await attacks(page)).some(note => note.note === 60)).toBe(true);
  await expect.poll(() => position(page, view)).toBeGreaterThan(before);
  if (view.play) await expect(page.locator(view.play)).toHaveAttribute('aria-pressed', 'true');
  else expect(await page.evaluate(() => __noteFxQA.engine.state.samples.some(sample => sample.id === __noteFxQA.sampleId))).toBe(true);
  await page.locator(view.stop).click();
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);

  // A future delayed chord must never attack after a user Stop. Start/Stop use
  // normal controls; Blech launches a tiny source through its native sample API.
  await input(page, `${view.prefix}DelayBeats`, 1); await page.locator(`#${view.prefix}Enabled`).check();
  await resetObservations(page); await start(page, view); await page.locator(view.stop).click();
  const stopped = await sampleAudioEnvelope(page, { durationMs: 900, intervalMs: 40 });
  expect(await attacks(page)).toEqual([]); expect(stopped.summary.maxPeak).toBeLessThan(.0001);
  await page.locator('#audioButton').click(); await page.locator(`#${view.prefix}Enabled`).uncheck();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __noteFxQA.contexts.length)).toBe(1);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`all MIDI effects controls are reachable at ${viewport.width}×${viewport.height} without arming Audio`, async ({ browser }, testInfo) => {
    test.setTimeout(60000);
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 });
    const page = await context.newPage(), failures = []; page.on('pageerror', error => failures.push(error.message));
    try {
      for (const view of views) {
        await open(page, view, { load: false });
        for (const suffix of ['Enabled', 'Chord', 'Transpose', 'Velocity', 'DelayBeats', 'GateBeats', 'EchoCount', 'EchoBeats', 'EchoDecay', 'Drums']) {
          const control = page.locator(`#${view.prefix}${suffix}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
          const bounds = await control.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(-1); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
        }
        await page.locator(`#${view.prefix}Enabled`).check(); await input(page, `${view.prefix}Transpose`, 7);
        await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
        expect(await page.evaluate(() => __noteFxQA.contexts.length)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await testInfo.attach(`${view.mode}-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
        // Remove route instrumentation before installing the next page's fresh
        // observer; repeated wrappers would otherwise duplicate note counts.
        await page.unrouteAll();
      }
      expect(failures).toEqual([]);
    } finally { await context.close(); }
  });
}

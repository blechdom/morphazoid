import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page), 'uncaught browser errors').toEqual([]); });

function midi(notes, { end = 8, pan = 64, changePan = false } = {}) {
  const events = [[0, 192, 16], [0, 176, 7, 100], [0, 176, 10, pan],
    [0, 176, 91, 0], [0, 176, 93, 0], [0, 176, 94, 0]];
  if (changePan) events.push([4, 176, 10, 127]);
  for (const [beat, note, duration, velocity = 96] of notes) events.push([beat, 144, note, velocity], [beat + duration, 128, note, 0]);
  events.push([end, 255, 47, 0]); const track = []; let previous = 0;
  for (const [beat, ...message] of events.sort((a, b) => a[0] - b[0])) {
    const tick = Math.round(beat * 480), delta = [tick - previous & 127]; let rest = tick - previous;
    while ((rest = Math.floor(rest / 128))) delta.unshift((rest & 127) | 128);
    track.push(...delta, ...message); previous = tick;
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224]), Buffer.from('MTrk'), length, Buffer.from(track)]);
}
const held = (note, pan = 64) => midi([[0, note, 32]], { end: 32, pan });
const asymmetric = () => midi([[0, 60, 1, 80], [2, 64, 2, 96], [5.5, 67, .5, 110]], { pan: 0, changePan: true });
const noteShape = analysis => analysis.notes.map(({ beat, note, duration, velocity, channel }) => ({ beat, note, duration, velocity, channel }));
function panAt(analysis, beat) { return analysis.events.filter(event => event.kind === 11 && event.a === 10 && event.beat <= beat).at(-1)?.b; }

async function observe(page) {
  await page.addInitScript(() => {
    globalThis.__reverseWeaveQA = { engine: null, contexts: [], notes: [] };
    const Native = globalThis.AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __reverseWeaveQA.contexts.push(this); } };
  });
  // Passive instance and scheduled-note observers. The production clock,
  // SoundFont, audio worklet and default output destination remain native.
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume = MidiMixerEngine.prototype.setVolume, qaObserved = new WeakSet();
      MidiMixerEngine.prototype.setVolume = function(...args) {
        __reverseWeaveQA.engine = this;
        if (!qaObserved.has(this)) { qaObserved.add(this); this.subscribeNotes(notes => {
          __reverseWeaveQA.notes.push(...notes.map(note => ({...note})));
          if (__reverseWeaveQA.notes.length > 12000) __reverseWeaveQA.notes.splice(0, 6000);
        }); }
        return qaVolume.apply(this, args);
      };
    ` });
  });
}
async function input(page, id, value, type = 'change') {
  await page.locator(`#${id}`).evaluate((node, { value, type }) => {
    node.value = String(value); node.dispatchEvent(new Event(type, { bubbles: true }));
  }, { value, type });
}
async function open(page, sources = [held(60, 0), held(72, 127)]) {
  await observe(page); await page.goto('/midiphoria.html'); await page.locator('#mixerModeButton').click();
  await expect(page.locator('#tempoFromB')).toBeEnabled();
  for (let index = 0; index < 2; index++) {
    await page.locator(`#deckFile${index}`).setInputFiles({ name: `Reverse weave ${index}.mid`, mimeType: 'audio/midi', buffer: sources[index] });
    await expect(page.locator(`#deckSong${index} option:checked`)).toHaveText(`Reverse weave ${index}.mid`);
  }
  await input(page, 'masterTempo', 120, 'input');
}
async function expandWeave(page) {
  const details = page.locator('#mixerWeaveSettings'); if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click();
}
async function reverse(page, index, mode) {
  if (mode !== 'off') await page.locator(`#deckReverseMode${index}`).selectOption(mode);
  const pressed = await page.locator(`#deckReverse${index}`).getAttribute('aria-pressed');
  if ((pressed === 'true') !== (mode !== 'off')) await page.locator(`#deckReverse${index}`).click();
  await expect.poll(() => page.evaluate(index => __reverseWeaveQA.engine.state.decks[index].config.reverse, index)).toBe(mode);
  await expect(page.locator(`#deckReverse${index}`)).toBeEnabled();
}
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 }); }
async function download(page, index) {
  const pending = page.waitForEvent('download'); await page.locator(`#deckReverseDownload${index}`).click();
  const result = await pending; expect(result.suggestedFilename()).toMatch(/\.mid$/); return readFile(await result.path());
}
const snapshot = page => page.evaluate(() => {
  const state = __reverseWeaveQA.engine.state;
  return { playing: state.playing, audioEnabled: state.audioEnabled, beat: state.beat,
    weave: state.weave, active: state.currentWeaveDeck, step: state.weaveStep,
    decks: state.decks.map(deck => ({ position: deck.positionBeats, active: deck.weaveActive, reverse: deck.config.reverse, rate: deck.config.rate })) };
});
const notes = page => page.evaluate(() => __reverseWeaveQA.notes);
async function stableTurnWindow(page, active = 1) {
  // Retry a sample that crosses a natural handoff; compare positions against
  // the observed audio beat delta rather than assuming an exact wall delay.
  for (let attempt = 0; attempt < 16; attempt++) {
    await page.waitForFunction(active => __reverseWeaveQA.engine.state.currentWeaveDeck === active, active);
    const before = await snapshot(page); await page.waitForTimeout(100); const after = await snapshot(page);
    if (before.active === active && after.active === active && before.step === after.step
      && after.beat > before.beat && after.beat - before.beat < before.weave.length) return { before, after };
  }
  throw new Error('Could not observe a stable active-deck turn window.');
}
async function audible(page, testInfo, name) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 30 });
  expect(summary.finite).toBe(true); expect(summary.clippedSamples).toBe(0); expect(summary.maxPeak).toBeLessThanOrEqual(.981);
  await testInfo.attach(name, { body: JSON.stringify(summary), contentType: 'application/json' });
}
async function stereoProbe(page) {
  await page.evaluate(() => {
    const engine = __reverseWeaveQA.engine, splitter = engine.context.createChannelSplitter(2);
    const left = engine.context.createAnalyser(), right = engine.context.createAnalyser(); left.fftSize = right.fftSize = 2048;
    engine._ceiling.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
    __reverseWeaveQA.stereo = { left, right, splitter };
  });
}
async function stereo(page) {
  return page.evaluate(async () => {
    const data = new Float32Array(2048), sums = [0, 0]; let count = 0, peak = 0;
    for (let index = 0; index < 5; index++) {
      [__reverseWeaveQA.stereo.left, __reverseWeaveQA.stereo.right].forEach((meter, side) => {
        meter.getFloatTimeDomainData(data); for (const value of data) { sums[side] += value * value; peak = Math.max(peak, Math.abs(value)); }
      }); count += data.length; await new Promise(resolve => setTimeout(resolve, 30));
    }
    return { left: Math.sqrt(sums[0] / count), right: Math.sqrt(sums[1] / count), peak };
  });
}

test('reverse modes export reflected note gates and controller states while retaining the original MIDI and Audio-off transport', async ({ page }) => {
  const original = asymmetric(); await open(page, [original, held(72)]);
  await page.locator('#deckReverseMode0').selectOption('controllers');
  await expect(page.locator('#deckReverse0')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#deckReverseDownload0')).toBeHidden();
  await page.locator('#mixerPlay').click(); await reverse(page, 0, 'controllers');
  const aware = parseMidi(await download(page, 0));
  expect(noteShape(aware)).toEqual([
    { beat: 2, note: 67, duration: .5, velocity: 110, channel: 0 },
    { beat: 4, note: 64, duration: 2, velocity: 96, channel: 0 },
    { beat: 7, note: 60, duration: 1, velocity: 80, channel: 0 },
  ]);
  expect(panAt(aware, .5)).toBe(127); expect(panAt(aware, 5)).toBe(0);
  await reverse(page, 0, 'notes'); const onlyNotes = parseMidi(await download(page, 0));
  expect(noteShape(onlyNotes)).toEqual(noteShape(aware)); expect(panAt(onlyNotes, .5)).toBe(0); expect(panAt(onlyNotes, 5)).toBe(0);
  await reverse(page, 0, 'off'); await expect(page.locator('#deckReverseDownload0')).toBeHidden();
  expect(await page.evaluate(() => Array.from(new Uint8Array(__reverseWeaveQA.engine.getDeckMidi(0))))).toEqual(Array.from(original));
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __reverseWeaveQA.contexts.length)).toBe(0);
  // A queued rewrite must not undo the later reset in the same event turn.
  await page.evaluate(async () => {
    document.getElementById('deckReverse0').click(); document.getElementById('mixerReset').click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect((await snapshot(page)).decks[0].reverse).toBe('off');
  await expect(page.locator('#deckReverse0')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#deckReverseDownload0')).toBeHidden();
  expect(await page.evaluate(() => __reverseWeaveQA.contexts.length)).toBe(0);
});

test('native controller-aware reverse changes audible pan and restores the correct state through seeking and looping', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page, [midi([[0, 60, 8]], { pan: 0, changePan: true }), held(72)]);
  await page.locator('#deckMute1').check(); await input(page, 'mixerCrossfade', -1, 'input');
  await reverse(page, 0, 'controllers'); await arm(page); await stereoProbe(page); await page.locator('#mixerPlay').click();
  await audible(page, testInfo, 'reverse-native');
  await expect.poll(async () => { const value = await stereo(page); return value.right / Math.max(1e-6, value.left); }).toBeGreaterThan(5);
  const backwardRight = await stereo(page);
  await reverse(page, 0, 'notes'); await input(page, 'deckScrub0', .5, 'input');
  await expect.poll(async () => { const value = await stereo(page); return value.left / Math.max(1e-6, value.right); }).toBeGreaterThan(5);
  const notesLeft = await stereo(page);
  await reverse(page, 0, 'off'); await input(page, 'deckScrub0', 5, 'input');
  await expect.poll(async () => { const value = await stereo(page); return value.right / Math.max(1e-6, value.left); }).toBeGreaterThan(5);
  await reverse(page, 0, 'controllers'); await input(page, 'deckScrub0', 5, 'input');
  await expect.poll(async () => { const value = await stereo(page); return value.left / Math.max(1e-6, value.right); }).toBeGreaterThan(5);
  await input(page, 'deckLoopEnd0', 2); await input(page, 'deckScrub0', 1.8, 'input'); await page.waitForTimeout(400);
  await expect.poll(async () => { const value = await stereo(page); return value.right / Math.max(1e-6, value.left); }).toBeGreaterThan(5);
  expect((await snapshot(page)).playing).toBe(true); expect((await snapshot(page)).audioEnabled).toBe(true);
  await testInfo.attach('reverse-native-stereo', { body: JSON.stringify({ backwardRight, notesLeft }), contentType: 'application/json' });
  await page.locator('#mixerStop').click(); await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
});

async function installStallProbe(page) {
  await page.evaluate(async () => {
    const engine = __reverseWeaveQA.engine;
    const source = `class WeaveProbe extends AudioWorkletProcessor {
      constructor(){super();this.reset();this.port.onmessage=({data})=>{if(data==='reset')this.reset();this.port.postMessage({frames:this.frames,rms:Math.sqrt(this.energy/Math.max(1,this.frames)),nonfinite:this.nonfinite,longestZeroFrames:this.longest});};}
      reset(){this.frames=0;this.energy=0;this.nonfinite=0;this.zeros=0;this.longest=0;}
      process(inputs){const channels=inputs[0];if(!channels?.length)return true;for(let i=0;i<channels[0].length;i++){let energy=0;for(const channel of channels){const x=channel[i];if(!Number.isFinite(x))this.nonfinite++;energy+=x*x;}this.energy+=energy;this.zeros=energy<1e-14?this.zeros+1:0;this.longest=Math.max(this.longest,this.zeros);this.frames++;}return true;}
    }registerProcessor('reverse-weave-probe',WeaveProbe);`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); await engine.context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const probe = new AudioWorkletNode(engine.context, 'reverse-weave-probe'); engine._ceiling.connect(probe); probe.connect(engine.context.destination);
    __reverseWeaveQA.probe = probe; __reverseWeaveQA.probeRequest = command => new Promise(resolve => { probe.port.onmessage = ({ data }) => resolve(data); probe.port.postMessage(command); });
  });
}

test('native Weave handoffs alternate notes and grey maps on the audio clock even during a UI stall', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page); await expandWeave(page);
  await page.locator('#mixerWeaveAdvance').selectOption('turns');
  await page.locator('[data-weave-length="1"][data-weave-unit="beats"]').click(); await page.locator('#mixerWeaveToggle').click();
  await arm(page); await installStallProbe(page); await page.locator('#mixerPlay').click();
  await expect.poll(async () => (await notes(page)).filter(note => note.type === 'noteOn' && note.deck !== null).length).toBeGreaterThanOrEqual(3);
  const stall = await page.evaluate(async () => {
    await __reverseWeaveQA.probeRequest('reset'); const until = performance.now() + 700; while (performance.now() < until) { /* Block only the UI thread. */ }
    return __reverseWeaveQA.probeRequest('stats');
  });
  expect(stall.frames).toBeGreaterThan(16000); expect(stall.nonfinite).toBe(0); expect(stall.rms).toBeGreaterThan(.001); expect(stall.longestZeroFrames).toBeLessThan(2048);
  await expect.poll(async () => (await notes(page)).filter(note => note.type === 'noteOn' && note.deck !== null).length).toBeGreaterThanOrEqual(8);
  const events = await notes(page), attacks = events.filter(note => note.type === 'noteOn' && note.deck !== null).slice(0, 8);
  expect(attacks.map(note => note.deck)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
  const sampleRate = await page.evaluate(() => __reverseWeaveQA.engine.context.sampleRate);
  for (let index = 1; index < attacks.length; index++) {
    expect(Math.abs(attacks[index].at - attacks[index - 1].at - .5)).toBeLessThanOrEqual(2 / sampleRate);
    const release = events.find(note => note.type === 'noteOff' && note.id === attacks[index - 1].id);
    expect(release).toBeTruthy(); expect(Math.abs(release.at - attacks[index].at)).toBeLessThanOrEqual(2 / sampleRate);
  }
  await expect.poll(() => page.evaluate(() => {
    const state = __reverseWeaveQA.engine.state, step = document.querySelector('#mixerWeaveSteps [aria-current="step"]');
    return Number(step?.dataset.weaveStep) === state.weaveStep && [0, 1].every(index =>
      document.querySelector(`.mixer-deck[data-deck="${index}"]`).dataset.weaveActive === String(state.decks[index].weaveActive));
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const state = __reverseWeaveQA.engine.state;
    return [0, 1].every(index => {
      const canvas = document.getElementById(`deckMap${index}`), pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let grey = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 70 && pixels[i + 1] === 81 && pixels[i + 2] === 79) grey++;
      return state.decks[index].weaveActive ? grey === 0 : grey > 0;
    });
  })).toBe(true);
  await testInfo.attach('weave-native-boundaries', { body: JSON.stringify({ sampleRate, attacks, stall }), contentType: 'application/json' });
  await page.locator('#mixerStop').click(); await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
});

test('reverse and Weave compose while turn-only and running cursors, pattern recipes and bar lengths remain editable', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page, [midi([[0, 60, 1], [1, 64, 1], [2, 67, 2]], { end: 4 }), held(72)]);
  await reverse(page, 0, 'controllers'); await expandWeave(page); await page.locator('[data-weave-length="1"][data-weave-unit="beats"]').click();
  await page.locator('#mixerWeaveAdvance').selectOption('turns');
  await page.locator('#mixerWeaveToggle').click(); await arm(page); await page.locator('#mixerPlay').click();
  await expect.poll(async () => (await notes(page)).filter(note => note.type === 'noteOn' && note.deck === 0).length).toBeGreaterThanOrEqual(3);
  expect((await notes(page)).filter(note => note.type === 'noteOn' && note.deck === 0).slice(0, 3).map(note => note.note)).toEqual([67, 67, 64]);
  await page.locator('[data-weave-length="3"][data-weave-unit="beats"]').click();
  const { before, after } = await stableTurnWindow(page);
  expect(Math.abs(after.decks[0].position - before.decks[0].position)).toBeLessThan(.02);
  expect((after.decks[1].position - before.decks[1].position + 32) % 32).toBeCloseTo((after.beat - before.beat) % 32, 1);
  await page.locator('#mixerWeaveAdvance').selectOption('running');
  const running = await stableTurnWindow(page), elapsed = running.after.beat - running.before.beat;
  expect(elapsed).toBeGreaterThan(0);
  for (const [index, loop] of [[0, 4], [1, 32]]) {
    expect((running.after.decks[index].position - running.before.decks[index].position + loop) % loop).toBeCloseTo(elapsed % loop, 1);
  }
  await page.locator('[data-weave-pattern="ABBA"]').click(); await page.locator('[data-weave-length="3"][data-weave-unit="bars"]').click();
  await input(page, 'mixerWeaveBarBeats', 3);
  await expect(page.locator('#mixerWeaveSteps [data-weave-step]')).toHaveCount(4);
  await expect(page.locator('#mixerWeaveHelp')).toContainText('3 beats per bar');
  expect((await snapshot(page)).weave).toMatchObject({ enabled: true, pattern: 'ABBA', length: 3, unit: 'bars', barBeats: 3, advance: 'running' });
  await input(page, 'masterTempo', 180, 'input'); await page.locator('#deckRate1').selectOption('0.5');
  await input(page, 'deckLoopStart0', 1); await input(page, 'deckLoopEnd0', 3);
  await expect(page.locator('#deckRateOut1')).toHaveText('90.0 BPM'); expect((await snapshot(page)).decks[1].rate).toBe(.5);
  await audible(page, testInfo, 'reverse-plus-weave-native');
  await expect(page.locator('#deckReverse0')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mixerWeaveToggle').click(); expect((await snapshot(page)).decks.every(deck => deck.active)).toBe(true);
  await page.locator('#audioButton').click(); await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(.0001);
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`reverse and expanded Weave controls remain reachable at ${viewport.width}×${viewport.height}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000 });
    const page = await context.newPage(), failures = []; page.on('pageerror', error => failures.push(error.message));
    try {
      await open(page); await expandWeave(page); await reverse(page, 0, 'controllers'); await page.locator('#mixerWeaveToggle').click();
      for (const id of ['mixerWeaveToggle', 'mixerWeavePattern', 'mixerWeaveLength', 'mixerWeaveUnit', 'mixerWeaveAdvance', 'mixerWeaveBarBeats', 'deckReverse0', 'deckReverseMode0', 'deckReverseDownload0', 'deckReverse1', 'deckReverseMode1']) {
        const control = page.locator(`#${id}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible(); const box = await control.boundingBox();
        expect(box.x, id).toBeGreaterThanOrEqual(-1); expect(box.x + box.width, id).toBeLessThanOrEqual(viewport.width + 1);
        if (viewport.width < 1000) { expect(box.width, `${id} touch width`).toBeGreaterThanOrEqual(48); expect(box.height, `${id} touch height`).toBeGreaterThanOrEqual(48); }
      }
      const pattern = page.locator('#mixerWeavePattern'); await pattern.fill('ABBA'); await pattern.dispatchEvent('change'); await expect(pattern).toBeFocused();
      await page.waitForTimeout(150); await expect(pattern).toBeFocused(); await expect(pattern).toHaveValue('ABBA');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      expect(await page.locator('.mixer-weave').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.locator('#mixerWeaveToggle').scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath(`weave-${viewport.width}.png`) });
      await page.locator('#deckReverse0').scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath(`reverse-${viewport.width}.png`) });
      expect(await page.evaluate(() => __reverseWeaveQA.contexts.length)).toBe(0); expect(failures).toEqual([]);
    } finally { await context.close(); }
  });
}

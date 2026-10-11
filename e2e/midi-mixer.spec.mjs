import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page).push(error.message));
});
test.afterEach(async ({ page }) => { expect(errors.get(page), 'uncaught browser errors').toEqual([]); });

function vlq(value) {
  const result = [value & 127];
  while ((value >>= 7)) result.unshift((value & 127) | 128);
  return result;
}

// Original, deterministic arrangements: two pitched voices and one GM drum
// channel. Different source tempos make tempo takeover observable.
function arrangement(bpm = 100, root = 60) {
  const micros = Math.round(60000000 / bpm), events = [
    { tick: 0, bytes: [255, 81, 3, micros >> 16, (micros >> 8) & 255, micros & 255] },
    { tick: 0, bytes: [255, 88, 4, 4, 2, 24, 8] },
    { tick: 0, bytes: [255, 89, 2, 0, 0] },
    { tick: 0, bytes: [192, 16] }, { tick: 0, bytes: [193, 33] },
  ];
  for (let beat = 0; beat < 16; beat++) {
    for (const [channel, pitch, velocity, duration] of [[0, root + beat % 3 * 2, 95, 420], [1, root - 12, 85, 360], [9, beat % 2 ? 38 : 36, 105, 100]]) {
      events.push({ tick: beat * 480, bytes: [144 | channel, pitch, velocity] },
        { tick: beat * 480 + duration, bytes: [128 | channel, pitch, 0] });
    }
  }
  const track = []; let previous = 0;
  for (const event of events.sort((a, b) => a.tick - b.tick)) {
    track.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick;
  }
  track.push(...vlq(16 * 480 - previous), 255, 47, 0);
  const length = Buffer.alloc(4); length.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224]), Buffer.from('MTrk'), length, Buffer.from(track)]);
}

async function input(page, id, value, type = 'input') {
  await page.locator(`#${id}`).evaluate((node, { value, type }) => {
    node.value = String(value); node.dispatchEvent(new Event(type, { bubbles: true }));
  }, { value, type });
}
const row = (page, deck, channel) => page.locator(`#deckChannels${deck} [data-channel="${channel}"]`);
const beat = page => page.locator('#mixerPosition').evaluate(node => Number(node.value.match(/Beat\s+([\d.]+)/)?.[1]));
async function loadLocal(page, index, name, buffer) {
  await page.locator(`#deckFile${index}`).setInputFiles({ name, mimeType: 'audio/midi', buffer });
  await expect(page.locator(`#deckSong${index} option:checked`)).toHaveText(name);
  await expect(page.locator(`#deckChannels${index} .channel-row`)).toHaveCount(3);
}
async function open(page, { visualScore = false } = {}) {
  // Observe native contexts; no audio destination, engine, or timing replacement.
  await page.addInitScript(() => {
    globalThis.__mixerQAContexts = [];
    const Native = globalThis.AudioContext;
    globalThis.AudioContext = class extends Native {
      constructor(...args) { super(...args); globalThis.__mixerQAContexts.push(this); }
    };
  });
  await page.goto('/midiphoria.html');
  if (visualScore) {
    await page.locator('#midiFile').setInputFiles({ name: 'QA visual.mid', mimeType: 'audio/midi', buffer: arrangement(120, 72) });
    await expect(page.locator('#songList button[data-song-id="local-1"]')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#deckSong0 option')).not.toHaveCount(1);
  await expect(page.locator('#tempoFromA')).toBeEnabled();
  await expect(page.locator('#tempoFromB')).toBeEnabled();
  await loadLocal(page, 0, 'QA left.mid', arrangement(100, 60));
  await loadLocal(page, 1, 'QA right.mid', arrangement(150, 67));
  await expect(page.locator('#mixerPlay')).toBeEnabled();
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await expect(page.locator('#mixerPosition')).toContainText('Audio on', { timeout: 15000 });
}
async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 10000 }).toBeGreaterThan(.001);
  const result = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 40 });
  expect(result.summary.finite).toBe(true);
  expect(result.summary.maxRms).toBeGreaterThan(.001);
  expect(result.summary.maxPeak).toBeLessThanOrEqual(.981);
  expect(result.summary.clippedSamples).toBe(0);
  return result.summary;
}
async function silent(page) {
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 8000 }).toBeLessThan(.0001);
}

test('MIDI Mixer stays inside Midiophilia and silent Play, edits and view changes never arm Audio', async ({ page }) => {
  await open(page);
  await expect(page).toHaveURL(/\/midiphoria\.html/);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#mixerPlay').click();
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  const before = await beat(page);
  await expect.poll(() => beat(page)).toBeGreaterThan(before + .5);
  await input(page, 'deckPitch0', 7);
  await page.locator('#visualModeButton').click();
  await expect(page.locator('#mixerPlay')).toBeHidden();
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#deckPitch0')).toHaveValue('7');
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => beat(page)).toBeGreaterThan(before);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => globalThis.__mixerQAContexts.length)).toBe(0);
});

test('source inspection, tempo takeover, voice mute/solo, original patches and pitch remain independently editable', async ({ page }) => {
  await open(page);
  await expect(page.locator('#deckInfo0')).toContainText('100.0 BPM');
  await expect(page.locator('#deckInfo1')).toContainText('150.0 BPM');
  await expect(page.locator('#deckInfo0')).toContainText('4/4');
  await expect(page.locator('#deckInfo0')).toContainText('C major · MIDI');
  await page.locator('#tempoFromA').click(); await expect(page.locator('#masterTempo')).toHaveValue('100');
  await page.locator('#tempoFromB').click(); await expect(page.locator('#masterTempo')).toHaveValue('150');
  await input(page, 'masterTempo', 178.5); await expect(page.locator('#masterTempoOut')).toContainText('178.5 BPM');
  await page.locator('#deckDrums0').click();
  await expect(row(page, 0, 0)).toHaveClass(/is-muted/); await expect(row(page, 0, 1)).toHaveClass(/is-muted/);
  await expect(row(page, 0, 9)).not.toHaveClass(/is-muted/);
  await expect.poll(() => page.locator('#deckMap0').evaluate(canvas => {
    const rows = [...canvas.parentElement.querySelectorAll('.mixer-voice-row')];
    const height = Math.round(rows.length * rows[0].getBoundingClientRect().height * canvas.height / canvas.getBoundingClientRect().height);
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, height).data;
    // Thin density marks blend with their row background at compact widths.
    let grey = 0; for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i], green = pixels[i + 1], blue = pixels[i + 2];
      if (red >= 30 && red <= 70 && green > red && green <= 81 && Math.abs(green - blue) <= 4) grey++;
    }
    return grey;
  })).toBeGreaterThan(0);
  await page.locator('#deckAll0').click();
  await page.getByRole('button', { name: 'Solo deck A channel 2', exact: true }).click();
  await expect(row(page, 0, 1)).not.toHaveClass(/is-muted/);
  await expect(row(page, 0, 0)).toHaveClass(/is-muted/); await expect(row(page, 0, 9)).toHaveClass(/is-muted/);
  await page.locator('#deckAll0').click();
  await page.locator('#deckProgram0_0').selectOption('80'); await expect(page.locator('#deckProgram0_0')).toHaveValue('80');
  await page.locator('#deckProgram0_0').selectOption(''); await expect(page.locator('#deckProgram0_0')).toHaveValue('');
  await expect(page.locator('#deckProgram0_9')).toBeEnabled();
  await expect(page.locator('#deckProgram0_9 option')).toHaveCount(129);
  await page.locator('#deckProgram0_9').selectOption('8'); await expect(page.locator('#deckProgram0_9')).toHaveValue('8');
  await page.locator('#deckProgram0_9').selectOption(''); await expect(page.locator('#deckProgram0_9')).toHaveValue('');
  await input(page, 'deckPitch0', -12); await expect(page.locator('#deckPitchOut0')).toHaveText('-12 st');
  await page.locator('#deckForward0').click(); await expect(page.locator('#deckOffset0')).toHaveValue('4');
  await page.locator('#deckBack0').click(); await expect(page.locator('#deckOffset0')).toHaveValue('0');
  await page.locator('.mixer-deck[data-deck="0"] .deck-inspector summary').click();
  await expect(page.locator('#deckInspect0')).toContainText('48 notes');
  await expect(page.locator('#deckInspect0')).toContainText('Tempo map: beat 0.0 → 100.0 BPM');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('whole-arrangement maps create loop regions and retain accessible keyboard seeking', async ({ page }) => {
  await open(page);
  const map = page.locator('#deckMap0'); await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  await page.mouse.move(box.x + box.width * .26, box.y + 35); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .51, box.y + 35, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('#deckLoopStart0')).toHaveValue('4');
  await expect(page.locator('#deckLoopEnd0')).toHaveValue('9');
  await expect(page.locator('#deckLoop0')).toBeChecked();
  await expect.poll(() => map.getAttribute('aria-valuenow').then(Number)).toBe(4);
  await page.locator('#deckFullLoop0').click(); await page.locator('#mixerStop').click();
  await map.focus(); await page.keyboard.press('Home');
  await expect.poll(() => map.getAttribute('aria-valuenow').then(Number)).toBe(0);
  await page.keyboard.press('ArrowRight'); await expect.poll(() => map.getAttribute('aria-valuenow').then(Number)).toBe(1);
  await page.keyboard.press('Shift+ArrowRight'); await expect.poll(() => map.getAttribute('aria-valuenow').then(Number)).toBe(5);
  await page.keyboard.press('End'); await expect.poll(() => map.getAttribute('aria-valuenow').then(Number)).toBe(15.75);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'false');
});

test('independent half and double time retain the shared tempo and produce matching deck-rate readouts', async ({ page }) => {
  await open(page); await input(page, 'masterTempo', 120);
  await page.locator('#deckRate0').selectOption('2'); await page.locator('#deckRate1').selectOption('0.5');
  await expect(page.locator('#deckRateOut0')).toHaveText('240.0 BPM');
  await expect(page.locator('#deckRateOut1')).toHaveText('60.0 BPM');
  await expect(page.locator('#masterTempo')).toHaveValue('120');
  await page.locator('#mixerPlay').click();
  const positions = () => page.evaluate(() => [0, 1].map(index => Number(document.getElementById(`deckPosition${index}`).value.match(/Beat\s+([\d.]+)/)?.[1])));
  await expect.poll(async () => (await positions())[1]).toBeGreaterThan(.5);
  await page.locator('#mixerPlay').click();
  const [a, b] = await positions();
  const difference = Math.abs(a - (4 * b % 16));
  expect(Math.min(difference, 16 - difference)).toBeLessThanOrEqual(.3);
  await page.locator('#deckRate0').selectOption('8');
  await expect(page.locator('#deckRateOut0')).toHaveText('960.0 BPM');
  await expect(page.locator('#deckExactRate0')).toHaveValue('8');
  await expect(page.locator('#deckExactRate0')).toHaveAttribute('max', '8');
  await page.locator('#mixerReset').click();
  await expect(page.locator('#deckRate0')).toHaveValue('1'); await expect(page.locator('#deckRate1')).toHaveValue('1');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('file changes keep playing and invalid MIDI preserves the previous arrangement', async ({ page }) => {
  await open(page); await page.locator('#mixerPlay').click();
  await expect.poll(() => beat(page)).toBeGreaterThan(1.5); const before = await beat(page);
  await loadLocal(page, 0, 'Replacement.mid', arrangement(140, 72));
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => beat(page)).toBeGreaterThan(before);
  await page.locator('#deckFile0').setInputFiles({ name: 'Broken.mid', mimeType: 'audio/midi', buffer: Buffer.from('not a MIDI file') });
  await expect(page.locator('#mixerStatus')).toContainText(/Standard MIDI|not a Standard MIDI/);
  await expect(page.locator('#deckSong0 option:checked')).toHaveText('Replacement.mid');
  await expect(page.locator('#deckInfo0')).toContainText('140.0 BPM');
  await expect(page.locator('#deckChannels0 .channel-row')).toHaveCount(3);
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('local SoundFont selection stays silent, and mix presets and reset provide recovery', async ({ page }) => {
  await open(page);
  await page.locator('.mixer-effects > summary').click();
  await page.locator('#mixerSoundFont').setInputFiles(fileURLToPath(new URL('../assets/midiphoria/soundfont/TimGM6mb.sf2', import.meta.url)));
  await expect(page.locator('#mixerFontName')).toHaveText('TimGM6mb.sf2');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => globalThis.__mixerQAContexts.length)).toBe(0);
  await page.locator('#mixerPlay').click();
  await page.locator('#mixerPresetHost .header-preset-picker > summary').click();
  await page.locator('#mixerPresetHost button[data-preset-id="a-rhythm"]').click();
  await expect(row(page, 0, 0)).toHaveClass(/is-muted/); await expect(row(page, 1, 9)).toHaveClass(/is-muted/);
  await page.locator('#mixerPresetHost .header-preset-picker > summary').click();
  await page.locator('#mixerPresetHost button[data-preset-id="octave-room"]').click();
  await expect(page.locator('#deckPitch0')).toHaveValue('-12'); await expect(page.locator('#deckPitch1')).toHaveValue('12');
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mixerReset').click();
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#deckPitch0')).toHaveValue('0'); await expect(page.locator('#deckPitch1')).toHaveValue('0');
  await expect(page.locator('#masterTempo')).toHaveValue('120'); await expect(page.locator('#mixerCrossfade')).toHaveValue('0');
  await expect(row(page, 0, 0)).not.toHaveClass(/is-muted/);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('real SoundFont playback is finite, channel and deck mute affect sound, and Audio off preserves the clock', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await open(page); await arm(page); await page.locator('#mixerPlay').click();
  const summary = await audible(page);
  await testInfo.attach('native-mixer-audio', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  await input(page, 'mixerCrossfade', -1); await page.locator('#deckMute0').check(); await silent(page);
  await page.locator('#deckMute0').uncheck(); await audible(page);
  for (const channel of [0, 1, 9]) await page.getByRole('button', { name: `Mute deck A channel ${channel + 1}`, exact: true }).click();
  await silent(page); await page.locator('#deckAll0').click(); await audible(page);
  await input(page, 'deckPitch0', 12); await page.locator('#deckProgram0_0').selectOption('80'); await audible(page);
  const before = await beat(page); await page.locator('#audioButton').click(); await silent(page);
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => beat(page)).toBeGreaterThan(before + .5);
  await arm(page); await audible(page);
  await page.locator('#mixerStop').click(); await silent(page);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
});

test('armed view changes move playback between the real players and return to an audible preserved mix', async ({ page }) => {
  test.setTimeout(60000);
  await open(page, { visualScore: true }); await arm(page);
  await input(page, 'deckPitch0', 7); await input(page, 'deckOffset1', 2);
  await page.locator('#mixerPlay').click(); await audible(page);
  await page.locator('#visualModeButton').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await audible(page);
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#deckPitch0')).toHaveValue('7');
  await expect(page.locator('#deckOffset1')).toHaveValue('2');
  await expect.poll(() => page.evaluate(() => globalThis.__mixerQAContexts.filter(context => context.state === 'running').length)).toBe(1);
  await audible(page);
  // The legacy Play DOM control mirrors the active transport for Space. Prove
  // that its actual synth was silenced by muting both active mixer decks.
  await page.locator('#deckMute0').check(); await page.locator('#deckMute1').check(); await silent(page);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`embedded mixer controls remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); await open(page);
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
    for (const id of ['mixerPlay', 'masterTempo', 'deckSong0', 'deckMap0', 'deckSong1', 'deckMap1', 'mixerSoundFont']) {
      if (id === 'mixerSoundFont') await page.locator('.mixer-effects > summary').click();
      const control = page.locator(`#${id}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
      const box = await control.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    await page.locator('#mixerPlay').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`midi-mixer-${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}

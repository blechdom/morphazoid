import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const catalog = JSON.parse(await readFile(new URL('../assets/sound-fonts/catalog.json', import.meta.url), 'utf8'));
const gmBankIds = ['generaluser-gs', 'fluidr3mono-gm', 'fluidr3-gm'];
const consumers = [
  { name: 'MIDI Mixer', route: '/midiphoria.html', mixer: true },
  { name: 'Blech MIDI', route: '/blech-midi.html', mixer: false },
];
const pickerSelector = '.instrument-picker[data-select-id="sharedSoundFontBank"]';

// Keep the large real-bank decodes sequential within this file. These tests
// observe native audio and never replace the output device or the synthesizer.
test.describe.configure({ mode: 'default' });
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page).push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) {
      errors.get(page).push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
    }
  });
  await page.addInitScript(() => {
    window.__sharedFontQA = { contexts: [], analysers: [] };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__sharedFontQA.contexts.push(this); }
      createAnalyser() {
        const node = super.createAnalyser(); window.__sharedFontQA.analysers.push(node); return node;
      }
    };
  });
});
test.afterEach(async ({ page }) => { expect(errors.get(page), 'page errors and broken first-party requests').toEqual([]); });

function noteScore(drums = false) {
  const channel = drums ? 9 : 0;
  const track = [0, 255, 81, 3, 7, 161, 32, 0, 0xc0 | channel, 0];
  for (let beat = 0; beat < 16; beat += 1) {
    const note = drums ? [36, 38, 42, 38][beat % 4] : [60, 64, 67, 72][beat % 4];
    track.push(beat ? 24 : 0, 0x90 | channel, note, 105, 72, 0x80 | channel, note, 0);
  }
  track.push(24, 255, 47, 0);
  const header = Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96]);
  const chunk = Buffer.alloc(8); chunk.write('MTrk'); chunk.writeUInt32BE(track.length, 4);
  return Buffer.concat([header, chunk, Buffer.from(track)]);
}

async function showChooser(page) {
  const details = page.locator('.mixer-effects').filter({ has: page.locator('#sharedSoundFontBank') });
  await expect(details).toHaveCount(1);
  if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click();
  await expect(page.locator(`${pickerSelector} > summary`)).toBeVisible();
}

async function openConsumer(page, consumer) {
  await page.goto(consumer.route);
  if (consumer.mixer) {
    await page.locator('#mixerModeButton').click();
    await expect(page.locator('#tempoFromA')).toBeEnabled({ timeout: 20_000 });
    await page.locator('#deckMute1').check();
  }
  await expect(page.locator('#sharedSoundFontBank option')).not.toHaveCount(0);
  await showChooser(page);
}

async function selectBank(page, id, expectedName) {
  const option = page.locator(`#sharedSoundFontBank option[value="${id}"]`);
  await expect(option).toHaveCount(1);
  const label = await option.textContent(), picker = page.locator(pickerSelector);
  await picker.locator(':scope > summary').click();
  await picker.getByRole('searchbox', { name: 'Filter soundfont bank', exact: true }).fill(label);
  await picker.getByRole('button', { name: label, exact: true }).click();
  await expect(page.locator('#mixerFontName')).toHaveText(expectedName, { timeout: 60_000 });
  await expect(page.locator('#sharedSoundFontBank')).toHaveValue(id);
  await expect(page.locator('#sharedSoundFontStatus')).toContainText('Using', { timeout: 60_000 });
}

async function audioOff(page) {
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__sharedFontQA.contexts.length)).toBe(0);
}

async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
}

async function audible(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 20_000 }).toBeGreaterThan(.001);
  const result = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 40 });
  expect(result.summary.finite).toBe(true);
  expect(result.summary.maxRms).toBeGreaterThan(.001);
  expect(result.summary.maxPeak).toBeLessThanOrEqual(.981);
  expect(result.summary.clippedSamples).toBe(0);
  const raw = await page.evaluate(() => ({
    analysers: window.__sharedFontQA.analysers.length,
    finite: window.__sharedFontQA.analysers.every(node => {
      const samples = new Float32Array(node.fftSize); node.getFloatTimeDomainData(samples);
      return samples.every(Number.isFinite);
    }),
  }));
  expect(raw.analysers).toBeGreaterThan(0);
  expect(raw.finite, 'native PCM observations remain finite').toBe(true);
  return result.summary;
}

async function silent(page) {
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 10_000 }).toBeLessThan(.0001);
}

async function loadScore(page, drums = false) {
  const name = drums ? 'Shared bank drums.mid' : 'Shared bank piano.mid';
  await page.locator('#deckFile0').setInputFiles({ name, mimeType: 'audio/midi', buffer: noteScore(drums) });
  await expect(page.locator('#deckSong0 option:checked')).toHaveText(name);
  await expect(page.locator('#deckChannels0 .channel-row')).toHaveCount(1);
}

for (const id of gmBankIds) {
  test(`${id} previews in Sound Fonts and exports its original format`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const bank = catalog.find(entry => entry.id === id);
    expect(bank, 'the requested GM bank is in the shipped catalog').toBeTruthy();
    const downloads = [];
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith(`/${bank.file}`)) downloads.push(request.url()); });
    await page.goto('/sound-fonts.html');
    await expect(page.locator('#fontCount')).toHaveText('3');
    await page.locator('[data-view="sources"]').click();
    await page.getByRole('button', { name: `Add ${bank.name} to collection`, exact: true }).click();
    await expect(page.locator('#selectedName')).toHaveText(bank.name, { timeout: 60_000 });
    expect(downloads.length).toBeGreaterThan(0);
    await page.locator('#presetSelect').selectOption('0');
    await expect(page.locator('#downloadButton')).toContainText(`Download ${bank.format.toUpperCase()}`);
    await page.locator('#auditionButton').click();
    await audioOff(page);
    await page.locator('#enableAudio').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
    await page.locator('#auditionButton').click();
    const signal = await audible(page);
    await page.locator('#stopButton').click(); await silent(page);
    const downloading = page.waitForEvent('download');
    await page.locator('#downloadButton').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${bank.format}$`));
    const exported = await readFile(await download.path());
    expect(createHash('sha256').update(exported).digest('hex')).toBe(bank.sha256);
    await testInfo.attach(`${id}-preview-native-output`, { body: JSON.stringify({ format: bank.format, signal }), contentType: 'application/json' });
  });

  test(`${id} loads the actual bank without arming, then renders piano and GM drums`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const bank = catalog.find(entry => entry.id === id);
    expect(bank, 'the requested GM bank is in the shipped catalog').toBeTruthy();
    const downloads = [];
    page.on('request', request => { if (new URL(request.url()).pathname.endsWith(`/${bank.file}`)) downloads.push(request.url()); });
    await openConsumer(page, consumers[0]);
    await selectBank(page, `bundled-${id}`, bank.name);
    expect(downloads.length).toBeGreaterThan(0);
    await audioOff(page);
    await loadScore(page);
    await audioOff(page);
    await arm(page);
    await page.locator('#mixerPlay').click();
    const piano = await audible(page);
    await page.locator('#mixerStop').click(); await silent(page);
    await loadScore(page, true);
    await page.locator('#mixerPlay').click();
    const drums = await audible(page);
    await page.locator('#mixerStop').click(); await silent(page);
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await testInfo.attach(`${id}-native-output`, { body: JSON.stringify({ format: bank.format, piano, drums }), contentType: 'application/json' });
  });
}

for (const consumer of consumers) {
  test(`a font created in Sound Fonts survives reload and plays in ${consumer.name}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const name = `Shared ${consumer.name} glass`;
    await page.goto('/sound-fonts.html');
    await expect(page.locator('#fontCount')).toHaveText('3');
    await page.locator('[data-view="workshop"]').click();
    await page.locator('#fontName').fill(name);
    await page.locator('#saveFont').click();
    await expect(page.locator('#selectedName')).toHaveText(name);
    await audioOff(page);
    await openConsumer(page, consumer);
    const saved = page.locator('#sharedSoundFontBank optgroup[label="Your Sound Fonts"] option').filter({ hasText: name });
    await expect(saved).toHaveCount(1);
    const id = await saved.getAttribute('value');
    await selectBank(page, id, name); await audioOff(page);
    await page.reload();
    if (consumer.mixer) {
      await page.locator('#mixerModeButton').click();
      await expect(page.locator('#tempoFromA')).toBeEnabled({ timeout: 20_000 });
      await page.locator('#deckMute1').check();
    }
    await showChooser(page);
    await selectBank(page, id, name); await audioOff(page);
    if (consumer.mixer) await loadScore(page);
    else await page.locator('[data-stamp-loop="square"]').check();
    await arm(page);
    await page.locator(consumer.mixer ? '#mixerPlay' : '[data-mixer-sample="square"]').click();
    const signal = await audible(page);
    await page.locator(consumer.mixer ? '#mixerStop' : '#creativeStop').click(); await silent(page);
    await testInfo.attach('created-font-native-output', { body: JSON.stringify({ name, consumer: consumer.name, signal }), contentType: 'application/json' });
  });
}

for (const consumer of consumers) for (const viewport of [
  { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 },
]) {
  test(`${consumer.name} exposes the shared picker at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openConsumer(page, consumer);
    const picker = page.locator(pickerSelector), trigger = picker.locator(':scope > summary');
    await trigger.scrollIntoViewIfNeeded(); await expect(trigger).toBeInViewport();
    const bounds = await trigger.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    await trigger.click();
    const search = picker.getByRole('searchbox', { name: 'Filter soundfont bank', exact: true });
    await expect(search).toBeVisible(); await expect(search).toBeInViewport();
    await search.fill('GeneralUser');
    await expect(picker.getByRole('button').filter({ hasText: 'GeneralUser' })).toHaveCount(1);
    await search.press('Escape'); await search.press('Escape');
    await expect(picker).not.toHaveAttribute('open', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await audioOff(page);
  });
}

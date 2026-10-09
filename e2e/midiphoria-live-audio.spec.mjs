import { expect, test } from '@playwright/test';
import { installFakeMidi, enableFakeMidi, sendMidi, sendMidiSequence } from './helpers/fake-midi.mjs';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

// Observe the real player without replacing its SoundFont, audio graph, note
// ownership, or MIDI/model processing. Ownership assertions distinguish a held
// piano note's natural decay from an early release or a duplicate file attack.
async function open(page) {
  await installFakeMidi(page, { inputs: [{ id: 'keyboard-a' }, { id: 'keyboard-b' }] });
  await page.addInitScript(() => {
    globalThis.__liveAudioContexts = [];
    const Native = globalThis.AudioContext;
    globalThis.AudioContext = class extends Native {
      constructor(...args) { super(...args); globalThis.__liveAudioContexts.push(this); }
    };
  });
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const audit = globalThis.__liveAudioAudit = { player: null, attacks: [] };
      const setVolume = MidiphoriaPlayer.prototype.setVolume;
      MidiphoriaPlayer.prototype.setVolume = function (...args) {
        audit.player = this; return setVolume.apply(this, args);
      };
      const padNoteOn = MidiphoriaPlayer.prototype.padNoteOn;
      MidiphoriaPlayer.prototype.padNoteOn = function (...args) {
        const accepted = padNoteOn.apply(this, args);
        audit.attacks.push({ source: args[0], note: args[1], accepted });
        return accepted;
      };
    ` });
  });
  await page.goto('/midiphoria.html');
  await expect(page.locator('#notePads button')).toHaveCount(24);
  await enableFakeMidi(page);
  await page.locator('.header-settings-menu').evaluate(node => { node.open = false; });
  await page.locator('h1').click();
}

async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioState')).toHaveText('on', { timeout: 15000 });
  await page.locator('h1').click();
}

async function owners(page, count) {
  await expect.poll(() => page.evaluate(() => globalThis.__liveAudioAudit.player._padSources.size)).toBe(count);
}

async function audible(page) {
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 40 });
  expect(summary.finite).toBe(true);
  expect(summary.maxRms).toBeGreaterThan(.001);
  expect(summary.maxPeak).toBeLessThanOrEqual(.981);
  expect(summary.clippedSamples).toBe(0);
}

async function silent(page) {
  await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 6000 }).toBeLessThan(.0001);
}

const send = (page, data, inputId = 'keyboard-a') => sendMidi(page, data, { inputId });

test('live computer keys and hardware stay silent while Audio is off and never replay muted attacks', async ({ page }) => {
  await open(page);
  await page.keyboard.down('z'); await send(page, [0x90, 60, 100]);
  await expect(page.locator('#noteReadout')).toContainText('2 held');
  await owners(page, 0);
  expect(await page.evaluate(() => globalThis.__liveAudioContexts.length)).toBe(0);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await arm(page); await silent(page); await owners(page, 0);
  await page.keyboard.up('z'); await send(page, [0x80, 60, 0]);

  await page.keyboard.down('x'); await owners(page, 1); await audible(page);
  await page.locator('#audioButton').click(); await owners(page, 0); await silent(page);
  await arm(page); await silent(page); await owners(page, 0);
  await page.keyboard.up('x');
  await send(page, [0x90, 67, 100]); await owners(page, 1); await audible(page);
  await send(page, [0x80, 67, 0]); await owners(page, 0); await silent(page);
  expect(await page.evaluate(() => globalThis.__liveAudioContexts.length)).toBe(1);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
});

test('simultaneous keys, repeated pitches, two MIDI inputs and focused pads retain independent ownership', async ({ page }) => {
  await open(page); await arm(page);
  await page.keyboard.down('z'); await page.keyboard.down('x');
  await send(page, [0x90, 48, 110]); await send(page, [0x90, 48, 80]);
  await send(page, [0x91, 48, 100], 'keyboard-b');
  await owners(page, 5); await audible(page);
  await send(page, [0x80, 48, 0]); await owners(page, 4);
  await page.keyboard.up('z'); await owners(page, 3);
  await page.keyboard.up('x'); await owners(page, 2);
  await send(page, [0x90, 48, 0]); await owners(page, 1);
  expect(await page.evaluate(() => globalThis.__liveAudioAudit.player._padNotes.get(48))).toBe(1);
  await send(page, [0x81, 48, 0], 'keyboard-b'); await owners(page, 0); await silent(page);

  // Enter/Space use the existing pad path. The shared MIDI key listener must not
  // synthesize another attack for either native button activation.
  const pad = page.locator('#notePads [data-note="48"]');
  await pad.focus(); await page.keyboard.down('Enter'); await owners(page, 1);
  await page.keyboard.down('z'); await owners(page, 2); await audible(page);
  await page.keyboard.up('Enter'); await owners(page, 1);
  await page.keyboard.up('z'); await owners(page, 0); await silent(page);
  await pad.focus(); await page.keyboard.down('Space'); await owners(page, 1);
  await page.keyboard.up('Space'); await owners(page, 0);
});

test('live audio follows channel and learned-note filters, keyboard remapping and sustain releases', async ({ page }) => {
  await open(page); await arm(page);
  await page.locator('#channel').selectOption('1');
  await send(page, [0x90, 60, 100]); await owners(page, 0); await silent(page);
  await send(page, [0x91, 60, 100]); await owners(page, 1); await audible(page);
  await page.locator('#channel').selectOption('-1'); await owners(page, 0); await silent(page);
  await page.locator('#trigger').selectOption('mapped');
  await send(page, [0x91, 60, 100]); await send(page, [0x90, 61, 100]);
  await owners(page, 0);
  await page.locator('h1').click(); await page.keyboard.down('q');
  await owners(page, 1); await audible(page);
  await page.keyboard.up('q'); await owners(page, 0);
  await send(page, [0xb0, 64, 127]); await send(page, [0x90, 60, 100]);
  await send(page, [0x80, 60, 0]); await owners(page, 1);
  await send(page, [0xb0, 64, 0]); await owners(page, 0); await silent(page);

  await page.locator('#learnButton').click(); await send(page, [0x92, 72, 110]);
  await expect(page.locator('#mappedNumber')).toHaveValue('72');
  await expect(page.locator('#mappedChannel')).toHaveValue('2');
  await owners(page, 1); await audible(page);
  await page.locator('#mappedType').selectOption('cc'); await owners(page, 0); await silent(page);
  await send(page, [0x92, 72, 110]); await owners(page, 0);
});

test('disconnect, channel panic, MIDI disable, blur and Reset release live audio without harming other sources', async ({ page }) => {
  test.setTimeout(45000);
  await open(page); await arm(page);
  await send(page, [0x90, 60, 100]); await send(page, [0x91, 64, 100]);
  await send(page, [0x90, 67, 100], 'keyboard-b'); await owners(page, 3);
  await send(page, [0xb0, 120, 0]); await owners(page, 2);
  await page.evaluate(() => globalThis.__morphazoidFakeMidi.disconnectInput('keyboard-a'));
  await owners(page, 1);
  await send(page, [0xb0, 123, 0], 'keyboard-b'); await owners(page, 0); await silent(page);

  for (const action of ['blur', 'reset', 'disable']) {
    await send(page, [0x90, 60, 100], 'keyboard-b');
    await page.locator('h1').click(); await page.keyboard.down('z');
    await owners(page, 2); await audible(page);
    if (action === 'blur') await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
    if (action === 'reset') await page.locator('#resetButton').evaluate(node => node.click());
    if (action === 'disable') {
      await page.locator('#midiSettingsButton').click(); await page.locator('#sharedMidiToggle').click();
    }
    await owners(page, 0); await silent(page); await page.keyboard.up('z');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  }
});

test('live MIDI is bounded, ignored attacks never resume, and file playback does not enter the piano bridge', async ({ page }) => {
  await open(page); await arm(page);
  const notes = Array.from({ length: 40 }, (_, index) => 40 + index);
  await sendMidiSequence(page, notes.map(note => ({ data: [0x90, note, 100] })), { inputId: 'keyboard-a' });
  await owners(page, 32); await audible(page);
  await sendMidiSequence(page, notes.slice(0, 32).map(note => ({ data: [0x80, note, 0] })), { inputId: 'keyboard-a' });
  await owners(page, 0); await silent(page);
  await sendMidiSequence(page, notes.slice(32).map(note => ({ data: [0x80, note, 0] })), { inputId: 'keyboard-a' });
  const before = await page.evaluate(() => globalThis.__liveAudioAudit.attacks.length);
  await page.locator('#textMidiInput').fill('MIDI');
  await page.locator('#textMidiForm button[type="submit"]').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await audible(page); await owners(page, 0);
  expect(await page.evaluate(() => globalThis.__liveAudioAudit.attacks.length)).toBe(before);
  await send(page, [0x90, 60, 100]); await owners(page, 1);
  await page.locator('#stopButton').click(); await owners(page, 1);
  await send(page, [0x80, 60, 0]); await owners(page, 0); await silent(page);
});

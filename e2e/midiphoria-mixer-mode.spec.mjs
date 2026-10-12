import { expect, test } from '@playwright/test';
import { installFakeMidi, enableFakeMidi, sendMidi } from './helpers/fake-midi.mjs';
import { bundledMidiCount } from './helpers/midiphoria-library.mjs';

// The embedded-view owner is tested independently from the mixer's scheduler.
// The real legacy player stays in place; the mixer fixture exposes only its API.
async function open(page) {
  await page.route('**/src/instruments/midi-mixer/midi-mixer.css', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/src/instruments/midi-mixer/midi-mixer-app.js', route => route.fulfill({
    contentType: 'application/javascript', body: `
      import { registerHeaderPresets } from '/src/site/header-presets.js';
      export function mountMidiMixer(host, { onState }) {
        let disposed = false, generation = 0, presets = null, amount = 0;
        const state = { ready: true, playing: false, audioEnabled: false, active: false, volume: .5 };
        const publish = () => { host.dataset.playing = String(state.playing); host.dataset.audio = String(state.audioEnabled); onState(); };
        host.innerHTML = '<div id="fixtureMixerPresets"></div><button id="fixtureMixerPlay" type="button">Mixer Play</button>';
        const api = { get state() { return { ...state }; },
          setActive(value) {
            state.active = value;
            if (value && !presets) presets = registerHeaderPresets({
              id: 'fixture-mixer', host: host.querySelector('#fixtureMixerPresets'),
              presets: Array.from({ length: 12 }, (_, index) => ({ id: 'scene-' + index, label: 'Scene ' + index, snapshot: { amount: index } })),
              capture: () => ({ amount }), apply: snapshot => { amount = snapshot.amount; }, randomize: () => ({ amount: 6 })
            });
            else if (!value) { presets?.destroy(); presets = null; }
          },
          async setAudioEnabled(value) {
            const token = ++generation;
            if (!value) { state.audioEnabled = false; publish(); return false; }
            await new Promise(resolve => setTimeout(resolve, 100));
            if (disposed || token !== generation) return false;
            state.audioEnabled = true; publish(); return true;
          },
          setVolume(value) { state.volume = value; },
          async resumeAudioClock() { /* No native context in this view-owner fixture. */ },
          play() { state.playing = true; publish(); }, pause() { state.playing = false; publish(); },
          reset() { state.playing = false; state.reset = true; publish(); },
          dispose() { presets?.destroy(); disposed = true; generation++; state.disposed = true; state.playing = false; state.audioEnabled = false; }
        };
        host.querySelector('#fixtureMixerPlay').onclick = () => state.playing ? api.pause() : api.play();
        (window.__mixerModes ??= []).push(api); return api;
      }
    `,
  }));
  await page.route('**/src/instruments/midiphoria/midiphoria-player.js', async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace('export class MidiphoriaPlayer', 'class OriginalMidiphoriaPlayer');
    await route.fulfill({ response, body: source + `\nexport class MidiphoriaPlayer extends OriginalMidiphoriaPlayer { constructor(...args) { super(...args); (window.__legacyModes ??= []).push(this); } }` });
  });
  await page.goto('/midiphoria.html');
  await expect(page.locator('#songCount')).toHaveText(`${bundledMidiCount} MIDIs`);
}

async function states(page) {
  return page.evaluate(() => ({ legacy: window.__legacyModes.at(-1).state, mixer: window.__mixerModes.at(-1).state }));
}

test('Mixer is one page view and shared Space routes only to its transport without arming Audio', async ({ page }) => {
  await open(page);
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#midiMixerView')).toBeVisible();
  await expect(page.locator('#midiphoriaLegacyView')).toBeHidden();
  await expect(page.locator('#visualModeButton')).toBeVisible();
  expect(page.url()).toContain('/midiphoria.html');
  await page.locator('#fixtureMixerPlay').click();
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#fixtureMixerPlay').evaluate(node => node.blur());
  await page.keyboard.press('Space');
  expect((await states(page)).mixer.playing).toBe(false);
  expect((await states(page)).legacy.playing).toBe(false);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#visualModeButton').click();
  await expect(page.locator('#midiphoriaLegacyView')).toBeVisible();
  await expect(page.locator('#midiMixerView')).toBeHidden();
  await page.locator('#mixerModeButton').click();
  await page.locator('#resetButton').evaluate(button => button.click());
  expect((await states(page)).mixer.reset).toBe(true);
});

test('Audio, volume and playing intent transfer between engines while the inactive engine remains muted', async ({ page }) => {
  await open(page);
  await page.locator('#textMidiInput').fill('MIDI MIXER'); await page.locator('#generateTextMidi').click();
  await page.locator('#loopSong').check(); await page.locator('#audioButton').click();
  await expect(page.locator('#audioState')).toHaveText('on', { timeout: 20000 });
  await page.locator('#playButton').click();
  await expect.poll(async () => (await states(page)).legacy.time).toBeGreaterThan(.2);
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#audioState')).toHaveText('on');
  expect((await states(page)).legacy.audioEnabled).toBe(false);
  expect((await states(page)).legacy.playing).toBe(false);
  expect((await states(page)).mixer.playing).toBe(true);
  await page.locator('#outputLevel').evaluate(input => { input.value = '.27'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect((await states(page)).legacy.volume).toBeCloseTo(.27);
  expect((await states(page)).mixer.volume).toBeCloseTo(.27);
  await page.locator('#visualModeButton').click();
  await expect(page.locator('#audioState')).toHaveText('on');
  expect((await states(page)).legacy.playing).toBe(true);
  expect((await states(page)).legacy.time).toBeGreaterThan(.2);
  expect((await states(page)).mixer.audioEnabled).toBe(false);
  expect((await states(page)).mixer.playing).toBe(false);
  await page.locator('#audioButton').click();
  await page.locator('#mixerModeButton').click();
  expect((await states(page)).mixer.playing).toBe(true);
  expect((await states(page)).mixer.audioEnabled).toBe(false);
  await expect(page.locator('#audioState')).toHaveText('off');
});

test('rapid view changes cancel stale audio activation and pagehide disposes both engines', async ({ page }) => {
  await open(page); await page.locator('#mixerModeButton').click();
  await page.locator('#audioButton').click();
  await page.locator('#visualModeButton').click();
  await page.locator('#mixerModeButton').click();
  await expect(page.locator('#audioState')).toHaveText('on', { timeout: 20000 });
  await expect.poll(async () => (await states(page)).legacy.audioEnabled).toBe(false);
  expect((await states(page)).mixer.audioEnabled).toBe(true);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  expect((await states(page)).mixer.disposed).toBe(true);
  expect((await states(page)).legacy.audioEnabled).toBe(false);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#songCount')).toHaveText(`${bundledMidiCount} MIDIs`);
  await expect(page.locator('#midiphoria')).toHaveAttribute('data-view', 'visual');
  await expect(page.locator('#audioState')).toHaveText('off');
  expect(await page.evaluate(() => window.__mixerModes.length)).toBe(2);
  expect((await states(page)).mixer.active).toBe(false);
});


test('Mixer suppresses the inactive piano input and returning releases stale held MIDI notes', async ({ page }) => {
  await installFakeMidi(page); await open(page); await enableFakeMidi(page);
  await page.locator('.header-settings-menu').evaluate(node => { node.open = false; });
  await sendMidi(page, [0x90, 60, 100]);
  await expect(page.locator('#noteReadout')).toContainText('1 held');
  await page.locator('#mixerModeButton').click();
  await sendMidi(page, [0x80, 60, 0]); await sendMidi(page, [0x90, 64, 100]);
  await page.locator('h1').click(); await page.keyboard.press('z');
  await page.locator('#notePads button').first().evaluate(node => node.click());
  expect(await page.evaluate(() => window.__legacyModes.at(-1)._padSources.size)).toBe(0);
  await page.locator('#visualModeButton').click();
  await expect(page.locator('#noteReadout')).toHaveText('Waiting for a note');
  await sendMidi(page, [0x80, 64, 0]); await sendMidi(page, [0x90, 67, 100]);
  await expect(page.locator('#noteReadout')).toContainText('1 held');
  await sendMidi(page, [0x80, 67, 0]);
});


test('an empty Visualize view retains Play intent; explicit Pause and Reset cancel it', async ({ page }) => {
  await open(page); await page.locator('#mixerModeButton').click();
  await page.locator('#fixtureMixerPlay').click();
  await page.locator('#visualModeButton').click();
  expect((await states(page)).legacy.ready).toBe(false);
  expect((await states(page)).legacy.playing).toBe(false);
  await page.locator('#visualModeButton').click();
  await page.locator('#mixerModeButton').click();
  expect((await states(page)).mixer.playing).toBe(true);
  await page.locator('#fixtureMixerPlay').click();
  await page.locator('#visualModeButton').click(); await page.locator('#mixerModeButton').click();
  expect((await states(page)).mixer.playing).toBe(false);
  await page.locator('#fixtureMixerPlay').click(); await page.locator('#visualModeButton').click();
  await page.locator('#resetButton').evaluate(node => node.click());
  await page.locator('#mixerModeButton').click();
  expect((await states(page)).mixer.playing).toBe(false);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

test('only the active view owns the shared preset shortcuts after every mode change', async ({ page }) => {
  await open(page);
  const presetState = () => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
  expect((await presetState()).instrumentId).toBe('midiphoria');
  for (let index = 0; index < 3; index++) {
    await page.locator('#mixerModeButton').click();
    expect((await presetState()).instrumentId).toBe('fixture-mixer');
    await expect(page.locator('.header-preset-controls')).toHaveCount(1);
    await page.locator('h1').click(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await expect(page.locator('#midiphoria')).toHaveAttribute('data-view', 'mixer');
    expect((await presetState()).snapshot.amount).toBeGreaterThanOrEqual(1);
    await page.locator('#visualModeButton').click();
    expect((await presetState()).instrumentId).toBe('midiphoria');
    await expect(page.locator('.header-preset-controls')).toHaveCount(1);
  }
  await page.locator('h1').click(); await page.keyboard.press('ArrowRight');
  expect((await presetState()).selectedId).not.toBeNull();
  await expect(page.locator('#midiphoria')).toHaveAttribute('data-view', 'visual');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

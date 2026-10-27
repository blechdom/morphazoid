import { test, expect } from '@playwright/test';
import { installFakeMidi, enableFakeMidi, sendMidi } from './helpers/fake-midi.mjs';

async function prepare(page, path) {
  await installFakeMidi(page, { inputs: [{ id: 'keys-a' }, { id: 'keys-b' }] });
  await page.addInitScript(() => {
    window.noteMessages = [];
    const Original = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Original {
      constructor(...args) {
        super(...args);
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...rest) => {
          if (['note', 'off', 'note-change', 'excite', 'drum-hit', 'reset'].includes(message.type)) window.noteMessages.push(structuredClone(message));
          return post(message, ...rest);
        };
      }
    };
  });
  await page.goto(path);
  await enableFakeMidi(page);
  if (await page.locator('#audioButton').getAttribute('aria-pressed') !== 'true') await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
}
const messages = (page, type) => page.evaluate(type => window.noteMessages.filter(message => message.type === type), type);

test('Synthesaurus Web MIDI owns velocity, pressure, expression, bend and sustain without moving master/root', async ({ page }) => {
  await prepare(page, '/synthesis.html?method=additive');
  const level = await page.locator('#outputLevel').inputValue();
  const frequency = await page.evaluate(() => MorphazoidSynthesis.getState().frequencyHz);
  await sendMidi(page, [0x90, 69, 32], { inputId: 'keys-a' });
  expect((await messages(page, 'note')).at(-1)).toMatchObject({ frequency: 440, velocity: 32 / 127 });
  await sendMidi(page, [0x91, 69, 100], { inputId: 'keys-b' });
  const other = (await messages(page, 'note')).at(-1);
  await sendMidi(page, [0xd0, 100], { inputId: 'keys-a' });
  await sendMidi(page, [0xa0, 69, 50], { inputId: 'keys-a' });
  await sendMidi(page, [0xb0, 11, 64], { inputId: 'keys-a' });
  await sendMidi(page, [0xe0, 127, 127], { inputId: 'keys-a' });
  const changes = await messages(page, 'note-change');
  expect(changes.every(change => change.noteId !== other.noteId)).toBe(true);
  expect(changes.at(-1).frequency).toBeCloseTo(440 * 2 ** (2 / 12));
  expect(changes.at(-1).velocity).toBeCloseTo(32 / 127 * (64 / 127) * (1 + .5 * 50 / 127));
  await expect(page.locator('#outputLevel')).toHaveValue(level);
  expect(await page.evaluate(() => MorphazoidSynthesis.getState().frequencyHz)).toBe(frequency);
  await sendMidi(page, [0xb0, 64, 127], { inputId: 'keys-a' });
  await sendMidi(page, [0x90, 69, 0], { inputId: 'keys-a' });
  expect(await page.evaluate(() => MorphazoidSynthesis.getStatus().heldNotes)).toBe(2);
  await sendMidi(page, [0xb0, 121, 0], { inputId: 'keys-a' });
  expect(await page.evaluate(() => MorphazoidSynthesis.getStatus().heldNotes)).toBe(1);
  await sendMidi(page, [0x81, 69, 0], { inputId: 'keys-b' });
  expect(await page.evaluate(() => MorphazoidSynthesis.getStatus().heldNotes)).toBe(0);
  await sendMidi(page, [0xb0, 7, 48]);
  expect(await page.locator('#outputLevel').inputValue()).not.toBe(level);
});

test('Rezoidinator Web MIDI velocity drives excitation, not output or body parameters', async ({ page }) => {
  await prepare(page, '/simd-resonator-rust.html');
  const before = await page.evaluate(() => __MORPHAZOID_RUST_RESONATOR__.getState());
  await sendMidi(page, [0x90, 60, 32]);
  const soft = (await messages(page, 'excite')).at(-1);
  expect(soft.strength).toBeCloseTo(before.settings.excitationStrength * 32 / 127);
  await expect.poll(async () => (await page.evaluate(() => __MORPHAZOID_RUST_RESONATOR__.getState())).rms).toBeGreaterThan(.00001);
  await sendMidi(page, [0x80, 60, 0]);
  await sendMidi(page, [0xd0, 60]); await sendMidi(page, [0xa0, 60, 100]);
  await sendMidi(page, [0xb0, 11, 64]); await sendMidi(page, [0xe0, 127, 127]);
  expect((await messages(page, 'excite')).length).toBe(1, 'pressure must not retrigger the resonator');
  const after = await page.evaluate(() => __MORPHAZOID_RUST_RESONATOR__.getState());
  expect(after.outputLevel).toBe(before.outputLevel);
  expect(after.settings).toEqual(before.settings);
  await sendMidi(page, [0xb0, 121, 0]);
  await sendMidi(page, [0x90, 60, 112]);
  expect((await messages(page, 'excite')).at(-1).strength / soft.strength).toBeCloseTo(3.5);
  await sendMidi(page, [0x90, 60, 0]);
  expect((await messages(page, 'excite')).length).toBe(2);
  await sendMidi(page, [0xb0, 120, 0]);
  expect((await messages(page, 'reset')).length).toBeGreaterThan(0);
  await expect(page.locator('#outputLevel')).toHaveValue(String(before.outputLevel));
});

test('Quadruped MIDI plays finite velocity-sensitive calls without rewriting master or score', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.gestureStarts = 0;
    for (const Class of [OscillatorNode, AudioBufferSourceNode]) {
      const start = Class.prototype.start;
      Class.prototype.start = function (...args) { window.gestureStarts++; return start.apply(this, args); };
    }
  });
  await prepare(page, '/quadruped.html');
  const capture = () => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
  const status = () => page.evaluate(async () => (await import('/src/audio-output-manager.js')).getSharedAudioOutputManager().getStatus());
  const before = await capture();
  const level = await page.locator('#level').inputValue();
  await sendMidi(page, [0x90, 36, 32]);
  await expect(page.locator('.quadruped-animal-handle').first()).toHaveAttribute('data-action', 'call');
  await expect.poll(async () => (await status()).rms).toBeGreaterThan(.00001);
  const starts = await page.evaluate(() => gestureStarts);
  expect(starts).toBeGreaterThan(0);
  await sendMidi(page, [0x80, 36, 0]);
  await sendMidi(page, [0xd0, 90]); await sendMidi(page, [0xa0, 36, 70]);
  await sendMidi(page, [0xb0, 11, 40]); await sendMidi(page, [0xe0, 127, 127]);
  expect(await page.evaluate(() => gestureStarts)).toBe(starts, 'expression does not retrigger a call');
  await expect(page.locator('#level')).toHaveValue(level);
  expect(await capture()).toEqual(before);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  await sendMidi(page, [0xb0, 121, 0]);
  await sendMidi(page, [0x90, 36, 112]);
  expect(await page.evaluate(() => gestureStarts)).toBeGreaterThan(starts);
  await sendMidi(page, [0x90, 36, 0]);
  await sendMidi(page, [0xb0, 120, 0]);
  await expect(page.locator('.quadruped-animal-handle').first()).toHaveAttribute('data-action', 'idle');
  await expect.poll(async () => (await status()).peak).toBeLessThan(.00001);
  await expect(page.locator('#level')).toHaveValue(level);
  expect(errors).toEqual([]);
});

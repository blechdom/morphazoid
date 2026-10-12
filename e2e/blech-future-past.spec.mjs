import { test, expect } from '@playwright/test';

for (const forceCanvas of [true, false]) test(`${forceCanvas ? 'Canvas' : 'GPU'} shows future, present and fading past; file pause/seek cannot retain unrelated tails`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/blech-midi.html');
  const result = await page.evaluate(async forceCanvas => {
    const [{ createBlackMidiVisualizer, blackMidiKeyLayout }, { parseBlackMidiScore }] = await Promise.all([
      import('/src/instruments/blech-midi/blech-midi-black-renderer.js'), import('/src/instruments/blech-midi/blech-midi-black-score.js'),
    ]);
    const events = [0, 144, 60, 100, 131, 96, 128, 60, 0, 131, 96, 144, 72, 100, 131, 96, 128, 72, 0, 0, 255, 47, 0];
    const bytes = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,events.length,...events]);
    const mount = document.createElement('div'); Object.assign(mount.style, { width: '700px', height: '500px', position: 'fixed', left: '0', top: '0', zIndex: '100' }); document.body.append(mount);
    const transport = { position: .25, playing: false }, view = createBlackMidiVisualizer({ mount, forceCanvas, getTransport: () => transport });
    view.setScore(parseBlackMidiScore(bytes.buffer)); view.render();
    const canvas = mount.querySelector('canvas'), keyboard = mount.querySelectorAll('canvas')[1], key = blackMidiKeyLayout()[60];
    const pixel = (surface, x, y) => {
      const context = surface.getContext('2d');
      if (context) return [...context.getImageData(Math.floor(x * surface.width), Math.floor(y * surface.height), 1, 1).data];
      const gl = surface.getContext('webgl2'), color = new Uint8Array(4);
      gl.readPixels(Math.floor(x * surface.width), surface.height - 1 - Math.floor(y * surface.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, color);
      return [...color];
    };
    const x = key.x + key.width / 2, velocity = view.stats.keyboardTop / 6;
    const future = pixel(canvas, x, view.stats.keyboardTop - .125 * velocity);
    const past = pixel(canvas, x, view.stats.keyboardBottom + .125 * velocity);
    const present = pixel(keyboard, x, (view.stats.keyboardTop + view.stats.keyboardBottom) / 2);
    const stats = { ...view.stats };
    view.render(); const frozen = pixel(canvas, x, view.stats.keyboardBottom + .125 * velocity);
    transport.position = 0; view.render(); const rewound = view.stats.pastVisible;
    transport.position = .25; view.setOptions({ trails: false }); view.render(); const disabled = view.stats.pastVisible;
    view.setOptions({ keyboardPosition: .4 }); view.render(); const moved = view.stats.keyboardTop;
    const renderer = view.renderer; view.dispose(); mount.remove();
    return { future, past, present, frozen, stats, rewound, disabled, moved, renderer };
  }, forceCanvas);
  expect(result.renderer).toBe(forceCanvas ? 'Canvas2D' : 'WebGL2');
  expect(result.stats.futureVisible).toBe(2); expect(result.stats.pastVisible).toBe(1);
  expect(Math.max(...result.future.slice(0, 3))).toBeGreaterThan(200);
  expect(Math.max(...result.past.slice(0, 3))).toBeGreaterThan(100);
  expect(Math.max(...result.past.slice(0, 3))).toBeLessThan(Math.max(...result.future.slice(0, 3)));
  const ratio = result.past[1] / result.future[1];
  for (let index = 0; index < 3; index++) expect(Math.abs(result.past[index] - result.future[index] * ratio)).toBeLessThan(2);
  expect(result.present.slice(0, 3)).toEqual(result.future.slice(0, 3)); expect(result.present[3]).toBe(255);
  expect(result.frozen).toEqual(result.past); expect(result.rewound).toBe(0); expect(result.disabled).toBe(0);
  expect(result.moved).toBeLessThan(.4); expect(errors).toEqual([]);
});

test('a stopped live pad loses its future but keeps the actual pattern moving into the past with Audio off', async ({ page }) => {
  await page.goto('/blech-midi.html');
  await page.evaluate(async () => {
    const [{ createBlackMidiVisualizer }, { MidiMixerEngine }, { mixerStampScore }] = await Promise.all([
      import('/src/instruments/blech-midi/blech-midi-black-renderer.js'), import('/src/instruments/midi-mixer/midi-mixer-engine.js'), import('/src/instruments/midi-mixer/midi-mixer-performance-score.js'),
    ]);
    const mount = document.createElement('div'); mount.id = 'pastPadProbe'; Object.assign(mount.style, { width: '700px', height: '500px' }); document.body.append(mount);
    const engine = new MidiMixerEngine(), view = createBlackMidiVisualizer({ mount, getLiveState: () => engine.state });
    view.setOptions({ pastSeconds: 1 });
    const sample = engine.triggerSample(mixerStampScore('square', { beats: 4 }).buffer, { loop: true });
    globalThis.__pastPad = { engine, view, sample };
  });
  await expect.poll(() => page.evaluate(() => __pastPad.view.stats?.livePastVisible ?? 0)).toBeGreaterThan(0);
  await page.evaluate(() => __pastPad.engine.stopSample(__pastPad.sample.id));
  await expect.poll(() => page.evaluate(() => __pastPad.view.stats?.liveVisible ?? 0)).toBe(0);
  expect(await page.evaluate(() => __pastPad.view.stats.livePastVisible)).toBeGreaterThan(0);
  expect(await page.evaluate(() => __pastPad.engine.context)).toBeNull();
  await expect.poll(() => page.evaluate(() => __pastPad.view.stats?.livePastVisible ?? 0)).toBe(0);
  await page.evaluate(async () => { __pastPad.view.dispose(); await __pastPad.engine.dispose(); });
});

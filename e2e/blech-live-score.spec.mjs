import { test, expect } from '@playwright/test';

test('the falling stage follows actual independent pad/evolution clocks without a loaded file or Audio', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/blech-midi.html');
  await page.evaluate(async () => {
    const [{ createBlackMidiVisualizer }, { MidiMixerEngine }, { mixerStampScore }] = await Promise.all([
      import('/src/instruments/blech-midi/blech-midi-black-renderer.js'),
      import('/src/instruments/midi-mixer/midi-mixer-engine.js'),
      import('/src/instruments/midi-mixer/midi-mixer-performance-score.js'),
    ]);
    const mount = document.createElement('div'); mount.id = 'liveStageProbe';
    Object.assign(mount.style, { position: 'fixed', inset: '100px 10px auto', height: '300px', zIndex: '100' }); document.body.append(mount);
    const engine = new MidiMixerEngine();
    const view = createBlackMidiVisualizer({ mount, getTransport: () => ({ position: 0, playing: false }), getLiveState: () => engine.state });
    const sample = engine.triggerSample(mixerStampScore('square', { beats: 4 }).buffer, { loop: true });
    engine.configureAutomata({ columns: 16, rowBeats: .125, rule: 30 }); engine.setAutomataPlaying(true);
    globalThis.__liveStage = { view, engine, sample };
  });
  const stage = page.locator('#liveStageProbe .midiphoria-black-stage');
  await expect.poll(() => stage.getAttribute('data-live-notes')).not.toBe('0');
  await expect.poll(() => stage.getAttribute('data-live-sources')).toContain('automata');
  const before = await page.evaluate(() => ({ beat: __liveStage.engine.state.sampleBeat, generation: __liveStage.engine.state.automata.generation, ready: __liveStage.engine.state.ready, context: __liveStage.engine.context, renderer: __liveStage.view.renderer }));
  expect(before.ready).toBe(false); expect(before.context).toBeNull();
  await expect.poll(() => page.evaluate(() => __liveStage.engine.state.automata.generation)).toBeGreaterThan(before.generation);
  await page.evaluate(() => __liveStage.engine.stopSample(__liveStage.sample.id));
  await expect(stage).toHaveAttribute('data-live-sources', '["automata"]');
  await page.evaluate(() => __liveStage.engine.setAutomataPlaying(false));
  await expect(stage).toHaveAttribute('data-live-notes', '0');
  await page.evaluate(async () => { __liveStage.view.dispose(); await __liveStage.engine.dispose(); });
  await expect(stage).toHaveCount(0); expect(errors).toEqual([]);
});

test('Canvas fallback paints future pad rectangles and highlights the same keyboard while file time is paused', async ({ page }) => {
  await page.goto('/blech-midi.html');
  const initial = await page.evaluate(async () => {
    const { createBlackMidiVisualizer, blackMidiKeyLayout } = await import('/src/instruments/blech-midi/blech-midi-black-renderer.js');
    const mount = document.createElement('div'); mount.id = 'liveCanvasProbe';
    Object.assign(mount.style, { position: 'fixed', left: '0', top: '100px', width: '1000px', height: '300px', zIndex: '100' }); document.body.append(mount);
    const state = { tempo: 120, samples: [{ id: 1, slot: 0, gain: 1, sync: true, positionBeats: .5, cycle: 0, loop: true,
      analysis: { durationBeats: 4, tempoMap: [{ beat: 0, bpm: 120 }], notes: [{ beat: 0, duration: 1, note: 60, velocity: 100, channel: 0, track: 0 }, { beat: 2, duration: 1, note: 72, velocity: 100, channel: 0, track: 0 }] } }] };
    const view = createBlackMidiVisualizer({ mount, forceCanvas: true, getTransport: () => ({ position: 0, playing: false }), getLiveState: () => state });
    globalThis.__liveCanvas = { view, state, layout: blackMidiKeyLayout() }; view.render();
    const surfaces = mount.querySelectorAll('canvas'), key = blackMidiKeyLayout()[60], keyboard = surfaces[1];
    const pixel = [...keyboard.getContext('2d').getImageData((key.x + key.width / 2) * keyboard.width, keyboard.height - 12, 1, 1).data];
    const image = surfaces[0].getContext('2d').getImageData(0, 0, surfaces[0].width, surfaces[0].height).data;
    let bright = 0; for (let at = 0; at < image.length; at += 4) if (image[at] + image[at + 1] + image[at + 2] > 150) bright++;
    return { pixel, bright, stats: view.stats, renderer: view.renderer };
  });
  expect(initial.renderer).toBe('Canvas2D'); expect(initial.bright).toBeGreaterThan(100);
  expect(initial.stats.liveHeld).toBe(1); expect(initial.pixel.slice(0, 3)).not.toEqual([215, 219, 229]);
  await page.evaluate(() => { __liveCanvas.state.samples[0].positionBeats = 1.5; });
  await expect(page.locator('#liveCanvasProbe .midiphoria-black-stage')).toHaveAttribute('data-live-held', '0');
  await page.evaluate(() => { __liveCanvas.view.setLiveSource(null); });
  await expect(page.locator('#liveCanvasProbe .midiphoria-black-stage')).toHaveAttribute('data-live-notes', '0');
});

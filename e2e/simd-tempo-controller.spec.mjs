import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from './helpers/diagnostics.mjs';

async function installTransportProbe(page) {
  await page.evaluate(async () => {
    const { SimdChiptuneAudio } = await import('./src/instruments/simd-chiptune/audio.js');
    const probe = globalThis.__simdTempoLifecycle = { engines: [], restarts: [], pauses: [], stops: [], playClicks: [] };
    document.addEventListener('click', event => {
      if (event.target.closest('#synthPlayButton')) probe.playClicks.push(performance.now() / 1000);
    }, true);
    const originalStart = SimdChiptuneAudio.prototype.start;
    const originalRestart = SimdChiptuneAudio.prototype.restart;
    const originalPause = SimdChiptuneAudio.prototype.pause;
    const originalStop = SimdChiptuneAudio.prototype.stop;
    SimdChiptuneAudio.prototype.start = function (...args) {
      this.__tempoProbeId = probe.engines.length;
      probe.engines.push(this);
      return originalStart.apply(this, args);
    };
    SimdChiptuneAudio.prototype.restart = async function (...args) {
      const call = { engine: this.__tempoProbeId, offset: args[0]?.offset ?? 0,
        at: performance.now() / 1000, tempo: this.params.tempo };
      const result = await originalRestart.apply(this, args);
      call.audioOffset = this.timelineOffset;
      call.beat = this.currentPlaybackBeat();
      probe.restarts.push(call);
      return result;
    };
    SimdChiptuneAudio.prototype.pause = function (...args) {
      const result = originalPause.apply(this, args);
      probe.pauses.push({ engine: this.__tempoProbeId, offset: result,
        beat: result * this.params.tempo, audioSeconds: this.currentAudioSeconds(), tempo: this.params.tempo });
      return result;
    };
    SimdChiptuneAudio.prototype.stop = function (...args) {
      probe.stops.push({ engine: this.__tempoProbeId, at: performance.now() / 1000,
        beat: this.currentPlaybackBeat(), tempo: this.params.tempo });
      return originalStop.apply(this, args);
    };
  });
}

async function readProbe(page) {
  return page.evaluate(() => {
    const probe = globalThis.__simdTempoLifecycle, engine = probe.engines.at(-1);
    return { restarts: probe.restarts, pauses: probe.pauses, stops: probe.stops, playClicks: probe.playClicks,
      engineCount: probe.engines.length,
      active: engine ? { running: engine.running, tempo: engine.params.tempo, beat: engine.currentPlaybackBeat(),
        audioSeconds: engine.currentAudioSeconds(), renderOffset: engine.renderOffset,
        contextState: engine.context?.state ?? null } : null };
  });
}

async function togglePlaying(page, playing) {
  await page.locator('#synthPlayButton').click();
  await expect(page.locator('#synthPlayButton')).toHaveAttribute('aria-pressed', String(playing));
  if (playing && await page.locator('#audioButton').getAttribute('aria-pressed') === 'true') {
    await expect.poll(async () => (await readProbe(page)).active?.running).toBe(true);
  }
}

async function toggleAudio(page, armed) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', String(armed));
}

test('SIMD tempo preserves paused beats, Audio handoff and reset positions through actual controls', async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  expect((await page.goto('simd-chiptune.html', { waitUntil: 'domcontentloaded' }))?.ok()).toBe(true);
  await settlePage(page);
  await installTransportProbe(page);
  const tempo = page.locator('#simdTempoControls [data-param-key="tempo"]');
  await expect(tempo).toHaveAttribute('role', 'slider');
  const initialTempo = Number(await tempo.getAttribute('aria-valuenow'));

  await test.step('Audio armed before its first playback preserves an existing paused visual beat', async () => {
    await togglePlaying(page, true);
    await page.waitForTimeout(600);
    await togglePlaying(page, false);
    const beforeAudio = await readProbe(page);
    const visualBeat = (beforeAudio.playClicks[1] - beforeAudio.playClicks[0]) * initialTempo;
    expect(visualBeat).toBeGreaterThan(.5);
    expect(beforeAudio.engineCount).toBe(0);
    await toggleAudio(page, true);
    await tempo.press('PageUp');
    await page.locator('#tab-globalMix').click();
    await page.locator('[data-param-key="transpose"]').press('ArrowRight');
    expect((await readProbe(page)).restarts).toHaveLength(0);
    await togglePlaying(page, true);
    const started = await readProbe(page);
    expect(started.restarts).toHaveLength(1);
    expect(Math.abs(started.restarts[0].beat - visualBeat)).toBeLessThan(.06);
    expect(started.engineCount).toBe(1);
  });

  await test.step('a paused tempo change resumes the same musical beat and oscillator seconds', async () => {
    await tempo.press('End');
    await page.waitForTimeout(180);
    await togglePlaying(page, false);
    const paused = (await readProbe(page)).pauses.at(-1);
    expect(paused.beat).toBeGreaterThan(.5);
    await tempo.press('Home');
    const edited = await readProbe(page);
    expect(edited.active.running).toBe(false);
    expect(edited.active.beat).toBeNull();
    expect(edited.active.audioSeconds).toBe(paused.audioSeconds);
    expect(Math.abs(edited.active.renderOffset * edited.active.tempo - paused.beat)).toBeLessThan(1e-8);
    await togglePlaying(page, true);
    const resumed = (await readProbe(page)).restarts.at(-1);
    expect(resumed.engine).toBe(paused.engine);
    expect(resumed.audioOffset).toBe(paused.audioSeconds);
    expect(Math.abs(resumed.beat - paused.beat)).toBeLessThan(1e-8);
  });

  await test.step('Audio off and back on transfers the integrated beat to the visual clock', async () => {
    await tempo.press('End');
    await page.waitForTimeout(180);
    await toggleAudio(page, false);
    await expect(page.locator('#synthPlayButton')).toHaveAttribute('aria-pressed', 'true');
    const stopped = (await readProbe(page)).stops.at(-1);
    expect(stopped.beat).toBeGreaterThan(.5);
    await page.waitForTimeout(300);
    await toggleAudio(page, true);
    const rearmed = await readProbe(page), restarted = rearmed.restarts.at(-1);
    expect(rearmed.engineCount).toBe(2);
    expect(restarted.engine).not.toBe(stopped.engine);
    const expectedBeat = stopped.beat + (restarted.at - stopped.at) * stopped.tempo;
    expect(Math.abs(restarted.beat - expectedBeat)).toBeLessThan(.1);
    expect(rearmed.active.running).toBe(true);
    expect(rearmed.active.contextState).toBe('running');
  });

  await test.step('reset followed by paused knob edits still starts at zero', async () => {
    await togglePlaying(page, false);
    await page.locator('#resetPatch').click();
    await tempo.press('PageUp');
    await page.locator('#tab-globalMix').click();
    await page.locator('[data-param-key="transpose"]').press('ArrowRight');
    await togglePlaying(page, true);
    const reset = (await readProbe(page)).restarts.at(-1);
    expect(reset.offset).toBe(0);
    expect(reset.audioOffset).toBe(0);
    expect(reset.beat).toBe(0);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    const audio = await sampleAudioEnvelope(page, { durationMs: 350 });
    expect(audio.summary.finite).toBe(true);
    expect(audio.summary.maxRms).toBeGreaterThan(.00001);
    expect(audio.summary.clippedSamples).toBe(0);
  });
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

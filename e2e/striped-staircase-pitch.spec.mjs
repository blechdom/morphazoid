import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope, waitForAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const diagnostics = new WeakMap();
test.beforeEach(async ({ page, baseURL }) => diagnostics.set(page, watchPageDiagnostics(page, { baseURL })));
test.afterEach(async ({ page }, info) => {
  const messages = pageDiagnosticMessages(diagnostics.get(page));
  await info.attach('pitch-browser-diagnostics.json', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages).toEqual([]);
});

const snapshot = page => page.evaluate(() => {
  const state = window.__staircaseStudies.snapshot(), values = state.audioVoices;
  const voices = (state.rhythm?.voices ?? []).filter(voice => voice.presence >= .5).map(voice => {
    const at = voice.slot * 6;
    return { ...voice, audioId: values[at], frequency: values[at + 1], referenceX: values[at + 2],
      referenceY: values[at + 3], hasRef: Boolean(values[at + 4]), audioParentId: values[at + 5] };
  });
  return { ...state, audioVoices: undefined, voices };
});

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function open(page) {
  await page.goto('/striped-staircase-rust.html');
  await page.waitForFunction(() => window.__staircaseStudies?.snapshot().ready);
  await expect(page.locator('#pitchMapping')).toHaveValue('1');
  await expect(page.locator('#pitchSpan')).toHaveValue('3');
  await expect(page.locator('#voiceLimit')).toHaveValue('256');
  await page.locator('#holdButton').click();
}

async function sound(page) {
  await page.locator('#playButton').click(); await page.locator('#audioButton').click();
  await waitForAudioState(page, true);
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.voices.length > 0 && state.voices.every(voice => voice.id === voice.audioId && voice.frequency > 0);
  }).toBe(true);
}

async function settled(page) {
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.ready && state.acceptedRevision === state.revision && (!state.audio || state.audioRevision === state.revision);
  }, { timeout: 20_000 }).toBe(true);
}

test('Height and Frame X/Y map real branch positions to distinct pitches without restarting audio', async ({ page }, info) => {
  await open(page); await sound(page);
  const evidence = [];
  for (const mapping of [0, 1]) {
    const before = await snapshot(page);
    await page.locator('#pitchMapping').selectOption(String(mapping));
    await expect.poll(async () => {
      const state = await snapshot(page);
      return Math.max(...state.voices.map(voice => Math.abs(Math.log2(voice.frequency / state.baseFrequency)
        - state.pitchSpan * (mapping === 0 ? .5 - voice.cy : (voice.cx - voice.cy) / 2))));
    }).toBeLessThan(.002);
    const state = await snapshot(page);
    expect(state.clock).toBeGreaterThan(before.clock);
    expect(state).toMatchObject({ playing: true, audio: true, hold: true });
    evidence.push(state);
  }
  const xy = evidence[1], height = evidence[0];
  expect(new Set(xy.voices.map(voice => voice.cx.toFixed(2))).size).toBeGreaterThan(1);
  expect(new Set(xy.voices.map(voice => voice.cy.toFixed(2))).size).toBeGreaterThan(1);
  expect(xy.voices.some(voice => Math.abs(Math.log2(voice.frequency / height.voices.find(other => other.id === voice.id).frequency)) > .05)).toBe(true);
  await range(page, 'pitchSpan', 0);
  await expect.poll(async () => Math.max(...(await snapshot(page)).voices.map(voice => Math.abs(voice.frequency - xy.baseFrequency)))).toBeLessThan(.1);
  await range(page, 'pitchSpan', 6);
  await expect.poll(async () => {
    const state = await snapshot(page);
    return Math.max(...state.voices.map(voice => Math.abs(Math.log2(voice.frequency / state.baseFrequency) - 3 * (voice.cx - voice.cy))));
  }).toBeLessThan(.002);
  const output = await sampleAudioEnvelope(page, { durationMs: 400 });
  expect(output.summary.maxRms).toBeGreaterThan(.00001); expect(output.summary.clippedSamples).toBe(0);
  await page.locator('#resetAll').click();
  await expect(page.locator('#pitchMapping')).toHaveValue('1');
  await expect(page.locator('#pitchSpan')).toHaveValue('3');
  await expect(page.locator('#voiceLimit')).toHaveValue('256');
  expect((await snapshot(page)).audio).toBe(true);
  await info.attach('absolute-pitch-mappings.json', { body: JSON.stringify({ evidence, output: output.summary }), contentType: 'application/json' });
});

test('Relative turns retain onset history, inherit nearby offshoot references, and clear history on seek', async ({ page }, info) => {
  await open(page); await page.locator('#pitchMapping').selectOption('2'); await sound(page);
  await page.waitForTimeout(300);
  const initial = await snapshot(page);
  await page.waitForTimeout(300);
  const held = await snapshot(page);
  expect(held.voices.map(voice => [voice.id, voice.referenceX, voice.referenceY])).toEqual(initial.voices.map(voice => [voice.id, voice.referenceX, voice.referenceY]));
  // Register smoothing may still be settling; Hold must not accumulate intervals.
  expect(Math.max(...held.voices.map((voice, index) => Math.abs(Math.log2(voice.frequency / initial.voices[index].frequency))))).toBeLessThan(.0001);
  expect(held.clock).toBeGreaterThan(initial.clock);
  await range(page, 'speed', .1);
  await page.locator('#holdButton').click();
  const history = await page.evaluate(async () => {
    const rows = [], deadline = performance.now() + 2200;
    while (performance.now() < deadline) {
      const s = window.__staircaseStudies.snapshot(), audio = s.audioVoices;
      rows.push({ progress: s.progress, white: s.audioWhite, clock: s.clock, voices: (s.rhythm?.voices ?? []).filter(v => v.presence >= .5).map(v => {
        const at = v.slot * 6;
        return { ...v, audioId: audio[at], frequency: audio[at + 1], referenceX: audio[at + 2], referenceY: audio[at + 3], hasRef: Boolean(audio[at + 4]), audioParentId: audio[at + 5] };
      }) });
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return rows;
  });
  await page.locator('#holdButton').click();
  await info.attach('relative-pitch-history.json', { body: JSON.stringify({ initial, held, history }), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('relative-turn-references.png'), fullPage: true });
  const onsets = history.filter((row, index) => row.white && (index === 0 || !history[index - 1].white));
  expect(onsets.length).toBeGreaterThan(2);
  const referred = history.flatMap(row => row.voices).filter(voice => voice.id === voice.audioId && voice.hasRef);
  expect(referred.some(voice => voice.parentId > 0 && voice.parentId === voice.audioParentId
    && Math.hypot(voice.cx - voice.referenceX, voice.cy - voice.referenceY) > .005)).toBe(true);
  expect(referred.some(voice => Math.abs(Math.log2(voice.frequency / initial.baseFrequency) - initial.pitchSpan * (voice.cx - voice.cy) / 2) > .01)).toBe(true);
  await range(page, 'progress', .175);
  await expect.poll(async () => {
    const s = await snapshot(page);
    return Math.max(...s.voices.map(voice => Math.abs(Math.log2(voice.frequency / s.baseFrequency) - s.pitchSpan * (voice.cx - voice.cy) / 2)));
  }).toBeLessThan(.002);
});

test('the 512-voice limit renders more than 256 real components through a 300 ms UI stall', async ({ page }, info) => {
  test.setTimeout(60_000);
  await open(page);
  await page.locator('#viewPreset').selectOption('double-spiral'); await range(page, 'voiceLimit', 512); await settled(page);
  const scene = await page.evaluate(async () => {
    const { buildStaircaseField, readStaircaseRhythm } = await import('/src/instruments/striped-staircase-rust/field.js');
    const state = window.__staircaseStudies.snapshot(), rect = document.getElementById('stage').getBoundingClientRect();
    const field = buildStaircaseField({ camera: state.camera, settings: state.settings, voiceLimit: 512, resolution: 112, aspect: rect.width / rect.height });
    return Array.from({ length: 1001 }, (_, index) => {
      const progress = index / 1000, rhythm = readStaircaseRhythm(field, progress);
      return { progress, count: rhythm.count, white: rhythm.white };
    }).filter(row => row.white).sort((a, b) => b.count - a.count)[0];
  });
  expect(scene.count).toBeGreaterThan(256);
  await range(page, 'progress', scene.progress); await sound(page);
  await expect.poll(async () => (await snapshot(page)).audioBranches).toBe(scene.count);
  const before = await snapshot(page);
  await range(page, 'voiceLimit', 64); await settled(page);
  await expect.poll(async () => (await snapshot(page)).audioBranches).toBeLessThanOrEqual(64);
  expect((await snapshot(page)).clock).toBeGreaterThan(before.clock);
  await range(page, 'voiceLimit', 512); await settled(page);
  await expect.poll(async () => (await snapshot(page)).audioBranches).toBeGreaterThan(256);
  const capture = await page.evaluate(async () => {
    const { OutputRecorder } = await import('/src/output-recorder.js');
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager(), recorder = new OutputRecorder({ manager }); await recorder.start();
    const context = manager.recordingContext(), start = context.currentTime, before = window.__staircaseStudies.snapshot().clock;
    await new Promise(resolve => setTimeout(resolve, 250));
    const until = performance.now() + 300; while (performance.now() < until) { /* UI stall during real multi-voice synthesis. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
    const elapsed = context.currentTime - start, clock = window.__staircaseStudies.snapshot().clock;
    const take = await recorder.stop(), bytes = new Uint8Array(await take.blob.arrayBuffer());
    const frames = (bytes.length - 44) / 6, windowFrames = Math.round(take.sampleRate * .01), rms = [];
    for (let at = windowFrames; at + windowFrames < frames; at += windowFrames) {
      let sum = 0;
      for (let frame = at; frame < at + windowFrames; frame++) for (let channel = 0; channel < 2; channel++) {
        const offset = 44 + frame * 6 + channel * 3;
        const integer = (bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16) << 8 >> 8;
        sum += (integer / 8388608) ** 2;
      }
      rms.push(Math.sqrt(sum / (windowFrames * 2)));
    }
    recorder.discard();
    return { error: take.error, elapsed, seconds: frames / take.sampleRate, sampleRate: take.sampleRate, clockDelta: clock - before, rms };
  });
  expect(capture.error).toBe(''); expect(capture.seconds).toBeGreaterThan(.7);
  expect(Math.abs(capture.seconds - capture.elapsed)).toBeLessThan(.05);
  expect(capture.clockDelta).toBeGreaterThan(capture.sampleRate * .6);
  expect(Math.min(...capture.rms)).toBeGreaterThan(.00001);
  expect((await readAudioStatus(page)).clipped).toBe(false);
  await info.attach('512-voices-through-stall.json', { body: JSON.stringify({ scene, state: await snapshot(page), capture }), contentType: 'application/json' });
});

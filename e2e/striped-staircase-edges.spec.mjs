import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope, waitForAudioState, waitForStableAudioState } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

const diagnostics = new WeakMap();
test.beforeEach(async ({ page, baseURL }) => diagnostics.set(page, watchPageDiagnostics(page, { baseURL })));
test.afterEach(async ({ page }, info) => {
  const messages = pageDiagnosticMessages(diagnostics.get(page));
  await info.attach('edge-browser-diagnostics.json', { body: JSON.stringify(messages), contentType: 'application/json' });
  expect(messages).toEqual([]);
});

const snapshot = page => page.evaluate(() => {
  const state = window.__staircaseStudies.snapshot(), values = state.audioVoices;
  return { ...state, audioVoices: undefined,
    voices: (state.rhythm?.voices ?? []).filter(voice => voice.presence >= .5).map(voice => {
      const at = voice.slot * 6;
      return { ...voice, audioId: values[at], frequency: values[at + 1], referenceX: values[at + 2],
        referenceY: values[at + 3], hasRef: Boolean(values[at + 4]), audioParentId: values[at + 5] };
    }) };
});

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function settled(page) {
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.ready && state.acceptedRevision === state.revision && (!state.audio || state.audioRevision === state.revision);
  }, { timeout: 20_000 }).toBe(true);
}

async function open(page) {
  await page.goto('/striped-staircase-rust.html'); await settled(page);
  await expect(page.locator('#pitchSource')).toHaveValue('1');
  await expect(page.locator('#voiceLimit')).toHaveAttribute('min', '2');
  await expect(page.locator('#voiceLimit')).toHaveAttribute('step', '2');
  await page.locator('#holdButton').click();
}

async function sound(page) {
  await page.locator('#playButton').click(); await page.locator('#audioButton').click();
  await waitForAudioState(page, true);
  await expect.poll(async () => {
    const state = await snapshot(page);
    return state.audioWhite && state.voices.length > 0 && state.voices.every(voice => voice.audioId === voice.id && voice.frequency > 0);
  }).toBe(true);
}

function pairs(voices) {
  const groups = new Map();
  for (const voice of voices) {
    if (!groups.has(voice.tendrilId)) groups.set(voice.tendrilId, []);
    groups.get(voice.tendrilId).push(voice);
  }
  for (const pair of groups.values()) {
    expect(pair).toHaveLength(2);
    expect(pair.map(voice => voice.side).sort()).toEqual([0, 1]);
    expect(new Set(pair.map(voice => voice.id)).size).toBe(2);
    for (const voice of pair) expect(voice.id).toBe(2 * voice.tendrilId - 1 + voice.side);
  }
  return [...groups.values()];
}

test('each block has two centered edge pitches, white sustains both, and black releases both', async ({ page }, info) => {
  await open(page); await sound(page);
  const evidence = [];
  for (const mapping of [1, 0]) {
    await page.locator('#pitchMapping').selectOption(String(mapping));
    await expect.poll(async () => {
      const state = await snapshot(page);
      return Math.max(...state.voices.map(voice => Math.abs(Math.log2(voice.frequency / state.baseFrequency)
        - state.pitchSpan * (mapping === 0 ? .5 - voice.cy : (voice.cx - voice.cy) / 2))));
    }).toBeLessThan(.002);
    const state = await snapshot(page), grouped = pairs(state.voices);
    expect(state.audioBranches).toBe(state.voices.length);
    expect(state.rhythm.tendrils).toBe(grouped.length);
    for (const pair of grouped) {
      const [a, b] = pair, interval = Math.log2(a.frequency / b.frequency);
      const expected = state.pitchSpan * (mapping === 0 ? b.cy - a.cy : (a.cx - b.cx - a.cy + b.cy) / 2);
      expect(Math.abs(interval - expected), 'even a narrow pair follows its measured edge separation').toBeLessThan(.00001);
    }
    expect(grouped.every(pair => Math.hypot(pair[0].cx - pair[1].cx, pair[0].cy - pair[1].cy) > 0)).toBe(true);
    evidence.push(state);
  }
  const tendrils = evidence[1].rhythm.tendrils;
  await expect(page.locator('#tendrilCount')).toHaveText(String(tendrils));
  await expect(page.locator('#rhythmReadout')).toContainText(`${evidence[1].voices.length} voices`);
  const output = await sampleAudioEnvelope(page, { durationMs: 450 });
  expect(output.summary.maxRms).toBeGreaterThan(.00001); expect(output.summary.clippedSamples).toBe(0);
  await page.screenshot({ path: info.outputPath('paired-edge-pitches.png') });

  const centered = await page.evaluate(async () => {
    const { OutputRecorder } = await import('/src/output-recorder.js');
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const recorder = new OutputRecorder({ manager: getSharedAudioOutputManager() });
    await recorder.start(); await new Promise(resolve => setTimeout(resolve, 300));
    const take = await recorder.stop(), bytes = new Uint8Array(await take.blob.arrayBuffer());
    let maxChannelDifference = 0;
    for (let frame = 44; frame + 5 < bytes.length; frame += 6) {
      const left = (bytes[frame] | bytes[frame + 1] << 8 | bytes[frame + 2] << 16) << 8 >> 8;
      const right = (bytes[frame + 3] | bytes[frame + 4] << 8 | bytes[frame + 5] << 16) << 8 >> 8;
      maxChannelDifference = Math.max(maxChannelDifference, Math.abs(left - right));
    }
    recorder.discard();
    return { error: take.error, frames: (bytes.length - 44) / 6, maxChannelDifference };
  });
  expect(centered.error).toBe(''); expect(centered.frames).toBeGreaterThan(8_000);
  expect(centered.maxChannelDifference).toBe(0);
  await range(page, 'progress', .19);
  await expect.poll(async () => (await snapshot(page)).audioWhite).toBe(false);
  await waitForStableAudioState(page, false);
  const black = await snapshot(page); pairs(black.voices);
  expect(black.rhythm.tendrils).toBeGreaterThan(0);
  await expect(page.locator('#tendrilCount')).toHaveText(String(black.rhythm.tendrils));
  expect(black).toMatchObject({ playing: true, audio: true, hold: true });
  await info.attach('paired-edge-pitch-and-gate.json', { body: JSON.stringify({ evidence, black, centered, output: output.summary }), contentType: 'application/json' });
});

test('switching pitch sources preserves the clock and restores complete edge pairs', async ({ page }, info) => {
  await open(page); await sound(page);
  const initial = await snapshot(page); pairs(initial.voices);
  const states = [];
  for (const source of [0, 1]) {
    const before = await snapshot(page);
    await page.locator('#pitchSource').selectOption(String(source)); await settled(page);
    await expect.poll(async () => (await snapshot(page)).clock).toBeGreaterThan(before.clock);
    await waitForAudioState(page, true);
    const state = await snapshot(page);
    expect(state).toMatchObject({ audio: true, playing: true, hold: true, pitchSource: source });
    expect(state.progress).toBeCloseTo(initial.progress, 7);
    expect(state.audioBranches).toBe(state.voices.length);
    await expect(page.locator('#tendrilCount')).toHaveText(String(state.audioBranches / (source === 1 ? 2 : 1)));
    states.push(state);
  }
  pairs(states[1].voices);
  expect(states[1].voices.map(voice => [voice.id, voice.side, voice.tendrilId])).toEqual(initial.voices.map(voice => [voice.id, voice.side, voice.tendrilId]));
  await range(page, 'voiceLimit', 2); await settled(page);
  await expect.poll(async () => (await snapshot(page)).audioBranches).toBe(2);
  expect(pairs((await snapshot(page)).voices)).toHaveLength(1);
  await expect(page.locator('#tendrilCount')).toHaveText('1');
  await page.locator('#resetAll').click();
  await expect(page.locator('#pitchSource')).toHaveValue('1');
  await expect(page.locator('#voiceLimit')).toHaveValue('256');
  expect((await snapshot(page)).audio).toBe(true);
  await info.attach('edge-source-switches.json', { body: JSON.stringify({ initial, states }), contentType: 'application/json' });
});

test('moving edge voices retain their side identities and inherit the matching parent side', async ({ page }, info) => {
  await open(page); await page.locator('#pitchMapping').selectOption('2'); await sound(page);
  await range(page, 'speed', .1); await page.locator('#holdButton').click();
  const history = await page.evaluate(async () => {
    const rows = [], deadline = performance.now() + 2600;
    while (performance.now() < deadline) {
      const state = window.__staircaseStudies.snapshot(), audio = state.audioVoices;
      rows.push({ progress: state.progress, white: state.audioWhite, voices: (state.rhythm?.voices ?? []).filter(voice => voice.presence >= .5).map(voice => {
        const at = voice.slot * 6;
        return { ...voice, audioId: audio[at], frequency: audio[at + 1], audioParentId: audio[at + 5] };
      }) });
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return rows;
  });
  await page.locator('#holdButton').click();
  await info.attach('moving-edge-identities.json', { body: JSON.stringify(history), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('moving-edge-references.png') });
  const identities = new Map(), positions = new Map(), order = new Map();
  let movements = 0, inherited = 0, reversals = 0;
  for (const row of history) {
    for (const pair of pairs(row.voices)) {
      const side0 = pair.find(voice => voice.side === 0), side1 = pair.find(voice => voice.side === 1);
      const difference = side0.cx - side1.cx, previous = order.get(side0.tendrilId);
      if (previous !== undefined && previous * difference < 0) reversals++;
      order.set(side0.tendrilId, difference);
    }
    for (const voice of row.voices) {
      const identity = [voice.tendrilId, voice.side, voice.boundary];
      if (identities.has(voice.id)) expect(identity).toEqual(identities.get(voice.id));
      identities.set(voice.id, identity);
      const previous = positions.get(voice.id);
      if (previous && Math.hypot(previous.cx - voice.cx, previous.cy - voice.cy) > .0001) movements++;
      positions.set(voice.id, voice);
      if (voice.parentId && identities.has(voice.parentId)) {
        expect(identities.get(voice.parentId)[1]).toBe(voice.side);
        expect(identities.get(voice.parentId)[2]).toBe(voice.boundary);
        if (row.white && voice.audioId === voice.id && voice.audioParentId === voice.parentId) inherited++;
      }
    }
  }
  expect(movements).toBeGreaterThan(10); expect(inherited).toBeGreaterThan(0);
  expect(reversals, 'fixed side labels survive a bend that reverses their screen X ordering').toBeGreaterThan(0);
  await page.waitForTimeout(150);
  const held = await snapshot(page); await page.waitForTimeout(250);
  const later = await snapshot(page);
  expect(later.progress).toBeCloseTo(held.progress, 7);
  expect(later.voices.map(voice => [voice.id, voice.referenceX, voice.referenceY])).toEqual(held.voices.map(voice => [voice.id, voice.referenceX, voice.referenceY]));
});

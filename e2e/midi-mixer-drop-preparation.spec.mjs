import { test, expect } from '@playwright/test';

async function openPerformance(page, staged = true, drawing = false) {
  await page.route('**/qa-midi-drop.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Drop component QA</title><body><main id="performance"></main></body></html>' }));
  await page.goto('/qa-midi-drop.html');
  await page.evaluate(async ({ staged, drawing }) => {
    const { MidiMixerEngine } = await import('/src/instruments/midi-mixer/midi-mixer-engine.js');
    const { mountMixerPerformance } = await import('/src/instruments/midi-mixer/midi-mixer-performance.js');
    const { generateGridMidi } = await import('/src/instruments/midiphoria/midiphoria-text-midi.js');
    const engine = new MidiMixerEngine(), preparations = [];
    const drawingScore = drawing ? generateGridMidi([[0, 0], [1, 0], [1, 0], [0, 0]], { secondsPerRow: .25, lowestNote: 60 }) : null;
    const view = mountMixerPerformance(document.querySelector('#performance'), {
      engine, showVisualizer: false, orientation: 'falling',
      ...(drawing ? { getDrawing: () => drawingScore } : {}),
      ...(staged ? { onPrepare: (score, options) => preparations.push({ score, options }) } : {}),
    });
    view.setActive(true);
    globalThis.dropQA = { engine, view, preparations };
  }, { staged, drawing });
}

test('preparing and choosing stamps stays silent; transformed drops own independent channel, delay and score', async ({ page }) => {
  await openPerformance(page);
  await page.locator('[data-mixer-sample="heart"]').click();
  const prepared = await page.evaluate(() => ({ count: dropQA.preparations.filter(item => item.score).length, layers: dropQA.engine.state.samples.length, audio: dropQA.engine.state.audioEnabled, context: Boolean(dropQA.engine.context), name: dropQA.view.getPreparedDrop().options.name, stamps: dropQA.view.getStamps().length }));
  expect(prepared).toEqual({ count: 1, layers: 0, audio: false, context: false, name: 'Heart', stamps: 30 });
  const sent = await page.evaluate(() => {
    const score = dropQA.view.getPreparedScore(), originalPitches = score.notes.map(note => note.note);
    const result = dropQA.view.sendScore(score, { name: 'Heart layer', channel: 5, program: 81, transpose: 7, delayBeats: 3, loop: true, gain: .3, source: 'frames' });
    new Uint8Array(score.buffer).fill(0); score.notes[0].note = 0;
    const sample = dropQA.engine.state.samples[0];
    return { id: result.sampleId, drop: result.drop, pending: sample.pending, delay: sample.pendingBeats, pitches: sample.analysis.notes.map(note => note.note), originalPitches, channels: sample.analysis.channels.map(channel => channel.channel), program: sample.midi.program, gain: sample.gain, source: sample.source, preparedByte: new Uint8Array(dropQA.view.getPreparedScore().buffer)[0] };
  });
  expect(sent.id).toBeGreaterThan(0); expect(sent.pending).toBe(true); expect(sent.delay).toBeGreaterThan(2.9);
  expect(sent.pitches).toEqual(sent.originalPitches.map(note => note + 7));
  expect(sent.channels).toEqual([5]); expect(sent.program).toBe(81); expect(sent.gain).toBe(.3); expect(sent.source).toBe('frames');
  expect(sent.drop.transpose).toBe(7); expect(sent.preparedByte).toBe(77);
  await page.evaluate(() => dropQA.view.prepareStamp('star'));
  expect(await page.evaluate(() => ({ layers: dropQA.engine.state.samples.length, selected: dropQA.view.getPreparedDrop().options.stampId }))).toEqual({ layers: 1, selected: 'star' });
});

test('the shared mixer retains immediate stamp triggering without staged opt-in', async ({ page }) => {
  await openPerformance(page, false);
  await page.locator('[data-mixer-sample="heart"]').click();
  expect(await page.evaluate(() => ({ layers: dropQA.engine.state.samples.length, pending: dropQA.engine.state.samples[0].pending, audio: dropQA.engine.state.audioEnabled, context: Boolean(dropQA.engine.context) }))).toEqual({ layers: 1, pending: false, audio: false, context: false });
});

test('stamp refresh and variation update the preparation without launching a layer before Send', async ({ page }) => {
  await openPerformance(page);
  await page.locator('[data-mixer-sample="noise"]').click();
  const original = await page.evaluate(() => Array.from(new Uint8Array(dropQA.view.getPreparedScore().buffer)));
  await page.locator('#mixerStampAgain').click();
  expect(await page.evaluate(() => ({ count: dropQA.preparations.filter(item => item.score).length, layers: dropQA.engine.state.samples.length, bytes: Array.from(new Uint8Array(dropQA.view.getPreparedScore().buffer)) }))).toEqual({ count: 2, layers: 0, bytes: original });
  await page.locator('#mixerStampVariation').click();
  const varied = await page.evaluate(() => ({ count: dropQA.preparations.filter(item => item.score).length, layers: dropQA.engine.state.samples.length, context: Boolean(dropQA.engine.context), bytes: Array.from(new Uint8Array(dropQA.view.getPreparedScore().buffer)) }));
  expect(varied.count).toBe(3); expect(varied.layers).toBe(0); expect(varied.context).toBe(false); expect(varied.bytes).not.toEqual(original);
  await page.evaluate(() => dropQA.view.sendScore(dropQA.view.getPreparedScore(), { source: 'frames', delayBeats: 2 }));
  expect(await page.evaluate(() => dropQA.engine.state.samples.length)).toBe(1);
});

function fileFixture(pitch, endBeat = 4) {
  const vlq = value => { const bytes = [value & 127]; while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128); return bytes; };
  const data = [0, 144, pitch, 90, 96, 128, pitch, 0, ...vlq((endBeat - 1) * 96), 255, 47, 0];
  const bytes = Buffer.alloc(22 + data.length);
  bytes.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107]); bytes.writeUInt32BE(data.length, 18); bytes.set(data, 22); return bytes;
}

test('file preparation uses the selected score, invalidates on clear and leaves long-file playback available', async ({ page }) => {
  await page.route('**/qa-midi-file-drop.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>File drop QA</title><body><button id="arm" type="button">Audio</button><main id="files"></main><section id="credits"><p id="blackSongDescription"></p><p id="blackSongCredit"></p></section></body></html>' }));
  await page.route('**/assets/midiphoria/qa-visible.mid', route => route.fulfill({ contentType: 'audio/midi', body: fileFixture(76) }));
  await page.route('**/assets/midiphoria/qa-audio.mid', route => route.fulfill({ contentType: 'audio/midi', body: fileFixture(42) }));
  await page.goto('/qa-midi-file-drop.html');
  await page.evaluate(async () => {
    const { MidiMixerEngine } = await import('/src/instruments/midi-mixer/midi-mixer-engine.js');
    const { mountBlechFilePlayer } = await import('/src/instruments/blech-midi/blech-midi-file-player.js');
    const preparations = [], engine = new MidiMixerEngine();
    const player = mountBlechFilePlayer(document.querySelector('#files'), { engine, creditsHost: document.querySelector('#credits'), onPrepare: value => preparations.push(value) });
    player.setCollection([{ id: 'visible', title: 'Decorative score', file: 'qa-visible.mid', pairedAudioId: 'audio' }, { id: 'audio', title: 'AUDIO edition', file: 'qa-audio.mid' }]);
    document.querySelector('#arm').addEventListener('click', async () => { await engine.enableAudio(); await player.enableAudio(); });
    globalThis.fileDropQA = { engine, player, preparations };
  });
  await page.locator('#blackSongSelect').selectOption('visible');
  await expect(page.locator('#blackPlayerStatus')).not.toHaveText('Loading MIDI…');
  expect(await page.locator('#blackPlayerStatus').textContent()).toBe('');
  await expect.poll(() => page.evaluate(() => fileDropQA.player.getPreparedScore()?.noteCount)).toBe(1);
  expect(await page.evaluate(() => ({ pitches: fileDropQA.player.getPreparedScore().analysis.notes.map(note => note.note), source: fileDropQA.player.getSettings().source, audio: fileDropQA.engine.state.audioEnabled }))).toEqual({ pitches: [76], source: 'files', audio: false });
  await page.locator('#blackSongSelect').selectOption('');
  expect(await page.evaluate(() => ({ score: fileDropQA.player.getPreparedScore(), callback: fileDropQA.preparations.at(-1).score }))).toEqual({ score: null, callback: null });
  await expect(page.locator('#blackPlayButton')).toBeDisabled();
  await page.locator('#blackMidiFile').setInputFiles({ name: 'long.mid', mimeType: 'audio/midi', buffer: fileFixture(60, 513) });
  await expect.poll(() => page.evaluate(() => fileDropQA.preparations.at(-1).error)).toMatch(/512 beats/);
  expect(await page.evaluate(() => fileDropQA.player.getPreparedScore())).toBeNull();
  expect(await page.evaluate(() => fileDropQA.preparations.at(-1).error)).toMatch(/512 beats/);
  await page.locator('#arm').click();
  await expect(page.locator('#blackPlayButton')).toBeEnabled();
  await page.locator('#blackPlayButton').click();
  await expect(page.locator('#blackPlayButton')).toHaveAttribute('aria-pressed', 'true');
});

test('stage channel menu uses MIDI channels 1–16 and edited text keeps its routing and queued delay', async ({ page }) => {
  await openPerformance(page);
  await page.evaluate(async () => {
    const { mountBlechDropStage } = await import('/src/instruments/blech-midi/blech-midi-drop-stage.js');
    const { generateLaidOutTextMidi } = await import('/src/instruments/midiphoria/midiphoria-text-midi.js');
    const host = document.createElement('section'), viewport = document.createElement('div');
    viewport.style.cssText = 'width:600px;height:400px;position:relative'; document.body.prepend(host, viewport);
    const original = generateLaidOutTextMidi('A', { span: 24, lowestNote: 40 }); original.textSettings = { message: 'A', span: 24, lowestNote: 40 };
    const stage = mountBlechDropStage(host, viewport, { getTempo: () => dropQA.engine.state.tempo, onDrop: (score, options) => dropQA.view.sendScore(score, options) });
    stage.prepare(original, { source: 'text', name: 'Text A' });
    dropQA.stage = stage; dropQA.text = generateLaidOutTextMidi;
  });
  for (const channel of [0, 6, 9, 15]) {
    await page.locator('#blechDropChannel').selectOption({ value: String(channel) });
    await page.locator('#blechDropSend').click();
    const result = await page.evaluate(() => {
      const sample = dropQA.engine.state.samples.at(-1);
      return { selected: dropQA.stage.getSettings().channel, channel: sample.channel, notes: [...new Set(sample.analysis.notes.map(note => note.channel))] };
    });
    expect(result).toEqual({ selected: channel, channel, notes: [channel] });
  }
  await page.evaluate(() => {
    dropQA.engine.stopSamples();
    const original = dropQA.text('A', { span: 24, lowestNote: 40 }); original.textSettings = { message: 'A', span: 24, lowestNote: 40 };
    dropQA.sentText = dropQA.view.sendScore(original, { channel: 6, transpose: 12, program: 81, gain: .25, delayBeats: 4, loop: true, source: 'text' });
    const edited = dropQA.text('B', { span: 24, lowestNote: 40 }); edited.textSettings = { message: 'B', span: 24, lowestNote: 40 };
    dropQA.expectedPitches = edited.notes.map(note => note.note + 12);
    dropQA.view.replaceScore(dropQA.sentText.sampleId, edited, { when: 'next-loop' });
  });
  const edited = await page.evaluate(() => {
    const sample = dropQA.engine.state.samples[0];
    return { channel: sample.channel, channels: sample.analysis.channels.map(voice => voice.channel), program: sample.midi.program, gain: sample.gain, source: sample.source, delay: sample.pendingBeats, pitches: sample.analysis.notes.map(note => note.note), expected: dropQA.expectedPitches };
  });
  expect(edited.channel).toBe(6); expect(edited.channels).toEqual([6]); expect(edited.program).toBe(81); expect(edited.gain).toBe(.25); expect(edited.source).toBe('text'); expect(edited.delay).toBeGreaterThan(3.9); expect(edited.pitches.toSorted((a, b) => a - b)).toEqual(edited.expected.toSorted((a, b) => a - b));
});

test('an asynchronous stamp selection clears the old preparation and stale downloads cannot restore it', async ({ page }) => {
  let releaseSlow;
  const waiting = new Promise(resolve => { releaseSlow = resolve; });
  await page.route('**/assets/midiphoria/qa-slow-stamp.mid', async route => { await waiting; await route.fulfill({ contentType: 'audio/midi', body: fileFixture(80) }).catch(() => {}); });
  await page.route('**/assets/midiphoria/qa-failed-stamp.mid', route => route.fulfill({ status: 404, body: '' }));
  await openPerformance(page);
  await page.evaluate(async () => {
    dropQA.view.setCollection([{ id: 'slow', title: 'Slow file', file: 'qa-slow-stamp.mid', collection: 'Black MIDI' }, { id: 'failed', title: 'Missing file', file: 'qa-failed-stamp.mid', collection: 'Black MIDI' }]);
    await dropQA.view.prepareStamp('square');
    dropQA.pending = dropQA.view.prepareStamp('slow');
  });
  expect(await page.evaluate(() => ({ score: dropQA.view.getPreparedScore(), last: dropQA.preparations.at(-1) }))).toMatchObject({ score: null, last: { score: null, options: { stampId: 'slow', error: 'Loading stamp…' } } });
  await page.evaluate(() => dropQA.view.prepareStamp('star'));
  releaseSlow();
  await page.evaluate(() => dropQA.pending);
  expect(await page.evaluate(() => dropQA.view.getPreparedDrop().options.stampId)).toBe('star');
  await page.evaluate(() => dropQA.view.prepareStamp('failed'));
  expect(await page.evaluate(() => ({ score: dropQA.view.getPreparedScore(), last: dropQA.preparations.at(-1) }))).toMatchObject({ score: null, last: { score: null, options: { stampId: 'failed' } } });
  expect(await page.evaluate(() => dropQA.preparations.at(-1).options.error)).toMatch(/Could not load/);
  expect(await page.evaluate(() => dropQA.engine.state.samples.length)).toBe(0);
});

test('drawing preparation applies the source gate once while raw raster access stays unchanged', async ({ page }) => {
  await openPerformance(page, true, true);
  await page.locator('#mixerStampGate').evaluate(input => { input.value = '.5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  const result = await page.evaluate(async () => {
    const { parseMidi } = await import('/src/instruments/midi-mixer/midi-mixer-model.js');
    const raw = dropQA.view.getDrawingScore(), staged = dropQA.view.getDrawingScore({ applyGate: true });
    dropQA.view.sendScore(staged, { name: 'Drawing', source: 'frames', delayBeats: 2 });
    const durations = score => parseMidi(score.buffer).notes.map(note => note.duration);
    return { raw: durations(raw), staged: durations(staged), sent: dropQA.engine.state.samples[0].analysis.notes.map(note => note.duration), rawAgain: durations(dropQA.view.getDrawingScore()) };
  });
  expect(result.raw.length).toBeGreaterThan(0);
  expect(result.staged).toEqual(result.raw.map(duration => duration / 2));
  expect(result.sent).toEqual(result.staged);
  expect(result.rawAgain).toEqual(result.raw);
});

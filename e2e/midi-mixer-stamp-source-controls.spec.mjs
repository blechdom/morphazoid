import { expect, test } from '@playwright/test';

// Source editing owns no audio context. Exercise production score generators,
// MIDI parsing and sparse parameter normalization with an observed engine seam.
// Native engine and audible playback are covered by midi-mixer-parameters.
async function open(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/qa-midi-stamp-source', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/src/instruments/midi-mixer/midi-mixer.css">
    <link rel="stylesheet" href="/src/instruments/midi-mixer/midi-mixer-midi-editor.css">
    <style>body{margin:0;background:#080d10;color:#d5e1df;font-family:sans-serif}.midiphoria-help{font-size:11px}</style></head>
    <body><main class="mixer-shell" id="performance"></main><script type="module">
    import {mountMixerPerformance} from '/src/instruments/midi-mixer/midi-mixer-performance.js';
    import {parseMidi} from '/src/instruments/midi-mixer/midi-mixer-model.js';
    import {sanitizeMidiParameters} from '/src/instruments/midi-mixer/midi-mixer-parameters.js';
    import {generateGridMidi} from '/src/instruments/midiphoria/midiphoria-text-midi.js';
    const state={audioEnabled:false,playing:true,tempo:120,samples:[],sampleMidi:{},decks:[],crossfade:0};
    const qa=globalThis.__stampSource={launches:[],edits:[],actions:[],stops:0,state};
    const engine={get state(){return state},subscribeNotes(){return ()=>{}},
      triggerSample(buffer,options){const sample={id:qa.launches.length+1,...options,analysis:parseMidi(buffer),positionBeats:0,
        midi:sanitizeMidiParameters(options.midi,state.sampleMidi)};state.samples.push(sample);if(state.samples.length>4)state.samples.shift();
        qa.launches.push(sample);return sample},
      configureSamples(patch){qa.edits.push(patch);if(patch.midi!==undefined){state.sampleMidi=sanitizeMidiParameters(patch.midi,state.sampleMidi);
        for(const sample of state.samples)sample.midi=sanitizeMidiParameters(patch.midi,sample.midi)}
        if(patch.gain!==undefined)for(const sample of state.samples)sample.gain=patch.gain},
      sendSampleController(controller,value){qa.actions.push({controller,value});return true},sendSampleParameter(action){qa.actions.push(action);return true},
      stopSamples(){state.samples=[];qa.stops++}};
    const pixels=Array.from({length:32},(_,y)=>Array.from({length:48},(_,x)=>Number(y>3&&y<24&&x===12)));
    const drawing=generateGridMidi(pixels,{secondsPerRow:.125,lowestNote:48});
    qa.view=mountMixerPerformance(document.querySelector('#performance'),{engine,getDrawing:()=>drawing});
    qa.view.setCollection(await fetch('/assets/midiphoria/collection.json').then(response=>response.json()));qa.view.setActive(true);
    </script></body></html>` }));
  await page.goto('/qa-midi-stamp-source'); await expect(page.locator('#mixerStampCount')).toHaveText('58 / 58');
  return errors;
}
const summary = page => page.evaluate(() => {
  const qa = globalThis.__stampSource;
  return { edits: qa.edits, actions: qa.actions, stops: qa.stops, playing: qa.state.playing, midi: qa.state.sampleMidi,
    samples: qa.state.samples.map(sample => ({ id: sample.id, midi: sample.midi, gain: sample.gain })),
    launches: qa.launches.map(sample => ({ name: sample.name, midi: sample.midi, program: sample.program,
      duration: sample.analysis.durationBeats, notes: sample.analysis.notes.map(({ note, beat, duration, velocity, channel }) => ({ note, beat, duration, velocity, channel })) })) };
});
async function launch(page, action) {
  const count = (await summary(page)).launches.length; await action();
  await expect.poll(async () => (await summary(page)).launches.length).toBe(count + 1);
  return (await summary(page)).launches.at(-1);
}
async function sourcePanel(page) { await page.locator('.mixer-stamp-midi > summary').click(); }

test('stamp program selection remembers source families and live edits preserve mixed shot programs', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#mixerSampleProgram option')).toHaveCount(129);
  const first = await launch(page, () => page.locator('[data-mixer-sample="heart"]').click());
  expect(first.program).toBeNull(); expect(first.midi.program).toBe(81);
  await page.locator('#mixerSampleProgram').selectOption('127');
  expect((await summary(page)).samples[0].midi.program).toBe(127);
  const file = await launch(page, () => page.locator('[data-mixer-sample="black-pattern-3-beat-funnel-128"]').click());
  await expect(page.locator('#mixerSampleProgram')).toHaveValue('original'); expect(file.midi.program).toBeUndefined();
  await sourcePanel(page);
  const mix = page.locator('.mixer-stamp-live-midi .midi-edit-group').filter({ has: page.locator('summary', { hasText: /^Mix$/ }) });
  await mix.locator('summary').click();
  await page.getByRole('slider', { name: 'Stamp sound: Voice gain', exact: true }).fill('1.2');
  const mixed = (await summary(page)).samples;
  expect(mixed.map(sample => sample.midi.program)).toEqual([127, undefined]);
  expect(mixed.map(sample => sample.midi.gain)).toEqual([1.2, 1.2]);
  const next = await launch(page, () => page.locator('[data-mixer-sample="square"]').click());
  await expect(page.locator('#mixerSampleProgram')).toHaveValue('127'); expect(next.midi.program).toBe(127);
  await page.locator('#mixerSampleLevel').fill('0.23'); expect((await summary(page)).samples.every(sample => sample.gain === .23)).toBe(true);
  await page.getByRole('button', { name: 'Reset Stamp sound', exact: true }).click();
  expect((await summary(page)).samples.every(sample => Object.keys(sample.midi).length === 0)).toBe(true);
  await expect(page.locator('#mixerSampleProgram')).toHaveValue('81');
  expect((await summary(page)).playing).toBe(true); expect((await summary(page)).stops).toBe(0); expect(errors).toEqual([]);
});

test('stamp source gate, explicit seed and complete source reset change only the next launch', async ({ page }) => {
  const errors = await open(page); await sourcePanel(page);
  const original = await launch(page, () => page.locator('[data-mixer-sample="noise"]').click());
  await page.locator('#mixerStampSeed').fill('942'); await page.locator('#mixerStampGate').fill('0.25');
  const edited = await launch(page, () => page.locator('#mixerStampAgain').click());
  expect(edited.notes).not.toEqual(original.notes); expect(edited.duration).toBe(original.duration);
  await page.locator('#mixerStampGate').fill('1');
  const fullGates = await launch(page, () => page.locator('#mixerStampAgain').click());
  expect(edited.notes.map(({ duration, ...note }) => note)).toEqual(fullGates.notes.map(({ duration, ...note }) => note));
  expect(edited.notes.every((note, index) => Math.abs(note.duration * 4 - fullGates.notes[index].duration) < .002)).toBe(true);
  await page.locator('#mixerStampResetSource').click();
  const reset = await launch(page, () => page.locator('#mixerStampAgain').click()); expect(reset.notes).toEqual(original.notes);
  await expect(page.locator('#mixerStampSeed')).toHaveValue('1'); await expect(page.locator('#mixerStampGate')).toHaveValue('1');
  expect((await summary(page)).edits).toEqual([]); expect((await summary(page)).playing).toBe(true); expect((await summary(page)).stops).toBe(0); expect(errors).toEqual([]);
});

test('file windows, letter messages and drawing geometry expose their source controls', async ({ page }) => {
  const errors = await open(page); await sourcePanel(page);
  await launch(page, () => page.locator('[data-mixer-sample="black-bleed-chasing-wind"]').click());
  await expect(page.locator('#mixerStampSeed')).toBeDisabled(); await expect(page.locator('#mixerStampStart')).toBeDisabled();
  await page.locator('#mixerStampSourceMode').selectOption('manual'); await page.locator('#mixerStampStart').fill('16');
  const cut = await launch(page, () => page.locator('#mixerStampAgain').click()); expect(cut.notes.length).toBeGreaterThan(0);
  await expect(page.locator('#mixerSampleStatus')).toContainText('source beats 16.0–24.0');
  await launch(page, () => page.locator('#mixerStampNextSlice').click()); await expect(page.locator('#mixerStampStart')).toHaveValue('24');
  await page.locator('#mixerStampSourceMode').selectOption('whole');
  await launch(page, () => page.locator('[data-mixer-sample="black-pattern-3-beat-funnel-128"]').click());
  await expect(page.locator('#mixerStampNextSlice')).toBeHidden(); await expect(page.locator('#mixerSampleStatus')).toContainText('whole pattern');
  await page.locator('#mixerSampleMessage').fill('FL');
  const word = await launch(page, () => page.locator('#mixerSendMessage').click());
  await page.locator('#mixerStampTextMode').selectOption('letter');
  const letters = await launch(page, () => page.locator('#mixerSendMessage').click());
  expect(letters.notes.length).toBe(word.notes.length); expect(letters.duration).toBe(word.duration * 2);
  const drawing = await launch(page, () => page.locator('#mixerSendDrawing').click());
  await page.locator('#mixerStampDrawRow').fill('1'); await page.locator('#mixerStampDrawBase').fill('12');
  const moved = await launch(page, () => page.locator('#mixerSendDrawing').click());
  expect(moved.duration).toBe(drawing.duration * 4); expect(moved.notes[0].note).toBe(drawing.notes[0].note - 36);
  expect((await summary(page)).playing).toBe(true); expect((await summary(page)).stops).toBe(0); expect(errors).toEqual([]);
});

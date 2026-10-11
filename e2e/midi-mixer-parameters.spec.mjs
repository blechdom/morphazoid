import { expect, test } from '@playwright/test';

const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page), 'uncaught browser errors').toEqual([]); });

function vlq(value) { const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes; }
function fixture() {
  const events = [{ tick: 0, bytes: [192, 16] }];
  for (let beat = 0; beat < 8; beat++) {
    for (const [cc, value] of [[7, 100], [10, 96], [11, 127], [91, 0], [93, 0], [94, 0]]) events.push({ tick: beat * 480, bytes: [176, cc, value] });
    for (let part = 0; part < 4; part++) events.push({ tick: beat * 480 + part * 120, bytes: [144, 60, 96] }, { tick: beat * 480 + part * 120 + 112, bytes: [128, 60, 0] });
  }
  const track = []; let previous = 0;
  for (const event of events.sort((a, b) => a.tick - b.tick)) { track.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick; }
  track.push(...vlq(8 * 480 - previous), 255, 47, 0); const size = Buffer.alloc(4); size.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224]), Buffer.from('MTrk'), size, Buffer.from(track)]);
}

async function observe(page) {
  await page.addInitScript(() => {
    window.__parameterQA = { engine: null, legacy: null, contexts: [], notes: [] };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); __parameterQA.contexts.push(this); } };
  });
  for (const [file, name, key] of [['midi-mixer/midi-mixer-engine.js', 'MidiMixerEngine', 'engine'], ['midiphoria/midiphoria-player.js', 'MidiphoriaPlayer', 'legacy']]) {
    await page.route(`**/src/instruments/${file}`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}
        const qaVolume=${name}.prototype.setVolume, qaObserved=new WeakSet();
        ${name}.prototype.setVolume=function(...args){
          globalThis.__parameterQA.${key}=this;
          if(this.subscribeNotes&&!qaObserved.has(this)){qaObserved.add(this);this.subscribeNotes(notes=>{
            __parameterQA.notes.push(...notes.map(note=>({...note})));if(__parameterQA.notes.length>10000)__parameterQA.notes.splice(0,__parameterQA.notes.length-10000);
          });}return qaVolume.apply(this,args);
        };` });
    });
  }
}
async function input(page, id, value, event = 'input') {
  await page.locator(`#${id}`).evaluate((node, detail) => { node.value = String(detail.value); node.dispatchEvent(new Event(detail.event, { bubbles: true })); }, { value, event });
}
async function open(page, { mixer = true } = {}) {
  await observe(page); await page.goto('/midiphoria.html'); await expect(page.locator('#songCount')).toHaveText('100 MIDIs');
  if (!mixer) return;
  await page.locator('#mixerModeButton').click(); await expect(page.locator('#tempoFromB')).toBeEnabled();
  await page.locator('#deckFile0').setInputFiles({ name: 'Controller automation.mid', mimeType: 'audio/midi', buffer: fixture() });
  await expect(page.locator('#deckSong0 option:checked')).toHaveText('Controller automation.mid');
  await page.locator('#deckMute1').check(); await input(page, 'mixerCrossfade', -1);
}
async function arm(page) { await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 }); }
function group(host, label) { return host.locator('.midi-edit-group').filter({ has: host.page().locator('summary', { hasText: new RegExp(`^${label}$`) }) }); }
async function expand(host, label) { const target = group(host, label); if (!(await target.evaluate(node => node.open))) await target.locator('summary').click(); return target; }
async function voice(page) {
  const details = page.locator('#deckChannels0 [data-channel="0"] .channel-midi-editor');
  if (!(await details.evaluate(node => node.open))) await details.locator(':scope > summary').click();
  await expect(details.locator('.midi-parameter-editor')).toHaveCount(1); return details;
}
async function cc(host, number) {
  const section = await expand(host, 'All MIDI controllers'); await section.getByRole('searchbox').fill(String(number));
  await section.locator(`.midi-edit-result[data-parameter="${number}"]`).click(); return section;
}
async function generator(host, number) {
  const section = await expand(host, 'SoundFont synthesis'); await section.getByRole('searchbox').fill(String(number));
  await section.locator(`.midi-edit-result[data-parameter="${number}"]`).click(); return section;
}
async function setSelected(section, value) { await section.locator('.midi-edit-selected input[type="range"]').fill(String(value)); }
async function followSelected(section) { await section.locator('.midi-edit-selected .midi-edit-follow').click(); }
async function attachProbe(page) {
  await page.evaluate(() => {
    const engine = __parameterQA.engine, splitter = engine.context.createChannelSplitter(2), left = engine.context.createAnalyser(), right = engine.context.createAnalyser();
    left.fftSize = right.fftSize = 2048; engine._ceiling.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
    __parameterQA.probe = { splitter, left, right };
  });
}
async function measure(page, duration = 300) {
  return page.evaluate(async duration => {
    const { left, right } = __parameterQA.probe, values = new Float32Array(2048); let energyL = 0, energyR = 0, samples = 0, peak = 0, finite = true;
    const end = performance.now() + duration;
    do {
      for (const [analyser, channel] of [[left, 0], [right, 1]]) {
        analyser.getFloatTimeDomainData(values); let energy = 0;
        for (const value of values) { energy += value * value; peak = Math.max(peak, Math.abs(value)); finite &&= Number.isFinite(value); }
        if (channel) energyR += energy; else energyL += energy;
      }
      samples += values.length; await new Promise(resolve => setTimeout(resolve, 30));
    } while (performance.now() < end);
    return { left: Math.sqrt(energyL / samples), right: Math.sqrt(energyR / samples), rms: Math.sqrt((energyL + energyR) / (samples * 2)), peak, finite };
  }, duration);
}
async function sounding(page) {
  await expect.poll(async () => (await measure(page, 90)).rms, { timeout: 8000 }).toBeGreaterThan(.001);
  const result = await measure(page); expect(result.finite).toBe(true); expect(result.peak).toBeLessThanOrEqual(.981); return result;
}

test('voice gain, stereo position and velocity alter native SoundFont output while transport continues', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page); const editor = await voice(page);
  await expand(editor, 'RPN / NRPN & recovery'); await editor.getByRole('button', { name: 'All sound off', exact: true }).click();
  await expect(editor.locator('[role="status"]')).toContainText('Not sent.');
  expect(await page.evaluate(() => __parameterQA.contexts.length)).toBe(0);
  await arm(page); await attachProbe(page); await page.locator('#mixerPlay').click();
  await expand(editor, 'Mix'); const before = await sounding(page);
  const gain = editor.getByRole('slider', { name: 'Deck A channel 1: Voice gain', exact: true });
  await gain.fill('0'); await expect.poll(async () => (await measure(page, 90)).rms).toBeLessThan(.0001);
  await gain.fill('1'); await sounding(page);
  const pan = editor.getByRole('slider', { name: /Deck A channel 1: (Stereo position|Pan offset)$/, exact: false });
  await pan.fill('-1'); await page.waitForTimeout(180); const left = await sounding(page);
  await pan.fill('1'); await page.waitForTimeout(180); const right = await sounding(page);
  // This is an additive pan offset. The file's CC10=96 already leans right;
  // the negative endpoint reverses that balance, rather than claiming a hard
  // left endpoint independent of the source controller/SoundFont pan.
  expect(before.right).toBeGreaterThan(before.left); expect(left.left).toBeGreaterThan(left.right); expect(right.right).toBeGreaterThan(right.left);
  await expand(editor, 'Notes'); const velocity = editor.getByRole('slider', { name: 'Deck A channel 1: Velocity multiplier', exact: true });
  await velocity.fill('0.25'); await page.evaluate(() => { __parameterQA.notes = []; }); await page.waitForTimeout(350);
  const quiet = await sounding(page); const velocities = await page.evaluate(() => __parameterQA.notes.filter(note => note.type === 'noteOn' && note.sourceId === 'deck:0').map(note => note.velocity));
  expect(velocities.length).toBeGreaterThan(0); expect([...new Set(velocities)]).toEqual([24]);
  await velocity.fill('1'); const loud = await sounding(page); expect(loud.rms).toBeGreaterThan(quiet.rms * 1.2);
  expect(await page.evaluate(() => __parameterQA.engine.state.playing)).toBe(true);
  await testInfo.attach('native-voice-parameters', { body: JSON.stringify({ before, left, right, quiet, loud }), contentType: 'application/json' });
});

test('controller and generator overrides survive source automation, seeks and loops, then follow the file again', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page); await arm(page); await attachProbe(page); await page.locator('#mixerPlay').click();
  const editor = await voice(page), controller = await cc(editor, 7); const baseline = await sounding(page);
  await setSelected(controller, 0); await expect.poll(async () => (await measure(page, 100)).rms).toBeLessThan(.0001);
  await input(page, 'deckLoopStart0', 0, 'change'); await input(page, 'deckLoopEnd0', 2, 'change'); await input(page, 'deckScrub0', 1, 'change');
  await page.waitForTimeout(1300); expect((await measure(page)).rms).toBeLessThan(.0001);
  expect(await page.evaluate(() => __parameterQA.engine.state.decks[0].channels[0].midi.controllers[7])).toBe(0);
  await followSelected(controller); const restoredVolume = await sounding(page);
  // TimGM's organ patch opens its filter with a +4950-cent modulation envelope.
  // Isolate the exposed base cutoff from that real, independently editable
  // envelope and LFO contribution before comparing its audio consequence.
  await setSelected(await generator(editor, 11), 0); await setSelected(await generator(editor, 10), 0);
  const filter = await generator(editor, 8); await setSelected(filter, 1500); await page.waitForTimeout(350); const dark = await measure(page);
  expect(dark.rms).toBeLessThan(restoredVolume.rms * .35);
  await input(page, 'deckScrub0', 0, 'change'); await page.waitForTimeout(1100); expect((await measure(page)).rms).toBeLessThan(restoredVolume.rms * .35);
  await followSelected(filter); const restoredFilter = await sounding(page);
  expect(restoredFilter.rms).toBeGreaterThan(dark.rms * 2); expect(await page.evaluate(() => __parameterQA.engine.state.playing)).toBe(true);
  await testInfo.attach('native-controller-follow', { body: JSON.stringify({ baseline, restoredVolume, dark, restoredFilter }), contentType: 'application/json' });
});

test('live stamp MIDI changes affect active notes while deck, voice and effect presets restore deeply', async ({ page }, testInfo) => {
  test.setTimeout(60000); await open(page); await arm(page); await attachProbe(page); await input(page, 'mixerStampBeats', 32);
  await page.evaluate(() => __parameterQA.engine.configureSamples({ midi: { controllers: { 91: 0, 93: 0, 94: 0 } } }));
  await page.locator('[data-mixer-sample="heart"]').click(); await sounding(page);
  const detail = page.locator('.mixer-stamp-midi'); await detail.locator(':scope > summary').click(); const editor = detail.locator('.midi-parameter-editor');
  await expand(editor, 'Mix'); const gain = editor.getByRole('slider', { name: /Voice gain$/, exact: false });
  await gain.fill('0'); await expect.poll(async () => (await measure(page, 90)).rms).toBeLessThan(.0001);
  await gain.fill('0.4'); const live = await sounding(page);
  const sampleId = await page.evaluate(() => __parameterQA.engine.state.samples[0]?.id); expect(sampleId).toBeTruthy();
  await expand(editor, 'Pitch'); await editor.getByRole('slider', { name: /Voice pitch$/, exact: false }).fill('7');
  const saved = await page.evaluate(async () => {
    const { captureMixerPreset, applyMixerPreset } = await import('/src/instruments/midi-mixer/midi-mixer-presets.js');
    const engine = __parameterQA.engine; engine.configureDeck(0, { midi: { fineTune: 31, controllers: { 74: 42 }, generators: { 34: -3600 } } });
    engine.configureChannel(0, 0, { midi: { pan: -.4, pressure: 59 } }); engine.configureEffects({ synth: { 'reverb.level': 37 } });
    const snapshot = captureMixerPreset(engine.state), before = { playing: engine.state.playing, audio: engine.state.audioEnabled, sampleMidi: engine.state.sampleMidi };
    engine.configureDeck(0, { midi: null }); engine.configureChannel(0, 0, { midi: null }); engine.configureEffects({ synth: null });
    applyMixerPreset(engine, snapshot); return { snapshot, after: captureMixerPreset(engine.state), before, playing: engine.state.playing, audio: engine.state.audioEnabled, sampleMidi: engine.state.sampleMidi };
  });
  expect(saved.after).toEqual(saved.snapshot); expect(saved.audio).toBe(saved.before.audio); expect(saved.playing).toBe(saved.before.playing);
  expect(saved.sampleMidi).toEqual(saved.before.sampleMidi);
  expect(await page.evaluate(id => __parameterQA.engine.state.samples.some(sample => sample.id === id), sampleId)).toBe(true);
  await page.locator('#mixerStopSamples').click(); await expect.poll(async () => (await measure(page, 90)).rms).toBeLessThan(.0001);
  await testInfo.attach('native-live-stamp', { body: JSON.stringify({ live, snapshot: saved.snapshot }), contentType: 'application/json' });
});

for (const generated of [false, true]) {
  test(`${generated ? 'Generated letters' : 'Library MIDI'} enters the MIDI editor with Audio and playback preserved`, async ({ page }) => {
    test.setTimeout(60000); await open(page, { mixer: false });
    if (generated) { await page.locator('#textMidiInput').fill('TWEAK ME'); await page.locator('#generateTextMidi').click(); }
    else await page.locator('#songList [data-song-id="rock-theme-four"]').click();
    await page.locator('#loopSong').check(); await arm(page); await page.locator('#playButton').click();
    await expect.poll(() => page.evaluate(() => __parameterQA.legacy.state.time)).toBeGreaterThan(.2);
    const source = await page.evaluate(() => Array.from(new Uint8Array(__parameterQA.legacy._file.buffer)));
    await page.locator('#editMidiButton').click(); await expect(page.locator('#mixerModeButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#mixerPlay')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#deckMidi0 .midi-parameter-editor')).toHaveCount(1); await expect(page.locator('#deckSong0')).toHaveValue('editable');
    expect(await page.evaluate(() => __parameterQA.engine.state.decks[0].config.loop)).toBe(true);
    await attachProbe(page); await sounding(page);
    await page.locator('#deckOriginal0').click(); await expect(page.locator('#visualModeButton')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => Array.from(new Uint8Array(__parameterQA.legacy._file.buffer)))).toEqual(source);
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`expanded deck, voice and stamp editors fit at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const coarse = viewport.width !== 1440, page = await browser.newPage({ viewport, hasTouch: coarse, isMobile: coarse });
    const childErrors = []; page.on('pageerror', error => childErrors.push(error.message));
    try {
      await open(page); const editor = await voice(page); await expand(editor, 'Mix'); await expand(editor, 'Expression & pedals'); await cc(editor, 74);
      await page.locator('[data-deck="0"] .deck-midi-editor > summary').click(); const deck = page.locator('#deckMidi0'); await expand(deck, 'Instrument');
      await page.locator('.mixer-stamp-midi > summary').click(); const sample = page.locator('.mixer-stamp-midi .midi-parameter-editor'); await expand(sample, 'Pitch'); await generator(sample, 34);
      const input = sample.getByRole('slider', { name: /Fine tuning$/, exact: false }); await input.focus();
      await page.evaluate(() => { for (let index = 0; index < 20; index++) __parameterQA.engine.configureSamples({ midi: { fineTune: index } }); }); await expect(input).toBeFocused();
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth,
        narrow: [...document.querySelectorAll('.midi-parameter-editor button,.midi-parameter-editor summary,.midi-parameter-editor select,.midi-parameter-editor input')]
          .filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none')
          .map(node => ({ name: node.getAttribute('aria-label') || node.textContent, rect: node.getBoundingClientRect().toJSON() })).filter(item => item.rect.height < 47.9),
        overflow: [...document.querySelectorAll('.midi-parameter-editor,.deck-midi-editor,.channel-midi-editor,.mixer-stamp-midi')].filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth + 2).map(node => node.className) }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport); expect(dimensions.overflow).toEqual([]); if (coarse) expect(dimensions.narrow).toEqual([]);
      expect(await page.evaluate(() => __parameterQA.contexts.length)).toBe(0);
      expect(childErrors).toEqual([]);
    } finally { await page.close(); }
  });
}

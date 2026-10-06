import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { L_SYSTEM_TYPES, RUST_EXPLORATION_TYPES } from '../src/instruments/micmic/native/model.js';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const BANK = '/src/instruments/micmic/native/presets.json';
const bank = JSON.parse(await readFile(new URL('../src/instruments/micmic/native/presets.json', import.meta.url), 'utf8'));
const ORIGINAL_IDS = ['pythagorean', 'bramble', 'venus', 'ivy', 'binary', 'coral', 'moss', 'plant', 'kelp', 'dragon',
  'koch', 'clean', 'orchid', 'willow', 'mangrove', 'sequoia', 'cedar', 'aspen', 'juniper', 'baobab',
  'foxglove', 'lotus', 'acacia', 'lichen', 'moonflower', 'horsetail'];
const GAINS = { inputGain: 1.31, level: .37, makeupDb: 9 };

function wav() {
  const rate = 48000, frames = rate * 3, bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(Math.sin(frame / rate * Math.PI * 2 * 173) * .03 * 32767), 44 + frame * 2);
  }
  return bytes;
}

async function fixture(page) {
  const errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    const qa = window.__expandedPresetQa = { microphoneRequests: 0, streams: [], monitors: [],
      sources: [], worklets: 0, hidden: false };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => qa.hidden });
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-l-system-delay') {
        qa.worklets++;
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 2048; mute.gain.value = 0;
        node.connect(analyser).connect(mute).connect(node.context.destination);
        qa.monitors.push({ analyser, samples: new Float32Array(analyser.fftSize) });
      }
      return node;
    } });
    const createBufferSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const source = createBufferSource.apply(this, args), record = { started: 0, stopped: 0 };
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...values) => { record.started++; return start(...values); };
      source.stop = (...values) => { record.stopped++; return stop(...values); };
      qa.sources.push(record); return source;
    };
    navigator.mediaDevices.getUserMedia = async () => {
      qa.microphoneRequests++;
      const context = new AudioContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 173; gain.gain.value = .03;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      qa.streams.push(destination.stream);
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { if (track.readyState !== 'ended') { oscillator.stop(); void context.close(); } stop(); };
      }
      return destination.stream;
    };
  });
  return { errors, consoleErrors };
}

async function diagnostics(page) {
  return page.evaluate(async module => {
    const d = (await import(module)).getBrowserDelayEngine().getDiagnostics(), qa = __expandedPresetQa;
    const monitor = qa.monitors.at(-1);
    let pcmPeak = 0, pcmNonFinite = 0;
    if (d.connectionCount && monitor) {
      monitor.analyser.getFloatTimeDomainData(monitor.samples);
      for (const sample of monitor.samples) {
        if (Number.isFinite(sample)) pcmPeak = Math.max(pcmPeak, Math.abs(sample));
        else pcmNonFinite++;
      }
    }
    return { ...d, pcmPeak, pcmNonFinite, microphoneRequests: qa.microphoneRequests, worklets: qa.worklets,
      liveTracks: qa.streams.flatMap(stream => stream.getTracks()).filter(track => track.readyState !== 'ended').length,
      sourceStarts: qa.sources.reduce((total, source) => total + source.started, 0) };
  }, ENGINE);
}

async function ready(page) {
  expect(bank).toHaveLength(186);
  expect(bank.slice(0, ORIGINAL_IDS.length).map(preset => preset.id)).toEqual(ORIGINAL_IDS);
  await page.goto('/l-mic-rust.html?renderer=canvas');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('button[data-full-preset]')).toHaveCount(bank.length);
  const response = await page.request.get(BANK);
  expect(response.ok()).toBe(true); expect(await response.json()).toEqual(bank);
}

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function setGains(page) {
  for (const [id, value] of [['inputTrim', GAINS.inputGain], ['level', GAINS.level], ['makeupDb', GAINS.makeupDb]]) {
    await range(page, id, value);
  }
  await expect.poll(async () => liveGains(await diagnostics(page))).toEqual(GAINS);
}
const liveGains = d => ({ inputGain: d.performance.inputGain, level: d.performance.level,
  makeupDb: d.performance.mastering.makeupDb });

async function chooseInput(page, id, value) {
  const index = await page.locator(`#${id}`).evaluate((select, value) =>
    [...select.options].findIndex(option => option.value === value), value);
  expect(index).toBeGreaterThanOrEqual(0);
  const picker = page.locator(`[data-select-id="${id}"]`);
  if (await picker.getAttribute('open') === null) await picker.locator('summary').click();
  await picker.locator(`button[data-option-index="${index}"]`).click();
  await expect.poll(async () => (await diagnostics(page)).input[id === 'source' ? 'mode' : 'sampleId']).toBe(value);
}
const inputMode = (page, mode) => chooseInput(page, 'source', mode);

async function prepareFile(page) {
  await inputMode(page, 'file');
  await page.locator('#inputFile').setInputFiles({ name: 'bank-continuity.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.input.hasFile && !d.input.pending;
  }, { timeout: 15000 }).toBe(true);
}

async function choosePreset(page, preset) {
  const picker = page.locator('.instrument-preset-controls');
  if (await picker.locator('details').getAttribute('open') === null) await picker.locator('summary').click();
  await page.locator(`button[data-full-preset][data-preset-id="${preset.id}"]`).click();
  await expect(picker).toHaveAttribute('data-preset-id', preset.id, { timeout: 30000 });
  await expect(picker).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#generations')).toBeEnabled();
  const capture = await page.evaluate(async () => {
    const engine = (await import('/src/instruments/micmic/native/browser-engine.js')).getBrowserDelayEngine();
    const { captureScene } = await import('/src/instruments/micmic/native/model.js'), d = engine.getDiagnostics();
    return captureScene(d.parameters, d.performance);
  });
  expect(capture).toEqual(preset.snapshot);
  return diagnostics(page);
}

test(`all ${bank.length} UI recalls preserve Mic/File/Samples sessions and live gains without arming Audio`, async ({ page }) => {
  test.setTimeout(300000);
  const evidence = await fixture(page); await ready(page); await setGains(page); await prepareFile(page);
  await inputMode(page, 'samples'); await chooseInput(page, 'inputSample', 'music-keys');
  const rows = [];
  for (const [index, preset] of bank.entries()) {
    const mode = ['mic', 'file', 'samples'][index % 3]; await inputMode(page, mode);
    const before = await diagnostics(page), recalled = await choosePreset(page, preset);
    expect(recalled.audio).toBe(false); expect(recalled.audioDesired).toBe(false);
    expect(recalled.microphoneRequests).toBe(0); expect(recalled.liveTracks).toBe(0); expect(recalled.sourceStarts).toBe(0);
    expect(recalled.input).toMatchObject({ mode, sampleId: 'music-keys', hasFile: true, pending: false, playing: false, loop: true });
    expect(recalled.input.fileName).toBe(before.input.fileName); expect(liveGains(recalled)).toEqual(GAINS);
    expect(recalled.contextGeneration).toBe(before.contextGeneration); expect(recalled.error).toBeFalsy();
    rows.push({ id: preset.id, mode, generations: recalled.parameters.generations, requestedVoices: recalled.requestedVoices });
  }
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await test.info().attach('expanded-bank-audio-off-recalls', { body: JSON.stringify({ rows, total: rows.length,
    sourceModes: ['mic', 'file', 'samples'], gains: GAINS, actualWasm: true, humanListening: false }, null, 2), contentType: 'application/json' });
});

function representatives() {
  const added = bank.slice(ORIGINAL_IDS.length), chosen = new Map();
  const add = preset => { if (preset) chosen.set(preset.id, preset); };
  for (const grammar of new Set(added.map(preset => preset.snapshot.parameters.lSystemType))) {
    add(added.find(preset => preset.snapshot.parameters.lSystemType === grammar));
  }
  for (const [key, direction] of [['intervalMs', 1], ['intervalMs', -1], ['generations', -1]]) {
    add([...added].sort((a, b) => direction * (a.snapshot.parameters[key] - b.snapshot.parameters[key]))[0]);
  }
  return [...chosen.values()];
}

async function finiteLive(page, previousClock) {
  await expect.poll(async () => {
    const d = await diagnostics(page), s = d.status;
    return d.audio && d.input.playing && d.contextState === 'running' && d.connectionCount === 1
      && s.topologyRevision === d.topologyRevision && s.elapsedSeconds > previousClock
      && s.inputPeak > 1e-7 && d.pcmPeak > 1e-7 && d.pcmNonFinite === 0;
  }, { timeout: 20000 }).toBe(true);
  const d = await diagnostics(page);
  expect(d.pcmPeak).toBeLessThanOrEqual(1); expect(d.pcmNonFinite).toBe(0); expect(d.error).toBeFalsy();
  expect(d.status.outputPeak).toBeGreaterThan(0); expect(d.status.outputPeak).toBeLessThanOrEqual(1);
  expect(d.status.voiceLimit).toBeLessThanOrEqual(d.eligibleVoices);
  expect(d.status.tapActivity.every(Number.isFinite)).toBe(true);
  expect(liveGains(d)).toEqual(GAINS);
  return d;
}

test('stratified new presets and a linear-to-Pine switchback retain real Rust audio and one input graph', async ({ page }) => {
  test.setTimeout(240000);
  const evidence = await fixture(page); await ready(page); await prepareFile(page); await setGains(page);
  const selected = representatives();
  expect(selected.length).toBeGreaterThanOrEqual(L_SYSTEM_TYPES.length); expect(selected.length).toBeLessThanOrEqual(L_SYSTEM_TYPES.length + 3);
  expect(new Set(selected.map(preset => preset.snapshot.parameters.lSystemType))).toEqual(new Set(L_SYSTEM_TYPES));
  await inputMode(page, 'mic'); await choosePreset(page, selected[0]);
  await page.locator('#audioButton').click();
  const initial = await finiteLive(page, -1), rows = [];
  let clock = initial.status.elapsedSeconds;
  for (const [index, preset] of selected.entries()) {
    const mode = index < 5 ? 'mic' : index < 10 ? 'samples' : 'file';
    if ((await diagnostics(page)).input.mode !== mode) {
      await inputMode(page, mode);
      clock = (await finiteLive(page, clock)).status.elapsedSeconds;
    }
    const before = await diagnostics(page); await choosePreset(page, preset);
    const d = await finiteLive(page, clock); clock = d.status.elapsedSeconds;
    expect(d.input.mode).toBe(mode); expect(d.contextGeneration).toBe(initial.contextGeneration); expect(d.worklets).toBe(1);
    expect(d.microphoneRequests).toBe(before.microphoneRequests); expect(d.sourceStarts).toBe(before.sourceStarts);
    rows.push({ id: preset.id, mode, parameters: d.parameters, eligibleVoices: d.eligibleVoices,
      admittedVoices: d.status.voiceLimit, inputPeak: d.status.inputPeak, outputPeak: d.status.outputPeak,
      pcmPeak: d.pcmPeak, sampleClock: clock });
  }
  const linear = selected.find(preset => ['dragon', 'koch', 'hilbert', 'gosper'].includes(preset.snapshot.parameters.lSystemType));
  await choosePreset(page, linear); clock = (await finiteLive(page, clock)).status.elapsedSeconds;
  await choosePreset(page, bank[0]);
  const pine = await finiteLive(page, clock);
  expect(pine.parameters.lSystemType).toBe('pythagorean'); expect(pine.worklets).toBe(1);
  expect(pine.contextGeneration).toBe(initial.contextGeneration);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page); return !d.audio && !d.input.playing && d.liveTracks === 0;
  }).toBe(true);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await test.info().attach('stratified-expanded-bank-pcm', { body: JSON.stringify({ rows,
    switchback: [linear.id, bank[0].id], actualWasm: true, sourceFixture: 'synthetic mic, bundled drums, uploaded WAV',
    humanListening: false, physicalMicrophone: false }, null, 2), contentType: 'application/json' });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`expanded preset menu ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440, isMobile: viewport.width !== 1440 });
    test('all entries are searchable and first/middle/last choices remain reachable', async ({ page }) => {
      const evidence = await fixture(page); await ready(page);
      const picker = page.locator('.instrument-preset-controls'), search = picker.locator('input[type="search"]');
      await picker.locator('summary').scrollIntoViewIfNeeded(); await picker.locator('summary').click();
      for (const [query, expectedGrammars] of [
        ['Cathedral', L_SYSTEM_TYPES.filter(type => !RUST_EXPLORATION_TYPES.includes(type))],
        ['Glass Curl', RUST_EXPLORATION_TYPES],
      ]) {
        const matching = bank.filter(preset => `${preset.label} ${preset.description}`.toLowerCase().includes(query.toLowerCase()));
        expect(new Set(matching.map(preset => preset.snapshot.parameters.lSystemType))).toEqual(new Set(expectedGrammars));
        await search.fill(query);
        const results = picker.locator('.instrument-picker-row:not([hidden]) button[data-full-preset]');
        await expect(results).toHaveCount(matching.length);
        expect(await results.evaluateAll(buttons => buttons.map(button => button.dataset.presetId)))
          .toEqual(matching.map(preset => preset.id));
        for (const preset of matching) await expect(picker.locator(`button[data-preset-id="${preset.id}"]`)).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`preset-family-${query.toLowerCase().replaceAll(' ', '-')}.png`) });
      }
      await search.fill(''); await picker.locator('summary').click();
      for (const preset of [bank[0], bank[Math.floor(bank.length / 2)], bank.at(-1)]) {
        await picker.locator('summary').scrollIntoViewIfNeeded(); await picker.locator('summary').click();
        if (viewport.width !== 1440) expect((await picker.locator('summary').boundingBox()).height).toBeGreaterThanOrEqual(48);
        await search.fill('no-such-l-system-preset');
        await expect(picker.locator('.instrument-picker-empty')).toBeVisible();
        await search.fill(preset.label);
        const choice = page.locator(`button[data-full-preset][data-preset-id="${preset.id}"]`);
        await choice.scrollIntoViewIfNeeded(); await expect(choice).toBeVisible();
        const box = await choice.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.y).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
        await page.screenshot({ path: test.info().outputPath(`preset-search-${preset.id}.png`) });
        await choosePreset(page, preset);
      }
      expect((await diagnostics(page)).audio).toBe(false); expect((await diagnostics(page)).microphoneRequests).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
    });
  });
}

import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';
const ORIGINAL_IDS = ['sample-drums', 'music-bass', 'music-keys', 'music-plucks', 'music-arp',
  'voice-bdl', 'voice-slt', 'speech', 'birdsong'];
const NEW_IDS = ['music-clockwork-chamber', 'music-rockabilly-drive', 'music-country-front-porch',
  'music-neon-synth-pop', 'music-unicorn-sparkles', 'music-jazz-night-walk', 'music-dub-skank',
  'music-disco-strut', 'music-chiptune-quest', 'music-cloud-choir', 'music-acid-circuit', 'music-bossa-sunrise',
  'nature-coyote-howl', 'nature-frog-chorus', 'nature-humpback-song', 'nature-cricket-night',
  'fx-sad-trombone', 'fx-record-scratch', 'fx-air-horn', 'fx-rimshot', 'fx-applause', 'fx-slide-whistle',
  'music-tabla', 'music-toy-gamelan'];
const TRANSPARENT = { inputHighpassHz: 0, highpassHz: 0, lowpassHz: 0,
  compressorEnabled: false, autoMakeup: false, makeupDb: 6 };
const gains = d => [d.performance.inputGain, d.performance.level, d.performance.mastering.makeupDb];

async function fixture(page) {
  const errors = [], consoleErrors = [], responses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => {
    if (/\/assets\/.*\.(wav|ogg|mp3)(?:\?|$)/.test(response.url())) responses.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript(() => {
    const qa = window.__expandedSamplesQa = { sources: [], monitors: [], nodes: [], microphoneRequests: 0,
      realtimeDecodes: 0, auditDecodes: 0, holdNextDecode: false, pendingDecodes: [] };
    const NativeNode = AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-l-system-delay') {
        const analyser = node.context.createAnalyser(), mute = node.context.createGain();
        analyser.fftSize = 4096; mute.gain.value = 0;
        node.connect(analyser).connect(mute).connect(node.context.destination);
        qa.nodes.push(node); qa.monitors.push({ analyser, samples: new Float32Array(analyser.fftSize) });
      }
      return node;
    } });
    const createSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const node = createSource.apply(this, args), record = { node, started: 0, stopped: 0, disconnected: 0,
        ended: false, startedAt: null };
      const start = node.start.bind(node), stop = node.stop.bind(node), disconnect = node.disconnect.bind(node);
      node.start = (...values) => { const result = start(...values); record.started++; record.startedAt = this.currentTime; return result; };
      node.stop = (...values) => { record.stopped++; return stop(...values); };
      node.disconnect = (...values) => { record.disconnected++; return disconnect(...values); };
      node.addEventListener('ended', () => { record.ended = true; });
      qa.sources.push(record); return node;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (...args) {
      const audit = this instanceof OfflineAudioContext, buffer = await decode.apply(this, args);
      if (audit) qa.auditDecodes++; else qa.realtimeDecodes++;
      if (!audit && qa.holdNextDecode) {
        qa.holdNextDecode = false;
        await new Promise(resolve => qa.pendingDecodes.push(resolve));
      }
      return buffer;
    };
    navigator.mediaDevices.getUserMedia = async () => {
      qa.microphoneRequests++;
      throw new DOMException('This sample audition must not request a microphone.', 'NotAllowedError');
    };
  });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch(), source = await response.text();
    // Existing full-scene application keeps UI/worker/DSP aligned. The real
    // loader, assets, decoding, source nodes and Rust worklet are unchanged.
    await route.fulfill({ response, body: source + '\n__expandedSamplesQa.applyScene = applyScene;\n' });
  });
  return { errors, consoleErrors, responses };
}

async function diagnostics(page) {
  return page.evaluate(async path => {
    const d = (await import(path)).getBrowserDelayEngine().getDiagnostics(), qa = __expandedSamplesQa;
    const monitor = qa.monitors.at(-1); let peak = 0, square = 0, nonFinite = 0;
    if (monitor && d.connectionCount) {
      monitor.analyser.getFloatTimeDomainData(monitor.samples);
      for (const sample of monitor.samples) {
        if (!Number.isFinite(sample)) nonFinite++;
        else { peak = Math.max(peak, Math.abs(sample)); square += sample * sample; }
      }
    }
    return { ...d, contextTime: monitor?.analyser.context.currentTime ?? 0, worklets: qa.nodes.length, pcm: { peak, rms: Math.sqrt(square / (monitor?.samples.length || 1)), nonFinite },
      realtimeDecodes: qa.realtimeDecodes, auditDecodes: qa.auditDecodes, microphoneRequests: qa.microphoneRequests,
      sources: qa.sources.map(s => ({ started: s.started, stopped: s.stopped, disconnected: s.disconnected,
        ended: s.ended, startedAt: s.startedAt, bufferReleased: s.node.buffer === null, loop: s.node.loop })) };
  }, ENGINE);
}

async function ready(page) {
  await page.goto('/l-mic-rust.html?renderer=canvas');
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
  await expect.poll(async () => (await diagnostics(page)).audio).toBe(false);
  await page.evaluate(async mastering => {
    const d = (await import('/src/instruments/micmic/native/browser-engine.js')).getBrowserDelayEngine().getDiagnostics();
    await __expandedSamplesQa.applyScene({ parameters: { ...d.parameters, generations: 1, intervalMs: 80,
      timeRatio: .82, depth: .84, pitchScale: .35 }, performance: { ...d.performance, inputGain: 1.11,
      level: .37, wet: .65, dry: .4, mastering: { ...d.performance.mastering, ...mastering } } });
  }, TRANSPARENT);
  // Full scenes preserve live gains. Set deliberately nondefault values through
  // their native controls so preservation checks cannot pass on default resets.
  for (const [id, value] of [['inputTrim', 1.11], ['level', .37], ['makeupDb', 6]]) {
    await page.locator(`#${id}`).evaluate((input, value) => {
      input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }
  await expect.poll(async () => gains(await diagnostics(page))).toEqual([1.11, .37, 6]);
  await choose(page, 'source', 'samples');
}

async function choose(page, id, value) {
  const index = await page.locator(`#${id}`).evaluate((select, value) =>
    [...select.options].findIndex(option => option.value === value), value);
  expect(index).toBeGreaterThanOrEqual(0);
  const menu = page.locator(`[data-select-id="${id}"]`);
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await menu.locator(`button[data-option-index="${index}"]`).click();
  await expect(page.locator(`#${id}`)).toHaveValue(value);
  await expect.poll(async () => (await diagnostics(page)).input[id === 'source' ? 'mode' : 'sampleId']).toBe(value);
}

async function options(page) {
  const declaredExtras = await page.evaluate(async () =>
    (await import('/src/instruments/synthesis/extra-demo-sources.js')).EXTRA_DEMO_SOURCES
      .map(({ id, label, group }) => ({ id, label, group })));
  expect(declaredExtras).toHaveLength(24);
  expect(declaredExtras.map(option => option.id).sort()).toEqual([...NEW_IDS].sort());
  const options = await page.locator('#inputSample').evaluate(select =>
    [...select.options].map(option => ({ id: option.value, label: option.textContent, group: option.closest('optgroup')?.label })));
  expect(options).toHaveLength(34);
  expect(options.slice(0, ORIGINAL_IDS.length).map(option => option.id)).toEqual(ORIGINAL_IDS);
  expect(new Set(options.map(option => option.id)).size).toBe(options.length);
  expect(options.map(option => option.id)).toEqual(expect.arrayContaining(NEW_IDS));
  expect(options.map(option => option.id)).toContain('speech-curling');
  for (const declared of declaredExtras) expect(options.find(option => option.id === declared.id)).toEqual(declared);
  return options;
}

async function live(page, id, previousClock = -1) {
  await expect.poll(async () => {
    const d = await diagnostics(page), active = d.sources.filter(source => source.started && !source.stopped && !source.ended);
    return d.audio && d.contextState === 'running' && d.connectionCount === 1
      && d.input.mode === 'samples' && d.input.sampleId === id && d.input.playing && !d.input.pending
      && active.length === 1 && d.status.elapsedSeconds > previousClock
      && d.contextTime > active[0].startedAt + .15 && d.status.inputPeak > 1e-5
      && d.pcm.nonFinite === 0 && d.pcm.peak > 1e-5 && Math.max(0, ...d.status.tapActivity) > 1e-5;
  }, { timeout: 20000 }).toBe(true);
  const d = await diagnostics(page);
  expect(d.pcm.nonFinite).toBe(0); expect(d.pcm.peak).toBeLessThanOrEqual(1);
  expect(d.status.outputPeak).toBeLessThanOrEqual(1);
  expect(d.microphoneRequests).toBe(0); expect(d.error).toBeFalsy();
  return d;
}

async function observePcm(page) {
  return page.evaluate(async () => {
    const monitor = __expandedSamplesQa.monitors.at(-1), started = performance.now();
    let peak = 0, square = 0, nonFinite = 0, frames = 0;
    do {
      await new Promise(resolve => requestAnimationFrame(resolve));
      monitor.analyser.getFloatTimeDomainData(monitor.samples);
      for (const sample of monitor.samples) {
        if (!Number.isFinite(sample)) nonFinite++;
        else { peak = Math.max(peak, Math.abs(sample)); square += sample * sample; }
      }
      frames++;
    } while (performance.now() - started < 250);
    return { peak, rms: Math.sqrt(square / (frames * monitor.samples.length)), nonFinite, frames,
      durationMs: performance.now() - started, capture: 'actual analyser windows' };
  });
}

async function off(page) {
  if ((await diagnostics(page)).audio) await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return !d.audio && !d.audioDesired && !d.input.playing && !d.input.pending
      && d.sources.every(source => !source.started || source.stopped || source.ended);
  }, { timeout: 15000 }).toBe(true);
  expect((await diagnostics(page)).sources.filter(source => source.started).every(source => source.bufferReleased)).toBe(true);
}

async function cleanup(page) {
  await off(page);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.disposed && ['closed', 'absent'].includes(d.contextState) && d.connectionCount === 0;
  }).toBe(true);
}

async function save(name, value) {
  const path = test.info().outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(value));
  await test.info().attach(name, { path, contentType: 'application/json' });
}

test('all expanded demo choices stay silent while Audio is off and actual prepared recordings are finite and bounded', async ({ page }) => {
  test.setTimeout(180000);
  const evidence = await fixture(page); await ready(page);
  const menu = await options(page), before = await diagnostics(page), selections = [];
  for (const option of menu) {
    await choose(page, 'inputSample', option.id);
    const d = await diagnostics(page);
    expect(d.audio).toBe(false); expect(d.input.playing).toBe(false); expect(d.input.pending).toBe(false);
    expect(gains(d)).toEqual(gains(before)); expect(d.microphoneRequests).toBe(0);
    expect(d.realtimeDecodes).toBe(before.realtimeDecodes);
    expect(d.sources.every(source => source.started === 0)).toBe(true);
    selections.push({ id: option.id, audio: d.audio, playing: d.input.playing });
  }
  const recordings = await page.evaluate(async menu => {
    // This separate offline audit invokes the real shared loader; product
    // selection intentionally defers decoding until Audio is explicitly on.
    const { loadProcessingDemo } = await import('/src/instruments/synthesis/demo-sources.js');
    const context = new OfflineAudioContext(2, 128, 48000), results = [];
    for (const option of menu) {
      const result = await loadProcessingDemo(context, option.id), b = result.buffer;
      let peak = 0, square = 0, nonFinite = 0;
      for (let channel = 0; channel < b.numberOfChannels; channel++) for (const sample of b.getChannelData(channel)) {
        if (!Number.isFinite(sample)) nonFinite++;
        else { peak = Math.max(peak, Math.abs(sample)); square += sample * sample; }
      }
      results.push({ ...option, sampleRate: b.sampleRate, channels: b.numberOfChannels,
        frames: b.length, duration: b.duration, peak, rms: Math.sqrt(square / (b.length * b.numberOfChannels)),
        nonFinite, credit: result.credit, creditUrl: result.creditUrl });
    }
    return results;
  }, menu);
  for (const recording of recordings) {
    expect(recording.nonFinite, recording.id).toBe(0); expect(recording.peak, recording.id).toBeGreaterThan(1e-5);
    // The existing shared loader explicitly balances to a 0.82 peak ceiling.
    expect(recording.peak, recording.id).toBeLessThanOrEqual(.820001);
    expect(recording.rms, recording.id).toBeGreaterThan(1e-5);
    expect(recording.duration, recording.id).toBeGreaterThan(0); expect(recording.duration, recording.id).toBeLessThanOrEqual(30.35);
    expect(recording.credit, recording.id).toBeTruthy(); expect((await page.request.get(recording.creditUrl)).status(), recording.id).toBe(200);
  }
  const after = await diagnostics(page);
  expect(after.audio).toBe(false); expect(after.input.playing).toBe(false);
  expect(after.realtimeDecodes).toBe(before.realtimeDecodes); expect(after.auditDecodes).toBeGreaterThanOrEqual(menu.length);
  expect(after.sources.every(source => source.started === 0)).toBe(true);
  expect(evidence.responses.every(response => response.status === 200)).toBe(true);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await save('expanded-samples-off-and-decoded', { menu, selections, recordings, before, after,
    responses: evidence.responses, actualBundledRecordings: true, offlineLoaderAudit: true, listeningPerformed: false });
  await cleanup(page);
});

test('all 34 bundled samples produce finite real Rust activity without changing live gains or duplicating sources', async ({ page }) => {
  test.setTimeout(240000);
  const evidence = await fixture(page); await ready(page);
  const menu = await options(page), before = await diagnostics(page), auditions = [];
  await page.locator('#audioButton').click();
  let previousClock = -1, generation;
  for (const option of menu) {
    await choose(page, 'inputSample', option.id);
    const d = await live(page, option.id, previousClock); previousClock = d.status.elapsedSeconds;
    generation ??= d.contextGeneration;
    expect(d.contextGeneration).toBe(generation); expect(d.worklets).toBe(1);
    expect(gains(d)).toEqual(gains(before)); expect(d.input.credit).toBeTruthy();
    await expect(page.locator('#inputSourceCredit a')).toHaveAttribute('href', d.input.creditUrl);
    expect(d.sources.filter(source => source.stopped || source.ended).every(source => source.bufferReleased)).toBe(true);
    const pcm = await observePcm(page);
    expect(pcm.nonFinite, option.id).toBe(0); expect(pcm.peak, option.id).toBeGreaterThan(1e-5);
    expect(pcm.peak, option.id).toBeLessThanOrEqual(1);
    auditions.push({ ...option, sampleRate: d.status.sampleRate, elapsedSeconds: d.status.elapsedSeconds,
      pcm, inputPeak: d.status.inputPeak, outputPeak: d.status.outputPeak,
      tapPeak: Math.max(0, ...d.status.tapActivity), credit: d.input.credit, creditUrl: d.input.creditUrl });
  }
  const final = await diagnostics(page); await cleanup(page);
  expect(evidence.responses.length).toBeGreaterThanOrEqual(menu.length);
  expect(evidence.responses.every(response => response.status === 200)).toBe(true);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  const wasmBuild = await (await page.request.get('/assets/wasm/l-system-delay-build.json')).json();
  await save('expanded-samples-real-rust', { auditions, before, final, wasmBuild, responses: evidence.responses,
    generations: 1, actualBundledRecordings: true, actualWasm: true, listeningPerformed: false });
});

test('rapid expanded sample changes supersede late real decodes and Audio off prevents revival', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page); await ready(page); await options(page);
  await choose(page, 'inputSample', 'music-bass'); await page.locator('#audioButton').click();
  const before = await live(page, 'music-bass');
  await page.evaluate(() => { __expandedSamplesQa.holdNextDecode = true; });
  await choose(page, 'inputSample', NEW_IDS[0]);
  await page.waitForFunction(() => __expandedSamplesQa.pendingDecodes.length === 1);
  const rapid = NEW_IDS.slice(1, 6);
  await page.locator('#inputSample').evaluate(async (select, ids) => {
    for (const id of ids) {
      select.value = id; select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 8));
    }
  }, rapid);
  const latest = await live(page, rapid.at(-1), before.status.elapsedSeconds);
  expect(latest.contextGeneration).toBe(before.contextGeneration); expect(gains(latest)).toEqual(gains(before));
  const sourceCount = latest.sources.filter(source => source.started).length;
  await page.evaluate(() => __expandedSamplesQa.pendingDecodes.shift()());
  await page.waitForTimeout(200);
  const released = await live(page, rapid.at(-1), latest.status.elapsedSeconds);
  expect(released.sources.filter(source => source.started)).toHaveLength(sourceCount);
  expect(released.contextGeneration).toBe(before.contextGeneration); expect(gains(released)).toEqual(gains(before));
  await page.evaluate(() => { __expandedSamplesQa.holdNextDecode = true; });
  await choose(page, 'inputSample', NEW_IDS[6]);
  await page.waitForFunction(() => __expandedSamplesQa.pendingDecodes.length === 1);
  await off(page); const stopped = await diagnostics(page);
  await page.evaluate(() => __expandedSamplesQa.pendingDecodes.shift()());
  await page.waitForTimeout(200);
  const late = await diagnostics(page);
  expect(late.audio).toBe(false); expect(late.input.playing).toBe(false); expect(late.input.pending).toBe(false);
  expect(late.sources.filter(source => source.started)).toHaveLength(stopped.sources.filter(source => source.started).length);
  expect(gains(late)).toEqual(gains(before)); expect(late.microphoneRequests).toBe(0);
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await save('expanded-samples-rapid-decode', { rapid, before, latest, released, stopped, late,
    actualDecodeWithDelayedDelivery: true, actualWasm: true, listeningPerformed: false });
  await cleanup(page);
});

test('expanded sample menu remains searchable and keyboard reachable in three layouts without arming Audio', async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page); await ready(page);
  const menu = await options(page), last = menu.at(-1), layouts = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const picker = page.locator('[data-select-id="inputSample"]'), summary = picker.locator('summary');
    await summary.scrollIntoViewIfNeeded(); await summary.click();
    const search = picker.locator('input[type="search"]'); await search.fill(last.label);
    const target = picker.locator(`button[data-option-index="${menu.length - 1}"]`);
    await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    await search.fill(''); await summary.focus(); await page.keyboard.press('End');
    await expect(target).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page.locator('#inputSample')).toHaveValue(last.id);
    const d = await diagnostics(page);
    expect(d.audio).toBe(false); expect(d.microphoneRequests).toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    layouts.push({ viewport, target: last, box, overflow });
    await test.info().attach(`expanded-samples-${viewport.width}x${viewport.height}`, { body: await page.screenshot(), contentType: 'image/png' });
  }
  expect(evidence.errors).toEqual([]); expect(evidence.consoleErrors).toEqual([]);
  await save('expanded-samples-layouts', { layouts, audioExplicitlyOff: true, physicalTouchPerformed: false });
  await cleanup(page);
});

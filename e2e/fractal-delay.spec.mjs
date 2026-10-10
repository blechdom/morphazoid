import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ENGINE = '/src/instruments/fractal-delay/browser-engine.js';
const MODES = ['inverse', 'contours', 'orbits', 'rays', 'membrane'];
const SIZES = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
test.use({ reducedMotion: 'no-preference' });

// Real decoded media and a real MediaStream feed the production processor.
// The observer records its output; it does not replace or synthesize the DSP.
function wav({ duration = 4, amplitude = .035, frequencies = [173, 311, 659] } = {}) {
  const rate = 48000, frames = Math.round(rate * duration), bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const sample = frequencies.reduce((sum, f) => sum + Math.sin(i / rate * Math.PI * 2 * f), 0) / frequencies.length;
    bytes.writeInt16LE(Math.round(sample * amplitude * 32767), 44 + i * 2);
  }
  return bytes;
}

async function fixture(page, { holdContext = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ holdContext }) => {
    const NativeContext = AudioContext, NativeNode = AudioWorkletNode;
    const qa = window.__fractalPcmWitness = { contexts: [], sources: [], nodes: [], packets: [], statuses: [], allStatuses: [],
      streams: [], microphoneRequests: 0, pendingMicrophones: [], holdMicrophone: false, recording: false };
    qa.holdContext = holdContext; qa.pendingInitializers = [];
    const addModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, ...args) {
      if (qa.holdContext && String(url).split('?')[0].endsWith('/network-worklet.js'))
        await new Promise(resolve => qa.pendingInitializers.push(resolve));
      return addModule.call(this, url, ...args);
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (qa.nodes.includes(this) && destination instanceof GainNode) {
        const analyser = destination.context.createAnalyser(), mute = destination.context.createGain();
        analyser.fftSize = 4096; mute.gain.value = 0;
        connect.call(destination, analyser); connect.call(analyser, mute); connect.call(mute, destination.context.destination);
        qa.mainMonitor = { analyser, samples: new Float32Array(analyser.fftSize) };
      }
      return result;
    };
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); qa.contexts.push(this); }
    };
    const createSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const node = createSource.apply(this, args), row = { starts: 0, stops: 0, ended: false };
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...values) => { row.starts++; return start(...values); };
      node.stop = (...values) => { row.stops++; return stop(...values); };
      node.addEventListener('ended', () => { row.ended = true; });
      qa.sources.push(row); return node;
    };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'fractal-delay-network') return;
        qa.nodes.push(this);
        this.port.addEventListener('message', ({ data }) => {
          if (!data.status) return;
          qa.allStatuses.push({ revision: data.status.revision, sampleClock: data.status.sampleClock,
            activeEdges: data.status.activeEdges, outputLeftPeak: data.status.outputLeftPeak,
            outputRightPeak: data.status.outputRightPeak });
          if (qa.recording) qa.statuses.push(structuredClone(data.status));
        });
        qa.probeReady = (async () => {
          const script = `registerProcessor('fractal-pcm-witness', class extends AudioWorkletProcessor {
            constructor() {
              super(); this.reset();
              this.port.onmessage = ({ data }) => {
                if (data === 'reset') { this.reset(); this.port.postMessage({ reset: true }); }
              };
            }
            reset() {
              this.capacity = Math.ceil(sampleRate * .05 / 128) * 128;
              this.raw = new Float32Array(this.capacity * 2); this.frames = this.total = this.nonFinite = 0;
              this.zeroRun = this.longestZeroRun = this.discontinuities = 0; this.previousEnd = undefined;
            }
            process(inputs, outputs) {
              for (const output of outputs) for (const channel of output) channel.fill(0);
              const count = outputs[0][0].length, input = inputs[0] || [];
              if (this.previousEnd !== undefined && this.previousEnd !== currentFrame) this.discontinuities++;
              this.previousEnd = currentFrame + count;
              for (let i = 0; i < count; i++) {
                const l = input[0]?.[i] ?? 0, r = input[1]?.[i] ?? l;
                this.nonFinite += Number(!Number.isFinite(l) || !Number.isFinite(r));
                this.zeroRun = Math.max(Math.abs(l), Math.abs(r)) < 1e-8 ? this.zeroRun + 1 : 0;
                this.longestZeroRun = Math.max(this.longestZeroRun, this.zeroRun);
                this.raw[this.frames * 2] = l; this.raw[this.frames * 2 + 1] = r;
                this.frames++; this.total++;
                if (this.frames === this.capacity) {
                  this.port.postMessage({ raw: this.raw, frames: this.frames, rate: sampleRate,
                    total: this.total, endFrame: currentFrame + i + 1, nonFinite: this.nonFinite,
                    discontinuities: this.discontinuities, longestZeroRun: this.longestZeroRun }, [this.raw.buffer]);
                  this.raw = new Float32Array(this.capacity * 2); this.frames = 0;
                }
              }
              return true;
            }
          });`;
          const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
          try { await this.context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          const probe = qa.probe = new NativeNode(this.context, 'fractal-pcm-witness', { outputChannelCount: [1] });
          probe.port.onmessage = ({ data }) => {
            if (data.reset) { qa.resetAck?.(); return; }
            if (qa.recording) qa.packets.push(data);
          };
          this.connect(probe); probe.connect(this.context.destination);
        })();
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      qa.microphoneRequests++;
      const context = new NativeContext(), destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.frequency.value = 173; gain.gain.value = .035;
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      qa.streams.push(destination.stream);
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          if (track.readyState === 'ended') return stop();
          stop(); oscillator.stop(); void context.close();
        };
      }
      if (qa.holdMicrophone) await new Promise((resolve, reject) => qa.pendingMicrophones.push({ resolve,
        reject: () => {
          destination.stream.getTracks().forEach(track => track.stop());
          reject(new DOMException('QA microphone permission denied', 'NotAllowedError'));
        } }));
      return destination.stream;
    };
  }, { holdContext });
  await page.route('**/assets/synthesis/loops/*.wav', route => route.fulfill({
    status: 200, contentType: 'audio/wav', body: wav(),
  }));
  return errors;
}

async function diagnostics(page) {
  return page.evaluate(async module => {
    const d = (await import(module)).getFractalDelayEngine().getDiagnostics(), qa = __fractalPcmWitness;
    let audiblePeak = 0, audibleNonFinite = 0;
    if (qa.mainMonitor) {
      qa.mainMonitor.analyser.getFloatTimeDomainData(qa.mainMonitor.samples);
      for (const sample of qa.mainMonitor.samples) {
        if (!Number.isFinite(sample)) audibleNonFinite++;
        else audiblePeak = Math.max(audiblePeak, Math.abs(sample));
      }
    }
    return { ...d, witness: {
      contexts: qa.contexts.length, nodes: qa.nodes.length, sources: qa.sources.map(row => ({ ...row })),
      microphoneRequests: qa.microphoneRequests, pendingMicrophones: qa.pendingMicrophones.length,
      liveTracks: qa.streams.flatMap(stream => stream.getTracks()).filter(track => track.readyState !== 'ended').length,
      statuses: qa.allStatuses,
      pendingInitializers: qa.pendingInitializers.length, audiblePeak, audibleNonFinite,
    } };
  }, ENGINE);
}

async function ready(page) {
  await page.goto('/fractal-delay.html');
  await expect(page.locator('#audioButton')).toBeEnabled();
  await expect(page.locator('#mode option')).toHaveCount(5);
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.preparedEdges ?? d.activeEdges;
  }, { timeout: 30000 }).toBeGreaterThan(0);
  expect((await diagnostics(page)).audioDesired).toBe(false);
}

async function choose(page, id, value) {
  const select = page.locator(`#${id}`);
  const picker = page.locator(`[data-select-id="${id}"]`);
  // Source state changes immediately; its dependent UI paints at a lower
  // priority. Wait for the actual owner before deciding which UI to operate.
  await expect.poll(async () => await select.isVisible() || await picker.isVisible()).toBe(true);
  if (await select.isVisible()) await select.selectOption(value);
  else {
    const index = await select.evaluate((node, value) => [...node.options].findIndex(option => option.value === value), value);
    expect(index, `#${id} option ${value}`).toBeGreaterThanOrEqual(0);
    if (await picker.getAttribute('open') === null) await picker.locator('summary').click();
    await picker.locator(`button[data-option-index="${index}"]`).click();
  }
  await expect(select).toHaveValue(value);
}

async function parameters(page, values) {
  await page.evaluate(async ({ module, values }) => {
    await (await import(module)).getFractalDelayEngine().setParameters(values);
  }, { module: ENGINE, values });
}

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function performanceState(page, values) {
  await page.evaluate(async ({ module, values }) => {
    await (await import(module)).getFractalDelayEngine().setPerformance(values);
  }, { module: ENGINE, values });
}

async function upload(page) {
  await page.locator('#fileInput').setInputFiles({ name: 'fractal-known-tones.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.input.hasFile && !d.input.pending;
  }, { timeout: 15000 }).toBe(true);
}

async function beginCapture(page) {
  await page.evaluate(async () => {
    const qa = __fractalPcmWitness; await qa.probeReady;
    qa.recording = false;
    await new Promise(resolve => { qa.resetAck = resolve; qa.probe.port.postMessage('reset'); });
    qa.packets.length = 0; qa.statuses.length = 0; qa.recording = true;
  });
}

async function capture(page, seconds = .65) {
  await expect.poll(() => page.evaluate(() => {
    const packets = __fractalPcmWitness.packets; return packets.at(-1)?.total / (packets.at(-1)?.rate || 1) || 0;
  }), { timeout: 15000 }).toBeGreaterThanOrEqual(seconds);
  return page.evaluate(() => {
    const qa = __fractalPcmWitness, packets = qa.packets, frequencies = [173, 311, 659];
    let energy = 0, peak = 0, frames = 0;
    const bands = frequencies.map(() => ({ real: 0, imaginary: 0 }));
    for (const packet of packets) {
      for (let i = 0; i < packet.frames; i++) {
        const l = packet.raw[i * 2], r = packet.raw[i * 2 + 1], sample = (l + r) * .5;
        energy += (l * l + r * r) * .5; peak = Math.max(peak, Math.abs(l), Math.abs(r));
        for (let j = 0; j < frequencies.length; j++) {
          const phase = 2 * Math.PI * frequencies[j] * (packet.endFrame - packet.frames + i) / packet.rate;
          bands[j].real += sample * Math.cos(phase); bands[j].imaginary += sample * Math.sin(phase);
        }
        frames++;
      }
    }
    const last = packets.at(-1);
    return { frames, rate: last.rate, duration: frames / last.rate, rms: Math.sqrt(energy / frames), peak,
      bands: bands.map(band => Math.hypot(band.real, band.imaginary) / frames),
      nonFinite: last.nonFinite, discontinuities: last.discontinuities, longestZeroSeconds: last.longestZeroRun / last.rate,
      statuses: qa.statuses };
  });
}

function boundedPcm(pcm) {
  expect(pcm.frames).toBeGreaterThan(0);
  expect(pcm.nonFinite).toBe(0); expect(pcm.discontinuities).toBe(0);
  expect(pcm.peak).toBeLessThanOrEqual(1); expect(pcm.rms).toBeGreaterThan(.00001);
}

test('all five mathematical networks play real finite PCM without restarting their source', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = await fixture(page); await ready(page);
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).input.playing, { timeout: 30000 }).toBe(true);
  await performanceState(page, { wet: 1, dry: 0 });
  const baseline = await diagnostics(page), evidence = {};
  for (const mode of MODES) {
    await choose(page, 'mode', mode);
    // A short common edge-time keeps this transfer-function test independent
    // of factory scenes whose long travel time intentionally delays an onset.
    await parameters(page, { timeMs: 12, coupling: 1, decay: .7, pitchOffset: 0, pickup: .3 });
    await expect.poll(async () => (await diagnostics(page)).parameters.mode).toBe(mode);
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return !d.compiling && d.status.revision === d.network?.revision
        && d.activeEdges === d.preparedEdges && Math.max(d.status.outputLeftPeak, d.status.outputRightPeak) > .000001;
    }, { timeout: 30000 }).toBe(true);
    await page.waitForTimeout(250);
    await beginCapture(page); const pcm = await capture(page);
    boundedPcm(pcm);
    const d = await diagnostics(page);
    expect(d.contextGeneration, mode).toBe(baseline.contextGeneration);
    expect(d.witness.sources, mode).toEqual(baseline.witness.sources);
    expect(d.sampleClock, mode).toBeGreaterThan(baseline.sampleClock);
    expect(d.activeEdges, mode).toBeGreaterThan(0);
    expect(d.activeEdges, mode).toBe(d.preparedEdges);
    expect(d.network.mode, mode).toBe(mode);
    expect(d.network.metadata.completeGraph, mode).toBe(true);
    const revisionFrames = d.witness.statuses.filter(frame => frame.revision === d.network.revision);
    expect(revisionFrames.length, mode).toBeGreaterThan(0);
    expect(revisionFrames.map(frame => frame.activeEdges), mode).toEqual(revisionFrames.map(() => d.preparedEdges));
    expect(d.error, mode).toBeFalsy();
    evidence[mode] = { ...pcm, revision: d.revision, activeEdges: d.activeEdges };
  }
  // Frequency-response ratios reject five cosmetic mode names sharing the same
  // audible transfer function. Level changes alone cannot pass this comparison.
  const signatures = Object.values(evidence).map(pcm => {
    const total = pcm.bands.reduce((a, b) => a + b, 0); return pcm.bands.map(v => v / total);
  });
  expect(signatures.every(row => row.every(Number.isFinite))).toBe(true);
  expect(Math.max(...signatures.flatMap(a => signatures.map(b => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0)))))
    .toBeGreaterThan(.01);
  expect(errors).toEqual([]);
  await testInfo.attach('five-network-pcm.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('presets, continuous controls and a blocked UI preserve the audio clock and one media source', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = await fixture(page); await ready(page);
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).input.playing, { timeout: 30000 }).toBe(true);
  await performanceState(page, { wet: .7, dry: .3 });
  const before = await diagnostics(page); await beginCapture(page);
  const presets = await page.locator('#presetSelect').evaluate(select => [...select.options].map(option => option.value).filter(Boolean));
  expect(presets.length).toBeGreaterThanOrEqual(5);
  for (const id of presets.slice(0, 5)) {
    await page.locator('.instrument-preset-controls summary').click();
    await page.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
    await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', id);
  }
  for (const value of [15, 90, 25, 160, 35, 70]) await range(page, 'timeMs', value);
  await page.locator('#stage').focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
  await page.evaluate(() => { const until = performance.now() + 450; while (performance.now() < until) {} });
  const pcm = await capture(page, 1.2); boundedPcm(pcm);
  // A continuous injected signal plus a dry path makes a disappearing output
  // distinguishable from legitimate sparse wet echoes.
  expect(pcm.longestZeroSeconds).toBeLessThan(.04);
  const after = await diagnostics(page);
  expect(after.contextGeneration).toBe(before.contextGeneration);
  expect(after.sampleClock).toBeGreaterThan(before.sampleClock);
  expect(after.witness.sources).toEqual(before.witness.sources);
  expect(after.input.playing).toBe(true); expect(after.audioDesired).toBe(true);
  expect(after.error).toBeFalsy(); expect(errors).toEqual([]);
  await testInfo.attach('live-edit-continuity.json', { body: JSON.stringify({ before, after, pcm }, null, 2), contentType: 'application/json' });
});

test('file and sample input stay at unity independently of retained mic gain', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = await fixture(page); await ready(page);
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).input.playing, { timeout: 30000 }).toBe(true);
  await performanceState(page, { wet: 0, dry: 1, outputLevel: .5, outputBoostDb: 0 });
  const evidence = {};
  for (const mode of ['file', 'samples']) {
    await choose(page, 'sourceMode', mode);
    if (mode === 'samples') {
      // The drum source is an arrangement with intentional gaps. A continuous
      // decoded loop makes gain independence measurable at arbitrary phases.
      await choose(page, 'sampleSelect', 'music-keys');
    }
    await expect.poll(async () => (await diagnostics(page)).input.playing, { timeout: 15000 }).toBe(true);
    const values = [];
    for (const gain of [0, 4]) {
      await range(page, 'inputTrim', gain); await page.waitForTimeout(250);
      await beginCapture(page); const pcm = await capture(page); boundedPcm(pcm); values.push(pcm);
    }
    expect(values[1].rms / values[0].rms, mode).toBeCloseTo(1, 1); evidence[mode] = values;
    if (mode === 'samples') {
      const nextId = 'music-bass'; await choose(page, 'sampleSelect', nextId);
      await expect.poll(async () => {
        const d = await diagnostics(page); return d.input.playing && d.input.sampleId === nextId;
      }, { timeout: 15000 }).toBe(true);
      await beginCapture(page); boundedPcm(await capture(page));
    }
  }
  await choose(page, 'sourceMode', 'mic');
  await page.locator('#micButton').click();
  await expect.poll(async () => (await diagnostics(page)).witness.liveTracks, { timeout: 15000 }).toBe(1);
  const mic = [];
  for (const gain of [.5, 1]) {
    await range(page, 'inputTrim', gain); await page.waitForTimeout(250);
    await beginCapture(page); const pcm = await capture(page); boundedPcm(pcm); mic.push(pcm);
  }
  expect(mic[1].rms / mic[0].rms).toBeCloseTo(2, 1);
  await range(page, 'inputTrim', 0);
  await expect.poll(async () => (await diagnostics(page)).performance.inputGain).toBe(0);
  const muteRequested = await diagnostics(page);
  // Rust smooths gain with a 35 ms time constant. Begin with a fresh DSP
  // status, then let twelve time constants render before measuring silence;
  // wall time alone does not prove that the audio thread has settled.
  await expect.poll(async () => (await diagnostics(page)).sampleClock, {
    timeout: 5000, intervals: [25, 50, 100],
  }).toBeGreaterThan(muteRequested.sampleClock);
  const muteStarted = await diagnostics(page);
  const settlingFrames = Math.ceil(muteStarted.sampleRate * .035 * 12);
  await expect.poll(async () => (await diagnostics(page)).sampleClock - muteStarted.sampleClock, {
    timeout: 5000, intervals: [25, 50, 100],
  }).toBeGreaterThanOrEqual(settlingFrames);
  const muteSettled = await diagnostics(page);
  await beginCapture(page); const silent = await capture(page);
  expect(silent.peak).toBeLessThan(.00001); expect(silent.nonFinite).toBe(0);
  expect(errors).toEqual([]);
  await testInfo.attach('input-policy-pcm.json', { body: JSON.stringify({ ...evidence, mic, silent,
    muteSettling: { startClock: muteStarted.sampleClock, endClock: muteSettled.sampleClock,
      rate: muteStarted.sampleRate, requiredFrames: settlingFrames } }, null, 2), contentType: 'application/json' });
});

test('late microphone permission is cancelled and Audio off releases captured devices', async ({ page }) => {
  test.setTimeout(90000);
  const errors = await fixture(page); await ready(page);
  await page.locator('#audioButton').click();
  await page.evaluate(() => { __fractalPcmWitness.holdMicrophone = true; });
  await page.locator('#micButton').click();
  await expect.poll(async () => (await diagnostics(page)).witness.pendingMicrophones, { timeout: 15000 }).toBe(1);
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await page.evaluate(() => {
    const qa = __fractalPcmWitness; qa.holdMicrophone = false;
    qa.pendingMicrophones.splice(0).forEach(pending => pending.resolve());
  });
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.input.mode === 'file' && d.input.playing && d.witness.liveTracks === 0;
  }, { timeout: 15000 }).toBe(true);
  await choose(page, 'sourceMode', 'mic');
  await page.locator('#micButton').click();
  await expect.poll(async () => (await diagnostics(page)).witness.liveTracks).toBe(1);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page); return !d.audioDesired && !d.input.playing && d.witness.liveTracks === 0;
  }).toBe(true);
  expect(errors).toEqual([]);
});

test('microphone capture with Audio off stays muted until the explicit Audio action', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await fixture(page); await ready(page);
  await page.locator('#micButton').click();
  await expect.poll(async () => (await diagnostics(page)).witness.liveTracks, { timeout: 15000 }).toBe(1);
  await expect.poll(async () => (await diagnostics(page)).status.inputPeak, { timeout: 15000 }).toBeGreaterThan(.00001);
  await page.waitForTimeout(150);
  const muted = await diagnostics(page);
  expect(muted.audioDesired).toBe(false); expect(muted.audio).toBe(false);
  expect(muted.witness.audibleNonFinite).toBe(0); expect(muted.witness.audiblePeak).toBeLessThan(.000001);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).witness.audiblePeak).toBeGreaterThan(.00001);
  const armed = await diagnostics(page);
  expect(armed.contextGeneration).toBe(muted.contextGeneration);
  expect(armed.witness.microphoneRequests).toBe(1);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page); return !d.audioDesired && !d.microphone && d.witness.liveTracks === 0 && d.contextState === 'suspended';
  }, { timeout: 15000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('turning Audio off during cold preparation cannot start a late source', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await fixture(page, { holdContext: true }); await ready(page);
  await choose(page, 'sourceMode', 'samples');
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).witness.pendingInitializers).toBe(1);
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).audioDesired).toBe(false);
  await page.evaluate(() => {
    const qa = __fractalPcmWitness; qa.holdContext = false;
    qa.pendingInitializers.splice(0).forEach(resolve => resolve());
  });
  await expect.poll(async () => (await diagnostics(page)).contextState, { timeout: 15000 }).toBe('suspended');
  const d = await diagnostics(page);
  expect(d.audioDesired).toBe(false); expect(d.audio).toBe(false); expect(d.input.playing).toBe(false);
  expect(d.witness.sources.every(source => source.starts === 0)).toBe(true);
  expect(d.sourceCount).toBe(0); expect(d.error).toBeFalsy();
  await page.evaluate(async module => (await import(module)).getFractalDelayEngine().dispose(), ENGINE);
  expect((await diagnostics(page)).contextState).toBe('closed');
  expect(errors).toEqual([]);
});

test('Fractal Delay has no critical or serious accessible-control violations', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await fixture(page); await ready(page);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  await testInfo.attach('fractal-delay-accessibility.json', {
    body: JSON.stringify({ violations: result.violations, incomplete: result.incomplete }, null, 2), contentType: 'application/json',
  });
  expect(result.violations.filter(row => ['critical', 'serious'].includes(row.impact))).toEqual([]);
});

for (const viewport of SIZES) {
  test(`all controls remain reachable and XY is keyboard-operable at ${viewport.width}×${viewport.height}`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    const errors = await fixture(page); await ready(page);
    const graphic = await page.locator('#stage').boundingBox();
    expect(graphic.height, 'the graphic must retain a usable height').toBeGreaterThan(120);
    expect(graphic.width, 'the graphic must retain a usable width').toBeGreaterThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    for (const id of ['sourceMode', 'sampleSelect', 'sampleNext', 'fileInput', 'inputLoop', 'restartInput', 'stopInput',
      'mode', 'modeNext', 'domain', 'cReal', 'cImag', 'detail', 'timeMs', 'pitchOffset', 'decay', 'coupling', 'pickup',
      'wet', 'dry', 'hpfHz', 'lpfHz', 'outputBoostDb', 'compressorThresholdDb', 'compressorRatio',
      'compressorAttackMs', 'compressorReleaseMs', 'compressorMakeupDb', 'masteringPreset', 'inputTrim', 'outputLevel',
      'voiceBudget', 'manualBudget', 'captureSound', 'audioButton', 'presetSelect']) {
      if (id === 'sampleSelect') await choose(page, 'sourceMode', 'samples');
      if (id === 'fileInput') await choose(page, 'sourceMode', 'file');
      if (id === 'domain') await choose(page, 'mode', 'contours');
      await page.locator(`#${id}`).evaluate(node => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement)
          if (parent.tagName === 'DETAILS' && !parent.matches('[data-select-id], .instrument-preset-controls')) parent.open = true;
      });
      let control = page.locator(`#${id}`);
      if (!(await control.isVisible()) && id === 'presetSelect') control = page.locator('.instrument-preset-controls summary');
      else if (!(await control.isVisible()) && await page.locator(`[data-select-id="${id}"]`).count())
        control = page.locator(`[data-select-id="${id}"] > summary`);
      await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x, id).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, id).toBeLessThanOrEqual(viewport.width + 1);
    }
    const before = await diagnostics(page);
    await page.locator('#stage').scrollIntoViewIfNeeded(); await page.locator('#stage').focus();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return d.parameters.cReal !== before.parameters.cReal && d.parameters.cImag !== before.parameters.cImag;
    }).toBe(true);
    expect((await diagnostics(page)).audioDesired).toBe(false);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`fractal-delay-${viewport.width}.png`), fullPage: true });
  });
}

for (const viewport of SIZES.slice(1)) {
  test(`coarse-pointer Audio remains at least 48 pixels at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage(); await fixture(page); await ready(page);
      const audio = await page.locator('#audioButton').boundingBox();
      expect(audio.width).toBeGreaterThanOrEqual(48); expect(audio.height).toBeGreaterThanOrEqual(48);
    } finally { await context.close(); }
  });
}

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

async function fixture(page, { holdContext = false, observeRenderer = false } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ holdContext, observeRenderer }) => {
    const NativeContext = AudioContext, NativeNode = AudioWorkletNode;
    const qa = window.__fractalPcmWitness = { contexts: [], sources: [], nodes: [], packets: [], statuses: [], allStatuses: [],
      streams: [], microphoneRequests: 0, pendingMicrophones: [], holdMicrophone: false, recording: false };
    if (observeRenderer) {
      // Observe vertices actually submitted to the marker draw, without adding
      // a product-only QA API or asking the model what it intended to display.
      const states = new WeakMap(), canvasMarkers = new WeakMap();
      const state = gl => {
        if (!states.has(gl)) states.set(gl, { buffers: new WeakMap(), attributes: new WeakMap() });
        return states.get(gl);
      };
      const glPrototype = globalThis.WebGL2RenderingContext?.prototype;
      if (glPrototype) {
        for (const name of ['bindBuffer', 'bindVertexArray', 'bufferData', 'vertexAttribPointer', 'drawArrays']) {
          const original = glPrototype[name];
          glPrototype[name] = function (...args) {
            const result = original.apply(this, args), s = state(this);
            if (name === 'bindBuffer' && args[0] === this.ARRAY_BUFFER) s.buffer = args[1];
            if (name === 'bindVertexArray') s.vao = args[0];
            if (name === 'bufferData' && args[0] === this.ARRAY_BUFFER && s.buffer && ArrayBuffer.isView(args[1]))
              s.buffers.set(s.buffer, Array.from(args[1]));
            if (name === 'vertexAttribPointer' && s.vao) {
              if (!s.attributes.has(s.vao)) s.attributes.set(s.vao, new Map());
              s.attributes.get(s.vao).set(args[0], { buffer: s.buffer, size: args[1], stride: args[4], offset: args[5] });
            }
            if (name === 'drawArrays' && args[0] === this.POINTS) {
              const position = s.attributes.get(s.vao)?.get(0), data = s.buffers.get(position?.buffer);
              if (position?.stride === 32 && data) {
                if (qa.markerData !== data || qa.markerCount !== args[2]) {
                  qa.markerData = data; qa.markerCount = args[2];
                  qa.markerFrame = { backend: 'WebGL2', markers: Array.from({ length: args[2] }, (_, i) => {
                    const row = data.slice((args[1] + i) * 8, (args[1] + i + 1) * 8);
                    return { x: row[0], y: row[1], kind: row[3] > .9 ? 'input' : 'pickup',
                      scale: row[5], alpha: row[6], ring: !!row[7] };
                  }) };
                }
                qa.markerFrame.renderedAt = performance.now();
              }
            }
            return result;
          };
        }
      }
      // Canvas fallback paints its static marker overlay once and composites
      // it on each pressure frame. Follow the surface that is really copied.
      for (const prototype of new Set([globalThis.CanvasRenderingContext2D?.prototype, globalThis.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean))) {
        for (const name of ['clearRect', 'beginPath', 'arc', 'fill', 'stroke', 'drawImage']) {
          const original = prototype[name];
          prototype[name] = function (...args) {
            const result = original.apply(this, args);
            if (name === 'clearRect') canvasMarkers.set(this.canvas, { markers: [] });
            const frame = canvasMarkers.get(this.canvas);
            if (name === 'beginPath' && frame) frame.arc = null;
            if (name === 'arc' && frame) frame.arc = { x: args[0], y: args[1], radius: args[2] };
            const color = name === 'fill' ? this.fillStyle : this.strokeStyle;
            if (frame?.arc && ['fill', 'stroke'].includes(name) && ['#40ff76', '#ff9f33'].includes(color)) {
              frame.markers.push({ ...frame.arc, kind: color === '#40ff76' ? 'input' : 'pickup',
                alpha: this.globalAlpha, ring: name === 'stroke' });
              if (this.canvas.id === 'stage') qa.markerFrame = { backend: 'Canvas2D', ...frame,
                width: this.canvas.width, height: this.canvas.height, renderedAt: performance.now() };
            }
            if (name === 'drawImage' && this.canvas.id === 'stage') {
              const overlay = canvasMarkers.get(args[0]);
              if (overlay?.markers.length) qa.markerFrame = { backend: 'Canvas2D', markers: overlay.markers,
                width: this.canvas.width, height: this.canvas.height, renderedAt: performance.now() };
            }
            return result;
          };
        }
      }
    }
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
  }, { holdContext, observeRenderer });
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

async function markerEvidence(page) {
  return page.evaluate(async module => {
    const d = (await import(module)).getFractalDelayEngine().getDiagnostics(), network = d.network;
    const frame = __fractalPcmWitness.markerFrame, errors = [];
    if (!network || !frame) return { matches: false, errors: ['no installed graph or rendered marker frame'] };
    const inputs = network.inputPorts, pickups = network.pickupPorts;
    if (!Array.isArray(inputs) || !Array.isArray(pickups)) return { matches: false, errors: ['installed scene has no explicit ports'] };
    const expected = [...inputs.map(port => ({ ...port, kind: 'input' })), ...pickups.map(port => ({ ...port, kind: 'pickup' }))];
    let transform;
    if (frame.backend === 'Canvas2D') {
      const bounds = network.bounds, dpr = Math.min(1.75, Math.max(1, devicePixelRatio || 1));
      const pad = Math.min(36 * dpr, frame.width * .12, frame.height * .12);
      const scale = Math.min(Math.max(1, frame.width - 2 * pad) / Math.max(.15, bounds.maxX - bounds.minX),
        Math.max(1, frame.height - 2 * pad) / Math.max(.15, bounds.maxY - bounds.minY));
      transform = { scale, x: frame.width * .5 - (bounds.minX + bounds.maxX) * .5 * scale,
        y: frame.height * .5 + (bounds.minY + bounds.maxY) * .5 * scale };
    }
    if (frame.markers.length !== expected.length) errors.push(`drawn ${frame.markers.length}; installed ${expected.length}`);
    let maximumPositionError = 0;
    for (let i = 0; i < Math.min(frame.markers.length, expected.length); i++) {
      const actual = frame.markers[i], port = expected[i], node = network.nodes[port.node];
      const x = transform ? node.x * transform.scale + transform.x : node.x;
      const y = transform ? -node.y * transform.scale + transform.y : node.y;
      const distance = Math.hypot(actual.x - x, actual.y - y); maximumPositionError = Math.max(maximumPositionError, distance);
      if (distance > .00001 || actual.kind !== port.kind) errors.push(`marker ${i} is not on its installed ${port.kind} node ${port.node}`);
      if (!(actual.alpha > 0 && actual.alpha <= 1)) errors.push(`marker ${i} has invalid opacity`);
    }
    return { matches: errors.length === 0 && performance.now() - frame.renderedAt < 1000,
      backend: frame.backend, revision: network.revision, inputCount: inputs.length, pickupCount: pickups.length,
      drawnCount: frame.markers.length, maximumPositionError, errors };
  }, ENGINE);
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

async function settledPerformanceRange(page, id, value) {
  await range(page, id, value);
  await expect.poll(async () => (await diagnostics(page)).performance[id]).toBe(value);
  const requested = await diagnostics(page);
  await expect.poll(async () => (await diagnostics(page)).sampleClock, { timeout: 5000 }).toBeGreaterThan(requested.sampleClock);
  const started = await diagnostics(page), frames = Math.ceil(started.sampleRate * .035 * 12);
  await expect.poll(async () => (await diagnostics(page)).sampleClock - started.sampleClock, { timeout: 5000 }).toBeGreaterThanOrEqual(frames);
}
const settledDelayGain = (page, value) => settledPerformanceRange(page, 'delayGainDb', value);

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

test('multiport excitation, pickups and routing show the installed scene without interrupting playback', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = await fixture(page, { observeRenderer: true }); await ready(page);
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await parameters(page, { mode: 'inverse', detail: 5, timeMs: 12, coupling: 1, decay: .7, pitchOffset: 0, pickup: .3 });
  await page.locator('#audioButton').click();
  await expect.poll(async () => (await diagnostics(page)).input.playing, { timeout: 30000 }).toBe(true);
  await performanceState(page, { wet: .7, dry: .3 });
  const before = await diagnostics(page), evidence = [];
  const scenes = [
    { inputMode: 'point', pickupMode: 'point', routing: 'geometry', boundary: 1 },
    { inputMode: 'cluster', pickupMode: 'cluster', routing: 'loop', boundary: .8 },
    { inputMode: 'distributed', pickupMode: 'distributed', routing: 'shortcuts', boundary: .5 },
    { inputMode: 'boundary', pickupMode: 'distributed', routing: 'hub', boundary: .2 },
    { inputMode: 'all', pickupMode: 'all', routing: 'geometry', boundary: 0 },
  ];
  for (const [index, scene] of scenes.entries()) {
    await beginCapture(page);
    for (const id of ['inputMode', 'pickupMode', 'routing']) await choose(page, id, scene[id]);
    for (const [id, value] of Object.entries({ inputPosition: .2 + index * .12, inputCount: 8, inputSpread: .65,
      pickupCount: 7, pickupSpread: .7, boundary: scene.boundary, linkDensity: .35 })) await range(page, id, value);
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return !d.compiling && d.network?.parameters.inputMode === scene.inputMode
        && d.network?.parameters.pickupMode === scene.pickupMode && d.network?.parameters.routing === scene.routing
        && d.status.revision === d.network?.revision && d.activeEdges === d.preparedEdges;
    }, { timeout: 30000 }).toBe(true);
    await expect.poll(async () => (await markerEvidence(page)).matches, { timeout: 15000 }).toBe(true);
    const d = await diagnostics(page), markers = await markerEvidence(page), pcm = await capture(page);
    boundedPcm(pcm); expect(pcm.longestZeroSeconds, JSON.stringify(scene)).toBeLessThan(.04);
    expect(d.contextGeneration).toBe(before.contextGeneration);
    expect(d.witness.sources).toEqual(before.witness.sources); expect(d.sourceCount).toBe(1);
    expect(d.sampleClock).toBeGreaterThan(before.sampleClock); expect(d.audioDesired).toBe(true); expect(d.input.playing).toBe(true);
    expect(d.error).toBeFalsy(); expect(markers.drawnCount).toBe(d.network.inputPorts.length + d.network.pickupPorts.length);
    if (scene.inputMode === 'point') expect(d.network.inputPorts).toHaveLength(1);
    else expect(d.network.inputPorts.length).toBeGreaterThan(1);
    if (scene.pickupMode === 'point') expect(d.network.pickupPorts).toHaveLength(1);
    else expect(d.network.pickupPorts.length).toBeGreaterThan(1);
    if (scene.inputMode === 'all') expect(d.network.inputPorts).toHaveLength(d.network.nodes.length);
    if (scene.pickupMode === 'all') expect(d.network.pickupPorts).toHaveLength(d.network.nodes.length);
    const links = d.network.edges.filter(edge => edge.routingLink);
    if (scene.routing === 'geometry') expect(links).toHaveLength(0);
    else { expect(links.length).toBeGreaterThan(0); expect(links.every(edge => edge.routingType === scene.routing)).toBe(true); }
    const displayedPorts = (await page.locator('#portsReadout').textContent()).match(/[\d,]+/g).map(value => Number(value.replaceAll(',', '')));
    expect(displayedPorts).toEqual([d.network.inputPorts.length, d.network.pickupPorts.length]);
    expect(Number((await page.locator('#linksReadout').textContent()).replaceAll(',', ''))).toBe(links.length);
    evidence.push({ scene, revision: d.network.revision, markers, links: links.length, pcm });
  }
  expect(errors).toEqual([]);
  await testInfo.attach('multiport-routing-pcm.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
});

test('Network drive feeds real wet audio with direct input muted and cannot amplify direct playback', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = await fixture(page); await ready(page);
  const initial = await diagnostics(page);
  expect(initial.performance.inputDriveDb).toBe(12); expect(initial.performance.dry).toBe(0);
  await expect(page.locator('#inputDriveDb')).toHaveAttribute('min', '-12');
  await expect(page.locator('#inputDriveDb')).toHaveAttribute('max', '24');
  await expect(page.locator('.input-section #inputDriveDb')).toHaveAttribute('aria-label', 'Network drive');
  await expect(page.locator('.input-section #dry')).toHaveAttribute('aria-label', 'Direct input');
  await expect(page.locator('#dry')).toHaveValue('0');
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await parameters(page, { mode: 'inverse', detail: 2, timeMs: 12, coupling: 1, decay: .7, pitchOffset: 0,
    inputMode: 'all', pickupMode: 'all', boundary: 0, routing: 'geometry' });
  await performanceState(page, { inputDriveDb: 0, delayGainDb: 0, wet: 1, outputLevel: .4, outputBoostDb: 0,
    hpfHz: 5, lpfHz: 22000, compressorThresholdDb: 0, compressorRatio: 1, compressorMakeupDb: 0 });
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.input.playing && !d.compiling && d.status.revision === d.network?.revision && d.activeEdges === d.preparedEdges;
  }, { timeout: 30000 }).toBe(true);
  const before = await diagnostics(page), evidence = {};
  for (const drive of [0, 12]) {
    await settledPerformanceRange(page, 'inputDriveDb', drive); await beginCapture(page);
    const pcm = await capture(page); boundedPcm(pcm);
    const d = await diagnostics(page);
    expect(d.performance.dry).toBe(0);
    evidence[`wet${drive}`] = { ...pcm, edgePeak: Math.max(...d.status.edgeLevels) };
  }
  const wetRatio = evidence.wet12.rms / evidence.wet0.rms;
  expect(Math.abs(wetRatio / (10 ** (12 / 20)) - 1)).toBeLessThan(.02);
  expect(evidence.wet12.edgePeak).toBeGreaterThan(evidence.wet0.edgePeak * 3);
  await settledPerformanceRange(page, 'wet', 0); await beginCapture(page);
  evidence.mutedMix = await capture(page);
  expect(evidence.mutedMix.peak).toBeLessThan(.00001); expect(evidence.mutedMix.nonFinite).toBe(0);
  const stillFed = await diagnostics(page);
  expect(stillFed.input.playing).toBe(true); expect(stillFed.status.inputPeak).toBeGreaterThan(.00001);
  expect(Math.max(...stillFed.status.edgeLevels)).toBeGreaterThan(.00001);
  await settledPerformanceRange(page, 'dry', 1);
  for (const drive of [-12, 24]) {
    await settledPerformanceRange(page, 'inputDriveDb', drive); await beginCapture(page);
    evidence[`direct${drive}`] = await capture(page); boundedPcm(evidence[`direct${drive}`]);
  }
  expect(Math.abs(evidence.direct24.rms / evidence['direct-12'].rms - 1)).toBeLessThan(.015);
  const after = await diagnostics(page);
  expect(after.network.revision).toBe(before.network.revision); expect(after.preparedEdges).toBe(before.preparedEdges);
  expect(after.requiredDelayBytes).toBe(before.requiredDelayBytes); expect(after.contextGeneration).toBe(before.contextGeneration);
  expect(after.witness.sources).toEqual(before.witness.sources); expect(after.sampleClock).toBeGreaterThan(before.sampleClock);
  expect(after.input.playing).toBe(true); expect(after.audioDesired).toBe(true);
  expect(after.error).toBeFalsy(); expect(errors).toEqual([]);
  await testInfo.attach('network-drive-pcm.json', { body: JSON.stringify({ ...evidence, wetRatio,
    revision: after.network.revision, clockBefore: before.sampleClock, clockAfter: after.sampleClock }, null, 2),
    contentType: 'application/json' });
});

test('Delay gain amplifies wet audio independently and survives presets without restarting playback', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = await fixture(page); await ready(page);
  await expect(page.locator('#delayGainDb')).toHaveAttribute('min', '-12');
  await expect(page.locator('#delayGainDb')).toHaveAttribute('max', '48');
  expect((await diagnostics(page)).performance.delayGainDb).toBe(24);
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await parameters(page, { mode: 'inverse', detail: 2, timeMs: 12, coupling: 1, decay: .7, pitchOffset: 0,
    inputMode: 'all', pickupMode: 'all', boundary: 0, routing: 'geometry' });
  await performanceState(page, { inputDriveDb: 0, wet: 1, dry: 0, outputLevel: .4, outputBoostDb: 0, hpfHz: 5, lpfHz: 22000,
    compressorThresholdDb: 0, compressorRatio: 1, compressorMakeupDb: 0 });
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.input.playing && !d.compiling && d.status.revision === d.network?.revision && d.activeEdges === d.preparedEdges;
  }, { timeout: 30000 }).toBe(true);
  const before = await diagnostics(page), evidence = {};
  for (const gain of [0, 12]) {
    await settledDelayGain(page, gain); await beginCapture(page);
    evidence[`wet${gain}`] = await capture(page); boundedPcm(evidence[`wet${gain}`]);
  }
  const wetRatio = evidence.wet12.rms / evidence.wet0.rms;
  expect(Math.abs(wetRatio / (10 ** (12 / 20)) - 1)).toBeLessThan(.02);
  await performanceState(page, { wet: 0, dry: 1 });
  for (const gain of [0, 48]) {
    await settledDelayGain(page, gain); await beginCapture(page);
    evidence[`dry${gain}`] = await capture(page); boundedPcm(evidence[`dry${gain}`]);
  }
  expect(Math.abs(evidence.dry48.rms / evidence.dry0.rms - 1)).toBeLessThan(.015);
  await performanceState(page, { wet: .7, dry: .3 }); await settledDelayGain(page, 48);
  await beginCapture(page); evidence.maximumGain = await capture(page); boundedPcm(evidence.maximumGain);
  const afterGains = await diagnostics(page);
  expect(afterGains.network.revision).toBe(before.network.revision);
  expect(afterGains.preparedEdges).toBe(before.preparedEdges); expect(afterGains.requiredDelayBytes).toBe(before.requiredDelayBytes);
  expect(afterGains.contextGeneration).toBe(before.contextGeneration); expect(afterGains.witness.sources).toEqual(before.witness.sources);
  expect(afterGains.sampleClock).toBeGreaterThan(before.sampleClock); expect(afterGains.error).toBeFalsy();

  await settledDelayGain(page, 17);
  await settledPerformanceRange(page, 'inputDriveDb', 9);
  await settledPerformanceRange(page, 'dry', .08);
  const presets = await page.locator('#presetSelect').evaluate(select => [...select.options].map(option => option.value).filter(Boolean));
  evidence.presetTransitions = [];
  for (const id of presets.slice(0, 2)) {
    const beforePreset = await diagnostics(page);
    await page.locator('.instrument-preset-controls summary').click();
    await page.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
    await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', id, { timeout: 30000 });
    await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 });
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return !d.compiling && d.network?.revision > beforePreset.network.revision &&
        d.status.revision === d.network.revision && d.activeEdges === d.preparedEdges;
    }, { timeout: 30000 }).toBe(true);
    const installed = await diagnostics(page);
    expect(installed.contextGeneration).toBe(beforePreset.contextGeneration);
    expect(installed.witness.sources).toEqual(beforePreset.witness.sources);
    expect(installed.sampleClock).toBeGreaterThan(beforePreset.sampleClock);
    expect(installed.input.playing).toBe(true); expect(installed.audioDesired).toBe(true);
    expect(installed.error).toBeFalsy(); expect(installed.performance.delayGainDb).toBe(17);
    expect(installed.performance.inputDriveDb).toBe(9); expect(installed.performance.dry).toBe(.08);
    evidence.presetTransitions.push({ id, revision: installed.network.revision, activeEdges: installed.activeEdges,
      preparedEdges: installed.preparedEdges, clockBefore: beforePreset.sampleClock, clockAfter: installed.sampleClock });
    await expect(page.locator('#delayGainDb')).toHaveValue('17');
    await expect(page.locator('#inputDriveDb')).toHaveValue('9'); await expect(page.locator('#dry')).toHaveValue('0.08');
  }
  await choose(page, 'masteringPreset', 'warm');
  expect((await diagnostics(page)).performance.delayGainDb).toBe(17);
  expect((await diagnostics(page)).performance.inputDriveDb).toBe(9);
  expect((await diagnostics(page)).performance.dry).toBe(.08);
  await page.locator('#captureSound').evaluate(button => { button.closest('details').open = true; });
  await page.locator('#captureSound').click();
  const captured = JSON.parse(await page.locator('#capturedSound').inputValue());
  expect(captured.liveLevels.delayGainDb).toBe(17);
  expect(captured.liveLevels.inputDriveDb).toBe(9); expect(captured.liveLevels.dry).toBe(.08);
  expect(Object.hasOwn(captured.performance, 'inputDriveDb')).toBe(false);
  expect(Object.hasOwn(captured.performance, 'dry')).toBe(false);
  const afterPresets = await diagnostics(page);
  expect(afterPresets.contextGeneration).toBe(before.contextGeneration); expect(afterPresets.witness.sources).toEqual(before.witness.sources);
  expect(afterPresets.sampleClock).toBeGreaterThan(afterGains.sampleClock); expect(afterPresets.input.playing).toBe(true);
  expect(afterPresets.audioDesired).toBe(true); expect(afterPresets.error).toBeFalsy(); expect(errors).toEqual([]);
  await testInfo.attach('receiver-gain-pcm.json', { body: JSON.stringify({ ...evidence, wetRatio,
    revisionBefore: before.network.revision, revisionAfterGain: afterGains.network.revision,
    clockBefore: before.sampleClock, clockAfterGain: afterGains.sampleClock, retainedGain: afterPresets.performance.delayGainDb }, null, 2),
    contentType: 'application/json' });
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
      'inputMode', 'inputPosition', 'inputCount', 'inputSpread', 'pickupMode', 'pickupCount', 'pickupSpread', 'boundary', 'routing', 'linkDensity',
      'inputDriveDb', 'delayGainDb',
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

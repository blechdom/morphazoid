import { test, expect } from '@playwright/test';

// The normal animated workload must run; reduced motion bypasses branch waves.
test.use({ reducedMotion: 'no-preference' });

async function fixture(page, { voiceBudget = null, fakeMicrophone = false, fixedDrawingWorkMs = 0,
  observePcm = false, inspectControls = false, broadbandInput = false } = {}) {
  const errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) failures.push(response.url()); });
  await page.addInitScript(({ voiceBudget, fakeMicrophone, fixedDrawingWorkMs, observePcm, inspectControls, broadbandInput }) => {
    const qa = window.__deviceRuntime = { contexts: [], worklets: [], sources: [], compilations: [], microphoneRequests: 0 };
    qa.controls = []; const controlsById = new Map();
    const recordControl = (kind, data) => {
      const record = { kind, id: data.id, type: data.type ?? 'compile', phase: qa.phase,
        sentAt: performance.now(), parameters: data.parameters ? structuredClone(data.parameters) : undefined,
        performance: data.performance ? structuredClone(data.performance) : undefined, depth: data.depth };
      qa.controls.push(record); controlsById.set(`${kind}:${data.id}`, record); return record;
    };
    const NativeWorker = Worker, NativeContext = AudioContext, NativeNode = AudioWorkletNode;
    qa.fixedDrawingWorkMs = fixedDrawingWorkMs;
    window.Worker = new Proxy(NativeWorker, { construct(Target, args) {
      const worker = new Target(...args);
      if (String(args[0]).includes('/native/topology-worker.js')) {
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (data, ...rest) => {
          if (inspectControls) recordControl('worker', data);
          post(Number.isFinite(voiceBudget) ? { ...data, voiceBudget } : data, ...rest);
        };
        // This listener is registered before the application's onmessage.
        // Actual worker Rust measurement and bounded compilation still run.
        worker.addEventListener('message', ({ data }) => {
          const record = controlsById.get(`worker:${data.id}`);
          if (record) { record.ackAt = performance.now(); record.skipped = data.skipped; record.revision = data.revision; }
          if (!data.result) return;
          if (Number.isFinite(voiceBudget)) data.calibration.voices = voiceBudget;
          qa.compilations.push({ revision: data.revision, voiceBudget: data.voiceBudget,
            preparedVoices: data.result.preparedVoices, nodes: data.result.nodes.length,
            requestedGenerations: data.result.parameters.generations, requestedLab: data.result.parameters.lab,
            calibration: structuredClone(data.calibration) });
        });
      }
      return worker;
    } });
    window.AudioContext = class extends NativeContext { constructor(...args) { super(...args); qa.contexts.push(this); } };
    window.AudioWorkletNode = class extends NativeNode {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'morphazoid-l-system-delay') return;
        const analyser = this.context.createAnalyser(), mute = this.context.createGain();
        analyser.fftSize = 1024; mute.gain.value = 0;
        this.connect(analyser).connect(mute).connect(this.context.destination);
        qa.worklets.push({ analyser, samples: new Float32Array(analyser.fftSize) });
        if (inspectControls) {
          const port = this.port, post = port.postMessage.bind(port);
          port.postMessage = (data, ...rest) => {
            if (data.type !== 'status') recordControl('audio', data);
            post(data, ...rest);
          };
          port.addEventListener('message', ({ data }) => {
            const record = controlsById.get(`audio:${data.id}`);
            if (record) record.ackAt = performance.now();
          });
          const descriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
          Object.defineProperty(port, 'onmessage', {
            get() { return descriptor.get.call(this); },
            set(handler) {
              descriptor.set.call(this, handler && function (event) {
                const record = controlsById.get(`audio:${event.data.id}`);
                const deliver = () => { if (record) record.deliveredAt = performance.now(); handler.call(this, event); };
                if (record?.type === 'install' && qa.delayInstallAckMs > 0) {
                  record.injectedAckDelayMs = qa.delayInstallAckMs; setTimeout(deliver, qa.delayInstallAckMs);
                } else deliver();
              });
            },
          });
        }
        if (observePcm) {
          this.port.addEventListener('message', ({ data }) => {
            if (!qa.pcmRecording || !data.status) return;
            const s = data.status;
            qa.pcmStatuses.push({ receivedAt: performance.now(), sampleClock: s.elapsedSeconds,
              processedBlocks: s.processedBlocks, voiceLimit: s.voiceLimit, activeVoices: s.activeVoices,
              activeVoiceIndices: Array.from(s.activeVoiceIndices ?? []), topologyRevision: s.topologyRevision,
              cpu: s.cpuLoad, peakLoad: s.peakLoad, deadlineWarnings: s.deadlineMisses,
              underruns: s.underruns, overruns: s.overruns });
          });
          qa.probeReady = (async () => {
            const script = `registerProcessor('morphazoid-qa-pcm', class extends AudioWorkletProcessor {
              constructor() {
                super(); this.capacity = Math.ceil(sampleRate * .05 / 128) * 128;
                this.raw = new Float32Array(this.capacity * 2); this.reset();
                this.port.onmessage = ({ data }) => {
                  if (data === 'reset') { this.reset(); this.port.postMessage({ reset: true }); }
                  if (data === 'flush') this.port.postMessage({ flushed: true,
                    totalFrames: this.totalFrames, partialFrames: this.windowFrames,
                    endFrame: currentFrame, rate: sampleRate, renderedQuanta: this.renderedQuanta,
                    renderFrameDiscontinuities: this.renderFrameDiscontinuities });
                };
              }
              reset() {
                this.windowFrames = this.windowEnergy = this.windowPeak = this.windowNonFinite = this.windowLongestLowRun = 0;
                this.zeroRun = this.lowRun = this.longestZeroRun = this.longestLowRun = 0;
                this.totalFrames = this.totalNonFinite = this.sequence = 0;
                this.renderedQuanta = this.renderFrameDiscontinuities = 0; this.previousRenderEnd = undefined;
              }
              process(inputs, outputs) {
                for (const output of outputs) for (const channel of output) channel.fill(0);
                const input = inputs[0] || [], frames = outputs[0]?.[0]?.length || 128;
                if (this.previousRenderEnd !== undefined && currentFrame !== this.previousRenderEnd) this.renderFrameDiscontinuities++;
                this.previousRenderEnd = currentFrame + frames; this.renderedQuanta++;
                for (let frame = 0; frame < frames; frame++) {
                  const left = input[0]?.[frame] ?? 0, right = input[1]?.[frame] ?? left;
                  const finite = Number.isFinite(left) && Number.isFinite(right);
                  const peak = finite ? Math.max(Math.abs(left), Math.abs(right)) : Infinity;
                  this.windowNonFinite += finite ? 0 : 1;
                  this.windowPeak = Math.max(this.windowPeak, peak);
                  this.windowEnergy += finite ? (left * left + right * right) * .5 : 0;
                  this.zeroRun = peak === 0 ? this.zeroRun + 1 : 0;
                  this.lowRun = peak < 1e-7 ? this.lowRun + 1 : 0;
                  this.longestZeroRun = Math.max(this.longestZeroRun, this.zeroRun);
                  this.longestLowRun = Math.max(this.longestLowRun, this.lowRun);
                  this.windowLongestLowRun = Math.max(this.windowLongestLowRun, this.lowRun);
                  this.raw[this.windowFrames * 2] = left; this.raw[this.windowFrames * 2 + 1] = right;
                  this.windowFrames++; this.totalFrames++;
                  if (this.windowFrames === this.capacity) {
                    const packet = { sequence: this.sequence++, rate: sampleRate, frames: this.windowFrames,
                      endFrame: currentFrame + frame + 1, totalFrames: this.totalFrames,
                      renderedQuanta: this.renderedQuanta, renderFrameDiscontinuities: this.renderFrameDiscontinuities,
                      peak: this.windowPeak, rms: Math.sqrt(this.windowEnergy / this.windowFrames),
                      nonFinite: this.windowNonFinite, longestZeroRun: this.longestZeroRun,
                      longestLowRun: this.longestLowRun, windowLongestLowRun: this.windowLongestLowRun };
                    // Retain representative actual50ms PCM and every suspect window.
                    // The silence-run counters examine every sample, across windows.
                    if (packet.sequence % 100 === 0 || this.windowLongestLowRun > sampleRate * .015) {
                      packet.samples = this.raw; this.port.postMessage(packet, [this.raw.buffer]);
                      this.raw = new Float32Array(this.capacity * 2);
                    } else this.port.postMessage(packet);
                    this.windowFrames = this.windowEnergy = this.windowPeak = this.windowNonFinite = this.windowLongestLowRun = 0;
                  }
                }
                return true;
              }
            });`;
            const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
            try { await this.context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
            const probe = new NativeNode(this.context, 'morphazoid-qa-pcm', { outputChannelCount: [1] });
            qa.pcmWindows = []; qa.pcmStatuses = []; qa.pcmRecording = false;
            probe.port.onmessage = ({ data }) => {
              if (data.reset) { qa.probeResetAck?.(); return; }
              if (data.flushed) { qa.probeFlushAck?.(data); return; }
              if (qa.pcmRecording) qa.pcmWindows.push({ ...data, receivedAt: performance.now(),
                samples: data.samples ? Array.from(data.samples) : undefined });
            };
            this.connect(probe).connect(this.context.destination); qa.pcmProbe = probe;
          })();
        }
      }
    };
    const create = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const source = create.apply(this, args), record = { starts: 0, stops: 0 };
      const start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { record.starts++; return start(...args); };
      source.stop = (...args) => { record.stops++; return stop(...args); };
      qa.sources.push(record); return source;
    };
    const capture = fakeMicrophone ? async () => {
      const inputContext = new NativeContext(), destination = inputContext.createMediaStreamDestination();
      const oscillator = inputContext.createOscillator(), gain = inputContext.createGain();
      oscillator.frequency.value = 173; gain.gain.value = .03;
      oscillator.connect(gain).connect(destination); oscillator.start(); await inputContext.resume();
      let noise;
      if (broadbandInput) {
        const buffer = inputContext.createBuffer(1, inputContext.sampleRate * 2, inputContext.sampleRate);
        const samples = buffer.getChannelData(0); let seed = 0x5eed1234;
        for (let i = 0; i < samples.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; samples[i] = seed / 2147483648 - 1; }
        noise = inputContext.createBufferSource(); noise.buffer = buffer; noise.loop = true;
        const noiseGain = inputContext.createGain(); noiseGain.gain.value = .03; gain.gain.value = 0;
        noise.connect(noiseGain).connect(destination); noise.start();
        qa.syntheticInput = { context: inputContext, toneGain: gain, noiseGain };
      }
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          if (track.readyState === 'ended') return stop();
          stop(); oscillator.stop(); noise?.stop(); void inputContext.close();
        };
      }
      return destination.stream;
    } : navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => { qa.microphoneRequests++; return capture(...args); };
  }, { voiceBudget, fakeMicrophone, fixedDrawingWorkMs, observePcm, inspectControls, broadbandInput });
  await page.route('**/src/instruments/micmic/native/app.js', async route => {
    const response = await route.fetch();
    let source = await response.text();
    const costUpdate = 'visualCostMs += (cost - visualCostMs) * .15;';
    if (fixedDrawingWorkMs > 0) {
      const measurement = 'const cost = Math.max(0, performance.now() - drawStarted);';
      expect(source.split(measurement).length - 1).toBe(1);
      source = source.replace(measurement, `if (state.audio) {
        const fixedWorkStarted = performance.now();
        while (performance.now() - fixedWorkStarted < __deviceRuntime.fixedDrawingWorkMs) {}
      }
      ` + measurement);
    }
    expect(source.split(costUpdate).length - 1).toBe(1);
    await route.fulfill({ response, body: source.replace(costUpdate, costUpdate + ' captureQaDraw(branches, cost, now);') + `
const qaIds = new WeakMap(); let qaSequence = 0;
const qaId = value => {
  if (!value) return null;
  if (!qaIds.has(value)) qaIds.set(value, ++qaSequence);
  return qaIds.get(value);
};
function captureQaDraw(branches, cost, renderedAt) {
  const nodes = geometry.nodes, limit = Math.max(0, Number(state.status.voiceLimit) || 0);
  const activeVoiceIndices = Array.from(state.status.activeVoiceIndices ?? []), active = new Set(activeVoiceIndices);
  const activeRevisionMatches = state.status.topologyRevision === visualRevision;
  const expected = nodes.filter(node => !state.audio || node.generation === 0
    || previewParameters.depth > 0 && activeRevisionMatches && active.has(node.voiceIndex));
  const actualIds = branches.map(node => node.id), expectedIds = expected.map(node => node.id);
  const actual = new Set(actualIds), wanted = new Set(expectedIds), d = browserEngine.getDiagnostics();
  const previous = __deviceRuntime.lastDraw;
  const frame = { now: performance.now(), renderedAt, drawGapMs: previous?.audio && state.audio ? renderedAt - previous.renderedAt : 0,
    audio: state.audio, reducedMotion,
    geometryIdentity: qaId(geometry), geometryNodes: nodes.length, preparedNodes: d.preparedNodes,
    installedRevision: visualRevision, topologyRevision: d.topologyRevision, moving: nativePreviewMoving,
    drawCount: actualIds.length, admittedCount: nodes.filter(node => node.generation > 0 && Number.isInteger(node.priority) && node.priority >= 0 && node.priority < limit && node.gain > 0).length,
    activeVoices: state.status.activeVoices, activeVoiceCount: activeVoiceIndices.length,
    activeVoiceTelemetry: Array.isArray(state.status.activeVoiceIndices),
    activeVoiceDuplicateCount: activeVoiceIndices.length - active.size,
    invalidActiveVoiceCount: activeVoiceIndices.filter(index => !Number.isSafeInteger(index) || index < 0).length,
    activeIntersectionCount: expected.filter(node => node.generation > 0).length,
    rootCount: expected.filter(node => node.generation === 0).length, depth: previewParameters.depth,
    statusRevision: state.status.topologyRevision, activeRevisionMatches,
    inactiveMeterCount: nodes.filter(node => node.generation > 0 && !active.has(node.voiceIndex)
      && (tapLevels.get(node.voiceIndex) ?? 0) > 0).length,
    missing: expectedIds.filter(id => !actual.has(id)), extra: actualIds.filter(id => !wanted.has(id)),
    duplicateCount: actualIds.length - actual.size, fit: { ...geometry.fit }, desiredFit: { ...geometry.desiredFit },
    fps: visualBudget(state.status.cpuLoad, state.status.peakLoad, false, state.audio, visualCostMs).fps,
    workMs: cost, gpuNodes: gpuRenderer?.available ? gpuRenderer.stats.nodeCount : null,
    historyFresh: state.audio && Boolean(inputTelemetry.reader) && performance.now() - inputTelemetry.receivedAt < 2000,
    voiceLimit: limit, cpu: state.status.cpuLoad, peakLoad: state.status.peakLoad };
  // Keep the history bounded without losing evidence of an early transient
  // error in a long session. Every actual draw contributes to this audit.
  const violation = frame.missing.length || frame.extra.length || frame.duplicateCount
    || frame.installedRevision === frame.topologyRevision && frame.geometryNodes !== frame.preparedNodes
    || frame.gpuNodes !== null && frame.gpuNodes !== frame.drawCount
    || frame.audio && (!frame.activeVoiceTelemetry || frame.activeVoiceCount !== frame.activeVoices
      || frame.activeVoiceDuplicateCount || frame.invalidActiveVoiceCount
      || frame.drawCount !== frame.activeIntersectionCount + frame.rootCount
      || frame.drawCount > frame.activeVoices + frame.rootCount
      || (frame.depth === 0 || !frame.activeRevisionMatches) && frame.drawCount !== frame.rootCount);
  frame.totalAuditedDraws = __deviceRuntime.totalAuditedDraws = (__deviceRuntime.totalAuditedDraws ?? 0) + 1;
  frame.totalDrawViolations = __deviceRuntime.totalDrawViolations = (__deviceRuntime.totalDrawViolations ?? 0) + Number(Boolean(violation));
  if (violation && !__deviceRuntime.firstDrawViolation) __deviceRuntime.firstDrawViolation = frame;
  __deviceRuntime.lastDraw = { ...frame, actualIds, expectedIds, activeVoiceIndices,
    firstDrawViolation: __deviceRuntime.firstDrawViolation ?? null };
  if (__deviceRuntime.recording) {
    __deviceRuntime.frames.push(frame);
    if (__deviceRuntime.frames.length > 512) __deviceRuntime.frames.shift();
  }
}
window.__deviceQa = {
  engine: browserEngine, applyScene, presetBank: () => structuredClone(presets),
  timeFoldSlider: sliderFromTimeFold,
  liveState: () => ({ parameters: structuredClone(state.parameters), performance: structuredClone(state.performance) }),
  scene: () => captureScene(state.parameters, state.performance),
  record: () => { __deviceRuntime.frames = []; __deviceRuntime.recording = true; },
  frames: () => structuredClone(__deviceRuntime.frames ?? []),
  lastDraw: () => structuredClone(__deviceRuntime.lastDraw ?? null),
  prepared: async () => {
    const reply = await browserEngine.request('/api/preview');
    const nodes = reply.visualNodes ?? nativePreviewNodes(reply.nodes);
    return { revision: reply.topologyRevision, ids: nodes.map(node => node.id).sort(),
      parameters: structuredClone(reply.parameters), preparedVoices: reply.preparedVoices };
  },
  view: () => {
    const nodes = geometry?.nodes ?? [], ids = new Set(nodes.map(node => node.id));
    return { parameters: structuredClone(state.parameters), installed: structuredClone(previewParameters),
      revision: visualRevision, ids: [...ids].sort(), nodes: nodes.length, maps: geometry?.byId.size ?? 0,
      waves: geometry?.waves.size ?? 0, roots: nodes.filter(node => node.generation === 0).length,
      connected: nodes.every(node => !node.parentId || ids.has(node.parentId)),
      gpu: gpuRenderer?.available ? gpuRenderer.stats : null, geometryIdentity: qaId(geometry),
      fit: geometry ? { ...geometry.fit } : null, desiredFit: geometry ? { ...geometry.desiredFit } : null,
      moving: nativePreviewMoving, reducedMotion };
  },
  positions: () => (geometry?.nodes ?? []).map(node => ({ id: node.id, object: qaId(node),
    wave: qaId(geometry.waves.get(node.id)), x: node.x, y: node.y, startX: node.startX, startY: node.startY,
    generation: node.generation, gain: node.gain })),
};
` });
  });
  return { errors, failures };
}

async function ready(page, renderer = 'webgl2') {
  await page.goto(`/l-mic-rust.html${renderer ? `?renderer=${renderer}` : ''}`);
  await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 60000 });
  await page.waitForFunction(() => window.__deviceQa?.engine.getDiagnostics().initialized && __deviceQa.view().nodes > 0);
}
const diagnostics = page => page.evaluate(() => __deviceQa.engine.getDiagnostics());
const view = page => page.evaluate(() => __deviceQa.view());
const session = page => page.evaluate(() => ({ time: __deviceQa.engine.getSampleTime(),
  contextClock: __deviceRuntime.contexts.at(-1)?.currentTime, contextState: __deviceRuntime.contexts.at(-1)?.state,
  contexts: __deviceRuntime.contexts.length,
  worklets: __deviceRuntime.worklets.length, sources: structuredClone(__deviceRuntime.sources), microphoneRequests: __deviceRuntime.microphoneRequests }));
async function native(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function pcm(page) {
  return page.evaluate(() => {
    const monitor = __deviceRuntime.worklets.at(-1);
    if (!monitor) return { peak: 0, finite: true };
    monitor.analyser.getFloatTimeDomainData(monitor.samples);
    return { peak: Math.max(...monitor.samples.map(Math.abs)), finite: monitor.samples.every(Number.isFinite) };
  });
}
async function flushPcm(page) {
  return page.evaluate(async () => {
    const qa = __deviceRuntime;
    // MessagePort preserves order: this acknowledgement follows every full
    // PCM packet produced before the flush, without a guessed drain delay.
    const flushed = await new Promise(resolve => {
      qa.probeFlushAck = resolve; qa.pcmProbe.port.postMessage('flush');
    });
    qa.pcmRecording = false; qa.probeFlushAck = null;
    return qa.pcmFlush = { ...flushed, receivedAt: performance.now(),
      contextClock: qa.contexts.at(-1)?.currentTime, contextState: qa.contexts.at(-1)?.state,
      sampleClock: __deviceQa.engine.getSampleTime() };
  });
}
async function startPcm(page) {
  await page.evaluate(() => __deviceRuntime.probeReady);
  await page.evaluate(async () => {
    const qa = __deviceRuntime; qa.pcmRecording = false;
    await new Promise(resolve => { qa.probeResetAck = resolve; qa.pcmProbe.port.postMessage('reset'); });
    qa.pcmWindows = []; qa.pcmStatuses = []; qa.pcmRecording = true;
    qa.pcmStart = { wallClock: performance.now(), contextClock: qa.contexts.at(-1)?.currentTime,
      contextState: qa.contexts.at(-1)?.state, sampleClock: __deviceQa.engine.getSampleTime() };
    __deviceQa.record();
  });
}
const controlCounts = page => page.evaluate(() => {
  const messages = __deviceRuntime.controls;
  return { worker: messages.filter(m => m.kind === 'worker').length,
    install: messages.filter(m => m.kind === 'audio' && m.type === 'install').length,
    depth: messages.filter(m => m.kind === 'audio' && m.type === 'depth').length,
    performance: messages.filter(m => m.kind === 'audio' && m.type === 'performance').length };
});
async function settledControls(page) {
  await expect.poll(() => page.evaluate(() => {
    const d = __deviceQa.engine.getDiagnostics(), s = __deviceQa.liveState();
    return JSON.stringify(d.parameters) === JSON.stringify(s.parameters)
      && JSON.stringify(d.performance) === JSON.stringify(s.performance)
      && __deviceRuntime.controls.every(m => m.kind === 'worker' ? m.ackAt !== undefined : m.deliveredAt !== undefined);
  }), { timeout: 30000 }).toBe(true);
}
async function takeKnob(page, id) {
  const input = page.locator(`#${id}`);
  const disclosureId = await input.evaluate(input => input.closest('details')?.id);
  if (disclosureId) {
    const disclosure = page.locator(`#${disclosureId}`);
    if (await disclosure.getAttribute('open') === null) await disclosure.locator(':scope > summary').click();
  }
  await input.scrollIntoViewIfNeeded(); await expect(input).toBeVisible();
  await expect(input).toBeEnabled(); const box = await input.boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(await input.evaluate((input, point) => document.elementFromPoint(point.x, point.y) === input, point)).toBe(true);
  await page.mouse.move(point.x, point.y); await page.mouse.down(); return point;
}
async function pcmEvidence(page) {
  const flush = await flushPcm(page);
  return page.evaluate(flush => ({ flush, start: __deviceRuntime.pcmStart,
    packets: __deviceRuntime.pcmWindows, statuses: __deviceRuntime.pcmStatuses,
    frames: __deviceQa.frames(), controls: structuredClone(__deviceRuntime.controls),
    sampleClock: __deviceQa.engine.getSampleTime(), contextClock: __deviceRuntime.contexts.at(-1)?.currentTime,
    contextState: __deviceRuntime.contexts.at(-1)?.state }), flush);
}
function continuousGeneratedPcm(evidence, { broadband = true } = {}) {
  const { flush, start, packets, frames } = evidence;
  expect(flush.contextState).toBe('running'); expect(flush.renderFrameDiscontinuities).toBe(0);
  expect(flush.renderedQuanta * 128).toBe(flush.totalFrames);
  expect(packets.length).toBeGreaterThan(20);
  expect(flush.totalFrames - packets.at(-1).totalFrames).toBe(flush.partialFrames);
  expect(flush.totalFrames / flush.rate).toBeGreaterThan((flush.receivedAt - start.wallClock) / 1000 * .8);
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i]; expect(p.nonFinite).toBe(0); expect(p.peak).toBeLessThanOrEqual(1);
    expect(p.renderFrameDiscontinuities).toBe(0);
    if (i > 0) { expect(p.sequence).toBe(packets[i - 1].sequence + 1); expect(p.endFrame).toBe(packets[i - 1].endFrame + p.frames); }
    if (broadband) { expect(p.longestZeroRun / p.rate).toBeLessThan(.04); expect(p.longestLowRun / p.rate).toBeLessThan(.04); }
  }
  frames.forEach(correctDraw);
}
async function live(page) {
  await expect.poll(async () => {
    const d = await diagnostics(page), samples = await pcm(page);
    return d.audio && d.input.playing && d.performance.dry === 0 && samples.finite && samples.peak > 1e-5 && samples.peak <= 1;
  }, { timeout: 30000 }).toBe(true);
}
async function builtInInput(page, audible = true) {
  await native(page, 'source', 'samples'); await native(page, 'inputSample', 'music-keys');
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.input.mode === 'samples' && d.input.sampleId === 'music-keys' && !d.input.pending;
  }, { timeout: 30000 }).toBe(true);
  await native(page, 'wet', .65); await native(page, 'dry', 0);
  await native(page, 'inputTrim', .7); await native(page, 'level', .6); await native(page, 'makeupDb', 4);
  await page.locator('#audioButton').click(); if (audible) await live(page);
}
function denseScene(scene, kind = 'classic') {
  const { lab, ...classic } = scene.parameters;
  const parameters = kind === 'classic' ? { ...classic, lSystemType: 'pythagorean', generations: 52, intervalMs: 30, timeRatio: .8, depth: .85 }
    : { ...classic, generations: 24, intervalMs: 30, timeRatio: .8, depth: .85,
      lab: { kind, iterations: 24, lengthRatio: 1, branchCount: 6, minLength: .001 } };
  return { ...scene, parameters, performance: { ...scene.performance, wet: .65, dry: 0 } };
}
async function applyDense(page, kind, { depth } = {}) {
  const scene = denseScene(await page.evaluate(() => __deviceQa.scene()), kind);
  if (Number.isFinite(depth)) scene.parameters.depth = depth;
  await page.evaluate(scene => __deviceQa.applyScene(scene), scene);
  await expect(page.locator('#generations')).toBeEnabled({ timeout: 30000 });
  await expect.poll(async () => {
    const d = await diagnostics(page), v = await view(page);
    return d.parameters.generations === scene.parameters.generations && v.parameters.generations === scene.parameters.generations
      && d.parameters.depth === scene.parameters.depth
      && v.nodes > 0 && (kind === 'classic' ? !d.parameters.lab : d.parameters.lab?.kind === kind);
  }, { timeout: 30000 }).toBe(true);
  return scene;
}
async function fullTree(page) {
  const snapshot = await page.evaluate(async () => ({ prepared: await __deviceQa.prepared(), view: __deviceQa.view() }));
  const { prepared, view: v } = snapshot;
  expect(v.reducedMotion).toBe(false);
  if (prepared.revision !== v.revision || v.moving || v.nodes === 0) return false;
  expect(v.ids).toEqual(prepared.ids); expect(v.maps).toBe(v.nodes);
  expect(v.roots).toBe(1); expect(v.connected).toBe(true);
  return true;
}
function correctDraw(frame) {
  expect(frame.reducedMotion).toBe(false);
  expect(frame.totalDrawViolations, JSON.stringify(frame.firstDrawViolation ?? null)).toBe(0);
  expect(frame.missing).toEqual([]); expect(frame.extra).toEqual([]); expect(frame.duplicateCount).toBe(0);
  if (frame.installedRevision === frame.topologyRevision) expect(frame.geometryNodes).toBe(frame.preparedNodes);
  if (frame.gpuNodes !== null) expect(frame.gpuNodes).toBe(frame.drawCount);
  if (frame.audio) {
    expect(frame.activeVoiceTelemetry).toBe(true);
    expect(frame.activeVoiceCount).toBe(frame.activeVoices);
    expect(frame.activeVoiceDuplicateCount).toBe(0); expect(frame.invalidActiveVoiceCount).toBe(0);
    expect(frame.drawCount).toBe(frame.activeIntersectionCount + frame.rootCount);
    expect(frame.drawCount).toBeLessThanOrEqual(frame.activeVoices + frame.rootCount);
    if (frame.depth === 0 || !frame.activeRevisionMatches) expect(frame.drawCount).toBe(frame.rootCount);
  }
}
async function completeDraw(page) {
  await expect.poll(() => fullTree(page), { timeout: 30000 }).toBe(true);
  await expect.poll(async () => {
    const frame = await page.evaluate(() => __deviceQa.lastDraw());
    if (!frame?.audio) return false;
    correctDraw(frame); expect([...frame.actualIds].sort()).toEqual([...frame.expectedIds].sort());
    return true;
  }, { timeout: 30000 }).toBe(true);
}
function sameCamera(actual, expected) {
  for (const key of ['scale', 'x', 'y']) expect(actual[key], `camera ${key}`).toBeCloseTo(expected[key], 10);
}
async function settledCamera(page) {
  await expect.poll(async () => {
    const v = await view(page); return !v.moving && JSON.stringify(v.fit) === JSON.stringify(v.desiredFit);
  }, { timeout: 30000 }).toBe(true);
}
async function cleanup(page, evidence) {
  if ((await diagnostics(page)).audio) await page.locator('#audioButton').click();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  expect((await diagnostics(page)).disposed).toBe(true);
  expect(evidence.errors).toEqual([]); expect(evidence.failures).toEqual([]);
}

test('real cold Rust calibration prepares a bounded complete tree without arming Audio or capturing a device', async ({ page }) => {
  test.setTimeout(120000);
  const evidence = await fixture(page); await ready(page);
  const calibration = (await diagnostics(page)).deviceCapacity;
  expect(calibration.elapsedMs).toBeGreaterThan(0); expect(calibration.measurements.length).toBeGreaterThan(0);
  expect(calibration.measurements.every(row => row.voices > 0 && row.load > 0 && Number.isFinite(row.load))).toBe(true);
  for (const kind of ['classic', 'parametric']) {
    await applyDense(page, kind); await expect.poll(() => fullTree(page)).toBe(true);
    const d = await diagnostics(page), v = await view(page);
    expect(d.preparedVoices).toBeLessThanOrEqual(d.deviceCapacity.preparedCapacity);
    expect(v.nodes).toBe(d.preparedNodes); expect(v.nodes).toBeLessThanOrEqual(d.deviceCapacity.preparedCapacity + 1);
    expect(d.requestedVoices).toBeGreaterThan(d.preparedVoices);
    expect(d.audio).toBe(false); expect(d.audioDesired).toBe(false);
    expect(await session(page)).toMatchObject({ contexts: 0, worklets: 0, microphoneRequests: 0, sources: [] });
  }
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect.poll(() => fullTree(page)).toBe(true);
  }
  await cleanup(page, evidence);
});

test('explicit slow and fast preparation budgets bound actual Rust compilation before main-thread cloning', async ({ browser }) => {
  test.setTimeout(120000);
  const counts = [];
  for (const budget of [32, 256]) {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL,
      viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    const page = await context.newPage(), evidence = await fixture(page, { voiceBudget: budget });
    await ready(page); await applyDense(page, 'parametric'); await expect.poll(() => fullTree(page)).toBe(true);
    const d = await diagnostics(page), v = await view(page);
    expect(d.deviceCapacity.voices).toBe(budget); expect(d.deviceCapacity.preparedCapacity).toBe(budget);
    const rows = await page.evaluate(() => __deviceRuntime.compilations);
    for (const row of rows) {
      expect(row.nodes).toBeLessThanOrEqual(budget + 1); expect(row.preparedVoices).toBeLessThanOrEqual(budget);
      expect(row.calibration.measurements.length).toBeGreaterThan(0);
    }
    expect(v.nodes).toBe(rows.at(-1).nodes);
    counts.push({ budget, prepared: d.preparedVoices, nodes: v.nodes });
    await cleanup(page, evidence); await context.close();
  }
  expect(counts[1].prepared).toBeGreaterThan(counts[0].prepared);
  await test.info().attach('explicit-preparation-budgets', { body: JSON.stringify(counts), contentType: 'application/json' });
});

test('dense rule-family switches preserve exactly active animated branches, real wet audio and one source', async ({ page }) => {
  test.setTimeout(180000);
  const evidence = await fixture(page); await ready(page); await builtInInput(page);
  const initial = await session(page), rows = [];
  await page.evaluate(() => __deviceQa.record());
  for (const kind of ['classic', 'parametric', 'penrose', 'sphinx', 'parametric', 'classic']) {
    await applyDense(page, kind); await live(page); await completeDraw(page);
    const d = await diagnostics(page), v = await view(page), current = await session(page), samples = await pcm(page);
    expect(d.performance.inputGain).toBe(.7); expect(d.performance.level).toBe(.6); expect(d.performance.mastering.makeupDb).toBe(4);
    expect(current.contexts).toBe(initial.contexts); expect(current.worklets).toBe(initial.worklets);
    expect(current.sources).toEqual(initial.sources); expect(current.microphoneRequests).toBe(0);
    rows.push({ kind, prepared: d.preparedVoices, geometry: v.nodes, draw: await page.evaluate(() => __deviceQa.lastDraw()), pcm: samples });
  }
  const frames = await page.evaluate(() => __deviceQa.frames()); frames.forEach(correctDraw);
  await test.info().attach('animated-dense-family-switches', { body: JSON.stringify({ rows, frames,
    actualWasm: true, forcedAudioBudget: false, actualBundledInput: true, humanListening: false }), contentType: 'application/json' });
  await cleanup(page, evidence);
});

for (const renderer of [null, 'canvas', 'webgl2']) test(`hard refresh and factory browsing draw exactly the active Rust microphone branches with ${renderer ?? 'automatic renderer'}`, async ({ page }) => {
  test.setTimeout(240000);
  const evidence = await fixture(page, { fakeMicrophone: true }), rows = [];
  for (const bias of [0, -1, 1]) {
    await ready(page, renderer);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
    const bank = await page.evaluate(() => __deviceQa.presetBank());
    const ids = ['spruce-cutting', 'coral',
      ...['parametric', 'penrose', 'sphinx'].map(kind => bank.find(p => p.snapshot.parameters.lab?.kind === kind).id), 'pythagorean'];
    for (const id of ids) {
      const picker = page.locator('.instrument-preset-controls');
      await picker.locator('summary').click();
      await picker.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
      await expect(picker).toHaveAttribute('data-preset-id', id);
      await expect(page.locator('#generations')).toBeEnabled({ timeout: 30000 });
      await expect.poll(() => fullTree(page), { timeout: 30000 }).toBe(true);
    }
    await native(page, 'pruningBias', bias);
    await expect.poll(async () => (await diagnostics(page)).parameters.pruningBias).toBe(bias);
    await expect.poll(() => fullTree(page), { timeout: 30000 }).toBe(true);
    if (bias === -1) {
      await page.locator('#micButton').click();
      await expect.poll(async () => (await diagnostics(page)).microphoneEnabled).toBe(true);
      expect((await diagnostics(page)).audio).toBe(false);
    }
    await page.evaluate(() => __deviceQa.record());
    await page.locator('#audioButton').click();
    await expect.poll(async () => {
      const d = await diagnostics(page), samples = await pcm(page);
      return d.audio && d.microphoneEnabled && d.status.targetVoices > 1 && samples.finite && samples.peak > 1e-5;
    }, { timeout: 30000 }).toBe(true);
    const initial = await session(page);
    await completeDraw(page); await page.waitForTimeout(3000); await completeDraw(page);
    const frames = await page.evaluate(() => __deviceQa.frames());
    expect(frames.filter(frame => frame.audio).length).toBeGreaterThan(2); frames.forEach(correctDraw);
    const current = await session(page), samples = await pcm(page);
    expect(samples.finite).toBe(true); expect(samples.peak).toBeGreaterThan(1e-5); expect(samples.peak).toBeLessThanOrEqual(1);
    expect(current.contexts).toBe(initial.contexts); expect(current.worklets).toBe(initial.worklets);
    expect(current.microphoneRequests).toBe(initial.microphoneRequests); expect(current.time).toBeGreaterThan(initial.time);
    rows.push({ bias, renderer: renderer ?? 'auto', prepared: await page.evaluate(() => __deviceQa.prepared()),
      view: await view(page), draw: await page.evaluate(() => __deviceQa.lastDraw()), frames, pcm: samples });
    await page.locator('#audioButton').click();
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  }
  expect(evidence.errors).toEqual([]); expect(evidence.failures).toEqual([]);
  await test.info().attach('normal-motion-microphone-startup', { body: JSON.stringify({ rows,
    actualWasm: true, actualMediaStreamInput: true, forcedAudioBudget: false, fakeAudioMetrics: false, humanListening: false }), contentType: 'application/json' });
});

async function fittingScene(page, depth = .85) {
  const d = await diagnostics(page), scene = await page.evaluate(() => __deviceQa.scene());
  const { lab, ...classic } = scene.parameters;
  let generations = 1;
  while (generations < 12 && 2 ** (generations + 2) - 2 <= d.deviceCapacity.voices) generations++;
  await page.evaluate(scene => __deviceQa.applyScene(scene), { ...scene,
    parameters: { ...classic, lSystemType: 'pythagorean', generations, intervalMs: 420, timeRatio: .85, depth } });
  await expect(page.locator('#generations')).toBeEnabled({ timeout: 30000 });
  await expect.poll(() => fullTree(page), { timeout: 30000 }).toBe(true);
  expect((await diagnostics(page)).requestedVoices).toBeLessThanOrEqual(d.deviceCapacity.voices);
}

for (const renderer of ['canvas', 'webgl2']) test(`normal branch waves retain full membership and camera under real drawing and RAF pressure with ${renderer}`, async ({ page }) => {
  test.setTimeout(120000);
  const evidence = await fixture(page, { fixedDrawingWorkMs: 6 }); await ready(page, renderer);
  await fittingScene(page); await builtInInput(page); await completeDraw(page); await settledCamera(page);
  const baseline = await view(page), initial = await session(page);
  await page.evaluate(() => {
    __deviceQa.record(); __deviceRuntime.externalMainWork = true;
    const busy = () => {
      if (!__deviceRuntime.externalMainWork) return;
      const started = performance.now(); while (performance.now() - started < 22) {}
      __deviceRuntime.externalMainFrame = requestAnimationFrame(busy);
    };
    __deviceRuntime.externalMainFrame = requestAnimationFrame(busy);
  });
  const rows = [], started = Date.now();
  try {
    while (Date.now() - started < 8000) {
      await live(page); await completeDraw(page);
      const v = await view(page), frame = await page.evaluate(() => __deviceQa.lastDraw());
      expect(v.ids).toEqual(baseline.ids); expect(v.geometryIdentity).toBe(baseline.geometryIdentity);
      sameCamera(v.fit, baseline.fit); sameCamera(v.desiredFit, baseline.desiredFit);
      rows.push({ time: (Date.now() - started) / 1000, frame, pcm: await pcm(page) });
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => { __deviceRuntime.externalMainWork = false; cancelAnimationFrame(__deviceRuntime.externalMainFrame); });
    await expect.poll(async () => (await page.evaluate(() => __deviceQa.lastDraw())).activeVoices, { timeout: 30000 }).toBeGreaterThan(1);
    const beforeRetirement = await page.evaluate(() => __deviceQa.lastDraw());
    const userVoiceCap = Math.max(1, Math.min(8, Math.floor(beforeRetirement.activeVoices / 2)));
    await native(page, 'voiceCeiling', userVoiceCap);
    await expect.poll(async () => {
      const d = await diagnostics(page), frame = await page.evaluate(() => __deviceQa.lastDraw());
      return d.performance.voiceCeiling === userVoiceCap && frame?.audio
        && frame.voiceLimit <= userVoiceCap && frame.activeVoices <= userVoiceCap;
    }, { timeout: 30000 }).toBe(true);
    const retired = await page.evaluate(() => __deviceQa.lastDraw()); correctDraw(retired);
    const remaining = new Set(retired.activeVoiceIndices);
    const retiredIndices = beforeRetirement.activeVoiceIndices.filter(index => !remaining.has(index));
    expect(retiredIndices.length).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    const frames = await page.evaluate(() => __deviceQa.frames()); frames.forEach(correctDraw);
    const postRetirementFrames = frames.filter(frame => frame.audio && frame.now >= retired.now);
    expect(postRetirementFrames.length).toBeGreaterThan(2);
    for (const frame of postRetirementFrames) expect(frame.activeVoices).toBeLessThanOrEqual(userVoiceCap);
    for (const frame of frames) { expect(frame.geometryIdentity).toBe(baseline.geometryIdentity); sameCamera(frame.fit, baseline.fit); }
    expect(frames.some(frame => frame.audio && frame.workMs >= 6 && frame.fps < 30)).toBe(true);
    expect(frames.some(frame => frame.historyFresh && !frame.reducedMotion)).toBe(true);
    const current = await session(page);
    expect(current.contexts).toBe(initial.contexts); expect(current.worklets).toBe(initial.worklets);
    expect(current.sources).toEqual(initial.sources); expect(current.time).toBeGreaterThan(initial.time);
    await test.info().attach('actual-wave-work-and-callback-pressure', { body: JSON.stringify({ renderer, rows, frames,
      beforeRetirement, retired, retiredIndices, userVoiceCap,
      fixedRealDrawingWorkMs: 6, unrelatedMainWorkMs: 22, actualWasm: true, forcedAudioBudget: false,
      fakeAudioMetrics: false, humanListening: false }), contentType: 'application/json' });
  } finally {
    await page.evaluate(() => { __deviceRuntime.externalMainWork = false; cancelAnimationFrame(__deviceRuntime.externalMainFrame); });
  }
  await cleanup(page, evidence);
});

for (const renderer of ['canvas', 'webgl2']) test(`a zero-depth compilation restores all positive-depth branches without recompiling or moving the camera with ${renderer}`, async ({ page }) => {
  test.setTimeout(90000);
  const evidence = await fixture(page); await ready(page, renderer); await fittingScene(page, 0);
  // Wet-only silence is expected at zero depth; the real loop still starts.
  await builtInInput(page, false);
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.audio && d.input.playing && d.parameters.depth === 0;
  }).toBe(true);
  await settledCamera(page);
  const before = await diagnostics(page), baseline = await view(page), initial = await session(page);
  expect((await page.evaluate(() => __deviceQa.positions())).filter(n => n.generation > 0).every(n => n.gain === 0)).toBe(true);
  await page.evaluate(() => __deviceQa.record()); await native(page, 'depth', .85);
  await expect.poll(async () => (await diagnostics(page)).parameters.depth).toBe(.85);
  await completeDraw(page); await live(page);
  const after = await diagnostics(page), v = await view(page), positions = await page.evaluate(() => __deviceQa.positions());
  expect(after.topologyRevision).toBe(before.topologyRevision); expect(v.ids).toEqual(baseline.ids);
  expect(v.geometryIdentity).toBe(baseline.geometryIdentity); sameCamera(v.fit, baseline.fit);
  for (const node of positions) expect(node.gain).toBeCloseTo(node.generation === 0 ? 1 : .5 * .85 ** (node.generation * .72), 12);
  const frame = await page.evaluate(() => __deviceQa.lastDraw()); correctDraw(frame); expect(frame.admittedCount).toBeGreaterThan(1);
  expect((await session(page)).sources).toEqual(initial.sources);
  await cleanup(page, evidence);
});

test('an unforced minute of dense animated real audio retains its complete prepared tree and one source', async ({ page }) => {
  test.setTimeout(180000);
  const evidence = await fixture(page); await ready(page); await applyDense(page, 'classic'); await builtInInput(page);
  await page.evaluate(() => __deviceQa.record());
  const initial = await session(page), parameters = (await diagnostics(page)).parameters, rows = [];
  let previousCapacity = 0, previousPrepared = 0;
  const started = Date.now();
  try {
    while (Date.now() - started < 60000) {
      const d = await diagnostics(page), v = await view(page), current = await session(page), samples = await pcm(page);
      expect(d.parameters).toEqual(parameters); expect(v.parameters).toEqual(parameters);
      expect(d.deviceCapacity.preparedCapacity).toBeGreaterThanOrEqual(previousCapacity);
      expect(d.preparedVoices).toBeGreaterThanOrEqual(previousPrepared);
      expect(d.preparedVoices).toBeLessThanOrEqual(d.deviceCapacity.preparedCapacity);
      expect(v.connected).toBe(true); expect(v.roots).toBe(1);
      if (!v.moving) await fullTree(page);
      const frame = await page.evaluate(() => __deviceQa.lastDraw()); if (frame) correctDraw(frame);
      expect(samples.finite).toBe(true); expect(samples.peak).toBeLessThanOrEqual(1);
      expect(current.contexts).toBe(initial.contexts); expect(current.worklets).toBe(initial.worklets);
      expect(current.sources).toEqual(initial.sources); expect(current.microphoneRequests).toBe(0);
      rows.push({ time: (Date.now() - started) / 1000, sampleClock: current.time, preparedCapacity: d.deviceCapacity.preparedCapacity,
        prepared: d.preparedVoices, voiceLimit: d.status.voiceLimit, nodes: v.nodes, pcm: samples, frame,
        deadlineWarnings: d.status.deadlineMisses, underruns: d.status.underruns, overruns: d.status.overruns });
      previousCapacity = d.deviceCapacity.preparedCapacity; previousPrepared = d.preparedVoices;
      await page.waitForTimeout(500);
    }
    expect((await session(page)).time).toBeGreaterThan(initial.time + 50);
    for (let second = 0; second < 60; second += 10) expect(rows.some(row => row.time >= second && row.time < second + 10 && row.pcm.peak > 1e-5)).toBe(true);
    const frames = await page.evaluate(() => __deviceQa.frames()); frames.forEach(correctDraw);
  } finally {
    await test.info().attach('unforced-normal-motion-minute', { body: JSON.stringify({ parameters, rows,
      frames: await page.evaluate(() => __deviceQa.frames()), actualWasm: true, actualBundledInput: true,
      forcedAudioBudget: false, fakeAudioMetrics: false, humanListening: false }), contentType: 'application/json' });
  }
  await cleanup(page, evidence);
});

for (const renderer of ['canvas', 'webgl2']) test(`continuous PCM windows detect short wet-output silence during a minute of normal-motion live edits with ${renderer}`, async ({ page }) => {
  test.setTimeout(180000);
  const evidence = await fixture(page, { fakeMicrophone: true, observePcm: true });
  await ready(page, renderer); await applyDense(page, 'classic');
  await native(page, 'wet', .65); await native(page, 'dry', 0);
  await native(page, 'inputTrim', .7); await native(page, 'level', .6);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page), samples = await pcm(page);
    return d.audio && d.microphoneEnabled && samples.finite && samples.peak > 1e-5;
  }, { timeout: 30000 }).toBe(true);
  await page.evaluate(() => __deviceRuntime.probeReady); await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    const qa = __deviceRuntime; qa.pcmRecording = false;
    const reset = new Promise(resolve => { qa.probeResetAck = resolve; }); qa.pcmProbe.port.postMessage('reset');
    await reset; qa.pcmWindows = []; qa.pcmStatuses = []; qa.pcmRecording = true;
    qa.pcmStart = { wallClock: performance.now(), contextClock: qa.contexts.at(-1)?.currentTime,
      contextState: qa.contexts.at(-1)?.state, sampleClock: __deviceQa.engine.getSampleTime() };
    __deviceQa.record();
  });
  const initial = await session(page), rows = [], started = Date.now();
  let phase = 0;
  try {
    while (Date.now() - started < 60000) {
      const elapsed = Date.now() - started, nextPhase = Math.min(3, Math.floor(elapsed / 15000));
      if (nextPhase !== phase) {
        phase = nextPhase; await applyDense(page, ['classic', 'parametric', 'penrose', 'sphinx'][phase]);
        await native(page, 'depth', phase % 2 ? .93 : .85);
        await native(page, 'wet', phase % 2 ? .8 : .65);
        await native(page, 'generationPitchScale', phase % 2 ? 1.1 : .4);
      }
      await completeDraw(page);
      const d = await diagnostics(page), current = await session(page);
      expect(d.audio).toBe(true); expect(d.microphoneEnabled).toBe(true); expect(d.performance.dry).toBe(0);
      expect(current.contexts).toBe(initial.contexts); expect(current.worklets).toBe(initial.worklets);
      expect(current.sources).toEqual(initial.sources); expect(current.microphoneRequests).toBe(initial.microphoneRequests);
      rows.push({ time: (Date.now() - started) / 1000, phase, clock: current.time,
        contextClock: current.contextClock, contextState: current.contextState, prepared: d.preparedVoices,
        activeVoices: d.status.activeVoices, voiceLimit: d.status.voiceLimit, cpu: d.status.cpuLoad,
        peakLoad: d.status.peakLoad, deadlineWarnings: d.status.deadlineMisses,
        underruns: d.status.underruns, overruns: d.status.overruns, frame: await page.evaluate(() => __deviceQa.lastDraw()) });
      await page.waitForTimeout(500);
    }
    const flushed = await flushPcm(page);
    const packets = await page.evaluate(() => __deviceRuntime.pcmWindows);
    expect(packets.length).toBeGreaterThan(1000);
    expect(flushed.contextState).toBe('running');
    expect(flushed.totalFrames / flushed.rate).toBeGreaterThan(50);
    expect(flushed.totalFrames - packets.at(-1).totalFrames).toBe(flushed.partialFrames);
    for (const packet of packets) {
      expect(packet.nonFinite).toBe(0); expect(packet.peak).toBeLessThanOrEqual(1);
      // This steady, nonzero input has no intended pauses. Inspect every actual
      // sample across packet boundaries;40ms holes cannot hide between polls.
      expect(packet.longestZeroRun / packet.rate).toBeLessThan(.04);
      expect(packet.longestLowRun / packet.rate).toBeLessThan(.04);
    }
    expect(packets.some(packet => packet.samples?.length > 0)).toBe(true);
    expect((await session(page)).time).toBeGreaterThan(initial.time + 50);
    expect(phase).toBe(3);
    (await page.evaluate(() => __deviceQa.frames())).forEach(correctDraw);
  } finally {
    if (await page.evaluate(() => __deviceRuntime.pcmRecording)) await flushPcm(page);
    const evidenceData = await page.evaluate(() => {
      return { packets: __deviceRuntime.pcmWindows, statuses: __deviceRuntime.pcmStatuses,
        frames: __deviceQa.frames(), pcmStart: __deviceRuntime.pcmStart, pcmFlush: __deviceRuntime.pcmFlush };
    });
    await test.info().attach('continuous-wet-pcm-live-minute', { body: JSON.stringify({ renderer, rows, ...evidenceData,
      actualWasm: true, actualMediaStreamInput: true, input: 'steady173Hz oscillator captured as a real MediaStream',
      silentQaProbe: true, forcedAudioBudget: false, fakeAudioMetrics: false, humanListening: false,
      physicalDeliveryChecked: false }), contentType: 'application/json' });
  }
  await cleanup(page, evidence);
});

for (const renderer of ['canvas', 'webgl2']) test(`dense physical knob releases and UI selections keep one audio source and exact Rust voices with ${renderer}`, async ({ page }) => {
  test.setTimeout(180000);
  const evidence = await fixture(page, { fakeMicrophone: true, broadbandInput: true, observePcm: true, inspectControls: true });
  await ready(page, renderer); await fittingScene(page);
  await native(page, 'wet', .65); await native(page, 'dry', 0);
  await native(page, 'inputTrim', .7); await native(page, 'level', .6);
  await page.locator('#audioButton').click();
  await expect.poll(async () => { const d = await diagnostics(page), p = await pcm(page); return d.audio && d.microphoneEnabled && p.peak > 1e-5; }).toBe(true);
  await page.waitForTimeout(1500); await settledControls(page);
  const initial = await session(page), releases = [], selections = [];
  await startPcm(page);
  for (let round = 0; round < 2; round++) for (const [id, delta] of [
    ['interval', round ? -6 : 60], ['timeRatio', round ? 4 : -4],
    ['depth', round ? -4 : 4], ['wet', round ? 4 : -4], ['generationAngle', round ? 4 : -4],
  ]) {
    await page.evaluate(phase => { __deviceRuntime.phase = phase; }, `knob-${round}-${id}`);
    const beforeValue = await page.locator(`#${id}`).inputValue(), point = await takeKnob(page, id);
    await page.mouse.move(point.x, point.y + delta, { steps: 8 });
    await settledControls(page);
    const value = await page.locator(`#${id}`).inputValue(); expect(value).not.toBe(beforeValue);
    const held = await controlCounts(page);
    if (!round && id === 'interval') {
      const d = await diagnostics(page); expect(d.parameters.intervalMs).toBeGreaterThanOrEqual(.05);
      expect(d.parameters.intervalMs).toBeLessThan(1);
      expect(await page.locator('#intervalOut').textContent()).toMatch(/0\.\d+ ms/);
      expect(await page.locator('#interval').getAttribute('step')).toBe('any');
    }
    await page.mouse.up(); await page.waitForTimeout(180); await settledControls(page);
    const released = await controlCounts(page); expect(released).toEqual(held);
    releases.push({ round, id, beforeValue, value, held, released, session: await session(page) });
  }
  // Delay only receipt of a genuine install ACK; actual Rust processing and
  // measured metrics continue. Returning to the prior value while pending
  // must still install that latest value, rather than treating it as a no-op.
  await page.evaluate(() => { __deviceRuntime.phase = 'pending-reversal'; __deviceRuntime.delayInstallAckMs = 150; });
  const previous = (await diagnostics(page)).parameters.timeRatio, point = await takeKnob(page, 'timeRatio');
  await page.mouse.move(point.x, point.y - 3, { steps: 3 });
  await page.waitForFunction(() => __deviceRuntime.controls.some(m => m.phase === 'pending-reversal' && m.type === 'install' && m.ackAt !== undefined && m.deliveredAt === undefined));
  await page.mouse.move(point.x, point.y, { steps: 3 }); await page.mouse.up();
  await settledControls(page); expect((await diagnostics(page)).parameters.timeRatio).toBe(previous);
  const pending = await page.evaluate(() => structuredClone(__deviceRuntime.controls.filter(m => m.phase === 'pending-reversal')));
  expect(pending.filter(m => m.type === 'install').length).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { __deviceRuntime.delayInstallAckMs = 0; });
  for (const rule of ['coral', 'lab:parametric', 'pythagorean']) {
    await page.evaluate(rule => { __deviceRuntime.phase = `rule-${rule}`; }, rule);
    const index = await page.locator('#lSystemType').evaluate((select, value) => [...select.options].findIndex(o => o.value === value), rule);
    const picker = page.locator('details[data-select-id="lSystemType"]');
    await picker.locator('summary').click(); await picker.locator(`button[data-option-index="${index}"]`).click();
    await expect(page.locator('#lSystemType')).toHaveValue(rule); await settledControls(page); await completeDraw(page);
    selections.push({ rule, session: await session(page), draw: await page.evaluate(() => __deviceQa.lastDraw()) });
  }
  for (const id of ['coral', 'pythagorean']) {
    await page.evaluate(id => { __deviceRuntime.phase = `preset-${id}`; }, id);
    const picker = page.locator('.instrument-preset-controls');
    await picker.locator('summary').click(); await picker.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
    await expect(picker).toHaveAttribute('data-preset-id', id); await expect(page.locator('#generations')).toBeEnabled();
    await native(page, 'dry', 0); await native(page, 'wet', .65); await settledControls(page); await completeDraw(page);
    selections.push({ preset: id, session: await session(page), draw: await page.evaluate(() => __deviceQa.lastDraw()) });
  }
  await page.waitForTimeout(1500);
  const current = await session(page), recording = await pcmEvidence(page); continuousGeneratedPcm(recording);
  expect(current.contexts).toBe(initial.contexts); expect(current.worklets).toBe(initial.worklets);
  expect(current.sources).toEqual(initial.sources); expect(current.microphoneRequests).toBe(initial.microphoneRequests);
  expect((await diagnostics(page)).performance.dry).toBe(0);
  await test.info().attach('physical-knobs-selection-pcm', { body: JSON.stringify({ renderer, releases, pending, selections, initial, current,
    ...recording, input: 'deterministic broadband noise captured as a real MediaStream', actualWasm: true,
    forcedAudioBudget: false, injectedInstallAckDelayMs: 150, fakeAudioMetrics: false,
    humanListening: false, physicalDeliveryChecked: false }), contentType: 'application/json' });
  if (renderer === 'webgl2') {
    const scene = await page.evaluate(() => __deviceQa.scene()), { lab, ...classic } = scene.parameters;
    await page.evaluate(scene => __deviceQa.applyScene(scene), { ...scene,
      parameters: { ...classic, lSystemType: 'pythagorean', generations: 1, intervalMs: 20, timeRatio: 1, pitchScale: 0 },
      performance: { ...scene.performance, wet: .65, dry: 0 } });
    await page.evaluate(() => { const s = __deviceRuntime.syntheticInput, now = s.context.currentTime;
      s.noiseGain.gain.setTargetAtTime(0, now, .005); s.toneGain.gain.setTargetAtTime(.03, now, .005); });
    await page.waitForTimeout(500); await startPcm(page);
    for (const foldMs of [20, 20 + 1000 / (173 * 2), 20, 26, 20]) {
      await page.evaluate(value => { __deviceRuntime.phase = `tone-fold-${value}`; }, foldMs);
      await native(page, 'interval', await page.evaluate(value => __deviceQa.timeFoldSlider(value), foldMs));
      await settledControls(page); await page.waitForTimeout(400);
    }
    const tone = await pcmEvidence(page); continuousGeneratedPcm(tone, { broadband: false });
    await test.info().attach('tonal-fold-amplitude-characterization', { body: JSON.stringify({ ...tone,
      input: 'steady173Hz tone in the same captured MediaStream', halfPeriodMs: 1000 / (173 * 2),
      claim: 'measure amplitude changes separately from scheduled sample continuity; no constant wet-amplitude requirement',
      humanListening: false, physicalDeliveryChecked: false }), contentType: 'application/json' });
  }
  await cleanup(page, evidence);
});

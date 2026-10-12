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

async function fixture(page, { holdContext = false, observeRenderer = false, observeMotion = false, observeImpulse = false, geometryDelay = 0 } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ holdContext, observeRenderer, observeMotion, observeImpulse, geometryDelay }) => {
    const NativeContext = AudioContext, NativeNode = AudioWorkletNode;
    const qa = window.__fractalPcmWitness = { contexts: [], sources: [], nodes: [], packets: [], statuses: [], allStatuses: [],
      streams: [], microphoneRequests: 0, pendingMicrophones: [], holdMicrophone: false, recording: false,
      geometryJobs: [], sceneRequests: [], sceneAcks: [], synthNodes: [], synthNotes: [], links: new Map(), inputPackets: [], holdSynth: false, pendingSynth: [], longTasks: [], repeatPolls: [] };
    if(observeImpulse) {
      new PerformanceObserver(list=>qa.longTasks.push(...list.getEntries().map(({startTime,duration})=>({startTime,duration}))))
        .observe({type:'longtask',buffered:true});
      const interval=window.setInterval;
      window.setInterval=(callback,delay,...args)=>interval.call(window,delay===25?()=>{
        qa.repeatPolls.push({wall:performance.now(),audio:qa.contexts[0]?.currentTime});callback();
      }:callback,delay,...args);
    }
    if (observeMotion || geometryDelay) {
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, ...args) {
          super(url, ...args);
          if (!String(url).includes('/fractal-delay/preflight-worker.js')) return;
          this.geometryDelay = geometryDelay;
          const post = this.postMessage.bind(this);
          this.postMessage = (data, ...rest) => {
            if (data.parameters) qa.geometryJobs.push({ revision: data.revision, at: performance.now(),
              cReal: data.parameters.cReal, cImag: data.parameters.cImag });
            return post(data, ...rest);
          };
        }
        set onmessage(listener) {
          // Simulate preparation slower than incoming pointer events while
          // retaining the production worker, model, Rust DSP and real ACKs.
          super.onmessage = this.geometryDelay && typeof listener === 'function'
            ? event => setTimeout(() => listener.call(this, event), this.geometryDelay) : listener;
        }
        get onmessage() { return super.onmessage; }
      };
    }
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
      if (qa.holdSynth && String(url).includes('contour-synth-processor.js'))
        await new Promise(resolve => qa.pendingSynth.push(resolve));
      return addModule.call(this, url, ...args);
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if(destination instanceof AudioNode) {
        if(!qa.links.has(this))qa.links.set(this,new Set());
        qa.links.get(this).add(destination);
      }
      if(observeImpulse&&qa.nodes.includes(destination)) {
        const source=this;
        qa.inputProbeReady=(async()=>{
          await qa.probeReady;
          const probe=qa.inputProbe=new NativeNode(source.context,'fractal-pcm-witness',{outputChannelCount:[1]});
          probe.port.onmessage=({data})=>{
            if(data.reset){qa.inputResetAck?.();return;}
            if(qa.recording)qa.inputPackets.push(data);
          };
          connect.call(source,probe);connect.call(probe,source.context.destination);
        })();
      }
      if (qa.nodes.includes(this) && destination instanceof GainNode) {
        const analyser = destination.context.createAnalyser(), mute = destination.context.createGain();
        analyser.fftSize = 4096; mute.gain.value = 0;
        connect.call(destination, analyser); connect.call(analyser, mute); connect.call(mute, destination.context.destination);
        qa.mainMonitor = { analyser, samples: new Float32Array(analyser.fftSize) };
      }
      return result;
    };
    const disconnect=AudioNode.prototype.disconnect;
    AudioNode.prototype.disconnect=function(destination,...args) {
      const result=disconnect.apply(this,arguments);
      if(destination instanceof AudioNode)qa.links.get(this)?.delete(destination);
      else qa.links.delete(this);
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
        if (args[1] !== 'fractal-delay-network') {
          if(String(args[1]).includes('synth')) {
            qa.synthNodes.push(this);
            const post=this.port.postMessage.bind(this.port);
            this.port.postMessage=(data,...rest)=>{
              if(data.type==='notes')qa.synthNotes.push(structuredClone(data));
              return post(data,...rest);
            };
          }
          return;
        }
        qa.nodes.push(this);
        if (observeMotion) {
          const post = this.port.postMessage.bind(this.port);
          this.port.postMessage = (data, ...rest) => {
            if (data.type === 'scene') qa.sceneRequests.push({ id: data.id, revision: data.revision, at: performance.now() });
            return post(data, ...rest);
          };
        }
        this.port.addEventListener('message', ({ data }) => {
          if (observeMotion && data.installed) {
            const request = qa.sceneRequests.find(row => row.id === data.id);
            if (request) qa.sceneAcks.push({ ...request, installedAt: performance.now() });
          }
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
              this.callbackGaps = [];
            }
            process(inputs, outputs) {
              for (const output of outputs) for (const channel of output) channel.fill(0);
              const count = outputs[0][0].length, input = inputs[0] || [];
              if (this.previousEnd !== undefined && this.previousEnd !== currentFrame) {
                this.discontinuities++;
                if (this.callbackGaps.length < 16) this.callbackGaps.push({ expectedFrame: this.previousEnd,
                  actualFrame: currentFrame, gapFrames: currentFrame - this.previousEnd, capturedFrame: this.total });
              }
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
                    discontinuities: this.discontinuities, callbackGaps: this.callbackGaps,
                    longestZeroRun: this.longestZeroRun }, [this.raw.buffer]);
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
  }, { holdContext, observeRenderer, observeMotion, observeImpulse, geometryDelay });
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

async function markerEvidence(page, recordCoordinates = false) {
  return page.evaluate(async ({ module, recordCoordinates }) => {
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
      drawnCount: frame.markers.length, maximumPositionError, errors,
      ...(recordCoordinates ? { cReal: network.parameters.cReal, cImag: network.parameters.cImag,
        coordinates: network.nodes.map(node => [node.x, node.y]),
        acked: __fractalPcmWitness.sceneAcks.some(row => row.revision === network.revision),
        liveInstall: __fractalPcmWitness.liveInstalls?.find(row => row.revision === network.revision) } : {}) };
  }, { module: ENGINE, recordCoordinates });
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

async function settledMotion(page) {
  // Pausing holds the oscillator immediately. Its final pose still waits for
  // the preceding admitted scene and the bounded dispatch interval.
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return !d.compiling && d.parameters.cReal === d.motion.real.value && d.parameters.cImag === d.motion.imag.value
      && d.network?.parameters.cReal === d.motion.real.value && d.network?.parameters.cImag === d.motion.imag.value
      && (!d.audio || d.status.revision === d.network.revision);
  }, { timeout: 30000 }).toBe(true);
  return diagnostics(page);
}

async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function motionCaptionsDoNotOverlapTap(page, axis) {
  const tap = page.locator(`.mz-tap-tempo[data-tap-control="#${axis}MotionTempo"]`);
  await tap.scrollIntoViewIfNeeded(); await expect(tap).toBeVisible();
  const overlaps = await tap.evaluate(button => {
    const tap = button.getBoundingClientRect();
    return [...button.closest('.motion-row').querySelectorAll('.knob-field b, .knob-field output')]
      .filter(node => node.textContent.trim()).flatMap(node => {
        const caption = node.getBoundingClientRect();
        const width = Math.max(0, Math.min(tap.right, caption.right) - Math.max(tap.left, caption.left));
        const height = Math.max(0, Math.min(tap.bottom, caption.bottom) - Math.max(tap.top, caption.top));
        return width * height > 0 ? [{ caption: node.textContent.trim(), overlapWidth: width, overlapHeight: height }] : [];
      });
  });
  expect(overlaps, `${axis} Tap must leave knob labels and values readable`).toEqual([]);
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
    if(qa.inputProbeReady) {
      await qa.inputProbeReady;
      await new Promise(resolve=>{qa.inputResetAck=resolve;qa.inputProbe.port.postMessage('reset');});
    }
    qa.inputPackets.length=0;qa.packets.length = 0; qa.statuses.length = 0; qa.recording = true;
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
      callbackGaps: last.callbackGaps,
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
  const liveLevels = { inputGain: 1.23, inputDriveDb: 9.1, delayGainDb: 17, dry: .3, outputLevel: .61, outputBoostDb: 2 };
  await performanceState(page, { wet: .7, ...liveLevels });
  const before = await diagnostics(page);
  await page.evaluate(() => { window.__presetSessionUi = { masthead: document.querySelector('.masthead'),
    source: document.getElementById('sourceMode'), output: document.getElementById('outputLevel') }; });
  const sessionPreserved = async () => {
    const current = await diagnostics(page);
    expect(current.input).toEqual(before.input);
    expect(current.microphone).toBe(before.microphone);
    expect(current.audioDesired).toBe(before.audioDesired);
    for (const [key, value] of Object.entries(liveLevels)) expect(current.performance[key], key).toBe(value);
    expect(await page.evaluate(() => Object.entries(window.__presetSessionUi).every(([key, node]) => node ===
      (key === 'masthead' ? document.querySelector('.masthead') : document.getElementById(key === 'source' ? 'sourceMode' : 'outputLevel'))))).toBe(true);
    await expect(page.locator('#sourceMode')).toHaveValue('file');
    await expect(page.locator('#outputLevel')).toHaveValue(String(liveLevels.outputLevel));
  };
  await beginCapture(page);
  const presets = await page.locator('#presetSelect').evaluate(select => [...select.options].map(option => option.value).filter(Boolean));
  expect(presets.length).toBeGreaterThanOrEqual(5);
  for (const id of presets.slice(0, 5)) {
    await page.locator('.instrument-preset-controls summary').click();
    await page.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
    await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', id);
    await sessionPreserved();
  }
  await page.locator('.header-preset-next').click();
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', presets[5 % presets.length]);
  await sessionPreserved();
  const beforeRandom = (await diagnostics(page)).parameters;
  await page.locator('.header-preset-random').click();
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 });
  await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('data-preset-id', 'custom');
  expect((await diagnostics(page)).parameters).not.toEqual(beforeRandom);
  await sessionPreserved();
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

test('held coefficient knobs and explorer drags continuously install and draw the sounding network', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  const errors = await fixture(page, { observeRenderer: true, observeMotion: true, geometryDelay: 250 });
  await ready(page);
  await parameters(page, { mode: 'inverse', detail: 5, timeMs: 35 });
  await performanceState(page, { wet: .7, dry: .25 });
  await page.evaluate(async module => {
    const engine = (await import(module)).getFractalDelayEngine();
    let revision = engine.getDiagnostics().network.revision;
    __fractalPcmWitness.liveInstalls = [];
    engine.subscribe(d => {
      if (d.network.revision === revision) return;
      revision = d.network.revision;
      const pointer = window.__heldPointer;
      __fractalPcmWitness.liveInstalls.push({ revision,
        captured: !!pointer && document.getElementById(pointer.controlId).hasPointerCapture(pointer.id),
        desiredAhead: d.parameters.cReal !== d.network.parameters.cReal || d.parameters.cImag !== d.network.parameters.cImag });
    });
  }, ENGINE);
  const evidence = [];
  const drag = async (id, startAudio = false) => {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    const box = await page.locator(`#${id}`).boundingBox();
    let x = box.x + box.width / 2, y = box.y + 16;
    if (id === 'parameterMap') {
      const point = await page.evaluate(async module => {
        const d = (await import(module)).getFractalDelayEngine().getDiagnostics();
        const { pixelAt, DEFAULT_EXPLORER_VIEW } = await import('/src/instruments/fractal-delay/fractal-explorer.js');
        const rect = document.getElementById('parameterMap').getBoundingClientRect();
        return pixelAt(DEFAULT_EXPLORER_VIEW, d.parameters.cReal, d.parameters.cImag, rect.width / rect.height);
      }, ENGINE);
      x = box.x + point.x * box.width; y = box.y + point.y * box.height;
    }
    const before = await diagnostics(page), frames = [];
    await page.locator(`#${id}`).evaluate(node => {
      window.__heldPointer = { id: null, controlId: node.id, times: [] };
      node.addEventListener('pointerdown', event => { __heldPointer.id = event.pointerId; }, { once: true });
      node.addEventListener('pointermove', event => { if (event.buttons) __heldPointer.times.push(performance.now()); });
    });
    await page.mouse.move(x, y); await page.mouse.down();
    // Arm from a real keyboard action while the coefficient pointer remains
    // captured; bootstrap must not race a separately installed cached scene.
    if (startAudio) await page.locator('#audioButton').press('Enter');
    for (let i = 1; i <= 96; i++) {
      const phase = i / 32 * Math.PI * 2;
      await page.mouse.move(x + (id === 'parameterMap' ? Math.sin(phase) * 8 : 0), y + Math.sin(phase) * 5);
      await page.waitForTimeout(10);
      if (i % 8 === 0) {
        // One small observation avoids pausing the pointer stream to copy the
        // complete, growing audio diagnostic history through browser IPC.
        const marker = await markerEvidence(page, true);
        if (marker.matches && marker.acked && marker.revision > before.network.revision) frames.push(marker);
      }
    }
    const held = await page.locator(`#${id}`).evaluate(node => ({ captured: node.hasPointerCapture(__heldPointer.id),
      maximumGap: Math.max(0, ...__heldPointer.times.slice(1).map((time, i) => time - __heldPointer.times[i])) }));
    expect(held.captured, `${id}: observations occur before pointer release`).toBe(true);
    // Judge at installation, not by a wall-clock gap in browser automation:
    // newer intent must already exist while the held graph installs and draws.
    const movingFrames = frames.filter(frame => frame.liveInstall?.captured && frame.liveInstall.desiredAhead);
    expect(new Set(movingFrames.map(frame => frame.revision)).size, `${id}: newer input cannot starve admitted graphs`).toBeGreaterThanOrEqual(2);
    expect(new Set(frames.map(frame => frame.revision)).size, `${id}: several Rust-installed revisions draw during motion`).toBeGreaterThanOrEqual(2);
    expect(new Set(frames.map(frame => JSON.stringify(frame.coordinates))).size, `${id}: actual route coordinates change during motion`).toBeGreaterThanOrEqual(2);
    await page.mouse.up();
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return !d.compiling && d.status.revision === d.network.revision
        && d.network.parameters.cReal === d.parameters.cReal && d.network.parameters.cImag === d.parameters.cImag;
    }, { timeout: 30000 }).toBe(true);
    evidence.push({ id, startAudio, held, frames });
  };
  await drag('cReal', true);
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await expect.poll(async () => (await diagnostics(page)).input.playing).toBe(true);
  const before = await diagnostics(page); await beginCapture(page);
  for (const id of ['cReal', 'cImag', 'parameterMap']) await drag(id);
  const pcm = await capture(page); boundedPcm(pcm); expect(pcm.longestZeroSeconds).toBeLessThan(.04);
  const after = await diagnostics(page);
  expect(after.contextGeneration).toBe(before.contextGeneration); expect(after.witness.sources).toEqual(before.witness.sources);
  expect(after.input).toEqual(before.input); expect(after.audioDesired).toBe(true); expect(after.sampleClock).toBeGreaterThan(before.sampleClock);
  const jobs = await page.evaluate(() => ({ jobs: __fractalPcmWitness.geometryJobs, acks: __fractalPcmWitness.sceneAcks }));
  const soundingJobs = jobs.jobs.filter(job => job.at > jobs.acks[0].installedAt);
  for (let i = 1; i < soundingJobs.length; i++) {
    const previous = jobs.acks.find(ack => ack.revision === soundingJobs[i - 1].revision);
    expect(previous, 'every graph finishes its real Rust ACK before another worker job starts').toBeTruthy();
    expect(soundingJobs[i].at).toBeGreaterThanOrEqual(previous.installedAt);
  }
  expect(after.error).toBeFalsy(); expect(errors).toEqual([]);
  await testInfo.attach('continuous-held-geometry.json', { body: JSON.stringify({ evidence, jobs, pcm }, null, 2), contentType: 'application/json' });
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

test('Path controls and current capture recall preserve the admitted graph and mobile media playback', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ baseURL, viewport: SIZES[1], isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(), errors = await fixture(page); await ready(page);
    await expect(page.locator('#propagation')).toHaveValue('paths');
    const defaults = await diagnostics(page);
    const factory = await page.evaluate(async () => (await import('/src/instruments/fractal-delay/presets.js')).DEFAULT_PRESET.parameters);
    expect(defaults.parameters.geometryPitch).toBe(factory.geometryPitch);
    expect(defaults.parameters.tapCoverage).toBe(factory.tapCoverage); expect(defaults.parameters.turnTone).toBe(factory.turnTone);
    for (const id of ['geometryPitch', 'tapCoverage', 'turnTone']) await expect(page.locator(`#${id}`)).toBeEnabled();
    await choose(page, 'sourceMode', 'file'); await upload(page);
    await parameters(page, { mode: 'orbits', cReal: -.12256116687665362, cImag: .7448617666197442,
      detail: 8, timeMs: 40, coupling: .97, decay: .8, pitchOffset: 0 });
    await performanceState(page, { wet: .7, dry: .15 });
    await page.locator('#audioButton').click();
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return d.input.playing && !d.compiling && d.status.revision === d.network?.revision && d.activeEdges === d.preparedEdges;
    }, { timeout: 30000 }).toBe(true);
    const before = await diagnostics(page); await beginCapture(page);
    for (const [id, values] of Object.entries({ geometryPitch: [0, 24, 7.5], tapCoverage: [0, 1, .72], turnTone: [0, 1, .44] })) {
      for (const value of values) await range(page, id, value);
      await expect.poll(async () => (await diagnostics(page)).parameters[id]).toBe(values.at(-1));
    }
    await choose(page, 'propagation', 'resonance');
    for (const id of ['geometryPitch', 'tapCoverage', 'turnTone']) await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator('#routingDescription, #propagationDescription, #portReadout')).toHaveCount(0);
    const retained = await diagnostics(page);
    expect(retained.parameters.geometryPitch).toBe(7.5);
    expect(retained.parameters.tapCoverage).toBe(.72); expect(retained.parameters.turnTone).toBe(.44);
    await page.locator('#geometryPitch').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath('resonance-touch-390.png'), fullPage: true });
    await choose(page, 'propagation', 'paths');
    for (const id of ['geometryPitch', 'tapCoverage', 'turnTone']) await expect(page.locator(`#${id}`)).toBeEnabled();
    const pcm = await capture(page, 1.2); boundedPcm(pcm); expect(pcm.longestZeroSeconds).toBeLessThan(.04);
    const afterControls = await diagnostics(page);
    expect(afterControls.network.revision).toBe(before.network.revision);
    expect(afterControls.preparedEdges).toBe(before.preparedEdges);
    expect(afterControls.requiredDelayBytes).toBe(before.requiredDelayBytes);
    expect(afterControls.contextGeneration).toBe(before.contextGeneration);
    expect(afterControls.witness.sources).toEqual(before.witness.sources);
    expect(afterControls.sampleClock).toBeGreaterThan(before.sampleClock); expect(afterControls.input.playing).toBe(true);

    await page.locator('#captureSound').evaluate(button => { button.closest('details').open = true; });
    await page.locator('#captureSound').click();
    const captured = JSON.parse(await page.locator('#capturedSound').inputValue());
    expect(captured.version).toBe(4); expect(captured.instrument).toBe('fractal-delay');
    expect(captured.parameters).toEqual(afterControls.parameters);
    expect(captured.liveLevels.dry).toBe(.15); expect(captured.liveLevels.inputDriveDb).toBe(afterControls.performance.inputDriveDb);
    await parameters(page, { propagation: 'resonance', geometryPitch: 0, tapCoverage: 0, turnTone: 0 });
    // Use the instrument's public recall normalizer, also used by its preset
    // adapter; an old capture must retain Resonance rather than silently change.
    const recalled = await page.evaluate(async snapshot => {
      const { recallParameters } = await import('/src/instruments/fractal-delay/presets.js');
      const { getFractalDelayEngine } = await import('/src/instruments/fractal-delay/browser-engine.js');
      const engine = getFractalDelayEngine(); await engine.setParameters(recallParameters(snapshot.parameters));
      const { propagation, geometryPitch, tapCoverage, turnTone, ...legacy } = snapshot.parameters;
      return { legacy: recallParameters(legacy) };
    }, captured);
    expect(recalled.legacy.propagation).toBe('resonance');
    expect(recalled.legacy.geometryPitch).toBe(0); expect(recalled.legacy.tapCoverage).toBe(0); expect(recalled.legacy.turnTone).toBe(0);
    await expect.poll(async () => (await diagnostics(page)).parameters).toEqual(captured.parameters);
    for (const id of ['geometryPitch', 'tapCoverage', 'turnTone']) await expect(page.locator(`#${id}`)).toHaveValue(String(captured.parameters[id]));
    const afterRecall = await diagnostics(page);
    expect(afterRecall.network.revision).toBe(before.network.revision);
    expect(afterRecall.contextGeneration).toBe(before.contextGeneration);
    expect(afterRecall.witness.sources).toEqual(before.witness.sources); expect(afterRecall.sampleClock).toBeGreaterThan(afterControls.sampleClock);
    expect(afterRecall.audioDesired).toBe(true); expect(afterRecall.input.playing).toBe(true); expect(afterRecall.error).toBeFalsy();
    await page.locator('#geometryPitch').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath('paths-touch-390.png'), fullPage: true });
    expect(errors).toEqual([]);
    await testInfo.attach('path-control-mobile-continuity.json', { body: JSON.stringify({ captured, pcm,
      revision: afterRecall.network.revision, admitted: afterRecall.activeEdges,
      clockBefore: before.sampleClock, clockAfter: afterRecall.sampleClock }, null, 2), contentType: 'application/json' });
  } finally { await context.close(); }
});

test('engine pulse never arms Audio and excites real paths without replacing a playing input', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = await fixture(page); await ready(page);
  await expect(page.locator('#sendPulse')).toHaveCount(0);
  expect(await page.evaluate(async module => (await import(module)).getFractalDelayEngine().sendPulse(), ENGINE)).toBe(false);
  const off = await diagnostics(page);
  expect(off.audioDesired).toBe(false); expect(off.contextState).toBe('uninitialized'); expect(off.sourceCount).toBe(0);
  await parameters(page, { mode: 'orbits', cReal: -.12256116687665362, cImag: .7448617666197442,
    detail: 8, timeMs: 40, coupling: 1, decay: .7, pitchOffset: 0 });
  await performanceState(page, { inputDriveDb: 0, delayGainDb: 0, wet: 1, dry: 0, outputLevel: .6,
    outputBoostDb: 0, hpfHz: 5, lpfHz: 22000, compressorRatio: 1, compressorMakeupDb: 0 });
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return !d.compiling && d.audio && d.status.revision === d.network?.revision && d.activeEdges === d.preparedEdges;
  }, { timeout: 30000 }).toBe(true);
  const prepared = await diagnostics(page); await beginCapture(page);
  expect(await page.evaluate(async module => (await import(module)).getFractalDelayEngine().sendPulse(), ENGINE)).toBe(true);
  const isolated = await capture(page); boundedPcm(isolated);
  await expect.poll(async () => (await diagnostics(page)).witness.sources.at(-1).ended).toBe(true);
  const afterPulse = await diagnostics(page);
  expect(afterPulse.sourceCount).toBe(0); expect(afterPulse.witness.sources).toHaveLength(1);
  expect(afterPulse.witness.sources[0].starts).toBe(1); expect(afterPulse.network.revision).toBe(prepared.network.revision);
  expect(afterPulse.contextGeneration).toBe(prepared.contextGeneration); expect(afterPulse.sampleClock).toBeGreaterThan(prepared.sampleClock);

  await choose(page, 'sourceMode', 'file'); await upload(page);
  await expect.poll(async () => (await diagnostics(page)).input.playing, { timeout: 15000 }).toBe(true);
  const playing = await diagnostics(page); await beginCapture(page);
  expect(await page.evaluate(async module => (await import(module)).getFractalDelayEngine().sendPulse(), ENGINE)).toBe(true);
  const mixed = await capture(page);
  await testInfo.attach('pulse-mixed-callback-audit.json', { body: JSON.stringify(mixed, null, 2), contentType: 'application/json' });
  boundedPcm(mixed);
  await expect.poll(async () => (await diagnostics(page)).witness.sources.at(-1).ended).toBe(true);
  const after = await diagnostics(page);
  expect(after.witness.sources.slice(0, playing.witness.sources.length)).toEqual(playing.witness.sources);
  expect(after.witness.sources).toHaveLength(playing.witness.sources.length + 1);
  expect(after.input).toEqual(playing.input); expect(after.sourceCount).toBe(1);
  expect(after.network.revision).toBe(playing.network.revision); expect(after.contextGeneration).toBe(playing.contextGeneration);
  expect(after.sampleClock).toBeGreaterThan(playing.sampleClock); expect(after.error).toBeFalsy();
  await page.locator('#audioButton').click();
  expect(await page.evaluate(async module => (await import(module)).getFractalDelayEngine().sendPulse(), ENGINE)).toBe(false);
  expect((await diagnostics(page)).audioDesired).toBe(false); expect(errors).toEqual([]);
  await testInfo.attach('performed-pulse-pcm.json', { body: JSON.stringify({ isolated, mixed,
    revision: after.network.revision, clockBefore: prepared.sampleClock, clockAfter: after.sampleClock }, null, 2), contentType: 'application/json' });
});

test('independent coordinate motion and Tap work visually without arming Audio', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors = await fixture(page); await ready(page);
  const initial = await diagnostics(page);
  expect(initial.motion.real.playing).toBe(false); expect(initial.motion.imag.playing).toBe(false);
  expect(initial.parameters.realMotionTempo).toBe(6); expect(initial.parameters.imagMotionTempo).toBe(4.5);
  expect(initial.parameters.realMotionDepth).toBe(.035); expect(initial.parameters.imagMotionDepth).toBe(.035);
  for (const axis of ['real', 'imag']) await expect(page.locator(`#${axis}MotionPlay`)).toHaveAttribute('aria-pressed', 'false');
  await range(page, 'realMotionTempo', 60); await range(page, 'imagMotionTempo', 30);
  await page.locator('#realMotionPlay').click();
  await expect.poll(async () => (await diagnostics(page)).parameters.cReal).not.toBe(initial.parameters.cReal);
  const realOnly = await diagnostics(page);
  expect(realOnly.motion.real.playing).toBe(true); expect(realOnly.motion.imag.playing).toBe(false);
  expect(realOnly.parameters.cImag).toBe(initial.parameters.cImag);
  expect(realOnly.motion.real.value).toBeGreaterThanOrEqual(realOnly.motion.real.low);
  expect(realOnly.motion.real.value).toBeLessThanOrEqual(realOnly.motion.real.high);
  await page.locator('#realMotionPlay').click(); await page.locator('#imagMotionPlay').click();
  const paused = await diagnostics(page);
  await expect.poll(async () => (await diagnostics(page)).parameters.cImag).not.toBe(paused.parameters.cImag);
  await expect.poll(async () => (await diagnostics(page)).parameters.cReal).toBe(paused.motion.real.value);
  const imagOnly = await diagnostics(page);
  expect(imagOnly.motion.real.value).toBe(paused.motion.real.value);
  expect(imagOnly.parameters.cReal).toBe(paused.motion.real.value);
  expect(imagOnly.motion.real.playing).toBe(false); expect(imagOnly.motion.imag.playing).toBe(true);
  await page.locator('#imagMotionPlay').click();
  await settledMotion(page);
  await range(page, 'cReal', -.4); await range(page, 'realMotionDepth', .2);
  const manual = await diagnostics(page);
  expect(manual.motion.real.center).toBe(-.4); expect(manual.parameters.cReal).toBe(-.4);
  expect(manual.motion.real.depth).toBe(.2);
  // Physical taps follow the actual shared control. At this tempo range the
  // observed sub-second tap interval is intentionally clamped to 60 BPM.
  const tap = page.locator('.mz-tap-tempo[data-tap-control="#imagMotionTempo"]');
  await expect(tap).toHaveCount(1); await tap.click(); await page.waitForTimeout(400); await tap.click();
  await expect(page.locator('#imagMotionTempo')).toHaveValue('60');
  const beforeHold = await diagnostics(page); await page.waitForTimeout(300);
  const afterHold = await diagnostics(page);
  expect(afterHold.parameters.cReal).toBe(beforeHold.parameters.cReal); expect(afterHold.parameters.cImag).toBe(beforeHold.parameters.cImag);
  expect(afterHold.audioDesired).toBe(false); expect(afterHold.audio).toBe(false);
  expect(afterHold.contextState).toBe('uninitialized'); expect(afterHold.contextGeneration).toBe(0);
  expect(afterHold.sourceCount).toBe(0); expect(afterHold.witness.contexts).toBe(0); expect(afterHold.witness.microphoneRequests).toBe(0);
  expect(afterHold.error).toBeFalsy(); expect(errors).toEqual([]);
  await testInfo.attach('motion-with-audio-off.json', { body: JSON.stringify({ initial, realOnly, imagOnly,
    manual, heldParameters: afterHold.parameters }, null, 2), contentType: 'application/json' });
});

test('two moving coordinates preserve production audio through presets, pause, UI stalls and disposal', async ({ page }, testInfo) => {
  test.setTimeout(150000);
  const errors = await fixture(page, { observeMotion: true }); await ready(page);
  await choose(page, 'sourceMode', 'file'); await upload(page);
  await parameters(page, { mode: 'orbits', cReal: -.12256116687665362, cImag: .7448617666197442,
    detail: 8, timeMs: 35, realMotionTempo: 24, imagMotionTempo: 18, realMotionDepth: .012, imagMotionDepth: .009 });
  await performanceState(page, { wet: .7, dry: .15 });
  const beforeVisual = await diagnostics(page);
  await page.locator('#realMotionPlay').click(); await page.waitForTimeout(150);
  const visuallyPlaying = await diagnostics(page);
  expect(visuallyPlaying.motion.real.playing).toBe(true); expect(visuallyPlaying.audioDesired).toBe(false);
  expect(visuallyPlaying.contextGeneration).toBe(beforeVisual.contextGeneration);
  expect(visuallyPlaying.witness.contexts).toBe(beforeVisual.witness.contexts);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.input.playing && !d.compiling && d.status.revision === d.network?.revision;
  }, { timeout: 30000 }).toBe(true);
  const before = await diagnostics(page); await beginCapture(page);
  expect(before.motion.real.playing).toBe(true);
  await page.locator('#imagMotionPlay').click();
  await expect.poll(async () => {
    const d = await diagnostics(page);
    return d.motion.real.playing && d.motion.imag.playing && d.network.revision > before.network.revision;
  }, { timeout: 30000 }).toBe(true);
  await page.waitForTimeout(600);
  await expect.poll(() => page.evaluate(revision => __fractalPcmWitness.geometryJobs.filter(row => row.revision > revision).length,
    before.network.revision), { timeout: 30000 }).toBeGreaterThan(1);
  // Check the motion pump before an explicit depth edit, which intentionally
  // supersedes preparation with a newly centered user gesture.
  const jobs = await page.evaluate(() => ({ jobs: __fractalPcmWitness.geometryJobs,
    requests: __fractalPcmWitness.sceneRequests, acks: __fractalPcmWitness.sceneAcks }));
  const motionJobs = jobs.jobs.filter(row => row.revision > before.network.revision);
  for (let i = 1; i < motionJobs.length; i++) {
    const previous = jobs.acks.find(row => row.revision === motionJobs[i - 1].revision);
    expect(previous, 'a new moving pose waits for the prior actual Rust scene ACK').toBeTruthy();
    expect(motionJobs[i].at).toBeGreaterThanOrEqual(previous.installedAt);
  }
  await range(page, 'outputBoostDb', -6);
  await range(page, 'realMotionTempo', 30); await range(page, 'imagMotionDepth', .006);
  // The audio clock continues during a main-thread stall; the next pose uses
  // current time rather than replaying obsolete queued animation frames.
  await page.evaluate(() => { const until = performance.now() + 450; while (performance.now() < until) {} });
  await page.locator('#realMotionPlay').click(); await page.locator('#imagMotionPlay').click();
  const stopped = await diagnostics(page), paused = await settledMotion(page); await page.waitForTimeout(250);
  const held = await diagnostics(page);
  expect(held.motion.real.value).toBe(stopped.motion.real.value); expect(held.motion.imag.value).toBe(stopped.motion.imag.value);
  expect(held.parameters.cReal).toBe(paused.parameters.cReal); expect(held.parameters.cImag).toBe(paused.parameters.cImag);
  expect(held.motion.real.playing).toBe(false); expect(held.motion.imag.playing).toBe(false);
  expect(held.performance.outputBoostDb).toBe(-6); expect(held.error).toBeFalsy();
  const scalarPcm = await capture(page, 1.2); boundedPcm(scalarPcm); expect(scalarPcm.longestZeroSeconds).toBeLessThan(.04);
  await page.locator('#realMotionPlay').click(); await page.locator('#imagMotionPlay').click();
  const transitions = [];
  for (const id of ['rabbit-slingshot', 'four-way-carousel', 'orbit-torrent', 'cavern-circuit']) {
    await page.locator('.instrument-preset-controls summary').click();
    await page.locator(`button[data-full-preset][data-preset-id="${id}"]`).click();
    await expect(page.locator('.instrument-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 30000 });
    await expect.poll(async () => {
      const d = await diagnostics(page); return d.motion.real.playing && d.motion.imag.playing && d.input.playing;
    }).toBe(true);
    // New geometry deliberately clears old wave telemetry. Its temporary
    // zero proxy is not the Rust sample clock: observe actual status messages.
    await expect.poll(async () => (await diagnostics(page)).witness.statuses.at(-1)?.sampleClock || 0,
      { timeout: 5000 }).toBeGreaterThan(before.sampleClock);
    const selected = await diagnostics(page);
    expect(selected.contextGeneration).toBe(before.contextGeneration); expect(selected.witness.sources).toEqual(before.witness.sources);
    expect(selected.error).toBeFalsy();
    transitions.push({ id, motion: selected.motion, parameters: selected.parameters, clock: selected.witness.statuses.at(-1).sampleClock });
  }
  const presetPcm = await capture(page); boundedPcm(presetPcm); expect(presetPcm.longestZeroSeconds).toBeLessThan(.04);
  await choose(page, 'sourceMode', 'samples'); await choose(page, 'sampleSelect', 'music-keys');
  await expect.poll(async () => {
    const d = await diagnostics(page); return d.input.playing && d.input.sampleId === 'music-keys';
  }, { timeout: 15000 }).toBe(true);
  const sampleBefore = await diagnostics(page); await beginCapture(page);
  await range(page, 'realMotionTempo', 12); await range(page, 'imagMotionTempo', 9);
  const samplePcm = await capture(page); boundedPcm(samplePcm); expect(samplePcm.longestZeroSeconds).toBeLessThan(.04);
  const sampleAfter = await diagnostics(page);
  expect(sampleAfter.witness.sources).toEqual(sampleBefore.witness.sources);
  expect(sampleAfter.contextGeneration).toBe(before.contextGeneration);
  expect(sampleAfter.witness.statuses.at(-1).sampleClock).toBeGreaterThan(sampleBefore.witness.statuses.at(-1).sampleClock);
  expect(sampleAfter.motion.real.playing).toBe(true); expect(sampleAfter.motion.imag.playing).toBe(true);
  await page.locator('#realMotionPlay').click(); await page.locator('#imagMotionPlay').click();
  await settledMotion(page);
  await page.locator('#captureSound').evaluate(button => { button.closest('details').open = true; });
  await page.locator('#captureSound').click();
  const captured = JSON.parse(await page.locator('#capturedSound').inputValue());
  expect(captured.version).toBe(4);
  for (const id of ['realMotionTempo', 'imagMotionTempo', 'realMotionDepth', 'imagMotionDepth'])
    expect(captured.parameters[id]).toBe((await diagnostics(page)).parameters[id]);
  expect(Object.hasOwn(captured, 'motion')).toBe(false);
  const after = await diagnostics(page);
  for (let i = 1; i < after.witness.statuses.length; i++)
    expect(after.witness.statuses[i].sampleClock, 'actual Rust time never resets across a moving scene').toBeGreaterThanOrEqual(after.witness.statuses[i - 1].sampleClock);
  expect(after.contextGeneration).toBe(before.contextGeneration); expect(after.witness.sources).toEqual(sampleBefore.witness.sources);
  expect(after.input.playing).toBe(true); expect(after.audioDesired).toBe(true); expect(after.sampleClock).toBeGreaterThan(before.sampleClock);
  await page.evaluate(async module => (await import(module)).getFractalDelayEngine().dispose(), ENGINE);
  const disposed = await diagnostics(page), requestsBefore = await page.evaluate(() => __fractalPcmWitness.geometryJobs.length);
  await page.waitForTimeout(300);
  expect((await diagnostics(page)).contextState).toBe('closed'); expect((await diagnostics(page)).sourceCount).toBe(0);
  expect(await page.evaluate(() => __fractalPcmWitness.geometryJobs.length)).toBe(requestsBefore);
  expect(disposed.audioDesired).toBe(false); expect(errors).toEqual([]);
  await testInfo.attach('live-motion-continuity.json', { body: JSON.stringify({ scalarPcm, presetPcm, samplePcm, jobs, transitions, captured,
    clockBefore: before.sampleClock, clockAfter: after.sampleClock }, null, 2), contentType: 'application/json' });
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
    propagation: 'paths', geometryPitch: 0, tapCoverage: 0, turnTone: 0,
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
    propagation: 'paths', geometryPitch: 0, tapCoverage: 0, turnTone: 0,
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
  await fixture(page); await ready(page);await choose(page,'sourceMode','impulse');
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
    expect(graphic.width, 'each half of the graphic must retain a usable width').toBeGreaterThanOrEqual(150);
    const explorer=await page.locator('#parameterMap').boundingBox();
    expect(Math.abs(explorer.width-graphic.width), 'explorer and delay share the graphic equally').toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    for (const id of ['sourceMode', 'sampleSelect', 'sampleNext', 'fileInput', 'inputLoop', 'restartInput', 'stopInput',
      'sendImpulse','impulsePlay','impulseTempo','impulseMode','impulseFrequency','impulseIndex','impulseRatio',
      'impulseCutoff','impulseResonance','impulseAttackMs','impulseDecayMs','impulseSustain','impulseHoldMs',
      'impulseReleaseMs','impulseShepardRate','impulseShepardWidth','impulseLevel','noDecay',
      'mode', 'modeNext', 'domain', 'propagation', 'geometryPitch', 'tapCoverage', 'turnTone',
      'realMotionPlay', 'imagMotionPlay', 'realMotionTempo', 'imagMotionTempo', 'realMotionDepth', 'imagMotionDepth',
      'cReal', 'cImag', 'detail', 'timeMs', 'pitchOffset', 'decay', 'coupling', 'pickup',
      'inputMode', 'inputPosition', 'inputCount', 'inputSpread', 'pickupMode', 'pickupCount', 'pickupSpread', 'boundary', 'routing', 'linkDensity',
      'inputDriveDb', 'delayGainDb',
      'wet', 'dry', 'hpfHz', 'lpfHz', 'outputBoostDb', 'compressorThresholdDb', 'compressorRatio',
      'compressorAttackMs', 'compressorReleaseMs', 'compressorMakeupDb', 'masteringPreset', 'inputTrim', 'outputLevel',
      'voiceBudget', 'manualBudget', 'captureSound', 'audioButton', 'presetSelect']) {
      if (id === 'sendImpulse') await choose(page, 'sourceMode', 'impulse');
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
    const ordering = await page.evaluate(() => {
      const panel = document.querySelector('.fractal-controls'), live = document.getElementById('liveData');
      const preset = panel.querySelector('.instrument-preset-controls');
      const row = preset.closest('.mz-input-preset-row') || preset;
      return { presetsFirst: panel.firstElementChild === row,
        interactiveBeforeData: [...panel.querySelectorAll('input, select, button, textarea')].every(node =>
          !!(node.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING)),
        budgetSection: document.getElementById('voiceBudget').closest('details').id };
    });
    expect(ordering).toEqual({ presetsFirst: true, interactiveBeforeData: true, budgetSection: 'capacityControls' });
    await page.locator('.fractal-controls').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
    const rail = await page.locator('.fractal-controls').boundingBox();
    const toolbar = await page.locator('.instrument-preset-controls').boundingBox();
    expect(toolbar.y).toBeGreaterThanOrEqual(rail.y - 1);
    expect(toolbar.y + toolbar.height).toBeLessThan(rail.y + rail.height);
    await page.locator('.instrument-preset-controls summary').click();
    await expect(page.locator('button[data-full-preset]').first()).toBeVisible();
    await page.locator('.instrument-preset-controls summary').click();
    const before = await diagnostics(page);
    for (const axis of ['real', 'imag']) await motionCaptionsDoNotOverlapTap(page, axis);
    await page.locator('#stage').scrollIntoViewIfNeeded(); await page.locator('#stage').focus();
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
    await expect.poll(async () => {
      const d = await diagnostics(page);
      return d.parameters.cReal !== before.parameters.cReal && d.parameters.cImag !== before.parameters.cImag;
    }).toBe(true);
    expect((await diagnostics(page)).audioDesired).toBe(false);
    expect(errors).toEqual([]);
    await page.locator('#propagation').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath(`fractal-delay-${viewport.width}-sound.png`), fullPage: true });
    await page.locator('#geometryPitch').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath(`fractal-delay-${viewport.width}.png`), fullPage: true });
  });
}

for (const viewport of SIZES.slice(1)) {
  test(`coarse-pointer Audio, Play and Tap remain at least 48 pixels at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage(); await fixture(page); await ready(page);
      const audio = await page.locator('#audioButton').boundingBox();
      expect(audio.width).toBeGreaterThanOrEqual(48); expect(audio.height).toBeGreaterThanOrEqual(48);
      for (const axis of ['real', 'imag']) {
        const play = page.locator(`#${axis}MotionPlay`), tap = page.locator(`.mz-tap-tempo[data-tap-control="#${axis}MotionTempo"]`);
        for (const control of [play, tap]) {
          await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
          const box = await control.boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
        }
        await motionCaptionsDoNotOverlapTap(page, axis);
        await play.click(); await expect(play).toHaveAttribute('aria-pressed', 'true');
        expect((await diagnostics(page)).audioDesired).toBe(false);
        expect((await diagnostics(page)).contextState).toBe('uninitialized');
        await play.click(); await expect(play).toHaveAttribute('aria-pressed', 'false');
      }
      await choose(page, 'sourceMode', 'impulse');
      for(const control of [page.locator('#sendImpulse'),page.locator('#impulsePlay'),page.locator('.mz-tap-tempo[data-tap-control="#impulseTempo"]')]) {
        await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();
        const box=await control.boundingBox();expect(box.width).toBeGreaterThanOrEqual(48);expect(box.height).toBeGreaterThanOrEqual(48);
        expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
        expect(await control.evaluate(node=>{
          const rect=node.getBoundingClientRect(),rail=node.closest('.fractal-controls').getBoundingClientRect();
          return rect.right<=rail.right&&rect.left>=rail.left;
        })).toBe(true);
      }
      await page.locator('#impulsePlay').click();await expect(page.locator('#impulsePlay')).toHaveAttribute('aria-pressed','true');
      expect((await diagnostics(page)).contextState).toBe('uninitialized');
      await page.locator('#impulsePlay').click();
      const overlap=await page.locator('.impulse-transport').evaluate(row=>{
        const tap=row.querySelector('.mz-tap-tempo').getBoundingClientRect();
        return [...row.querySelectorAll('b,output')].some(node=>{
          const box=node.getBoundingClientRect();return box.left<tap.right&&box.right>tap.left&&box.top<tap.bottom&&box.bottom>tap.top;
        });
      });expect(overlap).toBe(false);
      const labelOverlaps=await page.locator('.impulse-knobs').evaluate(grid=>{
        const labels=[...grid.querySelectorAll('b')].map(node=>({text:node.textContent,box:node.getBoundingClientRect()}));
        return labels.flatMap((a,i)=>labels.slice(i+1).filter(b=>a.box.left<b.box.right&&a.box.right>b.box.left&&a.box.top<b.box.bottom&&a.box.bottom>b.box.top).map(b=>[a.text,b.text]));
      });expect(labelOverlaps).toEqual([]);
      await page.locator('#impulsePlay').scrollIntoViewIfNeeded();
      await page.screenshot({path:testInfo.outputPath(`impulse-touch-${viewport.width}.png`),fullPage:true});
      await choose(page, 'propagation', 'resonance');
      for (const id of ['geometryPitch', 'tapCoverage', 'turnTone']) await expect(page.locator(`#${id}`)).toBeDisabled();
      await page.locator('#geometryPitch').evaluate(node => node.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: testInfo.outputPath(`resonance-touch-${viewport.width}.png`), fullPage: true });
      await choose(page, 'propagation', 'paths');
      for (const id of ['geometryPitch', 'tapCoverage', 'turnTone']) await expect(page.locator(`#${id}`)).toBeEnabled();
      await page.locator('#geometryPitch').evaluate(node => node.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: testInfo.outputPath(`paths-touch-${viewport.width}.png`), fullPage: true });
    } finally { await context.close(); }
  });
}

async function impulseInputEvidence(page) {
  return page.evaluate(()=>{
    const qa=__fractalPcmWitness,packets=qa.inputPackets,rate=packets[0]?.rate||48000;
    const samples=packets.flatMap(packet=>Array.from({length:packet.frames},(_,i)=>(packet.raw[2*i]+packet.raw[2*i+1])*.5));
    let energy=0,peak=0,quiet=rate,nonFinite=0;const attacks=[];
    const frequencies=[220,440,660,880,1100],bands=frequencies.map(()=>[0,0]);
    samples.forEach((sample,i)=>{
      if(!Number.isFinite(sample))nonFinite++;
      peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;
      if(Math.abs(sample)<.0001)quiet++;
      else {if(quiet>rate*.025)attacks.push(i/rate);quiet=0;}
      frequencies.forEach((f,j)=>{const phase=i/rate*2*Math.PI*f;bands[j][0]+=sample*Math.cos(phase);bands[j][1]+=sample*Math.sin(phase);});
    });
    const powers=bands.map(([a,b])=>a*a+b*b),total=powers.reduce((a,b)=>a+b,0);
    const reaches=(from,avoidNetwork)=>{
      const seen=new Set(),pending=[from];
      while(pending.length){const node=pending.pop();if(seen.has(node)||avoidNetwork&&qa.nodes.includes(node))continue;
        seen.add(node);if(node===node.context.destination)return true;pending.push(...qa.links.get(node)||[]);}
      return false;
    };
    return {rms:Math.sqrt(energy/samples.length),peak,nonFinite,attacks,spectrum:powers.map(v=>v/total),
      synths:qa.synthNodes.length,notes:qa.synthNotes,
      speakerPath:qa.synthNodes.map(node=>reaches(node,false)),bypass:qa.synthNodes.map(node=>reaches(node,true)),
      discontinuities:packets.at(-1)?.discontinuities,longTasks:qa.longTasks,repeatPolls:qa.repeatPolls};
  });
}

test('Impulse voices feed real Rust audio only; No decay is live and reversible without rebuilding', async ({page},testInfo)=>{
  test.setTimeout(120000);
  const errors=await fixture(page,{observeImpulse:true});await ready(page);await choose(page,'sourceMode','impulse');
  await range(page,'impulseFrequency',220);await range(page,'impulseTempo',120);
  await page.locator('#impulsePlay').click();
  expect((await diagnostics(page)).contextState).toBe('uninitialized');await expect(page.locator('#sendImpulse')).toBeDisabled();
  await page.locator('#impulsePlay').click();
  await parameters(page,{mode:'orbits',detail:2,timeMs:20,coupling:1,decay:.8,boundary:.7,tapCoverage:1,geometryPitch:0,turnTone:.2});
  await performanceState(page,{wet:1,dry:0,inputDriveDb:0,delayGainDb:0,outputLevel:.7,outputBoostDb:0});
  await page.locator('#audioButton').click();
  await expect.poll(async()=>(await diagnostics(page)).impulse.enabled,{timeout:30000}).toBe(true);
  const before=await diagnostics(page);
  await page.locator('#noDecay').check();
  await expect.poll(async()=>(await diagnostics(page)).parameters.decay).toBe(1);
  const noDecay=await diagnostics(page);
  expect(noDecay.network.revision).toBe(before.network.revision);
  for(const key of ['decay','coupling','tapCoverage','boundary'])expect(noDecay.parameters[key]).toBe(1);
  expect(noDecay.parameters.turnTone).toBe(0);
  const results={};
  for(const mode of ['sine','triangle','square','saw','fm','pm','shepard']) {
    await choose(page,'impulseMode',mode);await beginCapture(page);await page.locator('#sendImpulse').click();
    const pcm=await capture(page,.6);boundedPcm(pcm);
    const input=await impulseInputEvidence(page);
    expect(input.rms,mode).toBeGreaterThan(.00001);expect(input.nonFinite).toBe(0);expect(input.discontinuities).toBe(0);
    expect(input.synths).toBe(1);expect(input.speakerPath).toEqual([true]);expect(input.bypass).toEqual([false]);
    results[mode]={pcm,input};
  }
  expect(results.sine.input.spectrum.reduce((sum,value,i)=>sum+Math.abs(value-results.fm.input.spectrum[i]),0)).toBeGreaterThan(.1);
  await page.locator('#noDecay').uncheck();
  await expect.poll(async()=>(await diagnostics(page)).parameters.decay).toBe(.8);
  const after=await diagnostics(page);expect(after.parameters.turnTone).toBe(.2);expect(after.parameters.boundary).toBe(.7);
  expect(after.network.revision).toBe(before.network.revision);expect(after.witness.contexts).toBe(1);expect(after.witness.nodes).toBe(1);
  expect(errors).toEqual([]);
  await testInfo.attach('impulse-modes-pcm.json',{body:JSON.stringify(results),contentType:'application/json'});
});

test('Impulse repeat attacks follow tempo; Pause leaves network tails and presets preserve the source',async({page},testInfo)=>{
  test.setTimeout(90000);const errors=await fixture(page,{observeImpulse:true});await ready(page);await choose(page,'sourceMode','impulse');
  await parameters(page,{mode:'orbits',detail:2,timeMs:25,coupling:1,decay:1,boundary:1,tapCoverage:1,geometryPitch:0,turnTone:0});
  await performanceState(page,{wet:1,dry:0,inputDriveDb:0,delayGainDb:0,outputLevel:.7});
  await choose(page,'impulseMode','sine');await range(page,'impulseTempo',120);await page.locator('#audioButton').click();
  await expect.poll(async()=>(await diagnostics(page)).impulse.enabled,{timeout:30000}).toBe(true);
  await beginCapture(page);await page.locator('#impulsePlay').click();boundedPcm(await capture(page,1.8));
  const slow=await impulseInputEvidence(page);await testInfo.attach('repeat-start.json',{body:JSON.stringify(slow),contentType:'application/json'});expect(slow.attacks.length).toBeGreaterThanOrEqual(3);
  for(let i=1;i<slow.attacks.length;i++)expect(Math.abs(slow.attacks[i]-slow.attacks[i-1]-.5)).toBeLessThan(.004);
  await range(page,'impulseTempo',240);await beginCapture(page);boundedPcm(await capture(page,1.3));
  const fast=await impulseInputEvidence(page);expect(fast.attacks.length).toBeGreaterThanOrEqual(4);
  // A capture may begin inside the last old note; compare the settled intervals.
  for(let i=2;i<fast.attacks.length;i++)expect(Math.abs(fast.attacks[i]-fast.attacks[i-1]-.25)).toBeLessThan(.004);
  await page.locator('#impulsePlay').click();await page.waitForTimeout(250);await beginCapture(page);
  const tails=await capture(page,.5),paused=await impulseInputEvidence(page);boundedPcm(tails);expect(paused.peak).toBeLessThan(.000001);
  await page.locator('#impulsePlay').click();const settings=(await diagnostics(page)).impulse.parameters;
  await page.locator('.instrument-preset-controls summary').click();await page.locator('button[data-full-preset]').nth(2).click();
  await page.locator('.header-preset-next').click();await page.locator('.header-preset-random').click();
  const state=await diagnostics(page);expect(state.input.mode).toBe('impulse');expect(state.impulse.parameters).toEqual(settings);expect(state.impulse.playing).toBe(true);
  await page.locator('#captureSound').evaluate(node=>{node.closest('details').open=true;});await page.locator('#captureSound').click();
  expect(JSON.parse(await page.locator('#capturedSound').inputValue()).impulse).toEqual(settings);
  await page.locator('#audioButton').click();const off=await diagnostics(page);expect(off.impulse.enabled).toBe(false);expect(off.impulse.playing).toBe(false);
  expect(errors).toEqual([]);await testInfo.attach('impulse-repeat-pcm.json',{body:JSON.stringify({slow,fast,paused,tails}),contentType:'application/json'});
});

test('Impulse cancels held startup, late microphone and media; teardown closes its borrowed resources',async({page})=>{
  test.setTimeout(90000);const errors=await fixture(page,{observeImpulse:true});await ready(page);
  await choose(page,'sourceMode','file');await upload(page);await page.locator('#audioButton').click();
  await expect.poll(async()=>(await diagnostics(page)).input.playing,{timeout:30000}).toBe(true);
  await page.evaluate(()=>{__fractalPcmWitness.holdSynth=true;});await choose(page,'sourceMode','impulse');
  await expect.poll(()=>page.evaluate(()=>__fractalPcmWitness.pendingSynth.length)).toBe(1);
  await page.locator('#impulsePlay').click();await page.locator('#audioButton').click();
  await page.evaluate(()=>{const qa=__fractalPcmWitness;qa.holdSynth=false;qa.pendingSynth.splice(0).forEach(resolve=>resolve());});
  await expect.poll(async()=>(await diagnostics(page)).impulse.pending).toBe(false);
  let state=await diagnostics(page);expect(state.impulse.enabled).toBe(false);expect(state.impulse.playing).toBe(false);
  expect(state.witness.sources.every(row=>row.stops>0)).toBe(true);
  await page.locator('#audioButton').click();await expect.poll(async()=>(await diagnostics(page)).impulse.enabled).toBe(true);
  await page.locator('#sendImpulse').click();await choose(page,'sourceMode','samples');
  await expect.poll(async()=>(await diagnostics(page)).input.playing).toBe(true);expect((await diagnostics(page)).impulse.enabled).toBe(false);
  await page.evaluate(()=>{__fractalPcmWitness.holdMicrophone=true;});await choose(page,'sourceMode','mic');
  await page.evaluate(async module=>{void(await import(module)).getFractalDelayEngine().setMicrophoneEnabled(true);},ENGINE);
  await expect.poll(async()=>(await diagnostics(page)).witness.pendingMicrophones).toBe(1);
  await choose(page,'sourceMode','impulse');
  await page.evaluate(()=>__fractalPcmWitness.pendingMicrophones.splice(0).forEach(row=>row.resolve()));
  await expect.poll(async()=>(await diagnostics(page)).witness.liveTracks).toBe(0);
  await page.locator('#impulsePlay').click();await expect.poll(async()=>(await diagnostics(page)).impulse.playing).toBe(true);
  await page.evaluate(async module=>{await(await import(module)).getFractalDelayEngine().dispose();},ENGINE);
  await expect.poll(()=>page.evaluate(()=>__fractalPcmWitness.contexts.every(context=>context.state==='closed'))).toBe(true);
  const count=await page.evaluate(()=>__fractalPcmWitness.synthNotes.length);await page.waitForTimeout(300);
  expect(await page.evaluate(()=>__fractalPcmWitness.synthNotes.length)).toBe(count);expect(errors).toEqual([]);
});

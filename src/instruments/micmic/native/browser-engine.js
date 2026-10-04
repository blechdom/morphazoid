import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, sanitizeParameters, sanitizePerformance } from './model.js';
import { audioInputConstraints, audioInputDescription, configureAudioInputNode } from '../../../audio-input-settings.js';
import { connectAudioOutput } from '../../../audio-output-manager.js';

const WORKER_URL = new URL('./topology-worker.js', import.meta.url);
const WORKLET_URL = new URL('./delay-worklet.js', import.meta.url);
let currentEngine;

export function getBrowserDelayEngine() { return currentEngine; }

const emptyStatus = () => ({ sampleRate: 0, device: 'Audio off', inputDevice: null, activeVoices: 0,
  targetVoices: 0, voiceLimit: 0, installedCapacity: 0, calibratedVoices: 0, cpuLoad: 0, peakLoad: 0,
  inputPeak: 0, outputPeak: 0, outputLeftPeak: 0, outputRightPeak: 0, gainReductionDb: 0,
  deadlineMisses: 0, underruns: 0, overruns: 0, elapsedSeconds: 0, wetBusGain: 0, topologyRevision: 0,
  tapActivity: [], tapVoiceIndices: [], generationActivity: [], generationVoiceCounts: [],
  inputEnvelope: { interval: .01, endTime: 0, values: [] }, failure: null });

/** Browser lifecycle and messages only. Topology and audio share the Rust core. */
export function createBrowserDelayEngine({ onStatus = () => {}, onError = () => {} } = {}) {
  let parameters = sanitizeParameters(DEFAULT_PARAMETERS), performanceState = sanitizePerformance(DEFAULT_PERFORMANCE);
  let worker, module, topology, pool, topologyRevision = 0, compilerRevision = 0, compileChain = Promise.resolve();
  let context, node, master, releaseOutput, starting, ready, finishReady, contextGeneration = 0;
  let stream, inputNode, microphonePending = false, captureVersion = 0, capturePromise;
  let audio = false, audioDesired = false, audioVersion = 0, disposed = false, failure = null;
  let status = emptyStatus(), sequence = 0, readyTopology;
  const workerRequests = new Map(), audioRequests = new Map();

  function assertOpen() { if (disposed) throw new Error('This audio session has closed.'); }
  function report(error) { failure = String(error.message || error); onError(error); }

  function settleRequests(requests, error) {
    for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
    requests.clear();
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(WORKER_URL, { type: 'module', name: 'L-system topology' });
    worker.onmessage = ({ data }) => {
      const pending = workerRequests.get(data.id); if (!pending) return;
      workerRequests.delete(data.id); clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data);
    };
    worker.onerror = event => {
      const error = new Error(event.message || 'The topology worker stopped.');
      settleRequests(workerRequests, error); report(error);
    };
  }

  function compile(nextParameters, rate) {
    assertOpen(); ensureWorker();
    const id = ++sequence, revision = ++compilerRevision;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { workerRequests.delete(id); reject(new Error('The requested topology took too long to compile.')); }, 60000);
      workerRequests.set(id, { resolve, reject, timer });
      worker.postMessage({ id, parameters: nextParameters, sampleRate: rate, revision });
    });
  }

  function audioMessage(type, values = {}, transfers = []) {
    if (!node) return Promise.reject(new Error('The audio engine is not ready.'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { audioRequests.delete(id); reject(new Error('The audio engine did not respond.')); }, 15000);
      audioRequests.set(id, { resolve, reject, timer });
      node.port.postMessage({ id, type, ...values }, transfers);
    });
  }

  async function install(compiled) {
    if (node) await audioMessage('install', { pool: compiled.pool });
    parameters = sanitizeParameters(compiled.result.parameters); topology = compiled.result;
    pool = compiled.pool; module = compiled.module; topologyRevision = compiled.revision;
  }

  function ensureTopology() {
    if (!readyTopology) readyTopology = compile(parameters, context?.sampleRate || 48000).then(async compiled => {
      await install(compiled); return topology;
    }).catch(error => { readyTopology = null; throw error; });
    return readyTopology;
  }

  function setOutput(enabled, immediate = false) {
    if (!master || !context || context.state === 'closed') return;
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(immediate ? Number(enabled) : master.gain.value, now);
    if (!immediate) master.gain.linearRampToValueAtTime(Number(enabled), now + .015);
  }

  // Deliberately synchronous until resume(): browsers require the Audio gesture.
  function prepareAudio() {
    try {
      assertOpen();
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is unavailable in this browser.');
      if (!context || context.state === 'closed') {
        context = new AudioContextClass({ latencyHint: 'interactive' }); contextGeneration++;
      }
      const resumed = context.resume();
      if (starting) return starting;
      if (node) return resumed.then(() => { assertOpen(); return node; });
      starting = (async () => {
        await resumed;
        await Promise.all([ensureTopology(), context.audioWorklet.addModule(WORKLET_URL)]);
        assertOpen();
        // Compile at the device rate, retaining exact delay-history eligibility.
        if (context.sampleRate !== 48000) await install(await compile(parameters, context.sampleRate));
        master = context.createGain(); master.gain.value = 0;
        node = new AudioWorkletNode(context, 'morphazoid-l-system-delay', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'max',
          processorOptions: { module },
        });
        ready = new Promise((resolve, reject) => {
          const timer = setTimeout(() => finishReady?.(new Error('The Rust audio engine took too long to start.')), 15000);
          finishReady = error => { clearTimeout(timer); finishReady = null; if (error) reject(error); else resolve(); };
        });
        ready.catch(() => {});
        node.port.onmessage = ({ data }) => {
          if (data.type === 'ready') { finishReady?.(); return; }
          const pending = audioRequests.get(data.id);
          if (!pending) return;
          audioRequests.delete(data.id); clearTimeout(pending.timer);
          if (data.error) pending.reject(new Error(data.error));
          else { if (data.status) status = data.status; pending.resolve(data.status); }
        };
        node.onprocessorerror = () => {
          const error = new Error('The Rust audio engine stopped. Reload the instrument to start a new session.');
          audioDesired = audio = false; setOutput(false, true); stopCapture();
          finishReady?.(error); settleRequests(audioRequests, error); report(error);
        };
        node.connect(master); releaseOutput = connectAudioOutput(context, master);
        await ready; assertOpen();
        await audioMessage('install', { pool });
        await audioMessage('performance', { performance: performanceState });
        return node;
      })().finally(() => { starting = null; });
      starting.catch(() => {});
      return starting;
    } catch (error) { return Promise.reject(error); }
  }

  function stopCapture() {
    captureVersion++; microphonePending = false;
    inputNode?.disconnect(); inputNode = null;
    for (const track of stream?.getTracks() || []) track.stop();
    stream = null; capturePromise = null;
  }

  function setMicrophoneEnabled(enabled) {
    if (!enabled) { stopCapture(); return Promise.resolve(snapshot()); }
    // Capture can be prepared while the output gate remains off.
    const prepared = prepareAudio();
    if (stream) return prepared.then(() => snapshot());
    if (capturePromise) return capturePromise;
    const version = ++captureVersion; microphonePending = true;
    capturePromise = (async () => {
      await prepared; assertOpen();
      if (version !== captureVersion) return snapshot();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture requires a secure browser page and a supported input device.');
      const captured = await navigator.mediaDevices.getUserMedia(audioInputConstraints());
      if (disposed || version !== captureVersion) {
        for (const track of captured.getTracks()) track.stop(); return snapshot();
      }
      stream = captured; inputNode = configureAudioInputNode(context.createMediaStreamSource(stream));
      inputNode.connect(node);
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (stream === captured) { stopCapture(); onStatus(snapshot()); }
      }, { once: true });
      failure = null; return snapshot();
    })().catch(error => { if (version === captureVersion) report(error); throw error; })
      .finally(() => { if (version === captureVersion) { microphonePending = false; capturePromise = null; onStatus(snapshot()); } })
      .then(() => snapshot());
    capturePromise.catch(() => {});
    return capturePromise;
  }

  function snapshot(includeNodes = false) {
    const visibleStatus = { ...status, source: performanceState.source, automatic: performanceState.automatic,
      microphoneEnabled: Boolean(stream), microphonePending, inputDevice: stream ? audioInputDescription(stream) : null,
      inputPeak: stream || performanceState.source === 'seed' ? status.inputPeak : 0, failure };
    if (!audio) Object.assign(visibleStatus, { outputPeak: 0, outputLeftPeak: 0, outputRightPeak: 0, gainReductionDb: 0 });
    const reply = { audio, browserAvailable: true, nativeAvailable: true, deviceAvailable: Boolean(globalThis.AudioContext || globalThis.webkitAudioContext),
      parameters: { ...parameters }, performance: structuredClone(performanceState), topologyRevision,
      requestedVoices: topology?.requestedVoices || 0, eligibleVoices: topology?.eligibleVoices || 0,
      memoryVoiceCapacity: topology?.memoryVoiceCapacity || Number.MAX_SAFE_INTEGER,
      generationLimits: topology?.generationLimits || {}, status: visibleStatus, error: failure };
    if (includeNodes) { reply.nodes = topology?.nodes || []; reply.previewSampled = topology?.previewSampled || false; }
    return reply;
  }

  async function refresh() {
    if (node && context?.state === 'running' && !starting) status = await audioMessage('status');
    const reply = snapshot(); onStatus(reply); return reply;
  }

  async function request(path, body) {
    assertOpen();
    if (path === '/api/audio') {
      const version = ++audioVersion; audioDesired = Boolean(body?.enabled);
      if (!audioDesired) { audio = false; setOutput(false); stopCapture(); return snapshot(); }
      try {
        await prepareAudio();
        if (performanceState.source === 'mic') await setMicrophoneEnabled(true);
        if (disposed || version !== audioVersion || !audioDesired || document.hidden) return snapshot();
        audio = true; failure = null; setOutput(true); return await refresh();
      } catch (error) {
        if (version === audioVersion) { audioDesired = audio = false; setOutput(false, true); report(error); }
        throw error;
      }
    }
    await ensureTopology(); assertOpen();
    if (path === '/api/state' || path === '/api/preview') return snapshot(true);
    if (path === '/api/status') return refresh();
    if (path === '/api/parameters' || path === '/api/reset') {
      const next = sanitizeParameters(path === '/api/reset' ? DEFAULT_PARAMETERS : body);
      const pending = compileChain.catch(() => {}).then(async () => { const compiled = await compile(next, context?.sampleRate || 48000); assertOpen(); await install(compiled); failure = null; return refresh(); });
      compileChain = pending; return pending;
    }
    if (path === '/api/performance') {
      const next = sanitizePerformance({ ...performanceState, ...body });
      const needsCapture = audio && next.source === 'mic' && performanceState.source !== 'mic';
      if (node && !starting) await audioMessage('performance', { performance: next });
      performanceState = next; failure = null;
      if (next.source !== 'mic') stopCapture();
      else if (needsCapture) await setMicrophoneEnabled(true);
      return refresh();
    }
    if (path === '/api/strike') {
      if (audio && node) await audioMessage('strike');
      return refresh();
    }
    throw new Error(`Unknown browser engine request: ${path}`);
  }

  function muteForDeparture() {
    audioVersion++; audioDesired = audio = false; setOutput(false, true); stopCapture();
    // Suspending releases browser CPU and pauses its actual sample clock.
    if (context?.state === 'running') void context.suspend().catch(() => {});
    onStatus(snapshot());
  }

  function dispose() {
    if (disposed) return;
    muteForDeparture(); disposed = true;
    const error = new Error('This audio session has closed.');
    finishReady?.(error); settleRequests(workerRequests, error); settleRequests(audioRequests, error);
    worker?.terminate(); worker = null;
    if (node) { node.port.postMessage({ type: 'dispose' }); node.disconnect(); node.port.close(); node = null; }
    releaseOutput?.(); releaseOutput = null; master?.disconnect(); master = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  function getDiagnostics() {
    const reply = snapshot();
    return { ...reply, initialized: Boolean(topology), disposed, audioDesired, microphoneEnabled: Boolean(stream), microphonePending,
      contextState: context?.state || 'absent', contextGeneration, connectionCount: node && master ? 1 : 0,
      sampleClock: status.elapsedSeconds, processedBlocks: status.processedBlocks || 0, buildRevision: topologyRevision };
  }

  currentEngine = { request, prepareAudio, setMicrophoneEnabled, muteForDeparture, dispose, getDiagnostics };
  return currentEngine;
}

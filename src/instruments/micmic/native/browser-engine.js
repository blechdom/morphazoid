import { DEFAULT_PARAMETERS, DEFAULT_PERFORMANCE, sanitizeParameters, sanitizePerformance } from './model.js';
import { audioInputConstraints, audioInputDescription, configureAudioInputNode } from '../../../audio-input-settings.js';
import { connectAudioOutput } from '../../../audio-output-manager.js';
import { createInputSource } from './input-source.js';

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
export function createBrowserDelayEngine({ initialParameters = DEFAULT_PARAMETERS, onStatus = () => {}, onError = () => {} } = {}) {
  let parameters = sanitizeParameters(initialParameters), performanceState = sanitizePerformance(DEFAULT_PERFORMANCE);
  let worker, module, topology, pool, topologyRevision = 0, compilerRevision = 0, compileChain = Promise.resolve();
  let parameterRequestRevision = 0, depthRevision = 0, requestedDepth = parameters.depth;
  let context, node, master, releaseOutput, starting, ready, finishReady, controlsReady = false, contextGeneration = 0;
  let controlOperations = 0, preparationRevision = 0, controlSuspension = null, contextSuspension = null;
  let stream, inputNode, microphonePending = false, captureVersion = 0, capturePromise, captureCancel, inputRevision = 0;
  let audio = false, audioDesired = false, audioVersion = 0, disposed = false, failure = null;
  let status = emptyStatus(), sequence = 0, readyTopology;
  const workerRequests = new Map(), audioRequests = new Map();
  const inputWaiters = new Set();
  const input = createInputSource({ prepare: prepareAudio, getContext: () => context, getTarget: () => node,
    canPlay: () => audioDesired && !disposed && !document.hidden,
    onChange: () => onStatus(snapshot()), onError: report });

  function assertOpen() { if (disposed) throw new Error('This audio session has closed.'); }
  function report(error) { failure = String(error.message || error); onError(error); }

  function failAudio(error, failedNode, failedContext = context) {
    // Processor exceptions permanently silence that node. Discard its graph so
    // the next explicit Audio/Mic action can prepare a fresh session.
    if (failedNode !== node || failedContext !== context) return;
    audioVersion++; audioDesired = audio = false; setOutput(false, true); stopInputs();
    finishReady?.(error); settleRequests(audioRequests, error);
    controlsReady = false; starting = null;
    if (failedNode) {
      failedNode.onprocessorerror = null; failedNode.port.onmessage = null;
      failedNode.disconnect(); failedNode.port.close();
    }
    node = null;
    releaseOutput?.(); releaseOutput = null; master?.disconnect(); master = null;
    context = null;
    if (failedContext && failedContext.state !== 'closed') void failedContext.close().catch(() => {});
    status = emptyStatus(); report(error); onStatus(snapshot());
  }

  function settleRequests(requests, error) {
    for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(error); }
    requests.clear();
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(WORKER_URL, { type: 'module', name: 'L-system topology' });
    const activeWorker = worker;
    worker.onmessage = ({ data }) => {
      const pending = workerRequests.get(data.id); if (!pending) return;
      workerRequests.delete(data.id); clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data);
    };
    worker.onerror = event => {
      if (worker !== activeWorker) return;
      const error = new Error(event.message || 'The topology worker stopped.');
      activeWorker.terminate(); worker = null;
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

  function installMessage(retainedPool) {
    // Transfer delivery avoids cloning the full pool on the audio thread.
    // Keep the compiler/cache allocation attached for graph recovery.
    const audioPool = retainedPool.slice(0);
    return audioMessage('install', { pool: audioPool }, [audioPool]);
  }

  function suspendControlContext(preparedContext) {
    const suspension = { context: preparedContext, promise: null };
    suspension.promise = preparedContext.suspend().finally(() => {
      if (contextSuspension === suspension) contextSuspension = null;
    });
    contextSuspension = suspension;
    return suspension.promise;
  }

  async function withRunningControlGraph(task) {
    const preparedContext = context, preparedNode = node;
    controlOperations++;
    try {
      if (contextSuspension?.context === preparedContext) await contextSuspension.promise.catch(() => {});
      assertOpen();
      if (context !== preparedContext || node !== preparedNode) throw new Error('The audio session changed while preparing its controls.');
      if (preparedContext?.state === 'suspended') {
        controlSuspension = { context: preparedContext, revision: preparationRevision };
        if (!audioDesired) setOutput(false, true);
        await preparedContext.resume();
      }
      assertOpen();
      if (context !== preparedContext || node !== preparedNode) throw new Error('The audio session changed while preparing its controls.');
      return await task();
    } finally {
      try {
        if (controlOperations === 1 && controlSuspension) {
          const intent = controlSuspension;
          const shouldSuspend = () => context === intent.context && preparationRevision === intent.revision
            && !audioDesired && !stream && !microphonePending && context.state === 'running';
          if (shouldSuspend()) {
            // Keep this control operation active while its retired storage
            // drains, so another departure cannot strand the final cleanup.
            await audioMessage('drain');
            if (controlOperations === 1 && shouldSuspend()) {
              if (controlSuspension === intent) controlSuspension = null;
              await suspendControlContext(intent.context);
              // A newer explicit Audio/Mic preparation owns the running state.
              if (!disposed && context === intent.context && preparationRevision !== intent.revision
                && !document.hidden && context.state === 'suspended') await context.resume();
            }
          } else if (controlSuspension === intent) controlSuspension = null;
        }
      } finally { controlOperations--; }
    }
  }

  async function install(compiled) {
    if (node) {
      await withRunningControlGraph(async () => {
        await installMessage(compiled.pool);
        // Recursion is a live coefficient. A gesture can move it while a large
        // structural pool is compiling; installing that pool must not rewind it.
        await audioMessage('depth', { depth: requestedDepth });
      });
    }
    parameters = { ...sanitizeParameters(compiled.result.parameters), depth: requestedDepth }; topology = compiled.result;
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
      preparationRevision++;
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is unavailable in this browser.');
      if (!context || context.state === 'closed') {
        context = new AudioContextClass({ latencyHint: 'interactive' }); contextGeneration++;
      }
      const resumed = context.resume();
      if (starting) return starting;
      if (node) return resumed.then(() => { assertOpen(); return node; });
      const preparedContext = context;
      const preparation = (async () => {
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
        const preparedNode = node;
        ready = new Promise((resolve, reject) => {
          const timer = setTimeout(() => finishReady?.(new Error('The Rust audio engine took too long to start.')), 15000);
          finishReady = error => { clearTimeout(timer); finishReady = null; if (error) reject(error); else resolve(); };
        });
        ready.catch(() => {});
        node.port.onmessage = ({ data }) => {
          if (node !== preparedNode) return;
          if (data.type === 'failure') {
            failAudio(new Error(`${data.error || 'The Rust audio engine stopped.'} Press Audio to restart.`), preparedNode, preparedContext); return;
          }
          if (data.type === 'ready') { finishReady?.(); return; }
          const pending = audioRequests.get(data.id);
          if (!pending) return;
          audioRequests.delete(data.id); clearTimeout(pending.timer);
          if (data.error) pending.reject(new Error(data.error));
          else { if (data.status) status = data.status; pending.resolve(data.status); }
        };
        node.onprocessorerror = () => failAudio(new Error('The Rust audio engine stopped. Press Audio to restart.'), preparedNode, preparedContext);
        node.connect(master); releaseOutput = connectAudioOutput(context, master);
        // Publish the initial pool before yielding. A preset can finish
        // compiling before the worklet's ready message reaches this thread;
        // all subsequent installations must follow this one in port order.
        await withRunningControlGraph(async () => {
          const initialInstall = installMessage(pool);
          initialInstall.catch(() => {});
          await ready; assertOpen();
          await initialInstall; assertOpen();
          // Later performance edits must reach the worklet even while its first
          // performance message is awaiting acknowledgement.
          controlsReady = true;
          await audioMessage('depth', { depth: requestedDepth });
          await audioMessage('performance', { performance: performanceState });
        });
        return node;
      })().catch(error => {
        // Startup failure/timeout also must not cache an unusable node. Ignore
        // an old preparation's rejection once a new explicit session exists.
        if (!disposed && context === preparedContext) failAudio(error, node, preparedContext);
        throw error;
      }).finally(() => { if (starting === preparation) starting = null; });
      starting = preparation;
      starting.catch(() => {});
      return starting;
    } catch (error) { return Promise.reject(error); }
  }

  function stopCapture() {
    captureVersion++; microphonePending = false;
    captureCancel?.(); captureCancel = null;
    inputNode?.disconnect(); inputNode = null;
    for (const track of stream?.getTracks() || []) track.stop();
    stream = null; capturePromise = null;
  }

  function invalidateInput() {
    inputRevision++;
    for (const cancel of inputWaiters) cancel();
    inputWaiters.clear();
  }
  function stopInputs() { invalidateInput(); stopCapture(); input.stop(); }

  function beginInputAction() { invalidateInput(); failure = null; return inputRevision; }
  function finishInputAction(revision) {
    if (revision === inputRevision) { failure = null; onStatus(snapshot()); }
    return snapshot();
  }

  async function externalPerformance() {
    if (performanceState.source === 'mic') return;
    const next = sanitizePerformance({ ...performanceState, source: 'mic' });
    if (node && controlsReady) await audioMessage('performance', { performance: next });
    performanceState = next;
  }

  async function activateInput() {
    if (!audioDesired || disposed || document.hidden) return snapshot();
    const revision = inputRevision, mode = input.snapshot().mode;
    let cancel;
    const cancelled = new Promise(resolve => { cancel = resolve; inputWaiters.add(cancel); });
    const active = (async () => {
      if (mode === 'mic') await setMicrophoneEnabled(true, false);
      else {
        await externalPerformance();
        if (revision === inputRevision) await input.start();
      }
    })();
    // Device permission and decode cannot always be aborted. A newer input
    // action finishes this older activation without ever reviving its source.
    try { await Promise.race([active, cancelled]); }
    finally { inputWaiters.delete(cancel); }
    return snapshot();
  }

  async function setInputMode(mode) {
    assertOpen();
    if (!['mic', 'file', 'samples'].includes(mode)) throw new RangeError('Choose Mic, File or Samples input.');
    const revision = beginInputAction();
    if (mode !== input.snapshot().mode) stopCapture();
    input.selectMode(mode);
    await externalPerformance();
    if (revision !== inputRevision) return snapshot();
    if (audioDesired) await activateInput();
    return finishInputAction(revision);
  }

  async function setSample(id) {
    assertOpen(); const revision = beginInputAction(); input.selectSample(id);
    if (input.snapshot().mode === 'samples' && audioDesired) await activateInput();
    return finishInputAction(revision);
  }

  async function loadFile(file) {
    assertOpen(); const revision = beginInputAction(); stopCapture(); await externalPerformance();
    if (revision !== inputRevision) return snapshot();
    await input.loadFile(file); return finishInputAction(revision);
  }

  function setInputLoop(enabled) { assertOpen(); input.setLoop(enabled); return snapshot(); }
  function stopInput() { assertOpen(); stopInputs(); return snapshot(); }
  async function restartInput() {
    assertOpen(); const revision = beginInputAction(); stopCapture(); input.stop();
    if (audioDesired) await activateInput();
    return finishInputAction(revision);
  }

  function setMicrophoneEnabled(enabled, select = true) {
    if (!enabled) { stopCapture(); return Promise.resolve(snapshot()); }
    // This explicit capture action may meter a microphone with output muted.
    if (select) { invalidateInput(); input.selectMode('mic'); }
    // Capture can be prepared while the output gate remains off.
    const prepared = prepareAudio();
    if (stream) return prepared.then(() => snapshot());
    if (capturePromise) return capturePromise;
    const version = ++captureVersion; microphonePending = true;
    const cancelled = new Promise(resolve => { captureCancel = resolve; });
    const capturing = (async () => {
      await prepared; assertOpen();
      if (version !== captureVersion || input.snapshot().mode !== 'mic') return snapshot();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture requires a secure browser page and a supported input device.');
      const captured = await navigator.mediaDevices.getUserMedia(audioInputConstraints());
      if (disposed || version !== captureVersion || input.snapshot().mode !== 'mic') {
        for (const track of captured.getTracks()) track.stop(); return snapshot();
      }
      stream = captured; inputNode = configureAudioInputNode(context.createMediaStreamSource(stream));
      inputNode.connect(node);
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (stream === captured) { stopCapture(); onStatus(snapshot()); }
      }, { once: true });
      failure = null; return snapshot();
    })().catch(error => {
      if (disposed || version !== captureVersion || input.snapshot().mode !== 'mic') return snapshot();
      report(error); throw error;
    })
      .finally(() => { if (version === captureVersion) { microphonePending = false; capturePromise = null; captureCancel = null; onStatus(snapshot()); } });
    capturePromise = Promise.race([capturing, cancelled]).then(() => snapshot());
    capturePromise.catch(() => {});
    return capturePromise;
  }

  function snapshot(includeNodes = false) {
    const selectedInput = input.snapshot();
    const visibleStatus = { ...status, source: performanceState.source, automatic: performanceState.automatic,
      microphoneEnabled: Boolean(stream), microphonePending, inputDevice: stream ? audioInputDescription(stream) : null,
      inputPeak: stream || selectedInput.playing || performanceState.source === 'seed' ? status.inputPeak : 0, failure };
    if (!audio) Object.assign(visibleStatus, { outputPeak: 0, outputLeftPeak: 0, outputRightPeak: 0, gainReductionDb: 0 });
    const reply = { audio, browserAvailable: true, nativeAvailable: true, deviceAvailable: Boolean(globalThis.AudioContext || globalThis.webkitAudioContext),
      parameters: { ...parameters }, performance: structuredClone(performanceState), input: { ...selectedInput,
        pending: selectedInput.pending || microphonePending, playing: selectedInput.mode === 'mic' ? Boolean(stream) : selectedInput.playing }, topologyRevision,
      requestedVoices: topology?.requestedVoices || 0,
      eligibleVoices: parameters.depth > 0 ? (topology?.structuralEligibleVoices ?? topology?.eligibleVoices ?? 0) : 0,
      memoryVoiceCapacity: topology?.memoryVoiceCapacity || Number.MAX_SAFE_INTEGER,
      generationLimits: topology?.generationLimits || {}, status: visibleStatus, error: failure };
    if (includeNodes) {
      reply.nodes = topology?.nodes || [];
      if (topology?.visualNodes) reply.visualNodes = topology.visualNodes;
      reply.previewSampled = topology?.previewSampled || false;
    }
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
      if (!audioDesired) { audio = false; setOutput(false); stopInputs(); return snapshot(); }
      try {
        await prepareAudio();
        if (performanceState.source === 'mic') await activateInput();
        if (disposed || version !== audioVersion || !audioDesired || document.hidden) return snapshot();
        audio = true; failure = null; setOutput(true); return await refresh();
      } catch (error) {
        if (version === audioVersion) { audioDesired = audio = false; setOutput(false, true); stopInputs(); report(error); }
        throw error;
      }
    }
    await ensureTopology(); assertOpen();
    if (path === '/api/state' || path === '/api/preview') return snapshot(true);
    if (path === '/api/status') return refresh();
    if (path === '/api/depth') {
      const depth = sanitizeParameters({ ...parameters, depth: body?.depth }).depth;
      const revision = ++depthRevision; requestedDepth = depth;
      if (node && controlsReady) await audioMessage('depth', { depth });
      if (revision === depthRevision) { parameters = { ...parameters, depth }; failure = null; }
      return snapshot();
    }
    if (path === '/api/parameters' || path === '/api/reset') {
      const next = sanitizeParameters(path === '/api/reset' ? DEFAULT_PARAMETERS : body);
      const revision = ++parameterRequestRevision;
      ++depthRevision; requestedDepth = next.depth;
      const pending = compileChain.catch(() => {}).then(async () => {
        if (revision !== parameterRequestRevision) return snapshot();
        const compiled = await compile(next, context?.sampleRate || 48000); assertOpen();
        if (revision !== parameterRequestRevision) return snapshot();
        await install(compiled); failure = null; return refresh();
      });
      compileChain = pending; return pending;
    }
    if (path === '/api/performance') {
      const next = sanitizePerformance({ ...performanceState, ...body,
        ...(input.snapshot().mode !== 'mic' ? { source: 'mic' } : {}) });
      const needsCapture = audio && next.source === 'mic' && performanceState.source !== 'mic';
      if (node && controlsReady) await audioMessage('performance', { performance: next });
      performanceState = next; failure = null;
      if (next.source !== 'mic') stopInputs();
      else if (needsCapture) await activateInput();
      return snapshot();
    }
    if (path === '/api/strike') {
      if (audio && node) await audioMessage('strike');
      return refresh();
    }
    throw new Error(`Unknown browser engine request: ${path}`);
  }

  function muteForDeparture() {
    audioVersion++; audioDesired = audio = false; setOutput(false, true); stopInputs();
    // Suspending releases browser CPU and pauses its actual sample clock.
    if (context && context.state !== 'closed') {
      // Staged pools need callbacks to reach their atomic commit and ACK.
      // Complete them muted, then honor departure once their work is done.
      controlSuspension = { context, revision: preparationRevision };
      if (!controlOperations && context.state === 'running') void suspendControlContext(context).catch(() => {});
    }
    onStatus(snapshot());
  }

  function dispose() {
    if (disposed) return;
    muteForDeparture(); disposed = true; input.dispose();
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

  function getSampleTime() {
    const elapsed = status.elapsedSeconds, at = status.audioTimeSeconds;
    if (disposed || !node || !context || !(status.processedBlocks > 0)
      || !Number.isFinite(elapsed) || !Number.isFinite(at)) return null;
    // Both clocks advance on the audio thread, including while status messages
    // wait behind a UI frame. AudioContext.currentTime freezes on suspension.
    return elapsed + Math.max(0, context.currentTime - at);
  }

  currentEngine = { request, prepareAudio, setMicrophoneEnabled, setInputMode, setSample, loadFile,
    setInputLoop, restartInput, stopInput, muteForDeparture, dispose, getDiagnostics, getSampleTime };
  return currentEngine;
}

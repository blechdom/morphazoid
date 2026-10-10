import { DEFAULT_PARAMETERS, sanitizeParameters } from './model.js';
import { DEFAULT_PERFORMANCE, sanitizePerformance } from './performance.js';
import { createInputSource } from '../micmic/native/input-source.js';
import { audioInputConstraints, configureAudioInputNode, audioInputDescription } from '../../audio-input-settings.js';
import { connectAudioOutput } from '../../audio-output-manager.js';

let singleton;
// Port edits share the atomic revision acknowledgement; the worker reuses the
// admitted geometry and Rust retargets ports without replacing its histories.
const GEOMETRY_KEYS = ['mode','domain','cReal','cImag','detail','routing','linkDensity',
  'inputMode','inputPosition','inputCount','inputSpread','pickup','pickupMode','pickupCount','pickupSpread'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export function createFractalDelayEngine(options = {}) {
  let parameters = sanitizeParameters(options.parameters || DEFAULT_PARAMETERS);
  let performance = sanitizePerformance(options.performance || DEFAULT_PERFORMANCE);
  let context, node, master, releaseOutput, contextPromise, modulePromise, module;
  let contextGeneration = 0, audioDesired = false, audio = false, disposed = false;
  let micStream, micNode, micPending = false, micVersion = 0, audioVersion = 0;
  let network, networkBytes, preview, status = {}, error = '', revision = 0, messageId = 0;
  let compiling = false, cpuEstimate = 0, requiredDelayBytes = 0, pollTimer, pollPending = false;
  let manual = false, budget = 16384;
  const memoryBytes = (navigator.deviceMemory >= 8 ? 192 : navigator.deviceMemory <= 2 ? 48 : 96) * 1024 * 1024;
  const requests = new Map(), builds = new Map(), listeners = new Set();
  const worker = new Worker(new URL('./preflight-worker.js', import.meta.url), { type:'module' });
  const emit = () => { if (!disposed) for (const listener of listeners) listener(getDiagnostics()); };
  const report = reason => { error = String(reason?.message || reason); emit(); };
  const input = createInputSource({
    prepare: prepareContext, getContext: () => context, getTarget: () => node,
    canPlay: () => audioDesired && audio && !!node && !disposed,
    onChange: emit, onError: report,
  });
  function getDiagnostics() {
    return { parameters:{...parameters}, performance:{...performance}, audioDesired, audio,
      contextState:context?.state || 'uninitialized', contextGeneration, input:input.snapshot(),
      microphone:!!micStream, microphonePending:micPending, inputDescription:audioInputDescription(micStream),
      sourceCount:Number(!!micStream)+Number(input.snapshot().playing), error, compiling,
      network, preview, revision:status.revision || network?.revision || 0,
      preparedEdges:(network || preview)?.edges.length || 0,
      requestedEdges:(network || preview)?.requestedEdges || 0,
      activeEdges:audio ? status.activeEdges || 0 : 0, sampleClock:status.sampleClock || 0,
      cpuLoad:status.cpuLoad || 0, cpuEstimate, requiredDelayBytes, memoryBytes, budget, manual,
      status, sceneMemoryBytes:memoryBytes/2, sampleRate:context?.sampleRate || 48000 };
  }
  function request(type, body = {}) {
    if (!node) return Promise.reject(new Error('Audio processor is unavailable'));
    const id = ++messageId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { requests.delete(id); reject(new Error(`${type} preparation timed out`)); }, 45000);
      requests.set(id, {resolve,reject,timer}); node.port.postMessage({ type,id,...body });
    });
  }
  function sendControls() {
    if (node) node.port.postMessage({type:'controls', parameters, performance,
      inputMode:input.snapshot().mode === 'mic' ? 'mic' : 'media'});
  }
  async function loadModule() {
    if (!modulePromise) modulePromise = fetch(new URL('../../../assets/wasm/fractal-delay.wasm', import.meta.url))
      .then(response => { if (!response.ok) throw new Error('Could not load Rust audio'); return response.arrayBuffer(); })
      .then(bytes => WebAssembly.compile(bytes)).then(value => (module = value))
      .catch(reason => { modulePromise = null; throw reason; });
    return modulePromise;
  }
  worker.onmessage = async ({data}) => {
    const job = builds.get(data.revision); if (!job) return;
    builds.delete(data.revision);
    if (data.error) { if (data.revision === revision) { compiling = false; report(data.error); } job.reject(new Error(data.error)); return; }
    if (data.type === 'superseded' || data.revision !== revision || disposed) { job.resolve(false); return; }
    const next = {...data.network,revision:data.revision};
    try {
      if (node) {
        await context.resume();
        const result = await request('scene',{sceneBytes:data.sceneBytes,revision:next.revision, parameters,performance,
          inputMode:input.snapshot().mode === 'mic' ? 'mic' : 'media'});
        if (result.superseded) { job.resolve(false); return; }
      }
      // Every installed revision must be drawn, even if a newer edit is queued.
      // Desired state and the actually processing graph are distinct lifecycles.
      network = next; networkBytes=data.sceneBytes; preview = next; status = {};
      cpuEstimate = data.measurement.cpuLoad; requiredDelayBytes = data.requiredDelayBytes;
      if(next.revision===revision){compiling = false; error = '';}
      emit(); job.resolve(true);
      if (context && !audioDesired && !micStream) await context.suspend();
    } catch (reason) { if(next.revision===revision){compiling=false;report(reason);}job.reject(reason); }
  };
  worker.onerror = event => { report(event.message); for (const job of builds.values()) job.reject(new Error(event.message)); builds.clear(); compiling=false; };
  async function prepareNetwork() {
    const nextRevision = ++revision; compiling = true; emit();
    let wasm;
    try { wasm = await loadModule(); }
    catch(reason) {if(nextRevision===revision){compiling=false;report(reason);}throw reason;}
    if (nextRevision !== revision || disposed) return false;
    for (const [id,job] of builds) { job.resolve(false); builds.delete(id); }
    return new Promise((resolve,reject) => {
      builds.set(nextRevision,{resolve,reject});
      worker.postMessage({revision:nextRevision,parameters,budget,manual,memoryBytes:memoryBytes/2,
        sampleRate:context?.sampleRate || 48000,module:wasm,performance});
    });
  }
  async function prepareContext() {
    if (disposed) throw new Error('Instrument has closed');
    if (contextPromise) return contextPromise;
    if (node && context?.state !== 'closed') return context;
    contextPromise = (async () => {
      // Create and resume synchronously inside the explicit Audio/Mic action.
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      context = new AudioContextClass({latencyHint:'interactive',sampleRate:48000}); contextGeneration++;
      const ownedContext=context;
      const resumed=context.resume();
      master = context.createGain(); master.gain.value = 0;
      releaseOutput = connectAudioOutput(context,master,{runtime:globalThis});
      const wasm = await loadModule();
      await resumed;
      if(disposed || ownedContext.state==='closed')throw new Error('Instrument has closed');
      await context.audioWorklet.addModule(new URL('./network-worklet.js',import.meta.url));
      if(disposed || ownedContext.state==='closed')throw new Error('Instrument has closed');
      node = new AudioWorkletNode(context,'fractal-delay-network',{numberOfInputs:1,numberOfOutputs:1,
        outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',
        processorOptions:{module:wasm,memoryReserveBytes:memoryBytes+16*1024*1024}});
      node.port.onmessage = ({data}) => {
        if (data.type === 'fatal') { audioDesired = audio = false; master.gain.value = 0; stopMicrophone(); input.stop(); report(data.error); return; }
        if (data.status && data.status.revision === network?.revision) { status = data.status; emit(); }
        const pending = requests.get(data.id);
        if (pending) { clearTimeout(pending.timer); requests.delete(data.id); data.error ? pending.reject(new Error(data.error)) : pending.resolve(data); }
      };
      node.onprocessorerror = () => { audioDesired = audio = false; input.stop(); stopMicrophone(); report('Audio processor stopped. Reload to restart.'); };
      node.connect(master); sendControls();
      await context.resume();
      if (!network || context.sampleRate !== 48000) await prepareNetwork();
      else await request('scene',{sceneBytes:networkBytes,revision:network.revision,parameters,performance,
        inputMode:input.snapshot().mode === 'mic' ? 'mic' : 'media'});
      if (!audioDesired && !micStream) await context.suspend();
      if(disposed || ownedContext.state==='closed')throw new Error('Instrument has closed');
      pollTimer = setInterval(() => {
        if (!node || (!audio && !micStream) || pollPending || disposed) return;
        // Large wave snapshots are read less often; sound never waits for them.
        if ((network?.edges.length || 0) > 1024 && performanceNow()-lastPoll < 250) return;
        pollPending=true; lastPoll=performanceNow();
        request('status').catch(report).finally(() => {pollPending=false;});
      }, 50);
      return context;
    })().catch(async reason => {
      if(!node || disposed){releaseOutput?.();master?.disconnect();if(context?.state!=='closed')await context?.close();}
      report(reason); throw reason;
    }).finally(() => {contextPromise=null;});
    return contextPromise;
  }
  let lastPoll = 0;
  const performanceNow = () => globalThis.performance.now();
  async function setAudio(enabled) {
    const token = ++audioVersion; audioDesired=!!enabled; error=''; emit();
    if (!enabled) {
      stopMicrophone(); input.stop(); audio=false;
      if (master && context?.state !== 'closed') {
        master.gain.cancelScheduledValues(context.currentTime); master.gain.setTargetAtTime(0,context.currentTime,.008);
        await wait(35);
        // A muted installer must keep receiving callbacks until its atomic ack.
        if (token === audioVersion && !audioDesired && !contextPromise && !compiling) await context.suspend();
      }
      emit(); return false;
    }
    try {
      await prepareContext(); if (token !== audioVersion || !audioDesired || disposed) return false;
      await context.resume(); sendControls(); audio=true;
      master.gain.cancelScheduledValues(context.currentTime); master.gain.setTargetAtTime(1,context.currentTime,.012);
      if (input.snapshot().mode !== 'mic') await input.start(); emit(); return true;
    } catch(reason) { if (token===audioVersion) audioDesired=audio=false; report(reason); throw reason; }
  }
  function stopMicrophone() {
    micVersion++; micPending=false; micNode?.disconnect(); micNode=null;
    micStream?.getTracks().forEach(track => track.stop()); micStream=null; emit();
    if(!audioDesired&&!compiling&&!contextPromise&&context?.state==='running')void context.suspend();
  }
  async function setMicrophoneEnabled(enabled) {
    if (!enabled) {stopMicrophone();return false;}
    if (micStream || micPending) return !!micStream;
    // Capture is independent of output arming, including muted metering.
    const contextReady=prepareContext();
    void setInputMode('mic');
    const token=++micVersion; micPending=true; emit();
    try {
      await contextReady;
      if(token!==micVersion || disposed) return false;
      const stream=await navigator.mediaDevices.getUserMedia({audio:audioInputConstraints(globalThis)});
      if(token!==micVersion || input.snapshot().mode!=='mic' || disposed) {
        stream.getTracks().forEach(track=>track.stop());return false;
      }
      await context.resume();
      if(token!==micVersion || disposed){stream.getTracks().forEach(track=>track.stop());return false;}
      micStream=stream; micNode=configureAudioInputNode(context.createMediaStreamSource(stream));
      sendControls(); micNode.connect(node); micPending=false; emit(); return true;
    } catch(reason) {if(token===micVersion){micPending=false;report(reason);}throw reason;}
  }
  async function setInputMode(mode) {
    if(mode==='sample')mode='samples';
    stopMicrophone(); input.selectMode(mode); sendControls();
    if(audio && mode!=='mic') await input.start(); emit();
  }
  async function setSample(id) {
    stopMicrophone(); input.selectMode('samples'); sendControls(); input.selectSample(id);
    if(audio)await input.start(); emit();
  }
  async function loadFile(file) {
    stopMicrophone(); input.selectMode('file'); sendControls(); await input.loadFile(file); emit();
  }
  async function setParameters(next) {
    const before=parameters; parameters=sanitizeParameters({...parameters,...next}); sendControls(); emit();
    if(GEOMETRY_KEYS.some(key=>before[key]!==parameters[key]))return prepareNetwork();
    return true;
  }
  function setPerformance(next) {performance=sanitizePerformance({...performance,...next});sendControls();emit();return Promise.resolve(true);}
  async function dispose() {
    if(disposed)return; audioDesired=false; audio=false; stopMicrophone();input.dispose();disposed=true;
    clearInterval(pollTimer);worker.terminate();
    for(const pending of requests.values()){clearTimeout(pending.timer);pending.resolve({superseded:true});}requests.clear();
    for(const pending of builds.values())pending.resolve(false);builds.clear();
    node?.port.postMessage({type:'dispose'});node?.disconnect();master?.disconnect();releaseOutput?.();
    if(context?.state!=='closed')await context?.close();listeners.clear();
  }
  const engine={getDiagnostics,setParameters,setPerformance,setAudio,setMicrophoneEnabled,setInputMode,setSample,loadFile,
    setInputLoop:loop=>input.setLoop(loop),restartInput:()=>input.restart(),stopInput:()=>{stopMicrophone();input.stop();},
    setVoiceBudget:async(value,override=false)=>{budget=Math.max(2,Math.min(16384,Math.floor(Number(value)||16384)));manual=!!override;return prepareNetwork();},
    subscribe(listener){listeners.add(listener);listener(getDiagnostics());return()=>listeners.delete(listener);},
    ready:()=>prepareNetwork(),dispose};
  singleton=engine; return engine;
}
export function getFractalDelayEngine(){return singleton;}

import { encodeUtf8, decodeUtf8 } from '../micmic/native/wasm-abi.js';
/** ABI bridge shared by the offline preflight worker and real-time worklet. */
export const NETWORK_PARAMETERS = Object.freeze({ timeMs: 140, decay: .84, coupling: .82, pitchOffset: 0, frozen: false });
export const NETWORK_PERFORMANCE = Object.freeze({ inputGain: .85, wet: .7, dry: .3, outputLevel: 1, outputBoostDb: 6,
  hpfHz: 30, lpfHz: 18000, compressorThresholdDb: -12, compressorRatio: 3,
  compressorAttackMs: 5, compressorReleaseMs: 120, compressorMakeupDb: 0 });
export const NETWORK_METRICS = Object.freeze(['sampleClock', 'activeEdges', 'revision', 'inputPeak', 'outputLeftPeak',
  'outputRightPeak', 'gainReductionDb', 'timeMs', 'timeTargetMs', 'requiredDelayBytes', 'preparedEdges', 'pitchOffset', 'sampleRate', 'releasingEdges']);


export function estimateSceneBytes(scene, sampleRate = 48000, maxTimeMs = 2000) {
  if (!Number.isFinite(sampleRate) || !Number.isFinite(maxTimeMs) || sampleRate <= 0 || maxTimeMs <= 0) return Infinity;
  return scene.edges.reduce((bytes, edge) => bytes + (Math.max(1, Math.ceil(edge.length * sampleRate * maxTimeMs * 1.25 / 1000)) + 4) * 8, 0);
}

export function createWasmNetwork(module, sampleRate = 48000, blockSize = 128) {
  const api = new WebAssembly.Instance(module, {}).exports;
  if (api.fd_abi_version() !== 1) throw new Error('Unsupported fractal delay ABI');
  const engine = api.fd_new(sampleRate);
  if (!engine) throw new Error('Unsupported audio sample rate');
  const pointers = Array.from({ length: 4 }, () => api.fd_alloc(blockSize * 4));
  const output = { left: null, right: null };
  let memory, views, dead = false, parameters = { ...NETWORK_PARAMETERS }, performance = { ...NETWORK_PERFORMANCE }, inputMode = 'mic';
  function refresh() {
    if (memory === api.memory.buffer) return;
    memory = api.memory.buffer;
    views = pointers.map(pointer => new Float32Array(memory, pointer, blockSize));
    output.left = views[2]; output.right = views[3];
  }
  function error(fallback) {
    refresh(); const length = api.fd_error_len(engine);
    return new Error(length ? decodeUtf8(new Uint8Array(memory, api.fd_error_ptr(engine), length)) : fallback);
  }
  function json(value, call) {
    const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : encodeUtf8(JSON.stringify(value)); const pointer = api.fd_alloc(bytes.length);
    try { new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes); return call(pointer, bytes.length); }
    finally { api.fd_free(pointer, bytes.length); refresh(); }
  }
  refresh();
  return {
    api, engine, sampleRate, blockSize,
    beginScene(scene, revision = 1) {
      if (!json(scene, (pointer, length) => api.fd_scene_begin(engine, pointer, length, revision))) throw error('The graph could not be prepared');
    },
    prepareStep(records = 1) { const result = api.fd_scene_step(engine, records); refresh(); return result; },
    prepareScene(scene, revision = 1) { this.beginScene(scene, revision); while (this.prepareStep(16) === 1) {} },
    abortScene() { api.fd_scene_abort(engine); refresh(); },
    retiredCount() { return api.fd_retired_count(engine); },
    reserveMemory(bytes) { if (!api.fd_reserve_memory(engine, bytes)) throw error('Invalid reserved audio memory'); refresh(); },
    controls(nextParameters = {}, nextPerformance = {}, nextInputMode = inputMode) {
      const nextP = { ...parameters, ...nextParameters }, nextF = { ...performance, ...nextPerformance };
      if (!json({ parameters: nextP, performance: nextF, inputMode: nextInputMode },
        (pointer, length) => api.fd_controls(engine, pointer, length))) throw error('The controls could not be applied');
      parameters = nextP; performance = nextF; inputMode = nextInputMode;
    },
    // Returned views belong to this engine; process() never allocates or copies
    // output. A consumer retaining PCM across callbacks must copy explicitly.
    process(left, right = left, frames = blockSize) {
      if (dead) throw new Error('The graph is disposed');
      if (frames > blockSize) throw new Error('Audio block exceeds allocated capacity');
      refresh(); views[0].fill(0); views[1].fill(0);
      if (left) views[0].set(left.length === frames ? left : left.subarray(0, frames));
      if (right) views[1].set(right.length === frames ? right : right.subarray(0, frames));
      api.fd_process(engine, ...pointers, frames);
      return output;
    },
    processInto(left, right, outLeft, outRight) {
      const output = this.process(left, right, outLeft.length); outLeft.set(outLeft.length === blockSize ? output.left : output.left.subarray(0, outLeft.length)); outRight.set(outRight.length === blockSize ? output.right : output.right.subarray(0, outRight.length));
    },
    status() {
      const pointer = api.fd_metrics_ptr(engine); refresh(); const raw = new Float64Array(memory, pointer, NETWORK_METRICS.length);
      const status = Object.fromEntries(NETWORK_METRICS.map((key, i) => [key, raw[i]]));
      const count = api.fd_edge_count(engine);
      status.edgeLevels = new Float32Array(memory, api.fd_edge_levels_ptr(engine), count).slice();
      status.edgeWaveforms = new Float32Array(memory, api.fd_edge_waveforms_ptr(engine), count * 32).slice();
      status.waveformSize = 32; status.audioTimeSeconds = status.sampleClock / sampleRate;
      return status;
    },
    collect(records = 1) { return api.fd_collect(engine, records); },
    dispose() { if (dead) return; dead = true; api.fd_drop(engine); for (const pointer of pointers) api.fd_free(pointer, blockSize * 4); }
  };
}

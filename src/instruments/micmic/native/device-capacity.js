import { DEFAULT_PERFORMANCE } from './model.js';
import { withBytes, withJson, wasmError } from './wasm-abi.js';

const BLOCK = 128, TARGET_LOAD = .55;
const clock = () => performance.now();

/** Measure the real Rust DSP in a disposable worker instance, never in the
 * playing graph. The time allowance bounds calibration, not device capacity:
 * later scene edits can validate larger pools without growing a playing tree. */
export function measureAudioCapacity(module, sampleRate = 48000, { now = clock, timeAllowanceMs = 450 } = {}) {
  const api = new WebAssembly.Instance(module, {}).exports;
  const renderer = api.lsd_new(sampleRate, 1);
  if (!renderer) throw new Error(wasmError(api, 'Device capacity could not be measured.'));
  const pointers = Array.from({ length: 4 }, () => api.lsd_alloc(BLOCK * 4));
  const started = now(), measurements = [];
  let voices = 32, proved = 1, lastLoad = 0;
  const process = count => {
    for (let block = 0; block < count; block++) {
      if (!api.lsd_process(renderer, ...pointers, BLOCK)) throw new Error(wasmError(api, 'The capacity probe could not render.'));
    }
  };
  try {
    if (pointers.some(pointer => !pointer)) throw new Error('Capacity probe buffers could not be allocated.');
    while (true) {
      const bytes = new Uint8Array(32 + voices * 48), view = new DataView(bytes.buffer);
      view.setUint32(0, 0x4c534431, true); view.setUint32(4, 1, true);
      view.setUint32(8, voices, true); view.setUint32(12, voices, true); view.setFloat64(24, 1, true);
      for (let index = 0; index < voices; index++) {
        const at = 32 + index * 48;
        view.setFloat64(at, .025 + index % 7 * .002, true);
        // Pitched granular reads cost more than unison taps. Measure them so a
        // preset change cannot inherit an optimistic unison-only allocation.
        view.setFloat64(at + 8, [1.31, .77, 1.91, .4][index % 4], true);
        view.setFloat64(at + 16, .5 / Math.sqrt(voices), true);
        view.setFloat64(at + 24, index % 2 ? .5 : -.5, true);
        view.setUint32(at + 32, index, true); view.setUint32(at + 36, index + 1, true);
        view.setUint32(at + 40, 1, true);
      }
      if (!withBytes(api, bytes, (pointer, length) => api.lsd_install(renderer, pointer, length))) throw new Error(wasmError(api, 'Capacity probe topology could not install.'));
      if (!withJson(api, { ...DEFAULT_PERFORMANCE, automatic: false, voiceCeiling: voices, source: 'mic', wet: 1, dry: 0 },
        (pointer, length) => api.lsd_performance(renderer, pointer, length))) throw new Error('Capacity probe settings could not install.');
      for (const pointer of pointers.slice(0, 2)) {
        const input = new Float32Array(api.memory.buffer, pointer, BLOCK);
        for (let index = 0; index < BLOCK; index++) input[index] = .08 * Math.sin(index * .13);
      }
      process(64); // Populate history and settle voice attack before measuring.
      const times = [];
      for (let trial = 0; trial < 3; trial++) {
        let blocks = 0, elapsed = 0;
        const at = now();
        do { process(16); blocks += 16; elapsed = now() - at; } while (elapsed < 8 && blocks < 4096);
        times.push(elapsed / 1000 / (blocks * BLOCK / sampleRate));
      }
      times.sort((a, b) => a - b);
      lastLoad = Math.max(.000001, times[1]);
      measurements.push({ voices, load: lastLoad });
      if (lastLoad <= TARGET_LOAD) proved = voices;
      if (lastLoad >= TARGET_LOAD || now() - started >= timeAllowanceMs) break;
      // Every larger allocation is verified; no extrapolated final voice cap.
      voices *= 2;
    }
    if (proved === 1 && lastLoad > TARGET_LOAD) proved = Math.max(1, Math.floor(voices * TARGET_LOAD / lastLoad));
    return { voices: proved, targetLoad: TARGET_LOAD, measuredLoad: lastLoad,
      sampleRate, elapsedMs: Math.max(0, now() - started), measurements };
  } finally {
    api.lsd_drop(renderer);
    for (const pointer of pointers) if (pointer) api.lsd_free(pointer, BLOCK * 4);
  }
}

/** Validate the candidate's real pitched DSP, including long delayed reads.
 * The dedicated calibration constructor cannot mutate a playing renderer's
 * history. Only this disposable worker instance receives synthetic history. */
export function measurePreparedPool(module, pool, sampleRate = 48000, { now = clock, pitchOffset = 0,
  performance: settings = DEFAULT_PERFORMANCE, targetLoad = TARGET_LOAD } = {}) {
  const api = new WebAssembly.Instance(module, {}).exports;
  const bytes = pool instanceof Uint8Array ? pool : new Uint8Array(pool);
  const voices = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  const renderer = api.lsd_new_calibration(sampleRate, Math.max(1, voices));
  if (!renderer) throw new Error(wasmError(api, 'The next scene could not be measured.'));
  const pointers = Array.from({ length: 4 }, () => api.lsd_alloc(BLOCK * 4));
  const process = count => {
    for (let block = 0; block < count; block++) {
      if (!api.lsd_process(renderer, ...pointers, BLOCK)) throw new Error(wasmError(api, 'The next scene probe could not render.'));
    }
  };
  try {
    if (pointers.some(pointer => !pointer)) throw new Error('Scene probe buffers could not be allocated.');
    if (!withBytes(api, bytes, (pointer, length) => api.lsd_install(renderer, pointer, length))
      || !api.lsd_depth(renderer, 1)
      || !api.lsd_pitch_offset(renderer, pitchOffset)
      || !withJson(api, { ...settings, automatic: false, voiceCeiling: voices, source: 'mic', frozen: false, inputGain: 1, wet: 1, dry: 0 },
        (pointer, length) => api.lsd_performance(renderer, pointer, length))
      || !api.lsd_prepare_calibration_history(renderer)) {
      throw new Error(wasmError(api, 'The next scene probe could not prepare its full delay history.'));
    }
    for (const pointer of pointers.slice(0, 2)) {
      const input = new Float32Array(api.memory.buffer, pointer, BLOCK);
      for (let index = 0; index < BLOCK; index++) input[index] = .08 * Math.sin(index * .13);
    }
    process(64);
    const times = [];
    for (let trial = 0; trial < 3; trial++) {
      let blocks = 0, elapsed = 0;
      const at = now();
      do { process(16); blocks += 16; elapsed = now() - at; } while (elapsed < 8 && blocks < 4096);
      times.push(elapsed / 1000 / (blocks * BLOCK / sampleRate));
    }
    times.sort((a, b) => a - b);
    const load = times[1];
    return { voices, load, targetLoad, proved: voices > 0 && Number.isFinite(load) && load >= 0 && load <= targetLoad };
  } finally {
    api.lsd_drop(renderer);
    for (const pointer of pointers) if (pointer) api.lsd_free(pointer, BLOCK * 4);
  }
}

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const DEADLINE_LOAD = .95;

function fullPoolProof(current, status, requested, { topologyRevision, eligibleVoices,
  preparedVoices, settled = true } = {}) {
  if (!settled || !status || status.failure || status.error || !(requested > current)) return null;
  const prepared = preparedVoices ?? status.requestedTargets ?? current;
  const eligible = eligibleVoices ?? prepared;
  // Quiet, small and history-ineligible trees do not measure the work of a
  // larger pool. Complete tiling derivations may use less than their budget.
  if (count(current) === null || current < 1 || count(prepared) === null || prepared < 1
    || prepared > current || count(eligible) === null || eligible !== prepared) return null;
  if (status.requestedTargets !== undefined && status.requestedTargets !== prepared) return null;
  if (topologyRevision !== undefined && status.topologyRevision !== topologyRevision) return null;
  if (count(status.voiceLimit) === null || status.voiceLimit < eligible
    || count(status.calibratedVoices) === null || status.calibratedVoices < eligible
    || status.targetVoices !== eligible || status.activeVoices !== status.targetVoices) return null;
  if (![status.cpuLoad, status.peakLoad].every(value => Number.isFinite(value) && value >= 0)) return null;
  const load = Math.max(status.cpuLoad, status.peakLoad);
  if (!Number.isFinite(load) || load <= 0 || load >= DEADLINE_LOAD) return null;
  return { load, prepared, eligible, revision: topologyRevision ?? status.topologyRevision };
}

/** Preparation retains its high-water budget: Rust already releases active
 * voices on overload, and a smaller topology does not reclaim pool storage.
 * A proved full pool proposes only part of its remaining deadline headroom;
 * the worker validates it on the next explicit scene edit, without a final cap. */
export function nextPreparedCapacity(current, status, requested, context = {}) {
  const proof = fullPoolProof(current, status, requested, context);
  if (!proof) return current;
  const proportion = Math.min(.35, (DEADLINE_LOAD - proof.load) * .65 / proof.load);
  return Math.min(requested, Number.MAX_SAFE_INTEGER,
    current + Math.max(1, Math.floor(current * proportion)));
}

/** Prove recurring headroom across coherent audio-clock samples. Call on each
 * status refresh, with settled:false during edits, installs or failures; reset
 * before a user edit. Sparse polling cannot masquerade as sustained evidence. */
export function createPreparedCapacityController({ sustainSeconds = 3, maxSampleGapSeconds = 1 } = {}) {
  const duration = Number.isFinite(sustainSeconds) && sustainSeconds > 0 ? sustainSeconds : 3;
  const maxGap = Number.isFinite(maxSampleGapSeconds) && maxSampleGapSeconds > 0 ? maxSampleGapSeconds : 1;
  let since = null, previousTime = null, identity = null, worstLoad = 0;
  let counters = null;
  const reset = () => { since = previousTime = identity = counters = null; worstLoad = 0; };
  return {
    reset,
    observe({ nowSeconds, current, requested, status, topologyRevision,
      eligibleVoices, preparedVoices, settled = true } = {}) {
      const context = { topologyRevision, eligibleVoices, preparedVoices, settled };
      const proof = fullPoolProof(current, status, requested, context);
      if (!proof || !Number.isFinite(nowSeconds) || nowSeconds < 0) { reset(); return current; }
      const nextIdentity = [current, requested, proof.revision, proof.prepared, proof.eligible].join(':');
      const nextCounters = ['deadlineMisses', 'underruns', 'overruns'].map(key => status[key] ?? 0);
      if (nextCounters.some(value => count(value) === null)) { reset(); return current; }
      const clockChanged = previousTime !== null && (nowSeconds < previousTime || nowSeconds - previousTime > maxGap);
      const missed = counters && nextCounters.some((value, index) => value !== counters[index]);
      if (identity !== nextIdentity || clockChanged || missed) reset();
      if (previousTime === nowSeconds) return current;
      identity = nextIdentity; counters = nextCounters; previousTime = nowSeconds;
      since ??= nowSeconds; worstLoad = Math.max(worstLoad, proof.load);
      if (nowSeconds - since < duration) return current;
      const next = nextPreparedCapacity(current, { ...status, cpuLoad: worstLoad, peakLoad: worstLoad }, requested, context);
      reset();
      return next;
    },
  };
}

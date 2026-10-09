import { decodeUtf8, wasmError, withJson } from './wasm-abi.js';
import { measureAudioCapacity, measurePreparedPool } from './device-capacity.js';

const WASM_URL = new URL('../../../../assets/wasm/l-system-delay.wasm', import.meta.url);
let api, module;
const loaded = fetch(WASM_URL).then(async response => {
  if (!response.ok) throw new Error(`The Rust delay engine could not load (${response.status}).`);
  module = await WebAssembly.compile(await response.arrayBuffer());
  api = new WebAssembly.Instance(module, {}).exports;
});
let chain = Promise.resolve(), latestRevision = 0;
const capacities = new Map();

self.onmessage = ({ data }) => {
  latestRevision = Math.max(latestRevision, data.revision);
  chain = chain.catch(() => {}).then(async () => {
    try {
      await loaded;
      if (data.replaceable && data.revision < latestRevision) { self.postMessage({ id: data.id, revision: data.revision, skipped: true }); return; }
      // A trapping compilation may leave Rust's allocator mid-operation. Keep
      // the live audio pool and retry future edits with a fresh compiler instance.
      if (!api) api = new WebAssembly.Instance(module, {}).exports;
      const rate = data.sampleRate || 48000;
      if (!capacities.has(rate)) capacities.set(rate, measureAudioCapacity(module, rate));
      const calibration = capacities.get(rate);
      let voiceBudget = Math.max(1, Math.floor(data.voiceBudget || calibration.voices));
      const fallbackBudget = Math.max(1, Math.floor(data.fallbackVoiceBudget || calibration.voices));
      let capacityFailure = null, sceneMeasurement = null;
      while (true) {
        let handle = 0;
        try {
          handle = withJson(api, data.parameters, (pointer, length) => api.lsd_compile_bounded(pointer, length, rate, voiceBudget));
          if (!handle) throw new Error(wasmError(api, 'This topology exceeds the available browser memory.'));
          const result = JSON.parse(decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_compile_json_ptr(handle), api.lsd_compile_json_len(handle))));
          const pool = new Uint8Array(api.memory.buffer, api.lsd_compile_pool_ptr(handle), api.lsd_compile_pool_len(handle)).slice().buffer;
          const header = new DataView(pool);
          header.setUint32(16, data.revision >>> 0, true);
          header.setUint32(20, Math.floor(data.revision / 2 ** 32), true);
          if (data.validateCapacity && voiceBudget > fallbackBudget) {
            if (result.preparedVoices <= fallbackBudget) {
              // This complete small scene fits existing proof; it neither
              // needs a benchmark nor establishes the proposed larger budget.
              voiceBudget = fallbackBudget;
            } else {
              sceneMeasurement = measurePreparedPool(module, pool, rate, { performance: data.performance, targetLoad: .95 });
              if (!sceneMeasurement.proved || sceneMeasurement.voices !== result.preparedVoices) {
                // History-ineligible slots cannot prove a larger reusable
                // budget, even if their actual eligible voices are cheap.
                capacityFailure = 'The larger scene budget was not proved; retained measured capacity.';
                voiceBudget = fallbackBudget;
                continue;
              }
              // Complete tiling derivations can use fewer voices than their
              // proposed budget. Retain the actual proved count as capacity.
              voiceBudget = Math.max(fallbackBudget, sceneMeasurement.voices);
            }
          }
          if (data.replaceable && data.revision < latestRevision) {
            self.postMessage({ id: data.id, revision: data.revision, skipped: true }); return;
          }
          self.postMessage({ id: data.id, revision: data.revision, result, pool, module, calibration,
            voiceBudget, capacityFailure, sceneMeasurement }, [pool]);
          break;
        } catch (error) {
          if (!data.validateCapacity || voiceBudget <= fallbackBudget) throw error;
          // Optional headroom must never reject an otherwise playable preset.
          capacityFailure = String(error.message || error); voiceBudget = fallbackBudget;
          if (error instanceof WebAssembly.RuntimeError) { api = new WebAssembly.Instance(module, {}).exports; handle = 0; }
        } finally { if (handle) api.lsd_compile_free(handle); }
      }
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) api = null;
      self.postMessage({ id: data.id, error: String(error.message || error) });
    }
  });
};

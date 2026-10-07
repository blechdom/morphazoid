import { decodeUtf8, wasmError, withJson } from './wasm-abi.js';
import { measureAudioCapacity } from './device-capacity.js';

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
      const voiceBudget = Math.max(1, Math.floor(data.voiceBudget || calibration.voices));
      const handle = withJson(api, data.parameters, (pointer, length) => api.lsd_compile_bounded(pointer, length, rate, voiceBudget));
      if (!handle) throw new Error(wasmError(api, 'This topology exceeds the available browser memory.'));
      try {
        const result = JSON.parse(decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_compile_json_ptr(handle), api.lsd_compile_json_len(handle))));
        const pool = new Uint8Array(api.memory.buffer, api.lsd_compile_pool_ptr(handle), api.lsd_compile_pool_len(handle)).slice().buffer;
        const header = new DataView(pool);
        header.setUint32(16, data.revision >>> 0, true);
        header.setUint32(20, Math.floor(data.revision / 2 ** 32), true);
        self.postMessage({ id: data.id, revision: data.revision, result, pool, module, calibration, voiceBudget }, [pool]);
      } finally { api.lsd_compile_free(handle); }
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) api = null;
      self.postMessage({ id: data.id, error: String(error.message || error) });
    }
  });
};

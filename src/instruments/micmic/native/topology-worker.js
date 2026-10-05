import { decodeUtf8, wasmError, withJson } from './wasm-abi.js';

const WASM_URL = new URL('../../../../assets/wasm/l-system-delay.wasm', import.meta.url);
let api, module;
const loaded = fetch(WASM_URL).then(async response => {
  if (!response.ok) throw new Error(`The Rust delay engine could not load (${response.status}).`);
  module = await WebAssembly.compile(await response.arrayBuffer());
  api = new WebAssembly.Instance(module, {}).exports;
});
let chain = Promise.resolve();

self.onmessage = ({ data }) => {
  chain = chain.catch(() => {}).then(async () => {
    try {
      await loaded;
      // A trapping compilation may leave Rust's allocator mid-operation. Keep
      // the live audio pool and retry future edits with a fresh compiler instance.
      if (!api) api = new WebAssembly.Instance(module, {}).exports;
      const handle = withJson(api, data.parameters, (pointer, length) => api.lsd_compile(pointer, length, data.sampleRate || 48000));
      if (!handle) throw new Error(wasmError(api, 'This topology exceeds the available browser memory.'));
      try {
        const result = JSON.parse(decodeUtf8(new Uint8Array(api.memory.buffer, api.lsd_compile_json_ptr(handle), api.lsd_compile_json_len(handle))));
        const pool = new Uint8Array(api.memory.buffer, api.lsd_compile_pool_ptr(handle), api.lsd_compile_pool_len(handle)).slice().buffer;
        const header = new DataView(pool);
        header.setUint32(16, data.revision >>> 0, true);
        header.setUint32(20, Math.floor(data.revision / 2 ** 32), true);
        self.postMessage({ id: data.id, revision: data.revision, result, pool, module }, [pool]);
      } finally { api.lsd_compile_free(handle); }
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) api = null;
      self.postMessage({ id: data.id, error: String(error.message || error) });
    }
  });
};

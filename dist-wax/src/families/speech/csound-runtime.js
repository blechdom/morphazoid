// Original bounded, device-free host for the pinned Csound WASI binary.
// Render only authored orchestras in a disposable speech worker.
export function renderCsound(module, orchestra, score, { maxSeconds = 30 } = {}) {
  if (orchestra.length > 50000 || score.length > 50000 || !(maxSeconds > 0 && maxSeconds <= 60)) throw new Error('Csound render exceeds bounds.');
  const header = new Uint8Array(WebAssembly.Module.customSections(module, 'dylink.0')[0]);
  let cursor = 0;
  const leb = () => { let value = 0, shift = 0, byte; do { byte = header[cursor++]; value |= (byte & 127) << shift; shift += 7; } while (byte & 128); return value; };
  if (leb() !== 1) throw new Error('Unsupported Csound WASM layout.');
  leb(); const memorySize = leb(); leb(); const tableSize = leb();
  if (memorySize > 4e6 || tableSize > 10000) throw new Error('Unexpected Csound memory layout.');
  const initial = Math.ceil(memorySize / 65536) + 128;
  const memory = new WebAssembly.Memory({ initial, maximum: 2048 });
  const bytes = () => new Uint8Array(memory.buffer), view = () => new DataView(memory.buffer);
  const u32 = (p, v) => view().setUint32(p, v, true);
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  let messages = '';
  const log = (p, length) => { if (messages.length < 12000) messages += decoder.decode(bytes().subarray(p, p + length)); };
  const wasi = {
    args_sizes_get(a, b) { u32(a, 0); u32(b, 0); return 0; }, args_get: () => 0,
    environ_sizes_get(a, b) { u32(a, 0); u32(b, 0); return 0; }, environ_get: () => 0,
    clock_time_get(_clock, _precision, p) { view().setBigUint64(p, 1000000000n, true); return 0; },
    fd_fdstat_get(fd, p) { bytes().fill(0, p, p + 24); bytes()[p] = 2; return fd < 3 ? 0 : 8; },
    fd_fdstat_set_flags: () => 0, fd_prestat_get: () => 8, fd_prestat_dir_name: () => 8, fd_close: () => 0,
    fd_write(_fd, ptr, count, written) { let total = 0; for (let n = 0; n < count; n++) { const p = view().getUint32(ptr + n * 8, true), length = view().getUint32(ptr + n * 8 + 4, true); log(p, length); total += length; } u32(written, total); return 0; },
    fd_read: () => 8, fd_seek: () => 8, fd_tell: () => 8, fd_filestat_get: () => 8, fd_filestat_set_size: () => 8,
    path_open: () => 44, path_filestat_get: () => 44, path_remove_directory: () => 44, path_unlink_file: () => 44, poll_oneoff: () => 52,
    proc_exit(code) { if (code) throw new Error(`Csound exited with ${code}.`); },
  };
  const global = (value, mutable = false) => new WebAssembly.Global({ value: 'i32', mutable }, value);
  const instance = new WebAssembly.Instance(module, {
    env: { memory, __indirect_function_table: new WebAssembly.Table({ initial: tableSize + 1, element: 'anyfunc' }),
      __stack_pointer: global(initial * 65536, true), __memory_base: global(4096), __table_base: global(1),
      csoundLoadModules: () => 0, csoundWasiJsMessageCallback: (_c, _a, length, p) => log(p, length), printDebugCallback: log },
    wasi_snapshot_preview1: wasi, 'GOT.mem': { __heap_base: global(initial * 65536, true) },
  });
  const api = instance.exports;
  api._start(); api.__wasi_js_csoundSetMessageStringCallback();
  const csound = api.csoundCreate(0);
  const call = (name, text) => { const data = encoder.encode(text), p = api.allocStringMem(data.length); try { bytes().set(data, p); return api[name](csound, p); } finally { api.freeStringMem(p); } };
  try {
    for (const option of ['-n', '-d', '-m0']) call('csoundSetOption', option);
    if (call('csoundCompileOrc', orchestra) || call('csoundReadScore', score) || api.csoundStart(csound)) throw new Error(`Csound voice compilation failed: ${messages}`);
    const sampleRate = api.csoundGetSr(csound), blockSize = api.csoundGetKsmps(csound);
    if (sampleRate < 8000 || sampleRate > 96000 || api.csoundGetNchnls(csound) !== 1) throw new Error('Unsupported voice audio format.');
    const output = new Float32Array(Math.ceil(maxSeconds * sampleRate));
    let length = 0, finished = false;
    while (length + blockSize <= output.length) {
      if (api.csoundPerformKsmpsWasi(csound)) { finished = true; break; }
      const block = new Float64Array(memory.buffer, api.csoundGetSpout(csound), blockSize);
      for (const value of block) { if (!Number.isFinite(value)) throw new Error('Non-finite Csound voice.'); output[length++] = value; }
    }
    if (!finished) throw new Error('Csound voice exceeded its render limit.');
    return { samples: output.slice(0, length), sampleRate };
  } finally { api.csoundCleanup(csound); api.csoundDestroy(csound); }
}

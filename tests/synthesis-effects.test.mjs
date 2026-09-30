import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROCESSOR_METHODS } from '../src/instruments/synthesis/catalog.js';
const api = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(new URL('../assets/wasm/synthesis.wasm', import.meta.url)))).exports;

test('all processor factory demonstrations have audible finite output and avoid the emergency knee', () => {
  assert.equal(api.proc_method_count(), PROCESSOR_METHODS.length);
  for (const method of PROCESSOR_METHODS) for (const preset of method.presets) {
    const engine = api.proc_new(48000), label = `${method.id}/${preset.id}`;
    try {
      api.proc_set_method(engine, method.processorId);
      new Float32Array(api.memory.buffer, api.proc_params_ptr(engine), 16).set(preset.params);
      api.proc_apply_params(engine);
      api.proc_set_mix(engine, preset.wet, 0, preset.inputDb, preset.outputDb);
      api.proc_set_source(engine, preset.source, preset.frequencyHz, 1);
      api.proc_reset(engine);
      let peak = 0, maxBlock = 0;
      for (let offset = 0; offset < 48000 * 3; offset += 128) {
        api.proc_process(engine, 128);
        for (let c = 0; c < 2; c++) {
          const samples = new Float32Array(api.memory.buffer, api.proc_output_ptr(engine, c), 128);
          let square = 0;
          for (const value of samples) {
            assert.ok(Number.isFinite(value), `${label}: finite output`);
            peak = Math.max(peak, Math.abs(value)); square += value * value;
          }
          maxBlock = Math.max(maxBlock, Math.sqrt(square / 128));
        }
      }
      assert.ok(peak <= .950001, `${label}: preset peak ${peak} reaches protection`);
      assert.ok(maxBlock > .008, `${label}: silent/very weak factory example (${20 * Math.log10(maxBlock)} dBFS)`);
    } finally { api.proc_free(engine); }
  }
});

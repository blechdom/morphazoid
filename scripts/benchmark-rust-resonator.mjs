// Kernel-only warm throughput, not a promise about physical devices or browsers.
import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createSimdResonatorConfiguration } from '../src/simd-resonator.js';

const root = new URL('../', import.meta.url);
const rows = [];
for (const family of ['simd', 'rust']) {
  for (const backend of ['scalar', 'simd']) {
    const bytes = await readFile(new URL(`assets/wasm/${family}-resonator-${backend}.wasm`, root));
    const { instance } = await WebAssembly.instantiate(bytes);
    const e = instance.exports;
    const capacity = e.max_modes();
    const arrays = Object.fromEntries(['cosine', 'sine', 'decay', 'strike', 'gain', 'pan_left', 'pan_right'].map(key => [key, new Float32Array(e.memory.buffer, e[`${key}_ptr`](), capacity)]));
    const input = new Float32Array(e.memory.buffer, e.input_ptr(), 128);
    for (let frame = 0; frame < 128; frame += 1) input[frame] = Math.sin(frame * 0.047) * 0.03;
    for (const modes of family === 'simd' ? [128] : [128, 512, 1024, 2048, 4096]) {
      if (modes === 128) {
        const configuration = createSimdResonatorConfiguration();
        for (const [key, view] of Object.entries(arrays)) view.set(configuration[key === 'pan_left' ? 'panLeft' : key === 'pan_right' ? 'panRight' : key]);
      } else {
        for (let mode = 0; mode < modes; mode += 1) {
          const position = mode / (modes - 1);
          const phase = 2 * Math.PI * 60 * 250 ** position / 48000;
          arrays.cosine[mode] = Math.cos(phase); arrays.sine[mode] = Math.sin(phase);
          arrays.decay[mode] = 0.99997; arrays.strike[mode] = Math.sin(mode * 2.399963);
          arrays.gain[mode] = 1 / Math.sqrt(1 + position * 10);
          arrays.pan_left[mode] = 0.707; arrays.pan_right[mode] = 0.707;
        }
      }
      e.reset_resonator();
      const scale = 0.1 / Math.sqrt(modes / 32);
      for (let block = 0; block < 256; block += 1) e.process_resonator(128, modes, block % 32 === 0 ? 0.8 : 0, scale);
      const timings = [];
      for (let round = 0; round < 11; round += 1) {
        const started = performance.now();
        for (let block = 0; block < 200; block += 1) e.process_resonator(128, modes, block % 32 === 0 ? 0.8 : 0, scale);
        timings.push((performance.now() - started) * 1000 / 200);
      }
      timings.sort((a, b) => a - b);
      const medianMicros = timings[5];
      rows.push({ family: family === 'simd' ? 'original AssemblyScript' : 'Rust', backend, modes,
        medianMicros: Number(medianMicros.toFixed(3)), slowestRoundMicros: Number(timings[10].toFixed(3)),
        quantumPercent48k: Number((medianMicros / (128 / 48000 * 1e6) * 100).toFixed(2)) });
    }
  }
}
console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  sampleRate: 48000, blockSize: 128, scope: 'warm Node/Wasm kernel only; excludes FFT, message/UI work and output device', rows }, null, 2));

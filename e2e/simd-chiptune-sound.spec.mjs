import { expect, test } from "@playwright/test";

// Uses the same opt-in and Chromium launch flags as webgpu-chiptune.spec.mjs:
// MORPHAZOID_WEBGPU_QA=1 adds --enable-unsafe-webgpu in playwright.config.mjs.
// This compares the actual current WGSL renderer with the shipped WASM, rather
// than pinning noisy samples to one GPU driver's transcendental implementation.
test("SIMD preserves source Song/Pattern tones and the noise/drum spectral envelope", async ({ page }, testInfo) => {
  test.skip(process.env.MORPHAZOID_WEBGPU_QA !== "1", "Enable actual WebGPU audio comparisons with MORPHAZOID_WEBGPU_QA=1.");
  test.setTimeout(30_000);
  await page.goto("webgpu-chiptune.html", { waitUntil: "domcontentloaded" });
  const report = await page.evaluate(async () => {
    let adapter;
    try {
      adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) return { unavailable: "No WebGPU adapter is available." };
      const probe = await adapter.requestDevice();
      probe.destroy();
    } catch (error) {
      return { unavailable: `WebGPU device unavailable: ${error.message}` };
    }
    const model = await import("./src/instruments/webgpu-chiptune/webgpu-chiptune.js");
    const defaults = model.WEBGPU_CHIPTUNE_DEFAULTS;
    const sequences = { song: model.WEBGPU_CHIPTUNE_DEFAULT_SEQUENCE,
      pattern: model.createWebGpuChiptunePattern(defaults) };
    const sampleRate = 48000, frames = 4096;
    const context = new OfflineAudioContext(2, sampleRate, sampleRate);
    const gpu = new model.WebGpuChiptuneAudio(globalThis, { chunkDuration: frames / sampleRate });
    const response = await fetch("./assets/wasm/simd-chiptune-simd.wasm");
    if (!response.ok) throw new Error(`Cannot load SIMD engine: ${response.status}`);
    const wasm = (await WebAssembly.instantiate(await response.arrayBuffer())).instance.exports;
    const parameters = new Float32Array(wasm.memory.buffer, wasm.params_ptr(), 154);
    const meta = new Uint8Array(wasm.memory.buffer, wasm.sequence_meta_ptr(), 192);
    const cells = new Uint8Array(wasm.memory.buffer, wasm.sequence_cells_ptr(), 9216);
    const time = new Float32Array(wasm.memory.buffer, wasm.time_info_ptr(), 4);
    const left = new Float32Array(wasm.memory.buffer, wasm.output_left_ptr(), 128);
    const right = new Float32Array(wasm.memory.buffer, wasm.output_right_ptr(), 128);

    function renderSimd(params, sequence, offset) {
      wasm.reset();
      parameters.set(model.webGpuChiptuneParamArray(params));
      const packed = model.packWebGpuChiptuneSequence(sequence);
      meta.set(new Uint8Array(packed.meta.buffer));
      cells.set(new Uint8Array(packed.cells));
      time.set([0, -1, 0, -1]);
      const output = new Float32Array(frames * 2);
      for (let start = 0; start < frames; start += 128) {
        // The worklet also evaluates an analytical time per 128-frame block.
        wasm.process(128, sampleRate, offset + start / sampleRate);
        for (let i = 0; i < 128; i += 1) {
          output[(start + i) * 2] = left[i];
          output[(start + i) * 2 + 1] = right[i];
        }
      }
      return output;
    }

    function compare(a, b) {
      let aa = 0, bb = 0, ab = 0, difference = 0, peak = 0;
      let finite = true;
      for (let i = 0; i < a.length; i += 1) {
        finite &&= Number.isFinite(a[i]) && Number.isFinite(b[i]);
        aa += a[i] ** 2; bb += b[i] ** 2; ab += a[i] * b[i];
        difference += (a[i] - b[i]) ** 2;
        peak = Math.max(peak, Math.abs(a[i]), Math.abs(b[i]));
      }
      return { gpuRms: Math.sqrt(aa / a.length), simdRms: Math.sqrt(bb / b.length),
        rmsDifference: Math.sqrt(difference / a.length),
        levelDb: 10 * Math.log10(Math.max(1e-30, bb) / Math.max(1e-30, aa)),
        correlation: ab / Math.max(1e-30, Math.sqrt(aa * bb)), peak, finite };
    }

    // Hann-windowed mono FFT, accumulated into broad frequency bands. No
    // waveform-correlation assertion is appropriate for the shader's hash noise.
    function spectrum(stereo) {
      const re = new Float64Array(frames), im = new Float64Array(frames);
      for (let i = 0; i < frames; i += 1) {
        re[i] = (stereo[i * 2] + stereo[i * 2 + 1]) * 0.5
          * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frames - 1)));
      }
      for (let i = 1, j = 0; i < frames; i += 1) {
        let bit = frames >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) [re[i], re[j]] = [re[j], re[i]];
      }
      for (let length = 2; length <= frames; length <<= 1) {
        const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle);
        for (let start = 0; start < frames; start += length) {
          let xr = 1, xi = 0;
          for (let j = 0; j < length / 2; j += 1) {
            const u = start + j, v = u + length / 2;
            const tr = re[v] * xr - im[v] * xi, ti = re[v] * xi + im[v] * xr;
            re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
            const nextX = xr * wr - xi * wi; xi = xr * wi + xi * wr; xr = nextX;
          }
        }
      }
      const bands = [0, 0, 0, 0, 0], edges = [100, 400, 2000, 8000, 24000];
      let total = 0, weighted = 0;
      for (let bin = 1; bin < frames / 2; bin += 1) {
        const frequency = bin * sampleRate / frames, power = re[bin] ** 2 + im[bin] ** 2;
        total += power; weighted += power * frequency;
        bands[edges.findIndex(edge => frequency < edge)] += power;
      }
      return { bands, total, weighted };
    }
    function accumulator() { return { energy: 0, total: 0, weighted: 0, bands: [0, 0, 0, 0, 0], envelope: [] }; }
    function accumulate(target, samples, rms) {
      const analysis = spectrum(samples);
      target.energy += rms ** 2; target.envelope.push(rms);
      target.total += analysis.total; target.weighted += analysis.weighted;
      target.bands = target.bands.map((power, i) => power + analysis.bands[i]);
    }
    function finish(target) {
      return { rms: Math.sqrt(target.energy / target.envelope.length),
        centroid: target.weighted / target.total,
        bands: target.bands.map(power => power / target.total), envelope: target.envelope };
    }
    function envelopeCorrelation(a, b) {
      const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
      const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
      let aa = 0, bb = 0, ab = 0;
      for (let i = 0; i < a.length; i += 1) {
        const x = a[i] - meanA, y = b[i] - meanB;
        aa += x * x; bb += y * y; ab += x * y;
      }
      return ab / Math.sqrt(aa * bb);
    }

    const stems = { upperOne: ["upperOneLevel"], upperTwo: ["upperTwoLevel"],
      bass: ["bassPulseLevel", "bassSineLevel"], lead: ["leadLevel"], arp: ["arpLevel"] };
    const silence = Object.fromEntries([...Object.values(stems).flat(), "noiseLevel", "drumMix"].map(key => [key, 0]));
    const tones = [], complete = [], textures = [];
    try {
      await gpu.start(defaults, { context, destination: context.destination, autoStart: false });
      for (const [mode, sequence] of Object.entries(sequences)) {
        for (const offset of [2.137, 10]) {
          complete.push({ mode, offset, ...compare(await gpu.renderChunk(offset, defaults, sequence), renderSimd(defaults, sequence, offset)) });
        }
        for (const [stem, keys] of Object.entries(stems)) {
          const params = { ...defaults, ...silence, ...Object.fromEntries(keys.map(key => [key, defaults[key]])) };
          const offset = 25.03;
          tones.push({ mode, stem, offset, ...compare(await gpu.renderChunk(offset, params, sequence), renderSimd(params, sequence, offset)) });
        }
      }
      for (const [stem, key] of [["noise", "noiseLevel"], ["drums", "drumMix"]]) {
        const params = { ...defaults, ...silence, [key]: defaults[key] };
        const a = accumulator(), b = accumulator();
        let peak = 0, finite = true;
        // 32 windows span 8.02 seconds, including a complete texture cycle.
        // Sampling one of every three windows keeps this GPU check bounded.
        for (let window = 0; window < 32; window += 1) {
          const offset = window * 3 * frames / sampleRate;
          const original = await gpu.renderChunk(offset, params, sequences.song);
          const port = renderSimd(params, sequences.song, offset), stats = compare(original, port);
          peak = Math.max(peak, stats.peak); finite &&= stats.finite;
          accumulate(a, original, stats.gpuRms); accumulate(b, port, stats.simdRms);
        }
        const original = finish(a), port = finish(b);
        textures.push({ stem, gpu: original, simd: port, peak, finite,
          levelDb: 20 * Math.log10(port.rms / original.rms),
          centroidRatio: port.centroid / original.centroid,
          envelopeCorrelation: envelopeCorrelation(original.envelope, port.envelope) });
      }
      return { sampleRate, frames, adapter: { vendor: adapter.info?.vendor,
        architecture: adapter.info?.architecture, description: adapter.info?.description }, complete, tones, textures };
    } finally { await gpu.stop(); }
  });
  test.skip(Boolean(report.unavailable), report.unavailable ?? "");
  await testInfo.attach("gpu-simd-sound-comparison.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  for (const scene of [...report.complete, ...report.tones, ...report.textures]) {
    expect(scene.finite).toBe(true);
    expect(scene.peak).toBeLessThanOrEqual(0.880001);
  }
  for (const scene of report.complete) {
    expect(scene.gpuRms).toBeGreaterThan(0.01);
    // The full 2026-09-24 audit found <0.30 dB across 24 presets. Leave room
    // for driver-dependent hash noise while detecting material mix changes.
    expect(Math.abs(scene.levelDb), `${scene.mode} at ${scene.offset}s`).toBeLessThan(1);
  }
  for (const scene of report.tones) {
    expect(scene.gpuRms, `${scene.mode}/${scene.stem}`).toBeGreaterThan(0.0001);
    // Audit: <0.002 dB and correlation >=0.997 across these analytical tones.
    expect(Math.abs(scene.levelDb), `${scene.mode}/${scene.stem}`).toBeLessThan(0.1);
    expect(scene.correlation, `${scene.mode}/${scene.stem}`).toBeGreaterThan(0.985);
  }
  for (const scene of report.textures) {
    const noise = scene.stem === "noise";
    // Eight-second audit: noise -0.23 dB, centroid -2.3%, envelope r=0.974;
    // drums -0.02 dB, centroid -1.1%, envelope r=0.9998. Broad tolerances allow
    // stochastic realization changes without treating different noise samples
    // as a synthesis error, while guarding level, decay shape and color.
    expect(scene.gpu.rms).toBeGreaterThan(0.001);
    expect(Math.abs(scene.levelDb), scene.stem).toBeLessThan(noise ? 1.5 : 0.7);
    expect(scene.centroidRatio, scene.stem).toBeGreaterThan(noise ? 0.75 : 0.85);
    expect(scene.centroidRatio, scene.stem).toBeLessThan(noise ? 1.25 : 1.15);
    expect(scene.envelopeCorrelation, scene.stem).toBeGreaterThan(noise ? 0.9 : 0.98);
    for (let i = 0; i < scene.gpu.bands.length; i += 1) {
      expect(Math.abs(scene.gpu.bands[i] - scene.simd.bands[i]), `${scene.stem} band ${i}`).toBeLessThan(noise ? 0.08 : 0.04);
    }
  }
});

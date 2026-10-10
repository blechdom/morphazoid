import { createWasmNetwork } from './wasm-runtime.js';
const clock = typeof globalThis.performance?.now === 'function' ? () => globalThis.performance.now() : () => Date.now();
/** Sound generation is independent of UI and animation; preparation uses spare
 * callback time and activates one complete graph, never growing active layers. */
class FractalDelayNetworkProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.network = createWasmNetwork(options.processorOptions.module, sampleRate);
    this.pending = null; this.dead = false; this.failed = false; this.load = 0; this.peakLoad = 0;
    this.misses = 0; this.blocks = 0; this.controlSeconds = 0; this.lastStatusClock = -Infinity; this.preparationBlocked = 0;
    this.port.onmessage = ({ data }) => {
      const started = clock();
      try { this.message(data); }
      catch (error) {
        this.port.postMessage({ id: data.id, error: String(error.message || error) });
        if (error instanceof WebAssembly.RuntimeError) this.fail(error);
      } finally { this.controlSeconds += Math.max(0, clock() - started) / 1000; }
    };
    this.port.postMessage({ type: 'ready' });
  }
  message(data) {
    if (this.dead) return;
    if (data.type === 'scene') {
      // Latest scene wins, with a response for every superseded transaction.
      if (this.pending) { this.network.abortScene(); this.port.postMessage({ id: this.pending.id, superseded: true }); }
      if (data.parameters || data.performance || data.inputMode) this.network.controls(data.parameters, data.performance, data.inputMode);
      this.network.beginScene(data.scene, data.revision ?? data.id ?? 1);
      this.pending = { id: data.id };
      return;
    }
    if (data.type === 'controls') this.network.controls(data.parameters, data.performance, data.inputMode);
    else if (data.type === 'status') { this.postStatus(data.id); return; }
    else if (data.type === 'dispose') {
      this.dead = true; this.pending = null; this.network.dispose(); this.port.postMessage({ id: data.id }); return;
    }
    this.port.postMessage({ id: data.id });
  }
  postStatus(id) {
    const status = this.network.status();
    Object.assign(status, { cpuLoad: this.load, peakLoad: this.peakLoad, deadlineMisses: this.misses,
      processedBlocks: this.blocks, preparing: Boolean(this.pending), failure: this.failed });
    this.lastStatusClock = status.sampleClock;
    this.port.postMessage({ id, type: 'status', status }, [status.edgeLevels.buffer, status.edgeWaveforms.buffer]);
  }
  fail(error) {
    this.failed = true;
    this.port.postMessage({ type: 'fatal', error: String(error.message || error) });
  }
  process(inputs, outputs) {
    const output = outputs[0]; if (!output?.[0]) return !this.dead;
    const left = output[0], right = output[1] || output[0];
    if (this.dead || this.failed) { left.fill(0); right.fill(0); return !this.dead; }
    const started = clock(), duration = left.length / sampleRate;
    try {
      const input = inputs[0]; this.network.processInto(input?.[0], input?.[1] || input?.[0], left, right);
      const renderSeconds = Math.max(0, clock() - started) / 1000;
      // One edge per step bounds allocation/zeroing and historical copies. The
      // largest single ring is bounded by finite graph validation/reservation.
      // Never defer graph preparation forever after one noisy timing sample.
      if (this.pending) {
        this.preparationBlocked += duration;
        if (renderSeconds < duration * .45 || this.preparationBlocked > .05) {
          const result = this.network.prepareStep(1); this.preparationBlocked = 0;
          if (result === 2) { const id = this.pending.id; this.pending = null; this.port.postMessage({ id, installed: true }); }
        }
      }
      this.network.collect(1);
      const elapsed = Math.max(0, clock() - started) / 1000;
      const ratio = (elapsed + this.controlSeconds) / duration; this.controlSeconds = 0; this.load += (ratio - this.load) * .04; this.peakLoad = Math.max(ratio, this.peakLoad * .999);
      if (ratio > 1) this.misses++;
      this.blocks++;
      // No unsolicited full graph snapshots in the rendering callback. The UI
      // polls telemetry at a bounded rate, and audio can run with UI suspended.
    } catch (error) { left.fill(0); right.fill(0); this.fail(error); }
    return true;
  }
}
registerProcessor('fractal-delay-network', FractalDelayNetworkProcessor);

import { createWasmNetwork } from './wasm-runtime.js';
const clock = typeof globalThis.performance?.now === 'function' ? () => globalThis.performance.now() : () => Date.now();
/** Sound generation is independent of UI and animation; preparation uses spare
 * callback time and activates one complete graph, never growing active layers. */
class FractalDelayNetworkProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.network = createWasmNetwork(options.processorOptions.module, sampleRate);
    // Reserve virtual WASM/allocator space once, before input is connected.
    // Live maintenance fills this storage in small, measured chunks.
    this.network.reserveMemory(options.processorOptions.memoryReserveBytes || 256 * 1024 * 1024);
    this.queued = null; this.latestParameters = {}; this.latestPerformance = {}; this.latestInputMode = 'mic';
    this.pending = null; this.dead = false; this.failed = false; this.load = 0; this.peakLoad = 0;
    this.misses = 0; this.blocks = 0; this.controlSeconds = 0; this.lastStatusClock = -Infinity; this.preparationBlocked = 0; this.chunkSeconds = 0;
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
      if (this.pending) { this.network.abortScene(); this.port.postMessage({ id: this.pending.id, superseded: true }); this.pending = null; }
      if (this.queued) this.port.postMessage({ id: this.queued.id, superseded: true });
      this.rememberControls(data); this.queued = data;
      return;
    }
    if (data.type === 'controls') { this.network.controls(data.parameters, data.performance, data.inputMode); this.rememberControls(data); }
    else if (data.type === 'status') { this.postStatus(data.id); return; }
    else if (data.type === 'dispose') {
      this.dead = true; this.pending = null; this.queued = null; this.network.dispose(); this.port.postMessage({ id: data.id }); return;
    }
    this.port.postMessage({ id: data.id });
  }
  rememberControls(data) {
    if (data.parameters) this.latestParameters = { ...this.latestParameters, ...data.parameters };
    if (data.performance) this.latestPerformance = { ...this.latestPerformance, ...data.performance };
    if (data.inputMode) this.latestInputMode = data.inputMode;
  }
  startQueued() {
    if (!this.queued || this.pending || this.network.retiredCount()) return;
    const data = this.queued; this.queued = null;
    try {
      this.network.controls(this.latestParameters, this.latestPerformance, this.latestInputMode);
      this.network.beginScene(data.sceneBytes || data.scene, data.revision ?? data.id ?? 1);
      this.pending = { id: data.id };
    } catch (error) { this.port.postMessage({ id: data.id, error: String(error.message || error) }); if (error instanceof WebAssembly.RuntimeError) this.fail(error); }
  }
  postStatus(id) {
    const status = this.network.status();
    Object.assign(status, { cpuLoad: this.load, peakLoad: this.peakLoad, deadlineMisses: this.misses,
      processedBlocks: this.blocks, preparing: Boolean(this.pending || this.queued), failure: this.failed });
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
      // One small float-count chunk bounds history initialization and copying.
      // Never defer graph preparation forever after one noisy timing sample.
      this.network.collect(4);
      if (renderSeconds + this.controlSeconds < duration * .55) this.startQueued();
      if (this.pending) {
        this.preparationBlocked += duration;
        const forced = this.preparationBlocked > .05;
        for (let chunk = 0; chunk < 16 && this.pending; chunk++) {
          const spent = Math.max(0, clock() - started) / 1000 + this.controlSeconds;
          const available = duration * .75 - spent;
          if (!(available > Math.max(.000025, this.chunkSeconds * 1.5)) && !(forced && chunk === 0)) break;
          const chunkStarted = clock();
          const result = this.network.prepareStep(1);
          const seconds = Math.max(0, clock() - chunkStarted) / 1000;
          this.chunkSeconds = this.chunkSeconds ? this.chunkSeconds * .8 + seconds * .2 : seconds;
          this.preparationBlocked = 0;
          if (result === 2) { const id = this.pending.id; this.pending = null; this.port.postMessage({ id, installed: true }); }
        }
      }
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

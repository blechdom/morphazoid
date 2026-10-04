import { wasmError, withBytes, withJson } from './wasm-abi.js';

const BLOCK = 128, ENVELOPE_CAPACITY = 4000;
const fineClock = typeof globalThis.performance?.now === 'function';
const now = fineClock ? () => globalThis.performance.now() : () => Date.now();
const METRICS = ['sampleRate', 'activeVoices', 'targetVoices', 'voiceLimit', 'installedCapacity', 'requestedTargets',
  'cpuLoad', 'peakLoad', 'inputPeak', 'outputPeak', 'outputLeftPeak', 'outputRightPeak', 'gainReductionDb',
  'deadlineMisses', 'elapsedSeconds', 'wetBusGain', 'topologyRevision', 'automatic', 'source', 'calibratedVoices',
  'envelopeCount', 'envelopeEndTime', 'envelopeInterval', 'processedBlocks', 'underruns', 'overruns'];

/** Sample generation and capacity admission run in Rust, independently of UI/RAF. */
class LSystemDelayProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.api = new WebAssembly.Instance(options.processorOptions.module, {}).exports;
    this.engine = this.api.lsd_new(sampleRate, 1);
    if (!this.engine) throw new Error(wasmError(this.api, 'The Rust delay engine could not start.'));
    this.dead = false; this.failed = false; this.measuredSeconds = 0; this.measuredFrames = 0;
    this.inputLeftPointer = this.api.lsd_alloc(BLOCK * 4);
    this.inputRightPointer = this.api.lsd_alloc(BLOCK * 4);
    this.outputLeftPointer = this.api.lsd_alloc(BLOCK * 4);
    this.outputRightPointer = this.api.lsd_alloc(BLOCK * 4);
    if (!this.inputLeftPointer || !this.inputRightPointer || !this.outputLeftPointer || !this.outputRightPointer) throw new Error('The audio buffers could not be allocated.');
    this.refreshViews();
    this.port.onmessage = ({ data }) => {
      try { this.message(data); }
      catch (error) { this.port.postMessage({ id: data.id, error: String(error.message || error) }); }
    };
    this.port.postMessage({ type: 'ready', timing: fineClock ? 'high-resolution' : 'coarse-averaged' });
  }

  refreshViews() {
    const memory = this.api.memory.buffer;
    this.memory = memory;
    this.inputLeft = new Float32Array(memory, this.inputLeftPointer, BLOCK);
    this.inputRight = new Float32Array(memory, this.inputRightPointer, BLOCK);
    this.outputLeft = new Float32Array(memory, this.outputLeftPointer, BLOCK);
    this.outputRight = new Float32Array(memory, this.outputRightPointer, BLOCK);
    this.metrics = new Float64Array(memory, this.api.lsd_metrics_ptr(this.engine), this.api.lsd_metrics_len());
    this.envelope = new Float32Array(memory, this.api.lsd_envelope_ptr(this.engine), ENVELOPE_CAPACITY);
    this.generationActivity = new Float32Array(memory, this.api.lsd_generations_ptr(this.engine), 256);
    this.generationCounts = new Uint32Array(memory, this.api.lsd_generation_counts_ptr(this.engine), 256);
  }

  snapshot() {
    const status = {};
    // Metrics are refreshed by Rust on read, including values between callbacks.
    this.api.lsd_metrics_ptr(this.engine);
    for (let i = 0; i < METRICS.length; i++) status[METRICS[i]] = this.metrics[i];
    const count = this.api.lsd_taps_count(this.engine);
    status.tapActivity = Array.from(new Float32Array(this.memory, this.api.lsd_taps_ptr(this.engine), count));
    status.tapVoiceIndices = Array.from(new Uint32Array(this.memory, this.api.lsd_tap_indices_ptr(this.engine), count), value => value === 0xffffffff ? -1 : value);
    status.generationActivity = Array.from(this.generationActivity);
    status.generationVoiceCounts = Array.from(this.generationCounts);
    const envelopeCount = this.api.lsd_envelope_count(this.engine), offset = this.api.lsd_envelope_offset(this.engine), values = new Array(envelopeCount);
    for (let i = 0; i < envelopeCount; i++) values[i] = this.envelope[(offset + i) % ENVELOPE_CAPACITY];
    status.inputEnvelope = { interval: this.api.lsd_envelope_interval(this.engine), endTime: this.api.lsd_envelope_end_time(this.engine), values };
    status.automatic = Boolean(status.automatic); status.source = status.source ? 'mic' : 'seed';
    status.device = 'Browser audio'; status.failure = this.failed ? 'The audio engine stopped.' : null;
    status.timing = fineClock ? 'high-resolution' : 'coarse-averaged';
    return status;
  }

  message(data) {
    if (this.dead) return;
    if (data.type === 'install') {
      const accepted = withBytes(this.api, new Uint8Array(data.pool), (pointer, length) => this.api.lsd_install(this.engine, pointer, length));
      if (!accepted) throw new Error(wasmError(this.api, 'The audio topology could not be installed.'));
      this.refreshViews();
    } else if (data.type === 'performance') {
      const accepted = withJson(this.api, data.performance, (pointer, length) => this.api.lsd_performance(this.engine, pointer, length));
      if (!accepted) throw new Error(wasmError(this.api, 'The audio settings could not be applied.'));
      this.refreshViews();
    } else if (data.type === 'strike') this.api.lsd_strike(this.engine);
    else if (data.type === 'dispose') {
      this.dead = true; this.api.lsd_drop(this.engine);
      for (const pointer of [this.inputLeftPointer, this.inputRightPointer, this.outputLeftPointer, this.outputRightPointer]) this.api.lsd_free(pointer, BLOCK * 4);
      this.port.postMessage({ id: data.id }); return;
    }
    this.port.postMessage({ id: data.id, status: this.snapshot() });
  }

  process(inputs, outputs) {
    if (this.dead || this.failed) return false;
    const output = outputs[0], left = output?.[0], right = output?.[1];
    if (!left) return true;
    const frames = left.length, channels = inputs[0], inLeft = channels?.[0], inRight = channels?.[1];
    const started = now();
    // Persistent buffers; no per-quantum views, messages, arrays, or promises.
    for (let i = 0; i < frames; i++) {
      this.inputLeft[i] = inLeft?.[i] || 0;
      this.inputRight[i] = inRight?.[i] ?? this.inputLeft[i];
    }
    if (!this.api.lsd_process(this.engine, this.inputLeftPointer, this.inputRightPointer, this.outputLeftPointer, this.outputRightPointer, frames)) {
      this.failed = true; left.fill(0); right?.fill(0); return false;
    }
    for (let i = 0; i < frames; i++) { left[i] = this.outputLeft[i]; if (right) right[i] = this.outputRight[i]; }
    const seconds = Math.max(0, now() - started) / 1000;
    if (fineClock) this.api.lsd_observe(this.engine, seconds, frames, 0);
    else {
      // Averaging makes a 1 ms clock tick useful without treating it as a spike.
      this.measuredSeconds += seconds; this.measuredFrames += frames;
      if (this.measuredFrames >= BLOCK * 32) {
        this.api.lsd_observe(this.engine, this.measuredSeconds, this.measuredFrames, 0);
        this.measuredSeconds = 0; this.measuredFrames = 0;
      }
    }
    return true;
  }
}

registerProcessor('morphazoid-l-system-delay', LSystemDelayProcessor);

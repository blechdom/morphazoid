import { wasmError, withJson } from './wasm-abi.js';

const BLOCK = 128, ENVELOPE_CAPACITY = 4000;
const INSTALL_RECORDS_PER_BLOCK = 4096;
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
    this.dead = false; this.failed = false; this.measuredSeconds = 0; this.measuredFrames = 0; this.adjustmentSeconds = 0;
    this.audioTimeSeconds = null;
    this.pendingInstall = null; this.installQueue = []; this.drainRequests = [];
    this.inputLeftPointer = this.api.lsd_alloc(BLOCK * 4);
    this.inputRightPointer = this.api.lsd_alloc(BLOCK * 4);
    this.outputLeftPointer = this.api.lsd_alloc(BLOCK * 4);
    this.outputRightPointer = this.api.lsd_alloc(BLOCK * 4);
    if (!this.inputLeftPointer || !this.inputRightPointer || !this.outputLeftPointer || !this.outputRightPointer) throw new Error('The audio buffers could not be allocated.');
    this.refreshViews();
    this.port.onmessage = ({ data }) => {
      const started = now();
      try { this.message(data); }
      catch (error) {
        this.port.postMessage({ id: data.id, error: String(error.message || error) });
        if (error instanceof WebAssembly.RuntimeError) this.fail(error);
      }
      finally { this.adjustmentSeconds += Math.max(0, now() - started) / 1000; }
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
    if (this.memory !== this.api.memory.buffer) this.refreshViews();
    const status = {};
    // Metrics are refreshed by Rust on read, including values between callbacks.
    this.api.lsd_metrics_ptr(this.engine);
    for (let i = 0; i < METRICS.length; i++) status[METRICS[i]] = this.metrics[i];
    status.audioTimeSeconds = this.audioTimeSeconds;
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
      this.installQueue.push(data);
      if (!this.pendingInstall) this.startInstall();
      return;
    } else if (data.type === 'drain') {
      if (this.pendingInstall || this.installQueue.length || this.api.lsd_collect_retired(this.engine, 0)) {
        this.drainRequests.push(data.id); return;
      }
    } else if (data.type === 'depth') {
      const accepted = this.api.lsd_depth(this.engine, data.depth);
      if (!accepted) throw new Error(wasmError(this.api, 'Recursion could not be updated.'));
    } else if (data.type === 'performance') {
      let accepted;
      try {
        accepted = withJson(this.api, data.performance, (pointer, length) => this.api.lsd_performance(this.engine, pointer, length));
      } finally { this.refreshViews(); }
      if (!accepted) throw new Error(wasmError(this.api, 'The audio settings could not be applied.'));
    } else if (data.type === 'strike') this.api.lsd_strike(this.engine);
    else if (data.type === 'dispose') {
      this.dead = true; this.releaseInstall(true); this.installQueue.length = 0; this.drainRequests.length = 0;
      this.api.lsd_drop(this.engine);
      for (const pointer of [this.inputLeftPointer, this.inputRightPointer, this.outputLeftPointer, this.outputRightPointer]) this.api.lsd_free(pointer, BLOCK * 4);
      this.port.postMessage({ id: data.id }); return;
    }
    // Live coefficient gestures arrive much more often than display polling.
    // Acknowledge them without allocating another complete meter/history copy
    // on the audio thread. Status polling publishes the coherent audio frame.
    this.port.postMessage(data.type === 'status'
      ? { id: data.id, status: this.snapshot() } : { id: data.id });
  }

  startInstall() {
    const data = this.installQueue.shift();
    if (!data) return;
    let pointer = 0, trapped = false;
    try {
      const bytes = new Uint8Array(data.pool);
      pointer = this.api.lsd_alloc_uninitialized(bytes.length);
      if (!pointer) throw new Error(wasmError(this.api, 'The audio topology could not be allocated.'));
      this.pendingInstall = { id: data.id, pointer, length: bytes.length, bytes, copied: Math.min(32, bytes.length) };
      // Begin validates only the header. Upload records just before their
      // bounded validation step, avoiding a multi-megabyte copy in one callback.
      new Uint8Array(this.api.memory.buffer, pointer, this.pendingInstall.copied)
        .set(bytes.subarray(0, this.pendingInstall.copied));
      if (!this.api.lsd_install_begin(this.engine, pointer, bytes.length)) {
        throw new Error(wasmError(this.api, 'The audio topology could not be prepared.'));
      }
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) { trapped = true; throw error; }
      this.releaseInstall(true);
      this.port.postMessage({ id: data.id, error: String(error.message || error) });
    } finally {
      // Allocation and control preparation can grow memory before any audio
      // block runs. Refresh every persistent view, even for rejected controls.
      if (!trapped) this.refreshViews();
    }
  }

  releaseInstall(abort = false) {
    const pending = this.pendingInstall;
    if (!pending) return;
    if (abort) this.api.lsd_install_abort(this.engine);
    this.api.lsd_free(pending.pointer, pending.length);
    this.pendingInstall = null;
  }

  advanceInstall() {
    if (!this.pendingInstall) this.startInstall();
    if (!this.pendingInstall) return;
    const pending = this.pendingInstall;
    if (pending.copied < pending.length) {
      const end = Math.min(pending.length, pending.copied + INSTALL_RECORDS_PER_BLOCK * 48);
      new Uint8Array(this.api.memory.buffer, pending.pointer + pending.copied, end - pending.copied)
        .set(pending.bytes.subarray(pending.copied, end));
      pending.copied = end;
    }
    const result = this.api.lsd_install_step(this.engine, INSTALL_RECORDS_PER_BLOCK);
    if (result === 1) return;
    if (result !== 2) {
      const error = wasmError(this.api, 'The audio topology could not be installed.');
      this.releaseInstall(true);
      this.port.postMessage({ id: pending.id, error });
    } else {
      this.releaseInstall();
      this.port.postMessage({ id: pending.id, status: this.snapshot() });
    }
  }

  process(inputs, outputs) {
    if (this.dead || this.failed) return false;
    try { return this.processBlock(inputs, outputs); }
    catch (error) {
      for (const channel of outputs[0] || []) channel.fill(0);
      this.fail(error); return false;
    }
  }

  fail(error) {
    if (this.failed) return;
    this.failed = true;
    this.port.postMessage({ type: 'failure', error: String(error.message || error) });
  }

  processBlock(inputs, outputs) {
    if (this.memory !== this.api.memory.buffer) this.refreshViews();
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
      this.fail(new Error(wasmError(this.api, 'The Rust delay renderer rejected an audio block.')));
      left.fill(0); right?.fill(0); return false;
    }
    for (let i = 0; i < frames; i++) { left[i] = this.outputLeft[i]; if (right) right[i] = this.outputRight[i]; }
    // Pair the Rust sample clock with the end of this rendered quantum before
    // an installation ACK snapshots it. UI delivery must not move wave phase.
    if (Number.isFinite(globalThis.currentTime)) this.audioTimeSeconds = globalThis.currentTime + frames / sampleRate;
    // Keep rendering the committed pool while the next one is validated and
    // prepared in bounded batches. Only its completed state becomes audible.
    this.advanceInstall();
    // Replaced numeric storage is reclaimed in bounded batches too. A muted
    // control graph drains it before suspension without delaying the commit ACK.
    const remaining = this.api.lsd_collect_retired(this.engine, INSTALL_RECORDS_PER_BLOCK);
    if (!remaining && !this.pendingInstall && !this.installQueue.length && this.drainRequests.length) {
      for (const id of this.drainRequests) this.port.postMessage({ id });
      this.drainRequests.length = 0;
    }
    // Admission probes also consume the audio thread. Carry that measured
    // adjustment into the next observation, including coarse-clock batches.
    const seconds = Math.max(0, now() - started) / 1000 + this.adjustmentSeconds;
    this.adjustmentSeconds = 0;
    if (fineClock) {
      const adjustmentStarted = now();
      this.api.lsd_observe(this.engine, seconds, frames, 0);
      this.adjustmentSeconds = Math.max(0, now() - adjustmentStarted) / 1000;
    }
    else {
      // Averaging makes a 1 ms clock tick useful without treating it as a spike.
      this.measuredSeconds += seconds; this.measuredFrames += frames;
      if (this.measuredFrames >= BLOCK * 32) {
        const adjustmentStarted = now();
        this.api.lsd_observe(this.engine, this.measuredSeconds, this.measuredFrames, 0);
        this.adjustmentSeconds = Math.max(0, now() - adjustmentStarted) / 1000;
        this.measuredSeconds = 0; this.measuredFrames = 0;
      }
    }
    return true;
  }
}

registerProcessor('morphazoid-l-system-delay', LSystemDelayProcessor);

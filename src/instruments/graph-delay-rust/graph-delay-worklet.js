const BLOCK = 128;
const fineClock = typeof globalThis.performance?.now === 'function';
const now = fineClock ? () => globalThis.performance.now() : () => Date.now();

/** One persistent Rust graph, independent of rendering/main-thread stalls. */
class GraphDelayRustProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.engine = 0; this.pointers = [];
    this.closed = false; this.pendingId = null; this.frames = 0; this.timingFrames = 0; this.timingMs = 0;
    this.cpuLoad = 0; this.peakLoad = 0; this.deadlineMisses = 0; this.lastAudioTime = 0;
    try {
      this.api = new WebAssembly.Instance(options.processorOptions.module, {}).exports;
      this.engine = this.api.gdr_new(sampleRate);
      if (!this.engine) throw new Error('The Rust graph engine could not allocate its audio state.');
      for (let index = 0; index < 4; index++) {
        const pointer = this.api.gdr_alloc(BLOCK * 4);
        if (!pointer) throw new Error('The Rust graph audio buffers could not be allocated.');
        this.pointers.push(pointer);
      }
      this.refresh();
    } catch (error) { this.release(); throw error; }
    this.port.onmessage = ({ data }) => {
      try {
        if (this.closed) return;
        if (data.type === 'configure') {
          const plan = new Float64Array(data.plan), pointer = this.api.gdr_alloc(plan.byteLength);
          if (!pointer) throw new Error('The Rust graph control buffer could not be allocated.');
          let accepted;
          try {
            new Float64Array(this.api.memory.buffer, pointer, plan.length).set(plan);
            accepted = this.api.gdr_plan(this.engine, pointer, plan.length);
          } finally {
            this.api.gdr_free(pointer, plan.byteLength);
            if (this.memory !== this.api.memory.buffer) this.refresh();
          }
          if (!accepted) throw new Error('The Rust graph exceeds its route or device memory limits.');
          if (this.pendingId !== null) this.reply({ id: this.pendingId, superseded: true });
          if (this.closed) return;
          this.pendingId = data.id;
          // Commit an in-place coefficient edit immediately; a structural scene
          // waits for bounded history preparation in spare callback time.
          if (this.api.gdr_prepare(this.engine, 0)) this.complete();
        } else if (data.type === 'enabled') {
          this.api.gdr_enabled(this.engine, Number(data.enabled));
        } else if (data.type === 'clear') {
          this.api.gdr_clear(this.engine);
        } else if (data.type === 'dispose') {
          this.release();
          this.reply({ id: data.id });
        } else if (data.type === 'status') this.status();
      } catch (error) {
        this.reply({ id: data.id, error: String(error.message || error) });
        if (error instanceof WebAssembly.RuntimeError) this.failure(error);
      }
    };
    this.reply({ type: 'ready' });
  }
  refresh() {
    this.memory = this.api.memory.buffer;
    [this.left, this.right, this.outLeft, this.outRight] = this.pointers.map(pointer => new Float32Array(this.memory, pointer, BLOCK));
    this.values = new Float64Array(this.memory, this.api.gdr_metrics(this.engine), 16);
    this.nodeLevels = new Float32Array(this.memory, this.api.gdr_node_levels(this.engine), 64);
    this.edgeLevels = new Float32Array(this.memory, this.api.gdr_edge_levels(this.engine), 256);
  }
  complete() {
    if (this.pendingId === null) return;
    const id = this.pendingId; this.pendingId = null; this.reply({ id });
  }
  reply(message, transfer = []) {
    try { this.port.postMessage(message, transfer); }
    catch { this.release(); }
  }
  release() {
    if (this.closed) return;
    this.closed = true; this.pendingId = null; this.port.onmessage = null;
    const engine = this.engine; this.engine = 0;
    if (engine) {
      try { this.api.gdr_drop(engine); } catch { /* A trapped instance may not be reusable. */ }
    }
    for (const pointer of this.pointers) {
      try { this.api.gdr_free(pointer, BLOCK * 4); } catch { /* Release remaining buffers independently. */ }
    }
    this.pointers = [];
    this.memory = this.left = this.right = this.outLeft = this.outRight = this.values = this.nodeLevels = this.edgeLevels = null;
    this.api = null;
  }
  failure(error) {
    if (this.closed) return;
    this.release();
    this.reply({ type: 'failure', error: String(error.message || error) });
  }
  status() {
    if (this.memory !== this.api.memory.buffer) this.refresh();
    const nodeLevels = this.nodeLevels.slice(0, this.values[3]), edgeLevels = this.edgeLevels.slice(0, this.values[4]);
    this.reply({ type: 'metrics', metrics: {
      elapsedSeconds: this.values[0], audioTimeSeconds: this.lastAudioTime,
      inputPeak: this.values[1], outputPeak: this.values[2], nodes: this.values[3], edges: this.values[4],
      routes: this.values[5], activeRoutes: this.values[6], nodeLevels, edgeLevels,
      cpuLoad: this.cpuLoad, peakLoad: this.peakLoad, deadlineMisses: this.deadlineMisses,
      preparing: this.pendingId !== null, timing: fineClock ? 'high-resolution' : 'coarse-averaged',
    } }, [nodeLevels.buffer, edgeLevels.buffer]);
  }
  process(inputs, outputs) {
    if (this.closed) return false;
    const left = outputs[0]?.[0], right = outputs[0]?.[1];
    if (!left) return true;
    try {
      if (this.memory !== this.api.memory.buffer) this.refresh();
      const started = now(), frames = left.length, input = inputs[0];
      for (let index = 0; index < frames; index++) {
        this.left[index] = input?.[0]?.[index] || 0;
        this.right[index] = input?.[1]?.[index] ?? this.left[index];
      }
      if (!this.api.gdr_process(this.engine, ...this.pointers, frames)) throw new Error('The Rust graph rejected an audio block.');
      for (let index = 0; index < frames; index++) { left[index] = this.outLeft[index]; if (right) right[index] = this.outRight[index]; }
      const duration = frames / sampleRate * 1000;
      const renderMs = Math.max(0, now() - started);
      // Only preparation/retirement performs heap maintenance. Bound writes to
      // 256 KiB per quantum and leave margin for the current real DSP load.
      const spare = duration * .8 - renderMs;
      const records = spare > .25 ? 65536 : spare > .1 ? 16384 : 0;
      if (this.api.gdr_prepare(this.engine, records)) this.complete();
      const elapsed = Math.max(0, now() - started);
      this.timingMs += elapsed; this.timingFrames += frames;
      if (fineClock || this.timingFrames >= BLOCK * 32) {
        const load = this.timingMs / (this.timingFrames / sampleRate * 1000);
        this.cpuLoad += (load - this.cpuLoad) * .2;
        this.peakLoad = Math.max(load, this.peakLoad * .97);
        if (load > 1) this.deadlineMisses++;
        this.timingMs = this.timingFrames = 0;
      } else if (renderMs > duration + 1) this.deadlineMisses++;
      this.frames += frames; this.lastAudioTime = currentTime + frames / sampleRate;
      return true;
    } catch (error) {
      left.fill(0); right?.fill(0); this.failure(error); return false;
    }
  }
}
registerProcessor('morphazoid-graph-delay-rust', GraphDelayRustProcessor);

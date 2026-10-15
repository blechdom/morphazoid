const BLOCK = 128, STRIDE = 672;
class StaircaseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dead = false; this.blocks = 0; this.revision = 0;
    this.api = new WebAssembly.Instance(options.processorOptions.module, {}).exports;
    if (this.api.stair_abi_version() !== 2) throw new Error('Unsupported staircase engine.');
    this.handle = this.api.stair_new(sampleRate);
    this.leftPtr = this.api.stair_alloc(BLOCK * 4); this.rightPtr = this.api.stair_alloc(BLOCK * 4);
    this.tablePtr = this.api.stair_alloc(64 * STRIDE * 4);
    if (!this.handle || !this.leftPtr || !this.rightPtr || !this.tablePtr) throw new Error('Could not allocate staircase audio buffers.');
    this.refresh();
    this.port.onmessage = ({ data }) => {
      if (this.dead) return;
      try {
        if (data.type === 'field') {
          if (!(data.table instanceof Float32Array) || data.table.length !== 64 * STRIDE || data.frames !== 64) throw new Error('Invalid staircase field.');
          new Float32Array(this.api.memory.buffer, this.tablePtr, data.table.length).set(data.table);
          if (!this.api.stair_table(this.handle, this.tablePtr, data.table.length, data.frames)) throw new Error('The staircase field was rejected.');
          this.revision = data.revision;
        } else if (data.type === 'controls') {
          this.api.stair_controls(this.handle, data.mode, data.base, data.brightness, data.body, data.gain, data.seconds);
        } else if (data.type === 'transport') {
          this.api.stair_transport(this.handle, Number(data.playing), Number(data.enabled), Number(data.hold));
        } else if (data.type === 'seek') this.api.stair_seek(this.handle, data.depth, data.direction);
        else if (data.type === 'dispose') this.dispose();
        if (!this.dead && this.memory !== this.api.memory.buffer) this.refresh();
      } catch (error) { this.port.postMessage({ type: 'error', message: String(error.message || error) }); this.dispose(); }
    };
    this.port.postMessage({ type: 'ready' });
  }
  refresh() {
    this.memory = this.api.memory.buffer;
    this.left = new Float32Array(this.memory, this.leftPtr, BLOCK);
    this.right = new Float32Array(this.memory, this.rightPtr, BLOCK);
    this.values = new Float64Array(this.memory, this.api.stair_state(this.handle), 12);
  }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.api.stair_drop(this.handle);
    this.api.stair_free(this.leftPtr, BLOCK * 4); this.api.stair_free(this.rightPtr, BLOCK * 4);
    this.api.stair_free(this.tablePtr, 64 * STRIDE * 4);
  }
  process(_inputs, outputs) {
    if (this.dead) return false;
    try {
      const output = outputs[0];
      if (!output?.length) return true;
      const length = output[0].length;
      for (let offset = 0; offset < length; offset += BLOCK) {
        const count = Math.min(BLOCK, length - offset);
        if (!this.api.stair_process(this.handle, this.leftPtr, this.rightPtr, count)) throw new Error('Staircase rendering failed.');
        output[0].set(this.left.subarray(0, count), offset);
        output[1]?.set(this.right.subarray(0, count), offset);
      }
      if (++this.blocks % 16 === 0) {
        this.api.stair_state(this.handle);
        this.port.postMessage({ type: 'state', clock: this.values[0], depth: this.values[1],
          direction: this.values[2], revision: this.revision, branches: this.values[10], white: Boolean(this.values[11]) });
      }
      return true;
    } catch (error) {
      for (const channel of outputs[0] ?? []) channel.fill(0);
      this.port.postMessage({ type: 'error', message: String(error.message || error) }); this.dispose(); return false;
    }
  }
}
registerProcessor('morphazoid-staircase-studies', StaircaseProcessor);

const BLOCK = 128, STRIDE = 3616, FEATURE_STRIDE = 512 * 6;
class StaircaseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.dead = false; this.revision = 0; this.stateRequested = false;
    // One transferable buffer circulates with the display. A busy/hidden UI
    // cannot accumulate diagnostic allocations or queued snapshots here.
    this.voiceSnapshot = new Float64Array(512 * 6);
    this.api = new WebAssembly.Instance(options.processorOptions.module, {}).exports;
    if (this.api.stair_abi_version() !== 3 || this.api.stair_voice_capacity() !== 512
      || ['stair_features', 'stair_studies', 'stair_focus', 'stair_gate'].some(name => typeof this.api[name] !== 'function')) throw new Error('Unsupported staircase engine.');
    this.handle = this.api.stair_new(sampleRate);
    this.leftPtr = this.api.stair_alloc(BLOCK * 4); this.rightPtr = this.api.stair_alloc(BLOCK * 4);
    this.tablePtr = this.api.stair_alloc(64 * STRIDE * 4);
    this.featurePtr = this.api.stair_alloc(64 * FEATURE_STRIDE * 4);
    if (!this.handle || !this.leftPtr || !this.rightPtr || !this.tablePtr || !this.featurePtr) throw new Error('Could not allocate staircase audio buffers.');
    this.refresh();
    this.port.onmessage = ({ data }) => {
      if (this.dead) return;
      try {
        if (data.type === 'field') {
          if (!(data.table instanceof Float32Array) || data.table.length !== 64 * STRIDE || data.frames !== 64) throw new Error('Invalid staircase field.');
          if (data.features != null && (!(data.features instanceof Float32Array)
            || data.features.length !== 64 * FEATURE_STRIDE || data.featureFrames !== 64)) throw new Error('Invalid staircase contour features.');
          new Float32Array(this.api.memory.buffer, this.tablePtr, data.table.length).set(data.table);
          if (!this.api.stair_table(this.handle, this.tablePtr, data.table.length, data.frames)) throw new Error('The staircase field was rejected.');
          if (data.features != null) {
            new Float32Array(this.api.memory.buffer, this.featurePtr, data.features.length).set(data.features);
            if (!this.api.stair_features(this.handle, this.featurePtr, data.features.length, data.featureFrames)) throw new Error('The staircase contour features were rejected.');
          }
          this.revision = data.revision;
        } else if (data.type === 'state-request') {
          if (data.voices instanceof Float64Array && data.voices.length === 512 * 6) this.voiceSnapshot = data.voices;
          this.stateRequested = true;
        } else if (data.type === 'controls') {
          this.api.stair_controls(this.handle, data.mode, data.base, data.brightness, data.body, data.gain, data.seconds);
          this.api.stair_pitch(this.handle, data.pitchMapping, data.pitchSpan);
          this.api.stair_studies(this.handle, data.turnAmount, data.turnSpan, data.accentAmount, data.accentRate,
            data.forkAmount, data.forkSpan, data.curvatureAmount, data.curvatureDrive, data.endlessAmount, data.endlessDirection);
          this.api.stair_focus(this.handle, data.focusFirst ?? 0, data.focusSecond ?? 0);
          this.api.stair_gate(this.handle, Number(data.stripeGate !== false));
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
    this.voiceValues = new Float64Array(this.memory, this.api.stair_voice_state(this.handle), 512 * 6);
  }
  dispose() {
    if (this.dead) return;
    this.dead = true; this.api.stair_drop(this.handle);
    this.api.stair_free(this.leftPtr, BLOCK * 4); this.api.stair_free(this.rightPtr, BLOCK * 4);
    this.api.stair_free(this.tablePtr, 64 * STRIDE * 4);
    this.api.stair_free(this.featurePtr, 64 * FEATURE_STRIDE * 4);
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
        output[0].set(count === BLOCK ? this.left : this.left.subarray(0, count), offset);
        output[1]?.set(count === BLOCK ? this.right : this.right.subarray(0, count), offset);
      }
      // Render the audio first. Display diagnostics are optional and bounded:
      // no request or no returned buffer means no diagnostic work this block.
      if (this.stateRequested && this.voiceSnapshot) {
        this.api.stair_state(this.handle);
        this.api.stair_voice_state(this.handle);
        const voices = this.voiceSnapshot;
        voices.set(this.voiceValues);
        this.stateRequested = false; this.voiceSnapshot = null;
        this.port.postMessage({ type: 'state', clock: this.values[0], depth: this.values[1],
          direction: this.values[2], revision: this.revision, branches: this.values[10], white: Boolean(this.values[11]), voices }, [voices.buffer]);
      }
      return true;
    } catch (error) {
      for (const channel of outputs[0] ?? []) channel.fill(0);
      this.port.postMessage({ type: 'error', message: String(error.message || error) }); this.dispose(); return false;
    }
  }
}
registerProcessor('morphazoid-staircase-studies', StaircaseProcessor);

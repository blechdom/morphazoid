import { ChiptuneTempoClock, TEMPO_CLOCK_CAPACITY, TEMPO_CLOCK_FIELDS } from './tempo-clock.js';

const BLOCK = 128;
// drums, bass, arp, lead, upperOne, upperTwo, noise, kick, snare, hats, shaker
const STEM_COUNT = 11;
const PATCH_LAYOUT = { params: ['params_ptr', Float32Array, 154], meta: ['sequence_meta_ptr', Uint32Array, 48], cells: ['sequence_cells_ptr', Uint8Array, 9216], time: ['time_info_ptr', Float32Array, 4] };

const PATCH_KEYS = Object.keys(PATCH_LAYOUT);

function createKernel(bytes, lanes) {
  if (!bytes) return null;
  const module = new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(module).length) throw new Error('Chiptune WASM must be self-contained.');
  const exports = new WebAssembly.Instance(module).exports;
  if (!(exports.memory instanceof WebAssembly.Memory) || exports.lane_width() !== lanes || exports.block_size() !== BLOCK) throw new Error('Incompatible chiptune audio engine.');
  const view = (name, Type, length) => {
    const pointer = exports[name]?.();
    if (!Number.isInteger(pointer) || pointer < 0 || pointer % Type.BYTES_PER_ELEMENT || pointer + length * Type.BYTES_PER_ELEMENT > exports.memory.buffer.byteLength) throw new Error(`Invalid chiptune buffer: ${name}`);
    return new Type(exports.memory.buffer, pointer, length);
  };
  const kernel = { exports, left: view('output_left_ptr', Float32Array, BLOCK), right: view('output_right_ptr', Float32Array, BLOCK), time: view('time_info_ptr', Float32Array, 4) };
  for (const [key, [name, Type, length]] of Object.entries(PATCH_LAYOUT)) kernel[key] = view(name, Type, length);
  exports.reset();
  kernel.time.set([0, -1, 0, -1]);
  kernel.tempoClock = view('tempo_clock_ptr', Float64Array, TEMPO_CLOCK_CAPACITY * TEMPO_CLOCK_FIELDS);
  if (exports.stem_count() !== STEM_COUNT) throw new Error('Incompatible chiptune stem meters.');
  kernel.stemPeaks = view('stem_peaks_ptr', Float32Array, STEM_COUNT);
  return kernel;
}
function blankPatch() { return { params: new Float32Array(154), meta: new Uint32Array(48), cells: new Uint8Array(9216), time: new Float32Array([0, -1, 0, -1]) }; }
function copyPatch(target, source) { for (const key of PATCH_KEYS) target[key].set(source[key]); }

class ChiptuneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false; this.disposed = false; this.playing = false;
    this.offset = 0; this.startAt = 0; this.position = 0; this.gain = 0; this.releaseFrames = 0;
    this.current = blankPatch(); this.previous = blankPatch(); this.pending = blankPatch();
    this.hasPending = false; this.blend = 0; this.telemetryFrames = 0;
    this.tempoClock = new ChiptuneTempoClock(); this.tempoEventSerial = -1;
    this.oldLeft = new Float32Array(BLOCK); this.oldRight = new Float32Array(BLOCK);
    this.stemPeaks = new Float32Array(STEM_COUNT); this.oldStemPeaks = new Float32Array(STEM_COUNT);
    this.port.onmessage = ({ data }) => { try { this.message(data ?? {}); } catch (error) { this.port.postMessage({ type: 'error', message: error.message }); } };
  }
  stage(patch) {
    for (const [key, [, Type, length]] of Object.entries(PATCH_LAYOUT)) {
      if (!(patch?.[key] instanceof Type) || patch[key].length !== length) throw new Error(`Invalid chiptune ${key} buffer.`);
    }
    if (patch.params.some(value => !Number.isFinite(value)) || patch.time.some(value => !Number.isFinite(value))) throw new Error('Chiptune parameters must be finite.');
    const target = this.hasPending ? this.pending : this.current;
    if (this.ready && PATCH_KEYS.every(key => patch[key].every((value, i) => value === target[key][i]))) return;
    copyPatch(this.pending, patch); this.hasPending = true;
    if (this.ready && Number.isFinite(patch.tempoEvent?.seconds) && Number.isFinite(patch.tempoEvent?.tempo)
      && patch.tempoEvent.serial !== this.tempoEventSerial) {
      this.tempoEventSerial = patch.tempoEvent.serial;
      if (this.tempoClock.setTempo(patch.tempoEvent.tempo, patch.tempoEvent.seconds)) this.syncTempoClock();
    }
  }
  message(data) {
    if (data.type === 'install') {
      this.scalar = createKernel(data.scalarBytes, 1);
      if (!this.scalar) throw new Error('The scalar fallback engine is missing.');
      try { this.simd = createKernel(data.simdBytes, 4); } catch { this.simd = null; }
      this.kernel = this.simd ?? this.scalar; this.backend = this.simd ? 'simd' : 'scalar';
      this.stage(data.configuration); copyPatch(this.current, this.pending); copyPatch(this.kernel, this.current);
      this.hasPending = false; this.ready = true;
      this.tempoClock.reset(this.current.params[0]); this.syncTempoClock();
      this.port.postMessage({ type: 'ready', backend: this.backend });
    } else if (data.type === 'configure') this.stage(data.configuration);
    else if (data.type === 'transport') {
      this.playing = Boolean(data.playing);
      if (this.playing) {
        this.offset = Number.isFinite(data.offset) ? Math.max(0, data.offset) : this.position;
        // A late message catches up to the AudioContext timeline; it never moves the clock.
        this.startAt = Number.isFinite(data.startAt) ? data.startAt : currentTime;
        this.position = this.offset; this.gain = 0; this.releaseFrames = 0;
        this.stemPeaks.fill(0); this.telemetryFrames = 0;
        if (Array.isArray(data.clock)) this.tempoClock.restore(data.clock);
        else this.tempoClock.reset(this.current.params[0]);
        this.syncTempoClock();
      } else this.releaseFrames = this.gain > 0 ? 256 : 0;
      this.blend = 0;
    } else if (data.type === 'dispose') { this.disposed = true; this.ready = false; }
  }
  syncTempoClock() {
    for (const kernel of [this.scalar, this.simd]) if (kernel) {
      kernel.exports.set_tempo_clock(this.tempoClock.writeTo(kernel.tempoClock));
    }
  }
  render(patch, frames, seconds) {
    copyPatch(this.kernel, patch);
    this.kernel.time[0] = seconds;
    try { this.kernel.exports.process(frames, sampleRate, seconds); }
    catch (error) {
      if (this.kernel === this.scalar) throw error;
      this.kernel = this.scalar; this.backend = 'scalar'; copyPatch(this.kernel, patch);
      this.kernel.time[0] = seconds;
      this.kernel.exports.process(frames, sampleRate, seconds);
      this.port.postMessage({ type: 'backend', backend: 'scalar' });
    }
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    for (const bus of outputs) for (const channel of bus) channel.fill(0);
    if (this.disposed) return false;
    if (!this.ready || !output?.[0]) return true;
    try {
      if (this.hasPending) {
        copyPatch(this.previous, this.current); copyPatch(this.current, this.pending);
        this.hasPending = false; this.blend = this.playing ? 256 : 0;
        const seconds = this.playing ? this.offset + Math.max(0, currentTime - this.startAt) : this.position;
        if (Math.fround(this.tempoClock.segments.at(-1)[3]) !== this.current.params[0]
          && this.tempoClock.setTempo(this.current.params[0], seconds)) this.syncTempoClock();
      }
      if (!this.playing && !this.releaseFrames) return true;
      let offset = Math.max(0, Math.ceil((this.startAt - currentTime) * sampleRate));
      for (; offset < output[0].length; offset += BLOCK) {
        const count = Math.min(BLOCK, output[0].length - offset);
        const seconds = this.offset + Math.max(0, currentTime + offset / sampleRate - this.startAt);
        const wasBlending = this.blend > 0, previousGain = this.gain;
        if (wasBlending) {
          this.render(this.previous, count, seconds);
          this.oldLeft.set(this.kernel.left); this.oldRight.set(this.kernel.right);
          this.oldStemPeaks.set(this.kernel.stemPeaks);
        }
        this.render(this.current, count, seconds);
        for (let i = 0; i < count; i++) {
          const mix = this.blend ? 1 - this.blend / 256 : 1;
          const left = this.oldLeft[i] * (1 - mix) + this.kernel.left[i] * mix;
          const right = this.oldRight[i] * (1 - mix) + this.kernel.right[i] * mix;
          if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('Chiptune produced an invalid sample.');
          this.gain = this.playing ? Math.min(1, this.gain + 1 / 256) : Math.max(0, this.gain - 1 / 256);
          if (this.releaseFrames) this.releaseFrames--;
          output[0][offset + i] = this.gain * Math.max(-0.98, Math.min(0.98, output[1] ? left : (left + right) * .5));
          if (output[1]) output[1][offset + i] = this.gain * Math.max(-0.98, Math.min(0.98, right));
          if (this.blend) this.blend--;
        }
        // The 256-sample patch blend can contain either patch's peak. Keep
        // their maximum during that brief transition without another render.
        const meterGain = Math.max(previousGain, this.gain);
        for (let stem = 0; stem < STEM_COUNT; stem++) {
          const peak = Math.max(this.kernel.stemPeaks[stem], wasBlending ? this.oldStemPeaks[stem] : 0) * meterGain;
          this.stemPeaks[stem] = Math.max(this.stemPeaks[stem], Math.min(1, Number.isFinite(peak) ? peak : 0));
        }
        this.position = seconds + count / sampleRate; this.telemetryFrames += count;
      }
      if (this.telemetryFrames >= sampleRate / 30) {
        this.port.postMessage({ type: 'telemetry', seconds: this.position, beat: this.tempoClock.beatAt(this.position), tempo: this.tempoClock.tempoAt(this.position), audioTime: currentTime + output[0].length / sampleRate, backend: this.backend, stemPeaks: this.stemPeaks.slice() });
        this.telemetryFrames = 0; this.stemPeaks.fill(0);
      }
    } catch (error) {
      for (const channel of output) channel.fill(0);
      this.ready = false;
      this.port.postMessage({ type: 'error', message: error.message });
    }
    return true;
  }
}
registerProcessor('morphazoid-simd-chiptune', ChiptuneProcessor);

// Control/typed-view adapter only. All force, filter, room and mix loops run in
// the fixed-memory Rust kernel, once per render block rather than per sample.
import { SIGNAL_DEFAULTS, sanitizeSignalSettings, sanitizeExcitation, EXCITATION_TYPES, FILTER_TYPES, STAGE_ORDERS } from './signal-path.js';
export class RustSignalPath {
  constructor() {
    this.settings = { ...SIGNAL_DEFAULTS };
    this.excitation = { age: new Uint32Array(8), trigger: value => {
      const s = sanitizeExcitation(value);
      this.exports.signal_excite(EXCITATION_TYPES.indexOf(s.kind), s.strength, s.durationMs);
    } };
  }
  bind(exports) {
    const first = !this.exports;
    this.exports = exports;
    const f64 = (name, length) => new Float64Array(exports.memory.buffer, exports[name](), length);
    const f32 = (name, length) => new Float32Array(exports.memory.buffer, exports[name](), length);
    this.config = f64('signal_config_ptr', 14); this.stats = f64('signal_stats_ptr', 36);
    this.positions = f64('signal_positions_ptr', 4); this.positionTarget = f64('signal_target_positions_ptr', 4);
    this.excitation.age = new Uint32Array(exports.memory.buffer, exports.signal_excitation_age_ptr(), 8);
    this.external = f32('signal_external_ptr', 128); this.source = f32('signal_source_ptr', 128);
    this.processed = f32('signal_processed_ptr', 128); this.fftInput = f64('signal_fft_input_ptr', 128);
    this.spectral = f32('signal_spectral_ptr', 128); this.spectralSpatial = f32('signal_spectral_spatial_ptr', 128 * 16);
    this.outputLeft = f32('signal_output_left_ptr', 128); this.outputRight = f32('signal_output_right_ptr', 128);
    this.outputSpatial = f32('signal_output_spatial_ptr', 128 * 16);
    this.spatialPeaks = this.stats.subarray(2, 18); this.spatialRms = this.stats.subarray(18, 34);
    this.outputChannels = Array.from({ length: 16 }, (_, i) => this.outputSpatial.subarray(i * 128, (i + 1) * 128));
    if (first) this.configure(this.settings, true);
  }
  configure(value, immediate = false) {
    const s = this.settings = sanitizeSignalSettings(value);
    if (!this.exports) return;
    this.config.set([Number(s.bodyEnabled), Number(s.processingEnabled), Number(s.resynthesisEnabled), Number(s.reverbEnabled),
      s.bodyMix, s.resynthesisMix, s.wetMix, FILTER_TYPES.indexOf(s.filterType), s.filterFrequency, s.drive,
      s.reverbTime, s.reverbDamping, s.reverbMix, STAGE_ORDERS.indexOf(s.stageOrder)]);
    this.exports.signal_configure(Number(immediate));
  }
  reset() { this.exports?.signal_reset(); }
  get bodyMix() { return this.exports?.signal_body_mix() ?? 1; }
  get fftMix() { return this.exports?.signal_fft_mix() ?? 0; }
  get orderRemaining() { return this.exports?.signal_order_remaining() ?? 0; }
  prepare(input, frames, enabled, inputActive, excite) {
    this.external.fill(0);
    if (input && inputActive) this.external.set(input.length > 128 ? input.subarray(0, 128) : input);
    this.exports.signal_prepare(frames, Number(enabled), Number(inputActive), Number(excite));
  }
  mixBlock(frames, enabled, spatial, speakers, transition, targetMix) {
    this.exports.signal_mix_block(frames, Number(enabled), Number(spatial), speakers, transition, targetMix);
  }
}

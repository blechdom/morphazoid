// Configuration and fixed-memory bridge only. Transform, spectral shaping,
// overlap/add, warm-bank transitions and surround routing execute in Rust.
import { MAX_SPATIAL_CHANNELS, SPATIAL_DEFAULTS, sanitizeSpatialSettings } from './spatial-model.js';
const BLOCK_SIZE = 128;
const SPATIAL_TARGETS = ['both', 'modes', 'fft'];
const SPATIAL_PATTERNS = ['ascending', 'descending', 'alternate', 'scatter'];
export const MAX_RUST_FFT_SIZE = 4096;
export const MAX_RUST_FFT_BANDS = 1024;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
function configuration(value, sampleRate) {
  const requested = clamp(Math.round(finite(value.fftSize, 1024)), 256, MAX_RUST_FFT_SIZE);
  const fftSize = requested < 384 ? 256 : requested < 768 ? 512 : requested < 1536 ? 1024
    : requested < 3072 ? 2048 : 4096;
  const fftLowFrequency = clamp(finite(value.fftLowFrequency, 70), 20, sampleRate * .22);
  return { fftSize, fftWindow: clamp(Math.round(finite(value.fftWindow, 0)), 0, 3),
    fftHopSize: clamp(Math.round(finite(value.fftHopSize, fftSize * .25) / 32) * 32, 32, fftSize),
    fftBandCount: clamp(Math.round(finite(value.fftBandCount, 96) / 4) * 4, 16, MAX_RUST_FFT_BANDS),
    fftLowFrequency, fftHighFrequency: clamp(finite(value.fftHighFrequency, 12000), fftLowFrequency * 2, sampleRate * .45),
    fftResponseSeconds: clamp(finite(value.fftResponseSeconds, .038), .004, .8),
    fftDetail: clamp(finite(value.fftDetail, .9), 0, 1), fftMix: clamp(finite(value.fftMix, .94), 0, 1),
    fftInputGain: clamp(finite(value.fftInputGain, 1.4), .25, 4), fftGateDb: clamp(finite(value.fftGateDb, -72), -96, -30) };
}
const CONFIG_KEYS = ['fftSize', 'fftWindow', 'fftHopSize', 'fftBandCount', 'fftLowFrequency', 'fftHighFrequency',
  'fftResponseSeconds', 'fftDetail', 'fftMix', 'fftInputGain', 'fftGateDb'];

export class RustFftResynth {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate; this.exports = null; this.configuration = null;
    this.fftMix = .94; this.spatialSettings = SPATIAL_DEFAULTS; this.spatialPhase = 0;
    this.emptyTelemetry = new Float32Array(MAX_RUST_FFT_BANDS);
    this.fftProcessMicros = 0;
  }
  // The kernel owner initializes a new instance and copies state before a
  // backend switch. Binding must not reset/reconfigure that transferred state.
  bind(exports) {
    this.exports = exports;
    const memory = exports.memory.buffer;
    this.input = new Float64Array(memory, exports.fft_input_ptr(), BLOCK_SIZE);
    this.output = new Float64Array(memory, exports.fft_output_ptr(), BLOCK_SIZE);
    this.spatialOutput = new Float32Array(memory, exports.fft_spatial_output_ptr(), BLOCK_SIZE * MAX_SPATIAL_CHANNELS);
    this.configValues = new Float64Array(memory, exports.fft_config_ptr(), CONFIG_KEYS.length);
    this.spatialValues = new Float64Array(memory, exports.fft_spatial_config_ptr(), 8);
    this.status = new Float64Array(memory, exports.fft_status_ptr(), 8);
    this.inputTelemetryViews = [1, 2].map(bank => new Float32Array(memory, exports.fft_input_telemetry_ptr(bank), MAX_RUST_FFT_BANDS));
    this.outputTelemetryViews = [1, 2].map(bank => new Float32Array(memory, exports.fft_output_telemetry_ptr(bank), MAX_RUST_FFT_BANDS));
    return this;
  }
  readStatus(index, fallback = 0) {
    if (!this.exports) return fallback;
    this.exports.fft_status_ptr(); return this.status[index];
  }
  get fftSize() { return this.readStatus(0, this.configuration?.fftSize ?? 1024); }
  get fftHopSize() { return this.readStatus(1, this.configuration?.fftHopSize ?? 256); }
  get fftBandCount() { return this.readStatus(2, this.configuration?.fftBandCount ?? 96); }
  get fftAnalysisFill() { return this.readStatus(3); }
  get fftHistoryFill() { return this.exports?.fft_history_fill() ?? 0; }
  get fftAnalysisFrames() { return this.readStatus(4); }
  get fftTransition() { return Boolean(this.readStatus(6)); }
  // This measures the entire block FFT stage; it is not an isolated transform
  // timer, because the import-free Rust kernel does not read a wall clock.
  get fftAnalysisMicros() { return this.fftProcessMicros; }
  get fftInputTelemetry() { return this.exports ? this.inputTelemetryViews[this.readStatus(5)] : this.emptyTelemetry; }
  get fftOutputTelemetry() { return this.exports ? this.outputTelemetryViews[this.readStatus(5)] : this.emptyTelemetry; }
  configureResynthesis(value) {
    const next = configuration(value, this.sampleRate); this.configuration = next; this.fftMix = next.fftMix;
    if (!this.exports) return;
    for (let index = 0; index < CONFIG_KEYS.length; index++) this.configValues[index] = next[CONFIG_KEYS[index]];
    this.exports.fft_configure();
  }
  configureSpatial(settings, phase = 0) {
    if (settings !== this.spatialSource) {
      this.spatialSource = settings; this.spatialSettings = sanitizeSpatialSettings(settings);
    }
    this.spatialPhase = finite(phase, 0);
    if (!this.exports) return;
    const value = this.spatialSettings;
    this.spatialValues[0] = Number(value.enabled); this.spatialValues[1] = value.speakerCount;
    this.spatialValues[2] = SPATIAL_TARGETS.indexOf(value.target); this.spatialValues[3] = SPATIAL_PATTERNS.indexOf(value.pattern);
    this.spatialValues[4] = value.span; this.spatialValues[5] = value.offset; this.spatialValues[6] = this.spatialPhase;
    this.exports.fft_configure_spatial();
  }
  beginResynthesisTransition() { this.exports?.fft_begin_transition(); }
  primeSilence() { this.exports?.fft_prime_silence(); }
  resetResynthesis() { this.exports?.fft_reset(); this.fftProcessMicros = 0; }
  processBlock(input, mono, spatial, frames = BLOCK_SIZE) {
    const count = Math.max(0, Math.min(BLOCK_SIZE, Math.floor(finite(frames, 0))));
    if (!this.exports) { mono?.fill(0); spatial?.fill(0); return; }
    // The normal render quantum is exactly 128; fixed views avoid per-sample
    // Wasm calls and leave only two bulk copies across the boundary.
    this.input.set(input);
    const started = globalThis.performance?.now?.() ?? 0;
    this.exports.fft_process(count);
    const finished = globalThis.performance?.now?.() ?? started;
    this.fftProcessMicros += Math.max(0, finished - started) * 1000;
    if (mono) mono.set(this.output);
    if (spatial) spatial.set(this.spatialOutput);
  }
}

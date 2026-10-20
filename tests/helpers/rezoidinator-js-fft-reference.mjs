// Frozen JavaScript FFT oracle from d32bd6e3; never shipped or loaded by the instrument.
// Phase-preserved overlap-add resynthesis follows the original SIMD engine,
// including warm dual-bank topology edits. Surround splits shaped complex bins
// before inverse transforms; the independent mono output is unchanged.
import { MAX_SPATIAL_CHANNELS, SPATIAL_DEFAULTS, spatialPosition, equalPowerRoute, wrapTurn } from '../../src/instruments/simd-resonator-rust/spatial-model.js';
const BLOCK_SIZE = 128;
const MAX_FFT_SIZE = 4096;
const MAX_FFT_BANDS = 128;
const OLA_BUFFER_SIZE = MAX_FFT_SIZE * 4;
const OLA_BUFFER_MASK = OLA_BUFFER_SIZE - 1;
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function aligned(value, fallback, maximum) { return clamp(Math.round(finite(value, fallback) / 4) * 4, 4, maximum); }

function fftInPlace(real, imaginary, size, inverse = false) {
  let reversed = 0;
  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while (reversed & bit) { reversed ^= bit; bit >>= 1; }
    reversed ^= bit;
    if (index < reversed) {
      const realValue = real[index]; real[index] = real[reversed]; real[reversed] = realValue;
      const imaginaryValue = imaginary[index]; imaginary[index] = imaginary[reversed]; imaginary[reversed] = imaginaryValue;
    }
  }
  for (let width = 2; width <= size; width *= 2) {
    const angle = (inverse ? Math.PI * 2 : -Math.PI * 2) / width;
    const rootReal = Math.cos(angle); const rootImaginary = Math.sin(angle); const halfWidth = width >> 1;
    for (let offset = 0; offset < size; offset += width) {
      let twiddleReal = 1; let twiddleImaginary = 0;
      for (let index = 0; index < halfWidth; index += 1) {
        const even = offset + index; const odd = even + halfWidth;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even]; const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal; imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal; imaginary[odd] = evenImaginary - oddImaginary;
        const nextReal = twiddleReal * rootReal - twiddleImaginary * rootImaginary;
        twiddleImaginary = twiddleReal * rootImaginary + twiddleImaginary * rootReal;
        twiddleReal = nextReal;
      }
    }
  }
  if (inverse) {
    const scale = 1 / size;
    for (let index = 0; index < size; index += 1) { real[index] *= scale; imaginary[index] *= scale; }
  }
}

function writeWindow(destination, size, shape) {
  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const phase = Math.PI * 2 * index / size;
    const value = shape === 1
      ? Math.max(0, 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(phase * 2))
      : shape === 2 ? Math.sin(Math.PI * (index + 0.5) / size)
      : shape === 3 ? 1
      : 0.5 - 0.5 * Math.cos(phase);
    destination[index] = value;
    sum += value;
  }
  return Math.max(1e-9, sum);
}
function resynthesisConfiguration(configuration, sampleRate) {
  const requestedSize = clamp(Math.round(finite(configuration.fftSize, 1_024)), 256, MAX_FFT_SIZE);
  const fftSize = requestedSize < 384 ? 256 : requestedSize < 768 ? 512
    : requestedSize < 1_536 ? 1_024 : requestedSize < 3_072 ? 2_048 : 4_096;
  const fftLowFrequency = clamp(finite(configuration.fftLowFrequency, 70), 20, sampleRate * 0.22);
  return {
    fftSize,
    fftWindow: clamp(Math.round(finite(configuration.fftWindow, 0)), 0, 3),
    fftHopSize: clamp(Math.round(finite(configuration.fftHopSize, fftSize * 0.25) / 32) * 32, 32, fftSize),
    fftBandCount: Math.max(16, aligned(configuration.fftBandCount, 96, MAX_FFT_BANDS)),
    fftLowFrequency,
    fftHighFrequency: clamp(finite(configuration.fftHighFrequency, 12_000), fftLowFrequency * 2, sampleRate * 0.45),
    fftResponseSeconds: clamp(finite(configuration.fftResponseSeconds, 0.038), 0.004, 0.8),
    fftDetail: clamp(finite(configuration.fftDetail, 0.9), 0, 1),
    fftMix: clamp(finite(configuration.fftMix, 0.94), 0, 1),
    fftInputGain: clamp(finite(configuration.fftInputGain, 1.4), 0.25, 4),
    fftGateDb: clamp(finite(configuration.fftGateDb, -72), -96, -30),
  };
}

class FftResynthesisBank {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.fftSize = 1_024;
    this.fftWindow = 0;
    this.fftHopSize = 256;
    this.fftBandCount = 96;
    this.fftResponseSeconds = 0.038;
    this.fftLowFrequency = 70;
    this.fftHighFrequency = 12_000;
    this.fftDetail = 0.9;
    this.fftMix = 0.94;
    this.fftInputGain = 1.4;
    this.fftGateDb = -72;
    this.fftWindowSum = 1;
    this.fftAnalysisRing = new Float64Array(MAX_FFT_SIZE);
    this.fftReal = new Float64Array(MAX_FFT_SIZE);
    this.fftImaginary = new Float64Array(MAX_FFT_SIZE);
    this.fftWindowValues = new Float64Array(MAX_FFT_SIZE);
    this.fftOla = new Float64Array(OLA_BUFFER_SIZE);
    this.fftOlaNormalization = new Float64Array(OLA_BUFFER_SIZE);
    this.fftBandPower = new Float64Array(MAX_FFT_BANDS);
    this.fftBandWeight = new Float64Array(MAX_FFT_BANDS);
    this.fftBandMagnitude = new Float64Array(MAX_FFT_BANDS);
    this.fftBandEnvelope = new Float64Array(MAX_FFT_BANDS);
    this.fftInputTelemetry = new Float32Array(MAX_FFT_BANDS);
    this.fftOutputTelemetry = new Float32Array(MAX_FFT_BANDS);
    this.fftAnalysisWrite = 0;
    this.fftAnalysisFill = 0;
    this.fftHopCounter = 0;
    this.fftOlaRead = 0;
    this.fftAnalysisMicros = 0;
    this.fftAnalysisFrames = 0;
    this.fftConfigured = false;
    this.fftOutputAge = 0;
    this.fftHasFrame = false;
    this.fftNormalizationFloor = 0.05;
    this.fftCurrentDetail = this.fftDetail;
    this.fftCurrentResponseSeconds = this.fftResponseSeconds;
    this.fftCurrentGateDb = this.fftGateDb;
    this.fftCurrentInputGain = this.fftInputGain;
    this.spatialSettings = SPATIAL_DEFAULTS; this.spatialPhase = 0;
    this.spatialOla = new Float64Array(OLA_BUFFER_SIZE * MAX_SPATIAL_CHANNELS);
    this.spatialReal = new Float64Array(MAX_FFT_SIZE); this.spatialImaginary = new Float64Array(MAX_FFT_SIZE);
    this.spatialPositions = new Float64Array(MAX_FFT_SIZE / 2); this.spatialPositionsReady = false;
    this.spatialLeft = new Uint32Array(MAX_FFT_SIZE / 2); this.spatialRight = new Uint32Array(MAX_FFT_SIZE / 2);
    this.spatialLeftGain = new Float64Array(MAX_FFT_SIZE / 2); this.spatialRightGain = new Float64Array(MAX_FFT_SIZE / 2);
    this.spatialSample = new Float32Array(MAX_SPATIAL_CHANNELS); this.spatialRoute = {};
    this.fftInputGainStep = 1 - Math.exp(-1 / (sampleRate * 0.012));
  }

  resetResynthesis() {
    this.spatialOla.fill(0); this.spatialSample.fill(0); this.spatialPositionsReady = false;
    this.fftAnalysisRing.fill(0);
    this.fftReal.fill(0);
    this.fftImaginary.fill(0);
    this.fftOla.fill(0);
    this.fftOlaNormalization.fill(0);
    this.fftBandPower.fill(0);
    this.fftBandWeight.fill(0);
    this.fftBandMagnitude.fill(0);
    this.fftBandEnvelope.fill(0);
    this.fftInputTelemetry.fill(0);
    this.fftOutputTelemetry.fill(0);
    this.fftAnalysisWrite = 0;
    this.fftAnalysisFill = 0;
    this.fftHopCounter = 0;
    this.fftOlaRead = 0;
    this.fftAnalysisMicros = 0;
    this.fftAnalysisFrames = 0;
    this.fftOutputAge = 0;
    this.fftHasFrame = false;
  }

  configureResynthesis(configuration) {
    const next = resynthesisConfiguration(configuration, this.sampleRate);
    const rebuild = !this.fftConfigured || !this.matches(next);
    Object.assign(this, next);
    if (rebuild) {
      this.fftWindowSum = writeWindow(this.fftWindowValues, this.fftSize, this.fftWindow);
      this.resetResynthesis();
      // The first overlap is incomplete; never divide a filtered inverse FFT
      // by a near-zero window edge. A small floor also bounds 100%-hop windows.
      this.fftCurrentDetail = this.fftDetail;
      this.fftCurrentResponseSeconds = this.fftResponseSeconds;
      this.fftCurrentGateDb = this.fftGateDb;
      this.fftCurrentInputGain = this.fftInputGain;
    }
    this.fftConfigured = true;
  }

  analyzeResynthesisFrame() {
    if (this.fftAnalysisFill < this.fftSize) return;
    const started = globalThis.performance?.now?.() ?? 0;
    const size = this.fftSize;
    const halfSize = size >> 1;
    const bandCount = this.fftBandCount;
    for (let index = 0; index < size; index += 1) {
      const sourceIndex = (this.fftAnalysisWrite + index) % size;
      this.fftReal[index] = this.fftAnalysisRing[sourceIndex] * this.fftWindowValues[index];
      this.fftImaginary[index] = 0;
    }
    fftInPlace(this.fftReal, this.fftImaginary, size);
    this.fftBandPower.fill(0, 0, bandCount);
    this.fftBandWeight.fill(0, 0, bandCount);
    const logLow = Math.log(this.fftLowFrequency);
    const logScale = (bandCount - 1) / Math.log(this.fftHighFrequency / this.fftLowFrequency);
    for (let bin = 1; bin < halfSize; bin += 1) {
      const frequency = bin * this.sampleRate / size;
      if (frequency < this.fftLowFrequency || frequency > this.fftHighFrequency) continue;
      const position = clamp((Math.log(frequency) - logLow) * logScale, 0, bandCount - 1);
      const leftBand = Math.floor(position); const rightBand = Math.min(bandCount - 1, leftBand + 1);
      const rightWeight = position - leftBand; const leftWeight = 1 - rightWeight;
      const power = this.fftReal[bin] * this.fftReal[bin] + this.fftImaginary[bin] * this.fftImaginary[bin];
      this.fftBandPower[leftBand] += power * leftWeight; this.fftBandWeight[leftBand] += leftWeight;
      if (rightBand !== leftBand) {
        this.fftBandPower[rightBand] += power * rightWeight; this.fftBandWeight[rightBand] += rightWeight;
      }
    }
    const parameterStep = 1 - Math.exp(-this.fftHopSize / (this.sampleRate * 0.02));
    this.fftCurrentDetail += (this.fftDetail - this.fftCurrentDetail) * parameterStep;
    this.fftCurrentResponseSeconds += (this.fftResponseSeconds - this.fftCurrentResponseSeconds) * parameterStep;
    this.fftCurrentGateDb += (this.fftGateDb - this.fftCurrentGateDb) * parameterStep;
    const attackRetention = Math.exp(-this.fftHopSize / (this.sampleRate * 0.004));
    const releaseRetention = Math.exp(-this.fftHopSize / (this.sampleRate * this.fftCurrentResponseSeconds));
    for (let band = 0; band < bandCount; band += 1) {
      const magnitude = this.fftBandWeight[band] > 1e-9
        ? Math.sqrt(this.fftBandPower[band] / this.fftBandWeight[band]) : 0;
      const normalized = magnitude * 2 / this.fftWindowSum;
      const db = 20 * Math.log10(Math.max(1e-12, normalized));
      const gatePosition = clamp((db - (this.fftCurrentGateDb - 4)) / 8, 0, 1);
      const gate = gatePosition * gatePosition * (3 - 2 * gatePosition);
      const target = magnitude * gate;
      const previous = this.fftBandEnvelope[band];
      const retention = target > previous ? attackRetention : releaseRetention;
      const envelope = target + (previous - target) * retention;
      this.fftBandMagnitude[band] = magnitude;
      this.fftBandEnvelope[band] = envelope;
      this.fftInputTelemetry[band] = clamp((db + 84) / 72, 0, 1);
      const outputDb = 20 * Math.log10(Math.max(1e-12, envelope * 2 / this.fftWindowSum));
      this.fftOutputTelemetry[band] = clamp((outputDb + 84) / 72, 0, 1);
    }
    this.fftInputTelemetry.fill(0, bandCount);
    this.fftOutputTelemetry.fill(0, bandCount);
    this.fftReal[0] = 0; this.fftImaginary[0] = 0;
    this.fftReal[halfSize] = 0; this.fftImaginary[halfSize] = 0;
    for (let bin = 1; bin < halfSize; bin += 1) {
      const frequency = bin * this.sampleRate / size;
      if (frequency < this.fftLowFrequency || frequency > this.fftHighFrequency) {
        this.fftReal[bin] = 0; this.fftImaginary[bin] = 0;
      } else {
        const position = clamp((Math.log(frequency) - logLow) * logScale, 0, bandCount - 1);
        const leftBand = Math.floor(position); const rightBand = Math.min(bandCount - 1, leftBand + 1);
        const rightWeight = position - leftBand; const leftWeight = 1 - rightWeight;
        const rawBand = this.fftBandMagnitude[leftBand] * leftWeight + this.fftBandMagnitude[rightBand] * rightWeight;
        const envelope = this.fftBandEnvelope[leftBand] * leftWeight + this.fftBandEnvelope[rightBand] * rightWeight;
        const real = this.fftReal[bin]; const imaginary = this.fftImaginary[bin];
        const magnitude = Math.hypot(real, imaginary);
        const detailedMagnitude = magnitude * envelope / Math.max(1e-12, rawBand);
        const targetMagnitude = detailedMagnitude * this.fftCurrentDetail + envelope * (1 - this.fftCurrentDetail);
        const gain = magnitude > 1e-12 ? targetMagnitude / magnitude : 0;
        this.fftReal[bin] = real * gain; this.fftImaginary[bin] = imaginary * gain;
      }
      this.fftReal[size - bin] = this.fftReal[bin];
      this.fftImaginary[size - bin] = -this.fftImaginary[bin];
    }
    if (this.spatialSettings.enabled && this.spatialSettings.target !== 'modes') this.spatializeFrame(size);
    fftInPlace(this.fftReal, this.fftImaginary, size, true);
    const writeStart = (this.fftOlaRead + 1) & OLA_BUFFER_MASK;
    for (let index = 0; index < size; index += 1) {
      const destination = (writeStart + index) & OLA_BUFFER_MASK;
      const windowValue = this.fftWindowValues[index];
      this.fftOla[destination] += this.fftReal[index] * windowValue;
      if (this.spatialSettings.enabled && this.spatialSettings.target === 'modes') {
        // FFT not selected for motion stays audible at the stationary origin.
        this.spatialOla[destination] += this.fftReal[index] * windowValue;
      }
      this.fftOlaNormalization[destination] += windowValue * windowValue;
    }
    this.fftHasFrame = true;
    const finished = globalThis.performance?.now?.() ?? started;
    if (finished >= started) { this.fftAnalysisMicros += (finished - started) * 1_000; this.fftAnalysisFrames += 1; }
  }

  processResynthesisSample(input) {
    this.fftCurrentInputGain += (this.fftInputGain - this.fftCurrentInputGain) * this.fftInputGainStep;
    this.fftAnalysisRing[this.fftAnalysisWrite] = input * this.fftCurrentInputGain;
    this.fftAnalysisWrite = (this.fftAnalysisWrite + 1) % this.fftSize;
    if (this.fftAnalysisFill < this.fftSize) this.fftAnalysisFill += 1;
    this.fftHopCounter += 1;
    if (this.fftAnalysisFill === this.fftSize && this.fftHopCounter >= this.fftHopSize) {
      this.fftHopCounter = 0;
      this.analyzeResynthesisFrame();
    }
    const normalization = this.fftOlaNormalization[this.fftOlaRead];
    const output = this.fftOla[this.fftOlaRead] / Math.max(this.fftNormalizationFloor, normalization);
    if (this.fftHasFrame) this.fftOutputAge = Math.min(this.fftSize, this.fftOutputAge + 1);
    const warm = this.fftOutputAge / this.fftSize;
    const startupGain = warm * warm * (3 - 2 * warm);
    for (let channel = 0; channel < MAX_SPATIAL_CHANNELS; channel++) {
      const index = channel * OLA_BUFFER_SIZE + this.fftOlaRead;
      const spatial = this.spatialOla[index] / Math.max(this.fftNormalizationFloor, normalization);
      this.spatialSample[channel] = this.spatialSettings.enabled ? clamp(finite(spatial * startupGain, 0), -2, 2) : 0;
      this.spatialOla[index] = 0;
    }
    this.fftOla[this.fftOlaRead] = 0;
    this.fftOlaNormalization[this.fftOlaRead] = 0;
    this.fftOlaRead = (this.fftOlaRead + 1) & OLA_BUFFER_MASK;
    return clamp(finite(output * startupGain, 0), -2, 2);
  }

  configureSpatial(settings, phase) {
    if (settings.enabled && !this.spatialSettings.enabled) {
      // Existing queued mono overlap provides a continuous starting point while
      // new independently routed frames replace it through the same windows.
      this.spatialOla.fill(0); this.spatialOla.set(this.fftOla);
      this.spatialPositionsReady = false;
    } else if (!settings.enabled && this.spatialSettings.enabled) {
      this.spatialOla.fill(0); this.spatialSample.fill(0);
    }
    this.spatialSettings = settings; this.spatialPhase = phase;
  }

  spatializeFrame(size) {
    const half = size >> 1, settings = this.spatialSettings;
    const count = settings.speakerCount;
    const logLow = Math.log(this.fftLowFrequency);
    const logRange = Math.log(this.fftHighFrequency / this.fftLowFrequency);
    const approach = 1 - Math.exp(-this.fftHopSize / (this.sampleRate * .025));
    let active = 0;
    for (let bin = 1; bin < half; bin++) {
      const frequency = bin * this.sampleRate / size;
      if (frequency < this.fftLowFrequency || frequency > this.fftHighFrequency) {
        this.spatialLeftGain[bin] = this.spatialRightGain[bin] = 0; continue;
      }
      const band = clamp((Math.log(frequency) - logLow) / logRange, 0, 1) * (this.fftBandCount - 1);
      const target = spatialPosition(band, this.fftBandCount, settings, this.spatialPhase, 'fft');
      if (!this.spatialPositionsReady) this.spatialPositions[bin] = target;
      let delta = target - this.spatialPositions[bin]; delta -= Math.round(delta);
      this.spatialPositions[bin] = wrapTurn(this.spatialPositions[bin] + delta * approach);
      const route = equalPowerRoute(this.spatialPositions[bin], count, this.spatialRoute);
      this.spatialLeft[bin] = route.left; this.spatialRight[bin] = route.right;
      this.spatialLeftGain[bin] = route.leftGain; this.spatialRightGain[bin] = route.rightGain;
      active |= (1 << route.left) | (1 << route.right);
    }
    this.spatialPositionsReady = true;
    const writeStart = (this.fftOlaRead + 1) & OLA_BUFFER_MASK;
    for (let channel = 0; channel < count; channel += 2) {
      if (!(active & (3 << channel))) continue;
      // Pack two real-output inverse transforms into one complex inverse:
      // IFFT(A+iB) has channelA in its real part and channelB in imaginary.
      this.spatialReal.fill(0, 0, size); this.spatialImaginary.fill(0, 0, size);
      for (let bin = 1; bin < half; bin++) {
        const gainA = (this.spatialLeft[bin] === channel ? this.spatialLeftGain[bin] : 0)
          + (this.spatialRight[bin] === channel ? this.spatialRightGain[bin] : 0);
        const gainB = (this.spatialLeft[bin] === channel + 1 ? this.spatialLeftGain[bin] : 0)
          + (this.spatialRight[bin] === channel + 1 ? this.spatialRightGain[bin] : 0);
        const real = this.fftReal[bin], imaginary = this.fftImaginary[bin];
        const ar = real * gainA, ai = imaginary * gainA, br = real * gainB, bi = imaginary * gainB;
        this.spatialReal[bin] = ar - bi; this.spatialImaginary[bin] = ai + br;
        this.spatialReal[size - bin] = ar + bi; this.spatialImaginary[size - bin] = -ai + br;
      }
      fftInPlace(this.spatialReal, this.spatialImaginary, size, true);
      const offsetA = channel * OLA_BUFFER_SIZE, offsetB = (channel + 1) * OLA_BUFFER_SIZE;
      for (let index = 0; index < size; index++) {
        const destination = (writeStart + index) & OLA_BUFFER_MASK;
        const window = this.fftWindowValues[index];
        this.spatialOla[offsetA + destination] += this.spatialReal[index] * window;
        if (channel + 1 < count) this.spatialOla[offsetB + destination] += this.spatialImaginary[index] * window;
      }
    }
  }

  primeInput(history, write, fill) {
    const count = Math.min(this.fftSize, fill);
    const start = (write - count + MAX_FFT_SIZE) % MAX_FFT_SIZE;
    for (let index = 0; index < count; index += 1) {
      this.fftAnalysisRing[index] = history[(start + index) % MAX_FFT_SIZE] * this.fftInputGain;
    }
    this.fftAnalysisFill = count;
    this.fftAnalysisWrite = count % this.fftSize;
    this.fftHopCounter = this.fftHopSize - 1;
    // Analysis is primed, but synthesis is not. The caller retains the old
    // bank until a complete window of overlapping output has accumulated.
  }

  matches(configuration) {
    return this.fftSize === configuration.fftSize && this.fftWindow === configuration.fftWindow
      && this.fftHopSize === configuration.fftHopSize && this.fftBandCount === configuration.fftBandCount
      && this.fftLowFrequency === configuration.fftLowFrequency && this.fftHighFrequency === configuration.fftHighFrequency;
  }

  get warmed() { return this.fftOutputAge >= this.fftSize; }
}

export class FftResynth {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.fftCurrent = new FftResynthesisBank(sampleRate); this.fftSpare = new FftResynthesisBank(sampleRate);
    this.fftTransition = false; this.fftCrossfade = 0; this.fftCrossfadeLength = Math.round(sampleRate * .024);
    this.fftQueuedConfiguration = null; this.configuration = null;
    this.fftInputHistory = new Float32Array(MAX_FFT_SIZE); this.fftHistoryWrite = 0; this.fftHistoryFill = 0;
    this.fftMix = .94; this.spatialSample = new Float32Array(MAX_SPATIAL_CHANNELS);
    this.spatialSettings = SPATIAL_DEFAULTS; this.spatialPhase = 0;
  }
  get fftSize() { return (this.fftQueuedConfiguration || (this.fftTransition ? this.fftSpare : this.fftCurrent)).fftSize; }
  get fftHopSize() { return (this.fftQueuedConfiguration || (this.fftTransition ? this.fftSpare : this.fftCurrent)).fftHopSize; }
  get fftBandCount() { return (this.fftQueuedConfiguration || (this.fftTransition ? this.fftSpare : this.fftCurrent)).fftBandCount; }
  get fftAnalysisFill() { return this.fftCurrent.fftAnalysisFill; }
  get fftInputTelemetry() { return this.fftCurrent.fftInputTelemetry; }
  get fftOutputTelemetry() { return this.fftCurrent.fftOutputTelemetry; }
  get fftAnalysisMicros() { return this.fftCurrent.fftAnalysisMicros + this.fftSpare.fftAnalysisMicros; }
  get fftAnalysisFrames() { return this.fftCurrent.fftAnalysisFrames + this.fftSpare.fftAnalysisFrames; }
  configureSpatial(settings, phase) {
    this.spatialSettings = settings; this.spatialPhase = phase;
    this.fftCurrent.configureSpatial(settings, phase); this.fftSpare.configureSpatial(settings, phase);
  }
  resetResynthesis() {
    this.fftCurrent.resetResynthesis(); this.fftSpare.resetResynthesis();
    this.fftTransition = false; this.fftCrossfade = 0; this.fftQueuedConfiguration = null;
    this.fftInputHistory.fill(0); this.fftHistoryFill = this.fftHistoryWrite = 0;
    this.spatialSample.fill(0);
    if (this.configuration) this.fftCurrent.configureResynthesis(this.configuration);
  }
  // New source-based excitation starts against real zero prehistory. Without
  // this, a frame-zero impulse lands at the Hann window's zero edge and vanishes.
  // Legacy callers retain their original cold-start ramp and exact samples.
  primeSilence() {
    if (this.fftHistoryFill || !this.fftCurrent.fftConfigured) return;
    this.fftHistoryFill = MAX_FFT_SIZE;
    this.fftCurrent.fftAnalysisFill = this.fftCurrent.fftSize;
    this.fftCurrent.fftOutputAge = this.fftCurrent.fftSize;
    this.fftCurrent.fftHasFrame = true;
  }
  configureResynthesis(configuration) {
    const next = resynthesisConfiguration(configuration, this.sampleRate);
    this.configuration = next; this.fftMix = next.fftMix;
    if (!this.fftCurrent.fftConfigured || !this.fftHistoryFill) {
      this.fftCurrent.configureResynthesis(next); this.fftQueuedConfiguration = null; return;
    }
    const destination = this.fftTransition ? this.fftSpare : this.fftCurrent;
    if (destination.matches(next)) {
      destination.configureResynthesis(next); this.fftQueuedConfiguration = null;
    } else {
      this.fftQueuedConfiguration = next; this.beginResynthesisTransition();
    }
  }
  beginResynthesisTransition() {
    if (this.fftTransition || !this.fftQueuedConfiguration) return;
    const next = this.fftQueuedConfiguration; this.fftQueuedConfiguration = null;
    this.fftSpare.configureResynthesis(next); this.fftSpare.resetResynthesis();
    this.fftSpare.primeInput(this.fftInputHistory, this.fftHistoryWrite, this.fftHistoryFill);
    this.fftSpare.configureSpatial(this.spatialSettings, this.spatialPhase);
    this.fftTransition = true; this.fftCrossfade = 0;
  }
  processResynthesisSample(input) {
    this.fftInputHistory[this.fftHistoryWrite] = input;
    this.fftHistoryWrite = (this.fftHistoryWrite + 1) % MAX_FFT_SIZE;
    this.fftHistoryFill = Math.min(MAX_FFT_SIZE, this.fftHistoryFill + 1);
    const previous = this.fftCurrent.processResynthesisSample(input);
    this.spatialSample.set(this.fftCurrent.spatialSample);
    if (!this.fftTransition) return previous;
    const next = this.fftSpare.processResynthesisSample(input);
    if (!this.fftSpare.warmed) return previous;
    this.fftCrossfade += 1;
    const fraction = Math.min(1, this.fftCrossfade / this.fftCrossfadeLength);
    const blend = fraction * fraction * (3 - 2 * fraction);
    const output = previous + (next - previous) * blend;
    for (let channel = 0; channel < MAX_SPATIAL_CHANNELS; channel++) {
      this.spatialSample[channel] += (this.fftSpare.spatialSample[channel] - this.spatialSample[channel]) * blend;
    }
    if (fraction >= 1) {
      const old = this.fftCurrent; this.fftCurrent = this.fftSpare; this.fftSpare = old; this.fftTransition = false;
    }
    return output;
  }
}

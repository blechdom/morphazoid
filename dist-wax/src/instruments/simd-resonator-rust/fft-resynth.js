// The original phase-preserving FFT/overlap-add path, retained independently
// from the new Rust modal bank so the existing input sound remains available.
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

export class FftResynth {
  constructor(sampleRate = 48000) {
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
    this.fftResynthBlock = new Float32Array(BLOCK_SIZE);
    this.fftAnalysisWrite = 0;
    this.fftAnalysisFill = 0;
    this.fftHopCounter = 0;
    this.fftOlaRead = 0;
    this.fftAnalysisMicros = 0;
    this.fftAnalysisFrames = 0;
    this.fftConfigured = false;
  }
  resetResynthesis() {
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
    this.fftResynthBlock.fill(0);
    this.fftAnalysisWrite = 0;
    this.fftAnalysisFill = 0;
    this.fftHopCounter = 0;
    this.fftOlaRead = 0;
    this.fftAnalysisMicros = 0;
    this.fftAnalysisFrames = 0;
  }

  configureResynthesis(configuration) {
    const requestedSize = clamp(Math.round(finite(configuration.fftSize, 1_024)), 256, MAX_FFT_SIZE);
    const nextSize = requestedSize < 384 ? 256 : requestedSize < 768 ? 512
      : requestedSize < 1_536 ? 1_024 : requestedSize < 3_072 ? 2_048 : 4_096;
    const nextWindow = clamp(Math.round(finite(configuration.fftWindow, 0)), 0, 3);
    const nextHop = clamp(Math.round(finite(configuration.fftHopSize, nextSize * 0.25) / 32) * 32, 32, nextSize);
    const nextBandCount = Math.max(16, aligned(configuration.fftBandCount, 96, MAX_FFT_BANDS));
    const nextLow = clamp(finite(configuration.fftLowFrequency, 70), 20, this.sampleRate * 0.22);
    const nextHigh = clamp(finite(configuration.fftHighFrequency, 12_000), nextLow * 2, this.sampleRate * 0.45);
    const rebuild = !this.fftConfigured || nextSize !== this.fftSize || nextWindow !== this.fftWindow
      || nextHop !== this.fftHopSize || nextBandCount !== this.fftBandCount
      || nextLow !== this.fftLowFrequency || nextHigh !== this.fftHighFrequency;
    this.fftSize = nextSize;
    this.fftWindow = nextWindow;
    this.fftHopSize = nextHop;
    this.fftBandCount = nextBandCount;
    this.fftResponseSeconds = clamp(finite(configuration.fftResponseSeconds, 0.038), 0.004, 0.8);
    this.fftLowFrequency = nextLow;
    this.fftHighFrequency = nextHigh;
    this.fftDetail = clamp(finite(configuration.fftDetail, 0.9), 0, 1);
    this.fftMix = clamp(finite(configuration.fftMix, 0.94), 0, 1);
    this.fftInputGain = clamp(finite(configuration.fftInputGain, 1.4), 0.25, 4);
    this.fftGateDb = clamp(finite(configuration.fftGateDb, -72), -96, -30);
    if (rebuild) {
      this.fftWindowSum = writeWindow(this.fftWindowValues, this.fftSize, this.fftWindow);
      this.resetResynthesis();
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
    const attackRetention = Math.exp(-this.fftHopSize / (this.sampleRate * 0.004));
    const releaseRetention = Math.exp(-this.fftHopSize / (this.sampleRate * this.fftResponseSeconds));
    for (let band = 0; band < bandCount; band += 1) {
      const magnitude = this.fftBandWeight[band] > 1e-9
        ? Math.sqrt(this.fftBandPower[band] / this.fftBandWeight[band]) : 0;
      const normalized = magnitude * 2 / this.fftWindowSum;
      const db = 20 * Math.log10(Math.max(1e-12, normalized));
      const gatePosition = clamp((db - (this.fftGateDb - 4)) / 8, 0, 1);
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
        const targetMagnitude = detailedMagnitude * this.fftDetail + envelope * (1 - this.fftDetail);
        const gain = magnitude > 1e-12 ? targetMagnitude / magnitude : 0;
        this.fftReal[bin] = real * gain; this.fftImaginary[bin] = imaginary * gain;
      }
      this.fftReal[size - bin] = this.fftReal[bin];
      this.fftImaginary[size - bin] = -this.fftImaginary[bin];
    }
    fftInPlace(this.fftReal, this.fftImaginary, size, true);
    const writeStart = (this.fftOlaRead + 1) & OLA_BUFFER_MASK;
    for (let index = 0; index < size; index += 1) {
      const destination = (writeStart + index) & OLA_BUFFER_MASK;
      const windowValue = this.fftWindowValues[index];
      this.fftOla[destination] += this.fftReal[index] * windowValue;
      this.fftOlaNormalization[destination] += windowValue * windowValue;
    }
    const finished = globalThis.performance?.now?.() ?? started;
    if (finished >= started) { this.fftAnalysisMicros += (finished - started) * 1_000; this.fftAnalysisFrames += 1; }
  }

  processResynthesisSample(input) {
    this.fftAnalysisRing[this.fftAnalysisWrite] = input * this.fftInputGain;
    this.fftAnalysisWrite = (this.fftAnalysisWrite + 1) % this.fftSize;
    if (this.fftAnalysisFill < this.fftSize) this.fftAnalysisFill += 1;
    this.fftHopCounter += 1;
    if (this.fftAnalysisFill === this.fftSize && this.fftHopCounter >= this.fftHopSize) {
      this.fftHopCounter = 0;
      this.analyzeResynthesisFrame();
    }
    const normalization = this.fftOlaNormalization[this.fftOlaRead];
    const output = normalization > 1e-8 ? this.fftOla[this.fftOlaRead] / normalization : 0;
    this.fftOla[this.fftOlaRead] = 0;
    this.fftOlaNormalization[this.fftOlaRead] = 0;
    this.fftOlaRead = (this.fftOlaRead + 1) & OLA_BUFFER_MASK;
    return clamp(finite(output, 0), -2, 2);
  }

}

const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);
const WINDOW_SIZE = 4_096;
const WINDOW = Float32Array.from(
  { length: WINDOW_SIZE },
  (_, index) => Math.sin(Math.PI * index / WINDOW_SIZE) ** 2,
);
const GRAIN_SECONDS = 0.11;
const PARAMETER_SMOOTHING_SECONDS = 0.035;
const BYPASS_SMOOTHING_SECONDS = 0.02;
const BYPASS_START_SEMITONES = 0.04;
const BYPASS_END_SEMITONES = 0.3;

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function routePhase(seed, route) {
  let hash = (
    Math.imul((Number(seed) || 0) + 1, 0x9e3779b1)
    ^ Math.imul(route + 1, 0x85ebca77)
  ) | 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return ((hash >>> 0) + 0.5) / 0x1_0000_0000;
}

function smoothstep(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

class MorphazoidGraphTurnProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.sourceCount = Math.min(32, Math.max(1, Math.round(processorOptions.sourceCount ?? 1)));
    this.outputCount = Math.min(32, Math.max(1, Math.round(processorOptions.outputCount ?? 1)));
    this.routeCount = this.sourceCount * this.outputCount;
    const requestedSampleRate = Number(globalThis.sampleRate);
    this.sampleRate = Number.isFinite(requestedSampleRate)
      ? clamp(requestedSampleRate, 8_000, 192_000)
      : 48_000;
    // The former 1,024-sample grain was only 21 ms at 48 kHz, which turns
    // speech into a pitched buzz. Match mic(mic)'s proven 110 ms overlap and
    // size the history for the actual AudioContext sample rate.
    this.windowSamples = Math.max(64, Math.round(this.sampleRate * GRAIN_SECONDS));
    this.bufferSize = nextPowerOfTwo(this.windowSamples + 8);
    this.bufferMask = this.bufferSize - 1;
    // Incoming graph edges are already normalized for their destination's
    // indegree. Scaling again here made every merge unnecessarily quieter.
    this.mixScale = 1;
    this.parameterSmoothingSeconds = PARAMETER_SMOOTHING_SECONDS;
    this.buffers = Array.from(
      { length: this.sourceCount },
      () => new Float32Array(this.bufferSize),
    );
    this.writeIndices = new Uint32Array(this.sourceCount);
    this.phases = new Float32Array(this.routeCount);
    this.currentSemitones = new Float32Array(this.routeCount);
    this.targetSemitones = new Float32Array(this.routeCount);
    this.ratios = new Float32Array(this.routeCount).fill(1);
    this.ratioDeltas = new Float32Array(this.routeCount);
    this.endRatios = new Float32Array(this.routeCount).fill(1);
    this.shiftMixes = new Float32Array(this.routeCount);
    this.shiftMixDeltas = new Float32Array(this.routeCount);
    this.endShiftMixes = new Float32Array(this.routeCount);
    this.samples = new Float32Array(this.sourceCount);
    for (let route = 0; route < this.routeCount; route += 1) {
      this.phases[route] = routePhase(processorOptions.phaseSeed, route);
    }
    this.port.onmessage = (event) => {
      if (event.data?.type !== "turns" || !Array.isArray(event.data.semitones)) return;
      const smoothingMs = Number(event.data.smoothingMs);
      if (Number.isFinite(smoothingMs)) {
        this.parameterSmoothingSeconds = clamp(smoothingMs, 10, 500) / 1_000;
      }
      for (let source = 0; source < this.sourceCount; source += 1) {
        const row = event.data.semitones[source];
        for (let output = 0; output < this.outputCount; output += 1) {
          const route = source * this.outputCount + output;
          this.targetSemitones[route] = clamp(row?.[output], -48, 48);
        }
      }
    };
  }

  read(source, delaySamples) {
    const buffer = this.buffers[source];
    const position = this.writeIndices[source] - delaySamples;
    const floor = Math.floor(position);
    const before = floor & this.bufferMask;
    const after = (before + 1) & this.bufferMask;
    const mix = position - floor;
    return buffer[before] + (buffer[after] - buffer[before]) * mix;
  }

  shiftedSample(source, route) {
    const ratio = this.ratios[route];
    const phase = this.phases[route];
    const alternate = (phase + 0.5) % 1;
    const firstDelay = (ratio > 1 ? 1 - phase : phase) * this.windowSamples + 4;
    const secondDelay = (ratio > 1 ? 1 - alternate : alternate) * this.windowSamples + 4;
    const firstWindow = WINDOW[Math.floor(phase * WINDOW_SIZE) % WINDOW_SIZE];
    const secondWindow = WINDOW[Math.floor(alternate * WINDOW_SIZE) % WINDOW_SIZE];
    this.phases[route] = (
      phase + Math.abs(1 - ratio) / this.windowSamples
    ) % 1;
    return this.read(source, firstDelay) * firstWindow
      + this.read(source, secondDelay) * secondWindow;
  }

  process(inputs, outputs) {
    const frameCount = outputs[0]?.[0]?.length ?? 128;
    const parameterSmoothing = 1 - Math.exp(
      -frameCount / (this.sampleRate * this.parameterSmoothingSeconds),
    );
    const bypassSmoothing = 1 - Math.exp(
      -frameCount / (this.sampleRate * BYPASS_SMOOTHING_SECONDS),
    );
    for (let route = 0; route < this.routeCount; route += 1) {
      const semitones = this.currentSemitones[route]
        + (this.targetSemitones[route] - this.currentSemitones[route]) * parameterSmoothing;
      const endRatio = clamp(2 ** (semitones / 12), 0.0625, 16);
      const normalizedShift = (
        Math.abs(semitones) - BYPASS_START_SEMITONES
      ) / (BYPASS_END_SEMITONES - BYPASS_START_SEMITONES);
      const targetShiftMix = smoothstep(normalizedShift);
      const endShiftMix = this.shiftMixes[route]
        + (targetShiftMix - this.shiftMixes[route]) * bypassSmoothing;
      this.currentSemitones[route] = semitones;
      this.endRatios[route] = endRatio;
      this.ratioDeltas[route] = (endRatio - this.ratios[route]) / frameCount;
      this.endShiftMixes[route] = endShiftMix;
      this.shiftMixDeltas[route] = (endShiftMix - this.shiftMixes[route]) / frameCount;
    }
    for (const output of outputs) output[0]?.fill(0);
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let source = 0; source < this.sourceCount; source += 1) {
        const sample = inputs[source]?.[0]?.[frame] ?? 0;
        this.samples[source] = sample;
        this.buffers[source][this.writeIndices[source]] = sample;
        this.writeIndices[source] = (this.writeIndices[source] + 1) & this.bufferMask;
      }
      for (let output = 0; output < this.outputCount; output += 1) {
        const channel = outputs[output]?.[0];
        if (!channel) continue;
        let mixed = 0;
        for (let source = 0; source < this.sourceCount; source += 1) {
          const route = source * this.outputCount + output;
          const shiftMix = this.shiftMixes[route];
          if (shiftMix <= 0.0001) {
            mixed += this.samples[source];
          } else {
            const shifted = this.shiftedSample(source, route);
            if (shiftMix >= 0.9999) {
              mixed += shifted;
            } else {
              mixed += this.samples[source] * Math.cos(shiftMix * Math.PI * 0.5)
                + shifted * Math.sin(shiftMix * Math.PI * 0.5);
            }
          }
          this.ratios[route] += this.ratioDeltas[route];
          this.shiftMixes[route] += this.shiftMixDeltas[route];
        }
        channel[frame] = mixed * this.mixScale;
      }
    }
    this.ratios.set(this.endRatios);
    this.shiftMixes.set(this.endShiftMixes);
    return true;
  }
}

registerProcessor("morphazoid-graph-turns", MorphazoidGraphTurnProcessor);

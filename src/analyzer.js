const DEFAULT_MIN_FREQUENCY = 20;
const DEFAULT_MAX_FREQUENCY = 20_000;

export function clamp(value, minimum = 0, maximum = 1) {
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  const number = Number(value);
  if (Number.isNaN(number)) return low;
  if (number === Infinity) return high;
  if (number === -Infinity) return low;
  return Math.min(high, Math.max(low, number));
}

export function dbToUnit(decibels, minimum = -100, maximum = -18) {
  if (!(maximum > minimum)) return 0;
  return clamp((Number(decibels) - minimum) / (maximum - minimum), 0, 1);
}

function safeFrequencyBounds(minimum, maximum) {
  const low = Math.max(1, Number.isFinite(Number(minimum))
    ? Number(minimum)
    : DEFAULT_MIN_FREQUENCY);
  const proposedHigh = Number.isFinite(Number(maximum))
    ? Number(maximum)
    : DEFAULT_MAX_FREQUENCY;
  return [low, Math.max(low * 1.000001, proposedHigh)];
}

export function frequencyToLogPosition(
  frequency,
  minimum = DEFAULT_MIN_FREQUENCY,
  maximum = DEFAULT_MAX_FREQUENCY,
) {
  const [low, high] = safeFrequencyBounds(minimum, maximum);
  const bounded = clamp(frequency, low, high);
  return Math.log(bounded / low) / Math.log(high / low);
}

export function logPositionToFrequency(
  position,
  minimum = DEFAULT_MIN_FREQUENCY,
  maximum = DEFAULT_MAX_FREQUENCY,
) {
  const [low, high] = safeFrequencyBounds(minimum, maximum);
  return low * ((high / low) ** clamp(position, 0, 1));
}

export function frequencyBin(
  frequency,
  sampleRate,
  fftSize,
  binCount = Math.floor(Number(fftSize) / 2),
) {
  const rate = Math.max(1, Number(sampleRate) || 48_000);
  const size = Math.max(2, Math.floor(Number(fftSize) || 2_048));
  const count = Math.max(1, Math.floor(Number(binCount) || (size / 2)));
  return clamp(Math.round((Number(frequency) || 0) * size / rate), 0, count - 1);
}

export function spectrumLogSamples(
  decibels,
  {
    sampleRate = 48_000,
    fftSize = 4_096,
    columns = 320,
    minimumFrequency = DEFAULT_MIN_FREQUENCY,
    maximumFrequency = DEFAULT_MAX_FREQUENCY,
    floorDb = -100,
  } = {},
) {
  const count = Math.max(1, Math.floor(Number(columns) || 1));
  const result = new Float32Array(count);
  const sourceLength = Math.max(0, Number(decibels?.length) || 0);
  const nyquist = Math.max(1, (Number(sampleRate) || 48_000) / 2);
  const upper = Math.min(maximumFrequency, nyquist);

  if (!sourceLength) {
    result.fill(floorDb);
    return result;
  }

  for (let index = 0; index < count; index += 1) {
    const position = count === 1 ? 0 : index / (count - 1);
    const frequency = logPositionToFrequency(position, minimumFrequency, upper);
    const rawBin = frequency * fftSize / sampleRate;
    const before = clamp(Math.floor(rawBin), 0, sourceLength - 1);
    const after = clamp(before + 1, 0, sourceLength - 1);
    const mix = clamp(rawBin - before, 0, 1);
    const a = Number.isFinite(decibels[before]) ? decibels[before] : floorDb;
    const b = Number.isFinite(decibels[after]) ? decibels[after] : floorDb;
    result[index] = a + ((b - a) * mix);
  }
  return result;
}

export function computeRms(samples) {
  const length = Math.max(0, Number(samples?.length) || 0);
  if (!length) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    const sample = Number(samples[index]);
    if (Number.isFinite(sample)) sum += sample * sample;
  }
  return Math.sqrt(sum / length);
}

export function peakAbsolute(samples) {
  const length = Math.max(0, Number(samples?.length) || 0);
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    const sample = Math.abs(Number(samples[index]));
    if (Number.isFinite(sample)) peak = Math.max(peak, sample);
  }
  return peak;
}

export function estimatePeakFrequency(
  decibels,
  sampleRate,
  fftSize,
  {
    minimumFrequency = DEFAULT_MIN_FREQUENCY,
    maximumFrequency = DEFAULT_MAX_FREQUENCY,
  } = {},
) {
  const length = Math.max(0, Number(decibels?.length) || 0);
  const rate = Math.max(1, Number(sampleRate) || 48_000);
  const size = Math.max(2, Math.floor(Number(fftSize) || 2_048));
  if (!length) return 0;

  const low = frequencyBin(minimumFrequency, rate, size, length);
  const high = frequencyBin(
    Math.min(maximumFrequency, rate / 2),
    rate,
    size,
    length,
  );
  let peakIndex = low;
  let peakDb = -Infinity;
  for (let index = low; index <= high; index += 1) {
    const value = Number(decibels[index]);
    if (Number.isFinite(value) && value > peakDb) {
      peakDb = value;
      peakIndex = index;
    }
  }
  if (!Number.isFinite(peakDb)) return 0;

  let offset = 0;
  if (peakIndex > 0 && peakIndex < length - 1) {
    const before = Number(decibels[peakIndex - 1]);
    const center = Number(decibels[peakIndex]);
    const after = Number(decibels[peakIndex + 1]);
    const denominator = before - (2 * center) + after;
    if (
      Number.isFinite(before)
      && Number.isFinite(center)
      && Number.isFinite(after)
      && Math.abs(denominator) > 1e-9
    ) {
      offset = clamp(0.5 * (before - after) / denominator, -0.5, 0.5);
    }
  }
  return Math.max(0, (peakIndex + offset) * rate / size);
}

const SPECTROGRAM_STOPS = Object.freeze([
  Object.freeze([0, Object.freeze([4, 7, 11])]),
  Object.freeze([0.18, Object.freeze([22, 18, 54])]),
  Object.freeze([0.4, Object.freeze([78, 32, 121])]),
  Object.freeze([0.62, Object.freeze([35, 156, 177])]),
  Object.freeze([0.82, Object.freeze([238, 190, 92])]),
  Object.freeze([1, Object.freeze([255, 248, 218])]),
]);

export function spectrogramRgb(value) {
  const unit = clamp(value, 0, 1);
  let upperIndex = 1;
  while (
    upperIndex < SPECTROGRAM_STOPS.length - 1
    && unit > SPECTROGRAM_STOPS[upperIndex][0]
  ) upperIndex += 1;
  const [lowPosition, lowColor] = SPECTROGRAM_STOPS[upperIndex - 1];
  const [highPosition, highColor] = SPECTROGRAM_STOPS[upperIndex];
  const mix = highPosition === lowPosition
    ? 0
    : (unit - lowPosition) / (highPosition - lowPosition);
  return lowColor.map((channel, index) => (
    Math.round(channel + ((highColor[index] - channel) * mix))
  ));
}

export function spectrogramColor(value) {
  const [red, green, blue] = spectrogramRgb(value);
  return `rgb(${red} ${green} ${blue})`;
}

export function makeSoftClipCurve(length = 2_048, drive = 1.15, ceiling = 0.92) {
  const size = Math.round(clamp(length, 32, 65_536));
  const amount = clamp(drive, 0.01, 12);
  const limit = clamp(ceiling, 0.1, 1);
  const normalizer = Math.tanh(amount);
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const input = ((index / (size - 1)) * 2) - 1;
    curve[index] = limit * Math.tanh(input * amount) / normalizer;
  }
  return curve;
}

export function normalizeFftSize(value, fallback = 4_096) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 32) return fallback;
  const exponent = Math.round(Math.log2(number));
  return 2 ** clamp(exponent, 5, 15);
}

export function frameIsDue(timestamp, previousTimestamp, framesPerSecond = 30) {
  const now = Number(timestamp);
  const previous = Number(previousTimestamp);
  const rate = clamp(framesPerSecond, 1, 120);
  if (!Number.isFinite(now)) return false;
  if (!Number.isFinite(previous)) return true;
  return now - previous >= (1_000 / rate);
}

export function formatFrequency(value) {
  const frequency = Math.max(0, Number(value) || 0);
  if (frequency >= 10_000) return `${(frequency / 1_000).toFixed(1)} kHz`;
  if (frequency >= 1_000) return `${(frequency / 1_000).toFixed(2)} kHz`;
  return `${Math.round(frequency)} Hz`;
}

function setAudioParam(param, value, time = 0, smoothing = 0) {
  if (!param) return;
  if (smoothing > 0 && typeof param.setTargetAtTime === "function") {
    param.setTargetAtTime(value, time, smoothing);
  } else if (typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, time);
  } else {
    param.value = value;
  }
}

/**
 * Build one analysis bus for every source:
 * input → master → DC filter → compressor → soft ceiling → analyser → monitor.
 *
 * The analyser therefore observes the exact safely limited master signal. The
 * monitor may be muted for microphone analysis without creating a second DSP
 * or visualization path.
 */
export function createAnalysisGraph(
  context,
  {
    level = 0.42,
    fftSize = 4_096,
    smoothing = 0.72,
  } = {},
) {
  if (
    !context?.createGain
    || !context?.createBiquadFilter
    || !context?.createDynamicsCompressor
    || !context?.createWaveShaper
    || !context?.createAnalyser
    || !context?.destination
  ) {
    throw new TypeError("A complete Web Audio context is required");
  }

  const input = context.createGain();
  const master = context.createGain();
  const highpass = context.createBiquadFilter();
  const limiter = context.createDynamicsCompressor();
  const ceiling = context.createWaveShaper();
  const analyser = context.createAnalyser();
  const monitor = context.createGain();
  const time = Number(context.currentTime) || 0;

  setAudioParam(input.gain, 1, time);
  setAudioParam(master.gain, clamp(level, 0, 1), time);
  highpass.type = "highpass";
  setAudioParam(highpass.frequency, 18, time);
  setAudioParam(highpass.Q, 0.707, time);
  setAudioParam(limiter.threshold, -10, time);
  setAudioParam(limiter.knee, 3, time);
  setAudioParam(limiter.ratio, 20, time);
  setAudioParam(limiter.attack, 0.003, time);
  setAudioParam(limiter.release, 0.12, time);
  ceiling.curve = makeSoftClipCurve();
  ceiling.oversample = "2x";
  analyser.fftSize = normalizeFftSize(fftSize);
  analyser.minDecibels = -100;
  analyser.maxDecibels = -18;
  analyser.smoothingTimeConstant = clamp(smoothing, 0, 0.96);
  setAudioParam(monitor.gain, 0, time);

  input.connect(master);
  master.connect(highpass);
  highpass.connect(limiter);
  limiter.connect(ceiling);
  ceiling.connect(analyser);
  analyser.connect(monitor);
  monitor.connect(context.destination);

  const nodes = [input, master, highpass, limiter, ceiling, analyser, monitor];
  return Object.freeze({
    input,
    master,
    highpass,
    limiter,
    ceiling,
    analyser,
    monitor,
    setLevel(value) {
      setAudioParam(
        master.gain,
        clamp(value, 0, 1),
        Number(context.currentTime) || 0,
        0.012,
      );
    },
    setMonitoring(enabled) {
      setAudioParam(
        monitor.gain,
        enabled ? 1 : 0,
        Number(context.currentTime) || 0,
        0.008,
      );
    },
    setSmoothing(value) {
      analyser.smoothingTimeConstant = clamp(value, 0, 0.96);
    },
    disconnect() {
      for (const node of nodes) {
        try {
          node.disconnect();
        } catch {
          // A partially torn-down browser graph is already safe.
        }
      }
      ceiling.curve = null;
    },
  });
}

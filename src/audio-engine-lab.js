const freezeEngine = (engine) => Object.freeze({
  ...engine,
  controls: Object.freeze({ ...engine.controls }),
});

export const ENGINE_DEFINITIONS = Object.freeze([
  freezeEngine({
    id: "raw",
    name: "Original loop",
    shortName: "Original",
    family: "Web Audio",
    detail: "Unprocessed AudioBufferSource baseline",
    backend: "Browser audio renderer",
    implementation: "native",
    gpu: "not used",
    controls: { pitch: false, time: false },
  }),
  freezeEngine({
    id: "native-tape",
    name: "Native Web Audio · Tape",
    shortName: "Native Tape",
    family: "Web Audio API",
    detail: "AudioBufferSource playback speed: extremely cheap, with pitch and duration coupled",
    backend: "Browser audio renderer",
    implementation: "native-varispeed",
    gpu: "not used",
    controls: { pitch: false, time: true, coupled: true },
  }),
  freezeEngine({
    id: "signalsmith-silky",
    name: "Signalsmith · Silky",
    shortName: "Signalsmith Silky",
    family: "Signalsmith Stretch 1.3.2",
    detail: "The smoother mic(mic) configuration: 160 ms blocks, 30 ms interval",
    backend: "WASM AudioWorklet",
    implementation: "signalsmith",
    gpu: "not used",
    controls: { pitch: true, time: true },
  }),
  freezeEngine({
    id: "signalsmith-economy",
    name: "Signalsmith · Economy",
    shortName: "Signalsmith Economy",
    family: "Signalsmith Stretch 1.3.2",
    detail: "The official cheaper preset: lower cost, shorter analysis",
    backend: "WASM AudioWorklet",
    implementation: "signalsmith",
    gpu: "not used",
    controls: { pitch: true, time: true },
  }),
  freezeEngine({
    id: "soundtouch",
    name: "SoundTouchJS",
    shortName: "SoundTouchJS",
    family: "SoundTouchJS 2.1.0",
    detail: "WSOLA time stretch with Lanczos pitch interpolation",
    backend: "JavaScript AudioWorklet",
    implementation: "soundtouch",
    gpu: "not used",
    controls: { pitch: true, time: true },
  }),
  freezeEngine({
    id: "soundtouch-phase-vocoder",
    name: "SoundTouchJS · Phase Vocoder",
    shortName: "SoundTouch Phase Vocoder",
    family: "SoundTouchJS 2.1.0 · FFT phase vocoder",
    detail: "2048-sample FFT with 4× overlap; smoother extremes, softer transients",
    backend: "JavaScript AudioWorklet",
    implementation: "soundtouch-phase-vocoder",
    gpu: "not used",
    controls: { pitch: true, time: true },
  }),
  freezeEngine({
    id: "tone-grain",
    name: "Tone.js · GrainPlayer",
    shortName: "Tone GrainPlayer",
    family: "Tone.js 15.1.22",
    detail: "Scheduled overlapping grains with independent detune and playback rate",
    backend: "JavaScript + native Web Audio nodes",
    implementation: "tone-grain-player",
    gpu: "not used",
    controls: { pitch: true, time: true },
  }),
  freezeEngine({
    id: "hybrid-soundtouch-signalsmith",
    name: "Hybrid · SoundTouch Time + Signalsmith Pitch",
    shortName: "Hybrid",
    family: "SoundTouchJS 2.1.0 + Signalsmith Stretch 1.3.2",
    detail: "WSOLA changes duration, then a live Signalsmith stage changes pitch",
    backend: "JavaScript + WASM AudioWorklets",
    implementation: "hybrid-soundtouch-signalsmith",
    gpu: "not used",
    controls: { pitch: true, time: true },
  }),
  freezeEngine({
    id: "elementary",
    name: "Elementary Audio",
    shortName: "Elementary",
    family: "Elementary 4.0.3 · Signalsmith backend",
    detail: "sampleseq2 graph, useful for measuring Elementary wrapper overhead",
    backend: "WASM AudioWorklet",
    implementation: "elementary-signalsmith",
    gpu: "not used",
    controls: { pitch: true, time: true },
  }),
]);

export const DEFAULT_ENGINE_SETTINGS = Object.freeze({
  pitch: 0,
  stretch: 1,
});

export function clamp(value, low, high, fallback = low) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, number));
}

/**
 * The lab's time control describes output duration.  Signalsmith and
 * SoundTouch accept playback rate, which is the reciprocal.
 */
export function durationFactorToPlaybackRate(durationFactor) {
  return 1 / clamp(durationFactor, 0.25, 4, 1);
}

export function formatPitch(semitones) {
  const value = clamp(semitones, -24, 24, 0);
  if (Math.abs(value) < 0.005) return "0 st";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} st`;
}

export function formatStretch(durationFactor) {
  return `${clamp(durationFactor, 0.25, 4, 1).toFixed(2)}× duration`;
}

export function tapePitchForDuration(durationFactor) {
  return -12 * Math.log2(clamp(durationFactor, 0.25, 4, 1));
}

export function formatTapeStretch(durationFactor) {
  const stretch = clamp(durationFactor, 0.25, 4, 1);
  return `${stretch.toFixed(2)}× · ${formatPitch(tapePitchForDuration(stretch))}`;
}

/**
 * Prepare one immutable mono test loop for every renderer:
 * remove DC, apply conservative RMS/peak normalization, then soften the
 * finite-buffer seam.  Every engine receives a private copy of this result.
 */
export function prepareMicLoop(
  input,
  sampleRate,
  {
    targetRms = 0.16,
    peakCeiling = 0.86,
    fadeSeconds = 0.012,
    maxGain = 4,
  } = {},
) {
  if (!input || typeof input.length !== "number" || input.length < 2) {
    throw new TypeError("A mic loop needs at least two samples.");
  }
  const rate = clamp(sampleRate, 8_000, 384_000, 48_000);
  const samples = Float32Array.from(input, (sample) => {
    const value = Number(sample);
    return Number.isFinite(value) ? clamp(value, -1, 1, 0) : 0;
  });

  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;

  let sumSquares = 0;
  let peakBefore = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - mean;
    samples[index] = centered;
    sumSquares += centered * centered;
    peakBefore = Math.max(peakBefore, Math.abs(centered));
  }

  const rmsBefore = Math.sqrt(sumSquares / samples.length);
  const rmsGain = rmsBefore > 1e-7 ? targetRms / rmsBefore : 1;
  const peakGain = peakBefore > 1e-7 ? peakCeiling / peakBefore : 1;
  const gain = clamp(Math.min(rmsGain, peakGain), 0, maxGain, 1);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = clamp(samples[index] * gain, -peakCeiling, peakCeiling, 0);
  }

  const requestedFade = Math.round(clamp(fadeSeconds, 0, 0.1, 0.012) * rate);
  const fadeFrames = Math.min(requestedFade, Math.floor(samples.length / 8));
  for (let index = 0; index < fadeFrames; index += 1) {
    const phase = (index + 1) / (fadeFrames + 1);
    const edgeGain = Math.sin(phase * Math.PI * 0.5) ** 2;
    samples[index] *= edgeGain;
    samples[samples.length - 1 - index] *= edgeGain;
  }

  let finalSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    finalSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  return Object.freeze({
    samples,
    sampleRate: rate,
    duration: samples.length / rate,
    metrics: Object.freeze({
      removedDc: mean,
      gain,
      rmsBefore,
      rms: Math.sqrt(finalSquares / samples.length),
      peak,
      fadeFrames,
    }),
  });
}

export function engineById(id) {
  return ENGINE_DEFINITIONS.find((engine) => engine.id === id) ?? null;
}

export function playbackStatsSnapshot(context) {
  let stats = null;
  try {
    stats = context?.playbackStats;
  } catch {
    stats = null;
  }
  return Object.freeze({
    supported: Boolean(stats),
    underrunEvents: Math.max(0, Number(stats?.underrunEvents) || 0),
    underrunDuration: Math.max(0, Number(stats?.underrunDuration) || 0),
    latency: Math.max(
      0,
      Number(stats?.averageLatency)
        || Number(stats?.latency)
        || Number(context?.outputLatency)
        || Number(context?.baseLatency)
        || 0,
    ),
  });
}

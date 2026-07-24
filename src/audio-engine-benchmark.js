import {
  clamp,
  durationFactorToPlaybackRate,
  engineById,
  tapePitchForDuration,
} from "./audio-engine-lab.js";

export const OFFLINE_BENCHMARK_RUNS = Object.freeze({
  warmup: 1,
  measured: 3,
});

export const DEFAULT_OFFLINE_RENDER_SECONDS = 1.5;

let signalsmithModulePromise = null;
let soundTouchModulePromise = null;
let phaseVocoderModulePromise = null;
let elementaryModulePromise = null;
let toneModulePromise = null;
let resourceId = 0;

const now = () => globalThis.performance?.now?.() ?? Date.now();

function loadSignalsmith() {
  signalsmithModulePromise ??= import(
    "../vendor/signalsmith-stretch/SignalsmithStretch.mjs"
  ).then((module) => module.default);
  return signalsmithModulePromise;
}

function loadSoundTouch() {
  soundTouchModulePromise ??= import(
    "../vendor/soundtouchjs/SoundTouchNode.js"
  );
  return soundTouchModulePromise;
}

function loadPhaseVocoder() {
  phaseVocoderModulePromise ??= import(
    "../vendor/soundtouchjs-phase-vocoder/PhaseVocoderNode.js"
  );
  return phaseVocoderModulePromise;
}

function loadElementary() {
  elementaryModulePromise ??= import(
    "../vendor/elementary-audio/elementary-audio.js"
  );
  return elementaryModulePromise;
}

async function loadTone() {
  if (!toneModulePromise) {
    globalThis.TONE_SILENCE_LOGGING = true;
    toneModulePromise = import("../vendor/tone/Tone.js").then(() => {
      if (!globalThis.Tone?.GrainPlayer || !globalThis.Tone?.OfflineContext) {
        throw new Error("Tone.js offline rendering did not initialize.");
      }
      return globalThis.Tone;
    });
  }
  return toneModulePromise;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
  throw signal.reason ?? new DOMException("Benchmark cancelled.", "AbortError");
}

function createOfflineContext(sampleRate, renderSeconds) {
  const Context = globalThis.OfflineAudioContext
    ?? globalThis.webkitOfflineAudioContext;
  if (!Context) {
    throw new Error("This browser does not provide OfflineAudioContext.");
  }

  const length = Math.max(128, Math.ceil(sampleRate * renderSeconds));
  try {
    return new Context({
      numberOfChannels: 1,
      length,
      sampleRate,
    });
  } catch {
    return new Context(1, length, sampleRate);
  }
}

function makeAudioBuffer(context, samples) {
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

function sourceFor(context, samples, playbackRate = 1) {
  const source = context.createBufferSource();
  source.buffer = makeAudioBuffer(context, samples);
  source.loop = true;
  source.playbackRate.value = playbackRate;
  return source;
}

function stopSource(source) {
  try {
    source?.stop();
  } catch {
    // Offline rendering may already have ended the source.
  }
}

function closeNode(node) {
  try {
    node?.disconnect();
    node?.port?.close();
  } catch {
    // The offline context may already have released the node.
  }
}

function renderedBufferMetrics(buffer) {
  if (!buffer || typeof buffer.getChannelData !== "function") {
    throw new Error("The offline renderer did not return an audio buffer.");
  }

  const channelCount = Math.max(1, Number(buffer.numberOfChannels) || 1);
  let sampleCount = 0;
  let sumSquares = 0;
  let peak = 0;
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    sampleCount += channel.length;
    for (const sample of channel) {
      const value = Number.isFinite(sample) ? sample : 0;
      sumSquares += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
  }

  return {
    rms: sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0,
    peak,
    renderedFrames: Math.round(sampleCount / channelCount),
  };
}

function inputRms(samples) {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  return Math.sqrt(sumSquares / samples.length);
}

function median(values) {
  if (!values.length) throw new TypeError("A median needs at least one value.");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeOfflineMeasurements(measurements, renderSeconds) {
  if (!Array.isArray(measurements) || !measurements.length) {
    throw new TypeError("Offline measurements cannot be empty.");
  }
  const seconds = Number(renderSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new TypeError("Render duration must be a positive number.");
  }

  const setupMs = median(measurements.map((measurement) => measurement.setupMs));
  const renderMs = median(measurements.map((measurement) => measurement.renderMs));
  const rms = median(measurements.map((measurement) => measurement.rms));
  const peak = median(measurements.map((measurement) => measurement.peak));
  const rtf = renderMs / (seconds * 1_000);

  return Object.freeze({
    setupMs,
    renderMs,
    rtf,
    offlineBudgetPercent: rtf * 100,
    speed: rtf > 0 ? 1 / rtf : Number.POSITIVE_INFINITY,
    rms,
    peak,
  });
}

export function createOfflineBenchmarkModes(pitch, stretch) {
  const safePitch = clamp(pitch, -24, 24, 0);
  const safeStretch = clamp(stretch, 0.25, 4, 1);
  return Object.freeze([
    Object.freeze({
      key: "pitchOnly",
      id: "pitch-only",
      label: "Pitch only",
      pitch: safePitch,
      stretch: 1,
    }),
    Object.freeze({
      key: "timeOnly",
      id: "time-only",
      label: "Time only",
      pitch: 0,
      stretch: safeStretch,
    }),
    Object.freeze({
      key: "combined",
      id: "combined",
      label: "Pitch + time",
      pitch: safePitch,
      stretch: safeStretch,
    }),
  ]);
}

function effectiveSettings(engineId, requested) {
  if (engineId === "raw") {
    return Object.freeze({ pitch: 0, stretch: 1, coupled: false });
  }
  if (engineId === "native-tape") {
    return Object.freeze({
      pitch: tapePitchForDuration(requested.stretch),
      stretch: requested.stretch,
      coupled: true,
    });
  }
  return Object.freeze({
    pitch: requested.pitch,
    stretch: requested.stretch,
    coupled: false,
  });
}

async function buildRaw(context, samples, settings, tape = false) {
  const rate = tape ? durationFactorToPlaybackRate(settings.stretch) : 1;
  const source = sourceFor(context, samples, rate);
  source.connect(context.destination);
  source.start(0);
  return {
    render: () => context.startRendering(),
    cleanup: () => stopSource(source),
    algorithmLatencySeconds: 0,
  };
}

async function buildSignalsmith(context, samples, settings, economy) {
  const SignalsmithStretch = await loadSignalsmith();
  const node = await SignalsmithStretch(context, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  if (economy) {
    await node.configure({ blockMs: 0, preset: "cheaper" });
  } else {
    await node.configure({
      blockMs: 160,
      intervalMs: 30,
      splitComputation: true,
    });
  }
  await node.addBuffers([Float32Array.from(samples)]);
  const algorithmLatencySeconds = Math.max(0, Number(await node.latency()) || 0);
  await node.schedule({
    active: true,
    input: 0,
    output: algorithmLatencySeconds,
    rate: durationFactorToPlaybackRate(settings.stretch),
    semitones: settings.pitch,
    tonalityHz: 8_000,
    formantSemitones: 0,
    formantCompensation: false,
    formantBaseHz: 0,
    loopStart: 0,
    loopEnd: samples.length / context.sampleRate,
  });
  node.connect(context.destination);

  return {
    render: () => context.startRendering(),
    cleanup: () => closeNode(node),
    algorithmLatencySeconds,
  };
}

async function buildSoundTouch(context, samples, settings, phaseVocoder) {
  const NodeClass = phaseVocoder
    ? (await loadPhaseVocoder()).PhaseVocoderNode
    : (await loadSoundTouch()).SoundTouchNode;
  const processorUrl = phaseVocoder
    ? new URL(
      "../vendor/soundtouchjs-phase-vocoder/phase-vocoder-processor.js",
      import.meta.url,
    )
    : new URL(
      "../vendor/soundtouchjs/soundtouch-processor.js",
      import.meta.url,
    );
  await NodeClass.register(context, processorUrl);
  const node = new NodeClass({
    context,
    outputChannelCount: 1,
    ...(phaseVocoder ? { fftSize: 2_048, overlapFactor: 4 } : {}),
  });

  const rate = durationFactorToPlaybackRate(settings.stretch);
  const source = sourceFor(context, samples, rate);
  source.connect(node);
  node.connect(context.destination);
  node.pitch.value = 1;
  node.playbackRate.value = rate;
  node.pitchSemitones.value = settings.pitch;
  source.start(0);

  return {
    render: () => context.startRendering(),
    cleanup: () => {
      stopSource(source);
      closeNode(node);
    },
    algorithmLatencySeconds: phaseVocoder ? 2_048 / context.sampleRate : 0,
  };
}

async function buildHybrid(context, samples, settings) {
  const [{ SoundTouchNode }, SignalsmithStretch] = await Promise.all([
    loadSoundTouch(),
    loadSignalsmith(),
  ]);
  await SoundTouchNode.register(
    context,
    new URL(
      "../vendor/soundtouchjs/soundtouch-processor.js",
      import.meta.url,
    ),
  );

  const timeNode = new SoundTouchNode({
    context,
    outputChannelCount: 1,
  });
  const pitchNode = await SignalsmithStretch(context, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  await pitchNode.configure({
    blockMs: 160,
    intervalMs: 30,
    splitComputation: true,
  });
  const algorithmLatencySeconds = Math.max(
    0,
    Number(await pitchNode.latency()) || 0,
  );
  await pitchNode.schedule({
    active: true,
    output: algorithmLatencySeconds,
    rate: 1,
    semitones: settings.pitch,
    tonalityHz: 8_000,
    formantSemitones: 0,
    formantCompensation: true,
    formantBaseHz: 0,
    loopStart: 0,
    loopEnd: 0,
  });

  const rate = durationFactorToPlaybackRate(settings.stretch);
  const source = sourceFor(context, samples, rate);
  source.connect(timeNode);
  timeNode.connect(pitchNode);
  pitchNode.connect(context.destination);
  timeNode.pitch.value = 1;
  timeNode.pitchSemitones.value = 0;
  timeNode.playbackRate.value = rate;
  source.start(0);

  return {
    render: () => context.startRendering(),
    cleanup: () => {
      stopSource(source);
      closeNode(timeNode);
      closeNode(pitchNode);
    },
    algorithmLatencySeconds,
  };
}

async function buildTone(context, samples, settings) {
  const Tone = await loadTone();
  const toneContext = new Tone.OfflineContext(context);
  const duration = samples.length / context.sampleRate;
  const player = new Tone.GrainPlayer({
    context: toneContext,
    url: makeAudioBuffer(context, samples),
    loop: true,
    loopStart: 0,
    loopEnd: duration,
    grainSize: 0.16,
    overlap: 0.08,
    playbackRate: durationFactorToPlaybackRate(settings.stretch),
    detune: settings.pitch * 100,
  });
  player.connect(toneContext.destination);
  player.start(0);

  return {
    // Tone's artificial offline clock schedules every grain before Web Audio
    // renders. Calling the raw context directly produces a silent buffer.
    render: () => toneContext.render(false),
    cleanup: () => {
      try {
        player.stop();
        player.disconnect();
        player.dispose();
      } catch {
        // Tone may already have released its scheduled grains.
      }
    },
    algorithmLatencySeconds: 0,
  };
}

async function buildElementary(context, samples, settings) {
  const { WebRenderer, el } = await loadElementary();
  const renderer = new WebRenderer();
  const id = ++resourceId;
  const path = `morphazoid://offline-benchmark-${id}`;
  const node = await renderer.initialize(context, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      virtualFileSystem: {
        [path]: Float32Array.from(samples),
      },
    },
  });
  node.connect(context.destination);

  const duration = samples.length / context.sampleRate;
  const stretch = clamp(settings.stretch, 0.25, 4, 1);
  const cycleDuration = duration * stretch;
  const time = el.mul(
    cycleDuration,
    el.phasor(el.const({
      key: `offline-benchmark-rate-${id}`,
      value: 1 / cycleDuration,
    })),
  );
  const loop = el.sampleseq2({
    key: `offline-benchmark-sample-${id}`,
    path,
    seq: [{ time: 0, value: 1 }],
    duration,
    stretch,
    shift: settings.pitch,
  }, time);
  await renderer.render(el.mul(0.9, loop));

  return {
    render: () => context.startRendering(),
    cleanup: () => closeNode(node),
    algorithmLatencySeconds: 0,
  };
}

function buildEngineGraph(engineId, context, samples, settings) {
  if (engineId === "raw") {
    return buildRaw(context, samples, settings, false);
  }
  if (engineId === "native-tape") {
    return buildRaw(context, samples, settings, true);
  }
  if (engineId === "signalsmith-silky") {
    return buildSignalsmith(context, samples, settings, false);
  }
  if (engineId === "signalsmith-economy") {
    return buildSignalsmith(context, samples, settings, true);
  }
  if (engineId === "soundtouch") {
    return buildSoundTouch(context, samples, settings, false);
  }
  if (engineId === "soundtouch-phase-vocoder") {
    return buildSoundTouch(context, samples, settings, true);
  }
  if (engineId === "hybrid-soundtouch-signalsmith") {
    return buildHybrid(context, samples, settings);
  }
  if (engineId === "tone-grain") {
    return buildTone(context, samples, settings);
  }
  if (engineId === "elementary") {
    return buildElementary(context, samples, settings);
  }
  throw new Error(`No offline benchmark graph exists for ${engineId}.`);
}

async function runOfflineMeasurement({
  engineId,
  samples,
  sampleRate,
  settings,
  renderSeconds,
  minimumOutputRms,
  signal,
}) {
  throwIfAborted(signal);
  const setupStartedAt = now();
  const context = createOfflineContext(sampleRate, renderSeconds);
  const graph = await buildEngineGraph(engineId, context, samples, settings);
  const setupMs = Math.max(0, now() - setupStartedAt);

  try {
    throwIfAborted(signal);
    const renderStartedAt = now();
    const renderedBuffer = await graph.render();
    throwIfAborted(signal);
    const renderMs = Math.max(0, now() - renderStartedAt);
    const metrics = renderedBufferMetrics(renderedBuffer);
    if (!(metrics.rms >= minimumOutputRms)) {
      throw new Error(
        `${engineId} rendered silence (RMS ${metrics.rms.toExponential(2)}; `
        + `minimum ${minimumOutputRms.toExponential(2)}).`,
      );
    }
    return Object.freeze({
      setupMs,
      renderMs,
      rms: metrics.rms,
      peak: metrics.peak,
      renderedFrames: metrics.renderedFrames,
      algorithmLatencyMs: graph.algorithmLatencySeconds * 1_000,
    });
  } finally {
    graph.cleanup?.();
  }
}

/**
 * Benchmarks one lab engine with the same loop in three configurations:
 * pitch-only, time-only, and both transforms together.
 *
 * Each configuration gets one discarded warm-up render followed by three
 * measured renders. The returned "offlineBudgetPercent" is wall-time RTF,
 * not whole-device CPU usage and not live AudioContext deadline load.
 */
export async function benchmarkOfflineEngine(
  engineId,
  loop,
  {
    pitch = 0,
    stretch = 1,
    renderSeconds = DEFAULT_OFFLINE_RENDER_SECONDS,
    minimumOutputRms,
    signal,
    onProgress,
  } = {},
) {
  const definition = engineById(engineId);
  if (!definition) throw new Error(`Unknown audio engine: ${engineId}`);
  if (!loop?.samples || typeof loop.samples.length !== "number") {
    throw new TypeError("An offline benchmark needs a microphone loop.");
  }
  if (loop.samples.length < 2) {
    throw new TypeError("An offline benchmark loop needs at least two samples.");
  }

  const sampleRate = Number(loop.sampleRate);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError("The microphone loop has an invalid sample rate.");
  }
  const seconds = clamp(renderSeconds, 0.25, 10, DEFAULT_OFFLINE_RENDER_SECONDS);
  const samples = Float32Array.from(loop.samples, (sample) => (
    Number.isFinite(sample) ? clamp(sample, -1, 1, 0) : 0
  ));
  const sourceRms = inputRms(samples);
  if (!(sourceRms > 0)) {
    throw new Error("The microphone loop is silent.");
  }
  const silenceFloor = Number.isFinite(Number(minimumOutputRms))
    ? Math.max(Number.EPSILON, Number(minimumOutputRms))
    : Math.max(1e-7, sourceRms * 1e-4);
  const modes = createOfflineBenchmarkModes(pitch, stretch);
  const modeResults = {};
  const completedSettings = new Map();

  for (const mode of modes) {
    throwIfAborted(signal);
    const requestedSettings = Object.freeze({
      pitch: mode.pitch,
      stretch: mode.stretch,
    });
    const resolvedSettings = effectiveSettings(engineId, requestedSettings);
    const settingsSignature = [
      resolvedSettings.pitch,
      resolvedSettings.stretch,
      resolvedSettings.coupled ? 1 : 0,
    ].join(":");
    const reusable = completedSettings.get(settingsSignature);
    if (reusable) {
      modeResults[mode.key] = Object.freeze({
        ...reusable,
        id: mode.id,
        label: mode.label,
        requestedSettings,
        effectiveSettings: resolvedSettings,
        reusedFrom: reusable.id,
      });
      continue;
    }
    onProgress?.({
      engineId,
      mode: mode.id,
      phase: "warmup",
      run: 1,
      total: OFFLINE_BENCHMARK_RUNS.warmup,
    });
    const warmup = await runOfflineMeasurement({
      engineId,
      samples,
      sampleRate,
      settings: requestedSettings,
      renderSeconds: seconds,
      minimumOutputRms: silenceFloor,
      signal,
    });

    const measurements = [];
    for (let run = 0; run < OFFLINE_BENCHMARK_RUNS.measured; run += 1) {
      throwIfAborted(signal);
      onProgress?.({
        engineId,
        mode: mode.id,
        phase: "measured",
        run: run + 1,
        total: OFFLINE_BENCHMARK_RUNS.measured,
      });
      measurements.push(await runOfflineMeasurement({
        engineId,
        samples,
        sampleRate,
        settings: requestedSettings,
        renderSeconds: seconds,
        minimumOutputRms: silenceFloor,
        signal,
      }));
    }

    throwIfAborted(signal);
    const summary = summarizeOfflineMeasurements(measurements, seconds);
    const modeResult = Object.freeze({
      id: mode.id,
      label: mode.label,
      requestedSettings,
      effectiveSettings: resolvedSettings,
      warmup,
      measurements: Object.freeze(measurements),
      ...summary,
      algorithmLatencyMs: median(
        measurements.map((measurement) => measurement.algorithmLatencyMs),
      ),
    });
    modeResults[mode.key] = modeResult;
    completedSettings.set(settingsSignature, modeResult);
  }

  throwIfAborted(signal);
  return Object.freeze({
    engineId,
    engineName: definition.name,
    sampleRate,
    renderSeconds: seconds,
    inputRms: sourceRms,
    minimumOutputRms: silenceFloor,
    runs: OFFLINE_BENCHMARK_RUNS,
    modes: Object.freeze(modeResults),
  });
}

import SignalsmithStretch from "../vendor/signalsmith-stretch/SignalsmithStretch.mjs";
import { SoundTouchNode } from "../vendor/soundtouchjs/SoundTouchNode.js";
import { PhaseVocoderNode } from "../vendor/soundtouchjs-phase-vocoder/PhaseVocoderNode.js";
import {
  WebRenderer,
  el,
} from "../vendor/elementary-audio/elementary-audio.js";
import {
  DEFAULT_ENGINE_SETTINGS,
  durationFactorToPlaybackRate,
  engineById,
} from "./audio-engine-lab.js";

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

let toneModulePromise = null;

async function loadTone() {
  if (!toneModulePromise) {
    globalThis.TONE_SILENCE_LOGGING = true;
    toneModulePromise = import("../vendor/tone/Tone.js").then(() => {
      if (!globalThis.Tone?.GrainPlayer) {
        throw new Error("Tone.js GrainPlayer did not initialize.");
      }
      return globalThis.Tone;
    });
  }
  return toneModulePromise;
}

function createAudioContext(sampleRate) {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  try {
    return new Context({ latencyHint: "interactive", sampleRate });
  } catch {
    return new Context({ latencyHint: "interactive" });
  }
}

function resample(samples, sourceRate, destinationRate) {
  if (Math.abs(sourceRate - destinationRate) < 1) return Float32Array.from(samples);
  const outputLength = Math.max(2, Math.round(samples.length * destinationRate / sourceRate));
  const output = new Float32Array(outputLength);
  const scale = (samples.length - 1) / (outputLength - 1);
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * scale;
    const low = Math.floor(position);
    const high = Math.min(samples.length - 1, low + 1);
    const fraction = position - low;
    output[index] = samples[low] * (1 - fraction) + samples[high] * fraction;
  }
  return output;
}

function makeAudioBuffer(context, samples) {
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}

class EngineAdapter {
  constructor(engineId, loop, { level = 0.72 } = {}) {
    this.definition = engineById(engineId);
    if (!this.definition) throw new Error(`Unknown audio engine: ${engineId}`);
    this.context = createAudioContext(loop.sampleRate);
    this.samples = resample(loop.samples, loop.sampleRate, this.context.sampleRate);
    this.duration = this.samples.length / this.context.sampleRate;
    this.settings = { ...DEFAULT_ENGINE_SETTINGS };
    this.outputLevel = level;
    this.output = this.context.createGain();
    this.output.gain.value = 0;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.72;
    this.analyser.connect(this.output);
    this.output.connect(this.context.destination);
    this.initialized = false;
    this.disposed = false;
    this.algorithmLatency = null;
    this.startedAt = performance.now();
  }

  async finishInitialization() {
    if (this.context.state === "running") await this.context.suspend();
    this.initialized = true;
    return this;
  }

  async resume() {
    if (this.disposed) throw new Error(`${this.definition.name} has been closed.`);
    await this.context.resume();
    const now = this.context.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(this.outputLevel, now + 0.025);
  }

  async suspend({ immediate = false } = {}) {
    if (this.disposed || this.context.state !== "running") return;
    const now = this.context.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(this.output.gain.value, now);
    this.output.gain.linearRampToValueAtTime(0, now + (immediate ? 0.003 : 0.025));
    if (!immediate) await wait(35);
    if (this.context.state === "running") await this.context.suspend();
  }

  setOutputLevel(level) {
    this.outputLevel = Math.max(0, Math.min(1, Number(level) || 0));
    if (this.context.state !== "running") return;
    this.output.gain.setTargetAtTime(this.outputLevel, this.context.currentTime, 0.012);
  }

  async update(settings = {}) {
    Object.assign(this.settings, settings);
  }

  getEngineMetrics() {
    return null;
  }

  resetEngineMetrics() {}

  getAlgorithmLatency() {
    if (this.algorithmLatency === null || this.algorithmLatency === undefined) return null;
    const latency = Number(this.algorithmLatency);
    return Number.isFinite(latency) ? Math.max(0, latency) : null;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      await this.context.close();
    } catch {
      // Context may already be closed by the browser.
    }
  }
}

class RawLoopAdapter extends EngineAdapter {
  async initialize() {
    this.algorithmLatency = 0;
    const source = this.context.createBufferSource();
    source.buffer = makeAudioBuffer(this.context, this.samples);
    source.loop = true;
    source.connect(this.analyser);
    source.start();
    this.source = source;
    return this.finishInitialization();
  }

  async dispose() {
    try {
      this.source?.stop();
    } catch {
      // A stopped source cannot be stopped again.
    }
    await super.dispose();
  }
}

class NativeTapeAdapter extends RawLoopAdapter {
  async update(settings = {}) {
    await super.update(settings);
    const rate = durationFactorToPlaybackRate(this.settings.stretch);
    this.source.playbackRate.setTargetAtTime(rate, this.context.currentTime, 0.018);
  }
}

class SignalsmithAdapter extends EngineAdapter {
  constructor(engineId, loop, options) {
    super(engineId, loop, options);
    this.economy = engineId === "signalsmith-economy";
  }

  async initialize() {
    this.node = await SignalsmithStretch(this.context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    if (this.economy) {
      await this.node.configure({ blockMs: 0, preset: "cheaper" });
    } else {
      await this.node.configure({
        blockMs: 160,
        intervalMs: 30,
        splitComputation: true,
      });
    }
    await this.node.addBuffers([Float32Array.from(this.samples)]);
    this.algorithmLatency = Math.max(0, Number(await this.node.latency()) || 0);
    await this.node.schedule({
      active: true,
      input: 0,
      output: this.context.currentTime + this.algorithmLatency,
      rate: 1,
      semitones: 0,
      tonalityHz: 8_000,
      formantSemitones: 0,
      formantCompensation: false,
      formantBaseHz: 0,
      loopStart: 0,
      loopEnd: this.duration,
    });
    this.node.connect(this.analyser);
    return this.finishInitialization();
  }

  async update(settings = {}) {
    await super.update(settings);
    await this.node.schedule({
      active: true,
      output: this.context.currentTime + this.algorithmLatency,
      rate: durationFactorToPlaybackRate(this.settings.stretch),
      semitones: this.settings.pitch,
      tonalityHz: 8_000,
      formantSemitones: 0,
      formantCompensation: false,
      formantBaseHz: 0,
      loopStart: 0,
      loopEnd: this.duration,
    });
  }

  async dispose() {
    try {
      this.node?.disconnect();
      this.node?.port?.close();
    } catch {
      // Node may already have been collected with its context.
    }
    await super.dispose();
  }
}

class HybridSoundTouchSignalsmithAdapter extends EngineAdapter {
  async initialize() {
    await SoundTouchNode.register(
      this.context,
      new URL("../vendor/soundtouchjs/soundtouch-processor.js", import.meta.url),
    );
    this.timeNode = new SoundTouchNode({
      context: this.context,
      outputChannelCount: 1,
    });
    this.pitchNode = await SignalsmithStretch(this.context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    await this.pitchNode.configure({
      blockMs: 160,
      intervalMs: 30,
      splitComputation: true,
    });
    this.algorithmLatency = Math.max(0, Number(await this.pitchNode.latency()) || 0);
    await this.pitchNode.schedule({
      active: true,
      output: this.context.currentTime + this.algorithmLatency,
      rate: 1,
      semitones: 0,
      tonalityHz: 8_000,
      formantSemitones: 0,
      formantCompensation: true,
      formantBaseHz: 0,
      loopStart: 0,
      loopEnd: 0,
    });

    this.source = this.context.createBufferSource();
    this.source.buffer = makeAudioBuffer(this.context, this.samples);
    this.source.loop = true;
    this.source.connect(this.timeNode);
    this.timeNode.connect(this.pitchNode);
    this.pitchNode.connect(this.analyser);
    this.source.start();
    return this.finishInitialization();
  }

  async update(settings = {}) {
    await super.update(settings);
    const now = this.context.currentTime;
    const rate = durationFactorToPlaybackRate(this.settings.stretch);
    this.source.playbackRate.setTargetAtTime(rate, now, 0.018);
    this.timeNode.playbackRate.setTargetAtTime(rate, now, 0.018);
    this.timeNode.pitchSemitones.setTargetAtTime(0, now, 0.018);
    await this.pitchNode.schedule({
      active: true,
      output: now + this.algorithmLatency,
      rate: 1,
      semitones: this.settings.pitch,
      tonalityHz: 8_000,
      formantSemitones: 0,
      formantCompensation: true,
      formantBaseHz: 0,
      loopStart: 0,
      loopEnd: 0,
    });
  }

  getEngineMetrics() {
    const timeMetrics = this.timeNode?.metrics;
    if (!timeMetrics) {
      return {
        framesBuffered: 0,
        underrunCount: 0,
        blockCount: 0,
        pending: true,
      };
    }
    return {
      framesBuffered: Number(timeMetrics?.framesBuffered) || 0,
      underrunCount: Number(timeMetrics?.underrunCount) || 0,
      blockCount: Number(timeMetrics?.blockCount) || 0,
    };
  }

  resetEngineMetrics() {
    this.timeNode?.resetMetrics?.();
  }

  async dispose() {
    try {
      this.source?.stop();
      this.timeNode?.disconnect();
      this.timeNode?.port?.close();
      this.pitchNode?.disconnect();
      this.pitchNode?.port?.close();
    } catch {
      // Nodes may already have been collected with their context.
    }
    await super.dispose();
  }
}

class SoundTouchAdapter extends EngineAdapter {
  constructor(engineId, loop, options) {
    super(engineId, loop, options);
    this.phaseVocoder = engineId === "soundtouch-phase-vocoder";
  }

  async initialize() {
    const NodeClass = this.phaseVocoder ? PhaseVocoderNode : SoundTouchNode;
    const processorUrl = this.phaseVocoder
      ? new URL(
        "../vendor/soundtouchjs-phase-vocoder/phase-vocoder-processor.js",
        import.meta.url,
      )
      : new URL("../vendor/soundtouchjs/soundtouch-processor.js", import.meta.url);
    await NodeClass.register(
      this.context,
      processorUrl,
    );
    this.node = new NodeClass({
      context: this.context,
      outputChannelCount: 1,
      ...(this.phaseVocoder ? { fftSize: 2_048, overlapFactor: 4 } : {}),
    });
    this.node.connect(this.analyser);

    this.source = this.context.createBufferSource();
    this.source.buffer = makeAudioBuffer(this.context, this.samples);
    this.source.loop = true;
    this.source.connect(this.node);
    this.source.start();
    if (this.phaseVocoder) {
      this.algorithmLatency = 2_048 / this.context.sampleRate;
      this.node.pitch.value = 1;
      // Fill one FFT window silently so the first audition starts with audio
      // instead of an avoidable phase-vocoder underrun.
      await wait(Math.ceil(this.algorithmLatency * 1_000) + 12);
    }
    return this.finishInitialization();
  }

  async update(settings = {}) {
    await super.update(settings);
    const now = this.context.currentTime;
    const rate = durationFactorToPlaybackRate(this.settings.stretch);
    this.source.playbackRate.setTargetAtTime(rate, now, 0.018);
    this.node.playbackRate.setTargetAtTime(rate, now, 0.018);
    if (this.phaseVocoder) this.node.pitch.setTargetAtTime(1, now, 0.018);
    this.node.pitchSemitones.setTargetAtTime(this.settings.pitch, now, 0.018);
  }

  getEngineMetrics() {
    const metrics = this.node?.metrics;
    if (!metrics) {
      return {
        framesBuffered: 0,
        underrunCount: 0,
        blockCount: 0,
        pending: true,
      };
    }
    return {
      framesBuffered: Number(metrics.framesBuffered) || 0,
      underrunCount: Number(metrics.underrunCount) || 0,
      blockCount: Number(metrics.blockCount) || 0,
    };
  }

  resetEngineMetrics() {
    this.node?.resetMetrics?.();
  }

  async dispose() {
    try {
      this.source?.stop();
      this.node?.disconnect();
      this.node?.port?.close();
    } catch {
      // Nodes may already have been collected with their context.
    }
    await super.dispose();
  }
}

class ToneGrainAdapter extends EngineAdapter {
  async initialize() {
    this.Tone = await loadTone();
    this.Tone.setContext(this.context);
    this.player = new this.Tone.GrainPlayer({
      context: this.Tone.getContext(),
      url: makeAudioBuffer(this.context, this.samples),
      loop: true,
      loopStart: 0,
      loopEnd: this.duration,
      grainSize: 0.16,
      overlap: 0.08,
      playbackRate: 1,
      detune: 0,
    });
    this.player.connect(this.analyser);
    this.player.start(this.context.currentTime);
    return this.finishInitialization();
  }

  async update(settings = {}) {
    await super.update(settings);
    this.player.playbackRate = durationFactorToPlaybackRate(this.settings.stretch);
    this.player.detune = this.settings.pitch * 100;
  }

  async dispose() {
    try {
      this.player?.stop();
      this.player?.disconnect();
      this.player?.dispose();
    } catch {
      // Tone may already have released its scheduled grain sources.
    }
    await super.dispose();
  }
}

class ElementaryAdapter extends EngineAdapter {
  async initialize() {
    this.renderer = new WebRenderer();
    this.path = "morphazoid://mic-loop";
    this.node = await this.renderer.initialize(this.context, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        virtualFileSystem: {
          [this.path]: Float32Array.from(this.samples),
        },
      },
    });
    this.node.connect(this.analyser);
    this.renderQueue = Promise.resolve();
    await this.renderSettings();
    return this.finishInitialization();
  }

  renderSettings() {
    const stretch = Math.max(0.25, Math.min(4, this.settings.stretch));
    const cycleDuration = this.duration * stretch;
    const time = el.mul(
      cycleDuration,
      el.phasor(el.const({
        key: "audio-lab-elementary-loop-rate",
        value: 1 / cycleDuration,
      })),
    );
    const loop = el.sampleseq2({
      key: "audio-lab-elementary-sample",
      path: this.path,
      seq: [{ time: 0, value: 1 }],
      duration: this.duration,
      stretch,
      shift: this.settings.pitch,
    }, time);
    return this.renderer.render(el.mul(0.9, loop));
  }

  async update(settings = {}) {
    await super.update(settings);
    this.renderQueue = this.renderQueue
      .catch(() => {})
      .then(() => this.renderSettings());
    await this.renderQueue;
  }

  async dispose() {
    try {
      await this.renderer?.reset();
      this.node?.disconnect();
      this.node?.port?.close();
    } catch {
      // Runtime may already have gone away with its context.
    }
    await super.dispose();
  }
}

export async function createEngineAdapter(engineId, loop, options = {}) {
  let adapter;
  if (engineId === "raw") {
    adapter = new RawLoopAdapter(engineId, loop, options);
  } else if (engineId === "native-tape") {
    adapter = new NativeTapeAdapter(engineId, loop, options);
  } else if (engineId === "signalsmith-silky" || engineId === "signalsmith-economy") {
    adapter = new SignalsmithAdapter(engineId, loop, options);
  } else if (engineId === "hybrid-soundtouch-signalsmith") {
    adapter = new HybridSoundTouchSignalsmithAdapter(engineId, loop, options);
  } else if (engineId === "soundtouch" || engineId === "soundtouch-phase-vocoder") {
    adapter = new SoundTouchAdapter(engineId, loop, options);
  } else if (engineId === "tone-grain") {
    adapter = new ToneGrainAdapter(engineId, loop, options);
  } else if (engineId === "elementary") {
    adapter = new ElementaryAdapter(engineId, loop, options);
  } else {
    throw new Error(`Unknown audio engine: ${engineId}`);
  }
  try {
    return await adapter.initialize();
  } catch (error) {
    await adapter.dispose();
    throw error;
  }
}

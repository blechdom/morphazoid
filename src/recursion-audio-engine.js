import {
  convolutionImpulseGenerations,
  generateImpulseSeed,
  generateNoiseSeed,
  normalizeChannels,
  ouroborosGenerations,
} from "./recursion-buffer-dsp.js";
import {
  LIVE_DEFAULTS,
  ancestorGain,
  fuzzyDspFor,
  normalizeLiveAxes,
  sessionToneFor,
  voiceMixFor,
} from "./recursion-live.js";
import { MOTION_CAPS } from "./recursion-motion.js";
import { spectralMobiusGenerations } from "./recursion-spectral-dsp.js";

const MIN_GAIN = 0.0001;
const MAX_SEED_SECONDS = 4;
const MAX_GRAPH_SOURCES = 1_024;
const LIVE_MIN_PLAYBACK_RATE = 0.25;
const LIVE_MAX_PLAYBACK_RATE = 4;
const CONTEXT_GUARD_KEY = "__morphazoidRecursiveAudioContext";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function setParam(param, method, value, time, constant) {
  if (typeof param?.[method] === "function") {
    if (constant === undefined) param[method](value, time);
    else param[method](value, time, constant);
  } else if (param) {
    param.value = value;
  }
}

function holdParam(param, time) {
  if (!param) return;
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(time);
    return;
  }
  const value = Number(param.value) || 0;
  setParam(param, "cancelScheduledValues", time, time);
  setParam(param, "setValueAtTime", value, time);
}

function rampEnvelope(param, start, peak, end) {
  const attackEnd = Math.min(end - 0.012, start + 0.018);
  const releaseStart = Math.max(attackEnd, end - Math.min(0.08, (end - start) * 0.18));
  setParam(param, "cancelScheduledValues", start, start);
  setParam(param, "setValueAtTime", MIN_GAIN, start);
  setParam(param, "exponentialRampToValueAtTime", Math.max(MIN_GAIN, peak), attackEnd);
  setParam(param, "setValueAtTime", Math.max(MIN_GAIN, peak * 0.92), releaseStart);
  setParam(param, "exponentialRampToValueAtTime", MIN_GAIN, end);
}

function hashPath(path) {
  const values = Array.isArray(path) ? path : String(path ?? "").split("");
  let hash = 2_166_136_261;
  for (const value of values) {
    hash ^= Number(value) + 31;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function monoFromChannels(channels) {
  const left = channels[0] ?? new Float32Array(0);
  const right = channels[1] ?? left;
  const length = Math.min(left.length, right.length);
  const mono = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    mono[index] = (left[index] + right[index]) * 0.5;
  }
  return mono;
}

function resampleChannel(input, sourceRate, targetRate, maximumSamples) {
  const ratio = sourceRate / targetRate;
  const targetLength = Math.min(
    maximumSamples,
    Math.max(1, Math.floor(input.length / Math.max(Number.EPSILON, ratio))),
  );
  const output = new Float32Array(targetLength);
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(input.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(input.length - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    output[index] = input[leftIndex] + (input[rightIndex] - input[leftIndex]) * fraction;
  }
  return output;
}

function copyAudioBufferChannels(buffer, maximumSeconds = MAX_SEED_SECONDS) {
  const maximumSamples = Math.max(1, Math.floor(buffer.sampleRate * maximumSeconds));
  const channels = [];
  const count = Math.min(2, Math.max(1, buffer.numberOfChannels));
  for (let channel = 0; channel < count; channel += 1) {
    channels.push(buffer.getChannelData(channel).slice(0, maximumSamples));
  }
  if (channels.length === 1) channels.push(channels[0].slice());
  return normalizeChannels(channels, { targetRms: 0.16, peakLimit: 0.86 });
}

export class RecursiveAudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.outputCeiling = null;
    this.sessionBus = null;
    this.sessionTone = null;
    this.sessionDonut = null;
    this.sessionDepthBuses = new Map();
    this.liveVoices = new Set();
    this.liveStudyId = "ouroboros-tape";
    this.liveAxes = normalizeLiveAxes(LIVE_DEFAULTS);
    this.sources = new Set();
    this.externalSeeds = new Map();
    this.generatedSeeds = new Map();
    this.prepared = null;
    this.preparationKey = "";
    this.sourceVersion = 0;
    this.captureState = null;
  }

  async ensure() {
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error("This browser does not provide Web Audio.");

      // During iterative development, an old page instance can leave a live
      // context behind. Close it before creating a fresh graph.
      const previousContext = globalThis[CONTEXT_GUARD_KEY];
      if (previousContext && previousContext.state !== "closed") {
        try { await previousContext.close(); } catch { /* ignore stale context failures */ }
      }

      const context = new AudioContextClass({ latencyHint: "interactive" });
      const master = context.createGain();
      const highpass = context.createBiquadFilter?.();
      const lowpass = context.createBiquadFilter?.();
      const compressor = context.createDynamicsCompressor?.() ?? context.createGain();
      const outputCeiling = context.createGain();
      if (highpass && lowpass) {
        highpass.type = "highpass";
        highpass.frequency.value = 20;
        highpass.Q.value = 0.5;
        lowpass.type = "lowpass";
        lowpass.frequency.value = 18_000;
        lowpass.Q.value = 0.5;
        master.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(compressor);
      } else {
        master.connect(compressor);
      }
      if (compressor.threshold) compressor.threshold.value = -20;
      if (compressor.knee) compressor.knee.value = 12;
      if (compressor.ratio) compressor.ratio.value = 6;
      if (compressor.attack) compressor.attack.value = 0.003;
      if (compressor.release) compressor.release.value = 0.22;
      outputCeiling.gain.value = 0.84;
      compressor.connect(outputCeiling);
      outputCeiling.connect(context.destination);
      this.context = context;
      this.master = master;
      this.outputCeiling = outputCeiling;
      globalThis[CONTEXT_GUARD_KEY] = context;
      this.setLevel(0.42, true);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async suspend() {
    if (!this.context || this.context.state !== "running") return;
    try { await this.context.suspend(); } catch { /* suspend can fail during navigation */ }
  }

  setLevel(level, immediate = false) {
    if (!this.master || !this.context) return;
    const value = clamp(level, 0, 1);
    if (immediate) setParam(this.master.gain, "setValueAtTime", value, this.context.currentTime);
    else setParam(this.master.gain, "setTargetAtTime", value, this.context.currentTime, 0.025);
  }

  setExternalSeed(kind, channels, sampleRate, label) {
    if (!["mic", "file"].includes(kind)) throw new RangeError(`Unknown external seed kind: ${kind}`);
    const normalized = normalizeChannels(channels, { targetRms: 0.16, peakLimit: 0.86 });
    this.externalSeeds.set(kind, {
      channels: normalized,
      sampleRate: Number(sampleRate) || this.context?.sampleRate || 48_000,
      label: String(label || (kind === "mic" ? "microphone capture" : "audio file")),
    });
    this.sourceVersion += 1;
    this.invalidate();
  }

  clearExternalSeed(kind) {
    this.externalSeeds.delete(kind);
    this.sourceVersion += 1;
    this.invalidate();
  }

  hasSeed(kind) {
    return kind === "noise" || kind === "impulse" || this.externalSeeds.has(kind);
  }

  seedLabel(kind) {
    if (kind === "noise") return "pink noise field";
    if (kind === "impulse") return "sparse impulse field";
    return this.externalSeeds.get(kind)?.label ?? (kind === "mic" ? "capture required" : "file required");
  }

  async decodeFile(arrayBuffer, label = "audio file") {
    await this.ensure();
    const decoded = await this.context.decodeAudioData(arrayBuffer.slice(0));
    this.setExternalSeed("file", copyAudioBufferChannels(decoded), decoded.sampleRate, label);
  }

  async captureMicrophone(seconds = 4, onProgress) {
    await this.ensure();
    if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is unavailable in this browser.");
    }
    if (typeof this.context.createMediaStreamSource !== "function" || typeof this.context.createScriptProcessor !== "function") {
      throw new Error("This browser cannot make a finite microphone capture.");
    }
    this.stopCapture();
    const stream = await globalThis.navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: 1,
      },
    });
    const source = this.context.createMediaStreamSource(stream);
    const processor = this.context.createScriptProcessor(2_048, 1, 1);
    const silent = this.context.createGain();
    silent.gain.value = 0;
    const chunks = [];
    const targetSamples = Math.max(1, Math.floor(this.context.sampleRate * clamp(seconds, 1, 8)));
    let capturedSamples = 0;
    let settled = false;

    return new Promise((resolve, reject) => {
      const finish = (error) => {
        if (settled) return;
        settled = true;
        processor.onaudioprocess = null;
        try { source.disconnect(); } catch { /* disconnected */ }
        try { processor.disconnect(); } catch { /* disconnected */ }
        try { silent.disconnect(); } catch { /* disconnected */ }
        for (const track of stream.getTracks()) track.stop();
        this.captureState = null;
        if (error) {
          reject(error);
          return;
        }
        const mono = new Float32Array(Math.min(targetSamples, capturedSamples));
        let writeIndex = 0;
        for (const chunk of chunks) {
          const remaining = mono.length - writeIndex;
          if (remaining <= 0) break;
          mono.set(chunk.subarray(0, remaining), writeIndex);
          writeIndex += Math.min(remaining, chunk.length);
        }
        this.setExternalSeed("mic", [mono, mono.slice()], this.context.sampleRate, `${seconds.toFixed(0)} s microphone capture`);
        onProgress?.(1);
        resolve(this.externalSeeds.get("mic"));
      };

      processor.onaudioprocess = (event) => {
        if (settled) return;
        const input = event.inputBuffer.getChannelData(0);
        const remaining = targetSamples - capturedSamples;
        const chunk = new Float32Array(Math.min(input.length, remaining));
        chunk.set(input.subarray(0, chunk.length));
        chunks.push(chunk);
        capturedSamples += chunk.length;
        onProgress?.(capturedSamples / targetSamples);
        if (capturedSamples >= targetSamples) finish();
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(this.context.destination);
      this.captureState = { finish, stream };
      globalThis.setTimeout?.(() => finish(), Math.ceil(seconds * 1_000 + 400));
    });
  }

  stopCapture() {
    this.captureState?.finish?.(new Error("Microphone capture stopped."));
    this.captureState = null;
  }

  generatedSeed(kind) {
    const key = `${kind}:${this.context.sampleRate}`;
    if (this.generatedSeeds.has(key)) return this.generatedSeeds.get(key);
    const options = {
      sampleRate: this.context.sampleRate,
      duration: 3.4,
      targetRms: 0.15,
      peakLimit: 0.84,
    };
    const channels = kind === "impulse"
      ? generateImpulseSeed({ ...options, seed: 0x1a2b3c4d })
      : generateNoiseSeed({ ...options, seed: 0x51f15e });
    const entry = {
      channels,
      sampleRate: this.context.sampleRate,
      label: kind === "impulse" ? "sparse impulse field" : "pink noise field",
    };
    this.generatedSeeds.set(key, entry);
    return entry;
  }

  seedAtContextRate(sourceKind) {
    const entry = ["noise", "impulse"].includes(sourceKind)
      ? this.generatedSeed(sourceKind)
      : this.externalSeeds.get(sourceKind);
    if (!entry) {
      throw new Error(sourceKind === "mic"
        ? "Capture a short microphone seed first."
        : "Choose a local audio file first.");
    }
    if (entry.sampleRate === this.context.sampleRate) {
      const maximumSamples = Math.floor(this.context.sampleRate * MAX_SEED_SECONDS);
      return {
        ...entry,
        channels: entry.channels.map((channel) => channel.slice(0, maximumSamples)),
      };
    }
    const maximumSamples = Math.floor(this.context.sampleRate * MAX_SEED_SECONDS);
    return {
      ...entry,
      sampleRate: this.context.sampleRate,
      channels: entry.channels.map((channel) => (
        resampleChannel(channel, entry.sampleRate, this.context.sampleRate, maximumSamples)
      )),
    };
  }

  audioBuffer(channels) {
    const length = Math.max(1, channels[0]?.length ?? 0);
    const buffer = this.context.createBuffer(2, length, this.context.sampleRate);
    buffer.getChannelData(0).set(channels[0] ?? new Float32Array(length));
    buffer.getChannelData(1).set(channels[1] ?? channels[0] ?? new Float32Array(length));
    return buffer;
  }

  invalidate() {
    this.prepared = null;
    this.preparationKey = "";
  }

  async prepare(studyId, parameters, sourceKind) {
    await this.ensure();
    const key = [
      studyId,
      sourceKind,
      this.sourceVersion,
      parameters.depth,
      Number(parameters.transform).toFixed(4),
      Number(parameters.intensity).toFixed(4),
    ].join(":");
    if (key === this.preparationKey && this.prepared) return this.prepared;
    const seed = this.seedAtContextRate(sourceKind);
    const prepared = {
      studyId,
      sourceKind,
      parameters: { ...parameters },
      seed,
      seedBuffer: this.audioBuffer(seed.channels),
      generations: null,
      generationBuffers: null,
      motionBufferCache: new Map(),
    };

    if (studyId === "ouroboros-tape") {
      prepared.generations = ouroborosGenerations(seed.channels, {
        depth: parameters.depth,
        transform: parameters.transform,
        intensity: parameters.intensity,
        targetRms: 0.15,
        peakLimit: 0.84,
      });
    } else if (studyId === "spectral-mobius") {
      const mono = monoFromChannels(seed.channels);
      const generations = spectralMobiusGenerations(mono, {
        depth: Math.min(6, parameters.depth),
        fftSize: 1_024,
        hopSize: 256,
        transform: parameters.transform,
        intensity: parameters.intensity,
        targetRms: 0.15,
        peakLimit: 0.84,
        maxInputSamples: Math.floor(this.context.sampleRate * 2.6),
      });
      prepared.generations = generations.map((generation, index) => {
        const right = generation.slice();
        if (index % 2) {
          for (let sample = 1; sample < right.length; sample += 1) {
            right[sample] = right[sample] * 0.92 + right[sample - 1] * 0.08;
          }
        }
        return [generation, right];
      });
    } else if (studyId === "convolution-maw") {
      prepared.generations = convolutionImpulseGenerations(seed.channels, {
        depth: parameters.depth,
        transform: parameters.transform,
        intensity: parameters.intensity,
        maxSamples: Math.floor(this.context.sampleRate * MAX_SEED_SECONDS),
        targetRms: 0.13,
        peakLimit: 0.8,
      });
    }
    if (prepared.generations) {
      prepared.generationBuffers = prepared.generations.map((channels) => this.audioBuffer(channels));
    }
    this.prepared = prepared;
    this.preparationKey = key;
    return prepared;
  }

  beginSession(studyId = this.prepared?.studyId, liveAxes = this.liveAxes) {
    this.stopSession();
    this.liveStudyId = studyId ?? "ouroboros-tape";
    this.liveAxes = normalizeLiveAxes(liveAxes);
    const bus = this.context.createGain();
    bus.gain.value = 1;
    this.sessionBus = bus;
    this.sessionDepthBuses = new Map();
    this.liveVoices = new Set();

    if (this.liveStudyId !== "ouroboros-tape") {
      const tone = this.context.createBiquadFilter?.();
      if (tone) {
        bus.connect(tone);
        tone.connect(this.master);
      } else {
        bus.connect(this.master);
      }
      this.sessionTone = tone ?? null;
      this.sessionDonut = null;
      this.setLiveAxes(this.liveStudyId, this.liveAxes, true);
      return;
    }

    // Fuzzy Donut is one persistent recursive instrument. Scheduled tape
    // heads enter this graph; the six macro axes reshape the graph in place.
    // The DelayNode guarantees that the feedback path can never become a
    // zero-delay algebraic loop.
    const tone = this.context.createBiquadFilter?.() ?? null;
    const rhythm = this.context.createGain();
    const dry = this.context.createGain();
    const delay = this.context.createDelay?.(1) ?? null;
    const twist = this.context.createBiquadFilter?.() ?? null;
    const wet = this.context.createGain();
    const panner = this.context.createStereoPanner?.() ?? null;
    const feedbackFilter = delay
      ? (this.context.createBiquadFilter?.() ?? null)
      : null;
    const feedback = delay ? this.context.createGain() : null;
    const output = this.context.createGain();

    if (tone) tone.type = "lowpass";
    if (twist) twist.type = "allpass";
    if (feedbackFilter) feedbackFilter.type = "lowpass";
    dry.gain.value = 0.68;
    wet.gain.value = 0;
    output.gain.value = 0.92;
    if (feedback) feedback.gain.value = 0;

    let inputTail = bus;
    if (tone) {
      inputTail.connect(tone);
      inputTail = tone;
    }
    inputTail.connect(rhythm);

    rhythm.connect(dry);
    dry.connect(output);

    let recursiveTail = rhythm;
    if (delay) {
      recursiveTail.connect(delay);
      recursiveTail = delay;
    }
    if (twist) {
      recursiveTail.connect(twist);
      recursiveTail = twist;
    }
    recursiveTail.connect(wet);
    if (panner) {
      wet.connect(panner);
      panner.connect(output);
    } else {
      wet.connect(output);
    }
    output.connect(this.master);

    if (delay && feedback) {
      let feedbackTail = recursiveTail;
      if (feedbackFilter) {
        feedbackTail.connect(feedbackFilter);
        feedbackTail = feedbackFilter;
      }
      feedbackTail.connect(feedback);
      feedback.connect(delay);
    }

    let rhythmOscillator = null;
    let rhythmModDepth = null;
    if (typeof this.context.createOscillator === "function") {
      rhythmOscillator = this.context.createOscillator();
      rhythmModDepth = this.context.createGain();
      rhythmOscillator.type = "triangle";
      rhythmOscillator.connect(rhythmModDepth);
      rhythmModDepth.connect(rhythm.gain);
      rhythmOscillator.start(this.context.currentTime);
    }

    this.sessionTone = tone;
    this.sessionDonut = {
      delay,
      dry,
      feedback,
      feedbackFilter,
      nodes: [
        bus,
        tone,
        rhythm,
        dry,
        delay,
        twist,
        wet,
        panner,
        feedbackFilter,
        feedback,
        output,
        rhythmModDepth,
        rhythmOscillator,
      ].filter(Boolean),
      output,
      panner,
      rhythm,
      rhythmModDepth,
      rhythmOscillator,
      twist,
      wet,
    };
    this.setLiveAxes(this.liveStudyId, this.liveAxes, true);
  }

  stopSession() {
    const context = this.context;
    const now = context?.currentTime ?? 0;
    const sessionBus = this.sessionBus;
    const sessionTone = this.sessionTone;
    const donut = this.sessionDonut;
    const fade = donut?.output ?? sessionBus;
    if (fade?.gain && context) {
      setParam(fade.gain, "cancelScheduledValues", now, now);
      setParam(
        fade.gain,
        "setValueAtTime",
        Math.max(MIN_GAIN, fade.gain.value || 1),
        now,
      );
      setParam(
        fade.gain,
        "exponentialRampToValueAtTime",
        MIN_GAIN,
        now + 0.045,
      );
    }
    if (donut?.rhythmOscillator) {
      try { donut.rhythmOscillator.stop(now + 0.055); } catch { /* already stopped */ }
    }
    for (const source of this.sources) {
      try { source.stop(now + 0.055); } catch { /* already stopped */ }
    }

    const staleNodes = [
      ...this.sessionDepthBuses.values(),
      ...(donut?.nodes ?? [sessionTone, sessionBus].filter(Boolean)),
    ];
    const disconnectStaleGraph = () => {
      for (const node of [...staleNodes].reverse()) {
        try { node.disconnect?.(); } catch { /* already disconnected */ }
      }
    };
    if (staleNodes.length) {
      if (typeof globalThis.setTimeout === "function" && context) {
        globalThis.setTimeout(disconnectStaleGraph, 80);
      } else {
        disconnectStaleGraph();
      }
    }

    this.sources.clear();
    this.sessionBus = null;
    this.sessionTone = null;
    this.sessionDonut = null;
    this.sessionDepthBuses.clear();
    this.liveVoices.clear();
  }

  depthBus(depth = 0) {
    const maximumDepth = Math.max(
      0,
      Math.round(Number(this.prepared?.parameters?.depth) || 0),
    );
    const boundedDepth = Math.min(
      maximumDepth,
      Math.max(0, Math.round(Number(depth) || 0)),
    );
    if (this.sessionDepthBuses.has(boundedDepth)) {
      return this.sessionDepthBuses.get(boundedDepth);
    }
    const bus = this.context.createGain();
    bus.gain.value = ancestorGain(
      boundedDepth,
      maximumDepth,
      this.liveAxes.memory,
    );
    bus.connect(this.sessionBus ?? this.master);
    this.sessionDepthBuses.set(boundedDepth, bus);
    return bus;
  }

  setLiveAxes(studyId, values, immediate = false) {
    const next = normalizeLiveAxes(values);
    this.liveStudyId = studyId ?? this.liveStudyId;
    this.liveAxes = next;
    if (!this.context) return;
    const now = this.context.currentTime;
    const timeConstant = immediate ? 0.001 : 0.012;
    const fuzzy = this.liveStudyId === "ouroboros-tape"
      ? fuzzyDspFor(next)
      : null;
    const target = (param, value, constant = timeConstant) => {
      if (!param) return;
      holdParam(param, now);
      setParam(param, "setTargetAtTime", value, now, constant);
    };

    if (this.sessionDonut && fuzzy) {
      const donut = this.sessionDonut;
      const maximumFrequency = Math.max(
        120,
        Math.min(20_000, (Number(this.context.sampleRate) || 48_000) * 0.45),
      );
      if (this.sessionTone) {
        this.sessionTone.type = "lowpass";
        target(
          this.sessionTone.frequency,
          clamp(fuzzy.cutoffHz, 120, maximumFrequency),
        );
        target(this.sessionTone.Q, clamp(fuzzy.toneQ, 0.7, 8));
      }
      if (donut.rhythmOscillator?.frequency) {
        target(
          donut.rhythmOscillator.frequency,
          clamp(fuzzy.rhythmHz, 0.35, 18),
        );
      }
      const rhythmDepth = donut.rhythmModDepth
        ? clamp(fuzzy.rhythmDepth, 0.06, 0.48)
        : 0;
      target(donut.rhythm.gain, 1 - rhythmDepth);
      target(donut.rhythmModDepth?.gain, rhythmDepth);
      target(
        donut.delay?.delayTime,
        clamp(fuzzy.phraseDelay, 0.025, 0.9),
        immediate ? 0.001 : 0.01,
      );
      target(donut.panner?.pan, clamp(fuzzy.phrasePan, -0.9, 0.9));
      if (donut.twist) {
        donut.twist.type = "allpass";
        target(
          donut.twist.frequency,
          clamp(fuzzy.twistHz, 120, Math.min(7_200, maximumFrequency)),
        );
        target(donut.twist.Q, clamp(fuzzy.twistQ, 0.7, 14));
      }
      if (donut.feedbackFilter) {
        donut.feedbackFilter.type = "lowpass";
        target(
          donut.feedbackFilter.frequency,
          clamp(fuzzy.feedbackCutoffHz ?? 6_000, 2_000, maximumFrequency),
        );
        target(donut.feedbackFilter.Q, 0.45);
      }
      target(
        donut.feedback?.gain,
        clamp(fuzzy.feedback, 0, 0.88),
        immediate ? 0.001 : 0.016,
      );
      target(donut.wet.gain, clamp(fuzzy.wet, 0.04, 0.52));
    } else {
      const tone = sessionToneFor(this.liveStudyId, next);
      if (this.sessionTone) {
        this.sessionTone.type = tone.type;
        target(this.sessionTone.frequency, tone.frequency);
        target(this.sessionTone.Q, tone.q);
        target(this.sessionTone.gain, tone.gain);
      }
    }

    const maximumDepth = Math.max(
      0,
      Math.round(Number(this.prepared?.parameters?.depth) || 0),
    );
    for (const [depth, bus] of this.sessionDepthBuses) {
      setParam(
        bus.gain,
        "setTargetAtTime",
        ancestorGain(depth, maximumDepth, next.memory),
        now,
        timeConstant,
      );
    }

    for (const voice of this.liveVoices) {
      const pitchMoved = Math.abs(next.pitch - voice.appliedAxes.pitch) > 0.0001;
      const timbreMoved = Math.abs(next.timbre - voice.appliedAxes.timbre) > 0.0001;
      const phraseMoved = Math.abs(next.phrase - voice.appliedAxes.phrase) > 0.0001;
      const twistMoved = Math.abs(next.twist - voice.appliedAxes.twist) > 0.0001;
      if (voice.source?.playbackRate && pitchMoved) {
        if (voice.absolutePitch && fuzzy) {
          target(
            voice.source.playbackRate,
            clamp(
              voice.rateAnchor * fuzzy.pitchRate,
              LIVE_MIN_PLAYBACK_RATE,
              LIVE_MAX_PLAYBACK_RATE,
            ),
            immediate ? 0.001 : 0.008,
          );
        } else {
          const rate = clamp(
            voice.rateAnchor * 2 ** (
              (next.pitch - voice.anchorAxes.pitch) * 1.6
            ),
            LIVE_MIN_PLAYBACK_RATE,
            LIVE_MAX_PLAYBACK_RATE,
          );
          target(
            voice.source.playbackRate,
            rate,
            immediate ? 0.001 : 0.008,
          );
        }
      }
      for (const definition of voice.filters) {
        const filter = definition.node;
        if (filter?.frequency && timbreMoved) {
          const frequency = clamp(
            definition.frequencyAnchor * 2 ** (
              (next.timbre - voice.anchorAxes.timbre) * 4.5
            ),
            definition.minFrequency,
            definition.maxFrequency,
          );
          holdParam(filter.frequency, now);
          setParam(
            filter.frequency,
            "setTargetAtTime",
            frequency,
            now,
            timeConstant,
          );
        }
        if (filter?.Q && twistMoved) {
          const q = clamp(
            definition.qAnchor * 2 ** (
              (next.twist - voice.anchorAxes.twist) * 2.2
            ),
            0.1,
            14,
          );
          holdParam(filter.Q, now);
          setParam(filter.Q, "setTargetAtTime", q, now, timeConstant);
        }
      }
      for (const definition of voice.delays) {
        const delay = definition.node;
        if (!delay?.delayTime || (!twistMoved && !phraseMoved)) continue;
        const delayTime = clamp(
          definition.delayAnchor * 2 ** (
            (next.twist - voice.anchorAxes.twist) * 1.8
              + (next.phrase - voice.anchorAxes.phrase) * 0.6
          ),
          0.0002,
          0.08,
        );
        holdParam(delay.delayTime, now);
        setParam(
          delay.delayTime,
          "setTargetAtTime",
          delayTime,
          now,
          timeConstant,
        );
      }
      for (const definition of voice.panners) {
        const panner = definition.node;
        if (!panner?.pan || !phraseMoved) continue;
        const pan = clamp(
          definition.panAnchor + (
            next.phrase - voice.anchorAxes.phrase
          ) * 1.6,
          -1,
          1,
        );
        holdParam(panner.pan, now);
        setParam(panner.pan, "setTargetAtTime", pan, now, timeConstant);
      }
      voice.appliedAxes = next;
    }
  }

  trackLiveVoice(source, {
    filters = [],
    delays = [],
    panner = null,
    panners = [],
    rateAnchor = null,
    panAnchor = null,
    absolutePitch = false,
  } = {}) {
    if (!source) return;
    const filterList = Array.isArray(filters) ? filters : [filters];
    const delayList = Array.isArray(delays) ? delays : [delays];
    const pannerList = [
      ...(Array.isArray(panners) ? panners : [panners]),
      ...(panner ? [{ node: panner, panAnchor }] : []),
    ];
    const anchorAxes = this.liveAxes;
    const voice = {
      source,
      anchorAxes,
      appliedAxes: anchorAxes,
      absolutePitch: Boolean(absolutePitch),
      rateAnchor: clamp(
        rateAnchor ?? source.playbackRate?.value ?? 1,
        LIVE_MIN_PLAYBACK_RATE,
        LIVE_MAX_PLAYBACK_RATE,
      ),
      filters: filterList.filter(Boolean).map((entry) => {
        const node = entry.node ?? entry;
        const minFrequency = Math.max(
          10,
          Number(entry.minFrequency) || 20,
        );
        const maxFrequency = Math.max(
          minFrequency,
          Number(entry.maxFrequency) || Math.min(
            20_000,
            Math.max(40, (Number(this.context?.sampleRate) || 48_000) * 0.48),
          ),
        );
        return {
          node,
          frequencyAnchor: clamp(
            entry.frequencyAnchor ?? node.frequency?.value ?? 1_000,
            minFrequency,
            maxFrequency,
          ),
          minFrequency,
          maxFrequency,
          qAnchor: clamp(entry.qAnchor ?? node.Q?.value ?? 1, 0.1, 14),
        };
      }),
      delays: delayList.filter(Boolean).map((entry) => {
        const node = entry.node ?? entry;
        return {
          node,
          delayAnchor: clamp(
            entry.delayAnchor ?? node.delayTime?.value ?? 0.001,
            0.0002,
            0.08,
          ),
        };
      }),
      panners: pannerList.filter(Boolean).map((entry) => {
        const node = entry.node ?? entry;
        return {
          node,
          panAnchor: clamp(
            entry.panAnchor ?? node.pan?.value ?? 0,
            -1,
            1,
          ),
        };
      }),
    };
    this.liveVoices.add(voice);
    const previous = source.onended;
    source.onended = (...args) => {
      this.liveVoices.delete(voice);
      previous?.(...args);
    };
  }

  register(source) {
    if (this.sources.size >= MAX_GRAPH_SOURCES) return null;
    this.sources.add(source);
    const previous = source.onended;
    source.onended = (...args) => {
      this.sources.delete(source);
      previous?.(...args);
    };
    return source;
  }

  motionBuffer(generation, pulse) {
    const prepared = this.prepared;
    if (!prepared) return null;
    const buffers = prepared.generationBuffers;
    const generationIndex = buffers?.length
      ? Math.min(Math.max(0, Math.round(generation)), buffers.length - 1)
      : 0;
    const base = buffers?.[generationIndex] ?? prepared.seedBuffer;
    if (!base) return null;
    const reverse = pulse.timeDirection < 0;
    const swap = Boolean(pulse.channelSwap);
    if (!reverse && !swap) return base;
    const key = `${generationIndex}:${reverse ? "r" : "f"}:${swap ? "s" : "n"}`;
    if (prepared.motionBufferCache.has(key)) {
      return prepared.motionBufferCache.get(key);
    }
    const length = base.length;
    const left = base.getChannelData(0);
    const right = base.getChannelData(Math.min(1, base.numberOfChannels - 1));
    const outputLeft = new Float32Array(length);
    const outputRight = new Float32Array(length);
    const sourceLeft = swap ? right : left;
    const sourceRight = swap ? left : right;
    for (let index = 0; index < length; index += 1) {
      const sourceIndex = reverse ? length - index - 1 : index;
      outputLeft[index] = sourceLeft[sourceIndex];
      outputRight[index] = sourceRight[sourceIndex];
    }
    const variant = this.audioBuffer([outputLeft, outputRight]);
    prepared.motionBufferCache.set(key, variant);
    return variant;
  }

  outputNode(gain, pan, start, end, depth = 0) {
    const envelope = this.context.createGain();
    rampEnvelope(envelope.gain, start, Math.max(MIN_GAIN, gain), end);
    let tail = envelope;
    let panner = null;
    if (typeof this.context.createStereoPanner === "function") {
      panner = this.context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      envelope.connect(panner);
      tail = panner;
    }
    tail.connect(this.depthBus(depth));
    envelope.livePanner = panner;
    return envelope;
  }

  motionOutputNode(gain, panStart, panEnd, start, end, depth = 0) {
    const envelope = this.context.createGain();
    rampEnvelope(envelope.gain, start, Math.max(MIN_GAIN, gain), end);
    let tail = envelope;
    let panner = null;
    if (typeof this.context.createStereoPanner === "function") {
      panner = this.context.createStereoPanner();
      setParam(panner.pan, "setValueAtTime", clamp(panStart, -1, 1), start);
      setParam(panner.pan, "linearRampToValueAtTime", clamp(panEnd, -1, 1), end);
      envelope.connect(panner);
      tail = panner;
    }
    tail.connect(this.depthBus(depth));
    envelope.livePanner = panner;
    return envelope;
  }

  scheduleBuffer(buffer, start, event, gainScale = 1, options = {}) {
    if (!buffer || typeof this.context.createBufferSource !== "function") return;
    const duration = clamp(options.duration ?? event.duration ?? buffer.duration, 0.025, 8);
    const source = this.register(this.context.createBufferSource());
    if (!source) return;
    source.buffer = buffer;
    const baseRate = clamp(buffer.duration / duration, 0.35, 4);
    const absolutePitch = this.liveStudyId === "ouroboros-tape";
    const pitchRate = absolutePitch
      ? fuzzyDspFor(this.liveAxes).pitchRate
      : 1;
    source.playbackRate.value = clamp(
      baseRate * pitchRate,
      LIVE_MIN_PLAYBACK_RATE,
      LIVE_MAX_PLAYBACK_RATE,
    );
    const output = this.outputNode(
      clamp((event.gain ?? 0.32) * gainScale, 0.002, 0.5),
      event.pan ?? 0,
      start,
      start + duration,
      event.depth ?? event.generation ?? 0,
    );
    source.connect(output);
    this.trackLiveVoice(source, {
      absolutePitch,
      panner: output.livePanner,
      rateAnchor: baseRate,
    });
    if (absolutePitch && buffer.duration > 0.002) {
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
    }
    source.start(start, options.offset ?? 0);
    source.stop(start + duration + 0.04);
  }

  scheduleGenerationBuffer(event, start, gainScale) {
    const generation = Math.max(0, Math.round(event.generation ?? event.depth ?? 0));
    const buffer = this.prepared?.generationBuffers?.[
      Math.min(generation, this.prepared.generationBuffers.length - 1)
    ] ?? this.prepared?.seedBuffer;
    this.scheduleBuffer(buffer, start, event, gainScale);
  }

  connectMotionStudyPath(studyId, moment, pulse, input) {
    let tail = input;
    const liveFilters = [];
    const events = Array.isArray(moment?.events) ? moment.events : [];
    const routedEvent = events.length
      ? events[(pulse.routeIndex ?? pulse.phraseIndex) % events.length]
      : null;

    if (studyId === "filter-hydra") {
      const filters = routedEvent?.process?.filters ?? [];
      for (const definition of filters) {
        const filter = this.context.createBiquadFilter?.();
        if (!filter) continue;
        filter.type = definition.type;
        filter.frequency.value = clamp(definition.cutoffHz, 24, 18_000);
        filter.Q.value = clamp(definition.q * 0.72, 0.1, 5.2);
        tail.connect(filter);
        tail = filter;
        liveFilters.push(filter);
      }
    } else if (studyId === "cantor-delay") {
      const path = routedEvent?.path ?? [];
      if (path.length && typeof this.context.createBiquadFilter === "function") {
        let low = 45;
        let high = 18_000;
        for (const branch of path) {
          const split = Math.sqrt(low * high);
          if (Number(branch) === 0) high = split;
          else low = split;
        }
        const center = Math.sqrt(low * high);
        const filter = this.context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = center;
        filter.Q.value = clamp(center / Math.max(55, high - low), 0.25, 7);
        tail.connect(filter);
        tail = filter;
        liveFilters.push(filter);
      }
    } else if (studyId === "phase-labyrinth") {
      const chain = routedEvent?.process?.chain ?? [];
      for (const definition of chain) {
        const allpass = this.context.createBiquadFilter?.();
        if (!allpass) continue;
        allpass.type = "allpass";
        const delaySeconds = clamp(definition.delayMs / 1_000, 0.001, 0.05);
        allpass.frequency.value = clamp(1 / (delaySeconds * 4), 32, 8_000);
        allpass.Q.value = clamp(0.3 + definition.feedback * 8, 0.3, 7.5);
        tail.connect(allpass);
        tail = allpass;
        liveFilters.push(allpass);
      }
    }

    return { tail, liveFilters };
  }

  scheduleMotionPulse(studyId, moment, pulse, when, pulseGain) {
    if (typeof this.context.createBufferSource !== "function") return;
    const generation = Math.max(
      0,
      Math.round(pulse.generation ?? moment.depth ?? 0),
    );
    const buffer = this.motionBuffer(generation, pulse);
    if (!buffer) return;
    const source = this.register(this.context.createBufferSource());
    if (!source) return;
    source.buffer = buffer;

    const startRate = clamp(
      pulse.playbackRate,
      MOTION_CAPS.minPlaybackRate,
      MOTION_CAPS.maxPlaybackRate,
    );
    const endRate = clamp(
      startRate * 2 ** (clamp(
        pulse.pitchEnd,
        -MOTION_CAPS.maxAbsPitchSemitones,
        MOTION_CAPS.maxAbsPitchSemitones,
      ) / 12),
      MOTION_CAPS.minPlaybackRate,
      MOTION_CAPS.maxPlaybackRate,
    );
    const duration = clamp(pulse.duration, 0.02, 1.5);
    const end = when + duration;
    const absolutePitch = studyId === "ouroboros-tape";
    const pitchRate = absolutePitch
      ? fuzzyDspFor(this.liveAxes).pitchRate
      : 1;
    const scheduledStartRate = clamp(
      startRate * pitchRate,
      LIVE_MIN_PLAYBACK_RATE,
      LIVE_MAX_PLAYBACK_RATE,
    );
    const scheduledEndRate = clamp(
      endRate * pitchRate,
      LIVE_MIN_PLAYBACK_RATE,
      LIVE_MAX_PLAYBACK_RATE,
    );
    setParam(source.playbackRate, "setValueAtTime", scheduledStartRate, when);
    setParam(
      source.playbackRate,
      "exponentialRampToValueAtTime",
      scheduledEndRate,
      end,
    );

    const polarity = this.context.createGain();
    polarity.gain.value = pulse.polarity < 0 ? -1 : 1;
    source.connect(polarity);
    const studyPath = this.connectMotionStudyPath(
      studyId,
      moment,
      pulse,
      polarity,
    );
    let tail = studyPath.tail;

    const movingFilter = this.context.createBiquadFilter?.();
    let movingFilterAnchor = null;
    if (movingFilter) {
      const types = studyId === "ouroboros-tape"
        ? ["lowpass", "bandpass", "highpass"]
        : ["bandpass", "highpass", "lowpass"];
      movingFilter.type = types[pulse.phraseIndex % types.length];
      const startHz = clamp(
        pulse.filterHz,
        MOTION_CAPS.minFilterHz,
        MOTION_CAPS.maxFilterHz,
      );
      const endHz = clamp(
        startHz * 2 ** (pulse.pitchEnd / 18),
        MOTION_CAPS.minFilterHz,
        MOTION_CAPS.maxFilterHz,
      );
      setParam(movingFilter.frequency, "setValueAtTime", startHz, when);
      setParam(movingFilter.frequency, "exponentialRampToValueAtTime", endHz, end);
      const startQ = clamp(pulse.q, 0.2, 14);
      setParam(movingFilter.Q, "setValueAtTime", startQ, when);
      tail.connect(movingFilter);
      tail = movingFilter;
      movingFilterAnchor = {
        node: movingFilter,
        frequencyAnchor: startHz,
        minFrequency: MOTION_CAPS.minFilterHz,
        maxFrequency: MOTION_CAPS.maxFilterHz,
        qAnchor: startQ,
      };
    }

    const panEnd = clamp(
      -pulse.pan * 0.72 + Math.sin((pulse.phraseIndex + 1) * 1.7) * 0.28,
      -1,
      1,
    );
    const output = this.motionOutputNode(
      pulseGain,
      pulse.pan,
      panEnd,
      when,
      end,
      moment.depth ?? generation,
    );
    tail.connect(output);
    this.trackLiveVoice(source, {
      absolutePitch,
      filters: [
        ...studyPath.liveFilters,
        movingFilterAnchor,
      ],
      panner: output.livePanner,
      rateAnchor: startRate,
      panAnchor: pulse.pan,
    });

    const maximumRead = Math.max(0.001, buffer.duration - 0.001);
    const liveReadRequirement = duration * LIVE_MAX_PLAYBACK_RATE + 0.025;
    const needsLoop = liveReadRequirement > maximumRead;
    const requiredRead = needsLoop
      ? Math.min(
        maximumRead,
        Math.max(0.08, duration * Math.max(startRate, endRate) + 0.025),
      )
      : liveReadRequirement;
    const maximumOffset = Math.max(0, buffer.duration - requiredRead);
    const sourceOffset = clamp(pulse.sourcePosition, 0, 1) * maximumOffset;
    if (needsLoop) {
      // Long spectral/convolution bodies can outlive their finite source when
      // Pitch is pushed to the live maximum. Loop the largest safe read region
      // and let the bounded output envelope decide the audible duration.
      source.loop = true;
      source.loopStart = sourceOffset;
      source.loopEnd = Math.max(
        sourceOffset + 0.001,
        Math.min(buffer.duration, sourceOffset + requiredRead),
      );
      source.start(when, sourceOffset);
    } else {
      source.start(
        when,
        sourceOffset,
        Math.min(buffer.duration - sourceOffset, requiredRead),
      );
    }
    source.stop(end + 0.04);
  }

  scheduleMotionField(studyId, moment, when, gainScale, {
    pulseLimit = MOTION_CAPS.maxPulsesPerMoment,
    phaseOffset = 0,
    windowStart = 0,
    windowDuration = null,
  } = {}) {
    const available = Array.isArray(moment?.motion?.pulses)
      ? moment.motion.pulses
      : [];
    if (!available.length) return;
    const limit = Math.max(1, Math.min(
      MOTION_CAPS.maxPulsesPerMoment,
      Math.round(pulseLimit),
    ));
    const pulses = available.length <= limit
      ? available
      : Array.from(
        { length: limit },
        (_, index) => available[Math.floor(index * available.length / limit)],
      );
    const averageDuration = pulses.reduce(
      (total, pulse) => total + pulse.duration,
      0,
    ) / pulses.length;
    const overlap = Math.max(
      1,
      pulses.length * averageDuration / Math.max(0.08, moment.duration),
    );
    const pulseGain = clamp(0.24 / Math.sqrt(overlap) * gainScale, 0.006, 0.18);
    const offsetSpan = Math.max(0.08, moment.duration * 0.84);
    const boundedWindowStart = Math.max(0, Number(windowStart) || 0);
    const boundedWindowDuration = (
      windowDuration !== null
      && windowDuration !== undefined
      && Number.isFinite(Number(windowDuration))
    )
      ? Math.max(0.001, Number(windowDuration))
      : null;
    const windowEnd = boundedWindowDuration === null
      ? Infinity
      : boundedWindowStart + boundedWindowDuration;

    for (const pulse of pulses) {
      if (this.sources.size >= MAX_GRAPH_SOURCES) break;
      const rotatedOffset = (
        (pulse.offset + phaseOffset) % offsetSpan + offsetSpan
      ) % offsetSpan;
      const localOffset = rotatedOffset + pulse.delay;
      if (
        boundedWindowDuration !== null
        && (
          localOffset < boundedWindowStart
          || localOffset >= windowEnd
        )
      ) continue;
      const start = Math.max(
        this.context.currentTime + 0.003,
        when + localOffset - (
          boundedWindowDuration === null ? 0 : boundedWindowStart
        ),
      );
      this.scheduleMotionPulse(studyId, moment, pulse, start, pulseGain);
    }
  }

  scheduleFilterBranch(event, start, gainScale) {
    const buffer = this.prepared?.seedBuffer;
    if (!buffer) return;
    const source = this.register(this.context.createBufferSource());
    if (!source) return;
    source.buffer = buffer;
    const duration = clamp(event.duration ?? buffer.duration, 0.08, 7);
    source.playbackRate.value = clamp(buffer.duration / duration, 0.4, 3.5);
    let tail = source;
    const liveFilters = [];
    for (const definition of event.process?.filters ?? []) {
      const filter = this.context.createBiquadFilter?.();
      if (!filter) continue;
      filter.type = definition.type;
      filter.frequency.value = clamp(definition.cutoffHz, 24, 18_000);
      filter.Q.value = clamp(definition.q, 0.1, 5.2);
      tail.connect(filter);
      tail = filter;
      liveFilters.push(filter);
    }
    const output = this.outputNode(
      clamp((event.gain ?? 0.04) * gainScale, 0.001, 0.28),
      event.pan ?? 0,
      start,
      start + duration,
      event.depth ?? event.process?.depth ?? 0,
    );
    tail.connect(output);
    this.trackLiveVoice(source, {
      filters: liveFilters,
      panner: output.livePanner,
    });
    source.start(start);
    source.stop(start + duration + 0.04);
  }

  scheduleHydraTree(moment, start, gainScale) {
    const buffer = this.prepared?.seedBuffer;
    const events = Array.isArray(moment?.events) ? moment.events : [];
    if (!buffer || !events.length) return;
    const depth = Math.max(0, Math.round(moment.depth ?? 0));
    const duration = clamp(moment.duration ?? buffer.duration, 0.08, 7);
    const source = this.register(this.context.createBufferSource());
    if (!source) return;
    source.buffer = buffer;
    source.playbackRate.value = clamp(buffer.duration / duration, 0.4, 3.5);
    const liveFilters = [];
    const livePanners = [];
    const byPath = new Map(events.map((event) => [(event.path ?? []).join(""), event]));
    const maximumOffset = events.reduce((maximum, event) => Math.max(maximum, event.offset ?? 0), 0);

    const descendantFor = (prefix) => events.find((event) => (
      (event.path ?? []).slice(0, prefix.length).join("") === prefix
    ));
    const connectLeaf = (node, path) => {
      const event = byPath.get(path) ?? events[0];
      let tail = node;
      const offset = Math.max(0, event.offset ?? 0);
      if (offset > 0 && typeof this.context.createDelay === "function") {
        const delay = this.context.createDelay(Math.max(0.1, offset + 0.02));
        delay.delayTime.value = offset;
        tail.connect(delay);
        tail = delay;
      }
      const output = this.outputNode(
        clamp((event.gain ?? 0.04) * gainScale, 0.001, 0.28),
        event.pan ?? 0,
        start + offset,
        start + offset + duration,
        depth,
      );
      tail.connect(output);
      if (output.livePanner) {
        livePanners.push({
          node: output.livePanner,
          panAnchor: event.pan ?? 0,
        });
      }
    };
    const split = (node, pathArray) => {
      if (pathArray.length >= depth) {
        connectLeaf(node, pathArray.join(""));
        return;
      }
      for (const branch of [0, 1]) {
        const nextPath = [...pathArray, branch];
        const descendant = descendantFor(nextPath.join(""));
        const definition = descendant?.process?.filters?.[pathArray.length];
        const filter = this.context.createBiquadFilter?.();
        if (!filter || !definition) {
          split(node, nextPath);
          continue;
        }
        filter.type = definition.type;
        filter.frequency.value = clamp(definition.cutoffHz, 24, 18_000);
        filter.Q.value = clamp(definition.q, 0.1, 5.2);
        node.connect(filter);
        liveFilters.push(filter);
        split(filter, nextPath);
      }
    };

    split(source, []);
    this.trackLiveVoice(source, {
      filters: liveFilters,
      panners: livePanners,
    });
    source.start(start);
    source.stop(start + duration + maximumOffset + 0.05);
  }

  scheduleCantorNode(event, start, gainScale) {
    const buffer = this.prepared?.seedBuffer;
    if (!buffer) return;
    const duration = clamp(event.duration ?? 0.08, 0.025, 0.65);
    const source = this.register(this.context.createBufferSource());
    if (!source) return;
    source.buffer = buffer;
    const output = this.outputNode(
      clamp((event.gain ?? 0.04) * gainScale, 0.001, 0.22),
      event.pan ?? 0,
      start,
      start + duration,
      event.depth ?? event.path?.length ?? 0,
    );
    let tail = source;
    const path = event.path ?? [];
    let liveFilter = null;
    if (path.length && typeof this.context.createBiquadFilter === "function") {
      let low = 45;
      let high = 18_000;
      for (const branch of path) {
        const split = Math.sqrt(low * high);
        if (Number(branch) === 0) high = split;
        else low = split;
      }
      const center = Math.sqrt(low * high);
      const filter = this.context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = center;
      filter.Q.value = clamp(center / Math.max(60, high - low), 0.25, 4.5);
      tail.connect(filter);
      tail = filter;
      liveFilter = filter;
    }
    tail.connect(output);
    this.trackLiveVoice(source, {
      filters: liveFilter,
      panner: output.livePanner,
    });
    const maximumOffset = Math.max(0, buffer.duration - duration - 0.01);
    const offset = event.source === "impulse"
      ? 0
      : maximumOffset * (hashPath(path) / 4_294_967_295);
    source.start(start, offset, Math.min(buffer.duration - offset, duration * 1.1));
    source.stop(start + duration + 0.04);
  }

  scheduleAllpass(event, start, gainScale) {
    const buffer = this.prepared?.seedBuffer;
    if (!buffer) return;
    const duration = clamp(event.duration ?? buffer.duration, 0.08, 7);
    const source = this.register(this.context.createBufferSource());
    if (!source) return;
    source.buffer = buffer;
    source.playbackRate.value = clamp(buffer.duration / duration, 0.4, 3.5);
    const chain = event.process?.chain ?? [];
    const returning = Boolean(event.process?.returning);
    const definitions = returning ? [...chain].reverse() : chain;
    const liveFilters = [];
    const liveDelays = [];
    let tail = source;
    for (const definition of definitions) {
      const allpass = this.context.createBiquadFilter?.();
      if (!allpass) continue;
      allpass.type = "allpass";
      const delaySeconds = clamp(definition.delayMs / 1_000, 0.001, 0.05);
      allpass.frequency.value = clamp(1 / (delaySeconds * 4), 32, 8_000);
      allpass.Q.value = clamp(0.3 + definition.feedback * 8, 0.3, 7.5);
      tail.connect(allpass);
      tail = allpass;
      liveFilters.push(allpass);
      if (typeof this.context.createDelay === "function") {
        const delay = this.context.createDelay(0.08);
        delay.delayTime.value = delaySeconds * 0.28;
        tail.connect(delay);
        tail = delay;
        liveDelays.push(delay);
      }
    }
    const output = this.outputNode(
      clamp((event.gain ?? 0.34) * gainScale, 0.003, 0.4),
      returning ? -0.18 : 0.18,
      start,
      start + duration,
      event.depth ?? event.process?.chain?.length ?? 0,
    );
    const dry = this.context.createGain();
    const wet = this.context.createGain();
    dry.gain.value = 0.5;
    wet.gain.value = returning ? -0.56 : 0.56;
    source.connect(dry);
    dry.connect(output);
    tail.connect(wet);
    wet.connect(output);
    this.trackLiveVoice(source, {
      filters: liveFilters,
      delays: liveDelays,
      panner: output.livePanner,
    });
    source.start(start);
    source.stop(start + duration + 0.08);
  }

  scheduleMoment(studyId, moment, when, gainScale = 1, motionOptions = {}) {
    if (!this.context || !this.sessionBus || !moment) return;
    const hasMotion = Boolean(moment.motion?.pulses?.length);
    const mix = voiceMixFor(studyId, this.liveAxes);
    const {
      includeNative = true,
      ...motionWindow
    } = motionOptions;
    if (studyId === "filter-hydra") {
      if (includeNative) {
        this.scheduleHydraTree(
          moment,
          Math.max(this.context.currentTime + 0.003, when),
          gainScale * mix.native,
        );
      }
      if (hasMotion) {
        this.scheduleMotionField(
          studyId,
          moment,
          when,
          gainScale * mix.motion,
          motionWindow,
        );
      }
      return;
    }
    const events = Array.isArray(moment.events) ? moment.events : [];
    const nativeWindowStart = Math.max(
      0,
      Number(motionWindow.windowStart) || 0,
    );
    const nativeWindowDuration = (
      motionWindow.windowDuration !== null
      && motionWindow.windowDuration !== undefined
      && Number.isFinite(Number(motionWindow.windowDuration))
    )
      ? Math.max(0.001, Number(motionWindow.windowDuration))
      : null;
    const rollingCantorNative = (
      studyId === "cantor-delay"
      && nativeWindowDuration !== null
    );
    if (includeNative || rollingCantorNative) {
      for (const event of events) {
        if (this.sources.size >= MAX_GRAPH_SOURCES) break;
        const eventOffset = Math.max(0, Number(event.offset) || 0);
        if (
          rollingCantorNative
          && (
            eventOffset < nativeWindowStart
            || eventOffset >= nativeWindowStart + nativeWindowDuration
          )
        ) continue;
        const start = Math.max(
          this.context.currentTime + 0.003,
          when + eventOffset - (rollingCantorNative ? nativeWindowStart : 0),
        );
        if (event.synth === "buffer-generation" || event.synth === "stft-fold-generation") {
          this.scheduleGenerationBuffer(event, start, gainScale * mix.native);
        } else if (event.synth === "filter-branch") {
          this.scheduleFilterBranch(event, start, gainScale * mix.native);
        } else if (event.synth === "cantor-delay-node") {
          this.scheduleCantorNode(event, start, gainScale * mix.native);
        } else if (event.synth === "self-convolution-generation") {
          this.scheduleGenerationBuffer(event, start, gainScale * mix.native);
        } else if (event.synth === "allpass-generation") {
          this.scheduleAllpass(event, start, gainScale * mix.native);
        }
      }
    }
    if (hasMotion) {
      this.scheduleMotionField(
        studyId,
        moment,
        when,
        gainScale * mix.motion,
        motionWindow,
      );
    }
  }

  visualGeneration(generation = 0) {
    const generations = this.prepared?.generations;
    if (generations?.length) {
      return generations[Math.min(Math.max(0, generation), generations.length - 1)];
    }
    return this.prepared?.seed?.channels ?? null;
  }

  async destroy() {
    this.stopCapture();
    this.stopSession();
    this.outputCeiling = null;
    if (this.context && this.context.state !== "closed") {
      try { await this.context.close(); } catch { /* page is leaving */ }
    }
    if (globalThis[CONTEXT_GUARD_KEY] === this.context) {
      globalThis[CONTEXT_GUARD_KEY] = null;
    }
    this.context = null;
    this.master = null;
  }
}

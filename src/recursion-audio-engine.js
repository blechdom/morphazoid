import {
  convolutionImpulseGenerations,
  generateImpulseSeed,
  generateNoiseSeed,
  normalizeChannels,
  ouroborosGenerations,
} from "./recursion-buffer-dsp.js";
import { spectralMobiusGenerations } from "./recursion-spectral-dsp.js";

const MIN_GAIN = 0.0001;
const MAX_SEED_SECONDS = 4;
const MAX_GRAPH_SOURCES = 1_024;

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
    this.sessionBus = null;
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
      const context = new AudioContextClass({ latencyHint: "interactive" });
      const master = context.createGain();
      const highpass = context.createBiquadFilter?.();
      const lowpass = context.createBiquadFilter?.();
      const compressor = context.createDynamicsCompressor?.() ?? context.createGain();
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
      if (compressor.ratio) compressor.ratio.value = 12;
      if (compressor.attack) compressor.attack.value = 0.003;
      if (compressor.release) compressor.release.value = 0.22;
      compressor.connect(context.destination);
      this.context = context;
      this.master = master;
      this.setLevel(0.42, true);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
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
      seed,
      seedBuffer: this.audioBuffer(seed.channels),
      generations: null,
      generationBuffers: null,
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

  beginSession() {
    this.stopSession();
    const bus = this.context.createGain();
    bus.gain.value = 1;
    bus.connect(this.master);
    this.sessionBus = bus;
  }

  stopSession() {
    if (!this.context) return;
    const now = this.context.currentTime;
    if (this.sessionBus) {
      setParam(this.sessionBus.gain, "cancelScheduledValues", now, now);
      setParam(this.sessionBus.gain, "setValueAtTime", Math.max(MIN_GAIN, this.sessionBus.gain.value || 1), now);
      setParam(this.sessionBus.gain, "exponentialRampToValueAtTime", MIN_GAIN, now + 0.045);
    }
    for (const source of this.sources) {
      try { source.stop(now + 0.055); } catch { /* already stopped */ }
    }
    this.sources.clear();
    this.sessionBus = null;
  }

  register(source) {
    if (this.sources.size >= MAX_GRAPH_SOURCES) return source;
    this.sources.add(source);
    const previous = source.onended;
    source.onended = (...args) => {
      this.sources.delete(source);
      previous?.(...args);
    };
    return source;
  }

  outputNode(gain, pan, start, end) {
    const envelope = this.context.createGain();
    rampEnvelope(envelope.gain, start, Math.max(MIN_GAIN, gain), end);
    let tail = envelope;
    if (typeof this.context.createStereoPanner === "function") {
      const panner = this.context.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      envelope.connect(panner);
      tail = panner;
    }
    tail.connect(this.sessionBus ?? this.master);
    return envelope;
  }

  scheduleBuffer(buffer, start, event, gainScale = 1, options = {}) {
    if (!buffer || typeof this.context.createBufferSource !== "function") return;
    const duration = clamp(options.duration ?? event.duration ?? buffer.duration, 0.025, 8);
    const source = this.register(this.context.createBufferSource());
    source.buffer = buffer;
    source.playbackRate.value = clamp(buffer.duration / duration, 0.35, 4);
    const output = this.outputNode(
      clamp((event.gain ?? 0.32) * gainScale, 0.002, 0.5),
      event.pan ?? 0,
      start,
      start + duration,
    );
    source.connect(output);
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

  scheduleFilterBranch(event, start, gainScale) {
    const buffer = this.prepared?.seedBuffer;
    if (!buffer) return;
    const source = this.register(this.context.createBufferSource());
    source.buffer = buffer;
    const duration = clamp(event.duration ?? buffer.duration, 0.08, 7);
    source.playbackRate.value = clamp(buffer.duration / duration, 0.4, 3.5);
    let tail = source;
    for (const definition of event.process?.filters ?? []) {
      const filter = this.context.createBiquadFilter?.();
      if (!filter) continue;
      filter.type = definition.type;
      filter.frequency.value = clamp(definition.cutoffHz, 24, 18_000);
      filter.Q.value = clamp(definition.q, 0.1, 5.2);
      tail.connect(filter);
      tail = filter;
    }
    const output = this.outputNode(
      clamp((event.gain ?? 0.04) * gainScale, 0.001, 0.28),
      event.pan ?? 0,
      start,
      start + duration,
    );
    tail.connect(output);
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
    source.buffer = buffer;
    source.playbackRate.value = clamp(buffer.duration / duration, 0.4, 3.5);
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
      );
      tail.connect(output);
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
        split(filter, nextPath);
      }
    };

    split(source, []);
    source.start(start);
    source.stop(start + duration + maximumOffset + 0.05);
  }

  scheduleCantorNode(event, start, gainScale) {
    const buffer = this.prepared?.seedBuffer;
    if (!buffer) return;
    const duration = clamp(event.duration ?? 0.08, 0.025, 0.65);
    const source = this.register(this.context.createBufferSource());
    source.buffer = buffer;
    const output = this.outputNode(
      clamp((event.gain ?? 0.04) * gainScale, 0.001, 0.22),
      event.pan ?? 0,
      start,
      start + duration,
    );
    let tail = source;
    const path = event.path ?? [];
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
    }
    tail.connect(output);
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
    source.buffer = buffer;
    source.playbackRate.value = clamp(buffer.duration / duration, 0.4, 3.5);
    let tail = source;
    const chain = event.process?.chain ?? [];
    const inverse = Boolean(event.process?.inverse);
    const definitions = inverse ? [...chain].reverse() : chain;
    for (const definition of definitions) {
      const allpass = this.context.createBiquadFilter?.();
      if (!allpass) continue;
      allpass.type = "allpass";
      const delaySeconds = clamp(definition.delayMs / 1_000, 0.001, 0.05);
      allpass.frequency.value = clamp(1 / (delaySeconds * 4), 32, 8_000);
      allpass.Q.value = clamp(0.3 + definition.feedback * 8, 0.3, 7.5);
      tail.connect(allpass);
      tail = allpass;
      if (typeof this.context.createDelay === "function") {
        const delay = this.context.createDelay(0.08);
        delay.delayTime.value = delaySeconds * 0.28;
        tail.connect(delay);
        tail = delay;
      }
    }
    const output = this.outputNode(
      clamp((event.gain ?? 0.34) * gainScale, 0.003, 0.4),
      inverse ? -0.18 : 0.18,
      start,
      start + duration,
    );
    tail.connect(output);
    source.start(start);
    source.stop(start + duration + 0.08);
  }

  scheduleMoment(studyId, moment, when, gainScale = 1) {
    if (!this.context || !this.sessionBus || !moment) return;
    if (studyId === "filter-hydra") {
      this.scheduleHydraTree(moment, Math.max(this.context.currentTime + 0.003, when), gainScale);
      return;
    }
    const events = Array.isArray(moment.events) ? moment.events : [];
    for (const event of events) {
      if (this.sources.size >= MAX_GRAPH_SOURCES) break;
      const start = Math.max(this.context.currentTime + 0.003, when + (event.offset ?? 0));
      if (event.synth === "buffer-generation" || event.synth === "stft-fold-generation") {
        this.scheduleGenerationBuffer(event, start, gainScale);
      } else if (event.synth === "filter-branch") {
        this.scheduleFilterBranch(event, start, gainScale);
      } else if (event.synth === "cantor-delay-node") {
        this.scheduleCantorNode(event, start, gainScale);
      } else if (event.synth === "self-convolution-generation") {
        this.scheduleGenerationBuffer(event, start, gainScale);
      } else if (event.synth === "allpass-generation") {
        this.scheduleAllpass(event, start, gainScale);
      }
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
    if (this.context && this.context.state !== "closed") {
      try { await this.context.close(); } catch { /* page is leaving */ }
    }
  }
}

import { connectAudioOutput } from '../../audio-output-manager.js';
import {
  ESI32_DEFAULT_PATCH, ESI32_MAX_BUFFER_BYTES, ESI32_MAX_FILE_BYTES,
  ESI32_MAX_SAMPLE_SECONDS, ESI32_MAX_VOICES, ESI32_SLOT_COUNT,
  createEsi32DemoData, samplePlaybackRate, sanitizeEsi32Patch,
} from './esi-32-model.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bytesOf = buffer => buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
const safeDisconnect = node => { try { node?.disconnect(); } catch {} };
const safeStop = (node, time) => { try { node?.stop(time); } catch {} };
const smooth = (parameter, value, time) => parameter.setTargetAtTime(value, time, .015);

function envelopeAt(voice, time) {
  const elapsed = Math.max(0, time - voice.startedAt);
  const patch = voice.patch;
  if (elapsed < patch.attack) return elapsed / patch.attack;
  if (elapsed < patch.attack + patch.decay) return 1 - (1 - patch.sustain) * (elapsed - patch.attack) / patch.decay;
  return patch.sustain;
}

function hold(parameter, time, fallback) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(time);
  else {
    parameter.cancelScheduledValues(time);
    parameter.setValueAtTime(fallback, time);
  }
}

/** Web Audio approximation: PCM playback, cascaded lowpass filters, ADSR and pitch LFO. */
export class Esi32Audio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.output = .72;
    this.patch = sanitizeEsi32Patch(ESI32_DEFAULT_PATCH);
    this.samples = new Map();
    this.reverseBuffers = new Map();
    this.regionBuffers = new Map();
    this.voices = new Map();
    this.retiring = new Set();
    this.pitchBend = 0;
    this.enabled = false;
    this.requested = false;
    this.disposed = false;
    this.generation = 0;
    this.serial = 0;
    this.startPromise = null;
    this.decodePromise = null;
    this.graph = [];
  }

  get voiceCount() { return this.voices.size; }
  get channelCount() { return [...this.voices.values()].reduce((sum, voice) => sum + voice.cost, 0); }
  get memoryBytes() { return this.residentBytes(); }

  /** The sole audio-arm boundary; calling noteOn never creates or resumes a context. */
  start() {
    if (this.disposed) return Promise.reject(new Error('The sampler has been disposed.'));
    if (this.startPromise) return this.startPromise;
    this.requested = true;
    const generation = ++this.generation;
    try {
      if (!this.context || this.context.state === 'closed') {
        this.panic();
        this.releaseAudioOutput?.();
        this.graph.forEach(safeDisconnect);
        const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
        if (!Context) throw new Error('Web Audio is unavailable in this browser.');
        const context = new Context({ latencyHint: 'interactive' });
        this.context = context;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value = 8;
        compressor.ratio.value = 12;
        compressor.attack.value = .002;
        compressor.release.value = .12;
        const limiter = context.createWaveShaper();
        const curve = new Float32Array(4096);
        for (let index = 0; index < curve.length; index += 1) {
          const x = index / (curve.length - 1) * 2 - 1;
          curve[index] = .95 * Math.tanh(x / .95);
        }
        limiter.curve = curve;
        limiter.oversample = '2x';
        this.master = context.createGain();
        this.master.gain.value = this.output;
        this.analyser = context.createAnalyser();
        this.analyser.fftSize = 512;
        compressor.connect(limiter);
        limiter.connect(this.master);
        this.master.connect(this.analyser);
        this.releaseAudioOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });
        this.input = compressor;
        this.graph = [compressor, limiter, this.master, this.analyser];
        for (let slot = 0; slot < ESI32_SLOT_COUNT; slot += 1) {
          if (!this.samples.has(slot)) this.restoreDemo(slot);
        }
      }
      const context = this.context;
      const promise = Promise.resolve(context.state === 'suspended' ? context.resume() : undefined).then(async () => {
        if (this.disposed || generation !== this.generation || this.context !== context) {
          if (this.disposed && context.state !== 'closed') await context.close();
          else if (!this.requested && context.state === 'running') await context.suspend();
          return false;
        }
        this.enabled = true;
        return true;
      }).catch(error => {
        if (generation === this.generation) { this.enabled = false; this.requested = false; }
        throw error;
      }).finally(() => { if (this.startPromise === promise) this.startPromise = null; });
      this.startPromise = promise;
      return promise;
    } catch (error) {
      this.enabled = false;
      this.requested = false;
      return Promise.reject(error);
    }
  }

  async stop() {
    this.requested = false;
    this.enabled = false;
    this.generation += 1;
    this.startPromise = null;
    this.panic();
    if (this.context?.state === 'running') await this.context.suspend();
  }

  setOutput(value) {
    this.output = clamp(finite(value, this.output), 0, 1);
    if (this.master && this.context) smooth(this.master.gain, this.output, this.context.currentTime);
    return this.output;
  }

  setPatch(value) {
    this.patch = sanitizeEsi32Patch(value);
    return this.patch;
  }

  /** Tone/mix edits stay audible on held notes; sample regions apply on the next attack. */
  updateLivePatch(value) {
    const patch = this.setPatch(value);
    if (!this.context) return patch;
    const time = this.context.currentTime;
    for (const voice of this.voices.values()) {
      if (voice.patch.sampleSlot !== patch.sampleSlot) continue;
      for (const filter of voice.filters) smooth(filter.frequency, Math.min(patch.cutoff, this.context.sampleRate * .45), time);
      smooth(voice.filters[0].Q, .707 + patch.resonance * 7, time);
      smooth(voice.filters[1].Q, .707 + patch.resonance * 1.5, time);
      smooth(voice.panner.pan, patch.pan, time);
      smooth(voice.level.gain, patch.level * voice.velocity * .16, time);
      smooth(voice.lfo.frequency, patch.lfoRate, time);
      smooth(voice.lfoGain.gain, patch.lfoDepth, time);
    }
    return patch;
  }

  setPitchBend(semitones = 0) {
    this.pitchBend = clamp(finite(semitones), -24, 24);
    if (!this.context) return;
    const time = this.context.currentTime;
    for (const voice of this.voices.values()) {
      // Rebase the display cursor before changing its speed; audio remains sample-clock driven.
      voice.traveled += Math.max(0, time - voice.rateAt) * voice.rate;
      voice.rateAt = time;
      voice.rate = samplePlaybackRate(voice.note, voice.patch, this.pitchBend);
      smooth(voice.source.playbackRate, voice.rate, time);
    }
  }

  validateSlot(value) {
    if (!Number.isInteger(value) || value < 0 || value >= ESI32_SLOT_COUNT) throw new RangeError('Choose sample slot 1–8.');
    return value;
  }

  residentBytes(replacementSlot = -1, replacement = null, excludedRegionSlot = -1) {
    const buffers = new Set();
    for (const [slot, buffer] of this.samples) if (slot !== replacementSlot) buffers.add(buffer);
    for (const [slot, record] of this.reverseBuffers) if (slot !== replacementSlot) buffers.add(record.buffer);
    for (const [slot, record] of this.regionBuffers) if (slot !== replacementSlot && slot !== excludedRegionSlot) buffers.add(record.buffer);
    for (const voice of [...this.voices.values(), ...this.retiring]) buffers.add(voice.source.buffer);
    if (replacement) buffers.add(replacement);
    return [...buffers].reduce((sum, buffer) => sum + bytesOf(buffer), 0);
  }

  setSample(slot, buffer) {
    this.validateSlot(slot);
    if (this.disposed) throw new Error('The sampler has been disposed.');
    if (!buffer || typeof buffer.getChannelData !== 'function'
      || !Number.isInteger(buffer.length) || buffer.length < 2
      || ![1, 2].includes(buffer.numberOfChannels)
      || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 8000 || buffer.sampleRate > 192000
      || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > ESI32_MAX_SAMPLE_SECONDS
      || buffer.length / buffer.sampleRate > ESI32_MAX_SAMPLE_SECONDS) {
      throw new RangeError('Use a mono or stereo sample, up to 60 seconds at 8–192 kHz.');
    }
    if (this.residentBytes(slot, buffer) > ESI32_MAX_BUFFER_BYTES) {
      throw new RangeError('The sampler memory limit is 128 MiB. Release held notes or use shorter samples.');
    }
    // User PCM can contain floating-point NaNs or out-of-range values. Sanitize once on admission.
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      if (data.length !== buffer.length) throw new RangeError('Invalid sample channel length.');
      for (let frame = 0; frame < data.length; frame += 1) data[frame] = clamp(finite(data[frame]), -1, 1);
    }
    this.samples.set(slot, buffer);
    this.reverseBuffers.delete(slot);
    this.regionBuffers.delete(slot);
    return buffer;
  }

  restoreDemo(slot) {
    this.validateSlot(slot);
    if (!this.context || this.disposed) throw new Error('Enable Audio before loading a sample.');
    const data = createEsi32DemoData(slot, this.context.sampleRate);
    const buffer = this.context.createBuffer(data.channels.length, data.channels[0].length, data.sampleRate);
    data.channels.forEach((channel, index) => buffer.getChannelData(index).set(channel));
    return this.setSample(slot, buffer);
  }

  async decodeSample(slot, encoded) {
    this.validateSlot(slot);
    if (!this.context || this.context.state === 'closed' || this.disposed) throw new Error('Enable Audio before loading a sample.');
    if (!(encoded instanceof ArrayBuffer) || !encoded.byteLength || encoded.byteLength > ESI32_MAX_FILE_BYTES) {
      throw new RangeError('Choose an audio file no larger than 32 MiB.');
    }
    if (this.decodePromise) throw new Error('A sample is already loading.');
    const context = this.context;
    const decoding = context.decodeAudioData(encoded);
    this.decodePromise = decoding;
    try {
      const buffer = await decoding;
      if (this.disposed || this.context !== context) throw new Error('Sample loading was cancelled.');
      return this.setSample(slot, buffer);
    } finally {
      if (this.decodePromise === decoding) this.decodePromise = null;
    }
  }

  reversedBuffer(slot, original) {
    const cached = this.reverseBuffers.get(slot);
    if (cached?.original === original) return cached.buffer;
    if (this.residentBytes() + bytesOf(original) > ESI32_MAX_BUFFER_BYTES) throw new RangeError('Reverse needs additional sample memory; use a shorter sample.');
    const reversed = this.context.createBuffer(original.numberOfChannels, original.length, original.sampleRate);
    for (let channel = 0; channel < original.numberOfChannels; channel += 1) {
      const source = original.getChannelData(channel);
      const target = reversed.getChannelData(channel);
      for (let index = 0; index < original.length; index += 1) target[index] = source[original.length - 1 - index];
    }
    this.reverseBuffers.set(slot, { original, buffer: reversed });
    return reversed;
  }

  /** Cache one nonlooping cut per slot; the original PCM remains available for edits/export. */
  trimmedBuffer(slot, original, patch) {
    const first = Math.floor(patch.start * original.length);
    const last = Math.min(original.length, Math.max(first + 2, Math.ceil(patch.end * original.length)));
    const cached = this.regionBuffers.get(slot);
    if (cached?.original === original && cached.first === first && cached.last === last && cached.reverse === patch.reverse) return cached.buffer;
    const length = last - first;
    const bytes = length * original.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
    if (this.residentBytes(-1, null, slot) + bytes > ESI32_MAX_BUFFER_BYTES) {
      throw new RangeError('This cut needs additional sample memory; release held notes or use a shorter sample.');
    }
    const buffer = this.context.createBuffer(original.numberOfChannels, length, original.sampleRate);
    const fade = Math.min(Math.floor(length / 4), Math.max(1, Math.round(original.sampleRate * .004)));
    for (let channel = 0; channel < original.numberOfChannels; channel += 1) {
      const source = original.getChannelData(channel);
      const target = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const sourceIndex = patch.reverse ? last - 1 - index : first + index;
        target[index] = source[sourceIndex] * Math.min(1, index / Math.max(1, fade), (length - 1 - index) / Math.max(1, fade));
      }
    }
    this.regionBuffers.set(slot, { original, first, last, reverse: patch.reverse, buffer });
    return buffer;
  }

  noteOn(note = 60, velocity = .8, id = null, patchValue = this.patch) {
    if (!this.enabled || this.disposed || this.context?.state !== 'running') return null;
    const patch = sanitizeEsi32Patch(patchValue);
    const sample = this.samples.get(patch.sampleSlot);
    const strength = clamp(finite(velocity, .8), 0, 1);
    if (!sample || strength === 0) return null;
    const context = this.context;
    const trimmed = patch.loopMode === 'off' && (patch.start > 0 || patch.end < 1);
    // Prepare before stealing so a rejected allocation preserves existing voices.
    const buffer = trimmed ? this.trimmedBuffer(patch.sampleSlot, sample, patch)
      : patch.reverse ? this.reversedBuffer(patch.sampleSlot, sample) : sample;
    const token = id ?? `esi32-${++this.serial}`;
    const cost = sample.numberOfChannels;
    let time = context.currentTime;
    if (this.voices.has(token)) time = Math.max(time, this.retireVoice(this.voices.get(token)));
    while (this.channelCount + cost > ESI32_MAX_VOICES) {
      // Prefer released notes, then the oldest held note. Fades share the audio clock.
      const voices = [...this.voices.values()];
      const victim = voices.find(voice => voice.releasedAt != null) ?? voices[0];
      time = Math.max(time, this.retireVoice(victim));
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const rate = samplePlaybackRate(note, patch, this.pitchBend);
    source.playbackRate.value = rate;
    source.loop = patch.loopMode === 'forward';
    source.loopStart = (patch.reverse ? 1 - patch.loopEnd : patch.loopStart) * sample.duration;
    source.loopEnd = (patch.reverse ? 1 - patch.loopStart : patch.loopEnd) * sample.duration;
    const offset = (patch.reverse ? 1 - patch.end : patch.start) * sample.duration;
    const duration = (patch.end - patch.start) * sample.duration;
    const filters = [context.createBiquadFilter(), context.createBiquadFilter()];
    filters.forEach((filter, index) => {
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(patch.cutoff, context.sampleRate * .45);
      filter.Q.value = .707 + patch.resonance * (index ? 1.5 : 7);
      filter.detune.setValueAtTime(0, time);
      filter.detune.linearRampToValueAtTime(patch.filterEnv * 100, time + patch.attack);
      filter.detune.linearRampToValueAtTime(patch.filterEnv * patch.sustain * 100, time + patch.attack + patch.decay);
    });
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(1, time + patch.attack);
    envelope.gain.linearRampToValueAtTime(patch.sustain, time + patch.attack + patch.decay);
    const level = context.createGain();
    level.gain.value = patch.level * strength * .16;
    const panner = context.createStereoPanner();
    panner.pan.value = patch.pan;
    const lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = patch.lfoRate;
    const lfoGain = context.createGain();
    lfoGain.gain.value = patch.lfoDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(source.detune);
    source.connect(filters[0]); filters[0].connect(filters[1]);
    filters[1].connect(envelope); envelope.connect(level); level.connect(panner); panner.connect(this.input);
    const voice = {
      id: token, note: clamp(finite(note, 60), 0, 127), velocity: strength, patch, cost,
      source, filters, envelope, level, panner, lfo, lfoGain,
      startedAt: time, offset, rate, rateAt: time, traveled: 0,
      sampleDuration: sample.duration, releasedAt: null, cleaned: false,
    };
    this.voices.set(token, voice);
    source.onended = () => this.cleanVoice(voice);
    lfo.start(time);
    if (source.loop) source.start(time, offset);
    else source.start(time, trimmed ? 0 : offset, duration);
    return token;
  }

  noteOff(id) {
    const voice = this.voices.get(id);
    if (!voice || voice.releasedAt != null || !this.context) return false;
    const time = Math.max(this.context.currentTime, voice.startedAt);
    const amount = envelopeAt(voice, time);
    voice.releasedAt = time;
    hold(voice.envelope.gain, time, amount);
    voice.envelope.gain.linearRampToValueAtTime(0, time + voice.patch.release);
    for (const filter of voice.filters) {
      hold(filter.detune, time, amount * voice.patch.filterEnv * 100);
      filter.detune.linearRampToValueAtTime(0, time + voice.patch.release);
    }
    safeStop(voice.source, time + voice.patch.release + .003);
    safeStop(voice.lfo, time + voice.patch.release + .003);
    return true;
  }

  retireVoice(voice) {
    if (!voice || voice.cleaned) return this.context.currentTime;
    const time = this.context.currentTime;
    // Bound both playable channels and the brief 4 ms retirement-node overlap.
    while (this.retiring.size >= ESI32_MAX_VOICES) this.cleanVoice(this.retiring.values().next().value);
    hold(voice.envelope.gain, time, envelopeAt(voice, time));
    voice.envelope.gain.linearRampToValueAtTime(0, time + .004);
    safeStop(voice.source, time + .004);
    safeStop(voice.lfo, time + .004);
    if (this.voices.get(voice.id) === voice) this.voices.delete(voice.id);
    this.retiring.add(voice);
    return time + .004;
  }

  cleanVoice(voice) {
    if (voice.cleaned) return;
    voice.cleaned = true;
    voice.source.onended = null;
    safeStop(voice.source, this.context?.currentTime ?? 0);
    safeStop(voice.lfo, this.context?.currentTime ?? 0);
    [voice.source, ...voice.filters, voice.envelope, voice.level, voice.panner, voice.lfo, voice.lfoGain].forEach(safeDisconnect);
    if (this.voices.get(voice.id) === voice) this.voices.delete(voice.id);
    this.retiring.delete(voice);
  }

  getPlayheads() {
    if (!this.context) return [];
    const time = this.context.currentTime;
    return [...this.voices.values()].map(voice => {
      const patch = voice.patch;
      let position = voice.offset + voice.traveled + Math.max(0, time - voice.rateAt) * voice.rate;
      if (voice.source.loop && position > voice.source.loopEnd) {
        position = voice.source.loopStart + (position - voice.source.loopStart) % (voice.source.loopEnd - voice.source.loopStart);
      }
      position /= voice.sampleDuration;
      if (patch.reverse) position = 1 - position;
      return { id: voice.id, slot: patch.sampleSlot, position: clamp(position, patch.start, patch.end), note: voice.note, released: voice.releasedAt != null };
    });
  }

  panic() {
    for (const voice of [...this.voices.values(), ...this.retiring]) this.cleanVoice(voice);
    this.voices.clear();
    this.retiring.clear();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.requested = false;
    this.generation += 1;
    this.startPromise = null;
    this.panic();
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.graph.forEach(safeDisconnect);
    this.graph = [];
    const context = this.context;
    this.context = null;
    this.master = null;
    this.analyser = null;
    this.input = null;
    this.samples.clear();
    this.reverseBuffers.clear();
    this.regionBuffers.clear();
    if (context && context.state !== 'closed') await context.close();
  }
}

const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stopStreamTracks(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // The browser may already have ended a device track.
    }
  }
}

function microphoneCancelledError() {
  const error = new Error("Microphone recording was cancelled.");
  error.name = "AbortError";
  return error;
}

function releaseRecorderSession(owner, session) {
  clearTimeout(session.timer);
  stopStreamTracks(session.stream);
  session.chunks.length = 0;
  session.recorder.ondataavailable = null;
  session.recorder.onerror = null;
  session.recorder.onstop = null;
  if (owner.session === session) owner.session = null;
}

function disconnectNodes(nodes) {
  for (const node of nodes) {
    try {
      node?.disconnect();
    } catch {
      // A node can already be disconnected when its context is closed.
    }
  }
}

function isAudioBufferLike(buffer) {
  return Boolean(
    buffer
    && Number.isFinite(buffer.duration)
    && buffer.duration > 0
    && typeof buffer.getChannelData === "function",
  );
}

export class MicrophoneRecorder {
  constructor(engine, { maxDurationMs = 8_000, mimeType = "" } = {}) {
    if (!engine || typeof engine.ensureStarted !== "function" || typeof engine.decodeSample !== "function") {
      throw new TypeError("MicrophoneRecorder requires a DrumEngine instance.");
    }
    this.engine = engine;
    this.maxDurationMs = this.normalizeDuration(maxDurationMs);
    this.mimeType = mimeType;
    this.finished = Promise.resolve(null);
    this.session = null;
    this.generation = 0;
    this.pendingGeneration = null;
  }

  get isRecording() {
    return Boolean(this.session?.recorder && this.session.recorder.state !== "inactive");
  }

  normalizeDuration(duration) {
    const numericDuration = Number(duration);
    return Number.isFinite(numericDuration)
      ? clampValue(Math.round(numericDuration), 250, 60_000)
      : 8_000;
  }

  async start({ maxDurationMs = this.maxDurationMs } = {}) {
    if (this.isRecording || this.pendingGeneration !== null) {
      throw new Error("A microphone recording is already in progress.");
    }
    const mediaDevices = globalThis.navigator?.mediaDevices;
    const MediaRecorderClass = globalThis.MediaRecorder;
    if (!mediaDevices?.getUserMedia) throw new Error("Microphone access is not supported in this browser.");
    if (!MediaRecorderClass) throw new Error("Audio recording is not supported in this browser.");

    const generation = this.generation + 1;
    this.generation = generation;
    this.pendingGeneration = generation;
    let stream = null;
    try {
      await this.engine.ensureStarted();
      if (generation !== this.generation) throw microphoneCancelledError();
      stream = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (generation !== this.generation) {
        stopStreamTracks(stream);
        stream = null;
        throw microphoneCancelledError();
      }
    } catch (error) {
      stopStreamTracks(stream);
      if (this.pendingGeneration === generation) this.pendingGeneration = null;
      if (generation !== this.generation && error?.name !== "AbortError") {
        throw microphoneCancelledError();
      }
      throw error;
    }

    let recorder;
    try {
      const supportsMimeType = typeof MediaRecorderClass.isTypeSupported === "function";
      const useMimeType = this.mimeType
        && (!supportsMimeType || MediaRecorderClass.isTypeSupported(this.mimeType));
      recorder = new MediaRecorderClass(stream, useMimeType ? { mimeType: this.mimeType } : undefined);
    } catch (error) {
      stopStreamTracks(stream);
      if (this.pendingGeneration === generation) this.pendingGeneration = null;
      throw error;
    }

    let resolveFinished;
    let rejectFinished;
    const finished = new Promise((resolve, reject) => {
      resolveFinished = resolve;
      rejectFinished = reject;
    });
    // Auto-stop can reject before a consumer awaits `finished`; keep that from
    // becoming an unhandled rejection while preserving rejection for consumers.
    finished.catch(() => {});
    const session = {
      chunks: [],
      finished,
      generation,
      recorder,
      rejectFinished,
      resolveFinished,
      settled: false,
      stream,
      timer: null,
    };
    this.session = session;
    this.finished = finished;
    if (this.pendingGeneration === generation) this.pendingGeneration = null;

    recorder.ondataavailable = (event) => {
      if (event.data?.size) session.chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      stopStreamTracks(stream);
      if (session.settled) return;
      session.settled = true;
      session.rejectFinished(event.error ?? new Error("Microphone recording failed."));
      releaseRecorderSession(this, session);
    };
    recorder.onstop = async () => {
      stopStreamTracks(stream);
      clearTimeout(session.timer);
      if (session.settled) return;
      try {
        const blob = new Blob(session.chunks, { type: recorder.mimeType || this.mimeType || "audio/webm" });
        if (!blob.size) throw new Error("The microphone recording was empty.");
        const buffer = await this.engine.decodeSample(await blob.arrayBuffer(), { store: true });
        session.settled = true;
        session.resolveFinished(buffer);
      } catch (error) {
        session.settled = true;
        session.rejectFinished(error);
      } finally {
        releaseRecorderSession(this, session);
      }
    };

    try {
      recorder.start();
    } catch (error) {
      session.settled = true;
      session.resolveFinished(null);
      releaseRecorderSession(this, session);
      throw error;
    }

    session.timer = setTimeout(() => {
      this.stop().catch(() => {});
    }, this.normalizeDuration(maxDurationMs));
    return this;
  }

  stop() {
    const session = this.session;
    if (!session) return this.finished;
    clearTimeout(session.timer);
    if (session.recorder.state !== "inactive") {
      try {
        session.recorder.stop();
      } catch (error) {
        if (!session.settled) {
          session.settled = true;
          session.rejectFinished(error);
          releaseRecorderSession(this, session);
        }
      }
    }
    stopStreamTracks(session.stream);
    return session.finished;
  }

  cancel() {
    this.generation += 1;
    this.pendingGeneration = null;
    const session = this.session;
    if (!session) return Promise.resolve(null);
    clearTimeout(session.timer);
    session.recorder.ondataavailable = null;
    session.recorder.onerror = null;
    session.recorder.onstop = null;
    if (session.recorder.state !== "inactive") {
      try {
        session.recorder.stop();
      } catch {
        // Track shutdown below is sufficient if the recorder already ended.
      }
    }
    if (!session.settled) {
      session.settled = true;
      session.resolveFinished(null);
    }
    releaseRecorderSession(this, session);
    return session.finished;
  }
}

export class DrumEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.sampleBuffer = null;
    this.gestureVoices = new Map();
    this.gestureVoiceStartTokens = new Map();
    this.muted = false;
    this.volume = 0.72;
  }

  async ensureStarted() {
    if (!AudioContextClass) throw new Error("Web Audio is not supported in this browser.");
    if (!this.context) this.createGraph();
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  createGraph() {
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    this.master.gain.value = this.volume;
    this.master.connect(compressor).connect(this.context.destination);
    this.noiseBuffer = this.makeNoiseBuffer(1);
  }

  makeNoiseBuffer(seconds) {
    const length = Math.floor(this.context.sampleRate * seconds);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) samples[index] = Math.random() * 2 - 1;
    return buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.015);
    }
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.context && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.015);
    }
  }

  get hasSample() {
    return isAudioBufferLike(this.sampleBuffer);
  }

  setSampleBuffer(buffer) {
    if (!isAudioBufferLike(buffer)) throw new TypeError("A decoded AudioBuffer is required.");
    this.sampleBuffer = buffer;
    return buffer;
  }

  clearSample() {
    this.sampleBuffer = null;
  }

  async decodeSample(audioData, { store = true } = {}) {
    const context = await this.ensureStarted();
    let encoded;
    if (audioData instanceof ArrayBuffer) {
      encoded = audioData.slice(0);
    } else if (ArrayBuffer.isView(audioData)) {
      encoded = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength);
    } else if (audioData && typeof audioData.arrayBuffer === "function") {
      encoded = await audioData.arrayBuffer();
    } else {
      throw new TypeError("Encoded audio data must be an ArrayBuffer, typed array, or Blob.");
    }
    if (!encoded.byteLength) throw new Error("The recorded audio was empty.");
    const buffer = await context.decodeAudioData(encoded);
    if (store) this.setSampleBuffer(buffer);
    return buffer;
  }

  async close() {
    this.stopAllGesturePads({ release: 0 });
    if (!this.context) return;
    const context = this.context;
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    if (context.state !== "closed") await context.close();
  }

  async trigger(instrument, velocity = 0.8) {
    await this.ensureStarted();
    const amount = Math.max(0.15, Math.min(1, velocity));
    if (instrument === "sample") return this.playSample(amount);
    if (instrument === "kick") this.kick(amount);
    if (instrument === "snare") this.snare(amount);
    if (instrument === "hat") this.hat(amount);
    if (instrument === "clap") this.clap(amount);
    return null;
  }

  async playSample(velocity = 0.8, { playbackRate = 1, pan = 0 } = {}) {
    await this.ensureStarted();
    if (!this.hasSample) throw new Error("Record a microphone sample before playing this pad.");
    const now = this.context.currentTime + 0.004;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    source.buffer = this.sampleBuffer;
    source.playbackRate.setValueAtTime(clampValue(Number(playbackRate) || 1, 0.25, 4), now);
    gain.gain.setValueAtTime(clampValue(Number(velocity) || 0.8, 0.05, 1), now);
    source.connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(clampValue(Number(pan) || 0, -1, 1), now);
      gain.connect(panner).connect(this.master);
    } else {
      gain.connect(this.master);
    }
    source.start(now);
    source.onended = () => disconnectNodes([source, gain, panner]);
    return source;
  }

  async pluckString(stringIndex, frequency, velocity = 0.8, attackPosition = 0.5) {
    await this.ensureStarted();
    const index = Math.max(0, Math.floor(Number(stringIndex) || 0));
    const pitch = clampValue(Number(frequency) || 110, 35, 2_400);
    const amount = clampValue(Number(velocity) || 0.8, 0.05, 1);
    const position = clampValue(Number(attackPosition) || 0, 0, 1);
    const sampleRate = this.context.sampleRate;
    const delayLength = Math.max(2, Math.round(sampleRate / pitch));
    const duration = clampValue(2.7 - pitch / 1_800 + (index % 4) * 0.04, 1.15, 2.8);
    const buffer = this.context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
    const samples = buffer.getChannelData(0);
    const excitation = new Float32Array(delayLength);
    for (let sample = 0; sample < delayLength; sample += 1) excitation[sample] = Math.random() * 2 - 1;

    // A virtual pickup comb gives different harmonic notches depending on where
    // the gesture crossed the string.
    const pickupOffset = clampValue(Math.round(delayLength * (0.08 + position * 0.84)), 1, delayLength - 1);
    for (let sample = 0; sample < delayLength && sample < samples.length; sample += 1) {
      const reflected = excitation[(sample + pickupOffset) % delayLength];
      samples[sample] = (excitation[sample] - reflected * 0.72) * 0.62;
    }
    const damping = clampValue(0.994 + pitch / 500_000 - (index % 3) * 0.00025, 0.992, 0.9985);
    for (let sample = delayLength; sample < samples.length; sample += 1) {
      samples[sample] = damping * 0.5
        * (samples[sample - delayLength] + samples[sample - delayLength + 1]);
    }

    const source = this.context.createBufferSource();
    const tone = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    const now = this.context.currentTime + 0.003 + position * 0.014 + Math.min(index, 24) * 0.0007;
    source.buffer = buffer;
    tone.type = "lowpass";
    tone.frequency.setValueAtTime(1_700 + (1 - position) * 6_200, now);
    tone.Q.setValueAtTime(0.35 + position * 0.8, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.52 * amount, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(tone).connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(position * 1.8 - 0.9, now);
      gain.connect(panner).connect(this.master);
    } else {
      gain.connect(this.master);
    }
    source.start(now);
    source.onended = () => disconnectNodes([source, tone, gain, panner]);
    return source;
  }

  async startGesturePad(
    voiceId,
    { x = 0.5, y = 0.5, velocity = 0.8, baseFrequency = 110 } = {},
  ) {
    const startToken = Symbol("gesture-pad-start");
    this.gestureVoiceStartTokens.set(voiceId, startToken);
    let context;
    try {
      context = await this.ensureStarted();
    } catch (error) {
      if (this.gestureVoiceStartTokens.get(voiceId) === startToken) {
        this.gestureVoiceStartTokens.delete(voiceId);
      }
      throw error;
    }
    if (
      this.gestureVoiceStartTokens.get(voiceId) !== startToken
      || context !== this.context
    ) {
      return null;
    }
    this.gestureVoiceStartTokens.delete(voiceId);
    if (this.gestureVoices.has(voiceId)) this.stopGesturePad(voiceId, { release: 0.025 });
    const now = this.context.currentTime + 0.003;
    const fundamental = this.context.createOscillator();
    const harmonic = this.context.createOscillator();
    const fundamentalGain = this.context.createGain();
    const harmonicGain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const output = this.context.createGain();
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    fundamental.type = "triangle";
    harmonic.type = "sawtooth";
    filter.type = "lowpass";
    filter.Q.value = 1.6;
    fundamental.connect(fundamentalGain).connect(filter);
    harmonic.connect(harmonicGain).connect(filter);
    filter.connect(output);
    if (panner) output.connect(panner).connect(this.master);
    else output.connect(this.master);

    const voice = {
      baseFrequency: clampValue(Number(baseFrequency) || 110, 35, 1_600),
      filter,
      fundamental,
      fundamentalGain,
      harmonic,
      harmonicGain,
      nodes: [fundamental, harmonic, fundamentalGain, harmonicGain, filter, output, panner],
      output,
      panner,
      velocity: clampValue(Number(velocity) || 0.8, 0.05, 1),
      x: clampValue(Number(x) || 0, 0, 1),
      y: clampValue(Number(y) || 0, 0, 1),
    };
    this.applyGesturePadPosition(voice, { immediate: true, now });
    const targetLevel = voice.targetLevel;
    output.gain.cancelScheduledValues(now);
    output.gain.setValueAtTime(0.0001, now);
    output.gain.linearRampToValueAtTime(targetLevel, now + 0.026);
    fundamental.start(now);
    harmonic.start(now);
    fundamental.onended = () => disconnectNodes(voice.nodes);
    this.gestureVoices.set(voiceId, voice);
    return voiceId;
  }

  updateGesturePad(voiceId, { x, y, velocity, baseFrequency } = {}) {
    const voice = this.gestureVoices.get(voiceId);
    if (!voice || !this.context) return false;
    if (Number.isFinite(x)) voice.x = clampValue(x, 0, 1);
    if (Number.isFinite(y)) voice.y = clampValue(y, 0, 1);
    if (Number.isFinite(velocity)) voice.velocity = clampValue(velocity, 0.05, 1);
    if (Number.isFinite(baseFrequency)) voice.baseFrequency = clampValue(baseFrequency, 35, 1_600);
    this.applyGesturePadPosition(voice, { now: this.context.currentTime });
    return true;
  }

  applyGesturePadPosition(voice, { immediate = false, now = this.context.currentTime } = {}) {
    const frequency = voice.baseFrequency * 2 ** ((voice.x - 0.5) * 10 / 12);
    const cutoff = 420 + (1 - voice.y) ** 2 * 7_200;
    const harmonicLevel = 0.025 + (1 - voice.y) * 0.19;
    const fundamentalLevel = 0.56 - (1 - voice.y) * 0.12;
    voice.targetLevel = 0.08 + voice.velocity * 0.2;
    const setParameter = (parameter, value) => {
      parameter.cancelScheduledValues(now);
      if (immediate) parameter.setValueAtTime(value, now);
      else parameter.setTargetAtTime(value, now, 0.022);
    };
    setParameter(voice.fundamental.frequency, frequency);
    setParameter(voice.harmonic.frequency, frequency * 2.005);
    setParameter(voice.fundamentalGain.gain, fundamentalLevel);
    setParameter(voice.harmonicGain.gain, harmonicLevel);
    setParameter(voice.filter.frequency, cutoff);
    setParameter(voice.output.gain, voice.targetLevel);
    if (voice.panner) setParameter(voice.panner.pan, voice.x * 1.8 - 0.9);
  }

  stopGesturePad(voiceId, { release = 0.18 } = {}) {
    const cancelledPendingStart = this.gestureVoiceStartTokens.delete(voiceId);
    const voice = this.gestureVoices.get(voiceId);
    if (!voice || !this.context) return cancelledPendingStart;
    this.gestureVoices.delete(voiceId);
    const now = this.context.currentTime;
    const releaseTime = clampValue(Number(release) || 0, 0, 2);
    const stopAt = now + Math.max(0.006, releaseTime);
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setValueAtTime(Math.max(0.0001, voice.output.gain.value), now);
    voice.output.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    for (const oscillator of [voice.fundamental, voice.harmonic]) oscillator.stop(stopAt + 0.02);
    return true;
  }

  stopAllGesturePads({ release = 0.06 } = {}) {
    this.gestureVoiceStartTokens.clear();
    for (const voiceId of [...this.gestureVoices.keys()]) {
      this.stopGesturePad(voiceId, { release });
    }
  }

  kick(velocity) {
    const now = this.context.currentTime + 0.004;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(155, now);
    oscillator.frequency.exponentialRampToValueAtTime(45, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.92 * velocity, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.44);
    oscillator.onended = () => oscillator.disconnect();
  }

  snare(velocity) {
    const now = this.context.currentTime + 0.004;
    const noise = this.context.createBufferSource();
    const noiseFilter = this.context.createBiquadFilter();
    const noiseGain = this.context.createGain();
    noise.buffer = this.noiseBuffer;
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 1_250;
    noiseGain.gain.setValueAtTime(0.7 * velocity, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    noise.connect(noiseFilter).connect(noiseGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.21);

    const body = this.context.createOscillator();
    const bodyGain = this.context.createGain();
    body.type = "triangle";
    body.frequency.setValueAtTime(190, now);
    body.frequency.exponentialRampToValueAtTime(125, now + 0.09);
    bodyGain.gain.setValueAtTime(0.4 * velocity, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    body.connect(bodyGain).connect(this.master);
    body.start(now);
    body.stop(now + 0.14);
  }

  hat(velocity) {
    const now = this.context.currentTime + 0.004;
    const noise = this.context.createBufferSource();
    const highpass = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    noise.buffer = this.noiseBuffer;
    highpass.type = "highpass";
    highpass.frequency.value = 7_000;
    highpass.Q.value = 0.6;
    gain.gain.setValueAtTime(0.32 * velocity, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    noise.connect(highpass).connect(gain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.075);
  }

  clap(velocity) {
    const now = this.context.currentTime + 0.004;
    const noise = this.context.createBufferSource();
    const bandpass = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    noise.buffer = this.noiseBuffer;
    bandpass.type = "bandpass";
    bandpass.frequency.value = 1_450;
    bandpass.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, now);
    for (const offset of [0, 0.028, 0.055]) {
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.linearRampToValueAtTime(0.58 * velocity, now + offset + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.04, now + offset + 0.019);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    noise.connect(bandpass).connect(gain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.27);
  }
}

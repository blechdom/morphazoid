import { connectAudioOutput } from '../../audio-output-manager.js';
import { resumeAudioContext } from '../../audio-startup.js';

export const MAX_PREVIEW_VOICES = 16;
export const MAX_PREVIEW_SECONDS = 15;
export const PREVIEW_PEAK_CEILING = 0.98;
const MAX_CACHED_FRAMES = 8 * 1024 * 1024;
const FADE_SECONDS = 0.012;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high, fallback = low) => Math.min(high, Math.max(low, finite(value, fallback)));
const disconnect = node => { try { node?.disconnect(); } catch { /* Already detached. */ } };

/** Select a key that a zone can actually play at the requested MIDI velocity. */
export function chooseAuditionNote(preset, velocity = 95) {
  const byte = Math.round(clamp(velocity, 0, 127, 95));
  if (!byte) return null;
  for (const zone of preset?.zones ?? []) {
    if (byte < (zone.lowVelocity ?? 0) || byte > (zone.highVelocity ?? 127)) continue;
    const low = Math.ceil(clamp(zone.lowKey, 0, 127));
    const high = Math.floor(clamp(zone.highKey, 0, 127, 127));
    if (low > high) continue;
    return Math.round(clamp(zone.rootKey, low, high, 60));
  }
  return null;
}

/** A deliberately small PCM SoundFont audition engine, armed only by Audio. */
export class SoundFontPreview {
  constructor() {
    this.context = null;
    this.analyser = null;
    this.master = null;
    this.compressor = null;
    this.peakGuard = null;
    this.font = null;
    this.presetIndex = 0;
    this.volume = 0.6;
    this.voices = new Set();
    this.buffers = new Map();
    this.cachedFrames = 0;
    this._enabled = false;
    this.disposed = false;
    this.armSerial = 0;
    this.releaseOutput = null;
  }

  get enabled() { return this._enabled && this.context?.state === 'running'; }

  async setEnabled(enabled) {
    const serial = ++this.armSerial;
    if (this.disposed) return false;
    if (!enabled) {
      this._enabled = false;
      this.stopAll();
      this.updateVolume();
      return false;
    }
    if (this.context?.state === 'closed') {
      for (const voice of this.voices) this.removeVoice(voice);
      this.releaseOutput?.();
      disconnect(this.master);
      disconnect(this.analyser);
      disconnect(this.compressor);
      disconnect(this.peakGuard);
      this.buffers.clear();
      this.cachedFrames = 0;
      this.context = this.master = this.analyser = null;
      this.compressor = this.peakGuard = null;
    }
    if (!this.context) {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) throw new Error('This browser does not support Web Audio.');
      // Creation and resume happen synchronously inside the explicit Audio gesture.
      this.context = new Context();
      try {
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        // Keep single notes at a useful level instead of reserving 26 dB for
        // sixteen perfectly correlated voices. Compression handles dense chords;
        // the non-oversampled guard also bounds compressor attack transients.
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -8;
        this.compressor.knee.value = 6;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.002;
        this.compressor.release.value = 0.08;
        this.peakGuard = this.context.createWaveShaper();
        this.peakGuard.curve = new Float32Array([-PREVIEW_PEAK_CEILING, PREVIEW_PEAK_CEILING]);
        this.compressor.connect(this.peakGuard);
        this.peakGuard.connect(this.master);
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 1024;
        this.master.connect(this.analyser);
        this.releaseOutput = connectAudioOutput(this.context, this.master);
      } catch (error) {
        this.releaseOutput?.();
        disconnect(this.master);
        disconnect(this.analyser);
        disconnect(this.compressor);
        disconnect(this.peakGuard);
        void this.context.close().catch(() => {});
        this.context = this.master = this.analyser = null;
        this.compressor = this.peakGuard = null;
        throw error;
      }
    }
    try {
      await resumeAudioContext(this.context);
    } catch (error) {
      if (serial === this.armSerial) {
        this._enabled = false;
        this.stopAll();
        this.updateVolume();
      }
      throw error;
    }
    if (this.disposed || serial !== this.armSerial) return this._enabled;
    this._enabled = true;
    this.updateVolume();
    return true;
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1, this.volume);
    this.updateVolume();
  }

  updateVolume() {
    if (!this.master || this.context?.state === 'closed') return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this._enabled ? this.volume : 0, now, 0.005);
  }

  setFont(font) {
    this.stopAll();
    this.buffers.clear();
    this.cachedFrames = 0;
    this.font = font;
    this.presetIndex = 0;
  }

  setPreset(index) {
    const next = Math.round(clamp(index, 0, Math.max(0, (this.font?.presets?.length ?? 0) - 1)));
    // Existing notes retain their timbre and release normally after selection.
    this.presetIndex = next;
    return next;
  }

  sampleBuffer(index) {
    if (this.buffers.has(index)) {
      const buffer = this.buffers.get(index);
      this.buffers.delete(index);
      this.buffers.set(index, buffer);
      return buffer;
    }
    const sample = this.font?.samples?.[index];
    if (!(sample?.data instanceof Float32Array) || !sample.data.length) return null;
    const buffer = this.context.createBuffer(1, sample.data.length, clamp(sample.sampleRate, 8000, 192000, 44100));
    const target = buffer.getChannelData(0);
    // Parsed PCM is normally finite and in range. Sanitize generated input too;
    // the shared compressor and peak guard bound the combined output.
    for (let i = 0; i < target.length; i += 1) target[i] = clamp(sample.data[i], -1, 1, 0);
    while (this.buffers.size && this.cachedFrames + buffer.length > MAX_CACHED_FRAMES) {
      const key = this.buffers.keys().next().value;
      this.cachedFrames -= this.buffers.get(key).length;
      this.buffers.delete(key);
    }
    if (buffer.length <= MAX_CACHED_FRAMES) {
      this.buffers.set(index, buffer);
      this.cachedFrames += buffer.length;
    }
    return buffer;
  }

  noteOn(note, velocity = 0.75) {
    if (!this._enabled || this.disposed || this.context?.state !== 'running') return null;
    if (!Number.isInteger(note) || note < 0 || note > 127) return null;
    const strength = clamp(velocity, 0, 1, 0.75);
    if (!strength) { this.noteOff(note); return null; }
    const velocityByte = Math.max(1, Math.round(strength * 127));
    const zones = this.font?.presets?.[this.presetIndex]?.zones ?? [];
    let started = false;
    for (const zone of zones) {
      // Released voices remain counted until their tail has actually ended.
      // At capacity, skip attacks instead of cutting tails or growing the graph.
      if (this.voices.size >= MAX_PREVIEW_VOICES) break;
      if (note < (zone.lowKey ?? 0) || note > (zone.highKey ?? 127)
        || velocityByte < (zone.lowVelocity ?? 0) || velocityByte > (zone.highVelocity ?? 127)) continue;
      const buffer = this.sampleBuffer(zone.sampleIndex);
      if (!buffer) continue;
      const now = this.context.currentTime;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      const pan = this.context.createStereoPanner();
      const level = strength * 10 ** (-clamp(zone.attenuation, 0, 144) / 20);
      const rate = clamp(2 ** ((note - clamp(zone.rootKey, 0, 127, 60) + clamp(zone.tune, -12000, 12000, 0) / 100) / 12), 1 / 256, 256);
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const loopStart = clamp(zone.loopStart, 0, buffer.length);
      const loopEnd = clamp(zone.loopEnd, 0, buffer.length);
      source.loop = Boolean(zone.loop) && loopEnd - loopStart >= 2;
      if (source.loop) {
        source.loopStart = loopStart / buffer.sampleRate;
        source.loopEnd = loopEnd / buffer.sampleRate;
      }
      const duration = source.loop ? MAX_PREVIEW_SECONDS : Math.min(MAX_PREVIEW_SECONDS, buffer.duration / rate);
      const end = now + duration;
      const fade = Math.min(FADE_SECONDS, duration / 2);
      const attack = Math.min(clamp(zone.attack, 0.003, 5, 0.005), duration / 2);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + attack);
      gain.gain.setValueAtTime(level, end - fade);
      gain.gain.linearRampToValueAtTime(0, end);
      pan.pan.value = clamp(zone.pan, -1, 1, 0);
      source.connect(gain);
      gain.connect(pan);
      pan.connect(this.compressor);
      const voice = { note, source, gain, pan, level, attack, fade, start: now, end,
        release: clamp(zone.release, FADE_SECONDS, MAX_PREVIEW_SECONDS, 0.2), releasedAt: null };
      this.voices.add(voice);
      source.onended = () => this.removeVoice(voice);
      source.start(now);
      source.stop(end);
      started = true;
    }
    return started ? note : null;
  }

  releaseVoice(voice, seconds) {
    const now = this.context.currentTime;
    let level;
    if (voice.releasedAt !== null) {
      if (voice.end <= now) { this.removeVoice(voice); return; }
      level = voice.releaseLevel * Math.max(0, 1 - (now - voice.releasedAt) / (voice.end - voice.releasedAt));
    } else {
      level = voice.level * Math.min(1, Math.max(0, (now - voice.start) / voice.attack));
      if (now > voice.end - voice.fade) level *= Math.max(0, (voice.end - now) / voice.fade);
    }
    const end = Math.min(voice.end, now + seconds);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(level, now);
    voice.gain.gain.linearRampToValueAtTime(0, Math.max(now, end));
    voice.releasedAt = now;
    voice.releaseLevel = level;
    voice.end = end;
    voice.source.stop(Math.max(now, end));
  }

  noteOff(note) {
    if (!this.context || this.disposed) return;
    for (const voice of this.voices) {
      if (voice.note === note && voice.releasedAt === null) this.releaseVoice(voice, voice.release);
    }
  }

  stopAll() {
    if (!this.context || this.context.state === 'closed') return;
    for (const voice of this.voices) this.releaseVoice(voice, FADE_SECONDS);
  }

  removeVoice(voice) {
    voice.source.onended = null;
    disconnect(voice.source);
    disconnect(voice.gain);
    disconnect(voice.pan);
    this.voices.delete(voice);
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._enabled = false;
    ++this.armSerial;
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch { /* Already stopped. */ }
      this.removeVoice(voice);
    }
    this.releaseOutput?.();
    this.releaseOutput = null;
    disconnect(this.master);
    disconnect(this.analyser);
    disconnect(this.compressor);
    disconnect(this.peakGuard);
    this.buffers.clear();
    this.cachedFrames = 0;
    this.font = null;
    const context = this.context;
    this.context = this.master = this.analyser = null;
    this.compressor = this.peakGuard = null;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
}

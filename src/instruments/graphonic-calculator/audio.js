import { connectAudioOutput } from "../../audio-output-manager.js";
import { unlockAudioContext } from "../../audio.js";
import { resumeAudioContext } from "../../audio-startup.js";
import { pitchValue } from "./readers.js";

export const TRACE_VOICES = 12;
export const TRACE_BASE_HZ = 220;
export const TRACE_SMOOTHING = 0.03;
export const TRACE_LEVEL = 0.4;
export const VOICES = Object.freeze(["sine", "triangle", "reed", "saw", "pulse", "fm"]);
export const GLIDE = Object.freeze({ min: 0.005, max: 0.5, default: 0.03 });
const WAVE_HARMONICS = 24;

/** Fourier coefficients for the band-limited custom voices; `timbre` shapes brightness or pulse width. */
export function periodicWaveCoefficients(voice, timbre) {
  const real = new Float32Array(WAVE_HARMONICS + 1);
  const imag = new Float32Array(WAVE_HARMONICS + 1);
  const t = Math.min(1, Math.max(0, timbre));
  if (voice === "reed") {
    imag[1] = 1; imag[3] = 0.25 + 0.5 * t; real[2] = 0.15 * t; imag[5] = 0.1 * t;
  } else if (voice === "saw") {
    const rolloff = 2.2 - 1.4 * t;
    for (let n = 1; n <= WAVE_HARMONICS; n++) imag[n] = ((n % 2 ? 1 : -1) * 2) / (Math.PI * n ** rolloff);
  } else if (voice === "pulse") {
    const width = 0.05 + 0.45 * t;
    for (let n = 1; n <= WAVE_HARMONICS; n++) real[n] = (2 / (Math.PI * n)) * Math.sin(Math.PI * n * width);
  }
  return { real, imag };
}

/**
 * Map one contact to a voice target. The chosen source (height, width or radius, measured over
 * the view) becomes pitch across `octaves`; horizontal position becomes stereo placement.
 * Contacts outside the view fall silent.
 */
export function traceVoiceTarget({ x, y, view, center, octaves = 2, source = "height" }) {
  const silent = { frequency: TRACE_BASE_HZ, pan: 0, gain: 0 };
  const ySpan = view.yMax - view.yMin, xSpan = view.xMax - view.xMin;
  if (!Number.isFinite(x) || !Number.isFinite(y) || ySpan <= 0 || xSpan <= 0) return silent;
  if (x < view.xMin || x > view.xMax || y < view.yMin || y > view.yMax) return silent;
  const value = Math.min(1, Math.max(0, pitchValue({ x, y }, source, view, center)));
  const position = (x - view.xMin) / xSpan;
  return { frequency: TRACE_BASE_HZ * 2 ** (octaves * value), pan: position * 2 - 1, gain: 1 };
}

/** Turn reader contacts into at most `limit` audible voice targets, keyed per curve, head and branch. */
export function traceVoiceTargets(contacts, { view, center, octaves, source = "height", limit = TRACE_VOICES }) {
  const counts = new Map();
  const targets = [];
  for (const contact of contacts) {
    const key = `${contact.id}:${contact.head ?? 0}:${contact.branch ?? "p"}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    targets.push({ id: `${key}:${index}`, voice: VOICES.includes(contact.voice) ? contact.voice : null, ...traceVoiceTarget({ x: contact.x, y: contact.y, view, center, octaves, source }) });
  }
  const audible = targets.filter((target) => target.gain > 0).slice(0, limit);
  const normalization = audible.length ? TRACE_LEVEL / Math.sqrt(audible.length) : 0;
  return audible.map((target) => ({ ...target, gain: target.gain * normalization }));
}

export class TraceAudio {
  constructor({ onError } = {}) {
    this.onError = onError;
    this.context = null;
    this.master = null;
    this.voices = [];
    this.release = null;
    this.level = 0.5;
    this.starting = null;
    this.destroyed = false;
    this.timbreSettings = { voice: "sine", timbre: 0.5, glide: GLIDE.default };
    this.waveCache = new Map();
  }

  get armed() { return Boolean(this.context) && this.context.state !== "closed"; }

  get currentTime() { return this.context ? this.context.currentTime : null; }

  async start() {
    if (this.destroyed) throw new Error("Instrument closed.");
    if (this.starting) return this.starting;
    if (this.context) return resumeAudioContext(this.context);
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) throw new Error("Web Audio is not available in this browser.");
    const context = new Context({ latencyHint: "interactive" });
    this.context = context;
    unlockAudioContext(context);
    const pending = (async () => {
      try {
        await resumeAudioContext(context);
        if (this.context !== context) throw new Error("Audio startup cancelled.");
        this.master = context.createGain();
        this.master.gain.value = this.level;
        this.voices = Array.from({ length: TRACE_VOICES }, () => this.createVoice(context));
        this.release = connectAudioOutput(context, this.master);
      } catch (error) {
        if (this.context === context) await this.stop();
        else await context.close().catch(() => {});
        throw error;
      }
    })();
    this.starting = pending;
    try { await pending; } finally { if (this.starting === pending) this.starting = null; }
  }

  createVoice(context) {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = TRACE_BASE_HZ;
    const modulator = context.createOscillator();
    modulator.frequency.value = TRACE_BASE_HZ * 2;
    const modulation = context.createGain();
    modulation.gain.value = 0;
    modulator.connect(modulation);
    modulation.connect(oscillator.frequency);
    const gain = context.createGain();
    gain.gain.value = 0;
    const panner = context.createStereoPanner ? context.createStereoPanner() : null;
    oscillator.connect(gain);
    if (panner) { gain.connect(panner); panner.connect(this.master); } else gain.connect(this.master);
    oscillator.start();
    modulator.start();
    const voice = { oscillator, modulator, modulation, gain, panner, id: null, frequency: TRACE_BASE_HZ, voiceType: null, applied: null };
    this.applyTimbre(voice);
    return voice;
  }

  /** Voice type, brightness and glide are shared by the whole bank and may change while sounding. */
  setTimbre({ voice, timbre, glide }) {
    const next = { voice: VOICES.includes(voice) ? voice : "sine", timbre: Math.min(1, Math.max(0, Number(timbre) || 0)), glide: Math.min(GLIDE.max, Math.max(GLIDE.min, Number(glide) || GLIDE.default)) };
    const changed = next.voice !== this.timbreSettings.voice || next.timbre !== this.timbreSettings.timbre;
    this.timbreSettings = next;
    if (changed) for (const entry of this.voices) this.applyTimbre(entry);
  }

  applyTimbre(entry) {
    const { timbre } = this.timbreSettings;
    const voice = entry.voiceType ?? this.timbreSettings.voice;
    const context = this.context;
    if (!context) return;
    const signature = `${voice}:${timbre.toFixed(2)}`;
    if (entry.applied === signature) { this.steerModulation(entry, context.currentTime); return; }
    entry.applied = signature;
    if (voice === "sine" || voice === "fm") entry.oscillator.type = "sine";
    else if (voice === "triangle") entry.oscillator.type = "triangle";
    else {
      const key = `${voice}:${timbre.toFixed(2)}`;
      if (!this.waveCache.has(key)) { const { real, imag } = periodicWaveCoefficients(voice, timbre); this.waveCache.set(key, context.createPeriodicWave(real, imag, { disableNormalization: false })); }
      entry.oscillator.setPeriodicWave(this.waveCache.get(key));
    }
    this.steerModulation(entry, context.currentTime);
  }

  steerModulation(entry, now) {
    const { timbre, glide } = this.timbreSettings;
    const voice = entry.voiceType ?? this.timbreSettings.voice;
    const index = voice === "fm" ? 0.5 + 6 * timbre : 0;
    entry.modulator.frequency.setTargetAtTime(entry.frequency * 2, now, glide);
    entry.modulation.gain.setTargetAtTime(index * entry.frequency, now, glide);
  }

  setLevel(value) {
    this.level = Math.min(1, Math.max(0, Number(value) || 0));
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.level, this.context.currentTime, 0.02);
  }

  /** Steer the voice bank toward the current trace targets; unused voices glide to silence. */
  update(targets) {
    if (!this.context || !this.voices.length) return;
    const now = this.context.currentTime;
    const remaining = [...targets];
    const assigned = new Set();
    for (const voice of this.voices) {
      const index = remaining.findIndex((target) => target.id === voice.id);
      if (index >= 0) { this.steer(voice, remaining.splice(index, 1)[0], now); assigned.add(voice); }
    }
    for (const voice of this.voices) {
      if (assigned.has(voice)) continue;
      const target = remaining.shift();
      if (target) { voice.id = target.id; this.steer(voice, target, now, true); } else { voice.id = null; voice.gain.gain.setTargetAtTime(0, now, this.timbreSettings.glide); }
    }
  }

  steer(voice, target, now, fresh = false) {
    const { glide } = this.timbreSettings;
    const frequency = Math.min(12000, Math.max(20, target.frequency));
    voice.frequency = frequency;
    if ((target.voice ?? null) !== voice.voiceType) { voice.voiceType = target.voice ?? null; this.applyTimbre(voice); }
    if (fresh) voice.oscillator.frequency.setValueAtTime(frequency, now);
    else voice.oscillator.frequency.setTargetAtTime(frequency, now, glide);
    this.steerModulation(voice, now);
    voice.gain.gain.setTargetAtTime(target.gain, now, glide);
    voice.panner?.pan.setTargetAtTime(target.pan, now, glide);
  }

  silence() {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) { voice.id = null; voice.gain.gain.setTargetAtTime(0, now, this.timbreSettings.glide); }
  }

  async stop() {
    const { context, master, voices, release } = this;
    this.context = null; this.master = null; this.voices = []; this.release = null;
    if (master && context?.state === "running") {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setTargetAtTime(0, context.currentTime, 0.01);
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    for (const voice of voices) {
      try { voice.oscillator.stop(); voice.modulator.stop(); voice.oscillator.disconnect(); voice.modulator.disconnect(); voice.modulation.disconnect(); voice.gain.disconnect(); voice.panner?.disconnect(); } catch { /* already released */ }
    }
    this.waveCache.clear();
    try { master?.disconnect(); } catch { /* already released */ }
    release?.();
    if (context && context.state !== "closed") await context.close().catch(() => {});
  }

  async destroy() {
    this.destroyed = true;
    await this.stop();
  }
}

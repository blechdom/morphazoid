import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const NOISE_BUFFER_SECONDS = 2.5;

function cancelledAudioStart() {
  const error = new Error("FM Drum audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

const VOICES = [
  ["sub-kick", "Sub Kick", "1", "kick", "#ff8a61", 48, .002, .62, 1, 4.8, 2.6, .02, .34, .92],
  ["fm-kick", "FM Kick", "2", "kick", "#ffad69", 63, .001, .34, 1.5, 7.2, 3.8, .03, .55, .86],
  ["snap-snare", "Snap Snare", "3", "snare", "#ff7aa6", 176, .002, .28, 1.82, 6.4, 1.1, .68, .62, .74],
  ["wide-clap", "Wide Clap", "4", "snare", "#de75b8", 238, .006, .19, 2.7, 3.1, .35, .92, .76, .68],
  ["low-tom", "Low Tom", "q", "tom", "#e8c46b", 82, .003, .52, 1.37, 4.4, 1.6, .04, .43, .82],
  ["mid-tom", "Mid Tom", "w", "tom", "#dbd86b", 124, .003, .42, 1.41, 5.1, 1.35, .035, .51, .78],
  ["high-tom", "High Tom", "e", "tom", "#b8df77", 191, .002, .31, 1.58, 5.8, 1.1, .025, .61, .74],
  ["closed-hat", "Closed Hat", "r", "hat", "#5fe8c4", 4820, .001, .075, 1.414, 9.2, 0, .74, .88, .42],
  ["open-hat", "Open Hat", "a", "hat", "#55d6d0", 4210, .002, .44, 1.618, 8.1, 0, .66, .8, .4],
  ["rim-shot", "Rim Shot", "s", "metal", "#70d8e7", 510, .001, .105, 2.91, 5.7, .15, .12, .72, .62],
  ["cowbell", "Cowbell", "d", "metal", "#7db4ff", 563, .002, .29, 1.48, 3.4, 0, .03, .67, .56],
  ["glass-bell", "Glass Bell", "f", "bell", "#91a6ff", 784, .004, 1.25, 2.76, 6.8, 0, .01, .82, .5],
  ["soft-chime", "Soft Chime", "z", "bell", "#b299ff", 1047, .018, 1.8, 3.03, 4.6, -.08, 0, .72, .44],
  ["bronze-gong", "Bronze Gong", "x", "bell", "#c79bff", 147, .012, 2.35, 1.71, 12.8, -.12, .035, .46, .62],
  ["laser-zap", "Laser Zap", "c", "effect", "#e883ee", 329, .001, .38, 4.2, 10.6, 5.2, .02, .74, .56],
  ["scrap-metal", "Scrap Metal", "v", "metal", "#ff82c8", 927, .001, .64, 2.23, 14.2, -.35, .28, .84, .46],
];

export const FM_DRUM_STORAGE_KEY = "morphazoid:fm-drums:bank:v1";

export const DEFAULT_FM_DRUM_VOICES = Object.freeze(VOICES.map(([
  id, name, key, family, color, frequency, attack, decay,
  modRatio, modIndex, pitchBend, noise, tone, level,
]) => Object.freeze({
  id, name, key, family, color, frequency, attack, decay,
  modRatio, modIndex, pitchBend, noise, tone, level,
})));

export function cloneDefaultFmDrumVoices() {
  return DEFAULT_FM_DRUM_VOICES.map((voice) => ({ ...voice }));
}

export function sanitizeFmDrumVoice(voice = {}) {
  return {
    ...voice,
    frequency: clamp(Number(voice.frequency) || 60, 20, 12_000),
    attack: clamp(Number(voice.attack) || .001, .001, .25),
    decay: clamp(Number(voice.decay) || .1, .035, 3),
    modRatio: clamp(Number(voice.modRatio) || 1, .25, 8),
    modIndex: clamp(Number(voice.modIndex) || 0, 0, 20),
    pitchBend: clamp(Number(voice.pitchBend) || 0, -1, 8),
    noise: clamp(Number(voice.noise) || 0, 0, 1),
    tone: clamp(Number(voice.tone) || 0, 0, 1),
    level: clamp(Number(voice.level) || 0, 0, 1),
  };
}

export function frequencyFromSlider(position, minimum = 35, maximum = 6_000) {
  const safePosition = clamp(Number(position) || 0, 0, 1);
  return minimum * ((maximum / minimum) ** safePosition);
}

export function frequencySliderPosition(frequency, minimum = 35, maximum = 6_000) {
  const safeFrequency = clamp(Number(frequency) || minimum, minimum, maximum);
  return Math.log(safeFrequency / minimum) / Math.log(maximum / minimum);
}

export class FmDrumAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.input = null;
    this.master = null;
    this.hostGate = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.output = .72;
    this.hostGain = 1;
    this.lifecycleGeneration = 0;
    this.noiseBuffer = null;
    this.noiseBufferContext = null;
    this.activeHits = new Set();
  }

  async start() {
    const lifecycleGeneration = this.lifecycleGeneration;
    let context = this.context;
    if (!context || context.state === "closed") {
      for (const hit of [...this.activeHits]) this.#cleanupHit(hit);
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      this.context = null;
      this.input = null;
      this.master = null;
      this.hostGate = null;
      this.analyser = null;
      this.noiseBuffer = null;
      this.noiseBufferContext = null;
      const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is not available in this browser.");
      context = new Context();
      this.context = context;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = .002;
      compressor.release.value = .18;
      this.master = context.createGain();
      this.master.gain.value = this.output;
      this.hostGate = context.createGain();
      this.hostGate.gain.value = this.hostGain;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      compressor.connect(this.master);
      this.master.connect(this.hostGate);
      this.hostGate.connect(this.analyser);
      this.releaseAudioOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });
      this.input = compressor;
    }
    if (context.state !== "running") {
      unlockAudioContext(context);
      await context.resume();
    }
    if (
      lifecycleGeneration !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) throw cancelledAudioStart();
    return context;
  }

  setOutput(value) {
    this.output = clamp(Number(value) || 0, 0, .9);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.output, this.context.currentTime, .015);
    }
  }

  /** Host-only gain used for seamless handoff without changing the saved output. */
  setHostGain(gain, rampMilliseconds = 0) {
    this.hostGain = clamp(Number(gain) || 0, 0, 1);
    if (!this.context || !this.hostGate) return;
    const now = this.context.currentTime;
    const parameter = this.hostGate.gain;
    if (typeof parameter.cancelAndHoldAtTime === "function") parameter.cancelAndHoldAtTime(now);
    else {
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(parameter.value, now);
    }
    const duration = Math.max(0, Number(rampMilliseconds) || 0) / 1000;
    if (duration > 0) parameter.linearRampToValueAtTime(this.hostGain, now + duration);
    else parameter.setValueAtTime(this.hostGain, now);
  }

  async close() {
    this.lifecycleGeneration += 1;
    const context = this.context;
    this.silence();
    for (const hit of [...this.activeHits]) this.#cleanupHit(hit);
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    this.hostGate = null;
    this.analyser = null;
    this.noiseBuffer = null;
    this.noiseBufferContext = null;
    if (context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
  }

  /**
   * Trigger a voice on the AudioContext timeline. `startAt` is an absolute
   * context time; `startDelaySeconds` is retained for relative callers and is
   * used only when no finite absolute time is supplied.
   */
  async trigger(sourceVoice, { startAt, startDelaySeconds = 0 } = {}) {
    const voice = sanitizeFmDrumVoice(sourceVoice);
    const context = await this.start();
    if (context !== this.context || context.state === "closed") {
      throw cancelledAudioStart();
    }
    const currentTime = Number(context.currentTime) || 0;
    const requestedStart = startAt === undefined || startAt === null
      ? Number.NaN
      : Number(startAt);
    const requestedDelay = Number(startDelaySeconds);
    const delay = Number.isFinite(requestedDelay) ? Math.max(0, requestedDelay) : 0;
    // Web Audio rejects starts in the past on some implementations. Keeping an
    // absolute request when it is still ahead preserves rhythm across delayed
    // JavaScript callbacks; a genuinely late request starts safely now.
    const startsAt = Number.isFinite(requestedStart)
      ? Math.max(currentTime, requestedStart)
      : currentTime + delay;
    const stopAt = startsAt + Math.max(.12, voice.attack + voice.decay * 1.35);

    const amplitude = context.createGain();
    amplitude.gain.setValueAtTime(.0001, startsAt);
    amplitude.gain.exponentialRampToValueAtTime(Math.max(.001, voice.level), startsAt + voice.attack);
    amplitude.gain.exponentialRampToValueAtTime(.0001, startsAt + voice.attack + voice.decay);

    const filter = context.createBiquadFilter();
    filter.type = voice.family === "hat"
      ? "highpass"
      : voice.family === "rattle"
        ? "bandpass"
        : "lowpass";
    filter.frequency.value = voice.family === "hat"
      ? 2_200 + voice.tone * 5_000
      : voice.family === "rattle"
        ? clamp(voice.frequency * 5, 480, 12_000)
        : 550 + voice.tone * 11_500;
    filter.Q.value = voice.family === "rattle" ? 4.2 : voice.family === "metal" ? 2.6 : .75;
    amplitude.connect(filter);
    filter.connect(this.input);

    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modulation = context.createGain();
    const base = voice.frequency;
    carrier.type = ["hat", "metal", "rattle"].includes(voice.family) ? "square" : "sine";
    modulator.type = voice.family === "bell" ? "sine" : "triangle";
    carrier.frequency.setValueAtTime(
      clamp(base * Math.max(.15, 1 + voice.pitchBend), 20, 16_000),
      startsAt,
    );
    carrier.frequency.exponentialRampToValueAtTime(
      base,
      startsAt + Math.max(.018, voice.decay * .42),
    );
    modulator.frequency.value = clamp(base * voice.modRatio, 20, 18_000);
    modulation.gain.setValueAtTime(base * voice.modIndex, startsAt);
    modulation.gain.exponentialRampToValueAtTime(.001, startsAt + Math.max(.025, voice.decay));
    modulator.connect(modulation);
    modulation.connect(carrier.frequency);
    carrier.connect(amplitude);
    carrier.start(startsAt);
    modulator.start(startsAt);
    carrier.stop(stopAt);
    modulator.stop(stopAt);

    const noiseLayer = voice.noise > .005
      ? this.#addNoise(voice, filter, startsAt, stopAt)
      : null;
    this.#trackHit({
      startsAt,
      stopAt,
      carrier,
      modulator,
      modulation,
      amplitude,
      filter,
      noiseLayer,
    });
    return voice;
  }

  /** Fade audible hits and invalidate every hit that has not started yet. */
  silence() {
    const context = this.context;
    if (!context) {
      for (const hit of [...this.activeHits]) this.#cleanupHit(hit);
      return;
    }
    const now = Number(context.currentTime) || 0;
    for (const hit of [...this.activeHits]) {
      if (hit.stopAt <= now) {
        this.#cleanupHit(hit);
        continue;
      }
      if (hit.startsAt > now + 1e-6) {
        this.#cancelGain(hit.amplitude.gain, now);
        if (hit.noiseLayer) this.#cancelGain(hit.noiseLayer.amplitude.gain, now);
        this.#stopSource(hit.carrier, now);
        this.#stopSource(hit.modulator, now);
        this.#stopSource(hit.noiseLayer?.source, now);
        // Disconnecting makes a future source silent even on engines that defer
        // an onended callback for a start which was cancelled before it began.
        this.#cleanupHit(hit);
        continue;
      }

      const fadeEnd = Math.min(hit.stopAt, now + 0.025);
      this.#fadeGain(hit.amplitude.gain, now, fadeEnd);
      if (hit.noiseLayer) this.#fadeGain(hit.noiseLayer.amplitude.gain, now, fadeEnd);
      this.#stopSource(hit.carrier, fadeEnd + 0.005);
      this.#stopSource(hit.modulator, fadeEnd + 0.005);
      this.#stopSource(hit.noiseLayer?.source, fadeEnd + 0.005);
      hit.stopAt = fadeEnd + 0.005;
    }
  }

  #cancelGain(parameter, now) {
    if (!parameter) return;
    try {
      parameter.cancelScheduledValues?.(now);
      parameter.setValueAtTime?.(0, now);
    } catch {
      // A source may finish between the lifecycle check and cancellation.
    }
  }

  #fadeGain(parameter, now, fadeEnd) {
    if (!parameter) return;
    try {
      if (typeof parameter.cancelAndHoldAtTime === "function") {
        parameter.cancelAndHoldAtTime(now);
      } else {
        parameter.cancelScheduledValues?.(now);
        parameter.setValueAtTime?.(Math.max(.0001, Number(parameter.value) || .0001), now);
      }
      parameter.exponentialRampToValueAtTime?.(.0001, fadeEnd);
      parameter.setValueAtTime?.(0, fadeEnd + .003);
    } catch {
      // An already-ended gain needs no additional fade.
    }
  }

  #stopSource(source, at) {
    if (!source || typeof source.stop !== "function") return;
    try {
      source.stop(at);
    } catch {
      // Calling stop again after an onended callback is harmless to silence().
    }
  }

  #trackHit(hit) {
    hit.cleaned = false;
    hit.pendingSources = new Set([
      hit.carrier,
      hit.modulator,
      hit.noiseLayer?.source,
    ].filter(Boolean));
    this.activeHits.add(hit);
    for (const source of hit.pendingSources) {
      source.onended = () => {
        hit.pendingSources.delete(source);
        try { source.disconnect?.(); } catch { /* Already disconnected. */ }
        if (!hit.pendingSources.size) this.#cleanupHit(hit);
      };
    }
  }

  #cleanupHit(hit) {
    if (!hit || hit.cleaned) return;
    hit.cleaned = true;
    this.activeHits.delete(hit);
    const nodes = [
      hit.carrier,
      hit.modulator,
      hit.modulation,
      hit.amplitude,
      hit.filter,
      hit.noiseLayer?.source,
      hit.noiseLayer?.amplitude,
      hit.noiseLayer?.filter,
    ];
    for (const source of [hit.carrier, hit.modulator, hit.noiseLayer?.source]) {
      if (source) source.onended = null;
    }
    for (const node of nodes) {
      try { node?.disconnect?.(); } catch { /* Already disconnected. */ }
    }
    hit.pendingSources?.clear();
  }

  #noiseBuffer(context) {
    if (this.noiseBuffer && this.noiseBufferContext === context) return this.noiseBuffer;
    const sampleRate = Number.isFinite(context.sampleRate) ? context.sampleRate : 48_000;
    const frameCount = Math.max(1, Math.ceil(sampleRate * NOISE_BUFFER_SECONDS));
    const buffer = context.createBuffer(1, frameCount, sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    this.noiseBufferContext = context;
    return buffer;
  }

  #addNoise(voice, destination, startsAt, stopAt) {
    const context = this.context;
    const buffer = this.#noiseBuffer(context);
    const noise = context.createBufferSource();
    const amplitude = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = ["kick", "rattle"].includes(voice.family) ? "bandpass" : "highpass";
    filter.frequency.value = voice.family === "kick"
      ? 900
      : voice.family === "rattle"
        ? clamp(voice.frequency * 6, 520, 13_000)
        : 900 + voice.tone * 7_200;
    filter.Q.value = voice.family === "rattle" ? 5.2 : voice.family === "snare" ? .7 : 1.8;
    amplitude.gain.setValueAtTime(.0001, startsAt);
    if (voice.family === "rattle") {
      const pulseCount = Math.max(4, Math.min(10, Math.round(voice.decay / 0.02)));
      const spacing = voice.decay / pulseCount;
      for (let pulse = 0; pulse < pulseCount; pulse += 1) {
        const pulseAt = startsAt + voice.attack + pulse * spacing;
        const pulseLevel = voice.noise * voice.level * (1 - pulse / (pulseCount * 1.7));
        amplitude.gain.setValueAtTime(.0001, pulseAt);
        amplitude.gain.linearRampToValueAtTime(pulseLevel, pulseAt + 0.002);
        amplitude.gain.exponentialRampToValueAtTime(.0001, pulseAt + spacing * 0.72);
      }
    } else {
      amplitude.gain.linearRampToValueAtTime(voice.noise * voice.level, startsAt + voice.attack);
    }
    if (voice.id === "wide-clap" && voice.family !== "rattle") {
      amplitude.gain.setValueAtTime(voice.noise * voice.level, startsAt + .022);
      amplitude.gain.setValueAtTime(.04, startsAt + .032);
      amplitude.gain.setValueAtTime(voice.noise * voice.level * .72, startsAt + .047);
    }
    if (voice.family !== "rattle") {
      amplitude.gain.exponentialRampToValueAtTime(.0001, startsAt + voice.attack + voice.decay);
    }
    noise.buffer = buffer;
    noise.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(destination);
    noise.start(startsAt);
    noise.stop(stopAt);
    return { source: noise, amplitude, filter };
  }
}

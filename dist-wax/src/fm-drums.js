import { unlockAudioContext } from "./audio.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

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
    this.analyser = null;
    this.output = .72;
    this.lifecycleGeneration = 0;
  }

  async start() {
    const lifecycleGeneration = this.lifecycleGeneration;
    let context = this.context;
    if (!context || context.state === "closed") {
      this.context = null;
      this.input = null;
      this.master = null;
      this.analyser = null;
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
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      compressor.connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(context.destination);
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

  async close() {
    this.lifecycleGeneration += 1;
    const context = this.context;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    if (context && context.state !== "closed" && typeof context.close === "function") {
      await context.close();
    }
  }

  async trigger(sourceVoice) {
    const voice = sanitizeFmDrumVoice(sourceVoice);
    const context = await this.start();
    if (context !== this.context || context.state === "closed") {
      throw cancelledAudioStart();
    }
    const now = context.currentTime;
    const stopAt = now + Math.max(.12, voice.attack + voice.decay * 1.35);

    const amplitude = context.createGain();
    amplitude.gain.setValueAtTime(.0001, now);
    amplitude.gain.exponentialRampToValueAtTime(Math.max(.001, voice.level), now + voice.attack);
    amplitude.gain.exponentialRampToValueAtTime(.0001, now + voice.attack + voice.decay);

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
      now,
    );
    carrier.frequency.exponentialRampToValueAtTime(
      base,
      now + Math.max(.018, voice.decay * .42),
    );
    modulator.frequency.value = clamp(base * voice.modRatio, 20, 18_000);
    modulation.gain.setValueAtTime(base * voice.modIndex, now);
    modulation.gain.exponentialRampToValueAtTime(.001, now + Math.max(.025, voice.decay));
    modulator.connect(modulation);
    modulation.connect(carrier.frequency);
    carrier.connect(amplitude);
    carrier.start(now);
    modulator.start(now);
    carrier.stop(stopAt);
    modulator.stop(stopAt);

    if (voice.noise > .005) this.#addNoise(voice, filter, now, stopAt);
    return voice;
  }

  #addNoise(voice, destination, now, stopAt) {
    const context = this.context;
    const frameCount = Math.ceil(context.sampleRate * Math.min(2.5, voice.decay + .08));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }
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
    amplitude.gain.setValueAtTime(.0001, now);
    if (voice.family === "rattle") {
      const pulseCount = Math.max(4, Math.min(10, Math.round(voice.decay / 0.02)));
      const spacing = voice.decay / pulseCount;
      for (let pulse = 0; pulse < pulseCount; pulse += 1) {
        const pulseAt = now + voice.attack + pulse * spacing;
        const pulseLevel = voice.noise * voice.level * (1 - pulse / (pulseCount * 1.7));
        amplitude.gain.setValueAtTime(.0001, pulseAt);
        amplitude.gain.linearRampToValueAtTime(pulseLevel, pulseAt + 0.002);
        amplitude.gain.exponentialRampToValueAtTime(.0001, pulseAt + spacing * 0.72);
      }
    } else {
      amplitude.gain.linearRampToValueAtTime(voice.noise * voice.level, now + voice.attack);
    }
    if (voice.id === "wide-clap" && voice.family !== "rattle") {
      amplitude.gain.setValueAtTime(voice.noise * voice.level, now + .022);
      amplitude.gain.setValueAtTime(.04, now + .032);
      amplitude.gain.setValueAtTime(voice.noise * voice.level * .72, now + .047);
    }
    if (voice.family !== "rattle") {
      amplitude.gain.exponentialRampToValueAtTime(.0001, now + voice.attack + voice.decay);
    }
    noise.buffer = buffer;
    noise.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(destination);
    noise.start(now);
    noise.stop(stopAt);
  }
}

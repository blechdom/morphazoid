// Shared Rubix/Shapes native kit recipes. Call only while preparing buffers,
// never from the real-time geometry scheduler.
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
export class MorphazoidDrumRenderer {
  constructor(context, noiseBuffer, random = Math.random) {
    this.context = context;
    this.noiseBuffer = noiseBuffer;
    this.random = random;
  }
  scheduleFmDrum(voice, when, laneGain, destination) {
    const context = this.context;
    const stopAt = when + Math.max(0.12, voice.attack + voice.decay * 1.35);
    const amplitude = context.createGain();
    const filter = context.createBiquadFilter();
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modulation = context.createGain();

    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.exponentialRampToValueAtTime(
      Math.max(0.001, voice.level * laneGain * 0.6),
      when + voice.attack,
    );
    amplitude.gain.exponentialRampToValueAtTime(0.0001, when + voice.attack + voice.decay);
    filter.type = voice.family === "hat" ? "highpass" : "lowpass";
    filter.frequency.value = voice.family === "hat"
      ? 2200 + voice.tone * 5000
      : 550 + voice.tone * 11_500;
    filter.Q.value = 0.75;
    amplitude.connect(filter);
    filter.connect(destination);

    const base = voice.frequency;
    carrier.type = voice.family === "hat" ? "triangle" : "sine";
    modulator.type = "triangle";
    carrier.frequency.setValueAtTime(clamp(base * Math.max(0.15, 1 + voice.pitchBend), 20, 16_000), when);
    carrier.frequency.exponentialRampToValueAtTime(base, when + Math.max(0.018, voice.decay * 0.42));
    modulator.frequency.value = clamp(base * voice.modRatio, 20, 18_000);
    const modulationDepth = Math.min(
      context.sampleRate * 0.24,
      base * voice.modIndex * (voice.family === "hat" ? 0.22 : 0.55),
    );
    modulation.gain.setValueAtTime(Math.max(0.001, modulationDepth), when);
    modulation.gain.exponentialRampToValueAtTime(0.001, when + Math.max(0.025, voice.decay));
    modulator.connect(modulation);
    modulation.connect(carrier.frequency);
    carrier.connect(amplitude);
    carrier.start(when);
    modulator.start(when);
    carrier.stop(stopAt);
    modulator.stop(stopAt);
    if (voice.noise > 0.005) {
      this.scheduleNoise(voice, filter, when, stopAt, laneGain * 0.72);
    }
  }

  scheduleAnalogDrum(voice, when, laneGain, destination) {
    const context = this.context;
    const family = voice.family;
    const attack = clamp(voice.attack, 0.001, 0.08);
    const decayScale = family === "kick" ? 0.62 : family === "tom" ? 0.6 : 0.46;
    const decay = clamp(voice.decay * decayScale, 0.045, 0.48);
    const envelopeEnd = when + attack + decay;
    const stopAt = envelopeEnd + 0.06;
    if (family !== "hat") {
      const oscillator = context.createOscillator();
      const amplitude = context.createGain();
      const filter = context.createBiquadFilter();
      const pitchStart = family === "kick" ? 3.4 : family === "tom" ? 1.75 : 1.12;
      const peak = Math.max(0.001, voice.level * laneGain * 0.54 * Math.SQRT1_2);
      oscillator.type = family === "snare" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(clamp(voice.frequency * pitchStart, 24, 12_000), when);
      oscillator.frequency.exponentialRampToValueAtTime(
        clamp(voice.frequency, 20, 12_000),
        when + Math.max(0.018, decay * 0.38),
      );
      amplitude.gain.setValueAtTime(0.0001, when);
      amplitude.gain.exponentialRampToValueAtTime(peak, when + attack);
      amplitude.gain.exponentialRampToValueAtTime(0.0001, envelopeEnd);
      filter.type = "lowpass";
      filter.frequency.value = family === "kick"
        ? 520 + voice.tone * 1400
        : 900 + voice.tone * 3600;
      filter.Q.value = 0.65;
      oscillator.connect(amplitude);
      amplitude.connect(filter);
      filter.connect(destination);
      oscillator.start(when);
      oscillator.stop(stopAt);
    }

    const noiseAmount = family === "hat"
      ? Math.max(0.64, voice.noise)
      : family === "snare"
        ? Math.max(0.42, voice.noise)
        : voice.noise * 0.52;
    if (noiseAmount > 0.005) {
      this.scheduleNoise(
        { ...voice, attack, noise: noiseAmount, decay },
        destination,
        when,
        stopAt,
        laneGain * 0.54,
      );
    }
  }

  scheduleModalDrum(voice, when, laneGain, destination) {
    const context = this.context;
    const root = voice.family === "hat" ? voice.frequency * 0.14 : voice.frequency;
    const attack = clamp(voice.attack, 0.001, 0.06);
    const decay = clamp(voice.decay * 0.72, 0.065, 0.68);
    const ratios = [1, 3.02, 6.13];
    const partialLevels = [0.74, 0.19, 0.07];
    const decayFactors = [1, 0.46, 0.23];
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1700 + voice.tone * 4200;
    filter.Q.value = 0.85;
    filter.connect(destination);
    ratios.forEach((ratio, index) => {
      const oscillator = context.createOscillator();
      const amplitude = context.createGain();
      const partialDecay = Math.max(0.035, decay * decayFactors[index]);
      const partialEnd = when + attack + partialDecay;
      const peak = Math.max(
        0.001,
        voice.level * laneGain * 0.52 * partialLevels[index] * Math.SQRT1_2,
      );
      oscillator.type = "sine";
      oscillator.frequency.value = clamp(root * ratio, 24, 14_000);
      amplitude.gain.setValueAtTime(0.0001, when);
      amplitude.gain.exponentialRampToValueAtTime(peak, when + attack);
      amplitude.gain.exponentialRampToValueAtTime(0.0001, partialEnd);
      oscillator.connect(amplitude);
      amplitude.connect(filter);
      oscillator.start(when);
      oscillator.stop(partialEnd + 0.05);
    });
    if (voice.noise > 0.02) {
      const noiseDecay = Math.min(decay, 0.24);
      this.scheduleNoise(
        { ...voice, attack, decay: noiseDecay },
        destination,
        when,
        when + attack + noiseDecay + 0.05,
        laneGain * 0.14,
      );
    }
  }

  scheduleNoiseDrum(voice, when, laneGain, destination) {
    const context = this.context;
    const family = ["kick", "snare", "tom", "hat"].includes(voice.family)
      ? voice.family
      : "snare";
    const attack = clamp(voice.attack, 0.001, 0.055);
    const decay = clamp(voice.decay, 0.04, 0.32);
    const envelopeEnd = when + attack + decay;
    const peakByFamily = { kick: 0.22, snare: 0.52, tom: 0.28, hat: 0.48 };
    const filterSettings = {
      kick: ["bandpass", 180 + voice.tone * 420, 1.1],
      snare: ["bandpass", 1000 + voice.tone * 1800, 0.8],
      tom: ["bandpass", 420 + voice.tone * 1050, 1.8],
      hat: ["highpass", 3200 + voice.tone * 3800, 0.7],
    };
    const [type, frequency, q] = filterSettings[family];
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const amplitude = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.linearRampToValueAtTime(
      Math.max(0.001, peakByFamily[family] * voice.level * laneGain * Math.SQRT1_2),
      when + attack,
    );
    amplitude.gain.exponentialRampToValueAtTime(0.0001, envelopeEnd);
    source.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(destination);
    const stopAt = envelopeEnd + 0.05;
    const availableOffset = Math.max(0, this.noiseBuffer.duration - (stopAt - when));
    source.start(when, this.random() * availableOffset);
    source.stop(stopAt);
    if (["kick", "tom"].includes(family)) {
      const body = context.createOscillator();
      const bodyGain = context.createGain();
      body.type = "sine";
      body.frequency.setValueAtTime(clamp(voice.frequency * 1.45, 24, 4000), when);
      body.frequency.exponentialRampToValueAtTime(
        clamp(voice.frequency * 0.82, 20, 4000),
        when + Math.max(0.025, decay * 0.62),
      );
      bodyGain.gain.setValueAtTime(0.0001, when);
      bodyGain.gain.exponentialRampToValueAtTime(
        Math.max(0.001, voice.level * laneGain * 0.12),
        when + attack,
      );
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, envelopeEnd);
      body.connect(bodyGain);
      bodyGain.connect(destination);
      body.start(when);
      body.stop(stopAt);
    }
  }

  scheduleNoise(voice, destination, when, stopAt, laneGain) {
    const context = this.context;
    const source = context.createBufferSource();
    const amplitude = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = voice.family === "kick" ? "bandpass" : "highpass";
    filter.frequency.value = voice.family === "kick" ? 900 : 900 + voice.tone * 7200;
    filter.Q.value = voice.family === "snare" ? 0.7 : 1.8;
    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.linearRampToValueAtTime(
      Math.max(0.001, voice.noise * voice.level * laneGain * Math.SQRT1_2),
      when + voice.attack,
    );
    amplitude.gain.exponentialRampToValueAtTime(0.0001, when + voice.attack + voice.decay);
    source.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(destination);
    const availableOffset = Math.max(0, this.noiseBuffer.duration - (stopAt - when));
    source.start(when, this.random() * availableOffset);
    source.stop(stopAt);
  }

}

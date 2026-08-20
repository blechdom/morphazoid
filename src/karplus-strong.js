import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const KARPLUS_STRONG_DEFAULTS = Object.freeze({
  frequency: 130.81,
  decay: 3.2,
  damping: 0.38,
  brightness: 0.72,
  hardness: 0.58,
  excitationColor: 0.66,
  excitationShape: 0.12,
  burstLength: 1,
  pickPosition: 0.28,
  pickWidth: 0.72,
  detune: 0,
  dispersion: 0.18,
  polarity: 1,
  lowCut: 0.08,
  drive: 0.08,
  chorusDepth: 0,
  chorusRate: 0.6,
  roughness: 0,
  pickupPosition: 0.72,
  pickupMix: 0.18,
  body: 0.42,
  bodyTune: 2.4,
  bodyQ: 3.6,
  coupling: 0.12,
  couplingRatio: 2,
  couplingDetune: 0,
  spread: 0.32,
  level: 0.62,
});

function preset(id, name, settings) {
  return Object.freeze({
    id,
    name,
    settings: Object.freeze(sanitizeKarplusStrongSettings({
      ...KARPLUS_STRONG_DEFAULTS,
      ...settings,
    })),
  });
}

export const KARPLUS_STRONG_PRESETS = Object.freeze([
  preset("nylon", "Warm Nylon", {
    decay: 3.7, damping: .62, brightness: .48, hardness: .3,
    excitationColor: .38, excitationShape: .18, burstLength: .72,
    pickPosition: .3, pickWidth: .78, dispersion: .06, lowCut: .18,
    drive: .08, pickupPosition: .72, pickupMix: .22,
    body: .58, bodyTune: 1.9, bodyQ: 3.8,
    coupling: .08, couplingRatio: 2.01, couplingDetune: -2, spread: .24,
  }),
  preset("steel", "Steel Wire", {
    decay: 5.1, damping: .2, brightness: .9, hardness: .78,
    excitationColor: .92, excitationShape: .06, burstLength: 1.15,
    pickPosition: .18, pickWidth: .86, dispersion: .38, lowCut: .06,
    drive: .12, chorusDepth: .06, chorusRate: .45, roughness: .03,
    pickupPosition: .82, pickupMix: .34, body: .24, bodyTune: 3.2, bodyQ: 5.2,
    coupling: .18, couplingRatio: 2, couplingDetune: 1, spread: .42,
  }),
  preset("muted", "Palm Mute", {
    decay: .62, damping: .86, brightness: .42, hardness: .72,
    excitationColor: .45, excitationShape: .22, burstLength: .42,
    pickPosition: .4, pickWidth: .6, dispersion: .04, lowCut: .28,
    drive: .28, pickupPosition: .55, pickupMix: .42,
    body: .66, bodyTune: 1.45, bodyQ: 2.5, coupling: 0, spread: .16,
  }),
  preset("kalimba", "Thumb Tine", {
    decay: 1.8, damping: .48, brightness: .68, hardness: .9,
    excitationColor: .72, excitationShape: .76, burstLength: .3,
    pickPosition: .2, pickWidth: .38, dispersion: .22, polarity: .75,
    lowCut: .3, drive: .36, pickupPosition: .34, pickupMix: .28,
    body: .76, bodyTune: 2.8, bodyQ: 6.4,
    coupling: .1, couplingRatio: 2.98, couplingDetune: 4, spread: .28,
  }),
  preset("glass", "Glass Thread", {
    decay: 5.8, damping: .12, brightness: .96, hardness: .46,
    excitationColor: .98, excitationShape: .52, burstLength: 1.6,
    pickPosition: .46, pickWidth: .92, dispersion: .64, lowCut: .02,
    drive: 0, chorusDepth: .16, chorusRate: .23, roughness: .01,
    pickupPosition: .36, pickupMix: .1, body: .16, bodyTune: 4.8, bodyQ: 8,
    coupling: .24, couplingRatio: 1.5, couplingDetune: 7, spread: .56,
  }),
  preset("choir", "Coupled Harp", {
    decay: 4.4, damping: .34, brightness: .76, hardness: .5,
    excitationColor: .78, excitationShape: .18, burstLength: 1.25,
    pickPosition: .24, pickWidth: .74, dispersion: .28,
    chorusDepth: .25, chorusRate: .32, roughness: .03,
    pickupPosition: .68, pickupMix: .2, body: .44, bodyTune: 2.1, bodyQ: 4,
    coupling: .68, couplingRatio: 1.5, couplingDetune: -9, spread: .72,
  }),
  preset("banjo", "Banjo Skin", {
    decay: 1.7, damping: .35, brightness: .86, hardness: .9,
    excitationColor: .9, excitationShape: .32, burstLength: .48,
    pickPosition: .16, pickWidth: .88, dispersion: .18, lowCut: .2,
    drive: .4, pickupPosition: .23, pickupMix: .76,
    body: .72, bodyTune: 3.8, bodyQ: 8,
    coupling: .08, couplingRatio: 2.02, couplingDetune: 2, spread: .4,
  }),
  preset("bass", "Upright Gut", {
    decay: 4.8, damping: .58, brightness: .38, hardness: .26,
    excitationColor: .28, excitationShape: .12, burstLength: 1.3,
    pickPosition: .34, pickWidth: .66, detune: -4, dispersion: .08,
    lowCut: .05, drive: .15, pickupPosition: .78, pickupMix: .26,
    body: .86, bodyTune: 1.1, bodyQ: 2.4,
    coupling: .24, couplingRatio: 2, couplingDetune: -6, spread: .3,
  }),
  preset("jawari", "Jawari Buzz", {
    decay: 3, damping: .3, brightness: .8, hardness: .72,
    excitationColor: .84, excitationShape: .18, burstLength: 1.7,
    pickPosition: .12, pickWidth: .95, dispersion: .32, polarity: .96,
    lowCut: .12, drive: .78, roughness: .1,
    pickupPosition: .14, pickupMix: .9, body: .5, bodyTune: 5.4, bodyQ: 7.2,
    coupling: .3, couplingRatio: 2, couplingDetune: 3, spread: .5,
  }),
  preset("prepared", "Prepared Bolt", {
    decay: 2.2, damping: .5, brightness: .62, hardness: .95,
    excitationColor: .55, excitationShape: .86, burstLength: .25,
    pickPosition: .62, pickWidth: .4, detune: 9, dispersion: .5,
    polarity: -.55, lowCut: .4, drive: .65,
    chorusDepth: .13, chorusRate: 2.8, roughness: .26,
    pickupPosition: .48, pickupMix: .7, body: .82, bodyTune: .73, bodyQ: 10,
    coupling: .22, couplingRatio: 1.33, couplingDetune: -17, spread: .8,
  }),
  preset("rubber", "Rubber Cord", {
    decay: 1.1, damping: .78, brightness: .25, hardness: .14,
    excitationColor: .15, excitationShape: .3, burstLength: 1.9,
    pickPosition: .5, pickWidth: .25, detune: -13, dispersion: .12,
    polarity: .68, lowCut: .18, drive: .48,
    chorusDepth: .09, chorusRate: .7, roughness: .04,
    pickupPosition: .66, pickupMix: .12, body: .9, bodyTune: .8, bodyQ: 1.2,
    coupling: .14, couplingRatio: .5, couplingDetune: 8, spread: .18,
  }),
  preset("inverted", "Inverted Loop", {
    decay: 3.8, damping: .28, brightness: .82, hardness: .62,
    excitationColor: .74, excitationShape: .08, burstLength: .85,
    pickPosition: .22, pickWidth: .76, dispersion: .72, polarity: -1,
    lowCut: .16, drive: .2, chorusDepth: .06, chorusRate: 1.8, roughness: .02,
    pickupPosition: .58, pickupMix: .3, body: .3, bodyTune: 2.7, bodyQ: 4.8,
    coupling: .4, couplingRatio: 1.5, couplingDetune: -12, spread: .65,
  }),
  preset("frozen", "Frozen Glass", {
    decay: 6.8, damping: .08, brightness: 1, hardness: .36,
    excitationColor: 1, excitationShape: .64, burstLength: 2.8,
    pickPosition: .42, pickWidth: .96, detune: 7, dispersion: .92,
    lowCut: 0, drive: 0, chorusDepth: .45, chorusRate: .08,
    pickupPosition: .31, pickupMix: .08, body: .12, bodyTune: 6.5, bodyQ: 11,
    coupling: .72, couplingRatio: 2.01, couplingDetune: -16, spread: 1,
  }),
  preset("broken", "Broken Bridge", {
    decay: .9, damping: .42, brightness: .76, hardness: 1,
    excitationColor: .88, excitationShape: .44, burstLength: 3.6,
    pickPosition: .08, pickWidth: 1, detune: -8, dispersion: .2,
    polarity: .92, lowCut: .22, drive: 1,
    chorusDepth: .04, chorusRate: 6, roughness: .75,
    pickupPosition: .1, pickupMix: 1, body: .7, bodyTune: 4.5, bodyQ: 9,
    coupling: .15, couplingRatio: 3, couplingDetune: 13, spread: .55,
  }),
  preset("ghost", "Ghost Pair", {
    decay: 5.4, damping: .46, brightness: .58, hardness: .22,
    excitationColor: .44, excitationShape: .4, burstLength: 1.4,
    pickPosition: .38, pickWidth: .82, detune: -2, dispersion: .48,
    lowCut: .04, drive: .06, chorusDepth: .36, chorusRate: .18,
    pickupPosition: .74, pickupMix: .16, body: .36, bodyTune: 1.6, bodyQ: 5.6,
    coupling: .9, couplingRatio: .5, couplingDetune: 11, spread: .92,
  }),
  preset("dust", "Dust String", {
    decay: .48, damping: .72, brightness: .94, hardness: .84,
    excitationColor: 1, excitationShape: .02, burstLength: 3.9,
    pickPosition: .06, pickWidth: .3, detune: 18, dispersion: .08,
    polarity: .42, lowCut: .8, drive: .88,
    chorusDepth: .22, chorusRate: 7.2, roughness: 1,
    pickupPosition: .91, pickupMix: .62, body: .22, bodyTune: 7.4, bodyQ: 2,
    coupling: .05, couplingRatio: 3.5, couplingDetune: -31, spread: .78,
  }),
]);

export function sanitizeKarplusStrongSettings(source = {}) {
  const settings = source && typeof source === "object" ? source : {};
  return {
    frequency: clamp(finiteOr(settings.frequency, KARPLUS_STRONG_DEFAULTS.frequency), 20, 16_000),
    decay: clamp(finiteOr(settings.decay, KARPLUS_STRONG_DEFAULTS.decay), .2, 16),
    damping: clamp(finiteOr(settings.damping, KARPLUS_STRONG_DEFAULTS.damping), 0, 1),
    brightness: clamp(finiteOr(settings.brightness, KARPLUS_STRONG_DEFAULTS.brightness), 0, 1),
    hardness: clamp(finiteOr(settings.hardness, KARPLUS_STRONG_DEFAULTS.hardness), 0, 1),
    excitationColor: clamp(finiteOr(settings.excitationColor, KARPLUS_STRONG_DEFAULTS.excitationColor), 0, 1),
    excitationShape: clamp(finiteOr(settings.excitationShape, KARPLUS_STRONG_DEFAULTS.excitationShape), 0, 1),
    burstLength: clamp(finiteOr(settings.burstLength, KARPLUS_STRONG_DEFAULTS.burstLength), .1, 4),
    pickPosition: clamp(finiteOr(settings.pickPosition, KARPLUS_STRONG_DEFAULTS.pickPosition), .04, .96),
    pickWidth: clamp(finiteOr(settings.pickWidth, KARPLUS_STRONG_DEFAULTS.pickWidth), 0, 1),
    detune: clamp(finiteOr(settings.detune, KARPLUS_STRONG_DEFAULTS.detune), -50, 50),
    dispersion: clamp(finiteOr(settings.dispersion, KARPLUS_STRONG_DEFAULTS.dispersion), 0, 1),
    polarity: clamp(finiteOr(settings.polarity, KARPLUS_STRONG_DEFAULTS.polarity), -1, 1),
    lowCut: clamp(finiteOr(settings.lowCut, KARPLUS_STRONG_DEFAULTS.lowCut), 0, 1),
    drive: clamp(finiteOr(settings.drive, KARPLUS_STRONG_DEFAULTS.drive), 0, 1),
    chorusDepth: clamp(finiteOr(settings.chorusDepth, KARPLUS_STRONG_DEFAULTS.chorusDepth), 0, 1),
    chorusRate: clamp(finiteOr(settings.chorusRate, KARPLUS_STRONG_DEFAULTS.chorusRate), .05, 8),
    roughness: clamp(finiteOr(settings.roughness, KARPLUS_STRONG_DEFAULTS.roughness), 0, 1),
    pickupPosition: clamp(finiteOr(settings.pickupPosition, KARPLUS_STRONG_DEFAULTS.pickupPosition), .04, .96),
    pickupMix: clamp(finiteOr(settings.pickupMix, KARPLUS_STRONG_DEFAULTS.pickupMix), 0, 1),
    body: clamp(finiteOr(settings.body, KARPLUS_STRONG_DEFAULTS.body), 0, 1),
    bodyTune: clamp(finiteOr(settings.bodyTune, KARPLUS_STRONG_DEFAULTS.bodyTune), .5, 8),
    bodyQ: clamp(finiteOr(settings.bodyQ, KARPLUS_STRONG_DEFAULTS.bodyQ), .2, 12),
    coupling: clamp(finiteOr(settings.coupling, KARPLUS_STRONG_DEFAULTS.coupling), 0, 1),
    couplingRatio: clamp(finiteOr(settings.couplingRatio, KARPLUS_STRONG_DEFAULTS.couplingRatio), .25, 4),
    couplingDetune: clamp(finiteOr(settings.couplingDetune, KARPLUS_STRONG_DEFAULTS.couplingDetune), -50, 50),
    spread: clamp(finiteOr(settings.spread, KARPLUS_STRONG_DEFAULTS.spread), 0, 1),
    level: clamp(finiteOr(settings.level, KARPLUS_STRONG_DEFAULTS.level), 0, .85),
  };
}

export function midiNoteFrequency(note) {
  const midi = clamp(Math.round(finiteOr(note, 60)), 0, 127);
  return 440 * (2 ** ((midi - 69) / 12));
}

export function midiNoteName(note) {
  const midi = clamp(Math.round(finiteOr(note, 60)), 0, 127);
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function karplusStrongDelayLength(sampleRate, frequency, damping = .38) {
  const rate = clamp(finiteOr(sampleRate, 48_000), 8_000, 384_000);
  const pitch = clamp(finiteOr(frequency, 110), 20, Math.min(16_000, rate * .22));
  const filterDelay = clamp(finiteOr(damping, .38), 0, 1) * .5;
  return Math.max(2, rate / pitch - filterDelay);
}

export function generateKarplusStrongSamples(options = {}) {
  const sampleRate = clamp(finiteOr(options.sampleRate, 48_000), 8_000, 384_000);
  const settings = sanitizeKarplusStrongSettings(options);
  const random = typeof options.random === "function" ? options.random : Math.random;
  const duration = clamp(finiteOr(options.duration, settings.decay * 1.18 + .08), .08, 19);
  const frameCount = Math.max(32, Math.ceil(sampleRate * duration));
  const loopSamples = new Float32Array(frameCount);
  const samples = new Float32Array(frameCount);
  const tunedFrequency = settings.frequency * (2 ** (settings.detune / 1_200));
  const period = karplusStrongDelayLength(sampleRate, tunedFrequency, settings.damping);
  const excitationFrames = clamp(
    Math.round(period * settings.burstLength),
    1,
    Math.min(frameCount, Math.ceil(period * 4)),
  );
  const excitation = new Float32Array(excitationFrames);
  const excitationFollow = .03 + settings.excitationColor * .94;
  let smoothedNoise = 0;

  for (let index = 0; index < excitationFrames; index += 1) {
    const white = clamp(finiteOr(random(), .5), 0, 1) * 2 - 1;
    smoothedNoise += (white - smoothedNoise) * excitationFollow;
    const phase = (index + .5) / excitationFrames;
    const centered = phase * 2 - 1;
    const impulse = -Math.sign(centered || 1)
      * (Math.max(0, 1 - Math.abs(centered)) ** (1 + settings.hardness * 8));
    const window = Math.sin(Math.PI * phase) ** (.2 + settings.hardness * 1.8);
    excitation[index] = (
      smoothedNoise * (1 - settings.excitationShape)
      + impulse * settings.excitationShape
    ) * window;
  }

  const pickOffset = clamp(
    Math.round(period * settings.pickPosition),
    1,
    Math.max(1, excitationFrames - 1),
  );
  const excitationGain = .34 + settings.hardness * .62;
  const loopGain = 0.001 ** (period / Math.max(1, sampleRate * settings.decay));
  const filterAmount = clamp(
    .04 + settings.damping * .7 + (1 - settings.brightness) * .24,
    .02,
    .97,
  );
  const dispersion = settings.dispersion * .16;
  const chorusAmount = settings.chorusDepth * 1.75;
  const driveGain = 1 + settings.drive * 9;
  let dcState = 0;

  for (let index = 0; index < frameCount; index += 1) {
    const modulation = Math.sin(
      Math.PI * 2 * settings.chorusRate * index / sampleRate,
    ) * chorusAmount;
    const readPosition = index - Math.max(2, period + modulation);
    let feedback = 0;

    if (readPosition >= 0) {
      const baseIndex = Math.floor(readPosition);
      const fraction = readPosition - baseIndex;
      const nextIndex = Math.min(index - 1, baseIndex + 1);
      const delayed = loopSamples[baseIndex] * (1 - fraction)
        + loopSamples[nextIndex] * fraction;
      const earlier = loopSamples[Math.max(0, baseIndex - 1)];
      const lowPassed = delayed * (1 - filterAmount)
        + (delayed + earlier) * .5 * filterAmount;
      const dispersed = lowPassed + (delayed - earlier) * dispersion;
      dcState += (dispersed - dcState) * (.0005 + settings.lowCut * .055);
      const highPassed = dispersed - dcState * settings.lowCut;
      const roughness = (clamp(finiteOr(random(), .5), 0, 1) * 2 - 1)
        * settings.roughness * .008 * Math.max(.08, Math.abs(highPassed));
      feedback = (highPassed + roughness) * loopGain * settings.polarity;
      if (settings.drive > .0001) {
        feedback = Math.tanh(feedback * driveGain) / driveGain;
      }
    }

    let strike = 0;
    if (index < excitationFrames) {
      const reflected = excitation[(index + pickOffset) % excitationFrames];
      strike = (excitation[index] - reflected * settings.pickWidth) * excitationGain;
    }
    loopSamples[index] = clamp(feedback + strike, -1, 1);
  }

  const pickupOffset = Math.max(1, Math.round(period * settings.pickupPosition));
  const pickupScale = 1 / (1 + settings.pickupMix * .45);
  for (let index = 0; index < frameCount; index += 1) {
    const opposite = index >= pickupOffset ? loopSamples[index - pickupOffset] : 0;
    samples[index] = clamp(
      (loopSamples[index] - opposite * settings.pickupMix) * pickupScale,
      -1,
      1,
    );
  }

  return samples;
}

function cancelledStartError() {
  const error = new Error("Karplus Strong audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

export class KarplusStrongAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    this.releaseAudioOutput = null;
    this.activeVoices = [];
    this.output = KARPLUS_STRONG_DEFAULTS.level;
    this.lifecycleGeneration = 0;
  }

  async start() {
    const generation = this.lifecycleGeneration;
    let context = this.context;
    if (!context || context.state === "closed") {
      this.releaseAudioOutput?.();
      const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is not available in this browser.");
      context = new Context();
      this.context = context;
      this.input = context.createGain();
      this.input.gain.value = .72;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = .002;
      compressor.release.value = .18;
      this.master = context.createGain();
      this.master.gain.value = this.output;
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = .78;
      this.input.connect(compressor);
      compressor.connect(this.master);
      this.master.connect(this.analyser);
      this.releaseAudioOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });
    }
    if (context.state === "suspended") {
      unlockAudioContext(context);
      await context.resume();
    }
    if (
      generation !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) throw cancelledStartError();
    return context;
  }

  setOutput(value) {
    this.output = clamp(finiteOr(value, KARPLUS_STRONG_DEFAULTS.level), 0, .85);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.output, this.context.currentTime, .015);
    }
  }

  async pluck(frequency, sourceSettings = {}, options = {}) {
    const context = await this.start();
    if (context !== this.context || context.state === "closed") throw cancelledStartError();
    const settings = sanitizeKarplusStrongSettings({ ...sourceSettings, frequency });
    const velocity = clamp(finiteOr(options.velocity, .82), .05, 1);
    const pan = clamp(finiteOr(options.pan, 0), -1, 1) * settings.spread;
    const now = context.currentTime + clamp(finiteOr(options.delay, 0), 0, .12);
    this.#playVoice(settings, velocity, pan, now);

    const coupledFrequency = settings.frequency
      * settings.couplingRatio
      * (2 ** (settings.couplingDetune / 1_200));
    if (settings.coupling > .015 && coupledFrequency < context.sampleRate * .22) {
      const coupled = {
        ...settings,
        frequency: coupledFrequency,
        decay: Math.max(.2, settings.decay * (.42 + settings.coupling * .28)),
        damping: clamp(settings.damping + .12, 0, 1),
        brightness: clamp(settings.brightness - .08, 0, 1),
        hardness: settings.hardness * .72,
        pickPosition: 1 - settings.pickPosition,
        pickupPosition: 1 - settings.pickupPosition,
        coupling: 0,
      };
      this.#playVoice(
        coupled,
        velocity * settings.coupling * .32,
        -pan,
        now + .006,
      );
    }
    return settings;
  }

  #playVoice(settings, velocity, pan, now) {
    const context = this.context;
    const samples = generateKarplusStrongSamples({
      ...settings,
      sampleRate: context.sampleRate,
    });
    const buffer = context.createBuffer(1, samples.length, context.sampleRate);
    if (typeof buffer.copyToChannel === "function") buffer.copyToChannel(samples, 0);
    else buffer.getChannelData(0).set(samples);

    const source = context.createBufferSource();
    const tone = context.createBiquadFilter();
    const body = context.createBiquadFilter();
    const gain = context.createGain();
    const panner = typeof context.createStereoPanner === "function"
      ? context.createStereoPanner()
      : null;
    source.buffer = buffer;
    tone.type = "lowpass";
    tone.frequency.value = Math.min(
      context.sampleRate * .44,
      500 + settings.brightness ** 1.45 * 19_000,
    );
    tone.Q.value = .3 + settings.dispersion * 1.1;
    body.type = "peaking";
    body.frequency.value = Math.min(
      context.sampleRate * .4,
      settings.frequency * settings.bodyTune,
    );
    body.Q.value = settings.bodyQ;
    body.gain.value = settings.body * 12;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.linearRampToValueAtTime(Math.max(.0002, velocity * .58), now + .003);
    gain.gain.exponentialRampToValueAtTime(.0001, now + samples.length / context.sampleRate);
    source.connect(tone).connect(body).connect(gain);
    if (panner) {
      panner.pan.value = pan;
      gain.connect(panner).connect(this.input);
    } else {
      gain.connect(this.input);
    }
    source.start(now);

    const voice = { source, gain, nodes: [source, tone, body, gain, panner] };
    this.activeVoices = this.activeVoices.filter((candidate) => candidate.source !== null);
    while (this.activeVoices.length >= 18) {
      const oldest = this.activeVoices.shift();
      if (!oldest) break;
      try {
        oldest.gain.gain.setTargetAtTime(0, context.currentTime, .008);
        oldest.source?.stop(context.currentTime + .03);
      } catch {
        // The oldest voice can already be ending.
      }
    }
    this.activeVoices.push(voice);
    source.onended = () => {
      for (const node of voice.nodes) {
        try { node?.disconnect?.(); } catch { /* already disconnected */ }
      }
      voice.source = null;
      this.activeVoices = this.activeVoices.filter((candidate) => candidate !== voice);
    };
  }

  async close() {
    this.lifecycleGeneration += 1;
    const context = this.context;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.input = null;
    this.master = null;
    this.analyser = null;
    for (const voice of this.activeVoices) {
      try { voice.source?.stop(); } catch { /* already stopped */ }
    }
    this.activeVoices = [];
    if (context && context.state !== "closed") await context.close();
  }
}

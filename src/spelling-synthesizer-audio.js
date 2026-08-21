import { unlockAudioContext } from "./audio.js";
import { connectAudioOutput } from "./audio-output-manager.js";
import {
  MAX_THROATS,
  alienTongueDeformations,
  calibratedOutputGain,
  clamp,
  consonantVoiceParameters,
  glottalHarmonics,
} from "./throatazoid.js";
import {
  SPELLING_PERSONALITIES,
  spellingEngine,
  spellingPerformanceState,
} from "./spelling-synthesizer.js";
import {
  SPELLING_DIPHONE_ATLAS_URL,
  SPELLING_DIPHONE_CLIPS,
  spellingDiphoneClipKey,
} from "./spelling-diphone-atlas.js";

const MIN_GAIN = 0.0001;

const ARTICULATION_TRACT_INDICES = Object.freeze({
  glottal: 1,
  h: 9,
  k: 22,
  g: 22,
  q: 22,
  ng: 22,
  w: 22,
  x: 24,
  y: 29,
  sh: 31,
  c: 31,
  j: 31,
  r: 31,
  th: 41,
  dh: 41,
  t: 36,
  d: 36,
  l: 36,
  s: 36,
  z: 36,
  n: 36,
  p: 41,
  b: 41,
  f: 41,
  v: 41,
  m: 41,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function audioStartCancelled() {
  const error = new Error("Audio start was cancelled.");
  error.name = "AbortError";
  return error;
}

function contextConstructor(runtime) {
  return runtime?.AudioContext ?? runtime?.webkitAudioContext;
}

function connect(source, destination, output, input) {
  source?.connect?.(destination, output, input);
  return destination;
}

function createNoiseSource(audio, seconds = 2) {
  const sampleRate = audio.sampleRate || 48_000;
  const buffer = audio.createBuffer(1, Math.ceil(sampleRate * seconds), sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0x51f15e3d;
  let brown = 0;
  for (let index = 0; index < samples.length; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const white = seed / 0x8000_0000 - 1;
    brown = brown * 0.96 + white * 0.04;
    samples[index] = clamp(white * 0.78 + brown * 1.35, -1, 1);
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.start();
  return source;
}

function hold(parameter, at, fallback = 0) {
  if (!parameter) return;
  if (typeof parameter.cancelAndHoldAtTime === "function") {
    try {
      parameter.cancelAndHoldAtTime(at);
      return;
    } catch {
      // Safari exposes this method in versions where it can still reject.
    }
  }
  parameter.cancelScheduledValues?.(at);
  parameter.setValueAtTime?.(finite(parameter.value, fallback), at);
}

function smooth(parameter, value, at, timeConstant = 0.018) {
  if (!parameter) return;
  const target = finite(value);
  hold(parameter, at, target);
  if (typeof parameter.setTargetAtTime === "function") {
    parameter.setTargetAtTime(target, at, Math.max(0.001, timeConstant));
  } else {
    parameter.value = target;
  }
}

function envelope(parameter, {
  at,
  peak,
  attack,
  duration,
  release,
} = {}) {
  if (!parameter) return;
  const start = finite(at);
  const attackSeconds = Math.max(0.002, finite(attack, 0.012));
  const durationSeconds = Math.max(attackSeconds + 0.018, finite(duration, 0.24));
  const releaseSeconds = Math.min(
    Math.max(0.008, finite(release, 0.06)),
    durationSeconds * 0.64,
  );
  const peakGain = Math.max(MIN_GAIN, finite(peak, 0.2));
  const end = start + durationSeconds;
  const releaseStart = Math.max(start + attackSeconds, end - releaseSeconds);
  hold(parameter, start, MIN_GAIN);
  parameter.setValueAtTime?.(Math.max(MIN_GAIN, finite(parameter.value, MIN_GAIN)), start);
  parameter.linearRampToValueAtTime?.(peakGain, start + attackSeconds);
  parameter.setValueAtTime?.(peakGain, releaseStart);
  parameter.linearRampToValueAtTime?.(MIN_GAIN, end);
}

function sustainedEnvelope(parameter, {
  at,
  peak,
  attack,
} = {}) {
  if (!parameter) return;
  const start = finite(at);
  const attackSeconds = Math.max(0.002, finite(attack, 0.012));
  const peakGain = Math.max(MIN_GAIN, finite(peak, 0.2));
  hold(parameter, start, MIN_GAIN);
  parameter.setValueAtTime?.(Math.max(MIN_GAIN, finite(parameter.value, MIN_GAIN)), start);
  parameter.linearRampToValueAtTime?.(peakGain, start + attackSeconds);
}

function configureCompressor(node, audio, { vocoder = false } = {}) {
  const at = audio.currentTime;
  node.threshold?.setValueAtTime?.(vocoder ? -10 : -17, at);
  node.knee?.setValueAtTime?.(vocoder ? 12 : 9, at);
  node.ratio?.setValueAtTime?.(vocoder ? 3.2 : 10, at);
  node.attack?.setValueAtTime?.(vocoder ? 0.006 : 0.003, at);
  node.release?.setValueAtTime?.(vocoder ? 0.11 : 0.16, at);
}

function periodicGlottis(audio, oscillator, tenseness = 0.58) {
  if (!oscillator?.setPeriodicWave || !audio?.createPeriodicWave) {
    if (oscillator) oscillator.type = "sawtooth";
    return;
  }
  try {
    const { real, imaginary } = glottalHarmonics(tenseness, 48, 1_024);
    oscillator.setPeriodicWave(audio.createPeriodicWave(real, imaginary));
  } catch {
    oscillator.type = "sawtooth";
  }
}

function saturationCurve(amount = 0, size = 2_048) {
  const drive = clamp(finite(amount));
  const curve = new Float32Array(size);
  const shaping = 1 + drive * 18;
  const normalization = Math.tanh(shaping);
  for (let index = 0; index < size; index += 1) {
    const input = index / (size - 1) * 2 - 1;
    curve[index] = drive < 0.001
      ? input
      : Math.tanh(input * shaping) / normalization;
  }
  return curve;
}

function toneFrequency(value = 1) {
  const normalized = clamp(finite(value, 1));
  return 1_200 * (14_000 / 1_200) ** normalized;
}

function personalityFor(event) {
  return SPELLING_PERSONALITIES[event?.personality]
    ?? SPELLING_PERSONALITIES.clear;
}

function articulationIndex(performance) {
  return ARTICULATION_TRACT_INDICES[performance.phoneme]
    ?? clamp(12 + clamp(performance.articulationPlace) * 30, 2, 42);
}

function physicalConfig(performance, sampleRate, sounding = true) {
  const consonant = consonantVoiceParameters(
    performance.phoneme,
    "hold",
    sampleRate,
  );
  return {
    mouthCount: performance.throatCount,
    throatCount: performance.throatCount,
    selectedMouth: 0,
    articulateAll: true,
    bodyLength: performance.bodyLength,
    tension: performance.tension,
    mutation: performance.mutation,
    coupling: performance.coupling,
    spread: performance.spread,
    oralClosure: performance.oralClosure,
    lipDiameter: performance.lipDiameter,
    articulationPlace: performance.articulationPlace,
    articulationIndex: articulationIndex(performance),
    articulationAperture: performance.articulationAperture,
    articulationVoicing: performance.articulationVoicing,
    glottalClosure: performance.glottalClosure,
    nasalCoupling: performance.nasalCoupling,
    articulationManner: performance.articulationManner,
    fricationGain: consonant?.fricationGain ?? 1,
    burstGain: consonant?.burstGain ?? 0,
    exciterIntensity: performance.exciterIntensity,
    classicTopology: Boolean(performance.classicTopology),
    voiceMode: performance.voiceMode,
    performanceGate: sounding ? 1 : 0,
    pressureSourceCount: performance.pressureSourceCount,
    pressureSources: performance.pressureSources.map((source) => ({
      open: Boolean(source.open),
      level: source.level,
    })),
    tongueCount: performance.tongueCount,
    noseCount: performance.noseCount,
    mouths: performance.throats.map((mouth) => ({
      aperture: mouth.aperture,
      length: mouth.length,
      closed: Boolean(mouth.muted),
    })),
    throats: performance.throats.map((throat) => ({
      aperture: throat.aperture,
      length: throat.length,
      muted: Boolean(throat.muted),
    })),
    tongues: performance.tongues.map((tongue) => ({
      position: tongue.position,
      height: tongue.height,
      curl: tongue.curl,
    })),
    tractDeformations: alienTongueDeformations(performance),
    noses: performance.noses.map((nose) => ({
      openness: nose.openness,
      length: nose.length,
      resonance: nose.resonance,
    })),
  };
}

class TubeSpellingEngine {
  constructor({ runtime = globalThis, level = 0.46 } = {}) {
    this.runtime = runtime;
    this.level = clamp(level, 0, 0.82);
    this.context = null;
    this.node = null;
    this.master = null;
    this.releaseAudioOutput = null;
    this.pulse = null;
    this.pulseGain = null;
    this.pulseModGain = null;
    this.breathGain = null;
    this.breathModGain = null;
    this.noise = null;
    this.saturation = null;
    this.tone = null;
    this.dryGain = null;
    this.echoDelay = null;
    this.echoFeedback = null;
    this.echoGain = null;
    this.effectsBus = null;
    this.effects = {
      drive: 0,
      tone: 1,
      echo: 0,
      delayMs: 185,
      feedback: 0.24,
    };
    this.currentEvent = null;
    this.currentPerformance = null;
    this.currentConfiguredPerformance = null;
    this.lastMutationOffset = 0;
    this.currentPulsePeak = MIN_GAIN;
    this.currentBreathPeak = MIN_GAIN;
    this.articulationTimer = 0;
    this.releaseTimer = 0;
    this.silenceTimer = 0;
    this.enabled = false;
    this.lifecycleGeneration = 0;
  }

  get running() {
    return Boolean(this.enabled && this.context?.state === "running");
  }

  clearTimers() {
    this.runtime.clearTimeout?.(this.articulationTimer);
    this.runtime.clearTimeout?.(this.releaseTimer);
    this.runtime.clearTimeout?.(this.silenceTimer);
    this.articulationTimer = 0;
    this.releaseTimer = 0;
    this.silenceTimer = 0;
  }

  async enable() {
    const generation = this.lifecycleGeneration;
    if (!this.context || this.context.state === "closed") await this.build(generation);
    if (generation !== this.lifecycleGeneration || !this.context || !this.master) {
      throw audioStartCancelled();
    }
    const audio = this.context;
    unlockAudioContext(audio);
    if (audio.state !== "running") await audio.resume?.();
    if (
      generation !== this.lifecycleGeneration
      || this.context !== audio
      || !this.master
      || audio.state !== "running"
    ) throw audioStartCancelled();
    this.enabled = true;
    smooth(this.master.gain, calibratedOutputGain(this.level), audio.currentTime, 0.012);
    return this;
  }

  async build(generation = this.lifecycleGeneration) {
    const Audio = contextConstructor(this.runtime);
    const WorkletNode = this.runtime?.AudioWorkletNode ?? globalThis.AudioWorkletNode;
    if (typeof Audio !== "function" || typeof WorkletNode !== "function") {
      throw new Error("The tube engine needs AudioWorklet support.");
    }
    const audio = new Audio({ latencyHint: "interactive" });
    let pulse = null;
    let noise = null;
    this.context = audio;
    try {
      if (!audio.audioWorklet?.addModule) {
        throw new Error("The tube engine needs AudioWorklet support.");
      }
      // Consume the current keyboard/pointer activation before loading the
      // worklet so mobile browsers do not lose the transient audio gesture.
      unlockAudioContext(audio);
      const resumePromise = audio.state !== "running" ? audio.resume?.() : null;
      await Promise.all([
        audio.audioWorklet.addModule(
          new URL("./throatazoid-tract-processor.js", import.meta.url),
        ),
        resumePromise,
      ]);
      if (
        generation !== this.lifecycleGeneration
        || this.context !== audio
        || audio.state === "closed"
      ) throw audioStartCancelled();

      const node = new WorkletNode(audio, "throatazoid-tract", {
        numberOfInputs: 1 + MAX_THROATS,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 1,
        channelCountMode: "explicit",
      });
      const sourceBus = audio.createGain();
      pulse = audio.createOscillator();
      const pulseLowpass = audio.createBiquadFilter();
      const pulseGain = audio.createGain();
      const pulseModGain = audio.createGain();
      const breathHighpass = audio.createBiquadFilter();
      const breathLowpass = audio.createBiquadFilter();
      const breathGain = audio.createGain();
      const breathModGain = audio.createGain();
      noise = createNoiseSource(audio);
      const compressor = audio.createDynamicsCompressor();
      const saturation = typeof audio.createWaveShaper === "function"
        ? audio.createWaveShaper()
        : audio.createGain();
      const tone = audio.createBiquadFilter();
      const dryGain = audio.createGain();
      const echoDelay = audio.createDelay(1.2);
      const echoFeedback = audio.createGain();
      const echoGain = audio.createGain();
      const effectsBus = audio.createGain();
      const master = audio.createGain();

      sourceBus.gain.value = 0.86;
      pulse.frequency.value = 140;
      periodicGlottis(audio, pulse, 0.58);
      pulseLowpass.type = "lowpass";
      pulseLowpass.frequency.value = 7_000;
      pulseLowpass.Q.value = 0.72;
      pulseGain.gain.value = MIN_GAIN;
      pulseModGain.gain.value = 1;
      breathHighpass.type = "highpass";
      breathHighpass.frequency.value = 360;
      breathLowpass.type = "lowpass";
      breathLowpass.frequency.value = 8_400;
      breathGain.gain.value = MIN_GAIN;
      breathModGain.gain.value = 1;
      if ("curve" in saturation) {
        saturation.curve = saturationCurve(this.effects.drive);
        saturation.oversample = "2x";
      }
      tone.type = "lowpass";
      tone.frequency.value = toneFrequency(this.effects.tone);
      tone.Q.value = 0.45;
      dryGain.gain.value = 1;
      echoDelay.delayTime.value = this.effects.delayMs / 1_000;
      echoFeedback.gain.value = this.effects.feedback;
      echoGain.gain.value = this.effects.echo;
      effectsBus.gain.value = 1;
      master.gain.value = 0;
      configureCompressor(compressor, audio);

      connect(pulse, pulseLowpass);
      connect(pulseLowpass, pulseGain);
      connect(pulseGain, pulseModGain);
      connect(pulseModGain, sourceBus);
      connect(noise, breathHighpass);
      connect(breathHighpass, breathLowpass);
      connect(breathLowpass, breathGain);
      connect(breathGain, breathModGain);
      connect(breathModGain, sourceBus);
      connect(sourceBus, node, 0, 0);
      connect(node, saturation);
      connect(saturation, tone);
      connect(tone, dryGain);
      connect(dryGain, effectsBus);
      connect(tone, echoDelay);
      connect(echoDelay, echoGain);
      connect(echoGain, effectsBus);
      connect(echoDelay, echoFeedback);
      connect(echoFeedback, echoDelay);
      connect(effectsBus, compressor);
      connect(compressor, master);
      this.releaseAudioOutput = connectAudioOutput(audio, master, { runtime: this.runtime });
      pulse.start();

      this.node = node;
      this.master = master;
      this.pulse = pulse;
      this.pulseGain = pulseGain;
      this.pulseModGain = pulseModGain;
      this.breathGain = breathGain;
      this.breathModGain = breathModGain;
      this.noise = noise;
      this.saturation = saturation;
      this.tone = tone;
      this.dryGain = dryGain;
      this.echoDelay = echoDelay;
      this.echoFeedback = echoFeedback;
      this.echoGain = echoGain;
      this.effectsBus = effectsBus;
    } catch (error) {
      try { pulse?.stop?.(); } catch {}
      try { noise?.stop?.(); } catch {}
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      if (this.context === audio) this.context = null;
      if (audio.state !== "closed") {
        try { await audio.close?.(); } catch {}
      }
      throw error;
    }
  }

  configure(performance, sounding = true) {
    if (!this.node || !this.context || !performance) return;
    this.currentConfiguredPerformance = performance;
    this.node.port.postMessage({
      type: "configure",
      state: physicalConfig(performance, this.context.sampleRate || 48_000, sounding),
    });
  }

  setLevel(value) {
    this.level = clamp(value, 0, 0.82);
    if (this.running) {
      smooth(this.master.gain, calibratedOutputGain(this.level), this.context.currentTime, 0.012);
    }
  }

  setEffects(options = {}) {
    this.effects = {
      drive: clamp(finite(options.drive, this.effects.drive)),
      tone: clamp(finite(options.tone, this.effects.tone)),
      echo: clamp(finite(options.echo, this.effects.echo), 0, 0.62),
      delayMs: clamp(finite(options.delayMs, this.effects.delayMs), 45, 900),
      feedback: clamp(finite(options.feedback, this.effects.feedback), 0, 0.72),
    };
    if (this.saturation && "curve" in this.saturation) {
      this.saturation.curve = saturationCurve(this.effects.drive);
    }
    if (this.context) {
      const now = this.context.currentTime;
      smooth(this.tone?.frequency, toneFrequency(this.effects.tone), now, 0.025);
      smooth(this.echoDelay?.delayTime, this.effects.delayMs / 1_000, now, 0.025);
      smooth(this.echoFeedback?.gain, this.effects.feedback, now, 0.025);
      smooth(this.echoGain?.gain, this.effects.echo, now, 0.025);
    }
    return Object.freeze({ ...this.effects });
  }

  durationMs(event) {
    const dynamics = event?.dynamics ?? {};
    return Math.max(
      0,
      finite(dynamics.durationMs) + finite(dynamics.releaseMs) + 18,
    );
  }

  articulate(event) {
    if (!this.running || !event?.performance) return false;
    this.clearTimers();
    this.currentEvent = event;
    const { performance, dynamics } = event;
    this.currentPerformance = performance;
    this.lastMutationOffset = 0;
    const now = this.context.currentTime;
    const duration = dynamics.durationMs / 1_000;
    const release = dynamics.releaseMs / 1_000;
    periodicGlottis(this.context, this.pulse, performance.exciterTenseness);
    smooth(this.pulse.frequency, performance.exciterPitch, now, 0.012);
    smooth(this.pulseGain.gain, MIN_GAIN, now, 0.002);
    smooth(this.breathGain.gain, MIN_GAIN, now, 0.002);
    const manner = performance.articulationManner;
    const sustainedVowel = Boolean(event.sustain && manner === "vowel");
    const ksCluster = performance.phoneme === "x";
    const affricate = manner === "affricate";
    const ksPerformance = ksCluster
      ? ["k", "s"].map((articulation) => spellingPerformanceState({
        personality: event.personality,
        articulation,
        carrierVowel: event.carrierVowel,
        dynamics,
      }))
      : null;
    const initialPerformance = ksCluster
      ? ksPerformance[0]
      : affricate
      ? {
        ...performance,
        oralClosure: 1,
        articulationAperture: 0,
        articulationManner: "stop",
      }
      : performance;
    this.configure(initialPerformance, true);
    const shapeEnvelope = sustainedVowel ? sustainedEnvelope : envelope;
    this.currentPulsePeak = performance.exciterIntensity
      * (0.18 + performance.exciterTenseness * 0.31)
      * (0.018 + performance.articulationVoicing * 0.982)
      * dynamics.velocity;
    this.currentBreathPeak = performance.exciterIntensity
      * (performance.exciterBreath + (1 - performance.articulationVoicing) * 0.42)
      * (0.2 + (1 - performance.exciterTenseness) * 0.34)
      * dynamics.velocity;
    shapeEnvelope(this.pulseGain.gain, {
      at: now,
      peak: this.currentPulsePeak,
      attack: dynamics.attackMs / 1_000,
      duration,
      release,
    });
    shapeEnvelope(this.breathGain.gain, {
      at: now,
      peak: this.currentBreathPeak,
      attack: Math.max(0.004, dynamics.attackMs / 1_000 * 0.7),
      duration,
      release,
    });

    const stopLike = manner === "stop" || manner === "affricate";
    const approximant = manner === "approximant";
    const nasal = manner === "nasal";
    if (ksCluster) {
      const closureDelay = clamp(dynamics.durationMs * 0.22, 52, 75);
      const fricationDuration = clamp(dynamics.durationMs * 0.28, 65, 95);
      this.articulationTimer = this.runtime.setTimeout?.(() => {
        this.articulationTimer = 0;
        if (this.currentEvent !== event) return;
        this.configure(ksPerformance[1], true);
      }, closureDelay) ?? 0;
      if (event.carrierPerformance) {
        this.releaseTimer = this.runtime.setTimeout?.(() => {
          this.releaseTimer = 0;
          if (this.currentEvent !== event) return;
          this.configure(event.carrierPerformance, true);
        }, closureDelay + fricationDuration) ?? 0;
      }
    } else if (affricate) {
      const closureDelay = clamp(dynamics.durationMs * 0.22, 52, 75);
      const fricationDuration = clamp(dynamics.durationMs * 0.24, 54, 88);
      this.articulationTimer = this.runtime.setTimeout?.(() => {
        this.articulationTimer = 0;
        if (this.currentEvent !== event) return;
        this.configure(performance, true);
      }, closureDelay) ?? 0;
      if (event.carrierPerformance) {
        this.releaseTimer = this.runtime.setTimeout?.(() => {
          this.releaseTimer = 0;
          if (this.currentEvent !== event) return;
          this.configure(event.carrierPerformance, true);
        }, closureDelay + fricationDuration) ?? 0;
      }
    } else if ((stopLike || approximant || nasal) && event.carrierPerformance) {
      const phoneme = performance.phoneme;
      const transitionDelay = stopLike
        ? Math.max(62, dynamics.durationMs * 0.36)
        : nasal
          ? clamp(dynamics.durationMs * 0.3, 70, 100)
        : phoneme === "l"
          ? clamp(dynamics.durationMs * 0.28, 60, 90)
          : phoneme === "r"
            ? clamp(dynamics.durationMs * 0.32, 72, 110)
            : clamp(dynamics.durationMs * 0.22, 45, 68);
      this.releaseTimer = this.runtime.setTimeout?.(() => {
        this.releaseTimer = 0;
        if (this.currentEvent !== event) return;
        this.configure(event.carrierPerformance, true);
      }, transitionDelay) ?? 0;
    }
    if (!sustainedVowel) {
      this.silenceTimer = this.runtime.setTimeout?.(() => {
        this.silenceTimer = 0;
        if (this.currentEvent !== event) return;
        this.configure(event.carrierPerformance ?? performance, false);
      }, dynamics.durationMs + dynamics.releaseMs + 18) ?? 0;
    }
    return true;
  }

  modulate({
    pitchCents = 0,
    amplitude = 1,
    breath = 0,
    mutation = 0,
    performance = null,
  } = {}) {
    if (!this.running || !this.currentPerformance || !this.context) return false;
    const now = this.context.currentTime;
    const pitchRatio = 2 ** (clamp(finite(pitchCents), -240, 240) / 1_200);
    const amplitudeScale = clamp(finite(amplitude, 1), 0, 1.6);
    const breathOffset = clamp(finite(breath), -1, 1);
    const authoredPerformance = performance ?? this.currentPerformance;
    smooth(
      this.pulse?.frequency,
      authoredPerformance.exciterPitch * pitchRatio,
      now,
      0.009,
    );
    // Modulation gains sit after the authored articulation envelopes. Keeping
    // them separate means an LFO cannot cancel a consonant release or reopen a
    // stop by repeatedly replacing scheduled envelope values.
    smooth(this.pulseModGain?.gain, amplitudeScale, now, 0.012);
    smooth(
      this.breathModGain?.gain,
      clamp(amplitudeScale * (1 + breathOffset), 0, 2),
      now,
      0.014,
    );
    const mutationOffset = clamp(finite(mutation), -1, 1);
    if (
      performance
      || Math.abs(mutationOffset) > 0.0001
      || Math.abs(this.lastMutationOffset) > 0.0001
    ) {
      const configured = this.currentConfiguredPerformance ?? authoredPerformance;
      const tongues = configured.tongues?.map((tongue, index) => ({
        ...tongue,
        ...(index === 0 && authoredPerformance.tongues?.[0] ? {
          position: authoredPerformance.tongues[0].position,
          height: authoredPerformance.tongues[0].height,
          curl: authoredPerformance.tongues[0].curl,
        } : {}),
      })) ?? [];
      this.configure({
        ...configured,
        exciterPitch: authoredPerformance.exciterPitch,
        exciterIntensity: authoredPerformance.exciterIntensity,
        exciterBreath: authoredPerformance.exciterBreath,
        lipDiameter: authoredPerformance.lipDiameter,
        nasalCoupling: authoredPerformance.nasalCoupling,
        mutation: clamp(authoredPerformance.mutation + mutationOffset),
        tongues,
      }, true);
    }
    this.lastMutationOffset = mutationOffset;
    return true;
  }

  release({ releaseMs = 55, performance } = {}) {
    if (!this.context || !this.pulseGain || !this.breathGain) return false;
    this.clearTimers();
    const now = this.context.currentTime;
    smooth(this.pulseGain.gain, MIN_GAIN, now, Math.max(0.005, releaseMs / 3_000));
    smooth(this.breathGain.gain, MIN_GAIN, now, Math.max(0.005, releaseMs / 3_000));
    this.configure(performance ?? this.currentEvent?.carrierPerformance ?? this.currentEvent?.performance, false);
    this.currentEvent = null;
    this.currentPerformance = null;
    this.currentConfiguredPerformance = null;
    this.lastMutationOffset = 0;
    return true;
  }

  async disable() {
    this.lifecycleGeneration += 1;
    this.enabled = false;
    this.release();
    if (this.context) {
      const audio = this.context;
      if (!this.master) {
        this.context = null;
        if (audio.state !== "closed") await audio.close?.();
        return;
      }
      const now = audio.currentTime;
      for (const parameter of [
        this.pulseGain?.gain,
        this.breathGain?.gain,
        this.master?.gain,
      ]) {
        if (!parameter) continue;
        hold(parameter, now, 0);
        parameter.setValueAtTime?.(parameter === this.master?.gain ? 0 : MIN_GAIN, now);
      }
      if (audio.state !== "closed") await audio.suspend?.();
    }
  }

  async close() {
    this.lifecycleGeneration += 1;
    this.clearTimers();
    this.enabled = false;
    try { this.pulse?.stop?.(); } catch {}
    try { this.noise?.stop?.(); } catch {}
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    await this.context?.close?.();
    this.context = null;
    this.node = null;
    this.master = null;
    this.releaseAudioOutput = null;
    this.pulse = null;
    this.pulseGain = null;
    this.pulseModGain = null;
    this.breathGain = null;
    this.breathModGain = null;
    this.noise = null;
    this.saturation = null;
    this.tone = null;
    this.dryGain = null;
    this.echoDelay = null;
    this.echoFeedback = null;
    this.echoGain = null;
    this.effectsBus = null;
    this.currentPerformance = null;
    this.currentConfiguredPerformance = null;
    this.lastMutationOffset = 0;
  }
}

function decodeAudioData(audio, bytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (buffer) => {
      if (settled) return;
      settled = true;
      resolve(buffer);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      const result = audio.decodeAudioData(bytes, succeed, fail);
      if (result?.then) result.then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}

class DiphoneSpellingEngine {
  constructor({ runtime = globalThis, level = 0.46, vocoder = false } = {}) {
    this.runtime = runtime;
    this.level = clamp(level, 0, 0.82);
    this.vocoder = Boolean(vocoder);
    this.context = null;
    this.buffer = null;
    this.sourceBus = null;
    this.tone = null;
    this.vocoderNode = null;
    this.master = null;
    this.releaseAudioOutput = null;
    this.active = new Set();
    this.enabled = false;
    this.lifecycleGeneration = 0;
    this.buildAbortController = null;
  }

  get running() {
    return Boolean(this.enabled && this.buffer && this.context?.state === "running");
  }

  async enable() {
    const generation = this.lifecycleGeneration;
    if (!this.context || this.context.state === "closed") await this.build(generation);
    if (
      generation !== this.lifecycleGeneration
      || !this.context
      || !this.buffer
      || !this.master
    ) throw audioStartCancelled();
    const audio = this.context;
    unlockAudioContext(audio);
    if (audio.state !== "running") await audio.resume?.();
    if (
      generation !== this.lifecycleGeneration
      || this.context !== audio
      || !this.buffer
      || !this.master
      || audio.state !== "running"
    ) throw audioStartCancelled();
    this.enabled = true;
    smooth(
      this.master.gain,
      calibratedOutputGain(this.level),
      audio.currentTime,
      0.012,
    );
    return this;
  }

  async build(generation = this.lifecycleGeneration) {
    const Audio = contextConstructor(this.runtime);
    const WorkletNode = this.runtime?.AudioWorkletNode ?? globalThis.AudioWorkletNode;
    const fetchAudio = this.runtime?.fetch ?? globalThis.fetch;
    const AbortControllerConstructor = this.runtime?.AbortController
      ?? globalThis.AbortController;
    if (typeof Audio !== "function" || typeof fetchAudio !== "function") {
      throw new Error("The diphone engine needs Web Audio and fetch support.");
    }
    if (this.vocoder && typeof WorkletNode !== "function") {
      throw new Error("The vocoder engine needs AudioWorklet support.");
    }
    const audio = new Audio({ latencyHint: "interactive" });
    const abortController = typeof AbortControllerConstructor === "function"
      ? new AbortControllerConstructor()
      : null;
    this.buildAbortController = abortController;
    this.context = audio;
    try {
      unlockAudioContext(audio);
      const resumePromise = audio.state !== "running" ? audio.resume?.() : null;
      const workletPromise = this.vocoder
        ? audio.audioWorklet?.addModule?.(
          new URL("./spelling-vocoder-processor.js", import.meta.url),
        )
        : null;
      if (this.vocoder && !workletPromise) {
        throw new Error("The vocoder engine needs AudioWorklet support.");
      }
      const responsePromise = fetchAudio.call(
        this.runtime,
        SPELLING_DIPHONE_ATLAS_URL,
        abortController ? { signal: abortController.signal } : undefined,
      );
      const [response] = await Promise.all([
        responsePromise,
        workletPromise,
        resumePromise,
      ]);
      if (!response || response.ok === false) {
        throw new Error("The diphone voice sample could not be loaded.");
      }
      const bytes = await response.arrayBuffer();
      const buffer = await decodeAudioData(audio, bytes);
      if (
        generation !== this.lifecycleGeneration
        || this.context !== audio
        || audio.state === "closed"
      ) throw audioStartCancelled();
      const frameDuration = finite(buffer?.length)
        / Math.max(1, finite(buffer?.sampleRate, 1));
      const decodedDuration = finite(buffer?.duration, frameDuration);
      const finalClipEnd = Math.max(...Object.values(SPELLING_DIPHONE_CLIPS)
        .map((clip) => clip.offset + clip.duration));
      if (decodedDuration > 0 && finalClipEnd > decodedDuration + 0.002) {
        throw new Error("The diphone voice sample does not match its atlas.");
      }

      const sourceBus = audio.createGain();
      const tone = audio.createBiquadFilter();
      const compressor = audio.createDynamicsCompressor();
      const master = audio.createGain();
      sourceBus.gain.value = this.vocoder ? 1.1 : 0.92;
      tone.type = "lowpass";
      tone.frequency.value = this.vocoder ? 11_500 : 9_200;
      tone.Q.value = 0.38;
      master.gain.value = 0;
      configureCompressor(compressor, audio, { vocoder: this.vocoder });
      connect(sourceBus, tone);
      let vocoderNode = null;
      if (this.vocoder) {
        vocoderNode = new WorkletNode(audio, "spelling-vocoder", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 1,
          channelCountMode: "explicit",
        });
        connect(tone, vocoderNode);
        connect(vocoderNode, compressor);
      } else connect(tone, compressor);
      connect(compressor, master);
      this.releaseAudioOutput = connectAudioOutput(audio, master, { runtime: this.runtime });

      this.buffer = buffer;
      this.sourceBus = sourceBus;
      this.tone = tone;
      this.vocoderNode = vocoderNode;
      this.master = master;
      if (this.buildAbortController === abortController) {
        this.buildAbortController = null;
      }
    } catch (error) {
      const cancelled = abortController?.signal?.aborted || error?.name === "AbortError";
      abortController?.abort?.();
      this.releaseAudioOutput?.();
      this.releaseAudioOutput = null;
      if (this.buildAbortController === abortController) {
        this.buildAbortController = null;
      }
      if (this.context === audio) this.context = null;
      if (audio.state !== "closed") {
        try { await audio.close?.(); } catch {}
      }
      if (cancelled) {
        throw audioStartCancelled();
      }
      throw error;
    }
  }

  setLevel(value) {
    this.level = clamp(value, 0, 0.82);
    if (this.running) {
      smooth(
        this.master.gain,
        calibratedOutputGain(this.level),
        this.context.currentTime,
        0.012,
      );
    }
  }

  playbackTiming(event) {
    const key = spellingDiphoneClipKey(event);
    if (!key) return null;
    const clip = SPELLING_DIPHONE_CLIPS[key];
    if (!clip) return null;
    const dynamics = event?.dynamics ?? {};
    const sustainedVowel = Boolean(
      event?.sustain
      && clip.kind === "vowel"
      && clip.sustainEnd > clip.sustainStart,
    );
    const tempoPitchCents = clamp(finite(dynamics.pitchCents), -18, 18);
    const playbackRate = this.vocoder ? 1 : 2 ** (tempoPitchCents / 1_200);
    const vowelMinimum = event?.wordSpeech ? 0.1 : 0.26;
    const vowelMaximum = event?.wordSpeech ? 0.22 : 0.52;
    const requestedDuration = clip.kind === "glide"
      ? clip.duration
      : clip.kind === "vowel"
        ? clamp(finite(dynamics.durationMs) / 1_000, vowelMinimum, vowelMaximum)
        : clip.duration;
    const sourceDuration = clip.kind === "vowel"
      ? Math.min(clip.duration, requestedDuration * playbackRate)
      : clip.duration;
    return {
      key,
      clip,
      sustainedVowel,
      playbackRate,
      sourceDuration,
      actualDuration: sourceDuration / playbackRate,
    };
  }

  durationMs(event) {
    return (this.playbackTiming(event)?.actualDuration ?? 0) * 1_000;
  }

  articulate(event) {
    if (!this.running || !event?.performance) return false;
    const timing = this.playbackTiming(event);
    if (!timing) return Boolean(event?.pair && Number(event.pairStepIndex) > 0);
    const {
      clip,
      sustainedVowel,
      playbackRate,
      sourceDuration,
      actualDuration,
    } = timing;
    const { performance, dynamics } = event;
    const personality = personalityFor(event);
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const eventGain = this.context.createGain();
    this.fadeActive(now, this.vocoder ? 0.007 : 0.02);
    // Keep the sample voice close to its measured formants while allowing a
    // deliberately small amount of typing prosody: never more than 18 cents.
    source.buffer = this.buffer;
    source.playbackRate.value = playbackRate;
    source.loop = sustainedVowel;
    if (sustainedVowel) {
      source.loopStart = clip.offset + clip.sustainStart;
      source.loopEnd = clip.offset + clip.sustainEnd;
    }
    eventGain.gain.value = MIN_GAIN;
    connect(source, eventGain);
    connect(eventGain, this.sourceBus);
    smooth(
      this.tone.frequency,
      clamp(7_300 * personality.spectralScale, 5_200, 7_800),
      now,
      0.014,
    );
    const shapeEnvelope = sustainedVowel ? sustainedEnvelope : envelope;
    shapeEnvelope(eventGain.gain, {
      at: now,
      peak: clip.gain * clamp(0.68 + dynamics.emphasis * 0.38, 0.58, 1.08),
      attack: 0.002,
      duration: actualDuration,
      release: Math.min(0.036, Math.max(0.018, dynamics.releaseMs / 2_800)),
    });
    if (this.vocoderNode) {
      this.vocoderNode.port.postMessage({
        type: "voice",
        frequency: performance.exciterPitch,
        voicednessHint: clamp(performance.articulationVoicing),
        drive: 1.2 + dynamics.emphasis * 1.6,
        brightness: clamp(0.5 + (personality.spectralScale - 1) * 2.5),
        clarity: 0.2 + (event.personality === "clear" ? 0.06 : 0),
      });
    }
    const active = { source, gain: eventGain };
    source.onended = () => {
      this.active.delete(active);
      try { source.disconnect?.(); } catch {}
      try { eventGain.disconnect?.(); } catch {}
    };
    try {
      if (sustainedVowel) source.start(now, clip.offset);
      else source.start(now, clip.offset, sourceDuration);
      this.active.add(active);
    } catch {
      source.onended = null;
      try { source.disconnect?.(); } catch {}
      try { eventGain.disconnect?.(); } catch {}
      return false;
    }
    return true;
  }

  fadeActive(at, seconds = 0.018) {
    const releaseAt = at + Math.max(0.004, seconds);
    for (const active of this.active) {
      hold(active.gain.gain, at, MIN_GAIN);
      active.gain.gain.linearRampToValueAtTime?.(MIN_GAIN, releaseAt);
      try { active.source.stop?.(releaseAt); } catch {}
    }
  }

  stopActive() {
    const now = this.context?.currentTime ?? 0;
    for (const active of this.active) {
      hold(active.gain.gain, now, MIN_GAIN);
      active.gain.gain.setValueAtTime?.(MIN_GAIN, now);
      active.source.onended = null;
      try { active.source.stop?.(now); } catch {}
      try { active.source.disconnect?.(); } catch {}
      try { active.gain.disconnect?.(); } catch {}
    }
    this.active.clear();
    this.vocoderNode?.port.postMessage({ type: "reset" });
  }

  release({ releaseMs = 55 } = {}) {
    if (!this.context) return false;
    const now = this.context.currentTime;
    const seconds = Math.max(0.012, releaseMs / 1_000);
    for (const active of this.active) {
      smooth(active.gain.gain, MIN_GAIN, now, Math.max(0.004, seconds / 3));
      try { active.source.stop?.(now + seconds); } catch {}
    }
    return true;
  }

  async disable() {
    this.lifecycleGeneration += 1;
    this.enabled = false;
    this.buildAbortController?.abort?.();
    this.buildAbortController = null;
    this.stopActive();
    if (this.context) {
      const audio = this.context;
      if (!this.master) {
        this.context = null;
        if (audio.state !== "closed") await audio.close?.();
        return;
      }
      if (this.master) {
        hold(this.master.gain, audio.currentTime, 0);
        this.master.gain.setValueAtTime?.(0, audio.currentTime);
      }
      if (audio.state !== "closed") await audio.suspend?.();
    }
  }

  async close() {
    this.lifecycleGeneration += 1;
    this.enabled = false;
    this.buildAbortController?.abort?.();
    this.buildAbortController = null;
    this.stopActive();
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    await this.context?.close?.();
    this.context = null;
    this.buffer = null;
    this.sourceBus = null;
    this.tone = null;
    this.vocoderNode = null;
    this.master = null;
  }
}

export class SpellingSynthesizerAudio {
  constructor({
    runtime = globalThis,
    engine = "diphone",
    level = 0.46,
    onFallback = null,
  } = {}) {
    this.runtime = runtime;
    this.engineName = spellingEngine(engine);
    this.level = clamp(level, 0, 0.82);
    this.onFallback = typeof onFallback === "function" ? onFallback : null;
    this.enabled = false;
    this.backends = {
      tube: new TubeSpellingEngine({ runtime, level: this.level }),
      diphone: new DiphoneSpellingEngine({ runtime, level: this.level }),
      vocoder: new DiphoneSpellingEngine({
        runtime,
        level: this.level,
        vocoder: true,
      }),
    };
  }

  get running() {
    return Boolean(this.enabled && this.backends[this.engineName]?.running);
  }

  get activeEngine() {
    return this.engineName;
  }

  async enable() {
    const requested = this.engineName;
    try {
      await this.backends[requested].enable();
    } catch (error) {
      if (requested === "diphone" || error?.name === "AbortError") throw error;
      this.engineName = "diphone";
      try {
        await this.backends.diphone.enable();
      } catch (fallbackError) {
        this.engineName = requested;
        throw fallbackError;
      }
      this.onFallback?.({ requested, actual: "diphone", error });
    }
    this.enabled = true;
    return this.engineName;
  }

  async selectEngine(name) {
    const next = spellingEngine(name);
    if (next === this.engineName) return this.engineName;
    const previous = this.engineName;
    await this.backends[previous].disable();
    this.engineName = next;
    if (!this.enabled) return this.engineName;
    try {
      await this.backends[next].enable();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (next === "diphone") {
        this.engineName = previous;
        try { await this.backends[previous].enable(); } catch {}
        throw error;
      }
      this.engineName = "diphone";
      try {
        await this.backends.diphone.enable();
      } catch (fallbackError) {
        this.engineName = previous;
        try { await this.backends[previous].enable(); } catch {}
        throw fallbackError;
      }
      this.onFallback?.({ requested: next, actual: "diphone", error });
    }
    return this.engineName;
  }

  setLevel(value) {
    this.level = clamp(value, 0, 0.82);
    for (const backend of Object.values(this.backends)) backend.setLevel(this.level);
    return this.level;
  }

  setEffects(options = {}) {
    return this.backends[this.engineName]?.setEffects?.(options) ?? null;
  }

  modulate(options = {}) {
    return this.backends[this.engineName]?.modulate?.(options) ?? false;
  }

  durationMs(event) {
    return this.backends[this.engineName]?.durationMs?.(event) ?? 0;
  }

  articulate(event) {
    if (!this.enabled) return false;
    return this.backends[this.engineName].articulate(event);
  }

  release(options = {}) {
    return this.backends[this.engineName].release(options);
  }

  async disable() {
    this.enabled = false;
    await Promise.all(Object.values(this.backends).map((backend) => backend.disable()));
  }

  async close() {
    this.enabled = false;
    await Promise.all(Object.values(this.backends).map((backend) => backend.close()));
  }
}

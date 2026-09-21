import {
  DIGESTAZOID_COMPARTMENTS,
  DIGESTAZOID_DEFAULTS,
  DIGESTAZOID_EVENT_PROFILES,
  applyDigestazoidGesture,
  applyDigestazoidInteraction,
  createDigestazoidRuntime,
  digestazoidTelemetry,
  mapDigestazoidInteraction,
  sanitizeDigestazoidState,
  stepDigestazoid,
} from "./digestazoid.js";

const TWO_PI = Math.PI * 2;
const CONTROL_RATE_HZ = 240;
const TELEMETRY_RATE_HZ = 20;
const OUTPUT_CEILING = 0.78;
const DENORMAL_FLOOR = 1e-20;
const BUBBLE_VOICE_COUNT = 28;

export const DIGESTAZOID_BUBBLE_KINDS = Object.freeze({
  SUBMERGED: 1,
  SURFACE: 2,
  GLUG: 3,
});

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finite(value, minimum)))
);

const clean = (value) => (
  Number.isFinite(value) && Math.abs(value) >= DENORMAL_FLOOR ? value : 0
);

const smoothstep = (value) => {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
};

class OnePole {
  constructor(rate, frequencyHz = 100) {
    this.rate = rate;
    this.value = 0;
    this.alpha = 0;
    this.configure(frequencyHz);
  }

  configure(frequencyHz) {
    const frequency = clamp(frequencyHz, 0.5, this.rate * 0.2);
    this.alpha = 1 - Math.exp(-TWO_PI * frequency / this.rate);
  }

  process(input) {
    this.value += (clean(input) - this.value) * this.alpha;
    this.value = clean(this.value);
    return this.value;
  }

  reset() {
    this.value = 0;
  }
}

/** Stable, damped pressure/body mode excited by changes in wall flow. */
class ModalResonator {
  constructor(rate, frequencyHz = 80, decaySeconds = 0.2) {
    this.rate = rate;
    this.y1 = 0;
    this.y2 = 0;
    this.configure(frequencyHz, decaySeconds);
  }

  configure(frequencyHz, decaySeconds) {
    this.frequencyHz = clamp(frequencyHz, 8, this.rate * 0.22);
    const decay = clamp(decaySeconds, 0.018, 8);
    this.radius = Math.exp(-6.90775527898 / Math.max(1, decay * this.rate));
    const angle = TWO_PI * this.frequencyHz / this.rate;
    this.coefficient = 2 * this.radius * Math.cos(angle);
    this.radiusSquared = this.radius * this.radius;
    // Normalize approximately to unity at the modal center. Using only
    // (1-r) here would over-amplify low modes by 1/sin(w).
    this.inputGain = clamp(2 * (1 - this.radius) * Math.sin(angle), 1e-8, 0.2);
  }

  process(input) {
    let output = this.coefficient * this.y1 - this.radiusSquared * this.y2
      + clean(input) * this.inputGain;
    if (!Number.isFinite(output) || Math.abs(output) > 16) output = 0;
    this.y2 = this.y1;
    this.y1 = clean(output);
    return this.y1;
  }

  reset() {
    this.y1 = 0;
    this.y2 = 0;
  }
}

/**
 * Pressure-gated relaxation flutter for the two rubbery exits. The oscillator
 * is intentionally stateful: pressure opens the lip gradually; falling flow
 * closes it on a slower trajectory, and aperture feeds back into F0.
 */
export class RubberValveOscillator {
  constructor(rate, seedOffset = 0) {
    this.rate = rate;
    this.initialPhase = (seedOffset * 0.173) % 1;
    this.phase = this.initialPhase;
    this.aperture = 0;
    this.flutter = 0;
    this.cycleJitter = 0;
    this.cycleStrength = 0.72;
    this.openQuotient = 0.38;
    this.airflow = 0;
    this.previousAirflow = 0;
    this.closureImpulse = 0;
    this.previousMembrane = 0;
  }

  processFrame(drive = 0, frequencyHz = 300, rubberiness = 0.7, turbulence = 0.5, noise = 0) {
    const pressure = clamp(drive, 0, 2);
    const rubber = clamp(rubberiness);
    const turbulent = clamp(turbulence);
    const opening = smoothstep(clamp((pressure - 0.018) * 1.7));
    const openAlpha = 1 - Math.exp(-(opening > this.aperture ? 1_100 : 120) / this.rate);
    this.aperture += (opening - this.aperture) * openAlpha;
    const baseFrequency = clamp(frequencyHz, 30, this.rate * 0.19);
    // Pressure only nudges the repetition rate. The old model multiplied F0
    // by as much as 1.38 under load, turning a rude low flutter into a smooth
    // 400–600 Hz whistle. Cycle-held jitter now carries that load instead.
    this.flutter += (noise * pressure - this.flutter) * (0.0015 + turbulent * 0.006);
    this.flutter = clamp(this.flutter, -1, 1);
    const frequency = clamp(
      baseFrequency * (0.92 + pressure * 0.035 + this.cycleJitter),
      24,
      this.rate * 0.2,
    );
    const nextPhase = this.phase + frequency / this.rate;
    if (nextPhase >= 1) {
      this.phase = nextPhase - 1;
      // A latex/tissue lip does not repeat one perfect waveform. It sticks,
      // tears open with a different duty cycle, and sometimes nearly chokes.
      this.cycleJitter = clamp(noise * (0.055 + turbulent * 0.16) + this.flutter * 0.035, -0.22, 0.22);
      this.openQuotient = clamp(
        0.2 + (1 - rubber) * 0.22 + pressure * 0.055 + noise * turbulent * 0.085,
        0.14,
        0.56,
      );
      const starvation = noise < -0.48 + turbulent * 0.16 ? 0.12 : 1;
      this.cycleStrength = clamp(
        (0.48 + pressure * 0.29 + noise * turbulent * 0.23) * starvation,
        0.05,
        1.15,
      );
    } else {
      this.phase = nextPhase;
    }

    // Rosenberg-like glottal flow with a slow peel and a much faster slam.
    // Its derivative is the radiating source, making a raspy pulse train with
    // real closures instead of a continuously sounding sine carrier.
    const openPosition = this.phase / Math.max(0.01, this.openQuotient);
    let gap = 0;
    if (openPosition < 0.72) {
      gap = 0.5 - 0.5 * Math.cos(Math.PI * openPosition / 0.72);
    } else if (openPosition < 1) {
      gap = Math.cos((openPosition - 0.72) / 0.28 * Math.PI * 0.5);
    }
    gap = Math.max(0, gap) ** (0.46 + (1 - rubber) * 0.42);
    const airflow = this.aperture * Math.sqrt(pressure) * gap * this.cycleStrength;
    const flowDelta = airflow - this.previousAirflow;
    const closing = Math.max(0, -flowDelta);
    this.closureImpulse += (closing * (8 + rubber * 13) - this.closureImpulse) * 0.72;
    this.airflow = airflow;
    this.previousAirflow = airflow;

    const differentiatedFlow = Math.tanh(flowDelta * (18 + rubber * 24));
    const membrane = Math.tanh(
      differentiatedFlow * (1.25 + rubber * 1.8)
        - this.closureImpulse * (0.48 + rubber * 0.52),
    );
    this.previousMembrane = membrane;
    const jet = noise * turbulent * Math.sqrt(Math.max(0, airflow))
      * (0.32 + pressure * 0.2);
    const wetSputter = (noise - this.flutter) * turbulent * this.closureImpulse * 0.85;
    return clean(this.aperture * (membrane * 0.68 + jet + wetSputter));
  }

  process({ drive = 0, frequencyHz = 300, rubberiness = 0.7, turbulence = 0.5, noise = 0 }) {
    return this.processFrame(drive, frequencyHz, rubberiness, turbulence, noise);
  }

  reset() {
    this.phase = this.initialPhase;
    this.aperture = 0;
    this.flutter = 0;
    this.cycleJitter = 0;
    this.cycleStrength = 0.72;
    this.openQuotient = 0.38;
    this.airflow = 0;
    this.previousAirflow = 0;
    this.closureImpulse = 0;
    this.previousMembrane = 0;
  }
}

/**
 * Fixed-size real-time voice bank for gas pockets in liquid. It is an
 * intentionally compact acoustic approximation, not a fluid solver:
 *
 * - submerged voices use the inverse-radius trend of radial bubble resonance;
 * - surface voices rise as a neck/open cavity pinches off, then add a short
 *   broadband rupture;
 * - glug voices are larger, slower pressure slugs with strongly damped modes.
 *
 * Every array is allocated once. `spawn` and `process` only mutate existing
 * storage, so dense boiling cannot create garbage in the audio render loop.
 */
export class BubbleVoiceBank {
  constructor(rate, voiceCount = BUBBLE_VOICE_COUNT) {
    this.rate = clamp(rate, 8_000, 384_000);
    this.voiceCount = Math.max(4, Math.round(finite(voiceCount, BUBBLE_VOICE_COUNT)));
    this.active = new Uint8Array(this.voiceCount);
    this.kind = new Uint8Array(this.voiceCount);
    this.delayFrames = new Int32Array(this.voiceCount);
    this.ageFrames = new Int32Array(this.voiceCount);
    this.durationFrames = new Int32Array(this.voiceCount);
    this.phase = new Float64Array(this.voiceCount);
    this.roughPhase = new Float64Array(this.voiceCount);
    this.frequencyStart = new Float64Array(this.voiceCount);
    this.frequencyEnd = new Float64Array(this.voiceCount);
    this.amplitude = new Float64Array(this.voiceCount);
    this.pan = new Float64Array(this.voiceCount);
    this.noiseMemory = new Float64Array(this.voiceCount);
    this.birthSerial = new Uint32Array(this.voiceCount);
    this.outputCenter = 0;
    this.outputSide = 0;
    this.outputBody = 0;
    this.activeCount = 0;
    this.totalSpawned = 0;
    this.gestureSpawned = 0;
    this.backgroundSpawned = 0;
    this.glugSpawned = 0;
    this.spawnSerial = 0;
  }

  static resonanceHz(sizeMm) {
    // 322 Hz at the calibrated 8 mm control position, following f ~ 1 / R.
    // The clamps keep very tiny UI bubbles below the brittle ultrasonic range
    // and large gas slugs above the speaker-hostile infrasonic range.
    return clamp(322 * 8 / Math.max(1, finite(sizeMm, 8)), 52, 2_576);
  }

  _voiceToSteal() {
    let oldestIndex = 0;
    let oldestSerial = 0xffff_ffff;
    for (let index = 0; index < this.voiceCount; index += 1) {
      if (!this.active[index]) return index;
      if (this.birthSerial[index] < oldestSerial) {
        oldestSerial = this.birthSerial[index];
        oldestIndex = index;
      }
    }
    return oldestIndex;
  }

  spawn(
    kind,
    delaySeconds,
    sizeMm,
    amplitude,
    pan,
    viscosity,
    randomA = 0,
    randomB = 0,
    source = 0,
  ) {
    const index = this._voiceToSteal();
    const voiceKind = kind === DIGESTAZOID_BUBBLE_KINDS.SURFACE
      || kind === DIGESTAZOID_BUBBLE_KINDS.GLUG
      ? kind : DIGESTAZOID_BUBBLE_KINDS.SUBMERGED;
    const size = clamp(sizeMm, 1, 64);
    const viscous = clamp(viscosity);
    const variationA = clamp(randomA, -1, 1);
    const variationB = clamp(randomB, -1, 1);
    const radialFrequency = BubbleVoiceBank.resonanceHz(size) * (0.94 + variationA * 0.09);
    let durationSeconds;
    let frequencyStart;
    let frequencyEnd;
    if (voiceKind === DIGESTAZOID_BUBBLE_KINDS.GLUG) {
      const slugFrequency = clamp(
        72 * Math.sqrt(16 / Math.max(2, size)) * (1 - viscous * 0.34),
        24,
        128,
      );
      frequencyStart = slugFrequency * (0.82 + variationA * 0.08);
      frequencyEnd = slugFrequency * (1.08 + variationB * 0.08);
      durationSeconds = 0.2 + viscous * 0.25 + Math.sqrt(size / 64) * 0.12;
    } else if (voiceKind === DIGESTAZOID_BUBBLE_KINDS.SURFACE) {
      // An open neck/cavity rises sharply before the film rupture.
      frequencyStart = radialFrequency * (0.42 + viscous * 0.08);
      frequencyEnd = radialFrequency * (1.42 + (1 - viscous) * 0.34);
      durationSeconds = 0.045 + Math.sqrt(size / 40) * 0.065 + viscous * 0.018;
    } else {
      frequencyStart = radialFrequency * (1.08 + variationB * 0.035);
      frequencyEnd = radialFrequency * (0.91 - viscous * 0.045);
      durationSeconds = 0.065 + Math.sqrt(size / 40) * 0.13 - viscous * 0.025;
    }
    this.active[index] = 1;
    this.kind[index] = voiceKind;
    this.delayFrames[index] = Math.max(0, Math.round(clamp(delaySeconds, 0, 4) * this.rate));
    this.ageFrames[index] = 0;
    this.durationFrames[index] = Math.max(8, Math.round(clamp(durationSeconds, 0.025, 0.8) * this.rate));
    this.phase[index] = ((variationA + 1) * 0.309 + (variationB + 1) * 0.117) % 1;
    this.roughPhase[index] = ((variationA + 1) * 0.173 + (variationB + 1) * 0.419) % 1;
    this.frequencyStart[index] = clamp(frequencyStart, 20, this.rate * 0.19);
    this.frequencyEnd[index] = clamp(frequencyEnd, 20, this.rate * 0.19);
    this.amplitude[index] = clamp(amplitude, 0, 1.4);
    this.pan[index] = clamp(pan + variationB * 0.08, -0.96, 0.96);
    this.noiseMemory[index] = 0;
    this.spawnSerial = (this.spawnSerial + 1) >>> 0;
    this.birthSerial[index] = this.spawnSerial;
    this.totalSpawned += 1;
    if (source === 1) this.gestureSpawned += 1;
    if (source === 2) this.backgroundSpawned += 1;
    if (voiceKind === DIGESTAZOID_BUBBLE_KINDS.GLUG) this.glugSpawned += 1;
    return index;
  }

  process(noise) {
    const excitation = clamp(noise, -1, 1);
    let center = 0;
    let side = 0;
    let body = 0;
    let activeCount = 0;
    for (let index = 0; index < this.voiceCount; index += 1) {
      if (!this.active[index]) continue;
      activeCount += 1;
      if (this.delayFrames[index] > 0) {
        this.delayFrames[index] -= 1;
        continue;
      }
      const age = this.ageFrames[index];
      const duration = Math.max(1, this.durationFrames[index]);
      if (age >= duration) {
        this.active[index] = 0;
        activeCount -= 1;
        continue;
      }
      const progress = clamp(age / duration);
      const voiceKind = this.kind[index];
      let curve = progress;
      if (voiceKind === DIGESTAZOID_BUBBLE_KINDS.SURFACE) curve = Math.sqrt(progress);
      else if (voiceKind === DIGESTAZOID_BUBBLE_KINDS.GLUG) curve = smoothstep(progress);
      const frequency = this.frequencyStart[index]
        + (this.frequencyEnd[index] - this.frequencyStart[index]) * curve;
      this.phase[index] = (this.phase[index] + frequency / this.rate) % 1;
      this.roughPhase[index] = (this.roughPhase[index]
        + (frequency * 0.173 + 7.1) / this.rate) % 1;
      const angle = this.phase[index] * TWO_PI;
      const roughAngle = this.roughPhase[index] * TWO_PI;
      const noiseAlpha = voiceKind === DIGESTAZOID_BUBBLE_KINDS.GLUG ? 0.009 : 0.055;
      this.noiseMemory[index] += (excitation - this.noiseMemory[index]) * noiseAlpha;
      const wetNoise = excitation - this.noiseMemory[index];
      let sample;
      let envelope;
      if (voiceKind === DIGESTAZOID_BUBBLE_KINDS.SURFACE) {
        const pinch = Math.sin(angle + Math.sin(roughAngle) * 0.34)
          + Math.sin(angle * 0.503 - 0.8) * 0.22;
        const neck = 1 - smoothstep((progress - 0.58) / 0.24);
        const ruptureAge = Math.max(0, progress - 0.68);
        const rupture = progress >= 0.68
          ? Math.exp(-ruptureAge * 54) * (wetNoise * 1.65 - 0.48)
          : 0;
        const afterBlister = progress >= 0.79
          ? Math.exp(-(progress - 0.79) * 38) * wetNoise * 0.46
          : 0;
        envelope = (1 - Math.exp(-progress * 92)) * Math.exp(-progress * 3.8) * neck;
        sample = pinch * envelope * 0.58 + rupture + afterBlister;
      } else if (voiceKind === DIGESTAZOID_BUBBLE_KINDS.GLUG) {
        const throat = Math.tanh((Math.sin(angle) + Math.sin(angle * 0.497 - 1.1) * 0.56) * 2.25);
        const gulp = 0.28 + 0.72 * Math.max(0, Math.sin(progress * Math.PI * 2.7 - 0.42)) ** 0.38;
        const firstBreak = progress >= 0.2
          ? Math.exp(-(progress - 0.2) * 34) * (wetNoise * 0.92 - 0.18)
          : 0;
        const secondBreak = progress >= 0.61
          ? Math.exp(-(progress - 0.61) * 42) * (wetNoise * 0.7 + 0.14)
          : 0;
        envelope = Math.sin(progress * Math.PI) ** 0.58 * Math.exp(-progress * 0.7);
        sample = (throat * 0.62 + this.noiseMemory[index] * 0.48) * envelope * gulp
          + firstBreak + secondBreak;
      } else {
        const ring = Math.sin(angle + Math.sin(roughAngle) * 0.14)
          + Math.sin(angle * 0.501 + 1.3) * 0.17;
        const attack = 1 - Math.exp(-progress * 180);
        envelope = attack * Math.exp(-progress * 8.6);
        const nucleationClick = Math.exp(-progress * 118) * (wetNoise * 0.88 - 0.16);
        const detachedWake = progress >= 0.38
          ? Math.exp(-(progress - 0.38) * 31) * wetNoise * 0.22
          : 0;
        sample = ring * envelope * 0.7 + nucleationClick + detachedWake;
      }
      sample = clean(Math.tanh(sample * 1.38) * this.amplitude[index]);
      if (!Number.isFinite(sample)) {
        this.active[index] = 0;
        activeCount -= 1;
        continue;
      }
      center += sample;
      side += sample * this.pan[index];
      body += sample * (voiceKind === DIGESTAZOID_BUBBLE_KINDS.GLUG ? 1.1 : 0.32);
      this.ageFrames[index] += 1;
    }
    const normalization = 1 / Math.sqrt(Math.max(1, activeCount * 0.72));
    this.outputCenter = clean(Math.tanh(center * normalization * 0.86));
    this.outputSide = clean(Math.tanh(side * normalization * 0.72));
    this.outputBody = clean(Math.tanh(body * normalization * 0.8));
    this.activeCount = activeCount;
  }

  reset(resetCounters = false) {
    this.active.fill(0);
    this.kind.fill(0);
    this.delayFrames.fill(0);
    this.ageFrames.fill(0);
    this.durationFrames.fill(0);
    this.phase.fill(0);
    this.roughPhase.fill(0);
    this.frequencyStart.fill(0);
    this.frequencyEnd.fill(0);
    this.amplitude.fill(0);
    this.pan.fill(0);
    this.noiseMemory.fill(0);
    this.birthSerial.fill(0);
    this.outputCenter = 0;
    this.outputSide = 0;
    this.outputBody = 0;
    this.activeCount = 0;
    this.spawnSerial = 0;
    if (resetCounters) {
      this.totalSpawned = 0;
      this.gestureSpawned = 0;
      this.backgroundSpawned = 0;
      this.glugSpawned = 0;
    }
  }
}

function envelopeAt(profile, ageSeconds, durationSeconds) {
  const duration = Math.max(0.02, durationSeconds || profile.durationSeconds);
  const attack = Math.min(duration * 0.45, profile.attackSeconds ?? duration * 0.12);
  const release = Math.min(duration * 0.8, profile.releaseSeconds ?? duration * 0.42);
  const attackEnvelope = smoothstep(ageSeconds / Math.max(1e-6, attack));
  const releaseEnvelope = smoothstep((duration - ageSeconds) / Math.max(1e-6, release));
  return clamp(attackEnvelope * releaseEnvelope);
}

function eventPan(compartmentId, stereoWidth) {
  const descriptor = DIGESTAZOID_COMPARTMENTS.find(({ id }) => id === compartmentId)
    ?? DIGESTAZOID_COMPARTMENTS[0];
  return clamp((descriptor.x - 0.5) * 2 * clamp(stereoWidth), -0.92, 0.92);
}

export class DigestazoidPhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = clamp(typeof sampleRate === "number" ? sampleRate : 48_000, 8_000, 384_000);
    const processorOptions = options.processorOptions ?? {};
    this.configuration = sanitizeDigestazoidState(
      processorOptions.state ?? processorOptions.configuration ?? DIGESTAZOID_DEFAULTS,
    );
    this.runtime = createDigestazoidRuntime(this.configuration, processorOptions.seed);
    this.performing = Boolean(
      processorOptions.performing ?? this.configuration.performing,
    );
    this.silenced = false;
    this.controlIntervalFrames = Math.max(8, Math.round(this.rate / CONTROL_RATE_HZ));
    this.controlCountdown = 0;
    this.telemetryIntervalFrames = Math.max(64, Math.round(this.rate / TELEMETRY_RATE_HZ));
    this.telemetryCountdown = this.telemetryIntervalFrames;
    this.telemetrySquareSum = 0;
    this.telemetryPeak = 0;
    this.telemetrySamples = 0;
    this.noiseState = this.runtime.seed >>> 0 || 1;
    this.initialSeed = this.noiseState;
    this.event = null;
    this.eventSerial = -1;
    this.eventAgeFrames = 0;
    this.eventPhase = 0;
    this.eventPhase2 = 0.17;
    this.heartPhase = 0;
    this.previousPressure = new Float64Array(DIGESTAZOID_COMPARTMENTS.length);
    this.pressureTargets = new Float64Array(DIGESTAZOID_COMPARTMENTS.length);
    this.pressureSmooth = new Float64Array(DIGESTAZOID_COMPARTMENTS.length);
    this.wallModes = [
      new ModalResonator(this.rate, 50, 1.45),
      new ModalResonator(this.rate, 78, 0.12),
      new ModalResonator(this.rate, 252, 0.66),
      new ModalResonator(this.rate, 322, 0.255),
    ];
    this.bodyMode = new ModalResonator(this.rate, 34, 0.3);
    this.bubbleBodyMode = new ModalResonator(this.rate, 43, 0.52);
    this.abyssMode = new ModalResonator(this.rate, 27, 0.82);
    this.heartMode = new ModalResonator(this.rate, 26, 0.2);
    this.upperBodyMode = new ModalResonator(this.rate, 131, 0.18);
    this.lowerBodyMode = new ModalResonator(this.rate, 82, 0.16);
    this.rectalCavityMode = new ModalResonator(this.rate, 47, 0.115);
    this.upperOutlet = new RubberValveOscillator(this.rate, 1);
    this.lowerOutlet = new RubberValveOscillator(this.rate, 2);
    this.sloshLow = new OnePole(this.rate, 34);
    this.sloshVeryLow = new OnePole(this.rate, 7);
    this.mouthLow = new OnePole(this.rate, 1_900);
    this.insideLow = new OnePole(this.rate, 520);
    this.dcLeft = new OnePole(this.rate, 12);
    this.dcRight = new OnePole(this.rate, 12);
    this.bubbleVoices = new BubbleVoiceBank(this.rate);
    this.seetheAccumulator = 0;
    this.seetheThreshold = 0.76
      + (((this.noiseState >>> 8) & 0xffff) / 0xffff) * 0.48;
    this.lastLeft = 0;
    this.lastRight = 0;
    this._syncControlTargets();
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _random() {
    let value = this.noiseState | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.noiseState = value | 0;
    return (value >>> 0) / 0xffff_ffff * 2 - 1;
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const patch = message.state && typeof message.state === "object"
        ? message.state : message.configuration && typeof message.configuration === "object"
          ? message.configuration : message.settings && typeof message.settings === "object"
            ? message.settings : message;
      const previousConfiguration = this.configuration;
      const nextConfiguration = sanitizeDigestazoidState({
        ...this.configuration,
        ...patch,
      }, this.configuration);
      this._reconcileContents(previousConfiguration, nextConfiguration);
      this.configuration = nextConfiguration;
      if (Object.hasOwn(patch, "performing")) this.performing = Boolean(this.configuration.performing);
      this.silenced = false;
      this._syncControlTargets();
      return;
    }
    if (message.type === "interaction") {
      const interaction = message.interaction && typeof message.interaction === "object"
        ? message.interaction : message;
      const mapped = mapDigestazoidInteraction(interaction, this.runtime);
      this.runtime = applyDigestazoidInteraction(this.runtime, mapped, this.configuration);
      this.silenced = false;
      this._syncEvent();
      this._syncControlTargets();
      return;
    }
    if (message.type === "gesture") {
      const gesturePayload = message.gesture && typeof message.gesture === "object"
        ? message.gesture : message;
      const gestureId = typeof message.gesture === "string"
        ? message.gesture : gesturePayload.gestureId ?? gesturePayload.id;
      this.runtime = applyDigestazoidGesture(
        this.runtime,
        gestureId,
        gesturePayload.force,
        gesturePayload.target,
        this.configuration,
      );
      this.silenced = false;
      this._syncEvent();
      this._syncControlTargets();
      return;
    }
    if (message.type === "set-performing") {
      this.performing = Boolean(message.performing ?? message.value);
      if (this.performing) this.silenced = false;
      return;
    }
    if (message.type === "silence") {
      this._silence(false);
      return;
    }
    if (message.type === "reset") this._reset(message);
  }

  _reset(configuration) {
    const resetState = configuration?.state && typeof configuration.state === "object"
      ? configuration.state : configuration;
    if (resetState && typeof resetState === "object") {
      this.configuration = sanitizeDigestazoidState(resetState, this.configuration);
    }
    const requestedSeed = finite(configuration?.seed, this.initialSeed);
    this.runtime = createDigestazoidRuntime(this.configuration, requestedSeed);
    this.noiseState = this.runtime.seed >>> 0 || 1;
    this.initialSeed = this.noiseState;
    this.performing = Boolean(this.configuration.performing);
    this.controlCountdown = 0;
    this.event = null;
    this.eventSerial = -1;
    this.eventAgeFrames = 0;
    this.eventPhase = 0;
    this.eventPhase2 = 0.17;
    this.heartPhase = 0;
    this.seetheAccumulator = 0;
    this.seetheThreshold = 0.76
      + (((this.noiseState >>> 8) & 0xffff) / 0xffff) * 0.48;
    this.silenced = false;
    this._resetAudioState();
    this._syncControlTargets();
  }

  _reconcileContents(previous, next) {
    if (!this.runtime?.compartments) return;
    const reference = createDigestazoidRuntime(next, this.runtime.seed);
    for (const material of ["gas", "liquid", "sludge"]) {
      if (Math.abs(finite(previous?.[material]) - finite(next?.[material])) < 1e-12) continue;
      const currentTotal = this.runtime.compartments.reduce((sum, part) => (
        sum + finite(part[material])
      ), 0);
      const targetTotal = reference.compartments.reduce((sum, part) => (
        sum + part[material]
      ), 0);
      if (currentTotal > 1e-12) {
        const scale = targetTotal / currentTotal;
        for (const part of this.runtime.compartments) {
          part[material] = clamp(part[material] * scale, 0, 3);
        }
      } else {
        for (let index = 0; index < this.runtime.compartments.length; index += 1) {
          this.runtime.compartments[index][material] = reference.compartments[index][material];
        }
      }
    }
  }

  _silence(resetRuntime) {
    if (resetRuntime) this.runtime = createDigestazoidRuntime(this.configuration);
    else {
      this.runtime.event = null;
      this.runtime.outlets.upperDrive = 0;
      this.runtime.outlets.lowerDrive = 0;
      this.runtime.slosh.energy = 0;
      for (const chamber of this.runtime.compartments) {
        chamber.wallVelocity = 0;
        chamber.compression = 0;
      }
    }
    this.event = null;
    this.eventSerial = this.runtime.eventSerial;
    this.eventAgeFrames = 0;
    this.silenced = true;
    this._resetAudioState();
  }

  _resetAudioState() {
    for (const mode of this.wallModes) mode.reset();
    this.bodyMode.reset();
    this.bubbleBodyMode.reset();
    this.abyssMode.reset();
    this.heartMode.reset();
    this.upperBodyMode.reset();
    this.lowerBodyMode.reset();
    this.rectalCavityMode.reset();
    this.upperOutlet.reset();
    this.lowerOutlet.reset();
    this.sloshLow.reset();
    this.sloshVeryLow.reset();
    this.mouthLow.reset();
    this.insideLow.reset();
    this.dcLeft.reset();
    this.dcRight.reset();
    this.bubbleVoices.reset();
    this.previousPressure.fill(0);
    this.pressureSmooth.fill(0);
    this.lastLeft = 0;
    this.lastRight = 0;
  }

  _syncEvent() {
    const next = this.runtime.event;
    if (!next || next.serial === this.eventSerial) return;
    if (next.id === "natural" && !this.performing) {
      this.eventSerial = next.serial;
      return;
    }
    const profile = DIGESTAZOID_EVENT_PROFILES[next.profileId] ?? DIGESTAZOID_EVENT_PROFILES.SB;
    this.eventSerial = next.serial;
    this.eventAgeFrames = Math.max(0, Math.round(finite(next.ageSeconds) * this.rate));
    this.eventPhase = 0;
    this.eventPhase2 = (this.noiseState >>> 0) / 0xffff_ffff;
    this.event = {
      ...next,
      profile,
      durationFrames: Math.max(1, Math.round(next.durationSeconds * this.rate)),
    };
    this._scheduleEventBubbles(next, profile);
    // Medical event modes are reset at onset so the measured active windows
    // remain independent of a previous gesture's ring-down.
    for (const mode of this.wallModes) mode.reset();
  }

  _syncControlTargets() {
    for (let index = 0; index < this.pressureTargets.length; index += 1) {
      this.pressureTargets[index] = clamp(this.runtime.compartments[index]?.pressure, 0, 6);
    }
    this._syncEvent();
  }

  _advanceControl() {
    const deltaSeconds = this.controlIntervalFrames / this.rate;
    this.runtime = stepDigestazoid(
      this.runtime,
      this.configuration,
      deltaSeconds,
    );
    this._syncControlTargets();
    this._advanceSeethe(deltaSeconds);
  }

  _scheduleEventBubbles(event, profile) {
    const id = String(event?.id ?? "");
    const strength = clamp(event?.strength, 0, 1.5);
    const baseSize = this.configuration.bubbleSizeMm;
    const viscosity = this.configuration.viscosity;
    const pan = eventPan(event?.compartmentId, this.configuration.stereoWidth);
    const bubble = this.bubbleVoices;
    const source = 1;

    if (id === "bubble" || profile.id === "HS") {
      const count = id === "bubble" ? 5 : 2;
      let delay = 0;
      for (let index = 0; index < count; index += 1) {
        const randomA = this._random();
        const randomB = this._random();
        const size = baseSize * (index === 0 ? 1.45 : 0.72 + (randomA + 1) * 0.52);
        const kind = index === count - 1 || index === 2
          ? DIGESTAZOID_BUBBLE_KINDS.SURFACE
          : index === 3 ? DIGESTAZOID_BUBBLE_KINDS.GLUG
            : DIGESTAZOID_BUBBLE_KINDS.SUBMERGED;
        if (index > 0) delay += 0.032 + (randomB + 1) * 0.023 + index * 0.007;
        bubble.spawn(
          kind,
          delay,
          size,
          strength * (index === 0 ? 0.62 : kind === DIGESTAZOID_BUBBLE_KINDS.SURFACE ? 0.38 : 0.29),
          pan,
          viscosity,
          randomA,
          randomB,
          source,
        );
      }
      return;
    }

    if (id === "burble" || id === "inflate" || id === "poke" || id === "swallow"
        || (id === "natural" && profile.id === "SB")) {
      const count = id === "burble"
        ? 9 + Math.round(this.configuration.turbulence * 4)
        : 2 + Math.round(this.configuration.turbulence * 2);
      let delay = 0;
      for (let index = 0; index < count; index += 1) {
        const randomA = this._random();
        const randomB = this._random();
        if (index > 0) {
          delay += (0.031 + (randomA + 1) * 0.035)
            * (0.82 + viscosity * 0.75);
        }
        const makeGlug = id === "burble"
          ? index % 4 === 1 || (viscosity > 0.68 && index === count - 2)
          : viscosity > 0.7 && index === count - 2;
        const kind = makeGlug ? DIGESTAZOID_BUBBLE_KINDS.GLUG
          : index % 3 === 2 || index === count - 1 ? DIGESTAZOID_BUBBLE_KINDS.SURFACE
            : DIGESTAZOID_BUBBLE_KINDS.SUBMERGED;
        const size = baseSize * (id === "burble" ? 1.1 : 0.5 + (randomB + 1) * 0.48)
          * (id === "burble" ? 0.82 + (randomB + 1) * 0.72 : 1)
          * (makeGlug ? 1.65 : 1);
        bubble.spawn(
          kind,
          delay,
          size,
          strength * (id === "burble"
            ? makeGlug ? 0.42 : kind === DIGESTAZOID_BUBBLE_KINDS.SURFACE ? 0.31 : 0.27
            : makeGlug ? 0.27 : 0.16 + (index % 3 === 0 ? 0.055 : 0)),
          pan + randomA * 0.22,
          viscosity,
          randomA,
          randomB,
          source,
        );
      }
      return;
    }

    if (id === "burple" || (id === "natural" && profile.id === "CRS")) {
      const count = 4 + Math.round(viscosity * 3 + this.configuration.turbulence * 2);
      let delay = 0;
      for (let index = 0; index < count; index += 1) {
        const randomA = this._random();
        const randomB = this._random();
        if (index > 0) delay += 0.055 + (randomA + 1) * 0.052 + viscosity * 0.025;
        const kind = index % 3 === 1
          ? DIGESTAZOID_BUBBLE_KINDS.SURFACE
          : DIGESTAZOID_BUBBLE_KINDS.GLUG;
        bubble.spawn(
          kind,
          delay,
          baseSize * (1.25 + (randomB + 1) * 0.76 + viscosity * 0.72),
          strength * (kind === DIGESTAZOID_BUBBLE_KINDS.GLUG ? 0.34 : 0.2),
          pan + randomA * 0.28,
          viscosity,
          randomA,
          randomB,
          source,
        );
      }
    }
  }

  _advanceSeethe(deltaSeconds) {
    if (!this.performing || this.silenced) return;
    const turbulence = this.configuration.turbulence;
    const viscosity = this.configuration.viscosity;
    const gas = clamp(this.configuration.gas / 1.4);
    const liquid = clamp(this.configuration.liquid / 1.4);
    const wetness = clamp(this.configuration.wetness);
    const wetInventory = clamp(liquid * 0.72 + wetness * 0.38);
    const rateHz = 9.2 * turbulence ** 1.75
      * (0.12 + gas * 0.88)
      * (0.14 + wetInventory * 0.86)
      * (1 - viscosity * 0.68);
    this.seetheAccumulator += deltaSeconds * rateHz;
    let births = 0;
    while (this.seetheAccumulator >= this.seetheThreshold && births < 3) {
      this.seetheAccumulator -= this.seetheThreshold;
      const randomA = this._random();
      const randomB = this._random();
      const randomC = this._random();
      const glug = viscosity > 0.58 && (randomA + 1) * 0.5 < viscosity * 0.78;
      const kind = glug ? DIGESTAZOID_BUBBLE_KINDS.GLUG
        : randomB > 0.22 ? DIGESTAZOID_BUBBLE_KINDS.SUBMERGED
          : DIGESTAZOID_BUBBLE_KINDS.SURFACE;
      const size = this.configuration.bubbleSizeMm
        * (0.38 + (randomC + 1) * 0.52)
        * (glug ? 1.75 + viscosity : 1);
      this.bubbleVoices.spawn(
        kind,
        0,
        size,
        (0.025 + turbulence * 0.085) * (glug ? 1.32 : 1),
        randomA * this.configuration.stereoWidth,
        viscosity,
        randomB,
        randomC,
        2,
      );
      // Many boiling sounds are two-stage: a submerged pulse followed by a
      // nearby surface opening. Thin fluids get this second, short rupture;
      // yield-like sludge more often retains one slow pressure slug.
      if (!glug && randomC > -0.18) {
        this.bubbleVoices.spawn(
          DIGESTAZOID_BUBBLE_KINDS.SURFACE,
          0.018 + (randomB + 1) * 0.014,
          size * (0.74 + (randomA + 1) * 0.08),
          (0.014 + turbulence * 0.048),
          randomA * this.configuration.stereoWidth,
          viscosity,
          randomC,
          randomA,
          2,
        );
      }
      this.seetheThreshold = 0.68 + (this._random() + 1) * 0.35;
      births += 1;
    }
  }

  _eventSample(noise) {
    if (!this.event) return { sample: 0, pan: 0, upper: 0, lower: 0, profile: null };
    if (this.eventAgeFrames >= this.event.durationFrames) {
      this.event = null;
      return { sample: 0, pan: 0, upper: 0, lower: 0, profile: null };
    }
    const profile = this.event.profile;
    const ageSeconds = this.eventAgeFrames / this.rate;
    const durationSeconds = this.event.durationFrames / this.rate;
    const progress = clamp(this.eventAgeFrames / this.event.durationFrames);
    const envelope = envelopeAt(profile, ageSeconds, durationSeconds) * this.event.strength;
    let frequency = profile.peakFrequencyHz;
    let tone = 0;
    let noisy = 0;
    let upper = 0;
    let lower = 0;

    if (profile.id === "MB") {
      frequency *= 0.9 + 0.16 * Math.sin(progress * TWO_PI * 2.2);
      this.eventPhase = (this.eventPhase + frequency / this.rate) % 1;
      this.eventPhase2 = (this.eventPhase2 + (frequency * 0.47) / this.rate) % 1;
      const packets = 0.56 + 0.44 * Math.sin(progress * TWO_PI * 3.1 - 0.7) ** 2;
      tone = (Math.sin(this.eventPhase * TWO_PI) * 0.72
        + Math.sin(this.eventPhase2 * TWO_PI) * 0.32) * packets;
      noisy = noise * 0.12;
    } else if (profile.id === "CRS") {
      frequency *= 0.76 + progress * 0.44 + Math.sin(progress * TWO_PI * 4) * 0.045;
      this.eventPhase = (this.eventPhase + frequency / this.rate) % 1;
      const crackle = Math.abs(noise) > 0.92 - this.event.strength * 0.018 ? noise : noise * 0.08;
      tone = Math.sin(this.eventPhase * TWO_PI) * 0.42;
      noisy = crackle * 0.72;
    } else if (profile.id === "HS") {
      // The 8 mm default lands on the measured ~322 Hz HS class; changing the
      // visible bubble shifts its resonance by the expected inverse-size trend.
      if (this.event.id === "bubble") {
        frequency *= Math.sqrt(8 / Math.max(1, this.configuration.bubbleSizeMm));
      }
      frequency *= 0.92 + 0.18 * Math.sin(progress * Math.PI);
      this.eventPhase = (this.eventPhase + frequency / this.rate) % 1;
      if (this.event.id === "bubble") {
        // Keep only a brief wall-coupled ring here. The audible gesture is the
        // scheduled pocket bank: submersion, neck pinch, and late rupture.
        const wallKnock = Math.exp(-progress * 18)
          + (progress >= 0.67 ? Math.exp(-(progress - 0.67) * 46) * 0.62 : 0);
        tone = Math.sin(this.eventPhase * TWO_PI
          + 0.22 * Math.sin(progress * TWO_PI * 7)) * wallKnock * 0.22;
        noisy = noise * wallKnock * 0.44;
      } else {
        tone = Math.sin(this.eventPhase * TWO_PI + 0.22 * Math.sin(progress * TWO_PI * 7));
        noisy = noise * 0.14;
      }
    } else if (profile.id === "SB") {
      frequency *= 1.08 - progress * 0.2;
      this.eventPhase = (this.eventPhase + frequency / this.rate) % 1;
      if (this.event.id === "burble") {
        const bowelKnuckle = Math.tanh(
          (Math.sin(this.eventPhase * TWO_PI)
            + Math.sin(this.eventPhase * TWO_PI * 2.17 - 0.8) * 0.52) * 2.8,
        );
        const packet = 0.18
          + 0.82 * Math.max(0, Math.sin(progress * Math.PI * 3.4 + 0.34)) ** 0.42;
        tone = bowelKnuckle * packet * 0.18;
        noisy = noise * packet * (0.5 + this.configuration.wetness * 0.28);
      } else {
        tone = Math.sin(this.eventPhase * TWO_PI)
          * (0.78 + 0.18 * Math.sin(this.eventPhase * TWO_PI * 2));
        noisy = noise * (0.3 - progress * 0.18);
      }
    } else if (profile.id === "BURP") {
      frequency *= 1.06 - progress * 0.2;
      this.eventPhase = (this.eventPhase + frequency / this.rate) % 1;
      const throatPulse = Math.max(0, Math.sin(this.eventPhase * TWO_PI)) ** 0.34;
      tone = Math.tanh((throatPulse - 0.36) * 4.2) * 0.24;
      noisy = noise * this.configuration.mouthRadiation
        * (0.48 + throatPulse * 0.64);
      const sourChoke = 0.42
        + 0.58 * Math.max(0, Math.sin(progress * Math.PI * 3.2 + 0.2)) ** 0.38;
      upper = envelope * sourChoke * 1.42;
    } else if (profile.id === "WHOOPEE") {
      this.eventPhase2 = (this.eventPhase2 + (7.2 + this.configuration.turbulence * 5.8) / this.rate) % 1;
      const sputter = 0.16 + 0.84
        * Math.max(0, Math.sin(this.eventPhase2 * TWO_PI) + noise * 0.16) ** 0.38;
      // The event supplies reservoir pressure and a dirty jet. Periodicity is
      // generated only by the repeatedly closing outlet below.
      tone = 0;
      noisy = noise * sputter * (0.42 + this.configuration.turbulence * 0.5);
      lower = envelope * (0.38 + sputter * 0.92) * 1.32;
    } else if (profile.id === "QUICK_FART") {
      this.eventPhase2 = (this.eventPhase2 + (13 + this.configuration.turbulence * 8) / this.rate) % 1;
      const sputter = 0.14 + 0.86
        * Math.max(0, Math.sin(this.eventPhase2 * TWO_PI + 0.8) + noise * 0.2) ** 0.32;
      tone = 0;
      noisy = noise * sputter * (0.52 + this.configuration.turbulence * 0.56);
      lower = envelope * (0.32 + sputter) * 1.38;
    }
    this.eventAgeFrames += 1;
    return {
      sample: clean((tone + noisy) * envelope),
      pan: eventPan(this.event.compartmentId, this.configuration.stereoWidth),
      upper,
      lower,
      profile,
    };
  }

  _renderFrame() {
    if (this.controlCountdown <= 0) {
      this._advanceControl();
      this.controlCountdown += this.controlIntervalFrames;
    }
    this.controlCountdown -= 1;
    const noise = this._random();
    const event = this._eventSample(noise);
    this.bubbleVoices.process(noise);
    const bubbleCenter = this.bubbleVoices.outputCenter;
    const bubbleSide = this.bubbleVoices.outputSide;
    const bubbleBodyExcitation = this.bubbleVoices.outputBody;
    const pressureAlpha = 1 - Math.exp(-1 / Math.max(1, this.rate * 0.006));
    let meanPressure = 0;
    let pressureImpulse = 0;
    let sideMoment = 0;
    for (let index = 0; index < this.pressureSmooth.length; index += 1) {
      this.pressureSmooth[index] += (this.pressureTargets[index] - this.pressureSmooth[index]) * pressureAlpha;
      const delta = this.pressureSmooth[index] - this.previousPressure[index];
      pressureImpulse += delta * (0.6 + this.runtime.compartments[index].constriction);
      meanPressure += this.pressureSmooth[index];
      sideMoment += delta * (DIGESTAZOID_COMPARTMENTS[index].x - 0.5);
      this.previousPressure[index] = this.pressureSmooth[index];
    }
    meanPressure /= this.pressureSmooth.length;

    const bodyExcitation = pressureImpulse * 16
      + this.runtime.bodyPulse.pressure * this.configuration.bodyResonance * 0.008;
    const lowBody = this.bodyMode.process(bodyExcitation);
    const bubbleBody = this.bubbleBodyMode.process(
      bubbleBodyExcitation * (0.72 + this.configuration.wetness * 0.48),
    );
    const abyss = this.abyssMode.process(
      bubbleBody * (1.2 + this.configuration.bodyResonance * 0.8)
        + bubbleBodyExcitation * (0.08 + this.configuration.viscosity * 0.18),
    );
    const wall50 = this.wallModes[0].process(event.sample * (event.profile?.id === "MB" ? 0.9 : 0.08) + pressureImpulse * 8);
    const wall78 = this.wallModes[1].process(event.sample * (event.profile?.id === "SB" ? 0.84 : 0.05));
    const wall252 = this.wallModes[2].process(event.sample * (event.profile?.id === "CRS" ? 1.15 : 0.04));
    const wall322 = this.wallModes[3].process(event.sample * (event.profile?.id === "HS" ? 0.7 : 0.03));
    const resonant = wall50 + wall78 + wall252 + wall322;

    const sloshEnergy = this.runtime.slosh.energy * this.configuration.wetness;
    const sloshLow = this.sloshLow.process(noise * sloshEnergy);
    const slosh = (sloshLow - this.sloshVeryLow.process(sloshLow)) * 0.74;

    const physicalAudioActive = this.performing || Boolean(this.event)
      || this.bubbleVoices.activeCount > 0;
    const upperDrive = clamp(
      (physicalAudioActive ? this.runtime.outlets.upperDrive : 0) + event.upper
        + (physicalAudioActive ? Math.max(0, this.runtime.valves.esophageal?.flow ?? 0) * 0.4 : 0),
      0,
      2,
    );
    const lowerDrive = clamp(
      (physicalAudioActive ? this.runtime.outlets.lowerDrive : 0) + event.lower
        + (physicalAudioActive ? Math.max(0, this.runtime.valves.anal?.flow ?? 0) * 0.4 : 0),
      0,
      2,
    );
    const upperFrequency = event.profile?.id === "BURP"
      ? 72 + this.configuration.outletStretch * 26
      : this.configuration.upperOutletHz * 0.62;
    let lowerFrequency = this.configuration.lowerOutletHz / 3.12;
    if (event.profile?.id === "QUICK_FART") {
      lowerFrequency = 88 + this.configuration.outletStretch * 34;
    } else if (event.profile?.id === "WHOOPEE") {
      const progress = clamp(this.eventAgeFrames / Math.max(1, this.event?.durationFrames ?? 1));
      const startFlutter = 112 + this.configuration.outletStretch * 46;
      lowerFrequency = startFlutter * (1 - progress * 0.44)
        * (1 + Math.sin(progress * TWO_PI * 5.2) * 0.055);
    }
    const upperValve = this.upperOutlet.processFrame(
      upperDrive,
      upperFrequency,
      this.configuration.upperRubberiness,
      this.configuration.turbulence,
      noise,
    );
    const lowerValve = this.lowerOutlet.processFrame(
      lowerDrive,
      lowerFrequency,
      this.configuration.lowerRubberiness,
      this.configuration.turbulence,
      -noise,
    );
    const upperRadiated = this.upperBodyMode.process(upperValve * 0.78 + event.upper * noise * 0.08);
    const lowerRadiated = this.lowerBodyMode.process(
      lowerValve * 0.46 - this.lowerOutlet.closureImpulse * 0.065,
    );
    const rectalCavity = this.rectalCavityMode.process(
      lowerValve * 0.72 - this.lowerOutlet.closureImpulse * 0.14
        + event.lower * noise * 0.035,
    );

    this.heartPhase = (this.heartPhase + this.configuration.bodyPulseBpm / 60 / this.rate) % 1;
    const heartAngle = this.heartPhase * TWO_PI;
    const heartImpulse = (Math.max(0, Math.sin(heartAngle)) ** 18
      + Math.max(0, Math.sin(heartAngle - 0.74)) ** 24 * 0.42)
      * this.configuration.bodyPulse * this.configuration.bodyResonance * 0.026;
    const heart = this.heartMode.process(heartImpulse);

    const autonomous = this.performing ? (
      lowBody * (0.7 + meanPressure * 0.45)
      + slosh * 0.38
      + heart
    ) : 0;
    const wetGesture = ["bubble", "burble"].includes(this.event?.id);
    const bubbleDirectGain = wetGesture ? 1.12 : 0.68;
    const abyssGain = wetGesture ? 2.35 : 3.8;
    let center = event.sample * 0.28 + resonant * 2.8 * (physicalAudioActive ? 1 : 0) + autonomous
      + upperValve * 0.16 + upperRadiated * 2.4
      + lowerValve * 0.62 + lowerRadiated * 1.32 + rectalCavity * 1.9
      + bubbleCenter * bubbleDirectGain + bubbleBody * 2.8 + abyss * abyssGain;

    // Three microphone positions use the same body, only changing radiation:
    // room is airy/direct, stethoscope focuses wall modes, inside damps highs
    // and exaggerates fluid/body conduction.
    if (this.configuration.listeningMode === "stethoscope") {
      center = (resonant * 3.7 + lowBody * 0.9 + slosh * 0.2
          + bubbleCenter * 0.42 + bubbleBody * 4 + abyss * 4.8)
          * (physicalAudioActive ? 1 : 0)
        + event.sample * 0.12 + upperRadiated * 1.2
        + lowerValve * 0.25 + lowerRadiated * 1.2 + rectalCavity * 1.65;
    } else if (this.configuration.listeningMode === "inside") {
      center = this.insideLow.process(center * 1.2
        + (slosh * 0.6 + lowBody * 0.8) * (physicalAudioActive ? 1 : 0));
    } else {
      const broadMouth = this.mouthLow.process(event.sample + upperValve * 0.55);
      center += (event.sample + upperValve * 0.42 - broadMouth) * this.configuration.mouthRadiation * 0.32;
    }

    const eventSide = event.sample * event.pan * 0.38;
    const fluidSide = (this.runtime.slosh.x * slosh * 0.28 + sideMoment * 18)
      * this.configuration.stereoWidth * (physicalAudioActive ? 1 : 0);
    const valveSide = (upperValve * -0.08 + lowerValve * 0.1) * this.configuration.stereoWidth;
    const side = eventSide + fluidSide + valveSide
      + bubbleSide * this.configuration.stereoWidth * 0.34;
    const level = this.configuration.level;
    // Headroom is part of the model: simultaneous wall, fluid, and outlet
    // modes should sum without turning every strong squeeze into the ceiling.
    let left = (center - side) * level * 0.52;
    let right = (center + side) * level * 0.52;
    left -= this.dcLeft.process(left);
    right -= this.dcRight.process(right);
    left = OUTPUT_CEILING * Math.tanh(clean(left) / OUTPUT_CEILING);
    right = OUTPUT_CEILING * Math.tanh(clean(right) / OUTPUT_CEILING);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      this._resetAudioState();
      left = 0;
      right = 0;
    }
    this.lastLeft = left;
    this.lastRight = right;
    return [left, right];
  }

  _postTelemetry() {
    const snapshot = digestazoidTelemetry(this.runtime, this.configuration);
    const rms = Math.sqrt(this.telemetrySquareSum / Math.max(1, this.telemetrySamples * 2));
    const intestinePressure = (
      snapshot.pressures.duodenum + snapshot.pressures.jejunum + snapshot.pressures.ileum
    ) / 3;
    const colonPressure = (
      snapshot.pressures.cecum + snapshot.pressures.colon + snapshot.pressures.rectum
    ) / 3;
    const wallMotion = clamp(this.runtime.compartments.reduce((sum, part) => (
      sum + Math.abs(part.wallVelocity) * 0.08 + part.constriction * 0.12
    ), 0) / this.runtime.compartments.length, 0, 2);
    const gasFill = clamp(snapshot.gas.total / 0.615, 0, 1.5);
    const liquidFill = clamp(snapshot.liquid.total / 2.3, 0, 1.5);
    const sludgeFill = clamp(snapshot.sludge.total / 2.12, 0, 1.5);
    const eventPayload = this.event ? {
      id: this.event.id,
      profileId: this.event.profile.id,
      compartmentId: this.event.compartmentId,
      progress: clamp(this.eventAgeFrames / Math.max(1, this.event.durationFrames)),
      strength: this.event.strength,
    } : this.performing ? snapshot.event : null;
    const eventLabel = eventPayload
      ? (eventPayload.id === "natural"
          ? DIGESTAZOID_EVENT_PROFILES[eventPayload.profileId]?.label
          : eventPayload.id)
      : "";
    this.port.postMessage({
      type: "telemetry",
      ...snapshot,
      pressureDetails: snapshot.pressures,
      pressures: {
        ...snapshot.pressures,
        intestine: intestinePressure,
        colon: colonPressure,
      },
      compartmentFills: snapshot.fills,
      fills: {
        ...snapshot.fills,
        gas: gasFill,
        liquid: liquidFill,
        sludge: sludgeFill,
      },
      valveDetails: snapshot.valves,
      valves: {
        ...snapshot.valves,
        upper: snapshot.valves.esophageal.aperture,
        pyloric: snapshot.valves.pyloric.aperture,
        ileocecal: snapshot.valves.ileocecal.aperture,
        lower: snapshot.valves.anal.aperture,
      },
      performing: this.performing,
      peristalsisPhase: snapshot.peristalsis.phase,
      wallMotion,
      bubbleActivity: clamp(gasFill * this.configuration.turbulence * 0.62
        + (["SB", "CRS", "HS"].includes(eventPayload?.profileId) ? 0.26 : 0)
        + this.bubbleVoices.activeCount / this.bubbleVoices.voiceCount * 0.72),
      bubbleVoiceCount: this.bubbleVoices.activeCount,
      upperFlow: snapshot.outlets.upperFlow,
      lowerFlow: snapshot.outlets.lowerFlow,
      event: eventPayload,
      eventLabel,
      rms: Number.isFinite(rms) ? rms : 0,
      peak: Number.isFinite(this.telemetryPeak) ? this.telemetryPeak : 0,
    });
    this.telemetrySquareSum = 0;
    this.telemetryPeak = 0;
    this.telemetrySamples = 0;
  }

  process(_inputs, outputs) {
    const output = outputs?.[0];
    if (!output?.[0]) return true;
    const frameCount = output[0].length;
    for (let frame = 0; frame < frameCount; frame += 1) {
      let left = 0;
      let right = 0;
      if (!this.silenced) {
        [left, right] = this._renderFrame();
      } else {
        // Silence mutes radiation, not physiology: pressure, valve aperture,
        // wall compression, and contents continue their bounded decay.
        if (this.controlCountdown <= 0) {
          this._advanceControl();
          this.controlCountdown += this.controlIntervalFrames;
          this.event = null;
          if (this.runtime.event) this.eventSerial = this.runtime.event.serial;
        }
        this.controlCountdown -= 1;
      }
      output[0][frame] = left;
      if (output[1]) output[1][frame] = right;
      for (let channel = 2; channel < output.length; channel += 1) {
        if (output[channel]) output[channel][frame] = (left + right) * 0.5;
      }
      const peak = Math.max(Math.abs(left), Math.abs(right));
      this.telemetryPeak = Math.max(this.telemetryPeak, peak);
      this.telemetrySquareSum += left * left + right * right;
      this.telemetrySamples += 1;
      this.telemetryCountdown -= 1;
      if (this.telemetryCountdown <= 0) {
        this.telemetryCountdown += this.telemetryIntervalFrames;
        this._postTelemetry();
      }
    }
    return true;
  }
}

registerProcessor("digestazoid-physical-model", DigestazoidPhysicalProcessor);

import {
  buildPhysicalModalBank,
  sanitizePhysicalSoundState,
} from "./physical-sounds.js";

const PROCESSOR_NAME = "morphazoid-physical-sounds";
const MAX_MODES = 64;
const MAX_IMPACT_VOICES = 8;
const IMPACT_MODES = Object.freeze(["bounce", "shatter", "crumple", "roll", "scrape"]);
const SILENCE_FLOOR = 1e-10;
const TWO_PI = Math.PI * 2;
const TELEMETRY_BLOCKS = 12;
const MIN_MODE_FREQUENCY_HZ = 8;
const MAX_MODE_FREQUENCY_RATIO = 0.475;
const MIN_MODE_T60_SECONDS = 0.012;
const MAX_MODE_T60_SECONDS = 30;
const PARTICLE_RESONANT_LOAD_KNEE = 64;
const OUTPUT_GUARD_RAW_CEILING = 3;
const REFERENCE_SAMPLE_RATE = 48_000;

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function softClip(value) {
  if (!Number.isFinite(value)) return 0;
  return value / (1 + Math.abs(value));
}

function smoothstep(value) {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
}

function coefficientAtSampleRate(coefficientAt48k, rate) {
  const coefficient = clamp(coefficientAt48k);
  return 1 - Math.pow(1 - coefficient, REFERENCE_SAMPLE_RATE / Math.max(1, rate));
}

function decayAtSampleRate(decayAt48k, rate) {
  return Math.pow(clamp(decayAt48k), REFERENCE_SAMPLE_RATE / Math.max(1, rate));
}

function seedFromText(value) {
  let seed = 2_166_136_261;
  for (const character of String(value)) {
    seed ^= character.codePointAt(0);
    seed = Math.imul(seed, 16_777_619);
  }
  return seed >>> 0 || 1;
}

function safeArray(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value) ? value : [];
}

class PhysicalSoundsProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.kind = String(options.processorOptions?.kind || "particle-cabinet");
    this.configuration = sanitizePhysicalSoundState(
      this.kind,
      options.processorOptions?.configuration ?? {},
    );
    const requestedFundamentalValue = options.processorOptions?.fundamentalOverrideHz;
    const requestedFundamental = Number(requestedFundamentalValue);
    this.fundamentalOverrideHz = requestedFundamentalValue !== null
      && requestedFundamentalValue !== undefined
      && Number.isFinite(requestedFundamental)
      ? clamp(requestedFundamental, MIN_MODE_FREQUENCY_HZ, this.rate * MAX_MODE_FREQUENCY_RATIO)
      : null;

    this.modeCount = 0;
    this.fundamentalHz = 0;
    this.modeReal = new Float64Array(MAX_MODES);
    this.modeImaginary = new Float64Array(MAX_MODES);
    this.modeCosine = new Float64Array(MAX_MODES);
    this.modeSine = new Float64Array(MAX_MODES);
    this.modeDecay = new Float64Array(MAX_MODES);
    this.modeGain = new Float64Array(MAX_MODES);
    this.modePanLeft = new Float64Array(MAX_MODES);
    this.modePanRight = new Float64Array(MAX_MODES);
    this.modeStrikeWeight = new Float64Array(MAX_MODES);
    this.modeFrequency = new Float64Array(MAX_MODES);

    this.randomState = 0x70687973 ^ this.kind.length;
    this.pendingImpulse = 0;
    this.pendingPosition = 0.5;
    this.pendingHardness = 0.55;
    this.driveGate = 0;
    this.driveTarget = 0;
    this.gateAction = "";
    this.activity = 0;
    this.eventCount = 0;
    this.lastEventStrength = 0;
    this.driveAttackCoefficient = coefficientAtSampleRate(0.0035, this.rate);
    this.driveReleaseCoefficient = coefficientAtSampleRate(0.0012, this.rate);
    this.activityDecay = decayAtSampleRate(0.999985, this.rate);
    this.directDcCoefficient = coefficientAtSampleRate(0.0015, this.rate);

    this.impactMode = "bounce";
    this.impactEnergy = 0;
    this.impactCountdown = 0;
    this.impactInterval = 0;
    this.impactAge = 0;
    this.impactDuration = 0;
    this.impactBurst = 0;
    this.impactNoise = 0;
    this.impactLastVoice = 0;
    this.activeImpactVoiceCount = 0;
    this.impactVoiceActive = new Uint8Array(MAX_IMPACT_VOICES);
    this.impactVoiceMode = new Uint8Array(MAX_IMPACT_VOICES);
    this.impactVoiceEnergy = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceCountdown = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceInterval = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceAge = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceDuration = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceBurst = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceNoise = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoicePosition = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceHardness = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceDensity = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceRestitution = new Float64Array(MAX_IMPACT_VOICES);
    this.impactVoiceChaos = new Float64Array(MAX_IMPACT_VOICES);

    this.bowPhase = 0;
    this.bowNoise = 0;
    this.airPhase = 0;
    this.airSecondPhase = 0;
    this.airNoise = 0;
    this.airEnvelope = 0;
    this.airRegister = 0;
    this.airPressure = 0;
    this.airBodyFeedback = 0;
    this.airRegime = "silent";
    this.directDc = 0;
    this.sourceDirect = 0;
    this.sourceModalInput = 0;
    this.modalLeft = 0;
    this.modalRight = 0;
    this.installedPresetId = "";
    this.installedBankIdentity = "";
    this.particleRateScale = 1;
    this.particleImpactScale = 1;
    this.particleCountCompensation = 1;
    this.particleContactBrightness = 0.5;
    this.particleContactDecay = 0;
    this.particleContactT60 = 0.006;
    this.particleNoiseCoefficient = 0.2;
    this.particleScrapeMix = 0.2;
    this.particleModalMix = 1;
    this.particleContactMix = 1;
    this.particleContactLevel = 0;
    this.particleNoiseLow = 0;
    this.particleMeanT60 = 0.25;
    this.particleActivityAttack = coefficientAtSampleRate(0.006, this.rate);
    this.particleActivityRelease = 1 - Math.exp(
      Math.log(0.001) / (0.5 * this.rate),
    );
    this.particleTransitionLeft = 0;
    this.particleTransitionRight = 0;
    this.particleTransitionRemaining = 0;
    this.particleTransitionLength = Math.max(1, Math.round(this.rate * 0.01));
    this.lastOutputLeft = 0;
    this.lastOutputRight = 0;
    this.outputGuardEnvelope = 0;
    this.outputGuardRelease = Math.exp(-1 / (0.12 * this.rate));

    this.blockCounter = 0;
    this.telemetryPeak = 0;
    this.telemetrySquare = 0;
    this.telemetrySamples = 0;
    this.lastTelemetryEventCount = 0;
    this.stopped = false;

    this._rebuildBank();
    this.port.onmessage = (event) => this._handleMessage(event.data);
  }

  _random() {
    let value = this.randomState | 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value | 0;
    return (value >>> 0) / 4294967296;
  }

  _signedRandom() {
    return this._random() * 2 - 1;
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      this.configuration = sanitizePhysicalSoundState(
        this.kind,
        { ...this.configuration, ...(message.configuration ?? {}) },
        this.configuration,
      );
      if (Object.hasOwn(message, "fundamentalOverrideHz")) {
        const requestedFundamentalValue = message.fundamentalOverrideHz;
        const requestedFundamental = Number(requestedFundamentalValue);
        this.fundamentalOverrideHz = requestedFundamentalValue !== null
          && Number.isFinite(requestedFundamental)
          ? clamp(requestedFundamental, MIN_MODE_FREQUENCY_HZ, this.rate * MAX_MODE_FREQUENCY_RATIO)
          : null;
      }
      this._rebuildBank();
      return;
    }
    if (message.type === "excite") {
      const strength = clamp(message.strength, 0, 1.5);
      const position = clamp(message.position, 0, 1);
      const hardness = clamp(message.hardness, 0, 1);
      const eventType = String(message.eventType || this.configuration.eventType || "strike");
      const ecologyEvents = ["bounce", "shatter", "crumple", "roll", "scrape"];
      if (this.kind === "impact-ecology" && eventType !== "strike") {
        this._startImpact(eventType, strength, position, hardness);
      } else if (ecologyEvents.includes(eventType)) {
        this._startImpact(eventType, strength, position, hardness);
      } else {
        this.pendingImpulse += strength;
        this.pendingPosition = position;
        this.pendingHardness = hardness;
        if (this.kind !== "particle-cabinet") {
          this.activity = Math.max(this.activity, strength);
        }
      }
      this.stopped = false;
      return;
    }
    if (message.type === "gate") {
      this.gateAction = String(message.action || "");
      this.driveTarget = message.active ? clamp(message.strength, 0.05, 1.5) : 0;
      if (message.active) {
        this.pendingPosition = clamp(message.position, 0, 1);
        this.pendingHardness = clamp(message.hardness, 0, 1);
        this.stopped = false;
      }
      return;
    }
    if (message.type === "custom-bank" && this.kind === "object-forge") {
      this._installCustomBank(message.bank);
      return;
    }
    if (message.type === "silence") this._silence();
  }

  _silence() {
    this.modeReal.fill(0);
    this.modeImaginary.fill(0);
    this.pendingImpulse = 0;
    this.driveGate = 0;
    this.driveTarget = 0;
    this.activity = 0;
    this.impactEnergy = 0;
    this.impactCountdown = 0;
    this.impactAge = 0;
    this.impactBurst = 0;
    this.impactVoiceActive.fill(0);
    this.impactVoiceEnergy.fill(0);
    this.impactVoiceCountdown.fill(0);
    this.impactVoiceAge.fill(0);
    this.activeImpactVoiceCount = 0;
    this.airEnvelope = 0;
    this.airRegister = 0;
    this.airPressure = 0;
    this.airBodyFeedback = 0;
    this.airRegime = "silent";
    this.particleContactLevel = 0;
    this.particleNoiseLow = 0;
    this.particleTransitionLeft = 0;
    this.particleTransitionRight = 0;
    this.particleTransitionRemaining = 0;
    this.lastOutputLeft = 0;
    this.lastOutputRight = 0;
    this.outputGuardEnvelope = 0;
    this.directDc = 0;
    this.stopped = true;
  }

  _rebuildBank() {
    const bank = buildPhysicalModalBank(this.kind, this.configuration, {
      sampleRate: this.rate,
      maxModes: MAX_MODES,
      ...(this.fundamentalOverrideHz === null
        ? {}
        : { fundamentalOverrideHz: this.fundamentalOverrideHz }),
    });
    this._installBank(bank, false);
  }

  _installCustomBank(candidate) {
    if (!candidate || typeof candidate !== "object") return;
    const frequenciesHz = safeArray(candidate.frequenciesHz);
    const t60Seconds = safeArray(candidate.t60Seconds);
    const gains = safeArray(candidate.gains);
    if (!frequenciesHz.length || frequenciesHz.length !== t60Seconds.length) return;
    const modeCount = Math.min(MAX_MODES, frequenciesHz.length);
    const bank = {
      fundamentalHz: clamp(
        candidate.fundamentalHz ?? frequenciesHz[0],
        MIN_MODE_FREQUENCY_HZ,
        this.rate * MAX_MODE_FREQUENCY_RATIO,
      ),
      frequenciesHz: new Float64Array(modeCount),
      t60Seconds: new Float64Array(modeCount),
      gains: new Float64Array(modeCount),
      pans: new Float64Array(modeCount),
      strikeWeights: new Float64Array(modeCount),
    };
    const pans = safeArray(candidate.pans);
    const strikeWeights = safeArray(candidate.strikeWeights);
    for (let index = 0; index < modeCount; index += 1) {
      bank.frequenciesHz[index] = clamp(
        frequenciesHz[index],
        MIN_MODE_FREQUENCY_HZ,
        this.rate * MAX_MODE_FREQUENCY_RATIO,
      );
      bank.t60Seconds[index] = clamp(
        t60Seconds[index],
        MIN_MODE_T60_SECONDS,
        MAX_MODE_T60_SECONDS,
      );
      bank.gains[index] = clamp(gains[index] ?? 1 / Math.sqrt(index + 1), -4, 4);
      bank.pans[index] = clamp(pans[index] ?? 0, -1, 1);
      bank.strikeWeights[index] = clamp(strikeWeights[index] ?? 1, -4, 4);
    }
    this._installBank(bank, true, true);
  }

  _installBank(bank, announce = false, forceTransition = false) {
    const frequencies = safeArray(bank?.frequenciesHz);
    const decays = safeArray(bank?.t60Seconds);
    const gains = safeArray(bank?.gains);
    const pans = safeArray(bank?.pans);
    const strikeWeights = safeArray(bank?.strikeWeights);
    const previousCount = this.modeCount;
    const presetId = String(bank?.presetId || this.configuration.presetId || "");
    const bankIdentity = String(bank?.structureKey || `${bank?.source || "bank"}:${presetId}`);
    const structureChanged = Boolean(
      this.installedBankIdentity
      && (forceTransition || bankIdentity !== this.installedBankIdentity),
    );
    this.modeCount = Math.min(
      MAX_MODES,
      frequencies.length,
      decays.length,
      gains.length,
    );
    this.fundamentalHz = clamp(
      bank?.fundamentalHz ?? frequencies[0],
      MIN_MODE_FREQUENCY_HZ,
      this.rate * MAX_MODE_FREQUENCY_RATIO,
    );
    let particleDecayWeight = 0;
    let particleWeightedT60 = 0;
    for (let index = 0; index < this.modeCount; index += 1) {
      const frequency = clamp(
        frequencies[index],
        MIN_MODE_FREQUENCY_HZ,
        this.rate * MAX_MODE_FREQUENCY_RATIO,
      );
      const t60 = clamp(
        decays[index],
        MIN_MODE_T60_SECONDS,
        MAX_MODE_T60_SECONDS,
      );
      const pan = clamp(pans[index] ?? 0, -1, 1);
      const angle = TWO_PI * frequency / this.rate;
      this.modeFrequency[index] = frequency;
      this.modeCosine[index] = Math.cos(angle);
      this.modeSine[index] = Math.sin(angle);
      this.modeDecay[index] = Math.exp(Math.log(0.001) / (t60 * this.rate));
      const authoredGain = clamp(gains[index], -4, 4);
      const decayWeight = authoredGain * authoredGain;
      particleDecayWeight += decayWeight;
      particleWeightedT60 += t60 * decayWeight;
      const particleEnergy = clamp(this.configuration.energy);
      this.modeGain[index] = this.kind === "particle-cabinet" && particleEnergy > 1e-6
        ? clamp(authoredGain / particleEnergy, -4, 4)
        : authoredGain;
      this.modePanLeft[index] = Math.sqrt((1 - pan) * 0.5);
      this.modePanRight[index] = Math.sqrt((1 + pan) * 0.5);
      this.modeStrikeWeight[index] = clamp(strikeWeights[index] ?? 1, -4, 4);
    }
    for (let index = this.modeCount; index < previousCount; index += 1) {
      this.modeReal[index] = 0;
      this.modeImaginary[index] = 0;
    }
    if (structureChanged) {
      this.particleTransitionLeft = this.lastOutputLeft;
      this.particleTransitionRight = this.lastOutputRight;
      this.particleTransitionRemaining = this.particleTransitionLength;
      this.modeReal.fill(0);
      this.modeImaginary.fill(0);
      if (this.kind === "particle-cabinet") {
        this.particleContactLevel = 0;
        this.particleNoiseLow = 0;
      }
    }
    if (this.kind === "particle-cabinet") {
      const profile = bank?.particleExciter ?? {};
      const particleSize = clamp(this.configuration.particleSize);
      const roughness = clamp(this.configuration.roughness);
      const profileBrightness = clamp(profile.contactBrightness ?? 0.5);
      const contactBrightness = clamp(
        profileBrightness * 0.68
          + clamp(this.configuration.brightness) * 0.32
          + (0.5 - particleSize) * 0.16,
      );
      const contactT60 = clamp(
        Number(profile.contactT60Seconds) || 0.006,
        0.0015,
        0.04,
      ) * (0.62 + particleSize * 0.9) * (1.08 - roughness * 0.16);
      this.particleRateScale = clamp(profile.rateScale ?? 1, 0.2, 3)
        * (1.58 - particleSize * 1.08);
      this.particleImpactScale = clamp(profile.impactScale ?? 1, 0.2, 3)
        * (0.45 + particleSize * 1.35);
      const objectCount = clamp(this.configuration.objectCount, 1, 1_024);
      const referenceObjectCount = clamp(profile.referenceObjectCount ?? 48, 1, 1_024);
      const collisionSlope = 9 + roughness * 28;
      const collisionDensity = 4 + Math.sqrt(objectCount) * collisionSlope;
      const referenceDensity = 4 + Math.sqrt(referenceObjectCount) * collisionSlope;
      this.particleCountCompensation = Math.sqrt(referenceDensity / collisionDensity);
      this.particleContactBrightness = contactBrightness;
      this.particleContactDecay = Math.exp(
        Math.log(0.001) / (Math.max(0.0015, contactT60) * this.rate),
      );
      this.particleContactT60 = contactT60;
      this.particleNoiseCoefficient = 0.025 + Math.pow(contactBrightness, 1.55) * 0.54;
      this.particleNoiseCoefficient = coefficientAtSampleRate(
        this.particleNoiseCoefficient,
        this.rate,
      );
      this.particleScrapeMix = clamp(profile.scrapeMix ?? 0.2) * (0.3 + roughness * 0.9);
      this.particleModalMix = clamp(profile.modalMix ?? 1, 0.1, 3);
      this.particleContactMix = clamp(profile.contactMix ?? 1, 0.1, 4);
      const systemT60 = clamp(profile.systemT60Seconds ?? 0.5, 0.04, 2.5);
      this.particleActivityRelease = 1 - Math.exp(
        Math.log(0.001) / (systemT60 * this.rate),
      );
      this.particleMeanT60 = particleDecayWeight > 1e-12
        ? particleWeightedT60 / particleDecayWeight
        : 0.25;
      if (clamp(this.configuration.energy) === 0) {
        this.activity = 0;
        this.particleContactLevel = 0;
        this.particleNoiseLow = 0;
        this.particleTransitionLeft = 0;
        this.particleTransitionRight = 0;
        this.particleTransitionRemaining = 0;
        this.sourceDirect = 0;
        this.directDc = 0;
        this.modeReal.fill(0);
        this.modeImaginary.fill(0);
      }
    }
    if (presetId !== this.installedPresetId) {
      this.randomState = seedFromText(`${this.kind}:${presetId}`);
      this.installedPresetId = presetId;
    }
    this.installedBankIdentity = bankIdentity;
    if (announce) {
      this.port.postMessage({
        type: "custom-bank-loaded",
        modeCount: this.modeCount,
        lowestFrequencyHz: this.modeFrequency[0] || 0,
      });
    }
  }

  _startImpact(eventType, strength, position, hardness) {
    const type = IMPACT_MODES.includes(eventType) ? eventType : "bounce";
    const initialEnergy = Math.max(0, strength) * clamp(this.configuration.energy);
    if (!(initialEnergy > SILENCE_FLOOR)) return;
    let voice = -1;
    let quietestScore = Infinity;
    for (let index = 0; index < MAX_IMPACT_VOICES; index += 1) {
      if (!this.impactVoiceActive[index]) {
        voice = index;
        break;
      }
      const progress = this.impactVoiceAge[index]
        / Math.max(1, this.impactVoiceDuration[index]);
      const score = this.impactVoiceEnergy[index] * Math.max(0, 1 - progress);
      if (score < quietestScore) {
        quietestScore = score;
        voice = index;
      }
    }

    const density = clamp(this.configuration.eventDensity, 0.1, 200);
    const duration = this.rate * (
      type === "shatter" ? 1.35
        : type === "crumple" ? 2.2
          : type === "roll" ? 3.8
            : type === "scrape" ? 2.8
              : 7
    );
    const interval = clamp(
      this.rate * Math.sqrt(clamp(this.configuration.size, 0.25, 4)) / density,
      this.rate * 0.011,
      this.rate * 1.5,
    );

    this.impactVoiceActive[voice] = 1;
    this.impactVoiceMode[voice] = IMPACT_MODES.indexOf(type);
    this.impactVoiceEnergy[voice] = initialEnergy;
    this.impactVoiceCountdown[voice] = 0;
    this.impactVoiceInterval[voice] = interval;
    this.impactVoiceAge[voice] = 0;
    this.impactVoiceDuration[voice] = duration;
    this.impactVoiceBurst[voice] = type === "crumple" ? 0.5 : 1;
    this.impactVoiceNoise[voice] = 0;
    this.impactVoicePosition[voice] = position;
    this.impactVoiceHardness[voice] = hardness;
    this.impactVoiceDensity[voice] = density;
    this.impactVoiceRestitution[voice] = clamp(this.configuration.restitution, 0.02, 0.98);
    this.impactVoiceChaos[voice] = clamp(this.configuration.chaos);

    this.impactLastVoice = voice;
    this.impactMode = type;
    this.impactEnergy = this.impactVoiceEnergy[voice];
    this.impactAge = 0;
    this.impactDuration = duration;
    this.impactInterval = interval;
    this.impactCountdown = 0;
    this.impactBurst = type === "crumple" ? 0.5 : 1;
    this.activeImpactVoiceCount = 0;
    for (let index = 0; index < MAX_IMPACT_VOICES; index += 1) {
      this.activeImpactVoiceCount += this.impactVoiceActive[index];
    }
    this.activity = Math.max(this.activity, strength);
    this.stopped = false;
  }

  _injectModes(strength, position = 0.5, hardness = 0.5, scatter = 0, updateActivity = true) {
    if (!(strength > SILENCE_FLOOR)) return;
    const normalizedPosition = clamp(position, 0.015, 0.985);
    const bright = 0.35 + clamp(hardness) * 2.65;
    const familyNormalization = this.kind === "particle-cabinet" ? 0.12 : 0.035;
    const normalization = familyNormalization / Math.sqrt(Math.max(1, this.modeCount));
    for (let index = 0; index < this.modeCount; index += 1) {
      const order = index + 1;
      const spatial = Math.sin(Math.PI * order * normalizedPosition);
      const spectral = 1 / Math.pow(order, 1.55 - bright * 0.38);
      const randomGain = scatter > 0 ? 1 + this._signedRandom() * scatter : 1;
      let inputWeight = this.modeStrikeWeight[index];
      if (this.kind === "particle-cabinet") inputWeight *= spatial;
      else if (this.kind === "impact-ecology") {
        const configuredPosition = clamp(this.configuration.strikePosition, 0.015, 0.985);
        const configuredShape = Math.sin(Math.PI * order * configuredPosition);
        const ratio = Math.abs(configuredShape) > 0.05 ? spatial / configuredShape : spatial;
        inputWeight *= clamp(ratio, -4, 4);
      }
      const impulse = strength * normalization * inputWeight * spectral * randomGain;
      this.modeImaginary[index] += impulse;
    }
    this.eventCount += 1;
    this.lastEventStrength = strength;
    if (updateActivity) this.activity = Math.max(this.activity, strength);
  }

  _particleExcitation() {
    const state = this.configuration;
    const sourceEnergy = clamp(state.energy);
    if (!(sourceEnergy > SILENCE_FLOOR)) {
      this.activity = 0;
      this.particleContactLevel = 0;
      return 0;
    }
    // Particle energy is a normalized physical control. Pointer velocity may
    // overshoot unity, but letting that overshoot compound event rate, impact
    // amplitude, and scrape gain makes dense legal settings pin the output.
    const effectiveDrive = clamp(this.driveGate);
    const gateEnergy = effectiveDrive * sourceEnergy;
    this.activity += (gateEnergy - this.activity) * (
      gateEnergy > this.activity
        ? this.particleActivityAttack
        : this.particleActivityRelease
    );
    const count = clamp(state.objectCount, 1, 1024);
    const particleSize = clamp(state.particleSize);
    const roughness = clamp(state.roughness);
    const gravity = clamp(state.gravity, 0, 2);
    const collisionRate = (4 + Math.sqrt(count) * (9 + roughness * 28))
      * this.particleRateScale
      * (0.78 + gravity * 0.22)
      * Math.pow(clamp(this.activity, 0, 1.5), 1.35);
    let direct = 0;
    const collisionProbability = 1 - Math.exp(-collisionRate / this.rate);
    if (this._random() < collisionProbability) {
      const collisionAmplitude = Math.min(
        1.5,
        clamp(this.activity, 0, 1.5) * (0.55 + gravity * 0.45),
      );
      const resonantLoad = collisionRate
        * this.particleImpactScale * this.particleImpactScale
        * this.particleCountCompensation * this.particleCountCompensation
        * this.particleModalMix * this.particleModalMix
        * collisionAmplitude * collisionAmplitude
        * this.particleMeanT60;
      // Preserve density as a timbral control without allowing many long-lived
      // impacts to become an unbounded gain control.
      const accumulationScale = Math.min(
        1,
        Math.sqrt(
          PARTICLE_RESONANT_LOAD_KNEE
            / Math.max(PARTICLE_RESONANT_LOAD_KNEE, resonantLoad),
        ),
      );
      const strength = Math.min(1.5, (0.18 + this._random() * 0.82)
        * clamp(this.activity, 0, 1.5)
        * (0.55 + gravity * 0.45)
        * this.particleImpactScale
        * this.particleCountCompensation
        * accumulationScale);
      const position = clamp(this.pendingPosition + this._signedRandom() * 0.42, 0.02, 0.98);
      const hardness = clamp(
        this.particleContactBrightness
          + this._signedRandom() * (0.06 + roughness * 0.18),
      );
      this._injectModes(strength, position, hardness, 0.14 + roughness * 0.46, false);
      const contactLoad = collisionRate
        * this.particleImpactScale * this.particleImpactScale
        * this.particleCountCompensation * this.particleCountCompensation
        * this.particleContactMix * this.particleContactMix
        * collisionAmplitude * collisionAmplitude
        * this.particleContactT60;
      const contactAccumulationScale = Math.min(
        1,
        Math.sqrt(4 / Math.max(4, contactLoad)),
      );
      this.particleContactLevel = Math.min(
        4,
        this.particleContactLevel
          + strength * (0.43 + particleSize * 0.64) * contactAccumulationScale,
      );
    }
    const contactNoise = this._signedRandom();
    this.particleNoiseLow += (contactNoise - this.particleNoiseLow)
      * this.particleNoiseCoefficient;
    const contactHigh = contactNoise - this.particleNoiseLow;
    const coloredContact = this.particleNoiseLow * (0.72 + particleSize * 0.48)
      + contactHigh * (0.08 + this.particleContactBrightness * 0.38);
    direct += coloredContact * this.particleContactLevel * 0.034;
    this.particleContactLevel *= this.particleContactDecay;
    if (this.driveGate > 0.02 && roughness > 0.05) {
      direct += contactHigh * effectiveDrive * sourceEnergy
        * roughness * roughness * this.particleScrapeMix * 0.012;
    }
    return direct;
  }

  _impactExcitation() {
    let activeCount = 0;
    for (let voice = 0; voice < MAX_IMPACT_VOICES; voice += 1) {
      if (this.impactVoiceActive[voice]) activeCount += 1;
    }
    if (!activeCount) {
      this.activeImpactVoiceCount = 0;
      this.impactEnergy = 0;
      return 0;
    }

    const mixScale = 1 / Math.sqrt(activeCount);
    let direct = 0;

    for (let voice = 0; voice < MAX_IMPACT_VOICES; voice += 1) {
      if (!this.impactVoiceActive[voice]) continue;
      const mode = IMPACT_MODES[this.impactVoiceMode[voice]];
      const density = this.impactVoiceDensity[voice];
      const hardness = this.impactVoiceHardness[voice];
      const chaos = this.impactVoiceChaos[voice];
      const age = this.impactVoiceAge[voice];
      const duration = this.impactVoiceDuration[voice];

      if (!(this.impactVoiceEnergy[voice] > 0) || age > duration) {
        this.impactVoiceActive[voice] = 0;
        continue;
      }

      if (mode === "bounce") {
        this.impactVoiceCountdown[voice] -= 1;
        if (this.impactVoiceCountdown[voice] <= 0) {
          const strength = this.impactVoiceEnergy[voice]
            * (0.84 + this._random() * 0.16) * mixScale;
          this._injectModes(
            strength,
            this.impactVoicePosition[voice],
            hardness,
            chaos * 0.12,
          );
          direct += this._signedRandom() * strength * hardness * 0.018;
          const restitution = this.impactVoiceRestitution[voice];
          this.impactVoiceEnergy[voice] *= restitution;
          this.impactVoiceInterval[voice] = Math.max(
            this.rate * 0.011,
            this.impactVoiceInterval[voice] * restitution,
          );
          this.impactVoiceCountdown[voice] = this.impactVoiceInterval[voice];
          if (this.impactVoiceEnergy[voice] < 0.012) {
            this.impactVoiceEnergy[voice] = 0;
            this.impactVoiceActive[voice] = 0;
          }
        }
      } else {
        const progress = clamp(age / Math.max(1, duration));
        const envelope = mode === "shatter"
          ? Math.pow(1 - progress, 1.8)
          : mode === "scrape"
            ? Math.sin(Math.PI * Math.pow(progress, 0.72))
            : Math.pow(1 - progress, 0.55);
        if (mode === "crumple") {
          this.impactVoiceBurst[voice] += this._signedRandom() * 0.014;
          this.impactVoiceBurst[voice] += (0.35 - this.impactVoiceBurst[voice]) * 0.0015;
          this.impactVoiceBurst[voice] = clamp(this.impactVoiceBurst[voice], 0, 1);
        }
        const burst = mode === "crumple" ? this.impactVoiceBurst[voice] : 1;
        const eventsPerSecond = mode === "shatter"
          ? (18 + density * 2.4) * envelope
          : mode === "crumple"
            ? (4 + density * 1.25) * envelope * (0.18 + burst * 0.82)
            : mode === "roll"
              ? (10 + density * 1.6) * (0.45 + envelope * 0.55)
              : (8 + density * 2.1) * envelope;
        this.impactVoiceInterval[voice] = this.rate / Math.max(0.1, eventsPerSecond);
        if (this._random() < eventsPerSecond / this.rate) {
          const exponent = mode === "shatter" ? 1.8
            : mode === "roll" ? 4.2
              : mode === "scrape" ? 5.4
                : 2.8;
          const distribution = Math.pow(this._random(), exponent);
          const contactScale = mode === "roll" ? 0.28
            : mode === "scrape" ? 0.18
              : 0.8;
          const strength = this.impactVoiceEnergy[voice] * envelope
            * (0.025 + distribution * contactScale) * mixScale;
          const travel = (mode === "roll" || mode === "scrape")
            ? (progress - 0.5) * (0.72 + chaos * 0.24)
            : 0;
          const position = clamp(
            this.impactVoicePosition[voice] + travel + this._signedRandom() * chaos * 0.48,
            0.02,
            0.98,
          );
          this._injectModes(strength, position, hardness, 0.28 + chaos * 0.42);
          direct += this._signedRandom() * strength * hardness * 0.024;
        }
        if (mode === "scrape") {
          const noise = this._signedRandom();
          this.impactVoiceNoise[voice] += (noise - this.impactVoiceNoise[voice])
            * (0.04 + hardness * 0.42);
          direct += this.impactVoiceNoise[voice] * envelope
            * this.impactVoiceEnergy[voice] * mixScale
            * (0.0015 + hardness * 0.0085);
        } else if (mode === "roll") {
          const wobble = 0.45 + 0.55
            * Math.abs(Math.sin(age * TWO_PI * density / this.rate));
          direct += this._signedRandom() * envelope * wobble
            * this.impactVoiceEnergy[voice] * hardness * 0.0018 * mixScale;
        }
        if (progress >= 1) {
          this.impactVoiceEnergy[voice] = 0;
          this.impactVoiceActive[voice] = 0;
        }
      }
      this.impactVoiceAge[voice] += 1;
    }

    activeCount = 0;
    let strongestEnergy = 0;
    let shortestInterval = Infinity;
    for (let voice = 0; voice < MAX_IMPACT_VOICES; voice += 1) {
      if (!this.impactVoiceActive[voice]) continue;
      activeCount += 1;
      strongestEnergy = Math.max(strongestEnergy, this.impactVoiceEnergy[voice]);
      shortestInterval = Math.min(shortestInterval, this.impactVoiceInterval[voice]);
    }
    this.activeImpactVoiceCount = activeCount;
    this.impactEnergy = strongestEnergy;
    this.impactInterval = Number.isFinite(shortestInterval) ? shortestInterval : 0;
    const latest = this.impactLastVoice;
    this.impactAge = this.impactVoiceAge[latest];
    this.impactDuration = this.impactVoiceDuration[latest];
    this.impactCountdown = this.impactVoiceCountdown[latest];
    this.impactBurst = this.impactVoiceBurst[latest];
    this.impactNoise = this.impactVoiceNoise[latest];
    this.activity *= 0.99994;
    return direct;
  }

  _bowExcitation() {
    const state = this.configuration;
    const pressure = clamp(state.bowPressure, 0, 1.5) * this.driveGate;
    this.activity += (pressure - this.activity)
      * (pressure > this.activity ? 0.004 : 0.00035);
    if (pressure < 1e-5) return 0;
    const velocityControl = clamp(state.bowVelocity, 0.01, 1.5);
    let bodyVelocity = 0;
    for (let index = 0; index < this.modeCount; index += 1) {
      bodyVelocity += this.modeImaginary[index] * this.modeGain[index];
    }
    bodyVelocity = clamp(bodyVelocity * 2.4, -2, 2);
    const relativeVelocity = velocityControl - bodyVelocity * (0.22 + pressure * 0.18);
    const rosin = clamp(state.rosin);
    const bowSlope = 1.4 + rosin * 8.6;
    const bowTable = Math.min(1, Math.pow(Math.abs(relativeVelocity * bowSlope) + 0.72, -4));
    const baseFrequency = clamp(this.modeFrequency[0], MIN_MODE_FREQUENCY_HZ, this.rate * 0.18);
    this.bowPhase += TWO_PI * baseFrequency * (0.93 + velocityControl * 0.14) / this.rate;
    if (this.bowPhase >= TWO_PI) this.bowPhase -= TWO_PI;
    const stickSlip = Math.tanh(Math.sin(this.bowPhase) * (2.2 + rosin * 9));
    this.bowNoise += (this._signedRandom() - this.bowNoise) * (0.02 + rosin * 0.12);
    return pressure * (
      relativeVelocity * bowTable * 0.052
      + stickSlip * (0.0025 + pressure * 0.004)
      + this.bowNoise * rosin * 0.002
    );
  }

  _airFrequency() {
    const fundamental = this.modeFrequency[0] || 220;
    if (this.configuration.airflowMode === "aeolian") {
      return clamp(fundamental, MIN_MODE_FREQUENCY_HZ, this.rate * 0.42);
    }
    const registerFrequency = this.modeFrequency[1]
      || fundamental * (this.configuration.airflowMode === "cavity" ? 3 : 2.9);
    return clamp(
      fundamental + (registerFrequency - fundamental) * smoothstep(this.airRegister),
      MIN_MODE_FREQUENCY_HZ,
      this.rate * 0.42,
    );
  }

  _airOnsetSpeed() {
    const aperture = clamp(this.configuration.aperture, 0.01, 1);
    if (this.configuration.airflowMode === "aeolian") {
      return 1.4 + clamp(this.configuration.diameter, 0.002, 0.5) * 55;
    }
    if (this.configuration.airflowMode === "bottle") return 1.2 + aperture * 6;
    return 2.2 + aperture * 8;
  }

  _airExcitation() {
    const state = this.configuration;
    const flow = this.driveGate;
    const sourceEnergy = clamp(state.energy);
    const onsetSpeed = this._airOnsetSpeed();
    this.airPressure = clamp(state.airSpeed, 0, 80) * flow * sourceEnergy;
    const voicedAmount = smoothstep(
      (this.airPressure - onsetSpeed) / Math.max(1, onsetSpeed * 0.8),
    );
    const envelopeTarget = flow * voicedAmount;
    this.airEnvelope += (envelopeTarget - this.airEnvelope)
      * (envelopeTarget > this.airEnvelope ? 0.0025 : 0.00032);
    const overblowStart = onsetSpeed * 3.5;
    const overblowTarget = state.airflowMode === "aeolian"
      ? 0
      : smoothstep(
          (this.airPressure - overblowStart) / Math.max(1, overblowStart * 0.65),
        );
    this.airRegister += (overblowTarget - this.airRegister)
      * (overblowTarget > this.airRegister ? 0.0008 : 0.00024);
    this.activity += (this.airEnvelope - this.activity)
      * (this.airEnvelope > this.activity ? 0.004 : 0.00035);
    const turbulence = clamp(state.turbulence);
    this.airNoise += (this._signedRandom() - this.airNoise) * (0.015 + turbulence * 0.22);

    if (flow < 0.002 && this.airEnvelope < 0.001) this.airRegime = "silent";
    else if (voicedAmount <= 0.001 && this.airEnvelope < 0.01) this.airRegime = "noise";
    else if (state.airflowMode === "aeolian") this.airRegime = "vortex tone";
    else if (this.airRegister > 0.28) this.airRegime = "overblown";
    else this.airRegime = "fundamental";

    if (this.airEnvelope < 1e-6) {
      if (this.airRegime !== "noise") return 0;
      const proximity = clamp(this.airPressure / Math.max(0.001, onsetSpeed));
      return this.airNoise * turbulence * flow * proximity * sourceEnergy * 0.0012;
    }

    const fundamental = this.modeFrequency[0] || 220;
    const registerFrequency = this.modeFrequency[1]
      || fundamental * (state.airflowMode === "cavity" ? 3 : 2.9);
    this.airPhase += TWO_PI * fundamental / this.rate;
    this.airSecondPhase += TWO_PI * (
      state.airflowMode === "aeolian" ? fundamental * 2.03 : registerFrequency
    ) / this.rate;
    if (this.airPhase >= TWO_PI) this.airPhase -= TWO_PI;
    if (this.airSecondPhase >= TWO_PI) this.airSecondPhase -= TWO_PI;
    const registerMix = smoothstep(this.airRegister);
    const fundamentalTone = Math.sin(this.airPhase);
    const registerTone = Math.sin(this.airSecondPhase);
    const modeShape = state.airflowMode === "aeolian"
      ? fundamentalTone + registerTone * 0.17
      : state.airflowMode === "bottle"
        ? fundamentalTone * 0.78 * (1 - registerMix)
          + registerTone * 0.68 * registerMix
        : Math.tanh(fundamentalTone * (1.4 + turbulence * 3)) * (1 - registerMix)
          + Math.tanh(registerTone * (1.25 + turbulence * 2.4)) * registerMix;
    const bodyFeedback = Math.tanh(
      this.airBodyFeedback * (2.4 + this.airRegister * 5.6),
    );
    return sourceEnergy * this.airEnvelope * (
      modeShape * (0.012 + (1 - turbulence) * 0.015)
      + this.airNoise * turbulence * 0.019
      + bodyFeedback * (0.003 + this.airRegister * 0.012)
    );
  }

  _renderModes(input) {
    let left = 0;
    let right = 0;
    for (let index = 0; index < this.modeCount; index += 1) {
      const real = this.modeReal[index];
      const imaginary = this.modeImaginary[index]
        + input * this.modeStrikeWeight[index] * 0.018;
      const decay = this.modeDecay[index];
      let nextReal = (real * this.modeCosine[index] - imaginary * this.modeSine[index]) * decay;
      let nextImaginary = (real * this.modeSine[index] + imaginary * this.modeCosine[index]) * decay;
      if (!Number.isFinite(nextReal) || Math.abs(nextReal) < SILENCE_FLOOR) nextReal = 0;
      if (!Number.isFinite(nextImaginary) || Math.abs(nextImaginary) < SILENCE_FLOOR) nextImaginary = 0;
      this.modeReal[index] = nextReal;
      this.modeImaginary[index] = nextImaginary;
      const sample = nextReal * this.modeGain[index];
      left += sample * this.modePanLeft[index];
      right += sample * this.modePanRight[index];
    }
    this.modalLeft = left * 0.9;
    this.modalRight = right * 0.9;
  }

  _sourceSample() {
    this.driveGate += (this.driveTarget - this.driveGate)
      * (this.driveTarget > this.driveGate
        ? this.driveAttackCoefficient
        : this.driveReleaseCoefficient);
    let direct = 0;
    let modalInput = 0;

    if (this.pendingImpulse > SILENCE_FLOOR) {
      const impulse = Math.min(2, this.pendingImpulse)
        * (this.kind === "particle-cabinet" ? clamp(this.configuration.energy) : 1);
      this._injectModes(
        impulse,
        this.pendingPosition,
        this.pendingHardness,
        0.04,
        this.kind !== "particle-cabinet",
      );
      if (this.kind === "particle-cabinet") {
        this.particleContactLevel = Math.min(
          4,
          this.particleContactLevel + impulse * this.particleImpactScale * 0.72,
        );
      }
      this.pendingImpulse = 0;
    }

    if (this.kind === "particle-cabinet") direct += this._particleExcitation();
    else if (this.kind === "impact-ecology") direct += this._impactExcitation();
    else if (this.kind === "bowed-things") modalInput += this._bowExcitation();
    else if (this.kind === "airflow-objects") {
      modalInput += this._airExcitation();
      direct += modalInput * 0.32;
    }
    if (this.kind !== "particle-cabinet") this.activity *= this.activityDecay;
    this.sourceDirect = direct;
    this.sourceModalInput = modalInput;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left) return true;
    let blockPeak = 0;
    let blockSquare = 0;

    for (let frame = 0; frame < left.length; frame += 1) {
      this._sourceSample();
      this._renderModes(this.sourceModalInput);
      if (this.kind === "airflow-objects") {
        const bodyOutput = clamp((this.modalLeft + this.modalRight) * 0.5, -1, 1);
        this.airBodyFeedback += (bodyOutput - this.airBodyFeedback) * 0.08;
      }
      this.directDc += (this.sourceDirect - this.directDc) * this.directDcCoefficient;
      const centeredDirect = this.sourceDirect - this.directDc;
      const outputLevel = this.stopped ? 0 : 1;
      let modalDrive = 2.8;
      let directDrive = 2.8;
      if (this.kind === "particle-cabinet") {
        modalDrive = 45 * this.particleModalMix;
        directDrive = 30 * this.particleContactMix;
      } else if (this.kind === "impact-ecology") {
        modalDrive = 220;
        directDrive = 176;
      } else if (this.kind === "object-forge") {
        modalDrive = 210;
        directDrive = 72;
      } else if (this.kind === "bowed-things") {
        modalDrive = 48;
        directDrive = 48;
      }
      const rawLeft = this.modalLeft * modalDrive + centeredDirect * directDrive;
      const rawRight = this.modalRight * modalDrive + centeredDirect * directDrive;
      const rawPeak = Math.max(Math.abs(rawLeft), Math.abs(rawRight));
      this.outputGuardEnvelope = Math.max(
        rawPeak,
        this.outputGuardEnvelope * this.outputGuardRelease,
      );
      // Keep the family calibration out of the flat end of the soft clip at
      // extreme legal settings while only trimming the hottest preset peaks.
      const guardGain = Math.min(
        1,
        OUTPUT_GUARD_RAW_CEILING
          / Math.max(OUTPUT_GUARD_RAW_CEILING, this.outputGuardEnvelope),
      );
      let leftSample = softClip(rawLeft * guardGain) * outputLevel;
      let rightSample = softClip(rawRight * guardGain) * outputLevel;
      if (this.particleTransitionRemaining > 0) {
        const elapsed = this.particleTransitionLength - this.particleTransitionRemaining;
        const progress = this.particleTransitionLength <= 1
          ? 1
          : elapsed / (this.particleTransitionLength - 1);
        const fadeIn = smoothstep(progress);
        leftSample = this.particleTransitionLeft * (1 - fadeIn) + leftSample * fadeIn;
        rightSample = this.particleTransitionRight * (1 - fadeIn) + rightSample * fadeIn;
        this.particleTransitionRemaining -= 1;
      }
      left[frame] = leftSample;
      if (right) right[frame] = rightSample;
      this.lastOutputLeft = leftSample;
      this.lastOutputRight = rightSample;
      const peak = Math.max(Math.abs(leftSample), Math.abs(rightSample));
      blockPeak = Math.max(blockPeak, peak);
      blockSquare += (leftSample * leftSample + rightSample * rightSample) * 0.5;
    }

    this.telemetryPeak = Math.max(this.telemetryPeak * 0.82, blockPeak);
    this.telemetrySquare += blockSquare;
    this.telemetrySamples += left.length;
    this.blockCounter += 1;
    if (this.blockCounter >= TELEMETRY_BLOCKS) {
      const telemetrySeconds = this.telemetrySamples / this.rate;
      const eventRate = (this.eventCount - this.lastTelemetryEventCount)
        / Math.max(1e-6, telemetrySeconds);
      this.port.postMessage({
        type: "telemetry",
        kind: this.kind,
        modeCount: this.modeCount,
        peak: this.telemetryPeak,
        rms: Math.sqrt(this.telemetrySquare / Math.max(1, this.telemetrySamples)),
        activity: clamp(this.activity, 0, 1.5),
        eventCount: this.eventCount,
        eventRate,
        gateLevel: this.driveGate,
        impactVoiceCount: this.activeImpactVoiceCount,
        impactIntervalMs: this.kind === "impact-ecology" && this.impactEnergy > 0
          ? this.impactInterval / this.rate * 1000
          : 0,
        lastEventStrength: this.lastEventStrength,
        fundamentalHz: this.kind === "airflow-objects"
          ? this._airFrequency()
          : this.fundamentalHz,
        airRegime: this.kind === "airflow-objects" ? this.airRegime : "silent",
        airRegister: this.kind === "airflow-objects" ? this.airRegister : 0,
      });
      this.blockCounter = 0;
      this.telemetrySquare = 0;
      this.telemetrySamples = 0;
      this.lastTelemetryEventCount = this.eventCount;
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, PhysicalSoundsProcessor);

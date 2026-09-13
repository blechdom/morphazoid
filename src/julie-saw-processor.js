import {
  JULIE_SAW_DEFAULTS,
  bendToFrequency,
  clamp,
  contactAlignment,
  julieSawBlade,
  julieSawRhythm,
  sanitizeJulieSawState,
  sweetSpotPosition,
} from "./julie-saw.js";
import { buildPhysicalModalBank } from "./physical-sounds.js";

const PROCESSOR_NAME = "julie-saw-physical-model";
const TWO_PI = Math.PI * 2;
const MAX_MODES = 8;
const TELEMETRY_BLOCKS = 12;
const SILENCE_FLOOR = 1e-11;

function softClip(value) {
  if (!Number.isFinite(value)) return 0;
  return value / (1 + Math.abs(value));
}

class JulieSawProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.state = sanitizeJulieSawState(
      options.processorOptions?.configuration ?? JULIE_SAW_DEFAULTS,
    );

    const bank = buildPhysicalModalBank("bowed-things", {
      presetId: "musical-saw",
      baseFrequencyHz: bendToFrequency(this.state),
      // Keep the stored modal T60s independent of the state used to construct
      // the worklet. Live damping and brightness are applied below.
      damping: 0.5,
      brightness: 0.5,
      energy: 0.58,
      stereoWidth: this.state.stereoWidth,
      bowPressure: this.state.bowPressure,
      bowVelocity: this.state.bowSpeed,
      bowPosition: this.state.bowContact,
      rosin: this.state.rosin,
      size: 1,
    }, { sampleRate: this.rate, maxModes: MAX_MODES });
    this.modeCount = Math.min(MAX_MODES, bank.modeCount);
    this.modeRatio = new Float64Array(MAX_MODES);
    this.modeBaseT60 = new Float64Array(MAX_MODES);
    this.modeGain = new Float64Array(MAX_MODES);
    this.modePanLeft = new Float64Array(MAX_MODES);
    this.modePanRight = new Float64Array(MAX_MODES);
    this.modeReal = new Float64Array(MAX_MODES);
    this.modeImaginary = new Float64Array(MAX_MODES);
    this.modeCosine = new Float64Array(MAX_MODES);
    this.modeSine = new Float64Array(MAX_MODES);
    this.modeDecay = new Float64Array(MAX_MODES);
    this.modeContactWeight = new Float64Array(MAX_MODES);
    for (let index = 0; index < this.modeCount; index += 1) {
      this.modeRatio[index] = bank.frequenciesHz[index] / bank.fundamentalHz;
      this.modeBaseT60[index] = bank.t60Seconds[index];
      this.modeGain[index] = bank.gains[index];
      const pan = clamp(bank.pans[index], -1, 1);
      this.modePanLeft[index] = Math.cos((pan + 1) * Math.PI * 0.25);
      this.modePanRight[index] = Math.sin((pan + 1) * Math.PI * 0.25);
    }

    this.randomState = 0x4a554c49;
    this.noise = 0;
    this.noiseDc = 0;
    this.bowForce = 0;
    this.bowNoise = 0;
    this.bowHairDc = 0;
    this.modalLeft = 0;
    this.modalRight = 0;
    this.outputDcLeft = 0;
    this.outputDcRight = 0;
    this.currentFrequency = bendToFrequency(this.state);
    this.targetFrequencyOverride = 0;
    this.pitchBendSemitones = 0;
    this.vibratoPhase = 0;
    this.driveAgeSamples = 0;
    this.driveEnvelope = 0;
    this.wasDriving = false;
    this.manualGate = false;
    this.noteGate = false;
    this.autoGate = false;
    this.manualDirection = 1;
    this.manualVelocityScale = 1;
    this.autoDirection = 1;
    this.autoVelocityScale = 1;
    this.autoBendOffset = 0;
    this.autoBendTarget = 0;
    this.autoContactOffset = 0;
    this.autoContactTarget = 0;
    // An explicit phase-bearing `auto` message is the sole transport owner.
    // Configuration alone must never emit step zero before a late Audio join.
    this.autoPlaying = false;
    this.autoStep = -1;
    this.autoCountdown = 0;
    this.autoGateCountdown = 0;
    this.pendingImpulse = 0;
    this.pendingHardness = 0.3;
    this.pendingPosition = 0.5;
    this.scrapeBurst = 0;
    this.thimbleCountdown = 0;
    this.thimbleHits = 0;
    this.choke = 0;
    this.chokeCountdown = 0;
    this.activity = 0;
    this.stickAmount = 0;
    this.alignment = contactAlignment(this.state);
    this.sweetSpot = sweetSpotPosition(this.state);
    this.currentContact = this.state.bowContact;
    this.currentBend = this.state.bend;
    this.attackSamples = 1;
    this.attackCoefficient = 1;
    this.decayCoefficient = 1;
    this.releaseCoefficient = 1;
    this.manualBowSpeed = this.state.bowSpeed;
    this.autoBowSpeed = this.state.bowSpeed;
    this.manualStableRegime = 1;
    this.autoStableRegime = 1;
    this.frictionSlope = 1;
    this.noiseSmoothing = 0.1;
    this.edgeNoise = 0;
    this.bladeStiffness = julieSawBlade(this.state.bladeId).stiffness;
    this.blockCounter = 0;
    this.lastStepPosted = -1;
    this.stopped = false;

    this.port.onmessage = (event) => this._handleMessage(event.data ?? {});
    this._updateModalCoefficients();
  }

  _handleMessage(message) {
    if (message.type === "configure") {
      this.state = sanitizeJulieSawState(message.configuration ?? {}, this.state);
      this.stopped = false;
      return;
    }
    if (message.type === "bow") {
      this.manualGate = Boolean(message.gate);
      this.manualDirection = Number(message.direction) < 0 ? -1 : 1;
      this.manualVelocityScale = clamp(message.velocityScale ?? 1, 0.08, 2.2);
      this.stopped = false;
      return;
    }
    if (message.type === "auto") {
      this.autoPlaying = Boolean(message.playing);
      this.state = sanitizeJulieSawState({ ...this.state, autoPlay: this.autoPlaying }, this.state);
      if (this.autoPlaying && Number.isFinite(Number(message.step))) {
        this._beginAutomaticStep(message.step, message.phase, Boolean(message.triggerCurrent));
      } else {
        this.autoCountdown = 0;
        this.autoGateCountdown = 0;
        this.autoGate = false;
        this.autoStep = -1;
      }
      this.stopped = false;
      return;
    }
    if (message.type === "note-on") {
      this.targetFrequencyOverride = clamp(message.frequencyHz, 65, this.rate * 0.2);
      this.noteGate = true;
      this.manualDirection = Number(message.direction) < 0 ? -1 : 1;
      this.manualVelocityScale = clamp(message.velocity ?? 0.72, 0.05, 1.2);
      this.stopped = false;
      return;
    }
    if (message.type === "note-off") {
      this.noteGate = false;
      this.targetFrequencyOverride = 0;
      return;
    }
    if (message.type === "pitch-bend") {
      this.pitchBendSemitones = clamp(message.semitones ?? 0, -12, 12);
      return;
    }
    if (message.type === "gesture") {
      this._triggerGesture(message.gesture, clamp(message.velocity ?? 0.76, 0.02, 1.5));
      this.stopped = false;
      return;
    }
    if (message.type === "choke") {
      this.choke = 1;
      this.chokeCountdown = Math.round(this.rate * clamp(message.duration ?? 0.18, 0.02, 2));
      return;
    }
    if (message.type === "reset") {
      this.state = sanitizeJulieSawState(message.configuration ?? JULIE_SAW_DEFAULTS);
      this._clearPerformanceState();
      this.currentFrequency = bendToFrequency(this.state);
      this.sweetSpot = sweetSpotPosition(this.state);
      this.currentContact = this.state.bowContact;
      this.stopped = false;
      this._updateGeometry();
      return;
    }
    if (message.type === "silence") {
      this._clearPerformanceState();
      this.stopped = true;
    }
  }

  _clearPerformanceState() {
    this.manualGate = false;
    this.noteGate = false;
    this.autoGate = false;
    this.autoPlaying = false;
    this.targetFrequencyOverride = 0;
    this.pitchBendSemitones = 0;
    this.vibratoPhase = 0;
    this.driveAgeSamples = 0;
    this.driveEnvelope = 0;
    this.wasDriving = false;
    this.autoStep = -1;
    this.autoCountdown = 0;
    this.autoGateCountdown = 0;
    this.autoBendOffset = 0;
    this.autoBendTarget = 0;
    this.autoContactOffset = 0;
    this.autoContactTarget = 0;
    this.pendingImpulse = 0;
    this.pendingHardness = 0.3;
    this.pendingPosition = 0.5;
    this.scrapeBurst = 0;
    this.thimbleCountdown = 0;
    this.thimbleHits = 0;
    this.choke = 0;
    this.chokeCountdown = 0;
    this.noise = 0;
    this.noiseDc = 0;
    this.bowForce = 0;
    this.bowNoise = 0;
    this.bowHairDc = 0;
    this.modalLeft = 0;
    this.modalRight = 0;
    this.outputDcLeft = 0;
    this.outputDcRight = 0;
    this.activity = 0;
    this.stickAmount = 0;
    this.modeReal.fill(0);
    this.modeImaginary.fill(0);
    this.currentFrequency = bendToFrequency(this.state);
    this.currentBend = this.state.bend;
    this.sweetSpot = sweetSpotPosition(this.state);
    this.currentContact = this.state.bowContact;
    this.alignment = contactAlignment(this.state);
  }

  _signedRandom() {
    let value = this.randomState >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0 || 1;
    return this.randomState / 2_147_483_648 - 1;
  }

  _triggerGesture(gesture, velocity = 0.76) {
    if (gesture === "choke") {
      this.choke = 1;
      this.chokeCountdown = Math.round(this.rate * 0.2);
      return;
    }
    if (gesture === "teeth") {
      this.scrapeBurst = Math.round(this.rate * 0.3);
      return;
    }
    if (gesture === "thimble") {
      this.thimbleHits = 4;
      this.thimbleCountdown = 1;
      this.pendingHardness = 0.92;
      this.pendingPosition = this.sweetSpot;
      return;
    }
    this.pendingImpulse = Math.min(2, this.pendingImpulse + velocity * (
      gesture === "hard-mallet" ? 1.25 : gesture === "pluck" ? 0.86 : 0.72
    ));
    this.pendingHardness = gesture === "hard-mallet" ? 0.88 : gesture === "pluck" ? 0.68 : 0.24;
    this.pendingPosition = gesture === "pluck" ? clamp(this.sweetSpot + 0.12) : this.sweetSpot;
  }

  _automaticStepSamples(rhythm = julieSawRhythm(this.state.rhythmId)) {
    const subdivision = Math.max(1, Number(rhythm.subdivision) || 1);
    return Math.max(1, Math.round(this.rate * 60 / this.state.tempoBpm / 4 / subdivision));
  }

  _beginAutomaticStep(index, phase = 0, triggerImpulse = true) {
    const rhythm = julieSawRhythm(this.state.rhythmId);
    const normalizedIndex = ((Math.trunc(Number(index) || 0) % rhythm.steps.length) + rhythm.steps.length)
      % rhythm.steps.length;
    const normalizedPhase = clamp(phase, 0, 0.999999);
    const current = rhythm.steps[normalizedIndex];
    const stepSamples = this._automaticStepSamples(rhythm);
    this.autoStep = normalizedIndex;
    this.autoCountdown = Math.max(1, Math.round(stepSamples * (1 - normalizedPhase)));
    this.autoVelocityScale = clamp(current.velocity || 0.72, 0.05, 1.5);
    this.autoDirection = current.direction < 0 ? -1 : 1;
    this.autoBendTarget = clamp(current.bendOffset || 0, -0.4, 0.4);
    this.autoContactTarget = clamp(current.contactOffset || 0, -0.4, 0.4);
    if (current.kind === "bow") {
      const duration = clamp(current.duration ?? 0.72);
      this.autoGateCountdown = Math.max(0, Math.round(stepSamples * (duration - normalizedPhase)));
      this.autoGate = this.autoGateCountdown > 0;
      return;
    }
    this.autoGate = false;
    this.autoGateCountdown = 0;
    if (triggerImpulse && normalizedPhase < 0.05 && current.kind !== "rest") {
      this._triggerGesture(current.kind, current.velocity);
    }
  }

  _advanceAutomaticClock() {
    if (!this.autoPlaying) {
      this.autoGate = false;
      this.autoBendTarget = 0;
      this.autoContactTarget = 0;
      return;
    }
    if (this.autoCountdown <= 0) {
      const rhythm = julieSawRhythm(this.state.rhythmId);
      this._beginAutomaticStep((this.autoStep + 1) % rhythm.steps.length);
    }
    this.autoCountdown -= 1;
    if (this.autoGateCountdown > 0) {
      this.autoGateCountdown -= 1;
    } else {
      this.autoGate = false;
    }
  }

  _updateDriveEnvelope() {
    const driving = this.manualGate || this.noteGate || this.autoGate;
    if (driving && !this.wasDriving) this.driveAgeSamples = 0;
    if (driving) {
      this.driveAgeSamples += 1;
      const attacking = this.driveAgeSamples < this.attackSamples;
      const target = attacking ? 1 : this.state.sustain;
      this.driveEnvelope += (target - this.driveEnvelope)
        * (attacking ? this.attackCoefficient : this.decayCoefficient);
    } else {
      this.driveEnvelope += (0 - this.driveEnvelope) * this.releaseCoefficient;
      if (this.driveEnvelope < SILENCE_FLOOR) this.driveEnvelope = 0;
    }
    this.wasDriving = driving;
    return driving;
  }

  _updateGeometry() {
    this.attackSamples = Math.max(1, this.state.attackSeconds * this.rate);
    this.attackCoefficient = 1 - Math.exp(-1 / Math.max(1, this.state.attackSeconds * 0.22 * this.rate));
    this.decayCoefficient = 1 - Math.exp(-1 / Math.max(1, this.state.decaySeconds * this.rate));
    this.releaseCoefficient = 1 - Math.exp(-1 / Math.max(1, this.state.releaseSeconds * 0.22 * this.rate));
    const blade = julieSawBlade(this.state.bladeId);
    this.bladeStiffness = blade.stiffness;
    const nominalPressure = this.state.bowPressure;
    const stableSpeed = 0.2 + this.bladeStiffness * 0.2 + this.state.bend * 0.16 + nominalPressure * 0.1;
    this.manualBowSpeed = Math.max(0.006, this.state.bowSpeed * this.manualVelocityScale);
    this.autoBowSpeed = Math.max(0.006, this.state.bowSpeed * this.autoVelocityScale);
    this.manualSpeedError = Math.abs(Math.log2(Math.max(0.012, this.manualBowSpeed) / stableSpeed));
    this.autoSpeedError = Math.abs(Math.log2(Math.max(0.012, this.autoBowSpeed) / stableSpeed));
    this.manualStableRegime = Math.exp(-(this.manualSpeedError ** 2) / 1.25);
    this.autoStableRegime = Math.exp(-(this.autoSpeedError ** 2) / 1.25);
    this.frictionSlope = 1.5 + clamp(this.state.rosin) * 9.5;
    this.noiseSmoothing = 0.035 + clamp(this.state.rosin) * 0.14;
    this.edgeNoise = 0.0007 + this.state.edgeRasp * 0.009;
    const glideCoefficient = 1 - Math.exp(-128 / Math.max(1, this.state.glideSeconds * this.rate));
    this.autoBendOffset += (this.autoBendTarget - this.autoBendOffset) * 0.026;
    this.autoContactOffset += (this.autoContactTarget - this.autoContactOffset) * 0.036;
    const driving = this.manualGate || this.noteGate || this.autoGate;
    const delayElapsed = this.driveAgeSamples / this.rate >= this.state.vibratoDelaySeconds;
    const vibratoActive = driving && delayElapsed && this.state.vibratoDepthCents > 0;
    if (vibratoActive) {
      this.vibratoPhase += TWO_PI * this.state.vibratoRateHz * 128 / this.rate;
      this.vibratoPhase %= TWO_PI;
    }
    const vibrato = vibratoActive ? Math.sin(this.vibratoPhase) : 0;
    const bendState = {
      ...this.state,
      bend: clamp(this.state.bend + this.autoBendOffset),
    };
    this.currentBend = bendState.bend;
    let targetFrequency = this.targetFrequencyOverride || bendToFrequency(bendState);
    targetFrequency *= 2 ** ((vibrato * this.state.vibratoDepthCents + this.pitchBendSemitones * 100) / 1_200);
    this.currentFrequency += (targetFrequency - this.currentFrequency) * glideCoefficient;
    this.sweetSpot = clamp(
      sweetSpotPosition(bendState) + vibrato * this.state.vibratoDepthCents / 120 * 0.018,
      0.1,
      0.92,
    );
    const contact = clamp(
      (this.state.trackSweetSpot ? this.sweetSpot : this.state.bowContact)
        + this.autoContactOffset,
    );
    const alignmentWidth = 0.055 + (1 - clamp(this.state.localization)) * 0.16;
    this.currentContact = contact;
    this.alignment = Math.exp(-(((contact - this.sweetSpot) / alignmentWidth) ** 2));
    this._updateModalCoefficients(contact);
  }

  _updateModalCoefficients(contact = this.state.bowContact) {
    const blade = julieSawBlade(this.state.bladeId);
    const localization = clamp(this.state.localization);
    const bendAmount = clamp(this.state.bend + this.autoBendOffset);
    for (let index = 0; index < this.modeCount; index += 1) {
      const modeNumber = index + 1;
      const curvatureWarp = index === 0
        ? 1
        : 1 + (bendAmount - 0.5) * (0.018 + index * 0.004) * blade.stiffness;
      const frequency = Math.min(
        this.rate * 0.46,
        this.currentFrequency * this.modeRatio[index] * curvatureWarp,
      );
      const angle = TWO_PI * frequency / this.rate;
      this.modeCosine[index] = Math.cos(angle);
      this.modeSine[index] = Math.sin(angle);
      const localizationBoost = index === 0 ? 0.62 + localization * 2.55 : 0.55 + localization * 0.38;
      const upperLoss = index === 0 ? 1 : 1 / (1 + index * (0.4 + (1 - this.state.brightness) * 0.46));
      const t60 = clamp(
        this.modeBaseT60[index]
          * blade.decayScale
          * localizationBoost
          * upperLoss
          * (1.55 - this.state.bladeDamping * 1.28),
        0.025,
        index === 0 ? 18 : 4,
      );
      const chokeLoss = 1 - this.choke * (index === 0 ? 0.035 : 0.12);
      this.modeDecay[index] = Math.exp(Math.log(0.001) / (t60 * this.rate)) * chokeLoss;
      const shape = Math.sin(Math.PI * modeNumber * clamp(contact, 0.02, 0.98));
      this.modeContactWeight[index] = shape;
      const spectral = index === 0
        ? 1
        : blade.partialScale * (0.32 + this.state.brightness * 1.08) / Math.sqrt(modeNumber);
      this.modeGain[index] = (index === 0 ? 1 : spectral) * (0.75 + this.state.body * 0.5);
      const pan = (index % 2 ? 1 : -1) * this.state.stereoWidth * Math.min(0.72, index * 0.11);
      this.modePanLeft[index] = Math.cos((pan + 1) * Math.PI * 0.25);
      this.modePanRight[index] = Math.sin((pan + 1) * Math.PI * 0.25);
    }
  }

  _injectImpulse() {
    if (this.pendingImpulse <= 0) return 0;
    const impulse = this.pendingImpulse;
    const hardness = this.pendingHardness;
    const position = this.pendingPosition;
    for (let index = 0; index < this.modeCount; index += 1) {
      const modeNumber = index + 1;
      const positionWeight = Math.sin(Math.PI * modeNumber * clamp(position, .02, .98));
      const color = index === 0 ? 1 : (0.18 + hardness * 0.92) / Math.sqrt(modeNumber);
      this.modeImaginary[index] += impulse * positionWeight * color * 0.0028;
    }
    this.pendingImpulse = 0;
    return impulse;
  }

  _bowExcitation(direction, bowSpeed, stableRegime, speedError) {
    const envelope = this.driveEnvelope;
    if (envelope <= SILENCE_FLOOR) {
      this.bowForce = 0;
      this.bowNoise = 0;
      return;
    }
    const pressure = this.state.bowPressure * envelope;
    let contactVelocity = 0;
    for (let index = 0; index < this.modeCount; index += 1) {
      contactVelocity += this.modeImaginary[index]
        * this.modeContactWeight[index]
        * this.modeGain[index];
    }
    contactVelocity = clamp(contactVelocity * 2.2, -2.4, 2.4);
    const relativeVelocity = direction * bowSpeed - contactVelocity * (0.24 + pressure * 0.16);
    const velocityWeakening = Math.min(1, (Math.abs(relativeVelocity * this.frictionSlope) + 0.68) ** -4);
    const stationaryChoke = clamp((pressure - 0.78) * 2.1) * clamp((0.15 - bowSpeed) * 7);
    const overPressure = clamp((pressure - (0.72 + bowSpeed * 0.32)) * 1.7);
    const tonal = pressure
      * this.alignment
      * stableRegime
      * (1 - stationaryChoke)
      * (1 - overPressure * 0.78)
      * relativeVelocity
      * velocityWeakening
      * 0.046;
    const white = this._signedRandom();
    this.noise += (white - this.noise) * this.noiseSmoothing;
    this.bowHairDc += (white - this.bowHairDc) * 0.009;
    const hairGrain = white - this.bowHairDc;
    const miss = 1 - this.alignment;
    const instability = clamp(speedError * 0.38 + overPressure * 0.7 + stationaryChoke);
    const bite = clamp(this.state.bowBite);
    const bowAgeSeconds = this.driveAgeSamples / this.rate;
    const biteEnvelope = Math.exp(-bowAgeSeconds / (0.012 + bite * 0.075));
    const speedGrain = 0.35 + clamp(bowSpeed / 0.9) * 0.65;
    const noiseAmount = pressure * (
      this.edgeNoise
      + miss * 0.0035
      + instability * 0.011
    );
    const attackGrain = hairGrain
      * biteEnvelope
      * (0.0015 + bite * 0.013)
      * (0.3 + pressure * 0.7)
      * speedGrain;
    const continuousGrain = hairGrain
      * pressure
      * (0.00035 + this.state.edgeRasp * 0.0045)
      * (0.45 + this.state.rosin * 0.55);
    this.stickAmount = clamp(velocityWeakening * stableRegime * this.alignment);
    this.choke = Math.max(this.choke, stationaryChoke * 0.72);
    this.bowNoise = this.noise * noiseAmount + attackGrain + continuousGrain;
    this.bowForce = tonal + this.bowNoise * (0.12 + this.state.rosin * 0.16);
  }

  _renderModes(force) {
    let left = 0;
    let right = 0;
    for (let index = 0; index < this.modeCount; index += 1) {
      const real = this.modeReal[index];
      const injected = this.modeImaginary[index]
        + force * this.modeContactWeight[index] * (index === 0 ? 0.048 : 0.03)
        + this.bowNoise * this.state.bowBite * this.modeContactWeight[index]
          * (index === 0 ? 0.0015 : 0.003 + index * 0.00055);
      let nextReal = (real * this.modeCosine[index] - injected * this.modeSine[index]) * this.modeDecay[index];
      let nextImaginary = (real * this.modeSine[index] + injected * this.modeCosine[index]) * this.modeDecay[index];
      nextReal = clamp(nextReal, -2.5, 2.5);
      nextImaginary = clamp(nextImaginary, -2.5, 2.5);
      if (Math.abs(nextReal) < SILENCE_FLOOR) nextReal = 0;
      if (Math.abs(nextImaginary) < SILENCE_FLOOR) nextImaginary = 0;
      this.modeReal[index] = Number.isFinite(nextReal) ? nextReal : 0;
      this.modeImaginary[index] = Number.isFinite(nextImaginary) ? nextImaginary : 0;
      const sample = nextReal * this.modeGain[index];
      left += sample * this.modePanLeft[index];
      right += sample * this.modePanRight[index];
    }
    this.modalLeft = left;
    this.modalRight = right;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left) return true;

    this._updateGeometry();
    let blockPeak = 0;
    let blockSquare = 0;
    let impulseActivity = 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      this._advanceAutomaticClock();
      const driving = this._updateDriveEnvelope();
      if (this.thimbleHits > 0) {
        this.thimbleCountdown -= 1;
        if (this.thimbleCountdown <= 0) {
          this.pendingImpulse += 0.34 + this.thimbleHits * 0.055;
          this.pendingPosition = clamp(this.sweetSpot + (this.thimbleHits % 2 ? -0.08 : 0.08));
          this.thimbleHits -= 1;
          this.thimbleCountdown = Math.round(this.rate * 0.055);
        }
      }
      impulseActivity += this._injectImpulse();
      const manualDrive = this.manualGate || this.noteGate;
      const direction = manualDrive ? this.manualDirection : this.autoDirection;
      if (driving) {
        this._bowExcitation(
          direction,
          manualDrive ? this.manualBowSpeed : this.autoBowSpeed,
          manualDrive ? this.manualStableRegime : this.autoStableRegime,
          manualDrive ? this.manualSpeedError : this.autoSpeedError,
        );
      } else {
        // Lifting the bow removes the exciter quickly; the modal bank below is
        // deliberately left alone so the localized steel mode can ring until
        // blade damping or an explicit choke dissipates it.
        const lift = Math.exp(-1 / Math.max(1, this.rate * 0.004));
        this.bowForce *= lift;
        this.bowNoise *= lift;
        if (Math.abs(this.bowForce) < SILENCE_FLOOR) this.bowForce = 0;
        if (Math.abs(this.bowNoise) < SILENCE_FLOOR) this.bowNoise = 0;
      }
      let scrape = this.bowNoise;
      if (this.scrapeBurst > 0) {
        const burstEnvelope = Math.min(1, this.scrapeBurst / (this.rate * 0.04));
        scrape += this._signedRandom() * 0.018 * burstEnvelope;
        if (this.scrapeBurst % Math.max(1, Math.round(this.rate * 0.013)) === 0) {
          this.pendingImpulse += 0.075;
          this.pendingHardness = 0.92;
          this.pendingPosition = clamp(this.sweetSpot + this._signedRandom() * 0.18);
        }
        this.scrapeBurst -= 1;
      }
      if (this.chokeCountdown > 0) {
        this.chokeCountdown -= 1;
      } else {
        this.choke *= 0.9994;
      }
      this._renderModes(this.bowForce);
      this.noiseDc += (scrape - this.noiseDc) * 0.0012;
      const centeredScrape = scrape - this.noiseDc;
      const rawLeft = this.modalLeft * 230 + centeredScrape * 6;
      const rawRight = this.modalRight * 230 + centeredScrape * 6;
      this.outputDcLeft += (rawLeft - this.outputDcLeft) * 0.0008;
      this.outputDcRight += (rawRight - this.outputDcRight) * 0.0008;
      const leftSample = this.stopped ? 0 : softClip((rawLeft - this.outputDcLeft) * 0.78);
      const rightSample = this.stopped ? 0 : softClip((rawRight - this.outputDcRight) * 0.78);
      left[frame] = leftSample;
      if (right) right[frame] = rightSample;
      const peak = Math.max(Math.abs(leftSample), Math.abs(rightSample));
      blockPeak = Math.max(blockPeak, peak);
      blockSquare += (leftSample * leftSample + rightSample * rightSample) * 0.5;
    }

    this.activity += (Math.max(blockPeak, impulseActivity * 0.3) - this.activity)
      * (blockPeak > this.activity ? 0.24 : 0.035);
    this.blockCounter += 1;
    if (this.blockCounter >= TELEMETRY_BLOCKS) {
      this.blockCounter = 0;
      this.port.postMessage({
        type: "telemetry",
        frequencyHz: this.currentFrequency,
        bend: this.currentBend,
        sweetSpot: this.sweetSpot,
        bowContact: this.currentContact,
        alignment: this.alignment,
        stick: this.stickAmount,
        envelope: this.driveEnvelope,
        activity: this.activity,
        peak: blockPeak,
        rms: Math.sqrt(blockSquare / Math.max(1, left.length)),
        step: this.autoStep,
        bowDirection: this.manualGate || this.noteGate ? this.manualDirection : this.autoDirection,
        autoPlaying: this.autoPlaying,
      });
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, JulieSawProcessor);

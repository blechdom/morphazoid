import {
  BLOWHOLE_DEFAULTS,
  BLOWHOLE_SOURCE_FAMILIES,
  blowholeCall,
  createBlowholeVoicePlan,
  evaluateBlowholeGesture,
  sanitizeBlowholeState,
} from "./blowhole.js";

const TAU = Math.PI * 2;
const TELEMETRY_BLOCKS = 12;
const SILENCE_FLOOR = 1e-12;

const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
);

const smoothCoefficient = (seconds, rate) => 1 - Math.exp(-1 / Math.max(1, seconds * rate));

function xorshift(value) {
  let state = value | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state | 0;
}

class StateVariableBandpass {
  constructor(rate) {
    this.rate = rate;
    this.low = 0;
    this.band = 0;
    this.coefficient = 0.05;
    this.damping = 0.25;
  }

  configure(frequencyHz, bandwidthHz) {
    const center = clamp(frequencyHz, 18, this.rate * 0.205);
    const bandwidth = clamp(bandwidthHz, 8, center * 1.5);
    this.coefficient = 2 * Math.sin(Math.PI * center / this.rate);
    this.damping = clamp(bandwidth / Math.max(1, center), 0.025, 1.35);
  }

  reset() {
    this.low = 0;
    this.band = 0;
  }

  process(input) {
    const high = input - this.low - this.damping * this.band;
    this.band += this.coefficient * high;
    this.low += this.coefficient * this.band;
    if (!Number.isFinite(this.low) || Math.abs(this.low) < SILENCE_FLOOR) this.low = 0;
    if (!Number.isFinite(this.band) || Math.abs(this.band) < SILENCE_FLOOR) this.band = 0;
    return this.band * Math.sqrt(this.damping);
  }
}

class DampedMode {
  constructor(rate) {
    this.rate = rate;
    this.y1 = 0;
    this.y2 = 0;
    this.coefficient = 0;
    this.radiusSquared = 0;
    this.gain = 0.01;
  }

  configure(frequencyHz, decaySeconds = 0.004) {
    const frequency = clamp(frequencyHz, 14, this.rate * 0.47);
    const decay = clamp(decaySeconds, 0.00008, 2.5);
    const radius = Math.exp(-1 / Math.max(1, decay * this.rate));
    this.coefficient = 2 * radius * Math.cos(TAU * frequency / this.rate);
    this.radiusSquared = radius * radius;
    this.gain = Math.sin(TAU * frequency / this.rate) * (1 - radius + 0.002);
  }

  reset() {
    this.y1 = 0;
    this.y2 = 0;
  }

  process(input) {
    let value = input * this.gain + this.coefficient * this.y1 - this.radiusSquared * this.y2;
    if (!Number.isFinite(value) || Math.abs(value) < SILENCE_FLOOR) value = 0;
    this.y2 = this.y1;
    this.y1 = value;
    return value;
  }
}

class AcousticDelayLine {
  constructor(rate) {
    this.rate = rate;
    this.buffer = new Float32Array(Math.ceil(rate * 0.075));
    this.writeIndex = 0;
  }

  reset() {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }

  process(input, delaySeconds, feedback) {
    const delayFrames = Math.round(clamp(delaySeconds, 0.001, 0.07) * this.rate);
    const readIndex = (this.writeIndex - delayFrames + this.buffer.length) % this.buffer.length;
    const delayed = this.buffer[readIndex] || 0;
    this.buffer[this.writeIndex] = clamp(input + delayed * clamp(feedback, 0, 0.34), -1.5, 1.5);
    this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    return delayed;
  }
}

class BlowholePhysicalProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    this.rate = sampleRate;
    this.configuration = sanitizeBlowholeState(
      options.processorOptions?.configuration ?? BLOWHOLE_DEFAULTS,
    );
    this.call = blowholeCall(this.configuration.callId);
    this.renderedFrames = 0;
    this.playing = false;
    this.loop = false;
    this.manualGate = false;
    this.callStartFrame = 0;
    this.nextPulseIndex = 0;
    this.lastPhase = 0;
    this.startedCurrentCall = false;
    this.seed = 0x63657461;
    this.blockCounter = 0;
    this.ventEnvelope = 0;
    this.ventFilterLow = new StateVariableBandpass(this.rate);
    this.ventFilterHigh = new StateVariableBandpass(this.rate);
    this.ventFilterLow.configure(620, 480);
    this.ventFilterHigh.configure(2_100, 1_650);

    this.phaseLeft = 0;
    this.phaseRight = 0.31;
    this.pulsePhase = 0;
    this.pulseEnvelope = 0;
    this.clickPulseFramesRemaining = 0;
    this.clickPulseFrameLength = 1;
    this.pneumaticReservoir = 0;
    this.foldMemoryLeft = 0;
    this.foldMemoryRight = 0;
    this.smoothed = {
      pressure: 0,
      frequencyLeft: 220,
      frequencyRight: 222,
      pulseRateHz: 0,
      closure: this.configuration.closure,
      focus: this.configuration.focus,
      roughness: this.configuration.roughness,
      asymmetry: this.configuration.asymmetry,
    };
    this.target = { ...this.smoothed };
    this.lastPlan = createBlowholeVoicePlan(this.configuration, 0);
    this.currentPhysicalFrequencyHz = this.lastPlan.physicalFrequencyHz;
    this.currentMonitorFrequencyHz = this.lastPlan.monitorFrequencyHz;

    this.clickModesLeft = [0, 1, 2].map(() => new DampedMode(this.rate));
    this.clickModesRight = [0, 1, 2].map(() => new DampedMode(this.rate));
    this.nasalColorLeft = new StateVariableBandpass(this.rate);
    this.nasalColorRight = new StateVariableBandpass(this.rate);
    this.sacMode = new StateVariableBandpass(this.rate);
    this.spermacetiMode = new DampedMode(this.rate);
    this.bodyModes = [0, 1, 2].map(() => new StateVariableBandpass(this.rate));
    this.acousticDelayLeft = new AcousticDelayLine(this.rate);
    this.acousticDelayRight = new AcousticDelayLine(this.rate);

    this.dcLeft = 0;
    this.dcRight = 0;
    this.lastPeak = 0;
    this.lastRms = 0;
    this.port.onmessage = (event) => this._handleMessage(event.data);
    this._configureFilters(this.lastPlan);
  }

  _handleMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "configure") {
      const previousCallId = this.configuration.callId;
      this.configuration = sanitizeBlowholeState(
        { ...this.configuration, ...(message.configuration ?? {}) },
        this.configuration,
      );
      this.call = blowholeCall(this.configuration.callId);
      if (previousCallId !== this.call.id) {
        this.nextPulseIndex = 0;
        this.lastPhase = 0;
      }
      return;
    }
    if (message.type === "play" || message.type === "trigger") {
      if (message.callId) {
        this.configuration = sanitizeBlowholeState(
          { ...this.configuration, callId: message.callId },
          this.configuration,
        );
        this.call = blowholeCall(this.configuration.callId);
      }
      this.playing = true;
      if (this.call.id !== "sperm-whale-coda") this.ventEnvelope = 0;
      this.loop = Boolean(message.loop);
      this.manualGate = false;
      const delaySeconds = clamp(Number(message.delaySeconds), 0, 2);
      this.callStartFrame = this.renderedFrames + Math.round(delaySeconds * this.rate);
      this.lastPhase = 0;
      this.nextPulseIndex = 0;
      this.pulsePhase = 0;
      this.startedCurrentCall = false;
      return;
    }
    if (message.type === "manual" || message.type === "gate") {
      this.manualGate = Boolean(message.active ?? message.value);
      if (this.manualGate) {
        if (this.call.id !== "sperm-whale-coda") this.ventEnvelope = 0;
        this.playing = false;
        this.lastPhase = 0.45;
        this.pulsePhase = 0;
      }
      return;
    }
    if (message.type === "vent") {
      if (this.call.id !== "sperm-whale-coda") {
        this.playing = false;
        this.manualGate = false;
      }
      this.ventEnvelope = Math.max(this.ventEnvelope, clamp(Number(message.strength), 0.2, 1.4));
      return;
    }
    if (message.type === "stopVent") {
      this.ventEnvelope = 0;
      return;
    }
    if (message.type === "stop") {
      this.playing = false;
      this.loop = false;
      this.lastPhase = 0;
      this.startedCurrentCall = false;
      return;
    }
    if (message.type === "loop") {
      this.loop = Boolean(message.active);
      return;
    }
    if (message.type === "silence" || message.type === "panic") this._silence();
  }

  _silence() {
    this.playing = false;
    this.loop = false;
    this.manualGate = false;
    this.ventEnvelope = 0;
    this.pulseEnvelope = 0;
    this.clickPulseFramesRemaining = 0;
    this.clickPulseFrameLength = 1;
    this.pneumaticReservoir = 0;
    this.lastPhase = 0;
    this.startedCurrentCall = false;
    this.smoothed.pressure = 0;
    this.dcLeft = 0;
    this.dcRight = 0;
    this.acousticDelayLeft.reset();
    this.acousticDelayRight.reset();
    this.ventFilterLow.reset();
    this.ventFilterHigh.reset();
    for (const mode of [...this.clickModesLeft, ...this.clickModesRight]) mode.reset();
    this.sacMode.reset();
    this.spermacetiMode.reset();
    for (const mode of this.bodyModes) mode.reset();
  }

  _random() {
    this.seed = xorshift(this.seed);
    return (this.seed >>> 0) / 4_294_967_295 * 2 - 1;
  }

  _phaseAtFrame(frame) {
    if (this.manualGate) return 0.45;
    if (frame < this.callStartFrame) return 0;
    // Preserve a natural completion at phase 1 long enough for the main
    // thread to distinguish it from an explicit stop at phase 0.
    if (!this.playing) return this.lastPhase;
    this.startedCurrentCall = true;
    const durationFrames = Math.max(1, Math.round(this.call.durationMs * this.rate / 1_000));
    let elapsed = frame - this.callStartFrame;
    if (elapsed >= durationFrames) {
      if (!this.loop) {
        this.playing = false;
        this.lastPhase = 1;
        return 1;
      }
      const loops = Math.floor(elapsed / durationFrames);
      this.callStartFrame += loops * durationFrames;
      elapsed = frame - this.callStartFrame;
      this.nextPulseIndex = 0;
      this.lastPhase = 0;
    }
    return clamp(elapsed / durationFrames);
  }

  _planAt(phase) {
    const plan = createBlowholeVoicePlan(this.configuration, phase);
    if (!this.manualGate) return plan;
    const manualPulseRange = this.call.physicalRange.pulseRateHz;
    const manualPulseRateHz = manualPulseRange[1] > 0
      ? clamp(this.configuration.pulseRateHz, manualPulseRange[0], manualPulseRange[1])
      : 0;
    const manualFundamentalHz = this.call.pulseLockedToFundamental
      ? clamp(
        manualPulseRateHz * 2 ** (
          (this.configuration.tension - this.call.controlDefaults.tension) * 1.5
        ),
        this.call.physicalRange.frequencyHz[0],
        this.call.physicalRange.frequencyHz[1],
      )
      : null;
    const monitorRatio = plan.monitorFrequencyHz / Math.max(1e-9, plan.physicalFrequencyHz);
    const voices = plan.voices.map((voice, index) => ({
      ...voice,
      physicalFrequencyHz: manualFundamentalHz ?? voice.physicalFrequencyHz,
      monitorFrequencyHz: manualFundamentalHz == null
        ? voice.monitorFrequencyHz
        : manualFundamentalHz * monitorRatio,
      gain: clamp(this.configuration.pressure * this.configuration.level
        * (index === 0 ? 0.78 : 0.56), 0, 1),
      pulseRateHz: manualFundamentalHz ?? manualPulseRateHz,
      closure: this.configuration.closure,
      roughness: this.configuration.roughness,
    }));
    return {
      ...plan,
      physicalFrequencyHz: manualFundamentalHz ?? plan.physicalFrequencyHz,
      audibleFrequencyHz: manualFundamentalHz == null
        ? plan.audibleFrequencyHz
        : manualFundamentalHz * 2 ** plan.audibleShiftOctaves,
      monitorFrequencyHz: manualFundamentalHz == null
        ? plan.monitorFrequencyHz
        : manualFundamentalHz * monitorRatio,
      pulseRateHz: manualFundamentalHz ?? manualPulseRateHz,
      focus: this.configuration.focus,
      voices,
    };
  }

  _updateTargets(plan, active) {
    const left = plan.voices[0];
    const right = plan.voices[1] ?? left;
    const gesture = evaluateBlowholeGesture(this.call, plan.phase, this.configuration);
    const depthExcess = this.call.family === "mysticete"
      ? Math.max(0, this.configuration.depthM - 100)
      : 0;
    const depthGain = this.call.family === "mysticete"
      ? 1 / (1 + Math.pow(depthExcess / 180, 2))
      : 1;
    this.target.pressure = active
      ? clamp((this.manualGate ? this.configuration.pressure : gesture.pressure) * depthGain)
      : 0;
    this.target.frequencyLeft = clamp(left?.monitorFrequencyHz ?? plan.monitorFrequencyHz, 12, this.rate * 0.44);
    this.target.frequencyRight = clamp(right?.monitorFrequencyHz ?? this.target.frequencyLeft, 12, this.rate * 0.44);
    this.target.pulseRateHz = this.manualGate
      ? plan.pulseRateHz
      : clamp(plan.pulseRateHz, 0, 10_000);
    this.target.closure = this.manualGate ? this.configuration.closure : gesture.closure;
    this.target.focus = this.manualGate ? this.configuration.focus : plan.focus;
    this.target.roughness = this.manualGate ? this.configuration.roughness : gesture.roughness;
    this.target.asymmetry = this.manualGate ? this.configuration.asymmetry : gesture.asymmetryBipolar;
    this.currentPhysicalFrequencyHz = plan.physicalFrequencyHz;
    this.currentMonitorFrequencyHz = plan.monitorFrequencyHz;
    this.lastPlan = plan;
  }

  _configureFilters(plan) {
    const center = clamp(plan.monitorFrequencyHz, 28, this.rate * 0.19);
    const focus = clamp(plan.focus);
    const scale = this.configuration.scale;
    const clickRatios = [0.58, 1, 1.62];
    for (let index = 0; index < clickRatios.length; index += 1) {
      const frequency = clamp(center * clickRatios[index], 30, this.rate * 0.46);
      const decay = 0.0005 + (1 - focus) * 0.004 + index * 0.0006;
      this.clickModesLeft[index].configure(frequency * (1 - this.configuration.asymmetry * 0.018), decay);
      this.clickModesRight[index].configure(frequency * (1 + this.configuration.asymmetry * 0.018), decay);
    }
    const nasalCenter = clamp(center * (0.68 + focus * 0.38), 45, this.rate * 0.19);
    this.nasalColorLeft.configure(nasalCenter * 0.992, nasalCenter * (0.12 + (1 - focus) * 0.72));
    this.nasalColorRight.configure(nasalCenter * 1.008, nasalCenter * (0.12 + (1 - focus) * 0.72));

    const sacFrequency = this.call.family === "mysticete"
      ? 32 + (1 - scale) * 155
      : 120 + (1 - scale) * 480;
    this.sacMode.configure(sacFrequency, 24 + (1 - this.configuration.recycle) * sacFrequency * 0.62);
    [1, 2.07, 3.54].forEach((ratio, index) => {
      const bodyCenter = clamp(
        (this.call.family === "mysticete" ? center : Math.max(90, center * 0.18)) * ratio,
        22,
        this.rate * 0.18,
      );
      this.bodyModes[index].configure(
        bodyCenter,
        bodyCenter * (0.08 + index * 0.05 + (1 - focus) * 0.2),
      );
    });
    if (this.call.id === "sperm-whale-coda") {
      this.spermacetiMode.configure(
        clamp(center * 0.46, 24, this.rate * 0.18),
        0.003 + this.configuration.scale * 0.009,
      );
    }
  }

  _smoothParameters() {
    const fast = smoothCoefficient(0.006, this.rate);
    const pitch = smoothCoefficient(0.012, this.rate);
    if (this.call.sourceFamily === BLOWHOLE_SOURCE_FAMILIES.ODONTOCETE) {
      const filling = this.target.pressure > this.pneumaticReservoir;
      const reservoirSeconds = filling
        ? 0.004
        : 0.008 + this.configuration.recycle * 0.07;
      const reservoirCoefficient = smoothCoefficient(reservoirSeconds, this.rate);
      this.pneumaticReservoir += (
        this.target.pressure - this.pneumaticReservoir
      ) * reservoirCoefficient;
      this.smoothed.pressure += (this.pneumaticReservoir - this.smoothed.pressure) * fast;
    } else {
      this.pneumaticReservoir = 0;
      this.smoothed.pressure += (this.target.pressure - this.smoothed.pressure) * fast;
    }
    this.smoothed.frequencyLeft += (this.target.frequencyLeft - this.smoothed.frequencyLeft) * pitch;
    this.smoothed.frequencyRight += (this.target.frequencyRight - this.smoothed.frequencyRight) * pitch;
    this.smoothed.pulseRateHz += (this.target.pulseRateHz - this.smoothed.pulseRateHz) * fast;
    this.smoothed.closure += (this.target.closure - this.smoothed.closure) * fast;
    this.smoothed.focus += (this.target.focus - this.smoothed.focus) * fast;
    this.smoothed.roughness += (this.target.roughness - this.smoothed.roughness) * fast;
    this.smoothed.asymmetry += (this.target.asymmetry - this.smoothed.asymmetry) * fast;
  }

  _crossedAuthoredPulse(phase) {
    if (!this.playing || !this.startedCurrentCall || this.call.pulseTimes.length === 0) return false;
    const next = this.call.pulseTimes[this.nextPulseIndex];
    if (next == null || phase + 1e-9 < next) return false;
    this.nextPulseIndex += 1;
    return true;
  }

  _pulseTrigger(phase) {
    if (this.call.pulseTimes.length > 0 && !this.manualGate) {
      return this._crossedAuthoredPulse(phase);
    }
    const rate = clamp(this.smoothed.pulseRateHz, 0, 10_000);
    const onsetPressure = 0.018 + (1 - this.configuration.recycle) * 0.035;
    if (rate <= 0 || this.smoothed.pressure < onsetPressure) return false;
    this.pulsePhase += rate / this.rate;
    if (this.pulsePhase < 1) return false;
    this.pulsePhase -= Math.floor(this.pulsePhase);
    return true;
  }

  _renderOdontocete(phase) {
    const pressure = this.smoothed.pressure;
    const closure = this.smoothed.closure;
    const roughness = this.smoothed.roughness;
    const focus = this.smoothed.focus;
    const clickSource = /click|buzz|coda/.test(this.call.register);
    const pulsedCall = /pulsed/.test(this.call.register);
    const leftUnilateral = this.call.id === "bottlenose-signature-whistle";
    const rightUnilateral = this.call.id === "dolphin-search-clicks"
      || this.call.id === "dolphin-terminal-buzz"
      || this.call.id === "sperm-whale-coda";
    const triggered = clickSource && this._pulseTrigger(phase);

    if (clickSource) {
      if (triggered) {
        this.clickPulseFrameLength = Math.max(
          1,
          Math.round(this.lastPlan.pulseWidthMicroseconds * this.rate / 1_000_000),
        );
        this.clickPulseFramesRemaining = this.clickPulseFrameLength;
      }
      let pulseShape = 0;
      if (this.clickPulseFramesRemaining > 0) {
        const pulseIndex = this.clickPulseFrameLength - this.clickPulseFramesRemaining;
        pulseShape = Math.sin(
          Math.PI * (pulseIndex + 0.5) / this.clickPulseFrameLength,
        ) / Math.sqrt(this.clickPulseFrameLength);
        this.clickPulseFramesRemaining -= 1;
      }
      const impulse = pulseShape
        * pressure
        * (0.58 + closure * 0.72)
        * (1 + this._random() * roughness * 0.18);
      const leftWeight = rightUnilateral
        ? 0
        : Math.sqrt(clamp((1 - this.smoothed.asymmetry) * 0.5));
      const rightWeight = rightUnilateral
        ? 1
        : Math.sqrt(clamp((1 + this.smoothed.asymmetry) * 0.5));
      let left = 0;
      let right = 0;
      const modeGains = [0.56, 1, 0.48];
      for (let index = 0; index < 3; index += 1) {
        left += this.clickModesLeft[index].process(impulse * leftWeight) * modeGains[index];
        right += this.clickModesRight[index].process(impulse * rightWeight) * modeGains[index];
      }
      const delayedLeft = this.acousticDelayLeft.process(
        left,
        0.003 + this.configuration.scale * 0.009,
        0.08 + focus * 0.08,
      );
      const delayedRight = this.acousticDelayRight.process(
        right,
        this.call.id === "sperm-whale-coda"
          ? this.lastPlan.headReflectionDelaySeconds
          : 0.0034 + this.configuration.scale * 0.0095,
        this.call.id === "sperm-whale-coda" ? 0.22 : 0.08 + focus * 0.08,
      );
      left = left * (0.66 + focus * 0.52) + delayedLeft * 0.2;
      if (this.call.id === "sperm-whale-coda") {
        const caseMode = this.spermacetiMode.process(delayedRight);
        right = right * 0.36 + delayedRight * (0.76 + focus * 0.22) + caseMode * 1.15;
      } else {
        right = right * (0.66 + focus * 0.52) + delayedRight * 0.2;
      }
      const clickGain = this.call.id === "sperm-whale-coda" ? 9.5 : 8;
      if (rightUnilateral) {
        const source = right * 0.82 * clickGain;
        return [source * 0.96, source * 1.04];
      }
      return [left * 0.82 * clickGain, right * 0.82 * clickGain];
    }

    const stableRoughness = roughness * (1 - this.configuration.recycle * 0.38);
    const jitterLeft = 1 + this._random() * stableRoughness * 0.0028;
    const jitterRight = 1 + this._random() * stableRoughness * 0.0032;
    this.phaseLeft = (this.phaseLeft + this.smoothed.frequencyLeft * jitterLeft / this.rate) % 1;
    this.phaseRight = (this.phaseRight + this.smoothed.frequencyRight * jitterRight / this.rate) % 1;
    const lipWave = (cycle, memory, side) => {
      const angle = cycle * TAU;
      const opening = Math.sin(angle) + Math.sin(angle * 2 + side * 0.4) * 0.17;
      const collision = Math.tanh((opening + (closure - 0.5) * 0.38) * (1.6 + closure * 5.2));
      const derivative = collision - memory;
      return [collision * (0.6 - closure * 0.12) + derivative * (0.3 + closure * 0.5), collision];
    };
    const [sourceLeft, memoryLeft] = lipWave(this.phaseLeft, this.foldMemoryLeft, -1);
    const [sourceRight, memoryRight] = lipWave(this.phaseRight, this.foldMemoryRight, 1);
    this.foldMemoryLeft = memoryLeft;
    this.foldMemoryRight = memoryRight;
    const onsetPressure = 0.018 + (1 - this.configuration.recycle) * 0.035;
    const amplitude = Math.pow(clamp(
      (pressure - onsetPressure) / Math.max(0.001, 1 - onsetPressure),
    ), 1.22);
    const leftWeight = leftUnilateral
      ? 1
      : Math.sqrt(clamp((1 - this.smoothed.asymmetry) * 0.5));
    const rightWeight = leftUnilateral
      ? 0
      : Math.sqrt(clamp((1 + this.smoothed.asymmetry) * 0.5));
    // M1's pulse repetition is the oscillator fundamental itself, not a slow
    // amplitude gate over a separate carrier. The side is intentionally left
    // unassigned, so one computational source feeds the paired head filters.
    const m1Source = pulsedCall ? sourceLeft * amplitude : 0;
    const rawLeft = pulsedCall ? m1Source * 0.72 : sourceLeft * amplitude * leftWeight;
    const rawRight = pulsedCall ? m1Source * 0.72 : sourceRight * amplitude * rightWeight;
    const delayedLeft = this.acousticDelayLeft.process(
      rawLeft,
      0.004 + this.configuration.scale * 0.012,
      0.08 + focus * 0.08,
    );
    const delayedRight = this.acousticDelayRight.process(
      rawRight,
      0.0045 + this.configuration.scale * 0.012,
      0.08 + focus * 0.08,
    );
    const coloredLeft = this.nasalColorLeft.process(rawLeft + delayedLeft * 0.22);
    const coloredRight = this.nasalColorRight.process(rawRight + delayedRight * 0.22);
    const outputLeft = rawLeft * (0.16 + focus * 0.16) + coloredLeft * (0.72 + focus * 0.42);
    const outputRight = rawRight * (0.16 + focus * 0.16) + coloredRight * (0.72 + focus * 0.42);
    if (leftUnilateral) return [outputLeft * 1.04, outputLeft * 0.96];
    return [outputLeft, outputRight];
  }

  _renderMysticete() {
    const pressure = this.smoothed.pressure;
    const closure = this.smoothed.closure;
    const roughness = this.smoothed.roughness;
    const focus = this.smoothed.focus;
    const onsetPressure = 0.025 + (1 - closure) * 0.12;
    const sourceGain = Math.pow(clamp((pressure - onsetPressure) / (1 - onsetPressure)), 1.3);
    const instability = 1 + Math.sin(this.renderedFrames * 0.000071) * roughness * 0.026;
    this.phaseLeft = (this.phaseLeft + this.smoothed.frequencyLeft * instability / this.rate) % 1;
    this.phaseRight = (
      this.phaseRight
      + this.smoothed.frequencyRight * (2 - instability + this.smoothed.asymmetry * 0.006) / this.rate
    ) % 1;

    const foldContact = (phase, previous, side) => {
      const angle = phase * TAU;
      const fundamental = Math.sin(angle);
      const upperSurface = Math.sin(angle * 2 + side * 0.22) * (0.08 + closure * 0.18);
      const foldSurface = fundamental + upperSurface;
      const cushionSurface = Math.sin(angle - side * 0.14) * (0.2 + closure * 0.16);
      const coupledGap = foldSurface - cushionSurface;
      const contact = Math.tanh((coupledGap + (closure - 0.53) * 0.45) * (1.45 + closure * 5.8));
      const collision = contact - previous;
      const noisyContact = this._random() * roughness * Math.abs(collision) * 0.2;
      return [contact * (0.72 - closure * 0.18) + collision * (0.38 + closure * 0.44) + noisyContact, contact];
    };

    const [foldLeft, memoryLeft] = foldContact(this.phaseLeft, this.foldMemoryLeft, -1);
    this.foldMemoryLeft = memoryLeft;
    let secondaryRegime = 0;
    if (this.call.id === "humpback-two-voice-phrase") {
      // The second regime represents bilateral transverse-fold contact, not a
      // second independent fold-to-fat oscillator.
      const foldGap = Math.tanh(
        (Math.sin(this.phaseRight * TAU) - Math.sin(this.phaseLeft * TAU))
        * (1.5 + closure * 4.2),
      );
      secondaryRegime = foldGap - this.foldMemoryRight;
      this.foldMemoryRight = foldGap;
    } else {
      this.foldMemoryRight *= 0.999;
    }
    const modeBalance = clamp(this.smoothed.asymmetry, -1, 1);
    const primaryMix = this.call.id === "humpback-two-voice-phrase"
      ? 1 - modeBalance * 0.45
      : 1;
    const secondaryMix = 0.62 * (1 + modeBalance * 0.45);
    const source = (foldLeft * primaryMix + secondaryRegime * secondaryMix) * sourceGain;
    // This delay is compliant laryngeal-sac memory, not a claim of continuous
    // physiological air transport back to the lungs while sounding.
    const sacMemory = this.acousticDelayLeft.process(
      source,
      0.018 + this.configuration.scale * 0.038,
      this.configuration.recycle * 0.2,
    );
    const sac = this.sacMode.process(source + sacMemory * 0.3);
    const bodyInput = source * 0.34 + sac * (0.72 + this.configuration.recycle * 0.3);
    const body = this.bodyModes.reduce((sum, mode, index) => (
      sum + mode.process(bodyInput) * [1, 0.66, 0.38][index]
    ), 0);
    const coupled = source * (0.1 + focus * 0.1) + sac * 0.46 + body * (0.82 + focus * 0.35);
    const pan = clamp(this.smoothed.asymmetry, -1, 1);
    return [coupled * Math.cos((pan + 1) * Math.PI * 0.18), coupled * Math.sin((pan + 1) * Math.PI * 0.18 + 0.5)];
  }

  _renderVent() {
    if (this.ventEnvelope < 1e-5) return 0;
    const noise = this._random();
    const low = this.ventFilterLow.process(noise);
    const high = this.ventFilterHigh.process(noise);
    const output = (low * 0.94 + high * 0.35) * this.ventEnvelope;
    this.ventEnvelope *= Math.exp(-1 / Math.max(1, 0.16 * this.rate));
    return output * 0.28;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1] ?? left;
    if (!left) return true;

    const startPhase = this._phaseAtFrame(this.renderedFrames);
    const active = this.manualGate
      || (this.playing && this.renderedFrames >= this.callStartFrame);
    const plan = this._planAt(startPhase);
    this._updateTargets(plan, active);
    this._configureFilters(plan);

    let peak = 0;
    let squareSum = 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      const absoluteFrame = this.renderedFrames + frame;
      const phase = this._phaseAtFrame(absoluteFrame);
      this._smoothParameters();
      let sampleLeft = 0;
      let sampleRight = 0;
      if (this.smoothed.pressure > 1e-5) {
        const sample = this.call.sourceFamily === BLOWHOLE_SOURCE_FAMILIES.ODONTOCETE
          ? this._renderOdontocete(phase)
          : this._renderMysticete();
        sampleLeft += sample[0];
        sampleRight += sample[1];
      }
      const vent = this._renderVent();
      sampleLeft += vent * 0.93;
      sampleRight += vent * 1.07;

      this.dcLeft += (sampleLeft - this.dcLeft) * 0.00042;
      this.dcRight += (sampleRight - this.dcRight) * 0.00042;
      sampleLeft -= this.dcLeft;
      sampleRight -= this.dcRight;
      const boundedLeft = Math.tanh(sampleLeft * 1.35) * 0.58;
      const boundedRight = Math.tanh(sampleRight * 1.35) * 0.58;
      left[frame] = Number.isFinite(boundedLeft) ? boundedLeft : 0;
      right[frame] = Number.isFinite(boundedRight) ? boundedRight : 0;
      peak = Math.max(peak, Math.abs(left[frame]), Math.abs(right[frame]));
      squareSum += left[frame] * left[frame] + right[frame] * right[frame];
      this.lastPhase = phase;
    }

    this.renderedFrames += left.length;
    this.lastPeak = peak;
    this.lastRms = Math.sqrt(squareSum / Math.max(1, left.length * 2));
    this.blockCounter += 1;
    if (this.blockCounter >= TELEMETRY_BLOCKS) {
      this.blockCounter = 0;
      this.port.postMessage({
        type: "telemetry",
        callId: this.call.id,
        family: this.call.family,
        active: this.playing || this.manualGate,
        playing: this.playing,
        manual: this.manualGate,
        loop: this.loop,
        phase: this.lastPhase,
        physicalFrequencyHz: this.currentPhysicalFrequencyHz,
        monitorFrequencyHz: this.currentMonitorFrequencyHz,
        pulseRateHz: this.smoothed.pulseRateHz,
        pressure: this.smoothed.pressure,
        peak: this.lastPeak,
        rms: this.lastRms,
        valveOpen: this.ventEnvelope > 0.001,
      });
    }
    return true;
  }
}

registerProcessor("blowhole-physical-model", BlowholePhysicalProcessor);

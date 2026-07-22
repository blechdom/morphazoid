const PROCESSOR_NAME = "morphazoid-contour-synth";
const TAU = Math.PI * 2;
const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 20_000;
const SHEPARD_PARTIAL_COUNT = 17;
const SHEPARD_CENTER = Math.floor(SHEPARD_PARTIAL_COUNT / 2);
const MIN_SHEPARD_WIDTH = 2.5;
const MAX_WORKLET_VOICES = 4096;
const LOAD_REPORT_BLOCKS = 96;

const CLOCK_KIND = typeof globalThis.performance?.now === "function"
  ? "high-res"
  : typeof Date?.now === "function"
    ? "coarse"
    : "unavailable";

function clockMilliseconds() {
  try {
    if (CLOCK_KIND === "high-res") return globalThis.performance.now();
    if (CLOCK_KIND === "coarse") return Date.now();
  } catch {
    // Timing telemetry is optional; audio rendering must continue without it.
  }
  return null;
}

function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

function wrapPhase(value) {
  if (value > TAU || value < -TAU) return value % TAU;
  return value;
}

function wrapUnit(value) {
  return ((value % 1) + 1) % 1;
}

function hashPhase(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * TAU;
}

function sanitizeSpec(spec, index) {
  const mode = ["sine", "shepard", "fm", "pm"].includes(spec.mode)
    ? spec.mode
    : "sine";
  return {
    key: typeof spec.key === "string" ? spec.key : `index:${index}`,
    mode,
    frequency: clamp(spec.frequency, MIN_FREQUENCY, MAX_FREQUENCY),
    gain: clamp(spec.gain, 0, 1),
    pan: clamp(spec.pan ?? 0, -1, 1),
    modulationIndex: clamp(spec.modulationIndex ?? 0, 0, 20),
    modulationRatio: clamp(spec.modulationRatio ?? 1, 0.125, 16),
    shepardRate: clamp(spec.shepardRate ?? 0, -8, 8),
    shepardWidth: clamp(spec.shepardWidth ?? 4, 1, 15),
    shepardPosition: Number.isFinite(spec.shepardPosition)
      ? wrapUnit(spec.shepardPosition)
      : null,
    shepardTravel: Number.isFinite(spec.shepardTravel)
      ? spec.shepardTravel
      : null,
  };
}

function makeVoice(spec) {
  const seed = hashPhase(spec.key);
  return {
    target: spec,
    nextTarget: spec,
    trajectorySample: 0,
    trajectorySamples: 0,
    mode: spec.mode,
    frequency: spec.frequency,
    gain: 0,
    pan: spec.pan,
    modulationIndex: spec.modulationIndex,
    modulationRatio: spec.modulationRatio,
    shepardRate: spec.shepardRate,
    shepardWidth: spec.shepardWidth,
    phase: seed,
    modulationPhase: seed * 0.61803398875,
    shepardPosition: spec.shepardPosition ?? (seed / TAU) % 1,
    shepardExternallyDriven: spec.shepardPosition !== null,
    shepardPhases: Array.from(
      { length: SHEPARD_PARTIAL_COUNT },
      (_, index) => seed * (1 + index * 0.137),
    ),
    releasing: false,
  };
}

function rotateShepardUp(phases) {
  for (let index = phases.length - 1; index > 0; index -= 1) {
    phases[index] = phases[index - 1];
  }
  phases[0] = phases[1] * 0.754877666;
}

function rotateShepardDown(phases) {
  for (let index = 0; index < phases.length - 1; index += 1) {
    phases[index] = phases[index + 1];
  }
  phases[phases.length - 1] = phases[phases.length - 2] * 1.324717957;
}

function advanceShepardPosition(voice, delta) {
  voice.shepardPosition += delta;
  while (voice.shepardPosition >= 1) {
    voice.shepardPosition -= 1;
    rotateShepardUp(voice.shepardPhases);
  }
  while (voice.shepardPosition < 0) {
    voice.shepardPosition += 1;
    rotateShepardDown(voice.shepardPhases);
  }
}

function wrappedPositionDelta(from, to) {
  let delta = to - from;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function directedWrappedPositionDelta(from, to, expectedDelta = 0) {
  const rawDelta = to - from;
  return rawDelta + Math.round(expectedDelta - rawDelta);
}

class MorphazoidContourSynth extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.maxVoices = Math.floor(clamp(
      options.processorOptions?.maxVoices ?? 32,
      0,
      MAX_WORKLET_VOICES,
    ));
    this.runtimeLimit = this.maxVoices;
    this.voices = new Map();
    this.requestedVoiceCount = 0;
    this.requestedMode = "sine";
    this.activeTargetCount = 0;
    this.loadBlocks = 0;
    this.loadTotal = 0;
    this.loadPeak = 0;
    this.pendingControlMilliseconds = 0;
    this.reportedTimingUnavailable = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === "voices") {
        const startedAt = clockMilliseconds();
        const nextRuntimeLimit = Math.floor(clamp(
          event.data.voiceLimit ?? this.runtimeLimit,
          0,
          this.maxVoices,
        ));
        const nextMode = ["sine", "fm", "pm", "shepard"].includes(event.data.mode)
          ? event.data.mode
          : "sine";
        if (nextRuntimeLimit !== this.runtimeLimit || nextMode !== this.requestedMode) {
          this.loadBlocks = 0;
          this.loadTotal = 0;
          this.loadPeak = 0;
          this.pendingControlMilliseconds = 0;
        }
        this.runtimeLimit = nextRuntimeLimit;
        this.requestedVoiceCount = Math.max(
          0,
          Math.floor(Number(event.data.requestedVoiceCount) || 0),
        );
        this.requestedMode = nextMode;
        this.setVoiceTargets(
          event.data.voices,
          event.data.nextVoices,
          event.data.durationSeconds,
        );
        const endedAt = clockMilliseconds();
        if (startedAt !== null && endedAt !== null) {
          this.pendingControlMilliseconds += Math.max(0, endedAt - startedAt);
        }
      }
    };
  }

  pruneReleasingVoices(limit) {
    const boundedLimit = Math.max(0, Math.floor(limit));
    if (this.voices.size <= boundedLimit) return;
    const releasing = [...this.voices.entries()]
      .filter(([, voice]) => voice.releasing)
      .sort((left, right) => left[1].gain - right[1].gain);
    const removeCount = Math.min(
      releasing.length,
      this.voices.size - boundedLimit,
    );
    for (let index = 0; index < removeCount; index += 1) {
      this.voices.delete(releasing[index][0]);
    }
  }

  setVoiceTargets(specs, nextSpecs, durationSeconds = 0) {
    const targetLimit = Math.min(this.maxVoices, this.runtimeLimit);
    const sanitized = Array.isArray(specs)
      ? specs.slice(0, targetLimit).map(sanitizeSpec)
      : [];
    const sanitizedNext = Array.isArray(nextSpecs)
      ? nextSpecs.slice(0, targetLimit).map(sanitizeSpec)
      : [];
    const nextByKey = new Map(sanitizedNext.map((spec) => [spec.key, spec]));
    const trajectorySamples = Math.round(clamp(durationSeconds, 0, 0.25) * sampleRate);
    const activeKeys = new Set(sanitized.map((spec) => spec.key));
    for (const [key, voice] of this.voices) {
      if (activeKeys.has(key)) continue;
      voice.target = { ...voice.target, gain: 0 };
      voice.nextTarget = voice.target;
      voice.trajectorySample = 0;
      voice.trajectorySamples = 0;
      voice.releasing = true;
    }

    const newVoiceCount = sanitized.reduce(
      (count, spec) => count + (this.voices.has(spec.key) ? 0 : 1),
      0,
    );
    this.pruneReleasingVoices(Math.max(0, this.maxVoices - newVoiceCount));
    for (const spec of sanitized) {
      const voice = this.voices.get(spec.key) ?? makeVoice(spec);
      voice.target = spec;
      voice.nextTarget = nextByKey.get(spec.key) ?? spec;
      voice.trajectorySample = 0;
      voice.trajectorySamples = trajectorySamples;
      voice.releasing = false;
      this.voices.set(spec.key, voice);
    }
    this.activeTargetCount = sanitized.length;
    const releaseAllowance = Math.min(64, Math.ceil(targetLimit * 0.125));
    this.pruneReleasingVoices(Math.min(
      this.maxVoices,
      targetLimit + releaseAllowance,
    ));
  }

  renderShepard(voice, frequency) {
    if (!voice.shepardExternallyDriven) {
      advanceShepardPosition(voice, voice.shepardRate / sampleRate);
    }

    // The legacy width of one brings both neighbouring windows to zero at the
    // half-octave point. Keep narrow stored values usable by guaranteeing a
    // small overlapping bank through every crossfade.
    const effectiveWidth = Math.max(MIN_SHEPARD_WIDTH, voice.shepardWidth);
    const halfWidth = effectiveWidth * 0.5;
    const frequencyCeiling = Math.min(MAX_FREQUENCY, sampleRate * 0.45);
    let sum = 0;
    let weightPower = 0;
    let contributorCount = 0;
    for (let index = 0; index < SHEPARD_PARTIAL_COUNT; index += 1) {
      const octaveOffset = index - SHEPARD_CENTER + voice.shepardPosition;
      const partialFrequency = frequency * 2 ** octaveOffset;

      // Keep every oscillator's phase moving even while its window is closed.
      // It can then enter the bank continuously instead of resuming from a
      // stale phase. Octave wraps still rotate these phases onto the matching
      // neighbouring oscillator in advanceShepardPosition().
      voice.shepardPhases[index] = wrapPhase(
        voice.shepardPhases[index] + TAU * partialFrequency / sampleRate,
      );

      const distance = Math.abs(octaveOffset) / halfWidth;
      if (
        distance >= 1
        || partialFrequency < MIN_FREQUENCY
        || partialFrequency > frequencyCeiling
      ) continue;
      const weight = 0.5 + 0.5 * Math.cos(Math.PI * distance);
      sum += Math.sin(voice.shepardPhases[index]) * weight;
      weightPower += weight ** 2;
      contributorCount += 1;
    }
    voice.shepardContributorCount = contributorCount;
    return weightPower > 1e-9 ? sum / Math.sqrt(weightPower) : 0;
  }

  renderVoice(voice) {
    const frequency = clamp(voice.frequency, MIN_FREQUENCY, sampleRate * 0.45);
    if (voice.mode === "shepard") return this.renderShepard(voice, frequency);

    const carrierIncrement = TAU * frequency / sampleRate;
    if (voice.mode === "sine") {
      voice.phase = wrapPhase(voice.phase + carrierIncrement);
      return Math.sin(voice.phase);
    }
    const modulationIncrement = carrierIncrement * voice.modulationRatio;
    voice.modulationPhase = wrapPhase(voice.modulationPhase + modulationIncrement);
    const modulation = Math.sin(voice.modulationPhase);

    if (voice.mode === "fm") {
      voice.phase = wrapPhase(
        voice.phase + carrierIncrement + modulationIncrement * voice.modulationIndex * modulation,
      );
      return Math.sin(voice.phase);
    }

    voice.phase = wrapPhase(voice.phase + carrierIncrement);
    return Math.sin(voice.phase + voice.modulationIndex * modulation);
  }

  recordRenderLoad(startedAt, frameCount) {
    if (startedAt === null || CLOCK_KIND === "unavailable") {
      if (!this.reportedTimingUnavailable) {
        this.port.postMessage?.({ type: "render-load", supported: false });
        this.reportedTimingUnavailable = true;
      }
      return;
    }
    const endedAt = clockMilliseconds();
    if (endedAt === null) return;
    const budgetMilliseconds = Math.max(1, frameCount) / sampleRate * 1000;
    const elapsed = Math.max(0, endedAt - startedAt) + this.pendingControlMilliseconds;
    this.pendingControlMilliseconds = 0;
    const load = elapsed / Math.max(1e-6, budgetMilliseconds);
    this.loadBlocks += 1;
    this.loadTotal += load;
    this.loadPeak = Math.max(this.loadPeak, load);
    if (this.loadBlocks < LOAD_REPORT_BLOCKS) return;
    this.port.postMessage?.({
      type: "render-load",
      supported: true,
      timing: CLOCK_KIND,
      averageLoad: this.loadTotal / this.loadBlocks,
      peakLoad: this.loadPeak,
      activeVoices: this.activeTargetCount,
      renderedVoices: this.voices.size,
      requestedVoices: this.requestedVoiceCount,
      voiceLimit: this.runtimeLimit,
      mode: this.requestedMode,
    });
    this.loadBlocks = 0;
    this.loadTotal = 0;
    this.loadPeak = 0;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    const renderStartedAt = clockMilliseconds();
    const left = output[0];
    const right = output[1] ?? left;
    left.fill(0);
    if (right !== left) right.fill(0);

    const gainSlew = 1 - Math.exp(-1 / (sampleRate * 0.004));
    const frequencySlew = 1 - Math.exp(-1 / (sampleRate * 0.018));
    const parameterSlew = 1 - Math.exp(-1 / (sampleRate * 0.025));
    const modulationSlew = 1 - Math.exp(-1 / (sampleRate * 0.012));

    for (const voice of this.voices.values()) {
      const target = voice.target;
      const nextTarget = voice.nextTarget;
      const trajectoryDuration = voice.trajectorySamples / sampleRate;
      const expectedShepardDelta = Number.isFinite(target.shepardTravel)
        && Number.isFinite(nextTarget.shepardTravel)
        ? nextTarget.shepardTravel - target.shepardTravel
        : (
          target.shepardRate + nextTarget.shepardRate
        ) * 0.5 * trajectoryDuration;
      const shepardTrajectoryDelta = directedWrappedPositionDelta(
        target.shepardPosition ?? 0,
        nextTarget.shepardPosition ?? target.shepardPosition ?? 0,
        expectedShepardDelta,
      );
      voice.mode = target.mode;
      for (let index = 0; index < left.length; index += 1) {
        const trajectoryAmount = voice.trajectorySamples > 0
          ? Math.min(1, (voice.trajectorySample + index) / voice.trajectorySamples)
          : 0;
        const gainTarget = target.gain + (nextTarget.gain - target.gain) * trajectoryAmount;
        const frequencyTarget = target.frequency
          + (nextTarget.frequency - target.frequency) * trajectoryAmount;
        const panTarget = target.pan + (nextTarget.pan - target.pan) * trajectoryAmount;
        const indexTarget = target.modulationIndex
          + (nextTarget.modulationIndex - target.modulationIndex) * trajectoryAmount;
        const ratioTarget = target.modulationRatio
          + (nextTarget.modulationRatio - target.modulationRatio) * trajectoryAmount;
        const shepardRateTarget = target.shepardRate
          + (nextTarget.shepardRate - target.shepardRate) * trajectoryAmount;
        const shepardWidthTarget = target.shepardWidth
          + (nextTarget.shepardWidth - target.shepardWidth) * trajectoryAmount;
        let shepardPositionTarget = null;
        if (Number.isFinite(target.shepardPosition)) {
          shepardPositionTarget = wrapUnit(
            target.shepardPosition
              + shepardTrajectoryDelta * trajectoryAmount
          );
        }
        voice.gain += (gainTarget - voice.gain) * gainSlew;
        voice.frequency += (frequencyTarget - voice.frequency) * frequencySlew;
        voice.pan += (panTarget - voice.pan) * parameterSlew;
        voice.modulationIndex += (
          indexTarget - voice.modulationIndex
        ) * modulationSlew;
        voice.modulationRatio += (
          ratioTarget - voice.modulationRatio
        ) * modulationSlew;
        voice.shepardRate += (shepardRateTarget - voice.shepardRate) * parameterSlew;
        voice.shepardWidth += (shepardWidthTarget - voice.shepardWidth) * parameterSlew;
        voice.shepardExternallyDriven = shepardPositionTarget !== null;
        if (shepardPositionTarget !== null) {
          advanceShepardPosition(
            voice,
            wrappedPositionDelta(voice.shepardPosition, shepardPositionTarget)
              * parameterSlew,
          );
        }

        const sample = this.renderVoice(voice) * voice.gain;
        const panAngle = (clamp(voice.pan, -1, 1) + 1) * Math.PI * 0.25;
        left[index] += sample * Math.cos(panAngle);
        if (right !== left) right[index] += sample * Math.sin(panAngle);
      }
      voice.trajectorySample = Math.min(
        voice.trajectorySamples,
        voice.trajectorySample + left.length,
      );
    }

    for (const [key, voice] of this.voices) {
      if (voice.releasing && voice.gain < 0.00001) this.voices.delete(key);
    }
    this.recordRenderLoad(renderStartedAt, left.length);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, MorphazoidContourSynth);

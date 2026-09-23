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

// Polynomial edge/corner corrections: constant work per voice, no extra
// oscillators or leaky triangle integrator (which can drift during pitch bends).
function polyBlep(phase, step) {
  if (phase < step) { const t = phase / step - 1; return -t * t; }
  if (phase > 1 - step) { const t = (phase - 1) / step + 1; return t * t; }
  return 0;
}
function polyBlamp(phase, step) {
  if (phase < step) { const t = 1 - phase / step; return t * t * t / 3; }
  if (phase > 1 - step) { const t = (phase - 1) / step + 1; return t * t * t / 3; }
  return 0;
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
  const mode = ["sine", "triangle", "square", "shepard", "fm", "pm"].includes(spec.mode)
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
    gainSmoothingSeconds: clamp(spec.gainSmoothingSeconds ?? 0.004, 0.002, 0.08),
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
    waveformFade: 1,
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

function envelopeAt(points, seconds) {
  if (seconds <= 0) return 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (seconds > b.time) continue;
    const t = b.time > a.time ? clamp((seconds - a.time) / (b.time - a.time), 0, 1) : 1;
    return a.level + (b.level - a.level) * t;
  }
  return 0;
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
    this.smoothVoiceStealing = Boolean(options.processorOptions?.smoothVoiceStealing);
    this.pendingTargets = new Map();
    this.renderedSamples = 0;
    this.noteQueue = [];
    this.noteSequence = 0;
    this.noteGainBudget = null;
    this.releaseLimit = this.maxVoices;
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
      if (event.data?.type === "notes") {
        this.queueNotes(event.data);
        return;
      }
      if (event.data?.type === "cancel-scheduled-notes") {
        this.noteQueue = this.noteQueue.filter(note => note.start <= this.renderedSamples);
        return;
      }
      if (event.data?.type === "release-notes") {
        this.noteQueue = this.noteQueue.filter(note => !note.hold);
        for (const voice of this.voices.values()) {
          if (!voice.note?.hold || voice.note.release) continue;
          voice.note.release = {
            at: this.renderedSamples,
            level: voice.target.gain > 0 ? clamp(voice.gain / voice.target.gain, 0, 1) : 0,
            duration: Math.max(0.002, voice.note.envelope[4].time - voice.note.envelope[3].time) * sampleRate,
          };
        }
        return;
      }
      if (event.data?.type === "voices") {
        this.noteQueue = [];
        const startedAt = clockMilliseconds();
        const nextRuntimeLimit = Math.floor(clamp(
          event.data.voiceLimit ?? this.runtimeLimit,
          0,
          this.maxVoices,
        ));
        const nextMode = ["sine", "triangle", "square", "fm", "pm", "shepard"].includes(event.data.mode)
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
          event.data.releaseVoiceAllowance,
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

  setVoiceTargets(
    specs,
    nextSpecs,
    durationSeconds = 0,
    requestedReleaseAllowance = 0,
  ) {
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
      voice.note = null;
    }

    if (this.smoothVoiceStealing) {
      // A full pool used to delete audible release tails immediately. Keep
      // them inside the same hard allocation and admit replacements only when
      // a slot is quiet. Rebuild the bounded waiting set from the latest
      // geometry, so stale intersections can never replay later.
      this.pendingTargets.clear();
      this.activeTargetCount = sanitized.length;
      const allowance = Math.min(
        this.maxVoices - targetLimit,
        Math.max(Math.min(64, Math.ceil(targetLimit * 0.125)), Math.floor(Number(requestedReleaseAllowance) || 0)),
      );
      this.releaseLimit = Math.min(this.maxVoices, targetLimit + allowance);
      for (const spec of sanitized) {
        const voice = this.voices.get(spec.key);
        const nextTarget = nextByKey.get(spec.key) ?? spec;
        if (voice) {
          voice.target = spec;
          voice.nextTarget = nextTarget;
          voice.trajectorySample = 0;
          voice.trajectorySamples = trajectorySamples;
          voice.releasing = false;
        } else {
          this.pendingTargets.set(spec.key, { spec, nextTarget, trajectorySamples, atSample: this.renderedSamples });
        }
      }
      if (this.voices.size + this.pendingTargets.size > this.releaseLimit) {
        for (const voice of this.voices.values()) {
          if (!voice.releasing) continue;
          // A short but real release, not a cut or extra overlapping bank.
          // Do not repeatedly reset its progress when geometry updates arrive.
          voice.target = { ...voice.target, gainSmoothingSeconds: Math.min(voice.target.gainSmoothingSeconds, 0.002) };
          voice.nextTarget = voice.target;
        }
      }
      this.admitPendingVoices();
      return;
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
    const defaultReleaseAllowance = Math.min(64, Math.ceil(targetLimit * 0.125));
    const releaseAllowance = Math.min(
      this.maxVoices - targetLimit,
      Math.max(
        defaultReleaseAllowance,
        Math.floor(Number(requestedReleaseAllowance) || 0),
      ),
    );
    this.pruneReleasingVoices(Math.min(
      this.maxVoices,
      targetLimit + releaseAllowance,
    ));
  }

  queueNotes(data) {
    const specs = Array.isArray(data.voices) ? data.voices.slice(0, 8).map(sanitizeSpec) : [];
    if (!specs.length) return;
    const envelope = Array.isArray(data.envelope) && data.envelope.length === 5
      ? data.envelope.map(point => ({ time: clamp(point.time, 0, 4), level: clamp(point.level, 0, 1) }))
      : [{ time: 0, level: 0 }, { time: 0.02, level: 1 }, { time: 0.12, level: 0.5 }, { time: 0.35, level: 0.5 }, { time: 0.7, level: 0 }];
    envelope[0] = { time: 0, level: 0 };
    envelope[4].level = 0;
    for (let i = 1; i < 5; i++) envelope[i].time = Math.max(envelope[i - 1].time, envelope[i].time);
    const mode = specs[0].mode;
    const limit = Math.floor(clamp(data.voiceLimit ?? this.maxVoices, 1, this.maxVoices));
    if (mode !== this.requestedMode || limit !== this.runtimeLimit) {
      this.loadBlocks = 0; this.loadTotal = 0; this.loadPeak = 0;
    }
    this.requestedMode = mode;
    this.runtimeLimit = limit;
    this.requestedVoiceCount = Math.max(limit, Math.floor(Number(data.requestedVoiceCount) || 0));
    const audioNow = Number.isFinite(globalThis.currentTime) ? globalThis.currentTime : this.renderedSamples / sampleRate;
    const requestedStart = Number(data.startAt);
    const start = this.renderedSamples + Math.round(((Number.isFinite(requestedStart) ? requestedStart : audioNow) - audioNow) * sampleRate);
    for (const spec of specs) this.noteQueue.push({
      spec: { ...spec, key: `note:${++this.noteSequence}:${spec.key}`, shepardPosition: null, shepardTravel: null },
      envelope, start, hold: Boolean(data.hold), joinInProgress: Boolean(data.joinInProgress),
    });
    this.noteQueue.sort((a, b) => a.start - b.start);
    this.noteQueue = this.noteQueue.slice(-Math.max(1, this.maxVoices * 4));
  }

  noteLevel(voice, at) {
    const note = voice.note;
    if (!note || at < note.start) return 0;
    if (note.release) {
      const t = (at - note.release.at) / note.release.duration;
      if (t >= 1) voice.releasing = true;
      return note.release.level * Math.max(0, 1 - t);
    }
    const seconds = (at - note.start) / sampleRate;
    if (note.hold && seconds >= note.envelope[3].time) return note.envelope[3].level;
    if (seconds >= note.envelope[4].time) voice.releasing = true;
    return envelopeAt(note.envelope, seconds);
  }

  admitScheduledNotes(blockSize) {
    if (this.noteQueue[0]?.start >= this.renderedSamples + blockSize) return;
    this.noteQueue = this.noteQueue.filter(note => note.joinInProgress
      ? note.start + note.envelope[4].time * sampleRate > this.renderedSamples
      : note.start >= this.renderedSamples - sampleRate * 0.03);
    const due = this.noteQueue.filter(note => note.start < this.renderedSamples + blockSize).length;
    const retiring = [...this.voices.values()].filter(voice => voice.releasing).length;
    const needed = Math.max(0, Math.min(due, this.runtimeLimit) - Math.max(0, this.runtimeLimit - this.voices.size) - retiring);
    const oldest = [...this.voices.values()].filter(voice => voice.note && !voice.releasing)
      .sort((a, b) => a.note.start - b.note.start).slice(0, needed);
    for (const voice of oldest) {
      voice.note = null;
      voice.releasing = true;
      voice.target = { ...voice.target, gain: 0, gainSmoothingSeconds: 0.002 };
      voice.nextTarget = voice.target;
      voice.trajectorySamples = 0;
    }
    while (this.noteQueue.length && this.voices.size < Math.min(this.maxVoices, this.runtimeLimit)) {
      if (this.noteQueue[0].start >= this.renderedSamples + blockSize) break;
      const note = this.noteQueue.shift(), voice = makeVoice(note.spec);
      voice.note = note; voice.noteKind = true;
      this.voices.set(note.spec.key, voice);
    }
    this.activeTargetCount = [...this.voices.values()].filter(voice => !voice.releasing).length;
  }

  admitPendingVoices() {
    if (!this.smoothVoiceStealing) return;
    for (const [key, voice] of this.voices) {
      if (voice.releasing && voice.gain < 0.00001) this.voices.delete(key);
    }
    for (const [key, pending] of this.pendingTargets) {
      if (this.voices.size >= this.releaseLimit) break;
      const voice = makeVoice(pending.spec);
      voice.nextTarget = pending.nextTarget;
      voice.trajectorySamples = pending.trajectorySamples;
      voice.trajectorySample = Math.min(pending.trajectorySamples, this.renderedSamples - pending.atSample);
      this.voices.set(key, voice);
      this.pendingTargets.delete(key);
    }
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
    const firstOctaveOffset = -SHEPARD_CENTER + voice.shepardPosition;
    let nextPartialFrequency = frequency * 2 ** firstOctaveOffset;
    for (let index = 0; index < SHEPARD_PARTIAL_COUNT; index += 1) {
      const octaveOffset = firstOctaveOffset + index;
      const partialFrequency = nextPartialFrequency;
      nextPartialFrequency *= 2;

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
    if (voice.mode === "triangle" || voice.mode === "square") {
      voice.phase = wrapPhase(voice.phase + carrierIncrement);
      const phase = wrapUnit(voice.phase / TAU), step = frequency / sampleRate;
      const opposite = wrapUnit(phase + 0.5);
      if (voice.mode === "square") {
        return (phase < 0.5 ? 1 : -1) + polyBlep(phase, step) - polyBlep(opposite, step);
      }
      return 1 - 4 * Math.abs(phase - 0.5)
        + 4 * step * (polyBlamp(phase, step) - polyBlamp(opposite, step));
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
    this.admitPendingVoices();
    const left = output[0];
    const right = output[1] ?? left;
    if (this.noteQueue.length) this.admitScheduledNotes(left.length);
    let noteBus = false;
    for (const voice of this.voices.values()) if (voice.noteKind) { noteBus = true; break; }
    if (noteBus) {
      if (this.noteGainBudget?.length !== left.length) this.noteGainBudget = new Float64Array(left.length);
      this.noteGainBudget.fill(0);
    }
    left.fill(0);
    if (right !== left) right.fill(0);

    const frequencySlew = 1 - Math.exp(-1 / (sampleRate * 0.018));
    const parameterSlew = 1 - Math.exp(-1 / (sampleRate * 0.025));
    const modulationSlew = 1 - Math.exp(-1 / (sampleRate * 0.012));
    const waveformFadeStep = 1 / (sampleRate * 0.006);

    for (const voice of this.voices.values()) {
      const target = voice.target;
      const nextTarget = voice.nextTarget;
      // Constant for this voice throughout the block. Hoisting is numerically
      // identical and avoids one Math.exp per voice per output sample.
      const gainSlew = 1 - Math.exp(
        -1 / (sampleRate * target.gainSmoothingSeconds),
      );
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
      // New waveform changes pass through zero without rendering a second
      // oscillator bank. Leave the pre-existing engine transitions unchanged.
      const waveformChange = voice.mode === "triangle" || voice.mode === "square"
        || target.mode === "triangle" || target.mode === "square";
      if (!waveformChange) voice.mode = target.mode;
      for (let index = 0; index < left.length; index += 1) {
        if (voice.note && this.renderedSamples + index < voice.note.start) continue;
        const trajectoryAmount = voice.trajectorySamples > 0
          ? Math.min(1, (voice.trajectorySample + index) / voice.trajectorySamples)
          : 0;
        const gainTarget = voice.note ? target.gain * this.noteLevel(voice, this.renderedSamples + index)
          : target.gain + (nextTarget.gain - target.gain) * trajectoryAmount;
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

        if (voice.mode !== target.mode) {
          voice.waveformFade = Math.max(0, voice.waveformFade - waveformFadeStep);
          if (voice.waveformFade === 0) voice.mode = target.mode;
        } else if (voice.waveformFade < 1) {
          voice.waveformFade = Math.min(1, voice.waveformFade + waveformFadeStep);
        }
        const sample = this.renderVoice(voice) * voice.gain * voice.waveformFade;
        if (noteBus) this.noteGainBudget[index] += Math.abs(voice.gain)
          * (voice.mode === "shepard" ? Math.sqrt(Math.max(1, voice.shepardContributorCount || 1)) : 1);
        const panAngle = (clamp(voice.pan, -1, 1) + 1) * Math.PI * 0.25;
        left[index] += sample * Math.cos(panAngle);
        if (right !== left) right[index] += sample * Math.sin(panAngle);
      }
      voice.trajectorySample = Math.min(
        voice.trajectorySamples,
        voice.trajectorySample + left.length,
      );
    }

    if (noteBus) for (let index = 0; index < left.length; index++) {
      const scale = Math.min(1, 0.78 / Math.max(0.78, this.noteGainBudget[index]));
      left[index] *= scale;
      if (right !== left) right[index] *= scale;
    }
    for (const [key, voice] of this.voices) {
      if (voice.releasing && voice.gain < 0.00001) this.voices.delete(key);
    }
    this.renderedSamples += left.length;
    this.recordRenderLoad(renderStartedAt, left.length);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, MorphazoidContourSynth);

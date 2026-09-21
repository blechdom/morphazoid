import { MOTION_CAPS } from "./recursion-motion.js";

const TAU = Math.PI * 2;

export const LIVE_AXIS_IDS = Object.freeze([
  "timbre",
  "pitch",
  "rhythm",
  "phrase",
  "twist",
  "memory",
]);

export const LIVE_DEFAULTS = Object.freeze({
  timbre: 0.64,
  pitch: 0.5,
  rhythm: 0.78,
  phrase: 0.52,
  twist: 0.62,
  memory: 0.74,
});

export const LIVE_LABELS = Object.freeze({
  "ouroboros-tape": Object.freeze({
    timbre: "Timbre",
    pitch: "Pitch",
    rhythm: "Rhythm",
    phrase: "Phrase",
    twist: "Twist",
    memory: "Memory",
  }),
  "spectral-mobius": Object.freeze({
    timbre: "Spectral aperture",
    pitch: "Bin-axis bend",
    rhythm: "Frame scatter",
    phrase: "Seam migration",
    twist: "Sheet inversion",
    memory: "Frame persistence",
  }),
  "filter-hydra": Object.freeze({
    timbre: "Branch resonance",
    pitch: "Band detuning",
    rhythm: "Head collision",
    phrase: "Branch migration",
    twist: "Crossover asymmetry",
    memory: "Tree inheritance",
  }),
  "cantor-delay": Object.freeze({
    timbre: "Dust bandwidth",
    pitch: "Echo-rate bend",
    rhythm: "Gap contraction",
    phrase: "Node migration",
    twist: "Ratio inversion",
    memory: "Echo ancestry",
  }),
  "convolution-maw": Object.freeze({
    timbre: "Kernel colour",
    pitch: "Mass transposition",
    rhythm: "Excitation density",
    phrase: "Kernel traversal",
    twist: "Crop polarity",
    memory: "Room persistence",
  }),
  "phase-labyrinth": Object.freeze({
    timbre: "Chamber colour",
    pitch: "Group-delay bend",
    rhythm: "Ricochet rate",
    phrase: "Route migration",
    twist: "Stage inversion",
    memory: "Return depth",
  }),
});

const VOICE_MIX = Object.freeze({
  "ouroboros-tape": Object.freeze({ native: 0.62, motion: 0.9 }),
  "spectral-mobius": Object.freeze({ native: 1, motion: 0.2 }),
  "filter-hydra": Object.freeze({ native: 1, motion: 0.14 }),
  "cantor-delay": Object.freeze({ native: 1, motion: 0.045 }),
  "convolution-maw": Object.freeze({ native: 1, motion: 0.16 }),
  "phase-labyrinth": Object.freeze({ native: 0.96, motion: 0.18 }),
});

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function fract(value) {
  return value - Math.floor(value);
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function expPosition(frequency) {
  return clamp(
    Math.log(Math.max(MOTION_CAPS.minFilterHz, frequency) / MOTION_CAPS.minFilterHz)
      / Math.log(MOTION_CAPS.maxFilterHz / MOTION_CAPS.minFilterHz),
  );
}

function expFrequency(position) {
  return MOTION_CAPS.minFilterHz
    * (MOTION_CAPS.maxFilterHz / MOTION_CAPS.minFilterHz) ** clamp(position);
}

function logRate(rate, amount, bias = 0) {
  return clamp(
    2 ** (Math.log2(Math.max(0.001, rate)) * amount + bias),
    MOTION_CAPS.minPlaybackRate,
    MOTION_CAPS.maxPlaybackRate,
  );
}

function routeNoise(pulse, index) {
  return fract(
    (Number(pulse.routeIndex) || 0) * 0.0000152587890625
      + (index + 1) * 0.6180339887498948,
  );
}

export function normalizeLiveAxes(values = {}) {
  return Object.freeze(Object.fromEntries(LIVE_AXIS_IDS.map((axis) => [
    axis,
    clamp(values[axis] ?? LIVE_DEFAULTS[axis]),
  ])));
}

export function fuzzyDspFor(values = LIVE_DEFAULTS) {
  const axes = normalizeLiveAxes(values);
  return Object.freeze({
    cutoffHz: round(120 * (16_000 / 120) ** axes.timbre),
    toneQ: round(0.7 + axes.timbre * 7.3),
    pitchRate: round(2 ** ((axes.pitch - 0.5) * 4)),
    rhythmHz: round(0.35 * (18 / 0.35) ** axes.rhythm),
    rhythmDepth: round(0.06 + axes.rhythm * 0.39),
    phraseDelay: round(0.025 * (0.9 / 0.025) ** axes.phrase),
    phrasePan: round((axes.phrase - 0.5) * 1.8),
    twistHz: round(120 * (7_200 / 120) ** axes.twist),
    twistQ: round(0.7 + axes.twist * 13.3),
    feedback: round(0.88 * axes.memory ** 1.6),
    wet: round(0.04 + axes.memory * 0.46),
    feedbackCutoffHz: 6_000,
    pulsePopulation: round(0.02 + axes.rhythm ** 2.4 * 0.98),
    subdivisions: 2 + Math.round(axes.rhythm * 30),
    grainSeconds: round(0.28 * (0.025 / 0.28) ** axes.rhythm),
    readPosition: round(0.02 + axes.phrase * 0.96),
    reverseChance: round(axes.twist),
    memoryStretch: round(0.5 + axes.memory * 1.7),
  });
}

export function denseMomentFor(plan) {
  const moments = Array.isArray(plan?.moments) ? plan.moments : [];
  const candidates = moments.filter((moment) => (
    moment
      && moment.kind !== "seed"
      && moment.kind !== "unwind"
  ));
  if (!candidates.length) return moments.find(Boolean) ?? null;
  return candidates.reduce((densest, moment) => {
    if (!densest || Number(moment.depth) > Number(densest.depth)) return moment;
    if (Number(moment.depth) === Number(densest.depth) && moment.kind === "center") {
      return moment;
    }
    return densest;
  }, null);
}

export function voiceMixFor(studyId, values = LIVE_DEFAULTS) {
  const base = VOICE_MIX[studyId];
  if (!base) throw new RangeError(`Unknown recursion study: ${studyId}`);
  const axes = normalizeLiveAxes(values);
  if (studyId === "ouroboros-tape") {
    return Object.freeze({
      native: round(base.native * (0.72 + axes.memory * 0.28)),
      motion: round(clamp(
        base.motion * (0.12 + axes.rhythm ** 1.3 * 1.2),
        0,
        1,
      )),
    });
  }
  return Object.freeze({
    native: round(base.native * (0.86 + axes.memory * 0.14)),
    motion: round(base.motion * (0.48 + axes.rhythm * 0.52)),
  });
}

export function ancestorGain(depth, maximumDepth, memory) {
  const maximum = Math.max(0, Math.round(Number(maximumDepth) || 0));
  const current = clamp(Math.round(Number(depth) || 0), 0, maximum);
  const amount = clamp(memory);
  const raw = Array.from(
    { length: maximum + 1 },
    (_, index) => amount ** Math.max(0, maximum - index),
  );
  const normalization = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
  return round(raw[current] / normalization);
}

export function sessionToneFor(studyId, values = LIVE_DEFAULTS) {
  const axes = normalizeLiveAxes(values);
  if (studyId === "ouroboros-tape") {
    const fuzzy = fuzzyDspFor(axes);
    return Object.freeze({
      type: "lowpass",
      frequency: fuzzy.cutoffHz,
      q: fuzzy.toneQ,
      gain: 0,
    });
  }
  const tone = {
    type: "lowpass",
    frequency: expFrequency(0.18 + axes.timbre * 0.8),
    q: 0.5 + axes.twist * 2,
    gain: 0,
  };

  if (studyId === "spectral-mobius") {
    tone.type = "peaking";
    tone.frequency = expFrequency(0.12 + axes.timbre * 0.8);
    tone.q = 0.7 + axes.twist * 7;
    tone.gain = (axes.timbre - 0.45) * 8;
  } else if (studyId === "filter-hydra") {
    tone.type = "peaking";
    tone.frequency = expFrequency(0.08 + axes.timbre * 0.76);
    tone.q = 1.2 + axes.twist * 9;
    tone.gain = -2 + axes.timbre * 6;
  } else if (studyId === "cantor-delay") {
    tone.type = "highpass";
    tone.frequency = expFrequency(axes.timbre * 0.48);
    tone.q = 0.4 + axes.twist * 3.5;
  } else if (studyId === "convolution-maw") {
    tone.type = "lowpass";
    tone.frequency = expFrequency(0.1 + axes.timbre * 0.72);
    tone.q = 0.4 + axes.twist * 1.6;
  } else if (studyId === "phase-labyrinth") {
    tone.type = "allpass";
    tone.frequency = expFrequency(0.04 + axes.timbre * 0.7);
    tone.q = 0.6 + axes.twist * 12;
  } else if (studyId !== "ouroboros-tape") {
    throw new RangeError(`Unknown recursion study: ${studyId}`);
  }

  return Object.freeze({
    type: tone.type,
    frequency: round(clamp(
      tone.frequency,
      MOTION_CAPS.minFilterHz,
      MOTION_CAPS.maxFilterHz,
    )),
    q: round(clamp(tone.q, 0.1, 14)),
    gain: round(clamp(tone.gain, -18, 18)),
  });
}

function shapePulse(studyId, pulse, axes, index, duration, generation) {
  const span = Math.max(0.08, duration * 0.84);
  const position = clamp((Number(pulse.offset) || 0) / span);
  const noise = routeNoise(pulse, index);
  const filterPosition = expPosition(pulse.filterHz);
  const centeredPitch = axes.pitch - 0.5;
  const result = {
    ...pulse,
    generation,
  };

  if (studyId === "ouroboros-tape") {
    const fuzzy = fuzzyDspFor(axes);
    const subdivisions = fuzzy.subdivisions;
    const orbit = fract(
      position * subdivisions
        + axes.phrase * 0.97
        + noise * axes.twist * 0.88,
    );
    result.offset = orbit * span;
    result.duration = clamp(
      fuzzy.grainSeconds * fuzzy.memoryStretch * (0.72 + noise * 0.56),
      0.025,
      0.72,
    );
    result.sourcePosition = clamp(
      fuzzy.readPosition
        + (noise - 0.5) * (0.04 + axes.twist * 0.08),
      0.002,
      0.998,
    );
    // Pitch is applied once, at the persistent audio graph, so new grains and
    // already-sounding voices share the same absolute transposition.
    result.playbackRate = pulse.playbackRate;
    result.pitchEnd = pulse.pitchEnd * 0.35;
    result.filterHz = clamp(
      fuzzy.cutoffHz * 2 ** ((noise - 0.5) * 4),
      MOTION_CAPS.minFilterHz,
      MOTION_CAPS.maxFilterHz,
    );
    result.q = fuzzy.toneQ + axes.twist * 4;
    result.delay = clamp(
      pulse.delay * (0.12 + axes.rhythm * 1.4)
        + (index % subdivisions === 0 ? fuzzy.phraseDelay * 0.12 : 0),
      0,
      MOTION_CAPS.maxDelaySeconds,
    );
    if (noise < fuzzy.reverseChance) result.timeDirection *= -1;
    if (noise < fuzzy.reverseChance * 0.72) {
      result.polarity = (Number(result.polarity) || 1) * -1;
    }
  } else if (studyId === "spectral-mobius") {
    const frames = 8 + Math.round(axes.rhythm * 32);
    const frame = Math.floor(position * frames) / frames;
    result.offset = clamp(
      (frame + (noise - 0.5) * axes.rhythm * 0.022) * span,
      0,
      span,
    );
    result.duration = clamp(
      pulse.duration * (2.8 + axes.memory * 3.8),
      0.16,
      1.25,
    );
    result.sourcePosition = fract(
      pulse.sourcePosition + axes.phrase * 0.54 + noise * axes.twist * 0.24,
    );
    result.playbackRate = logRate(
      pulse.playbackRate,
      0.04 + axes.pitch * 0.34,
      centeredPitch * 0.08,
    );
    result.pitchEnd = pulse.pitchEnd * (0.02 + axes.pitch * 0.28);
    const spectralSlots = 18 + Math.round(axes.timbre * 54);
    const folded = fract(
      filterPosition
        + axes.phrase * 0.36
        + (noise < axes.twist ? 1 - filterPosition : filterPosition) * axes.twist,
    );
    result.filterHz = expFrequency(Math.round(folded * spectralSlots) / spectralSlots);
    result.q = 1 + axes.timbre * 4 + axes.twist * 4;
    result.delay = pulse.delay * 0.18;
  } else if (studyId === "filter-hydra") {
    const branch = (pulse.routeIndex ?? index) % 16;
    const branchPhase = branch / 16;
    result.offset = fract(
      position + branchPhase * axes.rhythm * 0.72 + axes.phrase * 0.19,
    ) * span;
    result.duration = clamp(pulse.duration * (0.82 + axes.memory), 0.055, 0.34);
    result.sourcePosition = fract(pulse.sourcePosition + branchPhase * axes.phrase);
    result.playbackRate = logRate(
      pulse.playbackRate,
      0.025 + axes.pitch * 0.2,
      centeredPitch * 0.06,
    );
    result.pitchEnd = pulse.pitchEnd * (0.02 + axes.pitch * 0.16);
    result.filterHz = expFrequency(clamp(
      filterPosition + (axes.timbre - 0.5) * 0.42 + (branchPhase - 0.5) * axes.twist * 0.24,
    ));
    result.q = 1.5 + axes.timbre * 6 + axes.twist * 6;
    result.delay = pulse.delay * (0.25 + axes.rhythm * 1.3)
      + (branch % 4) * axes.rhythm * 0.008;
    result.routeIndex = Math.floor(fract(
      branchPhase + axes.phrase * 0.61 + axes.twist * noise,
    ) * 65_536);
  } else if (studyId === "cantor-delay") {
    const ratio = 0.24 + axes.rhythm * 0.22;
    const ternary = fract(position * 3 + noise * axes.twist);
    result.offset = ternary * span;
    result.duration = clamp(pulse.duration * (0.25 + axes.memory * 0.5), 0.022, 0.13);
    result.sourcePosition = fract(pulse.sourcePosition + axes.phrase * noise);
    result.playbackRate = logRate(
      pulse.playbackRate,
      0.01 + axes.pitch * 0.12,
      centeredPitch * 0.04,
    );
    result.pitchEnd = pulse.pitchEnd * axes.pitch * 0.08;
    result.filterHz = expFrequency(clamp(
      filterPosition + (axes.timbre - 0.5) * 0.36,
    ));
    result.q = 0.8 + axes.timbre * 5;
    result.delay = clamp(
      pulse.delay * (0.3 + axes.memory * 1.4)
        + ratio ** (1 + (index % 5)) * axes.twist,
      0,
      MOTION_CAPS.maxDelaySeconds,
    );
  } else if (studyId === "convolution-maw") {
    const strikes = 3 + Math.round(axes.rhythm * 9);
    const strike = Math.floor(position * strikes) / strikes;
    result.offset = clamp(
      (strike + noise * 0.035 * axes.rhythm) * span,
      0,
      span,
    );
    result.duration = clamp(
      pulse.duration * (4.4 + axes.memory * 4.8),
      0.28,
      1.45,
    );
    result.sourcePosition = fract(
      pulse.sourcePosition * (0.25 + axes.phrase * 0.75)
        + noise * axes.twist * 0.2,
    );
    result.playbackRate = logRate(
      pulse.playbackRate,
      0.05 + axes.pitch * 0.24,
      centeredPitch * 0.34,
    );
    result.pitchEnd = pulse.pitchEnd * (0.02 + axes.pitch * 0.18);
    result.filterHz = expFrequency(clamp(
      filterPosition * (0.45 + axes.timbre * 0.55)
        + axes.twist * 0.08,
    ));
    result.q = 0.35 + axes.timbre * 2.4;
    result.delay = pulse.delay * (0.35 + axes.memory);
  } else if (studyId === "phase-labyrinth") {
    const ricochet = Math.sin((index + 1) * (1.9 + axes.rhythm * 3.7));
    result.offset = fract(
      position + ricochet * axes.twist * 0.16 + axes.phrase * 0.13,
    ) * span;
    result.duration = clamp(pulse.duration * (0.5 + axes.memory * 0.9), 0.04, 0.28);
    result.sourcePosition = fract(pulse.sourcePosition + ricochet * axes.phrase * 0.18);
    result.playbackRate = logRate(
      pulse.playbackRate,
      0.025 + axes.pitch * 0.18,
      centeredPitch * 0.05,
    );
    result.pitchEnd = pulse.pitchEnd * (0.02 + axes.pitch * 0.15);
    result.filterHz = expFrequency(clamp(
      filterPosition + (axes.timbre - 0.5) * 0.48,
    ));
    result.q = 1 + axes.timbre * 3 + axes.twist * 8;
    result.delay = clamp(
      pulse.delay * (0.4 + axes.memory * 1.2)
        + Math.abs(ricochet) * axes.twist * 0.045,
      0,
      0.24,
    );
    if (noise < axes.twist * 0.5) result.polarity *= -1;
  } else {
    throw new RangeError(`Unknown recursion study: ${studyId}`);
  }

  const panOrbit = Math.sin(TAU * (
    axes.phrase * 0.5 + noise + index * 0.06180339887498948
  ));
  result.pan = clamp(
    pulse.pan * (0.25 + axes.phrase * 0.65) + panOrbit * axes.phrase * 0.4,
    -1,
    1,
  );
  result.channelSwap = axes.twist > 0.5
    ? Boolean(result.timeDirection < 0 || pulse.channelSwap)
    : Boolean(pulse.channelSwap && noise < axes.twist);
  result.offset = clamp(result.offset, 0, span);
  result.duration = clamp(result.duration, 0.02, 1.5);
  result.sourcePosition = clamp(result.sourcePosition);
  result.playbackRate = clamp(
    result.playbackRate,
    MOTION_CAPS.minPlaybackRate,
    MOTION_CAPS.maxPlaybackRate,
  );
  result.pitchEnd = clamp(
    result.pitchEnd,
    -MOTION_CAPS.maxAbsPitchSemitones,
    MOTION_CAPS.maxAbsPitchSemitones,
  );
  result.filterHz = clamp(
    result.filterHz,
    MOTION_CAPS.minFilterHz,
    MOTION_CAPS.maxFilterHz,
  );
  result.q = clamp(result.q, 0.2, 14);
  result.pan = clamp(result.pan, -1, 1);
  result.delay = clamp(result.delay, 0, MOTION_CAPS.maxDelaySeconds);

  for (const key of [
    "offset",
    "duration",
    "sourcePosition",
    "playbackRate",
    "pitchEnd",
    "filterHz",
    "q",
    "pan",
    "delay",
  ]) {
    result[key] = round(result[key]);
  }
  return result;
}

function shapeEvent(studyId, event, axes, index, total, maximumDepth) {
  const shaped = {
    ...event,
    process: event.process ? { ...event.process } : event.process,
  };
  const route = routeNoise(event, index);

  if (studyId === "filter-hydra") {
    shaped.process.filters = (event.process?.filters ?? []).map((filter, filterIndex) => ({
      ...filter,
      cutoffHz: round(clamp(
        filter.cutoffHz * 2 ** (
          (axes.timbre - 0.5) * 3
            + (filterIndex % 2 ? 1 : -1) * axes.twist * 0.7
        ),
        24,
        18_000,
      )),
      q: round(clamp(filter.q * (0.35 + axes.timbre * 1.5), 0.1, 12)),
    }));
    shaped.offset = round((event.offset ?? 0) * (0.35 + axes.rhythm * 1.25));
  } else if (studyId === "cantor-delay") {
    const ratioWarp = 0.34 + axes.rhythm * 1.2;
    shaped.offset = round((event.offset ?? 0) * ratioWarp * (
      route < axes.twist ? 0.72 + axes.phrase * 0.56 : 1
    ));
    shaped.duration = round(clamp(
      (event.duration ?? 0.08) * (0.4 + axes.memory * 0.9),
      0.022,
      0.3,
    ));
    shaped.gain = round((event.gain ?? 0.04) * (0.55 + axes.memory * 0.7));
  } else if (studyId === "phase-labyrinth") {
    let chain = (event.process?.chain ?? []).map((stage, stageIndex) => ({
      ...stage,
      delayMs: round(clamp(
        stage.delayMs * (0.3 + axes.memory * 1.35)
          * (stageIndex % 2 ? 0.72 + axes.twist * 0.7 : 1),
        1,
        48,
      )),
      feedback: round(clamp(
        stage.feedback * (0.28 + axes.twist * 0.9),
        0.02,
        0.94,
      )),
    }));
    if (chain.length > 1 && axes.twist > 0.48) {
      const shift = Math.min(
        chain.length - 1,
        Math.round(axes.phrase * (chain.length - 1)),
      );
      chain = [...chain.slice(shift), ...chain.slice(0, shift)];
      if (axes.twist > 0.72) {
        chain = chain.flatMap((stage, stageIndex) => (
          stageIndex % 2 ? [] : [stage, chain[stageIndex + 1]]
        )).filter(Boolean).reverse();
      }
    }
    shaped.process.chain = chain;
    shaped.process.returning = Boolean(event.process?.returning)
      !== (axes.twist > 0.82 && index % 2 === 1);
    shaped.duration = round(clamp(
      (event.duration ?? 0.2) * (0.55 + axes.memory * 0.8),
      0.08,
      7,
    ));
  } else {
    const sourceGeneration = Math.max(0, Number(event.generation ?? event.depth ?? maximumDepth));
    shaped.generation = Math.round(sourceGeneration * (0.3 + axes.twist * 0.7));
    shaped.duration = round(clamp(
      (event.duration ?? 0.2) * (
        studyId === "convolution-maw"
          ? 0.7 + axes.memory * 0.8
          : 0.58 + axes.memory * 0.62
      ),
      0.05,
      8,
    ));
    shaped.pan = round(clamp(
      (event.pan ?? 0) + (route - 0.5) * axes.phrase * 0.9,
      -1,
      1,
    ));
  }

  shaped.liveOrder = total > 1 ? index / (total - 1) : 0;
  return shaped;
}

export function morphMoment(studyId, moment, values = LIVE_DEFAULTS) {
  if (!moment) return null;
  if (!VOICE_MIX[studyId]) throw new RangeError(`Unknown recursion study: ${studyId}`);
  const axes = normalizeLiveAxes(values);
  const duration = Math.max(0.08, Number(moment.duration) || 1);
  const maximumDepth = Math.max(0, Math.round(Number(moment.depth) || 0));
  const originalPulses = Array.isArray(moment.motion?.pulses)
    ? moment.motion.pulses
    : [];
  const population = studyId === "ouroboros-tape"
    ? fuzzyDspFor(axes).pulsePopulation
    : 0.14 + axes.rhythm * 0.86;
  const pulses = originalPulses
    .filter((pulse, index) => (
      index === 0 || routeNoise(pulse, index) <= population
    ))
    .map((pulse, index) => shapePulse(
      studyId,
      pulse,
      axes,
      index,
      duration,
      Math.round(maximumDepth * (0.3 + axes.twist * 0.7)),
    ))
    .sort((left, right) => left.offset - right.offset);

  const originalEvents = Array.isArray(moment.events) ? moment.events : [];
  let events = originalEvents.map((event, index) => shapeEvent(
    studyId,
    event,
    axes,
    index,
    originalEvents.length,
    maximumDepth,
  ));
  if (studyId === "cantor-delay" && events.length > 1) {
    const populationLimit = Math.max(1, Math.round(events.length * population));
    events = events.filter((event, index) => (
      index === 0 || routeNoise(event, index) <= population
    )).slice(0, populationLimit);
  }

  return {
    ...moment,
    events,
    motion: moment.motion
      ? {
        ...moment.motion,
        pulses,
        liveAxes: axes,
      }
      : moment.motion,
  };
}

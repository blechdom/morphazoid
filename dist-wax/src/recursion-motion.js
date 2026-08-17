const TAU = Math.PI * 2;
const PRECISION = 1_000_000;

export const MOTION_CAPS = Object.freeze({
  maxPulsesPerMoment: 96,
  maxPulsesPerPlan: 768,
  minPlaybackRate: 0.42,
  maxPlaybackRate: 3.2,
  maxAbsPitchSemitones: 24,
  minFilterHz: 45,
  maxFilterHz: 16_000,
  maxDelaySeconds: 1.5,
});

const PROFILES = Object.freeze({
  "ouroboros-tape": Object.freeze({
    phase: 0.071,
    density: 1,
    coupling: [0.88, -0.72, 0.82, 0.94],
  }),
  "spectral-mobius": Object.freeze({
    phase: 0.193,
    density: 1.08,
    coupling: [0.98, -0.66, 0.74, 1],
  }),
  "filter-hydra": Object.freeze({
    phase: 0.317,
    density: 1.12,
    coupling: [0.84, 0.92, -0.96, 0.68],
  }),
  "cantor-delay": Object.freeze({
    phase: 0.439,
    density: 1.16,
    coupling: [-0.58, 1, 0.99, 0.76],
  }),
  "convolution-maw": Object.freeze({
    phase: 0.563,
    density: 1.04,
    coupling: [0.78, -0.86, 0.71, 0.91],
  }),
  "phase-labyrinth": Object.freeze({
    phase: 0.683,
    density: 1.1,
    coupling: [-0.72, 0.88, -0.8, 1],
  }),
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function fract(value) {
  return value - Math.floor(value);
}

function round(value) {
  return Math.round(value * PRECISION) / PRECISION;
}

function exponential(minimum, maximum, position) {
  return minimum * (maximum / minimum) ** clamp(position, 0, 1);
}

function clock(periodDuration, cycles, phase, direction) {
  return {
    period: round(periodDuration / cycles),
    cycles,
    phase: round(fract(phase)),
    direction: direction < 0 ? -1 : 1,
  };
}

function clockValue(definition, position) {
  return fract(
    definition.phase
    + definition.direction * definition.cycles * position,
  );
}

function variedCoupling(base, momentIndex, offset, intensity) {
  const movement = 0.82 + 0.18 * (
    0.5 + 0.5 * Math.sin((momentIndex + 1) * (1.17 + offset * 0.21) + intensity * TAU)
  );
  return round(clamp(base * movement, -1, 1));
}

function motionClocks(duration, momentIndex, intensity, profile, seamDirection) {
  const phraseCycles = 1;
  const rhythmCycles = Math.min(
    12,
    Math.max(3, 3 + (momentIndex % 4) + Math.round(intensity * 4)),
  );
  const pitchCycles = Math.min(
    32,
    Math.max(rhythmCycles + 1, rhythmCycles * (2 + (momentIndex % 2))),
  );
  const timbreCycles = Math.min(
    96,
    Math.max(pitchCycles + 1, pitchCycles * (2 + Math.round(intensity))),
  );
  const seed = profile.phase + momentIndex;

  return {
    timbre: clock(
      duration,
      timbreCycles,
      seed * 0.7320508075688772,
      momentIndex % 3 === 0 ? -seamDirection : seamDirection,
    ),
    pitch: clock(
      duration,
      pitchCycles,
      seed * 0.6180339887498948,
      momentIndex % 2 === 0 ? seamDirection : -seamDirection,
    ),
    rhythm: clock(
      duration,
      rhythmCycles,
      seed * 0.414213562373095,
      momentIndex % 4 < 2 ? seamDirection : -seamDirection,
    ),
    phrase: clock(
      duration,
      phraseCycles,
      seed * 0.3819660112501051,
      seamDirection,
    ),
  };
}

function pulseCountFor({
  seed,
  momentIndex,
  intensity,
  profile,
  fairMaximum,
}) {
  if (seed) return Math.min(8, fairMaximum);
  const desired = Math.round(
    (24 + momentIndex * 12 + intensity * 20) * profile.density,
  );
  return Math.min(MOTION_CAPS.maxPulsesPerMoment, fairMaximum, Math.max(8, desired));
}

function buildPulses({
  duration,
  count,
  clocks,
  coupling,
  seam,
  profile,
  intensity,
  transform,
  previousState,
  momentIndex,
}) {
  const pulses = [];
  const state = {
    timbre: fract(previousState?.timbre ?? clocks.timbre.phase),
    pitch: fract(previousState?.pitch ?? clocks.pitch.phase),
    rhythm: fract(previousState?.rhythm ?? clocks.rhythm.phase),
    phrase: fract(previousState?.phrase ?? clocks.phrase.phase),
  };
  const transformMotion = clamp(
    Math.abs(Number(transform)) / (1 + Math.abs(Number(transform))),
    0,
    1,
  );
  const twist = clamp(0.62 + intensity * 0.58 + transformMotion * 0.36, 0.62, 1.5);
  const phraseRegions = Math.max(2, Math.min(12, 3 + momentIndex + Math.round(intensity * 3)));

  for (let pulseIndex = 0; pulseIndex < count; pulseIndex += 1) {
    const position = (pulseIndex + 0.5) / count;
    const timbreClock = clockValue(clocks.timbre, position);
    const pitchClock = clockValue(clocks.pitch, position);
    const rhythmClock = clockValue(clocks.rhythm, position);
    const phraseClock = clockValue(clocks.phrase, position);

    state.timbre = fract(
      timbreClock
      + coupling.phraseToTimbre * (state.phrase - 0.5)
      + Math.sin(TAU * state.rhythm) * 0.17 * twist,
    );
    state.pitch = fract(
      pitchClock
      + coupling.timbreToPitch * (state.timbre - 0.5)
      + Math.sin(TAU * state.phrase) * 0.11 * twist,
    );
    state.rhythm = fract(
      rhythmClock
      + coupling.pitchToRhythm * (state.pitch - 0.5)
      + Math.sin(TAU * state.timbre) * 0.13 * twist,
    );
    state.phrase = fract(
      phraseClock
      + coupling.rhythmToPhrase * (state.rhythm - 0.5) * 0.48
      + Math.sin(TAU * state.pitch) * 0.09 * twist,
    );

    const gridDuration = duration / count;
    const jitter = Math.sin(TAU * state.rhythm) * gridDuration * (0.44 + intensity * 0.32);
    const offset = clamp(
      position * duration * 0.84 + jitter,
      0,
      duration * 0.84,
    );
    const delay = clamp(
      clocks.rhythm.period
        * (0.04 + 0.5 * state.rhythm)
        * (0.34 + intensity * 0.66),
      0,
      Math.min(MOTION_CAPS.maxDelaySeconds, duration * 0.075),
    );
    const desiredDuration = clamp(
      clocks.timbre.period
        * (1.5 + 5.5 * state.phrase)
        * (0.8 + intensity * 0.8),
      0.035,
      Math.min(0.46, duration * 0.12),
    );
    const pulseDuration = Math.max(
      0.02,
      Math.min(desiredDuration, duration - offset - delay - 0.004),
    );

    const semitones = (state.pitch - 0.5)
      * MOTION_CAPS.maxAbsPitchSemitones
      * 1.76
      * twist;
    const playbackRate = clamp(
      2 ** (semitones / 12),
      MOTION_CAPS.minPlaybackRate,
      MOTION_CAPS.maxPlaybackRate,
    );
    const pitchEnd = clamp(
      (
        (state.rhythm - 0.5) * 38
        + Math.sin(TAU * state.timbre) * 11
      ) * twist,
      -MOTION_CAPS.maxAbsPitchSemitones,
      MOTION_CAPS.maxAbsPitchSemitones,
    );
    const filterPosition = fract(
      state.timbre
      + coupling.phraseToTimbre * (state.phrase - 0.5) * 0.36,
    );
    const filterHz = exponential(
      MOTION_CAPS.minFilterHz,
      MOTION_CAPS.maxFilterHz,
      0.025 + filterPosition * 0.95,
    );
    const phraseIndex = pulseIndex === 0
      ? 0
      : Math.min(phraseRegions - 1, Math.floor(state.phrase * phraseRegions));
    const localOrientation = (seam.crossings + phraseIndex) % 2 === 1 ? -1 : 1;
    const sourceOrbit = fract(
      state.phrase
      + state.timbre * 0.23
      + state.rhythm * 0.11
      + momentIndex * 0.6180339887498948,
    );
    const sourcePosition = localOrientation < 0 ? 1 - sourceOrbit : sourceOrbit;

    pulses.push({
      offset: round(offset),
      duration: round(pulseDuration),
      sourcePosition: round(clamp(sourcePosition, 0, 1)),
      playbackRate: round(playbackRate),
      pitchEnd: round(pitchEnd),
      filterHz: round(filterHz),
      q: round(clamp(0.42 + intensity * 4.4 + state.rhythm * 8.8, 0.2, 14)),
      pan: round(clamp(
        Math.sin(TAU * (state.phrase + state.pitch * 0.5 + profile.phase)),
        -1,
        1,
      )),
      delay: round(delay),
      polarity: pulseIndex === 0 ? seam.orientation : localOrientation,
      phraseIndex,
      timeDirection: localOrientation,
      channelSwap: localOrientation < 0,
      routeIndex: Math.floor(fract(
        state.rhythm + state.timbre * 0.6180339887498948 + pulseIndex * 0.3819660112501051,
      ) * 65_536),
    });
  }

  pulses.sort((left, right) => left.offset - right.offset);
  return {
    pulses,
    endState: {
      timbre: round(state.timbre),
      pitch: round(state.pitch),
      rhythm: round(state.rhythm),
      phrase: round(state.phrase),
    },
  };
}

export function addDimensionalMotion(studyId, params, moments) {
  const profile = PROFILES[studyId];
  if (!profile) throw new RangeError(`Unknown motion profile: ${studyId}`);
  const transformedCount = moments.reduce(
    (count, moment) => count + (moment.kind === "seed" ? 0 : 1),
    0,
  );
  const seedCount = moments.some((moment) => moment.kind === "seed") ? 8 : 0;
  const fairMaximum = transformedCount
    ? Math.min(
      MOTION_CAPS.maxPulsesPerMoment,
      Math.floor((MOTION_CAPS.maxPulsesPerPlan - seedCount) / transformedCount),
    )
    : MOTION_CAPS.maxPulsesPerMoment;
  let previousState = null;

  const movingMoments = moments.map((moment, momentIndex) => {
    const duration = Math.max(0.08, Number(moment.duration) || Number(params.pace) || 1);
    const intensity = clamp(params.intensity, 0, 1);
    const seamDirection = momentIndex % 2 === 1 ? -1 : 1;
    const seam = {
      topology: "klein",
      crossings: momentIndex,
      orientation: seamDirection,
      channelSwap: seamDirection < 0,
      timeDirection: seamDirection,
    };
    const clocks = motionClocks(
      duration,
      momentIndex,
      intensity,
      profile,
      seamDirection,
    );
    const coupling = {
      timbreToPitch: variedCoupling(profile.coupling[0], momentIndex, 0, intensity),
      pitchToRhythm: variedCoupling(profile.coupling[1], momentIndex, 1, intensity),
      rhythmToPhrase: variedCoupling(profile.coupling[2], momentIndex, 2, intensity),
      phraseToTimbre: variedCoupling(profile.coupling[3], momentIndex, 3, intensity),
    };
    const count = pulseCountFor({
      seed: moment.kind === "seed",
      momentIndex,
      intensity,
      profile,
      fairMaximum,
    });
    const motion = buildPulses({
      duration,
      count,
      clocks,
      coupling,
      seam,
      profile,
      intensity,
      transform: params.transform,
      previousState,
      momentIndex,
    });
    previousState = motion.endState;
    return {
      ...moment,
      motion: {
        clocks,
        coupling,
        seam,
        pulses: motion.pulses,
        endState: motion.endState,
      },
    };
  });

  return {
    moments: movingMoments,
    motionCaps: MOTION_CAPS,
  };
}

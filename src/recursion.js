const TIME_PRECISION = 1_000_000;
const MAX_CANTOR_NODES = 511;

function roundTime(value) {
  return Math.round(value * TIME_PRECISION) / TIME_PRECISION;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function clampInteger(value, minimum, maximum, fallback) {
  return Math.round(clampNumber(value, minimum, maximum, fallback));
}

function numericParameter(definition) {
  return Object.freeze({
    step: 0.01,
    unit: "",
    ...definition,
  });
}

const RECURSION_SOURCES = Object.freeze([
  Object.freeze({
    id: "noise",
    label: "Noise field",
    description: "A deterministic broadband noise buffer exposes every spectral and temporal fold.",
  }),
  Object.freeze({
    id: "impulse",
    label: "Impulse",
    description: "A short, unpitched click makes delays, filters, convolution tails, and phase smear explicit.",
  }),
  Object.freeze({
    id: "upload",
    label: "Uploaded audio",
    description: "A user-supplied buffer replaces the generated seed while the recursive structure stays fixed.",
  }),
]);

function study({
  id,
  rank,
  title,
  shortTitle,
  copy,
  depth,
  pace,
  transform,
  intensity = {},
  limits,
}) {
  const parameters = Object.freeze({
    depth: numericParameter({
      id: "depth",
      label: "Recursive depth",
      min: depth.min,
      max: depth.max,
      step: 1,
      default: depth.default,
      unit: " levels",
      format: (value) => `${Math.round(value)} levels`,
    }),
    pace: numericParameter({
      id: "pace",
      label: "Seconds per generation",
      min: pace.min,
      max: pace.max,
      step: pace.step ?? 0.05,
      default: pace.default,
      unit: " s",
      format: (value) => `${Number(value).toFixed(2)} s`,
    }),
    transform: numericParameter(transform),
    intensity: numericParameter({
      id: "intensity",
      label: intensity.label ?? "Process intensity",
      min: intensity.min ?? 0.1,
      max: intensity.max ?? 1,
      step: intensity.step ?? 0.01,
      default: intensity.default ?? 0.68,
      unit: "%",
      format: (value) => `${Math.round(Number(value) * 100)}%`,
    }),
    source: Object.freeze({
      id: "source",
      label: "Seed source",
      default: "noise",
      options: RECURSION_SOURCES,
    }),
  });
  const defaults = Object.freeze({
    depth: parameters.depth.default,
    pace: parameters.pace.default,
    transform: parameters.transform.default,
    intensity: parameters.intensity.default,
    source: parameters.source.default,
  });

  return Object.freeze({
    id,
    rank,
    title,
    shortTitle,
    description: copy.premise,
    copy: Object.freeze(copy),
    parameters,
    transform: parameters.transform,
    sources: RECURSION_SOURCES,
    defaults,
    limits: Object.freeze({
      maxDepth: parameters.depth.max,
      maxMoments: limits.maxMoments,
      maxEvents: limits.maxEvents ?? limits.maxMoments,
      maxDuration: limits.maxDuration,
    }),
  });
}

export const RECURSION_STUDIES = Object.freeze([
  study({
    id: "ouroboros-tape",
    rank: 1,
    title: "Ouroboros Tape",
    shortTitle: "Buffer consumes buffer",
    copy: {
      premise: "The rendered buffer from one pass becomes the only input to the next.",
      cue: "Listen for the seed surviving as direction, bandwidth, and tail placement turn inside out.",
      sequence: "Dry seed → reverse → filter → tail-to-head fold → next bounded buffer.",
      recursion: "Serial output-as-input recursion",
      process: "Offline buffer reversal, filtering, folding, and normalization",
      listenFor: "A recognizable texture repeatedly swallowing its own ending.",
    },
    depth: { min: 1, max: 8, default: 5 },
    pace: { min: 2.8, max: 7, default: 5.3, step: 0.1 },
    transform: {
      id: "transform",
      label: "Tail consumed",
      min: 0.08,
      max: 0.9,
      step: 0.01,
      default: 0.58,
      unit: "%",
      format: (value) => `${Math.round(Number(value) * 100)}% folded`,
    },
    intensity: { label: "Spectral erosion", default: 0.62 },
    limits: { maxMoments: 9, maxEvents: 9, maxDuration: 80 },
  }),
  study({
    id: "spectral-mobius",
    rank: 2,
    title: "Spectral Möbius",
    shortTitle: "Spectrum turns over",
    copy: {
      premise: "Each STFT frame folds its upper spectrum back through the lower spectrum.",
      cue: "Follow stable noise bands as bin order and phase orientation make a half-turn each generation.",
      sequence: "Analyze → mirror bins → rotate phase → overlap-add → recurse from that result.",
      recursion: "Serial spectral-domain recursion",
      process: "Hann-window STFT, deterministic bin permutation, phase rotation, overlap-add",
      listenFor: "Brightness becoming underside, then returning with its phase seam displaced.",
    },
    depth: { min: 1, max: 6, default: 4 },
    pace: { min: 3, max: 8, default: 6, step: 0.1 },
    transform: {
      id: "transform",
      label: "Half-spectrum fold",
      min: 0.15,
      max: 1,
      step: 0.01,
      default: 0.66,
      unit: " turn",
      format: (value) => `${Number(value).toFixed(2)} turn`,
    },
    intensity: { label: "Phase rotation", default: 0.72 },
    limits: { maxMoments: 7, maxEvents: 7, maxDuration: 80 },
  }),
  study({
    id: "filter-hydra",
    rank: 3,
    title: "Filter Hydra",
    shortTitle: "Every band grows two heads",
    copy: {
      premise: "Every spectral branch divides into inherited low and high children.",
      cue: "Hear one noise body split into two, four, eight, and more simultaneous spectral regions.",
      sequence: "One seed → binary crossover → inherited child filters → normalized generation.",
      recursion: "Breadth-first binary filter tree",
      process: "Inherited low/high filter chains with fixed per-generation power",
      listenFor: "The same source occupying an increasingly articulated spectral skeleton.",
    },
    depth: { min: 1, max: 6, default: 5 },
    pace: { min: 2.8, max: 7, default: 5.4, step: 0.1 },
    transform: {
      id: "transform",
      label: "Crossover overlap",
      min: 0,
      max: 0.85,
      step: 0.01,
      default: 0.28,
      unit: " oct",
      format: (value) => `${Number(value).toFixed(2)} oct`,
    },
    intensity: { label: "Filter resonance", default: 0.58 },
    limits: { maxMoments: 7, maxEvents: 127, maxDuration: 70 },
  }),
  study({
    id: "cantor-delay",
    rank: 4,
    title: "Cantor Delay",
    shortTitle: "Echoes inside echoes",
    copy: {
      premise: "Each delay node emits two children after smaller fractions of its parent's wait.",
      cue: "Hear spacious echoes accumulate into a finite dust without any feedback loop running forever.",
      sequence: "Node → short child delay + long child delay → geometrically contracted descendants.",
      recursion: "Explicit binary temporal tree",
      process: "Finite feed-forward delay nodes with power-normalized generations",
      listenFor: "Large gaps containing smaller copies of their own two-part echo pattern.",
    },
    depth: { min: 1, max: 8, default: 5 },
    pace: { min: 3, max: 7, default: 5.5, step: 0.1 },
    transform: {
      id: "transform",
      label: "Child-time ratio",
      min: 0.24,
      max: 0.46,
      step: 0.01,
      default: 1 / 3,
      unit: "×",
      format: (value) => `${Number(value).toFixed(2)}×`,
    },
    intensity: { label: "Echo weight", default: 0.66 },
    limits: { maxMoments: 9, maxEvents: MAX_CANTOR_NODES, maxDuration: 75 },
  }),
  study({
    id: "convolution-maw",
    rank: 5,
    title: "Convolution Maw",
    shortTitle: "Sound convolved with itself",
    copy: {
      premise: "Each generation is convolved with itself, then cropped and normalized before recursing.",
      cue: "Listen for an impulse becoming a body, a body becoming a room, and the room becoming dense matter.",
      sequence: "Seed → self-convolve → center-crop → RMS normalize → use as the next kernel.",
      recursion: "Serial self-convolution",
      process: "Bounded FFT convolution with deterministic crop and energy normalization",
      listenFor: "Duration trying to double while the fixed window forces energy inward.",
    },
    depth: { min: 1, max: 6, default: 4 },
    pace: { min: 3.2, max: 8, default: 6, step: 0.1 },
    transform: {
      id: "transform",
      label: "Convolved signal",
      min: 0.12,
      max: 1,
      step: 0.01,
      default: 0.72,
      unit: "%",
      format: (value) => `${Math.round(Number(value) * 100)}% wet`,
    },
    intensity: { label: "Density / drive", default: 0.54 },
    limits: { maxMoments: 7, maxEvents: 7, maxDuration: 70 },
  }),
  study({
    id: "phase-labyrinth",
    rank: 6,
    title: "Phase Labyrinth",
    shortTitle: "Enter and unwind phase",
    copy: {
      premise: "Each inward generation adds one allpass chamber; the unwind removes them in reverse.",
      cue: "The spectrum stays broadly intact while attacks smear, hollow out, and then find their way home.",
      sequence: "Dry seed → nested allpass stages → deepest chamber → inverse stages in reverse order.",
      recursion: "Nested call stack of invertible allpass stages",
      process: "Short allpass delays with paired inverse stages and bounded feedback",
      listenFor: "Timing and phase changing radically while overall spectral energy remains recognizable.",
    },
    depth: { min: 1, max: 7, default: 5 },
    pace: { min: 1.8, max: 4.2, default: 3.15, step: 0.05 },
    transform: {
      id: "transform",
      label: "Allpass stage delay",
      min: 4,
      max: 36,
      step: 1,
      default: 17,
      unit: " ms",
      format: (value) => `${Math.round(value)} ms`,
    },
    intensity: { label: "Phase feedback", max: 0.95, default: 0.7 },
    limits: { maxMoments: 15, maxEvents: 15, maxDuration: 75 },
  }),
]);

const STUDIES_BY_ID = new Map(RECURSION_STUDIES.map((entry) => [entry.id, entry]));

function normalizedParams(metadata, params = {}) {
  const depth = metadata.parameters.depth;
  const pace = metadata.parameters.pace;
  const transform = metadata.parameters.transform;
  const intensity = metadata.parameters.intensity;
  const source = typeof params.source === "string" && params.source.trim()
    ? params.source.trim()
    : metadata.defaults.source;
  return {
    depth: clampInteger(params.depth, depth.min, depth.max, depth.default),
    pace: clampNumber(params.pace, pace.min, pace.max, pace.default),
    transform: clampNumber(
      params.transform,
      transform.min,
      transform.max,
      transform.default,
    ),
    intensity: clampNumber(
      params.intensity,
      intensity.min,
      intensity.max,
      intensity.default,
    ),
    source,
  };
}

function audioEvent(specification, source) {
  return {
    offset: 0,
    source,
    ...specification,
    offset: roundTime(specification.offset ?? 0),
    duration: roundTime(specification.duration),
  };
}

function semanticMoment({
  at,
  duration,
  kind,
  depth,
  label,
  path,
  events,
}) {
  const result = {
    at: roundTime(at),
    duration: roundTime(duration),
    kind,
    depth,
    label,
    events,
  };
  if (path !== undefined) result.path = path;
  return result;
}

function finishPlan(studyId, params, moments) {
  const duration = roundTime(moments.reduce(
    (latest, entry) => Math.max(latest, entry.at + entry.duration),
    0,
  ));
  return {
    studyId,
    params: { ...params },
    duration,
    moments,
  };
}

function serializedGenerationAt(generation, pace, gapRatio) {
  return generation * pace * (1 + gapRatio);
}

function ouroborosTapePlan(params) {
  const { depth, pace, transform, intensity, source } = params;
  const moments = [];

  for (let generation = 0; generation <= depth; generation += 1) {
    const progress = generation / depth;
    const transformed = generation > 0;
    const tailFold = transformed ? Math.min(0.94, transform * progress) : 0;
    const lowpassHz = transformed
      ? Math.max(360, 18_000 * (1 - intensity * 0.42) ** generation)
      : 20_000;
    moments.push(semanticMoment({
      at: serializedGenerationAt(generation, pace, 0.22),
      duration: pace,
      kind: transformed ? "generation" : "seed",
      depth: generation,
      label: transformed
        ? `Generation ${generation}: consume generation ${generation - 1}`
        : "Generation 0: dry seed buffer",
      path: Array.from({ length: generation }, (_, index) => index + 1),
      events: [
        audioEvent({
          synth: "buffer-generation",
          role: transformed ? "recursive-buffer" : "seed",
          generation,
          inputGeneration: transformed ? generation - 1 : null,
          serialized: true,
          gain: 0.36 * (1 - progress * intensity * 0.18),
          pan: (generation % 2 === 0 ? -1 : 1) * progress * transform * 0.42,
          process: {
            operation: transformed ? "consume-previous-buffer" : "seed",
            reverse: transformed && generation % 2 === 1,
            channelSwap: transformed && generation % 2 === 0,
            lowpassHz: roundTime(lowpassHz),
            tailFold: roundTime(tailFold),
            tailToHead: roundTime(tailFold * intensity),
            normalize: "rms",
            crop: "original-duration",
          },
          duration: pace * 0.86,
        }, source),
      ],
    }));
  }

  return finishPlan("ouroboros-tape", params, moments);
}

function spectralMobiusPlan(params) {
  const { depth, pace, transform, intensity, source } = params;
  const moments = [];

  for (let generation = 0; generation <= depth; generation += 1) {
    const transformed = generation > 0;
    const progress = generation / depth;
    const direction = generation % 2 === 0 ? 1 : -1;
    moments.push(semanticMoment({
      at: serializedGenerationAt(generation, pace, 0.25),
      duration: pace,
      kind: transformed ? "spectral-fold" : "seed",
      depth: generation,
      label: transformed
        ? `Generation ${generation}: spectrum makes a half-turn`
        : "Generation 0: unfurled spectrum",
      path: Array(generation).fill("fold"),
      events: [
        audioEvent({
          synth: "stft-fold-generation",
          role: transformed ? "fold" : "seed",
          generation,
          inputGeneration: transformed ? generation - 1 : null,
          serialized: true,
          gain: 0.34 * (1 - progress * intensity * 0.12),
          pan: direction * progress * transform * 0.28,
          analysis: {
            fftSize: 2048,
            hopSize: 512,
            window: "hann",
          },
          process: {
            operation: transformed ? "mobius-bin-fold" : "identity",
            mirrorUpperBins: transformed,
            fold: roundTime(transformed ? transform * progress : 0),
            phaseRotationTurns: roundTime(
              transformed ? direction * transform * intensity * generation * 0.5 : 0,
            ),
            seamBin: transformed ? Math.round(1024 * (1 - transform * 0.5)) : 1024,
            preserveMagnitude: true,
            overlapAdd: true,
          },
          duration: pace * 0.84,
        }, source),
      ],
    }));
  }

  return finishPlan("spectral-mobius", params, moments);
}

function binaryPaths(level) {
  if (level === 0) return [[]];
  return Array.from({ length: 2 ** level }, (_, index) => {
    const path = [];
    for (let bit = level - 1; bit >= 0; bit -= 1) {
      path.push((index >> bit) & 1);
    }
    return path;
  });
}

function inheritedPan(path) {
  let pan = 0;
  for (let index = 0; index < path.length; index += 1) {
    pan += (path[index] === 0 ? -1 : 1) * 0.52 * 0.56 ** index;
  }
  return Math.min(0.94, Math.max(-0.94, pan));
}

function inheritedFilterChain(path, overlap, intensity) {
  let lowHz = 45;
  let highHz = 18_000;
  return path.map((branch, index) => {
    const splitHz = Math.sqrt(lowHz * highHz);
    const overlapRatio = 2 ** (overlap * 0.5);
    let filter;
    if (branch === 0) {
      const cutoffHz = Math.min(highHz, splitHz * overlapRatio);
      highHz = cutoffHz;
      filter = {
        type: "lowpass",
        cutoffHz: roundTime(cutoffHz),
        q: roundTime(0.72 + intensity * 4.2),
      };
    } else {
      const cutoffHz = Math.max(lowHz, splitHz / overlapRatio);
      lowHz = cutoffHz;
      filter = {
        type: "highpass",
        cutoffHz: roundTime(cutoffHz),
        q: roundTime(0.72 + intensity * 4.2),
      };
    }
    return {
      ...filter,
      branchDepth: index + 1,
      inheritedBandHz: [roundTime(lowHz), roundTime(highHz)],
    };
  });
}

function filterHydraPlan(params) {
  const { depth, pace, transform, intensity, source } = params;
  const moments = [];
  const generationGain = 0.36 * intensity;

  for (let level = 0; level <= depth; level += 1) {
    const paths = binaryPaths(level);
    const voiceGain = generationGain / Math.sqrt(paths.length);
    const offsetWindow = Math.min(pace * 0.16, paths.length * 0.004);
    const offsetStep = paths.length > 1 ? offsetWindow / (paths.length - 1) : 0;
    moments.push(semanticMoment({
      at: serializedGenerationAt(level, pace, 0.2),
      duration: pace,
      kind: level === 0 ? "seed" : level === depth ? "leaf-generation" : "filter-generation",
      depth: level,
      label: level === 0
        ? "One full-band source"
        : `Depth ${level}: ${paths.length} inherited filter heads`,
      events: paths.map((path, index) => audioEvent({
        synth: "filter-branch",
        role: level === 0 ? "seed" : "filter-node",
        depth: level,
        path,
        parentPath: path.slice(0, -1),
        gain: voiceGain,
        pan: inheritedPan(path),
        offset: index * offsetStep,
        process: {
          operation: level === 0 ? "identity" : "inherited-filter-chain",
          filters: inheritedFilterChain(path, transform, intensity),
          normalizeGenerationPower: true,
        },
        duration: pace * 0.7,
      }, source)),
    }));
  }

  return finishPlan("filter-hydra", params, moments);
}

function cantorRawOffset(path, ratio) {
  let offset = 0;
  for (let level = 1; level <= path.length; level += 1) {
    offset += ratio ** level * (path[level - 1] + 1);
  }
  return offset;
}

function cantorDelayPlan(params) {
  const { depth, pace, transform: ratio, intensity, source } = params;
  const generationGain = 0.38 * intensity;
  const moments = [];
  const maximumRawOffset = cantorRawOffset(Array(depth).fill(1), ratio);
  const timeScale = pace * 0.72 / Math.max(Number.EPSILON, maximumRawOffset);

  for (let level = 0; level <= depth; level += 1) {
    const paths = binaryPaths(level);
    const nodeGain = generationGain / Math.sqrt(paths.length);
    const eventDuration = Math.max(0.04, pace * 0.09 * ratio ** (level * 0.2));
    moments.push(semanticMoment({
      at: serializedGenerationAt(level, pace, 0.18),
      duration: pace,
      kind: level === 0 ? "seed" : level === depth ? "leaf-generation" : "delay-generation",
      depth: level,
      label: level === 0
        ? "Depth 0: root impulse"
        : `Depth ${level}: ${paths.length} explicit delay nodes`,
      events: paths.map((path) => {
        const lastBranch = path.at(-1);
        const parentDelay = level
          ? timeScale * ratio ** level * (lastBranch + 1)
          : 0;
        const rawOffset = cantorRawOffset(path, ratio);
        return audioEvent({
          synth: "cantor-delay-node",
          role: level === 0 ? "seed" : "echo",
          depth: level,
          path,
          parentPath: path.slice(0, -1),
          parentDelay: roundTime(parentDelay),
          contractionRatio: ratio,
          gain: nodeGain,
          pan: inheritedPan(path) * 0.72,
          offset: rawOffset * timeScale,
          process: {
            operation: level === 0 ? "seed" : "feed-forward-delay",
            feedback: 0,
            cantorCoordinate: roundTime(rawOffset),
            timeScale: roundTime(timeScale),
            normalizedGenerationPower: true,
          },
          duration: eventDuration,
        }, source);
      }),
    }));
  }

  return finishPlan("cantor-delay", params, moments);
}

function convolutionMawPlan(params) {
  const { depth, pace, transform, intensity, source } = params;
  const moments = [];

  for (let generation = 0; generation <= depth; generation += 1) {
    const transformed = generation > 0;
    const progress = generation / depth;
    moments.push(semanticMoment({
      at: serializedGenerationAt(generation, pace, 0.26),
      duration: pace,
      kind: transformed ? "self-convolution" : "seed",
      depth: generation,
      label: transformed
        ? `Generation ${generation}: convolve generation ${generation - 1} with itself`
        : "Generation 0: unconvolved seed",
      path: Array(generation).fill("self"),
      events: [
        audioEvent({
          synth: "self-convolution-generation",
          role: transformed ? "convolution" : "seed",
          generation,
          inputGeneration: transformed ? generation - 1 : null,
          serialized: true,
          gain: 0.35 * (1 - progress * intensity * 0.16),
          process: {
            operation: transformed ? "self-convolution" : "identity",
            kernelGeneration: transformed ? generation - 1 : null,
            convolutionOrder: 2 ** generation,
            wet: transformed ? transform : 0,
            fftSize: 4096,
            crop: "center-original-duration",
            normalize: "unit-rms",
            softClip: roundTime(intensity * progress),
          },
          duration: pace * 0.86,
        }, source),
      ],
    }));
  }

  return finishPlan("convolution-maw", params, moments);
}

function allpassStage(stageNumber, delayMs, intensity) {
  return {
    stage: stageNumber,
    delayMs: roundTime(Math.min(48, delayMs * (0.72 + stageNumber * 0.14))),
    feedback: roundTime(Math.min(0.92, 0.12 + intensity * 0.7 * 0.94 ** (stageNumber - 1))),
    polarity: stageNumber % 2 === 0 ? -1 : 1,
  };
}

function phaseLabyrinthPlan(params) {
  const { depth, pace, transform: delayMs, intensity, source } = params;
  const stages = Array.from(
    { length: depth },
    (_, index) => allpassStage(index + 1, delayMs, intensity),
  );
  const moments = [];
  const spacing = pace * 1.18;

  for (let level = 0; level <= depth; level += 1) {
    const seed = level === 0;
    const stage = seed ? null : stages[level - 1];
    moments.push(semanticMoment({
      at: level * spacing,
      duration: pace,
      kind: seed ? "seed" : level === depth ? "center" : "enter",
      depth: level,
      label: seed
        ? "Dry entrance"
        : level === depth
          ? `Center: ${level} nested allpass stages`
          : `Enter stage ${level}`,
      path: Array.from({ length: level }, (_, index) => index + 1),
      events: [
        audioEvent({
          synth: "allpass-generation",
          role: seed ? "seed" : "enter",
          generation: level,
          inputGeneration: seed ? null : level - 1,
          serialized: true,
          gain: 0.35,
          process: {
            operation: seed ? "identity" : "append-allpass",
            stage,
            chain: stages.slice(0, level),
            chainLength: level,
            inverse: false,
          },
          duration: pace * 0.82,
        }, source),
      ],
    }));
  }

  for (let unwindIndex = 0; unwindIndex < depth; unwindIndex += 1) {
    const level = depth - unwindIndex - 1;
    const removedStage = stages[level];
    moments.push(semanticMoment({
      at: (depth + 1 + unwindIndex) * spacing,
      duration: pace,
      kind: "unwind",
      depth: level,
      label: `Unwind stage ${level + 1}`,
      path: Array.from({ length: level }, (_, index) => index + 1),
      events: [
        audioEvent({
          synth: "allpass-generation",
          role: "unwind",
          generation: depth + unwindIndex + 1,
          inputGeneration: depth + unwindIndex,
          serialized: true,
          gain: 0.35,
          process: {
            operation: "invert-allpass",
            stage: removedStage,
            chain: stages.slice(0, level),
            chainLength: level,
            inverse: true,
          },
          duration: pace * 0.82,
        }, source),
      ],
    }));
  }

  return finishPlan("phase-labyrinth", params, moments);
}

const BUILDERS = Object.freeze({
  "ouroboros-tape": ouroborosTapePlan,
  "spectral-mobius": spectralMobiusPlan,
  "filter-hydra": filterHydraPlan,
  "cantor-delay": cantorDelayPlan,
  "convolution-maw": convolutionMawPlan,
  "phase-labyrinth": phaseLabyrinthPlan,
});

/**
 * Build a finite structural score. Event offsets are relative to their
 * containing moment; moment times are relative to the beginning of the plan.
 * The module describes buffer and graph work but intentionally performs no DSP.
 */
export function buildRecursionPlan(studyId, params = {}) {
  const metadata = STUDIES_BY_ID.get(studyId);
  if (!metadata) throw new RangeError(`Unknown recursion study: ${studyId}`);
  return BUILDERS[studyId](normalizedParams(metadata, params));
}

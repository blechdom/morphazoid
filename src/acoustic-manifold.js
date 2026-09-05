import {
  analyzeBirdsong,
  renderBirdsongModel,
} from "./birdsong-analysis.js";
import {
  analyzeCricketSong,
  createDemoCricketSong,
  renderCricketModel,
} from "./crickets.js";
import {
  analyzeNightingaleSequence,
  createDemoNightingaleSequence,
  nightingaleManifoldExport,
} from "./nightingale-manifold.js";
import {
  ACOUSTIC_PROFILES,
} from "./acoustic-profiles.js";
import {
  ACOUSTIC_BUILT_IN_SOURCES,
  getAcousticBuiltInSource,
} from "./acoustic-source-catalog.js";

export { ACOUSTIC_PROFILE_GROUPS, ACOUSTIC_PROFILES } from "./acoustic-profiles.js";
export {
  ACOUSTIC_ARCHIVE_COLLECTIONS,
  ACOUSTIC_ARCHIVE_GROUPS,
  ACOUSTIC_BUILT_IN_SOURCE_GROUPS,
  ACOUSTIC_BUILT_IN_SOURCES,
  getAcousticBuiltInSource,
} from "./acoustic-source-catalog.js";

const TWO_PI = Math.PI * 2;
const DEFAULT_SAMPLE_RATE = 48_000;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 576_000;
const DEFAULT_MAX_DURATION_SECONDS = 120;
const MAX_SPECTRAL_HZ = Math.floor(MAX_SAMPLE_RATE * 0.48);
const ANALYSIS_FRAME_SIZES = Object.freeze([64, 128, 256, 512, 1_024, 2_048, 4_096]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

export const ACOUSTIC_RESYNTHESIS_LIMITS = Object.freeze({
  speedRatio: Object.freeze({ minimum: 0.125, maximum: 8, default: 1 }),
  pitchShiftSemitones: Object.freeze({ minimum: -48, maximum: 48, default: 0 }),
  bodyScale: Object.freeze({ minimum: 0.25, maximum: 4, default: 1 }),
  textureAmount: Object.freeze({ minimum: 0, maximum: 4, default: 1 }),
  manifoldExaggeration: Object.freeze({ minimum: 1, maximum: 4, default: 1 }),
  gapSeconds: Object.freeze({ minimum: 0, maximum: 0.75, default: 0.09 }),
});

export const ACOUSTIC_ANALYSIS_LIMITS = Object.freeze({
  spectralHz: Object.freeze({ minimum: 1, maximum: MAX_SPECTRAL_HZ }),
  analysisTargetRate: Object.freeze({ minimum: MIN_SAMPLE_RATE, maximum: MAX_SAMPLE_RATE }),
  frameSizes: ANALYSIS_FRAME_SIZES,
  fixedWindowSeconds: Object.freeze({ minimum: 0, maximum: 120 }),
  fixedWindowOverlap: Object.freeze({ minimum: 0, maximum: 0.95 }),
  minimumWindowActiveRatio: Object.freeze({ minimum: 0, maximum: 1 }),
  sequenceGapSeconds: Object.freeze({ minimum: 0, maximum: 600 }),
  neighborCount: Object.freeze({ minimum: 1, maximum: 12, default: 3 }),
  maximumFrameCount: 120_000,
  maximumFftWorkUnits: 120_000,
});

function normalizedResynthesisValue(settings, name) {
  const limits = ACOUSTIC_RESYNTHESIS_LIMITS[name];
  return clamp(finite(settings?.[name], limits.default), limits.minimum, limits.maximum);
}

/** Stable, bounded controls for artistic model extrapolation. */
export function normalizeAcousticResynthesis(settings = {}) {
  const normalized = {
    speedRatio: normalizedResynthesisValue(settings, "speedRatio"),
    pitchShiftSemitones: normalizedResynthesisValue(settings, "pitchShiftSemitones"),
    bodyScale: normalizedResynthesisValue(settings, "bodyScale"),
    textureAmount: normalizedResynthesisValue(settings, "textureAmount"),
    manifoldExaggeration: normalizedResynthesisValue(settings, "manifoldExaggeration"),
    gapSeconds: normalizedResynthesisValue(settings, "gapSeconds"),
  };
  normalized.transformed = normalized.speedRatio !== 1
    || normalized.pitchShiftSemitones !== 0
    || normalized.bodyScale !== 1
    || normalized.textureAmount !== 1
    || normalized.manifoldExaggeration !== 1
    || normalized.gapSeconds !== ACOUSTIC_RESYNTHESIS_LIMITS.gapSeconds.default;
  normalized.mode = normalized.transformed
    ? "artistic-extrapolation"
    : "analysis-derived-anchor";
  if (settings?.mapPositionNormalized && settings?.mapOffsets) {
    normalized.mapPositionNormalized = Object.freeze({
      x: clamp(finite(settings.mapPositionNormalized.x), -1, 1),
      y: clamp(finite(settings.mapPositionNormalized.y), -1, 1),
      z: clamp(finite(settings.mapPositionNormalized.z), -1, 1),
    });
    normalized.mapOffsets = Object.freeze({
      pitchSemitones: finite(settings.mapOffsets.pitchSemitones),
      speedRatio: Math.max(0, finite(settings.mapOffsets.speedRatio, 1)),
      textureRatio: Math.max(0, finite(settings.mapOffsets.textureRatio, 1)),
    });
    normalized.mapping = "PC1 → pitch, PC2 → texture, PC3 → gesture speed";
    normalized.biologicalLimitClaimed = false;
  }
  return Object.freeze(normalized);
}

function normalizedPositionAxis(analysis, occurrence, axis) {
  const maximum = Math.max(
    1e-9,
    ...(analysis?.strophes ?? []).map((entry) => Math.abs(finite(entry?.position?.[axis]))),
  );
  return clamp(finite(occurrence?.position?.[axis]) / maximum, -1, 1);
}

/**
 * Maps PCA position into extra pitch, texture, and time offsets. The mapping is
 * deliberately artistic: PCA axis signs and meanings are dataset-dependent.
 */
export function acousticResynthesisForOccurrence(
  analysis,
  occurrenceOrIndex,
  settings = {},
) {
  const base = normalizeAcousticResynthesis(settings);
  const occurrence = typeof occurrenceOrIndex === "number"
    ? analysis?.strophes?.[occurrenceOrIndex]
    : occurrenceOrIndex;
  const position = Object.freeze({
    x: normalizedPositionAxis(analysis, occurrence, "x"),
    y: normalizedPositionAxis(analysis, occurrence, "y"),
    z: normalizedPositionAxis(analysis, occurrence, "z"),
  });
  const excess = base.manifoldExaggeration - 1;
  const mapPitchSemitones = position.x * excess * 12;
  const mapSpeedRatio = 2 ** (position.z * excess);
  const mapTextureRatio = 2 ** (position.y * excess);
  return Object.freeze({
    ...base,
    speedRatio: clamp(
      base.speedRatio * mapSpeedRatio,
      ACOUSTIC_RESYNTHESIS_LIMITS.speedRatio.minimum,
      ACOUSTIC_RESYNTHESIS_LIMITS.speedRatio.maximum,
    ),
    pitchShiftSemitones: clamp(
      base.pitchShiftSemitones + mapPitchSemitones,
      ACOUSTIC_RESYNTHESIS_LIMITS.pitchShiftSemitones.minimum,
      ACOUSTIC_RESYNTHESIS_LIMITS.pitchShiftSemitones.maximum,
    ),
    textureAmount: clamp(
      base.textureAmount * mapTextureRatio,
      ACOUSTIC_RESYNTHESIS_LIMITS.textureAmount.minimum,
      ACOUSTIC_RESYNTHESIS_LIMITS.textureAmount.maximum,
    ),
    mapPositionNormalized: position,
    mapOffsets: Object.freeze({
      pitchSemitones: mapPitchSemitones,
      speedRatio: mapSpeedRatio,
      textureRatio: mapTextureRatio,
    }),
    mapping: "PC1 → pitch, PC2 → texture, PC3 → gesture speed",
    biologicalLimitClaimed: false,
  });
}

function samplePeak(samples) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(finite(samples[index])));
  }
  return peak;
}

function sampleRms(samples) {
  if (!samples.length) return 0;
  let square = 0;
  for (let index = 0; index < samples.length; index += 1) {
    square += finite(samples[index]) ** 2;
  }
  return Math.sqrt(square / samples.length);
}

function eventIdFor(selectedProfile, index) {
  const prefix = selectedProfile.eventIdPrefix ?? "E";
  return `${prefix}${String(index + 1).padStart(3, "0")}`;
}

export function getAcousticProfile(profileId = "general") {
  const id = typeof profileId === "object" && profileId
    ? profileId.id
      ?? profileId.profileId
      ?? (typeof profileId.profile === "string" ? profileId.profile : profileId.profile?.id)
      ?? "general"
    : profileId;
  const resolved = ACOUSTIC_PROFILES[id];
  if (!resolved) {
    throw new RangeError(`Unknown acoustic profile "${id}"`);
  }
  return resolved;
}

function normalizedFrameSize(value, fallback) {
  const requested = clamp(
    Math.round(finite(value, fallback)),
    ANALYSIS_FRAME_SIZES[0],
    ANALYSIS_FRAME_SIZES.at(-1),
  );
  return 2 ** Math.round(Math.log2(requested));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizedSequenceGap(options, fallback) {
  if (!hasOwn(options, "sequenceGapSeconds")) return fallback;
  if (options.sequenceGapSeconds === null || options.sequenceGapSeconds === "") return null;
  return clamp(
    finite(options.sequenceGapSeconds, fallback ?? 0),
    ACOUSTIC_ANALYSIS_LIMITS.sequenceGapSeconds.minimum,
    ACOUSTIC_ANALYSIS_LIMITS.sequenceGapSeconds.maximum,
  );
}

/**
 * Normalize the listener-adjustable analysis prior before it reaches the DSP.
 * The returned values are requested analysis settings; source-rate limits are
 * reported separately by analyzeAcousticSequence after decoding.
 */
export function normalizeAcousticAnalysisParameters(profileOrId = "general", options = {}) {
  const selected = getAcousticProfile(profileOrId);
  const profileDefaults = selected.analysisDefaults;
  const minimumSpectralHz = clamp(
    finite(options.minimumSpectralHz, selected.minimumSpectralHz),
    ACOUSTIC_ANALYSIS_LIMITS.spectralHz.minimum,
    ACOUSTIC_ANALYSIS_LIMITS.spectralHz.maximum - 1,
  );
  const maximumSpectralHz = clamp(
    finite(options.maximumSpectralHz, selected.maximumSpectralHz),
    minimumSpectralHz + 1,
    ACOUSTIC_ANALYSIS_LIMITS.spectralHz.maximum,
  );
  const frameSize = normalizedFrameSize(options.frameSize, profileDefaults.frameSize);
  const hopSize = Math.round(clamp(
    finite(options.hopSize, profileDefaults.hopSize),
    1,
    frameSize,
  ));
  const fixedWindowSeconds = clamp(
    finite(options.fixedWindowSeconds, profileDefaults.fixedWindowSeconds),
    ACOUSTIC_ANALYSIS_LIMITS.fixedWindowSeconds.minimum,
    ACOUSTIC_ANALYSIS_LIMITS.fixedWindowSeconds.maximum,
  );
  const requestedMinimumStropheSeconds = clamp(
    finite(options.minimumStropheSeconds, selected.minimumStropheSeconds),
    Math.max(0.0001, profileDefaults.minimumDurationLimitSeconds),
    profileDefaults.maximumDurationLimitSeconds,
  );
  return Object.freeze({
    stropheGapSeconds: clamp(
      finite(options.stropheGapSeconds, selected.stropheGapSeconds),
      profileDefaults.minimumGapLimitSeconds,
      profileDefaults.maximumGapLimitSeconds,
    ),
    minimumStropheSeconds: fixedWindowSeconds > 0
      ? Math.min(requestedMinimumStropheSeconds, fixedWindowSeconds * 0.5)
      : requestedMinimumStropheSeconds,
    minimumSpectralHz,
    maximumSpectralHz,
    maxDurationSeconds: clamp(
      finite(options.maxDurationSeconds, selected.maxDurationSeconds),
      1,
      DEFAULT_MAX_DURATION_SECONDS,
    ),
    analysisTargetRate: Math.round(clamp(
      finite(options.analysisTargetRate, profileDefaults.analysisTargetRate),
      ACOUSTIC_ANALYSIS_LIMITS.analysisTargetRate.minimum,
      ACOUSTIC_ANALYSIS_LIMITS.analysisTargetRate.maximum,
    )),
    frameSize,
    hopSize,
    minimumGapLimitSeconds: profileDefaults.minimumGapLimitSeconds,
    maximumGapLimitSeconds: profileDefaults.maximumGapLimitSeconds,
    minimumDurationLimitSeconds: profileDefaults.minimumDurationLimitSeconds,
    maximumDurationLimitSeconds: profileDefaults.maximumDurationLimitSeconds,
    fixedWindowSeconds,
    fixedWindowOverlap: clamp(
      finite(options.fixedWindowOverlap, profileDefaults.fixedWindowOverlap),
      ACOUSTIC_ANALYSIS_LIMITS.fixedWindowOverlap.minimum,
      ACOUSTIC_ANALYSIS_LIMITS.fixedWindowOverlap.maximum,
    ),
    minimumWindowActiveRatio: clamp(
      finite(options.minimumWindowActiveRatio, profileDefaults.minimumWindowActiveRatio),
      ACOUSTIC_ANALYSIS_LIMITS.minimumWindowActiveRatio.minimum,
      ACOUSTIC_ANALYSIS_LIMITS.minimumWindowActiveRatio.maximum,
    ),
    sequenceGapSeconds: normalizedSequenceGap(options, profileDefaults.sequenceGapSeconds),
    neighborCount: Math.round(clamp(
      finite(
        options.neighborCount,
        ACOUSTIC_ANALYSIS_LIMITS.neighborCount.default,
      ),
      ACOUSTIC_ANALYSIS_LIMITS.neighborCount.minimum,
      ACOUSTIC_ANALYSIS_LIMITS.neighborCount.maximum,
    )),
  });
}

export function createAcousticDemo(
  sourceId = "thrush-nightingale-synthetic",
  sampleRate = DEFAULT_SAMPLE_RATE,
) {
  // Mirror the existing demo helpers' convenient sample-rate-only form.
  if (typeof sourceId === "number") {
    sampleRate = sourceId;
    sourceId = "thrush-nightingale-synthetic";
  }
  const sourceMetadata = getAcousticBuiltInSource(sourceId);
  if (sourceMetadata.kind !== "procedural") {
    throw new RangeError(`Built-in source "${sourceId}" is a recording and must be decoded from assetPath`);
  }
  const demo = sourceMetadata.generator === "field-cricket"
    ? createDemoCricketSong(sampleRate, "field-chirps")
    : createDemoNightingaleSequence(sampleRate);
  return Object.freeze({
    ...demo,
    sourceId: sourceMetadata.id,
    profileId: sourceMetadata.profileId,
    sourceMetadata,
  });
}

function resolveProfileAndOptions(profileOrOptions, additionalOptions = {}) {
  if (typeof profileOrOptions === "string" || profileOrOptions === undefined) {
    return {
      profile: getAcousticProfile(profileOrOptions ?? "general"),
      options: additionalOptions ?? {},
    };
  }
  if (!profileOrOptions || typeof profileOrOptions !== "object") {
    throw new TypeError("Choose an acoustic profile id or options object");
  }
  const profileId = profileOrOptions.profileId
    ?? (typeof profileOrOptions.profile === "string" ? profileOrOptions.profile : profileOrOptions.profile?.id)
    ?? "general";
  return {
    profile: getAcousticProfile(profileId),
    options: { ...profileOrOptions, ...additionalOptions },
  };
}

function profileWarning(warning, selected) {
  if (typeof warning !== "string" || selected.id === "songbird") return warning;
  return warning
    .replaceAll("strophes", selected.eventPlural)
    .replaceAll("Strophes", `${selected.eventPlural[0].toUpperCase()}${selected.eventPlural.slice(1)}`)
    .replaceAll("strophe", selected.eventSingular)
    .replaceAll("Strophe", `${selected.eventSingular[0].toUpperCase()}${selected.eventSingular.slice(1)}`);
}

/**
 * Run the same frame/PCA/event graph for any supported profile. Profile names
 * select priors only; no taxonomic recognition is performed.
 */
export function analyzeAcousticSequence(
  samples,
  sampleRate = DEFAULT_SAMPLE_RATE,
  profileOrOptions = "general",
  additionalOptions = {},
) {
  if (!samples || !Number.isSafeInteger(samples.length) || samples.length < 256) {
    throw new TypeError("Choose a non-empty acoustic recording");
  }
  const resolved = resolveProfileAndOptions(profileOrOptions, additionalOptions);
  const { profile: selected, options } = resolved;
  const requestedDefaults = normalizeAcousticAnalysisParameters(selected, options);
  const analyzedSampleCount = Math.min(
    samples.length,
    Math.floor(sampleRate * requestedDefaults.maxDurationSeconds),
  );
  const estimatedAnalysisRate = Math.min(sampleRate, requestedDefaults.analysisTargetRate);
  const estimatedFrameCount = Math.max(
    1,
    Math.floor(
      (analyzedSampleCount * estimatedAnalysisRate / sampleRate - requestedDefaults.frameSize)
      / requestedDefaults.hopSize,
    ) + 1,
  );
  const fftWorkPerFrame = Math.max(
    1,
    requestedDefaults.frameSize * Math.log2(requestedDefaults.frameSize) / (512 * 9),
  );
  const estimatedFftWorkUnits = Math.ceil(estimatedFrameCount * fftWorkPerFrame);
  if (estimatedFrameCount > ACOUSTIC_ANALYSIS_LIMITS.maximumFrameCount) {
    throw new RangeError(
      `This resolution would create about ${estimatedFrameCount.toLocaleString()} analysis frames; choose a larger frame step or a lower analysis-rate ceiling (limit ${ACOUSTIC_ANALYSIS_LIMITS.maximumFrameCount.toLocaleString()}).`,
    );
  }
  if (estimatedFftWorkUnits > ACOUSTIC_ANALYSIS_LIMITS.maximumFftWorkUnits) {
    throw new RangeError(
      `This frame count and FFT size would create about ${estimatedFftWorkUnits.toLocaleString()} weighted FFT work units; choose a smaller FFT frame, a larger frame step, or a lower analysis-rate ceiling (limit ${ACOUSTIC_ANALYSIS_LIMITS.maximumFftWorkUnits.toLocaleString()}).`,
    );
  }
  const graph = analyzeNightingaleSequence(samples, sampleRate, {
    ...options,
    ...requestedDefaults,
  });
  const segmentationMode = graph.segmentation.mode
    ?? (requestedDefaults.fixedWindowSeconds > 0 ? "fixed-window" : "pause-bounded");
  const fixedWindowMode = segmentationMode === "fixed-window";
  const fixedWindowSeconds = graph.segmentation.fixedWindowSeconds
    ?? requestedDefaults.fixedWindowSeconds;
  const fixedWindowOverlap = graph.segmentation.fixedWindowOverlap
    ?? requestedDefaults.fixedWindowOverlap;
  const eventDefinition = fixedWindowMode
    ? `one ${fixedWindowSeconds}-second analysis window with ${Math.round(fixedWindowOverlap * 100)}% overlap, retained when at least ${Math.round(requestedDefaults.minimumWindowActiveRatio * 100)}% is active`
    : `one active ${selected.eventSingular} occurrence bounded by a pause longer than ${graph.segmentation.stropheGapSeconds ?? requestedDefaults.stropheGapSeconds} seconds; shorter internal gaps are joined and occurrences under ${graph.segmentation.minimumStropheSeconds ?? requestedDefaults.minimumStropheSeconds} seconds are discarded`;
  const segmentation = Object.freeze({
    ...graph.segmentation,
    mode: segmentationMode,
    fixedWindowSeconds: fixedWindowMode ? fixedWindowSeconds : 0,
    fixedWindowOverlap: fixedWindowMode ? fixedWindowOverlap : 0,
    stropheGapSeconds: fixedWindowMode
      ? null
      : graph.segmentation.stropheGapSeconds ?? requestedDefaults.stropheGapSeconds,
    minimumStropheSeconds: graph.segmentation.minimumStropheSeconds ?? requestedDefaults.minimumStropheSeconds,
    operationalDefinition: eventDefinition,
    eventTerm: selected.eventSingular,
    sequenceGapSeconds: requestedDefaults.sequenceGapSeconds,
  });
  const effective = Object.freeze({
    ...requestedDefaults,
    stropheGapSeconds: segmentation.stropheGapSeconds,
    minimumStropheSeconds: segmentation.minimumStropheSeconds,
    minimumSpectralHz: graph.spectralRange?.minimumHz ?? requestedDefaults.minimumSpectralHz,
    maximumSpectralHz: graph.spectralRange?.maximumHz ?? requestedDefaults.maximumSpectralHz,
    analysisTargetRate: requestedDefaults.analysisTargetRate,
    analysisSampleRate: graph.analysisSampleRate,
    frameSize: graph.frameSize,
    hopSize: graph.hopSize,
    neighborCount: graph.similarity?.neighborCount ?? 0,
  });
  const defaultParameters = normalizeAcousticAnalysisParameters(selected);
  const comparableKeys = [
    "minimumSpectralHz",
    "maximumSpectralHz",
    "minimumStropheSeconds",
    "stropheGapSeconds",
    "maxDurationSeconds",
    "fixedWindowSeconds",
    "fixedWindowOverlap",
    "minimumWindowActiveRatio",
    "sequenceGapSeconds",
    "analysisTargetRate",
    "frameSize",
    "hopSize",
    "neighborCount",
  ];
  const tunedFields = Object.freeze(comparableKeys.filter(
    (key) => requestedDefaults[key] !== defaultParameters[key],
  ));
  const analysisProfile = Object.freeze({
    id: selected.id,
    label: selected.label,
    eventSingular: selected.eventSingular,
    eventPlural: selected.eventPlural,
    eventIdPrefix: selected.eventIdPrefix,
    eventDurationRangeSeconds: selected.eventDurationRangeSeconds,
    withinEventGapSeconds: fixedWindowMode ? null : segmentation.stropheGapSeconds,
    sequenceGapSeconds: requestedDefaults.sequenceGapSeconds,
    defaultWithinEventGapSeconds: selected.withinEventGapSeconds,
    defaultSequenceGapSeconds: selected.sequenceGapSeconds,
    defaults: selected.analysisDefaults,
    requested: requestedDefaults,
    effective,
    synthesis: selected.synthesis,
    category: selected.category,
    basis: selected.basis,
    evidence: selected.evidence,
    recording: selected.recording,
    expectedFocus: selected.expectedFocus,
    segmentationMode,
    defaultSegmentationMode: selected.segmentationMode,
    operationalDefinition: eventDefinition,
    defaultOperationalDefinition: selected.operationalDefinition,
    parameterMode: tunedFields.length ? "listener-tuned" : "profile-defaults",
    tunedFields,
  });
  let sequenceGroup = 1;
  const events = Object.freeze(graph.strophes.map((occurrence, index) => {
    const previous = graph.strophes[index - 1];
    if (
      previous
      && Number.isFinite(requestedDefaults.sequenceGapSeconds)
      && occurrence.startSeconds - previous.endSeconds > requestedDefaults.sequenceGapSeconds
    ) sequenceGroup += 1;
    const eventId = eventIdFor(selected, index);
    const tones = Object.freeze((occurrence.tones ?? []).map((tone) => Object.freeze({
      ...tone,
      parentEventId: eventId,
      parentStropheId: occurrence.id,
    })));
    return Object.freeze({
      ...occurrence,
      id: eventId,
      eventId,
      legacyStropheId: occurrence.id,
      sequenceGroup,
      tones,
    });
  }));
  const tones = Object.freeze(events.flatMap((event) => event.tones));
  const sequenceEdges = Object.freeze(graph.sequenceEdges.map((edge) => {
    const source = events[edge.source];
    const target = events[edge.target];
    const gapSeconds = Math.max(0, finite(target?.startSeconds) - finite(source?.endSeconds));
    return Object.freeze({
      ...edge,
      gapSeconds,
      withinConfiguredSequence: Number.isFinite(requestedDefaults.sequenceGapSeconds)
        ? gapSeconds <= requestedDefaults.sequenceGapSeconds
        : null,
    });
  }));
  const requestedMaximumHz = graph.spectralCoverage?.requestedMaximumHz
    ?? requestedDefaults.maximumSpectralHz;
  const sourceMaximumHz = graph.sampleRate * 0.48;
  const analysisRateMaximumHz = graph.analysisSampleRate * 0.48;
  const sourceBandAvailable = sourceMaximumHz >= requestedMaximumHz * 0.995;
  const analysisRateBandAvailable = analysisRateMaximumHz >= requestedMaximumHz * 0.995;
  const fullRequestedBandAvailable = sourceBandAvailable && analysisRateBandAvailable;
  const limitingFactor = fullRequestedBandAvailable
    ? null
    : sourceBandAvailable
      ? "analysis-rate-ceiling"
      : "source-sample-rate";
  const bandLimitWarning = fullRequestedBandAvailable
    ? null
    : limitingFactor === "analysis-rate-ceiling"
      ? `The selected analysis-rate ceiling truncates the requested feature band at ${Math.round(graph.spectralRange.maximumHz).toLocaleString()} Hz.`
      : `The source sample rate truncates the requested feature band at ${Math.round(graph.spectralRange.maximumHz).toLocaleString()} Hz.`;
  return Object.freeze({
    ...graph,
    format: "morphazoid-acoustic-manifold-analysis",
    strophes: events,
    events,
    tones,
    sequenceEdges,
    warning: [
      profileWarning(graph.warning, selected),
      bandLimitWarning,
    ].filter(Boolean).join(" "),
    profileId: selected.id,
    profile: analysisProfile,
    segmentation,
    classification: Object.freeze({
      performed: false,
      note: "The profile was selected by the listener; this analysis does not identify a species or source class.",
    }),
    inputCompatibility: Object.freeze({
      fullRequestedBandAvailable,
      sourceBandAvailable,
      analysisRateBandAvailable,
      limitingFactor,
      sourceSampleRate: graph.sampleRate,
      analysisSampleRate: graph.analysisSampleRate,
      requestedMaximumHz,
      availableMaximumHz: graph.spectralCoverage?.availableMaximumHz
        ?? graph.analysisSampleRate * 0.48,
      recommendedSampleRate: selected.recording.recommendedSampleRate,
      note: fullRequestedBandAvailable
        ? selected.recording.sourceRateNote
        : limitingFactor === "analysis-rate-ceiling"
          ? `The ${Math.round(requestedDefaults.analysisTargetRate / 1_000)} kHz analysis-rate ceiling limits features to ${Math.round(graph.spectralRange.maximumHz).toLocaleString()} Hz; raise it to use more of the loaded source.`
          : `The loaded ${Math.round(graph.sampleRate / 1_000)} kHz source cannot contain the full requested feature band; analysis is limited to ${Math.round(graph.spectralRange.maximumHz).toLocaleString()} Hz.`,
    }),
    multiscale: Object.freeze({
      method: "three fixed-window amplitude-envelope summaries per event",
      isMultifractalAnalysis: false,
      note: "No generalized Hurst exponents or multifractal spectrum are estimated.",
    }),
    inferenceLimits: selected.inferenceLimits,
  });
}

function seededRandom(seed) {
  let state = (Math.floor(finite(seed, 0x41434f55)) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function fadeAndNormalize(samples, sampleRate, targetPeak = 0.78) {
  const peak = samplePeak(samples);
  const gain = peak > 1e-9 ? Math.min(16, targetPeak / peak) : 0;
  const fadeLength = Math.min(
    Math.floor(samples.length / 2),
    Math.max(1, Math.round(sampleRate * 0.008)),
  );
  for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
  for (let index = 0; index < fadeLength; index += 1) {
    const fade = Math.sin((index + 0.5) / fadeLength * Math.PI * 0.5) ** 2;
    samples[index] *= fade;
    samples[samples.length - 1 - index] *= fade;
  }
  return samples;
}

function coarseEnvelope(samples, sampleRate) {
  const frameSize = Math.max(32, Math.round(sampleRate * 0.012));
  const frameCount = Math.max(1, Math.ceil(samples.length / frameSize));
  const frames = new Float64Array(frameCount);
  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) mean += finite(samples[index]);
  mean /= Math.max(1, samples.length);
  let maximum = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameSize;
    const end = Math.min(samples.length, start + frameSize);
    let square = 0;
    for (let index = start; index < end; index += 1) {
      square += (finite(samples[index]) - mean) ** 2;
    }
    frames[frame] = Math.sqrt(square / Math.max(1, end - start));
    maximum = Math.max(maximum, frames[frame]);
  }
  if (maximum > 1e-9) {
    for (let index = 0; index < frames.length; index += 1) frames[index] /= maximum;
  }
  return { frames, frameSize, peak: maximum };
}

function zeroCrossingFrequency(samples, sampleRate) {
  if (samples.length < 2) return 0;
  let mean = 0;
  for (let index = 0; index < samples.length; index += 1) mean += finite(samples[index]);
  mean /= samples.length;
  let crossings = 0;
  let previous = finite(samples[0]) - mean;
  for (let index = 1; index < samples.length; index += 1) {
    const current = finite(samples[index]) - mean;
    if ((current >= 0) !== (previous >= 0)) crossings += 1;
    previous = current;
  }
  return crossings * sampleRate / Math.max(1, 2 * (samples.length - 1));
}

function renderNeutralModel(samples, sampleRate, selected, descriptor, options = {}) {
  const sourceSampleCount = Math.min(
    samples.length,
    Math.max(32, Math.floor(sampleRate * selected.maxDurationSeconds)),
  );
  const source = samples.length === sourceSampleCount
    ? samples
    : samples.slice(0, sourceSampleCount);
  const resynthesis = normalizeAcousticResynthesis(options.resynthesis ?? options);
  const maximumOutputSeconds = clamp(finite(options.maximumOutputSeconds, 30), 1, 120);
  const requestedOutputSampleCount = Math.max(
    32,
    Math.round(sourceSampleCount / resynthesis.speedRatio),
  );
  const maximumOutputSampleCount = Math.max(
    sourceSampleCount,
    Math.round(sampleRate * maximumOutputSeconds),
  );
  const outputSampleCount = Math.min(requestedOutputSampleCount, maximumOutputSampleCount);
  const effectiveSpeedRatio = sourceSampleCount / outputSampleCount;
  const timeWarpLimited = outputSampleCount < requestedOutputSampleCount;
  const output = new Float32Array(outputSampleCount);
  const envelope = coarseEnvelope(source, sampleRate);
  const analysisMinimumSpectralHz = clamp(
    finite(options.minimumSpectralHz, selected.minimumSpectralHz),
    1,
    sampleRate * 0.48 - 1,
  );
  const sourceSpectralMaximum = Math.min(
    Math.max(
      analysisMinimumSpectralHz + 1,
      finite(options.maximumSpectralHz, selected.maximumSpectralHz),
    ),
    sampleRate * 0.48,
  );
  const audibleMaximum = Math.min(11_000, sampleRate * 0.42);
  const inferredFrequency = finite(
    descriptor?.medianPeakHz,
    finite(descriptor?.meanCentroidHz, zeroCrossingFrequency(source, sampleRate)),
  );
  const sourceBaseFrequencyHz = clamp(
    inferredFrequency || Math.max(20, analysisMinimumSpectralHz * 2),
    analysisMinimumSpectralHz,
    Math.max(analysisMinimumSpectralHz, sourceSpectralMaximum * 0.82),
  );
  const profileFrequencyScale = clamp(
    finite(options.frequencyScale, selected.synthesis.frequencyScale ?? 1),
    0.001,
    100,
  );
  const pitchRatio = 2 ** (resynthesis.pitchShiftSemitones / 12);
  const frequencyScale = clamp(
    profileFrequencyScale * pitchRatio / resynthesis.bodyScale,
    0.001,
    100,
  );
  const baseFrequencyHz = clamp(
    finite(options.baseFrequencyHz, sourceBaseFrequencyHz * frequencyScale),
    30,
    Math.max(60, audibleMaximum * 0.72),
  );
  const bandwidthRatio = clamp(
    finite(descriptor?.meanBandwidthHz, baseFrequencyHz * 0.7) / Math.max(40, baseFrequencyHz),
    0.12,
    2.4,
  );
  const flatness = clamp(
    finite(descriptor?.meanFlatness, 0.08) * resynthesis.textureAmount,
  );
  const modeFrequenciesHz = Object.freeze([
    baseFrequencyHz,
    clamp(baseFrequencyHz * (1.48 + bandwidthRatio * 0.09), 35, audibleMaximum),
    clamp(baseFrequencyHz * (2.08 + bandwidthRatio * 0.16), 35, audibleMaximum),
  ]);
  const modeWeights = [0.7, 0.21, 0.09];
  const phases = modeFrequenciesHz.map((_, index) => index * 0.61);
  const random = seededRandom(options.seed);
  let shapedEnvelope = 0;
  const attack = 1 - Math.exp(-1 / Math.max(1, sampleRate * 0.008));
  const release = 1 - Math.exp(-1 / Math.max(1, sampleRate * 0.035));
  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = Math.min(source.length - 1, index * effectiveSpeedRatio);
    const framePosition = sourceIndex / envelope.frameSize;
    const leftIndex = Math.min(envelope.frames.length - 1, Math.floor(framePosition));
    const rightIndex = Math.min(envelope.frames.length - 1, leftIndex + 1);
    const mix = framePosition - Math.floor(framePosition);
    const targetEnvelope = envelope.frames[leftIndex]
      + (envelope.frames[rightIndex] - envelope.frames[leftIndex]) * mix;
    shapedEnvelope += (targetEnvelope - shapedEnvelope)
      * (targetEnvelope > shapedEnvelope ? attack : release);
    let tonal = 0;
    for (let mode = 0; mode < modeFrequenciesHz.length; mode += 1) {
      const drift = 1 + 0.004 * resynthesis.textureAmount
        * Math.sin(TWO_PI * (0.21 + mode * 0.13) * index / sampleRate);
      phases[mode] += TWO_PI * modeFrequenciesHz[mode] * drift / sampleRate;
      tonal += Math.sin(phases[mode]) * modeWeights[mode];
    }
    const noise = random() * 2 - 1;
    output[index] = shapedEnvelope ** 0.72 * (tonal * (1 - flatness * 0.22) + noise * flatness * 0.12);
  }
  fadeAndNormalize(output, sampleRate);
  const gesture = Object.freeze({
    kind: "neutral-descriptor-modal-control",
    frameSize: envelope.frameSize,
    hopSize: envelope.frameSize,
    frames: Object.freeze(Array.from(envelope.frames, (amplitude, index) => Object.freeze({
      timeSeconds: Math.min(
        output.length / sampleRate,
        (index + 0.5) * envelope.frameSize / sampleRate / effectiveSpeedRatio,
      ),
      sourceTimeSeconds: Math.min(
        source.length / sampleRate,
        (index + 0.5) * envelope.frameSize / sampleRate,
      ),
      outputTimeSeconds: Math.min(
        output.length / sampleRate,
        (index + 0.5) * envelope.frameSize / sampleRate / effectiveSpeedRatio,
      ),
      amplitude,
    }))),
  });
  return Object.freeze({
    samples: output,
    sampleRate,
    gesture,
    model: Object.freeze({
      id: "neutral-descriptor-modal-v1",
      label: options.neutralModelLabel ?? selected.synthesis.label,
      anatomical: false,
      mechanismSpecific: false,
      sourceFeatures: "coarse RMS envelope plus event spectral summaries",
      sourceFeatureBandHz: Object.freeze({
        minimum: analysisMinimumSpectralHz,
        maximum: sourceSpectralMaximum,
      }),
      sourceBaseFrequencyHz,
      baseFrequencyHz,
      profileFrequencyScale,
      frequencyScale,
      frequencyMapping: frequencyScale === 1
        ? "unshifted descriptor mapping"
        : "frequency-scaled descriptor mapping with independent gesture-time control",
      modeFrequenciesHz,
      bandwidthRatio,
      flatness,
      resynthesis: Object.freeze({
        ...resynthesis,
        requestedSpeedRatio: resynthesis.speedRatio,
        effectiveSpeedRatio,
        timeWarpLimited,
        maximumOutputSeconds,
      }),
      envelopeFrameSeconds: envelope.frameSize / sampleRate,
      seed: Math.floor(finite(options.seed, 0x41434f55)),
    }),
    stats: Object.freeze({
      sourceEnvelopePeak: envelope.peak,
      outputPeak: samplePeak(output),
      outputRms: sampleRms(output),
    }),
  });
}

function songbirdOptions(descriptor, options) {
  const resynthesis = normalizeAcousticResynthesis(options.resynthesis ?? options);
  return {
    drive: clamp(finite(options.drive, 0.7 + finite(descriptor?.energy) * 1.7), 0.55, 1.8),
    roughness: clamp(finite(options.roughness, 0.018 + finite(descriptor?.meanFlatness) * 0.16), 0.01, 0.22),
    resonanceHz: clamp(
      finite(options.resonanceHz, finite(descriptor?.meanCentroidHz, 2_200) * 0.88),
      300,
      7_800,
    ),
    resonanceQ: clamp(finite(options.resonanceQ, 6.8 - finite(descriptor?.meanFlux) * 20), 2.2, 7.5),
    resonanceMix: clamp(finite(options.resonanceMix, 0.34 + finite(descriptor?.meanFlatness) * 0.34), 0.3, 0.62),
    speedRatio: resynthesis.speedRatio,
    pitchShiftSemitones: resynthesis.pitchShiftSemitones,
    bodyScale: resynthesis.bodyScale,
    textureAmount: resynthesis.textureAmount,
    seed: Math.floor(finite(options.seed, 0x41434f00 + finite(descriptor?.index))),
  };
}

function cricketOptions(descriptor, options) {
  const resynthesis = normalizeAcousticResynthesis(options.resynthesis ?? options);
  return {
    resonanceScale: clamp(finite(options.resonanceScale, 1), 0.55, 1.8),
    toothRateRatio: clamp(finite(options.toothRateRatio, 1), 0.72, 1.28),
    // Spectral focus in a recording is not a measurement of mechanical wing
    // damping, so keep the model Q at its explicit hypothesis unless changed.
    wingQ: clamp(finite(options.wingQ, 7.9), 3, 55),
    coupling: clamp(finite(options.coupling, 0.48)),
    wingSplitCents: clamp(finite(options.wingSplitCents, 34), -360, 360),
    plectrumForce: clamp(finite(options.plectrumForce, 0.82), 0.1, 1.8),
    toothIrregularity: clamp(finite(options.toothIrregularity, 0.035), 0, 0.45),
    closingSweep: clamp(finite(options.closingSweep, -0.075), -0.24, 0.24),
    mirrorMix: clamp(finite(options.mirrorMix, 0.32), 0, 0.8),
    speedRatio: resynthesis.speedRatio,
    pitchShiftSemitones: resynthesis.pitchShiftSemitones,
    bodyScale: resynthesis.bodyScale,
    textureAmount: resynthesis.textureAmount,
    seed: Math.floor(finite(options.seed, 0x41434900 + finite(descriptor?.index))),
  };
}

function specialistResult(rendered, specialistAnalysis, selected, resynthesis) {
  const appliedResynthesis = Object.freeze({
    ...resynthesis,
    requestedSpeedRatio: resynthesis.speedRatio,
    effectiveSpeedRatio: rendered.model.speedRatio,
    timeWarpLimited: Boolean(rendered.model.timeWarpLimited),
    maximumOutputSeconds: rendered.model.maximumOutputSeconds ?? 30,
  });
  return Object.freeze({
    samples: rendered.samples,
    sampleRate: rendered.sampleRate,
    profileId: selected.id,
    requestedModelLabel: selected.synthesis.label,
    modelLabel: selected.synthesis.label,
    synthesisKind: "mechanism-specific reduced model",
    fallbackUsed: false,
    fallbackReason: null,
    resynthesis: appliedResynthesis,
    specialistAnalysis,
    gesture: specialistAnalysis,
    model: Object.freeze({
      ...rendered.model,
      resynthesis: appliedResynthesis,
      label: selected.synthesis.label,
      mechanismSpecific: true,
      anatomyRecovered: false,
    }),
    inferenceLimit: selected.inferenceLimits.at(-1),
  });
}

function fallbackResult(samples, sampleRate, selected, descriptor, options, reason) {
  const neutralLabel = "Fallback · neutral modal descriptor sonification";
  const neutral = renderNeutralModel(samples, sampleRate, selected, descriptor, {
    ...options,
    neutralModelLabel: neutralLabel,
  });
  return Object.freeze({
    ...neutral,
    resynthesis: neutral.model.resynthesis,
    profileId: selected.id,
    requestedModelLabel: selected.synthesis.label,
    modelLabel: neutralLabel,
    synthesisKind: "neutral fallback",
    fallbackUsed: true,
    fallbackReason: reason,
    specialistAnalysis: null,
    gesture: neutral.gesture,
    inferenceLimit: "The specialist cues were unavailable, so this output makes no biological mechanism claim.",
  });
}

/** Render a sample-free model sketch for one already-isolated event. */
export function renderAcousticModel(
  samples,
  sampleRate = DEFAULT_SAMPLE_RATE,
  profileOrOptions = "general",
  additionalOptions = {},
) {
  if (!samples || !Number.isSafeInteger(samples.length) || samples.length < 32) {
    throw new TypeError("renderAcousticModel requires a non-empty event sample buffer");
  }
  const rate = finite(sampleRate);
  if (rate < MIN_SAMPLE_RATE || rate > MAX_SAMPLE_RATE) {
    throw new RangeError(`Sample rate must be ${MIN_SAMPLE_RATE}–${MAX_SAMPLE_RATE} Hz`);
  }
  const resolved = resolveProfileAndOptions(profileOrOptions, additionalOptions);
  const { profile: selected, options } = resolved;
  const descriptor = options.descriptor ?? null;
  const resynthesis = normalizeAcousticResynthesis(
    options.resynthesis ?? options.modelOptions ?? options,
  );
  const modelOptions = { ...options, ...options.modelOptions, resynthesis };
  if (selected.synthesis.specialist === "neutral") {
    const rendered = renderNeutralModel(samples, rate, selected, descriptor, modelOptions);
    return Object.freeze({
      ...rendered,
      resynthesis: rendered.model.resynthesis,
      profileId: selected.id,
      requestedModelLabel: selected.synthesis.label,
      modelLabel: selected.synthesis.label,
      synthesisKind: "neutral descriptor sonification",
      fallbackUsed: false,
      fallbackReason: null,
      specialistAnalysis: null,
      gesture: rendered.gesture,
      inferenceLimit: selected.inferenceLimits.at(-1),
    });
  }

  try {
    if (selected.synthesis.specialist === "songbird") {
      const specialistAnalysis = analyzeBirdsong(samples, rate, {
        minimumF0Hz: finite(options.minimumF0Hz, 180),
        maximumF0Hz: Math.min(finite(options.maximumF0Hz, 9_000), rate * 0.4),
        maxDurationSeconds: Math.min(
          selected.maxDurationSeconds,
          finite(options.maxDurationSeconds, Math.max(0.5, samples.length / rate + 0.1)),
        ),
        frameSize: finite(options.frameSize, 1_024),
        hopSize: finite(options.hopSize, 256),
        yinThreshold: finite(options.yinThreshold, 0.22),
      });
      const rendered = renderBirdsongModel(
        specialistAnalysis,
        songbirdOptions(descriptor, modelOptions),
      );
      if (samplePeak(rendered.samples) > 1e-7) {
        return specialistResult(rendered, specialistAnalysis, selected, resynthesis);
      }
      return fallbackResult(
        samples,
        rate,
        selected,
        descriptor,
        modelOptions,
        "No stable voiced trajectory was available to drive the reduced syrinx model.",
      );
    }

    const specialistAnalysis = analyzeCricketSong(samples, rate, {
      minimumCarrierHz: finite(options.minimumCarrierHz, selected.minimumSpectralHz),
      maximumCarrierHz: Math.min(
        finite(options.maximumCarrierHz, selected.maximumSpectralHz),
        rate * 0.46,
      ),
      maxDurationSeconds: Math.min(
        selected.maxDurationSeconds,
        finite(options.maxDurationSeconds, Math.max(0.5, samples.length / rate + 0.1)),
      ),
    });
    const rendered = renderCricketModel(
      specialistAnalysis,
      cricketOptions(descriptor, modelOptions),
    );
    if (samplePeak(rendered.samples) > 1e-7) {
      return specialistResult(rendered, specialistAnalysis, selected, resynthesis);
    }
    return fallbackResult(
      samples,
      rate,
      selected,
      descriptor,
      modelOptions,
      "No stable carrier-and-pulse gesture was available to drive the reduced wing model.",
    );
  } catch (error) {
    return fallbackResult(
      samples,
      rate,
      selected,
      descriptor,
      modelOptions,
      `Specialist rendering was unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Slice and render one node from an Acoustic Manifold analysis. */
export function renderAcousticModelSegment(
  sourceSamples,
  manifoldAnalysis,
  stropheOrIndex,
  options = {},
) {
  if (!sourceSamples || !manifoldAnalysis?.strophes) {
    throw new TypeError("renderAcousticModelSegment requires source samples and Acoustic Manifold analysis");
  }
  let strophe = stropheOrIndex;
  if (typeof stropheOrIndex === "number") strophe = manifoldAnalysis.strophes[stropheOrIndex];
  if (typeof stropheOrIndex === "string") {
    strophe = manifoldAnalysis.strophes.find((entry) => (
      entry.id === stropheOrIndex
      || entry.eventId === stropheOrIndex
      || entry.legacyStropheId === stropheOrIndex
    ));
  }
  if (!strophe || !Number.isSafeInteger(strophe.startSample) || !Number.isSafeInteger(strophe.endSample)) {
    throw new RangeError(`Unknown acoustic event ${String(stropheOrIndex)}`);
  }
  const startSample = clamp(Math.floor(strophe.startSample), 0, sourceSamples.length);
  const endSample = clamp(Math.ceil(strophe.endSample), startSample, sourceSamples.length);
  const effectiveAnalysis = manifoldAnalysis.profile?.effective ?? {};
  const analysisBandOptions = {
    minimumSpectralHz: effectiveAnalysis.minimumSpectralHz,
    maximumSpectralHz: effectiveAnalysis.maximumSpectralHz,
    minimumCarrierHz: effectiveAnalysis.minimumSpectralHz,
    maximumCarrierHz: effectiveAnalysis.maximumSpectralHz,
  };
  const rendered = renderAcousticModel(
    sourceSamples.slice(startSample, endSample),
    manifoldAnalysis.sampleRate,
    manifoldAnalysis.profileId ?? "general",
    { ...analysisBandOptions, ...options, descriptor: strophe },
  );
  return Object.freeze({
    ...rendered,
    stropheIndex: strophe.index,
    eventId: strophe.eventId ?? strophe.id,
    stropheId: strophe.legacyStropheId ?? strophe.id,
    sourceRange: Object.freeze({ startSample, endSample }),
  });
}

function retimedControlEvent(event, speedRatio) {
  const output = { ...event };
  for (const key of ["timeSeconds", "startSeconds", "endSeconds", "centerSeconds", "durationSeconds"]) {
    if (Number.isFinite(event?.[key])) output[key] = event[key] / speedRatio;
  }
  return Object.freeze(output);
}

function exportedGesture(segment) {
  const gesture = segment.gesture ?? segment.specialistAnalysis;
  const speedRatio = Math.max(
    1e-9,
    finite(segment.resynthesis?.effectiveSpeedRatio, segment.model?.speedRatio || 1),
  );
  if (segment.fallbackUsed || gesture?.kind === "neutral-descriptor-modal-control") {
    return Object.freeze({
      kind: "neutral-descriptor-modal-control",
      frameSize: gesture?.frameSize ?? null,
      hopSize: gesture?.hopSize ?? null,
      frames: Object.freeze((gesture?.frames ?? []).map((frame) => Object.freeze({
        timeSeconds: frame.timeSeconds,
        sourceTimeSeconds: frame.sourceTimeSeconds ?? frame.timeSeconds,
        outputTimeSeconds: frame.outputTimeSeconds ?? frame.timeSeconds,
        amplitude: frame.amplitude,
      }))),
      note: "The neutral model follows coarse envelope and spectral descriptors; it is not a mechanism-specific gesture.",
    });
  }
  if (segment.model?.id === "effective-bilateral-syrinx-v0" && gesture) {
    return Object.freeze({
      kind: "effective-songbird-control-trajectory",
      frameSize: gesture.frameSize,
      hopSize: gesture.hopSize,
      voicedFraction: gesture.voicedFraction,
      medianF0Hz: gesture.medianF0Hz,
      syllables: Object.freeze((gesture.syllables ?? []).map((syllable) => (
        retimedControlEvent(syllable, speedRatio)
      ))),
      frames: Object.freeze((gesture.frames ?? []).map((frame) => Object.freeze({
        timeSeconds: frame.timeSeconds / speedRatio,
        sourceTimeSeconds: frame.timeSeconds,
        outputTimeSeconds: frame.timeSeconds / speedRatio,
        voiced: frame.voiced,
        f0Hz: frame.f0Hz,
        sourceF0Hz: frame.f0Hz,
        outputF0Hz: frame.voiced
          ? clamp(
            frame.f0Hz * (segment.model?.pitchRatio ?? 1),
            80,
            segment.sampleRate * 0.18,
          )
          : 0,
        confidence: frame.confidence,
        amplitudeEnvelope: frame.envelope,
        pressureProxy: frame.pressureProxy,
        tensionProxy: frame.tensionProxy,
      }))),
    });
  }
  if (segment.model?.id === "two-dof-cricket-wings-v1" && gesture) {
    return Object.freeze({
      kind: "effective-insect-control-trajectory",
      frameSize: gesture.frameSize,
      hopSize: gesture.hopSize,
      carrierHz: gesture.carrierHz,
      outputCarrierHz: segment.model?.baseFrequencyHz ?? gesture.carrierHz,
      toothStrikeRateHz: gesture.toothStrikeRateHz,
      outputToothStrikeRateHz: segment.model?.toothStrikeRateHz ?? gesture.toothStrikeRateHz,
      effectiveQ: gesture.effectiveQ,
      wingStrokeRateHz: gesture.wingStrokeRateHz,
      chirps: Object.freeze((gesture.chirps ?? []).map((chirp) => (
        retimedControlEvent(chirp, speedRatio)
      ))),
      pulses: Object.freeze((gesture.pulses ?? []).map((pulse) => (
        retimedControlEvent(pulse, speedRatio)
      ))),
      envelope: Object.freeze((gesture.frames ?? []).map((frame) => Object.freeze({
        timeSeconds: frame.timeSeconds / speedRatio,
        sourceTimeSeconds: frame.timeSeconds,
        outputTimeSeconds: frame.timeSeconds / speedRatio,
        amplitude: frame.envelope,
        active: frame.active,
      }))),
    });
  }
  return Object.freeze({
    kind: "neutral-descriptor-modal-control",
    frameSize: gesture?.frameSize ?? null,
    hopSize: gesture?.hopSize ?? null,
    frames: gesture?.frames ?? Object.freeze([]),
    note: "The neutral model follows coarse envelope and spectral descriptors; it is not a mechanism-specific gesture.",
  });
}

function exportedModelSegment(segment) {
  return Object.freeze({
    eventIndex: segment.stropheIndex,
    eventId: segment.eventId ?? segment.stropheId,
    stropheIndex: segment.stropheIndex,
    stropheId: segment.stropheId,
    profileId: segment.profileId,
    requestedModelLabel: segment.requestedModelLabel,
    modelLabel: segment.modelLabel,
    synthesisKind: segment.synthesisKind,
    fallbackUsed: Boolean(segment.fallbackUsed),
    fallbackReason: segment.fallbackReason ?? null,
    sourceRange: segment.sourceRange ?? null,
    resynthesis: segment.resynthesis ?? segment.model?.resynthesis ?? null,
    gesture: exportedGesture(segment),
    model: segment.model ?? null,
  });
}

function exportedSourceMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const allowed = [
    "kind",
    "id",
    "catalogGroup",
    "access",
    "commonName",
    "scientificName",
    "attribution",
    "license",
    "licenseUrl",
    "sourceUrl",
    "recordedAt",
    "location",
    "sha256",
    "note",
  ];
  const exported = Object.fromEntries(
    allowed
      .filter((key) => typeof metadata[key] === "string" && metadata[key].length > 0)
      .map((key) => [key, metadata[key]]),
  );
  if (Number.isFinite(Number(metadata.sampleRate))) {
    exported.sampleRate = Number(metadata.sampleRate);
  }
  if (metadata.technical && typeof metadata.technical === "object") {
    exported.technical = Object.fromEntries(
      Object.entries(metadata.technical)
        .filter(([, value]) => typeof value === "string" || Number.isFinite(Number(value)))
        .map(([key, value]) => [key, typeof value === "number" ? value : String(value)]),
    );
  }
  if (metadata.decoding && typeof metadata.decoding === "object") {
    const decoding = {};
    for (const key of [
      "label",
      "method",
      "originalSampleRatePreserved",
      "numberOfChannels",
      "selectedChannelIndex",
      "encoding",
      "bitsPerSample",
    ]) {
      const value = metadata.decoding[key];
      if (["string", "number", "boolean"].includes(typeof value)) decoding[key] = value;
    }
    exported.decoding = Object.freeze(decoding);
  }
  return Object.freeze(exported);
}

function exportedRouteTimeline(analysis, route, timeline) {
  if (!Array.isArray(timeline)) return Object.freeze([]);
  return Object.freeze(route.map((eventIndex, routeStep) => {
    const timing = timeline[routeStep] ?? {};
    const occurrence = analysis.strophes[eventIndex];
    const startSeconds = Math.max(0, finite(timing.startSeconds));
    const endSeconds = Math.max(startSeconds, finite(timing.endSeconds, startSeconds));
    return Object.freeze({
      routeStep,
      eventIndex,
      eventId: occurrence?.eventId ?? occurrence?.id ?? null,
      stropheId: occurrence?.legacyStropheId ?? occurrence?.id ?? null,
      startSeconds,
      endSeconds,
      durationSeconds: endSeconds - startSeconds,
    });
  }));
}

export function acousticManifoldExport(analysis, route = [], metadata = {}) {
  if (!analysis?.strophes || !analysis?.profileId) {
    throw new TypeError("acousticManifoldExport requires analyzeAcousticSequence output");
  }
  const selected = getAcousticProfile(analysis.profileId);
  const base = nightingaleManifoldExport(analysis, route, metadata);
  const modelSegments = Object.freeze(
    Array.from(metadata.modelSegments ?? [], exportedModelSegment),
  );
  const routeTimeline = exportedRouteTimeline(analysis, route, metadata.timeline);
  const gapSeconds = Number.isFinite(Number(metadata.gapSeconds))
    ? clamp(finite(metadata.gapSeconds), 0, 1)
    : null;
  const resynthesis = normalizeAcousticResynthesis(metadata.resynthesis);
  return Object.freeze({
    ...base,
    format: "morphazoid-acoustic-manifold",
    version: 1,
    sourceMetadata: exportedSourceMetadata(metadata.sourceMetadata),
    featureRecipe: Object.freeze({
      ...base.featureRecipe,
      eventFeatures: base.featureRecipe.stropheFeatures,
      resampling: analysis.resampling,
    }),
    route: Object.freeze({
      ...base.route,
      surprise: clamp(finite(metadata.surprise, 0)),
      eventIds: base.route.ids,
      stropheIds: Object.freeze(route.map((index) => (
        analysis.strophes[index]?.legacyStropheId ?? analysis.strophes[index]?.id
      )).filter(Boolean)),
      gapSeconds,
      timeline: routeTimeline,
    }),
    events: base.strophes,
    profile: analysis.profile,
    inputCompatibility: analysis.inputCompatibility,
    classification: analysis.classification,
    multiscale: analysis.multiscale,
    resynthesis: Object.freeze({
      ...resynthesis,
      mapping: "Global controls are combined with PC1 → pitch, PC2 → texture, and PC3 → gesture speed offsets for each routed event.",
      biologicalLimitClaimed: false,
      note: "This is an artistic extrapolation from analyzed controls, not a measured physiological capability envelope.",
    }),
    inferenceLimits: analysis.inferenceLimits,
    disclaimer: `${analysis.segmentation.mode === "fixed-window" ? "Events are overlapping analysis windows." : "Events are pause-bounded occurrences."} The selected and optionally tuned profile is a prior, not a species classification; PCA proximity is exploratory, and only observed-succession edges encode recorded order.`,
    modelBoundary: Object.freeze({
      requestedModel: selected.synthesis,
      modelSegments,
      sourceSamplesIncluded: false,
      note: selected.synthesis.recoversAnatomy
        ? "Model parameters are not unique anatomical measurements."
        : "Model output is a parameter sonification and does not recover source anatomy.",
    }),
  });
}

export const ACOUSTIC_MANIFOLD_LIMITS = Object.freeze({
  minimumSampleRate: MIN_SAMPLE_RATE,
  maximumSampleRate: MAX_SAMPLE_RATE,
  maximumDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
  profileIds: Object.freeze(Object.keys(ACOUSTIC_PROFILES)),
});

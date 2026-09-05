import { encodeMonoWav } from "./src/birdsong-analysis.js";
import {
  AcousticLiveCapture,
  normalizeCaptureDuration,
} from "./src/acoustic-live-capture.js";
import {
  ACOUSTIC_ARCHIVE_COLLECTIONS,
  ACOUSTIC_ARCHIVE_GROUPS,
  ACOUSTIC_BUILT_IN_SOURCES,
  ACOUSTIC_BUILT_IN_SOURCE_GROUPS,
  ACOUSTIC_ANALYSIS_LIMITS,
  ACOUSTIC_MANIFOLD_LIMITS,
  ACOUSTIC_PROFILE_GROUPS,
  ACOUSTIC_PROFILES,
  ACOUSTIC_RESYNTHESIS_LIMITS,
  acousticResynthesisForOccurrence,
  acousticManifoldExport,
  analyzeAcousticSequence,
  createAcousticDemo,
  getAcousticBuiltInSource,
  getAcousticProfile,
  normalizeAcousticAnalysisParameters,
  normalizeAcousticResynthesis,
  renderAcousticModelSegment,
} from "./src/acoustic-manifold.js";
import { decodePcmWav } from "./src/pcm-wav-decoder.js";
import { createNightingaleManifoldRenderer } from "./src/nightingale-manifold-3d.js";
import {
  assembleAudioSegments,
  assembleStropheRoute,
  buildStropheTraversal,
} from "./src/nightingale-manifold.js";

const $ = (id) => document.getElementById(id);
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILE_DURATION_SECONDS = 120;
const FILE_METADATA_TIMEOUT_MS = 3_000;
const ROUTE_GAP_SECONDS = 0.09;
const ROUTE_SEED = 0x41434f55;
const MINIMUM_USEFUL_CAPTURE_SECONDS = 0.5;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FAMILY_COLOURS = Object.freeze([
  "#58d6d1",
  "#efbe67",
  "#b9dc68",
  "#64aee8",
  "#9ea8ef",
  "#72d6a2",
]);

const RESYNTHESIS_PRESETS = Object.freeze({
  anchor: Object.freeze({
    speedRatio: 1,
    pitchShiftSemitones: 0,
    bodyScale: 1,
    textureAmount: 1,
    manifoldExaggeration: 1,
    gapSeconds: ROUTE_GAP_SECONDS,
  }),
  "slow-giant": Object.freeze({
    speedRatio: 0.35,
    pitchShiftSemitones: -18,
    bodyScale: 2.4,
    textureAmount: 0.65,
    manifoldExaggeration: 1.8,
    gapSeconds: 0.18,
  }),
  "fast-miniature": Object.freeze({
    speedRatio: 2.75,
    pitchShiftSemitones: 20,
    bodyScale: 0.45,
    textureAmount: 1.4,
    manifoldExaggeration: 2.2,
    gapSeconds: 0.035,
  }),
  "hyper-articulation": Object.freeze({
    speedRatio: 5,
    pitchShiftSemitones: 7,
    bodyScale: 0.8,
    textureAmount: 2.6,
    manifoldExaggeration: 3,
    gapSeconds: 0.015,
  }),
  "alien-fold": Object.freeze({
    speedRatio: 0.6,
    pitchShiftSemitones: -31,
    bodyScale: 0.35,
    textureAmount: 4,
    manifoldExaggeration: 4,
    gapSeconds: 0.25,
  }),
});

const RESYNTHESIS_INPUT_IDS = Object.freeze([
  "gesture-speed",
  "pitch-shift",
  "manifold-exaggeration",
  "body-scale",
  "texture-amount",
  "route-gap",
]);

const ANALYSIS_INPUT_IDS = Object.freeze([
  "analysis-minimum-spectral-hz",
  "analysis-maximum-spectral-hz",
  "analysis-minimum-event-seconds",
  "analysis-gap-seconds",
  "analysis-fixed-window-seconds",
  "analysis-fixed-window-overlap",
  "analysis-minimum-active-ratio",
  "analysis-frame-size",
  "analysis-hop-ratio",
  "analysis-target-rate",
  "analysis-sequence-gap-seconds",
  "analysis-neighbor-count",
]);

// Retain aliases for links/bookmarks made while the recording IDs were longer.
const SOURCE_ID_ALIASES = Object.freeze({
  "thrush-nightingale-recording": "thrush-nightingale",
  "common-blackbird-recording": "common-blackbird",
  "chaffinch-recording": "chaffinch",
  "house-cricket-recording": "house-cricket",
  "field-cricket-recording": "field-cricket",
  "european-field-cricket-recording": "european-field-cricket",
});

const routeAudio = new Audio();
routeAudio.preload = "auto";

let sourceSamples = null;
let sourceSampleRate = 48_000;
let sourceName = "Synthetic thrush-nightingale sequence";
let sourceOrigin = null;
let sourceDecodeMetadata = null;
let analysis = null;
let selectedIndex = null;
let route = [];
let manualRoute = [];
let routeRender = null;
let routeRenderKey = "";
let routeUrl = "";
let audioEnabled = false;
let busy = false;
let pendingPlayback = false;
let taskVersion = 0;
let playbackFrame = 0;
let playbackRestoreIndex = null;
let sourceLoadController = null;
let liveCapture = null;
let liveCaptureVersion = 0;
let liveStarting = false;
let liveStopping = false;
let microphonePermissionSeen = false;
let disposed = false;
let activeRouteSeed = ROUTE_SEED;
let activeRouteSurprise = 0.35;
let activeRouteRule = "chronology";
let lastLiveAnnouncementAt = -Infinity;
let analysisControlsProfileId = null;
let analyzedParameterKey = "";
const modelCache = new Map();

const renderer = createNightingaleManifoldRenderer($("manifold-canvas"), {
  onSelect(index) {
    selectOccurrence(index, true);
  },
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function setStatus(message, state = "working") {
  $("status").textContent = message;
  $("status").dataset.state = state;
}

function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

function selectedProfile() {
  return getAcousticProfile($("analysis-profile").value);
}

function inputNumber(value) {
  const number = finite(value);
  if (number === 0) return "0";
  return String(Number(number.toPrecision(9)));
}

function analysisParameterOptions(profile = selectedProfile()) {
  const frameSize = finite($("analysis-frame-size").value, profile.frameSize);
  const hopRatio = finite(
    $("analysis-hop-ratio").value,
    profile.hopSize / profile.frameSize,
  );
  const sequenceValue = $("analysis-sequence-gap-seconds").value.trim();
  return {
    minimumSpectralHz: finite(
      $("analysis-minimum-spectral-hz").value,
      profile.minimumSpectralHz,
    ),
    maximumSpectralHz: finite(
      $("analysis-maximum-spectral-hz").value,
      profile.maximumSpectralHz,
    ),
    minimumStropheSeconds: finite(
      $("analysis-minimum-event-seconds").value,
      profile.minimumStropheSeconds,
    ),
    stropheGapSeconds: finite($("analysis-gap-seconds").value, profile.stropheGapSeconds),
    fixedWindowSeconds: profile.segmentationMode === "fixed-window"
      ? finite($("analysis-fixed-window-seconds").value, profile.fixedWindowSeconds)
      : 0,
    fixedWindowOverlap: finite(
      $("analysis-fixed-window-overlap").value,
      profile.fixedWindowOverlap * 100,
    ) / 100,
    minimumWindowActiveRatio: finite(
      $("analysis-minimum-active-ratio").value,
      profile.minimumWindowActiveRatio * 100,
    ) / 100,
    analysisTargetRate: finite($("analysis-target-rate").value, profile.analysisTargetRate),
    frameSize,
    hopSize: Math.round(frameSize * hopRatio),
    sequenceGapSeconds: sequenceValue === "" ? null : finite(sequenceValue),
    neighborCount: finite(
      $("analysis-neighbor-count").value,
      ACOUSTIC_ANALYSIS_LIMITS.neighborCount.default,
    ),
    maxDurationSeconds: Math.min(
      profile.maxDurationSeconds,
      ACOUSTIC_MANIFOLD_LIMITS.maximumDurationSeconds,
    ),
  };
}

function analysisParameters(profile = selectedProfile()) {
  return normalizeAcousticAnalysisParameters(profile, analysisParameterOptions(profile));
}

function defaultAnalysisParameters(profile = selectedProfile()) {
  return normalizeAcousticAnalysisParameters(profile, {
    maxDurationSeconds: Math.min(
      profile.maxDurationSeconds,
      ACOUSTIC_MANIFOLD_LIMITS.maximumDurationSeconds,
    ),
  });
}

function analysisParameterKey(parameters = analysisParameters(), profile = selectedProfile()) {
  return [
    profile.id,
    parameters.minimumSpectralHz,
    parameters.maximumSpectralHz,
    parameters.minimumStropheSeconds,
    parameters.stropheGapSeconds,
    parameters.fixedWindowSeconds,
    parameters.fixedWindowOverlap,
    parameters.minimumWindowActiveRatio,
    parameters.analysisTargetRate,
    parameters.frameSize,
    parameters.hopSize,
    parameters.sequenceGapSeconds ?? "off",
    parameters.neighborCount,
    parameters.maxDurationSeconds,
  ].join(":");
}

function analysisParametersAreCustom(parameters = analysisParameters(), profile = selectedProfile()) {
  return analysisParameterKey(parameters, profile)
    !== analysisParameterKey(defaultAnalysisParameters(profile), profile);
}

function analysisParameterIssue(parameters = analysisParameters()) {
  const profile = selectedProfile();
  for (const id of ANALYSIS_INPUT_IDS) {
    $(id).setCustomValidity("");
    $(id).setAttribute("aria-invalid", "false");
  }
  const requiredIds = [
    "analysis-minimum-spectral-hz",
    "analysis-maximum-spectral-hz",
    "analysis-minimum-event-seconds",
    "analysis-frame-size",
    "analysis-hop-ratio",
    "analysis-target-rate",
    "analysis-neighbor-count",
    ...(profile.segmentationMode === "fixed-window"
      ? [
        "analysis-fixed-window-seconds",
        "analysis-fixed-window-overlap",
        "analysis-minimum-active-ratio",
      ]
      : ["analysis-gap-seconds"]),
  ];
  const invalidIds = requiredIds.filter(
    (id) => !$(id).checkValidity() || $(id).value.trim() === "",
  );
  if (
    $("analysis-sequence-gap-seconds").value.trim() !== ""
    && !$("analysis-sequence-gap-seconds").checkValidity()
  ) invalidIds.push("analysis-sequence-gap-seconds");
  if (invalidIds.length) {
    for (const id of invalidIds) $(id).setAttribute("aria-invalid", "true");
    return "Enter a value within each displayed limit.";
  }
  const rawMinimumHz = Number($("analysis-minimum-spectral-hz").value);
  const rawMaximumHz = Number($("analysis-maximum-spectral-hz").value);
  if (rawMinimumHz >= rawMaximumHz) {
    const message = "The feature-band floor must be below its ceiling.";
    for (const id of ["analysis-minimum-spectral-hz", "analysis-maximum-spectral-hz"]) {
      $(id).setCustomValidity(message);
      $(id).setAttribute("aria-invalid", "true");
    }
    return message;
  }
  if (profile.segmentationMode === "fixed-window") {
    const rawWindowSeconds = Number($("analysis-fixed-window-seconds").value);
    const rawPartialTailSeconds = Number($("analysis-minimum-event-seconds").value);
    if (rawPartialTailSeconds > rawWindowSeconds * 0.5) {
      const message = "The partial-tail threshold cannot exceed half the fixed-window length.";
      for (const id of ["analysis-fixed-window-seconds", "analysis-minimum-event-seconds"]) {
        $(id).setCustomValidity(message);
        $(id).setAttribute("aria-invalid", "true");
      }
      return message;
    }
  }
  const analyzedSamples = sourceSamples
    ? Math.min(sourceSamples.length, sourceSampleRate * parameters.maxDurationSeconds)
    : parameters.analysisTargetRate * parameters.maxDurationSeconds;
  const sourceRate = sourceSamples ? sourceSampleRate : parameters.analysisTargetRate;
  const analysisRate = Math.min(sourceRate, parameters.analysisTargetRate);
  const estimatedFrameCount = Math.max(
    1,
    Math.floor(
      (analyzedSamples * analysisRate / sourceRate - parameters.frameSize)
      / parameters.hopSize,
    ) + 1,
  );
  if (estimatedFrameCount > ACOUSTIC_ANALYSIS_LIMITS.maximumFrameCount) {
    const message = `About ${estimatedFrameCount.toLocaleString()} frames exceeds the ${ACOUSTIC_ANALYSIS_LIMITS.maximumFrameCount.toLocaleString()}-frame browser budget; choose a larger frame step or lower analysis-rate ceiling.`;
    for (const id of ["analysis-frame-size", "analysis-hop-ratio", "analysis-target-rate"]) {
      $(id).setCustomValidity(message);
      $(id).setAttribute("aria-invalid", "true");
    }
    return message;
  }
  const fftWorkPerFrame = Math.max(
    1,
    parameters.frameSize * Math.log2(parameters.frameSize) / (512 * 9),
  );
  const estimatedFftWorkUnits = Math.ceil(estimatedFrameCount * fftWorkPerFrame);
  if (estimatedFftWorkUnits > ACOUSTIC_ANALYSIS_LIMITS.maximumFftWorkUnits) {
    const message = `The frame count and ${parameters.frameSize}-sample FFT exceed the weighted browser-work budget; choose a smaller FFT frame, a larger frame step, or lower analysis-rate ceiling.`;
    for (const id of ["analysis-frame-size", "analysis-hop-ratio", "analysis-target-rate"]) {
      $(id).setCustomValidity(message);
      $(id).setAttribute("aria-invalid", "true");
    }
    return message;
  }
  return null;
}

function setAnalysisParameterInputs(parameters, profile = selectedProfile()) {
  const normalized = normalizeAcousticAnalysisParameters(profile, parameters);
  const fixedWindow = profile.segmentationMode === "fixed-window";
  $("analysis-minimum-spectral-hz").value = inputNumber(normalized.minimumSpectralHz);
  $("analysis-maximum-spectral-hz").value = inputNumber(normalized.maximumSpectralHz);
  $("analysis-minimum-event-seconds").min = inputNumber(
    fixedWindow
      ? Math.min(
        Math.max(0.0001, profile.minimumDurationLimitSeconds),
        normalized.fixedWindowSeconds * 0.5,
      )
      : Math.max(0.0001, profile.minimumDurationLimitSeconds),
  );
  $("analysis-minimum-event-seconds").max = inputNumber(
    fixedWindow
      ? Math.min(profile.maximumDurationLimitSeconds, normalized.fixedWindowSeconds * 0.5)
      : profile.maximumDurationLimitSeconds,
  );
  $("analysis-minimum-event-seconds").value = inputNumber(normalized.minimumStropheSeconds);
  $("analysis-gap-seconds").min = inputNumber(Math.max(0.0001, profile.minimumGapLimitSeconds));
  $("analysis-gap-seconds").max = inputNumber(profile.maximumGapLimitSeconds);
  $("analysis-gap-seconds").value = inputNumber(normalized.stropheGapSeconds);
  $("analysis-fixed-window-seconds").min = profile.segmentationMode === "fixed-window"
    ? "0.001"
    : "0";
  $("analysis-fixed-window-seconds").value = inputNumber(normalized.fixedWindowSeconds);
  $("analysis-fixed-window-overlap").value = inputNumber(normalized.fixedWindowOverlap * 100);
  $("analysis-minimum-active-ratio").value = inputNumber(
    normalized.minimumWindowActiveRatio * 100,
  );
  $("analysis-frame-size").value = String(normalized.frameSize);
  $("analysis-hop-ratio").value = String(normalized.hopSize / normalized.frameSize);
  $("analysis-target-rate").value = inputNumber(normalized.analysisTargetRate);
  $("analysis-sequence-gap-seconds").value = normalized.sequenceGapSeconds === null
    ? ""
    : inputNumber(normalized.sequenceGapSeconds);
  $("analysis-neighbor-count").value = String(normalized.neighborCount);
  $("analysis-pause-control").hidden = fixedWindow;
  $("analysis-window-controls").hidden = !fixedWindow;
  $("analysis-minimum-event-label").textContent = fixedWindow
    ? "Keep partial tail ≥"
    : "Discard shorter than";
}

function updateAnalysisParameterPresentation() {
  const profile = selectedProfile();
  const parameters = analysisParameters(profile);
  const custom = analysisParametersAreCustom(parameters, profile);
  const issue = analysisParameterIssue(parameters);
  const current = Boolean(analysis?.strophes)
    && analysis.profileId === profile.id
    && analyzedParameterKey === analysisParameterKey(parameters, profile);
  const state = $("analysis-tuning-state");
  const summary = $("analysis-parameter-summary");
  const mode = issue ? "invalid" : custom ? "custom" : "default";
  const label = issue
    ? "ADJUST SETTINGS"
    : custom
      ? current ? "CUSTOM · APPLIED" : "CUSTOM · REANALYZE"
      : current ? "PROFILE DEFAULTS · APPLIED" : "PROFILE DEFAULTS";
  state.dataset.mode = mode;
  state.textContent = label;
  summary.dataset.mode = mode;
  summary.querySelector("strong").textContent = label;
  const effectiveRate = sourceSamples
    ? Math.min(sourceSampleRate, parameters.analysisTargetRate)
    : parameters.analysisTargetRate;
  const frameMilliseconds = parameters.frameSize / effectiveRate * 1_000;
  const hopMilliseconds = parameters.hopSize / effectiveRate * 1_000;
  const timing = profile.segmentationMode === "fixed-window"
    ? `${formatDuration(parameters.fixedWindowSeconds)} windows · ${Math.round(parameters.fixedWindowOverlap * 100)}% overlap · tail ≥ ${formatDuration(parameters.minimumStropheSeconds)} · ${Math.round(parameters.minimumWindowActiveRatio * 100)}% active`
    : `discard under ${formatDuration(parameters.minimumStropheSeconds)} · join gaps through ${formatDuration(parameters.stropheGapSeconds)}`;
  const sequence = parameters.sequenceGapSeconds === null
    ? "sequence grouping off"
    : `new sequence after ${formatDuration(parameters.sequenceGapSeconds)}`;
  const truncation = current && analysis?.segmentation?.truncatedAtEventLimit
    ? `Map capped at ${analysis.strophes.length} of ${analysis.segmentation.candidateCount} qualifying ${profile.eventPlural}.`
    : null;
  summary.querySelector("span").textContent = issue ?? [
    `${formatHertz(parameters.minimumSpectralHz)}–${formatHertz(parameters.maximumSpectralHz)} feature band`,
    timing,
    `${parameters.frameSize} / ${parameters.hopSize} samples (${frameMilliseconds.toFixed(2)} / ${hopMilliseconds.toFixed(2)} ms)`,
    `${parameters.neighborCount} similarity neighbors`,
    sequence,
    custom
      ? "Listener-tuned prior; research citations describe the reset defaults."
      : "Research-profile defaults.",
    truncation,
  ].filter(Boolean).join(" · ");
  $("profile-note").textContent = [
    custom ? "listener-tuned prior" : "profile defaults",
    profile.segmentationMode === "fixed-window"
      ? `${formatDuration(parameters.fixedWindowSeconds)} overlapping ${profile.eventPlural}`
      : `${formatDuration(parameters.stropheGapSeconds)} internal-gap ${profile.eventPlural}`,
    `${formatHertz(parameters.minimumSpectralHz)}–${formatHertz(parameters.maximumSpectralHz)} features`,
    "not a classifier",
  ].join(" · ");
  $("acoustic-manifold-root").dataset.analysisParameters = issue
    ? "invalid"
    : current ? "applied" : "pending";
  updateSourceCompatibility();
}

function commitAnalysisParameterChange(message = "Analysis parameters changed; analyze and rebuild the 3D map to apply them.") {
  const profile = selectedProfile();
  const parameters = analysisParameters(profile);
  const issue = analysisParameterIssue(parameters);
  if (issue) {
    updateAnalysisParameterPresentation();
    setBusy(false);
    setStatus(issue, "error");
    return;
  }
  setAnalysisParameterInputs(parameters, profile);
  const changed = Boolean(analysis) && analyzedParameterKey !== analysisParameterKey(parameters, profile);
  if (changed) {
    stopPlayback(false, true);
    taskVersion += 1;
    clearAnalysisState();
  }
  updateAnalysisParameterPresentation();
  setBusy(false);
  setStatus(
    analysisMatchesProfile() ? "These analysis parameters already match the current 3D map." : message,
    "ready",
  );
}

function analyzedProfile() {
  return analysis?.profile ?? selectedProfile();
}

function eventTerm(count = 1, profile = analyzedProfile()) {
  return count === 1 ? profile.eventSingular : profile.eventPlural;
}

function occurrenceLabel(index, profile = analyzedProfile()) {
  const prefix = profile.eventIdPrefix ?? "E";
  return `${prefix}${String(index + 1).padStart(3, "0")}`;
}

function resolveBuiltInId(id) {
  return SOURCE_ID_ALIASES[id] ?? id;
}

function selectedBuiltIn() {
  return getAcousticBuiltInSource(resolveBuiltInId($("built-in-source").value));
}

function captureIsActive() {
  return Boolean(liveCapture) && (liveStarting || liveStopping || liveCapture.state !== "idle");
}

function analysisMatchesProfile() {
  const profile = selectedProfile();
  return Boolean(analysis?.strophes)
    && analysis.profileId === profile.id
    && analyzedParameterKey === analysisParameterKey(analysisParameters(profile), profile);
}

function setAudioEnabled(enabled) {
  const cancelledRender = pendingPlayback;
  const stoppedPlayback = !routeAudio.paused;
  audioEnabled = Boolean(enabled);
  $("audioButton").setAttribute("aria-pressed", String(audioEnabled));
  $("audioState").textContent = audioEnabled ? "on" : "off";
  routeAudio.muted = !audioEnabled;
  if (!audioEnabled && (!routeAudio.paused || pendingPlayback)) stopPlayback(false, true);
  if (!audioEnabled && cancelledRender) {
    setStatus("Audio off; the pending model render was cancelled.", "ready");
  } else if (!audioEnabled && stoppedPlayback) {
    setStatus("Audio off; playback stopped.", "ready");
  }
}

function updateLevel() {
  const level = clamp($("level").value, 0, 0.85);
  $("levelOut").textContent = `${Math.round(level * 100)}%`;
  routeAudio.volume = level;
}

function updateRangeOutputs() {
  const profile = selectedProfile();
  $("route-length-out").textContent = `${$("route-length").value} ${profile.eventPlural}`;
  $("surprise-out").textContent = `${Math.round(Number($("surprise").value) * 100)}% variation`;
}

function resynthesisSettings() {
  return normalizeAcousticResynthesis({
    speedRatio: Number((2 ** finite($("gesture-speed").value)).toFixed(3)),
    pitchShiftSemitones: finite($("pitch-shift").value),
    bodyScale: Number((2 ** finite($("body-scale").value)).toFixed(3)),
    textureAmount: finite($("texture-amount").value, 1),
    manifoldExaggeration: finite($("manifold-exaggeration").value, 1),
    gapSeconds: finite(
      $("route-gap").value,
      ACOUSTIC_RESYNTHESIS_LIMITS.gapSeconds.default * 1_000,
    ) / 1_000,
  });
}

function resynthesisKey(settings = resynthesisSettings()) {
  return [
    settings.speedRatio,
    settings.pitchShiftSemitones,
    settings.bodyScale,
    settings.textureAmount,
    settings.manifoldExaggeration,
    settings.gapSeconds,
    settings.mapPositionNormalized?.x,
    settings.mapPositionNormalized?.y,
    settings.mapPositionNormalized?.z,
  ].map((value) => finite(value).toFixed(6)).join(":");
}

function setResynthesisInputs(settings) {
  const normalized = normalizeAcousticResynthesis(settings);
  $("gesture-speed").value = String(Math.log2(normalized.speedRatio));
  $("pitch-shift").value = String(normalized.pitchShiftSemitones);
  $("body-scale").value = String(Math.log2(normalized.bodyScale));
  $("texture-amount").value = String(normalized.textureAmount);
  $("manifold-exaggeration").value = String(normalized.manifoldExaggeration);
  $("route-gap").value = String(Math.round(normalized.gapSeconds * 1_000));
}

function signedSemitones(value) {
  const rounded = Math.round(finite(value));
  return `${rounded > 0 ? "+" : ""}${rounded} st`;
}

function updateResynthesisPresentation({ markCustom = false } = {}) {
  const settings = resynthesisSettings();
  if (markCustom) $("resynthesis-preset").value = "custom";
  $("gesture-speed-out").textContent = `${settings.speedRatio.toFixed(3)}×`;
  $("pitch-shift-out").textContent = signedSemitones(settings.pitchShiftSemitones);
  $("body-scale-out").textContent = `${settings.bodyScale.toFixed(2)}×`;
  $("texture-amount-out").textContent = `${settings.textureAmount.toFixed(2)}×`;
  $("manifold-exaggeration-out").textContent = `${settings.manifoldExaggeration.toFixed(2)}×`;
  $("route-gap-out").textContent = `${Math.round(settings.gapSeconds * 1_000)} ms`;
  $("gesture-speed").setAttribute("aria-valuetext", `${settings.speedRatio.toFixed(3)} times`);
  $("pitch-shift").setAttribute("aria-valuetext", `${settings.pitchShiftSemitones} semitones`);
  $("body-scale").setAttribute("aria-valuetext", `${settings.bodyScale.toFixed(2)} times`);
  $("texture-amount").setAttribute("aria-valuetext", `${settings.textureAmount.toFixed(2)} times`);
  $("manifold-exaggeration").setAttribute(
    "aria-valuetext",
    `${settings.manifoldExaggeration.toFixed(2)} times`,
  );
  $("route-gap").setAttribute(
    "aria-valuetext",
    `${Math.round(settings.gapSeconds * 1_000)} milliseconds`,
  );
  const summary = $("resynthesis-summary");
  const physical = $("listen-mode").value === "physical";
  $("resynthesis-title").closest(".resynthesis-card").dataset.listenMode = physical
    ? "physical"
    : "recording";
  summary.dataset.mode = settings.transformed ? "extrapolated" : "anchor";
  summary.querySelector("strong").textContent = settings.transformed
    ? "EXTRAPOLATED MODEL"
    : "ANALYZED ANCHOR";
  const routedTransforms = analysisMatchesProfile() && route.length
    ? route.map((index) => acousticResynthesisForOccurrence(analysis, index, settings))
    : [];
  const routedRange = settings.manifoldExaggeration > 1 && routedTransforms.length
    ? ` Routed nodes span ${Math.min(...routedTransforms.map(({ speedRatio }) => speedRatio)).toFixed(2)}–${Math.max(...routedTransforms.map(({ speedRatio }) => speedRatio)).toFixed(2)}× speed and ${signedSemitones(Math.min(...routedTransforms.map(({ pitchShiftSemitones }) => pitchShiftSemitones)))} to ${signedSemitones(Math.max(...routedTransforms.map(({ pitchShiftSemitones }) => pitchShiftSemitones)))}.`
    : "";
  summary.querySelector("span").textContent = physical
    ? `${settings.speedRatio.toFixed(3)}× gesture · ${signedSemitones(settings.pitchShiftSemitones)} · ${settings.bodyScale.toFixed(2)}× body · ${settings.manifoldExaggeration.toFixed(2)}× 3D spread.${routedRange} PCA mappings are artistic, not measured physiological limits.`
    : `${settings.speedRatio.toFixed(3)}× pitch-preserving source preview; model pitch, body, texture, and 3D spread are parked until Model sketch is selected.`;
}

function commitResynthesisChange(message = "Resynthesis controls updated; play or export to render them.") {
  stopPlayback(false, true);
  invalidateRouteRender();
  modelCache.clear();
  updateResynthesisPresentation();
  setBusy(false);
  setStatus(message, "ready");
}

function setBusy(nextBusy) {
  busy = Boolean(nextBusy);
  const currentAnalysis = analysisMatchesProfile();
  const parameterIssue = analysisParameterIssue();
  const hasEvents = currentAnalysis && analysis.strophes.length > 0;
  const hasRoute = hasEvents && route.length > 0;
  const captureActive = captureIsActive();
  const locked = busy || captureActive;

  $("reanalyze").disabled = locked || !sourceSamples || Boolean(parameterIssue);
  $("build-route").disabled = locked || !hasEvents;
  $("reverse-route").disabled = locked || !hasRoute;
  $("play-route").disabled = locked || !hasRoute;
  $("stop-route").disabled = routeAudio.paused && !pendingPlayback;
  $("audition-selected").disabled = locked || !hasEvents || selectedIndex === null;
  $("add-selected").disabled = locked || !hasEvents || selectedIndex === null;
  $("clear-route").disabled = locked || !hasRoute;
  $("export-physical").disabled = locked || !hasRoute;
  $("export-json").disabled = locked || !hasRoute;
  $("audio-file").disabled = locked;
  $("load-built-in").disabled = locked;
  $("built-in-source").disabled = locked;
  $("analysis-profile").disabled = locked;
  $("walk-rule").disabled = locked;
  $("route-length").disabled = locked;
  $("surprise").disabled = locked || !["similarity", "hybrid"].includes($("walk-rule").value);
  for (const id of ANALYSIS_INPUT_IDS) $(id).disabled = locked;
  $("reset-analysis-parameters").disabled = locked;
  $("resynthesis-preset").disabled = locked;
  $("gesture-speed").disabled = locked;
  $("route-gap").disabled = locked;
  const modelControlsLocked = locked || $("listen-mode").value !== "physical";
  for (const id of ["pitch-shift", "body-scale", "texture-amount", "manifold-exaggeration"]) {
    $(id).disabled = modelControlsLocked;
  }
  $("reset-resynthesis").disabled = locked;
  $("start-live-input").disabled = busy || captureActive;
  $("start-live-input").setAttribute("aria-pressed", String(captureActive));
  $("capture-live-input").disabled = (!liveCapture?.isRecording && !liveStarting) || liveStopping;
  $("capture-live-input").textContent = liveStarting
    ? "Cancel request"
    : liveStopping
      ? "Stopping…"
      : "Stop + map audio";
  $("live-window-seconds").disabled = captureActive || busy;
  $("live-input-device").disabled = captureActive || busy || !microphonePermissionSeen;
  $("acoustic-manifold-root").setAttribute("aria-busy", String(busy));
}

function safeStem(filename) {
  return String(filename)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "acoustic-route";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function routeKey(indices, mode) {
  return `${analysis?.profileId ?? "none"}:${analyzedParameterKey}:${mode}:${resynthesisKey()}:${indices.join(",")}`;
}

function invalidateRouteRender() {
  routeRender = null;
  routeRenderKey = "";
  revokeUrl(routeUrl);
  routeUrl = "";
  routeAudio.removeAttribute("src");
  routeAudio.load();
}

function formatSeconds(value) {
  return `${finite(value).toFixed(2)} s`;
}

function appendCreditLink(container, label, url) {
  if (!url) return;
  container.append(document.createTextNode(" · "));
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  container.append(link);
}

function renderSourceCredit(origin = sourceOrigin, { selected = false } = {}) {
  const output = $("source-credit");
  output.replaceChildren();
  if (!origin) {
    output.textContent = "No source loaded.";
    return;
  }
  if (origin.kind === "procedural") {
    output.textContent = `${selected ? "Selected · " : ""}${origin.attribution} · ${origin.license} · no recording or source samples.`;
    return;
  }
  if (origin.kind === "recording") {
    output.append(document.createTextNode(
      `${selected ? "Selected · " : ""}${origin.attribution} · ${origin.license}`,
    ));
    appendCreditLink(output, "source page", origin.sourceUrl);
    appendCreditLink(output, "license", origin.licenseUrl);
    if (origin.note) output.append(document.createTextNode(` · ${origin.note}`));
    return;
  }
  if (origin.kind === "upload") {
    output.textContent = "Your local file · decoded and analyzed only in this browser session.";
    return;
  }
  output.textContent = "Microphone PCM · captured and analyzed only in this browser session.";
}

function formatHertz(value) {
  const hertz = finite(value);
  if (hertz >= 100_000) return `${Math.round(hertz / 1_000)} kHz`;
  if (hertz >= 1_000) {
    const digits = hertz < 10_000 && hertz % 1_000 ? 1 : 0;
    return `${(hertz / 1_000).toFixed(digits)} kHz`;
  }
  return `${Math.round(hertz)} Hz`;
}

function formatRate(value) {
  const rate = finite(value);
  return rate % 1_000 === 0
    ? `${Math.round(rate / 1_000)} kHz`
    : `${(rate / 1_000).toFixed(1)} kHz`;
}

function formatDuration(value) {
  const seconds = finite(value);
  if (seconds < 0.01) return `${(seconds * 1_000).toFixed(seconds < 0.001 ? 2 : 1)} ms`;
  if (seconds < 1) return `${Math.round(seconds * 1_000)} ms`;
  return `${seconds.toFixed(seconds < 10 && seconds % 1 ? 1 : 0)} s`;
}

function populateBuiltInSourceSelect() {
  const select = $("built-in-source");
  const previous = resolveBuiltInId(select.value || "thrush-nightingale-synthetic");
  select.replaceChildren();
  for (const group of ACOUSTIC_BUILT_IN_SOURCE_GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const sourceId of group.sourceIds) {
      const source = getAcousticBuiltInSource(sourceId);
      const option = document.createElement("option");
      option.value = source.id;
      option.dataset.profile = source.profileId;
      option.textContent = source.label.replace(/^(?:Synthetic|Recording) · /, "");
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  select.value = ACOUSTIC_BUILT_IN_SOURCES.some((entry) => entry.id === previous)
    ? previous
    : "thrush-nightingale-synthetic";
  const recordings = ACOUSTIC_BUILT_IN_SOURCES.filter((entry) => entry.kind === "recording").length;
  $("built-in-count").textContent = `${recordings} recordings + 2 generated studies`;
}

function populateProfileSelect() {
  const select = $("analysis-profile");
  const previous = select.value || "songbird";
  select.replaceChildren();
  for (const group of ACOUSTIC_PROFILE_GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const profileId of group.profileIds) {
      const profile = ACOUSTIC_PROFILES[profileId];
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.shortLabel;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  select.value = ACOUSTIC_PROFILES[previous] ? previous : "songbird";
  $("profile-count").textContent = `${Object.keys(ACOUSTIC_PROFILES).length} operational presets`;
}

function renderProfileEvidence(profile) {
  $("profile-research-title").textContent = profile.label;
  const focus = profile.expectedFocus
    ? ` · expected ${profile.expectedFocus.kind} ${formatHertz(profile.expectedFocus.minimumHz)}–${formatHertz(profile.expectedFocus.maximumHz)}`
    : "";
  const geometry = [
    `analysis ${formatHertz(profile.minimumSpectralHz)}–${formatHertz(profile.maximumSpectralHz)}`,
    `${formatRate(profile.recording.recommendedSampleRate)} source recommended`,
    profile.segmentationMode === "fixed-window"
      ? `${profile.fixedWindowSeconds} s overlapping windows`
      : `${formatDuration(profile.stropheGapSeconds)} internal-gap join`,
  ];
  if (profile.sequenceGapSeconds !== null) {
    geometry.push(`${formatDuration(profile.sequenceGapSeconds)} sequence break`);
  }
  $("profile-band").textContent = geometry.join(" · ") + focus;
  $("profile-basis").textContent = profile.basis;
  const links = $("profile-evidence");
  links.replaceChildren();
  if (!profile.evidence.length) {
    links.textContent = "Exploratory baseline · no taxon-specific research claim";
  } else {
    profile.evidence.forEach((source, index) => {
      if (index) links.append(document.createTextNode(" · "));
      const anchor = document.createElement("a");
      anchor.href = source.url;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      anchor.textContent = source.label;
      links.append(anchor);
    });
  }
  $("profile-capture-note").textContent = profile.recording.sourceRateNote;
}

function renderProfileLibrary() {
  const library = $("profile-library");
  library.replaceChildren();
  for (const group of ACOUSTIC_PROFILE_GROUPS) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = `${group.label} · ${group.profileIds.length}`;
    const list = document.createElement("ul");
    for (const profileId of group.profileIds) {
      const profile = ACOUSTIC_PROFILES[profileId];
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = profile.label;
      button.addEventListener("click", () => {
        $("analysis-profile").value = profile.id;
        updateProfilePresentation({ announce: true });
        $("analysis-profile").focus();
      });
      const band = document.createElement("span");
      band.textContent = `${formatHertz(profile.minimumSpectralHz)}–${formatHertz(profile.maximumSpectralHz)} · ${profile.segmentationMode}`;
      item.append(button, band);
      list.append(item);
    }
    section.append(heading, list);
    library.append(section);
  }
}

function renderArchiveLibrary() {
  const library = $("archive-library");
  const groupSelect = $("archive-group");
  const previousGroup = groupSelect.value;
  library.replaceChildren();
  const allGroupsOption = document.createElement("option");
  allGroupsOption.value = "";
  allGroupsOption.textContent = "All collection paths";
  groupSelect.replaceChildren(allGroupsOption);
  for (const group of ACOUSTIC_ARCHIVE_GROUPS) {
    const groupOption = document.createElement("option");
    groupOption.value = group.label;
    groupOption.textContent = group.label;
    groupSelect.append(groupOption);
    const section = document.createElement("section");
    section.dataset.archiveGroup = group.label;
    const heading = document.createElement("h3");
    heading.textContent = `${group.label} · ${group.collectionIds.length}`;
    section.append(heading);
    for (const collectionId of group.collectionIds) {
      const collection = ACOUSTIC_ARCHIVE_COLLECTIONS.find((entry) => entry.id === collectionId);
      const article = document.createElement("article");
      article.dataset.archiveKind = group.label.startsWith("Community") ? "community" : "wildlife";
      article.dataset.archiveGroup = group.label;
      article.dataset.archiveSearch = [
        collection.label,
        collection.scope,
        collection.access,
        collection.profileHints,
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      const title = document.createElement("h4");
      const sourceLink = document.createElement("a");
      sourceLink.href = collection.sourceUrl;
      sourceLink.target = "_blank";
      sourceLink.rel = "noreferrer";
      sourceLink.textContent = collection.label;
      title.append(sourceLink);
      const scope = document.createElement("p");
      scope.textContent = collection.scope;
      const terms = document.createElement("p");
      const access = document.createElement("strong");
      access.textContent = collection.access;
      terms.append(access, document.createTextNode(` · ${collection.reuse}`));
      if (collection.rightsUrl) appendCreditLink(terms, "rights / terms", collection.rightsUrl);
      const guidance = document.createElement("p");
      guidance.className = "archive-guidance";
      guidance.textContent = collection.importGuidance;
      const policy = document.createElement("p");
      policy.className = "archive-policy";
      policy.textContent = collection.transformationPolicy;
      article.append(title, scope, terms, guidance, policy);
      if (collection.profileHints) {
        const hints = document.createElement("small");
        hints.textContent = `Profile leads · ${collection.profileHints}`;
        article.append(hints);
      }
      section.append(article);
    }
    library.append(section);
  }
  groupSelect.value = ACOUSTIC_ARCHIVE_GROUPS.some((group) => group.label === previousGroup)
    ? previousGroup
    : "";
  $("archive-count").textContent = `${ACOUSTIC_ARCHIVE_COLLECTIONS.length} curated collections`;
  filterArchiveLibrary();
}

function filterArchiveLibrary() {
  const query = $("archive-search").value.trim().toLocaleLowerCase();
  const selectedGroup = $("archive-group").value;
  let visible = 0;
  for (const article of $("archive-library").querySelectorAll("article")) {
    const matchesGroup = !selectedGroup || article.dataset.archiveGroup === selectedGroup;
    const matchesQuery = !query || article.dataset.archiveSearch.includes(query);
    article.hidden = !(matchesGroup && matchesQuery);
    if (!article.hidden) visible += 1;
  }
  for (const section of $("archive-library").querySelectorAll("section")) {
    section.hidden = !section.querySelector("article:not([hidden])");
  }
  $("archive-results").textContent = `${visible} of ${ACOUSTIC_ARCHIVE_COLLECTIONS.length} collections shown`;
}

function updateSourceCompatibility() {
  const output = $("source-compatibility");
  const parameters = analysisParameters();
  if (!sourceSamples) {
    const analysisCeiling = parameters.analysisTargetRate * 0.48;
    const rateLimited = analysisCeiling < parameters.maximumSpectralHz * 0.995;
    output.textContent = rateLimited
      ? `Analysis-rate limit: ${formatRate(parameters.analysisTargetRate)} can represent features only to about ${formatHertz(analysisCeiling)}. Raise it before loading a source if you need the full ${formatHertz(parameters.maximumSpectralHz)} ceiling.`
      : "Load a source to check whether its sample rate covers the tuned feature band.";
    output.dataset.coverage = rateLimited ? "limited" : "unknown";
    return;
  }
  const sourceMaximumHz = sourceSampleRate * 0.48;
  const analysisMaximumHz = parameters.analysisTargetRate * 0.48;
  const availableMaximumHz = Math.min(sourceMaximumHz, analysisMaximumHz);
  const fullBand = availableMaximumHz >= parameters.maximumSpectralHz * 0.995;
  const decoding = sourceDecodeMetadata?.label ?? "source PCM";
  output.dataset.coverage = fullBand ? "full" : "limited";
  if (fullBand) {
    output.textContent = `${formatRate(sourceSampleRate)} ${decoding} and the ${formatRate(parameters.analysisTargetRate)} analysis-rate ceiling cover the tuned ${formatHertz(parameters.maximumSpectralHz)} feature edge.`;
    return;
  }
  output.textContent = sourceMaximumHz <= analysisMaximumHz
    ? `Source-rate limit: ${formatRate(sourceSampleRate)} ${decoding} supports features only to about ${formatHertz(sourceMaximumHz)}, below the tuned ${formatHertz(parameters.maximumSpectralHz)} ceiling.`
    : `Analysis-rate limit: the ${formatRate(parameters.analysisTargetRate)} ceiling uses features only to about ${formatHertz(analysisMaximumHz)} although this source contains a wider band.`;
}

function updateProfilePresentation({ announce = false } = {}) {
  const profile = selectedProfile();
  if (analysisControlsProfileId !== profile.id) {
    setAnalysisParameterInputs(defaultAnalysisParameters(profile), profile);
    analysisControlsProfileId = profile.id;
  }
  renderProfileEvidence(profile);
  const physicalOption = $("listen-mode").querySelector("option[value='physical']");
  physicalOption.textContent = "Model sketch · no samples";
  updateRangeOutputs();
  updateListenPresentation();

  if (analysis && analysis.profileId !== profile.id) {
    stopPlayback(false, true);
    clearAnalysisState();
    if (announce) {
      setStatus(
        `${profile.label} selected. This is an analysis prior, not species recognition; choose Analyze and rebuild map to apply it.`,
        "ready",
      );
    }
  }
  updateNodeList();
  updateSelected();
  updateAnalysisParameterPresentation();
  setBusy(busy);
}

function robustLevelReference(values, quantile = 0.9) {
  const sorted = values
    .map((value) => Math.max(0, finite(value)))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return 1;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function relativeRmsLevel(value, reference) {
  if (!(value > 0) || !(reference > 0)) return 0;
  return clamp(value / reference);
}

function familyColour(family) {
  const index = Math.max(0, Math.round(finite(family, 1)) - 1);
  return FAMILY_COLOURS[index % FAMILY_COLOURS.length];
}

function frequencyColour(frequencyHz, minimumHz, maximumHz) {
  const minimum = Math.max(1, finite(minimumHz, 1));
  const maximum = Math.max(minimum + 1, finite(maximumHz, minimum + 1));
  const amount = clamp(
    (Math.log(Math.max(minimum, finite(frequencyHz, minimum))) - Math.log(minimum))
      / Math.max(1e-9, Math.log(maximum) - Math.log(minimum)),
  );
  if (amount < 0.33) return "#efbe67";
  if (amount < 0.67) return "#58d6d1";
  return "#64aee8";
}

function updateRecordingTimeline() {
  const timeline = $("recording-order");
  timeline.replaceChildren();
  const profile = analysisMatchesProfile() ? analyzedProfile() : selectedProfile();
  const orderLabels = analysisMatchesProfile() && analysis?.strophes.length
    ? analysis.strophes.slice(0, 2).map((occurrence) => occurrenceLabel(occurrence.index, profile))
    : [occurrenceLabel(0, profile), occurrenceLabel(1, profile)];
  const orderExample = orderLabels.join(" → ");
  $("recording-order-note").textContent = `${orderExample} · bar = recording-relative RMS`;
  $("recorded-order-example").textContent = orderExample;
  if (!analysisMatchesProfile() || !analysis?.strophes.length) {
    const empty = document.createElement("li");
    empty.className = "recording-order-empty";
    empty.textContent = "Occurrences appear after analysis";
    timeline.append(empty);
    return;
  }
  const reference = robustLevelReference(
    analysis.strophes.map((occurrence) => occurrence.energy),
  );
  analysis.strophes.forEach((occurrence, index) => {
    const item = document.createElement("li");
    if (index > 0 && occurrence.sequenceGroup !== analysis.strophes[index - 1].sequenceGroup) {
      item.dataset.sequenceStart = "true";
    }
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.stropheIndex = String(occurrence.index);
    button.style.setProperty(
      "--event-level",
      `${Math.round(14 + relativeRmsLevel(occurrence.energy, reference) * 86)}%`,
    );
    button.style.setProperty("--family-colour", familyColour(occurrence.family));
    button.setAttribute("aria-current", String(occurrence.index === selectedIndex));
    button.setAttribute(
      "aria-label",
      `${occurrenceLabel(occurrence.index, profile)}, recorded occurrence ${index + 1} of ${analysis.strophes.length}, relative level ${Math.round(relativeRmsLevel(occurrence.energy, reference) * 100)} percent, ${(occurrence.tones ?? []).length} active-run candidates`,
    );
    const label = document.createElement("b");
    label.textContent = occurrenceLabel(occurrence.index, profile);
    const meter = document.createElement("i");
    meter.className = "recording-level-glyph";
    meter.setAttribute("aria-hidden", "true");
    const time = document.createElement("small");
    time.textContent = formatSeconds(occurrence.startSeconds);
    button.append(label, meter, time);
    button.addEventListener("click", () => selectOccurrence(occurrence.index, true));
    item.append(button);
    timeline.append(item);
  });
}

function sampledOccurrenceFrames(occurrence, maximum = 96) {
  const start = Math.max(0, Math.round(finite(occurrence?.frameStart)));
  const end = Math.min(
    Math.max(0, (analysis?.frames?.length ?? 1) - 1),
    Math.round(finite(occurrence?.frameEnd, start)),
  );
  const count = Math.max(0, end - start + 1);
  if (!count) return [];
  const frameIndices = new Set();
  const uniformCount = Math.min(count, maximum);
  for (let index = 0; index < uniformCount; index += 1) {
    frameIndices.add(start + Math.round(index / Math.max(1, uniformCount - 1) * (count - 1)));
  }
  // Keep each active-run candidate's endpoints and midpoint even when the
  // overview must decimate a long occurrence.
  for (const tone of occurrence.tones ?? []) {
    const toneStart = Math.round(clamp(tone.startFrame, start, end, start));
    const toneEnd = Math.round(clamp(tone.endFrame, toneStart, end, toneStart));
    frameIndices.add(toneStart);
    frameIndices.add(Math.round((toneStart + toneEnd) * 0.5));
    frameIndices.add(toneEnd);
  }
  const tones = occurrence.tones ?? [];
  return [...frameIndices]
    .sort((left, right) => left - right)
    .map((frameIndex) => ({
      frameIndex,
      frame: analysis.frames[frameIndex],
      toneIndex: tones.findIndex((tone) => (
        frameIndex >= tone.startFrame && frameIndex <= tone.endFrame
      )),
    }));
}

function renderSelectedSignalGlyph(occurrence) {
  const figure = $("selected-signal");
  const amplitudeArea = $("selected-amplitude-area");
  const frequencyTrace = $("selected-frequency-trace");
  const frameBeads = $("selected-frame-beads");
  const toneMarkers = $("selected-tone-markers");
  frameBeads.replaceChildren();
  toneMarkers.replaceChildren();
  if (!occurrence || !analysisMatchesProfile()) {
    figure.hidden = true;
    amplitudeArea.removeAttribute("d");
    frequencyTrace.removeAttribute("d");
    return;
  }
  const frames = sampledOccurrenceFrames(occurrence);
  if (!frames.length) {
    figure.hidden = true;
    return;
  }
  const left = 12;
  const right = 308;
  const top = 9;
  const bottom = 91;
  const amplitudeBaseline = 91;
  const amplitudeHeight = 35;
  const rmsReference = Math.max(1e-9, ...frames.map(({ frame }) => finite(frame.rms)));
  const minimumHz = Math.max(1, finite(analysis.spectralRange?.minimumHz, 1));
  const maximumHz = Math.max(minimumHz + 1, finite(analysis.spectralRange?.maximumHz, minimumHz + 1));
  const frameSpan = Math.max(1, occurrence.frameEnd - occurrence.frameStart);
  const xFor = (frameIndex) => left + clamp(
    (frameIndex - occurrence.frameStart) / frameSpan,
  ) * (right - left);
  const yForFrequency = (frequencyHz) => bottom - clamp(
    (Math.log(Math.max(minimumHz, finite(frequencyHz, minimumHz))) - Math.log(minimumHz))
      / Math.max(1e-9, Math.log(maximumHz) - Math.log(minimumHz)),
  ) * (bottom - top);
  const envelope = frames.map(({ frame, frameIndex }) => (
    `${xFor(frameIndex).toFixed(2)} ${(amplitudeBaseline - Math.sqrt(clamp(frame.rms / rmsReference)) * amplitudeHeight).toFixed(2)}`
  ));
  amplitudeArea.setAttribute(
    "d",
    `M ${left} ${amplitudeBaseline} L ${envelope.join(" L ")} L ${right} ${amplitudeBaseline} Z`,
  );
  let trace = "";
  let penDown = false;
  let previousToneIndex = -1;
  frames.forEach(({ frame, frameIndex, toneIndex }) => {
    if (!frame.active || !(frame.peakHz > 0)) {
      penDown = false;
      previousToneIndex = -1;
      return;
    }
    const x = xFor(frameIndex);
    const y = yForFrequency(frame.peakHz);
    const continuesRun = penDown && toneIndex >= 0 && toneIndex === previousToneIndex;
    trace += `${continuesRun ? " L" : " M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    penDown = true;
    previousToneIndex = toneIndex;
    const bead = document.createElementNS(SVG_NAMESPACE, "circle");
    bead.setAttribute("cx", x.toFixed(2));
    bead.setAttribute("cy", y.toFixed(2));
    bead.setAttribute("r", (1.2 + Math.sqrt(clamp(frame.rms / rmsReference)) * 1.8).toFixed(2));
    bead.setAttribute("fill", frequencyColour(frame.peakHz, minimumHz, maximumHz));
    frameBeads.append(bead);
  });
  frequencyTrace.setAttribute("d", trace.trim());
  for (const tone of occurrence.tones ?? []) {
    const amount = clamp(
      (tone.startFrame + tone.endFrame) * 0.5 - occurrence.frameStart,
      0,
      Math.max(1, occurrence.frameEnd - occurrence.frameStart),
    ) / Math.max(1, occurrence.frameEnd - occurrence.frameStart);
    const x = left + amount * (right - left);
    const marker = document.createElementNS(SVG_NAMESPACE, "line");
    marker.setAttribute("x1", x.toFixed(2));
    marker.setAttribute("x2", x.toFixed(2));
    marker.setAttribute("y1", String(top));
    marker.setAttribute("y2", String(bottom));
    toneMarkers.append(marker);
  }
  $("selected-signal-glyph").setAttribute(
    "aria-label",
    `${occurrenceLabel(occurrence.index)} detail: RMS shape normalized within this occurrence, dominant spectral-peak trace across ${frames.length} displayed analysis frames, and ${(occurrence.tones ?? []).length} active-run candidates.`,
  );
  figure.hidden = false;
}

function updateStats() {
  if (!analysis) {
    for (const id of [
      "strophe-stat",
      "tone-stat",
      "frame-stat",
      "duration-stat",
      "variance-stat",
      "analysis-rate-stat",
    ]) $(id).textContent = "—";
    return;
  }
  const activeFrames = analysis.frames.filter((frame) => frame.active).length;
  $("strophe-stat").textContent = String(analysis.strophes.length);
  $("tone-stat").textContent = String(analysis.tones?.length ?? 0);
  $("frame-stat").textContent = `${activeFrames} / ${analysis.frames.length}`;
  $("duration-stat").textContent = `${analysis.durationSeconds.toFixed(1)} s`;
  $("variance-stat").textContent = Number.isFinite(analysis.embedding.explainedVarianceTotal)
    ? `${Math.round(analysis.embedding.explainedVarianceTotal * 100)}%`
    : "—";
  $("analysis-rate-stat").textContent = formatRate(analysis.analysisSampleRate);
}

function clearAnalysisState() {
  analysis = null;
  analyzedParameterKey = "";
  selectedIndex = null;
  route = [];
  manualRoute = [];
  activeRouteSeed = ROUTE_SEED;
  activeRouteSurprise = Number($("surprise").value);
  activeRouteRule = $("walk-rule").value;
  modelCache.clear();
  invalidateRouteRender();
  renderer.setAnalysis(null);
  renderer.setSelected(null);
  renderer.setRoute([]);
  $("manifold-canvas").dataset.acousticEvents = "0";
  $("manifold-canvas").dataset.acousticSimilarityEdges = "0";
  $("manifold-canvas").dataset.acousticSequenceEdges = "0";
  document.documentElement.removeAttribute("data-acoustic-manifold-ready");
  $("acoustic-manifold-root").dataset.analysisParameters = "pending";
  updateStats();
  updateRecordingTimeline();
  updateNodeList();
  updateSelected();
  updateRouteRibbon();
}

function updateNodeList() {
  const list = $("node-list");
  list.replaceChildren();
  if (!analysisMatchesProfile() || !analysis?.strophes.length) {
    const empty = document.createElement("li");
    empty.className = "node-empty";
    empty.textContent = analysis && !analysisMatchesProfile()
      ? "Reanalyze the source to apply the selected profile."
      : `No ${selectedProfile().segmentationMode === "fixed-window" ? "qualifying" : "pause-bounded"} ${selectedProfile().eventPlural} were found.`;
    list.append(empty);
    return;
  }
  const profile = analyzedProfile();
  for (const occurrence of analysis.strophes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.stropheIndex = String(occurrence.index);
    button.setAttribute("aria-pressed", String(occurrence.index === selectedIndex));
    button.innerHTML = `<b>${occurrenceLabel(occurrence.index, profile)}</b><span>${formatSeconds(occurrence.startSeconds)} · cluster ${occurrence.family}</span>`;
    button.setAttribute(
      "aria-label",
      `${occurrenceLabel(occurrence.index, profile)}, ${profile.eventSingular} occurrence at ${formatSeconds(occurrence.startSeconds)}, acoustic cluster ${occurrence.family}`,
    );
    button.addEventListener("click", () => selectOccurrence(occurrence.index, true));
    item.append(button);
    list.append(item);
  }
}

function updateSelected() {
  const occurrence = analysisMatchesProfile() && selectedIndex !== null
    ? analysis?.strophes[selectedIndex]
    : null;
  if (!occurrence) {
    $("selected-title").textContent = "No event selected";
    $("selected-meta").textContent = analysis && !analysisMatchesProfile()
      ? "Reanalyze the source to apply the selected profile."
      : "Choose a node in the map or the accessible list below.";
    renderSelectedSignalGlyph(null);
  } else {
    const profile = analyzedProfile();
    const scaleText = (occurrence.envelopeScales ?? [])
      .map((scale) => finite(scale.modulation).toFixed(2))
      .join(" / ");
    const details = [
      `${formatSeconds(occurrence.startSeconds)}–${formatSeconds(occurrence.endSeconds)}`,
      `${occurrence.onsetCount} onset${occurrence.onsetCount === 1 ? "" : "s"}`,
      `${(occurrence.tones ?? []).length} active-run candidate${(occurrence.tones ?? []).length === 1 ? "" : "s"}`,
      `${Math.round(relativeRmsLevel(
        occurrence.energy,
        robustLevelReference(analysis.strophes.map((event) => event.energy)),
      ) * 100)}% relative RMS level`,
      `${Math.round(finite(occurrence.medianPeakHz))} Hz median spectral peak`,
      `${finite(occurrence.trajectorySpan).toFixed(2)} trajectory span`,
    ];
    if (profile.sequenceGapSeconds !== null) details.push(`sequence group ${occurrence.sequenceGroup}`);
    if (scaleText) details.push(`envelope Δ fine / mid / broad ${scaleText}`);
    $("selected-title").textContent = `${occurrenceLabel(occurrence.index, profile)} · ${profile.eventSingular} occurrence · cluster ${occurrence.family}`;
    $("selected-meta").textContent = details.join(" · ");
    renderSelectedSignalGlyph(occurrence);
  }
  $("audition-selected").disabled = busy || captureIsActive() || !occurrence;
  $("add-selected").disabled = busy || captureIsActive() || !occurrence;
  for (const button of $("node-list").querySelectorAll("button[data-strophe-index]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.stropheIndex) === selectedIndex));
  }
  for (const button of $("recording-order").querySelectorAll("button[data-strophe-index]")) {
    button.setAttribute("aria-current", String(Number(button.dataset.stropheIndex) === selectedIndex));
  }
}

function selectOccurrence(index, focusList = false) {
  const next = Number(index);
  selectedIndex = analysisMatchesProfile() && analysis?.strophes[next] ? next : null;
  if (!routeAudio.paused) playbackRestoreIndex = selectedIndex;
  renderer.setSelected(selectedIndex);
  updateSelected();
  if (focusList && selectedIndex !== null) {
    const button = $("node-list").querySelector(`[data-strophe-index="${selectedIndex}"]`);
    button?.scrollIntoView?.({ block: "nearest" });
  }
}

function updateRouteRibbon() {
  const ribbon = $("route-ribbon");
  ribbon.replaceChildren();
  if (!route.length || !analysisMatchesProfile()) {
    const empty = document.createElement("li");
    empty.className = "route-empty";
    empty.textContent = "Build a route from the graph";
    ribbon.append(empty);
  } else {
    const profile = analyzedProfile();
    route.forEach((index, routeIndex) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.routeIndex = String(routeIndex);
      button.dataset.stropheIndex = String(index);
      button.textContent = occurrenceLabel(index, profile);
      button.setAttribute(
        "aria-label",
        `Select route step ${routeIndex + 1}, ${profile.eventSingular} ${button.textContent}`,
      );
      button.addEventListener("click", () => selectOccurrence(index, true));
      item.append(button);
      ribbon.append(item);
    });
  }
  renderer.setRoute(analysisMatchesProfile() ? route : []);
  const routeState = $("route-apply-state");
  routeState.textContent = route.length && analysisMatchesProfile() ? "Route ready" : "Build route";
  routeState.dataset.ready = String(Boolean(route.length && analysisMatchesProfile()));
  updateResynthesisPresentation();
  setBusy(busy);
}

function setRoute(indices, { manual = false } = {}) {
  if (!routeAudio.paused || pendingPlayback) stopPlayback(false, true);
  route = indices.filter((index) => analysisMatchesProfile() && analysis?.strophes[index]);
  if (manual) manualRoute = [...route];
  invalidateRouteRender();
  updateRouteRibbon();
}

function buildRoute() {
  if (!analysisMatchesProfile() || !analysis?.strophes.length) return;
  const rule = $("walk-rule").value;
  activeRouteRule = rule;
  activeRouteSurprise = Number($("surprise").value);
  activeRouteSeed = ROUTE_SEED + Math.round(activeRouteSurprise * 1_000);
  if (rule === "manual") {
    if (!manualRoute.length) manualRoute = [selectedIndex ?? 0];
    setRoute(manualRoute, { manual: true });
  } else {
    const nextRoute = buildStropheTraversal(analysis, {
      rule,
      length: Number($("route-length").value),
      surprise: activeRouteSurprise,
      startIndex: selectedIndex ?? 0,
      seed: activeRouteSeed,
    });
    setRoute([...nextRoute]);
  }
  setStatus(`Built a ${route.length}-${eventTerm(1)} ${rule} route.`, "ready");
}

function normalizeForPlayback(samples, targetPeak = 0.78) {
  const output = Float32Array.from(samples, (value) => finite(value));
  let peak = 0;
  for (const value of output) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 1e-8 ? Math.min(12, targetPeak / peak) : 0;
  for (let index = 0; index < output.length; index += 1) output[index] *= gain;
  return output;
}

function modelPlaybackDescription(rendered, count) {
  const profile = analyzedProfile();
  const controls = resynthesisSettings();
  const fallbackCount = rendered?.modelSegments?.filter((segment) => segment.fallbackUsed).length ?? 0;
  const limitedCount = rendered?.modelSegments?.filter(
    (segment) => segment.resynthesis?.timeWarpLimited,
  ).length ?? 0;
  const scaling = profile.synthesis.frequencyScale !== 1
    ? ` Source frequencies begin with the profile's ×${profile.synthesis.frequencyScale} audible mapping; gesture time is controlled independently.`
    : "";
  if (fallbackCount === count && fallbackCount > 0) {
    return `Playing ${count} ${eventTerm(count)} through a sample-free neutral descriptor fallback at ${controls.speedRatio.toFixed(3)}× gesture speed; specialist cues were unavailable for every routed occurrence.`;
  }
  if (fallbackCount > 0) {
    return `Playing ${count} ${eventTerm(count)} through the sample-free ${profile.synthesis.label.toLowerCase()}; ${fallbackCount} ${eventTerm(fallbackCount)} use a neutral descriptor fallback because specialist cues were unavailable.`;
  }
  const transform = controls.transformed
    ? ` ${controls.speedRatio.toFixed(3)}× gesture, ${signedSemitones(controls.pitchShiftSemitones)}, ${controls.manifoldExaggeration.toFixed(2)}× 3D spread.`
    : " Analysis-derived transform anchor.";
  const limit = limitedCount
    ? ` ${limitedCount} very slow ${eventTerm(limitedCount)} reached the 30-second render safety ceiling.`
    : "";
  return `Playing ${count} ${eventTerm(count)} through the sample-free ${profile.synthesis.label.toLowerCase()}.${scaling}${transform}${limit}`;
}

async function modelSegment(occurrence, version) {
  if (version !== taskVersion) throw new Error("Render superseded");
  const eventResynthesis = acousticResynthesisForOccurrence(
    analysis,
    occurrence,
    resynthesisSettings(),
  );
  const key = `${analysis.profileId}:${analyzedParameterKey}:${occurrence.index}:${resynthesisKey(eventResynthesis)}`;
  if (modelCache.has(key)) {
    if (version !== taskVersion) throw new Error("Render superseded");
    return modelCache.get(key);
  }
  const rendered = renderAcousticModelSegment(sourceSamples, analysis, occurrence, {
    seed: ROUTE_SEED + occurrence.index,
    resynthesis: eventResynthesis,
  });
  if (version !== taskVersion) throw new Error("Render superseded");
  modelCache.set(key, rendered);
  return rendered;
}

async function renderIndices(indices, mode, { announce = true } = {}) {
  if (!analysisMatchesProfile() || !indices.length) return null;
  const key = routeKey(indices, mode);
  const controls = resynthesisSettings();
  if (indices === route && routeRenderKey === key && routeRender) return routeRender;
  if (mode === "recording") {
    const assembled = assembleStropheRoute(sourceSamples, analysis, indices, {
      // Browser pitch-preserving playback also scales silence, so compensate
      // here to keep the requested wall-clock gap.
      gapSeconds: controls.gapSeconds * controls.speedRatio,
    });
    return { ...assembled, mode, modelSegments: [] };
  }

  const version = taskVersion;
  const segments = [];
  for (let position = 0; position < indices.length; position += 1) {
    if (version !== taskVersion) throw new Error("Render superseded");
    const occurrence = analysis.strophes[indices[position]];
    if (!occurrence) continue;
    if (announce) {
      setStatus(`Rendering model ${eventTerm(1)} ${position + 1} of ${indices.length}…`);
      await waitForPaint();
      if (version !== taskVersion) throw new Error("Render superseded");
    }
    segments.push(await modelSegment(occurrence, version));
  }
  const assembled = assembleAudioSegments(segments, analysis.sampleRate, {
    gapSeconds: controls.gapSeconds,
  });
  return {
    ...assembled,
    samples: normalizeForPlayback(assembled.samples),
    mode,
    modelSegments: segments,
  };
}

function stopPlayback(announce = true, cancelPending = false) {
  const cancelledRender = pendingPlayback;
  if (cancelPending) taskVersion += 1;
  pendingPlayback = false;
  routeAudio.pause();
  try {
    routeAudio.currentTime = 0;
  } catch {
    // An unloaded audio element has no seekable timeline.
  }
  cancelAnimationFrame(playbackFrame);
  playbackFrame = 0;
  $("play-route").setAttribute("aria-pressed", "false");
  $("stop-route").disabled = true;
  for (const button of $("route-ribbon").querySelectorAll("button")) {
    button.removeAttribute("data-playing");
    button.removeAttribute("aria-current");
  }
  for (const button of $("recording-order").querySelectorAll("button")) {
    button.removeAttribute("data-playing");
  }
  renderer.setSelected(playbackRestoreIndex ?? selectedIndex);
  playbackRestoreIndex = null;
  if (cancelledRender) setBusy(false);
  if (announce) setStatus("Playback stopped.", "ready");
}

function animatePlayback(timeline, highlightRoute = true) {
  cancelAnimationFrame(playbackFrame);
  let lastTimelineIndex = -1;
  const tick = () => {
    if (routeAudio.paused) return;
    const time = routeAudio.currentTime;
    const timelineIndex = timeline.findIndex((entry) => (
      time >= entry.startSeconds && time < entry.endSeconds
    ));
    if (timelineIndex !== lastTimelineIndex) {
      lastTimelineIndex = timelineIndex;
      if (highlightRoute) {
        for (const button of $("route-ribbon").querySelectorAll("button")) {
          const playing = Number(button.dataset.routeIndex) === timelineIndex;
          button.toggleAttribute("data-playing", playing);
          if (playing) button.setAttribute("aria-current", "step");
          else button.removeAttribute("aria-current");
        }
      }
      const playingStropheIndex = timelineIndex >= 0
        ? timeline[timelineIndex].stropheIndex
        : null;
      for (const button of $("recording-order").querySelectorAll("button[data-strophe-index]")) {
        button.toggleAttribute(
          "data-playing",
          playingStropheIndex !== null
            && Number(button.dataset.stropheIndex) === playingStropheIndex,
        );
      }
      if (playingStropheIndex !== null) renderer.setSelected(playingStropheIndex);
    }
    playbackFrame = requestAnimationFrame(tick);
  };
  playbackFrame = requestAnimationFrame(tick);
}

async function playIndices(indices, purpose = "route") {
  if (!indices.length || busy || captureIsActive() || !analysisMatchesProfile()) return;
  const mode = $("listen-mode").value;
  const key = routeKey(indices, mode);
  stopPlayback(false);
  const version = ++taskVersion;
  pendingPlayback = true;
  setBusy(true);
  if (!audioEnabled) setAudioEnabled(true);
  try {
    const rendered = purpose === "route" && routeRenderKey === key && routeRender
      ? routeRender
      : await renderIndices(indices, mode);
    if (version !== taskVersion || !rendered) return;
    if (purpose === "route") {
      routeRender = rendered;
      routeRenderKey = key;
    }
    revokeUrl(routeUrl);
    routeUrl = URL.createObjectURL(new Blob(
      [encodeMonoWav(rendered.samples, rendered.sampleRate)],
      { type: "audio/wav" },
    ));
    routeAudio.src = routeUrl;
    routeAudio.playbackRate = mode === "recording" ? resynthesisSettings().speedRatio : 1;
    routeAudio.preservesPitch = true;
    routeAudio.loop = purpose === "route" && $("loop-route").checked;
    routeAudio.muted = !audioEnabled;
    updateLevel();
    routeAudio.currentTime = 0;
    playbackRestoreIndex = selectedIndex;
    await routeAudio.play();
    if (version !== taskVersion) return;
    pendingPlayback = false;
    $("play-route").setAttribute("aria-pressed", purpose === "route" ? "true" : "false");
    $("stop-route").disabled = false;
    setBusy(false);
    setStatus(
      mode === "physical"
        ? modelPlaybackDescription(rendered, indices.length)
        : `Playing ${indices.length} decoded source ${eventTerm(indices.length)} slice${indices.length === 1 ? "" : "s"} at ${resynthesisSettings().speedRatio.toFixed(3)}× with browser pitch preservation.`,
      "ready",
    );
    animatePlayback(rendered.timeline, purpose === "route");
  } catch (error) {
    if (version !== taskVersion || error?.message === "Render superseded") return;
    pendingPlayback = false;
    setBusy(false);
    stopPlayback(false);
    setStatus(`Playback could not start: ${error?.message || "unknown audio error"}`, "error");
  }
}

function cancelSourceLoad() {
  sourceLoadController?.abort();
  sourceLoadController = null;
}

async function analyzeSource() {
  if (!sourceSamples) return;
  stopPlayback(false, true);
  const profile = selectedProfile();
  const parameters = analysisParameters(profile);
  const parameterIssue = analysisParameterIssue(parameters);
  if (parameterIssue) {
    updateAnalysisParameterPresentation();
    setBusy(false);
    setStatus(parameterIssue, "error");
    return;
  }
  const parameterKey = analysisParameterKey(parameters, profile);
  const version = ++taskVersion;
  clearAnalysisState();
  updateAnalysisParameterPresentation();
  setBusy(true);
  setStatus(
    profile.segmentationMode === "fixed-window"
      ? `Building overlapping ${profile.eventPlural} and extracting multiscale descriptors…`
      : `Finding pause-bounded ${profile.eventPlural} and extracting multiscale descriptors…`,
  );
  await waitForPaint();
  try {
    const next = analyzeAcousticSequence(
      sourceSamples,
      sourceSampleRate,
      profile.id,
      parameters,
    );
    if (version !== taskVersion) return;
    analysis = next;
    analyzedParameterKey = parameterKey;
    selectedIndex = analysis.strophes.length ? 0 : null;
    manualRoute = selectedIndex === null ? [] : [selectedIndex];
    renderer.setAnalysis(analysis);
    renderer.setSelected(selectedIndex);
    $("manifold-canvas").dataset.acousticEvents = String(analysis.strophes.length);
    $("manifold-canvas").dataset.acousticSimilarityEdges = String(analysis.similarityEdges.length);
    $("manifold-canvas").dataset.acousticSequenceEdges = String(
      analysis.sequenceEdges.filter((edge) => edge.withinConfiguredSequence !== false).length,
    );
    updateStats();
    updateRecordingTimeline();
    updateNodeList();
    updateSelected();
    activeRouteSurprise = Number($("surprise").value);
    activeRouteSeed = ROUTE_SEED;
    activeRouteRule = $("walk-rule").value;
    // Keep observed chronology and a listener-composed route visually distinct:
    // analysis supplies amber succession, while lime appears only after Build route.
    route = [];
    updateRouteRibbon();
    updateAnalysisParameterPresentation();
    setBusy(false);
    const cropped = sourceSamples.length > analysis.sampleCount
      ? ` The map uses the first ${analysis.durationSeconds.toFixed(0)} seconds for this profile.`
      : "";
    const bandNotice = analysis.inputCompatibility.fullRequestedBandAvailable
      ? ""
      : ` Band-limited source: ${formatHertz(analysis.inputCompatibility.availableMaximumHz)} effective ceiling.`;
    if (!analysis.strophes.length) {
      setStatus(
        profile.segmentationMode === "fixed-window"
          ? `${analysis.warning} Try a stronger signal or choose another profile.${bandNotice}`
          : `${analysis.warning} Try a cleaner signal with internal pauses near ${parameters.stropheGapSeconds.toFixed(4)} seconds, or tune the profile.${bandNotice}`,
        "error",
      );
    } else {
      const truncationNotice = analysis.segmentation.truncatedAtEventLimit
        ? ` Map capped at the first ${analysis.strophes.length} of ${analysis.segmentation.candidateCount} qualifying ${profile.eventPlural}; tighten the settings to inspect the remainder.`
        : "";
      setStatus(
        `Ready: ${analysis.strophes.length} ${eventTerm(analysis.strophes.length, profile)}, ${analysis.similarityEdges.length} similarity links. ${profile.label} is a ${analysis.profile.parameterMode === "listener-tuned" ? "listener-tuned" : "default"} prior, not a classification. Build a route to play or export.${truncationNotice}${bandNotice}${cropped}`,
        "ready",
      );
    }
    document.documentElement.dataset.acousticManifoldReady = "true";
  } catch (error) {
    if (version !== taskVersion) return;
    clearAnalysisState();
    updateAnalysisParameterPresentation();
    setBusy(false);
    setStatus(error?.message || "The acoustic sequence could not be analyzed.", "error");
  }
}

function strongestChannel(decoded) {
  let strongest = null;
  let strongestEnergy = -1;
  for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex += 1) {
    const channel = decoded.getChannelData(channelIndex);
    let energy = 0;
    const stride = Math.max(1, Math.floor(channel.length / 50_000));
    for (let index = 0; index < channel.length; index += stride) energy += channel[index] ** 2;
    if (energy > strongestEnergy) {
      strongestEnergy = energy;
      strongest = channel;
    }
  }
  return Float32Array.from(strongest ?? []);
}

async function decodeAudioBytes(bytes) {
  const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  const isRiffWave = header.length >= 12
    && String.fromCharCode(...header.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...header.slice(8, 12)) === "WAVE";
  let pcmError = null;
  if (isRiffWave) {
    try {
      const decoded = decodePcmWav(bytes);
      return {
        samples: decoded.samples,
        sampleRate: decoded.sampleRate,
        decodeMetadata: Object.freeze({
          label: "source-rate PCM WAV",
          method: "direct-pcm-wav",
          originalSampleRatePreserved: true,
          numberOfChannels: decoded.numberOfChannels,
          selectedChannelIndex: decoded.selectedChannelIndex,
          encoding: decoded.encoding,
          bitsPerSample: decoded.bitsPerSample,
        }),
      };
    } catch (error) {
      // Compressed WAV variants can still be supported by Web Audio, but that
      // path may resample and therefore is never described as source-faithful.
      pcmError = error;
    }
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser does not expose Web Audio decoding.");
  let context;
  try {
    try {
      context = new AudioContextClass({ sampleRate: 48_000 });
    } catch {
      context = new AudioContextClass();
    }
    const decoded = await context.decodeAudioData(bytes.slice(0));
    return {
      samples: strongestChannel(decoded),
      sampleRate: decoded.sampleRate,
      decodeMetadata: Object.freeze({
        label: "browser-decoded audio",
        method: "web-audio",
        originalSampleRatePreserved: false,
        numberOfChannels: decoded.numberOfChannels,
        selectedChannelIndex: null,
        pcmFallbackReason: pcmError?.message ?? null,
      }),
    };
  } finally {
    await context?.close?.().catch(() => {});
  }
}

function inspectAudioFileDuration(file) {
  return new Promise((resolve) => {
    let objectUrl;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const media = document.createElement("audio");
    let settled = false;
    let timeout = 0;
    const finish = (duration) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(objectUrl);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    };
    media.preload = "metadata";
    media.onloadedmetadata = () => finish(media.duration);
    media.onerror = () => finish(null);
    timeout = setTimeout(() => finish(null), FILE_METADATA_TIMEOUT_MS);
    media.src = objectUrl;
  });
}

function setLoadedSource({ samples, sampleRate, name, origin, decodeMetadata = null }) {
  clearAnalysisState();
  sourceSamples = samples;
  sourceSampleRate = sampleRate;
  sourceName = name;
  sourceOrigin = origin;
  sourceDecodeMetadata = decodeMetadata ?? Object.freeze({
    label: origin?.kind === "live" ? "live microphone PCM" : "locally generated PCM",
    method: origin?.kind === "live" ? "live-pcm" : "procedural-pcm",
    originalSampleRatePreserved: true,
  });
  $("source-label").textContent = sourceName;
  renderSourceCredit(sourceOrigin);
  updateSourceCompatibility();
}

async function loadSelectedBuiltIn() {
  if (busy || captureIsActive()) return;
  cancelSourceLoad();
  stopPlayback(false, true);
  const source = selectedBuiltIn();
  const version = ++taskVersion;
  setBusy(true);
  $("audio-file").value = "";
  try {
    if (source.kind === "procedural") {
      setStatus(`Generating ${source.label.toLowerCase()} locally…`);
      await waitForPaint();
      const demo = createAcousticDemo(source.id, 48_000);
      if (version !== taskVersion) return;
      setLoadedSource({
        samples: demo.samples,
        sampleRate: demo.sampleRate,
        name: demo.label,
        origin: source,
      });
    } else {
      const assetUrl = new URL(source.assetPath, document.baseURI);
      if (assetUrl.origin !== window.location.origin) {
        throw new Error("Built-in recordings must be same-origin assets.");
      }
      setStatus(`Loading bundled ${source.commonName.toLowerCase()} recording…`);
      const controller = new AbortController();
      sourceLoadController = controller;
      const response = await fetch(assetUrl, {
        cache: "force-cache",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Bundled recording returned HTTP ${response.status}`);
      const decoded = await decodeAudioBytes(await response.arrayBuffer());
      if (version !== taskVersion) return;
      setLoadedSource({
        ...decoded,
        name: `${source.commonName} (${source.scientificName}) · bundled recording`,
        origin: source,
      });
    }
    sourceLoadController = null;
    await analyzeSource();
  } catch (error) {
    if (sourceLoadController?.signal.aborted || error?.name === "AbortError") return;
    sourceLoadController = null;
    if (version !== taskVersion) return;
    setBusy(false);
    setStatus(`Could not load the built-in source: ${error?.message || "unknown audio error"}`, "error");
  }
}

async function decodeFile(file) {
  if (!file || busy || captureIsActive()) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus("That file is over 32 MB. Choose a shorter recording.", "error");
    return;
  }
  cancelSourceLoad();
  stopPlayback(false, true);
  const version = ++taskVersion;
  setBusy(true);
  setStatus(`Checking ${file.name} locally before decoding…`);
  await waitForPaint();
  try {
    const duration = await inspectAudioFileDuration(file);
    if (version !== taskVersion) return;
    if (duration && duration > MAX_FILE_DURATION_SECONDS) {
      setBusy(false);
      setStatus("That recording is over 2 minutes. Trim it before loading; profile analysis is bounded to keep the map responsive.", "error");
      return;
    }
    setStatus(`Decoding ${file.name} locally…`);
    await waitForPaint();
    const decoded = await decodeAudioBytes(await file.arrayBuffer());
    if (version !== taskVersion) return;
    setLoadedSource({
      ...decoded,
      name: file.name,
      origin: { kind: "upload", name: file.name },
    });
    await analyzeSource();
  } catch (error) {
    if (version !== taskVersion) return;
    setBusy(false);
    setStatus(`Could not decode ${file.name}: ${error?.message || "unsupported audio"}`, "error");
  }
}

async function populateInputDevices() {
  if (typeof navigator.mediaDevices?.enumerateDevices !== "function") return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (disposed) return;
    const inputs = devices.filter((device) => device.kind === "audioinput");
    const select = $("live-input-device");
    const previous = select.value;
    select.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "default";
    defaultOption.textContent = "System default";
    select.append(defaultOption);
    inputs.forEach((device, index) => {
      if (!device.deviceId || device.deviceId === "default") return;
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${index + 1}`;
      select.append(option);
    });
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
    microphonePermissionSeen = true;
    setBusy(busy);
  } catch {
    // A successful current capture can continue even if device enumeration is restricted.
  }
}

function updateLiveLevel(level) {
  if (disposed) return;
  const meter = $("live-input-meter");
  const previous = finite(meter.value);
  meter.value = Math.max(clamp(level), previous * 0.76);
}

function updateLiveProgress(progress) {
  if (disposed || !liveCapture) return;
  const now = performance.now?.() ?? Date.now();
  if (
    progress.elapsedSeconds > 0
    && progress.progress < 1
    && now - lastLiveAnnouncementAt < 250
  ) return;
  lastLiveAnnouncementAt = now;
  $("live-input-state").textContent = `Recording ${progress.elapsedSeconds.toFixed(1)} / ${progress.maxDurationSeconds.toFixed(0)} s`;
}

async function finishLiveCapture(capture, version, result) {
  if (disposed || version !== liveCaptureVersion || capture !== liveCapture) return;
  liveCapture = null;
  liveStarting = false;
  liveStopping = false;
  $("live-input-meter").value = 0;
  setBusy(busy);
  if (!result) {
    $("live-input-state").textContent = "Microphone off";
    return;
  }
  if (result.duration < MINIMUM_USEFUL_CAPTURE_SECONDS || result.samples.length < 32) {
    $("live-input-state").textContent = "Capture too short";
    setStatus(`Record at least ${MINIMUM_USEFUL_CAPTURE_SECONDS.toFixed(1)} seconds before mapping.`, "error");
    return;
  }
  $("live-input-state").textContent = `Captured ${result.duration.toFixed(1)} s · mapping`;
  $("audio-file").value = "";
  setLoadedSource({
    samples: result.samples,
    sampleRate: result.sampleRate,
    name: `Live microphone capture · ${result.duration.toFixed(1)} s`,
    origin: { kind: "live", durationSeconds: result.duration },
  });
  await analyzeSource();
  if (disposed || version !== liveCaptureVersion) return;
  if (analysisMatchesProfile() && analysis.strophes.length) {
    $("live-input-state").textContent = `Mapped ${analysis.strophes.length} ${eventTerm(analysis.strophes.length)} · microphone off`;
  } else {
    $("live-input-state").textContent = `Analyzed · no ${selectedProfile().eventPlural} · microphone off`;
  }
}

function failLiveCapture(capture, version, error) {
  if (disposed || version !== liveCaptureVersion || capture !== liveCapture) return;
  liveCapture = null;
  liveStarting = false;
  liveStopping = false;
  $("live-input-meter").value = 0;
  $("live-input-state").textContent = "Microphone unavailable";
  setBusy(false);
  if (error?.name === "AbortError") return;
  setStatus(error?.message || "Microphone capture failed.", "error");
}

async function startLiveInput() {
  if (busy || captureIsActive() || disposed) return;
  cancelSourceLoad();
  stopPlayback(false, true);
  const duration = normalizeCaptureDuration($("live-window-seconds").value);
  const version = ++liveCaptureVersion;
  const capture = new AcousticLiveCapture({
    maxDurationSeconds: duration,
    onLevel: updateLiveLevel,
    onProgress: updateLiveProgress,
  });
  liveCapture = capture;
  liveStarting = true;
  liveStopping = false;
  lastLiveAnnouncementAt = -Infinity;
  $("live-input-state").textContent = "Requesting microphone permission…";
  const profile = selectedProfile();
  setStatus(
    profile.recording.sourceRatePcmPreferred
      ? "Waiting for microphone permission. Most browser microphone paths are 48 kHz and cannot capture this ultrasonic profile faithfully; use a source-rate high-speed PCM WAV for full-band work."
      : "Waiting for microphone permission. Audio stays local and recording starts only if you allow it.",
  );
  setBusy(busy);
  try {
    await capture.start({
      maxDurationSeconds: duration,
      deviceId: $("live-input-device").value,
    });
    if (disposed || version !== liveCaptureVersion || capture !== liveCapture) {
      await capture.cancel();
      return;
    }
    liveStarting = false;
    microphonePermissionSeen = true;
    $("live-input-state").textContent = `Recording 0.0 / ${duration.toFixed(0)} s`;
    setStatus(
      `Recording a bounded ${duration.toFixed(0)}-second window. Stop when ready; the map is built after capture, not continuously.${profile.recording.sourceRatePcmPreferred ? " This browser stream may not contain the selected ultrasound band." : ""}`,
      "ready",
    );
    setBusy(busy);
    void populateInputDevices();
    capture.finished.then(
      (result) => finishLiveCapture(capture, version, result),
      (error) => failLiveCapture(capture, version, error),
    );
  } catch (error) {
    failLiveCapture(capture, version, error);
  }
}

function stopOrCancelLive() {
  if (liveStarting && liveCapture) {
    const capture = liveCapture;
    liveCaptureVersion += 1;
    liveCapture = null;
    liveStarting = false;
    liveStopping = false;
    $("live-input-meter").value = 0;
    $("live-input-state").textContent = "Microphone request cancelled";
    void capture.cancel();
    setBusy(false);
    setStatus("Microphone request cancelled; no audio was captured.", "ready");
    return;
  }
  if (!liveCapture?.isRecording || liveStopping) return;
  liveStopping = true;
  $("live-input-state").textContent = "Stopping microphone…";
  setBusy(busy);
  void liveCapture.stop();
}

function cancelLiveCapture() {
  liveCaptureVersion += 1;
  const capture = liveCapture;
  liveCapture = null;
  liveStarting = false;
  liveStopping = false;
  if (capture) void capture.cancel();
  $("live-input-meter").value = 0;
  $("live-input-state").textContent = "Microphone off";
}

async function exportModelWav() {
  if (!route.length || busy || captureIsActive() || !analysisMatchesProfile()) return;
  const version = ++taskVersion;
  setBusy(true);
  try {
    const controls = resynthesisSettings();
    const rendered = await renderIndices(route, "physical");
    if (version !== taskVersion || !rendered) return;
    routeRender = rendered;
    routeRenderKey = routeKey(route, "physical");
    downloadBlob(
      new Blob([encodeMonoWav(rendered.samples, rendered.sampleRate)], { type: "audio/wav" }),
      `${safeStem(sourceName)}-${analysis.profileId}-${controls.transformed ? "extrapolated" : "anchor"}-model-route.wav`,
    );
    setBusy(false);
    const fallbackCount = rendered.modelSegments.filter((segment) => segment.fallbackUsed).length;
    const limitedCount = rendered.modelSegments.filter(
      (segment) => segment.resynthesis?.timeWarpLimited,
    ).length;
    setStatus(
      fallbackCount
        ? `Exported the transformed, sample-free model route WAV; ${fallbackCount} ${eventTerm(fallbackCount)} used the neutral descriptor fallback, and no source samples are embedded.`
        : `Exported the transformed, sample-free model route WAV exactly as rendered; no source samples are embedded.${limitedCount ? ` ${limitedCount} very slow ${eventTerm(limitedCount)} reached the 30-second render safety ceiling.` : ""}`,
      "ready",
    );
  } catch (error) {
    if (version !== taskVersion) return;
    setBusy(false);
    setStatus(`Model export failed: ${error?.message || "unknown error"}`, "error");
  }
}

function sourceMetadataForExport() {
  if (!sourceOrigin) return null;
  if (sourceOrigin.kind === "recording") {
    return {
      kind: sourceOrigin.kind,
      id: sourceOrigin.id,
      commonName: sourceOrigin.commonName,
      scientificName: sourceOrigin.scientificName,
      attribution: sourceOrigin.attribution,
      license: sourceOrigin.license,
      licenseUrl: sourceOrigin.licenseUrl,
      sourceUrl: sourceOrigin.sourceUrl,
      note: sourceOrigin.note,
      sampleRate: sourceSampleRate,
      decoding: sourceDecodeMetadata,
    };
  }
  if (sourceOrigin.kind === "procedural") {
    return {
      kind: sourceOrigin.kind,
      id: sourceOrigin.id,
      attribution: sourceOrigin.attribution,
      license: sourceOrigin.license,
      note: sourceOrigin.note,
      sampleRate: sourceSampleRate,
      decoding: sourceDecodeMetadata,
    };
  }
  return {
    kind: sourceOrigin.kind,
    sampleRate: sourceSampleRate,
    decoding: sourceDecodeMetadata,
  };
}

async function exportRouteJson() {
  if (!analysisMatchesProfile() || !route.length || busy || captureIsActive()) return;
  const version = ++taskVersion;
  setBusy(true);
  try {
    // A “route + gesture” export should contain every model segment, even when
    // the listener has only used source-audio playback so far.
    const rendered = await renderIndices(route, "physical");
    if (version !== taskVersion || !rendered) return;
    const exported = acousticManifoldExport(analysis, route, {
      source: sourceName,
      sourceMetadata: sourceMetadataForExport(),
      rule: activeRouteRule,
      seed: activeRouteSeed,
      surprise: activeRouteSurprise,
      listenMode: $("listen-mode").value,
      gapSeconds: resynthesisSettings().gapSeconds,
      resynthesis: resynthesisSettings(),
      timeline: rendered.timeline,
      modelSegments: rendered.modelSegments,
    });
    downloadBlob(
      new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: "application/json" }),
      `${safeStem(sourceName)}-${analysis.profileId}-acoustic-manifold.json`,
    );
    setBusy(false);
    setStatus("Exported every routed model gesture with the descriptors, projection, edge semantics, profile prior, and model boundary.", "ready");
  } catch (error) {
    if (version !== taskVersion) return;
    setBusy(false);
    if (error?.message === "Render superseded") return;
    setStatus(`Route JSON export failed: ${error?.message || "unknown error"}`, "error");
  }
}

function updateListenPresentation({ announce = false } = {}) {
  const profile = selectedProfile();
  const physical = $("listen-mode").value === "physical";
  $("play-route").querySelector("small").textContent = physical
    ? profile.synthesis.label
    : "decoded source slices";
  updateResynthesisPresentation();
  setBusy(busy);
  if (announce) {
    setStatus(
      physical
        ? `${profile.synthesis.label} follows extracted controls without copying source samples; time, pitch, body, texture, and PCA-position extrapolation can now be transformed independently. It does not recover anatomy.${profile.synthesis.frequencyScale !== 1 ? ` Source-frequency descriptors first use the profile's ×${profile.synthesis.frequencyScale} audible mapping.` : ""}`
        : `Source-audio mode plays decoded mono ${profile.eventSingular} slices with short edge fades and therefore contains source-derived samples. Gesture speed uses the browser's pitch-preserving preview; the other transform controls apply to Model sketch.`,
      "ready",
    );
  }
}

function handleBuiltInSelection() {
  if (busy || captureIsActive()) return;
  const source = selectedBuiltIn();
  $("analysis-profile").value = source.profileId;
  updateProfilePresentation();
  renderSourceCredit(source, { selected: true });
  setStatus(`${source.label} selected. Its suggested ${getAcousticProfile(source.profileId).label.toLowerCase()} profile is a prior, not species recognition; you can override it before loading.`, "ready");
}

populateBuiltInSourceSelect();
populateProfileSelect();
renderProfileLibrary();
renderArchiveLibrary();

routeAudio.addEventListener("ended", () => {
  if (routeAudio.loop) return;
  stopPlayback(false);
  setStatus("Route playback complete.", "ready");
});

$("audioButton").addEventListener("click", () => setAudioEnabled(!audioEnabled));
$("level").addEventListener("input", updateLevel);
$("audio-file").addEventListener("change", (event) => decodeFile(event.target.files?.[0]));
$("built-in-source").addEventListener("change", handleBuiltInSelection);
$("load-built-in").addEventListener("click", loadSelectedBuiltIn);
$("archive-search").addEventListener("input", filterArchiveLibrary);
$("archive-group").addEventListener("change", filterArchiveLibrary);
$("analysis-profile").addEventListener("change", () => updateProfilePresentation({ announce: true }));
for (const id of ANALYSIS_INPUT_IDS) {
  $(id).addEventListener("input", () => {
    updateAnalysisParameterPresentation();
    setBusy(false);
  });
  $(id).addEventListener("change", () => commitAnalysisParameterChange());
}
$("reset-analysis-parameters").addEventListener("click", () => {
  const profile = selectedProfile();
  setAnalysisParameterInputs(defaultAnalysisParameters(profile), profile);
  commitAnalysisParameterChange(
    "Restored the cited profile defaults; analyze and rebuild the 3D map to apply them.",
  );
});
$("reanalyze").addEventListener("click", analyzeSource);
$("start-live-input").addEventListener("click", startLiveInput);
$("capture-live-input").addEventListener("click", stopOrCancelLive);
$("build-route").addEventListener("click", buildRoute);
$("reverse-route").addEventListener("click", () => {
  if (!route.length || busy || captureIsActive()) return;
  activeRouteRule = `reverse-current:${activeRouteRule}`;
  setRoute([...route].reverse());
  setStatus(`Reversed the current ${route.length}-${eventTerm(1)} route.`, "ready");
});
$("clear-route").addEventListener("click", () => {
  manualRoute = [];
  setRoute([], { manual: true });
  setStatus("Route cleared. Select an occurrence and add it manually, or build another walk.", "ready");
});
$("play-route").addEventListener("click", () => playIndices(route));
$("stop-route").addEventListener("click", () => stopPlayback(true, true));
$("loop-route").addEventListener("change", () => {
  routeAudio.loop = $("loop-route").checked;
});
$("listen-mode").addEventListener("change", () => {
  stopPlayback(false, true);
  invalidateRouteRender();
  updateListenPresentation({ announce: true });
  setBusy(false);
});
$("resynthesis-preset").addEventListener("change", () => {
  const presetId = $("resynthesis-preset").value;
  const preset = RESYNTHESIS_PRESETS[presetId];
  if (!preset) return;
  setResynthesisInputs(preset);
  updateResynthesisPresentation();
  commitResynthesisChange(`Applied the ${$("resynthesis-preset").selectedOptions[0].textContent} transform.`);
});
for (const id of RESYNTHESIS_INPUT_IDS) {
  $(id).addEventListener("input", () => updateResynthesisPresentation({ markCustom: true }));
  $(id).addEventListener("change", () => commitResynthesisChange());
}
$("reset-resynthesis").addEventListener("click", () => {
  $("resynthesis-preset").value = "anchor";
  setResynthesisInputs(RESYNTHESIS_PRESETS.anchor);
  updateResynthesisPresentation();
  commitResynthesisChange("Reset to the analysis-derived model anchor.");
});
$("audition-selected").addEventListener("click", () => {
  if (selectedIndex !== null) playIndices([selectedIndex], "audition");
});
$("add-selected").addEventListener("click", () => {
  if (selectedIndex === null || !analysisMatchesProfile()) return;
  $("walk-rule").value = "manual";
  activeRouteRule = "manual";
  activeRouteSurprise = Number($("surprise").value);
  activeRouteSeed = ROUTE_SEED;
  manualRoute.push(selectedIndex);
  setRoute(manualRoute, { manual: true });
  setStatus(`Added ${occurrenceLabel(selectedIndex)} to the manual route.`, "ready");
});
$("export-physical").addEventListener("click", exportModelWav);
$("export-json").addEventListener("click", exportRouteJson);
$("reset-view").addEventListener("click", () => renderer.resetView());

for (const id of ["show-similarity", "show-sequence", "show-trajectories", "auto-rotate"]) {
  $(id).addEventListener("change", () => renderer.setOptions({
    showSimilarity: $("show-similarity").checked,
    showSequence: $("show-sequence").checked,
    showTrajectories: $("show-trajectories").checked,
    autoRotate: $("auto-rotate").checked,
  }));
}
for (const id of ["route-length", "surprise"]) {
  $(id).addEventListener("input", () => {
    updateRangeOutputs();
    if (!route.length || !analysisMatchesProfile()) return;
    setRoute([]);
    setStatus("Route settings changed; build a new playback route. The analyzed map is unchanged.", "ready");
  });
}
$("walk-rule").addEventListener("change", () => {
  const rule = $("walk-rule").value;
  activeRouteRule = rule;
  if (rule === "manual" && manualRoute.length) {
    activeRouteSurprise = Number($("surprise").value);
    activeRouteSeed = ROUTE_SEED;
    setRoute(manualRoute, { manual: true });
    setBusy(false);
    return;
  }
  if (route.length) {
    setRoute([]);
    setStatus(`Route rule changed to ${rule}; build a new route before playback or export.`, "ready");
  }
  setBusy(false);
});

function handleDeviceChange() {
  if (microphonePermissionSeen && !captureIsActive()) void populateInputDevices();
}

navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);

window.addEventListener("pagehide", (event) => {
  cancelSourceLoad();
  cancelLiveCapture();
  ++taskVersion;
  stopPlayback(false);
  revokeUrl(routeUrl);
  if (event.persisted) return;
  disposed = true;
  navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
  renderer.dispose();
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || disposed) return;
  busy = false;
  pendingPlayback = false;
  liveCapture = null;
  liveStarting = false;
  liveStopping = false;
  $("live-input-meter").value = 0;
  $("live-input-state").textContent = "Microphone off";
  routeAudio.removeAttribute("src");
  setBusy(false);
  updateSelected();
  updateRouteRibbon();
  setStatus("Page restored. Microphone and playback remain off; the local map is ready.", "ready");
});

if (!ACOUSTIC_BUILT_IN_SOURCES.every((entry) => ACOUSTIC_PROFILES[entry.profileId])) {
  setStatus("A built-in recording references a missing analysis profile.", "error");
} else {
  updateLevel();
  updateProfilePresentation();
  updateResynthesisPresentation();
  renderSourceCredit(selectedBuiltIn());
  setAudioEnabled(false);
  setBusy(false);
  requestAnimationFrame(loadSelectedBuiltIn);
}

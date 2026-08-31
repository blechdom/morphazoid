import {
  MOIRE_DRONE_DEFAULTS,
  MOIRE_DRONE_FFT_SIZE,
  MOIRE_DRONE_LIMITS,
  MOIRE_DRONE_MANUAL_MOTION_SETTINGS,
  MOIRE_DRONE_NOISE_COLOR_CHOICES,
  MOIRE_DRONE_NOISE_TYPES,
  MOIRE_DRONE_PRESETS,
  MoireDroneAudio,
  SpectralFabric,
  SpectralPropagationPool,
  combToothAnchor,
  combToothWarpOffset,
  fabricGesturePull,
  normalizedResonanceQ,
  rotateFabricCoordinate,
  sanitizeMoireDroneParams,
  spectralFftMaskGain,
  spectralWarpedCombGate,
  wrapUnit,
} from "./src/moire-drone.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const audio = new MoireDroneAudio(globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const STATIC_GRID_COLUMNS = 28;
const STATIC_GRID_ROWS = 20;
const STATIC_GRID_SEGMENTS = 40;
const ACTIVE_DEFORMATION_FRAME_RATE = 60;
const AUDIO_VISUAL_FRAME_RATE = 30;
const FRAME_INTERVAL_TOLERANCE_MS = 0.75;
const STATIC_GRID_PINK = "#ff5cad";
const STATIC_GRID_GREEN = "#68f7a4";
const firstPreset = MOIRE_DRONE_PRESETS[0];

function manualFabricSettings(parameters = {}) {
  return sanitizeMoireDroneParams({
    ...parameters,
    ...MOIRE_DRONE_MANUAL_MOTION_SETTINGS,
  });
}

const visualFabric = new SpectralFabric({
  seed: (MOIRE_DRONE_DEFAULTS.seed ^ 0xa511e9b3) >>> 0,
});
const visualPropagation = new SpectralPropagationPool({
  seed: (MOIRE_DRONE_DEFAULTS.seed ^ 0x3c6ef372) >>> 0,
  activeLimit: MOIRE_DRONE_DEFAULTS.propagationVoices,
});
const visualCombPositions = new Float64Array(16);
const visualCombWidths = new Float64Array(16);
const visualCombWarps = new Float64Array(16);
const visualQWidths = new Float64Array(16);
const PROPAGATION_LABELS = Object.freeze({
  drop: "Rings",
  harmonic: "Lobes",
  spiral: "Spiral",
  shock: "Pulse",
  gravity: "Gravity",
  standing: "Standing",
  ocean: "Ocean",
});
const SPECTRAL_SCULPT_LABELS = Object.freeze({
  notches: "Gaps",
  ridges: "Ridges",
  lowpass: "Low-pass",
  highpass: "High-pass",
  bandpass: "Window",
  bandstop: "Hollow",
  peak: "Peak",
  tilt: "Tilt",
});
const NOISE_TYPE_LABELS = Object.freeze({
  colored: "Colored",
  violet: "Violet",
  crackle: "Crackle",
  samplehold: "Stepped",
  fractal: "Fractal",
  chaotic: "Chaotic",
});
const REPEATED_SCULPT_MODES = new Set(["notches", "ridges"]);
const CUT_SCULPT_MODES = new Set([
  "notches", "lowpass", "highpass", "bandpass", "bandstop",
]);

const state = {
  settings: {
    ...manualFabricSettings({
      ...MOIRE_DRONE_DEFAULTS,
      ...firstPreset.settings,
    }),
  },
  preset: firstPreset.id,
  audioOn: false,
  gridDensity: STATIC_GRID_ROWS,
  quality: { tier: 0, activeFilters: MOIRE_DRONE_DEFAULTS.filterPairs * 2, load: 0 },
  combPhase: 0,
};

const spectrum = new Float32Array(1_024);
spectrum.fill(-100);

let canvasWidth = 1;
let canvasHeight = 1;
let animationFrame = 0;
let lastAnimationTime = 0;
let lastDrawTime = 0;
let audioTransition = false;
let audioStartPromise = null;
let pointerId = null;
let pointerStartX = 0;
let pointerStartY = 0;
let pointerStartTime = 0;
let pointerLastTime = 0;
let pointerVelocityX = 0;
let pointerVelocityY = 0;
let pointerAnchorX = 0;
let pointerAnchorY = 0;
let pointerAudioAnchorX = 0;
let pointerAudioAnchorY = 0;
let pointerCurrentX = 0;
let pointerCurrentY = 0;
let pointerRawCurrentX = 0;
let pointerRawCurrentY = 0;
let pointerPullAmount = 0;
let pointerDidDrag = false;
let pointerLastRippleTime = 0;
let pointerWakeCount = 0;
let pointerWakeTravel = 0;
let keyboardSculptX = 0;
let keyboardSculptY = 0;
let visualPullAnchorX = 0;
let visualPullAnchorY = 0;
let visualPullOffsetX = 0;
let visualPullOffsetY = 0;
let visualSculptGestureActive = false;
let visualSculptGestureEnvelope = 0;
let visualSculptGestureStrength = 0;
let visualSculptGestureFocus = state.settings.combOffset;
let visualSculptGestureCurrentY = 0;
let visualSculptGestureDeltaY = 0;
let visualSculptGestureWidthScale = 1;
let currentVisualSculpt = Object.freeze({
  periodic: false,
  focus: state.settings.combOffset,
  width: state.settings.combWidth,
  depth: state.settings.combDepth,
  character: state.settings.qCharacter,
  fftSharpness: state.settings.fftSharpness,
  warp: 0,
});
let displayedPropagationCount = -1;
let disposed = false;

const invertUnit = (value) => 1 - Number(value);

const RANGE_BINDINGS = Object.freeze([
  ["outputLevel", "outputLevel", Number],
  ["noiseColor", "noiseColor", Number],
  ["noiseChaos", "noiseChaos", Number],
  ["noiseFractalDepth", "noiseFractalDepth", Number],
  ["noiseCorrelation", "noiseCorrelation", Number],
  ["dust", "dust", Number],
  ["filteredMix", "filteredMix", Number],
  ["filterPairs", "filterPairs", Number],
  ["lowFrequency", "lowFrequency", Number],
  ["highFrequency", "highFrequency", Number],
  ["resonance", "resonance", Number],
  ["resonanceMotion", "resonanceMotion", Number],
  ["spectralTilt", "spectralTilt", Number],
  ["latticeScatter", "latticeScatter", Number],
  ["cascade", "cascade", Number],
  ["edgeFocus", "edgeFocus", Number],
  ["moireDetune", "moireDetune", Number],
  ["phaseOffset", "phaseOffset", Number],
  ["fieldAAngle", "fieldAAngle", Number],
  ["fieldADensity", "fieldADensity", Number],
  ["fieldACurvature", "fieldACurvature", Number],
  ["fieldADepth", "fieldADepth", Number],
  ["fieldBAngle", "fieldBAngle", Number],
  ["fieldBDensity", "fieldBDensity", Number],
  ["fieldBCurvature", "fieldBCurvature", Number],
  ["fieldBDepth", "fieldBDepth", Number],
  ["collisionAmount", "collisionAmount", Number],
  ["collisionWidth", "collisionWidth", Number],
  ["collisionPolarity", "collisionPolarity", Number],
  ["propagationRate", "propagationRate", Number],
  ["propagationSpeed", "propagationSpeed", Number],
  ["propagationDecay", "propagationDecay", Number],
  ["propagationDepth", "propagationDepth", Number],
  ["propagationGain", "propagationGain", Number],
  ["propagationWidth", "propagationWidth", Number],
  ["propagationSizeSpread", "propagationSizeSpread", Number],
  ["propagationSpeedSpread", "propagationSpeedSpread", Number],
  ["propagationInterference", "propagationInterference", Number],
  ["grabRippleRate", "grabRippleRate", Number],
  ["harmonicOrder", "harmonicOrder", Number],
  ["ringDensity", "ringDensity", Number],
  ["propagationVoices", "propagationVoices", Number],
  ["combDepth", "combDepth", Number],
  ["combTeeth", "combTeeth", Number],
  ["combWidth", "combWidth", Number],
  ["combOffset", "combOffset", Number],
  ["combWarp", "combWarp", Number],
  ["pluckCut", "pluckCut", Number],
  ["gestureCoupling", "gestureCoupling", Number],
  ["spectralFilterBlend", "spectralFilterBlend", Number],
  ["fftCutDepth", "fftCutDepth", Number],
  ["fftSharpness", "fftSharpness", Number],
  ["qCutDepth", "qCutDepth", Number],
  ["qCharacter", "qCharacter", Number],
  ["fabricTension", "fabricTension", Number],
  ["fabricDamping", "fabricDamping", Number],
  ["fabricInertia", "fabricInertia", invertUnit, invertUnit],
  ["fabricGravity", "fabricGravity", Number],
  ["fabricSections", "fabricSections", Number],
  ["fabricPatchwork", "fabricPatchwork", Number],
  ["fabricDepth", "fabricDepth", Number],
  ["fabricRotation", "fabricRotation", Number],
  ["fabricPull", "fabricPull", Number],
  ["stereoWidth", "stereoWidth", Number],
  ["drive", "drive", Number],
  ["space", "space", Number],
  ["feedback", "feedback", Number],
]);

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showAudioError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearAudioError() {
  $("audioError").hidden = true;
  $("audioError").textContent = "";
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function clampVisual(value, low, high, fallback = low) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(high, Math.max(low, numeric));
}

function reflectVisualUnit(value) {
  const doubled = wrapUnit(Number(value) * 0.5) * 2;
  return doubled <= 1 ? doubled : 2 - doubled;
}

function spectralFilterBlendLabel(value) {
  if (value <= 0.005) return "Q only";
  if (value >= 0.995) return "FFT only";
  return `${percent(value)} FFT`;
}

function formatFrequency(value) {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)} kHz`
    : `${Math.round(value)} Hz`;
}

function frequencyAtStageX(x, settings = state.settings) {
  const position = Math.max(0, Math.min(1, (Number(x) + 1) * 0.5));
  return settings.lowFrequency
    * (settings.highFrequency / settings.lowFrequency) ** position;
}

function noiseColorLabel(value) {
  if (value <= -0.995) return "brown";
  if (value < -0.505) return "brown–pink";
  if (value <= -0.495) return "pink";
  if (value < -0.005) return "pink–white";
  if (value <= 0.005) return "white";
  if (value < 0.995) return "white–blue";
  return "blue";
}

function noiseTypeLabel(value = state.settings.noiseType) {
  return NOISE_TYPE_LABELS[value] ?? "Colored";
}

function springFeelLabel(value) {
  if (value < 0.15) return "soft";
  if (value < 0.4) return "gentle";
  if (value < 0.65) return "balanced";
  if (value < 0.88) return "springy";
  return "very bouncy";
}

function responseFeelLabel(value) {
  if (value < 0.15) return "slow";
  if (value < 0.4) return "relaxed";
  if (value < 0.65) return "steady";
  if (value < 0.88) return "quick";
  return "immediate";
}

function brakeFeelLabel(value) {
  if (value < 0.05) return "free";
  if (value < 0.35) return "light";
  if (value < 0.65) return "controlled";
  if (value < 0.88) return "fast";
  return "hard stop";
}

function collisionPolarityLabel(value) {
  if (Math.abs(value) < 0.025) return "neutral";
  return `${value > 0 ? "+" : "−"}${Math.round(Math.abs(value) * 100)}% ${value > 0 ? "brighten" : "carve"}`;
}

function formatTilt(value) {
  if (Math.abs(value) < 0.05) return "flat";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} dB/oct`;
}

function effectiveFabricAngle() {
  return state.settings.fabricRotation;
}

function propagationLabel(mode = state.settings.propagationMode) {
  return PROPAGATION_LABELS[mode] ?? "Rings";
}

function spectralSculptLabel(mode = state.settings.spectralSculptMode) {
  return SPECTRAL_SCULPT_LABELS[mode] ?? "Gaps";
}

function sculptUsesRegions(mode = state.settings.spectralSculptMode) {
  return REPEATED_SCULPT_MODES.has(mode);
}

// Match the audio engine's cut-only serial intersection at the middle of the
// Q/FFT morph. The individual response lines remain useful endpoint guides;
// this combined gain drives the darkness of the audible sculpture itself.
function combinedSpectralGain(
  qGain,
  fftGain,
  blend = state.settings.spectralFilterBlend,
  mode = state.settings.spectralSculptMode,
) {
  const amount = clampVisual(blend, 0, 1, 0.5);
  const parallel = qGain + (fftGain - qGain) * amount;
  if (!CUT_SCULPT_MODES.has(mode)) return parallel;
  const intersectionAmount = 4 * amount * (1 - amount);
  const intersection = qGain * fftGain;
  return parallel + (intersection - parallel) * intersectionAmount;
}

function updatePropagationStatus(force = false) {
  const activeCount = visualPropagation.activeCount;
  if (!force && displayedPropagationCount === activeCount) return;
  displayedPropagationCount = activeCount;
  const settings = state.settings;
  const regions = sculptUsesRegions(settings.spectralSculptMode)
    ? ` · ${settings.combTeeth} ${settings.combTeeth === 1 ? "region" : "regions"}`
    : "";
  const waveNoun = settings.propagationVoices === 1 ? "wave" : "waves";
  $("propagationSummary").textContent = `${spectralSculptLabel(settings.spectralSculptMode)}${regions} · ${percent(settings.combDepth)} sculpt · ${activeCount}/${settings.propagationVoices} ${waveNoun}`;
  $("clearWavesButton")?.setAttribute(
    "aria-label",
    `Clear ${activeCount} active ${activeCount === 1 ? "wave" : "waves"} and fabric motion`,
  );
  updateStageReadout();
}

function updateStageReadout() {
  const settings = state.settings;
  const effectiveFilters = effectiveFilterCount();
  const readout = [
    spectralSculptLabel(settings.spectralSculptMode).toUpperCase(),
  ];
  if (sculptUsesRegions(settings.spectralSculptMode)) {
    readout.push(`${settings.combTeeth} REGIONS`);
  }
  readout.push(
    `${percent(settings.combDepth)} SCULPT`,
    `${visualPropagation.activeCount}/${settings.propagationVoices} WAVES`,
    `${propagationLabel(settings.propagationMode).toUpperCase()} SHAPE`,
    `${effectiveFilters}/${settings.filterPairs * 2} FILTERS`,
    "STATIC GRID",
    "MANUAL MOTION",
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  );
  $("stageReadout").textContent = readout.join(" · ");
}

function effectiveFilterCount() {
  const tier = Math.round(clampVisual(
    state.quality.tier,
    0,
    MOIRE_DRONE_LIMITS.qualityScales.length - 1,
    0,
  ));
  const scale = MOIRE_DRONE_LIMITS.qualityScales[tier] ?? 1;
  return Math.max(4, Math.round(state.settings.filterPairs * scale)) * 2;
}

function staticGridDimensions() {
  const rows = Math.round(clampVisual(state.gridDensity, 8, 40, STATIC_GRID_ROWS));
  const columns = Math.max(2, Math.round(
    STATIC_GRID_COLUMNS * rows / STATIC_GRID_ROWS,
  ));
  return { columns, rows };
}

function fabricSectionDimensions(value = state.settings.fabricSections) {
  const columns = Math.round(clampVisual(value, 3, 16, 8));
  const rows = Math.max(3, Math.round(columns * 0.75));
  return { columns, rows };
}

function syncVisualFabricTopology() {
  const { columns, rows } = fabricSectionDimensions();
  return visualFabric.reconfigure({
    width: columns,
    height: rows,
    patchwork: state.settings.fabricPatchwork,
    seed: (state.settings.seed ^ 0xa511e9b3) >>> 0,
  });
}

function updateGridDensityOutput() {
  const { columns, rows } = staticGridDimensions();
  $("gridDensity").value = String(rows);
  $("gridDensityOut").textContent = `${columns} × ${rows}`;
}

function resetVisualSculptGesture() {
  visualSculptGestureActive = false;
  visualSculptGestureEnvelope = 0;
  visualSculptGestureStrength = 0;
  visualSculptGestureFocus = state.settings.combOffset;
  visualSculptGestureCurrentY = 0;
  visualSculptGestureDeltaY = 0;
  visualSculptGestureWidthScale = 1;
}

function captureVisualSculptGesture(
  x = 0,
  y = 0,
  amount = 0,
  gesture = {},
  active = false,
) {
  const packet = gesture && typeof gesture === "object" ? gesture : {};
  const anchorX = clampVisual(x, -1, 1, 0);
  const anchorY = clampVisual(y, -1, 1, 0);
  const currentX = clampVisual(packet.currentX, -1, 1, anchorX);
  const currentY = clampVisual(packet.currentY, -1, 1, anchorY);
  const deltaX = clampVisual(packet.deltaX, -2, 2, currentX - anchorX);
  const deltaY = clampVisual(packet.deltaY, -2, 2, currentY - anchorY);
  const suppliedDistance = Number(packet.distance);
  const hasSpatialGesture = Number.isFinite(suppliedDistance)
    || Math.abs(deltaX) + Math.abs(deltaY) > 1e-6;
  const distance = clampVisual(
    suppliedDistance,
    0,
    Math.SQRT2 * 2,
    Math.hypot(deltaX, deltaY),
  );
  const effort = hasSpatialGesture
    ? 1 - Math.exp(-distance * 1.25)
    : 1 - Math.exp(-Math.abs(clampVisual(amount, -2, 2, 0)) * 1.4);
  const directAmount = Math.min(1, Math.abs(clampVisual(amount, -2, 2, 0)));
  visualSculptGestureStrength = clampVisual(
    effort * 0.78 + directAmount * 0.22,
    0,
    1,
    directAmount,
  );
  visualSculptGestureFocus = (currentX + 1) * 0.5;
  visualSculptGestureCurrentY = currentY;
  visualSculptGestureDeltaY = deltaY;
  visualSculptGestureWidthScale = 2 ** clampVisual(
    currentY * 0.9 + deltaY * 1.35
      + (visualSculptGestureStrength - 0.5) * 1.1,
    -2.3,
    2.3,
    0,
  );
  // Direct spectral focus exists only while contact is held. Released motion
  // comes from the same visible fabric and propagation fields drawn below.
  visualSculptGestureEnvelope = active ? 1 : 0;
  visualSculptGestureActive = Boolean(active);
}

function visualDirectGestureResponse() {
  if (
    visualSculptGestureEnvelope <= 1e-7
    || visualSculptGestureStrength <= 1e-7
  ) return 0;
  return clampVisual(
    visualSculptGestureEnvelope * (0.42 + visualSculptGestureStrength * 0.55),
    0,
    0.97,
    0,
  );
}

function visualSculptGeometry() {
  const settings = state.settings;
  const periodic = sculptUsesRegions(settings.spectralSculptMode);
  const directResponse = visualDirectGestureResponse();
  const directDepth = directResponse * (
    0.7 + visualSculptGestureStrength * 0.28
  );
  const effectiveFabricDepth = Math.max(
    settings.fabricDepth,
    directResponse * (0.72 + visualSculptGestureStrength * 0.58),
  );
  const effectiveCombWarp = Math.max(
    settings.combWarp,
    directResponse * (1.5 + visualSculptGestureStrength * 1.65),
  );
  const effectivePluckCut = Math.max(
    settings.pluckCut,
    directResponse * (0.7 + visualSculptGestureStrength * 0.28),
  );
  const movingFocus = periodic
    ? wrapUnit(settings.combOffset + state.combPhase)
    : reflectVisualUnit(settings.combOffset + state.combPhase * 2);
  const configuredPositionInfluence = clampVisual(
    settings.gestureCoupling * visualSculptGestureEnvelope, 0, 1, 0,
  );
  const positionInfluence = Math.max(
    configuredPositionInfluence,
    directResponse * (0.78 + visualSculptGestureStrength * 0.2),
  );
  const shapeInfluence = Math.max(
    configuredPositionInfluence * (0.16 + visualSculptGestureStrength * 0.84),
    directResponse * (0.68 + visualSculptGestureStrength * 0.3),
  );
  const gestureTarget = periodic
    ? wrapUnit(-visualSculptGestureFocus * settings.combTeeth)
    : visualSculptGestureFocus;
  const rawDelta = gestureTarget - movingFocus;
  const focusDelta = periodic ? rawDelta - Math.round(rawDelta) : rawDelta;
  let focus = periodic
    ? wrapUnit(movingFocus + focusDelta * positionInfluence)
    : movingFocus + focusDelta * positionInfluence;
  let width = clampVisual(
    settings.combWidth
      * visualSculptGestureWidthScale ** shapeInfluence,
    0.02,
    0.48,
    settings.combWidth,
  );
  const contactDepth = settings.combDepth >= 0.999
    ? 0.6 + visualSculptGestureStrength * 0.4
    : settings.combDepth + (1 - settings.combDepth)
      * (0.25 + visualSculptGestureStrength * 0.75);
  const pressureAmount = Math.max(
    clampVisual(
      settings.gestureCoupling * visualSculptGestureEnvelope * settings.pluckCut,
      0,
      1,
      0,
    ),
    directResponse,
  );
  const depth = clampVisual(
    settings.combDepth + (contactDepth - settings.combDepth) * pressureAmount,
    0,
    1,
    settings.combDepth,
  );
  const character = clampVisual(
    settings.qCharacter + (
      visualSculptGestureCurrentY * 0.12
      + visualSculptGestureDeltaY * 0.38
      + visualSculptGestureStrength * (0.18 + settings.pluckCut * 0.18)
    ) * shapeInfluence,
    0,
    1,
    settings.qCharacter,
  );
  let warp = 0;
  if (!periodic) {
    const anchorX = focus * 2 - 1;
    const anchorY = visualSculptGestureEnvelope > 1e-5
      ? visualSculptGestureCurrentY
      : settings.originY;
    const fabric = visualFabric.sample(anchorX, anchorY, effectiveFabricAngle());
    const propagation = visualPropagation.sample(
      anchorX,
      anchorY,
      settings.propagationInterference,
    );
    const octaveSpan = Math.max(
      0.25,
      Math.log2(settings.highFrequency / settings.lowFrequency),
    );
    warp = combToothWarpOffset({
      fabric,
      propagation,
      fabricDepth: effectiveFabricDepth,
      propagationDepth: settings.propagationDepth,
      combWarp: effectiveCombWarp,
      octaveSpan,
      teeth: 1,
    });
    focus = reflectVisualUnit(focus + warp);
    width = clampVisual(
      width * (1
        + Math.abs(propagation) * effectivePluckCut * 2.2
        + Math.abs(fabric) * effectivePluckCut * 0.45),
      0.02,
      0.48,
      width,
    );
  }
  return {
    periodic,
    focus,
    width,
    depth,
    qDepth: Math.max(depth * settings.qCutDepth, directDepth),
    fftDepth: Math.max(depth * settings.fftCutDepth, directDepth),
    fabricDepth: effectiveFabricDepth,
    combWarp: effectiveCombWarp,
    pluckCut: effectivePluckCut,
    character,
    fftSharpness: clampVisual(
      settings.fftSharpness + (character - settings.qCharacter) * 0.35,
      0,
      1,
      settings.fftSharpness,
    ),
    warp,
  };
}

function resetVisualDynamics({ resetComb = true } = {}) {
  if (!syncVisualFabricTopology()) {
    visualFabric.reset((state.settings.seed ^ 0xa511e9b3) >>> 0);
  }
  visualPropagation.reset((state.settings.seed ^ 0x3c6ef372) >>> 0);
  visualPullOffsetX = 0;
  visualPullOffsetY = 0;
  visualPropagation.setActiveLimit(state.settings.propagationVoices);
  resetVisualSculptGesture();
  if (resetComb) {
    state.combPhase = 0;
  }
  visualCombPositions.fill(0);
  visualCombWidths.fill(0);
  visualCombWarps.fill(0);
  visualQWidths.fill(0);
  displayedPropagationCount = -1;
}

function updateVisualCombGeometry() {
  const settings = state.settings;
  currentVisualSculpt = visualSculptGeometry();
  const teeth = currentVisualSculpt.periodic ? settings.combTeeth : 1;
  const phase = currentVisualSculpt.focus;
  const octaveSpan = Math.max(
    0.25,
    Math.log2(settings.highFrequency / settings.lowFrequency),
  );
  const fabricAngle = effectiveFabricAngle();
  for (let stage = 0; stage < teeth; stage += 1) {
    if (!currentVisualSculpt.periodic) {
      visualCombWarps[0] = currentVisualSculpt.warp;
      visualCombPositions[0] = currentVisualSculpt.focus;
      visualCombWidths[0] = currentVisualSculpt.width;
      visualQWidths[0] = currentVisualSculpt.width;
      continue;
    }
    const anchor = combToothAnchor(stage, teeth);
    const fabric = visualFabric.sample(anchor.x, anchor.y, fabricAngle);
    const propagation = visualPropagation.sample(
      anchor.x,
      anchor.y,
      settings.propagationInterference,
    );
    const warp = combToothWarpOffset({
      fabric,
      propagation,
      fabricDepth: currentVisualSculpt.fabricDepth,
      propagationDepth: settings.propagationDepth,
      combWarp: currentVisualSculpt.combWarp,
      octaveSpan,
      teeth,
    });
    visualCombWarps[stage] = warp;
    visualCombPositions[stage] = wrapUnit((stage - phase) / teeth + warp);
    visualCombWidths[stage] = Math.max(0.02, Math.min(
      0.48,
      currentVisualSculpt.width * (1
        + Math.abs(propagation) * currentVisualSculpt.pluckCut * 3.5
        + Math.abs(fabric) * currentVisualSculpt.pluckCut * 0.35),
    ));
    visualQWidths[stage] = Math.max(0.02, Math.min(
      0.48,
      visualCombWidths[stage]
        * 2 ** ((0.5 - currentVisualSculpt.character) * 4),
    ));
  }
  for (let stage = teeth; stage < visualCombPositions.length; stage += 1) {
    visualCombPositions[stage] = 0;
    visualCombWidths[stage] = 0;
    visualCombWarps[stage] = 0;
    visualQWidths[stage] = 0;
  }
}

function triggerPropagationAt(
  x,
  y,
  force = 0.72,
  radius = 0.28,
  {
    sendAudio = true,
    fabricScale = 1,
    audioX = x,
    audioY = y,
    gesture = {},
    audioAction = "pluck",
  } = {},
) {
  const settings = state.settings;
  visualPropagation.setActiveLimit(settings.propagationVoices);
  const local = rotateFabricCoordinate(x, y, effectiveFabricAngle());
  if (fabricScale > 0.0001) {
    visualFabric.excite(local.x, local.y, force * fabricScale, radius);
  }
  visualPropagation.trigger({
    mode: settings.propagationMode,
    x,
    y,
    strength: Math.abs(force),
    rate: settings.propagationRate,
    speed: settings.propagationSpeed,
    decay: settings.propagationDecay,
    width: settings.propagationWidth,
    harmonicOrder: settings.harmonicOrder,
    ringDensity: settings.ringDensity,
    sizeSpread: settings.propagationSizeSpread,
    speedSpread: settings.propagationSpeedSpread,
    polarity: force < 0 ? -1 : 1,
  });
  if (sendAudio) {
    if (audioAction === "ripple") {
      audio.rippleFabric(audioX, audioY, force, radius);
    } else {
      captureVisualSculptGesture(audioX, audioY, force, gesture, false);
      audio.pluckFabric(audioX, audioY, force, radius, gesture);
    }
  }
  updatePropagationStatus(true);
}

function updateAudioParameters() {
  state.settings = {
    ...audio.setParameters(manualFabricSettings(state.settings)),
  };
}

function updateInterface({ drawNow = true } = {}) {
  const settings = state.settings;
  syncVisualFabricTopology();
  visualPropagation.setActiveLimit(settings.propagationVoices);
  setPressed($("audioButton"), state.audioOn);
  $("audioState").textContent = state.audioOn ? "on" : "off";

  for (const [id, key, , toControl] of RANGE_BINDINGS) {
    const element = $(id);
    if (element) {
      element.value = String(toControl ? toControl(settings[key]) : settings[key]);
    }
  }
  $("highFrequency").min = String(Math.ceil(Math.max(240, settings.lowFrequency * 1.25)));
  updateGridDensityOutput();

  $("outputLevelOut").textContent = percent(settings.outputLevel);
  $("noiseColorOut").textContent = noiseColorLabel(settings.noiseColor);
  $("noiseChaosOut").textContent = percent(settings.noiseChaos);
  $("noiseFractalDepthOut").textContent = percent(settings.noiseFractalDepth);
  $("noiseCorrelationOut").textContent = percent(settings.noiseCorrelation);
  $("dustOut").textContent = percent(settings.dust);
  $("filteredMixOut").textContent = `${percent(settings.filteredMix)} lattice`;
  $("filterPairsOut").textContent = `${settings.filterPairs} · ${settings.filterPairs * 2} filters`;
  $("lowFrequencyOut").textContent = formatFrequency(settings.lowFrequency);
  $("highFrequencyOut").textContent = formatFrequency(settings.highFrequency);
  $("resonanceOut").textContent = `Q ${normalizedResonanceQ(settings.resonance).toFixed(1)}`;
  $("resonanceMotionOut").textContent = percent(settings.resonanceMotion);
  $("spectralTiltOut").textContent = formatTilt(settings.spectralTilt);
  $("latticeScatterOut").textContent = percent(settings.latticeScatter);
  $("cascadeOut").textContent = percent(settings.cascade);
  $("edgeFocusOut").textContent = settings.edgeFocus.toFixed(2);
  $("moireDetuneOut").textContent = `${settings.moireDetune >= 0 ? "+" : "−"}${Math.round(Math.abs(settings.moireDetune) * 100)}%`;
  $("phaseOffsetOut").textContent = `${settings.phaseOffset.toFixed(2)} cycle`;
  $("fieldAAngleOut").textContent = `${Math.round(settings.fieldAAngle)}°`;
  $("fieldADensityOut").textContent = settings.fieldADensity.toFixed(2);
  $("fieldACurvatureOut").textContent = percent(settings.fieldACurvature);
  $("fieldADepthOut").textContent = `${settings.fieldADepth.toFixed(2)} oct`;
  $("fieldBAngleOut").textContent = `${settings.fieldBAngle < 0 ? "−" : ""}${Math.abs(Math.round(settings.fieldBAngle))}°`;
  $("fieldBDensityOut").textContent = settings.fieldBDensity.toFixed(2);
  $("fieldBCurvatureOut").textContent = percent(settings.fieldBCurvature);
  $("fieldBDepthOut").textContent = `${settings.fieldBDepth.toFixed(2)} oct`;
  $("collisionAmountOut").textContent = percent(settings.collisionAmount);
  $("collisionWidthOut").textContent = `${settings.collisionWidth.toFixed(2)} oct`;
  $("collisionPolarityOut").textContent = collisionPolarityLabel(settings.collisionPolarity);
  $("propagationRateOut").textContent = `${settings.propagationRate.toFixed(1)} Hz`;
  $("propagationSpeedOut").textContent = `${settings.propagationSpeed.toFixed(2)} field/s`;
  $("propagationDecayOut").textContent = `${settings.propagationDecay.toFixed(2)} s`;
  $("propagationDepthOut").textContent = `${settings.propagationDepth.toFixed(2)} oct`;
  $("propagationGainOut").textContent = percent(settings.propagationGain);
  $("propagationWidthOut").textContent = `${settings.propagationWidth.toFixed(3)} field`;
  $("propagationSizeSpreadOut").textContent = percent(settings.propagationSizeSpread);
  $("propagationSpeedSpreadOut").textContent = percent(settings.propagationSpeedSpread);
  $("propagationInterferenceOut").textContent = percent(settings.propagationInterference);
  $("grabRippleRateOut").textContent = settings.grabRippleRate <= 0.001
    ? "onset only"
    : `${settings.grabRippleRate.toFixed(1)} Hz`;
  if (settings.propagationMode === "standing") {
    $("harmonicOrderLabel").textContent = "X harmonic order";
    $("harmonicOrderOut").textContent = `${Math.max(1, settings.harmonicOrder)} X nodes`;
    $("ringDensityLabel").textContent = "Y harmonic order";
    $("ringDensityOut").textContent = `${(settings.ringDensity * 0.5).toFixed(2)} Y nodes`;
  } else {
    $("harmonicOrderLabel").textContent = "Wave order";
    $("harmonicOrderOut").textContent = settings.harmonicOrder === 0
      ? "radial"
      : `${settings.harmonicOrder} ${settings.harmonicOrder === 1 ? "lobe" : "lobes"}`;
    $("ringDensityLabel").textContent = "Wake / Y density";
    $("ringDensityOut").textContent = settings.ringDensity.toFixed(2);
  }
  $("propagationVoicesOut").textContent = `${settings.propagationVoices} ${settings.propagationVoices === 1 ? "wave" : "waves"}`;
  $("combDepthOut").textContent = percent(settings.combDepth);
  $("combTeethOut").textContent = `${settings.combTeeth} ${settings.combTeeth === 1 ? "region" : "regions"}`;
  $("combWidthOut").textContent = percent(settings.combWidth);
  $("combOffsetOut").textContent = percent(settings.combOffset);
  $("combWarpOut").textContent = `${settings.combWarp.toFixed(2)}×`;
  $("pluckCutOut").textContent = percent(settings.pluckCut);
  $("gestureCouplingOut").textContent = percent(settings.gestureCoupling);
  $("spectralFilterBlendOut").textContent = spectralFilterBlendLabel(settings.spectralFilterBlend);
  $("fftCutDepthOut").textContent = percent(settings.fftCutDepth);
  $("fftSharpnessOut").textContent = `${percent(settings.fftSharpness)} sharp`;
  $("qCutDepthOut").textContent = percent(settings.qCutDepth);
  $("qCharacterOut").textContent = `${percent(settings.qCharacter)} resonant`;
  $("fabricTensionOut").textContent = `${percent(settings.fabricTension)} · ${springFeelLabel(settings.fabricTension)}`;
  $("fabricDampingOut").textContent = `${percent(settings.fabricDamping)} · ${brakeFeelLabel(settings.fabricDamping)}`;
  const responseSpeed = invertUnit(settings.fabricInertia);
  $("fabricInertiaOut").textContent = `${percent(responseSpeed)} · ${responseFeelLabel(responseSpeed)}`;
  $("fabricGravityOut").textContent = `${Math.round(settings.fabricGravity * 100)}%`;
  const fabricSections = fabricSectionDimensions(settings.fabricSections);
  $("fabricSectionsOut").textContent = `${fabricSections.columns} × ${fabricSections.rows}`;
  $("fabricPatchworkOut").textContent = percent(settings.fabricPatchwork);
  $("fabricDepthOut").textContent = `${settings.fabricDepth.toFixed(2)} oct`;
  $("fabricRotationOut").textContent = `${settings.fabricRotation < 0 ? "−" : ""}${Math.abs(Math.round(settings.fabricRotation))}°`;
  $("fabricPullOut").textContent = `${Math.round(settings.fabricPull * 100)}%`;
  $("stereoWidthOut").textContent = percent(settings.stereoWidth);
  $("driveOut").textContent = percent(settings.drive);
  $("spaceOut").textContent = percent(settings.space);
  $("feedbackOut").textContent = percent(settings.feedback);

  for (const button of $("collisionModeChoice").querySelectorAll("[data-collision-mode]")) {
    setPressed(button, settings.collisionMode === button.dataset.collisionMode);
  }
  for (const button of $("propagationModeChoice").querySelectorAll("[data-propagation-mode]")) {
    setPressed(button, settings.propagationMode === button.dataset.propagationMode);
  }
  for (const button of $("spectralSculptModeChoice").querySelectorAll("[data-spectral-sculpt-mode]")) {
    setPressed(button, settings.spectralSculptMode === button.dataset.spectralSculptMode);
  }
  for (const button of $("noiseColorChoice").querySelectorAll("[data-noise-color]")) {
    setPressed(button, Math.abs(settings.noiseColor - Number(button.dataset.noiseColor)) < 0.005);
  }
  for (const button of $("noiseTypeChoice").querySelectorAll("[data-noise-type]")) {
    setPressed(button, settings.noiseType === button.dataset.noiseType);
  }
  $("sculptRegionsControl").hidden = !sculptUsesRegions(settings.spectralSculptMode);
  $("harmonicOrderControl").hidden = ![
    "harmonic", "spiral", "standing",
  ].includes(settings.propagationMode);
  for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
    setPressed(button, state.preset === button.dataset.preset);
  }

  const preset = MOIRE_DRONE_PRESETS.find(({ id }) => id === state.preset);
  $("presetSummary").textContent = preset?.label ?? "Custom";
  $("filterEngineSummary").textContent = `${spectralSculptLabel(settings.spectralSculptMode)} · ${spectralFilterBlendLabel(settings.spectralFilterBlend)} · ${percent(settings.qCutDepth)} Q / ${percent(settings.fftCutDepth)} FFT`;
  $("noiseSummary").textContent = `${noiseTypeLabel(settings.noiseType)} · ${noiseColorLabel(settings.noiseColor)} · ${percent(settings.filteredMix)} filtered`;
  $("latticeSummary").textContent = `${settings.filterPairs} pairs · ${formatFrequency(settings.lowFrequency)}–${formatFrequency(settings.highFrequency)} · Q ${normalizedResonanceQ(settings.resonance).toFixed(1)}`;
  $("motionSummary").textContent = `edge ${settings.edgeFocus.toFixed(2)} · phase ${settings.phaseOffset.toFixed(2)}`;
  $("textureSummary").textContent = `X / warp ${settings.fieldADensity.toFixed(2)} · Y / weft ${settings.fieldBDensity.toFixed(2)} · ${settings.collisionMode} ${percent(settings.collisionAmount)}`;
  updatePropagationStatus(true);
  $("fabricSummary").textContent = `${percent(settings.fabricTension)} spring · response ${responseFeelLabel(responseSpeed)} · brake ${brakeFeelLabel(settings.fabricDamping)}`;
  $("outputSummary").textContent = `${percent(settings.stereoWidth)} wide · ${percent(settings.space)} space · ${percent(settings.feedback)} feedback`;
  $("fabricExciteButton").setAttribute(
    "aria-label",
    `Pluck a ${spectralSculptLabel(settings.spectralSculptMode).toLowerCase()} using ${propagationLabel(settings.propagationMode).toLowerCase()} propagation at the current X / Y field origin`,
  );
  $("clearWavesButton").setAttribute(
    "aria-label",
    `Clear ${visualPropagation.activeCount} active ${visualPropagation.activeCount === 1 ? "wave" : "waves"} and fabric motion`,
  );

  const effectiveFilters = effectiveFilterCount();
  const regionDescription = sculptUsesRegions(settings.spectralSculptMode)
    ? `${settings.combTeeth} stationary audio regions`
    : "one stationary audio shape";
  $("stageCaption").textContent = state.quality.tier > 0
    ? `static vector grid · adaptive audio tier ${state.quality.tier} · ${effectiveFilters} filters`
    : `static vector grid · ${spectralSculptLabel(settings.spectralSculptMode).toLowerCase()} · ${regionDescription}`;
  canvas.setAttribute(
    "aria-label",
    `A static pink and green vector grid represents ${settings.filterPairs * 2} filters acting on one ${noiseTypeLabel(settings.noiseType).toLowerCase()} noise field. Field A is the X / warp filter and Field B is the Y / weft filter. The audible ${spectralSculptLabel(settings.spectralSculptMode).toLowerCase()} sculptor is at ${percent(settings.combDepth)} depth using ${spectralFilterBlendLabel(settings.spectralFilterBlend).toLowerCase()} filtering. Horizontal touch position selects frequency and X; vertical position selects the Y row and character. Pulling grabs that exact fabric patch and emits ${propagationLabel(settings.propagationMode).toLowerCase()} propagation through a ${fabricSections.columns} by ${fabricSections.rows} sounding section lattice with ${percent(settings.fabricPatchwork)} panel variation. Up to ${settings.propagationVoices} directly triggered ${settings.propagationVoices === 1 ? "wave" : "waves"} may deform the grid. Tap or press Enter to pluck. Audio ${state.audioOn ? "on" : "off"}.`,
  );

  updateAudioParameters();
  if (drawNow) draw(performance.now(), true);
}

function renderPresets() {
  const fragment = document.createDocumentFragment();
  for (const preset of MOIRE_DRONE_PRESETS) {
    const button = document.createElement("button");
    const label = document.createElement("b");
    button.type = "button";
    button.dataset.preset = preset.id;
    button.setAttribute("aria-pressed", String(preset.id === state.preset));
    label.textContent = preset.label;
    button.append(label);
    button.addEventListener("click", () => applyPreset(preset.id));
    fragment.append(button);
  }
  $("presetGrid").replaceChildren(fragment);
}

function setParameter(key, value, { announceChange = false } = {}) {
  state.settings = {
    ...manualFabricSettings({ ...state.settings, [key]: value }),
  };
  state.preset = null;
  updateInterface();
  if (announceChange) announce(`${key} changed.`);
}

function applyPreset(id) {
  const preset = MOIRE_DRONE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) return;
  const outputLevel = state.settings.outputLevel;
  state.settings = {
    ...manualFabricSettings({
      ...MOIRE_DRONE_DEFAULTS,
      ...preset.settings,
      outputLevel,
    }),
  };
  state.preset = preset.id;
  updateAudioParameters();
  resetVisualDynamics();
  audio.resetFabric();
  updateInterface();
  announce(`${preset.label} preset loaded.`);
}

function setAudioTransition(active) {
  audioTransition = active;
  $("audioButton").disabled = active;
  $("fabricExciteButton").disabled = active;
}

function ensureAudioOn() {
  if (state.audioOn) return Promise.resolve(true);
  if (audioStartPromise) return audioStartPromise;
  if (audioTransition) return Promise.resolve(false);
  audioStartPromise = (async () => {
    setAudioTransition(true);
    clearAudioError();
    try {
      updateAudioParameters();
      await audio.start();
      resetVisualDynamics();
      state.audioOn = true;
      updateInterface();
      announce("Audio on.");
      return true;
    } catch (error) {
      state.audioOn = false;
      await audio.stop().catch(() => {});
      showAudioError(error);
      updateInterface();
      announce("Audio could not start.");
      return false;
    } finally {
      setAudioTransition(false);
      audioStartPromise = null;
    }
  })();
  return audioStartPromise;
}

async function toggleAudio() {
  if (!state.audioOn) {
    await ensureAudioOn();
    return;
  }
  if (audioTransition) return;
  setAudioTransition(true);
  clearAudioError();
  try {
    await audio.stop();
    state.audioOn = false;
    updateInterface();
    announce("Audio off.");
  } catch (error) {
    state.audioOn = false;
    await audio.stop().catch(() => {});
    showAudioError(error);
    updateInterface();
    announce("Audio could not stop cleanly.");
  } finally {
    setAudioTransition(false);
  }
}

function stagePointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const rawX = (event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1;
  const rawY = (event.clientY - rect.top) / Math.max(1, rect.height) * 2 - 1;
  return {
    x: Math.max(-1, Math.min(1, rawX)),
    y: Math.max(-1, Math.min(1, rawY)),
    rawX,
    rawY,
    rect,
  };
}

function holdVisualFabricAtPointer() {
  visualPullAnchorX = pointerAnchorX;
  visualPullAnchorY = pointerAnchorY;
  // Pointer capture keeps reporting motion beyond the canvas. Preserve that
  // strain for the visibly grabbed sheet while the audible focus remains on
  // the clamped stage edge.
  visualPullOffsetX = clampVisual(
    pointerRawCurrentX - pointerAnchorX,
    -2,
    2,
    pointerCurrentX - pointerAnchorX,
  );
  visualPullOffsetY = clampVisual(
    pointerRawCurrentY - pointerAnchorY,
    -2,
    2,
    pointerCurrentY - pointerAnchorY,
  );
}

function visualPullOffsetAt(x, y) {
  const displacement = Math.hypot(visualPullOffsetX, visualPullOffsetY);
  if (displacement < 0.0001) return { x: 0, y: 0, weight: 0 };
  const radius = 0.3 + Math.min(0.28, displacement * 0.38);
  const dx = x - visualPullAnchorX;
  const dy = y - visualPullAnchorY;
  const weight = Math.exp(-0.5 * (dx * dx + dy * dy) / (radius * radius));
  return {
    x: visualPullOffsetX * weight * 0.9,
    y: visualPullOffsetY * weight * 0.9,
    weight,
  };
}

function currentAudioGesture() {
  const pull = fabricGesturePull({
    anchorX: pointerAudioAnchorX,
    anchorY: pointerAudioAnchorY,
    currentX: pointerRawCurrentX,
    currentY: pointerRawCurrentY,
    velocityX: pointerVelocityX,
    velocityY: pointerVelocityY,
  });
  return {
    currentX: pointerCurrentX,
    currentY: pointerCurrentY,
    deltaX: pull.deltaX,
    deltaY: pull.deltaY,
    distance: pull.distance,
    velocityX: pull.velocityX,
    velocityY: pull.velocityY,
  };
}

function applyPointerTug(amount = pointerPullAmount) {
  holdVisualFabricAtPointer();
  const movingGrab = rotateFabricCoordinate(
    pointerCurrentX,
    pointerCurrentY,
    effectiveFabricAngle(),
  );
  visualFabric.tug(movingGrab.x, movingGrab.y, amount);
  captureVisualSculptGesture(
    pointerAudioAnchorX,
    pointerAudioAnchorY,
    amount,
    currentAudioGesture(),
    true,
  );
  audio.tugFabric(
    pointerCurrentX,
    pointerCurrentY,
    amount,
    currentAudioGesture(),
  );
}

function directGrabWakeProfile(amount = pointerPullAmount, gesture = currentAudioGesture()) {
  const strain = clampVisual(Number(gesture.distance) / 0.9, 0, 1, 0);
  const speed = clampVisual(
    Math.hypot(Number(gesture.velocityX) || 0, Number(gesture.velocityY) || 0) / 8,
    0,
    1,
    0,
  );
  const polarity = amount < 0 ? -1 : 1;
  return {
    force: polarity * clampVisual(
      0.68 + strain * 0.28 + speed * 0.18,
      0.68,
      1.14,
      0.68,
    ),
    radius: clampVisual(
      0.12 + strain * 0.12 + (1 - speed) * 0.08,
      0.12,
      0.32,
      0.2,
    ),
  };
}

function triggerDirectGrabWake(x, y, amount, gesture) {
  const wake = directGrabWakeProfile(amount, gesture);
  triggerPropagationAt(x, y, wake.force, wake.radius, {
    audioAction: "pluck",
    fabricScale: 1,
    audioX: x,
    audioY: y,
    gesture,
  });
}

function emitFirstGrabWake(timestamp = performance.now()) {
  if (
    pointerId === null
    || !pointerDidDrag
    || pointerWakeCount !== 0
    || !state.audioOn
  ) return false;

  const now = Number(timestamp) || performance.now();
  const gesture = currentAudioGesture();
  // Claim this one-shot before dispatch so neither the readiness callback nor
  // another captured move can duplicate it.
  pointerWakeCount = 1;
  pointerWakeTravel = 0;
  pointerLastRippleTime = now;
  triggerDirectGrabWake(
    pointerCurrentX,
    pointerCurrentY,
    pointerPullAmount,
    gesture,
  );
  // A propagation launch is physical rather than a remembered direct gesture.
  // Restore the live fixed point so the held hand keeps owning the fabric.
  applyPointerTug(pointerPullAmount);
  return true;
}

function maybeEmitGrabRipple(timestamp = performance.now()) {
  if (
    pointerId === null
    || !pointerDidDrag
    || pointerWakeCount === 0
  ) return false;
  const rate = state.settings.grabRippleRate;
  if (rate <= 0.001) return false;
  const now = Number(timestamp) || performance.now();
  const elapsed = now - pointerLastRippleTime;
  const travel = pointerWakeTravel;
  const minimumInterval = 1_000 / rate;
  const minimumTravel = Math.max(0.025, 0.11 / (1 + rate * 0.045));
  if (elapsed < minimumInterval || travel < minimumTravel) return false;

  const velocity = Math.hypot(pointerVelocityX, pointerVelocityY);
  const speed = clampVisual(velocity / 7, 0, 1, 0);
  const gesture = currentAudioGesture();
  const strain = clampVisual(
    gesture.distance / 0.9,
    0,
    1,
    0,
  );
  const polarity = pointerPullAmount < 0 ? -1 : 1;
  const force = polarity * clampVisual(
    0.18 + strain * 0.46 + speed * 0.22,
    0.18,
    0.92,
    0.36,
  );
  const radius = clampVisual(
    0.1 + (1 - speed) * 0.13 + strain * 0.09,
    0.06,
    0.42,
    0.18,
  );
  pointerWakeCount += 1;
  pointerWakeTravel = 0;
  pointerLastRippleTime = now;
  triggerPropagationAt(
    pointerCurrentX,
    pointerCurrentY,
    force,
    radius,
    {
      audioAction: "ripple",
      fabricScale: 0.32,
      audioX: pointerCurrentX,
      audioY: pointerCurrentY,
    },
  );
  return true;
}

function samplePointerEvent(event, { drawNow = true } = {}) {
  if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return false;
  }
  const point = stagePointFromEvent(event);
  const now = Number(event.timeStamp) || performance.now();
  const elapsed = Math.max(1 / 240, (now - pointerLastTime) / 1_000);
  const motionX = point.rawX - pointerRawCurrentX;
  const motionY = point.rawY - pointerRawCurrentY;
  if (Math.hypot(motionX, motionY) > 1e-6) {
    const measuredVelocityX = motionX / elapsed;
    const measuredVelocityY = motionY / elapsed;
    pointerVelocityX += (measuredVelocityX - pointerVelocityX) * 0.48;
    pointerVelocityY += (measuredVelocityY - pointerVelocityY) * 0.48;
    pointerWakeTravel = Math.min(
      4,
      pointerWakeTravel + Math.min(2, Math.hypot(motionX, motionY)),
    );
  }
  pointerLastTime = now;
  pointerCurrentX = point.x;
  pointerCurrentY = point.y;
  pointerRawCurrentX = point.rawX;
  pointerRawCurrentY = point.rawY;
  const gesture = fabricGesturePull({
    anchorX: pointerAudioAnchorX,
    anchorY: pointerAudioAnchorY,
    currentX: pointerRawCurrentX,
    currentY: pointerRawCurrentY,
    velocityX: pointerVelocityX,
    velocityY: pointerVelocityY,
  });
  pointerPullAmount = gesture.amount;
  applyPointerTug(pointerPullAmount);
  if (drawNow) draw(performance.now(), true);
  return true;
}

function tugFabricFromPointer(event) {
  // Pointer events can arrive several times inside one display frame. Update
  // the gesture/audio state for every sample, but let RAF paint it once.
  if (samplePointerEvent(event, { drawNow: false })) {
    const timestamp = Number(event.timeStamp) || performance.now();
    if (!emitFirstGrabWake(timestamp)) maybeEmitGrabRipple(timestamp);
  }
}

function staticGridHasDeformation() {
  return pointerId !== null
    || visualPropagation.activeCount > 0
    || visualFabric.energy > 0.0001
    || Math.hypot(visualPullOffsetX, visualPullOffsetY) > 0.0005;
}

function staticGridPoint(x, y, deform, fabricAngle) {
  const baseX = (x + 1) * 0.5 * canvasWidth;
  const baseY = (y + 1) * 0.5 * canvasHeight;
  if (!deform) return { x: baseX, y: baseY };
  const settings = state.settings;
  const surface = (
    visualFabric.sample(x, y, fabricAngle) * currentVisualSculpt.fabricDepth
    + visualPropagation.sample(
      x,
      y,
      settings.propagationInterference,
    ) * settings.propagationDepth
  );
  const vectorScale = Math.min(22, Math.min(canvasWidth, canvasHeight) * 0.032);
  const pull = visualPullOffsetAt(x * 0.92, y * 0.86);
  return {
    x: baseX + pull.x * canvasWidth * 0.5
      + clampVisual(surface * vectorScale * 0.55, -24, 24, 0),
    y: baseY + pull.y * canvasHeight * 0.5
      - clampVisual(surface * vectorScale, -32, 32, 0),
  };
}

function drawStaticVectorGrid() {
  const deform = staticGridHasDeformation();
  const fabricAngle = effectiveFabricAngle();
  const segments = deform ? STATIC_GRID_SEGMENTS : 1;
  const { columns, rows } = staticGridDimensions();
  context2d.save();
  context2d.globalCompositeOperation = "source-over";
  context2d.lineCap = "butt";
  context2d.lineJoin = "round";
  context2d.shadowBlur = 0;
  context2d.lineWidth = 0.9;

  context2d.globalAlpha = 0.62;
  context2d.strokeStyle = STATIC_GRID_GREEN;
  for (let column = 0; column <= columns; column += 1) {
    const x = column / columns * 2 - 1;
    context2d.beginPath();
    for (let segment = 0; segment <= segments; segment += 1) {
      const y = segment / segments * 2 - 1;
      const point = staticGridPoint(x, y, deform, fabricAngle);
      if (segment === 0) context2d.moveTo(point.x, point.y);
      else context2d.lineTo(point.x, point.y);
    }
    context2d.stroke();
  }

  context2d.globalAlpha = 0.66;
  context2d.strokeStyle = STATIC_GRID_PINK;
  for (let row = 0; row <= rows; row += 1) {
    const y = row / rows * 2 - 1;
    context2d.beginPath();
    for (let segment = 0; segment <= segments; segment += 1) {
      const x = segment / segments * 2 - 1;
      const point = staticGridPoint(x, y, deform, fabricAngle);
      if (segment === 0) context2d.moveTo(point.x, point.y);
      else context2d.lineTo(point.x, point.y);
    }
    context2d.stroke();
  }
  context2d.restore();
}

function drawEmbeddedCombGaps() {
  const settings = state.settings;
  const isRidge = settings.spectralSculptMode === "ridges";
  const audibleDepth = Math.max(
    currentVisualSculpt.qDepth,
    currentVisualSculpt.fftDepth,
  );
  if (
    audibleDepth <= 0.001
    || (!isRidge && settings.spectralSculptMode !== "notches")
  ) return;
  const fabricAngle = effectiveFabricAngle();
  context2d.save();
  context2d.globalCompositeOperation = isRidge ? "screen" : "source-over";
  for (let stage = 0; stage < settings.combTeeth; stage += 1) {
    const anchor = combToothAnchor(stage, settings.combTeeth);
    const fabric = visualFabric.sample(anchor.x, anchor.y, fabricAngle);
    const propagation = visualPropagation.sample(
      anchor.x,
      anchor.y,
      settings.propagationInterference,
    );
    const deformation = (
      fabric * currentVisualSculpt.fabricDepth
      + propagation * settings.propagationDepth
    );
    const activity = Math.min(1, (
      Math.abs(propagation) * currentVisualSculpt.pluckCut
      + Math.abs(fabric) * 0.35
    ));
    const spectralX = visualCombPositions[stage] * 2 - 1;
    const pullOffset = visualPullOffsetAt(spectralX * 0.9, anchor.y * 0.84);
    const x = visualCombPositions[stage] * canvasWidth
      + pullOffset.x * canvasWidth * 0.28;
    const y = (anchor.y * 0.42 + 0.5) * canvasHeight
      + pullOffset.y * canvasHeight * 0.5
      - deformation * canvasHeight * 0.045;
    const radiusX = Math.min(30, 5
      + currentVisualSculpt.width * 27
      + Math.abs(visualCombWarps[stage]) * canvasWidth * 0.42
      + activity * 7);
    const radiusY = Math.min(18, 3.5
      + currentVisualSculpt.width * 13
      + activity * 5);
    const opacity = audibleDepth * (0.62 + activity * 0.28);
    const angle = (fabricAngle * 0.35 + stage * 31) * Math.PI / 180;
    context2d.save();
    context2d.translate(x, y);
    context2d.rotate(angle);
    context2d.scale(radiusX, radiusY);
    const cut = context2d.createRadialGradient(0, 0, 0, 0, 0, 1);
    if (isRidge) {
      const color = stage % 2 ? "255, 92, 173" : "104, 247, 164";
      cut.addColorStop(0, `rgba(${color}, ${Math.min(0.74, opacity * 0.72)})`);
      cut.addColorStop(0.52, `rgba(${color}, ${opacity * 0.32})`);
      cut.addColorStop(1, `rgba(${color}, 0)`);
    } else {
      cut.addColorStop(0, `rgba(0, 2, 7, ${Math.min(0.96, opacity)})`);
      cut.addColorStop(0.52, `rgba(1, 4, 11, ${opacity * 0.84})`);
      cut.addColorStop(1, "rgba(1, 4, 11, 0)");
    }
    context2d.fillStyle = cut;
    context2d.beginPath();
    context2d.arc(0, 0, 1, 0, TAU);
    context2d.fill();
    context2d.restore();

    context2d.beginPath();
    context2d.ellipse(x, y, radiusX * 0.62, radiusY * 0.62, angle, 0, TAU);
    context2d.strokeStyle = stage % 2
      ? `rgba(255, 92, 173, ${0.1 + activity * 0.18})`
      : `rgba(104, 247, 164, ${0.1 + activity * 0.18})`;
    context2d.lineWidth = 0.7;
    context2d.stroke();
  }
  context2d.restore();
}

function drawBroadSculptRegions() {
  const settings = state.settings;
  const sculpt = currentVisualSculpt;
  if (sculpt.periodic || Math.max(sculpt.qDepth, sculpt.fftDepth) <= 0.001) return;
  const columns = Math.max(42, Math.min(84, Math.round(canvasWidth / 12)));
  const rows = Math.max(16, Math.min(30, Math.round(canvasHeight / 22)));
  const cellWidth = canvasWidth / columns + 0.75;
  const cellHeight = canvasHeight / rows + 0.75;
  const octaveSpan = Math.max(
    0.25,
    Math.log2(settings.highFrequency / settings.lowFrequency),
  );
  const fabricAngle = effectiveFabricAngle();
  context2d.save();
  context2d.globalCompositeOperation = "source-over";
  for (let row = 0; row < rows; row += 1) {
    const y = (row + 0.5) / rows * 2 - 1;
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) / columns * 2 - 1;
      const fabric = visualFabric.sample(x, y, fabricAngle);
      const propagation = visualPropagation.sample(
        x,
        y,
        settings.propagationInterference,
      );
      const pull = visualPullOffsetAt(x * 0.92, y * 0.86);
      const surfaceWarp = (
        fabric * sculpt.fabricDepth
        + propagation * settings.propagationDepth
      ) / octaveSpan * sculpt.combWarp * 0.28;
      const position = clampVisual(
        (x + 1) * 0.5 - surfaceWarp - pull.x * 0.16,
        0,
        1,
        0.5,
      );
      const frequency = settings.lowFrequency
        * (settings.highFrequency / settings.lowFrequency) ** position;
      const qGate = spectralFftMaskGain({
        frequency,
        lowFrequency: settings.lowFrequency,
        highFrequency: settings.highFrequency,
        depth: sculpt.qDepth,
        sharpness: sculpt.character,
        mode: settings.spectralSculptMode,
        focus: sculpt.focus,
        width: sculpt.width,
      });
      const fftGate = spectralFftMaskGain({
        frequency,
        lowFrequency: settings.lowFrequency,
        highFrequency: settings.highFrequency,
        depth: sculpt.fftDepth,
        sharpness: sculpt.fftSharpness,
        mode: settings.spectralSculptMode,
        focus: sculpt.focus,
        width: sculpt.width,
      });
      const gate = combinedSpectralGain(
        qGate,
        fftGate,
        settings.spectralFilterBlend,
        settings.spectralSculptMode,
      );
      const darkness = clampVisual(1 - gate, 0, 1, 0);
      const brightness = clampVisual((gate - 1) * 0.5, 0, 1, 0);
      if (darkness <= 0.008 && brightness <= 0.008) continue;
      const activity = Math.min(1, Math.abs(fabric) * 0.22
        + Math.abs(propagation) * sculpt.pluckCut * 0.7);
      context2d.fillStyle = brightness > darkness
        ? `rgba(104, 247, 164, ${brightness * (0.12 + activity * 0.08)})`
        : `rgba(0, 2, 8, ${darkness * (0.42 + activity * 0.22)})`;
      context2d.fillRect(
        column / columns * canvasWidth,
        row / rows * canvasHeight,
        cellWidth,
        cellHeight,
      );
    }
  }
  context2d.restore();
}

function drawSpectralCombMask() {
  const settings = state.settings;
  const sculpt = currentVisualSculpt;
  if (Math.max(sculpt.qDepth, sculpt.fftDepth) <= 0.001) return;
  const slices = Math.max(128, Math.min(420, Math.round(canvasWidth / 2)));
  const sliceWidth = canvasWidth / slices;
  const responseY = Math.max(70, canvasHeight - Math.max(82, canvasHeight * 0.17));
  const responseHeight = Math.min(13, canvasHeight * 0.035);
  const stripTop = responseY - 4;
  const stripHeight = responseHeight + 9;
  const fftBinWidth = (audio.context?.sampleRate ?? 48_000) / MOIRE_DRONE_FFT_SIZE;

  const responseAt = (position) => {
    const frequency = settings.lowFrequency
      * (settings.highFrequency / settings.lowFrequency) ** position;
    const fftBinFrequency = Math.max(
      fftBinWidth,
      Math.round(frequency / fftBinWidth) * fftBinWidth,
    );
    const qGate = settings.spectralSculptMode === "notches"
      ? spectralWarpedCombGate({
        spectralPosition: position,
        toothPositions: visualCombPositions,
        toothWidths: visualQWidths,
        teeth: settings.combTeeth,
        width: sculpt.width,
        depth: sculpt.qDepth,
      })
      : spectralFftMaskGain({
        frequency,
        lowFrequency: settings.lowFrequency,
        highFrequency: settings.highFrequency,
        toothPositions: visualCombPositions,
        toothWidths: visualQWidths,
        teeth: settings.combTeeth,
        depth: sculpt.qDepth,
        sharpness: sculpt.character,
        mode: settings.spectralSculptMode,
        focus: sculpt.focus,
        width: sculpt.width,
      });
    const fftGate = spectralFftMaskGain({
      frequency: fftBinFrequency,
      binWidth: fftBinWidth,
      lowFrequency: settings.lowFrequency,
      highFrequency: settings.highFrequency,
      toothPositions: visualCombPositions,
      toothWidths: visualCombWidths,
      teeth: settings.combTeeth,
      depth: sculpt.fftDepth,
      sharpness: sculpt.fftSharpness,
      mode: settings.spectralSculptMode,
      focus: sculpt.focus,
      width: sculpt.width,
    });
    return { qGate, fftGate };
  };

  context2d.save();
  context2d.globalCompositeOperation = "source-over";
  context2d.fillStyle = "rgba(126, 135, 155, 0.16)";
  context2d.fillRect(0, stripTop, canvasWidth, stripHeight);
  for (let index = 0; index < slices; index += 1) {
    const position = (index + 0.5) / slices;
    const { qGate, fftGate } = responseAt(position);
    const gate = combinedSpectralGain(
      qGate,
      fftGate,
      settings.spectralFilterBlend,
      settings.spectralSculptMode,
    );
    const darkness = 1 - gate;
    if (darkness <= 0.001) continue;
    context2d.fillStyle = `rgba(1, 4, 10, ${darkness * 0.82})`;
    context2d.fillRect(index * sliceWidth, stripTop, sliceWidth + 1, stripHeight);
  }

  for (const engine of ["qGate", "fftGate"]) {
    context2d.beginPath();
    for (let index = 0; index <= slices; index += 1) {
      const position = index / slices;
      const response = responseAt(position);
      const x = position * canvasWidth;
      const y = responseY + (1 - response[engine]) * responseHeight;
      if (index === 0) context2d.moveTo(x, y);
      else context2d.lineTo(x, y);
    }
    const engineAmount = engine === "fftGate"
      ? settings.spectralFilterBlend
      : 1 - settings.spectralFilterBlend;
    context2d.strokeStyle = engine === "fftGate"
      ? `rgba(104, 247, 164, ${0.2 + engineAmount * 0.65})`
      : `rgba(255, 92, 173, ${0.2 + engineAmount * 0.65})`;
    context2d.lineWidth = engine === "fftGate" ? 1 : 0.9;
    context2d.stroke();
  }
  context2d.restore();
}

function drawSpectrum() {
  const live = state.audioOn && audio.getSpectrum(spectrum);
  const settings = state.settings;
  const baseline = canvasHeight - Math.max(68, canvasHeight * 0.14);
  const height = Math.max(22, canvasHeight * 0.08);
  const nyquist = Math.max(4_000, (audio.context?.sampleRate ?? 48_000) * 0.5);
  context2d.save();
  context2d.beginPath();
  const points = Math.max(80, Math.min(300, Math.round(canvasWidth / 3)));
  for (let index = 0; index <= points; index += 1) {
    const position = index / points;
    const frequency = settings.lowFrequency
      * (settings.highFrequency / settings.lowFrequency) ** position;
    const bin = Math.max(0, Math.min(
      spectrum.length - 1,
      Math.round(frequency / nyquist * spectrum.length),
    ));
    const db = live ? spectrum[bin] : -96;
    const magnitude = Math.max(0, Math.min(1, (db + 96) / 76));
    const x = position * canvasWidth;
    const y = baseline - magnitude * height;
    if (index === 0) context2d.moveTo(x, y);
    else context2d.lineTo(x, y);
  }
  context2d.strokeStyle = live ? "rgba(245, 213, 255, 0.72)" : "rgba(126, 135, 155, 0.22)";
  context2d.shadowBlur = 0;
  context2d.lineWidth = 1;
  context2d.stroke();
  context2d.restore();
}

function drawOrigin() {
  const x = (state.settings.originX + 1) * 0.5 * canvasWidth;
  const y = (state.settings.originY + 1) * 0.5 * canvasHeight;
  context2d.save();
  context2d.strokeStyle = "rgba(245, 213, 255, 0.28)";
  context2d.lineWidth = 0.75;
  context2d.beginPath();
  context2d.arc(x, y, 5, 0, Math.PI * 2);
  context2d.moveTo(x - 8, y);
  context2d.lineTo(x + 8, y);
  context2d.moveTo(x, y - 8);
  context2d.lineTo(x, y + 8);
  context2d.stroke();
  if (pointerId !== null) {
    const anchorX = (pointerAnchorX + 1) * 0.5 * canvasWidth;
    const anchorY = (pointerAnchorY + 1) * 0.5 * canvasHeight;
    const pointerX = (pointerCurrentX + 1) * 0.5 * canvasWidth;
    const pointerY = (pointerCurrentY + 1) * 0.5 * canvasHeight;
    const stretch = Math.hypot(pointerX - anchorX, pointerY - anchorY);
    if (stretch > 1) {
      const tether = context2d.createLinearGradient(anchorX, anchorY, pointerX, pointerY);
      tether.addColorStop(0, "rgba(104, 247, 164, 0.9)");
      tether.addColorStop(1, "rgba(255, 92, 173, 0.9)");
      context2d.beginPath();
      context2d.moveTo(anchorX, anchorY);
      context2d.lineTo(pointerX, pointerY);
      context2d.strokeStyle = tether;
      context2d.lineWidth = 1 + Math.abs(pointerPullAmount) * 2.5;
      context2d.stroke();
    }
    const haloRadius = 18 + Math.abs(pointerPullAmount) * 42;
    const halo = context2d.createRadialGradient(
      anchorX,
      anchorY,
      2,
      anchorX,
      anchorY,
      haloRadius,
    );
    const haloColor = pointerPullAmount >= 0 ? "104, 247, 164" : "255, 92, 173";
    halo.addColorStop(0, `rgba(${haloColor}, 0.22)`);
    halo.addColorStop(0.45, `rgba(${haloColor}, 0.08)`);
    halo.addColorStop(1, `rgba(${haloColor}, 0)`);
    context2d.fillStyle = halo;
    context2d.beginPath();
    context2d.arc(anchorX, anchorY, haloRadius, 0, Math.PI * 2);
    context2d.fill();
    context2d.beginPath();
    context2d.arc(anchorX, anchorY, 8 + Math.abs(pointerPullAmount) * 16, 0, Math.PI * 2);
    context2d.strokeStyle = pointerPullAmount >= 0
      ? "rgba(104, 247, 164, 0.82)"
      : "rgba(255, 92, 173, 0.82)";
    context2d.lineWidth = 1.5;
    context2d.stroke();
    context2d.beginPath();
    context2d.arc(anchorX, anchorY, 3 + Math.abs(pointerPullAmount) * 2.5, 0, Math.PI * 2);
    context2d.fillStyle = pointerPullAmount >= 0
      ? "rgba(104, 247, 164, 0.96)"
      : "rgba(255, 92, 173, 0.96)";
    context2d.fill();
    context2d.beginPath();
    context2d.arc(pointerX, pointerY, 3.5, 0, Math.PI * 2);
    context2d.fillStyle = "rgba(255, 92, 173, 0.92)";
    context2d.fill();
  } else if (document.activeElement === canvas) {
    const keyboardX = (keyboardSculptX + 1) * 0.5 * canvasWidth;
    const keyboardY = (keyboardSculptY + 1) * 0.5 * canvasHeight;
    context2d.beginPath();
    context2d.arc(keyboardX, keyboardY, 7, 0, TAU);
    context2d.moveTo(keyboardX - 11, keyboardY);
    context2d.lineTo(keyboardX + 11, keyboardY);
    context2d.moveTo(keyboardX, keyboardY - 11);
    context2d.lineTo(keyboardX, keyboardY + 11);
    context2d.strokeStyle = "rgba(245, 213, 255, 0.72)";
    context2d.lineWidth = 1;
    context2d.stroke();
  }
  context2d.restore();
}

function draw(timestamp, force = false) {
  if (!context2d || disposed || (document.hidden && !force)) return;
  // A held sheet follows the display's native refresh rate. Released motion
  // remains fluid, while an audio-only analyzer uses the lighter cadence.
  const frameInterval = pointerId !== null
    ? 0
    : reducedMotion
      ? (visualPropagation.activeCount > 0 ? 1_000 / 15 : 250)
      : 1_000 / (
        staticGridHasDeformation() || visualSculptGestureEnvelope > 1e-7
          ? ACTIVE_DEFORMATION_FRAME_RATE
          : AUDIO_VISUAL_FRAME_RATE
      );
  // RAF timestamps can land a fraction of a millisecond below an exact 30 or
  // 60 Hz boundary. Carrying the target phase also avoids dropping to 45 or
  // 48 fps on 90/144 Hz displays.
  if (!force && frameInterval > 0) {
    const elapsed = timestamp - lastDrawTime;
    if (elapsed < frameInterval - FRAME_INTERVAL_TOLERANCE_MS) return;
    const completedIntervals = Math.max(
      1,
      Math.floor((elapsed + FRAME_INTERVAL_TOLERANCE_MS) / frameInterval),
    );
    lastDrawTime = Math.min(
      timestamp,
      lastDrawTime + completedIntervals * frameInterval,
    );
  } else {
    lastDrawTime = timestamp;
  }
  updateVisualCombGeometry();
  context2d.clearRect(0, 0, canvasWidth, canvasHeight);
  drawBroadSculptRegions();
  drawStaticVectorGrid();
  drawEmbeddedCombGaps();
  drawSpectralCombMask();
  drawSpectrum();
  drawOrigin();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(1.5, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  context2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateGridDensityOutput();
  draw(performance.now(), true);
}

function animate(timestamp) {
  if (disposed) return;
  const elapsed = lastAnimationTime > 0
    ? Math.min(0.1, (timestamp - lastAnimationTime) / 1_000)
    : 0;
  lastAnimationTime = timestamp;
  const settings = state.settings;
  visualPropagation.setActiveLimit(settings.propagationVoices);
  visualPropagation.step(elapsed);
  if (staticGridHasDeformation()) {
    // The same manual fabric physics shapes both display and audio. Random
    // excitation and motor drive stay disabled so nothing moves underneath
    // a resting grid.
    visualFabric.step(
      elapsed,
      settings,
      true,
      visualDirectGestureResponse(),
    );
  }
  updatePropagationStatus();
  if (
    state.audioOn
    || staticGridHasDeformation()
    || visualSculptGestureEnvelope > 1e-7
  ) draw(timestamp);
  animationFrame = requestAnimationFrame(animate);
}

for (const [id, key, transform] of RANGE_BINDINGS) {
  $(id).addEventListener("input", (event) => {
    setParameter(key, transform(event.currentTarget.value));
  });
}

$("gridDensity").addEventListener("input", (event) => {
  state.gridDensity = Math.round(clampVisual(
    event.currentTarget.value,
    8,
    40,
    STATIC_GRID_ROWS,
  ));
  updateGridDensityOutput();
  draw(performance.now(), true);
});

$("gridDensity").addEventListener("change", () => {
  const { columns, rows } = staticGridDimensions();
  announce(`Vector grid density ${columns} by ${rows}.`);
});

$("audioButton").addEventListener("click", toggleAudio);

$("fabricExciteButton").addEventListener("click", async () => {
  if (!await ensureAudioOn()) return;
  triggerPropagationAt(
    state.settings.originX,
    state.settings.originY,
    Math.min(1.6, 0.5 + state.settings.fabricPull * 0.55),
    0.2 + state.settings.fabricInertia * 0.12,
  );
  draw(performance.now(), true);
  announce(`${propagationLabel()} wave plucked into the X / Y filter fabric.`);
});

$("clearWavesButton").addEventListener("click", () => {
  resetVisualDynamics({ resetComb: false });
  audio.resetFabric({ resetComb: false });
  updatePropagationStatus(true);
  draw(performance.now(), true);
  announce("Waves and fabric motion cleared.");
});

for (const button of $("collisionModeChoice").querySelectorAll("[data-collision-mode]")) {
  button.addEventListener("click", () => {
    setParameter("collisionMode", button.dataset.collisionMode);
    announce(`${button.textContent.trim()} collision selected.`);
  });
}

for (const button of $("spectralSculptModeChoice").querySelectorAll("[data-spectral-sculpt-mode]")) {
  button.addEventListener("click", () => {
    setParameter("spectralSculptMode", button.dataset.spectralSculptMode);
    announce(`${button.textContent.trim()} spectral sculptor selected. Touch left for low frequencies and right for high; pull farther for more intensity.`);
  });
}

for (const button of $("propagationModeChoice").querySelectorAll("[data-propagation-mode]")) {
  button.addEventListener("click", () => {
    setParameter("propagationMode", button.dataset.propagationMode);
    announce(`${button.textContent.trim()} fabric-wave mode selected.`);
  });
}

for (const button of $("noiseColorChoice").querySelectorAll("[data-noise-color]")) {
  button.addEventListener("click", () => {
    const value = Number(button.dataset.noiseColor);
    const choice = MOIRE_DRONE_NOISE_COLOR_CHOICES.find((candidate) => candidate.value === value);
    setParameter("noiseColor", value);
    announce(`${choice?.label ?? noiseColorLabel(value)} noise selected.`);
  });
}

for (const button of $("noiseTypeChoice").querySelectorAll("[data-noise-type]")) {
  button.addEventListener("click", () => {
    const type = button.dataset.noiseType;
    if (!MOIRE_DRONE_NOISE_TYPES.includes(type)) return;
    setParameter("noiseType", type);
    announce(`${noiseTypeLabel(type)} noise generator selected.`);
  });
}

$("stage").addEventListener("pointerdown", (event) => {
  if (
    pointerId !== null
    || event.isPrimary === false
    || (event.pointerType !== "touch" && event.button !== 0)
  ) return;
  event.preventDefault();
  const point = stagePointFromEvent(event);
  pointerId = event.pointerId;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  pointerStartTime = Number(event.timeStamp) || performance.now();
  pointerLastTime = pointerStartTime;
  pointerVelocityX = 0;
  pointerVelocityY = 0;
  pointerAnchorX = point.x;
  pointerAnchorY = point.y;
  pointerAudioAnchorX = point.x;
  pointerAudioAnchorY = point.y;
  pointerCurrentX = point.x;
  pointerCurrentY = point.y;
  pointerRawCurrentX = point.rawX;
  pointerRawCurrentY = point.rawY;
  pointerLastRippleTime = pointerStartTime;
  pointerWakeCount = 0;
  pointerWakeTravel = 0;
  holdVisualFabricAtPointer();
  pointerPullAmount = fabricGesturePull({
    anchorX: pointerAudioAnchorX,
    anchorY: pointerAudioAnchorY,
    currentX: pointerRawCurrentX,
    currentY: pointerRawCurrentY,
    velocityX: pointerVelocityX,
    velocityY: pointerVelocityY,
  }).amount;
  pointerDidDrag = false;
  canvas.classList.add("is-grabbed");
  $("fabricInstruction")?.classList.add("dismissed");
  canvas.focus?.({ preventScroll: true });
  canvas.setPointerCapture?.(event.pointerId);
  applyPointerTug(pointerPullAmount);
  draw(performance.now(), true);
  const pressedPointerId = event.pointerId;
  void ensureAudioOn().then((ready) => {
    if (ready && pointerId === pressedPointerId) {
      if (!emitFirstGrabWake(performance.now())) applyPointerTug(pointerPullAmount);
    }
  });
});

$("stage").addEventListener("pointermove", (event) => {
  if (pointerId !== event.pointerId) return;
  event.preventDefault();
  const dragThreshold = event.pointerType === "touch" ? 10 : 5;
  if (!pointerDidDrag) {
    const distance = Math.hypot(
      event.clientX - pointerStartX,
      event.clientY - pointerStartY,
    );
    if (distance >= dragThreshold) {
      pointerDidDrag = true;
      canvas.classList.add("is-pulling");
    }
  }
  tugFabricFromPointer(event);
});

async function releasePointer(event, { cancelled = false } = {}) {
  if (pointerId === null || (event?.pointerId != null && event.pointerId !== pointerId)) return;
  event?.preventDefault?.();
  if (!cancelled && event) {
    const dragThreshold = event.pointerType === "touch" ? 10 : 5;
    if (
      !pointerDidDrag
      && Math.hypot(
        event.clientX - pointerStartX,
        event.clientY - pointerStartY,
      ) >= dragThreshold
    ) {
      pointerDidDrag = true;
    }
    samplePointerEvent(event, { drawNow: false });
  }
  const releasedId = pointerId;
  const wasDrag = pointerDidDrag;
  const releaseAnchorX = pointerAnchorX;
  const releaseAnchorY = pointerAnchorY;
  const releaseCurrentX = pointerCurrentX;
  const releaseCurrentY = pointerCurrentY;
  const releaseGrabLocal = rotateFabricCoordinate(
    releaseCurrentX,
    releaseCurrentY,
    effectiveFabricAngle(),
  );
  const releaseCurrentLocalX = releaseGrabLocal.x;
  const releaseCurrentLocalY = releaseGrabLocal.y;
  const releaseAudioAnchorX = pointerAudioAnchorX;
  const releaseAudioAnchorY = pointerAudioAnchorY;
  const releaseGesture = currentAudioGesture();
  const releasePull = pointerPullAmount;
  const releaseWakeCount = pointerWakeCount;
  captureVisualSculptGesture(
    releaseAudioAnchorX,
    releaseAudioAnchorY,
    releasePull,
    releaseGesture,
    false,
  );
  const releaseFrequency = frequencyAtStageX(releaseCurrentX);
  const releaseVelocity = Math.hypot(pointerVelocityX, pointerVelocityY);
  const releaseStrain = clampVisual(releaseGesture.distance / 0.9, 0, 1, 0);
  const releaseSpeed = clampVisual(releaseVelocity / 7, 0, 1, 0);
  const releasePolarity = releasePull < 0 ? -1 : 1;
  const thrownMagnitude = wasDrag
    ? clampVisual(
      Math.max(0.38 + releaseStrain * 0.24, releaseSpeed * 0.82),
      0.38,
      1,
      0.38,
    )
    : Math.min(1, releaseVelocity * 0.58 / 6);
  const thrownForce = releasePolarity * thrownMagnitude;
  const releasedAt = Number(event?.timeStamp) || performance.now();
  const wasQuickTap = !wasDrag && releasedAt - pointerStartTime <= 350;
  const audioWasReady = state.audioOn;
  pointerId = null;
  pointerDidDrag = false;
  visualPullAnchorX = releaseAnchorX;
  visualPullAnchorY = releaseAnchorY;
  canvas.classList.remove("is-grabbed", "is-pulling");
  visualFabric.release();
  if (wasDrag && Math.abs(thrownForce) > 0.015) {
    visualFabric.excite(
      releaseCurrentLocalX,
      releaseCurrentLocalY,
      thrownForce,
      0.13 + state.settings.fabricInertia * 0.08,
    );
  }
  // The direct on-screen pull, like the direct audio override, belongs only
  // to contact. Any released motion now comes from the shared fabric impulse.
  visualPullOffsetX = 0;
  visualPullOffsetY = 0;
  audio.releaseFabric(releaseGesture);
  if (canvas.hasPointerCapture?.(releasedId)) canvas.releasePointerCapture(releasedId);
  pointerPullAmount = 0;
  draw(performance.now(), true);
  if (cancelled) return;
  const audioReady = audioWasReady || await ensureAudioOn();
  if (!audioReady) return;
  if (!wasQuickTap) {
    // A drag can finish before a suspended AudioContext has opened. Deliver
    // its one mandatory wake at the final hand position once audio is ready.
    if (wasDrag && releaseWakeCount === 0) {
      triggerDirectGrabWake(
        releaseCurrentX,
        releaseCurrentY,
        releasePull,
        releaseGesture,
      );
    }
    if (wasDrag || !audioWasReady) {
      const startupTransfer = audioWasReady ? 0 : Math.abs(releasePull) * 0.3;
      const audioThrowForce = releasePolarity * Math.min(
        1,
        Math.abs(thrownForce) + startupTransfer,
      );
      const releaseRadius = 0.13 + state.settings.fabricInertia * 0.08;
      if (!audioWasReady) {
        // Starting audio resets both simulations. Restore the exact same
        // release impulse visually before sending it to the worklet.
        const releaseLocal = rotateFabricCoordinate(
          releaseCurrentX,
          releaseCurrentY,
          effectiveFabricAngle(),
        );
        visualFabric.excite(
          releaseLocal.x,
          releaseLocal.y,
          audioThrowForce,
          releaseRadius,
        );
      }
      audio.kickFabric(
        releaseCurrentX,
        releaseCurrentY,
        audioThrowForce,
        releaseRadius,
        releaseGesture,
      );
    }
    announce(`${wasDrag ? "Pulled" : "Held"} ${spectralSculptLabel().toLowerCase()} near ${formatFrequency(releaseFrequency)} released with ${percent(Math.abs(releasePull))} intensity.`);
    return;
  }
  triggerPropagationAt(
    releaseAnchorX,
    releaseAnchorY,
    Math.min(1.35, 0.38 + state.settings.fabricPull * 0.42),
    0.16 + state.settings.fabricInertia * 0.1,
    {
      audioX: releaseAudioAnchorX,
      audioY: releaseAudioAnchorY,
      gesture: releaseGesture,
    },
  );
  draw(performance.now(), true);
  announce(`${propagationLabel()} ${spectralSculptLabel().toLowerCase()} wave plucked near ${formatFrequency(releaseFrequency)}.`);
}

$("stage").addEventListener("pointerup", releasePointer);
$("stage").addEventListener("pointercancel", (event) => releasePointer(event, { cancelled: true }));
$("stage").addEventListener("lostpointercapture", (event) => releasePointer(event, { cancelled: true }));

$("stage").addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (!await ensureAudioOn()) return;
    const keyboardWidth = (keyboardSculptY + 1) * 0.5;
    triggerPropagationAt(
      keyboardSculptX,
      keyboardSculptY,
      event.shiftKey
        ? 1.35
        : Math.min(1.1, 0.38 + state.settings.fabricPull * 0.42),
      0.1 + keyboardWidth * 0.28,
    );
    draw(performance.now(), true);
    announce(`${event.shiftKey ? "Strong " : ""}${propagationLabel().toLowerCase()} ${spectralSculptLabel().toLowerCase()} wave plucked near ${formatFrequency(frequencyAtStageX(keyboardSculptX))}.`);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const amount = event.shiftKey ? 0.2 : 0.05;
    keyboardSculptX = Math.max(-1, Math.min(
      1,
      keyboardSculptX + (event.key === "ArrowRight" ? amount : -amount),
    ));
    draw(performance.now(), true);
    announce(`Keyboard sculpt focus ${formatFrequency(frequencyAtStageX(keyboardSculptX))}. Press Enter to pluck or Shift Enter for a stronger pluck.`);
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const amount = event.shiftKey ? 0.2 : 0.05;
    keyboardSculptY = Math.max(-1, Math.min(
      1,
      keyboardSculptY + (event.key === "ArrowDown" ? amount : -amount),
    ));
    draw(performance.now(), true);
    announce(`Keyboard sculpt character ${percent((keyboardSculptY + 1) * 0.5)} broad. Press Enter to pluck.`);
  }
});

canvas.addEventListener("focus", () => draw(performance.now(), true));
canvas.addEventListener("blur", () => draw(performance.now(), true));

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  const outputLevel = state.settings.outputLevel;
  state.settings = { ...manualFabricSettings({ ...MOIRE_DRONE_DEFAULTS, outputLevel }) };
  state.gridDensity = STATIC_GRID_ROWS;
  state.preset = null;
  updateAudioParameters();
  resetVisualDynamics();
  audio.resetFabric();
  updateInterface();
  announce("All Fabric Filter parameters reset.");
});

audio.onQualityChange = (quality) => {
  state.quality = quality;
  updateInterface({ drawNow: false });
  announce(quality.tier > 0
    ? `Adaptive safeguard reduced the lattice to ${quality.activeFilters} active filters.`
    : "Full filter lattice restored.");
};

const resizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(resizeCanvas)
  : null;
resizeObserver?.observe(canvas);
globalThis.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    lastAnimationTime = performance.now();
    resizeCanvas();
  } else {
    releasePointer(undefined, { cancelled: true });
  }
});

globalThis.addEventListener("blur", () => releasePointer(undefined, { cancelled: true }));

globalThis.addEventListener("pagehide", () => {
  disposed = true;
  releasePointer(undefined, { cancelled: true });
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  audio.close();
}, { once: true });

renderPresets();
updateInterface({ drawNow: false });
resizeCanvas();
animationFrame = requestAnimationFrame(animate);

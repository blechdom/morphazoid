import {
  VoicePool,
  clamp,
  synthParametersForMode,
} from "./src/audio.js";
import {
  JULIA_DEFAULTS,
  JULIA_PRESETS,
  TAU,
  cumulativeTurnOctaves,
  generateJuliaBoundary,
  juliaVerticalAddressOctaves,
  sampleBoundary,
} from "./src/julia.js";
import {
  buildSimilarityAuditionLayers,
  buildInverseArcFamily,
  buildInverseArcTree,
  criticalOrbitStatus,
  evaluateSimilarityPlans,
  findRepellingPeriodicPoints,
  multiscalePitchBands,
  minimumAuditionDuration,
  rateLimitedTemporalPitchFidelity,
  sampleBoundaryArc,
  samplePitchSignal,
} from "./src/julia-similarity.js";

const $ = (id) => document.getElementById(id);
const LOOKAHEAD_SECONDS = 0.065;
const MAX_BASIC_SHEPARD_RATE = 7.5;
const MAX_SIMILARITY_SHEPARD_RATE = 30;
const PRESETS = JULIA_PRESETS;
const presetById = new Map(PRESETS.map((preset) => [preset.id, preset]));
const pool = new VoicePool(5);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const fieldCanvas = document.createElement("canvas");
const fieldContext = fieldCanvas.getContext("2d");

const CENTERED_RANGE_SCALES = Object.freeze({
  speed: Object.freeze({ low: 0.001, middle: JULIA_DEFAULTS.speed, high: 0.25, step: 0.001 }),
  cReal: Object.freeze({ low: -2, middle: JULIA_DEFAULTS.cReal, high: 0.5, step: 0.001 }),
  cImag: Object.freeze({ low: -1.2, middle: JULIA_DEFAULTS.cImag, high: 1.2, step: 0.0001 }),
  maxIterations: Object.freeze({ low: 8, middle: JULIA_DEFAULTS.maxIterations, high: 192, step: 4 }),
  resolution: Object.freeze({ low: 96, middle: JULIA_DEFAULTS.resolution, high: 544, step: 8 }),
});

const state = {
  presetId: JULIA_DEFAULTS.presetId,
  cReal: JULIA_DEFAULTS.cReal,
  cImag: JULIA_DEFAULTS.cImag,
  maxIterations: JULIA_DEFAULTS.maxIterations,
  resolution: JULIA_DEFAULTS.resolution,
  simplify: JULIA_DEFAULTS.contourTreatment,
  viewZoom: 0,
  viewCenterX: 0,
  viewCenterY: 0,
  position: 0,
  continuousPosition: 0,
  speed: JULIA_DEFAULTS.speed,
  direction: 1,
  playing: false,
  audio: false,
  level: 0.55,
  turnPolarity: 1,
  turnOctaves: JULIA_DEFAULTS.turnOctaves,
  cornerGlide: 0.35,
  baseFrequency: JULIA_DEFAULTS.baseFrequency,
  shepardWidth: JULIA_DEFAULTS.shepardWidth,
  synthMode: "basic",
  similarityExperiment: "chorus",
  motifWidth: 0.025,
  similarityDepth: 3,
  similarityDuration: 8,
  similarityBranch: 1,
  viewIterationBonus: 0,
};

let generated = null;
let viewGenerated = null;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let rebuildTimer = 0;
let viewRebuildTimer = 0;
let lastFrameTime = performance.now();
let lastAudioTime = null;
let audioOctavePosition = null;
let pointerGesture = null;
let similarityFamily = null;
let similarityTree = null;
let similarityPlans = null;
let similarityPeriodicTarget = null;
let similarityAudition = null;
const similarityAudioPositions = new Map();
let audioEnableRequest = 0;
let pageActive = true;
let pageLifecycleGeneration = 0;
let pendingEnableLifecycle = null;

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function signed(value, digits = 3, suffix = "") {
  const amount = Number(value) || 0;
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${Math.abs(amount).toFixed(digits)}${suffix}`;
}

function complexLabel(real, imaginary) {
  const imag = Number(imaginary) || 0;
  return `${signed(real)} ${imag < 0 ? "−" : "+"} ${Math.abs(imag).toFixed(4)}i`;
}

function quantizeRangeValue(value, scale) {
  const bounded = clamp(value, scale.low, scale.high);
  const steps = Math.round((bounded - scale.low) / scale.step);
  const quantized = scale.low + steps * scale.step;
  const precision = Math.max(0, String(scale.step).split(".")[1]?.length ?? 0);
  return Number(quantized.toFixed(precision));
}

function centeredRangeValue(position, scale) {
  const amount = clamp(Number(position) || 0, -1, 1);
  const value = amount < 0
    ? scale.middle + (scale.middle - scale.low) * amount
    : scale.middle + (scale.high - scale.middle) * amount;
  return quantizeRangeValue(value, scale);
}

function centeredRangePosition(value, scale) {
  const amount = clamp(Number(value), scale.low, scale.high);
  if (amount < scale.middle) {
    return (amount - scale.middle) / Math.max(1e-12, scale.middle - scale.low);
  }
  return (amount - scale.middle) / Math.max(1e-12, scale.high - scale.middle);
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(3_000_000 / (cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const centeredScale = CENTERED_RANGE_SCALES[id];
  const paint = () => {
    input.value = String(centeredScale
      ? centeredRangePosition(state[key], centeredScale)
      : state[key]);
    const text = formatter(state[key]);
    if (output) output.textContent = text;
    input.setAttribute("aria-valuetext", text);
  };
  input.addEventListener("input", () => {
    state[key] = centeredScale
      ? centeredRangeValue(input.value, centeredScale)
      : Number(input.value);
    paint();
    afterChange?.();
    scheduleFrame();
  });
  paint();
  return paint;
}

const paintPosition = bindRange("position", "position", (value) => `${(value * 100).toFixed(1)}%`, () => {
  const wrapped = wrap01(state.continuousPosition);
  state.continuousPosition += state.position - wrapped;
  audioOctavePosition = null;
  if (similarityFamily) invalidateSimilarity();
});
bindRange("speed", "speed", (value) => `${value.toFixed(3)} cyc/s`);
bindRange("level", "level", (value) => `${Math.round(value * 100)}%`, () => pool.setLevel(state.level));
const paintReal = bindRange("cReal", "cReal", (value) => signed(value), geometryControlChanged);
const paintImaginary = bindRange("cImag", "cImag", (value) => signed(value, 4, "i"), geometryControlChanged);
const paintIterations = bindRange("maxIterations", "maxIterations", (value) => String(Math.round(value)), scheduleBoundaryRebuild);
const paintResolution = bindRange("resolution", "resolution", (value) => `${Math.round(value)}²`, scheduleBoundaryRebuild);
const paintSimplify = bindRange("simplify", "simplify", (value) => value < -1e-9
  ? `${Math.abs(value).toFixed(2)} smooth`
  : value > 1e-9 ? `${value.toFixed(2)} px reduce` : "raw · 0.00 px", scheduleBoundaryRebuild);
const paintViewZoom = bindRange("viewZoom", "viewZoom", (value) => `${(2 ** value).toFixed(value < 3 ? 2 : 1)}×`, () => {
  state.viewIterationBonus = 0;
  updateViewUi();
  scheduleViewRebuild();
});
bindRange("turnOctaves", "turnOctaves", (value) => `${value.toFixed(2)} oct`, () => {
  audioOctavePosition = null;
  similarityAudioPositions.clear();
  updateMappingUi();
  updateSimilarityUi();
});
bindRange("cornerGlide", "cornerGlide", (value) => `${Math.round(value * 100)}% edge`, () => {
  audioOctavePosition = null;
});
bindRange("baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`);
bindRange("shepardWidth", "shepardWidth", (value) => `${value.toFixed(1)} oct`);
bindRange("motifWidth", "motifWidth", (value) => `${(value * 100).toFixed(1)}%`, invalidateSimilarity);
bindRange("similarityDepth", "similarityDepth", (value) => `${Math.round(value)} echo${Math.round(value) === 1 ? "" : "es"}`, invalidateSimilarity);
bindRange("similarityDuration", "similarityDuration", (value) => `${value.toFixed(1)} s`, () => {
  similarityAudioPositions.clear();
  updateSimilarityUi();
});

function updateJuliaSummary() {
  const preset = presetById.get(state.presetId);
  $("juliaSummary").textContent = preset?.name ?? `c ${complexLabel(state.cReal, state.cImag)}`;
}

function updateViewUi() {
  paintViewZoom?.();
  $("viewCenterOut").textContent = complexLabel(state.viewCenterX, state.viewCenterY);
}

function resetViewport(announceChange = true) {
  state.viewZoom = 0;
  state.viewCenterX = 0;
  state.viewCenterY = 0;
  state.viewIterationBonus = 0;
  updateViewUi();
  scheduleViewRebuild(true);
  scheduleFrame();
  if (announceChange) announce("Julia view reset to the complete set.");
}

function geometryControlChanged() {
  state.presetId = "custom";
  $("preset").value = "custom";
  updateJuliaSummary();
  scheduleBoundaryRebuild();
}

function setGeometryControls() {
  paintReal();
  paintImaginary();
  paintIterations();
  paintResolution();
  paintSimplify();
  updateJuliaSummary();
}

function loadPreset(id) {
  const preset = presetById.get(id) ?? PRESETS[0];
  state.presetId = preset.id;
  state.cReal = preset.cReal;
  state.cImag = preset.cImag;
  state.viewZoom = 0;
  state.viewCenterX = 0;
  state.viewCenterY = 0;
  state.viewIterationBonus = 0;
  if (preset.minimumResolution) {
    state.resolution = Math.max(state.resolution, preset.minimumResolution);
  }
  if (preset.maximumSimplify !== undefined) {
    state.simplify = Math.min(state.simplify, preset.maximumSimplify);
  }
  $("preset").value = preset.id;
  setGeometryControls();
  updateViewUi();
  scheduleBoundaryRebuild(true);
  announce(`${preset.name} Julia set selected.`);
}

$("preset").addEventListener("change", (event) => {
  if (event.currentTarget.value === "custom") {
    state.presetId = "custom";
    updateJuliaSummary();
    return;
  }
  loadPreset(event.currentTarget.value);
});

$("resetJulia").addEventListener("click", () => {
  state.maxIterations = JULIA_DEFAULTS.maxIterations;
  state.resolution = JULIA_DEFAULTS.resolution;
  state.simplify = JULIA_DEFAULTS.contourTreatment;
  loadPreset(JULIA_DEFAULTS.presetId);
});

$("resetView").addEventListener("click", () => resetViewport());

function updateMappingUi() {
  const leftRises = state.turnPolarity > 0;
  setPressed($("leftRises"), leftRises);
  setPressed($("rightRises"), !leftRises);
  $("leftRule").textContent = `+ angle → pitch ${leftRises ? "rises" : "falls"}`;
  $("rightRule").textContent = `− angle → pitch ${leftRises ? "falls" : "rises"}`;
  const mode = state.synthMode === "basic" ? "basic" : "vertical harmony";
  $("mappingSummary").textContent = `${leftRises ? "left" : "right"} rises · ${state.turnOctaves.toFixed(2)} oct/turn · ${mode}`;
}

function updateSynthModeUi() {
  const basic = state.synthMode === "basic";
  $("synthMode").value = basic ? "basic" : "harmony";
  $("soundSummary").textContent = basic ? "Basic Shepard" : "Shepard + harmony";
  $("verticalHarmonyRule").hidden = basic;
  $("synthModeHelp").textContent = basic
    ? "One Shepard voice follows signed boundary turns directly."
    : "The main Shepard voice follows signed boundary turns; vertical harmony adds a quieter position-address voice.";
  updateMappingUi();
}

for (const button of [$("leftRises"), $("rightRises")]) {
  button.addEventListener("click", () => {
    state.turnPolarity = Number(button.dataset.value) < 0 ? -1 : 1;
    audioOctavePosition = null;
    similarityAudioPositions.clear();
    updateMappingUi();
    scheduleFrame();
    announce(`${state.turnPolarity > 0 ? "Left" : "Right"} turns now raise pitch.`);
  });
}

$("synthMode").addEventListener("change", (event) => {
  state.synthMode = event.currentTarget.value === "basic" ? "basic" : "harmony";
  audioOctavePosition = null;
  pool.silence();
  updateSynthModeUi();
  scheduleFrame();
  announce(state.synthMode === "basic"
    ? "Basic Shepard playback selected."
    : "Shepard with vertical harmony selected.");
});
updateSynthModeUi();

const SIMILARITY_PLAN_LABELS = Object.freeze({
  chorus: "multiscale chorus",
  canon: "curvature canon",
  wavelet: "wavelet orchestra",
  orbit: "arc-orbit echoes",
  harmony: "similarity harmony",
});

function stopSimilarityAudition({ silence = true } = {}) {
  if (!similarityAudition) return;
  similarityAudition = null;
  similarityAudioPositions.clear();
  $("auditionSimilarity").textContent = "Audition plan";
  setPressed($("auditionSimilarity"), false);
  if (silence) pool.silence();
  scheduleFrame();
}

function invalidateSimilarity() {
  stopSimilarityAudition();
  similarityFamily = null;
  similarityTree = null;
  similarityPlans = null;
  similarityPeriodicTarget = null;
  similarityAudioPositions.clear();
  $("similaritySummary").textContent = "not traced";
  $("similarityLocation").textContent = "Move the playhead to choose a boundary motif.";
  $("similarityMatch").textContent = "—";
  $("similarityTempo").textContent = "—";
  $("similarityPlanResult").textContent = "—";
  $("auditionSimilarity").disabled = true;
  $("jumpSimilarity").disabled = true;
  scheduleFrame();
}

function updateNumericalWarning() {
  const status = criticalOrbitStatus(state.cReal, state.cImag, 65_536);
  const warning = $("similarityWarning");
  const messages = [];
  if (status.escaped) {
    messages.push(status.escapeIteration === state.maxIterations
      ? `Finite-depth warning: the critical orbit escapes at iteration ${status.escapeIteration}, exactly the current cap. This contour is exceptionally cap-sensitive.`
      : `Disconnected Julia set: the critical orbit escapes at iteration ${status.escapeIteration}. Inverse echoes are valid, but filled marching-squares components are finite-depth approximations.`);
  }
  const criticalLevel = similarityFamily?.levels?.slice(1)
    .find((level) => level.minimumCriticalDistance < 0.05);
  if (criticalLevel) {
    messages.push(`Echo ${criticalLevel.depth} passes near z=0, where the inverse map folds and a recognizable affine copy is not expected.`);
  }
  warning.textContent = messages.join(" ");
  warning.hidden = messages.length === 0;
}

function updateSimilarityUi() {
  const plan = similarityPlans?.[state.similarityExperiment];
  if (!similarityFamily || !plan) {
    $("similaritySummary").textContent = SIMILARITY_PLAN_LABELS[state.similarityExperiment];
    return;
  }
  const descendants = similarityFamily.levels.slice(1);
  const deepest = descendants.at(-1);
  const matchText = descendants
    .map((level) => `d${level.depth} r=${level.comparison.pitchCorrelation.toFixed(2)}`)
    .join(" · ");
  $("similarityMatch").textContent = `${matchText} · deepest interval r=${deepest.comparison.intervalCorrelation.toFixed(2)}`;

  const layers = similarityLayersForMode(state.similarityExperiment);
  const layerMetrics = layers.map((layer) => {
    const scale = Math.abs(state.turnOctaves * layer.pitchScale);
    const scaledSignal = {
      pitches: Float64Array.from(layer.signal.pitches, (pitch) => pitch * scale),
    };
    return {
      duration: layer.duration,
      fidelity: rateLimitedTemporalPitchFidelity(scaledSignal, layer.duration),
      safeDuration: minimumAuditionDuration(scaledSignal),
    };
  });
  const planDuration = layers.reduce(
    (latest, layer) => Math.max(latest, layer.start + layer.duration),
    0,
  );
  const fastest = layerMetrics.reduce(
    (selected, metric) => !selected || metric.duration < selected.duration ? metric : selected,
    null,
  );
  const worstCorrelation = Math.min(...layerMetrics.map((metric) => metric.fidelity.pitchCorrelation));
  const greatestLimitedFraction = Math.max(...layerMetrics.map((metric) => metric.fidelity.limitedFraction));
  const safeDuration = Math.max(...layerMetrics.map((metric) => metric.safeDuration));
  $("similarityTempo").textContent = `fastest ${fastest.duration.toFixed(2)} s · worst slew r=${worstCorrelation.toFixed(2)} / limited ${Math.round(greatestLimitedFraction * 100)}% · 99% slope-safe ≈${safeDuration.toFixed(1)} s · full plan ${planDuration.toFixed(1)} s`;

  if (state.similarityExperiment === "orbit") {
    $("similarityPlanResult").textContent = `sanity check · ${plan.summary}`;
    $("similaritySummary").textContent = `${SIMILARITY_PLAN_LABELS[state.similarityExperiment]} · arc-only`;
  } else {
    const carrier = plan.shapeBearing === true ? "outline-bearing proxy" : "detector, not outline";
    $("similarityPlanResult").textContent = `${Math.round(plan.score * 100)}% local proxy · ${carrier} · ${plan.summary}`;
    $("similaritySummary").textContent = `${SIMILARITY_PLAN_LABELS[state.similarityExperiment]} · proxy ${Math.round(plan.score * 100)}%`;
  }
}

function analyzeSimilarityFamily() {
  if (!generated?.boundary) return;
  stopSimilarityAudition();
  const parentArc = sampleBoundaryArc(generated.boundary, generated.field, {
    centerPhase: state.position,
    fraction: state.motifWidth,
    samples: 512,
  });
  similarityFamily = buildInverseArcFamily(parentArc, {
    cReal: state.cReal,
    cImag: state.cImag,
    depth: state.similarityDepth,
    branch: state.similarityBranch,
    samples: 512,
    smoothing: 12,
  });
  similarityTree = buildInverseArcTree(parentArc, {
    cReal: state.cReal,
    cImag: state.cImag,
    depth: state.similarityDepth,
    samples: 192,
  });
  for (const level of similarityFamily.levels) {
    level.bands = multiscalePitchBands(level.signal);
  }
  similarityPlans = evaluateSimilarityPlans(similarityFamily);
  const parentCenter = similarityFamily.levels[0].center;
  const periodic = findRepellingPeriodicPoints(state.cReal, state.cImag, { maxPeriod: 2 });
  similarityPeriodicTarget = periodic.reduce((nearest, target) => {
    const targetDistance = Math.hypot(target.x - parentCenter.x, target.y - parentCenter.y);
    return !nearest || targetDistance < nearest.distance ? { ...target, distance: targetDistance } : nearest;
  }, null);

  const deepest = similarityFamily.levels.at(-1);
  const sizeText = deepest.durationRatio <= 1
    ? `${deepest.magnification.toFixed(2)}× shorter by arc length`
    : `${deepest.durationRatio.toFixed(2)}× longer by arc length`;
  const periodicText = similarityPeriodicTarget
    ? ` · nearest periodic target q${similarityPeriodicTarget.period}, distance ${similarityPeriodicTarget.distance.toFixed(2)}, |λ| ${similarityPeriodicTarget.magnification.toFixed(2)}, inverse rotation ${(-similarityPeriodicTarget.rotation * 180 / Math.PI).toFixed(1)}°`
    : "";
  $("similarityLocation").textContent = `${2 ** deepest.depth} possible depth-${deepest.depth} locations · selected ${complexLabel(deepest.center.x, deepest.center.y)} · ${sizeText}${periodicText}`;
  $("auditionSimilarity").disabled = false;
  $("jumpSimilarity").disabled = false;
  updateSimilarityUi();
  updateNumericalWarning();
  similarityAudioPositions.clear();
  scheduleFrame();
  announce(`${similarityFamily.levels.length - 1} inverse-image echoes traced; deepest pitch correlation ${deepest.comparison.pitchCorrelation.toFixed(2)}.`);
}

$("similarityExperiment").addEventListener("change", (event) => {
  state.similarityExperiment = event.currentTarget.value;
  stopSimilarityAudition();
  updateSimilarityUi();
});

for (const button of [$("positiveBranch"), $("negativeBranch")]) {
  button.addEventListener("click", () => {
    state.similarityBranch = button === $("negativeBranch") ? -1 : 1;
    setPressed($("positiveBranch"), state.similarityBranch > 0);
    setPressed($("negativeBranch"), state.similarityBranch < 0);
    invalidateSimilarity();
    announce(`${state.similarityBranch > 0 ? "Positive" : "Negative"} inverse Julia branch selected.`);
  });
}

$("analyzeSimilarity").addEventListener("click", analyzeSimilarityFamily);

$("jumpSimilarity").addEventListener("click", () => {
  const deepest = similarityFamily?.levels?.at(-1);
  if (!deepest) return;
  const width = Math.max(1e-9, deepest.bounds.maxX - deepest.bounds.minX);
  const height = Math.max(1e-9, deepest.bounds.maxY - deepest.bounds.minY);
  const span = Math.max(width, height) * 1.8;
  state.viewCenterX = deepest.center.x;
  state.viewCenterY = deepest.center.y;
  state.viewZoom = clamp(Math.log2(4 / span), 0, 6);
  state.viewIterationBonus = deepest.depth;
  updateViewUi();
  scheduleViewRebuild(true);
  scheduleFrame();
  announce(`Zoomed to inverse echo ${deepest.depth}; view escape cap raised by ${deepest.depth}.`);
});

$("auditionSimilarity").addEventListener("click", async () => {
  if (similarityAudition) {
    stopSimilarityAudition();
    announce("Self-similarity audition stopped.");
    return;
  }
  if (!similarityFamily) analyzeSimilarityFamily();
  if (!similarityFamily) return;
  $("audioError").hidden = true;
  const enableRequest = ++audioEnableRequest;
  const lifecycleGeneration = pageLifecycleGeneration;
  try {
    if (!state.audio) {
      pendingEnableLifecycle = lifecycleGeneration;
      await pool.enable();
      if (!pageActive || lifecycleGeneration !== pageLifecycleGeneration) {
        if (pendingEnableLifecycle !== pageLifecycleGeneration && !state.audio) pool.disable();
        return;
      }
      if (enableRequest !== audioEnableRequest) return;
      pendingEnableLifecycle = null;
      pool.setLevel(state.level);
      state.audio = true;
      setPressed($("audioButton"), true);
      $("audioState").textContent = "on";
    }
  } catch (error) {
    if (!pageActive || lifecycleGeneration !== pageLifecycleGeneration || enableRequest !== audioEnableRequest) return;
    pendingEnableLifecycle = null;
    state.audio = false;
    $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
    $("audioError").hidden = false;
    return;
  }
  state.playing = false;
  setPressed($("playButton"), false);
  $("playSummary").textContent = "boundary · paused";
  similarityAudioPositions.clear();
  similarityAudition = {
    mode: state.similarityExperiment,
    startedAt: performance.now(),
  };
  $("auditionSimilarity").textContent = "Stop audition";
  setPressed($("auditionSimilarity"), true);
  resetClocks();
  scheduleFrame();
  announce(`${SIMILARITY_PLAN_LABELS[state.similarityExperiment]} audition started.`);
});

function buildFieldTexture(field) {
  const { width, height, maxIterations, values } = field;
  fieldCanvas.width = width;
  fieldCanvas.height = height;
  const image = fieldContext.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const iterations = values[y][x];
      const inside = iterations === maxIterations;
      const glow = (iterations / maxIterations) ** 0.38;
      const offset = (y * width + x) * 4;
      image.data[offset] = inside ? 20 : Math.round(7 + glow * 48);
      image.data[offset + 1] = inside ? 10 : Math.round(9 + glow * 11);
      image.data[offset + 2] = inside ? 21 : Math.round(13 + glow * 44);
      image.data[offset + 3] = inside ? 238 : Math.round(112 + glow * 86);
    }
  }
  fieldContext.putImageData(image, 0, 0);
}

function currentViewBounds() {
  const span = 4 / 2 ** state.viewZoom;
  return {
    minX: state.viewCenterX - span * 0.5,
    maxX: state.viewCenterX + span * 0.5,
    minY: state.viewCenterY - span * 0.5,
    maxY: state.viewCenterY + span * 0.5,
  };
}

function generationOptions(bounds, forView = false) {
  return {
    cReal: state.cReal,
    cImag: state.cImag,
    maxIterations: state.maxIterations + (forView ? state.viewIterationBonus : 0),
    resolution: state.resolution,
    simplifyTolerance: state.simplify,
    ...(bounds ? { bounds } : {}),
  };
}

function viewMatchesWholeSet() {
  return state.viewZoom === 0
    && Math.abs(state.viewCenterX) < 1e-12
    && Math.abs(state.viewCenterY) < 1e-12;
}

function rebuildView() {
  viewRebuildTimer = 0;
  if (!generated) return;
  try {
    viewGenerated = viewMatchesWholeSet()
      ? generated
      : generateJuliaBoundary(generationOptions(currentViewBounds(), true));
    buildFieldTexture(viewGenerated.field);
    $("geometryError").hidden = true;
  } catch (error) {
    $("geometryError").textContent = error instanceof Error ? error.message : "The zoomed Julia view could not be built.";
    $("geometryError").hidden = false;
  }
  scheduleFrame();
}

function scheduleViewRebuild(immediate = false) {
  clearTimeout(viewRebuildTimer);
  if (!generated) return;
  if (immediate) rebuildView();
  else viewRebuildTimer = setTimeout(rebuildView, 75);
}

function scheduleBoundaryRebuild(immediate = false) {
  clearTimeout(rebuildTimer);
  clearTimeout(viewRebuildTimer);
  $("geometryError").hidden = true;
  $("stageReadout").textContent = `${(presetById.get(state.presetId)?.name ?? "CUSTOM").toUpperCase()} · BUILDING BOUNDARY`;
  if (immediate) rebuildBoundary();
  else rebuildTimer = setTimeout(rebuildBoundary, 90);
}

function rebuildBoundary() {
  rebuildTimer = 0;
  if (similarityFamily) invalidateSimilarity();
  const started = performance.now();
  try {
    const next = generateJuliaBoundary(generationOptions());
    const generationMilliseconds = performance.now() - started;
    generated = next;
    if (!next.boundary) {
      throw new Error("No closed Julia boundary was found at this grid and escape depth.");
    }
    viewGenerated = viewMatchesWholeSet()
      ? next
      : generateJuliaBoundary(generationOptions(currentViewBounds(), true));
    buildFieldTexture(viewGenerated.field);
    $("geometryError").hidden = true;
    audioOctavePosition = null;
    announce(`${next.contours.filter((contour) => contour.closed).length} closed boundaries found in ${Math.round(generationMilliseconds)} milliseconds; traversing the longest.`);
  } catch (error) {
    generated = null;
    viewGenerated = null;
    state.playing = false;
    audioOctavePosition = null;
    setPressed($("playButton"), false);
    pool.silence();
    $("geometryError").textContent = error instanceof Error ? error.message : "The Julia boundary could not be built.";
    $("geometryError").hidden = false;
    announce($("geometryError").textContent);
  }
  updateNumericalWarning();
  resetClocks();
  scheduleFrame();
}

function drawingTransform() {
  const side = Math.max(1, Math.min(cssWidth, cssHeight) * 0.88);
  const x = (cssWidth - side) * 0.5;
  const y = (cssHeight - side) * 0.5;
  const viewField = viewGenerated?.field ?? generated?.field;
  const viewBounds = viewField?.bounds ?? currentViewBounds();
  const viewWidth = Math.max(1e-12, viewBounds.maxX - viewBounds.minX);
  const viewHeight = Math.max(1e-12, viewBounds.maxY - viewBounds.minY);
  return {
    side,
    x,
    y,
    complex(point) {
      return {
        x: x + ((point.x - viewBounds.minX) / viewWidth) * side,
        y: y + ((viewBounds.maxY - point.y) / viewHeight) * side,
      };
    },
    point(point, field = generated?.field) {
      const bounds = field?.bounds ?? viewBounds;
      return this.complex({
        x: bounds.minX
          + (point.x / Math.max(1, (field?.width ?? 2) - 1)) * (bounds.maxX - bounds.minX),
        y: bounds.minY
          + (point.y / Math.max(1, (field?.height ?? 2) - 1)) * (bounds.maxY - bounds.minY),
      });
    },
  };
}

function tracePoints(points, transform, field, closed = true) {
  if (!points?.length) return;
  const first = transform.point(points[0], field);
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = transform.point(points[index], field);
    context.lineTo(point.x, point.y);
  }
  if (closed) context.closePath();
}

function traceComplexPoints(points, transform) {
  if (!points?.length) return;
  const first = transform.complex(points[0]);
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    const point = transform.complex(points[index]);
    context.lineTo(point.x, point.y);
  }
}

function turnColor(turn, alpha = 1) {
  if (turn > 0.015) return `rgba(95, 232, 196, ${alpha})`;
  if (turn < -0.015) return `rgba(255, 184, 107, ${alpha})`;
  return `rgba(219, 228, 224, ${alpha * 0.55})`;
}

function drawScene(sample) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  if (!generated || !viewGenerated) return;
  const transform = drawingTransform();

  context.save();
  context.globalAlpha = 0.72;
  context.imageSmoothingEnabled = true;
  context.drawImage(fieldCanvas, transform.x, transform.y, transform.side, transform.side);
  context.restore();

  context.save();
  context.beginPath();
  for (const contour of viewGenerated.contours) {
    tracePoints(contour.points, transform, viewGenerated.field, contour.closed);
  }
  context.strokeStyle = "rgba(255, 122, 166, 0.16)";
  context.lineWidth = 0.75;
  context.stroke();
  context.restore();

  if (similarityFamily?.levels?.length) {
    const colors = [
      "rgba(255, 243, 214, 0.92)",
      "rgba(95, 232, 196, 0.88)",
      "rgba(125, 180, 255, 0.86)",
      "rgba(199, 155, 255, 0.84)",
    ];
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    if (similarityTree?.levels?.length) {
      for (let depth = 1; depth < similarityTree.levels.length; depth += 1) {
        context.beginPath();
        for (const arc of similarityTree.levels[depth]) traceComplexPoints(arc, transform);
        context.strokeStyle = `rgba(95, 232, 196, ${Math.max(0.14, 0.34 - depth * 0.055)})`;
        context.lineWidth = 1;
        context.shadowBlur = 0;
        context.stroke();
      }
    }
    for (const level of similarityFamily.levels) {
      context.beginPath();
      traceComplexPoints(level.points, transform);
      context.strokeStyle = colors[Math.min(level.depth, colors.length - 1)];
      context.lineWidth = level.depth === 0 ? 3 : 2.2;
      context.shadowColor = colors[Math.min(level.depth, colors.length - 1)];
      context.shadowBlur = 9;
      context.stroke();
      const center = transform.complex(level.center);
      context.beginPath();
      context.arc(center.x, center.y, level.depth === 0 ? 4 : 3, 0, TAU);
      context.fillStyle = colors[Math.min(level.depth, colors.length - 1)];
      context.fill();
    }
    if (similarityPeriodicTarget) {
      const target = transform.complex(similarityPeriodicTarget);
      context.beginPath();
      context.arc(target.x, target.y, 8, 0, TAU);
      context.strokeStyle = "rgba(255, 184, 107, 0.9)";
      context.lineWidth = 1.3;
      context.shadowColor = "rgba(255, 184, 107, 0.9)";
      context.shadowBlur = 12;
      context.stroke();
    }
    context.restore();
  }

  const boundary = generated.boundary;
  context.save();
  context.beginPath();
  tracePoints(boundary.points, transform, generated.field);
  context.strokeStyle = "rgba(255, 122, 166, 0.24)";
  context.lineWidth = 5;
  context.shadowColor = "rgba(255, 122, 166, 0.58)";
  context.shadowBlur = 15;
  context.stroke();
  context.restore();

  context.save();
  context.lineCap = "round";
  const turnGroups = [
    { matches: (turn) => turn > 0.015, color: turnColor(1, 0.72) },
    { matches: (turn) => turn < -0.015, color: turnColor(-1, 0.72) },
    { matches: (turn) => Math.abs(turn) <= 0.015, color: turnColor(0, 0.72) },
  ];
  for (const group of turnGroups) {
    context.beginPath();
    for (const segment of boundary.segments) {
      if (!group.matches(segment.turn)) continue;
      const start = transform.point(segment.start, generated.field);
      const end = transform.point(segment.end, generated.field);
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
    }
    context.strokeStyle = group.color;
    context.lineWidth = 1.15;
    context.stroke();
  }
  context.restore();

  if (!sample) return;
  context.save();
  context.beginPath();
  const trailLength = 0.042;
  const trailSteps = 42;
  for (let index = 0; index <= trailSteps; index += 1) {
    const phase = state.position - state.direction * trailLength * (1 - index / trailSteps);
    const trailSample = sampleBoundary(boundary, phase);
    const point = transform.point(trailSample, generated.field);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.strokeStyle = "rgba(255, 243, 214, 0.82)";
  context.lineWidth = 2.2;
  context.shadowColor = "rgba(255, 122, 166, 0.92)";
  context.shadowBlur = 14;
  context.stroke();
  context.restore();

  const point = transform.point(sample, generated.field);
  const motionTurn = sample.turn * state.direction;
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, 11, 0, TAU);
  context.strokeStyle = turnColor(motionTurn, 0.5);
  context.lineWidth = 1;
  context.stroke();
  context.shadowColor = turnColor(motionTurn, 1);
  context.shadowBlur = 22;
  context.beginPath();
  context.arc(point.x, point.y, 4.6, 0, TAU);
  context.fillStyle = "#fff3d6";
  context.fill();
  context.restore();
}

function pitchStateAt(continuousPosition) {
  return cumulativeTurnOctaves(generated?.boundary, continuousPosition, {
    octavesPerTurn: state.turnOctaves,
    polarity: state.turnPolarity,
    glide: state.cornerGlide,
  });
}

function boundaryVerticalAddress(continuousPosition) {
  if (!generated?.boundary || !generated?.field) return 0;
  const radius = 0.018;
  let sum = 0;
  let count = 0;
  for (let index = -4; index <= 4; index += 1) {
    const sample = sampleBoundary(
      generated.boundary,
      continuousPosition + radius * index / 4,
    );
    if (!sample) continue;
    sum += sample.y / Math.max(1, generated.field.height - 1) * 2 - 1;
    count += 1;
  }
  return clamp(count ? sum / count : 0, -1, 1);
}

function voiceForPitch(pitch, shepardRate = 0, {
  key = "julia:boundary",
  gain = 0.22,
  pan: requestedPan,
  octaveOffset = 0,
  frequencyRatio = 1,
} = {}) {
  const sample = pitch.sample;
  const pan = Number.isFinite(requestedPan) ? requestedPan : sample && generated?.field
    ? clamp(sample.x / Math.max(1, generated.field.width - 1) * 2 - 1, -1, 1)
    : 0;
  const octavePosition = pitch.octavePosition + octaveOffset;
  const octavePhase = wrap01(octavePosition);
  const anchor = state.baseFrequency * frequencyRatio;
  const fallbackFrequency = anchor * 2 ** octavePhase;
  return {
    key,
    frequency: pool.workletUnavailable ? fallbackFrequency : anchor,
    gain,
    pan,
    waveform: "sine",
    ...synthParametersForMode("shepard", 1, {
      shepardRate,
      shepardWidth: state.shepardWidth,
      shepardPosition: octavePhase,
    }),
    shepardTravel: octavePosition,
  };
}

function voiceForSimilarityPitch(layer, octavePosition, shepardRate, gain) {
  const octavePhase = wrap01(octavePosition);
  const synthMode = layer.synthMode ?? "shepard";
  const anchor = state.baseFrequency * (layer.frequencyRatio ?? 1);
  const frequency = synthMode === "shepard"
    ? pool.workletUnavailable ? anchor * 2 ** octavePhase : anchor
    : anchor * 2 ** clamp(octavePosition, -4, 4);
  const shepardWidth = clamp(
    state.shepardWidth * (layer.shepardWidthRatio ?? 1),
    1,
    15,
  );
  return {
    key: layer.key,
    frequency,
    gain,
    pan: layer.pan,
    waveform: "sine",
    ...synthParametersForMode(synthMode, 1, {
      fmIndex: layer.modulationIndex ?? 2.5,
      shepardRate,
      shepardWidth,
      shepardPosition: octavePhase,
    }),
    shepardTravel: octavePosition,
  };
}

function rateLimitedSimilarityTrajectory(key, currentTarget, futureTarget, deltaSeconds) {
  let current = similarityAudioPositions.get(key);
  if (!Number.isFinite(current)) current = currentTarget;
  else {
    const maximumStep = MAX_SIMILARITY_SHEPARD_RATE * Math.max(0, deltaSeconds);
    current += clamp(currentTarget - current, -maximumStep, maximumStep);
  }
  similarityAudioPositions.set(key, current);
  const futureStep = clamp(
    futureTarget - current,
    -MAX_SIMILARITY_SHEPARD_RATE * LOOKAHEAD_SECONDS,
    MAX_SIMILARITY_SHEPARD_RATE * LOOKAHEAD_SECONDS,
  );
  return {
    current,
    future: current + futureStep,
    rate: futureStep / LOOKAHEAD_SECONDS,
  };
}

function smoothAuditionEnvelope(localTime, duration, maximumEdge = 0.18) {
  if (localTime < 0 || localTime > duration) return 0;
  const edge = Math.min(maximumEdge, duration * 0.12);
  if (!(edge > 0)) return 1;
  const amount = clamp(Math.min(localTime, duration - localTime) / edge, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function similarityLayerPhase(layer, localTime) {
  if (layer.repeatPeriod > 0) return wrap01(Math.max(0, localTime) / layer.repeatPeriod);
  return clamp(localTime / layer.duration, 0, 1);
}

function similarityLayerEnvelope(layer, localTime) {
  const outer = smoothAuditionEnvelope(
    localTime,
    layer.duration,
    layer.fadeSeconds ?? 0.18,
  );
  if (!(outer > 0) || !(layer.repeatPeriod > 0) || layer.repeatPeriod >= layer.duration - 1e-9) {
    return outer;
  }
  const cycleTime = wrap01(Math.max(0, localTime) / layer.repeatPeriod) * layer.repeatPeriod;
  return outer * smoothAuditionEnvelope(cycleTime, layer.repeatPeriod, 0.055);
}

function similarityLayersForMode(mode) {
  return buildSimilarityAuditionLayers(
    similarityFamily,
    similarityPlans,
    mode,
    { referenceDuration: state.similarityDuration, minimumLayerDuration: 2 },
  );
}

function directedSimilarityPitch(signal, phase) {
  if (state.direction > 0) return samplePitchSignal(signal, phase);
  return samplePitchSignal(signal, 1 - phase) - samplePitchSignal(signal, 1);
}

function similarityVoiceTrajectory(now, deltaSeconds) {
  if (!similarityAudition || !similarityFamily) return null;
  const elapsed = Math.max(0, (now - similarityAudition.startedAt) / 1000);
  const layers = similarityLayersForMode(similarityAudition.mode);
  const endTime = layers.reduce((latest, layer) => Math.max(latest, layer.start + layer.duration), 0);
  if (elapsed > endTime + 0.08) {
    stopSimilarityAudition();
    announce(`${SIMILARITY_PLAN_LABELS[state.similarityExperiment]} audition complete.`);
    return { current: [], future: [] };
  }
  const current = [];
  const future = [];
  for (const layer of layers) {
    const local = elapsed - layer.start;
    const futureLocal = local + LOOKAHEAD_SECONDS;
    const currentGain = similarityLayerEnvelope(layer, local) * layer.gain;
    const futureGain = similarityLayerEnvelope(layer, futureLocal) * layer.gain;
    if (currentGain <= 0 && futureGain <= 0) continue;
    const currentPhase = similarityLayerPhase(layer, local);
    const futurePhase = similarityLayerPhase(layer, futureLocal);
    const mappingScale = state.turnPolarity * state.turnOctaves * layer.pitchScale;
    const currentTarget = layer.pitchOffset
      + mappingScale * directedSimilarityPitch(layer.signal, currentPhase);
    const futureTarget = layer.pitchOffset
      + mappingScale * directedSimilarityPitch(layer.signal, futurePhase);
    const pitch = rateLimitedSimilarityTrajectory(
      layer.key,
      currentTarget,
      futureTarget,
      deltaSeconds,
    );
    current.push(voiceForSimilarityPitch(layer, pitch.current, pitch.rate, currentGain));
    future.push(voiceForSimilarityPitch(layer, pitch.future, pitch.rate, futureGain));
  }
  return { current, future };
}

function pitchAtAudioPosition(pitch, octavePosition) {
  return {
    ...pitch,
    octavePosition,
    octavePhase: wrap01(octavePosition),
  };
}

function rateLimitedAudioTrajectory(pitch, futurePitch, deltaSeconds) {
  const maximumRate = state.synthMode === "basic"
    ? MAX_BASIC_SHEPARD_RATE
    : MAX_SIMILARITY_SHEPARD_RATE;
  if (!Number.isFinite(audioOctavePosition)) {
    audioOctavePosition = pitch.octavePosition;
  } else {
    const correction = pitch.octavePosition - audioOctavePosition;
    const maximumStep = maximumRate * Math.max(0, deltaSeconds);
    audioOctavePosition += clamp(correction, -maximumStep, maximumStep);
  }
  const futureCorrection = futurePitch.octavePosition - audioOctavePosition;
  const futureStep = clamp(
    futureCorrection,
    -maximumRate * LOOKAHEAD_SECONDS,
    maximumRate * LOOKAHEAD_SECONDS,
  );
  const futureAudioPosition = audioOctavePosition + futureStep;
  return {
    current: pitchAtAudioPosition(pitch, audioOctavePosition),
    future: pitchAtAudioPosition(futurePitch, futureAudioPosition),
    rate: futureStep / LOOKAHEAD_SECONDS,
  };
}

function updateTurnReadout(sample) {
  const turn = (sample?.turn ?? 0) * state.direction;
  const degrees = turn * 180 / Math.PI;
  const octaveChange = state.turnPolarity * state.turnOctaves * turn / TAU;
  const direction = degrees > 0.35 ? "LEFT" : degrees < -0.35 ? "RIGHT" : "STRAIGHT";
  $("turnReadout").textContent = `${direction} · ${signed(degrees, 1, "°")} · ${signed(octaveChange, 3, " OCT")}`;
  const meta = $("turnReadout").parentElement;
  meta.classList.toggle("is-left", direction === "LEFT");
  meta.classList.toggle("is-right", direction === "RIGHT");
}

function resetClocks() {
  lastFrameTime = performance.now();
  lastAudioTime = pool.context?.currentTime ?? null;
}

function transportDelta(now) {
  const performanceDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const audioTime = state.audio && pool.context?.state === "running"
    ? pool.context.currentTime
    : null;
  const audioDelta = Number.isFinite(audioTime)
    && Number.isFinite(lastAudioTime)
    && audioTime >= lastAudioTime
    ? audioTime - lastAudioTime
    : 0;
  lastAudioTime = Number.isFinite(audioTime) ? audioTime : null;
  return Math.min(1, audioDelta > 1e-6 ? audioDelta : performanceDelta);
}

function frame(now) {
  scheduledFrame = 0;
  const delta = transportDelta(now);
  if (state.playing && generated?.boundary) {
    state.continuousPosition += state.direction * state.speed * delta;
    state.position = wrap01(state.continuousPosition);
  }

  const pitch = generated?.boundary ? pitchStateAt(state.continuousPosition) : null;
  drawScene(pitch?.sample ?? null);
  updateTurnReadout(pitch?.sample ?? null);

  const similarityTrajectory = state.audio && similarityAudition
    ? similarityVoiceTrajectory(now, delta)
    : null;
  if (similarityTrajectory) {
    audioOctavePosition = null;
    pool.setVoiceTrajectory(
      similarityTrajectory.current,
      similarityTrajectory.future,
      LOOKAHEAD_SECONDS,
    );
  } else if (state.audio && state.playing && pitch?.sample) {
    const futurePosition = state.continuousPosition
      + state.direction * state.speed * LOOKAHEAD_SECONDS;
    const futurePitch = pitchStateAt(futurePosition);
    const audioTrajectory = rateLimitedAudioTrajectory(pitch, futurePitch, delta);
    const basic = state.synthMode === "basic";
    const shapeOptions = {
      key: basic ? "julia:boundary" : "julia:boundary:shape",
      gain: basic ? 0.26 : 0.22,
    };
    const currentVoices = [voiceForPitch(
      audioTrajectory.current,
      audioTrajectory.rate,
      shapeOptions,
    )];
    const futureVoices = [voiceForPitch(
      audioTrajectory.future,
      audioTrajectory.rate,
      shapeOptions,
    )];
    if (!basic) {
      const currentAddress = boundaryVerticalAddress(state.continuousPosition);
      const futureAddress = boundaryVerticalAddress(futurePosition);
      const currentInterval = juliaVerticalAddressOctaves(currentAddress);
      const futureInterval = juliaVerticalAddressOctaves(futureAddress);
      const addressRate = (futureInterval - currentInterval) / LOOKAHEAD_SECONDS;
      currentVoices.push(voiceForPitch(audioTrajectory.current, audioTrajectory.rate + addressRate, {
        key: "julia:boundary:address",
        gain: 0.105,
        pan: currentAddress * 0.62,
        octaveOffset: currentInterval,
      }));
      futureVoices.push(voiceForPitch(audioTrajectory.future, audioTrajectory.rate + addressRate, {
        key: "julia:boundary:address",
        gain: 0.105,
        pan: futureAddress * 0.62,
        octaveOffset: futureInterval,
      }));
    }
    pool.setVoiceTrajectory(
      currentVoices,
      futureVoices,
      LOOKAHEAD_SECONDS,
    );
  } else if (state.audio) {
    audioOctavePosition = null;
    pool.setVoices([]);
  } else {
    audioOctavePosition = null;
  }

  $("position").value = String(state.position);
  $("positionOut").textContent = `${(state.position * 100).toFixed(1)}%`;
  const presetName = presetById.get(state.presetId)?.name ?? "Custom";
  const closedCount = generated?.contours.filter((contour) => contour.closed).length ?? 0;
  const pointCount = generated?.boundary?.points.length ?? 0;
  const audioText = state.audio
    ? similarityAudition
      ? `${SIMILARITY_PLAN_LABELS[similarityAudition.mode].toUpperCase()} LAB`
      : state.playing ? pool.workletUnavailable ? "SINE FALLBACK" : "SHEPARD ON" : "AUDIO READY"
    : "AUDIO OFF";
  const zoomText = `${(2 ** state.viewZoom).toFixed(state.viewZoom < 3 ? 2 : 1)}×`;
  $("stageReadout").textContent = generated?.boundary
    ? `${presetName.toUpperCase()} · ${closedCount} LOOP${closedCount === 1 ? "" : "S"} · ${pointCount} TURNS · ${zoomText} · ${audioText}`
    : `${presetName.toUpperCase()} · NO BOUNDARY`;
  canvas.setAttribute(
    "aria-label",
    `${presetName} Julia set at ${zoomText} zoom with ${closedCount} closed boundaries. ${pointCount} points on the traversed loop.`,
  );

  if (state.playing || similarityAudition) scheduleFrame();
}

$("playButton").addEventListener("click", () => {
  if (!generated?.boundary) return;
  if (similarityAudition) stopSimilarityAudition();
  state.playing = !state.playing;
  audioOctavePosition = null;
  setPressed($("playButton"), state.playing);
  $("playSummary").textContent = `boundary · ${state.playing ? "playing" : "paused"}`;
  if (!state.playing) pool.silence();
  resetClocks();
  scheduleFrame();
  announce(`Boundary traversal ${state.playing ? "started" : "paused"}.`);
});

$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  similarityAudioPositions.clear();
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  resetClocks();
  scheduleFrame();
  announce(`Boundary direction ${state.direction > 0 ? "forward" : "reverse"}.`);
});

$("audioButton").addEventListener("click", async () => {
  const enableRequest = ++audioEnableRequest;
  const lifecycleGeneration = pageLifecycleGeneration;
  $("audioError").hidden = true;
  $("audioButton").disabled = true;
  try {
    if (state.audio) {
      pendingEnableLifecycle = null;
      stopSimilarityAudition({ silence: false });
      state.audio = false;
      audioOctavePosition = null;
      pool.disable();
    } else {
      $("audioState").textContent = "off";
      pendingEnableLifecycle = lifecycleGeneration;
      await pool.enable();
      if (!pageActive || lifecycleGeneration !== pageLifecycleGeneration) {
        state.audio = false;
        if (pendingEnableLifecycle !== pageLifecycleGeneration) pool.disable();
        return;
      }
      if (enableRequest !== audioEnableRequest) return;
      pendingEnableLifecycle = null;
      pool.setLevel(state.level);
      state.audio = true;
      audioOctavePosition = null;
      resetClocks();
    }
  } catch (error) {
    if (!pageActive || lifecycleGeneration !== pageLifecycleGeneration || enableRequest !== audioEnableRequest) return;
    pendingEnableLifecycle = null;
    state.audio = false;
    $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
    $("audioError").hidden = false;
  } finally {
    $("audioButton").disabled = false;
  }
  setPressed($("audioButton"), state.audio);
  $("audioState").textContent = state.audio ? "on" : "off";
  scheduleFrame();
});

function phaseNearestPointer(event) {
  if (!generated?.boundary) return null;
  const bounds = canvas.getBoundingClientRect();
  const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  const transform = drawingTransform();
  let nearest = null;
  for (const segment of generated.boundary.segments) {
    const start = transform.point(segment.start, generated.field);
    const end = transform.point(segment.end, generated.field);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared > 0
      ? clamp(((pointer.x - start.x) * dx + (pointer.y - start.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const x = start.x + dx * amount;
    const y = start.y + dy * amount;
    const distanceSquared = (pointer.x - x) ** 2 + (pointer.y - y) ** 2;
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = {
        distanceSquared,
        phase: (segment.startDistance + amount * segment.length) / generated.boundary.totalLength,
      };
    }
  }
  return nearest;
}

function scrubFromPointer(event) {
  const nearest = phaseNearestPointer(event);
  if (!nearest || nearest.distanceSquared > 32 ** 2) return false;
  state.position = nearest.phase;
  const lap = Math.floor(state.continuousPosition);
  state.continuousPosition = lap + nearest.phase;
  audioOctavePosition = null;
  if (similarityFamily) invalidateSimilarity();
  paintPosition();
  scheduleFrame();
  return true;
}

canvas.addEventListener("pointerdown", (event) => {
  const requestedPan = event.shiftKey || event.button === 1;
  const scrubbed = requestedPan ? false : scrubFromPointer(event);
  const pan = requestedPan || !scrubbed;
  pointerGesture = pan
    ? {
      type: "pan",
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      centerX: state.viewCenterX,
      centerY: state.viewCenterY,
      span: 4 / 2 ** state.viewZoom,
    }
    : { type: "scrub", pointerId: event.pointerId };
  stageWrap.classList.toggle("is-panning", pan);
  canvas.setPointerCapture(event.pointerId);
  if (pan) event.preventDefault?.();
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointerGesture || event.pointerId !== pointerGesture.pointerId) return;
  if (pointerGesture.type === "scrub") {
    scrubFromPointer(event);
    return;
  }
  const transform = drawingTransform();
  state.viewCenterX = pointerGesture.centerX
    - (event.clientX - pointerGesture.x) / transform.side * pointerGesture.span;
  state.viewCenterY = pointerGesture.centerY
    + (event.clientY - pointerGesture.y) / transform.side * pointerGesture.span;
  updateViewUi();
  scheduleViewRebuild();
  scheduleFrame();
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerGesture || event.pointerId !== pointerGesture.pointerId) return;
  const gesture = pointerGesture.type;
  pointerGesture = null;
  stageWrap.classList.toggle("is-panning", false);
  if (gesture === "pan") {
    scheduleViewRebuild(true);
    announce(`View centered at ${complexLabel(state.viewCenterX, state.viewCenterY)}.`);
  } else {
    announce(`Boundary position ${(state.position * 100).toFixed(1)} percent.`);
  }
});
canvas.addEventListener("pointercancel", () => {
  pointerGesture = null;
  stageWrap.classList.toggle("is-panning", false);
});

function zoomAtPointer(event, nextZoom) {
  const transform = drawingTransform();
  const bounds = currentViewBounds();
  const localX = event.clientX - canvas.getBoundingClientRect().left;
  const localY = event.clientY - canvas.getBoundingClientRect().top;
  const u = clamp((localX - transform.x) / transform.side, 0, 1);
  const v = clamp((localY - transform.y) / transform.side, 0, 1);
  const oldSpan = bounds.maxX - bounds.minX;
  const worldX = bounds.minX + u * oldSpan;
  const worldY = bounds.maxY - v * oldSpan;
  state.viewZoom = clamp(nextZoom, 0, 6);
  state.viewIterationBonus = 0;
  const nextSpan = 4 / 2 ** state.viewZoom;
  state.viewCenterX = worldX - (u - 0.5) * nextSpan;
  state.viewCenterY = worldY + (v - 0.5) * nextSpan;
  updateViewUi();
  scheduleViewRebuild();
  scheduleFrame();
}

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAtPointer(event, state.viewZoom - event.deltaY * 0.0018);
}, { passive: false });

canvas.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", " ", "+", "=", "-", "0"].includes(event.key)) return;
  if (event.key === " ") {
    $("playButton").click();
  } else if (["+", "=", "-"].includes(event.key)) {
    state.viewZoom = clamp(state.viewZoom + (event.key === "-" ? -0.5 : 0.5), 0, 6);
    state.viewIterationBonus = 0;
    updateViewUi();
    scheduleViewRebuild();
    scheduleFrame();
  } else if (event.key === "0") {
    resetViewport();
  } else {
    const amount = event.key === "ArrowRight" ? 0.004 : -0.004;
    state.continuousPosition += amount;
    state.position = wrap01(state.continuousPosition);
    audioOctavePosition = null;
    if (similarityFamily) invalidateSimilarity();
    scheduleFrame();
  }
  event.preventDefault();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pool.silence();
  else {
    resetClocks();
    scheduleFrame();
  }
});
window.addEventListener("pagehide", (event) => {
  pageActive = false;
  pageLifecycleGeneration += 1;
  pendingEnableLifecycle = null;
  audioEnableRequest += 1;
  stopSimilarityAudition({ silence: false });
  if (event.persisted) {
    state.audio = false;
    audioOctavePosition = null;
    pool.disable();
    setPressed($("audioButton"), false);
    $("audioState").textContent = "off";
  } else {
    void pool.close();
  }
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  pageActive = true;
  $("audioButton").disabled = false;
  resetClocks();
  scheduleFrame();
});

setGeometryControls();
scheduleBoundaryRebuild(true);
scheduleFrame();

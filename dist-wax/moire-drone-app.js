import {
  MOIRE_DRONE_DEFAULTS,
  MOIRE_DRONE_FFT_SIZE,
  MOIRE_DRONE_PRESETS,
  MoireDroneAudio,
  SpectralFabric,
  SpectralPropagationPool,
  collideWaveFields,
  combToothAnchor,
  combToothWarpOffset,
  latticeCoordinate,
  moireFilterTarget,
  normalizedResonanceQ,
  rotateFabricCoordinate,
  sanitizeMoireDroneParams,
  spectralFftMaskGain,
  spectralWarpedCombGate,
  waveFieldValue,
  wrapUnit,
} from "./src/moire-drone.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const audio = new MoireDroneAudio(globalThis);
const canvas = $("stage");
const context2d = canvas.getContext("2d", { alpha: true, desynchronized: true });
const textureCanvas = document.createElement("canvas");
const textureContext = textureCanvas.getContext("2d", { alpha: false });
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const firstPreset = MOIRE_DRONE_PRESETS[0];
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
});

const state = {
  settings: {
    ...sanitizeMoireDroneParams({
      ...MOIRE_DRONE_DEFAULTS,
      ...firstPreset.settings,
    }),
  },
  preset: firstPreset.id,
  audioOn: false,
  quality: { tier: 0, activeFilters: MOIRE_DRONE_DEFAULTS.filterPairs * 2, load: 0 },
  shepardPhaseA: 0.117,
  shepardPhaseB: 0.117,
  fieldPhaseA: 0.213,
  fieldPhaseB: 0.213,
  fabricSpinPhase: 0,
  combPhase: 0,
};

const spectrum = new Float32Array(1_024);
spectrum.fill(-100);

let textureImage = null;
let canvasWidth = 1;
let canvasHeight = 1;
let animationFrame = 0;
let lastAnimationTime = 0;
let lastDrawTime = 0;
let audioTransition = false;
let pointerId = null;
let pointerStartX = 0;
let pointerStartY = 0;
let pointerLastY = 0;
let pointerLastTime = 0;
let pointerAnchorX = 0;
let pointerAnchorY = 0;
let pointerCurrentX = 0;
let pointerCurrentY = 0;
let pointerPullAmount = 0;
let pointerDidDrag = false;
let visualAutoAccumulator = 0.82;
let visualAutoSerial = 0;
let displayedPropagationCount = -1;
let disposed = false;

const RANGE_BINDINGS = Object.freeze([
  ["outputLevel", "outputLevel", Number],
  ["noiseColor", "noiseColor", Number],
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
  ["glideA", "glideA", Number],
  ["glideB", "glideB", Number],
  ["edgeFocus", "edgeFocus", Number],
  ["moireDetune", "moireDetune", Number],
  ["phaseOffset", "phaseOffset", Number],
  ["fieldAAngle", "fieldAAngle", Number],
  ["fieldADensity", "fieldADensity", Number],
  ["fieldASpeed", "fieldASpeed", Number],
  ["fieldACurvature", "fieldACurvature", Number],
  ["fieldADepth", "fieldADepth", Number],
  ["fieldBAngle", "fieldBAngle", Number],
  ["fieldBDensity", "fieldBDensity", Number],
  ["fieldBSpeed", "fieldBSpeed", Number],
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
  ["harmonicOrder", "harmonicOrder", Number],
  ["ringDensity", "ringDensity", Number],
  ["autoPluckRate", "autoPluckRate", Number],
  ["propagationVoices", "propagationVoices", Number],
  ["combDepth", "combDepth", Number],
  ["combTeeth", "combTeeth", Number],
  ["combWidth", "combWidth", Number],
  ["combOffset", "combOffset", Number],
  ["combDrift", "combDrift", Number],
  ["combWarp", "combWarp", Number],
  ["pluckCut", "pluckCut", Number],
  ["spectralFilterBlend", "spectralFilterBlend", Number],
  ["fftCutDepth", "fftCutDepth", Number],
  ["fftSharpness", "fftSharpness", Number],
  ["qCutDepth", "qCutDepth", Number],
  ["qCharacter", "qCharacter", Number],
  ["fabricTension", "fabricTension", Number],
  ["fabricDamping", "fabricDamping", Number],
  ["fabricInertia", "fabricInertia", Number],
  ["fabricDepth", "fabricDepth", Number],
  ["fabricExcitation", "fabricExcitation", Number],
  ["fabricVibration", "fabricVibration", Number],
  ["fabricRate", "fabricRate", Number],
  ["fabricRotation", "fabricRotation", Number],
  ["fabricSpin", "fabricSpin", Number],
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

function spectralFilterBlendLabel(value) {
  if (value <= 0.005) return "Q only";
  if (value >= 0.995) return "FFT only";
  return `${percent(value)} FFT`;
}

function signed(value, digits = 2) {
  const number = Number(value);
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}${Math.abs(number).toFixed(digits)}`;
}

function formatFrequency(value) {
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)} kHz`
    : `${Math.round(value)} Hz`;
}

function noiseColorLabel(value) {
  if (value <= -0.76) return "brown";
  if (value < -0.25) return "brown-pink";
  if (value < -0.03) return "pink-white";
  if (value <= 0.08) return "white";
  if (value < 0.65) return "white-blue";
  return "blue";
}

function collisionPolarityLabel(value) {
  if (Math.abs(value) < 0.025) return "neutral";
  return `${value > 0 ? "+" : "−"}${Math.round(Math.abs(value) * 100)}% ${value > 0 ? "brighten" : "carve"}`;
}

function formatTilt(value) {
  if (Math.abs(value) < 0.05) return "flat";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} dB/oct`;
}

function formatGlide(value) {
  return `${signed(value, Math.abs(value) < 0.1 ? 3 : 2)} oct/s`;
}

function formatCycleRate(value) {
  return `${signed(value, Math.abs(value) < 0.1 ? 3 : 2)} cyc/s`;
}

function effectiveFabricAngle() {
  return state.settings.fabricRotation + state.fabricSpinPhase * 360;
}

function propagationLabel(mode = state.settings.propagationMode) {
  return PROPAGATION_LABELS[mode] ?? "Rings";
}

function updatePropagationStatus(force = false) {
  const activeCount = visualPropagation.activeCount;
  if (!force && displayedPropagationCount === activeCount) return;
  displayedPropagationCount = activeCount;
  const settings = state.settings;
  const toothNoun = settings.combTeeth === 1 ? "tooth" : "teeth";
  const rippleNoun = settings.propagationVoices === 1 ? "ripple" : "ripples";
  $("propagationSummary").textContent = `${settings.combTeeth} ${toothNoun} · ${percent(settings.combDepth)} deep · ${activeCount}/${settings.propagationVoices} ${rippleNoun}`;
  $("clearWavesButton")?.setAttribute(
    "aria-label",
    `Clear ${activeCount} active ${activeCount === 1 ? "ripple" : "ripples"} and fabric motion`,
  );
  updateStageReadout();
}

function updateStageReadout() {
  const settings = state.settings;
  const effectiveFilters = state.quality.tier > 0
    ? state.quality.activeFilters
    : settings.filterPairs * 2;
  $("stageReadout").textContent = [
    `${settings.combTeeth} GAPS`,
    `${percent(settings.combDepth)} DEPTH`,
    `${visualPropagation.activeCount}/${settings.propagationVoices} RIPPLES`,
    `${propagationLabel(settings.propagationMode).toUpperCase()} SHAPE`,
    `${effectiveFilters}/${settings.filterPairs * 2} FILTERS`,
    settings.freeze ? "FROZEN" : "DRIFTING",
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
}

function resetVisualDynamics({ resetComb = true } = {}) {
  visualFabric.reset((state.settings.seed ^ 0xa511e9b3) >>> 0);
  visualPropagation.reset((state.settings.seed ^ 0x3c6ef372) >>> 0);
  visualPropagation.setActiveLimit(state.settings.propagationVoices);
  if (resetComb) state.combPhase = 0;
  visualAutoAccumulator = 0.82;
  visualAutoSerial = 0;
  visualCombPositions.fill(0);
  visualCombWidths.fill(0);
  visualCombWarps.fill(0);
  visualQWidths.fill(0);
  displayedPropagationCount = -1;
}

function updateVisualCombGeometry() {
  const settings = state.settings;
  const teeth = settings.combTeeth;
  const phase = wrapUnit(state.combPhase + settings.combOffset);
  const octaveSpan = Math.max(
    0.25,
    Math.log2(settings.highFrequency / settings.lowFrequency),
  );
  const fabricAngle = effectiveFabricAngle();
  for (let stage = 0; stage < teeth; stage += 1) {
    const anchor = combToothAnchor(stage, teeth);
    const fabric = visualFabric.sample(anchor.x, anchor.y, fabricAngle);
    const propagation = visualPropagation.sample(anchor.x, anchor.y);
    const warp = combToothWarpOffset({
      fabric,
      propagation,
      fabricDepth: settings.fabricDepth,
      propagationDepth: settings.propagationDepth,
      combWarp: settings.combWarp,
      octaveSpan,
      teeth,
    });
    visualCombWarps[stage] = warp;
    visualCombPositions[stage] = wrapUnit((stage - phase) / teeth + warp);
    visualCombWidths[stage] = Math.max(0.02, Math.min(
      0.48,
      settings.combWidth * (1
        + Math.abs(propagation) * settings.pluckCut * 3.5
        + Math.abs(fabric) * settings.pluckCut * 0.35),
    ));
    visualQWidths[stage] = Math.max(0.02, Math.min(
      0.48,
      visualCombWidths[stage] * 2 ** ((0.5 - settings.qCharacter) * 4),
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
  { sendAudio = true, fabricScale = 1 } = {},
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
    polarity: force < 0 ? -1 : 1,
  });
  if (sendAudio) audio.pluckFabric(x, y, force, radius);
  updatePropagationStatus(true);
}

function triggerAutomaticVisualPropagation() {
  const settings = state.settings;
  const serial = visualAutoSerial;
  visualAutoSerial += 1;
  const angle = serial * 2.399963229728653;
  const orbit = 0.18 + wrapUnit(serial * 0.6180339887498949) * 0.5;
  const x = wrapUnit((settings.originX + Math.cos(angle) * orbit) * 0.5 + 0.5) * 2 - 1;
  const y = wrapUnit((settings.originY + Math.sin(angle) * orbit) * 0.5 + 0.5) * 2 - 1;
  const strength = 0.28 + settings.propagationGain * 0.42;
  triggerPropagationAt(
    x,
    y,
    strength,
    Math.max(0.06, settings.propagationWidth * 1.35),
    { sendAudio: false, fabricScale: 0.2 },
  );
}

function updateAudioParameters() {
  state.settings = { ...audio.setParameters(state.settings) };
}

function updateInterface({ drawNow = true } = {}) {
  const settings = state.settings;
  visualPropagation.setActiveLimit(settings.propagationVoices);
  setPressed($("audioButton"), state.audioOn);
  $("audioState").textContent = state.audioOn ? "on" : "off";

  for (const [id, key] of RANGE_BINDINGS) {
    const element = $(id);
    if (element) element.value = String(settings[key]);
  }
  $("highFrequency").min = String(Math.ceil(Math.max(240, settings.lowFrequency * 1.25)));

  $("outputLevelOut").textContent = percent(settings.outputLevel);
  $("noiseColorOut").textContent = noiseColorLabel(settings.noiseColor);
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
  $("glideAOut").textContent = formatGlide(settings.glideA);
  $("glideBOut").textContent = formatGlide(settings.glideB);
  $("edgeFocusOut").textContent = settings.edgeFocus.toFixed(2);
  $("moireDetuneOut").textContent = `${settings.moireDetune >= 0 ? "+" : "−"}${Math.round(Math.abs(settings.moireDetune) * 100)}%`;
  $("phaseOffsetOut").textContent = `${settings.phaseOffset.toFixed(2)} cycle`;
  $("fieldAAngleOut").textContent = `${Math.round(settings.fieldAAngle)}°`;
  $("fieldADensityOut").textContent = settings.fieldADensity.toFixed(2);
  $("fieldASpeedOut").textContent = formatCycleRate(settings.fieldASpeed);
  $("fieldACurvatureOut").textContent = percent(settings.fieldACurvature);
  $("fieldADepthOut").textContent = `${settings.fieldADepth.toFixed(2)} oct`;
  $("fieldBAngleOut").textContent = `${settings.fieldBAngle < 0 ? "−" : ""}${Math.abs(Math.round(settings.fieldBAngle))}°`;
  $("fieldBDensityOut").textContent = settings.fieldBDensity.toFixed(2);
  $("fieldBSpeedOut").textContent = formatCycleRate(settings.fieldBSpeed);
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
  $("harmonicOrderOut").textContent = settings.harmonicOrder === 0
    ? "radial"
    : `${settings.harmonicOrder} ${settings.harmonicOrder === 1 ? "lobe" : "lobes"}`;
  $("ringDensityOut").textContent = settings.ringDensity.toFixed(2);
  $("autoPluckRateOut").textContent = settings.autoPluckRate <= 0.001
    ? "off"
    : `${settings.autoPluckRate.toFixed(2)} Hz`;
  $("propagationVoicesOut").textContent = `${settings.propagationVoices} ${settings.propagationVoices === 1 ? "ripple" : "ripples"}`;
  $("combDepthOut").textContent = percent(settings.combDepth);
  $("combTeethOut").textContent = `${settings.combTeeth} ${settings.combTeeth === 1 ? "gap" : "gaps"}`;
  $("combWidthOut").textContent = percent(settings.combWidth);
  $("combOffsetOut").textContent = percent(settings.combOffset);
  $("combDriftOut").textContent = settings.combDrift === 0
    ? "still"
    : `${signed(settings.combDrift, Math.abs(settings.combDrift) < 0.1 ? 3 : 2)} cyc/s`;
  $("combWarpOut").textContent = `${settings.combWarp.toFixed(2)}×`;
  $("pluckCutOut").textContent = percent(settings.pluckCut);
  $("spectralFilterBlendOut").textContent = spectralFilterBlendLabel(settings.spectralFilterBlend);
  $("fftCutDepthOut").textContent = percent(settings.fftCutDepth);
  $("fftSharpnessOut").textContent = `${percent(settings.fftSharpness)} sharp`;
  $("qCutDepthOut").textContent = percent(settings.qCutDepth);
  $("qCharacterOut").textContent = `${percent(settings.qCharacter)} resonant`;
  $("fabricTensionOut").textContent = percent(settings.fabricTension);
  $("fabricDampingOut").textContent = percent(settings.fabricDamping);
  $("fabricInertiaOut").textContent = percent(settings.fabricInertia);
  $("fabricDepthOut").textContent = `${settings.fabricDepth.toFixed(2)} oct`;
  $("fabricExcitationOut").textContent = percent(settings.fabricExcitation);
  $("fabricVibrationOut").textContent = percent(settings.fabricVibration);
  $("fabricRateOut").textContent = `${settings.fabricRate.toFixed(2)} Hz`;
  $("fabricRotationOut").textContent = `${settings.fabricRotation < 0 ? "−" : ""}${Math.abs(Math.round(settings.fabricRotation))}°`;
  $("fabricSpinOut").textContent = `${signed(settings.fabricSpin, Math.abs(settings.fabricSpin) < 0.1 ? 3 : 2)} rev/s`;
  $("fabricPullOut").textContent = `${Math.round(settings.fabricPull * 100)}%`;
  $("stereoWidthOut").textContent = percent(settings.stereoWidth);
  $("driveOut").textContent = percent(settings.drive);
  $("spaceOut").textContent = percent(settings.space);
  $("feedbackOut").textContent = percent(settings.feedback);

  for (const button of $("freezeChoice").querySelectorAll("[data-freeze]")) {
    setPressed(button, String(settings.freeze) === button.dataset.freeze);
  }
  for (const button of $("collisionModeChoice").querySelectorAll("[data-collision-mode]")) {
    setPressed(button, settings.collisionMode === button.dataset.collisionMode);
  }
  for (const button of $("propagationModeChoice").querySelectorAll("[data-propagation-mode]")) {
    setPressed(button, settings.propagationMode === button.dataset.propagationMode);
  }
  $("harmonicOrderControl").hidden = ![
    "harmonic", "spiral",
  ].includes(settings.propagationMode);
  for (const button of $("presetGrid").querySelectorAll("[data-preset]")) {
    setPressed(button, state.preset === button.dataset.preset);
  }

  const preset = MOIRE_DRONE_PRESETS.find(({ id }) => id === state.preset);
  $("presetSummary").textContent = preset?.label ?? "Custom";
  $("filterEngineSummary").textContent = `${spectralFilterBlendLabel(settings.spectralFilterBlend)} · ${percent(settings.qCutDepth)} Q / ${percent(settings.fftCutDepth)} FFT cut`;
  $("noiseSummary").textContent = `${noiseColorLabel(settings.noiseColor)} · ${percent(settings.noiseCorrelation)} linked · ${percent(settings.filteredMix)} filtered`;
  $("latticeSummary").textContent = `${settings.filterPairs} pairs · ${formatFrequency(settings.lowFrequency)}–${formatFrequency(settings.highFrequency)} · Q ${normalizedResonanceQ(settings.resonance).toFixed(1)}`;
  $("motionSummary").textContent = settings.freeze
    ? "frozen weave"
    : `warp ${formatGlide(settings.glideA)} · weft ${formatGlide(settings.glideB)}`;
  $("textureSummary").textContent = `warp ${settings.fieldADensity.toFixed(2)} · weft ${settings.fieldBDensity.toFixed(2)} · ${settings.collisionMode} ${percent(settings.collisionAmount)}`;
  updatePropagationStatus(true);
  $("fabricSummary").textContent = `${percent(settings.fabricTension)} tension · ${percent(settings.fabricDamping)} damping · ${settings.fabricDepth.toFixed(2)} oct`;
  $("outputSummary").textContent = `${percent(settings.stereoWidth)} wide · ${percent(settings.space)} space · ${percent(settings.feedback)} feedback`;
  $("fabricExciteButton").setAttribute(
    "aria-label",
    `Pluck a ${propagationLabel(settings.propagationMode).toLowerCase()} deformation into the shared spectral texture`,
  );
  $("clearWavesButton").setAttribute(
    "aria-label",
    `Clear ${visualPropagation.activeCount} active ${visualPropagation.activeCount === 1 ? "ripple" : "ripples"} and fabric motion`,
  );

  const effectiveFilters = state.quality.tier > 0
    ? state.quality.activeFilters
    : settings.filterPairs * 2;
  const gapsMoving = !settings.freeze && Math.abs(settings.combDrift) > 0.0005;
  $("stageCaption").textContent = state.quality.tier > 0
    ? `adaptive weave · tier ${state.quality.tier} · ${effectiveFilters} filters`
    : `${settings.combTeeth} ${gapsMoving ? "moving" : "stationary"} gaps across one coupled spectral weave`;
  canvas.setAttribute(
    "aria-label",
    `One ${settings.freeze ? "frozen" : "moving"} cyan and magenta spectral weave represents ${settings.filterPairs * 2} noise filters. ${settings.combTeeth} output gaps are ${gapsMoving ? "moving" : "stationary"} across its frequency range at ${percent(settings.combDepth)} depth, using ${spectralFilterBlendLabel(settings.spectralFilterBlend).toLowerCase()} filtering. Up to ${settings.propagationVoices} ${settings.propagationVoices === 1 ? "ripple" : "ripples"} may deform both strands at once. Tap or press Enter to pluck; drag vertically to tug the weave. Audio ${state.audioOn ? "on" : "off"}.`,
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
    ...sanitizeMoireDroneParams({ ...state.settings, [key]: value }),
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
    ...sanitizeMoireDroneParams({
      ...MOIRE_DRONE_DEFAULTS,
      ...preset.settings,
      outputLevel,
    }),
  };
  state.fabricSpinPhase = 0;
  resetVisualDynamics();
  audio.resetFabric();
  state.preset = preset.id;
  updateInterface();
  announce(`${preset.label} preset loaded.`);
}

function setAudioTransition(active) {
  audioTransition = active;
  $("audioButton").disabled = active;
  $("fabricExciteButton").disabled = active;
}

async function ensureAudioOn() {
  if (state.audioOn) return true;
  if (audioTransition) return false;
  setAudioTransition(true);
  clearAudioError();
  try {
    updateAudioParameters();
    await audio.start();
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
  }
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
  return {
    x: Math.max(-1, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1)),
    y: Math.max(-1, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height) * 2 - 1)),
    rect,
  };
}

function tugFabricFromPointer(event) {
  const point = stagePointFromEvent(event);
  const now = Number(event.timeStamp) || performance.now();
  const elapsed = Math.max(1, now - pointerLastTime) / 1_000;
  const dragPull = (pointerStartY - event.clientY) / Math.max(1, point.rect.height) * 4;
  const flickPull = (pointerLastY - event.clientY) / Math.max(1, point.rect.height) / elapsed * 0.055;
  pointerPullAmount = Math.max(-1, Math.min(1, dragPull + flickPull));
  pointerCurrentX = point.x;
  pointerCurrentY = point.y;
  pointerLastY = event.clientY;
  pointerLastTime = now;
  const local = rotateFabricCoordinate(point.x, point.y, effectiveFabricAngle());
  visualFabric.tug(local.x, local.y, pointerPullAmount);
  audio.tugFabric(point.x, point.y, pointerPullAmount);
  draw(performance.now(), true);
}

function configureTextureBuffer() {
  const activeRipples = visualPropagation.activeCount;
  const widthCap = activeRipples >= 3 ? 92 : activeRipples === 2 ? 108 : 144;
  const targetWidth = Math.max(72, Math.min(widthCap, Math.round(canvasWidth / 7)));
  const targetHeight = Math.max(52, Math.min(112, Math.round(targetWidth * canvasHeight / Math.max(1, canvasWidth))));
  if (textureCanvas.width === targetWidth && textureCanvas.height === targetHeight && textureImage) return;
  textureCanvas.width = targetWidth;
  textureCanvas.height = targetHeight;
  textureImage = textureContext.createImageData(targetWidth, targetHeight);
}

function renderSpectralTexture() {
  configureTextureBuffer();
  const settings = state.settings;
  const width = textureCanvas.width;
  const height = textureCanvas.height;
  const data = textureImage.data;
  const fieldPhaseB = wrapUnit(state.fieldPhaseB + settings.phaseOffset);
  const fabricRadians = effectiveFabricAngle() * Math.PI / 180;
  const fabricCosine = Math.cos(fabricRadians);
  const fabricSine = Math.sin(fabricRadians);
  const contourWidthA = 0.055 + Math.min(0.18, settings.fieldADepth * 0.2);
  const contourWidthB = 0.055 + Math.min(0.18, settings.fieldBDepth * 0.2);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1) * 2 - 1;
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1) * 2 - 1;
      const fabricX = wrapUnit((nx * fabricCosine - ny * fabricSine) * 0.5 + 0.5) * 2 - 1;
      const fabricY = wrapUnit((nx * fabricSine + ny * fabricCosine) * 0.5 + 0.5) * 2 - 1;
      const fabricA = visualFabric.sampleLocal(fabricX, fabricY);
      const fabricB = visualFabric.sampleLocal(-fabricX, -fabricY);
      const propagationA = visualPropagation.sample(nx, ny);
      const propagationB = visualPropagation.sample(-nx, -ny);
      const fieldA = waveFieldValue(
        nx, ny, state.fieldPhaseA, settings.fieldAAngle,
        settings.fieldADensity, settings.fieldACurvature,
        settings.originX, settings.originY,
      );
      const fieldB = waveFieldValue(
        nx, ny, fieldPhaseB, settings.fieldBAngle,
        settings.fieldBDensity * (1 + settings.moireDetune * 0.08),
        settings.fieldBCurvature, -settings.originX, -settings.originY,
      );
      const collision = collideWaveFields(fieldA, fieldB, settings.collisionMode);
      const surfaceA = fieldA * settings.fieldADepth
        + fabricA * settings.fabricDepth
        + propagationA * settings.propagationDepth;
      const surfaceB = fieldB * settings.fieldBDepth
        + fabricB * settings.fabricDepth
        + propagationB * settings.propagationDepth;
      const visibilityA = Math.min(1,
        settings.fieldADepth * 3
          + Math.abs(fabricA) * settings.fabricDepth * 2
          + Math.abs(propagationA) * settings.propagationDepth * 2,
      );
      const visibilityB = Math.min(1,
        settings.fieldBDepth * 3
          + Math.abs(fabricB) * settings.fabricDepth * 2
          + Math.abs(propagationB) * settings.propagationDepth * 2,
      );
      const normalizedA = Math.max(-1, Math.min(1, surfaceA / contourWidthA));
      const normalizedB = Math.max(-1, Math.min(1, surfaceB / contourWidthB));
      const ridgeA = (1 - Math.abs(normalizedA)) ** 3 * visibilityA;
      const ridgeB = (1 - Math.abs(normalizedB)) ** 3 * visibilityB;
      const sharedRidge = Math.min(ridgeA, ridgeB);
      const crossing = (
        Math.abs(collision) ** 2.4 * settings.collisionAmount * 0.72
        + sharedRidge * (0.08 + settings.collisionAmount * 0.5)
      );
      const fillA = Math.max(0, normalizedA) * 0.1 * visibilityA;
      const fillB = Math.max(0, normalizedB) * 0.1 * visibilityB;
      const rippleEnergy = Math.min(1, (
        Math.abs(propagationA) + Math.abs(propagationB)
      ) * 0.5);
      const fabricEnergy = Math.min(1, (
        Math.abs(fabricA) + Math.abs(fabricB)
      ) * settings.fabricDepth * 0.7);
      const rippleInfluence = Math.min(
        1,
        Math.max(settings.propagationDepth / 2, settings.propagationGain),
      );
      const textureLight = rippleEnergy * rippleInfluence * 42 + fabricEnergy * 24;
      const vignette = Math.max(0.2, 1 - Math.hypot(nx, ny) * 0.38);
      data[offset] = Math.min(255, (
        5 + ridgeA * 20 + ridgeB * 154 + crossing * 156 + fillB * 52 + textureLight * 0.42
      ) * vignette);
      data[offset + 1] = Math.min(255, (
        8 + ridgeA * 166 + ridgeB * 34 + crossing * 148 + textureLight * 0.72
      ) * vignette);
      data[offset + 2] = Math.min(255, (
        13 + ridgeA * 158 + ridgeB * 104 + crossing * 178 + fillA * 44 + textureLight
      ) * vignette);
      data[offset + 3] = 255;
      offset += 4;
    }
  }
  textureContext.putImageData(textureImage, 0, 0);
}

function drawGrid() {
  context2d.save();
  context2d.lineWidth = 1;
  for (let index = 2; index < 8; index += 2) {
    const x = index / 8 * canvasWidth;
    const y = index / 8 * canvasHeight;
    context2d.beginPath();
    context2d.moveTo(x, 0);
    context2d.lineTo(x, canvasHeight);
    context2d.moveTo(0, y);
    context2d.lineTo(canvasWidth, y);
    context2d.strokeStyle = index === 4
      ? "rgba(255,255,255,0.065)"
      : "rgba(255,255,255,0.025)";
    context2d.stroke();
  }
  context2d.restore();
}

function drawFilterNodes() {
  const settings = state.settings;
  const phaseA = state.shepardPhaseA;
  const phaseB = wrapUnit(state.shepardPhaseB + settings.phaseOffset);
  const fieldPhaseA = state.fieldPhaseA;
  const fieldPhaseB = wrapUnit(state.fieldPhaseB + settings.phaseOffset);
  const fabricAngle = effectiveFabricAngle();
  const strandAngleA = (settings.fieldAAngle + 90) * Math.PI / 180;
  const strandAngleB = (settings.fieldBAngle + 90) * Math.PI / 180;
  context2d.save();
  context2d.lineCap = "round";
  for (let index = 0; index < settings.filterPairs; index += 1) {
    const coordinate = latticeCoordinate(index, settings.filterPairs);
    const fabricA = visualFabric.sample(coordinate.x, coordinate.y, fabricAngle);
    const fabricB = visualFabric.sample(-coordinate.x, -coordinate.y, fabricAngle);
    const fabricVelocityA = visualFabric.sampleVelocity(coordinate.x, coordinate.y, fabricAngle);
    const fabricVelocityB = visualFabric.sampleVelocity(-coordinate.x, -coordinate.y, fabricAngle);
    const propagationA = visualPropagation.sample(coordinate.x, coordinate.y);
    const propagationB = visualPropagation.sample(-coordinate.x, -coordinate.y);
    const x = (coordinate.x * 0.46 + 0.5) * canvasWidth
      + (fabricVelocityA - fabricVelocityB) * Math.min(8, canvasWidth * 0.008)
      + (propagationA - propagationB) * Math.min(12, canvasWidth * 0.012) * settings.propagationDepth;
    const y = (coordinate.y * 0.43 + 0.5) * canvasHeight
      - (fabricA + fabricB) * 0.5 * Math.min(34, canvasHeight * 0.07) * settings.fabricDepth
      - (propagationA + propagationB) * 0.5 * Math.min(46, canvasHeight * 0.09) * settings.propagationDepth;
    const targetOptions = {
      index, phaseA, phaseB, fieldPhaseA, fieldPhaseB,
      fabricA, fabricB, propagationA, propagationB,
      fabricVelocityA, fabricVelocityB, combPhase: state.combPhase,
      combToothPositions: visualCombPositions,
      combToothWidths: visualCombWidths,
      parameters: settings,
    };
    const targetA = moireFilterTarget({ ...targetOptions, bank: 0 });
    const targetB = moireFilterTarget({ ...targetOptions, bank: 1 });
    const collision = Math.abs(targetA.collision);
    const gateA = targetA.combGain ?? 1;
    const gateB = targetB.combGain ?? 1;
    const halfLength = 2.4 + Math.min(
      3.8,
      Math.sqrt(Math.max(targetA.gain, targetB.gain)) * 2.2,
    );
    const lineWidth = 0.7 + Math.min(0.75, halfLength * 0.08);
    context2d.beginPath();
    context2d.moveTo(
      x - Math.cos(strandAngleA) * halfLength,
      y - Math.sin(strandAngleA) * halfLength,
    );
    context2d.lineTo(
      x + Math.cos(strandAngleA) * halfLength,
      y + Math.sin(strandAngleA) * halfLength,
    );
    context2d.strokeStyle = `rgba(85, 231, 225, ${gateA * 0.62})`;
    context2d.lineWidth = lineWidth;
    context2d.stroke();

    context2d.beginPath();
    context2d.moveTo(
      x - Math.cos(strandAngleB) * halfLength,
      y - Math.sin(strandAngleB) * halfLength,
    );
    context2d.lineTo(
      x + Math.cos(strandAngleB) * halfLength,
      y + Math.sin(strandAngleB) * halfLength,
    );
    context2d.strokeStyle = `rgba(255, 111, 148, ${gateB * 0.62})`;
    context2d.stroke();

    const interaction = collision * Math.sqrt(gateA * gateB);
    if (interaction > 0.04) {
      context2d.beginPath();
      context2d.arc(x, y, 0.7 + interaction * 1.5, 0, TAU);
      context2d.fillStyle = `rgba(245, 213, 255, ${interaction * 0.7})`;
      context2d.fill();
    }
  }
  context2d.restore();
}

function drawEmbeddedCombGaps() {
  const settings = state.settings;
  if (settings.combDepth <= 0.001) return;
  const fabricAngle = effectiveFabricAngle();
  context2d.save();
  context2d.globalCompositeOperation = "source-over";
  for (let stage = 0; stage < settings.combTeeth; stage += 1) {
    const anchor = combToothAnchor(stage, settings.combTeeth);
    const fabric = visualFabric.sample(anchor.x, anchor.y, fabricAngle);
    const propagation = visualPropagation.sample(anchor.x, anchor.y);
    const deformation = (
      fabric * settings.fabricDepth
      + propagation * settings.propagationDepth
    );
    const activity = Math.min(1, (
      Math.abs(propagation) * settings.pluckCut
      + Math.abs(fabric) * 0.35
    ));
    const x = (anchor.x * 0.45 + 0.5) * canvasWidth
      + visualCombWarps[stage] * canvasWidth * 1.65;
    const y = (anchor.y * 0.42 + 0.5) * canvasHeight
      - deformation * canvasHeight * 0.045;
    const radiusX = Math.min(30, 5
      + settings.combWidth * 27
      + Math.abs(visualCombWarps[stage]) * canvasWidth * 0.42
      + activity * 7);
    const radiusY = Math.min(18, 3.5
      + settings.combWidth * 13
      + activity * 5);
    const opacity = settings.combDepth * (0.62 + activity * 0.28);
    const angle = (fabricAngle * 0.35 + stage * 31) * Math.PI / 180;
    context2d.save();
    context2d.translate(x, y);
    context2d.rotate(angle);
    context2d.scale(radiusX, radiusY);
    const cut = context2d.createRadialGradient(0, 0, 0, 0, 0, 1);
    cut.addColorStop(0, `rgba(0, 2, 7, ${Math.min(0.96, opacity)})`);
    cut.addColorStop(0.52, `rgba(1, 4, 11, ${opacity * 0.84})`);
    cut.addColorStop(1, "rgba(1, 4, 11, 0)");
    context2d.fillStyle = cut;
    context2d.beginPath();
    context2d.arc(0, 0, 1, 0, TAU);
    context2d.fill();
    context2d.restore();

    context2d.beginPath();
    context2d.ellipse(x, y, radiusX * 0.62, radiusY * 0.62, angle, 0, TAU);
    context2d.strokeStyle = stage % 2
      ? `rgba(255, 111, 148, ${0.1 + activity * 0.18})`
      : `rgba(85, 231, 225, ${0.1 + activity * 0.18})`;
    context2d.lineWidth = 0.7;
    context2d.stroke();
  }
  context2d.restore();
}

function drawSpectralCombMask() {
  const settings = state.settings;
  if (settings.combDepth <= 0.001) return;
  const slices = Math.max(128, Math.min(420, Math.round(canvasWidth / 2)));
  const sliceWidth = canvasWidth / slices;
  const responseY = Math.max(70, canvasHeight - Math.max(82, canvasHeight * 0.17));
  const responseHeight = Math.min(13, canvasHeight * 0.035);
  const stripTop = responseY - 4;
  const stripHeight = responseHeight + 9;
  const fftBinWidth = (audio.context?.sampleRate ?? 48_000) / MOIRE_DRONE_FFT_SIZE;

  const responseAt = (position) => {
    const qGate = spectralWarpedCombGate({
      spectralPosition: position,
      toothPositions: visualCombPositions,
      toothWidths: visualQWidths,
      teeth: settings.combTeeth,
      width: settings.combWidth,
      depth: settings.combDepth * settings.qCutDepth,
    });
    const frequency = settings.lowFrequency
      * (settings.highFrequency / settings.lowFrequency) ** position;
    const fftBinFrequency = Math.max(
      fftBinWidth,
      Math.round(frequency / fftBinWidth) * fftBinWidth,
    );
    const fftGate = spectralFftMaskGain({
      frequency: fftBinFrequency,
      binWidth: fftBinWidth,
      lowFrequency: settings.lowFrequency,
      highFrequency: settings.highFrequency,
      toothPositions: visualCombPositions,
      toothWidths: visualCombWidths,
      teeth: settings.combTeeth,
      depth: settings.combDepth * settings.fftCutDepth,
      sharpness: settings.fftSharpness,
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
    const gate = qGate + (fftGate - qGate) * settings.spectralFilterBlend;
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
      ? `rgba(85, 231, 225, ${0.2 + engineAmount * 0.65})`
      : `rgba(255, 111, 148, ${0.2 + engineAmount * 0.65})`;
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
  context2d.translate(x, y);
  context2d.strokeStyle = "rgba(245, 213, 255, 0.28)";
  context2d.lineWidth = 0.75;
  context2d.beginPath();
  context2d.arc(0, 0, 5, 0, Math.PI * 2);
  context2d.moveTo(-8, 0);
  context2d.lineTo(8, 0);
  context2d.moveTo(0, -8);
  context2d.lineTo(0, 8);
  context2d.stroke();
  if (pointerId !== null) {
    const pointerX = (pointerCurrentX + 1) * 0.5 * canvasWidth - x;
    const pointerY = (pointerCurrentY + 1) * 0.5 * canvasHeight - y;
    context2d.beginPath();
    context2d.moveTo(pointerX, pointerY);
    context2d.lineTo(0, 0);
    context2d.strokeStyle = "rgba(245, 213, 255, 0.5)";
    context2d.setLineDash([3, 4]);
    context2d.stroke();
    context2d.setLineDash([]);
    context2d.beginPath();
    context2d.arc(pointerX, pointerY, 8 + Math.abs(pointerPullAmount) * 16, 0, Math.PI * 2);
    context2d.strokeStyle = pointerPullAmount >= 0
      ? "rgba(85, 231, 225, 0.72)"
      : "rgba(255, 111, 148, 0.72)";
    context2d.stroke();
  }
  context2d.restore();
}

function draw(timestamp, force = false) {
  if (!context2d || disposed || (document.hidden && !force)) return;
  const frameInterval = reducedMotion
    ? (visualPropagation.activeCount > 0 ? 1_000 / 15 : 250)
    : 1_000 / 30;
  if (!force && timestamp - lastDrawTime < frameInterval) return;
  lastDrawTime = timestamp;
  updateVisualCombGeometry();
  renderSpectralTexture();
  context2d.clearRect(0, 0, canvasWidth, canvasHeight);
  context2d.save();
  context2d.globalAlpha = 0.64;
  context2d.imageSmoothingEnabled = true;
  context2d.drawImage(textureCanvas, 0, 0, canvasWidth, canvasHeight);
  context2d.restore();
  drawGrid();
  drawEmbeddedCombGaps();
  drawFilterNodes();
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
  textureImage = null;
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
  if (!settings.freeze && settings.autoPluckRate > 0.001) {
    visualAutoAccumulator += settings.autoPluckRate * elapsed;
    let launches = 0;
    while (visualAutoAccumulator >= 1 && launches < 3) {
      visualAutoAccumulator -= 1;
      launches += 1;
      triggerAutomaticVisualPropagation();
    }
    if (launches >= 3) visualAutoAccumulator %= 1;
  }
  if (!reducedMotion && !settings.freeze) {
    const octaveSpan = Math.log2(settings.highFrequency / settings.lowFrequency);
    state.shepardPhaseA = wrapUnit(state.shepardPhaseA + settings.glideA / octaveSpan * elapsed);
    state.shepardPhaseB = wrapUnit(state.shepardPhaseB + settings.glideB / octaveSpan * elapsed);
    state.fieldPhaseA = wrapUnit(state.fieldPhaseA + settings.fieldASpeed * elapsed);
    state.fieldPhaseB = wrapUnit(state.fieldPhaseB + settings.fieldBSpeed * elapsed);
    state.fabricSpinPhase = wrapUnit(state.fabricSpinPhase + settings.fabricSpin * elapsed);
    state.combPhase = wrapUnit(state.combPhase + settings.combDrift * elapsed);
  }
  if (
    (!reducedMotion && !settings.freeze)
    || pointerDidDrag
    || visualPropagation.activeCount > 0
  ) {
    visualFabric.step(elapsed, settings, settings.freeze);
  }
  updatePropagationStatus();
  draw(timestamp);
  animationFrame = requestAnimationFrame(animate);
}

for (const [id, key, transform] of RANGE_BINDINGS) {
  $(id).addEventListener("input", (event) => {
    setParameter(key, transform(event.currentTarget.value));
  });
}

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
  announce(`${propagationLabel()} ripple plucked into the spectral weave.`);
});

$("clearWavesButton").addEventListener("click", () => {
  resetVisualDynamics({ resetComb: false });
  audio.resetFabric({ resetComb: false });
  updatePropagationStatus(true);
  draw(performance.now(), true);
  announce("Ripples and fabric motion cleared.");
});

for (const button of $("freezeChoice").querySelectorAll("[data-freeze]")) {
  button.addEventListener("click", () => {
    setParameter("freeze", button.dataset.freeze === "true");
    announce(`Spectral weave motion ${state.settings.freeze ? "frozen" : "resumed"}.`);
  });
}

for (const button of $("collisionModeChoice").querySelectorAll("[data-collision-mode]")) {
  button.addEventListener("click", () => {
    setParameter("collisionMode", button.dataset.collisionMode);
    announce(`${button.textContent.trim()} collision selected.`);
  });
}

for (const button of $("propagationModeChoice").querySelectorAll("[data-propagation-mode]")) {
  button.addEventListener("click", () => {
    setParameter("propagationMode", button.dataset.propagationMode);
    announce(`${button.textContent.trim()} ripple shape selected.`);
  });
}

$("stage").addEventListener("pointerdown", (event) => {
  if (
    pointerId !== null
    || event.isPrimary === false
    || (event.pointerType !== "touch" && event.button !== 0)
  ) return;
  const point = stagePointFromEvent(event);
  pointerId = event.pointerId;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  pointerLastY = event.clientY;
  pointerLastTime = Number(event.timeStamp) || performance.now();
  pointerAnchorX = point.x;
  pointerAnchorY = point.y;
  pointerCurrentX = point.x;
  pointerCurrentY = point.y;
  pointerPullAmount = 0;
  pointerDidDrag = false;
  canvas.setPointerCapture?.(event.pointerId);
  draw(performance.now(), true);
});

$("stage").addEventListener("pointermove", (event) => {
  if (pointerId !== event.pointerId) return;
  const point = stagePointFromEvent(event);
  pointerCurrentX = point.x;
  pointerCurrentY = point.y;
  const dragThreshold = event.pointerType === "touch" ? 10 : 5;
  if (!pointerDidDrag) {
    const distance = Math.hypot(
      event.clientX - pointerStartX,
      event.clientY - pointerStartY,
    );
    if (distance < dragThreshold) {
      draw(performance.now(), true);
      return;
    }
    pointerDidDrag = true;
    canvas.classList.add("is-tugging");
  }
  tugFabricFromPointer(event);
});

async function releasePointer(event, { cancelled = false } = {}) {
  if (pointerId === null || (event?.pointerId != null && event.pointerId !== pointerId)) return;
  const releasedId = pointerId;
  const wasDrag = pointerDidDrag;
  const releaseX = pointerCurrentX;
  const releaseY = pointerCurrentY;
  const releasePull = pointerPullAmount;
  pointerId = null;
  pointerDidDrag = false;
  canvas.classList.remove("is-tugging");
  visualFabric.release();
  audio.releaseFabric();
  canvas.releasePointerCapture?.(releasedId);
  pointerPullAmount = 0;
  draw(performance.now(), true);
  if (cancelled) return;
  if (wasDrag) {
    announce(`Fabric tug released at ${signed(releaseX, 2)}, ${signed(releaseY, 2)} with ${signed(releasePull, 2)} pull.`);
    return;
  }
  if (!await ensureAudioOn()) return;
  triggerPropagationAt(
    pointerAnchorX,
    pointerAnchorY,
    Math.min(1.35, 0.38 + state.settings.fabricPull * 0.42),
    0.16 + state.settings.fabricInertia * 0.1,
  );
  draw(performance.now(), true);
  announce(`${propagationLabel()} ripple plucked at ${signed(pointerAnchorX, 2)}, ${signed(pointerAnchorY, 2)}.`);
}

$("stage").addEventListener("pointerup", releasePointer);
$("stage").addEventListener("pointercancel", (event) => releasePointer(event, { cancelled: true }));
$("stage").addEventListener("lostpointercapture", (event) => releasePointer(event, { cancelled: true }));

$("stage").addEventListener("keydown", async (event) => {
  if (event.key === " ") {
    event.preventDefault();
    setParameter("freeze", !state.settings.freeze);
    announce(`Spectral weave motion ${state.settings.freeze ? "frozen" : "resumed"}.`);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (!await ensureAudioOn()) return;
    triggerPropagationAt(
      state.settings.originX,
      state.settings.originY,
      Math.min(1.6, 0.5 + state.settings.fabricPull * 0.55),
      0.2 + state.settings.fabricInertia * 0.12,
    );
    draw(performance.now(), true);
    announce(`${propagationLabel()} ripple plucked into the spectral weave.`);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const amount = event.shiftKey ? 0.1 : 0.01;
    setParameter("glideA", state.settings.glideA + (event.key === "ArrowRight" ? amount : -amount));
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const amount = event.shiftKey ? 0.1 : 0.01;
    setParameter("glideB", state.settings.glideB + (event.key === "ArrowUp" ? amount : -amount));
  }
});

document.querySelector("[data-reset-all]").addEventListener("click", () => {
  const outputLevel = state.settings.outputLevel;
  state.settings = { ...sanitizeMoireDroneParams({ ...MOIRE_DRONE_DEFAULTS, outputLevel }) };
  state.fabricSpinPhase = 0;
  resetVisualDynamics();
  audio.resetFabric();
  state.preset = null;
  updateInterface();
  announce("All Moiré Drone parameters reset.");
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
    releasePointer();
  }
});

globalThis.addEventListener("blur", () => releasePointer());

globalThis.addEventListener("pagehide", () => {
  disposed = true;
  releasePointer();
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  audio.close();
}, { once: true });

renderPresets();
updateInterface({ drawNow: false });
resizeCanvas();
animationFrame = requestAnimationFrame(animate);

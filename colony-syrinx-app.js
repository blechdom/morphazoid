import {
  COLONY_SYRINX_CONTOUR_IDS,
  COLONY_SYRINX_CONTOUR_POINT_COUNT,
  COLONY_SYRINX_CONTOUR_SHAPES,
  COLONY_SYRINX_LANE_COUNT,
  COLONY_SYRINX_LUNG_COUNT,
  COLONY_SYRINX_MAX_PRESSURE,
  COLONY_SYRINX_MOUTH_COUNT,
  COLONY_SYRINX_PHONATOR_COUNT,
  COLONY_SYRINX_ROUTE_COUNT,
  COLONY_SYRINX_TOPOLOGY,
  colonySyrinxRouteFromMidiNote,
  createColonySyrinxState,
  randomizeColonySyrinxState,
  sampleColonySyrinxContour,
  sanitizeColonySyrinxState,
} from "./src/colony-syrinx.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum))
);
const percent = (value) => `${Math.round(clamp(value) * 100)}%`;
const wrapUnit = (value) => ((Number(value) % 1) + 1) % 1;
const MIDI_BASE_NOTE = 48;
const KEY_ROUTES = Object.freeze({
  "1": 0,
  "2": 1,
  "3": 2,
  q: 3,
  w: 4,
  e: 5,
  a: 6,
  s: 7,
  d: 8,
  z: 9,
  x: 10,
  c: 11,
});
const SOURCE_DISPLAY_FREQUENCIES = Object.freeze([62, 326, 180, 1_284]);
const CONTOUR_META = Object.freeze([
  { id: "breath", label: "Breath body", detail: "shared reservoir pressure", color: "#c9f36a" },
  { id: "tension", label: "Fold tension", detail: "eight membranes pull together", color: "#ff63b9" },
  { id: "routing", label: "Route morph", detail: "primary ⇄ alternate plumbing", color: "#64dfd2" },
  { id: "maw", label: "Maw opening", detail: "subharmonic jaw and lips", color: "#ff8f4c" },
  { id: "speech", label: "Speech opening", detail: "tongue and vowel aperture", color: "#64dfd2" },
  { id: "click", label: "Click opening", detail: "needle mouth and ratchet", color: "#f3df5c" },
]);
const CONTOUR_RATE_OPTIONS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
const SVG_NS = "http://www.w3.org/2000/svg";

const lungButtons = Array.from(document.querySelectorAll("[data-lung]"));
const sourceCards = Array.from(document.querySelectorAll(".source-card[data-source]"));
const routeButtons = Array.from(document.querySelectorAll(".route-valve[data-source][data-mouth]"));
const mouthCards = Array.from(document.querySelectorAll(".mouth-card[data-mouth]"));
let laneElements = [];
const lungVessels = Array.from(
  { length: COLONY_SYRINX_LUNG_COUNT },
  (_, index) => document.querySelector(`[data-vessel-lung="${index + 1}"]`),
);
const sourceVessels = Array.from(
  { length: COLONY_SYRINX_PHONATOR_COUNT },
  (_, index) => document.querySelector(`[data-vessel-source="${index + 1}"]`),
);
const routeVessels = COLONY_SYRINX_TOPOLOGY.routes.map(({ phonatorIndex, mouthIndex }) => (
  document.querySelector(`[data-vessel-route="${phonatorIndex + 1}-${mouthIndex + 1}"]`)
));
const mouthVessels = Array.from(
  { length: COLONY_SYRINX_MOUTH_COUNT },
  (_, index) => document.querySelector(`[data-vessel-mouth="${index + 1}"]`),
);
const lungGardenMembranes = Array.from(document.querySelectorAll(".lung-garden-membranes use"));

let audioContext = null;
let graph = null;
let audioStarting = false;
let transportPlaying = false;
let breathActive = false;
let sustainActive = false;
let breathPointerHeld = false;
let breathKeyHeld = false;
let animationFrame = 0;
let midiLearnArmed = false;
let midiLearnNotes = [];
let midiBaseNote = MIDI_BASE_NOTE;
let telemetry = {
  reservoirs: Array(4).fill(0),
  lungs: Array(COLONY_SYRINX_LUNG_COUNT).fill(0),
  folds: Array(8).fill(0),
  routes: Array(COLONY_SYRINX_ROUTE_COUNT).fill(0),
  routeApertures: Array(COLONY_SYRINX_ROUTE_COUNT).fill(0),
  mouths: Array(COLONY_SYRINX_MOUTH_COUNT).fill(0),
  mouthPressures: Array(COLONY_SYRINX_MOUTH_COUNT).fill(0),
  exhales: Array(4).fill(0),
  contourPhase: 0,
  contourValues: Array(COLONY_SYRINX_LANE_COUNT).fill(0),
  lanePhases: Array(COLONY_SYRINX_LANE_COUNT).fill(0),
  sourceFrequenciesHz: Array(4).fill(0),
  sourceModels: ["collision-roar", "split-syrinx", "pulse-membrane", "needle-syrinx"],
  limiterGain: 1,
  limitedShare: 0,
  flow: 0,
  load: 0,
  peak: 0,
  rms: 0,
  mediumId: "air",
};

const initialRoutes = Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, (_, sourceIndex) => (
  Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (__, mouthIndex) => {
    const button = routeButtons.find((candidate) => (
      Number(candidate.dataset.source) === sourceIndex + 1
      && Number(candidate.dataset.mouth) === mouthIndex + 1
    ));
    return button?.getAttribute("aria-pressed") === "true" ? 1 : 0;
  })
));
let state = createColonySyrinxState({ routes: initialRoutes });
let anatomyShapeSeed = state.seed;
const heldRoutes = new Map();
const deferredRouteReleases = new Set();
const keyOwners = new Set();
let contourPostFrame = 0;

function routeValue(matrix, routeIndex) {
  const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
  return clamp(matrix?.[route.phonatorIndex]?.[route.mouthIndex] ?? 0);
}

function setRouteValue(matrix, routeIndex, value) {
  const route = COLONY_SYRINX_TOPOLOGY.routes[routeIndex];
  matrix[route.phonatorIndex][route.mouthIndex] = clamp(value);
}

function copyRouteMatrix(matrix) {
  return Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, (_, sourceIndex) => (
    Array.from({ length: COLONY_SYRINX_MOUTH_COUNT }, (__, mouthIndex) => (
      clamp(matrix?.[sourceIndex]?.[mouthIndex] ?? 0)
    ))
  ));
}

function routeMatrix(kind = "primary") {
  const base = kind === "alternate" ? state.alternateRoutes : state.routes;
  const result = Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, () => (
    Array(COLONY_SYRINX_MOUTH_COUNT).fill(0)
  ));
  for (let index = 0; index < COLONY_SYRINX_ROUTE_COUNT; index += 1) {
    const { phonatorIndex, mouthIndex } = COLONY_SYRINX_TOPOLOGY.routes[index];
    const held = heldRoutes.get(index) ?? 0;
    result[phonatorIndex][mouthIndex] = state.phonatorEnabled[phonatorIndex]
      && state.mouthEnabled[mouthIndex]
      ? Math.max(clamp(base?.[phonatorIndex]?.[mouthIndex] ?? 0), held)
      : 0;
  }
  return result;
}

function stateFromControls() {
  return sanitizeColonySyrinxState({
    ...state,
    sequencerEnabled: transportPlaying,
    midiBaseNote,
    routes: routeMatrix("primary"),
    alternateRoutes: routeMatrix("alternate"),
  }, state);
}

function announce(message) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function updateRangeFill(input) {
  if (!input) return;
  const minimum = Number(input.min) || 0;
  const maximum = Number(input.max) || 1;
  const amount = clamp((Number(input.value) - minimum) / Math.max(1e-9, maximum - minimum));
  input.style.setProperty("--range-progress", `${(amount * 100).toFixed(2)}%`);
}

function setRangeControl(id, value, formatter) {
  const input = $(id);
  if (!input) return;
  input.value = String(value);
  updateRangeFill(input);
  const output = $(`${id}Out`);
  if (output && formatter) output.textContent = formatter(Number(input.value));
}

function hash32(value) {
  let result = Number(value) >>> 0;
  result = Math.imul(result ^ (result >>> 16), 0x7feb352d);
  result = Math.imul(result ^ (result >>> 15), 0x846ca68b);
  return (result ^ (result >>> 16)) >>> 0;
}

function seededUnitFrom(seed, index, salt = 0) {
  return hash32((seed ^ Math.imul(index + 1, 0x9e3779b9) ^ salt) >>> 0) / 0x1_0000_0000;
}

function seededUnit(index, salt = 0) {
  return seededUnitFrom(state.seed, index, salt);
}

function anatomySeededUnit(index, salt = 0) {
  return seededUnitFrom(anatomyShapeSeed, index, salt);
}

function rankedMask(length, count, salt) {
  const wanted = Math.round(clamp(count, 0, length));
  const ranking = Array.from({ length }, (_, index) => index).sort((left, right) => (
    seededUnit(left, salt) - seededUnit(right, salt)
  ));
  const selected = new Set(ranking.slice(0, wanted));
  return Array.from({ length }, (_, index) => selected.has(index));
}

function lungMaskForPhonators(requestedCount, phonatorMask = state.phonatorEnabled) {
  const activeBanks = phonatorMask
    .map((enabled, index) => enabled ? index : -1)
    .filter((index) => index >= 0);
  const result = Array(COLONY_SYRINX_LUNG_COUNT).fill(false);
  if (!activeBanks.length) return result;
  const target = Math.round(clamp(
    requestedCount,
    activeBanks.length,
    activeBanks.length * 4,
  ));
  const remaining = [];
  for (const bankIndex of activeBanks) {
    const bankLungs = Array.from({ length: 4 }, (_, offset) => bankIndex * 4 + offset)
      .sort((left, right) => seededUnit(left, 0x10a7) - seededUnit(right, 0x10a7));
    result[bankLungs[0]] = true;
    remaining.push(...bankLungs.slice(1));
  }
  remaining.sort((left, right) => seededUnit(left, 0x7b19) - seededUnit(right, 0x7b19));
  for (let index = 0; index < target - activeBanks.length; index += 1) {
    result[remaining[index]] = true;
  }
  return result;
}

function activeRouteIndices({ union = true } = {}) {
  return COLONY_SYRINX_TOPOLOGY.routes
    .filter(({ phonatorIndex, mouthIndex }) => (
      state.phonatorEnabled[phonatorIndex]
      && state.mouthEnabled[mouthIndex]
    ))
    .filter(({ index }) => (
      union
        ? Math.max(routeValue(state.routes, index), routeValue(state.alternateRoutes, index)) > 0.02
        : routeValue(state.routes, index) > 0.02
    ))
    .map(({ index }) => index);
}

function updateCountPresentation(openPathCount = null) {
  const lungs = state.lungEnabled.filter(Boolean).length;
  const throats = state.phonatorEnabled.filter(Boolean).length;
  const mouths = state.mouthEnabled.filter(Boolean).length;
  const livingRoutes = activeRouteIndices().length;
  const possibleRoutes = Math.max(1, throats * mouths);
  const openPaths = openPathCount == null ? 0 : openPathCount;
  const values = {
    activeLungCount: String(lungs).padStart(2, "0"),
    activeFoldCount: String(throats * 2).padStart(2, "0"),
    activeRouteCount: String(livingRoutes).padStart(2, "0"),
    activeMouthCount: String(mouths).padStart(2, "0"),
    lungBankTitle: `${lungs} living lungs`,
    foldCountReadout: `${throats * 2} folds`,
    sourceRackTitle: `${throats} incompatible pair${throats === 1 ? "" : "s"}`,
    routeMatrixTitle: `${throats} × ${mouths} living manifold`,
    routeCountReadout: `${openPaths} / ${livingRoutes} flowing`,
    mouthCountReadout: `${mouths} continuous exit${mouths === 1 ? "" : "s"}`,
    mouthRackTitle: `${mouths} mouth${mouths === 1 ? "" : "s"}`,
    bodyFoldCount: `${throats * 2} FOLDS / ${throats} PAIRS`,
    bodyRouteCount: `${openPaths} FLOWING / ${livingRoutes} LIVING`,
    activePathReadout: `${String(openPaths).padStart(2, "0")} / ${String(livingRoutes).padStart(2, "0")}`,
  };
  for (const [id, value] of Object.entries(values)) {
    if ($(id)) $(id).textContent = value;
  }
  if ($("connectionDensityOut")) {
    $("connectionDensityOut").textContent = `${Math.round(activeRouteIndices({ union: false }).length / possibleRoutes * 100)}%`;
  }
}

function applyOrganicShapes() {
  lungButtons.forEach((button, index) => {
    button.style.setProperty("--lung-width", `${24 + anatomySeededUnit(index, 0x17a9) * 10}px`);
    button.style.setProperty("--lung-height", `${27 + anatomySeededUnit(index, 0x4c31) * 13}px`);
    button.style.setProperty("--lung-rotation", `${-11 + anatomySeededUnit(index, 0x8e5d) * 22}deg`);
    const a = 38 + Math.round(anatomySeededUnit(index, 0xb329) * 30);
    const b = 100 - a;
    button.style.setProperty("--lung-radius", `${a}% ${b}% ${b}% ${a}% / ${b}% ${a}% ${b}% ${a}%`);
  });
  mouthCards.forEach((card, index) => {
    const mouth = state.mouths[index];
    card.style.setProperty("--mouth-index", String(index));
    card.style.setProperty("--mouth-jaw-scale", String(0.72 + mouth.lipSize * 0.62));
    card.style.setProperty("--mouth-tongue-reach", `${8 + mouth.tongueSize * 42}%`);
    card.style.setProperty("--mouth-rotation", `${-3 + anatomySeededUnit(index, 0xd1f3) * 6}deg`);
    card.style.setProperty(
      "--mouth-tongue-radius",
      `${28 + Math.round(mouth.tonguePosition * 44)}% ${72 - Math.round(mouth.tonguePosition * 34)}% 0 0`,
    );
  });
}

function applyAnatomyPresentation() {
  lungButtons.forEach((button, index) => {
    const present = Boolean(state.lungEnabled[index]);
    button.classList.toggle("is-absent", !present);
    button.classList.toggle("is-disabled", !present);
    button.setAttribute("aria-pressed", String(present));
    button.setAttribute("aria-label", `Lung ${index + 1} ${present ? "enabled" : "absent"}`);
    button.disabled = false;
    lungVessels[index]?.classList.toggle("is-absent", !present);
    lungVessels[index]?.classList.toggle("is-enabled", present);
    lungVessels[index]?.classList.toggle("is-disabled", !present);
  });
  sourceCards.forEach((card, index) => {
    const present = Boolean(state.phonatorEnabled[index]);
    card.classList.toggle("is-absent", !present);
    card.classList.toggle("is-disabled", !present);
    const enable = $(`source${index + 1}Enable`);
    if (enable) {
      enable.disabled = false;
      enable.setAttribute("aria-pressed", String(present));
    }
    const tension = $(`source${index + 1}Tension`);
    if (tension) tension.disabled = !present;
    sourceVessels[index]?.classList.toggle("is-absent", !present);
    sourceVessels[index]?.classList.toggle("is-enabled", present);
    sourceVessels[index]?.classList.toggle("is-disabled", !present);
  });
  mouthCards.forEach((card, index) => {
    const present = Boolean(state.mouthEnabled[index]);
    card.classList.toggle("is-absent", !present);
    for (const control of card.querySelectorAll("input, button, select")) control.disabled = !present;
    mouthVessels[index]?.classList.toggle("is-absent", !present);
  });
  routeButtons.forEach((__, index) => renderRouteBase(index));
  updateCountPresentation();
  applyOrganicShapes();
}

function updateMediumPresentation() {
  const value = $("mediumSelect")?.value ?? "air";
  const engineLabel = value === "air"
    ? "AIR ENGINE 01"
    : value === "hydraulic" ? "HYDRAULIC ENGINE 02" : "GRANULAR ENGINE 03";
  if ($("engineStatus")) $("engineStatus").textContent = value === "air"
    ? "AIR ENGINE ONLINE"
    : value === "hydraulic" ? "HYDRAULIC ENGINE ONLINE" : "GRANULAR ENGINE ONLINE";
  if ($("engineTitle")) {
    $("engineTitle").textContent = `PRESSURE-OPERATED MULTI-MOUTH PREDATOR / ${engineLabel}`;
  }
}

function syncControlsFromState() {
  const mediumControl = $("mediumSelect");
  if (mediumControl) {
    mediumControl.value = state.mediumId === "water"
      ? "hydraulic"
      : state.mediumId === "pellets" ? "granular" : "air";
  }
  updateMediumPresentation();
  setRangeControl("level", state.level, percent);
  if ($("performanceMode")) {
    $("performanceMode").value = state.colonyAmount > 0.58
      ? "colony"
      : state.colonyAmount < 0.08 ? "direct" : "organ";
  }
  setRangeControl("lungPressure", state.breath, percent);
  setRangeControl("tempo", state.contourDurationSeconds, (value) => `${value.toFixed(1)} s`);
  const meanDepth = state.contours.reduce((sum, contour) => sum + contour.depth, 0) / state.contours.length;
  setRangeControl("swing", meanDepth, percent);
  setRangeControl("coupling", state.crossCoupling, percent);
  setRangeControl("valveSlew", state.valveSlewMs, (value) => `${Math.round(value)} ms`);
  setRangeControl("reservoirLoss", state.leak, percent);
  setRangeControl("lungCount", state.lungEnabled.filter(Boolean).length, (value) => String(Math.round(value)));
  setRangeControl("throatCount", state.phonatorEnabled.filter(Boolean).length, (value) => String(Math.round(value)));
  setRangeControl("mouthCount", state.mouthEnabled.filter(Boolean).length, (value) => String(Math.round(value)));
  const possible = Math.max(
    1,
    state.phonatorEnabled.filter(Boolean).length * state.mouthEnabled.filter(Boolean).length,
  );
  setRangeControl(
    "connectionDensity",
    activeRouteIndices({ union: false }).length / possible,
    percent,
  );
  state.phonators.forEach((phonator, index) => {
    setRangeControl(`source${index + 1}Tension`, phonator.tension, percent);
  });
  state.mouths.forEach((mouth, index) => {
    setRangeControl(`mouth${index + 1}Aperture`, mouth.opening, percent);
    setRangeControl(`mouth${index + 1}Tongue`, mouth.tonguePosition, percent);
  });
  if ($("seedReadout")) {
    $("seedReadout").textContent = `SEED ${(state.seed >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  }
  if ($("clockReadout")) $("clockReadout").textContent = `${state.contourDurationSeconds.toFixed(1)} S`;
  applyAnatomyPresentation();
  renderAllContours();
}

function generateRouteMatrix(density, salt, previous = null) {
  const active = COLONY_SYRINX_TOPOLOGY.routes.filter(({ phonatorIndex, mouthIndex }) => (
    state.phonatorEnabled[phonatorIndex] && state.mouthEnabled[mouthIndex]
  ));
  const ranked = active.slice().sort((left, right) => (
    seededUnit(left.index, salt) - seededUnit(right.index, salt)
  ));
  const chosen = new Set();
  const activeSources = state.phonatorEnabled
    .map((enabled, index) => enabled ? index : -1)
    .filter((index) => index >= 0);
  const activeMouths = state.mouthEnabled
    .map((enabled, index) => enabled ? index : -1)
    .filter((index) => index >= 0);
  for (const sourceIndex of activeSources) {
    const route = ranked.find((candidate) => candidate.phonatorIndex === sourceIndex);
    if (route) chosen.add(route.index);
  }
  for (const mouthIndex of activeMouths) {
    const route = ranked.find((candidate) => candidate.mouthIndex === mouthIndex);
    if (route) chosen.add(route.index);
  }
  const target = Math.max(chosen.size, Math.round(clamp(density, 0, 1) * active.length));
  for (const route of ranked) {
    if (chosen.size >= target) break;
    chosen.add(route.index);
  }
  const result = Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, () => (
    Array(COLONY_SYRINX_MOUTH_COUNT).fill(0)
  ));
  for (const route of active) {
    if (!chosen.has(route.index)) continue;
    const remembered = clamp(previous?.[route.phonatorIndex]?.[route.mouthIndex] ?? 0);
    result[route.phonatorIndex][route.mouthIndex] = remembered > 0.04
      ? remembered
      : 0.28 + seededUnit(route.index, salt ^ 0x58f1) * 0.72;
  }
  return result;
}

function setOrganCount(kind, count) {
  const density = clamp($("connectionDensity")?.value ?? 0.62);
  const patch = {};
  if (kind === "lungs") {
    patch.lungEnabled = lungMaskForPhonators(count);
  } else if (kind === "phonators") {
    patch.phonatorEnabled = rankedMask(COLONY_SYRINX_PHONATOR_COUNT, count, 0x42bf);
    patch.lungEnabled = lungMaskForPhonators(
      state.lungEnabled.filter(Boolean).length,
      patch.phonatorEnabled,
    );
  } else {
    patch.mouthEnabled = rankedMask(COLONY_SYRINX_MOUTH_COUNT, count, 0x93d1);
  }
  state = sanitizeColonySyrinxState({ ...state, ...patch }, state);
  state = sanitizeColonySyrinxState({
    ...state,
    routes: generateRouteMatrix(density, 0x31d7, state.routes),
    alternateRoutes: generateRouteMatrix(density, 0xc8a5, state.alternateRoutes),
  }, state);
  syncControlsFromState();
  postConfiguration();
  announce(`${state.lungEnabled.filter(Boolean).length} lungs, ${state.phonatorEnabled.filter(Boolean).length} throats, ${state.mouthEnabled.filter(Boolean).length} mouths alive`);
}

function setConnectionDensity(density) {
  state = sanitizeColonySyrinxState({
    ...state,
    routes: generateRouteMatrix(density, 0x31d7, state.routes),
    alternateRoutes: generateRouteMatrix(density, 0xc8a5, state.alternateRoutes),
  }, state);
  applyAnatomyPresentation();
  postConfiguration();
}

function mutateCreature(scope) {
  const nextSeed = (state.seed + 0x9e3779b9) >>> 0;
  state = randomizeColonySyrinxState(state, { scope, seed: nextSeed });
  state = sanitizeColonySyrinxState({
    ...state,
    contourDurationSeconds: clamp(state.contourDurationSeconds, 4, 40),
    valveSlewMs: clamp(state.valveSlewMs, 1, 180),
    contours: state.contours.map((contour) => ({
      ...contour,
      rate: clamp(contour.rate, 0.25, 4),
    })),
  }, state);
  if (scope === "anatomy" || scope === "all") {
    anatomyShapeSeed = state.seed;
    const requestedLungs = Math.max(4, state.lungEnabled.filter(Boolean).length);
    state = sanitizeColonySyrinxState({
      ...state,
      lungEnabled: lungMaskForPhonators(requestedLungs, state.phonatorEnabled),
    }, state);
  }
  heldRoutes.clear();
  deferredRouteReleases.clear();
  syncControlsFromState();
  postConfiguration();
  const label = scope === "all" ? "new creature" : `${scope} mutation`;
  announce(`${label}; seed ${(state.seed >>> 0).toString(16).toUpperCase().padStart(8, "0")}`);
}

function contourPathData(contour) {
  const sampleCount = 128;
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const phase = index / sampleCount;
    const x = 20 + phase * 960;
    const y = 8 + (1 - sampleColonySyrinxContour(contour, phase)) * 84;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function scheduleContourConfiguration() {
  if (contourPostFrame) return;
  contourPostFrame = requestAnimationFrame(() => {
    contourPostFrame = 0;
    postConfiguration();
  });
}

function updateContour(laneIndex, updates, { immediate = false } = {}) {
  const contours = state.contours.map((contour, index) => (
    index === laneIndex ? { ...contour, ...updates } : contour
  ));
  state = sanitizeColonySyrinxState({ ...state, contours }, state);
  renderContourLane(laneIndex);
  if (immediate) postConfiguration();
  else scheduleContourConfiguration();
}

function setContourPoint(laneIndex, pointIndex, value, { announceValue = false } = {}) {
  const contour = state.contours[laneIndex];
  if (!contour) return;
  const points = contour.points.slice();
  points[pointIndex] = clamp(value);
  updateContour(laneIndex, { points });
  if (announceValue) {
    announce(`${CONTOUR_META[laneIndex].label} point ${pointIndex + 1}: ${percent(points[pointIndex])}`);
  }
}

function editPointFromPointer(event, laneIndex, pointIndex, field) {
  const bounds = field.getBoundingClientRect();
  if (bounds.height <= 0) return;
  const value = 1 - (event.clientY - bounds.top) / bounds.height;
  setContourPoint(laneIndex, pointIndex, value);
}

function bindContourPoint(point, laneIndex, pointIndex, field) {
  let dragging = false;
  point.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dragging = true;
    point.classList.add("is-dragging");
    point.dataset.dragging = "true";
    point.setPointerCapture?.(event.pointerId);
    editPointFromPointer(event, laneIndex, pointIndex, field);
  });
  point.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    editPointFromPointer(event, laneIndex, pointIndex, field);
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    point.classList.remove("is-dragging");
    delete point.dataset.dragging;
    postConfiguration();
  };
  point.addEventListener("pointerup", finish);
  point.addEventListener("pointercancel", finish);
  point.addEventListener("lostpointercapture", finish);
  point.addEventListener("keydown", (event) => {
    const current = state.contours[laneIndex]?.points[pointIndex] ?? 0;
    const increment = event.shiftKey ? 0.01 : 0.04;
    let next = current;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") next += increment;
    else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next -= increment;
    else if (event.key === "PageUp") next += 0.12;
    else if (event.key === "PageDown") next -= 0.12;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    setContourPoint(laneIndex, pointIndex, next, { announceValue: true });
  });
}

function renderContourLane(laneIndex) {
  const lane = laneElements[laneIndex];
  const contour = state.contours[laneIndex];
  if (!lane || !contour) return;
  const pathData = contourPathData(contour);
  lane.querySelector(".contour-path")?.setAttribute("d", pathData);
  lane.querySelector(".contour-fill")?.setAttribute(
    "d",
    `${pathData} L 980 100 L 20 100 Z`,
  );
  lane.classList.toggle("is-muted", contour.muted);
  const mute = lane.querySelector(".contour-mute");
  if (mute) {
    mute.setAttribute("aria-pressed", String(contour.muted));
    mute.textContent = contour.muted ? "MUTED" : "FLOWING";
  }
  const shape = lane.querySelector(".contour-shape");
  if (shape) shape.value = contour.shape;
  const rate = lane.querySelector(".contour-rate");
  if (rate) {
    for (const option of rate.querySelectorAll("option[data-exact-rate]")) option.remove();
    const exact = CONTOUR_RATE_OPTIONS.includes(contour.rate);
    if (!exact) {
      const option = document.createElement("option");
      option.dataset.exactRate = "true";
      option.value = String(contour.rate);
      option.textContent = `${contour.rate.toFixed(3)}×`;
      rate.append(option);
      rate.value = String(contour.rate);
    } else rate.value = String(contour.rate);
  }
  const depth = lane.querySelector(".contour-depth");
  if (depth) {
    depth.value = String(contour.depth);
    updateRangeFill(depth);
    depth.setAttribute("aria-valuetext", percent(contour.depth));
  }
  lane.querySelectorAll(".contour-point").forEach((point, pointIndex) => {
    const value = clamp(contour.points[pointIndex]);
    const x = 2 + pointIndex / Math.max(1, COLONY_SYRINX_CONTOUR_POINT_COUNT) * 96;
    const y = 8 + (1 - value) * 84;
    point.style.setProperty("--point-x", `${x}%`);
    point.style.setProperty("--point-y", `${y}%`);
    point.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    point.setAttribute("aria-valuetext", percent(value));
  });
}

function renderAllContours() {
  if (laneElements.length !== COLONY_SYRINX_LANE_COUNT) {
    buildContourEditor();
    return;
  }
  laneElements.forEach((__, index) => renderContourLane(index));
}

function buildContourEditor() {
  const container = $("contourLanes");
  if (!container) return;
  container.replaceChildren();
  for (let laneIndex = 0; laneIndex < COLONY_SYRINX_LANE_COUNT; laneIndex += 1) {
    const contourId = COLONY_SYRINX_CONTOUR_IDS[laneIndex];
    const meta = CONTOUR_META.find((candidate) => candidate.id === contourId) ?? CONTOUR_META[laneIndex];
    const lane = document.createElement("article");
    lane.className = "sequence-lane contour-lane";
    lane.dataset.lane = String(laneIndex + 1);
    lane.dataset.contour = contourId;
    lane.dataset.contourId = contourId;
    lane.style.setProperty("--contour-color", meta.color);

    const header = document.createElement("header");
    header.className = "contour-lane-header";
    const copy = document.createElement("div");
    copy.className = "contour-lane-title lane-copy";
    const title = document.createElement("b");
    title.textContent = `${String(laneIndex + 1).padStart(2, "0")} / ${meta.label}`;
    const detail = document.createElement("small");
    detail.textContent = meta.detail;
    copy.append(title, detail);

    const controls = document.createElement("div");
    controls.className = "contour-controls contour-lane-controls";
    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "contour-mute";
    mute.setAttribute("aria-label", `Mute ${meta.label} contour`);

    const shapeLabel = document.createElement("label");
    shapeLabel.append("shape");
    const shape = document.createElement("select");
    shape.className = "contour-shape";
    shape.setAttribute("aria-label", `${meta.label} curve shape`);
    for (const shapeId of COLONY_SYRINX_CONTOUR_SHAPES) {
      const option = document.createElement("option");
      option.value = shapeId;
      option.textContent = shapeId;
      shape.append(option);
    }
    shapeLabel.append(shape);

    const rateLabel = document.createElement("label");
    rateLabel.append("rate");
    const rate = document.createElement("select");
    rate.className = "contour-rate";
    rate.setAttribute("aria-label", `${meta.label} playback rate`);
    for (const rateValue of CONTOUR_RATE_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(rateValue);
      option.textContent = `${rateValue}×`;
      rate.append(option);
    }
    rateLabel.append(rate);

    const depthLabel = document.createElement("label");
    depthLabel.append("depth");
    const depth = document.createElement("input");
    depth.type = "range";
    depth.min = "0";
    depth.max = "1";
    depth.step = "0.01";
    depth.className = "contour-depth";
    depth.setAttribute("aria-label", `${meta.label} depth`);
    depthLabel.append(depth);
    controls.append(mute, shapeLabel, rateLabel, depthLabel);
    header.append(copy, controls);

    const field = document.createElement("div");
    field.className = "contour-field contour-plot";
    field.setAttribute("aria-label", `${meta.label} sixteen-point closed contour`);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("contour-svg");
    svg.setAttribute("viewBox", "0 0 1000 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const grid = document.createElementNS(SVG_NS, "g");
    grid.classList.add("contour-grid");
    for (const y of [25, 50, 75]) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("x2", "1000");
      line.setAttribute("y1", String(y));
      line.setAttribute("y2", String(y));
      grid.append(line);
    }
    const fill = document.createElementNS(SVG_NS, "path");
    fill.classList.add("contour-fill");
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("contour-path");
    svg.append(grid, fill, path);
    field.append(svg);
    const playhead = document.createElement("i");
    playhead.className = "contour-playhead";
    playhead.setAttribute("aria-hidden", "true");
    field.append(playhead);
    for (let pointIndex = 0; pointIndex < COLONY_SYRINX_CONTOUR_POINT_COUNT; pointIndex += 1) {
      const point = document.createElement("button");
      point.type = "button";
      point.className = "contour-point";
      point.dataset.lane = String(laneIndex);
      point.dataset.point = String(pointIndex);
      point.setAttribute("role", "slider");
      point.setAttribute("aria-label", `${meta.label} point ${pointIndex + 1}`);
      point.setAttribute("aria-valuemin", "0");
      point.setAttribute("aria-valuemax", "100");
      bindContourPoint(point, laneIndex, pointIndex, field);
      field.append(point);
    }
    lane.append(header, field);
    container.append(lane);

    mute.addEventListener("click", () => {
      updateContour(laneIndex, { muted: !state.contours[laneIndex].muted }, { immediate: true });
    });
    shape.addEventListener("change", () => {
      updateContour(laneIndex, { shape: shape.value }, { immediate: true });
    });
    rate.addEventListener("change", () => {
      updateContour(laneIndex, { rate: Number(rate.value) }, { immediate: true });
    });
    depth.addEventListener("input", () => {
      updateContour(laneIndex, { depth: Number(depth.value) });
      const mean = state.contours.reduce((sum, contour) => sum + contour.depth, 0) / state.contours.length;
      setRangeControl("swing", mean, percent);
    });
  }
  laneElements = Array.from(container.querySelectorAll(".contour-lane[data-contour]"));
  laneElements.forEach((__, index) => renderContourLane(index));
}

function setAudioPresentation(on, detail = "") {
  const button = $("audioButton");
  const state = $("audioState");
  if (button) {
    button.setAttribute("aria-pressed", String(Boolean(on)));
    button.dataset.audioState = on ? "on" : "off";
    button.disabled = audioStarting;
  }
  if (state) state.textContent = on ? "on" : "off";
  if ($("audioError")) {
    $("audioError").hidden = !detail;
    $("audioError").textContent = detail;
  }
}

function postConfiguration() {
  graph?.sourceNode?.port.postMessage({
    type: "configure",
    configuration: stateFromControls(),
  });
}

function breathingNow() {
  return breathActive || sustainActive || transportPlaying;
}

function manualBreathingNow() {
  return breathActive || sustainActive;
}

function syncBreathPresentation() {
  const breathing = breathingNow();
  $("colonySyrinx")?.classList.toggle("is-breathing", breathing);
  if ($("breathReadout")) $("breathReadout").textContent = breathing
    ? transportPlaying && !manualBreathingNow() ? "one evolving exhale" : "pressure added by hand"
    : "resting";
}

function postBreath() {
  const value = clamp($("lungPressure")?.value ?? 0.68);
  graph?.sourceNode?.port.postMessage({
    type: "breath",
    // Transport sustains the physical breath. This message only adds a manual
    // pressure gesture; MIDI valves never retrigger the lungs.
    active: manualBreathingNow(),
    value,
  });
}

async function createAudioGraph() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error("This browser does not provide Web Audio.");
  const context = new Context({ latencyHint: "interactive", sampleRate: 48_000 });
  unlockAudioContext(context);
  // Claim the transient user activation before module loading can outlive it
  // (notably on Safari), then resume once more after the graph is complete.
  await context.resume();
  await context.audioWorklet.addModule(new URL("./src/colony-syrinx-processor.js", import.meta.url));
  const sourceNode = new AudioWorkletNode(context, "colony-syrinx-pressure-network", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions: { configuration: stateFromControls() },
  });
  const masterGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const analyser = context.createAnalyser();
  masterGain.gain.value = 1;
  compressor.threshold.value = -15;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.19;
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.56;
  sourceNode.connect(masterGain);
  masterGain.connect(compressor);
  compressor.connect(analyser);
  const releaseOutput = connectAudioOutput(context, analyser, { runtime: globalThis });
  sourceNode.port.onmessage = ({ data }) => {
    if (data?.type === "telemetry") telemetry = { ...telemetry, ...data };
  };
  sourceNode.onprocessorerror = () => {
    setAudioPresentation(false, "The pressure network stopped unexpectedly. Reload to reset it.");
  };
  return { context, sourceNode, masterGain, compressor, analyser, releaseOutput };
}

async function ensureAudio() {
  if (audioStarting) return false;
  if (!graph) {
    audioStarting = true;
    setAudioPresentation(false);
    try {
      graph = await createAudioGraph();
      audioContext = graph.context;
    } catch (error) {
      console.error(error);
      audioStarting = false;
      setAudioPresentation(false, error?.message || "Unable to start Colony Syrinx audio.");
      return false;
    }
    audioStarting = false;
  }
  try {
    unlockAudioContext(audioContext);
    await audioContext.resume();
    postConfiguration();
    postBreath();
    graph.sourceNode.port.postMessage({ type: "transport", playing: transportPlaying });
    setAudioPresentation(true);
    if ($("statusText")) $("statusText").textContent = transportPlaying
      ? "One continuous breath is moving through every living organ and contour."
      : "Audio is awake. Flow the freak, or hold B to add pressure by hand.";
    return true;
  } catch (error) {
    console.error(error);
    setAudioPresentation(false, error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    setBreath(false);
    graph.sourceNode.port.postMessage({ type: "panic" });
    await audioContext.suspend();
    setAudioPresentation(false);
    if ($("statusText")) $("statusText").textContent = "Audio sleeps. The valve map and anatomy remain editable.";
    announce("Colony Syrinx audio off");
    return;
  }
  if (await ensureAudio()) {
    if (!transportPlaying) setTransport(true, { reset: true });
    announce("Colony Syrinx audio on; one continuous creature is flowing");
  }
}

function setTransport(playing, { reset = false } = {}) {
  transportPlaying = Boolean(playing);
  const button = $("playButton");
  button?.setAttribute("aria-pressed", String(transportPlaying));
  button?.classList.toggle("is-playing", transportPlaying);
  if ($("playState")) $("playState").textContent = transportPlaying
    ? "continuous evolution · space / P"
    : "flow paused · space / P";
  $("colonySyrinx")?.classList.toggle("is-running", transportPlaying);
  graph?.sourceNode?.port.postMessage({ type: "transport", playing: transportPlaying, reset });
  postConfiguration();
  syncBreathPresentation();
  postBreath();
  if ($("statusText")) $("statusText").textContent = transportPlaying
    ? "One breath keeps flowing while six contours pull its anatomy through time."
    : "Evolution paused. Hold B or the breath organ for manual pressure.";
  announce(transportPlaying ? "Continuous evolution flowing" : "Continuous evolution paused");
}

async function toggleTransport() {
  if (!(await ensureAudio())) return;
  setTransport(!transportPlaying);
}

function setBreath(active, value = null) {
  breathActive = Boolean(active);
  if (value != null && $("lungPressure")) $("lungPressure").value = String(clamp(value));
  $("breathButton")?.setAttribute("aria-pressed", String(breathActive));
  $("breathButton")?.classList.toggle("is-breathing", breathActive);
  syncBreathPresentation();
  postBreath();
}

async function beginBreath(value = null, stillHeld = null) {
  if (!(await ensureAudio())) return;
  if (typeof stillHeld === "function" && !stillHeld()) return;
  setBreath(true, value);
}

function routeButtonForIndex(index) {
  return routeButtons[index] ?? null;
}

function commandedRouteAperture(index) {
  return Math.max(routeValue(state.routes, index), heldRoutes.get(index) ?? 0);
}

function renderRouteBase(index) {
  const button = routeButtonForIndex(index);
  const vessel = routeVessels[index];
  const { phonatorIndex, mouthIndex } = COLONY_SYRINX_TOPOLOGY.routes[index];
  const present = state.phonatorEnabled[phonatorIndex] && state.mouthEnabled[mouthIndex];
  const primary = routeValue(state.routes, index);
  const alternate = routeValue(state.alternateRoutes, index);
  const held = heldRoutes.get(index) ?? 0;
  const aperture = Math.max(primary, held);
  button?.setAttribute("aria-pressed", String(primary > 0.02));
  button?.setAttribute("aria-disabled", String(!present));
  if (button) button.disabled = !present;
  button?.style.setProperty("--velocity", String(aperture));
  button?.classList.toggle("is-alternate", alternate > 0.02);
  button?.classList.toggle("is-held", held > 0.02);
  button?.classList.toggle("is-absent", !present);
  vessel?.setAttribute("aria-pressed", String(primary > 0.02));
  vessel?.classList.toggle("is-open", present && Math.max(primary, alternate, held) > 0.02);
  vessel?.classList.toggle("is-alternate", present && alternate > 0.02);
  vessel?.classList.toggle("is-absent", !present);
}

function setManualRoute(index, aperture, kind = "primary") {
  if (index < 0 || index >= COLONY_SYRINX_ROUTE_COUNT) return;
  const { phonatorIndex, mouthIndex } = COLONY_SYRINX_TOPOLOGY.routes[index];
  if (!state.phonatorEnabled[phonatorIndex] || !state.mouthEnabled[mouthIndex]) return;
  const key = kind === "alternate" ? "alternateRoutes" : "routes";
  const matrix = copyRouteMatrix(state[key]);
  setRouteValue(matrix, index, aperture);
  state = sanitizeColonySyrinxState({ ...state, [key]: matrix }, state);
  renderRouteBase(index);
  updateCountPresentation();
  postConfiguration();
}

function setHeldRoute(owner, index, velocity) {
  if (index < 0 || index >= COLONY_SYRINX_ROUTE_COUNT) return;
  heldRoutes.set(index, Math.max(heldRoutes.get(index) ?? 0, clamp(velocity, 0.01, 1)));
  if (owner) keyOwners.add(owner);
  renderRouteBase(index);
  postConfiguration();
}

function releaseHeldRoute(owner, index) {
  if (owner) keyOwners.delete(owner);
  if (sustainActive) {
    deferredRouteReleases.add(index);
    return;
  }
  heldRoutes.delete(index);
  renderRouteBase(index);
  postConfiguration();
}

function triggerRoute(index, velocity = 1, owner = "") {
  setHeldRoute(owner, index, velocity);
}

function releaseRoute(index, owner = "") {
  releaseHeldRoute(owner, index);
}

function queueRouteStart(index, velocity, owner) {
  if (owner) keyOwners.add(owner);
  ensureAudio().then((ready) => {
    if (!ready || (owner && !keyOwners.has(owner))) return;
    if (!transportPlaying) setTransport(true, { reset: true });
    triggerRoute(index, velocity, owner);
  });
}

function panic({ announceState = true } = {}) {
  if (transportPlaying) setTransport(false);
  heldRoutes.clear();
  deferredRouteReleases.clear();
  keyOwners.clear();
  state = sanitizeColonySyrinxState({
    ...state,
    routes: Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, () => (
      Array(COLONY_SYRINX_MOUTH_COUNT).fill(0)
    )),
    alternateRoutes: Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, () => (
      Array(COLONY_SYRINX_MOUTH_COUNT).fill(0)
    )),
  }, state);
  sustainActive = false;
  setBreath(false);
  routeButtons.forEach((__, index) => renderRouteBase(index));
  updateCountPresentation();
  graph?.sourceNode?.port.postMessage({ type: "panic" });
  postConfiguration();
  if (announceState) announce("All twelve valves closed and pressure released");
}

function resetControllers() {
  heldRoutes.clear();
  deferredRouteReleases.clear();
  keyOwners.clear();
  sustainActive = false;
  setBreath(false);
  postConfiguration();
}

function handleMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (!message || (routeId && routeId !== "colony-syrinx")) return;
  const bytes = message.data ?? message.raw ?? null;
  const rawStatus = Number(bytes?.[0]) || 0;
  const rawType = rawStatus & 0xf0;
  const channel = Number(message.channel) || (rawStatus & 0x0f);
  const note = Number(message.note ?? bytes?.[1]) || 0;
  const velocity = Number(message.velocity ?? bytes?.[2]) || 0;
  const controller = Number(message.controller ?? bytes?.[1]) || 0;
  const controlValue = Number(message.value ?? bytes?.[2]) || 0;
  const type = message.type ?? (
    rawType === 0x90 && velocity > 0 ? "noteOn"
      : rawType === 0x80 || rawType === 0x90 ? "noteOff"
        : rawType === 0xb0 ? "controlChange" : "unknown"
  );

  if (midiLearnArmed && type === "noteOn" && velocity > 0) {
    event.preventDefault();
    midiLearnNotes.push(note);
    if (midiLearnNotes.length === 1) {
      midiBaseNote = clamp(note, 0, 116);
      midiLearnArmed = false;
      $("midiLearnButton")?.classList.remove("is-learning");
      if ($("midiReadout")) $("midiReadout").textContent = `mapped ${midiBaseNote}–${midiBaseNote + 11}`;
      announce(`Valve map begins at MIDI note ${midiBaseNote}`);
      postConfiguration();
    }
    return;
  }

  const route = colonySyrinxRouteFromMidiNote(note, midiBaseNote);
  if ((type === "noteOn" || type === "noteOff") && route) {
    event.preventDefault();
    const owner = `midi:${channel}:${note}`;
    if (type === "noteOn" && velocity > 0) {
      queueRouteStart(route.routeIndex, velocity > 1 ? velocity / 127 : velocity, owner);
      if ($("midiReadout")) $("midiReadout").textContent = `note ${note} · valve ${route.routeIndex + 1}`;
    } else {
      releaseRoute(route.routeIndex, owner);
    }
    return;
  }

  if (type !== "controlChange") return;
  if (controller === 64) {
    event.preventDefault();
    sustainActive = controlValue >= 64;
    if (sustainActive) {
      ensureAudio().then((ready) => {
        if (!ready || !sustainActive) return;
        if ($("lungPressure")) $("lungPressure").value = String(clamp(controlValue / 127));
        syncBreathPresentation();
        postConfiguration();
        postBreath();
      });
    }
    else {
      deferredRouteReleases.forEach((index) => heldRoutes.delete(index));
      deferredRouteReleases.clear();
      setBreath(false);
      postConfiguration();
    }
    return;
  }
  if (controller === 120 || controller === 123) {
    event.preventDefault();
    panic();
    return;
  }
  if (controller === 121) {
    event.preventDefault();
    resetControllers();
  }
}

function isTypingTarget(target) {
  return target instanceof Element && Boolean(target.closest("input, select, textarea, [contenteditable='true']"));
}

function handleKeyDown(event) {
  if (event.repeat || isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "b") {
    event.preventDefault();
    breathKeyHeld = true;
    beginBreath(null, () => breathKeyHeld);
    return;
  }
  if (key === "p" || key === " ") {
    if (event.target instanceof Element && event.target.closest("button, a")) return;
    event.preventDefault();
    toggleTransport();
    return;
  }
  if (key === "escape") {
    event.preventDefault();
    panic();
    return;
  }
  const routeIndex = KEY_ROUTES[key];
  if (routeIndex == null) return;
  event.preventDefault();
  const owner = `key:${key}`;
  queueRouteStart(routeIndex, 0.82, owner);
}

function handleKeyUp(event) {
  if (isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "b") {
    event.preventDefault();
    breathKeyHeld = false;
    setBreath(false);
    return;
  }
  const routeIndex = KEY_ROUTES[key];
  if (routeIndex == null) return;
  event.preventDefault();
  releaseRoute(routeIndex, `key:${key}`);
}

function bindRange(id, formatter, onInput = postConfiguration) {
  const input = $(id);
  const output = $(`${id}Out`);
  if (!input) return;
  const render = (notify = true) => {
    updateRangeFill(input);
    if (output) output.textContent = formatter(Number(input.value));
    if (notify) onInput?.(Number(input.value));
  };
  input.addEventListener("input", () => render(true));
  render(false);
}

function bindControls() {
  $("audioButton")?.addEventListener("click", toggleAudio);
  $("playButton")?.addEventListener("click", toggleTransport);
  $("panicButton")?.addEventListener("click", () => panic());

  const breathButton = $("breathButton");
  breathButton?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    breathPointerHeld = true;
    breathButton.setPointerCapture?.(event.pointerId);
    beginBreath(
      event.pressure > 0 ? 0.34 + event.pressure * 0.66 : null,
      () => breathPointerHeld,
    );
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    breathButton?.addEventListener(type, () => {
      breathPointerHeld = false;
      setBreath(false);
    });
  }

  lungButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      const living = state.lungEnabled.filter(Boolean).length;
      if (state.lungEnabled[index] && living <= 4) {
        announce("The creature needs at least four lungs");
        return;
      }
      const bankStart = Math.floor(index / 4) * 4;
      const bankLungCount = state.lungEnabled
        .slice(bankStart, bankStart + 4)
        .filter(Boolean).length;
      if (state.lungEnabled[index]
        && state.phonatorEnabled[Math.floor(index / 4)]
        && bankLungCount <= 1) {
        announce("Each living throat needs at least one lung");
        return;
      }
      const lungEnabled = state.lungEnabled.slice();
      lungEnabled[index] = !lungEnabled[index];
      state = sanitizeColonySyrinxState({ ...state, lungEnabled }, state);
      syncControlsFromState();
      postConfiguration();
      announce(`Lung ${index + 1} ${lungEnabled[index] ? "joined" : "shed"}`);
    });
  });

  sourceCards.forEach((card, index) => {
    const enable = $( `source${index + 1}Enable`);
    enable?.addEventListener("click", () => {
      const living = state.phonatorEnabled.filter(Boolean).length;
      if (state.phonatorEnabled[index] && living <= 1) {
        announce("The creature needs at least one paired throat");
        return;
      }
      const phonatorEnabled = state.phonatorEnabled.slice();
      phonatorEnabled[index] = !phonatorEnabled[index];
      const requestedLungs = state.lungEnabled.filter(Boolean).length;
      state = sanitizeColonySyrinxState({
        ...state,
        phonatorEnabled,
        lungEnabled: lungMaskForPhonators(requestedLungs, phonatorEnabled),
      }, state);
      const density = clamp($("connectionDensity")?.value ?? 0.62);
      state = sanitizeColonySyrinxState({
        ...state,
        routes: generateRouteMatrix(density, 0x31d7, state.routes),
        alternateRoutes: generateRouteMatrix(density, 0xc8a5, state.alternateRoutes),
      }, state);
      syncControlsFromState();
      postConfiguration();
    });
    bindRange(`source${index + 1}Tension`, percent, (value) => {
      const phonators = state.phonators.map((phonator, phonatorIndex) => (
        phonatorIndex === index ? { ...phonator, tension: value } : phonator
      ));
      state = sanitizeColonySyrinxState({ ...state, phonators }, state);
      postConfiguration();
    });
  });

  routeButtons.forEach((button, index) => {
    button.title = "Click: primary path · Shift-click: alternate path";
    button.addEventListener("click", (event) => {
      const kind = event.shiftKey ? "alternate" : "primary";
      const matrix = kind === "alternate" ? state.alternateRoutes : state.routes;
      setManualRoute(index, routeValue(matrix, index) > 0.02 ? 0 : 1, kind);
      announce(`${kind} route ${index + 1} ${routeValue(state[kind === "alternate" ? "alternateRoutes" : "routes"], index) > 0.02 ? "open" : "closed"}`);
    });
    renderRouteBase(index);
  });
  routeVessels.forEach((vessel, index) => {
    if (!vessel) return;
    const { phonatorIndex, mouthIndex } = COLONY_SYRINX_TOPOLOGY.routes[index];
    vessel.setAttribute("role", "button");
    vessel.setAttribute("tabindex", "0");
    vessel.setAttribute("aria-label", `Toggle source ${phonatorIndex + 1} to mouth ${mouthIndex + 1}; hold Shift for alternate route`);
    vessel.addEventListener("click", (event) => {
      const kind = event.shiftKey ? "alternate" : "primary";
      const matrix = kind === "alternate" ? state.alternateRoutes : state.routes;
      setManualRoute(index, routeValue(matrix, index) > 0.02 ? 0 : 1, kind);
    });
    vessel.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const kind = event.shiftKey ? "alternate" : "primary";
      const matrix = kind === "alternate" ? state.alternateRoutes : state.routes;
      setManualRoute(index, routeValue(matrix, index) > 0.02 ? 0 : 1, kind);
    });
    renderRouteBase(index);
  });

  mouthCards.forEach((card, index) => {
    bindRange(`mouth${index + 1}Aperture`, percent, (value) => {
      const mouths = state.mouths.map((mouth, mouthIndex) => (
        mouthIndex === index ? { ...mouth, opening: value } : mouth
      ));
      state = sanitizeColonySyrinxState({ ...state, mouths }, state);
      postConfiguration();
    });
    bindRange(`mouth${index + 1}Tongue`, percent, (value) => {
      const mouths = state.mouths.map((mouth, mouthIndex) => (
        mouthIndex === index ? { ...mouth, tonguePosition: value } : mouth
      ));
      state = sanitizeColonySyrinxState({ ...state, mouths }, state);
      applyOrganicShapes();
      postConfiguration();
    });
    card.style.setProperty("--mouth-index", String(index));
  });

  bindRange("level", percent, (value) => {
    state = sanitizeColonySyrinxState({ ...state, level: value }, state);
    postConfiguration();
  });
  bindRange("lungPressure", percent, (value) => {
    state = sanitizeColonySyrinxState({
      ...state,
      breath: value,
      breathRateBpm: 4 + value * 68,
      pressureGain: 0.48 + value * 1.72,
    }, state);
    postConfiguration();
    postBreath();
  });
  bindRange("tempo", (value) => `${value.toFixed(1)} s`, (value) => {
    state = sanitizeColonySyrinxState({ ...state, contourDurationSeconds: value }, state);
    if ($("clockReadout")) $("clockReadout").textContent = `${value.toFixed(1)} S`;
    postConfiguration();
  });
  bindRange("swing", percent, (value) => {
    const contours = state.contours.map((contour) => ({ ...contour, depth: value }));
    state = sanitizeColonySyrinxState({ ...state, contours }, state);
    renderAllContours();
    postConfiguration();
  });
  bindRange("coupling", percent, (value) => {
    state = sanitizeColonySyrinxState({ ...state, crossCoupling: value }, state);
    postConfiguration();
  });
  bindRange("valveSlew", (value) => `${Math.round(value)} ms`, (value) => {
    state = sanitizeColonySyrinxState({ ...state, valveSlewMs: value }, state);
    postConfiguration();
  });
  bindRange("reservoirLoss", percent, (value) => {
    state = sanitizeColonySyrinxState({ ...state, leak: value }, state);
    postConfiguration();
  });

  bindRange("lungCount", (value) => String(Math.round(value)), (value) => {
    if (Math.round(value) !== state.lungEnabled.filter(Boolean).length) setOrganCount("lungs", value);
  });
  bindRange("throatCount", (value) => String(Math.round(value)), (value) => {
    if (Math.round(value) !== state.phonatorEnabled.filter(Boolean).length) setOrganCount("phonators", value);
  });
  bindRange("mouthCount", (value) => String(Math.round(value)), (value) => {
    if (Math.round(value) !== state.mouthEnabled.filter(Boolean).length) setOrganCount("mouths", value);
  });
  bindRange("connectionDensity", percent, (value) => {
    const possible = Math.max(
      1,
      state.phonatorEnabled.filter(Boolean).length * state.mouthEnabled.filter(Boolean).length,
    );
    const actual = activeRouteIndices({ union: false }).length / possible;
    if (Math.abs(value - actual) > 0.025) setConnectionDensity(value);
  });

  $("mediumSelect")?.addEventListener("change", () => {
    const value = $("mediumSelect").value;
    state = sanitizeColonySyrinxState({
      ...state,
      mediumId: value === "hydraulic" ? "water" : value === "granular" ? "pellets" : "air",
    }, state);
    updateMediumPresentation();
    postConfiguration();
    announce(`${$("mediumSelect").selectedOptions[0]?.textContent ?? value} loaded`);
  });
  $("performanceMode")?.addEventListener("change", () => {
    const mode = $("performanceMode").value;
    state = sanitizeColonySyrinxState({
      ...state,
      colonyAmount: mode === "colony" ? 0.86 : mode === "organ" ? 0.28 : 0,
      gateHysteresis: mode === "colony" ? 0.68 : 0.32,
    }, state);
    postConfiguration();
  });
  $("randomizeAllButton")?.addEventListener("click", () => mutateCreature("all"));
  $("randomizeBodyButton")?.addEventListener("click", () => mutateCreature("anatomy"));
  $("randomizeRoutesButton")?.addEventListener("click", () => mutateCreature("plumbing"));
  $("randomizeMotionButton")?.addEventListener("click", () => mutateCreature("motion"));
  $("mutateMotionButton")?.addEventListener("click", () => mutateCreature("motion"));
  $("midiLearnButton")?.addEventListener("click", () => {
    midiLearnArmed = !midiLearnArmed;
    midiLearnNotes = [];
    $("midiLearnButton").classList.toggle("is-learning", midiLearnArmed);
    if ($("midiReadout")) $("midiReadout").textContent = midiLearnArmed ? "play lowest valve note" : "not connected";
  });

  globalThis.addEventListener("keydown", handleKeyDown);
  globalThis.addEventListener("keyup", handleKeyUp);
  globalThis.addEventListener("morphazoid:midi-input", handleMidiInput);
  globalThis.addEventListener("blur", () => {
    if (!sustainActive) {
      heldRoutes.clear();
      setBreath(false);
      postConfiguration();
    }
  });
}

function safeVector(value, length, maximum = 1) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : [];
  return Array.from({ length }, (_, index) => clamp(source[index] ?? 0, 0, maximum));
}

function normalizePressure(value) {
  return Math.sqrt(clamp(value, 0, COLONY_SYRINX_MAX_PRESSURE) / COLONY_SYRINX_MAX_PRESSURE);
}

function normalizeFlow(value) {
  return Math.sqrt(clamp(value, 0, 8) / 8);
}

function renderTelemetry() {
  const reservoirPressures = safeVector(telemetry.reservoirs, 4, COLONY_SYRINX_MAX_PRESSURE);
  const lungPressures = safeVector(telemetry.lungs, COLONY_SYRINX_LUNG_COUNT, COLONY_SYRINX_MAX_PRESSURE);
  const reservoirs = reservoirPressures.map(normalizePressure);
  const lungs = lungPressures.map(normalizePressure);
  const folds = safeVector(telemetry.folds, 8);
  const foldFrequencies = safeVector(telemetry.foldFrequenciesHz, 8, 20_000);
  const sourceFrequencies = safeVector(telemetry.sourceFrequenciesHz, 4, 20_000);
  const routeFlows = safeVector(telemetry.routes, COLONY_SYRINX_ROUTE_COUNT, 8);
  const routes = routeFlows.map(normalizeFlow);
  const routeApertures = safeVector(telemetry.routeApertures, COLONY_SYRINX_ROUTE_COUNT);
  const mouthFlows = safeVector(telemetry.mouths, COLONY_SYRINX_MOUTH_COUNT, 8);
  const mouthPressures = safeVector(
    telemetry.mouthPressures,
    COLONY_SYRINX_MOUTH_COUNT,
    COLONY_SYRINX_MAX_PRESSURE,
  );
  const mouths = mouthPressures.map(normalizePressure);
  const bankLevels = safeVector(telemetry.bankLevels ?? telemetry.exhales, 4);
  const contourPhase = wrapUnit(telemetry.contourPhase ?? 0);
  const contourValues = safeVector(telemetry.contourValues, COLONY_SYRINX_LANE_COUNT);
  const lanePhases = safeVector(telemetry.lanePhases, COLONY_SYRINX_LANE_COUNT);
  if (transportPlaying && !manualBreathingNow() && $("breathReadout")) {
    $("breathReadout").textContent = `one exhale · ${String(Math.round(contourPhase * 360)).padStart(3, "0")}°`;
  }
  const meanPressure = reservoirPressures.reduce((sum, value) => sum + value, 0) / reservoirPressures.length;
  const pressureLevel = normalizePressure(meanPressure);
  const openPaths = routeFlows.filter((value, index) => (
    state.phonatorEnabled[COLONY_SYRINX_TOPOLOGY.routes[index].phonatorIndex]
    && state.mouthEnabled[COLONY_SYRINX_TOPOLOGY.routes[index].mouthIndex]
    && value > 0.02
  )).length;

  lungButtons.forEach((button, index) => {
    button.style.setProperty("--pressure", String(lungs[index]));
    button.querySelector("b")?.style.setProperty("--fill", String(lungs[index]));
    button.classList.toggle("is-pressured", lungs[index] > 0.12);
    lungVessels[index]?.style.setProperty("--pressure", String(lungs[index]));
    const present = Boolean(state.lungEnabled[index]);
    const bankLevel = bankLevels[Math.floor(index / 4)];
    button.style.setProperty("--exhale", String(bankLevel));
    button.classList.toggle("is-exhaling", present && bankLevel > 0.02);
    lungVessels[index]?.style.setProperty("--exhale", String(bankLevel));
    lungVessels[index]?.classList.toggle("is-exhaling", present && bankLevel > 0.02);
    lungVessels[index]?.classList.toggle("is-enabled", present);
    lungVessels[index]?.classList.toggle("is-disabled", !present);
  });
  reservoirs.forEach((value, index) => {
    if ($( `bank${index + 1}Pressure`)) $( `bank${index + 1}Pressure`).textContent = percent(value);
    document.querySelector(`.lung-bank[data-bank="${index + 1}"]`)?.style.setProperty("--pressure", String(value));
    lungGardenMembranes[index]?.style.setProperty("--exhale", String(bankLevels[index]));
  });
  folds.forEach((value, index) => {
    $( `fold${index + 1}Meter`)?.style.setProperty("--activity", String(value));
  });
  SOURCE_DISPLAY_FREQUENCIES.forEach((fallback, index) => {
    const activity = Math.max(folds[index * 2], folds[index * 2 + 1]);
    sourceVessels[index]?.style.setProperty("--activity", String(activity));
    const present = Boolean(state.phonatorEnabled[index]);
    sourceVessels[index]?.style.setProperty("--exhale", String(bankLevels[index]));
    sourceVessels[index]?.classList.toggle("is-exhaling", present && bankLevels[index] > 0.02);
    sourceVessels[index]?.classList.toggle("is-enabled", present);
    sourceVessels[index]?.classList.toggle("is-disabled", !present);
    const first = foldFrequencies[index * 2];
    const second = foldFrequencies[index * 2 + 1];
    const frequency = sourceFrequencies[index] > 0
      ? sourceFrequencies[index]
      : first > 0 || second > 0 ? (first + second) * 0.5 : fallback;
    if ($( `source${index + 1}Frequency`)) {
      $( `source${index + 1}Frequency`).textContent = `${Math.round(frequency)} Hz`;
    }
  });
  routeButtons.forEach((button, index) => {
    const topology = COLONY_SYRINX_TOPOLOGY.routes[index];
    const present = state.phonatorEnabled[topology.phonatorIndex] && state.mouthEnabled[topology.mouthIndex];
    button.style.setProperty("--flow", String(routes[index]));
    button.classList.toggle("is-flowing", present && routeFlows[index] > 0.02);
    const vessel = routeVessels[index];
    const aperture = Math.max(routeApertures[index], commandedRouteAperture(index));
    vessel?.style.setProperty("--flow", String(routes[index]));
    vessel?.classList.toggle("is-open", present && aperture > 0.02);
    vessel?.classList.toggle(
      "is-flowing",
      present && aperture > 0.02 && routeFlows[index] > 0.02,
    );
    vessel?.setAttribute("aria-pressed", String(present && aperture > 0.02));
  });
  mouthCards.forEach((card, index) => {
    const present = Boolean(state.mouthEnabled[index]);
    card.style.setProperty("--pressure", String(mouths[index]));
    card.style.setProperty("--flow", String(normalizeFlow(mouthFlows[index])));
    card.classList.toggle("is-sounding", present && mouthFlows[index] > 0.02);
    mouthVessels[index]?.style.setProperty("--pressure", String(mouths[index]));
    mouthVessels[index]?.classList.toggle("is-sounding", present && mouthFlows[index] > 0.02);
    const readout = $( `mouth${index + 1}State`);
    if (readout) readout.textContent = !present
      ? "ABSENT"
      : mouthFlows[index] > 0.32 ? "OPEN" : mouthFlows[index] > 0.02 ? "VOICE" : "SHUT";
  });
  laneElements.forEach((lane, index) => {
    const phase = wrapUnit(lanePhases[index] ?? contourPhase);
    lane.style.setProperty("--contour-value", String(contourValues[index]));
    lane.querySelector(".contour-playhead")?.style.setProperty("--playhead-x", `${phase * 100}%`);
  });

  const pressureKpa = meanPressure * 10;
  if ($("lungPressureReadout")) $("lungPressureReadout").textContent = `${pressureKpa.toFixed(1)} kPa`;
  if ($("manifoldReadout")) $("manifoldReadout").textContent = `${pressureKpa.toFixed(1)} kPa`;
  if ($("flowReadout")) $("flowReadout").textContent = `${clamp(telemetry.flow, 0, 24).toFixed(2)} L/s`;
  updateCountPresentation(openPaths);
  if ($("loadReadout")) $("loadReadout").textContent = percent(telemetry.load ?? 0);
  if ($("foldLockReadout")) {
    const activePairs = [0, 1, 2, 3].filter((index) => Math.max(folds[index * 2], folds[index * 2 + 1]) > 0.08).length;
    $("foldLockReadout").textContent = `${activePairs} × paired`;
  }
  const phaseDegrees = String(Math.round(contourPhase * 360) % 360).padStart(3, "0");
  if ($("stepReadout")) $("stepReadout").textContent = `PHASE ${phaseDegrees}°`;
  if ($("phaseReadout")) $("phaseReadout").textContent = `PHASE ${phaseDegrees}°`;
  if ($("clockReadout")) $("clockReadout").textContent = `${state.contourDurationSeconds.toFixed(1)} S`;
  if ($("breathMeter")) {
    const breath = clamp(meanPressure * 0.76 + (breathingNow() ? 0.18 : 0));
    $("breathMeter").setAttribute("aria-valuenow", String(Math.round(breath * 100)));
    $("breathMeter").style.setProperty("--breath", String(breath));
  }
  document.documentElement.style.setProperty("--colony-pressure", String(pressureLevel));
  document.documentElement.style.setProperty("--colony-rms", String(clamp(telemetry.rms ?? 0) * 4));
  animationFrame = requestAnimationFrame(renderTelemetry);
}

function cleanup() {
  cancelAnimationFrame(animationFrame);
  globalThis.removeEventListener("keydown", handleKeyDown);
  globalThis.removeEventListener("keyup", handleKeyUp);
  globalThis.removeEventListener("morphazoid:midi-input", handleMidiInput);
  graph?.sourceNode?.port.postMessage({ type: "panic" });
  graph?.sourceNode?.disconnect();
  graph?.releaseOutput?.();
  audioContext?.close();
}

buildContourEditor();
syncControlsFromState();
bindControls();
setAudioPresentation(false);
setTransport(false);
renderTelemetry();
globalThis.addEventListener("pagehide", cleanup, { once: true });

import {
  COLONY_SYRINX_CALLS,
  COLONY_SYRINX_CONTOUR_IDS,
  COLONY_SYRINX_CONTOUR_POINT_COUNT,
  COLONY_SYRINX_CONTOUR_SHAPES,
  COLONY_SYRINX_FOLD_COUNT,
  COLONY_SYRINX_LANE_COUNT,
  COLONY_SYRINX_LUNG_COUNT,
  COLONY_SYRINX_MAX_PRESSURE,
  COLONY_SYRINX_MOUTH_COUNT,
  COLONY_SYRINX_PHONATOR_COUNT,
  COLONY_SYRINX_ROUTE_COUNT,
  COLONY_SYRINX_TOPOLOGY,
  colonySyrinxRouteFromMidiNote,
  createColonySyrinxCallState,
  randomizeColonySyrinxState,
  sampleColonySyrinxContour,
  sanitizeColonySyrinxState,
} from "./src/colony-syrinx.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { unlockAudioContext } from "./src/audio.js";
import {
  colonySyrinxEndpointEligible,
  colonySyrinxLungFeedGeometries,
  colonySyrinxRouteGeometries,
  createColonySyrinxGraphLayout,
  moveColonySyrinxGraphNode,
} from "./src/colony-syrinx-graph.js";

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
  { id: "breath", label: "Breath pressure", detail: "reservoir pressure", color: "#c9f36a" },
  { id: "tension", label: "Vocal-fold tension", detail: "membrane tension", color: "#ff63b9" },
  { id: "routing", label: "Route aperture", detail: "primary to alternate routing", color: "#64dfd2" },
  { id: "maw", label: "Low-tract opening", detail: "low tract aperture", color: "#ff8f4c" },
  { id: "speech", label: "Vowel-tract opening", detail: "tongue and cavity aperture", color: "#64dfd2" },
  { id: "click", label: "Jet-tract opening", detail: "narrow tract aperture", color: "#f3df5c" },
]);
const CONTOUR_RATE_OPTIONS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
const SVG_NS = "http://www.w3.org/2000/svg";
const GRAPH_VIEWBOX = Object.freeze({ width: 1200, height: 620 });

const lungButtons = Array.from(document.querySelectorAll("[data-lung]"));
const sourceCards = Array.from(document.querySelectorAll(".source-card[data-source]"));
const routeButtons = Array.from(document.querySelectorAll(".route-valve[data-source][data-mouth]"));
const mouthCards = Array.from(document.querySelectorAll(".mouth-card[data-mouth]"));
const foldMeters = Array.from(document.querySelectorAll(".fold-pair .fold"));
const foldVessels = Array.from(document.querySelectorAll(
  ".vessel-source .fold-left, .vessel-source .fold-right",
));
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
const colonyBody = document.querySelector(".colony-body");
const lungFeedVessels = $("lungFeedVessels");
const routeHitVessels = $("routeHitVessels");
const routeDraft = $("routeDraft");
let routeHitPaths = [];
let lungFeedPaths = [];

let audioContext = null;
let graph = null;
let audioStarting = false;
let transportPlaying = false;
let callActive = false;
let activeCallId = null;
let activeCallToken = null;
let nextCallToken = 0;
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
  foldDisplacements: Array(8).fill(0),
  routes: Array(COLONY_SYRINX_ROUTE_COUNT).fill(0),
  routeApertures: Array(COLONY_SYRINX_ROUTE_COUNT).fill(0),
  mouths: Array(COLONY_SYRINX_MOUTH_COUNT).fill(0),
  mouthPressures: Array(COLONY_SYRINX_MOUTH_COUNT).fill(0),
  mouthApertures: Array(COLONY_SYRINX_MOUTH_COUNT).fill(0),
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
  callActive: false,
  callProgress: 0,
};
const DEFAULT_CALL_ID = "air-crossed-bass-speech";
let selectedCallId = DEFAULT_CALL_ID;
let state = createColonySyrinxCallState(selectedCallId);
let anatomyShapeSeed = state.seed;
let graphLayoutSeed = anatomyShapeSeed;
let graphLayout = createColonySyrinxGraphLayout({ seed: graphLayoutSeed });
let graphMotionEnabled = true;
let graphGesture = null;
let graphConfigurationFrame = 0;
let lastGraphTelemetryRender = -Infinity;
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

function foldMaskForPhonators(requestedCount, phonatorMask = state.phonatorEnabled) {
  const eligible = Array.from({ length: COLONY_SYRINX_FOLD_COUNT }, (_, index) => index)
    .filter((index) => phonatorMask[Math.floor(index / 2)]);
  const target = Math.round(clamp(requestedCount, 0, eligible.length));
  const ranking = eligible.sort((left, right) => (
    seededUnit(left, 0xf01d) - seededUnit(right, 0xf01d)
  ));
  return Array.from(
    { length: COLONY_SYRINX_FOLD_COUNT },
    (_, index) => ranking.slice(0, target).includes(index),
  );
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

function activePhonatorIndices(candidate = state) {
  return candidate.phonatorEnabled
    .map((enabled, index) => enabled ? index : -1)
    .filter((index) => index >= 0);
}

function phonatorHasLung(candidate, phonatorIndex) {
  const first = phonatorIndex * (COLONY_SYRINX_LUNG_COUNT / COLONY_SYRINX_PHONATOR_COUNT);
  const last = first + (COLONY_SYRINX_LUNG_COUNT / COLONY_SYRINX_PHONATOR_COUNT);
  return candidate.lungEnabled.slice(first, last).some(Boolean);
}

function phonatorHasFold(candidate, phonatorIndex) {
  return candidate.foldEnabled.slice(phonatorIndex * 2, phonatorIndex * 2 + 2).some(Boolean);
}

function repairDirectPressurePath(candidate) {
  const active = activePhonatorIndices(candidate);
  if (!active.length || !candidate.lungEnabled.some(Boolean)) return candidate;
  const voiced = active.filter((index) => phonatorHasFold(candidate, index));
  const targets = voiced.length ? voiced : active;
  if (targets.some((index) => phonatorHasLung(candidate, index))) return candidate;
  const target = targets[0];
  const lungEnabled = candidate.lungEnabled.slice();
  const sourceLung = lungEnabled.findIndex(Boolean);
  const lungsPerSource = COLONY_SYRINX_LUNG_COUNT / COLONY_SYRINX_PHONATOR_COUNT;
  const targetLung = target * lungsPerSource;
  if (sourceLung >= 0) lungEnabled[sourceLung] = false;
  lungEnabled[targetLung] = true;
  return sanitizeColonySyrinxState({ ...candidate, lungEnabled }, candidate);
}

function directlyDrivenPhonator(candidate = state) {
  const active = activePhonatorIndices(candidate);
  const voiced = active.filter((index) => phonatorHasFold(candidate, index));
  return (voiced.length ? voiced : active).find((index) => phonatorHasLung(candidate, index)) ?? -1;
}

function updateCountPresentation(openPathCount = null) {
  const lungs = state.lungEnabled.filter(Boolean).length;
  const throats = state.phonatorEnabled.filter(Boolean).length;
  const folds = state.foldEnabled.filter((enabled, index) => (
    enabled && state.phonatorEnabled[Math.floor(index / 2)]
  )).length;
  const mouths = state.mouthEnabled.filter(Boolean).length;
  const routes = activeRouteIndices().length;
  const openPaths = openPathCount == null ? 0 : openPathCount;
  const values = {
    activeLungCount: String(lungs).padStart(2, "0"),
    activeFoldCount: String(folds).padStart(2, "0"),
    activeRouteCount: String(routes).padStart(2, "0"),
    activeMouthCount: String(mouths).padStart(2, "0"),
    lungBankTitle: "Lungs",
    foldCountReadout: `${folds} active folds`,
    sourceRackTitle: "Vocal-fold sources",
    routeMatrixTitle: "Route matrix",
    routeCountReadout: `${openPaths} flowing / ${routes} configured`,
    mouthCountReadout: `${mouths} active`,
    mouthRackTitle: "Mouth resonators",
    bodyFoldCount: `${folds} FOLDS / ${throats} SOURCES`,
    bodyRouteCount: `${openPaths} FLOWING / ${routes} CONFIGURED`,
    activePathReadout: `${String(openPaths).padStart(2, "0")} / ${String(routes).padStart(2, "0")}`,
  };
  for (const [id, value] of Object.entries(values)) {
    if ($(id)) $(id).textContent = value;
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

function createSvgElement(name, className, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  if (className) element.setAttribute("class", className);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function graphNodeId(kind, index) {
  return `${kind}-${index + 1}`;
}

function graphNode(kind, index, layout = graphLayout) {
  return layout?.nodes?.[graphNodeId(kind, index)] ?? null;
}

function graphGeometryPath(geometry) {
  return typeof geometry === "string" ? geometry : geometry?.d ?? "";
}

function rebuildGraphLayout(seed = graphLayoutSeed) {
  graphLayoutSeed = Number(seed) >>> 0;
  graphLayout = createColonySyrinxGraphLayout({ seed: graphLayoutSeed });
  renderGraphLayout();
}

function scatterGraphLayout() {
  graphLayoutSeed = hash32(graphLayoutSeed + 0x9e3779b9);
  rebuildGraphLayout(graphLayoutSeed);
  announce(`Organs rearranged; layout seed ${graphLayoutSeed.toString(16).toUpperCase().padStart(8, "0")}`);
}

function buildAnatomyGraph() {
  if (!colonyBody) return;
  lungFeedPaths = Array.from({ length: COLONY_SYRINX_LUNG_COUNT }, (_, index) => {
    const path = createSvgElement("path", "lung-feed-vessel", {
      "data-lung-feed": index + 1,
      "vector-effect": "non-scaling-stroke",
    });
    lungFeedVessels?.append(path);
    return path;
  });
  routeHitPaths = COLONY_SYRINX_TOPOLOGY.routes.map(({ phonatorIndex, mouthIndex }, index) => {
    const path = createSvgElement("path", `vessel-route-hit mouth-${String.fromCharCode(97 + mouthIndex)}`, {
      "data-route-hit": `${phonatorIndex + 1}-${mouthIndex + 1}`,
      "data-route-index": index,
      "vector-effect": "non-scaling-stroke",
    });
    routeHitVessels?.append(path);
    return path;
  });

  lungVessels.forEach((vessel, index) => {
    if (!vessel) return;
    vessel.classList.add("graph-node");
    vessel.dataset.organId = graphNodeId("lung", index);
    vessel.dataset.organKind = "lung";
    vessel.dataset.organIndex = String(index);
    vessel.setAttribute("role", "button");
    vessel.setAttribute("aria-label", `Lung ${index + 1}. Drag its body to move it; drag the colored handle to change bank drive and compliance; double click to disable.`);
    const grab = createSvgElement("circle", "graph-node-grab", { r: 43 });
    vessel.insertBefore(grab, vessel.firstChild);
    vessel.append(createSvgElement("circle", "graph-param-handle lung-shape-handle", {
      r: 7,
      "data-graph-parameter": "lung-shape",
      "data-lung-index": index,
      role: "slider",
      tabindex: 0,
      "aria-label": `Reservoir bank ${Math.floor(index / 4) + 1} drive and compliance`,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
    }));
  });

  sourceVessels.forEach((vessel, index) => {
    if (!vessel) return;
    vessel.classList.add("graph-node");
    vessel.dataset.organId = graphNodeId("source", index);
    vessel.dataset.organKind = "source";
    vessel.dataset.organIndex = String(index);
    vessel.setAttribute("role", "button");
    vessel.setAttribute("aria-label", `Vocal source ${index + 1}. Drag its body to move it; drag either fold handle to change tension and closure; double click to disable.`);
    vessel.insertBefore(createSvgElement("circle", "graph-node-grab", { r: 45 }), vessel.firstChild);
    const port = vessel.querySelector(":scope > circle:not(.graph-node-grab)");
    port?.classList.add("source-port");
    port?.setAttribute("cx", "41");
    port?.setAttribute("cy", "0");
    port?.setAttribute("r", "8");
    port?.setAttribute("data-graph-parameter", "route-source");
    port?.setAttribute("data-source-index", String(index));
    port?.setAttribute("aria-hidden", "true");
    for (let side = 0; side < 2; side += 1) {
      vessel.append(createSvgElement("circle", `graph-param-handle fold-shape-handle side-${side + 1}`, {
        r: 6,
        "data-graph-parameter": "fold-shape",
        "data-source-index": index,
        "data-fold-side": side,
        role: "slider",
        tabindex: 0,
        "aria-label": `Source ${index + 1} fold ${side + 1} tension and closure`,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
      }));
    }
  });

  mouthVessels.forEach((vessel, index) => {
    if (!vessel) return;
    vessel.classList.add("graph-node");
    vessel.dataset.organId = graphNodeId("mouth", index);
    vessel.dataset.organKind = "mouth";
    vessel.dataset.organIndex = String(index);
    vessel.setAttribute("role", "button");
    vessel.setAttribute("aria-label", `Mouth ${index + 1}. Drag its body to move it; drag the jaw and tongue handles to articulate it.`);
    vessel.insertBefore(createSvgElement("ellipse", "graph-node-grab mouth-grab", {
      cx: 132,
      cy: 0,
      rx: 150,
      ry: 64,
    }), vessel.firstChild);
    vessel.append(createSvgElement("circle", "mouth-port", {
      cx: -7,
      cy: 0,
      r: 9,
      "data-mouth-port": index,
      "aria-hidden": "true",
    }));
    vessel.append(createSvgElement("circle", "graph-param-handle jaw-shape-handle", {
      r: 7,
      "data-graph-parameter": "mouth-jaw",
      "data-mouth-index": index,
      role: "slider",
      tabindex: 0,
      "aria-label": `Mouth ${index + 1} jaw opening`,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
    }));
    vessel.append(createSvgElement("circle", "graph-param-handle tongue-shape-handle", {
      r: 7,
      "data-graph-parameter": "mouth-tongue",
      "data-mouth-index": index,
      role: "slider",
      tabindex: 0,
      "aria-label": `Mouth ${index + 1} tongue position and size`,
      "aria-valuemin": 0,
      "aria-valuemax": 100,
    }));
  });
}

function graphMotionLayout(timeSeconds, levels = {}) {
  if (!graphMotionEnabled || graphGesture) return graphLayout;
  const nodes = {};
  for (const [id, node] of Object.entries(graphLayout.nodes)) {
    const index = Number(node.index) || 0;
    let energy = 0;
    if (node.kind === "lung") energy = levels.lungs?.[index] ?? 0;
    else if (node.kind === "source") {
      energy = Math.max(levels.folds?.[index * 2] ?? 0, levels.folds?.[index * 2 + 1] ?? 0);
    } else energy = levels.mouths?.[index] ?? 0;
    const phase = timeSeconds * (0.52 + anatomySeededUnit(index, 0xa739) * 0.81)
      + anatomySeededUnit(index, node.kind === "mouth" ? 0xe2a1 : 0x713b) * Math.PI * 2;
    const amount = 1.2 + energy * (node.kind === "mouth" ? 8 : 5);
    nodes[id] = {
      ...node,
      x: node.x + Math.sin(phase) * amount,
      y: node.y + Math.cos(phase * 0.73) * amount * 0.68,
      rotation: (node.rotation ?? 0) + Math.sin(phase * 0.47) * (0.8 + energy * 2.7),
    };
  }
  return { ...graphLayout, nodes };
}

function renderGraphLayout(levels = {}) {
  if (!colonyBody || !graphLayout?.nodes) return;
  const renderLayout = graphMotionLayout(performance.now() / 1000, levels);
  const foldDisplacements = levels.foldDisplacements ?? [];
  const liveMouthApertures = levels.mouthApertures ?? [];

  lungVessels.forEach((vessel, index) => {
    const node = graphNode("lung", index, renderLayout);
    if (!vessel || !node) return;
    const bank = state.banks[Math.floor(index / 4)];
    const enabled = Boolean(state.lungEnabled[index]);
    const scale = (node.scale ?? 0.62) * (0.86 + bank.compliance * 0.12);
    vessel.setAttribute("transform", `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)}) rotate(${(node.rotation ?? 0).toFixed(2)}) scale(${scale.toFixed(3)})`);
    vessel.dataset.x = graphNode("lung", index)?.x.toFixed(2) ?? node.x.toFixed(2);
    vessel.dataset.y = graphNode("lung", index)?.y.toFixed(2) ?? node.y.toFixed(2);
    vessel.toggleAttribute("hidden", !enabled);
    vessel.setAttribute("tabindex", enabled ? "0" : "-1");
    vessel.setAttribute("aria-disabled", String(!enabled));
    const variant = String.fromCharCode(65 + ((node.variant ?? index) % 4));
    vessel.querySelector("use")?.setAttribute("href", `#colonySac${variant}`);
    const handle = vessel.querySelector(".lung-shape-handle");
    handle?.setAttribute("cx", String(-28 + clamp((bank.compliance - 0.2) / 2.3) * 56));
    handle?.setAttribute("cy", String(31 - clamp(bank.drive / 1.5) * 68));
    handle?.setAttribute("aria-valuenow", String(Math.round(clamp(bank.drive / 1.5) * 100)));
    const bankStart = Math.floor(index / 4) * 4;
    const bankHandleIndex = state.lungEnabled.findIndex((active, candidate) => (
      active && candidate >= bankStart && candidate < bankStart + 4
    ));
    const handlePresent = enabled && index === bankHandleIndex;
    handle?.setAttribute("tabindex", handlePresent ? "0" : "-1");
    handle?.toggleAttribute("hidden", !handlePresent);
  });

  sourceVessels.forEach((vessel, index) => {
    const node = graphNode("source", index, renderLayout);
    if (!vessel || !node) return;
    const enabled = Boolean(state.phonatorEnabled[index]);
    const phonator = state.phonators[index];
    vessel.setAttribute("transform", `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)}) rotate(${(node.rotation ?? 0).toFixed(2)}) scale(${(node.scale ?? 1).toFixed(3)})`);
    vessel.dataset.x = graphNode("source", index)?.x.toFixed(2) ?? node.x.toFixed(2);
    vessel.dataset.y = graphNode("source", index)?.y.toFixed(2) ?? node.y.toFixed(2);
    vessel.toggleAttribute("hidden", !enabled);
    vessel.setAttribute("tabindex", enabled ? "0" : "-1");
    vessel.setAttribute("aria-disabled", String(!enabled));
    const gap = 3.5 + (1 - phonator.closure) * 12;
    const bow = 9 + phonator.tension * 17;
    const skew = phonator.asymmetry * 7;
    const leftDisplacement = clamp(foldDisplacements[index * 2] ?? 0, -1, 1) * 5;
    const rightDisplacement = clamp(foldDisplacements[index * 2 + 1] ?? 0, -1, 1) * 5;
    const left = vessel.querySelector(".fold-left");
    const right = vessel.querySelector(".fold-right");
    left?.setAttribute("d", `M-35 -36 C${(-8 - bow).toFixed(2)} -24 ${(-11 - skew).toFixed(2)} -8 ${(-gap + leftDisplacement).toFixed(2)} 0 C${(-11 - skew).toFixed(2)} 8 ${(-8 - bow).toFixed(2)} 24 -35 36`);
    right?.setAttribute("d", `M35 -36 C${(8 + bow).toFixed(2)} -24 ${(11 - skew).toFixed(2)} -8 ${(gap + rightDisplacement).toFixed(2)} 0 C${(11 - skew).toFixed(2)} 8 ${(8 + bow).toFixed(2)} 24 35 36`);
    const handles = vessel.querySelectorAll(".fold-shape-handle");
    handles[0]?.setAttribute("cx", String(-gap));
    handles[0]?.setAttribute("cy", String(-18 + phonator.tension * 36 + skew));
    handles[1]?.setAttribute("cx", String(gap));
    handles[1]?.setAttribute("cy", String(-18 + phonator.tension * 36 - skew));
    handles.forEach((handle, side) => {
      const foldPresent = enabled && Boolean(state.foldEnabled[index * 2 + side]);
      handle.setAttribute("aria-valuenow", String(Math.round(phonator.tension * 100)));
      handle.setAttribute("tabindex", foldPresent ? "0" : "-1");
      handle.toggleAttribute("hidden", !foldPresent);
    });
  });

  mouthVessels.forEach((vessel, index) => {
    const node = graphNode("mouth", index, renderLayout);
    if (!vessel || !node) return;
    const enabled = Boolean(state.mouthEnabled[index]);
    const mouth = state.mouths[index];
    const live = audioContext?.state === "running" && (transportPlaying || callActive || breathActive);
    const opening = live ? clamp(liveMouthApertures[index] ?? mouth.opening) : mouth.opening;
    const scale = (node.scale ?? 0.9) * (0.78 + mouth.lipSize * 0.24);
    vessel.setAttribute("transform", `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)}) rotate(${(node.rotation ?? 0).toFixed(2)}) scale(${scale.toFixed(3)})`);
    vessel.dataset.x = graphNode("mouth", index)?.x.toFixed(2) ?? node.x.toFixed(2);
    vessel.dataset.y = graphNode("mouth", index)?.y.toFixed(2) ?? node.y.toFixed(2);
    vessel.toggleAttribute("hidden", !enabled);
    vessel.setAttribute("tabindex", enabled ? "0" : "-1");
    vessel.setAttribute("aria-disabled", String(!enabled));
    const jaw = 3 + opening * 24;
    vessel.querySelector(".mouth-upper")?.setAttribute("transform", `translate(0 ${(-jaw * 0.45).toFixed(2)})`);
    vessel.querySelector(".mouth-lower")?.setAttribute("transform", `translate(0 ${(jaw * 0.7).toFixed(2)})`);
    vessel.querySelector(".mouth-teeth")?.setAttribute("transform", `translate(0 ${(jaw * 0.18).toFixed(2)})`);
    vessel.querySelector(".mouth-tongue")?.setAttribute(
      "transform",
      `translate(${((mouth.tonguePosition - 0.5) * 76).toFixed(2)} ${(jaw * 0.42).toFixed(2)}) scale(${(0.68 + mouth.tongueSize * 0.54).toFixed(3)})`,
    );
    const jawHandle = vessel.querySelector(".jaw-shape-handle");
    jawHandle?.setAttribute("cx", String(48 + mouth.lipSize * 38));
    jawHandle?.setAttribute("cy", String(12 + jaw));
    jawHandle?.setAttribute("aria-valuenow", String(Math.round(opening * 100)));
    jawHandle?.setAttribute("tabindex", enabled ? "0" : "-1");
    const tongueHandle = vessel.querySelector(".tongue-shape-handle");
    tongueHandle?.setAttribute("cx", String(82 + mouth.tonguePosition * 116));
    tongueHandle?.setAttribute("cy", String(5 + mouth.tongueSize * 42));
    tongueHandle?.setAttribute("aria-valuenow", String(Math.round(mouth.tonguePosition * 100)));
    tongueHandle?.setAttribute("tabindex", enabled ? "0" : "-1");
  });

  const feedGeometries = colonySyrinxLungFeedGeometries(renderLayout, { state });
  const routeGeometries = colonySyrinxRouteGeometries(renderLayout, { state });
  lungFeedPaths.forEach((path, index) => {
    const sourceIndex = Math.floor(index / 4);
    const present = Boolean(state.lungEnabled[index] && state.phonatorEnabled[sourceIndex]);
    path.toggleAttribute("hidden", !present);
    path.setAttribute("d", graphGeometryPath(feedGeometries[index]));
    const pressure = levels.lungs?.[index] ?? 0;
    path.style.setProperty("--pressure", String(pressure));
    path.classList.toggle("is-pressured", present && pressure > 0.08);
    path.classList.toggle("is-flowing", present && (levels.bankLevels?.[sourceIndex] ?? 0) > 0.02);
  });
  COLONY_SYRINX_TOPOLOGY.routes.forEach(({ phonatorIndex, mouthIndex }, index) => {
    const present = colonySyrinxEndpointEligible(state, phonatorIndex, mouthIndex);
    const geometry = routeGeometries[index];
    const d = graphGeometryPath(geometry);
    routeVessels[index]?.setAttribute("d", d);
    routeVessels[index]?.setAttribute("tabindex", present ? "0" : "-1");
    routeVessels[index]?.setAttribute("aria-disabled", String(!present));
    routeVessels[index]?.toggleAttribute("hidden", !present);
    routeHitPaths[index]?.setAttribute("d", d);
    routeHitPaths[index]?.toggleAttribute("hidden", !present);
  });
}

function svgPointFromEvent(event) {
  const rect = colonyBody?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return { x: 0, y: 0 };
  const matrix = colonyBody.getScreenCTM?.();
  if (matrix && typeof DOMPoint === "function") {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  return {
    x: ((event.clientX - rect.left) / rect.width) * GRAPH_VIEWBOX.width,
    y: ((event.clientY - rect.top) / rect.height) * GRAPH_VIEWBOX.height,
  };
}

function scheduleGraphConfiguration() {
  if (graphConfigurationFrame) return;
  graphConfigurationFrame = requestAnimationFrame(() => {
    graphConfigurationFrame = 0;
    postConfiguration();
  });
}

function graphStateChanged() {
  markStateCustom();
  applyOrganicShapes();
  renderGraphLayout();
  scheduleGraphConfiguration();
}

function updateGraphParameter(gesture, point) {
  const index = gesture.index;
  const node = graphNode(gesture.organKind, index);
  if (!node) return;
  const localX = point.x - node.x;
  const localY = point.y - node.y;
  if (gesture.kind === "lung-shape") {
    const bankIndex = Math.floor(index / 4);
    const banks = state.banks.map((bank, candidate) => candidate === bankIndex ? {
      ...bank,
      compliance: 0.2 + clamp((localX + 45) / 90) * 2.3,
      drive: clamp((45 - localY) / 90) * 1.5,
    } : bank);
    state = sanitizeColonySyrinxState({ ...state, banks }, state);
  } else if (gesture.kind === "fold-shape") {
    const phonators = state.phonators.map((phonator, candidate) => candidate === index ? {
      ...phonator,
      tension: clamp((localY + 36) / 72),
      closure: clamp(1 - ((Math.abs(localX) - 3) / 24)),
    } : phonator);
    state = sanitizeColonySyrinxState({ ...state, phonators }, state);
    setRangeControl(`source${index + 1}Tension`, state.phonators[index].tension, percent);
  } else if (gesture.kind === "mouth-jaw") {
    const mouths = state.mouths.map((mouth, candidate) => candidate === index ? {
      ...mouth,
      opening: clamp((localY - 12) / 36),
      lipSize: clamp((localX - 48) / 38),
    } : mouth);
    state = sanitizeColonySyrinxState({ ...state, mouths }, state);
    setRangeControl(`mouth${index + 1}Aperture`, state.mouths[index].opening, percent);
  } else if (gesture.kind === "mouth-tongue") {
    const mouths = state.mouths.map((mouth, candidate) => candidate === index ? {
      ...mouth,
      tonguePosition: clamp((localX - 82) / 116),
      tongueSize: clamp((localY - 5) / 42),
    } : mouth);
    state = sanitizeColonySyrinxState({ ...state, mouths }, state);
    setRangeControl(`mouth${index + 1}Tongue`, state.mouths[index].tonguePosition, percent);
  }
  graphStateChanged();
}

function routeDraftPath(sourceIndex, point) {
  const source = graphNode("source", sourceIndex);
  if (!source) return "";
  const start = { x: source.x + 41, y: source.y };
  const span = Math.max(45, Math.abs(point.x - start.x) * 0.46);
  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} C${(start.x + span).toFixed(2)} ${start.y.toFixed(2)} ${(point.x - span).toFixed(2)} ${point.y.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function beginGraphGesture(event) {
  if (!colonyBody || event.button !== 0) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const point = svgPointFromEvent(event);
  const routeHit = target.closest("[data-route-hit]");
  const sourcePort = target.closest(".source-port[data-source-index]");
  const parameter = target.closest("[data-graph-parameter]");
  const nodeElement = target.closest(".graph-node[data-organ-id]");
  const background = target.closest("[data-graph-background]");
  let gesture = null;

  if (routeHit) {
    const index = Number(routeHit.dataset.routeIndex);
    const { phonatorIndex, mouthIndex } = COLONY_SYRINX_TOPOLOGY.routes[index] ?? {};
    if (!colonySyrinxEndpointEligible(state, phonatorIndex, mouthIndex)) return;
    const kind = event.shiftKey ? "alternate" : "primary";
    const matrix = kind === "alternate" ? state.alternateRoutes : state.routes;
    const source = graphNode("source", phonatorIndex);
    const mouth = graphNode("mouth", mouthIndex);
    const dx = (mouth?.x ?? point.x + 1) - (source?.x ?? point.x);
    const dy = (mouth?.y ?? point.y) - (source?.y ?? point.y);
    const length = Math.max(1, Math.hypot(dx, dy));
    gesture = {
      kind: "route-aperture",
      index,
      routeKind: kind,
      start: point,
      startAperture: routeValue(matrix, index),
      perpendicular: { x: -dy / length, y: dx / length },
      moved: false,
    };
  } else if (sourcePort) {
    gesture = {
      kind: "route-draw",
      index: Number(sourcePort.dataset.sourceIndex),
      routeKind: event.shiftKey ? "alternate" : "primary",
      start: point,
      moved: false,
    };
    routeDraft?.removeAttribute("hidden");
    routeDraft?.setAttribute("d", routeDraftPath(gesture.index, point));
    colonyBody.classList.add("is-routing");
  } else if (parameter) {
    const kind = parameter.dataset.graphParameter;
    if (kind === "lung-shape") {
      gesture = { kind, organKind: "lung", index: Number(parameter.dataset.lungIndex), start: point };
    } else if (kind === "fold-shape") {
      gesture = { kind, organKind: "source", index: Number(parameter.dataset.sourceIndex), start: point };
    } else if (kind === "mouth-jaw" || kind === "mouth-tongue") {
      gesture = { kind, organKind: "mouth", index: Number(parameter.dataset.mouthIndex), start: point };
    }
  } else if (nodeElement) {
    gesture = {
      kind: "move-node",
      id: nodeElement.dataset.organId,
      organKind: nodeElement.dataset.organKind,
      index: Number(nodeElement.dataset.organIndex),
      start: point,
      moved: false,
    };
    nodeElement.classList.add("is-graph-dragging");
  } else if (background) {
    gesture = { kind: "breath", start: point, moved: false };
    const amount = clamp(1 - point.y / GRAPH_VIEWBOX.height);
    beginBreath(amount, () => graphGesture?.kind === "breath");
  }
  if (!gesture) return;
  event.preventDefault();
  event.stopPropagation();
  graphGesture = { ...gesture, pointerId: event.pointerId, target };
  colonyBody.setPointerCapture?.(event.pointerId);
}

function moveGraphGesture(event) {
  if (!graphGesture || event.pointerId !== graphGesture.pointerId) return;
  const point = svgPointFromEvent(event);
  const distance = Math.hypot(point.x - graphGesture.start.x, point.y - graphGesture.start.y);
  graphGesture.moved ||= distance > 5;
  if (graphGesture.kind === "move-node") {
    graphLayout = moveColonySyrinxGraphNode(graphLayout, graphGesture.id, point);
    renderGraphLayout();
  } else if (["lung-shape", "fold-shape", "mouth-jaw", "mouth-tongue"].includes(graphGesture.kind)) {
    updateGraphParameter(graphGesture, point);
  } else if (graphGesture.kind === "route-draw") {
    routeDraft?.setAttribute("d", routeDraftPath(graphGesture.index, point));
    mouthVessels.forEach((mouth, index) => {
      const node = graphNode("mouth", index);
      mouth?.classList.toggle(
        "is-route-target",
        Boolean(state.mouthEnabled[index] && node && Math.hypot(point.x - node.x, point.y - node.y) < 78),
      );
    });
  } else if (graphGesture.kind === "route-aperture") {
    const deltaX = point.x - graphGesture.start.x;
    const deltaY = point.y - graphGesture.start.y;
    const delta = deltaX * graphGesture.perpendicular.x + deltaY * graphGesture.perpendicular.y;
    const aperture = clamp(graphGesture.startAperture - delta / 115);
    setManualRoute(graphGesture.index, aperture, graphGesture.routeKind);
  } else if (graphGesture.kind === "breath") {
    setBreath(true, clamp(1 - point.y / GRAPH_VIEWBOX.height));
  }
  event.preventDefault();
}

function nearestMouthForPoint(point) {
  let result = null;
  mouthVessels.forEach((__, index) => {
    if (!state.mouthEnabled[index]) return;
    const node = graphNode("mouth", index);
    if (!node) return;
    const distance = Math.hypot(point.x - node.x, point.y - node.y);
    if (distance <= 82 && (!result || distance < result.distance)) result = { index, distance };
  });
  return result?.index ?? -1;
}

function cancelGraphGesture({ releaseBreath = true } = {}) {
  if (!graphGesture) return;
  graphGesture.target?.closest?.(".graph-node")?.classList.remove("is-graph-dragging");
  mouthVessels.forEach((mouth) => mouth?.classList.remove("is-route-target"));
  colonyBody?.classList.remove("is-routing");
  routeDraft?.setAttribute("hidden", "");
  routeDraft?.setAttribute("d", "");
  if (releaseBreath && graphGesture.kind === "breath") setBreath(false);
  graphGesture = null;
}

function endGraphGesture(event) {
  if (!graphGesture || event.pointerId !== graphGesture.pointerId) return;
  const gesture = graphGesture;
  const point = svgPointFromEvent(event);
  if (gesture.kind === "route-draw") {
    const mouthIndex = nearestMouthForPoint(point);
    if (mouthIndex >= 0) {
      const routeIndex = COLONY_SYRINX_TOPOLOGY.routes.findIndex((route) => (
        route.phonatorIndex === gesture.index && route.mouthIndex === mouthIndex
      ));
      if (routeIndex >= 0) {
        const matrix = gesture.routeKind === "alternate" ? state.alternateRoutes : state.routes;
        const next = routeValue(matrix, routeIndex) > 0.02 ? 0 : 1;
        setManualRoute(routeIndex, next, gesture.routeKind);
        announce(`${gesture.routeKind} source ${gesture.index + 1} to mouth ${mouthIndex + 1} route ${next ? "opened" : "closed"}`);
      }
    } else {
      announce("Route not changed; release on an active mouth port");
    }
  } else if (gesture.kind === "route-aperture" && !gesture.moved) {
    const matrix = gesture.routeKind === "alternate" ? state.alternateRoutes : state.routes;
    setManualRoute(gesture.index, routeValue(matrix, gesture.index) > 0.02 ? 0 : 1, gesture.routeKind);
  } else if (gesture.kind === "move-node" && gesture.moved) {
    announce(`${gesture.organKind} ${gesture.index + 1} moved`);
  } else if (["lung-shape", "fold-shape", "mouth-jaw", "mouth-tongue"].includes(gesture.kind)) {
    syncControlsFromState();
    announce("Organ shape updated");
  }
  cancelGraphGesture();
  event.preventDefault();
}

function moveFocusedGraphNode(element, key, amount) {
  const id = element.dataset.organId;
  const node = graphLayout.nodes[id];
  if (!node) return;
  const delta = {
    ArrowLeft: { x: -amount, y: 0 },
    ArrowRight: { x: amount, y: 0 },
    ArrowUp: { x: 0, y: -amount },
    ArrowDown: { x: 0, y: amount },
  }[key];
  if (!delta) return;
  graphLayout = moveColonySyrinxGraphNode(graphLayout, id, {
    x: node.x + delta.x,
    y: node.y + delta.y,
  });
  renderGraphLayout();
  announce(`${element.dataset.organKind} ${Number(element.dataset.organIndex) + 1} moved`);
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
  foldMeters.forEach((meter, index) => {
    const present = Boolean(
      state.foldEnabled[index] && state.phonatorEnabled[Math.floor(index / 2)],
    );
    meter.classList.toggle("is-absent", !present);
    meter.setAttribute("aria-hidden", String(!present));
    foldVessels[index]?.classList.toggle("is-absent", !present);
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
  renderGraphLayout();
}

function updateMediumPresentation() {
  const value = $("mediumSelect")?.value ?? "air";
  const material = value === "air" ? "AIR" : value === "hydraulic" ? "WATER" : "PELLETS";
  if ($("engineStatus")) $("engineStatus").textContent = material;
  if ($("engineTitle")) {
    $("engineTitle").textContent = `MULTI-SOURCE VOCAL NETWORK / ${material}`;
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
  if ($("foldCount")) {
    $("foldCount").max = String(state.phonatorEnabled.filter(Boolean).length * 2);
  }
  setRangeControl("foldCount", state.foldEnabled.filter((enabled, index) => (
    enabled && state.phonatorEnabled[Math.floor(index / 2)]
  )).length, (value) => String(Math.round(value)));
  setRangeControl("mouthCount", state.mouthEnabled.filter(Boolean).length, (value) => String(Math.round(value)));
  const possible = state.phonatorEnabled.filter(Boolean).length
    * state.mouthEnabled.filter(Boolean).length;
  if ($("routeCount")) $("routeCount").max = String(possible);
  setRangeControl("routeCount", activeRouteIndices().length, (value) => String(Math.round(value)));
  setRangeControl(
    "contourCount",
    state.contours.filter((contour) => !contour.muted).length,
    (value) => String(Math.round(value)),
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

function generateRouteMaps(requestedCount) {
  const active = COLONY_SYRINX_TOPOLOGY.routes.filter(({ phonatorIndex, mouthIndex }) => (
    state.phonatorEnabled[phonatorIndex] && state.mouthEnabled[mouthIndex]
  ));
  const ranked = active.slice().sort((left, right) => (
    seededUnit(left.index, 0x31d7) - seededUnit(right.index, 0x31d7)
  ));
  const target = Math.round(clamp(requestedCount, 0, active.length));
  const selected = ranked.slice(0, target);
  const directSource = directlyDrivenPhonator();
  if (target > 0
    && directSource >= 0
    && !selected.some(({ phonatorIndex }) => phonatorIndex === directSource)) {
    const directRoute = ranked.find(({ phonatorIndex }) => phonatorIndex === directSource);
    if (directRoute) selected[selected.length - 1] = directRoute;
  }
  const chosen = new Set(selected.map(({ index }) => index));
  const primary = Array.from({ length: COLONY_SYRINX_PHONATOR_COUNT }, () => (
    Array(COLONY_SYRINX_MOUTH_COUNT).fill(0)
  ));
  const alternate = primary.map((row) => row.slice());
  for (const route of active) {
    if (!chosen.has(route.index)) continue;
    primary[route.phonatorIndex][route.mouthIndex] = 0.28
      + seededUnit(route.index, 0x58f1) * 0.72;
    alternate[route.phonatorIndex][route.mouthIndex] = 0.28
      + seededUnit(route.index, 0xc8a5) * 0.72;
  }
  return { routes: primary, alternateRoutes: alternate };
}

function contourMaskForCount(requestedCount) {
  const target = Math.round(clamp(requestedCount, 1, COLONY_SYRINX_LANE_COUNT));
  const selected = new Set([0]);
  const ranking = Array.from(
    { length: COLONY_SYRINX_LANE_COUNT - 1 },
    (_, index) => index + 1,
  ).sort((left, right) => seededUnit(left, 0xc017) - seededUnit(right, 0xc017));
  ranking.slice(0, target - 1).forEach((index) => selected.add(index));
  return state.contours.map((contour, index) => ({ ...contour, muted: !selected.has(index) }));
}

function setOrganCount(kind, count) {
  const requestedRoutes = activeRouteIndices().length;
  const patch = {};
  if (kind === "lungs") {
    patch.lungEnabled = rankedMask(COLONY_SYRINX_LUNG_COUNT, count, 0x10a7);
  } else if (kind === "phonators") {
    patch.phonatorEnabled = rankedMask(COLONY_SYRINX_PHONATOR_COUNT, count, 0x42bf);
    patch.foldEnabled = foldMaskForPhonators(
      state.foldEnabled.filter((enabled, index) => (
        enabled && state.phonatorEnabled[Math.floor(index / 2)]
      )).length,
      patch.phonatorEnabled,
    );
  } else if (kind === "folds") {
    patch.foldEnabled = foldMaskForPhonators(count);
  } else {
    patch.mouthEnabled = rankedMask(COLONY_SYRINX_MOUTH_COUNT, count, 0x93d1);
  }
  state = repairDirectPressurePath(sanitizeColonySyrinxState({ ...state, ...patch }, state));
  state = sanitizeColonySyrinxState({
    ...state,
    ...generateRouteMaps(requestedRoutes),
  }, state);
  syncControlsFromState();
  postConfiguration();
  markStateCustom();
  announce("Anatomy counts updated");
}

function setRouteCount(count) {
  state = sanitizeColonySyrinxState({
    ...state,
    ...generateRouteMaps(count),
  }, state);
  syncControlsFromState();
  postConfiguration();
  markStateCustom();
}

function setContourCount(count) {
  state = sanitizeColonySyrinxState({ ...state, contours: contourMaskForCount(count) }, state);
  syncControlsFromState();
  postConfiguration();
  markStateCustom();
}

function mutateCreature(scope) {
  const nextSeed = (state.seed + 0x9e3779b9) >>> 0;
  state = randomizeColonySyrinxState(state, { scope, seed: nextSeed });
  state = sanitizeColonySyrinxState({
    ...state,
    contourDurationSeconds: clamp(state.contourDurationSeconds, 1, 40),
    valveSlewMs: clamp(state.valveSlewMs, 1, 180),
    contours: state.contours.map((contour) => ({
      ...contour,
      rate: clamp(contour.rate, 0.25, 4),
    })),
  }, state);
  if (scope === "anatomy" || scope === "all") {
    anatomyShapeSeed = state.seed;
    rebuildGraphLayout(anatomyShapeSeed);
  }
  if (scope === "motion" || scope === "all") {
    const count = 1 + Math.floor(seededUnit(0, 0xc017) * COLONY_SYRINX_LANE_COUNT);
    state = sanitizeColonySyrinxState({ ...state, contours: contourMaskForCount(count) }, state);
  }
  heldRoutes.clear();
  deferredRouteReleases.clear();
  syncControlsFromState();
  postConfiguration();
  selectedCallId = null;
  updateCallPresentation();
  announce(`Settings randomized; seed ${(state.seed >>> 0).toString(16).toUpperCase().padStart(8, "0")}`);
}

function selectedCallRecipe() {
  return COLONY_SYRINX_CALLS.find(({ id }) => id === selectedCallId) ?? null;
}

function activeCallRecipe() {
  return COLONY_SYRINX_CALLS.find(({ id }) => id === activeCallId) ?? null;
}

function markStateCustom() {
  if (selectedCallId == null) return;
  selectedCallId = null;
  updateCallPresentation();
}

function updateCallPresentation() {
  const recipe = selectedCallRecipe();
  document.querySelectorAll("[data-call-id]").forEach((button) => {
    const selected = button.dataset.callId === selectedCallId;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("is-playing", button.dataset.callId === activeCallId && callActive);
  });
  if ($("selectedCallReadout")) {
    const activeRecipe = activeCallRecipe();
    const counts = recipe?.counts ?? {
      lungs: state.lungEnabled.filter(Boolean).length,
      phonators: state.phonatorEnabled.filter(Boolean).length,
      folds: state.foldEnabled.filter((enabled, index) => (
        enabled && state.phonatorEnabled[Math.floor(index / 2)]
      )).length,
      mouths: state.mouthEnabled.filter(Boolean).length,
      routes: activeRouteIndices().length,
    };
    const durationSeconds = recipe?.durationSeconds
      ?? activeRecipe?.durationSeconds
      ?? state.contourDurationSeconds;
    $("selectedCallReadout").textContent = `${recipe?.label ?? "Custom settings"} · ${durationSeconds.toFixed(1)} s · ${counts.lungs} lungs · ${counts.phonators} sources · ${counts.folds} folds · ${counts.mouths} mouths · ${counts.routes} routes`;
  }
}

function buildCallBank() {
  const bank = $("callBank");
  if (!bank) return;
  bank.replaceChildren();
  for (const recipe of COLONY_SYRINX_CALLS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "call-preset-button";
    button.dataset.callId = recipe.id;
    const pieces = recipe.label.split(" / ");
    const material = document.createElement("span");
    material.textContent = pieces.shift() ?? recipe.mediumId;
    const label = document.createElement("b");
    label.textContent = pieces.join(" / ");
    const detail = document.createElement("small");
    detail.textContent = `${recipe.durationSeconds.toFixed(1)} s · ${recipe.counts.lungs} lungs · ${recipe.counts.phonators} sources · ${recipe.counts.folds} folds · ${recipe.counts.mouths} mouths · ${recipe.counts.routes} routes`;
    button.setAttribute("aria-label", `${recipe.label}; ${detail.textContent}`);
    button.append(material, label, detail);
    button.addEventListener("click", () => playShortCall(recipe.id));
    bank.append(button);
  }
  updateCallPresentation();
}

function setPlaybackPresentation() {
  const button = $("playButton");
  button?.setAttribute("aria-pressed", String(transportPlaying && !callActive));
  button?.classList.toggle("is-playing", transportPlaying && !callActive);
  if ($("playState")) $("playState").textContent = callActive
    ? "short call active"
    : transportPlaying ? "continuous modulation active" : "continuous modulation paused";
  $("colonySyrinx")?.classList.toggle("is-running", transportPlaying);
  updateCallPresentation();
}

function finishShortCall({ announceState = true, callToken = null } = {}) {
  if (activeCallToken != null && callToken !== activeCallToken) return;
  if (!callActive) return;
  callActive = false;
  transportPlaying = false;
  activeCallId = null;
  activeCallToken = null;
  setPlaybackPresentation();
  syncBreathPresentation();
  postBreath();
  if ($("statusText")) $("statusText").textContent = "Short call complete.";
  if (announceState) announce("Short call complete");
}

async function playShortCall(id) {
  const recipe = COLONY_SYRINX_CALLS.find((candidate) => candidate.id === id);
  if (!recipe || !(await ensureAudio())) return;
  selectedCallId = recipe.id;
  state = createColonySyrinxCallState(recipe.id);
  anatomyShapeSeed = state.seed;
  rebuildGraphLayout(anatomyShapeSeed);
  heldRoutes.clear();
  deferredRouteReleases.clear();
  callActive = true;
  transportPlaying = true;
  activeCallId = recipe.id;
  activeCallToken = ++nextCallToken;
  syncControlsFromState();
  setPlaybackPresentation();
  postConfiguration();
  syncBreathPresentation();
  postBreath();
  graph?.sourceNode?.port.postMessage({
    type: "call",
    playing: true,
    reset: true,
    durationSeconds: recipe.durationSeconds,
    callId: recipe.id,
    callToken: activeCallToken,
  });
  if ($("statusText")) $("statusText").textContent = "Short call active.";
  announce(`${recipe.label}; ${recipe.durationSeconds.toFixed(1)} seconds`);
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
  markStateCustom();
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
    mute.textContent = contour.muted ? "MUTED" : "ENABLED";
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
    title.textContent = meta.label;
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
    field.setAttribute("aria-label", `${meta.label} closed modulation contour`);
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
    ? transportPlaying && !manualBreathingNow()
      ? callActive ? "short call pressure" : "automatic pressure"
      : "manual pressure"
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
    else if (data?.type === "call-ended") finishShortCall({ callToken: data.callToken });
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
    if (!callActive) {
      graph.sourceNode.port.postMessage({ type: "transport", playing: transportPlaying });
    }
    setAudioPresentation(true);
    if ($("statusText")) $("statusText").textContent = transportPlaying
      ? callActive ? "Short call active." : "Continuous flow active."
      : "Audio on. Select a short call, start continuous flow, or add manual pressure.";
    return true;
  } catch (error) {
    console.error(error);
    setAudioPresentation(false, error?.message || "The browser blocked audio startup.");
    return false;
  }
}

async function toggleAudio() {
  if (audioContext?.state === "running") {
    if (transportPlaying) setTransport(false);
    setBreath(false);
    graph.sourceNode.port.postMessage({ type: "panic" });
    await audioContext.suspend();
    setAudioPresentation(false);
    if ($("statusText")) $("statusText").textContent = "Audio off. Controls remain editable.";
    announce("Colony Syrinx audio off");
    return;
  }
  if (await ensureAudio()) {
    announce("Colony Syrinx audio on");
  }
}

function setTransport(playing, { reset = false } = {}) {
  callActive = false;
  activeCallId = null;
  activeCallToken = null;
  transportPlaying = Boolean(playing);
  setPlaybackPresentation();
  graph?.sourceNode?.port.postMessage({ type: "transport", playing: transportPlaying, reset });
  postConfiguration();
  syncBreathPresentation();
  postBreath();
  if ($("statusText")) $("statusText").textContent = transportPlaying
    ? "Continuous flow active."
    : "Continuous flow paused. Manual pressure remains available.";
  announce(transportPlaying ? "Continuous flow active" : "Continuous flow paused");
}

async function toggleTransport() {
  if (!(await ensureAudio())) return;
  if (callActive) {
    setTransport(true, { reset: true });
    return;
  }
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
  const configured = Math.max(primary, alternate, held) > 0.02;
  for (const element of [vessel, routeHitPaths[index]]) {
    if (!element) continue;
    element.dataset.primaryOpen = String(primary > 0.02);
    element.dataset.alternateOpen = String(alternate > 0.02);
    element.dataset.eligible = String(present);
    element.style.setProperty("--aperture", String(Math.max(primary, alternate, held)));
  }
  vessel?.setAttribute("aria-pressed", String(configured));
  vessel?.setAttribute("aria-disabled", String(!present));
  vessel?.setAttribute("tabindex", present ? "0" : "-1");
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
  markStateCustom();
  renderRouteBase(index);
  updateCountPresentation();
  setRangeControl("routeCount", activeRouteIndices().length, (value) => String(Math.round(value)));
  if (graphGesture?.kind === "route-aperture") scheduleGraphConfiguration();
  else postConfiguration();
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
  markStateCustom();
  sustainActive = false;
  setBreath(false);
  routeButtons.forEach((__, index) => renderRouteBase(index));
  updateCountPresentation();
  graph?.sourceNode?.port.postMessage({ type: "panic" });
  postConfiguration();
  setRangeControl("routeCount", 0, (value) => String(Math.round(value)));
  if (announceState) announce("Routes closed; pressure released");
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
  if (event.defaultPrevented || event.repeat || isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "escape" && graphGesture) {
    event.preventDefault();
    cancelGraphGesture();
    announce("Graph gesture canceled");
    return;
  }
  if (event.target instanceof Element && event.target.closest(".graph-node, .vessel-route, .graph-tools")) return;
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

function toggleLung(index) {
  if (state.lungEnabled[index] && state.lungEnabled.filter(Boolean).length <= 1) {
    announce("At least one lung is required");
    return;
  }
  const lungEnabled = state.lungEnabled.slice();
  lungEnabled[index] = !lungEnabled[index];
  state = repairDirectPressurePath(sanitizeColonySyrinxState({ ...state, lungEnabled }, state));
  syncControlsFromState();
  postConfiguration();
  markStateCustom();
  announce(`Lung ${index + 1} ${state.lungEnabled[index] ? "enabled" : "disabled"}`);
}

function toggleSource(index) {
  const activeSources = state.phonatorEnabled.filter(Boolean).length;
  if (state.phonatorEnabled[index] && activeSources <= 1) {
    announce("At least one vocal source is required");
    return;
  }
  const requestedRoutes = activeRouteIndices().length;
  const requestedFolds = state.foldEnabled.filter((enabled, foldIndex) => (
    enabled && state.phonatorEnabled[Math.floor(foldIndex / 2)]
  )).length;
  const phonatorEnabled = state.phonatorEnabled.slice();
  phonatorEnabled[index] = !phonatorEnabled[index];
  state = repairDirectPressurePath(sanitizeColonySyrinxState({
    ...state,
    phonatorEnabled,
    foldEnabled: foldMaskForPhonators(requestedFolds, phonatorEnabled),
  }, state));
  state = sanitizeColonySyrinxState({
    ...state,
    ...generateRouteMaps(requestedRoutes),
  }, state);
  syncControlsFromState();
  postConfiguration();
  markStateCustom();
  announce(`Vocal source ${index + 1} ${state.phonatorEnabled[index] ? "enabled" : "disabled"}`);
}

function toggleMouth(index) {
  if (state.mouthEnabled[index] && state.mouthEnabled.filter(Boolean).length <= 1) {
    announce("At least one mouth is required");
    return;
  }
  const mouthEnabled = state.mouthEnabled.slice();
  mouthEnabled[index] = !mouthEnabled[index];
  state = sanitizeColonySyrinxState({ ...state, mouthEnabled }, state);
  syncControlsFromState();
  postConfiguration();
  markStateCustom();
  announce(`Mouth ${index + 1} ${state.mouthEnabled[index] ? "enabled" : "disabled"}`);
}

function nudgeGraphParameter(handle, direction, large = false) {
  const amount = (large ? 0.12 : 0.035) * direction;
  const kind = handle.dataset.graphParameter;
  if (kind === "lung-shape") {
    const index = Number(handle.dataset.lungIndex);
    const bankIndex = Math.floor(index / 4);
    const banks = state.banks.map((bank, candidate) => candidate === bankIndex ? {
      ...bank,
      drive: clamp(bank.drive + amount * 1.5, 0, 1.5),
    } : bank);
    state = sanitizeColonySyrinxState({ ...state, banks }, state);
  } else if (kind === "fold-shape") {
    const index = Number(handle.dataset.sourceIndex);
    const phonators = state.phonators.map((phonator, candidate) => candidate === index ? {
      ...phonator,
      tension: clamp(phonator.tension + amount),
    } : phonator);
    state = sanitizeColonySyrinxState({ ...state, phonators }, state);
    setRangeControl(`source${index + 1}Tension`, state.phonators[index].tension, percent);
  } else if (kind === "mouth-jaw") {
    const index = Number(handle.dataset.mouthIndex);
    const mouths = state.mouths.map((mouth, candidate) => candidate === index ? {
      ...mouth,
      opening: clamp(mouth.opening + amount),
    } : mouth);
    state = sanitizeColonySyrinxState({ ...state, mouths }, state);
    setRangeControl(`mouth${index + 1}Aperture`, state.mouths[index].opening, percent);
  } else if (kind === "mouth-tongue") {
    const index = Number(handle.dataset.mouthIndex);
    const mouths = state.mouths.map((mouth, candidate) => candidate === index ? {
      ...mouth,
      tonguePosition: clamp(mouth.tonguePosition + amount),
    } : mouth);
    state = sanitizeColonySyrinxState({ ...state, mouths }, state);
    setRangeControl(`mouth${index + 1}Tongue`, state.mouths[index].tonguePosition, percent);
  } else return;
  graphStateChanged();
}

function handleGraphKeyDown(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const parameter = target.closest(".graph-param-handle");
  if (parameter && ["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    nudgeGraphParameter(parameter, ["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1, event.shiftKey);
    return;
  }
  const node = target.closest(".graph-node[data-organ-kind]");
  if (!node || parameter) return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    moveFocusedGraphNode(node, event.key, event.shiftKey ? 22 : 7);
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  const index = Number(node.dataset.organIndex);
  if (node.dataset.organKind === "lung") toggleLung(index);
  else if (node.dataset.organKind === "source") toggleSource(index);
  else if (node.dataset.organKind === "mouth") toggleMouth(index);
}

function bindControls() {
  $("audioButton")?.addEventListener("click", toggleAudio);
  $("playButton")?.addEventListener("click", toggleTransport);
  $("panicButton")?.addEventListener("click", () => panic());
  $("randomizeGraphButton")?.addEventListener("click", () => mutateCreature("all"));
  $("scatterGraphButton")?.addEventListener("click", scatterGraphLayout);
  $("resetGraphButton")?.addEventListener("click", () => {
    rebuildGraphLayout(anatomyShapeSeed);
    announce("Organ arrangement reset");
  });
  $("graphMotionButton")?.addEventListener("click", () => {
    graphMotionEnabled = !graphMotionEnabled;
    $("graphMotionButton")?.setAttribute("aria-pressed", String(graphMotionEnabled));
    colonyBody?.classList.toggle("graph-motion-off", !graphMotionEnabled);
    renderGraphLayout();
    announce(`Live organ motion ${graphMotionEnabled ? "enabled" : "disabled"}`);
  });
  colonyBody?.addEventListener("pointerdown", beginGraphGesture);
  colonyBody?.addEventListener("pointermove", moveGraphGesture);
  colonyBody?.addEventListener("pointerup", endGraphGesture);
  colonyBody?.addEventListener("pointercancel", () => cancelGraphGesture());
  colonyBody?.addEventListener("lostpointercapture", () => cancelGraphGesture());
  colonyBody?.addEventListener("keydown", handleGraphKeyDown);
  colonyBody?.addEventListener("dblclick", (event) => {
    const node = event.target instanceof Element ? event.target.closest(".graph-node[data-organ-kind]") : null;
    if (!node || event.target.closest(".graph-param-handle, .source-port")) return;
    event.preventDefault();
    const index = Number(node.dataset.organIndex);
    if (node.dataset.organKind === "lung") toggleLung(index);
    else if (node.dataset.organKind === "source") toggleSource(index);
    else if (node.dataset.organKind === "mouth") toggleMouth(index);
  });

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
    button.addEventListener("click", () => toggleLung(index));
  });

  sourceCards.forEach((card, index) => {
    const enable = $( `source${index + 1}Enable`);
    enable?.addEventListener("click", () => toggleSource(index));
    bindRange(`source${index + 1}Tension`, percent, (value) => {
      const phonators = state.phonators.map((phonator, phonatorIndex) => (
        phonatorIndex === index ? { ...phonator, tension: value } : phonator
      ));
      state = sanitizeColonySyrinxState({ ...state, phonators }, state);
      markStateCustom();
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
      event.stopPropagation();
      const kind = event.shiftKey ? "alternate" : "primary";
      const matrix = kind === "alternate" ? state.alternateRoutes : state.routes;
      setManualRoute(index, routeValue(matrix, index) > 0.02 ? 0 : 1, kind);
    });
    vessel.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
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
      markStateCustom();
      postConfiguration();
    });
    bindRange(`mouth${index + 1}Tongue`, percent, (value) => {
      const mouths = state.mouths.map((mouth, mouthIndex) => (
        mouthIndex === index ? { ...mouth, tonguePosition: value } : mouth
      ));
      state = sanitizeColonySyrinxState({ ...state, mouths }, state);
      markStateCustom();
      applyOrganicShapes();
      postConfiguration();
    });
    card.style.setProperty("--mouth-index", String(index));
  });

  bindRange("level", percent, (value) => {
    state = sanitizeColonySyrinxState({ ...state, level: value }, state);
    markStateCustom();
    postConfiguration();
  });
  bindRange("lungPressure", percent, (value) => {
    state = sanitizeColonySyrinxState({
      ...state,
      breath: value,
      breathRateBpm: 4 + value * 68,
      pressureGain: 0.48 + value * 1.72,
    }, state);
    markStateCustom();
    postConfiguration();
    postBreath();
  });
  bindRange("tempo", (value) => `${value.toFixed(1)} s`, (value) => {
    state = sanitizeColonySyrinxState({ ...state, contourDurationSeconds: value }, state);
    markStateCustom();
    if ($("clockReadout")) $("clockReadout").textContent = `${value.toFixed(1)} S`;
    postConfiguration();
  });
  bindRange("swing", percent, (value) => {
    const contours = state.contours.map((contour) => ({ ...contour, depth: value }));
    state = sanitizeColonySyrinxState({ ...state, contours }, state);
    markStateCustom();
    renderAllContours();
    postConfiguration();
  });
  bindRange("coupling", percent, (value) => {
    state = sanitizeColonySyrinxState({ ...state, crossCoupling: value }, state);
    markStateCustom();
    postConfiguration();
  });
  bindRange("valveSlew", (value) => `${Math.round(value)} ms`, (value) => {
    state = sanitizeColonySyrinxState({ ...state, valveSlewMs: value }, state);
    markStateCustom();
    postConfiguration();
  });
  bindRange("reservoirLoss", percent, (value) => {
    state = sanitizeColonySyrinxState({ ...state, leak: value }, state);
    markStateCustom();
    postConfiguration();
  });

  bindRange("lungCount", (value) => String(Math.round(value)), (value) => {
    if (Math.round(value) !== state.lungEnabled.filter(Boolean).length) setOrganCount("lungs", value);
  });
  bindRange("throatCount", (value) => String(Math.round(value)), (value) => {
    if (Math.round(value) !== state.phonatorEnabled.filter(Boolean).length) setOrganCount("phonators", value);
  });
  bindRange("foldCount", (value) => String(Math.round(value)), (value) => {
    const actual = state.foldEnabled.filter((enabled, index) => (
      enabled && state.phonatorEnabled[Math.floor(index / 2)]
    )).length;
    if (Math.round(value) !== actual) setOrganCount("folds", value);
  });
  bindRange("mouthCount", (value) => String(Math.round(value)), (value) => {
    if (Math.round(value) !== state.mouthEnabled.filter(Boolean).length) setOrganCount("mouths", value);
  });
  bindRange("routeCount", (value) => String(Math.round(value)), (value) => {
    if (Math.round(value) !== activeRouteIndices().length) setRouteCount(value);
  });
  bindRange("contourCount", (value) => String(Math.round(value)), (value) => {
    const actual = state.contours.filter((contour) => !contour.muted).length;
    if (Math.round(value) !== actual) setContourCount(value);
  });

  $("mediumSelect")?.addEventListener("change", () => {
    const value = $("mediumSelect").value;
    state = sanitizeColonySyrinxState({
      ...state,
      mediumId: value === "hydraulic" ? "water" : value === "granular" ? "pellets" : "air",
    }, state);
    markStateCustom();
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
    markStateCustom();
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

function safeSignedVector(value, length, maximum = 1) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : [];
  return Array.from({ length }, (_, index) => clamp(source[index] ?? 0, -maximum, maximum));
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
  const foldDisplacements = safeSignedVector(telemetry.foldDisplacements, 8);
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
  const mouthApertures = safeVector(telemetry.mouthApertures, COLONY_SYRINX_MOUTH_COUNT);
  const mouths = mouthPressures.map(normalizePressure);
  const bankLevels = safeVector(telemetry.bankLevels ?? telemetry.exhales, 4);
  const contourPhase = wrapUnit(telemetry.contourPhase ?? 0);
  const callProgress = clamp(telemetry.callProgress ?? 0);
  const contourValues = safeVector(telemetry.contourValues, COLONY_SYRINX_LANE_COUNT);
  const lanePhases = safeVector(telemetry.lanePhases, COLONY_SYRINX_LANE_COUNT);
  if (transportPlaying && !manualBreathingNow() && $("breathReadout")) {
    $("breathReadout").textContent = `${callActive ? "call" : "automatic"} pressure · ${String(Math.round(contourPhase * 360)).padStart(3, "0")}°`;
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
    const configuredFoldCount = state.foldEnabled
      .slice(index * 2, index * 2 + 2)
      .filter(Boolean).length;
    const activeFoldFrequencies = [first, second].filter((value) => value > 0);
    const frequency = sourceFrequencies[index] > 0
      ? sourceFrequencies[index]
      : activeFoldFrequencies.length
        ? activeFoldFrequencies.reduce((sum, value) => sum + value, 0) / activeFoldFrequencies.length
        : fallback;
    if ($( `source${index + 1}Frequency`)) {
      $( `source${index + 1}Frequency`).textContent = !present
        ? "ABSENT"
        : configuredFoldCount === 0 ? "UNVOICED" : `${Math.round(frequency)} Hz`;
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
    routeHitPaths[index]?.style.setProperty("--flow", String(routes[index]));
    routeHitPaths[index]?.style.setProperty("--aperture", String(aperture));
    vessel?.classList.toggle("is-open", present && aperture > 0.02);
    vessel?.classList.toggle(
      "is-flowing",
      present && aperture > 0.02 && routeFlows[index] > 0.02,
    );
    if (vessel) vessel.dataset.runtimeAperture = aperture.toFixed(3);
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
  const activeCallButton = activeCallId
    ? document.querySelector(`[data-call-id="${activeCallId}"]`)
    : null;
  activeCallButton?.style.setProperty("--call-progress", String(callActive ? callProgress : 0));
  const pressureKpa = meanPressure * 10;
  if ($("lungPressureReadout")) $("lungPressureReadout").textContent = `${pressureKpa.toFixed(1)} kPa`;
  if ($("manifoldReadout")) $("manifoldReadout").textContent = `${pressureKpa.toFixed(1)} kPa`;
  if ($("flowReadout")) $("flowReadout").textContent = `${clamp(telemetry.flow, 0, 24).toFixed(2)} L/s`;
  updateCountPresentation(openPaths);
  if ($("loadReadout")) $("loadReadout").textContent = percent(telemetry.load ?? 0);
  if ($("foldLockReadout")) {
    const activePairs = [0, 1, 2, 3].filter((index) => Math.max(folds[index * 2], folds[index * 2 + 1]) > 0.08).length;
    $("foldLockReadout").textContent = `${activePairs} active sources`;
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
  const graphRenderTime = performance.now();
  if (graphRenderTime - lastGraphTelemetryRender >= 33) {
    lastGraphTelemetryRender = graphRenderTime;
    renderGraphLayout({
      lungs,
      folds,
      foldDisplacements,
      mouths: mouthFlows.map(normalizeFlow),
      mouthApertures,
      bankLevels,
    });
  }
  document.documentElement.style.setProperty("--colony-pressure", String(pressureLevel));
  document.documentElement.style.setProperty("--colony-rms", String(clamp(telemetry.rms ?? 0) * 4));
  animationFrame = requestAnimationFrame(renderTelemetry);
}

function cleanup() {
  cancelAnimationFrame(animationFrame);
  cancelAnimationFrame(graphConfigurationFrame);
  globalThis.removeEventListener("keydown", handleKeyDown);
  globalThis.removeEventListener("keyup", handleKeyUp);
  globalThis.removeEventListener("morphazoid:midi-input", handleMidiInput);
  graph?.sourceNode?.port.postMessage({ type: "panic" });
  graph?.sourceNode?.disconnect();
  graph?.releaseOutput?.();
  audioContext?.close();
}

buildCallBank();
buildContourEditor();
buildAnatomyGraph();
syncControlsFromState();
bindControls();
setAudioPresentation(false);
setTransport(false);
renderTelemetry();
globalThis.addEventListener("pagehide", cleanup, { once: true });

import {
  HYPER_RUBIX_AXES,
  HYPER_RUBIX_BOUNDARY_CELLS,
  HYPER_RUBIX_CELL_ORDER,
  HYPER_RUBIX_COLORS,
  HYPER_RUBIX_PLANE_DRUMS,
  HYPER_RUBIX_SEQUENCE_LENGTH,
  HYPER_RUBIX_SEQUENCE_PATTERNS,
  HYPER_RUBIX_TECHNO_VOICES,
  buildHyperRubixTesseractWireframe,
  createHyperRubixHyperbarSnapshot,
  createHyperRubixScramble,
  createHyperRubixSequence,
  createSeededHyperRubixRandom,
  createSolvedHyperRubix,
  createHyperRubixStickerStream,
  hyperRubixBoundaryCell,
  hyperRubixCellForNormal,
  hyperRubixDisorder,
  hyperRubixMoveAffectsSticker,
  hyperRubixSequenceIndex,
  hyperRubixSizeMetrics,
  hyperRubixStickerStepIndex,
  hyperRubixStepDurationSeconds,
  hyperRubixTechnoVoiceParameters,
  invertHyperRubixMove,
  invertHyperRubixMoves,
  isHyperRubixSolved,
  normalizeHyperRubixMove,
  projectHyperRubixPoint4,
  rotateHyperRubixPoint4,
  turnHyperRubixBoundaryCell,
} from "./src/hyper-rubix.js";
import { unlockAudioContext } from "./src/audio.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import { WebGpu303Audio, webGpu303Support } from "./src/webgpu-303.js";
import {
  HYPER_RUBIX_WEBGPU_303_DEFAULTS,
  createHyperRubixWebGpu303Pattern,
} from "./src/hyper-rubix-webgpu-303.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const TAU = Math.PI * 2;
const MOVE_DURATION = 430;
const SCRAMBLE_DURATION = 135;
const UNWIND_DURATION = 180;
const PROJECTION_DEPTH_MIN = 3.4;
const LOOKAHEAD_MS = 110;
const SCHEDULER_INTERVAL_MS = 24;
const FOLD_TICK_DEGREES = 15;
const FOLD_TICK_INTERVAL_MS = 42;
const AXIS_COLORS = Object.freeze({
  x: "#ff6b72",
  y: "#f7cf5b",
  z: "#65e58a",
  w: "#c9a5ff",
});
const DEFAULTS = Object.freeze({
  puzzleSize: 3,
  selectedCell: "w+",
  selectedPlane: "xy",
  dragMode: "orbit",
  autoRotate: false,
  tempo: 112,
  swing: 0.08,
  subdivisionsPerBeat: 2,
  sequenceMethod: "sticker-stream",
  twistMotion: "off",
  patternId: "axis-break",
  playbackMode: "forward",
  twistDensity: 1,
  rotationSpeed: 0.07,
  projectionDepth: 4.2,
  cellSeparation: 0.3,
  stickerScale: 0.78,
  output: 0.48,
  voice: "pulse",
  tone: 0.64,
  decay: 0.58,
  foldSound: "glide",
  foldLevel: 0.12,
  hearAutoDrift: false,
  rattleEnabled: false,
  rattleLevel: 0.34,
  rattleRate: 4,
  shapeInfluence: 0.72,
  pitchInfluence: 0.72,
  filterInfluence: 0.72,
  stereoInfluence: 0.72,
  neighborResponse: 1,
  wInfluence: 0.72,
  disorderInfluence: 0.6,
  topologyMode: "mesh",
  topologyLevel: 0.22,
  topologySpan: 12,
  topologyStrum: 0.018,
  topologyRing: 0.48,
  topologyWarp: 1,
  cameraPitch: -17,
  cameraYaw: 28,
  cameraRoll: -2,
  rotation: Object.freeze({ xy: 7, xz: -4, xw: 24, yz: -6, yw: -18, zw: 12 }),
});
const VOICE_LABELS = Object.freeze({
  pulse: "Hyper kit",
  glass: "Prism kit",
  dust: "Bit kit",
  "webgpu-303": "WebGPU 303",
  rattlesnake: "Rattlesnake",
});
const RATE_LABELS = Object.freeze({
  1: "1/4",
  2: "1/8",
  4: "1/16",
  8: "1/32",
  16: "1/64",
});
const RATTLE_RATE_LABELS = Object.freeze({ 2: "Loose", 4: "Dense", 8: "Swarm" });
const FOLD_SOUND_LABELS = Object.freeze({
  glide: "Gesture glide",
  ticks: "Crossing ticks",
  both: "Glide and crossing ticks",
  off: "Fold sound off",
});
const TOPOLOGY_MODE_LABELS = Object.freeze({
  mesh: "Full neighbor mesh",
  cohesion: "Matching-color lattice",
  faults: "Mixed-color fault lines",
  off: "Topology network off",
});
const TOPOLOGY_SUMMARY_LABELS = Object.freeze({
  mesh: "mesh",
  cohesion: "matches",
  faults: "faults",
});
const TOPOLOGY_CONNECTIONS_PER_CELL = 6;
const PLAYBACK_LABELS = Object.freeze({
  forward: "Forward",
  reverse: "Reverse",
  pendulum: "Pendulum",
  random: "Random",
});
const TWIST_MOTION_LABELS = Object.freeze({
  auto: "Auto ≤4/s",
  beat: "One per beat",
  bar: "One per bar",
  off: "Off",
});
const SEQUENCE_METHODS = Object.freeze({
  "twist-tape": Object.freeze({
    label: "Twist tape · 16",
    help: "Original six-plane kit and auto-twist loop",
    legacy: true,
    hyperbar: false,
    serial: false,
    autoTwist: true,
    length: HYPER_RUBIX_SEQUENCE_LENGTH,
  }),
  "sticker-hyperbar": Object.freeze({
    label: ({ hyperbarLength }) => `Sticker hyperbar · ${hyperbarLength}`,
    help: ({ stickerCount }) => `Eight color voices across all ${stickerCount} sticker positions`,
    legacy: false,
    hyperbar: true,
    serial: false,
    autoTwist: true,
    length: ({ hyperbarLength }) => hyperbarLength,
  }),
  "hybrid-coil": Object.freeze({
    label: ({ hyperbarLength }) => `Hybrid coil · 16 × ${hyperbarLength}`,
    help: ({ hyperbarLength }) => `Original twist drums and the ${hyperbarLength}-pulse sticker matrix together`,
    legacy: true,
    hyperbar: true,
    serial: false,
    autoTwist: true,
    length: ({ hyperbarLength }) => hyperbarLength,
  }),
  "sticker-stream": Object.freeze({
    label: ({ stickerStreamLength }) => `Shape loop · ${stickerStreamLength}`,
    help: "Every sticker sounds alone; manual orbit, fold, and turns reshape the running loop",
    legacy: false,
    hyperbar: true,
    serial: true,
    cornersOnly: false,
    autoTwist: false,
    length: ({ stickerStreamLength }) => stickerStreamLength,
  }),
  "corner-stream": Object.freeze({
    label: ({ cornerStreamLength }) => `Corner stream · ${cornerStreamLength}`,
    help: ({ cornerStreamLength }) => `A clearer 2 × 2-like pass through the ${cornerStreamLength} corner stickers`,
    legacy: false,
    hyperbar: true,
    serial: true,
    cornersOnly: true,
    autoTwist: false,
    length: ({ cornerStreamLength }) => cornerStreamLength,
  }),
});

const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
const wireframe = buildHyperRubixTesseractWireframe(1.32);
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const state = {
  puzzle: createSolvedHyperRubix(DEFAULTS.puzzleSize),
  selectedCell: DEFAULTS.selectedCell,
  selectedPlane: DEFAULTS.selectedPlane,
  dragMode: DEFAULTS.dragMode,
  autoRotate: reduceMotion ? false : DEFAULTS.autoRotate,
  playing: false,
  tempo: DEFAULTS.tempo,
  swing: DEFAULTS.swing,
  subdivisionsPerBeat: DEFAULTS.subdivisionsPerBeat,
  sequenceMethod: DEFAULTS.sequenceMethod,
  twistMotion: DEFAULTS.twistMotion,
  patternId: DEFAULTS.patternId,
  playbackMode: DEFAULTS.playbackMode,
  twistDensity: DEFAULTS.twistDensity,
  currentStep: 0,
  currentHyperbarStep: 0,
  currentStreamStep: 0,
  rotationSpeed: DEFAULTS.rotationSpeed,
  projectionDepth: DEFAULTS.projectionDepth,
  cellSeparation: DEFAULTS.cellSeparation,
  stickerScale: DEFAULTS.stickerScale,
  output: DEFAULTS.output,
  voice: DEFAULTS.voice,
  tone: DEFAULTS.tone,
  decay: DEFAULTS.decay,
  foldSound: DEFAULTS.foldSound,
  foldLevel: DEFAULTS.foldLevel,
  hearAutoDrift: DEFAULTS.hearAutoDrift,
  rattleEnabled: DEFAULTS.rattleEnabled,
  rattleLevel: DEFAULTS.rattleLevel,
  rattleRate: DEFAULTS.rattleRate,
  shapeInfluence: DEFAULTS.shapeInfluence,
  pitchInfluence: DEFAULTS.pitchInfluence,
  filterInfluence: DEFAULTS.filterInfluence,
  stereoInfluence: DEFAULTS.stereoInfluence,
  neighborResponse: DEFAULTS.neighborResponse,
  wInfluence: DEFAULTS.wInfluence,
  disorderInfluence: DEFAULTS.disorderInfluence,
  topologyMode: DEFAULTS.topologyMode,
  topologyLevel: DEFAULTS.topologyLevel,
  topologySpan: DEFAULTS.topologySpan,
  topologyStrum: DEFAULTS.topologyStrum,
  topologyRing: DEFAULTS.topologyRing,
  topologyWarp: DEFAULTS.topologyWarp,
  cameraPitch: DEFAULTS.cameraPitch,
  cameraYaw: DEFAULTS.cameraYaw,
  cameraRoll: DEFAULTS.cameraRoll,
  rotation: { ...DEFAULTS.rotation },
  audio: false,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let frameRequest = 0;
let previousFrameTime = performance.now();
let pointerDrag = null;
let renderedStickers = [];
let history = [];
let moveQueue = [];
let activeMove = null;
let turnPulse = null;
let scrambleGeneration = 0;
let sequenceGeneration = 0;
let sequence = [];
let sequenceStepElements = [];
let hyperbarSnapshot = null;
let hyperbarStepElements = [];
let hyperbarButtonByStickerId = new Map();
let currentHyperbarElements = [];
let hyperbarGateOverrides = new Map();
let hyperbarFocusStickerId = null;
let soundingStickerPulses = new Map();
let currentSoundingStickerId = "";
let stageStatusText = "";
let transportPuzzle = null;
let transportHyperbarPuzzle = null;
let transportHyperbarSnapshot = null;
let transportStickerStream = [];
let pendingTransportStickerStream = null;
let transportRandomOrder = [];
let transportRandomCycle = -1;
let transportPosition = 0;
let nextStepAtMs = 0;
let schedulerTimer = null;
let visualTimers = new Set();
let webGpu303Engine = null;
let webGpu303StartPromise = null;
let webGpu303LifecycleGeneration = 0;
let webGpu303PatternKey = "";
let webGpu303Failed = false;
let webGpu303SyncTimer = null;
let webGpu303SequencePhase = 0;
let transportVisualPosition = -1;
let transportVisualStartedAtMs = 0;

function normalizeDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function formatDegrees(value) {
  const rounded = Math.round(normalizeDegrees(value));
  return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded)}°`;
}

function axisUnit(axis) {
  return Object.fromEntries(HYPER_RUBIX_AXES.map((candidate) => [candidate, Number(candidate === axis)]));
}

function add4(first, second, amount = 1) {
  return Object.fromEntries(HYPER_RUBIX_AXES.map((axis) => [
    axis,
    first[axis] + second[axis] * amount,
  ]));
}

function normalizePuzzlePoint(point, sizeOrPuzzle = state.puzzle) {
  const { radius } = puzzleMetrics(sizeOrPuzzle);
  return Object.fromEntries(HYPER_RUBIX_AXES.map((axis) => [axis, point[axis] / radius]));
}

function rotatePlaneDegrees(source, plane, degrees) {
  const angle = degrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const [first, second] = plane;
  return {
    ...source,
    [first]: source[first] * cosine - source[second] * sine,
    [second]: source[first] * sine + source[second] * cosine,
  };
}

function rotatePoint3(point) {
  const pitch = state.cameraPitch * Math.PI / 180;
  const yaw = state.cameraYaw * Math.PI / 180;
  const roll = state.cameraRoll * Math.PI / 180;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  const pitched = {
    x: point.x,
    y: point.y * cp - point.z * sp,
    z: point.y * sp + point.z * cp,
  };
  const yawed = {
    x: pitched.x * cy + pitched.z * sy,
    y: pitched.y,
    z: -pitched.x * sy + pitched.z * cy,
  };
  return {
    x: yawed.x * cr - yawed.y * sr,
    y: yawed.x * sr + yawed.y * cr,
    z: yawed.z,
  };
}

function transformed4(point) {
  return rotateHyperRubixPoint4(point, state.rotation);
}

function projectToCanvas(point) {
  const rotated = transformed4(point);
  const projected4 = projectHyperRubixPoint4(rotated, state.projectionDepth);
  const viewed = rotatePoint3(projected4);
  const distance3 = 5.3;
  const factor3 = distance3 / Math.max(1.15, distance3 - viewed.z);
  const scale = Math.min(cssWidth, cssHeight) * (cssWidth < 620 ? 0.15 : 0.112);
  return {
    x: cssWidth * 0.51 + viewed.x * scale * factor3,
    y: cssHeight * 0.52 - viewed.y * scale * factor3,
    depth: viewed.z,
    factor3,
    factor4: projected4.factor,
    rotatedW: rotated.w,
  };
}

function scheduleFrame() {
  if (!frameRequest) frameRequest = requestAnimationFrame(drawFrame);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(3_000_000 / Math.max(1, cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();

const rgbCache = new Map();

function rgb(hex) {
  if (rgbCache.has(hex)) return rgbCache.get(hex);
  const source = hex.replace("#", "");
  const value = {
    r: parseInt(source.slice(0, 2), 16),
    g: parseInt(source.slice(2, 4), 16),
    b: parseInt(source.slice(4, 6), 16),
  };
  rgbCache.set(hex, value);
  return value;
}

function rgba(hex, alpha) {
  const color = rgb(hex);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function convexHull(points) {
  if (points.length <= 3) return [...points];
  const sorted = [...points].sort((first, second) => first.x - second.x || first.y - second.y);
  const cross = (origin, first, second) => (
    (first.x - origin.x) * (second.y - origin.y)
    - (first.y - origin.y) * (second.x - origin.x)
  );
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function pathPolygon(points) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
}

function pointInsidePolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
      && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function activeAnimationAngle() {
  if (!activeMove) return 0;
  const eased = 1 - ((1 - activeMove.progress) ** 3);
  return eased * activeMove.move.quarterTurns * 90;
}

function activePoint(point, affected) {
  if (!activeMove || !affected) return point;
  return rotatePlaneDegrees(point, activeMove.move.plane, activeAnimationAngle());
}

function stickerGeometry(sticker) {
  const cell = hyperRubixCellForNormal(sticker.normal);
  if (!cell) return null;
  const affected = activeMove ? hyperRubixMoveAffectsSticker(sticker, activeMove.move) : false;
  const metrics = puzzleMetrics();
  const center = add4(
    normalizePuzzlePoint(sticker.position, metrics),
    sticker.normal,
    state.cellSeparation,
  );
  const tangent = cell.tangentAxes.map(axisUnit);
  const halfExtent = 0.29 * state.stickerScale / metrics.radius;
  const points4 = [];
  for (let bits = 0; bits < 8; bits += 1) {
    let corner = center;
    for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
      corner = add4(corner, tangent[axisIndex], bits & (1 << axisIndex) ? halfExtent : -halfExtent);
    }
    points4.push(activePoint(corner, affected));
  }
  const projected = points4.map(projectToCanvas);
  const centerProjected = projectToCanvas(activePoint(center, affected));
  const animatedNormal = activePoint(sticker.normal, affected);
  const currentCell = hyperRubixCellForNormal(animatedNormal) ?? cell;
  return {
    sticker,
    projected,
    hull: convexHull(projected),
    center: centerProjected,
    depth: projected.reduce((sum, point) => sum + point.depth, 0) / projected.length,
    affected,
    currentCell,
    selected: currentCell.id === state.selectedCell,
  };
}

function drawBackground(time) {
  context.save();
  for (let index = 0; index < 72; index += 1) {
    const x = ((index * 179 + 31) % 997) / 997 * cssWidth;
    const y = ((index * 277 + 71) % 991) / 991 * cssHeight;
    const pulse = 0.45 + Math.sin(time * 0.00035 + index * 1.73) * 0.22;
    const size = index % 11 === 0 ? 1.2 : 0.65;
    context.fillStyle = index % 5 === 0
      ? `rgba(201,165,255,${pulse * 0.17})`
      : `rgba(104,236,255,${pulse * 0.1})`;
    context.fillRect(x, y, size, size);
  }
  const centerX = cssWidth * 0.51;
  const centerY = cssHeight * 0.52;
  const radius = Math.min(cssWidth, cssHeight) * 0.29;
  context.translate(centerX, centerY);
  context.strokeStyle = "rgba(201,165,255,.055)";
  context.lineWidth = 1;
  context.setLineDash([2, 8]);
  for (const amount of [0.55, 0.78, 1]) {
    context.beginPath();
    context.arc(0, 0, radius * amount, 0, TAU);
    context.stroke();
  }
  context.setLineDash([]);
  context.restore();
}

function drawWireframe() {
  const vertices = wireframe.vertices.map(projectToCanvas);
  const selectedEdges = new Set(
    wireframe.cells.find(({ id }) => id === state.selectedCell)?.edgeIndices ?? [],
  );
  const edges = wireframe.edges.map((edge) => ({
    ...edge,
    depth: (vertices[edge.a].depth + vertices[edge.b].depth) * 0.5,
  })).sort((first, second) => first.depth - second.depth);

  context.save();
  for (const edge of edges) {
    const first = vertices[edge.a];
    const second = vertices[edge.b];
    const selected = selectedEdges.has(edge.id);
    context.beginPath();
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
    context.strokeStyle = selected
      ? rgba(hyperRubixBoundaryCell(state.selectedCell).fill, 0.54)
      : rgba(AXIS_COLORS[edge.axis], edge.axis === "w" ? 0.28 : 0.15);
    context.lineWidth = selected ? 1.15 : edge.axis === "w" ? 0.9 : 0.65;
    if (edge.axis === "w" && !selected) context.setLineDash([3, 5]);
    context.stroke();
    context.setLineDash([]);
  }
  for (const point of vertices) {
    context.fillStyle = "rgba(237,245,231,.24)";
    context.fillRect(point.x - 1, point.y - 1, 2, 2);
  }
  context.restore();
}

function drawSelectedWireframe() {
  const cell = wireframe.cells.find(({ id }) => id === state.selectedCell);
  if (!cell) return;
  const vertices = wireframe.vertices.map(projectToCanvas);
  const color = hyperRubixBoundaryCell(state.selectedCell).fill;
  context.save();
  context.beginPath();
  for (const edgeIndex of cell.edgeIndices) {
    const edge = wireframe.edges[edgeIndex];
    const first = vertices[edge.a];
    const second = vertices[edge.b];
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
  }
  context.strokeStyle = rgba(color, 0.66);
  context.lineWidth = 1.15;
  context.shadowColor = rgba(color, 0.55);
  context.shadowBlur = 5;
  context.stroke();
  context.restore();
}

const CUBOID_EDGES = Object.freeze(Array.from({ length: 8 }, (_, index) => (
  [0, 1, 2].map((bit) => [index, index ^ (1 << bit)]).filter(([first, second]) => first < second)
)).flat());

function paintStageReadout() {
  const soundingIds = [...soundingStickerPulses.keys()];
  canvas.dataset.soundingStickerIds = soundingIds.join(" ");
  canvas.dataset.soundingStickerCount = String(soundingIds.length);
  canvas.dataset.currentSoundingStickerId = currentSoundingStickerId;
  const soundingLabel = soundingIds.length
    ? ` · ${String(soundingIds.length).padStart(2, "0")} SOUNDING`
    : "";
  $("stageReadout").textContent = `${stageStatusText}${soundingLabel}`;
}

function clearSoundingStickerPulses() {
  const hadPulses = soundingStickerPulses.size > 0;
  soundingStickerPulses = new Map();
  currentSoundingStickerId = "";
  paintStageReadout();
  if (hadPulses) scheduleFrame();
}

function pulseSoundingStickerIds(
  stickerIds,
  duration,
  startedAt = performance.now(),
  { retainTrail = false } = {},
) {
  const knownStickerIds = new Set(state.puzzle.stickers.map(({ id }) => id));
  const uniqueIds = [...new Set(stickerIds)]
    .filter((stickerId) => knownStickerIds.has(stickerId))
    .slice(0, HYPER_RUBIX_CELL_ORDER.length);
  currentSoundingStickerId = uniqueIds[0] ?? "";
  const nextPulses = retainTrail ? new Map(soundingStickerPulses) : new Map();
  for (const stickerId of uniqueIds) nextPulses.set(stickerId, { startedAt, duration });
  if (retainTrail && nextPulses.size > 4) {
    const newest = [...nextPulses.entries()]
      .sort((first, second) => second[1].startedAt - first[1].startedAt)
      .slice(0, 4);
    soundingStickerPulses = new Map(newest);
  } else {
    soundingStickerPulses = nextPulses;
  }
  paintStageReadout();
  scheduleFrame();
}

function expireSoundingStickerPulses(time) {
  let changed = false;
  for (const [stickerId, pulse] of soundingStickerPulses) {
    if (time - pulse.startedAt < pulse.duration) continue;
    soundingStickerPulses.delete(stickerId);
    changed = true;
  }
  if (currentSoundingStickerId && !soundingStickerPulses.has(currentSoundingStickerId)) {
    currentSoundingStickerId = "";
  }
  if (changed) paintStageReadout();
}

function soundingStickerStrength(stickerId, time) {
  const pulse = soundingStickerPulses.get(stickerId);
  if (!pulse) return 0;
  const progress = clamp((time - pulse.startedAt) / pulse.duration, 0, 1);
  return (1 - progress) ** 1.6;
}

function drawSticker(item, time) {
  const color = HYPER_RUBIX_COLORS[item.sticker.color];
  const selected = item.selected;
  const soundingStrength = soundingStickerStrength(item.sticker.id, time);
  const depthLight = clamp(
    0.07 + item.center.factor3 * 0.08 + item.center.factor4 * 0.055,
    0.12,
    0.29,
  );
  const alpha = clamp(
    depthLight + (selected ? 0.5 : 0) + (item.affected ? 0.22 : 0) + soundingStrength * 0.42,
    0.12,
    0.96,
  );

  context.save();
  if (soundingStrength > 0) {
    context.shadowColor = rgba(color, 0.98);
    context.shadowBlur = 18 + soundingStrength * 18;
  } else if (item.affected) {
    context.shadowColor = rgba(color, 0.85);
    context.shadowBlur = 15;
  } else if (selected) {
    context.shadowColor = rgba(color, 0.46);
    context.shadowBlur = 6;
  }
  pathPolygon(item.hull);
  context.fillStyle = rgba(color, alpha * 0.82);
  context.fill();
  context.strokeStyle = soundingStrength > 0
    ? rgba("#ffffff", 0.62 + soundingStrength * 0.34)
    : rgba(color, selected ? 0.92 : 0.48);
  context.lineWidth = soundingStrength > 0
    ? 1.8 + soundingStrength * 1.4
    : item.affected ? 1.4 : selected ? 0.9 : 0.55;
  context.stroke();
  context.shadowBlur = 0;

  context.beginPath();
  for (const [firstIndex, secondIndex] of CUBOID_EDGES) {
    const first = item.projected[firstIndex];
    const second = item.projected[secondIndex];
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
  }
  context.strokeStyle = rgba("#05050a", selected ? 0.38 : 0.26);
  context.lineWidth = 0.55;
  context.stroke();

  if (selected && item.center.factor3 > 0.92) {
    context.fillStyle = rgba("#ffffff", clamp(alpha * 0.5, 0.12, 0.38));
    context.fillRect(item.center.x - 0.7, item.center.y - 0.7, 1.4, 1.4);
  }
  if (soundingStrength > 0) {
    pathPolygon(item.hull);
    context.strokeStyle = rgba(color, 0.72 + soundingStrength * 0.26);
    context.lineWidth = 3 + soundingStrength * 2;
    context.shadowColor = rgba(color, 0.92);
    context.shadowBlur = 12 + soundingStrength * 16;
    context.stroke();
  }
  context.restore();
}

function drawTurnArc(time) {
  const move = activeMove?.move ?? turnPulse?.move;
  if (!move) return;
  const pulseAge = activeMove ? 0 : (time - turnPulse.startedAt) / 620;
  if (!activeMove && pulseAge >= 1) {
    turnPulse = null;
    return;
  }
  const progress = activeMove ? activeMove.progress : pulseAge;
  const color = hyperRubixBoundaryCell(move.cell).fill;
  const radius = Math.min(cssWidth, cssHeight) * (0.255 + progress * 0.018);
  const direction = move.quarterTurns < 0 ? -1 : 1;
  const start = -Math.PI * 0.65;
  const sweep = Math.PI * 0.66 * direction;
  context.save();
  context.translate(cssWidth * 0.51, cssHeight * 0.52);
  context.beginPath();
  context.arc(0, 0, radius, start, start + sweep * clamp(progress * 1.2, 0.12, 1), direction < 0);
  context.strokeStyle = rgba(color, activeMove ? 0.6 : (1 - pulseAge) * 0.38);
  context.lineWidth = activeMove ? 1.4 : 0.8;
  context.setLineDash([3, 5]);
  context.stroke();
  context.setLineDash([]);
  const angle = start + sweep * clamp(progress * 1.2, 0.12, 1);
  context.fillStyle = rgba(color, activeMove ? 0.85 : (1 - pulseAge) * 0.65);
  context.beginPath();
  context.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, 2.2, 0, TAU);
  context.fill();
  context.font = "600 8px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.letterSpacing = "0.08em";
  context.textAlign = "center";
  context.fillStyle = rgba(color, activeMove ? 0.82 : (1 - pulseAge) * 0.5);
  context.fillText(`${move.cell.toUpperCase()} / ${move.plane.toUpperCase()}`, 0, -radius - 11);
  context.restore();
}

function drawScene(time) {
  expireSoundingStickerPulses(time);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  drawBackground(time);
  drawWireframe();
  drawTurnArc(time);

  renderedStickers = state.puzzle.stickers
    .map(stickerGeometry)
    .filter(Boolean)
    .sort((first, second) => first.depth - second.depth);
  for (const item of renderedStickers) drawSticker(item, time);
  drawSelectedWireframe();

  if (activeMove) {
    const color = hyperRubixBoundaryCell(activeMove.move.cell).fill;
    const width = Math.min(cssWidth * 0.38, 330);
    const x = cssWidth * 0.51 - width * 0.5;
    const y = cssHeight - (cssWidth < 620 ? 76 : 88);
    context.fillStyle = "rgba(5,5,10,.76)";
    context.fillRect(x, y, width, 2);
    context.fillStyle = rgba(color, 0.88);
    context.fillRect(x, y, width * activeMove.progress, 2);
  }
}

function normalizedTurnAngle(plane) {
  return ((normalizeDegrees(state.rotation[plane] ?? 0) + 180) / 360) % 1;
}

function audioGeometryForCell(cellId, plane = state.selectedPlane, position = null) {
  const cell = hyperRubixBoundaryCell(cellId);
  const sourcePosition = position ? normalizePuzzlePoint(position) : cell.normal;
  const projected = projectToCanvas(sourcePosition);
  const rotated = transformed4(sourcePosition);
  const projected4 = projectHyperRubixPoint4(rotated, state.projectionDepth);
  const viewed = rotatePoint3(projected4);
  const orbitPhase = (
    normalizedTurnAngle(plane) * 0.58
    + ((normalizeDegrees(state.cameraYaw + state.cameraPitch * 0.7) + 180) / 360) * 0.42
  ) % 1;
  return {
    position: {
      x: clamp(viewed.x, -1, 1),
      y: clamp(viewed.y, -1, 1),
      z: clamp(viewed.z, -1, 1),
      w: clamp(rotated.w, -1, 1),
    },
    pan: clamp((projected.x / Math.max(1, cssWidth) - 0.5) * 2, -1, 1),
    angle: orbitPhase,
    depth: clamp(0.5 + viewed.z * 0.28, 0, 1),
    disorder: hyperRubixDisorder(state.puzzle),
    shapeInfluence: state.shapeInfluence,
    pitchInfluence: state.pitchInfluence,
    filterInfluence: state.filterInfluence,
    stereoInfluence: state.stereoInfluence,
    wInfluence: state.wInfluence,
    disorderInfluence: state.disorderInfluence,
    planeSlot: Math.max(0, cell.tangentPlanes.indexOf(plane)),
  };
}

function audioGeometryForStickerEvent(event, pulseIndex = 0) {
  const currentCell = hyperRubixBoundaryCell(event.cell);
  const plane = currentCell.tangentPlanes[pulseIndex % currentCell.tangentPlanes.length];
  return {
    ...audioGeometryForCell(currentCell.id, plane, event.position),
    planeSlot: pulseIndex % 3,
    configuration: event.configuration,
  };
}

function foldMotionGeometry({ velocityXW = 0, velocityYW = 0, pan } = {}) {
  const xw = normalizeDegrees(state.rotation.xw);
  const yw = normalizeDegrees(state.rotation.yw);
  const xwRadians = xw * Math.PI / 180;
  const ywRadians = yw * Math.PI / 180;
  return {
    xw,
    yw,
    velocityXW: Number.isFinite(velocityXW) ? velocityXW : 0,
    velocityYW: Number.isFinite(velocityYW) ? velocityYW : 0,
    wDepth: clamp(0.5 + Math.sin(xwRadians) * 0.24 + Math.sin(ywRadians) * 0.2, 0, 1),
    pan: clamp(
      Number.isFinite(pan)
        ? pan
        : Math.sin(ywRadians) * 0.68 + Math.sin(xwRadians) * 0.18,
      -1,
      1,
    ),
  };
}

function foldAngleDelta(next, previous) {
  return normalizeDegrees(next - previous);
}

class HyperRubixAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.drumBus = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.rattleSource = null;
    this.rattleHighpass = null;
    this.rattleBandpass = null;
    this.rattlePanner = null;
    this.rattleGain = null;
    this.rattleSeed = 0x5241544c;
    this.foldBus = null;
    this.foldOscillator = null;
    this.foldFilter = null;
    this.foldPanner = null;
    this.foldGain = null;
    this.foldTickSources = new Set();
    this.foldMotionActive = false;
    this.foldMotionSource = null;
    this.foldBuckets = null;
    this.lastFoldMotionAtMs = 0;
    this.lastFoldTickAtMs = -Infinity;
    this.topologyBus = null;
    this.topologyLanes = [];
    this.openHatGains = new Set();
    this.transportSchedulingDepth = 0;
    this.activeOneShotSources = new Set();
    this.transportSources = new Set();
    this.releaseAudioOutput = null;
  }

  async enable() {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is not available in this browser.");
    if (!this.context) {
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.16;
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.drumBus = this.context.createGain();
      this.drumBus.gain.value = 1;
      this.drumBus.connect(this.master);
      this.master.connect(this.compressor);
      this.releaseAudioOutput = connectAudioOutput(this.context, this.compressor, {
        runtime: globalThis,
      });
      this.noiseBuffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const noise = this.noiseBuffer.getChannelData(0);
      let seed = 0x48595045;
      for (let index = 0; index < noise.length; index += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        noise[index] = seed / 4_294_967_296 * 2 - 1;
      }
      this.createRattleGraph();
      this.createFoldGraph();
      this.createTopologyGraph();
    }
    if (this.context.state === "suspended") {
      unlockAudioContext(this.context);
      await this.context.resume();
    }
    this.setLevel(state.output, true);
    this.setFoldLevel(state.foldLevel, true);
    this.setTopologyLevel(state.topologyLevel, true);
  }

  setLevel(level, immediate = false) {
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    if (immediate) this.master.gain.setValueAtTime(level, now);
    else this.master.gain.setTargetAtTime(level, now, 0.018);
  }

  disable() {
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    this.cancelTransportAudio(now, { hard: true });
    this.silenceFold(now, { immediate: true });
    this.silenceTopology(now, { immediate: true });
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.012);
  }

  async suspend() {
    this.cancelTransportAudio(this.context?.currentTime, { hard: true });
    this.silenceFold(undefined, { immediate: true });
    if (this.context?.state === "running") await this.context.suspend();
  }

  async resume() {
    if (!this.context) return;
    if (this.context.state === "suspended") await this.context.resume();
    this.setLevel(state.output, true);
  }

  async dispose() {
    const audioContext = this.context;
    this.disable();
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    try {
      this.rattleSource?.stop();
    } catch {
      // A source can already be stopped by browser teardown.
    }
    try {
      this.foldOscillator?.stop();
    } catch {
      // A persistent source can already be stopped by browser teardown.
    }
    for (const lane of this.topologyLanes) {
      try { lane.oscillator.stop(); } catch { /* Persistent strings may already be stopped. */ }
    }
    this.silenceFold(audioContext?.currentTime ?? 0, { immediate: true });
    try {
      this.rattleSource?.disconnect();
      this.rattleHighpass?.disconnect();
      this.rattleBandpass?.disconnect();
      this.rattlePanner?.disconnect();
      this.rattleGain?.disconnect();
      this.foldOscillator?.disconnect();
      this.foldFilter?.disconnect();
      this.foldPanner?.disconnect();
      this.foldGain?.disconnect();
      this.foldBus?.disconnect();
      for (const lane of this.topologyLanes) {
        lane.oscillator.disconnect();
        lane.filter.disconnect();
        lane.gain.disconnect();
        lane.panner?.disconnect();
      }
      this.topologyBus?.disconnect();
      this.drumBus?.disconnect();
      this.master?.disconnect();
      this.compressor?.disconnect();
    } catch {
      // The browser may already have torn the graph down during navigation.
    }
    this.context = null;
    this.master = null;
    this.drumBus = null;
    this.compressor = null;
    this.noiseBuffer = null;
    this.rattleSource = null;
    this.rattleHighpass = null;
    this.rattleBandpass = null;
    this.rattlePanner = null;
    this.rattleGain = null;
    this.foldBus = null;
    this.foldOscillator = null;
    this.foldFilter = null;
    this.foldPanner = null;
    this.foldGain = null;
    this.topologyBus = null;
    this.topologyLanes = [];
    this.foldTickSources = new Set();
    this.foldMotionActive = false;
    this.foldMotionSource = null;
    this.foldBuckets = null;
    this.lastFoldMotionAtMs = 0;
    this.lastFoldTickAtMs = -Infinity;
    this.openHatGains = new Set();
    this.transportSchedulingDepth = 0;
    this.activeOneShotSources = new Set();
    this.transportSources = new Set();
    if (audioContext?.state !== "closed") await audioContext.close();
  }

  outputNode(pan) {
    if (typeof this.context.createStereoPanner !== "function") {
      return { node: this.drumBus ?? this.master, release() {} };
    }
    const panner = this.context.createStereoPanner();
    panner.pan.value = clamp(pan, -0.8, 0.8);
    panner.connect(this.drumBus ?? this.master);
    return {
      node: panner,
      release() {
        try { panner.disconnect(); } catch { /* Audio graph teardown is best-effort. */ }
      },
    };
  }

  withTransportScope(callback) {
    this.transportSchedulingDepth += 1;
    try {
      return callback();
    } finally {
      this.transportSchedulingDepth -= 1;
    }
  }

  trackOneShotSource(source, when) {
    const record = { source, when };
    this.activeOneShotSources.add(record);
    if (this.transportSchedulingDepth > 0) this.transportSources.add(record);
    source.addEventListener("ended", () => {
      this.activeOneShotSources.delete(record);
      this.transportSources.delete(record);
    }, { once: true });
  }

  cancelTransportAudio(when = this.context?.currentTime ?? 0, { hard = false } = {}) {
    const cancelAt = Number.isFinite(Number(when))
      ? Number(when)
      : this.context?.currentTime ?? 0;
    const records = hard ? this.activeOneShotSources : this.transportSources;
    for (const record of [...records]) {
      if (!hard && record.when < cancelAt) continue;
      this.activeOneShotSources.delete(record);
      this.transportSources.delete(record);
      try {
        record.source.stop(cancelAt);
      } catch {
        // A source can finish between the scheduler clear and this stop call.
      }
      try {
        record.source.disconnect();
      } catch {
        // Cancellation severs source nodes immediately; ended handlers release downstream nodes.
      }
    }
    if (hard) {
      for (const gain of this.openHatGains) {
        gain.gain.cancelScheduledValues(cancelAt);
        gain.gain.setTargetAtTime(0.0001, cancelAt, 0.004);
      }
      this.openHatGains.clear();
    }
    this.silenceRattle(cancelAt, { immediate: hard });
    this.silenceTopology(cancelAt, { immediate: hard });
  }

  createRattleGraph() {
    if (!this.context || !this.noiseBuffer || this.rattleSource) return;
    this.rattleSource = this.context.createBufferSource();
    this.rattleSource.buffer = this.noiseBuffer;
    this.rattleSource.loop = true;
    this.rattleHighpass = this.context.createBiquadFilter();
    this.rattleHighpass.type = "highpass";
    this.rattleHighpass.frequency.value = 1_700;
    this.rattleHighpass.Q.value = 0.45;
    this.rattleBandpass = this.context.createBiquadFilter();
    this.rattleBandpass.type = "bandpass";
    this.rattleBandpass.frequency.value = 4_600;
    this.rattleBandpass.Q.value = 2.4;
    this.rattleGain = this.context.createGain();
    this.rattleGain.gain.value = 0;
    if (typeof this.context.createStereoPanner === "function") {
      this.rattlePanner = this.context.createStereoPanner();
      this.rattlePanner.pan.value = 0;
    }
    this.rattleSource.connect(this.rattleHighpass).connect(this.rattleBandpass).connect(this.rattleGain);
    if (this.rattlePanner) {
      this.rattleGain.connect(this.rattlePanner).connect(this.master);
    } else {
      this.rattleGain.connect(this.master);
    }
    this.rattleSource.start(this.context.currentTime);
  }

  createFoldGraph() {
    if (!this.context || this.foldOscillator) return;
    this.foldBus = this.context.createGain();
    this.foldBus.gain.value = state.foldLevel;
    this.foldOscillator = this.context.createOscillator();
    this.foldOscillator.type = "triangle";
    this.foldOscillator.frequency.value = 104;
    this.foldFilter = this.context.createBiquadFilter();
    this.foldFilter.type = "lowpass";
    this.foldFilter.frequency.value = 960;
    this.foldFilter.Q.value = 1.4;
    this.foldGain = this.context.createGain();
    this.foldGain.gain.value = 0;
    if (typeof this.context.createStereoPanner === "function") {
      this.foldPanner = this.context.createStereoPanner();
      this.foldPanner.pan.value = 0;
    }
    this.foldOscillator.connect(this.foldFilter);
    if (this.foldPanner) {
      this.foldFilter.connect(this.foldPanner).connect(this.foldGain);
    } else {
      this.foldFilter.connect(this.foldGain);
    }
    this.foldGain.connect(this.foldBus).connect(this.master);
    this.foldOscillator.start(this.context.currentTime);
  }

  createTopologyGraph() {
    if (!this.context || this.topologyLanes.length) return;
    this.topologyBus = this.context.createGain();
    this.topologyBus.gain.value = clamp(state.topologyLevel, 0, 0.8);
    this.topologyBus.connect(this.master);
    const waveforms = ["sine", "triangle", "sine", "triangle", "sawtooth", "sine"];
    const laneCount = HYPER_RUBIX_CELL_ORDER.length * TOPOLOGY_CONNECTIONS_PER_CELL;
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const oscillator = this.context.createOscillator();
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      const panner = typeof this.context.createStereoPanner === "function"
        ? this.context.createStereoPanner()
        : null;
      oscillator.type = waveforms[laneIndex % TOPOLOGY_CONNECTIONS_PER_CELL];
      oscillator.frequency.value = 110 + laneIndex * 0.25;
      filter.type = "lowpass";
      filter.frequency.value = 1_400;
      filter.Q.value = 1.2;
      gain.gain.value = 0;
      oscillator.connect(filter).connect(gain);
      if (panner) gain.connect(panner).connect(this.topologyBus);
      else gain.connect(this.topologyBus);
      oscillator.start(this.context.currentTime);
      this.topologyLanes.push({ oscillator, filter, gain, panner });
    }
  }

  setTopologyLevel(level, immediate = false) {
    if (!this.topologyBus || !this.context) return;
    const now = this.context.currentTime;
    const next = clamp(Number(level) || 0, 0, 0.8);
    this.topologyBus.gain.cancelScheduledValues(now);
    if (immediate) this.topologyBus.gain.setValueAtTime(next, now);
    else this.topologyBus.gain.setTargetAtTime(next, now, 0.018);
  }

  silenceTopology(when = this.context?.currentTime ?? 0, { immediate = false } = {}) {
    for (const lane of this.topologyLanes) {
      lane.gain.gain.cancelScheduledValues(when);
      if (immediate) {
        lane.gain.gain.setValueAtTime(0, when);
      } else {
        lane.gain.gain.setTargetAtTime(0.0001, when, 0.008);
        lane.gain.gain.setValueAtTime(0, when + 0.05);
      }
    }
  }

  topologyConnections(event, configuration = {}) {
    const actual = event?.topology?.connections;
    if (Array.isArray(actual) && actual.length) return actual;
    const boundary = hyperRubixBoundaryCell(event?.cell ?? state.selectedCell);
    const count = clamp(
      Math.trunc(Number(configuration.neighborCount) || TOPOLOGY_CONNECTIONS_PER_CELL),
      1,
      TOPOLOGY_CONNECTIONS_PER_CELL,
    );
    const matches = clamp(Math.trunc(Number(configuration.sameColorNeighbors) || 0), 0, count);
    return Array.from({ length: count }, (_, index) => ({
      axis: boundary.tangentAxes[Math.floor(index / 2) % boundary.tangentAxes.length],
      direction: index % 2 ? 1 : -1,
      stickerId: "",
      color: index < matches ? event?.color : "mixed",
      homeCell: index < matches ? event?.homeCell : HYPER_RUBIX_CELL_ORDER[
        (Math.max(0, HYPER_RUBIX_CELL_ORDER.indexOf(event?.homeCell)) + index + 1)
          % HYPER_RUBIX_CELL_ORDER.length
      ],
      sameColor: index < matches,
      displaced: Boolean(configuration.displaced),
    }));
  }

  scheduleTopologyNetwork(
    event,
    scheduledWhen,
    geometry,
    { pitchHz, filterHz, accent = 1 } = {},
  ) {
    if (!state.audio || !this.context || !this.topologyLanes.length
      || state.topologyMode === "off" || state.topologyLevel <= 0) return;
    const configuration = geometry.configuration ?? event?.configuration ?? {};
    const indexedConnections = this.topologyConnections(event, configuration)
      .map((connection, slotIndex) => ({ connection, slotIndex }))
      .filter(({ connection }) => (
        state.topologyMode === "mesh"
        || (state.topologyMode === "cohesion" && connection.sameColor)
        || (state.topologyMode === "faults" && !connection.sameColor)
      ));
    if (!indexedConnections.length) return;
    const start = Math.max(this.context.currentTime, Number(scheduledWhen) || this.context.currentTime);
    const span = clamp(state.topologySpan, 0, 24);
    const strum = clamp(state.topologyStrum, 0, 0.08);
    const warp = clamp(state.topologyWarp, 0, 2);
    const voiceIndex = Math.max(0, HYPER_RUBIX_CELL_ORDER.indexOf(event?.homeCell));
    const currentCellIndex = Math.max(0, HYPER_RUBIX_CELL_ORDER.indexOf(event?.cell));
    const voice = HYPER_RUBIX_TECHNO_VOICES[event?.homeCell];
    const size = clamp(Math.trunc(Number(state.puzzle?.size) || 3), 2, 4);
    const radius = Math.max(0.5, (size - 1) / 2);
    const wPosition = clamp((Number(event?.position?.w) || 0) / radius, -1, 1);
    const radialOffset = {
      center: -0.25,
      face: -0.08,
      edge: 0.18,
      corner: 0.42,
    }[configuration.radialClass] ?? 0;
    const cellDisplaced = Boolean(event?.topology?.cellDisplaced);
    const basePitch = clamp(Number(pitchHz) || 110, 24, 4_200);
    const baseFilter = clamp(Number(filterHz) || 2_400, 90, 18_000);
    const levelNormalization = 1 / Math.sqrt(indexedConnections.length);

    indexedConnections.forEach(({ connection, slotIndex }, orderIndex) => {
      const lane = this.topologyLanes[
        currentCellIndex * TOPOLOGY_CONNECTIONS_PER_CELL
          + (slotIndex % TOPOLOGY_CONNECTIONS_PER_CELL)
      ];
      if (!lane) return;
      const axisIndex = Math.max(0, HYPER_RUBIX_AXES.indexOf(connection.axis));
      const direction = Number(connection.direction) < 0 ? -1 : 1;
      const neighborVoice = HYPER_RUBIX_TECHNO_VOICES[connection.homeCell];
      const colorDelta = neighborVoice && voice
        ? clamp(neighborVoice.baseMidi - voice.baseMidi, -18, 18) / 18
        : 0;
      const axisShape = [0.12, 0.34, 0.62, 0.92][axisIndex] ?? 0.5;
      const faultTerm = connection.sameColor ? 0 : colorDelta * 0.55 + direction * 0.11;
      const displacementTerm = (
        Number(connection.displaced) * direction * 0.1
        + Number(cellDisplaced) * (voiceIndex % 2 ? -0.12 : 0.12)
      ) * warp;
      const orderTerm = (size - 3) * (axisIndex + 1) * 0.035;
      const semitones = span * (
        direction * axisShape
        + radialOffset
        + faultTerm
        + displacementTerm
        + wPosition * 0.34 * warp
        + orderTerm
      );
      const frequency = clamp(basePitch * (2 ** (semitones / 12)), 24, 12_000);
      const onset = start
        + (indexedConnections.length === 1 ? 0 : orderIndex / (indexedConnections.length - 1) * strum)
        + currentCellIndex / Math.max(1, HYPER_RUBIX_CELL_ORDER.length - 1) * strum * 0.35;
      const ring = clamp(
        state.topologyRing
          * (connection.sameColor ? 1.18 : 0.74)
          * (1 + radialOffset * 0.32)
          * (connection.displaced ? 1.12 : 1),
        0.018,
        4.2,
      );
      const end = onset + ring;
      const peak = clamp(
        0.17 * clamp(accent, 0.25, 1.5) * levelNormalization
          * (connection.sameColor ? 0.86 : 1.08),
        0.006,
        0.18,
      );
      lane.oscillator.frequency.cancelScheduledValues(onset);
      lane.oscillator.frequency.setValueAtTime(frequency, onset);
      lane.oscillator.frequency.exponentialRampToValueAtTime(
        clamp(frequency * (connection.sameColor ? 0.998 : 1 + direction * 0.026 * warp), 24, 12_000),
        end,
      );
      lane.filter.frequency.cancelScheduledValues(onset);
      lane.filter.frequency.setValueAtTime(
        clamp(Math.max(baseFilter, frequency * (connection.sameColor ? 4.2 : 7.4)), 120, 19_000),
        onset,
      );
      lane.filter.Q.setValueAtTime(
        clamp(connection.sameColor ? 3.4 + state.neighborResponse * 2.8 : 0.9 + state.neighborResponse, 0.5, 12),
        onset,
      );
      lane.panner?.pan.setValueAtTime(
        clamp((Number(geometry.pan) || 0) + direction * (0.12 + axisIndex * 0.09) * warp, -1, 1),
        onset,
      );
      lane.gain.gain.cancelScheduledValues(onset);
      lane.gain.gain.setValueAtTime(0.0001, onset);
      lane.gain.gain.exponentialRampToValueAtTime(peak, onset + Math.min(0.006, ring * 0.2));
      lane.gain.gain.exponentialRampToValueAtTime(0.0001, end);
      lane.gain.gain.setValueAtTime(0, end + 0.001);
    });
  }

  setFoldLevel(level, immediate = false) {
    if (!this.foldBus || !this.context) return;
    const now = this.context.currentTime;
    const next = clamp(Number(level) || 0, 0, 0.6);
    this.foldBus.gain.cancelScheduledValues(now);
    if (immediate) this.foldBus.gain.setValueAtTime(next, now);
    else this.foldBus.gain.setTargetAtTime(next, now, 0.018);
  }

  beginFoldMotion(geometry = {}, { auto = false, timeMs = performance.now() } = {}) {
    if (!state.audio || !this.context || !this.foldGain || state.foldSound === "off") return false;
    if (auto && !state.hearAutoDrift) return false;
    this.foldMotionActive = true;
    this.foldMotionSource = auto ? "auto" : "gesture";
    this.foldBuckets = {
      xw: Math.floor((normalizeDegrees(Number(geometry.xw) || 0) + 180) / FOLD_TICK_DEGREES),
      yw: Math.floor((normalizeDegrees(Number(geometry.yw) || 0) + 180) / FOLD_TICK_DEGREES),
    };
    this.lastFoldMotionAtMs = Number.isFinite(Number(timeMs)) ? Number(timeMs) : performance.now();
    return true;
  }

  scheduleFoldTick(geometry, axis, when = this.context?.currentTime) {
    if (!this.context || !this.foldBus) return;
    const start = Math.max(this.context.currentTime, Number(when) || this.context.currentTime);
    const speed = Math.hypot(
      Number(geometry.velocityXW) || 0,
      Number(geometry.velocityYW) || 0,
    );
    const depth = clamp(Number(geometry.wDepth) || 0, 0, 1);
    const pan = clamp(Number(geometry.pan) || 0, -0.92, 0.92);
    const angle = axis === "xw" ? Number(geometry.xw) || 0 : Number(geometry.yw) || 0;
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = typeof this.context.createStereoPanner === "function"
      ? this.context.createStereoPanner()
      : null;
    const frequency = clamp(
      (axis === "xw" ? 310 : 415)
        * (1 + Math.abs(Math.sin(angle * Math.PI / 180)) * 0.46)
        * (0.88 + depth * 0.3),
      180,
      1_100,
    );
    const duration = clamp(0.064 - Math.min(speed, 220) / 8_000, 0.028, 0.064);
    const end = start + duration;
    oscillator.type = axis === "xw" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, end);
    filter.type = "bandpass";
    filter.frequency.value = clamp(frequency * (3.8 + depth * 2.4), 850, 6_800);
    filter.Q.value = 2.2 + depth * 3.1;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(clamp(0.11 + speed / 1_500, 0.11, 0.24), start + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(filter);
    if (panner) {
      panner.pan.value = pan;
      filter.connect(panner).connect(gain);
    } else {
      filter.connect(gain);
    }
    gain.connect(this.foldBus);
    const record = { source: oscillator, filter, gain, panner };
    this.foldTickSources.add(record);
    oscillator.addEventListener("ended", () => {
      this.foldTickSources.delete(record);
      try {
        oscillator.disconnect();
        filter.disconnect();
        panner?.disconnect();
        gain.disconnect();
      } catch {
        // The browser may already have released a short crossing tick.
      }
    }, { once: true });
    oscillator.start(start);
    oscillator.stop(end + 0.012);
  }

  updateFoldMotion(geometry = {}, { auto = false, timeMs = performance.now() } = {}) {
    if (!state.audio || !this.context || !this.foldGain || state.foldSound === "off") {
      if (this.foldMotionActive) this.endFoldMotion();
      return;
    }
    if (auto && !state.hearAutoDrift) {
      if (this.foldMotionSource === "auto") this.endFoldMotion();
      return;
    }
    const clockMs = Number.isFinite(Number(timeMs)) ? Number(timeMs) : performance.now();
    if (!this.foldMotionActive || this.foldMotionSource !== (auto ? "auto" : "gesture")) {
      this.beginFoldMotion(geometry, { auto, timeMs: clockMs });
    }
    const speed = Math.hypot(
      Number(geometry.velocityXW) || 0,
      Number(geometry.velocityYW) || 0,
    );
    const depth = clamp(Number(geometry.wDepth) || 0, 0, 1);
    const pan = clamp(Number(geometry.pan) || 0, -0.92, 0.92);
    const xwRadians = (Number(geometry.xw) || 0) * Math.PI / 180;
    const ywRadians = (Number(geometry.yw) || 0) * Math.PI / 180;
    const now = this.context.currentTime;
    const hasGlide = state.foldSound === "glide" || state.foldSound === "both";
    const hasTicks = state.foldSound === "ticks" || state.foldSound === "both";
    const foldBank = state.voice === "glass"
      ? { wave: "sine", pitch: 1.72, brightness: 1.34, resonance: 1.55 }
      : state.voice === "dust"
        ? { wave: "square", pitch: 1.28, brightness: 0.72, resonance: 0.7 }
        : state.voice === "webgpu-303"
          ? { wave: "sawtooth", pitch: 1.12, brightness: 1.08, resonance: 1.9 }
          : state.voice === "rattlesnake"
            ? { wave: "triangle", pitch: 0.78, brightness: 1.48, resonance: 2.3 }
            : { wave: "triangle", pitch: 1, brightness: 1, resonance: 1 };
    this.foldGain.gain.cancelScheduledValues(now);
    if (hasGlide) {
      const frequency = clamp(
        (76
          + depth * 132
          + Math.abs(Math.sin(xwRadians)) * 88
          + Math.abs(Math.cos(ywRadians)) * 54
          + Math.min(speed, 320) * 0.58) * foldBank.pitch,
        58,
        960,
      );
      const cutoff = clamp(
        (540 + depth * 2_800 + Math.min(speed, 320) * 12
          + Math.abs(Math.sin(ywRadians)) * 1_100) * foldBank.brightness,
        320,
        14_000,
      );
      this.foldOscillator.type = foldBank.wave;
      this.foldOscillator.frequency.setTargetAtTime(frequency, now, 0.018);
      this.foldFilter.frequency.setTargetAtTime(cutoff, now, 0.022);
      this.foldFilter.Q.setTargetAtTime(
        clamp((1.2 + depth * 4.2) * foldBank.resonance, 0.4, 14),
        now,
        0.025,
      );
      this.foldPanner?.pan.setTargetAtTime(pan, now, 0.018);
      this.foldGain.gain.setTargetAtTime(
        clamp(0.07 + Math.min(speed, 260) / 820 + depth * 0.07, 0.07, 0.42),
        now,
        0.012,
      );
    } else {
      this.foldGain.gain.setTargetAtTime(0, now, 0.008);
    }
    const nextBuckets = {
      xw: Math.floor((normalizeDegrees(Number(geometry.xw) || 0) + 180) / FOLD_TICK_DEGREES),
      yw: Math.floor((normalizeDegrees(Number(geometry.yw) || 0) + 180) / FOLD_TICK_DEGREES),
    };
    if (hasTicks && this.foldBuckets) {
      const crossedAxis = nextBuckets.xw !== this.foldBuckets.xw
        ? "xw"
        : nextBuckets.yw !== this.foldBuckets.yw ? "yw" : null;
      if (crossedAxis && clockMs - this.lastFoldTickAtMs >= FOLD_TICK_INTERVAL_MS) {
        this.scheduleFoldTick(geometry, crossedAxis, now);
        this.lastFoldTickAtMs = clockMs;
      }
    }
    this.foldBuckets = nextBuckets;
    this.lastFoldMotionAtMs = clockMs;
  }

  endFoldMotion(when = this.context?.currentTime ?? 0, { immediate = false } = {}) {
    if (this.foldGain) {
      this.foldGain.gain.cancelScheduledValues(when);
      if (immediate) this.foldGain.gain.setValueAtTime(0, when);
      else this.foldGain.gain.setTargetAtTime(0, when, 0.018);
    }
    this.foldMotionActive = false;
    this.foldMotionSource = null;
    this.foldBuckets = null;
  }

  silenceFold(when = this.context?.currentTime ?? 0, { immediate = false } = {}) {
    this.endFoldMotion(when, { immediate });
    for (const record of this.foldTickSources) {
      this.foldTickSources.delete(record);
      try { record.source.stop(when); } catch { /* A short tick may have already ended. */ }
      try {
        record.source.disconnect();
        record.filter.disconnect();
        record.panner?.disconnect();
        record.gain.disconnect();
      } catch {
        // Fold teardown is best-effort during page lifecycle transitions.
      }
    }
    this.lastFoldTickAtMs = -Infinity;
  }

  nextRattleRandom() {
    this.rattleSeed = (Math.imul(this.rattleSeed, 1664525) + 1013904223) >>> 0;
    return this.rattleSeed / 4_294_967_296;
  }

  silenceRattle(when = this.context?.currentTime ?? 0, { immediate = false } = {}) {
    if (!this.rattleGain) return;
    this.rattleGain.gain.cancelScheduledValues(when);
    if (immediate) this.rattleGain.gain.setValueAtTime(0, when);
    else this.rattleGain.gain.setTargetAtTime(0, when, 0.008);
  }

  scheduleRattleStep(move, when, duration, geometry = {}, activity = 1) {
    if (!state.audio || !state.rattleEnabled || !this.context || !this.rattleGain) return;
    const start = Math.max(this.context.currentTime, Number(when) || this.context.currentTime);
    const span = clamp(Number(duration) || 0.12, 0.035, 1.2);
    const filterInfluence = state.filterInfluence;
    const stereoInfluence = state.stereoInfluence;
    const neighborInfluence = state.neighborResponse;
    const wInfluence = state.wInfluence;
    const disorderInfluence = state.disorderInfluence;
    const disorder = clamp((Number(geometry.disorder) || 0) * disorderInfluence, 0, 1);
    const pan = clamp((Number(geometry.pan) || 0) * stereoInfluence, -0.92, 0.92);
    const numericDepth = Number(geometry.depth);
    const numericAngle = Number(geometry.angle);
    const depth = clamp(Number.isFinite(numericDepth) ? numericDepth : 0.5, 0, 1);
    const angle = clamp(Number.isFinite(numericAngle) ? numericAngle : 0.5, 0, 1);
    const configuration = geometry.configuration ?? {};
    const rattleAmount = clamp(state.rattleLevel, 0, 0.8);
    if (rattleAmount <= 0) {
      this.silenceRattle(start, { immediate: true });
      return;
    }
    const neighborCount = Math.max(1, Number(configuration.neighborCount) || 1);
    const cohesion = clamp(
      (Number(configuration.sameColorNeighbors) || 0) / neighborCount,
      0,
      1,
    );
    const diversity = clamp(Number(configuration.neighborDiversity) || 0, 0, 1);
    const vertical = clamp((Number(geometry.position?.y) || 0) * 0.5 + 0.5, 0, 1);
    const voiceCell = move?.cell ?? state.selectedCell;
    const cellIndex = Math.max(0, HYPER_RUBIX_CELL_ORDER.indexOf(voiceCell));
    const colorBand = 720 + cellIndex * 190;
    const center = clamp(
      colorBand
        * (2 ** (vertical * 2.35))
        * (0.82 + state.tone * 0.36)
        * (1 + (depth - 0.5) * wInfluence * 0.5)
        * (1 + diversity * neighborInfluence * 0.24),
      480,
      9_800,
    );
    const pulseCount = clamp(
      Math.round(
        2 + state.rattleRate * 0.72 + disorder * 2.4 + activity * 1.4
        + diversity * neighborInfluence * 2 + Number(Boolean(configuration.displaced)),
      ),
      3,
      12,
    );
    const baseLevel = rattleAmount
      * (0.016 + activity * 0.018)
      * (1 + disorder * 0.18 + diversity * neighborInfluence * 0.26);
    const bodyFrequency = 46 * (2 ** (vertical * 4.05))
      * (1 + cellIndex * 0.012)
      * (1 + (depth - 0.5) * wInfluence * 0.12);
    const bodyDuration = clamp(
      (0.19 - vertical * 0.145) * (0.72 + state.decay * 0.72),
      0.026,
      0.32,
    );
    const { node: bodyOutput, release: releaseBody } = this.outputNode(pan);
    this.scheduleOscillator(bodyOutput, {
      when: start,
      duration: bodyDuration,
      type: vertical > 0.7 ? "triangle" : "sine",
      startFrequency: bodyFrequency * (1.24 + diversity * 0.22),
      endFrequency: bodyFrequency * (vertical < 0.38 ? 0.58 : 0.92),
      level: clamp(baseLevel * (0.5 + (1 - vertical) * 0.7), 0.006, 0.24),
      filterFrequency: clamp(center * (1.2 + vertical * 0.8), 320, 14_000),
      filterQ: clamp(0.8 + cohesion * 4.5 + depth * 1.8, 0.5, 9),
      cleanup: releaseBody,
    });
    this.rattleBandpass.frequency.setValueAtTime(center, start);
    this.rattleBandpass.Q.setValueAtTime(
      1.2 + angle * filterInfluence * 3.2 + cohesion * neighborInfluence * 1.6,
      start,
    );
    this.rattleHighpass.frequency.setValueAtTime(Math.max(1_300, center * 0.48), start);
    this.rattlePanner?.pan.setValueAtTime(pan, start);
    for (let index = 0; index < pulseCount; index += 1) {
      const cellStart = start + index / pulseCount * span;
      const jitter = (this.nextRattleRandom() - 0.5) * span / pulseCount * (0.12 + disorder * 0.5);
      const pulseStart = Math.max(start, cellStart + jitter);
      const pulseLength = clamp(span / pulseCount * (0.24 + this.nextRattleRandom() * 0.34), 0.005, 0.022);
      const peak = Math.max(0.0002, baseLevel * (0.7 + this.nextRattleRandom() * 0.6));
      this.rattleGain.gain.setValueAtTime(0.0001, pulseStart);
      this.rattleGain.gain.exponentialRampToValueAtTime(peak, pulseStart + 0.002);
      this.rattleGain.gain.exponentialRampToValueAtTime(0.0001, pulseStart + pulseLength);
    }
  }

  scheduleOscillator(output, {
    when,
    duration,
    type = "sine",
    startFrequency,
    endFrequency = startFrequency,
    level,
    filterFrequency,
    filterQ = 0.8,
    cleanup,
  }) {
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const attackEnd = when + Math.min(0.008, duration * 0.18);
    const end = when + duration;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, startFrequency), when);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), end);
    filter.type = "lowpass";
    filter.frequency.value = filterFrequency;
    filter.Q.value = filterQ;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, level), attackEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(filter).connect(gain).connect(output);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
      cleanup?.();
    }, { once: true });
    oscillator.start(when);
    this.trackOneShotSource(oscillator, when);
    oscillator.stop(end + 0.025);
    return end;
  }

  scheduleNoise(output, {
    when,
    duration,
    level,
    filterType = "bandpass",
    filterFrequency,
    filterQ = 0.8,
    voiceGroup = "",
    cleanup,
  }) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const attackEnd = when + Math.min(0.004, duration * 0.2);
    const end = when + duration;
    source.buffer = this.noiseBuffer;
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    filter.Q.value = filterQ;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, level), attackEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    if (voiceGroup === "open-hat") this.openHatGains.add(gain);
    source.connect(filter).connect(gain).connect(output);
    source.addEventListener("ended", () => {
      this.openHatGains.delete(gain);
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      cleanup?.();
    }, { once: true });
    source.start(when);
    this.trackOneShotSource(source, when);
    source.stop(end + 0.02);
    return end;
  }

  chokeOpenHat(when) {
    for (const gain of this.openHatGains) {
      gain.gain.cancelScheduledValues(when);
      gain.gain.setTargetAtTime(0.0001, when, 0.006);
    }
  }

  strike(move, scheduledWhen = this.context?.currentTime, stepAccent = 1) {
    if (!state.audio || !this.context || !this.master) return;
    const drum = HYPER_RUBIX_PLANE_DRUMS[move.plane] ?? HYPER_RUBIX_PLANE_DRUMS.xy;
    const cell = hyperRubixBoundaryCell(move.cell);
    const cellIndex = HYPER_RUBIX_CELL_ORDER.indexOf(cell.id);
    const when = Math.max(this.context.currentTime, Number(scheduledWhen) || this.context.currentTime);
    const signPitch = cell.sign > 0 ? 1.075 : 0.925;
    const directionGain = move.quarterTurns > 0 ? 1 : 0.72;
    const accent = clamp(stepAccent, 0.45, 1.35) * directionGain;
    const pan = cell.sign * (0.18 + (cellIndex % 4) * 0.08);
    const { node: output, release } = this.outputNode(pan);
    const decayScale = clamp(state.decay / 0.58, 0.35, 2.4);
    const bank = state.voice === "glass"
      ? { wave: "sine", brightness: 1.2, release: 1.25, noise: 0.72 }
      : state.voice === "dust"
        ? { wave: "square", brightness: 0.78, release: 0.62, noise: 1.28 }
        : { wave: "triangle", brightness: 1, release: 0.9, noise: 1 };
    const cutoff = 1_100 + state.tone * 8_800 * bank.brightness;
    const finish = () => release();

    if (drum.family === "kick") {
      this.scheduleOscillator(output, {
        when,
        duration: clamp(0.17 * decayScale * bank.release, 0.075, 0.42),
        type: state.voice === "dust" ? "triangle" : "sine",
        startFrequency: (145 + state.tone * 75) * signPitch,
        endFrequency: (42 + state.tone * 14) * signPitch,
        level: 0.34 * accent,
        filterFrequency: Math.min(cutoff, 2_100),
        cleanup: finish,
      });
      return;
    }

    if (drum.family === "snare") {
      this.scheduleOscillator(output, {
        when,
        duration: clamp(0.095 * decayScale, 0.055, 0.2),
        type: bank.wave,
        startFrequency: 220 * signPitch,
        endFrequency: 118 * signPitch,
        level: 0.105 * accent,
        filterFrequency: 2_400 + state.tone * 2_600,
      });
      this.scheduleNoise(output, {
        when,
        duration: clamp(0.15 * decayScale * bank.release, 0.07, 0.34),
        level: 0.24 * accent * bank.noise,
        filterFrequency: 1_100 + state.tone * 3_100,
        filterQ: 0.7,
        cleanup: finish,
      });
      return;
    }

    if (drum.family === "hat") {
      this.scheduleNoise(output, {
        when,
        duration: clamp(0.052 * decayScale * bank.release, 0.025, 0.16),
        level: 0.14 * accent * bank.noise,
        filterType: "highpass",
        filterFrequency: 3_600 + state.tone * 5_600,
        filterQ: 0.65,
        cleanup: finish,
      });
      return;
    }

    if (drum.family === "tom") {
      this.scheduleOscillator(output, {
        when,
        duration: clamp(0.24 * decayScale * bank.release, 0.1, 0.52),
        type: bank.wave,
        startFrequency: (310 + state.tone * 90) * signPitch,
        endFrequency: (88 + state.tone * 34) * signPitch,
        level: 0.25 * accent,
        filterFrequency: Math.min(cutoff, 4_800),
        filterQ: state.voice === "glass" ? 2.4 : 0.9,
        cleanup: finish,
      });
      return;
    }

    if (drum.family === "clap") {
      [0, 0.022, 0.046].forEach((offset, index) => {
        this.scheduleNoise(output, {
          when: when + offset,
          duration: clamp((index === 2 ? 0.11 : 0.038) * decayScale * bank.release, 0.025, 0.26),
          level: (index === 2 ? 0.16 : 0.115) * accent * bank.noise,
          filterFrequency: 1_500 + state.tone * 3_800,
          filterQ: 0.62,
          cleanup: index === 2 ? finish : undefined,
        });
      });
      return;
    }

    const ratios = state.voice === "glass" ? [1, 1.414, 2.19] : [1, 1.37, 1.79];
    ratios.forEach((ratio, index) => {
      const base = (330 + state.tone * 310) * signPitch * ratio;
      this.scheduleOscillator(output, {
        when: when + index * 0.003,
        duration: clamp(0.14 * decayScale * bank.release * (1 - index * 0.12), 0.055, 0.34),
        type: index === 1 && state.voice === "pulse" ? "square" : bank.wave,
        startFrequency: base,
        endFrequency: base * 0.91,
        level: 0.11 * accent / (1 + index * 0.35),
        filterFrequency: cutoff,
        filterQ: 1.7 + state.tone * 3,
        cleanup: index === 0 ? finish : undefined,
      });
    });
  }

  strikeStickerTopology(event, scheduledWhen = this.context?.currentTime, stepAccent = 1, geometry = {}) {
    if (!state.audio || !this.context || !this.master || state.topologyMode === "off"
      || state.topologyLevel <= 0) return;
    const voiceCell = event?.homeCell ?? event?.cell ?? state.selectedCell;
    const boundary = hyperRubixBoundaryCell(voiceCell);
    const planeSlot = clamp(Math.trunc(Number(geometry.planeSlot) || 0), 0, 2);
    const parameters = hyperRubixTechnoVoiceParameters({
      cell: voiceCell,
      plane: boundary.tangentPlanes[planeSlot],
      quarterTurns: geometry.direction < 0 ? -1 : 1,
    }, {
      ...geometry,
      shapeInfluence: state.shapeInfluence,
      pitchInfluence: state.pitchInfluence,
      filterInfluence: state.filterInfluence,
      stereoInfluence: state.stereoInfluence,
      wInfluence: state.wInfluence,
      disorderInfluence: state.disorderInfluence,
    });
    const configuration = geometry.configuration ?? {};
    const neighborCount = Math.max(1, Number(configuration.neighborCount) || 1);
    const cohesion = clamp(
      (Number(configuration.sameColorNeighbors) || 0) / neighborCount,
      0,
      1,
    );
    const diversity = clamp(Number(configuration.neighborDiversity) || 0, 0, 1);
    const radialPitch = {
      center: 0.94,
      face: 1,
      edge: 1.055,
      corner: 1.11,
    }[configuration.radialClass] ?? 1;
    const pitchHz = parameters.pitchHz
      * (radialPitch ** state.pitchInfluence)
      * (configuration.displaced ? 1 + 0.018 * state.disorderInfluence : 1);
    const bankBrightness = state.voice === "glass"
      ? 1.17
      : state.voice === "dust" ? 0.8 : state.voice === "rattlesnake" ? 1.34 : 1;
    const filterHz = clamp(
      parameters.filterHz
        * (0.7 + state.tone * 0.6)
        * bankBrightness
        * (1 + diversity * state.neighborResponse * 0.58),
      70,
      19_000,
    );
    this.scheduleTopologyNetwork(event, Math.max(
      this.context.currentTime,
      Number(scheduledWhen) || this.context.currentTime,
    ), {
      ...geometry,
      configuration,
    }, {
      pitchHz,
      filterHz,
      accent: clamp(stepAccent, 0.35, 1.4) * (0.78 + cohesion * 0.22),
    });
  }

  strikeSticker(event, scheduledWhen = this.context?.currentTime, stepAccent = 1, geometry = {}) {
    if (!state.audio || !this.context || !this.master) return;
    const voiceCell = event?.homeCell ?? event?.cell ?? state.selectedCell;
    const boundary = hyperRubixBoundaryCell(voiceCell);
    const planeSlot = clamp(Math.trunc(Number(geometry.planeSlot) || 0), 0, 2);
    const voiceMove = {
      cell: voiceCell,
      plane: boundary.tangentPlanes[planeSlot],
      quarterTurns: geometry.direction < 0 ? -1 : 1,
    };
    const parameters = hyperRubixTechnoVoiceParameters(voiceMove, {
      ...geometry,
      shapeInfluence: state.shapeInfluence,
      pitchInfluence: state.pitchInfluence,
      filterInfluence: state.filterInfluence,
      stereoInfluence: state.stereoInfluence,
      wInfluence: state.wInfluence,
      disorderInfluence: state.disorderInfluence,
    });
    const voice = parameters.voice;
    const configuration = geometry.configuration ?? {};
    const neighborCount = Math.max(1, Number(configuration.neighborCount) || 1);
    const cohesion = clamp(
      (Number(configuration.sameColorNeighbors) || 0) / neighborCount,
      0,
      1,
    );
    const diversity = clamp(Number(configuration.neighborDiversity) || 0, 0, 1);
    const radialPitch = {
      center: 0.94,
      face: 1,
      edge: 1.055,
      corner: 1.11,
    }[configuration.radialClass] ?? 1;
    const configuredPitch = parameters.pitchHz
      * (radialPitch ** state.pitchInfluence)
      * (configuration.displaced ? 1 + 0.018 * state.disorderInfluence : 1);
    const configuredFilterQ = clamp(
      parameters.filterQ * (0.72 + cohesion * state.neighborResponse * 0.68),
      0.45,
      12,
    );
    const when = Math.max(this.context.currentTime, Number(scheduledWhen) || this.context.currentTime);
    const hybridTrim = state.sequenceMethod === "hybrid-coil" ? 0.68 : 1;
    const accent = clamp(stepAccent, 0.35, 1.4) * hybridTrim;
    const bank = state.voice === "glass"
      ? { wave: "sine", brightness: 1.17, release: 1.16, noise: 0.76 }
      : state.voice === "dust"
        ? { wave: "square", brightness: 0.8, release: 0.66, noise: 1.18 }
        : { wave: "triangle", brightness: 1, release: 1, noise: 1 };
    const decayMacro = clamp(state.decay / DEFAULTS.decay, 0.3, 2.6);
    const maximumDuration = Number.isFinite(Number(geometry.maxDurationSeconds))
      ? clamp(Number(geometry.maxDurationSeconds), 0.035, 2.4)
      : 2.4;
    const duration = clamp(
      parameters.decaySeconds * decayMacro * bank.release
        * (0.78 + cohesion * state.neighborResponse * 0.42),
      0.018,
      maximumDuration,
    );
    const filterFrequency = clamp(
      parameters.filterHz
        * (0.7 + state.tone * 0.6)
        * bank.brightness
        * (1 + diversity * state.neighborResponse * 0.58),
      70,
      19_000,
    );
    const driveGain = 0.72 + clamp(
      parameters.drive + diversity * state.neighborResponse * 0.42,
      0,
      1.5,
    ) * 0.46;
    this.scheduleTopologyNetwork(event, when, {
      ...geometry,
      configuration,
    }, {
      pitchHz: configuredPitch,
      filterHz: filterFrequency,
      accent,
    });
    const { node: output, release } = this.outputNode(parameters.pan);
    const finish = () => release();

    if (state.voice === "webgpu-303") {
      this.scheduleOscillator(output, {
        when,
        duration: clamp(duration * 0.82, 0.035, 0.42),
        type: "sawtooth",
        startFrequency: configuredPitch * (configuration.displaced ? 1.5 : 1),
        endFrequency: configuredPitch * 0.985,
        level: 0.13 * accent * driveGain,
        filterFrequency: clamp(filterFrequency * 1.12, 90, 16_000),
        filterQ: clamp(configuredFilterQ * 1.75, 1.2, 15),
        cleanup: finish,
      });
      return;
    }

    if (voice.family === "kick") {
      this.scheduleOscillator(output, {
        when,
        duration,
        type: state.voice === "dust" ? "triangle" : "sine",
        startFrequency: configuredPitch * 2.35,
        endFrequency: configuredPitch * 0.78,
        level: 0.31 * accent * driveGain,
        filterFrequency: Math.min(filterFrequency, 2_500),
        filterQ: configuredFilterQ,
        cleanup: finish,
      });
      this.scheduleNoise(output, {
        when,
        duration: 0.012,
        level: 0.045 * accent,
        filterType: "highpass",
        filterFrequency: 4_800,
      });
      return;
    }

    if (voice.family === "sub") {
      this.scheduleOscillator(output, {
        when,
        duration,
        type: bank.wave === "sine" ? "sine" : "triangle",
        startFrequency: configuredPitch * 1.48,
        endFrequency: configuredPitch * 0.72,
        level: 0.25 * accent * driveGain,
        filterFrequency: Math.min(filterFrequency, 1_900),
        filterQ: configuredFilterQ,
        cleanup: finish,
      });
      return;
    }

    if (voice.family === "snare") {
      this.scheduleOscillator(output, {
        when,
        duration: Math.min(duration, 0.16),
        type: bank.wave,
        startFrequency: configuredPitch * 1.16,
        endFrequency: configuredPitch * 0.68,
        level: 0.085 * accent,
        filterFrequency: Math.min(filterFrequency, 4_800),
        filterQ: configuredFilterQ,
      });
      this.scheduleNoise(output, {
        when,
        duration,
        level: 0.2 * accent * bank.noise * driveGain,
        filterFrequency,
        filterQ: configuredFilterQ,
        cleanup: finish,
      });
      return;
    }

    if (voice.family === "clap") {
      [0, 0.018, 0.034].forEach((offset, index) => {
        this.scheduleNoise(output, {
          when: when + offset,
          duration: index === 2 ? duration : Math.min(0.034, duration),
          level: (index === 2 ? 0.14 : 0.1) * accent * bank.noise * driveGain,
          filterFrequency,
          filterQ: configuredFilterQ,
          cleanup: index === 2 ? finish : undefined,
        });
      });
      return;
    }

    if (voice.family === "closed-hat" || voice.family === "open-hat") {
      if (voice.family === "closed-hat") this.chokeOpenHat(when);
      this.scheduleNoise(output, {
        when,
        duration: voice.family === "closed-hat" ? Math.min(duration, 0.075) : duration,
        level: (voice.family === "closed-hat" ? 0.105 : 0.12) * accent * bank.noise,
        filterType: "highpass",
        filterFrequency: Math.max(4_200, filterFrequency),
        filterQ: configuredFilterQ,
        voiceGroup: voice.family,
        cleanup: finish,
      });
      return;
    }

    if (voice.family === "rim") {
      [1, 1.64].forEach((ratio, index) => {
        this.scheduleOscillator(output, {
          when: when + index * 0.0015,
          duration: Math.min(duration, 0.09 - index * 0.012),
          type: "sine",
          startFrequency: configuredPitch * ratio,
          endFrequency: configuredPitch * ratio * 0.96,
          level: 0.12 * accent / (1 + index * 0.34),
          filterFrequency,
          filterQ: configuredFilterQ,
          cleanup: index === 0 ? finish : undefined,
        });
      });
      return;
    }

    const ratios = state.voice === "glass" ? [1, 1.414, 2.19] : [1, 1.37, 2.03];
    ratios.forEach((ratio, index) => {
      const frequency = configuredPitch * ratio;
      this.scheduleOscillator(output, {
        when: when + index * 0.002,
        duration: duration * (1 - index * 0.08),
        type: index === 1 && state.voice !== "glass" ? "square" : bank.wave,
        startFrequency: frequency * (1 + parameters.drive * 0.08),
        endFrequency: frequency * 0.91,
        level: 0.095 * accent * driveGain / (1 + index * 0.32),
        filterFrequency,
        filterQ: configuredFilterQ,
        cleanup: index === 0 ? finish : undefined,
      });
    });
  }
}

const audio = new HyperRubixAudio();

function isRattlesnakePreset() {
  return state.voice === "rattlesnake";
}

function isWebGpu303Preset() {
  return state.voice === "webgpu-303";
}

function audibleWebGpuRotation() {
  return {
    ...state.rotation,
    xy: state.rotation.xy + state.cameraRoll,
    xz: state.rotation.xz + state.cameraYaw,
    yz: state.rotation.yz + state.cameraPitch,
  };
}

function normalizedLoopPosition(position, length = puzzleMetrics().stickerStreamLength) {
  return ((Math.trunc(Number(position) || 0) % length) + length) % length;
}

function straightStepBoundary(stepIndex, swing = state.swing) {
  const index = Math.max(0, Math.trunc(Number(stepIndex) || 0));
  const pairs = Math.floor(index / 2);
  return pairs * 2 + (index % 2 ? 1 + clamp(swing, 0, 0.42) : 0);
}

function webGpu303StraightPhaseAtDelay(delayMs = 0) {
  const length = puzzleMetrics().stickerStreamLength;
  if (transportVisualPosition < 0) return 0;
  const target = performance.now() + Math.max(0, Number(delayMs) || 0);
  let position = transportVisualPosition;
  let onset = transportVisualStartedAtMs;
  let duration = hyperRubixStepDurationSeconds(
    state.tempo,
    state.subdivisionsPerBeat,
    state.swing,
    position,
  ) * 1_000;
  for (let count = 0; count < length && onset + duration <= target; count += 1) {
    onset += duration;
    position += 1;
    duration = hyperRubixStepDurationSeconds(
      state.tempo,
      state.subdivisionsPerBeat,
      state.swing,
      position,
    ) * 1_000;
  }
  const normalized = normalizedLoopPosition(position, length);
  const fraction = clamp((target - onset) / Math.max(1, duration), 0, 0.999999);
  const swungWidth = normalized % 2
    ? 1 - clamp(state.swing, 0, 0.42)
    : 1 + clamp(state.swing, 0, 0.42);
  return straightStepBoundary(normalized) + fraction * swungWidth;
}

function alignWebGpu303Phase({
  stepIndex = state.currentStreamStep,
  straightPhase,
  playbackTime = 0,
} = {}) {
  const length = puzzleMetrics().stickerStreamLength;
  const rate = clamp(state.tempo, 30, 300)
    * clamp(state.subdivisionsPerBeat, 1, 16) / 60;
  const targetPhase = Number.isFinite(Number(straightPhase))
    ? Number(straightPhase)
    : straightStepBoundary(normalizedLoopPosition(stepIndex, length));
  const raw = targetPhase - Math.max(0, Number(playbackTime) || 0) * rate;
  webGpu303SequencePhase = ((raw % length) + length) % length;
  return webGpu303SequencePhase;
}

function realignRunningWebGpu303Phase() {
  if (!webGpu303Engine || !isWebGpu303Preset()) return;
  alignWebGpu303Phase({
    straightPhase: webGpu303StraightPhaseAtDelay(0),
    playbackTime: webGpu303Engine.currentPlaybackTime?.() ?? 0,
  });
  queueWebGpu303Sync({ force: true });
}

function currentWebGpu303Pattern() {
  const pattern = createHyperRubixWebGpu303Pattern(state.puzzle, {
    rotation: audibleWebGpuRotation(),
    tempo: state.tempo,
    subdivisionsPerBeat: state.subdivisionsPerBeat,
    swing: state.swing,
    pitchInfluence: state.pitchInfluence,
    filterInfluence: state.filterInfluence,
    stereoInfluence: state.stereoInfluence,
    neighborResponse: state.neighborResponse,
    wInfluence: state.wInfluence,
    disorderInfluence: state.disorderInfluence,
    baseParams: {
      ...HYPER_RUBIX_WEBGPU_303_DEFAULTS,
      dur: clamp(state.decay * 0.42, 0.02, 1.6),
      flt: -30 + state.tone * 60,
      res: 2.2 + state.tone * 8.5,
      dist: 0.42 + hyperRubixDisorder(state.puzzle) * 1.8,
      sequencePhase: webGpu303SequencePhase,
    },
  });
  const stepModulation = Object.freeze(pattern.steps.map((step, index) => {
    const override = hyperbarGateOverrides.get(step.stickerId);
    if (override !== false) return pattern.stepModulation[index];
    return Object.freeze([0, ...pattern.stepModulation[index].slice(1)]);
  }));
  const mutedKey = pattern.steps
    .filter(({ stickerId }) => hyperbarGateOverrides.get(stickerId) === false)
    .map(({ stickerId }) => stickerId)
    .join(",");
  return Object.freeze({
    ...pattern,
    stepModulation,
    fingerprint: `${pattern.fingerprint}|muted:${mutedKey}`,
  });
}

function paintPresetHelp(message = "") {
  const help = $("voiceHelp");
  if (!help) return;
  if (message) {
    help.textContent = message;
    return;
  }
  const descriptions = {
    pulse: "Eight color drums. Projection controls tuning, filter, stereo position, neighbor resonance, and transient shape.",
    glass: "Eight resonant prism bodies. XYZW position spreads pitch and partials while matching neighbors ring together.",
    dust: "Eight clipped bit voices. Position controls register and brightness; fault lines add jitter, drive, and short noise edges.",
    "webgpu-303": `All ${puzzleMetrics().stickerStreamLength} sticker pitches run through the shared WebGPU acid engine; orbit and Fold W sweep its filter, resonance, stereo field, and sequence.`,
    rattlesnake: "Each sticker excites the continuous seed-shell. XYZW position, cohesion, faults, displacement, and disorder shape its grain motion.",
  };
  help.textContent = descriptions[state.voice] ?? descriptions.pulse;
}

function syncWebGpu303Pattern({ force = false } = {}) {
  if (!webGpu303Engine || !isWebGpu303Preset()) return false;
  try {
    const pattern = currentWebGpu303Pattern();
    if (!pattern.runtimeCompatible) throw new Error("The current puzzle exceeds the WebGPU sequence capacity.");
    if (!force && pattern.fingerprint === webGpu303PatternKey) return true;
    webGpu303PatternKey = pattern.fingerprint;
    webGpu303Engine.updateParams(pattern.params);
    webGpu303Engine.updateSequence(pattern.sequence);
    webGpu303Engine.updateStepModulation(pattern.stepModulation);
    return true;
  } catch (error) {
    void fallbackFromWebGpu303(error);
    return false;
  }
}

function queueWebGpu303Sync({ force = false } = {}) {
  if (!isWebGpu303Preset() || !webGpu303Engine) return;
  if (webGpu303SyncTimer !== null) clearTimeout(webGpu303SyncTimer);
  webGpu303SyncTimer = setTimeout(() => {
    webGpu303SyncTimer = null;
    syncWebGpu303Pattern({ force });
  }, force ? 0 : 34);
  webGpu303SyncTimer?.unref?.();
}

async function stopWebGpu303Engine() {
  webGpu303LifecycleGeneration += 1;
  webGpu303StartPromise = null;
  webGpu303PatternKey = "";
  if (webGpu303SyncTimer !== null) clearTimeout(webGpu303SyncTimer);
  webGpu303SyncTimer = null;
  const engine = webGpu303Engine;
  webGpu303Engine = null;
  if (engine) {
    engine.setPlaybackEnabled(false);
    engine.pauseTimeline();
    await engine.stop().catch(() => {});
  }
}

async function fallbackFromWebGpu303(error) {
  webGpu303Failed = true;
  await stopWebGpu303Engine();
  paintPresetHelp("WebGPU is unavailable here, so this preset is using its audible Web Audio acid fallback. The shape mapping and loop stay active.");
  if (error) console.warn("Hyper Rubix WebGPU 303 fallback", error);
}

async function resumeWebGpu303Timeline({ restartAtFirst = false } = {}) {
  const engine = webGpu303Engine;
  if (!engine || !state.audio || !state.playing || !isWebGpu303Preset()) return false;
  try {
    const startDelaySeconds = 0.055;
    alignWebGpu303Phase({
      straightPhase: restartAtFirst ? 0 : webGpu303StraightPhaseAtDelay(startDelaySeconds * 1_000),
      playbackTime: 0,
    });
    syncWebGpu303Pattern({ force: true });
    engine.setPlaybackEnabled(false);
    await engine.restartTimeline({
      startAt: audio.context.currentTime + startDelaySeconds,
      offset: 0,
    });
    if (engine !== webGpu303Engine || !state.playing || !isWebGpu303Preset()) return false;
    engine.setPlaybackEnabled(true);
    return true;
  } catch (error) {
    await fallbackFromWebGpu303(error);
    return false;
  }
}

async function startWebGpu303Engine({ alignToTransport = true, restartAtFirst = false } = {}) {
  if (!isWebGpu303Preset() || !state.audio || !audio.context || !audio.drumBus) return false;
  if (webGpu303Engine) {
    syncWebGpu303Pattern({ force: true });
    if (alignToTransport && state.playing) await resumeWebGpu303Timeline({ restartAtFirst });
    return true;
  }
  if (webGpu303StartPromise) return webGpu303StartPromise;
  const support = webGpu303Support(globalThis);
  if (!support.supported) {
    await fallbackFromWebGpu303(new Error("WebGPU audio is not supported."));
    return false;
  }
  alignWebGpu303Phase({
    straightPhase: restartAtFirst ? 0 : webGpu303StraightPhaseAtDelay(55),
    playbackTime: 0,
  });
  const pattern = currentWebGpu303Pattern();
  if (!pattern.runtimeCompatible) {
    await fallbackFromWebGpu303(new Error("The current puzzle exceeds the WebGPU sequence capacity."));
    return false;
  }
  webGpu303Failed = false;
  const generation = ++webGpu303LifecycleGeneration;
  const candidate = new WebGpu303Audio(globalThis, { chunkDuration: 0.055 });
  candidate.updateSequence(pattern.sequence);
  candidate.updateStepModulation(pattern.stepModulation);
  candidate.setOutput(1);
  candidate.setPlaybackEnabled(false);
  let pending;
  pending = candidate.start(pattern.params, {
    context: audio.context,
    destination: audio.drumBus,
    autoStart: false,
  }).then(async () => {
    if (generation !== webGpu303LifecycleGeneration || !isWebGpu303Preset()
      || candidate.context !== audio.context) {
      await candidate.stop().catch(() => {});
      return false;
    }
    webGpu303Engine = candidate;
    webGpu303PatternKey = pattern.fingerprint;
    candidate.setErrorHandler((renderError) => {
      if (candidate === webGpu303Engine) void fallbackFromWebGpu303(renderError);
    });
    paintPresetHelp();
    if (alignToTransport && state.playing) await resumeWebGpu303Timeline({ restartAtFirst });
    return true;
  }).catch(async (error) => {
    await candidate.stop().catch(() => {});
    if (generation === webGpu303LifecycleGeneration) await fallbackFromWebGpu303(error);
    return false;
  }).finally(() => {
    if (webGpu303StartPromise === pending) webGpu303StartPromise = null;
  });
  webGpu303StartPromise = pending;
  return pending;
}

function puzzleMetrics(sizeOrPuzzle = state.puzzle) {
  return hyperRubixSizeMetrics(sizeOrPuzzle);
}

function sequenceMethodConfig() {
  const definition = SEQUENCE_METHODS[state.sequenceMethod]
    ?? SEQUENCE_METHODS[DEFAULTS.sequenceMethod];
  const metrics = puzzleMetrics();
  return {
    ...definition,
    label: typeof definition.label === "function" ? definition.label(metrics) : definition.label,
    help: typeof definition.help === "function" ? definition.help(metrics) : definition.help,
    length: typeof definition.length === "function" ? definition.length(metrics) : definition.length,
  };
}

function puzzleOrderLabel(size = puzzleMetrics().size) {
  return Array.from({ length: 4 }, () => size).join(" × ");
}

function presetVoiceName(cellId) {
  const voice = HYPER_RUBIX_TECHNO_VOICES[cellId];
  if (state.voice === "glass") return `${voice?.color ?? "color"} prism`;
  if (state.voice === "dust") return `${voice?.color ?? "color"} bit`;
  if (state.voice === "webgpu-303") return `${voice?.color ?? "color"} acid`;
  if (state.voice === "rattlesnake") return `${voice?.color ?? "color"} scales`;
  return `${voice?.color ?? "color"} ${voice?.label ?? "voice"}`;
}

function paintFaceVoiceLabels() {
  for (const button of document.querySelectorAll("[data-face]")) {
    const cellId = button.dataset.face;
    const boundary = hyperRubixBoundaryCell(cellId);
    const label = presetVoiceName(cellId);
    const small = button.querySelector("small");
    if (small) small.textContent = label;
    button.setAttribute(
      "aria-label",
      `${cellId.toUpperCase()} boundary cell, ${boundary.color}, ${label}`,
    );
  }
}

function paintPuzzleMetrics() {
  const metrics = puzzleMetrics();
  const order = puzzleOrderLabel(metrics.size);
  $("puzzleSize").value = String(metrics.size);
  $("puzzleSizeHelp").textContent = `${metrics.size} per axis · ${metrics.stickerCount} stickers · ${metrics.hyperbarLength} spatial pulses`;
  $("puzzleOrderHeading").textContent = `${order} / PUZZLE INSTRUMENT`;
  canvas.setAttribute(
    "aria-label",
    `Interactive projected ${order} four-dimensional Rubix puzzle with ${metrics.stickerCount} colored hyper-stickers.`,
  );
  $("stickerStreamMethodOption").textContent = `Sticker loop · ${metrics.stickerStreamLength}`;
  $("cornerStreamMethodOption").textContent = `Corner stream · ${metrics.cornerStreamLength}`;
  $("stickerHyperbarMethodOption").textContent = `Sticker hyperbar · ${metrics.hyperbarLength}`;
  $("hybridCoilMethodOption").textContent = `Hybrid coil · 16 × ${metrics.hyperbarLength}`;
  $("hyperbarMatrixLabel").textContent = `${metrics.stickerCount}-sticker loop`;
  $("hyperbarMatrixSummary").textContent = `8 color lanes × ${metrics.hyperbarLength} addresses · one note per sticker`;
  $("rattleVoiceLabel").textContent = "Rattlesnake preset";
  $("puzzleGeometryGuide").textContent = `A tesseract has eight cubic boundary cells. Each one carries a ${metrics.size} × ${metrics.size} × ${metrics.size} field of color, so this order-${metrics.size} puzzle has ${metrics.stickerCount} stickers.`;
  $("hyperbarGeometryGuide").textContent = `The visible matrix lays out eight colored boundary cells across ${metrics.hyperbarLength} spatial addresses. The loop visits all ${metrics.stickerStreamLength} stickers separately, so there are no authored rests unless you mute a sticker yourself.`;
  $("streamGeometryGuide").textContent = `Time is the bright cursor moving through the sticker matrix. This order-${metrics.size} shape has ${metrics.stickerStreamLength} notes. The clock never twists the puzzle; manual orbiting, fourth-axis folding, and quarter-turns change the running sound without resetting its place.`;
  $("serializationInstructions").textContent = `The loop visits all ${metrics.stickerStreamLength} stickers separately in a stable forward order; its bright cursor shows time.`;
  const grid = $("hyperbarGrid");
  grid.style.setProperty("--hyperbar-columns", metrics.hyperbarLength);
  grid.setAttribute("aria-colcount", String(metrics.hyperbarLength));
  grid.setAttribute("aria-label", `Eight color lanes containing ${metrics.stickerStreamLength} sticker notes`);
  paintPresetHelp();
}

function representativeStickerEventsForMove(move) {
  const snapshot = hyperbarSnapshot ?? createHyperRubixHyperbarSnapshot(state.puzzle);
  const stickers = new Map(state.puzzle.stickers.map((sticker) => [sticker.id, sticker]));
  const candidates = snapshot.flatMap((slot) => slot.events.map((event) => ({
    event,
    stepIndex: slot.index,
  }))).filter(({ event }) => {
    const sticker = stickers.get(event.stickerId);
    return sticker && hyperRubixMoveAffectsSticker(sticker, move);
  }).sort((first, second) => {
    const firstScore = Number(hyperbarEventIsActive(first.event)) * 4
      + Number(first.event.accent) * 2
      + (first.event.configuration?.neighborDiversity ?? 0);
    const secondScore = Number(hyperbarEventIsActive(second.event)) * 4
      + Number(second.event.accent) * 2
      + (second.event.configuration?.neighborDiversity ?? 0);
    return secondScore - firstScore || first.event.stickerId.localeCompare(second.event.stickerId);
  });
  const byVoice = new Map();
  for (const candidate of candidates) {
    if (!byVoice.has(candidate.event.homeCell)) byVoice.set(candidate.event.homeCell, candidate);
  }
  return HYPER_RUBIX_CELL_ORDER.map((cellId) => byVoice.get(cellId)).filter(Boolean);
}

function aggregateStickerConfiguration(events) {
  if (!events.length) return null;
  return {
    neighborCount: events.reduce(
      (sum, event) => sum + event.configuration.neighborCount,
      0,
    ) / events.length,
    sameColorNeighbors: events.reduce(
      (sum, event) => sum + event.configuration.sameColorNeighbors,
      0,
    ) / events.length,
    neighborDiversity: events.reduce(
      (sum, event) => sum + event.configuration.neighborDiversity,
      0,
    ) / events.length,
    displaced: events.some((event) => event.configuration.displaced),
  };
}

function auditionManualMove(move, scheduledWhen = audio.context?.currentTime) {
  if (!state.audio || !audio.context) return;
  const method = sequenceMethodConfig();
  const geometry = audioGeometryForCell(move.cell, move.plane);
  const representatives = method.hyperbar || isRattlesnakePreset()
    ? representativeStickerEventsForMove(move)
    : [];
  if (method.legacy) audio.strike(move, scheduledWhen, method.hyperbar ? 0.72 : 1);
  if (method.hyperbar && !isRattlesnakePreset()) {
    representatives.forEach(({ event, stepIndex }, index) => {
      audio.strikeSticker(event, scheduledWhen + index * 0.011, 0.54, {
        ...audioGeometryForStickerEvent(event, stepIndex),
        direction: move.quarterTurns,
      });
    });
  }
  if (isRattlesnakePreset()) {
    representatives.forEach(({ event, stepIndex }, index) => {
      audio.strikeStickerTopology(event, scheduledWhen + index * 0.011, 0.72, {
        ...audioGeometryForStickerEvent(event, stepIndex),
        direction: move.quarterTurns,
      });
    });
    audio.scheduleRattleStep(move, scheduledWhen, 0.22, {
      ...geometry,
      configuration: aggregateStickerConfiguration(representatives.map(({ event }) => event)),
    }, 1.35);
  }
}

function announce(message) {
  $("liveStatus").textContent = message;
}

function sequencePatternLabel() {
  return HYPER_RUBIX_SEQUENCE_PATTERNS[state.patternId]?.label ?? "Twist tape";
}

function sequenceRandomSource() {
  return createSeededHyperRubixRandom(0x48595045 + sequenceGeneration * 0x9e3779b9);
}

function rebuildSequence({ reseed = false, resetPosition = true } = {}) {
  if (reseed) sequenceGeneration += 1;
  sequence = createHyperRubixSequence(
    state.patternId,
    state.twistDensity,
    sequenceRandomSource(),
  );
  if (resetPosition) {
    transportPosition = 0;
    state.currentStep = hyperRubixSequenceIndex(
      state.playbackMode,
      0,
      HYPER_RUBIX_SEQUENCE_LENGTH,
      sequenceRandomSource(),
    );
  }
  renderSequenceStrip();
  updateSequencePlayhead(state.currentStep);
  if ($("sequenceMethodHelp")) paintSequenceMethodHelp();
  paintTransport();
}

function renderSequenceStrip() {
  const fragment = document.createDocumentFragment();
  sequenceStepElements = sequence.map((step, index) => {
    const marker = document.createElement("span");
    const move = step.move;
    const active = Boolean(step.active && move);
    const drum = move ? HYPER_RUBIX_PLANE_DRUMS[move.plane] : null;
    marker.className = `hyper-rubix-step${active ? "" : " is-rest"}`;
    marker.dataset.sequenceStep = String(index);
    marker.style.setProperty(
      "--step-color",
      move ? hyperRubixBoundaryCell(move.cell).fill : "var(--faint)",
    );
    marker.setAttribute(
      "aria-label",
      active
        ? `Step ${index + 1}: ${move.plane.toUpperCase()} ${drum?.label ?? "drum"}, ${move.cell.toUpperCase()} cell, ${move.quarterTurns > 0 ? "plus" : "minus"} 90 degrees`
        : `Step ${index + 1}: rest`,
    );
    const label = document.createElement("b");
    label.textContent = active ? move.plane.toUpperCase() : "·";
    marker.append(label);
    fragment.append(marker);
    return marker;
  });
  $("stepStrip").replaceChildren(fragment);
}

function hyperbarEventIsActive(event, serial = sequenceMethodConfig().serial) {
  if (!hyperbarEventInScope(event)) return false;
  return hyperbarGateOverrides.has(event.stickerId)
    ? hyperbarGateOverrides.get(event.stickerId)
    : serial || Boolean(event.gate);
}

function hyperbarEventInScope(event, method = sequenceMethodConfig()) {
  return !method.serial || !method.cornersOnly || event.configuration.radialClass === "corner";
}

function hyperbarButtons() {
  return hyperbarStepElements.flat().filter((button) => !button.disabled);
}

function setHyperbarTabStop(button, { focus = false } = {}) {
  const buttons = hyperbarButtons();
  if (!buttons.length) return;
  const target = buttons.includes(button)
    ? button
    : buttons.find(({ dataset }) => dataset.stickerId === hyperbarFocusStickerId) ?? buttons[0];
  hyperbarFocusStickerId = target.dataset.stickerId;
  for (const candidate of buttons) candidate.tabIndex = candidate === target ? 0 : -1;
  if (!focus) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function moveHyperbarFocus(event, rowIndex, stepIndex) {
  const hyperbarLength = puzzleMetrics().hyperbarLength;
  let nextRow = rowIndex;
  let nextStep = stepIndex;
  if (event.key === "ArrowLeft") nextStep = Math.max(0, stepIndex - 1);
  else if (event.key === "ArrowRight") {
    nextStep = Math.min(hyperbarLength - 1, stepIndex + 1);
  } else if (event.key === "ArrowUp") nextRow = Math.max(0, rowIndex - 1);
  else if (event.key === "ArrowDown") {
    nextRow = Math.min(HYPER_RUBIX_CELL_ORDER.length - 1, rowIndex + 1);
  } else if (event.key === "Home") {
    nextRow = event.ctrlKey ? 0 : rowIndex;
    nextStep = 0;
  } else if (event.key === "End") {
    nextRow = event.ctrlKey ? HYPER_RUBIX_CELL_ORDER.length - 1 : rowIndex;
    nextStep = hyperbarLength - 1;
  } else {
    return;
  }
  const stepDirection = Math.sign(nextStep - stepIndex);
  const rowDirection = Math.sign(nextRow - rowIndex);
  let candidate = hyperbarStepElements[nextStep]?.[nextRow];
  while (candidate?.disabled && (stepDirection || rowDirection)) {
    const candidateStep = nextStep + stepDirection;
    const candidateRow = nextRow + rowDirection;
    if (candidateStep < 0 || candidateStep >= hyperbarLength
      || candidateRow < 0 || candidateRow >= HYPER_RUBIX_CELL_ORDER.length) break;
    nextStep = candidateStep;
    nextRow = candidateRow;
    candidate = hyperbarStepElements[nextStep]?.[nextRow];
  }
  event.preventDefault();
  setHyperbarTabStop(candidate, { focus: true });
}

function renderHyperbarGrid() {
  const grid = $("hyperbarGrid");
  const metrics = puzzleMetrics();
  grid.style.setProperty("--hyperbar-columns", metrics.hyperbarLength);
  grid.setAttribute("aria-colcount", String(metrics.hyperbarLength));
  grid.setAttribute(
    "aria-label",
    `Eight color lanes containing ${metrics.stickerStreamLength} sticker notes`,
  );
  const previouslyFocused = document.activeElement;
  const restoreFocus = hyperbarButtons().includes(previouslyFocused);
  if (restoreFocus) hyperbarFocusStickerId = previouslyFocused.dataset.stickerId;
  if (!hyperbarSnapshot || !sequenceMethodConfig().hyperbar) {
    hyperbarStepElements = [];
    hyperbarButtonByStickerId = new Map();
    currentHyperbarElements = [];
    grid.replaceChildren();
    return;
  }
  const fragment = document.createDocumentFragment();
  hyperbarStepElements = Array.from({ length: metrics.hyperbarLength }, () => []);
  hyperbarButtonByStickerId = new Map();
  currentHyperbarElements = [];
  for (const [rowIndex, cellId] of HYPER_RUBIX_CELL_ORDER.entries()) {
    const row = document.createElement("div");
    const boundary = hyperRubixBoundaryCell(cellId);
    row.className = "hyper-rubix-hyperbar-row";
    row.setAttribute("role", "row");
    row.setAttribute("aria-label", `${cellId.toUpperCase()} voice lane`);
    row.setAttribute("aria-rowindex", String(rowIndex + 1));
    row.style.setProperty("--voice-color", boundary.fill);
    const rowLabel = document.createElement("b");
    rowLabel.textContent = cellId.toUpperCase();
    rowLabel.setAttribute("aria-hidden", "true");
    row.append(rowLabel);
    for (const slot of hyperbarSnapshot) {
      const event = slot.events.find((candidate) => candidate.cell === cellId);
      if (!event) continue;
      const eventBoundary = hyperRubixBoundaryCell(event.homeCell);
      const voiceLabel = presetVoiceName(event.homeCell);
      const button = document.createElement("button");
      const inScope = hyperbarEventInScope(event);
      const active = hyperbarEventIsActive(event);
      button.type = "button";
      button.disabled = !inScope;
      button.className = `hyper-rubix-hyperbar-cell${active ? " is-on" : ""}${event.accent ? " is-accent" : ""}${event.configuration.displaced ? " is-displaced" : ""}${inScope ? "" : " is-unavailable"}`;
      if (slot.index > 0 && slot.index % (metrics.size ** 2) === 0) {
        button.classList.add("is-group-start");
      }
      button.dataset.stickerId = event.stickerId;
      button.dataset.hyperbarStep = String(slot.index);
      button.dataset.hyperbarRow = String(rowIndex);
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-colindex", String(slot.index + 1));
      button.setAttribute("aria-selected", String(active));
      button.setAttribute(
        "aria-label",
        `${cellId.toUpperCase()} position, address ${slot.index + 1}, ${voiceLabel}, ${event.configuration.radialClass}, ${event.configuration.sameColorNeighbors} of ${event.configuration.neighborCount} neighbors match, ${inScope ? active ? "on" : "off" : "outside this loop"}`,
      );
      button.title = `${String(slot.index + 1).padStart(2, "0")} · ${voiceLabel} · ${event.configuration.radialClass} · ${Math.round(event.configuration.neighborDiversity * 100)}% mixed`;
      button.style.setProperty("--voice-color", eventBoundary.fill);
      button.addEventListener("focus", () => setHyperbarTabStop(button));
      button.addEventListener("keydown", (keyEvent) => {
        moveHyperbarFocus(keyEvent, rowIndex, slot.index);
      });
      button.addEventListener("click", () => {
        setHyperbarTabStop(button);
        const next = !hyperbarEventIsActive(event);
        hyperbarGateOverrides.set(event.stickerId, next);
        queueWebGpu303Sync();
        button.classList.toggle("is-on", next);
        button.setAttribute("aria-selected", String(next));
        button.setAttribute(
          "aria-label",
          `${cellId.toUpperCase()} position, address ${slot.index + 1}, ${voiceLabel}, ${event.configuration.radialClass}, ${event.configuration.sameColorNeighbors} of ${event.configuration.neighborCount} neighbors match, ${next ? "on" : "off"}`,
        );
        if (!state.playing && sequenceMethodConfig().serial) paintSerialIdlePlayhead();
        announce(`${voiceLabel}, sticker ${event.stickerId}, ${next ? "on" : "muted"}.`);
      });
      hyperbarStepElements[slot.index].push(button);
      hyperbarButtonByStickerId.set(event.stickerId, button);
      row.append(button);
    }
    fragment.append(row);
  }
  grid.replaceChildren(fragment);
  const focusTarget = hyperbarButtons().find(
    ({ dataset }) => dataset.stickerId === hyperbarFocusStickerId,
  );
  setHyperbarTabStop(focusTarget, { focus: restoreFocus });
  if (sequenceMethodConfig().serial) {
    if (state.playing) paintSerialPlayheadAt(state.currentStreamStep);
    else paintSerialIdlePlayhead();
  }
  else updateHyperbarPlayhead(state.currentHyperbarStep);
}

function rebuildHyperbarSnapshot() {
  hyperbarSnapshot = createHyperRubixHyperbarSnapshot(state.puzzle);
  renderHyperbarGrid();
}

function updateHyperbarPlayhead(stepIndex) {
  const hyperbarLength = puzzleMetrics().hyperbarLength;
  const normalized = ((Number(stepIndex) % hyperbarLength)
    + hyperbarLength) % hyperbarLength;
  state.currentHyperbarStep = normalized;
  for (const element of currentHyperbarElements) {
    element.classList.remove("is-current");
    element.removeAttribute("aria-current");
  }
  currentHyperbarElements = (hyperbarStepElements[normalized] ?? [])
    .filter((element) => !element.disabled);
  for (const element of currentHyperbarElements) {
    element.classList.add("is-current");
    element.setAttribute("aria-current", "step");
  }
  $("hyperbarReadout").textContent = `PULSE ${String(normalized + 1).padStart(2, "0")} / ${hyperbarLength}`;
}

function followHyperbarPlayhead(button) {
  if (!button || document.activeElement?.classList?.contains("hyper-rubix-hyperbar-cell")) return;
  const grid = $("hyperbarGrid");
  const gridBounds = grid.getBoundingClientRect?.();
  const buttonBounds = button.getBoundingClientRect?.();
  if (!gridBounds || !buttonBounds) return;
  const leftOverflow = buttonBounds.left - gridBounds.left;
  const rightOverflow = buttonBounds.right - gridBounds.right;
  if (leftOverflow < 0) grid.scrollLeft += leftOverflow - 8;
  else if (rightOverflow > 0) grid.scrollLeft += rightOverflow + 8;
}

function updateHyperbarEventPlayhead(event, streamIndex, streamLength) {
  state.currentStreamStep = streamIndex;
  for (const element of currentHyperbarElements) {
    element.classList.remove("is-current");
    element.removeAttribute("aria-current");
  }
  const button = hyperbarButtonByStickerId.get(event?.stickerId);
  button?.classList.add("is-current");
  button?.setAttribute("aria-current", "step");
  currentHyperbarElements = button ? [button] : [];
  followHyperbarPlayhead(button);
  const pulse = Number.isFinite(streamIndex) ? streamIndex + 1 : 1;
  $("hyperbarReadout").textContent = `STICKER ${String(pulse).padStart(3, "0")} / ${streamLength}`;
}

function paintSerialPlayheadAt(streamIndex) {
  const method = sequenceMethodConfig();
  if (!method.serial || !hyperbarSnapshot) return;
  const stream = createHyperRubixStickerStream(state.puzzle, {
    cornersOnly: method.cornersOnly,
  });
  const normalized = normalizedLoopPosition(streamIndex, stream.length);
  const event = stream[normalized];
  if (!event) return;
  const slotIndex = hyperRubixStickerStepIndex({
    position: event.position,
    normal: hyperRubixBoundaryCell(event.cell).normal,
  }, state.puzzle);
  updateHyperbarEventPlayhead(event, normalized, method.length);
  updateTimelineReadout(method, {
    stepIndex: state.currentStep,
    hyperbarStepIndex: slotIndex,
    activeEvents: hyperbarEventIsActive(event, true) ? [event] : [],
    streamIndex: normalized,
    streamEvent: event,
  });
  updateStatus();
}

function paintSerialIdlePlayhead() {
  const method = sequenceMethodConfig();
  if (!method.serial || !hyperbarSnapshot) return;
  const stream = createHyperRubixStickerStream(state.puzzle, {
    cornersOnly: method.cornersOnly,
  });
  const streamIndex = serialPlaybackStartIndex(stream.length);
  const event = stream[streamIndex];
  const slotIndex = event
    ? hyperRubixStickerStepIndex({
        position: event.position,
        normal: hyperRubixBoundaryCell(event.cell).normal,
      }, state.puzzle)
    : 0;
  updateHyperbarEventPlayhead(event, streamIndex, method.length);
  updateTimelineReadout(method, {
    stepIndex: state.currentStep,
    hyperbarStepIndex: slotIndex,
    activeEvents: event && hyperbarEventIsActive(event, true) ? [event] : [],
    streamIndex,
    streamEvent: event,
  });
  updateStatus();
}

function paintSequenceMethodHelp() {
  const method = sequenceMethodConfig();
  $("sequenceMethodHelp").textContent = `${method.help} · no automatic turns; manual movement reshapes the running score`;
}

function paintSequenceMethod() {
  paintPuzzleMetrics();
  const method = sequenceMethodConfig();
  $("sequenceMethod").value = state.sequenceMethod;
  paintSequenceMethodHelp();
  $("hyperbarPanel").hidden = !method.hyperbar;
  $("stepStrip").hidden = !method.autoTwist;
  $("sequencePattern").disabled = !method.autoTwist;
  $("twistDensity").disabled = !method.autoTwist;
  if ($("twistMotion")) $("twistMotion").disabled = !method.autoTwist;
  if (method.hyperbar) renderHyperbarGrid();
  else $("hyperbarGrid").replaceChildren();
}

function updateSequencePlayhead(stepIndex) {
  for (const marker of sequenceStepElements) marker.classList.remove("is-current");
  const normalized = ((Number(stepIndex) % HYPER_RUBIX_SEQUENCE_LENGTH)
    + HYPER_RUBIX_SEQUENCE_LENGTH) % HYPER_RUBIX_SEQUENCE_LENGTH;
  state.currentStep = normalized;
  sequenceStepElements[normalized]?.classList.add("is-current");
  const step = sequence[normalized];
  const move = step?.active ? step.move : null;
  if (!move) {
    $("sequenceNow").textContent = `STEP ${String(normalized + 1).padStart(2, "0")} · REST`;
    $("sequenceVoice").textContent = "SILENT GRID";
    updateStatus();
    return;
  }
  const drum = HYPER_RUBIX_PLANE_DRUMS[move.plane];
  $("sequenceNow").textContent = `STEP ${String(normalized + 1).padStart(2, "0")} · ${move.plane.toUpperCase()} · ${move.cell.toUpperCase()}`;
  $("sequenceVoice").textContent = `${drum?.label?.toUpperCase() ?? "DRUM"} · ${move.quarterTurns > 0 ? "+90°" : "−90°"}`;
  updateStatus();
}

function updateTimelineReadout(method, {
  stepIndex,
  hyperbarStepIndex,
  activeEvents,
  streamIndex,
  streamEvent,
} = {}) {
  updateSequencePlayhead(stepIndex);
  if (method.serial) {
    const soundingEvent = activeEvents[0];
    const topology = soundingEvent?.topology;
    const faultCount = topology?.connections?.filter(({ sameColor }) => !sameColor).length ?? 0;
    $("sequenceNow").textContent = soundingEvent
      ? `STICKER ${String(streamIndex + 1).padStart(3, "0")} / ${method.length} · ${streamEvent.homeCell.toUpperCase()}`
      : `STICKER ${String(streamIndex + 1).padStart(3, "0")} / ${method.length} · MUTED`;
    $("sequenceVoice").textContent = soundingEvent
      ? `${presetVoiceName(soundingEvent.homeCell).toUpperCase()} · ${soundingEvent.configuration.radialClass.toUpperCase()} · ${topology?.neighborCount ?? soundingEvent.configuration.neighborCount} LINKS / ${faultCount} FAULTS`
      : "MUTED STICKER";
    return;
  }
  if (!method.hyperbar) return;
  const count = activeEvents.length;
  const topologyLinks = activeEvents.reduce(
    (sum, event) => sum + (event.topology?.neighborCount ?? event.configuration.neighborCount),
    0,
  );
  const topologyFaults = activeEvents.reduce(
    (sum, event) => sum + (event.topology?.connections?.filter(({ sameColor }) => !sameColor).length ?? 0),
    0,
  );
  const tapeStep = sequence[stepIndex];
  const tapeLabel = method.legacy && (!tapeStep?.active || !tapeStep.move)
    ? " · TAPE REST"
    : "";
  $("sequenceNow").textContent = `PULSE ${String(hyperbarStepIndex + 1).padStart(2, "0")} / ${puzzleMetrics().hyperbarLength} · ${count} STICKER${count === 1 ? "" : "S"}${tapeLabel}`;
  $("sequenceVoice").textContent = count
    ? `${topologyLinks} LINKS / ${topologyFaults} FAULTS · ${activeEvents.map(({ voice }) => voice.label.toUpperCase()).join(" · ")}`
    : "MUTED PULSE";
}

function paintTransport() {
  const rate = RATE_LABELS[state.subdivisionsPerBeat] ?? "1/8";
  const method = sequenceMethodConfig();
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playLabel").textContent = state.playing
    ? "Pause shape loop"
    : "Play shape loop";
  $("playState").textContent = state.playing
    ? `${method.length} notes · ${rate} · running`
    : `${method.length} stickers · one note each`;
  const restartLabel = "Restart shape loop at its first sticker";
  $("restartLoop").setAttribute("aria-label", restartLabel);
  $("restartLoop").setAttribute("title", restartLabel);
  $("restartInstructions").textContent = `Press R to ${restartLabel.replace(/^Restart /, "restart ")}.`;
  $("clockSummary").textContent = `${method.length} notes · ${Math.round(state.tempo)} BPM · ${rate}`;
  $("sequencePattern").value = state.patternId;
  $("playbackMode").value = state.playbackMode;
  $("twistRate").value = String(state.subdivisionsPerBeat);
  if ($("twistMotion")) $("twistMotion").value = method.autoTwist ? state.twistMotion : "off";
  $("reseedPattern").disabled = !method.autoTwist || state.patternId !== "random-walk";
}

function clearVisualTimers() {
  for (const timer of visualTimers) clearTimeout(timer);
  visualTimers = new Set();
}

function clearScheduler({ hardAudio = false } = {}) {
  if (schedulerTimer !== null) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  clearVisualTimers();
  clearSoundingStickerPulses();
  audio.cancelTransportAudio(undefined, { hard: hardAudio });
}

function nextPositionAfterAudiblePulse() {
  return transportVisualPosition >= 0 ? transportVisualPosition + 1 : 0;
}

function resumeTransportClock({ delayMs = 55, hardAudio = false } = {}) {
  if (!state.playing) return;
  clearScheduler({ hardAudio });
  transportPuzzle = state.puzzle;
  rebuildTransportStickerStream(sequenceMethodConfig(), state.puzzle);
  nextStepAtMs = performance.now() + Math.max(12, Number(delayMs) || 0);
  schedulerTick();
  if (isWebGpu303Preset() && state.audio) {
    void startWebGpu303Engine({ alignToTransport: true });
  }
}

function remapRunningPreset() {
  audio.silenceFold(undefined, { immediate: true });
  if (!state.playing) {
    audio.cancelTransportAudio(undefined, { hard: true });
    return;
  }
  transportPosition = nextPositionAfterAudiblePulse();
  resumeTransportClock({ delayMs: 30, hardAudio: true });
}

function rebuildTransportStickerStream(method, puzzle = state.puzzle) {
  transportStickerStream = method.serial
    ? [...createHyperRubixStickerStream(puzzle, { cornersOnly: method.cornersOnly })]
    : [];
  pendingTransportStickerStream = null;
  transportRandomOrder = [];
  transportRandomCycle = -1;
  transportHyperbarPuzzle = null;
  transportHyperbarSnapshot = null;
}

function transportHyperbarFor(puzzle) {
  if (transportHyperbarPuzzle !== puzzle || !transportHyperbarSnapshot) {
    transportHyperbarPuzzle = puzzle;
    transportHyperbarSnapshot = createHyperRubixHyperbarSnapshot(puzzle);
  }
  return transportHyperbarSnapshot;
}

function shuffledSerialOrder(length, cycle) {
  const random = createSeededHyperRubixRandom(
    (0x5354524d + sequenceGeneration * 0x9e3779b9 + cycle * 0x85ebca6b) >>> 0,
  );
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [order[index], order[target]] = [order[target], order[index]];
  }
  return order;
}

function serialPlaybackStartIndex(length) {
  if (state.playbackMode === "random") return shuffledSerialOrder(length, 0)[0];
  return hyperRubixSequenceIndex(
    state.playbackMode,
    0,
    length,
    sequenceRandomSource(),
  );
}

function serialPlaybackIndex(position, length) {
  if (state.playbackMode !== "random") {
    return hyperRubixSequenceIndex(state.playbackMode, position, length, sequenceRandomSource());
  }
  const cycle = Math.floor(position / length);
  if (cycle !== transportRandomCycle || transportRandomOrder.length !== length) {
    transportRandomCycle = cycle;
    transportRandomOrder = shuffledSerialOrder(length, cycle);
  }
  return transportRandomOrder[position % length];
}

function serialPlaybackPeriod(length) {
  return state.playbackMode === "pendulum" ? Math.max(1, 2 * (length - 1)) : length;
}

function sequenceMethodName(method = sequenceMethodConfig()) {
  return method.label.replace(/\s*·.*$/, "");
}

function restartPositionPhrase(method = sequenceMethodConfig()) {
  if (state.playbackMode === "reverse") return "at its Reverse playback start";
  if (state.playbackMode === "pendulum") return "at its Pendulum playback start";
  if (state.playbackMode === "random") return "at the start of its seeded Random shuffle";
  return method.serial ? "at its first sticker" : "at step one";
}

function restartAnnouncement(method = sequenceMethodConfig()) {
  return `${sequenceMethodName(method)} restarted ${restartPositionPhrase(method)}.`;
}

function transportMotionStride(method) {
  if (!method.autoTwist || state.twistMotion === "off") return Number.POSITIVE_INFINITY;
  if (state.twistMotion === "beat") return Math.max(1, state.subdivisionsPerBeat);
  if (state.twistMotion === "bar") return Math.max(1, state.subdivisionsPerBeat * 4);
  const averageStepDurationMs = 60_000
    / clamp(state.tempo, 30, 300)
    / state.subdivisionsPerBeat;
  const required = Math.max(1, 250 / Math.max(1, averageStepDurationMs));
  return 2 ** Math.ceil(Math.log2(required));
}

function transportAnimationDuration(stepDurationMs, motionStride = 1) {
  return reduceMotion ? 1 : clamp(stepDurationMs * motionStride * 0.65, 90, 320);
}

function stickerSoundPulseDuration(stepDurationMs) {
  return reduceMotion ? 180 : clamp(stepDurationMs * 0.86, 220, 520);
}

function topologyVisualStickerIds(method, events) {
  const primaryIds = events.map(({ stickerId }) => stickerId);
  if (!method.serial || state.topologyMode === "off" || state.topologyLevel <= 0) {
    return primaryIds;
  }
  const neighborIds = events.flatMap((event) => (event.topology?.connections ?? [])
    .filter((connection) => (
      state.topologyMode === "mesh"
      || (state.topologyMode === "cohesion" && connection.sameColor)
      || (state.topologyMode === "faults" && !connection.sameColor)
    ))
    .map(({ stickerId }) => stickerId));
  return [...primaryIds, ...neighborIds];
}

function launchSequenceStep(
  step,
  transportStepPosition,
  stepIndex,
  hyperbarStepIndex,
  animationDuration,
  soundingStickerIds,
  soundingDuration,
  activeEvents,
  streamIndex,
  streamEvent,
  motionDue,
) {
  if (!state.playing) return;
  transportVisualPosition = transportStepPosition;
  transportVisualStartedAtMs = performance.now();
  const method = sequenceMethodConfig();
  updateTimelineReadout(method, {
    stepIndex,
    hyperbarStepIndex,
    activeEvents,
    streamIndex,
    streamEvent,
  });
  if (method.serial) updateHyperbarEventPlayhead(streamEvent, streamIndex, method.length);
  else if (method.hyperbar) updateHyperbarPlayhead(hyperbarStepIndex);
  if (Array.isArray(soundingStickerIds)) {
    pulseSoundingStickerIds(soundingStickerIds, soundingDuration, performance.now(), {
      retainTrail: method.serial,
    });
  }
  updateStatus();
  if (!motionDue || !step?.active || !step.move) return;
  state.selectedCell = step.move.cell;
  state.selectedPlane = step.move.plane;
  updateSelectionUI();
  enqueueMove(step.move, {
    duration: animationDuration,
    announce: false,
    soundAtStart: false,
    source: "transport",
  });
}

function scheduleVisualSequenceStep(
  step,
  transportStepPosition,
  stepIndex,
  hyperbarStepIndex,
  targetTimeMs,
  animationDuration,
  soundingStickerIds,
  soundingDuration,
  activeEvents,
  streamIndex,
  streamEvent,
  motionDue,
) {
  const delay = Math.max(0, targetTimeMs - performance.now());
  const timer = setTimeout(() => {
    visualTimers.delete(timer);
    launchSequenceStep(
      step,
      transportStepPosition,
      stepIndex,
      hyperbarStepIndex,
      animationDuration,
      soundingStickerIds,
      soundingDuration,
      activeEvents,
      streamIndex,
      streamEvent,
      motionDue,
    );
  }, delay);
  timer?.unref?.();
  visualTimers.add(timer);
}

function schedulerTick() {
  if (!state.playing) return;
  const nowMs = performance.now();
  if (!Number.isFinite(nextStepAtMs) || nextStepAtMs < nowMs - 50) {
    nextStepAtMs = nowMs + 30;
  }
  const horizon = nowMs + LOOKAHEAD_MS;
  let scheduledSteps = 0;
  while (nextStepAtMs < horizon && scheduledSteps < 24) {
    const position = transportPosition;
    const method = sequenceMethodConfig();
    if (method.serial && position > 0
      && position % serialPlaybackPeriod(method.length) === 0
      && pendingTransportStickerStream) {
      transportStickerStream = pendingTransportStickerStream;
      pendingTransportStickerStream = null;
    }
    const stepIndex = hyperRubixSequenceIndex(
      state.playbackMode,
      position,
      HYPER_RUBIX_SEQUENCE_LENGTH,
      Math.random,
    );
    const step = sequence[stepIndex];
    const hyperbarStepIndex = hyperRubixSequenceIndex(
      state.playbackMode,
      position,
      puzzleMetrics(transportPuzzle ?? state.puzzle).hyperbarLength,
      Math.random,
    );
    const stepDurationMs = hyperRubixStepDurationSeconds(
      state.tempo,
      state.subdivisionsPerBeat,
      state.swing,
      position,
    ) * 1_000;
    const motionStride = transportMotionStride(method);
    const motionDue = Number.isFinite(motionStride) && position % motionStride === 0;
    const streamIndex = method.serial
      ? serialPlaybackIndex(position, transportStickerStream.length)
      : -1;
    const streamEvent = method.serial ? transportStickerStream[streamIndex] : null;
    const predictedHyperbar = !method.serial && (method.hyperbar || state.rattleEnabled)
      ? transportHyperbarFor(transportPuzzle ?? state.puzzle)
      : null;
    const resolvedHyperbarStepIndex = method.serial
      ? streamEvent
        ? hyperRubixStickerStepIndex({
            position: streamEvent.position,
            normal: hyperRubixBoundaryCell(streamEvent.cell).normal,
          }, transportPuzzle ?? state.puzzle)
        : 0
      : hyperbarStepIndex;
    const hyperbarSlot = predictedHyperbar?.[resolvedHyperbarStepIndex] ?? null;
    const activeHyperbarEvents = method.serial
      ? streamEvent && hyperbarEventIsActive(streamEvent, true) ? [streamEvent] : []
      : (hyperbarSlot?.events ?? []).filter((event) => hyperbarEventIsActive(event, false));
    if (state.audio && audio.context) {
      const scheduledWhen = audio.context.currentTime
        + Math.max(0, nextStepAtMs - nowMs) / 1_000;
      audio.withTransportScope(() => {
        if (method.legacy && step?.active && step.move) {
          if (method.hyperbar) {
            audio.strike(step.move, scheduledWhen, (step.accent ? 1.16 : 0.78) * 0.72);
          } else {
            audio.strike(step.move, scheduledWhen, step.accent ? 1.16 : 0.78);
          }
        }
        if (method.hyperbar && !isRattlesnakePreset()
          && (!isWebGpu303Preset() || !webGpu303Engine || webGpu303Failed)) {
          for (const event of activeHyperbarEvents) {
            const geometry = {
              ...audioGeometryForStickerEvent(event, resolvedHyperbarStepIndex),
              maxDurationSeconds: clamp(stepDurationMs / 1_000 * 4, 0.035, 2.4),
            };
            audio.strikeSticker(event, scheduledWhen, event.accent ? 1.04 : 0.76, geometry);
          }
        }
        if (method.hyperbar && (
          isRattlesnakePreset()
          || (isWebGpu303Preset() && webGpu303Engine && !webGpu303Failed)
        )) {
          for (const event of activeHyperbarEvents) {
            audio.strikeStickerTopology(
              event,
              scheduledWhen,
              event.accent ? 1.04 : 0.76,
              audioGeometryForStickerEvent(event, resolvedHyperbarStepIndex),
            );
          }
        }
        if (isRattlesnakePreset() && activeHyperbarEvents.length) {
          const internalEvents = activeHyperbarEvents;
          const representative = internalEvents[0];
          const aggregateConfiguration = aggregateStickerConfiguration(internalEvents);
          const rattleMove = representative
            ? { cell: representative.homeCell }
            : step?.active ? step.move : null;
          const geometry = representative
            ? {
                ...audioGeometryForStickerEvent(representative, resolvedHyperbarStepIndex),
                configuration: aggregateConfiguration,
              }
            : audioGeometryForCell(state.selectedCell, state.selectedPlane);
          audio.scheduleRattleStep(
            rattleMove,
            scheduledWhen,
            stepDurationMs / 1_000,
            geometry,
            representative?.accent ? 1.18 : 0.92,
          );
        }
      });
    }
    scheduleVisualSequenceStep(
      step,
      position,
      stepIndex,
      resolvedHyperbarStepIndex,
      nextStepAtMs,
      transportAnimationDuration(stepDurationMs, Number.isFinite(motionStride) ? motionStride : 1),
      method.hyperbar ? topologyVisualStickerIds(method, activeHyperbarEvents) : null,
      stickerSoundPulseDuration(stepDurationMs),
      activeHyperbarEvents,
      streamIndex,
      streamEvent,
      motionDue,
    );
    if (motionDue && step?.active && step.move) {
      transportPuzzle = turnHyperRubixBoundaryCell(transportPuzzle ?? state.puzzle, step.move);
      transportHyperbarPuzzle = null;
      transportHyperbarSnapshot = null;
    }
    nextStepAtMs += stepDurationMs;
    transportPosition += 1;
    scheduledSteps += 1;
  }
  schedulerTimer = setTimeout(schedulerTick, SCHEDULER_INTERVAL_MS);
  schedulerTimer?.unref?.();
}

function restartTransportClock({ announceRestart = false } = {}) {
  clearScheduler();
  transportPosition = 0;
  transportVisualPosition = -1;
  transportVisualStartedAtMs = 0;
  webGpu303SequencePhase = 0;
  state.currentStreamStep = 0;
  transportPuzzle = activeMove?.source === "transport"
    ? turnHyperRubixBoundaryCell(state.puzzle, activeMove.move)
    : state.puzzle;
  rebuildTransportStickerStream(sequenceMethodConfig(), transportPuzzle);
  const remainingMoveMs = activeMove?.source === "transport"
    ? Math.max(0, (1 - activeMove.progress) * activeMove.duration)
    : 0;
  nextStepAtMs = performance.now() + Math.max(55, remainingMoveMs + 24);
  updateSequencePlayhead(hyperRubixSequenceIndex(
    state.playbackMode,
    0,
    HYPER_RUBIX_SEQUENCE_LENGTH,
    sequenceRandomSource(),
  ));
  if (sequenceMethodConfig().serial) paintSerialIdlePlayhead();
  else updateHyperbarPlayhead(0);
  if (state.playing) schedulerTick();
  if (state.playing && isWebGpu303Preset() && state.audio) {
    void startWebGpu303Engine({ alignToTransport: true, restartAtFirst: true });
  }
  if (announceRestart) announce(restartAnnouncement());
}

function startTransport({ restart = false } = {}) {
  if (state.playing && !restart) return;
  state.playing = true;
  paintTransport();
  restartTransportClock({ announceRestart: restart });
  updateStatus();
  if (!state.audio) {
    announce("Audio is off — turn it on to hear playback");
  } else if (!restart) {
    const method = sequenceMethodConfig();
    announce(`Shape loop playing all ${method.length} stickers at ${Math.round(state.tempo)} BPM. Manual orbit, fold, and turns reshape the running sound.`);
  }
}

function stopTransport({ announceStop = false, hardAudio = false } = {}) {
  if (!state.playing && schedulerTimer === null) {
    if (hardAudio) audio.cancelTransportAudio(undefined, { hard: true });
    return;
  }
  state.playing = false;
  clearScheduler({ hardAudio });
  moveQueue = moveQueue.filter((item) => item.source !== "transport");
  transportPuzzle = null;
  transportStickerStream = [];
  pendingTransportStickerStream = null;
  transportHyperbarPuzzle = null;
  transportHyperbarSnapshot = null;
  webGpu303Engine?.setPlaybackEnabled(false);
  webGpu303Engine?.pauseTimeline();
  paintTransport();
  updateStatus();
  if (announceStop) announce("Shape loop paused.");
}

function moveLabel(move, compact = false) {
  const arrow = move.quarterTurns < 0 ? "↶" : "↷";
  return compact
    ? `${move.cell.toUpperCase()}·${move.plane.toUpperCase()}${arrow}`
    : `${move.cell.toUpperCase()} cell, ${move.plane.toUpperCase()} plane, ${move.quarterTurns < 0 ? "minus" : "plus"} 90 degrees`;
}

function updateMoveTrace() {
  const trace = $("moveTrace");
  if (!history.length) {
    const empty = document.createElement("span");
    empty.textContent = "NO TURNS YET";
    trace.replaceChildren(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const move of history.slice(-9)) {
    const marker = document.createElement("i");
    marker.textContent = moveLabel(move, true);
    marker.style.setProperty("--move-color", hyperRubixBoundaryCell(move.cell).fill);
    fragment.append(marker);
  }
  trace.replaceChildren(fragment);
  trace.scrollLeft = trace.scrollWidth;
}

function updateStatus() {
  const metrics = puzzleMetrics();
  const disorder = hyperRubixDisorder(state.puzzle);
  const solved = isHyperRubixSolved(state.puzzle);
  const busy = Boolean(activeMove || moveQueue.length);
  $("puzzleState").textContent = activeMove
    ? `Turning ${activeMove.move.cell.toUpperCase()}`
    : state.playing ? "Sequencing" : solved ? "Solved" : busy ? "In motion" : "Unsolved";
  $("disorderState").textContent = `${Math.round(disorder * 100)}%`;
  $("moveCount").textContent = String(history.length).padStart(2, "0");
  $("undoMove").disabled = busy || history.length === 0;
  $("unwindPuzzle").disabled = busy || history.length === 0;
  $("scramblePuzzle").disabled = busy;
  const audioLabel = state.audio ? "AUDIO ON" : "AUDIO OFF";
  const condition = solved ? "SOLVED" : `${Math.round(disorder * 100)}% DISORDER`;
  const clockLabel = state.playing
    ? sequenceMethodConfig().serial
      ? `STICKER ${String(state.currentStreamStep + 1).padStart(3, "0")}/${sequenceMethodConfig().length} · ${Math.round(state.tempo)} BPM`
      : sequenceMethodConfig().hyperbar
      ? `STEP ${String(state.currentStep + 1).padStart(2, "0")}/16 · PULSE ${String(state.currentHyperbarStep + 1).padStart(2, "0")}/${metrics.hyperbarLength} · ${Math.round(state.tempo)} BPM`
      : `STEP ${String(state.currentStep + 1).padStart(2, "0")}/${HYPER_RUBIX_SEQUENCE_LENGTH} · ${Math.round(state.tempo)} BPM`
    : sequenceMethodConfig().serial
      ? `${sequenceMethodConfig().length} STICKER NOTES · ${VOICE_LABELS[state.voice]?.toUpperCase() ?? "HYPER KIT"}`
      : sequenceMethodConfig().hyperbar
      ? `${metrics.stickerCount} STICKER EVENTS · COIL = ${metrics.conceptualVoiceCount}`
      : `${metrics.stickerCount} HYPER-STICKERS`;
  stageStatusText = `${condition} · ${clockLabel} · ${state.selectedCell.toUpperCase()} / ${state.selectedPlane.toUpperCase()} · ${audioLabel}`;
  paintStageReadout();
  updateMoveTrace();
}

function updateProjectionReadout() {
  $("rotationReadout").textContent = `XW ${formatDegrees(state.rotation.xw)} · YW ${formatDegrees(state.rotation.yw)}`;
}

function renderPlanePicker() {
  const cell = hyperRubixBoundaryCell(state.selectedCell);
  if (!cell.tangentPlanes.includes(state.selectedPlane)) state.selectedPlane = cell.tangentPlanes[0];
  const fragment = document.createDocumentFragment();
  for (const plane of cell.tangentPlanes) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.plane = plane;
    button.setAttribute("aria-pressed", String(plane === state.selectedPlane));
    const title = document.createElement("b");
    title.textContent = plane.toUpperCase();
    const description = document.createElement("small");
    description.textContent = `${plane[0].toUpperCase()} ↔ ${plane[1].toUpperCase()} quarter-turn`;
    button.append(title, description);
    button.addEventListener("click", () => {
      state.selectedPlane = plane;
      updateSelectionUI();
      announce(`${plane.toUpperCase()} is the active turn plane inside the ${state.selectedCell.toUpperCase()} cell.`);
      scheduleFrame();
    });
    fragment.append(button);
  }
  $("planePicker").replaceChildren(fragment);
}

function updateSelectionUI() {
  const cell = hyperRubixBoundaryCell(state.selectedCell);
  document.querySelectorAll("[data-face]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.face === state.selectedCell));
  });
  renderPlanePicker();
  $("planeHelp").textContent = `inside the ${state.selectedCell.toUpperCase()} cell`;
  $("twistSummary").textContent = `${state.selectedCell.toUpperCase()} · ${state.selectedPlane.toUpperCase()} plane`;
  $("turnPlaneDiagram").textContent = state.selectedPlane.toUpperCase();
  $("turnCellDiagram").textContent = state.selectedCell.toUpperCase();
  $("turnCounterclockwise").style.setProperty("--accent", cell.fill);
  $("turnClockwise").style.setProperty("--accent", cell.fill);
  updateStatus();
}

function selectCell(cellId) {
  const cell = HYPER_RUBIX_BOUNDARY_CELLS[cellId];
  if (!cell) return;
  state.selectedCell = cell.id;
  updateSelectionUI();
  scheduleFrame();
}

for (const button of document.querySelectorAll("[data-face]")) {
  button.addEventListener("click", () => {
    selectCell(button.dataset.face);
    announce(`${state.selectedCell.toUpperCase()} boundary cell selected.`);
  });
}

function startNextMove(time) {
  if (activeMove || !moveQueue.length) return;
  const item = moveQueue.shift();
  activeMove = {
    ...item,
    startedAt: time,
    progress: 0,
  };
  if (item.soundAtStart !== false) auditionManualMove(item.move);
  updateStatus();
}

function finishActiveMove(time) {
  const finished = activeMove;
  if (!finished) return;
  state.puzzle = turnHyperRubixBoundaryCell(state.puzzle, finished.move);
  if (finished.historyAction === "push") history.push(finished.move);
  if (history.length > 256) history.splice(0, history.length - 256);
  if (finished.historyAction === "pop") history.pop();
  if (finished.historyAction === "clear") history = [];
  if (finished.clearAtEnd && moveQueue.length === 0) history = [];
  turnPulse = { move: finished.move, startedAt: time };
  activeMove = null;
  rebuildHyperbarSnapshot();
  if (state.playing && sequenceMethodConfig().serial) {
    transportPuzzle = state.puzzle;
    rebuildTransportStickerStream(sequenceMethodConfig(), state.puzzle);
  }
  queueWebGpu303Sync({ force: true });
  finished.onComplete?.();
  updateStatus();
  if (finished.announce !== false && moveQueue.length === 0) {
    announce(`${moveLabel(finished.move)} complete. ${isHyperRubixSolved(state.puzzle) ? "Puzzle solved." : `${Math.round(hyperRubixDisorder(state.puzzle) * 100)} percent disorder.`}`);
  }
}

function enqueueMove(move, options = {}) {
  const normalized = normalizeHyperRubixMove(move);
  if (normalized.quarterTurns === 0) return;
  moveQueue.push({
    move: normalized,
    duration: reduceMotion ? 1 : options.duration ?? MOVE_DURATION,
    historyAction: options.historyAction ?? "push",
    clearAtEnd: options.clearAtEnd ?? false,
    announce: options.announce ?? true,
    soundAtStart: options.soundAtStart ?? true,
    source: options.source ?? "manual",
    onComplete: options.onComplete,
  });
  updateStatus();
  scheduleFrame();
}

function turnSelected(quarterTurns) {
  enqueueMove({
    cell: state.selectedCell,
    plane: state.selectedPlane,
    quarterTurns,
  });
}

$("turnCounterclockwise").addEventListener("click", () => turnSelected(-1));
$("turnClockwise").addEventListener("click", () => turnSelected(1));

$("scramblePuzzle").addEventListener("click", () => {
  const moves = createHyperRubixScramble(12);
  scrambleGeneration += 1;
  moves.forEach((move, index) => enqueueMove(move, {
    duration: SCRAMBLE_DURATION,
    announce: index === moves.length - 1,
  }));
  announce(`Scramble ${scrambleGeneration}: twelve four-dimensional quarter turns queued.`);
});

function undoLastMove() {
  if (activeMove || moveQueue.length || !history.length) return;
  const move = invertHyperRubixMove(history.at(-1));
  enqueueMove(move, { historyAction: "pop" });
}

$("undoMove").addEventListener("click", undoLastMove);

$("unwindPuzzle").addEventListener("click", () => {
  if (activeMove || moveQueue.length || !history.length) return;
  const moves = invertHyperRubixMoves(history);
  moves.forEach((move, index) => enqueueMove(move, {
    duration: UNWIND_DURATION,
    historyAction: index === moves.length - 1 ? "clear" : "none",
    announce: index === moves.length - 1,
  }));
  announce(`Unwinding ${moves.length} recorded moves.`);
});

function setDragMode(mode) {
  state.dragMode = mode === "fold" ? "fold" : "orbit";
  if (state.dragMode !== "fold" && audio.foldMotionSource === "gesture") {
    audio.endFoldMotion();
  }
  canvas.dataset.dragMode = state.dragMode;
  document.querySelectorAll("[data-drag-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.dragMode === state.dragMode));
  });
  announce(state.dragMode === "fold"
    ? "Fold W mode. Drag to rotate through the fourth dimension."
    : "Orbit mode. Drag to orbit the three-dimensional shadow.");
}

for (const button of document.querySelectorAll("[data-drag-mode]")) {
  button.addEventListener("click", () => setDragMode(button.dataset.dragMode));
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || (event.button ?? 0) !== 0) return;
  pointerDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    moved: false,
    mode: event.shiftKey ? "fold" : state.dragMode,
    cameraPitch: state.cameraPitch,
    cameraYaw: state.cameraYaw,
    rotationXW: state.rotation.xw,
    rotationYW: state.rotation.yw,
    lastRotationXW: state.rotation.xw,
    lastRotationYW: state.rotation.yw,
    lastTimeMs: Number.isFinite(Number(event.timeStamp)) ? Number(event.timeStamp) : performance.now(),
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-dragging");
  canvas.focus({ preventScroll: true });
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const bounds = canvas.getBoundingClientRect();
  const deltaX = event.clientX - pointerDrag.startX;
  const deltaY = event.clientY - pointerDrag.startY;
  pointerDrag.x = event.clientX;
  pointerDrag.y = event.clientY;
  if (!pointerDrag.moved && Math.hypot(deltaX, deltaY) <= 5) {
    event.preventDefault();
    return;
  }
  if (!pointerDrag.moved) {
    pointerDrag.moved = true;
    state.autoRotate = false;
    if (audio.foldMotionSource === "auto") audio.endFoldMotion();
    paintMotionToggle();
    if (pointerDrag.mode === "fold") {
      audio.beginFoldMotion(foldMotionGeometry({
        pan: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1, -1, 1),
      }), {
        timeMs: pointerDrag.lastTimeMs,
      });
    }
  }
  if (pointerDrag.mode === "fold") {
    const nextYW = normalizeDegrees(pointerDrag.rotationYW + deltaX / Math.max(1, bounds.width) * 280);
    const nextXW = normalizeDegrees(pointerDrag.rotationXW - deltaY / Math.max(1, bounds.height) * 280);
    const eventTimeMs = Number.isFinite(Number(event.timeStamp))
      ? Number(event.timeStamp)
      : performance.now();
    const elapsedSeconds = Math.max(0.008, (eventTimeMs - pointerDrag.lastTimeMs) / 1_000);
    const velocityXW = foldAngleDelta(nextXW, pointerDrag.lastRotationXW) / elapsedSeconds;
    const velocityYW = foldAngleDelta(nextYW, pointerDrag.lastRotationYW) / elapsedSeconds;
    state.rotation.yw = nextYW;
    state.rotation.xw = nextXW;
    audio.updateFoldMotion(foldMotionGeometry({
      velocityXW,
      velocityYW,
      pan: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1, -1, 1),
    }), { timeMs: eventTimeMs });
    pointerDrag.lastRotationXW = nextXW;
    pointerDrag.lastRotationYW = nextYW;
    pointerDrag.lastTimeMs = eventTimeMs;
  } else {
    state.cameraYaw = normalizeDegrees(pointerDrag.cameraYaw + deltaX / Math.max(1, bounds.width) * 250);
    state.cameraPitch = clamp(pointerDrag.cameraPitch - deltaY / Math.max(1, bounds.height) * 180, -82, 82);
  }
  updateProjectionReadout();
  queueWebGpu303Sync();
  scheduleFrame();
  event.preventDefault();
});

function finishPointer(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const finishedDrag = pointerDrag;
  const click = !finishedDrag.moved;
  const bounds = canvas.getBoundingClientRect();
  const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  if (finishedDrag.mode === "fold" && finishedDrag.moved) audio.endFoldMotion();
  if (click && !activeMove) {
    const hit = [...renderedStickers].reverse().find((item) => pointInsidePolygon(point, item.hull));
    if (hit?.currentCell) {
      selectCell(hit.currentCell.id);
      announce(`${hit.currentCell.id.toUpperCase()} boundary cell selected from its ${hit.sticker.color} hyper-sticker.`);
    }
  }
  scheduleFrame();
}

function cancelPointer(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const cancelledDrag = pointerDrag;
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  if (cancelledDrag.mode === "fold" && cancelledDrag.moved) audio.endFoldMotion();
  scheduleFrame();
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", cancelPointer);
canvas.addEventListener("lostpointercapture", (event) => {
  if (pointerDrag?.pointerId === event.pointerId) {
    const lostDrag = pointerDrag;
    pointerDrag = null;
    canvas.classList.remove("is-dragging");
    if (lostDrag.mode === "fold" && lostDrag.moved) audio.endFoldMotion();
    scheduleFrame();
  }
});

canvas.addEventListener("wheel", (event) => {
  state.projectionDepth = clamp(
    state.projectionDepth + Math.sign(event.deltaY) * 0.15,
    PROJECTION_DEPTH_MIN,
    7,
  );
  $("projectionDepth").value = String(state.projectionDepth);
  $("projectionDepthOut").textContent = state.projectionDepth.toFixed(1);
  scheduleFrame();
  event.preventDefault();
}, { passive: false });

canvas.addEventListener("keydown", (event) => {
  const amount = event.shiftKey ? 8 : 4;
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    const isFoldKey = event.shiftKey || state.dragMode === "fold";
    if (audio.foldMotionSource === "auto") audio.endFoldMotion();
    if (isFoldKey) {
      const previousXW = state.rotation.xw;
      const previousYW = state.rotation.yw;
      const eventTimeMs = Number.isFinite(Number(event.timeStamp))
        ? Number(event.timeStamp)
        : performance.now();
      audio.beginFoldMotion(foldMotionGeometry(), { timeMs: eventTimeMs });
      if (event.key === "ArrowLeft") state.rotation.yw = normalizeDegrees(state.rotation.yw - amount);
      if (event.key === "ArrowRight") state.rotation.yw = normalizeDegrees(state.rotation.yw + amount);
      if (event.key === "ArrowUp") state.rotation.xw = normalizeDegrees(state.rotation.xw + amount);
      if (event.key === "ArrowDown") state.rotation.xw = normalizeDegrees(state.rotation.xw - amount);
      const gestureSeconds = event.repeat ? 0.045 : 0.085;
      audio.updateFoldMotion(foldMotionGeometry({
        velocityXW: foldAngleDelta(state.rotation.xw, previousXW) / gestureSeconds,
        velocityYW: foldAngleDelta(state.rotation.yw, previousYW) / gestureSeconds,
      }), { timeMs: eventTimeMs });
      audio.endFoldMotion((audio.context?.currentTime ?? 0) + 0.085);
    } else {
      if (event.key === "ArrowLeft") state.cameraYaw -= amount;
      if (event.key === "ArrowRight") state.cameraYaw += amount;
      if (event.key === "ArrowUp") state.cameraPitch = clamp(state.cameraPitch + amount, -82, 82);
      if (event.key === "ArrowDown") state.cameraPitch = clamp(state.cameraPitch - amount, -82, 82);
    }
    state.autoRotate = false;
    paintMotionToggle();
    updateProjectionReadout();
    queueWebGpu303Sync();
    scheduleFrame();
    event.preventDefault();
  }
  if (event.key === "Enter") {
    turnSelected(1);
    event.preventDefault();
  }
  if (event.key === "Backspace") {
    undoLastMove();
    event.preventDefault();
  }
  if (event.key.toLowerCase() === "w") {
    setDragMode(state.dragMode === "fold" ? "orbit" : "fold");
    event.preventDefault();
  }
  if (event.key === " ") {
    $("playButton").click();
    event.preventDefault();
  }
  if (event.key.toLowerCase() === "r") {
    $("restartLoop").click();
    event.preventDefault();
  }
  if (event.key === "[" || event.key === "]") {
    const direction = event.key === "]" ? 1 : -1;
    const current = HYPER_RUBIX_CELL_ORDER.indexOf(state.selectedCell);
    selectCell(HYPER_RUBIX_CELL_ORDER[(current + direction + HYPER_RUBIX_CELL_ORDER.length) % HYPER_RUBIX_CELL_ORDER.length]);
    event.preventDefault();
  }
});

$("playButton").addEventListener("click", () => {
  if (state.playing) stopTransport({ announceStop: true });
  else startTransport();
});

function rebuildPuzzleForSize(requestedSize) {
  let metrics;
  try {
    metrics = puzzleMetrics(requestedSize);
  } catch {
    $("puzzleSize").value = String(puzzleMetrics().size);
    return;
  }
  if (metrics.size === state.puzzle.size) {
    paintPuzzleMetrics();
    return;
  }

  stopTransport({ hardAudio: true });
  if (isWebGpu303Preset()) void stopWebGpu303Engine();
  audio.silenceFold();
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  moveQueue = [];
  activeMove = null;
  turnPulse = null;
  history = [];
  clearSoundingStickerPulses();
  transportPuzzle = null;
  transportStickerStream = [];
  pendingTransportStickerStream = null;
  transportHyperbarPuzzle = null;
  transportHyperbarSnapshot = null;
  transportRandomOrder = [];
  transportRandomCycle = -1;
  transportPosition = 0;
  transportVisualPosition = -1;
  transportVisualStartedAtMs = 0;
  webGpu303SequencePhase = 0;
  hyperbarSnapshot = null;
  hyperbarStepElements = [];
  hyperbarButtonByStickerId = new Map();
  currentHyperbarElements = [];
  hyperbarGateOverrides = new Map();
  hyperbarFocusStickerId = null;
  state.puzzle = createSolvedHyperRubix(metrics.size);
  state.currentStep = 0;
  state.currentHyperbarStep = 0;
  state.currentStreamStep = 0;

  rebuildSequence();
  rebuildHyperbarSnapshot();
  paintSequenceMethod();
  queueWebGpu303Sync({ force: true });
  updateSelectionUI();
  announce(`Puzzle rebuilt at ${puzzleOrderLabel(metrics.size)} with ${metrics.stickerCount} hyper-stickers. Playback and in-flight turns stopped.`);
  scheduleFrame();
}

$("puzzleSize").addEventListener("change", (event) => {
  rebuildPuzzleForSize(Number(event.currentTarget.value));
});

$("sequenceMethod").addEventListener("change", (event) => {
  const wasPlaying = state.playing;
  const hasManualMotion = activeMove?.source === "manual"
    || moveQueue.some(({ source }) => source === "manual");
  if (wasPlaying && hasManualMotion) stopTransport();
  state.sequenceMethod = Object.hasOwn(SEQUENCE_METHODS, event.currentTarget.value)
    ? event.currentTarget.value
    : DEFAULTS.sequenceMethod;
  rebuildHyperbarSnapshot();
  paintSequenceMethod();
  paintTransport();
  if (state.playing) restartTransportClock();
  announce(`${sequenceMethodConfig().label} sequencing method selected. ${sequenceMethodConfig().help}.${wasPlaying && hasManualMotion ? " Playback paused until the manual turn completes." : ""}`);
});

$("restartLoop").addEventListener("click", () => {
  if (state.playing) restartTransportClock({ announceRestart: true });
  else {
    transportPosition = 0;
    transportVisualPosition = -1;
    transportVisualStartedAtMs = 0;
    webGpu303SequencePhase = 0;
    if (sequenceMethodConfig().serial) paintSerialIdlePlayhead();
    else updateSequencePlayhead(hyperRubixSequenceIndex(
      state.playbackMode,
      0,
      HYPER_RUBIX_SEQUENCE_LENGTH,
      sequenceRandomSource(),
    ));
    announce(restartAnnouncement());
  }
});

$("sequencePattern").addEventListener("change", (event) => {
  state.patternId = Object.hasOwn(HYPER_RUBIX_SEQUENCE_PATTERNS, event.currentTarget.value)
    ? event.currentTarget.value
    : DEFAULTS.patternId;
  if (state.patternId === "random-walk") sequenceGeneration += 1;
  rebuildSequence();
  if (state.playing) restartTransportClock();
  announce(`${sequencePatternLabel()} twist tape loaded.`);
});

$("playbackMode").addEventListener("change", (event) => {
  state.playbackMode = Object.hasOwn(PLAYBACK_LABELS, event.currentTarget.value)
    ? event.currentTarget.value
    : DEFAULTS.playbackMode;
  paintTransport();
  if (state.playing) restartTransportClock();
  else if (sequenceMethodConfig().serial) paintSerialIdlePlayhead();
  else updateSequencePlayhead(hyperRubixSequenceIndex(
      state.playbackMode,
      0,
      HYPER_RUBIX_SEQUENCE_LENGTH,
      sequenceRandomSource(),
    ));
  announce(`${PLAYBACK_LABELS[state.playbackMode]} playback selected.`);
});

$("twistRate").addEventListener("change", (event) => {
  const previousRate = state.subdivisionsPerBeat;
  const rate = Number(event.currentTarget.value);
  state.subdivisionsPerBeat = Object.hasOwn(RATE_LABELS, rate)
    ? rate
    : DEFAULTS.subdivisionsPerBeat;
  paintTransport();
  if (state.playing && state.subdivisionsPerBeat > previousRate) {
    const fasterStepMs = hyperRubixStepDurationSeconds(
      state.tempo,
      state.subdivisionsPerBeat,
      state.swing,
      transportPosition,
    ) * 1_000;
    nextStepAtMs = Math.min(nextStepAtMs, performance.now() + Math.min(55, fasterStepMs));
  }
  realignRunningWebGpu303Phase();
  queueWebGpu303Sync({ force: true });
  announce(`${RATE_LABELS[state.subdivisionsPerBeat]} pulse rate selected: ${state.subdivisionsPerBeat} pulse${state.subdivisionsPerBeat === 1 ? "" : "s"} per quarter-note beat.`);
});

$("twistMotion").addEventListener("change", (event) => {
  state.twistMotion = Object.hasOwn(TWIST_MOTION_LABELS, event.currentTarget.value)
    ? event.currentTarget.value
    : DEFAULTS.twistMotion;
  paintTransport();
  if (state.playing) restartTransportClock();
  announce(`${TWIST_MOTION_LABELS[state.twistMotion]} physical twist motion selected. Audio pulses keep their chosen rate.`);
});

$("reseedPattern").addEventListener("click", () => {
  if (state.patternId !== "random-walk") return;
  rebuildSequence({ reseed: true });
  if (state.playing) restartTransportClock();
  announce(`Random walk reseeded. Generation ${sequenceGeneration + 1}.`);
});

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const update = () => { output.textContent = formatter(state[key]); };
  input.value = String(state[key]);
  input.addEventListener("input", () => {
    const previousValue = state[key];
    state[key] = Number(input.value);
    update();
    afterChange?.(previousValue);
    scheduleFrame();
  });
  update();
}

bindRange("output", "output", (value) => `${Math.round(value * 100)}%`, () => {
  if (state.audio) audio.setLevel(state.output);
});
bindRange("tempo", "tempo", (value) => `${Math.round(value)} BPM`, (previousTempo) => {
  paintTransport();
  if (state.playing && state.tempo > previousTempo) {
    const fasterStepMs = hyperRubixStepDurationSeconds(
      state.tempo,
      state.subdivisionsPerBeat,
      state.swing,
      transportPosition,
    ) * 1_000;
    nextStepAtMs = Math.min(nextStepAtMs, performance.now() + Math.min(55, fasterStepMs));
  }
  realignRunningWebGpu303Phase();
  queueWebGpu303Sync();
});
bindRange("swing", "swing", (value) => `${Math.round(value * 100)}%`, () => {
  realignRunningWebGpu303Phase();
  queueWebGpu303Sync();
});
bindRange("twistDensity", "twistDensity", (value) => `${Math.round(value * 100)}%`, () => {
  rebuildSequence({ resetPosition: false });
  if (state.playing) restartTransportClock();
});
bindRange("rotationSpeed", "rotationSpeed", (value) => `${value.toFixed(2)} rev/min`, () => {
  $("motionSummary").textContent = state.autoRotate ? `${state.rotationSpeed.toFixed(2)} rev/min` : "paused";
  if (state.rotationSpeed <= 0 && audio.foldMotionSource === "auto") audio.endFoldMotion();
});
bindRange("projectionDepth", "projectionDepth", (value) => value.toFixed(1));
bindRange("cellSeparation", "cellSeparation", (value) => `${Math.round(value * 100)}%`);
bindRange("stickerScale", "stickerScale", (value) => `${Math.round(value * 100)}%`);
bindRange("tone", "tone", (value) => `${Math.round(value * 100)}%`, () => queueWebGpu303Sync());
bindRange("decay", "decay", (value) => `${value.toFixed(2)} s`, () => queueWebGpu303Sync());
bindRange("foldLevel", "foldLevel", (value) => `${Math.round(value * 100)}%`, () => {
  audio.setFoldLevel(state.foldLevel);
});
bindRange("rattleLevel", "rattleLevel", (value) => `${Math.round(value * 100)}%`, () => {
  paintSoundSummary();
});
bindRange("topologyLevel", "topologyLevel", (value) => `${Math.round(value * 100)}%`, () => {
  audio.setTopologyLevel(state.topologyLevel);
  paintSoundSummary();
  if (state.topologyLevel <= 0) {
    audio.silenceTopology(undefined, { immediate: true });
    clearSoundingStickerPulses();
    scheduleFrame();
  }
});
bindRange("topologySpan", "topologySpan", (value) => `${value.toFixed(value % 1 ? 2 : 0)} st`);
bindRange("topologyStrum", "topologyStrum", (value) => `${Math.round(value * 1_000)} ms`);
bindRange("topologyRing", "topologyRing", (value) => `${value.toFixed(2)} s`);
bindRange("topologyWarp", "topologyWarp", (value) => `${Math.round(value * 100)}%`);
for (const key of [
  "pitchInfluence",
  "filterInfluence",
  "stereoInfluence",
  "neighborResponse",
  "wInfluence",
  "disorderInfluence",
]) bindRange(key, key, (value) => `${Math.round(value * 100)}%`, () => {
  queueWebGpu303Sync();
});

function paintMotionToggle() {
  $("autoRotate").setAttribute("aria-pressed", String(state.autoRotate));
  $("autoRotateState").textContent = state.autoRotate ? "moving through XW + YW" : "projection held still";
  $("motionSummary").textContent = state.autoRotate ? `${state.rotationSpeed.toFixed(2)} rev/min` : "manual projection";
}

$("autoRotate").addEventListener("click", () => {
  state.autoRotate = !state.autoRotate;
  if (!state.autoRotate && audio.foldMotionSource === "auto") audio.endFoldMotion();
  paintMotionToggle();
  scheduleFrame();
});

function resetView() {
  audio.endFoldMotion();
  state.cameraPitch = DEFAULTS.cameraPitch;
  state.cameraYaw = DEFAULTS.cameraYaw;
  state.cameraRoll = DEFAULTS.cameraRoll;
  state.rotation = { ...DEFAULTS.rotation };
  updateProjectionReadout();
  queueWebGpu303Sync({ force: true });
  scheduleFrame();
}

$("resetView").addEventListener("click", resetView);

$("randomView").addEventListener("click", () => {
  audio.endFoldMotion();
  state.autoRotate = false;
  state.rotation.xw = Math.random() * 140 - 70;
  state.rotation.yw = Math.random() * 140 - 70;
  state.rotation.zw = Math.random() * 140 - 70;
  state.cameraYaw = Math.random() * 100 - 50;
  state.cameraPitch = Math.random() * 52 - 26;
  paintMotionToggle();
  updateProjectionReadout();
  queueWebGpu303Sync({ force: true });
  announce("Jumped to a new four-dimensional projection.");
  scheduleFrame();
});

$("voice").addEventListener("change", (event) => {
  const previousVoice = state.voice;
  state.voice = Object.hasOwn(VOICE_LABELS, event.currentTarget.value)
    ? event.currentTarget.value
    : DEFAULTS.voice;
  event.currentTarget.value = state.voice;
  state.rattleEnabled = isRattlesnakePreset();
  if (!state.rattleEnabled) audio.silenceRattle();
  remapRunningPreset();
  if (!isWebGpu303Preset()) {
    void stopWebGpu303Engine();
  } else if (state.audio) {
    void startWebGpu303Engine({ alignToTransport: state.playing });
  }
  paintPresetHelp();
  paintSoundSummary();
  paintFaceVoiceLabels();
  renderHyperbarGrid();
  announce(`${VOICE_LABELS[state.voice]} selected. The shape loop keeps playing; manual orbit, fold, and twists now use this map.`);
  if (previousVoice !== state.voice) scheduleFrame();
});

$("topologyMode").addEventListener("change", (event) => {
  state.topologyMode = Object.hasOwn(TOPOLOGY_MODE_LABELS, event.currentTarget.value)
    ? event.currentTarget.value
    : DEFAULTS.topologyMode;
  event.currentTarget.value = state.topologyMode;
  audio.silenceTopology();
  clearSoundingStickerPulses();
  paintSoundSummary();
  announce(`${TOPOLOGY_MODE_LABELS[state.topologyMode]} selected.`);
  scheduleFrame();
});

function paintFoldControls() {
  $("foldSound").value = state.foldSound;
  $("hearAutoDrift").setAttribute("aria-pressed", String(state.hearAutoDrift));
  $("hearAutoDriftState").textContent = state.hearAutoDrift
    ? "on · follows automatic XW + YW drift"
    : "off · fold gestures only";
}

$("foldSound").addEventListener("change", (event) => {
  state.foldSound = Object.hasOwn(FOLD_SOUND_LABELS, event.currentTarget.value)
    ? event.currentTarget.value
    : DEFAULTS.foldSound;
  event.currentTarget.value = state.foldSound;
  audio.silenceFold();
  paintFoldControls();
  announce(`${FOLD_SOUND_LABELS[state.foldSound]} selected.`);
  scheduleFrame();
});

$("hearAutoDrift").addEventListener("click", () => {
  state.hearAutoDrift = !state.hearAutoDrift;
  if (!state.hearAutoDrift && audio.foldMotionSource === "auto") audio.endFoldMotion();
  paintFoldControls();
  announce(state.hearAutoDrift
    ? "Automatic fourth-axis drift can now sound the selected fold voice."
    : "Automatic drift is silent; fold gestures can still sound.");
  scheduleFrame();
});

function paintSoundSummary() {
  const kit = VOICE_LABELS[state.voice] ?? "Turn voice";
  const topology = state.topologyMode === "off" || state.topologyLevel <= 0
    ? ""
    : ` · ${TOPOLOGY_SUMMARY_LABELS[state.topologyMode] ?? "mesh"}`;
  $("soundSummary").textContent = `${kit}${topology}`;
  const rattlesnakeControls = $("rattlesnakeControls");
  if (rattlesnakeControls) rattlesnakeControls.hidden = !isRattlesnakePreset();
  $("rattleButton").setAttribute("aria-pressed", String(state.rattleEnabled));
  $("rattleState").textContent = state.rattleEnabled
    ? `${RATTLE_RATE_LABELS[state.rattleRate] ?? "Dense"} grains · selected preset`
    : "off · choose Rattlesnake from Sound preset";
}

$("rattleButton").addEventListener("click", () => {
  $("voice").value = isRattlesnakePreset() ? DEFAULTS.voice : "rattlesnake";
  $("voice").dispatchEvent(new Event("change"));
});

$("rattleRate").addEventListener("change", (event) => {
  const rate = Number(event.currentTarget.value);
  state.rattleRate = Object.hasOwn(RATTLE_RATE_LABELS, rate) ? rate : DEFAULTS.rattleRate;
  event.currentTarget.value = String(state.rattleRate);
  paintSoundSummary();
  announce(`${RATTLE_RATE_LABELS[state.rattleRate]} rattlesnake grain density selected.`);
});

$("audioButton").addEventListener("click", async () => {
  $("audioError").hidden = true;
  if (state.audio) {
    state.audio = false;
    void stopWebGpu303Engine();
    audio.disable();
  } else {
    try {
      await audio.enable();
      state.audio = true;
      if (isWebGpu303Preset()) {
        await startWebGpu303Engine({ alignToTransport: state.playing });
      }
    } catch (error) {
      $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
      $("audioError").hidden = false;
    }
  }
  $("audioButton").setAttribute("aria-pressed", String(state.audio));
  $("audioState").textContent = state.audio ? "on" : "off";
  updateStatus();
  announce(state.audio
    ? `${state.playing ? `${VOICE_LABELS[state.voice]} joined the running shape loop` : `${VOICE_LABELS[state.voice]} audio enabled`}.`
    : `Audio disabled${state.playing ? "; the shape cursor continues silently" : ""}.`);
});

function resetAll() {
  stopTransport({ hardAudio: true });
  void stopWebGpu303Engine();
  audio.silenceFold();
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  clearSoundingStickerPulses();
  moveQueue = [];
  activeMove = null;
  turnPulse = null;
  history = [];
  state.puzzle = createSolvedHyperRubix(DEFAULTS.puzzleSize);
  state.selectedCell = DEFAULTS.selectedCell;
  state.selectedPlane = DEFAULTS.selectedPlane;
  state.dragMode = DEFAULTS.dragMode;
  state.autoRotate = reduceMotion ? false : DEFAULTS.autoRotate;
  state.tempo = DEFAULTS.tempo;
  state.swing = DEFAULTS.swing;
  state.subdivisionsPerBeat = DEFAULTS.subdivisionsPerBeat;
  state.sequenceMethod = DEFAULTS.sequenceMethod;
  state.twistMotion = DEFAULTS.twistMotion;
  state.patternId = DEFAULTS.patternId;
  state.playbackMode = DEFAULTS.playbackMode;
  state.twistDensity = DEFAULTS.twistDensity;
  state.currentStep = 0;
  state.currentHyperbarStep = 0;
  state.currentStreamStep = 0;
  transportVisualPosition = -1;
  transportVisualStartedAtMs = 0;
  webGpu303SequencePhase = 0;
  sequenceGeneration = 0;
  hyperbarGateOverrides = new Map();
  hyperbarFocusStickerId = null;
  $("puzzleSize").value = String(DEFAULTS.puzzleSize);
  $("sequenceMethod").value = DEFAULTS.sequenceMethod;
  $("twistMotion").value = DEFAULTS.twistMotion;
  $("sequencePattern").value = DEFAULTS.patternId;
  $("playbackMode").value = DEFAULTS.playbackMode;
  $("twistRate").value = String(DEFAULTS.subdivisionsPerBeat);
  for (const key of [
    "tempo", "swing", "twistDensity",
    "rotationSpeed", "projectionDepth", "cellSeparation", "stickerScale",
    "output", "tone", "decay", "foldLevel", "rattleLevel",
    "topologyLevel", "topologySpan", "topologyStrum", "topologyRing", "topologyWarp",
    "pitchInfluence", "filterInfluence", "stereoInfluence",
    "neighborResponse", "wInfluence", "disorderInfluence",
  ]) {
    state[key] = DEFAULTS[key];
    $(key).value = String(DEFAULTS[key]);
    $(key).dispatchEvent(new Event("input"));
  }
  state.voice = DEFAULTS.voice;
  webGpu303Failed = false;
  state.foldSound = DEFAULTS.foldSound;
  state.hearAutoDrift = DEFAULTS.hearAutoDrift;
  state.rattleEnabled = DEFAULTS.rattleEnabled;
  state.rattleRate = DEFAULTS.rattleRate;
  state.shapeInfluence = DEFAULTS.shapeInfluence;
  state.topologyMode = DEFAULTS.topologyMode;
  $("voice").value = DEFAULTS.voice;
  $("foldSound").value = DEFAULTS.foldSound;
  $("rattleRate").value = String(DEFAULTS.rattleRate);
  $("topologyMode").value = DEFAULTS.topologyMode;
  paintFoldControls();
  audio.silenceRattle();
  paintPresetHelp();
  paintSoundSummary();
  paintFaceVoiceLabels();
  rebuildSequence();
  rebuildHyperbarSnapshot();
  paintSequenceMethod();
  resetView();
  setDragMode(DEFAULTS.dragMode);
  paintMotionToggle();
  updateSelectionUI();
  announce("Hyper Rubix puzzle, shape loop, sound preset, and parameters reset.");
  scheduleFrame();
}

$("resetAll").addEventListener("click", resetAll);

function updateMoveAnimation(time) {
  startNextMove(time);
  if (!activeMove) return;
  activeMove.progress = clamp((time - activeMove.startedAt) / activeMove.duration, 0, 1);
  if (activeMove.progress >= 1) {
    finishActiveMove(time);
    startNextMove(time);
  }
}

function drawFrame(time) {
  frameRequest = 0;
  const elapsed = Math.min(80, Math.max(0, time - previousFrameTime));
  previousFrameTime = time;
  if (state.autoRotate && !pointerDrag) {
    const degreesPerSecond = state.rotationSpeed * 6;
    const degrees = degreesPerSecond * elapsed / 1_000;
    state.rotation.xw = normalizeDegrees(state.rotation.xw + degrees);
    state.rotation.yw = normalizeDegrees(state.rotation.yw + degrees * 0.67);
    state.rotation.zw = normalizeDegrees(state.rotation.zw - degrees * 0.31);
    if (state.rotationSpeed > 0 && state.hearAutoDrift) {
      audio.updateFoldMotion(foldMotionGeometry({
        velocityXW: degreesPerSecond,
        velocityYW: degreesPerSecond * 0.67,
      }), { auto: true, timeMs: time });
    } else if (audio.foldMotionSource === "auto") {
      audio.endFoldMotion();
    }
    updateProjectionReadout();
    queueWebGpu303Sync();
  }
  updateMoveAnimation(time);
  drawScene(time);
  if (
    state.autoRotate
    || activeMove
    || moveQueue.length
    || turnPulse
    || soundingStickerPulses.size
  ) scheduleFrame();
}

document.addEventListener("visibilitychange", () => {
  previousFrameTime = performance.now();
  if (document.hidden) {
    pointerDrag = null;
    canvas.classList.remove("is-dragging");
    transportPosition = nextPositionAfterAudiblePulse();
    clearScheduler({ hardAudio: true });
    void stopWebGpu303Engine();
    void audio.suspend().catch(() => {});
    return;
  }
  if (state.audio) {
    void audio.resume().then(() => {
      if (state.playing) resumeTransportClock();
    }).catch(() => {});
  } else if (state.playing) {
    resumeTransportClock();
  }
  scheduleFrame();
});

window.addEventListener("pagehide", (event) => {
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  clearSoundingStickerPulses();
  if (event.persisted) {
    transportPosition = nextPositionAfterAudiblePulse();
    clearScheduler({ hardAudio: true });
    void stopWebGpu303Engine();
    void audio.suspend().catch(() => {});
    return;
  }
  stopTransport({ hardAudio: true });
  state.audio = false;
  void stopWebGpu303Engine();
  void audio.dispose().catch(() => {});
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  if (state.audio) {
    void audio.resume().then(() => {
      if (state.playing && schedulerTimer === null) resumeTransportClock();
    }).catch(() => {});
  } else if (state.playing && schedulerTimer === null) {
    resumeTransportClock();
  }
});

rebuildSequence();
rebuildHyperbarSnapshot();
paintSequenceMethod();
paintPresetHelp();
paintSoundSummary();
paintFaceVoiceLabels();
paintFoldControls();
setDragMode(state.dragMode);
paintMotionToggle();
updateSelectionUI();
updateProjectionReadout();
scheduleFrame();

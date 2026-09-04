import { VoicePool } from "./src/audio.js";
import {
  PENROSE_PHI,
  PENROSE_PRESENTATIONS,
  clampPenroseValue,
  colorPenroseTiles,
  contactsForPenroseReader,
  createPenroseReader,
  createPenroseWorldWindow,
  createPenroseTiling,
  newlyEnteredPenroseContacts,
  penroseOrientationLabel,
  penrosePitch01,
  penroseTileAtPoint,
  upcomingPenroseEdges,
} from "./src/penrose-tilings.js";
import { derivePenroseP2World } from "./src/penrose-world-p2.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const WORLD_UNITS_PER_SECOND = 1;
const MAX_STRIKES_PER_FRAME = 8;
const MAX_LOOKAHEAD_PATHS = 12;
const TILING_SCAN_DIRECTION = 1;
const WORLD_WINDOW_HALO_RATIO = 0.42;
const SEAMLESS_PRESENTATIONS = new Set(["p3", "pentagrid", "p2", "robinson"]);
const DEFAULTS = Object.freeze({
  generation: 6,
  presentation: "p3",
  variation: 0,
  orientation: 0,
  angleWarp: 0,
  palette: "ultraviolet",
  colorEnergy: 0.78,
  coverage: "infinite",
  position: 0.5,
  speed: 0.06,
  playing: false,
  audio: false,
  level: 0.48,
  zoom: 1.48,
  showTriangles: false,
  showHierarchy: false,
  showDirections: true,
  showOutlines: false,
  showPaths: true,
  showLookahead: true,
  pitchSource: "along",
  soundEngine: "sine",
  baseFrequency: 82.5,
  pitchRange: 19,
  decay: 180,
  pathLevel: 0.38,
  pathVoiceCap: 10,
  fmRatio: 2,
  fmIndex: 5,
});

const state = { ...DEFAULTS };
const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const pool = new VoicePool(24);

let tiling = createPenroseTiling({
  generation: state.generation,
  presentation: state.presentation,
  variation: state.variation,
});
let tileColorClasses = colorPenroseTiles(tiling);
let reader = null;
let contacts = [];
let voicedPathContacts = [];
let upcomingPaths = [];
let selectedTile = null;
let pointerDrag = null;
let canvasWidth = 1;
let canvasHeight = 1;
let previousContactKeys = new Set();
let contactBaselineReady = false;
let lastFrameAt = performance.now();
let scheduledFrame = 0;
let geometryDirty = true;
let recentPulses = new Map();
let viewAnchor = { x: 0, y: 0 };
let cameraWorld = { x: 0, y: 0 };
let travelDistance = 0;
let worldWindowCenter = { x: 0, y: 0 };
let worldColorMemory = new Map();
let positionJog = null;
let viewTransform = {
  matrix: [1, 0, 0, 1],
  inverse: [1, 0, 0, 1],
  normal: { x: 1, y: 0 },
  direction: { x: 0, y: 1 },
  localNormal: { x: 1, y: 0 },
  localDirection: { x: 0, y: 1 },
  localNormalLength: 1,
  translation: { x: 0, y: 0 },
};
const fmStrikes = new Set();

const PALETTES = Object.freeze({
  ultraviolet: Object.freeze({
    colors: Object.freeze(["#ff2fb3", "#2d096f", "#e6c3ff", "#75004f", "#7564ff", "#ff9bdf"]),
    edge: "#f8dcff",
    reader: "#ff3eb8",
    preview: "#fff2ff",
  }),
  "hot-orchid": Object.freeze({
    colors: Object.freeze(["#ff168f", "#41004f", "#ffd0ef", "#7d0c49", "#a731ff", "#ff76c5"]),
    edge: "#ffe0f5",
    reader: "#ff2f9e",
    preview: "#fff5fc",
  }),
  "electric-rose": Object.freeze({
    colors: Object.freeze(["#ff315f", "#3d0a74", "#ffc7d8", "#80113f", "#7767ff", "#f1d8ff"]),
    edge: "#ffe2ed",
    reader: "#ff3c72",
    preview: "#fff6fa",
  }),
  "plasma-violet": Object.freeze({
    colors: Object.freeze(["#ca35ff", "#211066", "#edc7ff", "#641185", "#6277ff", "#ff70d2"]),
    edge: "#e9ddff",
    reader: "#cf4cff",
    preview: "#faf5ff",
  }),
});

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return value === 1 ? singular : pluralForm;
}

function worldScale() {
  return Math.max(1, Math.min(canvasWidth, canvasHeight) * 0.5 * state.zoom);
}

function minimumZoom() {
  if (state.coverage !== "infinite") return 0.65;
  const shortSide = Math.max(1, Math.min(canvasWidth, canvasHeight));
  const aspect = Math.max(canvasWidth, canvasHeight) / shortSide;
  return Math.max(1.15, Math.hypot(aspect, 1) / 1.35);
}

function fixedWorldToScreen(current) {
  const scale = worldScale();
  return {
    x: canvasWidth / 2 + current.x * scale,
    y: canvasHeight / 2 - current.y * scale,
  };
}

function transformTilingPoint(current) {
  const localX = current.x - viewAnchor.x;
  const localY = current.y - viewAnchor.y;
  return {
    x: viewTransform.matrix[0] * localX
      + viewTransform.matrix[1] * localY
      + viewTransform.translation.x,
    y: viewTransform.matrix[2] * localX
      + viewTransform.matrix[3] * localY
      + viewTransform.translation.y,
  };
}

function worldToScreen(current) {
  return fixedWorldToScreen(transformTilingPoint(current));
}

function screenToWorld(current) {
  const scale = worldScale();
  const transformedX = (current.x - canvasWidth / 2) / scale - viewTransform.translation.x;
  const transformedY = (canvasHeight / 2 - current.y) / scale - viewTransform.translation.y;
  return {
    x: viewAnchor.x
      + viewTransform.inverse[0] * transformedX
      + viewTransform.inverse[1] * transformedY,
    y: viewAnchor.y
      + viewTransform.inverse[2] * transformedX
      + viewTransform.inverse[3] * transformedY,
  };
}

function isSeamlessMode() {
  return state.coverage === "infinite" && SEAMLESS_PRESENTATIONS.has(state.presentation);
}

function chooseViewAnchor() {
  if (isSeamlessMode()) {
    viewAnchor = { ...cameraWorld };
    return;
  }
  if (state.variation === 0 || state.presentation === "pentagrid") {
    viewAnchor = { x: 0, y: 0 };
    return;
  }
  const centerX = (tiling.bounds.minX + tiling.bounds.maxX) / 2;
  const centerY = (tiling.bounds.minY + tiling.bounds.maxY) / 2;
  const radius = Math.max(
    0.1,
    Math.min(tiling.bounds.maxX - tiling.bounds.minX, tiling.bounds.maxY - tiling.bounds.minY)
      * 0.34,
  );
  const candidates = tiling.tiles.filter((tile) => (
    Math.hypot(tile.center.x - centerX, tile.center.y - centerY) <= radius
  ));
  const source = candidates.length >= 64 ? candidates : tiling.tiles;
  const selected = source[(state.variation * 131 + state.generation * 17) % Math.max(1, source.length)];
  viewAnchor = selected?.center ?? { x: centerX, y: centerY };
}

function createAbsoluteReader(center, normal, direction, span) {
  const offset = center.x * normal.x + center.y * normal.y;
  const tangentOffset = center.x * direction.x + center.y * direction.y;
  return Object.freeze({
    phase: null,
    angle: Math.atan2(direction.y, direction.x),
    direction: Object.freeze({ ...direction }),
    normal: Object.freeze({ ...normal }),
    offset,
    tangentOffset,
    center: Object.freeze({ ...center }),
    first: Object.freeze({
      x: center.x - direction.x * span,
      y: center.y - direction.y * span,
    }),
    second: Object.freeze({
      x: center.x + direction.x * span,
      y: center.y + direction.y * span,
    }),
  });
}

function visibleReaderHalfSpan(matrix, direction) {
  const transformedYPerWorldUnit = Math.abs(
    matrix[2] * direction.x + matrix[3] * direction.y,
  );
  return Math.max(
    1e-9,
    canvasHeight / (2 * worldScale() * Math.max(1e-9, transformedYPerWorldUnit)),
  );
}

function updateViewTransform() {
  const angle = state.orientation * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const shear = state.angleWarp;
  const matrix = [
    cosine + shear * sine,
    -sine + shear * cosine,
    sine,
    cosine,
  ];
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  const inverse = [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
  ];
  const direction = { x: 0, y: 1 };
  const normal = { x: 1, y: 0 };
  const rawNormal = {
    x: matrix[0],
    y: matrix[1],
  };
  const localNormalLength = Math.max(1e-9, Math.hypot(rawNormal.x, rawNormal.y));
  const localNormal = {
    x: rawNormal.x / localNormalLength,
    y: rawNormal.y / localNormalLength,
  };
  const localDirection = { x: -localNormal.y, y: localNormal.x };

  let translation = { x: 0, y: 0 };
  if (isSeamlessMode()) {
    viewAnchor = { ...cameraWorld };
    const span = visibleReaderHalfSpan(matrix, localDirection);
    reader = createAbsoluteReader(cameraWorld, localNormal, localDirection, span);
  } else {
    reader = createPenroseReader({
      bounds: tiling.bounds,
      phase: state.position,
      angle: Math.atan2(localDirection.y, localDirection.x),
    });
    const anchorProjection = rawNormal.x * viewAnchor.x + rawNormal.y * viewAnchor.y;
    const translationAmount = anchorProjection - localNormalLength * reader.offset;
    translation = {
      x: normal.x * translationAmount,
      y: normal.y * translationAmount,
    };
  }
  viewTransform = {
    matrix,
    inverse,
    normal,
    direction,
    localNormal,
    localDirection,
    localNormalLength,
    translation,
  };
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function beginPath(points, close = true) {
  if (!points.length) return;
  const first = worldToScreen(points[0]);
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const current of points.slice(1)) {
    const screen = worldToScreen(current);
    context.lineTo(screen.x, screen.y);
  }
  if (close) context.closePath();
}

function colorWithAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const numeric = Number.parseInt(value, 16);
  return `rgba(${numeric >> 16 & 255},${numeric >> 8 & 255},${numeric & 255},${alpha})`;
}

function currentPalette() {
  return PALETTES[state.palette] ?? PALETTES.ultraviolet;
}

function tileFill(tile) {
  const palette = currentPalette();
  const baseIndex = tileColorClasses.get(tile.id)
    ?? (tile.kind * 2 + tile.family + (tile.type === "thick" ? 0 : 1));
  const color = palette.colors[baseIndex % palette.colors.length];
  return colorWithAlpha(color, 0.64 + state.colorEnergy * 0.34);
}

function drawDirectionFamilies() {
  if (!state.showDirections) return;
  context.save();
  context.lineWidth = 0.65;
  context.setLineDash([3, 7]);
  for (let index = 0; index < 5; index += 1) {
    const angle = index * Math.PI / 5;
    const radius = 1.18;
    const first = worldToScreen({
      x: viewAnchor.x - Math.cos(angle) * radius,
      y: viewAnchor.y - Math.sin(angle) * radius,
    });
    const second = worldToScreen({
      x: viewAnchor.x + Math.cos(angle) * radius,
      y: viewAnchor.y + Math.sin(angle) * radius,
    });
    context.beginPath();
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
    const palette = currentPalette();
    context.strokeStyle = colorWithAlpha(
      palette.colors[(index * 2 + 1) % palette.colors.length],
      0.1 + state.colorEnergy * 0.08,
    );
    context.stroke();
  }
  context.restore();
}

function drawParentHierarchy() {
  if (!state.showHierarchy) return;
  const hierarchyGeneration = Math.max(0, (tiling.sourceGeneration ?? state.generation) - 2);
  const parents = tiling.generations?.[hierarchyGeneration] ?? [];
  context.save();
  context.strokeStyle = colorWithAlpha(currentPalette().edge, 0.42);
  context.lineWidth = 1.05;
  context.setLineDash([4, 4]);
  for (const triangle of parents) {
    beginPath([triangle.a, triangle.b, triangle.c]);
    context.stroke();
  }
  context.restore();
}

function drawTiles() {
  const activeEdgeIds = new Set(contacts.map(({ edgeId }) => edgeId));
  const scale = worldScale();
  context.save();
  context.lineJoin = "round";
  for (const tile of tiling.tiles) {
    const tileCenter = worldToScreen(tile.center);
    const screenRadius = Math.max(
      10,
      Math.sqrt(tile.area) * scale * 4 * (1 + Math.abs(state.angleWarp)),
    );
    if (
      tileCenter.x + screenRadius < 0
      || tileCenter.y + screenRadius < 0
      || tileCenter.x - screenRadius > canvasWidth
      || tileCenter.y - screenRadius > canvasHeight
    ) continue;
    beginPath(tile.points);
    context.fillStyle = tileFill(tile);
    context.fill();
    if (state.showOutlines) {
      context.strokeStyle = "rgba(7,4,15,.74)";
      context.lineWidth = 0.68;
      context.stroke();
    }

    if (state.showTriangles && tile.split) {
      const first = worldToScreen(tile.split[0]);
      const second = worldToScreen(tile.split[1]);
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.strokeStyle = colorWithAlpha(
        currentPalette().colors[(tile.kind + 2) % currentPalette().colors.length],
        0.48,
      );
      context.lineWidth = 0.58;
      context.setLineDash([2, 3]);
      context.stroke();
      context.setLineDash([]);
    }

    if (selectedTile?.id === tile.id) {
      beginPath(tile.points);
      context.strokeStyle = "rgba(255,226,255,.98)";
      context.lineWidth = 2.2;
      context.shadowColor = colorWithAlpha(currentPalette().reader, 0.82);
      context.shadowBlur = 12;
      context.stroke();
      context.shadowBlur = 0;
    }
  }

  if (state.showOutlines) {
    context.lineWidth = 1.3;
    for (const edge of tiling.edges) {
      if (!activeEdgeIds.has(edge.id)) continue;
      const first = worldToScreen(edge.first);
      const second = worldToScreen(edge.second);
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.strokeStyle = colorWithAlpha(currentPalette().edge, 0.88);
      context.stroke();
    }
  }
  context.restore();
}

function edgeIsOnScreen(edge, margin = 40) {
  const first = worldToScreen(edge.first);
  const second = worldToScreen(edge.second);
  return !(
    (first.x < -margin && second.x < -margin)
    || (first.y < -margin && second.y < -margin)
    || (first.x > canvasWidth + margin && second.x > canvasWidth + margin)
    || (first.y > canvasHeight + margin && second.y > canvasHeight + margin)
  );
}

function drawSignalPaths() {
  if (!state.showPaths) return;
  const activeEdgeIds = new Set(contacts.map(({ edgeId }) => edgeId));
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  for (const edge of tiling.edges) {
    if (!edgeIsOnScreen(edge)) continue;
    const first = worldToScreen(edge.first);
    const second = worldToScreen(edge.second);
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
  }
  context.strokeStyle = "rgba(10,2,27,.62)";
  context.lineWidth = 1.65;
  context.stroke();
  context.strokeStyle = colorWithAlpha(currentPalette().edge, 0.34 + state.colorEnergy * 0.22);
  context.lineWidth = 0.72;
  context.stroke();

  context.beginPath();
  for (const edge of tiling.edges) {
    if (!activeEdgeIds.has(edge.id) || !edgeIsOnScreen(edge)) continue;
    const first = worldToScreen(edge.first);
    const second = worldToScreen(edge.second);
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
  }
  context.strokeStyle = colorWithAlpha(currentPalette().preview, 0.96);
  context.lineWidth = 2.1;
  context.shadowColor = colorWithAlpha(currentPalette().reader, 0.76);
  context.shadowBlur = 8;
  context.stroke();
  context.restore();
}

function projectedUpcomingPoint(candidate) {
  const entry = worldToScreen(candidate.point);
  const travel = candidate.distance * viewTransform.localNormalLength * worldScale();
  const direction = TILING_SCAN_DIRECTION;
  return {
    entry,
    hit: {
      x: entry.x - viewTransform.normal.x * direction * travel,
      y: entry.y + viewTransform.normal.y * direction * travel,
    },
  };
}

function updateUpcomingPaths() {
  if (!state.showLookahead || !reader) {
    upcomingPaths = [];
    return;
  }
  upcomingPaths = upcomingPenroseEdges(tiling, reader, TILING_SCAN_DIRECTION, 180)
    .map((candidate) => ({ ...candidate, screen: projectedUpcomingPoint(candidate) }))
    .filter(({ screen }) => (
      screen.hit.x >= -70
      && screen.hit.x <= canvasWidth + 70
      && screen.hit.y >= -70
      && screen.hit.y <= canvasHeight + 70
    ))
    .slice(0, MAX_LOOKAHEAD_PATHS);
}

function drawUpcomingPaths() {
  if (!upcomingPaths.length) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let index = upcomingPaths.length - 1; index >= 0; index -= 1) {
    const candidate = upcomingPaths[index];
    const strength = 1 - index / Math.max(1, upcomingPaths.length);
    const first = worldToScreen(candidate.edge.first);
    const second = worldToScreen(candidate.edge.second);
    context.beginPath();
    context.moveTo(first.x, first.y);
    context.lineTo(second.x, second.y);
    context.strokeStyle = colorWithAlpha(
      index === 0 ? currentPalette().preview : currentPalette().reader,
      0.28 + strength * 0.64,
    );
    context.lineWidth = 1 + strength * 2.2;
    context.shadowColor = colorWithAlpha(currentPalette().reader, strength * 0.72);
    context.shadowBlur = strength * 10;
    context.stroke();
    context.shadowBlur = 0;

    context.beginPath();
    context.moveTo(candidate.screen.entry.x, candidate.screen.entry.y);
    context.lineTo(candidate.screen.hit.x, candidate.screen.hit.y);
    context.setLineDash([2, 5]);
    context.strokeStyle = colorWithAlpha(currentPalette().preview, 0.12 + strength * 0.42);
    context.lineWidth = 0.8 + strength * 0.55;
    context.stroke();
    context.setLineDash([]);

    context.beginPath();
    context.arc(candidate.screen.hit.x, candidate.screen.hit.y, 1.7 + strength * 2.1, 0, TAU);
    context.fillStyle = colorWithAlpha(currentPalette().preview, 0.35 + strength * 0.62);
    context.fill();
  }
  context.restore();
}

function drawReader(now) {
  if (!reader) return;
  const span = Math.hypot(canvasWidth, canvasHeight) * 0.64;
  const first = {
    x: canvasWidth / 2 - viewTransform.direction.x * span,
    y: canvasHeight / 2 + viewTransform.direction.y * span,
  };
  const second = {
    x: canvasWidth / 2 + viewTransform.direction.x * span,
    y: canvasHeight / 2 - viewTransform.direction.y * span,
  };
  context.save();
  context.beginPath();
  context.moveTo(first.x, first.y);
  context.lineTo(second.x, second.y);
  context.strokeStyle = "rgba(4,2,12,.88)";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = colorWithAlpha(currentPalette().preview, 0.8);
  context.lineWidth = 4.4;
  context.stroke();
  context.strokeStyle = colorWithAlpha(currentPalette().reader, 0.98);
  context.lineWidth = 1.4;
  context.shadowColor = colorWithAlpha(currentPalette().reader, 0.72);
  context.shadowBlur = 7;
  context.stroke();
  context.shadowBlur = 0;

  const voicedIds = new Set(voicedPathContacts.map(({ edgeId }) => edgeId));
  for (const contact of contacts) {
    const current = worldToScreen(contact.point);
    const pulseAge = now - (recentPulses.get(contact.edgeId) ?? -Infinity);
    const pulse = pulseAge >= 0 && pulseAge < 430 ? 1 - pulseAge / 430 : 0;
    const voiced = voicedIds.has(contact.edgeId);
    if (pulse > 0) {
      context.beginPath();
      context.arc(current.x, current.y, 4 + pulse * 7, 0, TAU);
      context.strokeStyle = colorWithAlpha(currentPalette().reader, 0.16 + pulse * 0.54);
      context.lineWidth = 0.8 + pulse * 1.4;
      context.stroke();
    }
    context.beginPath();
    context.arc(current.x, current.y, voiced ? 3.4 : 2.1, 0, TAU);
    context.fillStyle = voiced
      ? colorWithAlpha(currentPalette().preview, 0.98)
      : colorWithAlpha(currentPalette().edge, 0.68);
    context.fill();
    if (voiced) {
      context.strokeStyle = colorWithAlpha(currentPalette().reader, 0.96);
      context.lineWidth = 1;
      context.stroke();
    }
  }
  context.restore();
}

function drawScene(now) {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  drawDirectionFamilies();
  drawTiles();
  drawSignalPaths();
  drawParentHierarchy();
  drawUpcomingPaths();
  drawReader(now);
}

function pitchFrequency(contact) {
  const pitch = penrosePitch01(contact, state.pitchSource);
  return state.baseFrequency * 2 ** (pitch * state.pitchRange / 12);
}

function selectVoicedPathContacts() {
  return contacts
    .filter(({ boundary, point }) => {
      if (boundary) return false;
      const current = worldToScreen(point);
      return current.x >= -30
        && current.x <= canvasWidth + 30
        && current.y >= -30
        && current.y <= canvasHeight + 30;
    })
    .sort((first, second) => {
      const firstPoint = worldToScreen(first.point);
      const secondPoint = worldToScreen(second.point);
      return Math.hypot(firstPoint.x - canvasWidth / 2, firstPoint.y - canvasHeight / 2)
        - Math.hypot(secondPoint.x - canvasWidth / 2, secondPoint.y - canvasHeight / 2)
        || first.edgeId.localeCompare(second.edgeId);
    })
    .slice(0, state.pathVoiceCap);
}

function pathVoiceSpecs(pathContacts) {
  return pathContacts.map((contact) => {
    const transformed = transformTilingPoint(contact.point);
    const progress = Math.sin(Math.PI * clampPenroseValue(contact.amount));
    const envelope = Math.max(0, progress) ** 0.68;
    const incidence = 0.22 + clampPenroseValue(contact.incidence) * 0.78;
    return {
      key: `penrose-path:${contact.edgeId}`,
      frequency: pitchFrequency(contact),
      gain: state.pathLevel * 0.075 * envelope * incidence,
      pan: clampPenroseValue(transformed.x / 1.05, -1, 1),
      waveform: "sine",
    };
  });
}

function silenceFmStrikes() {
  for (const voice of fmStrikes) {
    try {
      voice.carrier.stop();
      voice.modulator.stop();
    } catch {
      // A voice that has already ended needs no additional stop.
    }
  }
  fmStrikes.clear();
}

function strikeFmPercussion({ frequency, gain, pan = 0, delay = 0, key = "" }) {
  const audioContext = pool.context;
  const output = pool.master;
  if (!state.audio || !audioContext || !output || fmStrikes.size >= 24 || gain < 0.006) return false;
  const startedAt = audioContext.currentTime + Math.min(0.045, Math.max(0, delay));
  const duration = Math.max(0.045, state.decay / 1000);
  const endedAt = startedAt + duration;
  const carrier = audioContext.createOscillator();
  const modulator = audioContext.createOscillator();
  const modulation = audioContext.createGain();
  const envelope = audioContext.createGain();
  const panner = audioContext.createStereoPanner();
  carrier.type = "sine";
  modulator.type = "sine";
  carrier.frequency.setValueAtTime(frequency, startedAt);
  modulator.frequency.setValueAtTime(frequency * state.fmRatio, startedAt);
  modulator.frequency.exponentialRampToValueAtTime(
    Math.max(20, frequency * state.fmRatio * 0.58),
    endedAt,
  );
  modulation.gain.setValueAtTime(frequency * state.fmIndex, startedAt);
  modulation.gain.exponentialRampToValueAtTime(0.0001, endedAt);
  envelope.gain.setValueAtTime(0.0001, startedAt);
  envelope.gain.exponentialRampToValueAtTime(gain, startedAt + 0.003);
  envelope.gain.exponentialRampToValueAtTime(0.0001, endedAt);
  panner.pan.setValueAtTime(clampPenroseValue(pan, -1, 1), startedAt);
  modulator.connect(modulation).connect(carrier.frequency);
  carrier.connect(envelope).connect(panner).connect(output);
  const voice = { key, carrier, modulator, modulation, envelope, panner, endedAt };
  fmStrikes.add(voice);
  carrier.onended = () => {
    fmStrikes.delete(voice);
    carrier.disconnect();
    modulator.disconnect();
    modulation.disconnect();
    envelope.disconnect();
    panner.disconnect();
  };
  carrier.start(startedAt);
  modulator.start(startedAt);
  carrier.stop(endedAt + 0.012);
  modulator.stop(endedAt + 0.012);
  return true;
}

function strikePenroseVoice(spec, envelope) {
  if (state.soundEngine === "fm-perc") {
    return strikeFmPercussion({
      ...spec,
      delay: envelope.startDelaySeconds,
    });
  }
  return pool.strike({ ...spec, waveform: "sine" }, envelope);
}

function strikeContacts(entered, now) {
  const internal = entered.filter(({ boundary }) => !boundary);
  internal.forEach((contact) => recentPulses.set(contact.edgeId, now));
  const audible = internal
    .sort((first, second) => Math.abs(first.along) - Math.abs(second.along))
    .slice(0, MAX_STRIKES_PER_FRAME);
  if (!audible.length) return;
  if (state.soundEngine !== "fm-perc") return;
  const available = pool.availableStrikeHeadroom(0.68);
  const gain = Math.min(0.115, available / audible.length);
  audible.forEach((contact, index) => {
    if (!state.audio || gain < 0.008) return;
    const transformed = transformTilingPoint(contact.point);
    strikePenroseVoice({
      key: `penrose:${contact.edgeId}`,
      frequency: pitchFrequency(contact),
      gain: gain * (0.3 + clampPenroseValue(contact.incidence) * 0.7),
      pan: clampPenroseValue(transformed.x / 1.05, -1, 1),
    }, {
      attackSeconds: 0.004,
      decaySeconds: state.decay / 1000,
      startDelaySeconds: Math.min(0.045, index * 0.0035),
      retriggerMode: "crossfade",
    });
  });
}

function auditionTile(tile) {
  if (!tile || !state.audio) return;
  const pseudoContact = {
    family: tile.family,
    point: tile.center,
    tileTypes: [tile.type],
    tileKinds: [tile.kind],
  };
  const transformed = transformTilingPoint(tile.center);
  strikePenroseVoice({
    key: `penrose:tile:${tile.id}`,
    frequency: pitchFrequency(pseudoContact),
    gain: 0.18,
    pan: clampPenroseValue(transformed.x / 1.05, -1, 1),
  }, {
    attackSeconds: 0.004,
    decaySeconds: Math.min(0.9, state.decay / 750),
    retriggerMode: "crossfade",
  });
}

function estimatedWorldEdgeScale() {
  if (state.presentation === "pentagrid") return 0.96 / (5.1 + state.generation * 0.58);
  return PENROSE_PHI ** -state.generation;
}

function visibleWorldHalfExtent() {
  const scale = Math.max(1, worldScale());
  const halfWidth = canvasWidth / (2 * scale);
  const halfHeight = canvasHeight / (2 * scale);
  let extent = 0;
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight]) {
      const worldX = viewTransform.inverse[0] * x + viewTransform.inverse[1] * y;
      const worldY = viewTransform.inverse[2] * x + viewTransform.inverse[3] * y;
      extent = Math.max(extent, Math.abs(worldX), Math.abs(worldY));
    }
  }
  return Math.max(0.3, extent);
}

function desiredWorldWindow() {
  const edgeScale = estimatedWorldEdgeScale();
  const visibleExtent = visibleWorldHalfExtent();
  const radius = visibleExtent + edgeScale * 3;
  const halo = Math.max(radius * WORLD_WINDOW_HALO_RATIO, edgeScale * 10);
  return { radius, halo, edgeScale };
}

function colorsForWorldWindow(nextTiling) {
  const nextColors = colorPenroseTiles(nextTiling, 6, worldColorMemory);
  for (const tile of nextTiling.tiles) {
    worldColorMemory.set(tile.id, nextColors.get(tile.id) ?? 0);
  }
  if (worldColorMemory.size > 60_000) {
    worldColorMemory = new Map(nextColors);
  }
  return nextColors;
}

function createCurrentWorldWindow() {
  const { radius, halo } = desiredWorldWindow();
  const sourcePresentation = state.presentation === "p2" ? "p3" : state.presentation;
  const source = createPenroseWorldWindow({
    generation: state.generation,
    presentation: sourcePresentation,
    variation: state.variation,
    center: cameraWorld,
    radius,
    halo: halo + (state.presentation === "p2" ? estimatedWorldEdgeScale() * 4 : 0),
  });
  return state.presentation === "p2"
    ? derivePenroseP2World(source)
    : source;
}

function refreshWorldWindow(force = false) {
  if (!isSeamlessMode()) return false;
  const desired = desiredWorldWindow();
  const activeWindow = tiling.window;
  const distanceFromCenter = Math.max(
    Math.abs(cameraWorld.x - worldWindowCenter.x),
    Math.abs(cameraWorld.y - worldWindowCenter.y),
  );
  const refreshDistance = Math.max(
    desired.edgeScale * 4,
    (activeWindow?.halo ?? desired.halo) * 0.42,
  );
  const cacheIsTooSmall = !activeWindow
    || activeWindow.radius < desired.radius * 0.99
    || activeWindow.halo < desired.halo * 0.99;
  if (!force && !cacheIsTooSmall && distanceFromCenter < refreshDistance) return false;

  const selectedId = selectedTile?.id;
  const nextTiling = createCurrentWorldWindow();
  tiling = nextTiling;
  worldWindowCenter = { ...nextTiling.window.center };
  viewAnchor = { ...cameraWorld };
  tileColorClasses = colorsForWorldWindow(nextTiling);
  selectedTile = selectedId
    ? nextTiling.tiles.find(({ id }) => id === selectedId) ?? null
    : null;
  upcomingPaths = [];
  updateGeometryUi();
  return true;
}

function advanceWorld(distance) {
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-12) return;
  cameraWorld = {
    x: cameraWorld.x + viewTransform.localNormal.x * distance,
    y: cameraWorld.y + viewTransform.localNormal.y * distance,
  };
  viewAnchor = { ...cameraWorld };
  travelDistance += distance;
}

function rebuildGeometry() {
  worldColorMemory = new Map();
  if (isSeamlessMode()) {
    tiling = createCurrentWorldWindow();
    worldWindowCenter = { ...tiling.window.center };
    viewAnchor = { ...cameraWorld };
    tileColorClasses = colorsForWorldWindow(tiling);
  } else {
    tiling = createPenroseTiling({
      generation: state.generation,
      presentation: state.presentation,
      variation: state.variation,
      overscan: 0,
    });
    tileColorClasses = colorPenroseTiles(tiling);
    chooseViewAnchor();
  }
  upcomingPaths = [];
  if (selectedTile) {
    selectedTile = tiling.tiles.find(({ id }) => id === selectedTile.id) ?? null;
  }
  geometryDirty = false;
  contactBaselineReady = false;
  previousContactKeys = new Set();
  updateGeometryUi();
}

function updateGeometryUi() {
  const { counts } = tiling;
  const info = tiling.presentationInfo ?? PENROSE_PRESENTATIONS[0];
  const typeEntries = Object.entries(counts.byType ?? {});
  const seamless = isSeamlessMode();
  $("presentationDescription").textContent = `${info.description} Matching hierarchy preserves aperiodic order without a translational unit cell.`;
  $("generationOut").textContent = `${state.generation} · ${formatNumber(counts.total)} ${seamless ? "window tiles" : "tiles"}`;
  $("structureSummary").textContent = `${info.shortLabel} · generation ${state.generation} · ${seamless ? "seamless pentagrid window" : "finite patch"}`;
  $("tileCountReadout").textContent = typeEntries
    .map(([type, count]) => `${formatNumber(count)} ${type.replaceAll("-", " ")}`)
    .join(" · ");
  if (counts.thick && counts.thin) {
    $("tileRatioReadout").textContent = `${counts.ratio.toFixed(4)} · tending to φ`;
    $("ratioReadout").textContent = `thick / thin = ${counts.ratio.toFixed(4)} → φ`;
  } else {
    $("tileRatioReadout").textContent = `${typeEntries.length} matched tile classes`;
    $("ratioReadout").textContent = `${formatNumber(counts.total)} tiles · ${typeEntries.length} classes`;
  }
  $("legendPrimary").textContent = info.tileLabels[1] ?? info.tileLabels[0] ?? "tile class 1";
  $("legendSecondary").textContent = info.tileLabels[0] ?? "tile class 2";
  $("seedReadout").textContent = ({
    p3: "ten-triangle sun / cartwheel patch",
    pentagrid: `five line families · phase ${state.variation + 1}`,
    p2: seamless ? "marked P3 local derivation · kites + darts" : "five-kite sun · mirror-axis pairing",
    p1: "pentagonal P1 supertile decomposition",
    robinson: seamless ? "global pentagrid rhombs · golden half-tiles" : "acute + obtuse golden half-tiles",
  })[state.presentation];
  if (seamless && state.presentation === "p3") {
    $("seedReadout").textContent = "globally addressed five-grid field";
  }
}

function syncHierarchyAvailability() {
  const control = $("showHierarchy");
  const unavailable = isSeamlessMode();
  control.disabled = unavailable;
  control.checked = state.showHierarchy && !unavailable;
  const label = control.closest(".penrose-toggle");
  label?.classList.toggle("is-disabled", unavailable);
  label?.setAttribute("aria-disabled", String(unavailable));
  if (label) label.title = unavailable ? "Parent hierarchy is available in finite patch mode." : "";
  const note = label?.querySelector("small");
  if (note) note.textContent = unavailable ? "finite patch only" : "two generations back";
}

function updateUi() {
  syncHierarchyAvailability();
  const motion = state.playing ? "PLAYING" : "PAUSED";
  const audio = state.audio ? "AUDIO ON" : "AUDIO OFF";
  const selected = selectedTile ? ` · ${selectedTile.type.toUpperCase()} SELECTED` : "";
  const coverage = isSeamlessMode() ? "∞ SEAMLESS" : "PATCH";
  $("stageReadout").textContent = `${tiling.presentationInfo.shortLabel.toUpperCase()} · GEN ${state.generation} · ${coverage} · ${formatNumber(tiling.counts.total)} TILES · ${contacts.length} ${plural(contacts.length, "CONTACT", "CONTACTS")} · ${motion} · ${audio}${selected}`;
  $("playSummary").textContent = isSeamlessMode()
    ? `${state.playing ? "moving" : "paused"} · endless travel left`
    : `${state.playing ? "moving" : "paused"} · finite boundary visible`;
  $("positionOut").textContent = isSeamlessMode()
    ? `${travelDistance >= 0 ? "+" : ""}${travelDistance.toFixed(2)} u`
    : `patch ${(state.position * 100).toFixed(1)}%`;
  if (!positionJog) $("position").value = String(isSeamlessMode() ? 0.5 : state.position);
  $("speedOut").textContent = `${state.speed.toFixed(3)} u/s`;
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause moving tiling" : "Move tiling behind the fixed reader");
  $("variationOut").textContent = `${state.variation + 1} / 64`;
  $("orientationOut").textContent = `${state.orientation}°`;
  $("angleWarpOut").textContent = Math.abs(state.angleWarp) < 0.001
    ? "exact · 0%"
    : `affine · ${Math.round(state.angleWarp * 100)}%`;
  $("colorEnergyOut").textContent = `${Math.round(state.colorEnergy * 100)}%`;
}

function syncAudioUi() {
  $("audioButton").setAttribute("aria-pressed", String(state.audio));
  $("audioState").textContent = state.audio ? "on" : "off";
  $("audioButton").setAttribute("aria-label", state.audio ? "Turn audio off" : "Turn audio on");
}

function syncSoundEngineUi() {
  const sources = {
    family: "five edge families",
    tile: "tile neighborhood",
    height: "vertical position",
    along: "position along reader",
    incidence: "reader / edge incidence",
  };
  const engine = state.soundEngine === "fm-perc" ? "FM intersection triggers" : "sine edge paths";
  $("soundSummary").textContent = `${engine} · ${sources[state.pitchSource]} → pitch`;
  $("pathControls").hidden = state.soundEngine !== "sine";
  $("fmControls").hidden = state.soundEngine !== "fm-perc";
}

function setPosition(value, audition = true) {
  const next = clampPenroseValue(value);
  if (isSeamlessMode()) {
    const distance = (next - state.position) * visibleWorldHalfExtent() * 2;
    state.position = next;
    advanceWorld(distance);
  } else {
    state.position = next;
  }
  if (!audition) contactBaselineReady = false;
  scheduleFrame();
}

function beginPositionJog() {
  if (!isSeamlessMode()) return;
  positionJog = true;
  state.position = 0.5;
  $("position").value = "0.5";
}

function finishPositionJog() {
  if (!isSeamlessMode()) return;
  positionJog = null;
  state.position = 0.5;
  $("position").value = "0.5";
  scheduleFrame();
}

function resetWorldTravel() {
  cameraWorld = { x: 0, y: 0 };
  worldWindowCenter = { x: 0, y: 0 };
  travelDistance = 0;
  state.position = 0.5;
  positionJog = null;
  worldColorMemory = new Map();
  contactBaselineReady = false;
  geometryDirty = true;
  scheduleFrame();
}

async function setAudio(enabled) {
  const error = $("audioError");
  error.hidden = true;
  if (!enabled) {
    state.audio = false;
    pool.disable();
    silenceFmStrikes();
    syncAudioUi();
    scheduleFrame();
    return;
  }
  try {
    await pool.enable();
    pool.setLevel(state.level);
    state.audio = true;
    contactBaselineReady = false;
    syncAudioUi();
    scheduleFrame();
  } catch (audioError) {
    state.audio = false;
    syncAudioUi();
    error.textContent = audioError instanceof Error ? audioError.message : "Audio could not be started.";
    error.hidden = false;
  }
}

function togglePlayback() {
  state.playing = !state.playing;
  lastFrameAt = performance.now();
  contactBaselineReady = false;
  scheduleFrame();
}

function setZoom(value) {
  state.zoom = clampPenroseValue(value, minimumZoom(), 3.5);
  scheduleFrame();
}

function frame(now) {
  scheduledFrame = 0;
  const elapsed = Math.min(0.08, Math.max(0, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  updateViewTransform();
  if (geometryDirty) rebuildGeometry();
  if (state.playing) {
    if (isSeamlessMode()) {
      advanceWorld(elapsed * state.speed * WORLD_UNITS_PER_SECOND * TILING_SCAN_DIRECTION);
    } else {
      state.position = clampPenroseValue(
        state.position + elapsed * state.speed * TILING_SCAN_DIRECTION,
      );
      if (state.position >= 1) state.playing = false;
    }
  }

  refreshWorldWindow();
  updateViewTransform();
  contacts = contactsForPenroseReader(tiling, reader);
  voicedPathContacts = state.soundEngine === "sine" ? selectVoicedPathContacts() : [];
  updateUpcomingPaths();
  const currentKeys = new Set(contacts.map(({ edgeId }) => edgeId));
  if (contactBaselineReady) strikeContacts(
    newlyEnteredPenroseContacts(contacts, previousContactKeys),
    now,
  );
  previousContactKeys = currentKeys;
  contactBaselineReady = true;
  const sustainPaths = state.audio
    && !document.hidden
    && state.soundEngine === "sine"
    && (state.playing || pointerDrag?.moved || positionJog);
  pool.setVoices(sustainPaths ? pathVoiceSpecs(voicedPathContacts) : []);

  for (const [key, startedAt] of recentPulses) {
    if (now - startedAt > 500) recentPulses.delete(key);
  }
  drawScene(now);
  updateUi();
  if (state.playing || recentPulses.size || pointerDrag || pool.activeStrikeCount || fmStrikes.size) scheduleFrame();
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvasWidth = Math.max(1, bounds.width);
  canvasHeight = Math.max(380, bounds.height);
  canvas.width = Math.round(canvasWidth * ratio);
  canvas.height = Math.round(canvasHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (state.coverage === "infinite") state.zoom = Math.max(minimumZoom(), state.zoom);
  scheduleFrame();
}

$("generation").addEventListener("input", (event) => {
  state.generation = Math.round(Number(event.target.value));
  geometryDirty = true;
  scheduleFrame();
});

$("presentation").addEventListener("change", (event) => {
  state.presentation = event.target.value;
  if (state.coverage === "infinite" && !SEAMLESS_PRESENTATIONS.has(state.presentation)) {
    state.coverage = "patch";
    $("coverage").value = "patch";
    $("liveStatus").textContent = "P1 currently uses its finite matched supertile.";
  }
  selectedTile = null;
  geometryDirty = true;
  contactBaselineReady = false;
  scheduleFrame();
});

$("variation").addEventListener("input", (event) => {
  state.variation = Math.round(Number(event.target.value));
  selectedTile = null;
  geometryDirty = true;
  contactBaselineReady = false;
  scheduleFrame();
});

$("orientation").addEventListener("input", (event) => {
  state.orientation = Number(event.target.value);
  contactBaselineReady = false;
  scheduleFrame();
});

$("angleWarp").addEventListener("input", (event) => {
  state.angleWarp = Number(event.target.value);
  contactBaselineReady = false;
  scheduleFrame();
});

$("palette").addEventListener("change", (event) => {
  state.palette = event.target.value;
  scheduleFrame();
});

$("coverage").addEventListener("change", (event) => {
  state.coverage = event.target.value === "patch" ? "patch" : "infinite";
  if (state.coverage === "infinite" && !SEAMLESS_PRESENTATIONS.has(state.presentation)) {
    state.coverage = "patch";
    event.target.value = "patch";
    $("liveStatus").textContent = "Seamless mode is available for P3, pentagrid, P2, and Robinson views.";
  }
  if (state.coverage === "infinite") state.zoom = Math.max(minimumZoom(), state.zoom);
  state.position = isSeamlessMode() ? 0.5 : state.position;
  selectedTile = null;
  geometryDirty = true;
  contactBaselineReady = false;
  scheduleFrame();
});

$("colorEnergy").addEventListener("input", (event) => {
  state.colorEnergy = Number(event.target.value);
  scheduleFrame();
});

for (const id of [
  "showTriangles",
  "showHierarchy",
  "showDirections",
  "showOutlines",
  "showPaths",
  "showLookahead",
]) {
  $(id).addEventListener("change", (event) => {
    state[id] = event.target.checked;
    scheduleFrame();
  });
}

const positionControl = $("position");
positionControl.addEventListener("pointerdown", beginPositionJog);
positionControl.addEventListener("input", (event) => {
  if (isSeamlessMode() && !positionJog) beginPositionJog();
  setPosition(Number(event.target.value));
});
positionControl.addEventListener("change", finishPositionJog);
positionControl.addEventListener("pointerup", finishPositionJog);
positionControl.addEventListener("pointercancel", finishPositionJog);
positionControl.addEventListener("blur", finishPositionJog);
positionControl.addEventListener("keyup", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") finishPositionJog();
});
$("speed").addEventListener("input", (event) => {
  state.speed = Number(event.target.value);
  scheduleFrame();
});
$("playButton").addEventListener("click", togglePlayback);
$("audioButton").addEventListener("click", () => setAudio(!state.audio));
$("level").addEventListener("input", (event) => {
  state.level = Number(event.target.value);
  pool.setLevel(state.level);
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
});
$("pitchSource").addEventListener("change", (event) => {
  state.pitchSource = event.target.value;
  syncSoundEngineUi();
});
$("soundEngine").addEventListener("change", (event) => {
  state.soundEngine = event.target.value;
  if (state.soundEngine === "sine") silenceFmStrikes();
  else pool.setVoices([]);
  syncSoundEngineUi();
  scheduleFrame();
});
$("baseFrequency").addEventListener("input", (event) => {
  state.baseFrequency = Number(event.target.value);
  $("baseFrequencyOut").textContent = `${state.baseFrequency.toFixed(1)} Hz`;
});
$("pitchRange").addEventListener("input", (event) => {
  state.pitchRange = Number(event.target.value);
  $("pitchRangeOut").textContent = `${state.pitchRange} semitones`;
});
$("decay").addEventListener("input", (event) => {
  state.decay = Number(event.target.value);
  $("decayOut").textContent = `${state.decay} ms`;
});
$("pathLevel").addEventListener("input", (event) => {
  state.pathLevel = Number(event.target.value);
  $("pathLevelOut").textContent = `${Math.round(state.pathLevel * 100)}%`;
});
$("pathVoiceCap").addEventListener("input", (event) => {
  state.pathVoiceCap = Math.round(Number(event.target.value));
  $("pathVoiceCapOut").textContent = `${state.pathVoiceCap} ${plural(state.pathVoiceCap, "voice", "voices")}`;
});
$("fmRatio").addEventListener("input", (event) => {
  state.fmRatio = Number(event.target.value);
  $("fmRatioOut").textContent = `${state.fmRatio.toFixed(2)}×`;
});
$("fmIndex").addEventListener("input", (event) => {
  state.fmIndex = Number(event.target.value);
  $("fmIndexOut").textContent = state.fmIndex.toFixed(1);
});

$("zoomOutButton").addEventListener("click", () => setZoom(state.zoom / 1.18));
$("zoomInButton").addEventListener("click", () => setZoom(state.zoom * 1.18));
$("resetViewButton").addEventListener("click", () => setZoom(DEFAULTS.zoom));

$("resetButton").addEventListener("click", () => {
  const audioWasEnabled = state.audio;
  Object.assign(state, DEFAULTS, { audio: audioWasEnabled });
  resetWorldTravel();
  $("generation").value = String(state.generation);
  $("presentation").value = state.presentation;
  $("variation").value = String(state.variation);
  $("orientation").value = String(state.orientation);
  $("angleWarp").value = String(state.angleWarp);
  $("palette").value = state.palette;
  $("colorEnergy").value = String(state.colorEnergy);
  $("coverage").value = state.coverage;
  $("position").value = String(state.position);
  $("speed").value = String(state.speed);
  $("level").value = String(state.level);
  $("pitchSource").value = state.pitchSource;
  $("soundEngine").value = state.soundEngine;
  $("baseFrequency").value = String(state.baseFrequency);
  $("pitchRange").value = String(state.pitchRange);
  $("decay").value = String(state.decay);
  $("pathLevel").value = String(state.pathLevel);
  $("pathVoiceCap").value = String(state.pathVoiceCap);
  $("fmRatio").value = String(state.fmRatio);
  $("fmIndex").value = String(state.fmIndex);
  $("showTriangles").checked = state.showTriangles;
  $("showHierarchy").checked = state.showHierarchy;
  $("showDirections").checked = state.showDirections;
  $("showOutlines").checked = state.showOutlines;
  $("showPaths").checked = state.showPaths;
  $("showLookahead").checked = state.showLookahead;
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
  $("baseFrequencyOut").textContent = `${state.baseFrequency.toFixed(1)} Hz`;
  $("pitchRangeOut").textContent = `${state.pitchRange} semitones`;
  $("decayOut").textContent = `${state.decay} ms`;
  $("pathLevelOut").textContent = `${Math.round(state.pathLevel * 100)}%`;
  $("pathVoiceCapOut").textContent = `${state.pathVoiceCap} ${plural(state.pathVoiceCap, "voice", "voices")}`;
  $("fmRatioOut").textContent = `${state.fmRatio.toFixed(2)}×`;
  $("fmIndexOut").textContent = state.fmIndex.toFixed(1);
  syncSoundEngineUi();
  pool.setLevel(state.level);
  silenceFmStrikes();
  selectedTile = null;
  recentPulses.clear();
  geometryDirty = true;
  lastFrameAt = performance.now();
  scheduleFrame();
});

canvas.addEventListener("pointerdown", (event) => {
  if (pointerDrag && pointerDrag.pointerId !== event.pointerId) return;
  const current = canvasPoint(event);
  pointerDrag = {
    pointerId: event.pointerId,
    start: current,
    point: current,
    phase: state.position,
    camera: { ...cameraWorld },
    travel: travelDistance,
    normal: { ...viewTransform.localNormal },
    moved: false,
  };
  stageWrap.classList.add("is-scrubbing");
  canvas.setPointerCapture(event.pointerId);
  scheduleFrame();
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const current = canvasPoint(event);
  const deltaX = current.x - pointerDrag.start.x;
  const deltaY = current.y - pointerDrag.start.y;
  if (Math.hypot(deltaX, deltaY) > 4) pointerDrag.moved = true;
  pointerDrag.point = current;
  if (pointerDrag.moved) {
    if (isSeamlessMode()) {
      const distance = deltaX / Math.max(1, canvasWidth) * visibleWorldHalfExtent() * 2;
      cameraWorld = {
        x: pointerDrag.camera.x + pointerDrag.normal.x * distance,
        y: pointerDrag.camera.y + pointerDrag.normal.y * distance,
      };
      viewAnchor = { ...cameraWorld };
      travelDistance = pointerDrag.travel + distance;
      scheduleFrame();
    } else {
      setPosition(pointerDrag.phase + deltaX / Math.max(1, canvasWidth));
    }
  }
});

function finishPointer(event) {
  if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
  const drag = pointerDrag;
  pointerDrag = null;
  stageWrap.classList.remove("is-scrubbing");
  if (!drag.moved) {
    const target = penroseTileAtPoint(tiling, screenToWorld(drag.point));
    selectedTile = target;
    if (target) {
      auditionTile(target);
      $("liveStatus").textContent = `${target.type} tile selected, ${penroseOrientationLabel(target.family)}.`;
    }
  }
  scheduleFrame();
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("lostpointercapture", (event) => {
  if (pointerDrag?.pointerId === event.pointerId) finishPointer(event);
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoom(state.zoom * Math.exp(-event.deltaY * 0.001));
}, { passive: false });

canvas.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    if (isSeamlessMode()) {
      advanceWorld((event.key === "ArrowRight" ? 1 : -1) * visibleWorldHalfExtent() * 0.016);
      scheduleFrame();
    } else {
      setPosition(state.position + (event.key === "ArrowRight" ? 0.008 : -0.008));
    }
  } else if (["r", "h", "f", "e", "p", "n"].includes(key)) {
    event.preventDefault();
    const id = ({
      r: "showTriangles",
      h: "showHierarchy",
      f: "showDirections",
      e: "showOutlines",
      p: "showPaths",
      n: "showLookahead",
    })[key];
    if (id === "showHierarchy" && isSeamlessMode()) {
      $("liveStatus").textContent = "Parent hierarchy is available in finite patch mode.";
      return;
    }
    state[id] = !state[id];
    $(id).checked = state[id];
    scheduleFrame();
  } else if (key === "i") {
    event.preventDefault();
    const nextCoverage = state.coverage === "infinite" ? "patch" : "infinite";
    if (nextCoverage === "infinite" && !SEAMLESS_PRESENTATIONS.has(state.presentation)) {
      $("liveStatus").textContent = "P1 currently uses its finite matched supertile.";
      return;
    }
    state.coverage = nextCoverage;
    $("coverage").value = state.coverage;
    if (state.coverage === "infinite") state.zoom = Math.max(minimumZoom(), state.zoom);
    selectedTile = null;
    geometryDirty = true;
    contactBaselineReady = false;
    scheduleFrame();
  } else if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setZoom(state.zoom * 1.12);
  } else if (event.key === "-") {
    event.preventDefault();
    setZoom(state.zoom / 1.12);
  } else if (event.key === "Home") {
    event.preventDefault();
    setZoom(DEFAULTS.zoom);
    resetWorldTravel();
  } else if (event.key === "Escape" && state.audio) {
    event.preventDefault();
    void setAudio(false);
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    state.playing = false;
    pool.silence();
    silenceFmStrikes();
  }
  lastFrameAt = performance.now();
  scheduleFrame();
});

window.addEventListener("pagehide", (event) => {
  pointerDrag = null;
  silenceFmStrikes();
  if (!event.persisted) void pool.close();
});
window.addEventListener("pageshow", () => {
  lastFrameAt = performance.now();
  scheduleFrame();
});

new ResizeObserver(resizeCanvas).observe(stageWrap);
$("phiReadout").textContent = `${PENROSE_PHI.toFixed(6)}…`;
updateGeometryUi();
syncAudioUi();
syncSoundEngineUi();
resizeCanvas();
scheduleFrame();

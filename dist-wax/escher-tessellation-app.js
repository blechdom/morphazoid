import { buildLattice, tilingInfo } from "./src/lattice.js";
import { EscherPerformanceAudio } from "./src/escher-performance-audio.js";
import {
  buildEscherContours,
  contourPointAtDistance,
  selectEscherContours,
} from "./src/escher-contours.js";
import {
  DEFAULT_ESCHER_TESSELLATION_PRESET,
  ESCHER_TESSELLATION_PALETTES,
  createHyperbolicTiling,
  createSimilarityOrbit,
  escherTessellationPalette,
  escherTessellationPreset,
  rotateEscherPoint,
  samplePoincareGeodesic,
  smoothstep,
} from "./src/escher-tessellation.js";

const TAU = Math.PI * 2;
const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const percentage = (value) => `${Math.round(clamp(value, 0, 1) * 100)}%`;
const compact = (value, digits = 2) => Number(value).toFixed(digits).replace(/\.?0+$/, "");
const PLAYBACK_LABELS = Object.freeze({
  shape: "Shape",
  neighbors: "Neighbors",
  pattern: "Pattern",
});

const DEFAULT_STATE = Object.freeze({
  presetId: DEFAULT_ESCHER_TESSELLATION_PRESET,
  paletteId: "day-night",
  density: 0.54,
  deformation: 0.72,
  rotation: 0,
  detail: 0.78,
  contrast: 0.76,
  showGeometry: true,
  showOutlines: true,
  playbackMode: "shape",
  travelSpeed: 0.32,
  neighborReach: 2,
  playheadSize: 0.65,
  playing: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  level: 0.42,
  baseFrequency: 82.5,
  tone: 0.58,
  pitchSpan: 14,
  timbreMotion: 0.72,
  stereoWidth: 0.82,
  orientationDepth: 0.68,
  colorAspectDepth: 0.76,
  positionDepth: 0.64,
  edgeArticulation: 0.72,
});

const state = { ...DEFAULT_STATE, audioOn: false, audioStarting: false };
const canvas = $("stage");
const drawing = canvas?.getContext("2d", { alpha: false, desynchronized: true });
const stageWrap = $("stageWrap");

let canvasWidth = 1;
let canvasHeight = 1;
let canvasScale = 1;
let geometry = null;
let geometryDirty = true;
let renderDirty = true;
let animationFrame = 0;
let lastFrameTime = 0;
let tileCount = 0;
let drag = null;
let pinch = null;
let gestureHadPinch = false;
const pointers = new Map();
let contourField = null;
let activeContours = [];
let selectedContourId = null;
let playbackDistance = 0;
let activeContourEvent = null;
let contourScreenCache = [];

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function currentPreset() {
  return escherTessellationPreset(state.presetId);
}

function currentPalette() {
  return escherTessellationPalette(state.paletteId);
}

function playbackLabel() {
  return PLAYBACK_LABELS[state.playbackMode] ?? PLAYBACK_LABELS.shape;
}

function performanceConfig() {
  return {
    presetId: state.presetId,
    mode: state.playbackMode,
    contours: activeContours,
    selectedContourIds: activeContours.map(({ id }) => id),
    fieldBounds: contourField?.bounds ?? null,
    travelSpeed: state.travelSpeed,
    baseFrequency: state.baseFrequency,
    pitchSpan: state.pitchSpan,
    tone: state.tone,
    timbreMotion: state.timbreMotion,
    stereoWidth: state.stereoWidth,
    orientationDepth: state.orientationDepth,
    colorAspectDepth: state.colorAspectDepth,
    positionDepth: state.positionDepth,
    edgeArticulation: state.edgeArticulation,
    visualRotation: state.rotation,
    contrast: state.contrast,
    level: state.level,
  };
}

function parseHex(color) {
  const normalized = color.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((character) => character + character).join("")
    : normalized;
  return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
}

function mixHex(first, second, amount) {
  const start = parseHex(first);
  const end = parseHex(second);
  const mix = clamp(amount, 0, 1);
  const values = start.map((channel, index) => Math.round(channel + (end[index] - channel) * mix));
  return `#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function colorWithAlpha(color, alpha) {
  const [red, green, blue] = parseHex(color);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function luminance(color) {
  const [red, green, blue] = parseHex(color);
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

function polygonCentroid(points) {
  if (!points.length) return { x: 0, y: 0 };
  return points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
}

function averagePoint(points) {
  const sum = polygonCentroid(points);
  return { x: sum.x / Math.max(1, points.length), y: sum.y / Math.max(1, points.length) };
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    area += points[index].x * points[next].y - points[next].x * points[index].y;
  }
  return area / 2;
}

function tracePolygon(context, points) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
}

const audio = new EscherPerformanceAudio(globalThis, {
  onEvent(event) {
    activeContourEvent = event ?? null;
    renderDirty = true;
  },
});

function resizeCanvas() {
  if (!canvas || !drawing) return;
  const rectangle = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rectangle.width));
  const height = Math.max(1, Math.round(rectangle.height));
  const scale = Math.min(globalThis.devicePixelRatio || 1, 2.5);
  if (width === canvasWidth && height === canvasHeight && scale === canvasScale) return;
  canvasWidth = width;
  canvasHeight = height;
  canvasScale = scale;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  drawing.setTransform(scale, 0, 0, scale, 0, 0);
  geometryDirty = true;
  renderDirty = true;
}

function rebuildGeometry() {
  const preset = currentPreset();
  if (preset.model === "hyperbolic") {
    const layers = hyperbolicLayerCount();
    geometry = createHyperbolicTiling({
      p: preset.p,
      q: preset.q,
      layers,
      maxTiles: layers >= 5 ? 1400 : 720,
    });
  } else if (preset.model === "similarity") {
    geometry = createSimilarityOrbit(similarityLevelCount());
  } else {
    const aspect = canvasWidth / Math.max(1, canvasHeight);
    const halfHeight = 2.75;
    const halfWidth = Math.max(3.2, halfHeight * aspect + 1.3);
    const info = tilingInfo(preset.tilingType);
    // Cover almost a four-to-one cell-size range so this control reads as
    // density rather than as a small zoom adjustment.
    const tileScale = 0.64 - state.density * 0.47;
    const contourBend = Math.sin(state.deformation * Math.PI / 2) * 1.75;
    geometry = buildLattice({
      type: preset.tilingType,
      parameters: preset.parameters ?? info.defaultParameters,
      edgeCurves: preset.edgeCurves.map((curve) => curve * contourBend),
      bounds: {
        minX: -halfWidth,
        minY: -halfHeight - 0.8,
        maxX: halfWidth,
        maxY: halfHeight + 0.8,
      },
      scale: tileScale,
    });
  }
  contourField = buildEscherContours({
    preset,
    geometry,
    maxContours: 512,
    maxPoints: 49_152,
  });
  if (!contourField.contours.some(({ id }) => id === selectedContourId)) {
    selectedContourId = null;
  }
  refreshActiveContours({ resetDistance: selectedContourId === null });
  geometryDirty = false;
}

function hyperbolicLayerCount() {
  return 2 + Math.round(state.density * 4);
}

function similarityLevelCount() {
  return 6 + Math.round(state.density * 22);
}

function similarityFieldRadius() {
  return Math.min(canvasWidth, canvasHeight) * (0.46 + state.density * 0.22) * state.zoom;
}

function hyperbolicDiskRadius() {
  return Math.min(canvasWidth, canvasHeight) * (0.34 + state.density * 0.18) * state.zoom;
}

function refreshActiveContours({ resetDistance = false } = {}) {
  if (!contourField) {
    activeContours = [];
    return;
  }
  activeContours = [...selectEscherContours(contourField, {
    mode: state.playbackMode,
    selectedId: selectedContourId,
    neighborReach: state.neighborReach,
    maxActive: 12,
  })];
  if (!selectedContourId && activeContours[0]) selectedContourId = activeContours[0].id;
  if (resetDistance) playbackDistance = 0;
  activeContourEvent = null;
  audio.configure(performanceConfig());
  audio.setPosition?.(playbackDistance);
  updateSummaries();
}

function worldToScreen(point) {
  const rotated = rotateEscherPoint(point, state.rotation * Math.PI / 180);
  const scale = Math.min(canvasWidth, canvasHeight) / 4.6 * state.zoom;
  return {
    x: canvasWidth / 2 + state.panX + rotated.x * scale,
    y: canvasHeight / 2 + state.panY + rotated.y * scale,
  };
}

function tileCoordinates(tile) {
  const [first = 0, second = 0] = String(tile.key ?? "0,0").split(",").map(Number);
  return { first, second };
}

function wrappedIndex(value, count) {
  return ((Math.trunc(value) % count) + count) % count;
}

function euclideanTileColorIndex(tile, worldCenter, preset, index) {
  const { first, second } = tileCoordinates(tile);
  const aspect = Number.isFinite(tile.aspect) ? tile.aspect : index;
  let colorIndex = wrappedIndex(Math.abs(aspect), preset.colors);
  if (preset.id === "counterform-current") {
    colorIndex = wrappedIndex(first + second + aspect, 2);
  } else if (preset.id === "night-flight") {
    const side = worldCenter.x < 0 ? 0 : 1;
    colorIndex = wrappedIndex(side + first + aspect, 2);
  } else if (preset.id === "triple-orbit") {
    colorIndex = wrappedIndex(first + second * 2 + aspect, 3);
  } else if (preset.id === "glide-parade") {
    colorIndex = wrappedIndex(first + wrappedIndex(second, 2) * 2 + aspect, 4);
  } else if (preset.id === "metamorphosis-band") {
    const bounds = geometry?.bounds ?? { minX: -4.5, maxX: 4.5 };
    const horizontal = clamp(
      (worldCenter.x - bounds.minX) / Math.max(0.001, bounds.maxX - bounds.minX),
      0,
      0.999,
    );
    colorIndex = wrappedIndex(Math.floor(horizontal * preset.colors) + aspect, preset.colors);
  }
  return colorIndex;
}

function contrastMixAmount() {
  const normalized = clamp((state.contrast - 0.2) / 0.8, 0, 1);
  return 0.08 + smoothstep(0, 1, normalized) * 0.92;
}

function euclideanTileColor(tile, worldCenter, preset, index) {
  const palette = currentPalette();
  const colorIndex = euclideanTileColorIndex(tile, worldCenter, preset, index);
  return mixHex(
    palette.background,
    palette.colors[colorIndex % palette.colors.length],
    contrastMixAmount(),
  );
}

function glyphColor(fill) {
  const palette = currentPalette();
  return luminance(fill) > 0.5
    ? mixHex(palette.background, "#000000", 0.35)
    : mixHex(palette.ink, "#ffffff", 0.08);
}

function drawMotifEye(x, y, radius, ink, accent) {
  drawing.fillStyle = colorWithAlpha(accent, 0.96);
  drawing.beginPath();
  drawing.arc(x, y, radius * 1.65, 0, TAU);
  drawing.fill();
  drawing.fillStyle = colorWithAlpha(ink, 0.98);
  drawing.beginPath();
  drawing.arc(x + radius * 0.24, y, radius, 0, TAU);
  drawing.fill();
}

function drawJointedLeg(size, points, ink, detail) {
  drawing.strokeStyle = colorWithAlpha(ink, 0.8 + detail * 0.18);
  drawing.lineWidth = clamp(size * 0.072, 1, 4.8);
  drawing.beginPath();
  drawing.moveTo(points[0][0] * size, points[0][1] * size);
  drawing.lineTo(points[1][0] * size, points[1][1] * size);
  drawing.lineTo(points[2][0] * size, points[2][1] * size);
  drawing.stroke();
  if (detail < 0.58 || size < 10) return;
  drawing.lineWidth = clamp(size * 0.025, 0.65, 1.5);
  const [footX, footY] = points[2];
  const direction = footY < 0 ? -1 : 1;
  drawing.beginPath();
  for (let toe = -1; toe <= 1; toe += 1) {
    drawing.moveTo(footX * size, footY * size);
    drawing.lineTo(
      (footX + 0.075 + Math.abs(toe) * 0.012) * size,
      (footY + direction * toe * 0.045) * size,
    );
  }
  drawing.stroke();
}

function drawReptileMotif(size, detail, ink, accent, variant) {
  drawing.fillStyle = colorWithAlpha(ink, 0.2 + detail * 0.2);
  drawing.strokeStyle = colorWithAlpha(ink, 0.78 + detail * 0.2);
  drawing.lineWidth = clamp(size * 0.042, 0.8, 2.8);
  drawing.beginPath();
  drawing.moveTo(-size * 0.7, size * 0.02);
  drawing.bezierCurveTo(-size * 0.52, -size * 0.1, -size * 0.4, -size * 0.18, -size * 0.2, -size * 0.17);
  drawing.bezierCurveTo(size * 0.02, -size * 0.28, size * 0.24, -size * 0.21, size * 0.35, -size * 0.12);
  drawing.lineTo(size * 0.57, -size * 0.14);
  drawing.quadraticCurveTo(size * 0.72, -size * 0.05, size * 0.57, size * 0.08);
  drawing.lineTo(size * 0.35, size * 0.12);
  drawing.bezierCurveTo(size * 0.2, size * 0.25, -size * 0.04, size * 0.27, -size * 0.24, size * 0.17);
  drawing.bezierCurveTo(-size * 0.44, size * 0.13, -size * 0.57, size * 0.08, -size * 0.7, size * 0.02);
  drawing.closePath();
  drawing.fill();
  drawing.stroke();
  if (detail < 0.16) return;
  drawJointedLeg(size, [[-0.18, -0.12], [-0.34, -0.34], [-0.51, -0.3]], ink, detail);
  drawJointedLeg(size, [[0.16, -0.12], [0.3, -0.34], [0.48, -0.3]], ink, detail);
  drawJointedLeg(size, [[-0.17, 0.13], [-0.31, 0.34], [-0.49, 0.31]], ink, detail);
  drawJointedLeg(size, [[0.16, 0.13], [0.29, 0.35], [0.47, 0.31]], ink, detail);
  if (detail < 0.32) return;
  drawMotifEye(size * 0.48, -size * 0.055, Math.max(0.7, size * 0.027), ink, accent);
  drawing.strokeStyle = colorWithAlpha(accent, 0.72);
  drawing.lineWidth = clamp(size * 0.022, 0.6, 1.35);
  drawing.beginPath();
  drawing.moveTo(-size * 0.47, 0);
  drawing.bezierCurveTo(-size * 0.2, -size * 0.07, size * 0.08, size * 0.07, size * 0.34, -size * 0.015);
  drawing.stroke();
  if (detail < 0.52 || size < 9) return;
  drawing.fillStyle = colorWithAlpha(accent, 0.76);
  const markingCount = 2 + Math.round(detail * 3);
  for (let index = 0; index < markingCount; index += 1) {
    const x = (-0.28 + index * 0.14) * size;
    if (wrappedIndex(variant, 3) === 0) {
      drawing.beginPath();
      drawing.arc(x, (index % 2 ? 0.055 : -0.04) * size, Math.max(0.55, size * 0.034), 0, TAU);
      drawing.fill();
    } else {
      drawing.beginPath();
      drawing.moveTo(x - size * 0.035, -size * 0.095);
      drawing.lineTo(x + size * 0.035, 0);
      drawing.lineTo(x - size * 0.035, size * 0.095);
      drawing.stroke();
    }
  }
}

function drawFishMotif(size, detail, ink, accent) {
  drawing.strokeStyle = colorWithAlpha(ink, 0.84 + detail * 0.14);
  drawing.fillStyle = colorWithAlpha(ink, 0.17 + detail * 0.18);
  drawing.lineWidth = clamp(size * 0.045, 0.75, 3);
  drawing.beginPath();
  drawing.moveTo(-size * 0.34, 0);
  drawing.lineTo(-size * 0.64, -size * 0.27);
  drawing.lineTo(-size * 0.57, 0);
  drawing.lineTo(-size * 0.64, size * 0.27);
  drawing.lineTo(-size * 0.34, size * 0.08);
  drawing.bezierCurveTo(-size * 0.08, size * 0.3, size * 0.4, size * 0.22, size * 0.63, 0);
  drawing.bezierCurveTo(size * 0.4, -size * 0.22, -size * 0.08, -size * 0.3, -size * 0.34, 0);
  drawing.closePath();
  drawing.fill();
  drawing.stroke();
  if (detail < 0.2) return;
  drawing.beginPath();
  drawing.moveTo(-size * 0.06, -size * 0.19);
  drawing.lineTo(-size * 0.18, -size * 0.39);
  drawing.lineTo(size * 0.16, -size * 0.21);
  drawing.moveTo(-size * 0.03, size * 0.19);
  drawing.lineTo(-size * 0.18, size * 0.39);
  drawing.lineTo(size * 0.17, size * 0.2);
  drawing.stroke();
  drawMotifEye(size * 0.43, -size * 0.055, Math.max(0.7, size * 0.026), ink, accent);
  if (detail < 0.48 || size < 9) return;
  drawing.strokeStyle = colorWithAlpha(accent, 0.7);
  drawing.lineWidth = clamp(size * 0.02, 0.55, 1.2);
  drawing.beginPath();
  drawing.moveTo(size * 0.28, -size * 0.15);
  drawing.quadraticCurveTo(size * 0.19, 0, size * 0.29, size * 0.15);
  for (let x = -0.19; x <= 0.14; x += 0.11) {
    drawing.moveTo(x * size, -size * 0.1);
    drawing.quadraticCurveTo((x + 0.055) * size, 0, x * size, size * 0.1);
  }
  drawing.stroke();
}

function drawBirdMotif(size, detail, ink, accent) {
  drawing.fillStyle = colorWithAlpha(ink, 0.18 + detail * 0.2);
  drawing.strokeStyle = colorWithAlpha(ink, 0.82 + detail * 0.16);
  drawing.lineWidth = clamp(size * 0.043, 0.75, 3);
  drawing.beginPath();
  drawing.moveTo(-size * 0.62, size * 0.05);
  drawing.lineTo(-size * 0.38, -size * 0.08);
  drawing.quadraticCurveTo(-size * 0.16, -size * 0.2, size * 0.18, -size * 0.09);
  drawing.quadraticCurveTo(size * 0.34, -size * 0.18, size * 0.48, -size * 0.08);
  drawing.lineTo(size * 0.68, 0);
  drawing.lineTo(size * 0.47, size * 0.08);
  drawing.quadraticCurveTo(size * 0.22, size * 0.25, -size * 0.19, size * 0.15);
  drawing.lineTo(-size * 0.62, size * 0.05);
  drawing.closePath();
  drawing.fill();
  drawing.stroke();
  drawing.beginPath();
  drawing.moveTo(-size * 0.16, -size * 0.08);
  drawing.quadraticCurveTo(-size * 0.08, -size * 0.54, size * 0.2, -size * 0.19);
  drawing.quadraticCurveTo(size * 0.36, -size * 0.02, size * 0.08, size * 0.02);
  drawing.moveTo(-size * 0.12, size * 0.11);
  drawing.quadraticCurveTo(-size * 0.02, size * 0.5, size * 0.23, size * 0.17);
  drawing.stroke();
  if (detail < 0.3) return;
  drawMotifEye(size * 0.4, -size * 0.07, Math.max(0.65, size * 0.024), ink, accent);
  drawing.strokeStyle = colorWithAlpha(accent, 0.7);
  drawing.lineWidth = clamp(size * 0.02, 0.55, 1.25);
  drawing.beginPath();
  drawing.moveTo(-size * 0.06, -size * 0.18);
  drawing.quadraticCurveTo(size * 0.07, -size * 0.32, size * 0.2, -size * 0.18);
  if (detail > 0.62) {
    drawing.moveTo(-size * 0.2, -size * 0.26);
    drawing.lineTo(size * 0.1, -size * 0.12);
    drawing.moveTo(-size * 0.17, size * 0.25);
    drawing.lineTo(size * 0.11, size * 0.12);
  }
  drawing.stroke();
}

function drawCourierMotif(size, detail, ink, accent) {
  drawing.strokeStyle = colorWithAlpha(ink, 0.84 + detail * 0.14);
  drawing.fillStyle = colorWithAlpha(ink, 0.18 + detail * 0.18);
  drawing.lineWidth = clamp(size * 0.045, 0.8, 3.1);
  drawing.beginPath();
  drawing.moveTo(-size * 0.56, -size * 0.03);
  drawing.quadraticCurveTo(-size * 0.38, -size * 0.21, -size * 0.13, -size * 0.16);
  drawing.lineTo(size * 0.2, -size * 0.18);
  drawing.lineTo(size * 0.34, -size * 0.38);
  drawing.lineTo(size * 0.53, -size * 0.27);
  drawing.lineTo(size * 0.62, -size * 0.1);
  drawing.lineTo(size * 0.43, size * 0.02);
  drawing.quadraticCurveTo(size * 0.16, size * 0.22, -size * 0.2, size * 0.16);
  drawing.quadraticCurveTo(-size * 0.44, size * 0.15, -size * 0.56, -size * 0.03);
  drawing.closePath();
  drawing.fill();
  drawing.stroke();
  drawing.beginPath();
  drawing.moveTo(-size * 0.48, -size * 0.04);
  drawing.quadraticCurveTo(-size * 0.67, -size * 0.31, -size * 0.72, -size * 0.05);
  drawing.stroke();
  if (detail < 0.18) return;
  drawJointedLeg(size, [[-0.23, 0.1], [-0.32, 0.34], [-0.18, 0.39]], ink, detail);
  drawJointedLeg(size, [[0.1, 0.1], [0.22, 0.34], [0.39, 0.36]], ink, detail);
  if (detail < 0.38) return;
  drawMotifEye(size * 0.49, -size * 0.25, Math.max(0.65, size * 0.022), ink, accent);
  drawing.strokeStyle = colorWithAlpha(accent, 0.78);
  drawing.lineWidth = clamp(size * 0.024, 0.6, 1.4);
  drawing.beginPath();
  drawing.moveTo(-size * 0.04, -size * 0.17);
  drawing.lineTo(-size * 0.02, -size * 0.46);
  drawing.lineTo(size * 0.23, -size * 0.31);
  drawing.closePath();
  drawing.stroke();
}

function drawMetamorphosisMotif(size, detail, ink, accent, progress) {
  drawing.strokeStyle = colorWithAlpha(ink, 0.84 + detail * 0.14);
  drawing.fillStyle = colorWithAlpha(ink, 0.15 + detail * 0.16);
  drawing.lineWidth = clamp(size * 0.042, 0.75, 2.8);
  if (progress < 0.3) {
    const roundness = progress / 0.3;
    const extent = size * (0.42 - roundness * 0.06);
    drawing.beginPath();
    drawing.moveTo(-extent, -extent * (1 - roundness * 0.35));
    drawing.quadraticCurveTo(0, -extent * (1 + roundness * 0.12), extent, -extent * (1 - roundness * 0.35));
    drawing.lineTo(extent, extent * (1 - roundness * 0.35));
    drawing.quadraticCurveTo(0, extent * (1 + roundness * 0.12), -extent, extent * (1 - roundness * 0.35));
    drawing.closePath();
    drawing.fill();
    drawing.stroke();
    if (detail > 0.42) {
      drawing.strokeStyle = colorWithAlpha(accent, 0.68);
      drawing.beginPath();
      drawing.moveTo(-extent * 0.72, 0);
      drawing.lineTo(extent * 0.72, 0);
      drawing.moveTo(0, -extent * 0.72);
      drawing.lineTo(0, extent * 0.72);
      drawing.stroke();
    }
  } else if (progress < 0.68) {
    const bend = (progress - 0.3) / 0.38;
    drawing.beginPath();
    drawing.moveTo(-size * 0.52, size * 0.08);
    drawing.bezierCurveTo(-size * 0.28, -size * (0.22 + bend * 0.16), size * 0.22, -size * 0.27, size * 0.52, -size * 0.02);
    drawing.bezierCurveTo(size * 0.22, size * 0.28, -size * 0.27, size * (0.2 + bend * 0.1), -size * 0.52, size * 0.08);
    drawing.closePath();
    drawing.fill();
    drawing.stroke();
    if (detail > 0.32) drawMotifEye(size * 0.34, -size * 0.08, Math.max(0.65, size * 0.022), ink, accent);
  } else {
    drawFishMotif(size, detail, ink, accent);
  }
}

function drawArrowMotif(size, detail, ink, accent) {
  drawing.strokeStyle = colorWithAlpha(ink, 0.84 + detail * 0.14);
  drawing.fillStyle = colorWithAlpha(ink, 0.17 + detail * 0.18);
  drawing.lineWidth = clamp(size * 0.045, 0.75, 2.8);
  drawing.beginPath();
  drawing.moveTo(-size * 0.58, size * 0.22);
  drawing.lineTo(-size * 0.19, -size * 0.02);
  drawing.lineTo(-size * 0.19, -size * 0.31);
  drawing.lineTo(size * 0.58, 0);
  drawing.lineTo(-size * 0.19, size * 0.31);
  drawing.lineTo(-size * 0.19, size * 0.1);
  drawing.closePath();
  drawing.fill();
  drawing.stroke();
  if (detail < 0.3) return;
  drawMotifEye(size * 0.36, -size * 0.045, Math.max(0.55, size * 0.022), ink, accent);
  drawing.strokeStyle = colorWithAlpha(accent, 0.7);
  drawing.lineWidth = clamp(size * 0.021, 0.55, 1.2);
  drawing.beginPath();
  drawing.moveTo(-size * 0.08, 0);
  drawing.lineTo(size * 0.26, 0);
  if (detail > 0.62) {
    drawing.moveTo(-size * 0.11, -size * 0.13);
    drawing.lineTo(size * 0.18, -size * 0.04);
    drawing.moveTo(-size * 0.11, size * 0.13);
    drawing.lineTo(size * 0.18, size * 0.04);
  }
  drawing.stroke();
}

function drawCometMotif(size, detail, ink, accent) {
  drawing.fillStyle = colorWithAlpha(ink, 0.18 + detail * 0.2);
  drawing.strokeStyle = colorWithAlpha(ink, 0.84 + detail * 0.14);
  drawing.lineWidth = clamp(size * 0.045, 0.7, 2.8);
  drawing.beginPath();
  drawing.moveTo(-size * 0.68, -size * 0.18);
  drawing.quadraticCurveTo(-size * 0.42, -size * 0.06, -size * 0.2, -size * 0.16);
  drawing.bezierCurveTo(size * 0.08, -size * 0.31, size * 0.43, -size * 0.21, size * 0.65, 0);
  drawing.bezierCurveTo(size * 0.43, size * 0.21, size * 0.08, size * 0.31, -size * 0.2, size * 0.16);
  drawing.quadraticCurveTo(-size * 0.42, size * 0.06, -size * 0.68, size * 0.18);
  drawing.lineTo(-size * 0.49, 0);
  drawing.closePath();
  drawing.fill();
  drawing.stroke();
  if (detail < 0.3) return;
  drawMotifEye(size * 0.43, -size * 0.05, Math.max(0.55, size * 0.022), ink, accent);
  drawing.strokeStyle = colorWithAlpha(accent, 0.72);
  drawing.lineWidth = clamp(size * 0.021, 0.55, 1.2);
  drawing.beginPath();
  drawing.moveTo(-size * 0.18, -size * 0.15);
  drawing.lineTo(-size * 0.03, -size * 0.37);
  drawing.lineTo(size * 0.16, -size * 0.2);
  if (detail > 0.64) {
    drawing.moveTo(-size * 0.25, -size * 0.05);
    drawing.quadraticCurveTo(-size * 0.06, 0, -size * 0.25, size * 0.05);
    drawing.moveTo(0, -size * 0.08);
    drawing.quadraticCurveTo(size * 0.16, 0, 0, size * 0.08);
  }
  drawing.stroke();
}

function drawDualMotif(size, detail, ink, accent, variant) {
  drawing.strokeStyle = colorWithAlpha(ink, 0.84 + detail * 0.14);
  drawing.fillStyle = colorWithAlpha(ink, 0.17 + detail * 0.18);
  drawing.lineWidth = clamp(size * 0.044, 0.7, 2.8);
  if (wrappedIndex(variant, 2) === 0) {
    drawing.beginPath();
    drawing.moveTo(-size * 0.62, -size * 0.1);
    drawing.quadraticCurveTo(-size * 0.38, -size * 0.48, -size * 0.08, -size * 0.13);
    drawing.quadraticCurveTo(0, -size * 0.31, size * 0.08, -size * 0.13);
    drawing.quadraticCurveTo(size * 0.38, -size * 0.48, size * 0.62, -size * 0.1);
    drawing.lineTo(size * 0.18, size * 0.22);
    drawing.lineTo(0, size * 0.43);
    drawing.lineTo(-size * 0.18, size * 0.22);
    drawing.closePath();
    drawing.fill();
    drawing.stroke();
    if (detail > 0.42) {
      drawMotifEye(-size * 0.055, 0, Math.max(0.5, size * 0.018), ink, accent);
      drawMotifEye(size * 0.055, 0, Math.max(0.5, size * 0.018), ink, accent);
    }
  } else {
    drawing.beginPath();
    for (let petal = 0; petal < 6; petal += 1) {
      const angle = petal * TAU / 6;
      const shoulder = angle + TAU / 18;
      if (petal === 0) drawing.moveTo(Math.cos(angle) * size * 0.14, Math.sin(angle) * size * 0.14);
      else drawing.lineTo(Math.cos(angle) * size * 0.14, Math.sin(angle) * size * 0.14);
      drawing.quadraticCurveTo(
        Math.cos(shoulder) * size * 0.48,
        Math.sin(shoulder) * size * 0.48,
        Math.cos(angle + TAU / 12) * size * 0.61,
        Math.sin(angle + TAU / 12) * size * 0.61,
      );
      drawing.quadraticCurveTo(
        Math.cos(angle + TAU / 9) * size * 0.47,
        Math.sin(angle + TAU / 9) * size * 0.47,
        Math.cos(angle + TAU / 6) * size * 0.14,
        Math.sin(angle + TAU / 6) * size * 0.14,
      );
    }
    drawing.closePath();
    drawing.fill();
    drawing.stroke();
    if (detail > 0.42) {
      drawing.fillStyle = colorWithAlpha(accent, 0.82);
      drawing.beginPath();
      drawing.arc(0, 0, size * 0.11, 0, TAU);
      drawing.fill();
    }
  }
}

function drawMotifGlyph({
  kind,
  center,
  radius,
  angle,
  fill,
  detail,
  mirrored = false,
  progress = 0.5,
  variant = 0,
  clipPoints = null,
}) {
  if (!drawing || radius < 3.2 || detail <= 0.025) return;
  const ink = glyphColor(fill);
  const accent = luminance(fill) > 0.48
    ? mixHex(fill, "#ffffff", 0.58)
    : mixHex(fill, "#ffffff", 0.82);
  const size = Math.min(radius * 1.12, 76);
  drawing.save();
  if (clipPoints?.length >= 3) {
    tracePolygon(drawing, clipPoints);
    drawing.clip();
  }
  drawing.translate(center.x, center.y);
  drawing.rotate(angle);
  drawing.scale(1, mirrored ? -1 : 1);
  drawing.lineCap = "round";
  drawing.lineJoin = "round";

  if (kind === "counterform") drawFishMotif(size, detail, ink, accent);
  else if (kind === "night-flight") drawBirdMotif(size, detail, ink, accent);
  else if (kind === "triple") drawReptileMotif(size, detail, ink, accent, variant);
  else if (kind === "glide") drawCourierMotif(size, detail, ink, accent);
  else if (kind === "metamorphosis") drawMetamorphosisMotif(size, detail, ink, accent, progress);
  else if (kind === "hyperbolic-flow") drawCometMotif(size, detail, ink, accent);
  else if (kind === "hyperbolic-dual") drawDualMotif(size, detail, ink, accent, variant);
  else if (kind === "similarity") drawArrowMotif(size, detail, ink, accent);
  drawing.restore();
}

function drawEuclidean() {
  const preset = currentPreset();
  const palette = currentPalette();
  let visibleTiles = 0;
  let domain = null;
  geometry.tiles.forEach((tile, index) => {
    const points = tile.points.map((point) => worldToScreen(point, preset));
    const center = averagePoint(points);
    const worldCenter = averagePoint(tile.points);
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    if (Math.max(...xs) < -6 || Math.min(...xs) > canvasWidth + 6 || Math.max(...ys) < -6 || Math.min(...ys) > canvasHeight + 6) return;
    visibleTiles += 1;
    const colorIndex = euclideanTileColorIndex(tile, worldCenter, preset, index);
    const fill = euclideanTileColor(tile, worldCenter, preset, index);
    tracePolygon(drawing, points);
    drawing.fillStyle = fill;
    drawing.fill();
    if (state.showOutlines) {
      drawing.strokeStyle = colorWithAlpha(palette.ink, 0.08 + contrastMixAmount() * 0.3);
      drawing.lineWidth = 0.65 + contrastMixAmount() * 0.35;
      drawing.stroke();
    }
    const radius = Math.sqrt(Math.max(1, Math.abs(polygonArea(points))) / Math.PI);
    const angle = points.length > 1
      ? Math.atan2(points[0].y - center.y, points[0].x - center.x)
      : 0;
    let detail = state.detail;
    let progress = clamp(
      (worldCenter.x - geometry.bounds.minX) / Math.max(0.001, geometry.bounds.maxX - geometry.bounds.minX),
      0,
      1,
    );
    if (preset.id === "counterform-current") {
      const distance = Math.abs(center.y / Math.max(1, canvasHeight) - 0.5) * 2;
      detail *= 0.38 + distance * 0.62;
    } else if (preset.id === "night-flight") {
      detail *= 0.46 + Math.abs(center.x / Math.max(1, canvasWidth) - 0.5) * 1.08;
    } else if (preset.id === "metamorphosis-band") {
      progress = smoothstep(0.08, 0.92, progress);
    }
    drawMotifGlyph({
      kind: preset.motif,
      center,
      radius,
      angle,
      fill,
      detail,
      mirrored: polygonArea(tile.points) < 0,
      progress,
      variant: colorIndex,
      clipPoints: points,
    });
    if (!domain || Math.hypot(center.x - canvasWidth / 2, center.y - canvasHeight / 2) < domain.distance) {
      domain = { points, center, distance: Math.hypot(center.x - canvasWidth / 2, center.y - canvasHeight / 2) };
    }
  });
  tileCount = visibleTiles;

  if (state.showGeometry && domain) {
    tracePolygon(drawing, domain.points);
    drawing.strokeStyle = colorWithAlpha(palette.ink, 0.88);
    drawing.lineWidth = 1.8;
    drawing.stroke();
    drawing.fillStyle = colorWithAlpha(palette.ink, 0.95);
    drawing.beginPath();
    drawing.arc(domain.center.x, domain.center.y, 3.2, 0, TAU);
    drawing.fill();
    drawing.font = "700 9px ui-monospace, SFMono-Regular, Consolas, monospace";
    drawing.fillText("FUNDAMENTAL TILE", domain.center.x + 9, domain.center.y - 8);
    drawing.strokeStyle = colorWithAlpha(palette.ink, 0.52);
    drawing.lineWidth = 1;
    drawing.beginPath();
    drawing.moveTo(24, canvasHeight - 42);
    drawing.lineTo(92, canvasHeight - 42);
    drawing.moveTo(24, canvasHeight - 42);
    drawing.lineTo(58, canvasHeight - 72);
    drawing.stroke();
    drawing.fillStyle = colorWithAlpha(palette.ink, 0.75);
    drawing.fillText("a", 96, canvasHeight - 39);
    drawing.fillText("b", 60, canvasHeight - 76);
  }
}

function squareVertices(radius, rotation) {
  return Array.from({ length: 4 }, (_, index) => {
    const angle = rotation + Math.PI / 4 + index * Math.PI / 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function closestPair(points, target) {
  return points
    .map((point) => ({ point, distance: Math.hypot(point.x - target.x, point.y - target.y) }))
    .sort((first, second) => first.distance - second.distance)
    .slice(0, 2)
    .map(({ point }) => point);
}

function drawSimilarity() {
  const palette = currentPalette();
  const center = { x: canvasWidth / 2 + state.panX, y: canvasHeight / 2 + state.panY };
  const baseRadius = similarityFieldRadius();
  const rotation = state.rotation * Math.PI / 180;
  let rendered = 0;
  drawing.save();
  drawing.translate(center.x, center.y);
  for (const orbit of geometry) {
    const outerRadius = baseRadius * orbit.scale;
    if (outerRadius < 0.7) break;
    const innerRadius = baseRadius * orbit.innerScale;
    const outer = squareVertices(outerRadius, rotation + orbit.rotation);
    const inner = squareVertices(innerRadius, rotation + orbit.rotation + Math.PI / 4);
    outer.forEach((corner, sector) => {
      const adjacent = closestPair(inner, corner);
      const points = [corner, adjacent[0], adjacent[1]];
      const fill = mixHex(
        palette.background,
        palette.colors[(orbit.level + sector) % palette.colors.length],
        contrastMixAmount(),
      );
      tracePolygon(drawing, points);
      drawing.fillStyle = fill;
      drawing.fill();
      if (state.showOutlines || state.showGeometry) {
        drawing.strokeStyle = colorWithAlpha(palette.ink, state.showGeometry ? 0.46 : 0.2);
        drawing.lineWidth = state.showGeometry ? 1.1 : 0.7;
        drawing.stroke();
      }
      const localCenter = averagePoint(points);
      drawMotifGlyph({
        kind: "similarity",
        center: localCenter,
        radius: Math.sqrt(Math.abs(polygonArea(points)) / Math.PI),
        angle: Math.atan2(corner.y, corner.x),
        fill,
        detail: state.detail,
        mirrored: sector % 2 === 1,
        variant: (orbit.level + sector) % palette.colors.length,
        clipPoints: points,
      });
      rendered += 1;
    });
  }
  if (state.showGeometry) {
    drawing.fillStyle = colorWithAlpha(palette.ink, 0.9);
    drawing.font = "700 9px ui-monospace, SFMono-Regular, Consolas, monospace";
    drawing.fillText("S(z) = e^(iπ/4)z / √2", -baseRadius * 0.88, baseRadius * 0.87);
  }
  drawing.restore();
  tileCount = rendered;
}

function diskToScreen(point, center, radius, angle) {
  const rotated = rotateEscherPoint(point, angle);
  return { x: center.x + rotated.x * radius, y: center.y + rotated.y * radius };
}

function traceHyperbolicPolygon(context, tile, center, radius, rotation) {
  if (!tile?.points?.length) return;
  context.beginPath();
  for (let edgeIndex = 0; edgeIndex < tile.points.length; edgeIndex += 1) {
    const start = tile.points[edgeIndex];
    const end = tile.points[(edgeIndex + 1) % tile.points.length];
    const segments = tile.depth <= 1 ? 12 : tile.depth <= 3 ? 6 : 3;
    const geodesic = samplePoincareGeodesic(start, end, segments);
    for (let pointIndex = edgeIndex === 0 ? 0 : 1; pointIndex < geodesic.length; pointIndex += 1) {
      const point = diskToScreen(geodesic[pointIndex], center, radius, rotation);
      if (edgeIndex === 0 && pointIndex === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
  }
  context.closePath();
}

function drawHyperbolic() {
  const preset = currentPreset();
  const palette = currentPalette();
  const center = { x: canvasWidth / 2 + state.panX, y: canvasHeight / 2 + state.panY };
  const radius = hyperbolicDiskRadius();
  const rotation = state.rotation * Math.PI / 180;
  drawing.save();
  drawing.beginPath();
  drawing.arc(center.x, center.y, radius, 0, TAU);
  drawing.clip();
  drawing.fillStyle = mixHex(palette.background, palette.colors[1], 0.12);
  drawing.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
  const ordered = [...geometry].sort((first, second) => second.depth - first.depth);
  for (const tile of ordered) {
    const points = tile.points.map((point) => diskToScreen(point, center, radius, rotation));
    const screenCenter = diskToScreen(tile.center, center, radius, rotation);
    const colorIndex = preset.id === "dual-horizon"
      ? tile.color
      : (tile.depth + tile.id.split(".").length) % preset.colors;
    const fill = mixHex(
      palette.background,
      palette.colors[colorIndex % palette.colors.length],
      contrastMixAmount(),
    );
    traceHyperbolicPolygon(drawing, tile, center, radius, rotation);
    drawing.fillStyle = fill;
    drawing.fill();
    if (state.showOutlines || state.showGeometry) {
      drawing.strokeStyle = colorWithAlpha(palette.ink, state.showGeometry ? 0.27 : 0.14);
      drawing.lineWidth = state.showGeometry ? 0.9 : 0.55;
      drawing.stroke();
    }
    const localRadius = points.reduce(
      (maximum, point) => Math.max(maximum, Math.hypot(point.x - screenCenter.x, point.y - screenCenter.y)),
      0,
    );
    drawMotifGlyph({
      kind: preset.motif,
      center: screenCenter,
      radius: localRadius * 0.62,
      angle: points.length
        ? Math.atan2(points[0].y - screenCenter.y, points[0].x - screenCenter.x)
        : Math.atan2(screenCenter.y - center.y, screenCenter.x - center.x),
      fill,
      detail: state.detail * smoothstep(1.5, 8, localRadius),
      mirrored: polygonArea(points) < 0,
      variant: colorIndex,
      clipPoints: points,
    });
  }
  drawing.restore();
  drawing.strokeStyle = colorWithAlpha(palette.ink, 0.76);
  drawing.lineWidth = 1.5;
  drawing.beginPath();
  drawing.arc(center.x, center.y, radius, 0, TAU);
  drawing.stroke();
  tileCount = geometry.length;

  if (state.showGeometry && geometry[0]) {
    const root = geometry[0];
    const vertex = diskToScreen(root.points[0], center, radius, rotation);
    const geodesic = samplePoincareGeodesic(root.points[0], root.points[1], 20);
    const midpoint = diskToScreen(geodesic[Math.floor(geodesic.length / 2)], center, radius, rotation);
    drawing.fillStyle = colorWithAlpha(palette.ink, 0.92);
    drawing.strokeStyle = colorWithAlpha(palette.ink, 0.82);
    drawing.lineWidth = 1.2;
    drawing.beginPath();
    drawing.moveTo(center.x, center.y);
    drawing.lineTo(vertex.x, vertex.y);
    drawing.lineTo(midpoint.x, midpoint.y);
    drawing.closePath();
    drawing.stroke();
    drawing.font = "700 9px ui-monospace, SFMono-Regular, Consolas, monospace";
    drawing.fillText(`{${preset.p},${preset.q}}`, center.x + 9, center.y - 9);
  }
}

function contourPointToScreen(point, model = currentPreset().model) {
  if (model === "hyperbolic") {
    const center = { x: canvasWidth / 2 + state.panX, y: canvasHeight / 2 + state.panY };
    const radius = hyperbolicDiskRadius();
    return diskToScreen(point, center, radius, state.rotation * Math.PI / 180);
  }
  if (model === "similarity") {
    const center = { x: canvasWidth / 2 + state.panX, y: canvasHeight / 2 + state.panY };
    const radius = similarityFieldRadius();
    const rotated = rotateEscherPoint(point, state.rotation * Math.PI / 180);
    return { x: center.x + rotated.x * radius, y: center.y + rotated.y * radius };
  }
  return worldToScreen(point, currentPreset());
}

function pointInsidePolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const first = polygon[index];
    const second = polygon[previous];
    const verticalSpan = second.y - first.y;
    const crosses = (first.y > point.y) !== (second.y > point.y)
      && point.x < (second.x - first.x) * (point.y - first.y)
        / (Math.abs(verticalSpan) < 1e-9 ? (verticalSpan < 0 ? -1e-9 : 1e-9) : verticalSpan) + first.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function drawContourPlayheads() {
  if (!contourField) return;
  const palette = currentPalette();
  const activeIds = new Set(activeContours.map(({ id }) => id));
  contourScreenCache = contourField.contours.map((contour) => {
    const points = contour.points.map((point) => contourPointToScreen(point, contour.model));
    return {
      contour,
      points,
      area: Math.abs(polygonArea(points)),
    };
  }).filter(({ points }) => points.length >= 3);

  drawing.save();
  drawing.setLineDash([]);
  for (const { contour, points } of contourScreenCache) {
    const active = activeIds.has(contour.id);
    const selected = contour.id === selectedContourId;
    if (!active && !selected) continue;
    tracePolygon(drawing, points);
    drawing.strokeStyle = colorWithAlpha(
      selected ? palette.ink : (palette.colors[Math.abs(contour.color ?? 0) % palette.colors.length] ?? palette.ink),
      selected ? 0.92 : 0.48,
    );
    drawing.lineWidth = selected ? 2.8 : 1.5;
    drawing.stroke();
    if (!state.playing || !active || contour.perimeter <= 0) continue;
    const position = contourPointAtDistance(contour, playbackDistance);
    const edge = contour.edges[position.edgeIndex];
    if (edge?.points?.length) {
      const edgePoints = edge.points.map((edgePoint) => contourPointToScreen(edgePoint, contour.model));
      drawing.beginPath();
      drawing.moveTo(edgePoints[0].x, edgePoints[0].y);
      for (let index = 1; index < edgePoints.length; index += 1) {
        drawing.lineTo(edgePoints[index].x, edgePoints[index].y);
      }
      drawing.strokeStyle = colorWithAlpha(palette.ink, 0.94);
      drawing.lineWidth = 2.4 + state.playheadSize * 2.6;
      drawing.stroke();
    }
    const point = contourPointToScreen(position.point, contour.model);
    const radius = 3.2 + state.playheadSize * 5.8;
    drawing.beginPath();
    drawing.arc(point.x, point.y, radius * 1.9, 0, TAU);
    drawing.fillStyle = colorWithAlpha(palette.background, 0.58);
    drawing.fill();
    drawing.beginPath();
    drawing.arc(point.x, point.y, radius, 0, TAU);
    drawing.fillStyle = colorWithAlpha(
      palette.colors[Math.abs(contour.color ?? contour.depth ?? 0) % palette.colors.length] ?? palette.ink,
      0.96,
    );
    drawing.fill();
    drawing.strokeStyle = colorWithAlpha(palette.ink, 0.92);
    drawing.lineWidth = 1.2;
    drawing.stroke();
  }
  drawing.restore();
}

function drawBackground() {
  const palette = currentPalette();
  drawing.fillStyle = palette.background;
  drawing.fillRect(0, 0, canvasWidth, canvasHeight);
  drawing.strokeStyle = colorWithAlpha(palette.ink, 0.025);
  drawing.lineWidth = 1;
  const spacing = 34;
  drawing.beginPath();
  for (let x = -canvasHeight; x < canvasWidth + canvasHeight; x += spacing) {
    drawing.moveTo(x, 0);
    drawing.lineTo(x - canvasHeight * 0.26, canvasHeight);
  }
  drawing.stroke();
}

function render() {
  if (!drawing) return;
  resizeCanvas();
  if (geometryDirty || !geometry) rebuildGeometry();
  drawBackground();
  const preset = currentPreset();
  if (preset.model === "hyperbolic") drawHyperbolic();
  else if (preset.model === "similarity") drawSimilarity();
  else drawEuclidean();
  drawContourPlayheads();
  const selected = contourField?.contours.find(({ id }) => id === selectedContourId) ?? null;
  const position = selected && selected.perimeter > 0
    ? contourPointAtDistance(selected, playbackDistance)
    : null;
  setText(
    "stageReadout",
    `${playbackLabel().toUpperCase()} · ${state.playing && position ? `EDGE ${position.edgeIndex + 1}/${selected.edges.length}` : "READY"} · ${activeContours.length} PLAYHEAD${activeContours.length === 1 ? "" : "S"} · ${tileCount} ${preset.model === "hyperbolic" ? "POLYGONS" : "TILES"}`,
  );
  canvas.setAttribute(
    "aria-label",
    `${preset.label}, a ${preset.symmetry} geometry study. ${activeContours.length} actual shape outline playhead${activeContours.length === 1 ? " is" : "s are"} selected in ${playbackLabel()} mode. View zoom ${Math.round(state.zoom * 100)} percent. Audio ${state.audioOn ? "on" : "off"}.`,
  );
  renderDirty = false;
}

function updateStudy() {
  const preset = currentPreset();
  setText("studySummary", `after ${preset.referenceWork} · ${preset.referenceYear}`);
  setText("presetDescription", preset.description);
  setText("surfaceReadout", preset.surface);
  setText("symmetryReadout", preset.symmetry);
  setText("generatorReadout", preset.generators.join(" · "));
  setText("orbitReadout", preset.orbit);
  setText("stageCaption", `${preset.label} · ${preset.symmetry}`);
  setText("stageSurface", preset.surface.toUpperCase());
  setText("stageSymmetry", preset.symmetry.toUpperCase());
  const reference = $("referenceLink");
  if (reference) {
    reference.href = preset.referenceUrl;
    reference.textContent = `${preset.referenceWork} · ${preset.referenceYear}`;
  }
  setText("soundSummary", `position · angle · color · border · ${compact(state.baseFrequency, 1)} Hz`);
}

function updateSummaries() {
  const preset = currentPreset();
  setText(
    "playbackSummary",
    `${state.playing ? "playing" : "ready"} · ${activeContours.length || 1} actual outline${activeContours.length === 1 ? "" : "s"}`,
  );
  if (preset.model === "hyperbolic") {
    setText("patternSummary", `${hyperbolicLayerCount()} reflection layers · ${Math.round((0.34 + state.density * 0.18) * 200)}% disk span`);
  } else if (preset.model === "similarity") {
    setText("patternSummary", `${similarityLevelCount()} levels · exact similarity`);
  } else {
    setText("patternSummary", `${state.density < 0.34 ? "open" : state.density > 0.7 ? "dense" : "medium"} · ${state.deformation < 0.25 ? "geometric" : "organic"}`);
  }
  setText("appearanceSummary", `${currentPalette().label.toLowerCase()} · ${state.showOutlines ? "outlines" : "seamless"}`);
  setText("soundSummary", `position · angle · color · border · ${compact(state.baseFrequency, 1)} Hz`);
  $("playButton")?.setAttribute("aria-pressed", String(state.playing));
  $("playButton")?.setAttribute(
    "aria-label",
    `${state.playing ? "Pause" : "Play"} ${playbackLabel().toLowerCase()} outline playback`,
  );
  if ($("neighborReach")) $("neighborReach").disabled = state.playbackMode !== "neighbors";
}

function updateOutputs() {
  const preset = currentPreset();
  setText("travelSpeedOut", `${compact(state.travelSpeed, 2)} units/sec`);
  setText("neighborReachOut", `${state.neighborReach} hop${state.neighborReach === 1 ? "" : "s"}`);
  setText("playheadSizeOut", percentage(state.playheadSize));
  setText(
    "densityOut",
    preset.model === "hyperbolic"
      ? `${hyperbolicLayerCount()} layers · ${Math.round((0.34 + state.density * 0.18) * 200)}% span`
      : preset.model === "similarity"
        ? `${similarityLevelCount()} levels`
        : percentage(state.density),
  );
  setText("deformationOut", preset.model === "euclidean" ? percentage(state.deformation) : "locked");
  setText("rotationOut", `${Math.round(state.rotation)}°`);
  setText("detailOut", percentage(state.detail));
  setText("contrastOut", percentage(state.contrast));
  setText("levelOut", percentage(state.level));
  setText("baseFrequencyOut", `${compact(state.baseFrequency, 1)} Hz`);
  setText("toneOut", percentage(state.tone));
  setText("pitchSpanOut", `${Math.round(state.pitchSpan)} semitones`);
  setText("timbreMotionOut", percentage(state.timbreMotion));
  setText("stereoWidthOut", percentage(state.stereoWidth));
  setText("orientationDepthOut", percentage(state.orientationDepth));
  setText("colorAspectDepthOut", percentage(state.colorAspectDepth));
  setText("positionDepthOut", percentage(state.positionDepth));
  setText("edgeArticulationOut", percentage(state.edgeArticulation));
  updateSummaries();
}

function announce(message) {
  setText("liveStatus", message);
}

function configurePatternControls() {
  const preset = currentPreset();
  const deformation = $("deformation");
  const deformationLabel = deformation?.closest?.("label");
  const deformationNote = $("deformationNote");
  const locked = preset.model !== "euclidean";
  if (deformation) deformation.disabled = locked;
  deformationLabel?.classList.toggle("is-model-locked", locked);
  if (deformationNote) {
    deformationNote.textContent = locked
      ? `Locked to preserve the exact ${preset.model === "hyperbolic" ? "Poincaré geodesics" : "similarity partition"}.`
      : "Curves the shared edges of Euclidean plane divisions.";
  }
}

function synchronizeControls() {
  $("preset").value = state.presetId;
  $("palette").value = state.paletteId;
  for (const id of [
    "density", "deformation", "rotation", "detail", "contrast", "travelSpeed",
    "neighborReach", "playheadSize", "level", "baseFrequency", "tone", "pitchSpan",
    "timbreMotion", "stereoWidth", "orientationDepth", "colorAspectDepth",
    "positionDepth", "edgeArticulation",
  ]) {
    if ($(id)) $(id).value = String(state[id]);
  }
  $("showGeometry").checked = state.showGeometry;
  $("showOutlines").checked = state.showOutlines;
  document.querySelectorAll("#playbackChoice button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.playback === state.playbackMode));
  });
  configurePatternControls();
  updateOutputs();
}

function applyPreset(id, shouldAnnounce = true) {
  const preset = escherTessellationPreset(id);
  state.presetId = preset.id;
  state.paletteId = preset.palette;
  state.panX = 0;
  state.panY = 0;
  state.zoom = 1;
  state.rotation = 0;
  selectedContourId = null;
  playbackDistance = 0;
  activeContourEvent = null;
  state.playing = false;
  geometryDirty = true;
  renderDirty = true;
  synchronizeControls();
  updateStudy();
  audio.setPlaying(false, 0);
  audio.setPosition?.(0);
  if (shouldAnnounce) announce(`${preset.label}. ${preset.symmetry}. Structural study after ${preset.referenceWork}.`);
}

async function setAudio(enabled) {
  if (state.audioStarting || enabled === state.audioOn) return;
  state.audioStarting = true;
  $("audioButton")?.setAttribute("aria-busy", "true");
  try {
    if (enabled) {
      await audio.enable(performanceConfig());
      state.audioOn = true;
      audio.setPosition?.(playbackDistance);
      audio.setPlaying(state.playing, playbackDistance);
      $("audioError").hidden = true;
    } else {
      state.audioOn = false;
      await audio.disable();
    }
  } catch (error) {
    state.audioOn = false;
    const audioError = $("audioError");
    if (audioError) {
      audioError.hidden = false;
      audioError.textContent = error?.message ?? "Audio could not be started.";
    }
  } finally {
    state.audioStarting = false;
    $("audioButton")?.removeAttribute("aria-busy");
    $("audioButton")?.setAttribute("aria-pressed", String(state.audioOn));
    setText("audioState", state.audioOn ? "on" : "off");
    renderDirty = true;
  }
}

function bindRange(id, options = {}) {
  const element = $(id);
  if (!element) return;
  element.addEventListener("input", () => {
    state[id] = Number(element.value);
    if (options.geometry) geometryDirty = true;
    if (options.selection) refreshActiveContours({ resetDistance: true });
    if (options.audio) audio.configure(performanceConfig());
    renderDirty = true;
    updateOutputs();
  });
}

bindRange("travelSpeed", { audio: true });
bindRange("neighborReach", { selection: true });
bindRange("playheadSize");
bindRange("density", { geometry: true });
bindRange("deformation", { geometry: true });
bindRange("rotation", { audio: true });
bindRange("detail");
bindRange("contrast", { audio: true });
bindRange("level", { audio: true });
bindRange("baseFrequency", { audio: true });
bindRange("tone", { audio: true });
bindRange("pitchSpan", { audio: true });
bindRange("timbreMotion", { audio: true });
bindRange("stereoWidth", { audio: true });
bindRange("orientationDepth", { audio: true });
bindRange("colorAspectDepth", { audio: true });
bindRange("positionDepth", { audio: true });
bindRange("edgeArticulation", { audio: true });

document.querySelectorAll("#playbackChoice button").forEach((button) => {
  button.addEventListener("click", () => {
    state.playbackMode = button.dataset.playback;
    refreshActiveContours({ resetDistance: true });
    synchronizeControls();
    renderDirty = true;
    announce(`${playbackLabel()} selected. Playheads remain on actual shape outlines.`);
  });
});

$("preset")?.addEventListener("change", () => applyPreset($("preset").value));
$("palette")?.addEventListener("change", () => {
  state.paletteId = $("palette").value;
  renderDirty = true;
  updateSummaries();
});
$("showGeometry")?.addEventListener("change", () => {
  state.showGeometry = $("showGeometry").checked;
  renderDirty = true;
  announce(`Geometry scaffold ${state.showGeometry ? "shown" : "hidden"}.`);
});
$("showOutlines")?.addEventListener("change", () => {
  state.showOutlines = $("showOutlines").checked;
  renderDirty = true;
  updateSummaries();
});
$("playButton")?.addEventListener("click", () => {
  state.playing = !state.playing;
  audio.setPlaying(state.playing, playbackDistance);
  renderDirty = true;
  updateSummaries();
  announce(`${playbackLabel()} outline playback ${state.playing ? "playing" : "paused"}.`);
});
$("audioButton")?.addEventListener("click", () => setAudio(!state.audioOn));

function resetView() {
  state.panX = 0;
  state.panY = 0;
  state.zoom = 1;
  renderDirty = true;
  announce("View reset to center at 100 percent zoom.");
}

function zoomAt(factor, anchorX = canvasWidth / 2, anchorY = canvasHeight / 2) {
  const previous = state.zoom;
  const next = clamp(previous * factor, 0.62, 2.4);
  if (Math.abs(next - previous) < 1e-8) return;
  const relativeX = anchorX - canvasWidth / 2 - state.panX;
  const relativeY = anchorY - canvasHeight / 2 - state.panY;
  const ratio = next / previous;
  state.zoom = next;
  state.panX -= relativeX * (ratio - 1);
  state.panY -= relativeY * (ratio - 1);
  renderDirty = true;
}

function resetAll() {
  const audioOn = state.audioOn;
  Object.assign(state, DEFAULT_STATE, { audioOn, audioStarting: false });
  contourField = null;
  activeContours = [];
  selectedContourId = null;
  playbackDistance = 0;
  activeContourEvent = null;
  geometryDirty = true;
  renderDirty = true;
  synchronizeControls();
  updateStudy();
  audio.setPlaying(false, 0);
  audio.setPosition?.(0);
  announce("Escher reset to Counterform current.");
}

$("resetButton")?.addEventListener("click", resetAll);

$("zoomOutButton")?.addEventListener("click", () => {
  zoomAt(1 / 1.2);
  announce(`View zoom ${Math.round(state.zoom * 100)} percent.`);
});
$("zoomInButton")?.addEventListener("click", () => {
  zoomAt(1.2);
  announce(`View zoom ${Math.round(state.zoom * 100)} percent.`);
});
$("resetViewButton")?.addEventListener("click", resetView);

function beginPinch() {
  const active = [...pointers.values()].slice(0, 2);
  if (active.length < 2) {
    pinch = null;
    return;
  }
  const rectangle = canvas.getBoundingClientRect();
  const midpoint = {
    x: (active[0].x + active[1].x) / 2 - rectangle.left,
    y: (active[0].y + active[1].y) / 2 - rectangle.top,
  };
  pinch = {
    distance: Math.max(1, Math.hypot(active[1].x - active[0].x, active[1].y - active[0].y)),
    midpoint,
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    relativeX: midpoint.x - canvasWidth / 2 - state.panX,
    relativeY: midpoint.y - canvasHeight / 2 - state.panY,
  };
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
}

function nearestContourAtScreen(point) {
  const containing = contourScreenCache
    .filter(({ points }) => pointInsidePolygon(point, points))
    .sort((first, second) => first.area - second.area);
  if (containing[0]) return containing[0].contour;
  let nearest = null;
  for (const candidate of contourScreenCache) {
    for (let index = 0; index < candidate.points.length; index += 1) {
      const distance = pointSegmentDistance(
        point,
        candidate.points[index],
        candidate.points[(index + 1) % candidate.points.length],
      );
      if (distance <= 14 && (!nearest || distance < nearest.distance)) {
        nearest = { contour: candidate.contour, distance };
      }
    }
  }
  return nearest?.contour ?? null;
}

function selectContour(contour, { announceSelection = true } = {}) {
  if (!contour) return false;
  selectedContourId = contour.id;
  refreshActiveContours({ resetDistance: true });
  renderDirty = true;
  updateSummaries();
  if (announceSelection) {
    const edgeCount = contour.edges?.length ?? contour.points?.length ?? 0;
    announce(`Selected actual shape outline ${contour.sourceId ?? contour.id}, with ${edgeCount} border${edgeCount === 1 ? "" : "s"}.`);
  }
  return true;
}

function moveContourSelection(horizontal, vertical) {
  if (!contourField?.contours?.length) return;
  const current = contourField.contours.find(({ id }) => id === selectedContourId)
    ?? activeContours[0]
    ?? contourField.contours[0];
  const adjacentIds = new Set(current.adjacentIds ?? []);
  let candidates = contourField.contours.filter(({ id }) => adjacentIds.has(id));
  if (!candidates.length) candidates = contourField.contours.filter(({ id }) => id !== current.id);
  const origin = current.center ?? averagePoint(current.points);
  const directional = candidates.map((contour) => {
    const center = contour.center ?? averagePoint(contour.points);
    const dx = center.x - origin.x;
    const dy = center.y - origin.y;
    const distance = Math.max(1e-9, Math.hypot(dx, dy));
    return { contour, score: (dx * horizontal + dy * vertical) / distance, distance };
  }).filter(({ score }) => score > 0.08)
    .sort((first, second) => second.score - first.score || first.distance - second.distance);
  selectContour((directional[0] ?? candidates.map((contour) => ({ contour }))[0])?.contour);
}

canvas?.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  canvas.focus?.({ preventScroll: true });
  pointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
  canvas.setPointerCapture?.(event.pointerId);
  if (pointers.size === 1) {
    gestureHadPinch = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
    pinch = null;
  } else {
    gestureHadPinch = true;
    drag = null;
    beginPinch();
  }
  stageWrap?.classList.add("is-panning");
});

canvas?.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
  if (pointers.size >= 2 && pinch) {
    event.preventDefault();
    const active = [...pointers.values()].slice(0, 2);
    const rectangle = canvas.getBoundingClientRect();
    const midpoint = {
      x: (active[0].x + active[1].x) / 2 - rectangle.left,
      y: (active[0].y + active[1].y) / 2 - rectangle.top,
    };
    const distance = Math.max(1, Math.hypot(active[1].x - active[0].x, active[1].y - active[0].y));
    const next = clamp(pinch.zoom * distance / pinch.distance, 0.62, 2.4);
    const ratio = next / pinch.zoom;
    state.zoom = next;
    state.panX = pinch.panX + (midpoint.x - pinch.midpoint.x) - pinch.relativeX * (ratio - 1);
    state.panY = pinch.panY + (midpoint.y - pinch.midpoint.y) - pinch.relativeY * (ratio - 1);
    renderDirty = true;
    return;
  }
  if (!drag || event.pointerId !== drag.id) return;
  state.panX = drag.panX + event.clientX - drag.x;
  state.panY = drag.panY + event.clientY - drag.y;
  renderDirty = true;
});

function endPointer(event) {
  if (!pointers.has(event.pointerId)) return;
  const completedDrag = drag?.id === event.pointerId ? drag : null;
  const wasPinching = gestureHadPinch || Boolean(pinch);
  const wasTap = !wasPinching && completedDrag
    && Math.hypot(event.clientX - completedDrag.x, event.clientY - completedDrag.y) < 8;
  if (wasTap) {
    state.panX = completedDrag.panX;
    state.panY = completedDrag.panY;
  }
  pointers.delete(event.pointerId);
  canvas?.releasePointerCapture?.(event.pointerId);
  pinch = null;
  if (pointers.size === 1) {
    const remaining = [...pointers.values()][0];
    drag = { id: remaining.id, x: remaining.x, y: remaining.y, panX: state.panX, panY: state.panY };
  } else {
    drag = null;
  }
  if (pointers.size === 0) {
    stageWrap?.classList.remove("is-panning");
    if (wasTap) {
      const rectangle = canvas.getBoundingClientRect();
      selectContour(nearestContourAtScreen({
        x: event.clientX - rectangle.left,
        y: event.clientY - rectangle.top,
      }));
    }
    gestureHadPinch = false;
  }
  if (wasPinching) announce(`View zoom ${Math.round(state.zoom * 100)} percent.`);
}

canvas?.addEventListener("pointerup", endPointer);
canvas?.addEventListener("pointercancel", endPointer);
canvas?.addEventListener("lostpointercapture", endPointer);
canvas?.addEventListener("dblclick", resetView);
canvas?.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rectangle = canvas.getBoundingClientRect();
  zoomAt(
    Math.exp(-event.deltaY * 0.0012),
    event.clientX - rectangle.left,
    event.clientY - rectangle.top,
  );
}, { passive: false });

globalThis.addEventListener("keydown", (event) => {
  if (event.code === "Escape") {
    const wasOn = state.audioOn;
    if (wasOn) setAudio(false);
    announce(wasOn ? "Switching audio off." : "Audio is already off.");
    return;
  }
  const tagName = event.target?.tagName;
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tagName)) return;
  if (event.target !== canvas) return;
  if (event.code === "Space" || event.code === "Enter") {
    event.preventDefault();
    state.playing = !state.playing;
    audio.setPlaying(state.playing, playbackDistance);
    renderDirty = true;
    updateSummaries();
    announce(`${playbackLabel()} outline playback ${state.playing ? "playing" : "paused"}.`);
  } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)) {
    event.preventDefault();
    moveContourSelection(
      event.code === "ArrowLeft" ? -1 : event.code === "ArrowRight" ? 1 : 0,
      event.code === "ArrowUp" ? -1 : event.code === "ArrowDown" ? 1 : 0,
    );
  } else if (event.key?.toLowerCase() === "g") {
    state.showGeometry = !state.showGeometry;
    $("showGeometry").checked = state.showGeometry;
    renderDirty = true;
    announce(`Geometry scaffold ${state.showGeometry ? "shown" : "hidden"}.`);
  } else if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomAt(1.2);
    announce(`View zoom ${Math.round(state.zoom * 100)} percent.`);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomAt(1 / 1.2);
    announce(`View zoom ${Math.round(state.zoom * 100)} percent.`);
  } else if (event.code === "Home") {
    event.preventDefault();
    resetView();
  }
});

function animate(time) {
  const delta = lastFrameTime ? Math.max(0, (time - lastFrameTime) / 1000) : 0;
  lastFrameTime = time;
  if (state.playing && state.travelSpeed > 0) {
    playbackDistance += delta * state.travelSpeed;
    renderDirty = true;
  }
  if (renderDirty) render();
  animationFrame = globalThis.requestAnimationFrame(animate);
}

if (typeof ResizeObserver === "function" && canvas) {
  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    renderDirty = true;
  });
  resizeObserver.observe(canvas);
} else {
  globalThis.addEventListener("resize", () => {
    resizeCanvas();
    renderDirty = true;
  });
}

globalThis.addEventListener("pagehide", () => {
  globalThis.cancelAnimationFrame(animationFrame);
  audio.dispose();
});

synchronizeControls();
updateStudy();
resizeCanvas();
render();
animationFrame = globalThis.requestAnimationFrame(animate);

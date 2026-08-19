import {
  HYPER_RUBIX_AXES,
  HYPER_RUBIX_BOUNDARY_CELLS,
  HYPER_RUBIX_CELL_ORDER,
  HYPER_RUBIX_COLORS,
  HYPER_RUBIX_PLANE_DRUMS,
  HYPER_RUBIX_SEQUENCE_LENGTH,
  HYPER_RUBIX_SEQUENCE_PATTERNS,
  HYPER_RUBIX_STICKER_COUNT,
  buildHyperRubixTesseractWireframe,
  createHyperRubixScramble,
  createHyperRubixSequence,
  createSeededHyperRubixRandom,
  createSolvedHyperRubix,
  hyperRubixBoundaryCell,
  hyperRubixCellForNormal,
  hyperRubixDisorder,
  hyperRubixMoveAffectsSticker,
  hyperRubixSequenceIndex,
  hyperRubixStepDurationSeconds,
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

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const TAU = Math.PI * 2;
const MOVE_DURATION = 430;
const SCRAMBLE_DURATION = 135;
const UNWIND_DURATION = 180;
const PROJECTION_DEPTH_MIN = 3.4;
const LOOKAHEAD_MS = 110;
const SCHEDULER_INTERVAL_MS = 24;
const AXIS_COLORS = Object.freeze({
  x: "#ff6b72",
  y: "#f7cf5b",
  z: "#65e58a",
  w: "#c9a5ff",
});
const DEFAULTS = Object.freeze({
  selectedCell: "w+",
  selectedPlane: "xy",
  dragMode: "orbit",
  autoRotate: true,
  tempo: 112,
  swing: 0.08,
  subdivisionsPerBeat: 2,
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
  cameraPitch: -17,
  cameraYaw: 28,
  cameraRoll: -2,
  rotation: Object.freeze({ xy: 7, xz: -4, xw: 24, yz: -6, yw: -18, zw: 12 }),
});
const VOICE_LABELS = Object.freeze({
  pulse: "Hyper kit",
  glass: "Prismatic kit",
  dust: "Bit kit",
});
const RATE_LABELS = Object.freeze({ 1: "1/4", 2: "1/8", 4: "1/16" });
const PLAYBACK_LABELS = Object.freeze({
  forward: "Forward",
  reverse: "Reverse",
  pendulum: "Pendulum",
  random: "Random",
});

const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
const wireframe = buildHyperRubixTesseractWireframe(1.32);
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

const state = {
  puzzle: createSolvedHyperRubix(),
  selectedCell: DEFAULTS.selectedCell,
  selectedPlane: DEFAULTS.selectedPlane,
  dragMode: DEFAULTS.dragMode,
  autoRotate: reduceMotion ? false : DEFAULTS.autoRotate,
  playing: false,
  tempo: DEFAULTS.tempo,
  swing: DEFAULTS.swing,
  subdivisionsPerBeat: DEFAULTS.subdivisionsPerBeat,
  patternId: DEFAULTS.patternId,
  playbackMode: DEFAULTS.playbackMode,
  twistDensity: DEFAULTS.twistDensity,
  currentStep: 0,
  rotationSpeed: DEFAULTS.rotationSpeed,
  projectionDepth: DEFAULTS.projectionDepth,
  cellSeparation: DEFAULTS.cellSeparation,
  stickerScale: DEFAULTS.stickerScale,
  output: DEFAULTS.output,
  voice: DEFAULTS.voice,
  tone: DEFAULTS.tone,
  decay: DEFAULTS.decay,
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
let transportPosition = 0;
let nextStepAtMs = 0;
let schedulerTimer = null;
let visualTimers = new Set();

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
  const center = add4(sticker.position, sticker.normal, state.cellSeparation);
  const tangent = cell.tangentAxes.map(axisUnit);
  const halfExtent = 0.29 * state.stickerScale;
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

function drawSticker(item) {
  const color = HYPER_RUBIX_COLORS[item.sticker.color];
  const selected = item.selected;
  const depthLight = clamp(
    0.07 + item.center.factor3 * 0.08 + item.center.factor4 * 0.055,
    0.12,
    0.29,
  );
  const alpha = clamp(depthLight + (selected ? 0.5 : 0) + (item.affected ? 0.22 : 0), 0.12, 0.9);

  context.save();
  if (item.affected) {
    context.shadowColor = rgba(color, 0.85);
    context.shadowBlur = 15;
  } else if (selected) {
    context.shadowColor = rgba(color, 0.46);
    context.shadowBlur = 6;
  }
  pathPolygon(item.hull);
  context.fillStyle = rgba(color, alpha * 0.82);
  context.fill();
  context.strokeStyle = rgba(color, selected ? 0.92 : 0.48);
  context.lineWidth = item.affected ? 1.4 : selected ? 0.9 : 0.55;
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
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  drawBackground(time);
  drawWireframe();
  drawTurnArc(time);

  renderedStickers = state.puzzle.stickers
    .map(stickerGeometry)
    .filter(Boolean)
    .sort((first, second) => first.depth - second.depth);
  for (const item of renderedStickers) drawSticker(item);
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

class HyperRubixAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
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
    }
    if (this.context.state === "suspended") {
      unlockAudioContext(this.context);
      await this.context.resume();
    }
    this.setLevel(state.output, true);
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
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.012);
  }

  async suspend() {
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
      this.master?.disconnect();
      this.compressor?.disconnect();
    } catch {
      // The browser may already have torn the graph down during navigation.
    }
    this.context = null;
    this.master = null;
    this.compressor = null;
    this.noiseBuffer = null;
    if (audioContext?.state !== "closed") await audioContext.close();
  }

  outputNode(pan) {
    if (typeof this.context.createStereoPanner !== "function") {
      return { node: this.master, release() {} };
    }
    const panner = this.context.createStereoPanner();
    panner.pan.value = clamp(pan, -0.8, 0.8);
    panner.connect(this.master);
    return {
      node: panner,
      release() {
        try { panner.disconnect(); } catch { /* Audio graph teardown is best-effort. */ }
      },
    };
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
    source.connect(filter).connect(gain).connect(output);
    source.addEventListener("ended", () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      cleanup?.();
    }, { once: true });
    source.start(when);
    source.stop(end + 0.02);
    return end;
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
}

const audio = new HyperRubixAudio();

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

function paintTransport() {
  const rate = RATE_LABELS[state.subdivisionsPerBeat] ?? "1/8";
  const mode = PLAYBACK_LABELS[state.playbackMode] ?? "Forward";
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playLabel").textContent = state.playing ? "Pause auto-twists" : "Play auto-twists";
  $("playState").textContent = state.playing
    ? `${rate} · ${mode.toLowerCase()}`
    : `${HYPER_RUBIX_SEQUENCE_LENGTH}-step twist tape`;
  $("clockSummary").textContent = `${Math.round(state.tempo)} BPM · ${rate}`;
  $("sequencePattern").value = state.patternId;
  $("playbackMode").value = state.playbackMode;
  $("twistRate").value = String(state.subdivisionsPerBeat);
  $("reseedPattern").disabled = state.patternId !== "random-walk";
}

function clearVisualTimers() {
  for (const timer of visualTimers) clearTimeout(timer);
  visualTimers = new Set();
}

function clearScheduler() {
  if (schedulerTimer !== null) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  clearVisualTimers();
}

function transportAnimationDuration(stepDurationMs) {
  return reduceMotion ? 1 : clamp(stepDurationMs * 0.72, 36, 360);
}

function launchSequenceStep(step, stepIndex, animationDuration) {
  if (!state.playing) return;
  updateSequencePlayhead(stepIndex);
  if (!step?.active || !step.move) return;
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

function scheduleVisualSequenceStep(step, stepIndex, targetTimeMs, animationDuration) {
  const delay = Math.max(0, targetTimeMs - performance.now());
  const timer = setTimeout(() => {
    visualTimers.delete(timer);
    launchSequenceStep(step, stepIndex, animationDuration);
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
    const stepIndex = hyperRubixSequenceIndex(
      state.playbackMode,
      position,
      HYPER_RUBIX_SEQUENCE_LENGTH,
      Math.random,
    );
    const step = sequence[stepIndex];
    const stepDurationMs = hyperRubixStepDurationSeconds(
      state.tempo,
      state.subdivisionsPerBeat,
      state.swing,
      position,
    ) * 1_000;
    if (step?.active && step.move && state.audio && audio.context) {
      const scheduledWhen = audio.context.currentTime
        + Math.max(0, nextStepAtMs - nowMs) / 1_000;
      audio.strike(step.move, scheduledWhen, step.accent ? 1.16 : 0.78);
    }
    scheduleVisualSequenceStep(
      step,
      stepIndex,
      nextStepAtMs,
      transportAnimationDuration(stepDurationMs),
    );
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
  if (state.playing) schedulerTick();
  if (announceRestart) announce("Auto-twist loop restarted at step one.");
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
    announce(`${sequencePatternLabel()} auto-twists playing at ${Math.round(state.tempo)} BPM.`);
  }
}

function stopTransport({ announceStop = false } = {}) {
  if (!state.playing && schedulerTimer === null) return;
  state.playing = false;
  clearScheduler();
  moveQueue = moveQueue.filter((item) => item.source !== "transport");
  paintTransport();
  updateStatus();
  if (announceStop) announce("Auto-twist sequencer paused.");
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
    ? `STEP ${String(state.currentStep + 1).padStart(2, "0")}/${HYPER_RUBIX_SEQUENCE_LENGTH} · ${Math.round(state.tempo)} BPM`
    : `${HYPER_RUBIX_STICKER_COUNT} HYPER-STICKERS`;
  $("stageReadout").textContent = `${condition} · ${clockLabel} · ${state.selectedCell.toUpperCase()} / ${state.selectedPlane.toUpperCase()} · ${audioLabel}`;
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
  if (item.soundAtStart !== false) audio.strike(item.move);
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
  if (state.playing) stopTransport();
  enqueueMove({
    cell: state.selectedCell,
    plane: state.selectedPlane,
    quarterTurns,
  });
}

$("turnCounterclockwise").addEventListener("click", () => turnSelected(-1));
$("turnClockwise").addEventListener("click", () => turnSelected(1));

$("scramblePuzzle").addEventListener("click", () => {
  if (state.playing) stopTransport();
  const moves = createHyperRubixScramble(12);
  scrambleGeneration += 1;
  moves.forEach((move, index) => enqueueMove(move, {
    duration: SCRAMBLE_DURATION,
    announce: index === moves.length - 1,
  }));
  announce(`Scramble ${scrambleGeneration}: twelve four-dimensional quarter turns queued.`);
});

function undoLastMove() {
  if (state.playing) stopTransport();
  if (activeMove || moveQueue.length || !history.length) return;
  const move = invertHyperRubixMove(history.at(-1));
  enqueueMove(move, { historyAction: "pop" });
}

$("undoMove").addEventListener("click", undoLastMove);

$("unwindPuzzle").addEventListener("click", () => {
  if (state.playing) stopTransport();
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
    paintMotionToggle();
  }
  if (pointerDrag.mode === "fold") {
    state.rotation.yw = normalizeDegrees(pointerDrag.rotationYW + deltaX / Math.max(1, bounds.width) * 280);
    state.rotation.xw = normalizeDegrees(pointerDrag.rotationXW - deltaY / Math.max(1, bounds.height) * 280);
  } else {
    state.cameraYaw = normalizeDegrees(pointerDrag.cameraYaw + deltaX / Math.max(1, bounds.width) * 250);
    state.cameraPitch = clamp(pointerDrag.cameraPitch - deltaY / Math.max(1, bounds.height) * 180, -82, 82);
  }
  updateProjectionReadout();
  scheduleFrame();
  event.preventDefault();
});

function finishPointer(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const click = !pointerDrag.moved;
  const bounds = canvas.getBoundingClientRect();
  const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  pointerDrag = null;
  canvas.classList.remove("is-dragging");
  if (click && !activeMove) {
    const hit = [...renderedStickers].reverse().find((item) => pointInsidePolygon(point, item.hull));
    if (hit?.currentCell) {
      selectCell(hit.currentCell.id);
      announce(`${hit.currentCell.id.toUpperCase()} boundary cell selected from its ${hit.sticker.color} hyper-sticker.`);
    }
  }
  scheduleFrame();
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("lostpointercapture", (event) => {
  if (pointerDrag?.pointerId === event.pointerId) {
    pointerDrag = null;
    canvas.classList.remove("is-dragging");
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
    if (event.shiftKey || state.dragMode === "fold") {
      if (event.key === "ArrowLeft") state.rotation.yw -= amount;
      if (event.key === "ArrowRight") state.rotation.yw += amount;
      if (event.key === "ArrowUp") state.rotation.xw += amount;
      if (event.key === "ArrowDown") state.rotation.xw -= amount;
    } else {
      if (event.key === "ArrowLeft") state.cameraYaw -= amount;
      if (event.key === "ArrowRight") state.cameraYaw += amount;
      if (event.key === "ArrowUp") state.cameraPitch = clamp(state.cameraPitch + amount, -82, 82);
      if (event.key === "ArrowDown") state.cameraPitch = clamp(state.cameraPitch - amount, -82, 82);
    }
    state.autoRotate = false;
    paintMotionToggle();
    updateProjectionReadout();
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

$("restartLoop").addEventListener("click", () => {
  if (state.playing) restartTransportClock({ announceRestart: true });
  else {
    transportPosition = 0;
    updateSequencePlayhead(hyperRubixSequenceIndex(
      state.playbackMode,
      0,
      HYPER_RUBIX_SEQUENCE_LENGTH,
      sequenceRandomSource(),
    ));
    announce("Auto-twist playhead returned to step one.");
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
  else updateSequencePlayhead(hyperRubixSequenceIndex(
    state.playbackMode,
    0,
    HYPER_RUBIX_SEQUENCE_LENGTH,
    sequenceRandomSource(),
  ));
  announce(`${PLAYBACK_LABELS[state.playbackMode]} playback selected.`);
});

$("twistRate").addEventListener("change", (event) => {
  const rate = Number(event.currentTarget.value);
  state.subdivisionsPerBeat = Object.hasOwn(RATE_LABELS, rate)
    ? rate
    : DEFAULTS.subdivisionsPerBeat;
  paintTransport();
  if (state.playing) restartTransportClock();
  announce(`${RATE_LABELS[state.subdivisionsPerBeat]} twist rate selected.`);
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
    state[key] = Number(input.value);
    update();
    afterChange?.();
    scheduleFrame();
  });
  update();
}

bindRange("output", "output", (value) => `${Math.round(value * 100)}%`, () => {
  if (state.audio) audio.setLevel(state.output);
});
bindRange("tempo", "tempo", (value) => `${Math.round(value)} BPM`, paintTransport);
bindRange("swing", "swing", (value) => `${Math.round(value * 100)}%`);
bindRange("twistDensity", "twistDensity", (value) => `${Math.round(value * 100)}%`, () => {
  rebuildSequence({ resetPosition: false });
  if (state.playing) restartTransportClock();
});
bindRange("rotationSpeed", "rotationSpeed", (value) => `${value.toFixed(2)} rev/min`, () => {
  $("motionSummary").textContent = state.autoRotate ? `${state.rotationSpeed.toFixed(2)} rev/min` : "paused";
});
bindRange("projectionDepth", "projectionDepth", (value) => value.toFixed(1));
bindRange("cellSeparation", "cellSeparation", (value) => `${Math.round(value * 100)}%`);
bindRange("stickerScale", "stickerScale", (value) => `${Math.round(value * 100)}%`);
bindRange("tone", "tone", (value) => `${Math.round(value * 100)}%`);
bindRange("decay", "decay", (value) => `${value.toFixed(2)} s`);

function paintMotionToggle() {
  $("autoRotate").setAttribute("aria-pressed", String(state.autoRotate));
  $("autoRotateState").textContent = state.autoRotate ? "moving through XW + YW" : "projection held still";
  $("motionSummary").textContent = state.autoRotate ? `${state.rotationSpeed.toFixed(2)} rev/min` : "paused";
}

$("autoRotate").addEventListener("click", () => {
  state.autoRotate = !state.autoRotate;
  paintMotionToggle();
  scheduleFrame();
});

function resetView() {
  state.cameraPitch = DEFAULTS.cameraPitch;
  state.cameraYaw = DEFAULTS.cameraYaw;
  state.cameraRoll = DEFAULTS.cameraRoll;
  state.rotation = { ...DEFAULTS.rotation };
  updateProjectionReadout();
  scheduleFrame();
}

$("resetView").addEventListener("click", resetView);

$("randomView").addEventListener("click", () => {
  state.autoRotate = false;
  state.rotation.xw = Math.random() * 140 - 70;
  state.rotation.yw = Math.random() * 140 - 70;
  state.rotation.zw = Math.random() * 140 - 70;
  state.cameraYaw = Math.random() * 100 - 50;
  state.cameraPitch = Math.random() * 52 - 26;
  paintMotionToggle();
  updateProjectionReadout();
  announce("Jumped to a new four-dimensional projection.");
  scheduleFrame();
});

$("voice").addEventListener("change", (event) => {
  state.voice = event.currentTarget.value;
  $("soundSummary").textContent = VOICE_LABELS[state.voice] ?? "Turn voice";
});

$("audioButton").addEventListener("click", async () => {
  $("audioError").hidden = true;
  if (state.audio) {
    state.audio = false;
    audio.disable();
  } else {
    try {
      await audio.enable();
      state.audio = true;
    } catch (error) {
      $("audioError").textContent = error instanceof Error ? error.message : "Web Audio could not start.";
      $("audioError").hidden = false;
    }
  }
  $("audioButton").setAttribute("aria-pressed", String(state.audio));
  $("audioState").textContent = state.audio ? "on" : "off";
  updateStatus();
  announce(state.audio
    ? `${state.playing ? "Drum audio joined the running twist tape" : "Drum audio enabled"}.`
    : `Drum audio disabled${state.playing ? "; auto-twists continue silently" : ""}.`);
});

function resetAll() {
  stopTransport();
  moveQueue = [];
  activeMove = null;
  turnPulse = null;
  history = [];
  state.puzzle = createSolvedHyperRubix();
  state.selectedCell = DEFAULTS.selectedCell;
  state.selectedPlane = DEFAULTS.selectedPlane;
  state.dragMode = DEFAULTS.dragMode;
  state.autoRotate = reduceMotion ? false : DEFAULTS.autoRotate;
  state.tempo = DEFAULTS.tempo;
  state.swing = DEFAULTS.swing;
  state.subdivisionsPerBeat = DEFAULTS.subdivisionsPerBeat;
  state.patternId = DEFAULTS.patternId;
  state.playbackMode = DEFAULTS.playbackMode;
  state.twistDensity = DEFAULTS.twistDensity;
  state.currentStep = 0;
  sequenceGeneration = 0;
  $("sequencePattern").value = DEFAULTS.patternId;
  $("playbackMode").value = DEFAULTS.playbackMode;
  $("twistRate").value = String(DEFAULTS.subdivisionsPerBeat);
  for (const key of [
    "tempo", "swing", "twistDensity",
    "rotationSpeed", "projectionDepth", "cellSeparation", "stickerScale",
    "output", "tone", "decay",
  ]) {
    state[key] = DEFAULTS[key];
    $(key).value = String(DEFAULTS[key]);
    $(key).dispatchEvent(new Event("input"));
  }
  state.voice = DEFAULTS.voice;
  $("voice").value = DEFAULTS.voice;
  $("soundSummary").textContent = VOICE_LABELS[state.voice];
  rebuildSequence();
  resetView();
  setDragMode(DEFAULTS.dragMode);
  paintMotionToggle();
  updateSelectionUI();
  announce("Hyper Rubix puzzle, twist tape, and parameters reset.");
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
    const degrees = state.rotationSpeed * 6 * elapsed / 1_000;
    state.rotation.xw = normalizeDegrees(state.rotation.xw + degrees);
    state.rotation.yw = normalizeDegrees(state.rotation.yw + degrees * 0.67);
    state.rotation.zw = normalizeDegrees(state.rotation.zw - degrees * 0.31);
    updateProjectionReadout();
  }
  updateMoveAnimation(time);
  drawScene(time);
  if (state.autoRotate || activeMove || moveQueue.length || turnPulse) scheduleFrame();
}

document.addEventListener("visibilitychange", () => {
  previousFrameTime = performance.now();
  if (document.hidden) {
    clearScheduler();
    void audio.suspend().catch(() => {});
    return;
  }
  if (state.audio) void audio.resume().catch(() => {});
  if (state.playing) {
    nextStepAtMs = performance.now() + 55;
    schedulerTick();
  }
  scheduleFrame();
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    clearScheduler();
    void audio.suspend().catch(() => {});
    return;
  }
  stopTransport();
  state.audio = false;
  void audio.dispose().catch(() => {});
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  if (state.audio) void audio.resume().catch(() => {});
  if (state.playing && schedulerTimer === null) {
    nextStepAtMs = performance.now() + 55;
    schedulerTick();
  }
});

rebuildSequence();
setDragMode(state.dragMode);
paintMotionToggle();
updateSelectionUI();
updateProjectionReadout();
scheduleFrame();

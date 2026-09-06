import {
  VoicePool,
  normalizeVoiceGains,
  pitch01ToFrequency,
  synthParametersForMode,
} from "./src/audio.js";
import {
  planeBasis,
  planeNormal,
  projectPoint3,
  rotatePoint3,
} from "./src/solid.js";
import {
  buildSurfaceMesh,
  clamp,
  mapSliceComponents,
  trackSliceComponents,
  planeOffsetForMeshPhase,
  sliceSurface,
  surfacePoint,
  wrap01,
} from "./src/nonorientable-surface.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const KIND = document.body.dataset.surfaceKind === "klein" ? "klein" : "moebius";
const pool = new VoicePool(12, { continuousPeakCeiling: 0.72 });
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });

const PAGE = KIND === "klein" ? {
  label: "Klein bottle",
  shortLabel: "KLEIN",
  firstPreset: "bottle",
  colors: {
    low: [166, 255, 106],
    high: [185, 138, 255],
    plane: [114, 220, 255],
    slice: [255, 240, 123],
  },
  defaults: {
    position: 0.5,
    continuousPosition: 0.5,
    speed: 0.08,
    direction: 1,
    playing: false,
    planeYaw: 24,
    planePitch: -14,
    surfaceRadius: 1.5,
    surfaceWidth: 0.42,
    surfaceFold: 1,
    surfaceTwists: 1,
    rotationX: -18,
    rotationY: 34,
    rotationZ: 2,
    autoRotate: false,
    rotationSpeed: 0.03,
    soundMode: "fm",
    baseFrequency: 62,
    pitchRange: 3.1,
    timbre: 0.62,
    stereoWidth: 0.86,
    seamVoice: 0.58,
    level: 0.58,
  },
  presets: {
    bottle: {
      planeYaw: 24,
      planePitch: -14,
      surfaceRadius: 1.5,
      surfaceWidth: 0.42,
      surfaceFold: 1,
      speed: 0.08,
      soundMode: "fm",
      baseFrequency: 62,
      pitchRange: 3.1,
      timbre: 0.62,
      stereoWidth: 0.86,
      seamVoice: 0.58,
    },
    crossing: {
      planeYaw: 88,
      planePitch: 8,
      surfaceRadius: 1.32,
      surfaceWidth: 0.54,
      surfaceFold: 1.28,
      speed: 0.14,
      soundMode: "pm",
      baseFrequency: 84,
      pitchRange: 2.35,
      timbre: 0.82,
      stereoWidth: 1,
      seamVoice: 0.88,
    },
    deep: {
      planeYaw: -38,
      planePitch: 52,
      surfaceRadius: 1.82,
      surfaceWidth: 0.36,
      surfaceFold: 0.7,
      speed: 0.045,
      soundMode: "shepard",
      baseFrequency: 42,
      pitchRange: 4.1,
      timbre: 0.44,
      stereoWidth: 0.7,
      seamVoice: 0.72,
    },
  },
} : {
  label: "Möbius",
  shortLabel: "MÖBIUS",
  firstPreset: "ribbon",
  colors: {
    low: [99, 243, 208],
    high: [255, 112, 200],
    plane: [169, 200, 255],
    slice: [255, 241, 168],
  },
  defaults: {
    position: 0.5,
    continuousPosition: 0.5,
    speed: 0.1,
    direction: 1,
    playing: false,
    planeYaw: 38,
    planePitch: -18,
    surfaceRadius: 0.72,
    surfaceWidth: 0.38,
    surfaceFold: 1,
    surfaceTwists: 1,
    rotationX: -24,
    rotationY: 28,
    rotationZ: -6,
    autoRotate: false,
    rotationSpeed: 0.035,
    soundMode: "fm",
    baseFrequency: 72,
    pitchRange: 2.6,
    timbre: 0.58,
    stereoWidth: 0.82,
    seamVoice: 0.52,
    level: 0.58,
  },
  presets: {
    ribbon: {
      planeYaw: 38,
      planePitch: -18,
      surfaceRadius: 0.72,
      surfaceWidth: 0.38,
      surfaceFold: 1,
      surfaceTwists: 1,
      speed: 0.1,
      soundMode: "fm",
      baseFrequency: 72,
      pitchRange: 2.6,
      timbre: 0.58,
      stereoWidth: 0.82,
      seamVoice: 0.52,
    },
    edge: {
      planeYaw: 91,
      planePitch: 4,
      surfaceRadius: 0.78,
      surfaceWidth: 0.27,
      surfaceFold: 1.35,
      surfaceTwists: 1,
      speed: 0.18,
      soundMode: "sine",
      baseFrequency: 94,
      pitchRange: 3.45,
      timbre: 0.22,
      stereoWidth: 1,
      seamVoice: 0.8,
    },
    triple: {
      planeYaw: -31,
      planePitch: 48,
      surfaceRadius: 0.7,
      surfaceWidth: 0.34,
      surfaceFold: 0.84,
      surfaceTwists: 3,
      speed: 0.065,
      soundMode: "pm",
      baseFrequency: 48,
      pitchRange: 3.8,
      timbre: 0.86,
      stereoWidth: 0.74,
      seamVoice: 0.92,
    },
  },
};

const baseline = Object.freeze({ ...PAGE.defaults });
const state = {
  ...baseline,
  audio: false,
  presetId: PAGE.firstPreset,
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameTime = performance.now();
let lastAudioTime = null;
let meshCache = null;
let meshCacheKey = "";
let drag = null;
let rotationTarget = "playhead";
let manualSoundUntil = 0;
let tornDown = false;
let componentTracks = [];
let nextComponentId = 0;
let pageActive = true;
let audioRequestGeneration = 0;

function announce(message) {
  $("liveStatus").textContent = message;
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function normalizeDegrees(value) {
  return ((Number(value) + 180) % 360 + 360) % 360 - 180;
}

function rgba(color, alpha) {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function mixColor(first, second, amount) {
  const t = clamp(amount, 0, 1);
  return first.map((value, index) => Math.round(value + (second[index] - value) * t));
}

function scheduleFrame() {
  if (tornDown || !pageActive || scheduledFrame) return;
  scheduledFrame = requestAnimationFrame(frame);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(2_600_000 / (cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(stageWrap);
resizeCanvas();

function surfaceOptions() {
  return {
    radius: state.surfaceRadius,
    width: state.surfaceWidth,
    fold: state.surfaceFold,
    halfTwists: state.surfaceTwists,
  };
}

function currentMesh() {
  const key = [
    KIND,
    state.surfaceRadius,
    state.surfaceWidth,
    state.surfaceFold,
    state.surfaceTwists,
  ].join(":");
  if (key !== meshCacheKey) {
    meshCache = buildSurfaceMesh(KIND, surfaceOptions());
    meshCacheKey = key;
  }
  return meshCache;
}

function viewRotation() {
  return { x: state.rotationX, y: state.rotationY, z: state.rotationZ };
}

function viewPoint(point) {
  return rotatePoint3(point, viewRotation());
}

function projectionTransform() {
  const scale = Math.min(cssWidth, cssHeight) * 0.42;
  return {
    x: (value) => cssWidth * 0.5 + value * scale,
    y: (value) => cssHeight * 0.52 - value * scale,
  };
}

function projected(point, transform = projectionTransform()) {
  const view = viewPoint(point);
  const perspective = projectPoint3(view, 3.5);
  return {
    ...perspective,
    canvasX: transform.x(perspective.x),
    canvasY: transform.y(perspective.y),
  };
}

function planeCorners(normal, offset) {
  const { u, v } = planeBasis(normal);
  const center = {
    x: normal.x * offset,
    y: normal.y * offset,
    z: normal.z * offset,
  };
  const size = KIND === "klein" ? 1.08 : 1.17;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({
    x: center.x + (u.x * a + v.x * b) * size,
    y: center.y + (u.y * a + v.y * b) * size,
    z: center.z + (u.z * a + v.z * b) * size,
  }));
}

function drawPlane(normal, offset, transform) {
  const corners = planeCorners(normal, offset).map((point) => projected(point, transform));
  const selected = rotationTarget === "playhead";
  context.save();
  context.beginPath();
  corners.forEach((point, index) => {
    if (index) context.lineTo(point.canvasX, point.canvasY);
    else context.moveTo(point.canvasX, point.canvasY);
  });
  context.closePath();
  context.fillStyle = rgba(PAGE.colors.plane, selected ? 0.105 : 0.065);
  context.fill();
  context.strokeStyle = rgba(PAGE.colors.plane, selected ? 0.84 : 0.42);
  context.lineWidth = selected ? 1.5 : 1;
  context.setLineDash([5, 7]);
  context.stroke();
  context.setLineDash([]);

  for (const [first, second] of [[0, 2], [1, 3]]) {
    context.beginPath();
    context.moveTo(corners[first].canvasX, corners[first].canvasY);
    context.lineTo(corners[second].canvasX, corners[second].canvasY);
    context.strokeStyle = rgba(PAGE.colors.plane, selected ? 0.27 : 0.14);
    context.lineWidth = 0.75;
    context.stroke();
  }
  context.restore();
}

function triangleLight(a, b, c) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const normalZ = ab.x * ac.y - ab.y * ac.x;
  const normalX = ab.y * ac.z - ab.z * ac.y;
  const normalY = ab.z * ac.x - ab.x * ac.z;
  const length = Math.hypot(normalX, normalY, normalZ) || 1;
  return 0.28 + Math.abs(normalZ / length) * 0.72;
}

function drawMesh(mesh, transform) {
  const viewVertices = mesh.vertices.map(viewPoint);
  const projectedVertices = viewVertices.map((point) => {
    const projection = projectPoint3(point, 3.5);
    return {
      ...projection,
      canvasX: transform.x(projection.x),
      canvasY: transform.y(projection.y),
    };
  });
  const faces = mesh.triangles.map((triangle) => ({
    triangle,
    depth: (
      viewVertices[triangle.a].z
      + viewVertices[triangle.b].z
      + viewVertices[triangle.c].z
    ) / 3,
  })).sort((a, b) => a.depth - b.depth);

  context.save();
  for (const face of faces) {
    const { triangle } = face;
    const a = projectedVertices[triangle.a];
    const b = projectedVertices[triangle.b];
    const c = projectedVertices[triangle.c];
    const sourceA = mesh.vertices[triangle.a];
    const sourceB = mesh.vertices[triangle.b];
    const sourceC = mesh.vertices[triangle.c];
    const transverse = (
      sourceA.intrinsicV + sourceB.intrinsicV + sourceC.intrinsicV
    ) / 3;
    const color = mixColor(PAGE.colors.low, PAGE.colors.high, (transverse + 1) * 0.5);
    const light = triangleLight(
      viewVertices[triangle.a],
      viewVertices[triangle.b],
      viewVertices[triangle.c],
    );
    context.beginPath();
    context.moveTo(a.canvasX, a.canvasY);
    context.lineTo(b.canvasX, b.canvasY);
    context.lineTo(c.canvasX, c.canvasY);
    context.closePath();
    context.fillStyle = rgba(color, 0.035 + light * 0.095);
    context.fill();
    context.strokeStyle = rgba(color, 0.09 + light * 0.14);
    context.lineWidth = 0.55;
    context.stroke();
  }
  context.restore();
  return { viewVertices, projectedVertices };
}

function drawParametricCurve(points, transform, {
  color,
  alpha = 0.6,
  width = 1,
  dash = [],
} = {}) {
  if (points.length < 2) return;
  context.save();
  context.beginPath();
  points.forEach((point, index) => {
    const screen = projected(point, transform);
    if (index) context.lineTo(screen.canvasX, screen.canvasY);
    else context.moveTo(screen.canvasX, screen.canvasY);
  });
  context.strokeStyle = rgba(color, alpha);
  context.lineWidth = width;
  context.setLineDash(dash);
  context.stroke();
  context.restore();
}

function drawTopologyGuides(transform) {
  const options = surfaceOptions();
  const seam = Array.from({ length: 33 }, (_, index) => (
    surfacePoint(KIND, 0, -1 + index / 32 * 2, options)
  ));
  drawParametricCurve(seam, transform, {
    color: PAGE.colors.high,
    alpha: 0.72,
    width: 1.2,
    dash: [3, 5],
  });

  if (KIND === "moebius") {
    const boundary = Array.from({ length: 161 }, (_, index) => (
      surfacePoint(KIND, index / 160 * 2, 1, options)
    ));
    drawParametricCurve(boundary, transform, {
      color: PAGE.colors.low,
      alpha: 0.78,
      width: 1.35,
    });
  }
}

function drawSlice(slice, trackedComponents, transform) {
  const componentForSegment = new Map();
  slice.components.forEach((component) => {
    component.segmentIndices.forEach((index) => componentForSegment.set(index, component));
  });

  context.save();
  context.lineCap = "round";
  context.shadowColor = rgba(PAGE.colors.slice, 0.9);
  context.shadowBlur = 12;
  slice.segments.forEach((segment, index) => {
    const a = projected(segment.a, transform);
    const b = projected(segment.b, transform);
    const component = componentForSegment.get(index);
    const color = mixColor(
      PAGE.colors.slice,
      PAGE.colors.high,
      component?.seamAmount ?? 0,
    );
    context.beginPath();
    context.moveTo(a.canvasX, a.canvasY);
    context.lineTo(b.canvasX, b.canvasY);
    context.strokeStyle = rgba(color, 0.95);
    context.lineWidth = 2.2;
    context.stroke();
  });
  context.restore();

  if (cssWidth < 560 || cssHeight < 300) return;
  context.save();
  context.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textBaseline = "middle";
  trackedComponents.forEach((component) => {
    const point = projected(component.centroid, transform);
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 3.4, 0, TAU);
    context.fillStyle = rgba(PAGE.colors.slice, 1);
    context.shadowColor = rgba(PAGE.colors.slice, 0.9);
    context.shadowBlur = 10;
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = rgba(PAGE.colors.slice, 0.86);
    context.fillText(`V${component.componentId + 1}`, point.canvasX + 7, point.canvasY);
  });
  context.restore();
}

function drawScene(mesh, plane, slice, trackedComponents) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = projectionTransform();
  drawPlane(plane.normal, plane.offset, transform);
  drawMesh(mesh, transform);
  drawTopologyGuides(transform);
  drawSlice(slice, trackedComponents, transform);
}

function mappedSliceComponents(mesh, slice) {
  return mapSliceComponents(mesh, slice, {
    pitchRange: state.pitchRange,
    timbre: state.timbre,
    stereoWidth: state.stereoWidth,
    seamVoice: state.seamVoice,
  });
}

function sliceVoiceSpecs(mapped, phase = state.continuousPosition) {
  const voices = [];
  mapped.forEach((voice) => {
    const frequency = pitch01ToFrequency(
      voice.pitch01,
      state.baseFrequency,
      state.pitchRange,
    );
    const synth = synthParametersForMode(state.soundMode, voice.drive, {
      fmIndex: 2 + state.timbre * 8,
      fmRatio: 1.25 + voice.transverseAmount * 2.75,
      pmIndex: 1 + state.timbre * 6,
      pmRatio: 0.75 + voice.seamAmount * 2.5,
      shepardRate: state.playing ? state.speed * state.direction : 0,
      shepardWidth: 3 + state.timbre * 5,
      shepardPosition: phase,
    });
    voices.push({
      key: voice.key + ":core",
      frequency,
      gain: voice.gain * 0.68,
      pan: voice.pan,
      waveform: "sine",
      ...synth,
    });
    if (voice.haloGain > 0.0001) {
      voices.push({
        key: voice.key + ":halo",
        frequency: frequency * 2 ** (voice.haloSemitones / 12),
        gain: voice.haloGain,
        pan: clamp(-voice.pan * 0.72, -1, 1),
        waveform: "triangle",
        ...synthParametersForMode(state.soundMode, clamp(voice.drive + 0.18, 0, 1), {
          fmIndex: 1.5 + state.timbre * 5,
          fmRatio: 2 + voice.seamAmount,
          pmIndex: 1 + state.timbre * 4,
          pmRatio: 1.5 + voice.transverseAmount,
          shepardRate: state.playing ? -state.speed * state.direction : 0,
          shepardWidth: 2.5 + state.timbre * 4,
          shepardPosition: phase + 0.5,
        }),
      });
    }
  });
  return normalizeVoiceGains(voices, 0.66);
}

function planeFor(mesh, phase = state.continuousPosition, yaw = state.planeYaw, pitch = state.planePitch) {
  const normal = planeNormal(yaw, pitch);
  return {
    normal,
    offset: planeOffsetForMeshPhase(mesh, normal, phase),
  };
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
  return Math.min(0.12, audioDelta > 1e-6 ? audioDelta : performanceDelta);
}

function resetClocks() {
  lastFrameTime = performance.now();
  lastAudioTime = pool.context?.currentTime ?? null;
}

function wakeManualSound(milliseconds = 240) {
  manualSoundUntil = Math.max(manualSoundUntil, performance.now() + milliseconds);
  scheduleFrame();
}

function paintTransport() {
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute(
    "aria-label",
    `${state.playing ? "Pause" : "Play"} two-dimensional slicing plane`,
  );
  $("playSummary").textContent = `plane · ${state.playing ? "playing" : "paused"}`;
}

function paintAudio(starting = false) {
  const button = $("audioButton");
  button.disabled = starting;
  setPressed(button, state.audio);
  if (starting) {
    button.setAttribute("aria-label", "Starting audio");
    button.title = "Starting audio";
    $("audioState").textContent = "off";
    return;
  }
  const action = state.audio ? "Turn audio off" : "Turn audio on";
  button.setAttribute("aria-label", action);
  button.title = action;
  $("audioState").textContent = state.audio ? "on" : "off";
}

function paintAutoRotate() {
  const button = $("autoRotateButton");
  setPressed(button, state.autoRotate);
  button.textContent = `Auto-rotate · ${state.autoRotate ? "on" : "off"}`;
}

function paintTarget() {
  setPressed($("selectForm"), rotationTarget === "form");
  setPressed($("selectPlayhead"), rotationTarget === "playhead");
  stageWrap.classList.toggle("is-form-target", rotationTarget === "form");
}

function paintPreset() {
  document.querySelectorAll("[data-preset]").forEach((button) => {
    setPressed(button, button.dataset.preset === state.presetId);
  });
}

function paintSummaries() {
  if (KIND === "moebius") {
    $("formSummary").textContent = `${state.surfaceTwists} half-twist${state.surfaceTwists === 1 ? "" : "s"}`;
  } else {
    $("formSummary").textContent = `figure-eight · ${state.surfaceFold.toFixed(2)}×`;
  }
  $("rotationSummary").textContent = state.autoRotate ? "auto-rotating" : "still";
  $("soundSummary").textContent = `${state.soundMode.toUpperCase()} · slice curves`;
}

const RANGE_BINDINGS = [
  ["speed", "speed", (value) => `${value.toFixed(2)} cyc/s`, false, false],
  ["level", "level", (value) => `${Math.round(value * 100)}%`, false, false],
  ["planeYaw", "planeYaw", (value) => `${Math.round(value)}°`, true, false],
  ["planePitch", "planePitch", (value) => `${Math.round(value)}°`, true, false],
  ["surfaceRadius", "surfaceRadius", (value) => value.toFixed(2), true, true],
  ["surfaceWidth", "surfaceWidth", (value) => value.toFixed(2), true, true],
  ["surfaceFold", "surfaceFold", (value) => `${value.toFixed(2)}×`, true, true],
  ["rotationX", "rotationX", (value) => `${Math.round(value)}°`, false, false],
  ["rotationY", "rotationY", (value) => `${Math.round(value)}°`, false, false],
  ["rotationZ", "rotationZ", (value) => `${Math.round(value)}°`, false, false],
  ["rotationSpeed", "rotationSpeed", (value) => `${value >= 0 ? "+" : ""}${value.toFixed(3)} rev/s`, false, false],
  ["baseFrequency", "baseFrequency", (value) => `${Math.round(value)} Hz`, true, false],
  ["pitchRange", "pitchRange", (value) => `${value.toFixed(2)} oct`, true, false],
  ["timbre", "timbre", (value) => `${Math.round(value * 100)}%`, true, false],
  ["stereoWidth", "stereoWidth", (value) => `${Math.round(value * 100)}%`, true, false],
  ["seamVoice", "seamVoice", (value) => `${Math.round(value * 100)}%`, true, false],
];

function syncRange(id, key, formatter) {
  const input = $(id);
  const output = $(`${id}Out`);
  if (input) input.value = String(state[key]);
  if (output) output.textContent = formatter(state[key]);
}

function syncPosition() {
  state.position = wrap01(state.continuousPosition);
  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
}

function syncControls() {
  syncPosition();
  RANGE_BINDINGS.forEach(([id, key, formatter]) => syncRange(id, key, formatter));
  if ($("surfaceTwists")) $("surfaceTwists").value = String(state.surfaceTwists);
  $("soundMode").value = state.soundMode;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  paintAutoRotate();
  paintTransport();
  paintPreset();
  paintSummaries();
}

function markCustom() {
  state.presetId = "";
  paintPreset();
}

$("position").addEventListener("input", (event) => {
  const next = Number(event.currentTarget.value);
  const current = wrap01(state.continuousPosition);
  state.continuousPosition += next - current;
  state.position = next;
  markCustom();
  wakeManualSound();
});

RANGE_BINDINGS.forEach(([id, key, formatter, audible, rebuild]) => {
  const input = $(id);
  if (!input) return;
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    if (rebuild) meshCacheKey = "";
    if (key === "level") pool.setLevel(state.level);
    syncRange(id, key, formatter);
    if (["rotationX", "rotationY", "rotationZ"].includes(key)) {
      state.autoRotate = false;
      paintAutoRotate();
    }
    markCustom();
    paintSummaries();
    if (audible) wakeManualSound();
    else scheduleFrame();
  });
});

$("surfaceTwists")?.addEventListener("change", (event) => {
  state.surfaceTwists = Number(event.currentTarget.value);
  meshCacheKey = "";
  markCustom();
  paintSummaries();
  wakeManualSound();
});

$("soundMode").addEventListener("change", (event) => {
  state.soundMode = event.currentTarget.value;
  markCustom();
  paintSummaries();
  wakeManualSound();
});

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  resetClocks();
  paintTransport();
  if (!state.playing) pool.setVoices([]);
  if (state.playing && !state.audio) {
    announce("Audio is off — turn it on to hear playback");
  } else {
    announce(`Slicing plane ${state.playing ? "playing" : "paused"}.`);
  }
  scheduleFrame();
});

$("directionButton").addEventListener("click", () => {
  state.direction *= -1;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  markCustom();
  announce(`Plane direction ${state.direction > 0 ? "forward" : "reverse"}.`);
  scheduleFrame();
});

$("autoRotateButton").addEventListener("click", () => {
  state.autoRotate = !state.autoRotate;
  paintAutoRotate();
  paintSummaries();
  resetClocks();
  announce(`View auto-rotation ${state.autoRotate ? "on" : "off"}.`);
  scheduleFrame();
});

function selectTarget(target, shouldAnnounce = true) {
  rotationTarget = target === "form" ? "form" : "playhead";
  paintTarget();
  if (shouldAnnounce) {
    announce(`${rotationTarget === "form" ? "Shape" : "Two-dimensional playhead"} selected for dragging.`);
  }
  scheduleFrame();
}

$("selectForm").addEventListener("click", () => selectTarget("form"));
$("selectPlayhead").addEventListener("click", () => selectTarget("playhead"));

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || (event.button ?? 0) !== 0) return;
  if (rotationTarget === "form") {
    state.autoRotate = false;
    paintAutoRotate();
  }
  drag = {
    id: event.pointerId,
    target: rotationTarget,
    x: event.clientX,
    y: event.clientY,
    rotationX: state.rotationX,
    rotationY: state.rotationY,
    planeYaw: state.planeYaw,
    planePitch: state.planePitch,
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  stageWrap.classList.add("is-dragging");
  if (rotationTarget === "playhead") wakeManualSound(360);
  paintSummaries();
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const horizontal = event.clientX - drag.x;
  const vertical = event.clientY - drag.y;
  if (drag.target === "form") {
    state.rotationY = normalizeDegrees(drag.rotationY + horizontal * 0.45);
    state.rotationX = normalizeDegrees(drag.rotationX - vertical * 0.45);
    syncRange("rotationX", "rotationX", (value) => `${Math.round(value)}°`);
    syncRange("rotationY", "rotationY", (value) => `${Math.round(value)}°`);
  } else {
    state.planeYaw = normalizeDegrees(drag.planeYaw + horizontal * 0.45);
    state.planePitch = normalizeDegrees(drag.planePitch - vertical * 0.45);
    syncRange("planeYaw", "planeYaw", (value) => `${Math.round(value)}°`);
    syncRange("planePitch", "planePitch", (value) => `${Math.round(value)}°`);
    wakeManualSound(160);
  }
  markCustom();
  scheduleFrame();
  event.preventDefault();
});

function abandonDrag({ cancelAudition = false, silencePaused = false } = {}) {
  const pointerId = drag?.id;
  drag = null;
  stageWrap.classList.remove("is-dragging");
  if (Number.isFinite(pointerId) && canvas.hasPointerCapture?.(pointerId)) {
    try {
      canvas.releasePointerCapture(pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
  }
  if (cancelAudition) manualSoundUntil = 0;
  if (cancelAudition && silencePaused && !state.playing) pool.setVoices([]);
}

function finishDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  abandonDrag();
  scheduleFrame();
}

function cancelDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  abandonDrag({ cancelAudition: true, silencePaused: true });
  scheduleFrame();
}

canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", cancelDrag);
canvas.addEventListener("lostpointercapture", cancelDrag);

canvas.addEventListener("keydown", (event) => {
  const amount = event.shiftKey ? 0.06 : 0.0125;
  let handled = true;
  if (event.key === "ArrowLeft") {
    state.continuousPosition -= amount;
    wakeManualSound();
  } else if (event.key === "ArrowRight") {
    state.continuousPosition += amount;
    wakeManualSound();
  } else if (event.key === "ArrowUp") {
    state.planePitch = normalizeDegrees(state.planePitch + (event.shiftKey ? 12 : 3));
    wakeManualSound();
  } else if (event.key === "ArrowDown") {
    state.planePitch = normalizeDegrees(state.planePitch - (event.shiftKey ? 12 : 3));
    wakeManualSound();
  } else if (event.code === "BracketLeft" || event.key === "[" || event.key === "{") {
    state.planeYaw = normalizeDegrees(state.planeYaw - (event.shiftKey ? 12 : 3));
    wakeManualSound();
  } else if (event.code === "BracketRight" || event.key === "]" || event.key === "}") {
    state.planeYaw = normalizeDegrees(state.planeYaw + (event.shiftKey ? 12 : 3));
    wakeManualSound();
  } else if (event.key === "Home") {
    state.continuousPosition += 0.5 - wrap01(state.continuousPosition);
    wakeManualSound();
  } else {
    handled = false;
  }
  if (!handled) return;
  event.preventDefault();
  markCustom();
  syncPosition();
  syncRange("planeYaw", "planeYaw", (value) => `${Math.round(value)}°`);
  syncRange("planePitch", "planePitch", (value) => `${Math.round(value)}°`);
  scheduleFrame();
});

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    const presetId = button.dataset.preset;
    const preset = PAGE.presets[presetId];
    if (!preset) return;
    Object.assign(state, preset);
    state.presetId = presetId;
    meshCacheKey = "";
    componentTracks = [];
    syncControls();
    wakeManualSound(320);
    announce(`${button.textContent.trim()} preset loaded without stopping transport.`);
  });
});

$("resetAll").addEventListener("click", () => {
  const audio = state.audio;
  Object.assign(state, baseline, {
    audio,
    presetId: PAGE.firstPreset,
  });
  meshCacheKey = "";
  componentTracks = [];
  manualSoundUntil = 0;
  pool.setVoices([]);
  resetClocks();
  syncControls();
  announce(`${PAGE.label} reset to its opening state. Audio ${audio ? "stays on" : "stays off"}.`);
  scheduleFrame();
});

async function toggleAudio() {
  $("audioError").hidden = true;
  if (state.audio) {
    audioRequestGeneration += 1;
    state.audio = false;
    pool.disable();
    paintAudio();
    announce("Audio off. The slicing plane transport is unchanged.");
    scheduleFrame();
    return;
  }

  const requestGeneration = ++audioRequestGeneration;
  paintAudio(true);
  try {
    await pool.enable();
    if (
      tornDown
      || !pageActive
      || document.hidden
      || requestGeneration !== audioRequestGeneration
    ) {
      pool.disable();
      return;
    }
    pool.setLevel(state.level);
    state.audio = true;
    resetClocks();
    paintAudio();
    announce(state.playing
      ? "Audio on. Joined the moving slice."
      : "Audio on. Play or move the plane to hear its slice.");
    scheduleFrame();
  } catch (error) {
    if (
      tornDown
      || !pageActive
      || document.hidden
      || requestGeneration !== audioRequestGeneration
    ) {
      pool.disable();
      return;
    }
    state.audio = false;
    $("audioError").textContent = error instanceof Error
      ? error.message
      : "Web Audio could not start.";
    $("audioError").hidden = false;
    paintAudio();
  }
}

$("audioButton").addEventListener("click", toggleAudio);

function frame(now) {
  scheduledFrame = 0;
  const delta = transportDelta(now);
  if (state.playing) {
    state.continuousPosition += state.direction * state.speed * delta;
  }
  if (state.autoRotate) {
    state.rotationY = normalizeDegrees(
      state.rotationY + state.rotationSpeed * 360 * delta,
    );
  }
  syncPosition();
  if (state.autoRotate) {
    syncRange("rotationY", "rotationY", (value) => `${Math.round(value)}°`);
  }

  const mesh = currentMesh();
  const plane = planeFor(mesh);
  const slice = sliceSurface(mesh, plane.normal, plane.offset);
  const currentTracking = trackSliceComponents(
    mesh,
    componentTracks,
    mappedSliceComponents(mesh, slice),
    nextComponentId,
  );
  componentTracks = currentTracking.tracks;
  nextComponentId = currentTracking.nextId;
  drawScene(mesh, plane, slice, currentTracking.components);

  const manualActive = now < manualSoundUntil || drag?.target === "playhead";
  const sounding = state.audio && (state.playing || manualActive);
  let voices = [];
  if (sounding) {
    voices = sliceVoiceSpecs(currentTracking.components, state.continuousPosition);
    const futurePhase = state.continuousPosition + (
      state.playing ? state.direction * state.speed * 0.075 : 0
    );
    const futurePlane = planeFor(mesh, futurePhase);
    const futureSlice = sliceSurface(mesh, futurePlane.normal, futurePlane.offset);
    const futureTracking = trackSliceComponents(
      mesh,
      componentTracks,
      mappedSliceComponents(mesh, futureSlice),
      nextComponentId,
    );
    const futureVoices = sliceVoiceSpecs(
      futureTracking.components,
      futurePhase,
    );
    pool.setVoiceTrajectory(voices, futureVoices, 0.075);
  } else if (state.audio) {
    pool.setVoices([]);
  }

  const curveCount = slice.components.length;
  const segmentCount = slice.segments.length;
  const audioReadout = state.audio
    ? `${sounding ? voices.length : 0} VOICES`
    : "AUDIO OFF";
  $("stageReadout").textContent = `${PAGE.shortLabel} · ${curveCount} CURVE${curveCount === 1 ? "" : "S"} / ${segmentCount} SEGMENTS · ${audioReadout}${slice.truncated ? " · CAPPED" : ""}`;

  if (state.playing || state.autoRotate || manualActive) scheduleFrame();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    manualSoundUntil = 0;
    pool.silence();
    return;
  }
  resetClocks();
  scheduleFrame();
});

window.addEventListener("blur", () => {
  abandonDrag({ cancelAudition: true, silencePaused: true });
  scheduleFrame();
});

window.addEventListener("pagehide", (event) => {
  abandonDrag({ cancelAudition: true });
  pageActive = false;
  audioRequestGeneration += 1;
  cancelAnimationFrame(scheduledFrame);
  scheduledFrame = 0;
  manualSoundUntil = 0;
  state.audio = false;
  pool.disable();
  paintAudio();
  componentTracks = [];
  if (!event.persisted) {
    tornDown = true;
    resizeObserver.disconnect();
    void pool.close();
  }
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted || tornDown) return;
  pageActive = true;
  resetClocks();
  scheduleFrame();
});

syncControls();
paintAudio();
paintTarget();
scheduleFrame();

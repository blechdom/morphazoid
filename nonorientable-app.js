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
  MOEBIUS_SEQUENCE,
  buildSurfaceMesh,
  clamp,
  mapSliceComponents,
  moebiusCounterpointEvents,
  moebiusSequenceFrame,
  moebiusSequencePulseWindow,
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
    playMode: "plane",
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
    playMode: "plane",
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
let nextSequencePulse = null;
let lastSequencePass = null;
let sequenceSchedulerTimer = null;
let sequenceAnchorPhase = state.continuousPosition;
let sequenceAnchorTime = performance.now() / 1_000;
const SEQUENCE_LOOKAHEAD_SECONDS = 0.1;
const SEQUENCE_SCHEDULER_INTERVAL_MS = 25;
const MAX_SEQUENCE_PULSES_PER_TICK = 4;

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

function sequenceModeActive() {
  return KIND === "moebius" && state.playMode === "sequence";
}

function sequenceClockTime(performanceTimestamp = performance.now()) {
  const audioTime = pool.context?.currentTime;
  if (state.audio && Number.isFinite(audioTime)) return audioTime;
  return performanceTimestamp / 1_000;
}

function sequencePositionAt(performanceTimestamp = performance.now()) {
  if (!sequenceModeActive() || !state.playing) return state.continuousPosition;
  const elapsed = Math.max(
    0,
    sequenceClockTime(performanceTimestamp) - sequenceAnchorTime,
  );
  return sequenceAnchorPhase + state.speed * elapsed;
}

function setSequenceTransportAnchor(
  phase = state.continuousPosition,
  performanceTimestamp = performance.now(),
) {
  state.continuousPosition = phase;
  sequenceAnchorPhase = phase;
  sequenceAnchorTime = sequenceClockTime(performanceTimestamp);
}

function currentSequenceFrame() {
  return moebiusSequenceFrame(sequencePositionAt());
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

function sequencePitchTrace(sequence, role, options) {
  const entries = [];
  for (let index = 0; index < MOEBIUS_SEQUENCE.stepsPerLap; index += 1) {
    const score = moebiusCounterpointEvents(
      sequence.passIndex * MOEBIUS_SEQUENCE.stepsPerLap + index,
      {
        baseFrequency: state.baseFrequency,
        pitchRange: state.pitchRange,
        stereoWidth: state.stereoWidth,
        seamVoice: state.seamVoice,
      },
    );
    const event = score.events.find((candidate) => candidate.role === role);
    if (!event) continue;
    const longitudinal = sequence.passIndex + (
      index + (role === "answer" ? 0.5 : 0)
    ) / MOEBIUS_SEQUENCE.stepsPerLap;
    entries.push({
      axis: surfacePoint("moebius", longitudinal, 0, options),
      note: surfacePoint(
        "moebius",
        longitudinal,
        clamp(event.pitchOffsetSemitones / 20, -0.66, 0.66),
        options,
      ),
    });
  }
  return entries;
}

function drawSequenceScore(transform, sequence) {
  const options = surfaceOptions();
  const counterpoint = moebiusCounterpointEvents(sequence.ordinal, {
    baseFrequency: state.baseFrequency,
    pitchRange: state.pitchRange,
    stereoWidth: state.stereoWidth,
    seamVoice: state.seamVoice,
  });

  context.save();
  for (const traceStyle of [
    { role: "subject", color: PAGE.colors.slice, dash: [] },
    { role: "answer", color: mixColor(PAGE.colors.slice, PAGE.colors.high, 0.58), dash: [3, 4] },
  ]) {
    const trace = sequencePitchTrace(sequence, traceStyle.role, options)
      .map((entry) => ({
        axis: projected(entry.axis, transform),
        note: projected(entry.note, transform),
      }));
    if (trace.length > 1) {
      context.beginPath();
      trace.forEach((entry, index) => {
        if (index) context.lineTo(entry.note.canvasX, entry.note.canvasY);
        else context.moveTo(entry.note.canvasX, entry.note.canvasY);
      });
      context.strokeStyle = rgba(traceStyle.color, traceStyle.role === "subject" ? 0.72 : 0.46);
      context.lineWidth = traceStyle.role === "subject" ? 1.35 : 1;
      context.setLineDash(traceStyle.dash);
      context.stroke();
      context.setLineDash([]);
    }
    for (const entry of trace) {
      context.beginPath();
      context.moveTo(entry.axis.canvasX, entry.axis.canvasY);
      context.lineTo(entry.note.canvasX, entry.note.canvasY);
      context.strokeStyle = rgba(traceStyle.color, 0.3);
      context.lineWidth = 0.75;
      context.stroke();
      context.beginPath();
      context.arc(entry.note.canvasX, entry.note.canvasY, 1.55, 0, TAU);
      context.fillStyle = rgba(traceStyle.color, 0.82);
      context.fill();
    }
  }

  for (let index = 0; index < MOEBIUS_SEQUENCE.stepsPerLap; index += 1) {
    const laneA = index % 2 === 0;
    const station = surfacePoint(
      "moebius",
      sequence.passIndex + index / MOEBIUS_SEQUENCE.stepsPerLap,
      laneA ? -0.82 : 0.82,
      options,
    );
    const point = projected(station, transform);
    const active = index === sequence.stepIndex;
    const color = laneA ? PAGE.colors.low : PAGE.colors.high;
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, active ? 4.2 : 2.1, 0, TAU);
    context.fillStyle = rgba(color, active ? 1 : 0.48);
    context.shadowColor = rgba(color, 0.9);
    context.shadowBlur = active ? 13 : 0;
    context.fill();
  }

  const crossbar = Array.from({ length: 17 }, (_, index) => surfacePoint(
    "moebius",
    state.continuousPosition,
    -1 + index / 8,
    options,
  ));
  const projectedCrossbar = crossbar.map((point) => projected(point, transform));
  const first = projectedCrossbar[0];
  const last = projectedCrossbar[projectedCrossbar.length - 1];
  const gradient = context.createLinearGradient(
    first.canvasX,
    first.canvasY,
    last.canvasX,
    last.canvasY,
  );
  gradient.addColorStop(0, rgba(PAGE.colors.low, 1));
  gradient.addColorStop(0.5, rgba(PAGE.colors.slice, 1));
  gradient.addColorStop(1, rgba(PAGE.colors.high, 1));
  context.beginPath();
  projectedCrossbar.forEach((point, index) => {
    if (index) context.lineTo(point.canvasX, point.canvasY);
    else context.moveTo(point.canvasX, point.canvasY);
  });
  context.strokeStyle = gradient;
  context.lineWidth = 3.2;
  context.lineCap = "round";
  context.shadowColor = rgba(PAGE.colors.slice, 0.92);
  context.shadowBlur = 14;
  context.stroke();
  context.shadowBlur = 0;

  [[first, PAGE.colors.low, "A", "a"], [last, PAGE.colors.high, "B", "b"]]
    .forEach(([point, color, label, lane]) => {
      const activeEvent = counterpoint.events.find((event) => (
        event.role === sequence.activeRole && event.lane === lane
      ));
      const isActive = activeEvent?.gain > 0.0001;
      const isAnswer = isActive && activeEvent.role === "answer";
      context.beginPath();
      context.arc(point.canvasX, point.canvasY, isActive ? 6.2 : 4.6, 0, TAU);
      context.fillStyle = rgba(color, isActive ? 1 : 0.7);
      context.shadowColor = rgba(color, 0.95);
      context.shadowBlur = isActive ? 15 : 3;
      context.fill();
      context.shadowBlur = 0;
      if (isAnswer) {
        context.beginPath();
        context.arc(point.canvasX, point.canvasY, 8.2, 0, TAU);
        context.strokeStyle = rgba(PAGE.colors.slice, 0.8);
        context.lineWidth = 1.35;
        context.stroke();
      }
      if (cssWidth >= 560 && cssHeight >= 300) {
        context.fillStyle = rgba(color, 0.96);
        context.font = "bold 9px ui-monospace, SFMono-Regular, Menlo, monospace";
        context.textBaseline = "middle";
        context.fillText(label, point.canvasX + 8, point.canvasY);
      }
    });
  context.restore();
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

function drawScene(mesh, plane, slice, trackedComponents, sequence = null) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = projectionTransform();
  if (!sequence) drawPlane(plane.normal, plane.offset, transform);
  drawMesh(mesh, transform);
  drawTopologyGuides(transform);
  if (sequence) {
    drawSequenceScore(transform, sequence);
  } else {
    drawSlice(slice, trackedComponents, transform);
  }
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

function stopSequenceScheduler({ silence = false } = {}) {
  if (sequenceSchedulerTimer !== null) window.clearInterval(sequenceSchedulerTimer);
  sequenceSchedulerTimer = null;
  nextSequencePulse = null;
  lastSequencePass = null;
  if (silence) pool.silence();
}

function armSequenceAtCurrent({ audition = false } = {}) {
  if (!sequenceModeActive()) return;
  const position = sequencePositionAt();
  const sequence = moebiusSequenceFrame(position);
  nextSequencePulse = sequence.pulseOrdinal + 1;
  lastSequencePass = sequence.passIndex;
  if (audition && state.audio) strikeSequencePulse(sequence.pulseOrdinal);
}

function sequenceWaveform() {
  if (state.timbre < 0.34) return "sine";
  if (state.timbre < 0.72) return "triangle";
  return "sawtooth";
}

function strikeSequencePulse(pulse, requestedStartAt = null) {
  if (!state.audio || !pool.context || !sequenceModeActive()) return 0;
  const safePulse = Number.isFinite(Number(pulse)) ? Math.floor(Number(pulse)) : 0;
  const ordinal = Math.floor(safePulse / 2);
  const role = safePulse % 2 === 0 ? "subject" : "answer";
  const mapped = moebiusCounterpointEvents(ordinal, {
    baseFrequency: state.baseFrequency,
    pitchRange: state.pitchRange,
    stereoWidth: state.stereoWidth,
    seamVoice: state.seamVoice,
  });
  const event = mapped.events.find((candidate) => candidate.role === role);
  if (!event || event.gain <= 0.0001) return 0;

  const contextNow = pool.context.currentTime;
  const minimumStartAt = contextNow + 0.003;
  if (Number.isFinite(requestedStartAt) && requestedStartAt < minimumStartAt) return 0;
  const startAt = Number.isFinite(requestedStartAt)
    ? requestedStartAt
    : minimumStartAt;
  const stepDuration = 1 / (
    Math.max(0.01, state.speed) * MOEBIUS_SEQUENCE.stepsPerLap
  );
  const decaySeconds = clamp(stepDuration * 0.68, 0.045, 0.22);
  const gain = Math.min(event.gain, pool.availableStrikeHeadroom(0.78));
  if (gain <= 0.0001) return 0;
  return pool.strike({
    key: `moebius:weave:${event.role}:${event.lane}`,
    frequency: event.frequency,
    gain,
    pan: event.pan,
    waveform: sequenceWaveform(),
  }, {
    attackSeconds: 0.003 + state.timbre * 0.004,
    decaySeconds,
    attackNoise: state.timbre * 0.12,
    startAt,
    retriggerMode: "crossfade",
    crossfadeSeconds: 0.012,
  }) ? 1 : 0;
}

function scheduleSequenceLookahead(phase = sequencePositionAt()) {
  if (!state.playing || !state.audio || !pool.context || !sequenceModeActive()) return 0;
  const pulsesPerLap = MOEBIUS_SEQUENCE.stepsPerLap * 2;
  const rate = Math.max(0.01, state.speed);
  const secondsPerPulse = 1 / (rate * pulsesPerLap);
  const currentPulse = phase * pulsesPerLap;
  const pulseWindow = moebiusSequencePulseWindow(
    currentPulse,
    nextSequencePulse,
    SEQUENCE_LOOKAHEAD_SECONDS / secondsPerPulse,
    MAX_SEQUENCE_PULSES_PER_TICK,
  );
  const audioNow = pool.context.currentTime;
  let scheduled = 0;
  for (const pulse of pulseWindow.pulses) {
    const secondsUntil = (pulse - currentPulse) * secondsPerPulse;
    scheduled += strikeSequencePulse(
      pulse,
      audioNow + secondsUntil,
    );
  }
  nextSequencePulse = pulseWindow.nextPulse;
  return scheduled;
}

function startSequenceScheduler() {
  if (
    sequenceSchedulerTimer !== null
    || !pageActive
    || document.hidden
    || !sequenceModeActive()
    || !state.playing
    || !state.audio
    || !pool.context
  ) return;
  scheduleSequenceLookahead();
  sequenceSchedulerTimer = window.setInterval(
    () => scheduleSequenceLookahead(),
    SEQUENCE_SCHEDULER_INTERVAL_MS,
  );
}

function paintSequencePosition() {
  const output = $("sequenceState");
  if (!output || !sequenceModeActive()) return;
  const sequence = currentSequenceFrame();
  const mapped = moebiusCounterpointEvents(sequence.ordinal, {
    baseFrequency: state.baseFrequency,
    pitchRange: state.pitchRange,
    stereoWidth: state.stereoWidth,
    seamVoice: state.seamVoice,
  });
  const activeEvent = mapped.events.find((event) => event.role === sequence.activeRole);
  const activeCopy = !activeEvent
    ? "NOW ANSWER REST"
    : activeEvent.gain > 0.0001
      ? `NOW ${activeEvent.role.toUpperCase()} ${activeEvent.lane.toUpperCase()}`
      : `NOW ${activeEvent.role.toUpperCase()} ${activeEvent.lane.toUpperCase()} MUTED`;
  const copy = `${sequence.shadow ? "PASS 2 / ORIENTATION B / SHADOW" : "PASS 1 / ORIENTATION A"} / STEP ${String(sequence.stepIndex + 1).padStart(2, "0")}/16 / ${activeCopy}`;
  if (output.textContent !== copy) output.textContent = copy;
  canvas.dataset.sequencePass = String(sequence.passNumber);
  canvas.dataset.sequenceStep = String(sequence.stepIndex + 1);
  canvas.dataset.sequenceOrientation = String(sequence.orientation);
  canvas.dataset.sequenceRole = sequence.activeRole;
}

function wakeManualSound(milliseconds = 240) {
  manualSoundUntil = Math.max(manualSoundUntil, performance.now() + milliseconds);
  if (sequenceModeActive()) {
    const sequence = currentSequenceFrame();
    if (state.audio) strikeSequencePulse(sequence.pulseOrdinal);
    if (!Number.isFinite(nextSequencePulse)) {
      nextSequencePulse = Math.floor(
        sequencePositionAt() * MOEBIUS_SEQUENCE.stepsPerLap * 2,
      ) + 1;
    }
  }
  scheduleFrame();
}

function paintTransport() {
  const sequence = sequenceModeActive();
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute(
    "aria-label",
    `${state.playing ? "Pause" : "Play"} ${sequence ? "Mobius counterpoint weave" : "two-dimensional slicing plane"}`,
  );
  if (sequence) {
    $("playSummary").textContent = `weave / ${state.playing ? "playing" : "paused"}`;
    paintSequencePosition();
    return;
  }
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
  const activeTarget = sequenceModeActive() ? "form" : rotationTarget;
  setPressed($("selectForm"), activeTarget === "form");
  setPressed($("selectPlayhead"), activeTarget === "playhead");
  $("selectPlayhead").disabled = sequenceModeActive();
  stageWrap.classList.toggle("is-form-target", activeTarget === "form");
}

function setLegendCopy(markerSelector, copy) {
  const item = document.querySelector(markerSelector)?.parentElement;
  const textNode = Array.from(item?.childNodes ?? [])
    .find((node) => node.nodeType === 3);
  if (textNode) textNode.nodeValue = copy;
}

function controlCopy(id) {
  return $(id)?.closest("label")?.querySelector(".field-label, b");
}

function paintPlayMode() {
  const planeButton = $("selectPlaneMode");
  const sequenceButton = $("selectSequenceMode");
  if (!planeButton || !sequenceButton) return;
  const sequence = sequenceModeActive();
  setPressed(planeButton, !sequence);
  setPressed(sequenceButton, sequence);
  $("sequenceState").hidden = !sequence;
  $("directionButton").disabled = sequence;
  $("directionButton").textContent = sequence
    ? "Direction / forward (fixed)"
    : `Direction \u00b7 ${state.direction > 0 ? "forward" : "reverse"}`;
  for (const id of ["planeYaw", "planePitch"]) $(id).disabled = sequence;
  $("soundMode").disabled = sequence;
  controlCopy("position").textContent = sequence ? "Ribbon position" : "Plane position";
  controlCopy("speed").textContent = sequence ? "Ribbon speed" : "Plane speed";
  controlCopy("soundMode").textContent = sequence ? "Curve voice / plane only" : "Curve voice";
  controlCopy("baseFrequency").textContent = sequence ? "Tonal axis" : "Base frequency";
  controlCopy("pitchRange").textContent = sequence ? "Figure interval span" : "Vertical pitch span";
  controlCopy("timbre").textContent = sequence ? "Pulse color" : "Transverse color";
  controlCopy("stereoWidth").textContent = sequence ? "Lane stereo" : "Horizontal stereo";
  controlCopy("seamVoice").textContent = sequence ? "Answer level" : "Seam halo";
  $("surfaceInstructions").textContent = sequence
    ? "Space plays or pauses. Time stays forward. The slider scrubs this lap and its 100% endpoint crosses the seam; arrow keys step across it, and Home begins this pass. Cyan A and magenta B hocket the subject. Its quiet answer enters four stations later on the offbeat; pass 2 swaps role registers and inverts the pitch figure."
    : "Space plays or pauses. Left/right arrows scrub the plane. Up/down arrows tilt it. Drag the selected Shape or 2D head in the stage.";
  const formInstructions = document.querySelector('[data-section="form"] .control-note');
  if (formInstructions) {
    formInstructions.textContent = sequence
      ? "Form controls reshape the visible strip only in Counterpoint weave; its pitch and rhythm stay keyed to sixteen intrinsic stations."
      : "The lateral boundaries stay real edges. The longitudinal seam joins each transverse coordinate to its opposite.";
  }
  const modeReadout = document.querySelector(".topology-identity > span");
  if (modeReadout) {
    modeReadout.textContent = sequence
      ? "CROSSBAR \u2192 HOCKET \u2192 TWO-LAP INVERSION"
      : "PLANE \u2192 SLICE CURVE \u2192 VOICE";
  }
  setLegendCopy(".legend-plane", sequence ? "crossbar A-B" : "2D playhead");
  setLegendCopy(".legend-slice", sequence ? "pitch figures" : "sounding slice");
  canvas.setAttribute(
    "aria-label",
    sequence
      ? "An edge-to-edge playhead crosses sixteen Mobius stations. Intrinsic cyan A and magenta B trade positions as the local frame reverses after pass 1; after pass 2 the next phrase returns to orientation A. Solid and dashed traces show the subject and answer; both mirror around the tonal axis on pass 2. Left and right arrows step, and Home begins the current pass."
      : "A two-dimensional plane slices a Mobius band. Drag to rotate the selected band or playhead; use arrow keys to scrub and tilt the playhead.",
  );
  stageWrap.dataset.playMode = sequence ? "sequence" : "plane";
  if (!sequence) {
    delete canvas.dataset.sequencePass;
    delete canvas.dataset.sequenceStep;
    delete canvas.dataset.sequenceOrientation;
    delete canvas.dataset.sequenceRole;
  }
  paintTarget();
  paintTransport();
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
  if (sequenceModeActive()) {
    $("soundSummary").textContent = "PULSE / counterpoint weave";
    return;
  }
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
  ["pitchRange", "pitchRange", (value) => sequenceModeActive()
    ? `${(9 * clamp(value, 0.25, 5) / 2.6).toFixed(1)} st`
    : `${value.toFixed(2)} oct`, true, false],
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
  if (sequenceModeActive()) {
    const sequence = currentSequenceFrame();
    $("positionOut").textContent = `${String(sequence.stepIndex + 1).padStart(2, "0")}/16 / P${sequence.passNumber}`;
    paintSequencePosition();
  } else {
    $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  }
}

function syncControls() {
  syncPosition();
  RANGE_BINDINGS.forEach(([id, key, formatter]) => syncRange(id, key, formatter));
  if ($("surfaceTwists")) $("surfaceTwists").value = String(state.surfaceTwists);
  $("soundMode").value = state.soundMode;
  $("directionButton").textContent = `Direction · ${state.direction > 0 ? "forward" : "reverse"}`;
  paintAutoRotate();
  paintTransport();
  paintPlayMode();
  paintPreset();
  paintSummaries();
}

function markCustom() {
  state.presetId = "";
  paintPreset();
}

$("position").addEventListener("input", (event) => {
  if (sequenceModeActive() && state.playing) {
    setSequenceTransportAnchor(sequencePositionAt());
  }
  if (sequenceModeActive()) stopSequenceScheduler({ silence: true });
  const next = Number(event.currentTarget.value);
  const current = wrap01(state.continuousPosition);
  state.continuousPosition += next - current;
  state.position = next;
  markCustom();
  if (sequenceModeActive()) {
    setSequenceTransportAnchor(state.continuousPosition);
    armSequenceAtCurrent();
    wakeManualSound();
    startSequenceScheduler();
  } else {
    wakeManualSound();
  }
});

const SEQUENCE_SOUND_KEYS = new Set([
  "speed",
  "baseFrequency",
  "pitchRange",
  "timbre",
  "stereoWidth",
  "seamVoice",
]);

RANGE_BINDINGS.forEach(([id, key, formatter, audible, rebuild]) => {
  const input = $(id);
  if (!input) return;
  input.addEventListener("input", () => {
    const sequenceEdit = sequenceModeActive() && SEQUENCE_SOUND_KEYS.has(key);
    const sequencePhase = sequenceModeActive() && state.playing
      ? sequencePositionAt()
      : state.continuousPosition;
    if (sequenceEdit) stopSequenceScheduler({ silence: true });

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
    if (sequenceEdit) {
      setSequenceTransportAnchor(sequencePhase);
      armSequenceAtCurrent();
      wakeManualSound();
      startSequenceScheduler();
    } else if (sequenceModeActive()) {
      scheduleFrame();
    } else if (audible) {
      wakeManualSound();
    } else {
      scheduleFrame();
    }
  });
});

$("surfaceTwists")?.addEventListener("change", (event) => {
  state.surfaceTwists = Number(event.currentTarget.value);
  meshCacheKey = "";
  markCustom();
  paintSummaries();
  if (sequenceModeActive()) scheduleFrame();
  else wakeManualSound();
});

$("soundMode").addEventListener("change", (event) => {
  state.soundMode = event.currentTarget.value;
  markCustom();
  paintSummaries();
  wakeManualSound();
});

function setPlayMode(mode) {
  const nextMode = mode === "sequence" ? "sequence" : "plane";
  if (KIND !== "moebius" || state.playMode === nextMode) return;
  const leavingSequence = sequenceModeActive();
  const currentPhase = leavingSequence && state.playing
    ? sequencePositionAt()
    : state.continuousPosition;
  stopSequenceScheduler({ silence: true });
  state.playMode = nextMode;
  setSequenceTransportAnchor(currentPhase);
  manualSoundUntil = 0;
  componentTracks = [];
  if (nextMode === "sequence") armSequenceAtCurrent();
  syncControls();
  startSequenceScheduler();
  announce(nextMode === "sequence"
    ? "Counterpoint weave selected. Pass 1 hockets a subject between endpoints A and B, with an interlocking answer four stations later on the offbeat. Pass 2 swaps registers and inverts the figure while time stays forward."
    : "Two-dimensional plane slice selected. Plane direction and curve voice controls restored.");
  scheduleFrame();
}

$("selectPlaneMode")?.addEventListener("click", () => setPlayMode("plane"));
$("selectSequenceMode")?.addEventListener("click", () => setPlayMode("sequence"));

$("playButton").addEventListener("click", () => {
  const sequence = sequenceModeActive();
  if (sequence && state.playing) setSequenceTransportAnchor(sequencePositionAt());
  state.playing = !state.playing;
  if (sequence) setSequenceTransportAnchor(state.continuousPosition);
  resetClocks();
  if (sequence) {
    if (state.playing) {
      armSequenceAtCurrent({ audition: state.audio });
      startSequenceScheduler();
    } else {
      stopSequenceScheduler({ silence: true });
    }
  }
  paintTransport();
  if (!state.playing && !sequence) pool.setVoices([]);
  if (state.playing && !state.audio) {
    announce("Audio is off — turn it on to hear playback");
  } else {
    announce(`${sequence ? "Counterpoint weave" : "Slicing plane"} ${state.playing ? "playing" : "paused"}.`);
  }
  scheduleFrame();
});

$("directionButton").addEventListener("click", () => {
  if (sequenceModeActive()) return;
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
  const pointerTarget = sequenceModeActive() ? "form" : rotationTarget;
  if (pointerTarget === "form") {
    state.autoRotate = false;
    paintAutoRotate();
  }
  drag = {
    id: event.pointerId,
    target: pointerTarget,
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
  if (pointerTarget === "playhead") wakeManualSound(360);
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
  const sequence = sequenceModeActive();
  const amount = sequence
    ? (event.shiftKey ? 0.25 : 1 / MOEBIUS_SEQUENCE.stepsPerLap)
    : (event.shiftKey ? 0.06 : 0.0125);
  const sequenceNavigation = sequence
    && ["ArrowLeft", "ArrowRight", "Home"].includes(event.key);
  if (sequenceNavigation) {
    if (state.playing) setSequenceTransportAnchor(sequencePositionAt());
    stopSequenceScheduler({ silence: true });
  }
  let handled = true;
  if (event.key === "ArrowLeft") {
    state.continuousPosition -= amount;
    if (!sequence) wakeManualSound();
  } else if (event.key === "ArrowRight") {
    state.continuousPosition += amount;
    if (!sequence) wakeManualSound();
  } else if (!sequence && event.key === "ArrowUp") {
    state.planePitch = normalizeDegrees(state.planePitch + (event.shiftKey ? 12 : 3));
    wakeManualSound();
  } else if (!sequence && event.key === "ArrowDown") {
    state.planePitch = normalizeDegrees(state.planePitch - (event.shiftKey ? 12 : 3));
    wakeManualSound();
  } else if (!sequence && (
    event.code === "BracketLeft" || event.key === "[" || event.key === "{"
  )) {
    state.planeYaw = normalizeDegrees(state.planeYaw - (event.shiftKey ? 12 : 3));
    wakeManualSound();
  } else if (!sequence && (
    event.code === "BracketRight" || event.key === "]" || event.key === "}"
  )) {
    state.planeYaw = normalizeDegrees(state.planeYaw + (event.shiftKey ? 12 : 3));
    wakeManualSound();
  } else if (event.key === "Home") {
    state.continuousPosition += (sequence ? 0 : 0.5)
      - wrap01(state.continuousPosition);
    if (!sequence) wakeManualSound();
  } else {
    handled = false;
  }
  if (!handled) return;
  event.preventDefault();
  if (sequenceNavigation) {
    setSequenceTransportAnchor(state.continuousPosition);
    armSequenceAtCurrent();
    wakeManualSound();
    startSequenceScheduler();
  }
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
    const sequencePhase = sequenceModeActive() && state.playing
      ? sequencePositionAt()
      : state.continuousPosition;
    if (sequenceModeActive()) stopSequenceScheduler({ silence: true });
    Object.assign(state, preset);
    state.presetId = presetId;
    meshCacheKey = "";
    componentTracks = [];
    if (sequenceModeActive()) setSequenceTransportAnchor(sequencePhase);
    syncControls();
    if (sequenceModeActive()) {
      armSequenceAtCurrent();
      wakeManualSound(320);
      startSequenceScheduler();
    } else {
      wakeManualSound(320);
    }
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
  stopSequenceScheduler();
  pool.silence();
  resetClocks();
  syncControls();
  announce(`${PAGE.label} reset to its opening state. Audio ${audio ? "stays on" : "stays off"}.`);
  scheduleFrame();
});

async function toggleAudio() {
  $("audioError").hidden = true;
  if (state.audio) {
    audioRequestGeneration += 1;
    const sequencePhase = sequenceModeActive() && state.playing
      ? sequencePositionAt()
      : null;
    state.audio = false;
    if (sequencePhase !== null) setSequenceTransportAnchor(sequencePhase);
    stopSequenceScheduler();
    pool.disable();
    paintAudio();
    announce(`Audio off. The ${sequenceModeActive() ? "counterpoint weave" : "slicing plane"} transport is unchanged.`);
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
    const sequencePhase = sequenceModeActive() && state.playing
      ? sequencePositionAt()
      : null;
    pool.setLevel(state.level);
    state.audio = true;
    if (sequencePhase !== null) setSequenceTransportAnchor(sequencePhase);
    resetClocks();
    if (sequenceModeActive() && state.playing) {
      armSequenceAtCurrent();
      startSequenceScheduler();
    }
    paintAudio();
    announce(state.playing
      ? `Audio on. Joined the ${sequenceModeActive() ? "counterpoint weave at its next pulse" : "moving slice"}.`
      : `Audio on. ${sequenceModeActive() ? "Play or step the ribbon to hear its stations." : "Play or move the plane to hear its slice."}`);
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
    if (sequenceModeActive()) {
      state.continuousPosition = sequencePositionAt(now);
    } else {
      state.continuousPosition += state.direction * state.speed * delta;
    }
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
  if (sequenceModeActive()) {
    const sequence = currentSequenceFrame();
    drawScene(mesh, null, null, [], sequence);
    paintSequencePosition();
    if (
      lastSequencePass !== null
      && sequence.passIndex !== lastSequencePass
      && state.playing
    ) {
      announce(sequence.shadow
        ? "Pass 2: orientation B, shadow figure. Registers swap and intervals invert while time stays forward."
        : "Two-lap phrase complete. Pass 1 orientation is restored without reversing time.");
    }
    lastSequencePass = sequence.passIndex;
    const sequenceManualActive = now < manualSoundUntil;
    const sounding = state.audio && (
      state.playing
      || sequenceManualActive
      || pool.activeStrikeCount > 0
    );
    const audioReadout = state.audio
      ? `${sounding ? pool.activeStrikeCount : 0} ACTIVE STRIKES`
      : "AUDIO OFF";
    $("stageReadout").textContent = `${PAGE.shortLabel} / ${sequence.shadow ? "PASS 2 / ORIENTATION B / SHADOW" : "PASS 1 / ORIENTATION A"} / STEP ${String(sequence.stepIndex + 1).padStart(2, "0")}/16 / ${audioReadout}`;
    if (state.playing || state.autoRotate || sequenceManualActive) scheduleFrame();
    return;
  }
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
    if (sequenceModeActive() && state.playing) {
      setSequenceTransportAnchor(sequencePositionAt());
    }
    manualSoundUntil = 0;
    stopSequenceScheduler();
    pool.silence();
    return;
  }
  resetClocks();
  if (sequenceModeActive()) {
    setSequenceTransportAnchor(state.continuousPosition);
    if (state.playing) armSequenceAtCurrent();
    startSequenceScheduler();
  }
  scheduleFrame();
});

window.addEventListener("blur", () => {
  abandonDrag({ cancelAudition: true, silencePaused: true });
  scheduleFrame();
});

window.addEventListener("pagehide", (event) => {
  abandonDrag({ cancelAudition: true });
  if (sequenceModeActive() && state.playing) {
    setSequenceTransportAnchor(sequencePositionAt());
  }
  pageActive = false;
  audioRequestGeneration += 1;
  cancelAnimationFrame(scheduledFrame);
  scheduledFrame = 0;
  manualSoundUntil = 0;
  stopSequenceScheduler();
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
  if (sequenceModeActive()) {
    setSequenceTransportAnchor(state.continuousPosition);
    if (state.playing) armSequenceAtCurrent();
    startSequenceScheduler();
  }
  resetClocks();
  scheduleFrame();
});

syncControls();
paintAudio();
paintTarget();
scheduleFrame();

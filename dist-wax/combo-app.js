import {
  normalizeStrikeGains,
  pitch01ToFrequency,
  scaleShapeVoiceGains,
  synthParametersForMode,
  VoicePool,
} from "./src/audio.js";
import {
  cloneDefaultFmDrumVoices,
  FmDrumAudio,
} from "./src/fm-drums.js";
import {
  LINEAR_DRUM_PRESETS,
  LinearDrumAudio,
  linearDrumFrequencyAtPosition,
} from "./src/linear-drums.js";
import {
  buildShapesDivisionMarkers,
  buildShapesScene,
} from "./src/shapes-scene.js";
import {
  directedCornerEnvelopeProfile,
  shapes2dContactContourDirection,
} from "./src/geometry.js";
import {
  advanceShapesRhythmSample,
  createShapesRhythmSample,
} from "./src/shapes-rhythm.js";
import {
  advanceShapesMotion,
  createShapesState,
  displayShapesPhase,
  foldShapesPhase,
  projectShapesMotion,
  selectShapesBank,
  selectShapesDimension,
  selectShapesPlayingMode,
  setShapes2dHeadCount,
  setShapes2dHeadOffset,
  setShapesDivisionCount,
  shapes2dHeadCount,
  shapes2dHeadDirection,
  shapes2dHeadOffset,
  shapesDivisionCount,
  shapesEventIntervalMs,
  shapesEventRegionKeys,
  shapesRotationIsMoving,
  shapesRepresentationLabel,
  MAX_SHAPES_2D_HEADS,
  SHAPES_DIMENSIONS,
  SHAPES_STORAGE_KEY,
  SHAPES_TRIGGER_SOUND_BANKS,
} from "./src/shapes-state.js";

const TAU = Math.PI * 2;
const AUDIO_LOOKAHEAD_SECONDS = 0.075;
const AUDIO_UPDATE_INTERVAL_MS = 24;
const DISCRETE_SCHEDULER_INTERVAL_MS = 20;
const DISCRETE_SCHEDULER_LEAD_SECONDS = 0.012;
const DISCRETE_SAMPLE_INTERVAL_SECONDS = 1 / 256;
const DISCRETE_MAX_SAMPLES_PER_TICK = 32;
const DISCRETE_EVENT_RATE_LIMIT = Object.freeze({ notes: 96, triggers: 128 });
const CANVAS_PIXEL_BUDGET = 3_000_000;
const PLAYHEAD_COLORS = Object.freeze(["#69f2bd", "#78a7ff", "#cb8fff", "#e8c46b"]);
const TRIGGER_SOUND_BANK_BY_ID = new Map(
  SHAPES_TRIGGER_SOUND_BANKS.map((bank) => [bank.id, bank]),
);
const RATTLESNAKE_PRESET = LINEAR_DRUM_PRESETS.find(({ id }) => id === "natural-line")
  ?? LINEAR_DRUM_PRESETS[0];
const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const titleCase = (value) => `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

function loadState() {
  let persisted = {};
  try {
    persisted = JSON.parse(localStorage.getItem(SHAPES_STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    persisted = {};
  }
  const parameters = new URLSearchParams(window.location.search);
  const legacySound = parameters.get("sound");
  const routedPlayingMode = parameters.get("playing")
    ?? (legacySound === "drums"
      ? "triggers"
      : legacySound === "notes"
        ? "notes"
        : legacySound === "synth"
          ? "continuous"
          : null);
  const state = createShapesState({
    ...persisted,
    geometry: parameters.get("geometry") ?? persisted.geometry,
    sound: parameters.get("sound") ?? persisted.sound,
    selection: {
      ...(persisted.selection ?? {}),
      dimension: parameters.get("dimension")
        ?? parameters.get("geometry")
        ?? persisted.selection?.dimension,
      playingMode: routedPlayingMode ?? persisted.selection?.playingMode,
    },
  });
  // Browsers require a fresh user gesture; retain level but never auto-start.
  state.audio.enabled = false;
  return state;
}

let state = loadState();
const synthAudio = new VoicePool(32, { continuousPeakCeiling: 0.78 });
const drumAudio = new FmDrumAudio(globalThis);
const rattlesnakeAudio = new LinearDrumAudio(globalThis);
const drumVoices = cloneDefaultFmDrumVoices();
const canvas = $("stage");
const context = canvas.getContext("2d", { desynchronized: true });
const app = $("shapesApp");
const stageWrap = $("stageWrap");

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let animationFrame = 0;
let lastFrameTime = performance.now();
let lastAudioClockTime = null;
let lastUiUpdate = -Infinity;
let lastAudioUpdate = -Infinity;
const lastEventAtByVoice = new Map();
const lastEventRegions = { phase: null, geometry: null };
let discreteSchedulerTimer = 0;
let nextDiscreteSampleAt = null;
let previousDiscreteSampleAt = null;
let discreteRhythmSample = null;
let lastScheduledDiscreteEventAt = -Infinity;
let noteReleaseTimer = 0;
let lastScene = null;
let renderedRotationDimension = null;
let renderedMainFormDimension = null;
let saveTimer = 0;
let manualMotionUntil = 0;
let manualMotionClock = "geometry";
let pointerScrub = null;
let pointerRotation = null;
let audioRequest = 0;
const heldMidiNotes = new Set();

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => { $("liveStatus").textContent = message; });
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SHAPES_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The instrument remains fully usable when storage is unavailable.
    }
  }, 120);
}

function updateRoute() {
  const url = new URL(window.location.href);
  url.searchParams.set("dimension", state.selection.dimension);
  url.searchParams.set("playing", state.selection.playingMode);
  url.searchParams.delete("geometry");
  url.searchParams.delete("sound");
  history.replaceState(null, "", url);
}

function scheduleFrame() {
  if (!animationFrame) animationFrame = requestAnimationFrame(frame);
}

function clearDiscreteCursor() {
  nextDiscreteSampleAt = null;
  previousDiscreteSampleAt = null;
  discreteRhythmSample = null;
}

function invalidateDiscreteSchedule({ silence = false } = {}) {
  clearDiscreteCursor();
  lastScheduledDiscreteEventAt = -Infinity;
  lastEventAtByVoice.clear();
  if (!silence) return;
  synthAudio.silence();
  drumAudio.silence();
  rattlesnakeAudio.silence();
}

function resetEventClock() {
  lastEventRegions.phase = null;
  lastEventRegions.geometry = null;
  invalidateDiscreteSchedule({ silence: true });
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(bounds.width));
  const nextHeight = Math.max(1, Math.round(bounds.height));
  const pixelBudgetRatio = Math.sqrt(CANVAS_PIXEL_BUDGET / (nextWidth * nextHeight));
  const nextRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, pixelBudgetRatio));
  if (nextWidth === cssWidth && nextHeight === cssHeight && nextRatio === pixelRatio) return;
  cssWidth = nextWidth;
  cssHeight = nextHeight;
  pixelRatio = nextRatio;
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  scheduleFrame();
}

function sceneTransform(scene) {
  const bounds = scene.bounds;
  // The native Shape instrument keeps the model origin pinned to the stage
  // center. Re-centering an asymmetric polygon from its changing AABB makes a
  // rotating triangle appear to orbit even though its geometry rotates about
  // (0, 0). Keep 2D on a fixed, origin-centered transform; projected 3D/4D
  // scenes still use their fitted bounds.
  const fixedTwoDimensionalFrame = scene.dimension === "2d";
  const centerX = fixedTwoDimensionalFrame ? 0 : (bounds.minX + bounds.maxX) * 0.5;
  const centerY = fixedTwoDimensionalFrame ? 0 : (bounds.minY + bounds.maxY) * 0.5;
  const scale = fixedTwoDimensionalFrame
    ? Math.min(cssWidth, cssHeight) * 0.39
    : Math.min(cssWidth, cssHeight) * 0.72 / Math.max(0.2, bounds.span);
  const invertY = scene.dimension !== "2d";
  return {
    x: (value) => cssWidth * 0.5 + (value - centerX) * scale,
    y: (value) => cssHeight * 0.5 + (value - centerY) * scale * (invertY ? -1 : 1),
    scale,
  };
}

function drawReader(scene, transform) {
  const readers = scene.dimension === "2d" && Array.isArray(scene.readers)
    ? scene.readers
    : [scene.reader];
  for (const reader of readers) {
    if (!reader) continue;
    const readerColor = scene.dimension === "2d"
      ? PLAYHEAD_COLORS[(reader.headIndex ?? 0) % PLAYHEAD_COLORS.length]
      : SHAPES_DIMENSIONS[scene.dimension].color;
    context.save();
    context.strokeStyle = `color-mix(in srgb, ${readerColor} 55%, transparent)`;
    context.fillStyle = `color-mix(in srgb, ${readerColor} 9%, transparent)`;
    context.lineWidth = 1;
    context.setLineDash([5, 7]);
    if (reader.type === "line") {
      context.beginPath();
      if (reader.axis === "horizontal") {
        const y = transform.y(reader.y ?? reader.coordinate);
        context.moveTo(cssWidth * 0.12, y);
        context.lineTo(cssWidth * 0.88, y);
      } else {
        const x = transform.x(reader.x ?? reader.coordinate);
        context.moveTo(x, cssHeight * 0.12);
        context.lineTo(x, cssHeight * 0.88);
      }
      context.stroke();
    } else if (reader.type === "radar") {
      context.beginPath();
      context.moveTo(transform.x(0), transform.y(0));
      context.lineTo(
        transform.x(Math.cos(reader.angle) * 1.35),
        transform.y(Math.sin(reader.angle) * 1.35),
      );
      context.stroke();
    } else if (reader.type === "plane") {
      context.beginPath();
      reader.corners.forEach((point, index) => {
        if (index) context.lineTo(transform.x(point.x), transform.y(point.y));
        else context.moveTo(transform.x(point.x), transform.y(point.y));
      });
      context.closePath();
      context.fill();
      context.stroke();
    } else if (reader.type === "hyperplane") {
      const y = cssHeight * (0.5 - reader.offset * 0.06);
      const gradient = context.createLinearGradient(0, y, cssWidth, y);
      gradient.addColorStop(0, "rgba(203,143,255,0)");
      gradient.addColorStop(0.5, "rgba(203,143,255,.48)");
      gradient.addColorStop(1, "rgba(203,143,255,0)");
      context.strokeStyle = gradient;
      context.beginPath();
      context.moveTo(cssWidth * 0.13, y);
      context.lineTo(cssWidth * 0.87, y);
      context.stroke();
    }
    context.restore();
  }
}

function drawDivisionMarkers(scene, transform) {
  const markers = buildShapesDivisionMarkers(scene, shapesDivisionCount(state));
  if (!markers.length) return;
  const color = SHAPES_DIMENSIONS[scene.dimension].color;
  const tickRadius = scene.dimension === "2d" ? 5 : 3.5;
  context.save();
  context.beginPath();
  for (const marker of markers) {
    const x = transform.x(marker.view.x);
    const y = transform.y(marker.view.y);
    const tangentX = transform.x(marker.view.x + marker.tangent.x) - x;
    const tangentY = transform.y(marker.view.y + marker.tangent.y) - y;
    const length = Math.hypot(tangentX, tangentY);
    if (length < 8) continue;
    const normalX = -tangentY / length;
    const normalY = tangentX / length;
    context.moveTo(x - normalX * tickRadius, y - normalY * tickRadius);
    context.lineTo(x + normalX * tickRadius, y + normalY * tickRadius);
  }
  context.strokeStyle = `color-mix(in srgb, ${color} 68%, #fff3d6)`;
  context.lineWidth = scene.dimension === "2d" ? 1.25 : 1;
  context.lineCap = "round";
  context.stroke();
  context.restore();
}

function drawScene(scene) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  const transform = sceneTransform(scene);
  const color = SHAPES_DIMENSIONS[scene.dimension].color;

  if (scene.dimension === "2d" && scene.closed && scene.vertices.length) {
    context.beginPath();
    scene.vertices.forEach((point, index) => {
      if (index) context.lineTo(transform.x(point.x), transform.y(point.y));
      else context.moveTo(transform.x(point.x), transform.y(point.y));
    });
    context.closePath();
    context.fillStyle = `color-mix(in srgb, ${color} 4%, transparent)`;
    context.fill();
  }

  drawReader(scene, transform);
  const edges = [...scene.edges].sort((left, right) => (left.depth ?? 0) - (right.depth ?? 0));
  for (const edge of edges) {
    const alpha = scene.dimension === "2d"
      ? 0.9
      : clamp(0.34 + ((edge.depth ?? 0) + 1) * 0.18, 0.22, 0.84);
    context.beginPath();
    context.moveTo(transform.x(edge.a.x), transform.y(edge.a.y));
    context.lineTo(transform.x(edge.b.x), transform.y(edge.b.y));
    context.strokeStyle = edge.axis === "w"
      ? `rgba(203,143,255,${Math.max(0.48, alpha)})`
      : `rgba(232,196,107,${alpha})`;
    context.lineWidth = edge.axis === "w" ? 1.35 : scene.dimension === "2d" ? 1.55 : 1.05;
    if (edge.axis === "w") context.setLineDash([3, 4]);
    context.stroke();
    context.setLineDash([]);
  }

  drawDivisionMarkers(scene, transform);

  const visibleVertices = scene.dimension === "2d"
    ? (scene.vertexIndices ?? []).map((index) => scene.vertices[index]).filter(Boolean)
    : scene.vertices;
  const vertexStride = Math.max(1, Math.ceil(visibleVertices.length / 180));
  for (let index = 0; index < visibleVertices.length; index += vertexStride) {
    const point = visibleVertices[index];
    context.beginPath();
    context.arc(transform.x(point.x), transform.y(point.y), scene.dimension === "2d" ? 2.4 : 2, 0, TAU);
    context.fillStyle = "#07090b";
    context.fill();
    context.strokeStyle = `color-mix(in srgb, ${color} 68%, transparent)`;
    context.lineWidth = 1;
    context.stroke();
  }

  for (const contact of scene.contacts) {
    const point = contact.view;
    const x = transform.x(point.x);
    const y = transform.y(point.y);
    context.save();
    const contactColor = scene.dimension === "2d"
      ? PLAYHEAD_COLORS[(contact.headIndex ?? 0) % PLAYHEAD_COLORS.length]
      : color;
    context.shadowColor = contactColor;
    context.shadowBlur = 18;
    context.beginPath();
    context.arc(x, y, 5.2, 0, TAU);
    context.fillStyle = "#fff3d6";
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = contactColor;
    context.lineWidth = 1.3;
    context.stroke();
    context.restore();
  }
}

function evenlySelect(items, limit) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) => (
    items[Math.floor(index * items.length / limit)]
  ));
}

function twoDimensionalMotionDirection(contact, sourceState) {
  const reader = sourceState.dimension["2d"].reader;
  const headIndex = contact.headIndex ?? 0;
  const relativeDirection = reader === "line"
    ? 1
    : shapes2dHeadDirection(sourceState, headIndex, reader);
  const intendedDirection = sourceState.play.direction * relativeDirection;
  if (sourceState.play.motion !== "pingpong") return intendedDirection;

  const travel = Number.isFinite(contact.headTravel)
    ? contact.headTravel
    : sourceState.play.continuousPhase;
  const step = intendedDirection * 1e-5;
  const before = foldShapesPhase(travel, "pingpong");
  const after = foldShapesPhase(travel + step, "pingpong");
  const delta = after - before;
  return Math.abs(delta) > 1e-9 ? Math.sign(delta) : intendedDirection;
}

function twoDimensionalContourDirection(contact, sourceState) {
  const local = sourceState.dimension["2d"];
  const intendedPhaseDirection = twoDimensionalMotionDirection(contact, sourceState);
  return shapes2dContactContourDirection(contact, {
    reader: local.reader,
    // The original envelope keeps one unit of reader intent while stopped so
    // shape-only rotation is still resolved relative to each intersection.
    phaseRate: sourceState.play.running
      ? intendedPhaseDirection * sourceState.play.rateCyclesPerSecond
      : intendedPhaseDirection,
    rotationRate: local.rotationRunning ? local.rotationSpeed : 0,
    intendedPhaseDirection,
  });
}

function synthSpecs(scene, { baseHz = state.voice.baseHz, sourceState = state } = {}) {
  const mode = sourceState.voice.engine;
  const character = sourceState.voice.character;
  const contacts = scene.dimension === "4d"
    ? evenlySelect(scene.contacts, 20)
    : scene.contacts.slice(0, 32);
  const originalShapeEnvelope = sourceState.selection.playingMode === "continuous"
    && scene.dimension === "2d";
  const specs = contacts.map((contact, index) => {
    let gain = 0.035 + contact.strength * 0.085;
    if (originalShapeEnvelope) {
      if (scene.geometry?.shapeType === "circle") {
        gain = 0.12;
      } else {
        const profile = directedCornerEnvelopeProfile(
          scene.geometry,
          contact,
          twoDimensionalContourDirection(contact, sourceState),
        );
        const envelope = 1 - clamp(profile.phase, 0, 1);
        gain = (0.18 + 0.5 * clamp(profile.strength, 0, 1)) * envelope;
      }
    }
    return {
      key: contact.voiceKey ?? `${scene.dimension}:${index}`,
      frequency: pitch01ToFrequency(contact.pitch01, baseHz, sourceState.voice.rangeOctaves),
      gain,
      pan: contact.pan * sourceState.voice.spread,
      waveform: mode === "sine" || mode === "shepard" ? "sine" : mode === "fm" ? "triangle" : "sawtooth",
      ...synthParametersForMode(mode, contact.drive01 * (0.25 + character * 0.75), {
        fmIndex: 1 + character * 9,
        fmRatio: 1 + character * 3,
        pmIndex: 0.4 + character * 5.5,
        pmRatio: 0.5 + character * 2.5,
        shepardRate: sourceState.play.running
          ? sourceState.play.rateCyclesPerSecond * sourceState.play.direction
          : 0,
        shepardWidth: 2 + character * 5,
        shepardPosition: displayShapesPhase(sourceState),
      }),
    };
  });
  return originalShapeEnvelope ? scaleShapeVoiceGains(specs) : specs;
}

function releaseNoteVoices() {
  clearTimeout(noteReleaseTimer);
  noteReleaseTimer = 0;
  synthAudio.setVoices([]);
}

function emitNotes(scene, {
  frequency = null,
  velocity = 1,
  hold = false,
  startAt = null,
} = {}) {
  const centeredBase = Number.isFinite(frequency)
    ? frequency / (2 ** (state.voice.rangeOctaves * 0.5))
    : state.voice.baseHz;
  const level = clamp(Number(velocity) || 0, 0.05, 1);
  const requested = synthSpecs(scene, { baseHz: centeredBase }).slice(0, 8).map((spec) => ({
    ...spec,
    gain: (0.18 + spec.gain) * level,
  }));
  const specs = normalizeStrikeGains(requested, 0.68);
  if (!specs.length) return;
  const eventInterval = shapesEventIntervalMs(state, specs.length);
  const duration = Math.max(42, eventInterval * (0.62 + state.voice.character * 0.12));
  if (Number.isFinite(startAt)) {
    specs.forEach((spec) => synthAudio.strike(spec, {
      attackSeconds: 0.004,
      decaySeconds: duration / 1000,
      startAt,
      retriggerMode: "crossfade",
    }));
    return;
  }
  synthAudio.setVoices(specs, { mode: state.voice.engine });
  clearTimeout(noteReleaseTimer);
  noteReleaseTimer = 0;
  if (hold) return;
  noteReleaseTimer = setTimeout(() => {
    noteReleaseTimer = 0;
    if (state.selection.playingMode === "notes") synthAudio.setVoices([]);
  }, duration);
}

function triggerVoiceIndex(contact, index) {
  if (state.trigger.mapping === "position") {
    const row = Math.min(3, Math.floor(contact.pitch01 * 4));
    const column = Math.min(3, Math.floor((contact.pan + 1) * 2));
    return row * 4 + column;
  }
  if (state.trigger.mapping === "incidence") {
    return Math.min(15, Math.floor(contact.drive01 * 16));
  }
  return Math.abs(Math.trunc(contact.edgeIndex ?? contact.segmentIndex ?? index)) % 16;
}

function rattlesnakeFrequencyForContact(contact) {
  const depth = clamp(state.trigger.tuningDepth / 12, 0, 2);
  const position = clamp(0.5 + (contact.pitch01 - 0.5) * depth, 0, 1);
  return linearDrumFrequencyAtPosition(
    position,
    RATTLESNAKE_PRESET.settings.rangeMin,
    RATTLESNAKE_PRESET.settings.rangeMax,
  );
}

function rattlesnakeSettingsForContact(contact) {
  const amount = (contact.drive01 - 0.5) * 2 * state.trigger.characterDepth;
  return {
    ...RATTLESNAKE_PRESET.settings,
    brightness: clamp(RATTLESNAKE_PRESET.settings.brightness + amount * 0.28, 0, 1),
    inharmonicity: clamp(RATTLESNAKE_PRESET.settings.inharmonicity + amount * 0.24, 0, 1),
    hardness: clamp(RATTLESNAKE_PRESET.settings.hardness + amount * 0.26, 0, 1),
    strikeNoise: clamp(RATTLESNAKE_PRESET.settings.strikeNoise + amount * 0.35, 0, 1.6),
  };
}

function emitTriggers(scene, {
  hitLimit = state.trigger.hitCap,
  velocity = 1,
  startAt = null,
} = {}) {
  const hitCap = Math.max(1, Math.min(state.trigger.hitCap, Math.round(hitLimit)));
  const velocityGain = clamp(Number(velocity) || 0, 0.05, 1);
  if (state.trigger.soundBank === "rattlesnake") {
    scene.contacts.slice(0, hitCap).forEach((contact) => {
      const strikeVelocity = (0.68 + contact.strength * 0.32) * velocityGain;
      rattlesnakeAudio.trigger(
        rattlesnakeFrequencyForContact(contact),
        rattlesnakeSettingsForContact(contact),
        {
          engine: "rattlesnake",
          velocity: strikeVelocity,
          performanceY: contact.drive01,
          ...(Number.isFinite(startAt) ? { startAt } : {}),
        },
      ).catch(() => {});
    });
    return;
  }
  scene.contacts.slice(0, hitCap).forEach((contact, index) => {
    const baseVoice = drumVoices[triggerVoiceIndex(contact, index) % drumVoices.length];
    const semitones = (contact.pitch01 - 0.5) * state.trigger.tuningDepth;
    const character = state.trigger.characterDepth;
    const voice = {
      ...baseVoice,
      frequency: baseVoice.frequency * 2 ** (semitones / 12),
      modIndex: baseVoice.modIndex * (0.55 + character * 0.9),
      noise: clamp(baseVoice.noise + (contact.drive01 - 0.5) * character * 0.35, 0, 1),
      tone: clamp(baseVoice.tone + (contact.pan * 0.16 * character), 0, 1),
      level: baseVoice.level * (0.68 + contact.strength * 0.32) * velocityGain,
    };
    drumAudio.trigger(voice, Number.isFinite(startAt) ? { startAt } : undefined).catch(() => {});
  });
}

function transportIsMoving() {
  return state.play.running && Math.abs(state.play.rateCyclesPerSecond) > 1e-6;
}

function rotationIsMoving() {
  return shapesRotationIsMoving(state);
}

function motionIsActive(now = performance.now()) {
  return transportIsMoving()
    || rotationIsMoving()
    || pointerScrub !== null
    || pointerRotation !== null
    || now < manualMotionUntil;
}

function eventClock(now = performance.now()) {
  return transportIsMoving()
    || pointerScrub !== null
    || (now < manualMotionUntil && manualMotionClock === "phase")
    ? "phase"
    : "geometry";
}

function markManualMotion(clock = "geometry", duration = 100) {
  manualMotionClock = clock;
  manualMotionUntil = performance.now() + duration;
  invalidateDiscreteSchedule({ silence: true });
}

function activeAudioContext() {
  if (!state.audio.enabled) return null;
  if (state.selection.playingMode !== "triggers") return synthAudio.context;
  return state.trigger.soundBank === "rattlesnake"
    ? rattlesnakeAudio.context
    : drumAudio.context;
}

function resetTransportClocks() {
  lastFrameTime = performance.now();
  lastAudioClockTime = activeAudioContext()?.currentTime ?? null;
  lastAudioUpdate = -Infinity;
  invalidateDiscreteSchedule({ silence: true });
}

function transportDeltaSeconds(now) {
  const performanceDelta = Math.max(0, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  const audioContext = activeAudioContext();
  const audioTime = audioContext?.state === "running" ? audioContext.currentTime : null;
  const audioDelta = Number.isFinite(audioTime)
    && Number.isFinite(lastAudioClockTime)
    && audioTime >= lastAudioClockTime
    ? audioTime - lastAudioClockTime
    : 0;
  lastAudioClockTime = Number.isFinite(audioTime) ? audioTime : null;
  // Prefer the render clock once it advances; retain monotonic visual timing
  // for suspended/test contexts and clamp long background-tab jumps.
  return audioDelta > 1e-6
    ? Math.min(0.25, audioDelta)
    : Math.min(0.1, performanceDelta);
}

function forecastScene(seconds = AUDIO_LOOKAHEAD_SECONDS) {
  const projectedState = projectShapesMotion(state, seconds);
  return {
    scene: buildShapesScene(projectedState),
    state: projectedState,
  };
}

function automaticMotionIsActive() {
  return transportIsMoving() || rotationIsMoving();
}

function manualDiscreteMotionIsActive(now = performance.now()) {
  return pointerScrub !== null || pointerRotation !== null || now < manualMotionUntil;
}

function eligibleDiscreteScene(scene, eventTimeSeconds) {
  const mode = state.selection.playingMode;
  const minimumIntervalSeconds = mode === "triggers" ? 0.012 : 0.016;
  const contacts = scene.contacts.filter((contact, index) => {
    const debounceKey = mode === "triggers"
      ? state.trigger.soundBank === "fm-kit"
        ? `trigger:fm-kit:${triggerVoiceIndex(contact, index)}`
        : `trigger:rattlesnake:${contact.voiceKey ?? contact.eventKey ?? index}`
      : `note:${contact.voiceKey ?? contact.eventKey ?? index}`;
    const lastEventAt = lastEventAtByVoice.get(debounceKey) ?? -Infinity;
    if (eventTimeSeconds - lastEventAt < minimumIntervalSeconds) return false;
    lastEventAtByVoice.set(debounceKey, eventTimeSeconds);
    return true;
  });
  return contacts.length ? { ...scene, contacts } : null;
}

function scheduleDiscreteScene(scene, startAt) {
  const eligible = eligibleDiscreteScene(scene, startAt);
  if (!eligible) return false;
  if (state.selection.playingMode === "notes") emitNotes(eligible, { startAt });
  else emitTriggers(eligible, { startAt });
  return true;
}

function runDiscreteScheduler() {
  const mode = state.selection.playingMode;
  if (
    !state.audio.enabled
    || document.hidden
    || mode === "continuous"
    || !automaticMotionIsActive()
    || manualDiscreteMotionIsActive()
    || (mode === "notes" && heldMidiNotes.size)
  ) {
    clearDiscreteCursor();
    return;
  }
  const audioContext = activeAudioContext();
  if (!audioContext || audioContext.state !== "running") {
    clearDiscreteCursor();
    return;
  }

  const delta = transportDeltaSeconds(performance.now());
  if (delta > 0) advanceShapesMotion(state, delta);

  const audioNow = audioContext.currentTime;
  const horizon = audioNow + AUDIO_LOOKAHEAD_SECONDS;
  if (
    !Number.isFinite(nextDiscreteSampleAt)
    || nextDiscreteSampleAt <= audioNow
    || nextDiscreteSampleAt > horizon + DISCRETE_SAMPLE_INTERVAL_SECONDS
  ) {
    const seedState = projectShapesMotion(state, 0);
    discreteRhythmSample = createShapesRhythmSample(seedState);
    previousDiscreteSampleAt = audioNow;
    nextDiscreteSampleAt = audioNow + DISCRETE_SAMPLE_INTERVAL_SECONDS;
  }

  // Sampling occurs on a persistent AudioContext-time grid, so JavaScript
  // timer jitter changes only how many fixed samples this callback consumes,
  // never which geometry states define the rhythm.
  const events = [];
  let samples = 0;
  while (
    nextDiscreteSampleAt <= horizon + 1e-9
    && samples < DISCRETE_MAX_SAMPLES_PER_TICK
  ) {
    const sampleAt = nextDiscreteSampleAt;
    const sampledState = projectShapesMotion(state, sampleAt - audioNow);
    const advanced = advanceShapesRhythmSample(discreteRhythmSample, sampledState);
    discreteRhythmSample = advanced.sample;
    if (advanced.event) {
      const intervalStart = previousDiscreteSampleAt;
      events.push({
        ...advanced.event,
        startAt: intervalStart
          + (sampleAt - intervalStart) * advanced.event.time01,
      });
    }
    previousDiscreteSampleAt = sampleAt;
    nextDiscreteSampleAt += DISCRETE_SAMPLE_INTERVAL_SECONDS;
    samples += 1;
  }

  const minimumEventSpacing = 1 / DISCRETE_EVENT_RATE_LIMIT[mode];
  const schedulableAfter = audioContext.currentTime + DISCRETE_SCHEDULER_LEAD_SECONDS;
  for (const event of events) {
    const { startAt } = event;
    // Never collapse overdue crossings onto `currentTime`; a late burst sounds
    // like a broken clock and competes with the audio renderer. The following
    // look-ahead window resumes on the same absolute timeline.
    if (startAt < schedulableAfter) continue;
    // Preserve every crossing at normal musical densities while applying a
    // deterministic ceiling to pathological 4D × 16-division combinations.
    if (startAt - lastScheduledDiscreteEventAt < minimumEventSpacing) continue;
    if (scheduleDiscreteScene(event.scene, startAt)) {
      lastScheduledDiscreteEventAt = startAt;
    }
  }
  scheduleFrame();
}

function stopDiscreteScheduler() {
  clearInterval(discreteSchedulerTimer);
  discreteSchedulerTimer = 0;
  clearDiscreteCursor();
}

function syncDiscreteScheduler() {
  const shouldRun = state.audio.enabled
    && !document.hidden
    && state.selection.playingMode !== "continuous";
  if (!shouldRun) {
    stopDiscreteScheduler();
    return;
  }
  if (!discreteSchedulerTimer) {
    discreteSchedulerTimer = setInterval(runDiscreteScheduler, DISCRETE_SCHEDULER_INTERVAL_MS);
  }
  runDiscreteScheduler();
}

function updateAudio(scene, now) {
  if (!state.audio.enabled || document.hidden) return;
  const mode = state.selection.playingMode;
  if (heldMidiNotes.size && mode !== "triggers") return;
  if (mode === "continuous") {
    const moving = motionIsActive(now);
    if (moving && now - lastAudioUpdate < AUDIO_UPDATE_INTERVAL_MS) return;
    if (!moving) synthAudio.setVoices([], { mode: state.voice.engine });
    else {
      const future = forecastScene();
      synthAudio.setVoiceTrajectory(
        synthSpecs(scene),
        synthSpecs(future.scene, { sourceState: future.state }),
        AUDIO_LOOKAHEAD_SECONDS,
        { mode: state.voice.engine },
      );
    }
    lastAudioUpdate = now;
    return;
  }
  // Automatic Notes/Triggers are scheduled ahead on the AudioContext clock.
  // Keep this immediate path only for direct scrubbing while transport and
  // automatic rotation are stopped, matching the originals' tactile preview.
  if (automaticMotionIsActive() && !manualDiscreteMotionIsActive(now)) return;
  const clock = eventClock(now);
  const otherClock = clock === "phase" ? "geometry" : "phase";
  const regionKeys = shapesEventRegionKeys(scene);
  const regionSet = new Set(regionKeys);
  lastEventRegions[otherClock] = new Set(regionKeys);
  const previousRegions = lastEventRegions[clock];
  // Consume the visible state before applying the rate limit. A boundary that
  // is intentionally skipped must never replay late against unrelated graphics.
  lastEventRegions[clock] = regionSet;
  if (!motionIsActive(now) || previousRegions === null) {
    return;
  }
  const enteredKeys = new Set(regionKeys.filter((key) => !previousRegions.has(key)));
  if (!enteredKeys.size) return;
  const enteredContacts = scene.contacts.filter((contact, index) => (
    enteredKeys.has(contact.eventKey ?? contact.voiceKey ?? `contact:${index}`)
  ));
  if (!enteredContacts.length) return;
  const audioContext = activeAudioContext();
  const startAt = (audioContext?.currentTime ?? 0) + 0.003;
  scheduleDiscreteScene({ ...scene, contacts: enteredContacts }, startAt);
}

function syncFastUi(scene) {
  const phase = displayShapesPhase(state);
  $("position").value = String(phase);
  $("positionOut").textContent = `${(phase * 100).toFixed(1)}%`;
  $("phaseReadout").textContent = phase.toFixed(3);
  $("contactReadout").textContent = String(scene.contacts.length);
  const moving = transportIsMoving() || rotationIsMoving();
  const modeLabel = titleCase(state.selection.playingMode);
  const audioLabel = state.audio.enabled ? "AUDIO ON" : "AUDIO OFF";
  const divisions = shapesDivisionCount(state);
  const divisionLabel = state.selection.playingMode === "continuous"
    ? ""
    : ` · ${divisions} DIVISION${divisions === 1 ? "" : "S"}`;
  $("stageReadout").textContent = `${scene.contacts.length} CONTACT${scene.contacts.length === 1 ? "" : "S"} · ${moving ? "MOVING" : "PAUSED"}${divisionLabel} · ${audioLabel}`;
  $("routeReadout").textContent = `${SHAPES_DIMENSIONS[state.selection.dimension].label} · ${modeLabel}`;
  $("engineReadout").textContent = state.selection.playingMode === "triggers"
    ? TRIGGER_SOUND_BANK_BY_ID.get(state.trigger.soundBank)?.label ?? "Rattlesnake"
    : titleCase(state.voice.engine);
  syncRotationControlValues();
  syncLiveKnobValues();
}

function frame(now) {
  animationFrame = 0;
  const delta = transportDeltaSeconds(now);
  advanceShapesMotion(state, delta);
  const scene = buildShapesScene(state);
  lastScene = scene;
  drawScene(scene);
  updateAudio(scene, now);
  const moving = motionIsActive(now);
  if (!moving || now - lastUiUpdate >= 60) {
    syncFastUi(scene);
    lastUiUpdate = now;
  }
  if (moving) {
    scheduleFrame();
  }
}

async function prepareActiveAudio() {
  const request = ++audioRequest;
  if (state.selection.playingMode === "triggers") {
    if (state.trigger.soundBank === "rattlesnake") await rattlesnakeAudio.start();
    else await drumAudio.start();
  } else {
    await synthAudio.enable();
  }
  if (request !== audioRequest || !state.audio.enabled) return;
  synthAudio.setLevel(state.audio.level);
  drumAudio.setOutput(state.audio.level * 0.9);
  const triggerMode = state.selection.playingMode === "triggers";
  const rattlesnakeMode = triggerMode && state.trigger.soundBank === "rattlesnake";
  const fmKitMode = triggerMode && state.trigger.soundBank === "fm-kit";
  synthAudio.setHostGain(triggerMode ? 0 : 1, 45);
  drumAudio.setHostGain(fmKitMode ? 1 : 0, 45);
  rattlesnakeAudio.setOutput(rattlesnakeMode ? state.audio.level * 0.85 : 0);
  if (!rattlesnakeMode) rattlesnakeAudio.silence();
  resetTransportClocks();
  syncDiscreteScheduler();
  scheduleFrame();
}

async function setAudioEnabled(enabled) {
  const button = $("audioButton");
  state.audio.enabled = Boolean(enabled);
  button.disabled = state.audio.enabled;
  button.dataset.audioState = state.audio.enabled ? "starting" : "off";
  syncAudioUi();
  if (!state.audio.enabled) {
    audioRequest += 1;
    stopDiscreteScheduler();
    clearTimeout(noteReleaseTimer);
    noteReleaseTimer = 0;
    synthAudio.disable();
    drumAudio.silence();
    drumAudio.setHostGain(0, 30);
    rattlesnakeAudio.silence();
    rattlesnakeAudio.setOutput(0);
    resetTransportClocks();
    button.disabled = false;
    queueSave();
    scheduleFrame();
    return;
  }
  try {
    await prepareActiveAudio();
    if (!state.audio.enabled) return;
    resetEventClock();
    syncDiscreteScheduler();
    button.dataset.audioState = "on";
  } catch (error) {
    state.audio.enabled = false;
    stopDiscreteScheduler();
    synthAudio.disable();
    drumAudio.silence();
    drumAudio.setHostGain(0);
    rattlesnakeAudio.silence();
    rattlesnakeAudio.setOutput(0);
    button.dataset.audioState = "error";
    announce(error?.message ?? "Audio could not start.");
  } finally {
    button.disabled = false;
    syncAudioUi();
    queueSave();
  }
}

function syncAudioUi() {
  const button = $("audioButton");
  button.setAttribute("aria-pressed", String(state.audio.enabled));
  $("audioState").textContent = button.dataset.audioState === "starting"
    ? "starting"
    : state.audio.enabled ? "on" : "off";
  $("level").value = String(state.audio.level);
  $("levelOut").textContent = `${Math.round(state.audio.level * 100)}%`;
}

const FORM_OPTIONS = Object.freeze({
  "2d": Object.freeze([
    ["polygon", "Polygon"], ["star", "Star"], ["circle", "Circle"], ["line", "Open line"],
  ]),
  "3d": Object.freeze([
    ["profile", "Shared profile prism"], ["cube", "Cube"], ["pyramid", "Pyramid"],
    ["octahedron", "Octahedron"], ["prism", "Triangular prism"], ["cone", "Cone"],
    ["cylinder", "Cylinder"], ["sphere", "Sphere"], ["torus", "Torus"],
  ]),
  "4d": Object.freeze([
    ["profile", "Shared profile hyperprism"], ["tesseract", "Tesseract"],
    ["hypersphere", "Hypersphere"], ["hyperpyramid", "Hyperpyramid"], ["klein", "Klein bottle"],
  ]),
});

function twoDimensionalFormValue() {
  if (state.profile.sides === 1) return "circle";
  if (state.profile.sides === 2) return "line";
  return state.profile.kind === "star" ? "star" : "polygon";
}

function setProfileKind(kind) {
  if (kind === "circle") {
    state.profile.sides = 1;
    state.profile.kind = "circle";
  } else if (kind === "line") {
    state.profile.sides = 2;
    state.profile.kind = "line";
  } else {
    if (state.profile.sides < 3) state.profile.sides = 4;
    state.profile.kind = kind === "star" ? "star" : "polygon";
  }
}

function populateMainForm() {
  const dimension = state.selection.dimension;
  if (renderedMainFormDimension !== dimension) {
    $("mainFormSelect").replaceChildren(...FORM_OPTIONS[dimension].map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    renderedMainFormDimension = dimension;
  }
  $("mainFormSelect").value = dimension === "2d"
    ? twoDimensionalFormValue()
    : state.dimension[dimension].representation;
}

function updateHeadMarker(marker, offset) {
  const wrapped = ((Number(offset) % 1) + 1) % 1;
  marker.style.setProperty("--head-offset", String(wrapped));
  marker.setAttribute("aria-valuenow", wrapped.toFixed(4));
  marker.setAttribute("aria-valuetext", `${Math.round(wrapped * 100)}% of the reader cycle`);
  marker.title = `Playhead ${Number(marker.dataset.headIndex) + 1} · ${Math.round(wrapped * 100)}%`;
}

function setHeadMarkerFromPointer(marker, event) {
  const bounds = $("headLayoutTrack").getBoundingClientRect();
  const offset = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 0.9999);
  setShapes2dHeadOffset(state, Number(marker.dataset.headIndex), offset);
  updateHeadMarker(marker, offset);
  markManualMotion("phase", 120);
  queueSave();
  scheduleFrame();
}

function installHeadMarkerInteraction(marker) {
  let pointerId = null;
  marker.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    pointerId = event.pointerId;
    marker.setPointerCapture?.(event.pointerId);
    setHeadMarkerFromPointer(marker, event);
  });
  marker.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    setHeadMarkerFromPointer(marker, event);
  });
  const finish = (event) => {
    if (pointerId !== event.pointerId) return;
    pointerId = null;
    resetEventClock();
    queueSave();
    scheduleFrame();
  };
  marker.addEventListener("pointerup", finish);
  marker.addEventListener("pointercancel", finish);
  marker.addEventListener("keydown", (event) => {
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = Number(marker.dataset.headIndex);
    const current = shapes2dHeadOffset(state, index);
    const next = event.key === "Home"
      ? 0
      : event.key === "End" ? 0.9999
      : current + direction * (event.shiftKey ? 0.05 : 0.01);
    setShapes2dHeadOffset(state, index, next);
    resetEventClock();
    afterMutation({ announceMessage: `Playhead ${index + 1} spacing ${Math.round(shapes2dHeadOffset(state, index) * 100)} percent.` });
  });
}

function syncPlayheadControls() {
  const count = shapes2dHeadCount(state);
  $("playheadCountOut").textContent = String(count);
  $("removePlayhead").disabled = count <= 1;
  $("addPlayhead").disabled = count >= MAX_SHAPES_2D_HEADS;
  $("playheadStepper").setAttribute("aria-label", `${count} playhead${count === 1 ? "" : "s"}`);
  const layout = $("headLayoutControl");
  layout.setAttribute("aria-disabled", "false");
  $("resetHeadSpacing").disabled = count <= 1;

  const track = $("headLayoutTrack");
  const focusedIndex = Number(document.activeElement?.dataset?.headIndex);
  const markers = Array.from({ length: count }, (_, index) => {
    const marker = document.createElement("button");
    marker.className = "shapes-head-marker";
    marker.type = "button";
    marker.id = `headMarker${index}`;
    marker.dataset.headIndex = String(index);
    marker.style.setProperty("--head-color", PLAYHEAD_COLORS[index % PLAYHEAD_COLORS.length]);
    marker.setAttribute("role", "slider");
    marker.setAttribute("aria-label", `Playhead ${index + 1} relative phase`);
    marker.setAttribute("aria-valuemin", "0");
    marker.setAttribute("aria-valuemax", "1");
    marker.innerHTML = `<span>${index + 1}</span>`;
    updateHeadMarker(marker, shapes2dHeadOffset(state, index));
    installHeadMarkerInteraction(marker);
    return marker;
  });
  track.replaceChildren(...markers);
  if (Number.isInteger(focusedIndex) && markers[focusedIndex]) markers[focusedIndex].focus();
}

const knobConfigurations = new Map();

function configureKnob(slot, { label, minimum, maximum, step, value, format, set }) {
  const button = $(`liveKnob${slot}`);
  const configuration = { label, minimum, maximum, step, format, set };
  knobConfigurations.set(button, configuration);
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-valuemin", String(minimum));
  button.setAttribute("aria-valuemax", String(maximum));
  $(`liveKnob${slot}Label`).textContent = label;
  paintKnob(button, value, configuration);
}

function paintKnob(button, value, configuration = knobConfigurations.get(button)) {
  if (!configuration) return;
  const safe = clamp(Number(value) || 0, configuration.minimum, configuration.maximum);
  const ratio = (safe - configuration.minimum) / Math.max(1e-9, configuration.maximum - configuration.minimum);
  const angle = -135 + ratio * 270;
  button.style.setProperty("--knob-angle", `${angle}deg`);
  button.style.setProperty("--knob-fill", `${ratio * 75}%`);
  button.setAttribute("aria-valuenow", String(safe));
  button.setAttribute("aria-valuetext", configuration.format(safe));
  const slot = button.id.at(-1);
  $(`liveKnob${slot}Out`).textContent = configuration.format(safe);
}

function configureLiveKnobs() {
  const dimension = state.selection.dimension;
  if (dimension === "2d") {
    const local = state.dimension["2d"];
    configureKnob("A", { label: "Angle", minimum: -180, maximum: 180, step: 1, value: local.rotation, format: (value) => `${Math.round(value)}°`, set: (value) => { local.rotation = value; } });
    configureKnob("B", { label: "Sides", minimum: 1, maximum: 32, step: 1, value: state.profile.sides, format: (value) => String(Math.round(value)), set: (value) => { state.profile.sides = Math.round(value); state.profile.kind = state.profile.sides === 1 ? "circle" : state.profile.sides === 2 ? "line" : state.profile.kind === "star" ? "star" : "polygon"; } });
    configureKnob("C", { label: "Roundness", minimum: -1, maximum: 1, step: 0.01, value: local.curvature, format: (value) => `${Math.round(value * 100)}%`, set: (value) => { local.curvature = value; } });
  } else if (dimension === "3d") {
    const local = state.dimension["3d"];
    configureKnob("A", { label: "Surface yaw", minimum: -180, maximum: 180, step: 1, value: local.readerYaw, format: (value) => `${Math.round(value)}°`, set: (value) => { local.readerYaw = value; } });
    configureKnob("B", { label: "Surface pitch", minimum: -180, maximum: 180, step: 1, value: local.readerPitch, format: (value) => `${Math.round(value)}°`, set: (value) => { local.readerPitch = value; } });
    configureKnob("C", { label: "Y rotation", minimum: -180, maximum: 180, step: 1, value: local.rotation.y, format: (value) => `${Math.round(value)}°`, set: (value) => { local.rotation.y = value; } });
  } else {
    const local = state.dimension["4d"];
    configureKnob("A", { label: "XW", minimum: -180, maximum: 180, step: 1, value: local.rotation.xw, format: (value) => `${Math.round(value)}°`, set: (value) => { local.rotation.xw = value; } });
    configureKnob("B", { label: "YW", minimum: -180, maximum: 180, step: 1, value: local.rotation.yw, format: (value) => `${Math.round(value)}°`, set: (value) => { local.rotation.yw = value; } });
    configureKnob("C", { label: "ZW", minimum: -180, maximum: 180, step: 1, value: local.rotation.zw, format: (value) => `${Math.round(value)}°`, set: (value) => { local.rotation.zw = value; } });
  }
}

function syncLiveKnobValues() {
  for (const [button, configuration] of knobConfigurations) {
    const dimension = state.selection.dimension;
    let value;
    if (dimension === "2d") value = button.id.endsWith("A") ? state.dimension["2d"].rotation : button.id.endsWith("B") ? state.profile.sides : state.dimension["2d"].curvature;
    else if (dimension === "3d") value = button.id.endsWith("A") ? state.dimension["3d"].readerYaw : button.id.endsWith("B") ? state.dimension["3d"].readerPitch : state.dimension["3d"].rotation.y;
    else value = button.id.endsWith("A") ? state.dimension["4d"].rotation.xw : button.id.endsWith("B") ? state.dimension["4d"].rotation.yw : state.dimension["4d"].rotation.zw;
    paintKnob(button, value, configuration);
  }
}

const ROTATION_TRANSPORTS = Object.freeze({
  "2d": Object.freeze([
    Object.freeze({ path: "rotationRunning", label: "Shape" }),
  ]),
  "3d": Object.freeze([
    Object.freeze({ path: "rotationMotion.readerYaw.running", label: "Yaw", group: "Reader" }),
    Object.freeze({ path: "rotationMotion.readerPitch.running", label: "Pitch", group: "Reader" }),
    Object.freeze({ path: "rotationMotion.x.running", label: "X", group: "Shape" }),
    Object.freeze({ path: "rotationMotion.y.running", label: "Y", group: "Shape" }),
    Object.freeze({ path: "rotationMotion.z.running", label: "Z", group: "Shape" }),
  ]),
  "4d": Object.freeze([
    Object.freeze({ path: "rotationMotion.xw.running", label: "X–W", group: "Shape" }),
    Object.freeze({ path: "rotationMotion.yw.running", label: "Y–W", group: "Shape" }),
    Object.freeze({ path: "rotationMotion.zw.running", label: "Z–W", group: "Shape" }),
  ]),
});

function rotationTransportButton(control, index) {
  const id = control.path === "rotationRunning" ? "rotateButton" : `rotationPlay${index}`;
  return `<button class="shapes-axis-play" id="${id}" type="button" data-rotation-motion="${control.path}" aria-pressed="false">
    <svg class="transport-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5 18 12 8 18.5Z" /></svg>
    <svg class="transport-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
    <small>${control.label}</small>
  </button>`;
}

function syncRotationTransport() {
  const dimension = state.selection.dimension;
  const container = $("rotationTransport");
  const controls = ROTATION_TRANSPORTS[dimension];
  if (container.dataset.dimension !== dimension) {
    const groups = [];
    for (const control of controls) {
      const group = control.group ?? "Rotate";
      let entry = groups.at(-1);
      if (!entry || entry.name !== group) {
        entry = { name: group, controls: [] };
        groups.push(entry);
      }
      entry.controls.push(control);
    }
    container.innerHTML = groups.map((group, groupIndex) => `
      <span class="shapes-axis-transport-group">
        <span class="shapes-axis-transport-label">${group.name}</span>
        ${group.controls.map((control, index) => rotationTransportButton(control, groupIndex * 8 + index)).join("")}
      </span>
    `).join("");
    container.dataset.dimension = dimension;
  }
  for (const button of container.querySelectorAll("[data-rotation-motion]")) {
    const running = Boolean(localPathValue(button.dataset.rotationMotion));
    const control = controls.find(({ path }) => path === button.dataset.rotationMotion);
    const subject = `${control?.group ? `${control.group} ` : ""}${control?.label ?? "rotation"}`;
    button.setAttribute("aria-pressed", String(running));
    button.setAttribute("aria-label", `${running ? "Pause" : "Play"} ${subject} rotation`);
    button.title = `${running ? "Pause" : "Play"} ${subject} rotation`;
  }
}

function rotationControlCard(title, controls) {
  return `<section class="shapes-rotation-card"><h3>${title}</h3>${controls.map(({ label, target, minimum = -180, maximum = 180, step = 1, suffix = "°" }) => `
    <label class="control"><span><b>${label}</b><output data-rotation-output="${target}">0${suffix}</output></span><input type="range" min="${minimum}" max="${maximum}" step="${step}" data-rotation-target="${target}" /></label>
  `).join("")}</section>`;
}

function renderRotationControls() {
  const dimension = state.selection.dimension;
  if (renderedRotationDimension === dimension) return;
  const container = $("rotationControls");
  if (dimension === "2d") {
    container.innerHTML = rotationControlCard("XY plane", [
      { label: "Angle", target: "rotation" },
      { label: "Auto speed", target: "rotationSpeed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
    ]);
  } else if (dimension === "3d") {
    container.innerHTML = [
      rotationControlCard("Reader surface", [
        { label: "Yaw", target: "readerYaw" },
        { label: "Yaw speed", target: "rotationMotion.readerYaw.speed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
        { label: "Pitch", target: "readerPitch" },
        { label: "Pitch speed", target: "rotationMotion.readerPitch.speed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
      ]),
      rotationControlCard("Shape axes", [
        { label: "X angle", target: "rotation.x" },
        { label: "X speed", target: "rotationMotion.x.speed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
        { label: "Y angle", target: "rotation.y" },
        { label: "Y speed", target: "rotationMotion.y.speed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
        { label: "Z angle", target: "rotation.z" },
        { label: "Z speed", target: "rotationMotion.z.speed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
      ]),
    ].join("");
  } else {
    container.innerHTML = [
      rotationControlCard("W planes", [
        { label: "XW angle", target: "rotation.xw" },
        { label: "XW speed", target: "rotationMotion.xw.speed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
        { label: "YW angle", target: "rotation.yw" },
        { label: "YW speed", target: "rotationMotion.yw.speed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
        { label: "ZW angle", target: "rotation.zw" },
        { label: "ZW speed", target: "rotationMotion.zw.speed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
      ]),
    ].join("");
  }
  for (const input of container.querySelectorAll("[data-rotation-target]")) {
    input.addEventListener("input", () => {
      setLocalPath(input.dataset.rotationTarget, Number(input.value));
      markManualMotion("geometry", 90);
      syncRotationControlValues();
      syncLiveKnobValues();
      queueSave();
      scheduleFrame();
    });
  }
  renderedRotationDimension = dimension;
  syncRotationControlValues();
}

function localPathValue(path) {
  return path.split(".").reduce((value, key) => value?.[key], state.dimension[state.selection.dimension]);
}

function setLocalPath(path, value) {
  const keys = path.split(".");
  const local = state.dimension[state.selection.dimension];
  const parent = keys.slice(0, -1).reduce((target, key) => target[key], local);
  parent[keys.at(-1)] = value;
}

function syncRotationControlValues() {
  const container = $("rotationControls");
  for (const input of container.querySelectorAll("[data-rotation-target]")) {
    const value = localPathValue(input.dataset.rotationTarget);
    input.value = String(value);
    const output = container.querySelector(`[data-rotation-output="${input.dataset.rotationTarget}"]`);
    if (output) output.textContent = input.dataset.rotationTarget.toLowerCase().endsWith("speed")
      ? `${Number(value).toFixed(2)} rev/s`
      : `${Math.round(value)}°`;
  }
}

function syncAllControls() {
  const dimension = state.selection.dimension;
  const local = state.dimension[dimension];
  const transportLanguage = {
    "2d": { position: "Playhead position", speed: "Playhead speed", subject: "playhead" },
    "3d": { position: "Surface position", speed: "Surface speed", subject: "surface" },
    "4d": { position: "W position", speed: "Hyperplane speed", subject: "hyperplane" },
  }[dimension];
  app.dataset.dimension = dimension;
  app.dataset.playingMode = state.selection.playingMode;
  app.dataset.triggerSoundBank = state.trigger.soundBank;
  $("dimensionSelect").value = dimension;
  canvas.setAttribute("aria-label", `Interactive ${SHAPES_DIMENSIONS[dimension].label} ${SHAPES_DIMENSIONS[dimension].name} instrument canvas`);
  $("dimensionKicker").textContent = `${SHAPES_DIMENSIONS[dimension].label} · ${SHAPES_DIMENSIONS[dimension].name}`.toUpperCase();
  $("shapeReadout").textContent = shapesRepresentationLabel(state).toUpperCase();
  $("positionLabel").textContent = transportLanguage.position;
  $("speedLabel").textContent = transportLanguage.speed;
  $("speed").value = String(state.play.rateCyclesPerSecond);
  $("speedOut").textContent = `${state.play.rateCyclesPerSecond.toFixed(2)} cyc/s`;
  $("playButton").setAttribute("aria-pressed", String(state.play.running));
  $("playButtonLabel").textContent = state.play.running ? "Pause" : "Play";
  $("playButton").setAttribute(
    "aria-label",
    `${state.play.running ? "Pause" : "Play"} ${transportLanguage.subject}`,
  );
  $("playButton").title = state.play.running ? "Pause" : "Play";
  const forward = state.play.direction > 0;
  $("directionButton").dataset.direction = forward ? "forward" : "reverse";
  $("directionButton").setAttribute("aria-label", `Reader direction: ${forward ? "forward" : "reverse"}`);
  $("directionButton").title = `Direction: ${forward ? "forward" : "reverse"}`;
  $("directionButtonLabel").textContent = forward ? "Forward" : "Reverse";
  syncRotationTransport();
  for (const button of $("motionMode").querySelectorAll("[data-motion]")) button.setAttribute("aria-pressed", String(button.dataset.motion === state.play.motion));
  for (const button of $("playingMode").querySelectorAll("[data-playing-mode]")) button.setAttribute("aria-pressed", String(button.dataset.playingMode === state.selection.playingMode));
  for (const button of document.querySelectorAll("[data-bank]")) {
    const active = button.dataset.bank === state.selection.bank;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[data-bank-panel]")) {
    const active = panel.dataset.bankPanel === state.selection.bank;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  }
  const triggerMode = state.selection.playingMode === "triggers";
  $("voiceEngineControl").hidden = triggerMode;
  $("triggerSoundBankControl").hidden = !triggerMode;
  $("voiceEngine").value = state.voice.engine;
  $("voiceEngine").disabled = triggerMode;
  $("triggerSoundBank").value = state.trigger.soundBank;
  $("readerSelect").value = state.dimension["2d"].reader;
  syncPlayheadControls();
  populateMainForm();
  configureLiveKnobs();
  renderRotationControls();
  for (const form of document.querySelectorAll("[data-dimension-form]")) form.hidden = form.dataset.dimensionForm !== dimension;

  $("profileKind").value = twoDimensionalFormValue();
  $("profileSides").value = String(state.profile.sides);
  $("profileSidesOut").textContent = String(state.profile.sides);
  $("starDepth").value = String(state.profile.starDepth);
  $("starDepthOut").textContent = `${Math.round(state.profile.starDepth * 100)}%`;
  $("starDepthControl").hidden = state.profile.kind !== "star";
  $("curvature").value = String(state.dimension["2d"].curvature);
  $("curvatureOut").textContent = `${Math.round(state.dimension["2d"].curvature * 100)}%`;
  $("aspect").value = String(state.dimension["2d"].aspect);
  $("aspectOut").textContent = state.dimension["2d"].aspect.toFixed(2);
  $("skew2d").value = String(state.dimension["2d"].skew);
  $("skew2dOut").textContent = `${Math.round(state.dimension["2d"].skew * 100)}%`;
  $("solidRepresentation").value = state.dimension["3d"].representation;
  for (const axis of ["x", "y", "z"]) {
    $(`scale3${axis}`).value = String(state.dimension["3d"].scale[axis]);
    $(`scale3${axis}Out`).textContent = `${state.dimension["3d"].scale[axis].toFixed(2)}×`;
    $(`scale4${axis}`).value = String(state.dimension["4d"].scale[axis]);
    $(`scale4${axis}Out`).textContent = `${state.dimension["4d"].scale[axis].toFixed(2)}×`;
  }
  for (const axis of ["x", "z"]) {
    $(`skew3${axis}`).value = String(state.dimension["3d"].skew[axis]);
    $(`skew3${axis}Out`).textContent = `${Math.round(state.dimension["3d"].skew[axis] * 100)}%`;
  }
  $("hyperRepresentation").value = state.dimension["4d"].representation;
  $("scale4w").value = String(state.dimension["4d"].scale.w);
  $("scale4wOut").textContent = `${state.dimension["4d"].scale.w.toFixed(2)}×`;

  const divisionsActive = state.selection.playingMode !== "continuous";
  const divisions = shapesDivisionCount(state);
  $("divisionsControl").hidden = !divisionsActive;
  $("divisions").disabled = !divisionsActive;
  $("divisions").max = "16";
  $("divisions").value = String(divisions);
  $("divisions").setAttribute("aria-valuetext", `${divisions} division${divisions === 1 ? "" : "s"}`);
  $("divisionsOut").textContent = String(divisions);

  const voiceOutputs = {
    baseFrequency: [`${Math.round(state.voice.baseHz)} Hz`, state.voice.baseHz],
    pitchRange: [`${state.voice.rangeOctaves.toFixed(1)} oct`, state.voice.rangeOctaves],
    voiceCharacter: [`${Math.round(state.voice.character * 100)}%`, state.voice.character],
    stereoSpread: [`${Math.round(state.voice.spread * 100)}%`, state.voice.spread],
  };
  for (const [id, [label, value]] of Object.entries(voiceOutputs)) { $(id).value = String(value); $(`${id}Out`).textContent = label; }
  $("voiceMappingSection").hidden = triggerMode;
  $("triggerMappingSection").hidden = !triggerMode;
  $("triggerMappingControl").hidden = state.trigger.soundBank !== "fm-kit";
  $("triggerMapping").disabled = state.trigger.soundBank !== "fm-kit";
  $("triggerMapping").value = state.trigger.mapping;
  $("tuningDepthLabel").textContent = state.trigger.soundBank === "rattlesnake"
    ? "Morph range"
    : "Tuning depth";
  const triggerOutputs = {
    tuningDepth: [state.trigger.soundBank === "rattlesnake"
      ? `${Math.round(state.trigger.tuningDepth / 12 * 100)}%`
      : `${Math.round(state.trigger.tuningDepth)} st`, state.trigger.tuningDepth],
    triggerCharacter: [`${Math.round(state.trigger.characterDepth * 100)}%`, state.trigger.characterDepth],
    hitCap: [String(state.trigger.hitCap), state.trigger.hitCap],
  };
  for (const [id, [label, value]] of Object.entries(triggerOutputs)) { $(id).value = String(value); $(`${id}Out`).textContent = label; }
  syncAudioUi();
  if (lastScene) syncFastUi(lastScene);
}

function afterMutation({ save = true, route = false, announceMessage = null } = {}) {
  syncAllControls();
  if (route) updateRoute();
  if (save) queueSave();
  if (announceMessage) announce(announceMessage);
  scheduleFrame();
}

function syncLiveRangeControl(id) {
  const value = Number($(id).value);
  const output = $(`${id}Out`);
  const percent = () => `${Math.round(value * 100)}%`;
  if (id === "level") {
    $("levelOut").textContent = percent();
  } else if (id === "position") {
    $("positionOut").textContent = `${(displayShapesPhase(state) * 100).toFixed(1)}%`;
  } else if (id === "speed") {
    $("speedOut").textContent = `${state.play.rateCyclesPerSecond.toFixed(2)} cyc/s`;
  } else if (id === "divisions") {
    const divisions = shapesDivisionCount(state);
    $("divisions").value = String(divisions);
    $("divisions").setAttribute("aria-valuetext", `${divisions} division${divisions === 1 ? "" : "s"}`);
    $("divisionsOut").textContent = String(divisions);
  } else if (id === "profileSides") {
    $("profileSides").value = String(state.profile.sides);
    $("profileSidesOut").textContent = String(state.profile.sides);
    $("profileKind").value = twoDimensionalFormValue();
    populateMainForm();
    configureLiveKnobs();
  } else if (id === "starDepth") output.textContent = percent();
  else if (id === "curvature") output.textContent = percent();
  else if (id === "aspect") output.textContent = value.toFixed(2);
  else if (id === "skew2d" || id === "skew3x" || id === "skew3z") output.textContent = percent();
  else if (/^scale[34][xyzw]$/.test(id)) output.textContent = `${value.toFixed(2)}×`;
  else if (id === "baseFrequency") output.textContent = `${Math.round(value)} Hz`;
  else if (id === "pitchRange") output.textContent = `${value.toFixed(1)} oct`;
  else if (["voiceCharacter", "stereoSpread", "triggerCharacter"].includes(id)) output.textContent = percent();
  else if (id === "tuningDepth") output.textContent = `${Math.round(value)} st`;
  else if (id === "hitCap") output.textContent = String(Math.round(value));
}

function bindRange(id, apply, { motion = false } = {}) {
  $(id).addEventListener("input", () => {
    apply(Number($(id).value));
    if (motion) markManualMotion(motion === true ? "geometry" : motion);
    else if (id !== "level") invalidateDiscreteSchedule({ silence: true });
    syncLiveRangeControl(id);
    queueSave();
    scheduleFrame();
  });
}

function installKnobInteraction(button) {
  let drag = null;
  button.addEventListener("pointerdown", (event) => {
    const configuration = knobConfigurations.get(button);
    if (!configuration) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, y: event.clientY, value: Number(button.getAttribute("aria-valuenow")) || 0 };
    button.setPointerCapture?.(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const configuration = knobConfigurations.get(button);
    const range = configuration.maximum - configuration.minimum;
    const raw = drag.value + (drag.y - event.clientY) / 120 * range;
    const stepped = Math.round(raw / configuration.step) * configuration.step;
    const value = clamp(stepped, configuration.minimum, configuration.maximum);
    configuration.set(value);
    paintKnob(button, value, configuration);
    markManualMotion();
    queueSave();
    scheduleFrame();
  });
  const stop = (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    syncAllControls();
    queueSave();
  };
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("keydown", (event) => {
    const configuration = knobConfigurations.get(button);
    if (!configuration) return;
    const current = Number(button.getAttribute("aria-valuenow")) || 0;
    const values = { Home: configuration.minimum, End: configuration.maximum, ArrowLeft: current - configuration.step, ArrowDown: current - configuration.step, ArrowRight: current + configuration.step, ArrowUp: current + configuration.step, PageDown: current - configuration.step * 10, PageUp: current + configuration.step * 10 };
    if (!(event.key in values)) return;
    event.preventDefault();
    configuration.set(clamp(values[event.key], configuration.minimum, configuration.maximum));
    markManualMotion();
    afterMutation();
  });
}

$("audioButton").addEventListener("click", () => setAudioEnabled(!state.audio.enabled));
bindRange("level", (value) => {
  state.audio.level = value;
  synthAudio.setLevel(value);
  drumAudio.setOutput(value * 0.9);
  rattlesnakeAudio.setOutput(
    state.audio.enabled
      && state.selection.playingMode === "triggers"
      && state.trigger.soundBank === "rattlesnake"
      ? value * 0.85
      : 0,
  );
});
$("dimensionSelect").addEventListener("change", () => {
  selectShapesDimension(state, $("dimensionSelect").value);
  renderedMainFormDimension = null;
  renderedRotationDimension = null;
  resetEventClock();
  afterMutation({ route: true, announceMessage: `${SHAPES_DIMENSIONS[state.selection.dimension].label} ${SHAPES_DIMENSIONS[state.selection.dimension].name} selected.` });
});
const bankButtons = [...document.querySelectorAll("[data-bank]")];
for (const button of bankButtons) {
  button.addEventListener("click", () => {
    selectShapesBank(state, button.dataset.bank);
    afterMutation();
  });
  button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, bankButtons.indexOf(button));
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? bankButtons.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + bankButtons.length) % bankButtons.length;
    bankButtons[next].click();
    bankButtons[next].focus();
  });
}
for (const button of $("playingMode").querySelectorAll("[data-playing-mode]")) button.addEventListener("click", async () => {
  if (button.dataset.playingMode === state.selection.playingMode) return;
  selectShapesPlayingMode(state, button.dataset.playingMode);
  resetEventClock();
  clearTimeout(noteReleaseTimer);
  noteReleaseTimer = 0;
  heldMidiNotes.clear();
  synthAudio.silence();
  drumAudio.silence();
  rattlesnakeAudio.silence();
  rattlesnakeAudio.setOutput(0);
  afterMutation({ route: true, announceMessage: `${titleCase(state.selection.playingMode)} playing selected.` });
  if (state.audio.enabled) {
    try { await prepareActiveAudio(); } catch { await setAudioEnabled(false); }
  }
  syncDiscreteScheduler();
});
$("playButton").addEventListener("click", () => {
  state.play.running = !state.play.running;
  resetTransportClocks();
  afterMutation({ announceMessage: state.play.running ? "Playback started." : "Playback paused." });
  syncDiscreteScheduler();
});
bindRange("position", (value) => { state.play.continuousPhase = value; }, { motion: "phase" });
bindRange("speed", (value) => { state.play.rateCyclesPerSecond = value; resetEventClock(); });
$("directionButton").addEventListener("click", () => { state.play.direction *= -1; resetEventClock(); afterMutation(); syncDiscreteScheduler(); });
for (const button of $("motionMode").querySelectorAll("[data-motion]")) button.addEventListener("click", () => { state.play.motion = button.dataset.motion; resetEventClock(); afterMutation(); syncDiscreteScheduler(); });
$("rotationTransport").addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-rotation-motion]");
  if (!button || !$("rotationTransport").contains(button)) return;
  const running = !Boolean(localPathValue(button.dataset.rotationMotion));
  setLocalPath(button.dataset.rotationMotion, running);
  // Once independent controls are used, the retired all-axis compatibility
  // latch must not silently resume motion when the final axis is paused.
  if (state.selection.dimension !== "2d") {
    state.dimension[state.selection.dimension].rotationRunning = false;
  }
  resetTransportClocks();
  afterMutation({ announceMessage: `${button.textContent.trim()} rotation ${running ? "started" : "paused"}.` });
  syncDiscreteScheduler();
});
$("voiceEngine").addEventListener("change", () => { state.voice.engine = $("voiceEngine").value; resetEventClock(); afterMutation(); });
$("triggerSoundBank").addEventListener("change", async () => {
  state.trigger.soundBank = $("triggerSoundBank").value;
  resetEventClock();
  afterMutation({
    announceMessage: `${TRIGGER_SOUND_BANK_BY_ID.get(state.trigger.soundBank)?.label ?? "Percussion bank"} selected.`,
  });
  if (!state.audio.enabled || state.selection.playingMode !== "triggers") return;
  try {
    await prepareActiveAudio();
    syncDiscreteScheduler();
  } catch (error) {
    announce(error?.message ?? "The percussion bank could not start.");
    await setAudioEnabled(false);
  }
});
$("readerSelect").addEventListener("change", () => { state.dimension["2d"].reader = $("readerSelect").value; resetEventClock(); afterMutation(); });
$("removePlayhead").addEventListener("click", () => {
  setShapes2dHeadCount(state, shapes2dHeadCount(state) - 1);
  resetEventClock();
  afterMutation({ announceMessage: `${shapes2dHeadCount(state)} playhead${shapes2dHeadCount(state) === 1 ? "" : "s"}.` });
});
$("addPlayhead").addEventListener("click", () => {
  setShapes2dHeadCount(state, shapes2dHeadCount(state) + 1);
  resetEventClock();
  afterMutation({ announceMessage: `${shapes2dHeadCount(state)} playheads.` });
});
$("resetHeadSpacing").addEventListener("click", () => {
  setShapes2dHeadCount(state, shapes2dHeadCount(state));
  resetEventClock();
  afterMutation({ announceMessage: "Playheads spaced equally." });
});
$("mainFormSelect").addEventListener("change", () => {
  if (state.selection.dimension === "2d") setProfileKind($("mainFormSelect").value);
  else state.dimension[state.selection.dimension].representation = $("mainFormSelect").value;
  resetEventClock();
  afterMutation();
});
$("profileKind").addEventListener("change", () => { setProfileKind($("profileKind").value); resetEventClock(); afterMutation(); });
bindRange("profileSides", (value) => { state.profile.sides = Math.round(value); state.profile.kind = state.profile.sides === 1 ? "circle" : state.profile.sides === 2 ? "line" : state.profile.kind === "star" ? "star" : "polygon"; });
bindRange("starDepth", (value) => { state.profile.starDepth = value; });
bindRange("curvature", (value) => { state.dimension["2d"].curvature = value; });
bindRange("aspect", (value) => { state.dimension["2d"].aspect = value; });
bindRange("skew2d", (value) => { state.dimension["2d"].skew = value; });
$("solidRepresentation").addEventListener("change", () => { state.dimension["3d"].representation = $("solidRepresentation").value; resetEventClock(); afterMutation(); });
for (const axis of ["x", "y", "z"]) bindRange(`scale3${axis}`, (value) => { state.dimension["3d"].scale[axis] = value; });
for (const axis of ["x", "z"]) bindRange(`skew3${axis}`, (value) => { state.dimension["3d"].skew[axis] = value; });
$("hyperRepresentation").addEventListener("change", () => { state.dimension["4d"].representation = $("hyperRepresentation").value; resetEventClock(); afterMutation(); });
for (const axis of ["x", "y", "z", "w"]) bindRange(`scale4${axis}`, (value) => { state.dimension["4d"].scale[axis] = value; });
bindRange("baseFrequency", (value) => { state.voice.baseHz = value; });
bindRange("pitchRange", (value) => { state.voice.rangeOctaves = value; });
bindRange("voiceCharacter", (value) => { state.voice.character = value; });
bindRange("stereoSpread", (value) => { state.voice.spread = value; });
bindRange("divisions", (value) => { setShapesDivisionCount(state, value); resetEventClock(); });
$("triggerMapping").addEventListener("change", () => { state.trigger.mapping = $("triggerMapping").value; resetEventClock(); afterMutation(); });
bindRange("tuningDepth", (value) => { state.trigger.tuningDepth = value; });
bindRange("triggerCharacter", (value) => { state.trigger.characterDepth = value; });
bindRange("hitCap", (value) => { state.trigger.hitCap = Math.round(value); });

$("resetForm").addEventListener("click", () => {
  const defaults = createShapesState();
  state.profile = defaults.profile;
  const dimension = state.selection.dimension;
  const local = state.dimension[dimension];
  const localDefaults = defaults.dimension[dimension];
  if (dimension === "2d") {
    local.curvature = localDefaults.curvature;
    local.aspect = localDefaults.aspect;
    local.skew = localDefaults.skew;
  } else if (dimension === "3d") {
    local.representation = localDefaults.representation;
    local.scale = structuredClone(localDefaults.scale);
    local.skew = structuredClone(localDefaults.skew);
  } else {
    local.representation = localDefaults.representation;
    local.scale = structuredClone(localDefaults.scale);
  }
  renderedMainFormDimension = null;
  resetEventClock();
  afterMutation({ announceMessage: "Form reset." });
});
$("resetRotation").addEventListener("click", () => {
  const defaults = createShapesState().dimension[state.selection.dimension];
  const local = state.dimension[state.selection.dimension];
  if (state.selection.dimension === "2d") local.rotation = defaults.rotation;
  else local.rotation = structuredClone(defaults.rotation);
  local.rotationSpeed = defaults.rotationSpeed;
  local.rotationRunning = false;
  if (defaults.rotationMotion) local.rotationMotion = structuredClone(defaults.rotationMotion);
  if (state.selection.dimension === "3d") { local.readerYaw = defaults.readerYaw; local.readerPitch = defaults.readerPitch; }
  resetEventClock();
  afterMutation({ announceMessage: "Rotation reset." });
});
$("resetMapping").addEventListener("click", () => {
  const defaults = createShapesState();
  const soundBank = state.trigger.soundBank;
  state.voice = defaults.voice;
  state.trigger = { ...defaults.trigger, soundBank };
  resetEventClock();
  afterMutation({ announceMessage: "Mappings reset." });
});
$("resetAll").addEventListener("click", async () => {
  const wasAudioOn = state.audio.enabled;
  if (wasAudioOn) await setAudioEnabled(false);
  state = createShapesState();
  renderedMainFormDimension = null;
  renderedRotationDimension = null;
  resetEventClock();
  afterMutation({ route: true, announceMessage: "Shapes reset." });
});

function frequencyForMidiNote(note) {
  return 440 * (2 ** ((clamp(Math.round(Number(note) || 60), 0, 127) - 69) / 12));
}

async function auditionMidiNote(message) {
  if (!state.audio.enabled) await setAudioEnabled(true);
  if (!state.audio.enabled) return;
  const note = clamp(Math.round(Number(message.note) || 60), 0, 127);
  const velocity = clamp((Number(message.velocity) || 100) / 127, 0.05, 1);
  state.play.continuousPhase = clamp((note - 24) / 84, 0, 1);
  markManualMotion("phase", 160);
  resetEventClock();
  const scene = buildShapesScene(state);
  lastScene = scene;
  if (state.selection.playingMode === "triggers") {
    emitTriggers(scene, { hitLimit: 1, velocity });
  } else if (state.selection.playingMode === "notes") {
    emitNotes(scene, { frequency: frequencyForMidiNote(note), velocity, hold: true });
  } else {
    const centeredBase = frequencyForMidiNote(note) / (2 ** (state.voice.rangeOctaves * 0.5));
    synthAudio.setVoices(synthSpecs(scene, { baseHz: centeredBase }), { mode: state.voice.engine });
  }
  afterMutation({ save: false });
  announce(`MIDI note ${note} played through ${titleCase(state.selection.playingMode)} mode.`);
}

function handleShapesMidiInput(event) {
  const { message, routeId } = event.detail ?? {};
  if (!["combo", "shapes"].includes(routeId) || !message) return;
  if (message.type === "noteOn") {
    event.preventDefault();
    heldMidiNotes.add(message.note);
    void auditionMidiNote(message);
    return;
  }
  if (message.type === "noteOff") {
    event.preventDefault();
    heldMidiNotes.delete(message.note);
    if (heldMidiNotes.size) return;
    if (state.selection.playingMode === "notes") releaseNoteVoices();
    else if (state.selection.playingMode === "continuous" && state.audio.enabled) scheduleFrame();
    return;
  }
  if (message.type === "controlChange" && [120, 123].includes(message.controller)) {
    event.preventDefault();
    heldMidiNotes.clear();
    releaseNoteVoices();
    return;
  }
  if (message.type === "start" || message.type === "continue") {
    event.preventDefault();
    state.play.running = true;
    resetTransportClocks();
    if (!state.audio.enabled) void setAudioEnabled(true);
    afterMutation({ announceMessage: "MIDI transport started Shapes." });
  } else if (message.type === "stop") {
    event.preventDefault();
    state.play.running = false;
    resetTransportClocks();
    afterMutation({ announceMessage: "MIDI transport paused Shapes." });
  }
}

globalThis.addEventListener?.("morphazoid:midi-input", handleShapesMidiInput);

for (const button of document.querySelectorAll(".shapes-knob")) installKnobInteraction(button);

function canvasPointerPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  const x = Number.isFinite(event.clientX)
    ? (event.clientX - bounds.left) * cssWidth / Math.max(1, bounds.width)
    : Number(event.offsetX) || 0;
  const y = Number.isFinite(event.clientY)
    ? (event.clientY - bounds.top) * cssHeight / Math.max(1, bounds.height)
    : Number(event.offsetY) || 0;
  return { x, y };
}

function distanceToCanvasSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared <= 1e-9
    ? 0
    : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.y - (start.y + dy * amount),
  );
}

function pointerHitsTwoDimensionalShape(event) {
  if (state.selection.dimension !== "2d") return false;
  const scene = lastScene?.dimension === "2d" ? lastScene : buildShapesScene(state);
  const transform = sceneTransform(scene);
  const points = scene.vertices.map((point) => ({
    x: transform.x(point.x),
    y: transform.y(point.y),
  }));
  if (points.length < 2) return false;
  const pointer = canvasPointerPoint(event);
  const segmentCount = scene.closed ? points.length : points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    if (distanceToCanvasSegment(pointer, points[index], points[(index + 1) % points.length]) <= 16) {
      return true;
    }
  }
  if (!scene.closed) return false;
  let inside = false;
  for (let first = 0, second = points.length - 1; first < points.length; second = first, first += 1) {
    const a = points[first];
    const b = points[second];
    if (
      (a.y > pointer.y) !== (b.y > pointer.y)
      && pointer.x < (b.x - a.x) * (pointer.y - a.y) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
}

function pointerAngleFromShapeCenter(event) {
  const point = canvasPointerPoint(event);
  return Math.atan2(point.y - cssHeight * 0.5, point.x - cssWidth * 0.5);
}

function scrubPlayheadFromPointer(event) {
  state.play.continuousPhase = clamp(canvasPointerPoint(event).x / Math.max(1, cssWidth), 0, 1);
  markManualMotion("phase", 120);
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const moveReader = pointerHitsTwoDimensionalShape(event);
  if (moveReader) {
    pointerScrub = event.pointerId;
    scrubPlayheadFromPointer(event);
  } else {
    const local = state.dimension["2d"];
    local.rotationRunning = false;
    pointerRotation = {
      pointerId: event.pointerId,
      startAngle: pointerAngleFromShapeCenter(event),
      startRotation: local.rotation,
    };
    markManualMotion("geometry", 120);
    stageWrap.classList.add?.("is-spinning");
  }
  canvas.setPointerCapture?.(event.pointerId);
  canvas.focus?.({ preventScroll: true });
  afterMutation({ save: false });
});
canvas.addEventListener("pointermove", (event) => {
  if (pointerScrub === event.pointerId) {
    scrubPlayheadFromPointer(event);
    scheduleFrame();
    return;
  }
  if (pointerRotation?.pointerId !== event.pointerId) return;
  const angleDelta = Math.atan2(
    Math.sin(pointerAngleFromShapeCenter(event) - pointerRotation.startAngle),
    Math.cos(pointerAngleFromShapeCenter(event) - pointerRotation.startAngle),
  );
  state.dimension["2d"].rotation = (
    (pointerRotation.startRotation + angleDelta * 180 / Math.PI + 180) % 360 + 360
  ) % 360 - 180;
  markManualMotion("geometry", 120);
  scheduleFrame();
});
const finishCanvasGesture = (event) => {
  if (pointerScrub === event.pointerId) pointerScrub = null;
  else if (pointerRotation?.pointerId === event.pointerId) {
    pointerRotation = null;
    stageWrap.classList.remove?.("is-spinning");
  } else return;
  queueSave();
  scheduleFrame();
};
canvas.addEventListener("pointerup", finishCanvasGesture);
canvas.addEventListener("pointercancel", finishCanvasGesture);
canvas.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    $("playButton").click();
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  state.play.continuousPhase += (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 0.05 : 0.005);
  markManualMotion("phase", 120);
  afterMutation();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopDiscreteScheduler();
    synthAudio.silence();
    drumAudio.silence();
    rattlesnakeAudio.silence();
  } else {
    resetTransportClocks();
    syncDiscreteScheduler();
    scheduleFrame();
  }
});
window.addEventListener("pagehide", () => {
  globalThis.removeEventListener?.("morphazoid:midi-input", handleShapesMidiInput);
  stopDiscreteScheduler();
  clearTimeout(noteReleaseTimer);
  synthAudio.close();
  drumAudio.close();
  rattlesnakeAudio.close();
});

new ResizeObserver(resizeCanvas).observe(stageWrap);
syncAllControls();
resizeCanvas();
updateRoute();
scheduleFrame();

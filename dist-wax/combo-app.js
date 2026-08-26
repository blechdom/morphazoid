import {
  normalizeStrikeGains,
  pitch01ToFrequency,
  synthParametersForMode,
  VoicePool,
} from "./src/audio.js";
import {
  cloneDefaultFmDrumVoices,
  FmDrumAudio,
} from "./src/fm-drums.js";
import {
  buildShapesDivisionMarkers,
  buildShapesScene,
} from "./src/shapes-scene.js";
import {
  advanceShapesMotion,
  createShapesState,
  displayShapesPhase,
  selectShapesBank,
  selectShapesDimension,
  selectShapesPlayingMode,
  setShapesDivisionCount,
  shapesDivisionCount,
  shapesEventIntervalMs,
  shapesEventToken,
  shapesRepresentationLabel,
  SHAPES_DIMENSIONS,
  SHAPES_STORAGE_KEY,
} from "./src/shapes-state.js";

const TAU = Math.PI * 2;
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
const synthAudio = new VoicePool(24, { continuousPeakCeiling: 0.74 });
const drumAudio = new FmDrumAudio(globalThis);
const drumVoices = cloneDefaultFmDrumVoices();
const canvas = $("stage");
const context = canvas.getContext("2d");
const app = $("shapesApp");
const stageWrap = $("stageWrap");

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let animationFrame = 0;
let lastFrameTime = performance.now();
let lastAudioUpdate = -Infinity;
let lastEventAt = -Infinity;
const lastEventTokens = { phase: null, geometry: null };
let noteReleaseTimer = 0;
let lastScene = null;
let renderedRotationDimension = null;
let renderedMainFormDimension = null;
let saveTimer = 0;
let manualMotionUntil = 0;
let manualMotionClock = "geometry";
let pointerScrub = null;
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

function resetEventClock() {
  lastEventTokens.phase = null;
  lastEventTokens.geometry = null;
  lastEventAt = -Infinity;
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(bounds.width));
  const nextHeight = Math.max(1, Math.round(bounds.height));
  const nextRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
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
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  const scale = Math.min(cssWidth, cssHeight) * 0.72 / Math.max(0.2, bounds.span);
  const invertY = scene.dimension !== "2d";
  return {
    x: (value) => cssWidth * 0.5 + (value - centerX) * scale,
    y: (value) => cssHeight * 0.5 + (value - centerY) * scale * (invertY ? -1 : 1),
    scale,
  };
}

function drawReader(scene, transform) {
  context.save();
  context.strokeStyle = `color-mix(in srgb, ${SHAPES_DIMENSIONS[scene.dimension].color} 55%, transparent)`;
  context.fillStyle = `color-mix(in srgb, ${SHAPES_DIMENSIONS[scene.dimension].color} 9%, transparent)`;
  context.lineWidth = 1;
  context.setLineDash([5, 7]);
  if (scene.reader.type === "line") {
    const x = transform.x(scene.reader.x);
    context.beginPath();
    context.moveTo(x, cssHeight * 0.12);
    context.lineTo(x, cssHeight * 0.88);
    context.stroke();
  } else if (scene.reader.type === "radar") {
    context.beginPath();
    context.moveTo(transform.x(0), transform.y(0));
    context.lineTo(
      transform.x(Math.cos(scene.reader.angle) * 1.35),
      transform.y(Math.sin(scene.reader.angle) * 1.35),
    );
    context.stroke();
  } else if (scene.reader.type === "plane") {
    context.beginPath();
    scene.reader.corners.forEach((point, index) => {
      if (index) context.lineTo(transform.x(point.x), transform.y(point.y));
      else context.moveTo(transform.x(point.x), transform.y(point.y));
    });
    context.closePath();
    context.fill();
    context.stroke();
  } else if (scene.reader.type === "hyperplane") {
    const y = cssHeight * (0.5 - scene.reader.offset * 0.06);
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
    context.shadowColor = color;
    context.shadowBlur = 18;
    context.beginPath();
    context.arc(x, y, 5.2, 0, TAU);
    context.fillStyle = "#fff3d6";
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = color;
    context.lineWidth = 1.3;
    context.stroke();
    context.restore();
  }
}

function synthSpecs(scene, { baseHz = state.voice.baseHz } = {}) {
  const mode = state.voice.engine;
  const character = state.voice.character;
  return scene.contacts.slice(0, 24).map((contact, index) => ({
    key: contact.voiceKey ?? `${scene.dimension}:${index}`,
    frequency: pitch01ToFrequency(contact.pitch01, baseHz, state.voice.rangeOctaves),
    gain: 0.035 + contact.strength * 0.085,
    pan: contact.pan * state.voice.spread,
    waveform: mode === "sine" || mode === "shepard" ? "sine" : mode === "fm" ? "triangle" : "sawtooth",
    ...synthParametersForMode(mode, contact.drive01 * (0.25 + character * 0.75), {
      fmIndex: 1 + character * 9,
      fmRatio: 1 + character * 3,
      pmIndex: 0.4 + character * 5.5,
      pmRatio: 0.5 + character * 2.5,
      shepardRate: state.play.running
        ? state.play.rateCyclesPerSecond * state.play.direction
        : 0,
      shepardWidth: 2 + character * 5,
      shepardPosition: displayShapesPhase(state),
    }),
  }));
}

function releaseNoteVoices() {
  clearTimeout(noteReleaseTimer);
  noteReleaseTimer = 0;
  synthAudio.setVoices([]);
}

function emitNotes(scene, { frequency = null, velocity = 1, hold = false } = {}) {
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
  synthAudio.setVoices(specs, { mode: state.voice.engine });
  clearTimeout(noteReleaseTimer);
  noteReleaseTimer = 0;
  if (hold) return;
  const eventInterval = shapesEventIntervalMs(state, specs.length);
  const duration = Math.max(42, eventInterval * (0.62 + state.voice.character * 0.12));
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

function emitTriggers(scene, { hitLimit = state.trigger.hitCap, velocity = 1 } = {}) {
  const hitCap = Math.max(1, Math.min(state.trigger.hitCap, Math.round(hitLimit)));
  const velocityGain = clamp(Number(velocity) || 0, 0.05, 1);
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
    drumAudio.trigger(voice).catch(() => {});
  });
}

function transportIsMoving() {
  return state.play.running && Math.abs(state.play.rateCyclesPerSecond) > 1e-6;
}

function rotationIsMoving() {
  const local = state.dimension[state.selection.dimension];
  return local.rotationRunning && Math.abs(local.rotationSpeed) > 1e-6;
}

function motionIsActive(now = performance.now()) {
  return transportIsMoving() || rotationIsMoving() || pointerScrub !== null || now < manualMotionUntil;
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
}

function updateAudio(scene, now) {
  if (!state.audio.enabled || document.hidden) return;
  const mode = state.selection.playingMode;
  if (heldMidiNotes.size && mode !== "triggers") return;
  if (mode === "continuous") {
    if (now - lastAudioUpdate >= 34) {
      synthAudio.setVoices(synthSpecs(scene), { mode: state.voice.engine });
      lastAudioUpdate = now;
    }
    return;
  }
  const clock = eventClock(now);
  const otherClock = clock === "phase" ? "geometry" : "phase";
  lastEventTokens[otherClock] = shapesEventToken(state, scene, { clock: otherClock });
  const token = shapesEventToken(state, scene, { clock });
  if (!motionIsActive(now) || lastEventTokens[clock] === null) {
    lastEventTokens[clock] = token;
    return;
  }
  if (token === lastEventTokens[clock]) return;
  const minimumInterval = shapesEventIntervalMs(state, scene.contacts.length);
  if (now - lastEventAt < minimumInterval) return;
  lastEventTokens[clock] = token;
  lastEventAt = now;
  if (mode === "notes") emitNotes(scene);
  else emitTriggers(scene);
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
    ? "FM drum bank"
    : titleCase(state.voice.engine);
  syncRotationControlValues();
  syncLiveKnobValues();
}

function frame(now) {
  animationFrame = 0;
  resizeCanvas();
  const delta = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;
  advanceShapesMotion(state, delta);
  const scene = buildShapesScene(state);
  lastScene = scene;
  drawScene(scene);
  updateAudio(scene, now);
  syncFastUi(scene);
  if (transportIsMoving() || rotationIsMoving() || pointerScrub !== null) {
    scheduleFrame();
  }
}

async function prepareActiveAudio() {
  const request = ++audioRequest;
  if (state.selection.playingMode === "triggers") {
    await drumAudio.start();
  } else {
    await synthAudio.enable();
  }
  if (request !== audioRequest || !state.audio.enabled) return;
  synthAudio.setLevel(state.audio.level);
  drumAudio.setOutput(state.audio.level * 0.9);
  const triggerMode = state.selection.playingMode === "triggers";
  synthAudio.setHostGain(triggerMode ? 0 : 1, 45);
  drumAudio.setHostGain(triggerMode ? 1 : 0, 45);
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
    clearTimeout(noteReleaseTimer);
    noteReleaseTimer = 0;
    synthAudio.disable();
    drumAudio.setHostGain(0, 30);
    button.disabled = false;
    queueSave();
    scheduleFrame();
    return;
  }
  try {
    await prepareActiveAudio();
    if (!state.audio.enabled) return;
    resetEventClock();
    button.dataset.audioState = "on";
  } catch (error) {
    state.audio.enabled = false;
    synthAudio.disable();
    drumAudio.setHostGain(0);
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
    if (state.profile.sides < 3) state.profile.sides = 6;
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
    configureKnob("A", { label: "Rotate", minimum: -180, maximum: 180, step: 1, value: local.rotation, format: (value) => `${Math.round(value)}°`, set: (value) => { local.rotation = value; } });
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
        { label: "Yaw", target: "readerYaw" }, { label: "Pitch", target: "readerPitch" },
      ]),
      rotationControlCard("Shape axes", [
        { label: "X angle", target: "rotation.x" }, { label: "Y angle", target: "rotation.y" }, { label: "Z angle", target: "rotation.z" },
      ]),
      rotationControlCard("Automatic rotation", [
        { label: "Speed", target: "rotationSpeed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
      ]),
    ].join("");
  } else {
    container.innerHTML = [
      rotationControlCard("W planes", [
        { label: "XW angle", target: "rotation.xw" }, { label: "YW angle", target: "rotation.yw" }, { label: "ZW angle", target: "rotation.zw" },
      ]),
      rotationControlCard("Automatic rotation", [
        { label: "Speed", target: "rotationSpeed", minimum: -0.5, maximum: 0.5, step: 0.01, suffix: " rev/s" },
      ]),
    ].join("");
  }
  for (const input of container.querySelectorAll("[data-rotation-target]")) {
    input.addEventListener("input", () => {
      setLocalPath(input.dataset.rotationTarget, Number(input.value));
      markManualMotion("geometry", 90);
      afterMutation({ save: true });
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
    if (output) output.textContent = input.dataset.rotationTarget === "rotationSpeed"
      ? `${Number(value).toFixed(2)} rev/s`
      : `${Math.round(value)}°`;
  }
}

function syncAllControls() {
  const dimension = state.selection.dimension;
  const local = state.dimension[dimension];
  app.dataset.dimension = dimension;
  app.dataset.playingMode = state.selection.playingMode;
  $("dimensionSelect").value = dimension;
  canvas.setAttribute("aria-label", `Interactive ${SHAPES_DIMENSIONS[dimension].label} ${SHAPES_DIMENSIONS[dimension].name} instrument canvas`);
  $("dimensionKicker").textContent = `${SHAPES_DIMENSIONS[dimension].label} · ${SHAPES_DIMENSIONS[dimension].name}`.toUpperCase();
  $("shapeReadout").textContent = shapesRepresentationLabel(state).toUpperCase();
  $("speed").value = String(state.play.rateCyclesPerSecond);
  $("speedOut").textContent = `${state.play.rateCyclesPerSecond.toFixed(2)} cyc/s`;
  $("playButton").setAttribute("aria-pressed", String(state.play.running));
  $("playButtonLabel").textContent = state.play.running ? "Pause" : "Play";
  $("directionButton").textContent = `Direction · ${state.play.direction > 0 ? "forward" : "reverse"}`;
  $("rotateButton").setAttribute("aria-pressed", String(local.rotationRunning));
  $("rotateButtonLabel").textContent = local.rotationRunning ? "Rotating" : "Rotate";
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
  $("voiceEngine").value = state.voice.engine;
  $("voiceEngine").disabled = state.selection.playingMode === "triggers";
  $("readerSelect").value = state.dimension["2d"].reader;
  $("readerSelect").closest("label").hidden = dimension !== "2d";
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
  $("divisions").max = state.selection.playingMode === "triggers" ? "16" : "24";
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
  $("triggerMapping").value = state.trigger.mapping;
  const triggerOutputs = {
    tuningDepth: [`${Math.round(state.trigger.tuningDepth)} st`, state.trigger.tuningDepth],
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

function bindRange(id, apply, { motion = false } = {}) {
  $(id).addEventListener("input", () => {
    apply(Number($(id).value));
    if (motion) markManualMotion(motion === true ? "geometry" : motion);
    afterMutation();
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
    configuration.set(clamp(stepped, configuration.minimum, configuration.maximum));
    markManualMotion();
    afterMutation();
  });
  const stop = (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
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
  afterMutation({ route: true, announceMessage: `${titleCase(state.selection.playingMode)} playing selected.` });
  if (state.audio.enabled) {
    try { await prepareActiveAudio(); } catch { await setAudioEnabled(false); }
  }
});
$("playButton").addEventListener("click", () => {
  state.play.running = !state.play.running;
  lastFrameTime = performance.now();
  afterMutation({ announceMessage: state.play.running ? "Playback started." : "Playback paused." });
});
bindRange("position", (value) => { state.play.continuousPhase = value; }, { motion: "phase" });
bindRange("speed", (value) => { state.play.rateCyclesPerSecond = value; });
$("directionButton").addEventListener("click", () => { state.play.direction *= -1; afterMutation(); });
for (const button of $("motionMode").querySelectorAll("[data-motion]")) button.addEventListener("click", () => { state.play.motion = button.dataset.motion; afterMutation(); });
$("rotateButton").addEventListener("click", () => {
  const local = state.dimension[state.selection.dimension];
  local.rotationRunning = !local.rotationRunning;
  lastFrameTime = performance.now();
  afterMutation({ announceMessage: local.rotationRunning ? "Rotation started." : "Rotation paused." });
});
$("voiceEngine").addEventListener("change", () => { state.voice.engine = $("voiceEngine").value; synthAudio.silence(); afterMutation(); });
$("readerSelect").addEventListener("change", () => { state.dimension["2d"].reader = $("readerSelect").value; resetEventClock(); afterMutation(); });
$("mainFormSelect").addEventListener("change", () => {
  if (state.selection.dimension === "2d") setProfileKind($("mainFormSelect").value);
  else state.dimension[state.selection.dimension].representation = $("mainFormSelect").value;
  afterMutation();
});
$("profileKind").addEventListener("change", () => { setProfileKind($("profileKind").value); afterMutation(); });
bindRange("profileSides", (value) => { state.profile.sides = Math.round(value); state.profile.kind = state.profile.sides === 1 ? "circle" : state.profile.sides === 2 ? "line" : state.profile.kind === "star" ? "star" : "polygon"; });
bindRange("starDepth", (value) => { state.profile.starDepth = value; });
bindRange("curvature", (value) => { state.dimension["2d"].curvature = value; });
bindRange("aspect", (value) => { state.dimension["2d"].aspect = value; });
bindRange("skew2d", (value) => { state.dimension["2d"].skew = value; });
$("solidRepresentation").addEventListener("change", () => { state.dimension["3d"].representation = $("solidRepresentation").value; afterMutation(); });
for (const axis of ["x", "y", "z"]) bindRange(`scale3${axis}`, (value) => { state.dimension["3d"].scale[axis] = value; });
for (const axis of ["x", "z"]) bindRange(`skew3${axis}`, (value) => { state.dimension["3d"].skew[axis] = value; });
$("hyperRepresentation").addEventListener("change", () => { state.dimension["4d"].representation = $("hyperRepresentation").value; afterMutation(); });
for (const axis of ["x", "y", "z", "w"]) bindRange(`scale4${axis}`, (value) => { state.dimension["4d"].scale[axis] = value; });
bindRange("baseFrequency", (value) => { state.voice.baseHz = value; });
bindRange("pitchRange", (value) => { state.voice.rangeOctaves = value; });
bindRange("voiceCharacter", (value) => { state.voice.character = value; });
bindRange("stereoSpread", (value) => { state.voice.spread = value; });
bindRange("divisions", (value) => { setShapesDivisionCount(state, value); resetEventClock(); });
$("triggerMapping").addEventListener("change", () => { state.trigger.mapping = $("triggerMapping").value; afterMutation(); });
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
  if (state.selection.dimension === "3d") { local.readerYaw = defaults.readerYaw; local.readerPitch = defaults.readerPitch; }
  afterMutation({ announceMessage: "Rotation reset." });
});
$("resetMapping").addEventListener("click", () => {
  const defaults = createShapesState();
  state.voice = defaults.voice;
  state.trigger = defaults.trigger;
  synthAudio.silence();
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
    else if (state.selection.playingMode === "continuous" && state.audio.enabled) {
      const scene = lastScene ?? buildShapesScene(state);
      synthAudio.setVoices(synthSpecs(scene), { mode: state.voice.engine });
    }
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
    lastFrameTime = performance.now();
    if (!state.audio.enabled) void setAudioEnabled(true);
    afterMutation({ announceMessage: "MIDI transport started Shapes." });
  } else if (message.type === "stop") {
    event.preventDefault();
    state.play.running = false;
    afterMutation({ announceMessage: "MIDI transport paused Shapes." });
  }
}

globalThis.addEventListener?.("morphazoid:midi-input", handleShapesMidiInput);

for (const button of document.querySelectorAll(".shapes-knob")) installKnobInteraction(button);

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  pointerScrub = event.pointerId;
  canvas.setPointerCapture?.(event.pointerId);
  state.play.continuousPhase = clamp(event.offsetX / Math.max(1, cssWidth), 0, 1);
  markManualMotion("phase", 120);
  afterMutation({ save: false });
});
canvas.addEventListener("pointermove", (event) => {
  if (pointerScrub !== event.pointerId) return;
  state.play.continuousPhase = clamp(event.offsetX / Math.max(1, cssWidth), 0, 1);
  markManualMotion("phase", 120);
  scheduleFrame();
});
const finishScrub = (event) => {
  if (pointerScrub !== event.pointerId) return;
  pointerScrub = null;
  queueSave();
  scheduleFrame();
};
canvas.addEventListener("pointerup", finishScrub);
canvas.addEventListener("pointercancel", finishScrub);
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
  if (document.hidden) synthAudio.silence();
  else scheduleFrame();
});
window.addEventListener("pagehide", () => {
  globalThis.removeEventListener?.("morphazoid:midi-input", handleShapesMidiInput);
  clearTimeout(noteReleaseTimer);
  synthAudio.close();
  drumAudio.close();
});

new ResizeObserver(resizeCanvas).observe(stageWrap);
syncAllControls();
resizeCanvas();
updateRoute();
scheduleFrame();

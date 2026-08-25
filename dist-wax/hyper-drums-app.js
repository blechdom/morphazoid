import { projectPoint3, rotatePoint3 } from "./src/solid.js";
import {
  crossedHyperplaneLoop,
  hyperplaneIntersections,
  hyperplaneOffsetForShapePhase,
  projectPoint4,
  transformedHyperShape,
} from "./src/hyper.js";
import {
  cloneDefaultFmDrumVoices,
  FM_DRUM_STORAGE_KEY,
  FmDrumAudio,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import {
  HYPER_DRUM_MAPPING_MODES,
  hyperContactSegmentIndex,
  hyperContactVoiceKey,
  hyperDrumVoiceIndex,
  mappedHyperDrumVoice,
  normalizedHyperContact,
} from "./src/hyper-drums.js";
import {
  rebaseContinuousPosition,
  rebasePingPongPosition,
} from "./src/articulation.js";
import { installShapesNativeBridge } from "./src/shapes-native-bridge.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const audio = new FmDrumAudio(globalThis);
const defaults = Object.freeze({
  shapeType: "tesseract",
  profileSides: 4,
  profileShapeType: "polygon",
  profileStarDepth: 0.48,
  position: 0.5,
  speed: 0.1,
  traversalDirection: 1,
  motionMode: "loop",
  rotationXW: 24,
  rotationYW: -18,
  rotationZW: 12,
  rotationXWSpeed: 0.06,
  rotationYWSpeed: 0.04,
  rotationZWSpeed: -0.02,
  hyperScaleX: 1,
  hyperScaleY: 1,
  hyperScaleZ: 1,
  hyperScaleW: 1,
  mappingMode: "axis-depth",
  pitchDepth: 12,
  characterDepth: 0.7,
  subdivisions: 2,
  strikeLimit: 6,
  output: 0.65,
});
const state = {
  ...defaults,
  continuousPosition: defaults.position,
  playing: false,
  rotationXWPlaying: false,
  rotationYWPlaying: false,
  rotationZWPlaying: false,
  audioOn: false,
};
const voices = loadDrumBank();
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { desynchronized: true });
const previousContactKeys = new Set();
const lastStrikeTimes = new Map();
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let shapesHostParked = false;
let lastFrameTime = performance.now();
let suppressStrikeFrames = 2;
let canvasDrag = null;

const SHAPE_LABELS = Object.freeze({
  tesseract: "Tesseract",
  hypersphere: "Hypersphere",
  hyperpyramid: "Hyperpyramid",
  klein: "Klein bottle",
  profile: "Profile hyperprism",
});

function clamp(value, minimum = 0, maximum = 1) {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(
    minimum,
    Number.isFinite(numeric) ? numeric : minimum,
  ));
}

function wrap01(value) {
  return ((Number(value) % 1) + 1) % 1;
}

function pingPong01(value) {
  const wrapped = ((Number(value) % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

function endpointSafePhase(value) {
  const phase = clamp(value);
  return phase >= 1 ? 1 - 1e-9 : phase;
}

function rebasePosition(value) {
  const nextPosition = state.motionMode === "pingpong" ? clamp(value) : wrap01(value);
  state.continuousPosition = state.motionMode === "pingpong"
    ? rebasePingPongPosition(state.continuousPosition, nextPosition)
    : rebaseContinuousPosition(
      state.continuousPosition,
      wrap01(state.continuousPosition),
      nextPosition,
    );
  state.position = nextPosition;
}

function normalizeDegrees(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function loadDrumBank() {
  const fallback = cloneDefaultFmDrumVoices();
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== fallback.length) return fallback;
    return fallback.map((voice) => {
      const saved = stored.find((candidate) => candidate?.id === voice.id);
      return sanitizeFmDrumVoice({
        ...voice,
        ...saved,
        id: voice.id,
        key: voice.key,
      });
    });
  } catch {
    return fallback;
  }
}

function announce(message) {
  $("liveStatus").textContent = "";
  requestAnimationFrame(() => {
    $("liveStatus").textContent = message;
  });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function setPressed(element, pressed) {
  element.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function scheduleFrame() {
  if (shapesHostParked) return;
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function clearContactHistory(suppressFrames = 1) {
  previousContactKeys.clear();
  suppressStrikeFrames = Math.max(suppressStrikeFrames, suppressFrames);
}

function bindRange(id, key, formatter, afterChange) {
  const input = $(id);
  const output = $(`${id}Out`);
  const paint = () => {
    input.value = String(state[key]);
    output.textContent = formatter(state[key]);
  };
  input.addEventListener("input", () => {
    state[key] = Number(input.value);
    afterChange?.();
    paint();
    scheduleFrame();
  });
  paint();
  return paint;
}

bindRange("position", "position", (value) => `${((value * 2 - 1) * 100).toFixed(1)}%`, () => {
  rebasePosition(state.position);
  clearContactHistory(1);
});
bindRange("speed", "speed", (value) => `${value.toFixed(2)} cyc/s`);
bindRange("output", "output", (value) => `${Math.round(value * 100)}%`, () => {
  if (state.audioOn) audio.setOutput(state.output);
});
bindRange("pitchDepth", "pitchDepth", (value) => `±${Math.round(value)} st`);
bindRange(
  "characterDepth",
  "characterDepth",
  (value) => `${Math.round(value * 100)}%`,
);
bindRange("subdivisions", "subdivisions", (value) => String(Math.round(value)), () => {
  state.subdivisions = Math.round(clamp(state.subdivisions, 1, 16));
  clearContactHistory(1);
  paintSubdivisionHelp();
  updateMappingSummary();
});
bindRange("strikeLimit", "strikeLimit", (value) => String(Math.round(value)));
for (const axis of ["XW", "YW", "ZW"]) {
  bindRange(
    `rotation${axis}`,
    `rotation${axis}`,
    (value) => `${Math.round(value)}°`,
    () => clearContactHistory(1),
  );
  bindRange(
    `rotation${axis}Speed`,
    `rotation${axis}Speed`,
    (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)} rev/s`,
  );
}
for (const axis of ["X", "Y", "Z", "W"]) {
  bindRange(
    `hyperScale${axis}`,
    `hyperScale${axis}`,
    (value) => `${value.toFixed(2)}×`,
    () => clearContactHistory(2),
  );
}

function setAudioState(enabled) {
  state.audioOn = Boolean(enabled);
  setPressed($("audioButton"), state.audioOn);
  $("audioState").textContent = state.audioOn ? "on" : "off";
  audio.setOutput(state.audioOn ? state.output : 0);
}

async function enableAudio() {
  try {
    $("audioError").hidden = true;
    await audio.start();
    setAudioState(true);
    scheduleFrame();
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}

$("audioButton").addEventListener("click", async () => {
  if (state.audioOn) {
    setAudioState(false);
    announce("Hyper drums audio off.");
  } else if (await enableAudio()) {
    announce("Hyper drums audio on.");
  }
  scheduleFrame();
});

function rotationIsMoving() {
  return state.rotationXWPlaying
    || state.rotationYWPlaying
    || state.rotationZWPlaying;
}

function paintPlayback() {
  setPressed($("playButton"), state.playing);
  $("playButton").setAttribute(
    "aria-label",
    state.playing ? "Pause hyperplane" : "Play hyperplane",
  );
  $("playSummary").textContent = `W plane · ${state.playing ? "playing" : "paused"} · ${state.motionMode} · ${state.traversalDirection > 0 ? "forward" : "reverse"}`;
}

function paintTraversalControls() {
  const forward = state.traversalDirection > 0;
  $("traversalDirectionGlyph").textContent = forward ? "→" : "←";
  $("traversalDirectionText").textContent = forward ? "FWD" : "REV";
  $("traversalDirection").setAttribute(
    "aria-label",
    `Hyperplane direction: ${forward ? "forward" : "reverse"}${state.motionMode === "pingpong" ? " ping-pong travel" : ""}`,
  );
  setPressed($("loopMotion"), state.motionMode === "loop");
  setPressed($("pingPongMotion"), state.motionMode === "pingpong");
  paintPlayback();
}

function paintRotation() {
  const axes = [];
  for (const axis of ["XW", "YW", "ZW"]) {
    const playing = state[`rotation${axis}Playing`];
    const button = $(`rotation${axis}Play`);
    setPressed(button, playing);
    button.setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${axis} rotation`);
    button.querySelector("span").textContent = playing ? "Ⅱ" : "▶";
    if (playing) axes.push(axis);
  }
  $("rotationSummary").textContent = axes.length ? axes.join("+") : "paused";
}

function paintRotationAxes() {
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  paintRotation();
}

$("playButton").addEventListener("click", () => {
  state.playing = !state.playing;
  lastFrameTime = performance.now();
  previousContactKeys.clear();
  suppressStrikeFrames = 0;
  paintPlayback();
  announce(state.playing ? "Hyperplane playing." : "Hyperplane paused.");
  scheduleFrame();
});

$("traversalDirection").addEventListener("click", () => {
  state.traversalDirection *= -1;
  paintTraversalControls();
  announce(`Hyperplane direction ${state.traversalDirection > 0 ? "forward" : "reverse"}.`);
});

function setMotionMode(mode, shouldAnnounce = true) {
  const nextMode = mode === "pingpong" ? "pingpong" : "loop";
  if (nextMode !== state.motionMode) {
    state.continuousPosition = nextMode === "pingpong"
      ? rebasePingPongPosition(state.continuousPosition, state.position)
      : rebaseContinuousPosition(
        state.continuousPosition,
        wrap01(state.continuousPosition),
        state.position,
      );
    state.motionMode = nextMode;
  }
  paintTraversalControls();
  if (shouldAnnounce) {
    announce(`${state.motionMode === "pingpong" ? "Ping-pong" : "Loop"} hyperplane movement selected.`);
  }
  scheduleFrame();
}

$("loopMotion").addEventListener("click", () => setMotionMode("loop"));
$("pingPongMotion").addEventListener("click", () => setMotionMode("pingpong"));

for (const axis of ["XW", "YW", "ZW"]) {
  $(`rotation${axis}Play`).addEventListener("click", () => {
    state[`rotation${axis}Playing`] = !state[`rotation${axis}Playing`];
    lastFrameTime = performance.now();
    previousContactKeys.clear();
    suppressStrikeFrames = 0;
    paintRotation();
    scheduleFrame();
  });
}

$("hyperShape").addEventListener("change", () => {
  state.shapeType = $("hyperShape").value;
  $("formSummary").textContent = SHAPE_LABELS[state.shapeType] ?? "Tesseract";
  lastStrikeTimes.clear();
  clearContactHistory(2);
  scheduleFrame();
});

$("resetHyperForm").addEventListener("click", () => {
  for (const axis of ["X", "Y", "Z", "W"]) {
    state[`hyperScale${axis}`] = 1;
    $(`hyperScale${axis}`).value = "1";
    $(`hyperScale${axis}Out`).textContent = "1.00×";
  }
  clearContactHistory(2);
  announce("Hyper form reset.");
  scheduleFrame();
});

function populateMappingModes() {
  $("mappingMode").innerHTML = HYPER_DRUM_MAPPING_MODES
    .map((mode) => `<option value="${mode.id}">${mode.label}</option>`)
    .join("");
  $("mappingMode").value = state.mappingMode;
}

function updateMappingSummary() {
  const mode = currentMappingMode();
  $("mappingSummary").textContent = [
    mode.label.toLowerCase(),
    `${state.subdivisions}/side`,
  ].join(" · ");
  $("mappingDescription").textContent = mode.description;
  $("mappingSource").querySelector("span").textContent = mode.source;
  mode.legend.forEach(({ label, detail }, index) => {
    $(`mappingLegendLabel${index}`).textContent = label;
    $(`mappingLegendDetail${index}`).textContent = detail;
  });
}

function currentMappingMode() {
  return HYPER_DRUM_MAPPING_MODES.find(({ id }) => id === state.mappingMode)
    ?? HYPER_DRUM_MAPPING_MODES[0];
}

function paintSubdivisionHelp() {
  const count = Math.round(state.subdivisions);
  $("subdivisionsHelp").textContent = count === 1
    ? "Each projected 4D edge (side) is one trigger region. Raise this for repeated hits along a side."
    : `Each projected 4D edge (side) has ${count} equal trigger regions, marked on the wireframe.`;
}

$("mappingMode").addEventListener("change", () => {
  state.mappingMode = $("mappingMode").value;
  clearContactHistory(1);
  updateMappingSummary();
  const mode = currentMappingMode();
  announce(`${mode.label} mapping. ${mode.description}`);
  scheduleFrame();
});

function renderDrumMap() {
  $("drumMap").innerHTML = voices.map((voice, index) => [
    `<span class="hyper-drum-cell" data-voice-index="${index}"`,
    ` style="--voice-color:${voice.color}">`,
    `<b>${voice.name}</b><small>${voice.key.toUpperCase()}</small></span>`,
  ].join("")).join("");
}

function flashVoice(index) {
  const cell = $("drumMap").querySelector(`[data-voice-index="${index}"]`);
  if (!cell) return;
  cell.classList.add("is-active");
  clearTimeout(Number(cell.dataset.clearTimer) || 0);
  const timer = setTimeout(() => cell.classList.remove("is-active"), 150);
  cell.dataset.clearTimer = String(timer);
}

function rotation(overrides = {}) {
  return {
    xw: overrides.xw ?? state.rotationXW,
    yw: overrides.yw ?? state.rotationYW,
    zw: overrides.zw ?? state.rotationZW,
    xy: 16,
    yz: -9,
  };
}

function hyperForm() {
  return {
    x: state.hyperScaleX,
    y: state.hyperScaleY,
    z: state.hyperScaleZ,
    w: state.hyperScaleW,
    profile: {
      sides: state.profileSides,
      shapeType: state.profileShapeType,
      starDepth: state.profileStarDepth,
    },
  };
}

document.addEventListener("morphazoid:shapes-profile", (event) => {
  const profile = event.detail ?? {};
  state.profileSides = Math.round(clamp(profile.sides, 1, 32));
  state.profileShapeType = profile.kind === "star" ? "star" : "polygon";
  state.profileStarDepth = clamp(profile.starDepth, 0.05, 0.82);
  state.shapeType = "profile";
  $("hyperShape").value = "profile";
  clearContactHistory(2);
  $("formSummary").textContent = `${state.profileSides}-point ${state.profileShapeType} hyperprism`;
  updateMappingSummary();
  paintSubdivisionHelp();
  scheduleFrame();
});

function currentHyperShape() {
  return transformedHyperShape(state.shapeType, rotation(), hyperForm());
}

function currentHyperplaneOffset(shape, phase = state.position) {
  phase = endpointSafePhase(phase);
  return hyperplaneOffsetForShapePhase(shape, phase);
}

function viewPoint(point) {
  const fourProjected = projectPoint4(point);
  const viewed = rotatePoint3(fourProjected, { x: -16, y: 27, z: 0 });
  return { ...projectPoint3(viewed, 3.8), w: point.w };
}

function canvasPoint(point) {
  const projected = viewPoint(point);
  const scale = Math.min(cssWidth, cssHeight) * 0.31;
  return {
    ...projected,
    canvasX: cssWidth * 0.5 + projected.x * scale,
    canvasY: cssHeight * 0.5 - projected.y * scale,
  };
}

function boundsForShape(shape) {
  const viewed = shape.vertices.map(viewPoint);
  const bounds = {
    minX: Math.min(...viewed.map(({ x }) => x)),
    maxX: Math.max(...viewed.map(({ x }) => x)),
    minY: Math.min(...viewed.map(({ y }) => y)),
    maxY: Math.max(...viewed.map(({ y }) => y)),
    minDepth: Math.min(...viewed.map(({ z }) => z)),
    maxDepth: Math.max(...viewed.map(({ z }) => z)),
    minW: Math.min(...shape.vertices.map(({ w }) => w)),
    maxW: Math.max(...shape.vertices.map(({ w }) => w)),
  };
  for (const pair of [
    ["minX", "maxX"],
    ["minY", "maxY"],
    ["minDepth", "maxDepth"],
    ["minW", "maxW"],
  ]) {
    if (Math.abs(bounds[pair[1]] - bounds[pair[0]]) < 1e-8) {
      bounds[pair[0]] -= 1;
      bounds[pair[1]] += 1;
    }
  }
  return bounds;
}

function enrichContacts(shape, contacts) {
  return contacts.map((contact) => {
    const edge = shape.edges[contact.edgeIndex];
    const pointA = shape.vertices[edge.a];
    const pointB = shape.vertices[edge.b];
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const dz = pointB.z - pointA.z;
    const dw = pointB.w - pointA.w;
    const viewed = viewPoint(contact);
    const viewedA = viewPoint(pointA);
    const viewedB = viewPoint(pointB);
    const projectedDX = viewedB.x - viewedA.x;
    const projectedDY = viewedB.y - viewedA.y;
    const projectedLengthSquared = projectedDX ** 2 + projectedDY ** 2;
    const projectedAlong = clamp(
      (
        (viewed.x - viewedA.x) * projectedDX
        + (viewed.y - viewedA.y) * projectedDY
      ) / Math.max(1e-9, projectedLengthSquared),
    );
    const enriched = {
      ...contact,
      projectedX: viewed.x,
      projectedY: viewed.y,
      projectedDepth: viewed.z,
      projectedAlong,
      incidence: clamp(Math.abs(dw) / Math.max(1e-9, Math.hypot(dx, dy, dz, dw))),
    };
    return {
      ...enriched,
      segmentIndex: hyperContactSegmentIndex(enriched, state.subdivisions),
      voiceKey: hyperContactVoiceKey(enriched, state.subdivisions),
    };
  });
}

function mappingOptions(bounds) {
  return {
    mode: state.mappingMode,
    bounds,
  };
}

function drawScene(shape, contacts, offset, bounds) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const edges = shape.edges.map((edge) => ({
    ...edge,
    depth: (
      viewPoint(shape.vertices[edge.a]).z
      + viewPoint(shape.vertices[edge.b]).z
    ) * 0.5,
  })).sort((first, second) => first.depth - second.depth);

  for (const edge of edges) {
    const a = canvasPoint(shape.vertices[edge.a]);
    const b = canvasPoint(shape.vertices[edge.b]);
    context.beginPath();
    context.moveTo(a.canvasX, a.canvasY);
    context.lineTo(b.canvasX, b.canvasY);
    const wAxis = edge.axis === "w";
    context.strokeStyle = wAxis
      ? "rgba(199,155,255,.72)"
      : "rgba(232,196,107,.45)";
    context.lineWidth = wAxis ? 1.35 : 1;
    if (wAxis) context.setLineDash([3, 4]);
    context.stroke();
    context.setLineDash([]);
  }

  if (state.subdivisions > 1) {
    context.beginPath();
    for (const edge of shape.edges) {
      const a = canvasPoint(shape.vertices[edge.a]);
      const b = canvasPoint(shape.vertices[edge.b]);
      for (let division = 1; division < state.subdivisions; division += 1) {
        const along = division / state.subdivisions;
        const x = a.canvasX + (b.canvasX - a.canvasX) * along;
        const y = a.canvasY + (b.canvasY - a.canvasY) * along;
        context.moveTo(x + 1.25, y);
        context.arc(x, y, 1.25, 0, TAU);
      }
    }
    context.fillStyle = "rgba(255,243,214,.34)";
    context.fill();
  }

  const planeY = cssHeight * (0.5 - offset * 0.08);
  const gradient = context.createLinearGradient?.(0, planeY, cssWidth, planeY);
  if (gradient) {
    gradient.addColorStop(0, "rgba(199,155,255,0)");
    gradient.addColorStop(0.5, "rgba(199,155,255,.34)");
    gradient.addColorStop(1, "rgba(199,155,255,0)");
  }
  context.beginPath();
  context.moveTo(cssWidth * 0.15, planeY);
  context.lineTo(cssWidth * 0.85, planeY);
  context.strokeStyle = gradient || "rgba(199,155,255,.3)";
  context.lineWidth = 1;
  context.stroke();

  for (const vertex of shape.vertices) {
    const point = canvasPoint(vertex);
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 2.5, 0, TAU);
    context.fillStyle = "#07090b";
    context.fill();
    context.strokeStyle = vertex.w >= offset
      ? "rgba(199,155,255,.7)"
      : "rgba(232,196,107,.55)";
    context.stroke();
  }

  for (const contact of contacts) {
    const point = canvasPoint(contact);
    const voiceIndex = hyperDrumVoiceIndex(contact, mappingOptions(bounds));
    context.save();
    context.shadowColor = voices[voiceIndex].color;
    context.shadowBlur = 16;
    context.beginPath();
    context.arc(point.canvasX, point.canvasY, 4.5, 0, TAU);
    context.fillStyle = voices[voiceIndex].color;
    context.fill();
    context.strokeStyle = "#fff3d6";
    context.lineWidth = 0.7;
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

function updateMappingReadout(contact, voice, bounds) {
  const normalized = normalizedHyperContact(contact, bounds);
  $("mappingReadout").textContent = [
    `${String(contact.axis || "4D").toUpperCase()} EDGE`,
    `SEGMENT ${(contact.segmentIndex ?? 0) + 1}/${state.subdivisions}`,
    `${Math.round(normalized.depth * 100)}% DEPTH`,
    `→ ${voice.name}`,
    `${Math.round(voice.frequency)} HZ`,
  ].join(" · ");
}

function triggerContacts(contacts, now, bounds, moving) {
  if (!state.audioOn || !moving || suppressStrikeFrames > 0) return;
  const onsets = contacts.filter(({ voiceKey }) => !previousContactKeys.has(voiceKey));
  const selected = evenlySelect(onsets, Math.round(state.strikeLimit));
  for (const contact of selected) {
    const voiceIndex = hyperDrumVoiceIndex(contact, mappingOptions(bounds));
    const lastStrike = lastStrikeTimes.get(voiceIndex) ?? Number.NEGATIVE_INFINITY;
    if (now - lastStrike < 75) continue;
    lastStrikeTimes.set(voiceIndex, now);
    const voice = mappedHyperDrumVoice(voices[voiceIndex], contact, {
      bounds,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      contactCount: contacts.length,
    });
    audio.trigger(voice).catch(showError);
    flashVoice(voiceIndex);
    updateMappingReadout(contact, voice, bounds);
  }
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  pixelRatio = Math.max(1, Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(3_000_000 / (cssWidth * cssHeight)),
  ));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  scheduleFrame();
}

function frame(now) {
  scheduledFrame = 0;
  const delta = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1_000));
  lastFrameTime = now;
  const previousPosition = state.continuousPosition;
  if (state.playing) {
    state.continuousPosition += state.traversalDirection * state.speed * delta;
    state.position = state.motionMode === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
  }
  const looped = state.playing && state.motionMode === "loop" && crossedHyperplaneLoop(
    previousPosition,
    state.continuousPosition,
  );
  for (const axis of ["XW", "YW", "ZW"]) {
    if (!state[`rotation${axis}Playing`]) continue;
    state[`rotation${axis}`] = normalizeDegrees(
      state[`rotation${axis}`]
        + state[`rotation${axis}Speed`] * 360 * delta,
    );
  }

  const shape = currentHyperShape();
  const offset = currentHyperplaneOffset(shape);
  const bounds = boundsForShape(shape);
  const contacts = enrichContacts(
    shape,
    hyperplaneIntersections(shape, offset),
  );
  const moving = state.playing || rotationIsMoving() || Boolean(canvasDrag);
  if (looped) previousContactKeys.clear();
  triggerContacts(contacts, now, bounds, moving);
  previousContactKeys.clear();
  for (const { voiceKey } of contacts) previousContactKeys.add(voiceKey);
  if (suppressStrikeFrames > 0) suppressStrikeFrames -= 1;
  drawScene(shape, contacts, offset, bounds);

  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}`).value = String(state[`rotation${axis}`]);
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
  }
  const shapeLabel = (SHAPE_LABELS[state.shapeType] ?? "Tesseract").toUpperCase();
  const mappingStatus = currentMappingMode().status;
  const motion = [
    state.playing ? "W PLANE" : "",
    rotationIsMoving() ? "ROTATION" : "",
    canvasDrag ? "DRAG" : "",
  ].filter(Boolean).join(" + ") || "PAUSED";
  $("stageReadout").textContent = [
    shapeLabel,
    mappingStatus,
    `${state.subdivisions} SEG/SIDE`,
    `${contacts.length} CONTACT${contacts.length === 1 ? "" : "S"}`,
    motion,
    state.audioOn ? "AUDIO ON" : "AUDIO OFF",
  ].join(" · ");
  if (moving) scheduleFrame();
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.isPrimary === false || (event.button ?? 0) !== 0) return;
  state.rotationXWPlaying = false;
  state.rotationYWPlaying = false;
  canvasDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    rotationXW: state.rotationXW,
    rotationYW: state.rotationYW,
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  stageWrap.classList.add("is-spinning");
  paintRotation();
  scheduleFrame();
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return;
  const bounds = canvas.getBoundingClientRect();
  const horizontal = (event.clientX - canvasDrag.startX) / Math.max(1, bounds.width);
  const vertical = (event.clientY - canvasDrag.startY) / Math.max(1, bounds.height);
  state.rotationYW = normalizeDegrees(canvasDrag.rotationYW + horizontal * 240);
  state.rotationXW = normalizeDegrees(canvasDrag.rotationXW - vertical * 240);
  paintRotationAxes();
  scheduleFrame();
  event.preventDefault();
});

function finishCanvasDrag(event) {
  if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return;
  canvasDrag = null;
  stageWrap.classList.remove("is-spinning");
  paintRotationAxes();
  scheduleFrame();
}

canvas.addEventListener("pointerup", finishCanvasDrag);
canvas.addEventListener("pointercancel", finishCanvasDrag);
canvas.addEventListener("lostpointercapture", finishCanvasDrag);

function setPosition(value) {
  rebasePosition(value);
  $("position").value = String(state.position);
  $("positionOut").textContent = `${((state.position * 2 - 1) * 100).toFixed(1)}%`;
  clearContactHistory(1);
  scheduleFrame();
}

canvas.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    $("playButton").click();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    setPosition(state.position - (event.shiftKey ? 0.05 : 0.01));
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    setPosition(state.position + (event.shiftKey ? 0.05 : 0.01));
  }
});

function reset() {
  Object.assign(state, defaults, {
    continuousPosition: defaults.position,
    playing: false,
    rotationXWPlaying: false,
    rotationYWPlaying: false,
    rotationZWPlaying: false,
  });
  for (const key of [
    "position",
    "speed",
    "output",
    "pitchDepth",
    "characterDepth",
    "subdivisions",
    "strikeLimit",
    "rotationXW",
    "rotationYW",
    "rotationZW",
    "rotationXWSpeed",
    "rotationYWSpeed",
    "rotationZWSpeed",
    "hyperScaleX",
    "hyperScaleY",
    "hyperScaleZ",
    "hyperScaleW",
  ]) {
    $(key).value = String(state[key]);
  }
  $("positionOut").textContent = "0.0%";
  $("speedOut").textContent = "0.10 cyc/s";
  $("outputOut").textContent = "65%";
  $("pitchDepthOut").textContent = "±12 st";
  $("characterDepthOut").textContent = "70%";
  $("subdivisionsOut").textContent = String(state.subdivisions);
  $("strikeLimitOut").textContent = "6";
  for (const axis of ["XW", "YW", "ZW"]) {
    $(`rotation${axis}Out`).textContent = `${Math.round(state[`rotation${axis}`])}°`;
    const speed = state[`rotation${axis}Speed`];
    $(`rotation${axis}SpeedOut`).textContent = `${speed >= 0 ? "+" : ""}${speed.toFixed(2)} rev/s`;
  }
  for (const axis of ["X", "Y", "Z", "W"]) {
    $(`hyperScale${axis}Out`).textContent = "1.00×";
  }
  $("hyperShape").value = state.shapeType;
  $("formSummary").textContent = SHAPE_LABELS[state.shapeType];
  $("mappingMode").value = state.mappingMode;
  paintTraversalControls();
  paintPlayback();
  paintRotation();
  updateMappingSummary();
  paintSubdivisionHelp();
  lastStrikeTimes.clear();
  clearContactHistory(2);
  if (state.audioOn) audio.setOutput(state.output);
  announce("Hyper Drum Machine reset.");
  scheduleFrame();
}

$("resetHyperDrums").addEventListener("click", reset);

function bridgeRange(id, value) {
  const input = $(id);
  if (!input || !Number.isFinite(Number(value))) return;
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const SHARED_MAPPING_FROM_HYPER = Object.freeze({
  "axis-depth": "feature",
  "projected-position": "position",
  "w-incidence": "incidence",
});
const HYPER_MAPPING_FROM_SHARED = Object.freeze({
  feature: "axis-depth",
  position: "projected-position",
  incidence: "w-incidence",
});

function sharedProfileForHyper() {
  if (state.shapeType === "profile") {
    return {
      sides: state.profileSides,
      kind: state.profileSides === 1
        ? "circle"
        : state.profileSides === 2 ? "line" : state.profileShapeType,
      starDepth: state.profileStarDepth,
      lift: "prism",
    };
  }
  if (state.shapeType === "hypersphere") {
    return { sides: 1, kind: "circle", starDepth: 0.48, lift: "round" };
  }
  if (state.shapeType === "tesseract") {
    return { sides: 4, kind: "polygon", starDepth: 0.48, lift: "prism" };
  }
  return { sides: 4, kind: "polygon", starDepth: 0.48, lift: "local" };
}

function applySharedProfile(profile = {}) {
  if (profile.lift === "local") return;
  const sides = Math.round(clamp(profile.sides, 1, 32));
  if (profile.kind === "circle" || sides === 1) {
    state.shapeType = "hypersphere";
    $("hyperShape").value = "hypersphere";
    $("formSummary").textContent = SHAPE_LABELS.hypersphere;
    return;
  }
  state.profileSides = sides;
  state.profileShapeType = profile.kind === "star" ? "star" : "polygon";
  state.profileStarDepth = clamp(profile.starDepth, 0.05, 0.82);
  state.shapeType = "profile";
  $("hyperShape").value = "profile";
  $("formSummary").textContent = `${sides}-point ${state.profileShapeType} hyperprism`;
}

function hyperDimensionState() {
  return {
    shapeType: state.shapeType,
    profileSides: state.profileSides,
    profileShapeType: state.profileShapeType,
    profileStarDepth: state.profileStarDepth,
    hyperScaleX: state.hyperScaleX,
    hyperScaleY: state.hyperScaleY,
    hyperScaleZ: state.hyperScaleZ,
    hyperScaleW: state.hyperScaleW,
    rotationXW: state.rotationXW,
    rotationYW: state.rotationYW,
    rotationZW: state.rotationZW,
    rotationXWPlaying: state.rotationXWPlaying,
    rotationYWPlaying: state.rotationYWPlaying,
    rotationZWPlaying: state.rotationZWPlaying,
    rotationXWSpeed: state.rotationXWSpeed,
    rotationYWSpeed: state.rotationYWSpeed,
    rotationZWSpeed: state.rotationZWSpeed,
  };
}

function applyHyperDimensionState(dimension = {}) {
  if (!dimension || !Object.keys(dimension).length) return;
  const shapeTypes = new Set(["tesseract", "hypersphere", "hyperpyramid", "klein", "profile"]);
  if (shapeTypes.has(dimension.shapeType)) {
    state.shapeType = dimension.shapeType;
    $("hyperShape").value = state.shapeType;
    $("formSummary").textContent = SHAPE_LABELS[state.shapeType] ?? "Tesseract";
  }
  if (Number.isFinite(Number(dimension.profileSides))) {
    state.profileSides = Math.round(clamp(dimension.profileSides, 1, 32));
  }
  state.profileShapeType = dimension.profileShapeType === "star" ? "star" : "polygon";
  if (Number.isFinite(Number(dimension.profileStarDepth))) {
    state.profileStarDepth = clamp(dimension.profileStarDepth, 0.05, 0.82);
  }
  for (const key of ["hyperScaleX", "hyperScaleY", "hyperScaleZ", "hyperScaleW"]) {
    bridgeRange(key, dimension[key]);
  }
  for (const axis of ["XW", "YW", "ZW"]) {
    bridgeRange(`rotation${axis}`, dimension[`rotation${axis}`]);
    bridgeRange(`rotation${axis}Speed`, dimension[`rotation${axis}Speed`]);
    const playing = dimension[`rotation${axis}Playing`];
    if (typeof playing === "boolean") state[`rotation${axis}Playing`] = playing;
  }
  paintRotation();
}

function suppressHyperDrumContacts() {
  lastStrikeTimes.clear();
  clearContactHistory(2);
}

function resetShapesBank(bank) {
  if (bank === "form") {
    $("resetHyperForm").click();
    suppressHyperDrumContacts();
    return true;
  }

  if (bank === "play") {
    Object.assign(state, {
      position: defaults.position,
      continuousPosition: defaults.position,
      speed: defaults.speed,
      traversalDirection: defaults.traversalDirection,
      motionMode: defaults.motionMode,
      playing: false,
    });
    for (const key of ["position", "speed"]) {
      bridgeRange(key, state[key]);
    }
    state.continuousPosition = defaults.position;
    paintTraversalControls();
    paintPlayback();
    paintSubdivisionHelp();
    updateMappingSummary();
    suppressHyperDrumContacts();
    lastFrameTime = performance.now();
    announce("Play controls reset.");
    scheduleFrame();
    return true;
  }

  if (bank === "rotation") {
    for (const axis of ["XW", "YW", "ZW"]) {
      state[`rotation${axis}`] = defaults[`rotation${axis}`];
      state[`rotation${axis}Speed`] = defaults[`rotation${axis}Speed`];
      state[`rotation${axis}Playing`] = false;
      bridgeRange(`rotation${axis}`, state[`rotation${axis}`]);
      bridgeRange(`rotation${axis}Speed`, state[`rotation${axis}Speed`]);
    }
    paintRotation();
    suppressHyperDrumContacts();
    lastFrameTime = performance.now();
    announce("Rotation controls reset.");
    scheduleFrame();
    return true;
  }

  if (bank === "mapping") {
    state.mappingMode = defaults.mappingMode;
    $("mappingMode").value = state.mappingMode;
    for (const key of ["pitchDepth", "characterDepth", "strikeLimit"]) {
      bridgeRange(key, defaults[key]);
    }
    updateMappingSummary();
    suppressHyperDrumContacts();
    announce("Drum mapping reset.");
    scheduleFrame();
    return true;
  }

  return false;
}

installShapesNativeBridge({
  geometry: "hyper",
  sound: "drums",
  capabilities: {
    continuousPosition: true,
    hostGain: true,
    sharedProfile: true,
    bankReset: true,
  },
  captureState: () => ({
    playback: {
      position: state.position,
      continuousPosition: state.continuousPosition,
      speed: state.speed,
      direction: state.traversalDirection,
      playing: state.playing,
      motionMode: state.motionMode,
    },
    audio: { enabled: state.audioOn, level: state.output },
    topology: sharedProfileForHyper(),
    dimension: hyperDimensionState(),
    drums: {
      mappingFamily: SHARED_MAPPING_FROM_HYPER[state.mappingMode] ?? "feature",
      subdivisions: state.subdivisions,
      pitchDepth: state.pitchDepth,
      characterDepth: state.characterDepth,
      strikeLimit: state.strikeLimit,
    },
  }),
  applyState: (snapshot = {}) => {
    shapesHostParked = false;
    const playback = snapshot.playback ?? {};
    const drums = snapshot.drums ?? {};
    applyHyperDimensionState(snapshot.dimension ?? {});
    applySharedProfile(snapshot.topology ?? sharedProfileForHyper());
    state.motionMode = playback.motionMode === "pingpong" ? "pingpong" : "loop";
    state.speed = clamp(playback.speed ?? state.speed, 0, 4);
    $("speed").value = String(state.speed);
    state.continuousPosition = Number.isFinite(playback.continuousPosition)
      ? playback.continuousPosition
      : clamp(playback.position ?? state.position);
    state.position = state.motionMode === "pingpong"
      ? pingPong01(state.continuousPosition)
      : wrap01(state.continuousPosition);
    $("position").value = String(state.position);
    state.traversalDirection = playback.direction < 0 ? -1 : 1;
    state.playing = Boolean(playback.playing);
    const mappingMode = HYPER_MAPPING_FROM_SHARED[drums.mappingFamily];
    if (mappingMode && $("mappingMode").querySelector(`option[value="${mappingMode}"]`)) {
      state.mappingMode = mappingMode;
      $("mappingMode").value = mappingMode;
    }
    bridgeRange("subdivisions", drums.subdivisions);
    bridgeRange("pitchDepth", drums.pitchDepth);
    bridgeRange("characterDepth", drums.characterDepth);
    bridgeRange("strikeLimit", drums.strikeLimit);
    bridgeRange("output", snapshot.audio?.level);
    paintTraversalControls();
    paintPlayback();
    updateMappingSummary();
    paintSubdivisionHelp();
    suppressHyperDrumContacts();
    lastFrameTime = performance.now();
    scheduleFrame();
  },
  prepareAudio: async ({ gain = 0 } = {}) => {
    audio.setHostGain(gain);
    if (!state.audioOn) await enableAudio();
    setAudioState(true);
    lastFrameTime = performance.now();
    scheduleFrame();
  },
  setHostGain: (gain, rampMilliseconds) => audio.setHostGain(gain, rampMilliseconds),
  parkAudio: () => {
    shapesHostParked = true;
    cancelAnimationFrame(scheduledFrame);
    scheduledFrame = 0;
    audio.setHostGain(0);
    suppressHyperDrumContacts();
    scheduleFrame();
  },
  disableAudio: () => setAudioState(false),
  resetBank: resetShapesBank,
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) setAudioState(false);
  else scheduleFrame();
});
window.addEventListener("pageshow", scheduleFrame);
window.addEventListener("pagehide", () => {
  if (audio.context && audio.context.state !== "closed") void audio.context.close();
});

populateMappingModes();
renderDrumMap();
paintTraversalControls();
paintPlayback();
paintRotation();
updateMappingSummary();
new ResizeObserver(resizeCanvas).observe(stageWrap);
resizeCanvas();
reset();
